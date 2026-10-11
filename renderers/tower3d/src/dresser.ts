import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ADVENTURERS, SLOTS, type Adventurer, type Slot } from './contract.ts'
import { avatar, fitted, place, seatedAt, type Avatar } from './avatar.ts'
import { CHAIR } from './chair.ts'
import { WARDROBE } from './closet.ts'
import { instance, loadModels, type Models } from './models.ts'
import { pose, type ClipKey, type Pose } from './rig.ts'
import { block, dispose, toon } from './toon.ts'
import { fitFrom, fitOf, formatWardrobe, lookNamed, lookOf, parseWardrobe, problems, wornBy, type Catalogue, type Fit, type Look, type Outfit, type Placement, type Vec3, type Wardrobe } from './wardrobe.ts'

/**
 * The dresser (dresser.html): a worker on a stand, dressed by the wardrobe as Tower 3D dresses it, to pick its parts
 * and colours, pose it, fit its rigid pieces by hand and keep looks as outfits. Edits change a copy of the wardrobe;
 * saving writes it to renderers/tower3d/wardrobe.json through `tool:dresser serve`, else it is copied as JSON.
 * `window.dresser` drives it:
 *
 *   await dresser.ready()                       the models are parsed
 *   dresser.look('blank' | { id } | { outfit } | { look })   dress the stand: blank, a session id hashed, an outfit,
 *                                               or fields laid over the look on the stand
 *   dresser.pose('sit', 1.2)                    a pose held at a time (seconds); without one it plays
 *   dresser.fit(part, fit | null, key?)         set or clear a part's fit under a key ('*' when none)
 *   dresser.outfit(name)                        keep the look as an outfit; dresser.unkeep(name) drops one
 *   dresser.wardrobe()                          the edited wardrobe as its file holds it
 *   await dresser.save()                        write it through the server, or throw why not
 *   dresser.heads(true)                         the look on every head, side by side
 *   dresser.view('face')                        front, side, face, three-quarter
 *   dresser.state()                             the look, what it wears rigid and each piece's fit and its source
 *   dresser.where(part)                         where a worn piece is on screen, CSS pixels: to click or drag at it
 *   await dresser.shot({ w, h })                a PNG data URL of the stand, without the gizmo
 */

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
const floor = new THREE.Group()
scene.add(stand, floor)

let models: Models
let cat: Catalogue
let wardrobe: Wardrobe = WARDROBE
/** The wardrobe as the file holds it, last loaded or saved: what "unsaved" is measured against. */
let saved = formatWardrobe(WARDROBE)
let look: Look
/** The outfit the look was loaded from or kept as, if any. */
let outfit: string | undefined
let shown: PoseName = 'stand'
let t = 0
let playing = true
let lineUp = false
let view: View = 'three-quarter'
let selected: string | undefined
/** The key a fit edit writes the selected piece's fit under: `*` for every look, else a part worn with it, or `bot`. */
let key = '*'
/** Whether `tool:dresser serve` is behind the page, to save to the file. */
let server = false
let note = ''
let mixOpen = false
let jsonOpen = false

/** A worker on the stand: its look, avatar and chair. */
type Figure = { group: THREE.Group; avatar: Avatar; chair: THREE.Object3D; look: Look }
let figures: Figure[] = []

const partIn = (l: Look, slot: Slot) => l.parts.find((p) => cat.parts[p].slot === slot)
const withPart = (l: Look, slot: Slot, part: string | undefined): Look => {
  const rest = l.parts.filter((p) => cat.parts[p].slot !== slot)
  const parts = part === undefined ? rest : [...rest, part]
  return { ...l, parts: SLOTS.flatMap((s) => parts.filter((p) => cat.parts[p].slot === s)) }
}
/** The slots a species fills: a bot wears only the pieces of models/wear.py, on its own anchors. */
const slotsOf = (l: Look): readonly Slot[] => (l.species === 'bot' ? SLOTS.filter((s) => s === 'Hat' || s === 'Face') : SLOTS)

