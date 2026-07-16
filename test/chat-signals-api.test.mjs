import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { createPiboSignalRegistry } from "../dist/signals/registry.js";

function createFakeAuthService() {
	return {
		name: "fake-auth",
		async getSession(headers) {
			const userId = headers.get("x-test-user");
			if (!userId) return undefined;
			return { identity: { userId, email: `${userId}@example.test`, provider: "test" } };
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw new Error("Unauthenticated");
			return session;
		},
	};
}

async function startSignalWebHost(options = {}) {
	const { exposeSignalRegistry = true, emit, setLiveSessionActiveModel } = options;
	const sessions = new InMemoryPiboSessionStore();
	const signals = createPiboSignalRegistry();
	const storageDir = mkdtempSync(join(tmpdir(), "pibo-chat-signals-"));
	const dataStorePath = join(storageDir, "pibo-chat-v2.sqlite");
	const agentStorePath = join(storageDir, "agents.sqlite");
	const channel = createWebHostChannel({ port: 0, announce: false });
	const listeners = new Set();
	await channel.start({
		auth: createFakeAuthService(),
		emit: emit ?? (() => { throw new Error("not used"); }),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		getSession: (id) => sessions.get(id),
		createSession: (input) => sessions.create(input),
		updateSession: (id, input) => sessions.update(id, input),
		setLiveSessionActiveModel,
		reportSessionError(id, error, opts = {}) {
			signals.project({ type: "session_created", session: sessions.get(id) });
			signals.project({ type: "pibo_output", event: { type: "session_error", piboSessionId: id, eventId: opts.eventId, error }, session: sessions.get(id) });
		},
		deleteSession: (id) => sessions.delete(id),
		findSessions: (input) => sessions.find(input),
		listSessions: () => sessions.list(),
		getGatewayActions: () => [],
		getProfiles: () => [{ name: "test-profile", description: "Test", aliases: [] }],
		getCapabilityCatalog: () => ({ nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [] }),
		...(exposeSignalRegistry ? {
			snapshotSignalSession: (id) => signals.snapshotSession(id),
			snapshotSignalTree: (id) => signals.snapshotTree(id),
			subscribeSignalTree: (id, listener) => signals.subscribe(id, listener),
		} : {}),
		getWebApps() {
			return [createChatWebApp({ dataStorePath, agentStorePath })];
		},
	});
	const address = channel.getAddress();
	return {
		channel,
		baseURL: `http://${address.host}:${address.port}`,
		sessions,
		signals,
		emitOutput(event) {
			signals.project({ type: "pibo_output", event, session: sessions.get(event.piboSessionId) });
			for (const listener of listeners) listener(event);
		},
	};
}

function createSession(store, id, parentId, metadata) {
	return store.create({ id, channel: "test", kind: parentId ? "subagent" : "runtime", profile: "test-profile", parentId, metadata });
}

function findSessionNode(nodes, piboSessionId) {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findSessionNode(node.children ?? [], piboSessionId);
		if (child) return child;
	}
	return undefined;
}

async function readSseEvents(response, count) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const events = [];
	while (events.length < count) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let index;
		while ((index = buffer.indexOf("\n\n")) >= 0) {
			const frame = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			const event = frame.match(/^event: (.+)$/m)?.[1];
			const data = frame.match(/^data: (.+)$/m)?.[1];
			if (event && data) events.push({ event, data: JSON.parse(data) });
		}
	}
	await reader.cancel();
	return events;
}

