import { requestJson } from "./api-http";
import type { CreateSessionData, CustomAgent, ModelProfile, PiboProjectSession } from "./types";

export type CreateProjectWorkflowSessionInput = {
	profile?: string;
	workflowId: string;
	workflowVersion: string;
	title?: string;
	inputValues?: Record<string, unknown>;
	promptOverrides?: Record<string, string>;
	model?: ModelProfile;
	thinkingLevel?: CustomAgent["thinkingLevel"] | null;
	fastMode?: boolean;
};

export async function postProjectWorkflowSession(projectId: string, input: CreateProjectWorkflowSessionInput): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>(`/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowProfilePickerOption = {
	id: string;
	displayName: string;
	description?: string;
	paramsSchema: Record<string, unknown> | null;
	aliases: string[];
	source: "custom" | "global";
	visibility: "private" | "global";
	archived: false;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
};

export type WorkflowPickerDiagnostic = {
	code: string;
	message: string;
	severity: "error";
	path: string;
	registryRef: string;
	hint: string;
};

export type WorkflowProfilePickerResponse = {
	kind: "profiles";
	options: WorkflowProfilePickerOption[];
	selectedProfileId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

export async function getWorkflowProfilePicker(selectedProfileId?: string): Promise<WorkflowProfilePickerResponse> {
	const params = new URLSearchParams();
	if (selectedProfileId) params.set("selectedProfileId", selectedProfileId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowProfilePickerResponse>(`/api/chat/workflows/pickers/profiles${suffix}`);
}

export type WorkflowHandlerPickerOption = {
	id: string;
	displayName: string;
	description?: string;
	paramsSchema: Record<string, unknown> | null;
	inputSchema: Record<string, unknown> | null;
	outputSchema: Record<string, unknown> | null;
};

export type WorkflowHandlerPickerResponse = {
	kind: "handlers";
	options: WorkflowHandlerPickerOption[];
	selectedHandlerId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

export async function getWorkflowHandlerPicker(selectedHandlerId?: string): Promise<WorkflowHandlerPickerResponse> {
	const params = new URLSearchParams();
	if (selectedHandlerId) params.set("selectedHandlerId", selectedHandlerId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowHandlerPickerResponse>(`/api/chat/workflows/pickers/handlers${suffix}`);
}

export type WorkflowRegisteredRefOption = {
	id: string;
	displayName: string;
	description?: string;
	paramsSchema: Record<string, unknown> | null;
	kind?: string;
};

export type WorkflowRegisteredRefPickerResponse = {
	kind: "guards" | "adapters" | "human-actions" | "prompt-assets";
	options: WorkflowRegisteredRefOption[];
	selectedRefId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

export async function getWorkflowGuardPicker(selectedRefId?: string): Promise<WorkflowRegisteredRefPickerResponse> {
	const params = new URLSearchParams();
	if (selectedRefId) params.set("selectedRefId", selectedRefId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowRegisteredRefPickerResponse>(`/api/chat/workflows/pickers/guards${suffix}`);
}

export async function getWorkflowAdapterPicker(selectedRefId?: string): Promise<WorkflowRegisteredRefPickerResponse> {
	const params = new URLSearchParams();
	if (selectedRefId) params.set("selectedRefId", selectedRefId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowRegisteredRefPickerResponse>(`/api/chat/workflows/pickers/adapters${suffix}`);
}

export async function getWorkflowHumanActionPicker(selectedRefId?: string): Promise<WorkflowRegisteredRefPickerResponse> {
	const params = new URLSearchParams();
	if (selectedRefId) params.set("selectedRefId", selectedRefId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowRegisteredRefPickerResponse>(`/api/chat/workflows/pickers/human-actions${suffix}`);
}

export async function getWorkflowPromptAssetPicker(selectedRefId?: string): Promise<WorkflowRegisteredRefPickerResponse> {
	const params = new URLSearchParams();
	if (selectedRefId) params.set("selectedRefId", selectedRefId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowRegisteredRefPickerResponse>(`/api/chat/workflows/pickers/prompt-assets${suffix}`);
}

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

export async function getWorkflowPromptAsset(assetId: string): Promise<{ asset: WorkflowPromptAssetDocument }> {
	return requestJson<{ asset: WorkflowPromptAssetDocument }>(`/api/chat/workflows/prompt-assets/${encodeURIComponent(assetId)}`);
}

export async function postWorkflowPromptAssetRevision(input: { assetId?: string; sourceRefId?: string; displayName?: string; description?: string; markdown: string }): Promise<{ asset: WorkflowPromptAssetDocument }> {
	return requestJson<{ asset: WorkflowPromptAssetDocument }>("/api/chat/workflows/prompt-assets", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

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
	paramsSchema: Record<string, unknown> | null;
};

export type WorkflowVersionPickerResponse = {
	kind: "workflow-versions";
	options: WorkflowVersionPickerOption[];
	selectedWorkflowId?: string;
	selectedWorkflowVersion?: string;
	diagnostics: WorkflowPickerDiagnostic[];
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
	diagnostics: WorkflowPickerDiagnostic[];
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
			definition: WorkflowDraftDefinition;
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
	definition: WorkflowDraftDefinition;
	validation: WorkflowValidationSummary;
	diagnostics: WorkflowDraftDiagnostic[];
	missingRefs: WorkflowDraftDiagnostic[];
};

export async function getWorkflowCatalog(input: { includeArchived?: boolean } = {}): Promise<WorkflowCatalogListResponse> {
	const params = new URLSearchParams();
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowCatalogListResponse>(`/api/chat/workflows${suffix}`);
}

export async function getWorkflowCatalogInspect(workflowId: string, input: { version?: string; draftId?: string; includeArchived?: boolean } = {}): Promise<WorkflowCatalogInspectResponse> {
	const params = new URLSearchParams();
	if (input.version) params.set("version", input.version);
	if (input.draftId) params.set("draftId", input.draftId);
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowCatalogInspectResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}${suffix}`);
}

