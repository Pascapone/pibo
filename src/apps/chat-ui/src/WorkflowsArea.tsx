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
	type Edge,
	type EdgeChange,
	type Node,
	type NodeChange,
	type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, BookOpenText, Brain, CheckCheck, Code2, CopyPlus, ExternalLink, Layers, Link2, Loader2, MousePointer2, MoveRight, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowDraft,
	getWorkflowGuardPicker,
	getWorkflowHandlerPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	patchWorkflowDraft,
	postWorkflowDraftPublish,
	postWorkflowDuplicateDraft,
	postWorkflowNextDraft,
	type WorkflowDraftDefinition,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowPickerDiagnostic,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
	type WorkflowRegisteredRefOption,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowValidationTrigger,
	type WorkflowVersionPickerOption,
	type WorkflowVersionPickerResponse,
} from "./api";

const DEFAULT_AGENT_PROMPT_TEMPLATE = "Use the workflow input to produce a concise answer.\n\n{{input}}";
const STARTER_DRAFT_ID = "v2-starter-draft";
const PUBLISHED_WORKFLOW_ROWS: Array<{
	id: string;
	version: string;
	title: string;
	description: string;
	source: "code" | "ui";
}> = [
	{
		id: "standard-project",
		version: "1.0.0",
		title: "Standard Project",
		description: "Code-registered workflow available for duplicate-to-draft authoring.",
		source: "code",
	},
	{
		id: "simple-chat",
		version: "1.0.0",
		title: "Simple Chat",
		description: "Baseline chat workflow available for draft loading checks.",
		source: "code",
	},
	{
		id: "ui-review-workflow",
		version: "2.0.0",
		title: "UI Review Workflow",
		description: "UI-authored published workflow fixture. Editing creates the active next-version draft instead of mutating this version.",
		source: "ui",
	},
];

const DEFAULT_GRAPH_POSITION = { x: 80, y: 80 };
const GRAPH_COLUMN_GAP = 260;
const GRAPH_ROW_GAP = 150;

type WorkflowJsonObject = Record<string, unknown>;
type GraphPosition = { x: number; y: number };
type WorkflowGraphNodeData = Record<string, unknown> & {
	nodeId: string;
	label: string;
	kind: string;
	validationCount: number;
	isInitial: boolean;
};
type WorkflowGraphFlowNode = Node<WorkflowGraphNodeData, "workflowNode">;
type WorkflowGraphEdgeData = Record<string, unknown> & {
	edgeId: string;
	kind: string;
};
type WorkflowGraphFlowEdge = Edge<WorkflowGraphEdgeData, "smoothstep">;
type SelectedGraphElement = { type: "node" | "edge"; id: string } | undefined;
type WorkflowGraphProjection = {
	nodes: WorkflowGraphFlowNode[];
	edges: WorkflowGraphFlowEdge[];
	usedAutoLayout: boolean;
	missingPositionCount: number;
};
type WorkflowVersionSelection = { workflowId: string; workflowVersion: string };
type WorkflowPortKindSelection = "text" | "json";
type OptionalWorkflowPortKindSelection = "none" | WorkflowPortKindSelection;
type WorkflowSettingsFormState = {
	title: string;
	description: string;
	inputKind: WorkflowPortKindSelection;
	inputDescription: string;
	outputKind: WorkflowPortKindSelection;
	outputDescription: string;
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
	outputKind: OptionalWorkflowPortKindSelection;
	outputDescription: string;
	profileId: string;
	promptTemplate: string;
	handlerId: string;
	workflowVersionKey: string;
	humanPrompt: string;
};
type WorkflowEdgeInspectorFormState = {
	sourceNodeId: string;
	sourcePortId: string;
	targetNodeId: string;
	targetPortId: string;
	kind: "data" | "control" | "error" | "resume";
	guardHandler: string;
	guardPriority: string;
	adapterRef: string;
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
			</section>
		</main>
	);
}

