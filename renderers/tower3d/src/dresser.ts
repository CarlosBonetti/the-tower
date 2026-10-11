import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ADVENTURERS, BODY_PARTS, FACES, HATS, type Adventurer } from './contract.ts'
import { HAIRS, SKINS, avatar, hueOf, lookOf, seatedAt, type Avatar, type Look, type Part } from './avatar.ts'
import { CHAIR } from './chair.ts'
import { instance, loadModels, type Models } from './models.ts'
import { pose, skinned, type ClipKey, type Pose } from './rig.ts'
import { block, dispose, toon } from './toon.ts'

/**
 * The dresser (dresser.html): a worker on a stand, dressed as Tower 3D dresses it, to pick its parts and colours, pose
 * it and fit its rigid pieces by hand. `window.dresser` drives it:
 *
 *   await dresser.ready()                       the models are parsed
 *   dresser.look({ id }) | ({ outfit }) | ('blank') | ({ draft })   dress the stand
 *   dresser.pose('sit', 1.2)                    a pose, held at a time (seconds); no time plays it
 *   dresser.fit(part, fit | null, key?)         set or clear a part's fit under a key ('*' when none)
 *   dresser.heads(true)                         the look on every head, side by side
 *   dresser.view('face')                        front, side, face, three-quarter
 *   dresser.state()                             the draft, what it wears and each piece's fit, the pose
 *   dresser.where(part)                         where a worn piece is on screen, CSS pixels: to click or drag at it
 *   await dresser.shot({ w, h })                a PNG data URL of the stand, without the gizmo
 */

type Vec3 = [number, number, number]
type Fit = { at?: Vec3; turn?: Vec3; scale?: number | Vec3 }
type Placement = { at: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }

/** The slots the dresser fills, in the order the panel lists them. */
const SLOTS = ['Head', 'Helm', 'Hat', 'Face', 'Cape', 'Outfit', 'Prop', 'Gear'] as const
type DSlot = (typeof SLOTS)[number]

/** A look as the dresser edits it: a part (or none) per slot, its colours and build. */
type Draft = {
  species: 'adventurer' | 'bot'
  body: Adventurer
  paint: Adventurer
  slots: Partial<Record<DSlot, string>>
  skin: string
  hair: string
  wear: string
  hue: string
  build: { width: number; height: number }
}

const POSES = ['stand', 'sit', 'type', 'walk', 'wave', 'cheer', 'dance'] as const
type PoseName = (typeof POSES)[number]
const SEATED: ReadonlySet<PoseName> = new Set(['sit', 'type'])
const DANCE_MOVES: ClipKey[] = ['Cheering', 'Jump_Idle', 'Waving', 'Cheering:arms']
/** How long the scrubber reaches, seconds. */
const LOOP = 8

/** A pose at sim time `t`, as Tower 3D poses it: at a desk (sit, type), on the floor (walk), at the party (wave, cheer, dance). */
function poseAt(name: PoseName, t: number): Pose {
  if (name === 'stand') return { layers: [{ clip: 'Idle_A', at: t }] }
  if (name === 'sit') return { layers: [{ clip: 'Sit_Chair_Idle', at: t }] }
  if (name === 'type') return { layers: [{ clip: 'Sit_Chair_Idle:rest', at: t }, { clip: 'Type', at: t }] }
  if (name === 'walk') return { layers: [{ clip: 'Walking_A', at: t }] }
  if (name === 'wave') return { layers: [{ clip: 'Waving', at: t }] }
  if (name === 'cheer') return { layers: [{ clip: 'Cheering', at: t }] }
  const move = DANCE_MOVES[Math.floor(t / 2) % DANCE_MOVES.length]
  return { layers: move.endsWith(':arms') ? [{ clip: 'Jump_Idle:rest', at: t }, { clip: move, at: t }] : [{ clip: move, at: t }] }
}

const VIEWS = { front: [0, 0, 1], side: [1, 0, 0], face: [0, 0, 1], 'three-quarter': [0.75, 0.25, 1] } as const
type View = keyof typeof VIEWS

