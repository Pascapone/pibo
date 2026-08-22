import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	injectPiToolIntentSchema,
	installPiIntentTracing,
	piIntentTracingEnabled,
	splitPiToolIntentArguments,
} from "../dist/agent-runtimes/pi/intent-tracing.js";
import { normalizePiEvent } from "../dist/agent-runtimes/pi/routed-session.js";
import { semanticEventFromPibo } from "../dist/agent-runtimes/pi/adapter.js";
import { createPiboRuntime } from "../dist/agent-runtimes/pi/runtime.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";

function fakeTool(executions) {
	return {
		name: "read",
		label: "read",
		description: "Read a file",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
		},
		async execute(toolCallId, params) {
			executions.push({ toolCallId, params });
			return { content: [{ type: "text", text: "ok" }] };
		},
	};
}

test("Pi intent tracing is disabled by default and enabled only by a boolean profile option", () => {
	assert.equal(piIntentTracingEnabled({}), false);
	assert.equal(piIntentTracingEnabled({ intentTracing: false }), false);
	assert.equal(piIntentTracingEnabled({ intentTracing: true }), true);
	assert.equal(piIntentTracingEnabled({ intentTracing: "true" }), false);
});

test("Pi intent schema injects the required intent as the first property and rejects collisions", () => {
	const schema = injectPiToolIntentSchema({
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
	});
	assert.deepEqual(Object.keys(schema.properties), ["i", "path"]);
	assert.deepEqual(schema.required, ["i", "path"]);
	assert.match(schema.properties.i.description, /present-participle intent/);
	assert.throws(
		() => injectPiToolIntentSchema({ type: "object", properties: { i: { type: "integer" } } }),
		/schema already defines "i"/,
	);
});

test("Pi intent wrapper strips intent before executing every active tool", async () => {
	const executions = [];
	const session = {
		agent: { state: { tools: [fakeTool(executions)] } },
		setActiveToolsByName() {
			this.agent.state.tools = [fakeTool(executions)];
		},
	};
	installPiIntentTracing(session);
	const wrapped = session.agent.state.tools[0];
	assert.deepEqual(Object.keys(wrapped.parameters.properties), ["i", "path"]);
	await wrapped.execute("call-1", { i: "Reviewing runtime configuration", path: "src/runtime.ts" });
	assert.deepEqual(executions, [{ toolCallId: "call-1", params: { path: "src/runtime.ts" } }]);

	session.setActiveToolsByName(["read"]);
	assert.deepEqual(Object.keys(session.agent.state.tools[0].parameters.properties), ["i", "path"]);
});

test("Pi runtime wraps every active built-in tool when the profile toggle is enabled", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-pi-intent-"));
	const profile = new InitialSessionContextBuilder("pi-intent-runtime")
		.withAgentRuntime("pi", { intentTracing: true })
		.createSession();
	const runtime = await createPiboRuntime({ cwd, persistSession: false, profile });
	try {
		const tools = runtime.session.agent.state.tools;
		assert.ok(tools.length > 0);
		for (const tool of tools) {
			assert.equal(tool.parameters.properties.i.type, "string", tool.name);
			assert.equal(tool.parameters.required[0], "i", tool.name);
		}
	} finally {
		await runtime.dispose();
		await rm(cwd, { recursive: true, force: true });
	}
});

test("Pi event normalization extracts configured intents without corrupting default tool arguments", () => {
	const rawEvent = {
		type: "tool_execution_start",
		toolCallId: "call-1",
		toolName: "read",
		args: { i: "Reviewing runtime configuration", path: "src/runtime.ts" },
	};
	const defaultEvent = normalizePiEvent("ps-default", rawEvent);
	assert.equal(defaultEvent.type, "tool_execution_started");
	assert.equal(defaultEvent.intent, undefined);
	assert.deepEqual(defaultEvent.args, rawEvent.args);

	const event = normalizePiEvent("ps-intent", rawEvent, { intentTracing: true });
	assert.equal(event.type, "tool_execution_started");
	assert.equal(event.intent, "Reviewing runtime configuration");
	assert.deepEqual(event.args, { path: "src/runtime.ts" });
	assert.deepEqual(splitPiToolIntentArguments({ i: "  Inspecting tests  ", path: "test" }), {
		intent: "Inspecting tests",
		args: { path: "test" },
	});
});

test("Pi semantic event conversion preserves tool call intent", () => {
	assert.deepEqual(semanticEventFromPibo({
		type: "tool_call",
		piboSessionId: "ps-intent",
		toolCallId: "call-1",
		toolName: "read",
		args: { path: "README.md" },
		argsComplete: true,
		intent: "Reviewing project documentation",
	}), {
		type: "tool_call",
		toolCallId: "call-1",
		toolName: "read",
		args: { path: "README.md" },
		argsComplete: true,
		intent: "Reviewing project documentation",
	});
});
