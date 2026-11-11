"""Rocks, the shipwreck, the drowned ruins, tide bells, vents and the whale fall."""
import math
import random
from math import sin, cos, pi

from mathutils import Vector

from common import (Geo, hexc, mixc, mulc, with_a, sstep, curve, fbm, vor, lerp, clamp, finalize, uvsphere, icosphere,
                    lathe, tube, wing, sheet, box, rot, trans, scl)

GLOW = hexc('#ffffff', 1.0)


def rock_paint(base_a, base_b, top):
    def f(p, n, c):
        k = 0.5 + 0.5 * fbm(p, 4, 0.9)
        col = mixc(base_a, base_b, k)
        f1, f2 = vor(p, 1.7)
        col = mulc(col, 1 - 0.35 * sstep(0.08, 0.0, f2 - f1))
        return mixc(col, top, sstep(0.35, 0.85, n.z) * (0.55 + 0.35 * fbm(p, 2, 2.0)))
    return f


def build_rocks():
    grey, brown, algae = hexc('#5d5a55'), hexc('#3c362f'), hexc('#5f7052')
    shapes = [(1.0, 0.85, 0.7), (1.3, 0.8, 0.55), (0.8, 1.0, 0.95)]
    for n, s in enumerate(shapes):
        g = icosphere(3, 1.0)
        off = Vector((n * 7.1, n * 3.3, 0))

        def disp(p, s=s, off=off):
            q = p + off
            r = 1 + 0.32 * fbm(q, 4, 0.9) + 0.12 * fbm(q, 3, 2.7)
            f1, f2 = vor(q, 1.3)
            r -= 0.12 * sstep(0.15, 0.0, f2 - f1)
            return Vector((p.x * r * s[0], p.y * r * s[1], max(p.z * r * s[2], -0.3)))

        g.displace(disp)
        finalize(g, f'rock{n}', ao=0.65, smooth_angle=38, paint_n=rock_paint(grey, brown, algae))
    # Tall pinnacles (unit height 10 m).
    for n in range(2):
        prof = [(1.9, -0.5), (1.7, 1.0), (1.35, 3.0), (1.2, 5.0), (0.95, 7.0), (0.6, 8.8), (0.2, 9.8), (0.0, 10.0)]
        g = lathe(prof, seg=14)
        rings = []
        off = Vector((n * 11.0, 5.0, 0))

        def disp(p, off=off):
            q = p + off
            k = 1 + 0.4 * fbm((q.x, q.y, q.z * 0.35), 4, 0.5) + 0.15 * fbm(q, 3, 1.4)
            return Vector((p.x * k + 0.5 * fbm((q.z, 0, 3), 2, 0.2), p.y * k + 0.5 * fbm((q.z, 7, 1), 2, 0.2), p.z))

        g.displace(disp)
        finalize(g, f'spire{n}', ao=0.6, smooth_angle=38, paint_n=rock_paint(hexc('#56524e'), hexc('#2f2b27'), hexc('#4f6650')))
    # Natural arch.
    path, rad = [], []
    for i in range(15):
        a = pi * i / 14
        path.append((cos(a) * 7.0, 0.8 * sin(a * 2), sin(a) * 6.5 - 0.8))
        rad.append(2.4 - 1.0 * sin(a) + 0.3 * sin(a * 5))
    g = tube(path, rad, seg=10)
    g.displace(lambda p: p * (1 + 0.0) + Vector((fbm(p, 4, 0.35), fbm(p + Vector((9, 0, 0)), 4, 0.35), fbm(p + Vector((0, 9, 0)), 4, 0.35))) * 0.7)
    finalize(g, 'rock_arch', ao=0.7, smooth_angle=40, paint_n=rock_paint(grey, brown, algae),
             meta={'colliders': [[-7, 0, 0, 2.8], [-6, 0, 3.2, 2.2], [7, 0, 0, 2.8], [6, 0, 3.2, 2.2], [0, 0, 5.8, 1.6], [-3.5, 0, 5, 1.6], [3.5, 0, 5, 1.6]]})
    # Basalt column cluster.
    rng = random.Random(17)
    g = Geo()
    for q in range(-3, 4):
        for r in range(-3, 4):
            if abs(q + r) > 3:
                continue
            x = 0.9 * (q + r * 0.5)
            y = 0.9 * r * 0.866
            d = math.hypot(x, y)
            h = max(0.4, 6.5 - d * 1.5 + rng.uniform(-1.2, 1.2))
            col = mulc(hexc('#3a3d42'), rng.uniform(0.7, 1.15))
            c = lathe([(0.5, -0.5), (0.5, h), (0.0, h + 0.05)], seg=6, c=col)
            g.merge(c, trans(x, y, 0) @ rot('Z', 30))
    finalize(g, 'basalt', ao=0.7, smooth_angle=20,
             paint_n=lambda p, n, c: mixc(c, hexc('#2a3a3a'), sstep(0.5, 0.9, n.z) * 0.5))


