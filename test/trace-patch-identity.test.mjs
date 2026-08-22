import assert from "node:assert/strict";
import test from "node:test";
import { patchTraceViewWithEvent } from "../dist/shared/trace-engine.js";

const now = "2026-05-07T12:00:00.000Z";

function node(overrides) {
  return {
    id: overrides.id,
    piboSessionId: "ps-test",
    type: overrides.type,
    title: overrides.title ?? overrides.type,
    status: overrides.status ?? "done",
    children: [],
    ...overrides,
  };
}

function event(payload, sequence = 1) {
  return {
    id: `stored-${sequence}`,
    piboSessionId: "ps-test",
    eventSequence: sequence,
    type: payload.type,
    createdAt: now,
    payload,
  };
}

function view(nodes, rawEvents = []) {
  return {
    piboSessionId: "ps-test",
    piSessionId: "pi-test",
    title: "Trace",
    version: "v1",
    nodes,
    rawEvents,
  };
}

test("assistant delta only replaces the assistant node and preserves unrelated nodes", () => {
  const user = node({ id: "user-1", type: "user.message", title: "User", output: "hello" });
  const assistant = node({ id: "event:assistant:turn-1", type: "assistant.message", title: "Agent Message", status: "running", output: "hel", summary: "hel" });
  const tool = node({ id: "tool:call-1", type: "tool.call", title: "read", toolCallId: "call-1" });
  const base = view([user, assistant, tool]);

  const patched = patchTraceViewWithEvent(base, event({ type: "assistant_delta", piboSessionId: "ps-test", eventId: "turn-1", text: "lo" }), "running");

  const patchedById = new Map(patched.nodes.map((patchedNode) => [patchedNode.id, patchedNode]));
  assert.equal(patchedById.get(user.id), user);
  assert.notEqual(patchedById.get(assistant.id), assistant);
  assert.equal(patchedById.get(assistant.id).output, "hello");
  assert.equal(patchedById.get(tool.id), tool);
});

test("reasoning delta only replaces the reasoning node and preserves unrelated nodes", () => {
  const reasoning = node({ id: "event:thinking:turn-1", type: "model.reasoning", title: "Thinking", status: "running", output: "a", summary: "a" });
  const assistant = node({ id: "event:assistant:turn-1", type: "assistant.message", title: "Agent Message", status: "running", output: "answer", summary: "answer" });
  const base = view([reasoning, assistant]);

  const patched = patchTraceViewWithEvent(base, event({ type: "thinking_delta", piboSessionId: "ps-test", eventId: "turn-1", text: "b" }), "running");

  const patchedById = new Map(patched.nodes.map((patchedNode) => [patchedNode.id, patchedNode]));
  assert.notEqual(patchedById.get(reasoning.id), reasoning);
  assert.equal(patchedById.get(reasoning.id).output, "ab");
  assert.equal(patchedById.get(assistant.id), assistant);
});

test("tool update only replaces the matching tool node and preserves siblings", () => {
  const assistant = node({ id: "event:assistant:turn-1", type: "assistant.message", title: "Agent Message", output: "answer" });
  const tool = node({ id: "tool:call-1", type: "tool.call", title: "bash", toolCallId: "call-1", status: "running", input: { command: "echo hi" } });
  const otherTool = node({ id: "tool:call-2", type: "tool.call", title: "read", toolCallId: "call-2", status: "done" });
  const base = view([assistant, tool, otherTool]);

  const patched = patchTraceViewWithEvent(base, event({
    type: "tool_execution_finished",
    piboSessionId: "ps-test",
    eventId: "turn-1",
    toolCallId: "call-1",
    toolName: "bash",
    result: "hi",
    isError: false,
  }), "running");

  const patchedById = new Map(patched.nodes.map((patchedNode) => [patchedNode.id, patchedNode]));
  assert.equal(patchedById.get(assistant.id), assistant);
  assert.notEqual(patchedById.get(tool.id), tool);
  assert.equal(patchedById.get(tool.id).status, "done");
  assert.equal(patchedById.get(tool.id).output, "hi");
  assert.equal(patchedById.get(otherTool.id), otherTool);
});

test("tool intent updates replace the matching node even when no other field changes", () => {
  const tool = node({ id: "tool:call-1", type: "tool.call", title: "read", toolCallId: "call-1", status: "running", input: { path: "README.md" } });
  const otherTool = node({ id: "tool:call-2", type: "tool.call", title: "bash", toolCallId: "call-2", status: "running" });
  const base = view([tool, otherTool]);

  const patched = patchTraceViewWithEvent(base, event({
    type: "tool_execution_started",
    piboSessionId: "ps-test",
    eventId: "turn-1",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "README.md" },
    intent: "Reviewing project documentation",
  }), "running");

  const patchedById = new Map(patched.nodes.map((patchedNode) => [patchedNode.id, patchedNode]));
  assert.notEqual(patchedById.get(tool.id), tool);
  assert.equal(patchedById.get(tool.id).intent, "Reviewing project documentation");
  assert.equal(patchedById.get(otherTool.id), otherTool);
});

test("duplicate raw event returns the same trace view", () => {
  const assistant = node({ id: "event:assistant:turn-1", type: "assistant.message", title: "Agent Message", status: "running", output: "a", summary: "a" });
  const stored = event({ type: "assistant_delta", piboSessionId: "ps-test", eventId: "turn-1", text: "b" });
  const base = view([assistant], [stored]);

  const patched = patchTraceViewWithEvent(base, stored, "running");

  assert.equal(patched, base);
});