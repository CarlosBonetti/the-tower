import * as THREE from 'three'
import { rng } from './geo.ts'

/**
 * The city's lit windows by the hour. Each lit window keeps office hours of its own, hashed from where it stands: it
 * comes on around dusk, goes off through the evening (most are dark by one in the morning), and a few burn all night
 * or come on again before dawn. The hours ride on the window's vertices (`hours`: on, off, dawn) and the window
 * material compares them with the hour on the GPU, so the clock costs nothing per frame. By day every lit window shows
 * as ever: its hours only count as far as the night has fallen (the sky's stars).
 *
 * Hours run from noon to the next noon, 12 to 36, so an evening and the night after it are one span.
 */

const ON = { from: 17, to: 19.5 }
const OFF = { from: 19, to: 25, bias: 1.4 }
const DAWN = { from: 28.5, to: 30.5 }
const ALL_NIGHT = 0.1
const BEFORE_DAWN = 0.15
const NEVER = 36

/** A window's hours from a hash of its centre. */
function hoursOf(x: number, y: number, z: number): [number, number, number] {
  const r = rng(Math.imul(Math.round(x * 8), 73856093) ^ Math.imul(Math.round(y * 8), 19349663) ^ Math.imul(Math.round(z * 8), 83492791))
  const on = ON.from + r() * (ON.to - ON.from)
  const off = r() < ALL_NIGHT ? NEVER : Math.max(on + 0.25, OFF.from + r() ** OFF.bias * (OFF.to - OFF.from))
  const dawn = r() < BEFORE_DAWN ? DAWN.from + r() * (DAWN.to - DAWN.from) : NEVER
  return [on, off, dawn]
}

/** Gives every window of `geo` (quads of four vertices, nothing else) its hours. */
export function keepHours(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position')
  const hours = new Float32Array(pos.count * 3)
  for (let v = 0; v < pos.count; v += 4) {
    const c = [0, 1, 2].map((a) => (pos.getComponent(v, a) + pos.getComponent(v + 2, a)) / 2)
    const h = hoursOf(c[0], c[1], c[2])
    for (let k = 0; k < 4; k++) hours.set(h, (v + k) * 3)
  }
  geo.setAttribute('hours', new THREE.BufferAttribute(hours, 3))
  return geo
}

const uniforms = { cityHour: { value: 12 }, cityNight: { value: 0 } }

/** Sets the hour (0–24) the windows keep, and how far the night has fallen (0 by day, 1 at full night). */
export function windowsAt(hours: number, night: number) {
  uniforms.cityHour.value = hours < 12 ? hours + 24 : hours
  uniforms.cityNight.value = night
}

/** A window material that keeps its windows' hours: its glow is on only while theirs is. */
export function keepsHours<M extends THREE.MeshLambertMaterial>(m: M) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec3 hours;\nuniform float cityHour;\nuniform float cityNight;\nvarying float vLit;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  float lit = max( step( hours.x, cityHour ) * ( 1.0 - step( hours.y, cityHour ) ), step( hours.z, cityHour ) );
  vLit = mix( 1.0, lit, cityNight );`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vLit;\nvoid main() {')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vLit;')
  }
  m.customProgramCacheKey = () => 'windows'
  return m
}
