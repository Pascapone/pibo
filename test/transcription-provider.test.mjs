import assert from "node:assert/strict";
import test from "node:test";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { createOpenAiChatGptTranscriptionProvider } from "../dist/transcription/openai-chatgpt.js";
import { createOpenAiTranscriptionProvider } from "../dist/transcription/openai.js";
import { PiboTranscriptionError } from "../dist/transcription/types.js";

test("plugins register discoverable and replaceable transcription providers", async () => {
	const provider = {
		id: "test-transcriber",
		name: "Test Transcriber",
		description: "Fixture provider",
		isConfigured: () => true,
		async transcribe(input) {
			return { text: `bytes:${input.audio.bytes.byteLength}`, model: "fixture-model" };
		},
	};
	const plugin = definePiboPlugin({
		id: "test.transcription",
		name: "Test Transcription Plugin",
		register(api) {
			api.registerTranscriptionProvider(provider);
		},
	});
	const registry = PiboPluginRegistry.create({ plugins: [plugin] });

	assert.deepEqual(await registry.getTranscriptionProviderInfos(), [{
		id: "test-transcriber",
		name: "Test Transcriber",
		description: "Fixture provider",
		configured: true,
		pluginId: "test.transcription",
		pluginName: "Test Transcription Plugin",
	}]);
	assert.deepEqual(await registry.transcribe("test-transcriber", {
		audio: { bytes: new Uint8Array([1, 2, 3]), filename: "audio.webm", mimeType: "audio/webm" },
	}), {
		providerId: "test-transcriber",
		text: "bytes:3",
		model: "fixture-model",
	});

	assert.throws(() => PiboPluginRegistry.create({ plugins: [plugin, definePiboPlugin({
		id: "test.transcription.duplicate",
		register(api) { api.registerTranscriptionProvider(provider); },
	})] }), /Duplicate transcription provider/);
});

test("ChatGPT subscription transcription provider follows the Codex OAuth backend path", async () => {
	let captured;
	const provider = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => ({ accessToken: "subscription-token", accountId: "acct-test" }),
		isConfigured: () => true,
		fetch: async (url, init) => {
			captured = { url, init };
			return new Response(JSON.stringify({ text: "  subscription transcript  " }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});
	const result = await provider.transcribe({
		audio: { bytes: new Uint8Array([9, 8, 7]), filename: "recording.webm", mimeType: "audio/webm" },
		clientUserAgent: "Mozilla/5.0 FixtureBrowser/1.0",
	});

	assert.equal(provider.id, "openai-chatgpt");
	assert.equal(result.text, "subscription transcript");
	assert.equal(result.model, undefined);
	assert.equal(captured.url, "https://chatgpt.com/backend-api/transcribe");
	assert.equal(captured.init.method, "POST");
	assert.equal(captured.init.headers.Authorization, "Bearer subscription-token");
	assert.equal(captured.init.headers["ChatGPT-Account-Id"], "acct-test");
	assert.equal(captured.init.headers.Origin, "https://chatgpt.com");
	assert.equal(captured.init.headers.Referer, "https://chatgpt.com/");
	assert.equal(captured.init.headers["User-Agent"], "Mozilla/5.0 FixtureBrowser/1.0");
	assert.ok(captured.init.body instanceof FormData);
	assert.equal(captured.init.body.get("model"), null);
	const file = captured.init.body.get("file");
	assert.equal(file.name, "recording.webm");
	assert.equal(file.type, "audio/webm");
	assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([9, 8, 7]));
});

test("ChatGPT subscription transcription provider requires Codex OAuth", async () => {
	let requested = false;
	const provider = createOpenAiChatGptTranscriptionProvider({
		getAuth: async () => undefined,
		fetch: async () => {
			requested = true;
			throw new Error("should not run");
		},
	});
	await assert.rejects(
		provider.transcribe({ audio: { bytes: new Uint8Array([1]), filename: "audio.webm", mimeType: "audio/webm" } }),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured" && /ChatGPT Subscription/.test(error.message),
	);
	assert.equal(requested, false);
});

test("OpenAI API transcription provider sends official multipart transcription requests", async () => {
	let captured;
	const provider = createOpenAiTranscriptionProvider({
		getApiKey: async () => "test-key",
		isConfigured: () => true,
		fetch: async (url, init) => {
			captured = { url, init };
			return new Response(JSON.stringify({ text: "  transcribed text  " }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});
	const result = await provider.transcribe({
		audio: { bytes: new Uint8Array([1, 2, 3]), filename: "recording.webm", mimeType: "audio/webm" },
	});

	assert.equal(provider.id, "openai-api");
	assert.equal(result.text, "transcribed text");
	assert.equal(result.model, "gpt-4o-mini-transcribe");
	assert.equal(captured.url, "https://api.openai.com/v1/audio/transcriptions");
	assert.equal(captured.init.method, "POST");
	assert.equal(captured.init.headers.Authorization, "Bearer test-key");
	assert.ok(captured.init.body instanceof FormData);
	assert.equal(captured.init.body.get("model"), "gpt-4o-mini-transcribe");
	const file = captured.init.body.get("file");
	assert.equal(file.name, "recording.webm");
	assert.equal(file.type, "audio/webm");
	assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("OpenAI API transcription provider reports missing API authentication without sending audio", async () => {
	let requested = false;
	const provider = createOpenAiTranscriptionProvider({
		getApiKey: async () => undefined,
		fetch: async () => {
			requested = true;
			throw new Error("should not run");
		},
	});
	await assert.rejects(
		provider.transcribe({ audio: { bytes: new Uint8Array([1]), filename: "audio.webm", mimeType: "audio/webm" } }),
		(error) => error instanceof PiboTranscriptionError && error.code === "not_configured",
	);
	assert.equal(requested, false);
});
