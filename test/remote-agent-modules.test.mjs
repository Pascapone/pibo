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
	return {
		getRoomSession: (roomId, sessionId) => roomId === "room-a" && sessionId === "ps_a1" ? { id: "ps_a1", title: "Alpha" } : undefined,
		listSessionMessages: () => [
			{ id: "m1", role: "user", text: "fix the login bug", createdAt: "2026-09-19T10:00:00.000Z" },
			{ id: "m2", role: "assistant", text: "looking at the auth module now", createdAt: "2026-09-19T10:01:00.000Z" },
		],
		listSessionObservations: () => [
			{ sequence: 1, kind: "tool", status: "completed", text: "read src/auth.ts", toolName: "read", startedAt: "2026-09-19T10:01:30.000Z" },
		],
	};
}

test("observe module reuses the shared observation paging", async () => {
	const tools = buildObserveModuleTools(fakeObservePort());
	const context = contextFor("room-a", tmpdir());
	const observe = toolByName(tools, "remote_session_observe");
	// Default view matches pibo_agents_observe: assistant messages only.
	const def = await observe.execute({ sessionId: "ps_a1" }, context);
	assert.match(def.text, /looking at the auth module/);
	assert.ok(!def.text.includes("fix the login bug"));
	const full = await observe.execute({ sessionId: "ps_a1", eventTypes: ["user_message", "assistant_message"] }, context);
	assert.match(full.text, /fix the login bug/);
	assert.match(full.text, /looking at the auth module/);
	const first = await observe.execute({ sessionId: "ps_a1", eventTypes: ["user_message", "assistant_message"], limit: 1 }, context);
	assert.match(first.text, /fix the login bug/);
	assert.equal(first.details.nextAfterSequence, 1);
	assert.equal(first.details.truncated, true);
	const second = await observe.execute({ sessionId: "ps_a1", eventTypes: ["user_message", "assistant_message"], afterSequence: first.details.nextAfterSequence }, context);
	assert.match(second.text, /looking at the auth module/);
	const toolsPage = await observe.execute({ sessionId: "ps_a1", includeTools: true }, context);
	assert.match(toolsPage.text, /read src\/auth\.ts/);
	await assert.rejects(
		observe.execute({ sessionId: "ps_b1" }, context),
		(error) => error instanceof RemoteAgentError && error.code === "session_forbidden",
	);
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
