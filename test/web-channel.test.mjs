import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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

function assertStructuredMissingRefDiagnostic(diagnostics, expected) {
	const diagnostic = diagnostics.find((candidate) => {
		return candidate.code === expected.code &&
			candidate.registryRef === expected.registryRef &&
			candidate.path === expected.path &&
			(expected.nodeId === undefined || candidate.nodeId === expected.nodeId) &&
			(expected.edgeId === undefined || candidate.edgeId === expected.edgeId);
	});
	assert.ok(diagnostic, `missing structured diagnostic ${JSON.stringify(expected)} in ${JSON.stringify(diagnostics)}`);
	assert.equal(diagnostic.severity, "error");
	assert.equal(typeof diagnostic.message, "string");
	assert.ok(diagnostic.message.includes(expected.registryRef));
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
	const webApps = [createChatWebApp({
		agentStorePath,
		dataStorePath,
		dataPayloadRootDir,
		projectStorePath,
	})];
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
			return webApps;
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
		setProfiles(nextProfiles) {
			profiles = [...nextProfiles];
		},
		sessions,
		storageDir,
		dataStorePath,
		projectStorePath,
		baseURL: `http://${address.host}:${address.port}`, 
	};
}

async function readSseTextUntil(reader, match, options = {}) {
	const decoder = new TextDecoder();
	const timeoutMs = options.timeoutMs ?? 1000;
	const maxChunks = options.maxChunks ?? 20;
	let text = "";
	for (let index = 0; index < maxChunks; index += 1) {
		const chunk = await Promise.race([
			reader.read().then((value) => ({ kind: "chunk", value })),
			new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)),
		]);
		if (chunk.kind === "timeout") return { matched: false, text };
		assert.equal(chunk.value.done, false);
		text += decoder.decode(chunk.value.value, { stream: true });
		if (match(text)) return { matched: true, text };
	}
	return { matched: false, text };
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

test("chat web app uploads multipart files to the Pibo uploads directory", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const uploadedPaths = [];
	const filename = `upload-test-${Date.now()}.txt`;
	const suffixedFilename = filename.replace(/\.txt$/, "-1.txt");

	try {
		const form = new FormData();
		form.append("files", new File(["hello upload"], filename, { type: "text/plain" }));
		form.append("files", new File(["hello upload again"], filename, { type: "text/plain" }));

		const response = await fetch(`${baseURL}/api/chat/upload`, {
			method: "POST",
			headers: {
				"x-test-user": "user-1",
				origin: baseURL,
			},
			body: form,
		});
		assert.equal(response.status, 201);
		const payload = await response.json();
		assert.equal(payload.uploadDir, join(homedir(), ".pibo", "uploads"));
		assert.equal(payload.files.length, 2);
		for (const file of payload.files) {
			uploadedPaths.push(file.path);
			assert.equal(dirname(file.path), payload.uploadDir);
		}
		assert.equal(basename(uploadedPaths[0]), filename);
		assert.equal(basename(uploadedPaths[1]), suffixedFilename);
		assert.equal(readFileSync(uploadedPaths[0], "utf8"), "hello upload");
		assert.equal(readFileSync(uploadedPaths[1], "utf8"), "hello upload again");
	} finally {
		for (const uploadedPath of uploadedPaths) rmSync(uploadedPath, { force: true });
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

test("chat web app summary event streams suppress live assistant deltas", async () => {
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
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(room.id)}&mode=summary&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: session.id,
			eventId: "summary-hidden-live",
			text: "hidden live token",
		});
		await new Promise((resolve) => setTimeout(resolve, 150));

		emitOutput({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "summary-hidden-live",
			text: "final visible answer",
		});
		const finalFrame = await readSseTextUntil(reader, (text) => text.includes("final visible answer"));
		assert.equal(finalFrame.matched, true, finalFrame.text);
		assert.doesNotMatch(finalFrame.text, /hidden live token/);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app selected live event streams receive assistant deltas", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "live-visible",
			text: "visible live token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("TEXT_MESSAGE_CONTENT") && text.includes("visible live token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app invalid event stream modes fall back to selected-session live mode", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=invalid&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "fallback-live",
			text: "fallback live token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("fallback live token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);

		controller.abort();
	} finally {
		await channel.stop?.();
	}
});

