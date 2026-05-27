import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
	Background,
	Controls,
	Handle,
	MarkerType,
	MiniMap,
	Position,
	ReactFlow,
	addEdge as addReactFlowEdge,
	applyEdgeChanges,
	applyNodeChanges,
	type Connection,
	type EdgeChange,
	type NodeChange,
	type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Archive, BookOpenText, Brain, CheckCheck, Code2, CopyPlus, ExternalLink, History, Layers, Link2, Loader2, MousePointer2, MoveRight, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { SaveState } from "./api";
import {
	deleteWorkflow,
	getWorkflowAdapterPicker,
	getWorkflowDraft,
	getWorkflowGuardPicker,
	getWorkflowHandlerPicker,
	getWorkflowHumanActionPicker,
	getWorkflowProfilePicker,
	getWorkflowPromptAsset,
	getWorkflowPromptAssetPicker,
	getWorkflowVersionPicker,
	getWorkflowVersionHistory,
	patchWorkflowDraft,
	postWorkflowArchive,
	postWorkflowDraftPublish,
	postWorkflowDraftValidate,
	postWorkflowDuplicateDraft,
	postWorkflowNextDraft,
	postWorkflowPromptAssetRevision,
	type WorkflowCatalogAction,
	type WorkflowCatalogVersionRecord,
	type WorkflowDraftDefinition,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowPickerDiagnostic,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
	type WorkflowPromptAssetDocument,
	type WorkflowRegisteredRefOption,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowValidationTrigger,
	type WorkflowVersionPickerOption,
	type WorkflowVersionPickerResponse,
	type WorkflowVersionHistoryOption,
	type WorkflowVersionHistoryResponse,
} from "./api-workflows";
import { MarkdownEditor } from "./context/MarkdownEditor";
import {
	addWorkflowGraphEdge,
	addWorkflowGraphNodeDefinition,
	createWorkflowGraphProjection,
	deleteWorkflowGraphEdge,
	deleteWorkflowGraphNode,
	isWorkflowJsonObject,
	nextGraphNodePosition,
	nextWorkflowEdgeId,
	nextWorkflowNodeId,
	projectionHasElement,
	readEdgeEndpointNodeId,
	readWorkflowEdgeDefinitions,
	readWorkflowNodeDefinitions,
	workflowNodeKind,
	workflowNodeLabel,
	writeWorkflowGraphPositions,
	type GraphPosition,
	type SelectedGraphElement,
	type WorkflowGraphFlowEdge,
	type WorkflowGraphFlowNode,
	type WorkflowJsonObject,
} from "./workflows/workflow-graph-model";
import {
	applyWorkflowEdgeAdapterChoice,
	createWorkflowEdgePortDetails,
	insertWorkflowAdapterNodeForEdge,
	readWorkflowEdgeAdapterRef,
	type WorkflowEdgePortDetails,
} from "./workflows/workflow-edge-adapters";
import {
	groupWorkflowVersionHistory,
	hasWorkflowCatalogAction,
	workflowCatalogActionLabel,
	workflowHistoryStatusDescription,
	type WorkflowVersionHistoryGroup,
} from "./workflows/workflow-version-history-model";

const DEFAULT_AGENT_PROMPT_TEMPLATE = "Use the workflow input to produce a concise answer.\n\n{{input}}";
const DEFAULT_WORKFLOW_JSON_SCHEMA: WorkflowJsonObject = { type: "object", properties: {}, required: [], additionalProperties: false };
const WORKFLOW_STATE_SCOPES: WorkflowStateScope[] = ["global", "local", "edge"];
const DEFAULT_LOCAL_STATE_PATHS = ["draft", "notes", "result"];
const DEFAULT_EDGE_STATE_PATHS = ["payload", "previous", "resume"];
const DEFAULT_WRITE_STATE_SCOPES: WorkflowStateScope[] = ["global", "local"];
const STARTER_DRAFT_ID = "v2-starter-draft";
const RAW_IR_PARSE_DIAGNOSTIC_CODE = "WorkflowBuilderWarning.invalidRawIrText";
type WorkflowVersionSelection = { workflowId: string; workflowVersion: string };
type WorkflowPortKindSelection = "text" | "json";
type OptionalWorkflowPortKindSelection = "none" | WorkflowPortKindSelection;
type WorkflowStateScope = "global" | "local" | "edge";
type WorkflowGlobalStateMergeKind = "none" | "replace" | "append" | "shallowMerge";
type WorkflowGlobalStateFieldFormState = {
	path: string;
	description: string;
	schemaText: string;
	mergeKind: WorkflowGlobalStateMergeKind;
};
type WorkflowStateAccessFormState = {
	reads: string[];
	writes: string[];
	readScope: WorkflowStateScope;
	readPath: string;
	writeScope: WorkflowStateScope;
	writePath: string;
};
type WorkflowHumanActionFormChoice = { id: string; kind?: string };
type WorkflowHumanTimeoutKind = "none" | "milliseconds" | "seconds" | "minutes" | "iso8601";
type WorkflowSettingsFormState = {
	title: string;
	description: string;
	inputKind: WorkflowPortKindSelection;
	inputDescription: string;
	inputSchemaText: string;
	outputKind: WorkflowPortKindSelection;
	outputDescription: string;
	outputSchemaText: string;
	globalStateFields: WorkflowGlobalStateFieldFormState[];
	metadataTags: string;
	metadataUseWhen: string;
	metadataNotFor: string;
	metadataExamples: string;
};
type WorkflowNodeInspectorFormState = {
	label: string;
	description: string;
	inputKind: OptionalWorkflowPortKindSelection;
	inputDescription: string;
	inputSchemaText: string;
	outputKind: OptionalWorkflowPortKindSelection;
	outputDescription: string;
	outputSchemaText: string;
	stateAccess: WorkflowStateAccessFormState;
	profileId: string;
	promptTemplate: string;
	handlerId: string;
	adapterRef: string;
	adapterParamsText: string;
	workflowVersionKey: string;
	humanPrompt: string;
	humanSchemaText: string;
	humanActionRefs: WorkflowHumanActionFormChoice[];
	humanTimeoutKind: WorkflowHumanTimeoutKind;
	humanTimeoutValue: string;
};
type WorkflowEdgeInspectorFormState = {
	sourceNodeId: string;
	sourcePortId: string;
	targetNodeId: string;
	targetPortId: string;
	kind: "data" | "control" | "error" | "resume";
	guardHandler: string;
	guardPriority: string;
	guardParamsText: string;
	adapterRef: string;
	adapterParamsText: string;
	stateAccess: WorkflowStateAccessFormState;
};
type WorkflowRawIrEditorSaveState = "idle" | "saving" | "saved" | "warning" | "error";

type WorkflowLifecycleConfirmationTarget = {
	kind: "archive" | "delete";
	workflowId: string;
	title: string;
};

export function WorkflowsArea({ draftId, viewWorkflowId, viewWorkflowVersion }: { draftId?: string; viewWorkflowId?: string; viewWorkflowVersion?: string }) {
	return (
		<main className="h-full min-h-0 overflow-auto bg-[#101d22]">
			<section className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 max-[720px]:p-4" aria-labelledby="workflows-title">
				<div className="rounded-sm border border-slate-800 bg-[#151f24] p-5 shadow-lg shadow-black/20">
					<div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#11a4d4]">Workflow UI Authoring V2</div>
					<h1 id="workflows-title" className="mt-2 text-2xl font-extrabold tracking-tight text-slate-100">Workflows</h1>
					<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
						Browse workflow definitions, duplicate published workflows into UI drafts, and open draft wrappers that edit Pibo Workflow IR from the authenticated Chat Web surface.
					</p>
				</div>

				<div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
					<WorkflowSurfaceCard
						icon={BookOpenText}
						eyebrow="Global catalog"
						title="Workflow Library"
						description="Open UI drafts or duplicate published workflow versions into a draft before editing."
					>
						<WorkflowLibraryPanel activeDraftId={draftId} />
					</WorkflowSurfaceCard>

					<WorkflowSurfaceCard
						icon={Layers}
						eyebrow="Visual authoring"
						title="Workflow Builder"
						description="Load a UI draft wrapper and keep Pibo Workflow IR as the editable source of truth."
					>
						{draftId ? (
							<WorkflowBuilderDraftLoader draftId={draftId} />
						) : viewWorkflowId && viewWorkflowVersion ? (
							<WorkflowVersionViewer workflowId={viewWorkflowId} workflowVersion={viewWorkflowVersion} />
						) : (
							<WorkflowBuilderLanding />
						)}
					</WorkflowSurfaceCard>
				</div>

				<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24] p-4 text-xs text-slate-400 md:grid-cols-4">
					<WorkflowPrinciple icon={CheckCheck} label="Pibo Workflow IR remains the source of truth" />
					<WorkflowPrinciple icon={CopyPlus} label="Code workflows can be duplicated into UI drafts" />
					<WorkflowPrinciple icon={ShieldCheck} label="Workflow capabilities are registered refs only" />
					<WorkflowPrinciple icon={Layers} label="XState stays a read-only visualization projection" />
				</div>

				<WorkflowExplicitNonGoalsPanel />
			</section>
		</main>
	);
}

