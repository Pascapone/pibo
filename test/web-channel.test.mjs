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
	const agentStorePath = join(storageDir, "agents.sqlite");
	const dataStorePath = join(storageDir, "pibo-chat-v2.sqlite");
	const dataPayloadRootDir = join(storageDir, "payloads");
	const projectStorePath = join(storageDir, "projects.sqlite");
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
				agentStorePath,
				dataStorePath,
				dataPayloadRootDir,
				projectStorePath,
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

test("chat web trace supports cursor pages", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		for (let index = 1; index <= 5; index += 1) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: sessionPayload.session.id,
				eventId: `answer-${index}`,
				text: `message ${index}`,
			});
		}

		const tailResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&pageSize=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(tailResponse.status, 200);
		const tail = await tailResponse.json();
		assert.equal(tail.pageSize, 2);
		assert.equal(tail.firstEventSequence, 4);
		assert.equal(tail.lastEventSequence, 5);
		assert.equal(tail.nextBeforeSequence, 4);
		assert.equal(tail.hasOlderEvents, true);

		const olderResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&pageSize=2&beforeSequence=${tail.nextBeforeSequence}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(olderResponse.status, 200);
		const older = await olderResponse.json();
		assert.equal(older.beforeSequence, 4);
		assert.equal(older.firstEventSequence, 2);
		assert.equal(older.lastEventSequence, 3);
		assert.equal(older.nextBeforeSequence, 2);
		assert.equal(older.hasOlderEvents, true);
	} finally {
		await channel.stop?.();
	}
});

test("chat web sessions supports cursor pages", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		for (let index = 0; index < 3; index += 1) {
			const created = await fetch(`${baseURL}/api/chat/sessions`, {
				method: "POST",
				headers: { "x-test-user": "user-1", "content-type": "application/json", origin: baseURL },
				body: JSON.stringify({ roomId: bootstrap.selectedRoomId }),
			});
			assert.equal(created.status, 201);
		}

		const firstResponse = await fetch(
			`${baseURL}/api/chat/sessions?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&limit=2`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(firstResponse.status, 200);
		const first = await firstResponse.json();
		assert.equal(first.roomId, bootstrap.selectedRoomId);
		assert.equal(first.archived, false);
		assert.equal(first.sessions.length, 2);
		assert.equal(typeof first.nextCursor, "string");
		assert.equal(first.totalCount >= 3, true);
		assert.equal(typeof first.version, "string");

		const secondResponse = await fetch(
			`${baseURL}/api/chat/sessions?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(secondResponse.status, 200);
		const second = await secondResponse.json();
		assert.equal(second.sessions.some((session) => session.piboSessionId === first.sessions[0].piboSessionId), false);
	} finally {
		await channel.stop?.();
	}
});

test("chat web trace summary is small and cacheable", async () => {
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
			type: "text_message",
			piboSessionId: sessionPayload.session.id,
			text: "hello",
		});

		const response = await fetch(
			`${baseURL}/api/chat/trace/summary?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(response.status, 200);
		assert.ok(response.headers.get("etag"));
		const summary = await response.json();
		assert.equal(summary.piboSessionId, sessionPayload.session.id);
		assert.equal(typeof summary.version, "string");
		assert.equal(typeof summary.eventCount, "number");
		assert.equal("nodes" in summary, false);
		assert.equal("rawEvents" in summary, false);

		const cachedResponse = await fetch(
			`${baseURL}/api/chat/trace/summary?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{
				headers: {
					"x-test-user": "user-1",
					"if-none-match": response.headers.get("etag"),
				},
			},
		);
		assert.equal(cachedResponse.status, 304);
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

test("chat web app default data path runs without creating the legacy web-chat store", async () => {
	const { channel, baseURL, dataStorePath, storageDir } = await startWebHostChannel({ auth: createFakeAuthService() });

	try {
		const createResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-v2", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({}),
		});
		assert.equal(createResponse.status, 201);
		const created = await createResponse.json();
		const piboSessionId = created.session.id;
		assert.ok(piboSessionId);

		const messageResponse = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: { "x-test-user": "user-v2", "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ piboSessionId, text: "hello v2", clientTxnId: "txn-v2" }),
		});
		assert.equal(messageResponse.status, 200);

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?piboSessionId=${encodeURIComponent(piboSessionId)}`, {
			headers: { "x-test-user": "user-v2" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.selectedPiboSessionId, piboSessionId);
		assert.ok(bootstrap.sessions.length > 0);

		const v2 = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const events = v2.prepare("SELECT COUNT(*) AS count FROM event_log WHERE session_id = ?").get(piboSessionId);
			assert.ok(Number(events.count) > 0);
		} finally {
			v2.close();
		}

		assert.throws(() => new DatabaseSync(join(storageDir, "chat.sqlite"), { readOnly: true }));
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

test("chat web app marks the selected session subtree read during bootstrap", async () => {
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
		assert.equal(readData.rooms[0].unreadCount, undefined);
		assert.equal(readData.sessions[0].children[0].unreadCount, undefined);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app room event streams do not mark assistant messages read", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();
		const session = sessionPayload.session;
		const room = sessionPayload.room;

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&since=0`,
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
			piboSessionId: session.id,
			eventId: "room-stream-turn",
			text: "background answer",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: session.id,
			eventId: "room-stream-turn",
		});

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await bootstrapResponse.json();
		assert.equal(bootstrap.rooms[0].unreadCount, 1);
		assert.equal(bootstrap.sessions[0].unreadCount, 1);

		controller.abort();
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

test("chat web app writes user messages into the V2 data store", async () => {
	const { channel, baseURL, dataStorePath } = await startWebHostChannel({
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
			text: "persist me",
			clientTxnId: "txn-persist-1",
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
			assert.equal(message.content_preview, "persist me");
			assert.equal(JSON.parse(message.attributes_json).inlineText, "persist me");
			assert.equal(navigation.last_message_preview, "persist me");
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("chat web app writes assistant and tool output into the V2 data store", async () => {
	const { channel, baseURL, emitOutput, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
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
				eventId: "persist-run-1",
				text: "assistant v2 persist",
			});
		}
		emitOutput({
			type: "tool_execution_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "persist-run-1",
			toolCallId: "tool-persist-1",
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
			assert.deepEqual(messageRows.map((row) => ({ role: row.role, content_preview: row.content_preview })), [{ role: "assistant", content_preview: "assistant v2 persist" }]);
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

test("chat web app marks all room sessions read through the room read endpoint", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const firstResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(firstResponse.status, 200);
		const firstPayload = await firstResponse.json();
		const room = firstPayload.room;

		const secondResponse = await fetch(`${baseURL}/api/chat/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ roomId: room.id }),
		});
		assert.equal(secondResponse.status, 201);
		const secondPayload = await secondResponse.json();

		for (const [session, eventId] of [[firstPayload.session, "room-read-all-1"], [secondPayload.session, "room-read-all-2"]]) {
			emitOutput({
				type: "assistant_message",
				piboSessionId: session.id,
				eventId,
				text: `answer for ${session.id}`,
			});
			emitOutput({
				type: "message_finished",
				piboSessionId: session.id,
				eventId,
			});
		}

		let bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(firstPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		let payload = await bootstrap.json();
		assert.equal(payload.rooms[0].unreadCount, 2);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === firstPayload.session.id)?.unreadCount, 1);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === secondPayload.session.id)?.unreadCount, 1);

		const marked = await fetch(`${baseURL}/api/chat/rooms/${encodeURIComponent(room.id)}/read`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: "{}",
		});
		assert.equal(marked.status, 200);
		const markedPayload = await marked.json();
		assert.equal(markedPayload.ok, true);
		assert.equal(markedPayload.roomId, room.id);
		assert.deepEqual(new Set(markedPayload.readSessionIds), new Set([firstPayload.session.id, secondPayload.session.id]));

		bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?markRead=false&roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(firstPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		payload = await bootstrap.json();
		assert.equal(payload.rooms[0].unreadCount, undefined);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === firstPayload.session.id)?.unreadCount, undefined);
		assert.equal(payload.sessions.find((session) => session.piboSessionId === secondPayload.session.id)?.unreadCount, undefined);
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
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&since=0`,
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

test("chat web app scopes room-authenticated session SSE to the selected session", async () => {
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
			piboSessionId: sessionPayload.session.id,
			eventId: "focused-before-cursor",
			text: "focused before cursor",
		});
		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.equal(typeof trace.latestStreamId, "number");

		emitOutput({
			type: "assistant_message",
			piboSessionId: secondPayload.session.id,
			eventId: "unfocused-after-cursor",
			text: "unfocused after selected cursor",
		});

		const controller = new AbortController();
		const response = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(bootstrap.selectedRoomId)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&since=${trace.latestStreamId}:999999`,
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
			eventId: "focused-after-cursor",
			text: "focused after cursor",
		});
		for (let index = 0; index < 8 && !text.includes("focused after cursor"); index += 1) {
			const chunk = await reader.read();
			assert.equal(chunk.done, false);
			text += decoder.decode(chunk.value, { stream: true });
		}
		controller.abort();

		assert.match(text, /focused after cursor/);
		assert.doesNotMatch(text, /unfocused after selected cursor/);
		assert.doesNotMatch(text, new RegExp(`"piboSessionId":"${secondPayload.session.id}"`));
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

