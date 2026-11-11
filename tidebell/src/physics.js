// Submersible motion and collision. Pure functions over plain objects so they can be unit tested.
import { WORLD } from './terrain.js';

export const SUB_RADIUS = 1.35;
const ACCEL = 15;
const BOOST = 2.1;
const DRAG = 1.25;
const SURFACE_Y = -1.6;

// Spatial hash of sphere colliders: [x, y, z, r].
// Each sphere is registered in every cell it could touch a querying body from (pad = the largest body radius),
// so a query only needs the single cell under the body's centre.
export function buildColliderGrid(spheres, cell = 16, pad = 1.5) {
  const map = new Map();
  for (const s of spheres) {
    const x0 = Math.floor((s[0] - s[3] - pad) / cell);
    const x1 = Math.floor((s[0] + s[3] + pad) / cell);
    const z0 = Math.floor((s[2] - s[3] - pad) / cell);
    const z1 = Math.floor((s[2] + s[3] + pad) / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = ix * 4096 + iz;
        let list = map.get(k);
        if (!list) map.set(k, (list = []));
        list.push(s);
      }
    }
  }
  return {
    cell,
    query(x, z) {
      return map.get(Math.floor(x / cell) * 4096 + Math.floor(z / cell)) ?? [];
    },
  };
}

// Push a sphere out of the seabed and any colliders. Mutates pos/vel, returns true on contact.
export function resolveSphere(pos, vel, radius, env) {
  let hit = false;
  const h = env.heightAt(pos[0], pos[2]);
  if (pos[1] < h + radius) {
    const n = env.normalAt(pos[0], pos[2]);
    pos[1] = h + radius;
    if (vel) {
      const vn = vel[0] * n[0] + vel[1] * n[1] + vel[2] * n[2];
      if (vn < 0) {
        vel[0] -= vn * n[0];
        vel[1] -= vn * n[1];
        vel[2] -= vn * n[2];
      }
    }
    hit = true;
  }
  if (env.colliders) {
    for (const s of env.colliders.query(pos[0], pos[2])) {
      const dx = pos[0] - s[0];
      const dy = pos[1] - s[1];
      const dz = pos[2] - s[2];
      const rr = s[3] + radius;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        pos[0] = s[0] + nx * rr;
        pos[1] = s[1] + ny * rr;
        pos[2] = s[2] + nz * rr;
        if (vel) {
          const vn = vel[0] * nx + vel[1] * ny + vel[2] * nz;
          if (vn < 0) {
            vel[0] -= vn * nx;
            vel[1] -= vn * ny;
            vel[2] -= vn * nz;
          }
        }
        hit = true;
      }
    }
  }
  return hit;
}

// Advance the sub by dt. input.thrust is a world-space vector with length <= 1.
export function stepSub(sub, input, dt, env) {
  const { pos, vel } = sub;
  const k = ACCEL * (input.boost ? BOOST : 1);
  vel[0] += input.thrust[0] * k * dt;
  vel[1] += input.thrust[1] * k * dt;
  vel[2] += input.thrust[2] * k * dt;

  // The hull is only rated to a certain depth: past it, buoyancy shoves the sub back up.
  const over = Math.max(0, -pos[1] - env.depthLimit);
  if (over > 0) vel[1] += Math.min(over * 6, 40) * dt;

  // Soft currents at the edge of the map.
  const m = 26;
  if (pos[0] < WORLD.xMin + m) vel[0] += (WORLD.xMin + m - pos[0]) * 3 * dt;
  if (pos[0] > WORLD.xMax - m) vel[0] -= (pos[0] - WORLD.xMax + m) * 3 * dt;
  if (pos[2] < WORLD.zMin + m) vel[2] += (WORLD.zMin + m - pos[2]) * 3 * dt;
  if (pos[2] > WORLD.zMax - m) vel[2] -= (pos[2] - WORLD.zMax + m) * 3 * dt;

  const damp = Math.exp(-DRAG * dt);
  vel[0] *= damp;
  vel[1] *= damp;
  vel[2] *= damp;
  pos[0] += vel[0] * dt;
  pos[1] += vel[1] * dt;
  pos[2] += vel[2] * dt;

  if (pos[1] > SURFACE_Y) {
    pos[1] = SURFACE_Y;
    if (vel[1] > 0) vel[1] = 0;
  }
  const hit = resolveSphere(pos, vel, SUB_RADIUS, env);
  return { hit, over };
}
