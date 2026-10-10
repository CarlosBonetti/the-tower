import * as THREE from 'three'

/**
 * Geometry as plain data, built by pure functions and turned into a BufferGeometry once. A `Mesh` collects positions,
 * vertex colours and triangle indices; every shape appends to one. Colours carry the light the kit bakes: a tint,
 * times `shade` (sky and contact occlusion from a vertex's height and facing), times `lift` on chamfer facets.
 * No vertex is shared between polygons, so the normals computed from them are each polygon's own: flat shading.
 */

export type V = [number, number, number]
export type Mesh = { pos: number[]; col: number[]; idx: number[] }
export type Paint = { tint: V; shade: (p: V, n: V) => number; lift: number }

export const mesh = (): Mesh => ({ pos: [], col: [], idx: [] })

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V): V => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** A convex polygon facing `out`, wound so it faces it, in `paint` times `factor`. */
export function poly(m: Mesh, verts: V[], out: V, paint: Paint, factor = 1) {
  const n = unit(out)
  const ordered = dot(cross(sub(verts[1], verts[0]), sub(verts[2], verts[0])), n) < 0 ? [...verts].reverse() : verts
  const base = m.pos.length / 3
  for (const v of ordered) {
    const t = paint.shade(v, n) * factor
    m.pos.push(...v)
    m.col.push(paint.tint[0] * t, paint.tint[1] * t, paint.tint[2] * t)
  }
  for (let k = 1; k < ordered.length - 1; k++) m.idx.push(base, base + k, base + k + 1)
}

/** Which of a box's elements to leave out, by the direction it faces: faces never seen cost nothing. */
export type Skip = (out: V) => boolean
export const keepAll: Skip = () => false
export const noBottom: Skip = (o) => o[1] < 0

/**
 * A box centred on `c` of size `s`, its edges chamfered by `r` (faces, 12 edge strips in `paint.lift`, 8 corner
 * triangles); a plain box when `r` is 0.
 */
