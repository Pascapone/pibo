import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, CopyPlus, ExternalLink, History, Layers, Loader2, MoveRight, RefreshCw, Trash2 } from "lucide-react";
import {
	deleteWorkflow,
	getWorkflowVersionHistory,
	postWorkflowArchive,
	postWorkflowDuplicateDraft,
	postWorkflowNextDraft,
	type WorkflowCatalogAction,
	type WorkflowVersionHistoryOption,
} from "../api-workflows";
import { WorkflowPill } from "./workflow-shared-ui";
import {
	STARTER_DRAFT_ID,
	openBuilderPath,
	workflowBuilderDraftPath,
	workflowVersionSelectionKey,
	workflowVersionViewerPath,
} from "./workflow-routes";
import {
	groupWorkflowVersionHistory,
	hasWorkflowCatalogAction,
	workflowCatalogActionLabel,
	workflowHistoryStatusDescription,
	type WorkflowVersionHistoryGroup,
} from "./workflow-version-history-model";

type WorkflowLifecycleConfirmationTarget = {
	kind: "archive" | "delete";
	workflowId: string;
	title: string;
};

export function WorkflowLibraryPanel({ activeDraftId }: { activeDraftId?: string }) {
	const [historyRows, setHistoryRows] = useState<WorkflowVersionHistoryOption[]>([]);
	const [historyLoadState, setHistoryLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [historyErrorMessage, setHistoryErrorMessage] = useState<string | undefined>();
	const [duplicatingKey, setDuplicatingKey] = useState<string | undefined>();
	const [editingKey, setEditingKey] = useState<string | undefined>();
	const [archivingWorkflowId, setArchivingWorkflowId] = useState<string | undefined>();
	const [deletingWorkflowId, setDeletingWorkflowId] = useState<string | undefined>();
	const [pendingLifecycleAction, setPendingLifecycleAction] = useState<WorkflowLifecycleConfirmationTarget | undefined>();
	const [deleteConfirmWorkflowId, setDeleteConfirmWorkflowId] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const busy = Boolean(duplicatingKey || editingKey || archivingWorkflowId || deletingWorkflowId);

	const loadVersionHistory = useCallback(async () => {
		setHistoryLoadState("loading");
		setHistoryErrorMessage(undefined);
		try {
			const response = await getWorkflowVersionHistory();
			setHistoryRows(response.options);
			setHistoryLoadState("loaded");
		} catch (error) {
			setHistoryErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version history");
			setHistoryLoadState("error");
		}
	}, []);

	useEffect(() => {
		void loadVersionHistory();
	}, [loadVersionHistory]);

	const historyGroups = useMemo(() => groupWorkflowVersionHistory(historyRows), [historyRows]);

	const duplicateWorkflow = async (workflowId: string, version: string) => {
		const key = workflowVersionSelectionKey(workflowId, version);
		setDuplicatingKey(key);
		setErrorMessage(undefined);
		try {
			const result = await postWorkflowDuplicateDraft(workflowId, { version });
			openBuilderPath(result.builderPath);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Failed to duplicate workflow into a draft");
			setDuplicatingKey(undefined);
		}
	};

	const editPublishedWorkflow = async (workflowId: string, version: string) => {
		const key = workflowVersionSelectionKey(workflowId, version);
		setEditingKey(key);
		setErrorMessage(undefined);
		try {
			const result = await postWorkflowNextDraft(workflowId, { version });
			openBuilderPath(result.builderPath);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Failed to create next-version draft");
			setEditingKey(undefined);
		}
	};

	const requestArchiveWorkflow = (workflowId: string, title: string) => {
		setDeleteConfirmWorkflowId("");
		setErrorMessage(undefined);
		setPendingLifecycleAction({ kind: "archive", workflowId, title });
	};

	const requestDeleteWorkflow = (workflowId: string, title: string) => {
		setDeleteConfirmWorkflowId("");
		setErrorMessage(undefined);
		setPendingLifecycleAction({ kind: "delete", workflowId, title });
	};

	const archiveWorkflow = async () => {
		if (!pendingLifecycleAction || pendingLifecycleAction.kind !== "archive") return;
		const { workflowId } = pendingLifecycleAction;
		setArchivingWorkflowId(workflowId);
		setErrorMessage(undefined);
		try {
			await postWorkflowArchive(workflowId);
			setPendingLifecycleAction(undefined);
			await loadVersionHistory();
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Failed to archive workflow");
		} finally {
			setArchivingWorkflowId(undefined);
		}
	};

	const deleteWorkflowIdentity = async () => {
		if (!pendingLifecycleAction || pendingLifecycleAction.kind !== "delete") return;
		const { workflowId } = pendingLifecycleAction;
		setDeletingWorkflowId(workflowId);
		setErrorMessage(undefined);
		try {
			await deleteWorkflow(workflowId, { confirmWorkflowId: deleteConfirmWorkflowId });
			setPendingLifecycleAction(undefined);
			setDeleteConfirmWorkflowId("");
			await loadVersionHistory();
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Failed to delete workflow");
		} finally {
			setDeletingWorkflowId(undefined);
		}
	};

	return (
		<div className="flex w-full flex-col gap-4">
			<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
				<div className="flex items-start justify-between gap-3">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">UI draft</div>
						<h3 className="mt-1 text-sm font-bold text-slate-100">Starter UI draft</h3>
						<p className="mt-2 text-xs leading-5 text-slate-500">
							A draft row opens the builder route and loads a partial Pibo Workflow IR wrapper with diagnostics.
						</p>
					</div>
					<a
						className="shrink-0 rounded-sm border border-[#11a4d4]/50 px-3 py-1.5 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100"
						href={workflowBuilderDraftPath(STARTER_DRAFT_ID)}
					>
						Open draft
					</a>
				</div>
				{activeDraftId === STARTER_DRAFT_ID ? <div className="mt-3 text-[11px] font-semibold text-emerald-300">Currently open in the builder.</div> : null}
			</div>

			<WorkflowLifecycleConfirmationPanel
				target={pendingLifecycleAction}
				busy={busy}
				deleteConfirmWorkflowId={deleteConfirmWorkflowId}
				onDeleteConfirmChange={setDeleteConfirmWorkflowId}
				onCancel={() => {
					setPendingLifecycleAction(undefined);
					setDeleteConfirmWorkflowId("");
				}}
				onConfirmArchive={() => void archiveWorkflow()}
				onConfirmDelete={() => void deleteWorkflowIdentity()}
			/>

			<div className="grid gap-3" aria-label="Workflow version history">
				<div className="flex items-center justify-between gap-3">
					<div>
						<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
							<History size={13} />
							Version history
						</div>
						<p className="mt-1 text-[11px] leading-5 text-slate-500">
							Published versions are listed in deterministic workflow/version order. Only published rows are selectable for Project sessions; archived rows stay visible as history while deleted workflows render from Project snapshots.
						</p>
					</div>
					<button
						type="button"
						className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
						onClick={() => void loadVersionHistory()}
						disabled={historyLoadState === "loading"}
					>
						{historyLoadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
						Refresh
					</button>
				</div>
				{historyLoadState === "loading" ? (
					<div className="flex items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4 text-xs text-slate-400" aria-live="polite">
						<Loader2 size={14} className="animate-spin text-[#11a4d4]" />
						Loading workflow version history…
					</div>
				) : null}
				{historyLoadState === "error" ? (
					<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
						{historyErrorMessage ?? "Failed to load workflow version history."}
					</div>
				) : null}
				{historyLoadState === "loaded" && historyGroups.length === 0 ? (
					<div className="rounded-sm border border-dashed border-slate-700 bg-[#101d22]/70 p-4 text-xs text-slate-500">No workflow versions are registered yet.</div>
				) : null}
				{historyLoadState === "loaded" ? historyGroups.map((group) => (
					<WorkflowVersionHistoryGroupCard
						key={group.workflowId}
						group={group}
						busy={busy}
						duplicatingKey={duplicatingKey}
						editingKey={editingKey}
						archivingWorkflowId={archivingWorkflowId}
						deletingWorkflowId={deletingWorkflowId}
						onDuplicate={duplicateWorkflow}
						onEditPublished={editPublishedWorkflow}
						onArchive={requestArchiveWorkflow}
						onDelete={requestDeleteWorkflow}
					/>
				)) : null}
			</div>

			{errorMessage ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage}
				</div>
			) : null}
		</div>
	);
}

