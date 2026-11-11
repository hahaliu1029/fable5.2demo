import test from 'node:test';
import assert from 'node:assert/strict';
import { createGesture } from '../src/core/gaze.js';
import { inView } from '../src/core/observe.js';

const swing = (g, axis, t0, n = 4, amp = 90, step = 0.12) => {
  let out = null;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 6; k++) {
      const d = ((i % 2 ? -1 : 1) * amp) / 6;
      out = g.feed(axis === 'x' ? d : 0, axis === 'y' ? d : 0, t0 + i * step + (k * step) / 6) || out;
    }
  }
  return out;
};

test('up-down swings read as a nod', () => { assert.equal(swing(createGesture(), 'y', 0), 'yes'); });
test('left-right swings read as a shake', () => { assert.equal(swing(createGesture(), 'x', 0), 'no'); });
test('slow looking around is not an answer', () => {
  const g = createGesture();
  assert.equal(swing(g, 'x', 0, 4, 90, 1.0), null);
});
test('one sweep is not an answer', () => { assert.equal(swing(createGesture(), 'y', 0, 1), null); });

test('inView: in front, behind, and off to the side', () => {
  const cam = { pos: [0, 0, 1.6], fwd: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1], tanH: Math.tan(0.7), tanV: Math.tan(0.45) };
  assert.equal(inView(cam, [0, 3, 1.6], 0.1), true);
  assert.equal(inView(cam, [0, -3, 1.6], 0.1), false);
  assert.equal(inView(cam, [6, 3, 1.6], 0.1), false);
  assert.equal(inView(cam, [2.6, 3, 1.6], 0.3), true);
});
