import type { PluginTheme } from "@getpaseo/plugin";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import {
  describeLatest,
  describeSummary,
  describeTool,
  summarizeRun,
  visibleMembers,
  type Member,
  type ToolItem,
} from "../shared/activity.ts";
import type { ActivityStore } from "./store.ts";

type Colors = PluginTheme["colors"];

// Same stack Paseo uses for code.
const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});
const MAX_BODY_LINES = 80;
/** Tool calls drawn at first in an expanded run; every thinking block is always drawn. */
export const VISIBLE_TOOL_CALLS = 60;
const MORE_TOOL_CALLS = 200;
const MAX_BODY_CHARS = 8_000;

function useStore(store: ActivityStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

function clip(text: string, fromEnd = false): string {
  let lines = text.replace(/\r/g, "").split("\n");
  let prefix = "";
  let suffix = "";
  if (lines.length > MAX_BODY_LINES) {
    const hidden = lines.length - MAX_BODY_LINES;
    if (fromEnd) {
      lines = lines.slice(-MAX_BODY_LINES);
      prefix = `… ${hidden} earlier lines\n`;
    } else {
      lines = lines.slice(0, MAX_BODY_LINES);
      suffix = `\n… ${hidden} more lines`;
    }
  }
  let body = lines.join("\n");
  if (body.length > MAX_BODY_CHARS) {
    body = fromEnd ? body.slice(-MAX_BODY_CHARS) : body.slice(0, MAX_BODY_CHARS);
    if (fromEnd) prefix = "…\n";
    else suffix = "\n…";
  }
  return `${prefix}${body}${suffix}`;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Output shown under a tool call's title, or null when there is nothing to add. */
export function toolBody(item: ToolItem): string | null {
  const detail = item.detail;
  const parts: string[] = [];
  switch (detail.type) {
    case "shell":
      if (detail.output) parts.push(clip(detail.output, true));
      if (detail.exitCode !== undefined && detail.exitCode !== null && detail.exitCode !== 0) {
        parts.push(`exit ${detail.exitCode}`);
      }
      break;
    case "read":
      if (detail.content) parts.push(clip(detail.content));
      break;
    case "edit":
      if (detail.unifiedDiff) parts.push(clip(detail.unifiedDiff));
      else if (detail.oldString !== undefined || detail.newString !== undefined) {
        const minus = (detail.oldString ?? "").split("\n").map((line) => `- ${line}`);
        const plus = (detail.newString ?? "").split("\n").map((line) => `+ ${line}`);
        parts.push(clip([...minus, ...plus].join("\n")));
      }
      break;
    case "write":
      if (detail.content) parts.push(clip(detail.content));
      break;
    case "search":
      if (detail.content) parts.push(clip(detail.content));
      else if (detail.filePaths?.length) parts.push(clip(detail.filePaths.join("\n")));
      else if (detail.webResults?.length) {
        parts.push(clip(detail.webResults.map((result) => `${result.title}\n  ${result.url}`).join("\n")));
      }
      break;
    case "fetch":
      if (detail.result) parts.push(clip(detail.result));
      break;
    case "sub_agent":
      if (detail.actions?.length) {
        parts.push(clip(detail.actions.map((action) => `${action.toolName} ${action.summary ?? ""}`).join("\n"), true));
      } else if (detail.log) parts.push(clip(detail.log, true));
      break;
    case "plain_text":
      if (detail.text) parts.push(clip(detail.text));
      break;
    case "worktree_setup":
      if (detail.log) parts.push(clip(detail.log, true));
      break;
    default: {
      const unknown = detail as { input?: unknown; output?: unknown };
      const input = stringify(unknown.input);
      const output = stringify(unknown.output);
      if (input) parts.push(clip(input));
      if (output) parts.push(clip(output, true));
    }
  }
  if (item.status === "failed" && item.error !== null && item.error !== undefined) {
    parts.push(`Error: ${clip(stringify(item.error))}`);
  }
  const body = parts.join("\n\n").trim();
  return body ? body : null;
}

function styles(colors: Colors) {
  return {
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.surface1,
      overflow: "hidden",
    } as ViewStyle,
    header: { paddingHorizontal: 10, paddingVertical: 7, gap: 2 } as ViewStyle,
    headerLine: { flexDirection: "row", alignItems: "center", gap: 6 } as ViewStyle,
    summary: { color: colors.foreground, fontSize: 13, fontWeight: "500", flexShrink: 1 } as TextStyle,
    live: { color: colors.accent, fontSize: 11 } as TextStyle,
    failed: { color: colors.statusDanger, fontSize: 12 } as TextStyle,
    preview: { color: colors.foregroundMuted, fontSize: 12, marginLeft: 18 } as TextStyle,
    body: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 10,
    } as ViewStyle,
    label: { color: colors.foregroundMuted, fontSize: 11, fontWeight: "600", letterSpacing: 0.4 } as TextStyle,
    thinking: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 } as TextStyle,
    toolTitle: { color: colors.foreground, fontSize: 12, fontFamily: MONO, flexShrink: 1 } as TextStyle,
    toolBox: {
      maxHeight: 240,
      borderRadius: 6,
      backgroundColor: colors.surface0,
      borderWidth: 1,
      borderColor: colors.border,
    } as ViewStyle,
    toolBody: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 16, fontFamily: MONO, padding: 8 } as TextStyle,
    muted: { color: colors.foregroundMuted, fontSize: 12 } as TextStyle,
  };
}

