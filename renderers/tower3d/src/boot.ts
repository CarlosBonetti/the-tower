import { startLighting } from './light/setting.ts'

/** Tower 3D's entry: what must be known before the page's modules build anything, then the page. */
startLighting().then(() => import('./main.ts'))
