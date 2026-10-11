/**
 * Turns the parts exported from renderers/tower3d/parts/parts.blend (its export.py) into parts.glb beside it: the
 * parts looks pick from besides the pack's, in adventurers.glb's terms. They stand on its skeleton and skin: a rigid
 * part under the bone it rides, a skinned one on the skin with its joints in the skin's order. Each is painted in one
 * adventurer's atlas, named by its material; the atlases themselves stay in adventurers.glb.
 *
 *   tsx scripts/tower3d-parts.ts <exported.glb>        (`npm run tower3d:parts` exports and runs this)
 *
 * It refuses what the runtime could not wear, each part with the fix: a name without its slot, more than one material
 * or one that is not an atlas, a rigid part on no bone the clips move, weights on bones they don't, a rig off the
 * pack's rest pose.
 */
import path from 'node:path'
import * as THREE from 'three'
import { ATLASES, BONES, SLOTS, slotOf } from '../renderers/tower3d/src/contract.ts'
import { readGlb, writeGlb, writer, type Glb, type Json } from './glb.ts'

const REPO = path.resolve(import.meta.dirname, '..')
const ADVENTURERS = path.join(REPO, 'renderers/tower3d/kaykit/Characters/adventurers.glb')
const OUT = path.join(REPO, 'renderers/tower3d/parts/parts.glb')
const exported = process.argv[2]
if (!exported) throw new Error('tsx scripts/tower3d-parts.ts <exported.glb>')

/** A name as three.js gives it to a node (`handslot.r` is `handslotr`): what BONES and the runtime call it. */
const sanitized = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '')
const MOVED = new Set<string>(BONES)
/** How far a rest matrix or inverse bind may drift through Blender and still be the pack's. */
const TOLERANCE = 1e-4

const local = (n: Json) =>
  n.matrix
    ? new THREE.Matrix4().fromArray(n.matrix)
    : new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])))

/** Every node's parent, and its matrix in the space of the node named `Rig`. */
function onRig(json: Json) {
  const parent = new Map<number, number>()
  json.nodes.forEach((n: Json, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)))
  const rig = json.nodes.findIndex((n: Json) => n.name === 'Rig')
  if (rig < 0) throw new Error('the parts stand on no armature named Rig: rename it back to Rig')
  const matrix = (i: number): THREE.Matrix4 => (i === rig ? new THREE.Matrix4() : matrix(parent.get(i)!).clone().multiply(local(json.nodes[i])))
  const named = (name: string) => json.nodes.findIndex((n: Json) => n.name === name)
  return { parent, matrix, named, rig }
}

const near = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).every((x, i) => Math.abs(x - b[i]) <= TOLERANCE)

function bytes(src: Glb, i: number) {
  const a = src.json.accessors[i]
  const v = src.json.bufferViews[a.bufferView]
  const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  return src.bin.subarray(at, at + v.byteLength - (a.byteOffset ?? 0))
}

function floats(src: Glb, i: number) {
  const b = bytes(src, i)
  const a = src.json.accessors[i]
  if (a.componentType !== 5126) throw new Error(`accessor ${i} is not float`)
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + a.count * { SCALAR: 1, VEC4: 4, MAT4: 16 }[a.type as string]! * 4))
}

function joints(src: Glb, i: number) {
  const a = src.json.accessors[i]
  const b = bytes(src, i)
  if (a.componentType === 5121) return Uint8Array.from(b.subarray(0, a.count * 4))
  if (a.componentType === 5123) return new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + a.count * 8))
  throw new Error(`accessor ${i} holds joints as ${a.componentType}`)
}

const base = readGlb(ADVENTURERS)
const src = readGlb(path.resolve(exported))
const B = onRig(base.json)
const S = onRig(src.json)
const problems: string[] = []

for (const bone of BONES) {
  const b = base.json.nodes.findIndex((n: Json) => sanitized(n.name ?? '') === bone)
  const s = src.json.nodes.findIndex((n: Json) => sanitized(n.name ?? '') === bone)
  if (s < 0) problems.push(`Rig lacks the bone ${bone}: rebuild parts.blend's rig from build.py`)
  else if (!near(S.matrix(s).elements, B.matrix(b).elements)) problems.push(`Rig's bone ${bone} is off the pack's rest pose: undo its edit (Edit Mode moves the rest pose; pose in Pose Mode)`)
}

const bones = base.json.nodes.flatMap((n: Json, i: number) => (n.mesh === undefined ? [i] : []))
const index = new Map<number, number>(bones.map((b: number, k: number) => [b, k]))
const json: Json = {
  asset: { version: '2.0', generator: 'tower3d-parts' },
  scene: 0,
  nodes: bones.map((b: number) => {
    const n = base.json.nodes[b]
    return { ...n, children: (n.children ?? []).filter((c: number) => index.has(c)).map((c: number) => index.get(c)) }
  }),
  meshes: [],
  materials: [],
}
json.scenes = [{ nodes: [index.get(B.rig)] }]
const out = writer(json)
const skin = base.json.skins[0]
json.skins = [{ joints: skin.joints.map((j: number) => index.get(j)), inverseBindMatrices: out.accessor(base, skin.inverseBindMatrices) }]
const baseJoints: string[] = skin.joints.map((j: number) => base.json.nodes[j].name)
const baseBinds = floats(base, skin.inverseBindMatrices)

