"""Reef, kelp-forest and abyssal flora plus small seabed life."""
import math
import random
from math import sin, cos, pi

from mathutils import Vector

from common import (Geo, hexc, mixc, mulc, with_a, sstep, curve, fbm, vor, lerp, clamp, finalize, uvsphere, icosphere,
                    lathe, tube, sheet, grow_tree, skin_tree, rot, trans, scl)


def build_branching():
    # Staghorn coral: two variants. Painted pale so the game can tint instances.
    for n, seed in enumerate((3, 8)):
        rng = random.Random(seed)
        out = ([], [], [])
        for k in range(4):
            a = 2 * pi * k / 4 + rng.random()
            p = dict(segs=2, jitter=0.3, up=0.5, taper=0.72, shrink=0.8, spread=0.6, kids=(2, 2, 3), _parent=0 if out[0] else None)
            grow_tree(rng, (0, 0, 0), (cos(a) * 0.7, sin(a) * 0.7, 0.8), 0.34, 0.06, 3, p, out)
        g = skin_tree(out)
        g.paint(lambda p, c: mixc(hexc('#b89a7a'), hexc('#fff6e0'), sstep(0.25, 1.0, p.z + 0.2 * fbm(p, 2, 5))))
        finalize(g, f'coral_staghorn{n}', ao=0.75, smooth_angle=180)
    # Sea fans: planar branching.
    for n, seed in enumerate((5, 12)):
        rng = random.Random(seed)
        out = ([], [], [])
        p = dict(segs=2, jitter=0.12, up=0.25, taper=0.8, shrink=0.8, spread=0.5, kids=(2, 3, 3))
        grow_tree(rng, (0, 0, 0), (0, 0, 1), 0.5, 0.04, 4, p, out, planar=True)
        g = skin_tree(out)
        g.paint(lambda p, c: mixc(hexc('#c9b0a0'), hexc('#ffffff'), sstep(0.3, 1.8, p.z)))
        finalize(g, f'coral_fan{n}', ao=0.5, smooth_angle=180)


def build_massive():
    # Brain coral.
    g = icosphere(4, 1.0)

    def disp(p):
        f1, f2 = vor(p, 2.6)
        groove = sin(f1 * 30) * 0.5 + 0.5
        r = 1 + 0.07 * fbm(p, 3, 1.2) + 0.035 * groove
        q = p * r
        return Vector((q.x, q.y, max(q.z, -0.25) * 0.72))

    g.displace(disp)

    def paint(p, c):
        f1, _ = vor(Vector((p.x, p.y, p.z / 0.72)).normalized(), 2.6)
        groove = sin(f1 * 30) * 0.5 + 0.5
        return mixc(hexc('#6d5a3a'), hexc('#f3e6b8'), groove)

    g.paint(paint)
    finalize(g, 'coral_brain', ao=0.6)
    # Table coral.
    rng = random.Random(4)
    prof = [(0.0, 0.62), (0.5, 0.64), (0.92, 0.6), (1.02, 0.56), (0.9, 0.52), (0.4, 0.46), (0.12, 0.36), (0.1, 0.0)]
    g = lathe(prof, seg=28, rmod=lambda a, z: (1 + 0.1 * sin(a * 3 + 1) + 0.06 * sin(a * 7)) if z > 0.4 else 1.0, cap0=True)
    g.displace(lambda p: Vector((p.x, p.y, p.z + 0.03 * fbm(p, 3, 4) * sstep(0.2, 0.9, math.hypot(p.x, p.y)))))

    def tpaint(p, n, c):
        r = math.hypot(p.x, p.y)
        top = mixc(hexc('#b8a078'), hexc('#fff3d0'), sstep(0.4, 1.0, r) + 0.2 * sin(r * 40))
        return mixc(hexc('#6b5a45'), top, sstep(-0.2, 0.4, n.z))

    finalize(g, 'coral_table', ao=0.7, paint_n=tpaint)


