import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PiboSessionTraceView, PiboWebSessionStatus } from "../types";
import { applyTraceLiveEvents } from "../traceLiveReducer";
import {
	recordStreamingDebugEnqueue,
	recordStreamingDebugFlush,
	recordStreamingDebugLiveError,
	recordStreamingDebugLiveOpen,
	recordStreamingDebugStreamEvent,
	recordStreamingDebugTraceRefreshScheduled,
	shouldDropStreamingBenchmarkOverlayEvent,
} from "../streamingDebug";
import {
	chatStreamEvent,
	consumeFirstLiveContentFlush,
	eventShouldRefreshNavigation,
	eventTraceRefreshDelay,
	eventUpdatesLiveOverlay,
	recordEventLiveCursor,
	recordTraceLiveCursor,
	resetLiveContentFlushTracking,
	traceStreamCursorAfterStream,
	type ChatStreamEvent,
	type LiveStreamCursor,
} from "./chat-stream-events";
import type { LiveTraceOverlay } from "./live-overlay";

const LIVE_STREAM_RECONNECT_BASE_DELAY_MS = 500;
const LIVE_STREAM_RECONNECT_MAX_DELAY_MS = 10_000;
const LIVE_STREAM_STALE_MS = 45_000;
const HIDDEN_STREAM_FLUSH_DELAY_MS = 100;

type SelectedLiveEventStream = {
	piboSessionId: string;
	events: EventSource;
	openedAt: number;
	lastActivityAt: number;
	lastErrorAt?: number;
};

export type UseSessionTraceLiveStreamInput = {
	selectedPiboSessionId: string | null;
	tracePageData?: PiboSessionTraceView | null;
	currentTraceView: PiboSessionTraceView | null;
	liveEventSeqRef: MutableRefObject<number>;
	selectedSessionStatus?: PiboWebSessionStatus;
	tracePageReady: boolean;
	setLiveTraceOverlay: Dispatch<SetStateAction<LiveTraceOverlay | null>>;
	onRefreshTrace: () => Promise<void>;
	onRefreshBootstrap: () => Promise<unknown>;
	onError: (message: string | null) => void;
};

