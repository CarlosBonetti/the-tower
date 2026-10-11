"""
Renders parts.blend as it stands: the stage and the line-up from the front, and the stage's head up close.

  blender -b parts.blend -P shot.py -- <lineup.jpg> [<close.jpg>]
"""
import math
import sys

import bpy
from mathutils import Vector


def camera(target, distance, yaw, pitch, lens):
    cam = bpy.data.objects.new("shot", bpy.data.cameras.new("shot"))
    cam.data.lens = lens
    bpy.context.scene.collection.objects.link(cam)
    y, p = math.radians(yaw), math.radians(pitch)
    cam.location = Vector(target) + distance * Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


def light():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("shot")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.09, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.6
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), math.radians(-15), math.radians(-25))
    scene.collection.objects.link(sun)
    scene.view_settings.view_transform = "Standard"


def render(path, size):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    bpy.ops.render.render(write_still=True)


args = sys.argv[sys.argv.index("--") + 1 :]
light()
camera((0, 0, 1.05), 16.5, 0, 8, 50)
render(args[0], (1500, 640))
if len(args) > 1:
    camera((0, 0, 1.55), 4.2, 30, 10, 50)
    render(args[1], (760, 640))
