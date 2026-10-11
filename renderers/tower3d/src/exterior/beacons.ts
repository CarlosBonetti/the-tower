import * as THREE from 'three'
import { glowing } from '../toon.ts'
import { rng, type V } from './geo.ts'

/**
 * Red aircraft-warning lights on the parapet corners of the city's tallest towers and on the mast of the tower's own
 * roof. Each structure flashes on a beat of its own, a phase hashed from where it stands, all of it a function of
 * sim time: bright at night, dim by day. The city's lights are one instanced mesh; the mast's is the roof plant's
 * `glow` finish (`mastLight`).
 */

export type Top = { x: number; z: number; y: number; w: number; d: number; turn: number }

const RED = new THREE.Color('#ff3b3b')
/** Flashes a second (Hz), the share of each flash the light is on, and how bright it is at night and by day. */
const BLINK = { rate: 0.5, on: 0.4, night: 1, day: 0.3, off: 0.08 }
/** How many of the tallest towers carry lights, and a light's size (m). */
const TALLEST = 6
const LAMP = 0.6

export const mastLight = glowing(RED.clone())

const phaseOf = (x: number, z: number) => rng(Math.imul(Math.round(x), 2654435761) ^ Math.round(z * 31))()

/** Where a top's parapet corners are, turned and placed as its building is. */
function corners({ x, z, y, w, d, turn }: Top): V[] {
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]): V => {
    const [lx, lz] = [sx * (w / 2 + 0.2), sz * (d / 2 + 0.2)]
    return [lx * cos + lz * sin + x, y + 1.5 + LAMP / 2, -lx * sin + lz * cos + z]
  })
}

/** Whether a light of `phase` is on at sim time `t` (seconds). */
const lit = (t: number, phase: number) => (t * BLINK.rate + phase) % 1 < BLINK.on

/**
 * The lights over the tallest of `tops`: `tick` flashes them and the mast at sim time `t`, `setNight` sets how far the
 * night has fallen (0–1).
 */
export function beacons(tops: Top[]) {
  const lamps = [...tops].sort((a, b) => b.y - a.y).slice(0, TALLEST).flatMap((top) => corners(top).map((at) => ({ at, phase: phaseOf(top.x, top.z) })))
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(LAMP, LAMP, LAMP), glowing('#ffffff'), lamps.length)
  const matrix = new THREE.Matrix4()
  lamps.forEach(({ at }, i) => mesh.setMatrixAt(i, matrix.makeTranslation(...at)))
  const mast = phaseOf(0, 0)
  const [on, off] = [new THREE.Color(), new THREE.Color()]
  const tick = (t: number) => {
    lamps.forEach(({ phase }, i) => mesh.setColorAt(i, lit(t, phase) ? on : off))
    mesh.instanceColor!.needsUpdate = true
    mastLight.color.copy(lit(t, mast) ? on : off)
  }
  const setNight = (night: number) => {
    on.copy(RED).multiplyScalar(THREE.MathUtils.lerp(BLINK.day, BLINK.night, night))
    off.copy(RED).multiplyScalar(BLINK.off)
  }
  setNight(0)
  tick(0)
  return { mesh, tick, setNight }
}