const canvas = document.getElementById('scene') as HTMLCanvasElement
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
const scene = new THREE.Scene()
scene.background = new THREE.Color('#1b2120')
const sun = new THREE.DirectionalLight('#dfe6ff', 1.6)
sun.position.set(-4, 8, 6)
scene.add(new THREE.HemisphereLight('#b9c8ff', '#2a2430', 1.9), sun, new THREE.AmbientLight('#ffffff', 0.35))
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100)
const orbit = new OrbitControls(camera, canvas)
const gizmo = new TransformControls(camera, canvas)
gizmo.setSpace('local')
gizmo.setSize(0.7)
scene.add(gizmo.getHelper())
gizmo.addEventListener('dragging-changed', (e) => (orbit.enabled = !e.value))
const stand = new THREE.Group()
scene.add(stand)
const floor = new THREE.Group()
scene.add(floor)

let models: Models
let draft: Draft
let fits: Record<string, Record<string, Fit>> = {}
let shown: PoseName = 'stand'
let t = 0
let playing = true
let lineUp = false
let view: View = 'three-quarter'
let selected: string | undefined
/** The key a gizmo edit writes the selected piece's fit under: `*` for every look, else a part worn with it. */
let key = '*'

/** A worker on the stand: its avatar, its chair, and the rigid pieces it wears with where they were made. */
type Figure = { group: THREE.Group; avatar: Avatar; chair: THREE.Object3D; draft: Draft; worn: Map<string, { object: THREE.Object3D; made: Placement }> }
let figures: Figure[] = []

const catalogue = () => {
  const s = models.cast.slots
  return { Head: [...s.Head], Helm: [...s.Helm], Hat: [...HATS], Face: [...FACES, ...s.Face], Cape: [...s.Cape], Outfit: [...s.Outfit], Prop: [...s.Prop], Gear: [...s.Gear] } satisfies Record<DSlot, string[]>
}

const slotOfPart = (part: string) => SLOTS.find((s) => catalogue()[s].includes(part))

/** The look Tower 3D dresses from a draft. */
function lookOfDraft(d: Draft): Look {
  const { Head, Helm, Hat, Face, Cape, Outfit, Prop, Gear } = d.slots
  const made = Face !== undefined && !FACES.includes(Face)
  if (d.species === 'bot') return { species: 'bot', hue: d.hue, hat: Hat, face: made ? undefined : Face, wear: d.wear, build: d.build }
  const parts: Part[] = [
    ...BODY_PARTS.map((p) => ({ name: `${d.body}_${p}`, atlas: d.paint })),
    ...[Head ?? `${d.body}_Head`, Helm, Cape, made ? Face : undefined, Prop, Outfit].filter((p) => p !== undefined).map((name) => ({ name })),
  ]
  return { species: 'adventurer', parts, gear: Gear, skin: d.skin, hair: d.hair, hat: Hat, face: made ? undefined : Face, wear: d.wear, build: d.build }
}

function draftOfLook(look: Look): Draft {
  const base = { wear: look.wear, build: look.build, skin: SKINS[1], hair: HAIRS[0], hue: '#7aa2ff', body: 'Knight' as Adventurer, paint: 'Knight' as Adventurer }
  const slots: Draft['slots'] = { Hat: look.hat, Face: look.face }
  if (look.species === 'bot') return { ...base, species: 'bot', hue: look.hue, slots }
  const body = look.parts.find((p) => p.name.endsWith('_Body'))!
  for (const p of look.parts) {
    const slot = slotOfPart(p.name)
    if (slot) slots[slot] = p.name
  }
  slots.Gear = look.gear
  return { ...base, species: 'adventurer', body: body.name.split('_')[0] as Adventurer, paint: body.atlas!, slots, skin: look.skin, hair: look.hair }
}

const blank = (): Draft => ({ species: 'adventurer', body: 'Knight', paint: 'Knight', slots: { Head: 'Knight_Head' }, skin: SKINS[1], hair: HAIRS[1], wear: '#4cc9f0', hue: '#7aa2ff', build: { width: 1, height: 1 } })

/** Every part a draft wears, its body's head when it names none. */
const wornParts = (d: Draft) => [...Object.values(d.slots), ...(d.species === 'adventurer' && !d.slots.Head ? [`${d.body}_Head`] : [])].filter((p): p is string => p !== undefined)

