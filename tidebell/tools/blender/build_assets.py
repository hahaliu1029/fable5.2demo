"""Builds every Tidebell model procedurally and exports assets/tidebell.glb + assets/meta.json.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/build_assets.py [-- --preview]

This script runs inside Blender's bundled Python (it needs bpy), so it is the documented exception to the
project's `uv run` convention.
"""
import json
import logging
import math
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import creatures  # noqa: E402
import flora  # noqa: E402
import structures  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('tidebell.assets')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'assets'))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'tidebell.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False,
                              export_normals=True, export_texcoords=False, export_materials='NONE',
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_animations=False)
    with open(os.path.join(OUT, 'meta.json'), 'w') as fh:
        json.dump(common.META, fh, indent=1, sort_keys=True)
    log.info('exported %s (%.2f MB), %d assets, %d tris', path, os.path.getsize(path) / 1e6, len(common.META),
             sum(m['tris'] for m in common.META.values()))


def preview(out_dir):
    """Render contact sheets so the shapes and colours can be checked by eye."""
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
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.25, 0.32, 0.38, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 800
    scene.render.image_settings.file_format = 'JPEG'
    objs = [o for o in scene.objects if o.type == 'MESH']
    for o in objs:
        o.data.materials.append(mat)
        o.hide_render = True
    for o in objs:
        m = common.META[o.name]
        lo, hi = m['min'], m['max']
        cen = [(lo[i] + hi[i]) / 2 for i in range(3)]
        size = max(hi[i] - lo[i] for i in range(3))
        o.hide_render = False
        d = size * 3
        cam.location = (cen[0] + d * 0.55, cen[1] - d * 0.75, cen[2] + d * 0.4)
        direction = [cen[i] - cam.location[i] for i in range(3)]
        from mathutils import Vector
        cam.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
        cam.data.ortho_scale = size * 1.5
        cam.data.clip_end = d * 4 + 10
        scene.render.filepath = os.path.join(out_dir, o.name + '.jpg')
        bpy.ops.render.render(write_still=True)
        o.hide_render = True


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = [a for a in argv if not a.startswith('--')]
    reset()
    t0 = time.time()
    for mod in (creatures, flora, structures):
        if only and mod.__name__ not in only:
            continue
        mod.build_all()
        log.info('%s done at %.1fs', mod.__name__, time.time() - t0)
    for name, m in sorted(common.META.items()):
        log.info('  %-18s %6d tris', name, m['tris'])
    if not only:
        export()
    if '--preview' in argv:
        preview(os.path.join(OUT, '..', 'tools', 'blender', 'preview'))


main()