test("workflow profile picker excludes archived custom agents and reports archived refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"], description: "Global Pibo agent" }],
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
				displayName: "workflow-reviewer",
				description: "Reviews workflow drafts.",
				nativeTools: ["web_search"],
				skills: ["pi-agent-harness"],
			}),
		});
		assert.equal(createdAgent.status, 201);
		const createdPayload = await createdAgent.json();

		const archivedAgent = await fetch(`${baseURL}/api/chat/agents/${encodeURIComponent(createdPayload.agent.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archivedAgent.status, 200);

		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/profiles`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.deepEqual(pickerPayload.options.map((option) => option.id), ["pibo-agent"]);
		assert.equal(pickerPayload.options[0].source, "global");
		assert.deepEqual(pickerPayload.options[0].aliases, ["default"]);

		const selectedArchived = await fetch(`${baseURL}/api/chat/workflows/pickers/profiles?selectedProfileId=workflow-reviewer`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedArchived.status, 200);
		const selectedPayload = await selectedArchived.json();
		assert.equal(selectedPayload.selectedProfileId, undefined);
		assert.equal(selectedPayload.diagnostics[0].code, "WorkflowGraphError.archivedAgentProfileRef");
		assert.equal(selectedPayload.diagnostics[0].registryRef, "workflow-reviewer");
	} finally {
		await channel.stop?.();
	}
});

