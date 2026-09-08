import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { streamSimple as streamNativeCodex } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/agent-runtimes/pi/runtime.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { PI_AGENT_RUNTIME_CAPABILITIES } from "../dist/agent-runtimes/pi/adapter.js";
import { savePiboCustomBasePrompt } from "../dist/core/base-prompt.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

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
		let events = requests.length === 1 ? [
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
		if (requests.length === 1) {
			const reasoning = { type: "reasoning", id: "rs_prefix", summary: [{ type: "summary_text", text: "Fixture reasoning summary." }], encrypted_content: "opaque-fixture-reasoning" };
			events = [
				{ type: "response.output_item.added", output_index: 0, item: { ...reasoning, summary: [], encrypted_content: undefined } },
				{ type: "response.reasoning_summary_part.added", item_id: reasoning.id, output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } },
				{ type: "response.reasoning_summary_text.delta", item_id: reasoning.id, output_index: 0, summary_index: 0, delta: "Fixture reasoning summary." },
				{ type: "response.output_item.done", output_index: 0, item: reasoning },
				...events.map(event => typeof event.output_index === "number" ? { ...event, output_index: event.output_index + 1 } : event),
			];
			events.at(-1).response.output.unshift(reasoning);
		}
		res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise(resolve => server.close(resolve)));
	return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

