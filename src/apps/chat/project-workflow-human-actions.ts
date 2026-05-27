import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import { responseJson } from "../../web/http.js";
import type { PiboProjectSession, PiboProjectWorkflowHumanActionKind, PiboProjectWorkflowPendingHumanAction, PiboProjectWorkflowWaitToken } from "./data/project-service.js";
import { sanitizeWorkflowDiagnostics, type WorkflowDraftDiagnostic } from "./workflow-persistence.js";

export type ChatProjectWorkflowHumanActionBody = {
	waitTokenId?: unknown;
	actionId?: unknown;
	kind?: unknown;
	payload?: unknown;
};

export type ProjectWorkflowHumanActionRegistryOption = {
	id: string;
	kind: PiboProjectWorkflowHumanActionKind;
	displayName: string;
	description?: string;
	paramsSchema: PiboJsonObject | null;
};

export type NormalizedProjectWorkflowHumanActionRequest = {
	waitTokenId: string;
	actionId?: string;
	kind?: PiboProjectWorkflowHumanActionKind;
	payload?: PiboJsonValue;
};

export function projectWorkflowPendingHumanActionFromToken(
	token: PiboProjectWorkflowWaitToken,
	humanActionOptions: readonly ProjectWorkflowHumanActionRegistryOption[],
): PiboProjectWorkflowPendingHumanAction {
	const diagnostics: PiboProjectWorkflowPendingHumanAction["diagnostics"] = [];
	const availableActions = token.actions.map((action, index) => {
		const registered = humanActionOptions.find((option) => option.id === action.id);
		if (!registered) {
			diagnostics.push({
				code: "WorkflowGraphError.unknownHumanActionRef",
				message: `Workflow wait token '${token.id}' references human action '${action.id}', but it is not registered in the Workflow Registry.`,
				severity: "error",
				path: `$.waitToken.actions.${index}.id`,
				registryRef: action.id,
				hint: "Resolve waits with registered approve/reject/resume/cancel action refs only.",
			});
		}
		if (registered && action.kind && action.kind !== registered.kind) {
			diagnostics.push({
				code: "WorkflowGraphError.humanActionKindMismatch",
				message: `Workflow wait token '${token.id}' action '${action.id}' declares kind '${action.kind}', but the registry defines kind '${registered.kind}'.`,
				severity: "error",
				path: `$.waitToken.actions.${index}.kind`,
				registryRef: action.id,
				hint: "Keep wait-token action refs aligned with their registered action definitions.",
			});
		}
		return {
			id: action.id,
			kind: action.kind ?? registered?.kind ?? "unknown",
			displayName: registered?.displayName ?? action.id,
			...(registered?.description ? { description: registered.description } : {}),
			paramsSchema: registered?.paramsSchema ?? null,
			registered: Boolean(registered),
		};
	});
	return {
		waitTokenId: token.id,
		workflowRunId: token.workflowRunId,
		...(token.nodeAttemptId ? { nodeAttemptId: token.nodeAttemptId } : {}),
		...(token.humanNodeId ? { humanNodeId: token.humanNodeId } : {}),
		prompt: token.prompt,
		...(token.schema ? { schema: token.schema } : {}),
		status: "pending",
		payloadRequirements: {
			required: Boolean(token.schema),
			...(token.schema ? { schema: token.schema } : {}),
			description: token.schema
				? "Resume requires a JSON payload that matches this wait token schema."
				: "Approve, reject, resume, and cancel do not require a payload for this wait token.",
		},
		availableActions,
		diagnostics,
		createdAt: token.createdAt,
		...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
	};
}

export function projectWorkflowHumanActionLifecyclePayload(request: NormalizedProjectWorkflowHumanActionRequest): PiboJsonObject {
	const payload: PiboJsonObject = { waitTokenId: request.waitTokenId };
	if (request.actionId) payload.actionId = request.actionId;
	if (request.kind) payload.kind = request.kind;
	return payload;
}

export function projectWorkflowHumanActionSubmittedLifecyclePayload(waitTokenId: string, action: { actionId?: string; kind: PiboProjectWorkflowHumanActionKind }): PiboJsonObject {
	const payload: PiboJsonObject = {
		waitTokenId,
		kind: action.kind,
		decision: action.kind === "cancel" ? "cancelled" : "resumed",
	};
	if (action.actionId) payload.actionId = action.actionId;
	return payload;
}

