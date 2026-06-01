import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { PRE_CUTOVER_LEGACY_OWNER_SCOPE } from "../dist/owner-scope-compat.js";
import { SHARED_APP_CONTEXT } from "../dist/shared-app.js";

function createHarness() {
	const storageDir = mkdtempSync(join(tmpdir(), "pibo-chat-shared-sessions-"));
	const dataStorePath = join(storageDir, "chat.sqlite");
	const app = createChatWebApp({
		dataStorePath,
		dataPayloadRootDir: join(storageDir, "payloads"),
		agentStorePath: join(storageDir, "agents.sqlite"),
		projectStorePath: join(storageDir, "projects.sqlite"),
	});
	const sessions = new InMemoryPiboSessionStore();
	const emitted = [];
	const context = {
		async requireSession({ request }) {
			const userId = request.headers.get("x-test-user");
			if (!userId) throw new Error("Unauthenticated");
			return {
				authSession: {
					identity: { userId, email: `${userId}@example.test`, provider: "test" },
				},
				appContext: SHARED_APP_CONTEXT,
				ownerScope: PRE_CUTOVER_LEGACY_OWNER_SCOPE,
			};
		},
		channelContext: {
			emit(event) {
				emitted.push(event);
				return Promise.resolve({
					type: event.type === "message" ? "message_queued" : "execution_result",
					piboSessionId: event.piboSessionId,
					eventId: event.id,
					...(event.type === "message" ? { text: event.text, queuedMessages: 1 } : { action: event.action, result: { ok: true } }),
				});
			},
			subscribe() { return () => {}; },
			getSession(id) { return sessions.get(id); },
			createSession(input) { return sessions.create(input); },
			updateSession(id, input) { return sessions.update(id, input); },
			deleteSession(id) { return sessions.delete(id); },
			findSessions(input) { return sessions.find(input); },
			listSessions() { return sessions.list(); },
			getGatewayActions() { return [{ name: "session.clone", description: "Clone", slashCommands: ["clone"] }]; },
			getProfiles() { return [{ name: "base", aliases: [] }]; },
			getWebApps() { return [app]; },
		},
	};
	async function request(path, options = {}) {
		const headers = new Headers(options.headers ?? {});
		if (!headers.has("x-test-user")) headers.set("x-test-user", "user-a");
		if (options.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
		if (options.method && options.method !== "GET" && !headers.has("origin")) headers.set("origin", "http://chat.test");
		return app.handleRequest(new Request(`http://chat.test${path}`, { ...options, headers }), context);
	}
	return {
		storageDir,
		dataStorePath,
		sessions,
		emitted,
		request,
		cleanup() { rmSync(storageDir, { recursive: true, force: true }); },
	};
}

async function json(response) {
	assert.ok(response, "expected a response");
	return response.json();
}

function ensureLegacyRoomCompatibility(db) {
	const roomColumns = new Set(db.prepare("PRAGMA table_info(rooms)").all().map((column) => column.name));
	if (!roomColumns.has("owner_scope")) db.exec(`ALTER TABLE rooms ADD COLUMN owner_scope TEXT`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS room_members (
			room_id TEXT NOT NULL,
			principal_id TEXT NOT NULL,
			role TEXT NOT NULL,
			joined_at TEXT NOT NULL,
			PRIMARY KEY (room_id, principal_id)
		)
	`);
}

function insertHistoricalRoom(db, input) {
	ensureLegacyRoomCompatibility(db);
	const now = input.updatedAt ?? new Date().toISOString();
	db.prepare(`INSERT INTO rooms (id, owner_scope, name, topic, type, parent_room_id, workspace, retention_policy_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
		input.id,
		input.ownerScope,
		input.name,
		input.topic ?? null,
		input.type ?? "chat",
		input.parentRoomId ?? null,
		input.workspace ?? null,
		null,
		JSON.stringify(input.metadata ?? {}),
		now,
		now,
	);
}

test("Chat Web lists, opens, and sends to mixed historical sessions without owner equality", async () => {
	const harness = createHarness();
	try {
		const roomResponse = await harness.request("/api/chat/rooms", {
			method: "POST",
			body: JSON.stringify({ name: "Shared History" }),
		});
		assert.equal(roomResponse.status, 201);
		const { room } = await json(roomResponse);

		const sharedSession = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: PRE_CUTOVER_LEGACY_OWNER_SCOPE,
			title: "Historical shared session",
			metadata: { chatRoomId: room.id },
		});
		const userSession = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-account",
			title: "Historical user session",
			metadata: { chatRoomId: room.id },
		});

		const bootstrapResponse = await harness.request(`/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(userSession.id)}`, {
			headers: { "x-test-user": "user-b" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await json(bootstrapResponse);
		assert.equal(bootstrap.selectedPiboSessionId, userSession.id);
		const listedIds = new Set(bootstrap.sessions.map((session) => session.piboSessionId));
		assert.ok(listedIds.has(sharedSession.id), "shared:app historical session is listed");
		assert.ok(listedIds.has(userSession.id), "user:* historical session is listed");

		const messageResponse = await harness.request("/api/chat/message", {
			method: "POST",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ piboSessionId: userSession.id, roomId: room.id, text: "continue historical session" }),
		});
		assert.equal(messageResponse.status, 200);
		assert.equal(harness.emitted.at(-1).piboSessionId, userSession.id);
		assert.equal(harness.emitted.at(-1).text, "continue historical session");
	} finally {
		harness.cleanup();
	}
});

