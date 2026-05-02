import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PiboPiPackageInfo, PiboPiPackageInput, PiboPiPackageStoreData } from "./types.js";

const STORE_VERSION = 1;

export function defaultPiPackageStorePath(cwd = process.cwd()): string {
	return resolve(cwd, ".pibo/pi-packages.json");
}

export function ensurePiPackageStorage(cwd = process.cwd()): void {
	mkdirSync(resolve(cwd, ".pibo/pi-packages/npm"), { recursive: true });
	mkdirSync(resolve(cwd, ".pibo/pi-packages/git"), { recursive: true });
	mkdirSync(resolve(cwd, ".pibo/pi-packages/local"), { recursive: true });
}

export function loadPiPackageStore(path = defaultPiPackageStorePath()): PiboPiPackageStoreData {
	if (!existsSync(path)) return { version: STORE_VERSION, packages: [] };
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid Pi package store at ${path}`);
	}
	const data = parsed as Partial<PiboPiPackageStoreData>;
	if (data.version !== STORE_VERSION || !Array.isArray(data.packages)) {
		throw new Error(`Unsupported Pi package store at ${path}`);
	}
	return {
		version: STORE_VERSION,
		packages: data.packages.map(sanitizeStoredPackage),
	};
}

export function savePiPackageStore(data: PiboPiPackageStoreData, path = defaultPiPackageStorePath()): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ version: STORE_VERSION, packages: data.packages }, null, 2)}\n`, "utf-8");
}

export function listPiPackages(cwd = process.cwd()): PiboPiPackageInfo[] {
	return loadPiPackageStore(defaultPiPackageStorePath(cwd)).packages;
}

export function findPiPackage(nameOrId: string, cwd = process.cwd()): PiboPiPackageInfo | undefined {
	const lookup = nameOrId.trim();
	return listPiPackages(cwd).find((pkg) => (
		pkg.id === lookup ||
		pkg.name === lookup ||
		pkg.source === lookup ||
		pkg.installSpec === lookup
	));
}

export function upsertPiPackage(pkg: PiboPiPackageInput, cwd = process.cwd()): PiboPiPackageInfo {
	ensurePiPackageStorage(cwd);
	const path = defaultPiPackageStorePath(cwd);
	const data = loadPiPackageStore(path);
	const now = new Date().toISOString();
	const existingIndex = data.packages.findIndex(
		(candidate) => candidate.id === pkg.id || candidate.name === pkg.name || candidate.source === pkg.source,
	);
	const existing = existingIndex >= 0 ? data.packages[existingIndex] : undefined;
	const next: PiboPiPackageInfo = existing && existing.installStatus === "installed" && pkg.installStatus === "error"
		? {
				...existing,
				diagnostics: mergeDiagnostics(existing.diagnostics, [
					{ type: "warning", message: `Latest package refresh failed; keeping previous installed record for ${existing.name}.` },
					...pkg.diagnostics,
				]),
				updatedAt: now,
			}
		: {
				...pkg,
				enabled: existing?.enabled ?? pkg.enabled !== false,
				addedAt: existing ? existing.addedAt : pkg.addedAt ?? now,
				updatedAt: now,
			};
	if (existingIndex >= 0) data.packages[existingIndex] = next;
	else data.packages.push(next);
	data.packages.sort((left, right) => left.name.localeCompare(right.name));
	savePiPackageStore(data, path);
	return next;
}

export function removePiPackage(nameOrId: string, cwd = process.cwd()): PiboPiPackageInfo | undefined {
	const path = defaultPiPackageStorePath(cwd);
	const data = loadPiPackageStore(path);
	const lookup = nameOrId.trim();
	const index = data.packages.findIndex((pkg) => (
		pkg.id === lookup ||
		pkg.name === lookup ||
		pkg.source === lookup ||
		pkg.installSpec === lookup
	));
	if (index < 0) return undefined;
	const [removed] = data.packages.splice(index, 1);
	savePiPackageStore(data, path);
	return removed;
}