def _hull_ring(t, jag=None):
    """Closed hull cross-section at t in [0 (stern), 1 (bow)]."""
    L, D, F = 44.0, 4.2, 2.6
    beam = curve([(0, 0.62), (0.08, 0.86), (0.25, 1.0), (0.7, 1.0), (0.88, 0.7), (0.97, 0.25), (1, 0.03)])
    B = 4.4 * beam(t)
    sheer = 1.6 * sstep(0.7, 1.0, t) ** 1.5 + 0.5 * sstep(0.2, 0.0, t)
    rise = 2.8 * sstep(0.12, 0.0, t)  # stern counter lifts the keel
    x0 = (t - 0.5) * L
    half = [(0.0, -D + rise), (0.5, -D + rise * 0.95), (0.86, -D * 0.72 + rise * 0.7), (1.0, -D * 0.3 + rise * 0.3),
            (1.0, F * 0.5 + sheer), (0.98, F + sheer), (0.9, F + sheer - 0.9)]
    pts = []
    for k, (by, z) in enumerate(half):
        rake = 2.2 * sstep(0.85, 1.0, t) * (z + D) / (D + F)
        pts.append((x0 + rake, B * by, z))
    full = pts + [(p[0], -p[1], p[2]) for p in reversed(pts[1:])]
    if jag:
        full = [(p[0] + jag(i), p[1], p[2]) for i, p in enumerate(full)]
    return full


