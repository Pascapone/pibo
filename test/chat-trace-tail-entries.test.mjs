import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTailEntries } from "../dist/apps/chat/trace.js";

function messageEntry(id, role, content, timestamp) {
	return {
		type: "message",
		id,
		timestamp,
		message: {
			role,
			content: [{ type: "text", text: content }],
		},
	};
}

test("readTailEntries keeps the final assistant transcript without parsing the full file", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-tail-"));
	const path = join(dir, "session.jsonl");
	const finalText = [
		"Hier ist eine kopierbare Agent-Instruction:",
		"## Nicht tun",
		"- Keine unbounded JSON-Objekte.",
		"## Acceptance",
		"- Beide Seiten rendern denselben Transcript-Text.",
	].join("\n");
	const lines = [
		JSON.stringify({ type: "session", id: "pi_test", timestamp: "2026-07-04T00:00:00.000Z", cwd: process.cwd() }),
		JSON.stringify(messageEntry("old-user", "user", "x".repeat(20_000), "2026-07-04T00:00:01.000Z")),
		JSON.stringify(messageEntry("tail-user", "user", "Bitte gib mir die Instruction.", "2026-07-04T00:00:02.000Z")),
		JSON.stringify(messageEntry("tail-assistant", "assistant", finalText, "2026-07-04T00:00:03.000Z")),
	];
	writeFileSync(path, `${lines.join("\n")}\n`, "utf8");

	const entries = readTailEntries(path, 4096);
	assert.equal(entries.some((entry) => entry.id === "old-user"), false);
	const assistant = entries.find((entry) => entry.id === "tail-assistant");
	assert.ok(assistant);
	assert.equal(assistant.message.content[0].text, finalText);
});
