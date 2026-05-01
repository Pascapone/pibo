import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { PiboAuthError } from "../dist/auth/types.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function createFakeAuthService() {
	return {
		name: "fake-auth",
		async getSession(headers) {
			const userId = headers.get("x-test-user");
			if (!userId) return undefined;
			return {
				identity: {
					userId,
					email: `${userId}@example.test`,
					provider: "test",
				},
			};
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw new Error("Unauthenticated");
			return session;
		},
	};
}

async function startWebHostChannel(options = {}) {
	const emitted = [];
	const listeners = new Set();
	const sessions = new InMemoryPiboSessionStore();
	const storagePath = join(mkdtempSync(join(tmpdir(), "pibo-web-channel-")), "chat.sqlite");
	const channel = createWebHostChannel({ port: 0, announce: false });

	await channel.start({
		auth: options.auth,
		emit(event) {
			emitted.push(event);
			return Promise.resolve({
				type: event.type === "message" ? "message_queued" : "execution_result",
				piboSessionId: event.piboSessionId,
				eventId: event.id,
				queuedMessages: event.type === "message" ? 1 : undefined,
				text: event.type === "message" ? event.text : undefined,
				action: event.type === "execution" ? event.action : undefined,
				result: event.type === "execution" ? { ok: true } : undefined,
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSession(id) {
			return sessions.get(id);
		},
		createSession(input) {
			return sessions.create(input);
		},
		updateSession(id, input) {
			return sessions.update(id, input);
		},
		findSessions(input) {
			return sessions.find(input);
		},
		listSessions() {
			return sessions.list();
		},
		getGatewayActions() {
			return [];
		},
		getProfiles() {
			return options.profiles ?? [];
		},
		getWebApps() {
			return [createChatWebApp({ readModelPath: storagePath })];
		},
	});

	const address = channel.getAddress();
	assert.ok(address);
	return {
		channel,
		emitted,
		emitOutput(event) {
			for (const listener of listeners) listener(event);
		},
		sessions,
		baseURL: `http://${address.host}:${address.port}`,
	};
}

test("chat web app requires auth for localhost requests", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const response = await fetch(`${baseURL}/api/chat/session`);
		assert.equal(response.status, 401);
		assert.deepEqual(await response.json(), { error: "Unauthenticated" });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app maps authenticated users to chat sessions", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const accepted = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(accepted.status, 200);
		const session = await accepted.json();
		assert.equal(session.identity.userId, "user-1");
		assert.match(session.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(session.session.channel, "pibo.chat-web");
		assert.equal(session.session.kind, "chat");
		assert.equal(session.session.profile, "pibo-minimal");
		assert.equal(session.session.ownerScope, "user:user-1");

		const message = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "hello" }),
		});
		assert.equal(message.status, 200);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].piboSessionId, session.session.id);
		assert.equal(emitted[0].text, "hello");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates user-owned sessions", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		assert.match(payload.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(payload.session.ownerScope, "user:user-1");
		assert.equal(payload.session.parentId, undefined);

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		assert.equal(data.selectedPiboSessionId, payload.session.id);
		const createdNode = data.sessions.find((session) => session.piboSessionId === payload.session.id);
		assert.ok(createdNode);
		assert.equal(createdNode.parentId, undefined);

		const message = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ piboSessionId: payload.session.id, text: "hello new session" }),
		});
		assert.equal(message.status, 200);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].piboSessionId, payload.session.id);
		assert.equal(emitted[0].text, "hello new session");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app scopes bootstrap sessions to the selected room", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const defaultSession = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultSession.status, 200);
		const defaultPayload = await defaultSession.json();

		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Room Two" }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();

		const roomBootstrap = await fetch(
			`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(roomPayload.room.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(roomBootstrap.status, 200);
		const roomData = await roomBootstrap.json();
		assert.equal(roomData.selectedRoomId, roomPayload.room.id);
		assert.equal(roomData.sessions.length, 1);
		assert.notEqual(roomData.selectedPiboSessionId, defaultPayload.session.id);
		assert.equal(roomData.sessions[0].piboSessionId, roomData.selectedPiboSessionId);

		const defaultBootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultBootstrap.status, 200);
		const defaultData = await defaultBootstrap.json();
		assert.equal(defaultData.sessions.some((session) => session.piboSessionId === roomData.selectedPiboSessionId), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes unread room and session counts", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "turn-1",
			text: "new answer",
		});

		const unreadResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(unreadResponse.status, 200);
		const unreadData = await unreadResponse.json();
		assert.equal(unreadData.sessions[0].unreadCount, 1);
		assert.equal(unreadData.rooms[0].unreadCount, 1);

		const readResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=true&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(readResponse.status, 200);
		const readData = await readResponse.json();
		assert.equal(readData.sessions[0].unreadCount, undefined);
		assert.equal(readData.rooms[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app makes message sends idempotent by client transaction id", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const body = JSON.stringify({
			piboSessionId: sessionPayload.session.id,
			text: "retry me",
			clientTxnId: "txn-retry-1",
		});

		const first = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body,
		});
		assert.equal(first.status, 200);
		const second = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body,
		});
		assert.equal(second.status, 200);
		const duplicate = await second.json();

		assert.equal(emitted.length, 1);
		assert.equal(duplicate.duplicate, true);
		assert.equal(duplicate.event.clientTxnId, "txn-retry-1");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app replays durable SSE frames with stream cursors", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "run-1",
			text: "hello from history",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		for (let index = 0; index < 5 && !text.includes("TEXT_MESSAGE_END"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, /id: \d+:0/);
		assert.match(text, /id: \d+:1/);
		assert.match(text, /TEXT_MESSAGE_END/);
		assert.match(text, /hello from history/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates sessions with selected agent profiles", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{ name: "pibo-minimal", aliases: ["minimal"] },
			{ name: "pibo-run-yield-qa", aliases: ["yield-qa"] },
		],
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "yield-qa" }),
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		assert.equal(payload.session.profile, "pibo-run-yield-qa");

		const rejected = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "missing-profile" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), { error: 'Unknown profile "missing-profile"' });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app renames and archives owned sessions", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const created = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(created.status, 201);
		const payload = await created.json();

		const renamed = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ title: "Renamed Session" }),
		});
		assert.equal(renamed.status, 200);
		const renamedPayload = await renamed.json();
		assert.equal(renamedPayload.session.title, "Renamed Session");

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const bootstrapPayload = await bootstrap.json();
		assert.equal(
			bootstrapPayload.sessions.find((session) => session.piboSessionId === payload.session.id)?.title,
			"Renamed Session",
		);

		const archived = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);
		const archivedPayload = await archived.json();
		assert.equal(typeof archivedPayload.session.metadata.chatWebArchivedAt, "string");

		const defaultBootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultBootstrap.status, 200);
		const defaultPayload = await defaultBootstrap.json();
		assert.equal(defaultPayload.sessions.some((session) => session.piboSessionId === payload.session.id), false);

		const archivedBootstrap = await fetch(`${baseURL}/api/chat/bootstrap?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedBootstrap.status, 200);
		const archivedBootstrapPayload = await archivedBootstrap.json();
		const archivedNode = archivedBootstrapPayload.sessions.find((session) => session.piboSessionId === payload.session.id);
		assert.ok(archivedNode);
		assert.equal(archivedNode.archived, true);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app renders origin sessions as top-level sessions", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const root = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(root.status, 200);
		const rootPayload = await root.json();

		const origin = sessions.create({
			channel: "pibo.chat-web",
			kind: "branch",
			profile: "pibo-minimal",
			ownerScope: "user:user-1",
			originId: rootPayload.session.id,
		});

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		const originNode = data.sessions.find((session) => session.piboSessionId === origin.id);
		const rootNode = data.sessions.find((session) => session.piboSessionId === rootPayload.session.id);
		assert.ok(originNode);
		assert.ok(rootNode);
		assert.equal(originNode.parentId, undefined);
		assert.equal(rootNode.children.some((session) => session.piboSessionId === origin.id), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects authenticated users that auth marks forbidden", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: {
			name: "forbidden-auth",
			async getSession() {
				throw new PiboAuthError("Forbidden", 403);
			},
			async requireSession() {
				throw new PiboAuthError("Forbidden", 403);
			},
		},
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Forbidden" });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects cross-origin mutation requests", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "https://attacker.example",
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "hello" }),
		});
		assert.equal(response.status, 403);
		assert.deepEqual(await response.json(), { error: "Origin is not allowed" });
		assert.equal(emitted.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app accepts same-origin mutations behind a local reverse proxy", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://4788.192.168.0.204.sslip.io",
				"x-forwarded-host": "4788.192.168.0.204.sslip.io",
				"x-forwarded-proto": "http",
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "pibo-minimal" }),
		});
		assert.equal(response.status, 201);
		const payload = await response.json();
		assert.equal(payload.session.ownerScope, "user:user-1");
	} finally {
		await channel.stop?.();
	}
});

test("web host rejects oversized request bodies", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ text: "x".repeat(4 * 1024 * 1024) }),
		});
		assert.equal(response.status, 413);
		assert.deepEqual(await response.json(), { error: "Request body too large" });
	} finally {
		await channel.stop?.();
	}
});
