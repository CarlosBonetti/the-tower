import { box, geometry, mesh, noBottom, place, poly, prism, rng, vertices, type Mesh, type Paint, type Skip, type V } from './geo.ts'

/**
 * The city's buildings, generated at load from their sites and a seed: up to three tiers set back one over another,
 * each a chamfered core with windows between fins on every side, a band at every floor, a cornice and a parapet,
 * and roof plant on the top tier. One mesh per material for the whole city. A building leaves out the detail too thin
 * to span a pixel from the nearest a viewer comes to it (`finest`), a fin by its sides, half its width proud of the
 * face: drawn thinner, it blinks as the view moves.
 */

export type Site = { i: number; x: number; z: number; w: number; h: number }
export type Layer = 'stone' | 'trim' | 'glass' | 'warm' | 'cool'
type Paints = Record<Layer | 'shadow', Paint>
export const LAYERS: Layer[] = ['stone', 'trim', 'glass', 'warm', 'cool']

type Spec = { width: number; depth: number; height: number; floor: number; bay: number; fin: number; band: number; tiers: number; setback: number; pane: number; lit: number; cool: number; clutter: number; finest: number }

/** One pixel's width at a metre: the walking camera's 70° field of view on a canvas 800 px tall. */
const PIXEL = (2 * Math.tan((35 * Math.PI) / 180)) / 800
/** The farthest a viewer stands from the tower's centre: half its floor plate's width, at the glass. */
const VIEWER = 20
/** The thinnest detail that still spans a pixel on a site, from the nearest a viewer comes to it. */
const finest = (site: Site) => (Math.hypot(site.x, site.z) - VIEWER) * PIXEL

/** How tall a band is. */
const BAND = 0.22

const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)

/** What a site's building is like, all of it from the site's seed. */
function specOf(site: Site, r: () => number): Spec {
  const tiers = site.h < 30 ? 1 : site.h < 55 ? pick(r, [1, 2, 2]) : pick(r, [2, 3, 3])
  return {
    width: site.w,
    depth: site.w * between(r, 0.7, 1),
    height: site.h,
    floor: pick(r, [3.5, 3.5, 4]),
    bay: pick(r, [2, 2.4, 2.8, 3.2, 3.6]),
    fin: r() < 0.75 ? between(r, 0.25, 0.5) : 0,
    band: between(r, 0.1, 0.3),
    tiers,
    setback: between(r, 0.14, 0.28),
    pane: between(r, 0.42, 0.62),
    lit: between(r, 0.15, 0.28),
    cool: 0.4,
    clutter: between(r, 0.5, 1),
    finest: finest(site),
  }
}

/** Light baked into the colours: darker towards the ground, under overhangs, brighter on what faces the sky. */
function shade(p: V, n: V) {
  const ground = 0.68 + 0.32 * Math.min(1, Math.max(0, p[1] / 14))
  return ground * (n[1] > 0.5 ? 1.08 : n[1] < -0.5 ? 0.62 : 0.88)
}

const flat = (tint: V): Paint => ({ tint, shade, lift: 1.18 })

const SIDES: { out: V; along: V }[] = [
  { out: [0, 0, 1], along: [1, 0, 0] },
  { out: [0, 0, -1], along: [-1, 0, 0] },
  { out: [1, 0, 0], along: [0, 0, -1] },
  { out: [-1, 0, 0], along: [0, 0, 1] },
]

type Layers = Record<Layer, Mesh>

