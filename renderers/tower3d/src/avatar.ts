import * as THREE from 'three'
import { instance, type Models } from './models.ts'
import { RIG_SCALES, rigOf, seatOf, skinned, wearModel, wearRigid, wearSkinned, type Cast, type Rig, type Sitting } from './rig.ts'
import { glowing, toonMapped } from './toon.ts'
import { ADVENTURERS, COLOURWAYS, type Atlas } from './contract.ts'
import { bodyParts, fitOf, hueOf as hueDegrees, rigOfLook, wornBy, type Anchor, type Fit, type Look, type Placement, type Wardrobe } from './wardrobe.ts'

/**
 * How workers look. Every worker stands on one of KayKit's skeletons (rig.ts): a character dressed from the catalogue's
 * parts (catalogue.ts), or the bot (models/bot.py), whose parts ride Rig_Medium's bones. A look is plain data
 * (wardrobe.ts); `avatar` dresses a rig in it, every rigid part at its made placement under its fit.
 */

export type { Look }

/** A worker's own color, hashed from its session id: who it is. Its status shows on its bulb, bubble and pose. */
export const hueOf = (id: string) => new THREE.Color().setHSL(hueDegrees(id) / 360, 0.55, 0.62)

export type Avatar = {
  root: THREE.Object3D
  /** The rig's frame inside `root`: lifted onto a seat and turned in it by poses. */
  body: THREE.Object3D
  rig: Rig
  /** In its right hand, upright: where it holds a beer. */
  hand: THREE.Object3D
  /** What it carries in its right hand while it stands, if anything. */
  gear?: THREE.Object3D
  bulb: THREE.MeshBasicMaterial
  /** How its body sits (`seatOf`): the lowest of its parts under it, the furthest back of them behind it. */
  seat: Sitting
  /** Every rigid part it wears, by name: a fit edited live is `place(object, fitted(made, fit))`. */
  worn: Map<string, Worn>
}

/** The atlas cells a skin and hair colour replace: each adventurer paints faces in its first swatch, hair in its second. */
const TINT_CELLS = { skin: [0, 0], hair: [1, 0] }

/** The mean colour of an atlas's swatch cell (8 × 4 of them), read once per atlas and cell. */
const means = new Map<string, THREE.Color>()
function meanOf(atlas: THREE.Texture, [cx, cy]: number[]) {
  const key = `${atlas.uuid}|${cx},${cy}`
  if (!means.has(key)) {
    const img = atlas.image as ImageBitmap
    const canvas = document.createElement('canvas')
    canvas.width = img.width / 8
    canvas.height = img.height / 4
    const g = canvas.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, -cx * canvas.width, -cy * canvas.height)
    const px = g.getImageData(0, 0, canvas.width, canvas.height).data
    const sum = [0, 0, 0]
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += px[i + k]
    const n = px.length / 4
    means.set(key, new THREE.Color().setRGB(sum[0] / n / 255, sum[1] / n / 255, sum[2] / n / 255, THREE.SRGBColorSpace))
  }
  return means.get(key)!
}

const ratio = (to: THREE.Color, from: THREE.Color) => new THREE.Color(to.r / from.r, to.g / from.g, to.b / from.b)

/** The atlases laid out as the Adventurers' swatches, whose skin and hair a look's colours replace. */
const TINTED: readonly Atlas[] = ADVENTURERS

