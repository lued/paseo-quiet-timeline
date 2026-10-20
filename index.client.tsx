import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTimelineTransformResult } from "@getpaseo/plugin";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { z } from "zod";
import { ActivityStore, fallbackData } from "./client/store.ts";
import { GroupRow, ItemRow } from "./client/views.tsx";

/**
 * Groups every run of thinking and tool calls into one collapsible row.
 *
 * Paseo's own Summary groups stop at the first reasoning item and only list tool
 * calls, so this plugin draws the whole run itself. The collapsed row says what
 * happened ("Thought 3 times, ran 4 commands") and shows the latest thinking or
 * call while the agent works. One tap shows every thinking block and every tool
 * call with its output, in order.
 *
 * Nothing is ever dropped without being drawn. Each item is either the run's row,
 * hidden because that row already shows it, or drawn on its own while the plugin
 * cannot place it.
 */

const GROUP_KIND = "activity-group";
const ITEM_KIND = "activity-item";
const VERSION = 1;

const groupSchema = z.object({ runId: z.string().min(1) });
const itemSchema = z.object({
  item: z.custom<AgentTimelineItem>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      ((value as { type?: unknown }).type === "reasoning" || (value as { type?: unknown }).type === "tool_call"),
  ),
});

export default function contribute(client: PluginClientContext) {
  let removeTransformers: Array<() => unknown> = [];
  const store = new ActivityStore(client.paseo, () => register());

  function transform(item: AgentTimelineItem): PluginTimelineTransformResult | undefined {
    const decision = store.decide(item);
    switch (decision.kind) {
      case "group":
        return { items: [{ type: "plugin", kind: GROUP_KIND, version: VERSION, data: { runId: decision.runId } }] };
      case "hide":
        return { items: [] };
      case "fallback":
        return { items: [{ type: "plugin", kind: ITEM_KIND, version: VERSION, data: fallbackData(item) }] };
      case "native":
        return undefined;
    }
  }

  // Re-registering publishes a new plugin snapshot, so Paseo reprojects every
  // timeline in order with fresh decisions.
  function register() {
    store.beginGeneration();
    for (const remove of removeTransformers) remove();
    removeTransformers = [
      client.addTimelineTransformer({
        id: "group-reasoning",
        query: { itemType: "reasoning" },
        transform: ({ item }) => transform(item),
      }),
      client.addTimelineTransformer({
        id: "group-tool-calls",
        query: { itemType: "tool_call" },
        transform: ({ item }) => transform(item),
      }),
    ];
  }
  register();

  function ActivityGroup(props: PluginTimelineItemProps<z.output<typeof groupSchema>>) {
    return <GroupRow store={store} agentId={props.agentId} runId={props.item.data.runId} theme={props.theme} />;
  }
  function ActivityItem(props: PluginTimelineItemProps<z.output<typeof itemSchema>>) {
    return <ItemRow store={store} agentId={props.agentId} item={props.item.data.item} theme={props.theme} />;
  }

  const removeGroup = client.addTimelineRenderer({
    kind: GROUP_KIND,
    version: VERSION,
    schema: groupSchema,
    Component: ActivityGroup,
  });
  const removeItem = client.addTimelineRenderer({
    kind: ITEM_KIND,
    version: VERSION,
    schema: itemSchema,
    Component: ActivityItem,
  });

  return () => {
    for (const remove of removeTransformers) remove();
    removeTransformers = [];
    void removeGroup();
    void removeItem();
    store.dispose();
  };
}
