# Quiet timeline

Never hides reasoning ("Thinking") rows. Paseo draws them as it does natively, so you
can always see that a model is thinking and verify that a thinking level is applied.

An earlier version removed every reasoning row so tool groups would merge into one
Overview row. That erased the only client-visible evidence of reasoning and was
removed. Do not reintroduce a transformer that returns `{ items: [] }` for
`reasoning`.

Thinking cannot be folded into Paseo's "ran N commands" group from a plugin on
0.12.0. The host ends a group at the first non-tool item, and an expanded group
renders only tool calls. That needs a Paseo change. Until then, use Settings →
General → Tool call display → Full detail to see every tool call and thinking row
inline, and Always expand reasoning to open the Thinking rows.

The plugin only changes what the client draws, and currently changes nothing. It reads
no agent data, sends nothing, and does not alter stored history.