test("chat web app live observers can join mid-turn from compactor snapshots", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});
	const summaryController = new AbortController();
	const liveController = new AbortController();

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const summaryResponse = await fetch(
			`${baseURL}/api/chat/events?roomId=${encodeURIComponent(sessionPayload.room.id)}&mode=summary&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: summaryController.signal,
			},
		);
		assert.equal(summaryResponse.status, 200);
		await summaryResponse.body.getReader().read();

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "mid-turn",
			text: "early token",
		});
		await new Promise((resolve) => setTimeout(resolve, 50));

		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: liveController.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		const snapshot = await readSseTextUntil(reader, (text) => text.includes("early token"));
		assert.equal(snapshot.matched, true, snapshot.text);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "mid-turn",
			text: " later token",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("later token"));
		assert.equal(liveFrame.matched, true, liveFrame.text);
	} finally {
		liveController.abort();
		summaryController.abort();
		await channel.stop?.();
	}
});

test("chat web app persists final output with no live observer", async () => {
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
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
			text: "persisted",
		});
		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
			text: " final text",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "no-observer-final",
		});

		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.match(JSON.stringify(trace), /persisted final text/);
	} finally {
		await channel.stop?.();
	}
});

test("chat web app removes live observer accounting on disconnect", async () => {
	const { channel, baseURL, emitOutput } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const sessionResponse = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sessionResponse.status, 200);
		const sessionPayload = await sessionResponse.json();

		const controller = new AbortController();
		const eventsResponse = await fetch(
			`${baseURL}/api/chat/events?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&mode=live&since=0`,
			{
				headers: { "x-test-user": "user-1" },
				signal: controller.signal,
			},
		);
		assert.equal(eventsResponse.status, 200);
		const reader = eventsResponse.body.getReader();
		await reader.read();

		let debugResponse = await fetch(`${baseURL}/api/chat/debug/persistence`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(debugResponse.status, 200);
		let debug = await debugResponse.json();
		assert.deepEqual(debug.liveObservers, [{ piboSessionId: sessionPayload.session.id, count: 1 }]);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
			text: "before disconnect",
		});
		const liveFrame = await readSseTextUntil(reader, (text) => text.includes("before disconnect"));
		assert.equal(liveFrame.matched, true, liveFrame.text);

		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 50));

		debugResponse = await fetch(`${baseURL}/api/chat/debug/persistence`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(debugResponse.status, 200);
		debug = await debugResponse.json();
		assert.deepEqual(debug.liveObservers, []);

		emitOutput({
			type: "assistant_delta",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
			text: " after disconnect",
		});
		emitOutput({
			type: "message_finished",
			piboSessionId: sessionPayload.session.id,
			eventId: "disconnect-live",
		});
		const traceResponse = await fetch(
			`${baseURL}/api/chat/trace?piboSessionId=${encodeURIComponent(sessionPayload.session.id)}&includeRawEvents=true`,
			{ headers: { "x-test-user": "user-1" } },
		);
		assert.equal(traceResponse.status, 200);
		const trace = await traceResponse.json();
		assert.match(JSON.stringify(trace), /before disconnect after disconnect/);
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
		assert.equal(pickerPayload.options[0].paramsSchema, null);
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
		assert.equal(Object.hasOwn(pickerPayload.options[0], "paramsSchema"), true);
		assert.equal(Object.hasOwn(pickerPayload.options[0], "inputSchema"), true);
		assert.equal(Object.hasOwn(pickerPayload.options[0], "outputSchema"), true);
		assert.equal(pickerPayload.options[0].paramsSchema, null);
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
		const approvedGuard = guardPayload.options.find((option) => option.id === "fixture.guards.approved");
		assert.equal(approvedGuard.paramsSchema.type, "object");
		assert.deepEqual(approvedGuard.paramsSchema.required, ["expected"]);
		const revisionGuard = guardPayload.options.find((option) => option.id === "fixture.guards.needsRevision");
		assert.equal(revisionGuard.paramsSchema, null);

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
		const summaryAdapter = adapterPayload.options.find((option) => option.id === "fixture.adapters.draftToSummary");
		assert.equal(summaryAdapter.paramsSchema.type, "object");
		assert.deepEqual(summaryAdapter.paramsSchema.required, ["format"]);
		const topicAdapter = adapterPayload.options.find((option) => option.id === "fixture.adapters.textToTopic");
		assert.equal(topicAdapter.paramsSchema, null);

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

test("workflow human action and prompt asset pickers list registered refs and report missing refs", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	try {
		const humanActionPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(humanActionPicker.status, 200);
		const humanActionPayload = await humanActionPicker.json();
		assert.equal(humanActionPayload.kind, "human-actions");
		assert.deepEqual(humanActionPayload.options.map((option) => option.id), [
			"fixture.humanActions.approve",
			"fixture.humanActions.cancel",
			"fixture.humanActions.reject",
			"fixture.humanActions.resume",
		]);
		assert.equal(humanActionPayload.options[0].displayName, "Approve");
		assert.equal(humanActionPayload.options[0].kind, "approve");
		assert.equal(humanActionPayload.options[0].paramsSchema, null);

		const selectedAction = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions?selectedRefId=fixture.humanActions.approve`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedAction.status, 200);
		const selectedActionPayload = await selectedAction.json();
		assert.equal(selectedActionPayload.selectedRefId, "fixture.humanActions.approve");
		assert.deepEqual(selectedActionPayload.diagnostics, []);

		const missingAction = await fetch(`${baseURL}/api/chat/workflows/pickers/human-actions?selectedRefId=missing.humanActions.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingAction.status, 200);
		const missingActionPayload = await missingAction.json();
		assert.equal(missingActionPayload.selectedRefId, undefined);
		assert.equal(missingActionPayload.diagnostics[0].code, "WorkflowGraphError.unknownHumanActionRef");
		assert.equal(missingActionPayload.diagnostics[0].registryRef, "missing.humanActions.inline");
		assert.equal(missingActionPayload.diagnostics[0].path, "$.nodes.human.actions.0.id");

		const promptAssetPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(promptAssetPicker.status, 200);
		const promptAssetPayload = await promptAssetPicker.json();
		assert.equal(promptAssetPayload.kind, "prompt-assets");
		assert.deepEqual(promptAssetPayload.options.map((option) => option.id), ["fixture.promptBuilders.draftPrompt"]);
		assert.equal(promptAssetPayload.options[0].displayName, "Draft prompt builder");
		assert.equal(promptAssetPayload.options[0].paramsSchema, null);

		const selectedPromptAsset = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=fixture.promptBuilders.draftPrompt`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(selectedPromptAsset.status, 200);
		const selectedPromptAssetPayload = await selectedPromptAsset.json();
		assert.equal(selectedPromptAssetPayload.selectedRefId, "fixture.promptBuilders.draftPrompt");
		assert.deepEqual(selectedPromptAssetPayload.diagnostics, []);

		const missingPromptAsset = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=missing.promptAssets.inline`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(missingPromptAsset.status, 200);
		const missingPromptAssetPayload = await missingPromptAsset.json();
		assert.equal(missingPromptAssetPayload.selectedRefId, undefined);
		assert.equal(missingPromptAssetPayload.diagnostics[0].code, "WorkflowGraphError.unknownPromptBuilderRef");
		assert.equal(missingPromptAssetPayload.diagnostics[0].registryRef, "missing.promptAssets.inline");
		assert.equal(missingPromptAssetPayload.diagnostics[0].path, "$.nodes.agent.promptBuilder.id");
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
		assert.equal(pickerPayload.options[0].displayName, "Standard Project");
		assert.equal(pickerPayload.options[0].paramsSchema, null);
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

		const history = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(history.status, 200);
		const historyPayload = await history.json();
		assert.equal(historyPayload.kind, "version-history");
		assert.deepEqual(historyPayload.options.map((option) => `${option.id}@${option.version}:${option.status}`), [
			"archived-review-workflow@1.0.0:archived",
			"simple-chat@1.0.0:published",
			"standard-project@1.0.0:published",
			"ui-draft-workflow@0.1.0-draft:draft",
			"ui-review-workflow@2.0.0:published",
		]);
		const historyByKey = new Map(historyPayload.options.map((option) => [`${option.id}@${option.version}`, option]));
		const codeHistoryRow = historyByKey.get("standard-project@1.0.0");
		assert.ok(codeHistoryRow);
		assert.deepEqual(codeHistoryRow.actions, ["view", "duplicate", "create_project_session", "version_history"]);
		assert.equal(codeHistoryRow.editability.canPublish, false);
		const draftHistoryRow = historyByKey.get("ui-draft-workflow@0.1.0-draft");
		assert.ok(draftHistoryRow);
		assert.deepEqual(draftHistoryRow.actions, ["view", "edit_draft", "validate", "publish", "archive", "delete"]);
		const uiPublishedHistoryRow = historyByKey.get("ui-review-workflow@2.0.0");
		assert.ok(uiPublishedHistoryRow);
		assert.deepEqual(uiPublishedHistoryRow.actions, ["view", "duplicate", "create_project_session", "version_history", "create_next_draft", "archive", "delete"]);

		const archivedHistory = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history?selectedWorkflowId=archived-review-workflow&selectedWorkflowVersion=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedHistory.status, 200);
		const archivedHistoryPayload = await archivedHistory.json();
		assert.equal(archivedHistoryPayload.selectedWorkflowId, "archived-review-workflow");
		assert.equal(archivedHistoryPayload.selectedWorkflowVersion, "1.0.0");
		assert.equal(archivedHistoryPayload.diagnostics.length, 0);
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog authentication and permission baseline treats UI workflows as global", async () => {
	const { channel, baseURL } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	const userOneHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};
	const userTwoHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-2",
	};

	try {
		const unauthenticatedCatalog = await fetch(`${baseURL}/api/chat/workflows`);
		assert.equal(unauthenticatedCatalog.status, 401);

		const unauthenticatedPicker = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`);
		assert.equal(unauthenticatedPicker.status, 401);

		const createResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: userOneHeaders,
			body: JSON.stringify({
				workflowId: "ui-global-permission-draft",
				title: "Global Permission Draft",
				description: "Created by one authenticated user and editable by another.",
				tags: ["global", "permissions"],
			}),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		const draftId = createPayload.draft.draftId;

		const userTwoCatalog = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(userTwoCatalog.status, 200);
		const userTwoCatalogPayload = await userTwoCatalog.json();
		const globalDraft = userTwoCatalogPayload.workflows.find((workflow) => workflow.id === "ui-global-permission-draft");
		assert.ok(globalDraft);
		assert.equal(globalDraft.source, "ui");
		assert.equal(globalDraft.status, "draft");
		assert.equal(globalDraft.activeDraftId, draftId);
		assert.equal(globalDraft.editability.canEditDraft, true);
		assert.equal(globalDraft.editability.canPublish, true);

		const userTwoDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(userTwoDraftResponse.status, 200);
		const userTwoDraftPayload = await userTwoDraftResponse.json();
		assert.equal(userTwoDraftPayload.draft.workflowId, "ui-global-permission-draft");

		const runnableDefinition = {
			id: "ui-global-permission-draft",
			version: "0.1.0",
			title: "Global Permission Draft",
			description: "Created by one authenticated user and editable by another.",
			metadata: { tags: ["global", "permissions"] },
			input: { kind: "text", description: "Input for the global permission workflow." },
			output: { kind: "text", description: "Output from the global permission workflow." },
			initial: "agent",
			nodes: {
				agent: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "pibo-agent" },
					promptTemplate: "Answer with the workflow input.\n\n{{input}}",
					output: { kind: "text" },
				},
			},
			edges: {},
			ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
		};

		const userTwoPatch = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: userTwoHeaders,
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(userTwoPatch.status, 200);
		const userTwoPatchPayload = await userTwoPatch.json();
		assert.equal(userTwoPatchPayload.validation.ok, true);

		const userTwoPublish = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: userTwoHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(userTwoPublish.status, 201);
		const userTwoPublishPayload = await userTwoPublish.json();
		assert.equal(userTwoPublishPayload.publishedVersion.workflowId, "ui-global-permission-draft");
		assert.equal(userTwoPublishPayload.publishedVersion.version, "0.1.1");
		assert.equal(userTwoPublishPayload.publishedVersion.publishedBy, "user:user-2");

		const userOneVersion = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(userOneVersion.status, 200);
		const userOneVersionPayload = await userOneVersion.json();
		assert.equal(userOneVersionPayload.version.source, "ui");
		assert.equal(userOneVersionPayload.version.status, "published");

		const userOneDuplicate = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft/duplicate`, {
			method: "POST",
			headers: userOneHeaders,
			body: JSON.stringify({ version: "0.1.1" }),
		});
		assert.equal(userOneDuplicate.status, 201);
		const userOneDuplicatePayload = await userOneDuplicate.json();
		assert.equal(userOneDuplicatePayload.draft.baseWorkflowId, "ui-global-permission-draft");
		assert.equal(userOneDuplicatePayload.draft.baseWorkflowVersion, "0.1.1");

		const unauthenticatedInspect = await fetch(`${baseURL}/api/chat/workflows/ui-global-permission-draft?version=0.1.1`);
		assert.equal(unauthenticatedInspect.status, 401);

		const codeDeleteResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project`, {
			method: "DELETE",
			headers: userTwoHeaders,
			body: JSON.stringify({ confirmWorkflowId: "standard-project" }),
		});
		assert.equal(codeDeleteResponse.status, 409);
		assert.match((await codeDeleteResponse.json()).error, /Code workflow projections are read-only/);
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog list and inspect APIs expose source/status, diagnostics, and archive filtering", async () => {
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
		const catalogResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogResponse.status, 200);
		const catalogPayload = await catalogResponse.json();
		assert.equal(catalogPayload.kind, "workflow-catalog");
		assert.equal(catalogPayload.includeArchived, false);
		assert.deepEqual(catalogPayload.workflows.map((workflow) => `${workflow.id}:${workflow.source}:${workflow.status}`), [
			"simple-chat:code:published",
			"standard-project:code:published",
			"ui-review-workflow:ui:published",
		]);

		const standardWorkflow = catalogPayload.workflows.find((workflow) => workflow.id === "standard-project");
		assert.ok(standardWorkflow);
		assert.equal(standardWorkflow.title, "Standard Project");
		assert.deepEqual(standardWorkflow.tags, ["project", "workflow"]);
		assert.equal(standardWorkflow.versions[0].version, "1.0.0");
		assert.equal(standardWorkflow.versions[0].definitionHash.startsWith("sha256:"), true);
		assert.equal(standardWorkflow.validationState, "valid");
		assert.deepEqual(standardWorkflow.missingRefs, []);
		assert.equal(standardWorkflow.editability.canDuplicate, true);
		assert.equal(standardWorkflow.editability.canEditDraft, false);
		assert.ok(standardWorkflow.actions.includes("view"));
		assert.ok(standardWorkflow.actions.includes("duplicate"));
		assert.ok(standardWorkflow.actions.includes("create_project_session"));
		assert.ok(standardWorkflow.actions.includes("version_history"));
		assert.equal(standardWorkflow.actions.includes("edit_draft"), false);
		assert.equal(standardWorkflow.actions.includes("publish"), false);
		assert.equal(standardWorkflow.actions.includes("archive"), false);
		assert.equal(standardWorkflow.actions.includes("delete"), false);
		const uiPublishedWorkflow = catalogPayload.workflows.find((workflow) => workflow.id === "ui-review-workflow");
		assert.ok(uiPublishedWorkflow);
		assert.equal(uiPublishedWorkflow.source, "ui");
		assert.equal(uiPublishedWorkflow.status, "published");
		for (const action of ["view", "duplicate", "version_history", "create_next_draft", "create_project_session", "archive", "delete"]) {
			assert.ok(uiPublishedWorkflow.actions.includes(action));
		}
		assert.equal(uiPublishedWorkflow.actions.includes("edit_draft"), false);
		assert.equal(uiPublishedWorkflow.actions.includes("publish"), false);
		assert.equal(catalogPayload.workflows.some((workflow) => workflow.id === "archived-review-workflow"), false);

		const archivedResponse = await fetch(`${baseURL}/api/chat/workflows?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedResponse.status, 200);
		const archivedPayload = await archivedResponse.json();
		const archivedWorkflow = archivedPayload.workflows.find((workflow) => workflow.id === "archived-review-workflow");
		assert.ok(archivedWorkflow);
		assert.equal(archivedWorkflow.status, "archived");
		assert.equal(archivedWorkflow.editability.canDuplicate, false);

		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const invalidDefinition = structuredClone(duplicatePayload.draft.definition);
		invalidDefinition.nodes.agent.profile.id = "missing-catalog-profile";
		const invalidPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidDefinition, editTrigger: "node_edit" }),
		});
		assert.equal(invalidPatchResponse.status, 200);

		const catalogAfterDraftResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(catalogAfterDraftResponse.status, 200);
		const catalogAfterDraftPayload = await catalogAfterDraftResponse.json();
		const copiedWorkflow = catalogAfterDraftPayload.workflows.find((workflow) => workflow.id === "ui-standard-project-copy");
		assert.ok(copiedWorkflow);
		assert.equal(copiedWorkflow.source, "ui");
		assert.equal(copiedWorkflow.status, "draft");
		assert.equal(copiedWorkflow.activeDraftId, duplicatePayload.draft.draftId);
		assert.equal(copiedWorkflow.validationState, "error");
		assert.ok(copiedWorkflow.missingRefs.some((diagnostic) => diagnostic.registryRef === "missing-catalog-profile"));
		assert.equal(copiedWorkflow.editability.canEditDraft, true);
		for (const action of ["view", "edit_draft", "validate", "publish", "archive", "delete"]) {
			assert.ok(copiedWorkflow.actions.includes(action));
		}
		assert.equal(copiedWorkflow.actions.includes("duplicate"), false);
		assert.equal(copiedWorkflow.actions.includes("create_project_session"), false);

		const inspectDraftResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-project-copy`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectDraftResponse.status, 200);
		const inspectDraftPayload = await inspectDraftResponse.json();
		assert.equal(inspectDraftPayload.kind, "workflow-inspect");
		assert.equal(inspectDraftPayload.selected.kind, "draft");
		assert.equal(inspectDraftPayload.selected.draft.draftId, duplicatePayload.draft.draftId);
		assert.ok(inspectDraftPayload.diagnostics.some((diagnostic) => diagnostic.registryRef === "missing-catalog-profile"));

		const inspectPublishedResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectPublishedResponse.status, 200);
		const inspectPublishedPayload = await inspectPublishedResponse.json();
		assert.equal(inspectPublishedPayload.selected.kind, "publishedVersion");
		assert.equal(inspectPublishedPayload.selected.version.id, "standard-project");
		assert.equal(inspectPublishedPayload.selected.version.version, "1.0.0");
		assert.equal(inspectPublishedPayload.selected.version.source, "code");
		assert.equal(inspectPublishedPayload.selected.validation.validationState, "valid");
		assert.equal(inspectPublishedPayload.selected.definition.id, "standard-project");

		const archivedInspectDefaultResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectDefaultResponse.status, 404);

		const archivedInspectResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow?version=1.0.0&includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectResponse.status, 200);
		const archivedInspectPayload = await archivedInspectResponse.json();
		assert.equal(archivedInspectPayload.selected.kind, "publishedVersion");
		assert.equal(archivedInspectPayload.selected.version.status, "archived");
	} finally {
		await channel.stop?.();
	}
});

