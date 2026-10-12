import { z } from 'zod'
import { ADVENTURERS, BODY_PARTS, BONES, SLOTS, type Adventurer, type Bone, type Slot } from './contract.ts'
import { rendezvous, roll } from './hashed.ts'

/**
 * The wardrobe: how workers are dressed, as one document (renderers/tower3d/wardrobe.json) over the catalogue of parts.
 * `fits` move, turn and scale a worn part over where it was made to sit, by default and per part worn with it;
 * `outfits` are named looks; `mix` is how a worker's session id is dressed: a bot or an adventurer, maybe an outfit,
 * and for everything an outfit leaves open, a roll per slot and the part of the slot's pool it scores highest for
 * (`rendezvous`), so a part, outfit, body or colour added re-dresses only the wearers it wins. Imports no three: Node reads it, and
 * Tower 3D and the dresser call the same functions.
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()])
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a #rrggbb colour')
const adventurer = z.enum(ADVENTURERS)
const build = z.object({ width: z.number(), height: z.number() })

export const Fit = z.object({
  at: vec3.optional().describe('added to the part made position, rig units in its bone space'),
  turn: vec3.optional().describe('degrees about the bone axes (XYZ), about the part own origin'),
  scale: z.union([z.number(), vec3]).optional().describe('times the part made scale, along its own axes'),
})

export const Rule = z.object({
  chance: z.number().min(0).max(1).describe('of wearing something in the slot'),
  group: z.string().optional().describe('slots of one group share a roll, stacked in SLOTS order: at most one of them is worn'),
  seed: z.string().optional().describe('what the roll (without a group) and the choice hash under; the slot in lowercase by default. Changing it re-dresses the slot'),
  pool: z.array(z.string()).optional().describe('only these parts; every part of the slot by default'),
  except: z.array(z.string()).optional().describe('never these parts'),
  unless: z.array(z.string()).optional().describe('the slot stays bare on a look that, as rolled, wears any of these'),
})

export const Outfit = z.object({
  body: adventurer.optional(),
  paint: adventurer.optional().describe('the atlas its body is painted in'),
  skin: colour.optional(),
  hair: colour.optional(),
  wear: colour.optional().describe('the colour of what it wears painted `wear_own`'),
  build: build.optional(),
  slots: z.partialRecord(z.enum(SLOTS), z.string().nullable()).optional().describe('a part, or null for bare; a slot left out is hashed from the mix'),
})

const slotRules = z.partialRecord(z.enum(SLOTS), Rule)

export const Mix = z.object({
  bot: z.object({ share: z.number().min(0).max(1), slots: slotRules }),
  outfits: z.object({ share: z.number().min(0).max(1), except: z.array(z.string()).optional().describe('outfits only worn by name') }),
  bodies: z.array(adventurer).min(1),
  repaint: z.number().min(0).max(1).describe('the chance a body is painted in another body atlas'),
  skins: z.array(colour).min(1),
  hairs: z.array(colour).min(1),
  wears: z.array(colour).min(1),
  build: z.object({ width: z.tuple([z.number(), z.number()]), height: z.tuple([z.number(), z.number()]) }).describe('the range of each, a roll over it'),
  slots: slotRules.describe('Head: the chance of a head other than the body own'),
})

export const Wardrobe = z.object({
  fits: z.record(z.string(), z.record(z.string(), Fit)).describe('fits[part]["*"], or fits[part][a part worn with it, or "bot"]'),
  outfits: z.record(z.string(), Outfit),
  mix: Mix,
})

export type Vec3 = z.infer<typeof vec3>
export type Fit = z.infer<typeof Fit>
export type Rule = z.infer<typeof Rule>
export type Outfit = z.infer<typeof Outfit>
export type Mix = z.infer<typeof Mix>
export type Wardrobe = z.infer<typeof Wardrobe>
export type Build = z.infer<typeof build>

/** Where a rigid part sits in its bone's space, as three composes it: position, then rotation, then scale. */
export type Placement = { at: Vec3; quaternion: [number, number, number, number]; scale: Vec3 }

/**
 * A part as the files hold it (catalogue.ts derives it at load). Skinned parts ride the rig's skin; rigid ones hang on
 * a bone at their made placement, or, the pieces of models/wear.py, at an anchor of the wearer's head (`anchors`).
 */
