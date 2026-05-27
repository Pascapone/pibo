import type { PiboJsonObject } from "../../core/events.js";
import { PiboWebHttpError } from "../../web/http.js";
import type { PiboWebAppContext, PiboWebSession } from "../../web/types.js";
import {
	compareWorkflowSemver,
	hashWorkflowDefinitionJson,
	parseWorkflowSemver,
	sanitizeWorkflowDiagnostics,
	type OwnedWorkflowDraftRecord,
	type WorkflowArchiveStateRecord,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowPublishedVersionRecord,
	type WorkflowTombstoneRecord,
	type WorkflowValidationSummary,
	type WorkflowValidationTrigger,
} from "./workflow-persistence.js";

export type WorkflowCatalogVersionRecord = {
	id: string;
	version: string;
	title: string;
	description?: string;
	source: "code" | "ui";
	status: "draft" | "published" | "archived" | "deleted";
	tags: string[];
};

export type WorkflowVersionPickerOption = WorkflowCatalogVersionRecord & {
	status: "published";
	displayName: string;
	paramsSchema: PiboJsonObject | null;
};

export type WorkflowPublishedVersionSelection = WorkflowVersionPickerOption & {
	definition: PiboJsonObject;
	definitionHash: string;
};

export type WorkflowVersionPickerResponse = {
	kind: "workflow-versions";
	options: WorkflowVersionPickerOption[];
	selectedWorkflowId?: string;
	selectedWorkflowVersion?: string;
	diagnostics: WorkflowDraftDiagnostic[];
};

export type WorkflowVersionHistoryOption = WorkflowCatalogVersionRecord & {
	actions: WorkflowCatalogAction[];
	editability: WorkflowCatalogEditability;
};

export type WorkflowVersionHistoryResponse = {
	kind: "version-history";
	options: WorkflowVersionHistoryOption[];
	selectedWorkflowId?: string;
	selectedWorkflowVersion?: string;
	diagnostics: WorkflowDraftDiagnostic[];
};

export type WorkflowCatalogAction =
	| "view"
	| "duplicate"
	| "create_project_session"
	| "edit_draft"
	| "validate"
	| "publish"
	| "create_next_draft"
	| "version_history"
	| "archive"
	| "delete";

export type WorkflowCatalogEditability = {
	canView: boolean;
	canDuplicate: boolean;
	canEditDraft: boolean;
	canCreateDraft: boolean;
	canValidate: boolean;
	canPublish: boolean;
	canArchive: boolean;
	canDelete: boolean;
	canCreateProjectSession: boolean;
};

export type WorkflowCatalogVersionSummary = WorkflowCatalogVersionRecord & {
	definitionHash?: string;
	validationState: "unknown" | "valid" | "warning" | "error";
	diagnostics: WorkflowDraftDiagnostic[];
	missingRefs: WorkflowDraftDiagnostic[];
	actions: WorkflowCatalogAction[];
};

export type WorkflowCatalogRecord = {
	id: string;
	title: string;
	description?: string;
	tags: string[];
	source: "code" | "ui";
	status: "draft" | "published" | "archived" | "deleted";
	versions: WorkflowCatalogVersionSummary[];
	activeDraftId?: string;
	editability: WorkflowCatalogEditability;
	validationState: "unknown" | "valid" | "warning" | "error";
	diagnostics: WorkflowDraftDiagnostic[];
	missingRefs: WorkflowDraftDiagnostic[];
	actions: WorkflowCatalogAction[];
};

export type WorkflowCatalogListResponse = {
	kind: "workflow-catalog";
	includeArchived: boolean;
	workflows: WorkflowCatalogRecord[];
};

export type WorkflowCatalogInspectResponse = {
	kind: "workflow-inspect";
	workflow: WorkflowCatalogRecord;
	selected:
		| { kind: "draft"; draft: WorkflowDraftRecord }
		| {
			kind: "publishedVersion";
			version: WorkflowCatalogVersionRecord & { definitionHash: string };
			definition: PiboJsonObject;
			validation: WorkflowValidationSummary;
		};
	diagnostics: WorkflowDraftDiagnostic[];
};

export type WorkflowVersionListResponse = {
	kind: "workflow-version-list";
	workflowId: string;
	includeArchived: boolean;
	workflow: WorkflowCatalogRecord;
	versions: WorkflowCatalogVersionSummary[];
};

