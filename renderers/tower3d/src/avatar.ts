import * as THREE from 'three'
import { ADVENTURERS, BODY_PARTS, FACES, HATS, type Adventurer, type Slot } from './contract.ts'
import { pick, rendezvous, roll } from './hashed.ts'
import { instance, type Models } from './models.ts'
import { RIG_SCALE, rigOf, skinned, wearModel, wearRigid, wearSkinned, type Cast, type Rig } from './rig.ts'
import { glowing, toonMapped } from './toon.ts'

/**
 * How workers look. Every worker stands on KayKit's Rig_Medium (rig.ts): an adventurer dressed from the KayKit
 * Adventurers' parts, or the bot (models/bot.py), whose parts ride the same bones. What it wears from models/wear.py
 * hangs on its `hat` and `face` anchors. A look is plain data, hashed from the session id by `lookOf`.
 */

/** A part, painted with an adventurer's atlas: its own unless `atlas` names another, which recolours it. */
export type Part = { name: string; atlas?: Adventurer }
type Common = { hat?: string; face?: string; wear: string; build: { width: number; height: number } }
export type Look =
  | (Common & { species: 'adventurer'; parts: Part[]; gear?: string; skin: string; hair: string })
  | (Common & { species: 'bot'; hue: string })

const WEAR_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#f78c6c', '#f4f1ea', '#2b2d42']
export const SKINS = ['#f6cfb0', '#efbf98', '#d9a077', '#bd8259', '#9a6340', '#734628', '#4f2f1c']
export const HAIRS = ['#2b2522', '#4a3021', '#7a4b2a', '#c99a55', '#e2c784', '#a8452a', '#b9b4ae', '#f2efe9', '#4f7cff', '#e05fa8', '#3fb489']

/** A worker's own color, hashed from its session id: who it is. Its status shows on its bulb, bubble and pose. */
export const hueOf = (id: string) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.62)
}

/**
 * A worker's look, hashed from its session id: the same on every board and every reload. One in five is a bot. An
 * adventurer takes its body from one adventurer, now and then repainted in another's atlas, a head that may be
 * another's, maybe a helm or a cape, a face piece, a prop or an outfit, maybe gear in hand, and a skin and hair colour
 * of its own. Whether it wears something in a slot is a roll of its own; which part, the `rendezvous` of the slot's
 * (the cast's `slots`): a part added to a slot dresses only the share of its wearers it wins, the rest keep theirs.
 */
export function lookOf(id: string, slots: Record<Slot, readonly string[]>): Look {
  const r = (what: string) => roll(id, what)
  const build = { width: 0.94 + r('width') * 0.12, height: 0.94 + r('height') * 0.12 }
  const wear = pick(WEAR_COLORS, r('wear'))
  const faced = r('face') < 0.25
  if (r('species') < 0.2) return { species: 'bot', hue: `#${hueOf(id).getHexString()}`, hat: r('hat') < 0.55 ? pick(HATS, r('which hat')) : undefined, face: faced ? pick(FACES, r('which face')) : undefined, wear, build }
  const face = faced ? rendezvous(id, 'face', [...FACES, ...slots.Face]) : undefined
  const some = (slot: Slot, chance: number) => (slots[slot].length > 0 && r(slot) < chance ? rendezvous(id, slot, slots[slot]) : undefined)
  const body = pick(ADVENTURERS, r('body'))
  const paint = r('repaint') < 0.3 ? pick(ADVENTURERS, r('paint')) : body
  const head = r('head') < 0.4 ? rendezvous(id, 'head', slots.Head) : `${body}_Head`
  const hooded = head === 'Rogue_Head_Hooded'
  const hatRoll = r('hat')
  const helm = !hooded && hatRoll < 0.2 ? rendezvous(id, 'helm', slots.Helm) : undefined
  const hat = !hooded && !helm && hatRoll < 0.45 ? pick(HATS, r('which hat')) : undefined
  const cape = r('cape') < 0.2 ? rendezvous(id, 'cape', slots.Cape) : undefined
  const made = face !== undefined && slots.Face.includes(face)
  const parts: Part[] = [
    ...BODY_PARTS.map((p) => ({ name: `${body}_${p}`, atlas: paint })),
    ...[head, helm, cape, made ? face : undefined, some('Prop', 0.25), some('Outfit', 0.3)].filter((p) => p !== undefined).map((name) => ({ name })),
  ]
  const gear = r('gear') < 0.35 ? rendezvous(id, 'gear', slots.Gear) : undefined
  return { species: 'adventurer', parts, gear, skin: pick(SKINS, r('skin')), hair: pick(HAIRS, r('hair')), hat, face: made ? undefined : face, wear, build }
}

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

/** Where an adventurer's head is, in its head bone's space: its top and its face's front, measured from its mesh. */
function headSpace(cast: Cast, rig: Rig, head: string) {
  const box = cast.parts.get(head)!.mesh.geometry.boundingBox ?? (cast.parts.get(head)!.mesh.geometry.computeBoundingBox(), cast.parts.get(head)!.mesh.geometry.boundingBox!)
  const bone = rig.bone('head')
  rig.root.updateMatrixWorld(true)
  const local = (v: THREE.Vector3) => bone.worldToLocal(rig.root.localToWorld(v))
  const width = box.max.x - box.min.x
  return {
    top: local(new THREE.Vector3(0, box.max.y, 0)),
    face: local(new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.42, box.max.z)),
    width,
  }
}

