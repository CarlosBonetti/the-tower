---
{
  "type": "decision",
  "name": "A spawn can run opencode",
  "summary": "A spawn's runtime is claude, the default, or opencode, which runs any provider/model opencode offers (openai/gpt-6-sol). The tower composes opencode's command line and env, the host runs it unchanged, a plugin of the tower mod posts opencode's events under opencode.* names, and the bridge reads its status, model and conversations from them. opencode takes no effort, named command or typed callsign, and its workers are reached with tower submit.",
  "in": "tower",
  "status": "accepted",
  "date": "2026-11-09",
  "reviewed": "2026-11-09",
  "refs": ["hub/src/shared/model.ts#RUNTIMES", "hub/src/shared/model.ts#runtimeCommands", "hub/src/shared/launch.ts#opencodeSpawn", "hub/src/shared/launch.ts#opencodeResume", "hub/src/shared/launch.ts#runtimeSpawn", "hub/src/shared/launch.ts#launchOf", "hub/src/shared/launch.ts#OPENCODE_ENV", "hub/src/tower/dispatch.ts#runtimeRefused", "hub/src/tower/dispatch.ts#launchWithDefaults", "hub/src/mod/opencode/tower.js", "hub/src/mod/bin/tower", "hub/src/bridge/status.ts", "hub/src/bridge/conversation.ts#conversationsAfter", "hub/src/directory.ts"]
}
---
**Problem.** Some work wants a model only another agent's providers offer (OpenAI's Sol and Astra, say), and a worker
should be able to hire one the way it hires a Claude: on a prompt, in a worktree, in its crew, on the board.

**Why.** The host already runs any `argv` and `env` and only labels the runtime ([[host-owns-ptys]], protocol 5), and
the log is the one interface the bridge reads ([[logs-are-facts]]). A second runtime is then a composer in the tower,
a mod that posts the runtime's events to the host, and a reading of those events in the bridge: no host change.

**How.**
- *Asking for it.* The spawn verb takes `runtime` ([[renderer-api-contract]], API 1.171); `tower hire runtime opencode
  model openai/gpt-6-sol` and `tower spawn --runtime opencode` pass it. No renderer draws it. A spawn asking opencode
  for `effort`, a named `command` (`argv` is Claude's) or a typed `callsign` (opencode has no session name to carry it
  in the argv, so the callsign is the session id's) is refused as `invalid`
  ([`runtimeRefused`](ref:hub/src/tower/dispatch.ts#runtimeRefused)). Claude's defaults and the project's preferred
  command are Claude's, so an opencode launch is taken as asked ([`launchWithDefaults`](ref:hub/src/tower/dispatch.ts#launchWithDefaults)).
- *The command line.* `opencode` (the config's `env` over it, [`runtimeCommands`](ref:hub/src/shared/model.ts#runtimeCommands)),
  then contributors' `args.opencode`, `--auto` (auto mode: every permission not explicitly denied is approved, so a
  worker never waits on a prompt nobody watches), `--model`, and the prompt as `--prompt=<text>`, so one starting with `-` is no
  flag ([`opencodeSpawn`](ref:hub/src/shared/launch.ts#opencodeSpawn)); a resume passes `--session <id>`
  ([`opencodeResume`](ref:hub/src/shared/launch.ts#opencodeResume)). [`launchOf`](ref:hub/src/shared/launch.ts#launchOf)
  reads a header back by its runtime.
- *The env.* opencode takes no instructions on its command line, so the tower sets ([`OPENCODE_ENV`](ref:hub/src/shared/launch.ts#OPENCODE_ENV),
  which no contributor may set): `OPENCODE_CONFIG_CONTENT`, which opencode merges over the user's config, naming the
  tower's plugin and the floor's extensions' `plugins.opencode`; `TOWER_BRIEF`, an opencode variant of the brief (no
  SendMessage, the handbook as a file) with the worktree line and contributors' system prompt; and `TOWER_NODE`, the
  node the tower runs on, which `tower` runs on ([`src/mod/bin/tower`](ref:hub/src/mod/bin/tower)): opencode's shell
  reads the user's profile, which can put an older node first on the PATH. The config's `plugins` are Claude plugin
  directories and are not passed ([[plugins]]).
- *The mod.* [`src/mod/opencode/tower.js`](ref:hub/src/mod/opencode/tower.js) posts, for the main session only (a
  subagent's session has a parent), `opencode.start`, `opencode.chat.message` (its text and model),
  `opencode.tool.execute.before`/`after` (no output) and the bus events `session.created`, `session.idle`,
  `session.error`, `permission.asked`/`updated`/`replied` and `session.compacted`, each under `opencode.<name>`. It puts
  `tower` on the PATH of the agent's commands (`shell.env`) and adds `TOWER_BRIEF` to every system prompt.
- *The reading.* Status ([`status.ts`](ref:hub/src/bridge/status.ts)): start idle; a prompt, a tool call or a
  permission answered working; a permission asked needs input; `session.idle` done, unless a `session.error` before
  it left it failed, or idle for an abort. Conversations ([`conversationsAfter`](ref:hub/src/bridge/conversation.ts#conversationsAfter)):
  `session.created` enters a saved one; a prompt to a session never created here is one resumed, which links the
  resume chain. A card's model is its latest prompt's `provider/model`, and it carries `runtime`.
- *Reaching one.* An opencode worker has no **message as** name: `tower agents`, `tower agent`, `tower whoami` and a
  hire's reply name `tower submit <id> <text>` instead ([`directory.ts`](ref:hub/src/directory.ts)), and its brief
  says to report to its hirer that way.

**Alternatives considered.**
- *Posting opencode's events under Claude's hook names.* Rejected: a log line records what happened, not an
  interpretation ([[logs-are-facts]]); the bridge maps opencode's names.
- *The brief as the first prompt.* Rejected: it would show in the transcript and the board's prompt line, and a
  resume would not carry it; the plugin's system-prompt transform reaches every turn.
- *Prefixing node's directory on the PATH in `shell.env`.* Tried: the user's profile, read by opencode's shell after
  it, put Volta's node first again. `TOWER_NODE` reaches the `tower` script whatever the PATH says.
- *A config key for opencode's command.* Left out until wanted: `opencode` on the host's PATH is the one command.
