import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { DeploymentPoolConfig } from "./config.js";
import type { DeploymentSeedMode } from "./types.js";

const SQLITE_SUFFIXES = [".sqlite", ".sqlite-shm", ".sqlite-wal"];
const COMMON_EXCLUDED_NAMES = new Set([
	"gateway.pid",
	"resource-reaper-state.json",
	"resource-reaper-state.json.lock",
	"compute-image-hash",
	"compute-dep-hash",
]);
const FULL_EXCLUDED_TOP_LEVEL = new Set([
	"agent-runtimes",
	"backups",
	"candidate-packages",
	"debug",
	"migration-reports",
	"quarantine",
	"secrets",
	"skill-backups",
	"tools",
	"validation",
	"vscode",
]);
const MEDIUM_ALLOWED_TOP_LEVEL = new Set([
	"config.json",
	"machine-keys.json",
	"model-defaults.json",
	"base-prompt.json",
	"base-prompt.md",
	"gateway-settings.json",
	"user-settings.json",
	"user-skills.json",
	"chat-agents.sqlite",
	"pibo.sqlite",
	"pibo-events.sqlite",
	"web-projects.sqlite",
	"web-annotations.sqlite",
	"context-files",
	"user-skills",
	"projects",
]);
const FRESH_ALLOWED_TOP_LEVEL = new Set([
	"config.json",
	"machine-keys.json",
	"model-defaults.json",
	"base-prompt.json",
	"base-prompt.md",
	"gateway-settings.json",
	"user-settings.json",
	"user-skills.json",
	"context-files",
	"user-skills",
]);

export interface PreparedDeploymentSeed {
	homePath: string;
	piHomePath: string;
	workspacePath: string;
	mode: DeploymentSeedMode;
	copiedDatabases: string[];
}

export async function prepareDeploymentSeed(input: {
	config: DeploymentPoolConfig;
	slotId: string;
	mode: DeploymentSeedMode;
	publicUrl: string;
}): Promise<PreparedDeploymentSeed> {
	const slotRoot = resolve(input.config.slotsRoot, input.slotId);
	const activeRoot = resolve(slotRoot, "active");
	const stagingRoot = resolve(slotRoot, `.staging-${process.pid}-${Date.now()}`);
	const homePath = resolve(stagingRoot, "pibo-home");
	const piHomePath = resolve(stagingRoot, "pi-home");
	const workspacePath = resolve(stagingRoot, "workspace");
	await mkdir(slotRoot, { recursive: true, mode: 0o700 });
	await rm(stagingRoot, { recursive: true, force: true });
	await mkdir(homePath, { recursive: true, mode: 0o700 });
	await mkdir(piHomePath, { recursive: true, mode: 0o700 });
	await mkdir(workspacePath, { recursive: true, mode: 0o700 });

	try {
		await copySeedNonDatabaseFiles(input.config.seedSourceHome, homePath, input.mode, input.config.root);
		const copiedDatabases = await backupSeedDatabases(input.config.seedSourceHome, homePath, input.mode);
		if (input.config.seedSourcePiHome && existsSync(input.config.seedSourcePiHome)) {
			await copyPiRuntimeAuth(input.config.seedSourcePiHome, piHomePath);
		}
		if (input.mode === "full" && input.config.seedSourceWorkspace && existsSync(input.config.seedSourceWorkspace)) {
			await cp(input.config.seedSourceWorkspace, workspacePath, { recursive: true, force: true, preserveTimestamps: true });
		}
		await configureSlotAuth(homePath, input.publicUrl);
		await writeFile(resolve(stagingRoot, "seed.json"), `${JSON.stringify({ mode: input.mode, createdAt: new Date().toISOString(), sourceHome: input.config.seedSourceHome, copiedDatabases }, null, 2)}\n`, { mode: 0o600 });
		await rm(activeRoot, { recursive: true, force: true });
		await mkdir(dirname(activeRoot), { recursive: true, mode: 0o700 });
		await import("node:fs/promises").then(({ rename }) => rename(stagingRoot, activeRoot));
		await chmod(resolve(activeRoot, "pibo-home"), 0o700);
		await chmod(resolve(activeRoot, "pi-home"), 0o700);
		return {
			homePath: resolve(activeRoot, "pibo-home"),
			piHomePath: resolve(activeRoot, "pi-home"),
			workspacePath: resolve(activeRoot, "workspace"),
			mode: input.mode,
			copiedDatabases,
		};
	} catch (error) {
		await rm(stagingRoot, { recursive: true, force: true });
		throw error;
	}
}

