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
