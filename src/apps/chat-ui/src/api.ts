import type { AgentCatalog, BootstrapData, ChatSessionPage, CreateSessionData, CustomAgent, ModelDefaults, ModelProfile, NavigationData, PiboCronJob, PiboCronRun, PiboCronSchedule, PiboCronStatus, PiboCronTarget, PiboProject, PiboProjectSession, ProjectsBootstrapData, PiboRoom, PiboSession, PiboSessionTraceSummary, PiboSessionTraceView, UserSkill, PiboSignalPatch, PiboSignalSnapshot, PiboRalphJob, PiboRalphJobTemplate, PiboRalphRun, PiboRalphStatus, PiboRalphStopConditionInfo, PiboRalphStopPolicy, PiboRalphTarget, ThinkingLevel } from "./types";

const DOWNLOAD_FILENAME_RE = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i;

export type SaveState = "idle" | "saving" | "saved" | "error";

export type ChatUploadedFile = {
	name: string;
	path: string;
	bytes: number;
};

export type ChatUploadResult = {
	uploadDir: string;
	files: ChatUploadedFile[];
};

export type WebAnnotationTargetSummary = {
	id: string;
	type: string;
	title: string;
	url: string;
	attachable: boolean;
};

export type WebAnnotationBindingSummary = {
	id: string;
	piboSessionId: string;
	piboRoomId?: string;
	state: string;
	url: string;
	title?: string;
	targetId?: string;
	createdAt: string;
	lastInjectedAt?: string;
	error?: string;
};

export type WebAnnotationBindingResponse = {
	ok: true;
	binding: WebAnnotationBindingSummary;
	target?: WebAnnotationTargetSummary;
	injected?: boolean;
	stopped?: boolean;
};

export type WebAnnotationStatus = "open" | "attached" | "acknowledged" | "applying" | "needs_review" | "resolved" | "dismissed" | "failed";

export type WebAnnotationMessageAttachment = {
	id: string;
	status: WebAnnotationStatus;
	targetKind: string;
	url: string;
	label?: string;
	selector?: string;
	sourceHint?: string;
	position?: string;
	text?: string;
	note: string;
	createdAt: string;
};

export type WebAnnotationListResponse = {
	ok: true;
	annotations: WebAnnotationMessageAttachment[];
};

export type ContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	absolutePath: string;
	source: "plugin" | "managed";
	scope: "global" | "agent";
	agentProfileName?: string;
	managed: boolean;
	dynamic: boolean;
	editable: boolean;
	removable: boolean;
	exists: boolean;
	bytes?: number;
	updatedAt?: string;
	version?: string;
	sourceRef?: string;
	sourceHash?: string;
	linkState: "plugin-only" | "linked-clean" | "linked-dirty" | "linked-stale" | "orphaned" | "managed-unlinked";
	activeRevisionId?: string;
};

export type ContextFileDocument = ContextFileInfo & {
	markdown: string;
};

export type ContextFileRevision = {
	id: string;
	kind: "source-snapshot" | "working";
	contentHash: string;
	createdAt: string;
	actorId?: string;
	basedOnRevisionId?: string;
	sourceHashAtCreation?: string;
	note?: string;
	content: string;
	active: boolean;
};

export type ContextFileDiff = {
	base: { kind: "source" | "working"; contentHash?: string };
	target: { kind: "source" | "working"; contentHash?: string };
	chunks: Array<{ type: "equal" | "add" | "remove"; lines: string[] }>;
};

export type ProductEvent = {
	id?: string;
	type: string;
	source: string;
	actorId?: string;
	createdAt?: string;
	payload?: {
		key?: string;
		path?: string;
		version?: string;
		updatedAt?: string;
		[name: string]: unknown;
	};
};

export type BasePromptMode = "library" | "custom";

export type BasePromptSnapshot = {
	mode: BasePromptMode;
	effectiveMode: BasePromptMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
};

