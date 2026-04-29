import assert from "node:assert/strict";
import test from "node:test";
import { createChatWebApp } from "../dist/apps/chat/web-app.js";
import { PiboAuthError } from "../dist/auth/types.js";
import { createWebHostChannel } from "../dist/web/channel.js";

class MemoryBindingStore {
	bindings = new Map();
	bindingsByChannelExternalId = new Map();

	resolve(input) {
		const channelExternalId = `${input.channel}:${input.externalId}`;
		const existing = this.bindingsByChannelExternalId.get(channelExternalId);
		if (existing) return existing;

		const now = new Date().toISOString();
		const binding = {
			sessionKey: input.sessionKey ?? `${input.channel}:${input.externalId}`,
			sessionId: input.sessionId ?? `session-${this.bindings.size + 1}`,
			parentSessionKey: input.parentSessionKey,
			parentSessionId: input.parentSessionId,
			channel: input.channel,
			externalId: input.externalId,
			originalProfile: input.defaultProfile,
			workspace: input.workspace,
			createdAt: now,
			updatedAt: now,
		};
		this.bindings.set(binding.sessionKey, binding);
		this.bindingsByChannelExternalId.set(channelExternalId, binding);
		return binding;
	}

	get(sessionKey) {
		return this.bindings.get(sessionKey);
	}

	list() {
		return [...this.bindings.values()];
	}
}

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

async function startWebHostChannel(options = {}) {
	const emitted = [];
	const bindings = new MemoryBindingStore();
	const channel = createWebHostChannel({ port: 0, announce: false });

	await channel.start({
		auth: options.auth,
		emit(event) {
			emitted.push(event);
			return Promise.resolve({
				type: event.type === "message" ? "message_queued" : "execution_result",
				sessionKey: event.sessionKey,
				eventId: event.id,
				queuedMessages: event.type === "message" ? 1 : undefined,
				text: event.type === "message" ? event.text : undefined,
				action: event.type === "execution" ? event.action : undefined,
				result: event.type === "execution" ? { ok: true } : undefined,
			});
		},
		subscribe() {
			return () => {};
		},
		resolveSession(input) {
			return bindings.resolve(input);
		},
		listSessions() {
			return bindings.list();
		},
		getGatewayActions() {
			return [];
		},
		getWebApps() {
			return [createChatWebApp()];
		},
	});

	const address = channel.getAddress();
	assert.ok(address);
	return {
		channel,
		emitted,
		bindings,
		baseURL: `http://${address.host}:${address.port}`,
	};
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

test("chat web app maps authenticated users to chat bindings", async () => {
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
		assert.equal(session.binding.sessionKey, "chat-web:user-1");
		assert.equal(session.binding.originalProfile, "pibo-minimal");

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
		assert.equal(emitted[0].sessionKey, "chat-web:user-1");
		assert.equal(emitted[0].text, "hello");
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
		assert.match(payload.sessionKey, /^chat-web:user-1:session:/);
		assert.equal(payload.binding.parentSessionKey, undefined);
		assert.equal(payload.binding.parentSessionId, undefined);

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap?sessionKey=${encodeURIComponent(payload.sessionKey)}`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		assert.equal(data.selectedSessionKey, payload.sessionKey);
		const createdNode = data.sessions.find((session) => session.sessionKey === payload.sessionKey);
		assert.ok(createdNode);
		assert.equal(createdNode.parentSessionKey, undefined);

		const message = await fetch(`${baseURL}/api/chat/message`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: baseURL,
				"x-test-user": "user-1",
			},
			body: JSON.stringify({ sessionKey: payload.sessionKey, text: "hello new session" }),
		});
		assert.equal(message.status, 200);
		assert.equal(emitted.length, 1);
		assert.equal(emitted[0].sessionKey, payload.sessionKey);
		assert.equal(emitted[0].text, "hello new session");
	} finally {
		await channel.stop?.();
	}
});

test("chat web app renders legacy user sessions as top-level sessions", async () => {
	const { channel, baseURL, bindings } = await startWebHostChannel({
		auth: createFakeAuthService(),
	});

	try {
		const root = await fetch(`${baseURL}/api/chat/session`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(root.status, 200);

		const legacy = bindings.resolve({
			channel: "chat-web",
			externalId: "user-1:session:legacy",
			sessionKey: "chat-web:user-1:session:legacy",
			parentSessionKey: "chat-web:user-1",
			defaultProfile: "pibo-minimal",
		});

		const bootstrap = await fetch(`${baseURL}/api/chat/bootstrap`, {
			headers: { "x-test-user": "user-1" },
		});
		assert.equal(bootstrap.status, 200);
		const data = await bootstrap.json();
		const legacyNode = data.sessions.find((session) => session.sessionKey === legacy.sessionKey);
		const rootNode = data.sessions.find((session) => session.sessionKey === "chat-web:user-1");
		assert.ok(legacyNode);
		assert.ok(rootNode);
		assert.equal(legacyNode.parentSessionKey, undefined);
		assert.equal(rootNode.children.some((session) => session.sessionKey === legacy.sessionKey), false);
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