/** Which key sets each field of a part's fit, worn with `worn`: an override's slot ranks in `SLOTS` order, a bot's last. */
function fitFrom(part: string, worn: string[], bot: boolean) {
  const keys = fits[part] ?? {}
  const rank = (k: string) => (k === 'bot' ? SLOTS.length : SLOTS.indexOf(slotOfPart(k)!))
  const overrides = Object.keys(keys).filter((k) => k !== '*' && (k === 'bot' ? bot : worn.includes(k))).sort((a, b) => rank(a) - rank(b))
  const fit: Fit = {}
  const from: Partial<Record<keyof Fit, string>> = {}
  for (const field of ['at', 'turn', 'scale'] as const) {
    const k = overrides.find((o) => keys[o][field] !== undefined) ?? (keys['*']?.[field] !== undefined ? '*' : undefined)
    if (k === undefined) continue
    ;(fit as Record<string, unknown>)[field] = keys[k][field]
    from[field] = k
  }
  return { fit, from }
}

const DEG = Math.PI / 180

/** A made placement moved by a fit: `at` added to its position, `turn` (degrees, bone axes) before its rotation, `scale` times its scale. */
function fitted(made: Placement, fit: Fit): Placement {
  const scale = fit.scale === undefined ? [1, 1, 1] : typeof fit.scale === 'number' ? [fit.scale, fit.scale, fit.scale] : fit.scale
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(fit.turn ?? [0, 0, 0]).map((d) => d * DEG) as Vec3))
  return { at: made.at.clone().add(new THREE.Vector3(...(fit.at ?? [0, 0, 0]))), quaternion: turn.multiply(made.quaternion), scale: made.scale.clone().multiply(new THREE.Vector3(...scale)) }
}

const round = (v: number, digits: number) => Number(v.toFixed(digits)) + 0
const vec = (v: THREE.Vector3, digits: number) => v.toArray().map((x) => round(x, digits)) as Vec3

/** The fit that carries a made placement to where an object stands now: `fitted`'s inverse. */
function fitOfObject(made: Placement, o: THREE.Object3D): Required<Fit> {
  const turn = new THREE.Euler().setFromQuaternion(o.quaternion.clone().multiply(made.quaternion.clone().invert()))
  const scale = vec(o.scale.clone().divide(made.scale), 3)
  return {
    at: vec(o.position.clone().sub(made.at), 4),
    turn: [turn.x, turn.y, turn.z].map((r) => round(r / DEG, 1)) as Vec3,
    scale: scale.every((s) => s === scale[0]) ? scale[0] : scale,
  }
}

const place = (o: THREE.Object3D, p: Placement) => (o.position.copy(p.at), o.quaternion.copy(p.quaternion), o.scale.copy(p.scale))

/** The rigid pieces an avatar wears, found by name, each where it was made. */
function wornOf(a: Avatar, d: Draft) {
  const names = new Set(wornParts(d).filter((p) => !models.cast.parts.has(p) || !skinned(models.cast, p)))
  const worn: Figure['worn'] = new Map()
  a.root.traverse((o) => {
    if (names.has(o.name) && !worn.has(o.name)) worn.set(o.name, { object: o, made: { at: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() } })
  })
  return worn
}

function refit(f: Figure) {
  const worn = wornParts(f.draft)
  for (const [part, { object, made }] of f.worn) place(object, fitted(made, fitFrom(part, worn, f.draft.species === 'bot').fit))
}

function figure(d: Draft): Figure {
  const a = avatar(models, lookOfDraft(d))
  const chair = instance(models.desk).part('chair')
  chair.position.set(0, 0, 0)
  const group = new THREE.Group()
  group.add(chair, a.root)
  const f = { group, avatar: a, chair, draft: d, worn: wornOf(a, d) }
  refit(f)
  return f
}

const SPACING = 0.95

/** The stand dressed in the draft: one worker, or one per head side by side, the draft's own head in the middle. */
function restage() {
  gizmo.detach()
  for (const f of figures) dispose(f.group, (map) => map.userData.shared)
  stand.clear()
  floor.clear()
  const heads: (string | undefined)[] = lineUp && draft.species === 'adventurer' ? catalogue().Head : [undefined]
  figures = heads.map((head) => figure(head === undefined ? draft : { ...draft, slots: { ...draft.slots, Head: head } }))
  const mine = Math.max(0, heads.indexOf(draft.slots.Head ?? `${draft.body}_Head`))
  figures.forEach((f, i) => {
    f.group.position.x = (i - mine) * SPACING
    stand.add(f.group)
  })
  const width = (heads.length - 1) * SPACING + 1.6
  floor.add(block(width, 0.06, 1.6, toon('#3a4442'), ((heads.length - 1) / 2 - mine) * SPACING, -0.06, 0))
  figures = [figures[mine], ...figures.filter((_, i) => i !== mine)]
  if (selected && !figures[0].worn.has(selected)) selected = undefined
  if (key !== '*' && !wornParts(draft).includes(key) && key !== 'bot') key = '*'
  animate()
  attach()
}

