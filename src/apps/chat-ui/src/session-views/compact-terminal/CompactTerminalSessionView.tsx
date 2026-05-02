import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";
import type { ChatSessionViewProps } from "../types";
import { TerminalDetails } from "./TerminalDetails";
import { TerminalLine } from "./TerminalLine";
import { buildCompactTerminalRows } from "./terminalRows";

export function CompactTerminalSessionView({
	traceView,
	isLoading,
	showThinking,
	expandThinking,
	sessionAgentProfile,
	sessionBreadcrumbs,
	originSession,
	derivedSessions,
	agentProfiles,
	sessionProfileChangeDisabled,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
}: ChatSessionViewProps) {
	const rows = useMemo(
		() => buildCompactTerminalRows(traceView, { showThinking }),
		[showThinking, traceView],
	);
	const scrollRef = useRef<HTMLDivElement>(null);
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

	const updateBottomLock = () => {
		const element = scrollRef.current;
		if (!element) return;
		const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
		bottomLockedRef.current = distanceFromBottom < 48;
		setShowJumpToBottom(distanceFromBottom > 180);
	};

	const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
		const element = scrollRef.current;
		if (!element) return;
		bottomLockedRef.current = true;
		element.scrollTo({ top: element.scrollHeight, behavior });
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

			<div ref={scrollRef} onScroll={updateBottomLock} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
				{!traceView ? (
					<EmptyTerminalState
						isLoading={isLoading}
						agentProfiles={agentProfiles}
						disabled={sessionProfileChangeDisabled}
						onSelectAgentProfile={onSessionAgentProfileChange}
					/>
				) : rows.length ? (
					<div className="px-4 py-3 font-mono text-[12px] leading-[1.45]">
						{rows.map((row) => {
							const expanded = expandedRows.has(row.id);
							const rowClassName =
								row.kind === "message.user"
									? "group border-b border-[#141414] bg-[#11a4d4]/10 py-2 last:border-b-0 hover:bg-[#11a4d4]/15"
									: "group border-b border-[#141414] py-2 last:border-b-0 hover:bg-[#161616]";
							return (
								<div
									key={row.id}
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
							);
						})}
						{isStreaming ? <div className="pt-2 text-[#737373]">• Working</div> : null}
					</div>
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

function TerminalBadge({
	tone,
	children,
}: {
	tone: "cyan" | "red" | "neutral";
	children: ReactNode;
}) {
	const className =
		tone === "cyan"
			? "border-[#1f4960] text-[#38bdf8]"
			: tone === "red"
				? "border-[#5f2222] text-[#ef4444]"
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
