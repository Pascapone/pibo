import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { createDevAuthService } from "../dist/plugins/dev-auth.js";
import { createWebHostChannel } from "../dist/web/channel.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function startLoopbackChannel() {
	const storageDir = mkdtempSync(join(tmpdir(), "pibo-vscode-ext-local-auth-"));
	const channel = createWebHostChannel({ host: "127.0.0.1", port: 0, announce: false });
	const sessions = new InMemoryPiboSessionStore();
	const webApps = [
		createChatWebApp({
			agentStorePath: join(storageDir, "agents.sqlite"),
			dataStorePath: join(storageDir, "pibo-chat-v2.sqlite"),
			dataPayloadRootDir: join(storageDir, "payloads"),
			projectStorePath: join(storageDir, "projects.sqlite"),
		}),
	];
	const listeners = new Set();
	const context = {
		auth: createDevAuthService(),
		emit() {
			return Promise.resolve({ type: "execution_result", result: { ok: true } });
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		listSessions: () => sessions.list(),
		getSession: (id) => sessions.get(id),
		createSession: (input) => sessions.create(input),
		updateSession: (id, input) => sessions.update(id, input),
		deleteSession: (id) => sessions.delete(id),
		findSessions: (input) => sessions.find(input),
		listRuns: () => [],
		listSessionRuntimeStatuses: () => [],
		getGatewayActions: () => [],
		getProfiles: () => [],
		getCapabilityCatalog: () => ({
			nativeTools: [],
			skills: [],
			subagents: [],
			contextFiles: [],
			packages: [],
			piboTools: [],
			mcpServers: [],
		}),
		upsertProfile: () => {},
		getWebApps: () => webApps,
	};
	return channel
		.start(context)
		.then(() => {
			const address = channel.getAddress();
			return { channel, baseURL: `http://${address.host}:${address.port}` };
		});
}

test("vs code extension can list rooms without a cookie in local auth mode", async () => {
	const { channel, baseURL } = await startLoopbackChannel();
	try {
		// Simulates the VS Code extension's room-resolver fetch: a Node.js
		// request with no cookie, calling the rooms API directly.
		const response = await fetch(`${baseURL}/api/chat/rooms`);
		assert.equal(response.status, 200, "loopback caller must not be rejected");
		const body = await response.json();
		assert.ok(Array.isArray(body.rooms));
	} finally {
		await channel.stop?.();
	}
});

test("vs code extension can create a room without a cookie in local auth mode", async () => {
	const { channel, baseURL } = await startLoopbackChannel();
	try {
		const response = await fetch(`${baseURL}/api/chat/rooms`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: baseURL },
			body: JSON.stringify({ name: "test-room", type: "chat" }),
		});
		assert.equal(response.status, 201, "loopback caller must be allowed to create rooms");
		const body = await response.json();
		assert.ok(body.room);
		assert.equal(body.room.name, "test-room");
	} finally {
		await channel.stop?.();
	}
});

test("x-pibo-socket-peer header is stripped from the response body", async () => {
	const { channel, baseURL } = await startLoopbackChannel();
	try {
		const response = await fetch(`${baseURL}/api/chat/rooms`);
		assert.equal(response.status, 200);
		// The internal socket peer header must never leak to the client.
		assert.equal(response.headers.get("x-pibo-socket-peer"), null);
	} finally {
		await channel.stop?.();
	}
});
