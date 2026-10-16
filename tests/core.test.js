// 実行: TZ=Asia/Tokyo node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const base = {
  startDate: '2026-10-19', endDate: '2026-10-19', // 月曜
  startTime: '09:00', endTime: '17:00', includedDays: [1, 2, 3, 4, 5], minDuration: 60,
};
const ev = (s, e) => ({ start: new Date(s), end: new Date(e) });
const fmt = list => list.map(i => `${C.toDateStr(i.start)} ${C.fmtTime(i.start)}-${C.fmtTime(i.end)}`);

test('予定の隙間を正しく抜き出す（旧版は枠の刻みで隙間を取りこぼしていた）', () => {
  const busy = [ev('2026-10-19T09:00:00+09:00', '2026-10-19T09:30:00+09:00'),
                ev('2026-10-19T13:00:00+09:00', '2026-10-19T14:15:00+09:00')];
  assert.deepEqual(fmt(C.computeFreeIntervals(busy, base)),
    ['2026-10-19 09:30-13:00', '2026-10-19 14:15-17:00']);
});

test('最小時間未満の隙間は出さない', () => {
  const busy = [ev('2026-10-19T09:00:00+09:00', '2026-10-19T10:00:00+09:00'),
                ev('2026-10-19T10:45:00+09:00', '2026-10-19T17:00:00+09:00')];
  assert.deepEqual(C.computeFreeIntervals(busy, base), []);
});

test('重なった予定・複数カレンダーを結合する', () => {
  const busy = [ev('2026-10-19T10:00:00+09:00', '2026-10-19T12:00:00+09:00'),
                ev('2026-10-19T11:00:00+09:00', '2026-10-19T12:30:00+09:00')];
  assert.deepEqual(fmt(C.computeFreeIntervals(busy, base)),
    ['2026-10-19 09:00-10:00', '2026-10-19 12:30-17:00']);
});

test('前後のバッファを確保する', () => {
  const busy = [ev('2026-10-19T12:00:00+09:00', '2026-10-19T13:00:00+09:00')];
  assert.deepEqual(fmt(C.computeFreeIntervals(busy, { ...base, bufferMin: 15 })),
    ['2026-10-19 09:00-11:45', '2026-10-19 13:15-17:00']);
});

test('現在時刻より前は除外し、開始を15分単位に切り上げる', () => {
  const now = new Date('2026-10-19T10:07:00+09:00');
  assert.deepEqual(fmt(C.computeFreeIntervals([], { ...base, now })), ['2026-10-19 10:15-17:00']);
});

test('対象外の曜日は飛ばし、日付はローカル基準で扱う', () => {
  const r = C.computeFreeIntervals([], { ...base, startDate: '2026-10-17', endDate: '2026-10-20' });
  assert.deepEqual(fmt(r), ['2026-10-19 09:00-17:00', '2026-10-20 09:00-17:00']);
  assert.equal(C.toDateStr(new Date(2026, 9, 20, 0, 30)), '2026-10-20'); // 0:30 でも前日にならない
});

test('数日にまたがる予定（休暇など）でその日を丸ごと埋める', () => {
  const busy = [ev('2026-10-19T00:00:00+09:00', '2026-10-21T00:00:00+09:00')];
  const r = C.computeFreeIntervals(busy, { ...base, endDate: '2026-10-21' });
  assert.deepEqual(fmt(r), ['2026-10-21 09:00-17:00']);
});

test('テキスト整形（時間範囲）', () => {
  const r = C.computeFreeIntervals([ev('2026-10-19T12:00:00+09:00', '2026-10-19T13:00:00+09:00')], base);
  assert.equal(C.formatFreeTimes(r, { header: 'ご都合いかがでしょうか。' }),
    'ご都合いかがでしょうか。\n\n・10/19(月) 09:00〜12:00 / 13:00〜17:00');
});

test('テキスト整形（開始時刻候補）は最小時間が収まる開始時刻だけを出す', () => {
  const r = [{ start: new Date('2026-10-19T09:00:00+09:00'), end: new Date('2026-10-19T10:30:00+09:00') }];
  assert.equal(C.formatFreeTimes(r, { format: 'slots', minDuration: 60 }),
    '・10/19(月) 09:00、09:30\n\n※開始時刻の候補です（各60分）');
});

test('昼休みなどの除外時間帯は毎日差し引き、予定の余裕は付けない', () => {
  const busy = [ev('2026-10-19T13:00:00+09:00', '2026-10-19T14:00:00+09:00')];
  const r = C.computeFreeIntervals(busy, { ...base, endDate: '2026-10-20', bufferMin: 15,
    breaks: [{ start: '12:00', end: '13:00' }] });
  assert.deepEqual(fmt(r), ['2026-10-19 09:00-12:00', '2026-10-19 14:15-17:00',
    '2026-10-20 09:00-12:00', '2026-10-20 13:00-17:00']);
});

