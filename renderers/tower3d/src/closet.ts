import json from '../wardrobe.json'
import { parseWardrobe, problems, type Catalogue } from './wardrobe.ts'

/** The wardrobe workers are dressed from (renderers/tower3d/wardrobe.json), embedded by the build and checked as it loads. */
export const WARDROBE = parseWardrobe(json, 'renderers/tower3d/wardrobe.json')

/** Throws every name the wardrobe holds that the catalogue has no part for, and every fit it cannot apply. */
export function checkWardrobe(c: Catalogue) {
  const wrong = problems(WARDROBE, c)
  if (wrong.length) throw new Error(`renderers/tower3d/wardrobe.json:\n${wrong.map((p) => `  ${p}`).join('\n')}`)
}