export async function getWorkflowVersionList(workflowId: string, input: { includeArchived?: boolean } = {}): Promise<WorkflowVersionListResponse> {
	const params = new URLSearchParams();
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowVersionListResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}/versions${suffix}`);
}

export async function getWorkflowVersionInspect(workflowId: string, version: string, input: { includeArchived?: boolean } = {}): Promise<WorkflowVersionInspectResponse> {
	const params = new URLSearchParams();
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowVersionInspectResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(version)}${suffix}`);
}

export async function getWorkflowVersionPicker(input: { selectedWorkflowId?: string; selectedWorkflowVersion?: string } = {}): Promise<WorkflowVersionPickerResponse> {
	const params = new URLSearchParams();
	if (input.selectedWorkflowId) params.set("selectedWorkflowId", input.selectedWorkflowId);
	if (input.selectedWorkflowVersion) params.set("selectedWorkflowVersion", input.selectedWorkflowVersion);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowVersionPickerResponse>(`/api/chat/workflows/pickers/workflow-versions${suffix}`);
}

export async function getWorkflowVersionHistory(input: { selectedWorkflowId?: string; selectedWorkflowVersion?: string } = {}): Promise<WorkflowVersionHistoryResponse> {
	const params = new URLSearchParams();
	if (input.selectedWorkflowId) params.set("selectedWorkflowId", input.selectedWorkflowId);
	if (input.selectedWorkflowVersion) params.set("selectedWorkflowVersion", input.selectedWorkflowVersion);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<WorkflowVersionHistoryResponse>(`/api/chat/workflows/pickers/version-history${suffix}`);
}

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

export type ProjectWorkflowSessionStartResponse = WorkflowValidationResponse & {
	projectSession: PiboProjectSession;
	workflow?: unknown;
	message?: string;
};

