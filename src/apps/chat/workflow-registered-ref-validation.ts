import type { PiboJsonObject } from "../../core/events.js";
import type { PiboWebSession } from "../../web/types.js";
import type { WorkflowDraftDiagnostic } from "./workflow-persistence.js";
import { validateWorkflowRegisteredRefParamsLike } from "./workflow-registered-ref-params.js";
import {
	WORKFLOW_ADAPTER_REF_OPTIONS,
	WORKFLOW_GUARD_REF_OPTIONS,
	WORKFLOW_HUMAN_ACTION_REF_OPTIONS,
	isWorkflowPromptAssetRegistered,
	type WorkflowPromptAssetPickerState,
} from "./workflow-registered-ref-pickers.js";

export type WorkflowPromptAssetRefValidationInput = {
	state: WorkflowPromptAssetPickerState;
	webSession: PiboWebSession;
};

export function validateWorkflowPromptAssetRefLike(
	nodeId: string,
	value: unknown,
	input: WorkflowPromptAssetRefValidationInput,
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.nodes.${nodeId}.promptBuilder`;
	const ref = readPromptAssetRef(value);
	if (!ref.id) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidPromptBuilderRef",
			message: `Agent node '${nodeId}' must use a registered prompt asset ref when promptBuilder is declared.`,
			severity: "error",
			path,
			nodeId,
			hint: "Select a registered prompt asset/prompt-builder ref; V2 does not expose inline TypeScript prompt builders.",
		});
		return;
	}
	if (!ref.valid) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidPromptBuilderRef",
			message: `Agent node '${nodeId}' prompt asset ref '${ref.id}' must use a registered TypeScript promptBuilder shape.`,
			severity: "error",
			path,
			nodeId,
			registryRef: ref.id,
			hint: "Use { kind: 'promptBuilder', language: 'typescript', id: '<registered id>' } or a registered prompt asset id string.",
		});
		return;
	}
	if (!isWorkflowPromptAssetRegistered(input.state, input.webSession, ref.id)) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownPromptBuilderRef",
			message: `Agent node '${nodeId}' references prompt asset '${ref.id}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: isJsonObject(value) ? `${path}.id` : path,
			nodeId,
			registryRef: ref.id,
			hint: "Select a registered prompt asset ref before publishing or running this workflow.",
		});
	}
}

function readPromptAssetRef(value: unknown): { id?: string; valid: boolean } {
	if (typeof value === "string") return { id: value.trim() || undefined, valid: Boolean(value.trim()) };
	if (!isJsonObject(value)) return { valid: false };
	const id = typeof value.id === "string" ? value.id.trim() : undefined;
	return {
		id,
		valid: value.kind === "promptBuilder" && value.language === "typescript" && Boolean(id),
	};
}

