import { box, geometry, mesh, noBottom, place, prism, tube, vertices, type Mesh, type Paint, type V } from './geo.ts'
import { LAYERS, PIECES, type Layer } from './skyline.ts'

/**
 * Plant for the tower's own roof: the skyline's roof pieces at the tower's scale, and `pipes`, three pipes 8 m along
 * +x jogging up and over at the middle, on stands. A spot names a piece, where it stands and its turn about y.
 * The plant comes back by finish: `steel` and `bronze` for metal, `concrete`, `dark` (fan wells, doors) and `glow`
 * (the antenna's warning light).
 */

export type Spot = { piece: keyof typeof PIECES | 'pipes'; at: V; turn: number }
export type Finish = 'steel' | 'bronze' | 'concrete' | 'dark' | 'glow'
export const FINISHES: Finish[] = ['steel', 'bronze', 'concrete', 'dark', 'glow']

const FROM_LAYER: Record<Layer, Finish> = { stone: 'concrete', trim: 'steel', glass: 'dark', warm: 'glow', cool: 'glow' }

const shade = (_: V, n: V) => (n[1] > 0.5 ? 1.08 : n[1] < -0.5 ? 0.7 : 1)
const PAINT: Paint = { tint: [1, 1, 1], shade, lift: 1.22 }
const PAINTS = { stone: PAINT, shadow: PAINT, trim: PAINT, glass: PAINT, warm: PAINT, cool: PAINT }

const RUN: V[] = [[0, 0.5, 0], [2.6, 0.5, 0], [3.2, 1.6, 0], [4.8, 1.6, 0], [5.4, 0.5, 0], [8, 0.5, 0]]

function pipes(F: Record<Finish, Mesh>) {
  for (const [z, r] of [[-0.32, 0.09], [0, 0.12], [0.3, 0.07]] as const) tube(r === 0.12 ? F.bronze : F.steel, RUN.map(([x, y]): V => [x, y, z]), r, 0.35, 8, PAINT)
  for (const x of [0.6, 2, 6, 7.4]) {
    box(F.steel, [x, 0.36, 0], [0.08, 0.08, 0.9], PAINT, 0.02)
    for (const z of [-0.4, 0.4]) box(F.steel, [x, 0.18, z], [0.1, 0.36, 0.1], PAINT, 0.02, noBottom)
  }
}

/** What a piece gets beyond its shared shape: hoops round the tank, a warning light on the mast. */
const EXTRAS: Partial<Record<Spot['piece'], (F: Record<Finish, Mesh>) => void>> = {
  tank(F) {
    for (const y of [2.1, 2.9, 3.7]) prism(F.bronze, [0, y, 0], 1.34, 0.12, 10, PAINT)
  },
  antenna(F) {
    box(F.glow, [0, 7.05, 0], [0.22, 0.22, 0.22], PAINT)
  },
}

export function roofPlant(spots: Spot[]) {
  const F = Object.fromEntries(FINISHES.map((k) => [k, mesh()])) as Record<Finish, Mesh>
  for (const { piece, at, turn } of spots) {
    const from = Object.fromEntries(FINISHES.map((k) => [k, vertices(F[k])])) as Record<Finish, number>
    if (piece === 'pipes') pipes(F)
    else {
      const L = Object.fromEntries(LAYERS.map((k) => [k, F[FROM_LAYER[k]]])) as Record<Layer, Mesh>
      PIECES[piece](L, PAINTS, [0, 0, 0], () => 0.5)
    }
    EXTRAS[piece]?.(F)
    for (const k of FINISHES) place(F[k], from[k], turn, at)
  }
  return Object.fromEntries(FINISHES.map((k) => [k, geometry(F[k])])) as Record<Finish, ReturnType<typeof geometry>>
}
