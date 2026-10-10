import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js'

/**
 * Contact shadows, drawn only with `?proc=contact`: the level you stand on is seen from just under its floor by an
 * orthographic camera looking up, everything within REACH of the floor drawn darker the lower it stands, blurred, and
 * laid on the floor. Only your level's own things are in that view, so nothing from the floors above reaches it, and
 * people, carts and cats ground themselves as they move. A light-free shadow: it holds at every hour.
 */

/** How high over the floor a thing still darkens it (m). */
const REACH = 2
/** Floor metres per shadow texel. */
const TEXEL = 0.05
/** How dark a shadow under something resting on the floor is. */
const DARK = 0.95
/** Frames between two redraws of the shadows: what moves on a floor moves a few cm in that time, under the blur. */
const EVERY = 3
let drawn = { frame: 0, y: NaN }

/** The camera sits this far over the floor: over the carpet and rugs, under what stands on them. */
const LIFT = 0.03

const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide })
depth.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace('vec4( vec3( 1.0 - fragCoordZ ), opacity )', 'vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 0.7 ) )')
}

const target = () => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true })
const shot = target()
const blurred = target()
blurred.depthBuffer = false
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, REACH - LIFT)
camera.rotation.x = Math.PI / 2
const horizontal = new THREE.ShaderMaterial(HorizontalBlurShader)
const vertical = new THREE.ShaderMaterial(VerticalBlurShader)
horizontal.depthTest = vertical.depthTest = false
const quad = new FullScreenQuad()

const floorGeometry = new THREE.PlaneGeometry(1, 1)
{
  const uv = floorGeometry.getAttribute('uv') as THREE.BufferAttribute
  for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k))
}
const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ map: shot.texture, transparent: true, depthWrite: false, opacity: DARK, fog: false }))
floor.rotation.x = -Math.PI / 2
floor.renderOrder = -1
floor.userData.post = true

const unshaded = (o: THREE.Object3D) => o instanceof THREE.Sprite || o instanceof THREE.Points || o instanceof THREE.Line

/**
 * Hides everything in `scene` but `roots` and the groups holding them, and in them what has no surface (labels, lines,
 * points) and the meshes `keep` turns down; answers how to undo it.
 */
export function isolate(scene: THREE.Object3D, roots: THREE.Object3D[], keep: (m: THREE.Mesh) => boolean = () => true) {
  const hidden: THREE.Object3D[] = []
  const hide = (o: THREE.Object3D) => (hidden.push(o), (o.visible = false))
  const paths = new Set<THREE.Object3D>()
  for (const r of roots) r.traverseAncestors((a) => paths.add(a))
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (!c.visible) continue
      if (roots.includes(c)) c.traverseVisible((d) => (unshaded(d) || (d instanceof THREE.Mesh && !keep(d))) && hide(d))
      else if (paths.has(c)) walk(c)
      else hide(c)
    }
  }
  walk(scene)
  return () => hidden.forEach((o) => (o.visible = true))
}

function blur(renderer: THREE.WebGLRenderer, texels: number) {
  horizontal.uniforms.tDiffuse.value = shot.texture
  horizontal.uniforms.h.value = texels / shot.width
  quad.material = horizontal
  renderer.setRenderTarget(blurred)
  quad.render(renderer)
  vertical.uniforms.tDiffuse.value = blurred.texture
  vertical.uniforms.v.value = texels / shot.height
  quad.material = vertical
  renderer.setRenderTarget(shot)
  quad.render(renderer)
}

/** Lays the contact shadows of `roots` (what stands on one level) on that level's floor, `width` × `depth` at `y`. */
export function contactShadows(renderer: THREE.WebGLRenderer, scene: THREE.Scene, roots: THREE.Object3D[], at: { y: number; width: number; depth: number }) {
  if (!floor.parent) scene.add(floor)
  floor.visible = roots.length > 0
  if (!floor.visible) return
  const scale = Math.min(1, 1024 / Math.max(at.width, at.depth) / (1 / TEXEL))
  const [w, h] = [Math.round((at.width / TEXEL) * scale), Math.round((at.depth / TEXEL) * scale)]
  if (shot.width !== w || shot.height !== h) (shot.setSize(w, h), blurred.setSize(w, h))
  Object.assign(camera, { left: -at.width / 2, right: at.width / 2, top: at.depth / 2, bottom: -at.depth / 2 })
  camera.position.set(0, at.y + LIFT, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  floor.position.set(0, at.y + LIFT, 0)
  floor.scale.set(at.width, at.depth, 1)
  drawn.frame++
  if (drawn.y === at.y && drawn.frame % EVERY !== 0) return
  drawn = { frame: 0, y: at.y }

  const restore = isolate(scene, roots)
  const clear = renderer.getClearColor(new THREE.Color())
  const alpha = renderer.getClearAlpha()
  const background = scene.background
  scene.background = null
  scene.overrideMaterial = depth
  renderer.setRenderTarget(shot)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  renderer.render(scene, camera)
  scene.overrideMaterial = null
  scene.background = background
  restore()
  blur(renderer, 1)
  blur(renderer, 0.4)
  renderer.setRenderTarget(null)
  renderer.setClearColor(clear, alpha)
}
