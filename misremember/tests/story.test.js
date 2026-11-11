import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, advance } from '../src/core/story.js';

const play = (events) => {
  let s = initial();
  const all = [];
  for (const ev of events) { const r = advance(s, ev); s = r.state; all.push(...r.effects); }
  return { s, all };
};
const has = (all, type, extra = {}) => all.some((e) => e.type === type && Object.entries(extra).every(([k, v]) => e[k] === v));

test('saying no to dinner makes the Host try again with something worse', () => {
  const { s, all } = play([{ type: 'answer', note: 'dinner', value: 'no' }]);
  assert.ok(has(all, 'drift', { id: 'kitchen.plate', value: 'wrong' }));
  assert.equal(s.dinner, 'asked-again');
});

test('eating starts the kitchen drifting and sends the player to bed', () => {
  const { s, all } = play([{ type: 'answer', note: 'dinner', value: 'yes' }, { type: 'eat' }]);
  assert.equal(s.ate, true);
  assert.ok(has(all, 'drift', { id: 'kitchen.chairs', value: 5 }));
  assert.ok(has(all, 'drift', { id: 'kitchen.clock', value: 13 }));
  assert.ok(has(all, 'note', { id: 'behind', show: true }));
});

test('the bedroom door only appears after the note at the end of the hall is read', () => {
  const before = play([{ type: 'eat' }]);
  assert.ok(!has(before.all, 'unveil'));
  const after = play([{ type: 'eat' }, { type: 'read', note: 'behind' }]);
  assert.ok(has(after.all, 'unveil', { room: 'hall', door: 'bed' }));
  const twice = play([{ type: 'eat' }, { type: 'read', note: 'behind' }, { type: 'read', note: 'behind' }]);
  assert.equal(twice.all.filter((e) => e.type === 'unveil').length, 1);
});

test('reading the note before dinner does nothing', () => {
  assert.ok(!has(play([{ type: 'read', note: 'behind' }]).all, 'unveil'));
});

test('the watch anchors the kitchen and changes the ending', () => {
  const { s, all } = play([{ type: 'eat' }, { type: 'pickup', item: 'watch' }, { type: 'place', item: 'watch', room: 'kitchen' }, { type: 'sleep' }]);
  assert.ok(has(all, 'anchor', { room: 'kitchen' }));
  assert.ok(has(all, 'night', { evening: 2, watch: 'placed' }));
  assert.equal(s.carrying, null);
  assert.equal(s.evening, 2);
});

test('sleep is refused before dinner', () => {
  const { all } = play([{ type: 'sleep' }]);
  assert.ok(!has(all, 'night'));
  assert.ok(has(all, 'say'));
});

// ---------------------------------------------------------------- evening 2
const night = [{ type: 'eat' }, { type: 'sleep' }, { type: 'wake' }];

test('evening two wakes to a table set for six and asks for the count', () => {
  const { all } = play(night);
  assert.ok(has(all, 'set', { id: 'kitchen.chairs', value: 6 }));
  assert.ok(has(all, 'set', { id: 'kitchen.clock', value: 14 }));
  assert.ok(all.some((e) => e.type === 'note' && e.id === 'count' && e.ask));
});

test('a placed watch keeps the clock honest on the second evening', () => {
  const { all } = play([{ type: 'eat' }, { type: 'pickup', item: 'watch' }, { type: 'place', item: 'watch', room: 'kitchen' }, { type: 'sleep' }, { type: 'wake' }]);
  assert.ok(!has(all, 'set', { id: 'kitchen.clock' }));
});

test('the first answer starts a recount and gives away the pantry', () => {
  const { s, all } = play([...night, { type: 'answer', note: 'count', value: 'yes' }]);
  assert.ok(has(all, 'drift', { id: 'kitchen.chairs', value: 7 }));
  assert.ok(has(all, 'pantry'));
  assert.equal(s.answers, 1);
  const no = play([...night, { type: 'answer', note: 'count', value: 'no' }]);
  assert.ok(has(no.all, 'drift', { id: 'kitchen.chairs', value: 5 }));
});

test('every recount that lands asks again, until the rings settle it at three', () => {
  const a = play([...night, { type: 'answer', note: 'count', value: 'yes' }, { type: 'drifted', id: 'kitchen.chairs', value: 7 }]);
  assert.equal(a.s.count, 7);
  assert.ok(a.all.some((e) => e.type === 'note' && e.id === 'count' && e.ask && e.text.includes('SEVEN')));
  const b = play([...night, { type: 'answer', note: 'count', value: 'yes' }, { type: 'pickup', item: 'rings' }, { type: 'place', item: 'rings', room: 'kitchen' },
    { type: 'drifted', id: 'kitchen.chairs', value: 3 }, { type: 'drifted', id: 'kitchen.photo', value: 4 }, { type: 'sleep' }]);
  assert.ok(has(b.all, 'truth', { id: 'kitchen.chairs', value: 3 }));
  assert.ok(has(b.all, 'note', { id: 'her', show: true }));
  assert.ok(has(b.all, 'end', { evening: 2, anchored: true }));
  assert.ok(!b.all.slice(-4).some((e) => e.type === 'note' && e.id === 'count' && e.ask));
});

test('evening two cannot be slept through before the table is counted', () => {
  const { all } = play([...night, { type: 'sleep' }]);
  assert.ok(!has(all, 'end'));
});
