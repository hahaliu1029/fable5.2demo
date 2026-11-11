"""Shared helpers for the procedural asset pipeline (runs inside Blender's Python).

Conventions: models are built Z-up with +Y forward (the game flies along -Z); the glTF exporter converts to Y-up.
Every vertex carries a linear RGBA colour: RGB is albedo, A is an emission mask.
"""
import math
import random
from math import sin, cos, pi

import bpy
import bmesh
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

WHITE = (1.0, 1.0, 1.0, 0.0)
META = {}  # asset name -> extra data written next to the GLB


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h, a=0.0):
    h = h.lstrip('#')
    return (lin(int(h[0:2], 16) / 255), lin(int(h[2:4], 16) / 255), lin(int(h[4:6], 16) / 255), a)


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def mixc(a, b, t):
    t = clamp(t)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(4))


def mulc(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, c[3])


def with_a(c, a):
    return (c[0], c[1], c[2], a)


def sstep(e0, e1, x):
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def curve(pts):
    """Smooth 1D interpolation through (x, y) control points (cubic Hermite)."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(pts)
    ms = []
    for i in range(n):
        if i == 0:
            m = (ys[1] - ys[0]) / (xs[1] - xs[0])
        elif i == n - 1:
            m = (ys[-1] - ys[-2]) / (xs[-1] - xs[-2])
        else:
            m = (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1])
        ms.append(m)

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while x > xs[i + 1]:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        h00 = 2 * t ** 3 - 3 * t ** 2 + 1
        h10 = t ** 3 - 2 * t ** 2 + t
        h01 = -2 * t ** 3 + 3 * t ** 2
        h11 = t ** 3 - t ** 2
        return h00 * ys[i] + h10 * h * ms[i] + h01 * ys[i + 1] + h11 * h * ms[i + 1]

    return f


def fbm(p, octaves=4, scale=1.0):
    """Fractal noise, roughly in [-1, 1]."""
    return noise.fractal(Vector(p) * scale, 1.0, 2.0, octaves)


def vor(p, scale=1.0):
    """Returns (F1, F2) Voronoi distances."""
    d = noise.voronoi(Vector(p) * scale)[0]
    return d[0], d[1]


def spow(x, e):
    return math.copysign(abs(x) ** e, x)


class Geo:
    """A simple indexed mesh builder with per-vertex colour."""

    def __init__(self):
        self.v = []
        self.f = []
        self.c = []
        self.e = []

    def vert(self, p, c=WHITE):
        self.v.append((p[0], p[1], p[2]))
        self.c.append(c)
        return len(self.v) - 1

    def loft(self, rings, closed=True, cap0=False, cap1=False, c=WHITE):
        n = len(rings[0])
        base = len(self.v)
        for r in rings:
            for p in r:
                self.vert(p, c)
        m = n if closed else n - 1
        for i in range(len(rings) - 1):
            for j in range(m):
                a = base + i * n + j
                b = base + i * n + (j + 1) % n
                self.f.append((a, b, b + n, a + n))
        if cap0:
            self._cap(range(base, base + n), c)
        if cap1:
            self._cap(range(base + (len(rings) - 1) * n, base + len(rings) * n), c)
        return list(range(base, len(self.v)))

    def _cap(self, idx, c):
        idx = list(idx)
        cen = Vector((0, 0, 0))
        for i in idx:
            cen += Vector(self.v[i])
        cen /= len(idx)
        ci = self.vert(cen, c)
        for k in range(len(idx)):
            self.f.append((idx[k], idx[(k + 1) % len(idx)], ci))

    def merge(self, o, M=None):
        base = len(self.v)
        for p, c in zip(o.v, o.c):
            if M is not None:
                p = tuple(M @ Vector(p))
            self.v.append(p)
            self.c.append(c)
        for f in o.f:
            self.f.append(tuple(i + base for i in f))
        for e in o.e:
            self.e.append((e[0] + base, e[1] + base))
        return self

    def xform(self, M):
        self.v = [tuple(M @ Vector(p)) for p in self.v]
        return self

    def paint(self, fn):
        self.c = [fn(Vector(p), c) for p, c in zip(self.v, self.c)]
        return self

    def fill(self, c):
        self.c = [c] * len(self.v)
        return self

    def displace(self, fn):
        self.v = [tuple(fn(Vector(p))) for p in self.v]
        return self

    def bounds(self):
        xs = [p[0] for p in self.v]
        ys = [p[1] for p in self.v]
        zs = [p[2] for p in self.v]
        return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))

    def to_mesh(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, self.e, self.f)
        me.update()
        if self.f:
            attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
            attr.data.foreach_set('color', [x for c in self.c for x in c])
        return me

    @staticmethod
    def from_mesh(me):
        g = Geo()
        g.v = [tuple(v.co) for v in me.vertices]
        g.f = [tuple(p.vertices) for p in me.polygons]
        attr = me.color_attributes.get('Col')
        if attr is not None and len(attr.data) == len(g.v):
            g.c = [tuple(d.color) for d in attr.data]
        else:
            g.c = [WHITE] * len(g.v)
        return g

    @staticmethod
    def from_bmesh(bm):
        me = bpy.data.meshes.new('tmp')
        bm.to_mesh(me)
        bm.free()
        g = Geo.from_mesh(me)
        bpy.data.meshes.remove(me)
        return g


def modify(geo, mods, skin_radii=None):
    """Run Blender modifiers over a Geo and return the evaluated result."""
    me = geo.to_mesh('tmp_mod')
    ob = bpy.data.objects.new('tmp_mod', me)
    bpy.context.scene.collection.objects.link(ob)
    for typ, props in mods:
        m = ob.modifiers.new(typ, typ)
        for k, val in props.items():
            setattr(m, k, val)
        if typ == 'SKIN' and skin_radii is not None:
            layer = me.skin_vertices[0].data
            for i, r in enumerate(skin_radii):
                layer[i].radius = (r, r)
            layer[0].use_root = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = Geo.from_mesh(me2)
    bpy.data.meshes.remove(me2)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


def icosphere(sub=2, r=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    return Geo.from_bmesh(bm)


def uvsphere(seg=10, rings=6, r=1.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    return Geo.from_bmesh(bm)


def box(sx, sy, sz, c=WHITE, center=(0, 0, 0)):
    g = Geo()
    cx, cy, cz = center
    for dz in (-0.5, 0.5):
        for dy in (-0.5, 0.5):
            for dx in (-0.5, 0.5):
                g.vert((cx + dx * sx, cy + dy * sy, cz + dz * sz), c)
    g.f = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return g


def lathe(profile, seg=16, c=WHITE, rmod=None, cap0=False, cap1=False):
    """Revolve (r, z) profile points around Z. rmod(angle, z) scales the radius."""
    g = Geo()
    rings = []
    for r, z in profile:
        ring = []
        for j in range(seg):
            a = 2 * pi * j / seg
            k = rmod(a, z) if rmod else 1.0
            ring.append((r * k * cos(a), r * k * sin(a), z))
        rings.append(ring)
    g.loft(rings, cap0=cap0, cap1=cap1, c=c)
    return g


def tube(path, radii, seg=6, c=WHITE, cap=True):
    """Sweep a circle along a list of points with per-point radius."""
    g = Geo()
    rings = []
    n = len(path)
    prev_side = None
    for i in range(n):
        p = Vector(path[i])
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, n - 1)])
        t = (b - a)
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        t.normalize()
        ref = prev_side if prev_side is not None else (Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
        side = (ref - t * ref.dot(t))
        if side.length < 1e-6:
            side = t.orthogonal()
        side.normalize()
        prev_side = side
        up = t.cross(side)
        r = radii[i] if hasattr(radii, '__len__') else radii
        rings.append([p + (side * cos(2 * pi * j / seg) + up * sin(2 * pi * j / seg)) * r for j in range(seg)])
    g.loft(rings, cap0=cap, cap1=cap, c=c)
    return g


def wing(sections, n=8, c=WHITE):
    """Loft elliptical sections: each is (centre, chord_vector, thickness_vector)."""
    g = Geo()
    rings = []
    for cen, chord, thick in sections:
        cen = Vector(cen)
        chord = Vector(chord)
        thick = Vector(thick)
        rings.append([cen + chord * 0.5 * cos(2 * pi * k / n) + thick * 0.5 * sin(2 * pi * k / n) for k in range(n)])
    g.loft(rings, cap0=True, cap1=True, c=c)
    return g


def sheet(nu, nv, fn, c=WHITE):
    """Open grid surface: fn(u, v) -> point for u, v in [0, 1]."""
    g = Geo()
    rows = [[fn(i / nu, j / nv) for j in range(nv + 1)] for i in range(nu + 1)]
    g.loft(rows, closed=False, c=c)
    return g


def grow_tree(rng, origin, direction, length, radius, depth, p, out, planar=False):
    """Recursive branching skeleton for the Skin modifier. out = (verts, edges, radii)."""
    verts, edges, radii = out
    if not verts:
        verts.append(tuple(origin))
        radii.append(radius)
    parent = len(verts) - 1 if p.get('_parent') is None else p['_parent']
    pos = Vector(verts[parent])
    d = Vector(direction).normalized()
    segs = p.get('segs', 2)
    for s in range(segs):
        j = Vector((rng.uniform(-1, 1), 0 if planar else rng.uniform(-1, 1), rng.uniform(-1, 1))) * p.get('jitter', 0.25)
        d = (d + j + Vector((0, 0, p.get('up', 0.15)))).normalized()
        pos = pos + d * (length / segs)
        verts.append(tuple(pos))
        radii.append(lerp(radius, radius * p.get('taper', 0.7), (s + 1) / segs))
        edges.append((parent, len(verts) - 1))
        parent = len(verts) - 1
    if depth <= 0:
        return
    kids = rng.choice(p.get('kids', (2, 2, 3)))
    for k in range(kids):
        spread = p.get('spread', 0.7) * rng.uniform(0.6, 1.3)
        if planar:
            sgn = (k - (kids - 1) / 2) / max((kids - 1) / 2, 0.5)
            ang = sgn * spread + rng.uniform(-0.15, 0.15)
            nd = Matrix.Rotation(ang, 3, 'Y') @ d
        else:
            axis = d.orthogonal().normalized()
            axis = Matrix.Rotation(2 * pi * (k + rng.random() * 0.6) / kids, 3, d) @ axis
            nd = Matrix.Rotation(spread, 3, axis) @ d
        q = dict(p)
        q['_parent'] = parent
        grow_tree(rng, pos, nd, length * p.get('shrink', 0.78) * rng.uniform(0.8, 1.15),
                  radius * p.get('taper', 0.7), depth - 1, q, out, planar)


def skin_tree(out, smooth=True, subsurf=0):
    verts, edges, radii = out
    g = Geo()
    g.v = list(verts)
    g.e = list(edges)
    g.c = [WHITE] * len(verts)
    return modify(g, [('SKIN', {'use_smooth_shade': smooth, 'branch_smoothing': 0.3})] + ([('SUBSURF', {'levels': subsurf})] if subsurf else []), skin_radii=radii)


_HEMI = None


def _hemi_dirs(n=20):
    global _HEMI
    if _HEMI is None:
        rng = random.Random(7)
        _HEMI = []
        for i in range(n):
            u = (i + rng.random()) / n
            v = rng.random()
            r = math.sqrt(u)
            th = 2 * pi * v
            _HEMI.append((r * cos(th), r * sin(th), math.sqrt(max(0.0, 1 - u))))
    return _HEMI


def bake_ao(me, strength=0.8, dist=None):
    """Ray-cast ambient occlusion per vertex, multiplied into the colour attribute."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
    diag = (hi - lo).length
    dist = dist or diag * 0.3
    eps = diag * 0.004
    dirs = _hemi_dirs()
    attr = me.color_attributes['Col']
    for v in bm.verts:
        n = v.normal
        if n.length < 0.5:
            continue
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * eps
        occ = 0.0
        for d in dirs:
            wd = t * d[0] + b * d[1] + n * d[2]
            hit = bvh.ray_cast(o, wd, dist)
            if hit[0] is not None:
                occ += 1.0 - hit[3] / dist
        ao = 1.0 - occ / len(dirs)
        k = lerp(1.0, ao, strength)
        c = attr.data[v.index].color
        attr.data[v.index].color = (c[0] * k, c[1] * k, c[2] * k, c[3])
    bm.free()


def finalize(geo, name, smooth_angle=55.0, ao=0.8, ao_dist=None, paint_n=None, meta=None):
    """Turn a Geo into a linked Blender object with normals, sharp edges, AO and colour."""
    me = geo.to_mesh(name)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lim = math.radians(smooth_angle)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < lim
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.update()
    if paint_n is not None:
        attr = me.color_attributes['Col']
        for v in me.vertices:
            attr.data[v.index].color = paint_n(v.co.copy(), v.normal.copy(), tuple(attr.data[v.index].color))
    if ao > 0:
        bake_ao(me, ao, ao_dist)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    lo, hi = geo.bounds()
    info = {'min': [round(x, 3) for x in lo], 'max': [round(x, 3) for x in hi],
            'tris': sum(len(p.vertices) - 2 for p in me.polygons)}
    if meta:
        info.update(meta)
    META[name] = info
    return ob


def rot(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def trans(x, y, z):
    return Matrix.Translation((x, y, z))


def scl(x, y=None, z=None):
    y = x if y is None else y
    z = x if z is None else z
    return Matrix.Diagonal((x, y, z, 1.0))