export type CompactionPromptMode = "library" | "custom";

export type UserSettings = {
	timezone: string;
};

export type CompactionPromptSnapshot = {
	mode: CompactionPromptMode;
	effectiveMode: CompactionPromptMode;
	library: {
		path: string;
		markdown: string;
	};
	custom: {
		path: string;
		markdown: string;
		exists: boolean;
		updatedAt?: string;
	};
};

export type ContextBuildDiagnostic = {
	type: "info" | "warning" | "error";
	message: string;
	nodeId?: string;
};

export type ContextBuildNode = {
	id: string;
	parentId?: string;
	order: number;
	kind: string;
	title: string;
	source: string;
	state?: "active" | "disabled" | "skipped" | "warning" | "error";
	badges?: string[];
	metadata?: Record<string, unknown>;
	path?: string;
	key?: string;
	provider?: string;
	bytes?: number;
	estimatedTokens?: number;
	estimatedSubtreeTokens?: number;
	children?: ContextBuildNode[];
	hydratedText?: string;
	schemaJson?: unknown;
	payloadJson?: unknown;
	notes?: string[];
	redacted?: boolean;
	approximate?: boolean;
};

export type ContextBuildSnapshot = {
	version: 1;
	generatedAt: string;
	profileName: string;
	piboSessionId?: string;
	piboRoomId?: string;
	cwd: string;
	activeModel?: ModelProfile;
	summary: {
		topLevelNodes: number;
		totalNodes: number;
		estimatedTokens: number;
		warnings: number;
		errors: number;
	};
	nodes: ContextBuildNode[];
	diagnostics: ContextBuildDiagnostic[];
};

