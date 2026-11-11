"""Builds the Blender-made models for 青云宗 · 御剑采灵 and exports assets/qingyun.glb + assets/meta.json.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build_assets.py [-- --preview]

Models are Z-up with +Y forward (the game flies along -Z after the exporter's Y-up conversion). Every vertex carries
a painted linear colour with ray-cast ambient occlusion baked in, and an emission mask in alpha.
This script runs inside Blender's bundled Python (it needs bpy), so it is the documented exception to `uv run`.
"""
import json
import logging
import math
import os
import random
import sys
from math import sin, cos, pi

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
from common import (Geo, hexc, mixc, mulc, with_a, sstep, curve, fbm, vor, lerp, clamp, finalize, uvsphere, icosphere,  # noqa: E402
                    lathe, tube, wing, sheet, box, grow_tree, skin_tree, rot, trans, scl)

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('qingyun.assets')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'assets'))

GOLD = hexc('#c9a14a')
GLOW = hexc('#ffffff', 1.0)


def ering(cx, cy, z, rx, ry, n=16, mod=None):
    """Ellipse in the XY plane; angle 0 is +X, pi/2 is +Y (forward)."""
    out = []
    for k in range(n):
        a = 2 * pi * k / n
        m = mod(a) if mod else 1.0
        out.append((cx + rx * cos(a) * m, cy + ry * sin(a) * m, z))
    return out


def bezier(a, b, c, u):
    a, b, c = Vector(a), Vector(b), Vector(c)
    ctrl = b * 2 - (a + c) * 0.5
    return a * (1 - u) ** 2 + ctrl * 2 * u * (1 - u) + c * u * u


