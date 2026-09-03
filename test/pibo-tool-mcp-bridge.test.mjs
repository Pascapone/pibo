import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Type } from "typebox";
import { definePiboTool } from "../dist/tools/contract.js";
import { PiboToolCredentialRegistry } from "../dist/tools/credential-registry.js";
import { PiboToolMcpBridge } from "../dist/tools/mcp-bridge.js";

function scope(overrides = {}) {
	return {
		piboSessionId: "ps_a",
		piboRoomId: "room_a",
		profileName: "portable-a",
		runtimeInstanceId: "codex-native",
		adapterId: "codex",
		sessionGeneration: "generation-a",
		cwd: "/tmp/pibo-a",
		allowedToolNames: ["alpha"],
		...overrides,
	};
}

async function connectClient(url, token, name) {
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	});
	const client = new Client({ name, version: "1.0.0" });
	await client.connect(transport);
	return { client, transport };
}


test("MCP bridge rejects non-loopback bind addresses", () => {
	assert.throws(
		() => new PiboToolMcpBridge({ host: "0.0.0.0", resolveTools: () => [] }),
		/must bind to a loopback address/,
	);
});


test("session tool credentials are hashed, scoped, renewable, expiring, and revocable", () => {
	let now = Date.parse("2026-08-15T12:00:00.000Z");
	const registry = new PiboToolCredentialRegistry({
		now: () => now,
		defaultTtlMs: 1_000,
		maxLifetimeMs: 5_000,
	});
	const issued = registry.issue(scope({ allowedToolNames: ["zeta", "alpha", "alpha"] }));
	assert.match(issued.token, /^pibo_tool_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{40,}$/);
	assert.deepEqual(issued.info.allowedToolNames, ["alpha", "zeta"]);
	assert.equal(JSON.stringify(issued.info).includes(issued.token), false);
	assert.equal(registry.authenticate(issued.token).piboSessionId, "ps_a");

	now += 500;
	assert.equal(registry.renew(issued.token, 2_000).expiresAt, "2026-08-15T12:00:02.500Z");
	now += 1_900;
	assert.equal(registry.authenticate(issued.token).credentialId, issued.info.credentialId);
	now += 200;
	assert.throws(() => registry.authenticate(issued.token), /expired/);

	const revoked = registry.issue(scope({ piboSessionId: "ps_b", sessionGeneration: "generation-b" }));
	assert.equal(registry.revokeSessionGeneration("ps_b", "generation-b"), 1);
	assert.throws(() => registry.authenticate(revoked.token), /revoked/);
	assert.equal(registry.cleanupExpired(), 2);
});


