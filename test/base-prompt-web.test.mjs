import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { createWebHostChannel } from "../dist/web/channel.js";

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

async function startChatHost(storageDir) {
	const sessions = new InMemoryPiboSessionStore();
	const channel = createWebHostChannel({ port: 0, announce: false });
	const app = createChatWebApp({
		dataStorePath: join(storageDir, "chat.sqlite"),
		agentStorePath: join(storageDir, "agents.sqlite"),
		cronStorePath: join(storageDir, "cron.sqlite"),
		ralphStorePath: join(storageDir, "ralph.sqlite"),
		reliabilityStorePath: join(storageDir, "reliability.sqlite"),
	});
	await channel.start({
		auth: createFakeAuthService(),
		emit() { throw new Error("not used"); },
		subscribe() { return () => {}; },
		getSession: (id) => sessions.get(id),
		createSession: (input) => sessions.create(input),
		updateSession: (id, input) => sessions.update(id, input),
		deleteSession: (id) => sessions.delete(id),
		findSessions: (input) => sessions.find(input),
		listSessions: () => sessions.list(),
		getGatewayActions: () => [],
		getProfiles: () => [{ name: "test-profile", description: "Test", aliases: [] }],
		getCapabilityCatalog: () => ({ nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [] }),
		getWebApps() {
			return [app];
		},
	});
	const address = channel.getAddress();
	return {
		channel,
		baseURL: `http://${address.host}:${address.port}`,
		dispose: () => app.dispose?.(),
	};
}

function authHeaders(baseURL) {
	return {
		"x-test-user": "user-1",
		"content-type": "application/json",
		origin: baseURL,
	};
}

async function fetchJson(url, init = {}) {
	const response = await fetch(url, init);
	return { response, data: await response.json() };
}

test("chat user-settings API validates same-origin mutations and persists sanitized values", async () => {
	const originalPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-user-settings-web-"));
	const piboHome = join(dir, "pibo-home");
	const lastPrunedAt = new Date().toISOString();
	process.env.PIBO_HOME = piboHome;
	mkdirSync(piboHome, { recursive: true });
	writeFileSync(join(piboHome, "user-settings.json"), `${JSON.stringify({
		settings: {
			transcription: { providerId: "openai" },
			telemetryRetention: { enabled: true, days: 30, lastPrunedAt },
		},
	}, null, 2)}\n`);
	const { channel, baseURL, dispose } = await startChatHost(dir);
	try {
		const current = await fetchJson(`${baseURL}/api/chat/user-settings`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(current.response.status, 200);
		assert.equal(current.data.userSettings.timezone, "UTC");
		assert.deepEqual(current.data.userSettings.transcription, { providerId: "openai-chatgpt" });
		assert.deepEqual(current.data.userSettings.telemetryRetention, { enabled: true, days: 30, lastPrunedAt });

		const missingOrigin = await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: { "x-test-user": "user-1", "content-type": "application/json" },
			body: JSON.stringify({ timezone: "Europe/Berlin" }),
		});
		assert.equal(missingOrigin.status, 403);

		const invalidTimezone = await fetchJson(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ timezone: "Not/AZone" }),
		});
		assert.equal(invalidTimezone.response.status, 400);
		assert.match(invalidTimezone.data.error, /Invalid timezone/);

		const saved = await fetchJson(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: authHeaders(baseURL),
			body: JSON.stringify({
				timezone: "Europe/Berlin",
				shortcuts: { webAnnotationsToggle: " Ctrl+Shift+P\u0000" },
				telemetryRetention: { enabled: true, days: 10 },
			}),
		});
		assert.equal(saved.response.status, 200);
		assert.equal(saved.data.userSettings.timezone, "Europe/Berlin");
		assert.equal(saved.data.userSettings.shortcuts.webAnnotationsToggle, "Ctrl+Shift+P");
		assert.deepEqual(saved.data.userSettings.telemetryRetention, { enabled: true, days: 10, lastPrunedAt });

		const reloaded = await fetchJson(`${baseURL}/api/chat/user-settings`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(reloaded.response.status, 200);
		assert.equal(reloaded.data.userSettings.timezone, "Europe/Berlin");
		assert.equal(reloaded.data.userSettings.shortcuts.webAnnotationsToggle, "Ctrl+Shift+P");
		assert.deepEqual(reloaded.data.userSettings.telemetryRetention, { enabled: true, days: 10, lastPrunedAt });

		const reloadedOtherAccount = await fetchJson(`${baseURL}/api/chat/user-settings`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(reloadedOtherAccount.response.status, 200);
		assert.equal(reloadedOtherAccount.data.userSettings.timezone, "Europe/Berlin");
		const persisted = JSON.parse(readFileSync(join(process.env.PIBO_HOME, "user-settings.json"), "utf-8"));
		assert.equal(persisted.settings.timezone, "Europe/Berlin");
		assert.equal(persisted.settings.shortcuts.webAnnotationsToggle, "Ctrl+Shift+P");
		assert.deepEqual(persisted.settings.transcription, { providerId: "openai-chatgpt" });
		assert.deepEqual(persisted.settings.telemetryRetention, { enabled: true, days: 10, lastPrunedAt });
		assert.equal("users" in persisted, false);
	} finally {
		await channel.stop?.();
		dispose();
		if (originalPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = originalPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("chat base-prompt API validates same-origin mutations and accepts empty custom markdown", async () => {
	const originalCwd = process.cwd();
	const dir = mkdtempSync(join(tmpdir(), "pibo-base-prompt-web-"));
	process.chdir(dir);
	const { channel, baseURL, dispose } = await startChatHost(dir);
	try {
		const current = await fetchJson(`${baseURL}/api/chat/base-prompt`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(current.response.status, 200);
		assert.equal(current.data.basePrompt.mode, "library");
		assert.equal(current.data.basePrompt.effectiveMode, "library");

		const missingOrigin = await fetch(`${baseURL}/api/chat/base-prompt`, {
			method: "PATCH",
			headers: { "x-test-user": "user-1", "content-type": "application/json" },
			body: JSON.stringify({ mode: "custom" }),
		});
		assert.equal(missingOrigin.status, 403);

		const invalidMode = await fetchJson(`${baseURL}/api/chat/base-prompt`, {
			method: "PATCH",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ mode: "future" }),
		});
		assert.equal(invalidMode.response.status, 400);
		assert.match(invalidMode.data.error, /mode must be library or custom/);

		const saved = await fetchJson(`${baseURL}/api/chat/base-prompt/custom`, {
			method: "PUT",
			headers: authHeaders(baseURL),
			body: JSON.stringify({ markdown: "" }),
		});
		assert.equal(saved.response.status, 200);
		assert.equal(saved.data.basePrompt.mode, "custom");
		assert.equal(saved.data.basePrompt.effectiveMode, "custom");
		assert.equal(saved.data.basePrompt.custom.markdown, "");
	} finally {
		await channel.stop?.();
		dispose();
		process.chdir(originalCwd);
		rmSync(dir, { recursive: true, force: true });
	}
});