/** How wide a head the pieces of models/wear.py were made for, in meters. */
const WEAR_HEAD = 0.36
/** How far above its head (or what it wears there) a worker's status light floats, rig units. */
const BULB_LIFT = 0.42

function anchor(bone: THREE.Object3D, at: THREE.Vector3, scale: number) {
  const a = new THREE.Object3D()
  a.position.copy(at)
  a.scale.setScalar(scale)
  bone.add(a)
  return a
}

/** What dressing a rig hangs on it: anchors for what it wears, its status light, and gear in hand. */
type Dressed = { hat: THREE.Object3D; face: THREE.Object3D; bulb: THREE.MeshBasicMaterial; gear?: THREE.Object3D }

function adventurer(models: Models, rig: Rig, look: Extract<Look, { species: 'adventurer' }>): Dressed {
  const { cast } = models
  const materials = new Map<Adventurer, THREE.Material>()
  const materialOf = (atlas: Adventurer) => {
    if (!materials.has(atlas)) materials.set(atlas, tinted(cast.atlases.get(atlas)!, look.skin, look.hair))
    return materials.get(atlas)!
  }
  const atlasOf = (p: Part) => p.atlas ?? cast.parts.get(p.name)!.atlas
  for (const atlas of new Set(look.parts.map(atlasOf))) {
    const names = look.parts.filter((p) => atlasOf(p) === atlas).map((p) => p.name)
    const soft = names.filter((n) => skinned(cast, n))
    if (soft.length) wearSkinned(cast, rig, soft, materialOf(atlas))
    for (const n of names.filter((n) => !skinned(cast, n))) wearRigid(cast, rig, n, materialOf(atlas))
  }
  const head = look.parts.find((p) => cast.slots.Head.includes(p.name))!.name
  const space = headSpace(cast, rig, head)
  const fits = space.width / WEAR_HEAD
  const helmed = look.parts.some((p) => cast.slots.Helm.includes(p.name))
  const bulb = glowing('#ffffff')
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), bulb)
  light.position.copy(space.top).add(new THREE.Vector3(0, helmed ? BULB_LIFT * 1.6 : BULB_LIFT, 0))
  rig.bone('head').add(light)
  const gear = look.gear === undefined ? undefined : wearRigid(cast, rig, look.gear, materialOf(cast.parts.get(look.gear)!.atlas))
  return { hat: anchor(rig.bone('head'), space.top, fits), face: anchor(rig.bone('head'), space.face, fits), bulb, gear }
}

/**
 * The bot's parts skinned to the bones they are named after, as it stands in the rig's rest pose, its hue and status
 * light its own; what it wears hangs where its model puts `hat` and `face`.
 */
function bot(models: Models, rig: Rig, look: Extract<Look, { species: 'bot' }>): Dressed {
  const own = new Map<string, THREE.Material>()
  wearModel(models.cast, rig, models.bot, (m) => {
    if (!m.name.endsWith('_own')) return m
    if (!own.has(m.name)) own.set(m.name, Object.assign(m.clone(), { userData: {} }))
    return own.get(m.name)!
  })
  ;(own.get('hue_own') as THREE.MeshToonMaterial).color.set(look.hue)
  rig.root.updateMatrixWorld(true)
  const at = (name: string) => {
    const pivot = models.bot.getObjectByName(name)!
    return anchor(rig.bone('head'), rig.bone('head').worldToLocal(pivot.getWorldPosition(new THREE.Vector3())), pivot.scale.x)
  }
  return { hat: at('hat'), face: at('face'), bulb: own.get('bulb_glow_own') as THREE.MeshBasicMaterial }
}

/** How much bigger than life what a worker holds is drawn, to read in its big hands. */
const HELD_SCALE = 1.8

/** How far above a chair's seat a seated worker's hips are, rig units. */
const HIPS_ON_SEAT = 0.2

/** How high `a`'s body rises in its root to sit on a seat `seat` high (in its root's space). */
export const seatedAt = (cast: Cast, a: Avatar, seat: number) => seat + (HIPS_ON_SEAT - cast.seatedHips) * a.rig.root.scale.y

/** A worker dressed in its look, standing at the origin, facing +z. */
export function avatar(models: Models, look: Look): Avatar {
  const rig = rigOf(models.cast)
  const dressed: Dressed = look.species === 'bot' ? bot(models, rig, look) : adventurer(models, rig, look)
  for (const [anchor, name] of [['hat', look.hat], ['face', look.face]] as const) {
    if (!name) continue
    const piece = instance(models.wear.getObjectByName(name)!)
    piece.material<THREE.MeshToonMaterial>('wear_own')?.color.set(look.wear)
    piece.root.position.set(0, 0, 0)
    dressed[anchor].add(piece.root)
  }
  rig.root.scale.set(RIG_SCALE * look.build.width, RIG_SCALE * look.build.height, RIG_SCALE * look.build.width)
  const body = new THREE.Group()
  body.add(rig.root)
  const root = new THREE.Group()
  root.add(body)
  const hand = new THREE.Object3D()
  hand.rotation.z = Math.PI / 2
  hand.scale.setScalar(HELD_SCALE / RIG_SCALE)
  rig.bone('handslotr').add(hand)
  return { root, body, rig, hand, gear: dressed.gear, bulb: dressed.bulb }
}
