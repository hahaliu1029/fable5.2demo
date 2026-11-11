"""Builds the MISREMEMBER house from data/house.json: room shells, doors, static furniture and the loose props,
bakes one Cycles lightmap per room, and exports assets/house.glb, assets/props.glb, assets/lm/<room>.png and
assets/house_meta.json.

Run:  Blender -b --factory-startup -P tools/blender/build_house.py -- [--rooms a,b] [--samples 256] [--no-bake] [--preview]

Plan coordinates: a room occupies x in [0,w], y in [0,d], z up. Walls: S (y=0), N (y=d), W (x=0), E (x=w).
Wall-local coordinates are (s along the wall, depth outward through the wall, z).
Runs inside Blender's bundled Python (needs bpy).
"""
import json
import logging
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('misremember.house')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
ASSETS = os.path.join(ROOT, 'assets')
LIGHT_RANGE = 4.0  # lightmaps store irradiance / LIGHT_RANGE, sRGB encoded
WARM = (1.0, 0.74, 0.46)

with open(os.path.join(ROOT, 'data', 'house.json'), encoding='utf-8') as fh:
    HOUSE = json.load(fh)
T = HOUSE['wallT']
SIDES = {
    'S': {'a': (1, 0), 'n': (0, 1)},
    'N': {'a': (1, 0), 'n': (0, -1)},
    'W': {'a': (0, 1), 'n': (1, 0)},
    'E': {'a': (0, 1), 'n': (-1, 0)},
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'rooms': None, 'samples': 256, 'bake': True, 'preview': False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--rooms':
            opts['rooms'] = argv[i + 1].split(',')
            i += 1
        elif a == '--samples':
            opts['samples'] = int(argv[i + 1])
            i += 1
        elif a == '--no-bake':
            opts['bake'] = False
        elif a == '--preview':
            opts['preview'] = True
        else:
            raise SystemExit(f'unknown argument {a}')
        i += 1
    return opts


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


# ---------------------------------------------------------------- materials
_mats = {}


def material(name):
    if name in _mats:
        return _mats[name]
    spec = HOUSE['materials'].get(name, {'color': '#ff00ff'})
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    col = hexlin(spec['color']) + (1.0,)
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = 1.0 - spec.get('gloss', 0.05)
    if spec.get('emit'):
        bsdf.inputs['Emission Strength'].default_value = spec['emit']
        bsdf.inputs['Emission Color'].default_value = col
        raw = os.path.join(ASSETS, 'img', 'raw', f"{spec.get('tex')}.png")
        if spec.get('tex') and os.path.exists(raw):
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(raw)
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bake = nt.nodes.new('ShaderNodeTexImage')
    bake.name = 'BAKE'
    nt.nodes.active = bake
    _mats[name] = m
    return m


# ---------------------------------------------------------------- mesh builder
class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.names = []

    def mi(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

    def quad(self, pts, mat, normal):
        vs = [self.bm.verts.new(p) for p in pts]
        f = self.bm.faces.new(vs)
        f.normal_update()
        if f.normal.dot(Vector(normal)) < 0:
            f.normal_flip()
        f.material_index = self.mi(mat)
        return f

    def _finish(self, verts, mat, bevel):
        faces = {f for v in verts for f in v.link_faces}
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=2, profile=0.5, affect='EDGES')

    def box(self, lo, hi, mat, bevel=0.0, M=None):
        lo, hi = Vector(lo), Vector(hi)
        size = hi - lo
        mtx = Matrix.Translation((lo + hi) / 2) @ Matrix.Diagonal((abs(size.x), abs(size.y), abs(size.z), 1.0))
        if M is not None:
            mtx = M @ mtx
        ret = bmesh.ops.create_cube(self.bm, size=1.0, matrix=mtx)
        self._finish(ret['verts'], mat, min(bevel, 0.45 * min(abs(size.x), abs(size.y), abs(size.z))))

    def cyl(self, base, r1, r2, h, mat, seg=20, M=None, caps=True, axis='Z', flip=False):
        rot = {'Z': Matrix.Identity(4), 'Y': Matrix.Rotation(-math.pi / 2, 4, 'X'), 'X': Matrix.Rotation(math.pi / 2, 4, 'Y')}[axis]
        mtx = Matrix.Translation(Vector(base)) @ rot @ Matrix.Translation((0, 0, h / 2))
        if M is not None:
            mtx = M @ mtx
        ret = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=mtx)
        self._finish(ret['verts'], mat, 0.0)
        if flip:
            for f in {f for v in ret['verts'] for f in v.link_faces}:
                f.normal_flip()

    def ball(self, c, r, mat, M=None):
        mtx = Matrix.Translation(Vector(c))
        if M is not None:
            mtx = M @ mtx
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=14, v_segments=8, radius=r, matrix=mtx)
        self._finish(ret['verts'], mat, 0.0)

    def to_object(self, name, origin=None):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if origin is not None:
            bmesh.ops.translate(bm, verts=bm.verts, vec=-Vector(origin))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for n in self.names:
            me.materials.append(material(n))
        for p in me.polygons:
            p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(35))
        ob = bpy.data.objects.new(name, me)
        if origin is not None:
            ob.location = Vector(origin)
        bpy.context.scene.collection.objects.link(ob)
        uv0(ob)
        me.uv_layers.new(name='lm')
        return ob


def uv0(ob):
    """Box-projected UVs in metres, u running to the viewer's right; 'fit' materials get 0..1 across each face."""
    me = ob.data
    layer = me.uv_layers.new(name='uv0')
    fit = [bool(HOUSE['materials'].get(m.name, {}).get('fit')) for m in me.materials]
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uvs = []
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co + ob.location
            if ax == 2:
                uvs.append((p.x, p.y if n.z > 0 else -p.y))
            elif ax == 0:
                uvs.append((p.y if n.x > 0 else -p.y, p.z))
            else:
                uvs.append((-p.x if n.y > 0 else p.x, p.z))
        if fit and fit[poly.material_index]:
            us, vs = [u for u, _ in uvs], [v for _, v in uvs]
            du, dv = (max(us) - min(us)) or 1.0, (max(vs) - min(vs)) or 1.0
            uvs = [((u - min(us)) / du, (v - min(vs)) / dv) for u, v in uvs]
        for li, uv in zip(poly.loop_indices, uvs):
            layer.data[li].uv = uv


class Wall:
    def __init__(self, room, side):
        w, d, h = room['size']
        self.side = side
        self.a = Vector(SIDES[side]['a'] + (0,))
        self.n = Vector(SIDES[side]['n'] + (0,))
        self.o = Vector({'S': (0, 0, 0), 'N': (0, d, 0), 'W': (0, 0, 0), 'E': (w, 0, 0)}[side])
        self.L = w if side in 'SN' else d
        self.h = h

    def P(self, s, dep, z):
        return self.o + self.a * s - self.n * dep + Vector((0, 0, z))

    def box(self, b, s0, s1, dep0, dep1, z0, z1, mat, bevel=0.0):
        p, q = self.P(s0, dep0, z0), self.P(s1, dep1, z1)
        b.box([min(p[i], q[i]) for i in range(3)], [max(p[i], q[i]) for i in range(3)], mat, bevel)