def build_wreck():
    rng = random.Random(77)
    rust_a, rust_b = hexc('#7a3f1f'), hexc('#b4652a')

    def hull_paint(p, n, c):
        base = hexc('#5a231c') if p.z < -0.8 else hexc('#1f2a33')
        base = mixc(base, hexc('#c8c2ae'), sstep(0.2, 0.0, abs(p.z + 0.7)) * 0.5)
        k = 0.5 + 0.5 * fbm((p.x * 0.5, p.y * 0.5, p.z * 0.12), 4, 1.0)
        streak = sstep(0.42, 0.75, k)
        col = mixc(base, mixc(rust_a, rust_b, fbm(p, 3, 1.5) * 0.5 + 0.5), streak * 0.85)
        f1, f2 = vor(p, 0.55)
        col = mulc(col, 1 - 0.25 * sstep(0.04, 0.0, f2 - f1))
        col = mixc(col, hexc('#3f6b5a'), sstep(0.3, 0.9, n.z) * 0.7)
        spots, _ = vor(p, 2.4)
        return mixc(col, hexc('#d86a8a'), sstep(0.13, 0.05, spots) * 0.6)

    parts = []
    for name, t0, t1, n in (('aft', 0.0, 0.5, 16), ('fore', 0.6, 1.0, 14)):
        g = Geo()
        rings = []
        for i in range(n + 1):
            t = lerp(t0, t1, i / n)
            jag = None
            if (name == 'aft' and i == n) or (name == 'fore' and i == 0):
                sgn = 1 if name == 'aft' else -1
                js = [rng.uniform(-0.2, 1.6) * sgn for _ in range(13)]
                jag = lambda k, js=js: js[k]
            rings.append(_hull_ring(t, jag))
        g.loft(rings, cap0=(name == 'aft'), cap1=(name == 'fore'))
        g.displace(lambda p: p + Vector((0, fbm(p, 3, 0.25) * 0.18, fbm(p + Vector((5, 5, 5)), 3, 0.25) * 0.12)))
        # Deck plate (the bulwark ring leaves an open top).
        deck = Geo()
        drings = []
        for i in range(n + 1):
            r = _hull_ring(lerp(t0, t1, i / n))
            a, b = r[6], r[7]
            drings.append([a, ((a[0] + b[0]) / 2, 0, a[2] + 0.12), b])
        deck.loft(drings, closed=False)
        g.merge(deck)
        # Bulkhead just inside the break.
        tb = t1 - 0.03 if name == 'aft' else t0 + 0.04
        bk = Geo()
        bk.loft([_hull_ring(tb)], closed=True, cap0=True)
        bk.fill(hexc('#141210'))
        parts.append((name, g, bk))

    aft, fore = Geo(), Geo()
    for name, g, bk in parts:
        (aft if name == 'aft' else fore).merge(g).merge(bk)
    white, dark = hexc('#b9b4a3'), hexc('#0c0f12')
    sup = Geo()

    def house(sx, sy, sz, cx, cz):
        b = box(sx, sy, sz, white, (cx, 0, cz + sz / 2))
        sup.merge(b)
        # Window band as slightly proud dark panels.
        nwin = max(2, int(sx / 1.3))
        for k in range(nwin):
            wx = cx - sx / 2 + (k + 0.5) * sx / nwin
            for sgn in (1, -1):
                sup.merge(box(sx / nwin * 0.55, 0.06, 0.7, dark, (wx, sgn * sy / 2, cz + sz * 0.62)))
        for k in range(3):
            sup.merge(box(0.06, sy / 3 * 0.6, 0.7, dark, (cx + sx / 2, (k - 1) * sy / 3, cz + sz * 0.62)))

    house(7.5, 6.4, 2.8, -13.5, 2.6)
    house(5.0, 5.0, 2.5, -13.0, 5.4)
    house(3.2, 3.6, 1.6, -12.6, 7.9)
    sup.merge(lathe([(1.0, 0), (0.95, 3.6), (1.08, 3.7), (1.08, 4.1), (0.85, 4.1), (0.85, 3.0)], seg=14, c=hexc('#6b2a1f')),
              trans(-16.5, 0, 5.2) @ rot('Y', -12))
    sup.merge(tube([(-10.5, 0, 9.4), (-10.3, 0.2, 15.5)], [0.16, 0.08], seg=6, c=white))
    sup.merge(tube([(-10.4, -2.2, 13.2), (-10.4, 2.2, 13.4)], 0.06, seg=5, c=white))
    sup.merge(tube([(-10.3, 0.2, 15.4), (-3.2, 0.5, 3.2)], 0.025, seg=3, c=dark))
    # Rudder and propeller.
    sup.merge(box(1.8, 0.16, 3.0, hexc('#3a2a22'), (-21.6, 0, -2.4)))
    for k in range(4):
        sup.merge(wing([((-20.3, 0, -2.6), (0.1, 0.4, 0), (0.25, -0.05, 0)), ((-20.3, 0, -1.85), (0.2, 0.75, 0), (0.12, -0.03, 0)),
                        ((-20.3, 0, -1.25), (0.1, 0.4, 0), (0.05, -0.01, 0))], n=6, c=hexc('#8a7a3a')),
                  trans(-20.3, 0, -2.6) @ rot('X', 90 * k) @ trans(20.3, 0, 2.6))
    sup.merge(tube([(-20.9, 0, -2.6), (-19.2, 0, -2.6)], 0.22, seg=8, c=hexc('#3a2a22')))
    # Railings on the aft deck.
    for sgn in (1, -1):
        for i in range(9):
            sup.merge(box(0.07, 0.07, 1.0, white, (-20 + i * 0.9, sgn * (2.9 + i * 0.13), 3.3)))
        sup.merge(tube([(-20, sgn * 2.9, 3.8), (-12.8, sgn * 3.94, 3.8)], 0.035, seg=4, c=white))
    aft.merge(sup)

    fsup = Geo()
    for hx in (7.0, 12.5):  # hatch coamings
        fsup.merge(box(4.0, 4.6, 0.7, hexc('#3a3d3f'), (hx, 0, 2.95)))
        fsup.merge(box(3.6, 4.2, 0.12, hexc('#5a3a2a'), (hx, 0, 3.4)))
    fsup.merge(tube([(9.8, 0, 2.6), (9.8, 0, 9.6)], [0.22, 0.14], seg=6, c=white))  # king post
    fsup.merge(tube([(9.8, 0, 4.0), (16.5, 2.8, 4.6)], [0.14, 0.08], seg=6, c=hexc('#c8a63a')))  # fallen derrick
    fsup.merge(tube([(9.8, 0, 9.4), (16.5, 2.8, 4.7)], 0.02, seg=3, c=dark))
    fsup.merge(lathe([(0.45, 0), (0.45, 1.5)], seg=10, c=hexc('#3a3d3f'), cap0=True, cap1=True), trans(17.5, -0.75, 4.3) @ rot('X', 90))
    for sgn in (1, -1):
        for i in range(8):
            t = 0.82 + i * 0.02
            r = _hull_ring(t)
            fsup.merge(box(0.07, 0.07, 0.9, white, (r[5][0], sgn * (r[5][1] - 0.15), r[5][2] + 0.4)))
    # Anchor chain spilling from the bow.
    chain = [(20.4, 1.2, 2.8), (21.4, 1.9, -1.0), (21.0, 3.2, -4.3), (18.0, 5.5, -4.4)]
    fsup.merge(tube(chain, 0.09, seg=5, c=hexc('#3a2a22')))
    fore.merge(fsup)

    # Loose ribs and keel in the gap, as if the hull tore open.
    ribs = Geo()
    for i, t in enumerate((0.52, 0.545, 0.57, 0.59)):
        ring = _hull_ring(t)
        path = [Vector(p) for p in ring[:5]]
        for sgn in (1, -1):
            if rng.random() < 0.85:
                ribs.merge(tube([(p.x + rng.uniform(-0.2, 0.2), sgn * p.y, p.z) for p in path[: rng.randint(3, 5)]], 0.13, seg=5, c=hexc('#3a2a22')))
    ribs.merge(tube([(-0.5, 0, -4.1), (5.0, 0.3, -4.15)], 0.22, seg=5, c=hexc('#3a2a22')))

    # Settle the two halves on the seabed with different heel and trim.
    whole = Geo()
    whole.merge(aft, trans(0, 0, 0.6) @ rot('X', 13) @ rot('Y', 2.5))
    whole.merge(ribs, trans(0, 0, 0.3) @ rot('X', 10))
    whole.merge(fore, trans(1.5, -1.6, 0.9) @ rot('Z', -11) @ rot('X', -17) @ rot('Y', -4))
    whole.xform(trans(0, 0, 3.6))  # origin sits at seabed level
    cols = [[x, 0.3, 3.5, 4.6] for x in (-18, -12, -6, -1)] + [[-13, 0.5, 9.5, 3.6]] + \
           [[6.5, -2.3, 3.6, 4.6], [12, -3.4, 4.0, 4.4], [17.5, -4.6, 4.6, 3.6], [21, -5.2, 5.4, 2.4]]
    finalize(whole, 'wreck', ao=0.75, ao_dist=6.0, smooth_angle=35, paint_n=lambda p, n, c: hull_paint(p, n, c) if c == (1.0, 1.0, 1.0, 0.0) else
             mixc(mixc(c, mixc(rust_a, rust_b, 0.5 + 0.5 * fbm(p, 3, 1.3)), sstep(0.45, 0.8, 0.5 + 0.5 * fbm(p, 4, 0.7)) * 0.8 * (c[3] < 0.5)),
                  hexc('#3f6b5a'), sstep(0.4, 0.9, n.z) * 0.6),
             meta={'colliders': cols})


