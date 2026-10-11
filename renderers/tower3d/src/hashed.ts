/**
 * Chance derived from a name: the same on every board and every reload. What a worker looks like and does is hashed
 * from its session id. Imports nothing, so Node reads it as well as the bundle.
 */

const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}
/** A number in [0, 1) for `id`, its own for each `what`. */
export const roll = (id: string, what: string) => hash(`${id}#${what}`) / 2 ** 32
export const pick = <T>(xs: readonly T[], r: number) => xs[Math.floor(r * xs.length)]

/**
 * The one of `pool` that `id` takes for `what`: the candidate scoring highest for it (rendezvous hashing). Adding a
 * candidate moves only the ids it now scores highest for, about one in the pool's new size; removing one moves only
 * its own; the pool's order never matters.
 */
export const rendezvous = <T extends string>(id: string, what: string, pool: readonly T[]) => {
  let best = pool[0]
  let top = -1
  for (const p of pool) {
    const score = roll(id, `${what}=${p}`)
    if (score > top) [best, top] = [p, score]
  }
  return best
}
