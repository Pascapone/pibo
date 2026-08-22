import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assertPrivateWindowsAcl } from "./fixtures/windows-acl.mjs";

const piboBin = resolve("dist/bin/pibo.js");

function runPibo(home, args, input) {
	return spawnSync(process.execPath, [piboBin, ...args], {
		cwd: process.cwd(),
		env: { ...process.env, PIBO_HOME: home },
		encoding: "utf8",
		input,
	});
}

function createFixture(t) {
	const home = mkdtempSync(join(tmpdir(), "pibo-machine-key-cli-test-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	writeFileSync(
		join(home, "config.json"),
		`${JSON.stringify({ auth: { allowedEmails: ["machine@gmail.com", "machine@googlemail.com"] } }, null, 2)}\n`,
	);
	const database = new DatabaseSync(join(home, "auth.sqlite"));
	database.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, image TEXT)');
	database.prepare('INSERT INTO "user" (id, email, name, image) VALUES (?, ?, ?, ?)').run(
		"user-123",
		"machine@googlemail.com",
		"Machine Operator",
		null,
	);
	database.close();
	return home;
}

test("machine-key CLI resolves, generates, imports, lists, and revokes without leaking the token", (t) => {
	const home = createFixture(t);
	const identityPath = join(home, "identity.json");
	const secretPath = join(home, "credentials", "pibo2-machine-key");
	const recordPath = join(home, "out", "machine-key-record.json");

	const identity = runPibo(home, ["auth", "machine-key", "identity", "--json"]);
	assert.equal(identity.status, 0, identity.stderr);
	const identityJson = JSON.parse(identity.stdout);
	assert.equal(identityJson.userId, "user-123");
	writeFileSync(identityPath, identity.stdout, { mode: 0o600 });

	const generated = runPibo(home, [
		"auth",
		"machine-key",
		"generate",
		"--identity-file",
		identityPath,
		"--label",
		"headful-cdp",
		"--secret-output",
		secretPath,
		"--record-output",
		recordPath,
		"--expires-at",
		"2027-08-07T00:00:00.000Z",
	]);
	assert.equal(generated.status, 0, generated.stderr);
	const token = readFileSync(secretPath, "utf8").trim();
	const record = JSON.parse(readFileSync(recordPath, "utf8"));
	assert.match(token, /^pibo_mk_/);
	if (process.platform === "win32") {
		assertPrivateWindowsAcl(secretPath, "file");
		assertPrivateWindowsAcl(recordPath, "file");
	} else {
		assert.equal(statSync(secretPath).mode & 0o777, 0o600);
		assert.equal(statSync(recordPath).mode & 0o777, 0o600);
	}
	assert.equal(generated.stdout.includes(token), false);
	assert.equal(generated.stderr.includes(token), false);
	assert.equal(JSON.stringify(record).includes(token), false);

	const imported = runPibo(home, ["auth", "machine-key", "import", "--file", recordPath]);
	assert.equal(imported.status, 0, imported.stderr);
	assert.equal(imported.stdout.includes(token), false);
	assert.equal(imported.stdout.includes(record.hash), false);

	const listed = runPibo(home, ["auth", "machine-key", "list", "--json"]);
	assert.equal(listed.status, 0, listed.stderr);
	assert.equal(listed.stdout.includes(token), false);
	assert.equal(listed.stdout.includes(record.hash), false);
	assert.equal(JSON.parse(listed.stdout)[0].status, "active");

	const revoked = runPibo(home, ["auth", "machine-key", "revoke", record.id]);
	assert.equal(revoked.status, 0, revoked.stderr);
	assert.equal(revoked.stdout.includes(token), false);
	const after = JSON.parse(runPibo(home, ["auth", "machine-key", "list", "--json"]).stdout);
	assert.equal(after[0].status, "revoked");
});

test("machine-key CLI rejects a record whose user id does not match Better Auth", (t) => {
	const home = createFixture(t);
	const recordPath = join(home, "bad-record.json");
	writeFileSync(
		recordPath,
		JSON.stringify({
			id: "0123456789abcdef",
			label: "bad",
			hash: "a".repeat(64),
			identity: { userId: "wrong-user", email: "machine@googlemail.com", provider: "machine-key" },
			createdAt: "2026-08-07T00:00:00.000Z",
		}),
	);
	const imported = runPibo(home, ["auth", "machine-key", "import", "--file", recordPath]);
	assert.notEqual(imported.status, 0);
	assert.match(imported.stderr, /does not match the Better Auth user/);
});
