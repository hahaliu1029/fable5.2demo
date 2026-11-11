// Reads a nod (yes) or a head shake (no) out of raw mouse-look deltas: three or more quick reversals along one
// axis, with that axis clearly dominant.
export function createGesture({ minSwing = 28, window = 1.3, swings = 3 } = {}) {
  const axes = { x: { dir: 0, run: 0, marks: [] }, y: { dir: 0, run: 0, marks: [] } };
  const travel = [];

  const reset = () => {
    for (const a of Object.values(axes)) { a.dir = 0; a.run = 0; a.marks.length = 0; }
    travel.length = 0;
  };

  const step = (a, d, t) => {
    if (d === 0) return;
    const dir = Math.sign(d);
    if (dir === a.dir) { a.run += Math.abs(d); return; }
    if (a.run >= minSwing) a.marks.push(t);
    a.dir = dir; a.run = Math.abs(d);
  };

  return {
    reset,
    feed(dx, dy, t) {
      step(axes.x, dx, t);
      step(axes.y, dy, t);
      travel.push([t, Math.abs(dx), Math.abs(dy)]);
      while (travel.length && travel[0][0] < t - window) travel.shift();
      let sx = 0;
      let sy = 0;
      for (const [, ax, ay] of travel) { sx += ax; sy += ay; }
      for (const [name, a, mine, other] of [['no', axes.x, sx, sy], ['yes', axes.y, sy, sx]]) {
        while (a.marks.length && a.marks[0] < t - window) a.marks.shift();
        const live = a.marks.length + (a.run >= minSwing ? 1 : 0);
        if (live >= swings + 1 && mine > other * 1.8) { reset(); return name; }
      }
      return null;
    },
  };
}