test("workflow catalog lifecycle APIs create, validate, publish, and expose version resources", async () => {
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
		const unauthenticatedCreate = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({
				workflowId: "ui-lifecycle-api-draft",
				title: "Lifecycle API Draft",
			}),
		});
		assert.equal(unauthenticatedCreate.status, 401);

		const createResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				workflowId: "ui-lifecycle-api-draft",
				title: "Lifecycle API Draft",
				description: "Created through the catalog lifecycle API.",
				tags: ["lifecycle", "api"],
			}),
		});
		assert.equal(createResponse.status, 201);
		const createPayload = await createResponse.json();
		assert.equal(createPayload.draft.workflowId, "ui-lifecycle-api-draft");
		assert.equal(createPayload.draft.source, "ui");
		assert.equal(createPayload.draft.status, "draft");
		assert.equal(createPayload.draft.validationState, "error");
		assert.match(createPayload.builderPath, /^\/apps\/chat\/workflows\/drafts\/draft_ui-lifecycle-api-draft_/);

		const emptyVersionsResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(emptyVersionsResponse.status, 200);
		const emptyVersionsPayload = await emptyVersionsResponse.json();
		assert.equal(emptyVersionsPayload.kind, "workflow-version-list");
		assert.equal(emptyVersionsPayload.workflow.source, "ui");
		assert.equal(emptyVersionsPayload.workflow.status, "draft");
		assert.deepEqual(emptyVersionsPayload.versions, []);

		const runnableDefinition = {
			id: "ui-lifecycle-api-draft",
			version: "0.1.0",
			title: "Lifecycle API Draft",
			description: "Created through the catalog lifecycle API.",
			metadata: { tags: ["api", "lifecycle"] },
			input: { kind: "text", description: "Input for the lifecycle API workflow." },
			output: { kind: "text", description: "Output from the lifecycle API workflow." },
			initial: "agent",
			nodes: {
				agent: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "pibo-agent" },
					promptTemplate: "Answer with the workflow input.\n\n{{input}}",
					output: { kind: "text" },
				},
			},
			edges: {},
			ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
		};

		const unauthenticatedPatch = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(unauthenticatedPatch.status, 401);

		const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: runnableDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(patchResponse.status, 200);
		const patchPayload = await patchResponse.json();
		assert.equal(patchPayload.validation.ok, true);
		assert.deepEqual(patchPayload.diagnostics.filter((diagnostic) => diagnostic.registryRef), []);

		const validateResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/validate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ trigger: "graph_edit" }),
		});
		assert.equal(validateResponse.status, 200);
		const validatePayload = await validateResponse.json();
		assert.equal(validatePayload.validation.ok, true);
		assert.equal(validatePayload.draft.source, "ui");
		assert.equal(validatePayload.draft.status, "draft");

		const unauthenticatedPublish = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(unauthenticatedPublish.status, 401);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createPayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 201);
		const publishPayload = await publishResponse.json();
		assert.equal(publishPayload.publishedVersion.workflowId, "ui-lifecycle-api-draft");
		assert.equal(publishPayload.publishedVersion.source, "ui");
		assert.equal(publishPayload.publishedVersion.status, "published");
		assert.equal(publishPayload.publishedVersion.version, "0.1.1");
		assert.match(publishPayload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);

		const versionsResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(versionsResponse.status, 200);
		const versionsPayload = await versionsResponse.json();
		assert.deepEqual(versionsPayload.versions.map((version) => `${version.version}:${version.source}:${version.status}`), ["0.1.1:ui:published"]);
		assert.deepEqual(versionsPayload.versions[0].missingRefs, []);

		const versionInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(versionInspectResponse.status, 200);
		const versionInspectPayload = await versionInspectResponse.json();
		assert.equal(versionInspectPayload.kind, "workflow-version-inspect");
		assert.equal(versionInspectPayload.version.version, "0.1.1");
		assert.equal(versionInspectPayload.version.source, "ui");
		assert.equal(versionInspectPayload.version.status, "published");
		assert.equal(versionInspectPayload.validation.ok, true);
		assert.deepEqual(versionInspectPayload.missingRefs, []);
		assert.equal(versionInspectPayload.definition.id, "ui-lifecycle-api-draft");

		const codeNextDraftResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/drafts`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeNextDraftResponse.status, 409);
		assert.match((await codeNextDraftResponse.json()).error, /Code workflow projections are read-only/);

		const unauthenticatedArchive = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/archive`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ reason: "auth baseline check" }),
		});
		assert.equal(unauthenticatedArchive.status, 401);

		const unauthenticatedDelete = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ confirmWorkflowId: "ui-lifecycle-api-draft" }),
		});
		assert.equal(unauthenticatedDelete.status, 401);

		const archiveResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ reason: "Lifecycle API coverage complete." }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(archivePayload.workflow.source, "ui");
		assert.equal(archivePayload.workflow.status, "archived");
		assert.equal(archivePayload.archiveState.archived, true);

		const archivedVersionDefaultResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedVersionDefaultResponse.status, 404);

		const archivedVersionResponse = await fetch(`${baseURL}/api/chat/workflows/ui-lifecycle-api-draft/versions/0.1.1?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedVersionResponse.status, 200);
		const archivedVersionPayload = await archivedVersionResponse.json();
		assert.equal(archivedVersionPayload.version.status, "archived");
	} finally {
		await channel.stop?.();
	}
});

test("workflow duplicate-to-draft catalog operation handles code and UI published versions", async () => {
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
		const codeDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeDuplicateResponse.status, 201);
		const codeDuplicatePayload = await codeDuplicateResponse.json();
		assert.equal(codeDuplicatePayload.draft.workflowId, "ui-standard-project-copy");
		assert.equal(codeDuplicatePayload.draft.baseWorkflowId, "standard-project");
		assert.equal(codeDuplicatePayload.draft.baseWorkflowVersion, "1.0.0");
		assert.match(codeDuplicatePayload.draft.baseDefinitionHash, /^sha256:[a-f0-9]{64}$/);
		assert.equal(codeDuplicatePayload.draft.definition.id, "ui-standard-project-copy");
		assert.equal(codeDuplicatePayload.draft.definition.version, "1.0.0-draft");
		assert.equal(codeDuplicatePayload.draft.definition.ui.layout, "auto");
		assert.equal(codeDuplicatePayload.draft.definition.xstate, undefined);

		const codeDuplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(codeDuplicateAgainResponse.status, 201);
		const codeDuplicateAgainPayload = await codeDuplicateAgainResponse.json();
		assert.equal(codeDuplicateAgainPayload.draft.draftId, codeDuplicatePayload.draft.draftId);

		const sourceCodeInspectResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sourceCodeInspectResponse.status, 200);
		const sourceCodeInspectPayload = await sourceCodeInspectResponse.json();
		assert.equal(sourceCodeInspectPayload.selected.kind, "publishedVersion");
		assert.equal(sourceCodeInspectPayload.selected.version.source, "code");
		assert.equal(sourceCodeInspectPayload.selected.version.status, "published");
		assert.equal(sourceCodeInspectPayload.selected.definition.id, "standard-project");

		const sourceDefinition = structuredClone(codeDuplicatePayload.draft.definition);
		sourceDefinition.nodes.agent.promptTemplate = "Preserved UI published prompt.\\n\\n{{input}}";
		sourceDefinition.ui.positions.agent = { x: 321, y: 654 };
		const patchSourceDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(codeDuplicatePayload.draft.draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: sourceDefinition, editTrigger: "prompt_edit" }),
		});
		assert.equal(patchSourceDraftResponse.status, 200);

		const publishSourceDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(codeDuplicatePayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "minor" }),
		});
		assert.equal(publishSourceDraftResponse.status, 201);
		const publishSourceDraftPayload = await publishSourceDraftResponse.json();
		assert.equal(publishSourceDraftPayload.publishedVersion.workflowId, "ui-standard-project-copy");
		assert.equal(publishSourceDraftPayload.publishedVersion.version, "1.1.0");
		assert.match(publishSourceDraftPayload.publishedVersion.definitionHash, /^sha256:[a-f0-9]{64}$/);

		const uiDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-project-copy/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.1.0" }),
		});
		assert.equal(uiDuplicateResponse.status, 201);
		const uiDuplicatePayload = await uiDuplicateResponse.json();
		assert.equal(uiDuplicatePayload.draft.workflowId, "ui-ui-standard-project-copy-copy");
		assert.equal(uiDuplicatePayload.draft.baseWorkflowId, "ui-standard-project-copy");
		assert.equal(uiDuplicatePayload.draft.baseWorkflowVersion, "1.1.0");
		assert.equal(uiDuplicatePayload.draft.baseDefinitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(uiDuplicatePayload.draft.definition.id, "ui-ui-standard-project-copy-copy");
		assert.equal(uiDuplicatePayload.draft.definition.version, "1.1.0-draft");
		assert.equal(uiDuplicatePayload.draft.definition.nodes.agent.promptTemplate, "Preserved UI published prompt.\\n\\n{{input}}");
		assert.deepEqual(uiDuplicatePayload.draft.definition.ui.positions.agent, { x: 321, y: 654 });
		assert.equal(uiDuplicatePayload.draft.definition.metadata.migration.fromWorkflowId, "ui-standard-project-copy");
		assert.equal(uiDuplicatePayload.draft.definition.metadata.migration.fromDefinitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(uiDuplicatePayload.draft.definition.xstate, undefined);

		const uiDuplicateAgainResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-project-copy/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.1.0" }),
		});
		assert.equal(uiDuplicateAgainResponse.status, 201);
		const uiDuplicateAgainPayload = await uiDuplicateAgainResponse.json();
		assert.equal(uiDuplicateAgainPayload.draft.draftId, uiDuplicatePayload.draft.draftId);

		const sourceUiInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-standard-project-copy?version=1.1.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(sourceUiInspectResponse.status, 200);
		const sourceUiInspectPayload = await sourceUiInspectResponse.json();
		assert.equal(sourceUiInspectPayload.selected.kind, "publishedVersion");
		assert.equal(sourceUiInspectPayload.selected.version.source, "ui");
		assert.equal(sourceUiInspectPayload.selected.version.status, "published");
		assert.equal(sourceUiInspectPayload.selected.version.definitionHash, publishSourceDraftPayload.publishedVersion.definitionHash);
		assert.equal(sourceUiInspectPayload.selected.definition.id, "ui-standard-project-copy");
		assert.equal(sourceUiInspectPayload.selected.definition.nodes.agent.promptTemplate, "Preserved UI published prompt.\\n\\n{{input}}");

		const archivedDuplicateResponse = await fetch(`${baseURL}/api/chat/workflows/archived-review-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(archivedDuplicateResponse.status, 404);
	} finally {
		await channel.stop?.();
	}
});