function redress() {
  restage()
  renderPanels()
}

function animate() {
  const seated = SEATED.has(shown)
  for (const f of figures) {
    const { avatar: a } = f
    f.chair.visible = seated
    if (a.gear) a.gear.visible = !seated
    a.body.position.copy(seated ? seatedAt(models.cast, a, CHAIR) : new THREE.Vector3(0, shown === 'dance' ? Math.abs(Math.sin(t * Math.PI)) * 0.06 : 0, 0))
    pose(models.cast, a.rig, poseAt(shown, t), t)
  }
}

/** The share of the canvas's width the side panels leave free, while they show. */
const PANELS = 2 * 312

/** Points the camera at the stand from `view`, filling the free share of the canvas's width: the face close-up at the heads. */
function frame(free = Math.max(0.3, (innerWidth - PANELS) / innerWidth)) {
  stand.updateMatrixWorld(true)
  const box = new THREE.Box3()
  if (view === 'face') for (const f of figures) box.expandByPoint(f.avatar.rig.bone('head').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0))).expandByScalar(0.45)
  else for (const f of figures) box.expandByObject(f.avatar.root).union(f.chair.visible ? new THREE.Box3().setFromObject(f.chair) : new THREE.Box3())
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const dir = new THREE.Vector3(...VIEWS[view]).normalize()
  const fov = camera.fov * DEG
  const fit = Math.max(size.y / 2 / Math.tan(fov / 2), size.x / 2 / Math.tan(fov / 2) / camera.aspect / free)
  camera.position.copy(center).addScaledVector(dir, fit * 1.15 + size.z)
  orbit.target.copy(center)
  orbit.update()
}

function attach() {
  const piece = selected === undefined ? undefined : figures[0].worn.get(selected)
  if (piece) gizmo.attach(piece.object)
  else gizmo.detach()
}

function select(part: string | undefined) {
  selected = part
  attach()
  renderPanels()
}

/** Writes the selected piece's fit, from the gizmo, under `key`: only the fields the gizmo's mode moves. */
function fromGizmo() {
  if (!selected) return
  const { object, made } = figures[0].worn.get(selected)!
  const now = fitOfObject(made, object)
  const field = gizmo.mode === 'translate' ? 'at' : gizmo.mode === 'rotate' ? 'turn' : 'scale'
  setFit(selected, { ...(fits[selected]?.[key] ?? {}), [field]: now[field] }, key)
}
gizmo.addEventListener('objectChange', fromGizmo)

function writeFit(part: string, fit: Fit | null, under: string) {
  const keys = { ...(fits[part] ?? {}) }
  if (fit === null || Object.keys(fit).length === 0) delete keys[under]
  else keys[under] = fit
  fits = { ...fits }
  if (Object.keys(keys).length) fits[part] = keys
  else delete fits[part]
  for (const f of figures) refit(f)
}