export type WorkflowVersionInspectResponse = {
	kind: "workflow-version-inspect";
	workflow: WorkflowCatalogRecord;
	version: WorkflowCatalogVersionRecord & { definitionHash: string };
	definition: PiboJsonObject;
	validation: WorkflowValidationSummary;
	diagnostics: WorkflowDraftDiagnostic[];
	missingRefs: WorkflowDraftDiagnostic[];
};

export type WorkflowCatalogState = {
	workflowDraftStore: {
		listDrafts(): OwnedWorkflowDraftRecord[];
		getDraft(draftId: string): OwnedWorkflowDraftRecord | undefined;
		findActiveDraftByWorkflowId(workflowId: string): OwnedWorkflowDraftRecord | undefined;
	};
	workflowPublishedVersionStore: {
		listPublishedVersions(options?: { workflowId?: string }): WorkflowPublishedVersionRecord[];
	};
	workflowArchiveStore: {
		getWorkflowArchiveState(workflowId: string): WorkflowArchiveStateRecord | undefined;
	};
	workflowTombstoneStore: {
		getWorkflowTombstone(workflowId: string): WorkflowTombstoneRecord | undefined;
	};
};

export type WorkflowCatalogServices<TState extends WorkflowCatalogState> = {
	validateDefinition(definition: PiboJsonObject, input: { state: TState; context: PiboWebAppContext; webSession: PiboWebSession }): WorkflowDraftDiagnostic[];
	summarizeDiagnostics(diagnostics: WorkflowDraftDiagnostic[], trigger: WorkflowValidationTrigger): WorkflowValidationSummary;
	runDraftValidation(state: TState, context: PiboWebAppContext, webSession: PiboWebSession, record: OwnedWorkflowDraftRecord, trigger: WorkflowValidationTrigger): unknown;
	serializeDraft(record: OwnedWorkflowDraftRecord): WorkflowDraftRecord;
};

export const STATIC_WORKFLOW_VERSION_CATALOG: WorkflowCatalogVersionRecord[] = [
	{
		id: "standard-project",
		version: "1.0.0",
		title: "Standard Project",
		description: "Configured workflow-backed Project session for feature, bugfix, and review work. Creation saves the configuration without starting a run.",
		source: "code",
		status: "published",
		tags: ["project", "workflow"],
	},
	{
		id: "simple-chat",
		version: "1.0.0",
		title: "Simple Chat",
		description: "Baseline Project chat workflow that preserves the existing one-session chat behavior.",
		source: "code",
		status: "published",
		tags: ["project", "chat"],
	},
	{
		id: "ui-review-workflow",
		version: "2.0.0",
		title: "UI Review Workflow",
		description: "UI-authored published workflow fixture for next-version draft editing.",
		source: "ui",
		status: "published",
		tags: ["workflow-ui", "review"],
	},
	{
		id: "ui-draft-workflow",
		version: "0.1.0-draft",
		title: "UI Draft Workflow",
		description: "Unpublished fixture used to enforce Project session creation boundaries.",
		source: "ui",
		status: "draft",
		tags: ["workflow-ui", "draft"],
	},
	{
		id: "archived-review-workflow",
		version: "1.0.0",
		title: "Archived Review Workflow",
		description: "Archived fixture omitted from default Project session creation choices.",
		source: "ui",
		status: "archived",
		tags: ["workflow-ui", "archived"],
	},
];

export function buildWorkflowVersionPicker(state: WorkflowCatalogState, selectedWorkflowId?: string, selectedWorkflowVersion?: string): WorkflowVersionPickerResponse {
	const options = buildProjectWorkflowVersionOptions(state);
	const normalizedWorkflowId = selectedWorkflowId?.trim() || undefined;
	const normalizedWorkflowVersion = selectedWorkflowVersion?.trim() || undefined;
	const selected = normalizedWorkflowId
		? options.find((option) => option.id === normalizedWorkflowId && (!normalizedWorkflowVersion || option.version === normalizedWorkflowVersion))
		: options[0];
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	if (normalizedWorkflowId && !selected) {
		diagnostics.push({
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			message: `Workflow version '${normalizedWorkflowId}${normalizedWorkflowVersion ? `@${normalizedWorkflowVersion}` : ""}' is not available for Project session creation.`,
			severity: "error",
			path: "$.workflow",
			registryRef: normalizedWorkflowVersion ? `${normalizedWorkflowId}@${normalizedWorkflowVersion}` : normalizedWorkflowId,
			hint: "Select a published workflow version from the global workflow catalog.",
		});
	}
	return {
		kind: "workflow-versions",
		options,
		...(selected ? { selectedWorkflowId: selected.id, selectedWorkflowVersion: selected.version } : {}),
		diagnostics,
	};
}

