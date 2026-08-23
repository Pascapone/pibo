import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	injectPiToolIntentSchema,
	installPiIntentTracing,
	piIntentTracingEnabled,
	piToolIntentField,
	piToolIntentFieldForSchema,
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

function fakeIndexedTool(executions) {
	return {
		name: "indexed_read",
		label: "indexed read",
		description: "Read an indexed record",
		parameters: {
			type: "object",
			properties: { i: { type: "integer" }, path: { type: "string" } },
			required: ["i", "path"],
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

test("Pi intent schema injects the required intent first without colliding with tool fields", () => {
	const schema = injectPiToolIntentSchema({
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
	});
	assert.deepEqual(Object.keys(schema.properties), ["i", "path"]);
	assert.deepEqual(schema.required, ["i", "path"]);
	assert.match(schema.properties.i.description, /present-participle intent/);

	const collisionSchema = {
		type: "object",
		properties: { i: { type: "integer" }, __pibo_intent: { type: "boolean" } },
		required: ["i", "__pibo_intent"],
	};
	assert.equal(piToolIntentFieldForSchema(collisionSchema), "__pibo_intent_2");
	const wrappedCollisionSchema = injectPiToolIntentSchema(collisionSchema);
	assert.deepEqual(Object.keys(wrappedCollisionSchema.properties), ["__pibo_intent_2", "i", "__pibo_intent"]);
	assert.deepEqual(wrappedCollisionSchema.required, ["__pibo_intent_2", "i", "__pibo_intent"]);
	assert.equal(wrappedCollisionSchema.properties.i.type, "integer");
	assert.equal(wrappedCollisionSchema.properties.__pibo_intent.type, "boolean");
	assert.equal(piToolIntentFieldForSchema({ type: "object", required: ["i"] }), "__pibo_intent");
});

test("Pi intent wrapper strips only the injected field before executing every active tool", async () => {
	const executions = [];
	const session = {
		agent: { state: { tools: [fakeTool(executions), fakeIndexedTool(executions)] } },
		setActiveToolsByName() {
			this.agent.state.tools = [fakeTool(executions), fakeIndexedTool(executions)];
		},
	};
	installPiIntentTracing(session);
	const wrapped = session.agent.state.tools[0];
	assert.deepEqual(Object.keys(wrapped.parameters.properties), ["i", "path"]);
	await wrapped.execute("call-1", { i: "Reviewing runtime configuration", path: "src/runtime.ts" });

	const wrappedIndexed = session.agent.state.tools[1];
	assert.equal(piToolIntentField(session, "indexed_read"), "__pibo_intent");
	assert.deepEqual(Object.keys(wrappedIndexed.parameters.properties), ["__pibo_intent", "i", "path"]);
	const indexedArguments = wrappedIndexed.prepareArguments({
		__pibo_intent: " Reviewing indexed record ",
		i: 7,
		path: "records.json",
	});
	assert.deepEqual(indexedArguments, {
		__pibo_intent: "Reviewing indexed record",
		i: 7,
		path: "records.json",
	});
	await wrappedIndexed.execute("call-2", indexedArguments);
	assert.deepEqual(executions, [
		{ toolCallId: "call-1", params: { path: "src/runtime.ts" } },
		{ toolCallId: "call-2", params: { i: 7, path: "records.json" } },
	]);

	session.setActiveToolsByName(["read", "indexed_read"]);
	assert.deepEqual(Object.keys(session.agent.state.tools[0].parameters.properties), ["i", "path"]);
	assert.deepEqual(Object.keys(session.agent.state.tools[1].parameters.properties), ["__pibo_intent", "i", "path"]);
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

	const collisionEvent = normalizePiEvent("ps-intent", {
		type: "tool_execution_start",
		toolCallId: "call-2",
		toolName: "indexed_read",
		args: { __pibo_intent: "Reviewing indexed record", i: 7, path: "records.json" },
	}, {
		intentTracing: true,
		intentFieldForTool: (toolName) => toolName === "indexed_read" ? "__pibo_intent" : undefined,
	});
	assert.equal(collisionEvent.intent, "Reviewing indexed record");
	assert.deepEqual(collisionEvent.args, { i: 7, path: "records.json" });
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
