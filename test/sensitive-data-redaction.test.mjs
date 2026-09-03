import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, redactSensitiveValue } from "../dist/core/sensitive-data-redaction.js";

const ordinaryPiboText = "pibo-v2-github-flow pibo-docker-system pibo-docker-dev pibo-debug-auth /tmp/pibo-stream-render-determinism-v2";

test("sensitive text redaction preserves ordinary Pibo identifiers and paths", () => {
	assert.equal(redactSensitiveText(ordinaryPiboText), ordinaryPiboText);
	assert.equal(redactSensitiveText("pk-live-public-identifier-123456789"), "pk-live-public-identifier-123456789");
});

test("sensitive text and structured value redaction retain narrow credential coverage", () => {
	const text = [
		"Bearer bearer-fixture-value",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"ghp_abcdefghijklmnopqrstuvwxyz1234567890",
		"xoxb-123456789012345678901234",
		"OPENAI_API_KEY=assigned-fixture-value",
	].join(" ");
	const redacted = redactSensitiveText(text);
	assert.doesNotMatch(redacted, /bearer-fixture-value|abcdefghijklmnopqrstuvwxyz123456|123456789012345678901234|assigned-fixture-value/);
	assert.match(redacted, /Bearer \[redacted\]/);
	assert.equal(redactSensitiveValue({ name: "pibo-docker-system", apiKey: "structured-fixture-value" }).name, "pibo-docker-system");
	assert.equal(redactSensitiveValue({ apiKey: "structured-fixture-value" }).apiKey, "[redacted]");
});
