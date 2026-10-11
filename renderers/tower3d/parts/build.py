"""
Builds parts.blend, where new parts for Tower 3D's workers are modelled by hand (README.md beside it): KayKit's
Rig_Medium in its rest pose, the Knight on the stage at the origin, the other adventurers in a line-up either side, and
a collection per slot under `Wardrobe`, every part in it drawn on every body at once.

  blender -b --factory-startup -P build.py -- parts.blend

Run once: the file it writes is where the parts are made, so it refuses to write over one.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "models"))
from kit import cylinder, sphere, torus

ADVENTURERS_GLB = os.path.join(HERE, "..", "kaykit", "Characters", "adventurers.glb")
"""The slots, as `SLOTS` in src/contract.ts: a part's name starts with its slot and `_`."""
SLOTS = ("Head", "Helm", "Hat", "Face", "Cape", "Gear", "Prop", "Outfit")
BODY_PARTS = ("Body", "ArmLeft", "ArmRight", "LegLeft", "LegRight")
"""Who stands where along x: the stage (real objects, at the origin) and the line-up (instances)."""
LINEUP = {"Mage": -4.4, "Rogue": -2.2, "Rogue Hooded": 2.2, "Barbarian": 4.4}

NOTE = """\
TOWER 3D PARTS  (the full guide: renderers/tower3d/parts/README.md)

The Knight on the stage is the real thing: model on it. The four beside it are
instances of their body and of the Wardrobe collection: every part you make shows
on all five at once. Pose `Rig` (Pose Mode) and all five follow.

A part is one mesh object in a slot collection under Wardrobe, named after its
slot: Face_RoundGlasses, Helm_Headset, Gear_CoffeeMug, Outfit_Vest.
  Head    a whole head, skinned (keep skin in swatch 0,0 and hair in 1,0)
  Helm    on the head bone, worn instead of a hat
  Face    on the head bone: glasses, masks
  Cape    on the chest bone
  Gear    held: on the bone handslot.r
  Prop    worn on any bone besides the above
  Outfit  skinned over the body, weighted like it

Paint: one material, an adventurer's atlas (knight_texture, ...). The atlas is
8 x 4 swatches; a face takes the colour of the swatch its UVs sit on. In the UV
Editor: select faces, click a swatch to put the 2D cursor there, UV > Snap >
Selected to Cursor. Swatch 0,0 (top left) is skin and 1,0 hair: workers tint those.

Rigid parts: Object > Parent > Bone (select the part, then the Rig in Pose
Mode with the bone active, Ctrl+P > Bone).
Skinned parts: an Armature modifier on `Rig` and vertex groups named as its
deform bones; Data Transfer from a body copies its weights.

Eye icon: hides on the stage only. Screen icon (Disable in Viewports): hides on
every body. Neither stops a part from exporting: every mesh in Wardrobe exports.

Export: npm run tower3d:parts   then npm test, and reload Tower 3D.
"""


def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def move(obj, to):
    for c in obj.users_collection:
        c.objects.unlink(obj)
    to.objects.link(obj)


def cell_uv(cell):
    """Where on the atlas a swatch's flat tone is, in Blender's UVs (v up): a third down its left side."""
    cx, cy = cell
    return Vector(((cx + 0.4) / 8, 1 - (cy + 0.35) / 4))


def paint(obj, cell, faces=None):
    """Puts the UVs of `faces` (indices, all when None) on swatch `cell` (column, row from the top)."""
    uv = obj.data.uv_layers.active.data
    for poly in obj.data.polygons:
        if faces is None or poly.index in faces:
            for li in poly.loop_indices:
                uv[li].uv = cell_uv(cell)


def joined(name, pieces):
    """One mesh object of `pieces`, its origin at its middle."""
    bpy.ops.object.select_all(action="DESELECT")
    for p in pieces:
        p.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    if len(pieces) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = obj.data.name = name
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return obj


def into(slot):
    """Makes the slot's collection the one new objects land in."""
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children["Wardrobe"].children[slot]


def on_bone(obj, rig, bone):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world
    return obj


def bounds(obj):
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return Vector([min(v[i] for v in vs) for i in range(3)]), Vector([max(v[i] for v in vs) for i in range(3)])


def glasses(atlas, rig, head):
    """Round glasses on the head bone, in front of the Knight's eyes."""
    lo, hi = bounds(head)
    eyes = lo.z + (hi.z - lo.z) * 0.42
    front = -lo.y + 0.02
    pieces = []
    for side in (-1, 1):
        pieces.append(torus(f"rim_{side}", 0.11, 0.018, (side * 0.21, eyes, front), atlas))
        pieces.append(cylinder(f"arm_{side}", 0.014, 0.42, (side * 0.33, eyes + 0.02, front - 0.21), atlas, axis="z", vertices=8))
    pieces.append(cylinder("bridge", 0.014, 0.2, (0, eyes + 0.03, front), atlas, axis="x", vertices=8))
    obj = joined("Face_RoundGlasses", pieces)
    paint(obj, (2, 0))
    return on_bone(obj, rig, "head")