test("session-scoped MCP bridge enforces tool isolation and preserves progress, content, errors, correlation, and large results", async (t) => {
	const calls = [];
	const payloadWrites = [];
	let generationAActive = true;
	let slowStartedResolve;
	const slowStarted = new Promise((resolve) => { slowStartedResolve = resolve; });
	let slowObservedAbort = false;

	const alpha = definePiboTool({
		name: "alpha",
		title: "Alpha",
		description: "Session A echo",
		inputSchema: Type.Object({ value: Type.String() }),
		outputSchema: Type.Object({ echoed: Type.String() }),
		annotations: { readOnly: true, idempotent: true },
		async execute(toolCallId, input, _signal, onUpdate, context) {
			calls.push({ toolCallId, input, context });
			onUpdate?.({
				content: [{ type: "text", text: "halfway" }],
				progress: 1,
				total: 2,
				message: "halfway",
			});
			return {
				content: [
					{ type: "text", text: `alpha:${input.value}` },
					{ type: "image", mimeType: "image/png", data: Buffer.from("small-image").toString("base64") },
				],
				structuredContent: { echoed: input.value },
				metadata: { source: "test" },
			};
		},
	});
	const beta = definePiboTool({
		name: "beta",
		title: "Beta",
		description: "Session B echo",
		inputSchema: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "beta" }] };
		},
	});
	const large = definePiboTool({
		name: "large",
		title: "Large",
		description: "Large result fixture",
		inputSchema: Type.Object({}),
		async execute() {
			return {
				content: [{ type: "text", text: "x".repeat(256) }],
				structuredContent: { value: "y".repeat(256) },
			};
		},
	});
	const runRead = definePiboTool({
		name: "pibo_run_read",
		title: "Pibo Run Read",
		description: "Complete large run result fixture",
		inputSchema: Type.Object({ runId: Type.String() }),
		async execute() {
			return {
				content: [{ type: "text", text: "r".repeat(256) }],
				details: { runId: "run_large", result: { details: { finalMessage: "f".repeat(256) } } },
			};
		},
	});
	const failure = definePiboTool({
		name: "failure",
		title: "Failure",
		description: "Execution error fixture",
		inputSchema: Type.Object({}),
		async execute() {
			throw new Error("portable failure");
		},
	});
	const slow = definePiboTool({
		name: "slow",
		title: "Slow",
		description: "Cancellation fixture",
		inputSchema: Type.Object({}),
		async execute(_toolCallId, _input, signal) {
			slowStartedResolve();
			await new Promise((resolve, reject) => {
				const timer = setTimeout(resolve, 10_000);
				signal?.addEventListener("abort", () => {
					slowObservedAbort = true;
					clearTimeout(timer);
					reject(signal.reason ?? new Error("aborted"));
				}, { once: true });
			});
			return { content: [{ type: "text", text: "unexpected" }] };
		},
	});
	const legacyPrivate = {
		name: "legacy_private",
		title: "Legacy Private",
		description: "Not portable",
		inputSchema: Type.Object({}),
		portable: false,
		async execute() {
			return { content: [{ type: "text", text: "private" }] };
		},
	};

	let exposedTools = [alpha, beta, failure, large, runRead, slow, legacyPrivate];
	const bridge = new PiboToolMcpBridge({
		largeResultThresholdBytes: 64,
		previewBytes: 16,
		isSessionGenerationActive: (credential) => credential.piboSessionId !== "ps_a" || generationAActive,
		resolveTools: () => exposedTools,
		payloadWriter: {
			write(input) {
				const bytes = input.value instanceof Uint8Array
					? input.value
					: Buffer.from(typeof input.value === "string" ? input.value : JSON.stringify(input.value));
				const result = { ref: `payload_${payloadWrites.length + 1}`, byteLength: bytes.byteLength, preview: "preview" };
				payloadWrites.push({ input, result });
				return result;
			},
		},
	});
	const address = await bridge.start();
	t.after(async () => bridge.stop());

	const credentialA = bridge.issueCredential(scope({ allowedToolNames: ["alpha", "failure", "large", "pibo_run_read", "slow", "legacy_private"] }));
	const credentialB = bridge.issueCredential(scope({
		piboSessionId: "ps_b",
		piboRoomId: "room_b",
		profileName: "portable-b",
		sessionGeneration: "generation-b",
		cwd: "/tmp/pibo-b",
		allowedToolNames: ["beta"],
	}));

	const unauthorized = await fetch(address.url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "unauthorized", version: "1" } } }),
	});
	assert.equal(unauthorized.status, 401);

	const a = await connectClient(address.url, credentialA.token, "session-a");
	t.after(async () => a.transport.close());
	const listedA = await a.client.listTools();
	assert.deepEqual(listedA.tools.map((tool) => tool.name).sort(), ["alpha", "failure", "large", "pibo_run_read", "slow"]);
	assert.equal(listedA.tools.some((tool) => tool.name === "legacy_private"), false);
	assert.equal(listedA.tools.find((tool) => tool.name === "alpha").annotations.readOnlyHint, true);

	const progress = [];
	const alphaResult = await a.client.callTool(
		{ name: "alpha", arguments: { value: "hello" } },
		undefined,
		{ onprogress: (update) => progress.push(update) },
	);
	assert.equal(alphaResult.isError, undefined);
	assert.equal(alphaResult.content[0].text, "alpha:hello");
	assert.equal(alphaResult.content[1].type, "image");
	assert.deepEqual(alphaResult.structuredContent, { echoed: "hello" });
	assert.equal(progress[0].message, "halfway");
	assert.equal(calls[0].context.piboSessionId, "ps_a");
	assert.equal(calls[0].context.runtimeInstanceId, "codex-native");
	assert.equal(calls[0].context.adapterId, "codex");
	assert.equal(calls[0].context.sessionGeneration, "generation-a");
	assert.equal(alphaResult._meta.piboSessionId, "ps_a");
	assert.equal(alphaResult._meta.toolCallId, calls[0].toolCallId);

	const invalid = await a.client.callTool({ name: "alpha", arguments: { value: 123 } });
	assert.equal(invalid.isError, true);
	assert.match(invalid.content[0].text, /Invalid arguments/);

	const crossSession = await a.client.callTool({ name: "beta", arguments: {} });
	assert.equal(crossSession.isError, true);
	assert.match(crossSession.content[0].text, /outside this session credential/);
	const failed = await a.client.callTool({ name: "failure", arguments: {} });
	assert.equal(failed.isError, true);
	assert.match(failed.content[0].text, /portable failure/);
	assert.equal(failed._meta.piboSessionId, "ps_a");

	const largeResult = await a.client.callTool({ name: "large", arguments: {} });
	assert.equal(payloadWrites.length, 2);
	assert.equal(largeResult.structuredContent, undefined);
	assert.equal(largeResult._meta.payloadRefs.length, 2);
	assert.equal(payloadWrites[1].input.contentType, "application/json");
	assert.deepEqual(payloadWrites[1].input.value, { value: "y".repeat(256) });
	assert.match(largeResult.content.map((item) => item.type === "text" ? item.text : "").join("\n"), /Large result stored/);
	assert.match(largeResult.content.map((item) => item.type === "text" ? item.text : "").join("\n"), /Structured result stored/);
	const completeRunRead = await a.client.callTool({ name: "pibo_run_read", arguments: { runId: "run_large" } });
	assert.equal(payloadWrites.length, 2, "pibo_run_read must not externalize its complete terminal result");
	assert.equal(completeRunRead.content[0].text, "r".repeat(256));
	assert.equal(completeRunRead.structuredContent.result.details.finalMessage, "f".repeat(256));
	exposedTools = exposedTools.filter((tool) => tool.name !== "large");
	const removedTool = await a.client.callTool({ name: "large", arguments: {} });
	assert.equal(removedTool.isError, true);
	assert.match(removedTool.content[0].text, /unavailable or not portable/);

	const abortController = new AbortController();
	const slowCall = a.client.callTool(
		{ name: "slow", arguments: {} },
		undefined,
		{ signal: abortController.signal, timeout: 20_000 },
	);
	await slowStarted;
	abortController.abort(new Error("test cancellation"));
	await assert.rejects(slowCall);
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(slowObservedAbort, true);

	const b = await connectClient(address.url, credentialB.token, "session-b");
	t.after(async () => b.transport.close());
	const listedB = await b.client.listTools();
	assert.deepEqual(listedB.tools.map((tool) => tool.name), ["beta"]);
	assert.ok(a.transport.sessionId);
	const hijack = await fetch(address.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${credentialB.token}`,
			"content-type": "application/json",
			"mcp-session-id": a.transport.sessionId,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
	});
	assert.equal(hijack.status, 403);
	const betaResult = await b.client.callTool({ name: "beta", arguments: {} });
	assert.equal(betaResult.content[0].text, "beta");

	generationAActive = false;
	const staleGeneration = await fetch(address.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${credentialA.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
	});
	assert.equal(staleGeneration.status, 403);
});
