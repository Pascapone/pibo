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
import { AlertTriangle, BookOpenText, Brain, CheckCheck, Code2, CopyPlus, Layers, Link2, Loader2, MousePointer2, MoveRight, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
	getWorkflowDraft,
	getWorkflowHandlerPicker,
	getWorkflowProfilePicker,
	patchWorkflowDraft,
	postWorkflowDuplicateDraft,
	postWorkflowNextDraft,
	type WorkflowDraftDefinition,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowHandlerPickerOption,
	type WorkflowHandlerPickerResponse,
	type WorkflowProfilePickerOption,
	type WorkflowProfilePickerResponse,
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

export function WorkflowsArea({ draftId }: { draftId?: string }) {
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
						{draftId ? <WorkflowBuilderDraftLoader draftId={draftId} /> : <WorkflowBuilderLanding />}
					</WorkflowSurfaceCard>
				</div>

				<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24] p-4 text-xs text-slate-400 md:grid-cols-3">
					<WorkflowPrinciple icon={CheckCheck} label="Pibo Workflow IR remains the source of truth" />
					<WorkflowPrinciple icon={CopyPlus} label="Code workflows can be duplicated into UI drafts" />
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
			<WorkflowBuilderAgentNodeEditor />
			<WorkflowBuilderCodeNodeEditor />
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

function WorkflowDraftEditorShell({ draft }: { draft: WorkflowDraftRecord }) {
	const [currentDraft, setCurrentDraft] = useState(draft);

	useEffect(() => {
		setCurrentDraft(draft);
	}, [draft]);

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

	const saveDefinition = useCallback(async (definition: WorkflowDraftDefinition, successMessage: string, options: { clearLayoutDirty?: boolean } = {}) => {
		setSaveState("saving");
		setStatusMessage(undefined);
		try {
			const response = await patchWorkflowDraft(draft.draftId, { definition, editTrigger: "graph_edit" });
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

function readInitialProfileRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("profileRef") ?? "";
}

function readInitialHandlerRef(): string {
	if (typeof window === "undefined") return "";
	return new URL(window.location.href).searchParams.get("handlerRef") ?? "";
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
