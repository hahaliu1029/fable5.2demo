"""Builds the Blender-made models for MOTHLIGHT // NIGHT RUN and exports assets/mothlight.glb + assets/meta.json.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build_assets.py [-- --preview]

Models are Z-up with +Y forward. Vertex colour: rgb albedo (baked occlusion), alpha = emission mask.
Runs inside Blender's bundled Python (needs bpy): the documented exception to the `uv run` convention.
"""
import json
import logging
import math
import os
import sys
from math import sin, cos, pi

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
from common import Geo, hexc, mixc, mulc, sstep, curve, fbm, lerp, clamp, finalize, lathe, tube, wing, box, rot, trans  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('mothlight.assets')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'assets'))


PAINT = (0.62, 0.62, 0.66, 0.0)   # key colour: the game's shader replaces it with colour-shifting paint
TRIM = hexc('#07080b')
GLASS = (0.004, 0.006, 0.010, 0.0)  # near-black: the shader treats it as glass


def shell(stations, wheels, n=72, wheel_r=0.47, wheel_z=0.37, paint=PAINT):
    """Lower body: lofted from stations (y, half width, floor z, belt z, deck z) with wheel arches cut into the flanks."""
    f = [curve([(s[0], s[k]) for s in stations]) for k in range(1, 5)]
    y0, y1 = stations[0][0], stations[-1][0]
    ys = sorted(set([lerp(y0, y1, i / n) for i in range(n + 1)] + [yw + d for yw in wheels for d in (-wheel_r, -wheel_r * 0.7, 0.0, wheel_r * 0.7, wheel_r)]))
    rings = []
    for y in ys:
        w, zb, zbelt, zdeck = [fk(y) for fk in f]
        arch = max([wheel_z + math.sqrt(max(wheel_r ** 2 - (y - yw) ** 2, 0.0)) if abs(y - yw) < wheel_r else 0.0 for yw in wheels] + [0.0])
        zl = max(zb, min(arch, zbelt - 0.04))
        flare = 1.0 + 0.035 * max([sstep(wheel_r * 1.5, 0.0, abs(y - yw)) for yw in wheels])
        half = [(w * 0.55, zb), (w * 0.9, zl), (w * flare, zl + 0.04), (w * flare, lerp(zl, zbelt, 0.6)), (w * 0.975, zbelt),
                (w * 0.9, zdeck), (w * 0.82, zdeck + 0.012), (w * 0.42, zdeck + 0.03), (0.0, zdeck + 0.035)]
        rings.append([(x, y, z) for x, z in half] + [(-x, y, z) for x, z in reversed(half[:-1])])
    g = Geo()
    g.loft(rings, cap0=True, cap1=True)

    def pf(p, c):
        w, zb, zbelt, zdeck = [fk(p.y) for fk in f]
        col = paint
        col = mixc(col, TRIM, sstep(zb + 0.09, zb + 0.03, p.z) * (abs(p.x) < w * 0.92))     # floor
        in_arch = max([sstep(wheel_r + 0.02, wheel_r - 0.06, math.hypot(p.y - yw, p.z - wheel_z)) for yw in wheels])
        return mixc(col, TRIM, in_arch * (abs(p.x) > w * 0.8))
    g.paint(pf)
    return g, f


