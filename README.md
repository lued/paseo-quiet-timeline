# Quiet timeline

A Paseo plugin that turns each run of thinking and tool calls into one quiet grey
row. A long agent turn reads as the assistant's messages, with one activity row
between them, instead of a wall of thinking blocks and tool calls.

## What it does

- **Collapsed**, the row is a plain grey line drawn like Paseo's own tool call
  rows. It summarises the run: "Thought 2 times, ran 3 commands, and read 1
  file". While the agent is still working, the line also shows the latest
  thought or tool call.
- **Expanded**, it lists the run in order. On a wide desktop window the detail
  opens inline. On a phone or narrow window it opens in a sheet, the same way
  Paseo's Summary groups do.
- Thinking is shown as grey text and is expanded by default. Each tool call is a
  grey row you can tap to show its output.
- A run keeps every thinking block. It shows the newest **60 tool calls**; when
  more are hidden, a button reveals the previous 200 at a time. This keeps very
  long runs responsive.
- A run ends at an assistant message, todo list, error, plan approval, `speak`
  call, or another plugin's card. Those items are drawn on their own, as Paseo
  draws them.
- Nothing is dropped. If the plugin cannot load an agent's timeline yet, or the
  load fails, reasoning and tool calls are drawn as individual rows until the
  group can be built.

The plugin only changes what the client draws. It never writes agent data and
does not alter stored history, so disabling it brings back Paseo's own rows.

## Requirements

- Paseo **0.12.0 or newer** on the daemon and the client.
- Plugins enabled on the daemon. See **Settings → Plugins** in Paseo.
- No extra services, accounts, API keys, or runtime packages.

It works in the desktop app, the browser client, and on phones.

## Install

Install from GitHub with the Paseo CLI:

```bash
paseo plugin install github:lued/paseo-quiet-timeline
paseo plugin ls
```

`paseo plugin ls` should show `paseo-quiet-timeline` as `running` with no error.
The plugin is enabled after install. To turn it off without removing it:

```bash
paseo plugin disable paseo-quiet-timeline
paseo plugin enable paseo-quiet-timeline
```

After editing the plugin source, reload it:

```bash
paseo plugin reload paseo-quiet-timeline
```

Do not restart the daemon for a plugin change.

## Using it

Open any agent with a turn that thinks or calls tools. The activity appears as
one collapsed row. Tap it to see the full run, then tap a tool call to see its
output. On a phone, tap the row to open the sheet and swipe or tap outside to
close it.

## Known limitation

Inside an expanded group, a tool call's output is rendered as plain monospace
text, not with Paseo's native code and diff viewer.

This is a plugin API limit, not a styling choice. The 0.12 plugin SDK lets a
plugin register renderers only for its own timeline item kinds
(`addTimelineRenderer`), while built-in `tool_call` items can only be replaced
with plugin items or left to Paseo. The native tool row component is internal to
the app and is not exported to plugins; plugin client code can import only the
host-provided modules. Replacing tool calls with plugin items would therefore
lose the native viewer completely rather than reuse it.

The plugin keeps the grouping and shows the command, file path, diff, or output
as text. If a future SDK exposes a host renderer for tool output, the row can
adopt it without changing the grouping model.

## Development

```bash
npm ci
npm run typecheck
npm test
```

The tests cover grouping, live updates, older history, the 60-call cap, and the
rule that every hidden item belongs to a drawn row. There are no runtime
dependencies; Paseo loads the TypeScript source directly.

To try a local checkout in Paseo:

```bash
paseo plugin install /absolute/path/to/paseo-quiet-timeline
paseo plugin reload paseo-quiet-timeline
paseo plugin logs paseo-quiet-timeline
```

## License

MIT. See [LICENSE](LICENSE).
