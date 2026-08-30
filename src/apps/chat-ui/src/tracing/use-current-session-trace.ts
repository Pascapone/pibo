import { useEffect, useMemo, useRef } from "react";
import type { PiboSessionTraceView, PiboWebSessionStatus } from "../types";
import { collectTraceState, isTraceSnapshotCollectionEnabled } from "./snapshotCollector";
import { computeCurrentTraceView, type CurrentTraceProjectionCache } from "./current-trace-view";
import type { LiveTraceOverlay } from "./live-overlay";
import {
	collectPersistedUserMessageIndex,
	reconcileOptimisticUserMessages,
} from "./optimistic-user-messages";
import { traceAssistantOutputLength } from "./trace-output";
import {
	isStreamingDebugEnabled,
	recordStreamingDebugLiveTraceCompute,
	recordStreamingDebugTraceState,
} from "../streamingDebug";

export function useCurrentSessionTrace({
	selectedPiboSessionId,
	baseTraceView,
	liveTraceOverlay,
	selectedSessionStatus,
}: {
	selectedPiboSessionId: string | null;
	baseTraceView: PiboSessionTraceView | null;
	liveTraceOverlay: LiveTraceOverlay | null;
	selectedSessionStatus?: PiboWebSessionStatus;
}): PiboSessionTraceView | null {
	const reconciledBaseTraceView = useMemo(
		() => baseTraceView ? reconcileOptimisticUserMessages(baseTraceView) : null,
		[baseTraceView],
	);

	const persistedUserMessageIndexForBaseTrace = useMemo(
		() => reconciledBaseTraceView ? collectPersistedUserMessageIndex(reconciledBaseTraceView.nodes) : new Map<string, string[]>(),
		[reconciledBaseTraceView],
	);
	const liveProjectionCacheRef = useRef<CurrentTraceProjectionCache | undefined>(undefined);

	const currentTraceComputation = useMemo(() => {
		const computation = computeCurrentTraceView({
			selectedPiboSessionId,
			reconciledBaseTraceView,
			liveTraceOverlay,
			selectedSessionStatus,
			persistedUserMessageIndexForBaseTrace,
			previousProjection: liveProjectionCacheRef.current,
			now: isStreamingDebugEnabled() ? () => performance.now() : undefined,
		});
		liveProjectionCacheRef.current = computation.projectionCache;
		return computation;
	}, [liveTraceOverlay, selectedPiboSessionId, selectedSessionStatus, reconciledBaseTraceView, persistedUserMessageIndexForBaseTrace]);
	const currentTraceView = currentTraceComputation.traceView;

	useEffect(() => {
		if (!selectedPiboSessionId || !currentTraceView?.piboSessionId || !isStreamingDebugEnabled()) return;
		recordStreamingDebugTraceState(currentTraceView.piboSessionId, {
			overlayEventCount: liveTraceOverlay?.piboSessionId === currentTraceView.piboSessionId ? liveTraceOverlay.events.length : 0,
			traceBaseOutputLength: traceAssistantOutputLength(baseTraceView),
			currentOutputLength: traceAssistantOutputLength(currentTraceView),
		});
		if (currentTraceComputation.liveTraceComputeDurationMs !== undefined) {
			recordStreamingDebugLiveTraceCompute(currentTraceView.piboSessionId, currentTraceComputation.liveTraceComputeDurationMs);
		}
	}, [baseTraceView, currentTraceComputation.liveTraceComputeDurationMs, currentTraceView, liveTraceOverlay, selectedPiboSessionId]);

	useEffect(() => {
		if (!currentTraceView?.piboSessionId || !isTraceSnapshotCollectionEnabled()) return;
		const overlayEvents = liveTraceOverlay?.piboSessionId === currentTraceView.piboSessionId
			? liveTraceOverlay.events
			: [];
		collectTraceState({
			piboSessionId: currentTraceView.piboSessionId,
			trigger: "trace-state:render",
			baseTraceView,
			currentTraceView,
			overlayEvents,
			selectedSessionStatus,
		});
	}, [baseTraceView, currentTraceView, liveTraceOverlay, selectedSessionStatus]);

	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!currentTraceView?.piboSessionId || !isTraceSnapshotCollectionEnabled()) return;
			const overlayEvents = liveTraceOverlay?.piboSessionId === currentTraceView.piboSessionId
				? liveTraceOverlay.events
				: [];
			collectTraceState({
				piboSessionId: currentTraceView.piboSessionId,
				trigger: `trace-state:tab:${document.visibilityState}`,
				baseTraceView,
				currentTraceView,
				overlayEvents,
				selectedSessionStatus,
			});
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [baseTraceView, currentTraceView, liveTraceOverlay, selectedSessionStatus]);

	return currentTraceView;
}
