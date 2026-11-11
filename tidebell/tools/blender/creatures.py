"""Creature models: fish, shark, angler, whale, manta, turtle, jellyfish and the player's submersible."""
import random
from math import sin, cos, pi

from mathutils import Vector

from common import (Geo, hexc, mixc, mulc, with_a, sstep, curve, fbm, vor, spow, lerp, clamp, finalize, uvsphere,
                    icosphere, lathe, tube, wing, sheet, box, rot, trans, scl, modify)


def _body(spec):
    L, H, W = spec['L'], spec['H'], spec['W']
    hp = curve(spec['hp'])
    wp = curve(spec.get('wp', spec['hp']))
    zo = curve(spec.get('zo', [(0, 0), (1, 0)]))
    ns, nr, e = spec.get('ns', 12), spec.get('nr', 8), spec.get('e', 0.9)

    def sec(t):
        return L * (0.5 - t), H * 0.5 * hp(t), W * 0.5 * wp(t), zo(t) * H

    g = Geo()
    rings = []
    for i in range(ns + 1):
        t = i / ns
        x, h, w, z0 = sec(t)
        rings.append([(x, w * spow(cos(2 * pi * j / nr), e), z0 + h * spow(sin(2 * pi * j / nr), e)) for j in range(nr)])
    g.loft(rings, cap0=True, cap1=True)
    paint = spec['paint']

    def pf(p, c):
        t = clamp(0.5 - p.x / L)
        _, h, w, z0 = sec(t)
        return paint(t, clamp((p.z - z0) / (h + 1e-6), -1, 1), p)

    g.paint(pf)
    return g, sec


def fish(spec, ret_sec=False):
    """Generic lofted fish with thin sheet fins. Nose points along +X."""
    g, sec = _body(spec)
    L, H = spec['L'], spec['H']
    fc = spec.get('fin', hexc('#cccccc'))
    fc2 = spec.get('fin2', fc)

    def fin_col(u):
        return mixc(fc, fc2, u)

    tl = spec.get('tail')
    if tl:
        xe, he, _, ze = sec(1.0)
        up, dn = tl.get('up', 1.0), tl.get('down', 1.0)

        def tf(u, v):
            vv = v * 2 - 1
            span = lerp(he, tl['h'] * 0.5 * (up if vv > 0 else dn), u ** 0.7)
            xlen = tl['len'] * (1 - tl.get('fork', 0.4) * (1 - abs(vv) ** 1.3)) * (1 + 0.25 * (up - 1) * max(vv, 0))
            return (xe + 0.03 * L - u * xlen - tl.get('rake', 0.0) * abs(vv) * u * tl['len'], 0, ze + vv * span)

        s = sheet(4, 6, tf)
        s.paint(lambda p, c: fin_col(clamp((xe - p.x) / tl['len'])))
        g.merge(s)
    for sign, key in ((1, 'dorsal'), (-1, 'anal')):
        for d in spec.get(key, []):
            prof = curve(d.get('prof', [(0, 0.2), (0.3, 1), (1, 0.15)]))

            def df(u, v, d=d, prof=prof, sign=sign):
                t = lerp(d['t0'], d['t1'], u)
                x, h, _, z0 = sec(t)
                return (x - v * d.get('sweep', 0.1) * L, 0, z0 + sign * (h * 0.85 + v * d['h'] * prof(u)))

            s = sheet(d.get('nu', 5), 2, df)
            s.paint(lambda p, c, d=d: mixc(d.get('col', fc), d.get('col2', fc2), 0.5))
            g.merge(s)
    pc = spec.get('pect')
    if pc:
        x, h, w, z0 = sec(pc['t'])
        for sy in (1, -1):
            def pf(u, v, sy=sy):
                root = Vector((x - v * pc['chord'] * 0.4, sy * w * 0.88, z0 - h * 0.25 - v * pc['chord']))
                out = Vector((-0.75, sy * 0.55, -0.35)).normalized() * pc['len']
                return root + out * u * (1 - 0.35 * v)

            s = sheet(2, 2, pf)
            s.paint(lambda p, c: fin_col(0.3))
            g.merge(s)
    ey = spec.get('eye')
    if ey:
        x, h, w, z0 = sec(ey['t'])
        for sy in (1, -1):
            s = uvsphere(8, 5, ey['r'])
            cen = Vector((x, sy * (w * ey.get('out', 0.8)), z0 + h * ey.get('z', 0.25)))
            iris = ey.get('iris', hexc('#e8c35a'))

            def ep(p, c, sy=sy):
                o = p.y * sy / ey['r']
                return mixc(iris, hexc('#050608'), sstep(0.45, 0.7, o))

            s.paint(ep)
            g.merge(s, trans(*cen))
    return (g, sec) if ret_sec else g


