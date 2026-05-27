import type { PiboJsonObject } from "../core/events.js";

export type TelemetryCaptureMode = "metadata_only" | "bounded_preview" | "disabled";

export type TelemetryPreviewUnavailableResult = {
	status: "unavailable" | "disabled";
	reason: "preview_capture_disabled" | "preview_not_found" | "telemetry_unavailable";
	captureMode: TelemetryCaptureMode;
	message: string;
};

export type TelemetryBoundedPreview = {
	text: string;
	byteSize: number;
	maxBytes: number;
	truncated: boolean;
	contentType: string;
	valueKind: "json" | "headers" | "text" | "tool_args" | "unknown";
	volumeControlled: true;
};

export type TelemetryPreviewInput = {
	value: unknown;
	maxBytes?: number;
	hardMaxBytes?: number;
	contentType?: string;
	valueKind?: TelemetryBoundedPreview["valueKind"];
};

const DEFAULT_PREVIEW_MAX_BYTES = 2048;
const HARD_PREVIEW_MAX_BYTES = 16 * 1024;

export function createTelemetryBoundedPreview(input: TelemetryPreviewInput): TelemetryBoundedPreview {
	const hardMaxBytes = clampLimit(input.hardMaxBytes ?? HARD_PREVIEW_MAX_BYTES, 1, HARD_PREVIEW_MAX_BYTES);
	const maxBytes = clampLimit(input.maxBytes ?? DEFAULT_PREVIEW_MAX_BYTES, 1, hardMaxBytes);
	const text = stringifyPreviewValue(input.value, input.valueKind);
	const buffer = Buffer.from(text, "utf8");
	const truncated = buffer.byteLength > maxBytes;
	return {
		text: truncated ? truncateUtf8(text, maxBytes) : text,
		byteSize: buffer.byteLength,
		maxBytes,
		truncated,
		contentType: input.contentType ?? (input.valueKind === "json" || typeof input.value === "object" ? "application/json" : "text/plain"),
		valueKind: input.valueKind ?? inferPreviewKind(input.value),
		volumeControlled: true,
	};
}

export function telemetrySafeJsonObject(value: unknown, allowedKeys?: readonly string[]): PiboJsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const allowed = allowedKeys ? new Set(allowedKeys) : undefined;
	const output: PiboJsonObject = {};
	for (const [key, raw] of Object.entries(value)) {
		if (allowed && !allowed.has(key)) continue;
		if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) output[key] = raw;
	}
	return output;
}

export function telemetrySafeTopLevelKeys(value: unknown, limit = 50): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value).filter((key) => key.length <= 128).slice(0, clampLimit(limit, 0, 200));
}

function stringifyPreviewValue(value: unknown, valueKind?: TelemetryBoundedPreview["valueKind"]): string {
	if (typeof value === "string") return value;
	if (valueKind === "headers" && value && typeof value === "object" && !Array.isArray(value)) {
		return Object.entries(value).map(([key, raw]) => `${key}: ${typeof raw === "string" ? raw : String(raw)}`).join("\n");
	}
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

function truncateUtf8(text: string, maxBytes: number): string {
	let truncated = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
	while (Buffer.byteLength(truncated, "utf8") > maxBytes) truncated = truncated.slice(0, -1);
	return truncated;
}

function inferPreviewKind(value: unknown): TelemetryBoundedPreview["valueKind"] {
	if (typeof value === "string") return "text";
	if (value && typeof value === "object") return "json";
	return "unknown";
}

function clampLimit(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}
