# Quiet timeline

Folds each run of thinking and tool calls into one grey row, so a long agent turn reads as the assistant's messages with a single line of activity between them.

## Install

```sh
paseo plugin install github:lued/paseo-quiet-timeline
```

Requires Paseo 0.12.0 or newer. No accounts, keys or extra packages.

## What it does

- **Collapsed**, one grey line drawn like Paseo's own tool rows: "Thought 2 times, ran 3 commands, and read 1 file", with the latest activity shown while the agent works.
- **Expanded**, the run in order — inline on a wide window, in a sheet on a phone. Thinking stays visible as grey text; each tool call opens its output.
- Keeps every thinking block and the newest **60 tool calls**; earlier ones load 200 at a time.
- Read-only. It mirrors the open agent's timeline and never writes agent data or stored history, so disabling it restores Paseo's own rows.
- If the mirror is still loading or fails, items are drawn individually — nothing is hidden.

## Limit

Tool output inside an expanded group is plain monospace text, not Paseo's code and diff viewer. The 0.12 SDK renders only plugin-owned item kinds and does not export the built-in tool row, so the native viewer cannot be embedded.

## Develop

```sh
npm ci
npm run typecheck && npm test
```

MIT. Design notes in [OVERVIEW.md](OVERVIEW.md).
