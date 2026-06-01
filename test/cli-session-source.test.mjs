import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { cliDefaultRoomId, CliSourceError, createDefaultFakeCliSessionSource, FakeCliSessionSource, LocalCliSessionSource, redactCliSecretText } from "../dist/cli-session/index.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const fixedNow = "2026-05-16T12:00:00.000Z";

function assertNoOwnerFields(value, label = "value") {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		value.forEach((entry, index) => assertNoOwnerFields(entry, `${label}[${index}]`));
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		assert.notEqual(key, "ownerScope", `${label} exposes ownerScope`);
		assert.notEqual(key, "activeOwnerScope", `${label} exposes activeOwnerScope`);
		assert.notEqual(key, "activeOwnerLabel", `${label} exposes activeOwnerLabel`);
		assertNoOwnerFields(nested, `${label}.${key}`);
	}
}

test("fake CLI session source exposes app-global rooms sessions agents and status", async () => {
	const source = createDefaultFakeCliSessionSource();

	assert.deepEqual(await source.listRooms(), [{ id: "room_fake_main", title: "Fake Room", description: "Deterministic CLI session source room" }]);
	const sessions = await source.listSessions({ roomId: "room_fake_main" });
	assert.deepEqual(sessions.map((session) => session.id), ["ps_fake_existing"]);
	assert.equal(sessions[0].profile, "base");
	assertNoOwnerFields(sessions, "sessions");

	const created = await source.createSession({ roomId: "room_fake_main", title: "Created from test", agentId: "base" });
	assert.equal(created.id, "ps_fake_created_1");
	assert.equal(created.roomId, "room_fake_main");
	assert.equal(created.profile, "base");
	assertNoOwnerFields(created, "created");

	const status = await source.getStatus({ sessionId: "ps_fake_existing" });
	assert.equal(status.source, "fake");
	assert.equal(status.mode, "fake");
	assert.equal(status.connected, true);
	assert.equal(status.activeSessionId, "ps_fake_existing");
	assert.equal(status.activeAgentId, "base");
	assertNoOwnerFields(status, "status");

	assert.equal(typeof source.getActiveOwner, "undefined");
	assert.equal(typeof source.setActiveOwner, "undefined");
	assert.equal(typeof source.listOwners, "undefined");
});

test("fake CLI session source lists all fixtures without owner filtering or mismatch errors", async () => {
	const source = new FakeCliSessionSource({
		rooms: [
			{ id: "room_alpha", title: "Alpha Room" },
			{ id: "room_beta", title: "Beta Room" },
		],
		sessions: [
			{ id: "ps_alpha", title: "Alpha Session", roomId: "room_alpha", profile: "base", status: "idle" },
			{ id: "ps_beta", title: "Beta Session", roomId: "room_beta", profile: "base", status: "idle" },
		],
	});

	assert.deepEqual((await source.listRooms()).map((room) => room.id), ["room_alpha", "room_beta"]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), ["ps_alpha", "ps_beta"]);
	assert.deepEqual((await source.listSessions({ roomId: "room_beta" })).map((session) => session.id), ["ps_beta"]);
	assert.equal((await source.openSession("ps_beta")).session.id, "ps_beta");
});

test("fake CLI source opens trace fixtures compatible with shared compact rows", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");
	const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });

	assert.deepEqual(rows.map((row) => row.kind), ["message.user", "message.assistant", "message.assistant", "tool.call", "tool.call", "yielded.run", "error"]);
	assert.match(JSON.stringify(rows), /Hello from fake source/);
	assert.match(JSON.stringify(rows), /Fake assistant response/);
	opened.close();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);
});

test("local CLI session source lists app-global sessions, derived rooms, agents, and redacted status", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({ id: "ps_cli_local_a", piSessionId: "pi_cli_local_a", channel: "chat-web", kind: "chat", profile: "base", workspace: "/workspace/project-a", title: "Local A", metadata: { chatRoomId: "room_one", chatRoomName: "Main Room", status: "idle" }, activeModel: { provider: "openai", id: "gpt-test" } });
	store.create({ id: "ps_cli_local_b", piSessionId: "pi_cli_local_b", channel: "chat-web", kind: "chat", profile: "base", title: "Local B", metadata: { chatRoomId: "room_two", chatRoomName: "Second Room", status: "running" } });
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow, statusMessage: "OPENAI_API_KEY=sk-testsecret token:abcdef123456 password=hunter2" });

	const rooms = await source.listRooms();
	assert.ok(rooms.some((room) => room.id === cliDefaultRoomId() && room.title === "Shared Chat" && room.isDefault === true));
	assert.ok(rooms.some((room) => room.id === "room_one" && room.title === "Main Room"));
	assertNoOwnerFields(rooms, "rooms");

	assert.deepEqual((await source.listSessions()).map((session) => session.id).sort(), ["ps_cli_local_a", "ps_cli_local_b"].sort());
	const sessions = await source.listSessions({ roomId: "room_one" });
	assert.deepEqual(sessions.map((session) => session.id), ["ps_cli_local_a"]);
	assert.deepEqual(sessions[0].model, { provider: "openai", id: "gpt-test" });
	assertNoOwnerFields(sessions, "sessions");

	const status = await source.getStatus({ sessionId: "ps_cli_local_a" });
	assert.equal(status.source, "local/direct");
	assert.equal(status.activeRoomId, "room_one");
	assert.equal(status.activeAgentId, "base");
	assert.doesNotMatch(status.message ?? "", /sk-testsecret|abcdef123456|hunter2/);
	assertNoOwnerFields(status, "status");
});

