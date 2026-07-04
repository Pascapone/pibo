import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
	Background,
	BaseEdge,
	Controls,
	EdgeLabelRenderer,
	Handle,
	MarkerType,
	MiniMap,
	Position,
	ReactFlow,
	addEdge as addReactFlowEdge,
	applyEdgeChanges,
	applyNodeChanges,
	useReactFlow,
	type Connection,
	type EdgeChange,
	type EdgeProps,
	type NodeChange,
	type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Activity, Layers, Link2, Loader2, MousePointer2, MoveRight, Plus, Save, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
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
	readWorkflowEdgeRoutes,
	readWorkflowNodeDefinitions,
	readWorkflowPositions,
	workflowNodeKind,
	workflowNodeLabel,
	writeWorkflowGraphLayout,
	type SelectedGraphElement,
	type WorkflowEdgeRoute,
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
	onDraftDefinitionChange?: (definition: WorkflowDraftDefinition) => void;
};

export function WorkflowGraphCanvas({
	draft,
	onDraftChange,
	renderInspectors,
	fullHeight = false,
	compactHeader = false,
	readOnly = false,
	onDraftDefinitionChange,
}: {
	draft: WorkflowDraftRecord;
	onDraftChange: (draft: WorkflowDraftRecord) => void;
	renderInspectors: (props: WorkflowGraphInspectorSlotProps) => ReactNode;
	fullHeight?: boolean;
	compactHeader?: boolean;
	readOnly?: boolean;
	onDraftDefinitionChange?: (definition: WorkflowDraftDefinition) => void;
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
	const [inspectorWidth, setInspectorWidth] = useState(440);
	const [inspectorTab, setInspectorTab] = useState<"build" | "inspect" | "status">("inspect");

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
		setSelectedElement((current) => current && projectionHasElement(projection, current) ? current : undefined);
	}, [projection]);

	useEffect(() => {
		setLayoutDirty(false);
	}, [draft.draftId, draft.revision]);

	const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);

	useEffect(() => {
		setSourceNodeId((current) => current && nodeIds.includes(current) ? current : nodeIds[0] ?? "");
		setTargetNodeId((current) => {
			if (current && nodeIds.includes(current) && current !== sourceNodeId) return current;
			return nodeIds.find((nodeId) => nodeId !== (sourceNodeId || nodeIds[0])) ?? "";
		});
	}, [nodeIds, sourceNodeId]);

	const materializeGraphLayout = useCallback((definition: WorkflowDraftDefinition, nextNodes = nodes, nextEdges = edges): WorkflowDraftDefinition => {
		const definitionNodeIds = new Set(Object.keys(readWorkflowNodeDefinitions(definition)));
		const definitionEdgeIds = new Set(Object.keys(readWorkflowEdgeDefinitions(definition)));
		const positions = Object.fromEntries(Object.entries(readWorkflowPositions(definition)).filter(([nodeId]) => definitionNodeIds.has(nodeId)));
		for (const node of nextNodes) {
			if (definitionNodeIds.has(node.id)) positions[node.id] = node.position;
		}
		const edgeRoutes = Object.fromEntries(Object.entries(readWorkflowEdgeRoutes(definition)).filter(([edgeId]) => definitionEdgeIds.has(edgeId)));
		for (const edge of nextEdges) {
			if (definitionEdgeIds.has(edge.id) && edge.data?.route) edgeRoutes[edge.id] = edge.data.route;
		}
		return writeWorkflowGraphLayout(definition, positions, edgeRoutes);
	}, [edges, nodes]);

	const syncDraftLayout = useCallback((nextNodes = nodes, nextEdges = edges) => {
		onDraftDefinitionChange?.(materializeGraphLayout(draft.definition, nextNodes, nextEdges));
	}, [draft.definition, edges, materializeGraphLayout, nodes, onDraftDefinitionChange]);

	const saveDefinition = useCallback(async (definition: WorkflowDraftDefinition, successMessage: string, options: { clearLayoutDirty?: boolean; editTrigger?: WorkflowValidationTrigger } = {}) => {
		if (readOnly) {
			setStatusMessage("This workflow is read-only. Duplicate it before editing.");
			return;
		}
		const definitionWithLayout = materializeGraphLayout(definition);
		setSaveState("saving");
		setStatusMessage(undefined);
		try {
			const response = await patchWorkflowDraft(draft.draftId, { definition: definitionWithLayout, editTrigger: options.editTrigger ?? "graph_edit" });
			onDraftChange(response.draft);
			setSaveState("saved");
			setStatusMessage(successMessage);
			if (options.clearLayoutDirty) setLayoutDirty(false);
		} catch (error) {
			setSaveState("error");
			setStatusMessage(error instanceof Error ? error.message : "Failed to save graph edit");
		}
	}, [draft.draftId, materializeGraphLayout, onDraftChange, readOnly]);

	const handleNodesChange = useCallback((changes: NodeChange<WorkflowGraphFlowNode>[]) => {
		if (readOnly) return;
		setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
		if (changes.some((change) => change.type === "position")) setLayoutDirty(true);
	}, [readOnly]);

	const handleNodeDragStop = useCallback((_: ReactMouseEvent, draggedNode: WorkflowGraphFlowNode) => {
		if (readOnly) return;
		const nextNodes = nodes.map((node) => node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node);
		setNodes(nextNodes);
		setLayoutDirty(true);
		syncDraftLayout(nextNodes, edges);
		setStatusMessage(`Layout updated for ${draggedNode.id}; it will be preserved on save or graph edits.`);
	}, [edges, nodes, readOnly, syncDraftLayout]);

	const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowGraphFlowEdge>[]) => {
		if (readOnly) return;
		setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
	}, [readOnly]);

	const handleEdgeRouteChange = useCallback((edgeId: string, route: WorkflowEdgeRoute) => {
		if (readOnly) return;
		setEdges((currentEdges) => {
			const nextEdges: WorkflowGraphFlowEdge[] = currentEdges.map((edge) => edge.id === edgeId
				? { ...edge, data: { edgeId: edge.data?.edgeId ?? edge.id, kind: edge.data?.kind ?? "data", ...edge.data, route } }
				: edge);
			syncDraftLayout(nodes, nextEdges);
			return nextEdges;
		});
		setLayoutDirty(true);
		setStatusMessage(`Edge route updated for ${edgeId}; it will be preserved on save or graph edits.`);
	}, [nodes, readOnly, syncDraftLayout]);

	const renderedEdges = useMemo<WorkflowGraphFlowEdge[]>(() => edges.map((edge) => ({
		...edge,
		data: {
			edgeId: edge.data?.edgeId ?? edge.id,
			kind: edge.data?.kind ?? "data",
			...edge.data,
			onRouteChange: handleEdgeRouteChange,
			readOnly,
		},
	})), [edges, handleEdgeRouteChange, readOnly]);

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
		setEdges((currentEdges) => addReactFlowEdge({ id: edgeId, source: sourceId, target: targetId, type: "workflowEdge" }, currentEdges));
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
		const nextNodes = nodes.map((node) => node.id === selectedElement.id
			? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, selected: true }
			: node);
		setNodes(nextNodes);
		syncDraftLayout(nextNodes, edges);
		setLayoutDirty(true);
		setStatusMessage(`Moved node ${selectedElement.id}; layout will be preserved on save or graph edits.`);
	};

	const saveLayout = () => {
		const definition = materializeGraphLayout(draft.definition);
		void saveDefinition(definition, "Layout saved to workflow.ui.positions and workflow.ui.edgeRoutes without changing runtime semantics.", { clearLayoutDirty: true });
	};

	const handleConnect = useCallback((connection: Connection) => {
		if (readOnly || !connection.source || !connection.target) return;
		connectSelectedNodes(connection.source, connection.target);
	}, [connectSelectedNodes, readOnly]);

	const startInspectorResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const handleMove = (moveEvent: MouseEvent) => {
			const maxWidth = Math.min(720, Math.max(420, window.innerWidth - 520));
			const nextWidth = Math.max(360, Math.min(maxWidth, window.innerWidth - moveEvent.clientX - 32));
			setInspectorWidth(nextWidth);
		};
		const stopResize = () => {
			document.removeEventListener("mousemove", handleMove);
			document.removeEventListener("mouseup", stopResize);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		document.addEventListener("mousemove", handleMove);
		document.addEventListener("mouseup", stopResize);
	}, []);

	const selectedDescription = describeSelectedGraphElement(draft.definition, selectedElement);
	const isSaving = saveState === "saving";
	const editDisabled = isSaving || readOnly;
	const hasAtLeastTwoNodes = nodeIds.length > 1;
	const inspectorTabs = [
		{ id: "build" as const, label: "Build", icon: Wrench },
		{ id: "inspect" as const, label: "Inspect", icon: SlidersHorizontal },
		{ id: "status" as const, label: "Status", icon: Activity },
	];

	return (
		<section className={`${fullHeight ? "flex h-full min-h-0 flex-col" : "grid"} gap-4 rounded-sm border border-slate-800 bg-[#151f24]/70 p-4`} aria-labelledby="workflow-graph-canvas-title">
			{compactHeader ? null : <div className="flex flex-wrap items-start justify-between gap-3">
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
			</div>}

			<div
				className={`${fullHeight ? "min-h-0 flex-1" : ""} grid min-w-0 gap-3 text-xs`}
				style={{ gridTemplateColumns: `minmax(0, 1fr) ${inspectorWidth}px` }}
			>
				<div className={`${fullHeight ? "h-full min-h-[360px]" : "h-[420px]"} min-w-0 overflow-hidden rounded-sm border border-slate-800 bg-[#0c171c]`} aria-label="Workflow graph canvas">
					<ReactFlow<WorkflowGraphFlowNode, WorkflowGraphFlowEdge>
						nodes={nodes}
						edges={renderedEdges}
						nodeTypes={WORKFLOW_GRAPH_NODE_TYPES}
						edgeTypes={WORKFLOW_GRAPH_EDGE_TYPES}
						onNodesChange={handleNodesChange}
						onNodeDragStop={handleNodeDragStop}
						onEdgesChange={handleEdgesChange}
						onConnect={handleConnect}
						onNodeClick={(_, node) => setSelectedElement({ type: "node", id: node.id })}
						onEdgeClick={(_, edge) => setSelectedElement({ type: "edge", id: edge.id })}
						onPaneClick={() => setSelectedElement(undefined)}
						fitView
						minZoom={0.35}
						maxZoom={1.6}
						colorMode="dark"
						nodesDraggable={!readOnly}
						nodesConnectable={!readOnly}
						edgesReconnectable={!readOnly}
						defaultEdgeOptions={{ type: "workflowEdge", markerEnd: { type: MarkerType.ArrowClosed, color: "#38bdf8" } }}
					>
						<Background color="#1f3a44" gap={18} />
						<MiniMap pannable zoomable nodeColor={(node) => node.selected ? "#38bdf8" : "#1e293b"} />
						<Controls showInteractive={false} />
					</ReactFlow>
				</div>

				<aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-slate-800 bg-[#0f1b20]" aria-label="Workflow editor inspector panel">
					<button
						type="button"
						className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize border-l border-[#11a4d4]/20 bg-[#11a4d4]/10 opacity-60 transition hover:bg-[#11a4d4]/30 hover:opacity-100"
						onMouseDown={startInspectorResize}
						aria-label="Resize workflow inspector"
						title="Drag to resize inspector"
					/>
					<header className="shrink-0 border-b border-slate-800 bg-[#101d22] p-2">
						<div className="min-w-0">
							<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Workflow editor</div>
							<div className="mt-0.5 truncate text-[11px] text-slate-500">Drag edge to resize</div>
						</div>
						<nav className="mt-2 grid grid-cols-3 gap-1" aria-label="Workflow inspector sections">
							{inspectorTabs.map((tab) => {
								const Icon = tab.icon;
								return (
									<button
										key={tab.id}
										type="button"
										className={`inline-flex items-center justify-center gap-2 rounded-sm border px-2 py-2 text-[11px] font-semibold transition ${inspectorTab === tab.id ? "border-[#11a4d4]/70 bg-[#11a4d4]/10 text-[#8bdcf4]" : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-100"}`}
										onClick={() => setInspectorTab(tab.id)}
										title={tab.label}
									>
										<Icon size={14} />
										<span>{tab.label}</span>
									</button>
								);
							})}
						</nav>
					</header>

					<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
						{inspectorTab === "build" ? (
							readOnly ? (
								<div className="rounded-sm border border-amber-700/60 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100" aria-label="Read-only workflow graph">
									This published workflow is read-only. Duplicate it from the top bar to edit your own copy.
								</div>
							) : <div className="grid min-w-0 gap-2" aria-label="Graph edit controls">
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={addAgentNode} disabled={editDisabled} title="Add Agent node">
									<Plus size={13} />
									Add Agent node
								</button>
								<label className="grid min-w-0 gap-1 font-semibold text-slate-300">
									<span>Nested workflow version</span>
									<select aria-label="Nested workflow version" className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={selectedWorkflowVersionKey} onChange={(event) => setSelectedWorkflowVersionKey(event.target.value)} disabled={editDisabled || !workflowVersionOptions.length}>
										{workflowVersionOptions.length ? workflowVersionOptions.map((option) => (
											<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
										)) : <option value="">No published workflow versions</option>}
									</select>
								</label>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={addWorkflowNode} disabled={editDisabled || !selectedNestedWorkflowOption} title="Add Workflow node">
									<Layers size={13} />
									Add Workflow node
								</button>
								<label className="grid min-w-0 gap-1 font-semibold text-slate-300">
									<span>Adapter ref</span>
									<select aria-label="Adapter node ref" className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={selectedAdapterRef} onChange={(event) => setSelectedAdapterRef(event.target.value)} disabled={editDisabled || !adapterOptions.length}>
										{adapterOptions.length ? adapterOptions.map((option) => (
											<option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>
										)) : <option value="">No registered adapters</option>}
									</select>
								</label>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={addAdapterNode} disabled={editDisabled || !selectedAdapterRef} title="Add Adapter node">
									<Link2 size={13} />
									Add Adapter node
								</button>
								<label className="grid min-w-0 gap-1 font-semibold text-slate-300">
									<span>Human action ref</span>
									<select aria-label="Human node action ref" className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={selectedHumanActionRef} onChange={(event) => setSelectedHumanActionRef(event.target.value)} disabled={editDisabled || !humanActionOptions.length}>
										{humanActionOptions.length ? humanActionOptions.map((option) => (
											<option key={option.id} value={option.id}>{humanActionOptionLabel(option)}</option>
										)) : <option value="">No registered human actions</option>}
									</select>
								</label>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={addHumanNode} disabled={editDisabled || !selectedHumanActionRef} title="Add Human node">
									<MousePointer2 size={13} />
									Add Human node
								</button>
								<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-500">
									Workflow nodes store only a workflow id/version reference. Adapter and human nodes store only registered deterministic adapter or human action refs.
								</div>
								<div className="grid gap-2">
									<label className="grid min-w-0 gap-1 font-semibold text-slate-300">
										<span>From</span>
										<select aria-label="Connect from node" className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)} disabled={editDisabled || !hasAtLeastTwoNodes}>{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}</select>
									</label>
									<label className="grid min-w-0 gap-1 font-semibold text-slate-300">
										<span>To</span>
										<select aria-label="Connect to node" className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} disabled={editDisabled || !hasAtLeastTwoNodes}>{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}</select>
									</label>
								</div>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => connectSelectedNodes()} disabled={editDisabled || !sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId} title="Connect nodes"><Link2 size={13} />Connect nodes</button>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => nudgeSelectedNode(40, 0)} disabled={editDisabled || selectedElement?.type !== "node"} title="Nudge selected node"><MoveRight size={13} />Nudge selected node</button>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-500/70 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={deleteSelectedElement} disabled={editDisabled || !selectedElement} title="Delete selected"><Trash2 size={13} />Delete selected</button>
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-emerald-700/70 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveLayout} disabled={editDisabled || !nodes.length || !layoutDirty} title="Save layout">{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save layout</button>
							</div>
						) : null}

						{inspectorTab === "inspect" ? (
							<div className="grid gap-3">
								<div className="min-w-0 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Selected graph element">
									<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Selected graph element</div>
									<div className="mt-2 text-xs leading-5 text-slate-300">{selectedDescription}</div>
								</div>
								{renderInspectors({
									draft,
									selectedElement,
									nodeIds,
									isSaving,
									onSaveDefinition: saveDefinition,
									onDraftDefinitionChange,
								})}
							</div>
						) : null}

						{inspectorTab === "status" ? (
							<div className="grid gap-3">
								{readOnly ? (
									<div className="rounded-sm border border-amber-700/60 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100" aria-label="Read-only workflow graph">
										This published workflow is read-only. Duplicate it from the top bar to edit your own copy.
									</div>
								) : null}
								<div className="rounded-sm border border-slate-800 bg-[#101d22] p-3 text-xs leading-5 text-slate-300">
									<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Graph summary</div>
									<div className="mt-2 grid gap-1">
										<div>{nodes.length} nodes</div>
										<div>{edges.length} edges</div>
										<div>{projection.usedAutoLayout ? `Auto layout; ${projection.missingPositionCount} nodes need saved positions.` : "Manual positions saved."}</div>
									</div>
								</div>
								{statusMessage ? (
									<div className={`rounded-sm border p-3 text-xs leading-5 ${saveState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role="status">
										{statusMessage}
									</div>
								) : <div className="rounded-sm border border-slate-800 bg-[#101d22] p-3 text-xs leading-5 text-slate-500">No recent editor status message.</div>}
							</div>
						) : null}
					</div>
				</aside>
			</div>

			{compactHeader ? null : <div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3 text-[11px] leading-5 text-slate-500">
				Automatic layout is a canvas projection only for workflows without saved positions. Node positions and edge routes are preserved when you connect, add, inspect, or save graph edits. Saving layout writes only display metadata and does not change nodes, edges, ports, guards, adapters, runtime routing, or validation semantics.
			</div>}
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

function WorkflowGraphRoutableEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	markerEnd,
	style,
	selected,
	data,
	label,
}: EdgeProps<WorkflowGraphFlowEdge>) {
	const { screenToFlowPosition } = useReactFlow();
	const routeCenterX = data?.route?.centerX;
	const centerX = typeof routeCenterX === "number" && Number.isFinite(routeCenterX)
		? routeCenterX
		: sourceX + (targetX - sourceX) / 2;
	const centerY = typeof data?.route?.centerY === "number" && Number.isFinite(data.route.centerY)
		? data.route.centerY
		: sourceY + (targetY - sourceY) / 2;
	const path = `M ${sourceX},${sourceY} L ${centerX},${sourceY} L ${centerX},${targetY} L ${targetX},${targetY}`;
	const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
		if (data?.readOnly) return;
		event.preventDefault();
		event.stopPropagation();
		const moveRoute = (moveEvent: PointerEvent) => {
			const position = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
			data?.onRouteChange?.(id, { centerX: Math.round(position.x) });
		};
		const stopRoute = () => {
			document.removeEventListener("pointermove", moveRoute);
			document.removeEventListener("pointerup", stopRoute);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
		document.body.style.cursor = "ew-resize";
		document.body.style.userSelect = "none";
		document.addEventListener("pointermove", moveRoute);
		document.addEventListener("pointerup", stopRoute);
	};

	return (
		<>
			<BaseEdge
				id={id}
				path={path}
				markerEnd={markerEnd}
				style={{ ...style, stroke: selected ? "#facc15" : "#38bdf8", strokeWidth: selected ? 2.2 : 1.5 }}
				interactionWidth={22}
			/>
			<EdgeLabelRenderer>
				<div
					className="nodrag nopan absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-slate-700 bg-[#0f1b20]/95 px-1.5 py-1 text-[10px] text-slate-300 shadow-lg shadow-black/30"
					style={{ transform: `translate(-50%, -50%) translate(${centerX}px, ${centerY}px)`, pointerEvents: "all" }}
				>
					<button
						type="button"
						className="h-4 w-4 cursor-ew-resize rounded-full border border-[#38bdf8]/70 bg-[#102a33] text-[#8bdcf4] transition hover:border-[#8bdcf4] hover:bg-[#123847] disabled:cursor-default disabled:opacity-50"
						onPointerDown={handlePointerDown}
						disabled={Boolean(data?.readOnly)}
						aria-label={`Move edge route ${id}`}
						title="Drag to move this edge route"
					/>
					<span>{typeof label === "string" ? label : data?.kind}</span>
				</div>
			</EdgeLabelRenderer>
		</>
	);
}

const WORKFLOW_GRAPH_NODE_TYPES = {
	workflowNode: WorkflowGraphNodeCard,
};

const WORKFLOW_GRAPH_EDGE_TYPES = {
	workflowEdge: WorkflowGraphRoutableEdge,
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
