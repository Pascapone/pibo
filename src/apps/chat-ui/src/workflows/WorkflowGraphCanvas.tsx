import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
	Background,
	BaseEdge,
	Controls,
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
import type { PiboRoom } from "../types";
import { getNavigation } from "../api-chat-sessions";
import { Activity, CheckCircle2, Crosshair, Layers, Link2, Loader2, MousePointer2, MoveRight, Play, Plus, RotateCcw, Save, ScanSearch, SlidersHorizontal, Trash2, Wrench, X } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowHumanActionPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	patchWorkflowDraft,
	postWorkflowDraftManualTriggerRun,
	type WorkflowDraftDefinition,
	type WorkflowDraftRecord,
	type WorkflowManualTriggerRunResponse,
	type WorkflowRegisteredRefOption,
	type WorkflowValidationTrigger,
	type WorkflowVersionPickerOption,
} from "../api-workflows";
import {
	addWorkflowGraphEdge,
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
import { isWorkflowContextMenuInvocation, workflowContextMenuKeyAction } from "./workflow-context-menu-keyboard";
import {
	addWorkflowGraphAdapterNode,
	addWorkflowGraphAgentNode,
	addWorkflowGraphHumanNode,
	addWorkflowGraphManualTriggerNode,
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

export type WorkflowGraphStatusTone = "status" | "error";

type WorkflowGraphStatusSink = (message: string, tone?: WorkflowGraphStatusTone) => void;

type WorkflowGraphContextMenuTarget = NonNullable<SelectedGraphElement> | { type: "pane" };

type WorkflowGraphContextMenuState = {
	x: number;
	y: number;
	target: WorkflowGraphContextMenuTarget;
};

type ManualTriggerDialogState = {
	triggerNodeId: string;
	roomId?: string;
	input: string;
	status: "idle" | "running" | "completed" | "error";
	message?: string;
	output?: string;
	runId?: string;
	nodeCount?: number;
	edgeTransferCount?: number;
};

type WorkflowRunVisualState = {
	runningNodeIds: Set<string>;
	recentNodeIds: Set<string>;
	recentEdgeIds: Set<string>;
	lastRun?: WorkflowManualTriggerRunResponse;
};

type WorkflowGraphContextMenuEvent = {
	clientX: number;
	clientY: number;
	target?: EventTarget | null;
	preventDefault: () => void;
	stopPropagation: () => void;
};

const INSPECTOR_MIN_WIDTH = 360;
const INSPECTOR_KEYBOARD_STEP = 24;

function inspectorMaxWidth(): number {
	if (typeof window === "undefined") return 720;
	return Math.min(720, Math.max(440, window.innerWidth - 520));
}

function clampInspectorWidth(width: number): number {
	return Math.max(INSPECTOR_MIN_WIDTH, Math.min(inspectorMaxWidth(), width));
}

export function WorkflowGraphCanvas({
	draft,
	room,
	onDraftChange,
	renderInspectors,
	fullHeight = false,
	compactHeader = false,
	readOnly = false,
	onDraftDefinitionChange,
	onStatusMessage,
}: {
	draft: WorkflowDraftRecord;
	room?: PiboRoom;
	onDraftChange: (draft: WorkflowDraftRecord) => void;
	renderInspectors: (props: WorkflowGraphInspectorSlotProps) => ReactNode;
	fullHeight?: boolean;
	compactHeader?: boolean;
	readOnly?: boolean;
	onDraftDefinitionChange?: (definition: WorkflowDraftDefinition) => void;
	onStatusMessage?: WorkflowGraphStatusSink;
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
	const [contextMenu, setContextMenu] = useState<WorkflowGraphContextMenuState | undefined>();
	const [manualTriggerDialog, setManualTriggerDialog] = useState<ManualTriggerDialogState | undefined>();
	const [manualTriggerRooms, setManualTriggerRooms] = useState<PiboRoom[]>([]);
	const manualTriggerRoom = manualTriggerRooms.find((candidate) => candidate.id === manualTriggerDialog?.roomId) ?? room;

	useEffect(() => {
		if (!manualTriggerDialog?.triggerNodeId) return;
		let cancelled = false;
		getNavigation().then((navigation) => {
			if (cancelled) return;
			setManualTriggerRooms(navigation.rooms);
			setManualTriggerDialog((current) => current ? { ...current, roomId: current.roomId ?? navigation.room?.id ?? navigation.rooms[0]?.id } : current);
		}).catch((error: unknown) => {
			if (!cancelled) setManualTriggerDialog((current) => current ? { ...current, status: "error", message: error instanceof Error ? error.message : "Failed to load Rooms" } : current);
		});
		return () => { cancelled = true; };
	}, [manualTriggerDialog?.triggerNodeId]);
	const [runVisualState, setRunVisualState] = useState<WorkflowRunVisualState>(() => ({ runningNodeIds: new Set(), recentNodeIds: new Set(), recentEdgeIds: new Set() }));
	const graphCanvasRef = useRef<HTMLDivElement | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const contextMenuInvokerRef = useRef<HTMLElement | null>(null);
	const manualTriggerInputRef = useRef<HTMLTextAreaElement | null>(null);
	const manualTriggerInvokerRef = useRef<HTMLElement | null>(null);
	const runVisualTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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

	useEffect(() => () => {
		for (const timer of runVisualTimersRef.current) clearTimeout(timer);
		runVisualTimersRef.current = [];
	}, []);

	const clearRunVisualTimers = useCallback(() => {
		for (const timer of runVisualTimersRef.current) clearTimeout(timer);
		runVisualTimersRef.current = [];
	}, []);

	const showRecentRunVisuals = useCallback((response: WorkflowManualTriggerRunResponse) => {
		clearRunVisualTimers();
		const agentAttempts = response.nodeAttempts.filter((attempt) => attempt.kind === "agent");
		const steps = agentAttempts.length ? agentAttempts.map((attempt) => ({
			nodeIds: [attempt.nodeId],
			edgeIds: response.edgeTransfers.filter((transfer) => transfer.targetNodeId === attempt.nodeId).map((transfer) => transfer.edgeId),
		})) : [{
			nodeIds: response.nodeAttempts.map((attempt) => attempt.nodeId),
			edgeIds: response.edgeTransfers.map((transfer) => transfer.edgeId),
		}];
		const stepMs = 900;
		steps.forEach((step, index) => {
			const timer = setTimeout(() => {
				setRunVisualState({
					runningNodeIds: new Set(),
					recentNodeIds: new Set(step.nodeIds),
					recentEdgeIds: new Set(step.edgeIds),
					lastRun: response,
				});
			}, index * stepMs);
			runVisualTimersRef.current.push(timer);
		});
		const clearTimer = setTimeout(() => {
			setRunVisualState((current) => ({
				...current,
				runningNodeIds: new Set(),
				recentNodeIds: new Set(),
				recentEdgeIds: new Set(),
			}));
			runVisualTimersRef.current = [];
		}, Math.max(steps.length, 1) * stepMs + 600);
		runVisualTimersRef.current.push(clearTimer);
	}, [clearRunVisualTimers]);

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

	const publishStatus = useCallback((message: string, tone: WorkflowGraphStatusTone = "status") => {
		setStatusMessage(message);
		onStatusMessage?.(message, tone);
	}, [onStatusMessage]);

	const saveDefinition = useCallback(async (definition: WorkflowDraftDefinition, successMessage: string, options: { clearLayoutDirty?: boolean; editTrigger?: WorkflowValidationTrigger; layoutNodes?: WorkflowGraphFlowNode[]; layoutEdges?: WorkflowGraphFlowEdge[] } = {}) => {
		if (readOnly) {
			publishStatus("This workflow is read-only. Duplicate it before editing.", "error");
			return;
		}
		const definitionWithLayout = materializeGraphLayout(definition, options.layoutNodes, options.layoutEdges);
		setSaveState("saving");
		try {
			const response = await patchWorkflowDraft(draft.draftId, { definition: definitionWithLayout, editTrigger: options.editTrigger ?? "graph_edit" });
			onDraftChange(response.draft);
			setSaveState("saved");
			publishStatus(successMessage);
			if (options.clearLayoutDirty) setLayoutDirty(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to save graph edit";
			setSaveState("error");
			publishStatus(message, "error");
		}
	}, [draft.draftId, materializeGraphLayout, onDraftChange, publishStatus, readOnly]);

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
		publishStatus(`Layout updated for ${draggedNode.id}; it will be preserved on save or graph edits.`);
	}, [edges, nodes, publishStatus, readOnly, syncDraftLayout]);

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
		publishStatus(`Edge route updated for ${edgeId}; it will be preserved on save or graph edits.`);
	}, [nodes, publishStatus, readOnly, syncDraftLayout]);

	const contextMenuItems = useCallback(() => Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") ?? []), []);

	const closeContextMenu = useCallback((restoreFocus = false) => {
		const invoker = contextMenuInvokerRef.current;
		setContextMenu(undefined);
		if (restoreFocus) requestAnimationFrame(() => invoker?.focus());
	}, []);

	useLayoutEffect(() => {
		if (!contextMenu) return;
		contextMenuItems()[0]?.focus();
	}, [contextMenu, contextMenuItems]);

	useEffect(() => {
		if (!contextMenu) return undefined;
		const close = () => closeContextMenu();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			closeContextMenu(true);
		};
		document.addEventListener("click", close);
		document.addEventListener("contextmenu", close);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("click", close);
			document.removeEventListener("contextmenu", close);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [closeContextMenu, contextMenu]);

	const openContextMenuAt = useCallback((clientX: number, clientY: number, target: WorkflowGraphContextMenuTarget, invoker: HTMLElement | null) => {
		const rect = graphCanvasRef.current?.getBoundingClientRect();
		const rawX = rect ? clientX - rect.left : clientX;
		const rawY = rect ? clientY - rect.top : clientY;
		contextMenuInvokerRef.current = invoker;
		setContextMenu({
			x: Math.max(8, Math.min(rawX, (rect?.width ?? rawX) - 236)),
			y: Math.max(8, Math.min(rawY, (rect?.height ?? rawY) - 260)),
			target,
		});
	}, []);

	const openContextMenu = useCallback((event: WorkflowGraphContextMenuEvent, target: WorkflowGraphContextMenuTarget) => {
		event.preventDefault();
		event.stopPropagation();
		const eventElement = event.target instanceof Element ? event.target : null;
		const invoker = target.type === "pane"
			? graphCanvasRef.current
			: eventElement?.closest<HTMLElement>(target.type === "node" ? ".react-flow__node[data-id]" : ".react-flow__edge[data-id]") ?? null;
		openContextMenuAt(event.clientX, event.clientY, target, invoker);
	}, [openContextMenuAt]);

	const handleContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const items = contextMenuItems();
		const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
		const action = workflowContextMenuKeyAction(event.key, currentIndex, items.length);
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		event.nativeEvent.stopImmediatePropagation();
		if (action.type === "dismiss") closeContextMenu(true);
		else items[action.index]?.focus();
	};

	const handleGraphContextMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!isWorkflowContextMenuInvocation(event.key, event.shiftKey)) return;
		const eventElement = event.target instanceof Element ? event.target : null;
		const graphElement = eventElement?.closest<HTMLElement>(".react-flow__node[data-id], .react-flow__edge[data-id]");
		let target: WorkflowGraphContextMenuTarget | undefined;
		if (graphElement?.classList.contains("react-flow__node")) {
			const id = graphElement.dataset.id;
			if (id) target = { type: "node", id };
		} else if (graphElement?.classList.contains("react-flow__edge")) {
			const id = graphElement.dataset.id;
			if (id) target = { type: "edge", id };
		} else if (event.target === event.currentTarget) {
			target = { type: "pane" };
		}
		if (!target) return;
		event.preventDefault();
		event.stopPropagation();
		event.nativeEvent.stopImmediatePropagation();
		if (target.type !== "pane") setSelectedElement(target);
		const invoker = graphElement ?? graphCanvasRef.current;
		const rect = invoker?.getBoundingClientRect();
		openContextMenuAt(rect?.left ?? 0, rect?.bottom ?? 0, target, invoker ?? null);
	}, [openContextMenuAt]);

	const handleEdgeContextMenu = useCallback((edgeId: string, event: WorkflowGraphContextMenuEvent) => {
		setSelectedElement({ type: "edge", id: edgeId });
		setNodes((currentNodes) => currentNodes.map((node) => node.selected ? { ...node, selected: false } : node));
		setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: edge.id === edgeId })));
		openContextMenu(event, { type: "edge", id: edgeId });
	}, [openContextMenu]);

	const handleEdgeSelect = useCallback((edgeId: string) => {
		setSelectedElement({ type: "edge", id: edgeId });
		setNodes((currentNodes) => currentNodes.map((node) => node.selected ? { ...node, selected: false } : node));
		setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: edge.id === edgeId })));
		setContextMenu(undefined);
	}, []);

	const closeManualTriggerDialog = useCallback(() => {
		if (manualTriggerDialog?.status === "running") return;
		const invoker = manualTriggerInvokerRef.current;
		setManualTriggerDialog(undefined);
		requestAnimationFrame(() => invoker?.focus());
	}, [manualTriggerDialog?.status]);

	useLayoutEffect(() => {
		if (!manualTriggerDialog) return;
		manualTriggerInputRef.current?.focus();
	}, [manualTriggerDialog?.triggerNodeId]);

	const openManualTriggerDialog = useCallback((triggerNodeId: string) => {
		manualTriggerInvokerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setSelectedElement({ type: "node", id: triggerNodeId });
		setInspectorTab("status");
		setContextMenu(undefined);
		setManualTriggerDialog({ triggerNodeId, input: "", status: "idle", roomId: room?.id });
	}, [room]);

	const handleManualTriggerDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape" || manualTriggerDialog?.status === "running") return;
		event.preventDefault();
		event.stopPropagation();
		closeManualTriggerDialog();
	};

	const renderedNodes = useMemo<WorkflowGraphFlowNode[]>(() => nodes.map((node) => ({
		...node,
		data: {
			...node.data,
			onManualTriggerRun: openManualTriggerDialog,
			readOnly,
			runVisualState: runVisualState.runningNodeIds.has(node.id) ? "running" : runVisualState.recentNodeIds.has(node.id) ? "recent" : undefined,
		},
	})), [nodes, openManualTriggerDialog, readOnly, runVisualState.recentNodeIds, runVisualState.runningNodeIds]);

	const renderedEdges = useMemo<WorkflowGraphFlowEdge[]>(() => edges.map((edge) => ({
		...edge,
		data: {
			edgeId: edge.data?.edgeId ?? edge.id,
			kind: edge.data?.kind ?? "data",
			...edge.data,
			onRouteChange: handleEdgeRouteChange,
			onSelect: handleEdgeSelect,
			onContextMenu: handleEdgeContextMenu,
			readOnly,
			recentTransition: runVisualState.recentEdgeIds.has(edge.id),
		},
	})), [edges, handleEdgeContextMenu, handleEdgeRouteChange, handleEdgeSelect, readOnly, runVisualState.recentEdgeIds]);

	const addManualTriggerNode = () => {
		const nodeId = nextWorkflowNodeId(draft.definition, "trigger");
		const position = nextGraphNodePosition(nodes);
		const definition = addWorkflowGraphManualTriggerNode(draft.definition, nodeId, position);
		setSelectedElement({ type: "node", id: nodeId });
		void saveDefinition(definition, `Added manual trigger ${nodeId}.`);
	};

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

	const deleteGraphElement = useCallback((element: Exclude<SelectedGraphElement, undefined>) => {
		const definition = element.type === "node"
			? deleteWorkflowGraphNode(draft.definition, element.id)
			: deleteWorkflowGraphEdge(draft.definition, element.id);
		setSelectedElement(undefined);
		setContextMenu(undefined);
		void saveDefinition(definition, `Deleted ${element.type} ${element.id}.`);
	}, [draft.definition, saveDefinition]);

	const deleteSelectedElement = () => {
		if (!selectedElement) return;
		deleteGraphElement(selectedElement);
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (readOnly || saveState === "saving" || !selectedElement) return;
			if (event.key !== "Delete" && event.key !== "Backspace") return;
			if (isWorkflowEditableKeyboardTarget(event.target)) return;
			event.preventDefault();
			deleteGraphElement(selectedElement);
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [deleteGraphElement, readOnly, saveState, selectedElement]);

	const inspectGraphElement = (element: Exclude<SelectedGraphElement, undefined>) => {
		setSelectedElement(element);
		setInspectorTab("inspect");
		setContextMenu(undefined);
	};

	const setInitialNode = (nodeId: string) => {
		setSelectedElement({ type: "node", id: nodeId });
		setContextMenu(undefined);
		void saveDefinition({ ...draft.definition, initial: nodeId }, `Set ${nodeId} as the initial node.`);
	};

	const selectConnectEndpoint = (nodeId: string, endpoint: "source" | "target") => {
		if (endpoint === "source") setSourceNodeId(nodeId);
		else setTargetNodeId(nodeId);
		setSelectedElement({ type: "node", id: nodeId });
		setContextMenu(undefined);
		publishStatus(endpoint === "source" ? `Connect from ${nodeId}; choose a target node.` : `Connect to ${nodeId}; choose a source node.`);
	};

	const resetEdgeRoute = (edgeId: string) => {
		const nextEdges: WorkflowGraphFlowEdge[] = edges.map((edge) => {
			if (edge.id !== edgeId) return edge;
			const { route, ...dataWithoutRoute } = edge.data ?? {};
			void route;
			return { ...edge, data: { edgeId: edge.data?.edgeId ?? edge.id, kind: edge.data?.kind ?? "data", ...dataWithoutRoute } };
		});
		const edgeRoutes = readWorkflowEdgeRoutes(draft.definition);
		delete edgeRoutes[edgeId];
		const definition = writeWorkflowGraphLayout(draft.definition, readWorkflowPositions(draft.definition), edgeRoutes);
		setEdges(nextEdges);
		setSelectedElement({ type: "edge", id: edgeId });
		setContextMenu(undefined);
		void saveDefinition(definition, `Reset route for edge ${edgeId}.`, { layoutEdges: nextEdges });
	};

	const nudgeGraphNode = (nodeId: string, dx: number, dy: number) => {
		const nextNodes = nodes.map((node) => node.id === nodeId
			? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy }, selected: true }
			: node);
		setNodes(nextNodes);
		syncDraftLayout(nextNodes, edges);
		setSelectedElement({ type: "node", id: nodeId });
		setContextMenu(undefined);
		setLayoutDirty(true);
		publishStatus(`Moved node ${nodeId}; layout will be preserved on save or graph edits.`);
	};

	const nudgeSelectedNode = (dx: number, dy: number) => {
		if (selectedElement?.type !== "node") return;
		nudgeGraphNode(selectedElement.id, dx, dy);
	};

	const saveLayout = () => {
		const definition = materializeGraphLayout(draft.definition);
		void saveDefinition(definition, "Layout saved to workflow.ui.positions and workflow.ui.edgeRoutes without changing runtime semantics.", { clearLayoutDirty: true });
	};

	const handleConnect = useCallback((connection: Connection) => {
		if (readOnly || !connection.source || !connection.target) return;
		connectSelectedNodes(connection.source, connection.target);
	}, [connectSelectedNodes, readOnly]);

	const runManualTrigger = useCallback(async () => {
		if (!manualTriggerDialog || manualTriggerDialog.status === "running") return;
		const input = manualTriggerDialog.input;
		clearRunVisualTimers();
		const nodesById = readWorkflowNodeDefinitions(draft.definition);
		const initialAgentTargets = Object.values(readWorkflowEdgeDefinitions(draft.definition)).flatMap((edge) => {
			const source = readEdgeEndpointNodeId(edge.from);
			const target = readEdgeEndpointNodeId(edge.to);
			return source === manualTriggerDialog.triggerNodeId && target && workflowNodeKind(nodesById[target] ?? {}) === "agent" ? [target] : [];
		});
		setRunVisualState((current) => ({ ...current, runningNodeIds: new Set(initialAgentTargets.length ? initialAgentTargets : [manualTriggerDialog.triggerNodeId]), recentNodeIds: new Set(), recentEdgeIds: new Set() }));
		setManualTriggerDialog((current) => current ? { ...current, status: "running", message: "Running manual trigger…", output: undefined } : current);
		publishStatus(`Running manual trigger ${manualTriggerDialog.triggerNodeId}…`);
		try {
			const response = await postWorkflowDraftManualTriggerRun(draft.draftId, { triggerNodeId: manualTriggerDialog.triggerNodeId, input, ...(manualTriggerDialog.roomId ? { roomId: manualTriggerDialog.roomId } : {}) });
			onDraftChange(response.draft);
			showRecentRunVisuals(response);
			setManualTriggerDialog((current) => current ? {
				...current,
				status: response.ok ? "completed" : "error",
				message: response.ok ? "Manual trigger run completed." : response.error?.message ?? "Manual trigger run failed.",
				output: response.output,
				runId: response.run?.id,
				nodeCount: response.nodeAttempts.length,
				edgeTransferCount: response.edgeTransfers.length,
			} : current);
			publishStatus(response.ok ? `Manual trigger ${manualTriggerDialog.triggerNodeId} completed.` : response.error?.message ?? "Manual trigger run failed.", response.ok ? "status" : "error");
		} catch (error) {
			const message = error instanceof Error ? error.message : "Manual trigger run failed.";
			setRunVisualState((current) => ({ ...current, runningNodeIds: new Set(), recentNodeIds: new Set(), recentEdgeIds: new Set() }));
			setManualTriggerDialog((current) => current ? { ...current, status: "error", message } : current);
			publishStatus(message, "error");
		}
	}, [clearRunVisualTimers, draft.definition, draft.draftId, manualTriggerDialog, onDraftChange, publishStatus, showRecentRunVisuals]);

	const startInspectorResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		const handleMove = (moveEvent: MouseEvent) => {
			setInspectorWidth(clampInspectorWidth(window.innerWidth - moveEvent.clientX - 32));
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

	const handleInspectorResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		let nextWidth: number | undefined;
		if (event.key === "ArrowLeft") nextWidth = inspectorWidth + INSPECTOR_KEYBOARD_STEP;
		else if (event.key === "ArrowRight") nextWidth = inspectorWidth - INSPECTOR_KEYBOARD_STEP;
		else if (event.key === "Home") nextWidth = INSPECTOR_MIN_WIDTH;
		else if (event.key === "End") nextWidth = inspectorMaxWidth();
		if (nextWidth === undefined) return;
		event.preventDefault();
		setInspectorWidth(clampInspectorWidth(nextWidth));
	};

	const selectedDescription = describeSelectedGraphElement(draft.definition, selectedElement);
	const selectedNodeDefinition = selectedElement?.type === "node" ? readWorkflowNodeDefinitions(draft.definition)[selectedElement.id] : undefined;
	const isSaving = saveState === "saving";
	const editDisabled = isSaving || readOnly;
	const hasAtLeastTwoNodes = nodeIds.length > 1;
	const contextMenuTarget = contextMenu?.target;
	const contextMenuTitle = contextMenuTarget?.type === "node"
		? `Node ${contextMenuTarget.id}`
		: contextMenuTarget?.type === "edge"
			? `Edge ${contextMenuTarget.id}`
			: "Graph canvas";
	const contextMenuSubtitle = contextMenuTarget?.type === "node"
		? "Workflow node actions"
		: contextMenuTarget?.type === "edge"
			? "Workflow edge actions"
			: "Canvas actions";
	const inspectorTabs = [
		{ id: "build" as const, label: "Build", icon: Wrench },
		{ id: "inspect" as const, label: "Inspect", icon: SlidersHorizontal },
		{ id: "status" as const, label: "Status", icon: Activity },
	];

	return (
		<section className={`@container ${fullHeight ? "flex h-full min-h-0 flex-col" : "grid"} gap-4 rounded-sm border border-slate-800 bg-[#151f24]/70 p-4 @max-[520px]:p-3`} aria-labelledby="workflow-graph-canvas-title">
			<WorkflowGraphRunStyles />
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
				className={`${fullHeight ? "min-h-0 flex-1" : ""} grid min-w-0 grid-cols-[minmax(0,1fr)_var(--workflow-inspector-width)] gap-3 text-xs @max-[760px]:grid-cols-1 @max-[760px]:overflow-y-auto`}
				style={{ "--workflow-inspector-width": `${inspectorWidth}px` } as CSSProperties}
			>
				<div ref={graphCanvasRef} className={`${fullHeight ? "h-full min-h-[360px]" : "h-[420px]"} relative min-w-0 overflow-hidden rounded-sm border border-slate-800 bg-[#0c171c]`} aria-label="Workflow graph canvas" role="group" tabIndex={0} onKeyDownCapture={handleGraphContextMenuKeyDown}>
					<ReactFlow<WorkflowGraphFlowNode, WorkflowGraphFlowEdge>
						nodes={renderedNodes}
						edges={renderedEdges}
						nodeTypes={WORKFLOW_GRAPH_NODE_TYPES}
						edgeTypes={WORKFLOW_GRAPH_EDGE_TYPES}
						onNodesChange={handleNodesChange}
						onNodeDragStop={handleNodeDragStop}
						onEdgesChange={handleEdgesChange}
						onConnect={handleConnect}
						onNodeClick={(_, node) => setSelectedElement({ type: "node", id: node.id })}
						onEdgeClick={(_, edge) => handleEdgeSelect(edge.id)}
						onPaneClick={() => { setSelectedElement(undefined); setContextMenu(undefined); }}
						onNodeContextMenu={(event, node) => { setSelectedElement({ type: "node", id: node.id }); openContextMenu(event, { type: "node", id: node.id }); }}
						onEdgeContextMenu={(event, edge) => { setSelectedElement({ type: "edge", id: edge.id }); openContextMenu(event, { type: "edge", id: edge.id }); }}
						onPaneContextMenu={(event) => openContextMenu(event, { type: "pane" })}
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
					{manualTriggerDialog ? (
						<div className="absolute bottom-3 left-3 z-40 w-[360px] max-w-[calc(100%-1.5rem)] rounded-sm border border-emerald-700/70 bg-[#101d22] p-3 text-xs shadow-xl shadow-black/40" role="dialog" aria-label="Manual trigger test run" onKeyDown={handleManualTriggerDialogKeyDown}>
							<div className="flex items-start justify-between gap-3">
								<div>
									<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Manual trigger</div>
									<div className="mt-1 font-mono text-[11px] text-slate-400">{manualTriggerDialog.triggerNodeId}</div>
								</div>
								<button type="button" className="rounded-sm border border-slate-700 px-2 py-1 text-slate-400 transition hover:border-slate-500 hover:text-slate-100" onClick={closeManualTriggerDialog} disabled={manualTriggerDialog.status === "running"} aria-label="Close manual trigger dialog"><X size={13} /></button>
							</div>
							<label className="mt-3 grid gap-1 font-semibold text-slate-300">Room
								<select aria-label="Run Room" value={manualTriggerDialog.roomId ?? ""} disabled={manualTriggerDialog.status === "running"} className="min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-2 text-xs text-slate-100" onChange={(event) => setManualTriggerDialog((current) => current ? { ...current, roomId: event.target.value } : current)}>
									{manualTriggerRooms.length ? manualTriggerRooms.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>) : <option value={room?.id ?? ""}>{room?.name ?? "Loading Rooms…"}</option>}
								</select>
							</label>
							<label className="mt-3 grid gap-1 font-semibold text-slate-300">
								<span>Prompt input</span>
								<span className="text-[11px] text-slate-400">Workspace: {manualTriggerRoom?.workspace ?? "Default workspace"}</span>
								<textarea ref={manualTriggerInputRef} className="min-h-24 resize-y rounded-sm border border-slate-700 bg-[#151f24] px-2 py-2 font-mono text-[11px] text-slate-100 outline-none transition focus:border-emerald-500" value={manualTriggerDialog.input} onChange={(event) => setManualTriggerDialog((current) => current ? { ...current, input: event.target.value } : current)} disabled={manualTriggerDialog.status === "running"} placeholder="Write the text prompt for the first agent…" />
							</label>
							<div className="mt-3 flex gap-2">
								<button type="button" className="inline-flex flex-1 items-center justify-center gap-2 rounded-sm border border-emerald-600/70 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-100 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50" onClick={runManualTrigger} disabled={manualTriggerDialog.status === "running" || !manualTriggerDialog.roomId}>
									{manualTriggerDialog.status === "running" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
									Run trigger
								</button>
							</div>
							{manualTriggerDialog.message ? <div className={`mt-3 rounded-sm border p-2 text-[11px] leading-5 ${manualTriggerDialog.status === "error" ? "border-red-800 bg-red-950/30 text-red-200" : "border-emerald-800 bg-emerald-950/20 text-emerald-100"}`}>{manualTriggerDialog.message}</div> : null}
							{manualTriggerDialog.output ? <pre className="mt-2 max-h-32 overflow-auto rounded-sm border border-slate-800 bg-[#0c171c] p-2 text-[11px] leading-5 text-slate-200">{manualTriggerDialog.output}</pre> : null}
							{manualTriggerDialog.runId ? <div className="mt-2 text-[10px] text-slate-500">Run {manualTriggerDialog.runId} · {manualTriggerDialog.nodeCount ?? 0} node attempts · {manualTriggerDialog.edgeTransferCount ?? 0} edge transfers</div> : null}
						</div>
					) : null}
					{contextMenu ? (
						<div
							ref={contextMenuRef}
							className="absolute z-50 w-56 overflow-hidden rounded-sm border border-slate-700 bg-[#1a262b] py-1 text-xs shadow-xl shadow-black/40"
							style={{ left: contextMenu.x, top: contextMenu.y }}
							role="menu"
							aria-label="Workflow graph context menu"
							onKeyDown={handleContextMenuKeyDown}
							onClick={(event) => event.stopPropagation()}
							onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
						>
							<div className="border-b border-slate-800 px-3 py-2">
								<div className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">{contextMenuSubtitle}</div>
								<div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{contextMenuTitle}</div>
							</div>
							{contextMenuTarget?.type === "node" ? (
								<>
									<WorkflowGraphContextMenuItem icon={<ScanSearch size={14} />} label="Inspect node" onSelect={() => inspectGraphElement({ type: "node", id: contextMenuTarget.id })} />
									<WorkflowGraphContextMenuItem icon={<CheckCircle2 size={14} />} label="Set as initial" onSelect={() => setInitialNode(contextMenuTarget.id)} disabled={editDisabled} />
									<WorkflowGraphContextMenuItem icon={<Link2 size={14} />} label="Connect from this" onSelect={() => selectConnectEndpoint(contextMenuTarget.id, "source")} disabled={editDisabled} />
									<WorkflowGraphContextMenuItem icon={<Crosshair size={14} />} label="Connect to this" onSelect={() => selectConnectEndpoint(contextMenuTarget.id, "target")} disabled={editDisabled} />
									<WorkflowGraphContextMenuItem icon={<MoveRight size={14} />} label="Nudge right" onSelect={() => nudgeGraphNode(contextMenuTarget.id, 40, 0)} disabled={editDisabled} />
									<div className="my-1 border-t border-slate-800" />
									<WorkflowGraphContextMenuItem icon={<Trash2 size={14} />} label="Delete node" onSelect={() => deleteGraphElement({ type: "node", id: contextMenuTarget.id })} disabled={editDisabled} destructive />
								</>
							) : null}
							{contextMenuTarget?.type === "edge" ? (
								<>
									<WorkflowGraphContextMenuItem icon={<ScanSearch size={14} />} label="Inspect edge" onSelect={() => inspectGraphElement({ type: "edge", id: contextMenuTarget.id })} />
									<WorkflowGraphContextMenuItem icon={<RotateCcw size={14} />} label="Reset edge route" onSelect={() => resetEdgeRoute(contextMenuTarget.id)} disabled={editDisabled} />
									<div className="my-1 border-t border-slate-800" />
									<WorkflowGraphContextMenuItem icon={<Trash2 size={14} />} label="Delete edge" onSelect={() => deleteGraphElement({ type: "edge", id: contextMenuTarget.id })} disabled={editDisabled} destructive />
								</>
							) : null}
							{contextMenuTarget?.type === "pane" ? (
								<>
									<WorkflowGraphContextMenuItem icon={<Play size={14} />} label="Add Manual trigger" onSelect={() => { setContextMenu(undefined); addManualTriggerNode(); }} disabled={editDisabled} />
									<WorkflowGraphContextMenuItem icon={<Plus size={14} />} label="Add Agent node" onSelect={() => { setContextMenu(undefined); addAgentNode(); }} disabled={editDisabled} />
									<WorkflowGraphContextMenuItem icon={<Save size={14} />} label="Save layout" onSelect={() => { setContextMenu(undefined); saveLayout(); }} disabled={editDisabled || !nodes.length || !layoutDirty} />
									<WorkflowGraphContextMenuItem icon={<X size={14} />} label="Clear selection" onSelect={() => { setSelectedElement(undefined); setContextMenu(undefined); }} disabled={!selectedElement} />
								</>
							) : null}
						</div>
					) : null}
				</div>

				<aside className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-slate-800 bg-[#0f1b20] @max-[760px]:min-h-[360px]" aria-label="Workflow editor inspector panel">
					<button
						type="button"
						className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize border-l border-[#11a4d4]/20 bg-[#11a4d4]/10 opacity-60 transition hover:bg-[#11a4d4]/30 hover:opacity-100 focus:opacity-100 @max-[760px]:hidden"
						onMouseDown={startInspectorResize}
						onKeyDown={handleInspectorResizeKeyDown}
						role="separator"
						aria-orientation="vertical"
						aria-valuemin={INSPECTOR_MIN_WIDTH}
						aria-valuemax={inspectorMaxWidth()}
						aria-valuenow={inspectorWidth}
						aria-valuetext={`${inspectorWidth} pixels`}
						aria-label="Resize workflow inspector"
						title="Drag or use Left and Right Arrow to resize inspector"
					/>
					<header className="shrink-0 border-b border-slate-800 bg-[#101d22] p-2">
						<div className="min-w-0">
							<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Workflow editor</div>
							<div className="mt-0.5 truncate text-[11px] text-slate-500">Drag edge or use arrow keys to resize</div>
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
										aria-pressed={inspectorTab === tab.id}
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
								<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-emerald-700/70 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={addManualTriggerNode} disabled={editDisabled} title="Add Manual trigger node">
									<Play size={13} />
									Add Manual trigger
								</button>
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
								{selectedElement?.type === "node" && selectedNodeDefinition ? (
									<WorkflowNodeViewer nodeId={selectedElement.id} node={selectedNodeDefinition} lastRun={runVisualState.lastRun} visualState={runVisualState.runningNodeIds.has(selectedElement.id) ? "running" : runVisualState.recentNodeIds.has(selectedElement.id) ? "recent" : undefined} />
								) : null}
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

function WorkflowGraphRunStyles() {
	return (
		<style>{`
			@keyframes workflow-node-outline-flow {
				to { stroke-dashoffset: -32; }
			}
			@keyframes workflow-edge-flow {
				to { stroke-dashoffset: -24; }
			}
		`}</style>
	);
}

function WorkflowGraphContextMenuItem({ icon, label, onSelect, disabled = false, destructive = false }: { icon: ReactNode; label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean }) {
	return (
		<button
			type="button"
			role="menuitem"
			tabIndex={-1}
			onClick={onSelect}
			disabled={disabled}
			className={`flex w-full items-center gap-2 px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${destructive ? "text-red-300 hover:bg-red-500/10 hover:text-red-100" : "text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4]"}`}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate">{label}</span>
		</button>
	);
}

function WorkflowNodeViewer({ nodeId, node, lastRun, visualState }: { nodeId: string; node: Record<string, unknown>; lastRun?: WorkflowManualTriggerRunResponse; visualState?: "running" | "recent" }) {
	const kind = workflowNodeKind(node);
	const lastAttempt = lastRun?.nodeAttempts.findLast((attempt) => attempt.nodeId === nodeId);
	const input = isWorkflowJsonObject(node.input) ? node.input : undefined;
	const output = isWorkflowJsonObject(node.output) ? node.output : undefined;
	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow node viewer">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Node viewer</div>
					<div className="mt-1 truncate text-sm font-bold text-slate-100">{workflowNodeLabel(nodeId, node)}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-500">{nodeId}</div>
				</div>
				<div className="flex shrink-0 flex-wrap justify-end gap-1 text-[10px]">
					<WorkflowPill label={kind} />
					{visualState === "running" ? <WorkflowPill label="running" /> : null}
					{visualState === "recent" ? <WorkflowPill label="last run" /> : null}
				</div>
			</div>
			<div className="grid gap-2 text-[11px] leading-5 text-slate-300">
				<WorkflowViewerRow label="Input port" value={formatWorkflowPortSummary(input)} />
				<WorkflowViewerRow label="Output port" value={formatWorkflowPortSummary(output)} />
				{kind === "trigger" ? <WorkflowViewerRow label="Trigger" value={formatTriggerSummary(node.trigger)} /> : null}
				{kind === "agent" ? <WorkflowViewerRow label="Agent profile" value={formatAgentProfileSummary(node.profile)} /> : null}
				{kind === "agent" ? <WorkflowViewerRow label="Prompt source" value={typeof node.promptTemplate === "string" ? "promptTemplate" : node.promptBuilder ? "promptBuilder" : "input"} /> : null}
				{kind === "adapter" ? <WorkflowViewerRow label="Adapter" value={formatRegisteredRefSummary(node.handler)} /> : null}
				{kind === "workflow" ? <WorkflowViewerRow label="Nested workflow" value={`${typeof node.workflowId === "string" ? node.workflowId : "<missing>"}@${typeof node.workflowVersion === "string" ? node.workflowVersion : "latest"}`} /> : null}
				{kind === "human" ? <WorkflowViewerRow label="Human actions" value={Array.isArray(node.actions) ? `${node.actions.length} actions` : "none"} /> : null}
			</div>
			{lastAttempt ? (
				<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-300" aria-label="Last node run facts">
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Last run facts</div>
					<WorkflowViewerRow label="Attempt" value={`${lastAttempt.id} · ${lastAttempt.status}`} />
					{lastAttempt.piboSessionId ? <WorkflowViewerRow label="Pibo Session" value={lastAttempt.piboSessionId} /> : null}
					<WorkflowViewerValue label="Input" value={lastAttempt.input} />
					{lastAttempt.output !== undefined ? <WorkflowViewerValue label="Output" value={lastAttempt.output} /> : null}
				</div>
			) : (
				<div className="rounded-sm border border-dashed border-slate-700 bg-[#151f24]/50 p-2 text-[11px] leading-5 text-slate-500">No run facts for this node yet.</div>
			)}
		</div>
	);
}

function WorkflowViewerRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
			<div className="text-slate-500">{label}</div>
			<div className="min-w-0 break-words font-mono text-slate-200">{value}</div>
		</div>
	);
}