export function normalizeProjectWorkflowHumanActionBody(body: ChatProjectWorkflowHumanActionBody): {
	request?: NormalizedProjectWorkflowHumanActionRequest;
	diagnostics: WorkflowDraftDiagnostic[];
} {
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	const waitTokenId = typeof body.waitTokenId === "string" && body.waitTokenId.trim() ? body.waitTokenId.trim() : undefined;
	const actionId = typeof body.actionId === "string" && body.actionId.trim() ? body.actionId.trim() : undefined;
	const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() as PiboProjectWorkflowHumanActionKind : undefined;
	if (!waitTokenId) {
		diagnostics.push({
			code: "WorkflowRuntimeError.waitTokenIdRequired",
			message: "Human action requests must include a waitTokenId.",
			severity: "error",
			path: "$.waitTokenId",
			hint: "Submit a pending wait token returned by Project workflow inspection.",
		});
	}
	if (!actionId && !kind) {
		diagnostics.push({
			code: "WorkflowRuntimeError.humanActionRequired",
			message: "Human action requests must include an actionId or action kind.",
			severity: "error",
			path: "$.actionId",
			hint: "Use one of the wait token's registered approve/reject/resume/cancel actions.",
		});
	}
	if (body.payload !== undefined && !isJsonValue(body.payload)) {
		diagnostics.push({
			code: "WorkflowRuntimeError.invalidHumanActionPayload",
			message: "Human action payload must be valid JSON data.",
			severity: "error",
			path: "$.payload",
			hint: "Submit a JSON value that matches the wait token payload requirements.",
		});
	}
	if (!waitTokenId) return { diagnostics };
	return {
		request: {
			waitTokenId,
			...(actionId ? { actionId } : {}),
			...(kind ? { kind } : {}),
			...(body.payload !== undefined && isJsonValue(body.payload) ? { payload: body.payload } : {}),
		},
		diagnostics,
	};
}

