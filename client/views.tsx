import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import {
  describeLatest,
  describeSummary,
  summarizeRun,
  toolDisplay,
  toolIconName,
  visibleMembers,
  type Member,
  type ToolItem,
} from "../shared/activity.ts";
import type { ActivityStore } from "./store.ts";

/*
 * Rows copy Paseo's own ExpandableBadge (components/message.tsx, 0.12.0): a
 * borderless grey line with a 12px icon, a 14px label and a secondary label.
 * Hover or expand turns the text foreground and swaps the icon for a chevron;
 * only an expanded row gets the surface tint. On compact layouts a group opens a
 * sheet, as Paseo's Summary groups do.
 */

type Colors = PluginTheme["colors"];

const MONO = Platform.select({
  ios: "ui-monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  default: "monospace",
});
const isWeb = Platform.OS === "web";
const GROUP_MAX_HEIGHT = 400;
const DETAIL_MAX_HEIGHT = 200;
const MAX_BODY_LINES = 80;
const MAX_BODY_CHARS = 8_000;
/** Tool calls drawn at first in an expanded run; every thinking block is always drawn. */
export const VISIBLE_TOOL_CALLS = 60;
const MORE_TOOL_CALLS = 200;
/** Badge padding (8) + icon slot (22) + gap (4): where the label starts. */
const LABEL_INSET = 34;

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

/** Output shown when a tool call is opened, or null when there is nothing to add. */
export function toolBody(item: ToolItem): string | null {
  const detail = item.detail;
  const parts: string[] = [];
  switch (detail.type) {
    case "shell":
      parts.push(`$ ${detail.command}`);
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
    parts.push(clip(stringify(item.error)));
  }
  const body = parts.join("\n\n").trim();
  return body ? body : null;
}

// ---- badge ------------------------------------------------------------------

interface BadgeProps {
  colors: Colors;
  icon: string;
  label: string;
  secondaryLabel?: string;
  expanded: boolean;
  loading?: boolean;
  error?: boolean;
  onToggle?: () => void;
  /** Detail content under the header, drawn only while expanded. */
  details?: ReactNode;
  /** Attach a bordered box under the header (tool output), or not (group, thinking). */
  borderlessWhenExpanded?: boolean;
  spacing?: "sequence" | "none";
  /** Stay grey and untinted while expanded (thinking is open by default). */
  quiet?: boolean;
  testID?: string;
}