export function buildWorkflowVersionHistory(state: WorkflowCatalogState, selectedWorkflowId?: string, selectedWorkflowVersion?: string): WorkflowVersionHistoryResponse {
	const options = [...buildProjectWorkflowVersionCatalog(state)]
		.filter((option) => option.status !== "deleted")
		.sort(compareWorkflowCatalogVersionRecords)
		.map(workflowVersionHistoryOptionFromCatalogRecord);
	const normalizedWorkflowId = selectedWorkflowId?.trim() || undefined;
	const normalizedWorkflowVersion = selectedWorkflowVersion?.trim() || undefined;
	const selected = normalizedWorkflowId
		? options.find((option) => option.id === normalizedWorkflowId && (!normalizedWorkflowVersion || option.version === normalizedWorkflowVersion))
		: undefined;
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	if (normalizedWorkflowId && !selected) {
		diagnostics.push({
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			message: `Workflow version '${normalizedWorkflowId}${normalizedWorkflowVersion ? `@${normalizedWorkflowVersion}` : ""}' is not present in workflow version history.`,
			severity: "error",
			path: "$.workflow",
			registryRef: normalizedWorkflowVersion ? `${normalizedWorkflowId}@${normalizedWorkflowVersion}` : normalizedWorkflowId,
			hint: "Open a live, archived, or snapshot-backed workflow version record from the catalog history.",
		});
	}
	return {
		kind: "version-history",
		options,
		...(selected ? { selectedWorkflowId: selected.id, selectedWorkflowVersion: selected.version } : {}),
		diagnostics,
	};
}

export function buildProjectWorkflowVersionOptions(state?: WorkflowCatalogState): WorkflowVersionPickerOption[] {
	return buildProjectWorkflowVersionCatalog(state)
		.filter((option): option is WorkflowCatalogVersionRecord & { status: "published" } => option.status === "published")
		.map(workflowVersionPickerOptionFromCatalogRecord);
}

export function workflowVersionPickerOptionFromCatalogRecord(record: WorkflowCatalogVersionRecord & { status: "published" }): WorkflowVersionPickerOption {
	return {
		...record,
		displayName: record.title,
		paramsSchema: null,
	};
}

function workflowVersionHistoryOptionFromCatalogRecord(record: WorkflowCatalogVersionRecord): WorkflowVersionHistoryOption {
	const actions = workflowCatalogActionsFor(record);
	return {
		...record,
		actions,
		editability: workflowCatalogEditability(actions),
	};
}

export function buildProjectWorkflowVersionCatalog(state?: WorkflowCatalogState): WorkflowCatalogVersionRecord[] {
	const recordsByKey = new Map<string, WorkflowCatalogVersionRecord>();
	for (const record of STATIC_WORKFLOW_VERSION_CATALOG) {
		const projected = workflowCatalogRecordWithArchiveState(record, state);
		recordsByKey.set(workflowCatalogVersionKey(projected.id, projected.version), projected);
	}
	if (state) {
		for (const record of state.workflowPublishedVersionStore.listPublishedVersions()) {
			const projected = workflowCatalogRecordWithArchiveState(workflowCatalogRecordFromPublishedVersion(record), state);
			recordsByKey.set(workflowCatalogVersionKey(projected.id, projected.version), projected);
		}
	}
	return [...recordsByKey.values()];
}

function workflowCatalogRecordWithArchiveState(record: WorkflowCatalogVersionRecord, state?: WorkflowCatalogState): WorkflowCatalogVersionRecord {
	if (record.source === "ui" && state?.workflowTombstoneStore.getWorkflowTombstone(record.id)) return { ...record, status: "deleted" };
	const archiveState = state?.workflowArchiveStore.getWorkflowArchiveState(record.id);
	if (record.source === "ui" && archiveState?.archived) return { ...record, status: "archived" };
	return record;
}