def build_fish():
    # Sunstripe Darter: slim schooling reef fish.
    def darter(t, vz, p):
        c = mixc(hexc('#eef6f8'), hexc('#1866c0'), sstep(-0.15, 0.45, vz))
        s = 1 - sstep(0.0, 0.2, abs(vz - 0.12))
        c = mixc(c, hexc('#ffd21f'), s * sstep(0.1, 0.22, t))
        return mixc(c, hexc('#ffd21f'), sstep(0.86, 1.0, t))

    finalize(fish(dict(
        L=0.42, H=0.115, W=0.062, ns=10, nr=8,
        hp=[(0, 0.08), (0.08, 0.6), (0.3, 1.0), (0.6, 0.85), (0.9, 0.3), (1, 0.24)],
        paint=darter, fin=hexc('#ffd21f'), fin2=hexc('#fff3b0'),
        tail=dict(len=0.11, h=0.15, fork=0.55),
        dorsal=[dict(t0=0.3, t1=0.75, h=0.035, sweep=0.04)], anal=[dict(t0=0.55, t1=0.8, h=0.028, sweep=0.03)],
        pect=dict(t=0.27, len=0.06, chord=0.03), eye=dict(t=0.1, r=0.0125, z=0.2))), 'fish_darter', ao=0.4)

    # Blush Chromlet: small deep-bodied coral fish.
    def chrom(t, vz, p):
        c = mixc(hexc('#ff7a2a'), hexc('#ff3d6e'), sstep(0.2, 0.8, t))
        c = mixc(c, hexc('#ffd9a0'), sstep(-0.2, -0.9, vz) * 0.7)
        c = mixc(c, hexc('#7a3cff'), (1 - sstep(0.0, 0.05, abs(t - 0.13 + vz * 0.03))) * 0.9)
        return c

    finalize(fish(dict(
        L=0.3, H=0.14, W=0.055, ns=9, nr=8,
        hp=[(0, 0.1), (0.1, 0.7), (0.35, 1.0), (0.65, 0.8), (0.9, 0.28), (1, 0.22)],
        paint=chrom, fin=hexc('#ff9a3c'), fin2=hexc('#ffe1f0'),
        tail=dict(len=0.13, h=0.2, fork=0.7),
        dorsal=[dict(t0=0.22, t1=0.8, h=0.05, sweep=0.06, prof=[(0, 0.5), (0.2, 1), (0.8, 0.8), (1, 0.3)])],
        anal=[dict(t0=0.5, t1=0.82, h=0.04, sweep=0.05)],
        pect=dict(t=0.3, len=0.05, chord=0.03), eye=dict(t=0.12, r=0.013, z=0.2, iris=hexc('#ffe9c9')))),
        'fish_chromlet', ao=0.4)

    # Silver Runner: mid-sized schooling jack.
    def runner(t, vz, p):
        c = mixc(hexc('#f2f6f7'), hexc('#8fa6b3'), sstep(-0.3, 0.3, vz))
        c = mixc(c, hexc('#27404f'), sstep(0.45, 0.95, vz))
        sc = fbm((p.x * 40, p.z * 40, 0), 2)
        c = mulc(c, 1 + 0.12 * sc)
        return mixc(c, hexc('#e9c93a'), (1 - sstep(0.0, 0.08, abs(vz + 0.05))) * 0.35 * sstep(0.2, 0.5, t))

    finalize(fish(dict(
        L=0.9, H=0.34, W=0.12, ns=12, nr=10,
        hp=[(0, 0.1), (0.1, 0.62), (0.32, 1.0), (0.6, 0.8), (0.9, 0.16), (1, 0.12)],
        paint=runner, fin=hexc('#5d6f76'), fin2=hexc('#e9c93a'),
        tail=dict(len=0.26, h=0.42, fork=0.78),
        dorsal=[dict(t0=0.3, t1=0.42, h=0.14, sweep=0.1, prof=[(0, 0.3), (0.35, 1), (1, 0.25)]),
                dict(t0=0.42, t1=0.88, h=0.05, sweep=0.03, prof=[(0, 0.9), (1, 0.4)])],
        anal=[dict(t0=0.52, t1=0.88, h=0.07, sweep=0.06, prof=[(0, 0.5), (0.15, 1), (1, 0.3)])],
        pect=dict(t=0.27, len=0.2, chord=0.06), eye=dict(t=0.09, r=0.03, z=0.2))), 'fish_runner', ao=0.4)

    # Mosaic Parrotfish: chunky solitary grazer.
    def parrot(t, vz, p):
        f1, f2 = vor((p.x * 16, p.z * 16 + abs(p.y) * 8, 0))
        c = mixc(hexc('#15b3a4'), hexc('#2a6fe0'), sstep(0.2, 0.9, t) * 0.7)
        c = mixc(c, hexc('#ff6fa8'), sstep(0.08, 0.0, f2 - f1) * 0.85)
        c = mixc(c, hexc('#ffd66b'), sstep(-0.3, -1.0, vz) * 0.6)
        c = mixc(c, hexc('#f2e6c8'), sstep(0.05, 0.0, t))
        return c

    finalize(fish(dict(
        L=1.0, H=0.4, W=0.2, ns=12, nr=10,
        hp=[(0, 0.35), (0.07, 0.72), (0.3, 1.0), (0.62, 0.9), (0.88, 0.36), (1, 0.3)],
        paint=parrot, fin=hexc('#2a6fe0'), fin2=hexc('#ff8ac0'),
        tail=dict(len=0.24, h=0.44, fork=0.25),
        dorsal=[dict(t0=0.25, t1=0.85, h=0.08, sweep=0.04, prof=[(0, 0.7), (0.5, 1), (1, 0.6)])],
        anal=[dict(t0=0.58, t1=0.85, h=0.07, sweep=0.04)],
        pect=dict(t=0.28, len=0.2, chord=0.09), eye=dict(t=0.1, r=0.03, z=0.35, iris=hexc('#ffb347')))),
        'fish_parrot', ao=0.45)

    # Star Minnow: abyssal lanternfish with photophore rows.
    def minnow(t, vz, p):
        c = mixc(hexc('#1a2433'), hexc('#070a12'), sstep(-0.2, 0.6, vz))
        dots = sstep(0.55, 0.9, sin(t * 46)) * (1 - sstep(0.0, 0.3, abs(vz + 0.45)))
        return mixc(c, hexc('#8ff5ff', 1.0), dots)

    finalize(fish(dict(
        L=0.36, H=0.09, W=0.055, ns=12, nr=8,
        hp=[(0, 0.3), (0.08, 0.85), (0.25, 1.0), (0.6, 0.7), (0.9, 0.28), (1, 0.22)],
        paint=minnow, fin=hexc('#33445c'), fin2=hexc('#6fd8ff', 0.5),
        tail=dict(len=0.09, h=0.12, fork=0.6),
        dorsal=[dict(t0=0.35, t1=0.6, h=0.03, sweep=0.03)], anal=[dict(t0=0.55, t1=0.8, h=0.025, sweep=0.03)],
        pect=dict(t=0.25, len=0.05, chord=0.02), eye=dict(t=0.09, r=0.016, z=0.2, iris=hexc('#9ff7ff', 1.0)))),
        'fish_minnow', ao=0.3)


