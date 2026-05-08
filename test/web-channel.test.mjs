import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { PiboAuthError } from "../dist/auth/types.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { upsertPiPackage } from "../dist/pi-packages/store.js";

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

async function withCwd(cwd, run) {
	const previous = process.cwd();
	process.chdir(cwd);
	try {
		return await run();
	} finally {
		process.chdir(previous);
	}
}

async function startWebHostChannel(options = {}) {
	const emitted = [];
	const listeners = new Set();
	const sessions = new InMemoryPiboSessionStore();
	let profiles = [...(options.profiles ?? [])];
	const storageDir = mkdtempSync(join(tmpdir(), "pibo-web-channel-"));
	const storagePath = join(storageDir, "chat.sqlite");
	const agentStorePath = join(storageDir, "agents.sqlite");
	const dataStorePath = join(storageDir, "pibo-chat-v2.sqlite");
	const dataPayloadRootDir = join(storageDir, "payloads");
	const channel = createWebHostChannel({ port: 0, announce: false, ...options.web });

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
		deleteSession(id) {
			return sessions.delete(id);
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
			return profiles;
		},
		getCapabilityCatalog() {
			return options.capabilityCatalog ?? {
				nativeTools: [],
				skills: [{ name: "pi-agent-harness", path: "skills/builtin/pi-agent-harness/SKILL.md", kind: "builtin" }],
				subagents: [],
				contextFiles: [],
				packages: [{ name: "pibo-run-control", description: "Run control", toolNames: ["pibo_run_start"] }],
				piboTools: [],
				mcpServers: [],
			};
		},
		upsertProfile(profile) {
			profiles = profiles.filter((item) => item.name !== profile.name);
			profiles.push({
				name: profile.name,
				description: profile.description,
				aliases: [...(profile.aliases ?? [])],
			});
		},
		removeProfile(name) {
			profiles = profiles.filter((item) => item.name !== name);
		},
		getWebApps() {
			return [createChatWebApp({
				readModelPath: storagePath,
				eventLogPath: storagePath,
				roomStorePath: storagePath,
				agentStorePath,
				dataStorePath: options.dataV2Write ? dataStorePath : undefined,
				dataPayloadRootDir,
				dataV2Write: options.dataV2Write,
			})];
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
		storageDir,
		dataStorePath,
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

test("chat web app serves the React shell for deep app links", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const response = await fetch(`${baseURL}/apps/chat/rooms/room_test/sessions/ps_test`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
		assert.match(await response.text(), /<div id="root"><\/div>/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app serves built assets with immutable cache and compression headers", async () => {
	const { channel, baseURL } = await startWebHostChannel();

	try {
		const shell = await fetch(`${baseURL}/apps/chat`);
		assert.equal(shell.status, 200);
		const html = await shell.text();
		const assetPath = html.match(/\/apps\/chat\/assets\/[^"]+\.js/)?.[0];
		assert.ok(assetPath);

		const asset = await fetch(`${baseURL}${assetPath}`, {
			method: "HEAD",
			headers: { "accept-encoding": "br, gzip" },
		});
		assert.equal(asset.status, 200);
		assert.match(asset.headers.get("content-type") ?? "", /^text\/javascript/);
		assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
		assert.equal(asset.headers.get("content-encoding"), "br");
		assert.equal(asset.headers.get("vary"), "accept-encoding");
	} finally {
		await channel.stop?.();
	}
});

test("web host redirects app links to the canonical auth origin", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		web: { canonicalBaseURL: "http://pibo.example.test:4788" },
	});

	try {
		const response = await fetch(`${baseURL}/apps/chat/settings`, { redirect: "manual" });
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("location"), "http://pibo.example.test:4788/apps/chat/settings");
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace returns raw events only when requested", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		for (let index = 0; index < 3; index += 1) {
			emitOutput({
				type: "assistant_delta",
				piboSessionId: sessionPayload.session.id,
				eventId: `answer-${index}`,
				text: `part ${index}`,
			});
		}

		const compactResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(compactResponse.status, 200);
		assert.ok(compactResponse.headers.get("etag"));
		const compactTrace = await compactResponse.json();
		assert.equal(typeof compactTrace.version, "string");
		assert.equal(compactTrace.rawEvents.length, 0);

		const cachedResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": compactResponse.headers.get("etag"),
				},
			},
		);
		assert.equal(cachedResponse.status, 304);

		const rawResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true&rawEventsLimit=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(rawResponse.status, 200);
		const rawTrace = await rawResponse.json();
		assert.equal(rawTrace.rawEvents.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace returns fresh payload when a known trace version changes", async () => {
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
			eventId: "answer-1",
			text: "first",
		});

		const first = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(first.status, 200);
		const firstEtag = first.headers.get("etag");
		const firstVersion = first.headers.get("x-pibo-trace-version");
		assert.ok(firstEtag);
		assert.ok(firstVersion);

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "answer-2",
			text: "second",
		});

		const changed = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": firstEtag,
				},
			},
		);
		assert.equal(changed.status, 200);
		assert.notEqual(changed.headers.get("etag"), firstEtag);
		assert.notEqual(changed.headers.get("x-pibo-trace-version"), firstVersion);
		const changedTrace = await changed.json();
		assert.match(JSON.stringify(changedTrace.nodes), /second/);
	} finally {
		await channel.stop?.();
	}
});

