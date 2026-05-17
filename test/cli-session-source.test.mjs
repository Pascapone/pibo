import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { CliSourceError, CLI_ROOT_RECOVERY_OWNER_SCOPE, cliDefaultRoomIdForOwner, createDefaultFakeCliSessionSource, FakeCliSessionSource, LocalCliSessionSource, redactCliSecretText } from "../dist/cli-session/index.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

const fixedNow = "2026-05-16T12:00:00.000Z";

test("fake CLI session source exposes deterministic rooms sessions agents and status", async () => {
	const source = createDefaultFakeCliSessionSource();

	const rooms = await source.listRooms();
	assert.deepEqual(rooms, [{ id: "room_fake_main", title: "Fake Room", description: "Deterministic CLI session source room" }]);

	const sessions = await source.listSessions({ roomId: "room_fake_main" });
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].id, "ps_fake_existing");
	assert.equal(sessions[0].profile, "pibo-agent");
	assert.equal(sessions[0].updatedAt, fixedNow);

	const agents = await source.listAgents();
	assert.deepEqual(agents.map((agent) => agent.id), ["pibo-agent", "codex-compat-openai-web"]);

	const commands = await source.listSlashCommands();
	assert.ok(commands.some((command) => command.slash === "/help"));
	assert.ok(commands.some((command) => command.slash === "/thinking"));
	assert.ok(commands.some((command) => command.slash === "/download" && command.support === "terminal-adapted"));

	const status = await source.getStatus({ sessionId: "ps_fake_existing" });
	assert.equal(status.source, "fake");
	assert.equal(status.mode, "fake");
	assert.equal(status.connected, true);
	assert.equal(status.activeSessionId, "ps_fake_existing");
	assert.equal(status.activeAgentId, "pibo-agent");
	assert.equal(status.updatedAt, fixedNow);
});

test("fake CLI session source opens trace fixtures compatible with shared compact rows", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");

	assert.equal(opened.session.title, "Existing fake session");
	assert.equal(opened.traceView?.piboSessionId, "ps_fake_existing");
	const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user", "message.assistant"]);
	assert.match(JSON.stringify(rows), /Hello from fake source/);
	assert.match(JSON.stringify(rows), /Fake assistant response/);

	opened.close();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);
});

test("fake CLI session source emits trace and session updates and cleans subscriptions", async () => {
	const source = createDefaultFakeCliSessionSource();
	const opened = await source.openSession("ps_fake_existing");
	const updates = [];
	const unsubscribe = opened.subscribe((update) => updates.push(update));

	await source.sendMessage("ps_fake_existing", "Follow up from test");
	assert.equal(source.listenerCount("ps_fake_existing"), 1);
	assert.deepEqual(updates.map((update) => update.type), ["session", "trace"]);
	assert.match(JSON.stringify(updates.at(-1).traceView), /Follow up from test/);

	unsubscribe();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);

	const secondOpened = await source.openSession("ps_fake_existing");
	secondOpened.subscribe(() => {});
	assert.equal(source.listenerCount("ps_fake_existing"), 1);
	secondOpened.close();
	assert.equal(source.listenerCount("ps_fake_existing"), 0);

	const thirdOpened = await source.openSession("ps_fake_existing");
	thirdOpened.subscribe(() => {});
	source.close();
	assert.equal(source.listenerCount(), 0);
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("fake CLI session source switches active owners and filters owner-scoped rooms and sessions", async () => {
	const source = new FakeCliSessionSource({
		owners: [
			{ ownerScope: "user:alpha", label: "Alpha", kind: "web-user" },
			{ ownerScope: "user:beta", label: "Beta", kind: "web-user" },
		],
		rooms: [
			{ id: "room_alpha", title: "Alpha Room", ownerScope: "user:alpha" },
			{ id: "room_beta", title: "Beta Room", ownerScope: "user:beta" },
		],
		sessions: [
			{ id: "ps_alpha", title: "Alpha Session", roomId: "room_alpha", ownerScope: "user:alpha", profile: "pibo-agent", status: "idle" },
			{ id: "ps_beta", title: "Beta Session", roomId: "room_beta", ownerScope: "user:beta", profile: "pibo-agent", status: "idle" },
		],
	});

	assert.equal((await source.getActiveOwner()).ownerScope, "user:alpha");
	assert.deepEqual((await source.listRooms()).map((room) => room.id), ["room_alpha"]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), ["ps_alpha"]);

	await source.setActiveOwner("user:beta");
	assert.equal((await source.getActiveOwner()).ownerScope, "user:beta");
	assert.deepEqual((await source.listRooms()).map((room) => room.id), ["room_beta"]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), ["ps_beta"]);
	const created = await source.createSession({ roomId: "room_beta", title: "Beta Created" });
	assert.equal(created.ownerScope, "user:beta");
	assert.equal(created.roomId, "room_beta");
});