def build_sponges():
    rng = random.Random(21)
    g = Geo()
    for k in range(6):
        h = rng.uniform(0.45, 1.15)
        r = rng.uniform(0.09, 0.15)
        prof = [(r * 0.75, 0), (r * 0.95, h * 0.4), (r * 1.15, h * 0.9), (r * 1.2, h), (r * 0.85, h), (r * 0.7, h * 0.6), (r * 0.5, h * 0.25)]
        t = lathe(prof, seg=10, cap1=True)
        t.paint(lambda p, c, h=h, r=r: mixc(hexc('#c9b4d9'), hexc('#ffffff'), sstep(0.2, 1.0, p.z / h))
                if math.hypot(p.x, p.y) > r * 0.86 or p.z < h * 0.97 else hexc('#2a2030'))
        a = 2 * pi * k / 6 + rng.random()
        d = 0.0 if k == 0 else rng.uniform(0.12, 0.3)
        g.merge(t, trans(cos(a) * d, sin(a) * d, -0.03) @ rot('Z', math.degrees(a)) @ rot('Y', rng.uniform(4, 20)))
    finalize(g, 'sponge_tubes', ao=0.7)
    # Barrel sponge.
    prof = [(0.36, 0), (0.58, 0.35), (0.66, 0.8), (0.6, 1.15), (0.5, 1.22), (0.44, 1.14), (0.46, 0.8), (0.36, 0.4), (0.0, 0.3)]
    g = lathe(prof, seg=24, rmod=lambda a, z: 1 + 0.06 * sin(a * 12) * sstep(1.2, 0.9, z))

    def bpaint(p, n, c):
        r = math.hypot(p.x, p.y)
        outer = mixc(hexc('#8a5a48'), hexc('#e9c0a4'), 0.5 + 0.5 * sin(math.atan2(p.y, p.x) * 12))
        return mixc(outer, hexc('#2a1a18'), sstep(0.2, -0.3, n.x * p.x / (r + 1e-5) + n.y * p.y / (r + 1e-5)) * sstep(0.2, 0.5, p.z))

    finalize(g, 'sponge_barrel', ao=0.75, paint_n=bpaint)


def _anemone(name, body, tip, tip_a, seed):
    rng = random.Random(seed)
    g = lathe([(0.2, 0), (0.26, 0.1), (0.28, 0.24), (0.2, 0.3), (0.0, 0.27)], seg=12, c=body)
    for i in range(54):
        a = rng.uniform(0, 2 * pi)
        rr = math.sqrt(rng.random()) * 0.24
        ln = rng.uniform(0.3, 0.55)
        lean = rr / 0.24
        path, rad = [], []
        for s in range(5):
            u = s / 4
            out = lean * (0.1 + 0.5 * u * u) * ln
            path.append((cos(a) * (rr + out), sin(a) * (rr + out), 0.27 + u * ln * (1 - 0.35 * lean * u)))
            rad.append(lerp(0.022, 0.012, u) if s < 4 else 0.016)
        t = tube(path, rad, seg=5)
        t.paint(lambda p, c, ln=ln: mixc(body, with_a(tip, tip_a), sstep(0.35, 0.27 + ln * 0.8, p.z)))
        g.merge(t)
    finalize(g, name, ao=0.5, smooth_angle=180)