def canopy(stations, body_f, pillars=()):
    """Glass house: stations (y, base half width, roof z, roof half width); sits on the body deck."""
    f = [curve([(s[0], s[k]) for s in stations]) for k in range(1, 4)]
    y0, y1 = stations[0][0], stations[-1][0]
    n = 34
    rings = []
    for i in range(n + 1):
        y = lerp(y0, y1, i / n)
        bw, zr, rw = [fk(y) for fk in f]
        zd = body_f[3](y) + 0.01
        zr = max(zr, zd + 0.004)
        half = [(bw, zd), (lerp(bw, rw, 0.55), lerp(zd, zr, 0.6)), (rw, zr - 0.012), (rw * 0.6, zr + 0.006), (0.0, zr + 0.012)]
        rings.append([(x, y, z) for x, z in half] + [(-x, y, z) for x, z in reversed(half[:-1])])
    g = Geo()
    g.loft(rings, cap0=True, cap1=True)

    def pf(p, c):
        bw, zr, rw = [fk(p.y) for fk in f]
        roof = sstep(zr - 0.03, zr - 0.012, p.z) * sstep(y0 + 0.75, y0 + 0.95, p.y) * sstep(y1 - 0.5, y1 - 0.8, p.y)
        post = max([sstep(0.07, 0.035, abs(p.y - py)) for py in pillars] + [0.0]) * (abs(p.x) > rw * 0.55)
        return mixc(GLASS, PAINT, clamp(roof + post))
    g.paint(pf)
    return g