export type CataloguePart = {
  name: string
  slot: Slot | 'Body'
  from: 'adventurers' | 'parts' | 'wear'
  /** Painted in an adventurer's atlas, or in its own materials (`wear_own` in the worker's wear colour). */
  atlas?: Adventurer
  attach: { skinned: true } | { bone: Bone; made: Placement } | { bone: 'head'; anchor: Anchor }
}
export type Anchor = 'hat' | 'face'
export type Catalogue = {
  parts: Record<string, CataloguePart>
  /** Each slot's parts, in the order the files hold them. */
  slots: Record<Slot, string[]>
  /** Where each kind of wearer has its hat and face anchors, on the head bone. */
  anchors: Record<Look['species'], Record<Anchor, Placement>>
}

/** A look: what a worker wears. `parts` are the slot parts worn, in `SLOTS` order; an adventurer's body parts follow from `body` and `paint`. */
export type Look =
  | { species: 'adventurer'; outfit?: string; body: Adventurer; paint: Adventurer; parts: string[]; skin: string; hair: string; wear: string; build: Build }
  | { species: 'bot'; hue: string; parts: string[]; wear: string; build: Build }

export const bodyParts = (body: Adventurer) => BODY_PARTS.map((p) => `${body}_${p}`)

/** A worker's own hue in degrees, hashed from its session id: who it is. */
export const hueOf = (id: string) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}
/** A colour as #rrggbb from its hue (degrees), saturation and lightness taken in linear light, as three's `setHSL` takes them. */
const hex = (h: number, s: number, l: number) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    const srgb = c < 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, srgb)) * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const seedOf = (slot: Slot, rule: Rule) => rule.seed ?? slot.toLowerCase()

/**
 * The slot parts `id` wears by `rules`: each slot's roll (its group's, shared and stacked in `SLOTS` order) against its
 * chance, then its pool's part; then any slot whose `unless` names a part worn is left bare. `fixed` slots (an
 * outfit's) take its part or stay bare, untouched by the rules; `wearing` is worn besides (the body).
 */
function rolled(id: string, rules: Partial<Record<Slot, Rule>>, c: Catalogue, fixed: Partial<Record<Slot, string | null>>, wearing: string[]) {
  const stacked = new Map<string, number>()
  const worn = new Map<Slot, string>()
  const hashed = new Set<Slot>()
  for (const slot of SLOTS) {
    if (slot in fixed) {
      if (fixed[slot]) worn.set(slot, fixed[slot])
      continue
    }
    const rule = rules[slot]
    if (!rule) continue
    const seed = seedOf(slot, rule)
    const from = rule.group === undefined ? 0 : (stacked.get(rule.group) ?? 0)
    if (rule.group !== undefined) stacked.set(rule.group, from + rule.chance)
    const pool = (rule.pool ?? c.slots[slot]).filter((p) => !rule.except?.includes(p))
    if (!pool.length) continue
    const r = roll(id, rule.group ?? seed)
    if (r < from || r >= from + rule.chance) continue
    worn.set(slot, rendezvous(id, seed, pool))
    hashed.add(slot)
  }
  const all = new Set([...wearing, ...worn.values()])
  for (const slot of hashed) if (rules[slot]!.unless?.some((p) => all.has(p))) worn.delete(slot)
  return worn
}

const within = ([lo, hi]: [number, number], r: number) => lo + r * (hi - lo)

/** A look for `id` in `outfit`, or from the mix alone: whatever the outfit leaves open is hashed. */
function dressed(id: string, outfit: Outfit, name: string | undefined, w: Wardrobe, c: Catalogue): Look {
  const { mix } = w
  const r = (what: string) => roll(id, what)
  const body = outfit.body ?? rendezvous(id, 'body', mix.bodies)
  const paint = outfit.paint ?? (r('repaint') < mix.repaint ? rendezvous(id, 'paint', mix.bodies) : body)
  const slots = rolled(id, mix.slots, c, outfit.slots ?? {}, bodyParts(body))
  if (!slots.has('Head') && !(outfit.slots && 'Head' in outfit.slots)) slots.set('Head', `${body}_Head`)
  return {
    species: 'adventurer',
    ...(name !== undefined && { outfit: name }),
    body,
    paint,
    parts: SLOTS.flatMap((s) => (slots.has(s) ? [slots.get(s)!] : [])),
    skin: outfit.skin ?? rendezvous(id, 'skin', mix.skins),
    hair: outfit.hair ?? rendezvous(id, 'hair', mix.hairs),
    wear: outfit.wear ?? rendezvous(id, 'wear', mix.wears),
    build: outfit.build ?? { width: within(mix.build.width, r('width')), height: within(mix.build.height, r('height')) },
  }
}

