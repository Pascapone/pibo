import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import {
	definePiboTool,
	isPiboToolDefinition,
	normalizePiboToolDefinition,
	normalizePiboToolResult,
	piboToolTerminalStatus,
	piboToolTimeoutPhase,
} from "../dist/tools/contract.js";
import {
	definePiboTool as runtimeDefinePiboTool,
	definePluginSessionToolProvider,
	piboToolTerminalStatus as runtimeTerminalStatus,
	piboToolTimeoutPhase as runtimeTimeoutPhase,
} from "../dist/plugins/runtime.js";

test("b1-k02 tool helper fills compatibility defaults without overriding explicit values", () => {
	const schema = Type.Object({ value: Type.String() });
	const definition = definePiboTool({
		name: "b1_defaults",
		title: "B1 Defaults",
		description: "Defaulting fixture.",
		inputSchema: schema,
		async execute() {
			return { content: [{ type: "text", text: "ok" }] };
		},
	});
	assert.equal(definition.label, "B1 Defaults");
	assert.equal(definition.parameters, schema);

	const explicit = definePiboTool({
		name: "b1_explicit",
		title: "B1 Explicit",
		label: "Kept Label",
		description: "Explicit fixture.",
		inputSchema: schema,
		parameters: schema,
		async execute() {
			return { content: [{ type: "text", text: "ok" }] };
		},
	});
	assert.equal(explicit.label, "Kept Label");
	assert.equal(explicit.parameters, schema);
});

test("b1-k02 tool helper preserves the execute implementation by identity", () => {
	const execute = async () => ({ content: [{ type: "text", text: "ok" }] });
	const definition = definePiboTool({
		name: "b1_identity",
		title: "B1 Identity",
		description: "Identity fixture.",
		inputSchema: Type.Object({}),
		execute,
	});
	assert.equal(definition.execute, execute);
});

test("b1-k02 terminal helpers read timeout metadata and ignore anything else", () => {
	assert.equal(piboToolTerminalStatus({ metadata: { piboTerminalStatus: "timed_out" } }), "timed_out");
	assert.equal(piboToolTerminalStatus({ metadata: { piboTerminalStatus: "completed" } }), undefined);
	assert.equal(piboToolTerminalStatus({}), undefined);
	assert.equal(piboToolTimeoutPhase({ metadata: { piboTimeoutPhase: "startup" } }), "startup");
	assert.equal(piboToolTimeoutPhase({ metadata: { piboTimeoutPhase: "lifetime" } }), "lifetime");
	assert.equal(piboToolTimeoutPhase({ metadata: { piboTimeoutPhase: "middle" } }), undefined);
	assert.equal(piboToolTimeoutPhase({}), undefined);
});

test("b1-k02 tool definition guard distinguishes Pibo and legacy shapes", () => {
	const schema = Type.Object({ value: Type.String() });
	assert.equal(isPiboToolDefinition(definePiboTool({
		name: "b1_guard",
		title: "B1 Guard",
		description: "Guard fixture.",
		inputSchema: schema,
		async execute() {
			return { content: [] };
		},
	})), true);
	assert.equal(isPiboToolDefinition({
		name: "legacy",
		label: "Legacy",
		description: "Legacy fixture.",
		parameters: schema,
		async execute() {
			return { content: [] };
		},
	}), false);
	assert.equal(isPiboToolDefinition({ name: "no-execute", inputSchema: schema }), false);
	assert.equal(isPiboToolDefinition(undefined), false);
});

test("b1-k02 result normalization copies content and preserves optional fields", () => {
	const source = {
		content: [{ type: "text", text: "hello" }],
		structuredContent: { echoed: "hello" },
		details: { exact: true },
		isError: true,
		payloadRefs: ["payload-1"],
		metadata: { piboTerminalStatus: "timed_out" },
	};
	const normalized = normalizePiboToolResult(source);
	assert.deepEqual(normalized, source);
	assert.notEqual(normalized.content, source.content);
	assert.notEqual(normalized.content[0], source.content[0]);
	normalized.content[0].text = "mutated";
	assert.equal(source.content[0].text, "hello");

	const minimal = normalizePiboToolResult({ content: [{ type: "text", text: "x" }] });
	assert.deepEqual(minimal, { content: [{ type: "text", text: "x" }] });
	assert.equal("structuredContent" in minimal, false);
	assert.equal("details" in minimal, false);
	assert.equal("payloadRefs" in minimal, false);
	assert.equal("metadata" in minimal, false);
});

test("b1-k02 definition normalization passes Pibo definitions through untouched", () => {
	const definition = definePiboTool({
		name: "b1_passthrough",
		title: "B1 Passthrough",
		description: "Passthrough fixture.",
		inputSchema: Type.Object({}),
		async execute() {
			return { content: [] };
		},
	});
	assert.equal(normalizePiboToolDefinition(definition), definition);
});

