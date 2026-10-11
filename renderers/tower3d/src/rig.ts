import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import adventurersGlb from '../kaykit/Characters/adventurers.glb'
import clipsGlb from '../kaykit/Characters/rig_medium.glb'
import partsGlb from '../parts/parts.glb'
import { ADVENTURERS, CLIPS, PACK_SLOTS, SLOTS, slotOf, type Adventurer, type Bone, type ClipName, type Slot } from './contract.ts'

/**
 * The skeleton every worker stands on (KayKit's Rig_Medium, kaykit/Characters), the parts the adventurers are dressed
 * from (the pack's, and those made in parts/parts.blend), and the clips that pose them, parsed once (`loadCast`). A worker is a copy of the bones (`rigOf`) with one
 * `AnimationMixer` over the shared clips; `pose` sets it from a list of layers, each a clip at a time, so a pose is a
 * function of the sim clock and nothing is kept between frames.
 */

/** Rig units (the rest pose stands 2.2 tall) to meters: a worker stands 1.5 m. */
export const RIG_SCALE = 0.68

/**
 * Clips derived at load: `Type`, both forearms on the keyboard tapping, seated; and any clip cut to the arms (`:arms`)
 * or to everything but the arms (`:rest`), so an upper-body clip plays over a seated one.
 */
export type ClipKey = ClipName | 'Type' | `${ClipName | 'Type'}:${'arms' | 'rest'}`

export type Cast = {
  /** The bones, without parts: what every worker's rig is copied from. */
  bones: THREE.Object3D
  /**
   * Each part as its file holds it: skinned parts on the bones, rigid ones on the bone they hang on, and the atlas it is
   * painted in.
   */
  parts: Map<string, { mesh: THREE.Mesh; bone?: string; atlas: Adventurer }>
  /** The parts a look may pick for each slot: the pack's, then the made ones named after it. */
  slots: Record<Slot, readonly string[]>
  /** Skinned parts merged into one geometry, by their names: what a worker draws in one call per atlas. */
  merged: Map<string, THREE.BufferGeometry>
  /** The bones skinned parts are bound to, in order, and their inverse binds: the pack's rest pose. */
  joints: string[]
  inverses: THREE.Matrix4[]
  atlases: Map<Adventurer, THREE.Texture>
  clips: Map<ClipKey, THREE.AnimationClip>
  /**
   * The rig seated (the sit clip's first frame), in rig units: where its hips are, and each joint's skinning matrix,
   * which carries a skinned part's rest vertex to where it sits (`seatOf`).
   */
  seated: { hips: THREE.Vector3; skin: THREE.Matrix4[] }
}

const parse = (bytes: Uint8Array) =>
  new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')

const ARM_BONES = new Set(['upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr'])
const boneOf = (track: THREE.KeyframeTrack) => track.name.slice(0, track.name.lastIndexOf('.'))

function cut(clip: THREE.AnimationClip, part: 'arms' | 'rest') {
  const tracks = clip.tracks.filter((t) => ARM_BONES.has(boneOf(t)) === (part === 'arms'))
  return new THREE.AnimationClip(`${clip.name}:${part}`, clip.duration, tracks)
}

/** Points `bone` so the segment to `child` runs along `dir` (world space). */
function aim(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.updateWorldMatrix(true, true)
  const from = bone.getWorldPosition(new THREE.Vector3())
  const to = child.getWorldPosition(new THREE.Vector3())
  const turn = new THREE.Quaternion().setFromUnitVectors(to.sub(from).normalize(), dir.clone().normalize())
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
  bone.quaternion.copy(parent.multiply(turn).multiply(bone.getWorldQuaternion(new THREE.Quaternion())))
  bone.updateWorldMatrix(false, true)
}

/** Taps per second on the keyboard, and the loop: four taps of each hand. */
const TAP = { rate: 2.22, taps: 4 }

/**
 * Typing, made once from the seated clip's first frame: the upper arms down and forward, the forearms to the keyboard,
 * each hand tapping a half beat off the other.
 */
