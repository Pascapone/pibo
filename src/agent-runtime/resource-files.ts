import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readdir,
	realpath,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { protectPrivateDirectorySync, protectPrivateFileSync } from "../core/private-path.js";
import type {
	AgentRuntimeResourcePaths,
	AgentRuntimeSkillResource,
} from "./resources.js";

type SkillCopyBudget = {
	files: number;
	bytes: number;
	maxFiles: number;
	maxBytes: number;
	activeDirectories: Set<string>;
};

function safeSegment(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "resource";
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 10);
	return `${normalized}-${hash}`;
}

function isInside(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	protectPrivateDirectorySync(path);
}

export async function createAgentRuntimeResourcePaths(
	rootDir: string,
	input: {
		runtimeInstanceId: string;
		piboSessionId: string;
		sessionGeneration: string;
	},
): Promise<AgentRuntimeResourcePaths> {
	const root = join(
		rootDir,
		safeSegment(input.runtimeInstanceId),
		safeSegment(input.piboSessionId),
		safeSegment(input.sessionGeneration),
	);
	const paths: AgentRuntimeResourcePaths = {
		root,
		home: join(root, "home"),
		skills: join(root, "skills"),
		context: join(root, "context"),
		config: join(root, "config"),
		protocol: join(root, "protocol"),
	};
	for (const path of Object.values(paths)) await ensurePrivateDirectory(path);
	return paths;
}

async function copySkillEntry(source: string, destination: string, sourceRoot: string, budget: SkillCopyBudget): Promise<void> {
	const metadata = await lstat(source);
	if (metadata.isSymbolicLink()) {
		const target = await realpath(source);
		if (!isInside(sourceRoot, target)) throw new Error(`Skill symlink escapes its source directory: ${source}`);
		await copySkillEntry(target, destination, sourceRoot, budget);
		return;
	}
	if (metadata.isDirectory()) {
		const canonical = await realpath(source);
		if (budget.activeDirectories.has(canonical)) throw new Error(`Skill directory contains a symlink cycle: ${source}`);
		budget.activeDirectories.add(canonical);
		try {
			await mkdir(destination, { recursive: true, mode: metadata.mode & 0o777 });
			protectPrivateDirectorySync(destination);
			for (const entry of await readdir(source)) {
				await copySkillEntry(join(source, entry), join(destination, entry), sourceRoot, budget);
			}
		} finally {
			budget.activeDirectories.delete(canonical);
		}
		return;
	}
	if (!metadata.isFile()) throw new Error(`Skill resource is not a regular file: ${source}`);
	budget.files += 1;
	budget.bytes += metadata.size;
	if (budget.files > budget.maxFiles) throw new Error(`Skill exceeds the ${budget.maxFiles}-file materialization limit.`);
	if (budget.bytes > budget.maxBytes) throw new Error(`Skill exceeds the ${budget.maxBytes}-byte materialization limit.`);
	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	await copyFile(source, destination);
	if (process.platform === "win32") protectPrivateFileSync(destination);
	else await chmod(destination, metadata.mode & 0o777);
}

export async function copyAgentRuntimeSkillDirectory(
	skill: AgentRuntimeSkillResource,
	destinationRoot: string,
	limits: { maxFiles: number; maxBytes: number },
): Promise<string> {
	const sourceFile = await realpath(skill.sourcePath);
	const sourceRoot = basename(sourceFile).toUpperCase() === "SKILL.MD" ? await realpath(dirname(sourceFile)) : dirname(sourceFile);
	const destination = join(destinationRoot, safeSegment(skill.name));
	const budget: SkillCopyBudget = {
		files: 0,
		bytes: 0,
		maxFiles: limits.maxFiles,
		maxBytes: limits.maxBytes,
		activeDirectories: new Set(),
	};
	if (basename(sourceFile).toUpperCase() === "SKILL.MD") {
		await copySkillEntry(sourceRoot, destination, sourceRoot, budget);
		return join(destination, relative(sourceRoot, sourceFile));
	}
	await ensurePrivateDirectory(destination);
	const target = join(destination, "SKILL.md");
	await copySkillEntry(sourceFile, target, sourceRoot, budget);
	return target;
}
