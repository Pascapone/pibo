import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { bearer } from "better-auth/plugins";
import { loadPiboConfig } from "../config/config.js";
import { ensurePrivatePiboHomeForPath, piboHomePath } from "../core/pibo-home.js";
import { protectPrivateFileSync } from "../core/private-path.js";
import { createMachineKeyAuthenticator } from "./machine-keys.js";
import { createMachineSessionManager } from "./machine-session.js";
import type { PiboAuthService, PiboAuthSession } from "./types.js";
import { createForbiddenAuthError, createUnauthenticatedError } from "./types.js";

export type BetterAuthServiceOptions = {
	baseURL?: string;
	databasePath?: string;
	secret?: string;
	googleClientId?: string;
	googleClientSecret?: string;
	trustedOrigins?: string[];
	allowedEmails?: string[];
	machineKeyStorePath?: string;
};

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 90;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

export function createTrustedOrigins(baseURL: string, configuredOrigins?: string[]): string[] {
	const origins = new Set<string>(configuredOrigins ?? []);
	const parsed = new URL(baseURL);
	origins.add(parsed.origin);

	const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
	if (!loopbackHosts.has(parsed.hostname)) return [...origins];

	for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
		const url = new URL(parsed.origin);
		url.hostname = host;
		origins.add(url.origin);
	}
	return [...origins];
}

function requiredOption(value: string | undefined, key: string): string {
	if (!value) throw new Error(`${key} is required in pibo config for Better Auth`);
	return value;
}

function requiredSecret(value: string | undefined): string {
	const secret = requiredOption(value, "auth.secret");
	if (secret.length < 32) {
		throw new Error("auth.secret must be at least 32 characters for pibo Better Auth");
	}
	return secret;
}

function createAllowedEmailSet(emails: string[]): Set<string> {
	return new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function createDatabase(path: string): DatabaseSync {
	const resolvedPath = path === ":memory:" ? path : resolve(path);
	if (resolvedPath === ":memory:") return new DatabaseSync(resolvedPath);
	ensurePrivatePiboHomeForPath(resolvedPath);
	mkdirSync(dirname(resolvedPath), { recursive: true });
	const database = new DatabaseSync(resolvedPath);
	protectPrivateFileSync(resolvedPath);
	return database;
}

type BetterAuthMigrationField = {
	type: string | readonly string[];
	required?: boolean;
	defaultValue?: unknown;
	index?: boolean;
	unique?: boolean;
	references?: unknown;
};

type BetterAuthPendingAddition = {
	table: string;
	fields: Record<string, BetterAuthMigrationField>;
};

type BetterAuthRuntime = {
	database: DatabaseSync;
	authOptions: BetterAuthOptions;
	auth: ReturnType<typeof betterAuth>;
};

function quoteSqlIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function sqliteColumnType(field: BetterAuthMigrationField): string | undefined {
	if (Array.isArray(field.type)) return "text";
	switch (field.type) {
		case "string":
		case "json":
		case "string[]":
		case "number[]":
			return "text";
		case "number":
		case "boolean":
			return "integer";
		case "date":
			return "date";
		default:
			return undefined;
	}
}

function sqliteDefaultLiteral(value: string | number | boolean): string {
	if (typeof value === "boolean") return value ? "1" : "0";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Better Auth migration default must be finite");
		return String(value);
	}
	return `'${value.replaceAll("'", "''")}'`;
}

function safeRequiredColumnDefault(
	fieldName: string,
	field: BetterAuthMigrationField,
	migrationTimestamp: string,
): string | number | boolean | undefined {
	if (field.required === false || field.references || field.unique) return undefined;
	const declaredDefault = field.defaultValue;
	if (typeof declaredDefault === "string" || typeof declaredDefault === "boolean") return declaredDefault;
	if (typeof declaredDefault === "number" && Number.isFinite(declaredDefault)) return declaredDefault;
	if (declaredDefault instanceof Date && Number.isFinite(declaredDefault.getTime())) return declaredDefault.toISOString();
	if ((fieldName === "createdAt" || fieldName === "updatedAt") && field.type === "date") {
		return migrationTimestamp;
	}
	return undefined;
}

function tableRowCount(database: DatabaseSync, table: string): number {
	const row = database.prepare(`SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(table)}`).get() as { count: number | bigint };
	return Number(row.count);
}