def stone_paint(p, n, c):
    if c[3] > 0.5:
        return c
    k = 0.5 + 0.5 * fbm(p, 4, 0.5)
    col = mixc(hexc('#8d9692'), hexc('#5d6a68'), k)
    col = mixc(col, hexc('#3f7f78'), sstep(0.45, 0.8, 0.5 + 0.5 * fbm(p + Vector((3, 1, 7)), 3, 0.9)) * 0.55)
    f1, f2 = vor(p, 0.9)
    col = mulc(col, 1 - 0.3 * sstep(0.05, 0.0, f2 - f1))
    return mixc(col, hexc('#2f3a3a'), sstep(0.6, 0.95, n.z) * 0.45)


def build_ruins():
    rng = random.Random(5)
    # Columns: intact and broken.
    for name, h, broken in (('column', 9.0, False), ('column_broken', 4.2, True)):
        g = Geo()
        g.merge(box(2.3, 2.3, 0.5, center=(0, 0, 0.25)))
        g.merge(lathe([(1.02, 0.5), (1.02, 0.8), (0.85, 0.95)], seg=16))
        prof = [(0.85, 0.95)] + [(0.85 - 0.12 * (z / 9.0), z) for z in (2.5, 4.2, 6.0, 8.2)][: (2 if broken else 4)]
        shaft = lathe(prof, seg=32, rmod=lambda a, z: 1 - 0.045 * (0.5 + 0.5 * cos(a * 16)), cap1=True)
        if broken:
            shaft.displace(lambda p: Vector((p.x, p.y, p.z + (0.9 * fbm((p.x, p.y, 0), 2, 1.3) if p.z > 4.0 else 0))))
        g.merge(shaft)
        if not broken:
            g.merge(lathe([(0.74, 8.2), (1.0, 8.5), (1.0, 8.7)], seg=16))
            g.merge(box(2.2, 2.2, 0.4, center=(0, 0, 8.9)))
        finalize(g, name, ao=0.6, smooth_angle=35, paint_n=stone_paint, meta={'colliders': [[0, 0, z, 1.2] for z in range(1, int(h), 2)]})
    # Moon gate: a great standing ring with glowing inlay.
    R = 7.0
    g = Geo()
    rings = []
    for i in range(48):
        a = 2 * pi * i / 48
        sec = [(-0.75, -0.65), (0.75, -0.65), (0.75, 0.65), (-0.75, 0.65)]
        rings.append([((R + dr) * cos(a), dy, (R + dr) * sin(a) + R - 1.6) for dr, dy in
                      [(s[0] * 0.92, s[1]) if k % 2 == 0 else s for k, s in enumerate([sec[0], sec[0], sec[1], sec[1], sec[2], sec[2], sec[3], sec[3]])]])
    for r in rings:
        r[0], r[1] = (r[0][0], r[0][1] + 0.08, r[0][2]), (r[1][0], r[1][1], r[1][2])
    g.loft(rings + [rings[0]])
    for sy in (1, -1):
        gl = Geo()
        gl.loft([[((R + dr) * cos(2 * pi * i / 64), sy * 0.68, (R + dr) * sin(2 * pi * i / 64) + R - 1.6) for dr in (-0.07, 0.07)] for i in range(65)], closed=False, c=GLOW)
        g.merge(gl)
        for k in range(16):
            a = 2 * pi * k / 16
            ln = 0.5 if k % 2 else 0.32
            t = Geo()
            t.loft([[((R + dr) * cos(a + da), sy * 0.68, (R + dr) * sin(a + da) + R - 1.6) for da in (-0.006, 0.006)] for dr in (-ln, -0.12)], closed=False, c=GLOW)
            g.merge(t)
    finalize(g, 'moon_gate', ao=0.5, smooth_angle=35, paint_n=stone_paint,
             meta={'colliders': [[R * cos(a), 0, R * sin(a) + R - 1.6, 1.1] for a in [2 * pi * k / 22 for k in range(22)]]})
    # Stepped dais with a glyph circle.
    g = Geo()
    for k, (r, z0, z1) in enumerate(((15, -1.5, 0.5), (12.5, 0.5, 1.0), (10, 1.0, 1.5))):
        g.merge(lathe([(r, z0), (r, z1), (0, z1)], seg=40))
    for r in (8.6, 5.2):
        gl = Geo()
        gl.loft([[((r + dr) * cos(2 * pi * i / 72), (r + dr) * sin(2 * pi * i / 72), 1.53) for dr in (-0.09, 0.09)] for i in range(73)], closed=False, c=GLOW)
        g.merge(gl)
    for k in range(14):
        a = 2 * pi * k / 14
        t = Geo()
        t.loft([[(rr * cos(a + da / rr), rr * sin(a + da / rr), 1.53) for da in (-0.07, 0.07)] for rr in (5.3, 8.5)], closed=False, c=GLOW)
        g.merge(t)
    finalize(g, 'dais', ao=0.4, smooth_angle=30, paint_n=stone_paint)
    # Standing monolith with a glyph line.
    g = Geo()
    rings = []
    for z, sx, sy in ((-1.0, 1.9, 1.0), (0.0, 1.8, 0.95), (5.5, 1.35, 0.72), (6.6, 1.1, 0.6), (7.2, 0.5, 0.35)):
        rings.append([(-sx / 2, -sy / 2, z), (sx / 2, -sy / 2, z), (sx / 2, sy / 2, z), (-sx / 2, sy / 2, z)])
    g.loft(rings, cap1=True)
    g.displace(lambda p: p + Vector((fbm(p, 3, 0.5), fbm(p + Vector((4, 4, 0)), 3, 0.5), 0)) * 0.08)
    for sy in (1, -1):
        def yat(z):
            return sy * (lerp(0.95, 0.72, clamp(z / 5.5)) / 2 + 0.06)
        strip = Geo()
        strip.loft([[(-0.06, yat(z), z), (0.06, yat(z), z)] for z in (1.2, 3.0, 5.0)], closed=False, c=GLOW)
        g.merge(strip)
        for zc in (2.0, 3.0, 4.0):
            ch = Geo()
            ch.loft([[(x, yat(zc), zc + 0.35 - abs(x) * 0.8 + dz) for dz in (0, 0.1)] for x in (-0.42, 0, 0.42)], closed=False, c=GLOW)
            g.merge(ch)
    finalize(g, 'monolith', ao=0.4, smooth_angle=30, paint_n=stone_paint, meta={'colliders': [[0, 0, 1, 1.1], [0, 0, 3, 1.0], [0, 0, 5, 0.9]]})


