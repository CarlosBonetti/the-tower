/**
 * Vendors the KayKit characters Tower 3D makes its workers of into renderers/tower3d/kaykit/Characters, two GLBs the
 * bundle embeds:
 *
 *   adventurers.glb   every part the contract names (`ADVENTURER_PARTS` in renderers/tower3d/src/contract.ts) from
 *                     the KayKit Adventurers 1.0, on one skeleton: bodies, heads, helms, capes and gear, each in its
 *                     adventurer's atlas, without the clips each file embeds
 *   rig_medium.glb    the clips the contract names (`CLIPS`) from KayKit Character Animations 1.1, on Rig_Medium's
 *                     bones, without its mannequin
 *
 *   tsx scripts/tower3d-characters.ts <adventurers> <animations>
 *
 * `<adventurers>` holds Knight.glb, Mage.glb, Rogue.glb, Rogue_Hooded.glb, Barbarian.glb and LICENSE.txt (the pack's
 * GitHub release); `<animations>` the Rig_Medium_*.glb of the animations pack (itch.io). Both packs are CC0. Every
 * adventurer is skinned to the same 41 joints in the same order with the same inverse binds (to 1e-5): checked, since
 * a part moves onto the first one's skeleton.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ADVENTURER_PARTS, CLIPS } from '../renderers/tower3d/src/contract.ts'
import { readGlb, writeGlb, writer, type Glb, type Json } from './glb.ts'

const REPO = path.resolve(import.meta.dirname, '..')
const OUT = path.join(REPO, 'renderers/tower3d/kaykit/Characters')
const [adventurers, animations] = process.argv.slice(2).map((p) => path.resolve(p))
if (!adventurers || !animations) throw new Error('tsx scripts/tower3d-characters.ts <adventurers> <animations>')

const parentsOf = (json: Json) => {
  const parent = new Map<number, number>()
  json.nodes.forEach((n: Json, i: number) => (n.children ?? []).forEach((c: number) => parent.set(c, i)))
  return parent
}
const nodeNamed = (json: Json, name: string) => json.nodes.findIndex((n: Json) => n.name === name)

/** The adventurers' parts on the first one's skeleton, one material per atlas. */
function packAdventurers() {
  const files = ['Knight', 'Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'].map((n) => readGlb(path.join(adventurers, `${n}.glb`)))
  const base = files[0]
  const jointsOf = (g: Glb) => g.json.skins[0].joints.map((j: number) => g.json.nodes[j].name).join(' ')
  const bindsOf = (g: Glb) => {
    const a = g.json.accessors[g.json.skins[0].inverseBindMatrices]
    const v = g.json.bufferViews[a.bufferView]
    const bytes = g.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  for (const g of files) {
    if (jointsOf(g) !== jointsOf(base)) throw new Error('the adventurers are skinned to different joints')
    if (bindsOf(g).some((x, i) => Math.abs(x - bindsOf(base)[i]) > 1e-5)) throw new Error('the adventurers are bound in different poses')
  }

  const bones = base.json.nodes.flatMap((n: Json, i: number) => (n.mesh === undefined ? [i] : []))
  const index = new Map<number, number>(bones.map((b: number, k: number) => [b, k]))
  const skeleton = bones.map((b: number) => {
    const n = base.json.nodes[b]
    return { ...n, children: (n.children ?? []).filter((c: number) => index.has(c)).map((c: number) => index.get(c)) }
  })
  const json: Json = { asset: { version: '2.0', generator: 'tower3d-characters' }, scene: 0, nodes: skeleton, meshes: [], materials: [], textures: [], samplers: base.json.samplers }
  const out = writer(json)
  json.skins = [{ joints: base.json.skins[0].joints.map((j: number) => index.get(j)), inverseBindMatrices: out.accessor(base, base.json.skins[0].inverseBindMatrices) }]
  const rig = nodeNamed(json, 'Rig')
  json.scenes = [{ nodes: [rig] }]
  if (base.json.scenes[0].nodes.join() !== String(bones[rig])) throw new Error('the adventurers stand on a root other than Rig')

  const materials = new Map<string, number>()
  const materialOf = (src: Glb, i: number) => {
    const m = src.json.materials[i]
    if (!materials.has(m.name)) {
      const texture = src.json.textures[m.pbrMetallicRoughness.baseColorTexture.index]
      json.textures.push({ sampler: 0, source: out.image(src, texture.source) })
      json.materials.push({ ...m, pbrMetallicRoughness: { ...m.pbrMetallicRoughness, baseColorTexture: { index: json.textures.length - 1 } } })
      materials.set(m.name, json.materials.length - 1)
    }
    return materials.get(m.name)!
  }

  for (const name of ADVENTURER_PARTS) {
    const src = files.find((g) => g.json.nodes.some((n: Json) => n.name === name && n.mesh !== undefined))
    if (!src) throw new Error(`no adventurer holds ${name}`)
    const i = nodeNamed(src.json, name)
    const node = src.json.nodes[i]
    const mesh = src.json.meshes[node.mesh]
    json.meshes.push({
      name,
      primitives: mesh.primitives.map((p: Json) => ({
        ...p,
        attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, a]) => [k, out.accessor(src, a as number)])),
        indices: out.accessor(src, p.indices),
        material: materialOf(src, p.material),
      })),
    })
    const parent = nodeNamed(json, src.json.nodes[parentsOf(src.json).get(i)!].name)
    json.nodes.push({ name, mesh: json.meshes.length - 1, skin: node.skin === undefined ? undefined : 0, translation: node.translation, rotation: node.rotation, scale: node.scale })
    json.nodes[parent].children.push(json.nodes.length - 1)
  }
  json.nodes.forEach((n: Json) => n.children?.length === 0 && delete n.children)
  writeGlb(path.join(OUT, 'adventurers.glb'), json, out.bin())
}