function WorkflowLibraryPanel({ activeDraftId }: { activeDraftId?: string }) {
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

function WorkflowBuilderLanding() {
	return (
		<div className="flex w-full flex-col gap-4">
			<WorkflowEmptyState
				title="Open a draft to start authoring"
				description="Use the Workflow Library draft row or Duplicate to draft action. The builder route will load a draft wrapper around Pibo Workflow IR, not raw XState source."
			/>
			<WorkflowSecurityBoundaryPanel />
			<WorkflowBuilderAgentNodeEditor />
			<WorkflowBuilderCodeNodeEditor />
			<WorkflowBuilderAdapterNodeEditor />
			<WorkflowBuilderWorkflowNodeEditor />
		</div>
	);
}

function WorkflowBuilderDraftLoader({ draftId }: { draftId: string }) {
	const [draft, setDraft] = useState<WorkflowDraftRecord | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowDraft(draftId)
			.then((response) => {
				if (cancelled) return;
				setDraft(response.draft);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow draft");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [draftId]);

	if (loadState === "loading") {
		return (
			<div className="flex w-full items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4 text-sm text-slate-300" aria-live="polite">
				<Loader2 size={16} className="animate-spin text-[#11a4d4]" />
				Loading workflow draft {draftId}…
			</div>
		);
	}

	if (loadState === "error" || !draft) {
		return (
			<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-4 text-sm leading-6 text-red-200" role="alert">
				<div className="font-bold">Could not load workflow draft</div>
				<div className="mt-1 text-xs">{errorMessage ?? `Draft '${draftId}' was not found.`}</div>
			</div>
		);
	}

	return <WorkflowDraftEditorShell draft={draft} />;
}

function WorkflowExplicitNonGoalsPanel() {
	return (
		<div className="rounded-sm border border-amber-700/60 bg-amber-950/15 p-4 text-xs leading-5 text-amber-100" aria-label="Workflow V2 explicit non-goals">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">
				<ShieldCheck size={13} />
				V2 scope boundary
			</div>
			<p className="mt-2 text-amber-100/90">
				Workflows V2 is an authoring surface for Pibo Workflow IR and registered capability references, not a code or product import/export surface.
			</p>
			<ul className="mt-3 grid gap-1 text-[11px] text-amber-100/75 md:grid-cols-2">
				<li>No inline TypeScript, JavaScript, shell, eval, arbitrary executable code, or raw handler body authoring.</li>
				<li>No raw XState editing, workflow templates, workflow slash commands, or workflow tools for agents.</li>
				<li>No YAML/JSON product import/export or TypeScript export path from UI-authored workflows.</li>
				<li>No Zod schema authoring; schema edits remain constrained to Pibo Workflow IR and registered metadata.</li>
			</ul>
		</div>
	);
}

function WorkflowSecurityBoundaryPanel() {
	return (
		<div className="rounded-sm border border-emerald-900/60 bg-emerald-950/15 p-4 text-xs leading-5 text-emerald-100" aria-label="Registered capability security boundary">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
				<ShieldCheck size={13} />
				Registered capability security boundary
			</div>
			<p className="mt-2 text-emerald-100/90">
				V2 authoring composes registered refs only: non-archived Agent profiles, code handlers, adapters, guards, nested workflows, human actions, and prompt assets.
			</p>
			<ul className="mt-3 grid gap-1 text-[11px] text-emerald-100/75">
				<li>Existing Chat Web auth plus Project and Pibo Session visibility rules still gate workflow catalog, Project workflow sessions, snapshots, lifecycle events, prompt assets, and human actions.</li>
				<li>Agent nodes select profile refs only; the UI does not grant extra tools, skills, context files, native tools, MCP servers, or compute-worker access beyond the selected runtime profile.</li>
				<li>No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies are created by the UI.</li>
				<li>Incompatible schemas must use a visible registered adapter node or edge adapter; hidden LLM coercion is not used.</li>
				<li>XState remains projection-only; Pibo Workflow IR is the persisted source of truth.</li>
				<li>Workflow inputs, outputs, prompts, prompt assets, state, edge payloads, snapshots, and human action payloads remain sensitive workflow data; normal diagnostics expose only sanitized metadata.</li>
			</ul>
		</div>
	);
}

function WorkflowDraftEditorShell({ draft }: { draft: WorkflowDraftRecord }) {
	const [currentDraft, setCurrentDraft] = useState(draft);
	const [versionIntent, setVersionIntent] = useState<"patch" | "minor" | "major">(draft.versionIntent);
	const [publishState, setPublishState] = useState<"idle" | "validating" | "validated" | "publishing" | "published" | "error">("idle");
	const [publishMessage, setPublishMessage] = useState<string | undefined>();
	const publishActionBusy = publishState === "validating" || publishState === "publishing";
	const publishErrorCount = currentDraft.validation?.errorCount ?? currentDraft.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const publishWarningCount = currentDraft.validation?.warningCount ?? currentDraft.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const publishBlocked = currentDraft.validation?.blocksPublish === true || publishErrorCount > 0;

	useEffect(() => {
		setCurrentDraft(draft);
		setVersionIntent(draft.versionIntent);
		setPublishState("idle");
		setPublishMessage(undefined);
	}, [draft]);

	const validateDraft = async () => {
		setPublishState("validating");
		setPublishMessage(undefined);
		try {
			const response = await postWorkflowDraftValidate(currentDraft.draftId);
			setCurrentDraft(response.draft);
			setVersionIntent(response.draft.versionIntent);
			setPublishState("validated");
			setPublishMessage(`Draft validation ${response.validation.ok ? "passed" : "returned diagnostics"}. Publish remains a separate action.`);
		} catch (error) {
			setPublishState("error");
			setPublishMessage(error instanceof Error ? error.message : "Failed to validate workflow draft");
		}
	};

	const publishDraft = async () => {
		setPublishState("publishing");
		setPublishMessage(undefined);
		try {
			const response = await postWorkflowDraftPublish(currentDraft.draftId, { versionIntent });
			setCurrentDraft(response.draft);
			setVersionIntent(response.draft.versionIntent);
			setPublishState("published");
			setPublishMessage(response.publishedVersion
				? `${response.message ?? "Published workflow draft."} Definition hash ${response.publishedVersion.definitionHash}.`
				: response.message ?? "Publish validation passed.");
		} catch (error) {
			setPublishState("error");
			setPublishMessage(error instanceof Error ? error.message : "Failed to publish workflow draft");
		}
	};

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Loaded UI draft</div>
					<h3 className="mt-1 text-lg font-bold text-slate-100">{String(currentDraft.definition.title ?? currentDraft.workflowId)}</h3>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						Builder route <code className="rounded bg-slate-900 px-1 text-slate-300">/workflows/drafts/{currentDraft.draftId}</code> loaded a draft wrapper around partial Pibo Workflow IR.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${currentDraft.source} source`} />
					<WorkflowPill label={currentDraft.status} />
					<WorkflowPill label={currentDraft.validationState} />
					<WorkflowPill label={`rev ${currentDraft.revision}`} />
				</div>
			</div>

			<div className="grid gap-3 text-xs md:grid-cols-2" aria-label="Workflow draft metadata">
				<WorkflowFact label="Draft id" value={currentDraft.draftId} />
				<WorkflowFact label="Workflow id" value={currentDraft.workflowId} />
				<WorkflowFact label="Base workflow" value={currentDraft.baseWorkflowId && currentDraft.baseWorkflowVersion ? `${currentDraft.baseWorkflowId}@${currentDraft.baseWorkflowVersion}` : "new UI draft"} />
				<WorkflowFact label="Next version path" value={currentDraft.targetWorkflowVersion ?? "not assigned yet"} />
				<WorkflowFact label="Version intent" value={currentDraft.versionIntent} />
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Workflow publish version panel">
				<div id="workflow-publish-gate" className={`mb-3 rounded-sm border p-3 text-xs leading-5 ${publishBlocked ? "border-amber-700/70 bg-amber-950/30 text-amber-100" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} aria-label="Workflow publish gate" role="status">
					<div className="font-semibold">{publishBlocked ? "Publish blocked by draft diagnostics" : "Publish gate ready"}</div>
					<p className="mt-1">
						{publishBlocked
							? `Publish is disabled because ${publishErrorCount} error diagnostic${publishErrorCount === 1 ? "" : "s"} ${publishErrorCount === 1 ? "remains" : "remain"}. Draft save remains allowed while you fix errors; before-publish validation also requires workflow input/output ports and at least one node.`
							: publishWarningCount > 0
								? `Warnings do not block publishing. Before-publish validation still runs and will block if workflow input/output ports, graph nodes, or registered refs are invalid.`
								: "No blocking diagnostics are present. Before-publish validation will run again before creating an immutable workflow version."}
					</p>
				</div>
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Publish version intent</div>
						<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
							Default publish increments the patch version. Choose minor or major when the release scope needs a larger semantic version bump.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
							<span>Version bump intent</span>
							<select
								className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-[#11a4d4]"
								value={versionIntent}
								onChange={(event) => setVersionIntent(event.target.value as "patch" | "minor" | "major")}
								disabled={publishActionBusy}
								aria-label="Version bump intent"
							>
								<option value="patch">Patch version bump (default)</option>
								<option value="minor">Minor version bump</option>
								<option value="major">Major version bump</option>
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-[#11a4d4] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void validateDraft()}
							disabled={publishActionBusy}
						>
							{publishState === "validating" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
							Validate draft
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-600/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void publishDraft()}
							disabled={publishActionBusy || publishBlocked}
							aria-describedby="workflow-publish-gate"
						>
							{publishState === "publishing" ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}
							Publish draft
						</button>
					</div>
				</div>
				{publishMessage ? (
					<div className={`mt-3 rounded-sm border p-3 text-xs leading-5 ${publishState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role={publishState === "error" ? "alert" : "status"}>
						{publishMessage}
					</div>
				) : null}
			</div>

			<WorkflowSecurityBoundaryPanel />

			<WorkflowGraphCanvas draft={currentDraft} onDraftChange={setCurrentDraft} />

			<WorkflowValidationPanel draft={currentDraft} />

			<WorkflowRawIrEditor draft={currentDraft} onDraftChange={setCurrentDraft} />

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Raw XState source is not opened as an editable document. XState remains projection-only; the editable source is the Pibo Workflow IR shown above and in the raw Pibo Workflow IR editor.
			</div>
		</div>
	);
}

function WorkflowRawIrEditor({ draft, onDraftChange }: { draft: WorkflowDraftRecord; onDraftChange: (draft: WorkflowDraftRecord) => void }) {
	const formattedDraftDefinition = useMemo(() => JSON.stringify(draft.definition, null, 2), [draft.definition]);
	const [rawText, setRawText] = useState(formattedDraftDefinition);
	const [isDirty, setIsDirty] = useState(false);
	const [saveState, setSaveState] = useState<WorkflowRawIrEditorSaveState>("idle");
	const [statusMessage, setStatusMessage] = useState<string | undefined>();
	const rawParseDiagnostics = draft.diagnostics.filter((diagnostic) => diagnostic.code === RAW_IR_PARSE_DIAGNOSTIC_CODE);

	useEffect(() => {
		if (!isDirty) {
			setRawText(formattedDraftDefinition);
		}
	}, [formattedDraftDefinition, isDirty]);

	const saveRawIr = async () => {
		setSaveState("saving");
		setStatusMessage(undefined);
		try {
			const response = await patchWorkflowDraft(draft.draftId, { rawDefinitionText: rawText, editTrigger: "raw_ir_edit" });
			onDraftChange(response.draft);
			const hasRawParseWarning = response.diagnostics.some((diagnostic) => diagnostic.code === RAW_IR_PARSE_DIAGNOSTIC_CODE);
			if (hasRawParseWarning) {
				setIsDirty(true);
				setSaveState("warning");
				setStatusMessage("Raw Workflow IR text was not saved; the last valid draft object remains unchanged.");
				return;
			}
			setRawText(JSON.stringify(response.draft.definition, null, 2));
			setIsDirty(false);
			setSaveState("saved");
			setStatusMessage(`Saved raw Workflow IR to the draft. Validation state: ${response.validation.validationState}.`);
		} catch (error) {
			setSaveState("error");
			setStatusMessage(error instanceof Error ? error.message : "Failed to save raw Workflow IR text");
		}
	};

	const resetRawIr = () => {
		setRawText(formattedDraftDefinition);
		setIsDirty(false);
		setSaveState("idle");
		setStatusMessage("Reset the editor from the last valid Pibo Workflow IR object.");
	};

	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Raw Pibo Workflow IR editor panel">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Raw Pibo Workflow IR editor</div>
					<h4 className="mt-1 text-sm font-bold text-slate-100">Safe raw Workflow IR sync</h4>
					<p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">
						Edit only Pibo Workflow IR JSON. Saving valid JSON parses into the same draft object used by the graph and inspectors. Invalid JSON or non-object text returns a warning diagnostic and keeps the last valid draft object unchanged; raw XState JSON is not exposed here.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-[11px]">
					<WorkflowPill label={`last valid rev ${draft.revision}`} />
					{isDirty ? <WorkflowPill label="unsaved raw text" /> : null}
				</div>
			</div>

			<div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
				<div className="flex flex-col gap-2">
					<label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500" htmlFor="workflow-raw-ir-editor">
						Editable Pibo Workflow IR JSON
					</label>
					<textarea
						id="workflow-raw-ir-editor"
						aria-label="Raw Pibo Workflow IR editor"
						className="min-h-[26rem] rounded-sm border border-slate-800 bg-[#101d22] p-3 font-mono text-[11px] leading-5 text-slate-100 outline-none transition focus:border-[#11a4d4]"
						spellCheck={false}
						value={rawText}
						onChange={(event) => {
							setRawText(event.target.value);
							setIsDirty(true);
							setSaveState("idle");
							setStatusMessage(undefined);
						}}
					/>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-600/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void saveRawIr()}
							disabled={saveState === "saving"}
						>
							{saveState === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
							Save raw IR
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
							onClick={resetRawIr}
							disabled={saveState === "saving"}
						>
							<RefreshCw size={13} />
							Reset from current draft
						</button>
					</div>
					{statusMessage ? (
						<div className={`rounded-sm border p-3 text-xs leading-5 ${saveState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : saveState === "warning" ? "border-amber-700/70 bg-amber-950/30 text-amber-100" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role={saveState === "error" || saveState === "warning" ? "alert" : "status"}>
							{statusMessage}
						</div>
					) : null}
					{rawParseDiagnostics.length ? <WorkflowInspectorDiagnostics diagnostics={rawParseDiagnostics} emptyLabel="No raw IR parse diagnostics." /> : null}
				</div>

				<div>
					<div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Last valid Pibo Workflow IR object</div>
					<pre aria-label="Pibo Workflow IR draft" className="max-h-[32rem] overflow-auto rounded-sm border border-slate-800 bg-[#101d22] p-3 text-[11px] leading-5 text-slate-200">
						{formattedDraftDefinition}
					</pre>
				</div>
			</div>
		</div>
	);
}

function WorkflowGraphCanvas({ draft, onDraftChange }: { draft: WorkflowDraftRecord; onDraftChange: (draft: WorkflowDraftRecord) => void }) {
	const projection = useMemo(() => createWorkflowGraphProjection(draft.definition, draft.diagnostics), [draft.definition, draft.diagnostics]);
	const [nodes, setNodes] = useState<WorkflowGraphFlowNode[]>(projection.nodes);
	const [edges, setEdges] = useState<WorkflowGraphFlowEdge[]>(projection.edges);
	const [selectedElement, setSelectedElement] = useState<SelectedGraphElement>();
	const [sourceNodeId, setSourceNodeId] = useState("");
	const [targetNodeId, setTargetNodeId] = useState("");
	const [layoutDirty, setLayoutDirty] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [statusMessage, setStatusMessage] = useState<string | undefined>();
	const [defaultAgentProfileId, setDefaultAgentProfileId] = useState("base");
	const [workflowVersionOptions, setWorkflowVersionOptions] = useState<WorkflowVersionPickerOption[]>([]);
	const [selectedWorkflowVersionKey, setSelectedWorkflowVersionKey] = useState("");
	const [adapterOptions, setAdapterOptions] = useState<WorkflowRegisteredRefOption[]>([]);
	const [selectedAdapterRef, setSelectedAdapterRef] = useState("");
	const [humanActionOptions, setHumanActionOptions] = useState<WorkflowRegisteredRefOption[]>([]);
	const [selectedHumanActionRef, setSelectedHumanActionRef] = useState("");

	useEffect(() => {
		let cancelled = false;
		getWorkflowProfilePicker()
			.then((picker) => {
				if (!cancelled && picker.options[0]?.id) setDefaultAgentProfileId(picker.options[0].id);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		getWorkflowVersionPicker()
			.then((picker) => {
				if (cancelled) return;
				setWorkflowVersionOptions(picker.options);
				setSelectedWorkflowVersionKey((current) => current || (picker.options[0] ? workflowVersionOptionKey(picker.options[0]) : ""));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		getWorkflowAdapterPicker()
			.then((picker) => {
				if (cancelled) return;
				setAdapterOptions(picker.options);
				setSelectedAdapterRef((current) => current || (picker.options[0]?.id ?? ""));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		getWorkflowHumanActionPicker()
			.then((picker) => {
				if (cancelled) return;
				setHumanActionOptions(picker.options);
				setSelectedHumanActionRef((current) => current || (picker.options[0]?.id ?? ""));
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setNodes(projection.nodes);
		setEdges(projection.edges);
		setLayoutDirty(false);
		setSelectedElement((current) => current && projectionHasElement(projection, current) ? current : undefined);
	}, [projection]);

	const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);

	useEffect(() => {
		setSourceNodeId((current) => current && nodeIds.includes(current) ? current : nodeIds[0] ?? "");
		setTargetNodeId((current) => {
			if (current && nodeIds.includes(current) && current !== sourceNodeId) return current;
			return nodeIds.find((nodeId) => nodeId !== (sourceNodeId || nodeIds[0])) ?? "";
		});
	}, [nodeIds, sourceNodeId]);

	const saveDefinition = useCallback(async (definition: WorkflowDraftDefinition, successMessage: string, options: { clearLayoutDirty?: boolean; editTrigger?: WorkflowValidationTrigger } = {}) => {
		setSaveState("saving");
		setStatusMessage(undefined);
		try {
			const response = await patchWorkflowDraft(draft.draftId, { definition, editTrigger: options.editTrigger ?? "graph_edit" });
			onDraftChange(response.draft);
			setSaveState("saved");
			setStatusMessage(successMessage);
			if (options.clearLayoutDirty) setLayoutDirty(false);
		} catch (error) {
			setSaveState("error");
			setStatusMessage(error instanceof Error ? error.message : "Failed to save graph edit");
		}
	}, [draft.draftId, onDraftChange]);

	const handleNodesChange = useCallback((changes: NodeChange<WorkflowGraphFlowNode>[]) => {
		setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
		if (changes.some((change) => change.type === "position")) setLayoutDirty(true);
	}, []);

	const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowGraphFlowEdge>[]) => {
		setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
	}, []);

	const addAgentNode = () => {
		const nodeId = nextWorkflowNodeId(draft.definition, "agent");
		const position = nextGraphNodePosition(nodes);
		const definition = addWorkflowGraphNode(draft.definition, nodeId, position, defaultAgentProfileId);
		setSelectedElement({ type: "node", id: nodeId });
		void saveDefinition(definition, `Added node ${nodeId}.`);
	};

	const selectedNestedWorkflowOption = useMemo(
		() => workflowVersionOptions.find((option) => workflowVersionOptionKey(option) === selectedWorkflowVersionKey),
		[workflowVersionOptions, selectedWorkflowVersionKey],
	);

	const addWorkflowNode = () => {
		if (!selectedNestedWorkflowOption) return;
		const nodeId = nextWorkflowNodeId(draft.definition, "workflow");
		const position = nextGraphNodePosition(nodes);
		const definition = addWorkflowGraphWorkflowNode(draft.definition, nodeId, position, selectedNestedWorkflowOption);
		setSelectedElement({ type: "node", id: nodeId });
		void saveDefinition(definition, `Added nested workflow node ${nodeId} for ${selectedNestedWorkflowOption.id}@${selectedNestedWorkflowOption.version}.`);
	};

	const addAdapterNode = () => {
		if (!selectedAdapterRef) return;
		const nodeId = nextWorkflowNodeId(draft.definition, "adapter");
		const position = nextGraphNodePosition(nodes);
		const definition = addWorkflowGraphAdapterNode(draft.definition, nodeId, position, selectedAdapterRef);
		setSelectedElement({ type: "node", id: nodeId });
		void saveDefinition(definition, `Added adapter node ${nodeId} for ${selectedAdapterRef}.`);
	};

	const addHumanNode = () => {
		if (!selectedHumanActionRef) return;
		const nodeId = nextWorkflowNodeId(draft.definition, "human");
		const position = nextGraphNodePosition(nodes);
		const actionOption = humanActionOptions.find((option) => option.id === selectedHumanActionRef);
		const definition = addWorkflowGraphHumanNode(draft.definition, nodeId, position, createHumanActionChoice(selectedHumanActionRef, actionOption?.kind));
		setSelectedElement({ type: "node", id: nodeId });
		void saveDefinition(definition, `Added human node ${nodeId} with action ${selectedHumanActionRef}.`);
	};

	const connectSelectedNodes = (sourceId = sourceNodeId, targetId = targetNodeId) => {
		if (!sourceId || !targetId || sourceId === targetId) return;
		const edgeId = nextWorkflowEdgeId(draft.definition, sourceId, targetId);
		const definition = addWorkflowGraphEdge(draft.definition, edgeId, sourceId, targetId);
		setEdges((currentEdges) => addReactFlowEdge({ id: edgeId, source: sourceId, target: targetId, type: "smoothstep" }, currentEdges));
		setSelectedElement({ type: "edge", id: edgeId });
		void saveDefinition(definition, `Connected ${sourceId} to ${targetId}.`);
	};

	const deleteSelectedElement = () => {
		if (!selectedElement) return;
		const definition = selectedElement.type === "node"
			? deleteWorkflowGraphNode(draft.definition, selectedElement.id)
			: deleteWorkflowGraphEdge(draft.definition, selectedElement.id);
		setSelectedElement(undefined);
		void saveDefinition(definition, `Deleted ${selectedElement.type} ${selectedElement.id}.`);
	};

	const nudgeSelectedNode = (dx: number, dy: number) => {
		if (selectedElement?.type !== "node") return;
		setNodes((currentNodes) => currentNodes.map((node) => node.id === selectedElement.id
			? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, selected: true }
			: node));
		setLayoutDirty(true);
		setStatusMessage(`Moved node ${selectedElement.id}; save layout to persist UI positions.`);
	};

	const saveLayout = () => {
		const definition = writeWorkflowGraphPositions(draft.definition, Object.fromEntries(nodes.map((node) => [node.id, node.position])));
		void saveDefinition(definition, "Layout saved to workflow.ui.positions without changing runtime semantics.", { clearLayoutDirty: true });
	};

	const handleConnect = useCallback((connection: Connection) => {
		if (!connection.source || !connection.target) return;
		connectSelectedNodes(connection.source, connection.target);
	}, [connectSelectedNodes]);

	const selectedDescription = describeSelectedGraphElement(draft.definition, selectedElement);
	const isSaving = saveState === "saving";
	const hasAtLeastTwoNodes = nodeIds.length > 1;

	return (
		<section className="grid gap-4 rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-labelledby="workflow-graph-canvas-title">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<MousePointer2 size={13} />
						Workflow graph canvas
					</div>
					<h4 id="workflow-graph-canvas-title" className="mt-1 text-sm font-bold text-slate-100">Visual graph editor</h4>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						React Flow projects Pibo Workflow IR nodes and edges. Graph edits save IR changes; layout saves only <code className="rounded bg-slate-900 px-1 text-slate-300">workflow.ui.positions</code> metadata.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${nodes.length} nodes`} />
					<WorkflowPill label={`${edges.length} edges`} />
					<WorkflowPill label={projection.usedAutoLayout ? `auto layout (${projection.missingPositionCount} missing)` : "manual positions"} />
				</div>
			</div>

			<div className="grid gap-3 text-xs xl:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="h-[420px] min-w-0 overflow-hidden rounded-sm border border-slate-800 bg-[#0c171c]" aria-label="Workflow graph canvas">
					<ReactFlow<WorkflowGraphFlowNode, WorkflowGraphFlowEdge>
						nodes={nodes}
						edges={edges}
						nodeTypes={WORKFLOW_GRAPH_NODE_TYPES}
						onNodesChange={handleNodesChange}
						onEdgesChange={handleEdgesChange}
						onConnect={handleConnect}
						onNodeClick={(_, node) => setSelectedElement({ type: "node", id: node.id })}
						onEdgeClick={(_, edge) => setSelectedElement({ type: "edge", id: edge.id })}
						onPaneClick={() => setSelectedElement(undefined)}
						fitView
						minZoom={0.35}
						maxZoom={1.6}
						colorMode="dark"
						defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" } }}
					>
						<Background color="#1f3a44" gap={18} />
						<MiniMap pannable zoomable nodeColor={(node) => node.selected ? "#38bdf8" : "#1e293b"} />
						<Controls showInteractive={false} />
					</ReactFlow>
				</div>

				<div className="grid content-start gap-3">
					<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Graph edit controls">
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={addAgentNode}
							disabled={isSaving}
						>
							<Plus size={13} />
							Add Agent node
						</button>
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Nested workflow version</span>
							<select
								aria-label="Nested workflow version"
								className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100"
								value={selectedWorkflowVersionKey}
								onChange={(event) => setSelectedWorkflowVersionKey(event.target.value)}
								disabled={isSaving || !workflowVersionOptions.length}
							>
								{workflowVersionOptions.length ? workflowVersionOptions.map((option) => (
									<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
								)) : <option value="">No published workflow versions</option>}
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={addWorkflowNode}
							disabled={isSaving || !selectedNestedWorkflowOption}
						>
							<Layers size={13} />
							Add Workflow node
						</button>
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Adapter ref</span>
							<select
								aria-label="Adapter node ref"
								className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100"
								value={selectedAdapterRef}
								onChange={(event) => setSelectedAdapterRef(event.target.value)}
								disabled={isSaving || !adapterOptions.length}
							>
								{adapterOptions.length ? adapterOptions.map((option) => (
									<option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>
								)) : <option value="">No registered adapters</option>}
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={addAdapterNode}
							disabled={isSaving || !selectedAdapterRef}
						>
							<Link2 size={13} />
							Add Adapter node
						</button>
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Human action ref</span>
							<select
								aria-label="Human node action ref"
								className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100"
								value={selectedHumanActionRef}
								onChange={(event) => setSelectedHumanActionRef(event.target.value)}
								disabled={isSaving || !humanActionOptions.length}
							>
								{humanActionOptions.length ? humanActionOptions.map((option) => (
									<option key={option.id} value={option.id}>{humanActionOptionLabel(option)}</option>
								)) : <option value="">No registered human actions</option>}
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={addHumanNode}
							disabled={isSaving || !selectedHumanActionRef}
						>
							<MousePointer2 size={13} />
							Add Human node
						</button>
						<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-500">
							Workflow nodes store only a workflow id/version reference. Adapter and human nodes store only registered deterministic adapter or human action refs. V2 does not inline-expand nested workflow internals or create inline transform code.
						</div>
						<div className="grid grid-cols-2 gap-2">
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>From</span>
								<select aria-label="Connect from node" className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)} disabled={isSaving || !hasAtLeastTwoNodes}>
									{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
								</select>
							</label>
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>To</span>
								<select aria-label="Connect to node" className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} disabled={isSaving || !hasAtLeastTwoNodes}>
									{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
								</select>
							</label>
						</div>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => connectSelectedNodes()}
							disabled={isSaving || !sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId}
						>
							<Link2 size={13} />
							Connect nodes
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => nudgeSelectedNode(40, 0)}
							disabled={isSaving || selectedElement?.type !== "node"}
						>
							<MoveRight size={13} />
							Nudge selected node
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-500/70 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={deleteSelectedElement}
							disabled={isSaving || !selectedElement}
						>
							<Trash2 size={13} />
							Delete selected
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-2 rounded-sm border border-emerald-700/70 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
							onClick={saveLayout}
							disabled={isSaving || !nodes.length || !layoutDirty}
						>
							{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
							Save layout
						</button>
					</div>

					<div className="rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Selected graph element">
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected graph element</div>
						<div className="mt-2 text-xs leading-5 text-slate-300">{selectedDescription}</div>
					</div>

					<WorkflowInspectorsPanel
						draft={draft}
						selectedElement={selectedElement}
						nodeIds={nodeIds}
						isSaving={isSaving}
						onSaveDefinition={saveDefinition}
					/>

					{statusMessage ? (
						<div className={`rounded-sm border p-3 text-xs leading-5 ${saveState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role="status">
							{statusMessage}
						</div>
					) : null}
				</div>
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3 text-[11px] leading-5 text-slate-500">
				Automatic layout is a canvas projection for workflows without saved positions. Saving layout writes only display metadata and does not change nodes, edges, ports, guards, adapters, runtime routing, or validation semantics.
			</div>
		</section>
	);
}

function WorkflowInspectorsPanel({
	draft,
	selectedElement,
	nodeIds,
	isSaving,
	onSaveDefinition,
}: {
	draft: WorkflowDraftRecord;
	selectedElement: SelectedGraphElement;
	nodeIds: string[];
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { clearLayoutDirty?: boolean; editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const selectedNode = selectedElement?.type === "node" ? readWorkflowNodeDefinitions(draft.definition)[selectedElement.id] : undefined;
	const selectedEdge = selectedElement?.type === "edge" ? readWorkflowEdgeDefinitions(draft.definition)[selectedElement.id] : undefined;

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow inspectors">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Workflow inspectors</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Inspector saves update the same Pibo Workflow IR draft as the graph canvas; XState remains projection-only.
				</p>
			</div>
			<WorkflowSettingsInspector draft={draft} isSaving={isSaving} onSaveDefinition={onSaveDefinition} />
			{selectedElement?.type === "node" && selectedNode ? (
				<WorkflowNodeInspector
					draft={draft}
					nodeId={selectedElement.id}
					node={selectedNode}
					isSaving={isSaving}
					onSaveDefinition={onSaveDefinition}
				/>
			) : selectedElement?.type === "edge" && selectedEdge ? (
				<WorkflowEdgeInspector
					draft={draft}
					edgeId={selectedElement.id}
					edge={selectedEdge}
					nodeIds={nodeIds}
					isSaving={isSaving}
					onSaveDefinition={onSaveDefinition}
				/>
			) : (
				<div className="rounded-sm border border-dashed border-slate-700 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
					Select a canvas node or edge to open the node or edge inspector. Workflow settings remain editable at all times.
				</div>
			)}
		</div>
	);
}

function WorkflowSettingsInspector({ draft, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowSettingsFormState>(() => createWorkflowSettingsFormState(draft.definition));

	useEffect(() => {
		setForm(createWorkflowSettingsFormState(draft.definition));
	}, [draft.definition]);

	const update = <K extends keyof WorkflowSettingsFormState>(key: K, value: WorkflowSettingsFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const updateGlobalStateField = <K extends keyof WorkflowGlobalStateFieldFormState>(index: number, key: K, value: WorkflowGlobalStateFieldFormState[K]) => {
		setForm((current) => ({
			...current,
			globalStateFields: current.globalStateFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field),
		}));
	};

	const addGlobalStateField = () => {
		setForm((current) => ({
			...current,
			globalStateFields: [...current.globalStateFields, createDefaultGlobalStateField(current.globalStateFields)],
		}));
	};

	const removeGlobalStateField = (index: number) => {
		setForm((current) => ({
			...current,
			globalStateFields: current.globalStateFields.filter((_, fieldIndex) => fieldIndex !== index),
		}));
	};

	const saveSettings = () => {
		const definition = applyWorkflowSettingsForm(draft.definition, form);
		const editTrigger: WorkflowValidationTrigger = workflowSettingsStateChanged(draft.definition, form) ? "state_edit" : "schema_edit";
		void onSaveDefinition(definition, "Saved workflow settings inspector edits to the draft IR.", { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Workflow settings inspector</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Workflow title</span>
					<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.title} onChange={(event) => update("title", event.target.value)} />
				</label>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Workflow description</span>
					<textarea className="min-h-20 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.description} onChange={(event) => update("description", event.target.value)} />
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowPortEditor label="Workflow input port" kind={form.inputKind} description={form.inputDescription} schemaText={form.inputSchemaText} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} onSchemaChange={(value) => update("inputSchemaText", value)} />
					<WorkflowPortEditor label="Workflow output port" kind={form.outputKind} description={form.outputDescription} schemaText={form.outputSchemaText} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} onSchemaChange={(value) => update("outputSchemaText", value)} />
				</div>
				<WorkflowGlobalStateFieldsEditor
					fields={form.globalStateFields}
					onAddField={addGlobalStateField}
					onRemoveField={removeGlobalStateField}
					onUpdateField={updateGlobalStateField}
				/>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowListTextEditor label="metadata.tags" value={form.metadataTags} onChange={(value) => update("metadataTags", value)} />
					<WorkflowListTextEditor label="metadata.useWhen" value={form.metadataUseWhen} onChange={(value) => update("metadataUseWhen", value)} />
					<WorkflowListTextEditor label="metadata.notFor" value={form.metadataNotFor} onChange={(value) => update("metadataNotFor", value)} />
					<WorkflowListTextEditor label="metadata.examples" value={form.metadataExamples} onChange={(value) => update("metadataExamples", value)} />
				</div>
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveSettings} disabled={isSaving}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save workflow settings
				</button>
			</div>
		</details>
	);
}

function WorkflowNodeInspector({ draft, nodeId, node, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	nodeId: string;
	node: WorkflowJsonObject;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowNodeInspectorFormState>(() => createWorkflowNodeInspectorFormState(node));
	const [profilePicker, setProfilePicker] = useState<WorkflowProfilePickerResponse | undefined>();
	const [handlerPicker, setHandlerPicker] = useState<WorkflowHandlerPickerResponse | undefined>();
	const [adapterPicker, setAdapterPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [workflowPicker, setWorkflowPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [humanActionPicker, setHumanActionPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const nodeKind = workflowNodeKind(node);
	const nodeDiagnostics = workflowDiagnosticsForNode(draft.diagnostics, nodeId);
	const selectedAdapterOption = adapterPicker?.options.find((option) => option.id === (adapterPicker?.selectedRefId ?? form.adapterRef));
	const selectedHumanActionIds = useMemo(() => new Set(form.humanActionRefs.map((action) => action.id)), [form.humanActionRefs]);

	useEffect(() => {
		setForm(createWorkflowNodeInspectorFormState(node));
	}, [node, nodeId]);

	useEffect(() => {
		if (nodeKind !== "agent") return;
		let cancelled = false;
		getWorkflowProfilePicker(form.profileId || undefined).then((picker) => {
			if (!cancelled) setProfilePicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.profileId]);

	useEffect(() => {
		if (nodeKind !== "code") return;
		let cancelled = false;
		getWorkflowHandlerPicker(form.handlerId || undefined).then((picker) => {
			if (!cancelled) setHandlerPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.handlerId]);

	useEffect(() => {
		if (nodeKind !== "adapter") return;
		let cancelled = false;
		getWorkflowAdapterPicker(form.adapterRef || undefined).then((picker) => {
			if (!cancelled) setAdapterPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.adapterRef]);

	useEffect(() => {
		if (nodeKind !== "workflow") return;
		let cancelled = false;
		const selection = parseWorkflowVersionKey(form.workflowVersionKey);
		getWorkflowVersionPicker({
			selectedWorkflowId: selection?.workflowId,
			selectedWorkflowVersion: selection?.workflowVersion,
		}).then((picker) => {
			if (!cancelled) setWorkflowPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.workflowVersionKey]);

	useEffect(() => {
		if (nodeKind !== "human") return;
		let cancelled = false;
		getWorkflowHumanActionPicker()
			.then((picker) => {
				if (!cancelled) setHumanActionPicker(picker);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind]);

	const update = <K extends keyof WorkflowNodeInspectorFormState>(key: K, value: WorkflowNodeInspectorFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const toggleHumanAction = (option: WorkflowRegisteredRefOption, checked: boolean) => {
		setForm((current) => ({
			...current,
			humanActionRefs: toggleHumanActionChoice(current.humanActionRefs, option, checked),
		}));
	};

	const saveNode = () => {
		const definition = applyWorkflowNodeInspectorForm(draft.definition, nodeId, form);
		const editTrigger: WorkflowValidationTrigger = workflowNodeStateAccessChanged(node, form)
			? "state_edit"
			: nodeKind === "agent" || nodeKind === "human" ? "prompt_edit" : "schema_edit";
		void onSaveDefinition(definition, `Saved node inspector edits for ${nodeId}.`, { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Node inspector: {nodeId}</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<div className="flex flex-wrap gap-2 text-[11px]"><WorkflowPill label={`${nodeKind} node`} /><WorkflowPill label={`${nodeDiagnostics.length} diagnostics`} /></div>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Node label</span>
					<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.label} onChange={(event) => update("label", event.target.value)} />
				</label>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Node description</span>
					<textarea className="min-h-16 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.description} onChange={(event) => update("description", event.target.value)} />
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowOptionalPortEditor label="Node input port" kind={form.inputKind} description={form.inputDescription} schemaText={form.inputSchemaText} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} onSchemaChange={(value) => update("inputSchemaText", value)} />
					<WorkflowOptionalPortEditor label="Node output port" kind={form.outputKind} description={form.outputDescription} schemaText={form.outputSchemaText} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} onSchemaChange={(value) => update("outputSchemaText", value)} />
				</div>
				<WorkflowStateAccessEditor label="Node" definition={draft.definition} value={form.stateAccess} onChange={(stateAccess) => update("stateAccess", stateAccess)} />
				{nodeKind === "agent" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Agent node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Agent profile ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={profilePicker?.selectedProfileId ?? form.profileId} onChange={(event) => update("profileId", event.target.value)}>
								<option value="">Select a non-archived profile</option>
								{profilePicker?.options.map((option) => <option key={option.id} value={option.id}>{profileOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={profilePicker?.diagnostics ?? []} />
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Prompt template</span>
							<textarea className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-slate-100" value={form.promptTemplate} onChange={(event) => update("promptTemplate", event.target.value)} />
							<span className="text-[11px] font-normal leading-5 text-slate-500">Saving direct prompt text writes <code className="rounded bg-slate-900 px-1 text-slate-300">promptTemplate</code> on this Pibo Workflow IR node.</span>
						</label>
						<WorkflowPromptAssetEditor draft={draft} nodeId={nodeId} node={node} isSaving={isSaving} onSaveDefinition={onSaveDefinition} />
					</div>
				) : null}
				{nodeKind === "code" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Code node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Registered code handler</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={handlerPicker?.selectedHandlerId ?? form.handlerId} onChange={(event) => update("handlerId", event.target.value)}>
								<option value="">Select a registered handler ref</option>
								{handlerPicker?.options.map((option) => <option key={option.id} value={option.id}>{handlerOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={handlerPicker?.diagnostics ?? []} />
					</div>
				) : null}
				{nodeKind === "adapter" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Adapter node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Registered adapter ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={adapterPicker?.selectedRefId ?? form.adapterRef} onChange={(event) => update("adapterRef", event.target.value)}>
								<option value="">Select a registered adapter ref</option>
								{adapterPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={adapterPicker?.diagnostics ?? []} />
						{selectedAdapterOption?.paramsSchema ? (
							<WorkflowParamsEditor
								label="Adapter params JSON"
								schema={selectedAdapterOption.paramsSchema}
								value={form.adapterParamsText}
								onChange={(value) => update("adapterParamsText", value)}
							/>
						) : null}
						<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-500">
							Adapter nodes store only a registered deterministic adapter ref. Inline transformation code and hidden LLM coercion are not exposed by the UI.
						</div>
					</div>
				) : null}
				{nodeKind === "workflow" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Nested workflow ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={workflowPicker?.selectedWorkflowId && workflowPicker.selectedWorkflowVersion ? workflowVersionSelectionKey(workflowPicker.selectedWorkflowId, workflowPicker.selectedWorkflowVersion) : form.workflowVersionKey} onChange={(event) => update("workflowVersionKey", event.target.value)}>
								<option value="">Select a published workflow version</option>
								{workflowPicker?.options.map((option) => <option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowVersionDiagnostics diagnostics={workflowPicker?.diagnostics ?? []} ariaLabel="Workflow node diagnostics" />
					</div>
				) : null}
				{nodeKind === "human" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Human node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Human prompt</span>
							<textarea className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={form.humanPrompt} onChange={(event) => update("humanPrompt", event.target.value)} />
						</label>
						<WorkflowSchemaTextEditor label="Human node resume payload schema JSON" value={form.humanSchemaText} onChange={(value) => update("humanSchemaText", value)} />
						<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" aria-label="Human action choices">
							<div>
								<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered action choices</div>
								<p className="mt-1 text-[11px] leading-5 text-slate-500">
									Actions are selected from the Workflow Registry. The label, action kind, and payload requirements come from picker metadata.
								</p>
							</div>
							{humanActionPicker?.options.length ? humanActionPicker.options.map((option) => (
								<label key={option.id} className="grid gap-1 rounded-sm border border-slate-800 bg-[#101d22] p-2 text-slate-300">
									<span className="inline-flex items-center gap-2 font-semibold">
										<input
											type="checkbox"
											className="h-3.5 w-3.5 accent-[#11a4d4]"
											checked={selectedHumanActionIds.has(option.id)}
											onChange={(event) => toggleHumanAction(option, event.target.checked)}
										/>
										<span>{option.displayName}</span>
										<WorkflowPill label={`kind: ${option.kind ?? "registered"}`} />
									</span>
									<span className="text-[11px] font-normal leading-5 text-slate-500">{option.description ?? option.id}</span>
									<span className="text-[11px] font-normal leading-5 text-slate-500">Payload requirements: {option.paramsSchema ? JSON.stringify(option.paramsSchema) : "none"}</span>
								</label>
							)) : (
								<div className="rounded-sm border border-dashed border-slate-700 p-2 text-[11px] leading-5 text-slate-500">No registered human actions are available from the picker.</div>
							)}
							<WorkflowInspectorPickerDiagnostics diagnostics={humanActionPicker?.diagnostics ?? []} />
							<div className="flex flex-wrap gap-2 text-[11px]" aria-label="Selected human action refs">
								{form.humanActionRefs.length ? form.humanActionRefs.map((action) => (
									<WorkflowPill key={`${action.id}:${action.kind ?? ""}`} label={`${action.id}${action.kind ? ` (${action.kind})` : ""}`} />
								)) : <span className="text-slate-500">No human action refs selected.</span>}
							</div>
						</div>
						<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 md:grid-cols-[1fr_1fr]" aria-label="Human node timeout">
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>Timeout kind</span>
								<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.humanTimeoutKind} onChange={(event) => update("humanTimeoutKind", event.target.value as WorkflowHumanTimeoutKind)}>
									<option value="none">No timeout</option>
									<option value="milliseconds">Milliseconds</option>
									<option value="seconds">Seconds</option>
									<option value="minutes">Minutes</option>
									<option value="iso8601">ISO-8601 duration</option>
								</select>
							</label>
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>Timeout value</span>
								<input
									className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
									type={form.humanTimeoutKind === "iso8601" ? "text" : "number"}
									min={form.humanTimeoutKind === "iso8601" ? undefined : 1}
									placeholder={form.humanTimeoutKind === "iso8601" ? "PT1H" : "60"}
									value={form.humanTimeoutValue}
									onChange={(event) => update("humanTimeoutValue", event.target.value)}
									disabled={form.humanTimeoutKind === "none"}
								/>
							</label>
						</div>
					</div>
				) : null}
				<WorkflowInspectorDiagnostics diagnostics={nodeDiagnostics} emptyLabel="No diagnostics for selected node." />
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveNode} disabled={isSaving}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save node inspector
				</button>
			</div>
		</details>
	);
}

function WorkflowPromptAssetEditor({ draft, nodeId, node, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	nodeId: string;
	node: WorkflowJsonObject;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [selectedRef, setSelectedRef] = useState(readPromptAssetRefId(node.promptBuilder));
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [asset, setAsset] = useState<WorkflowPromptAssetDocument | undefined>();
	const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [message, setMessage] = useState<string | undefined>();

	useEffect(() => {
		setSelectedRef(readPromptAssetRefId(node.promptBuilder));
	}, [node, nodeId]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowPromptAssetPicker(selectedRef || undefined).then((response) => {
			if (!cancelled) setPicker(response);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selectedRef]);

	useEffect(() => {
		let cancelled = false;
		setMessage(undefined);
		if (!selectedRef) {
			setAsset(undefined);
			setLoadState("idle");
			return () => {
				cancelled = true;
			};
		}
		setLoadState("loading");
		getWorkflowPromptAsset(selectedRef)
			.then((response) => {
				if (cancelled) return;
				setAsset(response.asset);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setAsset(undefined);
				setLoadState("error");
				setMessage(error instanceof Error ? error.message : "Failed to load prompt asset");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedRef]);

	const selectedOption = picker?.options.find((option) => option.id === selectedRef);
	const directPromptTemplate = typeof node.promptTemplate === "string" ? node.promptTemplate : DEFAULT_AGENT_PROMPT_TEMPLATE;
	const initialMarkdown = asset?.markdown ?? directPromptTemplate;
	const editorDocumentKey = `${draft.draftId}:${nodeId}:${(asset?.id ?? selectedRef) || "direct-prompt"}:${asset?.revisionId ?? "draft"}`;
	const hasPromptBuilder = Boolean(readPromptAssetRefId(node.promptBuilder));
	const selectedRefIsManaged = selectedRef.startsWith("ui.promptAssets.");
	const promptAssetDisplayName = `${typeof node.label === "string" && node.label.trim() ? node.label.trim() : nodeId} prompt asset`;

	const persistPromptAsset = useCallback(async (markdown: string) => {
		try {
			const response = await postWorkflowPromptAssetRevision({
				assetId: selectedRefIsManaged ? selectedRef : undefined,
				sourceRefId: selectedRef || undefined,
				displayName: promptAssetDisplayName,
				description: `Managed prompt asset for ${nodeId} in draft ${draft.draftId}.`,
				markdown,
			});
			const definition = applyWorkflowPromptAssetDocumentToNode(draft.definition, nodeId, response.asset);
			await onSaveDefinition(definition, `Saved prompt asset revision ${response.asset.revisionId} and updated ${nodeId}.`, { editTrigger: "prompt_edit" });
			setSelectedRef(response.asset.id);
			setAsset(response.asset);
			setMessage(`Saved ${response.asset.displayName} as revision ${response.asset.revisionId}; draft now pins ${response.asset.contentHash}.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Failed to save prompt asset revision");
			throw error;
		}
	}, [draft.definition, draft.draftId, nodeId, onSaveDefinition, promptAssetDisplayName, selectedRef, selectedRefIsManaged]);

	const useSelectedPromptAsset = async () => {
		if (!asset) return;
		const definition = applyWorkflowPromptAssetDocumentToNode(draft.definition, nodeId, asset);
		await onSaveDefinition(definition, `Updated ${nodeId} to use prompt asset ${asset.id}.`, { editTrigger: "prompt_edit" });
		setMessage(`Draft node ${nodeId} now uses ${asset.displayName} at ${asset.contentHash}.`);
	};

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" aria-label="Prompt asset Markdown editor">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Prompt asset Markdown editor</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Edit prompt assets with the same Markdown editor pattern as Context Files. Saving creates a managed UI asset revision, updates this draft node to a prompt asset ref, and pins the revision id plus content hash in the Pibo Workflow IR.
				</p>
			</div>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Prompt asset ref</span>
				<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={selectedRef} onChange={(event) => setSelectedRef(event.target.value)} disabled={isSaving}>
					<option value="">Create managed asset from direct prompt template</option>
					{picker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
				</select>
			</label>
			<WorkflowInspectorPickerDiagnostics diagnostics={picker?.diagnostics ?? []} />
			{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge={selectedOption.kind === "ui" ? "managed prompt asset" : "registered prompt asset"} /> : null}
			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-2 text-[11px] leading-5 text-red-200" role="alert">{message ?? "Failed to load prompt asset."}</div>
			) : null}
			<div className="rounded-sm border border-slate-800 bg-[#101d22] p-2">
				<MarkdownEditor
					documentKey={editorDocumentKey}
					initialMarkdown={initialMarkdown}
					onPersist={persistPromptAsset}
					onSaveStateChange={setSaveState}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-[11px]">
				<WorkflowPill label={hasPromptBuilder ? "promptBuilder ref" : "direct promptTemplate source"} />
				<WorkflowPill label={`Markdown save: ${saveState}`} />
				{asset ? <WorkflowPill label={`${asset.source} · ${asset.revisionId}`} /> : null}
			</div>
			<div className="flex flex-wrap gap-2">
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void useSelectedPromptAsset()} disabled={isSaving || !asset}>
					<Save size={13} />
					Use selected asset on draft
				</button>
			</div>
			{message && loadState !== "error" ? <div className="rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-2 text-[11px] leading-5 text-emerald-200" role="status">{message}</div> : null}
			<div className="text-[11px] leading-5 text-slate-500">
				Code/plugin prompt assets are not mutated. Editing a registered asset copies the Markdown into a managed UI prompt asset; later saves append revisions and only affect this draft or future workflow versions that reference the new revision.
			</div>
		</div>
	);
}

function WorkflowStateAccessEditor({ label, definition, value, onChange, allowEdgeWrites = false }: {
	label: string;
	definition: WorkflowDraftDefinition;
	value: WorkflowStateAccessFormState;
	onChange: (value: WorkflowStateAccessFormState) => void;
	allowEdgeWrites?: boolean;
}) {
	const readPathOptions = workflowStatePathOptions(definition, value.readScope, [...value.reads, ...value.writes]);
	const writeScopes = allowEdgeWrites ? WORKFLOW_STATE_SCOPES : DEFAULT_WRITE_STATE_SCOPES;
	const writePathOptions = workflowStatePathOptions(definition, value.writeScope, [...value.reads, ...value.writes]);
	const canAddRead = Boolean(value.readPath.trim());
	const canAddWrite = Boolean(value.writePath.trim()) && (allowEdgeWrites || value.writeScope !== "edge");
	const update = <K extends keyof WorkflowStateAccessFormState>(key: K, nextValue: WorkflowStateAccessFormState[K]) => onChange({ ...value, [key]: nextValue });
	const addEntry = (direction: "reads" | "writes") => {
		const scope = direction === "reads" ? value.readScope : value.writeScope;
		const path = (direction === "reads" ? value.readPath : value.writePath).trim();
		if (!path) return;
		const entry = `${scope}.${path}`;
		const entries = value[direction];
		if (entries.includes(entry)) return;
		onChange({ ...value, [direction]: [...entries, entry] });
	};
	const removeEntry = (direction: "reads" | "writes", entry: string) => onChange({
		...value,
		[direction]: value[direction].filter((candidate) => candidate !== entry),
	});

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22]/70 p-3" aria-label={`${label} simple state mapping controls`}>
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label} simple state mappings</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Add simple scoped state reads and writes as Pibo Workflow IR <code className="rounded bg-slate-900 px-1 text-slate-300">state.reads</code> and <code className="rounded bg-slate-900 px-1 text-slate-300">state.writes</code> arrays. Complex state mapping DSLs remain raw Workflow IR only.
				</p>
			</div>
			<div className="grid gap-2 md:grid-cols-[0.7fr_1fr_auto]">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Read scope</span>
					<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value.readScope} onChange={(event) => update("readScope", event.target.value as WorkflowStateScope)}>
						{WORKFLOW_STATE_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
					</select>
				</label>
				<WorkflowStatePathSelect label="Read path" value={value.readPath} options={readPathOptions} onChange={(path) => update("readPath", path)} />
				<button type="button" className="self-end rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => addEntry("reads")} disabled={!canAddRead}>Add read</button>
			</div>
			<WorkflowStateEntryList label="Reads" entries={value.reads} onRemove={(entry) => removeEntry("reads", entry)} />
			<div className="grid gap-2 md:grid-cols-[0.7fr_1fr_auto]">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Write scope</span>
					<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value.writeScope} onChange={(event) => update("writeScope", event.target.value as WorkflowStateScope)}>
						{writeScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
					</select>
				</label>
				<WorkflowStatePathSelect label="Write path" value={value.writePath} options={writePathOptions} onChange={(path) => update("writePath", path)} />
				<button type="button" className="self-end rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => addEntry("writes")} disabled={!canAddWrite}>Add write</button>
			</div>
			<WorkflowStateEntryList label="Writes" entries={value.writes} onRemove={(entry) => removeEntry("writes", entry)} />
			{value.writeScope === "global" && !readWorkflowGlobalStatePaths(definition).length ? (
				<div className="rounded-sm border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] leading-5 text-amber-100">Declare global state fields in the workflow settings inspector before selecting global read/write paths.</div>
			) : null}
		</div>
	);
}

function WorkflowStatePathSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
	const normalizedOptions = value && !options.includes(value) ? [value, ...options] : options;
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value} onChange={(event) => onChange(event.target.value)}>
				<option value="">Select path</option>
				{normalizedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
			</select>
		</label>
	);
}

function WorkflowStateEntryList({ label, entries, onRemove }: { label: string; entries: string[]; onRemove: (entry: string) => void }) {
	return (
		<div className="grid gap-1">
			<div className="text-[11px] font-semibold text-slate-400">{label}</div>
			{entries.length ? (
				<div className="flex flex-wrap gap-2">
					{entries.map((entry) => (
						<button key={entry} type="button" className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-red-500/60 hover:text-red-100" onClick={() => onRemove(entry)} title={`Remove ${entry}`}>
							{entry} ×
						</button>
					))}
				</div>
			) : <div className="text-[11px] text-slate-500">No {label.toLowerCase()} declared.</div>}
		</div>
	);
}

function WorkflowEdgeInspector({ draft, edgeId, edge, nodeIds, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	edgeId: string;
	edge: WorkflowJsonObject;
	nodeIds: string[];
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowEdgeInspectorFormState>(() => createWorkflowEdgeInspectorFormState(edge, nodeIds));
	const [guardPicker, setGuardPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [adapterPicker, setAdapterPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [adapterDialogOpen, setAdapterDialogOpen] = useState(false);
	const edgeDiagnostics = workflowDiagnosticsForEdge(draft.diagnostics, edgeId);
	const edgePortDetails = createWorkflowEdgePortDetails(draft.definition, edge);
	const hasIncompatibleEdgeDiagnostic = edgeDiagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.incompatibleEdgePorts");
	const selectedGuardOption = guardPicker?.options.find((option) => option.id === (guardPicker?.selectedRefId ?? form.guardHandler));
	const selectedAdapterOption = adapterPicker?.options.find((option) => option.id === (adapterPicker?.selectedRefId ?? form.adapterRef));

	useEffect(() => {
		setForm(createWorkflowEdgeInspectorFormState(edge, nodeIds));
	}, [edge, edgeId, nodeIds]);

	useEffect(() => {
		setAdapterDialogOpen(false);
	}, [edgeId]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowGuardPicker(form.guardHandler || undefined).then((picker) => {
			if (!cancelled) setGuardPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [form.guardHandler]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowAdapterPicker(form.adapterRef || undefined).then((picker) => {
			if (!cancelled) setAdapterPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [form.adapterRef]);

	const update = <K extends keyof WorkflowEdgeInspectorFormState>(key: K, value: WorkflowEdgeInspectorFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const saveEdge = () => {
		const definition = applyWorkflowEdgeInspectorForm(draft.definition, edgeId, form);
		const editTrigger: WorkflowValidationTrigger = workflowStateAccessChanged(edge.state, form.stateAccess) ? "state_edit" : "edge_edit";
		void onSaveDefinition(definition, `Saved edge inspector edits for ${edgeId}.`, { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Edge inspector: {edgeId}</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<div className="flex flex-wrap gap-2 text-[11px]"><WorkflowPill label={`${form.kind} edge`} /><WorkflowPill label={`${edgeDiagnostics.length} diagnostics`} /></div>
				<div className="grid gap-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Source node</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.sourceNodeId} onChange={(event) => update("sourceNodeId", event.target.value)}>
							<option value="">Select source</option>
							{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Target node</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.targetNodeId} onChange={(event) => update("targetNodeId", event.target.value)}>
							<option value="">Select target</option>
							{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Source port id</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.sourcePortId} onChange={(event) => update("sourcePortId", event.target.value)} placeholder="default" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Target port id</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.targetPortId} onChange={(event) => update("targetPortId", event.target.value)} placeholder="default" />
					</label>
				</div>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Edge kind</span>
					<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.kind} onChange={(event) => update("kind", event.target.value as WorkflowEdgeInspectorFormState["kind"])}>
						<option value="data">data</option>
						<option value="control">control</option>
						<option value="error">error</option>
						<option value="resume">resume</option>
					</select>
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Guard ref</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={guardPicker?.selectedRefId ?? form.guardHandler} onChange={(event) => update("guardHandler", event.target.value)}>
							<option value="">No guard</option>
							{guardPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Guard priority</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.guardPriority} onChange={(event) => update("guardPriority", event.target.value)} placeholder="optional integer" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300 md:col-span-2">
						<span>Edge adapter ref</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={adapterPicker?.selectedRefId ?? form.adapterRef} onChange={(event) => update("adapterRef", event.target.value)}>
							<option value="">No edge adapter</option>
							{adapterPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>
				</div>
				{selectedGuardOption?.paramsSchema ? (
					<WorkflowParamsEditor label="Guard params JSON" schema={selectedGuardOption.paramsSchema} value={form.guardParamsText} onChange={(value) => update("guardParamsText", value)} />
				) : null}
				{selectedAdapterOption?.paramsSchema ? (
					<WorkflowParamsEditor label="Edge adapter params JSON" schema={selectedAdapterOption.paramsSchema} value={form.adapterParamsText} onChange={(value) => update("adapterParamsText", value)} />
				) : null}
				<WorkflowStateAccessEditor label="Edge" definition={draft.definition} value={form.stateAccess} onChange={(stateAccess) => update("stateAccess", stateAccess)} allowEdgeWrites />
				<button
					type="button"
					className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${hasIncompatibleEdgeDiagnostic ? "border-amber-600/70 text-amber-100 hover:border-amber-400" : "border-slate-700 text-slate-300 hover:border-[#11a4d4]/60 hover:text-slate-100"}`}
					onClick={() => setAdapterDialogOpen(true)}
					disabled={isSaving || !edgePortDetails.sourcePort || !edgePortDetails.targetPort}
				>
					<Link2 size={13} />
					{hasIncompatibleEdgeDiagnostic ? "Fix incompatible edge with adapter" : "Open compatible edge adapter dialog"}
				</button>
				{adapterDialogOpen ? (
					<WorkflowEdgeAdapterDialog
						draft={draft}
						edgeId={edgeId}
						edge={edge}
						edgePortDetails={edgePortDetails}
						isSaving={isSaving}
						onClose={() => setAdapterDialogOpen(false)}
						onSaveDefinition={onSaveDefinition}
					/>
				) : null}
				<WorkflowInspectorPickerDiagnostics diagnostics={[...(guardPicker?.diagnostics ?? []), ...(adapterPicker?.diagnostics ?? [])]} />
				<WorkflowInspectorDiagnostics diagnostics={edgeDiagnostics} emptyLabel="No diagnostics for selected edge." />
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveEdge} disabled={isSaving || !form.sourceNodeId || !form.targetNodeId}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save edge inspector
				</button>
			</div>
		</details>
	);
}

function WorkflowEdgeAdapterDialog({ draft, edgeId, edge, edgePortDetails, isSaving, onClose, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	edgeId: string;
	edge: WorkflowJsonObject;
	edgePortDetails: WorkflowEdgePortDetails;
	isSaving: boolean;
	onClose: () => void;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [selectedAdapterRef, setSelectedAdapterRef] = useState(readWorkflowEdgeAdapterRef(edge));
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowAdapterPicker(selectedAdapterRef || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setSelectedAdapterRef((current) => current || (response.options[0]?.id ?? ""));
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load compatible adapters");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdapterRef]);

	const selectedOption = picker?.options.find((option) => option.id === selectedAdapterRef);
	const canApply = Boolean(selectedOption && edgePortDetails.sourcePort && edgePortDetails.targetPort && loadState === "loaded" && !isSaving);

	const useAsEdgeAdapter = async () => {
		if (!selectedAdapterRef) return;
		await onSaveDefinition(
			applyWorkflowEdgeAdapterChoice(draft.definition, edgeId, selectedAdapterRef),
			`Applied ${selectedAdapterRef} as edge adapter for ${edgeId}.`,
			{ editTrigger: "edge_edit" },
		);
		onClose();
	};

	const insertAdapterNode = async () => {
		if (!selectedAdapterRef) return;
		const definition = insertWorkflowAdapterNodeForEdge(draft.definition, edgeId, selectedAdapterRef);
		await onSaveDefinition(definition, `Inserted adapter node for ${edgeId} using ${selectedAdapterRef}.`, { editTrigger: "graph_edit" });
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="workflow-edge-adapter-dialog-title">
			<div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-sm border border-slate-700 bg-[#101d22] p-4 shadow-2xl shadow-black/40">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Link2 size={13} />Compatible edge adapter dialog</div>
						<h4 id="workflow-edge-adapter-dialog-title" className="mt-1 text-sm font-bold text-slate-100">Choose a registered adapter for {edgeId}</h4>
						<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
							The dialog shows the source output and target input schemas from the Pibo Workflow IR. Use a registered adapter as an explicit edge adapter, or insert a visible adapter node between the endpoints.
						</p>
					</div>
					<button type="button" className="rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" onClick={onClose}>Close</button>
				</div>

				<div className="mt-4 grid gap-3 md:grid-cols-2">
					<HandlerSchemaPreview label={`From schema${edgePortDetails.sourceNodeId ? ` (${edgePortDetails.sourceNodeId})` : ""}`} schema={edgePortDetails.sourcePort ?? null} />
					<HandlerSchemaPreview label={`To schema${edgePortDetails.targetNodeId ? ` (${edgePortDetails.targetNodeId})` : ""}`} schema={edgePortDetails.targetPort ?? null} />
				</div>

				<div className={`mt-3 rounded-sm border p-3 text-xs leading-5 ${edgePortDetails.directlyCompatible ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-200" : "border-amber-700/70 bg-amber-950/30 text-amber-100"}`}>
					{edgePortDetails.directlyCompatible
						? "These ports are directly compatible. An adapter is optional and remains explicit if selected."
						: "These ports are not directly compatible. Select a registered adapter instead of hidden LLM coercion or inline transformation code."}
				</div>

				<div className="mt-4 grid gap-3 text-xs">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Compatible registered adapter</span>
						<select
							aria-label="Compatible registered adapter"
							className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100"
							value={selectedAdapterRef}
							onChange={(event) => setSelectedAdapterRef(event.target.value)}
							disabled={loadState === "loading" || loadState === "error" || isSaving}
						>
							<option value="">Select a registered adapter ref</option>
							{picker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>

					{loadState === "error" ? <div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">{errorMessage ?? "Failed to load compatible adapters."}</div> : null}
					<WorkflowInspectorPickerDiagnostics diagnostics={picker?.diagnostics ?? []} />
					{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge="selected adapter" /> : null}
					<div className="grid gap-2" aria-label="Compatible adapter candidates">
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Compatible adapter candidates</div>
						{picker?.options.map((option) => <RegisteredRefOptionCard key={option.id} option={option} badge="compatible adapter" />)}
					</div>

					<div className="grid gap-2 md:grid-cols-2">
						<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void useAsEdgeAdapter()} disabled={!canApply}>
							<Link2 size={13} />
							Use as edge adapter
						</button>
						<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void insertAdapterNode()} disabled={!canApply}>
							<Plus size={13} />
							Insert adapter node
						</button>
					</div>

					<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
						Both actions persist Pibo Workflow IR only. Edge adapters store <code className="rounded bg-slate-900 px-1 text-slate-300">adapter.transform.id</code>; inserted adapter nodes store a visible deterministic adapter handler ref.
					</div>
				</div>
			</div>
		</div>
	);
}

function WorkflowPortEditor({ label, kind, description, schemaText, onKindChange, onDescriptionChange, onSchemaChange }: {
	label: string;
	kind: WorkflowPortKindSelection;
	description: string;
	schemaText: string;
	onKindChange: (kind: WorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
	onSchemaChange: (schemaText: string) => void;
}) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>{label}</span>
				<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={kind} onChange={(event) => onKindChange(event.target.value as WorkflowPortKindSelection)}>
					<option value="text">text</option>
					<option value="json">json</option>
				</select>
			</label>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Description</span>
				<input className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional port description" />
			</label>
			{kind === "json" ? <WorkflowSchemaTextEditor label={`${label} raw JSON schema`} value={schemaText} onChange={onSchemaChange} /> : null}
		</div>
	);
}

function WorkflowOptionalPortEditor({ label, kind, description, schemaText, onKindChange, onDescriptionChange, onSchemaChange }: {
	label: string;
	kind: OptionalWorkflowPortKindSelection;
	description: string;
	schemaText: string;
	onKindChange: (kind: OptionalWorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
	onSchemaChange: (schemaText: string) => void;
}) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>{label}</span>
				<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={kind} onChange={(event) => onKindChange(event.target.value as OptionalWorkflowPortKindSelection)}>
					<option value="none">inherit/default</option>
					<option value="text">text</option>
					<option value="json">json</option>
				</select>
			</label>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Description</span>
				<input className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={description} onChange={(event) => onDescriptionChange(event.target.value)} disabled={kind === "none"} placeholder="Optional port description" />
			</label>
			{kind === "json" ? <WorkflowSchemaTextEditor label={`${label} raw JSON schema`} value={schemaText} onChange={onSchemaChange} /> : null}
		</div>
	);
}

function WorkflowGlobalStateFieldsEditor({ fields, onAddField, onRemoveField, onUpdateField }: {
	fields: WorkflowGlobalStateFieldFormState[];
	onAddField: () => void;
	onRemoveField: (index: number) => void;
	onUpdateField: <K extends keyof WorkflowGlobalStateFieldFormState>(index: number, key: K, value: WorkflowGlobalStateFieldFormState[K]) => void;
}) {
	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow global state fields">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Workflow global state fields</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Declare simple global state paths for node and edge state mapping dropdowns. State schema changes run draft validation and may invalidate connected graph diagnostics without blocking draft save.
				</p>
			</div>
			{fields.length ? fields.map((field, index) => (
				<div key={`${index}:${field.path}`} className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Global state path</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.path} onChange={(event) => onUpdateField(index, "path", event.target.value)} placeholder="projectGoal" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Merge policy</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.mergeKind} onChange={(event) => onUpdateField(index, "mergeKind", event.target.value as WorkflowGlobalStateMergeKind)}>
							<option value="none">No merge policy</option>
							<option value="replace">replace</option>
							<option value="append">append</option>
							<option value="shallowMerge">shallowMerge</option>
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300 md:col-span-2">
						<span>Description</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.description} onChange={(event) => onUpdateField(index, "description", event.target.value)} placeholder="Optional state description" />
					</label>
					<div className="md:col-span-2">
						<WorkflowSchemaTextEditor label={`Global state ${field.path || index + 1} schema JSON`} value={field.schemaText} onChange={(value) => onUpdateField(index, "schemaText", value)} />
					</div>
					<button type="button" className="rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-500/70 hover:text-red-100" onClick={() => onRemoveField(index)}>Remove state field</button>
				</div>
			)) : <div className="rounded-sm border border-dashed border-slate-700 p-2 text-[11px] leading-5 text-slate-500">No global state fields declared. Local and edge path dropdowns remain available for simple node-local state and edge payload access.</div>}
			<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" onClick={onAddField}>
				<Plus size={13} />
				Add global state field
			</button>
		</div>
	);
}

function WorkflowSchemaTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<textarea
				className="min-h-36 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-100"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2)}
				spellCheck={false}
				aria-label={label}
			/>
			<span className="text-[11px] font-normal leading-5 text-slate-500">Raw JSON Schema subset only. Unsupported keywords return workflow diagnostics; no Zod, AJV, or form-builder schema layer is introduced.</span>
		</label>
	);
}

function WorkflowListTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<textarea className="min-h-16 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={value} onChange={(event) => onChange(event.target.value)} placeholder="One value per line" />
		</label>
	);
}

function WorkflowParamsEditor({ label, schema, value, onChange }: { label: string; schema: Record<string, unknown>; value: string; onChange: (value: string) => void }) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2" aria-label={label}>
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<HandlerSchemaPreview label="paramsSchema" schema={schema} />
			<textarea
				className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-100"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder="{}"
				aria-label={`${label} value`}
			/>
			<div className="text-[11px] leading-5 text-slate-500">Params save as data on the selected registry ref. No inline code path is created.</div>
		</div>
	);
}

function WorkflowValidationPanel({ draft }: { draft: WorkflowDraftRecord }) {
	const validation = draft.validation;
	const errorCount = validation?.errorCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = validation?.warningCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const infoCount = validation?.infoCount ?? draft.diagnostics.filter((diagnostic) => diagnostic.severity === "info").length;
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Workflow validation panel">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Validation panel</div>
					<h4 className="mt-1 text-sm font-bold text-slate-100">Structured draft diagnostics</h4>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
						Draft validation reports sanitized diagnostic fields from the Workflow IR pipeline. Publish remains gated by blocking error diagnostics and the backend before-publish route.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-[11px]">
					<WorkflowPill label={`${errorCount} errors`} />
					<WorkflowPill label={`${warningCount} warnings`} />
					<WorkflowPill label={`${infoCount} info`} />
				</div>
			</div>
			<div className="mt-3 grid gap-3 text-xs md:grid-cols-3" aria-label="Workflow validation summary">
				<WorkflowFact label="Validation state" value={draft.validationState} />
				<WorkflowFact label="Last trigger" value={validation?.trigger ?? "not checked"} />
				<WorkflowFact label="Checked at" value={validation?.checkedAt ?? "not checked"} />
				<WorkflowFact label="Publish gate" value={validation?.blocksPublish ? "blocked" : "not blocked"} />
				<WorkflowFact label="Run gate" value={validation?.blocksRun ? "blocked" : "not blocked"} />
				<WorkflowFact label="Diagnostic count" value={String(draft.diagnostics.length)} />
			</div>
			{draft.diagnostics.length ? <WorkflowDraftDiagnostics draft={draft} /> : (
				<div className="mt-3 rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-200">No validation diagnostics returned by the draft pipeline.</div>
			)}
		</div>
	);
}

function WorkflowInspectorDiagnostics({ diagnostics, emptyLabel }: { diagnostics: WorkflowDraftDiagnostic[]; emptyLabel: string }) {
	if (!diagnostics.length) {
		return <div className="rounded-sm border border-slate-800 bg-[#101d22] p-2 text-[11px] text-slate-500">{emptyLabel}</div>;
	}
	return (
		<div className="grid gap-2" aria-label="Inspector diagnostics">
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? diagnostic.registryRef ?? diagnostic.message}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-2 text-[11px] leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={12} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					{diagnostic.path ? <div className="mt-1 font-mono text-amber-200/80">{diagnostic.path}</div> : null}
					{diagnostic.hint ? <div className="mt-1 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
	);
}

function WorkflowInspectorPickerDiagnostics({ diagnostics }: { diagnostics: WorkflowPickerDiagnostic[] }) {
	if (!diagnostics.length) return null;
	return (
		<div className="grid gap-2" aria-label="Inspector picker diagnostics">
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-2 text-[11px] leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={12} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-1 font-mono text-amber-200/80">{diagnostic.path}</div>
					<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
				</div>
			))}
		</div>
	);
}

function WorkflowDraftDiagnostics({ draft }: { draft: WorkflowDraftRecord }) {
	return (
		<div className="mt-3 grid gap-2" aria-label="Workflow structured diagnostics">
			{draft.diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? diagnostic.registryRef ?? "workflow"}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
						<WorkflowDiagnosticMeta label="Severity" value={diagnostic.severity} />
						<WorkflowDiagnosticMeta label="Path" value={diagnostic.path} />
						<WorkflowDiagnosticMeta label="Node" value={diagnostic.nodeId} />
						<WorkflowDiagnosticMeta label="Edge" value={diagnostic.edgeId} />
						<WorkflowDiagnosticMeta label="Registry ref" value={diagnostic.registryRef} />
					</div>
					{diagnostic.hint ? <div className="mt-2 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
	);
}

function WorkflowDiagnosticMeta({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<span className="rounded-sm border border-amber-700/50 bg-amber-950/40 px-2 py-0.5">
			<span className="font-semibold text-amber-200/80">{label}:</span> <code>{value}</code>
		</span>
	);
}

function WorkflowBuilderAgentNodeEditor() {
	const [selectedProfileId, setSelectedProfileId] = useState(readInitialProfileRef);
	const [promptTemplate, setPromptTemplate] = useState(DEFAULT_AGENT_PROMPT_TEMPLATE);
	const [picker, setPicker] = useState<WorkflowProfilePickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowProfilePicker(selectedProfileId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedProfileId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedProfileId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Brain size={13} />
						Agent node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a non-archived Agent Designer profile and edit the direct prompt template stored on the Pibo Workflow IR node.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshProfilePicker(selectedProfileId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Agent Designer profile</span>
				<select
					aria-label="Agent Designer profile"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedProfileId ?? ""}
					onChange={(event) => setSelectedProfileId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a non-archived profile</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{profileOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow profile picker."}
				</div>
			) : null}

			{selectedOption ? <ProfileSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Agent profile diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Prompt template</span>
				<textarea
					aria-label="Agent prompt template"
					className="min-h-28 resize-y rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-[#11a4d4]"
					value={promptTemplate}
					onChange={(event) => setPromptTemplate(event.target.value)}
				/>
				<span className="text-[11px] font-normal leading-5 text-slate-500">
					This editor is enabled for Agent nodes with a direct <code className="rounded bg-slate-900 px-1 text-slate-300">promptTemplate</code>. Nodes backed by registered prompt builders remain registry-controlled.
				</span>
			</label>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Archived profiles are intentionally omitted from the picker. If a loaded draft already references one, the API returns a structured diagnostic and keeps the selection empty.
			</div>
		</div>
	);
}

function WorkflowBuilderCodeNodeEditor() {
	const [selectedHandlerId, setSelectedHandlerId] = useState(readInitialHandlerRef);
	const [picker, setPicker] = useState<WorkflowHandlerPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowHandlerPicker(selectedHandlerId || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedHandlerId]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedHandlerId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Code2 size={13} />
						Code node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered Workflow Registry handler ref. The UI stores only the handler id on the Pibo Workflow IR node and never opens inline TypeScript, JavaScript, shell, or eval code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshHandlerPicker(selectedHandlerId, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered code handler</span>
				<select
					aria-label="Registered code handler"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedHandlerId ?? ""}
					onChange={(event) => setSelectedHandlerId(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered handler ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{handlerOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow handler picker."}
				</div>
			) : null}

			{selectedOption ? <HandlerSelectionSummary option={selectedOption} /> : null}

			{diagnostics.length ? (
				<div className="grid gap-2" aria-label="Code handler diagnostics">
					{diagnostics.map((diagnostic) => (
						<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
							<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
							<div className="mt-1">{diagnostic.message}</div>
							<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
						</div>
					))}
				</div>
			) : null}

			<div className="grid gap-3" aria-label="Registered handler picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered handler refs</div>
				{picker?.options.map((option) => <HandlerOptionCard key={option.id} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Missing handler refs return structured <code className="rounded bg-slate-900 px-1 text-slate-300">WorkflowGraphError.unknownHandlerRef</code> diagnostics and block publish/run paths once executable validation is invoked.
			</div>
		</div>
	);
}

function WorkflowBuilderAdapterNodeEditor() {
	const [selectedAdapterRef, setSelectedAdapterRef] = useState(readInitialAdapterRef);
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowAdapterPicker(selectedAdapterRef || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdapterRef]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedRefId),
		[picker],
	);
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Link2 size={13} />
						Adapter node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a registered deterministic adapter ref for visible adapter nodes. The UI stores only the registry ref and never opens inline transformation code.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshAdapterPicker(selectedAdapterRef, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Registered adapter</span>
				<select
					aria-label="Registered adapter"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={picker?.selectedRefId ?? ""}
					onChange={(event) => setSelectedAdapterRef(event.target.value)}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a registered adapter ref</option>
					{picker?.options.map((option) => (
						<option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow adapter picker."}
				</div>
			) : null}

			{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge="registered adapter" /> : null}
			<WorkflowInspectorPickerDiagnostics diagnostics={diagnostics} />

			<div className="grid gap-3" aria-label="Registered adapter picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered adapter refs</div>
				{picker?.options.map((option) => <RegisteredRefOptionCard key={option.id} option={option} badge="registered adapter" />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Adapter nodes are visible graph nodes for schema transformation. Incompatible edges can alternatively use the compatible edge adapter dialog to keep the adapter on the edge.
			</div>
		</div>
	);
}

function WorkflowBuilderWorkflowNodeEditor() {
	const [selection, setSelection] = useState<WorkflowVersionSelection>(readInitialWorkflowSelection);
	const [picker, setPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		})
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selection.workflowId, selection.workflowVersion]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion),
		[picker],
	);
	const selectedKey = selectedOption ? workflowVersionOptionKey(selectedOption) : "";
	const diagnostics = picker?.diagnostics ?? [];

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<Layers size={13} />
						Workflow node editor
					</div>
					<p className="mt-2 text-xs leading-5 text-slate-500">
						Select a published workflow id/version from registry metadata. The parent graph stores only this reference and opens the child workflow separately.
					</p>
				</div>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
					onClick={() => void refreshWorkflowVersionPicker(selection, setPicker, setLoadState, setErrorMessage)}
					disabled={loadState === "loading"}
				>
					{loadState === "loading" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
					Refresh
				</button>
			</div>

			<label className="grid gap-2 text-xs font-semibold text-slate-300">
				<span>Nested workflow version</span>
				<select
					aria-label="Nested workflow picker"
					className="rounded-sm border border-slate-700 bg-[#151f24] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
					value={selectedKey}
					onChange={(event) => setSelection(parseWorkflowVersionKey(event.target.value) ?? { workflowId: "", workflowVersion: "" })}
					disabled={loadState === "loading" || loadState === "error"}
				>
					<option value="">Select a published workflow version</option>
					{picker?.options.map((option) => (
						<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
					))}
				</select>
			</label>

			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage ?? "Failed to load workflow version picker."}
				</div>
			) : null}

			{selectedOption ? <WorkflowVersionSelectionSummary option={selectedOption} /> : null}

			<WorkflowVersionDiagnostics diagnostics={diagnostics} ariaLabel="Nested workflow diagnostics" />

			<a
				className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold transition ${selectedOption ? "border-[#11a4d4]/50 text-[#8bdcf4] hover:border-[#11a4d4] hover:text-slate-100" : "pointer-events-none border-slate-800 text-slate-600"}`}
				href={selectedOption ? workflowVersionViewerPath(selectedOption.id, selectedOption.version) : "#"}
				aria-disabled={!selectedOption}
			>
				<ExternalLink size={13} />
				Open workflow
			</a>

			<div className="grid gap-3" aria-label="Nested workflow picker options">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Published workflow refs</div>
				{picker?.options.map((option) => <WorkflowVersionOptionCard key={workflowVersionOptionKey(option)} option={option} />)}
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Nested workflow internals stay collapsed in the parent graph for V2. Use <span className="font-semibold text-slate-300">Open workflow</span> to navigate to the child workflow viewer instead of inline-expanding its graph.
			</div>
		</div>
	);
}

function WorkflowVersionViewer({ workflowId, workflowVersion }: { workflowId: string; workflowVersion: string }) {
	const [picker, setPicker] = useState<WorkflowVersionHistoryResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionHistory({ selectedWorkflowId: workflowId, selectedWorkflowVersion: workflowVersion })
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow viewer");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [workflowId, workflowVersion]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion),
		[picker],
	);

	if (loadState === "loading") {
		return (
			<div className="flex w-full items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4 text-sm text-slate-300" aria-live="polite">
				<Loader2 size={16} className="animate-spin text-[#11a4d4]" />
				Loading workflow viewer {workflowId}@{workflowVersion}…
			</div>
		);
	}

	if (loadState === "error") {
		return (
			<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-4 text-sm leading-6 text-red-200" role="alert">
				<div className="font-bold">Could not load workflow viewer</div>
				<div className="mt-1 text-xs">{errorMessage ?? "Failed to load workflow metadata."}</div>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<ExternalLink size={13} />
						Workflow version viewer
					</div>
					<h3 className="mt-1 text-lg font-bold text-slate-100">{selectedOption?.title ?? `${workflowId}@${workflowVersion}`}</h3>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						This separate viewer is the nested workflow navigation target. Parent graphs do not inline-expand nested workflow internals in V2.
					</p>
				</div>
				<a className="shrink-0 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" href="/apps/chat/workflows">
					Back to Workflows
				</a>
			</div>

			{selectedOption ? <WorkflowVersionSelectionSummary option={selectedOption} /> : null}
			<WorkflowVersionDiagnostics diagnostics={picker?.diagnostics ?? []} ariaLabel="Workflow viewer diagnostics" />

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Viewer mode shows registry metadata and navigation context only. To change a child workflow, open its own UI draft or duplicate/edit a published workflow from the Workflow Library.
			</div>
		</div>
	);
}

function WorkflowVersionSelectionSummary({ option }: { option: WorkflowCatalogVersionRecord }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected workflow: {option.title}</div>
			<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}@{option.version}</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={`${option.source} source`} />
				<WorkflowPill label={option.status} />
				{option.tags.map((tag) => <WorkflowPill key={tag} label={tag} />)}
			</div>
		</div>
	);
}

function WorkflowVersionOptionCard({ option }: { option: WorkflowCatalogVersionRecord }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.title}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}@{option.version}</div>
				</div>
				<WorkflowPill label="published workflow" />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={`${option.source} source`} />
				{option.tags.map((tag) => <WorkflowPill key={tag} label={tag} />)}
			</div>
		</div>
	);
}

function WorkflowVersionDiagnostics({ diagnostics, ariaLabel }: { diagnostics: WorkflowPickerDiagnostic[]; ariaLabel: string }) {
	if (!diagnostics.length) return null;
	return (
		<div className="grid gap-2" aria-label={ariaLabel}>
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-1 font-mono text-[11px] text-amber-200/80">{diagnostic.path}</div>
					<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
				</div>
			))}
		</div>
	);
}

function WorkflowGraphNodeCard({ data, selected }: NodeProps<WorkflowGraphFlowNode>) {
	return (
		<div className={`min-w-44 rounded-sm border bg-[#15242b] px-3 py-2 shadow-lg shadow-black/20 ${selected ? "border-[#38bdf8]" : "border-slate-700"}`}>
			<Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-[#0f172a] !bg-[#38bdf8]" />
			<div className="flex items-center justify-between gap-2">
				<div className="truncate text-xs font-bold text-slate-100">{data.label}</div>
				<span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400">{data.kind}</span>
			</div>
			<div className="mt-1 font-mono text-[10px] text-slate-500">{data.nodeId}</div>
			<div className="mt-2 flex flex-wrap gap-1 text-[10px]">
				{data.isInitial ? <span className="rounded-full border border-[#11a4d4]/40 bg-[#11a4d4]/10 px-2 py-0.5 text-[#8bdcf4]">initial</span> : null}
				{data.validationCount ? <span className="rounded-full border border-amber-600/60 bg-amber-950/30 px-2 py-0.5 text-amber-200">{data.validationCount} diagnostics</span> : null}
			</div>
			<Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-[#0f172a] !bg-[#38bdf8]" />
		</div>
	);
}

const WORKFLOW_GRAPH_NODE_TYPES = {
	workflowNode: WorkflowGraphNodeCard,
};

function addWorkflowGraphNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, profileId: string): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultAgentNodeDefinition(nodeId, profileId));
}

function addWorkflowGraphWorkflowNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, workflow: WorkflowVersionPickerOption): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultWorkflowNodeDefinition(nodeId, workflow));
}

function createDefaultAgentNodeDefinition(nodeId: string, profileId: string): WorkflowJsonObject {
	return {
		kind: "agent",
		runtime: "pibo",
		label: `Agent ${nodeId}`,
		profile: { kind: "fixed", id: profileId || "base" },
		promptTemplate: DEFAULT_AGENT_PROMPT_TEMPLATE,
		metadata: { sessionOverrides: { prompt: true } },
	};
}

function createDefaultWorkflowNodeDefinition(nodeId: string, workflow: WorkflowVersionPickerOption): WorkflowJsonObject {
	return {
		kind: "workflow",
		label: `Workflow ${nodeId}`,
		workflowId: workflow.id,
		workflowVersion: workflow.version,
	};
}

function addWorkflowGraphAdapterNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, adapterRef: string): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultAdapterNodeDefinition(nodeId, adapterRef));
}

function createDefaultAdapterNodeDefinition(nodeId: string, adapterRef: string, input?: WorkflowJsonObject, output?: WorkflowJsonObject): WorkflowJsonObject {
	return {
		kind: "adapter",
		label: `Adapter ${nodeId}`,
		mode: "deterministic",
		handler: createRegisteredAdapterRef(adapterRef),
		input: cloneWorkflowJsonObject(input ?? createWorkflowPort("text", "", undefined)),
		output: cloneWorkflowJsonObject(output ?? createWorkflowPort("text", "", undefined)),
	};
}

function addWorkflowGraphHumanNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, action: WorkflowHumanActionFormChoice): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultHumanNodeDefinition(nodeId, action));
}

function createDefaultHumanNodeDefinition(nodeId: string, action: WorkflowHumanActionFormChoice): WorkflowJsonObject {
	return {
		kind: "human",
		label: `Human ${nodeId}`,
		prompt: "Review the workflow context and choose an available action.",
		input: createWorkflowPort("text", "Context for human review.", undefined),
		output: createWorkflowPort("json", "Human action result.", undefined, formatWorkflowSchemaText(DEFAULT_WORKFLOW_JSON_SCHEMA)),
		schema: cloneWorkflowJsonObject(DEFAULT_WORKFLOW_JSON_SCHEMA),
		actions: [createHumanActionObject(action)],
		timeout: { kind: "minutes", value: 60 },
	};
}

function describeSelectedGraphElement(definition: WorkflowDraftDefinition, selectedElement: SelectedGraphElement): string {
	if (!selectedElement) return "Select a node or edge in the canvas to inspect or delete it.";
	if (selectedElement.type === "node") {
		const node = readWorkflowNodeDefinitions(definition)[selectedElement.id];
		return node ? `Node ${selectedElement.id}: ${workflowNodeKind(node)} — ${workflowNodeLabel(selectedElement.id, node)}` : `Node ${selectedElement.id}`;
	}
	const edge = readWorkflowEdgeDefinitions(definition)[selectedElement.id];
	const source = edge ? readEdgeEndpointNodeId(edge.from) : undefined;
	const target = edge ? readEdgeEndpointNodeId(edge.to) : undefined;
	return edge && source && target ? `Edge ${selectedElement.id}: ${source} → ${target}` : `Edge ${selectedElement.id}`;
}

function createWorkflowSettingsFormState(definition: WorkflowDraftDefinition): WorkflowSettingsFormState {
	const metadata = isWorkflowJsonObject(definition.metadata) ? definition.metadata : {};
	return {
		title: typeof definition.title === "string" ? definition.title : "",
		description: typeof definition.description === "string" ? definition.description : "",
		inputKind: readWorkflowPortKind(definition.input, "text"),
		inputDescription: readWorkflowPortDescription(definition.input),
		inputSchemaText: formatWorkflowPortSchemaText(definition.input),
		outputKind: readWorkflowPortKind(definition.output, "text"),
		outputDescription: readWorkflowPortDescription(definition.output),
		outputSchemaText: formatWorkflowPortSchemaText(definition.output),
		globalStateFields: createWorkflowGlobalStateFieldFormState(definition),
		metadataTags: formatWorkflowStringList(metadata.tags),
		metadataUseWhen: formatWorkflowStringList(metadata.useWhen),
		metadataNotFor: formatWorkflowStringList(metadata.notFor),
		metadataExamples: formatWorkflowStringList(metadata.examples),
	};
}

function applyWorkflowSettingsForm(definition: WorkflowDraftDefinition, form: WorkflowSettingsFormState): WorkflowDraftDefinition {
	const metadata: WorkflowJsonObject = isWorkflowJsonObject(definition.metadata) ? { ...definition.metadata } : {};
	writeWorkflowStringList(metadata, "tags", form.metadataTags);
	writeWorkflowStringList(metadata, "useWhen", form.metadataUseWhen);
	writeWorkflowStringList(metadata, "notFor", form.metadataNotFor);
	writeWorkflowStringList(metadata, "examples", form.metadataExamples);
	const nextDefinition: WorkflowDraftDefinition = {
		...definition,
		input: createWorkflowPort(form.inputKind, form.inputDescription, definition.input, form.inputSchemaText),
		output: createWorkflowPort(form.outputKind, form.outputDescription, definition.output, form.outputSchemaText),
	};
	writeWorkflowGlobalStateFields(nextDefinition, form.globalStateFields);
	writeOptionalString(nextDefinition, "title", form.title);
	writeOptionalString(nextDefinition, "description", form.description);
	if (Object.keys(metadata).length) nextDefinition.metadata = metadata;
	else delete nextDefinition.metadata;
	return nextDefinition;
}

function createDefaultGlobalStateField(existingFields: WorkflowGlobalStateFieldFormState[]): WorkflowGlobalStateFieldFormState {
	const existingPaths = new Set(existingFields.map((field) => field.path.trim()).filter(Boolean));
	let path = "projectGoal";
	let index = 2;
	while (existingPaths.has(path)) {
		path = `projectGoal${index}`;
		index += 1;
	}
	return {
		path,
		description: "",
		schemaText: formatWorkflowSchemaText(DEFAULT_WORKFLOW_JSON_SCHEMA),
		mergeKind: "none",
	};
}

function createWorkflowGlobalStateFieldFormState(definition: WorkflowDraftDefinition): WorkflowGlobalStateFieldFormState[] {
	const state = isWorkflowJsonObject(definition.state) ? definition.state : undefined;
	const global = state && isWorkflowJsonObject(state.global) ? state.global : undefined;
	if (!global) return [];
	return Object.entries(global).flatMap(([path, value]): WorkflowGlobalStateFieldFormState[] => {
		if (!isWorkflowJsonObject(value)) return [];
		return [{
			path,
			description: typeof value.description === "string" ? value.description : "",
			schemaText: formatWorkflowSchemaText(value.schema),
			mergeKind: readWorkflowGlobalStateMergeKind(value.merge),
		}];
	});
}

function readWorkflowGlobalStateMergeKind(value: unknown): WorkflowGlobalStateMergeKind {
	if (!isWorkflowJsonObject(value) || typeof value.kind !== "string") return "none";
	return ["replace", "append", "shallowMerge"].includes(value.kind) ? value.kind as WorkflowGlobalStateMergeKind : "none";
}

function writeWorkflowGlobalStateFields(definition: WorkflowDraftDefinition, fields: WorkflowGlobalStateFieldFormState[]): void {
	const nextState: WorkflowJsonObject = isWorkflowJsonObject(definition.state) ? { ...definition.state } : {};
	const globalFields: Record<string, WorkflowJsonObject> = {};
	for (const field of fields) {
		const path = sanitizeWorkflowStatePathInput(field.path);
		if (!path) continue;
		const stateField: WorkflowJsonObject = { schema: parseWorkflowSchemaText(field.schemaText) };
		writeOptionalString(stateField, "description", field.description);
		const merge = createWorkflowGlobalStateMergePolicy(field.mergeKind);
		if (merge) stateField.merge = merge;
		globalFields[path] = stateField;
	}
	if (Object.keys(globalFields).length) nextState.global = globalFields;
	else delete nextState.global;
	if (Object.keys(nextState).length) definition.state = nextState;
	else delete definition.state;
}

function createWorkflowGlobalStateMergePolicy(kind: WorkflowGlobalStateMergeKind): WorkflowJsonObject | undefined {
	return kind === "none" ? undefined : { kind };
}

function workflowSettingsStateChanged(definition: WorkflowDraftDefinition, form: WorkflowSettingsFormState): boolean {
	return JSON.stringify(createWorkflowGlobalStateFieldFormState(definition)) !== JSON.stringify(form.globalStateFields);
}

function workflowNodeStateAccessChanged(node: WorkflowJsonObject, form: WorkflowNodeInspectorFormState): boolean {
	return workflowStateAccessChanged(node.state, form.stateAccess);
}

function workflowStateAccessChanged(value: unknown, form: WorkflowStateAccessFormState): boolean {
	const current = createWorkflowStateAccessFormState(value);
	return JSON.stringify({ reads: current.reads, writes: current.writes }) !== JSON.stringify({ reads: form.reads, writes: form.writes });
}

function createWorkflowStateAccessFormState(value: unknown): WorkflowStateAccessFormState {
	const state = isWorkflowJsonObject(value) ? value : {};
	const reads = readWorkflowStateAccessList(state.reads);
	const writes = readWorkflowStateAccessList(state.writes);
	const firstRead = parseWorkflowScopedStatePath(reads[0]);
	const firstWrite = parseWorkflowScopedStatePath(writes[0]);
	return {
		reads,
		writes,
		readScope: firstRead?.scope ?? "global",
		readPath: firstRead?.path ?? "",
		writeScope: firstWrite?.scope === "edge" ? "global" : firstWrite?.scope ?? "global",
		writePath: firstWrite?.scope === "edge" ? "" : firstWrite?.path ?? "",
	};
}

function readWorkflowStateAccessList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(parseWorkflowScopedStatePath(entry))) : [];
}

function writeWorkflowStateAccess(target: WorkflowJsonObject, form: WorkflowStateAccessFormState): void {
	const state: WorkflowJsonObject = isWorkflowJsonObject(target.state) ? { ...target.state } : {};
	if (form.reads.length) state.reads = [...form.reads];
	else delete state.reads;
	if (form.writes.length) state.writes = [...form.writes];
	else delete state.writes;
	if (Object.keys(state).length) target.state = state;
	else delete target.state;
}

function workflowStatePathOptions(definition: WorkflowDraftDefinition, scope: WorkflowStateScope, selectedEntries: string[]): string[] {
	const selected = selectedEntries.flatMap((entry) => {
		const parsed = parseWorkflowScopedStatePath(entry);
		return parsed?.scope === scope ? [parsed.path] : [];
	});
	const base = scope === "global"
		? readWorkflowGlobalStatePaths(definition)
		: scope === "local"
			? DEFAULT_LOCAL_STATE_PATHS
			: DEFAULT_EDGE_STATE_PATHS;
	return [...new Set([...base, ...selected])].sort();
}

function readWorkflowGlobalStatePaths(definition: WorkflowDraftDefinition): string[] {
	const state = isWorkflowJsonObject(definition.state) ? definition.state : undefined;
	const global = state && isWorkflowJsonObject(state.global) ? state.global : undefined;
	return global ? Object.keys(global).sort() : [];
}

function sanitizeWorkflowStatePathInput(value: string): string {
	return value.trim().replace(/\s+/g, "").replace(/^\.+/, "").replace(/\.+$/, "").replace(/\.{2,}/g, ".");
}

function parseWorkflowScopedStatePath(value: string | undefined): { scope: WorkflowStateScope; path: string } | undefined {
	if (!value) return undefined;
	const separatorIndex = value.indexOf(".");
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) return undefined;
	const scope = value.slice(0, separatorIndex);
	const path = value.slice(separatorIndex + 1);
	if (!WORKFLOW_STATE_SCOPES.includes(scope as WorkflowStateScope)) return undefined;
	if (path.split(".").some((segment) => !segment)) return undefined;
	return { scope: scope as WorkflowStateScope, path };
}

function createWorkflowNodeInspectorFormState(node: WorkflowJsonObject): WorkflowNodeInspectorFormState {
	const workflowId = typeof node.workflowId === "string" ? node.workflowId : "";
	const workflowVersion = typeof node.workflowVersion === "string" ? node.workflowVersion : "";
	return {
		label: typeof node.label === "string" ? node.label : "",
		description: typeof node.description === "string" ? node.description : "",
		inputKind: readOptionalWorkflowPortKind(node.input),
		inputDescription: readWorkflowPortDescription(node.input),
		inputSchemaText: formatWorkflowPortSchemaText(node.input),
		outputKind: readOptionalWorkflowPortKind(node.output),
		outputDescription: readWorkflowPortDescription(node.output),
		outputSchemaText: formatWorkflowPortSchemaText(node.output),
		stateAccess: createWorkflowStateAccessFormState(node.state),
		profileId: readAgentProfileId(node.profile),
		promptTemplate: typeof node.promptTemplate === "string" ? node.promptTemplate : "",
		handlerId: typeof node.handler === "string" ? node.handler : "",
		adapterRef: readAdapterRefId(node.handler),
		adapterParamsText: formatWorkflowParamsText(readAdapterRefParams(node.handler)),
		workflowVersionKey: workflowId && workflowVersion ? workflowVersionSelectionKey(workflowId, workflowVersion) : "",
		humanPrompt: typeof node.prompt === "string" ? node.prompt : "",
		humanSchemaText: node.schema === undefined ? "" : formatWorkflowSchemaText(node.schema),
		humanActionRefs: readHumanActionChoices(node.actions),
		humanTimeoutKind: readHumanTimeoutKind(node.timeout),
		humanTimeoutValue: formatHumanTimeoutValue(node.timeout),
	};
}

function applyWorkflowNodeInspectorForm(definition: WorkflowDraftDefinition, nodeId: string, form: WorkflowNodeInspectorFormState): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	const currentNode = nodes[nodeId];
	if (!currentNode) return definition;
	const nodeKind = workflowNodeKind(currentNode);
	const nextNode: WorkflowJsonObject = { ...currentNode };
	writeOptionalString(nextNode, "label", form.label);
	writeOptionalString(nextNode, "description", form.description);
	writeOptionalPort(nextNode, "input", form.inputKind, form.inputDescription, currentNode.input, form.inputSchemaText);
	writeOptionalPort(nextNode, "output", form.outputKind, form.outputDescription, currentNode.output, form.outputSchemaText);
	writeWorkflowStateAccess(nextNode, form.stateAccess);
	if (nodeKind === "agent") {
		nextNode.runtime = "pibo";
		if (form.profileId.trim()) nextNode.profile = { kind: "fixed", id: form.profileId.trim() };
		writeOptionalString(nextNode, "promptTemplate", form.promptTemplate);
		if (form.promptTemplate.trim()) delete nextNode.promptBuilder;
	}
	if (nodeKind === "code") {
		nextNode.language = "typescript";
		if (form.handlerId.trim()) nextNode.handler = form.handlerId.trim();
	}
	if (nodeKind === "adapter") {
		nextNode.mode = "deterministic";
		if (form.adapterRef.trim()) {
			const handler = createRegisteredAdapterRef(form.adapterRef.trim());
			writeWorkflowParams(handler, form.adapterParamsText);
			nextNode.handler = handler;
		}
	}
	if (nodeKind === "workflow") {
		const selection = parseWorkflowVersionKey(form.workflowVersionKey);
		if (selection) {
			nextNode.workflowId = selection.workflowId;
			nextNode.workflowVersion = selection.workflowVersion;
		}
	}
	if (nodeKind === "human") {
		writeOptionalString(nextNode, "prompt", form.humanPrompt);
		if (form.humanSchemaText.trim()) nextNode.schema = parseWorkflowSchemaText(form.humanSchemaText);
		else delete nextNode.schema;
		writeHumanActionChoices(nextNode, form.humanActionRefs);
		writeHumanTimeout(nextNode, form.humanTimeoutKind, form.humanTimeoutValue);
	}
	return {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: nextNode,
		},
	};
}