def build_soft():
    _anemone('anemone', hexc('#b8607a'), hexc('#fff0c8'), 0.0, 2)
    _anemone('ghost_anemone', hexc('#2f3a55'), hexc('#a8f8ff'), 1.0, 6)
    # Seagrass tuft.
    rng = random.Random(9)
    g = Geo()
    for i in range(16):
        a = rng.uniform(0, 2 * pi)
        h = rng.uniform(0.5, 1.1)
        r0 = rng.uniform(0, 0.12)
        lean = rng.uniform(0.1, 0.4)

        def blade(u, v, a=a, h=h, r0=r0, lean=lean):
            w = (v - 0.5) * 0.045 * (1 - u * 0.7)
            d = r0 + lean * u * u * h
            return (cos(a) * d - sin(a) * w, sin(a) * d + cos(a) * w, u * h)

        g.merge(sheet(4, 1, blade).paint(lambda p, c: mixc(hexc('#2f6b3a'), hexc('#a8d86a'), sstep(0, 1.0, p.z))))
    finalize(g, 'seagrass', ao=0.0)
    # Sea whips: tall thin spirals for the wall.
    g = Geo()
    for i in range(6):
        a = rng.uniform(0, 2 * pi)
        h = rng.uniform(1.6, 3.0)
        path = [(cos(a) * 0.1 + 0.12 * sin(u * 5 + i) * u, sin(a) * 0.1 + 0.12 * cos(u * 4 + i) * u, u * h) for u in [k / 9 for k in range(10)]]
        t = tube(path, [lerp(0.03, 0.012, k / 9) for k in range(10)], seg=4)
        t.paint(lambda p, c, h=h: mixc(hexc('#7a2f3a'), hexc('#ffd0a0', 0.9), sstep(0.5, 1.0, p.z / h)))
        g.merge(t)
    finalize(g, 'sea_whip', ao=0.2)


def build_kelp():
    """One 20 m strand; the game scales and sways it."""
    rng = random.Random(31)
    g = Geo()
    H = 20.0
    n = 28

    def axis(u):
        return Vector((0.25 * sin(u * 7.0), 0.25 * cos(u * 5.3), u * H))

    path = [axis(k / n) for k in range(n + 1)]
    g.merge(tube(path, [lerp(0.07, 0.025, k / n) for k in range(n + 1)], seg=5).paint(lambda p, c: hexc('#5a5a1e')))
    olive, gold = hexc('#56641c'), hexc('#c9a52a')
    for k in range(60):
        u = 0.04 + 0.95 * k / 59
        base = axis(u)
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        ln = rng.uniform(1.8, 3.0) * (0.7 + 0.5 * sin(pi * u))
        wd = rng.uniform(0.32, 0.5)
        droop = rng.uniform(0.2, 0.5)
        g.merge(icosphere(0, 0.055).fill(hexc('#8a8a2a')), trans(base.x + cos(a) * 0.09, base.y + sin(a) * 0.09, base.z + 0.02))

        def blade(s, v, base=base, a=a, ln=ln, wd=wd, droop=droop):
            w = (v - 0.5) * wd * sin(pi * min(s * 0.92 + 0.08, 1.0)) ** 0.6
            d = 0.12 + s * ln
            z = 0.25 * ln * s - droop * ln * s * s + 0.04 * sin(s * 14) * (v - 0.5) * 2
            return (base.x + cos(a) * d - sin(a) * w, base.y + sin(a) * d + cos(a) * w, base.z + z)

        g.merge(sheet(5, 2, blade).paint(lambda p, c, base=base: mixc(olive, gold, sstep(0.0, 2.6, math.hypot(p.x - base.x, p.y - base.y)) * 0.8 + 0.2 * (p.z / H))))
    finalize(g, 'kelp', ao=0.0, meta={'height': H})


