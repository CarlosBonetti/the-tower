import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import adventurersGlb from '../kaykit/Characters/adventurers.glb'
import clipsGlb from '../kaykit/Characters/rig_medium.glb'
import { ADVENTURERS, CLIPS, type Adventurer, type Bone, type ClipName } from './contract.ts'

/**
 * The skeleton every worker stands on (KayKit's Rig_Medium, kaykit/Characters), the parts the adventurers are dressed
 * from, and the clips that pose them, parsed once (`loadCast`). A worker is a copy of the bones (`rigOf`) with one
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
  /** Each adventurer part as the pack holds it: skinned parts on the bones, rigid ones on the bone they hang on. */
  parts: Map<string, { mesh: THREE.Mesh; bone?: string }>
  /** Skinned parts merged into one geometry, by their names: what a worker draws in one call per atlas. */
  merged: Map<string, THREE.BufferGeometry>
  /** The bones skinned parts are bound to, in order, and their inverse binds: the pack's rest pose. */
  joints: string[]
  inverses: THREE.Matrix4[]
  atlases: Map<Adventurer, THREE.Texture>
  clips: Map<ClipKey, THREE.AnimationClip>
  /** The hips' height in a chair, rig units: where the seat lifts a seated worker from. */
  seatedHips: number
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
  const [adventurers, rig] = await Promise.all([parse(adventurersGlb), parse(clipsGlb)])
  const bones = adventurers.scene.getObjectByName('Rig')!
  const parts = new Map<string, { mesh: THREE.Mesh; bone?: string }>()
  const atlases = new Map<Adventurer, THREE.Texture>()
  bones.updateMatrixWorld(true)
  bones.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry.userData.shared = true
    o.geometry.computeBoundingSphere()
    const owner = ADVENTURERS.find((a) => o.material.name === `${a.toLowerCase()}_texture`)
    if (owner && !atlases.has(owner)) atlases.set(owner, atlasOf(o.material))
    parts.set(o.name, { mesh: o, bone: o instanceof THREE.SkinnedMesh ? undefined : o.parent!.name })
  })
  for (const { mesh } of parts.values()) mesh.removeFromParent()
  const { skeleton } = [...parts.values()].map((p) => p.mesh).find((m) => m instanceof THREE.SkinnedMesh) as THREE.SkinnedMesh
  const clips = new Map<ClipKey, THREE.AnimationClip>()
  for (const name of CLIPS) clips.set(name, rig.animations.find((a) => a.name === name)!)
  clips.set('Type', typing(bones, clips.get('Sit_Chair_Idle')!))
  for (const [name, clip] of [...clips]) for (const part of ['arms', 'rest'] as const) clips.set(`${name}:${part}` as ClipKey, cut(clip, part))
  const seated = SkeletonUtils.clone(bones)
  new THREE.AnimationMixer(seated).clipAction(clips.get('Sit_Chair_Idle')!).play().getMixer().update(0)
  seated.updateMatrixWorld(true)
  return { bones, parts, merged: new Map(), joints: skeleton.bones.map((b) => b.name), inverses: skeleton.boneInverses, atlases, clips, seatedHips: seated.getObjectByName('hips')!.getWorldPosition(new THREE.Vector3()).y }
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

/** Sets the rig to `pose`: every layer at its time, nothing else playing. */
export function pose(cast: Cast, rig: Rig, { layers, lean = 0 }: Pose) {
  const wanted = new Set(layers.map((l) => l.clip))
  for (const [clip, action] of rig.playing) if (!wanted.has(clip)) (action.stop(), rig.playing.delete(clip))
  for (const { clip, at, weight = 1 } of layers) {
    let action = rig.playing.get(clip)
    if (!action) {
      action = rig.mixer.clipAction(cast.clips.get(clip)!).play()
      rig.playing.set(clip, action)
    }
    action.time = ((at % action.getClip().duration) + action.getClip().duration) % action.getClip().duration
    action.weight = weight
  }
  rig.mixer.update(0)
  if (lean) rig.bone('chest').quaternion.multiply(leaning.setFromAxisAngle(X, lean))
}
