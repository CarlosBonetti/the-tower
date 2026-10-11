import * as THREE from 'three'
import { glows } from '../toon.ts'
import { box, geometry, mesh, noBottom, place, poly, prism, rng, vertices, type Mesh, type Paint, type V } from './geo.ts'

/**
 * A quiet neighbourhood west of the tower, generated at load: two curved lanes of gabled houses between the ring road
 * and the city, three mid-rises behind them (an L-block, a stepped tower, a water tower on legs), and street trees
 * along the ring road's outer edge. Houses and mid-rises are one mesh per layer; the trees are two instanced meshes.
 * Everything follows from constants and seeded draws.
 */

/** The sector it fills: angles (radians, atan2(z, x)) from the tower's centre, and how far out it reaches. */
export const SECTOR = { from: (120 * Math.PI) / 180, to: (200 * Math.PI) / 180, out: 128 }

const angleOf = (x: number, z: number) => {
  const a = Math.atan2(z, x)
  return a < 0 ? a + Math.PI * 2 : a
}

/** Whether a city building `w` across at x, z would stand in the neighbourhood. */
export function inNeighbourhood(x: number, z: number, w: number) {
  const a = angleOf(x, z)
  const margin = w / Math.hypot(x, z)
  return a > SECTOR.from - margin && a < SECTOR.to + margin && Math.hypot(x, z) - w * 0.71 < SECTOR.out
}

/** Each lane: its radius, and the rows of houses either side of it, facing it. */
const LANES = [
  { r: 72, rows: [66, 78] },
  { r: 97, rows: [91, 103] },
]
const LANE_WIDTH = 4.5
/** How much street each house's lot takes, along its row. */
const LOT = 11

export type Layer = 'wall' | 'roof' | 'glass' | 'warm'
export const LAYERS: Layer[] = ['wall', 'roof', 'glass', 'warm']
type Layers = Record<Layer, Mesh>

const WALLS: V[] = [[1, 0.93, 0.8], [0.78, 0.85, 0.92], [0.8, 0.87, 0.76], [0.86, 0.64, 0.54], [0.95, 0.95, 0.92], [0.98, 0.88, 0.64]]
const ROOFS: V[] = [[0.7, 0.36, 0.28], [0.36, 0.4, 0.48], [0.34, 0.44, 0.38], [0.5, 0.38, 0.3]]
const CONCRETE: V[] = [[0.82, 0.8, 0.76], [0.72, 0.74, 0.78], [0.86, 0.74, 0.62]]
const ASPHALT: V = [0.26, 0.28, 0.32]

/** Light baked into the colours: darker towards the ground, under eaves, brighter on what faces the sky. */
function shade(p: V, n: V) {
  const ground = 0.74 + 0.26 * Math.min(1, Math.max(0, p[1] / 5))
  return ground * (n[1] > 0.3 ? 1.08 : n[1] < -0.5 ? 0.6 : 0.9)
}
const paint = (tint: V): Paint => ({ tint, shade, lift: 1.12 })
const GLASS = paint([1, 1, 1])

const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)

/** A window on the face of a box: `out` is the face's normal, `u` across it and `y` its middle. Some are lit. */
function pane(L: Layers, out: V, dist: number, u: number, y: number, w: number, h: number, lit: boolean) {
  const along: V = [-out[2], 0, out[0]]
  const at = (du: number, dy: number): V => [along[0] * (u + du) + out[0] * (dist + 0.03), y + dy, along[2] * (u + du) + out[2] * (dist + 0.03)]
  poly(lit ? L.warm : L.glass, [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)], out, GLASS)
}

/** A rows × bays grid of windows over a w × d box's four sides, from y0, one floor every `floor` metres. */
function grid(L: Layers, w: number, d: number, y0: number, floors: number, floor: number, bay: number, lit: number, r: () => number, sides: V[] = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]) {
  for (const out of sides) {
    const [span, dist] = out[0] ? [d, w / 2] : [w, d / 2]
    const bays = Math.max(1, Math.floor(span / bay))
    for (let f = 0; f < floors; f++)
      for (let b = 0; b < bays; b++) pane(L, out, dist, -span / 2 + (span / bays) * (b + 0.5), y0 + floor * (f + 0.55), (span / bays) * 0.5, floor * 0.45, r() < lit)
  }
}

