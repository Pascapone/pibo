import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
	ArrowDownToLine,
	Bell,
	Bolt,
	Bot,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	ExternalLink,
	GitBranch,
	Lightbulb,
	MessageSquare,
	User,
} from "lucide-react";
import type { Span, SpanStatus, SpanType } from "../types";
import { countRender } from "../renderMetrics";
import { JsonRenderer } from "./JsonRenderer";
import { MarkdownRenderer } from "./MarkdownRenderer";

type SpanNodeProps = {
	span: Span;
	startTime: number;
	depth?: number;
	expansionDepth: SpanExpansionDepth;
	expansionSignal: number;
	expandThinking: boolean;
	onFork?: (entryId: string) => void;
	onOpenSession?: (piboSessionId: string) => void;
};

export type SpanExpansionDepth = number | "all";

type SpanTypeConfig = {
	color: string;
	bgColor: string;
	borderColor: string;
	label: string;
};

type SpanStatusStyles = ReturnType<typeof getStatusStyles>;

const spanTypeConfigs: Record<SpanType, SpanTypeConfig> = {
	"agent.run": {
		color: "text-[#11a4d4]",
		bgColor: "bg-[#11a4d4]/20",
		borderColor: "border-[#11a4d4]",
		label: "Agent Run",
	},
	"tool.call": {
		color: "text-purple-500",
		bgColor: "bg-purple-500/20",
		borderColor: "border-purple-500",
		label: "Tool Call",
	},
	"tool.result": {
		color: "text-green-500",
		bgColor: "bg-green-500/20",
		borderColor: "border-green-500",
		label: "Tool Result",
	},
	"model.request": {
		color: "text-blue-500",
		bgColor: "bg-blue-500/20",
		borderColor: "border-blue-500",
		label: "Model Request",
	},
	"model.response": {
		color: "text-[#0bda57]",
		bgColor: "bg-[#0bda57]/20",
		borderColor: "border-[#0bda57]",
		label: "Model Response",
	},
	"model.reasoning": {
		color: "text-amber-500",
		bgColor: "bg-amber-500/20",
		borderColor: "border-amber-500",
		label: "Reasoning",
	},
	"agent.delegation": {
		color: "text-orange-500",
		bgColor: "bg-orange-500/20",
		borderColor: "border-orange-500",
		label: "Agent Delegation",
	},
	"agent.async": {
		color: "text-orange-500",
		bgColor: "bg-orange-500/20",
		borderColor: "border-orange-500",
		label: "Async Agent",
	},
	"yielded.run": {
		color: "text-[#11a4d4]",
		bgColor: "bg-[#11a4d4]/20",
		borderColor: "border-[#11a4d4]",
		label: "Yielded Run",
	},
	"user.prompt": {
		color: "text-cyan-500",
		bgColor: "bg-cyan-500/20",
		borderColor: "border-cyan-500",
		label: "User Prompt",
	},
	user_input: {
		color: "text-slate-500",
		bgColor: "bg-slate-800",
		borderColor: "border-slate-600",
		label: "User Input",
	},
};

const NESTING_INDENT_PX = 12;

function isExpandedAtDepth(depth: number, expansionDepth: SpanExpansionDepth): boolean {
	return expansionDepth === "all" || depth < expansionDepth;
}

