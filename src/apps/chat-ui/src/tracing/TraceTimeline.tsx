import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronsDown, ChevronsUp, GitBranch, ListTree, MessageSquarePlus, RefreshCw, RotateCcw } from "lucide-react";
import type { Span, Trace } from "../types";
import { countRender } from "../renderMetrics";
import { SpanNode, type SpanExpansionDepth } from "./SpanNode";
import { processSpanTree } from "./traceTree";

type TraceTimelineProps = {
	trace: Trace | null;
	isLoading?: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	sessionAgentProfile?: string;
	activeAgentProfile?: string;
	onFork: (entryId: string) => void;
	onOpenSession: (piboSessionId: string) => void;
};

const timelineContentStyle = {
	"--trace-readable-width": "clamp(44rem, 58vw, 64rem)",
} as CSSProperties;

const DEFAULT_EXPANSION_DEPTH = 1;

export function TraceTimeline({
	trace,
	isLoading = false,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	activeAgentProfile,
	onFork,
	onOpenSession,
}: TraceTimelineProps) {
	countRender("TraceTimeline");
	const scrollRef = useRef<HTMLDivElement>(null);
	const bottomLockedRef = useRef(true);
	const [expansionDepth, setExpansionDepth] = useState<SpanExpansionDepth>(DEFAULT_EXPANSION_DEPTH);
	const [expansionSignal, setExpansionSignal] = useState(0);
	const [levelInput, setLevelInput] = useState(String(DEFAULT_EXPANSION_DEPTH));

	const spanTree = useMemo(() => {
		if (!trace?.spans) return [];
		return processSpanTree(filterThinking(trace.spans, showThinking));
	}, [trace?.spans, showThinking]);

	const allSpans = useMemo(() => flattenSpans(spanTree), [spanTree]);
	const startTime = useMemo(() => {
		if (!allSpans.length) return 0;
		return Math.min(...allSpans.map((span) => span.startTime));
	}, [allSpans]);
	const stats = useMemo(
		() => ({
			completed: allSpans.filter((span) => span.status === "OK").length,
			error: allSpans.filter((span) => span.status === "ERROR").length,
			active: allSpans.filter((span) => span.status === "UNSET").length,
		}),
		[allSpans],
	);
	const isStreaming = trace?.status === "UNSET";
	const showActiveAgentProfile = Boolean(
		sessionAgentProfile && activeAgentProfile && activeAgentProfile !== sessionAgentProfile,
	);

	const updateBottomLock = useCallback(() => {
		const element = scrollRef.current;
		if (!element) return;
		bottomLockedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
	}, []);

	useLayoutEffect(() => {
		if (!isStreaming || !bottomLockedRef.current) return;
		const frame = requestAnimationFrame(() => {
			const element = scrollRef.current;
			if (element && bottomLockedRef.current) element.scrollTop = element.scrollHeight;
		});
		return () => cancelAnimationFrame(frame);
	}, [isStreaming, trace?.spans]);

	if (!trace) {
		return (
			<section className="flex-1 flex flex-col bg-[#0c1214] relative overflow-hidden">
				<div className="h-14 px-6 border-b border-slate-800 bg-[#1a262b]/80 flex items-center justify-between">
					<h2 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
						<GitBranch size={18} className="text-[#11a4d4]" />
						Execution Flow
					</h2>
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
		setExpansionSignal((current) => current + 1);
	};

	const applyLevelInput = () => {
		const parsedLevel = Number.parseInt(levelInput, 10);
		applyExpansionDepth(Number.isFinite(parsedLevel) && parsedLevel > 0 ? parsedLevel : DEFAULT_EXPANSION_DEPTH);
	};

	return (
		<section className="flex-1 flex flex-col bg-[#0c1214] relative overflow-hidden">
			<div className="h-14 px-6 border-b border-slate-800 bg-[#1a262b]/80 flex items-center justify-between sticky top-0 z-20">
				<div className="flex items-center gap-4">
					<GitBranch size={18} className="text-[#11a4d4]" aria-label="Execution flow" />
					<div className="flex min-w-0 items-center gap-2">
						{isLoading ? <Badge color="cyan">Loading</Badge> : null}
						{stats.active > 0 ? <Badge color="cyan">{stats.active} Active</Badge> : null}
						{stats.completed > 0 ? <Badge color="green">{stats.completed} Done</Badge> : null}
						{sessionAgentProfile ? <Badge color="transparent">{sessionAgentProfile}</Badge> : null}
						{showActiveAgentProfile ? <Badge color="baby-blue">Active {activeAgentProfile}</Badge> : null}
						{stats.error > 0 ? <Badge color="orange">{stats.error} Errors</Badge> : null}
					</div>
				</div>
				<div className="flex items-center gap-1">
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

			<div ref={scrollRef} onScroll={updateBottomLock} className="flex-1 overflow-auto p-6">
				<div className="relative w-max min-w-full pr-6" style={timelineContentStyle}>
					{spanTree.length ? (
						spanTree.map((span) => (
							<SpanNode
								key={span.id}
								span={span}
								startTime={startTime}
								expansionDepth={expansionDepth}
								expansionSignal={expansionSignal}
								expandThinking={expandThinking}
								onFork={onFork}
								onOpenSession={onOpenSession}
							/>
						))
					) : (
						<EmptyTraceState />
					)}
					{isStreaming ? <StreamingIndicator /> : null}
				</div>
			</div>
		</section>
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
	color: "cyan" | "green" | "orange" | "transparent" | "baby-blue";
	children: ReactNode;
}) {
	const className =
		color === "cyan"
			? "bg-[#11a4d4]/20 text-[#11a4d4]"
			: color === "green"
				? "bg-[#0bda57]/20 text-[#0bda57]"
				: color === "orange"
					? "bg-[#ff6b00]/20 text-[#ff6b00]"
					: color === "baby-blue"
						? "bg-[#bae6fd] text-[#0f172a]"
						: "border border-slate-700 text-slate-300";
	const casing = color === "transparent" || color === "baby-blue" ? "" : "uppercase";
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

function EmptyTraceState() {
	return (
		<div className="flex min-h-[18rem] items-center justify-center" style={{ width: "var(--trace-readable-width)" }}>
			<div className="flex max-w-md flex-col items-center text-center">
				<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm border border-[#11a4d4]/35 bg-[#11a4d4]/10 text-[#11a4d4]">
					<MessageSquarePlus size={22} />
				</div>
				<h3 className="text-2xl font-semibold text-slate-200">No Traces</h3>
				<p className="mt-2 text-sm leading-6 text-slate-500">Send a message to the agent to start an execution trace.</p>
			</div>
		</div>
	);
}

function StreamingIndicator() {
	return (
		<div className="relative mb-8" style={{ width: "var(--trace-readable-width)" }}>
			<div className="bg-[#1a262b] border border-[#11a4d4]/30 rounded-sm p-4 flex items-center gap-3">
				<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#11a4d4]/20 border-2 border-[#11a4d4] animate-pulse">
					<RefreshCw size={14} className="text-[#11a4d4] animate-spin" />
				</span>
				<span className="text-sm text-[#11a4d4]">Executing...</span>
			</div>
		</div>
	);
}

function filterThinking(spans: Span[], showThinking: boolean): Span[] {
	return spans.flatMap((span) => {
		if (!showThinking && span.spanType === "model.reasoning") return [];
		return [{ ...span, children: span.children ? filterThinking(span.children, showThinking) : undefined }];
	});
}

function flattenSpans(spans: Span[]): Span[] {
	return spans.flatMap((span) => [span, ...(span.children ? flattenSpans(span.children) : [])]);
}
