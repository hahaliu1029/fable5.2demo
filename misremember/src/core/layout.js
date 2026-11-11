// Plan-space geometry for rooms and doorways. A room occupies x in [0,w], y in [0,d]; walls are S (y=0), N (y=d),
// W (x=0), E (x=w). Rooms are separate chunks that get attached to one another door to door, so the house can
// be rearranged whenever nobody is looking.
const SIDES = {
  S: { a: [1, 0], n: [0, 1], o: () => [0, 0] },
  N: { a: [1, 0], n: [0, -1], o: (w, d) => [0, d] },
  W: { a: [0, 1], n: [1, 0], o: () => [0, 0] },
  E: { a: [0, 1], n: [-1, 0], o: (w) => [w, 0] },
};

// Where a doorway is: p = centre of the opening on the outer wall plane, n = outward normal, a = direction of
// increasing s along the wall, s0/s1 = the jambs, hinge = the hinge point (on the door plane, at s0).
export function doorFrame(house, room, door) {
  const side = SIDES[door.wall];
  const [w, d] = room.size;
  const o = side.o(w, d);
  const width = door.w ?? house.door.w;
  const T = house.wallT;
  const at = (s, dep) => [o[0] + side.a[0] * s - side.n[0] * dep, o[1] + side.a[1] * s - side.n[1] * dep];
  return {
    id: door.id, wall: door.wall, at: door.at, w: width, h: door.h ?? house.door.h, T,
    s0: door.at - width / 2, s1: door.at + width / 2,
    p: at(door.at, T), n: [0 - side.n[0], 0 - side.n[1]], a: [...side.a], hinge: at(door.at - width / 2, T),
    inner: at(door.at, 0),
    swing: side.a[0] * side.n[1] - side.a[1] * side.n[0], // sign of the rotation that swings the leaf into the room
  };
}

// Rigid transform (rotation about z, then translation) taking room B's plan coordinates into room A's, such that
// B's doorway lands on A's doorway with the two rooms on opposite sides of it.
export function attach(a, b) {
  const rot = Math.atan2(-a.n[1], -a.n[0]) - Math.atan2(b.n[1], b.n[0]);
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { rot, tx: a.p[0] - (c * b.p[0] - s * b.p[1]), ty: a.p[1] - (s * b.p[0] + c * b.p[1]) };
}

export function applyT(t, [x, y]) {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return [c * x - s * y + t.tx, s * x + c * y + t.ty];
}

export function invertT(t) {
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { rot: -t.rot, tx: -(c * t.tx + s * t.ty), ty: -(-s * t.tx + c * t.ty) };
}

// Signed distance beyond the door plane (positive = outside the room) and position along the wall.
export function doorCoords(f, [x, y]) {
  const dx = x - f.p[0];
  const dy = y - f.p[1];
  return { out: dx * f.n[0] + dy * f.n[1], s: f.at + dx * f.a[0] + dy * f.a[1] };
}

// True when a step from prev to next passes outward through the doorway.
export function crossed(f, prev, next) {
  const a = doorCoords(f, prev);
  const b = doorCoords(f, next);
  return a.out <= 0 && b.out > 0 && b.s > f.s0 && b.s < f.s1;
}