def door_dims(d):
    w = d.get('w', HOUSE['door']['w'])
    h = d.get('h', HOUSE['door']['h'])
    return d['at'] - w / 2, d['at'] + w / 2, h


# ---------------------------------------------------------------- static props
class Ctx:
    """Collects what a room contributes besides geometry: lights for the bake and footprints for collision."""

    def __init__(self, room):
        self.room = room
        self.lights = []
        self.colliders = []

    def light(self, at, watts, color=WARM, r=0.04):
        self.lights.append({'at': [round(v, 3) for v in at], 'w': watts, 'color': list(color), 'r': r})

    def collide(self, M, lo, hi, h):
        pts = [M @ Vector((x, y, 0)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1])]
        xs, ys = [p.x for p in pts], [p.y for p in pts]
        self.colliders.append([round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3), h])


def knob(b, M, c, axis='Y', mat='brass'):
    b.ball(c, 0.016, mat, M)


def p_pendant(b, M, s, cx):
    h = cx.room['size'][2]
    drop = s.get('drop', 0.5)
    z = h - drop
    b.cyl((0, 0, z + 0.14), 0.004, 0.004, drop - 0.14, 'black', 8, M)
    b.cyl((0, 0, h - 0.02), 0.05, 0.05, 0.02, 'trim', 16, M)
    b.cyl((0, 0, z), 0.20, 0.10, 0.16, 'shade', 28, M, caps=False)
    b.cyl((0, 0, z + 0.001), 0.196, 0.097, 0.158, 'glow_warm', 28, M, caps=False, flip=True)
    b.cyl((0, 0, z + 0.159), 0.10, 0.10, 0.004, 'shade', 28, M)
    p = M @ Vector((0, 0, z - 0.02))
    cx.light(p, s.get('w', 60))


def p_striplight(b, M, s, cx):
    ln = s['len']
    z = s['z']
    b.box((-ln / 2, -0.02, z), (ln / 2, 0.02, z + 0.025), 'glow_warm', 0.0, M)
    for k in range(3):
        p = M @ Vector(((k - 1) * ln / 3, -0.06, z - 0.03))
        cx.light(p, s.get('w', 12) / 3, (1.0, 0.86, 0.66), 0.03)


def p_table(b, M, s, cx):
    sx, sy = s.get('size', [1.4, 0.85])
    b.box((-sx / 2, -sy / 2, 0.705), (sx / 2, sy / 2, 0.74), 'wood_dark', 0.008, M)
    b.box((-sx / 2 + 0.07, -sy / 2 + 0.07, 0.62), (sx / 2 - 0.07, sy / 2 - 0.07, 0.705), 'wood_dark', 0.0, M)
    for ix in (-1, 1):
        for iy in (-1, 1):
            x, y = ix * (sx / 2 - 0.075), iy * (sy / 2 - 0.075)
            b.box((x - 0.03, y - 0.03, 0), (x + 0.03, y + 0.03, 0.705), 'wood_dark', 0.004, M)
    cx.collide(M, (-sx / 2, -sy / 2), (sx / 2, sy / 2), 0.74)


def p_console(b, M, s, cx):
    b.box((-0.45, -0.15, 0.74), (0.45, 0.15, 0.77), 'wood_dark', 0.006, M)
    b.box((-0.42, -0.13, 0.62), (0.42, 0.13, 0.74), 'wood_dark', 0.0, M)
    b.box((-0.2, -0.138, 0.64), (0.2, -0.13, 0.72), 'wood_dark', 0.003, M)
    knob(b, M, (0, -0.15, 0.68))
    for ix in (-1, 1):
        for iy in (-1, 1):
            x, y = ix * 0.41, iy * 0.115
            b.box((x - 0.02, y - 0.02, 0), (x + 0.02, y + 0.02, 0.62), 'wood_dark', 0.003, M)
    cx.collide(M, (-0.45, -0.15), (0.45, 0.15), 0.77)


def p_radiator(b, M, s, cx):
    n = 14
    for i in range(n):
        x = -0.42 + i * 0.84 / (n - 1)
        b.box((x - 0.022, 0.03, 0.14), (x + 0.022, 0.11, 0.72), 'trim', 0.01, M)
    b.cyl((-0.45, 0.07, 0.17), 0.012, 0.012, 0.9, 'trim', 8, M, axis='X')
    b.cyl((-0.45, 0.07, 0.69), 0.012, 0.012, 0.9, 'trim', 8, M, axis='X')
    cx.collide(M, (-0.45, 0.0), (0.45, 0.12), 0.72)


def p_rug(b, M, s, cx):
    sx, sy = s['size']
    b.box((-sx / 2, -sy / 2, 0.0), (sx / 2, sy / 2, 0.012), 'rug', 0.0, M)


def p_coatrack(b, M, s, cx):
    b.box((-0.4, 0.0, 1.58), (0.4, 0.02, 1.68), 'wood_dark', 0.004, M)
    for i in range(4):
        x = -0.3 + i * 0.2
        b.cyl((x, 0.02, 1.63), 0.008, 0.008, 0.06, 'brass', 8, M, axis='Y')
        b.ball((x, 0.085, 1.63), 0.014, 'brass', M)