test("Chat Web real API paths bootstrap, open, and send for shared, legacy user, and new shared sessions", async () => {
	const harness = createHarness();
	try {
		const roomResponse = await harness.request("/api/chat/rooms", {
			method: "POST",
			headers: { "x-test-user": "user-a" },
			body: JSON.stringify({ name: "Real API Validation" }),
		});
		assert.equal(roomResponse.status, 201);
		const { room } = await json(roomResponse);

		const historicalShared = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: PRE_CUTOVER_LEGACY_OWNER_SCOPE,
			title: "Historical shared real path",
			metadata: { chatRoomId: room.id },
		});
		const historicalUser = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-real-path",
			title: "Historical user real path",
			metadata: { chatRoomId: room.id },
		});
		const createdResponse = await harness.request("/api/chat/sessions", {
			method: "POST",
			headers: { "x-test-user": "user-a" },
			body: JSON.stringify({ roomId: room.id }),
		});
		assert.equal(createdResponse.status, 201);
		const { session: newShared } = await json(createdResponse);
		assert.equal("ownerScope" in newShared, false);
		assert.equal(newShared.metadata.chatRoomId, room.id);

		const cases = [
			{ label: "historical shared:app", session: historicalShared },
			{ label: "historical user:*", session: historicalUser },
			{ label: "new shared-app", session: newShared },
		];
		for (const { label, session } of cases) {
			const bootstrapResponse = await harness.request(`/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(session.id)}&markRead=true`, {
				headers: { "x-test-user": "user-b" },
			});
			assert.equal(bootstrapResponse.status, 200, `${label} bootstrap succeeds`);
			const bootstrap = await json(bootstrapResponse);
			assert.equal(bootstrap.selectedPiboSessionId, session.id, `${label} direct bootstrap selects session`);
			assert.equal(bootstrap.selectedRoomId, room.id, `${label} direct bootstrap keeps room`);
			assert.ok(bootstrap.sessions.some((node) => node.piboSessionId === session.id), `${label} appears in sidebar session nodes`);
			assert.ok(bootstrap.rooms.some((node) => node.id === room.id), `${label} room appears in sidebar tree`);

			const navigationResponse = await harness.request(`/api/chat/navigation?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(session.id)}`, {
				headers: { "x-test-user": "user-b" },
			});
			assert.equal(navigationResponse.status, 200, `${label} navigation succeeds`);
			const navigation = await json(navigationResponse);
			assert.equal(navigation.selectedPiboSessionId, session.id, `${label} navigation selects session`);
			assert.ok(navigation.sessions.some((node) => node.piboSessionId === session.id), `${label} navigation includes session`);

			const messageResponse = await harness.request("/api/chat/message", {
				method: "POST",
				headers: { "x-test-user": "user-b" },
				body: JSON.stringify({ piboSessionId: session.id, roomId: room.id, text: `message for ${label}` }),
			});
			assert.equal(messageResponse.status, 200, `${label} send succeeds`);
			assert.equal(harness.emitted.at(-1).piboSessionId, session.id, `${label} send targets selected session`);
			assert.equal(harness.emitted.at(-1).text, `message for ${label}`);
		}
	} finally {
		harness.cleanup();
	}
});