test("fake CLI session source creates sessions and applies existing agents only", async () => {
	const source = createDefaultFakeCliSessionSource();
	const created = await source.createSession({ roomId: "room_fake_main", title: "Created from test", agentId: "codex-compat-openai-web" });

	assert.equal(created.id, "ps_fake_created_1");
	assert.equal(created.profile, "codex-compat-openai-web");
	assert.equal(created.agentId, "codex-compat-openai-web");
	assert.equal(created.createdAt, fixedNow);

	const opened = await source.openSession(created.id);
	assert.deepEqual(opened.traceView?.nodes, []);

	const updated = await source.setSessionAgent(created.id, "pibo-agent");
	assert.equal(updated.profile, "pibo-agent");
	assert.equal(updated.agentId, "pibo-agent");

	await assert.rejects(
		() => source.setSessionAgent(created.id, "missing-agent"),
		(error) => error instanceof CliSourceError && error.code === "agent_not_found",
	);
});

test("local CLI session source lists existing sessions, derived rooms, agents, and redacted status", async () => {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_cli_local_a",
		piSessionId: "pi_cli_local_a",
		channel: "chat-web",
		kind: "chat",
		profile: "pibo-agent",
		ownerScope: "user:one",
		workspace: "/workspace/project-a",
		title: "Local A",
		metadata: { chatRoomId: "room_one", chatRoomName: "Main Room", status: "idle" },
		activeModel: { provider: "openai", id: "gpt-test" },
	});
	store.create({
		id: "ps_cli_local_b",
		piSessionId: "pi_cli_local_b",
		channel: "chat-web",
		kind: "chat",
		profile: "codex-compat-openai-web",
		ownerScope: "user:two",
		title: "Hidden for owner filter",
		metadata: { chatRoomId: "room_two", status: "running" },
	});
	const source = new LocalCliSessionSource({
		sessionStore: store,
		ownerScope: "user:one",
		now: () => fixedNow,
		statusMessage: "OPENAI_API_KEY=sk-testsecret token:abcdef123456 password=hunter2",
	});

	const rooms = await source.listRooms();
	assert.ok(rooms.some((room) => room.title === "Personal Chat" && room.ownerScope === "user:one" && room.isDefault === true));
	assert.ok(rooms.some((room) => room.id === "room_one" && room.title === "Main Room" && room.ownerScope === "user:one"));

	const sessions = await source.listSessions({ roomId: "room_one" });
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].id, "ps_cli_local_a");
	assert.equal(sessions[0].status, "idle");
	assert.deepEqual(sessions[0].model, { provider: "openai", id: "gpt-test" });
	assert.equal(sessions[0].workspace, "/workspace/project-a");

	const agents = await source.listAgents();
	assert.ok(agents.some((agent) => agent.id === "codex-compat-openai-web"));

	const status = await source.getStatus({ sessionId: "ps_cli_local_a" });
	assert.equal(status.source, "local/direct");
	assert.equal(status.mode, "local");
	assert.equal(status.rooms, "supported");
	assert.equal(status.sessions, "supported");
	assert.equal(status.activeRoomId, "room_one");
	assert.equal(status.activeAgentId, "pibo-agent");
	assert.equal(status.updatedAt, fixedNow);
	assert.doesNotMatch(status.message ?? "", /sk-testsecret|abcdef123456|hunter2/);
	assert.match(status.message ?? "", /\[redacted\]/);
});