def p_counter(b, M, s, cx):
    ln = s['len']
    dp = 0.6
    b.box((0, 0.06, 0.0), (ln, dp, 0.1), 'black', 0.0, M)
    b.box((0, 0.02, 0.1), (ln, dp, 0.86), 'cabinet', 0.0, M)
    b.box((-0.0, -0.01, 0.86), (ln + 0.02, dp, 0.9), 'worktop', 0.006, M)
    b.box((0, dp - 0.008, 0.9), (ln, dp, 1.45), 'tile_splash', 0.0, M)
    n = max(1, round(ln / 0.5))
    wd = ln / n
    for i in range(n):
        x0, x1 = i * wd + 0.006, (i + 1) * wd - 0.006
        cooker = i == n - 2
        if cooker:
            b.box((x0, 0.002, 0.12), (x1, 0.02, 0.84), 'appliance', 0.004, M)
            b.box((x0 + 0.05, -0.002, 0.2), (x1 - 0.05, 0.004, 0.62), 'black', 0.002, M)
            b.cyl((x0 + 0.04, -0.02, 0.69), 0.008, 0.008, wd - 0.09, 'metal', 8, M, axis='X')
            b.box((x0, 0.0, 0.9), (x1, dp - 0.02, 0.905), 'black', 0.0, M)
            for rx in (0.3, 0.7):
                for ry in (0.28, 0.72):
                    b.cyl((x0 + (x1 - x0) * rx, dp * ry, 0.905), 0.075, 0.075, 0.006, 'metal', 20, M)
        else:
            b.box((x0, 0.002, 0.12), (x1, 0.02, 0.69), 'cabinet', 0.005, M)
            b.box((x0, 0.002, 0.70), (x1, 0.02, 0.85), 'cabinet', 0.005, M)
            knob(b, M, ((x0 + x1) / 2, -0.004, 0.775))
            knob(b, M, (x1 - 0.05, -0.004, 0.62))
    # sink
    sx = wd * 1.5 if n > 2 else ln / 2
    b.box((sx - 0.3, 0.1, 0.9), (sx + 0.3, 0.5, 0.904), 'metal', 0.0, M)
    b.box((sx - 0.22, 0.14, 0.9), (sx + 0.1, 0.46, 0.906), 'black', 0.0, M)
    b.cyl((sx + 0.2, 0.46, 0.9), 0.012, 0.012, 0.22, 'metal', 10, M)
    b.cyl((sx + 0.2, 0.30, 1.11), 0.01, 0.01, 0.17, 'metal', 10, M, axis='Y')
    # wall cabinets
    b.box((0, dp - 0.33, 1.45), (ln, dp, 2.15), 'cabinet', 0.0, M)
    for i in range(n):
        x0, x1 = i * wd + 0.006, (i + 1) * wd - 0.006
        b.box((x0, dp - 0.348, 1.46), (x1, dp - 0.33, 2.14), 'cabinet', 0.005, M)
        knob(b, M, (x1 - 0.05 if i % 2 == 0 else x0 + 0.05, dp - 0.354, 1.52))
    # things left out on the worktop
    b.cyl((0.2, 0.34, 0.9), 0.085, 0.07, 0.17, 'metal', 22, M)
    b.ball((0.2, 0.34, 1.075), 0.03, 'black', M)
    b.box((0.185, 0.42, 0.95), (0.215, 0.47, 1.06), 'black', 0.012, M)
    b.cyl((0.2, 0.22, 1.0), 0.016, 0.022, 0.05, 'metal', 10, M, axis='Y')
    b.box((1.38, 0.28, 0.9), (1.64, 0.44, 1.07), 'appliance', 0.03, M)
    b.box((1.43, 0.31, 1.068), (1.59, 0.335, 1.072), 'black', 0.0, M)
    b.box((1.43, 0.385, 1.068), (1.59, 0.41, 1.072), 'black', 0.0, M)
    for jx, jh in ((1.86, 0.15), (1.99, 0.13), (2.11, 0.11)):
        b.cyl((jx, 0.46, 0.9), 0.05, 0.05, jh, 'china', 18, M)
        b.cyl((jx, 0.46, 0.9 + jh), 0.053, 0.053, 0.018, 'wood_dark', 18, M)
    if ln > 3.3:
        b.box((ln - 0.44, 0.24, 0.9), (ln - 0.06, 0.5, 1.1), 'plastic_cream', 0.055, M)
    hx = (n - 2) * wd
    b.cyl((hx + wd * 0.3, dp * 0.28, 0.911), 0.09, 0.085, 0.07, 'black', 22, M)
    b.box((hx + wd * 0.3 - 0.012, dp * 0.28 - 0.26, 0.955), (hx + wd * 0.3 + 0.012, dp * 0.28 - 0.085, 0.972), 'black', 0.005, M)
    b.box((hx + 0.1, -0.034, 0.47), (hx + 0.28, -0.022, 0.7), 'coat_b', 0.004, M)
    cx.collide(M, (0, 0), (ln, dp), 0.9)


def p_fridge(b, M, s, cx):
    b.box((-0.3, -0.29, 0.02), (0.3, 0.31, 1.72), 'appliance', 0.012, M)
    b.box((-0.295, -0.325, 0.03), (0.295, -0.29, 1.1), 'appliance', 0.012, M)
    b.box((-0.295, -0.325, 1.115), (0.295, -0.29, 1.715), 'appliance', 0.012, M)
    b.box((-0.26, -0.36, 0.86), (-0.235, -0.325, 1.06), 'metal', 0.006, M)
    b.box((-0.26, -0.36, 1.16), (-0.235, -0.325, 1.36), 'metal', 0.006, M)
    cx.collide(M, (-0.3, -0.33), (0.3, 0.31), 1.72)


def p_bed(b, M, s, cx):
    hw, hl = 0.5, 1.0
    b.box((-hw - 0.02, -hl, 0.16), (hw + 0.02, hl, 0.3), 'wood_dark', 0.008, M)
    for ix in (-1, 1):
        for iy in (-1, 1):
            b.box((ix * (hw - 0.03) - 0.03, iy * (hl - 0.05) - 0.03, 0), (ix * (hw - 0.03) + 0.03, iy * (hl - 0.05) + 0.03, 0.16), 'wood_dark', 0.004, M)
    b.box((-hw - 0.03, hl, 0.0), (hw + 0.03, hl + 0.045, 1.02), 'wood_dark', 0.012, M)
    b.box((-hw, -hl + 0.01, 0.3), (hw, hl - 0.01, 0.5), 'linen', 0.05, M)
    b.box((-hw - 0.015, -hl, 0.31), (hw + 0.015, hl - 0.62, 0.525), 'blanket', 0.045, M)
    b.box((-hw - 0.017, hl - 0.72, 0.4), (hw + 0.017, hl - 0.58, 0.535), 'linen', 0.04, M)
    b.box((-0.34, hl - 0.5, 0.48), (0.34, hl - 0.08, 0.6), 'linen', 0.055, M)
    cx.collide(M, (-hw - 0.03, -hl), (hw + 0.03, hl + 0.045), 0.6)


def p_bedside(b, M, s, cx):
    b.box((-0.22, -0.19, 0.08), (0.22, 0.19, 0.52), 'wood_dark', 0.006, M)
    b.box((-0.24, -0.21, 0.52), (0.24, 0.2, 0.545), 'wood_dark', 0.006, M)
    b.box((-0.19, -0.198, 0.3), (0.19, -0.19, 0.49), 'wood_dark', 0.004, M)
    b.box((-0.19, -0.198, 0.1), (0.19, -0.19, 0.28), 'wood_dark', 0.004, M)
    knob(b, M, (0, -0.205, 0.395))
    knob(b, M, (0, -0.205, 0.19))
    for ix in (-1, 1):
        for iy in (-1, 1):
            b.box((ix * 0.19 - 0.015, iy * 0.16 - 0.015, 0), (ix * 0.19 + 0.015, iy * 0.16 + 0.015, 0.08), 'wood_dark', 0.0, M)
    if s.get('lamp'):
        lx, ly = 0.04, 0.03
        b.cyl((lx, ly, 0.545), 0.06, 0.045, 0.02, 'brass', 18, M)
        b.cyl((lx, ly, 0.565), 0.012, 0.012, 0.2, 'brass', 10, M)
        b.cyl((lx, ly, 0.74), 0.13, 0.085, 0.17, 'shade', 24, M, caps=False)
        b.cyl((lx, ly, 0.741), 0.127, 0.082, 0.168, 'glow_warm', 24, M, caps=False, flip=True)
        cx.light(M @ Vector((lx, ly, 0.82)), s['lamp'], WARM, 0.05)
    cx.collide(M, (-0.24, -0.21), (0.24, 0.2), 0.55)


