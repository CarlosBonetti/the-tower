/**
 * Experiments with procedural TypeScript models (src/proc), drawn only when the page is opened with `?proc=<names>`,
 * comma separated: `skyline`, `shell`, `roof`. Without it Tower 3D draws exactly what it always has.
 */
export const PROC = new Set((new URLSearchParams(location.search).get('proc') ?? '').split(',').filter(Boolean))