def build_shark():
    def paint(t, vz, p):
        c = mixc(hexc('#e6ebec'), hexc('#5f717c'), sstep(-0.35, 0.1, vz))
        c = mixc(c, hexc('#36434c'), sstep(0.4, 1.0, vz) * 0.8)
        gill = sum(1 - sstep(0.0, 0.006, abs(t - g)) for g in (0.2, 0.22, 0.24, 0.26)) * (1 - sstep(0.1, 0.5, abs(vz)))
        return mixc(mulc(c, 1 + 0.08 * fbm(p, 3, 3.0)), hexc('#1a2126'), gill * 0.7)

    spec = dict(L=3.0, H=0.56, W=0.5, ns=18, nr=12, e=1.0,
                hp=[(0, 0.08), (0.06, 0.5), (0.2, 0.9), (0.35, 1.0), (0.6, 0.78), (0.85, 0.3), (1, 0.16)],
                wp=[(0, 0.1), (0.06, 0.65), (0.2, 0.95), (0.33, 1.0), (0.6, 0.7), (0.85, 0.22), (1, 0.08)],
                paint=paint, fin=hexc('#4c5b64'), fin2=hexc('#2a343a'),
                tail=dict(len=0.5, h=1.1, fork=0.62, up=1.35, down=0.62, rake=0.5),
                eye=dict(t=0.075, r=0.03, z=0.15, out=0.95, iris=hexc('#c9d2d6')))
    g, sec = fish(spec, True)
    grey, dark = hexc('#56666f'), hexc('#2a343a')
    x, h, w, z0 = sec(0.36)
    # First dorsal, pectorals, pelvics, second dorsal as solid fins.
    g.merge(wing([((x, 0, z0 + h * 0.8), (0.5, 0, 0), (0, 0.07, 0)), ((x - 0.22, 0, z0 + h + 0.25), (0.3, 0, 0), (0, 0.04, 0)),
                  ((x - 0.42, 0, z0 + h + 0.46), (0.08, 0, 0), (0, 0.015, 0))], c=grey))
    x2, h2, w2, z2 = sec(0.3)
    for sy in (1, -1):
        g.merge(wing([((x2, sy * w2 * 0.8, z2 - h2 * 0.5), (0.46, 0, 0), (0, 0, 0.07)),
                      ((x2 - 0.25, sy * (w2 + 0.4), z2 - h2 * 0.5 - 0.16), (0.3, 0, 0), (0, 0, 0.04)),
                      ((x2 - 0.5, sy * (w2 + 0.72), z2 - h2 * 0.5 - 0.27), (0.07, 0, 0), (0, 0, 0.015))], c=dark))
    x3, h3, w3, z3 = sec(0.7)
    g.merge(wing([((x3, 0, z3 + h3 * 0.8), (0.2, 0, 0), (0, 0.03, 0)), ((x3 - 0.14, 0, z3 + h3 + 0.14), (0.05, 0, 0), (0, 0.01, 0))], c=grey))
    g.merge(wing([((x3 + 0.05, 0, z3 - h3 * 0.8), (0.2, 0, 0), (0, 0.03, 0)), ((x3 - 0.1, 0, z3 - h3 - 0.12), (0.05, 0, 0), (0, 0.01, 0))], c=grey))
    finalize(g, 'shark', ao=0.5)