export const SpanNode = memo(function SpanNode({
	span,
	startTime,
	depth = 0,
	expansionDepth,
	expansionSignal,
	expandThinking,
	onFork,
	onOpenSession,
}: SpanNodeProps) {
	countRender("SpanNode");
	const [childrenExpanded, setChildrenExpanded] = useState(() => {
		return isExpandedAtDepth(depth, expansionDepth);
	});
	const [contentExpanded, setContentExpanded] = useState(() => {
		if (span.spanType === "model.reasoning") return expandThinking;
		return isExpandedAtDepth(depth, expansionDepth);
	});

	useEffect(() => {
		const expanded = isExpandedAtDepth(depth, expansionDepth);
		setChildrenExpanded(expanded);
		setContentExpanded(span.spanType === "model.reasoning" ? expandThinking : expanded);
	}, [depth, expansionDepth, expansionSignal, expandThinking, span.spanType]);

	const config = spanTypeConfigs[span.spanType] || spanTypeConfigs["agent.run"];
	const isActive = span.status === "UNSET";
	const statusStyles = getStatusStyles(span.status, isActive);
	const hasChildren = Boolean(span.children?.length);
	const relativeTime = formatRelativeTime(span.startTime, startTime);
	const duration = span.durationUs
		? `${(span.durationUs / 1000).toFixed(1)}ms`
		: span.endTime
			? `${((span.endTime - span.startTime) / 1000).toFixed(1)}ms`
			: null;
	const subtreeIndentPx = useMemo(() => getMaxDescendantDepth(span) * NESTING_INDENT_PX, [span]);

	const handleToggle = useCallback(() => {
		setContentExpanded((current) => !current);
		if (hasChildren) setChildrenExpanded((current) => !current);
	}, [hasChildren]);

	return (
		<div
			className="relative mb-4 group"
			style={{
				marginLeft: depth > 0 ? NESTING_INDENT_PX : 0,
				width: `calc(var(--trace-readable-width) + ${subtreeIndentPx}px)`,
			}}
		>
			<div
				className={`bg-white dark:bg-[#1a262b] border ${statusStyles.cardClass} rounded-sm shadow-sm transition-all hover:border-opacity-70 ${
					isActive ? statusStyles.glowClass : ""
				}`}
			>
				<SpanHeader
					span={span}
					config={config}
					statusStyles={statusStyles}
					isActive={isActive}
					contentExpanded={contentExpanded}
					duration={duration}
					relativeTime={relativeTime}
					onToggle={handleToggle}
					onFork={onFork}
					onOpenSession={onOpenSession}
				/>

				{contentExpanded ? <SpanContent span={span} /> : null}

				{hasChildren && childrenExpanded && contentExpanded ? (
					<div className="border-t border-slate-700 bg-slate-900/50 py-4">
						{span.children?.map((child) => (
							<SpanNode
								key={child.id}
								span={child}
								startTime={startTime}
								depth={depth + 1}
								expansionDepth={expansionDepth}
								expansionSignal={expansionSignal}
								expandThinking={expandThinking}
								onFork={onFork}
								onOpenSession={onOpenSession}
							/>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
});

function SpanHeader({
	span,
	config,
	statusStyles,
	isActive,
	contentExpanded,
	duration,
	relativeTime,
	onToggle,
	onFork,
	onOpenSession,
}: {
	span: Span;
	config: SpanTypeConfig;
	statusStyles: SpanStatusStyles;
	isActive: boolean;
	contentExpanded: boolean;
	duration: string | null;
	relativeTime: string;
	onToggle: () => void;
	onFork?: (entryId: string) => void;
	onOpenSession?: (piboSessionId: string) => void;
}) {
	const headerClassName = `${contentExpanded ? `border-b ${config.borderColor}/20` : ""} ${statusStyles.headerClass}`;

	return (
		<div className={headerClassName}>
			<div className="box-border flex w-full min-w-0 items-center" style={{ maxWidth: "var(--trace-readable-width)" }}>
				<button type="button" className="min-w-0 flex-1 px-4 py-2 cursor-pointer text-left" onClick={onToggle}>
					<span className={`min-w-0 text-xs font-bold ${config.color} uppercase tracking-wider flex items-center gap-2`}>
						{contentExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						<SpanIconBadge spanType={span.spanType} config={config} isActive={isActive} />
						<span className="shrink-0">{config.label}</span>
						{span.name ? (
							<span className="min-w-0 truncate font-normal text-slate-500 dark:text-slate-400 normal-case">
								: {span.name}
							</span>
						) : null}
						{isActive ? <span className="w-1.5 h-1.5 rounded-full bg-[#11a4d4] animate-pulse" /> : null}
					</span>
				</button>
				<SpanHeaderActions
					forkEntryId={span.pibo?.traceNodeType === "user.message" ? span.pibo.entryId : undefined}
					linkedPiboSessionId={span.pibo?.linkedPiboSessionId}
					onFork={onFork}
					onOpenSession={onOpenSession}
				/>
				<SpanHeaderTiming duration={duration} relativeTime={relativeTime} />
			</div>
		</div>
	);
}

function SpanIconBadge({
	spanType,
	config,
	isActive,
}: {
	spanType: SpanType;
	config: SpanTypeConfig;
	isActive: boolean;
}) {
	return (
		<span
			className={`relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${config.bgColor} border-2 ${config.borderColor} ${
				isActive ? "shadow-[0_0_10px_rgba(17,164,212,0.4)]" : ""
			}`}
		>
			<SpanIcon type={spanType} className={config.color} />
			{isActive ? <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#11a4d4] animate-pulse" /> : null}
		</span>
	);
}

function SpanHeaderTiming({ duration, relativeTime }: { duration: string | null; relativeTime: string }) {
	return (
		<div className="ml-2 mr-4 flex w-36 shrink-0 items-center justify-end gap-2 font-mono tabular-nums">
			{duration ? <span className="text-[10px] text-slate-500 dark:text-slate-400">{duration}</span> : null}
			<span className="text-xs text-slate-400 dark:text-slate-500">{relativeTime}</span>
		</div>
	);
}

const SpanContent = memo(function SpanContent({ span }: { span: Span }) {
	countRender("SpanContent");
	const [showDetails, setShowDetails] = useState(false);
	const { spanType, attributes, name } = span;
	const content = attributes.content || attributes.input || attributes.output || attributes.message;
	const rawToolName = attributes.tool_name || (attributes.tool as Record<string, unknown> | undefined)?.name || attributes["tool.name"];
	const toolName = typeof rawToolName === "string" ? rawToolName : null;
	const toolOutput = attributes.output || attributes.result || attributes["tool.result"];
	const toolArgs = attributes.arguments || attributes.args || attributes["tool.arguments"];

	const errorBanner =
		span.status === "ERROR" ? (
			<div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-sm text-xs">
				<div className="flex items-center gap-2 font-semibold text-red-500 mb-1">Error</div>
				{span.statusMessage ? <div className="font-mono text-red-400 mb-2">{span.statusMessage}</div> : null}
			</div>
		) : null;

	if (spanType === "user.prompt" || spanType === "user_input") {
		return (
			<div className="flex flex-col">
				{errorBanner}
				<div className="p-4 font-mono text-sm text-slate-300 whitespace-pre-wrap">
					{typeof content === "string" ? content : JSON.stringify(content)}
				</div>
			</div>
		);
	}

	if (spanType === "model.response") {
		return (
			<div className="flex flex-col">
				{errorBanner}
				<div className="model-response-markdown p-4 text-sm text-slate-200 leading-relaxed">
					{typeof content === "string" ? <MarkdownRenderer>{content}</MarkdownRenderer> : <JsonRenderer value={content} />}
				</div>
			</div>
		);
	}

	if (spanType === "tool.result") {
		return (
			<div className="flex flex-col">
				{errorBanner}
				<div className="p-4 bg-green-500/5 border-t border-green-500/20">
					<div className="text-xs font-medium text-green-400 mb-2">Returned from {toolName || name}:</div>
					<JsonRenderer value={toolOutput ?? content} />
				</div>
			</div>
		);
	}

	if (spanType === "tool.call") {
		const argsRecord = isRecord(toolArgs) ? toolArgs : {};
		const hasArgs = Object.keys(argsRecord).length > 0;
		const displayName = toolName ?? name;
		return (
			<>
				<div className="p-4 bg-[#0e1116] border-b border-slate-800">
					<ToolSignature name={displayName} args={argsRecord} />
				</div>
				{toolOutput != null ? (
					<div className="px-4 py-2 bg-[#1a262b] flex items-center gap-2">
						<ArrowDownToLine size={14} className="text-slate-400" />
						<span className="text-xs font-mono text-slate-500">Output:</span>
						<code className="text-xs font-mono text-slate-300 truncate max-w-md">
							{typeof toolOutput === "string" ? toolOutput.slice(0, 100) : JSON.stringify(toolOutput).slice(0, 100)}
						</code>
					</div>
				) : null}
				<button
					type="button"
					onClick={() => setShowDetails((current) => !current)}
					className="w-full px-4 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-900/40 hover:bg-slate-800/60 border-t border-slate-700/40 transition-colors"
				>
					{showDetails ? <EyeOff size={12} /> : <Eye size={12} />}
					{showDetails ? "Hide Details" : "Show Details"}
				</button>
				{showDetails ? (
					<div className="border-t border-slate-700/40 bg-[#0e1116]">
						{hasArgs ? (
							<div className="px-4 pt-3 pb-2">
								<div className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1.5">Input</div>
								<JsonRenderer value={argsRecord} />
							</div>
						) : null}
						{toolOutput != null ? (
							<div className="px-4 pt-2 pb-3 border-t border-slate-700/30">
								<div className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-1.5">Output</div>
								<JsonRenderer value={toolOutput} />
							</div>
						) : null}
					</div>
				) : null}
				{errorBanner}
			</>
		);
	}

	if (spanType === "yielded.run") {
		const notification = isRecord(toolOutput) ? toolOutput : isRecord(content) ? content : {};
		return (
			<div className="flex flex-col">
				{errorBanner}
				<div className="p-4 border-b border-[#11a4d4]/20 bg-[#11a4d4]/5">
					<div className="flex items-center gap-2 mb-2">
						<Bell size={14} className="text-[#11a4d4]" />
						<span className="text-sm font-medium text-[#11a4d4]">Run notification</span>
						<span className="text-xs font-mono text-slate-400">{typeof attributes.content === "string" ? attributes.content : name}</span>
					</div>
					<RunNotificationSummary notification={notification} />
				</div>
				<button
					type="button"
					onClick={() => setShowDetails((current) => !current)}
					className="w-full px-4 py-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-400 hover:text-slate-200 bg-slate-900/40 hover:bg-slate-800/60 border-t border-slate-700/40 transition-colors"
				>
					{showDetails ? <EyeOff size={12} /> : <Eye size={12} />}
					{showDetails ? "Hide Details" : "Show Details"}
				</button>
				{showDetails ? (
					<div className="border-t border-slate-700/40 bg-[#0e1116] px-4 py-3">
						<JsonRenderer value={notification} />
					</div>
				) : null}
			</div>
		);
	}

	if (spanType === "model.reasoning") {
		const reasoning = attributes.reasoning || attributes["model.reasoning"] || content;
		return (
			<div className="flex flex-col">
				{errorBanner}
				<div className="p-4 font-mono text-sm text-slate-300 bg-amber-500/5 leading-relaxed whitespace-pre-wrap">
					<span className="text-amber-500 opacity-60">// Model reasoning</span>
					<br />
					{typeof reasoning === "string" ? reasoning : JSON.stringify(reasoning, null, 2)}
				</div>
			</div>
		);
	}

	if (spanType === "agent.delegation") {
		const targetAgent = attributes["delegation.target_agent"] as string | undefined;
		const query = attributes["delegation.query"];
		const resultStatus = attributes["result.status"] as string | undefined;
		return (
			<>
				{errorBanner}
				<div className="p-4 border-b border-orange-500/20 bg-orange-500/5">
					<div className="flex items-center gap-2 mb-2">
						<GitBranch size={14} className="text-orange-500" />
						<span className="text-sm font-medium text-orange-500">Delegated to:</span>
						<span className="text-sm font-semibold text-slate-200">{targetAgent || "unknown"} agent</span>
						{resultStatus ? <span className="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-sm bg-green-500/20 text-green-500">{resultStatus.toUpperCase()}</span> : null}
					</div>
					{query ? <div className="text-xs text-slate-400 font-mono italic line-clamp-2">"{stringify(query)}"</div> : null}
				</div>
			</>
		);
	}

	if (spanType === "agent.async") {
		const targetAgent = attributes["async_agent.target_agent"] as string | undefined;
		const query = attributes["async_agent.query"];
		const startedBy = attributes["async_agent.started_by"] as string | undefined;
		const runId = attributes.run_id as string | undefined;
		const resultStatus = attributes["result.status"] as string | undefined;
		return (
			<>
				{errorBanner}
				<div className="p-4 border-b border-orange-500/20 bg-orange-500/5">
					<div className="flex flex-wrap items-center gap-2 mb-2">
						<GitBranch size={14} className="text-orange-500" />
						<span className="text-sm font-medium text-orange-500">Async agent started:</span>
						<span className="text-sm font-semibold text-slate-200">{targetAgent || "unknown"} agent</span>
						{resultStatus ? <span className="px-2 py-0.5 text-[10px] font-bold rounded-sm bg-orange-500/15 text-orange-400">{resultStatus.toUpperCase()}</span> : null}
					</div>
					<div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-500">
						<span>Started by {startedBy || "pibo_run_start"}</span>
						{runId ? <span>{runId}</span> : null}
					</div>
					{query ? <div className="text-xs text-slate-400 font-mono italic line-clamp-2">"{stringify(query)}"</div> : null}
				</div>
			</>
		);
	}

	if (spanType === "agent.run") {
		return (
			<div className="flex flex-col">
				{errorBanner}
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{errorBanner}
			<div className="p-4 font-mono text-sm text-slate-300">
				<JsonRenderer value={attributes} />
			</div>
		</div>
	);
});

function SpanHeaderActions({
	forkEntryId,
	linkedPiboSessionId,
	onFork,
	onOpenSession,
}: {
	forkEntryId?: string;
	linkedPiboSessionId?: string;
	onFork?: (entryId: string) => void;
	onOpenSession?: (piboSessionId: string) => void;
}) {
	const forkableEntryId = forkEntryId && onFork ? forkEntryId : undefined;
	const childPiboSessionId = linkedPiboSessionId && onOpenSession ? linkedPiboSessionId : undefined;
	if (!forkableEntryId && !childPiboSessionId) return null;
	return (
		<div className="flex shrink-0 items-center gap-1">
			{forkableEntryId ? (
				<button
					type="button"
					onClick={() => onFork?.(forkableEntryId)}
					className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 bg-[#151f24]/80 text-slate-400 transition-colors hover:border-[#11a4d4] hover:text-[#11a4d4]"
					title="Fork user message"
					aria-label="Fork user message"
				>
					<GitBranch size={14} />
				</button>
			) : null}
			{childPiboSessionId ? (
				<button
					type="button"
					onClick={() => onOpenSession?.(childPiboSessionId)}
					className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 bg-[#151f24]/80 text-slate-400 transition-colors hover:border-[#11a4d4] hover:text-[#11a4d4]"
					title="Open child session"
					aria-label="Open child session"
				>
					<ExternalLink size={14} />
				</button>
			) : null}
		</div>
	);
}

function ToolSignature({ name, args }: { name: string; args: Record<string, unknown> }) {
	return (
		<code className="font-mono text-xs text-green-400">
			<span className="text-purple-400">def</span> <span className="text-yellow-300">{name}</span>
			<span>
				(
				{Object.entries(args).map(([key, value], index) => (
					<span key={key}>
						{index > 0 ? ", " : null}
						<span className="text-blue-400">{key}</span>=
						<span className="text-green-300">{typeof value === "string" ? `'${value.slice(0, 50)}${value.length > 50 ? "..." : ""}'` : stringify(value).slice(0, 50)}</span>
					</span>
				))}
				)
			</span>
		</code>
	);
}

function SpanIcon({ type, className }: { type: SpanType; className?: string }) {
	const props = { size: 14, className };
	switch (type) {
		case "agent.run":
			return <Brain {...props} />;
		case "tool.call":
			return <Bolt {...props} />;
		case "tool.result":
			return <ArrowDownToLine {...props} />;
		case "model.request":
			return <Bot {...props} />;
		case "model.response":
			return <ArrowDownToLine {...props} />;
		case "model.reasoning":
			return <Lightbulb {...props} />;
		case "agent.delegation":
			return <GitBranch {...props} />;
		case "agent.async":
			return <GitBranch {...props} />;
		case "yielded.run":
			return <Bell {...props} />;
		case "user.prompt":
			return <MessageSquare {...props} />;
		case "user_input":
			return <User {...props} />;
		default:
			return <Check {...props} />;
	}
}

function getStatusStyles(status: SpanStatus, isActive: boolean) {
	if (status === "ERROR") return { cardClass: "border-[#ff6b00]/50", headerClass: "bg-[#ff6b00]/5", glowClass: "" };
	if (status === "OK") return { cardClass: "border-[#0bda57]/30", headerClass: "bg-[#0bda57]/5", glowClass: "" };
	if (isActive) return { cardClass: "border-[#11a4d4]/50", headerClass: "bg-[#11a4d4]/5", glowClass: "shadow-[0_0_10px_rgba(17,164,212,0.1)]" };
	return { cardClass: "border-slate-700", headerClass: "bg-[#151f24]", glowClass: "" };
}

function RunNotificationSummary({ notification }: { notification: Record<string, unknown> }) {
	const groups = [
		["completed", "text-green-500", notification.completed],
		["failed", "text-red-400", notification.failed],
		["cancelled", "text-slate-400", notification.cancelled],
		["running", "text-[#11a4d4]", notification.running],
	] as const;
	const visible = groups
		.map(([name, color, value]) => ({ name, color, runs: Array.isArray(value) ? value.filter(isRecord) : [] }))
		.filter((group) => group.runs.length > 0);
	if (visible.length === 0) {
		return <div className="text-xs text-slate-400">No yielded run updates.</div>;
	}
	return (
		<div className="grid gap-2">
			{visible.map((group) => (
				<div key={group.name}>
					<div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${group.color}`}>{group.name}</div>
					<div className="grid gap-1">
						{group.runs.map((run, index) => (
							<div key={`${group.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-sm border border-slate-700/60 bg-[#0e1116]/60 px-2 py-1.5">
								<div className="min-w-0">
									<div className="truncate font-mono text-xs text-slate-200">{stringField(run.toolName) || "yielded tool"}</div>
									<div className="truncate font-mono text-[10px] text-slate-500">{stringField(run.runId)}</div>
								</div>
								<div className="font-mono text-[10px] uppercase text-slate-400">{stringField(run.status) || group.name}</div>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function formatRelativeTime(currentUs: number, startUs: number): string {
	const diffMs = (currentUs - startUs) / 1000;
	const minutes = Math.floor(diffMs / 60000);
	const seconds = Math.floor((diffMs % 60000) / 1000);
	const milliseconds = Math.floor(diffMs % 1000);
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function getMaxDescendantDepth(span: Span): number {
	if (!span.children?.length) return 0;
	return 1 + Math.max(...span.children.map(getMaxDescendantDepth));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}