# ------------------------------------------------------------------------------------------------ the rider
def build_rider():
    """A sword-riding cultivator: layered robe swept back by the wind, wide sleeves, sash and jade, crowned topknot."""
    robe_a, robe_b = hexc('#eef2f8'), hexc('#a9cfe2')
    teal, teal_d, skin, hair = hexc('#1f6f73'), hexc('#12474b'), hexc('#e8c4aa'), hexc('#0b0b10')
    cloud = hexc('#8fd8e4', 0.22)

    def robe_col(p, hem_z=0.5):
        c = mixc(robe_a, robe_b, sstep(0.75, 0.1, p.z))
        emb = sstep(0.54, 0.6, 0.5 + 0.5 * fbm((p.x * 5, p.y * 5, p.z * 7), 3)) * sstep(hem_z, hem_z - 0.3, p.z)
        c = mixc(c, cloud, emb * 0.85)
        return mulc(c, 1 + 0.05 * fbm(p, 2, 9)) if c[3] == 0 else c

    g = Geo()
    # Skirt of the robe, flaring and streaming backward (-Y), with deep folds.
    rings = []
    N = 13
    for i in range(N + 1):
        t = i / N
        z = lerp(1.09, 0.12, t)
        fold = lambda a, t=t: 1 + 0.085 * t * sin(9 * a + 2.5 * t) + 0.03 * t * sin(17 * a)
        rings.append(ering(0, -0.34 * t ** 1.6, z, 0.185 + 0.30 * t ** 1.15, 0.135 + 0.40 * t ** 1.1, 28, fold))
    skirt = Geo()
    skirt.loft(rings, cap1=True)

    def skirt_paint(p, c):
        if p.z < 0.125 and math.hypot(p.x, p.y + 0.34) < 0.2:
            return hexc('#10151c')
        col = robe_col(p)
        # inner robe showing at the front opening, and a darker hem band
        front = sstep(0.07, 0.03, abs(p.x)) * sstep(0.0, 0.08, p.y + 0.34 * clamp((1.09 - p.z) / 0.97) ** 1.6)
        col = mixc(col, teal, front * 0.9)
        return mixc(col, teal_d, sstep(0.19, 0.15, p.z) * 0.85)

    g.merge(skirt.paint(skirt_paint))

    # Torso.
    torso = Geo()
    torso.loft([ering(0, 0, 1.04, 0.172, 0.122), ering(0, 0, 1.2, 0.19, 0.13), ering(0, 0.01, 1.38, 0.215, 0.135), ering(0, 0, 1.49, 0.235, 0.118),
                ering(0, 0, 1.545, 0.19, 0.105), ering(0, 0, 1.585, 0.085, 0.08)], cap0=True, cap1=True)

    def torso_paint(p, c):
        col = robe_col(p, 0.0)
        if p.y > 0.02:  # crossed collar: a teal band with gold piping, right over left
            d = abs(p.x + 0.42 * (p.z - 1.2)) if p.x > -0.02 else abs(-p.x + 0.42 * (p.z - 1.56) + 0.18)
            col = mixc(col, GOLD, sstep(0.045, 0.036, d))
            col = mixc(col, teal, sstep(0.034, 0.026, d))
        return col

    g.merge(torso.paint(torso_paint))
    # Sash with a gold edge, a knot and a hanging jade pendant.
    sash = Geo()
    sash.loft([ering(0, 0, z, rx, ry) for z, rx, ry in ((1.02, 0.186, 0.134), (1.03, 0.198, 0.146), (1.12, 0.203, 0.15), (1.135, 0.19, 0.137))])
    g.merge(sash.paint(lambda p, c: mixc(teal_d, GOLD, sstep(0.012, 0.004, min(abs(p.z - 1.035), abs(p.z - 1.118))))))
    g.merge(box(0.07, 0.05, 0.08, GOLD, (0.07, 0.15, 1.075)))
    g.merge(tube([(0.07, 0.165, 1.04), (0.085, 0.2, 0.9), (0.09, 0.2, 0.78)], 0.008, seg=4, c=hexc('#b3202a')))
    g.merge(lathe([(0.0, -0.012), (0.045, -0.012), (0.05, 0.0), (0.045, 0.012), (0.0, 0.012)], seg=10, c=hexc('#6dffc0', 0.9)), trans(0.09, 0.2, 0.74) @ rot('X', 90))
    g.merge(tube([(0.09, 0.2, 0.7), (0.09, 0.19, 0.56)], [0.014, 0.002], seg=4, c=hexc('#b3202a')))

    # Sleeves: wide, with a hanging drape under the forearm. One hand forms a sword-seal, the other rests behind.
    def sleeve(sh, el, wr, drape):
        s = Geo()
        rings = []
        n = 10
        for i in range(n + 1):
            u = i / n
            p = bezier(sh, el, wr, u)
            t = (bezier(sh, el, wr, min(u + 0.02, 1)) - bezier(sh, el, wr, max(u - 0.02, 0))).normalized()
            side = t.cross(Vector((0, 0, 1))).normalized()
            up = side.cross(t)
            r = lerp(0.1, 0.165, u ** 0.8)
            ring = []
            for k in range(14):
                a = 2 * pi * k / 14
                off = side * cos(a) * r + up * sin(a) * r * 0.85
                if sin(a) < 0:
                    off += up * sin(a) * r * drape * u ** 1.4 * (1 + 0.12 * sin(a * 5 + u * 4))
                ring.append(p + off)
            rings.append(ring)
        s.loft(rings, cap0=True)
        w = Vector(wr)

        def paint(p, c):
            col = robe_col(Vector((p.x, p.y, p.z - 0.55)), 0.3)
            d = (p - w).length
            col = mixc(col, cloud, sstep(0.36, 0.3, d) * sstep(0.55, 0.62, 0.5 + 0.5 * fbm((p.x * 9, p.y * 9, p.z * 9), 2)))
            return mixc(col, teal, sstep(0.215, 0.2, d) * sstep(0.12, 0.16, d))

        return s.paint(paint)

    g.merge(sleeve((0.225, 0.0, 1.49), (0.36, 0.1, 1.24), (0.15, 0.31, 1.35), 2.6))
    g.merge(sleeve((-0.225, 0.0, 1.49), (-0.35, -0.1, 1.2), (-0.1, -0.2, 1.06), 2.2))
    # Hands.
    hand = uvsphere(8, 6, 1.0).displace(lambda p: Vector((p.x * 0.038, p.y * 0.05, p.z * 0.055)))
    g.merge(Geo().merge(hand).fill(skin), trans(0.135, 0.335, 1.385))
    g.merge(Geo().merge(hand).fill(skin), trans(-0.085, -0.215, 1.045))
    for dx in (-0.011, 0.011):  # two raised fingers of the sword seal
        g.merge(tube([(0.135 + dx, 0.345, 1.42), (0.133 + dx, 0.352, 1.5)], [0.011, 0.008], seg=5, c=skin))

    # Neck and head (face toward +Y), hair, topknot and crown.
    g.merge(tube([(0, 0.0, 1.56), (0, 0.008, 1.68)], [0.058, 0.052], seg=10, c=skin))
    head = Geo()
    hr = []
    prof = [(1.632, 0.03, 0.035, 0.03), (1.655, 0.068, 0.078, 0.02), (1.70, 0.092, 0.104, 0.012), (1.76, 0.104, 0.116, 0.006),
            (1.83, 0.108, 0.122, 0.0), (1.89, 0.102, 0.116, -0.004), (1.94, 0.082, 0.095, -0.006), (1.975, 0.045, 0.052, -0.006)]
    fz = [curve([(q[0], q[k]) for q in prof]) for k in (1, 2, 3)]
    for i in range(27):
        z = lerp(1.632, 1.975, i / 26)
        rx, ry, cy = fz[0](z), fz[1](z), fz[2](z)
        nose = lambda a, z=z: 1 + 0.085 * math.exp(-((a - pi / 2) / 0.16) ** 2) * math.exp(-((z - 1.765) / 0.035) ** 2) \
            - 0.03 * math.exp(-((abs(a - pi / 2) - 0.42) / 0.16) ** 2) * math.exp(-((z - 1.81) / 0.03) ** 2)
        hr.append(ering(0, cy, z, rx, ry, 40, nose))
    head.loft(hr, cap0=True, cap1=True)

    def head_paint(p, c):
        a = math.atan2(p.y, p.x)
        hairline = 1.865 - 0.05 * abs(cos(a)) ** 3
        is_hair = p.z > hairline or p.y < -0.03 or (p.y < 0.03 and p.z > 1.76)
        if is_hair:
            return mulc(hair, 1 + 0.6 * abs(sin(a * 30)))
        col = skin
        brow = sstep(0.012, 0.004, abs(p.z - 1.838)) * sstep(0.06, 0.03, abs(abs(p.x) - 0.045)) * (p.y > 0.08)
        eye = sstep(0.008, 0.003, abs(p.z - 1.815)) * sstep(0.03, 0.014, abs(abs(p.x) - 0.042)) * (p.y > 0.08)
        lips = sstep(0.008, 0.003, abs(p.z - 1.712)) * sstep(0.03, 0.016, abs(p.x)) * (p.y > 0.08)
        col = mixc(col, hexc('#191417'), clamp(brow * 0.9 + eye))
        return mixc(col, hexc('#b8615a'), lips * 0.8)

    g.merge(head.paint(head_paint))
    g.merge(sheet(6, 4, lambda u, v: (lerp(-0.1, 0.1, v) * (1 - 0.35 * u), -0.118 - 0.03 * sin(pi * v) - 0.03 * u, lerp(1.9, 1.34, u))).fill(hair))  # hair down the back
    g.merge(uvsphere(10, 7, 1.0).displace(lambda p: Vector((p.x * 0.055, p.y * 0.055, p.z * 0.062))).fill(hair), trans(0, -0.01, 2.02))
    g.merge(lathe([(0.062, 1.975), (0.07, 1.99), (0.066, 2.035), (0.05, 2.04)], seg=12, c=GOLD), trans(0, -0.01, 0))
    g.merge(tube([(-0.13, -0.01, 2.012), (0.13, -0.01, 2.012)], [0.004, 0.009], seg=5, c=hexc('#e8ffe9', 0.4)))
    # Boots, mostly hidden under the hem.
    for y in (0.3, -0.24):
        g.merge(uvsphere(8, 5, 1.0).displace(lambda p: Vector((p.x * 0.06, p.y * 0.13, p.z * 0.05))).fill(hexc('#15181d')), trans(0.02 if y > 0 else -0.02, y, 0.1))
    finalize(g, 'rider', ao=0.75, ao_dist=0.6, smooth_angle=70)


