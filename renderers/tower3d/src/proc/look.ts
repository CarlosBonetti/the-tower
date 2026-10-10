import * as THREE from 'three'

/**
 * A different light for the whole scene, drawn only with `?proc=look`: the sun casts shadows over the tower and the
 * roof, carries more of the light against a dimmer, cooler sky fill, and the haze closes in so distance reads.
 */

export const LOOK = { sun: 1.7, hemi: 0.55, ambient: 0.35, fog: { near: 55, far: 330 } }

export function castShadows(renderer: THREE.WebGLRenderer, sun: THREE.DirectionalLight) {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  sun.position.set(-70, 52, 48)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.04
  sun.shadow.camera.updateProjectionMatrix()
}

/** Shadows cast by things smaller than this (m across) only: props and people, never slabs, walls or the city. */
const PROP = 9

/**
 * Every opaque mesh takes shadows, and the small ones cast them: the building lets the sun through, so a room stays
 * lit while what stands in it is grounded by its own shadow. Glass and what glows does neither.
 */
export function shadowEverything(scene: THREE.Object3D) {
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.userData.shadowed) return
    o.userData.shadowed = true
    const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material
    const lit = !(m instanceof THREE.MeshBasicMaterial) && !m.transparent
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere()
    const across = 2 * o.geometry.boundingSphere!.radius * o.getWorldScale(new THREE.Vector3()).x
    o.castShadow = lit && !(o instanceof THREE.InstancedMesh || o instanceof THREE.BatchedMesh) && across < PROP
    o.receiveShadow = lit
  })
}
