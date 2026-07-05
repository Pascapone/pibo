import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleX, GitBranch, Hammer, MessageSquare } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useStickyVirtuoso } from "../../components/useStickyVirtuoso";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";
import type { ChatSessionViewProps } from "../types";
import { TerminalDetails } from "./TerminalDetails";
import { TerminalLine } from "./TerminalLine";
import { TerminalLoginCard } from "./TerminalLoginCard";
import { TerminalModelCard } from "./TerminalModelCard";
import { TerminalStatusCard } from "./TerminalStatusCard";
import { TerminalThinkingCard } from "./TerminalThinkingCard";
import { buildCompactTerminalRows, type CompactTerminalLine, type CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";

const SHOW_LATEST_THRESHOLD_PX = 180;
const OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = 4_800;
const OLDER_TRACE_PREFETCH_ROW_THRESHOLD = 20;
const INITIAL_BOTTOM_ITEM = { index: "LAST", align: "end" } as const;
const VIRTUOSO_VIEWPORT = { top: 2_400, bottom: 2_400 } as const;
const DEFAULT_ROW_HEIGHT_PX = 84;
const COLLAPSED_EXPLORING_PREVIEW_LINES = 6;
type TerminalNavigationKind = "system" | "tool" | "user";

export function CompactTerminalSessionView({
	traceView,
	selectedTrace,
	isLoading,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionActiveModel,
	selectedSessionStatus,
	selectedSessionSignal,
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
		() => buildCompactTerminalRows(traceView, { showThinking }),
		[showThinking, traceView],
	);
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [focusedNavigationRowId, setFocusedNavigationRowId] = useState<string | null>(null);
	const navigationCursorRef = useRef<Partial<Record<TerminalNavigationKind, string>>>({});
	const rangePrefetchReadyRef = useRef(false);
	const olderTraceIntentRef = useRef(false);
	const runningCount = rows.filter((row) => row.status === "running").length;
	const userMessageCount = rows.filter((row) => isNavigableTerminalRow(row, "user")).length;
	const toolErrorCount = rows.filter((row) => isNavigableTerminalRow(row, "tool")).length;
	const errorCount = rows.filter((row) => isNavigableTerminalRow(row, "system")).length;
	const isStreaming = selectedSessionSignal
		? selectedSessionSignal.isTreeActive
		: selectedSessionStatus === "running" || runningCount > 0 || selectedTrace?.status === "UNSET";
	const loadOlderTracePage = useCallback(() => {
		if (!hasOlderTraceEvents || isFetchingOlderTracePage) return;
		onLoadOlderTracePage?.();
	}, [hasOlderTraceEvents, isFetchingOlderTracePage, onLoadOlderTracePage]);
	const loadOlderAtTop = useCallback(() => {
		if (!olderTraceIntentRef.current) return;
		loadOlderTracePage();
	}, [loadOlderTracePage]);
	const markOlderTraceIntent = useCallback((event?: Event) => {
		if (isOlderTraceScrollIntent(event)) olderTraceIntentRef.current = true;
	}, []);
	const handleVisibleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
		if (!rangePrefetchReadyRef.current) return;
		if (range.startIndex <= OLDER_TRACE_PREFETCH_ROW_THRESHOLD) loadOlderAtTop();
	}, [loadOlderAtTop]);

	const stickyView = useStickyVirtuoso({
		itemCount: rows.length,
		resetKey: traceView?.piboSessionId,
		contentKey: rows,
		atBottomThreshold: SHOW_LATEST_THRESHOLD_PX,
		nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX,
		onNearTop: loadOlderAtTop,
		onUserScrollIntent: markOlderTraceIntent,
	});

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
	const renderRow = useCallback((_: number, row: CompactTerminalRow) => (
		<div className="px-4">
			<TerminalRow
				row={row}
				expanded={expandedRows.has(row.id)}
				focused={focusedNavigationRowId === row.id}
				piboSessionId={traceView?.piboSessionId ?? ""}
				onToggle={() => toggleRow(row)}
				onFork={onFork}
				onOpenSession={onOpenSession}
				onThinkingLevelChange={onThinkingLevelChange}
				onModelChanged={onModelChanged}
			/>
		</div>
	), [expandedRows, focusedNavigationRowId, onFork, onModelChanged, onOpenSession, onThinkingLevelChange, traceView?.piboSessionId]);

	const virtuosoComponents = useMemo(() => ({
		Footer: isStreaming ? TerminalStreamingFooter : undefined,
	}), [isStreaming]);

	return (
		<section
			className="relative min-w-0 flex-1 flex flex-col overflow-hidden bg-[#0b0b0b] text-[#d4d4d4]"
			data-pibo-component="CompactTerminalSessionView"
			data-pibo-debug="compact-terminal-session-view"
			data-pibo-session-id={traceView?.piboSessionId ?? undefined}
			data-pibo-trace-has-older={traceView?.hasOlderEvents === true ? "true" : "false"}
			data-pibo-trace-next-before={traceView?.nextBeforeSequence ?? ""}
		>
			<TerminalHeader
				errorCount={errorCount}
				toolErrorCount={toolErrorCount}
				userMessageCount={userMessageCount}
				onNavigate={navigateToTerminalRow}
				sessionAgentProfile={sessionAgentProfile}
				sessionActiveModel={sessionActiveModel}
				sessionBreadcrumbs={sessionBreadcrumbs}
				originSession={originSession}
				derivedSessions={derivedSessions}
				onOpenSession={onOpenSession}
			/>

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
						key={traceView.piboSessionId}
						ref={stickyView.virtuosoRef}
						data={rows}
						initialTopMostItemIndex={INITIAL_BOTTOM_ITEM}
						increaseViewportBy={VIRTUOSO_VIEWPORT}
						defaultItemHeight={DEFAULT_ROW_HEIGHT_PX}
						className="min-h-0 h-full overflow-x-hidden font-mono text-[12px] leading-[1.45]"
						computeItemKey={(_, row) => row.id}
						scrollerRef={stickyView.scrollerRef}
						atBottomStateChange={stickyView.atBottomStateChange}
						atBottomThreshold={stickyView.atBottomThreshold}
						atTopStateChange={(atTop) => {
							if (atTop) loadOlderAtTop();
						}}
						rangeChanged={handleVisibleRangeChanged}
						startReached={loadOlderAtTop}
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

			{!stickyView.isSticky ? (
				<button
					type="button"
					onClick={() => stickyView.stickToBottom("auto")}
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
	sessionBreadcrumbs: ChatSessionViewProps["sessionBreadcrumbs"];
	originSession: ChatSessionViewProps["originSession"];
	derivedSessions: ChatSessionViewProps["derivedSessions"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
}) {
	return (
		<div className="border-b border-[#2a2a2a] bg-[#111111] px-4 py-2 text-[11px]">
			<div className="flex flex-wrap items-center gap-2">
				{sessionAgentProfile ? <TerminalBadge tone="neutral">{sessionAgentProfile}</TerminalBadge> : null}
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
	expanded,
	focused,
	piboSessionId,
	onToggle,
	onFork,
	onOpenSession,
	onThinkingLevelChange,
	onModelChanged,
}: {
	row: CompactTerminalRow;
	expanded: boolean;
	focused: boolean;
	piboSessionId: string;
	onToggle: () => void;
	onFork: ChatSessionViewProps["onFork"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
	onThinkingLevelChange: ChatSessionViewProps["onThinkingLevelChange"];
	onModelChanged: ChatSessionViewProps["onModelChanged"];
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
					/>
				</div>
				<TerminalRowActions row={row} onFork={onFork} onOpenSession={onOpenSession} />
			</div>
			{expanded ? <TerminalDetails row={row} onOpenSession={onOpenSession} /> : null}
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
}: {
	row: CompactTerminalRow;
	visibleLines: CompactTerminalLine[];
	collapseToolCallPreview: boolean;
	piboSessionId: string;
	onThinkingLevelChange: ChatSessionViewProps["onThinkingLevelChange"];
	onModelChanged: ChatSessionViewProps["onModelChanged"];
}) {
	if (row.kind === "message.assistant") {
		return (
			<div className="ml-[1.9rem] min-w-0" data-pibo-component="TerminalAssistantMessage">
				<div className="compact-terminal-markdown" data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="assistant-message">
					<MarkdownRenderer streaming={row.status === "running"}>{typeof row.output === "string" ? row.output : ""}</MarkdownRenderer>
				</div>
			</div>
		);
	}
	if (row.kind === "tool.status") return <TerminalStatusCard row={row} />;
	if (row.kind === "tool.thinking") return <TerminalThinkingCard row={row} onLevelSelect={onThinkingLevelChange} />;
	if (row.kind === "tool.login") return <TerminalLoginCard row={row} piboSessionId={piboSessionId} />;
	if (row.kind === "tool.model") return <TerminalModelCard row={row} piboSessionId={piboSessionId} onModelChanged={onModelChanged} />;
	if (row.kind === "execution.compaction" && row.status === "running") return <TerminalCompactionLine />;
	if (row.kind === "reasoning" && row.markdown) {
		return (
			<>
				<TerminalLines lines={visibleLines} status={row.status} clampPreview={collapseToolCallPreview} />
				<div className="ml-[1.9rem] min-w-0" data-pibo-component="TerminalReasoningMarkdown">
					<div className="compact-terminal-markdown compact-terminal-reasoning" data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="reasoning">
						<MarkdownRenderer streaming={row.status === "running"}>{row.markdown}</MarkdownRenderer>
					</div>
				</div>
			</>
		);
	}
	return <TerminalLines lines={visibleLines} status={row.status} clampPreview={collapseToolCallPreview} />;
}

function TerminalLines({
	lines,
	status,
	clampPreview,
}: {
	lines: CompactTerminalLine[];
	status: CompactTerminalRow["status"];
	clampPreview: boolean;
}) {
	return lines.map((line, index) => (
		<TerminalLine key={index} line={line} status={status} clampLines={clampPreview && index === 0 ? 5 : undefined} />
	));
}

function TerminalRowActions({
	row,
	onFork,
	onOpenSession,
}: {
	row: CompactTerminalRow;
	onFork: ChatSessionViewProps["onFork"];
	onOpenSession: ChatSessionViewProps["onOpenSession"];
}) {
	return (
		<div className={`flex shrink-0 items-start gap-1 transition-opacity ${row.forkEntryId ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
			{row.linkedPiboSessionId ? (
				<RowAction label="Open linked session" onClick={() => onOpenSession(row.linkedPiboSessionId!)}>
					Open
				</RowAction>
			) : null}
			{row.forkEntryId ? (
				<RowAction label="Fork from this user message" onClick={() => onFork(row.forkEntryId!)}>
					<GitBranch size={13} />
					Fork
				</RowAction>
			) : null}
		</div>
	);
}

function terminalRowClassName(row: CompactTerminalRow, focused = false): string {
	const base =
		row.kind === "message.user"
			? "group border-b border-[#141414] bg-[#11a4d4]/10 py-2 last:border-b-0 hover:bg-[#11a4d4]/15"
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

function TerminalStreamingFooter() {
	const { chars, activeIndex } = useWorkingScramble(WORKING_SCRAMBLE_TARGET);

	return (
		<div className="border-t border-[#141414] px-4 py-2" role="status" aria-live="polite" aria-label="Working">
			<div className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 whitespace-pre-wrap break-words">
				<span className="whitespace-pre text-[#737373]">•</span>
				<span className="compact-terminal-working-scramble" aria-hidden="true">
					{chars.map((char, index) => (
						<span
							key={index}
							className={index === activeIndex ? "compact-terminal-working-scramble-active" : undefined}
						>
							{char}
						</span>
					))}
				</span>
			</div>
		</div>
	);
}

function useWorkingScramble(target: string) {
	const targetChars = useMemo(() => Array.from(target), [target]);
	const [chars, setChars] = useState(() => randomAsciiChars(targetChars));
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		let index = 0;
		let rotationFrame = 0;
		let rotationsForChar = randomRotationCount();
		let pauseTicks = 0;
		setChars(randomAsciiChars(targetChars));

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
	}, [targetChars]);

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
	children,
}: {
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="inline-flex min-h-7 min-w-7 items-center gap-1 border border-[#3a3a3a] px-2 text-[11px] text-[#737373] hover:border-[#38bdf8] hover:text-[#38bdf8]"
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
		<div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-10 text-center text-[12px] text-[#737373]">
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

function isOlderTraceScrollIntent(event?: Event) {
	if (event instanceof WheelEvent) return event.deltaY < 0;
	if (event instanceof KeyboardEvent) return ["ArrowUp", "PageUp", "Home"].includes(event.key);
	return event?.type === "touchmove";
}