/** One tier: from y0, `h` tall, w × d. */
function tier(L: Layers, paint: Paints, spec: Spec, w: number, d: number, y0: number, h: number, r: () => number) {
  box(L.stone, [0, y0 + h / 2, 0], [w, h, d], paint.stone, 0.12, noBottom)
  const floors = Math.max(1, Math.round(h / spec.floor))
  const level = h / floors
  for (const { out, along } of SIDES) {
    const span = out[0] ? d : w
    const dist = (out[0] ? w : d) / 2
    const bays = Math.max(1, Math.floor(span / spec.bay))
    const bw = span / bays
    const point = (u: number, y: number, off: number): V => [along[0] * u + out[0] * (dist + off), y, along[2] * u + out[2] * (dist + off)]
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const [u, y] = [-span / 2 + bw * (b + 0.5), y0 + level * (f + 0.56)]
        const [hu, hy] = [(bw * spec.pane) / 2, (level * spec.pane * 0.9) / 2]
        const roll = r()
        const layer = roll < spec.lit ? 'warm' : roll < spec.lit * (1 + spec.cool) ? 'cool' : 'glass'
        poly(L[layer], [point(u - hu, y - hy, 0.03), point(u + hu, y - hy, 0.03), point(u + hu, y + hy, 0.03), point(u - hu, y + hy, 0.03)], out, paint[layer])
      }
    }
    if (spec.fin / 2 >= spec.finest) {
      const skip: Skip = (o) => o[1] !== 0 || o[0] * out[0] + o[2] * out[2] < 0
      for (let b = 1; b < bays; b++) {
        const c = point(-span / 2 + b * bw, y0 + h / 2, 0)
        box(L.trim, c, [spec.fin, h, spec.fin], paint.trim, 0, skip)
      }
    }
  }
  const ring = spec.band * 2
  for (let f = 1; f < floors && BAND >= spec.finest; f++) {
    box(L.trim, [0, y0 + f * level, 0], [w + ring, BAND, d + ring], paint.trim)
    under(L.stone, paint.shadow, w, d, y0 + f * level - BAND / 2)
  }
  const top = y0 + h
  box(L.trim, [0, top + 0.35, 0], [w + 0.7, 0.55, d + 0.7], paint.trim, 0.1)
  for (const { out } of SIDES) {
    const len = (out[0] ? d : w) + 0.7
    const c: V = [out[0] * (w / 2 + 0.2), top + 1.05, out[2] * (d / 2 + 0.2)]
    box(L.trim, c, out[0] ? [0.3, 0.9, len] : [len, 0.9, 0.3], paint.trim, 0, noBottom)
  }
}

/** A strip of the band's shadow on the core just under a band at y, a painted stand-in for occlusion. */
function under(m: Mesh, paint: Paint, w: number, d: number, y: number) {
  for (const { out, along } of SIDES) {
    const [span, dist] = out[0] ? [d, w / 2 + 0.01] : [w, d / 2 + 0.01]
    const at = (u: number, v: number): V => [along[0] * u + out[0] * dist, v, along[2] * u + out[2] * dist]
    poly(m, [at(-span / 2, y - 0.45), at(span / 2, y - 0.45), at(span / 2, y), at(-span / 2, y)], out, paint)
  }
}

type Piece = (L: Layers, paint: Paints, at: V, r: () => number) => void

/** Roof plant, each standing on `at`. */
export const PIECES: Record<string, Piece> = {
  ac(L, paint, [x, y, z]) {
    box(L.trim, [x, y + 0.6, z], [2.2, 1.2, 1.4], paint.trim, 0.12, noBottom)
    prism(L.glass, [x + 0.45, y + 1.2, z], 0.45, 0.04, 8, paint.glass)
  },
  vent(L, paint, [x, y, z]) {
    box(L.trim, [x, y + 0.45, z], [0.7, 0.9, 0.7], paint.trim, 0.06, noBottom)
    prism(L.trim, [x, y + 0.9, z], 0.6, 0.35, 4, paint.trim, 0)
  },
  tank(L, paint, [x, y, z]) {
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) box(L.trim, [x + lx, y + 0.8, z + lz], [0.2, 1.6, 0.2], paint.trim, 0, noBottom)
    prism(L.trim, [x, y + 1.6, z], 1.3, 2.4, 10, paint.trim)
    prism(L.trim, [x, y + 4, z], 1.45, 0.7, 10, paint.trim, 0)
  },
  hut(L, paint, [x, y, z]) {
    box(L.stone, [x, y + 1.3, z], [3, 2.6, 2.4], paint.stone, 0.12, noBottom)
    poly(L.glass, [[x - 0.45, y, z + 1.22], [x + 0.45, y, z + 1.22], [x + 0.45, y + 1.9, z + 1.22], [x - 0.45, y + 1.9, z + 1.22]], [0, 0, 1], paint.glass)
  },
  antenna(L, paint, [x, y, z]) {
    box(L.trim, [x, y + 0.2, z], [0.8, 0.4, 0.8], paint.trim, 0.05, noBottom)
    prism(L.trim, [x, y + 0.4, z], 0.09, 6.6, 6, paint.trim)
  },
}

