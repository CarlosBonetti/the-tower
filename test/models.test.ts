import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ADVENTURER_PARTS, BONES, CLIPS, CONTRACT, MODEL_NAMES, missing } from '../renderers/tower3d/src/contract.ts'

const TOWER3D = path.join(import.meta.dirname, '..', 'renderers', 'tower3d')
const ASSETS = path.join(TOWER3D, 'assets')
const CHARACTERS = path.join(TOWER3D, 'kaykit', 'Characters')

/** A name as three.js's GLTFLoader gives it to a node: `hand.r` is `handr`. */
const sanitized = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '')

/** The node, material and animation names in a binary glTF, read from its JSON chunk. */
function namesIn(file: string) {
  const glb = readFileSync(file)
  assert.equal(glb.toString('ascii', 0, 4), 'glTF', `${file} is not a binary glTF`)
  const length = glb.readUInt32LE(12)
  assert.equal(glb.toString('ascii', 16, 20), 'JSON', `${file} has no JSON chunk first`)
  const json = JSON.parse(glb.toString('utf8', 20, 20 + length)) as Record<'nodes' | 'materials' | 'animations', { name?: string }[] | undefined>
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
