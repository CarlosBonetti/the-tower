---
{
  "type": "decision",
  "name": "Workers as KayKit characters on one rig, posed by clips on the sim clock",
  "summary": "Tower 3D's workers are KayKit Adventurers (CC0) dressed from hashed parts, heads, helms, capes, gear, atlases and skin and hair colours, or the bot, whose rigid parts are skinned to the same Rig_Medium bones. One shared set of KayKit clips (plus a typing clip derived at load) poses every worker through a mixer of its own, set from sim time each frame, so stepped frames repeat. The bean and the puff retired. New parts are modelled by hand in a Blender kit (parts/parts.blend) and join a look's slots by their names, with no code.",
  "in": "web-tower",
  "status": "accepted",
  "date": "2026-10-11",
  "reviewed": "2026-10-11",
  "refs": [
    "hub/scripts/tower3d-characters.ts",
    "hub/renderers/tower3d/kaykit/Characters/README.md",
    "hub/renderers/tower3d/src/rig.ts#loadCast",
    "hub/renderers/tower3d/src/rig.ts#pose",
    "hub/renderers/tower3d/src/rig.ts#wearSkinned",
    "hub/renderers/tower3d/src/rig.ts#wearModel",
    "hub/renderers/tower3d/src/wardrobe.ts#lookOf",
    "hub/renderers/tower3d/src/wardrobe.ts#Wardrobe",
    "hub/renderers/tower3d/src/wardrobe.ts#fitFrom",
    "hub/renderers/tower3d/src/wardrobe.ts#FIT_PRECEDENCE",
    "hub/renderers/tower3d/src/wardrobe.ts#formatWardrobe",
    "hub/renderers/tower3d/src/catalogue.ts#catalogueOf",
    "hub/renderers/tower3d/src/avatar.ts#fitted",
    "hub/renderers/tower3d/src/closet.ts#WARDROBE",
    "hub/renderers/tower3d/wardrobe.json",
    "hub/test/wardrobe.test.ts",
    "hub/renderers/tower3d/src/avatar.ts#avatar",
    "hub/renderers/tower3d/src/avatar.ts#seatedAt",
    "hub/renderers/tower3d/src/rig.ts#seatOf",
    "hub/renderers/tower3d/src/contract.ts#CLIPS",
    "hub/renderers/tower3d/src/contract.ts#ADVENTURER_PARTS",
    "hub/renderers/tower3d/models/bot.py",
    "hub/renderers/tower3d/src/desk.ts#poseDesk",
    "hub/renderers/tower3d/src/desk.ts#poseRigs",
    "hub/renderers/tower3d/src/life.ts#walkPose",
    "hub/renderers/tower3d/src/party.ts#poseGuest",
    "hub/test/models.test.ts",
    "hub/renderers/tower3d/src/contract.ts#SLOTS",
    "hub/renderers/tower3d/parts/README.md",
    "hub/renderers/tower3d/parts/build.py",
    "hub/renderers/tower3d/parts/export.py",
    "hub/scripts/tower3d-parts.ts",
    "hub/renderers/tower3d/src/hashed.ts#rendezvous",
    "hub/test/rendezvous.test.ts"
  ],
  "links": [
    { "to": "office-kaykit", "verb": "uses", "carries": "the vendored KayKit folder, its characters beside the office's Bits" },
    { "to": "tower3d-door", "verb": "uses", "carries": "the stepped sim clock every pose is read from" }
  ]
}
---
**Problem.** Workers were the bean, the puff and the bot: rigid parts moved by code (pivots `body`, `arm_L`,
`arm_R`), seven to ten draw calls each, three looks and a colour. They could not sit, type, walk or dance the way
the KayKit office around them looked, and every new motion was hand-written trigonometry.

**Why.** NEMO-27's research (`.regibyte/research/2026-10-11-characters/`) found KayKit's `Rig_Medium` the best
fit: the office's own artist and atlas technique, a skeleton with hand slots, and 150+ CC0 clips. RegiByte chose
the KayKit Adventurers as the base and liked the fantasy bits showing up at random; the bot stays as a species.

