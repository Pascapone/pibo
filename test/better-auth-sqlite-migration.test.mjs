import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { getMigrations } from "better-auth/db/migration";
import { createBetterAuthService, recoverBetterAuthSqliteDatabase } from "../dist/auth/better-auth.js";

function testRoot(name) {
	return mkdtempSync(join(tmpdir(), `pibo-${name}-`));
}

function options(root, databasePath) {
	return {
		baseURL: "http://localhost:3700",
		databasePath,
		secret: "x".repeat(32),
		googleClientId: "google-client-id",
		googleClientSecret: "google-client-secret",
		allowedEmails: ["user@example.test"],
		machineKeyStorePath: join(root, "machine-keys.json"),
	};
}

function rawAuthOptions(database) {
	return {
		appName: "Pibo",
		baseURL: "http://localhost:3700",
		secret: "x".repeat(32),
		database,
		socialProviders: {
			google: {
				clientId: "google-client-id",
				clientSecret: "google-client-secret",
			},
		},
	};
}

function createUserTableMissingUpdatedAt(path) {
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE "user" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"name" TEXT NOT NULL,
			"email" TEXT NOT NULL UNIQUE,
			"emailVerified" INTEGER NOT NULL,
			"image" TEXT,
			"createdAt" DATE NOT NULL
		)
	`);
	db.prepare('INSERT INTO "user" (id, name, email, emailVerified, image, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
		.run("user-1", "User", "user@example.test", 1, null, "2026-08-01T00:00:00.000Z");
	db.close();
}

function createUserTableMissingEmail(path) {
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE "user" (
			"id" TEXT NOT NULL PRIMARY KEY,
			"name" TEXT NOT NULL,
			"emailVerified" INTEGER NOT NULL,
			"image" TEXT,
			"createdAt" DATE NOT NULL,
			"updatedAt" DATE NOT NULL
		)
	`);
	db.prepare('INSERT INTO "user" (id, name, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
		.run("user-1", "User", 1, null, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
	db.close();
}

function recoveryBackups(root, databasePath) {
	const prefix = `${basename(databasePath)}.pibo-auth-recovery-`;
	return readdirSync(root).filter((entry) => entry.startsWith(prefix) && entry.endsWith(".sqlite"));
}

test("raw Better Auth migrations reproduce SQLite's required-column failure", async () => {
	const root = testRoot("better-auth-raw-migration");
	const databasePath = join(root, "auth.sqlite");
	createUserTableMissingUpdatedAt(databasePath);
	const database = new DatabaseSync(databasePath);
	try {
		const migrations = await getMigrations(rawAuthOptions(database));
		await assert.rejects(
			migrations.runMigrations(),
			/Cannot add a NOT NULL column with default value NULL/,
		);
	} finally {
		database.close();
	}
});

test("Pibo repairs deterministic required Better Auth columns without losing rows", async () => {
	const root = testRoot("better-auth-safe-repair");
	const databasePath = join(root, "auth.sqlite");
	createUserTableMissingUpdatedAt(databasePath);

	const service = createBetterAuthService(options(root, databasePath));
	await service.start();
	service.stop();

	const database = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const columns = new Map(database.prepare('PRAGMA table_info("user")').all().map((column) => [column.name, column]));
		assert.equal(columns.get("updatedAt")?.notnull, 1);
		const row = database.prepare('SELECT id, email, createdAt, updatedAt FROM "user" WHERE id = ?').get("user-1");
		assert.equal(row.email, "user@example.test");
		assert.equal(row.createdAt, "2026-08-01T00:00:00.000Z");
		assert.equal(typeof row.updatedAt, "string");
		assert.ok(row.updatedAt.length > 0);
	} finally {
		database.close();
	}
	assert.deepEqual(recoveryBackups(root, databasePath), []);
	if (process.platform !== "win32") assert.equal(statSync(databasePath).mode & 0o777, 0o600);

	const restarted = createBetterAuthService(options(root, databasePath));
	await restarted.start();
	restarted.stop();
	assert.deepEqual(recoveryBackups(root, databasePath), []);
});

