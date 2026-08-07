import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBetterAuthService } from "../dist/auth/better-auth.js";
import {
	PIBO_MACHINE_KEY_HEADER,
	createMachineKeyAuthenticator,
	generateMachineKey,
	importMachineKeyRecord,
	revokeMachineKey,
} from "../dist/auth/machine-keys.js";
import {
	PIBO_MACHINE_SESSION_COOKIE,
	createMachineSessionManager,
} from "../dist/auth/machine-session.js";

function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "pibo-machine-session-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const storePath = join(directory, "machine-keys.json");
	const generated = generateMachineKey({
		label: "browser",
		identity: { userId: "user-123", email: "machine@example.com", name: "Machine" },
		expiresAt: "2026-11-05T00:00:00.000Z",
		now: new Date("2026-08-07T00:00:00.000Z"),
	});
	importMachineKeyRecord(generated.record, storePath);
	return { storePath, generated, authenticator: createMachineKeyAuthenticator(storePath) };
}

function cookieRequestHeader(setCookie) {
	return setCookie.split(";", 1)[0];
}

test("machine session cookie is signed, secure, short-lived, and contains no raw API key", (t) => {
	const { generated, authenticator } = fixture(t);
	let now = new Date("2026-08-07T01:00:00.000Z");
	const manager = createMachineSessionManager({
		secret: "s".repeat(32),
		machineKeys: authenticator,
		ttlSeconds: 60,
		now: () => now,
	});
	const authentication = authenticator.authenticate(new Headers({ [PIBO_MACHINE_KEY_HEADER]: generated.token }));
	assert.ok(authentication);
	const created = manager.create(authentication);
	assert.match(created.header, new RegExp(`^${PIBO_MACHINE_SESSION_COOKIE}=`));
	assert.match(created.header, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=60;/);
	assert.equal(created.header.includes(generated.token), false);
	assert.equal(created.expiresAt.toISOString(), "2026-08-07T01:01:00.000Z");

	const session = manager.getSession(new Headers({ cookie: cookieRequestHeader(created.header) }));
	assert.equal(session.identity.userId, "user-123");
	assert.equal(session.identity.provider, "machine-key");
	assert.equal(session.expiresAt.toISOString(), "2026-08-07T01:01:00.000Z");

	now = new Date("2026-08-07T01:01:00.000Z");
	assert.equal(manager.getSession(new Headers({ cookie: cookieRequestHeader(created.header) })), undefined);
});

test("machine session cookie rejects tampering and becomes invalid when its key is revoked", (t) => {
	const { storePath, generated, authenticator } = fixture(t);
	const manager = createMachineSessionManager({
		secret: "s".repeat(32),
		machineKeys: authenticator,
		now: () => new Date("2026-08-07T01:00:00.000Z"),
	});
	const authentication = authenticator.authenticate(new Headers({ [PIBO_MACHINE_KEY_HEADER]: generated.token }));
	const created = manager.create(authentication);
	const cookie = cookieRequestHeader(created.header);
	assert.ok(manager.getSession(new Headers({ cookie })));
	assert.equal(manager.getSession(new Headers({ cookie: `${cookie}x` })), undefined);

	revokeMachineKey(generated.record.id, storePath, new Date("2026-08-07T01:00:30.000Z"));
	assert.equal(manager.getSession(new Headers({ cookie })), undefined);
});

test("Better Auth exchanges a machine key for an HttpOnly cookie and accepts that cookie", async (t) => {
	const { storePath, generated } = fixture(t);
	const service = createBetterAuthService({
		baseURL: "https://pibo2.example.test",
		secret: "z".repeat(32),
		googleClientId: "google-client-id",
		googleClientSecret: "google-client-secret",
		allowedEmails: ["machine@example.com"],
		databasePath: ":memory:",
		machineKeyStorePath: storePath,
	});
	t.after(() => service.stop());
	const response = await service.handleRequest(
		new Request("https://pibo2.example.test/api/auth/machine-session", {
			method: "POST",
			headers: { [PIBO_MACHINE_KEY_HEADER]: generated.token },
		}),
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	const setCookie = response.headers.get("set-cookie");
	assert.ok(setCookie);
	assert.equal(setCookie.includes(generated.token), false);
	assert.equal((await response.json()).identity.provider, "machine-key");

	const session = await service.getSession(new Headers({ cookie: cookieRequestHeader(setCookie) }));
	assert.equal(session.identity.userId, "user-123");
	assert.equal(session.identity.provider, "machine-key");

	const cleared = await service.handleRequest(
		new Request("https://pibo2.example.test/api/auth/machine-session", { method: "DELETE" }),
	);
	assert.equal(cleared.status, 204);
	assert.match(cleared.headers.get("set-cookie"), /Max-Age=0/);
});

test("machine session exchange rejects invalid keys and public plain HTTP", async (t) => {
	const { storePath } = fixture(t);
	const service = createBetterAuthService({
		baseURL: "https://pibo2.example.test",
		secret: "z".repeat(32),
		googleClientId: "google-client-id",
		googleClientSecret: "google-client-secret",
		allowedEmails: ["machine@example.com"],
		databasePath: ":memory:",
		machineKeyStorePath: storePath,
	});
	t.after(() => service.stop());
	await assert.rejects(
		() =>
			service.handleRequest(
				new Request("https://pibo2.example.test/api/auth/machine-session", {
					method: "POST",
					headers: { [PIBO_MACHINE_KEY_HEADER]: "invalid" },
				}),
			),
		/Unauthenticated/,
	);
	const insecure = await service.handleRequest(
		new Request("http://pibo2.example.test/api/auth/machine-session", {
			method: "POST",
			headers: { [PIBO_MACHINE_KEY_HEADER]: "invalid" },
		}),
	);
	assert.equal(insecure.status, 400);
});
