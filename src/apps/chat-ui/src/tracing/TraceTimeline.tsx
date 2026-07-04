import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, GitBranch, GitFork, ListTree, MessageSquarePlus, RefreshCw, RotateCcw } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useStickyVirtuoso } from "../components/useStickyVirtuoso";
import type { Span, Trace } from "../types";
import { countRender } from "../renderMetrics";
import { TraceSpanCard, type SpanExpansionDepth } from "./SpanNode";
import { processSpanTree } from "./traceTree";
import { collectVisibleRows, isTraceSnapshotCollectionEnabled } from "./snapshotCollector";

type TraceTimelineProps = {
	trace: Trace | null;
	isLoading?: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	sessionAgentProfile?: string;
	sessionActiveModel?: string;
	sessionBreadcrumbs?: readonly SessionBreadcrumbItem[];
	originSession?: SessionOriginLink;
	derivedSessions?: readonly SessionDerivationLink[];
	agentProfiles?: readonly AgentProfileOption[];
	sessionProfileChangeDisabled?: boolean;
	onSessionAgentProfileChange?: (profile: string) => void;
	onFork: (entryId: string) => void;
	onOpenSession: (piboSessionId: string) => void;
	onLoadOlderTracePage?: () => void;
	hasOlderTraceEvents?: boolean;
	isFetchingOlderTracePage?: boolean;
};

type AgentProfileOption = {
	name: string;
	description?: string;
};

export type SessionBreadcrumbItem = {
	piboSessionId: string;
	label: string;
};

export type SessionOriginLink = {
	piboSessionId: string;
	label: string;
};

export type SessionDerivationLink = {
	piboSessionId: string;
	label: string;
	profile: string;
	status: "idle" | "running" | "error";
};

type BreadcrumbDisplayItem =
	| { type: "item"; item: SessionBreadcrumbItem; current: boolean }
	| { type: "ellipsis" };

type VisibleSpanRow = {
	id: string;
	span: Span;
	depth: number;
	contentExpanded: boolean;
	childrenExpanded: boolean;
};

const timelineContentStyle = {
	"--trace-readable-width": "min(100%, clamp(36rem, 58vw, 64rem))",
} as CSSProperties;

const mobileTimelineContentStyle = {
	"--trace-readable-width": "100%",
} as CSSProperties;

const DEFAULT_EXPANSION_DEPTH = 1;
const OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX = 1_200;
const INITIAL_BOTTOM_ITEM = { index: "LAST", align: "end" } as const;
const AUTO_FILL_OLDER_HISTORY_MIN_ROWS = 40;