def build_sword():
    """The flying jian: a broad diamond-section blade with glowing runes, cloud guard, bound grip and ringed pommel."""
    g = Geo()
    steel, edge = hexc('#aebcc4'), hexc('#eef6f8')
    rings = []
    n = 22
    for i in range(n + 1):
        v = i / n
        y = lerp(-1.25, 2.45, v)
        w = 0.17 * (1 - v ** 5) * (0.92 + 0.08 * cos(v * 9)) + 0.002
        th = 0.045 * (1 - v ** 4) + 0.002
        rings.append([(w, y, 0), (w * 0.3, y, th * 0.75), (0, y, th), (-w * 0.3, y, th * 0.75), (-w, y, 0), (-w * 0.3, y, -th * 0.75), (0, y, -th), (w * 0.3, y, -th * 0.75)])
    blade = Geo()
    blade.loft(rings, cap0=True, cap1=True)
    blade.paint(lambda p, c: mixc(steel, edge, sstep(0.55, 0.95, abs(p.x) / (0.17 * (1 - clamp((p.y + 1.25) / 3.7) ** 5) + 0.002))))
    g.merge(blade)
    # Rune inlays down the fuller, top and bottom.
    rng = random.Random(3)
    y = -0.95
    while y < 1.75:
        ln = rng.uniform(0.07, 0.22)
        for sz in (1, -1):
            z = sz * (0.045 * (1 - ((y + 1.25) / 3.7) ** 4) + 0.004)
            wv = rng.uniform(0.012, 0.03)
            s = Geo()
            s.loft([[(-wv, y, z), (wv, y, z)], [(-wv * 0.6, y + ln, z), (wv * 0.6, y + ln, z)]], closed=False, c=hexc('#9ffff0', 1.0))
            g.merge(s)
        y += ln + rng.uniform(0.04, 0.09)
    # Guard: a pair of curled cloud wings and a jade boss.
    for sx in (1, -1):
        g.merge(wing([((0, -1.30, 0), (0, 0.26, 0), (0, 0, 0.13)), ((sx * 0.26, -1.31, 0), (0, 0.2, 0), (0, 0, 0.1)),
                      ((sx * 0.44, -1.27, 0), (0, 0.15, 0), (0, 0, 0.085)), ((sx * 0.53, -1.19, 0), (0, 0.06, 0), (0, 0, 0.05))], n=8, c=GOLD))
    for sz in (1, -1):
        g.merge(uvsphere(8, 5, 0.05).fill(hexc('#6dffc0', 1.0)), trans(0, -1.3, sz * 0.055))
    # Grip with binding, and a ringed pommel.
    g.merge(tube([(0, -1.4, 0), (0, -1.98, 0)], [0.052, 0.058], seg=8).paint(lambda p, c: mixc(hexc('#3a1418'), hexc('#7a2a2a'), 0.5 + 0.5 * sin(p.y * 90 + math.atan2(p.z, p.x) * 2))))
    for yy in (-1.42, -1.69, -1.96):
        g.merge(lathe([(0.058, -0.02), (0.068, 0.0), (0.058, 0.02)], seg=10, c=GOLD), trans(0, yy, 0) @ rot('X', 90))
    g.merge(uvsphere(10, 6, 1.0).displace(lambda p: Vector((p.x * 0.1, p.y * 0.075, p.z * 0.06))).fill(GOLD), trans(0, -2.05, 0))
    finalize(g, 'sword', ao=0.5, ao_dist=0.25, smooth_angle=32)


