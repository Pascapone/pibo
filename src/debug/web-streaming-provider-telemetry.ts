import { resolveDebugStore } from "./stores.js";
import { inspectTelemetryProvider, inspectTelemetryProviderEvents, inspectTelemetrySession, inspectTelemetryTurn } from "./telemetry.js";
import type { NumberStats, StreamingBenchmarkProviderTelemetry } from "./web-streaming-types.js";

type ProviderTelemetryBrowserClient = {
	evaluate<T>(expression: string, timeoutMs?: number): Promise<T>;
};

export function summarizeStreamingProviderTelemetry(input: { request: Record<string, unknown>; events: Array<Record<string, unknown>>; providerRequestId?: string; truncated?: boolean; eventPageCount?: number }): StreamingBenchmarkProviderTelemetry {
	const request = input.request;
	const startedAt = stringField(request, "startedAt");
	const textEvents = input.events.filter(isProviderTextDeltaEvent);
	const reasoningEvents = input.events.filter(isProviderReasoningDeltaEvent);
	const textReceivedAt = textEvents.map((event) => stringField(event, "receivedAt")).filter((value): value is string => Boolean(value));
	const reasoningReceivedAt = reasoningEvents.map((event) => stringField(event, "receivedAt")).filter((value): value is string => Boolean(value));
	return {
		requested: true,
		available: true,
		providerRequestId: input.providerRequestId ?? stringField(request, "providerRequestId") ?? "unknown",
		piboSessionId: stringField(request, "piboSessionId"),
		turnId: stringField(request, "turnId"),
		provider: stringField(request, "provider"),
		api: stringField(request, "api"),
		model: stringField(request, "model"),
		transport: stringField(request, "transport"),
		status: stringField(request, "status"),
		startedAt,
		completedAt: stringField(request, "completedAt"),
		httpStatus: optionalNumberField(request, "httpStatus"),
		upstreamResponseId: stringField(request, "upstreamResponseId"),
		rawEventCount: optionalNumberField(request, "rawEventCount"),
		normalizedEventCount: optionalNumberField(request, "normalizedEventCount"),
		parseErrorCount: optionalNumberField(request, "parseErrorCount"),
		unknownEventCount: optionalNumberField(request, "unknownEventCount"),
		firstByteLatencyMs: durationBetweenMs(startedAt, stringField(request, "firstByteAt")),
		firstTextLatencyMs: durationBetweenMs(startedAt, textReceivedAt[0]),
		firstReasoningLatencyMs: durationBetweenMs(startedAt, reasoningReceivedAt[0]),
		eventTypeCounts: recordField(request, "eventTypeCounts"),
		textDeltaCount: textEvents.length,
		reasoningDeltaCount: reasoningEvents.length,
		textDeltaBytes: numericStats(textEvents.map(providerDeltaBytes)),
		reasoningDeltaBytes: numericStats(reasoningEvents.map(providerDeltaBytes)),
		textDeltaGapsMs: numericStats(gapsBetweenIso(textReceivedAt)),
		reasoningDeltaGapsMs: numericStats(gapsBetweenIso(reasoningReceivedAt)),
		eventPageCount: input.eventPageCount ?? 1,
		truncated: input.truncated === true,
	};
}

export async function collectStreamingProviderTelemetryFromSelectedBrowserSession(client: ProviderTelemetryBrowserClient): Promise<StreamingBenchmarkProviderTelemetry> {
	const selected = await client.evaluate<{ piboSessionId?: string }>(`(() => ({
  piboSessionId: document.querySelector('[data-pibo-debug="chat-shell"]')?.getAttribute('data-pibo-session-id')
    || document.querySelector('[data-pibo-selected-session-id]')?.getAttribute('data-pibo-selected-session-id')
    || undefined,
}))()`, 5_000).catch(() => ({}));
	const piboSessionId = isRecord(selected) && typeof selected.piboSessionId === "string" ? selected.piboSessionId : undefined;
	if (!piboSessionId) return unavailableStreamingProviderTelemetry("selected-session", "No selected Chat session was found in the current browser target.");
	return collectStreamingProviderTelemetryFromSession(piboSessionId);
}

export function collectStreamingProviderTelemetry(providerRequestId: string, store = resolveDebugStore("pibo-data")): StreamingBenchmarkProviderTelemetry {
	const provider = inspectTelemetryProvider(store, providerRequestId);
	if (!provider.available) return unavailableStreamingProviderTelemetry(providerRequestId, provider.message);
	const events: Array<Record<string, unknown>> = [];
	let after: string | undefined;
	let pageCount = 0;
	let truncated = false;
	for (;;) {
		const page = inspectTelemetryProviderEvents(store, providerRequestId, { limit: "200", after });
		if (!page.available) return unavailableStreamingProviderTelemetry(providerRequestId, page.message);
		pageCount += 1;
		events.push(...(page.rows as Array<Record<string, unknown>>));
		if (!page.page.hasMore || page.page.nextAfterSequence === undefined) break;
		if (pageCount >= 50) {
			truncated = true;
			break;
		}
		after = String(page.page.nextAfterSequence);
	}
	return summarizeStreamingProviderTelemetry({ request: provider.request as unknown as Record<string, unknown>, events, providerRequestId, truncated, eventPageCount: pageCount });
}

