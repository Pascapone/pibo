import { startTransition, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrace, getTraceSummary } from "../api-trace-signals";
import {
	DEFAULT_RAW_EVENTS_LIMIT,
	DEFAULT_TRACE_EVENTS_PAGE_SIZE,
	TRACE_GC_TIME_MS,
	TRACE_STALE_TIME_MS,
	chatTracePageQueryKey,
	chatTraceSummaryQueryKey,
} from "../cache";
import type { PiboSessionTraceSummary, PiboSessionTraceView } from "../types";
import { isStreamingDebugEnabled, recordStreamingDebugTraceState } from "../streamingDebug";
import { trimLiveOverlayForBaseTrace, type LiveTraceOverlay } from "./live-overlay";
import { mergeOlderTracePage } from "./trace-page-merge";
import { traceAssistantOutputLength } from "./trace-output";

type UseSessionTracePageOptions = {
	selectedPiboSessionId: string | null;
	showRawEvents: boolean;
	setLiveTraceOverlay: Dispatch<SetStateAction<LiveTraceOverlay | null>>;
};

export function useSessionTracePage({
	selectedPiboSessionId,
	showRawEvents,
	setLiveTraceOverlay,
}: UseSessionTracePageOptions) {
	const queryClient = useQueryClient();
	const [traceEventLimit, setTraceEventLimit] = useState(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
	const [rawEventLimit, setRawEventLimit] = useState(DEFAULT_RAW_EVENTS_LIMIT);
	const [baseTraceView, setBaseTraceView] = useState<PiboSessionTraceView | null>(null);
	const traceSummaryQueryKey = useMemo(
		() => selectedPiboSessionId ? chatTraceSummaryQueryKey(selectedPiboSessionId) : null,
		[selectedPiboSessionId],
	);
	const tracePageQueryKey = useMemo(
		() =>
			selectedPiboSessionId
				? chatTracePageQueryKey(selectedPiboSessionId, { includeRawEvents: showRawEvents, rawEventsLimit: rawEventLimit, pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE })
				: null,
		[rawEventLimit, selectedPiboSessionId, showRawEvents],
	);
	const traceSummaryQuery = useQuery({
		queryKey: traceSummaryQueryKey ?? ["chat", "trace-summary", "idle"],
		queryFn: async () => {
			if (!selectedPiboSessionId || !traceSummaryQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceSummary>(traceSummaryQueryKey);
			const response = await getTraceSummary(selectedPiboSessionId, cached?.version);
			if (response.notModified && cached) return cached;
			if (!response.summary) throw new Error("Trace summary response missing payload.");
			return response.summary;
		},
		enabled: Boolean(selectedPiboSessionId),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});
	const tracePageQuery = useQuery({
		queryKey: tracePageQueryKey ?? ["chat", "trace-page", "idle", "compact", rawEventLimit, DEFAULT_TRACE_EVENTS_PAGE_SIZE, "tail"],
		queryFn: async () => {
			if (!selectedPiboSessionId || !tracePageQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceView>(tracePageQueryKey);
			const response = await getTrace(selectedPiboSessionId, {
				includeRawEvents: showRawEvents,
				rawEventsLimit: rawEventLimit,
				pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
				knownVersion: cached?.version,
			});
			if (response.notModified && cached) return cached;
			if (!response.trace) throw new Error("Trace page response missing payload.");
			return response.trace;
		},
		enabled: Boolean(selectedPiboSessionId),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});

	useEffect(() => {
		setTraceEventLimit(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
		setRawEventLimit(DEFAULT_RAW_EVENTS_LIMIT);
		setBaseTraceView(null);
		setLiveTraceOverlay(null);
	}, [selectedPiboSessionId, setLiveTraceOverlay]);

	// TanStack Query caches only bounded trace pages and summaries. The render path
	// reads from local state so a synchronous cache hit cannot rehydrate a trace in
	// the same click task that switched sessions.
	useEffect(() => {
		const trace = tracePageQuery.data;
		if (!trace || trace.piboSessionId !== selectedPiboSessionId) return;
		if (isStreamingDebugEnabled()) {
			recordStreamingDebugTraceState(trace.piboSessionId, {
				overlayEventCount: 0,
				traceBaseOutputLength: traceAssistantOutputLength(trace),
				traceBaseUpdated: true,
			});
		}
		startTransition(() => {
			setBaseTraceView(trace);
			setLiveTraceOverlay((current) => trimLiveOverlayForBaseTrace(current, trace));
		});
	}, [selectedPiboSessionId, setLiveTraceOverlay, tracePageQuery.data]);

	const loadOlderTracePage = useCallback(async (beforeSequence?: number | null) => {
		if (!selectedPiboSessionId || !beforeSequence) return;
		const queryKey = chatTracePageQueryKey(selectedPiboSessionId, {
			includeRawEvents: showRawEvents,
			rawEventsLimit: rawEventLimit,
			pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
			beforeSequence,
		});
		const olderTrace = await queryClient.fetchQuery({
			queryKey,
			queryFn: async () => {
				const cached = queryClient.getQueryData<PiboSessionTraceView>(queryKey);
				const response = await getTrace(selectedPiboSessionId, {
					includeRawEvents: showRawEvents,
					rawEventsLimit: rawEventLimit,
					pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
					beforeSequence,
					knownVersion: cached?.version,
				});
				if (response.notModified && cached) return cached;
				if (!response.trace) throw new Error("Trace page response missing payload.");
				return response.trace;
			},
			staleTime: TRACE_STALE_TIME_MS,
			gcTime: TRACE_GC_TIME_MS,
		});
		startTransition(() => {
			setBaseTraceView((current) => current ? mergeOlderTracePage(current, olderTrace) : olderTrace);
			setTraceEventLimit((current) => current + (olderTrace.pageSize ?? DEFAULT_TRACE_EVENTS_PAGE_SIZE));
		});
	}, [queryClient, rawEventLimit, selectedPiboSessionId, showRawEvents]);

	const loadMoreRawEvents = useCallback(() => {
		setRawEventLimit((current) => current + DEFAULT_RAW_EVENTS_LIMIT);
	}, []);

	return {
		baseTraceView,
		traceEventLimit,
		rawEventLimit,
		traceSummaryQuery,
		tracePageQuery,
		tracePageReady: Boolean(tracePageQueryKey),
		loadOlderTracePage,
		loadMoreRawEvents,
	};
}