function readPromptAssetRefId(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!isWorkflowJsonObject(value)) return "";
	return typeof value.id === "string" ? value.id.trim() : "";
}

function applyWorkflowPromptAssetDocumentToNode(definition: WorkflowDraftDefinition, nodeId: string, asset: WorkflowPromptAssetDocument): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	const currentNode = nodes[nodeId];
	if (!currentNode) return definition;
	const nextNode: WorkflowJsonObject = {
		...currentNode,
		promptBuilder: {
			kind: "promptBuilder",
			language: "typescript",
			id: asset.id,
			revisionId: asset.revisionId,
			contentHash: asset.contentHash,
			source: asset.source,
		},
		metadata: writeWorkflowPromptAssetMetadata(currentNode.metadata, asset),
	};
	delete nextNode.promptTemplate;
	return {
		...definition,
		metadata: writeWorkflowPromptAssetMetadata(definition.metadata, asset),
		nodes: {
			...nodes,
			[nodeId]: nextNode,
		},
	};
}

function writeWorkflowPromptAssetMetadata(value: unknown, asset: WorkflowPromptAssetDocument): WorkflowJsonObject {
	const metadata: WorkflowJsonObject = isWorkflowJsonObject(value) ? { ...value } : {};
	const existingRefs = Array.isArray(metadata.promptAssetRefs)
		? metadata.promptAssetRefs.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: [];
	metadata.promptAssetRefs = [...new Set([...existingRefs, asset.id])];
	const existingPins = Array.isArray(metadata.promptAssetPins)
		? metadata.promptAssetPins.filter((entry) => isWorkflowJsonObject(entry) && entry.assetId !== asset.id)
		: [];
	metadata.promptAssetPins = [
		...existingPins,
		{
			assetId: asset.id,
			revisionId: asset.revisionId,
			contentHash: asset.contentHash,
			source: asset.source,
		},
	];
	return metadata;
}

