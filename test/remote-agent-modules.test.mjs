import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBashModuleTools } from "../dist/remote-agent/modules/bash.js";
import { buildFilesModuleTools } from "../dist/remote-agent/modules/files.js";
import { buildObserveModuleTools } from "../dist/remote-agent/modules/observe.js";
import { buildSessionModuleTools } from "../dist/remote-agent/modules/sessions.js";
import { RemoteAgentError } from "../dist/remote-agent/types.js";

function toolByName(tools, name) {
	const tool = tools.find((entry) => entry.name === name);
	assert.ok(tool, `missing tool ${name}`);
	return tool;
}

function contextFor(roomId, sandboxRoot, mode = "sandbox") {
	return { roomId, tokenId: "t1", label: "test", mode, sandboxRoot, cwd: sandboxRoot, toolCallId: "call-1" };
}

// -- sessions ---------------------------------------------------------------

function fakeSessionPort() {
	const sessions = new Map([
		["ps_a1", { id: "ps_a1", title: "Alpha", profile: "default", channel: "pibo.chat-web", kind: "chat", createdAt: "2026-09-19T10:00:00.000Z", updatedAt: "2026-09-19T11:00:00.000Z", roomId: "room-a" }],
		["ps_b1", { id: "ps_b1", title: "Beta", profile: "default", channel: "pibo.chat-web", kind: "chat", createdAt: "2026-09-19T10:00:00.000Z", updatedAt: "2026-09-19T11:00:00.000Z", roomId: "room-b" }],
	]);
	const sent = [];
	return {
		sent,
		port: {
			listRoomSessions: (roomId) => [...sessions.values()].filter((session) => session.roomId === roomId),
			getRoomSession: (roomId, sessionId) => {
				const session = sessions.get(sessionId);
				return session && session.roomId === roomId ? session : undefined;
			},
			createRoomSession: (roomId, input) => {
				const session = { id: `ps_new_${sessions.size}`, title: input.title, profile: input.profile ?? "default", channel: "pibo.chat-web", kind: "chat", createdAt: "2026-09-19T12:00:00.000Z", updatedAt: "2026-09-19T12:00:00.000Z", roomId };
				sessions.set(session.id, session);
				return session;
			},
			sendSessionMessage: async (sessionId, message) => {
				sent.push({ sessionId, message });
				return { eventId: "ev_1", reply: "working on it" };
			},
		},
	};
}

test("sessions module lists, creates, and messages within one room", async () => {
	const { port, sent } = fakeSessionPort();
	const tools = buildSessionModuleTools(port);
	const context = contextFor("room-a", tmpdir());
	const listed = await toolByName(tools, "remote_session_list").execute({}, context);
	assert.match(listed.text, /ps_a1/);
	assert.ok(!listed.text.includes("ps_b1"));
	const created = await toolByName(tools, "remote_session_create").execute({ title: "Gamma" }, context);
	assert.match(created.text, /ps_new_/);
	const response = await toolByName(tools, "remote_session_send").execute({ sessionId: "ps_a1", message: "hello" }, context);
	assert.match(response.text, /working on it/);
	assert.deepEqual(sent, [{ sessionId: "ps_a1", message: "hello" }]);
});

test("sessions module refuses cross-room access", async () => {
	const { port } = fakeSessionPort();
	const tools = buildSessionModuleTools(port);
	const context = contextFor("room-a", tmpdir());
	await assert.rejects(
		toolByName(tools, "remote_session_send").execute({ sessionId: "ps_b1", message: "hello" }, context),
		(error) => error instanceof RemoteAgentError && error.code === "session_forbidden",
	);
});

// -- observe ----------------------------------------------------------------