/**
 * A worker's look, hashed from its session id: the same on every board and every reload. A bot by the mix's share,
 * wearing what its slots roll; else an adventurer, in an outfit by the outfits' share (the one of those not kept
 * `except` that scores highest for it), with everything the outfit leaves open hashed from the mix.
 */
export function lookOf(id: string, w: Wardrobe, c: Catalogue): Look {
  const { mix } = w
  if (roll(id, 'species') < mix.bot.share) {
    const parts = rolled(id, mix.bot.slots, c, {}, [])
    return {
      species: 'bot',
      hue: hex(hueOf(id), 0.55, 0.62),
      parts: SLOTS.flatMap((s) => (parts.has(s) ? [parts.get(s)!] : [])),
      wear: rendezvous(id, 'wear', mix.wears),
      build: { width: within(mix.build.width, roll(id, 'width')), height: within(mix.build.height, roll(id, 'height')) },
    }
  }
  const names = Object.keys(w.outfits).filter((n) => !mix.outfits.except?.includes(n))
  const name = names.length && roll(id, 'outfit') < mix.outfits.share ? rendezvous(id, 'outfit', names) : undefined
  return dressed(id, name === undefined ? {} : w.outfits[name], name, w, c)
}

/** A named outfit's look: what it leaves open hashed from its name. */
export const lookNamed = (name: string, w: Wardrobe, c: Catalogue): Look => dressed(name, w.outfits[name], name, w, c)

/** Every part a look wears, its body parts included, and `bot` on a bot: what a fit's override may be keyed by. */
export const wornBy = (look: Look) => (look.species === 'bot' ? ['bot', ...look.parts] : [...bodyParts(look.body), ...look.parts])

/**
 * Whose override of a part's fit wins, by the slot of the part it is keyed by: a look wears one part per slot, so at
 * most one override per slot matches. The first in this list wins each field it sets, then the next, then `*`.
 */
export const FIT_PRECEDENCE = ['bot', 'Head', 'Outfit', 'Body', 'Helm', 'Hat', 'Face', 'Cape', 'Prop', 'Gear'] as const

const precedenceOf = (key: string, c: Catalogue) => FIT_PRECEDENCE.indexOf(key === 'bot' ? 'bot' : c.parts[key].slot)

type Field = keyof Fit

/**
 * The fit of `part` on a look wearing `worn` (`wornBy`): its `*`, under the overrides keyed by what it is worn with,
 * and where each field comes from (`*`, or the part, or `bot`, whose override set it).
 */
export function fitFrom(w: Wardrobe, c: Catalogue, part: string, worn: readonly string[]): { fit: Fit; from: Partial<Record<Field, string>> } {
  const fits = w.fits[part] ?? {}
  const keys = Object.keys(fits)
    .filter((k) => k === '*' || (k !== part && worn.includes(k)))
    .sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : precedenceOf(b, c) - precedenceOf(a, c)))
  const fit: Fit = {}
  const from: Partial<Record<Field, string>> = {}
  for (const k of keys) for (const f of Object.keys(fits[k]) as Field[]) if (fits[k][f] !== undefined) Object.assign(fit, { [f]: fits[k][f] }), (from[f] = k)
  return { fit, from }
}

export const fitOf = (w: Wardrobe, c: Catalogue, part: string, worn: readonly string[]) => fitFrom(w, c, part, worn).fit

/** The outfits Tower 3D dresses by name, the roof's bartender and DJ: locked in the dresser, and kept out of the mix. */
export const STAFF = ['bartender', 'dj'] as const
export type Staff = (typeof STAFF)[number]

/**
 * The wardrobe's problems against the catalogue, each at its path: an outfit Tower 3D dresses by name missing or in the
 * mix, names it holds that no part has, and fits it cannot apply.
 */