test("workflow archive API applies at workflow identity scope and hides archived workflows from selection", async () => {
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
		const archiveResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ reason: "Deprecated by a newer review workflow." }),
		});
		assert.equal(archiveResponse.status, 200);
		const archivePayload = await archiveResponse.json();
		assert.equal(archivePayload.archiveState.workflowId, "ui-review-workflow");
		assert.equal(archivePayload.archiveState.archived, true);
		assert.equal(archivePayload.archiveState.archiveReason, "Deprecated by a newer review workflow.");
		assert.equal(archivePayload.workflow.id, "ui-review-workflow");
		assert.equal(archivePayload.workflow.status, "archived");
		assert.deepEqual(archivePayload.workflow.versions.map((version) => `${version.version}:${version.status}`), ["2.0.0:archived"]);

		const defaultCatalogResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultCatalogResponse.status, 200);
		const defaultCatalogPayload = await defaultCatalogResponse.json();
		assert.equal(defaultCatalogPayload.workflows.some((workflow) => workflow.id === "ui-review-workflow"), false);

		const archivedCatalogResponse = await fetch(`${baseURL}/api/chat/workflows?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedCatalogResponse.status, 200);
		const archivedCatalogPayload = await archivedCatalogResponse.json();
		const archivedWorkflow = archivedCatalogPayload.workflows.find((workflow) => workflow.id === "ui-review-workflow");
		assert.ok(archivedWorkflow);
		assert.equal(archivedWorkflow.status, "archived");
		assert.equal(archivedWorkflow.editability.canCreateProjectSession, false);
		assert.equal(archivedWorkflow.editability.canArchive, false);

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.options.some((option) => option.id === "ui-review-workflow"), false);

		const historyResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history?selectedWorkflowId=ui-review-workflow&selectedWorkflowVersion=2.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(historyResponse.status, 200);
		const historyPayload = await historyResponse.json();
		assert.equal(historyPayload.selectedWorkflowId, "ui-review-workflow");
		assert.equal(historyPayload.selectedWorkflowVersion, "2.0.0");
		assert.ok(historyPayload.options.some((option) => `${option.id}@${option.version}:${option.status}` === "ui-review-workflow@2.0.0:archived"));

		const defaultInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow?version=2.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultInspectResponse.status, 404);

		const archivedInspectResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow?version=2.0.0&includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedInspectResponse.status, 200);
		const archivedInspectPayload = await archivedInspectResponse.json();
		assert.equal(archivedInspectPayload.selected.version.status, "archived");

		const codeArchiveResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/archive`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(codeArchiveResponse.status, 409);
		assert.match((await codeArchiveResponse.json()).error, /Code workflow projections are read-only/);
	} finally {
		await channel.stop?.();
	}
});