function WorkflowViewerValue({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<div className="text-slate-500">{label}</div>
			<pre className="max-h-28 overflow-auto rounded-sm border border-slate-800 bg-[#0c171c] p-2 whitespace-pre-wrap text-slate-200">{value}</pre>
		</div>
	);
}

function formatWorkflowPortSummary(port: Record<string, unknown> | undefined): string {
	if (!port) return "none";
	const kind = typeof port.kind === "string" ? port.kind : "unknown";
	const description = typeof port.description === "string" && port.description.trim() ? ` · ${port.description.trim()}` : "";
	return `${kind}${description}`;
}

function formatTriggerSummary(value: unknown): string {
	if (!isWorkflowJsonObject(value)) return "<missing>";
	const kind = typeof value.kind === "string" ? value.kind : "unknown";
	const mode = typeof value.mode === "string" ? value.mode : "default";
	return `${kind} · ${mode}`;
}

function formatAgentProfileSummary(value: unknown): string {
	if (!isWorkflowJsonObject(value)) return "<missing>";
	return typeof value.id === "string" ? value.id : "<missing>";
}

function formatRegisteredRefSummary(value: unknown): string {
	if (typeof value === "string") return value;
	if (!isWorkflowJsonObject(value)) return "<missing>";
	return typeof value.id === "string" ? value.id : "<missing>";
}