function blank(): Look {
  const { mix } = wardrobe
  return { species: 'adventurer', body: 'Knight', paint: 'Knight', parts: ['Knight_Head'], skin: mix.skins[1], hair: mix.hairs[1], wear: mix.wears[3], build: { width: 1, height: 1 } }
}

/** The look as the other species, keeping its colours, build and what both may wear. */
function asSpecies(l: Look, species: Look['species']): Look {
  if (l.species === species) return l
  const shared = l.parts.filter((p) => cat.parts[p].slot === 'Hat' || cat.parts[p].slot === 'Face')
  if (species === 'bot') return { species, hue: '#7aa2ff', parts: shared, wear: l.wear, build: l.build }
  const b = blank()
  return { ...(b as Extract<Look, { species: 'adventurer' }>), parts: ['Knight_Head', ...shared], wear: l.wear, build: l.build }
}

/** An outfit that dresses exactly this look: every slot set, a part or bare. */
function outfitOf(l: Extract<Look, { species: 'adventurer' }>): Outfit {
  return { body: l.body, paint: l.paint, skin: l.skin, hair: l.hair, wear: l.wear, build: l.build, slots: Object.fromEntries(SLOTS.map((s) => [s, partIn(l, s) ?? null])) }
}

const DEG = Math.PI / 180
const round = (v: number, digits: number) => Number(v.toFixed(digits)) + 0
const rounded = (xs: number[], digits: number) => xs.map((x) => round(x, digits)) as Vec3

/** The fit that carries a made placement to where an object stands now: `fitted`'s inverse. */
function fitOfObject(made: Placement, o: THREE.Object3D): Required<Fit> {
  const turn = new THREE.Euler().setFromQuaternion(o.quaternion.clone().multiply(new THREE.Quaternion().fromArray(made.quaternion).invert()))
  const scale = rounded(o.scale.toArray().map((s, i) => s / made.scale[i]), 3)
  return {
    at: rounded(o.position.toArray().map((p, i) => p - made.at[i]), 4),
    turn: rounded([turn.x / DEG, turn.y / DEG, turn.z / DEG], 1),
    scale: scale.every((s) => s === scale[0]) ? scale[0] : scale,
  }
}

function refit(f: Figure) {
  const worn = wornBy(f.look)
  for (const [part, { object, made }] of f.avatar.worn) place(object, fitted(made, fitOf(wardrobe, cat, part, worn)))
}

function figure(l: Look): Figure {
  const a = avatar(models, l, wardrobe)
  const chair = instance(models.desk).part('chair')
  chair.position.set(0, 0, 0)
  const group = new THREE.Group()
  group.add(chair, a.root)
  return { group, avatar: a, chair, look: l }
}

const SPACING = 0.8