function createWorkflowEdgeInspectorFormState(edge: WorkflowJsonObject, nodeIds: string[]): WorkflowEdgeInspectorFormState {
	const from = isWorkflowJsonObject(edge.from) ? edge.from : {};
	const to = isWorkflowJsonObject(edge.to) ? edge.to : {};
	const guard = isWorkflowJsonObject(edge.guard) ? edge.guard : undefined;
	const adapter = isWorkflowJsonObject(edge.adapter) ? edge.adapter : undefined;
	const transform = adapter && isWorkflowJsonObject(adapter.transform) ? adapter.transform : undefined;
	const kind = typeof edge.kind === "string" && ["data", "control", "error", "resume"].includes(edge.kind) ? edge.kind as WorkflowEdgeInspectorFormState["kind"] : "data";
	return {
		sourceNodeId: typeof from.nodeId === "string" ? from.nodeId : nodeIds[0] ?? "",
		sourcePortId: typeof from.portId === "string" ? from.portId : "",
		targetNodeId: typeof to.nodeId === "string" ? to.nodeId : nodeIds.find((id) => id !== (from.nodeId ?? nodeIds[0])) ?? "",
		targetPortId: typeof to.portId === "string" ? to.portId : "",
		kind,
		guardHandler: guard && typeof guard.handler === "string" ? guard.handler : "",
		guardPriority: guard && typeof guard.priority === "number" ? String(guard.priority) : "",
		guardParamsText: formatWorkflowParamsText(guard?.params),
		adapterRef: transform && typeof transform.id === "string" ? transform.id : "",
		adapterParamsText: formatWorkflowParamsText(transform?.params),
		stateAccess: createWorkflowStateAccessFormState(edge.state),
	};
}