export async function postProjectWorkflowSessionStart(projectId: string, piboSessionId: string): Promise<ProjectWorkflowSessionStartResponse> {
	return requestJson<ProjectWorkflowSessionStartResponse>(`/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions/${encodeURIComponent(piboSessionId)}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export type ProjectWorkflowHumanActionInput = {
	waitTokenId: string;
	actionId?: string;
	kind?: string;
	payload?: unknown;
};

export type ProjectWorkflowHumanActionResponse = {
	ok: true;
	projectSession: PiboProjectSession;
	waitToken: unknown;
	action: unknown;
	run: unknown;
	diagnostics: WorkflowDraftDiagnostic[];
};

export async function postProjectWorkflowHumanAction(projectId: string, piboSessionId: string, input: ProjectWorkflowHumanActionInput): Promise<ProjectWorkflowHumanActionResponse> {
	return requestJson<ProjectWorkflowHumanActionResponse>(`/api/chat/projects/${encodeURIComponent(projectId)}/workflow-sessions/${encodeURIComponent(piboSessionId)}/human-actions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowDraftDefinition = Record<string, unknown>;

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
	definition: WorkflowDraftDefinition;
	diagnostics: WorkflowDraftDiagnostic[];
	validationState: "unknown" | "valid" | "warning" | "error";
	validation?: WorkflowValidationSummary;
	revision: number;
	createdAt: string;
	updatedAt: string;
};

export type WorkflowDraftResponse = {
	draft: WorkflowDraftRecord;
};

export type WorkflowCreateDraftResponse = WorkflowDraftResponse & {
	builderPath: string;
};

export async function postWorkflowCreateDraft(input: { workflowId?: string; title: string; description?: string; tags?: string[]; definition?: WorkflowDraftDefinition }): Promise<WorkflowCreateDraftResponse> {
	return requestJson<WorkflowCreateDraftResponse>("/api/chat/workflows", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function getWorkflowDraft(draftId: string): Promise<WorkflowDraftResponse> {
	return requestJson<WorkflowDraftResponse>(`/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`);
}

export type WorkflowPublishedVersionRecord = {
	workflowId: string;
	version: string;
	source: "ui";
	status: "published";
	definition: WorkflowDraftDefinition;
	definitionHash: string;
	publishedFromDraftId?: string;
	publishedBy?: string;
	publishedAt: string;
	createdAt: string;
};

export type WorkflowDraftMutationResponse = WorkflowDraftResponse & WorkflowValidationResponse & {
	message?: string;
	publishedVersion?: WorkflowPublishedVersionRecord;
	alreadyPublished?: boolean;
};

export async function patchWorkflowDraft(draftId: string, input: { definition?: WorkflowDraftDefinition; rawDefinitionText?: string; editTrigger: WorkflowValidationTrigger }): Promise<WorkflowDraftMutationResponse> {
	return requestJson<WorkflowDraftMutationResponse>(`/api/chat/workflows/drafts/${encodeURIComponent(draftId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postWorkflowDraftValidate(draftId: string, input: { trigger?: WorkflowValidationTrigger } = {}): Promise<WorkflowDraftMutationResponse> {
	return requestJson<WorkflowDraftMutationResponse>(`/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/validate`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postWorkflowDraftPublish(draftId: string, input: { versionIntent?: "patch" | "minor" | "major" } = {}): Promise<WorkflowDraftMutationResponse> {
	return requestJson<WorkflowDraftMutationResponse>(`/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/publish`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowManualTriggerRunResponse = WorkflowValidationResponse & {
	ok: boolean;
	draft: WorkflowDraftRecord;
	run?: {
		id: string;
		status: "completed" | "failed";
		output?: string;
	};
	nodeAttempts: Array<{
		id: string;
		nodeId: string;
		kind: "trigger" | "agent";
		status: "completed" | "failed";
		input: string;
		output?: string;
		piboSessionId?: string;
	}>;
	edgeTransfers: Array<{
		id: string;
		edgeId: string;
		targetNodeId: string;
		status: "transferred";
		payload: string;
	}>;
	output?: string;
	error?: { code: string; message: string };
};

export async function postWorkflowDraftManualTriggerRun(draftId: string, input: { triggerNodeId: string; input: string }): Promise<WorkflowManualTriggerRunResponse> {
	return requestJson<WorkflowManualTriggerRunResponse>(`/api/chat/workflows/drafts/${encodeURIComponent(draftId)}/manual-trigger-runs`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowDuplicateDraftResponse = WorkflowDraftResponse & {
	builderPath: string;
};

export async function postWorkflowDuplicateDraft(workflowId: string, input: { version?: string } = {}): Promise<WorkflowDuplicateDraftResponse> {
	return requestJson<WorkflowDuplicateDraftResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}/duplicate`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowNextDraftResponse = WorkflowDraftResponse & {
	builderPath: string;
	reused: boolean;
};

export async function postWorkflowNextDraft(workflowId: string, input: { version?: string } = {}): Promise<WorkflowNextDraftResponse> {
	return requestJson<WorkflowNextDraftResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}/drafts`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowArchiveResponse = {
	workflow: WorkflowCatalogRecord;
	archiveState: {
		workflowId: string;
		source: "ui";
		archived: boolean;
		archivedAt?: string;
		archivedBy?: string;
		archiveReason?: string;
		updatedAt: string;
	};
};

export async function postWorkflowArchive(workflowId: string, input: { reason?: string } = {}): Promise<WorkflowArchiveResponse> {
	return requestJson<WorkflowArchiveResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}/archive`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export type WorkflowDeleteResponse = {
	workflowId: string;
	deleted: true;
	tombstone: {
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
};

export async function deleteWorkflow(workflowId: string, input: { confirmWorkflowId: string }): Promise<WorkflowDeleteResponse> {
	return requestJson<WorkflowDeleteResponse>(`/api/chat/workflows/${encodeURIComponent(workflowId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}