function WorkflowVersionHistoryGroupCard({
	group,
	busy,
	duplicatingKey,
	editingKey,
	archivingWorkflowId,
	deletingWorkflowId,
	onDuplicate,
	onEditPublished,
	onArchive,
	onDelete,
}: {
	group: WorkflowVersionHistoryGroup;
	busy: boolean;
	duplicatingKey?: string;
	editingKey?: string;
	archivingWorkflowId?: string;
	deletingWorkflowId?: string;
	onDuplicate: (workflowId: string, version: string) => Promise<void>;
	onEditPublished: (workflowId: string, version: string) => Promise<void>;
	onArchive: (workflowId: string, title: string) => void;
	onDelete: (workflowId: string, title: string) => void;
}) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-4" aria-label={`Version history for ${group.workflowId}`}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<div className="font-semibold text-slate-100">{group.title}</div>
						<WorkflowPill label={`${group.records.length} version${group.records.length === 1 ? "" : "s"}`} />
						<WorkflowPill label={`${group.source} source`} />
					</div>
					<div className="mt-1 font-mono text-[11px] text-slate-500">{group.workflowId}</div>
				</div>
			</div>
			<div className="mt-3 grid gap-2">
				{group.records.map((record) => (
					<WorkflowVersionHistoryRow
						key={workflowVersionSelectionKey(record.id, record.version)}
						record={record}
						busy={busy}
						duplicatingKey={duplicatingKey}
						editingKey={editingKey}
						archivingWorkflowId={archivingWorkflowId}
						deletingWorkflowId={deletingWorkflowId}
						onDuplicate={onDuplicate}
						onEditPublished={onEditPublished}
						onArchive={onArchive}
						onDelete={onDelete}
					/>
				))}
			</div>
		</div>
	);
}

