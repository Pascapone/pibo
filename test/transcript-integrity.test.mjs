import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { RoutedSession } from "../dist/core/routed-session.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import {
	PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE,
	claimPiboTranscriptIntegrityContinuation,
	installPiboTranscriptIntegrity,
	settlePiboTranscriptIntegrityContinuation,
	validatePiboTranscriptIntegrityMessages,
} from "../dist/core/transcript-integrity.js";

const user = (text = "continue") => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
const assistant = (calls, timestamp = 2) => ({
	role: "assistant",
	content: calls.map(({ id, name }) => ({ type: "toolCall", id, name, arguments: {} })),
	api: "openai-responses",
	provider: "openai",
	model: "test",
	usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "toolUse",
	timestamp,
});
const result = (toolCallId, toolName = "bash", timestamp = 3) => ({
	role: "toolResult",
	toolCallId,
	toolName,
	content: [{ type: "text", text: "completed once" }],
	isError: false,
	timestamp,
});

function fakeSession(manager, messages = manager.buildSessionContext().messages, compact = async () => ({ summary: "ok" })) {
	return {
		sessionManager: manager,
		agent: { state: { messages: [...messages] }, transformContext: undefined },
		compact,
	};
}

function activeMessages(manager) {
	return manager.buildSessionContext().messages;
}

function activeIntegrityEntries(manager) {
	return manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE);
}

test("transcript validator accepts valid multi-tool turns and rejects invalid relations", () => {
	const valid = [user(), assistant([{ id: "call-a", name: "read" }, { id: "call-b", name: "bash" }]), result("call-a", "read"), result("call-b", "bash")];
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(valid), []);

	assert.equal(validatePiboTranscriptIntegrityMessages([user(), result("missing")])[0]?.relation, "orphan_result");
	assert.equal(validatePiboTranscriptIntegrityMessages([user(), assistant([{ id: "same", name: "bash" }]), assistant([{ id: "same", name: "bash" }])])[0]?.relation, "duplicate_call");
	assert.equal(validatePiboTranscriptIntegrityMessages([user(), assistant([{ id: "same", name: "bash" }]), result("same"), result("same")])[0]?.relation, "duplicate_result");
	assert.equal(validatePiboTranscriptIntegrityMessages([user(), assistant([{ id: "same", name: "read" }]), result("same", "bash")])[0]?.relation, "tool_name_mismatch");
});

test("load repair quarantines an orphaned result on a preserved inactive branch and claims one continuation", () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user());
	const orphanId = manager.appendMessage(result("call-orphan"));
	const session = fakeSession(manager);

	const reports = installPiboTranscriptIntegrity(session);
	assert.equal(reports.length, 1);
	assert.equal(reports[0].action, "quarantined_tail");
	assert.equal(reports[0].removedEntryIds.includes(orphanId), true);
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(activeMessages(manager)), []);
	assert.equal(activeMessages(manager).some((message) => message.role === "toolResult"), false);
	assert.equal(manager.getEntry(orphanId)?.type, "message", "quarantine must preserve the original branch for diagnostics");
	assert.equal(activeIntegrityEntries(manager).length, 1);

	assert.equal(claimPiboTranscriptIntegrityContinuation(session).length, 1);
	assert.equal(claimPiboTranscriptIntegrityContinuation(session).length, 0);
	settlePiboTranscriptIntegrityContinuation(session, "completed");
	assert.equal(activeIntegrityEntries(manager).at(-1)?.data?.phase, "continuation_completed");
});

test("load repair restores one authoritative off-branch assistant call without rerunning its tool", () => {
	const manager = SessionManager.inMemory("/tmp");
	const userId = manager.appendMessage(user());
	const originalAssistantId = manager.appendMessage(assistant([{ id: "call-restored", name: "bash" }]));
	manager.branch(userId);
	const orphanId = manager.appendMessage(result("call-restored"));
	const session = fakeSession(manager);
	let executions = 0;

	const reports = installPiboTranscriptIntegrity(session);
	assert.equal(executions, 0);
	assert.equal(reports[0]?.action, "restored_pair");
	assert.deepEqual(reports[0]?.restoredEntryIds, [originalAssistantId, orphanId]);
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(activeMessages(manager)), []);
	assert.equal(activeMessages(manager).filter((message) => message.role === "assistant").length, 1);
	assert.equal(activeMessages(manager).filter((message) => message.role === "toolResult").length, 1);
});

test("persistence guard journals a missing assistant call with its result and suppresses the later duplicate assistant append", () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user());
	const callMessage = assistant([{ id: "call-race", name: "bash" }]);
	const session = fakeSession(manager, [user(), callMessage]);
	installPiboTranscriptIntegrity(session);

	manager.appendMessage(result("call-race"));
	manager.appendMessage(callMessage);

	const messages = activeMessages(manager);
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(messages), []);
	assert.equal(messages.filter((message) => message.role === "assistant").length, 1);
	assert.equal(messages.filter((message) => message.role === "toolResult").length, 1);
	const phases = activeIntegrityEntries(manager).map((entry) => entry.data?.phase);
	assert.deepEqual(phases, ["journal_started", "journal_committed"]);
});

