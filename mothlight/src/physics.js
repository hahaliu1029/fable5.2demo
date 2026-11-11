// Axis-separated AABB collision for the player against static boxes and the ground plane (y = 0).
export const PLAYER = { r: 0.4, h: 1.75, eye: 1.62 };
const EPS = 1e-4;

function hits(b, p) {
  return p.x + PLAYER.r > b.minX && p.x - PLAYER.r < b.maxX
    && p.z + PLAYER.r > b.minZ && p.z - PLAYER.r < b.maxZ
    && p.y < b.y1 && p.y + PLAYER.h > b.y0;
}

// p: { x, y (feet), z, vx, vy, vz, onGround }. query(minX, maxX, minZ, maxZ) returns candidate boxes.
export function stepPlayer(p, dt, query) {
  const reach = PLAYER.r + Math.max(Math.abs(p.vx), Math.abs(p.vz)) * dt + 0.5;
  const near = query(p.x - reach, p.x + reach, p.z - reach, p.z + reach);

  const dx = p.vx * dt;
  p.x += dx;
  for (const b of near) {
    if (!hits(b, p)) continue;
    // With no motion on this axis (e.g. a restored position inside a box) leave by the nearest side.
    const low = dx > 0 || (dx === 0 && p.x - b.minX < b.maxX - p.x);
    p.x = low ? b.minX - PLAYER.r - EPS : b.maxX + PLAYER.r + EPS;
    p.vx = 0;
  }

  const dz = p.vz * dt;
  p.z += dz;
  for (const b of near) {
    if (!hits(b, p)) continue;
    const low = dz > 0 || (dz === 0 && p.z - b.minZ < b.maxZ - p.z);
    p.z = low ? b.minZ - PLAYER.r - EPS : b.maxZ + PLAYER.r + EPS;
    p.vz = 0;
  }

  const dy = p.vy * dt;
  p.y += dy;
  p.onGround = false;
  for (const b of near) {
    if (!hits(b, p)) continue;
    if (dy <= 0) { p.y = b.y1; p.onGround = true; } else { p.y = b.y0 - PLAYER.h; }
    p.vy = 0;
  }
  if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
  return p;
}
