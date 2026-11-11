// Autopilot used by the automated playthrough (?bot). It only produces the same three analogue inputs a
// keyboard or touch player produces (turn, thrust, climb); it never moves the player directly.
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function botInput(G, W) {
  const b = G.bot, p = G.pos;
  let tx, ty, tz;
  if (!G.unlocked) {
    if (!b.target || !b.target.alive) { // nearest remaining orb; height differences cost extra
      let best = null, bd = 1e9;
      for (const o of W.orbs) if (o.alive) { const d = Math.hypot(o.x - p.x, (o.y - p.y) * 1.5, o.z - p.z); if (d < bd) { bd = d; best = o; } }
      b.target = best; b.best = 1e9; b.bestT = G.t;
    }
    tx = b.target.x; ty = W.orbBobY(b.target, G.t) - 0.7; tz = b.target.z;
  } else { // line up in front of the gate, then fly through the centre opening
    if (!b.gate) { b.gate = 'approach'; b.best = 1e9; b.bestT = G.t; }
    if (b.gate === 'approach' && Math.hypot(p.x, p.z - 26) < 4 && Math.abs(p.y - 5) < 2.5) { b.gate = 'through'; b.best = 1e9; b.bestT = G.t; }
    tx = 0; ty = W.Y0 + 3.4; tz = b.gate === 'approach' ? 26 : -16;
  }
  // if the straight line to the target passes through the stone of the gate, go via the centre opening
  if ((p.z > 0) !== (tz > 0)) {
    const f = p.z / (p.z - tz), ax = Math.abs(p.x + (tx - p.x) * f), y = p.y + (ty - p.y) * f;
    const solid = (ax < 5.4 && y < W.Y0 + 12.6) || (ax < 8.8 && y < W.Y0 + 9.4), open = ax < 2.4 && y < W.Y0 + 5.4 && y > W.Y0 + 1.2;
    if (solid && !open) {
      const near = p.z > 0 ? 9 : -9;
      if (Math.abs(p.x) < 1.6 && Math.abs(p.y - (W.Y0 + 3.2)) < 1.6) { tx = 0; ty = W.Y0 + 3.2; tz = -near; } // lined up: go straight through
      else { tx = 0; ty = W.Y0 + 3.2; tz = near; }
    }
  }
  let dx = tx - p.x, dy = ty - p.y, dz = tz - p.z;
  const dist = Math.hypot(dx, dy, dz), horiz = Math.hypot(dx, dz);
  // stuck detection: if no progress for a while (e.g. pressed against the gate wall), climb over the obstacle
  if (dist < b.best - 1.5) { b.best = dist; b.bestT = G.t; }
  if (G.t - b.bestT > 2.5) { b.escapeUntil = G.t + 1.8; b.best = 1e9; b.bestT = G.t + 1.8; }
  const escaping = b.escapeUntil && G.t < b.escapeUntil;

  let sx = dx / (dist || 1), sy = dy / (dist || 1), sz = dz / (dist || 1);
  const ux = sx, uy = sy, uz = sz;
  for (const r of W.rocks) { // steer around floating rocks that sit between us and the target
    const c = r.g.position, rx = c.x - p.x, ry = c.y - p.y, rz = c.z - p.z, along = rx * ux + ry * uy + rz * uz;
    const R = r.s * 2.1 + 3;
    if (along < 0 || along > 45 || along > dist + R * 0.3) continue;
    if (Math.hypot(tx - c.x, ty - c.y, tz - c.z) < R * 1.5) continue; // the orb sits on this rock: approach it directly
    let px = rx - ux * along, py = ry - uy * along, pz = rz - uz * along; const pd = Math.hypot(px, py, pz);
    if (pd > R) continue;
    if (pd < 0.3) { px = 0; py = -1; pz = 0; } else { px /= pd; py /= pd; pz /= pd; }
    const w = (1 - pd / R) * 2.6 * (1 - along / 45);
    sx -= px * w; sy -= py * w * 1.3 - w * 0.25; sz -= pz * w;
  }
  for (const s of W.spires) { // and around peaks
    if (p.y > s.H + 4) continue;
    const rx = s.x - p.x, rz = s.z - p.z, hl = Math.hypot(ux, uz) || 1, hx = ux / hl, hz = uz / hl, along = rx * hx + rz * hz;
    const R = W.spireRadius(s, p.y) + 9;
    if (along < 0 || along > 70 || along > horiz + R * 0.3) continue;
    let px = rx - hx * along, pz = rz - hz * along; const pd = Math.hypot(px, pz);
    if (pd > R) continue;
    if (pd < 0.3) { px = hz; pz = -hx; } else { px /= pd; pz /= pd; }
    const w = (1 - pd / R) * 3.0 * (1 - along / 70);
    sx -= px * w; sz -= pz * w;
  }
  const err = wrapPi(Math.atan2(-sx, -sz) - G.yaw);
  let thrust = Math.abs(err) > 1.2 ? 0.15 : Math.abs(err) > 0.5 ? 0.45 : 1;
  if (horiz < 16 && Math.abs(err) > 0.35) thrust = 0.05; // close but not facing it: turn on the spot instead of orbiting
  if (horiz < 9) thrust = Math.min(thrust, 0.22 + horiz / 12);
  if (Math.abs(dy) > horiz * 0.45 + 1.5) thrust = Math.min(thrust, horiz < 5 ? 0.04 : 0.35); // climb first, then close in
  const eta = Math.max(horiz / Math.max(Math.abs(G.fwd), 6), 0.35);
  let climb = clamp((dy / eta + clamp(sy - uy, -0.5, 0.5) * 22) / 16, -1, 1);
  if (escaping) { climb = 1; thrust = 0.5; }
  return { turn: clamp(err * 2.2, -1, 1), thrust, climb };
}
