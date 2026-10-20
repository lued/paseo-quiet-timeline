import type { PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Registers no timeline transformers, so Paseo draws every reasoning ("Thinking")
 * row untouched.
 *
 * The earlier version dropped every `reasoning` item to merge tool groups. That
 * hid the only client-visible proof that a thinking level took effect, so it is
 * gone. A plugin cannot put thinking inside Paseo's "ran N commands" group on
 * 0.12.0: the host closes a group at the first non-tool item, and the expanded
 * group renders only tool calls. Do not add a transformer that returns
 * `{ items: [] }` for `reasoning`.
 */
export default function contribute(_client: PluginClientContext) {
  return () => {};
}
