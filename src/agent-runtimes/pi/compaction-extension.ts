import { randomUUID } from "node:crypto";
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
	readActivePiboCompactionPromptSpec,
	type PiboCompactionPromptSpec,
} from "../../core/compaction-prompt.js";
import {
	resolvePiboProviderRecoverySettings,
	waitForPiboProviderRecovery,
	type PiboProviderRecoverySettings,
} from "../../core/provider-recovery.js";

import { isRetryablePiboAssistantError, isRetryablePiboProviderError } from "./retryable.js";

type PiboCompactionPreparation = SessionBeforeCompactEvent["preparation"];

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
					headers: auth.headers
						? Object.fromEntries(Object.entries(auth.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
						: undefined,
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
