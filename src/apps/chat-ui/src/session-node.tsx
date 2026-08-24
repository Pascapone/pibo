import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
	Archive,
	ArchiveRestore,
	Bug,
	Check,
	Copy,
	Edit3,
	Layers,
	Loader2,
	Trash2,
	User,
	UserRound,
	X,
} from "lucide-react";
import type { PiboWebSessionNode } from "./types";
import { ActionMenu, ActionMenuItem } from "./action-menu";
import { sessionNodeSignal, sessionNodeTitle, sessionNodeTooltip } from "./session-sidebar-helpers";

export function SessionNode({
	node,
	signalNow,
	selectedPiboSessionId,
	selectedSessionPathIds,
	onSelect,
	onRename,
	onArchive,
	onDelete,
	onViewContext,
	depth = 0,
	loadingPiboSessionId,
	autoRename = false,
	onAutoRenameConsumed,
	showWorkflowSessionKindMarkers = false,
	mutationsDisabled = false,
}: {
	node: PiboWebSessionNode;
	signalNow: number;
	selectedPiboSessionId: string | null;
	selectedSessionPathIds: ReadonlySet<string>;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	onDelete: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
	depth?: number;
	loadingPiboSessionId?: string | null;
	autoRename?: boolean;
	onAutoRenameConsumed?: () => void;
	showWorkflowSessionKindMarkers?: boolean;
	mutationsDisabled?: boolean;
}) {
	const safeTitle = sessionNodeTitle(node);
	const sessionTooltip = sessionNodeTooltip(node);
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(safeTitle);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const hasChildren = node.children.length > 0;
	const hasSelectedDescendant = selectedPiboSessionId !== null && node.piboSessionId !== selectedPiboSessionId && selectedSessionPathIds.has(node.piboSessionId);
	const [expanded, setExpanded] = useState(hasSelectedDescendant);
	const subsessionsRegionId = useId();

	useEffect(() => {
		if (!editing) setDraftTitle(safeTitle);
	}, [editing, safeTitle]);

	useEffect(() => {
		if (!autoRename || mutationsDisabled) return;
		setDraftTitle(safeTitle === "Untitled Session" ? "" : safeTitle);
		setEditing(true);
		onAutoRenameConsumed?.();
	}, [autoRename, mutationsDisabled, safeTitle, onAutoRenameConsumed]);

	useEffect(() => {
		if (mutationsDisabled) setEditing(false);
	}, [mutationsDisabled]);

	useLayoutEffect(() => {
		if (!editing) return;
		titleInputRef.current?.focus();
		titleInputRef.current?.select();
	}, [editing]);

	useEffect(() => {
		if (hasSelectedDescendant) setExpanded(true);
	}, [hasSelectedDescendant]);

	const submitRename = () => {
		if (mutationsDisabled) return;
		const title = draftTitle.trim();
		onRename(node.piboSessionId, title ? title : null);
		setEditing(false);
	};
	const signal = sessionNodeSignal(node, signalNow);
	const loading = loadingPiboSessionId === node.piboSessionId;
	const workflowKind = showWorkflowSessionKindMarkers ? workflowSessionKindPresentation(node.workflowSessionKind) : null;
	const WorkflowKindIcon = workflowKind?.Icon;

	return (
		<div>
			<div
				data-pibo-component="SessionNode"
				data-pibo-debug="session-row"
				data-pibo-session-id={node.piboSessionId}
				data-pibo-title={safeTitle}
				data-pibo-selected={node.piboSessionId === selectedPiboSessionId ? "true" : "false"}
				data-pibo-state={loading ? "loading" : node.status ?? "idle"}
				data-pibo-archived={node.archived ? "true" : "false"}
				data-pibo-unread-count={node.unreadCount ?? 0}
				className={`group w-full grid grid-cols-[1fr_auto] gap-0.5 items-center mb-0.5 border rounded-sm ${
					node.piboSessionId === selectedPiboSessionId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ paddingLeft: 8 + depth * 14 }}
				title={sessionTooltip}
			>
				{editing && !mutationsDisabled ? (
					<form
						className="min-w-0 grid grid-cols-[1fr_auto_auto] gap-1 py-1 pr-1"
						onSubmit={(event) => {
							event.preventDefault();
							submitRename();
						}}
					>
						<input
							ref={titleInputRef}
							value={draftTitle}
							disabled={mutationsDisabled}
							onChange={(event) => setDraftTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setEditing(false);
									setDraftTitle(safeTitle);
								}
							}}
							autoFocus
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
						/>
						<button
							type="submit"
							disabled={mutationsDisabled}
							title="Save Session Title"
							aria-label="Save Session Title"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Check size={13} />
						</button>
						<button
							type="button"
							disabled={mutationsDisabled}
							onClick={() => {
								setEditing(false);
								setDraftTitle(safeTitle);
							}}
							title="Cancel Rename"
							aria-label="Cancel Rename"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<X size={13} />
						</button>
					</form>
				) : (
					<div className="min-w-0 h-7 max-[980px]:h-8 grid grid-cols-[1fr_auto] gap-1 items-center pr-0.5">
						<button
							type="button"
							onClick={() => {
								if (hasChildren && node.piboSessionId === selectedPiboSessionId) {
									setExpanded((current) => !current);
									return;
								}
								onSelect(node.piboSessionId);
							}}
							aria-label={workflowKind ? `${workflowKind.ariaLabel}: ${safeTitle}` : `Open session ${safeTitle}`}
							aria-current={node.piboSessionId === selectedPiboSessionId ? "page" : undefined}
							className="h-7 max-[980px]:h-8 min-w-0 text-left px-1 flex items-center gap-1.5"
						>
							{workflowKind && WorkflowKindIcon ? (
								<span className={`h-4 w-4 shrink-0 inline-flex items-center justify-center rounded-sm border ${workflowKind.className}`} title={workflowKind.ariaLabel} aria-label={workflowKind.ariaLabel}>
									<WorkflowKindIcon size={11} aria-hidden="true" />
								</span>
							) : null}
							<span className={`block min-w-0 truncate text-[13px] leading-none ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{safeTitle}</span>
						</button>
						<span className="inline-flex items-center justify-end gap-1">
							{loading ? (
								<Loader2 size={12} className="text-[#11a4d4] animate-spin" aria-label="Loading session" />
							) : (
								<span className={signal.className} title={signal.title} aria-label={signal.title} />
							)}
							{hasChildren ? (
								<button
									type="button"
									onClick={() => setExpanded((current) => !current)}
									aria-expanded={expanded}
									aria-controls={subsessionsRegionId}
									title={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									aria-label={`Subsessions for ${safeTitle}`}
									className={`h-5 w-5 inline-flex items-center justify-center rounded-sm transition-colors ${
										expanded ? "text-[#0bda57]" : "text-slate-600 hover:text-[#11a4d4]"
									}`}
								>
									<Layers size={12} />
								</button>
							) : null}
						</span>
					</div>
				)}
				{editing && !mutationsDisabled ? null : (
					<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
						<ActionMenu
							label={`Actions for session ${safeTitle}`}
							estimatedHeight={144}
							disabled={mutationsDisabled}
						>
							{node.archived ? (
								<>
									<ActionMenuItem onSelect={() => onArchive(node.piboSessionId, false)}>
										<ArchiveRestore size={16} /> Restore Session
									</ActionMenuItem>
									<ActionMenuItem onSelect={() => onViewContext(node.piboSessionId)}>
										<Bug size={16} /> View Context
									</ActionMenuItem>
									<ActionMenuItem onSelect={() => onDelete(node)} className="text-red-300 hover:bg-red-500/10">
										<Trash2 size={16} /> Delete Session
									</ActionMenuItem>
								</>
							) : (
								<>
									<ActionMenuItem onSelect={() => setEditing(true)}>
										<Edit3 size={16} /> Rename Session
									</ActionMenuItem>
									<ActionMenuItem onSelect={() => onArchive(node.piboSessionId, true)}>
										<Archive size={16} /> Archive Session
									</ActionMenuItem>
									<ActionMenuItem onSelect={() => onViewContext(node.piboSessionId)}>
										<Bug size={16} /> View Context
									</ActionMenuItem>
								</>
							)}
						</ActionMenu>
					</div>
				)}
			</div>
			{hasChildren ? (
				<div id={subsessionsRegionId} hidden={!expanded}>
					{expanded ? node.children.map((child) => (
						<SessionNode
							key={child.piboSessionId}
							node={child}
							signalNow={signalNow}
							selectedPiboSessionId={selectedPiboSessionId}
							selectedSessionPathIds={selectedSessionPathIds}
							onSelect={onSelect}
							onRename={onRename}
							onArchive={onArchive}
							onDelete={onDelete}
							onViewContext={onViewContext}
							depth={depth + 1}
							loadingPiboSessionId={loadingPiboSessionId}
							showWorkflowSessionKindMarkers={showWorkflowSessionKindMarkers}
							mutationsDisabled={mutationsDisabled}
						/>
					)) : null}
				</div>
			) : null}
		</div>
	);
}

function workflowSessionKindPresentation(kind: PiboWebSessionNode["workflowSessionKind"]): { ariaLabel: string; className: string; Icon: typeof Layers } | null {
	switch (kind) {
		case "main_workflow":
			return { ariaLabel: "Main workflow session", className: "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]", Icon: Layers };
		case "nested_workflow":
			return { ariaLabel: "Nested workflow session", className: "border-violet-400/40 bg-violet-500/10 text-violet-300", Icon: Copy };
		case "agent_node":
			return { ariaLabel: "Workflow agent node session", className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300", Icon: UserRound };
		case "subagent":
			return { ariaLabel: "Subagent session", className: "border-amber-400/40 bg-amber-500/10 text-amber-300", Icon: User };
		default:
			return null;
	}
}
