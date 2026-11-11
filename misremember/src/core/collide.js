// Player movement inside one room: axis-aligned walls, open doorways and furniture footprints.
import { doorCoords } from './layout.js';

const JAMB = 0.17; // how close the player's centre may get to a door jamb while in the doorway

// ctx: { room, frames, open: [door ids that can be walked through], colliders: [[x0,y0,x1,y1,h]], r }
export function move(ctx, pos, delta) {
  const { room, frames, open, colliders, r } = ctx;
  const [w, d] = room.size;
  let x = pos[0] + delta[0];
  let y = pos[1] + delta[1];

  // a doorway the player is lined up with lets them past the wall, as far as just beyond the door plane
  let slot = null;
  for (const f of frames) {
    if (!open.includes(f.id)) continue;
    const c = doorCoords(f, [x, y]);
    const was = doorCoords(f, pos);
    const lined = c.s > f.s0 + JAMB * 0.6 && c.s < f.s1 - JAMB * 0.6;
    if ((lined && c.out > -f.T - r - 0.02) || was.out > -f.T - r + 0.01) { slot = f; break; }
  }
  const lo = [r, r];
  const hi = [w - r, d - r];
  if (slot) {
    const c = doorCoords(slot, [x, y]);
    const past = c.out > -slot.T - r; // beyond the line the wall would hold the player at
    if (past) {
      const s = Math.min(Math.max(c.s, slot.s0 + JAMB), slot.s1 - JAMB);
      const out = Math.min(c.out, 0.06);
      x = slot.p[0] + slot.n[0] * out + slot.a[0] * (s - slot.at);
      y = slot.p[1] + slot.n[1] * out + slot.a[1] * (s - slot.at);
    }
    // relax the wall the door is in
    if (slot.wall === 'W') lo[0] = -1; else if (slot.wall === 'E') hi[0] = w + 1;
    else if (slot.wall === 'S') lo[1] = -1; else hi[1] = d + 1;
  }
  x = Math.min(Math.max(x, lo[0]), hi[0]);
  y = Math.min(Math.max(y, lo[1]), hi[1]);

  for (const [x0, y0, x1, y1] of colliders) {
    const ax0 = x0 - r, ay0 = y0 - r, ax1 = x1 + r, ay1 = y1 + r;
    if (x <= ax0 || x >= ax1 || y <= ay0 || y >= ay1) continue;
    // leave by the shallowest side that does not put the player through a wall
    const exits = [[x - ax0, ax0, y], [ax1 - x, ax1, y], [y - ay0, x, ay0], [ay1 - y, x, ay1]]
      .filter(([, ex, ey]) => ex >= lo[0] - 1e-9 && ex <= hi[0] + 1e-9 && ey >= lo[1] - 1e-9 && ey <= hi[1] + 1e-9)
      .sort((a, b) => a[0] - b[0]);
    if (exits.length) { x = exits[0][1]; y = exits[0][2]; }
  }
  return [x, y];
}