test("local CLI session source resolves Root recovery owner and default Personal Chat when no owners exist", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow });

	const activeOwner = await source.getActiveOwner();
	assert.equal(activeOwner.ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(activeOwner.kind, "root-recovery");
	assert.equal(activeOwner.isFallback, true);
	assert.deepEqual((await source.listOwners()).map((owner) => owner.ownerScope), [CLI_ROOT_RECOVERY_OWNER_SCOPE]);

	const rooms = await source.listRooms();
	assert.equal(rooms[0].id, cliDefaultRoomIdForOwner(CLI_ROOT_RECOVERY_OWNER_SCOPE));
	assert.equal(rooms[0].title, "Personal Chat");
	assert.equal(rooms[0].ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(rooms[0].isDefault, true);

	const created = await source.createSession({ title: "Root recovery created", profile: "codex-compat-openai-web" });
	assert.equal(created.ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.equal(created.roomId, rooms[0].id);
	assert.equal(store.get(created.id).ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.notEqual(created.ownerScope, "user:unknown");
});

test("local CLI session source discovers one owner and multiple owners from sessions rooms navigation and custom agents", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	rooms.createRoom({ id: "room_two", ownerScope: "user:two", name: "Two Room", type: "chat" });
	dataStore.navigation.upsertSession({ ownerScope: "user:three", roomId: "room_three", sessionId: "ps_nav_three", title: "Nav Three", profile: "pibo-agent", status: "idle", lastActivityAt: fixedNow, sortKey: fixedNow, updatedAt: fixedNow });
	dataStore.eventLog.appendEvent({ sessionId: "ps_event_four", roomId: "room_four", topic: "chat", type: "message.accepted", source: "test", actorType: "user", actorId: "user:four", retentionClass: "standard", previewText: "owner discovery", createdAt: fixedNow });
	const session = sessionStore.create({ id: "ps_owner_one", piSessionId: "pi_owner_one", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:one", title: "Owner One", metadata: { chatRoomId: "room_one", chatRoomName: "One Room", status: "idle" } });
	assert.equal(session.ownerScope, "user:one");

	const source = new LocalCliSessionSource({
		dataStore,
		sessionStore,
		ownerSummaries: [{ ownerScope: "user:custom", label: "Custom owner", description: "custom agent", kind: "web-user" }],
		now: () => fixedNow,
	});

	const ownerScopes = (await source.listOwners()).map((owner) => owner.ownerScope);
	assert.deepEqual(ownerScopes, ["user:custom", "user:four", "user:one", "user:three", "user:two", CLI_ROOT_RECOVERY_OWNER_SCOPE]);
	assert.equal((await source.getActiveOwner()).ownerScope, "user:custom");

	await source.setActiveOwner("user:two");
	assert.equal((await source.getActiveOwner()).ownerScope, "user:two");
	assert.ok((await source.listRooms()).every((room) => room.ownerScope === "user:two"));

	const oneSource = new LocalCliSessionSource({ sessionStore, ownerScope: "user:one", dataStore, now: () => fixedNow });
	assert.equal((await oneSource.getActiveOwner()).ownerScope, "user:one");
	const oneRooms = await oneSource.listRooms();
	assert.ok(oneRooms.some((room) => room.title === "Personal Chat" && room.isDefault === true));
	assert.ok(oneRooms.some((room) => room.id === "room_one"));
	await source.close();
	await oneSource.close();
	dataStore.close();
});

test("local CLI session source owner and room contract filters sessions and creates in selected owner default room", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const defaultRoom = rooms.ensureDefaultRoom({ ownerScope: "user:one", principalId: "user:one", name: "Personal Chat" });
	rooms.createRoom({ id: "room_two", ownerScope: "user:two", name: "Other Owner Room", type: "chat" });
	const one = sessionStore.create({ id: "ps_filter_one", piSessionId: "pi_filter_one", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:one", title: "Filter One", metadata: { chatRoomId: defaultRoom.id, chatRoomName: "Personal Chat", status: "idle" } });
	const two = sessionStore.create({ id: "ps_filter_two", piSessionId: "pi_filter_two", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:two", title: "Filter Two", metadata: { chatRoomId: "room_two", chatRoomName: "Other Owner Room", status: "idle" } });

	const source = new LocalCliSessionSource({ dataStore, sessionStore, ownerScope: "user:one", now: () => fixedNow });
	assert.deepEqual((await source.listSessions()).map((session) => session.id), [one.id]);
	assert.deepEqual((await source.listSessions({ ownerScope: "user:two" })).map((session) => session.id), [two.id]);
	assert.deepEqual((await source.listSessions({ roomId: defaultRoom.id })).map((session) => session.id), [one.id]);

	const created = await source.createSession({ title: "Created in default", profile: "codex-compat-openai-web" });
	assert.equal(created.ownerScope, "user:one");
	assert.equal(created.roomId, defaultRoom.id);
	const persisted = dataStore.db.prepare("SELECT owner_scope, room_id FROM sessions WHERE id = ?").get(created.id);
	assert.equal(persisted.owner_scope, "user:one");
	assert.equal(persisted.room_id, defaultRoom.id);

	await source.close();
	dataStore.close();
});

test("local CLI session source writes Web-visible navigation and message read models for selected owner and room", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const room = rooms.ensureDefaultRoom({ ownerScope: "user:web", principalId: "user:web", name: "Personal Chat" });
	const listeners = new Set();
	const router = {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
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
	const source = new LocalCliSessionSource({ dataStore, sessionStore, router, ownerScope: "user:web", now: () => fixedNow });

	const created = await source.createSession({ roomId: room.id, title: "Web Visible CLI", profile: "codex-compat-openai-web" });
	assert.equal(created.ownerScope, "user:web");
	assert.equal(created.roomId, room.id);

	const sessionRow = dataStore.db.prepare("SELECT owner_scope, room_id FROM sessions WHERE id = ?").get(created.id);
	assert.equal(sessionRow.owner_scope, "user:web");
	assert.equal(sessionRow.room_id, room.id);
	const navigationAfterCreate = dataStore.db.prepare("SELECT owner_scope, room_id, status FROM session_navigation WHERE session_id = ?").get(created.id);
	assert.equal(navigationAfterCreate.owner_scope, "user:web");
	assert.equal(navigationAfterCreate.room_id, room.id);
	assert.equal(navigationAfterCreate.status, "idle");

	const opened = await source.openSession(created.id);
	opened.subscribe(() => {});
	await source.sendMessage(created.id, "Persist this CLI message");

	const navigationAfterSend = dataStore.db.prepare("SELECT owner_scope, room_id, status, last_message_preview FROM session_navigation WHERE session_id = ?").get(created.id);
	assert.equal(navigationAfterSend.owner_scope, "user:web");
	assert.equal(navigationAfterSend.room_id, room.id);
	assert.equal(navigationAfterSend.status, "idle");
	assert.match(navigationAfterSend.last_message_preview, /Persisted assistant reply|Persist this CLI message/);
	const messages = dataStore.db.prepare("SELECT role, actor_id, room_id, content_preview FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC").all(created.id);
	assert.deepEqual(messages.map((row) => row.role), ["user", "assistant"]);
	assert.equal(messages[0].actor_id, "user:web");
	assert.equal(messages[0].room_id, room.id);
	assert.match(messages[0].content_preview, /Persist this CLI message/);
	assert.equal(messages[1].room_id, room.id);
	assert.match(messages[1].content_preview, /Persisted assistant reply/);
	const events = dataStore.db.prepare("SELECT type, room_id FROM event_log WHERE session_id = ? ORDER BY stream_id ASC").all(created.id);
	assert.ok(events.some((row) => row.type === "user.message.accepted" && row.room_id === room.id));
	assert.ok(events.some((row) => row.type === "assistant_message" && row.room_id === room.id));

	await source.close();
	dataStore.close();
});

test("local CLI session source creates opens sends and cleans local trace subscriptions", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, ownerScope: "user:one", now: () => fixedNow });

	const defaultCreated = await source.createSession({ roomId: "room_one", title: "Default CLI Created" });
	assert.ok(defaultCreated.profile.length > 0);
	const created = await source.createSession({ roomId: "room_one", title: "CLI Created", agentId: "codex-compat-openai-web", workspace: "/workspace/cli" });
	assert.equal(created.title, "CLI Created");
	assert.equal(created.profile, "codex-compat-openai-web");
	assert.equal(created.ownerScope, "user:one");
	assert.equal(created.roomId, "room_one");
	assert.equal(created.workspace, "/workspace/cli");
	assert.equal(created.status, "idle");

	const opened = await source.openSession(created.id);
	assert.equal(opened.traceView?.nodes.length, 0);
	const updates = [];
	const unsubscribe = opened.subscribe((update) => updates.push(update));
	await source.sendMessage(created.id, " hello from local cli ");

	assert.equal(source.listenerCount(created.id), 1);
	assert.deepEqual(updates.map((update) => update.type), ["trace", "session"]);
	const traceUpdate = updates.find((update) => update.type === "trace");
	assert.match(JSON.stringify(traceUpdate.traceView), /hello from local cli/);
	const rows = buildCompactTerminalRows(traceUpdate.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user"]);

	unsubscribe();
	assert.equal(source.listenerCount(created.id), 0);
	const reopened = await source.openSession(created.id);
	reopened.subscribe(() => {});
	await source.close();
	assert.equal(source.listenerCount(), 0);
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("CLI session sources execute shared slash actions and normalize results", async () => {
	const fake = new FakeCliSessionSource({
		actionHandler(input) {
			if (input.command === "fast") return { mode: "fast", supported: true, changed: true };
			if (input.command === "compact") throw new Error("failed with TOKEN=secret-value");
			return undefined;
		},
	});
	const fast = await fake.executeSlashCommand({ command: "fast", sessionId: "ps_fake_existing" });
	assert.equal(fast.actionName, "fast_mode");
	assert.equal(fast.descriptor.kind, "json");
	const unsupported = await fake.executeSlashCommand({ command: "download", sessionId: "ps_fake_existing" });
	assert.equal(unsupported.descriptor.kind, "unsupported");
	assert.match(unsupported.descriptor.reason, /browser download APIs/i);
	const failed = await fake.executeSlashCommand({ command: "compact", sessionId: "ps_fake_existing" });
	assert.equal(failed.descriptor.kind, "error");
	assert.match(failed.descriptor.message, /TOKEN=\[redacted\]/);
	assert.doesNotMatch(failed.descriptor.message, /secret-value/);

	const thinking = await fake.executeSlashCommand({ command: "thinking", args: "high", sessionId: "ps_fake_existing" });
	assert.equal(thinking.descriptor.kind, "text");
	assert.match(thinking.descriptor.text, /Thinking level set to high/);
	const modelMenu = await fake.executeSlashCommand({ command: "model", sessionId: "ps_fake_existing" });
	assert.equal(modelMenu.descriptor.kind, "menu");
	assert.match(JSON.stringify(modelMenu.rawResult), /gpt-fake-mini/);
	const modelSet = await fake.executeSlashCommand({ command: "model", args: "openai/gpt-fake-mini", sessionId: "ps_fake_existing" });
	assert.equal(modelSet.descriptor.kind, "text");
	assert.deepEqual((await fake.getStatus({ sessionId: "ps_fake_existing" })).activeModel, { provider: "openai", id: "gpt-fake-mini" });

	const cloned = await fake.executeSlashCommand({ command: "clone", sessionId: "ps_fake_existing" });
	assert.equal(cloned.descriptor.kind, "session-link");
	assert.match(cloned.openSessionId, /^ps_fake_clone_/);
	assert.equal((await fake.openSession(cloned.openSessionId)).session.id, cloned.openSessionId);
});

test("local CLI session source routes slash actions under the selected owner and opens clone results", async () => {
	const store = new InMemoryPiboSessionStore();
	const emitted = [];
	const router = {
		subscribe() {
			return () => {};
		},
		async emit(event) {
			emitted.push(event);
			if (event.action === "status") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { piboSessionId: event.piboSessionId, activeModel: { provider: "openai", id: "gpt-local", label: "GPT Local" }, contextUsage: { tokens: 250, contextWindow: 1000, percent: 25 }, providerUsage: { provider: "openai", planType: "test", limits: [{ label: "requests", usedPercent: 40 }] } } };
			if (event.action === "session.clone") {
				const sourceSession = store.get(event.piboSessionId);
				const clone = store.create({
					id: "ps_local_clone",
					piSessionId: "pi_local_clone",
					channel: sourceSession.channel,
					kind: "branch",
					profile: sourceSession.profile,
					ownerScope: sourceSession.ownerScope,
					originId: sourceSession.id,
					workspace: sourceSession.workspace,
					title: "Local Clone",
					metadata: sourceSession.metadata,
				});
				return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { piboSessionId: clone.id, roomId: "room_one", title: clone.title } };
			}
			if (event.action === "clear_queue") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { cleared: 2 } };
			if (event.action === "fast_mode") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { mode: "fast", supported: true, changed: true } };
			if (event.action === "compact") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { queued: true, customInstructions: event.params?.customInstructions } };
			if (event.action === "abort") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { aborted: true } };
			if (event.action === "kill") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { killed: [event.piboSessionId], cancelledRuns: [] } };
			if (event.action === "kill_all") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { killed: [event.piboSessionId], cancelledRuns: ["run_1"] } };
			if (event.action === "thinking") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { message: `Thinking level set to ${event.params?.level}`, level: event.params?.level, supported: true, changed: true } };
			if (event.action === "model") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: event.params?.model ? { message: `Model set to ${event.params.provider}/${event.params.model}`, provider: event.params.provider, model: event.params.model, supported: true, changed: true } : { action: "show_model_menu", providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-local", label: "GPT Local" }] }] } };
			if (event.action === "login") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { action: "show_login_menu", providers: [{ id: "openai-codex", name: "OpenAI Codex", authMethods: ["device_code"] }, { id: "openai", name: "OpenAI API", authMethods: ["api_key"] }] } };
			if (event.action === "login.start") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { message: `Open ${event.params.provider} login URL`, url: "https://example.test/device", userCode: "TEST-1234" } };
			if (event.action === "session.fork_candidates") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { messages: [{ entryId: "entry_local_1", text: "Fork local prompt" }] } };
			if (event.action === "session.fork") return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { piboSessionId: event.piboSessionId, title: "Forked current", entryId: event.params.entryId } };
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { ok: true } };
		},
	};
	const source = new LocalCliSessionSource({ sessionStore: store, router, ownerScope: "user:one", now: () => fixedNow });
	const created = await source.createSession({ roomId: "room_one", title: "Action Session", profile: "codex-compat-openai-web" });

	const status = await source.executeSlashCommand({ command: "status", sessionId: created.id });
	assert.equal(status.descriptor.kind, "status");
	assert.equal(emitted.at(-1).action, "status");
	assert.equal(status.rawResult.contextUsage.percent, 25);
	assert.equal(status.rawResult.providerUsage.limits[0].usedPercent, 40);
	const cleared = await source.executeSlashCommand({ command: "clear", sessionId: created.id });
	assert.equal(cleared.actionName, "clear_queue");
	assert.equal(emitted.at(-1).action, "clear_queue");
	assert.deepEqual(cleared.rawResult, { cleared: 2 });
	const fast = await source.executeSlashCommand({ command: "fast", args: "on", sessionId: created.id });
	assert.equal(fast.actionName, "fast_mode");
	assert.equal(emitted.at(-1).action, "fast_mode");
	const thinking = await source.executeSlashCommand({ command: "thinking", args: "high", sessionId: created.id });
	assert.equal(thinking.actionName, "thinking");
	assert.deepEqual(emitted.at(-1).params, { level: "high" });
	assert.match(thinking.descriptor.text, /Thinking level set to high/);
	const modelMenu = await source.executeSlashCommand({ command: "model", sessionId: created.id });
	assert.equal(modelMenu.descriptor.kind, "menu");
	assert.match(JSON.stringify(modelMenu.rawResult), /gpt-local/);
	const modelSet = await source.executeSlashCommand({ command: "model", args: "openai/gpt-local", sessionId: created.id });
	assert.deepEqual(emitted.at(-1).params, { provider: "openai", model: "gpt-local" });
	assert.match(modelSet.descriptor.text, /Model set to openai\/gpt-local/);
	const loginMenu = await source.executeSlashCommand({ command: "login", sessionId: created.id });
	assert.equal(loginMenu.descriptor.kind, "menu");
	assert.equal(emitted.at(-1).action, "login");
	const loginStart = await source.executeSlashCommand({ command: "login", args: "openai-codex/device_code", sessionId: created.id });
	assert.equal(emitted.at(-1).action, "login.start");
	assert.deepEqual(emitted.at(-1).params, { provider: "openai-codex" });
	assert.match(loginStart.descriptor.text, /Open openai-codex login URL/);
	const apiKey = await source.executeSlashCommand({ command: "login", args: "openai/api_key", sessionId: created.id });
	assert.equal(apiKey.descriptor.kind, "text");
	assert.match(apiKey.descriptor.text, /requires secret input/);
	assert.notEqual(emitted.at(-1).action, "login.apikey");
	const forkCandidates = await source.executeSlashCommand({ command: "fork-candidates", sessionId: created.id });
	assert.equal(forkCandidates.descriptor.kind, "menu");
	assert.equal(emitted.at(-1).action, "session.fork_candidates");
	const forked = await source.executeSlashCommand({ command: "fork-candidates", args: "entry_local_1", sessionId: created.id });
	assert.equal(emitted.at(-1).action, "session.fork");
	assert.deepEqual(emitted.at(-1).params, { entryId: "entry_local_1" });
	assert.equal(forked.openSessionId, created.id);
	const compact = await source.executeSlashCommand({ command: "compact", args: "summarize safely", sessionId: created.id });
	assert.equal(compact.actionName, "compact");
	assert.equal(emitted.at(-1).action, "compact");
	assert.deepEqual(emitted.at(-1).params, { customInstructions: "summarize safely" });
	const aborted = await source.executeSlashCommand({ command: "abort", sessionId: created.id });
	assert.equal(aborted.actionName, "abort");
	assert.equal(emitted.at(-1).action, "abort");
	const killed = await source.executeSlashCommand({ command: "kill", sessionId: created.id });
	assert.equal(killed.actionName, "kill");
	assert.equal(emitted.at(-1).action, "kill");
	const killedAll = await source.executeSlashCommand({ command: "kill-all", sessionId: created.id });
	assert.equal(killedAll.actionName, "kill_all");
	assert.equal(emitted.at(-1).action, "kill_all");
	const current = await source.executeSlashCommand({ command: "session-current", sessionId: created.id });
	assert.equal(current.descriptor.kind, "session-link");
	assert.equal(current.openSessionId, created.id);
	const sessions = await source.executeSlashCommand({ command: "sessions", sessionId: created.id });
	assert.equal(sessions.descriptor.kind, "json");
	assert.match(JSON.stringify(sessions.rawResult), /Action Session/);
	const clone = await source.executeSlashCommand({ command: "clone", sessionId: created.id });
	assert.equal(clone.actionName, "session.clone");
	assert.equal(clone.openSessionId, "ps_local_clone");
	assert.equal((await source.openSession(clone.openSessionId)).session.id, "ps_local_clone");

	await source.close();
});