function WorkflowNodeRunOutline({ color }: { color: string }) {
	return (
		<svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
			<rect
				x="1"
				y="1"
				width="98"
				height="98"
				rx="2"
				fill="none"
				stroke={color}
				strokeWidth="2"
				strokeDasharray="9 7"
				vectorEffect="non-scaling-stroke"
				style={{ animation: "workflow-node-outline-flow 0.8s linear infinite" }}
			/>
		</svg>
	);
}

function WorkflowGraphNodeCard({ data, selected }: NodeProps<WorkflowGraphFlowNode>) {
	const isTrigger = data.kind === "trigger";
	const isRunHighlighted = data.runVisualState === "running" || data.runVisualState === "recent";
	const outlineColor = data.runVisualState === "running" ? "#facc15" : "#22c55e";
	return (
		<div className={`relative min-w-44 rounded-sm border px-3 py-2 shadow-lg shadow-black/20 ${isTrigger ? "bg-emerald-950/30" : "bg-[#15242b]"} ${isRunHighlighted ? "border-transparent" : selected ? "border-[#38bdf8]" : isTrigger ? "border-emerald-700/70" : "border-slate-700"}`}>
			{isRunHighlighted ? <WorkflowNodeRunOutline color={outlineColor} /> : null}
			{isTrigger ? null : <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-[#0f172a] !bg-[#38bdf8]" />}
			<div className="flex items-center justify-between gap-2">
				<div className="truncate text-xs font-bold text-slate-100">{data.label}</div>
				<span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${isTrigger ? "border-emerald-500/50 text-emerald-200" : "border-slate-700 text-slate-400"}`}>{data.kind}</span>
			</div>
			<div className="mt-1 font-mono text-[10px] text-slate-500">{data.nodeId}</div>
			<div className="mt-2 flex flex-wrap gap-1 text-[10px]">
				{data.isInitial ? <span className="rounded-full border border-[#11a4d4]/40 bg-[#11a4d4]/10 px-2 py-0.5 text-[#8bdcf4]">initial</span> : null}
				{data.validationCount ? <span className="rounded-full border border-amber-600/60 bg-amber-950/30 px-2 py-0.5 text-amber-200">{data.validationCount} diagnostics</span> : null}
			</div>
			{isTrigger ? (
				<button
					type="button"
					className="nodrag nopan mt-2 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-emerald-600/70 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-bold text-emerald-100 transition hover:border-emerald-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
					onClick={(event) => { event.preventDefault(); event.stopPropagation(); data.onManualTriggerRun?.(data.nodeId); }}
					disabled={data.readOnly}
					title="Run this manual trigger"
				>
					<Play size={12} />
					Play test
				</button>
			) : null}
			<Handle type="source" position={Position.Right} className={`!h-2.5 !w-2.5 !border-[#0f172a] ${isTrigger ? "!bg-emerald-400" : "!bg-[#38bdf8]"}`} />
		</div>
	);
}

function WorkflowGraphRoutableEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	markerEnd,
	markerStart,
	style,
	selected,
	data,
	label,
	labelStyle,
	labelShowBg,
	labelBgStyle,
	labelBgPadding,
	labelBgBorderRadius,
}: EdgeProps<WorkflowGraphFlowEdge>) {
	const { screenToFlowPosition } = useReactFlow();
	const [dragRoute, setDragRoute] = useState<WorkflowEdgeRoute | undefined>(undefined);
	const dragRouteRef = useRef<WorkflowEdgeRoute | undefined>(undefined);
	useEffect(() => {
		setDragRoute(undefined);
		dragRouteRef.current = undefined;
	}, [data?.route, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);
	const routedEdge = createWorkflowRoutedEdge({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		route: { ...(data?.route ?? {}), ...(dragRoute ?? {}) },
	});
	const isRecentTransition = data?.recentTransition === true;
	const edgeStyle = {
		...style,
		stroke: selected ? "#facc15" : isRecentTransition ? "#22c55e" : "#38bdf8",
		strokeWidth: selected ? 2.2 : isRecentTransition ? 2.4 : 1.5,
		...(isRecentTransition ? { strokeDasharray: "8 7", animation: "workflow-edge-flow 0.7s linear infinite" } : {}),
	};
	const handlePointerDown = (segment: WorkflowRoutedEdgeSegment, event: ReactPointerEvent<SVGPathElement>) => {
		if (data?.readOnly || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const startClientX = event.clientX;
		const startClientY = event.clientY;
		let didDrag = false;
		dragRouteRef.current = { ...(data?.route ?? {}), ...(dragRouteRef.current ?? dragRoute ?? {}) };
		const moveRoute = (moveEvent: PointerEvent) => {
			if (!didDrag && Math.hypot(moveEvent.clientX - startClientX, moveEvent.clientY - startClientY) < 3) return;
			didDrag = true;
			const position = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
			const nextValue = Math.round(segment.axis === "x" ? position.x : position.y);
			const nextRoute: WorkflowEdgeRoute = { ...(dragRouteRef.current ?? {}) };
			nextRoute[segment.routeKey] = nextValue;
			dragRouteRef.current = nextRoute;
			setDragRoute(nextRoute);
		};
		const stopRoute = () => {
			document.removeEventListener("pointermove", moveRoute);
			document.removeEventListener("pointerup", stopRoute);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			if (didDrag) data?.onRouteChange?.(id, dragRouteRef.current ?? {});
			else data?.onSelect?.(id);
		};
		document.body.style.cursor = segment.cursor;
		document.body.style.userSelect = "none";
		document.addEventListener("pointermove", moveRoute);
		document.addEventListener("pointerup", stopRoute);
	};

	return (
		<>
			<BaseEdge
				id={id}
				path={routedEdge.path}
				markerStart={markerStart}
				markerEnd={markerEnd}
				style={edgeStyle}
				interactionWidth={22}
				label={label}
				labelX={routedEdge.labelX}
				labelY={routedEdge.labelY}
				labelStyle={labelStyle}
				labelShowBg={labelShowBg}
				labelBgStyle={labelBgStyle}
				labelBgPadding={labelBgPadding}
				labelBgBorderRadius={labelBgBorderRadius}
			/>
			{routedEdge.draggableSegments.map((segment) => (
				<path
					key={segment.id}
					d={segment.path}
					fill="none"
					stroke="transparent"
					strokeWidth={22}
					className={`nopan ${segment.cursorClass}`}
					onClick={(event) => event.stopPropagation()}
					onPointerDown={(event) => handlePointerDown(segment, event)}
					onContextMenu={(event) => data?.onContextMenu?.(id, event)}
					aria-label={`Move edge route ${id}`}
				>
					<title>{segment.title}</title>
				</path>
			))}
		</>
	);
}

type WorkflowEdgeRouteKey = keyof WorkflowEdgeRoute;

type WorkflowGraphPoint = { x: number; y: number };

type WorkflowRoutedEdgeSegment = {
	id: string;
	start: WorkflowGraphPoint;
	end: WorkflowGraphPoint;
	path: string;
	axis: "x" | "y";
	routeKey: WorkflowEdgeRouteKey;
	cursor: "ew-resize" | "ns-resize";
	cursorClass: "cursor-ew-resize" | "cursor-ns-resize";
	title: string;
};

type WorkflowRoutedEdge = {
	path: string;
	labelX: number;
	labelY: number;
	draggableSegments: WorkflowRoutedEdgeSegment[];
};

type WorkflowRoutedEdgeInput = {
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
	route: WorkflowEdgeRoute;
};

const WORKFLOW_EDGE_OFFSET = 20;
const WORKFLOW_EDGE_BEND_RADIUS = 5;
const WORKFLOW_EDGE_MIN_DRAG_SEGMENT_LENGTH = 8;

function createWorkflowRoutedEdge(input: WorkflowRoutedEdgeInput): WorkflowRoutedEdge {
	const source = { x: input.sourceX, y: input.sourceY };
	const target = { x: input.targetX, y: input.targetY };
	const sourceDirection = workflowHandleDirection(input.sourcePosition);
	const targetDirection = workflowHandleDirection(input.targetPosition);
	const sourceGap = { x: source.x + sourceDirection.x * WORKFLOW_EDGE_OFFSET, y: source.y + sourceDirection.y * WORKFLOW_EDGE_OFFSET };
	const targetGap = { x: target.x + targetDirection.x * WORKFLOW_EDGE_OFFSET, y: target.y + targetDirection.y * WORKFLOW_EDGE_OFFSET };
	let points: WorkflowGraphPoint[];
	let draggableSegments: WorkflowRoutedEdgeSegment[];

	if (sourceDirection.x !== 0 && targetDirection.x !== 0 && sourceDirection.x * targetDirection.x === -1) {
		const sourceToTargetDirection = targetGap.x >= sourceGap.x ? 1 : -1;
		if (sourceDirection.x === sourceToTargetDirection) {
			const centerX = finiteRouteValue(input.route.centerX, (sourceGap.x + targetGap.x) / 2);
			points = [source, { x: centerX, y: source.y }, { x: centerX, y: target.y }, target];
			draggableSegments = [createRouteSegment("centerX", points[1], points[2])];
		} else {
			const sourceControlX = finiteRouteValue(input.route.sourceControlX, sourceGap.x);
			const targetControlX = finiteRouteValue(input.route.targetControlX, targetGap.x);
			const centerY = finiteRouteValue(input.route.centerY, (source.y + target.y) / 2);
			points = [
				source,
				{ x: sourceControlX, y: source.y },
				{ x: sourceControlX, y: centerY },
				{ x: targetControlX, y: centerY },
				{ x: targetControlX, y: target.y },
				target,
			];
			draggableSegments = [
				createRouteSegment("sourceControlX", points[1], points[2]),
				createRouteSegment("centerY", points[2], points[3]),
				createRouteSegment("targetControlX", points[3], points[4]),
			];
		}
	} else if (sourceDirection.y !== 0 && targetDirection.y !== 0 && sourceDirection.y * targetDirection.y === -1) {
		const sourceToTargetDirection = targetGap.y >= sourceGap.y ? 1 : -1;
		if (sourceDirection.y === sourceToTargetDirection) {
			const centerY = finiteRouteValue(input.route.centerY, (sourceGap.y + targetGap.y) / 2);
			points = [source, { x: source.x, y: centerY }, { x: target.x, y: centerY }, target];
			draggableSegments = [createRouteSegment("centerY", points[1], points[2])];
		} else {
			const sourceControlY = finiteRouteValue(input.route.sourceControlY, sourceGap.y);
			const targetControlY = finiteRouteValue(input.route.targetControlY, targetGap.y);
			const centerX = finiteRouteValue(input.route.centerX, (source.x + target.x) / 2);
			points = [
				source,
				{ x: source.x, y: sourceControlY },
				{ x: centerX, y: sourceControlY },
				{ x: centerX, y: targetControlY },
				{ x: target.x, y: targetControlY },
				target,
			];
			draggableSegments = [
				createRouteSegment("sourceControlY", points[1], points[2]),
				createRouteSegment("centerX", points[2], points[3]),
				createRouteSegment("targetControlY", points[3], points[4]),
			];
		}
	} else {
		const centerX = finiteRouteValue(input.route.centerX, (sourceGap.x + targetGap.x) / 2);
		const centerY = finiteRouteValue(input.route.centerY, (sourceGap.y + targetGap.y) / 2);
		points = [source, sourceGap, { x: centerX, y: sourceGap.y }, { x: centerX, y: centerY }, { x: targetGap.x, y: centerY }, targetGap, target];
		draggableSegments = createInteriorRouteSegments(points).map((segment, index) => ({
			...segment,
			id: `fallback-${index}`,
			routeKey: segment.axis === "x" ? "centerX" : "centerY",
		}));
	}

	const visibleDraggableSegments = draggableSegments.filter((segment) => routeSegmentLength(segment) >= WORKFLOW_EDGE_MIN_DRAG_SEGMENT_LENGTH);
	const labelSegment = longestWorkflowSegment(visibleDraggableSegments) ?? longestWorkflowPathSegment(points);
	return {
		path: workflowPathFromPoints(points),
		labelX: labelSegment ? (labelSegment.start.x + labelSegment.end.x) / 2 : (source.x + target.x) / 2,
		labelY: labelSegment ? (labelSegment.start.y + labelSegment.end.y) / 2 : (source.y + target.y) / 2,
		draggableSegments: visibleDraggableSegments,
	};
}

function workflowHandleDirection(position: Position): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
	if (position === Position.Left) return { x: -1, y: 0 };
	if (position === Position.Right) return { x: 1, y: 0 };
	if (position === Position.Top) return { x: 0, y: -1 };
	return { x: 0, y: 1 };
}

function finiteRouteValue(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createRouteSegment(routeKey: WorkflowEdgeRouteKey, start: WorkflowGraphPoint, end: WorkflowGraphPoint): WorkflowRoutedEdgeSegment {
	const isVertical = start.x === end.x;
	return {
		id: `${routeKey}-${start.x}-${start.y}-${end.x}-${end.y}`,
		start,
		end,
		path: `M ${start.x},${start.y} L ${end.x},${end.y}`,
		axis: isVertical ? "x" : "y",
		routeKey,
		cursor: isVertical ? "ew-resize" : "ns-resize",
		cursorClass: isVertical ? "cursor-ew-resize" : "cursor-ns-resize",
		title: isVertical ? "Drag vertical edge segment left or right" : "Drag horizontal edge segment up or down",
	};
}

function createInteriorRouteSegments(points: WorkflowGraphPoint[]): WorkflowRoutedEdgeSegment[] {
	return points.slice(1, -2).flatMap((start, index) => {
		const end = points[index + 2];
		if (!end || (start.x !== end.x && start.y !== end.y) || (start.x === end.x && start.y === end.y)) return [];
		return [createRouteSegment(start.x === end.x ? "centerX" : "centerY", start, end)];
	});
}

function workflowPathFromPoints(points: WorkflowGraphPoint[]): string {
	if (!points.length) return "";
	let path = `M ${points[0].x},${points[0].y}`;
	for (let index = 1; index < points.length - 1; index += 1) {
		path += workflowBendPath(points[index - 1], points[index], points[index + 1]);
	}
	path += ` L ${points[points.length - 1].x},${points[points.length - 1].y}`;
	return path;
}

function workflowBendPath(previous: WorkflowGraphPoint, current: WorkflowGraphPoint, next: WorkflowGraphPoint): string {
	const bendSize = Math.min(workflowDistance(previous, current) / 2, workflowDistance(current, next) / 2, WORKFLOW_EDGE_BEND_RADIUS);
	if ((previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y)) return ` L ${current.x},${current.y}`;
	if (previous.y === current.y) {
		const xDirection = previous.x < next.x ? -1 : 1;
		const yDirection = previous.y < next.y ? 1 : -1;
		return ` L ${current.x + bendSize * xDirection},${current.y} Q ${current.x},${current.y} ${current.x},${current.y + bendSize * yDirection}`;
	}
	const xDirection = previous.x < next.x ? 1 : -1;
	const yDirection = previous.y < next.y ? -1 : 1;
	return ` L ${current.x},${current.y + bendSize * yDirection} Q ${current.x},${current.y} ${current.x + bendSize * xDirection},${current.y}`;
}

function workflowDistance(start: WorkflowGraphPoint, end: WorkflowGraphPoint): number {
	return Math.hypot(end.x - start.x, end.y - start.y);
}

function routeSegmentLength(segment: WorkflowRoutedEdgeSegment): number {
	return workflowDistance(segment.start, segment.end);
}

function longestWorkflowSegment(segments: WorkflowRoutedEdgeSegment[]): { start: WorkflowGraphPoint; end: WorkflowGraphPoint } | undefined {
	let longest: { start: WorkflowGraphPoint; end: WorkflowGraphPoint; length: number } | undefined;
	for (const segment of segments) {
		const length = routeSegmentLength(segment);
		if (!longest || length > longest.length) longest = { start: segment.start, end: segment.end, length };
	}
	return longest;
}

function longestWorkflowPathSegment(points: WorkflowGraphPoint[]): { start: WorkflowGraphPoint; end: WorkflowGraphPoint } | undefined {
	let longest: { start: WorkflowGraphPoint; end: WorkflowGraphPoint; length: number } | undefined;
	for (let index = 0; index < points.length - 1; index += 1) {
		const start = points[index];
		const end = points[index + 1];
		const length = workflowDistance(start, end);
		if (!longest || length > longest.length) longest = { start, end, length };
	}
	return longest;
}

const WORKFLOW_GRAPH_NODE_TYPES = {
	workflowNode: WorkflowGraphNodeCard,
};

const WORKFLOW_GRAPH_EDGE_TYPES = {
	workflowEdge: WorkflowGraphRoutableEdge,
};

function isWorkflowEditableKeyboardTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
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
