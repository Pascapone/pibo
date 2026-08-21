import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBetterAuthService } from "../dist/auth/better-auth.js";
import {
	PIBO_MACHINE_KEY_HEADER,
	createMachineKeyAuthenticator,
	generateMachineKey,
	importMachineKeyRecord,
	listMachineKeys,
	readMachineKeyStore,
	revokeMachineKey,
} from "../dist/auth/machine-keys.js";
import { assertPrivateWindowsAcl, grantBuiltinUsersModify } from "./fixtures/windows-acl.mjs";

function temporaryStore(t) {
	const directory = mkdtempSync(join(tmpdir(), "pibo-machine-key-test-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return join(directory, "machine-keys.json");
}

function testIdentity(email = "machine@example.com") {
	return { userId: "better-auth-user-1", email, name: "Machine Operator" };
}

function headersFor(token) {
	return new Headers({ [PIBO_MACHINE_KEY_HEADER]: token });
}

test("machine-key generation keeps the raw secret out of the record", () => {
	const generated = generateMachineKey({ label: "cdp controller", identity: testIdentity() });
	assert.match(generated.token, /^pibo_mk_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
	assert.match(generated.record.hash, /^[a-f0-9]{64}$/);
	assert.equal(JSON.stringify(generated.record).includes(generated.token), false);
	assert.equal(generated.record.identity.provider, "machine-key");
});

test("machine-key store imports private records and lists only redacted metadata", (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);

	if (process.platform === "win32") assertPrivateWindowsAcl(storePath, "file");
	else assert.equal(statSync(storePath).mode & 0o777, 0o600);
	assert.equal(readMachineKeyStore(storePath).keys[0].hash, generated.record.hash);
	const listed = listMachineKeys(storePath);
	assert.equal(listed.length, 1);
	assert.equal(listed[0].status, "active");
	assert.equal(Object.hasOwn(listed[0], "hash"), false);
	assert.equal(JSON.stringify(listed).includes(generated.token), false);
});

test("machine-key store rejects or repairs broad record-file access", (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);
	if (process.platform === "win32") {
		grantBuiltinUsersModify(storePath);
		assert.equal(readMachineKeyStore(storePath).keys.length, 1);
		assertPrivateWindowsAcl(storePath, "file");
	} else {
		chmodSync(storePath, 0o644);
		assert.throws(() => readMachineKeyStore(storePath), /must not be accessible by group or other users/);
	}
});

test("machine-key authenticator accepts valid keys and rejects malformed or altered keys", (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);
	const auth = createMachineKeyAuthenticator(storePath);

	const session = auth.getSession(headersFor(generated.token));
	assert.equal(session.identity.userId, "better-auth-user-1");
	assert.equal(session.identity.email, "machine@example.com");
	assert.equal(session.identity.provider, "machine-key");
	assert.equal(session.sessionId, `machine-key:${generated.record.id}`);
	assert.equal(auth.getSession(headersFor(`${generated.token.slice(0, -1)}x`)), undefined);
	assert.equal(auth.getSession(headersFor("not-a-machine-key")), undefined);
	assert.equal(auth.getSession(new Headers()), undefined);
});

test("machine-key authenticator hot-reloads expiration and revocation", (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);
	const auth = createMachineKeyAuthenticator(storePath);
	assert.ok(auth.getSession(headersFor(generated.token)));

	revokeMachineKey(generated.record.id, storePath, new Date("2026-08-07T00:00:00.000Z"));
	assert.equal(auth.getSession(headersFor(generated.token)), undefined);

	const expired = generateMachineKey({
		label: "expired",
		identity: testIdentity(),
		expiresAt: "2020-01-01T00:00:00.000Z",
	});
	const serialized = JSON.parse(readFileSync(storePath, "utf8"));
	serialized.keys.push(expired.record);
	writeFileSync(storePath, `${JSON.stringify(serialized)}\n`, { mode: 0o600 });
	assert.equal(auth.getSession(headersFor(expired.token)), undefined);
});

test("machine-key import rejects duplicate ids and raw-secret fields", (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);
	assert.throws(() => importMachineKeyRecord(generated.record, storePath), /already exists/);
	assert.throws(
		() => importMachineKeyRecord({ ...generated.record, token: generated.token }, temporaryStore(t)),
		/unsupported field "token"/,
	);
});

test("Better Auth service composes allowed machine identity before Google sessions", async (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity() });
	importMachineKeyRecord(generated.record, storePath);
	const service = createBetterAuthService({
		baseURL: "http://localhost:4788",
		secret: "x".repeat(32),
		googleClientId: "google-client-id",
		googleClientSecret: "google-client-secret",
		allowedEmails: ["machine@example.com"],
		databasePath: ":memory:",
		machineKeyStorePath: storePath,
	});
	t.after(() => service.stop());

	const session = await service.getSession(headersFor(generated.token));
	assert.equal(session.identity.userId, "better-auth-user-1");
	assert.equal(session.identity.provider, "machine-key");
});

test("Better Auth service rejects a valid machine key linked to a disallowed email", async (t) => {
	const storePath = temporaryStore(t);
	const generated = generateMachineKey({ label: "browser", identity: testIdentity("other@example.com") });
	importMachineKeyRecord(generated.record, storePath);
	const service = createBetterAuthService({
		baseURL: "http://localhost:4788",
		secret: "x".repeat(32),
		googleClientId: "google-client-id",
		googleClientSecret: "google-client-secret",
		allowedEmails: ["machine@example.com"],
		databasePath: ":memory:",
		machineKeyStorePath: storePath,
	});
	t.after(() => service.stop());

	await assert.rejects(() => service.getSession(headersFor(generated.token)), /Forbidden/);
});