test("local CLI session source can project router live events into trace updates", async () => {
	const store = new InMemoryPiboSessionStore();
	const listeners = new Set();
	const router = {
		emitted: [],
		disposed: false,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async emit(event) {
			this.emitted.push(event);
			for (const listener of listeners) {
				listener({ type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 1, text: event.text, source: event.source });
				listener({ type: "assistant_delta", piboSessionId: event.piboSessionId, eventId: event.id, assistantIndex: 0, contentIndex: 0, text: "partial " });
				listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, assistantIndex: 0, contentIndex: 0, text: "partial done" });
				listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id, source: event.source });
			}
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: 1, text: event.text, source: event.source };
		},
		getSessionRuntimeStatus() {
			return { piboSessionId: "unused", queuedMessages: 1, processing: true, streaming: false, activeTools: [], enabledTools: [], cwd: "/workspace", disposed: false };
		},
		async disposeAll() {
			this.disposed = true;
		},
	};
	const source = new LocalCliSessionSource({ sessionStore: store, router, ownsRouter: true, now: () => fixedNow });
	const created = await source.createSession({ title: "Router Session", profile: "codex-compat-openai-web" });
	const opened = await source.openSession(created.id);
	const updates = [];
	opened.subscribe((update) => updates.push(update));

	await source.sendMessage(created.id, "route me");
	assert.equal(router.emitted.length, 1);
	assert.equal(router.emitted[0].type, "message");
	assert.equal(updates.filter((update) => update.type === "trace").length, 3);
	assert.match(JSON.stringify(updates.at(-2).traceView), /partial done/);
	assert.equal((await source.getStatus({ sessionId: created.id })).message, "Runtime ready; queued=1 processing=true streaming=false");

	await source.close();
	assert.equal(router.disposed, true);
	assert.equal(listeners.size, 0);
});

