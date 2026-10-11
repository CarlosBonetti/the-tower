/**
 * The dresser's tools (renderers/tower3d/dresser.html): serve it to dress workers by hand and save the wardrobe, and
 * shoot a look headless through the same page, so an agent checks a fit from a picture.
 *
 *   npm run tool:dresser -- serve [--port 4396]        the dresser at http://127.0.0.1:<port>/dresser.html, rebuilt
 *                                                      on every load; its Save writes renderers/tower3d/wardrobe.json
 *                                                      (PUT /wardrobe, checked by parseWardrobe and written by
 *                                                      formatWardrobe; the page checks it against the catalogue first)
 *   npm run tool:dresser -- shot <outfit|id|CALLSIGN|blank> [--pose stand|sit|type|walk|wave|cheer|dance] [--at <s>]
 *                                [--view front|side|face|three-quarter] [--heads all] [--size 1200x900] [--out file.png]
 *                                                      a PNG of the look: an outfit of wardrobe.json, or a session id
 *                                                      hashed as Tower 3D hashes it (a callsign is read from
 *                                                      `tower agent`), posed at --at seconds; --heads all lines it up
 *                                                      on every head
 *
 * Shots land in --out, else in $TMPDIR/dresser. Paths are printed, one per line.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { designCss, fonts } from '../src/shared/design.ts'
import { fontFile } from '../src/packages.ts'
import { formatWardrobe, parseWardrobe } from '../renderers/tower3d/src/wardrobe.ts'
import { withPage } from './drive.ts'

const REPO = path.resolve(import.meta.dirname, '..')
const OUT = path.join(REPO, 'renderers/tower3d/out')
const WARDROBE = path.join(REPO, 'renderers/tower3d/wardrobe.json')
const wardrobe = () => parseWardrobe(JSON.parse(fs.readFileSync(WARDROBE, 'utf8')), path.relative(REPO, WARDROBE))

/** Writes the wardrobe a page sends, if it is one, as its file holds it. */
function saveWardrobe(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = ''
  req.setEncoding('utf8')
  req.on('data', (chunk: string) => (body += chunk))
  req.on('end', () => {
    try {
      fs.writeFileSync(WARDROBE, formatWardrobe(parseWardrobe(JSON.parse(body), 'the wardrobe sent')))
      console.log(`saved ${path.relative(REPO, WARDROBE)}`)
      res.writeHead(204).end()
    } catch (e) {
      res.writeHead(422, { 'content-type': 'text/plain' }).end((e as Error).message)
    }
  })
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2' }

const build = () => execFileSync('npm', ['run', '-s', 'tower3d'], { cwd: REPO, stdio: 'pipe' })

/** The built Tower 3D pages, with the tower's design sheet and faces, on a loopback port. */
async function serve(port: number, rebuild: boolean) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url!, 'http://x').pathname)
    if (url === '/wardrobe' && req.method === 'HEAD') return res.writeHead(204).end()
    if (url === '/wardrobe' && req.method === 'PUT') return saveWardrobe(req, res)
    if (url === '/design.css') return res.writeHead(200, { 'content-type': 'text/css' }).end(designCss())
    const face = fonts.find((f) => url === `/fonts/${f.file}`)
    if (face) return res.writeHead(200, { 'content-type': 'font/woff2' }).end(fs.readFileSync(fontFile(face)))
    if (url === '/dresser.html' && rebuild) build()
    const file = path.join(OUT, url)
    if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r))
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/dresser.html` }
}

/** A callsign's session id, from `tower agent`; anything else is taken as the id itself. */
function sessionOf(who: string) {
  if (!/^[A-Z]+-\d+$/.test(who)) return who
  const id = /session (\S+?),/.exec(execFileSync('tower', ['agent', who], { encoding: 'utf8' }))?.[1]
  if (!id) throw new Error(`no session for ${who} in \`tower agent ${who}\``)
  return id
}

const size = (s: string) => {
  const [w, h] = s.split('x').map(Number)
  if (!w || !h) throw new Error(`--size wants WxH, got ${s}`)
  return { w, h }
}

async function shot(who: string, opts: { pose?: string; at?: string; view?: string; heads?: string; size?: string; out?: string }) {
  build()
  const { server, url } = await serve(0, false)
  try {
    await withPage(url, { width: 640, height: 480 }, async (page) => {
      await page.eval('dresser.ready()')
      const spec = who === 'blank' ? 'blank' : who in wardrobe().outfits ? { outfit: who } : { id: sessionOf(who) }
      await page.eval(`dresser.look(${JSON.stringify(spec)})`)
      if (opts.heads === 'all') await page.eval('dresser.heads(true)')
      await page.eval(`dresser.pose(${JSON.stringify(opts.pose ?? 'stand')}, ${Number(opts.at ?? 0.5)})`)
      await page.eval(`dresser.view(${JSON.stringify(opts.view ?? 'three-quarter')})`)
      const data = (await page.eval(`dresser.shot(${JSON.stringify(size(opts.size ?? '1200x900'))})`)) as string
      const file = path.resolve(opts.out ?? path.join(os.tmpdir(), 'dresser', `${who.replace(/[^a-z0-9_-]+/gi, '_')}-${opts.pose ?? 'stand'}-${opts.view ?? 'three-quarter'}${opts.heads ? '-heads' : ''}.png`))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
      console.log(file)
    })
  } finally {
    server.close()
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { port: { type: 'string' }, pose: { type: 'string' }, at: { type: 'string' }, view: { type: 'string' }, heads: { type: 'string' }, size: { type: 'string' }, out: { type: 'string' } },
  })
  if (command === 'serve') {
    build()
    const { url } = await serve(Number(values.port ?? 4396), true)
    return console.log(url)
  }
  if (command === 'shot') return shot(positionals[0] ?? fail('usage: shot <id|CALLSIGN|blank>'), values)
  fail('usage: npm run tool:dresser -- serve | shot (see scripts/dresser.ts)')
}

function fail(message: string): never {
  throw new Error(message)
}

main().catch((e: Error) => {
  console.error(e.message)
  process.exit(1)
})
