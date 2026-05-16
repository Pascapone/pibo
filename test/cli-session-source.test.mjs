import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildCompactTerminalRows } from "../dist/session-ui/index.js";
import { CliSourceError, createDefaultFakeCliSessionSource, LocalCliSessionSource, redactCliSecretText } from "../dist/cli-session/index.js";
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
	assert.deepEqual(rooms, [{ id: "room_one", title: "Main Room", description: "Derived from local session metadata" }]);

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

test("local CLI session source reports clear unsupported states and closes cleanly", async () => {
	const store = new InMemoryPiboSessionStore();
	const source = new LocalCliSessionSource({ sessionStore: store, now: () => fixedNow });
	assert.deepEqual(await source.listRooms(), []);
	assert.deepEqual(await source.listSessions(), []);
	const status = await source.getStatus();
	assert.equal(status.rooms, "unknown");
	assert.equal(status.message, "Local CLI source ready; discovered 0 sessions.");

	await assert.rejects(() => source.createSession({ title: "Later" }), (error) => error instanceof CliSourceError && error.code === "unsupported");
	await assert.rejects(() => source.openSession("missing"), (error) => error instanceof CliSourceError && error.code === "unsupported");
	await assert.rejects(() => source.sendMessage("missing", "hello"), (error) => error instanceof CliSourceError && error.code === "unsupported");
	await assert.rejects(() => source.setSessionAgent("missing", "pibo-agent"), (error) => error instanceof CliSourceError && error.code === "unsupported");

	source.close();
	await assert.rejects(() => source.listSessions(), (error) => error instanceof CliSourceError && error.code === "source_closed");
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