function setFit(part: string, fit: Fit | null, under = '*') {
  writeFit(part, fit, under)
  renderPanels()
  return state()
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const options = (xs: readonly string[], on: string | undefined, bare?: string) =>
  (bare === undefined ? '' : `<option value="">${bare}</option>`) + xs.map((x) => `<option ${x === on ? 'selected' : ''}>${esc(x)}</option>`).join('')
const swatches = (name: string, xs: readonly string[], on: string) =>
  `<span class="swatches">${xs.map((c) => `<i data-swatch="${name}" data-value="${c}" class="${c === on ? 'on' : ''}" style="background:${c}"></i>`).join('')}</span>`
const colour = (name: keyof Draft, label: string, palette: readonly string[]) =>
  `<label class="row"><span>${label}</span><input type="color" data-draft="${name}" value="${draft[name]}">${swatches(name, palette, draft[name] as string)}</label>`

function renderLook() {
  const c = catalogue()
  const adv = draft.species === 'adventurer'
  document.getElementById('look')!.innerHTML = `
    <h1>Dresser</h1>
    <h3>Start from</h3>
    <div class="row"><input type="text" id="hash" placeholder="a session id"><button data-act="hash">Hash</button><button data-act="blank">Blank</button></div>
    <h3>Body</h3>
    <div class="group">${['adventurer', 'bot'].map((s) => `<button data-species="${s}" class="${draft.species === s ? 'on' : ''}">${s}</button>`).join('')}</div>
    ${adv ? `<label class="row"><span>Body</span><select data-draft="body">${options(ADVENTURERS, draft.body)}</select></label>
    <label class="row"><span>Paint</span><select data-draft="paint">${options(ADVENTURERS, draft.paint)}</select></label>` : colour('hue', 'Hue', [])}
    <label class="row"><span>Width</span><input type="range" min="0.85" max="1.15" step="0.01" data-build="width" value="${draft.build.width}"><code>${draft.build.width.toFixed(2)}</code></label>
    <label class="row"><span>Height</span><input type="range" min="0.85" max="1.15" step="0.01" data-build="height" value="${draft.build.height}"><code>${draft.build.height.toFixed(2)}</code></label>
    <h3>Parts</h3>
    ${SLOTS.filter((s) => adv || s === 'Hat' || s === 'Face')
      .map((s) => `<label class="row"><span>${s}</span><select data-slot="${s}">${options(c[s], s === 'Head' ? draft.slots.Head ?? `${draft.body}_Head` : draft.slots[s], s === 'Head' ? undefined : '— bare —')}</select></label>`)
      .join('')}
    <h3>Colours</h3>
    ${adv ? colour('skin', 'Skin', SKINS) + colour('hair', 'Hair', HAIRS) : ''}
    ${colour('wear', 'Wear', ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#f78c6c', '#f4f1ea', '#2b2d42'])}`
}

function renderFit() {
  const f = figures[0]
  const worn = wornParts(draft)
  const bot = draft.species === 'bot'
  const pieces = [...f.worn.keys()]
  const sel = selected ? fitFrom(selected, worn, bot) : undefined
  const own = selected ? fits[selected]?.[key] : undefined
  const axes = (field: 'at' | 'turn' | 'scale', values: number[], step: number) =>
    `<b>${field}</b>${values.map((v, i) => `<input type="number" step="${step}" data-field="${field}" data-axis="${i}" value="${v}">`).join('')}`
  const shownFit = selected ? fitOfObject(f.worn.get(selected)!.made, f.worn.get(selected)!.object) : undefined
  const scale3 = shownFit ? (typeof shownFit.scale === 'number' ? [shownFit.scale, shownFit.scale, shownFit.scale] : shownFit.scale) : []
  const keys = ['*', ...worn.filter((p) => p !== selected), ...(bot ? ['bot'] : [])]
  const shadowed = selected && sel ? (Object.keys(sel.from) as (keyof Fit)[]).filter((field) => own?.[field] !== undefined && sel.from[field] !== key) : []
  document.getElementById('fit')!.innerHTML = `
    <h1>Fit</h1>
    <div class="muted">Click a rigid piece, or pick it here.</div>
    <div class="worn">${pieces.length ? pieces.map((p) => `<button data-select="${esc(p)}" class="${p === selected ? 'on' : ''}">${esc(p)}<small>${slotOfPart(p) ?? ''}${fits[p] ? ' · fitted' : ''}</small></button>`).join('') : '<span class="muted">nothing rigid worn</span>'}</div>
    ${selected && shownFit && sel ? `
      <h3>Gizmo</h3>
      <div class="group">${(['translate', 'rotate', 'scale'] as const).map((m) => `<button data-mode="${m}" class="${gizmo.mode === m ? 'on' : ''}">${m}</button>`).join('')}</div>
      <h3>Save under</h3>
      <select id="key">${keys.map((k) => `<option value="${esc(k)}" ${k === key ? 'selected' : ''}>${k === '*' ? '* every look' : k === 'bot' ? 'bot' : `with ${esc(k)}`}</option>`).join('')}</select>
      <label class="row"><span>Size</span><input type="range" min="0.3" max="2" step="0.01" data-size value="${scale3[0]}"><code>${scale3[0].toFixed(2)}</code></label>
      <div class="axes">${axes('at', shownFit.at, 0.005)}${axes('turn', shownFit.turn, 1)}${axes('scale', scale3, 0.01)}</div>
      <div class="from">in effect: ${(['at', 'turn', 'scale'] as const).map((field) => `${field} ← ${sel.from[field] ?? 'made'}`).join(' · ')}</div>
      ${shadowed.length ? `<div class="warn">${shadowed.join(', ')} under "${esc(key)}" is overridden here by ${shadowed.map((field) => sel.from[field]).join(', ')}</div>` : ''}
      <div class="row"><button data-act="reset">Reset "${esc(key)}"</button><button data-act="reset-all">Reset every key</button></div>
      <div class="from">${Object.entries(fits[selected] ?? {}).map(([k, v]) => `${esc(k)}: ${esc(JSON.stringify(v))}`).join('<br>') || 'no fits: as made'}</div>` : ''}
    <h3>Line-up</h3>
    <button data-act="heads" class="${lineUp ? 'on' : ''}" ${bot ? 'disabled' : ''}>Try on every head</button>`
}

function renderBar() {
  document.getElementById('bar')!.innerHTML = `
    <div class="group">${POSES.map((p) => `<button data-pose="${p}" class="${p === shown ? 'on' : ''}">${p}</button>`).join('')}</div>
    <button data-act="play">${playing ? 'Pause' : 'Play'}</button>
    <input type="range" id="scrub" min="0" max="${LOOP}" step="0.01" value="${t % LOOP}">
    <span id="clock">${(t % LOOP).toFixed(2)} s</span>
    <div class="group">${(Object.keys(VIEWS) as View[]).map((v) => `<button data-view="${v}" class="${v === view ? 'on' : ''}">${v}</button>`).join('')}</div>`
}

function renderPanels() {
  renderLook()
  renderFit()
  renderBar()
}

function change(next: Partial<Draft>) {
  draft = { ...draft, ...next }
  redress()
}

document.body.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-species],[data-pose],[data-view],[data-select],[data-mode],[data-swatch]')
  if (!el) return
  const d = el.dataset
  if (d.species) change({ species: d.species as Draft['species'] })
  if (d.pose) setPose(d.pose as PoseName)
  if (d.view) setView(d.view as View)
  if (d.select) select(d.select)
  if (d.mode) (gizmo.setMode(d.mode as 'translate'), renderFit())
  if (d.swatch) change({ [d.swatch]: d.value })
  if (d.act === 'blank') setLook('blank')
  if (d.act === 'hash') setLook({ id: (document.getElementById('hash') as HTMLInputElement).value || 'worker' })
  if (d.act === 'play') ((playing = !playing), renderBar())
  if (d.act === 'heads') setHeads(!lineUp)
  if (d.act === 'reset' && selected) setFit(selected, null, key)
  if (d.act === 'reset-all' && selected) for (const k of Object.keys(fits[selected] ?? {})) setFit(selected, null, k)
})