/** An adventurer's atlas with its skin and hair swatches turned to `skin` and `hair`: a material per worker and atlas. */
function tinted(atlas: THREE.Texture, skin: string, hair: string) {
  const m = toonMapped(atlas)
  const tints = { skinTint: { value: ratio(new THREE.Color(skin), meanOf(atlas, TINT_CELLS.skin)) }, hairTint: { value: ratio(new THREE.Color(hair), meanOf(atlas, TINT_CELLS.hair)) } }
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, tints)
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform vec3 skinTint;\nuniform vec3 hairTint;\nvoid main() {').replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      vec2 cell = floor(vMapUv * vec2(8.0, 4.0));
      if (cell.y == ${TINT_CELLS.skin[1]}.0 && cell.x == ${TINT_CELLS.skin[0]}.0) diffuseColor.rgb *= skinTint;
      else if (cell.y == ${TINT_CELLS.hair[1]}.0 && cell.x == ${TINT_CELLS.hair[0]}.0) diffuseColor.rgb *= hairTint;`,
    )
  }
  m.customProgramCacheKey = () => 'tinted'
  return m
}

/** How far above its head (or what it wears there) a worker's status light floats, rig units. */
const BULB_LIFT = 0.42

/** A rigid part a worker wears: what is placed on its bone, and where it was made to sit there, before its fit. */
export type Worn = { object: THREE.Object3D; made: Placement }

const DEG = Math.PI / 180

/**
 * Where a fit puts a rigid part, over its made placement in its bone's space, about the part's own origin: `at` moves
 * it, `turn` turns it about the bone's axes, `scale` multiplies its scale along its own axes. An empty fit leaves it
 * where it was made.
 */
export function fitted(made: Placement, fit: Fit): Placement {
  const { at, turn, scale } = fit
  return {
    at: at ? [made.at[0] + at[0], made.at[1] + at[1], made.at[2] + at[2]] : made.at,
    quaternion: turn
      ? (new THREE.Quaternion().setFromEuler(new THREE.Euler(turn[0] * DEG, turn[1] * DEG, turn[2] * DEG)).multiply(new THREE.Quaternion().fromArray(made.quaternion)).toArray() as Placement['quaternion'])
      : made.quaternion,
    scale: scale === undefined ? made.scale : typeof scale === 'number' ? [made.scale[0] * scale, made.scale[1] * scale, made.scale[2] * scale] : [made.scale[0] * scale[0], made.scale[1] * scale[1], made.scale[2] * scale[2]],
  }
}

/** Sets an object's position, rotation and scale to a placement. */
export function place(object: THREE.Object3D, p: Placement) {
  object.position.fromArray(p.at)
  object.quaternion.fromArray(p.quaternion)
  object.scale.fromArray(p.scale)
}

/** What dressing a rig hangs on it: its status light, gear in hand, and every rigid part by name. */
type Dressed = { bulb: THREE.MeshBasicMaterial; gear?: THREE.Object3D; worn: Map<string, Worn> }

/**
 * The pieces of models/wear.py a look wears, each hung on the head bone at the wearer's anchor of its kind, under its
 * fit, in the look's wear colour.
 */
function wearPieces(models: Models, rig: Rig, look: Look, w: Wardrobe, worn: Map<string, Worn>) {
  const { catalogue } = models
  for (const name of look.parts) {
    const { attach } = catalogue.parts[name]
    if (!('anchor' in attach)) continue
    const made = catalogue.anchors[look.species === 'bot' ? 'bot' : rigOfLook(look)][attach.anchor as Anchor]
    const holder = new THREE.Object3D()
    place(holder, fitted(made, fitOf(w, catalogue, name, wornBy(look))))
    rig.bone('head').add(holder)
    const piece = instance(models.wear.getObjectByName(name)!)
    piece.material<THREE.MeshToonMaterial>('wear_own')?.color.set(look.wear)
    piece.root.position.set(0, 0, 0)
    holder.add(piece.root)
    worn.set(name, { object: holder, made })
  }
}

/** A rigid part of the cast on its bone under its fit, recorded as worn. */
function rigid(models: Models, rig: Rig, look: Look, w: Wardrobe, name: string, material: THREE.Material, worn: Map<string, Worn>) {
  const { catalogue } = models
  const { attach } = catalogue.parts[name]
  const made = (attach as { made: Placement }).made
  const object = wearRigid(models.cast, rig, name, material)
  place(object, fitted(made, fitOf(w, catalogue, name, wornBy(look))))
  worn.set(name, { object, made })
  return object
}

/**
 * A character's body parts in its paint, every part it wears in the atlas it was made in, or in the paint when that is
 * a colourway of it; each part's companions (a jaw, glowing eyes) beside it.
 */
function character(models: Models, rig: Rig, look: Extract<Look, { species: 'character' }>, w: Wardrobe): Dressed {
  const { cast, catalogue } = models
  const materials = new Map<Atlas, THREE.Material>()
  const materialOf = (atlas: Atlas) => {
    if (!materials.has(atlas)) materials.set(atlas, TINTED.includes(atlas) ? tinted(cast.atlases.get(atlas)!, look.skin, look.hair) : toonMapped(cast.atlases.get(atlas)!))
    return materials.get(atlas)!
  }
  const paintOf = (atlas: Atlas) => (COLOURWAYS[look.paint] === atlas ? look.paint : atlas)
  const worn = new Map<string, Worn>()
  const slotted = look.parts.filter((n) => catalogue.parts[n].atlas && catalogue.parts[n].slot !== 'Gear')
  const meshes = [...bodyParts(look.body), ...slotted.flatMap((n) => [n, ...(catalogue.parts[n].with ?? [])])]
  const glows = meshes.filter((n) => cast.parts.get(n)!.glow)
  const painted = [
    ...bodyParts(look.body).map((name) => ({ name, atlas: look.paint })),
    ...meshes.slice(bodyParts(look.body).length).filter((n) => !glows.includes(n)).map((name) => ({ name, atlas: paintOf(cast.parts.get(name)!.atlas!) })),
  ]
  for (const atlas of new Set(painted.map((p) => p.atlas))) {
    const names = painted.filter((p) => p.atlas === atlas).map((p) => p.name)
    const soft = names.filter((n) => skinned(cast, n))
    if (soft.length) wearSkinned(cast, rig, soft, materialOf(atlas))
    for (const n of names.filter((n) => !skinned(cast, n))) rigid(models, rig, look, w, n, materialOf(atlas), worn)
  }
  for (const n of glows) wearSkinned(cast, rig, [n], glowing(`#${cast.parts.get(n)!.glow!.getHexString()}`))
  const unit = RIG_SCALES.medium / RIG_SCALES[rig.kind]
  const helmed = look.parts.some((p) => catalogue.parts[p].slot === 'Helm')
  const bulb = glowing('#ffffff')
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.09 * unit, 12, 8), bulb)
  light.position.fromArray(catalogue.anchors[rig.kind].hat.at).add(new THREE.Vector3(0, (helmed ? BULB_LIFT * 1.6 : BULB_LIFT) * unit, 0))
  rig.bone('head').add(light)
  const held = look.parts.find((p) => catalogue.parts[p].slot === 'Gear')
  const gear = held === undefined ? undefined : rigid(models, rig, look, w, held, materialOf(catalogue.parts[held].atlas!), worn)
  wearPieces(models, rig, look, w, worn)
  return { bulb, gear, worn }
}

