// ヒマリストの計算ロジック（DOM・Google API に依存しない純粋関数）
// ブラウザでは window.FreetimeCore、Node では module.exports から使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreetimeCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  const MS_MIN = 60 * 1000;

  const pad2 = n => String(n).padStart(2, '0');

  // Date → 'YYYY-MM-DD'（ローカル時刻基準。toISOString は UTC なので使わない）
  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // 'YYYY-MM-DD' と 'HH:MM' → ローカル時刻の Date
  // （new Date('YYYY-MM-DD') は UTC 0時として解釈されるため使わない）
  function parseLocal(dateStr, timeStr = '00:00') {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  function addDays(dateStr, n) {
    const d = parseLocal(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  // 開始日〜終了日（両端含む）のうち、対象曜日の日付文字列を返す
  function listDays(startDate, endDate, includedDays) {
    const days = [];
    for (let s = startDate; s <= endDate; s = addDays(s, 1)) {
      if (includedDays.includes(parseLocal(s).getDay())) days.push(s);
    }
    return days;
  }

  // 予定（busy）を開始順に並べ、重なり・接しているものを結合する。
  // 入力に kind（'busy' | 'break'）があれば、結合後の始まり・終わりの端が
  // どちらの種類か（startKind / endKind）を残す。同時刻なら予定（busy）を優先。
  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter(i => i.end > i.start)
      .map(i => {
        const o = { start: new Date(i.start), end: new Date(i.end) };
        if (i.kind) { o.startKind = i.kind; o.endKind = i.kind; }
        return o;
      })
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const i of sorted) {
      const last = out[out.length - 1];
      if (last && i.start <= last.end) {
        if (i.startKind && +i.start === +last.start && i.startKind === 'busy') last.startKind = 'busy';
        if (i.end > last.end) {
          last.end = i.end;
          if (i.endKind) last.endKind = i.endKind;
        } else if (i.endKind === 'busy' && +i.end === +last.end) {
          last.endKind = 'busy';
        }
      } else {
        out.push(i);
      }
    }
    return out;
  }

  // 時刻を step 分単位に切り上げる（9:07 → 9:15 など。送る相手に半端な時刻を出さないため）
  function ceilToStep(date, stepMin) {
    if (!stepMin) return new Date(date);
    const step = stepMin * MS_MIN;
    // ローカル時刻の 0 時基準で丸める
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const offset = date.getTime() - dayStart;
    return new Date(dayStart + Math.ceil(offset / step) * step);
  }

  // その曜日の対象時間帯を返す（曜日ごとの設定があれば優先）
  function dayWindow(o, dow) {
    const w = o.hoursByDay && o.hoursByDay[dow];
    return w ? { start: w.start, end: w.end } : { start: o.startTime, end: o.endTime };
  }

  /**
   * 空き時間を求める。
   * 各対象日の [開始時刻, 終了時刻] の窓から予定と除外時間帯（昼休みなど）を差し引き、
   * minDuration 分以上続く区間だけを返す（区間は分割しない）。
   *
   * @param {Array<{start:Date,end:Date}>} busy 予定
   * @param {object} o
   *   startDate/endDate 'YYYY-MM-DD', startTime/endTime 'HH:MM',
   *   hoursByDay {曜日番号: {start,end}} 曜日ごとの時間帯（省略時は startTime/endTime）,
   *   breaks [{start:'HH:MM', end:'HH:MM'}] 毎日除外する時間帯,
   *   includedDays 曜日番号の配列, minDuration 分,
   *   bufferMin 予定の前後に確保する分数, now この時刻より前は除外, roundMin 開始時刻の丸め単位
   * @returns {Array<{start:Date,end:Date,afterEvent:boolean,beforeEvent:boolean}>}
   *   afterEvent/beforeEvent … 直前・直後が実際の予定か（除外時間帯や時間帯の端は false）
   */
  function computeFreeIntervals(busy, o) {
    const {
      startDate, endDate, includedDays, breaks = [],
      minDuration, bufferMin = 0, now = null, roundMin = 15,
    } = o;
    const buf = bufferMin * MS_MIN;
    const days = listDays(startDate, endDate, includedDays);
    // 予定には前後の余裕を付ける。除外時間帯は自分の都合なので余裕は付けない
    const blocked = mergeIntervals([
      ...busy.map(b => ({
        start: new Date(new Date(b.start).getTime() - buf),
        end: new Date(new Date(b.end).getTime() + buf),
        kind: 'busy',
      })),
      ...days.flatMap(day => breaks
        .filter(br => br.start && br.end && br.end > br.start)
        .map(br => ({ start: parseLocal(day, br.start), end: parseLocal(day, br.end), kind: 'break' }))),
    ]);
    const result = [];
    for (const day of days) {
      const win = dayWindow(o, parseLocal(day).getDay());
      let winStart = parseLocal(day, win.start);
      const winEnd = parseLocal(day, win.end);
      if (now && winStart < now) winStart = ceilToStep(now, roundMin);
      if (winStart >= winEnd) continue;

      let cursor = winStart;
      let afterEvent = false;
      for (const b of blocked) {
        if (b.end <= cursor) continue;
        if (b.start >= winEnd) break;
        if (b.start > cursor) pushIfLong(result, cursor, b.start, minDuration, afterEvent, b.startKind === 'busy');
        if (b.end > cursor) {
          cursor = ceilToStep(b.end, roundMin);
          afterEvent = b.endKind === 'busy';
        }
        if (cursor >= winEnd) break;
      }
      if (cursor < winEnd) pushIfLong(result, cursor, winEnd, minDuration, afterEvent, false);
    }
    return result;
  }

  function pushIfLong(arr, start, end, minDuration, afterEvent = false, beforeEvent = false) {
    if (end - start >= minDuration * MS_MIN) {
      arr.push({ start: new Date(start), end: new Date(end), afterEvent, beforeEvent });
    }
  }

  const fmtTime = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const fmtDate = d => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;

  // 日付ごとにまとめる（並び順は維持）
  function groupByDate(intervals) {
    const map = new Map();
    for (const i of intervals) {
      const key = toDateStr(i.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    return map;
  }

  // n 件を選ぶ。early=早い順 / long=長い空きを優先 / spread=1日の中でばらけさせる
  function pick(items, n, by) {
    if (!n || items.length <= n) return items;
    let chosen;
    if (by === 'long') {
      chosen = [...items].sort((a, b) => (b.span - a.span) || (a.start - b.start)).slice(0, n);
    } else if (by === 'spread') {
      const idx = new Set();
      for (let k = 0; k < n; k++) idx.add(n === 1 ? 0 : Math.round(k * (items.length - 1) / (n - 1)));
      chosen = items.filter((_, i) => idx.has(i));
    } else {
      chosen = items.slice(0, n);
    }
    return chosen.sort((a, b) => a.start - b.start); // 表示は時刻順
  }

  // 空き区間から通常の候補を作る（range=区間そのもの / slots=30分刻みの開始時刻）
  function plainItems(list, format, minDuration) {
    if (format !== 'slots') return list.map(i => ({ start: i.start, end: i.end, span: i.end - i.start, score: 0 }));
    const items = [];
    for (const i of list) {
      for (let t = ceilToStep(i.start, 30); t.getTime() + minDuration * MS_MIN <= i.end.getTime();
        t = new Date(t.getTime() + 30 * MS_MIN)) {
        items.push({ start: t, end: new Date(t.getTime() + minDuration * MS_MIN), span: i.end - i.start, score: 0 });
      }
    }
    return items;
  }

  // 予定に寄せた候補を作る。score: 2=予定の間を埋める / 1=予定の直前・直後 / 0=予定に接していない
  function clusterItems(list, minDuration) {
    const dur = minDuration * MS_MIN;
    const items = [];
    for (const i of list) {
      const len = i.end - i.start;
      const span = len;
      if (i.afterEvent && i.beforeEvent && len < dur * 2) {
        items.push({ start: i.start, end: i.end, span, score: 2 });
        continue;
      }
      if (i.afterEvent) items.push({ start: i.start, end: new Date(+i.start + dur), span, score: 1 });
      if (i.beforeEvent) items.push({ start: new Date(+i.end - dur), end: i.end, span, score: 1 });
      if (!i.afterEvent && !i.beforeEvent) items.push({ start: i.start, end: new Date(+i.start + dur), span, score: 0 });
    }
    return items;
  }

  /**
   * 相手に出す候補を日付ごとに作る。
   * format: 'range' … 空き区間そのものが候補
   *         'slots' … minDuration の枠を30分刻みで開始できる時刻が候補（end = 開始 + minDuration）
   * maxPerDay（0 で無制限）を超える日は pickBy の方針で絞る。
   * cluster=true のときは「予定を固める」方針で選ぶ：
   *   preferAdjacent … 候補を予定の直前・直後に寄せた枠にし、予定の間を埋める枠を最優先
   *   preferBusyDays … すでに予定がある日を先に選ぶ（予定のない日は後回し）
   * maxTotal（0 で無制限）… 全体の候補数。cluster 時は優先順、それ以外は早い順に数える。
   * @returns {Map<'YYYY-MM-DD', Array<{start:Date,end:Date}>>}
   */
  function listCandidates(intervals, {
    format = 'range', minDuration = 60, maxPerDay = 0, pickBy = 'early', maxTotal = 0,
    cluster = false, preferAdjacent = true, preferBusyDays = true,
  } = {}) {
    const all = [];
    for (const [key, list] of groupByDate(intervals)) {
      const busyDay = list.some(i => i.afterEvent || i.beforeEvent);
      let items = cluster && preferAdjacent ? clusterItems(list, minDuration) : plainItems(list, format, minDuration);
      items.forEach(it => { it.key = key; it.busyDay = busyDay; });
      if (cluster) {
        items.sort(rankCluster(preferBusyDays));
        if (maxPerDay) items = items.slice(0, maxPerDay);
      } else {
        items = pick(items, maxPerDay, pickBy);
      }
      all.push(...items);
    }
    let chosen = all;
    if (maxTotal && all.length > maxTotal) {
      chosen = cluster
        ? [...all].sort(rankCluster(preferBusyDays)).slice(0, maxTotal)
        : [...all].sort((a, b) => a.start - b.start).slice(0, maxTotal);
    }
    chosen.sort((a, b) => a.start - b.start); // 表示は時刻順
    const out = new Map();
    for (const it of chosen) {
      if (!out.has(it.key)) out.set(it.key, []);
      out.get(it.key).push({ start: it.start, end: it.end });
    }
    return out;
  }

  // 固めるときの優先順：点数の高い順 →（指定時）予定がある日 → 時刻の早い順
  function rankCluster(preferBusyDays) {
    return (a, b) => (b.score - a.score)
      || (preferBusyDays ? (b.busyDay - a.busyDay) : 0)
      || (a.start - b.start);
  }

  /**
   * 相手に送るテキストを組み立てる。
   * 'range' …「10/20(月) 09:00〜12:00 / 14:00〜17:00」、'slots' …「10/20(月) 09:00、09:30」
   */
  function formatFreeTimes(intervals, opts = {}) {
    const { format = 'range', minDuration = 60, header = '', footer = '' } = opts;
    const lines = [];
    for (const [, list] of listCandidates(intervals, opts)) {
      const label = fmtDate(list[0].start);
      lines.push(format === 'slots'
        ? `・${label} ${list.map(i => fmtTime(i.start)).join('、')}`
        : `・${label} ${list.map(i => `${fmtTime(i.start)}〜${fmtTime(i.end)}`).join(' / ')}`);
    }
    const parts = [];
    if (header.trim()) parts.push(header.trim());
    parts.push(lines.join('\n'));
    if (format === 'slots') parts.push(`※開始時刻の候補です（各${minDuration}分）`);
    if (footer.trim()) parts.push(footer.trim());
    return parts.join('\n\n');
  }

  // ---------- 予定（埋まっている時間）モード ----------

  const splitWords = s => (s || '').toLowerCase().split(/[\s　]+/).filter(Boolean);

  /**
   * 予定を絞り込み、対象日ごとにまとめる（予定のない対象日も空配列で入れる）。
   * @param {Array<{start:Date,end:Date,allDay:boolean,summary:string,calendarId:string}>} events
   * @param {object} o startDate/endDate/includedDays/startTime/endTime/hoursByDay（computeFreeIntervals と同じ）,
   *   minLength 分（これより短い時間指定の予定を除く）, excludeAllDay, include/exclude（予定名のキーワード）
   * @returns {Map<'YYYY-MM-DD', Array>}
   */
  function filterEvents(events, o) {
    const inc = splitWords(o.include), exc = splitWords(o.exclude);
    const kept = events.filter(e => {
      if (e.allDay && o.excludeAllDay) return false;
      if (!e.allDay && o.minLength && e.end - e.start < o.minLength * MS_MIN) return false;
      const name = (e.summary || '').toLowerCase();
      if (inc.length && !inc.some(w => name.includes(w))) return false;
      if (exc.some(w => name.includes(w))) return false;
      return true;
    });
    const out = new Map();
    for (const day of listDays(o.startDate, o.endDate, o.includedDays)) {
      const win = dayWindow(o, parseLocal(day).getDay());
      const ws = parseLocal(day, win.start), we = parseLocal(day, win.end);
      const ds = parseLocal(day), de = parseLocal(addDays(day, 1));
      const list = kept
        .filter(e => e.allDay ? (e.start < de && e.end > ds) : (e.start < we && e.end > ws))
        .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start));
      out.set(day, list);
    }
    return out;
  }

  // その日の中に収めた時刻表示（日をまたぐ予定は 00:00 / 24:00 で切る）
  function clipLabel(e, day) {
    const ds = parseLocal(day), de = parseLocal(addDays(day, 1));
    const s = e.start < ds ? ds : e.start;
    const t = e.end > de ? de : e.end;
    return `${fmtTime(s)}〜${+t === +de ? '24:00' : fmtTime(t)}`;
  }

  function busyLine(day, list, showTitles, emptyLabel) {
    const label = fmtDate(parseLocal(day));
    if (!list.length) return `・${label} ${emptyLabel}`;
    const parts = [];
    if (showTitles) {
      for (const e of list) {
        const title = e.summary || '（タイトルなし）';
        parts.push(e.allDay ? `終日 ${title}` : `${clipLabel(e, day)} ${title}`);
      }
    } else {
      if (list.some(e => e.allDay)) parts.push('終日');
      const ds = parseLocal(day), de = parseLocal(addDays(day, 1));
      for (const m of mergeIntervals(list.filter(e => !e.allDay).map(e => ({
        start: e.start < ds ? ds : e.start, end: e.end > de ? de : e.end,
      })))) parts.push(clipLabel(m, day));
    }
    return `・${label} ${parts.join(' / ')}`;
  }

  function busyLines(byDay, showTitles, calendarId, emptyLabel) {
    const lines = [];
    for (const [day, list] of byDay) {
      lines.push(busyLine(day, calendarId ? list.filter(e => e.calendarId === calendarId) : list, showTitles, emptyLabel));
    }
    return lines.join('\n');
  }

  // AI に渡す「前提」を作る
  function contextLines(c) {
    const lines = [];
    if (c.timeZone) lines.push(`- タイムゾーン: ${c.timeZone}`);
    lines.push(`- 期間: ${fmtDate(parseLocal(c.startDate))}〜${fmtDate(parseLocal(c.endDate))}`);
    const days = [...c.includedDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // 月曜はじまり
    lines.push(`- 対象の曜日: ${days.map(d => WEEKDAYS[d]).join('・')}`);
    const wins = days.map(d => ({ d, w: dayWindow(c, d) }));
    const same = wins.every(x => x.w.start === wins[0].w.start && x.w.end === wins[0].w.end);
    lines.push(`- 候補にしてよい時間帯: ${same && wins.length
      ? `${wins[0].w.start}〜${wins[0].w.end}`
      : wins.map(x => `${WEEKDAYS[x.d]} ${x.w.start}〜${x.w.end}`).join('、')}`);
    const brs = (c.breaks || []).filter(b => b.start && b.end && b.end > b.start);
    if (brs.length) lines.push(`- 毎日除外する時間帯: ${brs.map(b => `${b.start}〜${b.end}`).join('、')}`);
    if (c.minDuration) lines.push(`- 1件あたりの所要時間: ${c.minDuration}分`);
    if (c.bufferMin) lines.push(`- 予定の前後に空けたい時間: ${c.bufferMin}分`);
    if (c.filterNote) lines.push(`- 予定の抽出条件: ${c.filterNote}`);
    return lines.join('\n');
  }

  /**
   * 埋まっている時間のテキストを組み立てる。
   * format: 'plain' … 日ごとの一覧（header を先頭に付ける）
   *         'ai'    … 前提＋埋まっている時間＋依頼文（request）。ChatGPT 等にそのまま貼る用
   * calendars: [{id, name}] を渡すとカレンダー別に分ける
   * emptyLabel: 予定のない日の表記（絞り込み中は「該当する予定なし」など）
   */
  function formatBusy(byDay, { format = 'plain', showTitles = false, calendars = null, header = '', request = '', context = null, emptyLabel = '予定なし' } = {}) {
    const body = calendars && calendars.length
      ? calendars.map(c => `【${c.name}】\n${busyLines(byDay, showTitles, c.id, emptyLabel)}`).join('\n\n')
      : busyLines(byDay, showTitles, null, emptyLabel);
    const parts = [];
    if (format === 'ai') {
      if (context) parts.push(`## 前提\n${contextLines(context)}`);
      parts.push(`## 埋まっている時間\n${body}`);
      if (request.trim()) parts.push(`## 依頼\n${request.trim()}`);
    } else {
      if (header.trim()) parts.push(header.trim());
      parts.push(body);
    }
    return parts.join('\n\n');
  }

  // タイムライン用：指定の枠が空き区間にすべて含まれるか
  function isCoveredByFree(slotStart, slotEnd, intervals) {
    return intervals.some(i => i.start <= slotStart && slotEnd <= i.end);
  }

  // タイムライン用：指定の枠が予定と重なるか
  function overlapsBusy(slotStart, slotEnd, busy) {
    return busy.some(b => slotStart < b.end && slotEnd > b.start);
  }

  return {
    WEEKDAYS, toDateStr, parseLocal, addDays, listDays, mergeIntervals, ceilToStep,
    computeFreeIntervals, dayWindow, listCandidates, formatFreeTimes, filterEvents, formatBusy, groupByDate, fmtTime, fmtDate,
    isCoveredByFree, overlapsBusy,
  };
});
