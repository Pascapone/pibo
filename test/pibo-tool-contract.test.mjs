import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import {
	definePiboTool,
	normalizePiboToolDefinition,
} from "../dist/tools/contract.js";
import { compilePiboToolForPi } from "../dist/agent-runtimes/pi/tool-compiler.js";
import { normalizeToolProfile } from "../dist/core/profiles.js";


test("Pibo tool contract preserves JSON Schema types and compiles directly for Pi", async () => {
	const schema = Type.Object({ message: Type.String() });
	const seen = [];
	const definition = definePiboTool({
		name: "portable_echo",
		title: "Portable Echo",
		description: "Echo a value through the Pibo-owned tool contract.",
		inputSchema: schema,
		outputSchema: Type.Object({ echoed: Type.String() }),
		annotations: { readOnly: true, idempotent: true },
		async execute(toolCallId, input, _signal, onUpdate, context) {
			seen.push({ toolCallId, input, context });
			onUpdate?.({
				content: [{ type: "text", text: "halfway" }],
				progress: 1,
				total: 2,
				message: "halfway",
			});
			return {
				content: [
					{ type: "text", text: input.message },
					{ type: "image", mimeType: "image/png", data: Buffer.from("image").toString("base64") },
				],
				structuredContent: { echoed: input.message },
				details: { exact: true },
			};
		},
	});

	assert.equal(definition.label, "Portable Echo");
	assert.equal(definition.parameters, schema);
	const compiled = compilePiboToolForPi(definition, {
		piboSessionId: "ps_contract",
		piboRoomId: "room_contract",
		profileName: "portable",
		cwd: "/tmp/pibo-contract",
		runtimeInstanceId: "pi",
		sessionGeneration: "generation-1",
	});
	assert.equal(compiled.name, definition.name);
	assert.equal(compiled.label, definition.title);
	assert.equal(compiled.parameters, schema);

	const updates = [];
	const nativeContext = { cwd: "/tmp/native" };
	const result = await compiled.execute(
		"call-1",
		{ message: "hello" },
		undefined,
		(update) => updates.push(update),
		nativeContext,
	);

	assert.equal(result.content[0].text, "hello");
	assert.equal(result.content[1].type, "image");
	assert.deepEqual(updates[0].content, [{ type: "text", text: "halfway" }]);
	assert.deepEqual(result.details, {
		exact: true,
		_pibo: { structuredContent: { echoed: "hello" } },
	});
	assert.equal(seen[0].context.adapterId, "pi");
	assert.equal(seen[0].context.piboSessionId, "ps_contract");
	assert.equal(seen[0].context.cwd, "/tmp/pibo-contract");
	assert.equal(seen[0].context.nativeContext, nativeContext);
});


test("legacy Pi-shaped registrations normalize without leaking Pi types into generic profiles", async () => {
	const schema = Type.Object({ value: Type.String() });
	const legacy = {
		name: "legacy_echo",
		label: "Legacy Echo",
		description: "Compatibility fixture",
		parameters: schema,
		async execute(_toolCallId, input, _signal, _onUpdate, nativeContext) {
			return {
				content: [{ type: "text", text: `${nativeContext.prefix}:${input.value}` }],
				details: { legacy: true },
			};
		},
	};

	const normalized = normalizePiboToolDefinition(legacy);
	assert.equal(normalized.title, "Legacy Echo");
	assert.equal(normalized.inputSchema, schema);
	assert.equal(normalized.portable, false);
	await assert.rejects(
		() => normalized.execute("call", { value: "x" }, undefined, undefined, { cwd: "/tmp" }),
		/deprecated Pi-native definition contract/,
	);

	const profile = normalizeToolProfile({
		name: "legacy_echo",
		description: "Compatibility fixture",
		definition: legacy,
	});
	assert.equal(profile.definition.portable, false);
	const compiled = compilePiboToolForPi(profile.definition, { cwd: "/tmp" });
	const result = await compiled.execute("call", { value: "x" }, undefined, undefined, { prefix: "pi" });
	assert.equal(result.content[0].text, "pi:x");
});