async function copySeedNonDatabaseFiles(sourceHome: string, destinationHome: string, mode: DeploymentSeedMode, poolRoot: string): Promise<void> {
	if (!existsSync(sourceHome)) throw new Error(`Deployment seed source home does not exist: ${sourceHome}`);
	const sourceRoot = resolve(sourceHome);
	const pool = resolve(poolRoot);
	for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
		if (!shouldCopyTopLevel(entry.name, mode)) continue;
		const source = resolve(sourceRoot, entry.name);
		if (isWithin(source, pool) || isWithin(pool, source)) continue;
		if (SQLITE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
		await cp(source, resolve(destinationHome, entry.name), {
			recursive: true,
			force: true,
			preserveTimestamps: true,
			filter(candidate) {
				const name = basename(candidate);
				if (COMMON_EXCLUDED_NAMES.has(name)) return false;
				if (SQLITE_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
				if (/\.(pid|sock|lock)$/i.test(name)) return false;
				return !isWithin(resolve(candidate), pool);
			},
		});
	}
}

function shouldCopyTopLevel(name: string, mode: DeploymentSeedMode): boolean {
	if (COMMON_EXCLUDED_NAMES.has(name)) return false;
	if (mode === "fresh") return FRESH_ALLOWED_TOP_LEVEL.has(name);
	if (mode === "medium") return MEDIUM_ALLOWED_TOP_LEVEL.has(name);
	return !FULL_EXCLUDED_TOP_LEVEL.has(name) && name !== "compute-pool";
}

async function backupSeedDatabases(sourceHome: string, destinationHome: string, mode: DeploymentSeedMode): Promise<string[]> {
	if (mode === "fresh") return [];
	const allowed = mode === "medium"
		? new Set(["chat-agents.sqlite", "pibo.sqlite", "pibo-events.sqlite", "web-projects.sqlite", "web-annotations.sqlite"])
		: undefined;
	const copied: string[] = [];
	for (const entry of await readdir(sourceHome, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
		if (entry.name === "auth.sqlite" || entry.name === "previews.sqlite") continue;
		if (allowed && !allowed.has(entry.name)) continue;
		const sourcePath = resolve(sourceHome, entry.name);
		const destinationPath = resolve(destinationHome, entry.name);
		const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
		try {
			await backup(sourceDb, destinationPath);
			await chmod(destinationPath, 0o600);
			copied.push(entry.name);
		} finally {
			sourceDb.close();
		}
	}
	return copied.sort();
}

async function copyPiRuntimeAuth(sourcePiHome: string, destinationPiHome: string): Promise<void> {
	const sourceAgent = resolve(sourcePiHome, "agent");
	const destinationAgent = resolve(destinationPiHome, "agent");
	await mkdir(destinationAgent, { recursive: true, mode: 0o700 });
	for (const name of ["auth.json", "models-store.json"]) {
		const source = resolve(sourceAgent, name);
		if (!existsSync(source)) continue;
		await cp(source, resolve(destinationAgent, name), { force: true, preserveTimestamps: true });
		await chmod(resolve(destinationAgent, name), 0o600);
	}
}

async function configureSlotAuth(homePath: string, publicUrl: string): Promise<void> {
	const path = resolve(homePath, "config.json");
	let config: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
	} catch (error) {
		if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
	}
	const auth = config.auth && typeof config.auth === "object" && !Array.isArray(config.auth)
		? { ...(config.auth as Record<string, unknown>) }
		: {};
	auth.mode = "better-auth";
	auth.baseURL = new URL(publicUrl).origin;
	const trusted = Array.isArray(auth.trustedOrigins) ? auth.trustedOrigins.filter((value): value is string => typeof value === "string") : [];
	auth.trustedOrigins = [...new Set([...trusted, new URL(publicUrl).origin])];
	config.auth = auth;
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function isWithin(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