/** The stand dressed in the look: one worker, or one per head side by side, the look's own head in the middle. */
function restage() {
  gizmo.detach()
  for (const f of figures) dispose(f.group, (map) => map.userData.shared)
  stand.clear()
  floor.clear()
  const heads: (string | undefined)[] = lineUp && look.species === 'adventurer' ? cat.slots.Head : [undefined]
  const all = heads.map((head) => figure(head === undefined ? look : withPart(look, 'Head', head)))
  const mine = Math.max(0, heads.indexOf(partIn(look, 'Head')))
  all.forEach((f, i) => {
    f.group.position.x = (i - mine) * SPACING
    stand.add(f.group)
  })
  floor.add(block((heads.length - 1) * SPACING + 1.6, 0.06, 1.6, toon('#3a4442'), ((heads.length - 1) / 2 - mine) * SPACING, -0.06, 0))
  figures = [all[mine], ...all.filter((_, i) => i !== mine)]
  if (selected && !figures[0].avatar.worn.has(selected)) selected = undefined
  if (!keysFor(selected).includes(key)) key = defaultKey()
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

/** The width the side panels take while they show, CSS pixels. */
const PANELS = 2 * 312

/** Points the camera at the stand from `view`, filling the `free` share of the canvas's width: the face close-up at the heads. */
function frame(free = Math.max(0.3, (innerWidth - PANELS) / innerWidth)) {
  stand.updateMatrixWorld(true)
  const box = new THREE.Box3()
  if (view === 'face') {
    for (const f of figures) box.expandByPoint(f.avatar.rig.bone('head').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0)))
    box.expandByScalar(0.45)
  } else for (const f of figures) box.expandByObject(f.avatar.root).union(f.chair.visible ? new THREE.Box3().setFromObject(f.chair) : new THREE.Box3())
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const dir = new THREE.Vector3(...VIEWS[view]).normalize()
  const tan = Math.tan((camera.fov * DEG) / 2)
  const fit = Math.max(size.y / 2 / tan, size.x / 2 / tan / camera.aspect / free)
  camera.position.copy(center).addScaledVector(dir, fit * 1.15 + size.z)
  orbit.target.copy(center)
  orbit.update()
}

function attach() {
  const piece = selected === undefined ? undefined : figures[0].avatar.worn.get(selected)
  if (piece) gizmo.attach(piece.object)
  else gizmo.detach()
}

/** What a piece's fit may be saved under: every look, a part worn with it (its body's parts too), or every bot. */
const keysFor = (part: string | undefined) => ['*', ...wornBy(look).filter((p) => p !== part)]
/** A fit is saved under the look's head unless chosen otherwise, or under `bot` on a bot. */
const defaultKey = () => (look.species === 'bot' ? 'bot' : partIn(look, 'Head') ?? '*')

function select(part: string | undefined) {
  if (part !== selected) key = defaultKey()
  selected = part
  attach()
  renderPanels()
}

/** Writes the selected piece's fit from the gizmo, under `key`: only the field the gizmo's mode moves. */
gizmo.addEventListener('objectChange', () => {
  if (!selected) return
  const { object, made } = figures[0].avatar.worn.get(selected)!
  const field = gizmo.mode === 'translate' ? 'at' : gizmo.mode === 'rotate' ? 'turn' : 'scale'
  setFit(selected, { ...wardrobe.fits[selected]?.[key], [field]: fitOfObject(made, object)[field] }, key)
})

function writeFit(part: string, fit: Fit | null, under: string) {
  const keys = { ...wardrobe.fits[part] }
  if (fit === null || Object.keys(fit).length === 0) delete keys[under]
  else keys[under] = fit
  const fits = { ...wardrobe.fits }
  if (Object.keys(keys).length) fits[part] = keys
  else delete fits[part]
  wardrobe = { ...wardrobe, fits }
  for (const f of figures) refit(f)
}

function setFit(part: string, fit: Fit | null, under = '*') {
  writeFit(part, fit, under)
  renderPanels()
  return state()
}

function keepOutfit(name: string) {
  if (look.species !== 'adventurer') throw new Error('an outfit dresses an adventurer: a bot is dressed by the mix alone')
  if (!name.trim()) throw new Error('an outfit needs a name')
  wardrobe = { ...wardrobe, outfits: { ...wardrobe.outfits, [name]: outfitOf(look) } }
  outfit = name
  look = { ...look, outfit: name }
  renderPanels()
  return state()
}

function unkeepOutfit(name: string) {
  const { [name]: _, ...outfits } = wardrobe.outfits
  const except = wardrobe.mix.outfits.except?.filter((n) => n !== name)
  wardrobe = { ...wardrobe, outfits, mix: { ...wardrobe.mix, outfits: { ...wardrobe.mix.outfits, except } } }
  if (outfit === name) outfit = undefined
  renderPanels()
  return state()
}

