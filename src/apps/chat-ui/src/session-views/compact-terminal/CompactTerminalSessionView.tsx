import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CircleX, Hammer, Images, MessageSquare } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { chatImagePreviewUrls } from "../../api-chat-files";
import { AgentDelegationCard } from "../../components/AgentDelegationCard";
import { DialogShell } from "../../components/DialogShell";
import { MessageForkButton } from "../../components/MessageForkButton";
import { MessageSpeechButton } from "../../components/MessageSpeechButton";
import { PendingUserMessageDelivery } from "../../components/PendingUserMessageDelivery";
import { useStickyVirtuoso } from "../../components/useStickyVirtuoso";
import { useSessionActivity } from "../../hooks/useSessionActivity";
import { SessionGoalIndicator, formatSessionGoalTokenUsage, sessionGoalIndicatorStatus } from "../../session-goal-indicator";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";
import { collectTerminalRows, isTraceSnapshotCollectionEnabled } from "../../tracing/snapshotCollector";
import type { ChatSessionViewProps } from "../types";
import { TerminalToolMetrics } from "./TerminalToolMetrics";
import { TerminalDetails } from "./TerminalDetails";
import { TerminalLine } from "./TerminalLine";
import { TerminalLoginCard } from "./TerminalLoginCard";
import { TerminalModelCard } from "./TerminalModelCard";
import { TerminalStatusCard } from "./TerminalStatusCard";
import { TerminalThinkingCard } from "./TerminalThinkingCard";
import { readTerminalReadingPosition, writeTerminalReadingPosition, type TerminalReadingPosition } from "./terminal-reading-position";
import { buildCompactTerminalRows, findActiveTurnStartedAt, formatTerminalDuration, MAX_COMPACT_TERMINAL_IMAGE_PREVIEWS, type CompactTerminalImagePreview, type CompactTerminalLine, type CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";

const SHOW_LATEST_THRESHOLD_PX = 180;
const OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = 4_800;
const COMPACT_TOOL_MODE_PREFETCH_TOP_THRESHOLD_PX = 800;
const OLDER_TRACE_PREFETCH_ROW_THRESHOLD = 20;
const INITIAL_BOTTOM_ITEM = { index: "LAST", align: "end" } as const;
const VIRTUOSO_VIEWPORT = { top: 2_400, bottom: 2_400 } as const;
const DEFAULT_ROW_HEIGHT_PX = 84;
const COLLAPSED_EXPLORING_PREVIEW_LINES = 6;
type TerminalNavigationKind = "system" | "tool" | "user";
type TerminalImageDialogState = {
	images: readonly CompactTerminalImagePreview[];
	index: number;
};

export function CompactTerminalSessionView({
	traceView,
	isLoading,
	terminalFullscreen,
	showThinking,
	debugMode = false,
	expandThinking,
	toolDisplayMode,
	sessionAgentProfile,
	sessionActiveModel,
	sessionRuntimeBinding,
	selectedSessionStatus,
	selectedSessionSignal,
	signals,
	sessionGoal,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	agentProfiles,
	sessionProfileChangeDisabled,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onLoadOlderTracePage,
	hasOlderTraceEvents,
	isFetchingOlderTracePage,
	onThinkingLevelChange,
	onModelChanged,
}: ChatSessionViewProps) {
	const rows = useMemo(
		() => buildCompactTerminalRows(traceView, { showThinking, toolDisplayMode, debugMode }),
		[showThinking, toolDisplayMode, debugMode, traceView],
	);
	const rowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
	const piboSessionId = traceView?.piboSessionId ?? "";
	const [reloadReadingPosition, setReloadReadingPosition] = useState<TerminalReadingPosition | undefined>();
	const requestedRestorePageRef = useRef<string | undefined>(undefined);
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [imageDialog, setImageDialog] = useState<TerminalImageDialogState | null>(null);
	const renderedContentKey = useMemo(() => [rows, expandedRows] as const, [expandedRows, rows]);
	const [focusedNavigationRowId, setFocusedNavigationRowId] = useState<string | null>(null);
	const navigationCursorRef = useRef<Partial<Record<TerminalNavigationKind, string>>>({});
	const rangePrefetchReadyRef = useRef(false);
	const olderTraceIntentRef = useRef(false);
	const olderTraceRequestPendingRef = useRef(false);
	const scrollbarDragActiveRef = useRef(false);
	const scrollbarDragDeferredLoadRef = useRef(false);
	const prepareOlderTracePrependRef = useRef<() => void>(() => undefined);
	const userMessageCount = rows.filter((row) => isNavigableTerminalRow(row, "user")).length;
	const toolErrorCount = rows.filter((row) => isNavigableTerminalRow(row, "tool")).length;
	const errorCount = rows.filter((row) => isNavigableTerminalRow(row, "system")).length;
	const traceTurnStartedAt = useMemo(() => findActiveTurnStartedAt(traceView), [traceView]);
	const sessionActivity = useSessionActivity({
		signal: selectedSessionSignal,
		fallbackStatus: selectedSessionStatus,
		fallbackTurnStartedAt: traceTurnStartedAt,
	});
	const activeTurnStartedAt = sessionActivity.activeTurnStartedAt;
	const isStreaming = sessionActivity.isTurnActive;
	const showGoalIndicator = Boolean(sessionGoalIndicatorStatus(sessionGoal));

	useLayoutEffect(() => {
		if (!piboSessionId || !traceView || !isTraceSnapshotCollectionEnabled()) return;
		collectTerminalRows(piboSessionId, "compact-terminal:render", rows, {
			traceVersion: traceView.version,
			latestStreamId: traceView.latestStreamId,
			lastRawEventId: traceView.rawEvents.at(-1)?.id,
			selectedSessionStatus,
		});
	}, [piboSessionId, rows, selectedSessionStatus, traceView]);

	const loadOlderTracePage = useCallback(() => {
		if (!hasOlderTraceEvents || isFetchingOlderTracePage || olderTraceRequestPendingRef.current) return;
		if (scrollbarDragActiveRef.current) {
			scrollbarDragDeferredLoadRef.current = true;
			return;
		}
		olderTraceRequestPendingRef.current = true;
		olderTraceIntentRef.current = false;
		prepareOlderTracePrependRef.current();
		const request = onLoadOlderTracePage?.();
		void Promise.resolve(request).then(
			() => { olderTraceRequestPendingRef.current = false; },
			() => { olderTraceRequestPendingRef.current = false; },
		);
	}, [hasOlderTraceEvents, isFetchingOlderTracePage, onLoadOlderTracePage]);
	const loadOlderNearTop = useCallback(() => {
		if (!rangePrefetchReadyRef.current) return;
		if (!olderTraceIntentRef.current) return;
		loadOlderTracePage();
	}, [loadOlderTracePage]);
	const loadOlderAtTop = useCallback(() => {
		if (!rangePrefetchReadyRef.current) return;
		if (!olderTraceIntentRef.current && !scrollbarDragActiveRef.current) return;
		loadOlderTracePage();
	}, [loadOlderTracePage]);
	const handleScrollbarDragChange = useCallback((active: boolean) => {
		scrollbarDragActiveRef.current = active;
		if (active || !scrollbarDragDeferredLoadRef.current) return;
		scrollbarDragDeferredLoadRef.current = false;
		loadOlderTracePage();
	}, [loadOlderTracePage]);
	const markOlderTraceIntent = useCallback((event?: Event, direction?: "away" | "toward") => {
		if (isOlderTraceScrollIntent(event, direction)) olderTraceIntentRef.current = true;
	}, []);
	const handleVisibleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
		if (!rangePrefetchReadyRef.current || toolDisplayMode !== "default") return;
		if (range.startIndex <= OLDER_TRACE_PREFETCH_ROW_THRESHOLD) loadOlderNearTop();
	}, [loadOlderNearTop, toolDisplayMode]);
	const persistVisibleAnchor = useCallback((anchor: { key: string; offset: number } | undefined) => {
		if (!piboSessionId) return;
		writeTerminalReadingPosition(piboSessionId, anchor ? { rowId: anchor.key, offsetPx: anchor.offset } : undefined);
	}, [piboSessionId]);

	const olderTracePrefetchTopThreshold = toolDisplayMode === "default"
		? OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX
		: COMPACT_TOOL_MODE_PREFETCH_TOP_THRESHOLD_PX;
	const stickyView = useStickyVirtuoso({
		itemCount: rows.length,
		itemKeys: rowKeys,
		isPrepending: isFetchingOlderTracePage,
		resetKey: traceView?.piboSessionId,
		contentKey: renderedContentKey,
		atBottomThreshold: SHOW_LATEST_THRESHOLD_PX,
		nearTopThreshold: olderTracePrefetchTopThreshold,
		onAtTop: loadOlderAtTop,
		onNearTop: loadOlderNearTop,
		onUserScrollIntent: markOlderTraceIntent,
		onScrollbarDragChange: handleScrollbarDragChange,
		onVisibleAnchorChange: persistVisibleAnchor,
	});
	prepareOlderTracePrependRef.current = stickyView.prepareForPrepend;

	useEffect(() => {
		requestedRestorePageRef.current = undefined;
		olderTraceRequestPendingRef.current = false;
		scrollbarDragActiveRef.current = false;
		scrollbarDragDeferredLoadRef.current = false;
		setReloadReadingPosition(piboSessionId ? readTerminalReadingPosition(piboSessionId) : undefined);
		setImageDialog(null);
	}, [piboSessionId]);

	useEffect(() => {
		if (!piboSessionId || !reloadReadingPosition) return undefined;
		const rowIndex = rowKeys.indexOf(reloadReadingPosition.rowId);
		if (rowIndex >= 0) {
			const frame = requestAnimationFrame(() => {
				if (stickyView.restoreAnchor({ key: reloadReadingPosition.rowId, dataIndex: rowIndex, offset: reloadReadingPosition.offsetPx })) {
					setReloadReadingPosition(undefined);
				}
			});
			return () => cancelAnimationFrame(frame);
		}
		if (!hasOlderTraceEvents) {
			writeTerminalReadingPosition(piboSessionId, undefined);
			setReloadReadingPosition(undefined);
			return undefined;
		}
		if (isFetchingOlderTracePage) return undefined;
		const cursor = String(traceView?.nextBeforeCursor ?? traceView?.nextBeforeSequence ?? rows.length);
		const requestKey = `${piboSessionId}:${cursor}`;
		if (requestedRestorePageRef.current === requestKey) return undefined;
		requestedRestorePageRef.current = requestKey;
		onLoadOlderTracePage?.();
		return undefined;
	}, [hasOlderTraceEvents, isFetchingOlderTracePage, onLoadOlderTracePage, piboSessionId, reloadReadingPosition, rowKeys, rows.length, stickyView.restoreAnchor, traceView?.nextBeforeCursor, traceView?.nextBeforeSequence]);

	useEffect(() => {
		if (!piboSessionId) return undefined;
		const persistBeforePageExit = () => { stickyView.captureVisibleAnchor(); };
		const persistWhenHidden = () => {
			if (document.visibilityState === "hidden") persistBeforePageExit();
		};
		window.addEventListener("beforeunload", persistBeforePageExit);
		window.addEventListener("pagehide", persistBeforePageExit);
		document.addEventListener("visibilitychange", persistWhenHidden);
		return () => {
			window.removeEventListener("beforeunload", persistBeforePageExit);
			window.removeEventListener("pagehide", persistBeforePageExit);
			document.removeEventListener("visibilitychange", persistWhenHidden);
		};
	}, [piboSessionId, stickyView.captureVisibleAnchor]);

	useEffect(() => {
		setExpandedRows((current) => retainExistingExpandedRows(current, rows, expandThinking));
	}, [expandThinking, rows]);

	useEffect(() => {
		rangePrefetchReadyRef.current = false;
		olderTraceIntentRef.current = false;
		const readyTimer = window.setTimeout(() => {
			rangePrefetchReadyRef.current = true;
		}, 250);
		return () => window.clearTimeout(readyTimer);
	}, [traceView?.piboSessionId]);

	useEffect(() => {
		const rowIds = new Set(rows.map((row) => row.id));
		setFocusedNavigationRowId((current) => (current && rowIds.has(current) ? current : null));
		for (const kind of ["system", "tool", "user"] as const) {
			const current = navigationCursorRef.current[kind];
			if (current && !rowIds.has(current)) delete navigationCursorRef.current[kind];
		}
	}, [rows]);

	const navigateToTerminalRow = useCallback((kind: TerminalNavigationKind) => {
		const target = nextNavigationTarget(rows, kind, navigationCursorRef.current[kind]);
		if (!target) return;
		navigationCursorRef.current[kind] = target.row.id;
		setFocusedNavigationRowId(target.row.id);
		stickyView.scrollToIndex(target.index, "start", "fast-smooth", {
			fromIndex: target.fromIndex,
			stagingAlign: kind === "tool" ? "end" : undefined,
		});
		focusTerminalRowAfterScroll(target.row.id);
	}, [rows, stickyView]);

	const toggleRow = (row: CompactTerminalRow) => {
		if (!row.expandable) return;
		setExpandedRows((current) => {
			const next = new Set(current);
			if (next.has(row.id)) next.delete(row.id);
			else next.add(row.id);
			return next;
		});
	};
	const openImagePreviews = useCallback((images: readonly CompactTerminalImagePreview[]) => {
		const previewable = previewableTerminalImages(images);
		if (previewable.length) setImageDialog({ images: previewable, index: 0 });
	}, []);
	const renderRow = useCallback((_: number, row: CompactTerminalRow) => (
		<div className="px-4 @max-[420px]:px-2">
			<TerminalRow
				row={row}
				debugMode={debugMode}
				expanded={expandedRows.has(row.id)}
				focused={focusedNavigationRowId === row.id}
				piboSessionId={traceView?.piboSessionId ?? ""}
				onToggle={() => toggleRow(row)}
				onFork={onFork}
				onOpenSession={onOpenSession}
				onThinkingLevelChange={onThinkingLevelChange}
				onModelChanged={onModelChanged}
				onViewImages={openImagePreviews}
				signals={signals}
			/>
		</div>
	), [debugMode, expandedRows, focusedNavigationRowId, onFork, onModelChanged, onOpenSession, onThinkingLevelChange, openImagePreviews, signals, traceView?.piboSessionId]);

	const virtuosoComponents = useMemo(() => ({
		Footer: isStreaming || showGoalIndicator
			? () => <TerminalStreamingFooter startedAt={activeTurnStartedAt} isWorking={isStreaming} goal={sessionGoal} />
			: undefined,
	}), [activeTurnStartedAt, isStreaming, sessionGoal, showGoalIndicator]);

	return (
		<section
			className="relative min-w-0 flex-1 flex flex-col overflow-hidden bg-[#0b0b0b] text-[#d4d4d4]"
			data-pibo-component="CompactTerminalSessionView"
			data-pibo-debug="compact-terminal-session-view"
			data-pibo-session-id={traceView?.piboSessionId ?? undefined}
			data-pibo-terminal-fullscreen={terminalFullscreen ? "true" : "false"}
			data-pibo-trace-has-older={traceView?.hasOlderEvents === true ? "true" : "false"}
			data-pibo-trace-next-before={traceView?.nextBeforeCursor ?? traceView?.nextBeforeSequence ?? ""}
		>
			{terminalFullscreen ? null : (
				<TerminalHeader
					errorCount={errorCount}
					toolErrorCount={toolErrorCount}
					userMessageCount={userMessageCount}
					onNavigate={navigateToTerminalRow}
					sessionAgentProfile={sessionAgentProfile}
					sessionActiveModel={sessionActiveModel}
					sessionRuntimeBinding={sessionRuntimeBinding}
					sessionBreadcrumbs={sessionBreadcrumbs}
					originSession={originSession}
					derivedSessions={derivedSessions}
					onOpenSession={onOpenSession}
				/>
			)}

			<div className="min-h-0 flex-1 overflow-hidden">
				{!traceView ? (
					<EmptyTerminalState
						isLoading={isLoading}
						agentProfiles={agentProfiles}
						disabled={sessionProfileChangeDisabled}
						onSelectAgentProfile={onSessionAgentProfileChange}
					/>
				) : rows.length ? (
					<Virtuoso
						ref={stickyView.virtuosoRef}
						data={rows}
						firstItemIndex={stickyView.firstItemIndex}
						initialTopMostItemIndex={INITIAL_BOTTOM_ITEM}
						increaseViewportBy={VIRTUOSO_VIEWPORT}
						defaultItemHeight={DEFAULT_ROW_HEIGHT_PX}
						className="min-h-0 h-full overflow-x-hidden font-mono text-[12px] leading-[1.45]"
						computeItemKey={(_, row) => row.id}
						scrollerRef={stickyView.scrollerRef}
						atBottomStateChange={stickyView.atBottomStateChange}
						atBottomThreshold={stickyView.atBottomThreshold}
						itemsRendered={stickyView.itemsRendered}
						rangeChanged={(range) => handleVisibleRangeChanged(stickyView.normalizeRange(range))}
						followOutput={stickyView.followOutput}
						totalListHeightChanged={stickyView.totalListHeightChanged}
						alignToBottom
						components={virtuosoComponents}
						itemContent={renderRow}
					/>
				) : (
					<EmptyTerminalState
						isLoading={isLoading}
						agentProfiles={agentProfiles}
						disabled={sessionProfileChangeDisabled}
						onSelectAgentProfile={onSessionAgentProfileChange}
						message="No visible trace rows yet."
					/>
				)}
			</div>

			{rows.length === 0 && showGoalIndicator ? <TerminalStreamingFooter isWorking={false} goal={sessionGoal} /> : null}

			{imageDialog ? (
				<TerminalImageDialog
					state={imageDialog}
					piboSessionId={piboSessionId}
					onClose={() => setImageDialog(null)}
					onIndexChange={(index) => setImageDialog((current) => current ? {
						...current,
						index: Math.min(Math.max(index, 0), current.images.length - 1),
					} : null)}
				/>
			) : null}

			{!stickyView.isSticky ? (
				<button
					type="button"
					onClick={() => {
						writeTerminalReadingPosition(piboSessionId, undefined);
						stickyView.stickToBottom("auto");
					}}
					title="Scroll to latest"
					aria-label="Scroll to latest"
					className="absolute right-4 bottom-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-sm border border-[#38bdf8] bg-[#111111]/95 text-[#38bdf8] shadow-lg shadow-black/30 hover:bg-[#161616]"
				>
					<ChevronDown size={18} />
				</button>
			) : null}
		</section>
	);
}