/** A gabled roof over a w × d box whose walls end at y: its ridge along x, `rise` above the eaves, `over` past the walls. */
function gable(L: Layers, w: number, d: number, y: number, rise: number, over: number, wall: Paint, roof: Paint) {
  const [x, z] = [w / 2 + over, d / 2 + over]
  const drop = (rise / (d / 2)) * over
  for (const s of [-1, 1]) {
    const eave: V[] = [[-x, y - drop, s * z], [x, y - drop, s * z]]
    poly(L.roof, [eave[0], eave[1], [x, y + rise, 0], [-x, y + rise, 0]], [0, d / 2, s * rise], roof)
    poly(L.roof, [eave[1], eave[0], [-x, y - drop - 0.12, s * z], [x, y - drop - 0.12, s * z]], [0, 0, s], roof, 0.7)
    poly(L.wall, [[s * (w / 2), y, -d / 2], [s * (w / 2), y, d / 2], [s * (w / 2), y + rise, 0]], [s, 0, 0], wall)
  }
}

/** A house on its origin, its front facing +z: one or two storeys, a gabled roof, a door, windows, sometimes a porch. */
function house(L: Layers, r: () => number) {
  const w = between(r, 6.5, 9)
  const d = between(r, 6, 8)
  const storeys = r() < 0.4 ? 2 : 1
  const h = storeys * 2.8
  const wall = paint(pick(r, WALLS))
  const roof = paint(pick(r, ROOFS))
  box(L.wall, [0, h / 2, 0], [w, h, d], wall, 0, noBottom)
  gable(L, w, d, h, between(r, 0.32, 0.5) * d, 0.45, wall, roof)
  const door = between(r, -w / 4, w / 4)
  poly(L.roof, [[door - 0.5, 0, d / 2 + 0.03], [door + 0.5, 0, d / 2 + 0.03], [door + 0.5, 2.1, d / 2 + 0.03], [door - 0.5, 2.1, d / 2 + 0.03]], [0, 0, 1], roof, 0.8)
  for (let f = 0; f < storeys; f++) {
    for (const u of [-w / 3, w / 3]) if (f || Math.abs(u - door) > 1.4) pane(L, [0, 0, 1], d / 2, u, f * 2.8 + 1.5, 1.2, 1.1, r() < 0.2)
    for (const s of [-1, 1]) pane(L, [s, 0, 0], w / 2, 0, f * 2.8 + 1.5, 1.1, 1.1, r() < 0.1)
    pane(L, [0, 0, -1], d / 2, 0, f * 2.8 + 1.5, 1.4, 1.1, r() < 0.1)
  }
  if (r() < 0.45) {
    box(L.roof, [door, 2.45, d / 2 + 0.9], [2.4, 0.15, 1.8], roof, 0, noBottom)
    for (const s of [-1, 1]) box(L.wall, [door + s * 1.05, 1.2, d / 2 + 1.65], [0.15, 2.4, 0.15], wall, 0, noBottom)
  }
}

/** An L-shaped block of flats, five floors, flat roofed with a parapet. */
function lBlock(L: Layers, r: () => number) {
  const wall = paint(pick(r, CONCRETE))
  const trim = paint([0.6, 0.6, 0.62])
  const [floors, floor] = [5, 3.4]
  const h = floors * floor
  for (const [x, z, w, d, sides] of [[0, 0, 30, 11, [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]], [-9.5, -12, 11, 13, [[0, 0, -1], [1, 0, 0], [-1, 0, 0]]]] as [number, number, number, number, V[]][]) {
    const from = LAYERS.map((k) => vertices(L[k]))
    box(L.wall, [0, h / 2, 0], [w, h, d], wall, 0.1, noBottom)
    grid(L, w, d, 0, floors, floor, 3, 0.08, r, sides)
    box(L.roof, [0, h + 0.4, 0], [w + 0.3, 0.8, d + 0.3], trim, 0.06, noBottom)
    LAYERS.forEach((k, i) => place(L[k], from[i], 0, [x, 0, z]))
  }
}

