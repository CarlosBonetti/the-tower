"""
Exports every mesh under parts.blend's `Wardrobe` collection, on `Rig`, to a glTF that scripts/tower3d-parts.ts turns into
parts.glb (`npm run tower3d:parts` runs both).

  blender -b parts.blend -P export.py -- <out.glb>
"""
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
for stand in list(bpy.data.collections["Lineup"].all_objects):
    bpy.data.objects.remove(stand)
rig = bpy.data.objects["Rig"]
parts = [o for o in bpy.data.collections["Wardrobe"].all_objects if o.type == "MESH"]
for obj in bpy.context.view_layer.objects:
    obj.select_set(False)
for obj in [rig, *parts]:
    obj.hide_viewport = False
    obj.hide_set(False)
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_animations=False,
    export_image_format="NONE",
    export_extras=False,
    export_cameras=False,
    export_lights=False,
)
print(f"exported {len(parts)} parts: {', '.join(sorted(o.name for o in parts))}")
