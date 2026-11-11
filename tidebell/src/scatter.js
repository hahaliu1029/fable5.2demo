// Deterministic placement of flora, rocks and small seabed life. Pure data, no rendering.
import { mulberry32, fbm2, smoothstep } from './noise.js';
import { WORLD, SITES, depthAt, heightAt, normalAt, bommieMask, gorgeMask } from './terrain.js';

const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  const f = (c) => ((c / 255) ** 2.2);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
};
const CORAL = ['#ff6f8f', '#ffa24d', '#c58bff', '#55c8ff', '#ffe36e', '#ff5757', '#6fffc0', '#ff8ad8'].map(hex);
const FAN = ['#ff4d6d', '#ffb347', '#b06bff', '#ff7ad1', '#ffd84d'].map(hex);
const SPONGE = ['#b88cff', '#ffd24d', '#ff8a4d', '#6fd8ff', '#ff6fa8'].map(hex);
const NEUTRAL = [[1, 1, 1]];
const WARM = [[1, 1, 1], [1.1, 0.95, 0.85], [0.85, 0.9, 1.0]];
const ANEM = ['#ff9ab0', '#ffb36e', '#b8a0ff', '#8affd0', '#fff'].map((h) => (h === '#fff' ? [1, 1, 1] : hex(h).map((c) => c * 1.6)));
const DEEP = [[0.6, 1.0, 1.0], [0.75, 0.8, 1.0], [0.6, 1.0, 0.8], [1.0, 0.75, 1.0]];

// type -> [minScale, maxScale, palette, tilt-to-surface (0..1), sink depth, collider radius factor (0 = none)]
export const TYPES = {
  coral_staghorn0: [0.9, 2.0, CORAL, 0.4, 0.05, 0],
  coral_staghorn1: [0.9, 2.0, CORAL, 0.4, 0.05, 0],
  coral_fan0: [0.7, 1.6, FAN, 0.2, 0.05, 0],
  coral_fan1: [0.7, 1.6, FAN, 0.2, 0.05, 0],
  coral_brain: [0.5, 1.5, CORAL, 0.8, 0.1, 0],
  coral_table: [0.9, 2.4, CORAL, 0.5, 0.0, 0],
  sponge_tubes: [0.7, 1.7, SPONGE, 0.5, 0.05, 0],
  sponge_barrel: [0.6, 1.5, SPONGE, 0.6, 0.05, 0],
  anemone: [0.6, 1.4, ANEM, 0.8, 0.02, 0],
  ghost_anemone: [0.7, 1.8, DEEP, 0.8, 0.02, 0],
  seagrass: [0.8, 1.6, WARM, 0.2, 0.0, 0],
  sea_whip: [0.7, 1.5, WARM, 0.3, 0.0, 0],
  kelp: [0.55, 1.25, WARM, 0.0, 0.2, 0],
  clam: [0.7, 1.4, NEUTRAL, 0.9, 0.05, 0],
  starfish: [0.5, 1.0, CORAL, 1.0, -0.01, 0],
  urchin: [0.6, 1.3, NEUTRAL, 1.0, -0.05, 0],
  lantern_stalk: [0.7, 1.9, DEEP, 0.2, 0.05, 0],
  tube_worms: [0.8, 1.8, NEUTRAL, 0.5, 0.05, 0],
  rock0: [0.8, 3.6, WARM, 0.6, 0.25, 0.8],
  rock1: [0.8, 3.6, WARM, 0.6, 0.25, 0.7],
  rock2: [0.8, 3.2, WARM, 0.6, 0.25, 0.8],
  spire0: [0.7, 1.7, WARM, 0.0, 0.5, 0],
  spire1: [0.7, 1.7, WARM, 0.0, 0.5, 0],
  basalt: [0.8, 1.7, NEUTRAL, 0.0, 0.3, 0],
};

const CLEAR = [
  [SITES.spawn.x, SITES.spawn.z, 6],
  ...SITES.bells.map((b) => [b.x, b.z, 7]),
  [SITES.wreck.x, SITES.wreck.z, 27],
  [SITES.choir.x, SITES.choir.z, 50],
  [SITES.whaleFall.x, SITES.whaleFall.z, 13],
];

function pick(rng, table) {
  let r = rng();
  for (let i = 0; i < table.length; i += 2) {
    r -= table[i + 1];
    if (r < 0) return table[i];
  }
  return null;
}

const REEF_MOUND = ['coral_staghorn0', 0.1, 'coral_staghorn1', 0.1, 'coral_brain', 0.07, 'coral_table', 0.07, 'sponge_tubes', 0.06,
  'sponge_barrel', 0.03, 'coral_fan0', 0.035, 'coral_fan1', 0.035, 'anemone', 0.06, 'rock0', 0.02, 'rock2', 0.02, 'clam', 0.015, 'urchin', 0.015];
const REEF_SAND = ['starfish', 0.006, 'rock1', 0.006, 'urchin', 0.004, 'clam', 0.003, 'coral_brain', 0.004];
const KELP_FLOOR = ['rock0', 0.012, 'rock1', 0.012, 'urchin', 0.012, 'coral_fan0', 0.008, 'sponge_tubes', 0.01, 'starfish', 0.004];
const KELP_ROCK = ['sponge_tubes', 0.07, 'coral_fan1', 0.06, 'anemone', 0.06, 'sponge_barrel', 0.03, 'coral_table', 0.03];
const SHELF = ['rock0', 0.01, 'rock2', 0.01, 'spire0', 0.0012, 'spire1', 0.0012, 'coral_fan0', 0.015, 'coral_fan1', 0.012,
  'sponge_tubes', 0.012, 'sea_whip', 0.03, 'anemone', 0.008, 'sponge_barrel', 0.008];
