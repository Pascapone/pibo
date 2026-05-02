import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import {
	DefaultPackageManager,
	getAgentDir,
	SettingsManager,
	type ResolvedPaths,
} from "@mariozechner/pi-coding-agent";
import { installOrResolvePiPackage } from "./installer.js";
import type { ParsedPiPackageSource, PiboPiPackageDiagnostic, PiboPiPackageInput, PiPackageResourceType } from "./types.js";

const execFileAsync = promisify(execFile);

type PackageJsonLike = {
	name?: string;
	version?: string;
	description?: string;
	repository?: unknown;
	pi?: unknown;
};

export async function inspectPiPackageSource(source: string, cwd = process.cwd()): Promise<PiboPiPackageInput> {
	const parsed = await parsePiPackageSource(source, cwd);
	const diagnostics: PiboPiPackageDiagnostic[] = [...parsed.diagnostics];
	const install = await installOrResolvePiPackage(parsed, cwd);
	diagnostics.push(...install.diagnostics);
	const registryMetadata = parsed.kind === "npm"
		? await readNpmMetadata(parsed.packageName ?? parsed.name, diagnostics)
		: {};
	const localMetadata = install.installPath
		? readLocalMetadata(install.installPath, diagnostics)
		: parsed.path ? readLocalMetadata(parsed.path, diagnostics) : {};
	const metadata = mergePackageMetadata(registryMetadata, localMetadata, parsed.name);
	const resolved = install.installPath
		? await resolvePackageResources(install.installPath, cwd, diagnostics)
		: emptyResolvedPaths();
	const resourceTypes = mergeResourceTypes(resourceTypesFromManifest(metadata.pi), resourceTypesFromResolvedPaths(resolved));

	if (resourceTypes.length === 0) {
		diagnostics.push({
			type: "warning",
			message: "No Pi package resources were discovered from the manifest or package layout.",
		});
	}

	return {
		id: metadata.name ?? parsed.name,
		name: metadata.name ?? parsed.name,
		description: metadata.description,
		source: parsed.source,
		installSpec: parsed.installSpec,
		version: metadata.version,
		repositoryUrl: repositoryUrl(metadata.repository),
		resourceTypes,
		extensionPaths: pathsOrUndefined(resolved.extensions),
		skillNames: namesOrUndefined(resolved.skills),
		promptNames: namesOrUndefined(resolved.prompts),
		themeNames: namesOrUndefined(resolved.themes),
		installStatus: install.installStatus,
		installPath: install.installPath,
		enabled: true,
		diagnostics,
	};
}

export async function parsePiPackageSource(source: string, cwd = process.cwd()): Promise<ParsedPiPackageSource> {
	const trimmed = source.trim();
	if (!trimmed) throw new Error("Pi package source is required");
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			throw new Error("Invalid Pi package URL");
		}
		if (url.origin !== "https://pi.dev" || !url.pathname.startsWith("/packages/")) {
			throw new Error("Unsupported Pi package URL.\nExpected a URL starting with https://pi.dev/packages/ or a local path.");
		}
		const encodedName = url.pathname.slice("/packages/".length);
		if (!encodedName) {
			throw new Error("Pi package URL must point to a package detail page, for example https://pi.dev/packages/pi-web-access");
		}
		const packageName = decodeURIComponent(encodedName).replace(/\/+$/, "");
		validatePackageName(packageName);
		return {
			kind: "npm",
			name: packageName,
			packageName,
			source: `https://pi.dev/packages/${packageName}`,
			installSpec: `npm:${packageName}`,
			diagnostics: [],
		};
	}

	const path = resolve(cwd, trimmed);
	if (!existsSync(path)) throw new Error(`Local Pi package path does not exist: ${path}`);
	const stats = statSync(path);
	const name = stats.isFile() ? basename(path, extname(path)) : basename(path);
	return {
		kind: "local",
		name,
		path,
		source: path,
		installSpec: path,
		diagnostics: [],
	};
}

