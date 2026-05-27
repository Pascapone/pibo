import { randomUUID } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type { ModelProfile } from "../../core/profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import type { PiboSession } from "../../sessions/store.js";
import { PiboWebHttpError } from "../../web/http.js";
import type { PiboWebSession } from "../../web/types.js";
import type { PiboProject, PiboProjectWorkflowSessionConfiguration, PiboProjectWorkflowSessionSnapshot } from "./data/project-service.js";
import {
	hashWorkflowDefinitionJson,
	sanitizeWorkflowDiagnostics,
	type WorkflowValidationResponse,
} from "./workflow-persistence.js";
import {
	workflowVersionPickerOptionFromCatalogRecord,
	type WorkflowVersionPickerOption,
} from "./workflow-catalog.js";

export type ChatProjectSessionCreateBody = {
	profile?: unknown;
	workflowId?: unknown;
	workflowVersion?: unknown;
	title?: unknown;
	inputValues?: unknown;
	promptOverrides?: unknown;
	model?: unknown;
	thinkingLevel?: unknown;
	fastMode?: unknown;
};

const PROJECT_WORKFLOW_SESSION_CREATE_FIELDS = new Set([
	"profile",
	"workflowId",
	"workflowVersion",
	"title",
	"inputValues",
	"promptOverrides",
	"model",
	"thinkingLevel",
	"fastMode",
]);

const PROJECT_WORKFLOW_SESSION_DISALLOWED_FIELDS = new Map<string, string>([
	["agentProfileOverrides", "Agent profile overrides are not supported for V2 workflow sessions"],
	["profileOverrides", "Agent profile overrides are not supported for V2 workflow sessions"],
	["profileOverride", "Agent profile overrides are not supported for V2 workflow sessions"],
	["nodeProfileOverrides", "Agent profile overrides are not supported for V2 workflow sessions"],
	["retryLimit", "Retry limit overrides are not supported for V2 workflow sessions"],
	["retryLimits", "Retry limit overrides are not supported for V2 workflow sessions"],
	["maxRetries", "Retry limit overrides are not supported for V2 workflow sessions"],
	["retryCount", "Retry limit overrides are not supported for V2 workflow sessions"],
	["handlerOverrides", "Handler overrides are not supported for V2 workflow sessions"],
	["handlerOverride", "Handler overrides are not supported for V2 workflow sessions"],
	["adapterOverrides", "Adapter overrides are not supported for V2 workflow sessions"],
	["adapterOverride", "Adapter overrides are not supported for V2 workflow sessions"],
	["guardOverrides", "Guard overrides are not supported for V2 workflow sessions"],
	["guardOverride", "Guard overrides are not supported for V2 workflow sessions"],
	["nodeOverrides", "Arbitrary node overrides are not supported for V2 workflow sessions"],
	["overrides", "Arbitrary overrides are not supported for V2 workflow sessions"],
	["options", "Arbitrary options are not supported for V2 workflow sessions"],
	["arbitraryOptions", "Arbitrary options are not supported for V2 workflow sessions"],
]);

export function normalizeProjectWorkflowSessionConfiguration(body: ChatProjectSessionCreateBody, definition: PiboJsonObject): PiboProjectWorkflowSessionConfiguration {
	assertProjectWorkflowSessionCreateFields(body);
	const inputValues = normalizeProjectWorkflowInputValues(body.inputValues);
	const promptOverrideEligibleNodeIds = workflowPromptOverrideEligibleNodeIds(definition);
	const promptOverrides = normalizeProjectWorkflowPromptOverrides(body.promptOverrides, promptOverrideEligibleNodeIds);
	const model = normalizeWorkflowSessionModel(body.model);
	const thinkingLevel = normalizeThinkingLevel(body.thinkingLevel, "thinkingLevel");
	const fastMode = normalizeOptionalBoolean(body.fastMode, "fastMode");
	return {
		inputValues,
		promptOverrides,
		promptOverrideEligibleNodeIds,
		overrideScopes: {
			promptOverrides: "eligible_agent_node",
			model: "workflow",
			thinkingLevel: "workflow",
			fastMode: "workflow",
		},
		...(model ? { model } : {}),
		...(thinkingLevel ? { thinkingLevel } : {}),
		...(fastMode !== undefined ? { fastMode } : {}),
	};
}

