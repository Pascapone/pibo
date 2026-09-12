import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { PLUGIN_MANIFEST_FILENAME, type PluginManifest, type PluginSource } from "./manifest.js";
import { canonicalPluginJson, parsePluginManifest } from "./schema.js";
import { PluginValidationError, type PluginArtifact } from "./store.js";

export type PluginSourceInput =
	| { kind: "local"; path: string }
	| { kind: "package"; path: string; name: string; version: string; integrity?: string };
export interface ResolvedPluginSource { source: PluginSource; manifest: PluginManifest; contentHash: string; files: ReadonlyMap<string, Buffer> }
/** Additional source adapters return bytes/metadata, never import or activate executable extensions. */
export interface PluginSourceResolver { resolve(source: PluginSourceInput): Promise<ResolvedPluginSource> }
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 10000;
function safePath(path: string): string {
	if (!path || isAbsolute(path) || path.includes("\\") || path.includes("\0") || path.split("/").some((p) => p === ".." || p === "." || !p)) throw new PluginValidationError(`Unsafe plugin artifact path: ${path}`);
	return path;
}
function digest(files: ReadonlyMap<string, Buffer>): string {
	const hash = createHash("sha256");
	for (const [name, data] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
		hash.update(`${Buffer.byteLength(name)}:${name}:${data.length}:`); hash.update(data);
	}
	return `sha256:${hash.digest("hex")}`;
}
async function directoryFiles(root: string): Promise<Map<string, Buffer>> {
	const files = new Map<string, Buffer>(); let bytes = 0;
	const absolute = await realpath(root);
	async function walk(path: string): Promise<void> {
		for (const name of (await readdir(path)).sort()) {
			if (name === ".git") continue;
			const full = join(path, name); const info = await lstat(full);
			if (info.isSymbolicLink()) throw new PluginValidationError(`Plugin artifacts cannot contain symlinks: ${name}`);
			if (info.isDirectory()) await walk(full);
			else if (info.isFile()) {
				bytes += info.size;
				if (bytes > MAX_BYTES || files.size >= MAX_FILES) throw new PluginValidationError("Plugin artifact exceeds limits");
				const local = safePath(relative(absolute, full).split(sep).join("/"));
				const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
				let data: Buffer;
				try {
					const opened = await file.stat();
					if (!opened.isFile() || opened.ino !== info.ino || opened.size !== info.size) throw new PluginValidationError("Plugin source changed during inspection");
					data = await file.readFile();
				} finally { await file.close(); }
				if (data.length !== info.size) throw new PluginValidationError("Plugin source changed during inspection");
				files.set(local, data);
			} else throw new PluginValidationError("Plugin artifact contains a nonregular file");
		}
	}
	await walk(absolute); return files;
}
function archiveFiles(compressed: Buffer): Map<string, Buffer> {
	const bytes = compressed[0] === 0x1f && compressed[1] === 0x8b ? gunzipSync(compressed, { maxOutputLength: MAX_BYTES }) : compressed;
	if (bytes.length > MAX_BYTES) throw new PluginValidationError("Plugin archive exceeds limits");
	const files = new Map<string, Buffer>();
	for (let offset = 0; offset < bytes.length; ) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.length !== 512) throw new PluginValidationError("Truncated plugin archive");
		if (header.every((byte) => byte === 0)) break;
		const text = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
		const octal = (start: number, length: number) => {
			const value = text(start, length).trim();
			if (!/^[0-7]+$/.test(value)) throw new PluginValidationError("Invalid tar numeric header");
			return Number.parseInt(value, 8);
		};
		let checksum = 0; for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
		if (checksum !== octal(148, 8)) throw new PluginValidationError("Invalid plugin archive checksum");
		const size = octal(124, 12); const type = text(156, 1); const prefix = text(345, 155);
		let name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
		if (name.startsWith("package/")) name = name.slice(8);
		if (type === "5") { if (name && name !== "package") safePath(name.replace(/\/$/, "")); }
		else {
			if (type !== "" && type !== "0") throw new PluginValidationError("Only regular files/directories are supported in plugin package artifacts (no links or extension headers)");
			safePath(name);
			if (files.has(name) || files.size >= MAX_FILES) throw new PluginValidationError("Duplicate or excessive plugin archive entries");
			if (offset + 512 + size > bytes.length) throw new PluginValidationError("Truncated plugin archive payload");
			files.set(name, Buffer.from(bytes.subarray(offset + 512, offset + 512 + size)));
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}
export class LocalPluginSourceResolver implements PluginSourceResolver {
	async resolve(input: PluginSourceInput): Promise<ResolvedPluginSource> {
		if (!input || (input.kind !== "local" && input.kind !== "package") || typeof input.path !== "string") throw new PluginValidationError("Expected local directory or exact versioned package artifact");
		let files: Map<string, Buffer>; let source: PluginSource;
		if (input.kind === "local") { files = await directoryFiles(input.path); source = { kind: "local", path: await realpath(input.path) }; }
		else {
			if (!input.name || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(input.version)) throw new PluginValidationError("Package source requires a name and exact version, not a range or tag");
			if ((await lstat(input.path)).size > MAX_BYTES) throw new PluginValidationError("Plugin archive exceeds limits");
			const archive = await readFile(input.path);
			if (input.integrity && input.integrity !== `sha256-${createHash("sha256").update(archive).digest("base64")}`) throw new PluginValidationError("Plugin package integrity mismatch");
			files = archiveFiles(archive); source = { kind: "package", name: input.name, version: input.version };
		}
		const json = files.get(PLUGIN_MANIFEST_FILENAME);
		if (!json) throw new PluginValidationError(`Missing ${PLUGIN_MANIFEST_FILENAME}`);
		const manifest = parsePluginManifest(JSON.parse(json.toString("utf8")), { files: [...files.keys()] });
		if (input.kind === "package") {
			if (manifest.version !== input.version) throw new PluginValidationError("Package and manifest versions differ");
			const packageJson = files.get("package.json");
			if (!packageJson) throw new PluginValidationError("Versioned package artifact must contain package.json identity");
			const pkg = JSON.parse(packageJson.toString("utf8"));
			if (pkg.name !== input.name || pkg.version !== input.version) throw new PluginValidationError("Package artifact identity differs from requested name/version");
		}
		return { source, manifest, contentHash: digest(files), files };
	}
}
export async function stagePluginSource(source: ResolvedPluginSource, artifactRoot: string, createdAt: string): Promise<PluginArtifact> {
	if (!/^sha256:[a-f0-9]{64}$/.test(source.contentHash) || digest(source.files) !== source.contentHash) throw new PluginValidationError("Source resolver supplied an invalid content digest");
	const manifestBytes = source.files.get(PLUGIN_MANIFEST_FILENAME);
	if (!manifestBytes) throw new PluginValidationError("Source resolver omitted the manifest bytes");
	const actualManifest = parsePluginManifest(JSON.parse(manifestBytes.toString("utf8")), { files: [...source.files.keys()] });
	if (canonicalPluginJson(source.manifest) !== canonicalPluginJson(actualManifest)) throw new PluginValidationError("Source resolver manifest differs from artifact bytes");
	const root = resolve(artifactRoot); await mkdir(root, { recursive: true, mode: 0o700 });
	const target = join(root, source.contentHash.replace(":", "-"));
	try {
		if (digest(await directoryFiles(target)) !== source.contentHash) throw new PluginValidationError("Existing staged artifact was modified");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const temporary = join(root, `.staging-${randomUUID()}`);
		await mkdir(temporary, { mode: 0o700 });
		try {
			for (const [name, data] of source.files) {
				const destination = join(temporary, safePath(name)); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
				await writeFile(destination, data, { mode: 0o400, flag: "wx" });
				const file = await open(destination, "r");
				try { await file.sync(); } finally { await file.close(); }
			}
			if (digest(await directoryFiles(temporary)) !== source.contentHash) throw new PluginValidationError("Staged plugin digest differs");
			try {
				await rename(temporary, target);
				const directory = await open(root, "r");
				try { await directory.sync(); } finally { await directory.close(); }
			}
			catch (renameError) {
				if (!["EEXIST", "ENOTEMPTY"].includes((renameError as NodeJS.ErrnoException).code ?? "") || digest(await directoryFiles(target)) !== source.contentHash) throw renameError;
			}
		} finally { await rm(temporary, { recursive: true, force: true }); }
	}
	return { pluginId: source.manifest.id, revision: source.contentHash, version: source.manifest.version, contentHash: source.contentHash, source: source.source, manifest: source.manifest, artifactPath: target, createdAt };
}
export async function verifyPluginArtifact(artifact: PluginArtifact): Promise<void> {
	if (!artifact.artifactPath) throw new PluginValidationError("Plugin artifact has no staged root");
	const files = await directoryFiles(artifact.artifactPath);
	if (digest(files) !== artifact.contentHash) throw new PluginValidationError("Staged plugin content hash changed; activation refused");
	const manifestBytes = files.get(PLUGIN_MANIFEST_FILENAME);
	if (!manifestBytes) throw new PluginValidationError("Staged manifest is missing");
	const actual = parsePluginManifest(JSON.parse(manifestBytes.toString("utf8")), { files: [...files.keys()] });
	if (canonicalPluginJson(actual) !== canonicalPluginJson(artifact.manifest) || artifact.pluginId !== actual.id || artifact.version !== actual.version || artifact.revision !== artifact.contentHash) throw new PluginValidationError("Staged artifact identity or manifest changed");
}