test("workflow delete API tombstones UI workflows while preserving Project snapshots", async () => {
	const { channel, baseURL, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				name: "Deleted Workflow History Project",
				projectFolder: join(storageDir, "deleted-workflow-history-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		const sessionResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "ui-review-workflow",
				workflowVersion: "2.0.0",
				title: "Review run before delete",
			}),
		});
		assert.equal(sessionResponse.status, 201);
		const sessionPayload = await sessionResponse.json();

		const startResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(sessionPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(startResponse.status, 202);
		const startPayload = await startResponse.json();
		assert.equal(startPayload.run.snapshotId, sessionPayload.snapshot.id);

		const unauthenticatedDelete = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow`, {
			method: "DELETE",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
			},
			body: JSON.stringify({ confirmWorkflowId: "ui-review-workflow" }),
		});
		assert.equal(unauthenticatedDelete.status, 401);

		const badConfirmation = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow`, {
			method: "DELETE",
			headers: jsonHeaders,
			body: JSON.stringify({ confirmWorkflowId: "wrong-workflow" }),
		});
		assert.equal(badConfirmation.status, 400);
		assert.match((await badConfirmation.json()).error, /Type "ui-review-workflow"/);

		const deleteResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow`, {
			method: "DELETE",
			headers: jsonHeaders,
			body: JSON.stringify({ confirmWorkflowId: "ui-review-workflow" }),
		});
		assert.equal(deleteResponse.status, 200);
		const deletePayload = await deleteResponse.json();
		assert.equal(deletePayload.workflowId, "ui-review-workflow");
		assert.equal(deletePayload.deleted, true);
		assert.equal(deletePayload.tombstone.workflowId, "ui-review-workflow");
		assert.equal(deletePayload.tombstone.deletedBy, "user:user-1");
		assert.equal(deletePayload.tombstone.lastKnownTitle, "UI Review Workflow");
		assert.equal(deletePayload.tombstone.lastKnownVersion, "2.0.0");
		assert.match(deletePayload.tombstone.lastDefinitionHash, /^sha256:[a-f0-9]{64}$/);

		const defaultCatalogResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(defaultCatalogResponse.status, 200);
		const defaultCatalogPayload = await defaultCatalogResponse.json();
		assert.equal(defaultCatalogPayload.workflows.some((workflow) => workflow.id === "ui-review-workflow"), false);

		const archivedCatalogResponse = await fetch(`${baseURL}/api/chat/workflows?includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(archivedCatalogResponse.status, 200);
		const archivedCatalogPayload = await archivedCatalogResponse.json();
		assert.equal(archivedCatalogPayload.workflows.some((workflow) => workflow.id === "ui-review-workflow"), false);

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/workflow-versions`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.options.some((option) => option.id === "ui-review-workflow"), false);

		const historyResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(historyResponse.status, 200);
		const historyPayload = await historyResponse.json();
		assert.equal(historyPayload.options.some((option) => option.id === "ui-review-workflow"), false);

		const inspectDeletedResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow?version=2.0.0&includeArchived=true`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectDeletedResponse.status, 404);

		const duplicateDeletedResponse = await fetch(`${baseURL}/api/chat/workflows/ui-review-workflow/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "2.0.0" }),
		});
		assert.equal(duplicateDeletedResponse.status, 404);

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectPayload.project.id)}&piboSessionId=${encodeURIComponent(sessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrapPayload = await bootstrapResponse.json();
		const projectSession = bootstrapPayload.projectSessions[0];
		assert.equal(projectSession.workflowRunId, startPayload.run.id);
		assert.equal(projectSession.workflowDefinitionLink.status, "snapshot_only_definition_deleted");
		assert.equal(projectSession.workflowDefinitionLink.workflowId, "ui-review-workflow");
		assert.equal(projectSession.workflowDefinitionLink.workflowVersion, "2.0.0");
		assert.equal(projectSession.workflowDefinitionLink.title, "UI Review Workflow");
		assert.equal(projectSession.workflowDefinitionLink.definitionHash, sessionPayload.snapshot.workflow.effectiveDefinitionHash);
		assert.equal(projectSession.workflowDefinitionLink.href, undefined);
		assert.match(projectSession.workflowDefinitionLink.tombstoneLabel, /Definition deleted/);

		const historicalRunResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(sessionPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(historicalRunResponse.status, 200);
		const historicalRunPayload = await historicalRunResponse.json();
		assert.equal(historicalRunPayload.alreadyStarted, true);
		assert.equal(historicalRunPayload.workflow.id, "ui-review-workflow");
		assert.equal(historicalRunPayload.workflow.version, "2.0.0");
		assert.equal(historicalRunPayload.workflow.source, "ui");
		assert.equal(historicalRunPayload.workflow.title, "UI Review Workflow");
		assert.equal(historicalRunPayload.projectSession.workflowRunId, startPayload.run.id);
		assert.equal(historicalRunPayload.snapshot.id, sessionPayload.snapshot.id);
		assert.equal(historicalRunPayload.snapshot.deletedDefinitionFallback.workflowId, "ui-review-workflow");
		assert.equal(historicalRunPayload.snapshot.deletedDefinitionFallback.workflowVersion, "2.0.0");
		assert.equal(historicalRunPayload.snapshot.workflow.effectiveDefinitionHash, sessionPayload.snapshot.workflow.effectiveDefinitionHash);
		assert.deepEqual(historicalRunPayload.snapshot.effectiveDefinition, sessionPayload.snapshot.effectiveDefinition);
		assert.equal(historicalRunPayload.run.id, startPayload.run.id);
		assert.equal(historicalRunPayload.run.snapshotId, sessionPayload.snapshot.id);
		assert.equal(historicalRunPayload.run.effectiveDefinitionHash, sessionPayload.snapshot.workflow.effectiveDefinitionHash);

		const lifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?type=workflow.delete.tombstoned&workflowId=ui-review-workflow`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(lifecycleResponse.status, 200);
		const lifecyclePayload = await lifecycleResponse.json();
		assert.equal(lifecyclePayload.events.length, 1);
		assert.equal(lifecyclePayload.events[0].payload.lastKnownVersion, "2.0.0");
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
				required: ["steps"],
				additionalProperties: false,
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
					guard: { handler: "fixture.guards.approved", priority: 0, params: { expected: true } },
				},
				"plan-to-review": {
					id: "plan-to-review",
					from: { nodeId: "plan" },
					to: { nodeId: "review" },
					kind: "data",
					adapter: {
						kind: "edgeAdapter",
						transform: { kind: "adapter", language: "typescript", id: "fixture.adapters.draftToSummary", params: { format: "compact" } },
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

		const invalidParamsDefinition = structuredClone(secureDefinition);
		invalidParamsDefinition.nodes.normalize.handler.params = { unsupported: true };
		invalidParamsDefinition.edges["collect-to-plan"].guard.params = { expected: "yes", extra: true };
		invalidParamsDefinition.edges["plan-to-review"].adapter.transform.params = { format: 12 };
		const invalidParamsPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: invalidParamsDefinition, editTrigger: "edge_edit" }),
		});
		assert.equal(invalidParamsPatchResponse.status, 200);
		const invalidParamsPatchPayload = await invalidParamsPatchResponse.json();
		assert.equal(invalidParamsPatchPayload.validation.ok, false);
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unexpectedAdapterParams" && diagnostic.path === "$.nodes.normalize.handler.params" && diagnostic.nodeId === "normalize"));
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.invalidGuardParams" && diagnostic.path === "$.edges.collect-to-plan.guard.params.expected" && diagnostic.edgeId === "collect-to-plan"));
		assert.ok(invalidParamsPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.invalidAdapterParams" && diagnostic.path === "$.edges.plan-to-review.adapter.transform.params.format" && diagnostic.edgeId === "plan-to-review"));

		const incompatibleAdapterOutputDefinition = structuredClone(secureDefinition);
		incompatibleAdapterOutputDefinition.edges["plan-to-review"].adapter.output = planPort;
		const incompatibleAdapterOutputResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition: incompatibleAdapterOutputDefinition, editTrigger: "edge_edit" }),
		});
		assert.equal(incompatibleAdapterOutputResponse.status, 200);
		const incompatibleAdapterOutputPayload = await incompatibleAdapterOutputResponse.json();
		assert.equal(incompatibleAdapterOutputPayload.validation.ok, false);
		assert.ok(incompatibleAdapterOutputPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.incompatibleEdgeAdapterOutput" && diagnostic.path === "$.edges.plan-to-review.adapter.output" && diagnostic.edgeId === "plan-to-review"));

		const invalidDefinition = structuredClone(secureDefinition);
		invalidDefinition.xstate = { states: { injected: {} } };
		invalidDefinition.script = "echo bypass compute worker isolation";
		invalidDefinition.nodes.collect.profile.id = "missing.profiles.inline";
		invalidDefinition.nodes.plan.handler = "missing.handlers.inline";
		invalidDefinition.nodes.plan.inlineTypeScript = "return await eval(input);";
		invalidDefinition.nodes.normalize.handler.id = "missing.adapters.inline";
		invalidDefinition.nodes.normalize.mode = "llm";
		invalidDefinition.nodes.promptAsset.promptBuilder.id = "missing.promptAssets.inline";
		invalidDefinition.nodes.childWorkflow = {
			kind: "workflow",
			workflowId: "missing-nested-workflow",
			workflowVersion: "9.9.9",
			input: textPort,
			output: textPort,
		};
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
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownAgentProfileRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHandlerRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownAdapterRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownGuardRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownPromptBuilderRef"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.unknownHumanActionRef"));
		assert.ok(diagnosticCodes.has("WorkflowCatalogError.unknownWorkflowVersion"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.humanActionKindMismatch"));
		assert.ok(diagnosticCodes.has("WorkflowGraphError.incompatibleEdgePorts"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.inlineExecutableCode"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.hiddenLlmCoercion"));
		assert.ok(diagnosticCodes.has("WorkflowSecurityError.rawXStateAuthoring"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowSecurityError.inlineExecutableCode" && diagnostic.path === "$.script"));
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowSecurityError.rawXStateAuthoring" && diagnostic.path === "$.xstate"));
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAgentProfileRef",
			registryRef: "missing.profiles.inline",
			nodeId: "collect",
			path: "$.nodes.collect.profile.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHandlerRef",
			registryRef: "missing.handlers.inline",
			nodeId: "plan",
			path: "$.nodes.plan.handler",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAdapterRef",
			registryRef: "missing.adapters.inline",
			nodeId: "normalize",
			path: "$.nodes.normalize.handler.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownPromptBuilderRef",
			registryRef: "missing.promptAssets.inline",
			nodeId: "promptAsset",
			path: "$.nodes.promptAsset.promptBuilder.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHumanActionRef",
			registryRef: "missing.humanActions.inline",
			nodeId: "review",
			path: "$.nodes.review.actions.0.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownGuardRef",
			registryRef: "missing.guards.inline",
			edgeId: "collect-to-plan",
			path: "$.edges.collect-to-plan.guard.handler",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowGraphError.unknownAdapterRef",
			registryRef: "missing.adapters.edge",
			edgeId: "plan-to-review",
			path: "$.edges.plan-to-review.adapter.transform.id",
		});
		assertStructuredMissingRefDiagnostic(invalidPatchPayload.diagnostics, {
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			registryRef: "missing-nested-workflow@9.9.9",
			nodeId: "childWorkflow",
			path: "$.nodes.childWorkflow.workflowId",
		});
		assert.ok(invalidPatchPayload.diagnostics.some((diagnostic) => diagnostic.hint?.includes("Hidden LLM coercion is not allowed")));

		const invalidPublishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(invalidPublishResponse.status, 422);
		const invalidPublishPayload = await invalidPublishResponse.json();
		assert.equal(invalidPublishPayload.validation.trigger, "before_publish");
		assert.equal(invalidPublishPayload.validation.blocksPublish, true);
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAdapterRef" && diagnostic.registryRef === "missing.adapters.inline"));
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAdapterRef" && diagnostic.registryRef === "missing.adapters.edge"));
		assert.ok(invalidPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownHumanActionRef" && diagnostic.registryRef === "missing.humanActions.inline"));

		const inspectResponse = await fetch(`${baseURL}/api/chat/workflows/${encodeURIComponent(duplicatePayload.draft.workflowId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectResponse.status, 200);
		const inspectPayload = await inspectResponse.json();
		assert.equal(inspectPayload.selected.kind, "draft");
		assertStructuredMissingRefDiagnostic(inspectPayload.diagnostics, {
			code: "WorkflowGraphError.unknownHandlerRef",
			registryRef: "missing.handlers.inline",
			nodeId: "plan",
			path: "$.nodes.plan.handler",
		});
		assertStructuredMissingRefDiagnostic(inspectPayload.workflow.missingRefs, {
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			registryRef: "missing-nested-workflow@9.9.9",
			nodeId: "childWorkflow",
			path: "$.nodes.childWorkflow.workflowId",
		});
		assert.equal(inspectPayload.workflow.missingRefs.some((diagnostic) => diagnostic.code === "WorkflowGraphError.humanActionKindMismatch"), false);
	} finally {
		await channel.stop?.();
	}
});

test("workflow prompt asset revisions create managed assets and draft prompt refs", async () => {
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

		const saveAssetResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				sourceRefId: "fixture.promptBuilders.draftPrompt",
				displayName: "Agent prompt asset",
				description: "Managed prompt asset from the Workflow Builder Markdown editor.",
				markdown: "# Draft prompt\n\nUse {{input}} to write a crisp answer.",
			}),
		});
		assert.equal(saveAssetResponse.status, 201);
		const saveAssetPayload = await saveAssetResponse.json();
		assert.match(saveAssetPayload.asset.id, /^ui\.promptAssets\./);
		assert.equal(saveAssetPayload.asset.source, "ui");
		assert.equal(saveAssetPayload.asset.readOnly, false);
		assert.match(saveAssetPayload.asset.revisionId, /^wpar_/);
		assert.match(saveAssetPayload.asset.contentHash, /^sha256:/);
		assert.equal(saveAssetPayload.asset.markdown, "# Draft prompt\n\nUse {{input}} to write a crisp answer.");

		const promptAssetResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets/${encodeURIComponent(saveAssetPayload.asset.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(promptAssetResponse.status, 200);
		const promptAssetPayload = await promptAssetResponse.json();
		assert.equal(promptAssetPayload.asset.revisionId, saveAssetPayload.asset.revisionId);

		const pickerResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/prompt-assets?selectedRefId=${encodeURIComponent(saveAssetPayload.asset.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(pickerResponse.status, 200);
		const pickerPayload = await pickerResponse.json();
		assert.equal(pickerPayload.selectedRefId, saveAssetPayload.asset.id);
		assert.ok(pickerPayload.options.some((option) => option.id === saveAssetPayload.asset.id && option.kind === "ui"));

		const definition = structuredClone(duplicatePayload.draft.definition);
		definition.nodes.agent = {
			...definition.nodes.agent,
			promptBuilder: {
				kind: "promptBuilder",
				language: "typescript",
				id: saveAssetPayload.asset.id,
				revisionId: saveAssetPayload.asset.revisionId,
				contentHash: saveAssetPayload.asset.contentHash,
				source: saveAssetPayload.asset.source,
			},
			metadata: {
				...(definition.nodes.agent.metadata ?? {}),
				promptAssetRefs: [saveAssetPayload.asset.id],
				promptAssetPins: [{
					assetId: saveAssetPayload.asset.id,
					revisionId: saveAssetPayload.asset.revisionId,
					contentHash: saveAssetPayload.asset.contentHash,
					source: saveAssetPayload.asset.source,
				}],
			},
		};
		delete definition.nodes.agent.promptTemplate;
		definition.metadata = {
			...(definition.metadata ?? {}),
			promptAssetRefs: [saveAssetPayload.asset.id],
			promptAssetPins: [{
				assetId: saveAssetPayload.asset.id,
				revisionId: saveAssetPayload.asset.revisionId,
				contentHash: saveAssetPayload.asset.contentHash,
				source: saveAssetPayload.asset.source,
			}],
		};

		const patchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: jsonHeaders,
			body: JSON.stringify({ definition, editTrigger: "prompt_edit" }),
		});
		assert.equal(patchResponse.status, 200);
		const patchPayload = await patchResponse.json();
		assert.equal(patchPayload.validation.trigger, "prompt_edit");
		assert.equal(patchPayload.validation.ok, true);
		assert.equal(patchPayload.draft.definition.nodes.agent.promptBuilder.id, saveAssetPayload.asset.id);
		assert.equal(patchPayload.draft.definition.nodes.agent.promptTemplate, undefined);
		assert.equal(patchPayload.draft.definition.nodes.agent.metadata.promptAssetPins[0].revisionId, saveAssetPayload.asset.revisionId);
		assert.equal(patchPayload.draft.definition.metadata.promptAssetPins[0].contentHash, saveAssetPayload.asset.contentHash);

		const secondRevisionResponse = await fetch(`${baseURL}/api/chat/workflows/prompt-assets`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				assetId: saveAssetPayload.asset.id,
				displayName: "Agent prompt asset",
				markdown: "# Draft prompt\n\nUse {{input}} and include acceptance criteria.",
			}),
		});
		assert.equal(secondRevisionResponse.status, 201);
		const secondRevisionPayload = await secondRevisionResponse.json();
		assert.equal(secondRevisionPayload.asset.id, saveAssetPayload.asset.id);
		assert.notEqual(secondRevisionPayload.asset.revisionId, saveAssetPayload.asset.revisionId);
		assert.notEqual(secondRevisionPayload.asset.contentHash, saveAssetPayload.asset.contentHash);
		assert.equal(secondRevisionPayload.asset.markdown, "# Draft prompt\n\nUse {{input}} and include acceptance criteria.");
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

		const zeroNodeSaveDefinition = structuredClone(starterPayload.draft.definition);
		zeroNodeSaveDefinition.title = "Saved zero-node starter draft";
		zeroNodeSaveDefinition.nodes = {};
		zeroNodeSaveDefinition.edges = {};
		const zeroNodeSaveResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: zeroNodeSaveDefinition, editTrigger: "graph_edit" }),
		});
		assert.equal(zeroNodeSaveResponse.status, 200);
		const zeroNodeSavePayload = await zeroNodeSaveResponse.json();
		assert.equal(zeroNodeSavePayload.draft.definition.title, "Saved zero-node starter draft");
		assert.deepEqual(zeroNodeSavePayload.draft.definition.nodes, {});
		assert.equal(zeroNodeSavePayload.validation.ok, false);
		assert.ok(zeroNodeSavePayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));

		const starterPublishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/v2-starter-draft/publish`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(starterPublishResponse.status, 422);
		const starterPublishPayload = await starterPublishResponse.json();
		assert.equal(starterPublishPayload.validation.trigger, "before_publish");
		assert.equal(starterPublishPayload.validation.blocksPublish, true);
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.emptyGraph"));
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.missingPort" && diagnostic.path === "$.input"));
		assert.ok(starterPublishPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowValidationError.missingPort" && diagnostic.path === "$.output"));

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

		const unsupportedSchemaDefinition = structuredClone(rawRepairPayload.draft.definition);
		unsupportedSchemaDefinition.input = {
			kind: "json",
			schema: {
				type: "object",
				properties: {
					topic: { type: "string", pattern: "^[a-z]+$" },
				},
				required: ["topic"],
				additionalProperties: false,
			},
		};
		const schemaPatchResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ definition: unsupportedSchemaDefinition, editTrigger: "schema_edit" }),
		});
		assert.equal(schemaPatchResponse.status, 200);
		const schemaPatchPayload = await schemaPatchResponse.json();
		assert.equal(schemaPatchPayload.validation.trigger, "schema_edit");
		assert.equal(schemaPatchPayload.validation.ok, false);
		assert.ok(schemaPatchPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.unsupportedSchemaKeyword" && diagnostic.path === "$.input.schema.properties.topic.pattern"));

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

test("workflow Project session creation validates persisted UI-published definitions", async () => {
	const { channel, baseURL, setProfiles, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }, { name: "temporary-workflow-agent" }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const definition = {
			id: "ui-validation-boundary",
			version: "0.1.0",
			title: "UI Validation Boundary",
			description: "UI-published workflow used to verify Project creation validation.",
			metadata: { tags: ["validation", "project"] },
			input: { kind: "text", description: "Topic" },
			output: { kind: "text", description: "Answer" },
			initial: "agent",
			nodes: {
				agent: {
					kind: "agent",
					runtime: "pibo",
					profile: { kind: "fixed", id: "temporary-workflow-agent" },
					promptTemplate: "Answer the workflow input.",
					metadata: { sessionOverrides: { prompt: true } },
				},
			},
			edges: {},
			ui: { layout: "auto", positions: { agent: { x: 80, y: 80 } } },
		};

		const createDraftResponse = await fetch(`${baseURL}/api/chat/workflows`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ workflowId: definition.id, title: definition.title, description: definition.description, definition }),
		});
		assert.equal(createDraftResponse.status, 201);
		const createDraftPayload = await createDraftResponse.json();
		assert.equal(createDraftPayload.draft.validation.trigger, "draft_load");
		assert.equal(createDraftPayload.draft.validation.ok, true);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(createDraftPayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 201);
		const publishPayload = await publishResponse.json();
		const workflowVersion = publishPayload.publishedVersion.version;
		assert.equal(publishPayload.publishedVersion.definition.nodes.agent.profile.id, "temporary-workflow-agent");

		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				name: "Workflow Validation Boundary Project",
				projectFolder: join(storageDir, "workflow-validation-boundary-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		setProfiles([{ name: "pibo-agent", aliases: ["default"] }]);
		const blockedCreateResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: definition.id,
				workflowVersion,
				title: "Blocked persisted UI definition",
			}),
		});
		assert.equal(blockedCreateResponse.status, 422);
		const blockedCreatePayload = await blockedCreateResponse.json();
		assert.equal(blockedCreatePayload.validation.trigger, "before_project_session_creation");
		assert.equal(blockedCreatePayload.validation.blocksRun, true);
		const missingProfileDiagnostic = blockedCreatePayload.diagnostics.find((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef");
		assert.ok(missingProfileDiagnostic);
		assert.equal(missingProfileDiagnostic.severity, "error");
		assert.equal(missingProfileDiagnostic.nodeId, "agent");
		assert.equal(missingProfileDiagnostic.path, "$.nodes.agent.profile.id");
		assert.equal(missingProfileDiagnostic.registryRef, "temporary-workflow-agent");
		assert.equal(typeof missingProfileDiagnostic.message, "string");
		assert.equal(typeof missingProfileDiagnostic.hint, "string");

		setProfiles([{ name: "pibo-agent", aliases: ["default"] }, { name: "temporary-workflow-agent" }]);
		const acceptedCreateResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: definition.id,
				workflowVersion,
				title: "Accepted persisted UI definition",
			}),
		});
		assert.equal(acceptedCreateResponse.status, 201);
		const acceptedCreatePayload = await acceptedCreateResponse.json();
		assert.equal(acceptedCreatePayload.validation.trigger, "before_project_session_creation");
		assert.equal(acceptedCreatePayload.validation.ok, true);
		assert.equal(acceptedCreatePayload.snapshot.baseDefinition.nodes.agent.profile.id, "temporary-workflow-agent");
		assert.equal(acceptedCreatePayload.snapshot.effectiveDefinition.nodes.agent.profile.id, "temporary-workflow-agent");

		const startResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(acceptedCreatePayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(startResponse.status, 202);
		const startPayload = await startResponse.json();
		assert.equal(startPayload.validation.trigger, "before_workflow_start");
		assert.equal(startPayload.validation.ok, true);
		assert.equal(startPayload.snapshot.effectiveDefinition.nodes.agent.profile.id, "temporary-workflow-agent");
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

		const historyResponse = await fetch(`${baseURL}/api/chat/workflows/pickers/version-history`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(historyResponse.status, 200);
		const historyPayload = await historyResponse.json();
		const historyKeys = historyPayload.options.map((option) => `${option.id}@${option.version}:${option.status}`);
		assert.ok(historyKeys.includes("ui-review-workflow@2.0.0:published"));
		assert.ok(historyKeys.includes("ui-review-workflow@2.0.1:published"));
		assert.ok(historyKeys.indexOf("ui-review-workflow@2.0.0:published") < historyKeys.indexOf("ui-review-workflow@2.0.1:published"));
		assert.ok(historyKeys.includes("archived-review-workflow@1.0.0:archived"));

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

test("chat web app creates configured Project workflow sessions and starts one workflow run explicitly", async () => {
	const { channel, baseURL, emitted, storageDir, projectStorePath } = await startWebHostChannel({
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
		assert.match(createdPayload.snapshot.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		assert.equal(createdPayload.snapshot.createdBy, "user-1");
		assert.equal(createdPayload.snapshot.ownerScope, "user:user-1");
		assert.equal(createdPayload.snapshot.projectId, projectPayload.project.id);
		assert.equal(createdPayload.snapshot.piboSessionId, createdPayload.session.id);
		assert.equal(createdPayload.snapshot.workflow.id, "standard-project");
		assert.equal(createdPayload.snapshot.workflow.version, "1.0.0");
		assert.equal(createdPayload.snapshot.workflow.source, "code");
		assert.equal(createdPayload.snapshot.workflow.title, "Standard Project");
		assert.deepEqual(createdPayload.snapshot.workflow.tags, ["project", "workflow"]);
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
		assert.deepEqual(createdPayload.snapshot.promptAssetPins, []);
		assert.equal(createdPayload.snapshot.baseDefinition.nodes.agent.promptTemplate, "Use the workflow input to produce a concise answer.\n\n{{input}}");
		assert.equal(createdPayload.snapshot.effectiveDefinition.nodes.agent.promptTemplate, workflowConfiguration.promptOverrides.agent);
		assert.equal(createdPayload.snapshot.validation.trigger, "before_project_session_creation");
		assert.equal(createdPayload.snapshot.validation.ok, true);
		assert.match(createdPayload.snapshot.validation.validatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		assert.equal(emitted.length, 0);

		const immutablePatchResponse = await fetch(`${baseURL}/api/chat/project-sessions/${encodeURIComponent(createdPayload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({
				workflowId: "other-workflow",
				workflowVersion: "9.9.9",
				inputValues: { topic: "mutated" },
				promptOverrides: { agent: "mutated" },
				model: { provider: "openai", id: "gpt-5.2" },
				thinkingLevel: "high",
				fastMode: false,
			}),
		});
		assert.equal(immutablePatchResponse.status, 400);
		const immutablePatchPayload = await immutablePatchResponse.json();
		assert.match(immutablePatchPayload.error, /Project workflow selection and configuration are immutable/);

		const titlePatchResponse = await fetch(`${baseURL}/api/chat/project-sessions/${encodeURIComponent(createdPayload.session.id)}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ title: "Renamed Configured Standard Project" }),
		});
		assert.equal(titlePatchResponse.status, 200);
		const titlePatchPayload = await titlePatchResponse.json();
		assert.equal(titlePatchPayload.session.title, "Renamed Configured Standard Project");
		assert.equal(titlePatchPayload.projectSession.workflowId, "standard-project");
		assert.equal(titlePatchPayload.projectSession.workflowVersion, "1.0.0");
		assert.deepEqual(titlePatchPayload.projectSession.configuration, createdPayload.configuration);

		const inspectAfterOverrideResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project?version=1.0.0`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(inspectAfterOverrideResponse.status, 200);
		const inspectAfterOverridePayload = await inspectAfterOverrideResponse.json();
		assert.equal(inspectAfterOverridePayload.selected.definition.nodes.agent.promptTemplate, "Use the workflow input to produce a concise answer.\n\n{{input}}");

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
		assert.equal(startValidationPayload.projectSession.state, "running");
		assert.deepEqual(startValidationPayload.projectSession.configuration, createdPayload.configuration);
		assert.match(startValidationPayload.projectSession.workflowRunId, /^wfr_/);
		assert.equal(startValidationPayload.snapshot.id, createdPayload.snapshot.id);
		assert.deepEqual(startValidationPayload.snapshot.effectiveDefinition, createdPayload.snapshot.effectiveDefinition);
		assert.equal(startValidationPayload.alreadyStarted, false);
		assert.equal(startValidationPayload.run.id, startValidationPayload.projectSession.workflowRunId);
		assert.equal(startValidationPayload.run.status, "running");
		assert.equal(startValidationPayload.run.snapshotId, createdPayload.snapshot.id);
		assert.equal(startValidationPayload.run.effectiveDefinitionHash, createdPayload.snapshot.workflow.effectiveDefinitionHash);
		assert.deepEqual(startValidationPayload.run.inputValues, workflowConfiguration.inputValues);
		assert.deepEqual(startValidationPayload.run.current.initialNodeIds, ["agent"]);
		assert.equal(startValidationPayload.run.current.nodeId, "agent");
		assert.equal(emitted.length, 0);

		const secondStartResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(createdPayload.session.id)}/start`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({}),
		});
		assert.equal(secondStartResponse.status, 200);
		const secondStartPayload = await secondStartResponse.json();
		assert.equal(secondStartPayload.alreadyStarted, true);
		assert.equal(secondStartPayload.projectSession.workflowRunId, startValidationPayload.projectSession.workflowRunId);
		assert.equal(secondStartPayload.run.id, startValidationPayload.run.id);

		const projectDb = new DatabaseSync(projectStorePath, { readOnly: true });
		try {
			const rows = projectDb.prepare("SELECT id, pibo_session_id FROM project_workflow_runs WHERE pibo_session_id = ?").all(createdPayload.session.id);
			assert.equal(rows.length, 1);
			assert.equal(rows[0].id, startValidationPayload.run.id);
		} finally {
			projectDb.close();
		}

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

test("chat web app lists and resolves Project workflow human wait tokens", async () => {
	const { channel, baseURL, storageDir, projectStorePath } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});
	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};
	const postHumanAction = (piboSessionId, body) => fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions/${encodeURIComponent(piboSessionId)}/human-actions`, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify(body),
	});
	let projectId;

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				name: "Workflow Human Actions Project",
				projectFolder: join(storageDir, "workflow-human-actions-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();
		projectId = projectPayload.project.id;

		const createdResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Human Review Workflow",
			}),
		});
		assert.equal(createdResponse.status, 201);
		const createdPayload = await createdResponse.json();

		const startResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions/${encodeURIComponent(createdPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(startResponse.status, 202);
		const startPayload = await startResponse.json();
		const runId = startPayload.run.id;

		const otherCreatedResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Other Human Review Workflow",
			}),
		});
		assert.equal(otherCreatedResponse.status, 201);
		const otherCreatedPayload = await otherCreatedResponse.json();
		const otherStartResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions/${encodeURIComponent(otherCreatedPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(otherStartResponse.status, 202);

		const db = new DatabaseSync(projectStorePath);
		try {
			const now = new Date().toISOString();
			const insertWaitToken = ({ id, actions, schema, expiresAt }) => {
				db.prepare(`INSERT INTO project_workflow_wait_tokens (
					id,
					project_id,
					pibo_session_id,
					workflow_run_id,
					node_attempt_id,
					human_node_id,
					actions_json,
					prompt,
					schema_json,
					status,
					resume_payload_json,
					resume_payload_present,
					expires_at,
					created_at,
					resolved_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, NULL)`)
					.run(
						id,
						projectId,
						createdPayload.session.id,
						runId,
						`wna_${id}`,
						"review",
						JSON.stringify(actions),
						`Review prompt for ${id}`,
						schema ? JSON.stringify(schema) : null,
						expiresAt ?? null,
						now,
					);
			};
			insertWaitToken({ id: "wwt_approve", actions: [{ id: "fixture.humanActions.approve", kind: "approve" }] });
			insertWaitToken({ id: "wwt_reject", actions: [{ id: "fixture.humanActions.reject", kind: "reject" }] });
			insertWaitToken({
				id: "wwt_resume",
				actions: [{ id: "fixture.humanActions.resume", kind: "resume" }],
				schema: {
					type: "object",
					properties: { comment: { type: "string" } },
					required: ["comment"],
					additionalProperties: false,
				},
			});
			insertWaitToken({ id: "wwt_cancel", actions: [{ id: "fixture.humanActions.cancel", kind: "cancel" }] });
			insertWaitToken({
				id: "wwt_expired",
				actions: [{ id: "fixture.humanActions.approve", kind: "approve" }],
				expiresAt: "2000-01-01T00:00:00.000Z",
			});
			insertWaitToken({ id: "wwt_missing_action_ref", actions: [{ id: "missing.humanActions.inline", kind: "approve" }] });
			db.prepare("UPDATE project_workflow_runs SET status = 'waiting' WHERE id = ?").run(runId);
			db.prepare("UPDATE project_sessions SET state = 'waiting' WHERE pibo_session_id = ?").run(createdPayload.session.id);
		} finally {
			db.close();
		}

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectId)}&piboSessionId=${encodeURIComponent(createdPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrapPayload = await bootstrapResponse.json();
		const bootProjectSession = bootstrapPayload.projectSessions.find((session) => session.piboSessionId === createdPayload.session.id);
		assert.equal(bootProjectSession.pendingHumanActions.length, 6);
		const resumeWait = bootProjectSession.pendingHumanActions.find((action) => action.waitTokenId === "wwt_resume");
		assert.equal(resumeWait.prompt, "Review prompt for wwt_resume");
		assert.equal(resumeWait.availableActions[0].id, "fixture.humanActions.resume");
		assert.equal(resumeWait.availableActions[0].displayName, "Resume");
		assert.equal(resumeWait.payloadRequirements.required, true);
		assert.equal(resumeWait.payloadRequirements.schema.required[0], "comment");
		const missingActionWait = bootProjectSession.pendingHumanActions.find((action) => action.waitTokenId === "wwt_missing_action_ref");
		assert.equal(missingActionWait.availableActions[0].registered, false);
		assert.equal(missingActionWait.diagnostics[0].code, "WorkflowGraphError.unknownHumanActionRef");
		assert.equal(missingActionWait.diagnostics[0].registryRef, "missing.humanActions.inline");

		const missingTokenResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_missing", actionId: "fixture.humanActions.approve" });
		assert.equal(missingTokenResponse.status, 404);
		const missingTokenPayload = await missingTokenResponse.json();
		assert.equal(missingTokenPayload.diagnostics[0].code, "WorkflowRuntimeError.unknownWaitToken");

		const mismatchResponse = await postHumanAction(otherCreatedPayload.session.id, { waitTokenId: "wwt_resume", actionId: "fixture.humanActions.resume" });
		assert.equal(mismatchResponse.status, 403);
		const mismatchPayload = await mismatchResponse.json();
		assert.equal(mismatchPayload.diagnostics[0].code, "WorkflowRuntimeError.waitTokenSessionMismatch");

		const unavailableResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_resume", actionId: "fixture.humanActions.approve" });
		assert.equal(unavailableResponse.status, 422);
		const unavailablePayload = await unavailableResponse.json();
		assert.equal(unavailablePayload.diagnostics[0].code, "WorkflowRuntimeError.humanActionUnavailable");

		const invalidResumeResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_resume", actionId: "fixture.humanActions.resume", payload: {} });
		assert.equal(invalidResumeResponse.status, 422);
		const invalidResumePayload = await invalidResumeResponse.json();
		assert.equal(invalidResumePayload.diagnostics[0].code, "WorkflowRuntimeError.invalidHumanActionPayload");

		const missingActionRefResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_missing_action_ref", actionId: "missing.humanActions.inline" });
		assert.equal(missingActionRefResponse.status, 422);
		const missingActionRefPayload = await missingActionRefResponse.json();
		assert.equal(missingActionRefPayload.diagnostics[0].code, "WorkflowGraphError.unknownHumanActionRef");
		assert.equal(missingActionRefPayload.diagnostics[0].registryRef, "missing.humanActions.inline");

		const approveResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_approve", actionId: "fixture.humanActions.approve" });
		assert.equal(approveResponse.status, 202);
		const approvePayload = await approveResponse.json();
		assert.equal(approvePayload.action.kind, "approve");
		assert.equal(approvePayload.waitToken.status, "resumed");

		const rejectResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_reject", actionId: "fixture.humanActions.reject" });
		assert.equal(rejectResponse.status, 202);
		const rejectPayload = await rejectResponse.json();
		assert.equal(rejectPayload.action.kind, "reject");

		const resumeResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_resume", actionId: "fixture.humanActions.resume", payload: { comment: "Looks good" } });
		assert.equal(resumeResponse.status, 202);
		const resumePayload = await resumeResponse.json();
		assert.equal(resumePayload.action.kind, "resume");
		assert.deepEqual(resumePayload.action.payload, { comment: "Looks good" });

		const replayResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_approve", actionId: "fixture.humanActions.approve" });
		assert.equal(replayResponse.status, 409);
		const replayPayload = await replayResponse.json();
		assert.equal(replayPayload.diagnostics[0].code, "WorkflowRuntimeError.waitTokenNotPending");

		const cancelResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_cancel", actionId: "fixture.humanActions.cancel" });
		assert.equal(cancelResponse.status, 200);
		const cancelPayload = await cancelResponse.json();
		assert.equal(cancelPayload.action.kind, "cancel");
		assert.equal(cancelPayload.run.status, "cancelled");
		assert.equal(cancelPayload.projectSession.state, "cancelled");

		const expiredResponse = await postHumanAction(createdPayload.session.id, { waitTokenId: "wwt_expired", actionId: "fixture.humanActions.approve" });
		assert.equal(expiredResponse.status, 409);
		const expiredPayload = await expiredResponse.json();
		assert.equal(expiredPayload.diagnostics[0].code, "WorkflowRuntimeError.waitTokenExpired");

		const lifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?projectId=${encodeURIComponent(projectId)}&limit=200`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(lifecycleResponse.status, 200);
		const lifecyclePayload = await lifecycleResponse.json();
		assert.ok(lifecyclePayload.events.some((event) => event.type === "workflow.human_action.submitted" && event.status === "submitted" && event.workflowRunId === runId));
		assert.ok(lifecyclePayload.events.some((event) => event.type === "workflow.human_action.submitted" && event.status === "blocked" && event.workflowRunId === runId));
	} finally {
		await channel.stop?.();
	}
});