def build_hero():
    """The player's car: a low mid-engined wedge. Sculpted body with cut arches, glass canopy, blade lights, wing and twin thrusters."""
    wheels = (1.45, -1.35)
    stations = [  # y, half width, floor, belt, deck
        (-2.32, 0.80, 0.36, 0.80, 0.82), (-2.05, 0.97, 0.26, 0.86, 0.89), (-1.35, 1.0, 0.17, 0.86, 0.9), (-0.55, 0.98, 0.15, 0.80, 0.84),
        (0.5, 0.96, 0.15, 0.72, 0.75), (1.45, 0.98, 0.16, 0.63, 0.655), (2.05, 0.93, 0.2, 0.52, 0.54), (2.42, 0.66, 0.3, 0.42, 0.435)]
    g, f = shell(stations, wheels, n=84)
    g.merge(canopy([(-1.95, 0.62, 0.9, 0.3), (-1.3, 0.76, 1.03, 0.5), (-0.55, 0.8, 1.15, 0.56), (0.2, 0.8, 1.13, 0.55), (0.75, 0.78, 0.95, 0.6), (1.28, 0.74, 0.7, 0.66)], f, pillars=(0.28, -0.72)))
    glow_c, glow_r, glow_m = hexc('#bff6ff', 1.0), hexc('#ff1030', 1.0), hexc('#ff2d95', 1.0)
    # nose: a full-width light blade, two slit headlamps, splitter with winglets
    g.merge(box(1.36, 0.03, 0.022, glow_c, (0, 2.405, 0.47)))
    for sx in (1, -1):
        g.merge(wing([((sx * 0.5, 2.18, 0.535), (0.34, 0.12, 0), (0, 0, 0.03)), ((sx * 0.84, 2.0, 0.555), (0.16, 0.1, 0), (0, 0, 0.025))], n=6, c=glow_c))
        g.merge(box(0.34, 0.5, 0.2, TRIM, (sx * 0.5, 2.2, 0.3)))                                 # intakes
        g.merge(wing([((sx * 0.72, 2.36, 0.2), (0, 0.42, 0), (0, 0, 0.03)), ((sx * 1.04, 2.2, 0.21), (0, 0.3, 0), (0, 0, 0.025))], n=6, c=TRIM))
        g.merge(box(0.02, 0.2, 0.12, glow_m, (sx * 1.05, 2.18, 0.26)))
        # side: deep scoop ahead of the rear wheel, a slim neon sill, mirrors on stalks, door cut
        g.merge(box(0.1, 0.62, 0.3, TRIM, (sx * 0.985, -0.5, 0.52)))
        g.merge(box(0.02, 0.5, 0.03, glow_c, (sx * 1.0, -0.5, 0.67)))
        g.merge(box(0.014, 1.75, 0.02, glow_m, (sx * 0.992, 0.05, 0.215)))
        g.merge(wing([((sx * 0.8, 0.86, 0.86), (0, 0.08, 0), (0, 0, 0.03)), ((sx * 1.06, 0.84, 0.9), (0, 0.16, 0), (0, 0, 0.07))], n=6, c=TRIM))
        g.merge(box(0.012, 0.012, 0.42, TRIM, (sx * 0.985, 0.62, 0.5)))
        g.merge(box(0.012, 0.012, 0.42, TRIM, (sx * 0.985, -0.18, 0.5)))
        # tail: thruster nacelle with a glowing core, fins in the diffuser, wing strut and endplate
        g.merge(lathe([(0.19, -0.2), (0.215, -0.02), (0.2, 0.0), (0.15, 0.0), (0.13, -0.16)], seg=14, c=TRIM), trans(sx * 0.46, -2.33, 0.62) @ rot('X', 90))
        g.merge(lathe([(0.0, 0.0), (0.13, 0.0)], seg=14, c=hexc('#7de8ff', 1.0)), trans(sx * 0.46, -2.26, 0.62) @ rot('X', 90))
        for k in range(3):
            g.merge(box(0.025, 0.55, 0.16, TRIM, (sx * (0.16 + k * 0.26), -2.18, 0.27)))
        g.merge(box(0.045, 0.2, 0.3, TRIM, (sx * 0.62, -2.08, 1.04)))
        g.merge(box(0.025, 0.5, 0.2, TRIM, (sx * 1.0, -2.14, 1.2)))
        g.merge(box(0.012, 0.44, 0.03, glow_m, (sx * 1.016, -2.14, 1.2)))
    g.merge(box(1.9, 0.045, 0.03, glow_r, (0, -2.34, 0.83)))                                      # full-width tail blade
    g.merge(box(1.7, 0.4, 0.02, TRIM, (0, -2.12, 0.905)))                                         # engine cover louvre deck
    for k in range(5):
        g.merge(box(1.3 - k * 0.08, 0.035, 0.035, TRIM, (0, -1.98 + k * 0.1, 0.93 + k * 0.012)))
    g.merge(wing([((-1.0, -2.14, 1.2), (0, 0.36, 0), (0, 0, 0.04)), ((0, -2.18, 1.22), (0, 0.44, 0), (0, 0, 0.05)), ((1.0, -2.14, 1.2), (0, 0.36, 0), (0, 0, 0.04))], n=8, c=TRIM))
    g.merge(wing([((0, -0.2, 1.17), (0.16, 0, 0), (0, 0.5, 0)), ((0, -0.5, 1.26), (0.1, 0, 0), (0, 0.3, 0))], n=6, c=TRIM))   # roof scoop
    for sx in (1, -1):                                                                             # hood creases
        g.merge(box(0.012, 0.9, 0.012, TRIM, (sx * 0.34, 1.75, f[3](1.75) + 0.034)))
    finalize(g, 'car_body', ao=0.7, ao_dist=0.5, smooth_angle=38,
             meta={'wheels': [[0.86, 1.45, 0.37], [-0.86, 1.45, 0.37], [0.86, -1.35, 0.37], [-0.86, -1.35, 0.37]], 'tail': [0, -2.34, 0.83]})
    # wheel: a wide tyre with a shoulder, a deep-dish rim with ten blade spokes and a light ring. Axle along X.
    w = lathe([(0.0, -0.15), (0.31, -0.15), (0.355, -0.13), (0.37, -0.06), (0.37, 0.06), (0.355, 0.13), (0.31, 0.15), (0.26, 0.15), (0.25, 0.05), (0.0, 0.03)], seg=28, c=hexc('#060607'))
    w.merge(lathe([(0.235, 0.152), (0.255, 0.156), (0.262, 0.152)], seg=28, c=hexc('#7de8ff', 1.0)))
    w.merge(lathe([(0.0, 0.07), (0.075, 0.075), (0.08, 0.05), (0.0, 0.05)], seg=12, c=hexc('#9aa3b3')))
    for k in range(10):
        w.merge(box(0.028, 0.19, 0.016, hexc('#9aa3b3'), (0.0, 0.155, 0.06 + 0.004 * (k % 2))), rot('Z', 36 * k))
    w.xform(rot('Y', 90))
    finalize(w, 'car_wheel', ao=0.45, ao_dist=0.15, smooth_angle=40)


