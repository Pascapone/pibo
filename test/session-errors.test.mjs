import assert from "node:assert/strict";
import test from "node:test";
import {
	classifySessionErrorMessage,
	normalizeSessionErrorDetails,
} from "../dist/core/session-errors.js";

for (const message of [
	"fetch failed",
	"TypeError: fetch failed",
	"network error",
	"connection refused",
	"socket hang up",
]) {
	test(`classifies ${JSON.stringify(message)} as a retryable provider transport error`, () => {
		assert.deepEqual(classifySessionErrorMessage(message, { hasProviderContext: true }), {
			category: "provider_transport",
			errorClass: "provider_transport",
			code: "network_error",
			origin: "provider",
			retryable: true,
			userMessage: "The provider network connection failed.",
		});
	});
}

test("classifies known-invalid function output history as non-retryable transcript integrity", () => {
	assert.deepEqual(classifySessionErrorMessage("No tool call found for function call output with call_id call_1", { hasProviderContext: true }), {
		category: "transcript_integrity",
		errorClass: "transcript_integrity",
		code: "invalid_tool_transcript",
		origin: "runtime",
		retryable: false,
		userMessage: "The persisted tool transcript was invalid and could not be repaired automatically.",
	});
});

test("normalizes fetch failures with provider context for downstream telemetry", () => {
	const details = normalizeSessionErrorDetails("fetch failed", {
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.6-sol",
	});

	assert.equal(details.category, "provider_transport");
	assert.equal(details.errorClass, "provider_transport");
	assert.equal(details.code, "network_error");
	assert.equal(details.origin, "provider");
	assert.equal(details.retryable, true);
});