test("local CLI session source reports clear errors and current-session agent limits", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow, agentSummaries: [{ id: "codex-compat-openai-web", name: "codex-compat-openai-web", profileName: "codex-compat-openai-web", description: "Built-in" }, { id: "custom-agent", name: "custom-agent", profileName: "custom-agent", description: "Custom agent" }] });
	const rooms = await source.listRooms();
	assert.equal(rooms.length, 1);
	assert.equal(rooms[0].ownerScope, CLI_ROOT_RECOVERY_OWNER_SCOPE);
	assert.deepEqual(await source.listSessions(), []);
	const status = await source.getStatus();
	assert.equal(status.rooms, "supported");
	assert.equal(status.message, "Local CLI source ready; discovered 0 sessions.");

	await assert.rejects(() => source.openSession("missing"), (error) => error instanceof CliSourceError && error.code === "session_not_found");
	await assert.rejects(() => source.sendMessage("missing", "hello"), (error) => error instanceof CliSourceError && error.code === "session_not_found");
	await assert.rejects(() => source.sendMessage("missing", "   "), (error) => error instanceof CliSourceError && error.code === "empty_message");
	await assert.rejects(() => source.createSession({ agentId: "missing-agent" }), (error) => error instanceof CliSourceError && error.code === "agent_not_found");
	assert.deepEqual((await source.listAgents()).map((agent) => agent.id), ["codex-compat-openai-web", "custom-agent"]);
	const commands = await source.listSlashCommands();
	assert.ok(commands.some((command) => command.slash === "/status" && command.actionName === "status"));
	assert.ok(commands.some((command) => command.slash === "/clone" && command.actionName === "session.clone"));
	assert.match(commands.find((command) => command.slash === "/session").description, /Select a room/);

	const created = await source.createSession({ title: "Agent unchanged", profile: "codex-compat-openai-web" });
	assert.equal((await source.setSessionAgent(created.id, "codex-compat-openai-web")).profile, "codex-compat-openai-web");
	await assert.rejects(() => source.setSessionAgent(created.id, "custom-agent"), (error) => error instanceof CliSourceError && error.code === "unsupported");

	await source.close();
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
});