test('曜日ごとの時間帯を使い、設定のない曜日は共通の時間帯になる', () => {
  const r = C.computeFreeIntervals([], { ...base, endDate: '2026-10-21',
    hoursByDay: { 1: { start: '10:00', end: '12:00' }, 3: { start: '13:00', end: '19:00' } } });
  assert.deepEqual(fmt(r), ['2026-10-19 10:00-12:00', '2026-10-20 09:00-17:00', '2026-10-21 13:00-19:00']);
});

test('1日の候補数を絞る（時間範囲）', () => {
  const iv = (s, e) => ({ start: new Date(`2026-10-19T${s}:00+09:00`), end: new Date(`2026-10-19T${e}:00+09:00`) });
  const list = [iv('09:00', '10:00'), iv('11:00', '14:00'), iv('15:00', '17:00')];
  const line = (by) => C.formatFreeTimes(list, { maxPerDay: 2, pickBy: by });
  assert.equal(line('early'), '・10/19(月) 09:00〜10:00 / 11:00〜14:00');
  assert.equal(line('long'), '・10/19(月) 11:00〜14:00 / 15:00〜17:00'); // 長い順に選び、時刻順で表示
  assert.equal(line('spread'), '・10/19(月) 09:00〜10:00 / 15:00〜17:00');
});

test('1日の候補数を絞る（開始時刻の候補）はばらけさせられる', () => {
  const list = [{ start: new Date('2026-10-19T09:00:00+09:00'), end: new Date('2026-10-19T17:00:00+09:00') }];
  assert.equal(C.formatFreeTimes(list, { format: 'slots', minDuration: 60, maxPerDay: 3, pickBy: 'spread' }),
    '・10/19(月) 09:00、12:30、16:00\n\n※開始時刻の候補です（各60分）');
});

// ---------- 予定を固める ----------
const cand = map => [...map.values()].flat().map(i => `${C.toDateStr(i.start)} ${C.fmtTime(i.start)}-${C.fmtTime(i.end)}`);

test('空き区間に「直前・直後が予定か」の印が付く（昼休みや時間帯の端は予定と数えない）', () => {
  const busy = [ev('2026-10-19T10:00:00+09:00', '2026-10-19T11:00:00+09:00')];
  const r = C.computeFreeIntervals(busy, { ...base, breaks: [{ start: '12:00', end: '13:00' }] });
  assert.deepEqual(r.map(i => [C.fmtTime(i.start), i.afterEvent, i.beforeEvent]),
    [['09:00', false, true], ['11:00', true, false], ['13:00', false, false]]);
});

test('昼休みに接した予定は、予定側の端だけを予定として扱う', () => {
  const busy = [ev('2026-10-19T13:00:00+09:00', '2026-10-19T14:00:00+09:00')];
  const r = C.computeFreeIntervals(busy, { ...base, breaks: [{ start: '12:00', end: '13:00' }] });
  assert.deepEqual(r.map(i => [C.fmtTime(i.start), i.afterEvent, i.beforeEvent]),
    [['09:00', false, false], ['14:00', true, false]]);
});

test('固める：候補を予定の直前・直後に寄せ、予定の間の隙間を最優先にする', () => {
  const busy = [ev('2026-10-19T10:00:00+09:00', '2026-10-19T11:00:00+09:00'),
                ev('2026-10-19T12:30:00+09:00', '2026-10-19T13:00:00+09:00')];
  const free = C.computeFreeIntervals(busy, base);
  assert.deepEqual(cand(C.listCandidates(free, { cluster: true, minDuration: 60 })),
    ['2026-10-19 09:00-10:00', '2026-10-19 11:00-12:30', '2026-10-19 13:00-14:00']);
  // 1件だけなら予定の間（11:00-12:30）が選ばれる
  assert.deepEqual(cand(C.listCandidates(free, { cluster: true, minDuration: 60, maxPerDay: 1 })),
    ['2026-10-19 11:00-12:30']);
});

test('固める：予定がある日を優先し、予定のない日は後回しにする', () => {
  const busy = [ev('2026-10-20T10:00:00+09:00', '2026-10-20T11:00:00+09:00')];
  const free = C.computeFreeIntervals(busy, { ...base, endDate: '2026-10-21' });
  const opt = { cluster: true, minDuration: 60, maxTotal: 2 };
  assert.deepEqual(cand(C.listCandidates(free, opt)),
    ['2026-10-20 09:00-10:00', '2026-10-20 11:00-12:00']);
  // 予定がある日の優先を切ると、予定に接した枠（点数1）の次は早い日になる
  assert.deepEqual(cand(C.listCandidates(free, { ...opt, maxTotal: 3, preferBusyDays: false })),
    ['2026-10-19 09:00-10:00', '2026-10-20 09:00-10:00', '2026-10-20 11:00-12:00']);
});

