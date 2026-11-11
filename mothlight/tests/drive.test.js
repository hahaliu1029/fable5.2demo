import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, buildIndex, BOUND, DISTRICTS } from '../src/city.js';
import { mulberry32 } from '../src/rng.js';
import { CAR, ROADS, newCar, stepCar, makeRoute, crossesGate, makeTraffic, trafficAt } from '../src/drive.js';

const city = generateCity(9);
const query = buildIndex(city.colliders);
const open = () => [];
const run = (c, input, seconds, q = open) => { let last; for (let i = 0; i < seconds * 60; i++) last = stepCar(c, { throttle: 0, steer: 0, handbrake: false, boost: false, ...input }, 1 / 60, q); return last; };
const inside = (x, z, pad = 0) => city.colliders.some((b) => b.y0 < 1.4 && b.y1 > 0.15 && x + pad > b.minX && x - pad < b.maxX && z + pad > b.minZ && z - pad < b.maxZ);

test('the car accelerates to a cruising speed, boost goes faster and drains', () => {
  const c = newCar(0, 340, 0);
  run(c, { throttle: 1 }, 6);
  assert.ok(c.speed > CAR.maxSpeed * 0.85 && c.speed <= CAR.maxSpeed, `cruise ${c.speed}`);
  assert.ok(c.z < 190, 'yaw 0 drives toward -Z');
  run(c, { throttle: 1, boost: true }, 2);
  assert.ok(c.speed > CAR.maxSpeed + 4 && c.speed <= CAR.boostSpeed, `boost ${c.speed}`);
  assert.ok(c.boost < 0.5);
  run(c, { throttle: 1, boost: true }, 2.5);
  assert.ok(c.boost < 0.05, 'the tank runs dry');
});

test('braking stops the car, then it reverses slowly', () => {
  const c = newCar(0, 0, 0);
  run(c, { throttle: 1 }, 4);
  run(c, { throttle: -1 }, 2);
  const fwd = c.vx * -Math.sin(c.yaw) + c.vz * -Math.cos(c.yaw);
  assert.ok(fwd < 1 && fwd > -CAR.reverse - 1, `after braking ${fwd}`);
});

test('steering turns the car, and the handbrake makes it slide', () => {
  const a = newCar(0, 0, 0), b = newCar(0, 0, 0);
  run(a, { throttle: 1 }, 3); run(b, { throttle: 1 }, 3);
  const ra = run(a, { throttle: 1, steer: 1 }, 0.6), rb = run(b, { throttle: 1, steer: 1, handbrake: true }, 0.6);
  assert.ok(a.yaw > 0.3, 'positive steer turns left (yaw increases)');
  assert.ok(Math.abs(rb.slip) > Math.abs(ra.slip) * 1.5, `handbrake slip ${rb.slip} vs ${ra.slip}`);
  const tank = b.boost; run(b, { throttle: 1, steer: -1, handbrake: true }, 1);
  assert.ok(b.boost >= tank, 'drifting never drains the boost');
});

test('a wall stops the car and reports the impact', () => {
  const wall = { minX: -50, maxX: 50, minZ: -32, maxZ: -30, y0: 0, y1: 20 };
  const c = newCar(0, 0, 0);
  let worst = 0;
  for (let i = 0; i < 300; i++) worst = Math.max(worst, stepCar(c, { throttle: 1, steer: 0, handbrake: false, boost: false }, 1 / 60, () => [wall]).hit);
  assert.ok(worst > 10, `impact ${worst}`);
  assert.ok(c.z >= -30 + CAR.r + CAR.half - 0.05, 'the nose, not just the middle, stops at the wall');
});

test('driving wildly through the real city never ends inside a building or off the island', () => {
  const rnd = mulberry32(3);
  const route = makeRoute();
  const c = newCar(route.start.x, route.start.z, route.start.yaw);
  let input = { throttle: 1, steer: 0, handbrake: false, boost: false };
  for (let i = 0; i < 60 * 240; i++) {
    if (i % 45 === 0) input = { throttle: rnd() < 0.85 ? 1 : -1, steer: Math.round(rnd() * 2 - 1), handbrake: rnd() < 0.2, boost: rnd() < 0.3 };
    stepCar(c, input, 1 / 60, query);
    assert.ok(Math.abs(c.x) <= BOUND + 1e-6 && Math.abs(c.z) <= BOUND + 1e-6);
    if (i % 20 === 0) assert.ok(!inside(c.x, c.z, CAR.r - 0.02), `inside a box at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`);
  }
});

test('the route: twelve gates on open road, every district visited, start and finish clear', () => {
  const { gates, start, finish } = makeRoute();
  assert.equal(gates.length, 12);
  for (const g of gates) {
    const line = g.axis === 'x' ? g.z : g.x;
    assert.ok(ROADS.includes(line), `gate ${g.n} sits on a road centre line`);
    for (let o = -7; o <= 7; o += 1) assert.ok(!inside(g.axis === 'x' ? g.x : g.x + o, g.axis === 'x' ? g.z + o : g.z, 0.6), `gate ${g.n} is blocked at offset ${o}`);
  }
  assert.equal(new Set(gates.map((g) => g.district)).size, DISTRICTS.length);
  for (let i = 1; i < gates.length; i++) {
    const d = Math.hypot(gates[i].x - gates[i - 1].x, gates[i].z - gates[i - 1].z);
    assert.ok(d > 60 && d < 520, `leg ${i} is ${d.toFixed(0)} m`);
  }
  assert.ok(!inside(start.x, start.z, 2) && !inside(finish.x, finish.z, 2));
});

test('a gate counts only when the car passes between its pylons', () => {
  const g = makeRoute().gates[0]; // travelling along X
  assert.ok(crossesGate(g, g.x - 1, g.z + 3, g.x + 1, g.z + 3));
  assert.ok(crossesGate(g, g.x + 1, g.z - 5, g.x - 1, g.z - 5), 'either direction');
  assert.ok(!crossesGate(g, g.x - 1, g.z + 12, g.x + 1, g.z + 12), 'outside the pylons');
  assert.ok(!crossesGate(g, g.x - 3, g.z, g.x - 1, g.z), 'not reaching the line');
});

test('traffic keeps to its lane on a road and inside the island', () => {
  const cars = makeTraffic(mulberry32(11));
  assert.ok(cars.length > 30);
  for (const car of cars) {
    for (const t of [0, 13.7, 250, 4000]) {
      const p = trafficAt(car, t);
      assert.ok(Math.abs(p.x) <= BOUND && Math.abs(p.z) <= BOUND);
      const off = Math.min(...ROADS.map((r) => Math.abs((car.axis === 'x' ? p.z : p.x) - r)));
      assert.ok(Math.abs(off - 3.3) < 1e-6, 'one lane off a road centre');
      assert.ok(!inside(p.x, p.z, 0.9), `traffic inside a box at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  }
});
