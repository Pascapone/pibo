import { DatabaseSync } from "node:sqlite";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { loadPiboConfig } from "../config/config.js";
import { piboHomePath } from "../core/pibo-home.js";
import { protectPrivateFileSync } from "../core/private-path.js";
import type { PiboAuthIdentity } from "./types.js";
import {
	generateMachineKey,
	getDefaultMachineKeyStorePath,
	importMachineKeyRecord,
	listMachineKeys,
	parseMachineKeyRecord,
	revokeMachineKey,
} from "./machine-keys.js";

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

function printAuthDiscovery(): void {
	console.log(`pibo auth - manage Web authentication

Commands:
  machine-key  Manage revocable machine identities

Next:
  pibo auth machine-key
`);
}

function printMachineKeyDiscovery(): void {
	console.log(`pibo auth machine-key - manage machine identities

Commands:
  identity  Resolve one existing user from the allowed email set
  generate  Generate local secret and hash-only record files
  import    Import one hash-only record into the server store
  list      List keys without hashes or secrets
  revoke    Revoke one key by id

Next:
  pibo auth machine-key <command> --help
`);
}

function readJsonInput(path: string): unknown {
	const text = path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
	return JSON.parse(text) as unknown;
}

function parseIdentity(value: unknown): Omit<PiboAuthIdentity, "provider"> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Identity input must be a JSON object");
	}
	const input = value as Record<string, unknown>;
	if (typeof input.userId !== "string" || input.userId.length === 0) {
		throw new Error("Identity input requires userId");
	}
	if (typeof input.email !== "string" || input.email.length === 0) {
		throw new Error("Identity input requires email");
	}
	for (const field of ["name", "image"] as const) {
		if (input[field] !== undefined && input[field] !== null && typeof input[field] !== "string") {
			throw new Error(`Identity input ${field} must be a string when present`);
		}
	}
	return {
		userId: input.userId,
		email: input.email,
		...(typeof input.name === "string" && input.name.length > 0 ? { name: input.name } : {}),
		...(typeof input.image === "string" && input.image.length > 0 ? { image: input.image } : {}),
	};
}

function configuredAuthDatabasePath(): string {
	return resolve(loadPiboConfig().auth?.databasePath ?? piboHomePath("auth.sqlite"));
}

function resolveAllowedIdentity(email?: string): Omit<PiboAuthIdentity, "provider"> {
	const allowedEmails = new Set(
		(loadPiboConfig().auth?.allowedEmails ?? []).map((candidate) => candidate.trim().toLowerCase()).filter(Boolean),
	);
	const normalizedEmail = email?.trim().toLowerCase();
	if (normalizedEmail && !allowedEmails.has(normalizedEmail)) {
		throw new Error(`Email "${email}" is not present in auth.allowedEmails`);
	}
	const database = new DatabaseSync(configuredAuthDatabasePath(), { readOnly: true });
	try {
		const rows = database.prepare('SELECT id, email, name, image FROM "user"').all() as Array<{
			id?: unknown;
			email?: unknown;
			name?: unknown;
			image?: unknown;
		}>;
		const matches = rows.filter(
			(row) =>
				typeof row.id === "string" &&
				typeof row.email === "string" &&
				allowedEmails.has(row.email.toLowerCase()) &&
				(normalizedEmail === undefined || row.email.toLowerCase() === normalizedEmail),
		);
		if (matches.length === 0) {
			throw new Error(
				normalizedEmail
					? `No Better Auth user exists for allowed email "${email}"`
					: "No Better Auth user matches auth.allowedEmails",
			);
		}
		if (matches.length > 1) {
			throw new Error("Multiple Better Auth users match auth.allowedEmails; pass --email to select one");
		}
		const row = matches[0]!;
		return {
			userId: row.id as string,
			email: row.email as string,
			...(typeof row.name === "string" && row.name.length > 0 ? { name: row.name } : {}),
			...(typeof row.image === "string" && row.image.length > 0 ? { image: row.image } : {}),
		};
	} finally {
		database.close();
	}
}

function requireNewOutputPath(path: string, label: string): string {
	const resolvedPath = resolve(path);
	if (existsSync(resolvedPath)) throw new Error(`${label} already exists: ${resolvedPath}`);
	return resolvedPath;
}

function writePrivateNewFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	try {
		writeFileSync(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
		protectPrivateFileSync(path, { force: true });
	} catch (error) {
		if (existsSync(path)) unlinkSync(path);
		throw error;
	}
}

function parseExpiresAt(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) throw new Error("--expires-at must be an ISO timestamp");
	if (timestamp <= Date.now()) throw new Error("--expires-at must be in the future");
	return new Date(timestamp).toISOString();
}

