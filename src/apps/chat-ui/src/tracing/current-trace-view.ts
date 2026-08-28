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
};

export function computeCurrentTraceView({
	selectedPiboSessionId,
	reconciledBaseTraceView,
	liveTraceOverlay,
	selectedSessionStatus,
	persistedUserMessageIndexForBaseTrace,
	now,
}: {
	selectedPiboSessionId: string | null;
	reconciledBaseTraceView: PiboSessionTraceView | null;
	liveTraceOverlay: LiveTraceOverlay | null;
	selectedSessionStatus?: PiboWebSessionStatus;
	persistedUserMessageIndexForBaseTrace: ReadonlyMap<string, readonly string[]>;
	now?: () => number;
}): CurrentTraceViewComputation {
	if (!selectedPiboSessionId) return { traceView: null };
	if (reconciledBaseTraceView?.piboSessionId !== selectedPiboSessionId) return { traceView: null };
	const reconciledOverlay = liveTraceOverlay?.piboSessionId === selectedPiboSessionId
		? trimLiveOverlayForBaseTrace(liveTraceOverlay, reconciledBaseTraceView)
		: null;
	const overlayEvents = reconciledOverlay?.events ?? [];
	if (!overlayEvents.length) return { traceView: reconciledBaseTraceView };
	const startedAt = now?.();
	const liveTrace = patchTraceViewWithEvents(reconciledBaseTraceView, overlayEvents, selectedSessionStatus ?? "idle");
	const hasOptimisticUserMessage = overlayIncludesOptimisticUserMessage(overlayEvents);
	if (hasOptimisticUserMessage) annotateLiveTraceForkEntryIds(liveTrace.nodes, persistedUserMessageIndexForBaseTrace);
	const traceView = hasOptimisticUserMessage ? reconcileOptimisticUserMessages(liveTrace) : liveTrace;
	return {
		traceView,
		liveTraceComputeDurationMs: startedAt !== undefined && now ? now() - startedAt : undefined,
	};
}
