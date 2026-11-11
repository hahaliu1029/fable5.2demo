// The seabed: a single analytic height function shared by rendering, collision and placement.
// World axes: +Y up, sea surface at y = 0. The shore is at z ~ 0 and the sea deepens toward -Z.
import { fbm2, ridged2, cellBumps, lerp, smoothstep } from './noise.js';

export const WORLD = { xMin: -340, xMax: 340, zMin: -900, zMax: 90 };

// [offshore distance s = -z, depth in metres]
const PROFILE = [
  [-90, -8], [-40, -2], [0, 6], [60, 10], [170, 19], [230, 30], [330, 44], [385, 58], [440, 66], [468, 80],
  [520, 168], [570, 184], [700, 198], [800, 202], [850, 170], [900, 60],
];

function hermite(points) {
  const n = points.length;
  const m = points.map((p, i) => {
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, n - 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  });
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[n - 1][0]) return points[n - 1][1];
    let i = 0;
    while (x > points[i + 1][0]) i++;
    const h = points[i + 1][0] - points[i][0];
    const t = (x - points[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * points[i][1] + (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * points[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}
const profile = hermite(PROFILE);

export const GORGE = { x: 30, s0: 395, s1: 540 };
const gorgeX = (s) => GORGE.x + 16 * Math.sin(s * 0.021);

export function gorgeMask(x, z) {
  const s = -z;
  const gx = (x - gorgeX(s)) / 24;
  return Math.exp(-gx * gx) * smoothstep(GORGE.s0 - 10, GORGE.s0 + 30, s) * smoothstep(GORGE.s1 + 8, GORGE.s1 - 30, s);
}

// Height of coral mounds ("bommies") on the reef flat, 0..1.
export function bommieMask(x, z) {
  const s = -z;
  return cellBumps(x / 34, z / 34, 0.6, (id) => 0.35 + 0.65 * id, 5) * smoothstep(12, 45, s) * smoothstep(245, 205, s);
}

function rawDepth(x, z) {
  const s0 = -z;
  const s = s0 + 26 * fbm2(x * 0.006, 3.1, 3, 2) * smoothstep(60, 200, s0);
  let d = profile(s);
  const amp = 1.2 + 1.6 * smoothstep(200, 300, s) + 4.5 * smoothstep(440, 480, s) * smoothstep(580, 530, s) + 1.5 * smoothstep(540, 600, s);
  d += amp * 2 * fbm2(x * 0.011, z * 0.011, 4, 1);
  d -= 5.5 * bommieMask(x, z);
  // Kelp-forest pinnacles.
  d -= 15 * cellBumps(x / 64, z / 64, 0.3, (id) => (id > 0.5 ? 0.6 + 0.8 * (id - 0.5) : 0), 9) * smoothstep(240, 270, s) * smoothstep(440, 400, s);
  // The wall: gullies and buttresses.
  const wall = smoothstep(445, 475, s) * smoothstep(575, 525, s);
  d += wall * (9 - 20 * ridged2(x * 0.022, s * 0.009, 4, 3));
  // Lantern Gorge: a ravine cut back into the shelf.
  const g = gorgeMask(x, z);
  if (g > 0.001) {
    const floor = lerp(74, 172, smoothstep(GORGE.s0, GORGE.s1 - 5, s));
    if (floor > d) d = lerp(d, floor, g);
  }
  // Abyssal dunes.
  d -= 4 * ridged2(x * 0.012, z * 0.012, 3, 7) * smoothstep(560, 620, s) * smoothstep(850, 800, s);
  // Canyon side walls enclose the playable area.
  const side = smoothstep(222, 336, Math.abs(x) + 14 * fbm2(z * 0.02, 1.7, 3, 4));
  d = lerp(d, -6, side);
  return d;
}

// Hand-placed landmarks. Depth is filled in below from the terrain itself unless fixed.
export const SITES = {
  spawn: { x: 0, z: -18 },
  bells: [
    { x: 26, z: -96, name: 'Shallows Bell' },
    { x: -95, z: -288, name: 'Cathedral Bell' },
    { x: -62, z: -432, name: 'Wreck Bell' },
    { x: 170, z: -450, name: 'Lip Bell' },
    { x: 34, z: -492, name: 'Gorge Bell' },
    { x: 132, z: -632, name: 'Vent Bell' },
    { x: -10, z: -730, name: 'Choir Bell' },
  ],
  wreck: { x: -112, z: -402, rot: 0.5 },
  arch: { x: 170, z: -450, rot: 0.3 },
  whaleFall: { x: -150, z: -605, rot: 0.9 },
  vents: { x: 155, z: -650 },
  choir: { x: -10, z: -730 },
};

const FLATS = [];
function addFlat(x, z, r0, r1, depth) {
  FLATS.push({ x, z, r0, r1, depth: depth ?? rawDepth(x, z) });
}
addFlat(SITES.spawn.x, SITES.spawn.z, 8, 22, 9);
for (const b of SITES.bells.slice(0, 6)) addFlat(b.x, b.z, 6, 16);
addFlat(SITES.wreck.x, SITES.wreck.z, 30, 48, 64);
addFlat(SITES.whaleFall.x, SITES.whaleFall.z, 14, 28);
addFlat(SITES.choir.x, SITES.choir.z, 46, 78, 195);

// Low volcanic mounds around the vent field.
const VENT_MOUNDS = [[0, 0, 7], [22, 14, 5], [-18, 20, 4], [10, -24, 5], [-26, -12, 4], [34, -8, 3.5]];
export const VENT_POSITIONS = VENT_MOUNDS.map(([dx, dz]) => ({ x: SITES.vents.x + dx, z: SITES.vents.z + dz }));

export function depthAt(x, z) {
  let d = rawDepth(x, z);
  for (const [dx, dz, h] of VENT_MOUNDS) {
    const r2 = ((x - SITES.vents.x - dx) ** 2 + (z - SITES.vents.z - dz) ** 2) / 90;
    if (r2 < 9) d -= h * Math.exp(-r2);
  }
  for (const f of FLATS) {
    const r = Math.hypot(x - f.x, z - f.z);
    if (r < f.r1) d = lerp(f.depth, d, smoothstep(f.r0, f.r1, r));
  }
  return d;
}

export const heightAt = (x, z) => -depthAt(x, z);

export function normalAt(x, z, e = 0.75) {
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -dx;
  const ny = 2 * e;
  const nz = -dz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

export const ZONES = {
  shallows: { name: 'Sunlit Shallows', sub: 'where the light still reaches the sand' },
  kelp: { name: 'Kelp Cathedral', sub: 'a forest that sways without wind' },
  shelf: { name: 'The Rusted Shelf', sub: 'something came to rest here' },
  wall: { name: 'Twilight Wall', sub: 'the edge of the daylight' },
  gorge: { name: 'Lantern Gorge', sub: 'they drift, and they glow' },
  abyss: { name: 'The Hadal Plain', sub: 'no sun has ever touched this' },
  choir: { name: 'The Drowned Choir', sub: 'the stones are listening' },
};

// Which named region a point in the water belongs to.
export function zoneAt(x, y, z) {
  const s = -z;
  const depth = -y;
  if (Math.hypot(x - SITES.choir.x, z - SITES.choir.z) < 70 && depth > 150) return 'choir';
  if (depth > 160) return 'abyss';
  if (gorgeMask(x, z) > 0.45 && depth > 70) return 'gorge';
  if (s > 462 || depth > 84) return 'wall';
  if (s > 345) return 'shelf';
  if (s > 232) return 'kelp';
  return 'shallows';
}

for (const b of SITES.bells) b.y = heightAt(b.x, b.z);