function fakeObservePort() {
	const cursors = new Map();
	const long600 = `L${"o".repeat(598)}g`;
	const long5000 = `X${"y".repeat(4998)}Z`;
	return {
		cursors,
		long600,
		long5000,
		getRoomSession: (roomId, sessionId) => roomId === "room-a" && sessionId === "ps_a1" ? { id: "ps_a1", title: "Alpha" } : undefined,
		listSessionMessages: () => [
			{ id: "m1", role: "user", text: "fix the login bug", createdAt: "2026-09-19T10:00:00.000Z", turnId: "t1" },
			{ id: "m2", role: "assistant", text: "looking at the auth module now", createdAt: "2026-09-19T10:01:00.000Z", turnId: "t1" },
			{ id: "m3", role: "assistant", text: long600, createdAt: "2026-09-19T10:02:00.000Z", turnId: "t2" },
			{ id: "m4", role: "assistant", text: long5000, createdAt: "2026-09-19T10:03:00.000Z", turnId: "t3" },
		],
		listSessionObservations: () => [
			{ sequence: 1, status: "completed", startedAt: "2026-09-19T10:00:30.000Z", eventType: "tool_call", sourceValue: { path: "src/auth.ts", bigBlob: `B${"z".repeat(1998)}` }, toolName: "read", toolCallId: "tc1", requestId: "run-1", turnId: "t1", attributes: { eventType: "tool_call" } },
			{ sequence: 2, status: "completed", startedAt: "2026-09-19T10:00:40.000Z", eventType: "tool_execution_finished", sourceValue: { lines: 120 }, toolName: "read", toolCallId: "tc1", requestId: "run-1", turnId: "t1", attributes: { eventType: "tool_execution_finished" } },
		],
		getObservationCursor: (sessionId, scope) => cursors.get(`${sessionId} ${scope}`),
		advanceObservationCursor: (sessionId, scope, sequence) => {
			const advanced = Math.max(cursors.get(`${sessionId} ${scope}`) ?? 0, sequence);
			cursors.set(`${sessionId} ${scope}`, advanced);
			return advanced;
		},
	};
}

function observeHistoryArgs(extra = {}) {
	return { sessionId: "ps_a1", cursorMode: "history", ...extra };
}

test("observe module mirrors pibo_agents_observe: default view, cursors, paging", async () => {
	const port = fakeObservePort();
	const tools = buildObserveModuleTools(port);
	const context = contextFor("room-a", tmpdir());
	const observe = toolByName(tools, "remote_session_observe");
	// Default view matches pibo_agents_observe: newest assistant messages first, tools hidden.
	const def = await observe.execute({ sessionId: "ps_a1" }, context);
	assert.equal(def.details.observations.length, 3);
	assert.ok(def.text.indexOf("Xyyy") < def.text.indexOf("looking at the auth module"));
	assert.ok(!def.text.includes("fix the login bug"));
	assert.ok(!def.text.includes("toolCallId=tc1"));
	assert.equal(def.details.truncated, false);
	assert.equal(def.details.autoCursorSequence, 6);
	// Auto cursor: the same query has nothing new afterwards.
	const again = await observe.execute({ sessionId: "ps_a1" }, context);
	assert.equal(again.details.observations.length, 0);
	assert.match(again.text, /No new/);
	// History rereads everything; explicit paging walks oldest-unseen first.
	const first = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message"], order: "asc", limit: 2 }), context);
	assert.equal(first.details.observations.length, 2);
	assert.equal(first.details.truncated, true);
	assert.match(first.text, /fix the login bug/);
	assert.match(first.text, /looking at the auth module/);
	const second = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message"], order: "asc", afterSequence: first.details.nextAfterSequence }), context);
	assert.ok(second.text.includes(port.long600));
	assert.equal(second.details.truncated, false);
	await assert.rejects(
		observe.execute({ sessionId: "ps_b1" }, context),
		(error) => error instanceof RemoteAgentError && error.code === "session_forbidden",
	);
});

test("observe module returns full message text without a remote cap", async () => {
	const port = fakeObservePort();
	const tools = buildObserveModuleTools(port);
	const context = contextFor("room-a", tmpdir());
	const observe = toolByName(tools, "remote_session_observe");
	const page = await observe.execute(observeHistoryArgs({ eventTypes: ["assistant_message"], order: "asc" }), context);
	// 600 chars: complete, proving the old 512-char preview cap is gone.
	assert.ok(page.text.includes(port.long600));
	// Over-long text is bounded only by the shared observation logic (4KB + ellipsis).
	const huge = page.details.observations.find((entry) => entry.text?.startsWith("Xyyy"));
	assert.ok(huge);
	assert.ok(huge.text.length <= 4096);
	assert.ok(huge.text.endsWith("…"));
});

