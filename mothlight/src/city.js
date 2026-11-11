// Pure, renderer-free description of Vesper-9: where every box, lift, shard and terminal is.
import { RNG } from './rng.js';

export const N = 9;            // blocks per side
export const BLOCK = 60;       // block edge length (m)
export const ROAD = 16;        // road width (m)
export const PITCH = BLOCK + ROAD;
export const MID = (N - 1) / 2;
export const HALF = (N * PITCH + ROAD) / 2; // half extent of the island
export const BOUND = HALF - 2;              // how far the player may walk
export const RAIL = 1.5 * PITCH;            // half size of the monorail loop
export const RAIL_Y = 14;

export const blockCenter = (i) => (i - MID) * PITCH;
export const blockIndex = (v) => Math.min(N - 1, Math.max(0, Math.floor(v / PITCH + MID + 0.5)));

export const DISTRICTS = [
  { id: 'core', name: 'HALCYON CORE', tag: 'corporate spires', color: [0.25, 0.8, 1.0], hMin: 70, hMax: 190, pow: 1.3, maxLot: 40, lit: 0.5 },
  { id: 'market', name: 'KESSEL MARKET', tag: 'night stalls and steam', color: [1.0, 0.45, 0.12], hMin: 12, hMax: 38, pow: 1.0, maxLot: 20, lit: 0.62 },
  { id: 'lantern', name: 'LANTERN ROW', tag: 'stacked tenements', color: [1.0, 0.14, 0.5], hMin: 22, hMax: 70, pow: 1.2, maxLot: 24, lit: 0.55 },
  { id: 'glass', name: 'GLASSWATER', tag: 'towers over the tide', color: [0.55, 0.35, 1.0], hMin: 40, hMax: 120, pow: 1.4, maxLot: 30, lit: 0.42 },
  { id: 'sump', name: 'THE SUMP', tag: 'pumps, pipes, old grid', color: [0.3, 1.0, 0.42], hMin: 10, hMax: 40, pow: 1.0, maxLot: 30, lit: 0.3 },
];

// 3x3 core in the middle, the rest split into four pinwheel arms. Mirrored in GLSL (shaders.js).
export function districtOfBlock(i, j) {
  const a = i - MID, b = j - MID;
  if (Math.abs(a) <= 1 && Math.abs(b) <= 1) return 0;
  if (a < 0 && b <= 0) return 1;
  if (a >= 0 && b < 0) return 2;
  if (a > 0 && b >= 0) return 3;
  return 4;
}
export const districtAt = (x, z) => districtOfBlock(blockIndex(x), blockIndex(z));

function makeBox(x, z, w, d, y0, y1, extra) {
  return { x, z, w, d, y0, y1, minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ...extra };
}