/**
 * The bot's parts skinned to the bones they are named after, as it stands in the rig's rest pose, its hue and status
 * light its own; what it wears hangs at its model's `hat` and `face` anchors.
 */
function bot(models: Models, rig: Rig, look: Extract<Look, { species: 'bot' }>, w: Wardrobe): Dressed {
  const own = new Map<string, THREE.Material>()
  wearModel(models.cast, rig, models.bot, (m) => {
    if (!m.name.endsWith('_own')) return m
    if (!own.has(m.name)) own.set(m.name, Object.assign(m.clone(), { userData: {} }))
    return own.get(m.name)!
  })
  ;(own.get('hue_own') as THREE.MeshToonMaterial).color.set(look.hue)
  const worn = new Map<string, Worn>()
  wearPieces(models, rig, look, w, worn)
  return { bulb: own.get('bulb_glow_own') as THREE.MeshBasicMaterial, worn }
}

/** How much bigger than life what a worker holds is drawn, to read in its big hands. */
const HELD_SCALE = 1.8

/**
 * A seat in the space of the root of whoever sits on it, facing +z: its top's height, and the z of its back rest's
 * face. Without a back rest the hips sit over the seat's middle.
 */
export type Seat = { y: number; back?: number }

/** Where `a`'s body stands in its root to sit on `seat`: its underside on the top, its back against the back rest. */
export function seatedAt(cast: Cast, a: Avatar, seat: Seat) {
  const s = a.rig.root.scale
  const { hips } = cast.skeletons[a.rig.kind].seated
  return new THREE.Vector3(-hips.x * s.x, seat.y - a.seat.under * s.y, seat.back === undefined ? -hips.z * s.z : seat.back - a.seat.back * s.z)
}

/** How the skinned parts on a rig sit together: the lowest underside and the furthest back. */
function sittingOf(cast: Cast, rig: Rig): Sitting {
  const sits: Sitting[] = []
  rig.root.traverse((o) => o instanceof THREE.SkinnedMesh && sits.push(seatOf(cast.skeletons[rig.kind], o.geometry)))
  return { under: Math.min(...sits.map((s) => s.under)), back: Math.min(...sits.map((s) => s.back)) }
}

/**
 * A worker dressed in its look, standing at the origin, facing +z, every rigid part placed by its fit in `wardrobe`.
 * Cheap to call again: geometry is shared through the cast, so a new look or wardrobe is a new avatar.
 */
export function avatar(models: Models, look: Look, wardrobe: Wardrobe): Avatar {
  const rig = rigOf(models.cast, rigOfLook(look))
  const dressed: Dressed = look.species === 'bot' ? bot(models, rig, look, wardrobe) : character(models, rig, look, wardrobe)
  const scale = RIG_SCALES[rig.kind]
  rig.root.scale.set(scale * look.build.width, scale * look.build.height, scale * look.build.width)
  const body = new THREE.Group()
  body.add(rig.root)
  const root = new THREE.Group()
  root.add(body)
  const hand = new THREE.Object3D()
  hand.rotation.z = Math.PI / 2
  hand.scale.setScalar(HELD_SCALE / scale)
  rig.bone('handslotr').add(hand)
  return { root, body, rig, hand, gear: dressed.gear, bulb: dressed.bulb, worn: dressed.worn, seat: sittingOf(models.cast, rig) }
}