function repairSafeRequiredColumns(
	database: DatabaseSync,
	pendingAdditions: readonly BetterAuthPendingAddition[],
): string[] {
	const migrationTimestamp = new Date().toISOString();
	const statements: string[] = [];
	const unsafeColumns: string[] = [];

	for (const addition of pendingAdditions) {
		if (tableRowCount(database, addition.table) === 0) continue;
		for (const [fieldName, field] of Object.entries(addition.fields)) {
			if (field.required === false) continue;
			const columnType = sqliteColumnType(field);
			const defaultValue = safeRequiredColumnDefault(fieldName, field, migrationTimestamp);
			if (!columnType || defaultValue === undefined) {
				unsafeColumns.push(`${addition.table}.${fieldName}`);
				continue;
			}
			statements.push(
				`ALTER TABLE ${quoteSqlIdentifier(addition.table)} ADD COLUMN ${quoteSqlIdentifier(fieldName)} ${columnType} NOT NULL DEFAULT ${sqliteDefaultLiteral(defaultValue)}`,
			);
			if (field.index) {
				const indexName = `${addition.table}_${fieldName}_idx`;
				statements.push(
					`CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier(indexName)} ON ${quoteSqlIdentifier(addition.table)} (${quoteSqlIdentifier(fieldName)})`,
				);
			}
		}
	}

	if (unsafeColumns.length > 0 || statements.length === 0) return unsafeColumns;
	database.exec("BEGIN IMMEDIATE");
	try {
		for (const statement of statements) database.exec(statement);
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
	return [];
}

function isSqliteRequiredColumnMigrationError(error: unknown): boolean {
	return error instanceof Error && error.message.includes("Cannot add a NOT NULL column with default value NULL");
}

function nextRecoveryBackupPath(databasePath: string): string {
	const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	const base = `${databasePath}.pibo-auth-recovery-${timestamp}`;
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
		const candidate = `${base}${suffix}.sqlite`;
		if (!existsSync(candidate)) return candidate;
	}
	throw new Error(`Could not allocate a unique Better Auth recovery backup beside ${databasePath}`);
}

function removeSqliteDatabaseFiles(databasePath: string): void {
	for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]) {
		rmSync(path, { force: true });
	}
}

function makePrivateFile(path: string): void {
	protectPrivateFileSync(path, { force: true });
}

/** @internal Exported for deterministic recovery failure injection. */
export async function recoverBetterAuthSqliteDatabase<T extends { database: DatabaseSync }>(input: {
	databasePath: string;
	failedRuntime: T;
	createRuntime: () => T;
	migrateRuntime: (runtime: T) => Promise<void>;
}): Promise<{ runtime: T; backupPath: string }> {
	if (input.databasePath === ":memory:") {
		throw new Error("Better Auth SQLite schema requires recovery, but an in-memory database cannot be preserved");
	}
	const backupPath = nextRecoveryBackupPath(input.databasePath);
	await backup(input.failedRuntime.database, backupPath);
	makePrivateFile(backupPath);
	input.failedRuntime.database.close();
	removeSqliteDatabaseFiles(input.databasePath);

	let replacement: T | undefined;
	try {
		replacement = input.createRuntime();
		await input.migrateRuntime(replacement);
		makePrivateFile(input.databasePath);
		return { runtime: replacement, backupPath };
	} catch (recoveryError) {
		try {
			replacement?.database.close();
		} catch {}
		removeSqliteDatabaseFiles(input.databasePath);
		try {
			copyFileSync(backupPath, input.databasePath);
			makePrivateFile(input.databasePath);
		} catch (restoreError) {
			throw new AggregateError(
				[recoveryError, restoreError],
				`Pibo could not create a fresh Better Auth database or restore the original. The protected recovery backup remains at "${backupPath}".`,
			);
		}
		throw new Error(
			`Pibo could not create a fresh Better Auth database. The original was restored and the protected recovery backup remains at "${backupPath}".`,
			{ cause: recoveryError },
		);
	}
}

function requiredAllowedEmails(options: BetterAuthServiceOptions, configAllowedEmails: string[] | undefined): Set<string> {
	const allowedEmails =
		options.allowedEmails !== undefined
			? createAllowedEmailSet(options.allowedEmails)
			: configAllowedEmails !== undefined
				? createAllowedEmailSet(configAllowedEmails)
				: undefined;
	if (!allowedEmails || allowedEmails.size === 0) {
		throw new Error("auth.allowedEmails must contain at least one email in pibo config for Better Auth");
	}
	return allowedEmails;
}

