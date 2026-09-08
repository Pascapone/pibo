import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentRuntimeContextContribution, AgentRuntimeSkillResource } from "../agent-runtime/resources.js";
import { PrefixCapsuleStore, PrefixRecoveryRequiredError, type PrefixCapsuleReference } from "./prefix-capsule.js";

export const PREFIX_RESOURCES_CODEC = "pibo-resources/v1";
export { SESSION_PREFIX_RESOURCES_KEY } from "./prefix-capsule.js";

type ResourceFile = { path: string; content: string; executable: boolean };
export type PrefixResources = {
	format: 1;
	context: AgentRuntimeContextContribution[];
	skills: AgentRuntimeSkillResource[];
	files: ResourceFile[];
};
export type RestoredPrefixResources = Pick<PrefixResources, "context" | "skills">;
const MAX_FILES = 2048;
const MAX_BYTES = 64 * 1024 * 1024;

function childPath(path: string): boolean {
	return Boolean(path) && path.length <= 4096 && path.split("/").length <= 66 && !isAbsolute(path) && !path.includes("\\")
		&& path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

function inside(root: string, path: string): boolean {
	const child = relative(root, path);
	return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

async function readRegular(path: string, maxBytes: number): Promise<Buffer> {
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size > maxBytes) throw new PrefixRecoveryRequiredError("resource is not a bounded regular file");
		const body = Buffer.alloc(metadata.size + 1);
		let length = 0;
		while (length < body.length) {
			const read = await handle.read(body, length, body.length - length, length);
			if (!read.bytesRead) break;
			length += read.bytesRead;
		}
		if (length !== metadata.size) throw new PrefixRecoveryRequiredError("resource changed size while reading");
		return body.subarray(0, length);
	} finally { await handle.close(); }
}

/** Captured only once. No execution environment or MCP configuration enters this bundle. */
export async function capturePrefixResources(
	context: readonly AgentRuntimeContextContribution[],
	skills: readonly AgentRuntimeSkillResource[],
): Promise<PrefixResources> {
	const files: ResourceFile[] = [];
	const capturedSkills: AgentRuntimeSkillResource[] = [];
	let bytes = 0;
	let entries = 0;
	const visit = async (source: string, target: string, root: string, ancestors: Set<string>): Promise<void> => {
		if (++entries > MAX_FILES * 2 || ancestors.size > 64) throw new PrefixRecoveryRequiredError("resource tree exceeds supported bounds");
		const canonical = await realpath(source);
		if (!inside(root, canonical)) throw new PrefixRecoveryRequiredError("resource symlink escapes selected Skill");
		const metadata = await lstat(canonical);
		if (metadata.isDirectory()) {
			if (ancestors.has(canonical)) throw new PrefixRecoveryRequiredError("resource directory cycle");
			const next = new Set(ancestors).add(canonical);
			const names: string[] = [];
			for await (const entry of await opendir(canonical)) {
				if (names.length >= MAX_FILES * 2) throw new PrefixRecoveryRequiredError("resource directory exceeds supported bounds");
				names.push(entry.name);
			}
			for (const name of names.sort()) await visit(join(canonical, name), `${target}/${name}`, root, next);
		} else {
			if (files.length >= MAX_FILES) throw new PrefixRecoveryRequiredError("too many prefix resources");
			const body = await readRegular(canonical, MAX_BYTES - bytes);
			bytes += body.length;
			files.push({ path: target, content: body.toString("base64"), executable: Boolean(metadata.mode & 0o111) });
		}
	};
	for (const [index, skill] of skills.entries()) {
		const source = await realpath(skill.sourcePath);
		const directory = dirname(source);
		const target = `skills/${index}`;
		if (basename(source).toUpperCase() === "SKILL.MD") await visit(directory, target, directory, new Set());
		else await visit(source, `${target}/SKILL.md`, directory, new Set());
		capturedSkills.push({ ...skill, sourcePath: `${target}/${basename(source).toUpperCase() === "SKILL.MD" ? basename(source) : "SKILL.md"}`, materializedPath: undefined });
	}
	return { format: 1, context: context.map(({ materializedPath: _path, ...item }) => ({ ...item })), skills: capturedSkills, files };
}

function decode(payload: string): PrefixResources {
	let value: PrefixResources;
	try { value = JSON.parse(payload); } catch { throw new PrefixRecoveryRequiredError("invalid resource bundle"); }
	if (!value || value.format !== 1 || !Array.isArray(value.context) || !Array.isArray(value.skills)
		|| !Array.isArray(value.files) || value.files.length > MAX_FILES || value.skills.length > MAX_FILES || value.context.length > MAX_FILES) {
		throw new PrefixRecoveryRequiredError("unsupported resource bundle");
	}
	let bytes = 0;
	const paths = new Set<string>();
	for (const file of value.files) {
		if (!file || typeof file.path !== "string" || !childPath(file.path) || !file.path.startsWith("skills/") || paths.has(file.path)
			|| typeof file.content !== "string" || typeof file.executable !== "boolean") throw new PrefixRecoveryRequiredError("invalid resource entry");
		const body = Buffer.from(file.content, "base64");
		bytes += body.length;
		if (body.toString("base64") !== file.content || bytes > MAX_BYTES) throw new PrefixRecoveryRequiredError("invalid resource content");
		paths.add(file.path);
	}
	for (const skill of value.skills) {
		if (!skill || typeof skill.sourcePath !== "string" || !paths.has(skill.sourcePath)
			|| typeof skill.name !== "string" || typeof skill.contributionId !== "string" || typeof skill.required !== "boolean") {
			throw new PrefixRecoveryRequiredError("invalid frozen Skill");
		}
	}
	for (const item of value.context) {
		if (!item || typeof item.id !== "string" || typeof item.label !== "string" || typeof item.required !== "boolean"
			|| !Number.isFinite(item.order) || (item.content !== undefined && typeof item.content !== "string")) throw new PrefixRecoveryRequiredError("invalid frozen context");
	}
	return value;
}