# ------------------------------------------------------------------------------------------------ crane and dragon
def build_crane():
    """Red-crowned crane in level flight: neck stretched forward, legs trailing, black secondaries and neck."""
    white, black, red = hexc('#f4f1ea'), hexc('#121216'), hexc('#c8202a')
    g = Geo()
    rp = curve([(0, 0.02), (0.15, 0.17), (0.45, 0.24), (0.8, 0.2), (1, 0.09)])
    rings = []
    for i in range(10):  # XZ sections along Y, tail to chest
        u = i / 9
        r = rp(u)
        rings.append([(r * 0.85 * cos(2 * pi * k / 10), lerp(-0.62, 0.55, u), r * sin(2 * pi * k / 10) + 0.02 * sin(pi * u)) for k in range(10)])
    body = Geo()
    body.loft(rings, cap0=True, cap1=True)
    g.merge(body.paint(lambda p, c: mixc(white, black, sstep(-0.3, -0.55, p.y))))
    neck = [(0, 0.5, 0.05), (0, 0.85, 0.16), (0, 1.25, 0.2), (0, 1.58, 0.17)]
    g.merge(tube(neck, [0.085, 0.05, 0.04, 0.038], seg=7).paint(lambda p, c: mixc(white, black, sstep(0.7, 0.85, p.y) * sstep(0.0, -0.02, p.z - 0.19 + 0.0 * p.y))))
    head = uvsphere(8, 6, 1.0).displace(lambda p: Vector((p.x * 0.05, p.y * 0.075, p.z * 0.052)))
    g.merge(head.paint(lambda p, c: mixc(mixc(black, white, sstep(-0.02, 0.0, p.y - 0.0)), red, sstep(0.02, 0.035, p.z))), trans(0, 1.62, 0.175))
    g.merge(tube([(0, 1.67, 0.17), (0, 1.98, 0.14)], [0.022, 0.004], seg=5, c=hexc('#6b6a4a')))
    for sx in (1, -1):
        g.merge(tube([(sx * 0.06, -0.5, -0.05), (sx * 0.05, -1.2, -0.03), (sx * 0.05, -1.65, 0.0)], [0.022, 0.012, 0.01], seg=4, c=hexc('#2a2a2c')))
        secs = []
        for i in range(10):
            u = i / 9
            x = sx * (0.1 + 2.3 * u)
            chord = 0.62 * (1 - u) ** 0.55 * (0.8 + 0.2 * sin(u * 3)) + 0.05
            secs.append(((x, 0.12 - 0.22 * u * u, 0.05), (0, chord, 0), (0, 0, 0.06 * (1 - u) + 0.008)))
        w = wing(secs, n=8)

        def wp(p, c, sx=sx):
            u = (abs(p.x) - 0.1) / 2.3
            trailing = sstep(-0.02, -0.14, p.y - (0.12 - 0.22 * u * u))
            feather = 0.5 + 0.5 * sin(abs(p.x) * 38)
            col = mixc(white, mulc(white, 0.86), feather * trailing)
            return mixc(col, black, clamp(sstep(0.62, 0.72, u) + trailing * sstep(0.25, 0.4, u)))

        g.merge(w.paint(wp))
    finalize(g, 'crane', ao=0.35, ao_dist=0.5, smooth_angle=70)


