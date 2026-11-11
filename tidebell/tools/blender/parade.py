"""Renders the "model parade" used in the promo: a camera trucks past the generated models as they turn.

Two passes are written, a cyan wireframe and the shaded models, so the film can wipe from one to the other.
Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/parade.py

Runs inside Blender's bundled Python (needs bpy): the documented exception to the project's `uv run` convention.
"""
import logging
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common  # noqa: E402
import creatures  # noqa: E402
import flora  # noqa: E402
import structures  # noqa: E402

logging.basicConfig(level=logging.INFO, format='%(message)s')
log = logging.getLogger('tidebell.parade')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'promo', 'parade'))
FRAMES = 195
FPS = 30
ORDER = ['fish_darter', 'fish_chromlet', 'coral_staghorn0', 'turtle', 'coral_fan0', 'fish_parrot', 'anemone', 'shark', 'sponge_tubes', 'manta', 'sub_hull',
         'wreck', 'tide_bell', 'jelly', 'rock_arch', 'angler', 'lantern_stalk', 'vent', 'moon_gate', 'whale_fall', 'whale']
SPACING = 3.5


def material(name, wire):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    if wire:
        bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
        bsdf.inputs['Emission Color'].default_value = (0.25, 0.95, 1.0, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.2
    else:
        attr = nt.nodes.new('ShaderNodeAttribute')
        attr.attribute_name = 'Col'
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
        mult = nt.nodes.new('ShaderNodeMath')
        mult.operation = 'MULTIPLY'
        mult.inputs[1].default_value = 3.0
        nt.links.new(attr.outputs['Alpha'], mult.inputs[0])
        nt.links.new(mult.outputs[0], bsdf.inputs['Emission Strength'])
        bsdf.inputs['Roughness'].default_value = 0.55
    return mat


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for mod in (creatures, flora, structures):
        mod.build_all()
    scene = bpy.context.scene
    keep = []
    for i, name in enumerate(ORDER):
        ob = bpy.data.objects[name]
        m = common.META[name]
        lo, hi = Vector(m['min']), Vector(m['max'])
        size = max(hi - lo)
        s = 3.3 / size
        cen = (lo + hi) / 2
        # Re-centre the mesh so each model turns about its own middle.
        for v in ob.data.vertices:
            v.co = (v.co - cen) * s
        ob.location = (i * SPACING, 0, 0)
        keep.append(ob)
    for ob in list(scene.objects):
        if ob not in keep:
            bpy.data.objects.remove(ob)

    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    scene.world = world
    bg = world.node_tree.nodes['Background']
    for name, energy, rot in (('key', 3.4, (48, 0, 30)), ('rim', 2.2, (120, 0, 200))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.data.color = (1.0, 0.95, 0.85) if name == 'key' else (0.4, 0.8, 1.0)
        light.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 34
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 93
    scene.view_settings.view_transform = 'Standard'

    shaded = material('shaded', False)
    wire = material('wire', True)
    span = (len(ORDER) - 1) * SPACING
    for mode in ('shade', 'wire'):
        os.makedirs(os.path.join(OUT, mode), exist_ok=True)
        bg.inputs[0].default_value = (0.004, 0.016, 0.026, 1) if mode == 'shade' else (0.002, 0.008, 0.013, 1)
        bg.inputs[1].default_value = 1.0 if mode == 'shade' else 1.0
        for ob in keep:
            ob.data.materials.clear()
            ob.data.materials.append(shaded if mode == 'shade' else wire)
            if mode == 'wire':
                mod = ob.modifiers.new('wf', 'WIREFRAME')
                mod.thickness = 0.014
                mod.use_replace = True
        for f in range(FRAMES):
            u = f / (FRAMES - 1)
            e = u * u * (3 - 2 * u) * 0.35 + u * 0.65
            x = -1.2 + e * (span + 2.4)
            cam.location = (x - 1.8, -6.6, 1.3)
            cam.rotation_euler = (Vector((x + 0.6, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            for i, ob in enumerate(keep):
                ob.rotation_euler = (0, 0, 0.5 + i * 0.7 + f / FPS * 0.7)
                ob.location.z = 0.12 * math.sin(f / FPS * 1.3 + i)
            scene.render.filepath = os.path.join(OUT, mode, f'{f:04d}.jpg')
            bpy.ops.render.render(write_still=True)
        log.info('%s pass done', mode)


main()