function Badge(props: BadgeProps) {
  const { colors, expanded, loading = false, error = false, onToggle, borderlessWhenExpanded = false } = props;
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const interactive = Boolean(onToggle);
  const quiet = props.quiet ?? false;
  const active = hovered || (expanded && !quiet);
  const showChevron = interactive && active;

  const labelColor = loading || active ? colors.foreground : colors.foregroundMuted;
  const labelStyle: TextStyle = {
    color: labelColor,
    opacity: loading && !active ? 0.72 : 1,
    fontSize: 14,
    fontWeight: "400",
    flexShrink: 0,
  };
  const secondaryStyle: TextStyle = {
    flexShrink: 1,
    minWidth: 0,
    color: active ? colors.foreground : colors.foregroundMuted,
    fontSize: 14,
    fontWeight: "400",
    marginLeft: 8,
  };
  const headerStyle: ViewStyle = {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    ...(pressed && interactive ? { opacity: 0.9 } : null),
    ...(expanded && !quiet ? { backgroundColor: colors.surface1 } : null),
    ...(expanded && !borderlessWhenExpanded && props.details
      ? { borderColor: colors.border, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
      : null),
  };
  const detailStyle: ViewStyle = borderlessWhenExpanded
    ? { minWidth: 0, flexShrink: 1 }
    : {
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
        borderWidth: 1,
        borderTopWidth: 0,
        borderColor: colors.border,
        overflow: "hidden",
        minWidth: 0,
        flexShrink: 1,
      };

  let iconNode: ReactNode;
  if (showChevron) {
    iconNode = (
      <View style={{ transform: [{ scale: 1.3 }, ...(expanded ? [{ rotate: "90deg" }] : [])], marginLeft: -1 }}>
        <Icon name="ChevronRight" size={12} color={colors.foreground} />
      </View>
    );
  } else if (error) {
    iconNode = <Icon name="TriangleAlert" size={12} color={colors.statusDanger} />;
  } else {
    iconNode = <Icon name={props.icon} size={12} color={active ? colors.foreground : colors.foregroundMuted} />;
  }

  return (
    <View
      testID={props.testID}
      style={{ marginHorizontal: -13, marginBottom: props.spacing === "sequence" ? 4 : 0 }}
    >
      <Pressable
        accessibilityRole={interactive ? "button" : undefined}
        accessibilityState={interactive ? { expanded } : undefined}
        disabled={!interactive}
        onPress={onToggle}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={isWeb ? () => setHovered(true) : undefined}
        onHoverOut={
          isWeb
            ? () => {
                setHovered(false);
                setPressed(false);
              }
            : undefined
        }
        style={headerStyle}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
            {iconNode}
          </View>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", overflow: "hidden" }}>
            <Text style={labelStyle} numberOfLines={1}>
              {props.label}
            </Text>
            {props.secondaryLabel ? (
              <Text style={secondaryStyle} numberOfLines={1}>
                {props.secondaryLabel}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      {expanded && props.details ? <View style={detailStyle}>{props.details}</View> : null}
    </View>
  );
}

// ---- members ----------------------------------------------------------------

function firstLine(text: string): string {
  return text.trim().split("\n").find((line) => line.trim())?.trim() ?? "";
}

function ThinkingRow({ text, open, colors }: { text: string; open: boolean; colors: Colors }) {
  // Thinking opens with its run: the point of the row is seeing the reasoning.
  const [expanded, setExpanded] = useState(true);
  const trimmed = text.trim();
  return (
    <Badge
      colors={colors}
      icon="Brain"
      label="Thinking"
      secondaryLabel={expanded ? undefined : firstLine(trimmed)}
      expanded={expanded}
      loading={open}
      onToggle={() => setExpanded((value) => !value)}
      borderlessWhenExpanded
      quiet
      spacing="sequence"
      details={
        <Text
          selectable
          style={{
            color: colors.foregroundMuted,
            fontSize: 14,
            lineHeight: 21,
            paddingLeft: LABEL_INSET,
            paddingRight: 8,
            paddingTop: 2,
            paddingBottom: 6,
          }}
        >
          {trimmed}
        </Text>
      }
    />
  );
}

function ToolRow({ item, cwd, colors }: { item: ToolItem; cwd?: string; colors: Colors }) {
  const [expanded, setExpanded] = useState(false);
  const display = toolDisplay(item, cwd);
  const body = expanded ? toolBody(item) : null;
  return (
    <Badge
      colors={colors}
      icon={toolIconName(item)}
      label={display.displayName}
      secondaryLabel={display.summary ? firstLine(display.summary) : undefined}
      expanded={expanded}
      loading={item.status === "running"}
      error={item.status === "failed"}
      onToggle={() => setExpanded((value) => !value)}
      spacing="sequence"
      details={
        body ? (
          <ScrollView style={{ maxHeight: DETAIL_MAX_HEIGHT, backgroundColor: colors.surface1 }} nestedScrollEnabled>
            <Text
              selectable
              style={{ color: colors.foregroundMuted, fontFamily: MONO, fontSize: 12, lineHeight: 18, padding: 12 }}
            >
              {body}
            </Text>
          </ScrollView>
        ) : (
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, padding: 12 }}>No additional details available</Text>
        )
      }
    />
  );
}

function MemberRow({ member, cwd, colors }: { member: Member; cwd?: string; colors: Colors }) {
  if (member.kind === "reasoning") return <ThinkingRow text={member.text} open={member.open} colors={colors} />;
  return <ToolRow item={member.item} cwd={cwd} colors={colors} />;
}

function RunMembers({ members, cwd, colors }: { members: readonly Member[]; cwd?: string; colors: Colors }) {
  const [toolLimit, setToolLimit] = useState(VISIBLE_TOOL_CALLS);
  const { shown, hiddenTools } = visibleMembers(members, toolLimit);
  return (
    <>
      {hiddenTools > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setToolLimit((limit) => limit + MORE_TOOL_CALLS)}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, paddingVertical: 4 }}>
            Show {Math.min(hiddenTools, MORE_TOOL_CALLS)} earlier tool calls ({hiddenTools} hidden)
          </Text>
        </Pressable>
      ) : null}
      {shown.map((member) => (
        <MemberRow key={member.key} member={member} cwd={cwd} colors={colors} />
      ))}
    </>
  );
}