const WALL = ['sea_whip', 0.06, 'ghost_anemone', 0.03, 'coral_fan1', 0.02, 'rock1', 0.01, 'lantern_stalk', 0.012];
const GORGE_T = ['lantern_stalk', 0.07, 'ghost_anemone', 0.07, 'sea_whip', 0.04, 'rock2', 0.01];
const ABYSS = ['rock0', 0.004, 'rock2', 0.004, 'spire0', 0.0007, 'spire1', 0.0007, 'basalt', 0.001];
const ABYSS_GARDEN = ['lantern_stalk', 0.06, 'ghost_anemone', 0.05, 'basalt', 0.002];

// Returns Map<type, Array<{x, y, z, rot, scale, tint, n}>>.
export function generateScatter(seed = 1234, spacing = 2.0) {
  const rng = mulberry32(seed);
  const out = new Map(Object.keys(TYPES).map((k) => [k, []]));
  for (let gz = WORLD.zMin + 20; gz < WORLD.zMax - 20; gz += spacing) {
    for (let gx = WORLD.xMin + 20; gx < WORLD.xMax - 20; gx += spacing) {
      const x = gx + (rng() - 0.5) * spacing;
      const z = gz + (rng() - 0.5) * spacing;
      const rA = rng();
      const rB = rng();
      const rC = rng();
      const rD = rng();
      const d = depthAt(x, z);
      if (d < 3.5) continue;
      let blocked = false;
      for (const c of CLEAR) {
        if ((x - c[0]) ** 2 + (z - c[1]) ** 2 < c[2] * c[2]) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const s = -z;
      const n = normalAt(x, z);
      const steep = n[1] < 0.72;
      let type = null;
      const sub = mulberry32((rA * 4294967296) >>> 0);
      if (d < 27 && s < 250) {
        const bm = bommieMask(x, z);
        if (bm > 0.16) type = pick(sub, REEF_MOUND);
        else if (fbm2(x * 0.03, z * 0.03, 3, 21) > 0.12 && rB < 0.3) type = 'seagrass';
        else type = pick(sub, REEF_SAND);
      } else if (s < 352 && d < 60) {
        const patch = fbm2(x * 0.018, z * 0.018, 3, 33);
        if (steep) type = pick(sub, KELP_ROCK);
        else if (d > 21 && patch > -0.08 && rB < 0.17 * smoothstep(-0.08, 0.15, patch)) type = 'kelp';
        else type = pick(sub, KELP_FLOOR);
      } else if (d < 82) {
        type = pick(sub, SHELF);
        if (!type && d > 21 && rB < 0.03 && fbm2(x * 0.02, z * 0.02, 3, 33) > 0.25) type = 'kelp';
      } else if (d < 163) {
        if (n[1] < 0.45) continue;
        type = pick(sub, gorgeMask(x, z) > 0.3 ? GORGE_T : WALL);
      } else {
        const dv = Math.hypot(x - SITES.vents.x, z - SITES.vents.z);
        const garden = fbm2(x * 0.014, z * 0.014, 3, 44);
        if (dv < 48 && rB < 0.11 * smoothstep(48, 20, dv)) type = 'tube_worms';
        else if (garden > 0.16) type = pick(sub, ABYSS_GARDEN);
        else type = pick(sub, ABYSS);
      }
      if (!type) continue;
      const t = TYPES[type];
      const big = type.startsWith('spire') || type === 'basalt';
      if (big && (steep || Math.hypot(x - SITES.vents.x, z - SITES.vents.z) < 30)) continue;
      const scale = t[0] + (t[1] - t[0]) * rC * rC;
      const tint = t[2][Math.floor(rD * t[2].length) % t[2].length];
      const k = t[3];
      const nn = [n[0] * k, 1 - k + n[1] * k, n[2] * k];
      const l = Math.hypot(nn[0], nn[1], nn[2]);
      out.get(type).push({ x, y: heightAt(x, z) - t[4] * scale, z, rot: rB * Math.PI * 2, scale, tint, n: [nn[0] / l, nn[1] / l, nn[2] / l] });
    }
  }
  return out;
}

// Sphere colliders for the instances big enough to bump into.
export function scatterColliders(scatter) {
  const list = [];
  for (const [type, items] of scatter) {
    const cr = TYPES[type][5];
    for (const it of items) {
      if (type.startsWith('spire')) {
        for (let k = 0; k < 5; k++) list.push([it.x, it.y + (0.8 + k * 1.9) * it.scale, it.z, (1.9 - k * 0.3) * it.scale]);
      } else if (type === 'basalt') {
        list.push([it.x, it.y + 1.2 * it.scale, it.z, 2.6 * it.scale], [it.x, it.y + 4.2 * it.scale, it.z, 1.6 * it.scale]);
      } else if (cr > 0 && it.scale > 1.6) {
        list.push([it.x, it.y + 0.2 * it.scale, it.z, cr * it.scale]);
      }
    }
  }
  return list;
}