/** The edited wardrobe, checked as Tower 3D checks it when it loads. */
function checked() {
  const wrong = problems(wardrobe, cat)
  if (wrong.length) throw new Error(`the wardrobe has problems:\n${wrong.join('\n')}`)
  return formatWardrobe(wardrobe)
}

async function save() {
  const text = checked()
  if (!server) throw new Error('no tool:dresser server behind this page: copy the JSON into renderers/tower3d/wardrobe.json')
  const res = await fetch('wardrobe', { method: 'PUT', body: text })
  if (!res.ok) throw new Error(await res.text())
  saved = text
  return text
}

const say = (text: string) => ((note = text), renderFit())

function applyMix(text: string) {
  wardrobe = parseWardrobe({ ...wardrobe, mix: JSON.parse(text) }, 'the mix')
  checked()
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const options = (xs: readonly string[], on: string | undefined, bare?: string) =>
  (bare === undefined ? '' : `<option value="">${bare}</option>`) + xs.map((x) => `<option ${x === on ? 'selected' : ''}>${esc(x)}</option>`).join('')
const swatches = (field: string, xs: readonly string[], on: string) =>
  `<span class="swatches">${xs.map((c) => `<i data-swatch="${field}" data-value="${c}" class="${c === on ? 'on' : ''}" style="background:${c}"></i>`).join('')}</span>`
const colour = (field: 'skin' | 'hair' | 'wear' | 'hue', label: string, value: string, palette: readonly string[]) =>
  `<label class="row"><span>${label}</span><input type="color" data-look="${field}" value="${value}">${swatches(field, palette, value)}</label>`

function renderLook() {
  const { mix } = wardrobe
  const adv = look.species === 'adventurer' ? look : undefined
  const names = Object.keys(wardrobe.outfits).sort()
  document.getElementById('look')!.innerHTML = `
    <h1>Dresser</h1>
    <h3>Start from</h3>
    <div class="row"><input type="text" id="hash" placeholder="a session id"><button data-act="hash">Hash</button><button data-act="blank">Blank</button></div>
    <div class="group">${names.map((n) => `<button data-outfit="${esc(n)}" class="${n === outfit ? 'on' : ''}" title="${mix.outfits.except?.includes(n) ? 'worn only by name' : 'in the mix'}">${esc(n)}</button>`).join('')}</div>
    <h3>Body</h3>
    <div class="group">${(['adventurer', 'bot'] as const).map((s) => `<button data-species="${s}" class="${look.species === s ? 'on' : ''}">${s}</button>`).join('')}</div>
    ${adv ? `<label class="row"><span>Body</span><select data-look="body">${options(ADVENTURERS, adv.body)}</select></label>
    <label class="row"><span>Paint</span><select data-look="paint">${options(ADVENTURERS, adv.paint)}</select></label>` : colour('hue', 'Hue', look.species === 'bot' ? look.hue : '', [])}
    ${(['width', 'height'] as const).map((d) => `<label class="row"><span>${d[0].toUpperCase()}${d.slice(1)}</span><input type="range" min="0.85" max="1.15" step="0.01" data-build="${d}" value="${look.build[d]}"><code>${look.build[d].toFixed(2)}</code></label>`).join('')}
    <h3>Parts</h3>
    ${slotsOf(look).map((s) => `<label class="row"><span>${s}</span><select data-slot="${s}">${options(cat.slots[s], partIn(look, s), s === 'Head' ? undefined : '— bare —')}</select></label>`).join('')}
    <h3>Colours</h3>
    ${adv ? colour('skin', 'Skin', adv.skin, mix.skins) + colour('hair', 'Hair', adv.hair, mix.hairs) : ''}
    ${colour('wear', 'Wear', look.wear, mix.wears)}
    <h3>Outfit</h3>
    <div class="row"><input type="text" id="outfit-name" placeholder="a name" value="${esc(outfit ?? '')}"><button data-act="keep" ${adv ? '' : 'disabled'}>Keep</button>${outfit ? `<button data-act="unkeep">Drop</button>` : ''}</div>
    <div class="muted">${adv ? 'Keeps every slot as shown, bare ones too.' : 'Outfits dress adventurers.'}</div>`
}

function renderFit() {
  const f = figures[0]
  const pieces = [...f.avatar.worn.keys()]
  const piece = selected ? f.avatar.worn.get(selected) : undefined
  const resolved = selected ? fitFrom(wardrobe, cat, selected, wornBy(look)) : undefined
  const own = selected ? wardrobe.fits[selected]?.[key] : undefined
  const now = piece ? fitOfObject(piece.made, piece.object) : undefined
  const scale3 = now ? (typeof now.scale === 'number' ? [now.scale, now.scale, now.scale] : now.scale) : []
  const axes = (field: keyof Fit, values: number[], step: number) => `<b>${field}</b>${values.map((v, i) => `<input type="number" step="${step}" data-field="${field}" data-axis="${i}" value="${v}">`).join('')}`
  const shadowed = resolved ? (Object.keys(own ?? {}) as (keyof Fit)[]).filter((field) => resolved.from[field] !== key) : []
  const unsaved = formatWardrobe(wardrobe) !== saved
  document.getElementById('fit')!.innerHTML = `
    <h1>Fit</h1>
    <div class="muted">Click a rigid piece, or pick it here.</div>
    <div class="worn">${pieces.length ? pieces.map((p) => `<button data-select="${esc(p)}" class="${p === selected ? 'on' : ''}">${esc(p)}<small>${cat.parts[p].slot}${wardrobe.fits[p] ? ' · fitted' : ''}</small></button>`).join('') : '<span class="muted">nothing rigid worn</span>'}</div>
    ${selected && now && resolved ? `
      <h3>Gizmo</h3>
      <div class="group">${(['translate', 'rotate', 'scale'] as const).map((m) => `<button data-mode="${m}" class="${gizmo.mode === m ? 'on' : ''}">${m}</button>`).join('')}</div>
      <h3>Save under</h3>
      <select id="key">${keysFor(selected).map((k) => `<option value="${esc(k)}" ${k === key ? 'selected' : ''}>${k === '*' ? '* every look' : k === 'bot' ? 'every bot' : `with ${esc(k)}`}</option>`).join('')}</select>
      <label class="row"><span>Size</span><input type="range" min="0.3" max="2" step="0.01" data-size value="${scale3[0]}"><code>${scale3[0].toFixed(2)}</code></label>
      <div class="axes">${axes('at', now.at, 0.005)}${axes('turn', now.turn, 1)}${axes('scale', scale3, 0.01)}</div>
      <div class="from">in effect: ${(['at', 'turn', 'scale'] as const).map((field) => `${field} ← ${esc(resolved.from[field] ?? 'made')}`).join(' · ')}</div>
      ${shadowed.length ? `<div class="warn">${shadowed.join(', ')} under "${esc(key)}" is overridden here by ${shadowed.map((field) => esc(resolved.from[field]!)).join(', ')}</div>` : ''}
      <div class="row"><button data-act="reset">Reset "${esc(key)}"</button><button data-act="reset-all">Reset every key</button></div>
      <div class="from">${Object.entries(wardrobe.fits[selected] ?? {}).map(([k, v]) => `${esc(k)}: ${esc(JSON.stringify(v))}`).join('<br>') || 'no fits: as made'}</div>` : ''}
    <h3>Line-up</h3>
    <button data-act="heads" class="${lineUp ? 'on' : ''}" ${look.species === 'bot' ? 'disabled' : ''}>Try on every head</button>
    <h3>Wardrobe</h3>
    <div class="row">${server ? `<button data-act="save" ${unsaved ? '' : 'disabled'}>Save to wardrobe.json</button>` : ''}<button data-act="json" class="${jsonOpen ? 'on' : ''}">Copy JSON</button><button data-act="mix" class="${mixOpen ? 'on' : ''}">Mix</button></div>
    <div class="muted">${unsaved ? 'unsaved changes' : 'as saved'}${server ? '' : ' · no server: copy the JSON into renderers/tower3d/wardrobe.json'}</div>
    ${note ? `<div class="${note.startsWith('!') ? 'warn' : 'muted'}">${esc(note.replace(/^!/, ''))}</div>` : ''}
    ${jsonOpen ? `<textarea readonly>${esc(formatWardrobe(wardrobe))}</textarea>` : ''}
    ${mixOpen ? `<textarea id="mix">${esc(JSON.stringify(wardrobe.mix, null, 1))}</textarea><button data-act="apply-mix">Apply mix</button>` : ''}`
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

function change(next: Look) {
  look = next
  redress()
}

/** The look with one of its fields set from the panel. */
function withField(field: string, value: string): Look {
  if (field === 'body' || field === 'paint') {
    const l = look as Extract<Look, { species: 'adventurer' }>
    return field === 'body' && partIn(l, 'Head') === `${l.body}_Head` ? withPart({ ...l, body: value as Adventurer }, 'Head', `${value}_Head`) : { ...l, [field]: value }
  }
  return { ...look, [field]: value } as Look
}

const run = (act: () => unknown) => {
  try {
    act()
  } catch (e) {
    say(`!${(e as Error).message}`)
  }
}

document.body.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-species],[data-pose],[data-view],[data-select],[data-mode],[data-swatch],[data-outfit]')
  if (!el) return
  const d = el.dataset
  if (d.species) change(asSpecies(look, d.species as Look['species']))
  if (d.outfit) setLook({ outfit: d.outfit })
  if (d.pose) setPose(d.pose as PoseName)
  if (d.view) setView(d.view as View)
  if (d.select) select(d.select)
  if (d.mode) (gizmo.setMode(d.mode as 'translate'), renderFit())
  if (d.swatch) change(withField(d.swatch, d.value!))
  if (d.act === 'blank') setLook('blank')
  if (d.act === 'hash') setLook({ id: (document.getElementById('hash') as HTMLInputElement).value || 'worker' })
  if (d.act === 'play') ((playing = !playing), renderBar())
  if (d.act === 'heads') setHeads(!lineUp)
  if (d.act === 'reset' && selected) setFit(selected, null, key)
  if (d.act === 'reset-all' && selected) for (const k of Object.keys(wardrobe.fits[selected] ?? {})) setFit(selected, null, k)
  if (d.act === 'keep') run(() => keepOutfit((document.getElementById('outfit-name') as HTMLInputElement).value.trim()))
  if (d.act === 'unkeep' && outfit) unkeepOutfit(outfit)
  if (d.act === 'save') save().then(() => say('saved to renderers/tower3d/wardrobe.json: `npm run tower3d` puts it in Tower 3D'), (err: Error) => say(`!${err.message}`))
  if (d.act === 'json') run(() => ((jsonOpen = !jsonOpen), jsonOpen && navigator.clipboard.writeText(checked()).then(() => say('copied'), () => say('the clipboard refused: copy it from below')), renderFit()))
  if (d.act === 'mix') ((mixOpen = !mixOpen), renderFit())
  if (d.act === 'apply-mix') run(() => (applyMix((document.getElementById('mix') as HTMLTextAreaElement).value), redress(), say('mix applied')))
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
  if (d.size !== undefined && selected) writeFit(selected, { ...wardrobe.fits[selected]?.[key], scale: Number(el.value) }, key)
  if (d.build) look = { ...look, build: { ...look.build, [d.build]: Number(el.value) } }
  if (el.type === 'color' && d.look) look = withField(d.look, el.value)
  if (d.build || (el.type === 'color' && d.look)) restage()
  const label = el.nextElementSibling
  if (el.type === 'range' && label?.tagName === 'CODE') label.textContent = Number(el.value).toFixed(2)
})

