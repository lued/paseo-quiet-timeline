# Quiet timeline

Hides the reasoning ("Thinking") rows Paseo draws between tool calls in an agent
timeline, so a long agent run reads as the assistant's messages and its grouped
tool activity instead of alternating `Thinking` and `ran N commands` lines.

Paseo builds the Overview (Summary) tool-call groups after timeline transformers
run, so removing reasoning entries also merges tool groups that a reasoning block
used to separate. Set Settings → General → Tool call display to Summary to get the
grouped rows. In Full detail every tool call still gets its own row.

The plugin only changes what the client draws. It reads no agent data, sends
nothing, and does not alter stored history: reasoning is still recorded and comes
back if the plugin is disabled.
