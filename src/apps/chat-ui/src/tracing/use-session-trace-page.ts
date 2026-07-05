import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTraceRawEvents, getTraceSummary, getTraceTimeline } from "../api-trace-signals";
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
import { traceViewFromTimelinePage } from "./trace-v2-adapter";

type UseSessionTracePageOptions = {
	selectedPiboSessionId: string | null;
	showRawEvents: boolean;
	setLiveTraceOverlay: Dispatch<SetStateAction<LiveTraceOverlay | null>>;
};

const MAX_REMEMBERED_OLDER_TRACE_LOADS = 128;

export function useSessionTracePage({
	selectedPiboSessionId,
	showRawEvents,
	setLiveTraceOverlay,
}: UseSessionTracePageOptions) {
	const queryClient = useQueryClient();
	const [traceEventLimit, setTraceEventLimit] = useState(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
	const [rawEventLimit, setRawEventLimit] = useState(DEFAULT_RAW_EVENTS_LIMIT);
	const [baseTraceView, setBaseTraceView] = useState<PiboSessionTraceView | null>(null);
	const [rawEventsBeforeSequence, setRawEventsBeforeSequence] = useState<number | undefined>(undefined);
	const [loadingOlderTracePage, setLoadingOlderTracePage] = useState(false);
	const loadingOlderTraceBeforeRef = useRef<string | null>(null);
	const loadedOlderTraceBeforeRef = useRef<Set<string>>(new Set());
	const traceSummaryQueryKey = useMemo(
		() => selectedPiboSessionId ? chatTraceSummaryQueryKey(selectedPiboSessionId) : null,
		[selectedPiboSessionId],
	);
	const tracePageQueryKey = useMemo(
		() =>
			selectedPiboSessionId
				? chatTracePageQueryKey(selectedPiboSessionId, { includeRawEvents: false, rawEventsLimit: 0, pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE })
				: null,
		[selectedPiboSessionId],
	);
	const traceSummaryQuery = useQuery({
		queryKey: traceSummaryQueryKey ?? ["chat", "trace-summary", "idle"],
		queryFn: async ({ signal }) => {
			if (!selectedPiboSessionId || !traceSummaryQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceSummary>(traceSummaryQueryKey);
			const response = await getTraceSummary(selectedPiboSessionId, cached?.version, { signal });
			if (response.notModified && cached) return cached;
			if (!response.summary) throw new Error("Trace summary response missing payload.");
			return response.summary;
		},
		enabled: false,
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});
	const tracePageQuery = useQuery({
		queryKey: tracePageQueryKey ?? ["chat", "trace-page", "idle", "compact", rawEventLimit, DEFAULT_TRACE_EVENTS_PAGE_SIZE, "tail"],
		queryFn: async ({ signal }) => {
			if (!selectedPiboSessionId || !tracePageQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceView>(tracePageQueryKey);
			const response = await getTraceTimeline(selectedPiboSessionId, {
				limit: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
				knownVersion: cached?.version,
				signal,
			});
			if (response.notModified && cached) return cached;
			if (!response.timeline) throw new Error("Trace timeline response missing payload.");
			return traceViewFromTimelinePage(response.timeline);
		},
		enabled: Boolean(selectedPiboSessionId),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});

	useEffect(() => {
		const cachedTrace = tracePageQueryKey ? queryClient.getQueryData<PiboSessionTraceView>(tracePageQueryKey) : undefined;
		setTraceEventLimit(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
		setRawEventLimit(DEFAULT_RAW_EVENTS_LIMIT);
		setRawEventsBeforeSequence(undefined);
		setLoadingOlderTracePage(false);
		setBaseTraceView(cachedTrace?.piboSessionId === selectedPiboSessionId ? cachedTrace : null);
		setLiveTraceOverlay(null);
		loadingOlderTraceBeforeRef.current = null;
		loadedOlderTraceBeforeRef.current = new Set();
	}, [queryClient, selectedPiboSessionId, setLiveTraceOverlay, tracePageQueryKey]);

	const rawEventsQuery = useQuery({
		queryKey: selectedPiboSessionId ? ["chat", "trace-raw-events", selectedPiboSessionId, rawEventLimit, rawEventsBeforeSequence ?? "tail"] : ["chat", "trace-raw-events", "idle"],
		queryFn: async ({ signal }) => {
			if (!selectedPiboSessionId) throw new Error("Session is required");
			return getTraceRawEvents(selectedPiboSessionId, { limit: rawEventLimit, beforeSequence: rawEventsBeforeSequence, signal });
		},
		enabled: Boolean(selectedPiboSessionId && showRawEvents),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});

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
			setBaseTraceView((current) => ({
				...trace,
				rawEvents: current?.piboSessionId === trace.piboSessionId ? current.rawEvents : trace.rawEvents,
			}));
			setLiveTraceOverlay((current) => trimLiveOverlayForBaseTrace(current, trace));
		});
	}, [selectedPiboSessionId, setLiveTraceOverlay, tracePageQuery.data]);

	useEffect(() => {
		const rawPage = rawEventsQuery.data;
		if (!rawPage || rawPage.piboSessionId !== selectedPiboSessionId) return;
		startTransition(() => {
			setBaseTraceView((current) => {
				if (!current) return current;
				if (rawEventsBeforeSequence === undefined) return { ...current, rawEvents: rawPage.events };
				const seen = new Set(rawPage.events.map((event) => event.id));
				return { ...current, rawEvents: [...rawPage.events, ...current.rawEvents.filter((event) => !seen.has(event.id))] };
			});
		});
	}, [rawEventsBeforeSequence, rawEventsQuery.data, selectedPiboSessionId]);

	const loadOlderTracePage = useCallback(async (beforeCursor?: string | number | null) => {
		if (!selectedPiboSessionId || !beforeCursor) return;
		const loadKey = `${selectedPiboSessionId}:${beforeCursor}`;
		if (loadingOlderTraceBeforeRef.current) return;
		if (loadedOlderTraceBeforeRef.current.has(loadKey)) return;
		loadingOlderTraceBeforeRef.current = loadKey;
		setLoadingOlderTracePage(true);
		const queryKey = chatTracePageQueryKey(selectedPiboSessionId, {
			includeRawEvents: showRawEvents,
			rawEventsLimit: rawEventLimit,
			pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
			beforeCursor,
		});
		try {
			const olderTrace = await queryClient.fetchQuery({
				queryKey,
				queryFn: async ({ signal }) => {
					const cached = queryClient.getQueryData<PiboSessionTraceView>(queryKey);
					const response = await getTraceTimeline(selectedPiboSessionId, {
						limit: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
						beforeCursor,
						knownVersion: cached?.version,
						signal,
					});
					if (response.notModified && cached) return cached;
					if (!response.timeline) throw new Error("Trace timeline response missing payload.");
					return traceViewFromTimelinePage(response.timeline);
				},
				staleTime: TRACE_STALE_TIME_MS,
				gcTime: TRACE_GC_TIME_MS,
			});
			startTransition(() => {
				setBaseTraceView((current) => current ? mergeOlderTracePage(current, olderTrace) : olderTrace);
				setTraceEventLimit((current) => current + (olderTrace.pageSize ?? DEFAULT_TRACE_EVENTS_PAGE_SIZE));
			});
			rememberOlderTraceLoad(loadedOlderTraceBeforeRef.current, loadKey);
		} finally {
			if (loadingOlderTraceBeforeRef.current === loadKey) loadingOlderTraceBeforeRef.current = null;
			setLoadingOlderTracePage(false);
		}
	}, [queryClient, rawEventLimit, selectedPiboSessionId, showRawEvents]);

	const loadMoreRawEvents = useCallback(() => {
		const nextBefore = baseTraceView?.rawEvents[0]?.eventSequence;
		setRawEventsBeforeSequence(nextBefore);
		setRawEventLimit((current) => current + DEFAULT_RAW_EVENTS_LIMIT);
	}, [baseTraceView?.rawEvents]);

	return {
		baseTraceView,
		traceEventLimit,
		rawEventLimit,
		traceSummaryQuery,
		tracePageQuery,
		rawEventsQuery,
		loadingOlderTracePage,
		tracePageReady: Boolean(tracePageQueryKey),
		loadOlderTracePage,
		loadMoreRawEvents,
	};
}

function rememberOlderTraceLoad(loads: Set<string>, loadKey: string) {
	loads.add(loadKey);
	if (loads.size <= MAX_REMEMBERED_OLDER_TRACE_LOADS) return;
	const first = loads.values().next();
	if (!first.done) loads.delete(first.value);
}
