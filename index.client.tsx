import type { PluginClientContext } from "@getpaseo/plugin/client";

/**
 * Drops reasoning ("Thinking") rows from the agent timeline.
 *
 * Paseo runs timeline transformers before it groups tool calls for the Overview
 * (Summary) display, so removing reasoning entries also lets tool groups that
 * were split by a reasoning block merge into one row.
 */
export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer({
    id: "hide-reasoning",
    query: { itemType: "reasoning" },
    transform() {
      return { items: [] };
    },
  });
  return () => {};
}