test("workflow lifecycle observability records draft, publish, Project start, and blocked diagnostics", async () => {
	const { channel, baseURL, setProfiles, dataStorePath, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }, { name: "unstable-agent" }],
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

		const loadDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(loadDraftResponse.status, 200);

		const publishResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(duplicatePayload.draft.draftId)}/publish`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ versionIntent: "patch" }),
		});
		assert.equal(publishResponse.status, 201);

		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				name: "Workflow Observability Project",
				projectFolder: join(storageDir, "workflow-observability-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		const acceptedSessionResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "pibo-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Observable accepted start",
			}),
		});
		assert.equal(acceptedSessionResponse.status, 201);
		const acceptedSessionPayload = await acceptedSessionResponse.json();

		const acceptedStartResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(acceptedSessionPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(acceptedStartResponse.status, 202);

		const blockedSessionResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				profile: "unstable-agent",
				workflowId: "standard-project",
				workflowVersion: "1.0.0",
				title: "Observable blocked start",
			}),
		});
		assert.equal(blockedSessionResponse.status, 201);
		const blockedSessionPayload = await blockedSessionResponse.json();

		setProfiles([{ name: "pibo-agent", aliases: ["default"] }]);
		const blockedStartResponse = await fetch(`${baseURL}/api/chat/projects/${encodeURIComponent(projectPayload.project.id)}/workflow-sessions/${encodeURIComponent(blockedSessionPayload.session.id)}/start`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({}),
		});
		assert.equal(blockedStartResponse.status, 422);
		const blockedStartPayload = await blockedStartResponse.json();
		assert.equal(blockedStartPayload.validation.trigger, "before_workflow_start");
		assert.ok(blockedStartPayload.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef"));

		const lifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?projectId=${encodeURIComponent(projectPayload.project.id)}&limit=200`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(lifecycleResponse.status, 200);
		const lifecyclePayload = await lifecycleResponse.json();
		const eventTypes = new Set(lifecyclePayload.events.map((event) => event.type));
		assert.ok(eventTypes.has("project.workflow_session.created"));
		assert.ok(eventTypes.has("project.workflow_start.accepted"));
		assert.ok(eventTypes.has("project.workflow_start.blocked"));
		assert.ok(eventTypes.has("workflow.validation.completed"));
		const blockedEvent = lifecyclePayload.events.find((event) => event.type === "project.workflow_start.blocked" && event.piboSessionId === blockedSessionPayload.session.id);
		assert.ok(blockedEvent);
		assert.equal(blockedEvent.validation.trigger, "before_workflow_start");
		assert.ok(blockedEvent.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef"));

		const draftLifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?draftId=${encodeURIComponent(duplicatePayload.draft.draftId)}&limit=200`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(draftLifecycleResponse.status, 200);
		const draftLifecyclePayload = await draftLifecycleResponse.json();
		const draftEventTypes = new Set(draftLifecyclePayload.events.map((event) => event.type));
		assert.ok(draftEventTypes.has("workflow.draft.saved"));
		assert.ok(draftEventTypes.has("workflow.validation.completed"));
		assert.ok(draftEventTypes.has("workflow.publish.accepted"));

		const bootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectPayload.project.id)}&piboSessionId=${encodeURIComponent(blockedSessionPayload.session.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrapResponse.status, 200);
		const bootstrapPayload = await bootstrapResponse.json();
		assert.ok(bootstrapPayload.workflowLifecycleEvents.some((event) => event.type === "project.workflow_start.blocked" && event.piboSessionId === blockedSessionPayload.session.id));

		const db = new DatabaseSync(dataStorePath, { readOnly: true });
		try {
			const rows = db.prepare("SELECT type, pibo_session_id FROM workflow_lifecycle_events ORDER BY created_at").all();
			assert.ok(rows.some((row) => row.type === "project.workflow_start.accepted" && row.pibo_session_id === acceptedSessionPayload.session.id));
			assert.ok(rows.some((row) => row.type === "project.workflow_start.blocked" && row.pibo_session_id === blockedSessionPayload.session.id));
		} finally {
			db.close();
		}
	} finally {
		await channel.stop?.();
	}
});

test("workflow diagnostics are redacted and scoped to owning Project sessions", async () => {
	const { channel, baseURL, dataStorePath, storageDir } = await startWebHostChannel({
		auth: createFakeAuthService(),
		profiles: [{ name: "pibo-agent", aliases: ["default"] }],
	});

	const jsonHeaders = {
		"content-type": "application/json",
		origin: baseURL,
		"x-test-user": "user-1",
	};

	try {
		const projectResponse = await fetch(`${baseURL}/api/chat/projects`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				name: "Workflow Diagnostic Redaction Project",
				projectFolder: join(storageDir, "workflow-diagnostic-redaction-project"),
				createFolder: true,
			}),
		});
		assert.equal(projectResponse.status, 201);
		const projectPayload = await projectResponse.json();

		const otherUserProjectsResponse = await fetch(`${baseURL}/api/chat/projects`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(otherUserProjectsResponse.status, 200);
		const otherUserProjectsPayload = await otherUserProjectsResponse.json();
		assert.equal(otherUserProjectsPayload.projects.some((project) => project.id === projectPayload.project.id), false);

		const otherUserBootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectPayload.project.id)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(otherUserBootstrapResponse.status, 404);

		const duplicateResponse = await fetch(`${baseURL}/api/chat/workflows/standard-project/duplicate`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ version: "1.0.0" }),
		});
		assert.equal(duplicateResponse.status, 201);
		const duplicatePayload = await duplicateResponse.json();
		const draftId = duplicatePayload.draft.draftId;

		const poisonedDiagnostic = {
			code: "WorkflowBuilderWarning.poisonedDiagnostic",
			message: "inputValues: {\"secret\":\"s3cr3t\"} output: \"top-secret-output\"",
			severity: "warning",
			path: "$.nodes.agent.promptTemplate",
			nodeId: "agent",
			edgeId: "agent-to-review",
			registryRef: "missing-ref",
			hint: "promptTemplate=\"secret prompt\" state: {\"token\":\"secret-state\"}",
			inputValues: { secret: "s3cr3t" },
			output: { secret: "top-secret-output" },
			state: { token: "secret-state" },
			payload: { secret: "secret-payload" },
			humanActionPayload: { secret: "secret-human" },
		};
		const db = new DatabaseSync(dataStorePath);
		try {
			db.prepare("UPDATE workflow_ui_drafts SET diagnostics_json = ? WHERE draft_id = ?").run(JSON.stringify([poisonedDiagnostic]), draftId);
		} finally {
			db.close();
		}

		const draftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(draftResponse.status, 200);
		const draftPayload = await draftResponse.json();
		const redactedDiagnostic = draftPayload.draft.diagnostics.find((diagnostic) => diagnostic.code === poisonedDiagnostic.code);
		assert.ok(redactedDiagnostic);
		assert.equal(redactedDiagnostic.path, "$.nodes.agent.promptTemplate");
		assert.equal(redactedDiagnostic.nodeId, "agent");
		assert.equal(redactedDiagnostic.edgeId, "agent-to-review");
		assert.equal(redactedDiagnostic.registryRef, "missing-ref");
		assert.equal(Object.hasOwn(redactedDiagnostic, "inputValues"), false);
		assert.equal(Object.hasOwn(redactedDiagnostic, "output"), false);
		assert.equal(Object.hasOwn(redactedDiagnostic, "payload"), false);
		assert.match(redactedDiagnostic.message, /inputValues: \[redacted\]/);
		assert.match(redactedDiagnostic.message, /output: \[redacted\]/);
		assert.match(redactedDiagnostic.hint, /promptTemplate: \[redacted\]/);
		assert.match(redactedDiagnostic.hint, /state: \[redacted\]/);
		assert.doesNotMatch(JSON.stringify(draftPayload.draft.diagnostics), /s3cr3t|top-secret-output|secret prompt|secret-state|secret-payload|secret-human/);

		const otherUserDraftResponse = await fetch(`${baseURL}/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(otherUserDraftResponse.status, 200);
		const otherUserDraftPayload = await otherUserDraftResponse.json();
		assert.equal(otherUserDraftPayload.draft.workflowId, "ui-standard-project-copy");
		assert.doesNotMatch(JSON.stringify(otherUserDraftPayload.draft.diagnostics), /s3cr3t|top-secret-output|secret prompt|secret-state|secret-payload|secret-human/);

		const lifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?draftId=${encodeURIComponent(draftId)}&limit=20`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(lifecycleResponse.status, 200);
		const lifecyclePayload = await lifecycleResponse.json();
		assert.ok(lifecyclePayload.events.some((event) => event.diagnostics.some((diagnostic) => diagnostic.code === poisonedDiagnostic.code)));
		assert.doesNotMatch(JSON.stringify(lifecyclePayload.events), /s3cr3t|top-secret-output|secret prompt|secret-state|secret-payload|secret-human/);

		const otherUserLifecycleResponse = await fetch(`${baseURL}/api/chat/workflows/lifecycle-events?draftId=${encodeURIComponent(draftId)}&limit=20`, {
			headers: { "x-test-user": "user-2" },
		});
		assert.equal(otherUserLifecycleResponse.status, 200);
		const otherUserLifecyclePayload = await otherUserLifecycleResponse.json();
		assert.ok(otherUserLifecyclePayload.events.some((event) => event.draftId === draftId));
		assert.doesNotMatch(JSON.stringify(otherUserLifecyclePayload.events), /s3cr3t|top-secret-output|secret prompt|secret-state|secret-payload|secret-human/);
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
	const { channel, baseURL, sessions, storageDir, projectStorePath } = await startWebHostChannel({
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
		assert.equal(bootstrapPayload.projectSessions[0].workflowDefinitionLink.status, "live");
		assert.equal(bootstrapPayload.projectSessions[0].workflowDefinitionLink.workflowId, "standard-project");
		assert.equal(bootstrapPayload.projectSessions[0].workflowDefinitionLink.workflowVersion, "1.0.0");
		assert.equal(bootstrapPayload.projectSessions[0].workflowDefinitionLink.href, "/apps/chat/workflows/view/standard-project/1.0.0");

		const db = new DatabaseSync(projectStorePath);
		try {
			db.prepare("UPDATE project_sessions SET workflow_id = ?, workflow_version = ? WHERE pibo_session_id = ?").run("deleted-review-workflow", "9.9.9", root.id);
		} finally {
			db.close();
		}

		const deletedBootstrapResponse = await fetch(`${baseURL}/api/chat/projects/bootstrap?projectId=${encodeURIComponent(projectPayload.project.id)}&piboSessionId=${encodeURIComponent(root.id)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(deletedBootstrapResponse.status, 200);
		const deletedBootstrapPayload = await deletedBootstrapResponse.json();
		const deletedProjectSession = deletedBootstrapPayload.projectSessions[0];
		assert.equal(deletedProjectSession.workflowDefinitionLink.status, "snapshot_only_definition_deleted");
		assert.equal(deletedProjectSession.workflowDefinitionLink.workflowId, "deleted-review-workflow");
		assert.equal(deletedProjectSession.workflowDefinitionLink.workflowVersion, "9.9.9");
		assert.equal(deletedProjectSession.workflowDefinitionLink.href, undefined);
		assert.match(deletedProjectSession.workflowDefinitionLink.tombstoneLabel, /Definition deleted/);
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

test("chat web app provider auth actions bypass session runtime auth", async () => {
	const { channel, baseURL, emitted } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const response = await fetch(`${baseURL}/api/chat/action`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ piboSessionId: "ps_missing_auth", action: "login.status", params: {} }),
		});
		assert.equal(response.status, 200);
		const payload = await response.json();
		assert.equal(payload.type, "execution_result");
		assert.equal(payload.action, "login.status");
		assert.ok(Array.isArray(payload.result.providers));
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
