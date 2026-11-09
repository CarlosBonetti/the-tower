import assert from 'node:assert/strict'
import { test } from 'node:test'
import { launchWithDefaults, runtimeRefused, spawnLaunchOf } from '../src/tower/dispatch.ts'
import type { Config } from '../src/shared/model.ts'

test("spawnLaunchOf: carries every field the API lets a spawn set, command included", () => {
  assert.deepEqual(spawnLaunchOf({ runtime: 'claude', model: 'opus', effort: 'high', prompt: 'go', command: 'mom' }), { runtime: 'claude', model: 'opus', effort: 'high', prompt: 'go', command: 'mom' })
  assert.equal(spawnLaunchOf({ prompt: 'go' }).command, undefined)
})

test("launchWithDefaults: fills in Claude's defaults and the project's preferred command when the spawn named neither", () => {
  const config: Config = { argv: { a: ['claude'], b: ['claude-mom'] }, env: {}, projects: { p: { name: 'p', hub: '/h', repos: [], command: 'b' } } }
  assert.equal(launchWithDefaults(config, 'p', { prompt: 'go' }, {}).command, 'b')
  assert.equal(launchWithDefaults(config, 'p', { prompt: 'go', command: 'a' }, {}).command, 'a', "a spawn's own choice wins over the project's preference")
  const single: Config = { argv: ['claude'], env: {}, projects: { p: { name: 'p', hub: '/h', repos: [] } } }
  assert.equal(launchWithDefaults(single, 'p', { prompt: 'go' }, {}).command, undefined)
})

test("launchWithDefaults: another runtime's launch is taken as asked, as the defaults and commands are Claude's", () => {
  const config: Config = { argv: { a: ['claude'], b: ['claude-mom'] }, env: {}, projects: { p: { name: 'p', hub: '/h', repos: [], command: 'b' } } }
  const launch = { runtime: 'opencode' as const, model: 'openai/gpt-6-sol', prompt: 'go' }
  assert.deepEqual(launchWithDefaults(config, 'p', launch, { model: 'opus', effort: 'high' }), launch)
})

test('runtimeRefused: opencode refuses effort, command and callsign, naming each; Claude refuses none', () => {
  assert.equal(runtimeRefused('claude', { effort: 'high', command: 'a', callsign: 'ZECA' }), undefined)
  assert.equal(runtimeRefused('opencode', {}), undefined)
  const refused = runtimeRefused('opencode', { effort: 'high', callsign: 'ZECA' })
  assert.equal(refused?.code, 'invalid')
  assert.match(refused!.message, /^effort, callsign: opencode takes none/)
})
