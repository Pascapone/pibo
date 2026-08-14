import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboRuntime } from "../dist/core/runtime.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { createWebSearchProviderExtension } from "../dist/tools/web-search.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";

const CODEX_AUTH_CLAIM = "https://api.openai.com/auth";

function fakeCodexToken() {
	const payload = Buffer.from(JSON.stringify({ [CODEX_AUTH_CLAIM]: { chatgpt_account_id: "acct_http_test" } })).toString("base64url");
	return `header.${payload}.sig`;
}

function readRequestBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			const encoded = Buffer.concat(chunks);
			const body = req.headers["content-encoding"] === "gzip"
				? gunzipSync(encoded)
				: req.headers["content-encoding"] === "deflate"
					? inflateSync(encoded)
					: req.headers["content-encoding"] === "br"
						? brotliDecompressSync(encoded)
						: req.headers["content-encoding"] === "zstd"
							? zstdDecompressSync(encoded)
							: encoded;
			resolve(body.toString("utf8"));
		});
		req.on("error", reject);
	});
}

async function startFakeCodexHttpApi({ includeWebSearch = false } = {}) {
	const requests = [];
	const server = createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== "/codex/responses") {
			res.writeHead(404).end("not found");
			return;
		}

		const rawBody = await readRequestBody(req);
		requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(rawBody) });

		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			connection: "close",
		});
		res.end([
			...(includeWebSearch ? [
				`data: ${JSON.stringify({
					type: "response.output_item.added",
					item: { type: "web_search_call", id: "ws_http", status: "in_progress" },
				})}`,
				"",
				`data: ${JSON.stringify({ type: "response.web_search_call.searching", item_id: "ws_http" })}`,
				"",
				`data: ${JSON.stringify({ type: "response.web_search_call.completed", item_id: "ws_http" })}`,
				"",
				`data: ${JSON.stringify({
					type: "response.output_item.done",
					item: {
						type: "web_search_call",
						id: "ws_http",
						status: "completed",
						action: {
							type: "search",
							query: "OpenAI API documentation",
							sources: [
								{ title: "API docs", url: "https://platform.openai.com/docs" },
								{ title: "OpenAI developers", url: "https://developers.openai.com/" },
							],
						},
					},
				})}`,
				"",
			] : []),
			`data: ${JSON.stringify({
				type: "response.output_item.added",
				item: { type: "message", id: "msg_http_fast", role: "assistant", content: [], status: "in_progress" },
			})}`,
			"",
			`data: ${JSON.stringify({
				type: "response.content_part.added",
				part: { type: "output_text", text: "", annotations: [] },
			})}`,
			"",
			`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "ok" })}`,
			"",
			`data: ${JSON.stringify({
				type: "response.output_item.done",
				item: {
					type: "message",
					id: "msg_http_fast",
					role: "assistant",
					content: [{ type: "output_text", text: "ok", annotations: [] }],
					status: "completed",
				},
			})}`,
			"",
			`data: ${JSON.stringify({
				type: "response.completed",
				response: {
					id: "resp_http_fast",
					status: "completed",
					service_tier: "default",
					usage: {
						input_tokens: 1,
						output_tokens: 1,
						total_tokens: 2,
						input_tokens_details: { cached_tokens: 0 },
					},
				},
			})}`,
			"",
			"",
		].join("\n"));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	return { server, requests, baseUrl: `http://127.0.0.1:${address.port}` };
}

function waitForEvent(events, predicate, timeoutMs = 5000) {
	const existing = events.find(predicate);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const timer = setInterval(() => {
			const event = events.find(predicate);
			if (event) {
				clearInterval(timer);
				resolve(event);
				return;
			}
			if (Date.now() - started > timeoutMs) {
				clearInterval(timer);
				reject(new Error(`Timed out waiting for event. Events: ${JSON.stringify(events)}`));
			}
		}, 25);
	});
}

