import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Isolate PIBO_HOME so the address file never touches the real home.
const isolatedHome = mkdtempSync(join(tmpdir(), "remote-svc-home-"));
process.env.PIBO_HOME = join(isolatedHome, ".pibo");
import { PiboRemoteAgentService } from "../dist/remote-agent/service.js";
import { PiboRemoteAgentStore } from "../dist/remote-agent/store.js";
import { effectiveRemoteMode, RemoteAgentError } from "../dist/remote-agent/types.js";

function fakeSessionStore() {
	const sessions = new Map();
	return {
		sessions,
		get: (id) => sessions.get(id),
		find: () => [...sessions.values()],
		create: (input) => {
			const session = { id: `ps_${sessions.size + 1}`, piSessionId: "", channel: input.channel, kind: input.kind, profile: input.profile, workspace: input.workspace, title: input.title, metadata: input.metadata ?? {}, createdAt: "2026-09-19T12:00:00.000Z", updatedAt: "2026-09-19T12:00:00.000Z" };
			sessions.set(session.id, session);
			return session;
		},
		update: () => undefined,
	};
}

const fakeDataStore = {
	messages: { listMessages: () => [] },
	observations: { listObservations: () => [] },
};

const services = [];
after(async () => {
	for (const service of services.splice(0)) {
		await service.stop().catch(() => {});
		service.close();
	}
	rmSync(isolatedHome, { recursive: true, force: true });
});

function createService() {
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: ":memory:" }),
		sessionStore: fakeSessionStore(),
		dataStore: fakeDataStore,
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
	});
	services.push(service);
	return service;
}

test("room lifecycle: enable, code, redeem, disable revokes", async () => {
	const service = createService();
	const sandbox = mkdtempSync(join(tmpdir(), "remote-svc-"));
	try {
		assert.throws(() => service.createDeviceCode("room-a"), (error) => error instanceof RemoteAgentError && error.code === "room_inactive");
		const config = service.setRoomConfig("room-a", { enabled: true, sandboxPath: sandbox, modules: { sessions: true, observe: true, files: false, bash: false } });
		assert.equal(config.enabled, true);
		assert.equal(effectiveRemoteMode(config), "sandbox");
		const { code } = service.createDeviceCode("room-a", "agent-1");
		const { token, info } = service.redeemDeviceCode(code);
		assert.deepEqual(info.modules, ["sessions", "observe"]);
		assert.equal(service.listTokens("room-a").length, 1);
		assert.equal(service.status().connections, 1);
		const disabled = service.setRoomConfig("room-a", { enabled: false });
		assert.equal(disabled.enabled, false);
		assert.equal(service.listTokens("room-a")[0]?.revoked, true);
		assert.equal(service.status().connections, 0);
		assert.ok(token.startsWith("pibo_remote_"));
	} finally {
		rmSync(sandbox, { recursive: true, force: true });
	}
});

test("pi runtime reports yolo and rejects unknown modules", () => {
	const service = createService();
	const config = service.setRoomConfig("room-a", { enabled: true, runtime: "pi", mode: "sandbox", sandboxPath: join(tmpdir(), "remote-pi-sandbox") });
	assert.equal(effectiveRemoteMode(config), "yolo");
	assert.throws(() => service.setRoomConfig("room-a", { modules: { subagents: true } }), (error) => error instanceof RemoteAgentError && error.code === "module_invalid");
	assert.throws(() => service.setRoomConfig("room-a", { mode: "party" }), (error) => error instanceof RemoteAgentError && error.code === "mode_invalid");
	rmSync(join(tmpdir(), "remote-pi-sandbox"), { recursive: true, force: true });
});

