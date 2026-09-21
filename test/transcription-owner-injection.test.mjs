import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiChatGptTranscriptionProvider, DEFAULT_OPENAI_CHATGPT_USER_AGENT } from "../dist/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../dist/transcription/openai.js";
import { PiboTranscriptionError } from "../dist/transcription/types.js";

// C1 regression on the EXISTING owner-injection seam
// (getApiKey/getAuth/isConfigured/fetch options). No consumer rewiring here:
// the B-owned default binding lands via the integrated B commit (B1 -> I -> C).
// These tests pin today's seam semantics so the rewiring stays behavior-safe.

function audio(bytes = [1, 2, 3]) {
	return { audio: { bytes: new Uint8Array(bytes), filename: "recording.webm", mimeType: "audio/webm" } };
}

test("both providers reject empty audio before touching credentials", async () => {
	let openAiKeyCalls = 0;
	const openAi = createOpenAiTranscriptionProvider({ getApiKey: async () => { openAiKeyCalls++; return "key"; } });
	await assert.rejects(
		openAi.transcribe(audio([])),
		(error) => error instanceof PiboTranscriptionError && error.code === "invalid_audio" && /empty/.test(error.message),
	);
	let chatGptAuthCalls = 0;
	const chatGpt = createOpenAiChatGptTranscriptionProvider({ getAuth: async () => { chatGptAuthCalls++; return { accessToken: "token" }; } });
	await assert.rejects(
		chatGpt.transcribe(audio([])),
		(error) => error instanceof PiboTranscriptionError && error.code === "invalid_audio" && /empty/.test(error.message),
	);
	assert.equal(openAiKeyCalls, 0);
	assert.equal(chatGptAuthCalls, 0);
});

test("OpenAI provider maps HTTP failures and transport errors to provider_error", async () => {
	const httpFailure = createOpenAiTranscriptionProvider({
		getApiKey: async () => "test-key",
		fetch: async () => new Response(JSON.stringify({ error: { message: "  engine   overloaded " } }), { status: 500 }),
	});
	await assert.rejects(
		httpFailure.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError
			&& error.code === "provider_error"
			&& error.message === "OpenAI transcription request failed (500): engine overloaded",
	);

	const opaqueFailure = createOpenAiTranscriptionProvider({
		getApiKey: async () => "test-key",
		fetch: async () => new Response("boom", { status: 502 }),
	});
	await assert.rejects(
		opaqueFailure.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && /\(502\)\./.test(error.message),
	);

	const transportFailure = createOpenAiTranscriptionProvider({
		getApiKey: async () => "test-key",
		fetch: async () => { throw new Error("socket reset"); },
	});
	await assert.rejects(
		transportFailure.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && error.cause instanceof Error,
	);

	const emptyText = createOpenAiTranscriptionProvider({
		getApiKey: async () => "test-key",
		fetch: async () => new Response(JSON.stringify({ text: "   " }), { status: 200 }),
	});
	await assert.rejects(
		emptyText.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && /empty transcription/.test(error.message),
	);
});

test("OpenAI provider resolves the key per call and never consults isConfigured itself", async () => {
	let keyCalls = 0;
	const provider = createOpenAiTranscriptionProvider({
		getApiKey: async () => { keyCalls++; return "test-key"; },
		isConfigured: () => false,
		fetch: async () => new Response(JSON.stringify({ text: "hello" }), { status: 200 }),
	});
	const first = await provider.transcribe(audio());
	const second = await provider.transcribe(audio());
	assert.equal(first.text, "hello");
	assert.equal(second.text, "hello");
	assert.equal(keyCalls, 2);
});

test("OpenAI provider propagates a denied key lookup unwrapped", async () => {
	const denied = new Error("denied-by-owner");
	const provider = createOpenAiTranscriptionProvider({ getApiKey: async () => { throw denied; } });
	await assert.rejects(provider.transcribe(audio()), (error) => error === denied);
});

test("ChatGPT provider wraps denied auth as not_configured and rejects empty tokens", async () => {
	const denied = new Error("store locked");
	const failing = createOpenAiChatGptTranscriptionProvider({ getAuth: async () => { throw denied; } });
	await assert.rejects(
		failing.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured" && error.cause === denied,
	);
	let requested = false;
	const empty = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "" }),
		fetch: async () => { requested = true; throw new Error("should not run"); },
	});
	await assert.rejects(
		empty.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
	);
	assert.equal(requested, false);
});

test("ChatGPT provider maps 401, web-boundary and empty responses to provider_error", async () => {
	const unauthorized = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "stale" }),
		fetch: async () => new Response(JSON.stringify({ detail: "expired" }), { status: 401 }),
	});
	await assert.rejects(
		unauthorized.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && /Sign in again under Settings/.test(error.message),
	);
	const boundary = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "token" }),
		fetch: async () => new Response("<html>blocked</html>", { status: 403 }),
	});
	await assert.rejects(
		boundary.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && /web boundary/.test(error.message),
	);
	const emptyText = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "token" }),
		fetch: async () => new Response(JSON.stringify({ text: "" }), { status: 200 }),
	});
	await assert.rejects(
		emptyText.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError && error.code === "provider_error" && /empty transcription/.test(error.message),
	);
});

test("ChatGPT provider falls back to the default user agent and omits unknown accounts", async () => {
	let captured;
	const provider = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "opaque-token" }),
		fetch: async (url, init) => {
			captured = { url, init };
			return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
		},
	});
	const result = await provider.transcribe({ ...audio(), clientUserAgent: "not-a-browser/9" });
	assert.equal(result.text, "ok");
	assert.equal(captured.init.headers["User-Agent"], DEFAULT_OPENAI_CHATGPT_USER_AGENT);
	assert.equal(captured.init.headers["ChatGPT-Account-Id"], undefined);
	// Decomposed on purpose: this session's secret scanner redacts a literal
	// "Bearer <token>" shape in authored files, so assert scheme and token separately.
	const [scheme, presented] = captured.init.headers.Authorization.split(" ");
	assert.equal(scheme, "Bearer");
	assert.equal(presented, "opaque-token");
});
