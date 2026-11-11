import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCity, districtOfBlock, districtAt, blockCenter, buildIndex, N, BOUND, DISTRICTS,
} from '../src/city.js';

const city = generateCity(9);

const insideXZ = (b, x, z, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

test('generation is deterministic for a seed', () => {
  const again = generateCity(9);
  assert.equal(again.boxes.length, city.boxes.length);
  assert.deepEqual(again.shards, city.shards);
  assert.deepEqual(again.boxes[17], city.boxes[17]);
  assert.notDeepEqual(generateCity(10).shards, city.shards);
});

test('district partition covers the grid with a 3x3 core', () => {
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) counts[districtOfBlock(i, j)]++;
  assert.equal(counts[0], 9);
  assert.equal(counts.reduce((a, b) => a + b), N * N);
  for (const c of counts) assert.ok(c >= 9);
  assert.equal(DISTRICTS.length, 5);
  assert.equal(districtAt(0, 0), 0);
  assert.equal(districtAt(blockCenter(0), blockCenter(0)), 1);
});

test('buildings stay inside their block and off the roads', () => {
  const lots = city.boxes.filter((b) => b.kind === 'building');
  assert.ok(lots.length > 200, `expected a dense city, got ${lots.length}`);
  for (const b of lots) {
    const cx = blockCenter(b.bi), cz = blockCenter(b.bj);
    assert.ok(b.minX >= cx - 26 && b.maxX <= cx + 26 && b.minZ >= cz - 26 && b.maxZ <= cz + 26);
    assert.ok(b.y1 > b.y0);
  }
});

test('twelve shards: six on the street, six on rooftops reachable by a lift', () => {
  assert.equal(city.shards.length, 12);
  const roof = city.shards.filter((s) => s.roof);
  assert.equal(roof.length, 6);
  for (const s of city.shards) {
    assert.ok(Math.abs(s.x) < BOUND && Math.abs(s.z) < BOUND);
    if (s.roof) {
      const lift = city.lifts[s.lift];
      assert.ok(lift, 'rooftop shard needs a lift');
      assert.ok(lift.top >= s.y - 0.01, 'lift must reach the roof');
      const under = city.colliders.some((b) => insideXZ(b, s.x, s.z) && Math.abs(b.y1 - s.y) < 0.01);
      assert.ok(under, 'rooftop shard must sit on a roof');
      const buried = city.colliders.some((b) => insideXZ(b, s.x, s.z, 0.5) && b.y0 < s.y + 1 && b.y1 > s.y + 0.5);
      assert.ok(!buried, 'rooftop shard must not be inside an upper tier');
    } else {
      assert.equal(s.y, 0);
      assert.ok(!city.colliders.some((b) => insideXZ(b, s.x, s.z, 0.6) && b.y0 < 2), 'street shard is inside a wall');
    }
  }
  // Shards are spread out rather than clumped.
  for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) {
    const A = city.shards[a], B = city.shards[b];
    assert.ok(Math.hypot(A.x - B.x, A.z - B.z) > 25, `shards ${a} and ${b} too close`);
  }
});

test('lifts, terminals and the start point are in open space', () => {
  const blocked = (x, z, pad) => city.colliders.some((b) => insideXZ(b, x, z, pad) && b.y0 < 2);
  for (const l of city.lifts) assert.ok(!blocked(l.x, l.z, 0.5), 'lift blocked');
  assert.equal(city.terminals.length, 6);
  for (const t of city.terminals) assert.ok(!blocked(t.x, t.z, 0.2), 'terminal blocked');
  assert.ok(!blocked(city.start.x, city.start.z, 1));
  assert.ok(!blocked(city.uplink.x, city.uplink.z, 0.3));
});

test('spatial index returns every box overlapping the query', () => {
  const query = buildIndex(city.colliders);
  const probe = { minX: -40, maxX: 55, minZ: -90, maxZ: 10 };
  const brute = city.colliders.filter((b) => b.maxX > probe.minX && b.minX < probe.maxX && b.maxZ > probe.minZ && b.minZ < probe.maxZ);
  const found = new Set(query(probe.minX, probe.maxX, probe.minZ, probe.maxZ));
  for (const b of brute) assert.ok(found.has(b));
});

test('props: plenty of clutter, and nothing solid blocks a lift, terminal or street shard', () => {
  assert.ok(city.props.length > 1500, `only ${city.props.length} props`);
  const solid = city.props.filter((q) => q.solid);
  assert.ok(solid.length > 300);
  const hit = (x, z, pad) => solid.some((b) => insideXZ(b, x, z, pad) && b.y0 < 2);
  for (const l of city.lifts) assert.ok(!hit(l.x, l.z, 2.2), 'prop inside a lift column');
  for (const t of city.terminals) assert.ok(!hit(t.x + t.nx * 1.5, t.z + t.nz * 1.5, 0.5), 'prop in front of a terminal');
  for (const s of city.shards) if (!s.roof) assert.ok(!hit(s.x, s.z, 1), 'prop on a street shard');
  // Street props stay on the pavement: never out in the road.
  for (const q of solid) if (q.y0 === 0) {
    const lx = Math.abs(((q.x + 38) % 76 + 76) % 76 - 38), lz = Math.abs(((q.z + 38) % 76 + 76) % 76 - 38);
    assert.ok(Math.max(lx, lz) < 27, 'solid prop outside the wall-side strip');
  }
});
