/**
 * Vendors the KayKit characters Tower 3D makes its workers of into renderers/tower3d/kaykit/Characters, the GLBs the
 * bundle embeds:
 *
 *   adventurers.glb   every part the contract names (`ADVENTURER_PARTS` in renderers/tower3d/src/contract.ts) from
 *                     the KayKit Adventurers 1.0, on one skeleton: bodies, heads, helms, capes and gear, each in its
 *                     adventurer's atlas, without the clips each file embeds
 *   rig_medium.glb    the clips the contract names (`CLIPS`) from KayKit Character Animations 1.1, on Rig_Medium's
 *                     bones, without its mannequin
 *   medium.glb        the parts of the contract's other Rig_Medium characters (`KAYKIT`), skinned to adventurers.glb's
 *                     joints, with their atlases and colourways
 *   large.glb         the parts of its Rig_Large characters, on the first one's skeleton
 *   rig_large.glb     the clips of rig_medium.glb on that skeleton: rotations as they are, every translation moved
 *                     from Rig_Medium's rest to the large rest by the ratio of the hips' heights
 *
 *   tsx scripts/tower3d-characters.ts <adventurers> <animations> <skeletons> <series5>
 *
 * `<adventurers>` holds Knight.glb, Mage.glb, Rogue.glb, Rogue_Hooded.glb, Barbarian.glb and LICENSE.txt (the pack's
 * GitHub release); `<animations>` the Rig_Medium_*.glb of the animations pack (itch.io); `<skeletons>` the KayKit
 * Skeletons 1.1 folder, `<series5>` the KayKit Mystery Monthly Series 5 folder, each with its License.txt. Every pack
 * is CC0. Every character of a rig is skinned to the same joints, by name, with the same inverse binds (to 1e-5):
 * checked, since a part moves onto the rig's one skeleton.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ADVENTURER_PARTS, ATLAS_NAMES, CLIPS, COLOURWAYS, KAYKIT, bodyOf, textureOf, type Atlas, type RigKind } from '../renderers/tower3d/src/contract.ts'
import { readGlb, writeGlb, writer, type Glb, type Json } from './glb.ts'

const REPO = path.resolve(import.meta.dirname, '..')
const OUT = path.join(REPO, 'renderers/tower3d/kaykit/Characters')
const [adventurers, animations, skeletons, series5] = process.argv.slice(2).map((p) => path.resolve(p))
if (!series5) throw new Error('tsx scripts/tower3d-characters.ts <adventurers> <animations> <skeletons> <series5>')
const PACKS: Record<string, string> = { skeletons, series5 }

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

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]))
function fileNamed(dir: string, name: string) {
  const file = filesUnder(dir).find((f) => path.basename(f) === name)
  if (!file) throw new Error(`no ${name} under ${dir}`)
  return file
}

const SIZES: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }
function floatsOf(g: Glb, i: number) {
  const a = g.json.accessors[i]
  const at = g.bin.byteOffset + (g.json.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0)
  return new Float32Array(g.bin.buffer.slice(at, at + a.count * SIZES[a.type] * 4))
}
const bindsByName = (g: Glb) => {
  const all = floatsOf(g, g.json.skins[0].inverseBindMatrices)
  return new Map<string, Float32Array>(g.json.skins[0].joints.map((j: number, k: number) => [g.json.nodes[j].name, all.subarray(k * 16, k * 16 + 16)]))
}

/** A file's bones (its nodes without meshes), reindexed, its root named Rig, and the joints its skin binds by name. */
function bonesOf(g: Glb) {
  const bones: number[] = g.json.nodes.flatMap((n: Json, i: number) => (n.mesh === undefined ? [i] : []))
  const index = new Map<number, number>(bones.map((b, k) => [b, k]))
  const root = g.json.scenes[0].nodes.find((r: number) => index.has(r))
  const nodes = bones.map((b) => {
    const n = g.json.nodes[b]
    return { name: b === root ? 'Rig' : n.name, translation: n.translation, rotation: n.rotation, scale: n.scale, children: (n.children ?? []).filter((c: number) => index.has(c)).map((c: number) => index.get(c)) }
  })
  return { nodes, root: index.get(root)!, joints: g.json.skins[0].joints.map((j: number) => g.json.nodes[j].name) as string[] }
}

