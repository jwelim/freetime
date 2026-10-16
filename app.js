// ヒマリスト本体
// ビルド不要で動かすため JSX は使わず React.createElement（h）で書く。
// 計算ロジックは core.js（window.FreetimeCore）に分離している。
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const h = React.createElement;
const C = window.FreetimeCore;

const CLIENT_ID = '267244090541-l41q931ig7rr9rhktn3sk3dkekljrpj9.apps.googleusercontent.com';
// 読み取りのみ。freeBusy は予定の中身（タイトル等）を返さない。
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3';
const MAX_DAYS = 40;
const DEFAULT_HEADER = '以下の日程でご都合いかがでしょうか。';
const IS_DEMO = new URLSearchParams(location.search).has('demo');

// ---------- 保存（localStorage が使えない環境でも落ちないようにする） ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('freetime:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('freetime:' + key, JSON.stringify(value)); } catch { /* 無視 */ }
  },
};

// 設定値を localStorage に保存する useState
function usePersistent(key, initial) {
  const [value, setValue] = useState(() => store.get(key, initial));
  useEffect(() => { store.set(key, value); }, [key, value]);
  return [value, setValue];
}

// ---------- Google 認証（Google Identity Services のトークンクライアント） ----------
// アクセストークンは URL にもログにも出さず、タブを閉じるまで sessionStorage にだけ置く。
const tokenStore = {
  load() {
    try {
      const t = JSON.parse(sessionStorage.getItem('freetime:token') || 'null');
      return t && t.expiresAt > Date.now() + 60 * 1000 ? t : null;
    } catch { return null; }
  },
  save(t) { try { sessionStorage.setItem('freetime:token', JSON.stringify(t)); } catch { /* 無視 */ } },
  clear() { try { sessionStorage.removeItem('freetime:token'); } catch { /* 無視 */ } },
};

function waitForGis(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
      if (Date.now() - started > timeoutMs) return reject(new Error('Googleログインの読み込みに失敗しました。通信環境や広告ブロッカーを確認してください。'));
      setTimeout(poll, 100);
    })();
  });
}

