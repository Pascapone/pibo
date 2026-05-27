import type { WorkflowDraftDefinition, WorkflowVersionPickerOption } from "../api-workflows";
import { addWorkflowGraphNodeDefinition, type GraphPosition, type WorkflowJsonObject } from "./workflow-graph-model";
import {
	DEFAULT_WORKFLOW_JSON_SCHEMA,
	cloneWorkflowJsonObject,
	createHumanActionObject,
	createRegisteredAdapterRef,
	createWorkflowPort,
	formatWorkflowSchemaText,
	type WorkflowHumanActionFormChoice,
} from "./workflow-inspector-forms";

export const DEFAULT_AGENT_PROMPT_TEMPLATE = "Use the workflow input to produce a concise answer.\n\n{{input}}";

export function addWorkflowGraphAgentNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, profileId: string): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultAgentNodeDefinition(nodeId, profileId));
}

export function addWorkflowGraphWorkflowNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, workflow: WorkflowVersionPickerOption): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultWorkflowNodeDefinition(nodeId, workflow));
}

export function addWorkflowGraphAdapterNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, adapterRef: string): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultAdapterNodeDefinition(nodeId, adapterRef));
}

export function addWorkflowGraphHumanNode(definition: WorkflowDraftDefinition, nodeId: string, position: GraphPosition, action: WorkflowHumanActionFormChoice): WorkflowDraftDefinition {
	return addWorkflowGraphNodeDefinition(definition, nodeId, position, createDefaultHumanNodeDefinition(nodeId, action));
}

export function createDefaultAgentNodeDefinition(nodeId: string, profileId: string): WorkflowJsonObject {
	return {
		kind: "agent",
		runtime: "pibo",
		label: `Agent ${nodeId}`,
		profile: { kind: "fixed", id: profileId || "base" },
		promptTemplate: DEFAULT_AGENT_PROMPT_TEMPLATE,
		metadata: { sessionOverrides: { prompt: true } },
	};
}

export function createDefaultWorkflowNodeDefinition(nodeId: string, workflow: WorkflowVersionPickerOption): WorkflowJsonObject {
	return {
		kind: "workflow",
		label: `Workflow ${nodeId}`,
		workflowId: workflow.id,
		workflowVersion: workflow.version,
	};
}

export function createDefaultAdapterNodeDefinition(nodeId: string, adapterRef: string, input?: WorkflowJsonObject, output?: WorkflowJsonObject): WorkflowJsonObject {
	return {
		kind: "adapter",
		label: `Adapter ${nodeId}`,
		mode: "deterministic",
		handler: createRegisteredAdapterRef(adapterRef),
		input: cloneWorkflowJsonObject(input ?? createWorkflowPort("text", "", undefined)),
		output: cloneWorkflowJsonObject(output ?? createWorkflowPort("text", "", undefined)),
	};
}

export function createDefaultHumanNodeDefinition(nodeId: string, action: WorkflowHumanActionFormChoice): WorkflowJsonObject {
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