def build_bell():
    """Tide bell: a verdigris bell hung in a three-ribbed stone cradle."""
    g = Geo()
    outer = [(0.0, 3.55), (0.22, 3.52), (0.45, 3.32), (0.66, 2.8), (0.82, 2.0), (1.0, 1.2), (1.3, 0.62), (1.62, 0.36), (1.72, 0.3)]
    inner = [(1.6, 0.3), (1.2, 0.7), (0.9, 1.3), (0.7, 2.1), (0.5, 2.9), (0.0, 3.2)]
    bell = lathe(outer + inner, seg=28)

    def bpaint(p, c):
        k = 0.5 + 0.5 * fbm(p, 4, 1.4)
        col = mixc(hexc('#2f6f62'), hexc('#7a6233'), sstep(0.35, 0.75, k))
        return mixc(col, hexc('#9fd8c4'), sstep(0.6, 0.9, 0.5 + 0.5 * fbm(p + Vector((7, 0, 0)), 3, 3.0)) * 0.5)

    bell.paint(bpaint)
    rp = curve(outer_pts := [(z, r) for r, z in reversed(outer)])
    for zc in (0.5, 1.25, 2.3):
        r = rp(zc) + 0.035
        band = lathe([(r, zc - 0.045), (r + 0.01, zc), (r, zc + 0.045)], seg=28, c=GLOW)
        bell.merge(band)
    for k in range(9):
        a = 2 * pi * k / 9
        strip = Geo()
        strip.loft([[((rp(z) + 0.035) * cos(a + da), (rp(z) + 0.035) * sin(a + da), z) for da in (-0.03, 0.03)] for z in (1.35, 1.6, 1.9, 2.2)], closed=False, c=GLOW)
        bell.merge(strip)
    bell.merge(tube([(0, 0, 3.5), (0, 0, 4.3)], 0.12, seg=6).fill(hexc('#5a4a2a')))
    g.merge(bell, trans(0, 0, 0.75))
    # Cradle ribs and base.
    stone = Geo()
    for k in range(3):
        a = 2 * pi * k / 3 + 0.4
        path, rad = [], []
        for i in range(10):
            u = i / 9
            rr = 2.9 * (1 - u ** 2.2) + 0.05
            path.append((cos(a) * rr, sin(a) * rr, 5.3 * sin(u * pi / 2) ** 0.8 - 0.3))
            rad.append(lerp(0.34, 0.16, u))
        stone.merge(tube(path, rad, seg=7))
    stone.merge(lathe([(3.3, -0.8), (3.3, 0.1), (3.0, 0.3), (0, 0.3)], seg=30))
    stone.merge(icosphere(2, 0.42), trans(0, 0, 5.15))
    g.merge(stone)
    ring = Geo()
    ring.loft([[((2.3 + dr) * cos(2 * pi * i / 60), (2.3 + dr) * sin(2 * pi * i / 60), 0.33) for dr in (-0.07, 0.07)] for i in range(61)], closed=False, c=GLOW)
    g.merge(ring)

    def paint_n(p, n, c):
        if c == (1.0, 1.0, 1.0, 0.0):
            return stone_paint(p, n, c)
        return c

    finalize(g, 'tide_bell', ao=0.6, smooth_angle=40, paint_n=paint_n, meta={'colliders': [[0, 0, 1.6, 2.0], [0, 0, 3.6, 1.4]]})