test("workflow handler picker lists registered handlers and reports missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.equal(pickerPayload.kind, "handlers");
		assert.deepEqual(pickerPayload.options.map((option) => option.id), [
			"fixture.handlers.makePlan",
			"fixture.handlers.reviseDraft",
			"fixture.handlers.summarizeDecision",
		]);
		assert.equal(pickerPayload.options[0].displayName, "Make plan");
		assert.equal(Object.hasOwn(pickerPayload.options[0], "inputSchema"), true);
		assert.equal(Object.hasOwn(pickerPayload.options[0], "outputSchema"), true);
		assert.equal(pickerPayload.options[0].inputSchema, null);
		assert.equal(pickerPayload.options[0].outputSchema, null);

		const selectedHandler = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers?selectedHandlerId=fixture.handlers.makePlan`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedHandler.status, 200);
		const selectedPayload = await selectedHandler.json();
		assert.equal(selectedPayload.selectedHandlerId, "fixture.handlers.makePlan");
		assert.deepEqual(selectedPayload.diagnostics, []);

		const missingHandler = await fetch(`${baseURL}/api/chat/workflows/pickers/handlers?selectedHandlerId=missing.handlers.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingHandler.status, 200);
		const missingPayload = await missingHandler.json();
		assert.equal(missingPayload.selectedHandlerId, undefined);
		assert.equal(missingPayload.diagnostics[0].code, "WorkflowGraphError.unknownHandlerRef");
		assert.equal(missingPayload.diagnostics[0].registryRef, "missing.handlers.inline");
		assert.equal(missingPayload.diagnostics[0].path, "$.nodes.code.handler");
	} finally {
		await channel.stop?.();
	}
});

test("workflow guard and adapter pickers list registered refs and report missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const guardPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/guards`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(guardPicker.status, 200);
		const guardPayload = await guardPicker.json();
		assert.equal(guardPayload.kind, "guards");
		assert.deepEqual(guardPayload.options.map((option) => option.id), [
			"fixture.guards.approved",
			"fixture.guards.needsRevision",
		]);

		const selectedGuard = await fetch(`${baseURL}/api/chat/workflows/pickers/guards?selectedRefId=fixture.guards.approved`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedGuard.status, 200);
		const selectedGuardPayload = await selectedGuard.json();
		assert.equal(selectedGuardPayload.selectedRefId, "fixture.guards.approved");
		assert.deepEqual(selectedGuardPayload.diagnostics, []);

		const missingGuard = await fetch(`${baseURL}/api/chat/workflows/pickers/guards?selectedRefId=missing.guards.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingGuard.status, 200);
		const missingGuardPayload = await missingGuard.json();
		assert.equal(missingGuardPayload.selectedRefId, undefined);
		assert.equal(missingGuardPayload.diagnostics[0].code, "WorkflowGraphError.unknownGuardRef");
		assert.equal(missingGuardPayload.diagnostics[0].registryRef, "missing.guards.inline");

		const adapterPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/adapters`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(adapterPicker.status, 200);
		const adapterPayload = await adapterPicker.json();
		assert.equal(adapterPayload.kind, "adapters");
		assert.deepEqual(adapterPayload.options.map((option) => option.id), [
			"fixture.adapters.draftToSummary",
			"fixture.adapters.textToTopic",
		]);

		const missingAdapter = await fetch(`${baseURL}/api/chat/workflows/pickers/adapters?selectedRefId=missing.adapters.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingAdapter.status, 200);
		const missingAdapterPayload = await missingAdapter.json();
		assert.equal(missingAdapterPayload.selectedRefId, undefined);
		assert.equal(missingAdapterPayload.diagnostics[0].code, "WorkflowGraphError.unknownAdapterRef");
		assert.equal(missingAdapterPayload.diagnostics[0].registryRef, "missing.adapters.inline");
	} finally {
		await channel.stop?.();
	}
});

test("workflow version picker lists published nested workflow refs and reports missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const picker = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(picker.status, 200);
		const pickerPayload = await picker.json();
		assert.equal(pickerPayload.kind, "workflow-versions");
		assert.deepEqual(pickerPayload.options.map((option) => `${option.id}@${option.version}`), [
			"standard-project@1.0.0",
			"simple-chat@1.0.0",
			"ui-review-workflow@2.0.0",
		]);
		assert.equal(pickerPayload.options.some((option) => option.status !== "published"), false);

		const selectedWorkflow = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions?selectedWorkflowId=standard-project&selectedWorkflowVersion=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedWorkflow.status, 200);
		const selectedPayload = await selectedWorkflow.json();
		assert.equal(selectedPayload.selectedWorkflowId, "standard-project");
		assert.equal(selectedPayload.selectedWorkflowVersion, "1.0.0");
		assert.deepEqual(selectedPayload.diagnostics, []);

		const missingWorkflow = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions?selectedWorkflowId=missing-workflow&selectedWorkflowVersion=9.9.9`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingWorkflow.status, 200);
		const missingPayload = await missingWorkflow.json();
		assert.equal(missingPayload.selectedWorkflowId, undefined);
		assert.equal(missingPayload.selectedWorkflowVersion, undefined);
		assert.equal(missingPayload.diagnostics[0].code, "WorkflowCatalogError.unknownWorkflowVersion");
		assert.equal(missingPayload.diagnostics[0].registryRef, "missing-workflow@9.9.9");
		assert.equal(missingPayload.diagnostics[0].path, "$.workflow");
	} finally {
		await channel.stop?.();
	}
});