function WorkflowLibraryPanel({ activeDraftId }: { activeDraftId?: string }) {
	const [duplicatingKey, setDuplicatingKey] = useState<string | undefined>();
	const [editingKey, setEditingKey] = useState<string | undefined>();
	const [errorMessage, setErrorMessage] = useState<string | undefined>();
	const busy = Boolean(duplicatingKey || editingKey);

	const duplicateWorkflow = async (workflowId: string, version: string) => {
		const key = `${workflowId}@${version}`;
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
		const key = `${workflowId}@${version}`;
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

			<div className="grid gap-3">
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Published workflows</div>
				{PUBLISHED_WORKFLOW_ROWS.map((workflow) => {
					const key = `${workflow.id}@${workflow.version}`;
					return (
						<div key={key} className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<div className="font-semibold text-slate-100">{workflow.title}</div>
										<WorkflowPill label={`${workflow.source} source`} />
										<WorkflowPill label="published" />
									</div>
									<div className="mt-1 font-mono text-[11px] text-slate-500">{workflow.id}@{workflow.version}</div>
									<p className="mt-2 text-xs leading-5 text-slate-500">{workflow.description}</p>
									{workflow.source === "ui" ? (
										<p className="mt-2 text-[11px] leading-5 text-emerald-300">
											Edit creates or reuses the active next-version draft. Published {workflow.version} remains immutable.
										</p>
									) : null}
								</div>
								<div className="flex shrink-0 flex-col gap-2">
									{workflow.source === "ui" ? (
										<button
											type="button"
											className="inline-flex items-center justify-center gap-1 rounded-sm border border-[#11a4d4]/50 px-3 py-1.5 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
											onClick={() => void editPublishedWorkflow(workflow.id, workflow.version)}
											disabled={busy}
										>
											{editingKey === key ? <Loader2 size={13} className="animate-spin" /> : <Layers size={13} />}
											Edit published
										</button>
									) : null}
									<button
										type="button"
										className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
										onClick={() => void duplicateWorkflow(workflow.id, workflow.version)}
										disabled={busy}
									>
										{duplicatingKey === key ? <Loader2 size={13} className="animate-spin" /> : <CopyPlus size={13} />}
										Duplicate to draft
									</button>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{errorMessage ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">
					{errorMessage}
				</div>
			) : null}
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
				<li>No inline JavaScript, TypeScript, shell, eval, arbitrary executable nodes, or raw handler bodies are created by the UI.</li>
				<li>Incompatible schemas must use a visible registered adapter node or edge adapter; hidden LLM coercion is not used.</li>
				<li>XState remains projection-only; Pibo Workflow IR is the persisted source of truth.</li>
			</ul>
		</div>
	);
}

function WorkflowDraftEditorShell({ draft }: { draft: WorkflowDraftRecord }) {
	const [currentDraft, setCurrentDraft] = useState(draft);
	const [versionIntent, setVersionIntent] = useState<"patch" | "minor" | "major">(draft.versionIntent);
	const [publishState, setPublishState] = useState<"idle" | "publishing" | "published" | "error">("idle");
	const [publishMessage, setPublishMessage] = useState<string | undefined>();

	useEffect(() => {
		setCurrentDraft(draft);
		setVersionIntent(draft.versionIntent);
		setPublishState("idle");
		setPublishMessage(undefined);
	}, [draft]);

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
								disabled={publishState === "publishing"}
								aria-label="Version bump intent"
							>
								<option value="patch">Patch version bump (default)</option>
								<option value="minor">Minor version bump</option>
								<option value="major">Major version bump</option>
							</select>
						</label>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-600/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void publishDraft()}
							disabled={publishState === "publishing"}
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

			{currentDraft.diagnostics.length ? <WorkflowDraftDiagnostics draft={currentDraft} /> : (
				<div className="rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-200">No draft diagnostics returned by the loader.</div>
			)}

			<div>
				<div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Pibo Workflow IR draft</div>
				<pre aria-label="Pibo Workflow IR draft" className="max-h-80 overflow-auto rounded-sm border border-slate-800 bg-[#151f24] p-3 text-[11px] leading-5 text-slate-200">
					{JSON.stringify(currentDraft.definition, null, 2)}
				</pre>
			</div>

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Raw XState source is not opened as an editable document. XState remains projection-only; the editable source is the Pibo Workflow IR shown above.
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
	const [defaultAgentProfileId, setDefaultAgentProfileId] = useState("pibo-agent");
	const [workflowVersionOptions, setWorkflowVersionOptions] = useState<WorkflowVersionPickerOption[]>([]);
	const [selectedWorkflowVersionKey, setSelectedWorkflowVersionKey] = useState("");

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
						<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-500">
							Workflow nodes store only a workflow id/version reference. V2 does not inline-expand nested workflow internals in the parent graph.
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

	const saveSettings = () => {
		const definition = applyWorkflowSettingsForm(draft.definition, form);
		void onSaveDefinition(definition, "Saved workflow settings inspector edits to the draft IR.", { editTrigger: "graph_edit" });
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
					<WorkflowPortEditor label="Workflow input port" kind={form.inputKind} description={form.inputDescription} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} />
					<WorkflowPortEditor label="Workflow output port" kind={form.outputKind} description={form.outputDescription} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} />
				</div>
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
	const [workflowPicker, setWorkflowPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const nodeKind = workflowNodeKind(node);
	const nodeDiagnostics = workflowDiagnosticsForNode(draft.diagnostics, nodeId);

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

	const update = <K extends keyof WorkflowNodeInspectorFormState>(key: K, value: WorkflowNodeInspectorFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const saveNode = () => {
		const definition = applyWorkflowNodeInspectorForm(draft.definition, nodeId, form);
		void onSaveDefinition(definition, `Saved node inspector edits for ${nodeId}.`, { editTrigger: "node_edit" });
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
					<WorkflowOptionalPortEditor label="Node input port" kind={form.inputKind} description={form.inputDescription} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} />
					<WorkflowOptionalPortEditor label="Node output port" kind={form.outputKind} description={form.outputDescription} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} />
				</div>
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
						</label>
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
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Human prompt</span>
						<textarea className="min-h-24 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.humanPrompt} onChange={(event) => update("humanPrompt", event.target.value)} />
					</label>
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
	const edgeDiagnostics = workflowDiagnosticsForEdge(draft.diagnostics, edgeId);

	useEffect(() => {
		setForm(createWorkflowEdgeInspectorFormState(edge, nodeIds));
	}, [edge, edgeId, nodeIds]);

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
		void onSaveDefinition(definition, `Saved edge inspector edits for ${edgeId}.`, { editTrigger: "edge_edit" });
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

function WorkflowPortEditor({ label, kind, description, onKindChange, onDescriptionChange }: {
	label: string;
	kind: WorkflowPortKindSelection;
	description: string;
	onKindChange: (kind: WorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
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
		</div>
	);
}

function WorkflowOptionalPortEditor({ label, kind, description, onKindChange, onDescriptionChange }: {
	label: string;
	kind: OptionalWorkflowPortKindSelection;
	description: string;
	onKindChange: (kind: OptionalWorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
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
		</div>
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
		<div className="grid gap-2" aria-label="Workflow draft diagnostics">
			{draft.diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? "workflow"}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					{diagnostic.path ? <div className="mt-1 font-mono text-[11px] text-amber-200/80">{diagnostic.path}</div> : null}
					{diagnostic.hint ? <div className="mt-1 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
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
	const [picker, setPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionPicker({ selectedWorkflowId: workflowId, selectedWorkflowVersion: workflowVersion })
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

function WorkflowVersionSelectionSummary({ option }: { option: WorkflowVersionPickerOption }) {
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

function WorkflowVersionOptionCard({ option }: { option: WorkflowVersionPickerOption }) {
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

function createWorkflowGraphProjection(definition: WorkflowDraftDefinition, diagnostics: WorkflowDraftDiagnostic[]): WorkflowGraphProjection {
	const nodeDefinitions = readWorkflowNodeDefinitions(definition);
	const nodeEntries = Object.entries(nodeDefinitions);
	const workflowPositions = readWorkflowPositions(definition);
	const nodeIds = new Set(nodeEntries.map(([nodeId]) => nodeId));
	let missingPositionCount = 0;
	const nodes: WorkflowGraphFlowNode[] = nodeEntries.map(([nodeId, nodeDefinition], index) => {
		const savedPosition = workflowPositions[nodeId] ?? readNodeUiPosition(nodeDefinition);
		const position = savedPosition ?? autoLayoutPosition(index, nodeEntries.length);
		if (!savedPosition) missingPositionCount += 1;
		return {
			id: nodeId,
			type: "workflowNode",
			position,
			data: {
				nodeId,
				label: workflowNodeLabel(nodeId, nodeDefinition),
				kind: workflowNodeKind(nodeDefinition),
				validationCount: countNodeDiagnostics(diagnostics, nodeId),
				isInitial: workflowInitialNodeIds(definition).includes(nodeId),
			},
		};
	});

	const edges: WorkflowGraphFlowEdge[] = Object.entries(readWorkflowEdgeDefinitions(definition)).flatMap(([edgeId, edgeDefinition]) => {
		const source = readEdgeEndpointNodeId(edgeDefinition.from);
		const target = readEdgeEndpointNodeId(edgeDefinition.to);
		if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
		const kind = typeof edgeDefinition.kind === "string" ? edgeDefinition.kind : "data";
		return [{
			id: edgeId,
			source,
			target,
			type: "smoothstep",
			label: kind,
			data: { edgeId, kind },
			markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" },
			style: { stroke: "#38bdf8", strokeWidth: 1.5 },
		}];
	});

	return {
		nodes,
		edges,
		usedAutoLayout: missingPositionCount > 0,
		missingPositionCount,
	};
}

function projectionHasElement(projection: WorkflowGraphProjection, selected: Exclude<SelectedGraphElement, undefined>): boolean {
	return selected.type === "node"
		? projection.nodes.some((node) => node.id === selected.id)
		: projection.edges.some((edge) => edge.id === selected.id);
}

function isWorkflowJsonObject(value: unknown): value is WorkflowJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkflowNodeDefinitions(definition: WorkflowDraftDefinition): Record<string, WorkflowJsonObject> {
	return readWorkflowObjectMap(definition.nodes);
}

function readWorkflowEdgeDefinitions(definition: WorkflowDraftDefinition): Record<string, WorkflowJsonObject> {
	return readWorkflowObjectMap(definition.edges);
}

function readWorkflowObjectMap(value: unknown): Record<string, WorkflowJsonObject> {
	if (!isWorkflowJsonObject(value)) return {};
	const result: Record<string, WorkflowJsonObject> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (isWorkflowJsonObject(entry)) result[key] = entry;
	}
	return result;
}

function workflowNodeKind(nodeDefinition: WorkflowJsonObject): string {
	return typeof nodeDefinition.kind === "string" ? nodeDefinition.kind : "node";
}

function workflowNodeLabel(nodeId: string, nodeDefinition: WorkflowJsonObject): string {
	return typeof nodeDefinition.label === "string" && nodeDefinition.label.trim()
		? nodeDefinition.label.trim()
		: `${capitalizeWorkflowLabel(workflowNodeKind(nodeDefinition))} ${nodeId}`;
}

function capitalizeWorkflowLabel(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function readWorkflowPositions(definition: WorkflowDraftDefinition): Record<string, GraphPosition> {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : undefined;
	const rawPositions = ui && isWorkflowJsonObject(ui.positions) ? ui.positions : undefined;
	if (!rawPositions) return {};
	const positions: Record<string, GraphPosition> = {};
	for (const [nodeId, value] of Object.entries(rawPositions)) {
		const position = readPosition(value);
		if (position) positions[nodeId] = position;
	}
	return positions;
}

function readNodeUiPosition(nodeDefinition: WorkflowJsonObject): GraphPosition | undefined {
	const ui = isWorkflowJsonObject(nodeDefinition.ui) ? nodeDefinition.ui : undefined;
	return ui ? readPosition(ui.position) : undefined;
}

function readPosition(value: unknown): GraphPosition | undefined {
	if (!isWorkflowJsonObject(value)) return undefined;
	const { x, y } = value;
	return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y) ? { x, y } : undefined;
}

function autoLayoutPosition(index: number, total: number): GraphPosition {
	if (total <= 0) return DEFAULT_GRAPH_POSITION;
	const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
	return {
		x: DEFAULT_GRAPH_POSITION.x + (index % columns) * GRAPH_COLUMN_GAP,
		y: DEFAULT_GRAPH_POSITION.y + Math.floor(index / columns) * GRAPH_ROW_GAP,
	};
}

function nextGraphNodePosition(nodes: WorkflowGraphFlowNode[]): GraphPosition {
	if (!nodes.length) return DEFAULT_GRAPH_POSITION;
	return {
		x: DEFAULT_GRAPH_POSITION.x + (nodes.length % 3) * GRAPH_COLUMN_GAP,
		y: DEFAULT_GRAPH_POSITION.y + Math.floor(nodes.length / 3) * GRAPH_ROW_GAP,
	};
}

function workflowInitialNodeIds(definition: WorkflowDraftDefinition): string[] {
	if (typeof definition.initial === "string") return [definition.initial];
	return Array.isArray(definition.initial) ? definition.initial.filter((entry): entry is string => typeof entry === "string") : [];
}

function countNodeDiagnostics(diagnostics: WorkflowDraftDiagnostic[], nodeId: string): number {
	return diagnostics.filter((diagnostic) => diagnostic.nodeId === nodeId || diagnostic.path?.startsWith(`$.nodes.${nodeId}`)).length;
}

function readEdgeEndpointNodeId(value: unknown): string | undefined {
	return isWorkflowJsonObject(value) && typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId.trim() : undefined;
}

function nextWorkflowNodeId(definition: WorkflowDraftDefinition, prefix: string): string {
	const nodes = readWorkflowNodeDefinitions(definition);
	if (!Object.hasOwn(nodes, prefix)) return prefix;
	let index = 2;
	while (Object.hasOwn(nodes, `${prefix}_${index}`)) index += 1;
	return `${prefix}_${index}`;
}

function nextWorkflowEdgeId(definition: WorkflowDraftDefinition, sourceId: string, targetId: string): string {
	const edges = readWorkflowEdgeDefinitions(definition);
	const base = `edge_${sourceId}_to_${targetId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
	if (!Object.hasOwn(edges, base)) return base;
	let index = 2;
	while (Object.hasOwn(edges, `${base}_${index}`)) index += 1;
	return `${base}_${index}`;
}

function addWorkflowGraphNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, profileId: string): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	const nextDefinition: WorkflowDraftDefinition = {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: createDefaultAgentNodeDefinition(nodeId, profileId),
		},
		edges: isWorkflowJsonObject(definition.edges) ? definition.edges : {},
	};
	if (!workflowInitialNodeIds(nextDefinition).length) nextDefinition.initial = nodeId;
	return writeWorkflowGraphPositions(nextDefinition, { ...readWorkflowPositions(definition), [nodeId]: position });
}

function addWorkflowGraphWorkflowNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, workflow: WorkflowVersionPickerOption): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	const nextDefinition: WorkflowDraftDefinition = {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: createDefaultWorkflowNodeDefinition(nodeId, workflow),
		},
		edges: isWorkflowJsonObject(definition.edges) ? definition.edges : {},
	};
	if (!workflowInitialNodeIds(nextDefinition).length) nextDefinition.initial = nodeId;
	return writeWorkflowGraphPositions(nextDefinition, { ...readWorkflowPositions(definition), [nodeId]: position });
}

function createDefaultAgentNodeDefinition(nodeId: string, profileId: string): WorkflowJsonObject {
	return {
		kind: "agent",
		runtime: "pibo",
		label: `Agent ${nodeId}`,
		profile: { kind: "fixed", id: profileId || "pibo-agent" },
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

function addWorkflowGraphEdge(definition: WorkflowDraftDefinition, edgeId: string, sourceId: string, targetId: string): WorkflowDraftDefinition {
	return {
		...definition,
		edges: {
			...readWorkflowEdgeDefinitions(definition),
			[edgeId]: {
				id: edgeId,
				from: { nodeId: sourceId },
				to: { nodeId: targetId },
				kind: "data",
			},
		},
	};
}

function deleteWorkflowGraphNode(definition: WorkflowDraftDefinition, nodeId: string): WorkflowDraftDefinition {
	const nodes = readWorkflowNodeDefinitions(definition);
	delete nodes[nodeId];
	const edges = Object.fromEntries(Object.entries(readWorkflowEdgeDefinitions(definition)).filter(([, edgeDefinition]) => {
		return readEdgeEndpointNodeId(edgeDefinition.from) !== nodeId && readEdgeEndpointNodeId(edgeDefinition.to) !== nodeId;
	}));
	const positions = readWorkflowPositions(definition);
	delete positions[nodeId];
	return normalizeInitialAfterDelete(writeWorkflowGraphPositions({ ...definition, nodes, edges }, positions), nodeId, Object.keys(nodes));
}

function deleteWorkflowGraphEdge(definition: WorkflowDraftDefinition, edgeId: string): WorkflowDraftDefinition {
	const edges = readWorkflowEdgeDefinitions(definition);
	delete edges[edgeId];
	return { ...definition, edges };
}

function normalizeInitialAfterDelete(definition: WorkflowDraftDefinition, deletedNodeId: string, remainingNodeIds: string[]): WorkflowDraftDefinition {
	const nextDefinition: WorkflowDraftDefinition = { ...definition };
	if (typeof nextDefinition.initial === "string") {
		if (nextDefinition.initial === deletedNodeId) {
			if (remainingNodeIds[0]) nextDefinition.initial = remainingNodeIds[0];
			else delete nextDefinition.initial;
		}
		return nextDefinition;
	}
	if (Array.isArray(nextDefinition.initial)) {
		const nextInitial = nextDefinition.initial.filter((entry) => entry !== deletedNodeId);
		if (nextInitial.length) nextDefinition.initial = nextInitial;
		else if (remainingNodeIds[0]) nextDefinition.initial = remainingNodeIds[0];
		else delete nextDefinition.initial;
	}
	return nextDefinition;
}

function writeWorkflowGraphPositions(definition: WorkflowDraftDefinition, positions: Record<string, GraphPosition>): WorkflowDraftDefinition {
	const ui = isWorkflowJsonObject(definition.ui) ? definition.ui : {};
	return {
		...definition,
		ui: {
			...ui,
			layout: "manual",
			positions,
		},
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
		outputKind: readWorkflowPortKind(definition.output, "text"),
		outputDescription: readWorkflowPortDescription(definition.output),
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
		input: createWorkflowPort(form.inputKind, form.inputDescription, definition.input),
		output: createWorkflowPort(form.outputKind, form.outputDescription, definition.output),
	};
	writeOptionalString(nextDefinition, "title", form.title);
	writeOptionalString(nextDefinition, "description", form.description);
	if (Object.keys(metadata).length) nextDefinition.metadata = metadata;
	else delete nextDefinition.metadata;
	return nextDefinition;
}

function createWorkflowNodeInspectorFormState(node: WorkflowJsonObject): WorkflowNodeInspectorFormState {
	const workflowId = typeof node.workflowId === "string" ? node.workflowId : "";
	const workflowVersion = typeof node.workflowVersion === "string" ? node.workflowVersion : "";
	return {
		label: typeof node.label === "string" ? node.label : "",
		description: typeof node.description === "string" ? node.description : "",
		inputKind: readOptionalWorkflowPortKind(node.input),
		inputDescription: readWorkflowPortDescription(node.input),
		outputKind: readOptionalWorkflowPortKind(node.output),
		outputDescription: readWorkflowPortDescription(node.output),
		profileId: readAgentProfileId(node.profile),
		promptTemplate: typeof node.promptTemplate === "string" ? node.promptTemplate : "",
		handlerId: typeof node.handler === "string" ? node.handler : "",
		workflowVersionKey: workflowId && workflowVersion ? workflowVersionSelectionKey(workflowId, workflowVersion) : "",
		humanPrompt: typeof node.prompt === "string" ? node.prompt : "",
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
	writeOptionalPort(nextNode, "input", form.inputKind, form.inputDescription, currentNode.input);
	writeOptionalPort(nextNode, "output", form.outputKind, form.outputDescription, currentNode.output);
	if (nodeKind === "agent") {
		nextNode.runtime = "pibo";
		if (form.profileId.trim()) nextNode.profile = { kind: "fixed", id: form.profileId.trim() };
		writeOptionalString(nextNode, "promptTemplate", form.promptTemplate);
	}
	if (nodeKind === "code") {
		nextNode.language = "typescript";
		if (form.handlerId.trim()) nextNode.handler = form.handlerId.trim();
	}
	if (nodeKind === "workflow") {
		const selection = parseWorkflowVersionKey(form.workflowVersionKey);
		if (selection) {
			nextNode.workflowId = selection.workflowId;
			nextNode.workflowVersion = selection.workflowVersion;
		}
	}
	if (nodeKind === "human") writeOptionalString(nextNode, "prompt", form.humanPrompt);
	return {
		...definition,
		nodes: {
			...nodes,
			[nodeId]: nextNode,
		},
	};
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
		adapterRef: transform && typeof transform.id === "string" ? transform.id : "",
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
		nextEdge.guard = {
			handler: guardHandler,
			...(Number.isInteger(priority) && priority >= 0 ? { priority } : {}),
		};
	} else {
		delete nextEdge.guard;
	}
	const adapterRef = form.adapterRef.trim();
	if (adapterRef) {
		const previousAdapter = isWorkflowJsonObject(currentEdge.adapter) ? currentEdge.adapter : {};
		nextEdge.adapter = {
			...previousAdapter,
			kind: "edgeAdapter",
			output: isWorkflowJsonObject(previousAdapter.output) ? previousAdapter.output : createWorkflowPort("text", "", undefined),
			transform: { kind: "adapter", language: "typescript", id: adapterRef },
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

function createWorkflowPort(kind: WorkflowPortKindSelection, description: string, previous: unknown): WorkflowJsonObject {
	const port: WorkflowJsonObject = { kind };
	writeOptionalString(port, "description", description);
	if (kind === "json") {
		const previousSchema = isWorkflowJsonObject(previous) && isWorkflowJsonObject(previous.schema) ? previous.schema : undefined;
		port.schema = previousSchema ?? { type: "object" };
	}
	return port;
}

function writeOptionalPort(target: WorkflowJsonObject, key: "input" | "output", kind: OptionalWorkflowPortKindSelection, description: string, previous: unknown): void {
	if (kind === "none") {
		delete target[key];
		return;
	}
	target[key] = createWorkflowPort(kind, description, previous);
}

function createNodePortRef(nodeId: string, portId: string): WorkflowJsonObject {
	const ref: WorkflowJsonObject = { nodeId };
	writeOptionalString(ref, "portId", portId);
	return ref;
}

function readAgentProfileId(value: unknown): string {
	return isWorkflowJsonObject(value) && value.kind === "fixed" && typeof value.id === "string" ? value.id : "";
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

function readInitialProfileRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("profileRef") ?? "";
}

function readInitialHandlerRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("handlerRef") ?? "";
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