def build_small():
    # Giant clam with a glowing mantle.
    g = Geo()
    for sy in (1, -1):
        def valve(u, v, sy=sy):
            a = (u - 0.5) * pi * 0.95
            lip = 0.5 + 0.08 * cos(u * pi * 10)
            r = v * lip
            return (sin(a) * r * 1.25, sy * (0.06 + 0.3 * sin(v * pi * 0.5) * (1 - 0.35 * v)) * (1 + 0.12 * cos(u * pi * 10) * v), cos(a) * r * 0.85 + 0.03)

        s = sheet(20, 5, valve)
        s.paint(lambda p, c: mixc(hexc('#8a8272'), hexc('#d8d0bc'), 0.5 + 0.5 * fbm(p, 3, 6)))
        g.merge(s)

    def mantle(u, v):
        a = (u - 0.5) * pi * 0.9
        r = 0.4 + 0.05 * cos(u * pi * 10)
        return (sin(a) * r * 1.2, (v - 0.5) * 0.26 * (1 + 0.3 * cos(u * pi * 10)), cos(a) * r * 0.82 + 0.04 + 0.03 * sin(v * pi))

    m = sheet(20, 3, mantle)
    m.paint(lambda p, c: mixc(hexc('#1a3fb8', 0.35), hexc('#35f0c0', 0.8), sstep(0.03, 0.0, vor(p, 9.0)[0] - 0.05)))
    g.merge(m)
    finalize(g, 'clam', ao=0.5)
    # Starfish.
    g = icosphere(3, 1.0)

    def star(p):
        a = math.atan2(p.y, p.x)
        r = 0.22 + 0.78 * (abs(cos(a * 2.5)) ** 2.2)
        hz = math.hypot(p.x, p.y)
        return Vector((p.x * r * 0.42, p.y * r * 0.42, max(p.z, 0) * 0.07 * (1.3 - hz)))

    g.displace(star)
    g.paint(lambda p, c: mixc(hexc('#e2562b'), hexc('#ffd08a'), sstep(0.08, 0.02, vor(p, 22.0)[0])))
    finalize(g, 'starfish', ao=0.3)
    # Urchin.
    rng = random.Random(2)
    g = icosphere(1, 0.12).fill(hexc('#1c1226'))
    base = icosphere(2, 1.0)
    for v in base.v:
        d = Vector(v)
        if d.z < -0.3:
            continue
        ln = rng.uniform(0.2, 0.34)
        g.merge(tube([d * 0.1, d * (0.12 + ln)], [0.012, 0.001], seg=3, cap=False).paint(
            lambda p, c: mixc(hexc('#2a1a3a'), hexc('#b89ad8'), sstep(0.15, 0.45, p.length))))
    finalize(g, 'urchin', ao=0.0)


def build_abyss():
    rng = random.Random(40)
    # Lantern stalk: a drooping stem carrying glowing bulbs.
    g = Geo()
    for k, (h, lean) in enumerate(((2.4, 0.6), (1.5, -0.5), (0.9, 0.3))):
        a = k * 2.2
        path = []
        for s in range(9):
            u = s / 8
            path.append((cos(a) * (0.08 + lean * u * u * 0.9), sin(a) * (0.08 + lean * u * u * 0.9), h * (u - 0.22 * u ** 4)))
        g.merge(tube(path, [lerp(0.045, 0.018, s / 8) for s in range(9)], seg=5).paint(
            lambda p, c, h=h: mixc(hexc('#1c2a3a'), hexc('#4fd8e8', 0.5), sstep(0.5, 1.0, p.z / h))))
        tip = Vector(path[-1])
        bulb = icosphere(2, 0.16 - 0.03 * k).displace(lambda p: Vector((p.x, p.y, p.z * 1.35)))
        bulb.fill(hexc('#c8fff4', 1.0))
        g.merge(bulb, trans(tip.x, tip.y, tip.z - 0.1))
    finalize(g, 'lantern_stalk', ao=0.2)
    # Tube worm cluster.
    g = Geo()
    for k in range(16):
        a = rng.uniform(0, 2 * pi)
        d = math.sqrt(rng.random()) * 0.4
        h = rng.uniform(0.5, 1.5)
        bx, by = cos(a) * d, sin(a) * d
        lx, ly = cos(a) * d * 0.5, sin(a) * d * 0.5
        g.merge(tube([(bx, by, 0), (bx + lx * 0.5, by + ly * 0.5, h * 0.6), (bx + lx, by + ly, h)], [0.05, 0.045, 0.04], seg=6).paint(
            lambda p, c: mixc(hexc('#8a8a80'), hexc('#f2efe2'), 0.5 + 0.5 * fbm(p, 2, 8))))
        plume = icosphere(1, 1.0).displace(lambda p: Vector((p.x * 0.07, p.y * 0.07, p.z * 0.16)))
        plume.fill(hexc('#ff2a1a', 0.45))
        g.merge(plume, trans(bx + lx, by + ly, h + 0.1))
    finalize(g, 'tube_worms', ao=0.6)


def build_all():
    build_branching()
    build_massive()
    build_sponges()
    build_soft()
    build_kelp()
    build_small()
    build_abyss()
