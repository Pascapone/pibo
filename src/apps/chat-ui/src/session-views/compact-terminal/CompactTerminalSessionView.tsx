import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useStickyVirtuoso } from "../../components/useStickyVirtuoso";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";
import type { ChatSessionViewProps } from "../types";
import { TerminalDetails } from "./TerminalDetails";
import { TerminalLine } from "./TerminalLine";
import { TerminalLoginCard } from "./TerminalLoginCard";
import { TerminalStatusCard } from "./TerminalStatusCard";
import { TerminalThinkingCard } from "./TerminalThinkingCard";
import { buildCompactTerminalRows, type CompactTerminalLine } from "./terminalRows";

const INITIAL_BOTTOM_ITEM = { index: "LAST", align: "end" } as const;

export function CompactTerminalSessionView({
	traceView,
	isLoading,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionActiveModel,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	agentProfiles,
	sessionProfileChangeDisabled,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onThinkingLevelChange,
}: ChatSessionViewProps) {
	const rows = useMemo(
		() => buildCompactTerminalRows(traceView, { showThinking }),
		[showThinking, traceView],
	);
	const stickyView = useStickyVirtuoso({ itemCount: rows.length, resetKey: traceView?.piboSessionId, contentKey: rows });
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const runningCount = rows.filter((row) => row.status === "running").length;
	const errorCount = rows.filter((row) => row.status === "error").length;
	const isStreaming = runningCount > 0;

	useEffect(() => {
		setExpandedRows((current) => {
			const next = new Set<string>();
			for (const row of rows) {
				if (current.has(row.id)) next.add(row.id);
				if (expandThinking && row.kind === "reasoning" && row.expandable) next.add(row.id);
			}
			return sameSet(current, next) ? current : next;
		});
	}, [expandThinking, rows]);


	return (
		<section className="relative min-w-0 flex-1 flex flex-col overflow-hidden bg-[#0b0b0b] text-[#d4d4d4]">
			<div className="border-b border-[#2a2a2a] bg-[#111111] px-4 py-2 text-[11px]">
				<div className="flex flex-wrap items-center gap-2">
					{isLoading ? <TerminalBadge tone="cyan">Loading</TerminalBadge> : null}
					{runningCount > 0 ? <TerminalBadge tone="cyan">{runningCount} running</TerminalBadge> : null}
					{errorCount > 0 ? <TerminalBadge tone="red">{errorCount} errors</TerminalBadge> : null}
					{sessionAgentProfile ? <TerminalBadge tone="neutral">{sessionAgentProfile}</TerminalBadge> : null}
					{sessionActiveModel ? <TerminalBadge tone="purple">Model {sessionActiveModel}</TerminalBadge> : null}
					{originSession ? (
						<button
							type="button"
							onClick={() => onOpenSession(originSession.piboSessionId)}
							className="border border-[#3a3a3a] px-2 py-0.5 text-[#38bdf8] hover:border-[#38bdf8]"
						>
							Origin {originSession.label}
						</button>
					) : null}
					{derivedSessions.map((session) => (
						<button
							key={session.piboSessionId}
							type="button"
							onClick={() => onOpenSession(session.piboSessionId)}
							className="border border-[#3a3a3a] px-2 py-0.5 text-[#38bdf8] hover:border-[#38bdf8]"
						>
							Derived {session.label}
						</button>
					))}
				</div>
				{sessionBreadcrumbs.length ? (
					<div className="mt-2 flex flex-wrap items-center gap-1 text-[#737373]">
						{sessionBreadcrumbs.map((item, index) => (
							<div key={item.piboSessionId} className="flex items-center gap-1">
								{index > 0 ? <ChevronRight size={12} className="text-[#525252]" /> : null}
								<button
									type="button"
									onClick={() => onOpenSession(item.piboSessionId)}
									className="hover:text-[#38bdf8]"
								>
									{item.label}
								</button>
							</div>
						))}
					</div>
				) : null}
			</div>

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
						className="min-h-0 h-full font-mono text-[12px] leading-[1.45]"
						computeItemKey={(_, row) => row.id}
						scrollerRef={stickyView.scrollerRef}
						atBottomStateChange={stickyView.atBottomStateChange}
						atBottomThreshold={stickyView.atBottomThreshold}
						followOutput={stickyView.followOutput}
						totalListHeightChanged={stickyView.totalListHeightChanged}
						alignToBottom
						components={{
							Footer: isStreaming ? TerminalStreamingFooter : undefined,
						}}
						itemContent={(_, row) => {
							const expanded = expandedRows.has(row.id);
							const collapseToolCallPreview = !expanded && isToolCallLikeRow(row);
							const visibleLines = collapseToolCallPreview ? collapsedToolCallPreviewLines(row) : row.lines;
							const toggleExpanded = () => {
								if (!row.expandable) return;
								setExpandedRows((current) => {
									const next = new Set(current);
									if (next.has(row.id)) next.delete(row.id);
									else next.add(row.id);
									return next;
								});
							};
							const handleRowDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
								if (isInteractiveEventTarget(event)) return;
								toggleExpanded();
							};
							const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
								if (!row.expandable || isInteractiveEventTarget(event)) return;
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									toggleExpanded();
								}
							};
							const rowClassName =
								(row.kind === "message.user"
									? "group border-b border-[#141414] bg-[#11a4d4]/10 py-2 last:border-b-0 hover:bg-[#11a4d4]/15"
									: row.kind === "execution.command"
										? "group border-b border-[#141414] bg-[#f59e0b]/5 py-2 last:border-b-0 hover:bg-[#f59e0b]/10"
										: "group border-b border-[#141414] py-2 last:border-b-0 hover:bg-[#161616]") +
								(row.expandable ? " focus:outline-none focus:ring-1 focus:ring-[#38bdf8]/50" : "");
							return (
								<div className="px-4">
									<div
										className={rowClassName}
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
										tabIndex={row.expandable ? 0 : undefined}
										aria-expanded={row.expandable ? expanded : undefined}
									>
										<div className="flex gap-3">
											<div className="min-w-0 flex-1">
												{row.kind === "message.assistant" ? (
													<div className="ml-[1.9rem] min-w-0">
														<div className="compact-terminal-markdown">
															<MarkdownRenderer>{typeof row.output === "string" ? row.output : ""}</MarkdownRenderer>
														</div>
													</div>
												) : row.kind === "tool.status" ? (
													<div className="min-w-0">
														<TerminalStatusCard row={row} />
													</div>
												) : row.kind === "tool.thinking" ? (
													<div className="min-w-0">
														<TerminalThinkingCard row={row} onLevelSelect={onThinkingLevelChange} />
													</div>
												) : row.kind === "tool.login" ? (
													<div className="min-w-0">
														<TerminalLoginCard row={row} piboSessionId={traceView?.piboSessionId} />
													</div>
												) : row.kind === "reasoning" && row.markdown ? (
													<>
														{visibleLines.map((line, index) => <TerminalLine key={`${row.id}:${index}`} line={line} status={row.status} clampLines={collapseToolCallPreview && index === 0 ? 5 : undefined} />)}
														<div className="ml-[1.9rem] min-w-0">
															<div className="compact-terminal-markdown compact-terminal-reasoning">
																<MarkdownRenderer>{row.markdown}</MarkdownRenderer>
															</div>
														</div>
													</>
												) : (
													visibleLines.map((line, index) => <TerminalLine key={`${row.id}:${index}`} line={line} status={row.status} clampLines={collapseToolCallPreview && index === 0 ? 5 : undefined} />)
												)}
											</div>
											<div className={`flex shrink-0 items-start gap-1 transition-opacity ${row.forkEntryId ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
												{row.linkedPiboSessionId ? (
													<RowAction
														label="Open linked session"
														onClick={() => onOpenSession(row.linkedPiboSessionId!)}
													>
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
										</div>
										{expanded ? <TerminalDetails row={row} onOpenSession={onOpenSession} /> : null}
									</div>
								</div>
							);
						}}
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

			{stickyView.isSticky ? null : (
				<button
					type="button"
					onClick={() => stickyView.stickToBottom("auto")}
					title="Scroll to latest"
					aria-label="Scroll to latest"
					className="absolute right-4 bottom-4 z-30 inline-flex h-9 w-9 items-center justify-center rounded-sm border border-[#38bdf8] bg-[#111111]/95 text-[#38bdf8] shadow-lg shadow-black/30 hover:bg-[#161616]"
				>
					<ChevronDown size={18} />
				</button>
			)}
		</section>
	);
}

function collapsedToolCallPreviewLines(row: { kind: string; lines: CompactTerminalLine[] }) {
	if (row.kind === "tool.group.exploring") return row.lines.slice(0, 1);
	return row.lines;
}

function isToolCallLikeRow(row: { kind: string; expandable?: boolean }) {
	return Boolean(row.expandable) && (
		row.kind === "tool.call" ||
		row.kind === "tool.group.exploring" ||
		row.kind === "agent.delegation" ||
		row.kind === "agent.async" ||
		row.kind === "yielded.run" ||
		row.kind === "execution.command"
	);
}

function isInteractiveEventTarget(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) {
	const target = event.target;
	if (!(target instanceof Element) || target === event.currentTarget) return false;
	const interactiveTarget = target.closest("button, a, input, textarea, select, summary, [role='button'], [tabindex]:not([tabindex='-1'])");
	return Boolean(interactiveTarget && interactiveTarget !== event.currentTarget);
}

function TerminalStreamingFooter() {
	return <div className="px-4 py-3 text-[#737373]">• Working</div>;
}

function TerminalBadge({
	tone,
	children,
}: {
	tone: "cyan" | "red" | "purple" | "neutral";
	children: ReactNode;
}) {
	const className =
		tone === "cyan"
			? "border-[#1f4960] text-[#38bdf8]"
			: tone === "red"
				? "border-[#5f2222] text-[#ef4444]"
				: tone === "purple"
					? "border-purple-500/40 text-purple-300"
					: "border-[#3a3a3a] text-[#d4d4d4]";
	return <span className={`border px-2 py-0.5 ${className}`}>{children}</span>;
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