function TerminalHeader({
	errorCount,
	toolErrorCount,
	userMessageCount,
	onNavigate,
	sessionAgentProfile,
	sessionActiveModel,
	sessionRuntimeBinding,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	onOpenSession,
}: {
	errorCount: number;
	toolErrorCount: number;
	userMessageCount: number;
	onNavigate: (kind: TerminalNavigationKind) => void;
	sessionAgentProfile?: string;
	sessionActiveModel?: string;
	sessionRuntimeBinding?: ChatSessionViewProps["sessionRuntimeBinding"];
	sessionBreadcrumbs: ChatSessionViewProps["sessionBreadcrumbs"];
	originSession: ChatSessionViewProps["originSession"];
	derivedSessions: ChatSessionViewProps["derivedSessions"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
}) {
	return (
		<div data-pibo-debug="compact-terminal-header" className="border-b border-[#2a2a2a] bg-[#111111] px-4 py-2 text-[11px] @max-[420px]:px-2">
			<div className="flex flex-wrap items-center gap-2">
				{sessionAgentProfile ? <TerminalBadge tone="neutral">{sessionAgentProfile}</TerminalBadge> : null}
				{sessionRuntimeBinding ? (
					<TerminalBadge
						tone={sessionRuntimeBinding.state === "missing" || sessionRuntimeBinding.state === "error" ? "red" : sessionRuntimeBinding.state === "unbound" ? "amber" : "cyan"}
						label={`Runtime ${sessionRuntimeBinding.runtimeInstanceId} · ${sessionRuntimeBinding.state}`}
					>
						{sessionRuntimeBinding.runtimeInstanceId} · {sessionRuntimeBinding.state}
					</TerminalBadge>
				) : null}
				{sessionActiveModel ? <TerminalBadge tone="purple">{sessionActiveModel}</TerminalBadge> : null}
				{userMessageCount > 0 ? (
					<TerminalBadge tone="cyan" label={`${userMessageCount} user messages · jump to previous user message`} onClick={() => onNavigate("user")}>
						{userMessageCount}<MessageSquare size={12} />
					</TerminalBadge>
				) : null}
				{errorCount > 0 ? (
					<TerminalBadge tone="red" label={`${errorCount} errors · jump to previous error`} onClick={() => onNavigate("system")}>
						{errorCount}<CircleX size={12} />
					</TerminalBadge>
				) : null}
				{toolErrorCount > 0 ? (
					<TerminalBadge tone="amber" label={`${toolErrorCount} tool call errors · jump to previous tool error`} onClick={() => onNavigate("tool")}>
						{toolErrorCount}<Hammer size={12} />
					</TerminalBadge>
				) : null}
				{originSession ? (
					<SessionLinkButton onClick={() => onOpenSession(originSession.piboSessionId)}>
						Origin {originSession.label}
					</SessionLinkButton>
				) : null}
				{derivedSessions.map((session) => (
					<SessionLinkButton key={session.piboSessionId} onClick={() => onOpenSession(session.piboSessionId)}>
						Derived {session.label}
					</SessionLinkButton>
				))}
			</div>
			{sessionBreadcrumbs.length ? (
				<div className="mt-2 flex flex-wrap items-center gap-1 text-[#737373]">
					{sessionBreadcrumbs.map((item, index) => (
						<div key={item.piboSessionId} className="flex items-center gap-1">
							{index > 0 ? <ChevronRight size={12} className="text-[#525252]" /> : null}
							<button type="button" onClick={() => onOpenSession(item.piboSessionId)} className="hover:text-[#38bdf8]">
								{item.label}
							</button>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function SessionLinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
	return (
		<button type="button" onClick={onClick} className="border border-[#3a3a3a] px-2 py-0.5 text-[#38bdf8] hover:border-[#38bdf8]">
			{children}
		</button>
	);
}

function TerminalRow({
	row,
	debugMode,
	expanded,
	focused,
	piboSessionId,
	onToggle,
	onFork,
	onOpenSession,
	onThinkingLevelChange,
	onModelChanged,
	onViewImages,
	signals,
}: {
	row: CompactTerminalRow;
	debugMode: boolean;
	expanded: boolean;
	focused: boolean;
	piboSessionId: string;
	onToggle: () => void;
	onFork: ChatSessionViewProps["onFork"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
	onThinkingLevelChange: ChatSessionViewProps["onThinkingLevelChange"];
	onModelChanged: ChatSessionViewProps["onModelChanged"];
	onViewImages: (images: readonly CompactTerminalImagePreview[]) => void;
	signals: ChatSessionViewProps["signals"];
}) {
	const collapseToolCallPreview = !expanded && isToolCallLikeRow(row);
	const visibleLines = collapseToolCallPreview ? collapsedToolCallPreviewLines(row) : row.lines;
	const handleRowDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
		if (!row.expandable || isInteractiveEventTarget(event)) return;
		onToggle();
	};
	const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!row.expandable || isInteractiveEventTarget(event)) return;
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onToggle();
		}
	};

	if (row.kind === "agent.delegation") {
		return (
			<div
				className={terminalRowClassName(row, focused)}
				data-pibo-component="TerminalRow"
				data-pibo-debug="terminal-row"
				data-pibo-terminal-row="true"
				data-row-id={row.id}
				data-row-kind={row.kind}
				data-row-status={row.status}
				data-trace-node-id={row.sourceNodeIds.join(" ")}
				data-event-id={row.eventId}
				data-run-id={row.runId}
				data-order-source={row.orderSource}
				data-order-stream-id={row.orderStreamId}
				data-order-frame-index={row.orderStreamFrameIndex}
				tabIndex={focused ? 0 : undefined}
				aria-current={focused ? "true" : undefined}
			>
				<AgentDelegationCard
					title={row.title}
					summary={row.summary}
					input={row.input}
					output={row.output}
					error={row.error}
					traceStatus={row.status === "neutral" ? "done" : row.status}
					linkedPiboSessionId={row.linkedPiboSessionId}
					startedAt={row.startedAt}
					completedAt={row.completedAt}
					durationMs={row.durationMs}
					signals={signals}
					onOpenSession={onOpenSession}
				/>
				{debugMode && row.isToolCall ? <TerminalToolMetrics metrics={row.toolMetrics} /> : null}
			</div>
		);
	}

	return (
		<div
			className={terminalRowClassName(row, focused)}
			data-pibo-component="TerminalRow"
			data-pibo-debug="terminal-row"
			data-pibo-terminal-row="true"
			data-row-id={row.id}
			data-row-kind={row.kind}
			data-row-status={row.status}
			data-trace-node-id={row.sourceNodeIds.join(" ")}
			data-event-id={row.eventId}
			data-run-id={row.runId}
			data-order-source={row.orderSource}
			data-order-stream-id={row.orderStreamId}
			data-order-frame-index={row.orderStreamFrameIndex}
			onDoubleClick={row.expandable ? handleRowDoubleClick : undefined}
			onKeyDown={row.expandable ? handleRowKeyDown : undefined}
			role={row.expandable ? "button" : undefined}
			tabIndex={row.expandable || focused ? 0 : undefined}
			aria-expanded={row.expandable ? expanded : undefined}
			aria-current={focused ? "true" : undefined}
		>
			<div className="flex gap-3">
				<div className="min-w-0 flex-1">
					<TerminalRowContent
						row={row}
						visibleLines={visibleLines}
						collapseToolCallPreview={collapseToolCallPreview}
						piboSessionId={piboSessionId}
						onThinkingLevelChange={onThinkingLevelChange}
						onModelChanged={onModelChanged}
						onFork={onFork}
					/>
				</div>
				<TerminalRowActions row={row} onOpenSession={onOpenSession} onViewImages={onViewImages} />
			</div>
			{expanded ? <TerminalDetails row={row} onOpenSession={onOpenSession} /> : null}
			{debugMode && row.isToolCall ? <TerminalToolMetrics metrics={row.toolMetrics} /> : null}
		</div>
	);
}

function TerminalRowContent({
	row,
	visibleLines,
	collapseToolCallPreview,
	piboSessionId,
	onThinkingLevelChange,
	onModelChanged,
	onFork,
}: {
	row: CompactTerminalRow;
	visibleLines: CompactTerminalLine[];
	collapseToolCallPreview: boolean;
	piboSessionId: string;
	onThinkingLevelChange: ChatSessionViewProps["onThinkingLevelChange"];
	onModelChanged: ChatSessionViewProps["onModelChanged"];
	onFork: ChatSessionViewProps["onFork"];
}) {
	if (row.kind === "message.assistant") {
		return (
			<div className="ml-[1.9rem] min-w-0" data-pibo-component="TerminalAssistantMessage">
				<div className="compact-terminal-markdown" data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="assistant-message">
					<MarkdownRenderer streaming={row.status === "running"}>{typeof row.output === "string" ? row.output : ""}</MarkdownRenderer>
				</div>
				{row.status === "running" ? null : (
					<TerminalMessageMetadata
						timestamp={row.completedAt}
						durationMs={row.durationMs}
						speechText={typeof row.output === "string" ? row.output : undefined}
						speechScopeKey={`${piboSessionId}:${row.id}`}
					/>
				)}
			</div>
		);
	}
	if (row.kind === "message.user") {
		return (
			<>
				<TerminalLines lines={visibleLines} status={row.status} clampPreview={collapseToolCallPreview} singleLine={row.singleLine} />
				{row.pendingMessageDelivery ? (
					<PendingUserMessageDelivery delivery={row.pendingMessageDelivery} className="ml-[1.9rem] mt-2" />
				) : null}
				<TerminalMessageMetadata timestamp={row.startedAt} forkEntryId={row.forkEntryId} onFork={onFork} />
			</>
		);
	}
	if (row.kind === "tool.status") return <TerminalStatusCard row={row} piboSessionId={piboSessionId} />;
	if (row.kind === "tool.thinking") return <TerminalThinkingCard row={row} onLevelSelect={onThinkingLevelChange} />;
	if (row.kind === "tool.login") return <TerminalLoginCard row={row} piboSessionId={piboSessionId} />;
	if (row.kind === "tool.model") return <TerminalModelCard row={row} piboSessionId={piboSessionId} onModelChanged={onModelChanged} />;
	if (row.kind === "execution.compaction" && row.status === "running") return <TerminalCompactionLine />;
	if (row.kind === "reasoning" && row.markdown) {
		return (
			<>
				<TerminalLines lines={visibleLines} status={row.status} clampPreview={collapseToolCallPreview} singleLine={row.singleLine} />
				<div className="ml-[1.9rem] min-w-0" data-pibo-component="TerminalReasoningMarkdown">
					<div className="compact-terminal-markdown compact-terminal-reasoning" data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="reasoning">
						<MarkdownRenderer streaming={row.status === "running"}>{row.markdown}</MarkdownRenderer>
					</div>
				</div>
			</>
		);
	}
	return <TerminalLines lines={visibleLines} status={row.status} clampPreview={collapseToolCallPreview} singleLine={row.singleLine} />;
}

function TerminalLines({
	lines,
	status,
	clampPreview,
	singleLine,
}: {
	lines: CompactTerminalLine[];
	status: CompactTerminalRow["status"];
	clampPreview: boolean;
	singleLine?: boolean;
}) {
	return lines.map((line, index) => (
		<TerminalLine key={index} line={line} status={status} clampLines={singleLine ? 1 : clampPreview && index === 0 ? 5 : undefined} />
	));
}

function TerminalMessageMetadata({
	timestamp,
	durationMs,
	forkEntryId,
	onFork,
	speechText,
	speechScopeKey,
}: {
	timestamp?: string;
	durationMs?: number;
	forkEntryId?: string;
	onFork?: ChatSessionViewProps["onFork"];
	speechText?: string;
	speechScopeKey?: string;
}) {
	const time = formatLocalMessageTime(timestamp);
	if (!time && !forkEntryId && !speechText?.trim()) return null;
	return (
		<div className="mt-1 flex items-center justify-end gap-1 font-mono text-[10px] tabular-nums text-[#737373]" data-pibo-component="TerminalMessageMetadata">
			{forkEntryId && onFork ? <MessageForkButton entryId={forkEntryId} onFork={onFork} /> : null}
			{speechText?.trim() ? <MessageSpeechButton text={speechText} scopeKey={speechScopeKey} /> : null}
			{time ? <span>{time}{durationMs === undefined ? null : ` · ${formatTerminalDuration(durationMs)}`}</span> : null}
		</div>
	);
}

function formatLocalMessageTime(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const timestamp = new Date(value);
	if (!Number.isFinite(timestamp.getTime())) return undefined;
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(timestamp);
}

function TerminalRowActions({
	row,
	onOpenSession,
	onViewImages,
}: {
	row: CompactTerminalRow;
	onOpenSession: ChatSessionViewProps["onOpenSession"];
	onViewImages: (images: readonly CompactTerminalImagePreview[]) => void;
}) {
	const images = previewableTerminalImages(row.imagePreviews ?? []);
	if (!row.linkedPiboSessionId && images.length === 0) return null;
	return (
		<div className="flex shrink-0 items-start gap-1">
			{images.length ? (
				<RowAction label={images.length === 1 ? "View image preview" : `View ${images.length} image previews`} onClick={() => onViewImages(images)}>
					<Images size={13} aria-hidden="true" /> View
				</RowAction>
			) : null}
			{row.linkedPiboSessionId ? (
				<RowAction label="Open linked session" onClick={() => onOpenSession(row.linkedPiboSessionId!)}>
					Open
				</RowAction>
			) : null}
		</div>
	);
}

function TerminalImageDialog({
	state,
	piboSessionId,
	onClose,
	onIndexChange,
}: {
	state: TerminalImageDialogState;
	piboSessionId: string;
	onClose: () => void;
	onIndexChange: (index: number) => void;
}) {
	const image = state.images[state.index];
	const source = image ? chatImagePreviewUrls(image, piboSessionId)[0] : undefined;
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const navigationFocusRef = useRef<HTMLDivElement>(null);
	const hasPrevious = state.index > 0;
	const hasNext = state.index + 1 < state.images.length;
	useEffect(() => setLoadState(source ? "loading" : "error"), [image?.id, source]);

	const navigate = (index: number) => {
		if (index < 0 || index >= state.images.length) return;
		onIndexChange(index);
		window.requestAnimationFrame(() => navigationFocusRef.current?.focus());
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "ArrowLeft" && hasPrevious) navigate(state.index - 1);
		else if (event.key === "ArrowRight" && hasNext) navigate(state.index + 1);
		else if (event.key === "Home" && hasPrevious) navigate(0);
		else if (event.key === "End" && hasNext) navigate(state.images.length - 1);
		else return;
		event.preventDefault();
	};

	return (
		<DialogShell
				title="Image preview"
				description={`${image?.label ?? "Image"} · ${state.index + 1} of ${state.images.length}`}
				onClose={onClose}
				initialFocusRef={navigationFocusRef}
				onKeyDown={handleKeyDown}
			closeLabel="Close image preview"
			maxWidthClassName="max-w-6xl"
		>
			<div
				ref={navigationFocusRef}
				tabIndex={-1}
					className="flex min-h-[12rem] flex-col bg-[#0b0b0b] outline-none sm:min-h-[18rem]"
					data-pibo-component="TerminalImageDialog"
				>
				<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-4">
					{source ? (
						<img
							key={source}
							src={source}
							alt={`Tool image: ${image?.label ?? "image preview"}`}
							loading="lazy"
							decoding="async"
							onLoad={() => setLoadState("loaded")}
							onError={() => setLoadState("error")}
							className={`max-h-[calc(100dvh-12rem)] max-w-full object-contain ${loadState === "loaded" ? "block" : "invisible"}`}
						/>
					) : null}
					{loadState === "loading" ? (
						<div className="absolute inset-0 grid place-items-center text-xs text-[#a3a3a3]" role="status">Loading image preview…</div>
					) : null}
					{loadState === "error" ? (
						<div className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-[#f87171]" role="alert">Image preview is unavailable.</div>
					) : null}
				</div>
				<div className="flex items-center justify-between gap-3 border-t border-[#2a2a2a] px-3 py-2">
					<RowAction label="Previous image" onClick={() => navigate(state.index - 1)} disabled={!hasPrevious}>
						<ChevronLeft size={14} aria-hidden="true" /> Previous
					</RowAction>
					<span className="text-[11px] tabular-nums text-[#a3a3a3]" aria-live="polite">{state.index + 1} / {state.images.length}</span>
					<RowAction label="Next image" onClick={() => navigate(state.index + 1)} disabled={!hasNext}>
						Next <ChevronRight size={14} aria-hidden="true" />
					</RowAction>
				</div>
			</div>
		</DialogShell>
	);
}

function previewableTerminalImages(images: readonly CompactTerminalImagePreview[]): CompactTerminalImagePreview[] {
	return images
		.filter((image) => Boolean(image.payloadRef ? image.traceNodeId : image.generatedToolCallId || image.path))
		.slice(0, MAX_COMPACT_TERMINAL_IMAGE_PREVIEWS);
}

function terminalRowClassName(row: CompactTerminalRow, focused = false): string {
	const base =
		row.kind === "message.user"
			? "group border-b border-[#141414] bg-[#11a4d4]/10 py-2 last:border-b-0 hover:bg-[#11a4d4]/15"
			: row.kind === "agent.delegation"
				? "group border-b border-[#141414] bg-[#f97316]/5 py-2 last:border-b-0"
				: row.kind === "execution.command"
				? "group border-b border-[#141414] bg-[#f59e0b]/5 py-2 last:border-b-0 hover:bg-[#f59e0b]/10"
				: "group border-b border-[#141414] py-2 last:border-b-0 hover:bg-[#161616]";
	const focusClass = row.expandable || focused ? " focus:outline-none focus:ring-1 focus:ring-[#38bdf8]/50" : "";
	return focused ? `${base}${focusClass} ring-1 ring-[#38bdf8] bg-[#123040]` : `${base}${focusClass}`;
}

function retainExistingExpandedRows(
	current: Set<string>,
	rows: readonly CompactTerminalRow[],
	expandThinking: boolean,
): Set<string> {
	const next = new Set<string>();
	for (const row of rows) {
		if (current.has(row.id)) next.add(row.id);
		if (expandThinking && row.kind === "reasoning" && row.expandable) next.add(row.id);
	}
	return sameSet(current, next) ? current : next;
}

function isNavigableTerminalRow(row: CompactTerminalRow, kind: TerminalNavigationKind): boolean {
	if (kind === "user") return row.kind === "message.user";
	if (row.status !== "error") return false;
	return kind === "tool" ? row.errorKind === "tool" : row.errorKind !== "tool";
}

function nextNavigationTarget(
	rows: readonly CompactTerminalRow[],
	kind: TerminalNavigationKind,
	currentRowId: string | undefined,
): { row: CompactTerminalRow; index: number; fromIndex: number } | undefined {
	const candidates = rows
		.map((row, index) => ({ row, index }))
		.filter(({ row }) => isNavigableTerminalRow(row, kind));
	if (!candidates.length) return undefined;
	const currentIndex = currentRowId ? rows.findIndex((row) => row.id === currentRowId) : -1;
	const fromIndex = currentIndex >= 0 ? currentIndex : rows.length;
	const target = candidates.filter((candidate) => candidate.index < fromIndex).at(-1) ?? candidates[candidates.length - 1];
	return { ...target, fromIndex };
}

function focusTerminalRowAfterScroll(rowId: string): void {
	let attempts = 0;
	const focusRow = () => {
		const row = Array.from(document.querySelectorAll<HTMLElement>('[data-pibo-component="TerminalRow"]'))
			.find((element) => element.dataset.rowId === rowId);
		if (row) {
			row.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" });
			row.focus({ preventScroll: true });
			return;
		}
		attempts += 1;
		if (attempts < 8) requestAnimationFrame(focusRow);
	};
	requestAnimationFrame(() => requestAnimationFrame(focusRow));
}

function collapsedToolCallPreviewLines(row: { kind: string; lines: CompactTerminalLine[] }) {
	if (row.kind === "tool.group.exploring" || row.kind === "tool.group.images") return row.lines.slice(0, COLLAPSED_EXPLORING_PREVIEW_LINES);
	return row.lines;
}

function isToolCallLikeRow(row: { kind: string; expandable?: boolean }) {
	return Boolean(row.expandable) && (
		row.kind === "tool.call" ||
		row.kind === "tool.image" ||
		row.kind === "tool.group.exploring" ||
		row.kind === "tool.group.images" ||
		row.kind === "agent.delegation" ||
		row.kind === "agent.async" ||
		row.kind === "yielded.run" ||
		row.kind === "execution.command" ||
		row.kind === "execution.compaction"
	);
}

function isInteractiveEventTarget(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
	const target = event.target;
	if (!(target instanceof Element) || target === event.currentTarget) return false;
	const interactiveTarget = target.closest("button, a, input, textarea, select, summary, [role='button'], [tabindex]:not([tabindex='-1'])");
	return Boolean(interactiveTarget && interactiveTarget !== event.currentTarget);
}

const WORKING_SCRAMBLE_TARGET = "Working...";
const WORKING_SCRAMBLE_ASCII_START = 33;
const WORKING_SCRAMBLE_ASCII_END = 126;

function TerminalStreamingFooter({ startedAt, isWorking, goal }: { startedAt?: string; isWorking: boolean; goal?: ChatSessionViewProps["sessionGoal"] }) {
	const elapsed = useActiveTurnElapsed(isWorking ? startedAt : undefined);
	const { chars, activeIndex } = useWorkingScramble(WORKING_SCRAMBLE_TARGET, isWorking);
	const goalStatus = sessionGoalIndicatorStatus(goal);
	const goalTokenUsage = goal && goalStatus === "active" ? formatSessionGoalTokenUsage(goal) : undefined;
	const footerAriaLabel = [
		isWorking ? "Working" : undefined,
		goalStatus === "active" ? "Pursuing Goal" : goalStatus === "paused" ? "Goal Paused" : undefined,
		goalTokenUsage ? `Tokens ${goalTokenUsage}` : undefined,
	].filter(Boolean).join(". ");

	return (
		<div
			className="border-t border-[#141414] px-4 py-2 @max-[420px]:px-2"
			role="status"
			aria-live="polite"
			aria-label={footerAriaLabel}
			data-pibo-component="TerminalStreamingFooter"
			data-pibo-active-turn-started-at={isWorking ? startedAt : undefined}
		>
			<div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1" aria-hidden="true">
				{isWorking ? (
					<div className="grid min-w-0 flex-1 grid-cols-[1.9rem_minmax(0,1fr)] gap-2 whitespace-pre-wrap break-words">
						<span className="whitespace-pre text-[#737373]">•</span>
						<span className="inline-flex min-w-0 items-baseline gap-2">
							{elapsed ? <span className="shrink-0 tabular-nums text-[#737373]">{elapsed}</span> : null}
							<span className="compact-terminal-working-scramble">
								{chars.map((char, index) => (
									<span
										key={index}
										className={index === activeIndex ? "compact-terminal-working-scramble-active" : undefined}
									>
										{char}
									</span>
								))}
							</span>
						</span>
					</div>
				) : <span className="min-w-0 flex-1" />}
				<SessionGoalIndicator goal={goal} />
			</div>
		</div>
	);
}

function useWorkingScramble(target: string, enabled: boolean) {
	const targetChars = useMemo(() => Array.from(target), [target]);
	const [chars, setChars] = useState(() => targetChars);
	const [activeIndex, setActiveIndex] = useState(-1);

	useEffect(() => {
		if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setChars(targetChars);
			setActiveIndex(-1);
			return;
		}

		let index = 0;
		let rotationFrame = 0;
		let rotationsForChar = randomRotationCount();
		let pauseTicks = 0;
		setChars(randomAsciiChars(targetChars));
		setActiveIndex(0);

		const interval = window.setInterval(() => {
			if (pauseTicks > 0) {
				pauseTicks--;
				return;
			}

			if (index >= targetChars.length) {
				index = 0;
				rotationFrame = 0;
				rotationsForChar = randomRotationCount();
				setChars(randomAsciiChars(targetChars));
				setActiveIndex(0);
				return;
			}

			const currentIndex = index;
			const targetChar = targetChars[currentIndex] ?? " ";
			setActiveIndex(currentIndex);
			rotationFrame++;
			if (rotationFrame < rotationsForChar) {
				setChars((current) => replaceChar(current, currentIndex, randomAsciiChar(targetChar)));
				return;
			}

			setChars((current) => replaceChar(current, currentIndex, targetChar));
			index++;
			rotationFrame = 0;
			rotationsForChar = randomRotationCount();
			if (index >= targetChars.length) {
				setChars(targetChars);
				setActiveIndex(-1);
				pauseTicks = 18;
			}
		}, 55);

		return () => window.clearInterval(interval);
	}, [enabled, targetChars]);

	return { chars, activeIndex };
}

function replaceChar(chars: string[], index: number, char: string): string[] {
	const next = [...chars];
	next[index] = char;
	return next;
}

function randomAsciiChars(targetChars: string[]): string[] {
	return targetChars.map((targetChar) => randomAsciiChar(targetChar));
}

function randomAsciiChar(exclude?: string): string {
	let char = "";
	do {
		const code = WORKING_SCRAMBLE_ASCII_START + Math.floor(Math.random() * (WORKING_SCRAMBLE_ASCII_END - WORKING_SCRAMBLE_ASCII_START + 1));
		char = String.fromCharCode(code);
	} while (char === exclude);
	return char;
}

function randomRotationCount(): number {
	return 2 + Math.floor(Math.random() * 11);
}

function useActiveTurnElapsed(startedAt: string | undefined): string | undefined {
	const startedAtMs = startedAt ? new Date(startedAt).getTime() : Number.NaN;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		setNow(Date.now());
		if (!Number.isFinite(startedAtMs)) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [startedAtMs]);
	return Number.isFinite(startedAtMs) ? formatTerminalDuration(Math.max(0, now - startedAtMs)) : undefined;
}

function TerminalCompactionLine() {
	const dots = useAnimatedDots();
	return (
		<div className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 whitespace-pre-wrap break-words">
			<span className="whitespace-pre text-[#38bdf8]">•</span>
			<span className="min-w-0">
				<span className="font-semibold text-[#38bdf8]">Compacting</span>
				<span className="text-[#38bdf8]">{dots}</span>
			</span>
		</div>
	);
}

function useAnimatedDots() {
	const [count, setCount] = useState(0);
	useEffect(() => {
		const interval = window.setInterval(() => setCount((current) => (current + 1) % 4), 400);
		return () => window.clearInterval(interval);
	}, []);
	return ".".repeat(count);
}

function TerminalBadge({
	tone,
	label,
	onClick,
	children,
}: {
	tone: "cyan" | "red" | "amber" | "purple" | "neutral";
	label?: string;
	onClick?: () => void;
	children: ReactNode;
}) {
	const className =
		tone === "cyan"
			? "border-[#1f4960] text-[#38bdf8]"
			: tone === "red"
				? "border-[#5f2222] text-[#ef4444]"
				: tone === "amber"
					? "border-[#6b4e16] text-[#f59e0b]"
					: tone === "purple"
						? "border-purple-500/40 text-purple-300"
						: "border-[#3a3a3a] text-[#d4d4d4]";
	const badgeClassName = `inline-flex items-center gap-1 border px-2 py-0.5 ${className}`;
	if (onClick) {
		return (
			<button type="button" onClick={onClick} className={`${badgeClassName} hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-[#38bdf8]`} title={label} aria-label={label}>
				{children}
			</button>
		);
	}
	return <span className={badgeClassName} title={label} aria-label={label}>{children}</span>;
}

function RowAction({
	label,
	onClick,
	disabled = false,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className="inline-flex min-h-7 min-w-7 items-center gap-1 border border-[#3a3a3a] px-2 text-[11px] text-[#a3a3a3] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#3a3a3a] disabled:hover:text-[#a3a3a3]"
		>
			{children}
		</button>
	);
}

function EmptyTerminalState({
	isLoading,
	agentProfiles,
	disabled,
	onSelectAgentProfile,
	message,
}: {
	isLoading: boolean;
	agentProfiles: ChatSessionViewProps["agentProfiles"];
	disabled: boolean;
	onSelectAgentProfile: ChatSessionViewProps["onSessionAgentProfileChange"];
	message?: string;
}) {
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center text-[12px] text-[#737373] @max-[420px]:px-3">
			<div>{isLoading ? "Loading trace…" : message ?? "No trace selected."}</div>
			{agentProfiles.length ? (
				<div className="flex flex-wrap items-center justify-center gap-2">
					{agentProfiles.map((profile) => (
						<button
							key={profile.name}
							type="button"
							disabled={disabled}
							onClick={() => onSelectAgentProfile(profile.name)}
							className="border border-[#3a3a3a] px-2 py-1 text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50"
						>
							{profile.name}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
	if (left.size !== right.size) return false;
	for (const value of left) {
		if (!right.has(value)) return false;
	}
	return true;
}

function isOlderTraceScrollIntent(event?: Event, direction?: "away" | "toward") {
	if (direction) return direction === "away";
	if (event instanceof WheelEvent) return event.deltaY < 0;
	if (event instanceof KeyboardEvent) return ["ArrowUp", "PageUp", "Home"].includes(event.key);
	return event?.type === "touchmove";
}