export function setPiPackageEnabled(nameOrId: string, enabled: boolean, cwd = process.cwd()): PiboPiPackageInfo | undefined {
	const path = defaultPiPackageStorePath(cwd);
	const data = loadPiPackageStore(path);
	const lookup = nameOrId.trim();
	const index = data.packages.findIndex((pkg) => pkg.id === lookup || pkg.name === lookup || pkg.source === lookup);
	if (index < 0) return undefined;
	const next: PiboPiPackageInfo = {
		...data.packages[index],
		enabled,
		updatedAt: new Date().toISOString(),
	};
	data.packages[index] = next;
	savePiPackageStore(data, path);
	return next;
}

function sanitizeStoredPackage(value: unknown): PiboPiPackageInfo {
	const candidate = value as Partial<PiboPiPackageInfo>;
	if (!candidate || typeof candidate !== "object") throw new Error("Invalid Pi package entry");
	if (typeof candidate.name !== "string" || typeof candidate.source !== "string" || typeof candidate.installSpec !== "string") {
		throw new Error("Invalid Pi package entry");
	}
	return {
		id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : candidate.name.trim(),
		name: candidate.name.trim(),
		description: stringOrUndefined(candidate.description),
		source: candidate.source.trim(),
		installSpec: candidate.installSpec.trim(),
		version: stringOrUndefined(candidate.version),
		repositoryUrl: stringOrUndefined(candidate.repositoryUrl),
		resourceTypes: uniqueResourceTypes(candidate.resourceTypes),
		extensionPaths: stringArray(candidate.extensionPaths),
		skillNames: stringArray(candidate.skillNames),
		promptNames: stringArray(candidate.promptNames),
		themeNames: stringArray(candidate.themeNames),
		discoveredToolNames: stringArray(candidate.discoveredToolNames),
		installStatus: installStatus(candidate),
		installPath: stringOrUndefined(candidate.installPath),
		enabled: candidate.enabled !== false,
		diagnostics: Array.isArray(candidate.diagnostics) ? candidate.diagnostics.flatMap((diagnostic) => {
			if (!diagnostic || typeof diagnostic !== "object") return [];
			const item = diagnostic as Partial<PiboPiPackageInfo["diagnostics"][number]>;
			if (item.type !== "info" && item.type !== "warning" && item.type !== "error") return [];
			if (typeof item.message !== "string" || !item.message.trim()) return [];
			return [{ type: item.type, message: item.message.trim() }];
		}) : [],
		addedAt: stringOrUndefined(candidate.addedAt) ?? new Date().toISOString(),
		updatedAt: stringOrUndefined(candidate.updatedAt) ?? new Date().toISOString(),
	};
}

function installStatus(candidate: Partial<PiboPiPackageInfo> & { installed?: unknown }): PiboPiPackageInfo["installStatus"] {
	if (
		candidate.installStatus === "registered" ||
		candidate.installStatus === "installed" ||
		candidate.installStatus === "missing" ||
		candidate.installStatus === "error"
	) {
		return candidate.installStatus;
	}
	return candidate.installed === true ? "installed" : "registered";
}

function mergeDiagnostics(
	left: PiboPiPackageInfo["diagnostics"],
	right: PiboPiPackageInfo["diagnostics"],
): PiboPiPackageInfo["diagnostics"] {
	const seen = new Set<string>();
	const merged: PiboPiPackageInfo["diagnostics"] = [];
	for (const diagnostic of [...left, ...right]) {
		const key = `${diagnostic.type}\0${diagnostic.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(diagnostic);
	}
	return merged;
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const strings = [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
	return strings.length ? strings : undefined;
}

function uniqueResourceTypes(value: unknown): PiboPiPackageInfo["resourceTypes"] {
	if (!Array.isArray(value)) return [];
	const allowed = new Set(["extension", "skill", "prompt", "theme"]);
	return [...new Set(value.filter((item): item is PiboPiPackageInfo["resourceTypes"][number] => typeof item === "string" && allowed.has(item)))];
}