for (const providerApi of ["openai-codex-responses", "openai-responses"])
for (const repeatCount of [250, 25000, 50000]) test(`Pi ${providerApi} HTTP prefix and native tool history survive restart with ${repeatCount * 17} input characters`, { timeout: 60000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-http-"));
	const contextPath = join(root, "selected-context.md");
	await writeFile(contextPath, "Original selected context");
	const skillDir = join(root, "selected-skill");
	await mkdir(skillDir);
	await writeFile(join(skillDir, "SKILL.md"), "---\nname: prefix-skill\ndescription: Stable prefix skill\n---\nOriginal Skill body");
	const resourceService = new PiboRuntimeResourceService({ rootDir: join(root, "generations") });
	t.after(() => resourceService.dispose());
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const api = await fakeProvider(t);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		if (url.origin !== new URL(api.baseUrl).origin) throw new Error("Fixture blocked non-loopback provider access");
		return originalFetch(input, init);
	};
	t.after(() => { globalThis.fetch = originalFetch; });
	let runtime;
	let nativePath;
	t.after(async () => { await runtime?.dispose(); sessions.close(); if (nativePath) await rm(nativePath, { force: true }); await rm(root, { recursive: true, force: true }); });
	const session = sessions.create({ channel: "test", kind: "chat", profile: "base" });
	sessions.updateRuntimeBinding(session.id, { ...session.runtimeBinding, state: "bound" }, { expectedRevision: 1 });
	const credentials = new InMemoryCredentialStore();
	const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-only" } })).toString("base64url");
	if (providerApi === "openai-codex-responses") await credentials.modify("openai-codex", async () => ({ type: "oauth", access: `test.${claim}.test`, refresh: "test-only", expires: Date.now() + 3600000 }));
	else await credentials.modify("openai", async () => ({ type: "api_key", key: "test-only-openai-key" }));
	const modelRuntime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	const makeController = () => {
		let binding = sessions.get(session.id).runtimeBinding;
		return new SessionPrefixController({ store: new PrefixCapsuleStore(join(root, "prefixes")), getBinding: () => binding, persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: session.id, onPersisted: next => { binding = next; } }) });
	};
	let hookText = "original provider suffix";
	let providerSearchEnabled = true;
	let searchFilters;
	let externalWebAccess;
	let providerExtras;
	let invalidCacheOptions;
	let prependInstruction = false;
	const open = async () => {
		const profile = new InitialSessionContextBuilder("prefix-http").withBuiltinTools("disabled").withAutoContextFiles(false).addContextFile({ path: contextPath }).addSkill({ name: "prefix-skill", path: join(skillDir, "SKILL.md") }).createSession();
		profile.sessionId = session.piSessionId;
		const prefixController = makeController();
		const resources = await resourceService.createSession({ piboSessionId: session.id, runtimeInstanceId: "pi", adapterId: "pi",
			sessionGeneration: `generation-${api.requests.length}`, profile, cwd: root, capabilities: PI_AGENT_RUNTIME_CAPABILITIES, prefixController });
		const result = await createPiboRuntime({
			cwd: root, profile, persistSession: true, modelRuntime, modelDefaults: {}, prefixController, resources,
			extensionFactories: [pi => {
				pi.registerTool({ name: "prefix_probe", label: "Prefix probe", description: "Read the deterministic fixture value", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => ({ content: [{ type: "text", text: "persistent tool result" }], details: {} }) });
				pi.on("before_provider_request", event => {
					if (providerApi === "openai-responses") {
						event.payload.input[0] = { ...event.payload.input[0], content: `${event.payload.input[0].content}\n${hookText}` };
						if (prependInstruction) event.payload.input.unshift({ role: "developer", content: "new prefix shape requires an epoch" });
					}
					return { ...event.payload, ...(invalidCacheOptions ? { prompt_cache_options: invalidCacheOptions } : {}), instructions: `${event.payload.instructions}\n${hookText}`, tools: [...(event.payload.tools ?? []), ...(providerSearchEnabled ? [{ type: "web_search", search_context_size: hookText === "original provider suffix" ? "low" : "high", ...(searchFilters ? { filters: searchFilters } : {}), ...(externalWebAccess === undefined ? {} : { external_web_access: externalWebAccess }), ...providerExtras }] : [])] };
				});
			}],
		});
		result.session.agent.transport = "sse";
		result.session.settingsManager.setTransport("sse");
		result.session.settingsManager.setCompactionEnabled(false);
		result.session.state.model = { api: providerApi, provider: providerApi === "openai-responses" ? "openai" : "openai-codex", id: "gpt-5.5", name: "test", baseUrl: api.baseUrl, reasoning: true, thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" }, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 1024 };
		result.session.setThinkingLevel("high");
		return result;
	};
	await savePiboCustomBasePrompt("Original base prompt", root);
	runtime = await open();
	if (repeatCount === 250) {
		providerExtras = { authorization: "execution-only-secret" };
		await runtime.session.prompt("reject unsupported execution credential fields");
		assert.equal(api.requests.length, 0);
		assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
		assert.ok(!JSON.stringify(runtime.session.state.messages).includes("execution-only-secret"));
		providerExtras = undefined;
		invalidCacheOptions = { mode: "explicit", authorization: "execution-only-secret" };
		await runtime.session.prompt("reject unsupported cache option fields");
		assert.equal(api.requests.length, 0);
		assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
		assert.ok(!JSON.stringify(runtime.session.state.messages).includes("execution-only-secret"));
		invalidCacheOptions = undefined;
	}
	await runtime.session.prompt("historic content ".repeat(repeatCount));
	assert.equal(api.requests.length, 2, JSON.stringify(runtime.session.state.messages.filter(message => message.role === "assistant").map(message => ({ stopReason: message.stopReason, errorMessage: message.errorMessage }))));
	assert.ok(api.requests[1].input.some(item => item.type === "function_call_output" && item.output.includes("persistent tool result")));
	assert.ok(api.requests[1].input.some(item => item.type === "reasoning" && item.encrypted_content === "opaque-fixture-reasoning"), "opaque native reasoning must survive the Tool roundtrip and subsequent resume");
	nativePath = runtime.session.sessionFile;
	assert.ok(nativePath);
	const nativeBefore = await readFile(nativePath, "utf8");
	await runtime.dispose(); runtime = undefined;
	await savePiboCustomBasePrompt("Changed base prompt", root);
	hookText = "changed provider suffix";
	await writeFile(contextPath, "Changed selected context");
	await rm(skillDir, { recursive: true });
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
	const skills = runtime.session.resourceLoader.getSkills().skills;
	assert.equal(skills.length, 1);
	assert.match(await readFile(skills[0].filePath, "utf8"), /Original Skill body/);
	assert.match(providerApi === "openai-responses" ? before.input[0].content : before.instructions, /Original selected context/);
	assert.equal(after.instructions, before.instructions);
	assert.deepEqual(after.tools, before.tools);
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	assert.deepEqual(after.input.slice(0, before.input.length), before.input);
	assert.ok((await readFile(nativePath, "utf8")).startsWith(nativeBefore), "native history is append-only in this fixture");
	assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.evidence, "adapter-inputs");
	if (repeatCount === 250) {
		const originalModel = runtime.session.state.model;
		runtime.session.state.model = { ...originalModel, compat: { supportsStrictMode: providerApi === "openai-codex-responses" } };
		await runtime.session.prompt("equivalent explicit compatibility defaults");
		assert.equal(api.requests.length, 4);
		const baselineCount = api.requests.length;
		runtime.session.state.model = { ...originalModel, thinkingLevelMap: { ...originalModel.thinkingLevelMap, max: "high" } };
		await runtime.session.prompt("changed max reasoning mapping");
		assert.equal(api.requests.length, baselineCount);
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /model input configuration changed/);
		runtime.session.state.model = originalModel;
		const currentTools = runtime.session.agent.state.tools;
		runtime.session.agent.state.tools = currentTools.filter(tool => tool.name !== "prefix_probe");
		await runtime.session.prompt("local tool removed during the active session");
		assert.equal(api.requests.length, baselineCount, "removed local tools must block dispatch under frozen definitions");
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /unavailable or incompatible/);
		runtime.session.agent.state.tools = currentTools.map(tool => tool.name === "prefix_probe"
			? { ...tool, parameters: { type: "object", properties: { changed: { type: "string" } } } } : tool);
		await runtime.session.prompt("local tool schema changed during the active session");
		assert.equal(api.requests.length, baselineCount, "incompatible live tools must block dispatch under frozen definitions");
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /unavailable or incompatible/);
		runtime.session.agent.state.tools = currentTools;
		providerSearchEnabled = false;
		await runtime.session.prompt("provider tool permission revoked");
		assert.equal(api.requests.length, baselineCount, "revoked provider tools must not execute under frozen definitions");
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /current authorization/);
		providerSearchEnabled = true;
		searchFilters = { allowed_domains: ["example.test"] };
		await runtime.session.prompt("provider domain authorization narrowed");
		assert.equal(api.requests.length, baselineCount);
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /authorization filters changed/);
		searchFilters = undefined;
		externalWebAccess = false;
		await runtime.session.prompt("external network access revoked");
		assert.equal(api.requests.length, baselineCount);
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /authorization filters changed/);
		if (providerApi === "openai-responses") {
			externalWebAccess = undefined;
			prependInstruction = true;
			await runtime.session.prompt("reject a new static prefix layout");
			assert.equal(api.requests.length, baselineCount);
			assert.match(runtime.session.state.messages.at(-1).errorMessage, /input prefix layout changed/);
		}
		externalWebAccess = undefined;
		prependInstruction = false;
		runtime.session.state.model = { ...originalModel, compat: { supportsToolSearch: true } };
		await runtime.session.prompt("changed native history serialization compatibility");
		assert.equal(api.requests.length, baselineCount);
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /model input configuration changed/);
		runtime.session.state.model = { ...originalModel, api: providerApi === "openai-responses" ? "openai-codex-responses" : "openai-responses" };
		await runtime.session.prompt("changed provider API");
		assert.equal(api.requests.length, baselineCount);
		assert.match(runtime.session.state.messages.at(-1).errorMessage, /provider API change/);
	}
	if (repeatCount === 50000) {
		const prefixBefore = sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix;
		await runtime.session.prompt("second substantial turn ".repeat(10000));
		const inputBeforeCompaction = api.requests.at(-1).input;
		await runtime.session.compact();
		const compacted = sessions.get(session.id).runtimeBinding.metadata;
		assert.equal(compacted.piboSessionPrefixTransition.state, "completed");
		assert.equal(compacted.piboSessionPrefix.epoch, prefixBefore.epoch + 1);
		assert.equal(compacted.piboSessionPrefix.capsule.digest, prefixBefore.capsule.digest);
		await runtime.dispose(); runtime = undefined;
		runtime = await open();
		await runtime.session.prompt("continue after compacted restart");
		assert.equal(api.requests.at(-1).instructions, before.instructions);
		assert.deepEqual(api.requests.at(-1).tools, before.tools);
		assert.notDeepEqual(api.requests.at(-1).input.slice(0, inputBeforeCompaction.length), inputBeforeCompaction);
	}
});