export function validateRegisteredAdapterRefLike(
	value: unknown,
	diagnostics: WorkflowDraftDiagnostic[],
	target: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId"> & { path: string; ownerLabel: string },
): void {
	const ref = readRegisteredAdapterRef(value);
	if (!ref.id) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownAdapterRef",
			message: `${target.ownerLabel} must select a registered adapter ref.`,
			severity: "error",
			path: `${target.path}.id`,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			hint: "Adapter refs must be selected from the registered adapter picker; the UI cannot create inline adapter code.",
		});
		return;
	}
	if (!ref.valid) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidAdapterRef",
			message: `${target.ownerLabel} must use a registered TypeScript adapter ref shape.`,
			severity: "error",
			path: target.path,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			registryRef: ref.id,
			hint: "Persist adapter refs as { kind: 'adapter', language: 'typescript', id: '<registered id>' } instead of inline or raw handlers.",
		});
		return;
	}
	const registered = WORKFLOW_ADAPTER_REF_OPTIONS.find((option) => option.id === ref.id);
	if (!registered) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownAdapterRef",
			message: `${target.ownerLabel} references adapter '${ref.id}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: `${target.path}.id`,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			registryRef: ref.id,
			hint: "Select a registered adapter ref before publishing or running this workflow.",
		});
		return;
	}
	validateWorkflowRegisteredRefParamsLike(ref.params, registered.paramsSchema, diagnostics, {
		kind: "adapter",
		path: `${target.path}.params`,
		ownerLabel: target.ownerLabel,
		registryRef: ref.id,
		nodeId: target.nodeId,
		edgeId: target.edgeId,
	});
}

function readRegisteredAdapterRef(value: unknown): { id?: string; valid: boolean; params?: unknown } {
	if (!isJsonObject(value)) return { valid: false };
	const id = typeof value.id === "string" ? value.id.trim() : undefined;
	return {
		id,
		valid: value.kind === "adapter" && value.language === "typescript" && Boolean(id),
		...(value.params !== undefined ? { params: value.params } : {}),
	};
}

export function validateWorkflowGuardRefLike(edgeId: string, value: unknown, diagnostics: WorkflowDraftDiagnostic[]): void {
	const path = `$.edges.${edgeId}.guard.handler`;
	if (!isJsonObject(value) || typeof value.handler !== "string" || !value.handler.trim()) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidGuardRef",
			message: `Workflow edge '${edgeId}' must use a registered guard handler ref.`,
			severity: "error",
			path,
			edgeId,
			hint: "Select a registered guard ref; V2 does not expose inline guard code.",
		});
		return;
	}
	const guardId = value.handler.trim();
	if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 0)) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidGuardPriority",
			message: `Workflow edge '${edgeId}' guard priority must be a non-negative integer when declared.`,
			severity: "error",
			path: `$.edges.${edgeId}.guard.priority`,
			edgeId,
		});
	}
	const registered = WORKFLOW_GUARD_REF_OPTIONS.find((option) => option.id === guardId);
	if (!registered) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownGuardRef",
			message: `Workflow edge '${edgeId}' references guard '${guardId}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path,
			edgeId,
			registryRef: guardId,
			hint: "Select a registered guard ref before publishing or running this workflow.",
		});
		return;
	}
	validateWorkflowRegisteredRefParamsLike(value.params, registered.paramsSchema, diagnostics, {
		kind: "guard",
		path: `$.edges.${edgeId}.guard.params`,
		ownerLabel: `Workflow edge '${edgeId}' guard`,
		registryRef: guardId,
		edgeId,
	});
}

export function validateWorkflowHumanActionRefsLike(nodeId: string, value: unknown, diagnostics: WorkflowDraftDiagnostic[]): void {
	if (!Array.isArray(value)) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidHumanActionRef",
			message: `Human node '${nodeId}' actions must be an array of registered human action refs.`,
			severity: "error",
			path: `$.nodes.${nodeId}.actions`,
			nodeId,
			hint: "Select registered human actions such as approve/reject/resume/cancel; V2 does not create arbitrary action handlers.",
		});
		return;
	}
	value.forEach((action, index) => {
		const path = `$.nodes.${nodeId}.actions.${index}`;
		if (!isJsonObject(action) || typeof action.id !== "string" || !action.id.trim()) {
			diagnostics.push({
				code: "WorkflowGraphError.invalidHumanActionRef",
				message: `Human node '${nodeId}' declares an invalid human action ref at index ${index}.`,
				severity: "error",
				path,
				nodeId,
				hint: "Human action refs must contain a non-empty registered action id.",
			});
			return;
		}
		const actionId = action.id.trim();
		const registered = WORKFLOW_HUMAN_ACTION_REF_OPTIONS.find((option) => option.id === actionId);
		if (!registered) {
			diagnostics.push({
				code: "WorkflowGraphError.unknownHumanActionRef",
				message: `Human node '${nodeId}' references human action '${actionId}', but it is not registered in the Workflow Registry.`,
				severity: "error",
				path: `${path}.id`,
				nodeId,
				registryRef: actionId,
				hint: "Select a registered human action before publishing or running this workflow.",
			});
			return;
		}
		if (action.kind !== undefined && action.kind !== registered.kind) {
			diagnostics.push({
				code: "WorkflowGraphError.humanActionKindMismatch",
				message: `Human node '${nodeId}' action '${actionId}' declares kind '${action.kind}', but the registry defines kind '${registered.kind}'.`,
				severity: "error",
				path: `${path}.kind`,
				nodeId,
				registryRef: actionId,
				hint: "Keep human action refs aligned with their registered action definitions.",
			});
		}
	});
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