test("local CLI source creates sessions in the shared app default room without owner fields", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow });
	const rooms = await source.listRooms();
	assert.deepEqual(rooms[0], { id: cliDefaultRoomId(), title: "Shared Chat", description: "Shared default chat room", isDefault: true });

	const created = await source.createSession({ title: "Created", profile: "base" });
	assert.equal(created.roomId, cliDefaultRoomId());
	assert.equal(store.get(created.id).metadata.chatRoomId, cliDefaultRoomId());
	assertNoOwnerFields(created, "created");
});

test("local CLI source writes Web-visible navigation and message read models app-globally", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const room = rooms.ensureDefaultRoom({ name: "Shared Chat" });
	const listeners = new Set();
	const router = {
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		async emit(event) {
			const assistant = { type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, assistantIndex: 0, contentIndex: 0, text: "Persisted assistant reply" };
			for (const listener of listeners) {
				listener({ type: "message_started", piboSessionId: event.piboSessionId, eventId: event.id, text: event.text, source: event.source });
				listener(assistant);
				listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id, source: event.source });
			}
			return assistant;
		},
	};
	const source = new LocalCliSessionSource({ dataStore, sessionStore, router, now: () => fixedNow });
	const created = await source.createSession({ roomId: room.id, title: "Web Visible CLI", profile: "base" });
	assertNoOwnerFields(created, "created");

	const opened = await source.openSession(created.id);
	opened.subscribe(() => {});
	await source.sendMessage(created.id, "Persist this CLI message");

	const navigation = dataStore.db.prepare("SELECT room_id, status, last_message_preview FROM session_navigation WHERE session_id = ?").get(created.id);
	assert.equal(navigation.room_id, room.id);
	assert.equal(navigation.status, "idle");
	const messages = dataStore.db.prepare("SELECT role, actor_id, room_id, content_preview FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC").all(created.id);
	assert.deepEqual(messages.map((row) => row.role), ["user", "assistant"]);
	assert.equal(messages[0].actor_id, "cli-session-ui");
	assert.equal(messages[0].room_id, room.id);
	assert.match(messages[0].content_preview, /Persist this CLI message/);
	assert.equal(messages[1].room_id, room.id);

	await source.close();
	dataStore.close();
});

test("local CLI session source routes slash actions and opens clone results without owner parameters", async () => {
	const store = new InMemoryPiboSessionStore();
	const emitted = [];
	const router = {
		subscribe() { return () => {}; },
		async emit(event) {
			emitted.push(event);
			if (event.action === "status") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { piboSessionId: event.piboSessionId, activeModel: { provider: "openai", id: "gpt-local" } } };
			if (event.action === "session.clone") {
				const sourceSession = store.get(event.piboSessionId);
				const clone = store.create({ id: "ps_local_clone", piSessionId: "pi_local_clone", channel: sourceSession.channel, kind: "branch", profile: sourceSession.profile, originId: sourceSession.id, workspace: sourceSession.workspace, title: "Local Clone", metadata: sourceSession.metadata });
				return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { piboSessionId: clone.id, roomId: "room_one", title: clone.title } };
			}
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { ok: true } };
		},
	};
	const source = new LocalCliSessionSource({ sessionStore: store, router, now: () => fixedNow });
	const created = await source.createSession({ roomId: "room_one", title: "Action Session", profile: "base" });

	const status = await source.executeSlashCommand({ command: "status", sessionId: created.id });
	assert.equal(status.descriptor.kind, "status");
	assert.equal(emitted.at(-1).action, "status");
	assert.equal("ownerScope" in emitted.at(-1), false);
	const current = await source.executeSlashCommand({ command: "session-current", sessionId: created.id });
	assert.equal(current.openSessionId, created.id);
	assertNoOwnerFields(current.rawResult, "current rawResult");
	const sessions = await source.executeSlashCommand({ command: "sessions", sessionId: created.id });
	assert.match(JSON.stringify(sessions.rawResult), /Action Session/);
	assertNoOwnerFields(sessions.rawResult, "sessions rawResult");
	const clone = await source.executeSlashCommand({ command: "clone", sessionId: created.id });
	assert.equal(clone.openSessionId, "ps_local_clone");

	await source.close();
});

