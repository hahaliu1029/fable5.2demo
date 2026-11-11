import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, awaken, discover, depthLimit, serialize, BELL_COUNT, RATINGS, SPECIES, BELL_LINES } from '../src/game.js';
import { stepSub, resolveSphere, buildColliderGrid, SUB_RADIUS } from '../src/physics.js';
import { heightAt, normalAt, SITES } from '../src/terrain.js';

const env = (extra = {}) => ({ heightAt, normalAt, depthLimit: Infinity, ...extra });
const idle = { thrust: [0, 0, 0], boost: false };

test('bells raise the hull rating at two and four, and the seventh starts the finale', () => {
  const g = createGame();
  assert.equal(depthLimit(g), RATINGS[0]);
  assert.deepEqual(awaken(g, 0).map((e) => e.type), ['bell']);
  assert.deepEqual(awaken(g, 1).map((e) => e.type), ['bell', 'rating']);
  assert.equal(depthLimit(g), RATINGS[1]);
  awaken(g, 2);
  assert.deepEqual(awaken(g, 3).map((e) => e.type), ['bell', 'rating']);
  assert.equal(depthLimit(g), Infinity);
  awaken(g, 4);
  awaken(g, 5);
  const last = awaken(g, 6);
  assert.deepEqual(last.map((e) => e.type), ['bell', 'finale']);
  assert.equal(last[0].line, BELL_LINES[BELL_COUNT - 1]);
  assert.ok(g.finale);
});

test('a bell can only be woken once, and bad indices are ignored', () => {
  const g = createGame();
  assert.equal(awaken(g, 3).length, 1);
  assert.equal(awaken(g, 3).length, 0);
  assert.equal(awaken(g, 9).length, 0);
  assert.equal(awaken(g, -1).length, 0);
  assert.equal(g.bells.size, 1);
});

test('the story line follows the order of discovery, not the bell index', () => {
  const g = createGame();
  assert.equal(awaken(g, 5)[0].line, BELL_LINES[0]);
  assert.equal(awaken(g, 0)[0].line, BELL_LINES[1]);
});

test('logbook entries are recorded once', () => {
  const g = createGame();
  assert.ok(discover(g, 'turtle'));
  assert.ok(!discover(g, 'turtle'));
  assert.ok(!discover(g, 'kraken'));
  assert.equal(g.log.size, 1);
  assert.ok(Object.values(SPECIES).every((s) => s.name && s.note));
});

test('progress survives a save/load round trip and rejects junk', () => {
  const g = createGame();
  for (const i of [0, 1, 2, 3]) awaken(g, i);
  discover(g, 'manta');
  const again = createGame(JSON.parse(JSON.stringify(serialize(g))));
  assert.deepEqual(serialize(again), serialize(g));
  assert.equal(depthLimit(again), Infinity);
  const junk = createGame({ bells: [1, 1, 99, 'x', -2], log: ['nope', 'manta'] });
  assert.deepEqual(serialize(junk), { bells: [1], log: ['manta'] });
});

test('a malformed save is ignored instead of breaking start-up', () => {
  for (const bad of [{ bells: 3 }, { log: {} }, { bells: [0], log: 7 }, 'nope', 42, [], { log: ['constructor', 'toString'] }]) {
    const g = createGame(bad);
    assert.ok(g.bells.size <= 1 && g.log.size === 0);
  }
  assert.ok(!discover(createGame(), 'constructor'));
});

test('a collider just across a grid-cell line still stops the sub', () => {
  const colliders = buildColliderGrid([[15, -20, 8, 0.6]]);
  const flat = { heightAt: () => -100, normalAt: () => [0, 1, 0], colliders };
  const pos = [16.4, -20, 8];
  assert.ok(resolveSphere(pos, [0, 0, 0], SUB_RADIUS, flat), 'contact across the x=16 cell boundary');
  assert.ok(Math.hypot(pos[0] - 15, pos[1] + 20, pos[2] - 8) >= 0.6 + SUB_RADIUS - 1e-6);
});

test('thrust moves the sub and drag brings it to rest', () => {
  const sub = { pos: [0, -8, -18], vel: [0, 0, 0] };
  for (let i = 0; i < 120; i++) stepSub(sub, { thrust: [0, 0, -1], boost: false }, 1 / 60, env());
  assert.ok(sub.pos[2] < -30, `moved to ${sub.pos[2]}`);
  const speed = Math.hypot(...sub.vel);
  assert.ok(speed > 8 && speed < 14, `cruise ${speed}`);
  for (let i = 0; i < 600; i++) stepSub(sub, idle, 1 / 60, env());
  assert.ok(Math.hypot(...sub.vel) < 0.05);
});

test('the sub cannot pass through the seabed or leave the water', () => {
  const sub = { pos: [40, -6, -150], vel: [0, 0, 0] };
  for (let i = 0; i < 600; i++) {
    stepSub(sub, { thrust: [0.3, -1, 0], boost: true }, 1 / 60, env());
    assert.ok(sub.pos[1] >= heightAt(sub.pos[0], sub.pos[2]) + SUB_RADIUS - 1e-6);
  }
  for (let i = 0; i < 600; i++) stepSub(sub, { thrust: [0, 1, 0], boost: true }, 1 / 60, env());
  assert.ok(sub.pos[1] <= -1.5 && sub.pos[1] > -2);
});

test('diving past the hull rating is refused', () => {
  const sub = { pos: [0, -40, -560], vel: [0, 0, 0] };
  let flagged = false;
  for (let i = 0; i < 1500; i++) {
    const r = stepSub(sub, { thrust: [0, -1, 0], boost: true }, 1 / 60, env({ depthLimit: 45 }));
    flagged ||= r.over > 0;
  }
  assert.ok(flagged);
  assert.ok(-sub.pos[1] < 58, `held at ${-sub.pos[1]} m`);
  for (let i = 0; i < 600; i++) stepSub(sub, idle, 1 / 60, env({ depthLimit: 45 }));
  assert.ok(-sub.pos[1] <= 45.5);
});

test('the map edge pushes back', () => {
  const sub = { pos: [0, -30, -300], vel: [0, 0, 0] };
  for (let i = 0; i < 3000; i++) stepSub(sub, { thrust: [1, 0, 0], boost: true }, 1 / 60, env());
  assert.ok(sub.pos[0] < 340);
});

test('sphere colliders push the sub out', () => {
  const b = SITES.bells[0];
  const colliders = buildColliderGrid([[b.x, b.y + 2, b.z, 2]]);
  const pos = [b.x + 0.5, b.y + 2.5, b.z];
  const vel = [-3, 0, 0];
  assert.ok(resolveSphere(pos, vel, SUB_RADIUS, env({ colliders })));
  assert.ok(Math.hypot(pos[0] - b.x, pos[1] - b.y - 2, pos[2] - b.z) >= 2 + SUB_RADIUS - 1e-6);
  const n = [pos[0] - b.x, pos[1] - b.y - 2, pos[2] - b.z];
  assert.ok(vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2] >= -1e-9, 'inward velocity removed');
});
