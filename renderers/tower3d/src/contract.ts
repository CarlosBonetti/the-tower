/**
 * What each model must hold for the renderer to use it: nodes it reaches by name (pivots it moves, anchors it hangs
 * things on, bones it poses) and materials it recolors, for the Blender models (models/*.py); and the parts and clips
 * of the KayKit characters workers are made of (kaykit/Characters). `npm test` checks every asset against it. Imports
 * nothing, so Node reads it as well as the bundle.
 */

export const MODEL_NAMES = ['bar', 'bookcase', 'bot', 'calico', 'console', 'couch', 'desk', 'dj', 'hands', 'kiosk', 'plane', 'tabby', 'tv', 'tuxedo', 'wear'] as const
export type ModelName = (typeof MODEL_NAMES)[number]

export const HATS = ['hat_beanie', 'hat_cap', 'hat_crown', 'hat_bow', 'hat_flower']
export const FACES = ['face_glasses', 'face_shades']

/**
 * KayKit's `Rig_Medium`, the skeleton every worker stands on, by the names three.js gives its bones (glTF's `hand.r`
 * is `handr`). Clips move them; the bot's parts ride them.
 */
export const BONES = [
  'root', 'hips', 'spine', 'chest', 'head',
  'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr',
  'upperlegl', 'lowerlegl', 'footl', 'toesl', 'upperlegr', 'lowerlegr', 'footr', 'toesr',
] as const
export type Bone = (typeof BONES)[number]

/** The KayKit Adventurers whose bodies, heads and atlases a worker is dressed from. */
export const ADVENTURERS = ['Knight', 'Mage', 'Rogue', 'Barbarian'] as const
export type Adventurer = (typeof ADVENTURERS)[number]

/** The skinned parts every adventurer has, named `<Adventurer>_<part>`. */
export const BODY_PARTS = ['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight'] as const
/** Heads, each in its adventurer's atlas: the rogue's comes hooded too. */
export const HEADS = ['Knight_Head', 'Mage_Head', 'Rogue_Head', 'Rogue_Head_Hooded', 'Barbarian_Head'] as const
/** Rigid parts on the head bone, and capes on the chest bone. */
export const HELMS = ['Knight_Helmet', 'Mage_Hat', 'Barbarian_Hat'] as const
export const CAPES = ['Knight_Cape', 'Mage_Cape', 'Rogue_Cape', 'Barbarian_Cape'] as const
/** Gear held in the right hand (`handslotr`), out while a worker stands. */
export const GEAR = ['Mug', '1H_Wand', 'Spellbook', '1H_Sword', '1H_Axe', 'Knife'] as const

export const ADVENTURER_PARTS = [...ADVENTURERS.flatMap((a) => BODY_PARTS.map((p) => `${a}_${p}`)), ...HEADS, ...HELMS, ...CAPES, ...GEAR]

/** KayKit's own clips on `Rig_Medium` (Character Animations 1.1) that poses play. */
export const CLIPS = ['Idle_A', 'Idle_B', 'Walking_A', 'Sit_Chair_Idle', 'Cheering', 'Waving', 'Jump_Idle', 'Interact', 'Use_Item', 'Working_A', 'Holding_A'] as const
export type ClipName = (typeof CLIPS)[number]

/**
 * The bot (models/bot.py), modelled standing in the rig's rest pose (a T-pose, 2.2 units tall, facing +z): a pivot
 * per bone it rides, named as the bone, with `hat` and `face` under `head` for what it wears, and its status light. Parts
 * in its hue (`hue_own`) are optional.
 */
const BOT = { nodes: ['hips', 'chest', 'head', 'upperarml', 'lowerarml', 'upperarmr', 'lowerarmr', 'upperlegl', 'lowerlegl', 'footl', 'upperlegr', 'lowerlegr', 'footr', 'hat', 'face'], materials: ['bulb_glow_own'] }

/** A cat (models/catkit.py): pivots `head`, `tail` and its front paws, `paw_L` and `paw_R`, that its poses move. */
const CAT = { nodes: ['head', 'tail', 'paw_L', 'paw_R'], materials: [] }

export type Contract = { nodes: string[]; materials: string[] }

export const CONTRACT: Record<ModelName, Contract> = {
  bot: BOT,
  wear: { nodes: [...HATS, ...FACES], materials: ['wear_own'] },
  tabby: CAT,
  calico: CAT,
  tuxedo: CAT,
  bar: { nodes: [], materials: ['strip_glow_own'] },
  dj: { nodes: [], materials: ['neon_glow_own'] },
  console: { nodes: [], materials: ['tint_glow_own'] },
  bookcase: { nodes: [], materials: [] },
  couch: { nodes: [], materials: [] },
  desk: { nodes: ['chair'], materials: [] },
  /** Your own hands in first person: a pivot per hand at its palm, in camera space. */
  hands: { nodes: ['hand_L', 'hand_R'], materials: [] },
  kiosk: { nodes: [], materials: [] },
  /** The plane over the airfield: `prop` spins about z, `strobe` holds the lights that blink. */
  plane: { nodes: ['prop', 'strobe'], materials: [] },
  tv: { nodes: [], materials: [] },
}

/** What a model lacks of its contract, given the names it holds; empty when it keeps it. */
export const missing = (c: Contract, held: { nodes: string[]; materials: string[] }) => [
  ...c.nodes.filter((n) => !held.nodes.includes(n)).map((n) => `node ${n}`),
  ...c.materials.filter((m) => !held.materials.includes(m)).map((m) => `material ${m}`),
]