document.body.addEventListener('change', (e) => {
  const el = e.target as HTMLSelectElement | HTMLInputElement
  const d = el.dataset
  if (d.slot) change(withPart(look, d.slot as Slot, el.value || undefined))
  if (el.tagName === 'SELECT' && d.look) change(withField(d.look, el.value))
  if (el.id === 'key') ((key = el.value), renderFit())
  if (el.type === 'range' || el.type === 'color') renderPanels()
  if (d.field && selected) {
    const inputs = [...document.querySelectorAll<HTMLInputElement>(`[data-field="${d.field}"]`)].map((i) => Number(i.value)) as Vec3
    setFit(selected, { ...wardrobe.fits[selected]?.[key], [d.field]: d.field === 'scale' && inputs.every((v) => v === inputs[0]) ? inputs[0] : inputs }, key)
  }
})

let down: { x: number; y: number } | undefined
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }))
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || gizmo.dragging) return
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera)
  const worn = [...figures[0].avatar.worn]
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

type LookSpec = 'blank' | { id: string } | { outfit: string } | { look: Partial<Look> }

function lookFrom(spec: LookSpec): Look {
  if (spec === 'blank') return blank()
  if ('id' in spec) return lookOf(spec.id, wardrobe, cat)
  if ('outfit' in spec) {
    if (!(spec.outfit in wardrobe.outfits)) throw new Error(`no outfit "${spec.outfit}": ${Object.keys(wardrobe.outfits).join(', ')}`)
    return lookNamed(spec.outfit, wardrobe, cat)
  }
  return { ...look, ...spec.look } as Look
}

