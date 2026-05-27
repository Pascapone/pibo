import type { WorkflowDraftDefinition, WorkflowRegisteredRefOption } from "../api-workflows";
import {
	isWorkflowJsonObject,
	readWorkflowEdgeDefinitions,
	readWorkflowNodeDefinitions,
	workflowNodeKind,
	type WorkflowJsonObject,
} from "./workflow-graph-model";

export const DEFAULT_WORKFLOW_JSON_SCHEMA: WorkflowJsonObject = { type: "object", properties: {}, required: [], additionalProperties: false };
export const WORKFLOW_STATE_SCOPES: WorkflowStateScope[] = ["global", "local", "edge"];
const DEFAULT_LOCAL_STATE_PATHS = ["draft", "notes", "result"];
const DEFAULT_EDGE_STATE_PATHS = ["payload", "previous", "resume"];
export const DEFAULT_WRITE_STATE_SCOPES: WorkflowStateScope[] = ["global", "local"];

export type WorkflowPortKindSelection = "text" | "json";
export type OptionalWorkflowPortKindSelection = "none" | WorkflowPortKindSelection;
export type WorkflowStateScope = "global" | "local" | "edge";
export type WorkflowStateAccessFormState = {
	reads: string[];
	writes: string[];
	readScope: WorkflowStateScope;
	readPath: string;
	writeScope: WorkflowStateScope;
	writePath: string;
};
export type WorkflowHumanActionFormChoice = { id: string; kind?: string };
export type WorkflowHumanTimeoutKind = "none" | "milliseconds" | "seconds" | "minutes" | "iso8601";
export type WorkflowNodeInspectorFormState = {
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
export type WorkflowEdgeInspectorFormState = {
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

export function workflowNodeStateAccessChanged(node: WorkflowJsonObject, form: WorkflowNodeInspectorFormState): boolean {
	return workflowStateAccessChanged(node.state, form.stateAccess);
}

export function workflowStateAccessChanged(value: unknown, form: WorkflowStateAccessFormState): boolean {
	const current = createWorkflowStateAccessFormState(value);
	return JSON.stringify({ reads: current.reads, writes: current.writes }) !== JSON.stringify({ reads: form.reads, writes: form.writes });
}

export function createWorkflowStateAccessFormState(value: unknown): WorkflowStateAccessFormState {
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

export function workflowStatePathOptions(definition: WorkflowDraftDefinition, scope: WorkflowStateScope, selectedEntries: string[]): string[] {
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

export function readWorkflowGlobalStatePaths(definition: WorkflowDraftDefinition): string[] {
	const state = isWorkflowJsonObject(definition.state) ? definition.state : undefined;
	const global = state && isWorkflowJsonObject(state.global) ? state.global : undefined;
	return global ? Object.keys(global).sort() : [];
}

export function sanitizeWorkflowStatePathInput(value: string): string {
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

export function createWorkflowNodeInspectorFormState(node: WorkflowJsonObject): WorkflowNodeInspectorFormState {
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

export function applyWorkflowNodeInspectorForm(definition: WorkflowDraftDefinition, nodeId: string, form: WorkflowNodeInspectorFormState): WorkflowDraftDefinition {
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

export function createWorkflowEdgeInspectorFormState(edge: WorkflowJsonObject, nodeIds: string[]): WorkflowEdgeInspectorFormState {
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

export function applyWorkflowEdgeInspectorForm(definition: WorkflowDraftDefinition, edgeId: string, form: WorkflowEdgeInspectorFormState): WorkflowDraftDefinition {
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

export function cloneWorkflowJsonObject(value: WorkflowJsonObject): WorkflowJsonObject {
	return JSON.parse(JSON.stringify(value)) as WorkflowJsonObject;
}

export function readWorkflowPortKind(value: unknown, fallback: WorkflowPortKindSelection): WorkflowPortKindSelection {
	if (!isWorkflowJsonObject(value)) return fallback;
	return value.kind === "json" ? "json" : "text";
}

function readOptionalWorkflowPortKind(value: unknown): OptionalWorkflowPortKindSelection {
	if (!isWorkflowJsonObject(value)) return "none";
	return readWorkflowPortKind(value, "text");
}

export function readWorkflowPortDescription(value: unknown): string {
	return isWorkflowJsonObject(value) && typeof value.description === "string" ? value.description : "";
}

export function formatWorkflowPortSchemaText(value: unknown): string {
	const schema = isWorkflowJsonObject(value) && value.schema !== undefined ? value.schema : DEFAULT_WORKFLOW_JSON_SCHEMA;
	return formatWorkflowSchemaText(schema);
}

export function formatWorkflowSchemaText(value: unknown): string {
	try {
		return JSON.stringify(value ?? DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2) ?? JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2);
	} catch {
		return JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2);
	}
}

export function parseWorkflowSchemaText(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) return cloneWorkflowJsonObject(DEFAULT_WORKFLOW_JSON_SCHEMA);
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

export function createWorkflowPort(kind: WorkflowPortKindSelection, description: string, previous: unknown, schemaText?: string): WorkflowJsonObject {
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

export function createRegisteredAdapterRef(adapterRef: string): WorkflowJsonObject {
	return { kind: "adapter", language: "typescript", id: adapterRef };
}

function readHumanActionChoices(value: unknown): WorkflowHumanActionFormChoice[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry): WorkflowHumanActionFormChoice[] => {
		if (!isWorkflowJsonObject(entry) || typeof entry.id !== "string" || !entry.id.trim()) return [];
		return [createHumanActionChoice(entry.id, typeof entry.kind === "string" ? entry.kind : undefined)];
	});
}

export function createHumanActionChoice(id: string, kind?: string): WorkflowHumanActionFormChoice {
	return kind ? { id, kind } : { id };
}

export function createHumanActionObject(action: WorkflowHumanActionFormChoice): WorkflowJsonObject {
	return action.kind ? { id: action.id, kind: action.kind } : { id: action.id };
}

export function toggleHumanActionChoice(current: WorkflowHumanActionFormChoice[], option: WorkflowRegisteredRefOption, checked: boolean): WorkflowHumanActionFormChoice[] {
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

export function writeOptionalString(target: WorkflowJsonObject, key: string, value: string): void {
	const trimmed = value.trim();
	if (trimmed) target[key] = trimmed;
	else delete target[key];
}

function workflowVersionSelectionKey(workflowId: string, workflowVersion: string): string {
	return `${workflowId}@${workflowVersion}`;
}

function parseWorkflowVersionKey(value: string): { workflowId: string; workflowVersion: string } | undefined {
	const separatorIndex = value.indexOf("@");
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) return undefined;
	return { workflowId: value.slice(0, separatorIndex), workflowVersion: value.slice(separatorIndex + 1) };
}