export function problems(w: Wardrobe, c: Catalogue): string[] {
  const out: string[] = []
  for (const n of STAFF) {
    if (!(n in w.outfits)) out.push(`outfits/${n}: Tower 3D dresses the ${n} by name`)
    else if (!w.mix.outfits.except?.includes(n)) out.push(`mix/outfits/except: the ${n} is worn only by name`)
  }
  const known = (name: string, at: string) => name in c.parts || out.push(`${at}: no part ${name}`)
  for (const [part, fits] of Object.entries(w.fits)) {
    if (!known(part, `fits/${part}`)) continue
    if ('skinned' in c.parts[part].attach) out.push(`fits/${part}: ${part} is skinned; fits move rigid parts`)
    for (const key of Object.keys(fits)) if (key !== '*' && key !== 'bot') known(key, `fits/${part}/${key}`)
  }
  for (const [name, o] of Object.entries(w.outfits)) {
    for (const [slot, part] of Object.entries(o.slots ?? {})) {
      if (part && known(part, `outfits/${name}/slots/${slot}`) && c.parts[part].slot !== slot) out.push(`outfits/${name}/slots/${slot}: ${part} is a ${c.parts[part].slot} part`)
    }
  }
  for (const n of w.mix.outfits.except ?? []) if (!(n in w.outfits)) out.push(`mix/outfits/except: no outfit ${n}`)
  for (const [where, rules] of [['mix/bot/slots', w.mix.bot.slots], ['mix/slots', w.mix.slots]] as const) {
    for (const [slot, rule] of Object.entries(rules)) {
      for (const field of ['pool', 'except', 'unless'] as const) for (const p of rule[field] ?? []) known(p, `${where}/${slot}/${field}`)
    }
  }
  return out
}

/** A wardrobe's errors as one message per problem, each with its path in the document. */
export function parseWardrobe(json: unknown, name: string): Wardrobe {
  const r = Wardrobe.safeParse(json)
  if (r.success) return r.data
  throw new Error(`${name} is not a wardrobe:\n${r.error.issues.map((i) => `  ${i.path.join('/') || '(root)'}: ${i.message}`).join('\n')}`)
}

const ordered = <T extends object>(o: T, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((k) => k in o && (o as Record<string, unknown>)[k] !== undefined).map((k) => [k, (o as Record<string, unknown>)[k]]))
const sortedKeys = (o: object, first: string[] = []) => [...first.filter((k) => k in o), ...Object.keys(o).filter((k) => !first.includes(k)).sort()]
const RULE_KEYS = Object.keys(Rule.shape)
const rulesOrdered = (rules: Partial<Record<Slot, Rule>>) => Object.fromEntries(SLOTS.filter((s) => rules[s]).map((s) => [s, ordered(rules[s]!, RULE_KEYS)]))

/**
 * The wardrobe as its file holds it: keys in a fixed order (fits and outfits by name, `*` first; everything else as the
 * schema lists it), two spaces, a list of numbers or names on one line. Saving through it keeps diffs to what changed.
 */
export function formatWardrobe(w: Wardrobe): string {
  const doc = {
    fits: Object.fromEntries(sortedKeys(w.fits).map((p) => [p, Object.fromEntries(sortedKeys(w.fits[p], ['*']).map((k) => [k, ordered(w.fits[p][k], Object.keys(Fit.shape))]))])),
    outfits: Object.fromEntries(
      sortedKeys(w.outfits).map((n) => {
        const o = w.outfits[n]
        return [n, { ...ordered(o, Object.keys(Outfit.shape)), ...(o.slots && { slots: ordered(o.slots, SLOTS) }) }]
      }),
    ),
    mix: { ...ordered(w.mix, Object.keys(Mix.shape)), bot: { share: w.mix.bot.share, slots: rulesOrdered(w.mix.bot.slots) }, slots: rulesOrdered(w.mix.slots) },
  }
  doc.mix = ordered(doc.mix, Object.keys(Mix.shape)) as typeof doc.mix
  return `${JSON.stringify(doc, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner: string) => `[${inner.split(/,\s+/).join(', ')}]`)}\n`
}

export const isBone = (name: string): name is Bone => (BONES as readonly string[]).includes(name)
