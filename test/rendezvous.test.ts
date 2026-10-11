import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rendezvous } from '../renderers/tower3d/src/hashed.ts'

const IDS = Array.from({ length: 1000 }, (_, i) => `20261011-${String(100000 + i * 37).padStart(6, '0')}-${(i * 7919).toString(36).slice(-4)}`)
const POOL = ['Knight_Helmet', 'Mage_Hat', 'Barbarian_Hat', 'Helm_Headset', 'Helm_TopHat']
const wearing = (pool: string[]) => IDS.map((id) => rendezvous(id, 'helm', pool))

test('a part added to a slot of N takes about 1 in N+1 of its wearers, and only those move', () => {
  const before = wearing(POOL)
  const after = wearing([...POOL, 'Helm_Crown'])
  const moved = IDS.flatMap((_, i) => (before[i] !== after[i] ? [i] : []))
  assert.ok(moved.every((i) => after[i] === 'Helm_Crown'), 'a worker moved to an old part')
  const share = IDS.length / (POOL.length + 1)
  assert.ok(Math.abs(moved.length - share) < share * 0.3, `${moved.length} moved, about ${share.toFixed(0)} expected`)
})

test('a part removed from a slot moves only its own wearers, and the pool\'s order never matters', () => {
  const before = wearing(POOL)
  const after = wearing(POOL.filter((p) => p !== 'Mage_Hat'))
  assert.ok(IDS.every((_, i) => before[i] === after[i] || before[i] === 'Mage_Hat'))
  assert.deepEqual(wearing([...POOL].reverse()), before)
})
