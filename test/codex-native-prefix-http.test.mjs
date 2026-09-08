import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { test } from "node:test";
import { CodexAppServerClient } from "../dist/agent-runtimes/codex-native/client.js";
import { CodexNativeThreadController } from "../dist/agent-runtimes/codex-native/thread.js";

// Explicit native-binary gate: RPC fixtures cannot prove the hidden native
// request builder. CI/acceptance must provision and run this exact version.
const binary = process.env.PIBO_CODEX_PREFIX_BINARY;
const cases = ["unchanged", "changed-developer", "changed-project", "changed-tools", "restored-selection", "changed-catalog", "thread-catalog-override-is-incomplete", "restored-catalog"];
for (const scenario of cases) test(`Codex 0.153.2 actual HTTP resume boundary: ${scenario}`, { skip: !binary, timeout: 60000 }, async t => {
	assert.equal(execFileSync(binary, ["--version"], { encoding: "utf8" }).trim(), "codex-cli 0.153.2");
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-prefix-http-"));
	const home = join(root, "codex-home"); await mkdir(home);
	let client;
	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = []; for await (const chunk of req) chunks.push(chunk);
		if (req.method !== "POST") { res.writeHead(404); res.end("{}"); return; }
		const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (value => value);
		requests.push(JSON.parse(decompress(Buffer.concat(chunks)).toString()));
		const id = `response-${requests.length}`;
		const events = [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.done", item: { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok" }] } },
			{ type: "response.completed", response: { id, usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101, input_tokens_details: { cached_tokens: 0 } } } },
		];
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => { await client?.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
	const configFile = join(home, "config.toml");
	const catalogScenario = scenario.endsWith("-catalog") || scenario === "thread-catalog-override-is-incomplete";
	const changedCatalog = scenario === "changed-catalog" || scenario === "thread-catalog-override-is-incomplete";
	const catalogFile = join(home, "model-catalog.json");
	const frozenCatalogFile = join(home, "original-model-catalog.json");
	let catalog;
	if (catalogScenario) {
		// Model metadata shape from official rust-v0.153.2 commit
		// 657a993cbee87acf52d14b758ce49dbd46d1b8eb; prompt text is synthetic.
		catalog = JSON.parse(await readFile(new URL("./fixtures/codex-prefix-model-catalog.json", import.meta.url), "utf8"));
		await writeFile(catalogFile, JSON.stringify(catalog));
		await writeFile(frozenCatalogFile, JSON.stringify(catalog));
	}
	await writeFile(configFile, `model = "gpt-5.5"
model_provider = "fixture"
${catalogScenario ? `model_catalog_json = ${JSON.stringify(catalogFile)}` : ""}
approval_policy = "never"
sandbox_mode = "danger-full-access"
web_search = "disabled"
[model_providers.fixture]
name = "Fixture"
base_url = "http://127.0.0.1:${server.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
[features]
shell_snapshot = false
[analytics]
enabled = false
`);
	const open = () => CodexAppServerClient.start({ command: binary, args: [...(scenario === "restored-catalog" ? ["-c", `model_catalog_json=${JSON.stringify(frozenCatalogFile)}`] : []), "app-server", "--stdio"], cwd: root, env: { PATH: process.env.PATH, CODEX_HOME: home }, clientInfo: { name: "pibo_prefix_conformance", version: "1.0.0" }, capabilities: { experimentalApi: true }, requestTimeoutMs: 20000 });
	const turn = async (threadId, text) => {
		let timer;
		let listener;
		const completed = new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("native fixture turn timeout")), 25000);
			listener = event => { if (event.method === "turn/completed" && event.params.threadId === threadId) resolve(event.params.turn); };
		});
		// Ensure a request failure cannot leave a later unhandled timeout rejection.
		void completed.catch(() => {});
		const unsubscribe = client.subscribeNotifications(listener);
		try {
			await client.request("turn/start", { threadId, input: [{ type: "text", text }] });
			const result = await completed;
			assert.equal(result.status, "completed");
		} finally { clearTimeout(timer); unsubscribe(); }
	};
	const originalSelection = { model: "gpt-5.5", approvalPolicy: "never", sandbox: "danger-full-access", developerInstructions: "Original developer context", ...(scenario === "restored-selection" ? { config: { web_search: "disabled" } } : scenario === "thread-catalog-override-is-incomplete" ? { config: { model_catalog_json: frozenCatalogFile } } : {}) };
	client = await open();
	const first = await CodexNativeThreadController.start(client, root, originalSelection);
	await turn(first.thread.id, "historic ".repeat(20000));
	await client.close();
	if (catalogScenario) {
		catalog.models[0].use_responses_lite = true;
		await writeFile(catalogFile, JSON.stringify(catalog));
	}
	if (scenario === "changed-project") await writeFile(join(root, "AGENTS.md"), "Changed repository instructions");
	if (["changed-tools", "restored-selection"].includes(scenario)) await writeFile(configFile, (await readFile(configFile, "utf8")).replace('web_search = "disabled"', 'web_search = "cached"'));
	client = await open();
	const selection = scenario === "changed-developer" ? { ...originalSelection, developerInstructions: "Changed developer context" } : originalSelection;
	const resumed = await CodexNativeThreadController.resume(client, first.thread.id, root, selection);
	await turn(resumed.thread.id, "new message");
	assert.equal(requests.length, 2);
	const [before, after] = requests;
	if (changedCatalog) {
		assert.ok(!isDeepStrictEqual(after.input.slice(0, before.input.length), before.input), "catalog changes can prepend new native model-input elements");
		assert.equal(after.instructions ?? "", "");
		assert.ok(before.instructions.length > 0);
		assert.ok(after.input.some(item => item.type === "additional_tools"));
	} else {
		assert.ok(isDeepStrictEqual(after.input.slice(0, before.input.length), before.input), "native old history remains an exact prefix in this fixture");
		assert.equal(after.instructions, before.instructions);
	}
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	// client_metadata contains turn IDs/timestamps. It is recorded separately
	// from model input; these tests make no claims about provider internals.
	const staticKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => key !== "input" && key !== "client_metadata");
	const differences = staticKeys.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
	if (changedCatalog) {
		assert.ok(differences.includes("instructions"));
		assert.ok(differences.includes("tools"));
	} else if (scenario === "changed-tools") {
		assert.deepEqual(differences, ["tools"], "live Tool settings change the global envelope despite identical history/key");
		assert.equal(after.tools.length, before.tools.length + 1);
	} else assert.deepEqual(differences, []);
	if (scenario === "changed-project") assert.match(JSON.stringify(after.input.slice(before.input.length)), /Changed repository instructions/);
	if (scenario === "changed-developer") assert.doesNotMatch(JSON.stringify(after.input), /Changed developer context/, "this native resume preserves the original developer input");
});
