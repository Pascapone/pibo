type StreamingDebugWindow = Window & typeof globalThis & {
	__piboStreamingDebug?: StreamingDebugSnapshot;
	__piboStreamingDebugReset?: () => StreamingDebugSnapshot | undefined;
	__piboStreamingBenchmarkShouldDropOverlayEvent?: (event: StreamingDebugEvent) => boolean;
};

let streamingDebugEnabledCache: boolean | undefined;

export type StreamingDebugSnapshot = {
	enabled: true;
	startedAt: string;
	updatedAt: string;
	selectedPiboSessionId?: string;
	sessionIds: string[];
	liveOpenCount: number;
	liveErrorCount: number;
	eventCount: number;
	eventTypeCounts: Record<string, number>;
	textDeltaCount: number;
	textDeltaBytes: number;
	reasoningDeltaCount: number;
	reasoningDeltaBytes: number;
	enqueueCount: number;
	enqueueFlushImmediateCount: number;
	pendingEventCount: number;
	flushCount: number;
	flushedEventCount: number;
	overlayUpdateCount: number;
	overlayEventCount: number;
	traceRefreshScheduledCount: number;
	traceRefreshStartedCount: number;
	traceRefreshCompletedCount: number;
	traceRefreshFailedCount: number;
	traceRefreshDurationMsTotal: number;
	traceRefreshDurationMsLast?: number;
	traceRefreshDurationMsMax?: number;
	traceBaseUpdateCount: number;
	traceBaseOutputLength?: number;
	currentOutputLength?: number;
	lastEventAt?: string;
	firstEventAt?: string;
	firstTextDeltaAt?: string;
	firstReasoningDeltaAt?: string;
	firstEnqueueAt?: string;
	firstFlushAt?: string;
	firstOverlayUpdateAt?: string;
	lastEventId?: string;
	lastDurableCursor?: string;
	lastTransientLiveId?: string;
	lastReadyState?: number;
	lastFlushAt?: string;
	lastTraceRefreshScheduledAt?: string;
	lastTraceRefreshDelayMs?: number;
};

export type StreamingDebugEvent = {
	type: string;
	delta?: string;
	streamFrameId?: string;
	piboSessionId?: string;
};

export function isStreamingDebugEnabled(): boolean {
	if (streamingDebugEnabledCache !== undefined) return streamingDebugEnabledCache;
	const win = streamingDebugWindow();
	if (!win) {
		streamingDebugEnabledCache = false;
		return streamingDebugEnabledCache;
	}
	try {
		const params = new URL(win.location.href).searchParams;
		const queryValue = params.get("debugStreaming");
		streamingDebugEnabledCache = queryValue !== null
			? queryValue !== "0" && queryValue !== "false"
			: win.localStorage.getItem("pibo.chat.debugStreaming") === "1";
	} catch {
		streamingDebugEnabledCache = false;
	}
	return streamingDebugEnabledCache;
}

export function recordStreamingDebugLiveOpen(piboSessionId: string, readyState: number): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		snapshot.liveOpenCount += 1;
		snapshot.lastReadyState = readyState;
	});
}

export function recordStreamingDebugLiveError(piboSessionId: string, readyState: number): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		snapshot.liveErrorCount += 1;
		snapshot.lastReadyState = readyState;
	});
}

export function recordStreamingDebugStreamEvent(piboSessionId: string, event: StreamingDebugEvent, lastEventId: string | undefined, readyState: number): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		const at = nowIso();
		snapshot.eventCount += 1;
		snapshot.eventTypeCounts[event.type] = (snapshot.eventTypeCounts[event.type] ?? 0) + 1;
		snapshot.lastEventAt = at;
		snapshot.firstEventAt ??= at;
		snapshot.lastReadyState = readyState;
		const eventId = lastEventId || event.streamFrameId;
		if (eventId) {
			snapshot.lastEventId = eventId;
			const kind = classifyStreamingDebugEventId(eventId);
			if (kind === "durable") snapshot.lastDurableCursor = eventId;
			else if (kind === "transient") snapshot.lastTransientLiveId = eventId;
		}
		if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
			snapshot.firstTextDeltaAt ??= at;
			snapshot.textDeltaCount += 1;
			snapshot.textDeltaBytes += textBytes(event.delta);
		} else if (event.type === "REASONING_MESSAGE_CONTENT" && typeof event.delta === "string") {
			snapshot.firstReasoningDeltaAt ??= at;
			snapshot.reasoningDeltaCount += 1;
			snapshot.reasoningDeltaBytes += textBytes(event.delta);
		}
	});
}

export function recordStreamingDebugEnqueue(piboSessionId: string, event: StreamingDebugEvent, pendingEventCount: number, flushImmediately: boolean): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		snapshot.firstEnqueueAt ??= nowIso();
		snapshot.enqueueCount += 1;
		if (flushImmediately) snapshot.enqueueFlushImmediateCount += 1;
		snapshot.pendingEventCount = pendingEventCount;
		if (event.streamFrameId) {
			const kind = classifyStreamingDebugEventId(event.streamFrameId);
			if (kind === "durable") snapshot.lastDurableCursor = event.streamFrameId;
			else if (kind === "transient") snapshot.lastTransientLiveId = event.streamFrameId;
		}
	});
}

