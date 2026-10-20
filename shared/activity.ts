import type { AgentTimelineItem, ToolCallDetail } from "@getpaseo/protocol/agent-types";

/**
 * Pure model for the activity groups.
 *
 * A mirror replays an agent's timeline the way Paseo's app reducer does: reasoning
 * chunks merge into the reasoning entry before them, tool calls update in place by
 * call id, and every other item is a break. Contiguous reasoning and tool entries
 * form one run; each run is drawn as a single collapsible row.
 */

export type ToolItem = Extract<AgentTimelineItem, { type: "tool_call" }>;

export type MirrorEntry =
  | { kind: "reasoning"; key: string; text: string; norm: string; open: boolean }
  | { kind: "tool"; key: string; callId: string; item: ToolItem }
  | { kind: "break"; key: string; breakType: string; callId?: string };

export type Member = Extract<MirrorEntry, { kind: "reasoning" | "tool" }>;

export interface Mirror {
  agentId: string;
  entries: MirrorEntry[];
  /** Gives keys to entries that arrive without a timeline seq. */
  localCounter: number;
}

export interface Run {
  runId: string;
  agentId: string;
  members: Member[];
}

export interface MemberRef {
  agentId: string;
  key: string;
  runId: string;
  /** Position inside the agent's mirror; lower is older. */
  order: number;
}

export interface AgentIndex {
  agentId: string;
  runs: Map<string, Run>;
  members: Map<string, MemberRef>;
  toolCalls: Map<string, MemberRef>;
  reasoning: Array<MemberRef & { norm: string }>;
}

export const MAX_DETAIL_CHARS = 20_000;

export function createMirror(agentId: string): Mirror {
  return { agentId, entries: [], localCounter: 0 };
}

