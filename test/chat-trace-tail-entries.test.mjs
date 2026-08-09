import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadPiSessionFastMetadata, readTailEntries } from "../dist/apps/chat/trace.js";
import { buildTraceViewFromEvents, flattenTraceNodes } from "../dist/shared/trace-engine.js";

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

test("bounded transcript tails keep repeated user identities aligned with their assistants", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-trace-tail-repeated-"));
	const path = join(dir, "session.jsonl");
	const entries = [
		messageEntry("entry-user-one", "user", "same prompt", "2026-08-09T10:00:00.000Z"),
		messageEntry("entry-assistant-one", "assistant", `first answer ${"x".repeat(8_000)}`, "2026-08-09T10:00:01.000Z"),
		messageEntry("entry-user-two", "user", "same prompt", "2026-08-09T10:00:02.000Z"),
		messageEntry("entry-assistant-two", "assistant", "second answer", "2026-08-09T10:00:03.000Z"),
		messageEntry("entry-user-three", "user", "same prompt", "2026-08-09T10:00:04.000Z"),
		messageEntry("entry-assistant-three", "assistant", "third answer", "2026-08-09T10:00:05.000Z"),
	];
	writeFileSync(path, [
		JSON.stringify({ type: "session", id: "pi-tail", timestamp: "2026-08-09T10:00:00.000Z", cwd: process.cwd() }),
		...entries.map((entry) => JSON.stringify(entry)),
	].join("\n") + "\n", "utf8");

	const tailEntries = readTailEntries(path, 1_800);
	assert.deepEqual(tailEntries.map((entry) => entry.id), [
		"entry-user-two",
		"entry-assistant-two",
		"entry-user-three",
		"entry-assistant-three",
	]);
	const piboSessionId = "ps-tail-repeat";
	const view = buildTraceViewFromEvents({
		session: { id: piboSessionId, piSessionId: "pi-tail" },
		status: "idle",
		transcriptEntries: tailEntries,
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-08-09T10:00:01.000Z", assistantIndices: [0] },
			{ eventId: "turn-two", userText: "same prompt", completedAt: "2026-08-09T10:00:03.000Z", assistantIndices: [0] },
			{ eventId: "turn-three", userText: "same prompt", completedAt: "2026-08-09T10:00:05.000Z", assistantIndices: [0] },
		],
		events: [{
			id: "tail-turn-three",
			piboSessionId,
			eventSequence: 300,
			type: "message_queued",
			createdAt: "2026-08-09T10:00:04.000Z",
			payload: {
				type: "message_queued",
				piboSessionId,
				eventId: "turn-three",
				source: "user",
				text: "same prompt",
				queuedMessages: 1,
			},
		}],
	});
	const flat = flattenTraceNodes(view.nodes);
	assert.deepEqual(flat.filter((node) => node.type === "user.message").map((node) => node.id), [
		"event:message_queued:turn-two",
		"event:message_queued:turn-three",
	]);
	assert.deepEqual(flat.filter((node) => node.type === "assistant.message").map((node) => node.id), [
		"event:assistant:turn-two:assistant:0",
		"event:assistant:turn-three:assistant:0",
	]);

	const runningView = buildTraceViewFromEvents({
		session: { id: piboSessionId, piSessionId: "pi-tail" },
		status: "running",
		transcriptEntries: tailEntries.slice(0, 3),
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-08-09T10:00:01.000Z", assistantIndices: [0] },
			{ eventId: "turn-two", userText: "same prompt", completedAt: "2026-08-09T10:00:03.000Z", assistantIndices: [0] },
			{ eventId: "turn-three", userText: "same prompt" },
		],
		events: [{
			id: "active-tail-turn-three",
			piboSessionId,
			eventSequence: 301,
			type: "message_queued",
			createdAt: "2026-08-09T10:00:04.000Z",
			payload: {
				type: "message_queued",
				piboSessionId,
				eventId: "turn-three",
				source: "user",
				text: "same prompt",
				queuedMessages: 1,
			},
		}],
	});
	const runningFlat = flattenTraceNodes(runningView.nodes);
	assert.deepEqual(runningFlat.filter((node) => node.type === "user.message").map((node) => node.id), [
		"event:message_queued:turn-two",
		"event:message_queued:turn-three",
	]);
	assert.deepEqual(runningFlat.filter((node) => node.type === "assistant.message").map((node) => node.id), [
		"event:assistant:turn-two:assistant:0",
	]);
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
