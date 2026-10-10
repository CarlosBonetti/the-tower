import * as THREE from 'three'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { isolate } from './contact.ts'
import { PROC } from './flag.ts'

/**
 * Passes over the finished frame, drawn only with `?proc=ao`: the scene is rendered to the canvas exactly as without
 * them, tone mapped, and each pass then works on the canvas, so what is drawn `toneMapped: false` (screens, neon)
 * keeps its colour. Ambient occlusion multiplies the frame by how enclosed each pixel is (three's GTAO, over a normal
 * and depth render of the opaque scene); `?proc=ao,aoview` draws the occlusion alone.
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

let ao: GTAOPass | undefined
const quad = new FullScreenQuad()
const size = new THREE.Vector2()
const sized = new THREE.Vector2()

const opaque = (m: THREE.Mesh) => !(Array.isArray(m.material) ? m.material[0] : m.material).transparent

export function occlude(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  renderer.getDrawingBufferSize(size)
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