const materials = new Map<string, number>()
const materialOf = (name: string) => {
  if (!materials.has(name)) materials.set(name, json.materials.push({ name }) - 1)
  return materials.get(name)!
}

const parts = src.json.nodes.flatMap((n: Json, i: number) => (n.mesh === undefined ? [] : [i]))
for (const i of parts) {
  const node = src.json.nodes[i]
  const name: string = node.name
  const slot = slotOf(name)
  const fail = (why: string) => problems.push(`${name}: ${why}`)
  if (!slot) {
    fail(`name it after its slot, as ${SLOTS.map((s) => `${s}_…`).join(', ')}`)
    continue
  }
  if (sanitized(name) !== name) {
    fail('keep its name to letters, digits and _ (a copy is named .001 by Blender: rename it)')
    continue
  }
  const primitives = src.json.meshes[node.mesh].primitives
  if (primitives.length !== 1) {
    fail(`give it one material, an adventurer's atlas: it has ${primitives.length}`)
    continue
  }
  const p = primitives[0]
  const material = src.json.materials?.[p.material]?.name
  if (!ATLASES.includes(material)) {
    fail(`paint it with an adventurer's atlas (${ATLASES.join(', ')}), not ${material ?? 'no material'}`)
    continue
  }
  const attributes: Json = {}
  for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
    if (p.attributes[key] === undefined) fail(`it has no ${key}`)
    else attributes[key] = out.accessor(src, p.attributes[key])
  }
  const parent = S.parent.get(i)!
  if (node.skin !== undefined) {
    const names: string[] = src.json.skins[node.skin].joints.map((j: number) => src.json.nodes[j].name)
    const binds = floats(src, src.json.skins[node.skin].inverseBindMatrices)
    const js = joints(src, p.attributes.JOINTS_0)
    const ws = floats(src, p.attributes.WEIGHTS_0)
    const used = new Set<number>()
    js.forEach((j, k) => ws[k] > 0 && used.add(j))
    const unmoved = [...used].map((j) => names[j]).filter((n) => !MOVED.has(sanitized(n)))
    if (unmoved.length) fail(`it is weighted to ${unmoved.join(', ')}, which no clip moves: weight it to the deform bones only`)
    const off = [...used].filter((j) => !near(binds.subarray(j * 16, j * 16 + 16), baseBinds.subarray(baseJoints.indexOf(names[j]) * 16, baseJoints.indexOf(names[j]) * 16 + 16)))
    if (off.length) fail(`it is bound with Rig off the pack's rest pose (at ${off.map((j) => names[j]).join(', ')}): keep Rig at the origin, unrotated and unscaled`)
    const remapped = Uint8Array.from(js, (j) => baseJoints.indexOf(names[j]))
    attributes.JOINTS_0 = out.data({ componentType: 5121, count: remapped.length / 4, type: 'VEC4' }, Buffer.from(remapped))
    attributes.WEIGHTS_0 = out.accessor(src, p.attributes.WEIGHTS_0)
    json.meshes.push({ name, primitives: [{ attributes, indices: out.accessor(src, p.indices), material: materialOf(material) }] })
    json.nodes.push({ name, mesh: json.meshes.length - 1, skin: 0 })
    json.nodes[index.get(B.rig)!].children.push(json.nodes.length - 1)
    continue
  }
  const bone = sanitized(src.json.nodes[parent]?.name ?? '')
  if (!MOVED.has(bone)) {
    fail(`parent it to one of Rig's bones (Ctrl+P > Bone), or weight it to them: it hangs on ${src.json.nodes[parent]?.name ?? 'nothing'}`)
    continue
  }
  const onBone = B.named(base.json.nodes.find((n: Json) => sanitized(n.name) === bone).name)
  const matrix = B.matrix(onBone).clone().invert().multiply(S.matrix(i))
  const [t, r, s] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()]
  matrix.decompose(t, r, s)
  json.meshes.push({ name, primitives: [{ attributes, indices: out.accessor(src, p.indices), material: materialOf(material) }] })
  json.nodes.push({ name, mesh: json.meshes.length - 1, translation: t.toArray(), rotation: r.toArray(), scale: s.toArray() })
  json.nodes[index.get(onBone)!].children.push(json.nodes.length - 1)
}

if (problems.length) throw new Error(`parts.blend's parts can't be worn yet:\n  ${problems.join('\n  ')}`)
json.nodes.forEach((n: Json) => n.children?.length === 0 && delete n.children)
writeGlb(OUT, json, out.bin())
const names = parts.map((i: number) => src.json.nodes[i].name).sort()
console.log(`${path.relative(REPO, OUT)}: ${names.length} parts${names.length ? `, ${names.join(', ')}` : ''}`)