// トークンを要求する。interactive=false のときは同意画面を出さず再取得を試みる。
async function requestToken(interactive) {
  const oauth2 = await waitForGis();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: res => {
        if (res.error) return reject(new Error(res.error_description || res.error));
        const t = { accessToken: res.access_token, expiresAt: Date.now() + Number(res.expires_in) * 1000 };
        tokenStore.save(t);
        resolve(t);
      },
      error_callback: err => reject(new Error(err.type === 'popup_closed' ? 'ログインがキャンセルされました' : (err.message || 'ログインに失敗しました'))),
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

// Calendar API 呼び出し。401 のときはトークンを取り直して1回だけ再試行する。
async function callApi(path, { method = 'GET', body } = {}, retry = true) {
  let token = tokenStore.load();
  if (!token) token = await requestToken(false).catch(() => requestToken(true));
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token.accessToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    tokenStore.clear();
    return callApi(path, { method, body }, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Google API エラー（${res.status}）`);
  return data;
}

// ---------- デモ用データ（?demo を付けて開くとログインなしで試せる） ----------
const demo = {
  calendars: [
    { id: 'demo-main', summary: 'デモ用カレンダー', backgroundColor: '#6d9eeb', primary: true },
    { id: 'demo-work', summary: '仕事（デモ）', backgroundColor: '#e06666' },
  ],
  busy(startDate, endDate) {
    const out = [];
    const days = C.listDays(startDate, endDate, [0, 1, 2, 3, 4, 5, 6]);
    days.forEach((d, i) => {
      const at = (t1, t2) => out.push({ start: C.parseLocal(d, t1), end: C.parseLocal(d, t2) });
      if (i % 3 === 0) at('10:00', '11:30');
      if (i % 2 === 1) at('13:00', '14:15');
      if (i % 4 === 2) at('09:00', '12:00');
      if (i % 5 === 4) at('15:30', '17:00');
      at('12:00', '12:45');
    });
    return out;
  },
};

// ---------- 小さな部品 ----------
const Icon = ({ d, size = 18 }) => h('svg', {
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
}, d.map((p, i) => h('path', { key: i, d: p })));
const ICONS = {
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  share: ['M12 3v12', 'M7 8l5-5 5 5', 'M5 13v7h14v-7'],
};

const Field = ({ label, hint, children, wide }) => h('label', { className: 'field' + (wide ? ' wide' : '') },
  h('span', { className: 'field-label' }, label, hint && h('span', { className: 'hint' }, hint)),
  children);

function Toast({ message }) {
  return h('div', { className: 'toast' + (message ? ' show' : ''), role: 'status', 'aria-live': 'polite' }, message);
}

// ---------- 本体 ----------
function App() {
  const today = C.toDateStr(new Date());
  const [isSignedIn, setIsSignedIn] = useState(IS_DEMO || !!tokenStore.load());
  const [calendars, setCalendars] = useState([]);
  const [selectedCalendars, setSelectedCalendars] = usePersistent('calendars', []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(C.addDays(today, 7));
  const [startTime, setStartTime] = usePersistent('startTime', '09:00');
  const [endTime, setEndTime] = usePersistent('endTime', '17:00');
  const [minDuration, setMinDuration] = usePersistent('minDuration', 60);
  const [bufferMin, setBufferMin] = usePersistent('bufferMin', 0);
  const [includedDays, setIncludedDays] = usePersistent('days', [1, 2, 3, 4, 5]);
  const [outputFormat, setOutputFormat] = usePersistent('format', 'range');
  const [header, setHeader] = usePersistent('header', DEFAULT_HEADER);
  const [breaks, setBreaks] = usePersistent('breaks', []); // [{start,end}] 毎日除外する時間帯
  const [perDayOn, setPerDayOn] = usePersistent('perDayOn', false);
  const [hoursByDay, setHoursByDay] = usePersistent('hoursByDay', {}); // {曜日番号: {start,end}}
  const [maxPerDay, setMaxPerDay] = usePersistent('maxPerDay', 0); // 0 = 制限なし
  const [pickBy, setPickBy] = usePersistent('pickBy', 'spread');
  const [busy, setBusy] = useState([]);
  const [freeTimes, setFreeTimes] = useState(null); // null = 未実行
  const [searched, setSearched] = useState(null); // 抽出時の条件（タイムライン表示用）
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUsageOpen, setIsUsageOpen] = useState(false);
  const [usageGuide, setUsageGuide] = useState(null);
  const [toast, setToast] = useState('');
  const resultRef = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  // 使い方ガイドは開いたときに読み込む（失敗してもメイン画面にエラーを出さない）
  useEffect(() => {
    if (!isUsageOpen || usageGuide) return;
    fetch('./usage-guide.json')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setUsageGuide)
      .catch(() => setUsageGuide({ title: '使い方ガイド', description: 'ガイドを読み込めませんでした。' }));
  }, [isUsageOpen, usageGuide]);

  // Esc でメニュー・ガイドを閉じる
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { setIsMenuOpen(false); setIsUsageOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ログイン後にカレンダー一覧を取得
  useEffect(() => {
    if (!isSignedIn) return;
    if (IS_DEMO) { applyCalendars(demo.calendars); return; }
    callApi('/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=250')
      .then(data => applyCalendars(data.items || []))
      .catch(e => { setError('カレンダーの取得に失敗しました: ' + e.message); });
  }, [isSignedIn]);

  function applyCalendars(items) {
    const list = items
      .filter(c => !c.hidden)
      .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    setCalendars(list);
    // 保存済みの選択のうち、今も存在するものだけ残す。無ければメインカレンダーを選ぶ
    setSelectedCalendars(prev => {
      const kept = prev.filter(id => list.some(c => c.id === id));
      if (kept.length) return kept;
      const primary = list.find(c => c.primary) || list[0];
      return primary ? [primary.id] : [];
    });
  }

  const handleSignIn = async () => {
    setError(null);
    try {
      await requestToken(true);
      setIsSignedIn(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSignOut = () => {
    const t = tokenStore.load();
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.accessToken, () => {});
    tokenStore.clear();
    setIsSignedIn(false);
    setCalendars([]);
    setFreeTimes(null);
    setBusy([]);
    setError(null);
    setIsMenuOpen(false);
    if (IS_DEMO) location.search = '';
  };

  const handleDayToggle = day => {
    setIncludedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b));
  };

  // 曜日ごとの時間帯。未設定の曜日は共通の時間帯を使う
  const hoursOf = dow => hoursByDay[dow] || { start: startTime, end: endTime };
  const setDayHours = (dow, key, value) => setHoursByDay(prev => ({ ...prev, [dow]: { ...hoursOf(dow), [key]: value } }));
  const effectiveHours = () => perDayOn
    ? Object.fromEntries(includedDays.map(d => [d, hoursOf(d)]))
    : null;

  const updateBreak = (i, key, value) => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, [key]: value } : b));
  const removeBreak = i => setBreaks(prev => prev.filter((_, j) => j !== i));
  const addBreak = (start = '12:00', end = '13:00') => setBreaks(prev => [...prev, { start, end }]);

  const toggleCalendar = id => {
    setSelectedCalendars(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // 期間のプリセット
  const setPreset = kind => {
    const d = new Date();
    const dow = d.getDay(); // 0=日
    if (kind === 'thisWeek') {
      setStartDate(today);
      setEndDate(C.addDays(today, (7 - dow) % 7)); // 今日〜日曜
    } else if (kind === 'nextWeek') {
      const nextMon = C.addDays(today, ((8 - dow) % 7) || 7);
      setStartDate(nextMon);
      setEndDate(C.addDays(nextMon, 6));
    } else {
      setStartDate(today);
      setEndDate(C.addDays(today, Number(kind)));
    }
  };

  const validate = () => {
    if (!startDate || !endDate) return '開始日と終了日を選択してください';
    if (endDate < startDate) return '終了日は開始日以降にしてください';
    if (C.listDays(startDate, endDate, [0, 1, 2, 3, 4, 5, 6]).length > MAX_DAYS + 1) return `期間は${MAX_DAYS}日以内にしてください`;
    if (endDate < today) return '期間がすべて過去になっています';
    if (perDayOn) {
      const bad = includedDays.find(d => hoursOf(d).end <= hoursOf(d).start);
      if (bad != null) return `${C.WEEKDAYS[bad]}曜日の終了時間は開始時間より後にしてください`;
    } else if (endTime <= startTime) return '終了時間は開始時間より後にしてください';
    if (breaks.some(b => !b.start || !b.end || b.end <= b.start)) return '除外する時間帯は、終わりを始まりより後にしてください';
    if (selectedCalendars.length === 0) return '少なくとも1つのカレンダーを選択してください';
    if (includedDays.length === 0) return '少なくとも1つの曜日を選択してください';
    return null;
  };

  const fetchFreeTimes = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setLoading(true);
    setError(null);
    try {
      const timeMin = C.parseLocal(startDate, '00:00');
      const timeMax = C.parseLocal(C.addDays(endDate, 1), '00:00');
      let busyList;
      if (IS_DEMO) {
        await new Promise(r => setTimeout(r, 400));
        busyList = demo.busy(startDate, endDate);
      } else {
        // freeBusy は複数カレンダーを1回で問い合わせられ、
        // 「予定なし（透過）」の予定や辞退した予定を自動で除外してくれる。上限50件。
        busyList = [];
        for (let i = 0; i < selectedCalendars.length; i += 50) {
          const data = await callApi('/freeBusy', {
            method: 'POST',
            body: {
              timeMin: timeMin.toISOString(),
              timeMax: timeMax.toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              items: selectedCalendars.slice(i, i + 50).map(id => ({ id })),
            },
          });
          for (const [id, cal] of Object.entries(data.calendars || {})) {
            if (cal.errors?.length) {
              const name = calendars.find(c => c.id === id)?.summary || id;
              throw new Error(`「${name}」を読み取れませんでした（${cal.errors[0].reason}）`);
            }
            for (const b of cal.busy || []) busyList.push({ start: new Date(b.start), end: new Date(b.end) });
          }
        }
      }
      const opts = {
        startDate, endDate, startTime, endTime, hoursByDay: effectiveHours(), breaks,
        includedDays, minDuration, bufferMin, now: new Date(),
      };
      setBusy(C.mergeIntervals(busyList));
      setFreeTimes(C.computeFreeIntervals(busyList, opts));
      setSearched(opts);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      console.error('ヒマ時間取得エラー:', e);
      setError('ヒマ時間の取得に失敗しました: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // 出力に使う最小時間は抽出したときの値（抽出後に設定を変えても結果とずれないように）
  const outMin = searched ? searched.minDuration : minDuration;
  const outputText = useMemo(
    () => freeTimes ? C.formatFreeTimes(freeTimes, { format: outputFormat, minDuration: outMin, maxPerDay, pickBy, header }) : '',
    [freeTimes, outputFormat, outMin, maxPerDay, pickBy, header]);
  // タイムラインで「リストに載せた時間」を塗るための候補一覧
  const listed = useMemo(
    () => freeTimes ? [...C.listCandidates(freeTimes, { format: outputFormat, minDuration: outMin, maxPerDay, pickBy }).values()].flat() : [],
    [freeTimes, outputFormat, outMin, maxPerDay, pickBy]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(outputText);
      showToast('コピーしました');
    } catch {
      setError('クリップボードへのコピーに失敗しました。テキストを選択してコピーしてください。');
    }
  };

  const shareText = async () => {
    try { await navigator.share({ text: outputText }); } catch { /* キャンセル時は何もしない */ }
  };

  // ---------- 描画 ----------
  const menu = h(React.Fragment, null,
    h('button', { className: 'icon-btn menu-btn', 'aria-label': 'メニュー', onClick: () => setIsMenuOpen(true) }, h(Icon, { d: ICONS.menu })),
    isMenuOpen && h('div', { className: 'backdrop', onClick: () => setIsMenuOpen(false) }),
    h('nav', { className: 'drawer' + (isMenuOpen ? ' open' : ''), 'aria-hidden': !isMenuOpen },
      h('button', { className: 'icon-btn drawer-close', 'aria-label': '閉じる', onClick: () => setIsMenuOpen(false) }, h(Icon, { d: ICONS.close })),
      h('button', { className: 'btn primary block', onClick: () => { setIsMenuOpen(false); setIsUsageOpen(true); } }, '使い方'),
      isSignedIn && h('button', { className: 'btn ghost block', onClick: handleSignOut }, IS_DEMO ? 'デモを終了' : 'ログアウト')));

  const settings = h('section', { className: 'card' },
    h('div', { className: 'presets' },
      h('span', { className: 'field-label' }, '期間'),
      [['thisWeek', '今週'], ['nextWeek', '来週'], ['13', '2週間'], ['29', '1か月']].map(([k, l]) =>
        h('button', { key: k, className: 'chip', onClick: () => setPreset(k) }, l))),
    h('div', { className: 'grid' },
      h(Field, { label: '開始日' }, h('input', { type: 'date', value: startDate, min: today, onChange: e => setStartDate(e.target.value) })),
      h(Field, { label: '終了日' }, h('input', { type: 'date', value: endDate, min: startDate, max: C.addDays(startDate, MAX_DAYS), onChange: e => setEndDate(e.target.value) })),
      h(Field, { label: '曜日', wide: true },
        h('div', { className: 'days' }, C.WEEKDAYS.map((day, i) => h('button', {
          key: i, type: 'button', 'aria-pressed': includedDays.includes(i),
          className: 'day' + (includedDays.includes(i) ? ' on' : '') + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''),
          onClick: () => handleDayToggle(i),
        }, day)))),
      h('div', { className: 'field wide' },
        h('div', { className: 'row-between' },
          h('span', { className: 'field-label' }, '時間帯', h('span', { className: 'hint' }, '候補にしてよい時間')),
          h('label', { className: 'switch' },
            h('input', { type: 'checkbox', checked: perDayOn, onChange: e => setPerDayOn(e.target.checked) }),
            h('span', null, '曜日ごとに設定'))),
        !perDayOn
          ? h(TimeRange, { start: startTime, end: endTime, onStart: setStartTime, onEnd: setEndTime })
          : includedDays.length === 0
            ? h('p', { className: 'muted small' }, '曜日を選ぶと、ここで曜日ごとの時間帯を設定できます。')
            : h('div', { className: 'stack' }, includedDays.map(d => h('div', { key: d, className: 'day-hours' },
              h('span', { className: 'day-name' + (d === 0 ? ' sun' : d === 6 ? ' sat' : '') }, C.WEEKDAYS[d]),
              h(TimeRange, { start: hoursOf(d).start, end: hoursOf(d).end,
                onStart: v => setDayHours(d, 'start', v), onEnd: v => setDayHours(d, 'end', v) }))))),
      h('div', { className: 'field wide' },
        h('span', { className: 'field-label' }, '除外する時間帯', h('span', { className: 'hint' }, '昼休みなど、毎日候補から外す時間')),
        breaks.length > 0 && h('div', { className: 'stack' }, breaks.map((b, i) => h('div', { key: i, className: 'day-hours' },
          h(TimeRange, { start: b.start, end: b.end, onStart: v => updateBreak(i, 'start', v), onEnd: v => updateBreak(i, 'end', v) }),
          h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'この時間帯を削除', onClick: () => removeBreak(i) }, h(Icon, { d: ICONS.close, size: 16 }))))),
        h('div', { className: 'presets tight' },
          !breaks.some(b => b.start === '12:00' && b.end === '13:00') &&
            h('button', { type: 'button', className: 'chip', onClick: () => addBreak('12:00', '13:00') }, '昼休み 12:00〜13:00 を追加'),
          h('button', { type: 'button', className: 'chip', onClick: () => addBreak('15:00', '15:30') }, '時間帯を追加'))),
      h(Field, { label: '最小ヒマ時間', hint: 'これより短い空きは出さない' },
        h('select', { value: minDuration, onChange: e => setMinDuration(Number(e.target.value)) },
          [30, 45, 60, 90, 120, 150, 180].map(v => h('option', { key: v, value: v }, `${v}分`)))),
      h(Field, { label: '予定の前後の余裕', hint: '移動や準備の時間' },
        h('select', { value: bufferMin, onChange: e => setBufferMin(Number(e.target.value)) },
          [0, 10, 15, 30, 60].map(v => h('option', { key: v, value: v }, v ? `${v}分` : 'なし')))),
      h(Field, { label: 'カレンダー', hint: '予定を確認するカレンダー', wide: true },
        calendars.length === 0
          ? h('p', { className: 'muted' }, '読み込み中...')
          : h('div', { className: 'cal-list' }, calendars.map(c => h('label', { key: c.id, className: 'cal-item' },
            h('input', { type: 'checkbox', checked: selectedCalendars.includes(c.id), onChange: () => toggleCalendar(c.id) }),
            h('span', { className: 'dot', style: { background: c.backgroundColor || '#888' } }),
            h('span', { className: 'cal-name' }, c.summaryOverride || c.summary, c.primary && h('span', { className: 'muted' }, '（メイン）'))))))));

  const result = freeTimes && h('section', { className: 'card fade-in', ref: resultRef },
    h('h2', null, 'ヒマ時間'),
    freeTimes.length === 0
      ? h('p', { className: 'empty' }, '条件に合うヒマ時間が見つかりませんでした。期間を広げるか、最小ヒマ時間を短くしてみてください。')
      : h(React.Fragment, null,
        h('div', { className: 'grid' },
          h(Field, { label: '出力形式' },
            h('select', { value: outputFormat, onChange: e => setOutputFormat(e.target.value) },
              h('option', { value: 'range' }, '時間範囲'),
              h('option', { value: 'slots' }, '開始時刻の候補（30分刻み）'))),
          h(Field, { label: '1日の候補数', hint: outputFormat === 'slots' ? '開始時刻の数' : '時間帯の数' },
            h('select', { value: maxPerDay, onChange: e => setMaxPerDay(Number(e.target.value)) },
              [0, 1, 2, 3, 4, 5].map(v => h('option', { key: v, value: v }, v ? `${v}件まで` : '制限なし')))),
          maxPerDay > 0 && h(Field, { label: '絞り方' },
            h('select', { value: pickBy, onChange: e => setPickBy(e.target.value) },
              h('option', { value: 'spread' }, '1日の中でばらけさせる'),
              h('option', { value: 'early' }, '早い時間を優先'),
              h('option', { value: 'long' }, '長い空きを優先'))),
          h(Field, { label: '前置き文', hint: '空欄で省略', wide: true },
            h('input', { type: 'text', value: header, placeholder: DEFAULT_HEADER, onChange: e => setHeader(e.target.value) }))),
        h('pre', { className: 'output' }, outputText),
        h('div', { className: 'actions' },
          h('button', { className: 'btn primary', onClick: copyToClipboard }, h(Icon, { d: ICONS.copy }), 'コピー'),
          navigator.share && h('button', { className: 'btn ghost', onClick: shareText }, h(Icon, { d: ICONS.share }), '共有'))),
    h('h2', { className: 'mt' }, 'スケジュール'),
    h(Timeline, { searched, busy, freeTimes, listed }));

  return h('div', { className: 'app' },
    menu,
    h('header', { className: 'hero' },
      h('h1', null, 'ヒマリスト'),
      h('p', { className: 'muted' }, '忙しい毎日に、ぴったりのヒマ時間を見つける'),
      IS_DEMO && h('p', { className: 'badge' }, 'デモモード（架空の予定で表示しています）')),
    error && h('div', { className: 'error', role: 'alert' },
      h('span', null, error),
      h('button', { className: 'icon-btn', 'aria-label': 'エラーを閉じる', onClick: () => setError(null) }, h(Icon, { d: ICONS.close, size: 16 }))),
    !isSignedIn
      ? h('div', { className: 'signin' },
        h('button', { className: 'btn primary', onClick: handleSignIn }, 'Googleでログイン'),
        h('p', { className: 'muted small' }, 'カレンダーは読み取りのみ。予定の内容は表示・送信しません。'),
        h('a', { className: 'link small', href: '?demo' }, 'ログインせずにデモで試す'))
      : h(React.Fragment, null,
        settings,
        h('button', { className: 'btn primary cta', onClick: fetchFreeTimes, disabled: loading },
          loading ? '読み込み中...' : 'ヒマ時間を抽出'),
        result),
    isUsageOpen && h(UsageModal, { guide: usageGuide, onClose: () => setIsUsageOpen(false) }),
    h(Toast, { message: toast }));
}

// 時間帯の入力（開始〜終了）
function TimeRange({ start, end, onStart, onEnd }) {
  return h('div', { className: 'time-range' },
    h('input', { type: 'time', value: start, step: 900, 'aria-label': '開始', onChange: e => onStart(e.target.value) }),
    h('span', { className: 'muted' }, '〜'),
    h('input', { type: 'time', value: end, step: 900, 'aria-label': '終了', onChange: e => onEnd(e.target.value) }));
}

// 30分刻みのタイムライン
function Timeline({ searched, busy, freeTimes, listed }) {
  if (!searched) return null;
  const days = C.listDays(searched.startDate, searched.endDate, searched.includedDays);
  const windows = Object.fromEntries(days.map(d => [d, C.dayWindow(searched, C.parseLocal(d).getDay())]));
  // 表示する行は、全対象日の時間帯をまとめた範囲（30分単位に広げる）
  const first = days.reduce((m, d) => windows[d].start < m ? windows[d].start : m, '23:59');
  const last = days.reduce((m, d) => windows[d].end > m ? windows[d].end : m, '00:00');
  const rows = [];
  const cur = C.parseLocal('2000-01-01', first);
  cur.setMinutes(cur.getMinutes() - (cur.getMinutes() % 30));
  const lastAt = C.parseLocal('2000-01-01', last);
  while (cur < lastAt && rows.length < 48) {
    rows.push(C.fmtTime(cur));
    cur.setMinutes(cur.getMinutes() + 30);
  }
  const now = searched.now;
  const breaks = searched.breaks || [];
  return h('div', { className: 'timeline-wrap' },
    h('table', { className: 'timeline' },
      h('thead', null, h('tr', null, h('th', null, ''), days.map(d => {
        const dow = C.parseLocal(d).getDay();
        return h('th', { key: d, className: dow === 0 ? 'sun' : dow === 6 ? 'sat' : '' }, C.fmtDate(C.parseLocal(d)));
      }))),
      h('tbody', null, rows.map((t, ri) => {
        const next = rows[ri + 1] || C.fmtTime(new Date(C.parseLocal('2000-01-01', t).getTime() + 30 * 60000));
        return h('tr', { key: t },
          h('th', null, t.endsWith(':00') ? t : ''),
          days.map(d => {
            const s = C.parseLocal(d, t), e = new Date(s.getTime() + 30 * 60000);
            const w = windows[d];
            const outside = e <= C.parseLocal(d, w.start) || s >= C.parseLocal(d, w.end);
            const inBreak = breaks.some(b => s < C.parseLocal(d, b.end) && e > C.parseLocal(d, b.start));
            let cls = 'short';
            if (e <= now) cls = 'past';
            else if (outside || inBreak) cls = 'off';
            else if (C.overlapsBusy(s, e, busy)) cls = 'busy';
            else if (listed.some(c => c.start < e && s < c.end)) cls = 'free';
            else if (C.isCoveredByFree(s, e, freeTimes)) cls = 'unlisted';
            return h('td', { key: d, className: cls, title: `${C.fmtDate(s)} ${t}〜${next}` });
          }));
      }))),
    h('div', { className: 'legend' },
      [['free', 'リストに掲載'], ['unlisted', '空き（候補から外した）'], ['short', '短い空き・余裕時間'],
        ['busy', '予定あり'], ['off', '対象外の時間'], ['past', '過去']].map(([c, l]) =>
        h('span', { key: c }, h('i', { className: c }), l))));
}

function UsageModal({ guide, onClose }) {
  const md = s => ({ __html: window.marked ? marked.parseInline(s) : s });
  const list = items => items?.length ? h('ul', null, items.map((s, i) => h('li', { key: i, dangerouslySetInnerHTML: md(s) }))) : null;
  return h('div', { className: 'modal-backdrop', onClick: onClose },
    h('div', { className: 'modal', role: 'dialog', 'aria-modal': true, onClick: e => e.stopPropagation() },
      h('button', { className: 'icon-btn modal-close', 'aria-label': '閉じる', onClick: onClose }, h(Icon, { d: ICONS.close })),
      !guide ? h('p', { className: 'muted' }, '読み込み中...') : h('div', { className: 'modal-body' },
        h('h2', null, guide.title),
        h('p', null, guide.description),
        guide.steps?.map(step => h('section', { key: step.number },
          h('h3', null, `${step.number}. ${step.title}`), list(step.instructions))),
        guide.tips && h('section', null, h('h3', null, guide.tips.title), list(guide.tips.items)),
        guide.cautions && h('section', null, h('h3', null, guide.cautions.title), list(guide.cautions.items)))));
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