export function createProjectWorkflowSessionSnapshot(input: {
	webSession: PiboWebSession;
	project: PiboProject;
	session: PiboSession;
	workflow: WorkflowVersionPickerOption;
	baseDefinition: PiboJsonObject;
	configuration: PiboProjectWorkflowSessionConfiguration;
	validation: WorkflowValidationResponse;
}): PiboProjectWorkflowSessionSnapshot {
	const baseDefinition = cloneJsonObject(input.baseDefinition);
	const effectiveDefinition = applyProjectWorkflowPromptOverrides(baseDefinition, input.configuration.promptOverrides);
	const baseDefinitionHash = hashWorkflowDefinitionJson(baseDefinition);
	const effectiveDefinitionHash = hashWorkflowDefinitionJson(effectiveDefinition);
	const now = new Date().toISOString();
	return {
		id: `wfs_${randomUUID()}`,
		schemaVersion: 1,
		createdAt: now,
		createdBy: input.webSession.authSession.identity.userId,
		ownerScope: input.webSession.ownerScope,
		projectId: input.project.id,
		piboSessionId: input.session.id,
		workflow: {
			id: input.workflow.id,
			version: input.workflow.version,
			source: input.workflow.source,
			title: input.workflow.title,
			...(input.workflow.description ? { description: input.workflow.description } : {}),
			tags: [...input.workflow.tags],
			baseDefinitionHash,
			effectiveDefinitionHash,
		},
		baseDefinition,
		effectiveDefinition,
		inputValues: cloneJsonObject(input.configuration.inputValues),
		promptOverrides: { ...input.configuration.promptOverrides },
		overridePolicy: {
			promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate",
			eligiblePromptNodeIds: [...input.configuration.promptOverrideEligibleNodeIds],
			modelScope: input.configuration.overrideScopes.model,
			thinkingLevelScope: input.configuration.overrideScopes.thinkingLevel,
			fastModeScope: input.configuration.overrideScopes.fastMode,
		},
		...(input.configuration.model ? { model: input.configuration.model } : {}),
		...(input.configuration.thinkingLevel ? { thinkingLevel: input.configuration.thinkingLevel } : {}),
		...(input.configuration.fastMode !== undefined ? { fastMode: input.configuration.fastMode } : {}),
		promptAssetPins: [],
		validation: workflowValidationSnapshot(input.validation),
		deletedDefinitionFallback: {
			title: input.workflow.title,
			workflowId: input.workflow.id,
			workflowVersion: input.workflow.version,
			effectiveDefinitionHash,
		},
	};
}

export function workflowVersionFromSnapshot(snapshot: PiboProjectWorkflowSessionSnapshot): WorkflowVersionPickerOption {
	return workflowVersionPickerOptionFromCatalogRecord({
		id: snapshot.workflow.id,
		version: snapshot.workflow.version,
		title: snapshot.workflow.title ?? snapshot.workflow.id,
		...(snapshot.workflow.description ? { description: snapshot.workflow.description } : {}),
		source: snapshot.workflow.source,
		status: "published",
		tags: [...snapshot.workflow.tags],
	});
}

export function createProjectWorkflowRunCurrent(definition: PiboJsonObject): PiboJsonObject {
	const initialNodeIds = workflowInitialNodeIds(definition);
	return {
		status: "running",
		initialNodeIds,
		...(initialNodeIds.length === 1 ? { nodeId: initialNodeIds[0] } : {}),
	};
}

function assertProjectWorkflowSessionCreateFields(body: ChatProjectSessionCreateBody): void {
	if (!body || typeof body !== "object" || Array.isArray(body)) throw new PiboWebHttpError("Invalid JSON body", 400);
	for (const key of Object.keys(body)) {
		const disallowedMessage = PROJECT_WORKFLOW_SESSION_DISALLOWED_FIELDS.get(key);
		if (disallowedMessage) throw new PiboWebHttpError(disallowedMessage, 400);
		if (!PROJECT_WORKFLOW_SESSION_CREATE_FIELDS.has(key)) {
			throw new PiboWebHttpError(`Unsupported workflow session creation field: ${key}`, 400);
		}
	}
}

function normalizeProjectWorkflowInputValues(value: unknown): PiboJsonObject {
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) throw new PiboWebHttpError("inputValues must be a JSON object", 400);
	return value;
}