**How.**
- Assets. [`tower3d-characters.ts`](ref:hub/scripts/tower3d-characters.ts) packs the packs' own files into
  `renderers/tower3d/kaykit/Characters`: `adventurers.glb` (1.1 MB), every part the contract names from the five
  Adventurers files on one skeleton with their four atlases and no clips; `rig_medium.glb` (0.45 MB), the contract's
  [`CLIPS`](ref:hub/renderers/tower3d/src/contract.ts#CLIPS) on Rig_Medium's bones. It checks that every adventurer
  is skinned to the same joints in the same bind pose before moving a part onto the first one's skeleton.
- One rig. [`loadCast`](ref:hub/renderers/tower3d/src/rig.ts#loadCast) parses both, derives `Type` (both forearms on
  the keyboard tapping, aimed from the seated clip's first frame) and cuts every clip to its arms (`:arms`) or the
  rest (`:rest`), so an upper-body clip plays over a seated or idle one. A worker is a copy of the bones and a mixer;
  [`pose`](ref:hub/renderers/tower3d/src/rig.ts#pose) sets it from layers, each a clip at a time and weight, every
  frame: a pose is a function of sim time and the card. The one thing a rig carries is the pose before: a pose of
  other clips fades in over it in 0.3 s of sim time (sitting down after walking in, turning from typing to waving,
  a new dance move), eased like a desk's turn, so `?stepped` still repeats. Bones are posed only on the levels
  drawn ([[tower3d-levels]]); everyone still moves where it goes on every level.
- Looks are data: the wardrobe, `renderers/tower3d/wardrobe.json`, one document checked by a zod schema
  ([`Wardrobe`](ref:hub/renderers/tower3d/src/wardrobe.ts#Wardrobe)) as the bundle loads it
  ([`WARDROBE`](ref:hub/renderers/tower3d/src/closet.ts#WARDROBE)), over a catalogue of parts derived from the files at load
  and never stored ([`catalogueOf`](ref:hub/renderers/tower3d/src/catalogue.ts#catalogueOf): the pack's, the made
  ones and `models/wear.py`'s hats and glasses, each with its slot, its attachment, skinned or rigid on a bone at its made
  placement, and its atlas; a wear piece's made placement is the top or the face of the head parts are made on, the
  Knight's, at the size that makes its beanie as wide as that head). Three layers: **fits** (a move, turn and scale over a rigid part's made placement, none yet), **outfits** (named looks: body, paint, colours, build and a
  part or bare per slot, anything left out hashed), and the **mix**: the bot's share and what it wears, the outfits'
  share, the bodies, colours and build range, and a rule per slot (its chance, a `group` of exclusive slots sharing one
  roll, a `seed` it hashes under, its pool and exclusions, `unless`: bare when the look wears one of these, as the hooded
  head keeps hats and helms off). [`lookOf`](ref:hub/renderers/tower3d/src/wardrobe.ts#lookOf) hashes a session id
  into it: a bot one time in five; else maybe an outfit, the rest from the mix. The roof's bartender and DJ are outfits
  kept out of the share, dressed by name. One function, `avatar(models, look, wardrobe)`, dresses every look, and keeps
  each rigid part it hangs by name with its made placement (`worn`), so the dresser re-fits a part live. Saved through
  [`formatWardrobe`](ref:hub/renderers/tower3d/src/wardrobe.ts#formatWardrobe) (keys in a fixed order), the file diffs
  by what changed. The skin and hair colours are multiplied by a shader into the atlas's first two swatches.
- Draw calls. The skinned parts of one atlas merge into one mesh per worker (geometry cached per combination);
  the bot's rigid parts (`models/bot.py`, built in the rig's rest pose, a pivot per bone) are skinned to their bones
  at load, one mesh per material ([`wearModel`](ref:hub/renderers/tower3d/src/rig.ts#wearModel)). Each worker
  carries a glowing status light over its head.
- Parts made by hand ([`parts/README.md`](ref:hub/renderers/tower3d/parts/README.md)). `parts/parts.blend`, built
  once by [`build.py`](ref:hub/renderers/tower3d/parts/build.py) from `adventurers.glb`, holds the rig at rest, the
  Knight on a stage and four other bodies in a line-up as collection instances of their body and of `Wardrobe`, a
  collection per slot, so a part shows on five bodies at once and follows the rig's pose. The file is committed: it is
  the source of the parts made in it. `npm run tower3d:parts` exports `Wardrobe`
  ([`export.py`](ref:hub/renderers/tower3d/parts/export.py)) and
  [`tower3d-parts.ts`](ref:hub/scripts/tower3d-parts.ts) writes `parts/parts.glb` in `adventurers.glb`'s terms
  (its skeleton and skin, joints remapped by name, rigid parts re-hung on its bones, the atlas named by the
  material), refusing with the fix what the runtime could not wear. A part's name starts with its slot
  ([`SLOTS`](ref:hub/renderers/tower3d/src/contract.ts#SLOTS): `Head`, `Helm`, `Face`, `Cape`, `Gear`, `Prop`,
  `Outfit`); `loadCast` reads `parts.glb` beside the pack and every slot's pool is the pack's parts then the made
  ones, so a part reaches looks with no code. Whether a worker wears something in a slot is its own roll; which
part is the rendezvous of the pool ([`rendezvous`](ref:hub/renderers/tower3d/src/hashed.ts#rendezvous): the part
scoring highest for the worker), so a part added to a slot of N takes about one in N+1 of its wearers and the rest
keep theirs, whatever the order of the GLB's names. Bots wear only the hats and glasses of `models/wear.py`, at their model's own anchors. Examples to copy: round glasses, a headset, a coffee mug, a vest cut from the Knight's body keeping its
  weights.
- Poses: at the desk, `Type` while working, `Waving:arms` while asking (turned round), `Cheering:arms` while holding
  up a showing, the seated clip leaned back watching or slumped idle or failed
  ([`poseDesk`](ref:hub/renderers/tower3d/src/desk.ts#poseDesk)); `Walking_A` walking in and out; on the roof,
  dances changing every two bars on the music's beat, sitting at the bar with a beer, mingling with `Interact`.
- Seats are measured, not tuned. The seated clip puts the hips 0.4 rig units behind the rig's root, so a body is
  placed by what it sits on: [`seatOf`](ref:hub/renderers/tower3d/src/rig.ts#seatOf) skins each part's vertices
  into the clip's first frame and keeps the lowest point of what bears on the seat (hips and thighs) and the back of
  what leans on a back rest (hips, spine, chest); [`seatedAt`](ref:hub/renderers/tower3d/src/avatar.ts#seatedAt)
  puts that underside on the seat's top and that back against the back rest's face, or the hips over a stool's
  middle. Every body, bot or outfit sits by its own mesh. The office chair's seat and back are a `swivel` pivot
  (`models/desk.py`) turned with the worker, about the post, so a worker turned round to you stays in its chair.

**Alternatives considered.**
- *Kenney Mini Characters*: lighter, but a seven-bone rig with no elbows or knees.
- *Quaternius' animation library*: a different skeleton; its dance and talk loops are a later, retargeted slice.
- *Keeping the bot code-posed beside skinned adventurers*: two pose systems in every place a worker is drawn.
- *Typing as a per-frame code layer* (the prototype): world-space aims every frame per worker; a derived clip costs
  nothing per frame.
- *Unmerged parts*: an adventurer was six skinned meshes; merged, the busy board draws no more calls than before.
- *A far LOD (baked vertex animation)*: not needed at today's sizes (Impact).
- *Made parts merged into `adventurers.glb`*: its packer reads the packs' own files, which live outside the repo;
  a file of their own is rewritten whole on every export and never touches the pack's.
- *The slot in glTF extras, or in a list in code*: the name is what the Outliner, the contract test and the runtime
  all read; a list would have to be edited for every part.
- *A rig per body in the `.blend`*: a part would need copying onto each; instances of `Wardrobe` show it on all.
- *A `none` candidate in each slot's rendezvous* (TURING-72's first suggestion): at equal weight the bare share
  shrinks with every part added (1 in N+1); weighted to hold it, its weight changes with N and moves workers. A roll
  of its own for wearing keeps both stable.
- *Fitting the old wear to each worn head's bounding box* (the bean's rule): beards and hair stretch the box, so
  pieces sank or floated per head, and it assumed a 0.36 head where the pieces fit a 0.56 one, so on KayKit heads
  everything worn was drawn nearly twice its size.
- *Picking by index into the pool* (the first cut): every part added re-dressed most of a slot's wearers.
- *Blender's export as the runtime's file*: its skin orders joints its own way; normalizing keeps one skeleton and
  lets skinned made parts merge with the pack's into one mesh.

**Impact.** On `?board=busy&seed=1` (stepped, lit): draw calls 578 → 574 on a floor, 1272 → 1212 in the overview,
468 → 466 on the roof; frame time on a floor 3.5 → 4.4 ms (medians of three, the same afternoon), of which posing
only the levels drawn won back 0.4 ms. A reviewer sits 1.2 m beside its author and a fork's twin 1.05 m, clear of
the wider bodies; seated heads top about 1.75 m, over the 1.6 m eye, so from behind a worker what lies in front of it on
the desk is aimed past its head, not through it. Every worker looks different from before, so `tool:frames` shows every stage with a worker
changed. `npm test` checks both GLBs hold the contract's parts, bones and clips, and that `parts.glb`'s parts are named
after a slot, painted in an atlas and hung on the clips' bones or the pack's skin. The repo grew by 1.1 MB (1.5 MB of
characters in, the bean and the puff out), and the kit by 1.2 MB (`parts.blend` 1 MB, `parts.glb` 0.13 MB with the
examples).
