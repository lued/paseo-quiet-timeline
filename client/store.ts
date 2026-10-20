import type { PluginTimelineData } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  applyItem,
  closeMirror,
  compactToolItem,
  createMirror,
  indexMirror,
  matchReasoning,
  mirrorFromEntries,
  normalizeReasoning,
  prependMirror,
  type AgentIndex,
  type MemberRef,
  type Mirror,
  type Run,
  type ToolItem,
} from "../shared/activity.ts";

type Paseo = PluginClientContext["paseo"];
type AgentHandle = ReturnType<Paseo["agents"]["ref"]>;
type TimelineEvent = Parameters<Parameters<AgentHandle["timeline"]["subscribe"]>[0]>[0];
type TimelinePage = Awaited<ReturnType<AgentHandle["timeline"]["refetch"]>>;
type Cursor = NonNullable<TimelinePage["startCursor"]>;

/**
 * What a transformer does with one reasoning or tool call item:
 * - group: draw the whole run as one collapsible row here
 * - hide: the run's row already shows this item
 * - fallback: unresolved, draw the item on its own (never hidden)
 * - native: leave it to Paseo
 */
export type Decision =
  | { kind: "group"; runId: string }
  | { kind: "hide" }
  | { kind: "fallback" }
  | { kind: "native" };

const TAIL_LIMIT = 400;
const OLDER_LIMIT = 200;
const MAX_OLDER_LOADS = 10;
const MAX_AGENTS = 16;
const REPROJECT_DELAY_MS = 120;
const RETRY_MS = 5_000;

interface AgentState {
  agentId: string;
  status: "loading" | "ready" | "failed";
  mirror: Mirror;
  index: AgentIndex;
  handle: AgentHandle;
  unsubscribe: (() => void) | null;
  buffered: TimelineEvent[] | null;
  loadedMaxSeq: number;
  epoch: string | null;
  startCursor: Cursor | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderLoads: number;
  lastUsed: number;
  generation: number;
}

function isHiddenOrBreakingTool(item: ToolItem): boolean {
  const name = item.name.trim().toLowerCase();
  return (
    item.name === "ExitPlanMode" ||
    item.name === "plan_approval" ||
    item.detail.type === "plan" ||
    name === "speak"
  );
}

export class ActivityStore {
  private readonly agents = new Map<string, AgentState>();
  private readonly anchors = new Map<string, { key: string; order: number }>();
  private readonly pendingTools = new Set<string>();
  private readonly pendingReasoning = new Map<string, string>();
  private readonly expanded = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private reprojectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly paseo: Paseo;
  private readonly reproject: () => void;

  constructor(paseo: Paseo, reproject: () => void) {
    this.paseo = paseo;
    this.reproject = reproject;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    if (this.reprojectTimer) clearTimeout(this.reprojectTimer);
    for (const state of this.agents.values()) state.unsubscribe?.();
    this.agents.clear();
    this.listeners.clear();
  }

  // ---- transform side -------------------------------------------------------

  private lookup(item: AgentTimelineItem): MemberRef | null {
    if (item.type === "tool_call") {
      for (const state of this.agents.values()) {
        const ref = state.index.toolCalls.get(item.callId);
        if (ref) return ref;
      }
      return null;
    }
    if (item.type === "reasoning") {
      const candidates: Array<MemberRef & { norm: string }> = [];
      for (const state of this.agents.values()) candidates.push(...state.index.reasoning);
      return matchReasoning(candidates, item.text);
    }
    return null;
  }

  decide(item: AgentTimelineItem): Decision {
    if (item.type === "tool_call" && isHiddenOrBreakingTool(item)) return { kind: "native" };
    const ref = this.lookup(item);
    if (!ref) {
      if (item.type === "tool_call") this.pendingTools.add(item.callId);
      else if (item.type === "reasoning") {
        const norm = normalizeReasoning(item.text);
        if (norm) this.pendingReasoning.set(norm.slice(0, 64), item.text);
      }
      return { kind: "fallback" };
    }
    if (item.type === "tool_call") this.pendingTools.delete(item.callId);
    else if (item.type === "reasoning") {
      this.pendingReasoning.delete(normalizeReasoning(item.text).slice(0, 64));
    }
    const anchor = this.anchors.get(ref.runId);
    if (!anchor || anchor.key === ref.key) {
      this.anchors.set(ref.runId, { key: ref.key, order: ref.order });
      return { kind: "group", runId: ref.runId };
    }
    if (ref.order < anchor.order) {
      // An older member of this run just appeared (history loaded upward). It
      // becomes the row; reproject so the previous row hides.
      this.anchors.set(ref.runId, { key: ref.key, order: ref.order });
      this.scheduleReproject();
      return { kind: "group", runId: ref.runId };
    }
    return { kind: "hide" };
  }