test('全体の候補数（固めない場合は早い順）', () => {
  const free = C.computeFreeIntervals([], { ...base, endDate: '2026-10-21' });
  assert.deepEqual(cand(C.listCandidates(free, { maxTotal: 2 })),
    ['2026-10-19 09:00-17:00', '2026-10-20 09:00-17:00']);
});

// ---------- 予定モード ----------
const evs = [
  { start: new Date('2026-10-19T10:00:00+09:00'), end: new Date('2026-10-19T11:30:00+09:00'), allDay: false, summary: '定例会議', calendarId: 'work' },
  { start: new Date('2026-10-19T11:00:00+09:00'), end: new Date('2026-10-19T12:00:00+09:00'), allDay: false, summary: '歯医者', calendarId: 'me' },
  { start: new Date('2026-10-19T16:00:00+09:00'), end: new Date('2026-10-19T16:15:00+09:00'), allDay: false, summary: '電話', calendarId: 'work' },
  { start: new Date('2026-10-19T19:00:00+09:00'), end: new Date('2026-10-19T20:00:00+09:00'), allDay: false, summary: '夜の会議', calendarId: 'work' },
  { start: new Date(2026, 9, 20), end: new Date(2026, 9, 21), allDay: true, summary: '有給', calendarId: 'me' },
];
const bo = { ...base, endDate: '2026-10-21' };

test('予定の絞り込み：時間帯の外は除き、予定のない日も残す', () => {
  const r = C.filterEvents(evs, bo);
  assert.deepEqual([...r.keys()], ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.deepEqual(r.get('2026-10-19').map(e => e.summary), ['定例会議', '歯医者', '電話']);
  assert.deepEqual(r.get('2026-10-20').map(e => e.summary), ['有給']);
  assert.equal(r.get('2026-10-21').length, 0);
});

test('予定の絞り込み：長さ・終日・キーワード', () => {
  const names = o => [...C.filterEvents(evs, { ...bo, ...o }).values()].flat().map(e => e.summary);
  assert.deepEqual(names({ minLength: 30 }), ['定例会議', '歯医者', '有給']);
  assert.deepEqual(names({ excludeAllDay: true }), ['定例会議', '歯医者', '電話']);
  assert.deepEqual(names({ include: '会議 電話' }), ['定例会議', '電話']);
  assert.deepEqual(names({ exclude: '歯医者' }), ['定例会議', '電話', '有給']);
});

test('埋まっている時間の整形：予定名なしは重なりを結合、ありは1件ずつ', () => {
  const byDay = C.filterEvents(evs, bo);
  assert.equal(C.formatBusy(byDay),
    '・10/19(月) 10:00〜12:00 / 16:00〜16:15\n・10/20(火) 終日\n・10/21(水) 予定なし');
  assert.equal(C.formatBusy(byDay, { showTitles: true }).split('\n')[0],
    '・10/19(月) 10:00〜11:30 定例会議 / 11:00〜12:00 歯医者 / 16:00〜16:15 電話');
});

test('埋まっている時間の整形：カレンダー別', () => {
  const byDay = C.filterEvents(evs, { ...bo, endDate: '2026-10-19' });
  assert.equal(C.formatBusy(byDay, { calendars: [{ id: 'work', name: '仕事' }, { id: 'me', name: '個人' }] }),
    '【仕事】\n・10/19(月) 10:00〜11:30 / 16:00〜16:15\n\n【個人】\n・10/19(月) 11:00〜12:00');
});

test('埋まっている時間の整形：AI向けは前提・埋まっている時間・依頼を並べる', () => {
  const byDay = C.filterEvents(evs, { ...bo, endDate: '2026-10-19' });
  const text = C.formatBusy(byDay, {
    format: 'ai', request: '空き時間の候補を作ってください。',
    context: { ...bo, endDate: '2026-10-19', timeZone: 'Asia/Tokyo', minDuration: 60,
      hoursByDay: { 5: { start: '13:00', end: '17:00' } }, breaks: [{ start: '12:00', end: '13:00' }] },
  });
  assert.equal(text, [
    '## 前提',
    '- タイムゾーン: Asia/Tokyo',
    '- 期間: 10/19(月)〜10/19(月)',
    '- 対象の曜日: 月・火・水・木・金',
    '- 候補にしてよい時間帯: 月 09:00〜17:00、火 09:00〜17:00、水 09:00〜17:00、木 09:00〜17:00、金 13:00〜17:00',
    '- 毎日除外する時間帯: 12:00〜13:00',
    '- 1件あたりの所要時間: 60分',
    '',
    '## 埋まっている時間',
    '・10/19(月) 10:00〜12:00 / 16:00〜16:15',
    '',
    '## 依頼',
    '空き時間の候補を作ってください。',
  ].join('\n'));
});