export function validateProjectWorkflowHumanActionRequest(input: {
	projectSession: PiboProjectSession;
	waitToken?: PiboProjectWorkflowWaitToken;
	request: NormalizedProjectWorkflowHumanActionRequest;
	humanActionOptions: readonly ProjectWorkflowHumanActionRegistryOption[];
}): {
	diagnostics: WorkflowDraftDiagnostic[];
	httpStatus: number;
	checkedAt: string;
	expiredAt?: string;
	actionRef?: PiboProjectWorkflowWaitToken["actions"][number];
	actionKind?: PiboProjectWorkflowHumanActionKind;
} {
	const checkedAt = new Date().toISOString();
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	if (!input.waitToken) {
		diagnostics.push({
			code: "WorkflowRuntimeError.unknownWaitToken",
			message: `Workflow wait token '${input.request.waitTokenId}' does not exist.`,
			severity: "error",
			path: "$.waitTokenId",
			hint: "Refresh the Project run view and submit one of its pending wait tokens.",
		});
		return { diagnostics, httpStatus: 404, checkedAt };
	}
	if (input.waitToken.projectId !== input.projectSession.projectId || input.waitToken.piboSessionId !== input.projectSession.piboSessionId || input.waitToken.workflowRunId !== input.projectSession.workflowRunId) {
		diagnostics.push({
			code: "WorkflowRuntimeError.waitTokenSessionMismatch",
			message: `Workflow wait token '${input.waitToken.id}' does not belong to this Project workflow session.`,
			severity: "error",
			path: "$.waitTokenId",
			registryRef: input.waitToken.id,
			hint: "Use only wait tokens shown in the selected Project run view.",
		});
		return { diagnostics, httpStatus: 403, checkedAt };
	}
	if (input.waitToken.status !== "pending") {
		diagnostics.push({
			code: "WorkflowRuntimeError.waitTokenNotPending",
			message: `Workflow wait token '${input.waitToken.id}' is '${input.waitToken.status}' and cannot accept another human action.`,
			severity: "error",
			path: "$.waitToken.status",
			registryRef: input.waitToken.id,
			hint: "Human wait tokens can only be resolved once while pending.",
		});
		return { diagnostics, httpStatus: 409, checkedAt };
	}
	if (input.waitToken.expiresAt && Date.parse(input.waitToken.expiresAt) <= Date.parse(checkedAt)) {
		diagnostics.push({
			code: "WorkflowRuntimeError.waitTokenExpired",
			message: `Workflow wait token '${input.waitToken.id}' expired at ${input.waitToken.expiresAt}.`,
			severity: "error",
			path: "$.waitToken.expiresAt",
			registryRef: input.waitToken.id,
			hint: "Create a new human wait or handle the timeout before submitting an action.",
		});
		return { diagnostics, httpStatus: 409, checkedAt, expiredAt: input.waitToken.expiresAt };
	}
	const actionRef = input.request.actionId
		? input.waitToken.actions.find((action) => action.id === input.request.actionId)
		: input.waitToken.actions.find((action) => action.kind === input.request.kind);
	if (!actionRef) {
		diagnostics.push({
			code: "WorkflowRuntimeError.humanActionUnavailable",
			message: input.request.actionId
				? `Workflow wait token '${input.waitToken.id}' does not offer human action '${input.request.actionId}'.`
				: `Workflow wait token '${input.waitToken.id}' does not offer a human action of kind '${input.request.kind ?? "<missing>"}'.`,
			severity: "error",
			path: input.request.actionId ? "$.actionId" : "$.kind",
			...(input.request.actionId ? { registryRef: input.request.actionId } : {}),
			hint: "Use one of the wait token's available action refs.",
		});
		return { diagnostics, httpStatus: 422, checkedAt };
	}
	const registered = input.humanActionOptions.find((option) => option.id === actionRef.id);
	if (!registered) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownHumanActionRef",
			message: `Workflow wait token '${input.waitToken.id}' references human action '${actionRef.id}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: "$.waitToken.actions",
			registryRef: actionRef.id,
			hint: "Register or select a known approve/reject/resume/cancel human action before accepting it.",
		});
		return { diagnostics, httpStatus: 422, checkedAt, actionRef };
	}
	if (actionRef.kind && actionRef.kind !== registered.kind) {
		diagnostics.push({
			code: "WorkflowGraphError.humanActionKindMismatch",
			message: `Workflow wait token '${input.waitToken.id}' action '${actionRef.id}' declares kind '${actionRef.kind}', but the registry defines kind '${registered.kind}'.`,
			severity: "error",
			path: "$.waitToken.actions",
			registryRef: actionRef.id,
			hint: "Keep wait-token action refs aligned with their registered action definitions.",
		});
	}
	if (input.request.kind && input.request.kind !== registered.kind) {
		diagnostics.push({
			code: "WorkflowRuntimeError.humanActionKindMismatch",
			message: `Requested human action kind '${input.request.kind}' does not match registered action '${registered.id}' kind '${registered.kind}'.`,
			severity: "error",
			path: "$.kind",
			registryRef: registered.id,
			hint: "Submit the kind returned by the wait token action list.",
		});
	}
	if (registered.kind === "resume" && input.waitToken.schema) {
		validateWorkflowHumanActionPayloadAgainstSchema(input.request.payload, input.waitToken.schema, "$.payload", diagnostics, {
			registryRef: registered.id,
			waitTokenId: input.waitToken.id,
		});
	}
	return {
		diagnostics,
		httpStatus: diagnostics.length ? 422 : 200,
		checkedAt,
		actionRef,
		actionKind: registered.kind,
	};
}

export function projectWorkflowHumanActionRuntimeDiagnostic(error: unknown, waitTokenId: string): WorkflowDraftDiagnostic {
	const message = error instanceof Error ? error.message : String(error);
	let code = "WorkflowRuntimeError.humanActionRejected";
	if (/not found/i.test(message)) code = "WorkflowRuntimeError.unknownWaitToken";
	else if (/does not belong/i.test(message)) code = "WorkflowRuntimeError.waitTokenSessionMismatch";
	else if (/expired/i.test(message)) code = "WorkflowRuntimeError.waitTokenExpired";
	else if (/cannot be resolved again|not pending/i.test(message)) code = "WorkflowRuntimeError.waitTokenNotPending";
	else if (/does not offer/i.test(message)) code = "WorkflowRuntimeError.humanActionUnavailable";
	return {
		code,
		message,
		severity: "error",
		path: "$.waitTokenId",
		registryRef: waitTokenId,
		hint: "Refresh the Project run view and retry with a currently pending wait token/action ref.",
	};
}

export function projectWorkflowHumanActionDiagnosticResponse(
	message: string,
	diagnostics: WorkflowDraftDiagnostic[],
	status: number,
	waitToken: PiboProjectWorkflowWaitToken | undefined,
	humanActionOptions: readonly ProjectWorkflowHumanActionRegistryOption[],
): Response {
	return responseJson({
		error: message,
		diagnostics: sanitizeWorkflowDiagnostics(diagnostics),
		...(waitToken?.status === "pending" ? { waitToken: projectWorkflowPendingHumanActionFromToken(waitToken, humanActionOptions) } : {}),
	}, { status });
}

function validateWorkflowHumanActionPayloadAgainstSchema(
	value: unknown,
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	context: { registryRef: string; waitTokenId: string },
): void {
	const typeNames = readParamsSchemaTypes(schema.type);
	if (typeNames.length && !typeNames.some((typeName) => workflowParamValueMatchesType(value, typeName))) {
		diagnostics.push({
			code: "WorkflowRuntimeError.invalidHumanActionPayload",
			message: `Resume payload for wait token '${context.waitTokenId}' does not match schema type at '${path}'.`,
			severity: "error",
			path,
			registryRef: context.registryRef,
			hint: "Submit a resume payload matching the wait token schema before the action is accepted.",
		});
		return;
	}
	if (isJsonObject(value)) {
		const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === "string") : [];
		for (const requiredKey of required) {
			if (Object.hasOwn(value, requiredKey)) continue;
			diagnostics.push({
				code: "WorkflowRuntimeError.invalidHumanActionPayload",
				message: `Resume payload for wait token '${context.waitTokenId}' is missing required field '${requiredKey}'.`,
				severity: "error",
				path: workflowParamsChildPath(path, requiredKey),
				registryRef: context.registryRef,
				hint: "Add the required resume payload field before submitting the action.",
			});
		}
		const properties = isJsonObject(schema.properties) ? schema.properties : {};
		for (const [key, propertyValue] of Object.entries(value)) {
			const propertySchema = properties[key];
			if (isJsonObject(propertySchema)) {
				validateWorkflowHumanActionPayloadAgainstSchema(propertyValue, propertySchema, workflowParamsChildPath(path, key), diagnostics, context);
			} else if (schema.additionalProperties === false) {
				diagnostics.push({
					code: "WorkflowRuntimeError.invalidHumanActionPayload",
					message: `Resume payload for wait token '${context.waitTokenId}' includes field '${key}', which is not allowed by the wait token schema.`,
					severity: "error",
					path: workflowParamsChildPath(path, key),
					registryRef: context.registryRef,
					hint: "Remove fields not declared by the wait token payload schema.",
				});
			}
		}
	}
	if (Array.isArray(value) && isJsonObject(schema.items)) {
		value.forEach((item, index) => validateWorkflowHumanActionPayloadAgainstSchema(item, schema.items as PiboJsonObject, `${path}.${index}`, diagnostics, context));
	}
}

function isJsonValue(value: unknown): value is PiboJsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (typeof value === "object") return Object.values(value).every(isJsonValue);
	return false;
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readParamsSchemaTypes(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
	return [];
}

function workflowParamValueMatchesType(value: unknown, typeName: string): boolean {
	if (typeName === "string") return typeof value === "string";
	if (typeName === "number") return typeof value === "number" && Number.isFinite(value);
	if (typeName === "integer") return Number.isInteger(value);
	if (typeName === "boolean") return typeof value === "boolean";
	if (typeName === "object") return isJsonObject(value);
	if (typeName === "array") return Array.isArray(value);
	if (typeName === "null") return value === null;
	return true;
}

function workflowParamsChildPath(path: string, key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}
