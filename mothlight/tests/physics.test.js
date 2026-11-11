import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPlayer, PLAYER } from '../src/physics.js';

const box = { minX: 5, maxX: 15, minZ: -5, maxZ: 5, y0: 0, y1: 10 };
const query = () => [box];
const body = (o) => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, ...o });

function run(p, seconds, gravity = true) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (gravity) p.vy -= 22 * dt;
    stepPlayer(p, dt, query);
  }
  return p;
}

test('rests on the ground plane', () => {
  const p = run(body({ y: 3 }), 2);
  assert.equal(p.y, 0);
  assert.equal(p.onGround, true);
});

test('a wall stops horizontal motion', () => {
  const p = body({ vx: 8 });
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) { p.vx = 8; p.vy -= 22 * dt; stepPlayer(p, dt, query); }
  assert.ok(p.x <= box.minX - PLAYER.r + 1e-6, `x=${p.x}`);
  assert.ok(p.x > box.minX - PLAYER.r - 0.05);
});

test('lands on a roof and stays there', () => {
  const p = run(body({ x: 10, y: 14 }), 2);
  assert.equal(p.y, 10);
  assert.equal(p.onGround, true);
});

test('walking off a roof falls to the street', () => {
  const p = body({ x: 6, y: 10 });
  const dt = 1 / 60;
  for (let i = 0; i < 240; i++) { p.vx = -4; p.vy -= 22 * dt; stepPlayer(p, dt, query); }
  assert.equal(p.y, 0);
  assert.ok(p.x < box.minX);
});

test('head bumps the underside of an overhang', () => {
  const slab = { minX: -5, maxX: 5, minZ: -5, maxZ: 5, y0: 3, y1: 4 };
  const p = body({ vy: 12 });
  const dt = 1 / 60;
  for (let i = 0; i < 20; i++) stepPlayer(p, dt, () => [slab]);
  assert.ok(p.y + PLAYER.h <= slab.y0 + 1e-6);
  assert.equal(p.vy, 0);
});

test('a body that starts inside a box leaves by the nearest side', () => {
  const dt = 1 / 60;
  const west = stepPlayer(body({ x: 5.3 }), dt, query);
  assert.ok(west.x < box.minX, `expected west exit, got x=${west.x}`);
  const east = stepPlayer(body({ x: 14.7 }), dt, query);
  assert.ok(east.x > box.maxX, `expected east exit, got x=${east.x}`);
  const north = stepPlayer(body({ x: 10, z: -4.8 }), dt, query);
  assert.ok(north.z < box.minZ || north.x < box.minX || north.x > box.maxX);
});