export function TraceTimeline({
	trace,
	isLoading = false,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionActiveModel,
	sessionBreadcrumbs = [],
	originSession,
	derivedSessions = [],
	agentProfiles = [],
	sessionProfileChangeDisabled = false,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onLoadOlderTracePage,
	hasOlderTraceEvents,
	isFetchingOlderTracePage,
}: TraceTimelineProps) {
	countRender("TraceTimeline");
	const [expansionDepth, setExpansionDepth] = useState<SpanExpansionDepth>(DEFAULT_EXPANSION_DEPTH);
	const [levelInput, setLevelInput] = useState(String(DEFAULT_EXPANSION_DEPTH));
	const [expansionOverrides, setExpansionOverrides] = useState<Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>>({});

	const spanTree = useMemo(() => {
		if (!trace?.spans) return [];
		return processSpanTree(filterThinking(trace.spans, showThinking));
	}, [trace?.spans, showThinking]);

	const allSpans = useMemo(() => flattenSpans(spanTree), [spanTree]);
	const startTime = useMemo(() => {
		if (!allSpans.length) return 0;
		return Math.min(...allSpans.map((span) => span.startTime));
	}, [allSpans]);
	const stats = useMemo(() => {
		let completed = 0;
		let error = 0;
		let active = 0;
		for (const span of allSpans) {
			if (span.status === "OK") completed += 1;
			else if (span.status === "ERROR") error += 1;
			else if (span.status === "UNSET") active += 1;
		}
		return { completed, error, active };
	}, [allSpans]);
	const isStreaming = trace?.status === "UNSET";
	const visibleRows = useMemo(() => {
		const rows = flattenVisibleSpans(spanTree, expansionDepth, expandThinking, expansionOverrides);
		if (trace?.id && isTraceSnapshotCollectionEnabled()) {
			collectVisibleRows(
				trace.id,
				`render:${trace.status ?? "unknown"}`,
				rows.map((r) => ({ id: r.id, depth: r.depth, span: r.span })),
				expansionOverrides,
			);
		}
		return rows;
	}, [expandThinking, expansionDepth, expansionOverrides, spanTree, trace?.id, trace?.status]);
	const loadOlderAtTop = useCallback(() => {
		if (!hasOlderTraceEvents || isFetchingOlderTracePage) return;
		onLoadOlderTracePage?.();
	}, [hasOlderTraceEvents, isFetchingOlderTracePage, onLoadOlderTracePage]);

	const stickyView = useStickyVirtuoso({
		itemCount: visibleRows.length,
		resetKey: trace?.id,
		contentKey: visibleRows,
		nearTopThreshold: OLDER_TRACE_PREFETCH_TOP_THRESHOLD_PX,
		onNearTop: loadOlderAtTop,
	});

	useEffect(() => {
		setExpansionOverrides({});
	}, [expandThinking, trace?.id]);


	if (!trace) {
		return (
			<section className="flex-1 flex flex-col bg-[#0c1214] relative overflow-hidden">
				<div className="h-14 px-6 border-b border-slate-800 bg-[#1a262b]/80 flex items-center justify-between max-[980px]:px-3">
					<div className="flex min-w-0 items-center gap-2">
						<h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
							<GitBranch size={18} className="text-[#11a4d4]" />
							Execution Flow
						</h2>
						{originSession ? <OriginSessionButton originSession={originSession} onOpenSession={onOpenSession} /> : null}
						<DerivedSessionsButton sessions={derivedSessions} onOpenSession={onOpenSession} />
					</div>
					<SessionBreadcrumbs items={sessionBreadcrumbs} onOpenSession={onOpenSession} />
				</div>
				<div className="flex-1 flex items-center justify-center text-slate-500">
					{isLoading ? <TraceLoadingIndicator /> : "No Trace Selected"}
				</div>
			</section>
		);
	}

	const applyExpansionDepth = (depth: SpanExpansionDepth) => {
		setExpansionDepth(depth);
		if (typeof depth === "number" && depth > 0) setLevelInput(String(depth));
		setExpansionOverrides({});
	};

	const applyLevelInput = () => {
		const parsedLevel = Number.parseInt(levelInput, 10);
		applyExpansionDepth(Number.isFinite(parsedLevel) && parsedLevel > 0 ? parsedLevel : DEFAULT_EXPANSION_DEPTH);
	};
	useEffect(() => {
		if (visibleRows.length === 0 || visibleRows.length >= AUTO_FILL_OLDER_HISTORY_MIN_ROWS) return;
		loadOlderAtTop();
	}, [loadOlderAtTop, visibleRows.length]);

	return (
		<section className="min-w-0 flex-1 flex flex-col bg-[#0c1214] relative overflow-hidden">
			<div className="min-h-14 px-6 py-1.5 border-b border-slate-800 bg-[#1a262b]/80 flex items-center justify-between gap-3 sticky top-0 z-20 max-[980px]:flex-wrap max-[980px]:px-3">
				<div className="grid min-w-0 grid-cols-[18px_minmax(0,1fr)] items-start gap-x-4 gap-y-1">
					<GitBranch size={18} className="mt-0.5 text-[#11a4d4]" aria-label="Execution flow" />
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{isLoading ? <Badge color="cyan">Loading</Badge> : null}
						{stats.active > 0 ? <Badge color="cyan">{stats.active} Active</Badge> : null}
						{stats.completed > 0 ? <Badge color="green">{stats.completed} Done</Badge> : null}
						{sessionAgentProfile ? <Badge color="transparent">{sessionAgentProfile}</Badge> : null}
						{sessionActiveModel ? <Badge color="purple">{sessionActiveModel}</Badge> : null}
						{stats.error > 0 ? <Badge color="orange">{stats.error} Errors</Badge> : null}
						{originSession ? <OriginSessionButton originSession={originSession} onOpenSession={onOpenSession} /> : null}
						<DerivedSessionsButton sessions={derivedSessions} onOpenSession={onOpenSession} />
					</div>
					<div className="col-start-2 min-w-0">
						<SessionBreadcrumbs items={sessionBreadcrumbs} onOpenSession={onOpenSession} />
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1 self-center">
					<TimelineIconButton
						title="Default expansion"
						active={expansionDepth === DEFAULT_EXPANSION_DEPTH}
						onClick={() => applyExpansionDepth(DEFAULT_EXPANSION_DEPTH)}
					>
						<RotateCcw size={14} />
					</TimelineIconButton>
					<TimelineIconButton
						title="Collapse all"
						active={expansionDepth === 0}
						onClick={() => applyExpansionDepth(0)}
					>
						<ChevronsUp size={14} />
					</TimelineIconButton>
					<TimelineIconButton
						title="Expand all"
						active={expansionDepth === "all"}
						onClick={() => applyExpansionDepth("all")}
					>
						<ChevronsDown size={14} />
					</TimelineIconButton>
					<form
						className="ml-1 flex h-8 items-center overflow-hidden rounded-sm border border-slate-700 bg-[#151f24]/80 focus-within:border-[#11a4d4]"
						onSubmit={(event) => {
							event.preventDefault();
							applyLevelInput();
						}}
					>
						<input
							type="number"
							min={1}
							value={levelInput}
							onChange={(event) => setLevelInput(event.target.value)}
							title="Nesting level"
							aria-label="Nesting level"
							className="h-full w-11 bg-transparent px-1 text-center font-mono text-xs text-slate-300 outline-none"
						/>
						<button
							type="submit"
							title="Expand to nesting level"
							aria-label="Expand to nesting level"
							className="inline-flex h-full w-8 items-center justify-center border-l border-slate-700 text-slate-400 hover:text-[#11a4d4]"
						>
							<ListTree size={14} />
						</button>
					</form>
				</div>
			</div>

			<div className="min-w-0 flex-1 overflow-hidden">
				{visibleRows.length ? (
					<Virtuoso
						key={trace.id}
						ref={stickyView.virtuosoRef}
						data={visibleRows}
						initialTopMostItemIndex={INITIAL_BOTTOM_ITEM}
						increaseViewportBy={{ top: 800, bottom: 800 }}
						className="min-h-0 h-full min-w-0 overflow-x-hidden"
						style={timelineContentStyle}
						computeItemKey={(_, row) => row.id}
						scrollerRef={stickyView.scrollerRef}
						atBottomStateChange={stickyView.atBottomStateChange}
						atBottomThreshold={stickyView.atBottomThreshold}
						startReached={loadOlderAtTop}
						followOutput={stickyView.followOutput}
						totalListHeightChanged={stickyView.totalListHeightChanged}
						alignToBottom
						components={{
							Footer: isStreaming ? StreamingIndicator : undefined,
						}}
						itemContent={(_, row) => (
							<div className="px-6 max-[980px]:px-2">
								<TraceSpanCard
									span={row.span}
									startTime={startTime}
									depth={row.depth}
									contentExpanded={row.contentExpanded}
									childrenExpanded={row.childrenExpanded}
									onToggle={() =>
										setExpansionOverrides((current) => ({
											...current,
											[row.id]: {
												contentExpanded: !row.contentExpanded,
												childrenExpanded: row.span.children?.length ? !row.childrenExpanded : row.childrenExpanded,
											},
										}))
									}
									onFork={onFork}
									onOpenSession={onOpenSession}
								/>
							</div>
						)}
					/>
				) : (
					<EmptyTraceState
						agentProfiles={agentProfiles}
						sessionAgentProfile={sessionAgentProfile}
						profileChangeDisabled={sessionProfileChangeDisabled}
						onSelectAgentProfile={onSessionAgentProfileChange}
					/>
				)}
			</div>
			{stickyView.isSticky ? null : (
				<button
					type="button"
					onClick={() => stickyView.stickToBottom("auto")}
					title="Scroll to latest"
					aria-label="Scroll to latest"
					className="absolute right-4 bottom-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-sm border border-[#11a4d4] bg-[#151f24]/95 text-[#11a4d4] shadow-lg shadow-black/30 transition-colors hover:bg-[#11a4d4] hover:text-white"
				>
					<ChevronDown size={18} />
				</button>
			)}
		</section>
	);
}