function applyWorkflowEdgeInspectorForm(definition: WorkflowDraftDefinition, edgeId: string, form: WorkflowEdgeInspectorFormState): WorkflowDraftDefinition {
	const edges = readWorkflowEdgeDefinitions(definition);
	const currentEdge = edges[edgeId];
	if (!currentEdge) return definition;
	const nextEdge: WorkflowJsonObject = {
		...currentEdge,
		id: edgeId,
		from: createNodePortRef(form.sourceNodeId, form.sourcePortId),
		to: createNodePortRef(form.targetNodeId, form.targetPortId),
		kind: form.kind,
	};
	const guardHandler = form.guardHandler.trim();
	if (guardHandler) {
		const priority = Number.parseInt(form.guardPriority, 10);
		const guard: WorkflowJsonObject = {
			handler: guardHandler,
			...(Number.isInteger(priority) && priority >= 0 ? { priority } : {}),
		};
		writeWorkflowParams(guard, form.guardParamsText);
		nextEdge.guard = guard;
	} else {
		delete nextEdge.guard;
	}
	writeWorkflowStateAccess(nextEdge, form.stateAccess);
	const adapterRef = form.adapterRef.trim();
	if (adapterRef) {
		const previousAdapter = isWorkflowJsonObject(currentEdge.adapter) ? currentEdge.adapter : {};
		const transform = createRegisteredAdapterRef(adapterRef);
		writeWorkflowParams(transform, form.adapterParamsText);
		nextEdge.adapter = {
			...previousAdapter,
			kind: "edgeAdapter",
			output: isWorkflowJsonObject(previousAdapter.output) ? previousAdapter.output : createWorkflowPort("text", "", undefined),
			transform,
		};
	} else {
		delete nextEdge.adapter;
	}
	return {
		...definition,
		edges: {
			...edges,
			[edgeId]: nextEdge,
		},
	};
}