test("local CLI session source repairs legacy user:unknown CLI sessions to selected owner and room", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const targetRoom = rooms.ensureDefaultRoom({ ownerScope: "user:repair", principalId: "user:repair", name: "Personal Chat" });
	const legacy = sessionStore.create({
		id: "ps_legacy_unknown",
		piSessionId: "pi_legacy_unknown",
		channel: "cli-session-ui",
		kind: "chat",
		profile: "pibo-agent",
		ownerScope: "user:unknown",
		title: "Legacy Unknown",
		metadata: { source: "pibo tui:sessions", status: "idle" },
	});
	sessionStore.create({
		id: "ps_non_cli_unknown",
		piSessionId: "pi_non_cli_unknown",
		channel: "chat-web",
		kind: "chat",
		profile: "pibo-agent",
		ownerScope: "user:unknown",
		title: "Non CLI Unknown",
		metadata: { status: "idle" },
	});
	const source = new LocalCliSessionSource({ dataStore, sessionStore, ownerScope: "user:repair", now: () => fixedNow });

	assert.deepEqual((await source.listOwners()).map((owner) => owner.ownerScope), ["user:repair", CLI_ROOT_RECOVERY_OWNER_SCOPE]);
	assert.deepEqual((await source.listSessions()).map((session) => session.id), []);
	const result = await source.repairLegacyUserUnknownSessions({ ownerScope: "user:repair", roomId: targetRoom.id });

	assert.equal(result.scanned, 2);
	assert.equal(result.repaired, 1);
	assert.equal(result.skipped, 1);
	assert.deepEqual(result.sessionIds, [legacy.id]);
	const repairedSession = dataStore.db.prepare("SELECT owner_scope, room_id FROM sessions WHERE id = ?").get(legacy.id);
	assert.equal(repairedSession.owner_scope, "user:repair");
	assert.equal(repairedSession.room_id, targetRoom.id);
	const repairedNavigation = dataStore.db.prepare("SELECT owner_scope, room_id, status FROM session_navigation WHERE session_id = ?").get(legacy.id);
	assert.equal(repairedNavigation.owner_scope, "user:repair");
	assert.equal(repairedNavigation.room_id, targetRoom.id);
	assert.equal(repairedNavigation.status, "idle");
	const notRepaired = dataStore.db.prepare("SELECT owner_scope FROM sessions WHERE id = ?").get("ps_non_cli_unknown");
	assert.equal(notRepaired.owner_scope, "user:unknown");
	assert.deepEqual((await source.listSessions({ roomId: targetRoom.id })).map((session) => session.id), [legacy.id]);
	await assert.rejects(() => source.repairLegacyUserUnknownSessions({ ownerScope: "user:unknown" }), (error) => error instanceof CliSourceError && error.code === "invalid_owner");

	await source.close();
	dataStore.close();
});