function workflowCatalogVersionKey(workflowId: string, version: string): string {
	return `${workflowId}@${version}`;
}

function workflowCatalogRecordFromPublishedVersion(record: WorkflowPublishedVersionRecord): WorkflowCatalogVersionRecord {
	return {
		id: record.workflowId,
		version: record.version,
		title: typeof record.definition.title === "string" ? record.definition.title : record.workflowId,
		...(typeof record.definition.description === "string" ? { description: record.definition.description } : {}),
		source: "ui",
		status: "published",
		tags: workflowDefinitionTags(record.definition),
	};
}

const WORKFLOW_CATALOG_STATUS_SORT_ORDER: Record<WorkflowCatalogVersionRecord["status"], number> = {
	published: 0,
	draft: 1,
	archived: 2,
	deleted: 3,
};

export function compareWorkflowCatalogVersionRecords(left: WorkflowCatalogVersionRecord, right: WorkflowCatalogVersionRecord): number {
	return left.id.localeCompare(right.id)
		|| compareWorkflowCatalogVersionStrings(left.version, right.version)
		|| WORKFLOW_CATALOG_STATUS_SORT_ORDER[left.status] - WORKFLOW_CATALOG_STATUS_SORT_ORDER[right.status]
		|| left.title.localeCompare(right.title);
}