test("Chat Web treats rooms, sidebar navigation, and mutations as app-global resources", async () => {
	const harness = createHarness();
	let db;
	try {
		db = new DatabaseSync(harness.dataStorePath);
		insertHistoricalRoom(db, { id: "room_shared_history", ownerScope: PRE_CUTOVER_LEGACY_OWNER_SCOPE, name: "Shared room", metadata: { default: true }, updatedAt: "2026-05-01T00:00:00.000Z" });
		insertHistoricalRoom(db, { id: "room_legacy_history", ownerScope: "user:legacy-account", name: "Legacy account room", updatedAt: "2026-05-02T00:00:00.000Z" });
		db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?)").run("room_legacy_history", "user:legacy-account", "viewer", "2026-05-02T00:00:00.000Z");
		db.close();
		db = undefined;

		const session = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-account",
			title: "Legacy room session",
			metadata: { chatRoomId: "room_legacy_history" },
		});

		const roomsResponse = await harness.request("/api/chat/rooms", { headers: { "x-test-user": "user-b" } });
		assert.equal(roomsResponse.status, 200);
		const rooms = await json(roomsResponse);
		const roomIds = new Set(rooms.rooms.map((room) => room.id));
		assert.ok(roomIds.has("room_shared_history"), "historical shared room is listed");
		assert.ok(roomIds.has("room_legacy_history"), "historical user-owned room is listed");

		const roomResponse = await harness.request("/api/chat/rooms/room_legacy_history", { headers: { "x-test-user": "user-b" } });
		assert.equal(roomResponse.status, 200);
		assert.equal((await json(roomResponse)).room.id, "room_legacy_history");

		const renamed = await harness.request("/api/chat/rooms/room_legacy_history", {
			method: "PATCH",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ name: "Renamed legacy room" }),
		});
		assert.equal(renamed.status, 200);
		assert.equal((await json(renamed)).room.name, "Renamed legacy room");

		const bootstrapResponse = await harness.request(`/api/chat/bootstrap?roomId=room_legacy_history&piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-b" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrap = await json(bootstrapResponse);
		assert.equal(bootstrap.selectedRoomId, "room_legacy_history");
		assert.ok(bootstrap.rooms.some((room) => room.id === "room_legacy_history"), "navigation includes legacy room");
		assert.ok(bootstrap.sessions.some((item) => item.piboSessionId === session.id), "navigation includes legacy room session");
	} finally {
		if (db) db.close();
		harness.cleanup();
	}
});

test("Chat Web read state is shared across authenticated accounts", async () => {
	const harness = createHarness();
	let db;
	try {
		const roomResponse = await harness.request("/api/chat/rooms", {
			method: "POST",
			headers: { "x-test-user": "user-a" },
			body: JSON.stringify({ name: "Read state room" }),
		});
		assert.equal(roomResponse.status, 201);
		const { room } = await json(roomResponse);
		const session = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-account",
			title: "Unread session",
			metadata: { chatRoomId: room.id },
		});

		db = new DatabaseSync(harness.dataStorePath);
		db.prepare(`INSERT INTO event_log (session_id, room_id, topic, type, source, actor_type, actor_id, retention_class, attributes_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			session.id,
			room.id,
			"pibo.output",
			"assistant_message",
			"test",
			"assistant",
			"assistant",
			"chat_message",
			"{}",
			"2026-05-30T00:00:00.000Z",
		);
		db.close();
		db = undefined;

		const initial = await harness.request(`/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-a" },
		});
		assert.equal(initial.status, 200);
		const initialNode = (await json(initial)).sessions.find((node) => node.piboSessionId === session.id);
		assert.equal(initialNode.unreadCount, 1);

		const readResponse = await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}/read`, {
			method: "POST",
			headers: { "x-test-user": "user-a" },
			body: JSON.stringify({}),
		});
		assert.equal(readResponse.status, 200);

		const after = await harness.request(`/api/chat/bootstrap?roomId=${encodeURIComponent(room.id)}&piboSessionId=${encodeURIComponent(session.id)}`, {
			headers: { "x-test-user": "user-b" },
		});
		assert.equal(after.status, 200);
		const afterNode = (await json(after)).sessions.find((node) => node.piboSessionId === session.id);
		assert.equal(afterNode.unreadCount, undefined);

		db = new DatabaseSync(harness.dataStorePath);
		assert.equal(db.prepare("SELECT COUNT(*) AS count FROM app_session_read_state WHERE session_id = ?").get(session.id).count, 1);
	} finally {
		if (db) db.close();
		harness.cleanup();
	}
});

test("Chat Web mutates and routes historical user-owned sessions by resource existence", async () => {
	const harness = createHarness();
	try {
		const session = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-account",
			title: "Legacy owner session",
		});
		const child = harness.sessions.create({
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
			ownerScope: "user:legacy-account",
			parentId: session.id,
			title: "Legacy child",
		});

		const renamed = await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "PATCH",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ title: "Renamed by another account" }),
		});
		assert.equal(renamed.status, 200);
		assert.equal((await json(renamed)).session.title, "Renamed by another account");

		const action = await harness.request("/api/chat/action", {
			method: "POST",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ piboSessionId: session.id, action: "session.clone", params: {} }),
		});
		assert.equal(action.status, 200);
		assert.equal(harness.emitted.at(-1).piboSessionId, session.id);
		assert.equal(harness.emitted.at(-1).action, "session.clone");

		const archived = await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "PATCH",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ archived: true }),
		});
		assert.equal(archived.status, 200);
		assert.equal(typeof (await json(archived)).session.metadata.chatWebArchivedAt, "string");

		const restored = await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "PATCH",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ archived: false }),
		});
		assert.equal(restored.status, 200);
		assert.equal((await json(restored)).session.metadata.chatWebArchivedAt, undefined);

		await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "PATCH",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ archived: true }),
		});
		const deleted = await harness.request(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
			method: "DELETE",
			headers: { "x-test-user": "user-b" },
			body: JSON.stringify({ confirmText: "Delete this session" }),
		});
		assert.equal(deleted.status, 200);
		assert.deepEqual(new Set((await json(deleted)).deletedSessionIds), new Set([session.id, child.id]));
		assert.equal(harness.sessions.get(session.id), undefined);
		assert.equal(harness.sessions.get(child.id), undefined);
	} finally {
		harness.cleanup();
	}
});
