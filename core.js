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

  // 予定（busy）を開始順に並べ、重なり・接しているものを結合する
  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter(i => i.end > i.start)
      .map(i => ({ start: new Date(i.start), end: new Date(i.end) }))
      .sort((a, b) => a.start - b.start);
    const out = [];
    for (const i of sorted) {
      const last = out[out.length - 1];
      if (last && i.start <= last.end) {
        if (i.end > last.end) last.end = i.end;
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

  /**
   * 空き時間を求める。
   * 各対象日の [開始時刻, 終了時刻] の窓から予定を差し引き、
   * minDuration 分以上続く区間だけを返す（区間は分割しない）。
   *
   * @param {Array<{start:Date,end:Date}>} busy 予定
   * @param {object} o
   *   startDate/endDate 'YYYY-MM-DD', startTime/endTime 'HH:MM',
   *   includedDays 曜日番号の配列, minDuration 分,
   *   bufferMin 予定の前後に確保する分数, now この時刻より前は除外, roundMin 開始時刻の丸め単位
   * @returns {Array<{start:Date,end:Date}>}
   */
  function computeFreeIntervals(busy, o) {
    const {
      startDate, endDate, startTime, endTime, includedDays,
      minDuration, bufferMin = 0, now = null, roundMin = 15,
    } = o;
    const buf = bufferMin * MS_MIN;
    const blocked = mergeIntervals(busy.map(b => ({
      start: new Date(new Date(b.start).getTime() - buf),
      end: new Date(new Date(b.end).getTime() + buf),
    })));
    const result = [];
    for (const day of listDays(startDate, endDate, includedDays)) {
      let winStart = parseLocal(day, startTime);
      const winEnd = parseLocal(day, endTime);
      if (now && winStart < now) winStart = ceilToStep(now, roundMin);
      if (winStart >= winEnd) continue;

      let cursor = winStart;
      for (const b of blocked) {
        if (b.end <= cursor) continue;
        if (b.start >= winEnd) break;
        if (b.start > cursor) pushIfLong(result, cursor, b.start, minDuration);
        if (b.end > cursor) cursor = ceilToStep(b.end, roundMin);
        if (cursor >= winEnd) break;
      }
      if (cursor < winEnd) pushIfLong(result, cursor, winEnd, minDuration);
    }
    return result;
  }

  function pushIfLong(arr, start, end, minDuration) {
    if (end - start >= minDuration * MS_MIN) arr.push({ start: new Date(start), end: new Date(end) });
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

  /**
   * 相手に送るテキストを組み立てる。
   * format: 'range' … 「10/20(月) 09:00〜12:00 / 14:00〜17:00」
   *         'slots' … minDuration の枠を30分刻みで開始できる時刻を列挙
   */
  function formatFreeTimes(intervals, { format = 'range', minDuration = 60, header = '', footer = '' } = {}) {
    const lines = [];
    for (const [, list] of groupByDate(intervals)) {
      const label = fmtDate(list[0].start);
      if (format === 'slots') {
        const starts = [];
        for (const i of list) {
          for (let t = ceilToStep(i.start, 30); t.getTime() + minDuration * MS_MIN <= i.end.getTime();
            t = new Date(t.getTime() + 30 * MS_MIN)) {
            starts.push(fmtTime(t));
          }
        }
        if (starts.length) lines.push(`・${label} ${starts.join('、')}`);
      } else {
        lines.push(`・${label} ${list.map(i => `${fmtTime(i.start)}〜${fmtTime(i.end)}`).join(' / ')}`);
      }
    }
    const parts = [];
    if (header.trim()) parts.push(header.trim());
    parts.push(lines.join('\n'));
    if (format === 'slots') parts.push(`※開始時刻の候補です（各${minDuration}分）`);
    if (footer.trim()) parts.push(footer.trim());
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
    computeFreeIntervals, formatFreeTimes, groupByDate, fmtTime, fmtDate,
    isCoveredByFree, overlapsBusy,
  };
});