function compareWorkflowCatalogVersionStrings(left: string, right: string): number {
	const leftSemver = parseWorkflowSemver(left);
	const rightSemver = parseWorkflowSemver(right);
	if (leftSemver && rightSemver) return compareWorkflowSemver(leftSemver, rightSemver);
	if (leftSemver) return -1;
	if (rightSemver) return 1;
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function workflowDefinitionTags(definition: PiboJsonObject): string[] {
	const metadata = isJsonObject(definition.metadata) ? definition.metadata : undefined;
	const tags = metadata && Array.isArray(metadata.tags) ? metadata.tags : [];
	return tags.filter((tag): tag is string => typeof tag === "string");
}

type WorkflowCatalogBuildContext<TState extends WorkflowCatalogState> = {
	state: TState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	includeArchived: boolean;
	services: WorkflowCatalogServices<TState>;
};

type WorkflowCatalogAccumulator = {
	id: string;
	title: string;
	description?: string;
	source: "code" | "ui";
	tags: Set<string>;
	versions: WorkflowCatalogVersionSummary[];
	activeDraftId?: string;
};

export function buildWorkflowCatalogList<TState extends WorkflowCatalogState>(
	state: TState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	services: WorkflowCatalogServices<TState>,
	options: { includeArchived?: boolean } = {},
): WorkflowCatalogListResponse {
	const includeArchived = options.includeArchived === true;
	const workflows = new Map<string, WorkflowCatalogAccumulator>();
	const buildContext: WorkflowCatalogBuildContext<TState> = { state, context, webSession, includeArchived, services };

	for (const record of STATIC_WORKFLOW_VERSION_CATALOG) {
		if (record.status === "draft") continue;
		const summary = workflowCatalogVersionSummaryFromCatalogRecord(record, buildContext);
		if (!isWorkflowCatalogSummaryVisible(summary, includeArchived)) continue;
		addWorkflowCatalogVersion(workflows, summary);
	}

	for (const record of state.workflowPublishedVersionStore.listPublishedVersions()) {
		const summary = workflowCatalogVersionSummaryFromPublishedVersion(record, buildContext);
		if (!isWorkflowCatalogSummaryVisible(summary, includeArchived)) continue;
		addWorkflowCatalogVersion(workflows, summary);
	}

	for (const draft of state.workflowDraftStore.listDrafts()) {
		const summary = workflowCatalogVersionSummaryFromDraft(draft, state);
		if (!isWorkflowCatalogSummaryVisible(summary, includeArchived)) continue;
		addWorkflowCatalogVersion(workflows, summary);
		const accumulator = workflows.get(draft.workflowId);
		if (accumulator) accumulator.activeDraftId = draft.draftId;
	}

	return {
		kind: "workflow-catalog",
		includeArchived,
		workflows: [...workflows.values()]
			.map(workflowCatalogRecordFromAccumulator)
			.sort(compareWorkflowCatalogRecords),
	};
}

function isWorkflowCatalogSummaryVisible(summary: WorkflowCatalogVersionSummary, includeArchived: boolean): boolean {
	if (summary.status === "deleted") return false;
	if (summary.status === "archived" && !includeArchived) return false;
	return true;
}

function addWorkflowCatalogVersion(workflows: Map<string, WorkflowCatalogAccumulator>, summary: WorkflowCatalogVersionSummary): void {
	const existing = workflows.get(summary.id);
	const accumulator = existing ?? {
		id: summary.id,
		title: summary.title,
		...(summary.description ? { description: summary.description } : {}),
		source: summary.source,
		tags: new Set<string>(),
		versions: [],
	};
	if (!existing) workflows.set(summary.id, accumulator);
	if (summary.source === "ui") accumulator.source = "ui";
	if (summary.status === "draft") {
		accumulator.title = summary.title;
		if (summary.description) accumulator.description = summary.description;
	}
	for (const tag of summary.tags) accumulator.tags.add(tag);
	accumulator.versions.push(summary);
}

function workflowCatalogRecordFromAccumulator(accumulator: WorkflowCatalogAccumulator): WorkflowCatalogRecord {
	const versions = [...accumulator.versions].sort(compareWorkflowCatalogVersionRecords);
	const diagnostics = uniqueWorkflowDiagnostics(versions.flatMap((version) => version.diagnostics));
	const actions = uniqueWorkflowCatalogActions(versions.flatMap((version) => version.actions));
	const latest = selectWorkflowCatalogDisplayVersion(versions);
	return {
		id: accumulator.id,
		title: latest?.title ?? accumulator.title,
		...(latest?.description ?? accumulator.description ? { description: latest?.description ?? accumulator.description } : {}),
		tags: [...new Set([...accumulator.tags, ...(latest?.tags ?? [])])].sort(),
		source: accumulator.source,
		status: deriveWorkflowCatalogStatus(versions),
		versions,
		...(accumulator.activeDraftId ? { activeDraftId: accumulator.activeDraftId } : {}),
		editability: workflowCatalogEditability(actions),
		validationState: workflowCatalogValidationStateFromVersions(versions),
		diagnostics,
		missingRefs: workflowMissingRefDiagnostics(diagnostics),
		actions,
	};
}

export function selectWorkflowCatalogDisplayVersion(versions: WorkflowCatalogVersionSummary[]): WorkflowCatalogVersionSummary | undefined {
	const sorted = [...versions].sort(compareWorkflowCatalogVersionRecords);
	return [...sorted].reverse().find((version) => version.status === "draft")
		?? [...sorted].reverse().find((version) => version.status === "published")
		?? sorted[0];
}

function deriveWorkflowCatalogStatus(versions: WorkflowCatalogVersionSummary[]): WorkflowCatalogRecord["status"] {
	if (versions.some((version) => version.status === "draft")) return "draft";
	if (versions.some((version) => version.status === "published")) return "published";
	if (versions.some((version) => version.status === "archived")) return "archived";
	return versions[0]?.status ?? "deleted";
}

function workflowCatalogVersionSummaryFromCatalogRecord<TState extends WorkflowCatalogState>(record: WorkflowCatalogVersionRecord, context: WorkflowCatalogBuildContext<TState>): WorkflowCatalogVersionSummary {
	const catalogRecord = workflowCatalogRecordWithArchiveState(record, context.state);
	const definition = catalogRecord.status === "published" || catalogRecord.status === "archived"
		? createPublishedWorkflowDefinition(catalogRecord, "base")
		: undefined;
	const diagnostics = definition ? context.services.validateDefinition(definition, context) : [];
	return {
		...catalogRecord,
		...(definition ? { definitionHash: hashWorkflowDefinitionJson(definition) } : {}),
		validationState: workflowCatalogValidationStateFromDiagnostics(diagnostics, definition ? "valid" : "unknown"),
		diagnostics,
		missingRefs: workflowMissingRefDiagnostics(diagnostics),
		actions: workflowCatalogActionsFor(catalogRecord),
	};
}

function workflowCatalogVersionSummaryFromPublishedVersion<TState extends WorkflowCatalogState>(record: WorkflowPublishedVersionRecord, context: WorkflowCatalogBuildContext<TState>): WorkflowCatalogVersionSummary {
	const catalogRecord = workflowCatalogRecordWithArchiveState(workflowCatalogRecordFromPublishedVersion(record), context.state);
	const diagnostics = context.services.validateDefinition(record.definition, context);
	return {
		...catalogRecord,
		definitionHash: record.definitionHash,
		validationState: workflowCatalogValidationStateFromDiagnostics(diagnostics, "valid"),
		diagnostics,
		missingRefs: workflowMissingRefDiagnostics(diagnostics),
		actions: workflowCatalogActionsFor(catalogRecord),
	};
}

function workflowCatalogVersionSummaryFromDraft(draft: OwnedWorkflowDraftRecord, state: WorkflowCatalogState): WorkflowCatalogVersionSummary {
	const record = workflowCatalogRecordWithArchiveState(workflowCatalogRecordFromDraft(draft), state);
	const diagnostics = sanitizeWorkflowDiagnostics(draft.diagnostics);
	return {
		...record,
		validationState: draft.validationState,
		diagnostics,
		missingRefs: workflowMissingRefDiagnostics(diagnostics),
		actions: workflowCatalogActionsFor(record),
	};
}

function workflowCatalogRecordFromDraft(draft: OwnedWorkflowDraftRecord): WorkflowCatalogVersionRecord {
	return {
		id: draft.workflowId,
		version: workflowDraftVersionLabel(draft),
		title: typeof draft.definition.title === "string" ? draft.definition.title : draft.workflowId,
		...(typeof draft.definition.description === "string" ? { description: draft.definition.description } : {}),
		source: "ui",
		status: "draft",
		tags: workflowDefinitionTags(draft.definition),
	};
}

function workflowDraftVersionLabel(draft: OwnedWorkflowDraftRecord): string {
	if (typeof draft.definition.version === "string" && draft.definition.version.trim()) return draft.definition.version.trim();
	return draft.targetWorkflowVersion ?? "draft";
}

export function workflowCatalogActionsFor(record: Pick<WorkflowCatalogVersionRecord, "source" | "status">): WorkflowCatalogAction[] {
	if (record.status === "draft") return ["view", "edit_draft", "validate", "publish", "archive", "delete"];
	if (record.status === "archived") return ["view", "version_history"];
	if (record.status === "deleted") return ["view"];
	const actions: WorkflowCatalogAction[] = ["view", "duplicate", "create_project_session", "version_history"];
	if (record.source === "ui") actions.push("create_next_draft", "archive", "delete");
	return actions;
}

export function workflowCatalogEditability(actions: WorkflowCatalogAction[]): WorkflowCatalogEditability {
	return {
		canView: actions.includes("view"),
		canDuplicate: actions.includes("duplicate"),
		canEditDraft: actions.includes("edit_draft"),
		canCreateDraft: actions.includes("create_next_draft"),
		canValidate: actions.includes("validate"),
		canPublish: actions.includes("publish"),
		canArchive: actions.includes("archive"),
		canDelete: actions.includes("delete"),
		canCreateProjectSession: actions.includes("create_project_session"),
	};
}

function workflowCatalogValidationStateFromDiagnostics(
	diagnostics: WorkflowDraftDiagnostic[],
	fallback: "unknown" | "valid" | "warning" | "error" = "unknown",
): "unknown" | "valid" | "warning" | "error" {
	if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return "error";
	if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) return "warning";
	if (diagnostics.some((diagnostic) => diagnostic.severity === "info")) return fallback === "unknown" ? "warning" : fallback;
	return fallback;
}