export function recordStreamingDebugFlush(piboSessionId: string, flushedEventCount: number, overlayEventCount: number): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		const at = nowIso();
		snapshot.firstFlushAt ??= at;
		snapshot.firstOverlayUpdateAt ??= at;
		snapshot.flushCount += 1;
		snapshot.flushedEventCount += flushedEventCount;
		snapshot.pendingEventCount = 0;
		snapshot.overlayUpdateCount += 1;
		snapshot.overlayEventCount = overlayEventCount;
		snapshot.lastFlushAt = at;
	});
}

export function recordStreamingDebugTraceRefreshScheduled(piboSessionId: string, delayMs: number): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		snapshot.traceRefreshScheduledCount += 1;
		snapshot.lastTraceRefreshScheduledAt = nowIso();
		snapshot.lastTraceRefreshDelayMs = delayMs;
	});
}

export function recordStreamingDebugTraceRefreshStart(piboSessionId: string): number | undefined {
	const startedAt = nowMs();
	updateStreamingDebug(piboSessionId, (snapshot) => {
		snapshot.traceRefreshStartedCount += 1;
	});
	return startedAt;
}

export function recordStreamingDebugTraceRefreshEnd(piboSessionId: string, startedAt: number | undefined, failed: boolean): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		if (failed) snapshot.traceRefreshFailedCount += 1;
		else snapshot.traceRefreshCompletedCount += 1;
		if (startedAt === undefined) return;
		const durationMs = Math.max(0, nowMs() - startedAt);
		snapshot.traceRefreshDurationMsLast = Math.round(durationMs);
		snapshot.traceRefreshDurationMsTotal += durationMs;
		snapshot.traceRefreshDurationMsMax = Math.max(snapshot.traceRefreshDurationMsMax ?? 0, durationMs);
	});
}

export function recordStreamingDebugTraceState(piboSessionId: string, state: { overlayEventCount: number; traceBaseOutputLength?: number; currentOutputLength?: number; traceBaseUpdated?: boolean }): void {
	updateStreamingDebug(piboSessionId, (snapshot) => {
		if (state.traceBaseUpdated) snapshot.traceBaseUpdateCount += 1;
		snapshot.overlayEventCount = state.overlayEventCount;
		if (state.traceBaseOutputLength !== undefined) snapshot.traceBaseOutputLength = state.traceBaseOutputLength;
		if (state.currentOutputLength !== undefined) snapshot.currentOutputLength = state.currentOutputLength;
	});
}

export function shouldDropStreamingBenchmarkOverlayEvent(event: StreamingDebugEvent): boolean {
	const win = streamingDebugWindow();
	if (!win?.__piboStreamingBenchmarkShouldDropOverlayEvent) return false;
	try {
		return Boolean(win.__piboStreamingBenchmarkShouldDropOverlayEvent(event));
	} catch {
		return false;
	}
}

export function classifyStreamingDebugEventId(value: string | undefined): "missing" | "transient" | "durable" | "other" {
	if (!value) return "missing";
	if (/^live:\d+$/.test(value)) return "transient";
	if (/^\d+:\d+$/.test(value)) return "durable";
	return "other";
}

function updateStreamingDebug(piboSessionId: string, updater: (snapshot: StreamingDebugSnapshot) => void): void {
	const snapshot = ensureStreamingDebugSnapshot();
	if (!snapshot) return;
	if (!snapshot.sessionIds.includes(piboSessionId)) snapshot.sessionIds.push(piboSessionId);
	snapshot.selectedPiboSessionId = piboSessionId;
	updater(snapshot);
	snapshot.updatedAt = nowIso();
}

function ensureStreamingDebugSnapshot(): StreamingDebugSnapshot | undefined {
	if (!isStreamingDebugEnabled()) return undefined;
	const win = streamingDebugWindow();
	if (!win) return undefined;
	if (!win.__piboStreamingDebugReset) {
		win.__piboStreamingDebugReset = () => {
			win.__piboStreamingDebug = createStreamingDebugSnapshot();
			return win.__piboStreamingDebug;
		};
	}
	win.__piboStreamingDebug ??= createStreamingDebugSnapshot();
	return win.__piboStreamingDebug;
}

function createStreamingDebugSnapshot(): StreamingDebugSnapshot {
	const now = nowIso();
	return {
		enabled: true,
		startedAt: now,
		updatedAt: now,
		sessionIds: [],
		liveOpenCount: 0,
		liveErrorCount: 0,
		eventCount: 0,
		eventTypeCounts: {},
		textDeltaCount: 0,
		textDeltaBytes: 0,
		reasoningDeltaCount: 0,
		reasoningDeltaBytes: 0,
		enqueueCount: 0,
		enqueueFlushImmediateCount: 0,
		pendingEventCount: 0,
		flushCount: 0,
		flushedEventCount: 0,
		overlayUpdateCount: 0,
		overlayEventCount: 0,
		traceRefreshScheduledCount: 0,
		traceRefreshStartedCount: 0,
		traceRefreshCompletedCount: 0,
		traceRefreshFailedCount: 0,
		traceRefreshDurationMsTotal: 0,
		traceBaseUpdateCount: 0,
	};
}

function streamingDebugWindow(): StreamingDebugWindow | undefined {
	return typeof window === "undefined" ? undefined : window as StreamingDebugWindow;
}

function textBytes(value: string): number {
	if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
	return value.length;
}

function nowIso(): string {
	return new Date().toISOString();
}

function nowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}