def build_angler():
    def paint(t, vz, p):
        c = mixc(hexc('#2a1a16'), hexc('#120b0c'), sstep(-0.5, 0.6, vz))
        f1, _ = vor(p, 9.0)
        c = mixc(c, hexc('#ff9b54', 0.8), sstep(0.09, 0.03, f1) * sstep(0.25, 0.5, t))
        mouth = sstep(0.16, 0.05, t) * sstep(0.35, -0.2, vz)
        return mixc(c, hexc('#030202'), mouth)

    spec = dict(L=1.2, H=0.78, W=0.6, ns=14, nr=12, e=1.0,
                hp=[(0, 0.55), (0.1, 0.85), (0.3, 1.0), (0.55, 0.75), (0.8, 0.28), (1, 0.14)],
                wp=[(0, 0.45), (0.12, 0.85), (0.3, 1.0), (0.55, 0.7), (0.8, 0.22), (1, 0.08)],
                zo=[(0, -0.08), (0.3, 0), (1, 0.05)],
                paint=paint, fin=hexc('#2a1a16'), fin2=hexc('#5a2f22'),
                tail=dict(len=0.3, h=0.42, fork=0.1),
                dorsal=[dict(t0=0.6, t1=0.85, h=0.12, sweep=0.04)], anal=[dict(t0=0.62, t1=0.85, h=0.1, sweep=0.04)],
                pect=dict(t=0.42, len=0.22, chord=0.1), eye=dict(t=0.14, r=0.028, z=0.5, out=0.75, iris=hexc('#bfe9ff', 0.6)))
    g = fish(spec)
    # Teeth around the gape.
    tooth = hexc('#e9e4d2')
    for i in range(22):
        a = pi * (i / 21) - pi / 2
        for up in (1, -1):
            base = Vector((0.57 - 0.07 * abs(sin(a)), 0.24 * sin(a), -0.1 + up * 0.11 * cos(a) - 0.04))
            ln = 0.07 + 0.05 * abs(cos(a * 3))
            g.merge(tube([base, base + Vector((0.03, 0, -up * ln))], [0.012, 0.001], seg=4, c=tooth))
    # Illicium (lure rod) and glowing esca.
    path = [Vector((0.42, 0, 0.36)), Vector((0.5, 0, 0.62)), Vector((0.66, 0, 0.78)), Vector((0.84, 0, 0.76)), Vector((0.93, 0, 0.62))]
    g.merge(tube(path, [0.022, 0.016, 0.012, 0.01, 0.008], seg=5, c=hexc('#3a241d')))
    g.merge(icosphere(1, 0.06).fill(hexc('#b9fff2', 1.0)), trans(0.94, 0, 0.56))
    finalize(g, 'angler', ao=0.6, meta={'lure': [0.94, 0, 0.56]})