  /** Called right before the transformers are re-registered. */
  beginGeneration(): void {
    this.anchors.clear();
    this.pendingTools.clear();
    this.pendingReasoning.clear();
  }

  private scheduleReproject(): void {
    if (this.disposed || this.reprojectTimer) return;
    this.reprojectTimer = setTimeout(() => {
      this.reprojectTimer = null;
      if (this.disposed) return;
      this.reproject();
    }, REPROJECT_DELAY_MS);
  }

  /** True when an item drawn as a fallback could now be resolved. */
  private hasResolvablePending(): boolean {
    for (const callId of this.pendingTools) {
      for (const state of this.agents.values()) if (state.index.toolCalls.has(callId)) return true;
    }
    if (this.pendingReasoning.size === 0) return false;
    const candidates: Array<MemberRef & { norm: string }> = [];
    for (const state of this.agents.values()) candidates.push(...state.index.reasoning);
    for (const text of this.pendingReasoning.values()) {
      if (matchReasoning(candidates, text)) return true;
    }
    return false;
  }

  private mirrorChanged(state: AgentState, structural: boolean): void {
    state.index = indexMirror(state.mirror);
    this.notify();
    if (structural || this.hasResolvablePending()) this.scheduleReproject();
  }

  // ---- render side ----------------------------------------------------------

  getRun(agentId: string, runId: string): Run | null {
    const state = this.agents.get(agentId);
    if (!state) return null;
    state.lastUsed = Date.now();
    return state.index.runs.get(runId) ?? null;
  }

  status(agentId: string): AgentState["status"] | "absent" {
    return this.agents.get(agentId)?.status ?? "absent";
  }