export async function getBootstrap(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
	markRead = false,
): Promise<BootstrapData> {
	const params = createNavigationParams(piboSessionId, includeArchived, roomId);
	if (markRead) params.set("markRead", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<Partial<BootstrapData>>(`/api/chat/bootstrap${suffix}`).then(normalizeBootstrap);
}

export async function getNavigation(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
): Promise<NavigationData> {
	const params = createNavigationParams(piboSessionId, includeArchived, roomId);
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<Partial<NavigationData>>(`/api/chat/navigation${suffix}`).then(normalizeNavigation);
}

export async function getProjectsBootstrap(input: { projectId?: string; piboSessionId?: string; includeArchived?: boolean } = {}): Promise<ProjectsBootstrapData> {
	const params = new URLSearchParams();
	if (input.projectId) params.set("projectId", input.projectId);
	if (input.piboSessionId) params.set("piboSessionId", input.piboSessionId);
	if (input.includeArchived) params.set("includeArchived", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<ProjectsBootstrapData>(`/api/chat/projects/bootstrap${suffix}`);
}

export async function postProject(input: { name: string; projectFolder: string; description?: string; createFolder?: boolean }): Promise<{ project: PiboProject }> {
	return requestJson<{ project: PiboProject }>("/api/chat/projects", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchProject(projectId: string, input: { name?: string; description?: string | null; archived?: boolean }): Promise<{ project: PiboProject }> {
	return requestJson<{ project: PiboProject }>(`/api/chat/projects/${encodeURIComponent(projectId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteProject(projectId: string, input: { confirmName: string; deleteFiles?: boolean }): Promise<{ deletedProjectId: string }> {
	return requestJson<{ deletedProjectId: string }>(`/api/chat/projects/${encodeURIComponent(projectId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postProjectSession(projectId: string, input: { profile?: string; workflowId?: string } = {}): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>(`/api/chat/projects/${encodeURIComponent(projectId)}/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

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

export async function patchProjectSession(piboSessionId: string, input: { title?: string | null; archived?: boolean }): Promise<{ session: PiboSession }> {
	return requestJson<{ session: PiboSession }>(`/api/chat/project-sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function postProjectMessage(piboSessionId: string, text: string, clientTxnId?: string): Promise<unknown> {
	return requestJson<unknown>("/api/chat/projects/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, text, ...(clientTxnId ? { clientTxnId } : {}) }),
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

export type CronScheduleInput =
	| { kind: "in"; value: string }
	| { kind: "at"; at: string }
	| { kind: "at"; value: string; tz?: string }
	| { kind: "every"; value: string }
	| { kind: "daily"; time: string; tz?: string }
	| { kind: "weekly"; weekdays: string; time: string; tz?: string }
	| { kind: "monthly"; dayOfMonth: number; time: string; tz?: string }
	| { kind: "cron"; expr: string; tz?: string }
	| PiboCronSchedule;

export type CronJobInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboCronTarget;
	profile?: string;
	prompt: string;
	schedule: CronScheduleInput;
	deleteAfterRun?: boolean;
};

export async function getCronStatus(): Promise<{ status: PiboCronStatus }> {
	return requestJson<{ status: PiboCronStatus }>("/api/chat/cron/status");
}

export async function getCronJobs(includeDisabled = true): Promise<{ jobs: PiboCronJob[] }> {
	const params = new URLSearchParams();
	if (includeDisabled) params.set("includeDisabled", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<{ jobs: PiboCronJob[] }>(`/api/chat/cron/jobs${suffix}`);
}

export async function postCronJob(input: CronJobInput): Promise<{ job: PiboCronJob }> {
	return requestJson<{ job: PiboCronJob }>("/api/chat/cron/jobs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchCronJob(id: string, input: Partial<CronJobInput>): Promise<{ job: PiboCronJob }> {
	return requestJson<{ job: PiboCronJob }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteCronJob(id: string): Promise<{ removed: boolean }> {
	return requestJson<{ removed: boolean }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function runCronJobNow(id: string): Promise<{ run: PiboCronRun }> {
	return requestJson<{ run: PiboCronRun }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}/run`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function getCronRuns(jobId?: string, limit = 100): Promise<{ runs: PiboCronRun[] }> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (jobId) params.set("jobId", jobId);
	return requestJson<{ runs: PiboCronRun[] }>(`/api/chat/cron/runs?${params.toString()}`);
}

export async function getSessionPage(input: {
	roomId?: string;
	piboSessionId?: string;
	archived?: boolean;
	cursor?: string;
	limit?: number;
}): Promise<ChatSessionPage> {
	const params = new URLSearchParams();
	if (input.roomId) params.set("roomId", input.roomId);
	if (input.piboSessionId) params.set("piboSessionId", input.piboSessionId);
	if (input.archived) params.set("archived", "true");
	if (input.cursor) params.set("cursor", input.cursor);
	if (input.limit) params.set("limit", String(input.limit));
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<ChatSessionPage>(`/api/chat/sessions${suffix}`);
}

export async function getTraceSummary(piboSessionId: string, knownVersion?: string): Promise<{ summary?: PiboSessionTraceSummary; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	const response = await fetch(`/api/chat/trace/summary?${params.toString()}`, {
		headers: knownVersion ? { "if-none-match": toEtag(knownVersion) } : undefined,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		summary: payload as PiboSessionTraceSummary,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceSummary).version,
	};
}

export async function getTrace(
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number; eventLimit?: number; beforeSequence?: number; pageSize?: number; knownVersion?: string } = {},
): Promise<{ trace?: PiboSessionTraceView; notModified: boolean; version?: string }> {
	const params = new URLSearchParams({ piboSessionId });
	if (options.includeRawEvents) params.set("includeRawEvents", "true");
	if (options.rawEventsLimit) params.set("rawEventsLimit", String(options.rawEventsLimit));
	if (options.pageSize) params.set("pageSize", String(options.pageSize));
	if (options.beforeSequence !== undefined) params.set("beforeSequence", String(options.beforeSequence));
	else if (options.eventLimit) params.set("eventLimit", String(options.eventLimit));
	const response = await fetch(`/api/chat/trace?${params.toString()}`, {
		headers: options.knownVersion ? { "if-none-match": toEtag(options.knownVersion) } : undefined,
	});
	if (response.status === 304) {
		return { notModified: true, version: fromEtag(response.headers.get("etag")) ?? options.knownVersion };
	}
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return {
		trace: payload as PiboSessionTraceView,
		notModified: false,
		version: fromEtag(response.headers.get("etag")) ?? (payload as PiboSessionTraceView).version,
	};
}

export async function fetchSessionSignals(piboSessionId: string): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/session/${encodeURIComponent(piboSessionId)}`);
}

export async function fetchSignalTree(piboSessionId: string): Promise<PiboSignalSnapshot> {
	return requestJson<PiboSignalSnapshot>(`/api/chat/signals/tree/${encodeURIComponent(piboSessionId)}`);
}

export function subscribeSignalTree(
	rootPiboSessionId: string,
	handlers: {
		onSnapshot?: (snapshot: PiboSignalSnapshot) => void;
		onPatch?: (patch: PiboSignalPatch) => void;
		onError?: (event: Event) => void;
	},
): () => void {
	const params = new URLSearchParams({ rootPiboSessionId });
	const events = new EventSource(`/api/chat/signals/events?${params.toString()}`);
	events.addEventListener("signal_snapshot", (message) => handlers.onSnapshot?.(JSON.parse((message as MessageEvent).data) as PiboSignalSnapshot));
	events.addEventListener("signal_patch", (message) => handlers.onPatch?.(JSON.parse((message as MessageEvent).data) as PiboSignalPatch));
	events.onerror = (event) => handlers.onError?.(event);
	return () => events.close();
}

export async function postSession(profile?: string, roomId?: string): Promise<CreateSessionData> {
	return requestJson<CreateSessionData>("/api/chat/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...(profile ? { profile } : {}), ...(roomId ? { roomId } : {}) }),
	});
}

export async function markSessionRead(piboSessionId: string): Promise<{ ok: true; piboSessionId: string }> {
	return requestJson<{ ok: true; piboSessionId: string }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}/read`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function markRoomRead(roomId: string): Promise<{ ok: true; roomId: string; readSessionIds: string[] }> {
	return requestJson<{ ok: true; roomId: string; readSessionIds: string[] }>(`/api/chat/rooms/${encodeURIComponent(roomId)}/read`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function getAgentCatalog(): Promise<{
	catalog: AgentCatalog;
	profiles: Array<{ name: string; description?: string; aliases: string[] }>;
}> {
	return requestJson("/api/chat/agent-catalog");
}

export async function getCustomAgents(): Promise<{ agents: CustomAgent[] }> {
	return requestJson("/api/chat/agents");
}

export async function getContextBuild(input: { piboSessionId: string }): Promise<ContextBuildSnapshot> {
	const params = new URLSearchParams({ piboSessionId: input.piboSessionId });
	return (await requestJson<{ snapshot: ContextBuildSnapshot }>(`/api/chat/context-build?${params.toString()}`)).snapshot;
}

export async function getBasePrompt(): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt")).basePrompt;
}

export async function setBasePromptMode(mode: BasePromptMode): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ mode }),
	})).basePrompt;
}

export async function saveCustomBasePrompt(markdown: string): Promise<BasePromptSnapshot> {
	return (await requestJson<{ basePrompt: BasePromptSnapshot }>("/api/chat/base-prompt/custom", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown }),
	})).basePrompt;
}

export async function getCompactionPrompt(): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt")).compactionPrompt;
}

export async function setCompactionPromptMode(mode: CompactionPromptMode): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ mode }),
	})).compactionPrompt;
}

export async function saveCustomCompactionPrompt(markdown: string): Promise<CompactionPromptSnapshot> {
	return (await requestJson<{ compactionPrompt: CompactionPromptSnapshot }>("/api/chat/compaction-prompt/custom", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ markdown }),
	})).compactionPrompt;
}

export async function postContextFile(input: {
	label: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<{
	file: ContextFileDocument;
}> {
	return requestJson("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function listContextFiles(): Promise<ContextFileInfo[]> {
	return (await requestJson<{ files: ContextFileInfo[] }>("/api/context-files")).files;
}

export async function readContextFile(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`)).file;
}

export async function createContextFile(input: {
	label?: string;
	scope: "global" | "agent";
	agentProfileName?: string;
	markdown: string;
}): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>("/api/context-files", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function linkContextFileFromPlugin(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string } = {},
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/link-from-plugin`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function saveContextFile(
	key: string,
	input: { markdown: string; expectedVersion?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function updateContextFileMetadata(
	key: string,
	input: { label?: string; scope?: "global" | "agent"; agentProfileName?: string },
): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).file;
}

export async function removeContextFile(key: string, deleteFile: boolean): Promise<void> {
	await requestJson(`/api/context-files/${encodeURIComponent(key)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ deleteFile }),
	});
}

export async function listContextFileRevisions(key: string): Promise<{ revisions: ContextFileRevision[]; activeRevisionId?: string }> {
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/revisions`);
}

export async function diffContextFile(
	key: string,
	base: "source" | "working" = "source",
	target: "source" | "working" = "working",
): Promise<ContextFileDiff> {
	const params = new URLSearchParams({ base, target });
	return requestJson(`/api/context-files/${encodeURIComponent(key)}/diff?${params.toString()}`);
}

export async function resetContextFileToSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/reset-to-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function adoptContextFileSource(key: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/adopt-source`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).file;
}

export async function restoreContextFileRevision(key: string, revisionId: string): Promise<ContextFileDocument> {
	return (await requestJson<{ file: ContextFileDocument }>(`/api/context-files/${encodeURIComponent(key)}/restore-revision`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ revisionId }),
	})).file;
}

export type SaveCustomAgentInput = {
	displayName: string;
	description?: string;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: CustomAgent["subagents"];
	mcpServers: string[];
	piPackages: string[];
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: CustomAgent["thinkingLevel"] | null;
	mainThinkingLevel?: CustomAgent["mainThinkingLevel"] | null;
	subagentThinkingLevel?: CustomAgent["subagentThinkingLevel"] | null;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools: "default" | "disabled";
	builtinToolNames: string[];
	autoContextFiles: boolean;
	runControl: boolean;
};

export async function postCustomAgent(input: SaveCustomAgentInput): Promise<{ agent: CustomAgent }> {
	return requestJson("/api/chat/agents", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchCustomAgent(
	id: string,
	input: Partial<SaveCustomAgentInput> & { archived?: boolean },
): Promise<{ agent: CustomAgent }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchModelDefaults(input: ModelDefaults): Promise<ModelDefaults> {
	return (await requestJson<{ modelDefaults: ModelDefaults }>("/api/chat/model-defaults", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).modelDefaults;
}

export async function getUserSettings(): Promise<UserSettings> {
	return (await requestJson<{ userSettings: UserSettings }>("/api/chat/user-settings")).userSettings;
}

export async function patchUserSettings(input: UserSettings): Promise<UserSettings> {
	return (await requestJson<{ userSettings: UserSettings }>("/api/chat/user-settings", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).userSettings;
}

export async function deleteCustomAgent(id: string, confirmName: string): Promise<{ deletedAgentId: string; deletedSessionIds: string[] }> {
	return requestJson(`/api/chat/agents/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmName }),
	});
}

export async function patchMcpServerDescription(name: string, description: string): Promise<{
	server: AgentCatalog["mcpServers"][number];
}> {
	return requestJson(`/api/chat/mcp-servers/${encodeURIComponent(name)}/description`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ description }),
	});
}

export async function postPiPackage(source: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>("/api/chat/pi-packages", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ source }),
	})).package;
}

export async function patchPiPackage(
	id: string,
	input: { enabled: boolean },
): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ package: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).package;
}

export async function deletePiPackage(id: string): Promise<AgentCatalog["piPackages"][number]> {
	return (await requestJson<{ removedPackage: AgentCatalog["piPackages"][number] }>(`/api/chat/pi-packages/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	})).removedPackage;
}

export async function listUserSkills(): Promise<UserSkill[]> {
	return (await requestJson<{ skills: UserSkill[] }>("/api/chat/user-skills")).skills;
}

export async function getUserSkill(id: string): Promise<{ skill: UserSkill; markdown: string }> {
	return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`);
}

export async function createUserSkill(input: { name: string; description: string; markdown: string }): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).skill;
}

export async function updateUserSkill(
	id: string,
	input: Partial<{ name: string; description: string; markdown: string; enabled: boolean }>,
): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>(`/api/chat/user-skills/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	})).skill;
}