def build_whale():
    """The Singer: a fantastical great whale with glowing tide-lines along its flanks."""
    L = 24.0

    def paint(t, vz, p):
        c = mixc(hexc('#c9d6d8'), hexc('#27475c'), sstep(-0.55, -0.05, vz))
        c = mixc(c, hexc('#0f2333'), sstep(0.2, 0.95, vz))
        c = mulc(c, 1 + 0.12 * fbm(p, 4, 0.5))
        pleat = sstep(0.42, 0.06, t) * sstep(-0.25, -0.6, vz)
        c = mixc(c, hexc('#7f9299'), pleat * (0.5 + 0.5 * sin(p.y * 22)) * 0.6)
        # Emissive tide-lines: three flowing bands along the flank plus scattered stars.
        glow = 0.0
        for k, (v0, amp, fr) in enumerate(((0.28, 0.1, 5.0), (0.02, 0.08, 7.0), (-0.22, 0.06, 9.0))):
            line = v0 + amp * sin(t * fr + k * 1.7)
            glow += sstep(0.13, 0.04, abs(vz - line)) * sstep(0.06, 0.18, t) * sstep(0.97, 0.8, t)
        f1, _ = vor(p, 1.6)
        glow += sstep(0.16, 0.05, f1) * sstep(0.1, 0.6, vz) * 0.9
        return mixc(with_a(c, 0.05), hexc('#8ffcf0', 1.0), clamp(glow))

    spec = dict(L=L, H=4.6, W=4.2, ns=72, nr=40, e=1.0,
                hp=[(0, 0.12), (0.03, 0.5), (0.1, 0.82), (0.25, 1.0), (0.45, 0.92), (0.7, 0.5), (0.9, 0.16), (1, 0.07)],
                wp=[(0, 0.2), (0.03, 0.6), (0.1, 0.88), (0.25, 1.0), (0.45, 0.85), (0.7, 0.4), (0.9, 0.12), (1, 0.06)],
                zo=[(0, -0.05), (0.2, -0.03), (0.6, 0.03), (1, 0.08)], paint=paint)
    g, sec = _body(spec)
    dark, pale = hexc('#14303f'), hexc('#b9c9cc')

    def fin_paint(p, c):
        k = fbm(p, 3, 0.7)
        base = mixc(dark, pale, sstep(0.1, -0.5, p.z - sec(0.3)[3]) * 0.5 + 0.15 * k)
        f1, _ = vor(p, 1.1)
        return mixc(with_a(base, 0.05), hexc('#8ffcf0', 1.0), sstep(0.2, 0.08, f1) * 0.8)

    # Long sweeping pectoral fins.
    x, h, w, z0 = sec(0.27)
    for sy in (1, -1):
        secs = []
        for i in range(9):
            u = i / 8
            cen = Vector((x - 1.2 * u ** 1.6 * 3.2, sy * (w * 0.8 + u * 6.4), z0 - h * 0.55 - u * 1.6 + 0.5 * u * u))
            chord = 2.3 * (1 - u) ** 0.7 * (0.7 + 0.3 * sin(u * 9) ** 2) + 0.15
            secs.append((cen, (chord, 0, 0), (0, 0, 0.34 * (1 - u) + 0.04)))
        g.merge(wing(secs, n=10).paint(fin_paint))
    # Horizontal flukes.
    xe, he, we, ze = sec(1.0)
    for sy in (1, -1):
        secs = []
        for i in range(9):
            u = i / 8
            cen = Vector((xe + 0.3 - 2.3 * u ** 1.5, sy * u * 4.3, ze + 0.25 * u * u))
            chord = 2.6 * (1 - u) ** 0.8 + 0.12
            secs.append((cen, (chord, 0, 0), (0, 0, 0.3 * (1 - u) + 0.03)))
        g.merge(wing(secs, n=10).paint(fin_paint))
    # Small dorsal hump.
    xd, hd, wd, zd = sec(0.66)
    g.merge(wing([((xd, 0, zd + hd * 0.9), (1.8, 0, 0), (0, 0.3, 0)), ((xd - 0.6, 0, zd + hd + 0.55), (0.9, 0, 0), (0, 0.12, 0)),
                  ((xd - 1.1, 0, zd + hd + 0.8), (0.15, 0, 0), (0, 0.03, 0))], c=dark))
    for sy in (1, -1):
        ex, eh, ew, ez = sec(0.13)
        g.merge(uvsphere(8, 6, 0.13).fill(hexc('#05080a')), trans(ex, sy * ew * 0.97, ez - eh * 0.25))
    finalize(g, 'whale', ao=0.45, ao_dist=5.0)


def build_manta():
    S = 2.6
    secs = []
    N = 26
    for i in range(N + 1):
        y = -S + 2 * S * i / N
        e = min(abs(y) / S, 1.0)
        chord = 0.12 + 2.0 * (1 - e) ** 1.25
        xc = 0.15 - 1.0 * e ** 1.9 + 0.22 * e
        th = 0.44 * (1 - e) ** 1.7 + 0.02
        secs.append(((xc, y, 0.1 * e * e), (chord, 0, 0), (0, 0, th)))
    g = wing(secs, n=12)

    def paint(p, c):
        e = min(abs(p.y) / S, 1.0)
        top = mixc(hexc('#1c2a36'), hexc('#34485a'), 0.5 + 0.5 * fbm(p, 3, 1.5))
        chev = sstep(0.16, 0.05, abs((p.x - 0.35) + abs(p.y) * 0.75 - 0.25)) * sstep(0.9, 0.3, e) * sstep(0.05, 0.2, e)
        top = mixc(top, hexc('#b8c8cf'), chev * 0.8)
        f1, _ = vor((p.x, p.y, 0), 3.0)
        bot = mixc(hexc('#e9eef0'), hexc('#59676f'), sstep(0.12, 0.05, f1) * sstep(0.2, 0.8, e + 0.3 * (0.5 - p.x)))
        gill = sum(1 - sstep(0.0, 0.02, abs(p.x - gx)) for gx in (0.5, 0.36, 0.22, 0.08)) * sstep(0.5, 0.2, abs(abs(p.y) - 0.42) / 0.3)
        bot = mixc(bot, hexc('#2a3238'), clamp(gill) * 0.7)
        return mixc(bot, top, sstep(-0.02, 0.04, p.z - 0.1 * e * e))

    g.paint(paint)
    dark = hexc('#1c2a36')
    for sy in (1, -1):  # cephalic lobes
        g.merge(wing([((1.0, sy * 0.36, 0.0), (0.4, 0, 0), (0, 0.12, 0)), ((1.32, sy * 0.42, -0.08), (0.3, 0, 0), (0, 0.07, 0)),
                      ((1.55, sy * 0.36, -0.2), (0.1, 0, 0), (0, 0.03, 0))], n=8, c=dark))
        g.merge(uvsphere(8, 5, 0.045).fill(hexc('#050608')), trans(1.02, sy * 0.5, 0.03))
    g.merge(tube([(-0.85, 0, 0.02), (-1.8, 0, 0.0), (-2.8, 0, -0.03), (-3.9, 0, -0.02)], [0.06, 0.035, 0.018, 0.004], seg=5, c=dark))
    g.merge(wing([((-0.8, 0, 0.1), (0.3, 0, 0), (0, 0.05, 0)), ((-0.92, 0, 0.24), (0.08, 0, 0), (0, 0.015, 0))], n=6, c=dark))
    finalize(g, 'manta', ao=0.35, meta={'span': S})