def p_wardrobe(b, M, s, cx):
    b.box((-0.6, -0.28, 0.06), (0.6, 0.28, 1.95), 'wood_dark', 0.008, M)
    b.box((-0.58, -0.26, 0.0), (0.58, 0.26, 0.06), 'black', 0.0, M)
    b.box((-0.63, -0.3, 1.95), (0.63, 0.3, 1.99), 'wood_dark', 0.012, M)
    for sgn in (-1, 1):
        x0, x1 = sorted((sgn * 0.006, sgn * 0.585))
        b.box((x0, 0.28, 0.1), (x1, 0.298, 1.92), 'wood_dark', 0.006, M)
        b.box((x0 + 0.07, 0.298, 0.2), (x1 - 0.07, 0.304, 1.82), 'wood_dark', 0.006, M)
        knob(b, M, (sgn * 0.045, 0.31, 1.0))
    cx.collide(M, (-0.63, -0.3), (0.63, 0.31), 1.99)


def p_desk(b, M, s, cx):
    b.box((-0.55, -0.28, 0.71), (0.55, 0.28, 0.74), 'wood_dark', 0.006, M)
    b.box((0.2, -0.26, 0.2), (0.53, 0.26, 0.71), 'wood_dark', 0.004, M)
    for k in range(3):
        b.box((0.215, -0.268, 0.22 + k * 0.165), (0.515, -0.26, 0.37 + k * 0.165), 'wood_dark', 0.004, M)
        knob(b, M, (0.365, -0.275, 0.295 + k * 0.165))
    for iy in (-1, 1):
        b.box((-0.53, iy * 0.24 - 0.02, 0), (-0.49, iy * 0.24 + 0.02, 0.71), 'wood_dark', 0.003, M)
    b.box((0.2, -0.26, 0.0), (0.53, 0.26, 0.2), 'wood_dark', 0.0, M)
    cx.collide(M, (-0.55, -0.28), (0.55, 0.28), 0.74)


def chair_geo(b, M=None):
    b.box((-0.21, -0.21, 0.43), (0.21, 0.21, 0.462), 'wood_dark', 0.007, M)
    b.box((-0.19, -0.19, 0.37), (0.19, 0.19, 0.43), 'wood_dark', 0.0, M)
    for ix in (-1, 1):
        b.box((ix * 0.18 - 0.018, 0.162, 0), (ix * 0.18 + 0.018, 0.198, 0.43), 'wood_dark', 0.003, M)
        b.box((ix * 0.18 - 0.018, -0.205, 0), (ix * 0.18 + 0.018, -0.169, 0.93), 'wood_dark', 0.003, M)
    b.box((-0.2, -0.2, 0.84), (0.2, -0.172, 0.93), 'wood_dark', 0.006, M)
    b.box((-0.2, -0.197, 0.6), (0.2, -0.175, 0.64), 'wood_dark', 0.004, M)
    for x in (-0.09, 0.0, 0.09):
        b.box((x - 0.016, -0.194, 0.64), (x + 0.016, -0.178, 0.84), 'wood_dark', 0.003, M)


def p_chair(b, M, s, cx):
    chair_geo(b, M)
    cx.collide(M, (-0.21, -0.21), (0.21, 0.21), 0.93)


def p_coats(b, M, s, cx):
    for x, mat, z0 in ((-0.3, 'coat_a', 0.72), (0.1, 'coat_b', 0.9)):
        b.box((x - 0.19, 0.03, z0), (x + 0.19, 0.17, 1.66), mat, 0.055, M)
        b.box((x - 0.25, 0.04, z0 + 0.25), (x - 0.17, 0.14, 1.6), mat, 0.035, M)
        b.box((x + 0.17, 0.04, z0 + 0.25), (x + 0.25, 0.14, 1.6), mat, 0.035, M)
    for x in (-0.36, -0.24):
        b.box((x - 0.045, 0.05, 0), (x + 0.045, 0.31, 0.075), 'leather', 0.03, M)
        b.box((x - 0.04, 0.05, 0.05), (x + 0.04, 0.17, 0.12), 'leather', 0.03, M)
    cx.collide(M, (-0.5, 0.0), (0.3, 0.2), 1.7)


def p_mat(b, M, s, cx):
    sx, sy = s['size']
    b.box((-sx / 2, -sy / 2, 0.0), (sx / 2, sy / 2, 0.014), 'mat', 0.004, M)


def p_phone(b, M, s, cx):
    z = s.get('z', 0.77)
    b.box((-0.11, -0.085, z), (0.11, 0.085, z + 0.045), 'plastic_cream', 0.014, M)
    b.cyl((0.0, -0.01, z + 0.045), 0.052, 0.052, 0.006, 'china', 24, M)
    b.box((-0.12, 0.035, z + 0.05), (0.12, 0.08, z + 0.085), 'plastic_cream', 0.016, M)
    b.box((-0.125, 0.025, z + 0.045), (-0.07, 0.09, z + 0.075), 'plastic_cream', 0.014, M)
    b.box((0.07, 0.025, z + 0.045), (0.125, 0.09, z + 0.075), 'plastic_cream', 0.014, M)


def p_stand(b, M, s, cx):
    b.cyl((0, 0, 0), 0.1, 0.12, 0.5, 'brass', 20, M)
    b.cyl((0.02, 0.01, 0.1), 0.012, 0.012, 0.78, 'black', 8, M)
    b.cyl((-0.03, -0.02, 0.1), 0.01, 0.01, 0.7, 'wood_dark', 8, M)
    cx.collide(M, (-0.12, -0.12), (0.12, 0.12), 0.5)


def p_bin(b, M, s, cx):
    b.cyl((0, 0, 0), 0.13, 0.16, 0.46, 'plastic_cream', 22, M)
    b.cyl((0, 0, 0.46), 0.165, 0.165, 0.02, 'black', 22, M)
    cx.collide(M, (-0.16, -0.16), (0.16, 0.16), 0.48)


def p_shelf(b, M, s, cx):
    z = s.get('z', 1.45)
    b.box((-0.45, 0.0, z), (0.45, 0.19, z + 0.025), 'wood_dark', 0.004, M)
    for x in (-0.36, 0.36):
        b.box((x - 0.012, 0.0, z - 0.12), (x + 0.012, 0.15, z), 'wood_dark', 0.003, M)
    x = -0.4
    for i, (w, h, mat) in enumerate(((0.035, 0.21, 'book_a'), (0.028, 0.19, 'book_b'), (0.04, 0.23, 'book_c'), (0.03, 0.2, 'book_d'), (0.026, 0.18, 'book_a'),
                                     (0.045, 0.22, 'book_d'), (0.03, 0.21, 'book_b'), (0.034, 0.17, 'book_c'), (0.028, 0.2, 'book_a'))):
        b.box((x, 0.03, z + 0.025), (x + w, 0.17 - (i % 3) * 0.008, z + 0.025 + h), mat, 0.003, M)
        x += w + 0.002
    b.ball((0.3, 0.1, z + 0.085), 0.06, 'china', M)