function typing(bones: THREE.Object3D, sit: THREE.AnimationClip) {
  const rig = SkeletonUtils.clone(bones)
  const mixer = new THREE.AnimationMixer(rig)
  mixer.clipAction(sit).play()
  const duration = TAP.taps / TAP.rate
  const frames = Math.round(duration * 30)
  const fwd = new THREE.Vector3(0, 0, 1)
  const side = new THREE.Vector3(1, 0, 0)
  const names = ['upperarml', 'lowerarml', 'wristl', 'upperarmr', 'lowerarmr', 'wristr']
  const keys = new Map(names.map((n) => [n, [] as number[]]))
  const times: number[] = []
  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration
    mixer.setTime(0)
    for (const [s, arm] of [[1, 'l'], [-1, 'r']] as const) {
      const tap = Math.max(0, Math.sin(t * TAP.rate * Math.PI * 2 + (s > 0 ? 0 : Math.PI)))
      const bone = (n: string) => rig.getObjectByName(`${n}${arm}`)!
      aim(bone('upperarm'), bone('lowerarm'), fwd.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, -1, 0)).addScaledVector(side, s * 0.18))
      aim(bone('lowerarm'), bone('wrist'), fwd.clone().add(new THREE.Vector3(0, 0.12 - tap * 0.3, 0)).addScaledVector(side, -s * 0.25))
    }
    times.push(t)
    for (const n of names) keys.get(n)!.push(...rig.getObjectByName(n)!.quaternion.toArray())
  }
  return new THREE.AnimationClip('Type', duration, names.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, keys.get(n)!)))
}

/** An adventurer's atlas, in colour, shared by every worker painted in it. */
function atlasOf(material: THREE.MeshStandardMaterial) {
  const map = material.map!
  map.colorSpace = THREE.SRGBColorSpace
  map.userData.shared = true
  return map
}

export async function loadCast(): Promise<Cast> {
  const [adventurers, made, rig] = await Promise.all([parse(adventurersGlb), parse(partsGlb), parse(clipsGlb)])
  const bones = adventurers.scene.getObjectByName('Rig')!
  const parts: Cast['parts'] = new Map()
  const collect = (from: THREE.Object3D) => {
    from.updateMatrixWorld(true)
    from.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.geometry.userData.shared = true
      o.geometry.computeBoundingSphere()
      const atlas = ADVENTURERS.find((a) => o.material.name === `${a.toLowerCase()}_texture`)!
      parts.set(o.name, { mesh: o, bone: o instanceof THREE.SkinnedMesh ? undefined : o.parent!.name, atlas })
    })
  }
  collect(bones)
  const atlases = new Map(ADVENTURERS.map((a) => [a, atlasOf([...parts.values()].find((p) => p.atlas === a)!.mesh.material as THREE.MeshStandardMaterial)]))
  const pack = new Set(parts.keys())
  collect(made.scene.getObjectByName('Rig')!)
  const authored = [...parts.keys()].filter((n) => !pack.has(n))
  const slots = { ...PACK_SLOTS }
  for (const s of SLOTS) slots[s] = [...PACK_SLOTS[s], ...authored.filter((n) => slotOf(n) === s)]
  for (const { mesh } of parts.values()) mesh.removeFromParent()
  const { skeleton } = [...parts.values()].map((p) => p.mesh).find((m) => m instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
  const clips = new Map<ClipKey, THREE.AnimationClip>()
  for (const name of CLIPS) clips.set(name, rig.animations.find((a) => a.name === name)!)
  clips.set('Type', typing(bones, clips.get('Sit_Chair_Idle')!))
  for (const [name, clip] of [...clips]) for (const part of ['arms', 'rest'] as const) clips.set(`${name}:${part}` as ClipKey, cut(clip, part))
  const joints = skeleton.bones.map((b) => b.name)
  const sitting = SkeletonUtils.clone(bones)
  new THREE.AnimationMixer(sitting).clipAction(clips.get('Sit_Chair_Idle')!).play().getMixer().update(0)
  sitting.updateMatrixWorld(true)
  const seated = {
    hips: sitting.getObjectByName('hips')!.getWorldPosition(new THREE.Vector3()),
    skin: joints.map((n, i) => sitting.getObjectByName(n)!.matrixWorld.clone().multiply(skeleton.boneInverses[i])),
  }
  return { bones, parts, slots, merged: new Map(), joints, inverses: skeleton.boneInverses, atlases, clips, seated }
}