/** The contract's clips from every Rig_Medium file, aimed at one copy of its bones. */
function packClips() {
  const files = readdirSync(animations).filter((f) => /^Rig_Medium_.*\.glb$/.test(f)).sort().map((f) => readGlb(path.join(animations, f)))
  const base = files[0]
  const bones = base.json.nodes.flatMap((n: Json, i: number) => (n.mesh === undefined ? [i] : []))
  const index = new Map<number, number>(bones.map((b: number, k: number) => [b, k]))
  const json: Json = {
    asset: { version: '2.0', generator: 'tower3d-characters' },
    scene: 0,
    nodes: bones.map((b: number) => {
      const n = base.json.nodes[b]
      return { ...n, children: n.children?.filter((c: number) => index.has(c)).map((c: number) => index.get(c)), mesh: undefined, skin: undefined }
    }),
    animations: [],
  }
  json.scenes = [{ nodes: base.json.scenes[0].nodes.filter((r: number) => index.has(r)).map((r: number) => index.get(r)) }]
  const out = writer(json)
  for (const name of CLIPS) {
    const src = files.find((g) => g.json.animations.some((a: Json) => a.name === name))
    if (!src) throw new Error(`no Rig_Medium file holds the clip ${name}`)
    const clip = src.json.animations.find((a: Json) => a.name === name)
    json.animations.push({
      name,
      samplers: clip.samplers.map((s: Json) => ({ ...s, input: out.accessor(src, s.input), output: out.accessor(src, s.output) })),
      channels: clip.channels.map((c: Json) => {
        const node = nodeNamed(json, src.json.nodes[c.target.node].name)
        if (node < 0) throw new Error(`${name} moves ${src.json.nodes[c.target.node].name}, which Rig_Medium lacks`)
        return { ...c, target: { ...c.target, node } }
      }),
    })
  }
  json.nodes.forEach((n: Json) => n.children?.length === 0 && delete n.children)
  writeGlb(path.join(OUT, 'rig_medium.glb'), json, out.bin())
}

const README = `# KayKit characters

What Tower 3D makes its workers of, by Kay Lousberg (www.kaylousberg.com, https://kaylousberg.itch.io/), both packs
CC0 (\`License-Adventurers.txt\`, \`License-Animations.txt\`):

- \`adventurers.glb\`: the parts of the KayKit Adventurers 1.0 the workers' looks use, on one Rig_Medium skeleton, in
  the four adventurers' atlases, without the clips each character file embeds.
- \`rig_medium.glb\`: the clips their poses play, from KayKit Character Animations 1.1, without its mannequin.

Both are packed from the packs' own files by \`tsx scripts/tower3d-characters.ts <adventurers> <animations>\`, which
takes the parts and clips \`renderers/tower3d/src/contract.ts\` names.
`

mkdirSync(OUT, { recursive: true })
packAdventurers()
packClips()
copyFileSync(path.join(adventurers, 'LICENSE.txt'), path.join(OUT, 'License-Adventurers.txt'))
writeFileSync(path.join(OUT, 'README.md'), README)
const size = (f: string) => `${(readFileSync(path.join(OUT, f)).length / 1024).toFixed(0)} KB`
console.log(`adventurers.glb ${size('adventurers.glb')} · rig_medium.glb ${size('rig_medium.glb')} → ${path.relative(REPO, OUT)}`)
