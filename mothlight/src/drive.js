// Driving rules with no rendering in them: the car's motion and collisions, the gate route, ground traffic.
import { N, PITCH, BOUND, blockCenter, districtAt } from './city.js';

// Centre lines of the ten roads in each direction (the outermost pair is the ring road).
export const ROADS = Array.from({ length: N + 1 }, (_, k) => (k - N / 2) * PITCH);
export const CAR = { r: 0.98, half: 1.4, maxSpeed: 44, boostSpeed: 64, accel: 21, boostAccel: 34, brake: 36, reverse: 12 };
export const LANE = 3.3;
const OFFSETS = [1, -1, 0]; // nose, tail, then the middle again: collision circles along the body, in units of CAR.half

export function newCar(x, z, yaw = 0) {
  return { x, z, yaw, vx: 0, vz: 0, boost: 1, slip: 0, speed: 0 };
}

const overlaps = (b, x, z, r) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && b.y0 < 1.4 && b.y1 > 0.15;

// Advance the car by dt. input: { throttle -1..1, steer -1..1 (positive = left), handbrake, boost }.
// query(minX, maxX, minZ, maxZ) returns candidate boxes. Returns { hit: impact speed, slip }.
export function stepCar(c, input, dt, query) {
  let fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
  let vf = c.vx * fx + c.vz * fz;          // along the car
  let vr = c.vx * -fz + c.vz * fx;         // sideways (to the car's right)

  const boosting = input.boost && c.boost > 0.02 && input.throttle > 0;
  const top = boosting ? CAR.boostSpeed : CAR.maxSpeed;
  if (input.throttle > 0) vf += (boosting ? CAR.boostAccel : CAR.accel) * input.throttle * Math.max(0, 1 - Math.max(vf / top, 0) ** 3) * dt;
  else if (input.throttle < 0) vf += (vf > 0.5 ? CAR.brake : CAR.reverse * Math.max(0, 1 + vf / 14)) * input.throttle * dt;
  vf *= Math.exp(-(input.throttle === 0 ? 0.45 : 0.12) * dt);
  if (input.handbrake) vf *= Math.exp(-0.9 * dt);

  // Steering authority fades with speed; the handbrake lets the tail step out.
  const grip01 = Math.min(1, Math.abs(vf) / 7);
  const rate = (2.5 - 1.3 * Math.min(1, Math.abs(vf) / CAR.maxSpeed)) * (input.handbrake ? 1.35 : 1);
  c.yaw += input.steer * rate * grip01 * Math.sign(vf || 1) * dt;
  vr *= Math.exp(-(input.handbrake ? 1.5 : 6.5) * dt);

  // The velocity was resolved against the old heading; re-express it against the new one so turning creates slip.
  const vx0 = fx * vf - fz * vr, vz0 = fz * vf + fx * vr;
  fx = -Math.sin(c.yaw); fz = -Math.cos(c.yaw);
  c.slip = vx0 * -fz + vz0 * fx;
  c.vx = vx0; c.vz = vz0;

  c.boost = boosting ? Math.max(0, c.boost - dt / 3.2) : Math.min(1, c.boost + dt * (0.06 + Math.min(Math.abs(c.slip), 14) * 0.022));

  // Move the middle of the car one axis at a time, pushing out of anything solid and losing most of the speed into it.
  let hit = 0;
  const reach = CAR.half + CAR.r + Math.max(Math.abs(c.vx), Math.abs(c.vz)) * dt + 0.5;
  const near = query(c.x - reach, c.x + reach, c.z - reach, c.z + reach);
  const dx = c.vx * dt;
  c.x += dx;
  for (const b of near) {
    if (!overlaps(b, c.x, c.z, CAR.r)) continue;
    const low = dx > 0 || (dx === 0 && c.x - b.minX < b.maxX - c.x);
    c.x = low ? b.minX - CAR.r - 1e-4 : b.maxX + CAR.r + 1e-4;
    hit = Math.max(hit, Math.abs(c.vx)); c.vx *= -0.22; c.vz *= 0.82;
  }
  const dz = c.vz * dt;
  c.z += dz;
  for (const b of near) {
    if (!overlaps(b, c.x, c.z, CAR.r)) continue;
    const low = dz > 0 || (dz === 0 && c.z - b.minZ < b.maxZ - c.z);
    c.z = low ? b.minZ - CAR.r - 1e-4 : b.maxZ + CAR.r + 1e-4;
    hit = Math.max(hit, Math.abs(c.vz)); c.vz *= -0.22; c.vx *= 0.82;
  }
  // The nose and tail are solid too: push the car out along the shallowest side wherever they (or, after that, the middle) overlap.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const o of OFFSETS) {
      for (const b of near) {
        const px = c.x + fx * o * CAR.half, pz = c.z + fz * o * CAR.half;
        if (!overlaps(b, px, pz, CAR.r)) continue;
        const pen = [px + CAR.r - b.minX, b.maxX - (px - CAR.r), pz + CAR.r - b.minZ, b.maxZ - (pz - CAR.r)];
        const k = pen.indexOf(Math.min(...pen)), e = pen[k] + 1e-4;
        if (k === 0) c.x -= e; else if (k === 1) c.x += e; else if (k === 2) c.z -= e; else c.z += e;
        const v = k < 2 ? c.vx : c.vz, into = (k % 2 === 0 ? 1 : -1) * v; // moving into the face?
        if (into > 0) { hit = Math.max(hit, into); if (k < 2) { c.vx *= -0.22; c.vz *= 0.82; } else { c.vz *= -0.22; c.vx *= 0.82; } }
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (Math.abs(c.x) > BOUND) { c.x = Math.sign(c.x) * BOUND; c.vx *= -0.2; }
  if (Math.abs(c.z) > BOUND) { c.z = Math.sign(c.z) * BOUND; c.vz *= -0.2; }
  c.speed = Math.hypot(c.vx, c.vz);
  return { hit, slip: c.slip, boosting };
}

// The Signal Run: twelve gates on the streets, through every district, ending in front of the Spire.
// Each entry: [road axis the car travels along, road index, block index the gate sits beside].
const ROUTE = [['x', 5, 5], ['z', 7, 5], ['x', 7, 6], ['z', 8, 3], ['x', 2, 6], ['z', 5, 1], ['x', 1, 2], ['z', 1, 3], ['x', 4, 2], ['z', 2, 6], ['x', 8, 3], ['z', 4, 5]];
export function makeRoute() {
  const gates = ROUTE.map(([axis, k, i], n) => {
    const along = blockCenter(i), line = ROADS[k];
    const x = axis === 'x' ? along : line, z = axis === 'x' ? line : along;
    return { n, axis, x, z, district: districtAt(x + (axis === 'x' ? 0 : 20), z + (axis === 'x' ? 20 : 0)) };
  });
  return { gates, start: { x: 0, z: 38, yaw: -Math.PI / 2 }, finish: { x: 0, z: 24, r: 7 } };
}
// True when the move from (x0, z0) to (x1, z1) crosses the gate's line between its pylons.
export function crossesGate(g, x0, z0, x1, z1) {
  const [a0, a1, b0, b1] = g.axis === 'x' ? [x0 - g.x, x1 - g.x, z0 - g.z, z1 - g.z] : [z0 - g.z, z1 - g.z, x0 - g.x, x1 - g.x];
  if ((a0 > 0) === (a1 > 0)) return false;
  const t = a0 / (a0 - a1);
  return Math.abs(b0 + (b1 - b0) * t) < 7.2;
}

// Ground traffic: each car keeps to one lane of one road and wraps round at the edge of the island.
export function makeTraffic(rnd, count = 46) {
  const cars = [];
  for (let k = 0; k < count; k++) {
    const dir = rnd() < 0.5 ? 1 : -1, axis = rnd() < 0.5 ? 'x' : 'z';
    cars.push({ axis, dir, line: ROADS[1 + Math.floor(rnd() * (N - 1))] + dir * (axis === 'x' ? LANE : -LANE), s0: rnd() * 2 * BOUND, v: 9 + rnd() * 9, van: rnd() < 0.3, hue: rnd() });
  }
  return cars;
}
export function trafficAt(car, t, out = {}) {
  const span = 2 * BOUND;
  const s = ((((car.s0 + car.dir * car.v * t) % span) + span) % span) - BOUND;
  out.x = car.axis === 'x' ? s : car.line;
  out.z = car.axis === 'x' ? car.line : s;
  out.yaw = car.axis === 'x' ? (car.dir > 0 ? -Math.PI / 2 : Math.PI / 2) : car.dir > 0 ? Math.PI : 0;
  out.edge = Math.min(1, (BOUND - Math.abs(s)) / 12); // 0 at the wrap point, so cars can fade in and out there
  return out;
}