/** The joints a seated body bears on: its pelvis and thighs on the seat, its back against a back rest. */
const ON_SEAT = new Set(['hips', 'upperlegl', 'upperlegr'])
const ON_BACK = new Set(['hips', 'spine', 'chest'])

const seats = new WeakMap<THREE.BufferGeometry, Sitting>()

/**
 * How a skinned part sits, in rig units: the lowest point of what bears on the seat, and the back of what leans on a
 * back rest (the least z), each vertex counted with the joint that moves it most.
 */
export type Sitting = { under: number; back: number }

export function seatOf(cast: Cast, geometry: THREE.BufferGeometry): Sitting {
  if (!seats.has(geometry)) {
    const { position, skinIndex, skinWeight } = geometry.attributes
    const v = new THREE.Vector3()
    const at = new THREE.Vector3()
    let under = Infinity
    let back = Infinity
    for (let i = 0; i < position.count; i++) {
      let most = 0
      for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, most)) most = k
      const joint = cast.joints[skinIndex.getComponent(i, most)]
      if (!ON_SEAT.has(joint) && !ON_BACK.has(joint)) continue
      at.set(0, 0, 0)
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k)
        if (w) at.addScaledVector(v.fromBufferAttribute(position, i).applyMatrix4(cast.seated.skin[skinIndex.getComponent(i, k)]), w)
      }
      if (ON_SEAT.has(joint)) under = Math.min(under, at.y)
      if (ON_BACK.has(joint)) back = Math.min(back, at.z)
    }
    seats.set(geometry, { under, back })
  }
  return seats.get(geometry)!
}

/** A worker's copy of the bones and the mixer that poses them. */
export type Rig = {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  bone: (name: Bone) => THREE.Object3D
  /** The bones as skinned parts are bound to them, shared by every part the rig wears. */
  skeleton: THREE.Skeleton
  /** The actions the last pose played, by clip. */
  playing: Map<ClipKey, THREE.AnimationAction>
  /** The last pose set, and the one it is fading in from since `at` (sim seconds), while the fade lasts. */
  last?: Pose
  fade?: { from: Pose; at: number }
}

export function rigOf(cast: Cast): Rig {
  const root = SkeletonUtils.clone(cast.bones)
  const bones = new Map<string, THREE.Object3D>()
  root.traverse((o) => bones.set(o.name, o))
  const skeleton = new THREE.Skeleton(cast.joints.map((n) => bones.get(n) as THREE.Bone), cast.inverses)
  return { root, mixer: new THREE.AnimationMixer(root), bone: (name) => bones.get(name)!, skeleton, playing: new Map() }
}

/** Skinned parts of the pack dressed on a rig in one `material`, merged into one mesh on its bones. */
export function wearSkinned(cast: Cast, rig: Rig, names: string[], material: THREE.Material) {
  const sources = names.map((n) => cast.parts.get(n)!.mesh as THREE.SkinnedMesh)
  const key = names.join('+')
  if (!cast.merged.has(key)) {
    const geometry = mergeGeometries(sources.map((m) => m.geometry))!
    geometry.computeBoundingSphere()
    geometry.userData.shared = true
    cast.merged.set(key, geometry)
  }
  return skin(rig, cast.merged.get(key)!, material)
}

function skin(rig: Rig, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.boundingSphere = geometry.boundingSphere!.clone()
  rig.root.add(mesh)
  mesh.bind(rig.skeleton, new THREE.Matrix4())
  return mesh
}

const skinnedModels = new WeakMap<THREE.Object3D, { geometry: THREE.BufferGeometry; material: THREE.Material }[]>()

/**
 * A rigid model standing in the rig's rest pose, its parts under pivots named after the bones they ride, as skinned
 * meshes on those bones: one geometry per material, made once per model.
 */
