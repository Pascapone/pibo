import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { test } from "node:test";
import { OmpRpcClient } from "../dist/agent-runtimes/omp/client.js";

const bun = process.env.PIBO_OMP_PREFIX_BUN;
const entry = process.env.PIBO_OMP_PREFIX_ENTRY;
for (const scenario of ["unchanged", "changed-context", "system-override-is-incomplete", "restored-provider-envelope"]) test(`OMP 18.1.10 actual HTTP resume boundary: ${scenario}`, { skip: !bun || !entry, timeout: 60000 }, async t => {
	assert.equal(execFileSync(bun, [entry, "--version"], { encoding: "utf8" }).trim(), "omp/18.1.10");
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-prefix-http-"));
	const home = join(root, "agent"); await mkdir(home);
	let client;
	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = []; for await (const chunk of req) chunks.push(chunk);
		if (req.method !== "POST") { res.writeHead(404); res.end("{}"); return; }
		const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (value => value);
		requests.push(JSON.parse(decompress(Buffer.concat(chunks)).toString()));
		const id = `response-${requests.length}`;
		const item = { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
		const events = [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
			{ type: "response.output_text.delta", delta: "ok" },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101, input_tokens_details: { cached_tokens: 0 } } } },
		];
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => { await client?.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
	await writeFile(join(home, "models.yml"), JSON.stringify({ providers: { fixture: {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-responses", auth: "none",
		models: [{ id: "prefix-fixture", name: "Prefix fixture", reasoning: false, input: ["text"], contextWindow: 500000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
	} } }));
	const open = async (nativePath, frozenInstructions, extensionPath) => {
		const current = new OmpRpcClient({ startupTimeoutMs: 20000, requestTimeoutMs: 30000 });
		try {
			await current.connect([bun, entry, "--mode", "rpc", "--model", "fixture/prefix-fixture", "--no-tools", "--no-lsp", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--thinking", "off",
				"--append-system-prompt", nativePath && scenario !== "unchanged" ? "Changed appended context" : "Original appended context",
				...(nativePath ? ["--resume", nativePath] : []),
				...(frozenInstructions === undefined ? [] : ["--system-prompt", frozenInstructions]),
				...(extensionPath ? ["--extension", extensionPath] : []),
			], { cwd: root, env: { PATH: process.env.PATH, PI_CODING_AGENT_DIR: home, PI_NO_PTY: "1" } });
			return current;
		} catch (error) { await current.close(); throw error; }
	};
	const turn = async text => {
		let timer, listener;
		const completed = new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("OMP fixture turn timeout")), 30000);
			listener = frame => { if (frame.type === "agent_end") resolve(frame); };
		});
		void completed.catch(() => {});
		const unsubscribe = client.subscribeFrames(listener);
		try { await client.request({ type: "prompt", message: text }, "prompt"); await completed; }
		finally { clearTimeout(timer); unsubscribe(); }
	};
	client = await open();
	await turn("historic ".repeat(20000));
	const state = (await client.request({ type: "get_state" }, "get_state")).data;
	assert.ok(state.sessionFile);
	await client.close();
	// --system-prompt is not a full restore API: native project framing and
	// append contributions are still added. The final provider hook can restore
	// this envelope; the parent/native durability handshake is separate work.
	const frozenInstructions = scenario === "system-override-is-incomplete" ? requests[0].instructions : undefined;
	let extensionPath;
	if (scenario === "restored-provider-envelope") {
		const frozen = Object.fromEntries(Object.entries(requests[0]).filter(([key]) => key !== "input"));
		const capsule = join(root, "provider-envelope.json");
		await writeFile(capsule, JSON.stringify(frozen));
		extensionPath = join(root, "prefix-extension.mjs");
		await writeFile(extensionPath, `import { readFileSync } from "node:fs"; const frozen = JSON.parse(readFileSync(${JSON.stringify(capsule)}, "utf8")); export default function(pi) { pi.on("before_provider_request", event => ({ ...frozen, input: event.payload.input })); }`);
	}
	client = await open(state.sessionFile, frozenInstructions, extensionPath);
	await turn("new message");
	assert.equal(requests.length, 2);
	const [before, after] = requests;
	assert.deepEqual(after.input.slice(0, before.input.length), before.input);
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	if (["changed-context", "system-override-is-incomplete"].includes(scenario)) assert.notEqual(after.instructions, before.instructions);
	else assert.equal(after.instructions, before.instructions);
	assert.deepEqual(after.tools, before.tools);
	if (scenario === "restored-provider-envelope") assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => key !== "input")), Object.fromEntries(Object.entries(before).filter(([key]) => key !== "input")));
});
