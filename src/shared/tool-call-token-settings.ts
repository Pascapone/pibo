export const TIKTOKEN_ENCODINGS = [
	"o200k_base",
	"cl100k_base",
	"p50k_base",
	"r50k_base",
	"p50k_edit",
	"gpt2",
] as const;

export type TiktokenEncoding = (typeof TIKTOKEN_ENCODINGS)[number];

export type ToolMetricTokenCalculation =
	| { method: "characters"; factor: number }
	| { method: "tiktoken"; encoding: TiktokenEncoding };

export type ToolMetricTokenBasis =
	| "chars/4"
	| `characters/${number}`
	| `tiktoken/${TiktokenEncoding}`;

export const DEFAULT_TOOL_METRIC_TOKEN_CALCULATION: ToolMetricTokenCalculation = {
	method: "characters",
	factor: 4,
};

export function parseToolMetricTokenCalculation(value: unknown): ToolMetricTokenCalculation | undefined {
	if (!isRecord(value)) return undefined;
	if (value.method === "characters") {
		return typeof value.factor === "number" && Number.isFinite(value.factor) && value.factor > 0
			? { method: "characters", factor: value.factor }
			: undefined;
	}
	if (value.method === "tiktoken" && typeof value.encoding === "string" && TIKTOKEN_ENCODINGS.includes(value.encoding as TiktokenEncoding)) {
		return { method: "tiktoken", encoding: value.encoding as TiktokenEncoding };
	}
	return undefined;
}

export function sanitizeToolMetricTokenCalculation(value: unknown): ToolMetricTokenCalculation {
	return parseToolMetricTokenCalculation(value) ?? DEFAULT_TOOL_METRIC_TOKEN_CALCULATION;
}

export function toolMetricTokenBasis(calculation: ToolMetricTokenCalculation): ToolMetricTokenBasis {
	return calculation.method === "characters"
		? `characters/${calculation.factor}`
		: `tiktoken/${calculation.encoding}`;
}

export function toolMetricTokenBasisLabel(basis: ToolMetricTokenBasis | undefined): string {
	if (!basis) return "—";
	if (basis === "chars/4") return "chars ÷ 4";
	if (basis.startsWith("characters/")) return `chars ÷ ${basis.slice("characters/".length)}`;
	return `tiktoken · ${basis.slice("tiktoken/".length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