def build_dragon():
    """A long 龙 modelled straight along -Y; the game bends it along its flight path in the vertex shader."""
    L = 46.0
    jade, jade_d, belly, gold = hexc('#1f8f84'), hexc('#0c3f47'), hexc('#e9d9a0'), hexc('#ffcf5a', 0.75)
    rad = curve([(0, 1.15), (4, 1.5), (10, 1.5), (22, 1.25), (34, 0.8), (42, 0.38), (46, 0.08)])
    g = Geo()
    rings = []
    N = 110
    for i in range(N + 1):
        s = L * i / N
        r = rad(s)
        ring = []
        for k in range(14):
            a = 2 * pi * k / 14
            zz = sin(a)
            ring.append((r * cos(a) * 0.92, -s, r * (zz if zz > 0 else zz * 0.82)))
        rings.append(ring)
    body = Geo()
    body.loft(rings, cap0=True, cap1=True)

    def body_paint(p, c):
        s = -p.y
        r = rad(s) + 1e-4
        up = p.z / r
        f1, f2 = vor((math.atan2(p.z, p.x) * 2.2, s * 1.25, 0), 1.0)
        scale = sstep(0.0, 0.12, f2 - f1)
        col = mixc(jade_d, jade, scale * (0.55 + 0.45 * sstep(-0.3, 0.9, up)))
        col = mixc(col, with_a(hexc('#7dffe0'), 0.5), (1 - scale) * 0.35 * sstep(0.2, 0.9, up))
        plate = mulc(belly, 0.8 + 0.2 * sin(s * 5.5))
        return mixc(col, plate, sstep(-0.35, -0.6, up))

    g.merge(body.paint(body_paint))
    # Dorsal crest: a row of flame-shaped plates along the spine.
    s = 1.5
    while s < L - 1.5:
        r = rad(s)
        h = (0.75 + 0.25 * sin(s * 1.7)) * r * 0.95 + 0.12
        ln = 0.7 * r + 0.25
        fin = Geo()
        fin.loft([[(0, -s, r * 0.9), (0, -s - ln, r * 0.92)], [(0, -s - ln * 0.9, r + h * 0.6), (0, -s - ln * 0.75, r + h * 0.62)], [(0, -s - ln * 1.25, r + h), (0, -s - ln * 1.25, r + h)]],
                 closed=False, c=gold)
        g.merge(fin)
        s += ln * 0.95
    # Legs with three claws each.
    for s0 in (7.5, 25.0):
        for sx in (1, -1):
            r = rad(s0)
            hip = Vector((sx * r * 0.7, -s0, -r * 0.4))
            knee = hip + Vector((sx * 0.9, 0.5, -0.5))
            foot = knee + Vector((sx * 0.25, 0.9, -0.8))
            g.merge(tube([hip, knee, foot], [0.34, 0.24, 0.16], seg=7).paint(lambda p, c: mixc(jade_d, jade, 0.5 + 0.5 * fbm(p, 3, 2.5))))
            for k in (-1, 0, 1):
                tip = foot + Vector((sx * 0.25 + k * 0.28, 0.75, -0.3))
                g.merge(tube([foot, (foot + tip) / 2 + Vector((0, 0, 0.12)), tip], [0.09, 0.06, 0.005], seg=5, c=hexc('#f3ead0')))
    # Head: skull and snout, lower jaw, antlers, whiskers, mane and eyes.
    hs = [(0.0, 0.74, 0.7, 0.0), (0.7, 0.9, 0.78, 0.06), (1.5, 0.86, 0.66, 0.08), (2.3, 0.6, 0.42, -0.02), (3.1, 0.5, 0.33, -0.08), (3.55, 0.42, 0.28, -0.1), (3.8, 0.2, 0.14, -0.12)]
    skull = Geo()
    skull.loft([[(rx * cos(2 * pi * k / 14), y, cz + rz * (sin(2 * pi * k / 14) if sin(2 * pi * k / 14) > 0 else sin(2 * pi * k / 14) * 0.55)) for k in range(14)]
                for y, rx, rz, cz in hs], cap0=True, cap1=True)

    def skull_paint(p, c):
        col = mixc(jade_d, jade, 0.5 + 0.5 * fbm(p, 3, 1.6))
        col = mixc(col, belly, sstep(-0.05, -0.25, p.z))
        nostril = sstep(0.1, 0.05, math.hypot(abs(p.x) - 0.2, p.y - 3.6)) * (p.z > -0.1)
        return mixc(col, hexc('#0a1418'), nostril)

    head = Geo()
    head.merge(skull.paint(skull_paint))
    jaw = Geo()
    jaw.loft([[(rx * cos(pi + pi * k / 8), y, cz - rz * sin(pi * k / 8)) for k in range(9)] for y, rx, rz, cz in
              ((0.4, 0.7, 0.4, -0.38), (1.5, 0.7, 0.3, -0.5), (2.6, 0.48, 0.2, -0.62), (3.5, 0.3, 0.12, -0.7))], closed=False, c=belly)
    head.merge(jaw)
    for sx in (1, -1):
        for y in (2.2, 2.7, 3.2):  # teeth
            head.merge(tube([(sx * 0.4, y, -0.2), (sx * 0.38, y + 0.03, -0.45)], [0.05, 0.004], seg=4, c=hexc('#fff6e0')))
        base = Vector((sx * 0.42, 0.9, 0.62))
        mid = base + Vector((sx * 0.5, -1.3, 1.1))
        tip = mid + Vector((sx * 0.35, -1.5, 0.9))
        head.merge(tube([base, mid, tip], [0.16, 0.1, 0.02], seg=6, c=hexc('#e9d9a0')))
        head.merge(tube([mid, mid + Vector((sx * 0.6, -0.5, 0.7))], [0.09, 0.015], seg=5, c=hexc('#e9d9a0')))
        wh = [Vector((sx * 0.4, 3.5, -0.05)), Vector((sx * 1.5, 3.9, 0.3)), Vector((sx * 2.3, 2.4, 0.8)), Vector((sx * 2.6, 0.2, 0.5)), Vector((sx * 2.4, -2.4, 0.1))]
        head.merge(tube(wh, [0.07, 0.05, 0.035, 0.022, 0.006], seg=5, c=gold))
        head.merge(uvsphere(8, 6, 0.13).fill(hexc('#ffe27a', 1.0)), trans(sx * 0.62, 1.75, 0.42))
        head.merge(tube([(sx * 0.3, 1.2, 0.68), (sx * 0.7, 1.9, 0.62), (sx * 0.72, 2.3, 0.5)], [0.14, 0.12, 0.03], seg=5, c=jade_d))  # brow ridge
        for k in range(6):  # mane: flame-like sheets swept back from the cheeks and nape
            a = 0.25 + k * 0.42
            root = Vector((sx * 0.8 * cos(a), 0.6 - 0.2 * k, 0.75 * sin(a) + 0.05))
            ln = 2.6 - 0.2 * k

            def mane(u, v, root=root, a=a, ln=ln, sx=sx):
                w = (v - 0.5) * 0.7 * (1 - u) ** 0.8
                out = Vector((sx * cos(a), 0, sin(a)))
                return root + out * (0.25 + 0.5 * u) + Vector((0, -ln * u, 0.25 * sin(u * 5))) + Vector((-sx * sin(a), 0, cos(a))) * w

            head.merge(sheet(5, 2, mane).paint(lambda p, c: mixc(hexc('#e8f6f0'), gold, sstep(0.5, -2.2, p.y))))
    g.merge(head, scl(1.55))
    # Tail flame.
    for k in range(5):
        a = 2 * pi * k / 5

        def flame(u, v, a=a):
            w = (v - 0.5) * 0.9 * sin(pi * min(u + 0.15, 1)) ** 0.8
            return (cos(a) * (0.1 + 0.6 * u * (1 - u)) - sin(a) * w, -L + 0.6 - 3.4 * u, sin(a) * (0.1 + 0.6 * u * (1 - u)) + cos(a) * w)

        g.merge(sheet(6, 2, flame).fill(gold))
    finalize(g, 'dragon', ao=0.5, ao_dist=1.6, smooth_angle=60, meta={'length': L})


