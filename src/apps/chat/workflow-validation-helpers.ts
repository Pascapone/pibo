import type { PiboJsonObject } from "../../core/events.js";
import { PiboWebHttpError } from "../../web/http.js";
import type {
	WorkflowDraftDiagnostic,
	WorkflowValidationSummary,
	WorkflowValidationTrigger,
} from "./workflow-persistence.js";

export type WorkflowDraftPatchBody = {
	definition?: unknown;
	rawDefinitionText?: unknown;
	editTrigger?: unknown;
};

const WORKFLOW_EDIT_VALIDATION_TRIGGERS = new Set<WorkflowValidationTrigger>([
	"graph_edit",
	"node_edit",
	"edge_edit",
	"schema_edit",
	"prompt_edit",
	"state_edit",
	"raw_ir_edit",
]);

const WORKFLOW_RAW_IR_PARSE_DIAGNOSTIC_CODE = "WorkflowBuilderWarning.invalidRawIrText";

const WORKFLOW_VALIDATION_DIAGNOSTIC_PREFIXES = [
	"WorkflowValidation",
	"WorkflowGraphError",
	"WorkflowSchemaError",
	"WorkflowCatalogError",
	"WorkflowInterfaceError",
	"WorkflowRegistryError",
	"WorkflowSecurityError",
];

function normalizeWorkflowEditTrigger(value: unknown): WorkflowValidationTrigger {
	if (typeof value !== "string" || !WORKFLOW_EDIT_VALIDATION_TRIGGERS.has(value as WorkflowValidationTrigger)) {
		throw new PiboWebHttpError("Workflow edit trigger must be graph_edit, node_edit, edge_edit, schema_edit, prompt_edit, state_edit, or raw_ir_edit", 400);
	}
	return value as WorkflowValidationTrigger;
}

export function normalizeWorkflowValidationTrigger(value: unknown, fallback: WorkflowValidationTrigger): WorkflowValidationTrigger {
	if (value === undefined || value === null || value === "") return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Workflow validation trigger must be a string", 400);
	const trigger = value as WorkflowValidationTrigger;
	if (trigger !== fallback && !WORKFLOW_EDIT_VALIDATION_TRIGGERS.has(trigger)) {
		throw new PiboWebHttpError(`Workflow validation trigger '${value}' is not allowed for this route`, 400);
	}
	return trigger;
}

export function normalizeWorkflowVersionIntent(value: unknown, fallback: "patch" | "minor" | "major"): "patch" | "minor" | "major" {
	if (value === undefined || value === null || value === "") return fallback;
	if (value === "patch" || value === "minor" || value === "major") return value;
	throw new PiboWebHttpError("Workflow version intent must be patch, minor, or major", 400);
}

export function cloneJsonObject(value: PiboJsonObject): PiboJsonObject {
	return JSON.parse(JSON.stringify(value)) as PiboJsonObject;
}

export function parseWorkflowDraftDefinitionFromPatch(body: WorkflowDraftPatchBody): { definition?: PiboJsonObject; trigger: WorkflowValidationTrigger; diagnostic?: WorkflowDraftDiagnostic } {
	const hasRawText = body.rawDefinitionText !== undefined;
	const hasDefinition = body.definition !== undefined;
	if (hasRawText && hasDefinition) throw new PiboWebHttpError("Provide either rawDefinitionText or definition, not both", 400);
	const trigger = normalizeWorkflowEditTrigger(body.editTrigger ?? (hasRawText ? "raw_ir_edit" : "graph_edit"));
	if (!hasRawText && !hasDefinition) return { trigger };
	if (hasRawText) return { trigger, ...parseRawWorkflowDefinitionText(body.rawDefinitionText) };
	if (!isJsonObject(body.definition)) throw new PiboWebHttpError("Workflow draft definition must be a JSON object", 400);
	return { definition: body.definition, trigger };
}

function parseRawWorkflowDefinitionText(value: unknown): { definition?: PiboJsonObject; diagnostic?: WorkflowDraftDiagnostic } {
	if (typeof value !== "string") throw new PiboWebHttpError("Raw Workflow IR text must be a string", 400);
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		return {
			diagnostic: createRawWorkflowIrParseDiagnostic("Raw Workflow IR text was not saved because it is not valid JSON."),
		};
	}
	if (!isJsonObject(parsed)) {
		return {
			diagnostic: createRawWorkflowIrParseDiagnostic("Raw Workflow IR text was not saved because it must parse to a JSON object."),
		};
	}
	return { definition: parsed };
}

function createRawWorkflowIrParseDiagnostic(message: string): WorkflowDraftDiagnostic {
	return {
		code: WORKFLOW_RAW_IR_PARSE_DIAGNOSTIC_CODE,
		message,
		severity: "warning",
		path: "$",
		hint: "Fix the raw Workflow IR text and save again; the last valid draft object remains unchanged.",
	};
}

export function withoutRawWorkflowIrParseDiagnostic(diagnostics: WorkflowDraftDiagnostic[]): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.code !== WORKFLOW_RAW_IR_PARSE_DIAGNOSTIC_CODE);
}

export function summarizeWorkflowDiagnostics(diagnostics: WorkflowDraftDiagnostic[], trigger: WorkflowValidationTrigger): WorkflowValidationSummary {
	const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const infoCount = diagnostics.filter((diagnostic) => diagnostic.severity === "info").length;
	return {
		trigger,
		checkedAt: new Date().toISOString(),
		ok: errorCount === 0,
		validationState: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "valid",
		errorCount,
		warningCount,
		infoCount,
		blocksPublish: errorCount > 0,
		blocksRun: errorCount > 0,
	};
}

export function isWorkflowValidationPipelineDiagnostic(diagnostic: WorkflowDraftDiagnostic): boolean {
	return WORKFLOW_VALIDATION_DIAGNOSTIC_PREFIXES.some((prefix) => diagnostic.code.startsWith(prefix));
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