def build_traffic():
    """Two background vehicles in the key paint colour (tinted per instance): a saloon and a tall van."""
    lamp_w, lamp_r = hexc('#fff3d0', 1.0), hexc('#ff1a2a', 1.0)
    for name, wheels, stations, cab, pillars in (
        ('traffic_car', (1.35, -1.3), [(-2.2, 0.8, 0.34, 0.82, 0.85), (-1.9, 0.92, 0.26, 0.86, 0.89), (0.0, 0.93, 0.22, 0.84, 0.87), (1.4, 0.92, 0.22, 0.76, 0.78), (2.05, 0.86, 0.28, 0.66, 0.68), (2.3, 0.7, 0.34, 0.58, 0.6)],
         [(-1.75, 0.66, 0.92, 0.4), (-1.1, 0.78, 1.32, 0.6), (0.2, 0.8, 1.36, 0.62), (0.75, 0.78, 1.05, 0.66), (1.2, 0.74, 0.8, 0.68)], (0.25, -0.75)),
        ('traffic_van', (1.7, -1.6), [(-2.7, 0.9, 0.4, 1.1, 1.14), (-2.4, 0.98, 0.32, 1.12, 1.16), (1.3, 0.98, 0.3, 1.08, 1.12), (2.2, 0.94, 0.32, 0.98, 1.0), (2.7, 0.8, 0.4, 0.86, 0.88)],
         [(-2.62, 0.84, 1.9, 0.76), (-2.3, 0.9, 2.1, 0.84), (1.0, 0.9, 2.1, 0.84), (1.7, 0.86, 1.75, 0.8), (2.3, 0.8, 1.05, 0.74)], (1.0,)),
    ):
        g, f = shell(stations, wheels, n=30, wheel_r=0.42, wheel_z=0.34)
        cabin = canopy(cab, f, pillars)
        if name.endswith('van'):  # a van's box is bodywork: only the cab is glazed
            cabin.paint(lambda p, c: PAINT if p.y < 0.85 else c)
        g.merge(cabin)
        yf, yb = stations[-1][0], stations[0][0]
        for sx in (1, -1):
            g.merge(box(0.34, 0.05, 0.09, lamp_w, (sx * 0.5, yf - 0.02, f[2](yf) - 0.02)))
            g.merge(box(0.4, 0.05, 0.07, lamp_r, (sx * 0.5, yb + 0.0, f[2](yb) - 0.06)))
            for yw in wheels:
                wh = lathe([(0.0, -0.11), (0.3, -0.11), (0.34, -0.07), (0.34, 0.07), (0.3, 0.11), (0.0, 0.11)], seg=12, c=hexc('#060607'))
                wh.merge(lathe([(0.0, 0.112), (0.2, 0.115)], seg=10, c=hexc('#5a6070')))
                g.merge(wh, trans(sx * 0.82, yw, 0.34) @ rot('Y', 90 * sx))
        finalize(g, name, ao=0.6, ao_dist=0.5, smooth_angle=42)


