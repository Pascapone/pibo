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
import { Layers, Link2, Loader2, MousePointer2, MoveRight, Plus, Save, Trash2 } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowHumanActionPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	patchWorkflowDraft,
	type WorkflowDraftDefinition,
	type WorkflowDraftRecord,
	type WorkflowRegisteredRefOption,
	type WorkflowValidationTrigger,
	type WorkflowVersionPickerOption,
} from "../api-workflows";
import {
	addWorkflowGraphEdge,
	createWorkflowGraphProjection,
	deleteWorkflowGraphEdge,
	deleteWorkflowGraphNode,
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
	type SelectedGraphElement,
	type WorkflowGraphFlowEdge,
	type WorkflowGraphFlowNode,
} from "./workflow-graph-model";
import { createHumanActionChoice } from "./workflow-inspector-forms";
import {
	addWorkflowGraphAdapterNode,
	addWorkflowGraphAgentNode,
	addWorkflowGraphHumanNode,
	addWorkflowGraphWorkflowNode,
} from "./workflow-node-defaults";
import { humanActionOptionLabel, registeredRefOptionLabel, workflowVersionOptionKey, workflowVersionOptionLabel } from "./workflow-picker-labels";
import { WorkflowPill } from "./workflow-shared-ui";

export type WorkflowGraphInspectorSlotProps = {
	draft: WorkflowDraftRecord;
	selectedElement: SelectedGraphElement;
	nodeIds: string[];
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { clearLayoutDirty?: boolean; editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
};

export function WorkflowGraphCanvas({
	draft,
	onDraftChange,
	renderInspectors,
}: {
	draft: WorkflowDraftRecord;
	onDraftChange: (draft: WorkflowDraftRecord) => void;
	renderInspectors: (props: WorkflowGraphInspectorSlotProps) => ReactNode;
}) {
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
		const definition = addWorkflowGraphAgentNode(draft.definition, nodeId, position, defaultAgentProfileId);
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

	const connectSelectedNodes = useCallback((sourceId = sourceNodeId, targetId = targetNodeId) => {
		if (!sourceId || !targetId || sourceId === targetId) return;
		const edgeId = nextWorkflowEdgeId(draft.definition, sourceId, targetId);
		const definition = addWorkflowGraphEdge(draft.definition, edgeId, sourceId, targetId);
		setEdges((currentEdges) => addReactFlowEdge({ id: edgeId, source: sourceId, target: targetId, type: "smoothstep" }, currentEdges));
		setSelectedElement({ type: "edge", id: edgeId });
		void saveDefinition(definition, `Connected ${sourceId} to ${targetId}.`);
	}, [draft.definition, saveDefinition, sourceNodeId, targetNodeId]);

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

					{renderInspectors({
						draft,
						selectedElement,
						nodeIds,
						isSaving,
						onSaveDefinition: saveDefinition,
					})}

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