  /** The fallback row's item is unknown to a ready mirror: it may be older history. */
  knows(agentId: string, item: AgentTimelineItem): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;
    if (item.type === "tool_call") return state.index.toolCalls.has(item.callId);
    if (item.type === "reasoning") return matchReasoning(state.index.reasoning, item.text) !== null;
    return true;
  }

  isExpanded(runId: string): boolean {
    return this.expanded.has(runId);
  }

  toggle(runId: string): void {
    if (this.expanded.has(runId)) this.expanded.delete(runId);
    else this.expanded.add(runId);
    this.notify();
  }

  // ---- mirrors --------------------------------------------------------------

  ensure(agentId: string): void {
    if (this.disposed) return;
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.lastUsed = Date.now();
      return;
    }
    const mirror = createMirror(agentId);
    const state: AgentState = {
      agentId,
      status: "loading",
      mirror,
      index: indexMirror(mirror),
      handle: this.paseo.agents.ref(agentId),
      unsubscribe: null,
      buffered: [],
      loadedMaxSeq: -1,
      epoch: null,
      startCursor: null,
      hasOlder: false,
      loadingOlder: false,
      olderLoads: 0,
      lastUsed: Date.now(),
      generation: 0,
    };
    this.agents.set(agentId, state);
    this.evict();
    void this.start(state);
  }

  private evict(): void {
    if (this.agents.size <= MAX_AGENTS) return;
    const oldest = [...this.agents.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (!oldest) return;
    oldest.unsubscribe?.();
    this.agents.delete(oldest.agentId);
    this.scheduleReproject();
  }

  private async start(state: AgentState): Promise<void> {
    const generation = ++state.generation;
    try {
      const subscription = state.handle.timeline.subscribe((event) => this.onEvent(state, event));
      state.unsubscribe = subscription;
      await subscription.ready;
      if (!this.isCurrent(state, generation)) return;
      await this.loadTail(state, generation);
    } catch (error) {
      console.warn("[quiet-timeline] timeline mirror failed", state.agentId, error);
      this.fail(state, generation);
    }
  }

  private isCurrent(state: AgentState, generation: number): boolean {
    return !this.disposed && this.agents.get(state.agentId) === state && state.generation === generation;
  }

  private fail(state: AgentState, generation: number): void {
    if (!this.isCurrent(state, generation)) return;
    state.status = "failed";
    state.unsubscribe?.();
    state.unsubscribe = null;
    // Drop what we knew so nothing stays hidden behind stale data, then retry.
    state.mirror = createMirror(state.agentId);
    this.mirrorChanged(state, true);
    setTimeout(() => {
      if (!this.isCurrent(state, generation)) return;
      state.status = "loading";
      state.buffered = [];
      void this.start(state);
    }, RETRY_MS);
  }

  private async loadTail(state: AgentState, generation: number): Promise<void> {
    state.buffered ??= [];
    const page = await state.handle.timeline.refetch({
      direction: "tail",
      limit: TAIL_LIMIT,
      projection: "projected",
    });
    if (!this.isCurrent(state, generation)) return;
    if (page.error) throw new Error(page.error);
    state.mirror = mirrorFromEntries(state.agentId, page.entries);
    state.loadedMaxSeq = page.entries.reduce((max, entry) => Math.max(max, entry.seqEnd), -1);
    state.epoch = page.epoch;
    state.startCursor = page.startCursor;
    state.hasOlder = page.hasOlder;
    state.olderLoads = 0;
    state.status = "ready";
    const buffered = state.buffered ?? [];
    state.buffered = null;
    for (const event of buffered) this.applyEvent(state, event);
    this.mirrorChanged(state, true);
  }

  loadOlder(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state || state.status !== "ready" || !state.hasOlder || !state.startCursor) return;
    if (state.loadingOlder || state.olderLoads >= MAX_OLDER_LOADS) return;
    state.loadingOlder = true;
    state.olderLoads += 1;
    const generation = state.generation;
    void state.handle.timeline
      .refetch({ direction: "before", cursor: state.startCursor, limit: OLDER_LIMIT, projection: "projected" })
      .then((page) => {
        if (!this.isCurrent(state, generation)) return;
        if (page.error) throw new Error(page.error);
        if (page.epoch !== state.epoch) {
          void this.restart(state);
          return;
        }
        const older = mirrorFromEntries(state.agentId, page.entries);
        state.mirror = prependMirror(state.mirror, older);
        state.startCursor = page.startCursor;
        state.hasOlder = page.hasOlder;
        this.mirrorChanged(state, true);
      })
      .catch((error) => console.warn("[quiet-timeline] older history failed", agentId, error))
      .finally(() => {
        state.loadingOlder = false;
      });
  }

  private async restart(state: AgentState): Promise<void> {
    const generation = ++state.generation;
    state.status = "loading";
    state.buffered = [];
    try {
      await this.loadTail(state, generation);
    } catch (error) {
      console.warn("[quiet-timeline] timeline reload failed", state.agentId, error);
      this.fail(state, generation);
    }
  }

  private onEvent(state: AgentState, event: TimelineEvent): void {
    if (this.disposed || this.agents.get(state.agentId) !== state) return;
    const inner = (event as { event?: { type?: string } }).event;
    if (inner?.type === "replacement" || inner?.type === "subscription_restored") {
      void this.restart(state);
      return;
    }
    if (inner?.type === "error") {
      this.fail(state, state.generation);
      return;
    }
    if (state.buffered) {
      state.buffered.push(event);
      return;
    }
    // Live items only append or update; rows already drawn keep their decision.
    // Items the app drew before the mirror saw them are caught as pending.
    if (this.applyEvent(state, event)) this.mirrorChanged(state, false);
  }

  /** Returns true when the mirror changed. */
  private applyEvent(state: AgentState, event: TimelineEvent): boolean {
    const payload = event as {
      event?: { type?: string; item?: AgentTimelineItem };
      seq?: number;
      epoch?: string;
    };
    const inner = payload.event;
    if (!inner) return false;
    if (payload.epoch && state.epoch && payload.epoch !== state.epoch) {
      void this.restart(state);
      return false;
    }
    if (inner.type === "timeline" && inner.item) {
      if (payload.seq !== undefined && payload.seq <= state.loadedMaxSeq) return false;
      if (payload.seq !== undefined) state.loadedMaxSeq = payload.seq;
      return applyItem(state.mirror, inner.item, payload.seq, true);
    }
    if (inner.type === "turn_completed" || inner.type === "turn_failed" || inner.type === "turn_canceled") {
      closeMirror(state.mirror);
      return true;
    }
    return false;
  }
}

/** Row data for an item drawn on its own. Large outputs are cut. */
export function fallbackData(item: AgentTimelineItem): PluginTimelineData {
  const copy = item.type === "tool_call" ? compactToolItem(item) : item;
  // Timeline items are plain JSON from the daemon; the host clones this again.
  return { item: JSON.parse(JSON.stringify(copy)) as PluginTimelineData };
}
