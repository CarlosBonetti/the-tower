import * as THREE from 'three'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { skyAt } from '../../../../src/shared/design.ts'
import { wallNow } from '../clock.ts'
import { isolate } from './contact.ts'
import { interiorOff } from './rig.ts'
import { PROC } from './flag.ts'

/**
 * Passes over the finished frame, drawn only with `?proc=ao`: the scene is rendered to the canvas exactly as without
 * them, tone mapped, and each pass then works on the canvas, so what is drawn `toneMapped: false` (screens, neon)
 * keeps its colour. Ambient occlusion multiplies the frame by how enclosed each pixel is (three's GTAO, over a normal
 * and depth render of the opaque scene); `?proc=ao,aoview` draws the occlusion alone. Bloom (`?proc=bloom`) draws the scene
 * again with every light off and only what is marked to glow lit, blooms it over three's mip chain and adds it to
 * the canvas, as strong as the night is dark: it only ever adds light to the frame ACES made.
 */

/** GTAO in metres, tuned for the toon look: creases and contacts, not a dirty overall shade. */
const AO = { radius: 0.5, distanceExponent: 1, thickness: 0.3, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false }
/** How much of the occlusion is laid on the frame, fading out between `near` and `far` (m): the city's walls are too far for a crease to read, and GTAO finds false ones on them. */
const AO_LAY = { strength: 0.9, near: 15, far: 40 }

/** Multiplies the canvas by the occlusion, faded with distance. */
const lay = new THREE.ShaderMaterial({
  uniforms: { tAO: { value: null }, tDepth: { value: null }, near: { value: 0 }, far: { value: 0 }, strength: { value: AO_LAY.strength }, fade: { value: new THREE.Vector2(AO_LAY.near, AO_LAY.far) } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `#include <packing>
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform float near, far, strength;
uniform vec2 fade;
varying vec2 vUv;
void main() {
  float distance = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).r, near, far);
  float k = strength * (1.0 - smoothstep(fade.x, fade.y, distance));
  gl_FragColor = vec4(mix(vec3(1.0), texture2D(tAO, vUv).rgb, k), 1.0);
}`,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.DstColorFactor,
  blendDst: THREE.ZeroFactor,
})

/** The occlusion buffer's size against the canvas: the blur under it hides the lower resolution. */
const AO_SCALE = 0.5

let ao: GTAOPass | undefined
const quad = new FullScreenQuad()
const size = new THREE.Vector2()
const sized = new THREE.Vector2()

const opaque = (m: THREE.Mesh) => !(Array.isArray(m.material) ? m.material[0] : m.material).transparent

export function occlude(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  renderer.getDrawingBufferSize(size).multiplyScalar(AO_SCALE).floor()
  if (!ao) {
    ao = new GTAOPass(scene, camera, size.x, size.y)
    ao.updateGtaoMaterial(AO)
    ao.output = GTAOPass.OUTPUT.Off
    sized.copy(size)
  }
  if (!sized.equals(size)) (ao.setSize(size.x, size.y), sized.copy(size))
  const background = scene.background
  scene.background = null
  const restore = isolate(scene, scene.children, opaque)
  ao.render(renderer, null as never, null as never, 0, false)
  restore()
  scene.background = background
  Object.assign(lay.uniforms.tAO, { value: ao.pdRenderTarget.texture })
  Object.assign(lay.uniforms.tDepth, { value: (ao as unknown as { depthTexture: THREE.DepthTexture }).depthTexture })
  lay.uniforms.near.value = camera.near
  lay.uniforms.far.value = camera.far
  quad.material = lay
  if (PROC.has('aoview')) (lay.blending = THREE.NoBlending)
  renderer.setRenderTarget(null)
  const autoClear = renderer.autoClear
  renderer.autoClear = false
  quad.render(renderer)
  renderer.autoClear = autoClear
}

/** Bloom at full night: how strong, how wide, and the glow (linear, before tone mapping) a pixel blooms from. */
const BLOOM = { strength: 0.6, radius: 0.45, threshold: 0.15 }

const add = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }',
  depthTest: false,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
})
/** Frames between two glow passes: the bloom is soft enough that a frame-old one doesn't show. */
const GLOW_EVERY = 2
let glow: { pass: UnrealBloomPass; lit: THREE.WebGLRenderTarget; frame: number } | undefined

/** How dark the sky is at the wall clock's hour: its stars, 0 by day, 1 at full night. */
function nightNow() {
  const now = new Date(wallNow())
  return skyAt(now.getHours() + now.getMinutes() / 60).stars
}

const black = new THREE.MeshBasicMaterial({ color: 0x000000 })
const blackBothSides = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })

const tagged = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m : [m]).some((x) => x.userData.glow)

/**
 * Leaves lit only what is marked to glow (`glows` in toon.ts): every other opaque mesh draws black, to occlude, and
 * every other transparent mesh, label, line or point is hidden. Answers how to undo it.
 */
function onlyGlows(scene: THREE.Scene) {
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = []
  const hidden: THREE.Object3D[] = []
  scene.traverseVisible((o) => {
    const material = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (!material || tagged(material)) return
    const first = Array.isArray(material) ? material[0] : material
    if (o instanceof THREE.Mesh && !first.transparent) {
      swapped.push([o, material])
      o.material = first.side === THREE.FrontSide ? black : blackBothSides
    } else hidden.push(o)
  })
  for (const o of hidden) o.visible = false
  return () => {
    for (const [o, m] of swapped) o.material = m
    for (const o of hidden) o.visible = true
  }
}

/**
 * Draws `scene` into `target` with every light off and only what glows left lit: screens, neon, lamps, signs, lit
 * windows and the kit's emissive parts, occluded by everything else.
 */
function glowing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget) {
  const lights: [THREE.Light, number][] = []
  scene.traverse((o) => o instanceof THREE.Light && lights.push([o, o.intensity]))
  for (const [l] of lights) l.intensity = 0
  const interior = interiorOff()
  const restore = onlyGlows(scene)
  const fog = scene.fog as THREE.Fog | null
  const fogColor = fog?.color.clone()
  fog?.color.setScalar(0)
  const background = scene.background
  scene.background = null
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  renderer.render(scene, camera)
  scene.background = background
  if (fog) fog.color.copy(fogColor!)
  restore()
  interior()
  for (const [l, i] of lights) l.intensity = i
}

/** Adds the night's glow to the canvas, as strong as the night is dark; nothing by day. */
export function bloom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const night = nightNow()
  if (night < 0.05) return
  renderer.getDrawingBufferSize(size)
  const half = size.clone().multiplyScalar(0.5).floor()
  if (!glow || glow.lit.width !== half.x || glow.lit.height !== half.y) {
    glow = { pass: new UnrealBloomPass(half, BLOOM.strength, BLOOM.radius, BLOOM.threshold), lit: new THREE.WebGLRenderTarget(half.x, half.y, { type: THREE.HalfFloatType }), frame: 0 }
  }
  const { pass, lit } = glow
  const clear = renderer.getClearColor(new THREE.Color())
  const alpha = renderer.getClearAlpha()
  if (glow.frame++ % GLOW_EVERY === 0) {
    glowing(renderer, scene, camera, lit)
    pass.strength = BLOOM.strength * night
    pass.render(renderer, null as never, lit, 0, false)
  }
  add.uniforms.tDiffuse.value = pass.renderTargetsHorizontal[0].texture
  quad.material = add
  renderer.setRenderTarget(null)
  renderer.setClearColor(clear, alpha)
  const autoClear = renderer.autoClear
  renderer.autoClear = false
  quad.render(renderer)
  renderer.autoClear = autoClear
}
