import * as THREE from 'three'
import { FACES, HATS, PACK_SLOTS, SLOTS, slotOf, type Bone, type Slot } from './contract.ts'
import { rigOf, type Cast } from './rig.ts'
import type { Anchor, Catalogue, CataloguePart, Placement } from './wardrobe.ts'

/**
 * Every part a look may wear, derived at load from the files and never stored: the pack's (adventurers.glb), those made
 * in parts/parts.blend (parts.glb) and the pieces of models/wear.py (wear.glb), each with its slot, how it is attached
 * and what paints it. The wardrobe (wardrobe.ts) names parts from it.
 */

/**
 * The head every head part is made on (parts/parts.blend's stage). KayKit's heads share its width and its eyes, so
 * what fits it fits them all, wherever their hair or beard reaches.
 */
const MADE_ON = 'Knight_Head'

/** How wide a head the pieces of models/wear.py fit: their beanie's and cap's domes, 0.28 in radius. */
const WEAR_HEAD = 0.56

const placement = (at: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3): Placement => ({
  at: at.toArray(),
  quaternion: quaternion.toArray() as Placement['quaternion'],
  scale: scale.toArray(),
})
const anchorAt = (at: THREE.Vector3, scale: number) => placement(at, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale))

/**
 * Where an adventurer wears the pieces of models/wear.py, the same on every head, in its head bone's space: the top and
 * the face (its front, at eye height) of the head parts are made on, at the size that makes the beanie's and cap's
 * domes as wide as that head.
 */
function adventurerAnchors(cast: Cast): Record<Anchor, Placement> {
  const rig = rigOf(cast)
  const { geometry } = cast.parts.get(MADE_ON)!.mesh
  if (!geometry.boundingBox) geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const bone = rig.bone('head')
  rig.root.updateMatrixWorld(true)
  const local = (v: THREE.Vector3) => bone.worldToLocal(rig.root.localToWorld(v))
  const fits = (box.max.x - box.min.x) / WEAR_HEAD
  return {
    hat: anchorAt(local(new THREE.Vector3(0, box.max.y, 0)), fits),
    face: anchorAt(local(new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.42, box.max.z)), fits),
  }
}

/** Where the bot wears them: its model's `hat` and `face` pivots, in the head bone's space at rest. */
function botAnchors(cast: Cast, bot: THREE.Object3D): Record<Anchor, Placement> {
  const rig = rigOf(cast)
  rig.root.updateMatrixWorld(true)
  const at = (name: Anchor) => {
    const pivot = bot.getObjectByName(name)!
    return anchorAt(rig.bone('head').worldToLocal(pivot.getWorldPosition(new THREE.Vector3())), pivot.scale.x)
  }
  return { hat: at('hat'), face: at('face') }
}

const packSlotOf = (name: string) => SLOTS.find((s) => PACK_SLOTS[s].includes(name))

export function catalogueOf(cast: Cast, bot: THREE.Object3D): Catalogue {
  const parts: Record<string, CataloguePart> = {}
  for (const [name, { mesh, bone, atlas }] of cast.parts) {
    const pack = packSlotOf(name)
    const slot = pack ?? slotOf(name) ?? 'Body'
    parts[name] = {
      name,
      slot,
      from: pack || slot === 'Body' ? 'adventurers' : 'parts',
      atlas,
      attach: bone === undefined ? { skinned: true } : { bone: bone as Bone, made: placement(mesh.position, mesh.quaternion, mesh.scale) },
    }
  }
  for (const [names, slot, anchor] of [[HATS, 'Hat', 'hat'], [FACES, 'Face', 'face']] as const) {
    for (const name of names) parts[name] = { name, slot, from: 'wear', attach: { bone: 'head', anchor } }
  }
  const slots = Object.fromEntries(SLOTS.map((s) => [s, Object.values(parts).filter((p) => p.slot === s).map((p) => p.name)])) as Record<Slot, string[]>
  return { parts, slots, anchors: { adventurer: adventurerAnchors(cast), bot: botAnchors(cast, bot) } }
}
