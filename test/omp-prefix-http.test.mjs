import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { OmpThreadController } from "../dist/agent-runtimes/omp/thread.js";
import { OmpRpcClient } from "../dist/agent-runtimes/omp/client.js";
import { createOmpPrefixBootstrapSource } from "../dist/agent-runtimes/omp/prefix-bootstrap.js";
import { createOmpPrefixGuardSource, OMP_PREFIX_CODEC } from "../dist/agent-runtimes/omp/prefix-guard.js";
import { NativePrefixBridge } from "../dist/sessions/native-prefix-bridge.js";
import { NativePrefixStartupGate } from "../dist/sessions/native-prefix-startup.js";
import { SessionPrefixController } from "../dist/sessions/prefix-session.js";
import { PrefixCapsuleStore } from "../dist/sessions/prefix-capsule.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import { createAgentRuntimeBindingPersistence } from "../dist/sessions/runtime-binding-persistence.js";

const bun = process.env.PIBO_OMP_PREFIX_BUN;
const entry = process.env.PIBO_OMP_PREFIX_ENTRY;
for (const scenario of ["unchanged", "native-switch-resume", "changed-context", "system-override-is-incomplete", "restored-provider-envelope", "hook-error-does-not-block", "changed-calendar-date", "durable-guard-date-restore", "durable-guard-storage-failure", "durable-guard-binding-conflict", "durable-guard-stalled-seal", "durable-guard-tool-roundtrip", "durable-guard-compaction", "durable-guard-compaction-recovery", "durable-guard-compaction-kill-before-native"]) test(`OMP 18.1.10 actual HTTP resume boundary: ${scenario}`, { skip: !bun || !entry, timeout: 60000 }, async t => {
	assert.equal(execFileSync(bun, [entry, "--version"], { encoding: "utf8" }).trim(), "omp/18.1.10");
	const root = await mkdtemp(join(tmpdir(), "pibo-omp-prefix-http-"));
	const home = join(root, "agent"); await mkdir(home);
	let client;
	const connectionTokens = [];
	let bridge, sessions, binding, connection, guardPath, piboSession, startup;
	const guarded = scenario.startsWith("durable-guard-");
	const compaction = scenario.startsWith("durable-guard-compaction");
	const compactionRecovery = scenario === "durable-guard-compaction-recovery";
	const killBeforeNative = scenario === "durable-guard-compaction-kill-before-native";
	let injectNativeKill = killBeforeNative;
	let failCompletion = compactionRecovery;
	const toolRoundtrip = scenario === "durable-guard-tool-roundtrip";
	const toolFile = join(root, "probe.txt");
	if (toolRoundtrip) await writeFile(toolFile, "original native tool result");
	const readyFile = join(root, "guard-ready.json");
	let readyNonce = 0;
	const requests = [];
	const server = createServer(async (req, res) => {
		const chunks = []; for await (const chunk of req) chunks.push(chunk);
		if (req.method !== "POST") { res.writeHead(404); res.end("{}"); return; }
		const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync, zstd: zstdDecompressSync }[req.headers["content-encoding"]] ?? (value => value);
		requests.push(JSON.parse(decompress(Buffer.concat(chunks)).toString()));
		const id = `response-${requests.length}`;
		const item = { type: "message", role: "assistant", id: `msg-${requests.length}`, content: [{ type: "output_text", text: "ok", annotations: [] }], status: "completed" };
		let events = [
			{ type: "response.created", response: { id } },
			{ type: "response.output_item.added", output_index: 0, item: { ...item, content: [], status: "in_progress" } },
			{ type: "response.content_part.added", part: { type: "output_text", text: "", annotations: [] } },
			{ type: "response.output_text.delta", delta: "ok" },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101, input_tokens_details: { cached_tokens: 0 } } } },
		];
		if (toolRoundtrip && [1, 3].includes(requests.length)) {
			const tool = { type: "function_call", id: `fc_probe_${requests.length}`, call_id: `call_probe_${requests.length}`, name: "read", arguments: JSON.stringify({ path: toolFile }), status: "completed" };
			events = [
				{ type: "response.created", response: { id } },
				{ type: "response.output_item.added", output_index: 0, item: { ...tool, arguments: "", status: "in_progress" } },
				{ type: "response.function_call_arguments.delta", item_id: tool.id, output_index: 0, delta: tool.arguments },
				{ type: "response.output_item.done", output_index: 0, item: tool },
				{ type: "response.completed", response: { id, status: "completed", output: [tool], usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101, input_tokens_details: { cached_tokens: 0 } } } },
			];
		}
		res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
		res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
	});
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	t.after(async () => { await client?.close(); await bridge?.dispose(); sessions?.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
	const openBridge = async () => {
		binding = sessions.get(piboSession.id).runtimeBinding;
		const store = new PrefixCapsuleStore(join(root, "prefixes"));
		if (scenario === "durable-guard-stalled-seal") store.put = () => new Promise(() => {});
		const controller = new SessionPrefixController({ store, getBinding: () => binding,
			persistence: createAgentRuntimeBindingPersistence(sessions, { piboSessionId: piboSession.id, onPersisted: next => { binding = next; } }) });
		if (injectNativeKill) {
			const begin = controller.beginCompaction.bind(controller);
			controller.beginCompaction = async head => {
				await begin(head); injectNativeKill = false;
				client.process.kill("SIGKILL");
				throw new Error("native process killed after durable preparation");
			};
		}
		if (failCompletion) controller.finishCompaction = async () => { failCompletion = false; throw new Error("injected completion persistence failure"); };
		startup = new NativePrefixStartupGate();
		bridge = new NativePrefixBridge(controller, OMP_PREFIX_CODEC, startup);
		connection = await bridge.start();
		connectionTokens.push(connection.token);
	};
	if (guarded) {
		sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
		piboSession = sessions.create({ channel: "test", kind: "chat", profile: "base", runtimeBinding: { runtimeInstanceId: "orp", adapterId: "orp", state: "unbound" } });
		if (scenario === "durable-guard-storage-failure") await writeFile(join(root, "prefixes"), "broken storage");
		await openBridge();
		guardPath = join(root, "durable-prefix-guard.mjs");
		await writeFile(guardPath, createOmpPrefixGuardSource(pathToFileURL(join(dirname(entry), "session/date-cwd-reminder.ts")).href));
	}
	await writeFile(join(home, "models.yml"), JSON.stringify({ providers: { fixture: {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-responses", auth: "none",
		models: [{ id: "prefix-fixture", name: "Prefix fixture", reasoning: false, input: ["text"], contextWindow: 500000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
	} } }));
	const open = async (nativePath, frozenInstructions, extensionPath) => {
		const current = new OmpRpcClient({ startupTimeoutMs: 20000, requestTimeoutMs: 30000 });
		const nonce = String(++readyNonce);
		let nativeEntry = entry;
		if (guarded) {
			nativeEntry = join(root, `bootstrap-${nonce}.mjs`);
			await writeFile(nativeEntry, createOmpPrefixBootstrapSource({ entryModuleUrl: pathToFileURL(entry).href,
				waitForActivation: true,
				nativeSessionId: nativePath ? binding.nativeSessionId : undefined,
				prefixRoot: join(root, "ownership-root"), identities: [JSON.stringify(["pibo", piboSession.id]),
					...(nativePath ? [JSON.stringify(["native", "orp", binding.nativeSessionId])] : [])] }));
		}
		try {
			const nativeArgs = ["--mode", "rpc", "--model", "fixture/prefix-fixture", ...(toolRoundtrip ? ["--tools=read"] : ["--no-tools"]), "--no-lsp", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--thinking", "off",
				"--append-system-prompt", nativePath && ["changed-context", "system-override-is-incomplete", "restored-provider-envelope", "durable-guard-date-restore", "durable-guard-tool-roundtrip"].includes(scenario) ? "Changed appended context" : "Original appended context",
				...(nativePath ? ["--resume", nativePath] : []),
				...(frozenInstructions === undefined ? [] : ["--system-prompt", frozenInstructions]),
				...(extensionPath ? ["--extension", extensionPath] : []),
				...(guardPath ? ["--extension", guardPath] : []),
			];
			const connecting = current.connect([bun, nativeEntry, ...(guarded ? [] : nativeArgs)], { cwd: root, env: { PATH: process.env.PATH, PI_CODING_AGENT_DIR: home, PI_NO_PTY: "1",
				...(connection ? { PIBO_PREFIX_ENDPOINT: connection.endpoint, PIBO_PREFIX_TOKEN: connection.token,
					PIBO_PREFIX_READY_FILE: readyFile, PIBO_PREFIX_READY_NONCE: nonce } : {}) } });
			void connecting.catch(() => {});
			if (guarded) {
				await Promise.race([startup.waitForOwnership(), connecting.then(() => { throw new Error("Native entry started before ownership acknowledgement"); })]);
				startup.activate(nativeArgs);
			}
			await connecting;
			if (guarded) assert.deepEqual(JSON.parse(await readFile(readyFile, "utf8")), { nonce, codec: OMP_PREFIX_CODEC });
			return current;
		} catch (error) { await current.close(); throw error; }
	};
	const turn = async text => {
		let timer, listener;
		let rejectCompleted;
		let phase = "unknown";
		const child = client.process;
		const onExit = (code, signal) => rejectCompleted(new Error(`OMP child exited: code=${code} signal=${signal} prefix-phase=${phase}`));
		const stopDiagnostics = client.subscribeDiagnostics(message => {
			const match = /Pibo native prefix recovery required: ([a-z-]+)/.exec(message);
			if (match) phase = match[1];
		});
		const completed = new Promise((resolve, reject) => {
			rejectCompleted = reject;
			timer = setTimeout(() => reject(new Error("OMP fixture turn timeout")), 30000);
			listener = frame => { if (frame.type === "agent_end") resolve(frame); };
		});
		void completed.catch(() => {});
		child.once("exit", onExit);
		const unsubscribe = client.subscribeFrames(listener);
		try { await client.request({ type: "prompt", message: text }, "prompt"); return await completed; }
		finally { clearTimeout(timer); unsubscribe(); child.off("exit", onExit); stopDiagnostics(); }
	};
	client = await open();
	if (guarded) {
		const initial = (await client.request({ type: "get_state" }, "get_state")).data;
		binding = sessions.updateRuntimeBinding(piboSession.id, { ...binding, state: "bound", nativeSessionId: initial.sessionId }, { expectedRevision: binding.revision });
		if (["durable-guard-storage-failure", "durable-guard-binding-conflict", "durable-guard-stalled-seal"].includes(scenario)) {
			if (scenario === "durable-guard-binding-conflict") sessions.updateRuntimeBinding(piboSession.id, {
				...binding, metadata: { competingUpdate: true },
			}, { expectedRevision: binding.revision });
			const exited = once(client.process, "exit");
			await client.request({ type: "prompt", message: "must not dispatch" }, "prompt").catch(() => {});
			assert.equal((await exited)[0], 78);
			assert.equal(requests.length, 0);
			assert.equal(sessions.get(piboSession.id).runtimeBinding.metadata.piboSessionPrefix, undefined);
			return;
		}
	}
	const firstTurn = await turn("historic ".repeat(20000));
	if (toolRoundtrip) assert.ok(requests[1]?.input.some(item => item.type === "function_call_output" && JSON.stringify(item.output).includes("original native tool result")), JSON.stringify({ requests: requests.length,
		assistant: firstTurn.messages?.filter(message => message.role === "assistant").map(message => ({ stopReason: message.stopReason, errorMessage: message.errorMessage, contentTypes: message.content?.map(part => part.type) })) }));
	const state = (await client.request({ type: "get_state" }, "get_state")).data;
	if (compaction) {
		await turn("second turn before compaction ".repeat(4000));
		const prefixBefore = sessions.get(piboSession.id).runtimeBinding.metadata.piboSessionPrefix;
		if (compactionRecovery || killBeforeNative) {
			const exited = once(client.process, "exit");
			await assert.rejects(client.request({ type: "compact" }, "compact"));
			const [code, signal] = await exited;
			if (killBeforeNative) assert.equal(signal, "SIGKILL");
			else assert.equal(code, 78);
		} else {
			const compacted = await client.request({ type: "compact" }, "compact");
			assert.equal(compacted.success, true);
		}
		const metadata = sessions.get(piboSession.id).runtimeBinding.metadata;
		assert.equal(metadata.piboSessionPrefixTransition.state, (compactionRecovery || killBeforeNative) ? "pending" : "completed");
		assert.equal(metadata.piboSessionPrefix.epoch, prefixBefore.epoch + Number(!compactionRecovery && !killBeforeNative));
		assert.equal(metadata.piboSessionPrefix.capsule.digest, prefixBefore.capsule.digest);
	}
	assert.ok(state.sessionFile);
	await client.close();
	if (toolRoundtrip) await writeFile(toolFile, "current native tool result");
	if (guarded) {
		assert.ok(sessions.get(piboSession.id).runtimeBinding.metadata.piboSessionPrefix);
		await bridge.dispose(); sessions.close();
		sessions = new SqlitePiboSessionStore(join(root, "sessions.sqlite"));
		await openBridge();
	}
	// --system-prompt is not a full restore API: native project framing and
	// append contributions are still added. The final provider hook can restore
	// this envelope; the parent/native durability handshake is separate work.
	const frozenInstructions = scenario === "system-override-is-incomplete" ? requests[0].instructions : undefined;
	let extensionPath;
	if (scenario === "hook-error-does-not-block") {
		extensionPath = join(root, "failing-prefix-guard.mjs");
		await writeFile(extensionPath, `export default function(pi) { pi.on("before_provider_request", () => { throw new Error("fixture durable prefix write failed"); }); }`);
	}
	if (scenario === "changed-calendar-date" || scenario === "durable-guard-date-restore" || toolRoundtrip) {
		extensionPath = join(root, "changed-calendar-date.mjs");
		// Only calendar getters change. Native timers and credential expiry retain
		// real time; this isolates the SDK's date reminder from elapsed-time effects.
		await writeFile(extensionPath, `export default function() { Date.prototype.getFullYear = () => 2099; Date.prototype.getMonth = () => 0; Date.prototype.getDate = () => 1; }`);
	}
	if (scenario === "restored-provider-envelope") {
		const frozen = Object.fromEntries(Object.entries(requests[0]).filter(([key]) => key !== "input"));
		const capsule = join(root, "provider-envelope.json");
		await writeFile(capsule, JSON.stringify(frozen));
		extensionPath = join(root, "prefix-extension.mjs");
		await writeFile(extensionPath, `import { readFileSync } from "node:fs"; const frozen = JSON.parse(readFileSync(${JSON.stringify(capsule)}, "utf8")); export default function(pi) { pi.on("before_provider_request", event => ({ ...frozen, input: event.payload.input })); }`);
	}
	client = await open(scenario === "native-switch-resume" ? undefined : state.sessionFile, frozenInstructions, extensionPath);
	if (scenario === "native-switch-resume") {
		const threads = new OmpThreadController(client, root, { sessionId: "startup-unverified" });
		await threads.resumeBinding({ nativeSessionId: state.sessionId, metadata: { nativeSessionFile: state.sessionFile } });
		assert.equal(threads.current.sessionId, state.sessionId);
	}
	await turn("new message");
	if (compaction) {
		assert.ok(requests.length >= (killBeforeNative ? 3 : 4));
		const metadata = sessions.get(piboSession.id).runtimeBinding.metadata;
		assert.equal(metadata.piboSessionPrefixTransition.state, killBeforeNative ? "aborted" : "completed");
		assert.equal(metadata.piboSessionPrefix.epoch, killBeforeNative ? 1 : 2, "native completion recovery advances exactly once");
	}
	else assert.equal(requests.length, toolRoundtrip ? 4 : 2);
	const before = requests[toolRoundtrip ? 1 : 0], after = requests.at(-1);
	if (toolRoundtrip) assert.ok(after.input.some(item => item.type === "function_call_output" && JSON.stringify(item.output).includes("current native tool result")));
	if (compaction && !killBeforeNative) assert.notDeepEqual(after.input.slice(0, before.input.length), before.input);
	else if (scenario === "changed-calendar-date") assert.ok(!isDeepStrictEqual(after.input.slice(0, before.input.length), before.input), "native calendar reminder rewrites historical model input");
	else assert.deepEqual(after.input.slice(0, before.input.length), before.input);
	assert.equal(after.prompt_cache_key, before.prompt_cache_key);
	if (guarded) {
		const serializedRequests = JSON.stringify(requests);
		assert.ok(connectionTokens.every(token => !serializedRequests.includes(token)), "private capture credentials must not enter model input");
	}
	if (["changed-context", "system-override-is-incomplete"].includes(scenario)) assert.notEqual(after.instructions, before.instructions);
	else assert.equal(after.instructions, before.instructions);
	assert.deepEqual(after.tools, before.tools);
	if (scenario === "restored-provider-envelope") assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => key !== "input")), Object.fromEntries(Object.entries(before).filter(([key]) => key !== "input")));
});
