import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityStore } from "../client/store.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shell = (callId: string, status = "completed") =>
  ({ type: "tool_call", callId, name: "bash", status, error: null, detail: { type: "shell", command: "ls" } }) as const;
const reasoning = (text: string) => ({ type: "reasoning", text }) as const;
const assistant = (text: string) => ({ type: "assistant_message", text }) as const;
const user = (text: string) => ({ type: "user_message", text }) as const;

type Item = ReturnType<typeof shell> | ReturnType<typeof reasoning> | ReturnType<typeof assistant> | ReturnType<typeof user>;

function fakePaseo(timelines: Record<string, Item[]>, options: { fail?: boolean } = {}) {
  const handlers = new Map<string, (event: unknown) => void>();
  const paseo = {
    agents: {
      ref(agentId: string) {
        return {
          timeline: {
            subscribe(handler: (event: unknown) => void) {
              handlers.set(agentId, handler);
              const unsubscribe = Object.assign(() => handlers.delete(agentId), {
                ready: Promise.resolve(),
                subscriptionId: "s",
                release: async () => {},
              });
              return unsubscribe;
            },
            async refetch() {
              if (options.fail) throw new Error("offline");
              const items = timelines[agentId] ?? [];
              return {
                entries: items.map((item, seq) => ({ item, seqStart: seq, seqEnd: seq })),
                epoch: "e1",
                startCursor: null,
                hasOlder: false,
                error: null,
              };
            },
          },
        };
      },
    },
  };
  const emit = (agentId: string, item: Item, seq: number) =>
    handlers.get(agentId)?.({ agentId, event: { type: "timeline", item, provider: "pi" }, seq, epoch: "e1", timestamp: "" });
  return { paseo: paseo as never, emit };
}

function createStore(timelines: Record<string, Item[]>, options?: { fail?: boolean }) {
  const fake = fakePaseo(timelines, options);
  let reprojections = 0;
  const store: ActivityStore = new ActivityStore(fake.paseo, () => {
    reprojections += 1;
    store.beginGeneration();
  });
  return { store, emit: fake.emit, reprojections: () => reprojections };
}

/** What the timeline shows for these items, in order, as Paseo would project them. */
function project(store: ActivityStore, items: Item[]) {
  return items.map((item) => {
    if (item.type !== "reasoning" && item.type !== "tool_call") return "native";
    const decision = store.decide(item as never);
    return decision.kind === "group" ? `group:${decision.runId}` : decision.kind;
  });
}

const history: Item[] = [
  user("go"),
  reasoning("Plan: read then test."),
  shell("c1"),
  reasoning("Tests next."),
  shell("c2"),
  assistant("Done."),
  reasoning("Second run."),
  shell("c3"),
];

test("unknown items are drawn on their own until the mirror loads, then grouped", async () => {
  const { store, reprojections } = createStore({ a1: history });
  assert.deepEqual(project(store, history), [
    "native", "fallback", "fallback", "fallback", "fallback", "native", "fallback", "fallback",
  ]);
  store.ensure("a1");
  await sleep(200);
  assert.equal(store.status("a1"), "ready");
  assert.ok(reprojections() >= 1, "mirror load reprojects the timeline");

  assert.deepEqual(project(store, history), [
    "native", "group:r:a1:1", "hide", "hide", "hide", "native", "group:r:a1:6", "hide",
  ]);
  const run = store.getRun("a1", "r:a1:1");
  assert.deepEqual(run?.members.map((member) => member.kind), ["reasoning", "tool", "reasoning", "tool"]);
  store.dispose();
});

test("live items join the open run without a reprojection", async () => {
  const { store, emit, reprojections } = createStore({ a1: history });
  store.ensure("a1");
  await sleep(200);
  project(store, history);
  const before = reprojections();

  emit("a1", reasoning("More thinking."), 8);
  emit("a1", shell("c4", "running"), 9);
  assert.equal(store.decide(reasoning("More thinking.") as never).kind, "hide");
  assert.equal(store.decide(shell("c4", "running") as never).kind, "hide");
  assert.equal(store.getRun("a1", "r:a1:6")?.members.length, 4);

  emit("a1", assistant("Finished."), 10);
  emit("a1", reasoning("New turn thinking."), 11);
  assert.deepEqual(store.decide(reasoning("New turn thinking.") as never), { kind: "group", runId: "r:a1:11" });
  await sleep(200);
  assert.equal(reprojections(), before);
  store.dispose();
});

test("an item the app drew before the mirror saw it gets regrouped", async () => {
  const { store, emit, reprojections } = createStore({ a1: history });
  store.ensure("a1");
  await sleep(200);
  project(store, history);
  const before = reprojections();
  assert.equal(store.decide(shell("c9") as never).kind, "fallback");
  emit("a1", shell("c9"), 8);
  await sleep(200);
  assert.equal(reprojections(), before + 1);
  // The reprojection replays the whole timeline in order.
  assert.equal(project(store, [...history, shell("c9")]).at(-1), "hide");
  store.dispose();
});

test("an older member appearing later takes the row and triggers a reprojection", async () => {
  const { store, reprojections } = createStore({ a1: history });
  store.ensure("a1");
  await sleep(200);
  const before = reprojections();
  // App had only the tail of the first run loaded.
  assert.deepEqual(store.decide(shell("c2") as never), { kind: "group", runId: "r:a1:1" });
  // Scrolling up loads the start of the run.
  assert.deepEqual(store.decide(reasoning("Plan: read then test.") as never), { kind: "group", runId: "r:a1:1" });
  await sleep(200);
  assert.equal(reprojections(), before + 1);
  assert.deepEqual(project(store, history).slice(1, 5), ["group:r:a1:1", "hide", "hide", "hide"]);
  store.dispose();
});

test("a failed mirror never hides anything", async () => {
  const { store } = createStore({ a1: history }, { fail: true });
  store.ensure("a1");
  await sleep(200);
  assert.equal(store.status("a1"), "failed");
  assert.ok(project(store, history).every((decision) => decision === "native" || decision === "fallback"));
  store.dispose();
});

test("every hidden item belongs to a run whose row is drawn", async () => {
  const { store } = createStore({ a1: history, a2: [user("x"), reasoning("Other agent."), shell("d1")] });
  store.ensure("a1");
  store.ensure("a2");
  await sleep(200);
  const shown = new Set<string>();
  for (const items of [history, [user("x"), reasoning("Other agent."), shell("d1")] as Item[]]) {
    for (const item of items) {
      if (item.type !== "reasoning" && item.type !== "tool_call") continue;
      const decision = store.decide(item as never);
      if (decision.kind === "group") shown.add(decision.runId);
      if (decision.kind === "hide") {
        const runId = item.type === "tool_call" ? `t:${item.callId}` : null;
        // A hidden item's run must already have its row.
        assert.ok(shown.size > 0, `hidden ${runId ?? item.type} with no row`);
      }
    }
  }
  assert.deepEqual([...shown].sort(), ["r:a1:1", "r:a1:6", "r:a2:1"]);
  store.dispose();
});
