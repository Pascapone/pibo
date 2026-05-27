import { useEffect, useMemo } from "react";
import type { PiboSessionTraceView, PiboWebSessionStatus } from "../types";
import { collectBackendNodes, isTraceSnapshotCollectionEnabled } from "./snapshotCollector";
import { computeCurrentTraceView } from "./current-trace-view";
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

	const currentTraceComputation = useMemo(() => computeCurrentTraceView({
		selectedPiboSessionId,
		reconciledBaseTraceView,
		liveTraceOverlay,
		selectedSessionStatus,
		persistedUserMessageIndexForBaseTrace,
		now: isStreamingDebugEnabled() ? () => performance.now() : undefined,
	}), [liveTraceOverlay, selectedPiboSessionId, selectedSessionStatus, reconciledBaseTraceView, persistedUserMessageIndexForBaseTrace]);
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
		const handleVisibilityChange = () => {
			if (!currentTraceView?.piboSessionId || !isTraceSnapshotCollectionEnabled()) return;
			collectBackendNodes(currentTraceView.piboSessionId, `tab:${document.visibilityState}`, currentTraceView.nodes, {
				traceVersion: currentTraceView.version,
				latestStreamId: currentTraceView.latestStreamId,
				lastRawEventId: currentTraceView.rawEvents.at(-1)?.id,
			});
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [currentTraceView]);

	return currentTraceView;
}
