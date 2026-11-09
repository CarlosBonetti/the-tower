const BIN = new URL('../bin', import.meta.url).pathname

/**
 * The tower mod for opencode, loaded by every opencode session the tower starts (`opencodeEnv` in
 * src/shared/launch.ts names it in `OPENCODE_CONFIG_CONTENT`). It posts opencode's events to the host, which appends
 * each to the session's log as an `h` event named `opencode.<name>`: opencode's own name for it, carrying opencode's own
 * fields (a tool call's output left out, as Claude's is). Only the main session's are posted: a subagent's session,
 * one with a parent, is left out. Each hook awaits its post, so events reach the log in the order opencode raised them.
 *
 * It also puts `tower` on the PATH of every command the agent runs, and adds the tower's brief (`TOWER_BRIEF`) to
 * every system prompt: opencode takes no instructions on its command line.
 *
 * It runs inside opencode, under Bun, whose `fetch` reaches a unix socket through its `unix` option.
 */

/**
 * opencode's bus events the tower reads, posted as they come: a new session (`session.created`; one continued raises
 * none), a turn's end (`session.idle`), a failure (`session.error`), a permission asked and answered, and a compaction.
 */
const EVENTS = new Set(['session.created', 'session.idle', 'session.error', 'permission.asked', 'permission.updated', 'permission.replied', 'session.compacted'])

/** @param {string} name @param {object} data */
async function forward(name, data) {
  const response = await fetch(`http://host/hooks/${process.env.TOWER_SESSION_ID}`, {
    method: 'POST',
    unix: process.env.TOWER_HOOKS_SOCKET,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...data, hook_event_name: `opencode.${name}` }),
  })
  if (!response.ok) throw new Error(`host answered ${response.status} to opencode.${name}`)
}

/** The text a user message carries, its parts joined. @param {{ type: string, text?: string, synthetic?: boolean }[]} parts */
const textOf = (parts) =>
  parts
    .filter((p) => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')

export const Tower = async ({ directory }) => {
  /** The sessions opencode started under another, its subagents'. @type {Set<string>} */
  const children = new Set()
  const main = (/** @type {string | undefined} */ sessionID) => sessionID === undefined || !children.has(sessionID)
  await forward('start', { directory })
  return {
    event: async ({ event }) => {
      const props = /** @type {any} */ (event.properties ?? {})
      if (event.type === 'session.created' && props.info.parentID) children.add(props.info.id)
      if (!EVENTS.has(event.type) || !main(props.sessionID)) return
      await forward(event.type, props)
    },
    'chat.message': async (input, output) => {
      if (!main(input.sessionID)) return
      await forward('chat.message', { sessionID: input.sessionID, agent: input.agent, model: input.model, text: textOf(output.parts) })
    },
    'tool.execute.before': async (input) => {
      if (main(input.sessionID)) await forward('tool.execute.before', input)
    },
    'tool.execute.after': async (input, output) => {
      if (main(input.sessionID)) await forward('tool.execute.after', { tool: input.tool, sessionID: input.sessionID, callID: input.callID, title: output.title })
    },
    'shell.env': async (_input, output) => {
      output.env.PATH = `${BIN}:${process.env.PATH}`
    },
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push(/** @type {string} */ (process.env.TOWER_BRIEF))
    },
  }
}