def build_vent():
    g = Geo()
    for (h, r, x, y, tilt) in ((7.0, 1.7, 0, 0, 0), (4.2, 1.1, 1.9, 0.8, 9), (2.8, 0.8, -1.3, 1.6, -12)):
        prof = [(r * 1.2, -0.6), (r, 0.0), (r * 0.72, h * 0.3), (r * 0.5, h * 0.62), (r * 0.36, h * 0.9), (r * 0.34, h), (r * 0.22, h), (r * 0.2, h * 0.7)]
        c = lathe(prof, seg=14)
        off = Vector((x * 3, y * 3, 0))
        c.displace(lambda p, off=off, r=r: Vector((p.x * (1 + 0.3 * fbm(p + off, 4, 0.7)), p.y * (1 + 0.3 * fbm(p + off + Vector((9, 9, 0)), 4, 0.7)), p.z)))

        def vp(p, col, h=h, r=r):
            rr = math.hypot(p.x, p.y)
            base = mixc(hexc('#1a1716'), hexc('#3a2f28'), 0.5 + 0.5 * fbm(p, 4, 1.2))
            base = mixc(base, hexc('#c8a23a'), sstep(0.55, 0.85, 0.5 + 0.5 * fbm((p.x * 2, p.y * 2, p.z * 0.4), 4, 1.0)) * 0.7)
            base = mixc(base, hexc('#b8c4b8'), sstep(0.7, 0.95, 0.5 + 0.5 * fbm(p + Vector((3, 3, 3)), 3, 2.2)) * 0.5)
            glow = sstep(h * 0.86, h, p.z) * sstep(r * 0.33, r * 0.2, rr)
            return mixc(base, hexc('#ff7a2a', 1.0), glow)

        c.paint(vp)
        g.merge(c, trans(x, y, 0) @ rot('Y', tilt))
    finalize(g, 'vent', ao=0.65, smooth_angle=45, meta={'mouths': [[0, 0, 7.0], [2.55, 0.8, 4.1], [-1.9, 1.6, 2.7]],
                                                        'colliders': [[0, 0, 1.5, 1.9], [0, 0, 4.5, 1.2], [1.9, 0.8, 1.5, 1.3]]})


