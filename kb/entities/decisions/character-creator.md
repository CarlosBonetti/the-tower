---
{
  "type": "decision",
  "name": "The dresser: workers dressed, posed and fitted by hand, saved to the wardrobe",
  "summary": "A Tower 3D page beside the lab (dresser.html) puts one worker on a stand, dressed by the wardrobe through the same avatar path as Tower 3D, to pick its parts and colours from the catalogue, pose it as Tower 3D does (the office chair included) and fit its rigid pieces with a gizmo, under every look or a part worn with them, every head lined up at once. It edits a copy of the wardrobe; tool:dresser serve saves it to renderers/tower3d/wardrobe.json, and tool:dresser shot renders a look headless through the same page for agents.",
  "in": "web-tower",
  "status": "accepted",
  "date": "2026-10-11",
  "reviewed": "2026-10-11",
  "refs": [
    "hub/renderers/tower3d/dresser.html",
    "hub/renderers/tower3d/src/dresser.ts",
    "hub/renderers/tower3d/src/dresser.ts#poseAt",
    "hub/renderers/tower3d/src/dresser.ts#fitOfObject",
    "hub/renderers/tower3d/src/dresser.ts#restage",
    "hub/renderers/tower3d/src/dresser.ts#outfitOf",
    "hub/renderers/tower3d/src/dresser.ts#save",
    "hub/renderers/tower3d/src/chair.ts#CHAIR",
    "hub/scripts/dresser.ts",
    "hub/scripts/dresser.ts#saveWardrobe",
    "hub/renderers/tower3d/src/avatar.ts#fitted",
    "hub/renderers/tower3d/src/wardrobe.ts#fitFrom",
    "hub/renderers/tower3d/src/wardrobe.ts#formatWardrobe",
    "hub/package.json"
  ],
  "links": [
    { "to": "kaykit-workers", "verb": "uses", "carries": "the wardrobe, its catalogue and the one avatar path, read and written by hand" }
  ]
}
---
**Problem.** Worn pieces were misplaced (glasses far too big on some heads, the bartender's cap too large, hats
riding high on bald heads), and every fix was brute force: change a number in code or a script, rebuild, walk to
the desk, look. RegiByte asked for the components to be data, "with a UI to move components around in a
composition, swap outfit and body parts and change the scale of items".

**Why.** Once the wardrobe made looks, outfits and fits data ([[kaykit-workers]]), what was missing was a surface
to edit that data by eye, and the same surface for agents, so a fit is judged from a picture rather than guessed.

**How.**
- One page in Tower 3D's bundle, beside the lab: [`dresser.ts`](ref:hub/renderers/tower3d/src/dresser.ts) and
  [`dresser.html`](ref:hub/renderers/tower3d/dresser.html), built into `out/` by `npm run tower3d`. It dresses with
  `avatar(models, look, wardrobe)`, so what it shows is what Tower 3D draws. The look on the stand is a wardrobe
  `Look`; every list (bodies, each slot's parts, palettes, outfits) is read from the catalogue and the wardrobe, so
  a part made in the Blender kit appears with no code.
- Poses ([`poseAt`](ref:hub/renderers/tower3d/src/dresser.ts#poseAt)) are the layers Tower 3D plays: standing,
  sitting and typing in the desk's own chair model seated by `seatedAt` on
  [`CHAIR`](ref:hub/renderers/tower3d/src/chair.ts#CHAIR) (the measurement desks use), walking, waving, cheering,
  dancing; played or scrubbed on the page's clock.
- Fitting: a rigid piece (clicked, or picked from the list) takes three's `TransformControls`, number fields and a
  size slider. An edit writes only the field the gizmo moves, under the chosen key: `*` (every look), a part worn
  with it (the look's head by default) or `bot`. Tower 3D's own [`fitFrom`](ref:hub/renderers/tower3d/src/wardrobe.ts#fitFrom)
  says which key each field comes from, shown beside it, with a warning when a stronger override hides the key
  being edited. The gizmo's placement is turned back into a fit by
  [`fitOfObject`](ref:hub/renderers/tower3d/src/dresser.ts#fitOfObject), the inverse of
  [`fitted`](ref:hub/renderers/tower3d/src/avatar.ts#fitted). "Try on every head"
  ([`restage`](ref:hub/renderers/tower3d/src/dresser.ts#restage)) lines the look up on each head, the edited one in
  front of the gizmo, all re-fitted live.
- Outfits: the look is kept under a name as an outfit that sets every slot, bare ones too
  ([`outfitOf`](ref:hub/renderers/tower3d/src/dresser.ts#outfitOf)), or dropped (and from the mix's `except`). The
  mix is edited as JSON, checked by the wardrobe's schema.
- Saving ([`save`](ref:hub/renderers/tower3d/src/dresser.ts#save)): the page checks `problems` against its
  catalogue, then PUTs the document to [`tool:dresser serve`](ref:hub/scripts/dresser.ts), which parses it and writes
  it through [`formatWardrobe`](ref:hub/renderers/tower3d/src/wardrobe.ts#formatWardrobe)
  ([`saveWardrobe`](ref:hub/scripts/dresser.ts#saveWardrobe)), so a save diffs by what changed. Node has no catalogue
  (it is derived from the GLBs with three), so the catalogue check is the page's. Served elsewhere (the tower, a
  shelf frame), the page has no server and copies the JSON instead. The serve rebuilds on each load of the page, and
  Tower 3D takes the file on its next `npm run tower3d`.
- Agents: `window.dresser` (`ready · look · pose · fit · outfit · save · heads · view · state · where · shot`) and
  `npm run tool:dresser -- shot <outfit|id|CALLSIGN|blank> [--pose] [--view] [--heads all]`, a PNG through the same
  page in headless Chrome.

**Alternatives considered.**
- *A mode of the KayKit playground* (the first plan): its scenes are static models; the dresser needs the rig,
  clips, tinting and dressing code, which live in Tower 3D's bundle.
- *Fits saved by the server checking the catalogue*: the catalogue comes from parsing the GLBs with three; the page
  that already has it checks, and the server checks the schema.
- *Dragging the uniform-scale handle alone*: TransformControls' centre handle jumps when grabbed near its middle,
  so uniform size is a slider too.

**Impact.** Fits, outfits and the mix are adjusted by eye and saved as a reviewed diff of `wardrobe.json`; agents
check a fit from a picture. Tower 3D modules that read `window.tower` at import (`api.ts`'s reads, `fixtures.ts`'s
streams and blobs) now read it when called, so a Tower 3D page loads where no tower serves it.