test("b1-k02 legacy definitions normalize to non-portable tools with native context", async () => {
	const schema = Type.Object({ value: Type.String() });
	const seen = [];
	const legacy = {
		name: "b1_legacy",
		label: "B1 Legacy",
		description: "Legacy fixture.",
		promptSnippet: "Use sparingly.",
		promptGuidelines: ["one"],
		parameters: schema,
		executionMode: "sequential",
		async execute(toolCallId, input, signal, onUpdate, nativeContext) {
			seen.push({ toolCallId, input, signal, nativeContext });
			onUpdate?.({ content: [{ type: "text", text: "partial" }] });
			return { content: [{ type: "text", text: `${nativeContext.prefix}:${input.value}` }], details: { legacy: true } };
		},
	};
	const normalized = normalizePiboToolDefinition(legacy);
	assert.equal(normalized.title, "B1 Legacy");
	assert.equal(normalized.inputSchema, schema);
	assert.equal(normalized.portable, false);
	assert.equal(normalized.executionMode, "sequential");
	assert.equal(normalized.promptSnippet, "Use sparingly.");
	assert.deepEqual(normalized.promptGuidelines, ["one"]);

	await assert.rejects(
		() => normalized.execute("call-1", { value: "x" }, undefined, undefined, { cwd: "/tmp/b1-k02" }),
		/deprecated Pi-native definition contract/,
	);

	const updates = [];
	const nativeContext = { prefix: "native" };
	const result = await normalized.execute(
		"call-2",
		{ value: "y" },
		undefined,
		(update) => updates.push(update),
		{ cwd: "/tmp/b1-k02", nativeContext },
	);
	assert.equal(result.content[0].text, "native:y");
	assert.deepEqual(result.details, { legacy: true });
	assert.deepEqual(seen[0].toolCallId, "call-2");
	assert.deepEqual(seen[0].input, { value: "y" });
	assert.equal(seen[0].nativeContext, nativeContext);
	assert.deepEqual(updates[0].content, [{ type: "text", text: "partial" }]);
});

test("b1-k02 tool contract neither invents nor strips the yielded run scope", async () => {
	const legacy = {
		name: "b1_yield_scope",
		label: "B1 Yield Scope",
		description: "Yield scope fixture.",
		parameters: Type.Object({ value: Type.String() }),
		async execute(_toolCallId, _input, _signal, _onUpdate, nativeContext) {
			assert.equal("yieldedRunId" in nativeContext, false);
			return { content: [{ type: "text", text: "ok" }] };
		},
	};
	const normalized = normalizePiboToolDefinition(legacy);
	const nativeContext = { prefix: "native" };
	const context = { cwd: "/tmp/b1-k02", yieldedRunId: "run-b1-k02", nativeContext };
	await normalized.execute("call-3", { value: "z" }, undefined, undefined, context);
	assert.deepEqual(context, { cwd: "/tmp/b1-k02", yieldedRunId: "run-b1-k02", nativeContext });

	const directContext = { cwd: "/tmp/b1-k02" };
	const definition = definePiboTool({
		name: "b1_direct_scope",
		title: "B1 Direct Scope",
		description: "Direct scope fixture.",
		inputSchema: Type.Object({}),
		async execute(_toolCallId, _input, _signal, _onUpdate, received) {
			assert.equal("yieldedRunId" in received, false);
			return { content: [] };
		},
	});
	await definition.execute("call-4", {}, undefined, undefined, directContext);
	assert.deepEqual(directContext, { cwd: "/tmp/b1-k02" });
});

test("b1-k02 pibo tools observe a set yielded run scope by context identity", async () => {
	const context = { cwd: "/tmp/b1-k02", yieldedRunId: "run-b1-k02-set" };
	const definition = definePiboTool({
		name: "b1_yield_passthrough",
		title: "B1 Yield Passthrough",
		description: "Yield passthrough fixture.",
		inputSchema: Type.Object({}),
		async execute(_toolCallId, _input, _signal, _onUpdate, received) {
			assert.equal(received, context);
			assert.equal(received.yieldedRunId, "run-b1-k02-set");
			return { content: [] };
		},
	});
	await definition.execute("call-5", {}, undefined, undefined, context);
	assert.deepEqual(context, { cwd: "/tmp/b1-k02", yieldedRunId: "run-b1-k02-set" });
});

test("b1-k02 plugin runtime re-exports the shared tool contract helpers", () => {
	const provider = {
		createSession: () => ({ tools: [] }),
	};
	assert.equal(definePluginSessionToolProvider(provider), provider);
	assert.equal(runtimeDefinePiboTool, definePiboTool);
	assert.equal(runtimeTerminalStatus, piboToolTerminalStatus);
	assert.equal(runtimeTimeoutPhase, piboToolTimeoutPhase);
});