def build_whalefall():
    bone = Geo()
    N = 36

    def spine(u):
        return Vector((-8 + u * 17.0, 0.9 * sin(u * 2.4), 1.9 - 0.5 * sin(u * pi) - 1.4 * u ** 3))

    for i in range(N):
        u = i / (N - 1)
        p = spine(u)
        r = lerp(0.3, 0.07, u ** 1.3)
        v = lathe([(r * 0.8, -r * 0.55), (r, -r * 0.3), (r, r * 0.3), (r * 0.8, r * 0.55)], seg=7, cap0=True, cap1=True)
        v.merge(box(r * 0.5, r * 0.25, r * 2.2 * (1 - 0.6 * u), center=(0, 0, r * 1.6)), rot('Y', 90) @ rot('Y', -90))
        v.merge(box(r * 0.4, r * 4.0 * (1 - 0.7 * u), r * 0.3))
        d = (spine(min(u + 0.02, 1)) - spine(max(u - 0.02, 0))).normalized()
        yaw = math.degrees(math.atan2(d.y, d.x))
        bone.merge(v, trans(*p) @ rot('Z', yaw) @ rot('Y', 90))
    for i in range(13):  # ribs
        u = 0.06 + 0.32 * i / 12
        p = spine(u)
        size = sin((i + 1.5) / 14 * pi) ** 0.6
        for sy in (1, -1):
            path = []
            for s in range(9):
                a = s / 8 * pi * 0.82
                path.append((p.x - 0.3 * sin(a) * size, p.y + sy * (0.25 + 2.0 * size * sin(a)), p.z + 0.1 - 2.2 * size * (1 - cos(a))))
            bone.merge(tube(path, [lerp(0.085, 0.04, s / 8) for s in range(9)], seg=5))
    # Skull and jaws.
    sk = spine(0.0)
    rings = []
    for i, (dx, w, h, dz) in enumerate(((0, 0.9, 0.7, 0), (-1.0, 1.3, 0.85, -0.1), (-2.2, 1.0, 0.5, -0.3), (-4.2, 0.5, 0.2, -0.75), (-5.6, 0.12, 0.08, -1.0))):
        rings.append([(sk.x + dx, sk.y + w * cos(2 * pi * j / 8), sk.z + dz + h * sin(2 * pi * j / 8)) for j in range(8)])
    skull = Geo()
    skull.loft(rings, cap0=True, cap1=True)
    bone.merge(skull)
    for sy in (1, -1):
        path = [(sk.x - 0.6, sk.y + sy * 1.2, sk.z - 0.9), (sk.x - 2.5, sk.y + sy * 1.55, sk.z - 1.5), (sk.x - 4.5, sk.y + sy * 1.0, sk.z - 1.75), (sk.x - 5.9, sk.y + sy * 0.1, sk.z - 1.7)]
        bone.merge(tube(path, [0.2, 0.17, 0.12, 0.06], seg=6))

    def paint(p, n, c):
        col = mixc(hexc('#d8d2bc'), hexc('#8f8a74'), 0.5 + 0.5 * fbm(p, 4, 1.8))
        col = mixc(col, hexc('#5a7a6a'), sstep(0.5, 0.85, 0.5 + 0.5 * fbm(p + Vector((1, 5, 2)), 3, 0.8)) * 0.6)
        return mixc(col, hexc('#3a3a30'), sstep(0.5, -0.2, p.z) * 0.6)

    finalize(bone, 'whale_fall', ao=0.65, ao_dist=2.0, smooth_angle=45, paint_n=paint,
             meta={'colliders': [[-11, 0, 1.2, 1.6], [-8, 0, 1.6, 1.3]]})


def build_all():
    build_rocks()
    build_wreck()
    build_ruins()
    build_bell()
    build_vent()
    build_whalefall()