test("chat signal snapshots are app-global and include local session state", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost();
	try {
		const session = createSession(sessions, "ps_signal_root");
		signals.project({ type: "session_created", session });
		signals.project({ type: "pibo_output", event: { type: "message_started", piboSessionId: session.id, eventId: "event-1", text: "hello" }, session });

		const ok = await fetch(`${baseURL}/api/chat/signals/session/${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(ok.status, 200);
		const snapshot = await ok.json();
		assert.equal(snapshot.sessions[session.id].isTreeActive, true);
		assert.equal(snapshot.sessions[session.id].latestTurn.eventId, "event-1");
		assert.equal(snapshot.sessions[session.id].latestTurn.state, "running");

		const crossAccount = await fetch(`${baseURL}/api/chat/signals/session/${session.id}`, { headers: { "x-test-user": "user-2" } });
		assert.equal(crossAccount.status, 200);
		const crossAccountSnapshot = await crossAccount.json();
		assert.equal(crossAccountSnapshot.sessions[session.id].isTreeActive, true);
	} finally {
		await channel.stop?.();
	}
});

test("chat signal tree snapshot includes descendants", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost();
	try {
		const root = createSession(sessions, "ps_tree_root");
		const child = createSession(sessions, "ps_tree_child", root.id);
		const grandchild = createSession(sessions, "ps_tree_grandchild", child.id);
		for (const session of [root, child, grandchild]) signals.project({ type: "session_created", session });

		const response = await fetch(`${baseURL}/api/chat/signals/tree/${root.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		const snapshot = await response.json();
		assert.ok(snapshot.sessions[root.id]);
		assert.ok(snapshot.sessions[child.id]);
		assert.ok(snapshot.sessions[grandchild.id]);
	} finally {
		await channel.stop?.();
	}
});

test("chat signal SSE sends snapshot then monotonic patches", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost();
	try {
		const session = createSession(sessions, "ps_signal_sse");
		signals.project({ type: "session_created", session });
		const response = await fetch(`${baseURL}/api/chat/signals/events?rootPiboSessionId=${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
		assert.equal(response.headers.get("content-encoding"), "identity");
		assert.equal(response.headers.get("x-accel-buffering"), "no");
		setTimeout(() => signals.project({
			type: "pibo_output",
			event: { type: "message_started", piboSessionId: session.id, eventId: "event-sse", text: "hello" },
			session,
		}), 10);
		const events = await readSseEvents(response, 2);
		assert.equal(events[0].event, "signal_snapshot");
		assert.equal(events[1].event, "signal_patch");
		assert.equal(events[1].data.fromVersion + 1, events[1].data.toVersion);
		assert.equal(events[1].data.sessionSnapshots[0].latestTurn.eventId, "event-sse");
		assert.equal(events[1].data.sessionSnapshots[0].latestTurn.state, "running");
	} finally {
		await channel.stop?.();
	}
});


test("chat signal SSE rejects missing root session id", async () => {
	const { channel, baseURL } = await startSignalWebHost();
	try {
		const response = await fetch(`${baseURL}/api/chat/signals/events`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 400);
	} finally {
		await channel.stop?.();
	}
});


test("chat signal SSE is app-global for an existing root", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost();
	try {
		const session = createSession(sessions, "ps_signal_sse_account");
		signals.project({ type: "session_created", session });
		const response = await fetch(`${baseURL}/api/chat/signals/events?rootPiboSessionId=${session.id}`, { headers: { "x-test-user": "user-2" } });
		assert.equal(response.status, 200);
		const events = await readSseEvents(response, 1);
		assert.equal(events[0].event, "signal_snapshot");
		assert.ok(events[0].data.sessions[session.id]);
	} finally {
		await channel.stop?.();
	}
});


test("chat signal routes return 503 when registry functions are unavailable", async () => {
	const { channel, baseURL, sessions } = await startSignalWebHost({ exposeSignalRegistry: false });
	try {
		const session = createSession(sessions, "ps_signal_registry_unavailable");

		const snapshot = await fetch(`${baseURL}/api/chat/signals/tree/${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(snapshot.status, 503);

		const sse = await fetch(`${baseURL}/api/chat/signals/events?rootPiboSessionId=${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(sse.status, 503);
	} finally {
		await channel.stop?.();
	}
});


test("chat bootstrap overlays live signal running status", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost();
	try {
		const session = createSession(sessions, "ps_bootstrap_signal_running");
		signals.project({ type: "session_created", session });
		signals.project({ type: "session_processing_changed", piboSessionId: session.id, processing: true, queuedMessages: 0 });

		const response = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.sessions.find((node) => node.piboSessionId === session.id)?.status, "running");
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation clears stale indexed running status from settled signal state", async () => {
	const { channel, baseURL, sessions, signals, emitOutput } = await startSignalWebHost();
	try {
		const session = createSession(sessions, "ps_navigation_signal_idle");
		signals.project({ type: "session_created", session });
		await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${session.id}`, { headers: { "x-test-user": "user-1" } });
		emitOutput({ type: "message_started", piboSessionId: session.id, eventId: "m1", text: "hi" });
		signals.project({ type: "pibo_output", event: { type: "message_finished", piboSessionId: session.id, eventId: "m1" }, session });
		signals.project({ type: "session_processing_changed", piboSessionId: session.id, processing: false, queuedMessages: 0 });

		const response = await fetch(`${baseURL}/api/chat/navigation?piboSessionId=${session.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(findSessionNode(body.sessions, session.id)?.status, "idle");
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation treats session errors as acknowledged after marked read", async () => {
	const { channel, baseURL, sessions, signals, emitOutput } = await startSignalWebHost();
	try {
		const selected = createSession(sessions, "ps_navigation_error_selected");
		const failed = createSession(sessions, "ps_navigation_error_failed");
		for (const session of [selected, failed]) signals.project({ type: "session_created", session });

		const initial = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${selected.id}&markRead=true`, { headers: { "x-test-user": "user-1" } });
		assert.equal(initial.status, 200);

		emitOutput({ type: "session_error", piboSessionId: failed.id, eventId: "err1", error: "boom" });

		const unreadResponse = await fetch(`${baseURL}/api/chat/navigation?piboSessionId=${selected.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(unreadResponse.status, 200);
		const unreadBody = await unreadResponse.json();
		assert.equal(findSessionNode(unreadBody.sessions, failed.id)?.status, "error");
		assert.equal(findSessionNode(unreadBody.sessions, failed.id)?.unreadCount, 1);

		const readResponse = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(failed.id)}/read`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: "{}",
		});
		assert.equal(readResponse.status, 200);

		const readNavigation = await fetch(`${baseURL}/api/chat/navigation?piboSessionId=${selected.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(readNavigation.status, 200);
		const readBody = await readNavigation.json();
		assert.equal(findSessionNode(readBody.sessions, failed.id)?.status, "idle");
		assert.equal(findSessionNode(readBody.sessions, failed.id)?.unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation includes unread counts for completed messages in other sessions", async () => {
	const { channel, baseURL, sessions, signals, emitOutput } = await startSignalWebHost();
	try {
		const selected = createSession(sessions, "ps_navigation_selected");
		const other = createSession(sessions, "ps_navigation_unread_other");
		for (const session of [selected, other]) signals.project({ type: "session_created", session });

		const initial = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${selected.id}&markRead=true`, { headers: { "x-test-user": "user-1" } });
		assert.equal(initial.status, 200);

		emitOutput({ type: "message_started", piboSessionId: other.id, eventId: "m2", text: "hi" });
		emitOutput({ type: "assistant_message", piboSessionId: other.id, eventId: "m2", text: "answer" });
		emitOutput({ type: "message_finished", piboSessionId: other.id, eventId: "m2" });
		signals.project({ type: "session_processing_changed", piboSessionId: other.id, processing: false, queuedMessages: 0 });

		const response = await fetch(`${baseURL}/api/chat/navigation?piboSessionId=${selected.id}`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(findSessionNode(body.sessions, other.id)?.unreadCount, 1);
	} finally {
		await channel.stop?.();
	}
});

test("chat session model patch updates the live runtime before persisting", async () => {
	const calls = [];
	const { channel, baseURL, sessions } = await startSignalWebHost({
		async setLiveSessionActiveModel(id, model) {
			calls.push({ id, model });
			return model;
		},
	});
	try {
		const session = createSession(sessions, "ps_model_patch");
		const response = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "PATCH",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ activeModel: { provider: "openai-codex", id: "gpt-5.3-codex-spark" } }),
		});
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.deepEqual(calls, [{ id: session.id, model: { provider: "openai-codex", id: "gpt-5.3-codex-spark" } }]);
		assert.deepEqual(body.session.activeModel, { provider: "openai-codex", id: "gpt-5.3-codex-spark" });
		assert.deepEqual(sessions.get(session.id).activeModel, { provider: "openai-codex", id: "gpt-5.3-codex-spark" });
	} finally {
		await channel.stop?.();
	}
});

test("chat message emit failure is projected into session error signals", async () => {
	const { channel, baseURL, sessions, signals } = await startSignalWebHost({
		emit: async () => { throw new Error("No API key found for the selected model."); },
	});
	try {
		const session = createSession(sessions, "ps_emit_failure_signal");
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId: session.id, text: "hello" }),
		});
		assert.equal(response.status, 500);
		const snapshot = signals.snapshotTree(session.id).sessions[session.id];
		assert.equal(snapshot.localStatus, "error");
		assert.equal(snapshot.hasError, true);
		assert.equal(snapshot.isTreeActive, false);
		assert.equal(snapshot.queuedMessages, 0);
		assert.equal(snapshot.errors.some((error) => error.message.includes("No API key")), true);
	} finally {
		await channel.stop?.();
	}
});