test("chat bootstrap includes model catalog data", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.ok(payload.modelCatalog);
		assert.ok(Array.isArray(payload.modelCatalog.providers));
		const provider = payload.modelCatalog.providers[0];
		assert.equal(typeof provider?.id, "string");
		assert.equal(typeof provider?.label, "string");
		assert.equal(typeof provider?.authConfigured, "boolean");
		assert.ok(Array.isArray(provider?.models));
	} finally {
		await channel.stop?.();
	}
});

test("chat navigation returns sidebar data without catalog payload", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/navigation`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("server-timing") ?? "", /navigation/);
		const payload = await response.json();
		assert.equal(payload.identity.userId, "user-1");
		assert.match(payload.session.id, /^ps_[0-9a-f-]{36}$/);
		assert.equal(payload.selectedPiboSessionId, payload.session.id);
		assert.equal(typeof payload.selectedRoomId, "string");
		assert.ok(Array.isArray(payload.rooms));
		assert.ok(Array.isArray(payload.sessions));
		assert.equal(Object.hasOwn(payload, "agents"), false);
		assert.equal(Object.hasOwn(payload, "customAgents"), false);
		assert.equal(Object.hasOwn(payload, "modelCatalog"), false);
		assert.equal(Object.hasOwn(payload, "agentCatalog"), false);
		assert.equal(Object.hasOwn(payload, "capabilities"), false);
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
		assert.equal(session.session.profile, "codex-compat-openai-web");
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
		assert.equal(payload.session.workspace, homedir());

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

test("chat web app starts new room sessions in the room workspace", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const roomWorkspace = mkdtempSync(join(tmpdir(), "pibo-room-workspace-"));
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Workspace Room", workspace: roomWorkspace }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();
		assert.equal(roomPayload.room.workspace, roomWorkspace);

		const sessionResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: roomPayload.room.id }),
		});
		assert.equal(sessionResponse.status, 201);
		const sessionPayload = await sessionResponse.json();
		assert.equal(sessionPayload.session.workspace, roomWorkspace);
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

test("chat web app keeps the personal room locked", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const room = sessionPayload.room;

		const patchResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Renamed Personal Chat" }),
		});
		assert.equal(patchResponse.status, 400);

		const archiveResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archiveResponse.status, 400);

		const deleteResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteResponse.status, 400);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app archives and deletes rooms with contained session subtrees", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const roomResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ name: "Project Room" }),
		});
		assert.equal(roomResponse.status, 201);
		const roomPayload = await roomResponse.json();
		const room = roomPayload.room;

		const sessionResponse = await fetch(`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const child = sessions.create({
			channel: "pibo.subagents",
			kind: "subagent",
			profile: parent.profile,
			ownerScope: parent.ownerScope,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteBeforeArchive.status, 400);

		const archiveResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(typeof archivePayload.room.metadata.chatRoomArchivedAt, "string");

		const archivedBootstrap = await fetch(
			`${baseURL}/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(parent.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(archivedBootstrap.status, 200);
		const archivedBootstrapPayload = await archivedBootstrap.json();
		assert.equal(archivedBootstrapPayload.selectedRoomId, room.id);
		assert.equal(archivedBootstrapPayload.selectedPiboSessionId, parent.id);
		assert.equal(
			archivedBootstrapPayload.sessions.some((session) => session.piboSessionId === parent.id),
			true,
		);

		const createInArchivedRoom = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: room.id }),
		});
		assert.equal(createInArchivedRoom.status, 403);

		const messageInArchivedRoom = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				roomId: room.id,
				piboSessionId: parent.id,
				text: "Should stay read-only",
				clientTxnId: "archived-room-message",
			}),
		});
		assert.equal(messageInArchivedRoom.status, 403);

		const deleteResponse = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: room.name }),
		});
		assert.equal(deleteResponse.status, 200);
		const deletePayload = await deleteResponse.json();
		assert.deepEqual(new Set(deletePayload.deletedSessionIds), new Set([parent.id, child.id]));
		assert.equal(sessions.get(parent.id), undefined);
		assert.equal(sessions.get(child.id), undefined);

		const roomsResponse = await fetch(`${baseURL}/api/chat/rooms`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(roomsResponse.status, 200);
		const roomsPayload = await roomsResponse.json();
		assert.equal(roomsPayload.rooms.some((item) => item.id === room.id), false);
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
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "turn-1",
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

test("chat web app marks only the selected session read during bootstrap", async () => {
	const { channel, baseURL, emitOutput, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const room = sessionPayload.room;
		const child = sessions.create({
			channel: parent.channel,
			kind: parent.kind,
			profile: parent.profile,
			ownerScope: parent.ownerScope,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "child-turn-1",
			text: "child answer one",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "child-turn-1",
		});
		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "child-turn-2",
			text: "child answer two",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "child-turn-2",
		});

		const unreadResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(unreadResponse.status, 200);
		const unreadData = await unreadResponse.json();
		assert.equal(unreadData.rooms[0].unreadCount, 2);
		assert.equal(unreadData.sessions[0].children[0].unreadCount, 2);

		const readResponse = await fetch(
			`${baseURL}/api/chat/bootstrap?markRead=true&roomId=${encodeURIComponent(room.id)}`,
			{
				headers: { "x-test-user": "user-1" },
			},
		);
		assert.equal(readResponse.status, 200);
		const readData = await readResponse.json();
		assert.equal(readData.rooms[0].unreadCount, 2);
		assert.equal(readData.sessions[0].children[0].unreadCount, 2);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app keeps active session completions read while preserving unfocused unread", async () => {
	const { channel, baseURL, emitOutput, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const parent = sessionPayload.session;
		const room = sessionPayload.room;
		const child = sessions.create({
			channel: parent.channel,
			kind: parent.kind,
			profile: parent.profile,
			ownerScope: parent.ownerScope,
			parentId: parent.id,
			metadata: { chatRoomId: room.id },
		});

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(parent.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_message",
			piboSessionId: parent.id,
			eventId: "active-turn",
			text: "visible answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: parent.id,
			eventId: "active-turn",
		});

		let bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		let bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, undefined);
		assert.equal(bootstrap.sessions[0].unreadCount, undefined);

		emitOutput({
			type: "assistant_message",
			piboSessionId: child.id,
			eventId: "unfocused-turn",
			text: "background answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: child.id,
			eventId: "unfocused-turn",
		});

		bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(parent.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, 1);
		assert.equal(bootstrap.sessions[0].children[0].unreadCount, 1);

		controller.abort();
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

test("chat web app shadows user messages into the V2 data store", async () => {
	const { channel, baseURL, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		dataV2Write: true,
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const body = JSON.stringify({
			piboSessionId: sessionPayload.session.id,
			text: "shadow me",
			clientTxnId: "txn-shadow-1",
		});

		for (let index = 0; index < 2; index += 1) {
			const response = await fetch(`${baseURL}/api/chat/message`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body,
			});
			assert.equal(response.status, 200);
		}

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const eventCount = db.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(sessionPayload.session.id).count;
			const messageCount = db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?").get(sessionPayload.session.id).count;
			const message = db.prepare("SELECT * FROM chat_messages WHERE session_id = ?").get(sessionPayload.session.id);
			const navigation = db.prepare("SELECT * FROM session_navigation WHERE session_id = ?").get(sessionPayload.session.id);
			assert.equal(eventCount, 1);
			assert.equal(messageCount, 1);
			assert.equal(message.content_preview, "shadow me");
			assert.equal(JSON.parse(message.attributes_json).inlineText, "shadow me");
			assert.equal(navigation.last_message_preview, "shadow me");
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app shadows assistant and tool output into the V2 data store", async () => {
	const { channel, baseURL, emitOutput, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		dataV2Write: true,
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		for (let index = 0; index < 2; index += 1) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: sessionPayload.session.id,
				eventId: "shadow-run-1",
				text: "assistant v2 shadow",
			});
		}
		emitOutput({
			type: "tool_execution_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "shadow-run-1",
			toolCallId: "tool-shadow-1",
			toolName: "read",
			result: { ok: true },
			isError: false,
		});

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const eventRows = db.prepare("SELECT type FROM event_log WHERE session_id = ? ORDER BY stream_id ASC").all(sessionPayload.session.id);
			const messageRows = db.prepare("SELECT role, content_preview FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC").all(sessionPayload.session.id);
			const observationRows = db.prepare("SELECT kind, name, status FROM observations WHERE session_id = ? ORDER BY sequence ASC").all(sessionPayload.session.id);
			assert.deepEqual(eventRows.map((row) => row.type), ["assistant_message", "tool_execution_finished"]);
			assert.deepEqual(messageRows.map((row) => ({ role: row.role, content_preview: row.content_preview })), [{ role: "assistant", content_preview: "assistant v2 shadow" }]);
			assert.deepEqual(observationRows.map((row) => row.kind), ["message", "tool"]);
			assert.equal(observationRows[1].name, "read");
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app marks a selected session read through the read endpoint", async () => {
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
			eventId: "read-run-1",
			text: "read me",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "read-run-1",
		});

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let payload = await bootstrap.json();
		assert.equal(payload.sessions[0].unreadCount, 1);

		const marked = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(sessionPayload.session.id)}/read`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(marked.status, 200);
		assert.deepEqual(await marked.json(), { ok: true, piboSessionId: sessionPayload.session.id });

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		payload = await bootstrap.json();
		assert.equal(payload.sessions[0].unreadCount, undefined);
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

test("chat web app trace exposes an SSE cursor that skips replayed history", async () => {
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
			text: "old before cursor",
		});

		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.equal(typeof trace.latestStreamId, "number");

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=${trace.latestStreamId}:999999`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		text += decoder.decode((await reader.read()).value, { stream: true });

		emitOutput({
			type: "assistant_message",
			piboSessionId: sessionPayload.session.id,
			eventId: "run-2",
			text: "new after cursor",
		});
		for (let index = 0; index < 6 && !text.includes("new after cursor"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.doesNotMatch(text, /old before cursor/);
		assert.match(text, /new after cursor/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app room SSE frames include unfocused session ids", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		const secondResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ roomId: bootstrap.selectedRoomId }),
		});
		assert.equal(secondResponse.status, 201);
		const secondPayload = await secondResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: secondPayload.session.id,
			eventId: "unfocused-answer",
			text: "hello while unfocused",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(response.status, 200);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		for (let index = 0; index < 8 && !text.includes("hello while unfocused"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, new RegExp(`"piboSessionId":"${secondPayload.session.id}"`));
		assert.match(text, /hello while unfocused/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates sessions with selected agent profiles", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{ name: "codex-compat-openai-web", aliases: ["codex"] },
			{ name: "pibo-kimi-coding", aliases: ["kimi"] },
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
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(created.status, 201);
		const payload = await created.json();
		assert.equal(payload.session.profile, "codex-compat-openai-web");

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

test("chat web app creates custom agents from the native capability catalog", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalog.status, 200);
		const catalogPayload = await catalog.json();
		assert.deepEqual(catalogPayload.catalog.nativeTools.map((tool) => tool.name), []);

		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "research-agent",
				description: "Uses native catalog entries only.",
				nativeTools: [],
				skills: ["pi-agent-harness"],
				builtinToolNames: ["read", "bash"],
				autoContextFiles: false,
				runControl: true,
				subagents: [{ name: "helper", targetProfile: "codex-compat-openai-web" }],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();
		assert.equal(agentPayload.agent.profileName, "research-agent");
		assert.equal(agentPayload.agent.displayName, "research-agent");
		assert.deepEqual(agentPayload.agent.nativeTools, []);
		assert.deepEqual(agentPayload.agent.builtinToolNames, ["read", "bash"]);
		assert.equal(agentPayload.agent.autoContextFiles, false);
		assert.equal(agentPayload.agent.runControl, true);

		const session = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: agentPayload.agent.profileName }),
		});
		assert.equal(session.status, 201);
		const sessionPayload = await session.json();
		assert.equal(sessionPayload.session.profile, agentPayload.agent.profileName);

		const listed = await fetch(`${baseURL}/api/chat/agents`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(listed.status, 200);
		const listedPayload = await listed.json();
		assert.deepEqual(listedPayload.agents.map((agent) => agent.displayName), ["research-agent"]);
		assert.equal(listedPayload.agents[0].autoContextFiles, false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app surfaces broken custom agent context files and allows cleanup", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		capabilityCatalog: {
			nativeTools: [],
			skills: [{ name: "pi-agent-harness", path: "skills/builtin/pi-agent-harness/SKILL.md", kind: "builtin" }],
			subagents: [],
			contextFiles: [{
				key: "ctx:git-projekt",
				label: "Git Projekt",
				path: ".pibo/context/git-projekt.md",
				source: "managed",
				scope: "global",
			}],
			packages: [{ name: "pibo-run-control", description: "Run control", toolNames: ["pibo_run_start"] }],
			piboTools: [],
			mcpServers: [],
		},
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "broken-context-agent",
				contextFiles: ["ctx:git-projekt", "ctx:pibo-docker-development"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();
		assert.deepEqual(createdPayload.agent.brokenContextFiles, ["ctx:pibo-docker-development"]);

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const bootstrapPayload = await bootstrap.json();
		assert.deepEqual(bootstrapPayload.customAgents[0].brokenContextFiles, ["ctx:pibo-docker-development"]);

		const patchedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				contextFiles: ["ctx:git-projekt"],
			}),
		});
		assert.equal(patchedAgent.status, 200);
		const patchedPayload = await patchedAgent.json();
		assert.deepEqual(patchedPayload.agent.brokenContextFiles, []);
		assert.deepEqual(patchedPayload.agent.contextFiles, ["ctx:git-projekt"]);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app manages Pi package registrations and custom agent selections", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-web-pi-packages-"));
	const packageDir = join(cwd, "local-package");
	mkdirSync(join(packageDir, "skills"), { recursive: true });
	writeFileSync(join(packageDir, "skills", "demo.md"), "# Demo\n", "utf-8");
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({
		name: "local-web-package",
		pi: { skills: ["skills/*.md"] },
	}), "utf-8");

	await withCwd(cwd, async () => {
		upsertPiPackage({
			id: "local-web-package",
			name: "local-web-package",
			source: packageDir,
			installSpec: packageDir,
			resourceTypes: ["skill"],
			skillNames: ["demo"],
			installStatus: "installed",
			installPath: packageDir,
			enabled: true,
			diagnostics: [],
		}, cwd);
		const { channel, baseURL } = await startWebHostChannel({
			auth: createFakeAuthService(),
			profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
		});

		try {
			const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
				headers: { "x-test-user": "user-1" },
			});
			assert.equal(catalog.status, 200);
			const catalogPayload = await catalog.json();
			assert.equal(catalogPayload.catalog.piPackages[0].id, "local-web-package");
			assert.equal(catalogPayload.catalog.piPackages[0].enabled, true);

			const disabled = await fetch(`${baseURL}/api/chat/pi-packages/${encodeURIComponent("local-web-package")}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ enabled: false }),
			});
			assert.equal(disabled.status, 200);
			const disabledPayload = await disabled.json();
			assert.equal(disabledPayload.package.enabled, false);

			const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({
					displayName: "package-agent",
					piPackages: ["local-web-package"],
				}),
			});
			assert.equal(createdAgent.status, 201);
			const agentPayload = await createdAgent.json();
			assert.deepEqual(agentPayload.agent.piPackages, ["local-web-package"]);

			const blockedDelete = await fetch(`${baseURL}/api/chat/pi-packages/${encodeURIComponent("local-web-package")}`, {
				method: "DELETE",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: "{}",
			});
			assert.equal(blockedDelete.status, 409);
			assert.match((await blockedDelete.json()).error, /package-agent/);
		} finally {
			await channel.stop?.();
		}
	});
});