function statusColor(item: ToolItem, colors: Colors): string {
  switch (item.status) {
    case "running":
      return colors.accent;
    case "failed":
      return colors.statusDanger;
    case "canceled":
      return colors.foregroundMuted;
    default:
      return colors.statusSuccess;
  }
}

// Shapes are drawn with views: icon glyphs are missing from some app fonts.
function Dot({ color, hollow = false }: { color: string; hollow?: boolean }) {
  return (
    <View style={{ width: 12, alignItems: "center" }}>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: hollow ? "transparent" : color,
          borderWidth: hollow ? 1 : 0,
          borderColor: color,
        }}
      />
    </View>
  );
}

function Chevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 6,
          height: 6,
          borderRightWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: expanded ? "45deg" : "-45deg" }],
          marginTop: expanded ? -3 : 0,
          marginLeft: expanded ? 0 : -2,
        }}
      />
    </View>
  );
}

function ThinkingView({ text, open, colors }: { text: string; open: boolean; colors: Colors }) {
  const s = styles(colors);
  return (
    <View style={{ gap: 3 }}>
      <Text style={s.label}>{open ? "THINKING…" : "THINKING"}</Text>
      <Text style={s.thinking} selectable>
        {text.trim()}
      </Text>
    </View>
  );
}

function ToolView({ item, colors }: { item: ToolItem; colors: Colors }) {
  const s = styles(colors);
  const body = toolBody(item);
  return (
    <View style={{ gap: 4 }}>
      <View style={s.headerLine}>
        <Dot color={statusColor(item, colors)} hollow={item.status === "canceled"} />
        <Text style={s.toolTitle} selectable>
          {describeTool(item)}
        </Text>
      </View>
      {body ? (
        <ScrollView style={s.toolBox} nestedScrollEnabled>
          <Text style={s.toolBody} selectable>
            {body}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

function MemberView({ member, colors }: { member: Member; colors: Colors }) {
  if (member.kind === "reasoning") return <ThinkingView text={member.text} open={member.open} colors={colors} />;
  return <ToolView item={member.item} colors={colors} />;
}

function RunBody({ members, colors }: { members: readonly Member[]; colors: Colors }) {
  const s = styles(colors);
  const [toolLimit, setToolLimit] = useState(VISIBLE_TOOL_CALLS);
  const { shown, hiddenTools } = visibleMembers(members, toolLimit);
  return (
    <View style={s.body}>
      {hiddenTools > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setToolLimit((limit) => limit + MORE_TOOL_CALLS)}>
          <Text style={[s.muted, { color: colors.accent }]}>
            Show {Math.min(hiddenTools, MORE_TOOL_CALLS)} earlier tool calls ({hiddenTools} hidden; all thinking is shown)
          </Text>
        </Pressable>
      ) : null}
      {shown.map((member) => (
        <MemberView key={member.key} member={member} colors={colors} />
      ))}
    </View>
  );
}

export function GroupRow(props: { store: ActivityStore; agentId: string; runId: string; theme: PluginTheme }) {
  const { store, agentId, runId } = props;
  const colors = props.theme.colors;
  useStore(store);
  useEffect(() => store.ensure(agentId), [store, agentId]);
  const run = store.getRun(agentId, runId);
  const s = styles(colors);
  if (!run) {
    return (
      <View style={[s.card, s.header]}>
        <Text style={s.muted}>Loading activity…</Text>
      </View>
    );
  }
  const expanded = store.isExpanded(runId);
  const summary = summarizeRun(run);
  const latest = describeLatest(run);
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${describeSummary(summary)}. ${expanded ? "Collapse" : "Expand"} activity`}
        onPress={() => store.toggle(runId)}
        style={s.header}
      >
        <View style={s.headerLine}>
          <Chevron expanded={expanded} color={colors.foregroundMuted} />
          <Text style={s.summary}>{describeSummary(summary)}</Text>
          {summary.failedCount > 0 ? <Text style={s.failed}>{summary.failedCount} failed</Text> : null}
          {summary.running ? (
            <View style={s.headerLine}>
              <Dot color={colors.accent} />
              <Text style={s.live}>working</Text>
            </View>
          ) : null}
        </View>
        {!expanded && latest ? (
          <Text style={s.preview} numberOfLines={1}>
            {latest}
          </Text>
        ) : null}
      </Pressable>
      {expanded ? <RunBody members={run.members} colors={colors} /> : null}
    </View>
  );
}

/** An item the plugin could not place in a run yet. Drawn on its own, never hidden. */
export function ItemRow(props: { store: ActivityStore; agentId: string; item: AgentTimelineItem; theme: PluginTheme }) {
  const { store, agentId, item } = props;
  const colors = props.theme.colors;
  const version = useStore(store);
  useEffect(() => store.ensure(agentId), [store, agentId]);
  useEffect(() => {
    if (store.status(agentId) === "ready" && !store.knows(agentId, item)) store.loadOlder(agentId);
  }, [store, agentId, item, version]);
  const s = styles(colors);
  let content = null;
  if (item.type === "reasoning") content = <ThinkingView text={item.text} open={false} colors={colors} />;
  else if (item.type === "tool_call") content = <ToolView item={item} colors={colors} />;
  return <View style={[s.card, s.body, { borderTopWidth: 0 }]}>{content}</View>;
}