def build_people():
    """A pedestrian in a long coat under an umbrella. Alpha is not emission here: it carries the part id / 4
    (0 body, 1 and 2 legs, 3 canopy, 4 shaft) so the game's shader can swing the legs and tint the canopy."""
    from common import uvsphere
    coat, skin, hair, shoe = (0.45, 0.45, 0.45, 0.0), hexc('#d8a98a'), hexc('#0c0b0d'), hexc('#08080a')
    g = Geo()
    rings = []
    for z, rx, ry in ((0.5, 0.25, 0.19), (0.62, 0.235, 0.18), (0.95, 0.19, 0.145), (1.12, 0.17, 0.13), (1.3, 0.205, 0.14), (1.44, 0.225, 0.125), (1.5, 0.15, 0.1), (1.53, 0.07, 0.07)):
        rings.append([(rx * cos(2 * pi * k / 12) * (1 + 0.05 * sin(k * 2.1 + z * 9) * (z < 0.9)), ry * sin(2 * pi * k / 12), z) for k in range(12)])
    body = Geo()
    body.loft(rings, cap0=True, cap1=True)
    g.merge(body.paint(lambda p, c: mixc(coat, mulc(coat, 0.45), sstep(0.03, 0.012, abs(p.x)) * (p.y > 0.05) * (p.z < 1.4) + sstep(0.02, 0.0, abs(p.z - 1.08)) * 0.8)))
    for sx in (1, -1):
        g.merge(tube([(sx * 0.235, 0, 1.42), (sx * 0.27, 0.02, 1.15), (sx * 0.25, 0.08, 0.9)], [0.065, 0.055, 0.045], seg=6, c=coat))
        g.merge(uvsphere(6, 4, 0.04).fill(skin), trans(sx * 0.25, 0.09, 0.86))
    g.merge(tube([(0, 0, 1.5), (0, 0.005, 1.6)], [0.05, 0.045], seg=6, c=skin))
    head = uvsphere(10, 8, 1.0).displace(lambda p: Vector((p.x * 0.095, p.y * 0.11, p.z * 0.12)))
    g.merge(head.paint(lambda p, c: hair if (p.z > 0.035 or p.y < -0.02) else skin), trans(0, 0.01, 1.7))
    for sx, part in ((-1, 0.25), (1, 0.5)):   # legs: separate parts so they can swing from the hip
        leg = tube([(sx * 0.1, 0, 0.86), (sx * 0.1, 0, 0.45), (sx * 0.1, 0.01, 0.07)], [0.085, 0.07, 0.055], seg=6, c=hexc('#111318'))
        leg.merge(box(0.1, 0.25, 0.08, shoe, (sx * 0.1, 0.05, 0.04)))
        g.merge(leg.paint(lambda p, c, part=part: (c[0], c[1], c[2], part)))
    canopy = Geo()
    cr = []
    for i, (r, z) in enumerate(((0.0, 2.34), (0.2, 2.32), (0.42, 2.25), (0.62, 2.12), (0.74, 2.0))):
        cr.append([(0.17 + r * cos(2 * pi * k / 16) * (1 - 0.06 * (k % 2) * (i == 4)), r * sin(2 * pi * k / 16) * (1 - 0.06 * (k % 2) * (i == 4)), z - 0.03 * (k % 2) * (i == 4)) for k in range(16)])
    canopy.loft(cr)
    g.merge(canopy.paint(lambda p, c: (0.9 - 0.25 * (0.5 + 0.5 * sin(math.atan2(p.y, p.x - 0.17) * 8)), 0.9, 0.9, 0.75)))
    shaft = tube([(0.17, 0.06, 0.95), (0.17, 0.0, 2.33)], 0.012, seg=4, c=hexc('#555a66'))
    g.merge(shaft.paint(lambda p, c: (c[0], c[1], c[2], 1.0)))
    finalize(g, 'ped', ao=0.5, ao_dist=0.4, smooth_angle=60)