test("provider boundary replaces a runtime-only orphan with the valid durable transcript", async () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user());
	const runtimeOrphan = result("call-runtime");
	const session = fakeSession(manager, [user(), runtimeOrphan]);
	installPiboTranscriptIntegrity(session);

	const providerMessages = await session.agent.transformContext([user(), runtimeOrphan]);
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(providerMessages), []);
	assert.equal(providerMessages.some((message) => message.role === "toolResult"), false);
	assert.equal(session.agent.state.messages.some((message) => message.role === "toolResult"), false);
	assert.equal(activeIntegrityEntries(manager).at(-1)?.data?.boundary, "before_provider");
});

test("provider repair preserves prior context transforms without resubmitting invalid output", async () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user("durable"));
	const runtimeOrphan = result("call-runtime-transform");
	const session = fakeSession(manager, [user("durable"), runtimeOrphan]);
	session.agent.transformContext = async (messages) => [...messages, user("transformed")];
	installPiboTranscriptIntegrity(session);

	const providerMessages = await session.agent.transformContext([user("durable"), runtimeOrphan]);
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(providerMessages), []);
	assert.equal(providerMessages.some((message) => message.role === "toolResult"), false);
	assert.equal(providerMessages.some((message) => message.role === "user" && message.content?.[0]?.text === "transformed"), true);
});

test("compaction boundaries repair corruption produced by compaction before it becomes active", async () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user());
	const rawAppendMessage = manager.appendMessage.bind(manager);
	const session = fakeSession(manager, undefined, async () => {
		rawAppendMessage(result("call-after-compact"));
		return { summary: "compacted" };
	});
	installPiboTranscriptIntegrity(session);

	await session.compact();
	assert.deepEqual(validatePiboTranscriptIntegrityMessages(activeMessages(manager)), []);
	assert.equal(activeIntegrityEntries(manager).at(-1)?.data?.boundary, "after_compaction");
});

test("routed load recovery performs one autonomous continuation before the next queued user message", async () => {
	const manager = SessionManager.inMemory("/tmp");
	manager.appendMessage(user());
	manager.appendMessage(result("call-routed"));
	const order = [];
	const listeners = new Set();
	const session = {
		...fakeSession(manager),
		model: undefined,
		isStreaming: false,
		settingsManager: { getCompactionSettings: () => ({ enabled: false }) },
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		supportsThinking: () => false,
		getActiveToolNames: () => [],
		setActiveToolsByName: () => {},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		async sendCustomMessage(message) {
			order.push(`resume:${message.customType}`);
			manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
		},
		async waitForIdle() {},
		async prompt(text) { order.push(`prompt:${text}`); },
		async abort() {},
	};
	session.agent.continue = async () => {};
	installPiboTranscriptIntegrity(session);
	let rebind;
	const runtime = {
		session,
		cwd: "/tmp",
		setRebindSession(callback) { rebind = callback; },
		async dispose() {},
	};
	const events = [];
	const routed = new RoutedSession(
		"ps-transcript-integrity",
		runtime,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);

	routed.enqueueMessage({ type: "message", id: "event-1", piboSessionId: "ps-transcript-integrity", text: "original request", source: "user" });
	for (let index = 0; index < 100 && !events.some((event) => event.type === "message_finished"); index += 1) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.deepEqual(order, ["resume:pibo-transcript-integrity-resume", "prompt:original request"]);
	assert.equal(events.filter((event) => event.type === "message_finished").length, 1);
	assert.equal(typeof rebind, "function");
	await routed.dispose();
});

test("an already-corrupted persisted session self-heals once and remains valid after reload", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pibo-transcript-integrity-"));
	try {
		const sessionId = randomUUID();
		const userId = randomUUID();
		const resultId = randomUUID();
		const sessionFile = join(directory, `2026-08-09T00-00-00-000Z_${sessionId}.jsonl`);
		await writeFile(sessionFile, [
			{ type: "session", version: 3, id: sessionId, timestamp: "2026-08-09T00:00:00.000Z", cwd: "/tmp" },
			{ type: "message", id: userId, parentId: null, timestamp: "2026-08-09T00:00:01.000Z", message: user() },
			{ type: "message", id: resultId, parentId: userId, timestamp: "2026-08-09T00:00:02.000Z", message: result("call-disk") },
		].map((entry) => JSON.stringify(entry)).join("\n") + "\n");

		const manager = SessionManager.open(sessionFile, directory, "/tmp");
		const session = fakeSession(manager);
		assert.equal(installPiboTranscriptIntegrity(session).length, 1);
		assert.deepEqual(validatePiboTranscriptIntegrityMessages(activeMessages(manager)), []);

		const reopened = SessionManager.open(sessionFile, directory, "/tmp");
		const reopenedSession = fakeSession(reopened);
		assert.equal(installPiboTranscriptIntegrity(reopenedSession).length, 0);
		assert.deepEqual(validatePiboTranscriptIntegrityMessages(activeMessages(reopened)), []);
		const persisted = await readFile(sessionFile, "utf8");
		assert.match(persisted, /pibo-transcript-integrity/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