def headset(atlas, rig, head):
    """A headset on the head bone: a band over the crown, cups on the ears, a mic before the mouth."""
    lo, hi = bounds(head)
    ear = (lo.z + hi.z) / 2 - 0.05
    half = hi.x + 0.02
    pieces = [torus("band", half, 0.035, (0, ear, 0), atlas, arc=math.pi)]
    pieces[0].scale = (1, 1, (hi.z - ear + 0.03) / half)
    for side in (-1, 1):
        pieces.append(cylinder(f"cup_{side}", 0.17, 0.12, (side * (half + 0.02), ear, 0), atlas, axis="x"))
    pieces.append(cylinder("boom", 0.02, 0.5, (-(half + 0.02), ear - 0.12, -lo.y * 0.55), atlas, axis="z", vertices=8))
    pieces.append(sphere("mic", 0.06, (-(half - 0.02), ear - 0.14, -lo.y * 1.05), atlas))
    bpy.ops.object.select_all(action="DESELECT")
    pieces[0].select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj = joined("Helm_Headset", pieces)
    paint(obj, (4, 0))
    mic = {p.index for p in obj.data.polygons if (obj.matrix_world @ p.center).y < lo.y * 0.95}
    cups = {p.index for p in obj.data.polygons if abs((obj.matrix_world @ p.center).x) > half - 0.06 and p.index not in mic}
    paint(obj, (2, 0), cups)
    paint(obj, (0, 1), mic)
    return on_bone(obj, rig, "head")


def mug(atlas, rig):
    """A coffee mug held as the pack's Mug is: upright in the rest pose, beside the right hand slot, its handle in the fist."""
    slot = rig.matrix_world @ rig.data.bones["handslot.r"].head_local
    x, y, z = slot.x - 0.23, slot.z, -slot.y
    pieces = [
        cylinder("cup", 0.17, 0.36, (x, y, z), atlas),
        torus("handle", 0.09, 0.028, (x + 0.19, y, z), atlas),
        cylinder("coffee", 0.15, 0.01, (x, y + 0.17, z), atlas),
    ]
    obj = joined("Gear_CoffeeMug", pieces)
    paint(obj, (1, 1))
    coffee = {p.index for p in obj.data.polygons if (obj.matrix_world @ p.center).z > y + 0.174 and p.normal.z > 0.9}
    paint(obj, (5, 0), coffee)
    return on_bone(obj, rig, "handslot.r")


def vest(body, into):
    """A vest made from the Knight's body: its faces above the belt, pushed out, keeping the body's weights."""
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = obj.data.name = "Outfit_Vest"
    into.objects.link(obj)
    lo, hi = bounds(body)
    belt = lo.z + (hi.z - lo.z) * 0.33
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if min(v.co.z for v in f.verts) < belt], context="FACES")
    for v in bm.verts:
        v.co += v.normal * 0.035
    bm.to_mesh(obj.data)
    bm.free()
    paint(obj, (5, 1))
    return obj


def lineup(bodies, wardrobe, into):
    for name, x in LINEUP.items():
        stand = bpy.data.objects.new(name, None)
        stand.instance_type = "COLLECTION"
        stand.instance_collection = bodies[name]
        stand.location = (x, 0, 0)
        into.objects.link(stand)
        worn = bpy.data.objects.new(f"{name} wears", None)
        worn.instance_type = "COLLECTION"
        worn.instance_collection = wardrobe
        worn.parent = stand
        into.objects.link(worn)


def layout(note):
    """Opens the file on the line-up in textured solid shading, the note in the bottom editor."""
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.shading.type = "SOLID"
                space.shading.color_type = "TEXTURE"
                r3d = space.region_3d
                r3d.view_location = (0, 0, 1.1)
                r3d.view_distance = 12
                r3d.view_rotation = (Vector((0, -1, 0.25)).to_track_quat("Z", "Y"))
                r3d.view_perspective = "PERSP"
            elif area.type == "OUTLINER":
                area.spaces.active.show_restrict_column_viewport = True
            elif area.type == "DOPESHEET_EDITOR" and screen.name == "Layout":
                area.type = "TEXT_EDITOR"
                area.spaces.active.text = note


def build(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=ADVENTURERS_GLB, bone_heuristic="BLENDER")
    objects = {o.name: o for o in bpy.data.objects}
    rig = objects["Rig"]
    rig.data.display_type = "STICK"
    atlas = bpy.data.materials["knight_texture"]

    move(rig, collection("Rig"))
    stage = collection("Stage")
    for part in (*(f"Knight_{p}" for p in BODY_PARTS), "Knight_Head"):
        move(objects[part], stage)
    wardrobe = collection("Wardrobe")
    slots = {s: collection(s, wardrobe) for s in SLOTS}
    stands = collection("Lineup")
    hidden = collection("Bodies")
    bodies = {name: collection(f"Body {name}", hidden) for name in LINEUP}
    for name in LINEUP:
        adventurer = name.split()[0]
        head = "Rogue_Head_Hooded" if name == "Rogue Hooded" else f"{adventurer}_Head"
        for part in (*(f"{adventurer}_{p}" for p in BODY_PARTS), head):
            obj = objects[part]
            if obj.users_collection and obj.users_collection[0].name.startswith("Body "):
                obj = obj.copy()
                bodies[name].objects.link(obj)
            else:
                move(obj, bodies[name])
    pack = collection("Pack")
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.users_collection and obj.users_collection[0] == bpy.context.scene.collection:
            move(obj, pack)
    bpy.data.collections["glTF_not_exported"].name = "Bone shapes"

    bpy.context.view_layer.update()
    head = objects["Knight_Head"]
    into("Face")
    glasses(atlas, rig, head)
    into("Helm")
    headset(atlas, rig, head)
    into("Gear")
    mug(atlas, rig)
    vest(objects["Knight_Body"], slots["Outfit"])
    lineup(bodies, wardrobe, stands)

    for name in ("Bodies", "Pack", "Bone shapes"):
        bpy.context.view_layer.layer_collection.children[name].exclude = True
    note = bpy.data.texts.new("README")
    note.write(NOTE)
    layout(note)
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)


path = sys.argv[sys.argv.index("--") + 1]
if os.path.exists(path):
    raise SystemExit(f"{path} exists: it holds the parts made in it. Move it away to build a fresh one.")
build(path)