/** The capsule is authoritative; this private tree is a reproducible, stable delivery location. */
export class PrefixResourceBundleStore {
	constructor(private readonly capsules = new PrefixCapsuleStore()) {}

	async put(adapterId: string, bundle: PrefixResources): Promise<{ reference: PrefixCapsuleReference; resources: RestoredPrefixResources }> {
		const payload = JSON.stringify(bundle);
		decode(payload);
		const reference = await this.capsules.put(adapterId, PREFIX_RESOURCES_CODEC, payload);
		return { reference, resources: await this.materialize(reference, bundle) };
	}

	async restore(reference: PrefixCapsuleReference): Promise<RestoredPrefixResources> {
		try {
			return await this.materialize(reference, decode(await this.capsules.read(reference, { adapterId: reference.adapterId, codec: PREFIX_RESOURCES_CODEC })));
		} catch (error) {
			if (error instanceof PrefixRecoveryRequiredError) throw error;
			throw new PrefixRecoveryRequiredError("frozen resources are unavailable; restore the original resource bundle");
		}
	}

	private async materialize(reference: PrefixCapsuleReference, bundle: PrefixResources): Promise<RestoredPrefixResources> {
		const parent = resolve(this.capsules.root, "resources");
		await mkdir(parent, { recursive: true, mode: 0o700 });
		if (await realpath(parent) !== parent) throw new PrefixRecoveryRequiredError("resource root contains a symlink");
		const target = join(parent, reference.digest);
		const exists = await lstat(target).catch(error => { if (error.code === "ENOENT") return undefined; throw error; });
		const expectedFiles = [
			...bundle.files,
			...bundle.context.flatMap((item, index) => item.content === undefined ? [] : [{ path: `context/${index}.md`, content: Buffer.from(item.content).toString("base64"), executable: false }]),
		];
		if (!exists) {
			const temporary = join(parent, `.preparing-${randomUUID()}`);
			await mkdir(temporary, { mode: 0o700 });
			try {
				const directories = new Set([temporary]);
				for (const file of expectedFiles) {
					const path = join(temporary, file.path);
					await mkdir(dirname(path), { recursive: true, mode: 0o700 });
					let directory = dirname(path);
					while (directory !== temporary) { directories.add(directory); directory = dirname(directory); }
					const handle = await open(path, "wx", file.executable ? 0o500 : 0o400);
					try { await handle.writeFile(Buffer.from(file.content, "base64")); await handle.sync(); } finally { await handle.close(); }
				}
				for (const path of [...directories].sort((a, b) => b.length - a.length)) {
					const handle = await open(path, "r");
					try { await handle.sync(); } finally { await handle.close(); }
				}
				try { await rename(temporary, target); }
				catch (error) { if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
				for (const path of [parent, resolve(this.capsules.root)]) {
					const handle = await open(path, "r");
					try { await handle.sync(); } finally { await handle.close(); }
				}
			} finally { await rm(temporary, { recursive: true, force: true }); }
		}
		if (await realpath(target) !== target) throw new PrefixRecoveryRequiredError("resource delivery path changed");
		const expectedPaths = new Set(expectedFiles.map(file => file.path));
		const expectedDirectories = new Set<string>();
		for (const file of expectedFiles) {
			const segments = file.path.split("/");
			for (let length = 1; length < segments.length; length++) expectedDirectories.add(segments.slice(0, length).join("/"));
		}
		const verifyDirectory = async (path: string, prefix: string): Promise<void> => {
			for await (const entry of await opendir(path)) {
				const child = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory() && expectedDirectories.has(child)) await verifyDirectory(join(path, entry.name), child);
				else if (!entry.isFile() || !expectedPaths.has(child)) throw new PrefixRecoveryRequiredError("unexpected entry in frozen resources");
			}
		};
		await verifyDirectory(target, "");
		for (const file of expectedFiles) {
			const path = join(target, file.path);
			if (await realpath(path) !== path) throw new PrefixRecoveryRequiredError("resource delivery contains a symlink");
			const expected = Buffer.from(file.content, "base64");
			if (!(await readRegular(path, expected.length)).equals(expected)) throw new PrefixRecoveryRequiredError("frozen resource content changed");
		}
		return {
			context: bundle.context.map((item, index) => ({ ...item, ...(item.content === undefined ? {} : { materializedPath: join(target, `context/${index}.md`) }) })),
			skills: bundle.skills.map(skill => ({ ...skill, sourcePath: join(target, skill.sourcePath), materializedPath: join(target, skill.sourcePath) })),
		};
	}
}