def p_books(b, M, s, cx):
    z = s.get('z', 0.74)
    for i, (mat, rot) in enumerate((('book_c', 4), ('book_a', -7), ('book_d', 12))):
        R2 = M @ Matrix.Rotation(math.radians(rot), 4, 'Z')
        b.box((-0.1, -0.07, z + i * 0.03), (0.1, 0.07, z + (i + 1) * 0.03 - 0.002), mat, 0.003, R2)
    b.cyl((0.28, 0.06, z), 0.038, 0.042, 0.09, 'china', 18, M)


def p_slippers(b, M, s, cx):
    for x in (-0.06, 0.06):
        b.box((x - 0.045, -0.12, 0), (x + 0.045, 0.12, 0.035), 'coat_b', 0.016, M)
        b.box((x - 0.047, 0.0, 0.02), (x + 0.047, 0.12, 0.07), 'coat_b', 0.02, M)


def p_larder(b, M, s, cx):
    """Open shelving along +x from the origin, 0.26 deep towards +y, stocked with far too many of the same thing."""
    ln = s['len']
    seed = s.get('seed', 1)
    for x in (0.0, ln - 0.025):
        b.box((x, 0.0, 0.0), (x + 0.025, 0.26, 2.0), 'trim', 0.003, M)
    for k, z in enumerate((0.12, 0.52, 0.92, 1.32, 1.72)):
        b.box((0.0, 0.0, z), (ln, 0.26, z + 0.022), 'trim', 0.003, M)
        kind = (k + seed) % 3
        x = 0.06
        while x < ln - 0.09:
            if kind == 0:
                for row in (0.08, 0.185):
                    b.cyl((x + 0.045, row, z + 0.022), 0.04, 0.04, 0.11, 'tin_a', 12, M)
                    b.cyl((x + 0.045, row, z + 0.132), 0.041, 0.041, 0.004, 'metal', 12, M)
                x += 0.094
            elif kind == 1:
                b.cyl((x + 0.05, 0.13, z + 0.022), 0.048, 0.048, 0.15, 'china', 14, M)
                b.cyl((x + 0.05, 0.13, z + 0.172), 0.05, 0.05, 0.02, 'tin_c', 14, M)
                x += 0.112
            else:
                b.box((x, 0.05, z + 0.022), (x + 0.05, 0.21, z + 0.25), 'tin_b', 0.004, M)
                x += 0.056
    cx.collide(M, (0, 0), (ln, 0.26), 2.0)


def p_bulb(b, M, s, cx):
    h = cx.room['size'][2]
    drop = s.get('drop', 0.5)
    b.cyl((0, 0, h - drop + 0.07), 0.004, 0.004, drop - 0.07, 'black', 8, M)
    b.cyl((0, 0, h - 0.02), 0.045, 0.045, 0.02, 'trim', 16, M)
    b.cyl((0, 0, h - drop + 0.04), 0.016, 0.02, 0.04, 'brass', 12, M)
    b.ball((0, 0, h - drop), 0.034, 'glow_warm', M)
    cx.light(M @ Vector((0, 0, h - drop - 0.07)), s.get('w', 20))


def p_plinth(b, M, s, cx):
    b.box((-0.17, -0.17, 0), (0.17, 0.17, 0.9), 'unbuilt', 0.0, M)
    cx.collide(M, (-0.17, -0.17), (0.17, 0.17), 0.9)


PROPS = {k[2:]: v for k, v in list(globals().items()) if k.startswith('p_')}


