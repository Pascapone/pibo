import type { PiboJsonObject } from "../../core/events.js";
import type { WorkflowDraftDiagnostic } from "./workflow-persistence.js";

const INLINE_EXECUTABLE_FIELD_NAMES = new Set([
	"code",
	"script",
	"command",
	"eval",
	"javascript",
	"shell",
	"typescript",
	"inlinecode",
	"inlinehandler",
	"inlinetypescript",
	"inlinejavascript",
	"inlineshell",
	"handlersource",
	"sourcecode",
]);

const HIDDEN_LLM_COERCION_FIELD_NAMES = new Set([
	"llmcoercion",
	"coercewithllm",
	"hiddenllmcoercion",
	"autocoerce",
	"llmadapter",
]);

const RAW_XSTATE_FIELD_NAMES = new Set([
	"xstate",
	"xstatemachine",
	"xstatesource",
	"xstatejson",
]);

type WorkflowSecurityDiagnosticTarget = Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId">;

export function validateWorkflowDefinitionSecurityBoundary(definition: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	validateNoInlineExecutableCode(definition, "$", diagnostics, {});
	validateNoHiddenLlmCoercion(definition, "$", diagnostics, {});
	for (const key of Object.keys(definition)) {
		if (!RAW_XSTATE_FIELD_NAMES.has(normalizeWorkflowSecurityFieldName(key))) continue;
		diagnostics.push({
			code: "WorkflowSecurityError.rawXStateAuthoring",
			message: `Workflow definition declares raw XState field '${key}', which is projection-only and not editable in Workflow UI Authoring V2.`,
			severity: "error",
			path: `$.${key}`,
			hint: "Edit and publish Pibo Workflow IR only; XState is generated as a visualization/projection from workflow run records.",
		});
	}
}

export function validateNoInlineExecutableCode(
	value: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowSecurityDiagnosticTarget,
): void {
	for (const key of Object.keys(value)) {
		if (!INLINE_EXECUTABLE_FIELD_NAMES.has(normalizeWorkflowSecurityFieldName(key))) continue;
		diagnostics.push({
			code: "WorkflowSecurityError.inlineExecutableCode",
			message: `${workflowDiagnosticTargetLabel(target)} declares inline executable field '${key}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.${key}`,
			...target,
			hint: "Use registered handler, adapter, guard, prompt asset, or human action refs selected from V2 pickers instead of inline JavaScript, TypeScript, shell, eval, or arbitrary executable code.",
		});
	}
}

export function validateNoHiddenLlmCoercion(
	value: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowSecurityDiagnosticTarget,
): void {
	for (const key of Object.keys(value)) {
		if (!HIDDEN_LLM_COERCION_FIELD_NAMES.has(normalizeWorkflowSecurityFieldName(key))) continue;
		diagnostics.push({
			code: "WorkflowSecurityError.hiddenLlmCoercion",
			message: `${workflowDiagnosticTargetLabel(target)} declares hidden LLM coercion field '${key}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.${key}`,
			...target,
			hint: "Use a visible registered adapter node or edge adapter when schemas are incompatible.",
		});
	}
	const kind = typeof value.kind === "string" ? normalizeWorkflowSecurityFieldName(value.kind) : "";
	if (kind === "llm" || kind === "llmadapter" || kind === "llmcoercion") {
		diagnostics.push({
			code: "WorkflowSecurityError.hiddenLlmCoercion",
			message: `${workflowDiagnosticTargetLabel(target)} uses LLM coercion kind '${value.kind}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.kind`,
			...target,
			hint: "Use deterministic registered adapters instead of hidden LLM coercion.",
		});
	}
}

function workflowDiagnosticTargetLabel(target: WorkflowSecurityDiagnosticTarget): string {
	if (target.nodeId) return `Workflow node '${target.nodeId}'`;
	if (target.edgeId) return `Workflow edge '${target.edgeId}'`;
	return "Workflow definition";
}

function normalizeWorkflowSecurityFieldName(value: string): string {
	return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}