export async function deleteUserSkill(id: string): Promise<{ removedSkillId: string }> {
	return requestJson(`/api/chat/user-skills/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function installUserSkill(url: string): Promise<UserSkill> {
	return (await requestJson<{ skill: UserSkill }>("/api/chat/user-skills/install", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ url }),
	})).skill;
}

export async function postRoom(input: { name: string; topic?: string; workspace?: string | null }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>("/api/chat/rooms", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchRoom(roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null; archived?: boolean }): Promise<{ room: PiboRoom }> {
	return requestJson<{ room: PiboRoom }>(`/api/chat/rooms/${encodeURIComponent(roomId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteRoom(roomId: string, confirmName: string): Promise<{ deletedRoomIds: string[]; deletedSessionIds: string[] }> {
	return requestJson<{ deletedRoomIds: string[]; deletedSessionIds: string[] }>(`/api/chat/rooms/${encodeURIComponent(roomId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmName }),
	});
}

export async function patchSession(
	piboSessionId: string,
	input: { title?: string | null; archived?: boolean; profile?: string; activeModel?: ModelProfile | null },
): Promise<{ session: PiboSession }> {
	return requestJson<{ session: PiboSession }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteSession(
	piboSessionId: string,
	confirmText: string,
): Promise<{ deletedSessionIds: string[] }> {
	return requestJson<{ deletedSessionIds: string[] }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmText }),
	});
}

export async function postMessage(piboSessionId: string, text: string, clientTxnId: string, roomId?: string, webAnnotationIds: readonly string[] = []): Promise<unknown> {
	return requestJson("/api/chat/message", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, text, clientTxnId, ...(roomId ? { roomId } : {}), ...(webAnnotationIds.length ? { webAnnotationIds } : {}) }),
	});
}

export async function listWebAnnotations(piboSessionId: string, input: { status?: WebAnnotationStatus; limit?: number } = {}): Promise<WebAnnotationListResponse> {
	const params = new URLSearchParams({ piboSessionId });
	if (input.status) params.set("status", input.status);
	if (input.limit) params.set("limit", String(input.limit));
	return requestJson<WebAnnotationListResponse>(`/api/web-annotations?${params.toString()}`);
}

export async function patchWebAnnotation(annotationId: string, input: { piboSessionId: string; status?: WebAnnotationStatus; summary?: string | null }): Promise<{ ok: true; annotation: WebAnnotationMessageAttachment }> {
	return requestJson<{ ok: true; annotation: WebAnnotationMessageAttachment }>(`/api/web-annotations/${encodeURIComponent(annotationId)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function listWebAnnotationTargets(cdpUrl?: string): Promise<{ ok: true; targets: WebAnnotationTargetSummary[] }> {
	const params = new URLSearchParams();
	if (cdpUrl?.trim()) params.set("cdpUrl", cdpUrl.trim());
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<{ ok: true; targets: WebAnnotationTargetSummary[] }>(`/api/web-annotations/targets${suffix}`);
}

export async function createWebAnnotationBinding(input: {
	piboSessionId: string;
	piboRoomId?: string;
	url?: string;
	targetId?: string;
	cdpUrl?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>("/api/web-annotations/bindings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function injectWebAnnotationBinding(bindingId: string, input: {
	piboSessionId: string;
	piboRoomId?: string;
	cdpUrl?: string;
}): Promise<WebAnnotationBindingResponse> {
	return requestJson<WebAnnotationBindingResponse>(`/api/web-annotations/bindings/${encodeURIComponent(bindingId)}/inject`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(compactObject(input)),
	});
}

export async function postAction(piboSessionId: string, action: string, params?: unknown): Promise<unknown> {
	return requestJson("/api/chat/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ piboSessionId, action, params }),
	});
}

export async function uploadChatFiles(files: readonly File[]): Promise<ChatUploadResult> {
	const form = new FormData();
	for (const file of files) form.append("files", file, file.name);
	const response = await fetch("/api/chat/upload", {
		method: "POST",
		body: form,
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Upload failed";
		throw new Error(message);
	}
	return response.json() as Promise<ChatUploadResult>;
}

export async function downloadChatFile(path: string, options: { piboSessionId?: string; roomId?: string } = {}): Promise<void> {
	const params = new URLSearchParams({ path });
	if (options.piboSessionId) params.set("piboSessionId", options.piboSessionId);
	if (options.roomId) params.set("roomId", options.roomId);
	const response = await fetch(`/api/chat/download?${params.toString()}`);
	if (!response.ok) {
		const payload = await response.json().catch(() => undefined);
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Download failed";
		throw new Error(message);
	}
	const blob = await response.blob();
	const href = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.download = downloadFilename(response.headers.get("content-disposition"));
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(href);
}

function downloadFilename(contentDisposition: string | null): string {
	const match = contentDisposition?.match(DOWNLOAD_FILENAME_RE);
	const encoded = match?.[1];
	if (encoded) return decodeURIComponent(encoded);
	return match?.[2] ?? "download";
}

export async function signOut(): Promise<void> {
	await fetch("/api/auth/sign-out", {
		method: "POST",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function signInWithGoogle(): Promise<void> {
	const callbackURL = location.pathname.startsWith("/apps/chat")
		? `${location.pathname}${location.search}`
		: "/apps/chat";
	const response = await fetch("/api/auth/sign-in/social", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider: "google", callbackURL, disableRedirect: true }),
	});
	const data = (await response.json()) as { url?: string; error?: string; message?: string };
	if (!response.ok || !data.url) throw new Error(data.message || data.error || "Could not start Google sign in.");
	location.href = data.url;
}

function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== "")) as Partial<T>;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, init);
	const payload = await response.json().catch(() => undefined);
	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload ? String(payload.error) : "Request failed";
		const error = new Error(message) as Error & { status?: number; data?: unknown };
		error.status = response.status;
		error.data = payload;
		throw error;
	}
	return payload as T;
}

function createNavigationParams(piboSessionId?: string, includeArchived = false, roomId?: string): URLSearchParams {
	const params = new URLSearchParams();
	if (piboSessionId) params.set("piboSessionId", piboSessionId);
	if (includeArchived) params.set("includeArchived", "true");
	if (roomId) params.set("roomId", roomId);
	return params;
}

function normalizeNavigation(payload: Partial<NavigationData>): NavigationData {
	if (!payload.session) throw new Error("Invalid navigation response.");
	const sessions = payload.sessions ?? [];
	const selectedPiboSessionId = payload.selectedPiboSessionId ?? payload.session.id ?? sessions[0]?.piboSessionId ?? "";
	return {
		identity: payload.identity ?? { userId: "" },
		session: payload.session,
		runtimeStatus: payload.runtimeStatus,
		room: payload.room,
		selectedRoomId: payload.selectedRoomId ?? "",
		selectedPiboSessionId,
		rooms: payload.rooms ?? [],
		sessions,
	};
}

function normalizeBootstrap(payload: Partial<BootstrapData>): BootstrapData {
	const navigation = normalizeNavigation(payload);
	return {
		...navigation,
		agents: payload.agents ?? [],
		customAgents: payload.customAgents ?? [],
		modelDefaults: payload.modelDefaults,
		modelCatalog: payload.modelCatalog
			? {
				providers: (payload.modelCatalog.providers ?? []).map((provider) => ({
					...provider,
					models: provider.models ?? [],
				})),
			}
			: payload.modelCatalog,
		agentCatalog: payload.agentCatalog
			? {
				...payload.agentCatalog,
				piboTools: payload.agentCatalog.piboTools ?? [],
				piPackages: (payload.agentCatalog.piPackages ?? []).map((pkg) => ({ ...pkg, enabled: pkg.enabled !== false })),
				userSkills: payload.agentCatalog.userSkills ?? [],
			}
			: payload.agentCatalog,
		capabilities: {
			actions: payload.capabilities?.actions ?? [],
		},
	};
}

function toEtag(version: string): string {
	return `"${version}"`;
}

function fromEtag(value: string | null): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (trimmed.startsWith("W/")) return fromEtag(trimmed.slice(2));
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
	return trimmed;
}


export type RalphJobInput = { name?: string; description?: string; enabled?: boolean; target: PiboRalphTarget; profile: string; prompt: string; maxIterations?: number | null; stopPolicy?: PiboRalphStopPolicy | null; modelOverride?: ModelProfile | null; thinkingLevel?: ThinkingLevel | null; fastMode?: boolean | null };
export async function getRalphStatus(): Promise<{ status: PiboRalphStatus }> { return requestJson<{ status: PiboRalphStatus }>("/api/chat/ralph/status"); }
export async function getRalphConditions(): Promise<{ conditions: PiboRalphStopConditionInfo[] }> { return requestJson<{ conditions: PiboRalphStopConditionInfo[] }>("/api/chat/ralph/conditions"); }
export async function getRalphTemplates(): Promise<{ templates: PiboRalphJobTemplate[] }> { return requestJson<{ templates: PiboRalphJobTemplate[] }>("/api/chat/ralph/templates"); }
export async function getRalphJobs(includeDisabled = true): Promise<{ jobs: PiboRalphJob[] }> { const suffix = includeDisabled ? "?includeDisabled=true" : ""; return requestJson<{ jobs: PiboRalphJob[] }>(`/api/chat/ralph/jobs${suffix}`); }
export async function postRalphJob(input: RalphJobInput): Promise<{ job: PiboRalphJob }> { return requestJson<{ job: PiboRalphJob }>("/api/chat/ralph/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); }
export async function patchRalphJob(id: string, input: Partial<RalphJobInput>): Promise<{ job: PiboRalphJob }> { return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); }
export async function deleteRalphJob(id: string): Promise<{ removed: boolean }> { return requestJson<{ removed: boolean }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); }
export async function startRalphJob(id: string): Promise<{ run: PiboRalphRun }> { return requestJson<{ run: PiboRalphRun }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); }
export async function stopRalphJob(id: string): Promise<{ job: PiboRalphJob }> { return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); }
export async function cancelRalphJob(id: string): Promise<{ job: PiboRalphJob }> { return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) }); }
export async function getRalphRuns(jobId?: string, limit = 100): Promise<{ runs: PiboRalphRun[] }> { const params = new URLSearchParams(); if (jobId) params.set("jobId", jobId); params.set("limit", String(limit)); return requestJson<{ runs: PiboRalphRun[] }>(`/api/chat/ralph/runs?${params.toString()}`); }