def build_turtle():
    g = uvsphere(18, 12, 1.0)

    def shape(p):
        z = p.z * (0.36 if p.z > 0 else 0.16)
        r = 1.0 + 0.05 * sstep(0.2, -0.1, p.z)
        return Vector((p.x * 0.74 * r - 0.06 * (1 - abs(p.y)) * (p.x < 0), p.y * 0.62 * r * (1 - 0.14 * sstep(0, -1, p.x)), z))

    g.displace(shape)

    def shell_paint(p, c):
        if p.z < 0.01:
            return mixc(hexc('#d9cf9a'), hexc('#a59a63'), 0.5 + 0.5 * fbm(p, 3, 4))
        f1, f2 = vor((p.x * 1.0, p.y * 1.25, 0), 3.4)
        edge = sstep(0.1, 0.0, f2 - f1)
        base = mixc(hexc('#5a4a22'), hexc('#b8862f'), sstep(0.5, 0.05, f1) * 0.9)
        base = mixc(base, hexc('#2f4a2c'), 0.3 + 0.3 * fbm(p, 3, 3))
        return mixc(base, hexc('#1c1a10'), edge * 0.85)

    g.paint(shell_paint)

    def skin(p, c):
        f1, f2 = vor(p, 14.0)
        return mixc(hexc('#3d4a2a'), hexc('#cfc890'), sstep(0.07, 0.0, f2 - f1) * 0.8)

    head = uvsphere(10, 8, 1.0).displace(lambda p: Vector((p.x * 0.21 + 0.03 * p.x * p.x, p.y * 0.13, p.z * 0.125)))
    head.paint(skin)
    g.merge(head, trans(0.95, 0, 0.03))
    g.merge(tube([(0.62, 0, 0.0), (0.8, 0, 0.02)], [0.13, 0.1], seg=8).paint(skin))
    for sy in (1, -1):
        g.merge(uvsphere(6, 4, 0.022).fill(hexc('#050608')), trans(1.02, sy * 0.105, 0.06))
        secs = []
        for i in range(7):  # front flippers
            u = i / 6
            cen = Vector((0.48 - 0.55 * u ** 1.5, sy * (0.42 + 0.95 * u), -0.03 - 0.1 * u))
            secs.append((cen, (0.34 * (1 - u) ** 0.6 * (0.6 + 0.4 * sin(pi * min(u * 1.6, 1))) + 0.04, 0, 0), (0, 0, 0.05 * (1 - u) + 0.012)))
        g.merge(wing(secs, n=8).paint(skin))
        secs = []
        for i in range(5):  # rear flippers
            u = i / 4
            cen = Vector((-0.55 - 0.42 * u, sy * (0.34 + 0.22 * u), -0.04))
            secs.append((cen, (0.26 * (1 - u) ** 0.5 + 0.03, 0, 0), (0, 0, 0.04 * (1 - u) + 0.01)))
        g.merge(wing(secs, n=8).paint(skin))
    g.merge(tube([(-0.72, 0, -0.02), (-0.92, 0, -0.04)], [0.05, 0.005], seg=5).paint(skin))
    finalize(g, 'turtle', ao=0.5, meta={'shellHalfWidth': 0.42})


