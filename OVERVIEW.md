# Quiet timeline

Groups each run of thinking and tool calls into one row, so a long agent run reads
as the assistant's messages with one activity row between them.

- **Collapsed**, the row names everything that happened, thinking included:
  "Thought 2 times, ran 3 commands, and read 1 file". While the agent works it shows
  a "working" dot and the latest thinking or tool call, so you can watch reasoning
  stream without opening anything.
- **One tap** opens the run in order: every thinking block in full, and every tool
  call with its command or target and its output. Runs with more than 60 tool calls
  show the newest 60 first, with a button for earlier ones. Every thinking block is
  always shown.

Messages, todo lists, errors, plan approvals and `speak` calls end a run, as they
do in Paseo's own Summary display.

## How it works

Paseo's Summary groups stop at the first reasoning item and only list tool calls,
so the plugin draws the whole run itself. It keeps a read-only mirror of each open
agent's timeline over the plugin API, and decides for each reasoning or tool call
item whether to draw the run's row, hide the item because that row already shows
it, or draw the item on its own.

Nothing is dropped without being drawn. Until an agent's mirror has loaded, or if
it fails, items are drawn on their own, so thinking stays visible.

The plugin only changes what the client draws. It never writes agent data, and it
does not alter stored history: disabling it brings back Paseo's own rows.

## Checks

- `npm run typecheck` and `npm test`: grouping, live updates, older history, and
  the rule that every hidden item belongs to a drawn row.
- In Paseo, a turn with thinking and tool calls shows one row per run whose summary
  starts with "Thought", and tapping it shows the thinking text and each call.