export function generateCity(seed = 9) {
  const rng = new RNG(seed);
  const boxes = [];      // everything drawn with the facade shader
  const buildings = [];  // ground-level lots (one per building)
  const alleys = [];
  const plazas = [];

  // One open plaza per outer district, chosen up front so the layout always has them.
  const plazaKeys = new Set();
  for (let d = 1; d <= 4; d++) {
    const options = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (districtOfBlock(i, j) === d && Math.max(Math.abs(i - MID), Math.abs(j - MID)) === 3) options.push(i * N + j);
    }
    plazaKeys.add(rng.pick(options));
  }

  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i === MID && j === MID) continue; // the Spire stands here
    const cx = blockCenter(i), cz = blockCenter(j);
    const district = districtOfBlock(i, j);
    const prof = DISTRICTS[district];
    if (plazaKeys.has(i * N + j)) { plazas.push({ x: cx, z: cz, district }); continue; }

    const lots = [];
    const split = (r, depth) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      if ((w <= prof.maxLot && d <= prof.maxLot) || depth >= 3) { lots.push(r); return; }
      const t = rng.range(0.38, 0.62);
      if (w >= d) {
        const m = r.x0 + w * t;
        alleys.push({ x: m, z: (r.z0 + r.z1) / 2, district });
        split({ ...r, x1: m }, depth + 1); split({ ...r, x0: m }, depth + 1);
      } else {
        const m = r.z0 + d * t;
        alleys.push({ x: (r.x0 + r.x1) / 2, z: m, district });
        split({ ...r, z1: m }, depth + 1); split({ ...r, z0: m }, depth + 1);
      }
    };
    split({ x0: cx - 25.5, x1: cx + 25.5, z0: cz - 25.5, z1: cz + 25.5 }, 0);

    for (const r of lots) {
      const w = r.x1 - r.x0 - 3, d = r.z1 - r.z0 - 3; // 3 m alleys between neighbours
      if (w < 7 || d < 7) continue;
      const h = Math.round(prof.hMin + (prof.hMax - prof.hMin) * Math.pow(rng.next(), prof.pow));
      const common = { kind: 'building', bi: i, bj: j, district, style: rng.int(0, 2), seed: rng.next(), lit: prof.lit * rng.range(0.6, 1.3) };
      const base = makeBox((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, w, d, 0, h, { ...common, id: buildings.length, tier: false });
      boxes.push(base); buildings.push(base);
      if (h > 35 && w > 12 && d > 12 && rng.chance(0.45)) {
        base.tier = true;
        boxes.push(makeBox(base.x, base.z, w * 0.64, d * 0.64, h, Math.round(h * rng.range(1.2, 1.5)), { ...common, seed: rng.next() }));
      }
    }
  }

  // The Spire: a walkable podium with a needle tower on top.
  const spire = { kind: 'spire', district: 0, style: 3, seed: 0.5, lit: 0.5 };
  boxes.push(makeBox(0, 0, 30, 30, 0, 12, { ...spire, style: 1, podium: true }));
  boxes.push(makeBox(0, 0, 16, 16, 12, 170, spire));
  boxes.push(makeBox(0, 0, 9, 9, 170, 245, spire));
  boxes.push(makeBox(0, 0, 2.4, 2.4, 245, 310, spire));

  // Lifts carry the player up one facade to a rooftop shard.
  const lifts = [];
  const shards = [];
  const used = new Set();
  const liftBuildings = new Set();
  const facadeSpot = (b, out, along) => {
    // Point outside the facade that faces the nearest street.
    const cx = blockCenter(b.bi), cz = blockCenter(b.bj);
    const gaps = [b.minX - (cx - 30), cx + 30 - b.maxX, b.minZ - (cz - 30), cz + 30 - b.maxZ];
    const side = gaps.indexOf(Math.min(...gaps));
    if (side === 0) return { x: b.minX - out, z: b.z + along * b.d, nx: -1, nz: 0 };
    if (side === 1) return { x: b.maxX + out, z: b.z + along * b.d, nx: 1, nz: 0 };
    if (side === 2) return { x: b.x + along * b.w, z: b.minZ - out, nx: 0, nz: -1 };
    return { x: b.x + along * b.w, z: b.maxZ + out, nx: 0, nz: 1 };
  };
  const roofRanges = [[70, 125], [20, 36], [28, 60], [45, 90], [18, 36]];
  for (let d = 0; d <= 4; d++) {
    const mine = buildings.filter((b) => b.district === d && b.w >= 10 && b.d >= 10);
    const [lo, hi] = roofRanges[d];
    let pool = mine.filter((b) => !b.tier && b.y1 >= lo && b.y1 <= hi);
    if (!pool.length) pool = mine.filter((b) => !b.tier);
    if (!pool.length) pool = mine;
    const b = rng.pick(pool);
    used.add(b.id); liftBuildings.add(b.id);
    const spot = facadeSpot(b, 2.3, 0);
    lifts.push({ x: spot.x, z: spot.z, top: b.y1, r: 2, district: d });
    // On a tiered roof the shard sits on the ledge beside the lift instead of the centre.
    const sx = b.tier ? spot.x - spot.nx * 3.8 : b.x, sz = b.tier ? spot.z - spot.nz * 3.8 : b.z;
    shards.push({ x: sx, y: b.y1, z: sz, roof: true, lift: lifts.length - 1, district: d });
  }
  lifts.push({ x: 17.3, z: 0, top: 12, r: 2, district: 0 });
  shards.push({ x: -11.5, y: 12, z: -11.5, roof: true, lift: lifts.length - 1, district: 0 });

  // Street shards hide in alleys, as far from the other shards as the district allows.
  const farthest = (cands) => {
    let best = null, bestD = -1;
    for (const c of cands) {
      let near = Infinity;
      for (const s of shards) near = Math.min(near, Math.hypot(c.x - s.x, c.z - s.z));
      near = Math.min(near, Math.hypot(c.x, c.z - 38) * 0.8);
      if (near > bestD) { bestD = near; best = c; }
    }
    return best;
  };
  for (const d of [1, 2, 3, 4, 0, 0]) {
    const a = farthest(alleys.filter((c) => c.district === d));
    shards.push({ x: a.x, y: 0, z: a.z, roof: false, lift: -1, district: d });
  }

  // Lore terminals stand against street-facing walls; the sixth sits in a plaza.
  const terminals = [];
  for (let d = 0; d <= 4; d++) {
    const pool = buildings.filter((b) => b.district === d && !used.has(b.id) && b.w >= 9 && b.d >= 9);
    const b = rng.pick(pool);
    used.add(b.id);
    const s = facadeSpot(b, 0.9, 0.2);
    terminals.push({ x: s.x, z: s.z, nx: s.nx, nz: s.nz, district: d });
  }
  const pz = plazas[plazas.length - 1];
  terminals.push({ x: pz.x + 9, z: pz.z + 9, nx: 0, nz: 1, district: pz.district });

  // Monorail loop around the core: pillars and deck are solid.
  const rail = [];
  for (const s of [-1, 1]) {
    rail.push(makeBox(0, s * RAIL, 2 * RAIL + 2.4, 2.4, RAIL_Y - 0.8, RAIL_Y, { kind: 'rail' }));
    rail.push(makeBox(s * RAIL, 0, 2.4, 2 * RAIL + 2.4, RAIL_Y - 0.8, RAIL_Y, { kind: 'rail' }));
    for (let k = -6; k <= 5; k++) {
      const t = (k + 0.5) * (PITCH / 4);
      rail.push(makeBox(t, s * RAIL, 1, 1, 0, RAIL_Y - 0.8, { kind: 'pillar' }));
      rail.push(makeBox(s * RAIL, t, 1, 1, 0, RAIL_Y - 0.8, { kind: 'pillar' }));
    }
  }

  // Unreachable towers standing in the water beyond the island, for depth.
  const skyline = [];
  for (let k = 0; k < 150; k++) {
    const r = rng.range(HALF + 70, HALF + 330), t = rng.range(-1, 1) * r;
    const side = rng.int(0, 3);
    const x = side === 0 ? -r : side === 1 ? r : t, z = side === 2 ? -r : side === 3 ? r : t;
    skyline.push(makeBox(x, z, rng.range(26, 80), rng.range(26, 80), -2, rng.range(70, 360),
      { kind: 'skyline', district: rng.int(0, 4), style: rng.int(0, 2), seed: rng.next(), lit: rng.range(0.25, 0.6) }));
  }

  const props = generateProps(seed, { boxes, buildings, lifts, shards, terminals, liftBuildings });

  return {
    seed, boxes, skyline, buildings, rail, alleys, plazas, lifts, shards, terminals, props,
    colliders: [...boxes, ...rail, ...props.filter((q) => q.solid)],
    start: { x: 0, z: 38 },
    uplink: { x: 0, z: 16.2 },
  };
}

