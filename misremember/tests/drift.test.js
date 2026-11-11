import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrift } from '../src/core/drift.js';

const run = (d, seconds, observed, anchored = () => false) => {
  const out = [];
  for (let t = 0; t < seconds; t += 0.1) out.push(...d.tick(0.1, observed, anchored));
  return out;
};

test('a queued change never lands while the slot is watched', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 4 });
  d.queue('chairs', 5);
  assert.deepEqual(run(d, 10, () => true), []);
  assert.equal(d.get('chairs'), 4);
});

test('it lands once the slot has gone unwatched for long enough', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 4 });
  run(d, 1, () => true);
  d.queue('chairs', 5, { unseen: 1.5 });
  assert.deepEqual(run(d, 1, () => false), []);
  const changes = run(d, 1, () => false);
  assert.deepEqual(changes, [{ id: 'chairs', room: 'kitchen', from: 4, to: 5 }]);
});

test('each new state must be witnessed before the next one lands', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 4 });
  run(d, 1, () => true);
  d.queue('chairs', 5); d.queue('chairs', 6);
  run(d, 10, () => false);
  assert.equal(d.get('chairs'), 5);
  run(d, 1, () => true);
  run(d, 5, () => false);
  assert.equal(d.get('chairs'), 6);
});

test('an anchored room goes back to the truth while unwatched and ignores the queue', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 4 });
  run(d, 1, () => true);
  d.queue('chairs', 5);
  run(d, 5, () => false);
  run(d, 1, () => true);
  d.queue('chairs', 9);
  const changes = run(d, 5, () => false, (room) => room === 'kitchen');
  assert.deepEqual(changes, [{ id: 'chairs', room: 'kitchen', from: 5, to: 4 }]);
  run(d, 1, () => true);
  run(d, 5, () => false, (room) => room === 'kitchen');
  assert.equal(d.get('chairs'), 4);
});

test('a permanent change survives an anchor', () => {
  const d = createDrift();
  d.add({ id: 'plate', room: 'kitchen', value: 'dinner' });
  d.set('plate', 'empty', { permanent: true });
  run(d, 5, () => false, () => true);
  assert.equal(d.get('plate'), 'empty');
});

test('holding still because it could be seen is not the same as being witnessed', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 4 });
  for (let t = 0; t < 1; t += 0.1) d.tick(0.1, () => true);
  d.queue('chairs', 5); d.queue('chairs', 6);
  for (let t = 0; t < 5; t += 0.1) d.tick(0.1, () => false);
  for (let t = 0; t < 2; t += 0.1) d.tick(0.1, () => true, () => false, () => false); // room drawn, back turned
  for (let t = 0; t < 5; t += 0.1) d.tick(0.1, () => false);
  assert.equal(d.get('chairs'), 5);
});

test('clearAll drops everything still queued', () => {
  const d = createDrift();
  d.add({ id: 'chairs', room: 'kitchen', value: 5 });
  d.queue('chairs', 7);
  d.clearAll();
  run(d, 5, () => false);
  assert.equal(d.get('chairs'), 5);
});
