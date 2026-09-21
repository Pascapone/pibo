import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFINITION = `
	const definition = {
		id: "test.d1-passthrough",
		version: "1.0.0",
		input: text(),
		output: text(),
		initial: "draft",
		final: "draft",
		nodes: {
			draft: {
				kind: "agent",
				runtime: "pibo",
				profile: { kind: "fixed", id: "pibo-agent" },
				input: text(),
				output: text(),
				routing: { parentSessionId: "ps_d1_parent", roomId: "room_d1", channel: "chat" },
				promptTemplate: "Draft an answer for: {{input}}",
			},
		},
		edges: {},
	};
`;

const RESULT_SCENARIO = `
	import assert from "node:assert/strict";
	const { runOneNodeAgentWorkflow, createPiboSessionRoutingAgentExecutor } = await import("./packages/workflows/src/runtime/index.ts");
	const { text } = await import("./packages/workflows/src/api/index.ts");
	${DEFINITION}
	const createdSessions = [];
	const emittedMessages = [];
	const links = [];
	const listeners = new Set();
	const routing = {
		createSession(input) {
			createdSessions.push(input);
			return { id: "ps_d1_agent", piSessionId: "pi_d1_agent", profile: input.profile };
		},
		emit(event) {
			emittedMessages.push(event);
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: "Routed draft is ready." });
				}
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSessionRuntimeStatus(piboSessionId) {
			assert.equal(piboSessionId, "ps_d1_agent");
			return { piboSessionId, enabledTools: ["read", "bash"] };
		},
	};
	const externalEvents = [];
	const result = await runOneNodeAgentWorkflow(definition, "Explain workflows", {
		now: () => "2026-09-21T11:00:00.000Z",
		createRunId: () => "wfr_d1_pass",
		createNodeAttemptId: () => "wna_d1_pass",
		emitEvent: (event) => externalEvents.push(event),
		agentExecutor: createPiboSessionRoutingAgentExecutor({
			routing,
			timeoutMs: 5000,
			createMessageId: () => "msg_d1_pass",
			title: "D1 passthrough",
			linkWorkflowSession: (link) => links.push(link),
		}),
	});
	assert.equal(result.ok, true);
	assert.equal(result.output, "Routed draft is ready.");
	assert.equal(result.run.id, "wfr_d1_pass");
	assert.equal(result.run.status, "completed");
	assert.deepEqual(result.run.current, { nodeId: "draft", status: "completed" });
	assert.equal(result.run.piboSessionId, "ps_d1_agent");
	assert.equal(result.run.output, "Routed draft is ready.");
	assert.equal(result.run.completedAt, "2026-09-21T11:00:00.000Z");
	assert.equal(result.run.failedAt, undefined);
	assert.equal(result.nodeAttempt.id, "wna_d1_pass");
	assert.equal(result.nodeAttempt.status, "completed");
	assert.equal(result.nodeAttempt.output, "Routed draft is ready.");
	assert.equal(result.nodeAttempt.metadata.piboSessionId, "ps_d1_agent");
	assert.equal(result.nodeAttempt.metadata.piSessionId, "pi_d1_agent");
	assert.deepEqual(result.nodeAttempt.metadata.finalPrompt, {
		text: "Draft an answer for: Explain workflows",
		source: "promptTemplate",
		tracePrivacy: { kind: "workflowRun", storage: "workflow-node-attempt", redacted: false },
	});
	assert.equal(result.nodeAttempt.metadata.runtime.profileId, "pibo-agent");
	assert.deepEqual(result.nodeAttempt.metadata.runtime.tools, ["read", "bash"]);
	assert.deepEqual(result.events.map((event) => event.type), ["workflow.started", "node.started", "node.completed", "workflow.completed"]);
	assert.deepEqual(externalEvents, result.events);
	assert.deepEqual(createdSessions, [{
		channel: "chat",
		kind: "chat",
		profile: "pibo-agent",
		parentId: "ps_d1_parent",
		workspace: undefined,
		title: "D1 passthrough",
		metadata: {
			workflowSessionKind: "agent_node",
			workflowRunId: "wfr_d1_pass",
			workflowId: "test.d1-passthrough",
			workflowVersion: "1.0.0",
			workflowNodeId: "draft",
			workflowNodeAttemptId: "wna_d1_pass",
			chatRoomId: "room_d1",
		},
	}]);
	assert.deepEqual(emittedMessages, [{
		type: "message",
		piboSessionId: "ps_d1_agent",
		id: "msg_d1_pass",
		text: "Draft an answer for: Explain workflows",
		source: "actor",
	}]);
	assert.deepEqual(links, [{
		piboSessionId: "ps_d1_agent",
		workflowSessionKind: "agent_node",
		workflowRunId: "wfr_d1_pass",
		workflowId: "test.d1-passthrough",
		workflowVersion: "1.0.0",
		workflowNodeId: "draft",
		workflowNodeAttemptId: "wna_d1_pass",
		parentPiboSessionId: "ps_d1_parent",
	}]);
	assert.equal(listeners.size, 0);
`;