const POOL = ['ac', 'ac', 'vent', 'vent', 'tank', 'hut', 'antenna']
/** Each piece's thinnest part: a tank's legs, an antenna's mast. */
const THINNEST: Record<string, number> = { ac: 0.9, vent: 0.7, tank: 0.2, hut: 0.9, antenna: 0.18 }

function clutter(L: Layers, paint: Paints, spec: Spec, w: number, d: number, top: number, r: () => number) {
  const want = Math.min(7, Math.round(spec.clutter * (w - 3) * (d - 3) * 0.035))
  const spots: [number, number][] = []
  for (let tries = 0; tries < 40 && spots.length < want; tries++) {
    const [x, z] = [between(r, -(w - 4) / 2, (w - 4) / 2), between(r, -(d - 4) / 2, (d - 4) / 2)]
    if (spots.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > 3.2)) spots.push([x, z])
  }
  const pool = POOL.filter((piece) => THINNEST[piece] >= spec.finest)
  for (const [x, z] of spots) PIECES[pick(r, pool)](L, paint, [x, top, z], r)
}

/** A building on a site's origin. */
function building(L: Layers, site: Site) {
  const r = rng(site.i * 7919 + 17)
  const spec = specOf(site, r)
  const hue = between(r, -0.04, 0.04)
  const stone: V = [1 + hue, 1, 1 - hue]
  const paint: Paints = { stone: flat(stone), shadow: flat([stone[0] * 0.72, stone[1] * 0.72, stone[2] * 0.72]), trim: flat([1.22, 1.22, 1.22]), glass: flat([1, 1, 1]), warm: flat([1, 1, 1]), cool: flat([1, 1, 1]) }
  const shares = [[1], [0.62, 0.38], [0.5, 0.3, 0.2]][spec.tiers - 1]
  let [y, w, d] = [0, spec.width, spec.depth]
  for (const [k, share] of shares.entries()) {
    const h = Math.max(1, Math.round((spec.height * share) / spec.floor)) * spec.floor
    if (k) [w, d] = [w * (1 - spec.setback), d * (1 - spec.setback)]
    tier(L, paint, spec, w, d, y, h, r)
    y += h
  }
  clutter(L, paint, spec, w, d, y + 0.6, r)
  return { y, w, d }
}

/**
 * Every site's building, turned a quarter at a time and placed: one geometry per layer, and each building's top tier
 * (where its roof is, its size and its turn).
 */
export function skyline(sites: Site[]) {
  const L = Object.fromEntries(LAYERS.map((k) => [k, mesh()])) as Layers
  const tops = sites.map((site) => {
    const from = Object.fromEntries(LAYERS.map((k) => [k, vertices(L[k])])) as Record<Layer, number>
    const top = building(L, site)
    const turn = ((site.i * 7) % 4) * (Math.PI / 2)
    for (const k of LAYERS) place(L[k], from[k], turn, [site.x, 0, site.z])
    return { ...top, x: site.x, z: site.z, turn }
  })
  return { geometries: Object.fromEntries(LAYERS.map((k) => [k, geometry(L[k])])) as Record<Layer, ReturnType<typeof geometry>>, tops }
}