# ------------------------------------------------------------------------------------------------ trees and props
def _terminals(out):
    verts, edges, _ = out
    deg = [0] * len(verts)
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1
    return [Vector(verts[i]) for i in range(1, len(verts)) if deg[i] == 1]


def tufts(rng, center, R, n, flat, paint, sub=1, size=(0.3, 0.52)):
    """A cluster of small rounded tufts filling a disc: reads as a mass of needles or blossom, not one blob."""
    g = Geo()
    for k in range(n):
        a = rng.uniform(0, 2 * pi)
        d = R * math.sqrt(rng.random()) * 0.85 if k else 0.0
        r = R * rng.uniform(*size)
        off = Vector((rng.uniform(0, 9), rng.uniform(0, 9), rng.uniform(0, 9)))
        t = icosphere(sub, 1.0)
        t.displace(lambda q, r=r, off=off: Vector((q.x * r, q.y * r, q.z * r * flat)) * (0.8 + 0.4 * (0.5 + 0.5 * fbm(q * 2.0 + off, 2))))
        z = rng.uniform(-0.1, 0.16) * R
        t.paint(lambda q, c, r=r: paint(q, r))
        g.merge(t, trans(center.x + cos(a) * d, center.y + sin(a) * d, center.z + z))
    return g


def build_pines():
    """Gnarled mountain pines: a twisting trunk carrying flat, cloud-like tiers of needles."""
    for n, seed in enumerate((11, 23, 37)):
        rng = random.Random(seed)
        out = ([], [], [])
        lean = rng.uniform(-0.3, 0.3)
        p = dict(segs=3, jitter=0.3, up=0.35, taper=0.72, shrink=0.72, spread=1.05, kids=(2, 3, 3))
        grow_tree(rng, (0, 0, -0.3), (lean, 0.1, 1), 2.3, 0.2, 2, p, out)
        g = skin_tree(out)
        g.paint(lambda q, c: mixc(hexc('#2a1c17'), hexc('#5c4436'), 0.5 + 0.5 * fbm((q.x * 6, q.y * 6, q.z * 1.2), 3)))
        tips = _terminals(out)
        top = max(t.z for t in tips)
        extra = [t + Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), rng.uniform(-0.35, 0.25))) for t in tips]
        spots = tips + extra + [Vector((lean * top * 0.5, 0, top + 0.3))]
        sizes = [rng.uniform(0.85, 1.35) * (1.15 - 0.4 * t.z / top) for t in spots]
        seeds = [rng.random() for _ in spots]
        needle = lambda q, r: mixc(hexc('#081c10'), hexc('#2c5c27'), sstep(-0.3, 0.6, q.z / r) * (0.55 + 0.45 * (0.5 + 0.5 * fbm(q, 2, 4.0))))
        for hi in (False, True):
            t = Geo().merge(g)
            for p, r, sd in zip(spots, sizes, seeds):
                if hi:  # tiers of small tufts
                    t.merge(tufts(random.Random(int(sd * 1e6)), p + Vector((0, 0, 0.05)), r, 18, 0.62, needle, sub=0, size=(0.2, 0.34)))
                else:   # one flattened pad per tier: for distant trees
                    off = Vector((sd * 9, sd * 5, 0))
                    pad = icosphere(2, 1.0)
                    pad.displace(lambda q, r=r, off=off: Vector((q.x * r, q.y * r, max(q.z, -0.35) * r * 0.36)) * (0.75 + 0.5 * (0.5 + 0.5 * fbm(q * 1.7 + off, 3))))
                    pad.paint(lambda q, c, r=r: needle(q, r * 0.36))
                    t.merge(pad, trans(p.x, p.y, p.z + 0.05))
            b0, b1 = t.bounds()
            finalize(t, f'pine{"h" if hi else ""}{n}', ao=0.65, ao_dist=1.5, smooth_angle=180, meta={'height': round(b1[2], 2)})


