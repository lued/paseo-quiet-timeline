# Quiet timeline

Quiet timeline is a Paseo plugin that folds each run of thinking and tool calls
into one grey activity row, so a long agent turn reads as the assistant's
messages with a single line of activity between them.

Collapsed, the row is drawn like Paseo's own tool call rows and summarises the
run, for example "Thought 2 times, ran 3 commands, and read 1 file". While the
agent works, it also shows the latest thought or tool call. One tap opens the run
in order: inline on a wide window, in a sheet on a phone. Thinking is shown as
grey text and expanded by default. Each tool call is a grey row that opens its
output.

A run keeps every thinking block and the newest 60 tool calls. A button reveals
earlier calls 200 at a time, so very long runs stay responsive. A run ends at an
assistant message, todo list, error, plan approval, `speak` call, or another
plugin's card, and those items stay separate.

The plugin only changes what the client draws. It keeps a read-only mirror of
the open agent's timeline and never writes agent data or stored history, so
disabling it restores Paseo's own rows. If the mirror is still loading or fails,
items are drawn individually and nothing is hidden.

Tool output inside an expanded group is plain monospace text, not Paseo's native
code and diff viewer. The 0.12 plugin SDK lets a plugin render only its own
timeline item kinds and does not export the built-in tool row, so the native
viewer cannot be embedded in a plugin group.

Requires Paseo 0.12.0 or newer. No accounts, keys, or extra packages are needed.
