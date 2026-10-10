import { box, geometry, mesh, type Mesh, type Paint, type V } from './geo.ts'

/**
 * The tower's shell built to its plan: capped mullions every `pane` and chamfered corner posts round a level, the
 * spandrel round a slab as panels split by chamfered seams over a drip lip, and the roof's parapet as panels under a
 * coping. Each returns geometry in its level's frame; the caller paints it.
 */

export type Plan = { width: number; depth: number }

const shade = (_: V, n: V) => (n[1] > 0.5 ? 1.08 : n[1] < -0.5 ? 0.7 : 1)
const PAINT: Paint = { tint: [1, 1, 1], shade, lift: 1.25 }
const SEAM = 0.035

type Side = { c: V; out: V; along: V; len: number }
const sidesOf = (p: Plan): Side[] => [
  { c: [0, 0, p.depth / 2], out: [0, 0, 1], along: [1, 0, 0], len: p.width },
  { c: [0, 0, -p.depth / 2], out: [0, 0, -1], along: [-1, 0, 0], len: p.width },
  { c: [p.width / 2, 0, 0], out: [1, 0, 0], along: [0, 0, -1], len: p.depth },
  { c: [-p.width / 2, 0, 0], out: [-1, 0, 0], along: [0, 0, 1], len: p.depth },
]

/** A point on a side: `u` along it, `y` up, `o` out from its plane. */
const on = (s: Side, u: number, y: number, o: number): V => [s.c[0] + s.along[0] * u + s.out[0] * o, y, s.c[2] + s.along[2] * u + s.out[2] * o]

/** A box on a side: centred `u` along, `y` up, `o` out; sized along, up and out. */
function sideBox(m: Mesh, s: Side, u: number, y: number, o: number, along: number, up: number, out: number, r: number) {
  const size: V = s.out[0] ? [out, up, along] : [along, up, out]
  box(m, on(s, u, y, o), size, PAINT, r)
}

function posts(m: Mesh, p: Plan, y0: number, h: number) {
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(m, [(sx * p.width) / 2, y0 + h / 2, (sz * p.depth) / 2], [0.36, h, 0.36], PAINT, 0.05)
}

/** Mullions every `pane` along each side between the corner posts, `h` tall. */
export function frame(p: Plan, h: number, pane: number) {
  const m = mesh()
  for (const s of sidesOf(p)) {
    for (let k = 1; -s.len / 2 + k * pane < s.len / 2 - 0.2; k++) {
      const u = -s.len / 2 + k * pane
      sideBox(m, s, u, h / 2, -0.02, 0.07, h, 0.16, 0.012)
      sideBox(m, s, u, h / 2, 0.075, 0.15, h, 0.05, 0.015)
    }
  }
  posts(m, p, 0, h)
  return geometry(m)
}

/** Panels across each side, about `pane` wide each, split by seams, from y0 to y1, `depth` deep. */
function panels(m: Mesh, p: Plan, y0: number, y1: number, depth: number, pane: number) {
  for (const s of sidesOf(p)) {
    const n = Math.max(1, Math.round(s.len / (pane / 3)))
    const w = s.len / n
    for (let k = 0; k < n; k++) sideBox(m, s, -s.len / 2 + w * (k + 0.5), (y0 + y1) / 2, 0, w - SEAM, y1 - y0, depth, 0.03)
    sideBox(m, s, 0, (y0 + y1) / 2, -0.06, s.len, y1 - y0, 0.2, 0)
  }
}

/** The spandrel round a slab, from `-slab` to `top`: seamed panels over a drip lip, posts at the corners. */
export function spandrel(p: Plan, slab: number, top: number, pane: number) {
  const panel = mesh()
  panels(panel, p, -slab + 0.07, top, 0.3, pane)
  const trim = mesh()
  for (const s of sidesOf(p)) sideBox(trim, s, 0, -slab + 0.035, 0, s.len, 0.07, 0.34, 0.02)
  posts(trim, p, -slab, slab + top)
  return { panel: geometry(panel), trim: geometry(trim) }
}

/** The roof's parapet, `h` tall: seamed panels under an overhanging coping, posts at the corners. */
export function parapet(p: Plan, h: number, pane: number) {
  const panel = mesh()
  panels(panel, p, 0, h - 0.07, 0.3, pane)
  const trim = mesh()
  for (const s of sidesOf(p)) sideBox(trim, s, 0, h, 0, s.len + 0.44, 0.12, 0.44, 0.03)
  posts(trim, p, 0, h + 0.06)
  return { panel: geometry(panel), trim: geometry(trim) }
}
