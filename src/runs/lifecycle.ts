export type PiboRunTimeoutPhase = "startup" | "lifetime";

export class PiboRunExecutionTimeoutError extends Error {
	constructor(message: string, readonly timeoutPhase: PiboRunTimeoutPhase) {
		super(message);
		this.name = "PiboRunExecutionTimeoutError";
	}
}

export class PiboRunCancellationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "PiboRunCancellationError";
	}
}

export class PiboRunCancelledError extends Error {
	constructor(message = "Yielded run was cancelled.", options?: ErrorOptions) {
		super(message, options);
		this.name = "PiboRunCancelledError";
	}
}

export function resolveRunTimeoutMs(toolName: string, params: unknown): number | undefined {
	if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
	const input = params as Record<string, unknown>;
	if (typeof input.timeoutMs === "number") return normalizePositiveTimeout(input.timeoutMs, "arguments.timeoutMs");
	if (toolName === "bash" && typeof input.timeout === "number") return normalizePositiveTimeout(input.timeout * 1000, "arguments.timeout");
	return undefined;
}

export function foregroundServiceWarning(toolName: string, params: unknown, timeoutMs: number | undefined): string | undefined {
	if (toolName !== "bash" || timeoutMs === undefined || !params || typeof params !== "object" || Array.isArray(params)) return undefined;
	const command = typeof (params as Record<string, unknown>).command === "string" ? String((params as Record<string, unknown>).command) : "";
	if (!isKnownForegroundServiceCommand(command)) return undefined;
	return `Known long-lived service command is running in a finite yielded run (${timeoutMs}ms). It can start successfully and later end as timed_out. Use the managed gateway CLI, or launch a detached/background service with a separate bounded health check.`;
}

export function isConfiguredTimeoutError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const terminalLines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-5);
	return terminalLines.some((line) => {
		const normalized = line.replace(/^error:\s*/i, "");
		return /^(?:command|process|tool execution|yielded run)\s+timed?\s*out\b.*$/i.test(normalized)
			|| /^timed?\s*out(?:\s+after\s+.+)?[.!]?$/i.test(normalized)
			|| /^timeout(?:\s+error)?[.!]?$/i.test(normalized)
			|| /^timeout(?::|\s+)(?:occurred|expired|exceeded|elapsed|reached)\b.*$/i.test(normalized)
			|| /^timeout(?::|\s+)(?:after\s+)?\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b.*$/i.test(normalized);
	});
}

export function hasMeaningfulTimeoutOutput(value: unknown): boolean {
	const text = extractText(value);
	if (!text) return false;
	return text.split(/\r?\n/).some((line) => {
		const trimmed = line.trim();
		return !!trimmed && !/(?:timed?\s*out|timeout|command exited with code|process exited with code)/i.test(trimmed);
	});
}

function isKnownForegroundServiceCommand(command: string): boolean {
	return /(?:^|[;&|]\s*|\b)(?:pibo\s+gateway(?::web|\s+web|\s+dev)?(?:\s|$)|node\s+[^\n]*pibo(?:\.js)?\s+gateway:web(?:\s|$)|(?:\.\/)?(?:scripts\/)?docker-entrypoint\.sh\s+gateway:web(?:\s|$)|npm\s+(?:run\s+)?gateway(?::web)?(?:\s|$)|(?:npm\s+run\s+)?(?:dev|start)\s+--[^\n]*\bgateway(?::web)?\b|vite(?:\s|$))/i.test(command);
}

function normalizePositiveTimeout(value: number, field: string): number {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be a positive number`);
	return Math.max(1, Math.round(value));
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return "";
	const candidate = value as { content?: unknown; text?: unknown };
	if (typeof candidate.text === "string") return candidate.text;
	if (!Array.isArray(candidate.content)) return "";
	return candidate.content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? String((part as { text: string }).text) : "").filter(Boolean).join("\n");
}
