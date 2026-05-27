import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	Archive,
	ArchiveRestore,
	Bug,
	Check,
	Copy,
	Edit3,
	Layers,
	Loader2,
	MoreVertical,
	Trash2,
	User,
	UserRound,
	X,
} from "lucide-react";
import type { PiboWebSessionNode } from "./types";
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
}) {
	const safeTitle = sessionNodeTitle(node);
	const sessionTooltip = sessionNodeTooltip(node);
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(safeTitle);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const hasChildren = node.children.length > 0;
	const hasSelectedDescendant = selectedPiboSessionId !== null && node.piboSessionId !== selectedPiboSessionId && selectedSessionPathIds.has(node.piboSessionId);
	const [expanded, setExpanded] = useState(hasSelectedDescendant);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const handle = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", handle);
		return () => document.removeEventListener("mousedown", handle);
	}, [menuOpen]);

	useEffect(() => {
		if (!editing) setDraftTitle(safeTitle);
	}, [editing, safeTitle]);

	useEffect(() => {
		if (!autoRename) return;
		setDraftTitle(safeTitle === "Untitled Session" ? "" : safeTitle);
		setEditing(true);
		onAutoRenameConsumed?.();
	}, [autoRename, safeTitle, onAutoRenameConsumed]);

	useLayoutEffect(() => {
		if (!editing) return;
		titleInputRef.current?.focus();
		titleInputRef.current?.select();
	}, [editing]);

	useEffect(() => {
		if (hasSelectedDescendant) setExpanded(true);
	}, [hasSelectedDescendant]);

	const submitRename = () => {
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
				className={`group w-full grid grid-cols-[1fr_auto] gap-1 items-center mb-1 border rounded-sm ${
					node.piboSessionId === selectedPiboSessionId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ paddingLeft: 8 + depth * 14 }}
				title={sessionTooltip}
			>
				{editing ? (
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
							title="Save Session Title"
							aria-label="Save Session Title"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Check size={13} />
						</button>
						<button
							type="button"
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
					<div className="min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center py-1 pr-1">
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
							className="min-w-0 text-left px-1 py-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className="min-w-0">
								<span className="flex min-w-0 items-center gap-1.5">
									{workflowKind && WorkflowKindIcon ? (
										<span className={`h-4 w-4 shrink-0 inline-flex items-center justify-center rounded-sm border ${workflowKind.className}`} title={workflowKind.ariaLabel} aria-label={workflowKind.ariaLabel}>
											<WorkflowKindIcon size={11} aria-hidden="true" />
										</span>
									) : null}
									<span className={`block min-w-0 truncate text-sm ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{safeTitle}</span>
								</span>
								<span className="mt-0.5 flex min-w-0 items-center gap-1.5">
									{workflowKind ? <span className={`shrink-0 rounded-sm border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${workflowKind.className}`} title={workflowKind.ariaLabel}>{workflowKind.label}</span> : null}
									<span className="min-w-0 truncate font-mono text-[10px] text-slate-500">{node.piboSessionId}</span>
								</span>
							</span>
						</button>
						<span className="grid grid-rows-[16px_16px] place-items-center gap-0.5">
							{loading ? (
								<Loader2 size={13} className="text-[#11a4d4] animate-spin" aria-label="Loading session" />
							) : (
								<span className={signal.className} title={signal.title} aria-label={signal.title} />
							)}
							{hasChildren ? (
								<button
									type="button"
									onClick={() => setExpanded((current) => !current)}
									aria-expanded={expanded}
									title={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									aria-label={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									className={`h-4 w-4 inline-flex items-center justify-center rounded-sm transition-colors ${
										expanded ? "text-[#0bda57]" : "text-slate-600 hover:text-[#11a4d4]"
									}`}
								>
									<Layers size={13} />
								</button>
							) : (
								<span className="h-4 w-4" />
							)}
						</span>
					</div>
				)}
				{editing ? null : (
					<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
						<div className="relative" ref={menuRef}>
							<button
								type="button"
								onClick={() => setMenuOpen((v) => !v)}
								title="Session actions"
								aria-label="Session actions"
								className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<MoreVertical size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
							</button>
							{menuOpen && (
								<div className="absolute right-0 top-full z-50 mt-1 w-48 bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1">
									{node.archived ? (
										<>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onArchive(node.piboSessionId, false); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<ArchiveRestore size={16} /> Restore Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onViewContext(node.piboSessionId); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Bug size={16} /> View Context
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onDelete(node); }}
												className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/10 flex items-center gap-2"
											>
												<Trash2 size={16} /> Delete Session
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); setEditing(true); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Edit3 size={16} /> Rename Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onArchive(node.piboSessionId, true); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Archive size={16} /> Archive Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onViewContext(node.piboSessionId); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Bug size={16} /> View Context
											</button>
										</>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
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
				/>
			)) : null}
		</div>
	);
}

function workflowSessionKindPresentation(kind: PiboWebSessionNode["workflowSessionKind"]): { label: string; ariaLabel: string; className: string; Icon: typeof Layers } | null {
	switch (kind) {
		case "main_workflow":
			return { label: "main workflow", ariaLabel: "Main workflow session", className: "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]", Icon: Layers };
		case "nested_workflow":
			return { label: "nested workflow", ariaLabel: "Nested workflow session", className: "border-violet-400/40 bg-violet-500/10 text-violet-300", Icon: Copy };
		case "agent_node":
			return { label: "agent node", ariaLabel: "Workflow agent node session", className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300", Icon: UserRound };
		case "subagent":
			return { label: "subagent", ariaLabel: "Subagent session", className: "border-amber-400/40 bg-amber-500/10 text-amber-300", Icon: User };
		default:
			return null;
	}
}