document.body.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement
  const d = el.dataset
  if (el.id === 'scrub') {
    playing = false
    t = Number(el.value)
    animate()
    document.getElementById('clock')!.textContent = `${t.toFixed(2)} s`
    return
  }
  if (d.size !== undefined && selected) writeFit(selected, { ...(fits[selected]?.[key] ?? {}), scale: Number(el.value) }, key)
  if (d.build) draft = { ...draft, build: { ...draft.build, [d.build]: Number(el.value) } }
  if (el.type === 'color' && d.draft) draft = { ...draft, [d.draft]: el.value }
  if (d.build || (el.type === 'color' && d.draft)) restage()
  const label = el.nextElementSibling
  if (el.type === 'range' && label?.tagName === 'CODE') label.textContent = Number(el.value).toFixed(2)
})

document.body.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement | HTMLInputElement
  const d = el.dataset
  if (d.slot) change({ slots: { ...draft.slots, [d.slot]: el.value || undefined } })
  if (el.tagName === 'SELECT' && d.draft) change({ [d.draft]: el.value })
  if (el.id === 'key') ((key = el.value), renderFit())
  if (el.type === 'range' || el.type === 'color') renderPanels()
  if (d.field && selected) {
    const inputs = [...document.querySelectorAll<HTMLInputElement>(`[data-field="${d.field}"]`)].map((i) => Number(i.value))
    const value = d.field === 'scale' && inputs.every((v) => v === inputs[0]) ? inputs[0] : inputs
    setFit(selected, { ...(fits[selected]?.[key] ?? {}), [d.field]: value }, key)
  }
})

