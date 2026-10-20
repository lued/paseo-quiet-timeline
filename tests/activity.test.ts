import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyItem,
  createMirror,
  describeSummary,
  indexMirror,
  matchReasoning,
  mirrorFromEntries,
  prependMirror,
  summarizeRun,
} from "../shared/activity.ts";

const shell = (callId: string, status = "completed", command = "ls") =>
  ({ type: "tool_call", callId, name: "bash", status, error: null, detail: { type: "shell", command, output: "out" } }) as never;
const read = (callId: string, filePath: string) =>
  ({ type: "tool_call", callId, name: "read", status: "completed", error: null, detail: { type: "read", filePath } }) as never;
const reasoning = (text: string) => ({ type: "reasoning", text }) as never;
const assistant = (text: string) => ({ type: "assistant_message", text }) as never;
const user = (text: string) => ({ type: "user_message", text }) as never;

test("reasoning chunks merge, tool calls update in place, messages break runs", () => {
  const mirror = createMirror("a1");
  applyItem(mirror, user("go"), 0, true);
  applyItem(mirror, reasoning("Let me "), 1, true);
  applyItem(mirror, reasoning("look."), 2, true);
  applyItem(mirror, shell("c1", "running"), 3, true);
  applyItem(mirror, shell("c1", "completed"), 4, true);
  applyItem(mirror, read("c2", "/x"), 5, true);
  applyItem(mirror, assistant("Done"), 6, true);
  applyItem(mirror, assistant(" here"), 7, true);
  applyItem(mirror, reasoning("Next"), 8, true);

  assert.deepEqual(
    mirror.entries.map((entry) => entry.kind),
    ["break", "reasoning", "tool", "tool", "break", "reasoning"],
  );
  const first = mirror.entries[1];
  assert.equal(first?.kind === "reasoning" && first.text, "Let me look.");
  assert.equal(first?.kind === "reasoning" && first.open, false, "a tool call closes the thought");

  const index = indexMirror(mirror);
  const runs = [...index.runs.values()];
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0]?.members.map((member) => member.key), ["r:a1:1", "t:c1", "t:c2"]);
  const tool = runs[0]?.members[1];
  assert.equal(tool?.kind === "tool" && tool.item.status, "completed");
  assert.equal(index.toolCalls.get("c2")?.runId, "r:a1:1");
});

test("speak and plan calls break a run; ExitPlanMode is skipped like Paseo does", () => {
  const mirror = createMirror("a1");
  applyItem(mirror, shell("c1"), 1, false);
  applyItem(mirror, { type: "tool_call", callId: "s", name: "speak", status: "completed", error: null, detail: { type: "unknown", input: "hi", output: null } } as never, 2, false);
  applyItem(mirror, shell("c2"), 3, false);
  applyItem(mirror, { type: "tool_call", callId: "p", name: "ExitPlanMode", status: "completed", error: null, detail: { type: "unknown", input: null, output: null } } as never, 4, false);
  applyItem(mirror, shell("c3"), 5, false);
  const runs = [...indexMirror(mirror).runs.values()];
  assert.deepEqual(runs.map((run) => run.members.map((member) => member.key)), [["t:c1"], ["t:c2", "t:c3"]]);
});

test("reasoning match accepts either text as prefix and refuses ambiguity", () => {
  const candidates = [
    { agentId: "a", key: "r:a:1", runId: "r:a:1", order: 1, norm: "Iwillreadthefile" },
    { agentId: "b", key: "r:b:1", runId: "r:b:1", order: 1, norm: "Iwillrunthetests" },
  ];
  assert.equal(matchReasoning(candidates, "I will read")?.key, "r:a:1", "app behind mirror");
  assert.equal(matchReasoning(candidates, "I will run the tests now")?.key, "r:b:1", "app ahead of mirror");
  assert.equal(matchReasoning(candidates, "I will"), null, "ambiguous prefix stays unresolved");
  assert.equal(matchReasoning(candidates, "   "), null);
  assert.equal(matchReasoning(candidates, "Something else"), null);
});

test("older pages prepend without duplicating entries", () => {
  const current = mirrorFromEntries("a1", [
    { item: shell("c2"), seqStart: 10 },
    { item: assistant("done"), seqStart: 11 },
  ]);
  const older = mirrorFromEntries("a1", [
    { item: user("go"), seqStart: 1 },
    { item: reasoning("think"), seqStart: 2 },
    { item: shell("c1"), seqStart: 3 },
    { item: shell("c2", "running"), seqStart: 4 },
  ]);
  const merged = prependMirror(current, older);
  assert.deepEqual(merged.entries.map((entry) => entry.key), ["b:a1:1", "r:a1:2", "t:c1", "t:c2", "b:a1:11"]);
  const runs = [...indexMirror(merged).runs.values()];
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.members.length, 3);
});

test("summary names thinking alongside tool counts", () => {
  const mirror = createMirror("a1");
  applyItem(mirror, reasoning("a"), 1, false);
  applyItem(mirror, shell("c1"), 2, false);
  applyItem(mirror, reasoning("b"), 3, false);
  applyItem(mirror, shell("c2"), 4, false);
  applyItem(mirror, read("c3", "/x"), 5, false);
  applyItem(mirror, read("c4", "/x"), 6, false);
  const run = [...indexMirror(mirror).runs.values()][0]!;
  assert.equal(describeSummary(summarizeRun(run)), "Thought 2 times, ran 2 commands, and read 1 file");
});

test("a huge run keeps every thought and the newest tool calls", async () => {
  const { visibleMembers } = await import("../shared/activity.ts");
  const mirror = createMirror("a1");
  applyItem(mirror, reasoning("early thought"), 0, false);
  for (let i = 1; i <= 500; i += 1) applyItem(mirror, shell(`c${i}`), i, false);
  applyItem(mirror, reasoning("late thought"), 501, false);
  applyItem(mirror, shell("c501"), 502, false);
  const run = [...indexMirror(mirror).runs.values()][0]!;
  const { shown, hiddenTools } = visibleMembers(run.members, 60);
  assert.equal(hiddenTools, 441);
  assert.equal(shown.filter((member) => member.kind === "reasoning").length, 2);
  assert.equal(shown.filter((member) => member.kind === "tool").length, 60);
  assert.equal(shown.at(-1)?.key, "t:c501");
});
