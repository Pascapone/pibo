import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/agent-runtimes/pi/runtime.js";
import { savePiboCustomBasePrompt } from "../dist/core/base-prompt.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";

async function fakeProvider(t) {
	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (value => value);
		requests.push(JSON.parse(decompress(Buffer.concat(chunks)).toString()));
		const id = `answer-${requests.length}`;
		const item = { type: "message", id, role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		const tool = { type: "function_call", id: "fc_prefix", call_id: "call_prefix", name: "prefix_probe", arguments: "{}", status: "completed" };
		const events = requests.length === 1 ? [
			{ type: "response.output_item.added", output_index: 0, item: { ...tool, arguments: "", status: "in_progress" } },
			{ type: "response.function_call_arguments.delta", delta: "{}" },
			{ type: "response.output_item.done", output_index: 0, item: tool },
			{ type: "response.completed", response: { id: `response-${id}`, status: "completed", output: [tool], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
		] : [
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
			{ type: "response.output_text.delta", delta: "ok" },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: `response-${id}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: { cached_tokens: 0 } } } },
		 ];
		res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

for (const repeatCount of [250, 25000, 50000]) test(`Pi HTTP prefix and native tool history survive restart with ${repeatCount * 17} input characters`, { timeout: 60000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-http-"));
	const contextPath = join(root, "selected-context.md");
	await writeFile(contextPath, "Original selected context");
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const api = await fakeProvider(t);
	let runtime;
	let nativePath;
	t.after(async () => { await runtime?.dispose(); sessions.close(); if (nativePath) await rm(nativePath, { force: true }); await rm(root, { recursive: true, force: true }); });
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
	const credentials = new InMemoryCredentialStore();
	const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-only" } })).toString("base64url");
	await credentials.modify("openai-codex", async () => ({ type: "oauth", access: `test.${claim}.test`, refresh: "test-only", expires: Date.now() + 3600000 }));
	const modelRuntime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	const makeController = () => {
		let binding = sessions.get(session.id).runtimeBinding;
		return new SessionPrefixController({ store: new PrefixCapsuleStore(join(root, "prefixes")), getBinding: () => binding, persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	};
	let hookText = "original provider suffix";
	const open = async () => {
		const profile = new InitialSessionContextBuilder("prefix-http").withBuiltinTools("disabled").withAutoContextFiles(false).addContextFile({ path: contextPath }).createSession();
		profile.sessionId = session.piSessionId;
		const result = await createPiboRuntime({
			cwd: root, profile, persistSession: true, modelRuntime, modelDefaults: {}, prefixController: makeController(),
			extensionFactories: [pi => {
				pi.registerTool({ name: "prefix_probe", label: "Prefix probe", description: "Read the deterministic fixture value", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => ({ content: [{ type: "text", text: "persistent tool result" }], details: {} }) });
				pi.on("before_provider_request", event => ({ ...event.payload, instructions: `${event.payload.instructions}\n${hookText}`, tools: [...(event.payload.tools ?? []), { type: "web_search", search_context_size: hookText === "original provider suffix" ? "low" : "high" }] }));
			}],
		});
		result.session.agent.transport = "sse";
		result.session.state.model = { api: "openai-codex-responses", provider: "openai-codex", id: "gpt-5.5", name: "test", baseUrl: api.baseUrl, reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 1024 };
		result.session.setThinkingLevel("high");
		return result;
	};
	await savePiboCustomBasePrompt("Original base prompt", root);
	runtime = await open();
	await runtime.session.prompt("historic content ".repeat(repeatCount));
	assert.equal(api.requests.length, 2, JSON.stringify(runtime.session.state.messages.filter(message => message.role === "assistant").map(message => ({ stopReason: message.stopReason, errorMessage: message.errorMessage }))));
	assert.ok(api.requests[1].input.some(item => item.type === "function_call_output" && item.output.includes("persistent tool result")));
	nativePath = runtime.session.sessionFile;
	assert.ok(nativePath);
	const nativeBefore = await readFile(nativePath, "utf8");
	await runtime.dispose(); runtime = undefined;
	await savePiboCustomBasePrompt("Changed base prompt", root);
	hookText = "changed provider suffix";
	await writeFile(contextPath, "Changed selected context");
	const forbiddenSources = new Set([contextPath, join(root, ".pibo/base-prompt.json"), join(root, ".pibo/base-prompt.md")]);
	const sourceReads = [];
	const originalSyncRead = fs.readFileSync;
	const originalAsyncRead = fs.promises.readFile;
	fs.readFileSync = (path, ...args) => { if (forbiddenSources.has(path)) sourceReads.push(path); return originalSyncRead(path, ...args); };
	fs.promises.readFile = (path, ...args) => { if (forbiddenSources.has(path)) sourceReads.push(path); return originalAsyncRead(path, ...args); };
	syncBuiltinESMExports();
	try { runtime = await open(); await runtime.session.prompt("new message"); }
	finally { fs.readFileSync = originalSyncRead; fs.promises.readFile = originalAsyncRead; syncBuiltinESMExports(); }
	assert.deepEqual(sourceReads, [], "protected resume must not reread current base or selected context files");
	assert.equal(api.requests.length, 3);
	const [, before, after] = api.requests;
	assert.match(before.instructions, /Original selected context/);
	assert.equal(after.instructions, before.instructions);
	assert.deepEqual(after.tools, before.tools);
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	assert.deepEqual(after.input.slice(0, before.input.length), before.input);
	assert.ok((await readFile(nativePath, "utf8")).startsWith(nativeBefore), "native history is append-only in this fixture");
	assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.evidence, "adapter-inputs");
});