/** A tower set back twice as it rises. */
function stepped(L: Layers, r: () => number) {
  const wall = paint(pick(r, CONCRETE))
  const trim = paint([0.62, 0.62, 0.66])
  let [y, w] = [0, 15]
  for (const floors of [5, 3, 3]) {
    const h = floors * 3.4
    box(L.wall, [0, y + h / 2, 0], [w, h, w], wall, 0.12, noBottom)
    grid(L, w, w, y, floors, 3.4, 2.6, 0.1, r)
    box(L.roof, [0, y + h + 0.3, 0], [w + 0.5, 0.6, w + 0.5], trim, 0.06, noBottom)
    y += h + 0.6
    w -= 4
  }
  prism(L.roof, [0, y, 0], 0.12, 5, 6, trim)
}

/** A water tower: a round tank and a cone on four braced legs. */
function waterTower(L: Layers) {
  const steel = paint([0.62, 0.66, 0.7])
  const tank = paint([0.84, 0.86, 0.88])
  const [legs, spread] = [18, 3.6]
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(L.roof, [x * spread, legs / 2, z * spread], [0.4, legs, 0.4], steel, 0, noBottom)
  for (const y of [6, 12]) for (const [dx, dz] of [[1, 0], [0, 1]]) for (const s of [-1, 1])
    box(L.roof, [dz * s * spread, y, dx * s * spread], [dx ? spread * 2 : 0.2, 0.2, dz ? spread * 2 : 0.2], steel)
  prism(L.wall, [0, legs, 0], 5, 5.5, 14, tank)
  prism(L.roof, [0, legs + 5.5, 0], 5.3, 2.6, 14, steel, 0)
}

/** A lane's asphalt between two angles at radius `r`, as a flat arc. */
function lane(L: Layers, r: number, from: number, to: number) {
  const steps = Math.ceil(((to - from) * r) / 6)
  const at = (a: number, rr: number): V => [Math.cos(a) * rr, -0.18, Math.sin(a) * rr]
  for (let k = 0; k < steps; k++) {
    const [a, b] = [from + ((to - from) * k) / steps, from + ((to - from) * (k + 1)) / steps]
    poly(L.wall, [at(a, r - LANE_WIDTH / 2), at(b, r - LANE_WIDTH / 2), at(b, r + LANE_WIDTH / 2), at(a, r + LANE_WIDTH / 2)], [0, 1, 0], paint(ASPHALT))
  }
}

/** Where the mid-rises stand: angle, radius and how each is turned to face the tower. */
const MID_RISES: { build: (L: Layers, r: () => number) => void; a: number; r: number }[] = [
  { build: lBlock, a: (135 * Math.PI) / 180, r: 117 },
  { build: stepped, a: (163 * Math.PI) / 180, r: 116 },
  { build: (L) => waterTower(L), a: (188 * Math.PI) / 180, r: 115 },
]

/** Every house and mid-rise placed, and each house lot's back yard (for a tree): one geometry per layer. */
export function homes() {
  const L = Object.fromEntries(LAYERS.map((k) => [k, mesh()])) as Layers
  const r = rng(4231)
  const yards: [number, number][] = []
  const placed = (build: () => void, turn: number, to: V) => {
    const from = LAYERS.map((k) => vertices(L[k]))
    build()
    LAYERS.forEach((k, i) => place(L[k], from[i], turn, to))
  }
  for (const { r: laneR, rows } of LANES) {
    lane(L, laneR, SECTOR.from, SECTOR.to)
    for (const row of rows) {
      const step = LOT / row
      const lots = Math.floor((SECTOR.to - SECTOR.from) / step)
      const facing = row < laneR ? 1 : -1
      for (let k = 0; k < lots; k++) {
        const a = SECTOR.from + step * (k + 0.5) + between(r, -0.08, 0.08) * step
        if (r() < 0.1) continue
        const [cx, cz] = [Math.cos(a), Math.sin(a)]
        placed(() => house(L, r), Math.atan2(cx * facing, cz * facing), [cx * row, 0, cz * row])
        if (r() < 0.5) yards.push([cx * (row - facing * 6.5), cz * (row - facing * 6.5)])
      }
    }
  }
  for (const { build, a, r: rr } of MID_RISES) placed(() => build(L, r), Math.atan2(-Math.cos(a), -Math.sin(a)), [Math.cos(a) * rr, 0, Math.sin(a) * rr])
  return { geometries: Object.fromEntries(LAYERS.map((k) => [k, geometry(L[k])])) as Record<Layer, THREE.BufferGeometry>, yards }
}