def build_jelly():
    rng = random.Random(11)
    outer = [(0.0, 0.52), (0.14, 0.5), (0.3, 0.44), (0.44, 0.33), (0.55, 0.16), (0.6, -0.02), (0.6, -0.14), (0.56, -0.2)]
    inner = [(0.5, -0.12), (0.47, 0.06), (0.36, 0.24), (0.2, 0.33), (0.0, 0.36)]

    def scallop(a, z):
        return 1 + 0.045 * sin(a * 12) * sstep(0.05, -0.2, z)

    g = lathe(outer + inner, seg=24, rmod=scallop)

    def paint(p, c):
        r = (p.x * p.x + p.y * p.y) ** 0.5
        import math
        a = math.atan2(p.y, p.x)
        base = mixc(hexc('#8fd6ff'), hexc('#dff4ff'), sstep(0.3, 0.55, p.z))
        ring = sstep(0.06, 0.02, abs(r - 0.2 - 0.05 * cos(a * 4))) * sstep(0.2, 0.3, p.z)
        rim = sstep(-0.06, -0.2, p.z)
        radial = (0.5 + 0.5 * cos(a * 24)) ** 6 * sstep(0.5, 0.0, p.z) * 0.5
        e = clamp(ring + rim * 0.9 + radial)
        return (base[0], base[1], base[2], 0.12 + 0.88 * e)

    g.paint(paint)
    for k in range(4):  # frilly oral arms
        a0 = pi / 4 + k * pi / 2

        def arm(u, v, a0=a0, k=k):
            z = 0.3 - u * 1.9
            rr = 0.08 + 0.06 * sin(u * 5 + k)
            ruf = 0.07 * sin(u * 26 + v * 3) * (0.3 + u)
            wv = (v - 0.5) * 0.22 * (1 - 0.6 * u)
            return (cos(a0) * rr - sin(a0) * (wv + ruf * 0.3) + cos(a0) * ruf, sin(a0) * rr + cos(a0) * (wv + ruf * 0.3) + sin(a0) * ruf, z)

        g.merge(sheet(14, 2, arm).paint(lambda p, c: with_a(mixc(hexc('#ffd0f0'), hexc('#bfe6ff'), sstep(0.2, -1.4, p.z)), 0.55)))
    for k in range(22):  # trailing tentacles
        a0 = 2 * pi * k / 22
        ln = rng.uniform(2.0, 3.4)
        ph = rng.uniform(0, 6)

        def tent(u, v, a0=a0, ln=ln, ph=ph):
            z = -0.18 - u * ln
            rr = 0.57 + 0.05 * sin(u * 7 + ph)
            w = (v - 0.5) * 0.02
            return (cos(a0) * rr - sin(a0) * w, sin(a0) * rr + cos(a0) * w, z)

        g.merge(sheet(9, 1, tent).paint(lambda p, c: with_a(hexc('#bfe6ff'), 0.35 * sstep(-3.4, -0.2, p.z) + 0.1)))
    finalize(g, 'jelly', ao=0.0, smooth_angle=80)