def build_signal():
    """A junction signal: a pole on the corner with an arm over the road carrying a three-lamp head and a street-name board."""
    metal = hexc('#0c0e13')
    g = Geo()
    g.merge(lathe([(0.2, 0), (0.16, 0.3), (0.1, 0.5), (0.08, 6.2), (0.06, 6.4)], seg=8, c=metal))
    g.merge(tube([(0, 0, 6.0), (-0.6, 0, 6.5), (-4.6, 0, 6.6)], [0.07, 0.06, 0.045], seg=6, c=metal))
    for x in (-4.3, -2.6):
        g.merge(box(0.34, 0.3, 1.0, metal, (x, 0, 6.05)))
        for k, col in enumerate((hexc('#ff2a1a', 0.25), hexc('#ffb020', 0.12), hexc('#2aff7a', 1.0))):
            g.merge(lathe([(0.0, 0.0), (0.1, 0.0)], seg=10, c=col), trans(x, 0.16, 6.37 - k * 0.31) @ rot('X', -90))
            g.merge(lathe([(0.0, 0.0), (0.1, 0.0)], seg=10, c=col), trans(x, -0.16, 6.37 - k * 0.31) @ rot('X', 90))
    g.merge(box(1.5, 0.05, 0.36, hexc('#0a3a46'), (-1.2, 0, 6.2)))
    g.merge(box(1.3, 0.06, 0.05, hexc('#7df9ff', 1.0), (-1.2, 0, 6.2)))
    g.merge(box(0.3, 0.3, 0.5, metal, (0.0, 0.0, 1.3)))
    g.merge(box(0.18, 0.02, 0.18, hexc('#ff2d95', 1.0), (0.0, 0.16, 1.35)))
    finalize(g, 'signal', ao=0.4, ao_dist=0.6, smooth_angle=40)


def build_gate():
    """A light gate spanning the road: two pylons and a beam, edged with emissive strips. 16 m wide, origin on the road centre."""
    metal = hexc('#0b0d13')
    g = Geo()
    for sx in (1, -1):
        g.merge(box(0.7, 0.9, 7.2, metal, (sx * 7.6, 0, 3.6)))
        g.merge(box(1.3, 1.5, 0.5, metal, (sx * 7.6, 0, 0.25)))
        g.merge(box(0.08, 0.08, 6.4, hexc('#ffffff', 1.0), (sx * 7.22, 0.46, 3.7)))
        g.merge(box(0.08, 0.08, 6.4, hexc('#ffffff', 1.0), (sx * 7.22, -0.46, 3.7)))
        g.merge(wing([((sx * 7.6, 0, 7.2), (0, 0.9, 0), (0.7, 0, 0)), ((sx * 6.6, 0, 7.75), (0, 0.8, 0), (0.5, 0, 0.3))], n=6, c=metal))
    g.merge(box(13.6, 0.8, 0.5, metal, (0, 0, 7.8)))
    g.merge(box(13.0, 0.06, 0.08, hexc('#ffffff', 1.0), (0, 0.42, 7.6)))
    g.merge(box(13.0, 0.06, 0.08, hexc('#ffffff', 1.0), (0, -0.42, 7.6)))
    g.paint(lambda p, c: c if c[3] > 0.5 else mulc(c, 0.8 + 0.5 * fbm(p, 3, 1.5)))
    finalize(g, 'gate', ao=0.5, ao_dist=1.5, smooth_angle=30)


def export():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'mothlight.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_normals=True, export_texcoords=False,
                              export_materials='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_animations=False)
    with open(os.path.join(OUT, 'meta.json'), 'w') as fh:
        json.dump(common.META, fh, indent=1, sort_keys=True)
    log.info('exported %s (%.2f MB), %d models, %d tris', path, os.path.getsize(path) / 1e6, len(common.META), sum(m['tris'] for m in common.META.values()))


def preview(out_dir):
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
    bsdf.inputs['Roughness'].default_value = 0.35
    scene = bpy.context.scene
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.36, 0.45, 1)
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 700
    scene.render.image_settings.file_format = 'JPEG'
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.data.materials.append(mat)
        o.hide_render = True
    for o in objs:
        m = common.META[o.name]
        cen = Vector([(m['min'][i] + m['max'][i]) / 2 for i in range(3)])
        size = max(m['max'][i] - m['min'][i] for i in range(3))
        o.hide_render = False
        for tag, d in (('a', Vector((0.8, 0.9, 0.4))), ('b', Vector((-0.8, -0.9, 0.45)))):
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
    for fn in (build_hero, build_traffic, build_gate, build_people, build_signal):
        fn()
    for name, m in sorted(common.META.items()):
        log.info('  %-12s %6d tris', name, m['tris'])
    export()
    if '--preview' in argv:
        preview(os.path.join(HERE, 'preview'))


main()