export function createBetterAuthService(options: BetterAuthServiceOptions = {}): PiboAuthService {
	const config = loadPiboConfig();
	const authConfig = config.auth;
	const baseURL = requiredOption(options.baseURL ?? authConfig?.baseURL, "auth.baseURL");
	const googleClientId = requiredOption(
		options.googleClientId ?? authConfig?.googleClientId,
		"auth.googleClientId",
	);
	const googleClientSecret = requiredOption(
		options.googleClientSecret ?? authConfig?.googleClientSecret,
		"auth.googleClientSecret",
	);
	const secret = requiredSecret(options.secret ?? authConfig?.secret);
	const allowedEmails = requiredAllowedEmails(options, authConfig?.allowedEmails);
	const machineKeys = createMachineKeyAuthenticator(options.machineKeyStorePath ?? authConfig?.machineKeyStorePath);
	const machineSessions = createMachineSessionManager({ secret, machineKeys });
	const configuredDatabasePath = options.databasePath ?? authConfig?.databasePath ?? piboHomePath("auth.sqlite");
	const databasePath = configuredDatabasePath === ":memory:" ? configuredDatabasePath : resolve(configuredDatabasePath);
	const trustedOrigins = options.trustedOrigins ?? authConfig?.trustedOrigins;
	const createRuntime = (): BetterAuthRuntime => {
		const database = createDatabase(databasePath);
		if (databasePath !== ":memory:") makePrivateFile(databasePath);
		const authOptions: BetterAuthOptions = {
			appName: "Pibo",
			baseURL,
			secret,
			database,
			trustedOrigins: createTrustedOrigins(baseURL, trustedOrigins),
			session: {
				expiresIn: SESSION_EXPIRES_IN_SECONDS,
				updateAge: SESSION_UPDATE_AGE_SECONDS,
			},
			socialProviders: {
				google: {
					clientId: googleClientId,
					clientSecret: googleClientSecret,
					prompt: "select_account",
				},
			},
			plugins: [bearer()],
		};
		return { database, authOptions, auth: betterAuth(authOptions) };
	};
	let runtime = createRuntime();
	const recoverAuthDatabase = async (failedRuntime: BetterAuthRuntime): Promise<BetterAuthRuntime> => {
		const recovered = await recoverBetterAuthSqliteDatabase({
			databasePath,
			failedRuntime,
			createRuntime,
			migrateRuntime: async (replacement) => {
				const migrations = await getMigrations(replacement.authOptions);
				await migrations.runMigrations();
			},
		});
		console.warn(
			`[pibo] Better Auth SQLite schema was incompatible with a safe in-place migration. `
			+ `Pibo preserved a protected backup at "${recovered.backupPath}", created a fresh authentication database, `
			+ "and reset existing browser sessions. Sign in again.",
		);
		return recovered.runtime;
	};
	const requireAllowedMachineSession = (session: PiboAuthSession): PiboAuthSession => {
		const email = session.identity.email?.toLowerCase();
		if (!email || !allowedEmails.has(email)) throw createForbiddenAuthError();
		return session;
	};

	return {
		name: "better-auth",
		async start() {
			let migrations = await getMigrations(runtime.authOptions);
			const unsafeColumns = repairSafeRequiredColumns(runtime.database, migrations.toBeAdded);
			if (unsafeColumns.length > 0) {
				runtime = await recoverAuthDatabase(runtime);
				return;
			}
			migrations = await getMigrations(runtime.authOptions);
			try {
				await migrations.runMigrations();
			} catch (error) {
				if (!isSqliteRequiredColumnMigrationError(error)) throw error;
				runtime = await recoverAuthDatabase(runtime);
			}
		},
		stop() {
			runtime.database.close();
		},
		async getSession(headers) {
			const machineSession = machineKeys.getSession(headers) ?? machineSessions.getSession(headers);
			if (machineSession) return requireAllowedMachineSession(machineSession);

			const session = await runtime.auth.api.getSession({ headers });
			if (!session) return undefined;

			const user = session.user;
			if (!allowedEmails.has(user.email.toLowerCase())) {
				throw createForbiddenAuthError();
			}

			const authSession = session.session;
			const mapped: PiboAuthSession = {
				identity: {
					userId: user.id,
					email: user.email,
					name: user.name,
					image: user.image ?? undefined,
					provider: "google",
				},
				sessionId: authSession.id,
				expiresAt: authSession.expiresAt,
			};
			return mapped;
		},
		async requireSession(headers) {
			const session = await this.getSession(headers);
			if (!session) throw createUnauthenticatedError();
			return session;
		},
		async handleRequest(request) {
			const url = new URL(request.url);
			if (url.pathname === "/api/auth/machine-session") {
				if (request.method === "DELETE") {
					return new Response(null, {
						status: 204,
						headers: { "set-cookie": machineSessions.clearHeader(), "cache-control": "no-store" },
					});
				}
				if (request.method !== "POST") {
					return new Response(JSON.stringify({ error: "Method not allowed" }), {
						status: 405,
						headers: { "content-type": "application/json", allow: "POST, DELETE", "cache-control": "no-store" },
					});
				}
				const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
				if (url.protocol !== "https:" && !loopbackHosts.has(url.hostname)) {
					return new Response(JSON.stringify({ error: "Machine session exchange requires HTTPS outside loopback" }), {
						status: 400,
						headers: { "content-type": "application/json", "cache-control": "no-store" },
					});
				}
				const authentication = machineKeys.authenticate(request.headers);
				if (!authentication) throw createUnauthenticatedError();
				const session = requireAllowedMachineSession(authentication.session);
				const created = machineSessions.create({ ...authentication, session });
				return new Response(
					JSON.stringify({ identity: created.session.identity, expiresAt: created.expiresAt.toISOString() }),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
							"cache-control": "no-store",
							"set-cookie": created.header,
						},
					},
				);
			}
			return runtime.auth.handler(request);
		},
	};
}
