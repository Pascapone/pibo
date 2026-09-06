import { createRequire } from "node:module";
import type { Tiktoken } from "tiktoken";
import {
	DEFAULT_TOOL_METRIC_TOKEN_CALCULATION,
	sanitizeToolMetricTokenCalculation,
	toolMetricTokenBasis,
	type TiktokenEncoding,
	type ToolMetricTokenBasis,
	type ToolMetricTokenCalculation,
} from "./tool-call-token-settings.js";

export type ToolCallMetrics = {
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	/** Payload-size calculation, not provider usage or billing. */
	tokenBasis: ToolMetricTokenBasis;
};

export const MAX_TIKTOKEN_PAYLOAD_CHARACTERS = 4_000_000;

const require = createRequire(import.meta.url);
let activeTokenizer: { encoding: TiktokenEncoding; tokenizer: Tiktoken } | undefined;

/** Bounded structural walk; character mode never tokenizes, copies, or scans large strings. */
export function measureToolPayloadCharacters(payload: unknown): number | undefined {
	let budget = 10_000;
	const seen = new WeakSet<object>();
	function size(value: unknown, depth: number): number {
		if (--budget < 0 || depth > 64) return NaN;
		if (typeof value === "string") return value.length;
		if (value === null) return 4;
		if (typeof value === "boolean") return value ? 4 : 5;
		if (typeof value === "number") return String(value).length;
		if (typeof value !== "object" || seen.has(value)) return NaN;
		seen.add(value);
		let chars = 2;
		if (Array.isArray(value)) {
			for (const item of value) {
				chars += size(item, depth + 1) + 1;
				if (!Number.isFinite(chars)) return NaN;
			}
		} else {
			const record = value as Record<string, unknown>;
			if (["image", "audio", "document", "resource", "image_url"].includes(String(record.type))) return NaN;
			for (const key in record) {
				if (--budget < 0) return NaN;
				if (!Object.hasOwn(record, key) || record[key] === undefined) continue;
				chars += key.length + 3 + size(record[key], depth + 1) + 1;
				if (!Number.isFinite(chars)) return NaN;
			}
		}
		seen.delete(value);
		return chars;
	}
	try {
		const chars = size(payload, 0);
		return Number.isFinite(chars) ? chars : undefined;
	} catch {
		return undefined;
	}
}

export function estimateToolPayloadTokens(
	payload: unknown,
	calculation: ToolMetricTokenCalculation = DEFAULT_TOOL_METRIC_TOKEN_CALCULATION,
): number | undefined {
	try {
		const normalized = sanitizeToolMetricTokenCalculation(calculation);
		if (normalized.method === "characters") {
			const chars = measureToolPayloadCharacters(payload);
			if (chars === undefined) return undefined;
			const tokens = Math.ceil(chars / normalized.factor);
			return Number.isSafeInteger(tokens) ? tokens : undefined;
		}
		const text = serializableToolPayloadText(payload);
		if (text === undefined) return undefined;
		return tiktokenPayloadTokens(text, normalized.encoding);
	} catch {
		// Diagnostics must not turn an otherwise successful tool into a failure.
		return undefined;
	}
}

export class ToolCallMetricsCollector {
	private readonly active = new Map<string, {
		startedAt: number;
		inputTokens?: number;
		calculation: ToolMetricTokenCalculation;
	}>();

	constructor(
		private readonly getCalculation: () => ToolMetricTokenCalculation = () => DEFAULT_TOOL_METRIC_TOKEN_CALCULATION,
	) {}

	start(id: string, args: unknown, now = performance.now()): void {
		if (this.active.has(id)) return;
		const calculation = this.currentCalculation();
		this.active.set(id, {
			startedAt: now,
			inputTokens: estimateToolPayloadTokens(args, calculation),
			calculation,
		});
	}

	finish(id: string, result: unknown, now = performance.now()): ToolCallMetrics {
		const started = this.active.get(id);
		this.active.delete(id);
		const calculation = started?.calculation ?? this.currentCalculation();
		// Harness result metadata is not model-visible tool output.
		const output = result && typeof result === "object" && "content" in result
			? result.content : result;
		return {
			tokenBasis: toolMetricTokenBasis(calculation),
			durationMs: started ? Math.max(0, now - started.startedAt) : undefined,
			inputTokens: started?.inputTokens,
			outputTokens: estimateToolPayloadTokens(output, calculation),
		};
	}

	clear(): void {
		this.active.clear();
	}

	private currentCalculation(): ToolMetricTokenCalculation {
		try {
			return sanitizeToolMetricTokenCalculation(this.getCalculation());
		} catch {
			return DEFAULT_TOOL_METRIC_TOKEN_CALCULATION;
		}
	}
}

function serializableToolPayloadText(payload: unknown): string | undefined {
	const measuredCharacters = measureToolPayloadCharacters(payload);
	if (measuredCharacters === undefined || measuredCharacters > MAX_TIKTOKEN_PAYLOAD_CHARACTERS) return undefined;
	if (typeof payload === "string") return payload;
	const serialized = JSON.stringify(payload);
	return typeof serialized === "string" && serialized.length <= MAX_TIKTOKEN_PAYLOAD_CHARACTERS
		? serialized
		: undefined;
}

function tiktokenPayloadTokens(text: string, encoding: TiktokenEncoding): number | undefined {
	if (activeTokenizer?.encoding !== encoding) {
		activeTokenizer?.tokenizer.free();
		const tiktoken = require("tiktoken") as typeof import("tiktoken");
		activeTokenizer = { encoding, tokenizer: tiktoken.get_encoding(encoding) };
	}
	const tokens = activeTokenizer.tokenizer.encode_ordinary(text).length;
	return Number.isSafeInteger(tokens) ? tokens : undefined;
}