def build_sub():
    """The Wisp: a small one-seat exploration pod. Glass canopy and propeller are separate objects."""
    shell, graphite, accent = hexc('#e9e4d6'), hexc('#20262b'), hexc('#ff8a1f')
    rp = curve([(0, 0.05), (0.06, 0.3), (0.2, 0.52), (0.45, 0.64), (0.72, 0.66), (0.78, 0.64)])
    rings = []
    N = 18
    for i in range(N + 1):
        t = i / N * 0.78
        x = -1.3 + t * 2.6
        r = rp(t)
        rings.append([(x, r * cos(2 * pi * j / 16), r * 0.92 * sin(2 * pi * j / 16) - 0.02) for j in range(16)])
    g = Geo()
    g.loft(rings, cap0=True, cap1=True)

    def hull_paint(p, c):
        col = mixc(graphite, shell, sstep(-0.22, -0.12, p.z))
        col = mixc(col, accent, sstep(0.05, 0.0, abs(p.z + 0.08)) * 0.95)
        col = mixc(col, accent, sstep(0.04, 0.0, abs(p.x + 0.55)) * sstep(-0.1, 0.0, p.z))
        col = mixc(col, graphite, sstep(0.66, 0.74, p.x) * 0.9)
        return mulc(col, 1 + 0.05 * fbm(p, 3, 6))

    g.paint(hull_paint)
    # Collar ring where the canopy seats.
    g.merge(lathe([(0.63, -0.04), (0.69, -0.04), (0.69, 0.04), (0.63, 0.04), (0.63, -0.04)], seg=20, c=graphite), trans(0.74, 0, -0.02) @ rot('Y', 90))
    # Cockpit interior: seat, console and a pilot silhouette.
    g.merge(box(0.5, 0.5, 0.12, hexc('#15191c'), (0.75, 0, -0.34)))
    g.merge(box(0.12, 0.44, 0.5, hexc('#2a2f33'), (0.62, 0, -0.08)))
    g.merge(box(0.16, 0.6, 0.12, hexc('#101315'), (1.16, 0, -0.26)))
    g.merge(box(0.02, 0.36, 0.1, hexc('#59f0d0', 1.0), (1.1, 0, -0.17)), rot('Y', 0))
    g.merge(icosphere(1, 0.13).fill(hexc('#d8a27a')), trans(0.82, 0, 0.14))
    g.merge(box(0.22, 0.34, 0.34, hexc('#c7502a'), (0.8, 0, -0.14)))
    # Thruster nacelles on stub pylons, with glowing trim rings.
    for sy in (1, -1):
        g.merge(wing([((-0.3, sy * 0.55, -0.02), (0.6, 0, 0), (0, 0, 0.09)), ((-0.36, sy * 0.95, -0.04), (0.42, 0, 0), (0, 0, 0.07))], c=shell))
        duct = lathe([(0.2, -0.38), (0.27, -0.3), (0.3, 0.0), (0.27, 0.34), (0.22, 0.4), (0.2, 0.34), (0.23, 0.0), (0.2, -0.3), (0.2, -0.38)],
                     seg=16, c=graphite)
        duct.paint(lambda p, c: mixc(graphite, shell, sstep(0.0, 0.1, p.z) * sstep(0.34, 0.25, p.z)))
        g.merge(duct, trans(-0.42, sy * 1.12, -0.05) @ rot('Y', 90))
        g.merge(lathe([(0.3, -0.02), (0.315, -0.02), (0.315, 0.02), (0.3, 0.02)], seg=16, c=hexc('#ffb347', 1.0)),
                trans(-0.25, sy * 1.12, -0.05) @ rot('Y', 90))
        g.merge(tube([(-0.6, sy * 1.12, -0.05), (-0.36, sy * 1.12, -0.05)], [0.07, 0.09], seg=8, c=graphite))
        # Headlamps slung under the nose.
        g.merge(lathe([(0.0, -0.1), (0.1, -0.08), (0.13, 0.08), (0.11, 0.1)], seg=10, c=graphite), trans(0.72, sy * 0.52, -0.42) @ rot('Y', 90))
        g.merge(lathe([(0.0, 0.0), (0.11, 0.0)], seg=10, c=hexc('#fff4d6', 1.0)), trans(0.825, sy * 0.52, -0.42) @ rot('Y', 90))
        g.merge(tube([(0.55, sy * 0.4, -0.3), (0.7, sy * 0.52, -0.4)], 0.035, seg=5, c=graphite))
        # Skids.
        g.merge(tube([(-0.8, sy * 0.38, -0.6), (-0.6, sy * 0.4, -0.72), (0.5, sy * 0.4, -0.72), (0.72, sy * 0.38, -0.6)], 0.04, seg=6, c=graphite))
        for sx in (-0.45, 0.3):
            g.merge(tube([(sx, sy * 0.36, -0.45), (sx, sy * 0.4, -0.72)], 0.03, seg=5, c=graphite))
        # Horizontal stabilisers.
        g.merge(wing([((-1.05, sy * 0.12, 0.0), (0.5, 0, 0), (0, 0, 0.05)), ((-1.2, sy * 0.6, 0.0), (0.25, 0, 0), (0, 0, 0.03))], c=accent))
    g.merge(wing([((-0.95, 0, 0.2), (0.6, 0, 0), (0, 0.06, 0)), ((-1.15, 0, 0.62), (0.34, 0, 0), (0, 0.04, 0)),
                  ((-1.26, 0, 0.84), (0.16, 0, 0), (0, 0.02, 0))], c=accent))
    g.merge(box(0.34, 0.1, 0.05, hexc('#fff4d6', 1.0), (0.3, 0, 0.6)))  # roof light bar
    g.merge(tube([(-0.1, 0, 0.56), (-0.16, 0, 1.0)], [0.015, 0.008], seg=4, c=graphite))
    g.merge(icosphere(1, 0.03).fill(hexc('#ff5a3c', 1.0)), trans(-0.16, 0, 1.02))
    finalize(g, 'sub_hull', ao=0.6, smooth_angle=40,
             meta={'lamps': [[0.84, 0.52, -0.42], [0.84, -0.52, -0.42]], 'props': [[-0.52, 1.12, -0.05], [-0.52, -1.12, -0.05]]})
    # Canopy.
    dome = Geo()
    rings = []
    for i in range(9):
        a = (i / 8) * pi / 2
        r = 0.635 * cos(a)
        rings.append([(0.74 + 0.72 * sin(a), r * cos(2 * pi * j / 20), r * 0.92 * sin(2 * pi * j / 20) - 0.02) for j in range(20)])
    dome.loft(rings, cap1=True, c=hexc('#bfe9ff'))
    finalize(dome, 'sub_glass', ao=0.0, smooth_angle=80)
    # Propeller (spins about X).
    prop = Geo()
    prop.merge(tube([(-0.06, 0, 0), (0.08, 0, 0)], [0.05, 0.03], seg=8, c=graphite))
    for k in range(5):
        blade = wing([((0, 0, 0.04), (0.07, 0.03, 0), (0.012, -0.03, 0)), ((0, 0, 0.13), (0.1, 0.07, 0), (0.008, -0.012, 0)),
                      ((0, 0, 0.2), (0.05, 0.05, 0), (0.004, -0.004, 0))], n=6, c=hexc('#c9c2b0'))
        prop.merge(blade, rot('X', 72 * k))
    finalize(prop, 'sub_prop', ao=0.0)


def build_all():
    build_fish()
    build_shark()
    build_angler()
    build_whale()
    build_manta()
    build_turtle()
    build_jelly()
    build_sub()