export function normalizeReasoning(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Tool calls Paseo removes from the stream entirely. */
function isHiddenTool(item: ToolItem): boolean {
  return item.name === "ExitPlanMode" || (item.name === "plan_approval" && item.status === "running");
}

/** Tool calls Paseo never groups; they break a run like any other card. */
function isBreakingTool(item: ToolItem): boolean {
  return (
    item.detail.type === "plan" ||
    item.name.trim().toLowerCase() === "speak" ||
    item.name === "plan_approval"
  );
}

function truncateString(value: string): string {
  if (value.length <= MAX_DETAIL_CHARS) return value;
  return `${value.slice(0, MAX_DETAIL_CHARS)}\n… (${value.length - MAX_DETAIL_CHARS} more characters)`;
}

function truncateDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateString(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => truncateDeep(entry, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = truncateDeep(entry, depth + 1);
  return result;
}

/** Copy of a tool call with large strings cut, so mirrors and row data stay small. */
export function compactToolItem(item: ToolItem): ToolItem {
  return truncateDeep(item) as ToolItem;
}

function nextKey(mirror: Mirror, prefix: string, seq: number | undefined): string {
  if (seq !== undefined) return `${prefix}:${mirror.agentId}:${seq}`;
  mirror.localCounter += 1;
  return `${prefix}:${mirror.agentId}:local-${mirror.localCounter}`;
}

function closeReasoning(mirror: Mirror): void {
  const last = mirror.entries.at(-1);
  if (last?.kind === "reasoning") last.open = false;
}

/** Close any open reasoning; called when a turn ends. */
export function closeMirror(mirror: Mirror): void {
  closeReasoning(mirror);
}

/**
 * Apply one timeline item. Returns true when the visible model changed.
 * `open` marks live reasoning so the row can say it is still thinking.
 */
export function applyItem(
  mirror: Mirror,
  item: AgentTimelineItem,
  seq: number | undefined,
  live: boolean,
): boolean {
  const entries = mirror.entries;
  const last = entries.at(-1);
  switch (item.type) {
    case "reasoning": {
      const chunk = item.text.replace(/\r/g, "");
      if (!chunk) return false;
      if (last?.kind === "reasoning") {
        last.text += chunk;
        last.norm = normalizeReasoning(last.text);
        last.open = live;
        return true;
      }
      if (!/\S/.test(chunk)) return false;
      entries.push({
        kind: "reasoning",
        key: nextKey(mirror, "r", seq),
        text: chunk,
        norm: normalizeReasoning(chunk),
        open: live,
      });
      return true;
    }
    case "tool_call": {
      if (isHiddenTool(item)) return false;
      const compact = compactToolItem(item);
      const existing = entries.findIndex(
        (entry) => (entry.kind === "tool" || entry.kind === "break") && entry.callId === item.callId,
      );
      if (existing >= 0) {
        const current = entries[existing]!;
        if (current.kind === "tool") {
          entries[existing] = { ...current, item: compact };
        } else if (!isBreakingTool(item)) {
          entries[existing] = { kind: "tool", key: current.key, callId: item.callId, item: compact };
        }
        return true;
      }
      closeReasoning(mirror);
      const key = `t:${item.callId}`;
      entries.push(
        isBreakingTool(item)
          ? { kind: "break", key, breakType: "tool_call", callId: item.callId }
          : { kind: "tool", key, callId: item.callId, item: compact },
      );
      return true;
    }
    case "assistant_message": {
      if (last?.kind === "break" && last.breakType === "assistant_message") return false;
      closeReasoning(mirror);
      entries.push({ kind: "break", key: nextKey(mirror, "b", seq), breakType: item.type });
      return true;
    }
    case "plugin":
      // Other plugins' rows are separate cards; they end a run.
      closeReasoning(mirror);
      entries.push({ kind: "break", key: nextKey(mirror, "b", seq), breakType: item.type });
      return true;
    default:
      closeReasoning(mirror);
      entries.push({ kind: "break", key: nextKey(mirror, "b", seq), breakType: item.type });
      return true;
  }
}

/** Build a mirror from fetched (projected) timeline entries. */
export function mirrorFromEntries(
  agentId: string,
  entries: ReadonlyArray<{ item: AgentTimelineItem; seqStart: number }>,
): Mirror {
  const mirror = createMirror(agentId);
  for (const entry of entries) applyItem(mirror, entry.item, entry.seqStart, false);
  return mirror;
}

/** Older page first, then the current mirror. Shared call ids keep the newer copy. */
export function prependMirror(current: Mirror, older: Mirror): Mirror {
  const newerCallIds = new Set(
    current.entries.flatMap((entry) => (entry.kind === "break" || entry.kind === "tool") && entry.callId ? [entry.callId] : []),
  );
  const keys = new Set(current.entries.map((entry) => entry.key));
  const kept = older.entries.filter(
    (entry) =>
      !keys.has(entry.key) &&
      !((entry.kind === "tool" || entry.kind === "break") && entry.callId && newerCallIds.has(entry.callId)),
  );
  return {
    agentId: current.agentId,
    entries: [...kept, ...current.entries],
    localCounter: current.localCounter + older.localCounter,
  };
}

export function indexMirror(mirror: Mirror): AgentIndex {
  const index: AgentIndex = {
    agentId: mirror.agentId,
    runs: new Map(),
    members: new Map(),
    toolCalls: new Map(),
    reasoning: [],
  };
  let run: Run | null = null;
  mirror.entries.forEach((entry, order) => {
    if (entry.kind === "break") {
      run = null;
      return;
    }
    if (!run) {
      run = { runId: entry.key, agentId: mirror.agentId, members: [] };
      index.runs.set(run.runId, run);
    }
    run.members.push(entry);
    const ref: MemberRef = { agentId: mirror.agentId, key: entry.key, runId: run.runId, order };
    index.members.set(entry.key, ref);
    if (entry.kind === "tool") index.toolCalls.set(entry.callId, ref);
    else index.reasoning.push({ ...ref, norm: entry.norm });
  });
  return index;
}

/**
 * Find the reasoning entry a stream item belongs to. The app and the mirror can
 * be a few chunks apart, so either text may be a prefix of the other. Anything
 * other than exactly one match is unresolved, and unresolved items stay visible.
 */
export function matchReasoning(
  candidates: Iterable<MemberRef & { norm: string }>,
  text: string,
): MemberRef | null {
  const norm = normalizeReasoning(text);
  if (!norm) return null;
  let found: MemberRef | null = null;
  for (const candidate of candidates) {
    if (!candidate.norm) continue;
    if (candidate.norm.startsWith(norm) || norm.startsWith(candidate.norm)) {
      if (found && found.key !== candidate.key) return null;
      found = candidate;
    }
  }
  return found;
}

export interface RunSummary {
  thoughtCount: number;
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  otherToolCount: number;
  paseoCallCount: number;
  running: boolean;
  failedCount: number;
}

const SEARCH_SUFFIX = /(?:^|[_.:/])(?:web_search|llm_context)$/;

function isPaseoTool(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower.startsWith("paseo_") || lower.startsWith("mcp__paseo__") || lower.startsWith("paseo.");
}

export function summarizeRun(run: Run): RunSummary {
  const edited = new Set<string>();
  const read = new Set<string>();
  const summary: RunSummary = {
    thoughtCount: 0,
    editedFileCount: 0,
    commandCount: 0,
    readFileCount: 0,
    searchCount: 0,
    otherToolCount: 0,
    paseoCallCount: 0,
    running: false,
    failedCount: 0,
  };
  for (const member of run.members) {
    if (member.kind === "reasoning") {
      summary.thoughtCount += 1;
      summary.running ||= member.open;
      continue;
    }
    const { item } = member;
    summary.running ||= item.status === "running";
    if (item.status === "failed") summary.failedCount += 1;
    const detail = item.detail;
    if (isPaseoTool(item.name)) summary.paseoCallCount += 1;
    else if (detail.type === "edit" || detail.type === "write") edited.add(detail.filePath);
    else if (detail.type === "shell") summary.commandCount += 1;
    else if (detail.type === "read") read.add(detail.filePath);
    else if (detail.type === "search" || SEARCH_SUFFIX.test(item.name.trim().toLowerCase()))
      summary.searchCount += 1;
    else summary.otherToolCount += 1;
  }
  summary.editedFileCount = edited.size;
  summary.readFileCount = read.size;
  return summary;
}

function plural(count: number, one: string, other: string): string | null {
  if (count === 0) return null;
  return `${count === 1 ? one : other}`.replace("{n}", String(count));
}

export function describeSummary(summary: RunSummary): string {
  const parts = [
    plural(summary.thoughtCount, "thought", "thought {n} times"),
    plural(summary.editedFileCount, "edited {n} file", "edited {n} files"),
    plural(summary.commandCount, "ran {n} command", "ran {n} commands"),
    plural(summary.readFileCount, "read {n} file", "read {n} files"),
    plural(summary.searchCount, "searched {n} time", "searched {n} times"),
    plural(summary.otherToolCount, "used {n} other tool", "used {n} other tools"),
    plural(summary.paseoCallCount, "called Paseo {n} time", "called Paseo {n} times"),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Activity";
  let text = parts[0]!;
  if (parts.length === 2) text = `${parts[0]} and ${parts[1]}`;
  else if (parts.length > 2) text = `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function firstLine(text: string, max = 140): string {
  const line = text.trim().split("\n").find((candidate) => candidate.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** One-line title for a tool call. */
export function describeTool(item: ToolItem): string {
  const detail: ToolCallDetail = item.detail;
  switch (detail.type) {
    case "shell":
      return `$ ${firstLine(detail.command, 160)}`;
    case "read":
      return `Read ${detail.filePath}`;
    case "edit":
      return `Edit ${detail.filePath}`;
    case "write":
      return `Write ${detail.filePath}`;
    case "search":
      return `Search ${firstLine(detail.query)}`;
    case "fetch":
      return `Fetch ${detail.url}`;
    case "sub_agent":
      return `Agent ${detail.subAgentType ?? ""} ${firstLine(detail.description ?? "")}`.replace(/\s+/g, " ").trim();
    case "plain_text":
      return detail.label ?? item.name;
    case "worktree_setup":
      return `Set up worktree ${detail.branchName}`;
    default:
      return item.name;
  }
}

/** Short line for the collapsed row so live activity is visible without a click. */
export function describeLatest(run: Run): string | null {
  const last = run.members.at(-1);
  if (!last) return null;
  if (last.kind === "reasoning") return `Thinking: ${firstLine(last.text)}`;
  return describeTool(last.item);
}

/**
 * Members to draw: all thinking, plus the newest `toolLimit` tool calls. Long
 * agent runs can hold thousands of calls; drawing them all at once stalls the app.
 */
export function visibleMembers(
  members: readonly Member[],
  toolLimit: number,
): { shown: Member[]; hiddenTools: number } {
  const toolTotal = members.reduce((count, member) => count + (member.kind === "tool" ? 1 : 0), 0);
  const hiddenTools = Math.max(0, toolTotal - toolLimit);
  let skipped = 0;
  const shown = members.filter((member) => {
    if (member.kind === "reasoning") return true;
    if (skipped < hiddenTools) {
      skipped += 1;
      return false;
    }
    return true;
  });
  return { shown, hiddenTools };
}

