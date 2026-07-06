import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiSessionFastMetadata, readTailEntries } from "../dist/apps/chat/trace.js";

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

test("loadPiSessionFastMetadata reads only the transcript header window", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-fast-metadata-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(dir, "agent");
	const cwd = join(dir, "workspace");
	const piSessionId = "pi_fast_metadata";
	const safePath = `--${cwd.replace(/^[\\/]/, "").replace(/[\\/:]/g, "-")}--`;
	const sessionDir = join(agentDir, "sessions", safePath);
	mkdirSync(sessionDir, { recursive: true });
	const path = join(sessionDir, `20260705_${piSessionId}.jsonl`);
	writeFileSync(path, [
		JSON.stringify({ type: "session", id: piSessionId, timestamp: "2026-07-05T00:00:00.000Z", cwd }),
		JSON.stringify({ type: "session_info", id: "info-1", timestamp: "2026-07-05T00:00:00.001Z", name: "Fast Metadata Session" }),
		JSON.stringify(messageEntry("first-user", "user", "hello from the head", "2026-07-05T00:00:01.000Z")),
		`{"type":"message","id":"broken-tail","timestamp":"2026-07-05T00:00:02.000Z","message":{"role":"assistant","content":[{"type":"text","text":"${"x".repeat(200_000)}`,
	].join("\n"), "utf8");

	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const metadata = await loadPiSessionFastMetadata({
			id: "ps_fast_metadata",
			piSessionId,
			channel: "test",
			kind: "chat",
			profile: "pibo-agent",
			metadata: {},
			createdAt: "2026-07-05T00:00:00.000Z",
			updatedAt: "2026-07-05T00:00:01.000Z",
		}, cwd);
		assert.equal(metadata.sessionPath, path);
		assert.equal(metadata.sessionSize, statSync(path).size);
		assert.equal(metadata.name, "Fast Metadata Session");
		assert.equal(metadata.firstMessage, "hello from the head");
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
});