function cloneWorkflowJsonObject(value: WorkflowJsonObject): WorkflowJsonObject {
	return JSON.parse(JSON.stringify(value)) as WorkflowJsonObject;
}

function readWorkflowPortKind(value: unknown, fallback: WorkflowPortKindSelection): WorkflowPortKindSelection {
	if (!isWorkflowJsonObject(value)) return fallback;
	return value.kind === "json" ? "json" : "text";
}

function readOptionalWorkflowPortKind(value: unknown): OptionalWorkflowPortKindSelection {
	if (!isWorkflowJsonObject(value)) return "none";
	return readWorkflowPortKind(value, "text");
}

function readWorkflowPortDescription(value: unknown): string {
	return isWorkflowJsonObject(value) && typeof value.description === "string" ? value.description : "";
}

function formatWorkflowPortSchemaText(value: unknown): string {
	const schema = isWorkflowJsonObject(value) && value.schema !== undefined ? value.schema : DEFAULT_WORKFLOW_JSON_SCHEMA;
	return formatWorkflowSchemaText(schema);
}

function formatWorkflowSchemaText(value: unknown): string {
	try {
		return JSON.stringify(value ?? DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2) ?? JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2);
	} catch {
		return JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2);
	}
}

function parseWorkflowSchemaText(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) return cloneWorkflowJsonObject(DEFAULT_WORKFLOW_JSON_SCHEMA);
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function createWorkflowPort(kind: WorkflowPortKindSelection, description: string, previous: unknown, schemaText?: string): WorkflowJsonObject {
	const port: WorkflowJsonObject = { kind };
	writeOptionalString(port, "description", description);
	if (kind === "json") {
		port.schema = parseWorkflowSchemaText(schemaText ?? formatWorkflowPortSchemaText(previous));
	}
	return port;
}

