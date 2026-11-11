import test from 'node:test';
import assert from 'node:assert/strict';
import { move } from '../src/core/collide.js';
import { doorFrame } from '../src/core/layout.js';

const house = { wallT: 0.07, door: { w: 0.86, h: 2.04 } };
const room = { size: [4, 5, 2.5], doors: [{ id: 'e', wall: 'E', at: 1.2 }] };
const frames = [doorFrame(house, room, room.doors[0])];
const R = 0.25;

test('walls stop the player at their radius', () => {
  const p = move({ room, frames, open: [], colliders: [], r: R }, [3.5, 3], [2, 0]);
  assert.ok(Math.abs(p[0] - 3.75) < 1e-9);
  const q = move({ room, frames, open: [], colliders: [], r: R }, [0.5, 0.5], [-2, -2]);
  assert.deepEqual(q.map((v) => +v.toFixed(6)), [0.25, 0.25]);
});

test('an open door lets the player through, a closed one does not', () => {
  const closed = move({ room, frames, open: [], colliders: [], r: R }, [3.7, 1.2], [0.5, 0]);
  assert.ok(closed[0] <= 3.75 + 1e-9);
  const open = move({ room, frames, open: ['e'], colliders: [], r: R }, [3.7, 1.2], [0.5, 0]);
  assert.ok(open[0] > 4.05, `x=${open[0]}`);
});

test('inside the doorway the player is kept between the jambs', () => {
  const p = move({ room, frames, open: ['e'], colliders: [], r: R }, [3.95, 1.2], [0.05, 0.6]);
  assert.ok(p[1] < 1.2 + 0.43 - 0.15, `y=${p[1]}`);
});

test('furniture pushes the player out along the shallow axis', () => {
  const colliders = [[1, 1, 2, 2, 0.8]];
  const p = move({ room, frames, open: [], colliders, r: R }, [0.6, 1.5], [0.3, 0]);
  assert.ok(Math.abs(p[0] - 0.75) < 1e-9, `x=${p[0]}`);
  assert.ok(Math.abs(p[1] - 1.5) < 1e-9);
});

test('furniture in a corner never pushes the player through the wall', () => {
  const colliders = [[0.22, 0.22, 0.62, 0.62, 0.9]];
  const p = move({ room, frames, open: [], colliders, r: R }, [0.25, 0.25], [0, 0.02]);
  assert.ok(p[0] >= R - 1e-9 && p[1] >= R - 1e-9, `pos=${p}`);
});
