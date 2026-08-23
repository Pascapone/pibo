import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { createWebHostChannel } from "../dist/web/channel.js";

function fakeAuthService() {
	return {
		name: "fake-auth",
		async getSession(headers) {
			const userId = headers.get("x-test-user");
			return userId ? { identity: { userId, provider: "test" } } : undefined;
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw new Error("Unauthenticated");
			return session;
		},
	};
}

async function startHost(dir) {
	const sessions = new InMemoryPiboSessionStore();
	const channel = createWebHostChannel({ port: 0, announce: false });
	const app = createChatWebApp({
		dataStorePath: join(dir, "chat.sqlite"),
		agentStorePath: join(dir, "agents.sqlite"),
		cronStorePath: join(dir, "cron.sqlite"),
		ralphStorePath: join(dir, "ralph.sqlite"),
		reliabilityStorePath: join(dir, "reliability.sqlite"),
	});
	const calls = [];
	await channel.start({
		auth: fakeAuthService(),
		emit() { throw new Error("not used"); },
		subscribe() { return () => {}; },
		getSession: (id) => sessions.get(id),
		createSession: (input) => sessions.create(input),
		updateSession: (id, input) => sessions.update(id, input),
		deleteSession: (id) => sessions.delete(id),
		findSessions: (input) => sessions.find(input),
		listSessions: () => sessions.list(),
		getGatewayActions: () => [],
		getProfiles: () => [{ name: "base", aliases: [] }],
		getCapabilityCatalog: () => ({ nativeTools: [], skills: [], subagents: [], contextFiles: [], packages: [], piboTools: [], mcpServers: [] }),
		getTranscriptionProviderInfos: async () => [{ id: "fixture", name: "Fixture", configured: true }],
		async transcribe(providerId, input) {
			calls.push({ providerId, input });
			return { providerId, text: "spoken words", model: "fixture-model" };
		},
		getWebApps: () => [app],
	});
	const address = channel.getAddress();
	return { app, channel, calls, baseURL: `http://${address.host}:${address.port}` };
}

function jsonHeaders(baseURL) {
	return { "x-test-user": "user-1", origin: baseURL, "content-type": "application/json" };
}

test("chat transcription API uses the independently selected provider", async () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-transcription-web-"));
	process.env.PIBO_HOME = join(dir, "home");
	const { app, channel, calls, baseURL } = await startHost(dir);
	try {
		const catalogResponse = await fetch(`${baseURL}/api/chat/transcription/providers`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogResponse.status, 200);
		assert.deepEqual(await catalogResponse.json(), {
			providers: [{ id: "fixture", name: "Fixture", configured: true }],
			selectedProviderId: "openai-chatgpt",
		});

		const unknownProvider = await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ transcription: { providerId: "missing" } }),
		});
		assert.equal(unknownProvider.status, 400);

		const settingsResponse = await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ transcription: { providerId: "fixture" } }),
		});
		assert.equal(settingsResponse.status, 200);
		assert.equal((await settingsResponse.json()).userSettings.transcription.providerId, "fixture");

		const form = new FormData();
		form.append("file", new File([new Uint8Array([4, 5, 6])], "recording.webm", { type: "audio/webm" }));
		const response = await fetch(`${baseURL}/api/chat/transcription`, {
			method: "POST",
			headers: { "x-test-user": "user-1", origin: baseURL, "user-agent": "Mozilla/5.0 TestBrowser/1.0" },
			body: form,
		});
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			transcription: { providerId: "fixture", text: "spoken words", model: "fixture-model" },
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].providerId, "fixture");
		assert.equal(calls[0].input.audio.filename, "recording.webm");
		assert.equal(calls[0].input.audio.mimeType, "audio/webm");
		assert.equal(calls[0].input.clientUserAgent, "Mozilla/5.0 TestBrowser/1.0");
		assert.deepEqual(calls[0].input.audio.bytes, new Uint8Array([4, 5, 6]));

		const missingOriginForm = new FormData();
		missingOriginForm.append("file", new File([new Uint8Array([7])], "recording.webm", { type: "audio/webm" }));
		const missingOrigin = await fetch(`${baseURL}/api/chat/transcription`, { method: "POST", body: missingOriginForm });
		assert.equal(missingOrigin.status, 403);
	} finally {
		await channel.stop?.();
		await app.dispose?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});
