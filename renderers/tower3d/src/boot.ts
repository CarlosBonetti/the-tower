import { FIXTURE } from './fixtures.ts'
import { startLighting } from './light/setting.ts'
import { drop, stage } from './loading.ts'

/** Tower 3D's entry: what must be known before the page's modules build anything, then the page. */
if (FIXTURE !== undefined) drop()
startLighting().then(() => (stage('models'), import('./main.ts')))