# ---------------------------------------------------------------- rooms
def build_room(name, room):
    w, d, h = room['size']
    bare = room.get('bare', False)
    wallm, floorm, ceilm = room['wall'], room['floor'], room.get('ceil', 'ceiling')
    cx = Ctx(room)
    b = Builder()
    b.quad([(0, 0, 0), (w, 0, 0), (w, d, 0), (0, d, 0)], floorm, (0, 0, 1))
    b.quad([(0, 0, h), (w, 0, h), (w, d, h), (0, d, h)], ceilm, (0, 0, -1))
    objs = []
    for side in 'SNWE':
        wl = Wall(room, side)
        doors = [dd for dd in room['doors'] if dd['wall'] == side]
        wins = [ww for ww in room.get('windows', []) if ww['wall'] == side]
        holes = [(s0, s1, 0.0, hd) for s0, s1, hd in map(door_dims, doors)]
        holes += [(ww['at'] - ww['w'] / 2, ww['at'] + ww['w'] / 2, ww['sill'], ww['sill'] + ww['h']) for ww in wins]
        ss = sorted({0.0, wl.L} | {v for hole in holes for v in hole[:2]})
        zs = sorted({0.0, h} | {v for hole in holes for v in hole[2:]})
        for i in range(len(ss) - 1):
            for j in range(len(zs) - 1):
                cs, cz = (ss[i] + ss[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
                if any(a < cs < bb and c < cz < e for a, bb, c, e in holes):
                    continue
                b.quad([wl.P(ss[i], 0, zs[j]), wl.P(ss[i + 1], 0, zs[j]), wl.P(ss[i + 1], 0, zs[j + 1]), wl.P(ss[i], 0, zs[j + 1])], wallm, wl.n)
        rev = wallm if bare else 'trim'
        for dd in doors:
            s0, s1, hd = door_dims(dd)
            b.quad([wl.P(s0, 0, 0), wl.P(s0, T, 0), wl.P(s0, T, hd), wl.P(s0, 0, hd)], rev, wl.a)
            b.quad([wl.P(s1, 0, 0), wl.P(s1, T, 0), wl.P(s1, T, hd), wl.P(s1, 0, hd)], rev, -wl.a)
            b.quad([wl.P(s0, 0, hd), wl.P(s1, 0, hd), wl.P(s1, T, hd), wl.P(s0, T, hd)], rev, (0, 0, -1))
            b.quad([wl.P(s0, 0, 0), wl.P(s1, 0, 0), wl.P(s1, T, 0), wl.P(s0, T, 0)], floorm if bare else 'wood_dark', (0, 0, 1))
            objs += build_door(name, room, wl, dd, bare)
        for ww in wins:
            s0, s1, z0, z1 = ww['at'] - ww['w'] / 2, ww['at'] + ww['w'] / 2, ww['sill'], ww['sill'] + ww['h']
            dp = 0.11
            b.quad([wl.P(s0, 0, z0), wl.P(s0, dp, z0), wl.P(s0, dp, z1), wl.P(s0, 0, z1)], 'trim', wl.a)
            b.quad([wl.P(s1, 0, z0), wl.P(s1, dp, z0), wl.P(s1, dp, z1), wl.P(s1, 0, z1)], 'trim', -wl.a)
            b.quad([wl.P(s0, 0, z1), wl.P(s1, 0, z1), wl.P(s1, dp, z1), wl.P(s0, dp, z1)], 'trim', (0, 0, -1))
            b.quad([wl.P(s0, 0, z0), wl.P(s1, 0, z0), wl.P(s1, dp, z0), wl.P(s0, dp, z0)], 'trim', (0, 0, 1))
            b.quad([wl.P(s0, dp, z0), wl.P(s1, dp, z0), wl.P(s1, dp, z1), wl.P(s0, dp, z1)], ww['mat'], wl.n)
            wl.box(b, s0 - 0.05, s1 + 0.05, -0.06, 0.0, z0 - 0.03, z0, 'trim', 0.005)
            fr = 0.045
            for a0, a1, c0, c1 in ((s0, s0 + fr, z0, z1), (s1 - fr, s1, z0, z1), (s0, s1, z0, z0 + fr), (s0, s1, z1 - fr, z1),
                                   (ww['at'] - 0.018, ww['at'] + 0.018, z0, z1), (s0, s1, z0 + ww['h'] * 0.62 - 0.018, z0 + ww['h'] * 0.62 + 0.018)):
                wl.box(b, a0, a1, 0.05, 0.09, c0, c1, 'trim', 0.004)
        if not bare:
            wl.box(b, 0.0, wl.L, -0.05, 0.0, h - 0.04, h, 'ceiling', 0.012)
            for s0, s1, _ in map(door_dims, doors):
                if s1 + 0.26 < wl.L:
                    wl.box(b, s1 + 0.16, s1 + 0.245, -0.009, 0.0, 1.27, 1.355, 'plastic_cream', 0.003)
                    wl.box(b, s1 + 0.192, s1 + 0.213, -0.016, -0.009, 1.295, 1.33, 'plastic_cream', 0.003)
            for ww in wins:
                s0, s1, z0, z1 = ww['at'] - ww['w'] / 2, ww['at'] + ww['w'] / 2, ww['sill'], ww['sill'] + ww['h']
                rod = wl.P(s0 - 0.24, -0.07, z1 + 0.1)
                rod2 = wl.P(s1 + 0.24, -0.07, z1 + 0.1)
                k = 0 if wl.side in 'SN' else 1
                b.cyl(rod if rod[k] < rod2[k] else rod2, 0.011, 0.011, ww['w'] + 0.48, 'brass', 10, axis='XY'[k])
                cm = room.get('curtain', 'curtain_a')
                for c0, c1 in ((s0 - 0.2, s0 + 0.16), (s1 - 0.16, s1 + 0.2)):
                    nseg = 16
                    for i in range(nseg):
                        sa, sb = c0 + (c1 - c0) * i / nseg, c0 + (c1 - c0) * (i + 1) / nseg
                        da = -0.055 - 0.022 * math.sin(i * math.pi * 0.75)
                        db = -0.055 - 0.022 * math.sin((i + 1) * math.pi * 0.75)
                        b.quad([wl.P(sa, da, z0 - 0.28), wl.P(sb, db, z0 - 0.28), wl.P(sb, db, z1 + 0.085), wl.P(sa, da, z1 + 0.085)], cm, wl.n)
            cuts = sorted((s0 - 0.1, s1 + 0.1) for s0, s1, _ in map(door_dims, doors))
            at = 0.0
            for c0, c1 in cuts + [(wl.L, wl.L)]:
                if c0 - at > 0.02:
                    wl.box(b, at, c0, -0.016, 0.0, 0.0, 0.11, 'trim', 0.004)
                at = c1
    for s in room.get('props', []):
        M = Matrix.Translation((s['at'][0], s['at'][1], 0)) @ Matrix.Rotation(math.radians(s.get('rot', 0)), 4, 'Z')
        PROPS[s['p']](b, M, s, cx)
    for lt in room.get('lights', []):
        cx.light(lt['at'], lt['w'], lt.get('color', WARM), lt.get('r', 0.05))
    shell = b.to_object(f'{name}_shell')
    return [shell] + objs, cx


def build_door(name, room, wl, dd, bare):
    s0, s1, hd = door_dims(dd)
    did = dd['id']
    out = []
    wallm = room['wall']
    # frame (architrave): hidden while the doorway is veiled
    if not bare:
        b = Builder()
        wl.box(b, s0 - 0.07, s0, -0.02, 0.0, 0.0, hd, 'trim', 0.005)
        wl.box(b, s1, s1 + 0.07, -0.02, 0.0, 0.0, hd, 'trim', 0.005)
        wl.box(b, s0 - 0.07, s1 + 0.07, -0.02, 0.0, hd, hd + 0.07, 'trim', 0.005)
        out.append(b.to_object(f'{name}_frame_{did}'))
    # leaf: the room-side half of the door, origin on the hinge; mirrored into a full leaf after the bake
    b = Builder()
    lm = wallm if bare else ('wood_dark' if did == 'front' else 'trim')
    wl.box(b, s0 + 0.004, s1 - 0.004, 0.05, T, 0.006, hd - 0.004, lm)
    if not bare:
        mid = (s0 + s1) / 2
        for a0, a1 in ((s0 + 0.11, mid - 0.04), (mid + 0.04, s1 - 0.11)):
            for c0, c1 in ((0.22, 0.86), (1.02, 1.86)):
                wl.box(b, a0, a1, 0.042, 0.05, c0, c1, lm, 0.006)
        p0, p1 = wl.P(s1 - 0.075, 0.05, 1.0), wl.P(s1 - 0.075, 0.0, 1.0)
        k = 1 if wl.side in 'SN' else 0
        b.cyl(p0 if p0[k] < p1[k] else p1, 0.011, 0.011, 0.05, 'brass', 10, axis='XY'[k])
        b.ball(wl.P(s1 - 0.075, 0.012, 1.0), 0.027, 'brass')
    plane = wl.P(0, T, 0).dot(wl.n)
    doomed = [f for f in b.bm.faces if all(abs(v.co.dot(wl.n) - plane) < 1e-5 for v in f.verts)]
    bmesh.ops.delete(b.bm, geom=doomed, context='FACES')
    leaf = b.to_object(f'{name}_leaf_{did}', origin=wl.P(s0, T, 0))
    leaf['mirror_n'] = list(wl.n)
    out.append(leaf)
    # veil: a patch of plain wall (and skirting) that stands where the doorway was
    b = Builder()
    wl.box(b, s0 - 0.1, s1 + 0.1, -0.003, 0.0, 0.0, hd + 0.1, wallm)
    if not bare:
        wl.box(b, s0 - 0.1, s1 + 0.1, -0.016, -0.003, 0.0, 0.11, 'trim', 0.004)
    out.append(b.to_object(f'{name}_veil_{did}'))
    return out


def mirror_leaf(ob):
    """Completes a baked half leaf into a full door by mirroring it through the door plane (lightmap UVs are shared)."""
    n = Vector(ob['mirror_n'])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    ret = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
    for el in ret['geom']:
        if isinstance(el, bmesh.types.BMVert):
            el.co = el.co - 2 * el.co.dot(n) * n
    bmesh.ops.reverse_faces(bm, faces=[el for el in ret['geom'] if isinstance(el, bmesh.types.BMFace)])
    bm.to_mesh(ob.data)
    bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.set_sharp_from_angle(angle=math.radians(35))


# ---------------------------------------------------------------- the Host
def build_host():
    """A tall stand-in for a person: a skinned, subdivided body with slightly too-long arms and neck and a smooth,
    featureless head. Faces +y. Built with the Skin modifier so it reads as one organic form, not assembled parts."""
    J = {  # joint: (position, (radius x, radius y))
        'pelvis': ((0, 0, 1.03), (0.15, 0.10)), 'waist': ((0, 0.005, 1.2), (0.125, 0.088)), 'chest': ((0, 0.012, 1.42), (0.165, 0.105)),
        'collar': ((0, 0.0, 1.6), (0.11, 0.08)), 'neck': ((0, 0.008, 1.72), (0.043, 0.045)), 'jaw': ((0, 0.018, 1.82), (0.062, 0.07)),
        'head': ((0, 0.012, 1.93), (0.088, 0.1)), 'crown': ((0, 0.0, 2.035), (0.058, 0.07)),
    }
    E = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'collar'), ('collar', 'neck'), ('neck', 'jaw'), ('jaw', 'head'), ('head', 'crown')]
    for sx, tag in ((-1, 'L'), (1, 'R')):
        J[f'sh{tag}'] = ((sx * 0.2, 0, 1.585), (0.058, 0.055))
        J[f'el{tag}'] = ((sx * 0.245, -0.01, 1.24), (0.04, 0.042))
        J[f'wr{tag}'] = ((sx * 0.255, 0.02, 0.9), (0.028, 0.03))
        J[f'pa{tag}'] = ((sx * 0.258, 0.03, 0.8), (0.018, 0.038))
        J[f'fi{tag}'] = ((sx * 0.258, 0.036, 0.67), (0.01, 0.022))
        J[f'hi{tag}'] = ((sx * 0.085, 0, 0.95), (0.088, 0.09))
        J[f'kn{tag}'] = ((sx * 0.09, 0.012, 0.52), (0.058, 0.06))
        J[f'an{tag}'] = ((sx * 0.092, 0.0, 0.085), (0.04, 0.045))
        J[f'to{tag}'] = ((sx * 0.095, 0.17, 0.035), (0.045, 0.028))
        E += [('collar', f'sh{tag}'), (f'sh{tag}', f'el{tag}'), (f'el{tag}', f'wr{tag}'), (f'wr{tag}', f'pa{tag}'), (f'pa{tag}', f'fi{tag}'),
              ('pelvis', f'hi{tag}'), (f'hi{tag}', f'kn{tag}'), (f'kn{tag}', f'an{tag}'), (f'an{tag}', f'to{tag}')]
    names = list(J)
    me = bpy.data.meshes.new('host_skeleton')
    me.from_pydata([J[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in E], [])
    ob = bpy.data.objects.new('host_skeleton', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new('skin', 'SKIN')
    for i, n in enumerate(names):
        me.skin_vertices[0].data[i].radius = J[n][1]
        me.skin_vertices[0].data[i].use_root = n == 'pelvis'
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    done = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob)
    done.name = 'host'
    for n in ('host_cloth', 'host_skin'):
        done.materials.append(material(n))
    for p in done.polygons:
        p.use_smooth = True
        c = p.center
        p.material_index = 1 if c.z > 1.7 or (abs(c.x) > 0.2 and c.z < 0.91) else 0
    host = bpy.data.objects.new('host', done)
    bpy.context.scene.collection.objects.link(host)
    uv0(host)
    done.uv_layers.new(name='lm')
    log.info('host: %d faces', len(done.polygons))
    return host


# ---------------------------------------------------------------- loose props
def build_props():
    """Things that drift: built at the origin, lit in real time by the game. Wall props face -y with their back at y=0."""
    out = []
    b = Builder()
    chair_geo(b)
    out.append(b.to_object('chair'))

    b = Builder()
    b.cyl((0, -0.04, 0), 0.172, 0.172, 0.04, 'black', 40, axis='Y')
    b.cyl((0, -0.044, 0), 0.156, 0.156, 0.004, 'clock_face', 40, axis='Y')
    out.append(b.to_object('clock'))
    b = Builder()
    b.box((-0.008, -0.05, -0.02), (0.008, -0.047, 0.085), 'black')
    out.append(b.to_object('clock_hand_h'))
    b = Builder()
    b.box((-0.005, -0.054, -0.02), (0.005, -0.051, 0.132), 'black')
    out.append(b.to_object('clock_hand_m'))

    for nm, w, h in (('frame_photo', 0.36, 0.27), ('frame_painting', 0.9, 0.6)):
        b = Builder()
        t = 0.03 if w < 0.5 else 0.045
        b.box((-w / 2 - t, -0.026, -h / 2 - t), (-w / 2, 0, h / 2 + t), 'brass' if w > 0.5 else 'wood_dark', 0.006)
        b.box((w / 2, -0.026, -h / 2 - t), (w / 2 + t, 0, h / 2 + t), 'brass' if w > 0.5 else 'wood_dark', 0.006)
        b.box((-w / 2 - t, -0.026, h / 2), (w / 2 + t, 0, h / 2 + t), 'brass' if w > 0.5 else 'wood_dark', 0.006)
        b.box((-w / 2 - t, -0.026, -h / 2 - t), (w / 2 + t, 0, -h / 2), 'brass' if w > 0.5 else 'wood_dark', 0.006)
        b.quad([(-w / 2, -0.01, -h / 2), (w / 2, -0.01, -h / 2), (w / 2, -0.01, h / 2), (-w / 2, -0.01, h / 2)], 'pic', (0, -1, 0))
        out.append(b.to_object(nm))

    b = Builder()
    b.cyl((0, 0, 0), 0.1, 0.137, 0.016, 'china', 40)
    b.cyl((0, 0, 0.016), 0.128, 0.128, 0.002, 'pic', 40)
    out.append(b.to_object('plate'))
    b = Builder()
    b.box((0.165, -0.1, 0), (0.183, 0.1, 0.003), 'metal', 0.001)
    b.box((-0.185, -0.1, 0), (-0.167, 0.06, 0.003), 'metal', 0.001)
    b.box((-0.19, 0.06, 0), (-0.162, 0.1, 0.003), 'metal', 0.001)
    out.append(b.to_object('cutlery'))

    b = Builder()
    b.box((-0.011, -0.1, 0), (0.011, 0.1, 0.003), 'leather', 0.001)
    b.cyl((0, 0, 0.003), 0.021, 0.021, 0.009, 'brass', 28)
    b.cyl((0, 0, 0.012), 0.0175, 0.0175, 0.001, 'watch_face', 28)
    out.append(b.to_object('watch'))
    b = Builder()
    for x, y, rz in ((0.0, 0.0, 0), (0.062, 0.012, 25), (0.03, 0.058, -40)):
        R2 = Matrix.Translation((x, y, 0.016)) @ Matrix.Rotation(math.radians(rz), 4, 'Z') @ Matrix.Rotation(math.radians(90), 4, 'X')
        ret = bmesh.ops.create_cone(b.bm, cap_ends=False, segments=24, radius1=0.026, radius2=0.026, depth=0.03, matrix=R2)
        b._finish(ret['verts'], 'brass', 0.0)
        ret = bmesh.ops.create_cone(b.bm, cap_ends=False, segments=24, radius1=0.0235, radius2=0.0235, depth=0.03, matrix=R2)
        b._finish(ret['verts'], 'brass', 0.0)
        for f in {f for v in ret['verts'] for f in v.link_faces}:
            f.normal_flip()
    out.append(b.to_object('rings'))
    out.append(build_host())
    return out


# ---------------------------------------------------------------- baking
def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.diffuse_bounces = 6
    sc.cycles.sample_clamp_indirect = 3.0
    world = bpy.data.worlds.new('void')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    sc.world = world


def add_lights(name, cx):
    out = []
    for i, lt in enumerate(cx.lights):
        ld = bpy.data.lights.new(f'{name}_l{i}', 'POINT')
        ld.energy = lt['w']
        ld.color = lt['color']
        ld.shadow_soft_size = lt['r']
        ob = bpy.data.objects.new(ld.name, ld)
        ob.location = lt['at']
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    return out


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def unwrap(objs):
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['lm']
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        o.data.uv_layers['uv0'].active_render = True


def bake_room(name, room, objs):
    res = room.get('lm', 1024)
    img = bpy.data.images.new(f'{name}_lm', res, res, alpha=True, float_buffer=True)
    for m in _mats.values():
        m.node_tree.nodes['BAKE'].image = img
        m.node_tree.nodes.active = m.node_tree.nodes['BAKE']
    veils = [o for o in objs if '_veil_' in o.name]
    solid = [o for o in objs if '_veil_' not in o.name]
    leaves = [o for o in objs if '_leaf_' in o.name]
    sc = bpy.context.scene
    sc.render.bake.margin = 3
    sc.render.bake.use_clear = True
    for o in veils:
        o.hide_render = True
    select(solid)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=3, use_clear=True)
    for o in veils:
        o.hide_render = False
    frames = [o for o in objs if '_frame_' in o.name]
    for o in leaves + frames:
        o.hide_render = True
    select(veils)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=3, use_clear=False)
    for o in leaves + frames:
        o.hide_render = False
    px = np.empty(res * res * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgba = px.reshape(res, res, 4)
    rgb = denoise(rgba[:, :, :3], rgba[:, :, 3] > 0.5).reshape(-1, 3)
    log.info('  %s irradiance: mean %.3f  p50 %.3f  p99 %.3f  max %.3f', name, rgb.mean(), np.percentile(rgb, 50), np.percentile(rgb, 99), rgb.max())
    v = np.clip(rgb / LIGHT_RANGE, 0.0, 1.0)
    enc = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    out = bpy.data.images.new(f'{name}_lm8', res, res, alpha=False)
    buf = np.ones((res * res, 4), dtype=np.float32)
    buf[:, :3] = enc
    out.pixels.foreach_set(buf.ravel())
    os.makedirs(os.path.join(ASSETS, 'lm'), exist_ok=True)
    out.filepath_raw = os.path.join(ASSETS, 'lm', f'{name}.png')
    out.file_format = 'PNG'
    out.save()


def blur(a, taps=(0.06, 0.24, 0.4, 0.24, 0.06)):
    r = len(taps) // 2
    for axis in (0, 1):
        pad = np.pad(a, [(r, r) if k == axis else (0, 0) for k in range(a.ndim)], mode='edge')
        a = sum(w * np.take(pad, range(i, i + a.shape[axis]), axis=axis) for i, w in enumerate(taps))
    return a


def denoise(rgb, mask):
    """Cycles does not denoise bakes, so: knock down fireflies, then a small blur that never mixes across the
    empty gutters between UV islands, then grow the islands outward so bilinear filtering finds no black."""
    m = mask.astype(np.float32)[:, :, None]
    if m.sum() < 16:
        m = (rgb.sum(axis=2, keepdims=True) > 1e-6).astype(np.float32)
    wsum = np.maximum(blur(m), 1e-6)
    local = blur(rgb * m) / wsum
    rgb = np.minimum(rgb, local * 2.5 + 0.02)
    out = np.where(m > 0, blur(rgb * m) / wsum, 0.0)
    # dim texels carry the most noise for their brightness: give them a second, wider pass
    wide = blur(blur(out * m)) / np.maximum(blur(blur(m)), 1e-6)
    dim = np.clip(1.0 - out.mean(axis=2, keepdims=True) / 0.35, 0.0, 1.0)
    out = np.where(m > 0, out * (1.0 - dim) + wide * dim, 0.0)
    for _ in range(4):
        grown = blur(out * m) / np.maximum(blur(m), 1e-6)
        seen = blur(m) > 0.02
        out = np.where(m > 0, out, np.where(seen, grown, 0.0))
        m = np.maximum(m, seen.astype(np.float32))
    return out


def preview(name, room):
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.lens = 16
    cam.clip_start = 0.05
    ob = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(ob)
    at, look = Vector(room['cam']['at']), Vector(room['cam']['look'])
    ob.location = at
    ob.rotation_euler = (look - at).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = ob
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.exposure = 0.0
    keep = sc.cycles.samples
    sc.cycles.samples = 96
    os.makedirs(os.path.join(HERE, 'preview'), exist_ok=True)
    sc.render.filepath = os.path.join(HERE, 'preview', f'{name}.png')
    bpy.ops.render.render(write_still=True)
    sc.cycles.samples = keep
    bpy.data.objects.remove(ob)


def main():
    opts = parse_args()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    setup_cycles(opts['samples'])
    meta_path = os.path.join(ASSETS, 'house_meta.json')
    meta = {}
    if opts['rooms'] and os.path.exists(meta_path):
        with open(meta_path, encoding='utf-8') as fh:
            meta = json.load(fh)
    everything = []
    for name, room in HOUSE['rooms'].items():
        log.info('room %s', name)
        objs, cx = build_room(name, room)
        meta[name] = {'lights': cx.lights, 'colliders': cx.colliders}
        todo = not opts['rooms'] or name in opts['rooms']
        unwrap(objs)
        if todo and (opts['bake'] or opts['preview']):
            lights = add_lights(name, cx)
            veils = [o for o in objs if '_veil_' in o.name]
            if opts['preview']:
                for o in veils:
                    o.hide_render = not any(dd.get('veil') and o.name.endswith('_' + dd['id']) for dd in room['doors'])
                preview(name, room)
                for o in veils:
                    o.hide_render = False
            if opts['bake']:
                bake_room(name, room, objs)
            for o in lights:
                bpy.data.objects.remove(o)
        for o in objs:
            if '_leaf_' in o.name:
                mirror_leaf(o)
            o.hide_render = True
            o.hide_viewport = False
        # park the room out of the way so the next room bakes alone
        for o in objs:
            o.location.z -= 100.0
        everything += objs
    for o in everything:
        o.location.z += 100.0
        o.hide_render = False
    with open(meta_path, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, indent=1)
    select(everything)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS, 'house.glb'), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='NONE', export_materials='EXPORT', export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False, export_extras=False)
    log.info('wrote assets/house.glb (%d objects)', len(everything))
    props = build_props()
    select(props)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS, 'props.glb'), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='NONE', export_materials='EXPORT', export_texcoords=True,
                              export_normals=True, export_cameras=False, export_lights=False, export_extras=False)
    log.info('wrote assets/props.glb (%d objects)', len(props))


main()
