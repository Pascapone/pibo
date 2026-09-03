import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PiboBasePromptMode = "library" | "custom";
export type PiboBasePromptEffectiveMode = PiboBasePromptMode | "legacy";

export type PiboBasePromptState = {
	mode: PiboBasePromptMode;
	updatedAt?: string;
};

export type PiboBasePromptSnapshot = {
	mode: PiboBasePromptMode;
	effectiveMode: PiboBasePromptEffectiveMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
	legacy: {
		path: string;
		markdown: string;
		exists: boolean;
	};
};

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PIBO_LIBRARY_BASE_PROMPT_PATH = resolve(PROJECT_ROOT, "context/pibo-system-prompt.md");

function getBasePromptStatePath(cwd: string): string {
	return resolve(cwd, ".pibo/base-prompt.json");
}

function getCustomBasePromptPath(cwd: string): string {
	return resolve(cwd, ".pibo/base-prompt.md");
}

function getLegacyBasePromptPath(cwd: string): string {
	return resolve(cwd, ".pibo/SYSTEM.md");
}

function effectiveMode(state: PiboBasePromptState, customExists: boolean, legacyExists: boolean): PiboBasePromptEffectiveMode {
	if (legacyExists) return "legacy";
	return state.mode === "custom" && customExists ? "custom" : "library";
}

function normalizeMode(value: unknown): PiboBasePromptMode {
	return value === "custom" ? "custom" : "library";
}

function readBasePromptState(cwd: string): PiboBasePromptState {
	const path = getBasePromptStatePath(cwd);
	if (!existsSync(path)) return { mode: "library" };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as { mode?: unknown; updatedAt?: unknown };
		return {
			mode: normalizeMode(parsed.mode),
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
		};
	} catch {
		return { mode: "library" };
	}
}

function writeBasePromptState(cwd: string, state: PiboBasePromptState): void {
	const path = getBasePromptStatePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export function getActivePiboBasePromptPath(cwd = process.cwd()): string | undefined {
	if (existsSync(getLegacyBasePromptPath(cwd))) return undefined;

	const customPath = getCustomBasePromptPath(cwd);
	const state = readBasePromptState(cwd);
	if (state.mode === "custom" && existsSync(customPath)) return customPath;
	return existsSync(PIBO_LIBRARY_BASE_PROMPT_PATH) ? PIBO_LIBRARY_BASE_PROMPT_PATH : undefined;
}

export async function readPiboBasePrompt(cwd = process.cwd()): Promise<PiboBasePromptSnapshot> {
	const state = readBasePromptState(cwd);
	const customPath = getCustomBasePromptPath(cwd);
	const legacyPath = getLegacyBasePromptPath(cwd);
	const customExists = existsSync(customPath);
	const legacyExists = existsSync(legacyPath);
	const [libraryMarkdown, customMarkdown, legacyMarkdown] = await Promise.all([
		readFile(PIBO_LIBRARY_BASE_PROMPT_PATH, "utf-8"),
		customExists ? readFile(customPath, "utf-8") : Promise.resolve(""),
		legacyExists ? readFile(legacyPath, "utf-8") : Promise.resolve(""),
	]);

	return {
		mode: state.mode,
		effectiveMode: effectiveMode(state, customExists, legacyExists),
		library: {
			path: PIBO_LIBRARY_BASE_PROMPT_PATH,
			markdown: libraryMarkdown,
		},
		custom: {
			path: customPath,
			markdown: customMarkdown,
			exists: customExists,
			updatedAt: customExists ? state.updatedAt : undefined,
		},
		legacy: {
			path: legacyPath,
			markdown: legacyMarkdown,
			exists: legacyExists,
		},
	};
}

export async function savePiboCustomBasePrompt(markdown: string, cwd = process.cwd()): Promise<PiboBasePromptSnapshot> {
	const path = getCustomBasePromptPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const updatedAt = new Date().toISOString();
	await writeFile(path, markdown);
	writeBasePromptState(cwd, { mode: "custom", updatedAt });
	return readPiboBasePrompt(cwd);
}

export function setPiboBasePromptMode(mode: PiboBasePromptMode, cwd = process.cwd()): PiboBasePromptSnapshot {
	const existing = readBasePromptState(cwd);
	const customPath = getCustomBasePromptPath(cwd);
	if (mode === "custom" && !existsSync(customPath)) {
		mkdirSync(dirname(customPath), { recursive: true });
		writeFileSync(customPath, readFileSync(PIBO_LIBRARY_BASE_PROMPT_PATH, "utf-8"));
	}
	writeBasePromptState(cwd, {
		mode,
		updatedAt: mode === "custom" ? existing.updatedAt ?? new Date().toISOString() : existing.updatedAt,
	});
	const state = readBasePromptState(cwd);
	const customExists = existsSync(customPath);
	const legacyPath = getLegacyBasePromptPath(cwd);
	const legacyExists = existsSync(legacyPath);
	return {
		mode: state.mode,
		effectiveMode: effectiveMode(state, customExists, legacyExists),
		library: {
			path: PIBO_LIBRARY_BASE_PROMPT_PATH,
			markdown: readFileSync(PIBO_LIBRARY_BASE_PROMPT_PATH, "utf-8"),
		},
		custom: {
			path: customPath,
			markdown: customExists ? readFileSync(customPath, "utf-8") : "",
			exists: customExists,
			updatedAt: customExists ? state.updatedAt : undefined,
		},
		legacy: {
			path: legacyPath,
			markdown: legacyExists ? readFileSync(legacyPath, "utf-8") : "",
			exists: legacyExists,
		},
	};
}