/** A skinned primitive's joint indices, from its file's skin to the packed one's (`remap`, by position in the file's). */
function remapped(out: ReturnType<typeof writer>, src: Glb, i: number, remap: number[]) {
  const a = src.json.accessors[i]
  const v = src.json.bufferViews[a.bufferView]
  const size = a.componentType === 5121 ? 1 : 2
  const at = (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const stride = v.byteStride ?? size * 4
  const bytes = Buffer.alloc(a.count * 4 * size)
  for (let n = 0; n < a.count; n++) {
    for (let k = 0; k < 4; k++) {
      const from = at + n * stride + k * size
      const j = remap[size === 1 ? src.bin.readUInt8(from) : src.bin.readUInt16LE(from)]
      if (size === 1) bytes.writeUInt8(j, n * 4 + k)
      else bytes.writeUInt16LE(j, (n * 4 + k) * 2)
    }
  }
  return out.data({ componentType: a.componentType, count: a.count, type: 'VEC4' }, bytes)
}

/**
 * The contract's KayKit characters on `rig`, from their packs' files, skinned to `base`'s skeleton by joint name: each
 * part a mesh of one material, a glowing primitive split off as `<part>_Glow`, painted in its character's atlas
 * (`<atlas>_texture`) or glowing (`<atlas>_glow`), with every colourway of those atlases beside them.
 */
function packKaykit(rig: RigKind, base: Glb, file: string) {
  const characters = (Object.keys(KAYKIT) as (keyof typeof KAYKIT)[]).filter((c) => KAYKIT[c].rig === rig)
  const skeleton = bonesOf(base)
  const json: Json = { asset: { version: '2.0', generator: 'tower3d-characters' }, scene: 0, scenes: [{ nodes: [skeleton.root] }], nodes: skeleton.nodes, meshes: [], materials: [], textures: [] }
  const out = writer(json)
  json.skins = [{ joints: skeleton.joints.map((n) => nodeNamed(json, n)), inverseBindMatrices: out.accessor(base, base.json.skins[0].inverseBindMatrices) }]
  const binds = bindsByName(base)
  const materials = new Map<string, number>()
  const materialNamed = (name: string, make: () => Json) => {
    if (!materials.has(name)) {
      json.materials.push({ ...make(), name })
      materials.set(name, json.materials.length - 1)
    }
    return materials.get(name)!
  }
  const painted = (image: number) => {
    json.textures.push({ sampler: 0, source: image })
    return { pbrMetallicRoughness: { baseColorTexture: { index: json.textures.length - 1 }, metallicFactor: 0, roughnessFactor: 0.5 } }
  }
  for (const c of characters) {
    const k = KAYKIT[c]
    const src = readGlb(fileNamed(PACKS[k.pack], `${c}.glb`))
    json.samplers ??= src.json.samplers
    for (const [joint, m] of bindsByName(src)) {
      const ours = binds.get(joint)
      if (!ours) throw new Error(`${c} is skinned to ${joint}, which the ${rig} skeleton lacks`)
      if (m.some((x, i) => Math.abs(x - ours[i]) > 1e-5)) throw new Error(`${c} is bound to ${joint} in another pose than the ${rig} skeleton`)
    }
    const remap = src.json.skins[0].joints.map((j: number) => skeleton.joints.indexOf(src.json.nodes[j].name))
    const parents = parentsOf(src.json)
    const wanted = new Set<string>([...bodyOf(c).parts, ...k.head, ...Object.values(k.slots as Record<string, readonly string[]>).flat()])
    for (const [i, node] of src.json.nodes.entries() as IterableIterator<[number, Json]>) {
      if (node.mesh === undefined || !wanted.has(node.name)) continue
      src.json.meshes[node.mesh].primitives.forEach((p: Json, n: number) => {
        const m = src.json.materials[p.material]
        const glow = m.name === 'Glow'
        if (n > 0 && !glow) throw new Error(`${node.name} has a second primitive that does not glow`)
        const name = n === 0 ? node.name : `${node.name}_Glow`
        const material = glow
          ? materialNamed(`${k.atlas.toLowerCase()}_glow`, () => ({ emissiveFactor: m.emissiveFactor, pbrMetallicRoughness: { baseColorFactor: [0, 0, 0, 1] } }))
          : materialNamed(textureOf(k.atlas), () => painted(out.image(src, src.json.textures[m.pbrMetallicRoughness.baseColorTexture.index].source)))
        const attributes = Object.fromEntries(Object.entries(p.attributes).map(([a, at]) => [a, a === 'JOINTS_0' ? remapped(out, src, at as number, remap) : out.accessor(src, at as number)]))
        json.meshes.push({ name, primitives: [{ attributes, indices: out.accessor(src, p.indices), material, mode: p.mode }] })
        const parent = node.skin === undefined ? nodeNamed(json, src.json.nodes[parents.get(i)!].name) : skeleton.root
        json.nodes.push({ name, mesh: json.meshes.length - 1, skin: node.skin === undefined ? undefined : 0, translation: node.translation, rotation: node.rotation, scale: node.scale })
        json.nodes[parent].children.push(json.nodes.length - 1)
        wanted.delete(name)
      })
    }
    if (wanted.size) throw new Error(`${c}.glb lacks ${[...wanted].join(', ')}`)
  }
  for (const atlas of ATLAS_NAMES) {
    const of = COLOURWAYS[atlas]
    if (!of || !materials.has(textureOf(of))) continue
    const pack = PACKS[Object.values(KAYKIT).find((k) => k.atlas === of)!.pack]
    const png = readFileSync(fileNamed(pack, `${textureOf(of)}${atlas.slice(of.length).toLowerCase()}.png`))
    materialNamed(textureOf(atlas as Atlas), () => painted(out.png(textureOf(atlas as Atlas), png)))
  }
  json.nodes.forEach((n: Json) => n.children?.length === 0 && delete n.children)
  writeGlb(path.join(OUT, file), json, out.bin())
}

/**
 * rig_medium.glb's clips on `base`'s skeleton: each bone's rotations and scales as they are, its translations moved
 * from Rig_Medium's rest to `base`'s by the ratio of the hips' heights, so a pose keeps its shape and its reach grows
 * with the body. Channels on bones `base` lacks (Rig_Medium's IK controls) are left out.
 */
function packLargeClips(base: Glb) {
  const medium = readGlb(path.join(OUT, 'rig_medium.glb'))
  const skeleton = bonesOf(base)
  const json: Json = { asset: { version: '2.0', generator: 'tower3d-characters' }, scene: 0, scenes: [{ nodes: [skeleton.root] }], nodes: skeleton.nodes, animations: [] }
  const out = writer(json)
  const restIn = (nodes: Json[], name: string): number[] => nodes.find((n) => n.name === name)?.translation ?? [0, 0, 0]
  const s = restIn(skeleton.nodes, 'hips')[1] / restIn(medium.json.nodes, 'hips')[1]
  for (const clip of medium.json.animations) {
    const samplers: Json[] = []
    const channels: Json[] = []
    for (const c of clip.channels) {
      const bone = medium.json.nodes[c.target.node].name
      const node = skeleton.nodes.findIndex((n) => n.name === bone && n.name !== 'Rig')
      if (node < 0) continue
      const sampler = clip.samplers[c.sampler]
      if (sampler.interpolation !== 'LINEAR') throw new Error(`${clip.name} interpolates ${bone} ${sampler.interpolation}ly`)
      const moved = () => {
        const from = restIn(medium.json.nodes, bone)
        const to = restIn(skeleton.nodes, bone)
        const v = floatsOf(medium, sampler.output).map((x, i) => to[i % 3] + (x - from[i % 3]) * s)
        return out.data({ componentType: 5126, count: v.length / 3, type: 'VEC3' }, Buffer.from(v.buffer))
      }
      const output = c.target.path === 'translation' ? moved() : out.accessor(medium, sampler.output)
      samplers.push({ input: out.accessor(medium, sampler.input), output, interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node, path: c.target.path } })
    }
    json.animations.push({ name: clip.name, samplers, channels })
  }
  json.nodes.forEach((n: Json) => n.children?.length === 0 && delete n.children)
  writeGlb(path.join(OUT, 'rig_large.glb'), json, out.bin())
}

