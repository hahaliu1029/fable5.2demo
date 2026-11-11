// Is a sphere inside the camera's view pyramid? cam: { pos, fwd, right, up, tanH, tanV } with unit basis vectors.
// Occlusion is ignored on purpose: "could be seen" is the bar for the house holding still.
export function inView(cam, p, radius = 0, margin = 0) {
  const d = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]];
  const z = d[0] * cam.fwd[0] + d[1] * cam.fwd[1] + d[2] * cam.fwd[2];
  if (z < -radius) return false;
  const x = d[0] * cam.right[0] + d[1] * cam.right[1] + d[2] * cam.right[2];
  const y = d[0] * cam.up[0] + d[1] * cam.up[1] + d[2] * cam.up[2];
  const zz = Math.max(z, 0);
  const th = cam.tanH + margin;
  const tv = cam.tanV + margin;
  return Math.abs(x) <= zz * th + radius * Math.sqrt(1 + th * th) && Math.abs(y) <= zz * tv + radius * Math.sqrt(1 + tv * tv);
}