function skinnedFrom(cast: Cast, model: THREE.Object3D) {
  if (!skinnedModels.has(model)) {
    model.updateMatrixWorld(true)
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>()
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      let pivot: THREE.Object3D | null = o
      while (pivot && !cast.joints.includes(pivot.name)) pivot = pivot.parent
      const joint = cast.joints.indexOf(pivot!.name)
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
      const n = g.attributes.position.count
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 ? 0 : joint)), 4))
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4))
      byMaterial.set(o.material, [...(byMaterial.get(o.material) ?? []), g])
    })
    skinnedModels.set(model, [...byMaterial].map(([material, gs]) => {
      const geometry = mergeGeometries(gs)!
      geometry.computeBoundingSphere()
      geometry.userData.shared = true
      return { geometry, material }
    }))
  }
  return skinnedModels.get(model)!
}

/** A rigid model's parts skinned onto a rig's bones (`skinnedFrom`), each material as `material` gives it. */
export function wearModel(cast: Cast, rig: Rig, model: THREE.Object3D, material: (m: THREE.Material) => THREE.Material) {
  for (const part of skinnedFrom(cast, model)) skin(rig, part.geometry, material(part.material))
}

/** A rigid part of the pack hung on its bone of a rig, in `material`. */
export function wearRigid(cast: Cast, rig: Rig, name: string, material: THREE.Material) {
  const { mesh, bone } = cast.parts.get(name)!
  const rigid = new THREE.Mesh(mesh.geometry, material)
  rigid.name = name
  rigid.position.copy(mesh.position)
  rigid.quaternion.copy(mesh.quaternion)
  rigid.scale.copy(mesh.scale)
  rig.bone(bone as Bone).add(rigid)
  return rigid
}

/** Whether a part of the pack is skinned to the bones, else hung on one. */
export const skinned = (cast: Cast, name: string) => cast.parts.get(name)!.bone === undefined

/** A clip playing at `at` seconds (looped), at `weight`. */
export type Layer = { clip: ClipKey; at: number; weight?: number }
/** A pose: its layers, and how far the chest leans forward over them (radians; back when negative). */
export type Pose = { layers: Layer[]; lean?: number }

const leaning = new THREE.Quaternion()
const X = new THREE.Vector3(1, 0, 0)

/** How long a new pose takes to fade in over the last one, seconds. */
const FADE = 0.3

const clipsOf = (p: Pose) => p.layers.map((l) => l.clip).join('|')

/**
 * Sets the rig to `next` at sim time `t`: every layer at its time, nothing else playing. A pose of other clips than
 * the last fades in over `FADE`, the last one held where it stopped and fading out under it.
 */
export function pose(cast: Cast, rig: Rig, next: Pose, t: number) {
  if (rig.last && clipsOf(rig.last) !== clipsOf(next)) rig.fade = { from: rig.fade && t - rig.fade.at < FADE ? rig.fade.from : rig.last, at: t }
  rig.last = next
  const k = rig.fade ? Math.min(1, (t - rig.fade.at) / FADE) : 1
  const layers = new Map<ClipKey, { at: number; weight: number }>()
  for (const { clip, at, weight = 1 } of next.layers) layers.set(clip, { at, weight: weight * k })
  for (const { clip, at, weight = 1 } of k < 1 ? rig.fade!.from.layers : []) {
    const held = layers.get(clip)
    if (held) held.weight += weight * (1 - k)
    else layers.set(clip, { at, weight: weight * (1 - k) })
  }
  if (k === 1) rig.fade = undefined
  for (const [clip, action] of rig.playing) if (!layers.has(clip)) (action.stop(), rig.playing.delete(clip))
  for (const [clip, { at, weight }] of layers) {
    let action = rig.playing.get(clip)
    if (!action) {
      action = rig.mixer.clipAction(cast.clips.get(clip)!).play()
      rig.playing.set(clip, action)
    }
    action.time = ((at % action.getClip().duration) + action.getClip().duration) % action.getClip().duration
    action.weight = weight
  }
  rig.mixer.update(0)
  const lean = (next.lean ?? 0) * k + (k < 1 ? (rig.fade?.from.lean ?? 0) * (1 - k) : 0)
  if (lean) rig.bone('chest').quaternion.multiply(leaning.setFromAxisAngle(X, lean))
}
