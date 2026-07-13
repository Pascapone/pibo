import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Model, Transport } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import {
	buildSessionContext,
	convertToLlm,
	serializeConversation,
	type CompactionResult,
	type ExtensionFactory,
	type SessionBeforeCompactEvent,
	type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	isRetryablePiboAssistantError,
	isRetryablePiboProviderError,
	resolvePiboProviderRecoverySettings,
	waitForPiboProviderRecovery,
	type PiboProviderRecoverySettings,
} from "./provider-recovery.js";

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

type PiboCompactionPreparation = SessionBeforeCompactEvent["preparation"];

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

function buildSummaryPrompt(
	spec: PiboCompactionPromptSpec,
	messages: AgentMessage[],
	customInstructions?: string,
	previousSummary?: string,
): string {
	const conversationText = serializeConversation(convertToLlm(messages));
	const basePrompt = previousSummary ? spec.updateSummaryPrompt : spec.summaryPrompt;
	const focusedPrompt = customInstructions ? `${basePrompt}\n\nAdditional focus: ${customInstructions}` : basePrompt;
	return [
		`<conversation>\n${conversationText}\n</conversation>`,
		previousSummary ? `<previous-summary>\n${previousSummary}\n</previous-summary>` : undefined,
		focusedPrompt,
	].filter((part): part is string => part !== undefined).join("\n\n");
}

function buildTurnPrefixPrompt(spec: PiboCompactionPromptSpec, messages: AgentMessage[]): string {
	const conversationText = serializeConversation(convertToLlm(messages));
	return `<conversation>\n${conversationText}\n</conversation>\n\n${spec.turnPrefixSummaryPrompt}`;
}

type PiboCompactionCompletion = typeof completeSimple;

export async function completePiboCompactionSummary(input: {
	model: Model<any>;
	systemPrompt: string;
	promptText: string;
	maxTokens: number;
	apiKey: string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	thinkingLevel?: ThinkingLevel;
	transport?: Transport;
	sessionId?: string;
	timeoutMs?: number;
	websocketConnectTimeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	recovery: PiboProviderRecoverySettings;
	complete?: PiboCompactionCompletion;
}): Promise<string> {
	const recoverySessionId = input.sessionId ? `compaction-${randomUUID()}` : undefined;
	const completionOptions = {
		maxTokens: input.maxTokens,
		signal: input.signal,
		apiKey: input.apiKey,
		headers: input.headers,
		transport: input.transport,
		sessionId: recoverySessionId,
		timeoutMs: input.timeoutMs,
		websocketConnectTimeoutMs: input.websocketConnectTimeoutMs,
		maxRetries: input.maxRetries,
		maxRetryDelayMs: input.maxRetryDelayMs,
		...(input.model.reasoning && input.thinkingLevel && input.thinkingLevel !== "off"
			? { reasoning: input.thinkingLevel }
			: {}),
	};
	const complete = input.complete ?? completeSimple;
	let recoveryAttempt = 0;

	while (true) {
		let response: AssistantMessage;
		try {
			response = await complete(
				input.model,
				{
					systemPrompt: input.systemPrompt,
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: input.promptText }],
							timestamp: Date.now(),
						},
					],
				},
				completionOptions,
			);
		} catch (error) {
			if (input.signal?.aborted || !input.recovery.enabled || !isRetryablePiboProviderError(error)) throw error;
			recoveryAttempt += 1;
			await waitForPiboProviderRecovery(recoveryAttempt, input.recovery, input.signal);
			continue;
		}

		if (response.stopReason === "aborted") {
			throw new Error("Summarization was aborted");
		}
		if (response.stopReason === "error") {
			const error = new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
			if (!input.recovery.enabled || !isRetryablePiboAssistantError(response)) throw error;
			recoveryAttempt += 1;
			await waitForPiboProviderRecovery(recoveryAttempt, input.recovery, input.signal);
			continue;
		}

		return response.content
			.filter((content): content is { type: "text"; text: string } => content.type === "text")
			.map((content) => content.text)
			.join("\n");
	}
}

