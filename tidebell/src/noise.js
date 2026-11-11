// Deterministic 2D noise primitives shared by terrain, scatter and texture generation.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer lattice hash -> [0, 1).
export function hash2(ix, iy, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Value noise in [-1, 1].
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy) * 2 - 1;
}

export function fbm2(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x, y, seed + i * 17);
    norm += amp;
    x = x * 2.03 + 11.7;
    y = y * 2.03 - 5.3;
    amp *= 0.5;
  }
  return sum / norm;
}

// Ridged noise in [0, 1], sharp crests.
export function ridged2(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x, y, seed + i * 31));
    sum += amp * n * n;
    norm += amp;
    x = x * 2.1 + 3.1;
    y = y * 2.1 + 9.2;
    amp *= 0.5;
  }
  return sum / norm;
}

// Worley noise: returns { f1, f2, id } with distances in cell units and a per-cell random id.
export function worley2(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(cx, cy, seed + 2);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id };
}

// Smooth mounds scattered on a jittered grid: max over nearby cells of weight * falloff(distance).
// weight(id) may return 0 to leave a cell empty. Continuous everywhere (unlike using worley ids directly).
export function cellBumps(x, y, radius, weight, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const w = weight(hash2(cx, cy, seed + 2));
      if (w <= 0) continue;
      const d = Math.hypot(cx + hash2(cx, cy, seed) - x, cy + hash2(cx, cy, seed + 1) - y) / radius;
      if (d >= 1) continue;
      const m = 1 - d;
      best = Math.max(best, w * m * m * (3 - 2 * m));
    }
  }
  return best;
}

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