const pointer = new THREE.Vector2()
let down: { x: number; y: number } | undefined
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }))
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || gizmo.dragging) return
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(pointer, camera)
  const worn = [...figures[0].worn]
  const hit = ray.intersectObjects(worn.map(([, w]) => w.object), true)[0]
  if (!hit) return
  const found = worn.find(([, w]) => {
    let o: THREE.Object3D | null = hit.object
    while (o && o !== w.object) o = o.parent
    return o !== null
  })
  if (found) select(found[0])
})

function setPose(name: PoseName, at?: number) {
  if (!POSES.includes(name)) throw new Error(`no pose "${name}": ${POSES.join(', ')}`)
  shown = name
  for (const f of figures) f.avatar.rig.last = f.avatar.rig.fade = undefined
  if (at !== undefined) ((t = at), (playing = false))
  animate()
  frame()
  renderBar()
  return state()
}

function setView(v: View) {
  if (!(v in VIEWS)) throw new Error(`no view "${v}": ${Object.keys(VIEWS).join(', ')}`)
  view = v
  frame()
  renderBar()
}

function setHeads(on: boolean) {
  lineUp = on
  redress()
  frame()
  return state()
}

type LookSpec = 'blank' | { id: string } | { draft: Partial<Draft> }

function setLook(spec: LookSpec) {
  draft = spec === 'blank' ? blank() : 'id' in spec ? { ...draftOfLook(lookOf(spec.id, models.cast.slots)), hue: `#${hueOf(spec.id).getHexString()}` } : { ...draft, ...spec.draft }
  redress()
  frame()
  return state()
}

function state() {
  const worn = wornParts(draft)
  return {
    draft,
    pose: shown,
    t,
    view,
    heads: lineUp ? figures.length : 1,
    selected,
    key,
    worn: [...figures[0].worn.keys()].map((part) => ({ part, slot: slotOfPart(part), ...fitFrom(part, worn, draft.species === 'bot') })),
    fits,
  }
}

function where(part: string) {
  const piece = figures[0].worn.get(part)
  if (!piece) throw new Error(`"${part}" is not worn rigid: ${[...figures[0].worn.keys()].join(', ')}`)
  const p = piece.object.getWorldPosition(new THREE.Vector3()).project(camera)
  return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight }
}

async function shot({ w = 1200, h = 900 }: { w?: number; h?: number } = {}) {
  const helper = gizmo.getHelper()
  const was = helper.visible
  helper.visible = false
  renderer.setPixelRatio(1)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  frame(1)
  renderer.render(scene, camera)
  const data = canvas.toDataURL('image/png')
  helper.visible = was
  resize()
  frame()
  return data
}

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

const ready = loadModels().then((m) => {
  models = m
  const q = new URLSearchParams(location.search)
  draft = q.get('id') ? { ...draftOfLook(lookOf(q.get('id')!, m.cast.slots)), hue: `#${hueOf(q.get('id')!).getHexString()}` } : blank()
  if (q.get('pose')) shown = q.get('pose') as PoseName
  if (q.get('view')) view = q.get('view') as View
  redress()
  frame()
})

declare global {
  interface Window {
    dresser: {
      ready(): Promise<void>
      look(spec: LookSpec): ReturnType<typeof state>
      pose(name: PoseName, at?: number): ReturnType<typeof state>
      fit(part: string, fit: Fit | null, key?: string): ReturnType<typeof state>
      select(part: string | undefined): void
      heads(on: boolean): ReturnType<typeof state>
      view(v: View): void
      state(): ReturnType<typeof state>
      where(part: string): { x: number; y: number }
      shot(size?: { w?: number; h?: number }): Promise<string>
    }
  }
}

window.dresser = { ready: () => ready, look: setLook, pose: setPose, fit: setFit, select, heads: setHeads, view: setView, state, where, shot }

let last = performance.now()
renderer.setAnimationLoop((now) => {
  if (playing && models) {
    t += (now - last) / 1000
    animate()
    const scrub = document.getElementById('scrub') as HTMLInputElement | null
    if (scrub) scrub.value = String(t % LOOP)
    const clock = document.getElementById('clock')
    if (clock) clock.textContent = `${(t % LOOP).toFixed(2)} s`
  }
  last = now
  orbit.update()
  renderer.render(scene, camera)
})