function workflowCatalogValidationStateFromVersions(versions: WorkflowCatalogVersionSummary[]): "unknown" | "valid" | "warning" | "error" {
	const states = versions.map((version) => version.validationState);
	if (states.includes("error")) return "error";
	if (states.includes("warning")) return "warning";
	if (states.includes("valid")) return "valid";
	return "unknown";
}

const WORKFLOW_MISSING_REF_DIAGNOSTIC_CODES = new Set([
	"WorkflowGraphError.unknownAgentProfileRef",
	"WorkflowGraphError.archivedAgentProfileRef",
	"WorkflowGraphError.unknownHandlerRef",
	"WorkflowGraphError.unknownAdapterRef",
	"WorkflowGraphError.unknownGuardRef",
	"WorkflowGraphError.unknownPromptBuilderRef",
	"WorkflowGraphError.unknownHumanActionRef",
	"WorkflowCatalogError.unknownWorkflowVersion",
]);

export function workflowMissingRefDiagnostics(diagnostics: WorkflowDraftDiagnostic[]): WorkflowDraftDiagnostic[] {
	return uniqueWorkflowDiagnostics(sanitizeWorkflowDiagnostics(diagnostics).filter(isWorkflowMissingRefDiagnostic));
}

function isWorkflowMissingRefDiagnostic(diagnostic: WorkflowDraftDiagnostic): boolean {
	return Boolean(diagnostic.registryRef && WORKFLOW_MISSING_REF_DIAGNOSTIC_CODES.has(diagnostic.code));
}