test("local CLI source resolves canonical room titles and hydrates existing room transcripts", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const room = rooms.createRoom({ id: "room_named", name: "Original Room", type: "chat" });
	rooms.updateRoom(room.id, { name: "Renamed Web Room" });
	const history = sessionStore.create({ id: "ps_history", piSessionId: "pi_history", channel: "chat-web", kind: "chat", profile: "base", title: "History Session", metadata: { chatRoomId: room.id, chatRoomName: "Stale Room Name", status: "idle" } });
	dataStore.eventLog.appendEvent({ sessionId: history.id, sessionSequence: 1, roomId: room.id, topic: "chat", type: "user.message.accepted", source: "test", actorType: "user", actorId: "test-user", eventId: "evt_history_user", retentionClass: "chat_message", previewText: "Existing user prompt", attributes: { inlineText: "Existing user prompt", clientTxnId: "txn_history_user" }, createdAt: fixedNow });
	dataStore.eventLog.appendEvent({ sessionId: history.id, sessionSequence: 2, roomId: room.id, topic: "chat", type: "assistant_message", source: "test", actorType: "assistant", actorId: "base", eventId: "evt_history_assistant", retentionClass: "chat_message", previewText: "Existing assistant reply", createdAt: fixedNow });
	const source = new LocalCliSessionSource({ dataStore, sessionStore, now: () => fixedNow });

	assert.equal((await source.listRooms()).find((candidate) => candidate.id === room.id)?.title, "Renamed Web Room");
	const current = await source.executeSlashCommand({ command: "session-current", sessionId: history.id });
	assert.equal(current.rawResult.roomTitle, "Renamed Web Room");
	const opened = await source.openSession(history.id);
	const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user", "message.assistant"]);
	assert.match(JSON.stringify(rows), /Existing user prompt/);

	await source.close();
	dataStore.close();
});

test("local CLI session source reports clear errors and current-session agent limits", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow, agentSummaries: [{ id: "base", name: "base", profileName: "base", description: "Built-in" }, { id: "custom-agent", name: "custom-agent", profileName: "custom-agent", description: "Custom agent" }] });
	assert.deepEqual(await source.listSessions(), []);
	assert.equal((await source.getStatus()).message, "Local CLI source ready; discovered 0 sessions.");

	await assert.rejects(() => source.openSession("missing"), (error) => error instanceof CliSourceError && error.code === "session_not_found");
	await assert.rejects(() => source.sendMessage("missing", "   "), (error) => error instanceof CliSourceError && error.code === "empty_message");
	await assert.rejects(() => source.createSession({ agentId: "missing-agent" }), (error) => error instanceof CliSourceError && error.code === "agent_not_found");
	assert.deepEqual((await source.listAgents()).map((agent) => agent.id), ["base", "custom-agent"]);
	const created = await source.createSession({ title: "Agent unchanged", profile: "base" });
	assert.equal((await source.setSessionAgent(created.id, "base")).profile, "base");
	await assert.rejects(() => source.setSessionAgent(created.id, "custom-agent"), (error) => error instanceof CliSourceError && error.code === "unsupported");

	await source.close();
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("legacy CLI repair API is neutral and returns no owner fields", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const room = rooms.ensureDefaultRoom({ name: "Shared Chat" });
	const source = new LocalCliSessionSource({ dataStore, sessionStore, now: () => fixedNow });
	assert.equal(typeof source.repairLegacyUserUnknownSessions, "undefined");
	const result = await source.repairLegacyCliSessions({ roomId: room.id });
	assert.deepEqual(result, { roomId: room.id, scanned: 0, repaired: 0, skipped: 0, sessionIds: [] });
	assertNoOwnerFields(result, "repair result");
	await source.close();
	dataStore.close();
});

test("CLI status redaction removes common secret-shaped values", () => {
	const redacted = redactCliSecretText("api-key:sk-secretvalue token=ghp_abcdefghijklmnopqrstuvwxyz password:supersecret");
	assert.doesNotMatch(redacted, /sk-secretvalue|ghp_abcdefghijklmnopqrstuvwxyz|supersecret/);
	assert.match(redacted, /\[redacted\]/);
});

test("CLI session source modules avoid renderer dependencies and owner-selection contracts", () => {
	const sourceDir = path.resolve("src/cli-session");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|ink|react-dom|react-virtuoso|lucide-react|@uiw\/react-json-view|react-markdown)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|className=/i, `${file} must not use browser presentation APIs`);
		assert.doesNotMatch(source, /CliOwnerSummary|getActiveOwner|setActiveOwner|listOwners|ownerSummaries|activeOwnerScope|activeOwnerLabel|session_owner_mismatch/, `${file} must not expose owner-selection contracts`);
	}
});
