import assert from "node:assert/strict";
import test from "node:test";
import {
  compareTraceOrder,
  eventTraceOrder,
  liveTraceOrder,
  transcriptTraceOrder,
} from "../dist/shared/trace-order.js";

function sortLabels(entries) {
  return entries
    .toSorted((left, right) => compareTraceOrder(left.order, right.order) || left.id.localeCompare(right.id))
    .map((entry) => entry.id);
}

test("trace source rank keeps transcript before event log before live nodes", () => {
  const ordered = sortLabels([
    { id: "live", order: liveTraceOrder(0, 0, "assistant.message") },
    { id: "event", order: eventTraceOrder(0, "assistant.message") },
    { id: "transcript", order: transcriptTraceOrder(10, 0, "assistant.message") },
  ]);

  assert.deepEqual(ordered, ["transcript", "event", "live"]);
});

test("trace phase rank orders nodes within the same transcript turn", () => {
  const ordered = sortLabels([
    { id: "assistant", order: transcriptTraceOrder(0, 3, "assistant.message") },
    { id: "tool-result", order: transcriptTraceOrder(0, 2, "tool.result") },
    { id: "user", order: transcriptTraceOrder(0, 0, "user.message") },
    { id: "reasoning", order: transcriptTraceOrder(0, 1, "model.reasoning") },
    { id: "turn", order: transcriptTraceOrder(0, 0, "agent.turn") },
  ]);

  assert.deepEqual(ordered, ["user", "turn", "reasoning", "tool-result", "assistant"]);
});

test("live trace order uses stream id before frame index", () => {
  const ordered = sortLabels([
    { id: "stream-2-frame-0", order: liveTraceOrder(2, 0, "assistant.message") },
    { id: "stream-1-frame-2", order: liveTraceOrder(1, 2, "assistant.message") },
    { id: "stream-1-frame-1", order: liveTraceOrder(1, 1, "assistant.message") },
  ]);

  assert.deepEqual(ordered, ["stream-1-frame-1", "stream-1-frame-2", "stream-2-frame-0"]);
});

test("missing trace order falls back after ordered nodes so callers can use stable id sorting", () => {
  const ordered = sortLabels([
    { id: "without-b" },
    { id: "with-order", order: eventTraceOrder(1, "assistant.message") },
    { id: "without-a" },
  ]);

  assert.deepEqual(ordered, ["with-order", "without-a", "without-b"]);
});

test("immutable render positions outrank changing trace sources", () => {
  const ordered = sortLabels([
    { id: "history-late", order: { ...transcriptTraceOrder(0, 0, "model.reasoning"), renderSequence: 2 } },
    { id: "live-first", order: { ...liveTraceOrder(undefined, undefined, "assistant.message"), renderSequence: 1 } },
    { id: "event-last", order: { ...eventTraceOrder(1, "tool.call"), renderSequence: 3 } },
  ]);

  assert.deepEqual(ordered, ["live-first", "history-late", "event-last"]);
});
