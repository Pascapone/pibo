import { patchTraceViewWithEvents } from "../../../../shared/trace-live-patch.js";
import type { PiboSessionTraceView, PiboWebSessionStatus } from "../types";
import { trimLiveOverlayForBaseTrace, type LiveTraceOverlay } from "./live-overlay";
import {
	annotateLiveTraceForkEntryIds,
	overlayIncludesOptimisticUserMessage,
	reconcileOptimisticUserMessages,
} from "./optimistic-user-messages";

export type CurrentTraceViewComputation = {
	traceView: PiboSessionTraceView | null;
	liveTraceComputeDurationMs?: number;
	appliedLiveEventCount?: number;
	projectionCache?: CurrentTraceProjectionCache;
};

export type CurrentTraceProjectionCache = {
	baseTraceView: PiboSessionTraceView;
	overlayEvents: readonly import("../../../../shared/trace-types.js").ChatWebStoredEvent[];
	sessionStatus: PiboWebSessionStatus;
	traceView: PiboSessionTraceView;
};

export function computeCurrentTraceView({
	selectedPiboSessionId,
	reconciledBaseTraceView,
	liveTraceOverlay,
	selectedSessionStatus,
	persistedUserMessageIndexForBaseTrace,
	now,
	previousProjection,
}: {
	selectedPiboSessionId: string | null;
	reconciledBaseTraceView: PiboSessionTraceView | null;
	liveTraceOverlay: LiveTraceOverlay | null;
	selectedSessionStatus?: PiboWebSessionStatus;
	persistedUserMessageIndexForBaseTrace: ReadonlyMap<string, readonly string[]>;
	now?: () => number;
	previousProjection?: CurrentTraceProjectionCache;
}): CurrentTraceViewComputation {
	if (!selectedPiboSessionId) return { traceView: null };
	if (reconciledBaseTraceView?.piboSessionId !== selectedPiboSessionId) return { traceView: null };
	const reconciledOverlay = liveTraceOverlay?.piboSessionId === selectedPiboSessionId
		? trimLiveOverlayForBaseTrace(liveTraceOverlay, reconciledBaseTraceView)
		: null;
	const overlayEvents = reconciledOverlay?.events ?? [];
	if (!overlayEvents.length) return { traceView: reconciledBaseTraceView };
	const startedAt = now?.();
	const sessionStatus = selectedSessionStatus ?? "idle";
	const canAppendIncrementally = previousProjection?.baseTraceView === reconciledBaseTraceView
		&& previousProjection.sessionStatus === sessionStatus
		&& overlayEvents.length >= previousProjection.overlayEvents.length
		&& previousProjection.overlayEvents.every((event, index) => overlayEvents[index] === event);
	const appendedEvents = canAppendIncrementally
		? overlayEvents.slice(previousProjection.overlayEvents.length)
		: overlayEvents;
	const liveTrace = canAppendIncrementally
		? patchTraceViewWithEvents(previousProjection.traceView, appendedEvents, sessionStatus)
		: patchTraceViewWithEvents(reconciledBaseTraceView, overlayEvents, sessionStatus);
	const hasOptimisticUserMessage = overlayIncludesOptimisticUserMessage(overlayEvents);
	if (hasOptimisticUserMessage) annotateLiveTraceForkEntryIds(liveTrace.nodes, persistedUserMessageIndexForBaseTrace);
	const traceView = hasOptimisticUserMessage ? reconcileOptimisticUserMessages(liveTrace) : liveTrace;
	return {
		traceView,
		appliedLiveEventCount: appendedEvents.length,
		projectionCache: { baseTraceView: reconciledBaseTraceView, overlayEvents, sessionStatus, traceView },
		liveTraceComputeDurationMs: startedAt !== undefined && now ? now() - startedAt : undefined,
	};
}