test("observe module mirrors tool detail, identity, and content filters", async () => {
	const tools = buildObserveModuleTools(fakeObservePort());
	const context = contextFor("room-a", tmpdir());
	const observe = toolByName(tools, "remote_session_observe");
	const summary = await observe.execute(observeHistoryArgs({ includeTools: true }), context);
	assert.match(summary.text, /read/);
	assert.ok(!summary.text.includes("Bzzz"));
	const full = await observe.execute(observeHistoryArgs({ includeTools: true, toolDetail: "full" }), context);
	assert.ok(full.text.includes("Bzzz"));
	const byCall = await observe.execute(observeHistoryArgs({ toolCallIds: ["tc1"] }), context);
	assert.equal(byCall.details.observations.length, 2);
	const noCall = await observe.execute(observeHistoryArgs({ toolCallIds: ["nope"] }), context);
	assert.equal(noCall.details.observations.length, 0);
	const byRun = await observe.execute(observeHistoryArgs({ requestIds: ["run-1"], includeTools: true }), context);
	assert.equal(byRun.details.observations.length, 2);
	const byTurn = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message", "tool_call", "tool_execution_finished"], threadKeys: ["t1"] }), context);
	assert.equal(byTurn.details.observations.length, 4);
	const byName = await observe.execute(observeHistoryArgs({ names: ["Alpha"] }), context);
	assert.equal(byName.details.observations.length, 3);
	assert.equal((await observe.execute(observeHistoryArgs({ names: ["Beta"] }), context)).details.observations.length, 0);
	assert.equal((await observe.execute(observeHistoryArgs({ agentIds: ["ps_a1"] }), context)).details.observations.length, 3);
	assert.equal((await observe.execute(observeHistoryArgs({ agentIds: ["ps_x"] }), context)).details.observations.length, 0);
	const toolsOnly = await observe.execute(observeHistoryArgs({ kinds: ["tool"] }), context);
	assert.equal(toolsOnly.details.observations.length, 2);
	const userOnly = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message"], roles: ["user"] }), context);
	assert.equal(userOnly.details.observations.length, 1);
	assert.match(userOnly.text, /fix the login bug/);
	const contained = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message"], textContains: "LOGIN" }), context);
	assert.equal(contained.details.observations.length, 1);
	const ranged = await observe.execute(observeHistoryArgs({ eventTypes: ["user_message", "assistant_message"], since: "2026-09-19T10:02:00.000Z" }), context);
	assert.equal(ranged.details.observations.length, 2);
	const withDetails = await observe.execute(observeHistoryArgs({ includeDetails: true, limit: 1 }), context);
	assert.ok(withDetails.details.observations[0].details);
	const withoutDetails = await observe.execute(observeHistoryArgs({ limit: 1 }), context);
	assert.equal(withoutDetails.details.observations[0].details, undefined);
	await assert.rejects(observe.execute(observeHistoryArgs({ limit: 500 }), context));
});

// -- files ------------------------------------------------------------------

test("files module reads and writes through Pi tools", async () => {
	const root = mkdtempSync(join(tmpdir(), "remote-files-"));
	try {
		writeFileSync(join(root, "docs.md"), "line one\nline two\n");
		const tools = buildFilesModuleTools();
		const context = contextFor("room-a", root);
		const read = await toolByName(tools, "remote_file_read").execute({ path: "docs.md" }, context);
		assert.match(read.text, /line one/);
		// Pibo hashline format carries LINE#HASH anchors.
		assert.match(read.text, /1#[A-Z]{2}:line one/);
		const written = await toolByName(tools, "remote_file_write").execute({ path: "out.txt", content: "hello" }, context);
		assert.equal(written.isError, undefined);
		const edited = await toolByName(tools, "remote_file_edit").execute({ path: "out.txt", edits: [{ oldText: "hello", newText: "hello world" }] }, context);
		assert.equal(edited.isError, undefined);
		const listed = await toolByName(tools, "remote_file_list").execute({ path: "." }, context);
		assert.match(listed.text, /out\.txt/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("files module jails paths to the sandbox in sandbox mode", async () => {
	const root = mkdtempSync(join(tmpdir(), "remote-jail-"));
	const outside = mkdtempSync(join(tmpdir(), "remote-outside-"));
	try {
		writeFileSync(join(outside, "secret.txt"), "top secret");
		const tools = buildFilesModuleTools();
		const sandbox = contextFor("room-a", root, "sandbox");
		await assert.rejects(
			toolByName(tools, "remote_file_read").execute({ path: join(outside, "secret.txt") }, sandbox),
			(error) => error instanceof RemoteAgentError && error.code === "path_forbidden",
		);
		await assert.rejects(
			toolByName(tools, "remote_file_write").execute({ path: "../evil.txt", content: "x" }, sandbox),
			(error) => error instanceof RemoteAgentError && error.code === "path_forbidden",
		);
		// YOLO mode lifts the jail.
		const yolo = { ...sandbox, mode: "yolo" };
		const read = await toolByName(tools, "remote_file_read").execute({ path: join(outside, "secret.txt") }, yolo);
		assert.match(read.text, /top secret/);
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});

// -- bash -------------------------------------------------------------------

test("bash module runs commands with the room cwd", async () => {
	const root = mkdtempSync(join(tmpdir(), "remote-bash-"));
	try {
		writeFileSync(join(root, "marker.txt"), "x");
		const tools = buildBashModuleTools();
		const context = contextFor("room-a", root);
		const result = await toolByName(tools, "remote_bash_run").execute({ command: "ls" }, context);
		assert.match(result.text, /marker\.txt/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
