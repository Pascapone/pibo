import type { WorkflowDraftDefinition, WorkflowPromptAssetDocument } from "../api-workflows";
import {
	isWorkflowJsonObject,
	readWorkflowNodeDefinitions,
	type WorkflowJsonObject,
} from "./workflow-graph-model";
import {
	DEFAULT_WORKFLOW_JSON_SCHEMA,
	createWorkflowPort,
	formatWorkflowPortSchemaText,
	formatWorkflowSchemaText,
	parseWorkflowSchemaText,
	readWorkflowPortDescription,
	readWorkflowPortKind,
	sanitizeWorkflowStatePathInput,
	writeOptionalString,
	type WorkflowPortKindSelection,
} from "./workflow-inspector-forms";

export type WorkflowGlobalStateMergeKind = "none" | "replace" | "append" | "shallowMerge";

export type WorkflowGlobalStateFieldFormState = {
	path: string;
	description: string;
	schemaText: string;
	mergeKind: WorkflowGlobalStateMergeKind;
};

export type WorkflowSettingsFormState = {
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

export function createWorkflowSettingsFormState(definition: WorkflowDraftDefinition): WorkflowSettingsFormState {
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

export function applyWorkflowSettingsForm(definition: WorkflowDraftDefinition, form: WorkflowSettingsFormState): WorkflowDraftDefinition {
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

export function createDefaultGlobalStateField(existingFields: WorkflowGlobalStateFieldFormState[]): WorkflowGlobalStateFieldFormState {
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

export function createWorkflowGlobalStateFieldFormState(definition: WorkflowDraftDefinition): WorkflowGlobalStateFieldFormState[] {
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

export function readWorkflowGlobalStateMergeKind(value: unknown): WorkflowGlobalStateMergeKind {
	if (!isWorkflowJsonObject(value) || typeof value.kind !== "string") return "none";
	return ["replace", "append", "shallowMerge"].includes(value.kind) ? value.kind as WorkflowGlobalStateMergeKind : "none";
}

export function writeWorkflowGlobalStateFields(definition: WorkflowDraftDefinition, fields: WorkflowGlobalStateFieldFormState[]): void {
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

export function createWorkflowGlobalStateMergePolicy(kind: WorkflowGlobalStateMergeKind): WorkflowJsonObject | undefined {
	return kind === "none" ? undefined : { kind };
}

export function workflowSettingsStateChanged(definition: WorkflowDraftDefinition, form: WorkflowSettingsFormState): boolean {
	return JSON.stringify(createWorkflowGlobalStateFieldFormState(definition)) !== JSON.stringify(form.globalStateFields);
}

export function readPromptAssetRefId(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!isWorkflowJsonObject(value)) return "";
	return typeof value.id === "string" ? value.id.trim() : "";
}

export function applyWorkflowPromptAssetDocumentToNode(definition: WorkflowDraftDefinition, nodeId: string, asset: WorkflowPromptAssetDocument): WorkflowDraftDefinition {
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

export function writeWorkflowPromptAssetMetadata(value: unknown, asset: WorkflowPromptAssetDocument): WorkflowJsonObject {
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

export function formatWorkflowStringList(value: unknown): string {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join("\n") : "";
}

export function parseWorkflowStringList(value: string): string[] {
	return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
}

export function writeWorkflowStringList(target: WorkflowJsonObject, key: "tags" | "useWhen" | "notFor" | "examples", value: string): void {
	const entries = parseWorkflowStringList(value);
	if (entries.length) target[key] = entries;
	else delete target[key];
}