async function closeServer(server) {
	await new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

test("fast mode sends priority service tier through the HTTP provider request", async () => {
	const fakeApi = await startFakeCodexHttpApi();
	const cwd = await mkdtemp(join(tmpdir(), "pibo-fast-http-api-"));
	const events = [];
	const capturedProviderPayloads = [];
	let runtime;
	let routed;

	try {
		const profile = new InitialSessionContextBuilder("fast-http-api-test")
			.withBuiltinTools("disabled")
			.withAutoContextFiles(false)
			.createSession();
		runtime = await createPiboRuntime({
			cwd,
			persistSession: false,
			profile,
			modelDefaults: {},
			extensionFactories: [
				(pi) => {
					pi.on("before_provider_request", (event) => {
						capturedProviderPayloads.push(event.payload);
					});
				},
			],
		});

		// Avoid real credentials while preserving the normal AgentSession -> Agent -> pi-ai provider path.
		runtime.session._modelRegistry.hasConfiguredAuth = () => true;
		runtime.session._modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: fakeCodexToken() });
		runtime.session.agent.transport = "sse";
		runtime.session.state.model = {
			api: "openai-codex-responses",
			provider: "openai-codex",
			id: "gpt-5.5",
			name: "GPT-5.5 HTTP fast test",
			baseUrl: fakeApi.baseUrl,
			reasoning: true,
			input: ["text"],
			cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
			contextWindow: 272000,
			maxTokens: 128000,
		};
		runtime.session.setThinkingLevel("high");

		const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
		routed = new RoutedSession("route:http-fast", runtime, (event) => events.push(event), registry, false, undefined, false);

		const action = await routed.executeAction({
			type: "execution",
			piboSessionId: "route:http-fast",
			action: "fast_mode",
		});
		assert.equal(action.type, "execution_result");
		assert.deepEqual(action.result, { mode: "fast", supported: true, changed: true });

		const messageId = "msg-http-fast-test";
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "route:http-fast",
			id: messageId,
			text: "HTTP fast-mode probe",
			source: "user",
		});
		await waitForEvent(events, (event) => event.type === "message_finished" && event.eventId === messageId);

		assert.equal(fakeApi.requests.length, 1);
		const [request] = fakeApi.requests;
		assert.equal(request.method, "POST");
		assert.equal(request.url, "/codex/responses");
		assert.equal(request.headers["chatgpt-account-id"], "acct_http_test");
		assert.equal(request.body.model, "gpt-5.5");
		assert.equal(request.body.reasoning.effort, "high");
		assert.equal(request.body.service_tier, "priority");
		assert.equal(capturedProviderPayloads.length, 1);
		assert.equal(capturedProviderPayloads[0].service_tier, "priority");
	} finally {
		if (routed) await routed.dispose();
		else if (runtime) await runtime.dispose();
		await rm(cwd, { recursive: true, force: true });
		await closeServer(fakeApi.server);
	}
});

test("provider web search SSE events surface through RoutedSession even when Pi drops them", async () => {
	const fakeApi = await startFakeCodexHttpApi({ includeWebSearch: true });
	const cwd = await mkdtemp(join(tmpdir(), "pibo-web-search-http-api-"));
	const events = [];
	let runtime;
	let routed;

	try {
		const profile = new InitialSessionContextBuilder("web-search-http-api-test")
			.withBuiltinTools("disabled")
			.withAutoContextFiles(false)
			.createSession();
		runtime = await createPiboRuntime({
			cwd,
			persistSession: false,
			profile,
			modelDefaults: {},
			extensionFactories: [createWebSearchProviderExtension({
				kind: "web_search",
				provider: "openai",
				options: { includeSources: true },
			})],
		});

		runtime.session._modelRegistry.hasConfiguredAuth = () => true;
		runtime.session._modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: fakeCodexToken() });
		runtime.session.agent.transport = "sse";
		runtime.session.state.model = {
			api: "openai-codex-responses",
			provider: "openai-codex",
			id: "gpt-5.5",
			name: "GPT-5.5 web search test",
			baseUrl: fakeApi.baseUrl,
			reasoning: true,
			input: ["text"],
			cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
			contextWindow: 272000,
			maxTokens: 128000,
		};

		const registry = PiboPluginRegistry.create({ plugins: [piboCorePlugin] });
		routed = new RoutedSession("route:http-web-search", runtime, (event) => events.push(event), registry, false, undefined, false);

		const messageId = "msg-http-web-search-test";
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "route:http-web-search",
			id: messageId,
			text: "Search the web",
			source: "user",
		});
		await waitForEvent(events, (event) => event.type === "message_finished" && event.eventId === messageId);

		const starts = events.filter((event) => event.type === "tool_execution_started" && event.toolName === "web_search");
		const finishes = events.filter((event) => event.type === "tool_execution_finished" && event.toolName === "web_search");
		assert.equal(starts.length, 1, "provider progress events should collapse to one visible start");
		assert.equal(finishes.length, 1, "provider completion events should collapse to one visible finish");
		assert.equal(starts[0].eventId, messageId);
		assert.deepEqual(finishes[0].result, {
			actionType: "search",
			query: "OpenAI API documentation",
			sources: [
				{ title: "API docs", url: "https://platform.openai.com/docs" },
				{ title: "OpenAI developers", url: "https://developers.openai.com/" },
			],
			sourceCount: 2,
		});

		assert.equal(fakeApi.requests.length, 1);
		assert.ok(fakeApi.requests[0].body.tools.some((tool) => tool.type === "web_search"));
		assert.ok(fakeApi.requests[0].body.include.includes("web_search_call.action.sources"));
	} finally {
		if (routed) await routed.dispose();
		else if (runtime) await runtime.dispose();
		await rm(cwd, { recursive: true, force: true });
		await closeServer(fakeApi.server);
	}
});