function normalizeProjectWorkflowPromptOverrides(value: unknown, eligibleNodeIds: string[]): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (!isJsonObject(value)) throw new PiboWebHttpError("promptOverrides must be a JSON object keyed by eligible node id", 400);
	const eligible = new Set(eligibleNodeIds);
	const promptOverrides: Record<string, string> = {};
	for (const [nodeId, prompt] of Object.entries(value)) {
		if (!nodeId.trim()) throw new PiboWebHttpError("promptOverrides cannot contain an empty node id", 400);
		if (!eligible.has(nodeId)) {
			throw new PiboWebHttpError(`Node '${nodeId}' is not eligible for prompt overrides in this workflow version`, 400);
		}
		if (typeof prompt !== "string") {
			throw new PiboWebHttpError(`Prompt override for node '${nodeId}' must be a string`, 400);
		}
		promptOverrides[nodeId] = prompt;
	}
	return promptOverrides;
}

function normalizeWorkflowSessionModel(value: unknown): ModelProfile | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiboWebHttpError("model must be an object", 400);
	const keys = Object.keys(value);
	const unsupportedKey = keys.find((key) => key !== "provider" && key !== "id");
	if (unsupportedKey) throw new PiboWebHttpError(`model contains unsupported field: ${unsupportedKey}`, 400);
	return normalizeModelProfile(value, "model");
}

function normalizeOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError(`${fieldName} must be a boolean`, 400);
	return value;
}

function normalizeThinkingLevel(value: unknown, fieldName: string): PiboThinkingLevel | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || !isPiboThinkingLevel(value)) {
		throw new PiboWebHttpError(`${fieldName} must be one of off, minimal, low, medium, high, xhigh`, 400);
	}
	return value;
}

function normalizeModelProfile(value: unknown, fieldName: string): ModelProfile | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new PiboWebHttpError(`${fieldName} must be an object`, 400);
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.provider !== "string" || typeof raw.id !== "string") {
		throw new PiboWebHttpError(`${fieldName} must include provider and id`, 400);
	}
	const provider = raw.provider.trim();
	const id = raw.id.trim();
	if (!provider || !id) {
		throw new PiboWebHttpError(`${fieldName} must include provider and id`, 400);
	}
	return { provider, id };
}

function workflowPromptOverrideEligibleNodeIds(definition: PiboJsonObject): string[] {
	const nodes = definition.nodes;
	if (!isJsonObject(nodes)) return [];
	return Object.entries(nodes)
		.filter(([, node]) => isWorkflowPromptOverrideEligibleNode(node))
		.map(([nodeId]) => nodeId)
		.sort();
}

function isWorkflowPromptOverrideEligibleNode(value: unknown): boolean {
	if (!isJsonObject(value)) return false;
	const metadata = isJsonObject(value.metadata) ? value.metadata : undefined;
	const sessionOverrides = metadata && isJsonObject(metadata.sessionOverrides) ? metadata.sessionOverrides : undefined;
	return value.kind === "agent"
		&& value.runtime === "pibo"
		&& typeof value.promptTemplate === "string"
		&& sessionOverrides?.prompt === true;
}

function applyProjectWorkflowPromptOverrides(definition: PiboJsonObject, promptOverrides: Record<string, string>): PiboJsonObject {
	const effectiveDefinition = cloneJsonObject(definition);
	const nodes = isJsonObject(effectiveDefinition.nodes) ? effectiveDefinition.nodes : undefined;
	if (!nodes) return effectiveDefinition;
	for (const [nodeId, promptTemplate] of Object.entries(promptOverrides)) {
		const node = nodes[nodeId];
		if (isJsonObject(node)) {
			nodes[nodeId] = { ...node, promptTemplate };
		}
	}
	return effectiveDefinition;
}

function workflowValidationSnapshot(validation: WorkflowValidationResponse): PiboJsonObject {
	return {
		...validation.validation,
		validatedAt: validation.validation.checkedAt,
		diagnostics: sanitizeWorkflowDiagnostics(validation.diagnostics) as unknown as PiboJsonValue[],
	};
}

function workflowInitialNodeIds(definition: PiboJsonObject): string[] {
	if (typeof definition.initial === "string" && definition.initial.trim()) return [definition.initial.trim()];
	if (Array.isArray(definition.initial)) {
		return definition.initial.filter((nodeId): nodeId is string => typeof nodeId === "string" && Boolean(nodeId.trim())).map((nodeId) => nodeId.trim());
	}
	return [];
}

function cloneJsonObject(value: PiboJsonObject): PiboJsonObject {
	return JSON.parse(JSON.stringify(value)) as PiboJsonObject;
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