export async function runAuthCli(argv = process.argv): Promise<void> {
	if (argv.length <= 2 || argv[2] === "--help" || argv[2] === "-h") {
		printAuthDiscovery();
		return;
	}
	if (argv[2] === "machine-key" && (argv.length <= 3 || argv[3] === "--help" || argv[3] === "-h")) {
		printMachineKeyDiscovery();
		return;
	}

	const program = new Command();
	program.name("pibo auth").description("Manage Pibo Web authentication");
	const machineKey = program.command("machine-key").description("Manage revocable machine identities");

	machineKey
		.command("identity")
		.description("Resolve an existing allowed Better Auth user")
		.option("--email <email>", "Select one allowed Google account email when multiple users match")
		.option("--json", "Print JSON")
		.action((options: { email?: string; json?: boolean }) => {
			const identity = resolveAllowedIdentity(options.email);
			if (options.json) printJson(identity);
			else console.log(`${identity.userId}\t${identity.email}\t${identity.name ?? ""}`);
		});

	machineKey
		.command("generate")
		.description("Generate a local raw secret and hash-only import record")
		.requiredOption("--identity-file <path>", "Identity JSON from the identity command")
		.requiredOption("--label <label>", "Operator label for this machine")
		.requiredOption("--secret-output <path>", "New root-only raw-secret file")
		.requiredOption("--record-output <path>", "New root-only hash-record file")
		.option("--expires-at <timestamp>", "Optional future ISO expiration timestamp")
		.action(
			(options: {
				identityFile: string;
				label: string;
				secretOutput: string;
				recordOutput: string;
				expiresAt?: string;
			}) => {
				const secretOutput = requireNewOutputPath(options.secretOutput, "Secret output");
				const recordOutput = requireNewOutputPath(options.recordOutput, "Record output");
				if (secretOutput === recordOutput) throw new Error("Secret and record output paths must differ");
				const identity = parseIdentity(readJsonInput(options.identityFile));
				const generated = generateMachineKey({
					label: options.label,
					identity,
					expiresAt: parseExpiresAt(options.expiresAt),
				});
				try {
					writePrivateNewFile(secretOutput, `${generated.token}\n`);
					writePrivateNewFile(recordOutput, `${JSON.stringify(generated.record, null, 2)}\n`);
				} catch (error) {
					if (existsSync(secretOutput)) unlinkSync(secretOutput);
					if (existsSync(recordOutput)) unlinkSync(recordOutput);
					throw error;
				}
				printJson({
					id: generated.record.id,
					label: generated.record.label,
					email: generated.record.identity.email,
					expiresAt: generated.record.expiresAt,
					secretOutput,
					recordOutput,
				});
			},
		);

	machineKey
		.command("import")
		.description("Import one hash-only machine-key record")
		.requiredOption("--file <path>", "Record JSON path, or - for stdin")
		.option("--store <path>", "Alternate machine-key store path")
		.action((options: { file: string; store?: string }) => {
			const parsed = parseMachineKeyRecord(readJsonInput(options.file));
			const existingIdentity = resolveAllowedIdentity(parsed.identity.email!);
			if (existingIdentity.userId !== parsed.identity.userId) {
				throw new Error(
					`Machine identity userId does not match the Better Auth user for "${parsed.identity.email}"`,
				);
			}
			const imported = importMachineKeyRecord(parsed, options.store ?? getDefaultMachineKeyStorePath());
			printJson({ id: imported.id, label: imported.label, email: imported.identity.email, createdAt: imported.createdAt });
		});

	machineKey
		.command("list")
		.description("List machine keys without hashes or secrets")
		.option("--store <path>", "Alternate machine-key store path")
		.option("--json", "Print JSON")
		.action((options: { store?: string; json?: boolean }) => {
			const keys = listMachineKeys(options.store ?? getDefaultMachineKeyStorePath());
			if (options.json) {
				printJson(keys);
				return;
			}
			for (const key of keys) {
				console.log(`${key.id}\t${key.status}\t${key.identity.email ?? ""}\t${key.label}`);
			}
		});

	machineKey
		.command("revoke")
		.description("Revoke one machine key")
		.argument("<id>", "Machine-key id")
		.option("--store <path>", "Alternate machine-key store path")
		.action((id: string, options: { store?: string }) => {
			const record = revokeMachineKey(id, options.store ?? getDefaultMachineKeyStorePath());
			printJson({ id: record.id, label: record.label, revokedAt: record.revokedAt });
		});

	await program.parseAsync(argv);
}