const GREENS = ['#4f7a4a', '#5d8a4e', '#44704f', '#6b8c4a', '#577d5c']
const TREE = { every: 9, off: 2.2 }

/** Street trees every few metres along the road's outer edge where `open` says there is room, and the yards' trees. */
function trees(curve: THREE.CatmullRomCurve3, edge: number, open: (x: number, z: number) => boolean, yards: [number, number][]) {
  const r = rng(9173)
  const length = curve.getLength()
  const spots: [number, number][] = []
  for (let s = 0; s < length; s += TREE.every) {
    const u = s / length
    const p = curve.getPointAt(u)
    const t = curve.getTangentAt(u)
    const side = new THREE.Vector3(-t.z, 0, t.x)
    if (side.dot(p) < 0) side.negate()
    const at = p.addScaledVector(side, edge + TREE.off)
    if (open(at.x, at.z)) spots.push([at.x, at.z])
  }
  spots.push(...yards)
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, 2.2, 5).translate(0, 1.1 - 0.2, 0)
  const crown = new THREE.IcosahedronGeometry(1.5, 0).scale(1, 1.25, 1).translate(0, 3.2 - 0.2, 0)
  const bark = new THREE.MeshLambertMaterial({ flatShading: true })
  const leaves = new THREE.MeshLambertMaterial({ flatShading: true })
  const meshes = [new THREE.InstancedMesh(trunk, bark, spots.length), new THREE.InstancedMesh(crown, leaves, spots.length)]
  const matrix = new THREE.Matrix4()
  const turn = new THREE.Quaternion()
  spots.forEach(([x, z], i) => {
    const size = between(r, 0.8, 1.2)
    matrix.compose(new THREE.Vector3(x, 0, z), turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2), new THREE.Vector3(size, size * between(r, 0.9, 1.15), size))
    for (const m of meshes) m.setMatrixAt(i, matrix)
    meshes[1].setColorAt(i, new THREE.Color(pick(r, GREENS)).multiplyScalar(between(r, 0.85, 1.1)))
  })
  return { meshes, materials: [bark, leaves] }
}

const BARK = new THREE.Color('#a08670')
const NIGHT = { lit: new THREE.Color('#2a3550'), glass: new THREE.Color('#141b2c') }
const DAY = { lit: new THREE.Color('#d6dae4'), glass: new THREE.Color('#56698e') }

/**
 * The neighbourhood's meshes and their materials, with street trees along `curve` at `edge` from its centre line
 * wherever `open`. `light` sets them to the daylight (0 night, 1 day) and how lit the city's windows are.
 */
export function neighbourhood(curve: THREE.CatmullRomCurve3, edge: number, open: (x: number, z: number) => boolean) {
  const built = homes()
  const solid = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const byLayer: Record<Layer, THREE.MeshLambertMaterial> = {
    wall: solid(),
    roof: solid(),
    glass: new THREE.MeshLambertMaterial({ color: '#141b2c', emissive: '#1c2640', vertexColors: true, flatShading: true }),
    warm: glows(new THREE.MeshLambertMaterial({ color: '#141b2c', emissive: '#ffcf86', vertexColors: true, flatShading: true })),
  }
  const grove = trees(curve, edge, open, built.yards)
  const group = new THREE.Group().add(...LAYERS.map((k) => new THREE.Mesh(built.geometries[k], byLayer[k])), ...grove.meshes)
  const light = (day: number, windows: number) => {
    for (const m of [byLayer.wall, byLayer.roof, ...grove.materials]) m.color.copy(NIGHT.lit).lerp(DAY.lit, day)
    grove.materials[0].color.multiply(BARK)
    for (const m of [byLayer.glass, byLayer.warm]) (m.color.copy(NIGHT.glass).lerp(DAY.glass, day), (m.emissiveIntensity = windows))
  }
  return { group, light }
}