function writeOptionalPort(target: WorkflowJsonObject, key: "input" | "output", kind: OptionalWorkflowPortKindSelection, description: string, previous: unknown, schemaText: string): void {
	if (kind === "none") {
		delete target[key];
		return;
	}
	target[key] = createWorkflowPort(kind, description, previous, schemaText);
}

function createNodePortRef(nodeId: string, portId: string): WorkflowJsonObject {
	const ref: WorkflowJsonObject = { nodeId };
	writeOptionalString(ref, "portId", portId);
	return ref;
}

function readAgentProfileId(value: unknown): string {
	return isWorkflowJsonObject(value) && value.kind === "fixed" && typeof value.id === "string" ? value.id : "";
}

function readAdapterRefId(value: unknown): string {
	return isWorkflowJsonObject(value) && value.kind === "adapter" && value.language === "typescript" && typeof value.id === "string" ? value.id : "";
}

function readAdapterRefParams(value: unknown): unknown {
	return isWorkflowJsonObject(value) && value.kind === "adapter" && value.language === "typescript" ? value.params : undefined;
}

function createRegisteredAdapterRef(adapterRef: string): WorkflowJsonObject {
	return { kind: "adapter", language: "typescript", id: adapterRef };
}

function readHumanActionChoices(value: unknown): WorkflowHumanActionFormChoice[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry): WorkflowHumanActionFormChoice[] => {
		if (!isWorkflowJsonObject(entry) || typeof entry.id !== "string" || !entry.id.trim()) return [];
		return [createHumanActionChoice(entry.id, typeof entry.kind === "string" ? entry.kind : undefined)];
	});
}