export function box(m: Mesh, c: V, s: V, paint: Paint, r = 0, skip: Skip = keepAll) {
  const a: V = [s[0] / 2, s[1] / 2, s[2] / 2]
  const at = (coords: V): V => [c[0] + coords[0], c[1] + coords[1], c[2] + coords[2]]
  const axis = (i: number, v: number): V => [i === 0 ? v : 0, i === 1 ? v : 0, i === 2 ? v : 0]
  for (let i = 0; i < 3; i++) {
    for (const si of [-1, 1]) {
      const out = axis(i, si)
      if (skip(out)) continue
      const [j, k] = [(i + 1) % 3, (i + 2) % 3]
      const corner = (sj: number, sk: number) => {
        const p: V = [0, 0, 0]
        p[i] = si * a[i]
        p[j] = sj * (a[j] - r)
        p[k] = sk * (a[k] - r)
        return at(p)
      }
      poly(m, [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], out, paint)
    }
  }
  if (!r) return
  for (let i = 0; i < 3; i++) {
    const [j, k] = [(i + 1) % 3, (i + 2) % 3]
    for (const si of [-1, 1]) for (const sj of [-1, 1]) {
      const out: V = [0, 0, 0]
      out[i] = si
      out[j] = sj
      if (skip(out)) continue
      const end = (sk: number, onI: boolean) => {
        const p: V = [0, 0, 0]
        p[i] = si * (onI ? a[i] : a[i] - r)
        p[j] = sj * (onI ? a[j] - r : a[j])
        p[k] = sk * (a[k] - r)
        return at(p)
      }
      poly(m, [end(-1, true), end(1, true), end(1, false), end(-1, false)], out, paint, paint.lift)
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const out: V = [sx, sy, sz]
    if (skip(out)) continue
    poly(m, [at([sx * a[0], sy * (a[1] - r), sz * (a[2] - r)]), at([sx * (a[0] - r), sy * a[1], sz * (a[2] - r)]), at([sx * (a[0] - r), sy * (a[1] - r), sz * a[2]])], out, paint, paint.lift)
  }
}

/** An upright prism of `sides` round `c` (its base), `radius` and `height`, with its top cap; a cone when `top` is 0. */
export function prism(m: Mesh, c: V, radius: number, height: number, sides: number, paint: Paint, top = radius) {
  const ring = (y: number, r: number) => Array.from({ length: sides }, (_, k): V => {
    const t = (k / sides) * Math.PI * 2
    return [c[0] + Math.cos(t) * r, c[1] + y, c[2] + Math.sin(t) * r]
  })
  const [lo, hi] = [ring(0, radius), ring(height, top)]
  for (let k = 0; k < sides; k++) {
    const n = (k + 1) % sides
    const t = ((k + 0.5) / sides) * Math.PI * 2
    const out: V = [Math.cos(t), (radius - top) / height, Math.sin(t)]
    if (top > 0) poly(m, [lo[k], lo[n], hi[n], hi[k]], out, paint)
    else poly(m, [lo[k], lo[n], [c[0], c[1] + height, c[2]]], out, paint)
  }
  if (top > 0) poly(m, hi, [0, 1, 0], paint)
}

const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const mid = (a: V, b: V): V => lerp(a, b, 0.5)

/** `path` with each inner corner rounded: a quadratic curve from `bend` before it to `bend` after it, in `steps`. */
function rounded(path: V[], bend: number, steps: number) {
  const pts: V[] = [path[0]]
  for (let k = 1; k < path.length - 1; k++) {
    const [a, b, c] = [path[k - 1], path[k], path[k + 1]]
    const [p0, p1] = [lerp(b, a, bend / Math.hypot(...sub(a, b))), lerp(b, c, bend / Math.hypot(...sub(c, b)))]
    for (let s = 0; s <= steps; s++) pts.push(lerp(lerp(p0, b, s / steps), lerp(b, p1, s / steps), s / steps))
  }
  pts.push(path.at(-1)!)
  return pts
}

/** A capped tube of `radius` along `path`, its corners rounded by `bend`, `sides` round. */
export function tube(m: Mesh, path: V[], radius: number, bend: number, sides: number, paint: Paint) {
  const pts = rounded(path, bend, 3)
  const rings = pts.map((p, k) => {
    const t = unit(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]))
    const s = unit(cross(t, Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]))
    const u = cross(s, t)
    return Array.from({ length: sides }, (_, i): V => {
      const a = (i / sides) * Math.PI * 2
      return [p[0] + (s[0] * Math.cos(a) + u[0] * Math.sin(a)) * radius, p[1] + (s[1] * Math.cos(a) + u[1] * Math.sin(a)) * radius, p[2] + (s[2] * Math.cos(a) + u[2] * Math.sin(a)) * radius]
    })
  })
  for (let k = 0; k < rings.length - 1; k++) {
    const axis = mid(pts[k], pts[k + 1])
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      poly(m, [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], sub(mid(mid(rings[k][i], rings[k][j]), mid(rings[k + 1][i], rings[k + 1][j])), axis), paint)
    }
  }
  poly(m, rings[0], sub(pts[0], pts[1]), paint)
  poly(m, rings.at(-1)!, sub(pts.at(-1)!, pts.at(-2)!), paint)
}

/** Turns the vertices from index `from` on by `turn` about y and moves them by `to`: a shape built at the origin, placed. */
export function place(m: Mesh, from: number, turn: number, to: V) {
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  for (let k = from * 3; k < m.pos.length; k += 3) {
    const [x, z] = [m.pos[k], m.pos[k + 2]]
    m.pos[k] = x * cos + z * sin + to[0]
    m.pos[k + 1] += to[1]
    m.pos[k + 2] = -x * sin + z * cos + to[2]
  }
}

export const vertices = (m: Mesh) => m.pos.length / 3

export function geometry(m: Mesh) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(m.col, 3))
  g.setIndex(m.idx)
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

/** A seeded generator in [0, 1): the same seed, the same city. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