test("workflow security boundary validates registered refs and rejects inline execution paths", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const textPort = { kind: "text" };
		const planPort = {
			kind: "json",
			schema: {
				type: "object",
				properties: {
					steps: { type: "array", items: { type: "string" } },
				},
			},
		};
		const secureDefinition = {
			...duplicatePayload.draft.definition,
			input: textPort,
			output: textPort,
			initial: "collect",
			nodes: {
				collect: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "pibo-agent" },
					promptTemplate: "Collect workflow input.",
					output: textPort,
				},
				plan: {
					kind: "code",
					language: "typescript",
					handler: "fixture.handlers.makePlan",
					input: textPort,
					output: planPort,
				},
				normalize: {
					kind: "adapter",
					mode: "deterministic",
					handler: { kind: "adapter", language: "typescript", id: "fixture.adapters.textToTopic" },
					input: planPort,
					output: textPort,
				},
				promptAsset: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "pibo-agent" },
					promptBuilder: { kind: "promptBuilder", language: "typescript", id: "fixture.promptBuilders.draftPrompt" },
					input: textPort,
					output: textPort,
				},
				review: {
					kind: "human",
					prompt: "Review the plan.",
					input: textPort,
					output: textPort,
					actions: [{ id: "fixture.humanActions.approve", kind: "approve" }],
				},
			},
			edges: {
				"collect-to-plan": {
					id: "collect-to-plan",
					from: { nodeId: "collect" },
					to: { nodeId: "plan" },
					kind: "data",
					guard: { handler: "fixture.guards.approved", priority: 0 },
				},
				"plan-to-review": {
					id: "plan-to-review",
					from: { nodeId: "plan" },
					to: { nodeId: "review" },
					kind: "data",
					adapter: {
						kind: "edgeAdapter",
						transform: { kind: "adapter", language: "typescript", id: "fixture.adapters.draftToSummary" },
						output: textPort,
					},
				},
			},
		};

		const validPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: secureDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(validPatchResponse.status, 200);
		const validPatchPayload = await validPatchResponse.json();
		assert.equal(validPatchPayload.validation.ok, true);
		assert.equal(validPatchPayload.diagnostics.some((diagnostic) => diagnostic.severity === "error"), false);

		const invalidDefinition = structuredClone(secureDefinition);
		invalidDefinition.nodes.plan.handler = "missing.handlers.inline";
		invalidDefinition.nodes.plan.inlineTypeScript = "return await eval(input);";
		invalidDefinition.nodes.normalize.handler.id = "missing.adapters.inline";
		invalidDefinition.nodes.normalize.mode = "llm";
		invalidDefinition.nodes.promptAsset.promptBuilder.id = "missing.promptAssets.inline";
		invalidDefinition.nodes.review.actions = [
			{ id: "missing.humanActions.inline", kind: "approve" },
			{ id: "fixture.humanActions.approve", kind: "reject" },
		];
		invalidDefinition.nodes.jsonTarget = {
			kind: "code",
			language: "typescript",
			handler: "fixture.handlers.reviseDraft",
			input: planPort,
			output: planPort,
		};
		invalidDefinition.edges["collect-to-plan"].guard.handler = "missing.guards.inline";
		invalidDefinition.edges["plan-to-review"].adapter.transform.id = "missing.adapters.edge";
		invalidDefinition.edges["plan-to-review"].adapter.llmCoercion = true;
		invalidDefinition.edges["collect-to-json"] = {
			id: "collect-to-json",
			from: { nodeId: "collect" },
			to: { nodeId: "jsonTarget" },
			kind: "data",
		};

		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);
		const invalidPatchPayload = await invalidPatchResponse.json();
		assert.equal(invalidPatchPayload.validation.ok, false);
		const diagnosticCodes = new Set(invalidPatchPayload.diagnostics.map((diagnostic) => diagnostic.code));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHandlerRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownAdapterRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownGuardRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownPromptBuilderRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHumanActionRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.humanActionKindMismatch"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.incompatibleEdgePorts"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.inlineExecutableCode"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.hiddenLlmCoercion"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.registryRef === "missing.guards.inline"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.hint?.includes("Hidden LLM coercion is not allowed")));
	} finally {
		await channel.stop?.();
	}
});

test("workflow builder draft loader opens starter and duplicated UI draft wrappers", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const starterResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(starterResponse.status, 200);
		const starterPayload = await starterResponse.json();
		assert.equal(starterPayload.draft.source, "ui");
		assert.equal(starterPayload.draft.status, "draft");
		assert.equal(starterPayload.draft.definition.id, "ui-starter-workflow");
		assert.equal(starterPayload.draft.validationState, "error");
		assert.equal(starterPayload.draft.validation.trigger, "draft_load");
		assert.equal(starterPayload.draft.diagnostics[0].code, "WorkflowBuilderWarning.partialDraft");
		assert.ok(starterPayload.draft.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));
		assert.equal(starterPayload.draft.definition.xstate, undefined);

		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		assert.equal(duplicatePayload.draft.baseWorkflowId, "standard-project");
		assert.equal(duplicatePayload.draft.baseWorkflowVersion, "1.0.0");
		assert.equal(duplicatePayload.draft.definition.id, "ui-standard-project-copy");
		assert.equal(duplicatePayload.draft.definition.ui.layout, "auto");
		assert.match(duplicatePayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_standard-project_1-0-0_/);

		const duplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateAgainResponse.status, 201);
		const duplicateAgainPayload = await duplicateAgainResponse.json();
		assert.equal(duplicateAgainPayload.draft.draftId, duplicatePayload.draft.draftId);
		assert.equal(duplicateAgainPayload.draft.workflowId, "ui-standard-project-copy");

		const loadedDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadedDuplicateResponse.status, 200);
		const loadedDuplicatePayload = await loadedDuplicateResponse.json();
		assert.equal(loadedDuplicatePayload.draft.draftId, duplicatePayload.draft.draftId);
		assert.equal(loadedDuplicatePayload.draft.definition.xstate, undefined);

		const unknownDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/missing-workflow/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(unknownDuplicateResponse.status, 404);
	} finally {
		await channel.stop?.();
	}
});