test("local CLI session source hydrates existing room transcripts by selected owner", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const room = rooms.ensureDefaultRoom({ ownerScope: "user:history", principalId: "user:history", name: "Personal Chat" });
	const history = sessionStore.create({ id: "ps_history", piSessionId: "pi_history", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:history", title: "History Session", metadata: { chatRoomId: room.id, chatRoomName: "Personal Chat", status: "idle" } });
	sessionStore.create({ id: "ps_other_history", piSessionId: "pi_other_history", channel: "chat-web", kind: "chat", profile: "pibo-agent", ownerScope: "user:other", title: "Other History", metadata: { chatRoomId: room.id, chatRoomName: "Personal Chat", status: "idle" } });
	dataStore.eventLog.appendEvent({ sessionId: history.id, sessionSequence: 1, roomId: room.id, topic: "chat", type: "user.message.accepted", source: "test", actorType: "user", actorId: "user:history", eventId: "evt_history_user", retentionClass: "chat_message", previewText: "Existing user prompt", attributes: { inlineText: "Existing user prompt", clientTxnId: "txn_history_user" }, createdAt: fixedNow });
	dataStore.eventLog.appendEvent({ sessionId: history.id, sessionSequence: 2, roomId: room.id, topic: "chat", type: "assistant_message", source: "test", actorType: "assistant", actorId: "pibo-agent", eventId: "evt_history_assistant", retentionClass: "chat_message", previewText: "Existing assistant reply", createdAt: fixedNow });
	const source = new LocalCliSessionSource({ dataStore, sessionStore, ownerScope: "user:history", now: () => fixedNow });

	const listed = await source.listSessions({ roomId: room.id });
	assert.deepEqual(listed.map((session) => session.id), [history.id]);
	const opened = await source.openSession(history.id);
	const rows = buildCompactTerminalRows(opened.traceView, { showThinking: false });
	assert.deepEqual(rows.map((row) => row.kind), ["message.user", "message.assistant"]);
	assert.match(JSON.stringify(rows), /Existing user prompt/);
	assert.match(JSON.stringify(rows), /Existing assistant reply/);
	await assert.rejects(() => source.openSession("ps_other_history"), (error) => error instanceof CliSourceError && error.code === "session_not_found");

	await source.close();
	dataStore.close();
});

test("local CLI session source lists owner-scoped sessions without room metadata under Personal Chat", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const rooms = new ChatRoomService(dataStore);
	const defaultRoom = rooms.ensureDefaultRoom({ ownerScope: "user:default", principalId: "user:default", name: "Personal Chat" });
	const legacyRoomless = sessionStore.create({ id: "ps_roomless", piSessionId: "pi_roomless", channel: "cli-session-ui", kind: "chat", profile: "pibo-agent", ownerScope: "user:default", title: "Roomless", metadata: { status: "idle" } });
	const source = new LocalCliSessionSource({ dataStore, sessionStore, ownerScope: "user:default", now: () => fixedNow });

	const sessions = await source.listSessions({ roomId: defaultRoom.id });
	assert.deepEqual(sessions.map((session) => session.id), [legacyRoomless.id]);
	assert.equal(sessions[0].roomId, defaultRoom.id);
	const opened = await source.openSession(legacyRoomless.id);
	assert.equal(opened.session.roomId, defaultRoom.id);

	await source.close();
	dataStore.close();
});

test("CLI status redaction removes common secret-shaped values", () => {
	const redacted = redactCliSecretText("api-key:sk-secretvalue token=ghp_abcdefghijklmnopqrstuvwxyz password:supersecret");
	assert.doesNotMatch(redacted, /sk-secretvalue|ghp_abcdefghijklmnopqrstuvwxyz|supersecret/);
	assert.match(redacted, /\[redacted\]/);
});

test("CLI session source modules avoid renderer dependencies", () => {
	const sourceDir = path.resolve("src/cli-session");
	for (const file of fs.readdirSync(sourceDir).filter((name) => name.endsWith(".ts"))) {
		const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
		assert.doesNotMatch(source, /from ["'](?:react|ink|react-dom|react-virtuoso|lucide-react|@uiw\/react-json-view|react-markdown)["']/i, `${file} must not import renderer dependencies`);
		assert.doesNotMatch(source, /window\.|document\.|HTMLElement|className=/i, `${file} must not use browser presentation APIs`);
	}
});