const README = `# KayKit characters

What Tower 3D makes its workers of, by Kay Lousberg (www.kaylousberg.com, https://kaylousberg.itch.io/). Every pack is
CC0, its licence beside the files packed from it:

- \`adventurers.glb\`: the parts of the KayKit Adventurers 1.0 the workers' looks use, on one Rig_Medium skeleton, in
  the four adventurers' atlases, without the clips each character file embeds (\`License-Adventurers.txt\`).
- \`rig_medium.glb\`: the clips their poses play, from KayKit Character Animations 1.1, without its mannequin
  (\`License-Animations.txt\`).
- \`medium.glb\`: the Rig_Medium characters of KayKit Skeletons 1.1 (\`License-Skeletons.txt\`) and of the KayKit
  Mystery Monthly Series 5 (the Helpers and the Combat Mech, \`License-Series5.txt\`), skinned to adventurers.glb's
  joints, with their atlases and colourways.
- \`large.glb\`: the Series 5's Clanker on his Rig_Large skeleton, with his atlas and its colourway.
- \`rig_large.glb\`: rig_medium.glb's clips on that skeleton, retargeted by the packer.

Only the parts Tower 3D uses are packed, never a whole pack. All are packed from the packs' own files by
\`tsx scripts/tower3d-characters.ts <adventurers> <animations> <skeletons> <series5>\`, which takes the parts and clips
\`renderers/tower3d/src/contract.ts\` names.
`

mkdirSync(OUT, { recursive: true })
packAdventurers()
packClips()
packKaykit('medium', readGlb(path.join(OUT, 'adventurers.glb')), 'medium.glb')
const large = readGlb(fileNamed(series5, `${(Object.keys(KAYKIT) as (keyof typeof KAYKIT)[]).find((c) => KAYKIT[c].rig === 'large')}.glb`))
packKaykit('large', large, 'large.glb')
packLargeClips(large)
copyFileSync(path.join(adventurers, 'LICENSE.txt'), path.join(OUT, 'License-Adventurers.txt'))
copyFileSync(path.join(skeletons, 'License.txt'), path.join(OUT, 'License-Skeletons.txt'))
copyFileSync(path.join(series5, 'License.txt'), path.join(OUT, 'License-Series5.txt'))
writeFileSync(path.join(OUT, 'README.md'), README)
const size = (f: string) => `${f} ${(readFileSync(path.join(OUT, f)).length / 1024).toFixed(0)} KB`
console.log(`${['adventurers.glb', 'rig_medium.glb', 'medium.glb', 'large.glb', 'rig_large.glb'].map(size).join(' · ')} → ${path.relative(REPO, OUT)}`)