def build_peach():
    """Peach trees in full blossom: fine branching, each twig wrapped in a cloud of small blossom tufts."""
    for n, seed in enumerate((5, 19)):
        rng = random.Random(seed)
        out = ([], [], [])
        p = dict(segs=2, jitter=0.38, up=0.22, taper=0.66, shrink=0.76, spread=0.8, kids=(2, 3, 3))
        grow_tree(rng, (0, 0, -0.3), (0.12, 0, 1), 1.35, 0.15, 3, p, out)
        g = skin_tree(out)
        g.paint(lambda q, c: mixc(hexc('#231517'), hexc('#57382f'), 0.5 + 0.5 * fbm((q.x * 7, q.y * 7, q.z * 2), 3)))
        verts, edges, radii = out
        spots = _terminals(out) + [Vector(verts[i]) for i in range(len(verts)) if radii[i] < 0.07 and i % 2 == 0]
        for t in spots:
            tone = rng.random()

            def blossom(q, r, tone=tone):
                c = mixc(mixc(hexc('#e2668f'), hexc('#ffc4d8'), tone), hexc('#fff4f7'), sstep(-0.2, 0.7, q.z / r) * 0.55)
                return mixc(c, hexc('#c2386a'), sstep(0.6, 0.9, 0.5 + 0.5 * fbm(q, 2, 9.0)) * 0.5)

            g.merge(tufts(rng, t, rng.uniform(0.42, 0.7), 8, 0.8, blossom, sub=0 if n else 1))
        b0, b1 = g.bounds()
        finalize(g, f'peach{n}', ao=0.6, ao_dist=1.0, smooth_angle=180, meta={'height': round(b1[2], 2)})


def build_ding():
    """A bronze incense burner (鼎): three legs, two ears, a banded bowl, glowing embers and incense sticks."""
    bronze, verd = hexc('#6b4a2a'), hexc('#3f8f7c')
    g = lathe([(0.0, 0.62), (0.45, 0.62), (0.8, 0.8), (0.92, 1.15), (0.9, 1.45), (0.98, 1.56), (1.0, 1.62), (0.9, 1.62), (0.84, 1.5), (0.8, 1.3), (0.0, 1.22)], seg=28)

    def paint(p, c):
        k = 0.5 + 0.5 * fbm(p, 4, 2.2)
        col = mixc(bronze, mulc(bronze, 0.55), k)
        band = sstep(0.05, 0.03, abs(p.z - 1.05)) + sstep(0.03, 0.018, abs(p.z - 1.4))
        col = mixc(col, mulc(GOLD, 0.8), clamp(band) * 0.8)
        meander = sstep(0.4, 0.5, sin(math.atan2(p.y, p.x) * 16) * sin(p.z * 40)) * sstep(0.12, 0.08, abs(p.z - 1.22))
        col = mixc(col, mulc(GOLD, 0.6), meander * 0.6)
        col = mixc(col, verd, sstep(0.55, 0.8, 0.5 + 0.5 * fbm(p + Vector((3, 1, 2)), 3, 1.3)) * 0.55)
        if math.hypot(p.x, p.y) < 0.8 and p.z > 1.2 and p.z < 1.32:
            return mixc(hexc('#2a2622'), hexc('#ff8a3a', 1.0), sstep(0.12, 0.04, vor(p, 7.0)[0]))
        return col

    g.paint(paint)
    for k in range(3):
        a = 2 * pi * k / 3 + pi / 2
        g.merge(tube([(cos(a) * 0.62, sin(a) * 0.62, 0.78), (cos(a) * 0.8, sin(a) * 0.8, 0.4), (cos(a) * 0.72, sin(a) * 0.72, 0.0)], [0.2, 0.15, 0.17], seg=8).paint(paint))
    for sx in (1, -1):
        ear = [(sx * 0.94, 0, 1.55), (sx * 1.12, 0, 1.75), (sx * 1.1, 0, 2.05), (sx * 0.9, 0, 2.12)]
        for dy in (-0.2, 0.2):
            g.merge(tube([(p[0], dy, p[2]) for p in ear], 0.06, seg=6).paint(paint))
        g.merge(tube([(sx * 0.9, -0.2, 2.12), (sx * 0.9, 0.2, 2.12)], 0.06, seg=6).paint(paint))
    rng = random.Random(8)
    for k in range(3):
        x, y = rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2)
        g.merge(tube([(x, y, 1.25), (x * 1.3, y * 1.3, 2.25)], 0.012, seg=4, c=hexc('#7a3a2a')))
        g.merge(icosphere(0, 0.03).fill(hexc('#ffb060', 1.0)), trans(x * 1.3, y * 1.3, 2.27))
    finalize(g, 'ding', ao=0.7, ao_dist=0.8, smooth_angle=75, meta={'top': 2.3})


