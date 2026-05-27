import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Brain, Bug, ChevronsDown, ChevronsUp, EyeOff } from "lucide-react";
import { copyTextToClipboard } from "./clipboard";
import type { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import type { ChatSessionViewId } from "./session-views/types";
import { WebAnnotationsEntryPoints } from "./web-annotations";
import { WorkflowHeaderMeta, type WorkflowHeaderSummary } from "./projects/project-session-workflow";

export function SessionTraceHeader({
	title,
	roomLabel,
	headerPiboSessionId,
	piboSessionId,
	piboRoomId,
	webAnnotationsDisabled,
	webAnnotationsPanelRendered,
	workflowHeader,
	sessionViewId,
	sessionViews,
	currentSessionView,
	allowedSessionViewIds,
	showRawEvents,
	showThinking,
	expandThinking,
	onShowWebAnnotationsPanel,
	onHideWebAnnotationsPanel,
	onSelectSessionView,
	onToggleRawEvents,
	onToggleThinking,
	onToggleExpandThinking,
	onError,
}: {
	title: string | null | undefined;
	roomLabel: string;
	headerPiboSessionId: string;
	piboSessionId: string | null;
	piboRoomId?: string;
	webAnnotationsDisabled: boolean;
	webAnnotationsPanelRendered: boolean;
	workflowHeader: WorkflowHeaderSummary | null;
	sessionViewId: ChatSessionViewId;
	sessionViews: ReturnType<typeof listChatSessionViews>;
	currentSessionView: ReturnType<typeof getChatSessionView>;
	allowedSessionViewIds?: readonly ChatSessionViewId[];
	showRawEvents: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	onShowWebAnnotationsPanel: () => void;
	onHideWebAnnotationsPanel: () => void;
	onSelectSessionView: (viewId: ChatSessionViewId) => void;
	onToggleRawEvents: () => void;
	onToggleThinking: () => void;
	onToggleExpandThinking: () => void;
	onError: (message: string | null) => void;
}) {
	const [copiedHeaderPiboSessionId, setCopiedHeaderPiboSessionId] = useState<string | null>(null);
	const copyHeaderPiboSessionTimeout = useRef<number | undefined>(undefined);
	const headerPiboSessionCopied = copiedHeaderPiboSessionId === headerPiboSessionId;
	const allowedSessionViewIdSet = useMemo(() => allowedSessionViewIds ? new Set(allowedSessionViewIds) : null, [allowedSessionViewIds]);

	useEffect(() => {
		return () => {
			if (copyHeaderPiboSessionTimeout.current) window.clearTimeout(copyHeaderPiboSessionTimeout.current);
		};
	}, []);

	const copyHeaderPiboSessionId = () => {
		if (!headerPiboSessionId) return;
		void copyTextToClipboard(headerPiboSessionId).catch(() => undefined);
		setCopiedHeaderPiboSessionId(headerPiboSessionId);
		if (copyHeaderPiboSessionTimeout.current) window.clearTimeout(copyHeaderPiboSessionTimeout.current);
		copyHeaderPiboSessionTimeout.current = window.setTimeout(() => setCopiedHeaderPiboSessionId(null), 900);
	};

	return (
		<div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between max-[980px]:h-auto max-[980px]:flex-wrap max-[980px]:py-2 max-[980px]:gap-2">
			<div className="min-w-0">
				<h1 className="text-base font-semibold truncate">{title}</h1>
				<div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500">
					<span className="truncate">{roomLabel}</span>
					{headerPiboSessionId ? (
						<>
							<span className="text-slate-600">·</span>
							<button
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => void copyHeaderPiboSessionId()}
								title={headerPiboSessionCopied ? "Copied Pibo session ID" : "Copy Pibo session ID"}
								aria-label={headerPiboSessionCopied ? "Copied Pibo session ID" : "Copy Pibo session ID"}
								className={`min-w-0 max-w-48 truncate rounded-sm px-1 font-mono underline-offset-2 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#11a4d4] ${headerPiboSessionCopied ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/50" : "text-slate-400 hover:text-[#11a4d4] hover:underline"}`}
							>
								{headerPiboSessionId}
							</button>
						</>
					) : null}
					{workflowHeader ? <WorkflowHeaderMeta summary={workflowHeader} /> : null}
				</div>
			</div>
			<div className="flex items-center gap-2">
				<WebAnnotationsEntryPoints
					piboSessionId={piboSessionId}
					piboRoomId={piboRoomId}
					disabled={webAnnotationsDisabled}
					panelVisible={webAnnotationsPanelRendered}
					onShowPanel={onShowWebAnnotationsPanel}
					onHidePanel={onHideWebAnnotationsPanel}
					onError={onError}
				/>
				<div className="flex items-center rounded-sm border border-slate-700 bg-[#0e1116] p-0.5">
					{sessionViews.map((view) => {
						const disabledByRouting = Boolean(allowedSessionViewIdSet && !allowedSessionViewIdSet.has(view.id));
						return (
							<button
								key={view.id}
								type="button"
								onClick={() => { if (!disabledByRouting) onSelectSessionView(view.id); }}
								disabled={disabledByRouting}
								title={disabledByRouting ? `Project session routing uses the ${currentSessionView.label} view for this session kind.` : view.description ?? view.label}
								aria-label={disabledByRouting ? `${view.label} view unavailable for this Project session kind` : `Switch to ${view.label} view`}
								className={`min-w-20 px-2.5 py-1 text-[11px] font-bold tracking-wide max-[980px]:min-w-0 max-[980px]:px-1.5 disabled:cursor-not-allowed disabled:text-slate-600 ${
									sessionViewId === view.id
										? "bg-[#11a4d4]/10 text-[#11a4d4]"
										: "text-slate-400 hover:text-[#11a4d4] disabled:hover:text-slate-600"
								}`}
							>
								{view.label}
							</button>
						);
					})}
				</div>
				<HeaderIconButton
					onClick={onToggleRawEvents}
					title={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
					ariaLabel={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
					active={showRawEvents}
				>
					<Bug size={14} />
				</HeaderIconButton>
				<HeaderIconButton
					onClick={onToggleThinking}
					title={showThinking ? "Hide Thinking" : "Show Thinking"}
					ariaLabel={showThinking ? "Hide Thinking" : "Show Thinking"}
					active={showThinking}
				>
					{showThinking ? <Brain size={14} /> : <EyeOff size={14} />}
				</HeaderIconButton>
				{showThinking ? (
					<HeaderIconButton
						onClick={onToggleExpandThinking}
						title={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
						ariaLabel={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
						active={expandThinking}
					>
						{expandThinking ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
					</HeaderIconButton>
				) : null}
			</div>
		</div>
	);
}

function HeaderIconButton({
	title,
	ariaLabel,
	active,
	onClick,
	children,
}: {
	title: string;
	ariaLabel: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={ariaLabel}
			className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm transition-colors ${
				active
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]"
					: "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
			}`}
		>
			{children}
		</button>
	);
}