function createHumanActionChoice(id: string, kind?: string): WorkflowHumanActionFormChoice {
	return kind ? { id, kind } : { id };
}

function createHumanActionObject(action: WorkflowHumanActionFormChoice): WorkflowJsonObject {
	return action.kind ? { id: action.id, kind: action.kind } : { id: action.id };
}

function toggleHumanActionChoice(current: WorkflowHumanActionFormChoice[], option: WorkflowRegisteredRefOption, checked: boolean): WorkflowHumanActionFormChoice[] {
	if (!checked) return current.filter((action) => action.id !== option.id);
	if (current.some((action) => action.id === option.id)) return current;
	return [...current, createHumanActionChoice(option.id, option.kind)];
}

function writeHumanActionChoices(target: WorkflowJsonObject, actions: WorkflowHumanActionFormChoice[]): void {
	if (!actions.length) {
		delete target.actions;
		return;
	}
	target.actions = actions.map(createHumanActionObject);
}

function readHumanTimeoutKind(value: unknown): WorkflowHumanTimeoutKind {
	if (!isWorkflowJsonObject(value) || typeof value.kind !== "string") return "none";
	return ["milliseconds", "seconds", "minutes", "iso8601"].includes(value.kind) ? value.kind as WorkflowHumanTimeoutKind : "none";
}

function formatHumanTimeoutValue(value: unknown): string {
	if (!isWorkflowJsonObject(value)) return "";
	return typeof value.value === "number" || typeof value.value === "string" ? String(value.value) : "";
}

function writeHumanTimeout(target: WorkflowJsonObject, kind: WorkflowHumanTimeoutKind, value: string): void {
	const trimmed = value.trim();
	if (kind === "none" || !trimmed) {
		delete target.timeout;
		return;
	}
	if (kind === "iso8601") {
		target.timeout = { kind, value: trimmed };
		return;
	}
	const numericValue = Number(trimmed);
	if (Number.isFinite(numericValue) && numericValue > 0) target.timeout = { kind, value: numericValue };
	else delete target.timeout;
}

function formatWorkflowParamsText(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return "";
	}
}

function writeWorkflowParams(target: WorkflowJsonObject, value: string): void {
	const trimmed = value.trim();
	if (!trimmed) {
		delete target.params;
		return;
	}
	try {
		target.params = JSON.parse(trimmed) as unknown;
	} catch {
		target.params = trimmed;
	}
}

function formatWorkflowStringList(value: unknown): string {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join("\n") : "";
}

function parseWorkflowStringList(value: string): string[] {
	return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

function writeWorkflowStringList(target: WorkflowJsonObject, key: "tags" | "useWhen" | "notFor" | "examples", value: string): void {
	const entries = parseWorkflowStringList(value);
	if (entries.length) target[key] = entries;
	else delete target[key];
}

function writeOptionalString(target: WorkflowJsonObject, key: string, value: string): void {
	const trimmed = value.trim();
	if (trimmed) target[key] = trimmed;
	else delete target[key];
}

function workflowDiagnosticsForNode(diagnostics: WorkflowDraftDiagnostic[], nodeId: string): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.nodeId === nodeId || diagnostic.path?.startsWith(`$.nodes.${nodeId}`));
}

function workflowDiagnosticsForEdge(diagnostics: WorkflowDraftDiagnostic[], edgeId: string): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.edgeId === edgeId || diagnostic.path?.startsWith(`$.edges.${edgeId}`));
}

function registeredRefOptionLabel(option: WorkflowRegisteredRefOption): string {
	return `${option.displayName} (${option.id})`;
}

function humanActionOptionLabel(option: WorkflowRegisteredRefOption): string {
	return `${option.displayName}${option.kind ? ` · ${option.kind}` : ""} (${option.id})`;
}

function readInitialProfileRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("profileRef") ?? "";
}

function readInitialHandlerRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("handlerRef") ?? "";
}

function readInitialAdapterRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("adapterRef") ?? "";
}

function readInitialWorkflowSelection(): WorkflowVersionSelection {
	if (typeof window === "undefined") return { workflowId: "", workflowVersion: "" };
	const searchParams = new URL(window.location.href).searchParams;
	const workflowRef = searchParams.get("workflowRef");
	if (workflowRef) return parseWorkflowVersionKey(workflowRef) ?? { workflowId: workflowRef, workflowVersion: "" };
	return {
		workflowId: searchParams.get("workflowId") ?? "",
		workflowVersion: searchParams.get("workflowVersion") ?? "",
	};
}

async function refreshProfilePicker(
	selectedProfileId: string,
	setPicker: (picker: WorkflowProfilePickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowProfilePicker(selectedProfileId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow profile picker");
		setLoadState("error");
	}
}

async function refreshHandlerPicker(
	selectedHandlerId: string,
	setPicker: (picker: WorkflowHandlerPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowHandlerPicker(selectedHandlerId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow handler picker");
		setLoadState("error");
	}
}

async function refreshAdapterPicker(
	selectedRefId: string,
	setPicker: (picker: WorkflowRegisteredRefPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowAdapterPicker(selectedRefId || undefined));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow adapter picker");
		setLoadState("error");
	}
}

async function refreshWorkflowVersionPicker(
	selection: WorkflowVersionSelection,
	setPicker: (picker: WorkflowVersionPickerResponse | undefined) => void,
	setLoadState: (state: "loading" | "loaded" | "error") => void,
	setErrorMessage: (message: string | undefined) => void,
): Promise<void> {
	setLoadState("loading");
	setErrorMessage(undefined);
	try {
		setPicker(await getWorkflowVersionPicker({
			selectedWorkflowId: selection.workflowId || undefined,
			selectedWorkflowVersion: selection.workflowVersion || undefined,
		}));
		setLoadState("loaded");
	} catch (error) {
		setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow version picker");
		setLoadState("error");
	}
}

function profileOptionLabel(option: WorkflowProfilePickerOption): string {
	return option.source === "custom" ? `${option.displayName} (custom)` : `${option.displayName} (global)`;
}

function ProfileSelectionSummary({ option }: { option: WorkflowProfilePickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected profile: {option.displayName}</div>
			{option.description ? <div className="mt-1 text-slate-500">{option.description}</div> : null}
			<div className="mt-2 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={option.source === "custom" ? "Custom Agent" : "Global profile"} />
				<WorkflowPill label={`${option.nativeTools.length} native tools`} />
				<WorkflowPill label={`${option.skills.length} skills`} />
				<WorkflowPill label={`${option.contextFiles.length} context files`} />
			</div>
		</div>
	);
}

function handlerOptionLabel(option: WorkflowHandlerPickerOption): string {
	return `${option.displayName} (${option.id})`;
}

function workflowVersionOptionKey(option: WorkflowVersionPickerOption): string {
	return workflowVersionSelectionKey(option.id, option.version);
}

function workflowVersionSelectionKey(workflowId: string, workflowVersion: string): string {
	return `${workflowId}@${workflowVersion}`;
}

function workflowVersionOptionLabel(option: WorkflowVersionPickerOption): string {
	return `${option.title} (${workflowVersionOptionKey(option)})`;
}

function parseWorkflowVersionKey(value: string): WorkflowVersionSelection | undefined {
	const atIndex = value.lastIndexOf("@");
	if (atIndex <= 0 || atIndex === value.length - 1) return undefined;
	return { workflowId: value.slice(0, atIndex), workflowVersion: value.slice(atIndex + 1) };
}

function workflowVersionViewerPath(workflowId: string, workflowVersion: string): string {
	return `/apps/chat/workflows/view/${encodeURIComponent(workflowId)}/${encodeURIComponent(workflowVersion)}`;
}

function HandlerSelectionSummary({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected handler: {option.displayName}</div>
			<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}

function HandlerOptionCard({ option }: { option: WorkflowHandlerPickerOption }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.displayName}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
				</div>
				<WorkflowPill label="registered handler" />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<HandlerSchemaPreview label="inputSchema" schema={option.inputSchema} />
				<HandlerSchemaPreview label="outputSchema" schema={option.outputSchema} />
			</div>
		</div>
	);
}

function RegisteredRefOptionCard({ option, badge }: { option: WorkflowRegisteredRefOption; badge: string }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.displayName}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
				</div>
				<WorkflowPill label={badge} />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			{option.paramsSchema ? <div className="mt-3"><HandlerSchemaPreview label="paramsSchema" schema={option.paramsSchema} /></div> : null}
		</div>
	);
}

function HandlerSchemaPreview({ label, schema }: { label: string; schema: Record<string, unknown> | null }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-300">{formatNullableSchema(schema)}</pre>
		</div>
	);
}

function formatNullableSchema(schema: Record<string, unknown> | null): string {
	return schema ? JSON.stringify(schema, null, 2) : "null";
}

function WorkflowPill({ label }: { label: string }) {
	return <span className="rounded-full border border-slate-700 bg-[#101d22] px-2 py-0.5 text-slate-400">{label}</span>;
}

function WorkflowFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3">
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<div className="mt-1 break-all font-mono text-[11px] text-slate-200">{value}</div>
		</div>
	);
}

function WorkflowSurfaceCard({ icon: Icon, eyebrow, title, description, children }: { icon: LucideIcon; eyebrow: string; title: string; description: string; children: ReactNode }) {
	return (
		<section className="flex min-h-72 flex-col rounded-sm border border-slate-800 bg-[#151f24] p-5 shadow-lg shadow-black/20">
			<div className="flex items-start gap-3">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[#11a4d4]/35 bg-[#11a4d4]/10 text-[#11a4d4]">
					<Icon size={18} />
				</div>
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</div>
					<h2 className="mt-1 text-lg font-bold text-slate-100">{title}</h2>
					<p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
				</div>
			</div>
			<div className="mt-5 flex flex-1">{children}</div>
		</section>
	);
}

function WorkflowEmptyState({ title, description }: { title: string; description: string }) {
	return (
		<div className="flex w-full flex-col justify-center rounded-sm border border-dashed border-slate-700 bg-[#101d22]/70 p-4 text-center">
			<div className="text-sm font-semibold text-slate-200">{title}</div>
			<p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
		</div>
	);
}

function WorkflowPrinciple({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
	return (
		<div className="flex items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/60 px-3 py-2">
			<Icon size={14} className="shrink-0 text-[#11a4d4]" />
			<span>{label}</span>
		</div>
	);
}

function workflowBuilderDraftPath(draftId: string): string {
	return `/apps/chat/workflows/drafts/${encodeURIComponent(draftId)}`;
}

function openBuilderPath(path: string): void {
	if (typeof window === "undefined") return;
	window.location.assign(path);
}
