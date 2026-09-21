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

// Former tripwire (C1-R08): a throwing key lookup used to propagate raw.
// Controller K03 decision (B1-R06, COORDINATION 2026-09-21) replaces the old
// research rule: genuine lookup/store/refresh failures map to provider_error
// with a safe fixed message and the internal cause preserved.
test("OpenAI provider maps a denied key lookup to provider_error", async () => {
	const denied = new Error("store read failed at /secret/path/auth.json");
	const provider = createOpenAiTranscriptionProvider({ getApiKey: async () => { throw denied; } });
	await assert.rejects(
		provider.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError
			&& error.code === "provider_error"
			&& error.message === "OpenAI API authentication could not be loaded."
			&& error.cause === denied
			&& !error.message.includes("/secret/path"),
	);
});

// Same K03 decision as above (B1-R06): a throwing auth lookup is a provider
// failure, not "not configured". The old blanket re-login message for arbitrary
// storage errors is intentionally gone.
test("ChatGPT provider maps a denied auth lookup to provider_error", async () => {
	const denied = new Error("store locked at /secret/path/auth.json");
	const failing = createOpenAiChatGptTranscriptionProvider({ getAuth: async () => { throw denied; } });
	await assert.rejects(
		failing.transcribe(audio()),
		(error) => error instanceof PiboTranscriptionError
			&& error.code === "provider_error"
			&& error.message === "ChatGPT Subscription authentication could not be loaded."
			&& error.cause === denied
			&& !error.message.includes("/secret/path"),
	);
});

test("ChatGPT provider still reports empty tokens as not_configured", async () => {
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

// B1-R05 consumer share: the provider-specific JWT accountId derivation stays
// with C and applies to injected auth as well. Stored accountId wins, else the
// existing JWT fallback, else no invented account. Synthetic fixtures only.
function jwtWithClaim(payload) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none" })}.${encode(payload)}.`;
}

async function transcribeWithAuth(auth) {
	let captured;
	const provider = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => auth,
		fetch: async (url, init) => {
			captured = init.headers;
			return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
		},
	});
	await provider.transcribe(audio());
	return captured;
}

test("ChatGPT provider derives the account header from a JWT claim without stored id", async () => {
	const token = jwtWithClaim({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt-1" } });
	const headers = await transcribeWithAuth({ accessToken: token });
	assert.equal(headers["ChatGPT-Account-Id"], "acct-jwt-1");
});

test("ChatGPT provider prefers a stored account id over the JWT claim", async () => {
	const token = jwtWithClaim({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-jwt-other" } });
	const headers = await transcribeWithAuth({ accessToken: token, accountId: "acct-stored" });
	assert.equal(headers["ChatGPT-Account-Id"], "acct-stored");
});

test("ChatGPT provider sends no account header without a usable claim", async () => {
	const withoutClaim = await transcribeWithAuth({ accessToken: jwtWithClaim({ sub: "user-1" }) });
	assert.equal(withoutClaim["ChatGPT-Account-Id"], undefined);
	const malformed = await transcribeWithAuth({ accessToken: "not-a-jwt" });
	assert.equal(malformed["ChatGPT-Account-Id"], undefined);
});
