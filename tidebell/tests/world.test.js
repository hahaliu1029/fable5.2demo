import test from 'node:test';
import assert from 'node:assert/strict';
import { noise2, fbm2, worley2 } from '../src/noise.js';
import { WORLD, SITES, depthAt, heightAt, normalAt, zoneAt } from '../src/terrain.js';
import { generateScatter, scatterColliders, TYPES } from '../src/scatter.js';
import { RATINGS } from '../src/game.js';

test('noise is deterministic and bounded', () => {
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37 - 40;
    const y = i * 0.91 + 3;
    const n = noise2(x, y, 3);
    assert.equal(n, noise2(x, y, 3));
    assert.ok(n >= -1 && n <= 1);
    assert.ok(Math.abs(fbm2(x, y)) <= 1);
    const w = worley2(x, y);
    assert.ok(w.f1 <= w.f2 && w.f1 >= 0);
  }
});

test('the seabed deepens from the shallows to the abyss', () => {
  const avg = (z) => {
    let sum = 0;
    for (let x = -150; x <= 150; x += 10) sum += depthAt(x, z);
    return sum / 31;
  };
  const reef = avg(-100);
  const kelp = avg(-290);
  const shelf = avg(-410);
  const abyss = avg(-680);
  assert.ok(reef > 5 && reef < 25, `reef ${reef}`);
  assert.ok(kelp > reef && kelp < 50, `kelp ${kelp}`);
  assert.ok(shelf > kelp && shelf < 80, `shelf ${shelf}`);
  assert.ok(abyss > 170 && abyss < 215, `abyss ${abyss}`);
});

test('the terrain is continuous (no cliffs sharper than the mesh can show)', () => {
  let worst = 0;
  for (let z = WORLD.zMin + 5; z < WORLD.zMax - 5; z += 7) {
    for (let x = WORLD.xMin + 5; x < WORLD.xMax - 5; x += 7) {
      worst = Math.max(worst, Math.abs(heightAt(x + 1, z) - heightAt(x, z)), Math.abs(heightAt(x, z + 1) - heightAt(x, z)));
    }
  }
  assert.ok(worst < 6, `max 1 m step ${worst}`);
});

test('the map is enclosed: the rim rises to the surface', () => {
  for (let z = WORLD.zMin; z <= WORLD.zMax; z += 30) {
    assert.ok(depthAt(WORLD.xMin + 2, z) < 2, `west rim at z=${z}`);
    assert.ok(depthAt(WORLD.xMax - 2, z) < 2, `east rim at z=${z}`);
  }
});

test('spawn is in open shallow water', () => {
  const d = depthAt(SITES.spawn.x, SITES.spawn.z);
  assert.ok(d > 7 && d < 12, `spawn depth ${d}`);
});

test('every bell is reachable under the hull rating the player has when they need it', () => {
  const depths = SITES.bells.map((b) => -b.y);
  // Bells 1-2 with the starting hull, 3-4 after the first upgrade, the rest after the second.
  for (const i of [0, 1]) assert.ok(depths[i] + 4 < RATINGS[0], `bell ${i} at ${depths[i]}`);
  for (const i of [2, 3]) assert.ok(depths[i] + 4 < RATINGS[1], `bell ${i} at ${depths[i]}`);
  for (const i of [4, 5, 6]) assert.ok(depths[i] > RATINGS[1], `bell ${i} should need the final hull, at ${depths[i]}`);
  for (const b of SITES.bells) assert.ok(normalAt(b.x, b.z)[1] > 0.97, `${b.name} sits on flat ground`);
});

test('zones are named for where you are', () => {
  assert.equal(zoneAt(0, -8, -30), 'shallows');
  assert.equal(zoneAt(-95, -30, -288), 'kelp');
  assert.equal(zoneAt(-110, -55, -400), 'shelf');
  assert.equal(zoneAt(34, -140, -492), 'gorge');
  assert.equal(zoneAt(-150, -185, -600), 'abyss');
  assert.equal(zoneAt(-10, -190, -730), 'choir');
});

test('scatter is deterministic, sits on the seabed and respects zones and clearings', () => {
  const a = generateScatter(7, 4);
  const b = generateScatter(7, 4);
  let total = 0;
  for (const [type, items] of a) {
    assert.ok(TYPES[type]);
    assert.equal(items.length, b.get(type).length);
    total += items.length;
    for (const it of items) {
      assert.ok(Math.abs(it.y - heightAt(it.x, it.z)) < 2.5, `${type} floats`);
      assert.ok(Math.abs(Math.hypot(...it.n) - 1) < 1e-6);
      for (const bell of SITES.bells) assert.ok(Math.hypot(it.x - bell.x, it.z - bell.z) >= 7, `${type} on a bell`);
    }
  }
  assert.ok(total > 2000, `only ${total} instances`);
  for (const it of a.get('kelp')) assert.ok(depthAt(it.x, it.z) > 20 && depthAt(it.x, it.z) < 85);
  for (const it of a.get('coral_staghorn0')) assert.ok(depthAt(it.x, it.z) < 27);
  for (const it of a.get('tube_worms')) assert.ok(depthAt(it.x, it.z) > 160);
  assert.ok(a.get('kelp').length > 50 && a.get('lantern_stalk').length > 20);
  for (const c of scatterColliders(a)) assert.ok(c.length === 4 && c[3] > 0);
});
