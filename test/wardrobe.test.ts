import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { STAFF, fitFrom, formatWardrobe, parseWardrobe, type Catalogue, type CataloguePart } from '../renderers/tower3d/src/wardrobe.ts'

const FILE = new URL('../renderers/tower3d/wardrobe.json', import.meta.url)

test('the wardrobe parses, and is saved as formatWardrobe writes it', () => {
  const text = readFileSync(FILE, 'utf8')
  assert.equal(formatWardrobe(parseWardrobe(JSON.parse(text), 'wardrobe.json')), text)
})

test('the wardrobe keeps every outfit Tower 3D dresses by name, out of the mix', () => {
  const w = parseWardrobe(JSON.parse(readFileSync(FILE, 'utf8')), 'wardrobe.json')
  for (const n of STAFF) {
    assert.ok(n in w.outfits, `no outfit ${n}`)
    assert.ok(w.mix.outfits.except?.includes(n), `${n} is in the mix`)
  }
})

test('every outfit the mix gives a callsign\'s name is in the wardrobe', () => {
  const w = parseWardrobe(JSON.parse(readFileSync(FILE, 'utf8')), 'wardrobe.json')
  for (const [name, outfit] of Object.entries(w.mix.named)) assert.ok(outfit in w.outfits, `${name}: no outfit ${outfit}`)
})

test('a fit takes its * under the overrides of what it is worn with, by slot precedence, field by field', () => {
  const part = (name: string, slot: CataloguePart['slot']): CataloguePart => ({ name, slot, from: 'parts', attach: { skinned: true } })
  const c = { parts: Object.fromEntries([part('Knight_Head', 'Head'), part('Outfit_Vest', 'Outfit'), part('Knight_Cape', 'Cape')].map((p) => [p.name, p])) } as unknown as Catalogue
  const w = parseWardrobe(JSON.parse(readFileSync(FILE, 'utf8')), 'wardrobe.json')
  w.fits = {
    face_glasses: {
      Knight_Cape: { at: [0, 0, 3], turn: [5, 0, 0] },
      Knight_Head: { at: [0, 0.1, 0] },
      Outfit_Vest: { at: [0, 0, 2], scale: 2 },
      '*': { scale: 0.8, turn: [1, 0, 0] },
      bot: { at: [9, 9, 9] },
    },
  }
  assert.deepEqual(fitFrom(w, c, 'face_glasses', ['Knight_Head', 'Outfit_Vest', 'Knight_Cape']), {
    fit: { scale: 2, turn: [5, 0, 0], at: [0, 0.1, 0] },
    from: { scale: 'Outfit_Vest', turn: 'Knight_Cape', at: 'Knight_Head' },
  })
  assert.deepEqual(fitFrom(w, c, 'face_glasses', ['bot']).fit, { scale: 0.8, turn: [1, 0, 0], at: [9, 9, 9] })
  assert.deepEqual(fitFrom(w, c, 'face_shades', ['Knight_Head']), { fit: {}, from: {} })
})