async function readNpmMetadata(packageName: string, diagnostics: PiboPiPackageDiagnostic[]): Promise<PackageJsonLike> {
	try {
		const { stdout } = await execFileAsync("npm", ["view", packageName, "--json"], {
			timeout: 20000,
			maxBuffer: 1024 * 1024,
		});
		const parsed = JSON.parse(stdout) as unknown;
		return normalizePackageJson(parsed);
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: `Could not read npm metadata for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
		});
		return { name: packageName };
	}
}

function readLocalMetadata(path: string, diagnostics: PiboPiPackageDiagnostic[]): PackageJsonLike {
	const stats = statSync(path);
	if (stats.isFile()) {
		return {
			name: basename(path, extname(path)),
			pi: { extensions: [path] },
		};
	}
	const packageJsonPath = resolve(path, "package.json");
	if (!existsSync(packageJsonPath)) {
		diagnostics.push({ type: "info", message: "Local directory has no package.json; Pi package conventions will be used." });
		return { name: basename(path) };
	}
	try {
		return normalizePackageJson(JSON.parse(readFileSync(packageJsonPath, "utf-8")) as unknown);
	} catch (error) {
		diagnostics.push({
			type: "warning",
			message: `Could not read local package.json: ${error instanceof Error ? error.message : String(error)}`,
		});
		return { name: basename(path) };
	}
}

async function resolvePackageResources(
	resourceSource: string,
	cwd: string,
	diagnostics: PiboPiPackageDiagnostic[],
): Promise<ResolvedPaths> {
	const packageManager = new DefaultPackageManager({
		cwd,
		agentDir: getAgentDir(),
		settingsManager: SettingsManager.create(cwd, getAgentDir()),
	});
	try {
		return await packageManager.resolveExtensionSources([resourceSource], { temporary: true });
	} catch (error) {
		diagnostics.push({
			type: "error",
			message: `Could not resolve Pi package resources: ${error instanceof Error ? error.message : String(error)}`,
		});
		return emptyResolvedPaths();
	}
}

function validatePackageName(packageName: string): void {
	if (!packageName) throw new Error("Pi package URL must include a package name");
	const parts = packageName.split("/");
	if (packageName.startsWith("@")) {
		if (parts.length !== 2 || !parts[0].slice(1) || !parts[1]) {
			throw new Error("Scoped Pi package URLs must look like https://pi.dev/packages/@scope/package-name");
		}
		return;
	}
	if (parts.length !== 1 || !parts[0]) {
		throw new Error("Pi package URL must include a single package name or scoped package name");
	}
}

function normalizePackageJson(value: unknown): PackageJsonLike {
	const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as PackageJsonLike : {};
	return {
		name: stringField(candidate.name),
		version: stringField(candidate.version),
		description: stringField(candidate.description),
		repository: candidate.repository,
		pi: candidate.pi,
	};
}

function mergePackageMetadata(primary: PackageJsonLike, fallback: PackageJsonLike, defaultName: string): PackageJsonLike {
	return {
		name: fallback.name ?? primary.name ?? defaultName,
		version: fallback.version ?? primary.version,
		description: fallback.description ?? primary.description,
		repository: fallback.repository ?? primary.repository,
		pi: fallback.pi ?? primary.pi,
	};
}

function emptyResolvedPaths(): ResolvedPaths {
	return { extensions: [], skills: [], prompts: [], themes: [] };
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function repositoryUrl(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const url = (value as { url?: unknown }).url;
		return typeof url === "string" ? url : undefined;
	}
	return undefined;
}

function resourceTypesFromManifest(value: unknown): PiPackageResourceType[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const manifest = value as Record<string, unknown>;
	const pairs: Array<[keyof typeof manifest, PiPackageResourceType]> = [
		["extensions", "extension"],
		["skills", "skill"],
		["prompts", "prompt"],
		["themes", "theme"],
	];
	return pairs.flatMap(([key, type]) => Array.isArray(manifest[key]) && manifest[key].length > 0 ? [type] : []);
}

function resourceTypesFromResolvedPaths(paths: ResolvedPaths): PiPackageResourceType[] {
	return [
		...(paths.extensions.length ? ["extension" as const] : []),
		...(paths.skills.length ? ["skill" as const] : []),
		...(paths.prompts.length ? ["prompt" as const] : []),
		...(paths.themes.length ? ["theme" as const] : []),
	];
}

function mergeResourceTypes(...groups: PiPackageResourceType[][]): PiPackageResourceType[] {
	const order: PiPackageResourceType[] = ["extension", "skill", "prompt", "theme"];
	const selected = new Set(groups.flat());
	return order.filter((type) => selected.has(type));
}

function pathsOrUndefined(resources: ResolvedPaths["extensions"]): string[] | undefined {
	const paths = [...new Set(resources.map((resource) => resource.path))];
	return paths.length ? paths : undefined;
}

function namesOrUndefined(resources: ResolvedPaths["skills"]): string[] | undefined {
	const names = [...new Set(resources.map((resource) => basename(resource.path).replace(/\.[^.]+$/, "")))];
	return names.length ? names : undefined;
}