def build_lotus():
    """A lotus bloom: two rings of cupped petals around a seed pod."""
    g = lathe([(0.0, 0.12), (0.07, 0.12), (0.085, 0.2), (0.0, 0.2)], seg=10, c=hexc('#d8c44a'))
    for ring, (count, ln, tilt, z0) in enumerate(((8, 0.3, 0.9, 0.06), (7, 0.24, 0.45, 0.1))):
        for k in range(count):
            a = 2 * pi * (k + 0.5 * ring) / count

            def petal(u, v, a=a, ln=ln, tilt=tilt, z0=z0):
                w = (v - 0.5) * 0.2 * sin(pi * min(u * 0.9 + 0.1, 1)) ** 0.7
                out = 0.06 + ln * (sin(tilt) * u)
                z = z0 + ln * cos(tilt) * u + 0.1 * u * u - 0.12 * (2 * v - 1) ** 2 * (0.3 + u) * 0.3
                return (cos(a) * out - sin(a) * w, sin(a) * out + cos(a) * w, z)

            g.merge(sheet(4, 2, petal).paint(lambda p, c: mixc(hexc('#fff2f5'), hexc('#f0679a'), sstep(0.05, 0.38, p.z + math.hypot(p.x, p.y) * 0.4))))
    finalize(g, 'lotus', ao=0.35, ao_dist=0.2, smooth_angle=80)


def export():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'qingyun.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_normals=True, export_texcoords=False,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_animations=False)
    with open(os.path.join(OUT, 'meta.json'), 'w') as fh:
        json.dump(common.META, fh, indent=1, sort_keys=True)
    log.info('exported %s (%.2f MB), %d models, %d tris', path, os.path.getsize(path) / 1e6, len(common.META), sum(m['tris'] for m in common.META.values()))


def preview(out_dir):
    """Render each model so shapes and colours can be checked by eye."""
    os.makedirs(out_dir, exist_ok=True)
    mat = bpy.data.materials.new('preview')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(attr.outputs['Alpha'], bsdf.inputs['Emission Strength'])
    bsdf.inputs['Roughness'].default_value = 0.7
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.3, 0.34, 0.42, 1)
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(55), 0, math.radians(140))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 800
    scene.render.image_settings.file_format = 'JPEG'
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.data.materials.append(mat)
        o.hide_render = True
    for o in objs:
        m = common.META[o.name]
        lo, hi = m['min'], m['max']
        cen = Vector([(lo[i] + hi[i]) / 2 for i in range(3)])
        size = max(hi[i] - lo[i] for i in range(3))
        o.hide_render = False
        for tag, d in (('a', Vector((0.75, 0.9, 0.35))), ('b', Vector((-0.9, -0.6, 0.3)))):  # front-right and back-left
            cam.location = cen + d.normalized() * size * 3
            cam.rotation_euler = (cen - cam.location).to_track_quat('-Z', 'Y').to_euler()
            cam.data.ortho_scale = size * 1.25
            cam.data.clip_end = size * 8 + 10
            scene.render.filepath = os.path.join(out_dir, f'{o.name}_{tag}.jpg')
            bpy.ops.render.render(write_still=True)
        o.hide_render = True


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for fn in (build_rider, build_sword, build_crane, build_dragon, build_pines, build_peach, build_ding, build_lotus):
        fn()
    for name, m in sorted(common.META.items()):
        log.info('  %-10s %6d tris', name, m['tris'])
    export()
    if '--preview' in argv:
        preview(os.path.join(HERE, 'preview'))


main()