function setLook(spec: LookSpec) {
  look = lookFrom(spec)
  outfit = look.species === 'adventurer' ? look.outfit : undefined
  redress()
  frame()
  return state()
}

function state() {
  const worn = wornBy(look)
  return {
    look,
    outfit,
    pose: shown,
    t,
    view,
    heads: figures.length,
    selected,
    key,
    worn: [...figures[0].avatar.worn.keys()].map((part) => ({ part, slot: cat.parts[part].slot, ...fitFrom(wardrobe, cat, part, worn) })),
    unsaved: formatWardrobe(wardrobe) !== saved,
    problems: problems(wardrobe, cat),
  }
}

function where(part: string) {
  const piece = figures[0].avatar.worn.get(part)
  if (!piece) throw new Error(`"${part}" is not worn rigid: ${[...figures[0].avatar.worn.keys()].join(', ')}`)
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

const ready = Promise.all([
  loadModels(),
  fetch('wardrobe', { method: 'HEAD' }).then((r) => r.ok, () => false),
]).then(([m, served]) => {
  models = m
  cat = m.catalogue
  server = served
  const q = new URLSearchParams(location.search)
  look = q.get('outfit') ? lookFrom({ outfit: q.get('outfit')! }) : q.get('id') ? lookFrom({ id: q.get('id')! }) : blank()
  outfit = look.species === 'adventurer' ? look.outfit : undefined
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
      outfit(name: string): ReturnType<typeof state>
      unkeep(name: string): ReturnType<typeof state>
      wardrobe(): string
      save(): Promise<string>
      select(part: string | undefined): void
      heads(on: boolean): ReturnType<typeof state>
      view(v: View): void
      state(): ReturnType<typeof state>
      where(part: string): { x: number; y: number }
      shot(size?: { w?: number; h?: number }): Promise<string>
    }
  }
}

window.dresser = {
  ready: () => ready.then(() => undefined),
  look: setLook,
  pose: setPose,
  fit: setFit,
  outfit: keepOutfit,
  unkeep: unkeepOutfit,
  wardrobe: () => formatWardrobe(wardrobe),
  save,
  select,
  heads: setHeads,
  view: setView,
  state,
  where,
  shot,
}

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
