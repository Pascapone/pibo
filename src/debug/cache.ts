import { cacheUsageWarningText, type CacheUsageObservation } from "../shared/cache-observability.js";
import {
	compareInferenceCompletion,
	modelInferenceCacheReadRatio,
	modelInferenceCachedInputTokens,
	modelInferenceInputTokens,
	modelInferenceUncachedInputTokens,
	type ModelInferenceRecord,
} from "../shared/model-inference-metrics.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { inspectDebugTrace } from "./trace.js";
import { formatNextCommands } from "./next-commands.js";

export type DebugCacheInferenceRow = {
	id: string;
	nodeId: string;
	nodeTitle: string;
	completedAt?: string;
	inputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	uncachedInputTokens?: number;
	cacheReadRatio?: number;
	previousCacheReadRatio?: number;
	elapsedMs?: number;
	cacheState: CacheUsageObservation["cacheState"];
	warning: CacheUsageObservation["warning"];
	warningText?: string;
	explanation: CacheUsageObservation["explanation"];
};

export type DebugCacheResult = {
	piboSessionId: string;
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	source: "provider-reported-usage";
	summary: {
		inferenceCount: number;
		cacheReadReportedCount: number;
		cacheReadUnreportedCount: number;
		possibleDropCount: number;
		inputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		uncachedInputTokens?: number;
		cacheReadRatio?: number;
	};
	inferences: DebugCacheInferenceRow[];
	limitations: string[];
	nextCommands: string[];
};

type LocatedInference = { nodeId: string; nodeTitle: string; record: ModelInferenceRecord };

function finiteToken(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

export async function inspectDebugCache(
	piboSessionId: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	options: { limit?: number } = {},
): Promise<DebugCacheResult> {
	const trace = await inspectDebugTrace(piboSessionId, stores);
	const byId = new Map<string, LocatedInference>();
	for (const node of trace.nodes) {
		for (const record of node.modelInferences ?? []) byId.set(record.id, { nodeId: node.id, nodeTitle: node.title, record });
	}
	const located = [...byId.values()].sort((left, right) => compareInferenceCompletion(left.record, right.record));
	let reportedInput = 0;
	let reportedRead = 0;
	let reportedCount = 0;
	let unreportedCount = 0;
	let writeTotal = 0;
	let writeReported = false;
	let possibleDropCount = 0;
	for (const { record } of located) {
		const input = modelInferenceInputTokens(record.metrics);
		const read = modelInferenceCachedInputTokens(record.metrics);
		if (input !== undefined && input > 0 && read !== undefined && read <= input) {
			reportedInput += input;
			reportedRead += read;
			reportedCount++;
		} else {
			unreportedCount++;
		}
		const write = finiteToken(record.metrics.cacheWriteTokens);
		if (write !== undefined) { writeTotal += write; writeReported = true; }
		if (record.cacheObservation?.warning === "possible-cache-read-drop") possibleDropCount++;
	}
	const limit = options.limit ?? 20;
	const selected = located.slice(Math.max(0, located.length - limit));
	return {
		piboSessionId,
		runtimeInstanceId: trace.runtimeInstanceId,
		runtimeAdapterId: trace.runtimeAdapterId,
		source: "provider-reported-usage",
		summary: {
			inferenceCount: located.length,
			cacheReadReportedCount: reportedCount,
			cacheReadUnreportedCount: unreportedCount,
			possibleDropCount,
			...(reportedCount ? {
				inputTokens: reportedInput,
				cacheReadTokens: reportedRead,
				uncachedInputTokens: reportedInput - reportedRead,
				cacheReadRatio: reportedRead / reportedInput,
			} : {}),
			...(writeReported ? { cacheWriteTokens: writeTotal } : {}),
		},
		inferences: selected.map(({ nodeId, nodeTitle, record }) => ({
			id: record.id,
			nodeId,
			nodeTitle,
			completedAt: record.completedAt,
			inputTokens: modelInferenceInputTokens(record.metrics),
			cacheReadTokens: modelInferenceCachedInputTokens(record.metrics),
			cacheWriteTokens: finiteToken(record.metrics.cacheWriteTokens),
			uncachedInputTokens: modelInferenceUncachedInputTokens(record.metrics),
			cacheReadRatio: modelInferenceCacheReadRatio(record.metrics),
			previousCacheReadRatio: record.cacheObservation?.previousCacheReadRatio,
			elapsedMs: record.cacheObservation?.elapsedMs,
			cacheState: record.cacheObservation?.cacheState ?? "unknown",
			warning: record.cacheObservation?.warning ?? "none",
			warningText: record.cacheObservation ? cacheUsageWarningText(record.cacheObservation) : undefined,
			explanation: record.cacheObservation?.explanation ?? "insufficient-data",
		})),
		limitations: [
			"Cache counters are reported by the runtime or provider; missing counters remain unknown.",
			"A cache-read drop does not identify whether Pibo, the runtime, the provider, or eviction caused it.",
			"This command does not inspect or alter runtime source code, prompts, or provider cache keys.",
		],
		nextCommands: [
			`pibo debug trace ${piboSessionId} --medium`,
			`pibo debug events ${piboSessionId} --type assistant_usage --fields inputTokens,cacheReadTokens,cacheWriteTokens,totalTokens`,
		],
	};
}

function metric(value: number | undefined): string {
	return value === undefined ? "unknown" : String(value);
}

function ratio(value: number | undefined): string {
	return value === undefined ? "unknown" : `${(value * 100).toFixed(1)}%`;
}

export function formatDebugCache(result: DebugCacheResult): string {
	const lines = [
		`piboSessionId: ${result.piboSessionId}`,
		...(result.runtimeInstanceId ? [`runtimeInstanceId: ${result.runtimeInstanceId}`] : []),
		...(result.runtimeAdapterId ? [`runtimeAdapterId: ${result.runtimeAdapterId}`] : []),
		`source: ${result.source}`,
		`inferences: ${result.summary.inferenceCount}`,
		`cacheReadReported: ${result.summary.cacheReadReportedCount}`,
		`cacheReadUnreported: ${result.summary.cacheReadUnreportedCount}`,
		`possibleDrops: ${result.summary.possibleDropCount}`,
		`inputTokens: ${metric(result.summary.inputTokens)}`,
		`cacheReadTokens: ${metric(result.summary.cacheReadTokens)}`,
		`uncachedInputTokens: ${metric(result.summary.uncachedInputTokens)}`,
		`cacheWriteTokens: ${metric(result.summary.cacheWriteTokens)}`,
		`cacheReadRatio: ${ratio(result.summary.cacheReadRatio)}`,
		"",
	];
	if (result.inferences.length) {
		lines.push("completedAt\tstate\tinput\tcacheRead\tuncached\tcacheWrite\tratio\tid\tnode");
		for (const inference of result.inferences) {
			lines.push([
				inference.completedAt ?? "unknown",
				inference.cacheState,
				metric(inference.inputTokens),
				metric(inference.cacheReadTokens),
				metric(inference.uncachedInputTokens),
				metric(inference.cacheWriteTokens),
				ratio(inference.cacheReadRatio),
				inference.id,
				inference.nodeTitle,
			].join("\t"));
		}
	}
	for (const inference of result.inferences) {
		if (inference.warningText) lines.push(`cache-warning\t${inference.id}\t${inference.warningText}`);
	}
	lines.push("", "Limitations:", ...result.limitations.map((item) => `- ${item}`));
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}
