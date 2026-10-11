"""
A worker: a robot with a screen for a face and a bulb on an antenna, built on KayKit's Rig_Medium so it plays the
same clips as the adventurers. It stands in the rig's rest pose (a T-pose, 2.2 units tall, facing +z), each part under
a pivot named after the bone it rides, at that bone's rest position; the renderer hangs each pivot on its bone.
Contract in src/contract.ts.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from kit import box, cylinder, empty, export, mat, out_path, preview, reset, sphere, torus

reset()
hue = mat("hue_own", "#7ab8ff")
shell = mat("botshell", "#d5dbe6")
joint = mat("gear", "#20242e")
screen = mat("botscreen", "#0b1020")
eyes = mat("eye_glow", "#7ff6ff")
bulb = mat("bulb_glow_own", "#ffffff")

hips = empty("hips", (0, 0.406, 0))
box("pelvis", (0.46, 0.2, 0.34), (0, 0.46, 0), joint, hips, bevel=0.05)

chest = empty("chest", (0, 0.973, 0))
box("torso", (0.74, 0.6, 0.52), (0, 0.86, 0), hue, chest, bevel=0.1, segments=4)
box("belly", (0.38, 0.2, 0.03), (0, 0.84, 0.26), shell, chest, bevel=0.015)
cylinder("neck", 0.1, 0.14, (0, 1.2, 0), joint, chest)

head = empty("head", (0, 1.241, 0))
box("skull", (0.92, 0.66, 0.72), (0, 1.62, 0), shell, head, bevel=0.12, segments=4)
box("screen", (0.7, 0.42, 0.03), (0, 1.62, 0.36), screen, head, bevel=0.05)
for side in (-1, 1):
    sphere(f"eye_{side}", 0.07, (side * 0.16, 1.66, 0.38), eyes, head, scale=(1, 1.3, 0.4))
    cylinder(f"bolt_{side}", 0.08, 0.07, (side * 0.48, 1.62, 0), joint, head, axis="x")
torus("mouth", 0.07, 0.013, (0, 1.56, 0.383), eyes, head, arc=math.pi, rotation=(0, 0, math.pi))
cylinder("antenna", 0.02, 0.3, (0, 2.08, 0), joint, head, vertices=8)
sphere("bulb", 0.09, (0, 2.26, 0), bulb, head)
empty("hat", (0, 0.72, 0), head).scale = (1.85, 1.85, 1.85)
empty("face", (0, 0.4, 0.4), head).scale = (1.5, 1.5, 1.5)

for s, side in (("l", 1), ("r", -1)):
    upper = empty(f"upperarm{s}", (side * 0.212, 1.107, 0))
    sphere(f"shoulder_{s}", 0.1, (side * 0.23, 1.107, 0), hue, upper)
    cylinder(f"arm_{s}", 0.065, 0.24, (side * 0.34, 1.107, 0), joint, upper, axis="x", vertices=12)
    lower = empty(f"lowerarm{s}", (side * 0.454, 1.107, -0.014))
    cylinder(f"forearm_{s}", 0.065, 0.26, (side * 0.58, 1.107, 0), joint, lower, axis="x", vertices=12)
    sphere(f"hand_{s}", 0.1, (side * 0.76, 1.107, 0), hue, lower, scale=(1.1, 0.8, 1))

    thigh = empty(f"upperleg{s}", (side * 0.171, 0.519, 0))
    cylinder(f"thigh_{s}", 0.08, 0.24, (side * 0.171, 0.4, 0), joint, thigh, vertices=12)
    shin = empty(f"lowerleg{s}", (side * 0.171, 0.292, 0.008))
    cylinder(f"shin_{s}", 0.08, 0.16, (side * 0.171, 0.22, 0), joint, shin, vertices=12)
    foot = empty(f"foot{s}", (side * 0.171, 0.145, -0.019))
    box(f"boot_{s}", (0.22, 0.12, 0.32), (side * 0.171, 0.06, 0.05), hue, foot, bevel=0.04)

path, shot = out_path()
export(path)
if shot:
    preview(shot, target=(0, 1.1, 0), distance=4.5, yaw=30, pitch=12)