function uniqueWorkflowDiagnostics(diagnostics: WorkflowDraftDiagnostic[]): WorkflowDraftDiagnostic[] {
	const seen = new Set<string>();
	return diagnostics.filter((diagnostic) => {
		const key = [diagnostic.code, diagnostic.path ?? "", diagnostic.nodeId ?? "", diagnostic.edgeId ?? "", diagnostic.registryRef ?? "", diagnostic.message].join("\u0000");
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function uniqueWorkflowCatalogActions(actions: WorkflowCatalogAction[]): WorkflowCatalogAction[] {
	return [...new Set(actions)].sort();
}

function compareWorkflowCatalogRecords(left: WorkflowCatalogRecord, right: WorkflowCatalogRecord): number {
	return left.id.localeCompare(right.id);
}

export function buildWorkflowCatalogInspect<TState extends WorkflowCatalogState>(
	state: TState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	services: WorkflowCatalogServices<TState>,
	workflowId: string,
	options: { includeArchived?: boolean; version?: string; draftId?: string } = {},
): WorkflowCatalogInspectResponse {
	let selectedDraft: OwnedWorkflowDraftRecord | undefined;
	if (options.draftId) {
		selectedDraft = state.workflowDraftStore.getDraft(options.draftId);
		if (!selectedDraft || selectedDraft.workflowId !== workflowId) throw new PiboWebHttpError("Workflow draft not found", 404);
	} else if (!options.version) {
		selectedDraft = state.workflowDraftStore.findActiveDraftByWorkflowId(workflowId);
	}
	if (selectedDraft) services.runDraftValidation(state, context, webSession, selectedDraft, "draft_load");

	const catalog = buildWorkflowCatalogList(state, context, webSession, services, { includeArchived: options.includeArchived });
	const workflow = catalog.workflows.find((record) => record.id === workflowId);
	if (!workflow) throw new PiboWebHttpError("Workflow not found", 404);

	if (selectedDraft) {
		return {
			kind: "workflow-inspect",
			workflow,
			selected: { kind: "draft", draft: services.serializeDraft(selectedDraft) },
			diagnostics: sanitizeWorkflowDiagnostics(selectedDraft.diagnostics),
		};
	}

	const version = options.version ?? selectWorkflowCatalogDisplayVersion(workflow.versions)?.version;
	const published = version ? workflowPublishedVersionInspection(state, context, webSession, services, workflowId, version, options.includeArchived === true) : undefined;
	if (published) {
		return {
			kind: "workflow-inspect",
			workflow,
			selected: {
				kind: "publishedVersion",
				version: published.version,
				definition: published.definition,
				validation: published.validation,
			},
			diagnostics: published.diagnostics,
		};
	}

	throw new PiboWebHttpError("Workflow version not found", 404);
}

function workflowPublishedVersionInspection<TState extends WorkflowCatalogState>(
	state: TState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	services: WorkflowCatalogServices<TState>,
	workflowId: string,
	version: string,
	includeArchived: boolean,
): { version: WorkflowCatalogVersionRecord & { definitionHash: string }; definition: PiboJsonObject; validation: WorkflowValidationSummary; diagnostics: WorkflowDraftDiagnostic[] } | undefined {
	const persisted = state.workflowPublishedVersionStore.listPublishedVersions({ workflowId }).find((record) => record.version === version);
	if (persisted) {
		const catalogRecord = workflowCatalogRecordWithArchiveState(workflowCatalogRecordFromPublishedVersion(persisted), state);
		if (catalogRecord.status === "deleted" || (catalogRecord.status === "archived" && !includeArchived)) return undefined;
		const diagnostics = services.validateDefinition(persisted.definition, { state, context, webSession });
		return {
			version: { ...catalogRecord, definitionHash: persisted.definitionHash },
			definition: persisted.definition,
			validation: services.summarizeDiagnostics(diagnostics, "draft_load"),
			diagnostics,
		};
	}

	const staticRecord = STATIC_WORKFLOW_VERSION_CATALOG.find((record) => record.id === workflowId && record.version === version);
	const catalogRecord = staticRecord ? workflowCatalogRecordWithArchiveState(staticRecord, state) : undefined;
	if (!catalogRecord || catalogRecord.status === "draft" || catalogRecord.status === "deleted" || (catalogRecord.status === "archived" && !includeArchived)) return undefined;
	const definition = createPublishedWorkflowDefinition(catalogRecord, "base");
	const diagnostics = services.validateDefinition(definition, { state, context, webSession });
	return {
		version: { ...catalogRecord, definitionHash: hashWorkflowDefinitionJson(definition) },
		definition,
		validation: services.summarizeDiagnostics(diagnostics, "draft_load"),
		diagnostics,
	};
}

export function buildWorkflowVersionList<TState extends WorkflowCatalogState>(
	state: TState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	services: WorkflowCatalogServices<TState>,
	workflowId: string,
	options: { includeArchived?: boolean } = {},
): WorkflowVersionListResponse {
	const includeArchived = options.includeArchived === true;
	const catalog = buildWorkflowCatalogList(state, context, webSession, services, { includeArchived });
	const workflow = catalog.workflows.find((record) => record.id === workflowId);
	if (!workflow) throw new PiboWebHttpError("Workflow not found", 404);
	return {
		kind: "workflow-version-list",
		workflowId,
		includeArchived,
		workflow,
		versions: workflow.versions
			.filter((version) => version.status === "published" || version.status === "archived")
			.sort(compareWorkflowCatalogVersionRecords),
	};
}

export function buildWorkflowVersionInspect<TState extends WorkflowCatalogState>(
	state: TState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	services: WorkflowCatalogServices<TState>,
	workflowId: string,
	version: string,
	options: { includeArchived?: boolean } = {},
): WorkflowVersionInspectResponse {
	const includeArchived = options.includeArchived === true;
	const catalog = buildWorkflowCatalogList(state, context, webSession, services, { includeArchived });
	const workflow = catalog.workflows.find((record) => record.id === workflowId);
	if (!workflow) throw new PiboWebHttpError("Workflow not found", 404);
	const published = workflowPublishedVersionInspection(state, context, webSession, services, workflowId, version, includeArchived);
	if (!published) throw new PiboWebHttpError("Workflow version not found", 404);
	const diagnostics = sanitizeWorkflowDiagnostics(published.diagnostics);
	return {
		kind: "workflow-version-inspect",
		workflow,
		version: published.version,
		definition: published.definition,
		validation: published.validation,
		diagnostics,
		missingRefs: workflowMissingRefDiagnostics(diagnostics),
	};
}

export function createPublishedWorkflowDefinition(workflow: WorkflowCatalogVersionRecord, profileId: string): PiboJsonObject {
	return createRunnableWorkflowDefinition({
		workflowId: workflow.id,
		version: workflow.version,
		title: workflow.title,
		description: workflow.description ?? `${workflow.title} workflow.`,
		tags: workflow.tags,
		profileId,
	});
}

function createRunnableWorkflowDefinition(input: {
	workflowId: string;
	version: string;
	title: string;
	description: string;
	tags: string[];
	profileId: string;
	metadata?: PiboJsonObject;
}): PiboJsonObject {
	return {
		id: input.workflowId,
		version: input.version,
		title: input.title,
		description: input.description,
		input: {
			kind: "text",
			description: "Workflow input provided when a Project session starts.",
		},
		output: {
			kind: "text",
			description: "Workflow output returned to the Project session.",
		},
		initial: "agent",
		nodes: {
			agent: {
				kind: "agent",
				runtime: "pibo",
				profile: { kind: "fixed", id: input.profileId },
				promptTemplate: "Use the workflow input to produce a concise answer.\n\n{{input}}",
				metadata: { sessionOverrides: { prompt: true } },
				ui: { position: { x: 80, y: 80 } },
			},
		},
		edges: {},
		metadata: {
			tags: input.tags,
			...(input.metadata ?? {}),
		},
		ui: {
			layout: "auto",
			positions: {
				agent: { x: 80, y: 80 },
			},
		},
	};
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