test("normal Pi router preserves protected resources and binding when rollout is disabled on restart", { timeout: 60000 }, async t => {
	const root = await mkdtemp(join(tmpdir(), "pibo-prefix-router-"));
	const previousHome = process.env.PIBO_HOME;
	process.env.PIBO_HOME = join(root, "pibo-home");
	const sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
	const reliability = new PiboReliabilityStore(join(root, "reliability.sqlite"));
	let router;
	let nativePath;
	t.after(async () => {
		await router?.disposeAll(); reliability.close(); sessions.close();
		if (nativePath) await rm(nativePath, { force: true });
		if (previousHome === undefined) delete process.env.PIBO_HOME; else process.env.PIBO_HOME = previousHome;
		await rm(root, { recursive: true, force: true });
	});
	const api = await fakeProvider(t);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (input, init) => {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		if (url.origin !== new URL(api.baseUrl).origin) throw new Error("Fixture blocked non-loopback provider access");
		return originalFetch(input, init);
	};
	t.after(() => { globalThis.fetch = originalFetch; });
	const contextPath = join(root, "selected-context.md");
	await writeFile(contextPath, "Original router context");
	await savePiboCustomBasePrompt("Original router base", root);
	const credentials = new InMemoryCredentialStore();
	const claim = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-only" } })).toString("base64url");
	await credentials.modify("openai-codex", async () => ({ type: "oauth", access: `test.${claim}.test`, refresh: "test-only", expires: Date.now() + 3600000 }));
	const modelRuntime = await ModelRuntime.create({ credentials, allowModelNetwork: false });
	modelRuntime.registerProvider("openai-codex", { api: "openai-codex-responses", baseUrl: api.baseUrl,
		streamSimple: (model, context, options) => streamNativeCodex({ ...model, baseUrl: api.baseUrl }, context, { ...options, transport: "sse" }),
		models: [{ id: "gpt-5.5", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 500000, maxTokens: 1024 }] });
	const profileName = "prefix-router-fixture";
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({ id: "prefix.router.fixture", register(registration) {
		registration.registerProfile({ name: profileName, create: () => new InitialSessionContextBuilder(profileName)
			.withBuiltinTools("disabled").withAutoContextFiles(false).withToolPackages({ goalControl: false })
			.withModel({ provider: "openai-codex", id: "gpt-5.5" }).addContextFile({ path: contextPath }).createSession() });
	} })] });
	const session = sessions.create({ channel: "test", kind: "chat", profile: profileName, workspace: root });
	const open = enabled => new PiboSessionRouter({ cwd: root, sessionStore: sessions, reliabilityStore: reliability, pluginRegistry: registry,
		persistSession: true, sessionPrefixProtection: enabled, modelRuntime, thinkingLevel: "high", modelDefaults: {},
		extensionFactories: [pi => { pi.registerTool({ name: "prefix_probe", label: "Probe", description: "Fixture", parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "persistent tool result" }], details: {} }) }); }],
	});
	const usage = [];
	router = open(true);
	router.subscribe(event => { if (event.type === "assistant_usage") usage.push(event); });
	await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id, id: "first", source: "user", text: "first routed input" }, 20000);
	assert.equal(api.requests.length, 2);
	const beforeBinding = sessions.get(session.id).runtimeBinding;
	assert.ok(beforeBinding.metadata.piboSessionPrefix);
	assert.ok(beforeBinding.metadata.piboSessionPrefixResources);
	const competitor = open(false);
	try {
		await assert.rejects(competitor.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id,
			id: "concurrent-resume", source: "user", text: "must not race the active native runtime" }, 20000), /ownership|already held/);
		assert.equal(api.requests.length, 2);
	} finally { await competitor.disposeAll(); }
	nativePath = beforeBinding.locator.value;
	const nativeBefore = await readFile(nativePath, "utf8");
	await router.disposeAll(); router = undefined;
	await rm(contextPath);
	await savePiboCustomBasePrompt("Changed router base", root);
	router = open(false);
	router.subscribe(event => { if (event.type === "assistant_usage") usage.push(event); });
	await router.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id, id: "second", source: "user", text: "second routed input" }, 20000);
	assert.equal(api.requests.length, 3);
	const [, before, after] = api.requests;
	assert.equal(after.instructions, before.instructions);
	assert.deepEqual(after.tools, before.tools);
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	assert.deepEqual(after.input.slice(0, before.input.length), before.input);
	assert.equal(sessions.get(session.id).runtimeBinding.metadata.piboSessionPrefix.capsule.digest, beforeBinding.metadata.piboSessionPrefix.capsule.digest);
	assert.ok((await readFile(nativePath, "utf8")).startsWith(nativeBefore));
	assert.equal(usage.length, 3);
	assert.equal(usage[0].cacheEvidence.runtimeGeneration, usage[1].cacheEvidence.runtimeGeneration);
	assert.notEqual(usage[1].cacheEvidence.runtimeGeneration, usage[2].cacheEvidence.runtimeGeneration);
	assert.equal(usage[1].cacheEvidence.cacheKeyDigest, usage[2].cacheEvidence.cacheKeyDigest);
	assert.equal(usage[1].cacheEvidence.prefixDigest, beforeBinding.metadata.piboSessionPrefix.capsule.digest);
	assert.equal(usage[2].cacheEvidence.historyContinuity, "unknown");
	assert.ok(Buffer.byteLength(JSON.stringify(usage[2].cacheEvidence)) <= 2048);
	assert.ok(!JSON.stringify(usage.map(event => event.cacheEvidence)).includes("Original router"));
	await router.disposeAll(); router = undefined;
	await rm(nativePath);
	router = open(false);
	await assert.rejects(router.emitMessageAndWaitForReply({ type: "message", piboSessionId: session.id, id: "missing", source: "user", text: "must not dispatch" }, 20000), /missing|not found|recovery/i);
	assert.equal(api.requests.length, 3);
});