function computeFileLists(fileOps: PiboCompactionPreparation["fileOps"]): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.written, ...fileOps.edited]);
	const readFiles = [...fileOps.read].filter((path) => !modified.has(path)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles, modifiedFiles };
}

function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	if (modifiedFiles.length > 0) sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	return sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";
}

async function generatePiboCompaction(input: {
	preparation: PiboCompactionPreparation;
	spec: PiboCompactionPromptSpec;
	model: Model<any>;
	apiKey: string;
	headers?: Record<string, string>;
	customInstructions?: string;
	signal?: AbortSignal;
	thinkingLevel?: ThinkingLevel;
	transport?: Transport;
	sessionId?: string;
	timeoutMs?: number;
	websocketConnectTimeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	recovery: PiboProviderRecoverySettings;
}): Promise<CompactionResult> {
	const { preparation, spec } = input;
	const completionDefaults = {
		model: input.model,
		systemPrompt: spec.systemPrompt,
		apiKey: input.apiKey,
		headers: input.headers,
		signal: input.signal,
		thinkingLevel: input.thinkingLevel,
		transport: input.transport,
		sessionId: input.sessionId,
		timeoutMs: input.timeoutMs,
		websocketConnectTimeoutMs: input.websocketConnectTimeoutMs,
		maxRetries: input.maxRetries,
		maxRetryDelayMs: input.maxRetryDelayMs,
		recovery: input.recovery,
	};
	let summary: string;

	if (preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0) {
		const [historySummary, turnPrefixSummary] = await Promise.all([
			preparation.messagesToSummarize.length > 0
				? completePiboCompactionSummary({
						...completionDefaults,
						promptText: buildSummaryPrompt(
							spec,
							preparation.messagesToSummarize,
							input.customInstructions,
							preparation.previousSummary,
						),
						maxTokens: Math.floor(0.8 * preparation.settings.reserveTokens),
					})
				: Promise.resolve("No prior history."),
			completePiboCompactionSummary({
				...completionDefaults,
				promptText: buildTurnPrefixPrompt(spec, preparation.turnPrefixMessages),
				maxTokens: Math.floor(0.5 * preparation.settings.reserveTokens),
			}),
		]);
		summary = `${historySummary}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixSummary}`;
	} else {
		summary = await completePiboCompactionSummary({
			...completionDefaults,
			promptText: buildSummaryPrompt(
				spec,
				preparation.messagesToSummarize,
				input.customInstructions,
				preparation.previousSummary,
			),
			maxTokens: Math.floor(0.8 * preparation.settings.reserveTokens),
		});
	}

	const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	return {
		summary,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
		details: { readFiles, modifiedFiles },
	};
}

export function createPiboCompactionPromptExtension(
	options: { getSettingsManager?: () => SettingsManager | undefined } = {},
): ExtensionFactory {
	return (pi) => {
		pi.on("session_before_compact", async (event, ctx) => {
			if (!ctx.model) return undefined;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok || !auth.apiKey) return undefined;
			const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
			const settingsManager = options.getSettingsManager?.();
			const providerRetry = settingsManager?.getProviderRetrySettings();
			return {
				compaction: await generatePiboCompaction({
					preparation: event.preparation,
					spec: await readActivePiboCompactionPromptSpec(ctx.cwd),
					model: ctx.model,
					apiKey: auth.apiKey,
					headers: auth.headers,
					customInstructions: event.customInstructions,
					signal: event.signal,
					thinkingLevel: sessionContext.thinkingLevel as ThinkingLevel,
					transport: settingsManager?.getTransport(),
					sessionId: ctx.sessionManager.getSessionId(),
					timeoutMs: settingsManager?.getHttpIdleTimeoutMs(),
					websocketConnectTimeoutMs: settingsManager?.getWebSocketConnectTimeoutMs(),
					maxRetries: providerRetry?.maxRetries,
					maxRetryDelayMs: providerRetry?.maxRetryDelayMs,
					recovery: resolvePiboProviderRecoverySettings(settingsManager),
				}),
			};
		});
	};
}
