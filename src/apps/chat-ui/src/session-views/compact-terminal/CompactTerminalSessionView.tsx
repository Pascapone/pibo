import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";
import type { ChatSessionViewProps } from "../types";
import { TerminalDetails } from "./TerminalDetails";
import { TerminalLine } from "./TerminalLine";
import { TerminalStatusCard } from "./TerminalStatusCard";
import { TerminalThinkingCard } from "./TerminalThinkingCard";
import { buildCompactTerminalRows } from "./terminalRows";

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
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const bottomLockedRef = useRef(true);
	const [showJumpToBottom, setShowJumpToBottom] = useState(false);
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

	const scrollToBottom = (behavior: "auto" | "smooth" = "smooth") => {
		if (!rows.length) return;
		bottomLockedRef.current = true;
		virtuosoRef.current?.scrollToIndex({ index: rows.length - 1, align: "end", behavior });
		setShowJumpToBottom(false);
	};

	useLayoutEffect(() => {
		bottomLockedRef.current = true;
		const frame = requestAnimationFrame(() => scrollToBottom("auto"));
		return () => cancelAnimationFrame(frame);
	}, [traceView?.piboSessionId]);

	useLayoutEffect(() => {
		if (!isStreaming || !bottomLockedRef.current) return;
		const frame = requestAnimationFrame(() => scrollToBottom("auto"));
		return () => cancelAnimationFrame(frame);
	}, [isStreaming, rows]);

	return (
		<section className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[#0b0b0b] text-[#d4d4d4]">
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
						ref={virtuosoRef}
						data={rows}
						className="min-h-0 h-full font-mono text-[12px] leading-[1.45]"
						computeItemKey={(_, row) => row.id}
						atBottomStateChange={(atBottom) => {
							bottomLockedRef.current = atBottom;
							setShowJumpToBottom(!atBottom);
						}}
						followOutput={isStreaming ? ((atBottom) => (atBottom ? "auto" : false)) : false}
						components={{
							Footer: isStreaming ? TerminalStreamingFooter : undefined,
						}}
						itemContent={(_, row) => {
							const expanded = expandedRows.has(row.id);
							const rowClassName =
								row.kind === "message.user"
									? "group border-b border-[#141414] bg-[#11a4d4]/10 py-2 last:border-b-0 hover:bg-[#11a4d4]/15"
									: row.kind === "execution.command"
										? "group border-b border-[#141414] bg-[#f59e0b]/5 py-2 last:border-b-0 hover:bg-[#f59e0b]/10"
										: "group border-b border-[#141414] py-2 last:border-b-0 hover:bg-[#161616]";
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
												) : row.kind === "reasoning" && row.markdown ? (
													<>
														{row.lines.map((line, index) => <TerminalLine key={`${row.id}:${index}`} line={line} status={row.status} />)}
														<div className="ml-[1.9rem] min-w-0">
															<div className="compact-terminal-markdown compact-terminal-reasoning">
																<MarkdownRenderer>{row.markdown}</MarkdownRenderer>
															</div>
														</div>
													</>
												) : (
													row.lines.map((line, index) => <TerminalLine key={`${row.id}:${index}`} line={line} status={row.status} />)
												)}
											</div>
											<div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
												{row.linkedPiboSessionId ? (
													<RowAction
														label="Open linked session"
														onClick={() => onOpenSession(row.linkedPiboSessionId!)}
													>
														Open
													</RowAction>
												) : null}
												{row.forkEntryId ? (
													<RowAction label="Fork from this message" onClick={() => onFork(row.forkEntryId!)}>
														Fork
													</RowAction>
												) : null}
												{row.expandable ? (
													<RowAction
														label={expanded ? "Collapse details" : "Expand details"}
														onClick={() =>
															setExpandedRows((current) => {
																const next = new Set(current);
																if (next.has(row.id)) next.delete(row.id);
																else next.add(row.id);
																return next;
															})
														}
													>
														{expanded ? "Hide" : "Details"}
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

			{showJumpToBottom ? (
				<button
					type="button"
					onClick={() => scrollToBottom()}
					className="absolute right-4 bottom-4 border border-[#38bdf8] bg-[#111111] px-2 py-1 font-mono text-[11px] text-[#38bdf8] hover:bg-[#161616]"
				>
					Latest
				</button>
			) : null}
		</section>
	);
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
	children: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="min-h-7 min-w-7 border border-[#3a3a3a] px-2 text-[11px] text-[#737373] hover:border-[#38bdf8] hover:text-[#38bdf8]"
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
