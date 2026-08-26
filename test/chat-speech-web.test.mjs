import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";
import { createWebHostChannel } from "../dist/web/channel.js";

const OFFER_SDP = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n";
const ANSWER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n";

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

async function startHost(dir, overrides = {}) {
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
		getSpeechProviderIds: () => ["fixture"],
		getSpeechProviderInfos: overrides.getSpeechProviderInfos ?? (async () => [{ id: "fixture", name: "Fixture Speech", configured: true }]),
		async startSpeechSession(providerId, input, options) {
			if (overrides.startSpeechSession) return await overrides.startSpeechSession(providerId, input, options);
			calls.push({ type: "start", providerId, input });
			return { providerId, sessionId: "session-fixture", answerSdp: ANSWER_SDP };
		},
		async speakSpeechSession(sessionId, input) { calls.push({ type: "speak", sessionId, input }); },
		async stopSpeechSession(sessionId) { calls.push({ type: "stop", sessionId }); },
		getWebApps: () => [app],
	});
	const address = channel.getAddress();
	return { app, channel, calls, baseURL: `http://${address.host}:${address.port}` };
}

function deferredValue() {
	let resolve;
	const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

function jsonHeaders(baseURL) {
	return { "x-test-user": "user-1", origin: baseURL, "content-type": "application/json" };
}

test("chat speech API uses the independently selected provider", async () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-speech-web-"));
	process.env.PIBO_HOME = join(dir, "home");
	const { app, channel, calls, baseURL } = await startHost(dir);
	try {
		const catalogResponse = await fetch(`${baseURL}/api/chat/speech/providers`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogResponse.status, 200);
		assert.deepEqual(await catalogResponse.json(), {
			providers: [{ id: "fixture", name: "Fixture Speech", configured: true }],
			selectedProviderId: "openai-codex",
		});

		const unknownProvider = await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ speech: { providerId: "missing" } }),
		});
		assert.equal(unknownProvider.status, 400);

		const settingsResponse = await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ speech: { providerId: "fixture" } }),
		});
		assert.equal(settingsResponse.status, 200);
		assert.equal((await settingsResponse.json()).userSettings.speech.providerId, "fixture");

		const startResponse = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: OFFER_SDP, text: "Read this assistant message" }),
		});
		assert.equal(startResponse.status, 201);
		assert.deepEqual(await startResponse.json(), {
			speechSession: { providerId: "fixture", sessionId: "session-fixture", answerSdp: ANSWER_SDP },
		});

		const speakResponse = await fetch(`${baseURL}/api/chat/speech/sessions/session-fixture/speak`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ text: "Read this assistant message" }),
		});
		assert.equal(speakResponse.status, 204);

		const stopResponse = await fetch(`${baseURL}/api/chat/speech/sessions/session-fixture`, {
			method: "DELETE",
			headers: jsonHeaders(baseURL),
			body: "{}",
		});
		assert.equal(stopResponse.status, 204);
		assert.deepEqual(calls, [
			{ type: "start", providerId: "fixture", input: { offerSdp: OFFER_SDP, text: "Read this assistant message" } },
			{ type: "speak", sessionId: "session-fixture", input: { text: "Read this assistant message" } },
			{ type: "stop", sessionId: "session-fixture" },
		]);

		const emptyResponse = await fetch(`${baseURL}/api/chat/speech/sessions/session-fixture/speak`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ text: "   " }),
		});
		assert.equal(emptyResponse.status, 400);

		const missingOrigin = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: { "x-test-user": "user-1", "content-type": "application/json" },
			body: JSON.stringify({ offerSdp: OFFER_SDP }),
		});
		assert.equal(missingOrigin.status, 403);
	} finally {
		await channel.stop?.();
		await app.dispose?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("chat speech API enforces exact UTF-16 text and SDP boundaries before provider launch", async () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-speech-boundaries-"));
	process.env.PIBO_HOME = join(dir, "home");
	const { app, channel, calls, baseURL } = await startHost(dir);
	try {
		await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ speech: { providerId: "fixture" } }),
		});
		const exactText = `${"😀".repeat(15_999)}ab`;
		const oversizedText = `${exactText}c`;
		assert.equal(exactText.length, 32_000);
		assert.equal(oversizedText.length, 32_001);
		const exact = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: OFFER_SDP, text: exactText }),
		});
		assert.equal(exact.status, 201);
		const oversizedTextResponse = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: OFFER_SDP, text: oversizedText }),
		});
		assert.equal(oversizedTextResponse.status, 413);
		const malformedOffer = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: "not-sdp", text: "hello" }),
		});
		assert.equal(malformedOffer.status, 400);
		const oversizedOffer = await fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: `v=0${"x".repeat(256_000)}`, text: "hello" }),
		});
		assert.equal(oversizedOffer.status, 413);
		assert.equal(calls.filter((call) => call.type === "start").length, 1);
	} finally {
		await channel.stop?.();
		await app.dispose?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("HTTP client disconnect aborts speech startup before session publication", async () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-speech-abort-"));
	process.env.PIBO_HOME = join(dir, "home");
	const entered = deferredValue();
	const released = deferredValue();
	let startupOwners = 0;
	let releases = 0;
	const { app, channel, baseURL } = await startHost(dir, {
		async startSpeechSession(_providerId, _input, options) {
			startupOwners += 1;
			entered.resolve();
			return await new Promise((_resolve, reject) => {
				const abort = () => {
					startupOwners -= 1;
					releases += 1;
					released.resolve();
					reject(options.signal.reason);
				};
				if (options.signal.aborted) abort();
				else options.signal.addEventListener("abort", abort, { once: true });
			});
		},
	});
	try {
		await fetch(`${baseURL}/api/chat/user-settings`, {
			method: "PATCH",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ speech: { providerId: "fixture" } }),
		});
		const controller = new AbortController();
		const request = fetch(`${baseURL}/api/chat/speech/sessions`, {
			method: "POST",
			headers: jsonHeaders(baseURL),
			body: JSON.stringify({ offerSdp: OFFER_SDP, text: "disconnect" }),
			signal: controller.signal,
		});
		await entered.promise;
		controller.abort();
		await assert.rejects(request, (error) => error?.name === "AbortError");
		await released.promise;
		assert.equal(startupOwners, 0);
		assert.equal(releases, 1);
	} finally {
		await channel.stop?.();
		await app.dispose?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("speech provider catalog failure is not treated as an empty authoritative catalog", async () => {
	const previousPiboHome = process.env.PIBO_HOME;
	const dir = mkdtempSync(join(tmpdir(), "pibo-speech-catalog-failure-"));
	process.env.PIBO_HOME = join(dir, "home");
	const { app, channel, baseURL } = await startHost(dir, {
		async getSpeechProviderInfos() { throw new Error("catalog unavailable"); },
	});
	try {
		const response = await fetch(`${baseURL}/api/chat/speech/providers`, { headers: { "x-test-user": "user-1" } });
		assert.equal(response.status, 500);
		assert.match((await response.json()).error, /catalog unavailable/);
	} finally {
		await channel.stop?.();
		await app.dispose?.();
		if (previousPiboHome === undefined) delete process.env.PIBO_HOME;
		else process.env.PIBO_HOME = previousPiboHome;
		rmSync(dir, { recursive: true, force: true });
	}
});