// ---- rows the plugin registers ------------------------------------------------

export function GroupRow(props: {
  store: ActivityStore;
  agentId: string;
  runId: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  const { store, agentId, runId, compact } = props;
  const colors = props.theme.colors;
  useStore(store);
  useEffect(() => store.ensure(agentId), [store, agentId]);
  const cwd = useAgent(agentId, (agent) => agent.cwd) ?? undefined;
  const run = store.getRun(agentId, runId);
  if (!run) {
    return <Badge colors={colors} icon="Wrench" label="Loading activity…" expanded={false} />;
  }
  const expanded = store.isExpanded(runId);
  const summary = summarizeRun(run);
  const label = describeSummary(summary);
  // Like Paseo's loading badges, a live run names what it is doing right now.
  const latest = summary.running ? (describeLatest(run) ?? undefined) : undefined;
  const toggle = () => store.toggle(runId);

  if (compact) {
    return (
      <>
        <Badge
          colors={colors}
          icon="Wrench"
          label={label}
          secondaryLabel={latest}
          expanded={false}
          loading={summary.running}
          error={summary.failedCount > 0 && !summary.running}
          onToggle={toggle}
          testID="activity-group"
        />
        <Modal title={label} open={expanded} onOpenChange={(open) => (open ? undefined : store.toggle(runId))}>
          <Modal.Content contentContainerStyle={{ paddingHorizontal: 13, paddingVertical: 12, gap: 0 }}>
            <RunMembers members={run.members} cwd={cwd} colors={colors} />
          </Modal.Content>
        </Modal>
      </>
    );
  }

  return (
    <Badge
      colors={colors}
      icon="Wrench"
      label={label}
      secondaryLabel={expanded ? undefined : latest}
      expanded={expanded}
      loading={summary.running}
      error={summary.failedCount > 0 && !summary.running}
      onToggle={toggle}
      borderlessWhenExpanded
      testID="activity-group"
      details={
        <ScrollView
          style={{ maxHeight: GROUP_MAX_HEIGHT }}
          contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 13 }}
          nestedScrollEnabled
        >
          <RunMembers members={run.members} cwd={cwd} colors={colors} />
        </ScrollView>
      }
    />
  );
}

/** An item the plugin could not place in a run yet. Drawn like Paseo's own row, never hidden. */
export function ItemRow(props: { store: ActivityStore; agentId: string; item: AgentTimelineItem; theme: PluginTheme }) {
  const { store, agentId, item } = props;
  const colors = props.theme.colors;
  const version = useStore(store);
  useEffect(() => store.ensure(agentId), [store, agentId]);
  useEffect(() => {
    if (store.status(agentId) === "ready" && !store.knows(agentId, item)) store.loadOlder(agentId);
  }, [store, agentId, item, version]);
  const cwd = useAgent(agentId, (agent) => agent.cwd) ?? undefined;
  if (item.type === "reasoning") return <ThinkingRow text={item.text} open={false} colors={colors} />;
  if (item.type === "tool_call") return <ToolRow item={item} cwd={cwd} colors={colors} />;
  return null;
}