const ABORT_SCENARIO = `
	import assert from "node:assert/strict";
	const { runOneNodeAgentWorkflow, createPiboSessionRoutingAgentExecutor } = await import("./packages/workflows/src/runtime/index.ts");
	const { text } = await import("./packages/workflows/src/api/index.ts");
	${DEFINITION}
	const createdSessions = [];
	const links = [];
	const listeners = new Set();
	const routing = {
		createSession(input) {
			createdSessions.push(input);
			return { id: "ps_d1_aborted", profile: input.profile };
		},
		emit(event) {
			queueMicrotask(() => {
				for (const listener of listeners) {
					listener({ type: "session_error", piboSessionId: event.piboSessionId, eventId: event.id, error: "Runtime aborted the turn" });
				}
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const externalEvents = [];
	const result = await runOneNodeAgentWorkflow(definition, "Explain workflows", {
		now: () => "2026-09-21T11:00:01.000Z",
		createRunId: () => "wfr_d1_abort",
		createNodeAttemptId: () => "wna_d1_abort",
		emitEvent: (event) => externalEvents.push(event),
		agentExecutor: createPiboSessionRoutingAgentExecutor({
			routing,
			timeoutMs: 5000,
			createMessageId: () => "msg_d1_abort",
			linkWorkflowSession: (link) => links.push(link),
		}),
	});
	assert.equal(result.ok, false);
	assert.deepEqual(result.error, { code: "WorkflowRuntimeError.executorFailed", message: "Runtime aborted the turn" });
	assert.equal(result.run.id, "wfr_d1_abort");
	assert.equal(result.run.status, "failed");
	assert.deepEqual(result.run.current, { nodeId: "draft", status: "failed" });
	assert.equal(result.run.output, undefined);
	assert.equal(result.run.completedAt, undefined);
	assert.equal(result.run.failedAt, "2026-09-21T11:00:01.000Z");
	assert.equal(result.run.piboSessionId, undefined);
	assert.equal(result.nodeAttempt.id, "wna_d1_abort");
	assert.equal(result.nodeAttempt.status, "failed");
	assert.deepEqual(result.nodeAttempt.error, { code: "WorkflowRuntimeError.executorFailed", message: "Runtime aborted the turn" });
	assert.equal(result.nodeAttempt.output, undefined);
	assert.equal(result.nodeAttempt.failedAt, "2026-09-21T11:00:01.000Z");
	assert.deepEqual(result.events.map((event) => event.type), ["workflow.started", "node.started", "node.failed", "workflow.failed"]);
	assert.deepEqual(externalEvents, result.events);
	assert.deepEqual(result.events[2].error, { code: "WorkflowRuntimeError.executorFailed", message: "Runtime aborted the turn" });
	assert.deepEqual(result.events[3].error, { code: "WorkflowRuntimeError.executorFailed", message: "Runtime aborted the turn" });
	assert.equal(createdSessions.length, 1);
	assert.equal(createdSessions[0].metadata.workflowRunId, "wfr_d1_abort");
	assert.equal(links.length, 1);
	assert.equal(links[0].piboSessionId, "ps_d1_aborted");
	assert.equal(listeners.size, 0);
`;

const INVALID_SHAPE_SCENARIO = `
	import assert from "node:assert/strict";
	const { runOneNodeAgentWorkflow } = await import("./packages/workflows/src/runtime/index.ts");
	const { text } = await import("./packages/workflows/src/api/index.ts");
	const definition = {
		id: "test.d1-invalid-shape",
		version: "1.0.0",
		input: text(),
		output: text(),
		initial: ["first", "second"],
		final: ["first", "second"],
		nodes: {
			first: { kind: "agent", runtime: "pibo", profile: { kind: "fixed", id: "pibo-agent" }, input: text(), output: text(), promptTemplate: "First {{input}}" },
			second: { kind: "agent", runtime: "pibo", profile: { kind: "fixed", id: "pibo-agent" }, input: text(), output: text(), promptTemplate: "Second {{input}}" },
		},
		edges: {},
	};
	let executorCalls = 0;
	const result = await runOneNodeAgentWorkflow(definition, "Explain workflows", {
		now: () => "2026-09-21T11:00:02.000Z",
		agentExecutor: () => {
			executorCalls += 1;
			return { output: "must never run" };
		},
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "WorkflowRuntimeError.invalidDefinition");
	assert.equal(result.run, undefined);
	assert.equal(result.nodeAttempt, undefined);
	assert.deepEqual(result.events, []);
	assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.oneNodeAgentRequired"), true);
	assert.equal(executorCalls, 0);
`;

async function runScenario(script) {
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		timeout: 120000,
		maxBuffer: 8 * 1024 * 1024,
	});
}

test("workflow routes through the Pibo Runtime seam to a completed result", async () => {
	await assert.doesNotReject(runScenario(RESULT_SCENARIO));
});

test("workflow runtime abort fails the run without a terminal overwrite", async () => {
	await assert.doesNotReject(runScenario(ABORT_SCENARIO));
});

test("invalid workflow shape never creates a runtime", async () => {
	await assert.doesNotReject(runScenario(INVALID_SHAPE_SCENARIO));
});