test("workflow validation pipeline runs on draft load, edit, validate, and publish boundaries", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const loadResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadResponse.status, 200);
		const loadPayload = await loadResponse.json();
		assert.equal(loadPayload.draft.validation.trigger, "draft_load");
		assert.equal(loadPayload.draft.validation.ok, true);
		assert.equal(loadPayload.draft.validationState, "valid");

		const validDefinition = loadPayload.draft.definition;
		for (const editTrigger of ["graph_edit", "node_edit", "edge_edit", "schema_edit", "prompt_edit", "state_edit"]) {
			const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
				method: "PATCH",
				headers: {
					"content-type": "application/json",
					origin: baseURL,
					"x-test-user": "user-1",
				},
				body: JSON.stringify({ definition: validDefinition, editTrigger }),
			});
			assert.equal(patchResponse.status, 200);
			const patchPayload = await patchResponse.json();
			assert.equal(patchPayload.validation.trigger, editTrigger);
			assert.equal(patchPayload.validation.ok, true);
			assert.equal(patchPayload.draft.validationState, "valid");
		}

		const graphEditedDefinition = structuredClone(validDefinition);
		graphEditedDefinition.nodes.agent_2 = {
			kind: "agent",
			runtime: "pibo",
			profile: { kind: "fixed", id: "pibo-agent" },
			promptTemplate: "Summarize the previous agent output.",
		};
		graphEditedDefinition.edges.edge_agent_to_agent_2 = {
			id: "edge_agent_to_agent_2",
			from: { nodeId: "agent" },
			to: { nodeId: "agent_2" },
			kind: "data",
		};
		graphEditedDefinition.ui = {
			...(graphEditedDefinition.ui ?? {}),
			layout: "manual",
			positions: {
				agent: { x: 120, y: 100 },
				agent_2: { x: 420, y: 100 },
			},
		};
		const graphPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: graphEditedDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(graphPatchResponse.status, 200);
		const graphPatchPayload = await graphPatchResponse.json();
		assert.equal(graphPatchPayload.validation.trigger, "graph_edit");
		assert.equal(graphPatchPayload.validation.ok, true);
		assert.equal(graphPatchPayload.draft.definition.nodes.agent_2.runtime, "pibo");
		assert.equal(graphPatchPayload.draft.definition.edges.edge_agent_to_agent_2.to.nodeId, "agent_2");
		assert.deepEqual(graphPatchPayload.draft.definition.ui.positions.agent_2, { x: 420, y: 100 });

		const rawPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: JSON.stringify(validDefinition), editTrigger: "raw_ir_edit" }),
		});
		assert.equal(rawPatchResponse.status, 200);
		const rawPatchPayload = await rawPatchResponse.json();
		assert.equal(rawPatchPayload.validation.trigger, "raw_ir_edit");
		assert.equal(rawPatchPayload.validation.ok, true);

		const invalidRawPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: "{ invalid raw workflow ir", editTrigger: "raw_ir_edit" }),
		});
		assert.equal(invalidRawPatchResponse.status, 200);
		const invalidRawPatchPayload = await invalidRawPatchResponse.json();
		assert.equal(invalidRawPatchPayload.validation.trigger, "raw_ir_edit");
		assert.equal(invalidRawPatchPayload.validation.validationState, "warning");
		assert.equal(invalidRawPatchPayload.draft.revision, rawPatchPayload.draft.revision);
		assert.deepEqual(invalidRawPatchPayload.draft.definition, rawPatchPayload.draft.definition);
		assert.ok(invalidRawPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowBuilderWarning.invalidRawIrText" && diagnostic.severity === "warning"));

		const reloadedAfterInvalidRawResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(reloadedAfterInvalidRawResponse.status, 200);
		const reloadedAfterInvalidRawPayload = await reloadedAfterInvalidRawResponse.json();
		assert.equal(reloadedAfterInvalidRawPayload.draft.revision, rawPatchPayload.draft.revision);
		assert.deepEqual(reloadedAfterInvalidRawPayload.draft.definition, rawPatchPayload.draft.definition);

		const rawRepairDefinition = structuredClone(rawPatchPayload.draft.definition);
		rawRepairDefinition.title = "Raw IR safe sync";
		const rawRepairResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ rawDefinitionText: JSON.stringify(rawRepairDefinition), editTrigger: "raw_ir_edit" }),
		});
		assert.equal(rawRepairResponse.status, 200);
		const rawRepairPayload = await rawRepairResponse.json();
		assert.equal(rawRepairPayload.draft.definition.title, "Raw IR safe sync");
		assert.equal(rawRepairPayload.draft.revision, rawPatchPayload.draft.revision + 1);
		assert.equal(rawRepairPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowBuilderWarning.invalidRawIrText"), false);

		const invalidDefinition = structuredClone(rawRepairPayload.draft.definition);
		invalidDefinition.nodes.agent.profile.id = "missing-workflow-profile";
		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "node_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);
		const invalidPatchPayload = await invalidPatchResponse.json();
		assert.equal(invalidPatchPayload.validation.trigger, "node_edit");
		assert.equal(invalidPatchPayload.validation.ok, false);
		assert.equal(invalidPatchPayload.draft.validationState, "error");
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef"));

		const reloadedInvalidResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(reloadedInvalidResponse.status, 200);
		const reloadedInvalidPayload = await reloadedInvalidResponse.json();
		assert.equal(reloadedInvalidPayload.draft.definition.nodes.agent.profile.id, "missing-workflow-profile");
		assert.equal(reloadedInvalidPayload.draft.validationState, "error");

		const validateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/validate`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ trigger: "prompt_edit" }),
		});
		assert.equal(validateResponse.status, 200);
		const validatePayload = await validateResponse.json();
		assert.equal(validatePayload.validation.trigger, "prompt_edit");
		assert.equal(validatePayload.validation.ok, false);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 422);
		const publishPayload = await publishResponse.json();
		assert.equal(publishPayload.validation.trigger, "before_publish");
		assert.equal(publishPayload.validation.blocksPublish, true);
		assert.ok(publishPayload.diagnostics.some((diagnostic) => diagnostic.registryRef === "missing-workflow-profile"));
	} finally {
		await channel.stop?.();
	}
});

test("workflow draft publish allocates patch, minor, and major versions", async () => {
	const { channel, baseURL, dataStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	async function duplicateDraft(workflowId, version) {
		const response = await fetch(`${baseURL}/api/chat/workflows/${workflowId}/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version }),
		});
		assert.equal(response.status, 201);
		return response.json();
	}

	async function publishDraft(draftId, body = {}) {
		const response = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify(body),
		});
		const payload = await response.json();
		return { response, payload };
	}

	try {
		const nextDraftResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(nextDraftResponse.status, 201);
		const nextDraftPayload = await nextDraftResponse.json();
		const patchPublish = await publishDraft(nextDraftPayload.draft.draftId);
		assert.equal(patchPublish.response.status, 201);
		assert.equal(patchPublish.payload.publishedVersion.workflowId, "ui-review-workflow");
		assert.equal(patchPublish.payload.publishedVersion.version, "2.0.1");
		assert.equal(patchPublish.payload.publishedVersion.definition.version, "2.0.1");
		assert.match(patchPublish.payload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.equal(patchPublish.payload.draft.targetWorkflowVersion, "2.0.1");
		assert.match(patchPublish.payload.message, /patch version bump/);

		const repeatedPatchPublish = await publishDraft(nextDraftPayload.draft.draftId, { versionIntent: "patch" });
		assert.equal(repeatedPatchPublish.response.status, 200);
		assert.equal(repeatedPatchPublish.payload.alreadyPublished, true);
		assert.equal(repeatedPatchPublish.payload.publishedVersion.version, "2.0.1");

		const minorDraft = await duplicateDraft("standard-project", "1.0.0");
		const minorPublish = await publishDraft(minorDraft.draft.draftId, { versionIntent: "minor" });
		assert.equal(minorPublish.response.status, 201);
		assert.equal(minorPublish.payload.publishedVersion.workflowId, "ui-standard-project-copy");
		assert.equal(minorPublish.payload.publishedVersion.version, "1.1.0");
		assert.equal(minorPublish.payload.publishedVersion.definition.id, "ui-standard-project-copy");

		const majorDraft = await duplicateDraft("simple-chat", "1.0.0");
		const majorPublish = await publishDraft(majorDraft.draft.draftId, { versionIntent: "major" });
		assert.equal(majorPublish.response.status, 201);
		assert.equal(majorPublish.payload.publishedVersion.workflowId, "ui-simple-chat-copy");
		assert.equal(majorPublish.payload.publishedVersion.version, "2.0.0");

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		const pickerKeys = pickerPayload.options.map((option) => `${option.id}@${option.version}`);
		assert.ok(pickerKeys.includes("ui-review-workflow@2.0.1"));
		assert.ok(pickerKeys.includes("ui-standard-project-copy@1.1.0"));
		assert.ok(pickerKeys.includes("ui-simple-chat-copy@2.0.0"));

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const rows = db.prepare("SELECT workflow_id, version FROM workflow_published_versions ORDER BY workflow_id, version").all();
			assert.ok(rows.some((row) => row.workflow_id === "ui-review-workflow" && row.version === "2.0.1"));
			assert.ok(rows.some((row) => row.workflow_id === "ui-standard-project-copy" && row.version === "1.1.0"));
			assert.ok(rows.some((row) => row.workflow_id === "ui-simple-chat-copy" && row.version === "2.0.0"));
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("workflow published edit creates or reuses one next-version draft", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const createResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		assert.equal(createPayload.reused, false);
		assert.equal(createPayload.draft.workflowId, "ui-review-workflow");
		assert.equal(createPayload.draft.baseWorkflowId, "ui-review-workflow");
		assert.equal(createPayload.draft.baseWorkflowVersion, "2.0.0");
		assert.equal(createPayload.draft.targetWorkflowVersion, "2.0.1");
		assert.equal(createPayload.draft.definition.id, "ui-review-workflow");
		assert.equal(createPayload.draft.definition.version, "2.0.1");
		assert.equal(createPayload.draft.diagnostics[0].code, "WorkflowBuilderInfo.nextVersionDraft");
		assert.match(createPayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_ui-review-workflow_2-0-0_next_/);

		const reuseResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(reuseResponse.status, 200);
		const reusePayload = await reuseResponse.json();
		assert.equal(reusePayload.reused, true);
		assert.equal(reusePayload.draft.draftId, createPayload.draft.draftId);
		assert.equal(reusePayload.draft.targetWorkflowVersion, "2.0.1");

		const loadedResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadedResponse.status, 200);
		const loadedPayload = await loadedResponse.json();
		assert.equal(loadedPayload.draft.draftId, createPayload.draft.draftId);
		assert.equal(loadedPayload.draft.definition.xstate, undefined);

		const codeEditResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/drafts`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeEditResponse.status, 409);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app creates configured Project workflow sessions from the workflow catalog without starting a run", async () => {
	const { channel, baseURL, emitted, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				name: "Workflow Project",
				projectFolder: join(storageDir, "workflow-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.kind, "workflow-versions");
		assert.ok(pickerPayload.options.some((option) => option.id === "standard-project" && option.version === "1.0.0"));

		const workflowConfiguration = {
			inputValues: { topic: "Workflow API creation", priority: 2 },
			promptOverrides: { agent: "Use the provided topic and produce a concise implementation plan." },
			model: { provider: "openai", id: "gpt-5.1" },
			thinkingLevel: "medium",
			fastMode: true,
		};
		const createdResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Configured Standard Project",
				...workflowConfiguration,
			}),
		});
		assert.equal(createdResponse.status, 201);
		const createdPayload = await createdResponse.json();
		assert.equal(createdPayload.session.title, "Configured Standard Project");
		assert.equal(createdPayload.session.metadata.projectWorkflowId, "standard-project");
		assert.equal(createdPayload.session.metadata.projectWorkflowVersion, "1.0.0");
		assert.equal(createdPayload.session.metadata.workflowSessionKind, "main_workflow");
		assert.deepEqual(createdPayload.session.activeModel, workflowConfiguration.model);
		assert.deepEqual(createdPayload.configuration.inputValues, workflowConfiguration.inputValues);
		assert.deepEqual(createdPayload.configuration.promptOverrides, workflowConfiguration.promptOverrides);
		assert.deepEqual(createdPayload.configuration.promptOverrideEligibleNodeIds, ["agent"]);
		assert.deepEqual(createdPayload.configuration.model, workflowConfiguration.model);
		assert.equal(createdPayload.configuration.thinkingLevel, "medium");
		assert.equal(createdPayload.configuration.fastMode, true);
		assert.deepEqual(createdPayload.configuration.overrideScopes, {
			promptOverrides: "eligible_agent_node",
			model: "workflow",
			thinkingLevel: "workflow",
			fastMode: "workflow",
		});
		assert.deepEqual(createdPayload.projectSession.configuration, createdPayload.configuration);
		assert.deepEqual(createdPayload.session.metadata.projectWorkflowConfiguration, createdPayload.configuration);
		assert.equal(createdPayload.projectSession.workflowId, "standard-project");
		assert.equal(createdPayload.projectSession.workflowVersion, "1.0.0");
		assert.equal(createdPayload.projectSession.state, "configured");
		assert.equal(createdPayload.projectSession.workflowRunId, undefined);
		assert.equal(createdPayload.validation.trigger, "before_project_session_creation");
		assert.equal(createdPayload.validation.ok, true);
		assert.match(createdPayload.snapshot.id, /^wfs_/);
		assert.equal(createdPayload.snapshot.schemaVersion, 1);
		assert.equal(createdPayload.snapshot.projectId, projectPayload.project.id);
		assert.equal(createdPayload.snapshot.piboSessionId, createdPayload.session.id);
		assert.equal(createdPayload.snapshot.workflow.id, "standard-project");
		assert.equal(createdPayload.snapshot.workflow.version, "1.0.0");
		assert.equal(createdPayload.snapshot.workflow.source, "code");
		assert.match(createdPayload.snapshot.workflow.baseDefinitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.match(createdPayload.snapshot.workflow.effectiveDefinitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.notEqual(createdPayload.snapshot.workflow.baseDefinitionHash, createdPayload.snapshot.workflow.effectiveDefinitionHash);
		assert.deepEqual(createdPayload.snapshot.inputValues, workflowConfiguration.inputValues);
		assert.deepEqual(createdPayload.snapshot.promptOverrides, workflowConfiguration.promptOverrides);
		assert.deepEqual(createdPayload.snapshot.overridePolicy, {
			promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
			eligiblePromptNodeIds: ["agent"],
			modelScope: "workflow",
			thinkingLevelScope: "workflow",
			fastModeScope: "workflow",
		});
		assert.deepEqual(createdPayload.snapshot.model, workflowConfiguration.model);
		assert.equal(createdPayload.snapshot.thinkingLevel, "medium");
		assert.equal(createdPayload.snapshot.fastMode, true);
		assert.equal(createdPayload.snapshot.baseDefinition.nodes.agent.promptTemplate, "Use the workflow input to produce a concise answer.\n\n{{input}}");
		assert.equal(createdPayload.snapshot.effectiveDefinition.nodes.agent.promptTemplate, workflowConfiguration.promptOverrides.agent);
		assert.equal(createdPayload.snapshot.validation.trigger, "before_project_session_creation");
		assert.equal(createdPayload.snapshot.validation.ok, true);
		assert.equal(emitted.length, 0);

		const startValidationResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(createdPayload.session.id)}/start`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({}),
		});
		assert.equal(startValidationResponse.status, 202);
		const startValidationPayload = await startValidationResponse.json();
		assert.equal(startValidationPayload.validation.trigger, "before_workflow_start");
		assert.equal(startValidationPayload.validation.ok, true);
		assert.equal(startValidationPayload.projectSession.state, "configured");
		assert.deepEqual(startValidationPayload.projectSession.configuration, createdPayload.configuration);
		assert.equal(startValidationPayload.projectSession.workflowRunId, undefined);
		assert.equal(startValidationPayload.snapshot.id, createdPayload.snapshot.id);
		assert.deepEqual(startValidationPayload.snapshot.effectiveDefinition, createdPayload.snapshot.effectiveDefinition);
		assert.equal(emitted.length, 0);

		const legacyRejected = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ workflowId: "standard-project" }),
		});
		assert.equal(legacyRejected.status, 400);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app rejects unsupported Project workflow session creation inputs", async () => {
	const { channel, baseURL, emitted, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				name: "Workflow Rejection Project",
				projectFolder: join(storageDir, "workflow-rejection-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();
		const workflowSessionUrl = `${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`;
		const postWorkflowSession = (body) => fetch(workflowSessionUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify(body),
		});
		const validSelection = {
			profile: "pibo-agent",
			workflowId: "standard-project",
			workflowVersion: "1.0.0",
		};

		for (const { body, message } of [
			{ body: { workflowVersion: "1.0.0" }, message: /Workflow id is required/ },
			{ body: { workflowId: "standard-project" }, message: /Workflow version is required/ },
			{ body: { workflowId: "missing-workflow", workflowVersion: "9.9.9" }, message: /Unknown workflow version/ },
			{ body: { workflowId: "standard-project", workflowVersion: 7 }, message: /Workflow version must be a string/ },
			{ body: { workflowId: "ui-draft-workflow", workflowVersion: "0.1.0-draft" }, message: /not published/ },
			{ body: { workflowId: "archived-review-workflow", workflowVersion: "1.0.0" }, message: /archived/ },
			{ body: { ...validSelection, agentProfileOverrides: { agent: "reviewer-agent" } }, message: /Agent profile overrides/ },
			{ body: { ...validSelection, maxRetries: 3 }, message: /Retry limit overrides/ },
			{ body: { ...validSelection, handlerOverrides: { code: "fixture.handlers.makePlan" } }, message: /Handler overrides/ },
			{ body: { ...validSelection, adapterOverrides: { edge: "fixture.adapters.trim" } }, message: /Adapter overrides/ },
			{ body: { ...validSelection, guardOverrides: { edge: "fixture.guards.ready" } }, message: /Guard overrides/ },
			{ body: { ...validSelection, options: { temperature: 0.2 } }, message: /Arbitrary options/ },
			{ body: { ...validSelection, customOption: true }, message: /Unsupported workflow session creation field/ },
			{ body: { ...validSelection, inputValues: ["not", "object"] }, message: /inputValues must be a JSON object/ },
			{ body: { ...validSelection, promptOverrides: "agent prompt" }, message: /promptOverrides must be a JSON object/ },
			{ body: { ...validSelection, promptOverrides: { missing: "No eligible node." } }, message: /not eligible for prompt overrides/ },
			{ body: { ...validSelection, model: { provider: "openai", id: "gpt-5.1", temperature: 0.2 } }, message: /model contains unsupported field/ },
			{ body: { ...validSelection, thinkingLevel: "turbo" }, message: /thinkingLevel must be one of/ },
			{ body: { ...validSelection, fastMode: "yes" }, message: /fastMode must be a boolean/ },
		]) {
			const response = await postWorkflowSession(body);
			assert.equal(response.status, 400);
			const payload = await response.json();
			assert.match(payload.error, message);
		}
		assert.equal(emitted.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app project bootstrap includes real workflow session descendants only", async () => {
	const { channel, baseURL, sessions, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }, { name: "reviewer-agent" }],
	});

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				name: "Workflow Tree Project",
				projectFolder: join(storageDir, "workflow-tree-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		const createdResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Workflow Root",
			}),
		});
		assert.equal(createdResponse.status, 201);
		const createdPayload = await createdResponse.json();
		const root = createdPayload.session;
		const ownerScope = root.ownerScope;
		assert.equal(ownerScope, "user:user-1");

		const nested = sessions.create({
			channel: "pibo.workflow",
			kind: "workflow",
			profile: "pibo-agent",
			ownerScope,
			parentId: root.id,
			workspace: projectPayload.project.projectFolder,
			title: "Nested Review Workflow",
			metadata: { workflowSessionKind: "nested_workflow", workflowNodeId: "review-subflow" },
		});
		const agent = sessions.create({
			channel: "pibo.workflow",
			kind: "agent-node",
			profile: "pibo-agent",
			ownerScope,
			parentId: nested.id,
			workspace: projectPayload.project.projectFolder,
			title: "Drafting Agent Node",
			metadata: { workflowSessionKind: "agent_node", workflowNodeId: "draft" },
		});
		const subagent = sessions.create({
			channel: "pibo.subagents",
			kind: "subagent",
			profile: "reviewer-agent",
			ownerScope,
			parentId: agent.id,
			workspace: projectPayload.project.projectFolder,
			title: "Reviewer Subagent",
			metadata: { workflowSessionKind: "subagent", subagentName: "reviewer" },
		});
		const unrelated = sessions.create({
			channel: "pibo.workflow",
			kind: "agent-node",
			profile: "pibo-agent",
			ownerScope,
			workspace: projectPayload.project.projectFolder,
			title: "Unrelated Workflow Node",
			metadata: { workflowSessionKind: "agent_node", workflowNodeId: "unrelated" },
		});

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectPayload.project.id)}&piboSessionId=${encodeURIComponent(subagent.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrapPayload = await bootstrapResponse.json();
		assert.equal(bootstrapPayload.selectedPiboSessionId, subagent.id);

		const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
		const flattened = flatten(bootstrapPayload.sessions);
		assert.deepEqual(new Set(flattened.map((node) => node.piboSessionId)), new Set([root.id, nested.id, agent.id, subagent.id]));
		assert.ok(!flattened.some((node) => node.piboSessionId === unrelated.id));

		const rootNode = bootstrapPayload.sessions.find((node) => node.piboSessionId === root.id);
		assert.ok(rootNode);
		assert.equal(rootNode.workflowSessionKind, "main_workflow");
		assert.equal(rootNode.children[0].workflowSessionKind, "nested_workflow");
		assert.equal(rootNode.children[0].children[0].workflowSessionKind, "agent_node");
		assert.equal(rootNode.children[0].children[0].children[0].workflowSessionKind, "subagent");
		assert.deepEqual(bootstrapPayload.projectSessions.map((session) => session.piboSessionId), [root.id]);
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
