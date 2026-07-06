import { createHash } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";

export type WorkflowPromptAssetDocument = {
	id: string;
	displayName: string;
	description?: string;
	source: "code" | "ui";
	readOnly: boolean;
	revisionId: string;
	contentHash: string;
	markdown: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkflowDraftDiagnostic = {
	code: string;
	message: string;
	severity: "info" | "warning" | "error";
	path?: string;
	nodeId?: string;
	edgeId?: string;
	registryRef?: string;
	hint?: string;
};

export type WorkflowValidationTrigger =
	| "draft_load"
	| "graph_edit"
	| "node_edit"
	| "edge_edit"
	| "schema_edit"
	| "prompt_edit"
	| "state_edit"
	| "raw_ir_edit"
	| "before_publish"
	| "before_project_session_creation"
	| "before_workflow_start";

export type WorkflowValidationSummary = {
	trigger: WorkflowValidationTrigger;
	checkedAt: string;
	ok: boolean;
	validationState: "valid" | "warning" | "error";
	errorCount: number;
	warningCount: number;
	infoCount: number;
	blocksPublish: boolean;
	blocksRun: boolean;
};

export type WorkflowValidationResponse = {
	validation: WorkflowValidationSummary;
	diagnostics: WorkflowDraftDiagnostic[];
};

export type WorkflowDraftRecord = {
	draftId: string;
	workflowId: string;
	source: "ui";
	status: "draft";
	baseWorkflowId?: string;
	baseWorkflowVersion?: string;
	baseDefinitionHash?: string;
	targetWorkflowVersion?: string;
	versionIntent: "patch" | "minor" | "major";
	definition: PiboJsonObject;
	diagnostics: WorkflowDraftDiagnostic[];
	validationState: "unknown" | "valid" | "warning" | "error";
	validation?: WorkflowValidationSummary;
	revision: number;
	createdAt: string;
	updatedAt: string;
};

export type WorkflowPublishedVersionRecord = {
	workflowId: string;
	version: string;
	source: "ui";
	status: "published";
	definition: PiboJsonObject;
	definitionHash: string;
	publishedFromDraftId?: string;
	publishedBy?: string;
	publishedAt: string;
	createdAt: string;
};

export type WorkflowPromptAssetRecord = {
	assetId: string;
	source: "ui";
	displayName: string;
	description?: string;
	activeRevisionId?: string;
	createdAt: string;
	updatedAt: string;
};

export type WorkflowPromptAssetRevisionRecord = {
	revisionId: string;
	assetId: string;
	contentHash: string;
	markdown: string;
	createdAt: string;
	createdBy?: string;
	basedOnRevisionId?: string;
};


export type WorkflowArchiveStateRecord = {
	workflowId: string;
	source: "ui";
	archived: boolean;
	archivedAt?: string;
	archivedBy?: string;
	archiveReason?: string;
	updatedAt: string;
};

export type WorkflowTombstoneRecord = {
	workflowId: string;
	source: "ui";
	deleted: boolean;
	deletedAt: string;
	deletedBy: string;
	lastKnownTitle: string;
	lastKnownVersion?: string;
	lastDefinitionHash?: string;
	updatedAt: string;
};

export type WorkflowLifecycleEventType =
	| "workflow.draft.saved"
	| "workflow.validation.completed"
	| "workflow.publish.accepted"
	| "workflow.publish.blocked"
	| "workflow.editor_test_run.completed"
	| "workflow.editor_test_run.failed"
	| "workflow.editor_test_run.blocked"
	| "workflow.archive.updated"
	| "workflow.delete.tombstoned"
	| "project.workflow_session.created"
	| "project.workflow_start.accepted"
	| "project.workflow_start.blocked"
	| "workflow.run.status_changed"
	| "workflow.human_action.submitted";

export type WorkflowLifecycleEventRecord = {
	id: string;
	type: WorkflowLifecycleEventType;
	actorId?: string;
	workflowId?: string;
	workflowVersion?: string;
	draftId?: string;
	projectId?: string;
	piboSessionId?: string;
	workflowRunId?: string;
	status?: "saved" | "accepted" | "blocked" | "changed" | "submitted";
	validation?: WorkflowValidationSummary;
	diagnostics: WorkflowDraftDiagnostic[];
	payload?: PiboJsonObject;
	createdAt: string;
};

export type WorkflowLifecycleEventInput = Omit<WorkflowLifecycleEventRecord, "id" | "diagnostics" | "createdAt"> & {
	id?: string;
	diagnostics?: WorkflowDraftDiagnostic[];
	createdAt?: string;
};

const WORKFLOW_DIAGNOSTIC_TEXT_MAX_LENGTH = 600;
const WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH = 240;
const WORKFLOW_DIAGNOSTIC_SENSITIVE_VALUE_PATTERN = /(["']?)(promptTemplate|promptOverrides|inputValues|input|output|state|payload|edgePayload|humanActionPayload|edge payload|human action payload)\1\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\{[^{}]{0,500}\}|\[[^[\]]{0,500}\]|[^\s,;]{1,500})/gi;

export function sanitizeWorkflowDiagnostics(value: unknown): WorkflowDraftDiagnostic[] {
	if (!Array.isArray(value)) return [];
	return value.map(sanitizeWorkflowDiagnostic);
}

function sanitizeWorkflowDiagnostic(value: unknown): WorkflowDraftDiagnostic {
	const record = isWorkflowDiagnosticRecord(value) ? value : {};
	const diagnostic: WorkflowDraftDiagnostic = {
		code: normalizeWorkflowDiagnosticString(record.code, WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH) ?? "WorkflowDiagnostic.redacted",
		message: normalizeWorkflowDiagnosticText(record.message) ?? "Workflow diagnostic details were redacted.",
		severity: normalizeWorkflowDiagnosticSeverity(record.severity),
	};
	const path = normalizeWorkflowDiagnosticString(record.path, WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH);
	if (path) diagnostic.path = path;
	const nodeId = normalizeWorkflowDiagnosticString(record.nodeId, WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH);
	if (nodeId) diagnostic.nodeId = nodeId;
	const edgeId = normalizeWorkflowDiagnosticString(record.edgeId, WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH);
	if (edgeId) diagnostic.edgeId = edgeId;
	const registryRef = normalizeWorkflowDiagnosticString(record.registryRef, WORKFLOW_DIAGNOSTIC_REF_MAX_LENGTH);
	if (registryRef) diagnostic.registryRef = registryRef;
	const hint = normalizeWorkflowDiagnosticText(record.hint);
	if (hint) diagnostic.hint = hint;
	return diagnostic;
}

function isWorkflowDiagnosticRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkflowDiagnosticSeverity(value: unknown): WorkflowDraftDiagnostic["severity"] {
	return value === "info" || value === "warning" || value === "error" ? value : "error";
}

function normalizeWorkflowDiagnosticText(value: unknown): string | undefined {
	const text = normalizeWorkflowDiagnosticString(value, WORKFLOW_DIAGNOSTIC_TEXT_MAX_LENGTH);
	if (!text) return undefined;
	return truncateWorkflowDiagnosticText(redactWorkflowDiagnosticText(text));
}

function normalizeWorkflowDiagnosticString(value: unknown, maxLength: number): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function redactWorkflowDiagnosticText(text: string): string {
	return text.replace(WORKFLOW_DIAGNOSTIC_SENSITIVE_VALUE_PATTERN, (_match, quote: string, label: string) => `${quote}${label}${quote}: [redacted]`);
}

function truncateWorkflowDiagnosticText(text: string): string {
	return text.length > WORKFLOW_DIAGNOSTIC_TEXT_MAX_LENGTH ? `${text.slice(0, WORKFLOW_DIAGNOSTIC_TEXT_MAX_LENGTH)}…` : text;
}

export function hashPromptAssetMarkdown(markdown: string): string {
	return `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

export function normalizeWorkflowPromptAssetLabel(value: unknown): string {
	if (typeof value !== "string") return "Workflow prompt asset";
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 120) : "Workflow prompt asset";
}

type ParsedWorkflowSemver = { major: number; minor: number; patch: number };

export function allocateWorkflowPublishedVersion(input: {
	draft: WorkflowDraftRecord;
	versionIntent: "patch" | "minor" | "major";
	existingVersions: string[];
}): string {
	const existing = new Set(input.existingVersions);
	let base = maxWorkflowSemver([
		...input.existingVersions,
		input.draft.baseWorkflowVersion ?? (typeof input.draft.definition.version === "string" ? input.draft.definition.version : undefined),
	]);
	base ??= { major: 0, minor: 0, patch: 0 };
	let candidate = bumpWorkflowSemver(base, input.versionIntent);
	while (existing.has(formatWorkflowSemver(candidate))) {
		candidate = bumpWorkflowSemver(candidate, input.versionIntent);
	}
	return formatWorkflowSemver(candidate);
}

function maxWorkflowSemver(versions: Array<string | undefined>): ParsedWorkflowSemver | undefined {
	let max: ParsedWorkflowSemver | undefined;
	for (const version of versions) {
		const parsed = version ? parseWorkflowSemver(version) : undefined;
		if (parsed && (!max || compareWorkflowSemver(parsed, max) > 0)) max = parsed;
	}
	return max;
}

export function parseWorkflowSemver(version: string): ParsedWorkflowSemver | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) return undefined;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareWorkflowSemver(left: ParsedWorkflowSemver, right: ParsedWorkflowSemver): number {
	return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function bumpWorkflowSemver(version: ParsedWorkflowSemver, intent: "patch" | "minor" | "major"): ParsedWorkflowSemver {
	if (intent === "major") return { major: version.major + 1, minor: 0, patch: 0 };
	if (intent === "minor") return { major: version.major, minor: version.minor + 1, patch: 0 };
	return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

function formatWorkflowSemver(version: ParsedWorkflowSemver): string {
	return `${version.major}.${version.minor}.${version.patch}`;
}

export function workflowDraftDefinitionForPublishedVersion(definition: PiboJsonObject, workflowId: string, version: string): PiboJsonObject {
	return {
		...cloneJsonObject(definition),
		id: workflowId,
		version,
	};
}

export function hashWorkflowDefinitionJson(definition: PiboJsonObject): string {
	return `sha256:${createHash("sha256").update(canonicalWorkflowDefinitionJson(definition)).digest("hex")}`;
}

export function canonicalWorkflowDefinitionJson(definition: PiboJsonObject): string {
	return JSON.stringify(normalizeForCanonicalJson(definition));
}

export function normalizeForCanonicalJson(value: PiboJsonValue | undefined): PiboJsonValue | undefined {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeForCanonicalJson(item) ?? null);
	}
	if (value && typeof value === "object") {
		const output: PiboJsonObject = {};
		for (const key of Object.keys(value).sort()) {
			const normalized = normalizeForCanonicalJson(value[key]);
			if (normalized !== undefined) output[key] = normalized;
		}
		return output;
	}
	return value;
}

function cloneJsonObject(value: PiboJsonObject): PiboJsonObject {
	return JSON.parse(JSON.stringify(value)) as PiboJsonObject;
}