function WorkflowVersionHistoryRow({
	record,
	busy,
	duplicatingKey,
	editingKey,
	archivingWorkflowId,
	deletingWorkflowId,
	onDuplicate,
	onEditPublished,
	onArchive,
	onDelete,
}: {
	record: WorkflowVersionHistoryOption;
	busy: boolean;
	duplicatingKey?: string;
	editingKey?: string;
	archivingWorkflowId?: string;
	deletingWorkflowId?: string;
	onDuplicate: (workflowId: string, version: string) => Promise<void>;
	onEditPublished: (workflowId: string, version: string) => Promise<void>;
	onArchive: (workflowId: string, title: string) => void;
	onDelete: (workflowId: string, title: string) => void;
}) {
	const key = workflowVersionSelectionKey(record.id, record.version);
	const published = record.status === "published";
	const canCreateNextDraft = hasWorkflowCatalogAction(record, "create_next_draft");
	const canDuplicate = hasWorkflowCatalogAction(record, "duplicate");
	const canCreateProjectSession = hasWorkflowCatalogAction(record, "create_project_session");
	const canView = hasWorkflowCatalogAction(record, "view");
	const canArchive = published && hasWorkflowCatalogAction(record, "archive");
	const canDelete = published && hasWorkflowCatalogAction(record, "delete");
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<div className="font-mono text-[11px] font-semibold text-slate-200">{record.id}@{record.version}</div>
						<WorkflowPill label={record.status} />
						<WorkflowPill label={`${record.source} source`} />
						{record.tags.map((tag) => <WorkflowPill key={tag} label={tag} />)}
					</div>
					{record.description ? <div className="mt-2 text-slate-500">{record.description}</div> : null}
					<div className={`mt-2 text-[11px] ${published ? "text-emerald-300" : "text-amber-200"}`}>{workflowHistoryStatusDescription(record)}</div>
					<WorkflowCatalogActionList actions={record.actions} />
				</div>
				<div className="flex shrink-0 flex-col gap-2">
					{canCreateNextDraft ? (
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-[#11a4d4]/50 px-3 py-1.5 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void onEditPublished(record.id, record.version)}
							disabled={busy}
						>
							{editingKey === key ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
							Edit published
						</button>
					) : null}
					{canDuplicate ? (
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void onDuplicate(record.id, record.version)}
							disabled={busy}
						>
							{duplicatingKey === key ? <Loader2 size={13} className="animate-spin" /> : <CopyPlus size={13} />}
							Duplicate to draft
						</button>
					) : null}
					{canCreateProjectSession ? (
						<a
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-700/70 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-500 hover:text-emerald-50"
							href="/apps/chat/projects"
						>
							<MoveRight size={13} />
							Create Project session
						</a>
					) : (
						<div className="max-w-44 rounded-sm border border-amber-800/70 bg-amber-950/20 p-2 text-[11px] text-amber-100">
							Unavailable for Project session selection.
						</div>
					)}
					{canView ? (
						<a
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100"
							href={workflowVersionViewerPath(record.id, record.version)}
						>
							<ExternalLink size={13} />
							View details
						</a>
					) : null}
					{canArchive ? (
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-amber-700/70 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:border-amber-500 hover:text-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => onArchive(record.id, record.title)}
							disabled={busy}
						>
							{archivingWorkflowId === record.id ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
							Archive workflow
						</button>
					) : null}
					{canDelete ? (
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-red-800/80 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:border-red-500 hover:text-red-50 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => onDelete(record.id, record.title)}
							disabled={busy}
						>
							{deletingWorkflowId === record.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
							Delete workflow
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}

function WorkflowCatalogActionList({ actions }: { actions: WorkflowCatalogAction[] }) {
	return (
		<div className="mt-3 flex flex-wrap gap-1" aria-label="Workflow Library source/status actions">
			{actions.map((action) => <WorkflowPill key={action} label={workflowCatalogActionLabel(action)} />)}
		</div>
	);
}

function WorkflowLifecycleConfirmationPanel({
	target,
	busy,
	deleteConfirmWorkflowId,
	onDeleteConfirmChange,
	onCancel,
	onConfirmArchive,
	onConfirmDelete,
}: {
	target?: WorkflowLifecycleConfirmationTarget;
	busy: boolean;
	deleteConfirmWorkflowId: string;
	onDeleteConfirmChange: (value: string) => void;
	onCancel: () => void;
	onConfirmArchive: () => void;
	onConfirmDelete: () => void;
}) {
	if (!target) return null;
	const isDelete = target.kind === "delete";
	const deleteConfirmationMatches = deleteConfirmWorkflowId.trim() === target.workflowId;
	return (
		<div className={`rounded-sm border p-4 text-xs leading-5 ${isDelete ? "border-red-900/70 bg-red-950/25 text-red-100" : "border-amber-800/70 bg-amber-950/20 text-amber-100"}`} role="region" aria-label={`${isDelete ? "Delete" : "Archive"} workflow confirmation`}>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em]">
						<AlertTriangle size={13} />
						Confirm {isDelete ? "delete" : "archive"}
					</div>
					<h3 className="mt-1 text-sm font-bold text-slate-100">{target.title}</h3>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{target.workflowId}</div>
					{isDelete ? (
						<>
							<p className="mt-3">
								Deleting tombstones the live workflow identity. It removes this workflow from the default catalog, workflow pickers, duplicate/edit/publish/archive actions, and new Project session creation.
							</p>
							<p className="mt-2">
								Historical Project runs remain inspectable from immutable snapshots and show a definition-deleted state instead of a broken live catalog link.
							</p>
							<label className="mt-3 block text-[11px] font-semibold text-red-100">
								Type the workflow id to confirm delete
								<input
									value={deleteConfirmWorkflowId}
									onChange={(event) => onDeleteConfirmChange(event.target.value)}
									className="mt-1 w-full rounded-sm border border-red-900/70 bg-[#101d22] px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-red-400"
									placeholder={target.workflowId}
									disabled={busy}
								/>
							</label>
						</>
					) : (
						<>
							<p className="mt-3">
								Archiving applies to the whole workflow identity. It hides this workflow from the default catalog and Project workflow selection lists.
							</p>
							<p className="mt-2">
								Published versions stay available only through archive filters and historical run links, and historical Project runs continue to render from their snapshots.
							</p>
						</>
					)}
				</div>
				<div className="flex shrink-0 flex-col gap-2">
					<button
						type="button"
						className="rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
						onClick={onCancel}
						disabled={busy}
					>
						Cancel
					</button>
					<button
						type="button"
						className={`rounded-sm border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${isDelete ? "border-red-700 text-red-100 hover:border-red-400" : "border-amber-600 text-amber-100 hover:border-amber-400"}`}
						onClick={isDelete ? onConfirmDelete : onConfirmArchive}
						disabled={busy || (isDelete && !deleteConfirmationMatches)}
					>
						{isDelete ? "Delete workflow" : "Archive workflow"}
					</button>
				</div>
			</div>
		</div>
	);
}