function DerivedSessionsButton({
	sessions,
	onOpenSession,
}: {
	sessions: readonly SessionDerivationLink[];
	onOpenSession: (piboSessionId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	if (!sessions.length) return null;

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				title={`${sessions.length} fork${sessions.length === 1 ? "" : "s"} from this session`}
				aria-label={`${sessions.length} fork${sessions.length === 1 ? "" : "s"} from this session`}
				aria-expanded={open}
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#a855f7]/50 bg-[#a855f7]/10 text-[#a855f7] transition-colors hover:border-[#a855f7] hover:bg-[#a855f7]/15"
			>
				<GitFork size={13} />
			</button>
			{open ? (
				<div className="absolute left-0 top-7 z-50 w-72 overflow-hidden rounded-sm border border-slate-700 bg-[#151f24] shadow-xl shadow-black/40">
					<div className="border-b border-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
						Forks
					</div>
					<div className="max-h-64 overflow-y-auto p-1">
						{sessions.map((session) => (
							<button
								key={session.piboSessionId}
								type="button"
								onClick={() => {
									setOpen(false);
									onOpenSession(session.piboSessionId);
								}}
								className="grid w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-sm px-2 py-2 text-left text-slate-300 hover:bg-[#1a262b]"
							>
								<span
									className={`h-2 w-2 rounded-full ${
										session.status === "running" ? "bg-[#0bda57]" : session.status === "error" ? "bg-red-500" : "bg-slate-600"
									}`}
								/>
								<span className="min-w-0">
									<span className="block truncate text-xs font-semibold text-slate-200">{session.label}</span>
									<span className="block truncate font-mono text-[10px] text-slate-500">
										{session.profile} · {session.piboSessionId}
									</span>
								</span>
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function OriginSessionButton({
	originSession,
	onOpenSession,
}: {
	originSession: SessionOriginLink;
	onOpenSession: (piboSessionId: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onOpenSession(originSession.piboSessionId)}
			title={`Open origin session: ${originSession.label}`}
			aria-label={`Open origin session: ${originSession.label}`}
			className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#f97316]/50 bg-[#f97316]/10 text-[#f97316] transition-colors hover:border-[#f97316] hover:bg-[#f97316]/15"
		>
			<GitFork size={13} />
		</button>
	);
}

function SessionBreadcrumbs({
	items,
	onOpenSession,
}: {
	items: readonly SessionBreadcrumbItem[];
	onOpenSession: (piboSessionId: string) => void;
}) {
	if (items.length <= 1) return null;
	const displayItems = getBreadcrumbDisplayItems(items);

	return (
		<nav aria-label="Session hierarchy" className="min-w-0">
			<ol className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] leading-4">
				{displayItems.map((entry, index) => (
					entry.type === "ellipsis" ? (
						<li key={`ellipsis-${index}`} className="inline-flex shrink-0 items-center gap-1">
							{index > 0 ? <ChevronRight size={12} className="shrink-0 text-slate-600" /> : null}
							<span className="shrink-0 px-1 font-mono text-slate-500">...</span>
						</li>
					) : (
						<li key={entry.item.piboSessionId} className="inline-flex min-w-0 items-center gap-1">
							{index > 0 ? <ChevronRight size={12} className="shrink-0 text-slate-600" /> : null}
							{entry.current ? (
								<span className="block min-w-0 max-w-56 truncate font-mono text-slate-200">{entry.item.label}</span>
							) : (
								<a
									href={`/sessions/${encodeURIComponent(entry.item.piboSessionId)}`}
									className="block min-w-0 max-w-48 truncate font-mono text-slate-400 transition-colors hover:text-[#11a4d4]"
									onClick={(event) => {
										event.preventDefault();
										onOpenSession(entry.item.piboSessionId);
									}}
								>
									{entry.item.label}
								</a>
							)}
						</li>
					)
				))}
			</ol>
		</nav>
	);
}

function getBreadcrumbDisplayItems(items: readonly SessionBreadcrumbItem[]): BreadcrumbDisplayItem[] {
	if (items.length <= 5) {
		return items.map((item, index) => ({
			type: "item",
			item,
			current: index === items.length - 1,
		}));
	}

	return [
		{ type: "item", item: items[0], current: false },
		{ type: "ellipsis" },
		...items.slice(-2).map((item, index, tail) => ({
			type: "item" as const,
			item,
			current: index === tail.length - 1,
		})),
	];
}

function EmptyTraceAgentChooser({
	agentProfiles,
	sessionAgentProfile,
	profileChangeDisabled,
	onSelectAgentProfile,
}: {
	agentProfiles: readonly AgentProfileOption[];
	sessionAgentProfile?: string;
	profileChangeDisabled: boolean;
	onSelectAgentProfile?: (profile: string) => void;
}) {
	if (!agentProfiles.length) return null;
	return (
		<div className="mt-8 w-full max-w-3xl">
			<div className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Session Agent</div>
			<div className="grid gap-3 sm:grid-cols-2">
				{agentProfiles.map((profile) => {
					const active = profile.name === sessionAgentProfile;
					return (
						<button
							key={profile.name}
							type="button"
							onClick={() => onSelectAgentProfile?.(profile.name)}
							disabled={profileChangeDisabled || active}
							className={`grid min-h-24 w-full grid-cols-[1fr_auto] gap-3 rounded-sm border px-4 py-3 text-left transition-colors ${
								active
									? "border-[#11a4d4] bg-[#11a4d4]/10 text-slate-100"
									: "border-slate-700 bg-[#151f24] text-slate-300 hover:border-[#11a4d4] hover:text-slate-100"
							} disabled:cursor-default disabled:opacity-100`}
						>
							<span className="min-w-0">
								<span className="block truncate font-mono text-sm text-slate-100">{profile.name}</span>
								<span className="mt-2 block text-sm leading-6 text-slate-500">
									{profile.description || "Use this profile for the first message in this session."}
								</span>
							</span>
							<span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-current/30 px-2 text-[10px] font-bold uppercase tracking-wide">
								{active ? <Check size={12} /> : "Set"}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function TimelineIconButton({
	title,
	active,
	onClick,
	children,
}: {
	title: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={title}
			className={`inline-flex h-8 w-8 items-center justify-center rounded-sm border transition-colors ${
				active
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]"
					: "border-slate-700 bg-[#151f24]/80 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
			}`}
		>
			{children}
		</button>
	);
}

function Badge({
	color,
	children,
}: {
	color: "cyan" | "green" | "orange" | "purple" | "transparent";
	children: ReactNode;
}) {
	const className =
		color === "cyan"
			? "bg-[#11a4d4]/20 text-[#11a4d4]"
			: color === "green"
				? "bg-[#0bda57]/20 text-[#0bda57]"
				: color === "orange"
					? "bg-[#ff6b00]/20 text-[#ff6b00]"
					: color === "purple"
						? "bg-purple-500/20 text-purple-300"
						: "border border-slate-700 text-slate-300";
	const casing = color === "transparent" ? "" : "uppercase";
	return (
		<span className={`max-w-52 truncate rounded-sm px-2 py-0.5 text-xs font-bold ${casing} ${className}`}>
			{children}
		</span>
	);
}

function TraceLoadingIndicator() {
	return (
		<div className="flex items-center gap-3 text-sm text-[#11a4d4]" role="status" aria-live="polite">
			<RefreshCw size={16} className="animate-spin" />
			<span>Loading Trace...</span>
		</div>
	);
}

function EmptyTraceState({
	agentProfiles,
	sessionAgentProfile,
	profileChangeDisabled,
	onSelectAgentProfile,
}: {
	agentProfiles: readonly AgentProfileOption[];
	sessionAgentProfile?: string;
	profileChangeDisabled: boolean;
	onSelectAgentProfile?: (profile: string) => void;
}) {
	return (
		<div className="flex min-h-full items-center justify-center p-6">
			<div className="flex w-full max-w-3xl flex-col items-center text-center">
				<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm border border-[#11a4d4]/35 bg-[#11a4d4]/10 text-[#11a4d4]">
					<MessageSquarePlus size={22} />
				</div>
				<h3 className="text-2xl font-semibold text-slate-200">No Traces</h3>
				<p className="mt-2 text-sm leading-6 text-slate-500">Send a message to the agent to start an execution trace.</p>
				<EmptyTraceAgentChooser
					agentProfiles={agentProfiles}
					sessionAgentProfile={sessionAgentProfile}
					profileChangeDisabled={profileChangeDisabled}
					onSelectAgentProfile={onSelectAgentProfile}
				/>
			</div>
		</div>
	);
}

function StreamingIndicator() {
	return (
		<div className="relative mb-8 w-full" style={{ maxWidth: "var(--trace-readable-width)" }}>
			<div className="bg-[#1a262b] border border-[#11a4d4]/30 rounded-sm p-4 flex items-center gap-3">
				<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#11a4d4]/20 border-2 border-[#11a4d4] animate-pulse">
					<RefreshCw size={14} className="text-[#11a4d4] animate-spin" />
				</span>
				<span className="text-sm text-[#11a4d4]">Executing...</span>
			</div>
		</div>
	);
}

export function filterThinking(spans: Span[], showThinking: boolean): Span[] {
	return spans.flatMap((span) => {
		if (!showThinking && span.spanType === "model.reasoning") return [];
		return [{ ...span, children: span.children ? filterThinking(span.children, showThinking) : undefined }];
	});
}

function flattenSpans(spans: Span[]): Span[] {
	return spans.flatMap((span) => [span, ...(span.children ? flattenSpans(span.children) : [])]);
}

export function isExpandedAtDepth(depth: number, expansionDepth: SpanExpansionDepth): boolean {
	return expansionDepth === "all" || depth < expansionDepth;
}

export function flattenVisibleSpans(
	spans: readonly Span[],
	expansionDepth: SpanExpansionDepth,
	expandThinking: boolean,
	expansionOverrides: Record<string, { contentExpanded: boolean; childrenExpanded: boolean }>,
	depth = 0,
): VisibleSpanRow[] {
	const rows: VisibleSpanRow[] = [];
	for (const span of spans) {
		const defaultExpanded = isExpandedAtDepth(depth, expansionDepth);
		const override = expansionOverrides[span.id];
		const contentExpanded = override?.contentExpanded ?? (span.spanType === "model.reasoning" ? expandThinking : defaultExpanded);
		const childrenExpanded = override?.childrenExpanded ?? defaultExpanded;
		rows.push({
			id: span.id,
			span,
			depth,
			contentExpanded,
			childrenExpanded,
		});
		if (span.children?.length && contentExpanded && childrenExpanded) {
			rows.push(...flattenVisibleSpans(span.children, expansionDepth, expandThinking, expansionOverrides, depth + 1));
		}
	}
	return rows;
}
