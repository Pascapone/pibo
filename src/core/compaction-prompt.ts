import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PiboCompactionPromptMode = "library" | "custom";

export type PiboCompactionPromptState = {
	mode: PiboCompactionPromptMode;
	updatedAt?: string;
};

export type PiboCompactionPromptSnapshot = {
	mode: PiboCompactionPromptMode;
	effectiveMode: PiboCompactionPromptMode;
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
};

export type PiboCompactionPromptSpec = {
	systemPrompt: string;
	summaryPrompt: string;
	updateSummaryPrompt: string;
	turnPrefixSummaryPrompt: string;
};

const PROJECT_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PIBO_LIBRARY_COMPACTION_PROMPT_PATH = resolve(PROJECT_ROOT, "context/pibo-compaction-prompt.md");

function getCompactionPromptStatePath(cwd: string): string {
	return resolve(cwd, ".pibo/compaction-prompt.json");
}

function getCustomCompactionPromptPath(cwd: string): string {
	return resolve(cwd, ".pibo/compaction-prompt.md");
}

function normalizeMode(value: unknown): PiboCompactionPromptMode {
	return value === "custom" ? "custom" : "library";
}

function readCompactionPromptState(cwd: string): PiboCompactionPromptState {
	const path = getCompactionPromptStatePath(cwd);
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

function writeCompactionPromptState(cwd: string, state: PiboCompactionPromptState): void {
	const path = getCompactionPromptStatePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function extractPromptSection(markdown: string, tag: string): string {
	const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i");
	const match = markdown.match(pattern);
	if (!match) throw new Error(`Compaction prompt is missing <${tag}> section`);
	return match[1].trim();
}

export function parsePiboCompactionPrompt(markdown: string): PiboCompactionPromptSpec {
	return {
		systemPrompt: extractPromptSection(markdown, "system-prompt"),
		summaryPrompt: extractPromptSection(markdown, "summary-prompt"),
		updateSummaryPrompt: extractPromptSection(markdown, "update-summary-prompt"),
		turnPrefixSummaryPrompt: extractPromptSection(markdown, "turn-prefix-summary-prompt"),
	};
}

export function getActivePiboCompactionPromptPath(cwd = process.cwd()): string {
	const customPath = getCustomCompactionPromptPath(cwd);
	const state = readCompactionPromptState(cwd);
	if (state.mode === "custom" && existsSync(customPath)) return customPath;
	return PIBO_LIBRARY_COMPACTION_PROMPT_PATH;
}

export async function readActivePiboCompactionPromptSpec(cwd = process.cwd()): Promise<PiboCompactionPromptSpec> {
	return parsePiboCompactionPrompt(await readFile(getActivePiboCompactionPromptPath(cwd), "utf-8"));
}

export async function readPiboCompactionPrompt(cwd = process.cwd()): Promise<PiboCompactionPromptSnapshot> {
	const state = readCompactionPromptState(cwd);
	const customPath = getCustomCompactionPromptPath(cwd);
	const customExists = existsSync(customPath);
	const [libraryMarkdown, customMarkdown] = await Promise.all([
		readFile(PIBO_LIBRARY_COMPACTION_PROMPT_PATH, "utf-8"),
		customExists ? readFile(customPath, "utf-8") : Promise.resolve(""),
	]);

	return {
		mode: state.mode,
		effectiveMode: state.mode === "custom" && customExists ? "custom" : "library",
		library: {
			path: PIBO_LIBRARY_COMPACTION_PROMPT_PATH,
			markdown: libraryMarkdown,
		},
		custom: {
			path: customPath,
			markdown: customMarkdown,
			exists: customExists,
			updatedAt: customExists ? state.updatedAt : undefined,
		},
	};
}

export async function savePiboCustomCompactionPrompt(markdown: string, cwd = process.cwd()): Promise<PiboCompactionPromptSnapshot> {
	parsePiboCompactionPrompt(markdown);
	const path = getCustomCompactionPromptPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const updatedAt = new Date().toISOString();
	await writeFile(path, markdown);
	writeCompactionPromptState(cwd, { mode: "custom", updatedAt });
	return readPiboCompactionPrompt(cwd);
}

export function setPiboCompactionPromptMode(mode: PiboCompactionPromptMode, cwd = process.cwd()): PiboCompactionPromptSnapshot {
	const existing = readCompactionPromptState(cwd);
	const customPath = getCustomCompactionPromptPath(cwd);
	if (mode === "custom" && !existsSync(customPath)) {
		mkdirSync(dirname(customPath), { recursive: true });
		writeFileSync(customPath, readFileSync(PIBO_LIBRARY_COMPACTION_PROMPT_PATH, "utf-8"));
	}
	writeCompactionPromptState(cwd, {
		mode,
		updatedAt: mode === "custom" ? existing.updatedAt ?? new Date().toISOString() : existing.updatedAt,
	});
	const state = readCompactionPromptState(cwd);
	const customExists = existsSync(customPath);
	return {
		mode: state.mode,
		effectiveMode: state.mode === "custom" && customExists ? "custom" : "library",
		library: {
			path: PIBO_LIBRARY_COMPACTION_PROMPT_PATH,
			markdown: readFileSync(PIBO_LIBRARY_COMPACTION_PROMPT_PATH, "utf-8"),
		},
		custom: {
			path: customPath,
			markdown: customExists ? readFileSync(customPath, "utf-8") : "",
			exists: customExists,
			updatedAt: customExists ? state.updatedAt : undefined,
		},
	};
}