export function useSessionTraceLiveStream({
	selectedPiboSessionId,
	tracePageData,
	currentTraceView,
	liveEventSeqRef,
	selectedSessionStatus,
	tracePageReady,
	setLiveTraceOverlay,
	onRefreshTrace,
	onRefreshBootstrap,
	onError,
}: UseSessionTraceLiveStreamInput): void {
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);
	const pendingStreamTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const firstLiveContentFlushKeysBySession = useRef(new Map<string, Set<string>>());
	const latestLiveCursorBySession = useRef(new Map<string, LiveStreamCursor>());
	const selectedLiveStreamRef = useRef<SelectedLiveEventStream | null>(null);
	const selectedLiveStreamReconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const selectedLiveStreamReconnectAttempts = useRef(0);
	const [selectedLiveStreamReconnectGeneration, setSelectedLiveStreamReconnectGeneration] = useState(0);

	useEffect(() => {
		const trace = tracePageData;
		if (!trace || trace.piboSessionId !== selectedPiboSessionId) return;
		const maxSeq = trace.rawEvents
			.map((e) => e.eventSequence ?? 0)
			.reduce((a, b) => Math.max(a, b), 0);
		liveEventSeqRef.current = Math.max(liveEventSeqRef.current, maxSeq + 1);
		if (trace.latestStreamId !== undefined) {
			recordTraceLiveCursor(latestLiveCursorBySession.current, trace.piboSessionId, trace.latestStreamId);
		}
	}, [liveEventSeqRef, selectedPiboSessionId, tracePageData]);

	const flushPendingStreamEvents = useCallback((piboSessionId: string) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId);
		if (!pending?.length) return;
		setLiveTraceOverlay((current) => {
			const currentEvents = current?.piboSessionId === piboSessionId ? current.events : [];
			const events = applyTraceLiveEvents({
				currentEvents,
				streamEvents: pending,
				piboSessionId,
				nextSequence: () => liveEventSeqRef.current++,
			});
			recordStreamingDebugFlush(piboSessionId, pending.length, events.length);
			return {
				piboSessionId,
				events,
			};
		});
		pendingStreamEventsBySession.current.delete(piboSessionId);
	}, []);

	const schedulePendingStreamFlush = useCallback(() => {
		if (pendingStreamFrame.current !== undefined || pendingStreamTimer.current !== undefined || !selectedPiboSessionId) return;
		if (document.hidden) {
			pendingStreamTimer.current = setTimeout(() => {
				pendingStreamTimer.current = undefined;
				flushPendingStreamEvents(selectedPiboSessionId);
			}, HIDDEN_STREAM_FLUSH_DELAY_MS);
			return;
		}
		pendingStreamFrame.current = requestAnimationFrame(() => {
			pendingStreamFrame.current = undefined;
			flushPendingStreamEvents(selectedPiboSessionId);
		});
	}, [flushPendingStreamEvents, selectedPiboSessionId]);

	const enqueueStreamEvent = useCallback((piboSessionId: string, event: ChatStreamEvent, flushImmediately = false) => {
		resetLiveContentFlushTracking(firstLiveContentFlushKeysBySession.current, piboSessionId, event);
		const shouldFlushImmediately = flushImmediately || consumeFirstLiveContentFlush(firstLiveContentFlushKeysBySession.current, piboSessionId, event);
		const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
		pending.push(event);
		pendingStreamEventsBySession.current.set(piboSessionId, pending);
		recordStreamingDebugEnqueue(piboSessionId, event, pending.length, shouldFlushImmediately);
		if (shouldFlushImmediately || piboSessionId !== selectedPiboSessionId) {
			flushPendingStreamEvents(piboSessionId);
		} else {
			schedulePendingStreamFlush();
		}
	}, [flushPendingStreamEvents, schedulePendingStreamFlush, selectedPiboSessionId]);

	useEffect(() => {
		return () => {
			if (pendingStreamFrame.current !== undefined) {
				cancelAnimationFrame(pendingStreamFrame.current);
			}
			if (pendingStreamTimer.current !== undefined) {
				clearTimeout(pendingStreamTimer.current);
			}
			if (selectedLiveStreamReconnectTimer.current !== undefined) {
				clearTimeout(selectedLiveStreamReconnectTimer.current);
			}
		};
	}, []);

	const recordLatestLiveStreamCursor = useCallback((piboSessionId: string, event: ChatStreamEvent) => {
		recordEventLiveCursor(latestLiveCursorBySession.current, piboSessionId, event);
	}, []);

	const requestSelectedLiveStreamReconnect = useCallback((delayMs = 0) => {
		if (selectedLiveStreamReconnectTimer.current !== undefined) {
			if (delayMs > 0) return;
			clearTimeout(selectedLiveStreamReconnectTimer.current);
		}
		selectedLiveStreamReconnectTimer.current = setTimeout(() => {
			selectedLiveStreamReconnectTimer.current = undefined;
			setSelectedLiveStreamReconnectGeneration((current) => current + 1);
		}, delayMs);
	}, []);

	const recoverSelectedLiveStream = useCallback(() => {
		if (!selectedPiboSessionId) return;
		flushPendingStreamEvents(selectedPiboSessionId);
		void onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
		void onRefreshBootstrap().catch((caught) => onError(errorMessage(caught)));
		const liveStream = selectedLiveStreamRef.current;
		const stale = !liveStream
			|| liveStream.piboSessionId !== selectedPiboSessionId
			|| liveStream.events.readyState === 2
			|| Date.now() - liveStream.lastActivityAt > LIVE_STREAM_STALE_MS;
		if (stale) requestSelectedLiveStreamReconnect();
	}, [flushPendingStreamEvents, onError, onRefreshBootstrap, onRefreshTrace, requestSelectedLiveStreamReconnect, selectedPiboSessionId]);

	useEffect(() => {
		if (!selectedPiboSessionId || !tracePageReady) return;
		if (!currentTraceView || currentTraceView.piboSessionId !== selectedPiboSessionId) return;
		const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
		params.set("mode", "live");
		const latestLiveCursor = latestLiveCursorBySession.current.get(selectedPiboSessionId);
		const latestCursor = latestLiveCursor?.cursor
			?? (currentTraceView.latestStreamId !== undefined ? traceStreamCursorAfterStream(currentTraceView.latestStreamId) : undefined);
		if (latestCursor !== undefined) {
			params.set("since", latestCursor);
		}
		if (latestLiveCursor?.liveReplayId !== undefined) {
			params.set("liveSince", String(latestLiveCursor.liveReplayId));
		}
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		const openedAt = Date.now();
		selectedLiveStreamRef.current = { piboSessionId: selectedPiboSessionId, events, openedAt, lastActivityAt: openedAt };
		let closed = false;
		let traceTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapRefreshInFlight = false;
		let bootstrapRefreshPending = false;
		const scheduleTraceRefresh = (delayMs: number, reset = false) => {
			if (traceTimer) {
				if (!reset) return;
				clearTimeout(traceTimer);
			}
			recordStreamingDebugTraceRefreshScheduled(selectedPiboSessionId, delayMs);
			traceTimer = setTimeout(() => {
				traceTimer = undefined;
				onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
			}, delayMs);
		};
		const refreshBootstrap = () => {
			if (bootstrapRefreshInFlight) {
				bootstrapRefreshPending = true;
				return;
			}
			bootstrapRefreshInFlight = true;
			onRefreshBootstrap()
				.catch((caught) => onError(errorMessage(caught)))
				.finally(() => {
					bootstrapRefreshInFlight = false;
					if (!bootstrapRefreshPending) return;
					bootstrapRefreshPending = false;
					scheduleBootstrapRefresh(250, true);
				});
		};
		const scheduleBootstrapRefresh = (delayMs: number, reset = false) => {
			if (bootstrapTimer) {
				if (!reset) return;
				clearTimeout(bootstrapTimer);
			}
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				refreshBootstrap();
			}, delayMs);
		};
		const scheduleTerminalBootstrapRefresh = () => {
			scheduleBootstrapRefresh(900, true);
		};
		events.onopen = () => {
			selectedLiveStreamReconnectAttempts.current = 0;
			if (selectedLiveStreamReconnectTimer.current !== undefined) {
				clearTimeout(selectedLiveStreamReconnectTimer.current);
				selectedLiveStreamReconnectTimer.current = undefined;
			}
			recordStreamingDebugLiveOpen(selectedPiboSessionId, events.readyState);
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) liveStream.lastActivityAt = Date.now();
		};
		events.onerror = () => {
			if (closed) return;
			recordStreamingDebugLiveError(selectedPiboSessionId, events.readyState);
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) {
				liveStream.lastErrorAt = Date.now();
			}
			const attempt = selectedLiveStreamReconnectAttempts.current++;
			const delayMs = Math.min(LIVE_STREAM_RECONNECT_MAX_DELAY_MS, LIVE_STREAM_RECONNECT_BASE_DELAY_MS * 2 ** attempt);
			requestSelectedLiveStreamReconnect(delayMs);
		};
		events.addEventListener("pibo", (message) => {
			if (closed) return;
			const event = chatStreamEvent(message);
			if (!event) return;
			const targetPiboSessionId = event.piboSessionId || selectedPiboSessionId;
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) liveStream.lastActivityAt = Date.now();
			recordLatestLiveStreamCursor(targetPiboSessionId, event);
			recordStreamingDebugStreamEvent(targetPiboSessionId, event, message.lastEventId, events.readyState);
			if (targetPiboSessionId === selectedPiboSessionId && event.type === "ready" && event.liveReplay?.missed) {
				scheduleTraceRefresh(0, true);
			}
			if (shouldDropStreamingBenchmarkOverlayEvent(event)) return;
			const flushImmediately = event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT";
			if (targetPiboSessionId === selectedPiboSessionId && eventUpdatesLiveOverlay(event)) {
				enqueueStreamEvent(targetPiboSessionId, event, flushImmediately);
			}
			const traceRefreshDelay = eventTraceRefreshDelay(event);
			if (targetPiboSessionId === selectedPiboSessionId && traceRefreshDelay !== undefined) {
				scheduleTraceRefresh(traceRefreshDelay, true);
			} else if (targetPiboSessionId === selectedPiboSessionId && event.type !== "ready" && event.type !== "RAW_EVENT") {
				scheduleTraceRefresh(1500, true);
			}
			if (eventShouldRefreshNavigation(event)) {
				const terminal = event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
				if (terminal) {
					scheduleTerminalBootstrapRefresh();
				} else {
					scheduleBootstrapRefresh(targetPiboSessionId === selectedPiboSessionId ? 0 : 150);
				}
			}
		});
		return () => {
			closed = true;
			if (traceTimer) clearTimeout(traceTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			flushPendingStreamEvents(selectedPiboSessionId);
			if (selectedLiveStreamRef.current?.events === events) selectedLiveStreamRef.current = null;
			events.close();
		};
	}, [currentTraceView?.piboSessionId, enqueueStreamEvent, flushPendingStreamEvents, onError, onRefreshBootstrap, onRefreshTrace, recordLatestLiveStreamCursor, requestSelectedLiveStreamReconnect, selectedLiveStreamReconnectGeneration, selectedPiboSessionId, tracePageReady]);

	useEffect(() => {
		if (!currentTraceView?.piboSessionId) return;
		flushPendingStreamEvents(currentTraceView.piboSessionId);
	}, [currentTraceView?.piboSessionId, flushPendingStreamEvents]);

	useEffect(() => {
		const recover = () => recoverSelectedLiveStream();
		const recoverWhenVisible = () => {
			if (!document.hidden) recoverSelectedLiveStream();
		};
		window.addEventListener("focus", recover);
		window.addEventListener("online", recover);
		window.addEventListener("pageshow", recover);
		document.addEventListener("visibilitychange", recoverWhenVisible);
		return () => {
			window.removeEventListener("focus", recover);
			window.removeEventListener("online", recover);
			window.removeEventListener("pageshow", recover);
			document.removeEventListener("visibilitychange", recoverWhenVisible);
		};
	}, [recoverSelectedLiveStream]);

	useEffect(() => {
		if (!selectedPiboSessionId || selectedSessionStatus !== "running") return;
		const timer = window.setInterval(() => {
			flushPendingStreamEvents(selectedPiboSessionId);
			onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
		}, 1000);
		return () => window.clearInterval(timer);
	}, [flushPendingStreamEvents, onError, onRefreshTrace, selectedPiboSessionId, selectedSessionStatus]);

}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}