export function collectStreamingProviderTelemetryFromSession(piboSessionId: string): StreamingBenchmarkProviderTelemetry {
	const store = resolveDebugStore("pibo-data");
	const session = inspectTelemetrySession(store, piboSessionId, { limit: "20" });
	if (!session.available) return unavailableStreamingProviderTelemetry(`session:${piboSessionId}`, session.message);
	const directProviderRequestId = latestProviderRequestId(session.detail.providerRequests);
	if (directProviderRequestId) return collectStreamingProviderTelemetry(directProviderRequestId, store);
	for (const turn of session.detail.recentTurns) {
		const timeline = inspectTelemetryTurn(store, turn.turnId, { limit: "20" });
		if (!timeline.available) continue;
		const providerRequestId = latestProviderRequestId(timeline.timeline.providerRequests);
		if (providerRequestId) return collectStreamingProviderTelemetry(providerRequestId, store);
	}
	return unavailableStreamingProviderTelemetry(`session:${piboSessionId}`, `No provider request found for Pibo Session ${piboSessionId}.`);
}

export function collectStreamingProviderTelemetryFromTurn(turnIdOrEventId: string): StreamingBenchmarkProviderTelemetry {
	const store = resolveDebugStore("pibo-data");
	const timeline = inspectTelemetryTurn(store, turnIdOrEventId, { limit: "20" });
	if (!timeline.available) return unavailableStreamingProviderTelemetry(`turn:${turnIdOrEventId}`, timeline.message);
	const providerRequestId = latestProviderRequestId(timeline.timeline.providerRequests);
	if (providerRequestId) return collectStreamingProviderTelemetry(providerRequestId, store);
	return unavailableStreamingProviderTelemetry(`turn:${turnIdOrEventId}`, `No provider request found for turn or event ${turnIdOrEventId}.`);
}

function latestProviderRequestId(providerRequests: readonly { providerRequestId?: string }[]): string | undefined {
	for (let index = providerRequests.length - 1; index >= 0; index--) {
		const providerRequestId = providerRequests[index]?.providerRequestId;
		if (providerRequestId) return providerRequestId;
	}
	return undefined;
}

function unavailableStreamingProviderTelemetry(providerRequestId: string, message: string): StreamingBenchmarkProviderTelemetry {
	return {
		requested: true,
		available: false,
		providerRequestId,
		textDeltaCount: 0,
		reasoningDeltaCount: 0,
		textDeltaBytes: numericStats([]),
		reasoningDeltaBytes: numericStats([]),
		textDeltaGapsMs: numericStats([]),
		reasoningDeltaGapsMs: numericStats([]),
		eventPageCount: 0,
		truncated: false,
		error: message,
	};
}

function isProviderTextDeltaEvent(event: Record<string, unknown>): boolean {
	return stringField(event, "normalizedType") === "assistant_delta" || stringField(event, "eventType") === "pi.text_delta";
}

function isProviderReasoningDeltaEvent(event: Record<string, unknown>): boolean {
	const normalizedType = stringField(event, "normalizedType");
	const eventType = stringField(event, "eventType") ?? "";
	return normalizedType === "thinking_delta" || eventType === "pi.thinking_delta" || (eventType.includes("reasoning") && eventType.includes("delta"));
}

function providerDeltaBytes(event: Record<string, unknown>): number | undefined {
	const safeFields = recordField(event, "safeFields");
	return optionalNumberField(safeFields, "deltaBytes") ?? optionalNumberField(safeFields, "contentBytes") ?? optionalNumberField(event, "byteSize");
}

function gapsBetweenIso(values: readonly string[]): number[] {
	const gaps: number[] = [];
	let previous: number | undefined;
	for (const value of values) {
		const current = Date.parse(value);
		if (!Number.isFinite(current)) continue;
		if (previous !== undefined) gaps.push(round3(current - previous));
		previous = current;
	}
	return gaps;
}

function durationBetweenMs(start?: string, end?: string): number | undefined {
	if (!start || !end) return undefined;
	const startMs = Date.parse(start);
	const endMs = Date.parse(end);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return undefined;
	return round3(endMs - startMs);
}

function stringField(value: unknown, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
	return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function optionalNumberField(value: unknown, key: string): number | undefined {
	return isRecord(value) && typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] : undefined;
}

function numericStats(values: readonly unknown[]): NumberStats {
	const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
	if (!nums.length) return { count: 0 };
	const pick = (quantile: number) => nums[Math.min(nums.length - 1, Math.floor((nums.length - 1) * quantile))] ?? nums[nums.length - 1] ?? 0;
	const avg = nums.reduce((total, value) => total + value, 0) / nums.length;
	return {
		count: nums.length,
		min: round3(nums[0]),
		p50: round3(pick(0.50)),
		p90: round3(pick(0.90)),
		p99: round3(pick(0.99)),
		max: round3(nums[nums.length - 1]),
		avg: round3(avg),
	};
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