test("Pibo backs up and replaces an auth schema that cannot be repaired safely", async () => {
	const root = testRoot("better-auth-recovery");
	const databasePath = join(root, "auth.sqlite");
	const productDatabasePath = join(root, "pibo.sqlite");
	writeFileSync(productDatabasePath, "product-data-sentinel", { mode: 0o600 });
	createUserTableMissingEmail(databasePath);
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args.map(String).join(" "));
	try {
		const service = createBetterAuthService(options(root, databasePath));
		await service.start();
		service.stop();
	} finally {
		console.warn = originalWarn;
	}

	const backups = recoveryBackups(root, databasePath);
	assert.equal(backups.length, 1);
	assert.doesNotMatch(backups[0], /:/);
	assert.equal(readFileSync(productDatabasePath, "utf8"), "product-data-sentinel");
	const recoveryWarnings = warnings.filter((warning) => warning.startsWith("[pibo] Better Auth SQLite schema"));
	assert.equal(recoveryWarnings.length, 1);
	assert.match(recoveryWarnings[0], /created a fresh authentication database/i);
	assert.match(recoveryWarnings[0], /sign in again/i);
	assert.match(recoveryWarnings[0], new RegExp(backups[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.doesNotMatch(recoveryWarnings[0], /google-client-secret|user@example\.test|x{32}/);

	if (process.platform !== "win32") {
		assert.equal(statSync(join(root, backups[0])).mode & 0o777, 0o600);
	}

	const active = new DatabaseSync(databasePath, { readOnly: true });
	try {
		assert.equal(active.prepare('SELECT COUNT(*) AS count FROM "user"').get().count, 0);
		const columns = new Set(active.prepare('PRAGMA table_info("user")').all().map((column) => column.name));
		assert.equal(columns.has("email"), true);
	} finally {
		active.close();
	}

	const backup = new DatabaseSync(join(root, backups[0]), { readOnly: true });
	try {
		assert.equal(backup.prepare('SELECT COUNT(*) AS count FROM "user"').get().count, 1);
		const columns = new Set(backup.prepare('PRAGMA table_info("user")').all().map((column) => column.name));
		assert.equal(columns.has("email"), false);
	} finally {
		backup.close();
	}

	const restarted = createBetterAuthService(options(root, databasePath));
	await restarted.start();
	restarted.stop();
	assert.deepEqual(recoveryBackups(root, databasePath), backups);
});

test("Pibo restores the original auth database when fresh-schema recovery fails", async () => {
	const root = testRoot("better-auth-recovery-rollback");
	const databasePath = join(root, "auth.sqlite");
	createUserTableMissingEmail(databasePath);
	const failedRuntime = { database: new DatabaseSync(databasePath) };

	await assert.rejects(
		recoverBetterAuthSqliteDatabase({
			databasePath,
			failedRuntime,
			createRuntime: () => ({ database: new DatabaseSync(databasePath) }),
			migrateRuntime: async (replacement) => {
				replacement.database.exec('CREATE TABLE "replacement" ("id" TEXT NOT NULL)');
				throw new Error("injected fresh-schema failure");
			},
		}),
		/original was restored/,
	);

	const backups = recoveryBackups(root, databasePath);
	assert.equal(backups.length, 1);
	const restored = new DatabaseSync(databasePath, { readOnly: true });
	try {
		assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM "user"').get().count, 1);
		assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?').get("table", "replacement").count, 0);
		const columns = new Set(restored.prepare('PRAGMA table_info("user")').all().map((column) => column.name));
		assert.equal(columns.has("email"), false);
	} finally {
		restored.close();
	}
});

test("Pibo pins Better Auth exactly for packaged installations", async () => {
	const packageJson = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../package.json", import.meta.url), "utf8")));
	assert.match(packageJson.dependencies["better-auth"], /^\d+\.\d+\.\d+$/);
});
