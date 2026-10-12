import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ADVENTURER_PARTS, ATLASES, ATLAS_NAMES, BONES, CLIPS, CONTRACT, KAYKIT, MODEL_NAMES, bodyOf, missing, slotOf, textureOf, type RigKind } from '../renderers/tower3d/src/contract.ts'

const TOWER3D = path.join(import.meta.dirname, '..', 'renderers', 'tower3d')
const ASSETS = path.join(TOWER3D, 'assets')
const CHARACTERS = path.join(TOWER3D, 'kaykit', 'Characters')
const PARTS = path.join(TOWER3D, 'parts', 'parts.glb')

/** A name as three.js's GLTFLoader gives it to a node: `hand.r` is `handr`. */
const sanitized = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '')

type Gltf = { nodes: { name?: string; mesh?: number; skin?: number; children?: number[] }[]; materials?: { name?: string }[]; animations?: { name?: string }[]; skins?: { joints: number[] }[] }

/** A binary glTF's JSON chunk. */
function gltfOf(file: string): Gltf {
  const glb = readFileSync(file)
  assert.equal(glb.toString('ascii', 0, 4), 'glTF', `${file} is not a binary glTF`)
  const length = glb.readUInt32LE(12)
  assert.equal(glb.toString('ascii', 16, 20), 'JSON', `${file} has no JSON chunk first`)
  return JSON.parse(glb.toString('utf8', 20, 20 + length))
}

/** The node, material and animation names in a binary glTF. */
function namesIn(file: string) {
  const json = gltfOf(file)
  const named = (xs: { name?: string }[] = []) => xs.flatMap((x) => (x.name ? [x.name] : []))
  return { nodes: named(json.nodes).map(sanitized), materials: named(json.materials), animations: named(json.animations) }
}

for (const name of MODEL_NAMES) {
  test(`${name}.glb keeps its contract`, () => {
    assert.deepEqual(missing(CONTRACT[name], namesIn(path.join(ASSETS, `${name}.glb`))), [])
  })
}

test('adventurers.glb holds every part a look may show, on every bone poses move', () => {
  const held = namesIn(path.join(CHARACTERS, 'adventurers.glb'))
  assert.deepEqual(missing({ nodes: [...ADVENTURER_PARTS, ...BONES], materials: [] }, held), [])
})

test('rig_medium.glb holds every clip poses play, on every bone', () => {
  const held = namesIn(path.join(CHARACTERS, 'rig_medium.glb'))
  assert.deepEqual(CLIPS.filter((c) => !held.animations.includes(c)), [])
  assert.deepEqual(missing({ nodes: [...BONES], materials: [] }, held), [])
})

for (const rig of ['medium', 'large'] satisfies RigKind[]) {
  test(`${rig}.glb holds every part of the KayKit characters on Rig_${rig}, one skin, in their atlases and colourways`, () => {
    const characters = (Object.keys(KAYKIT) as (keyof typeof KAYKIT)[]).filter((c) => KAYKIT[c].rig === rig)
    const held = namesIn(path.join(CHARACTERS, `${rig}.glb`))
    const parts = characters.flatMap((c) => [...bodyOf(c).parts, ...KAYKIT[c].head, ...Object.values(KAYKIT[c].slots as Record<string, readonly string[]>).flat()])
    assert.deepEqual(missing({ nodes: [...parts, ...BONES], materials: [] }, held), [])
    const atlases = ATLAS_NAMES.filter((a) => characters.some((c) => bodyOf(c).paints.includes(a))).map(textureOf)
    assert.deepEqual(atlases.filter((m) => !held.materials.includes(m)), [])
    assert.equal(gltfOf(path.join(CHARACTERS, `${rig}.glb`)).skins!.length, 1)
  })
}

test('rig_large.glb holds every clip poses play, on every bone', () => {
  const held = namesIn(path.join(CHARACTERS, 'rig_large.glb'))
  assert.deepEqual(CLIPS.filter((c) => !held.animations.includes(c)), [])
  assert.deepEqual(missing({ nodes: [...BONES], materials: [] }, held), [])
})

test('parts.glb holds parts named after their slot, in the atlases, on the bones clips move and the pack\'s skin', () => {
  const parts = gltfOf(PARTS)
  const pack = gltfOf(path.join(CHARACTERS, 'adventurers.glb'))
  const jointsOf = (g: Gltf) => g.skins![0].joints.map((j) => g.nodes[j].name)
  assert.deepEqual(jointsOf(parts), jointsOf(pack))
  const parent = new Map(parts.nodes.flatMap((n, i) => (n.children ?? []).map((c) => [c, i] as const)))
  for (const [i, node] of parts.nodes.entries()) {
    if (node.mesh === undefined) continue
    assert.ok(slotOf(node.name!), `${node.name} is named after no slot`)
    assert.ok(!ADVENTURER_PARTS.includes(node.name!), `${node.name} is a part of the pack`)
    const on = sanitized(parts.nodes[parent.get(i)!].name!)
    assert.ok(node.skin === 0 ? on === 'Rig' : (BONES as readonly string[]).includes(on), `${node.name} hangs on ${on}`)
  }
  assert.deepEqual((parts.materials ?? []).filter((m) => !ATLASES.includes(m.name!)), [])
})