// Uniform grid over box footprints; returns a query(minX, maxX, minZ, maxZ) -> boxes function.
export function buildIndex(boxes, cell = 38) {
  const grid = new Map();
  const key = (i, j) => i * 4096 + j;
  for (const b of boxes) {
    for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i++) {
      for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
    }
  }
  return (minX, maxX, minZ, maxZ) => {
    const out = [];
    for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i++) {
      for (let j = Math.floor(minZ / cell); j <= Math.floor(maxZ / cell); j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (const b of list) if (!out.includes(b)) out.push(b);
      }
    }
    return out;
  };
}

// Street furniture and rooftop clutter. Uses its own RNG stream so the base layout above never shifts.
// Every prop is an axis-aligned box: { ..., color: [r, g, b], emis: 0 | 1, solid }.
function generateProps(seed, { boxes, buildings, lifts, shards, terminals, liftBuildings }) {
  const rng = new RNG(seed * 7 + 101);
  const props = [];
  const keepOut = [
    ...lifts.map((l) => ({ x: l.x, z: l.z, r: 4.5 })),
    ...terminals.map((t) => ({ x: t.x, z: t.z, r: 3 })),
    ...shards.filter((sh) => !sh.roof).map((sh) => ({ x: sh.x, z: sh.z, r: 4 })),
  ];
  const clear = (x, z, pad) => keepOut.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + pad);
  const put = (x, z, w, d, y0, y1, color, opt = {}) => {
    const b = makeBox(x, z, w, d, y0, y1, { kind: 'prop', color, emis: 0, solid: false, ...opt });
    props.push(b);
    return b;
  };
  const GREY = [0.075, 0.08, 0.095], DARK = [0.035, 0.038, 0.05], RUST = [0.10, 0.055, 0.03], WOOD = [0.10, 0.075, 0.05];
  const GLOW = [[3, 0.45, 1.4], [0.3, 2.2, 2.8], [3, 1.7, 0.3], [0.8, 2.8, 0.7], [1.7, 0.9, 3]];

  // ---- rooftops: AC units, stair bulkheads, tanks and antenna masts
  for (const roof of boxes) {
    if (roof.kind !== 'building' || (roof.y0 === 0 && (roof.tier || liftBuildings.has(roof.id)))) continue;
    const y = roof.y1, placed = [];
    const want = Math.max(1, Math.min(6, Math.floor((roof.w * roof.d) / 55)));
    for (let tries = 0; tries < want * 4 && placed.length < want; tries++) {
      const roll = rng.next();
      const [w, d, h] = roll < 0.5 ? [rng.range(1.6, 3), rng.range(1.2, 2.2), rng.range(0.9, 1.5)]
        : roll < 0.65 ? [3, 4, 2.6] : roll < 0.8 ? [2.2, 2.2, rng.range(2.4, 3.4)] : [0.18, 0.18, rng.range(6, 16)];
      const mx = roof.w / 2 - w / 2 - 1.2, mz = roof.d / 2 - d / 2 - 1.2;
      if (mx <= 0 || mz <= 0) continue;
      const x = roof.x + rng.range(-mx, mx), z = roof.z + rng.range(-mz, mz);
      if (Math.hypot(x - roof.x, z - roof.z) < 3.4 + Math.max(w, d) / 2) continue; // keep the middle clear to land on
      if (placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 0.6 && Math.abs(q.z - z) < (q.d + d) / 2 + 0.6)) continue;
      if (roll >= 0.8) {
        placed.push(put(x, z, w, d, y, y + h, DARK));
        put(x, z, 0.36, 0.36, y + h, y + h + 0.36, [4, 0.35, 0.25], { emis: 1 });
      } else {
        placed.push(put(x, z, w, d, y, y + h, roll < 0.65 && roll >= 0.5 ? DARK : roll < 0.8 && roll >= 0.65 ? RUST : GREY, { solid: true }));
        if (roll < 0.5) put(x, z, w * 0.7, d * 0.7, y + h, y + h + 0.08, [0.02, 0.022, 0.03]); // fan grille
        else if (roll < 0.65) put(x + 1.53, z, 0.06, 1.0, y + 2.05, y + 2.2, GLOW[roof.district], { emis: 1 }); // door light
      }
    }
  }

  // ---- street level, one pass along every street-facing wall
  for (const b of buildings) {
    const cx = blockCenter(b.bi), cz = blockCenter(b.bj), dist = b.district;
    const faces = [
      { nx: -1, nz: 0, fw: b.d, x: b.minX, z: b.z, gap: b.minX - (cx - 30) },
      { nx: 1, nz: 0, fw: b.d, x: b.maxX, z: b.z, gap: cx + 30 - b.maxX },
      { nx: 0, nz: -1, fw: b.w, x: b.x, z: b.minZ, gap: b.minZ - (cz - 30) },
      { nx: 0, nz: 1, fw: b.w, x: b.x, z: b.maxZ, gap: cz + 30 - b.maxZ },
    ];
    let strung = false;
    for (const f of faces) {
      if (f.gap > 8) continue;
      // place(along the wall, distance of the centre from the wall, size along, size out, y0, y1, ...)
      const place = (along, out, sa, so, y0, y1, color, opt) => put(
        f.x + -f.nz * along + f.nx * out, f.z + f.nx * along + f.nz * out,
        f.nx ? so : sa, f.nx ? sa : so, y0, y1, color, opt);
      const spot = (along, out) => [f.x + -f.nz * along + f.nx * out, f.z + f.nx * along + f.nz * out];

      // Awning over the shopfronts.
      if (dist !== 0 && b.y1 > 6) place(0, 0.7, f.fw - 0.6, 1.4, 4.28, 4.42, DISTRICTS[dist].color.map((c) => 0.025 + c * 0.05));
      // The Sump runs its plumbing outside.
      if (dist === 4 && f.fw > 8) {
        place(0, 0.32, f.fw - 1.5, 0.5, 5.0, 5.5, RUST);
        for (let a = -f.fw / 2 + 2; a < f.fw / 2 - 1; a += rng.range(5, 8)) place(a, 0.32, 0.36, 0.36, 4.42, 5.0, RUST);
      }
      // Lantern Row: balconies up the facade and one string of lanterns over the street.
      if (dist === 2) {
        for (let y = 7.4; y < Math.min(b.y1 - 2, 24); y += 3.6) {
          for (let a = -f.fw / 2 + 2.2; a < f.fw / 2 - 2; a += 4.8) {
            if (!rng.chance(0.55)) continue;
            place(a, 0.55, 2.6, 1.1, y, y + 0.14, [0.07, 0.06, 0.07]);
            place(a, 1.07, 2.6, 0.06, y + 0.14, y + 1.0, DARK);
            if (rng.chance(0.3)) place(a + 0.8, 0.8, 0.3, 0.3, y - 0.45, y - 0.05, [3, 0.9, 0.25], { emis: 1 });
          }
        }
        const [ex, ez] = spot(0, 28);
        if (!strung && rng.chance(0.6) && Math.max(Math.abs(ex), Math.abs(ez)) < HALF - 24) {
          strung = true;
          const along = rng.range(-0.3, 0.3) * f.fw, y = rng.range(7.2, 9);
          place(along, 14, 0.05, 28, y, y + 0.05, DARK);
          for (let k = 0; k < 8; k++) place(along, 3 + k * 3.15, 0.42, 0.42, y - 0.62 - 0.25 * Math.sin((k / 7) * Math.PI), y - 0.07 - 0.25 * Math.sin((k / 7) * Math.PI), k % 2 ? [3, 1.1, 0.22] : [3.2, 0.3, 0.18], { emis: 1 });
        }
      }
      // Furniture against the wall, stepping along the frontage.
      for (let a = -f.fw / 2 + 1.6; a < f.fw / 2 - 1.6;) {
        const roll = rng.next();
        const [px, pz] = spot(a, 0.8);
        if (!clear(px, pz, 1.8)) { a += 2; continue; }
        if (dist === 1 && roll < 0.4 && a + 3.4 < f.fw / 2) {
          // Market stall: counter, goods, canopy on two posts, a warm light bar.
          const c = a + 1.6;
          place(c, 1.15, 2.6, 0.9, 0, 1.0, WOOD, { solid: true });
          for (let k = -1; k <= 1; k++) place(c + k * 0.8, 1.15, 0.5, 0.5, 1.0, 1.0 + rng.range(0.15, 0.4), [rng.range(0.08, 0.5), rng.range(0.08, 0.4), rng.range(0.05, 0.3)]);
          place(c, 1.05, 3.2, 2.0, 2.4, 2.5, DISTRICTS[rng.int(1, 4)].color.map((v) => 0.03 + v * 0.22));
          place(c - 1.5, 1.95, 0.08, 0.08, 0, 2.4, DARK); place(c + 1.5, 1.95, 0.08, 0.08, 0, 2.4, DARK);
          place(c, 1.3, 2.6, 0.08, 2.3, 2.37, [3.2, 2.1, 1.0], { emis: 1 });
          a += 3.4 + rng.range(1, 4);
        } else if (roll < 0.62) {
          // Vending machine with a glowing front.
          place(a, 0.4, 1.1, 0.75, 0, 1.95, DARK, { solid: true });
          place(a, 0.8, 0.9, 0.05, 0.55, 1.8, GLOW[rng.int(0, 4)].map((v) => v * 0.55), { emis: 1 });
          a += 1.1 + rng.range(2, 7);
        } else if (roll < 0.8 && (dist === 0 || dist === 3)) {
          // Planter with a light strip along its lip.
          place(a + 1.5, 0.6, 3, 0.9, 0, 0.6, GREY, { solid: true });
          place(a + 1.5, 1.07, 3, 0.05, 0.5, 0.58, GLOW[dist].map((v) => v * 0.5), { emis: 1 });
          for (let k = 0; k < 3; k++) place(a + 0.6 + k * 0.9, 0.6, 0.6, 0.6, 0.6, 0.6 + rng.range(0.4, 1.1), [0.015, 0.06, 0.035]);
          a += 3 + rng.range(2, 6);
        } else if (roll < 0.9) {
          // Crates, sometimes stacked.
          const n = rng.int(1, 2);
          place(a, 0.5, 0.9, 0.9, 0, 0.9, dist === 4 ? RUST : WOOD, { solid: true });
          if (n > 1) place(a + 0.1, 0.45, 0.7, 0.7, 0.9, 1.6, WOOD, { solid: true });
          a += 0.9 + rng.range(2, 6);
        } else a += rng.range(2, 5);
      }
    }
  }
  return props;
}
