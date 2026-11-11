import test from 'node:test';
import assert from 'node:assert/strict';
import { doorFrame, attach, applyT, invertT, crossed } from '../src/core/layout.js';

const house = { wallT: 0.07, door: { w: 0.86, h: 2.04 } };
const hall = { size: [1.8, 7.4, 2.5], doors: [{ id: 'k', wall: 'W', at: 2.3 }, { id: 'b', wall: 'E', at: 4.2 }] };
const kitchen = { size: [4.4, 5.0, 2.5], doors: [{ id: 'h', wall: 'E', at: 1.2 }] };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('door frame sits on the outer wall plane and points outward', () => {
  const f = doorFrame(house, hall, hall.doors[0]);
  near(f.p[0], -0.07); near(f.p[1], 2.3);
  assert.deepEqual(f.n, [-1, 0]);
  near(f.s0, 2.3 - 0.43);
  const g = doorFrame(house, hall, hall.doors[1]);
  near(g.p[0], 1.87); assert.deepEqual(g.n, [1, 0]);
});

test('attach maps the other door onto this one, facing the opposite way', () => {
  const a = doorFrame(house, hall, hall.doors[0]);
  const b = doorFrame(house, kitchen, kitchen.doors[0]);
  const t = attach(a, b);
  const p = applyT(t, b.p);
  near(p[0], a.p[0]); near(p[1], a.p[1]);
  // a point one metre inside the kitchen lands one metre outside the hall's west wall
  const q = applyT(t, [b.p[0] - 1.07, b.p[1]]);
  near(q[0], -1.14); near(q[1], 2.3);
});

test('attach handles doors on perpendicular walls', () => {
  const south = { size: [3, 3, 2.5], doors: [{ id: 's', wall: 'S', at: 1 }] };
  const a = doorFrame(house, hall, hall.doors[1]);
  const b = doorFrame(house, south, south.doors[0]);
  const t = attach(a, b);
  const inside = applyT(t, [1, 1]); // inside the south room, 1.07 m behind its door plane
  near(inside[0], a.p[0] + 1.07, 1e-9); near(inside[1], a.p[1], 1e-9);
});

test('invertT undoes applyT', () => {
  const t = { rot: 1.1, tx: 3, ty: -2 };
  const p = applyT(invertT(t), applyT(t, [0.4, 5]));
  near(p[0], 0.4); near(p[1], 5);
});

test('crossed fires only when moving outward through the opening', () => {
  const f = doorFrame(house, hall, hall.doors[1]);
  assert.equal(crossed(f, [1.8, 4.2], [1.9, 4.2]), true);
  assert.equal(crossed(f, [1.9, 4.2], [1.8, 4.2]), false);
  assert.equal(crossed(f, [1.8, 6.0], [1.9, 6.0]), false);
  assert.equal(crossed(f, [1.5, 4.2], [1.6, 4.2]), false);
});