test("service starts the MCP server and reports its URL", async () => {
	const service = createService();
	assert.equal(service.status().running, false);
	const address = await service.ensureStarted();
	assert.match(address.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
	assert.equal(service.status().running, true);
	await service.stop();
	assert.equal(service.status().running, false);
});

test("observe resolves full message and observation content", async () => {
	const messagePayload = `P${"q".repeat(599)}`;
	const toolStdout = `X${"w".repeat(599)}`;
	const sessionStore = fakeSessionStore();
	sessionStore.sessions.set("ps_1", { id: "ps_1", title: "Alpha", profile: "default", metadata: { chatRoomId: "room-a" } });
	const dataStore = {
		messages: {
			listMessages: () => [
				{ id: "m1", sessionId: "ps_1", role: "assistant", contentPreview: "PAY", contentPayloadRef: "pay-msg", createdAt: "2026-09-19T10:00:00.000Z", attributes: {} },
				{ id: "m2", sessionId: "ps_1", role: "user", contentPreview: "inl", createdAt: "2026-09-19T10:01:00.000Z", attributes: { inlineText: "inline full user text" } },
				{ id: "m3", sessionId: "ps_1", role: "assistant", contentPreview: "only preview", createdAt: "2026-09-19T10:02:00.000Z", attributes: {} },
			],
		},
		observations: {
			listObservations: () => [
				{ sequence: 1, kind: "tool", status: "completed", startedAt: "2026-09-19T10:00:30.000Z", previewText: "read", payloadRef: "pay-obs", name: "read", eventStreamId: 7, attributes: { eventType: "tool_execution_finished" } },
				{ sequence: 2, kind: "tool", status: "completed", startedAt: "2026-09-19T10:00:40.000Z", previewText: "bash", name: "bash", eventStreamId: 8, attributes: { eventType: "tool_call" } },
			],
		},
		eventLog: {
			listEvents: () => [
				{ streamId: 7, toolCallId: "tc-9", runId: "run-9", turnId: "turn-9", attributes: {} },
				{ streamId: 8, toolCallId: "tc-10", runId: "run-9", turnId: "turn-9", attributes: { inlinePayload: { cmd: "ls -la" } } },
			],
		},
		payloads: {
			getPayload: (id) => id === "pay-msg"
				? { contentType: "text/plain; charset=utf-8" }
				: id === "pay-obs" ? { contentType: "application/json" } : undefined,
			readPayloadText: (id) => {
				assert.equal(id, "pay-msg");
				return messagePayload;
			},
			readPayloadJson: (id) => {
				assert.equal(id, "pay-obs");
				return { stdout: toolStdout };
			},
		},
	};
	const service = new PiboRemoteAgentService({
		store: new PiboRemoteAgentStore({ path: ":memory:" }),
		sessionStore,
		dataStore,
		sendMessage: async () => ({ eventId: "ev_1", reply: "ok" }),
	});
	services.push(service);
	const observe = service.catalogTools().find((tool) => tool.name === "remote_session_observe");
	assert.ok(observe);
	const context = { roomId: "room-a", tokenId: "t1", label: "test", mode: "sandbox", sandboxRoot: tmpdir(), cwd: tmpdir(), toolCallId: "call-1" };
	const page = await observe.execute({
		sessionId: "ps_1",
		cursorMode: "history",
		eventTypes: ["user_message", "assistant_message", "tool_call", "tool_execution_finished"],
		includeTools: true,
		toolDetail: "full",
	}, context);
	assert.ok(page.text.includes(messagePayload));
	assert.ok(page.text.includes("inline full user text"));
	assert.ok(page.text.includes("only preview"));
	assert.ok(page.text.includes(toolStdout));
	assert.ok(page.text.includes("toolCallId=tc-9"));
	assert.ok(page.text.includes("toolCallId=tc-10"));
	assert.ok(page.text.includes("ls -la"));
	const byCall = await observe.execute({ sessionId: "ps_1", cursorMode: "history", toolCallIds: ["tc-10"] }, context);
	assert.equal(byCall.details.observations.length, 1);
	await assert.rejects(
		observe.execute({ sessionId: "ps_1", cursorMode: "history" }, { ...context, roomId: "room-b" }),
		(error) => error instanceof RemoteAgentError && error.code === "session_forbidden",
	);
});