test("chat web app rejects non-pi.dev package sources from browser adds", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const rejected = await fetch(`${baseURL}/api/chat/pi-packages`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ source: "/tmp/local-package" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), {
			error: "Pi package source must be a https://pi.dev/packages/... URL",
		});
	} finally {
		await channel.stop?.();
	}
});

test("chat web app exposes and updates MCP server descriptions", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-web-mcp-"));
	const configPath = join(cwd, "mcp_servers.json");
	writeFileSync(configPath, `${JSON.stringify({
		mcpServers: {
			filesystem: {
				command: "node",
				args: ["server.js"],
			},
		},
	}, null, 2)}\n`);
	const previousConfigPath = process.env.MCP_CONFIG_PATH;
	process.env.MCP_CONFIG_PATH = configPath;

	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const catalog = await fetch(`${baseURL}/api/chat/agent-catalog`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalog.status, 200);
		const catalogPayload = await catalog.json();
		assert.deepEqual(catalogPayload.catalog.mcpServers, [
			{
				name: "filesystem",
				transport: "stdio",
				hasDescription: false,
				editable: true,
			},
		]);

		const patched = await fetch(`${baseURL}/api/chat/mcp-servers/filesystem/description`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ description: "Access project files through MCP." }),
		});
		assert.equal(patched.status, 200);
		const patchedPayload = await patched.json();
		assert.equal(patchedPayload.server.descriptionSource, "user");

		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		assert.deepEqual(config.mcpServers.filesystem, {
			command: "node",
			args: ["server.js"],
			pibo: {
				description: "Access project files through MCP.",
				descriptionSource: "user",
			},
		});

		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				displayName: "mcp-agent",
				mcpServers: ["filesystem"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();
		assert.deepEqual(agentPayload.agent.mcpServers, ["filesystem"]);
	} finally {
		await channel.stop?.();
		if (previousConfigPath === undefined) {
			delete process.env.MCP_CONFIG_PATH;
		} else {
			process.env.MCP_CONFIG_PATH = previousConfigPath;
		}
	}
});

