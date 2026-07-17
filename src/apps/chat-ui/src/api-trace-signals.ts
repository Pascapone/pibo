import { requestJson } from "./api-http";
import type {
	PiboSessionTraceSummary,
	PiboSessionTraceView,
	PiboSignalPatch,
	PiboSignalSnapshot,
	PiboSignalStatusPatch,
	PiboSignalStatusSnapshot,
	TracePayloadChunk,
	TraceRawEventsPage,
	TraceTimelinePage,
} from "./types";

export async function getTraceSummary(piboSessionId: string, knownVersion?: string, init?: RequestInit): Promise<{ summary?: PiboSessionTraceSummary; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	const response = await fetch(`/api/chat/trace/summary?${params.toString()}`, {
		headers: knownVersion ? { "if-none-match": toEtag(knownVersion) } : undefined,
		signal: init?.signal,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		summary: payload as PiboSessionTraceSummary,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceSummary).version,
	};
}

export async function getTrace(
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number; eventLimit?: number; beforeSequence?: number; pageSize?: number; knownVersion?: string; signal?: AbortSignal } = {},
): Promise<{ trace?: PiboSessionTraceView; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.includeRawEvents) params.set("includeRawEvents", "true");
	if (options.rawEventsLimit) params.set("rawEventsLimit", String(options.rawEventsLimit));
	if (options.pageSize) params.set("pageSize", String(options.pageSize));
	if (options.beforeSequence !== undefined) params.set("beforeSequence", String(options.beforeSequence));
	else if (options.eventLimit) params.set("eventLimit", String(options.eventLimit));
	const response = await fetch(`/api/chat/trace?${params.toString()}`, {
		headers: options.knownVersion ? { "if-none-match": toEtag(options.knownVersion) } : undefined,
		signal: options.signal,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? options.knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		trace: payload as PiboSessionTraceView,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceView).version,
	};
}

export async function getTraceTimeline(
	piboSessionId: string,
	options: { limit?: number; beforeSequence?: number; beforeCursor?: string | number; knownVersion?: string; signal?: AbortSignal } = {},
): Promise<{ timeline?: TraceTimelinePage; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.limit) params.set("limit", String(options.limit));
	if (options.beforeCursor !== undefined) params.set("before", String(options.beforeCursor));
	else if (options.beforeSequence !== undefined) params.set("before", String(options.beforeSequence));
	const response = await fetch(`/api/chat/trace/timeline?${params.toString()}`, {
		headers: options.knownVersion ? { "if-none-match": toEtag(options.knownVersion) } : undefined,
		signal: options.signal,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? options.knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		timeline: payload as TraceTimelinePage,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as TraceTimelinePage).version,
	};
}

export async function getTraceRawEvents(
	piboSessionId: string,
	options: { limit?: number; beforeSequence?: number; signal?: AbortSignal } = {},
): Promise<TraceRawEventsPage> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.limit) params.set("limit", String(options.limit));
	if (options.beforeSequence !== undefined) params.set("before", String(options.beforeSequence));
	return requestJson<TraceRawEventsPage>(`/api/chat/trace/raw-events?${params.toString()}`, { signal: options.signal });
}

export async function getTracePayload(ref: string, options: { offset?: number; limit?: number } = {}): Promise<TracePayloadChunk> {
	const params = new URLSearchParams();
	if (options.offset !== undefined) params.set("offset", String(options.offset));
	if (options.limit !== undefined) params.set("limit", String(options.limit));
	const suffix = params.toString();
	return requestJson<TracePayloadChunk>(`/api/chat/trace/payload/${encodeURIComponent(ref)}${suffix ? `?${suffix}` : ""}`);
}

export async function fetchSessionSignals(piboSessionId: string, init?: RequestInit): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/session/${encodeURIComponent(piboSessionId)}`, init);
}

export async function fetchSignalTree(piboSessionId: string, init?: RequestInit): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/tree/${encodeURIComponent(piboSessionId)}`, init);
}

export async function fetchSignalStatuses(init?: RequestInit): Promise<PiboSignalStatusSnapshot> {
	return requestJson<PiboSignalStatusSnapshot>("/api/chat/signals/statuses", init);
}

export function subscribeSignalStatuses(
	handlers: {
		onSnapshot?: (snapshot: PiboSignalStatusSnapshot) => void;
		onPatch?: (patch: PiboSignalStatusPatch) => void;
		onError?: (event: Event) => void;
	},
): () => void {
	const events = new EventSource("/api/chat/signals/status-events");
	events.addEventListener("signal_status_snapshot", (message) => handlers.onSnapshot?.(JSON.parse((message as MessageEvent).data) as PiboSignalStatusSnapshot));
	events.addEventListener("signal_status_patch", (message) => handlers.onPatch?.(JSON.parse((message as MessageEvent).data) as PiboSignalStatusPatch));
	events.onerror = (event) => handlers.onError?.(event);
	return () => events.close();
}

export function subscribeSignalTree(
	rootPiboSessionId: string,
	handlers: {
		onSnapshot?: (snapshot: PiboSignalSnapshot) => void;
		onPatch?: (patch: PiboSignalPatch) => void;
		onError?: (event: Event) => void;
	},
): () => void {
	const params = new URLSearchParams({ rootPiboSessionId });
	const events = new EventSource(`/api/chat/signals/events?${params.toString()}`);
	events.addEventListener("signal_snapshot", (message) => handlers.onSnapshot?.(JSON.parse((message as MessageEvent).data) as PiboSignalSnapshot));
	events.addEventListener("signal_patch", (message) => handlers.onPatch?.(JSON.parse((message as MessageEvent).data) as PiboSignalPatch));
	events.onerror = (event) => handlers.onError?.(event);
	return () => events.close();
}

function toEtag(version: string): string {
	return `"${version}"`;
}

function fromEtag(value: string | null): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (trimmed.startsWith("W/")) return fromEtag(trimmed.slice(2));
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
	return trimmed;
}