test("chat web app archives and permanently deletes custom agents with their sessions", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const createdAgent = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "delete-agent" }),
		});
		assert.equal(createdAgent.status, 201);
		const agentPayload = await createdAgent.json();

		const createdSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "delete-agent" }),
		});
		assert.equal(createdSession.status, 201);
		const sessionPayload = await createdSession.json();
		const childSession = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "codex-compat-openai-web",
			ownerScope: "user:user-1",
			parentId: sessionPayload.session.id,
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "delete-agent" }),
		});
		assert.equal(deleteBeforeArchive.status, 400);
		assert.deepEqual(await deleteBeforeArchive.json(), { error: "Archive the agent before permanently deleting it." });

		const archived = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
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
		assert.equal(typeof archivedPayload.agent.archivedAt, "string");

		const listed = await fetch(`${baseURL}/api/chat/agents`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual((await listed.json()).agents, []);
		const listedArchived = await fetch(`${baseURL}/api/chat/agents?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.deepEqual((await listedArchived.json()).agents.map((agent) => agent.profileName), ["delete-agent"]);

		const rejectedSession = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "delete-agent" }),
		});
		assert.equal(rejectedSession.status, 400);
		assert.deepEqual(await rejectedSession.json(), { error: 'Unknown profile "delete-agent"' });

		const wrongConfirm = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "wrong-agent" }),
		});
		assert.equal(wrongConfirm.status, 400);
		assert.deepEqual(await wrongConfirm.json(), {
			error: 'Type "delete-agent" to permanently delete this agent and its sessions.',
		});

		const deleted = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(agentPayload.agent.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmName: "delete-agent" }),
		});
		assert.equal(deleted.status, 200);
		const deletedPayload = await deleted.json();
		assert.deepEqual(new Set(deletedPayload.deletedSessionIds), new Set([sessionPayload.session.id, childSession.id]));
		assert.equal(sessions.get(sessionPayload.session.id), undefined);
		assert.equal(sessions.get(childSession.id), undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app validates custom agent profile names", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "codex-compat-openai-web", aliases: ["codex"] }],
	});

	try {
		const invalid = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "Test Agent" }),
		});
		assert.equal(invalid.status, 400);
		assert.deepEqual(await invalid.json(), { error: "Agent name must be lowercase kebab-case, for example test-agent" });

		const conflicting = await fetch(`${baseURL}/api/chat/agents`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ displayName: "codex-compat-openai-web" }),
		});
		assert.equal(conflicting.status, 400);
		assert.deepEqual(await conflicting.json(), { error: 'Agent name "codex-compat-openai-web" conflicts with an existing profile' });
	} finally {
		await channel.stop?.();
	}
});

test("chat web app canonicalizes legacy custom agent session profile aliases", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{
				name: "test-agent",
				aliases: ["agent_02d60a56-9bd4-4606-921b-495e3daf69d8", "custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8"],
			},
		],
	});

	try {
		const legacySession = sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "custom-agent:agent_02d60a56-9bd4-4606-921b-495e3daf69d8",
			ownerScope: "user:user-1",
		});
		const response = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(legacySession.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload.session.profile, "test-agent");
		assert.equal(sessions.get(legacySession.id).profile, "test-agent");
		assert.equal(payload.sessions.find((session) => session.piboSessionId === legacySession.id).profile, "test-agent");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app archives sessions as read and excludes them from room unread counts", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const payload = await sessionResponse.json();

		emitOutput({
			type: "assistant_message",
			piboSessionId: payload.session.id,
			eventId: "archive-unread-turn",
			text: "archive me",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: payload.session.id,
			eventId: "archive-unread-turn",
		});

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, 1);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, 1);

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

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&includeArchived=true&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, undefined);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, undefined);

		const restored = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: false }),
		});
		assert.equal(restored.status, 200);

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(payload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		bootstrapPayload = await bootstrap.json();
		assert.equal(bootstrapPayload.rooms[0].unreadCount, undefined);
		assert.equal(bootstrapPayload.sessions[0].unreadCount, undefined);
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

test("chat web app changes session profiles only before the first trace event", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [
			{ name: "codex-compat-openai-web", aliases: ["codex"] },
			{ name: "pibo-kimi-coding", aliases: ["kimi"] },
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
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(created.status, 201);
		const payload = await created.json();

		const changed = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "kimi" }),
		});
		assert.equal(changed.status, 200);
		const changedPayload = await changed.json();
		assert.equal(changedPayload.session.profile, "pibo-kimi-coding");

		emitOutput({
			type: "assistant_message",
			piboSessionId: payload.session.id,
			eventId: "trace-start",
			text: "started",
		});

		const rejected = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ profile: "codex" }),
		});
		assert.equal(rejected.status, 400);
		assert.deepEqual(await rejected.json(), {
			error: "Session profile can only be changed before the first message.",
		});
	} finally {
		await channel.stop?.();
	}
});

test("chat web app permanently deletes archived sessions with their child sessions", async () => {
	const { channel, baseURL, sessions } = await startWebHostChannel({
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
		const childSession = sessions.create({
			channel: "pibo.chat-web",
			kind: "subagent",
			profile: "codex-compat-openai-web",
			ownerScope: "user:user-1",
			parentId: payload.session.id,
		});

		const deleteBeforeArchive = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "Delete this session" }),
		});
		assert.equal(deleteBeforeArchive.status, 400);
		assert.deepEqual(await deleteBeforeArchive.json(), { error: "Archive the session before permanently deleting it." });

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

		const wrongConfirm = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "delete" }),
		});
		assert.equal(wrongConfirm.status, 400);
		assert.deepEqual(await wrongConfirm.json(), {
			error: 'Type "Delete this session" to permanently delete this session.',
		});

		const deleted = await fetch(`${baseURL}/api/chat/sessions/${encodeURIComponent(payload.session.id)}`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ confirmText: "Delete this session" }),
		});
		assert.equal(deleted.status, 200);
		const deletedPayload = await deleted.json();
		assert.deepEqual(new Set(deletedPayload.deletedSessionIds), new Set([payload.session.id, childSession.id]));
		assert.equal(sessions.get(payload.session.id), undefined);
		assert.equal(sessions.get(childSession.id), undefined);
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
			profile: "codex-compat-openai-web",
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
			body: JSON.stringify({ profile: "codex-compat-openai-web" }),
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
