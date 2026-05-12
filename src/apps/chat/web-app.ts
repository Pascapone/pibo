import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import os from "node:os";
import { Readable } from "node:stream";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../core/events.js";
import { PiboWebHttpError, readJsonBody, responseHtml, responseJson } from "../../web/http.js";
import type { PiboWebApp, PiboWebAppContext, PiboWebSession } from "../../web/types.js";
import type { PiboSession, UpdatePiboSessionInput } from "../../sessions/store.js";
import { OutputCompactor } from "./output-compactor.js";
import { isPersistableOutputEvent } from "./output-event-policy.js";
import type { ChatEventAppendInput, ChatEventListInput, StoredChatEvent } from "./types/event-store.js";
import type { ChatWebSessionBootstrapIndexResult, ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "./types/read-model.js";
import {
	chatRoomIdFromMetadata,
	isDefaultPiboRoom,
	isPiboRoomArchived,
	roomWorkspaceFromMetadata,
	withChatRoomId,
	withPiboRoomArchived,
	withPiboRoomWorkspace,
	type CreatePiboRoomInput,
	type PiboRoom,
	type PiboRoomMember,
	type PiboRoomNode,
	type PiboRoomRole,
	type UpdatePiboRoomInput,
} from "./types/rooms.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState, type ChatStreamEvent } from "./stream.js";
import { buildSessionNodes, buildTraceView, createTraceViewVersion, loadPiSessionMetadata, type PiboSessionTraceView, type PiboWebSessionNode, type PiboWebSessionStatus } from "./trace.js";
import type { PiboSessionTraceSummary } from "../../shared/trace-types.js";
import { isChatWebSessionArchived, withChatWebArchived } from "./session-metadata.js";
import { withWorkflowSessionKind } from "../../sessions/workflow-session-kind.js";
import {
	CustomAgentStore,
	createDefaultCustomAgentStore,
	isValidCustomAgentName,
	type CustomAgentDefinition,
	type CustomAgentSubagent,
	type UpdateCustomAgentInput,
} from "./agent-store.js";
import {
	loadPiboModelDefaults,
	savePiboModelDefaults,
	type PiboModelDefaults,
} from "../../core/model-defaults.js";
import { loadPiboUserSettings, sanitizeTimezone, updatePiboUserSettings } from "../../core/user-settings.js";
import { loadModelCatalog } from "./model-catalog.js";
import type { ModelProfile } from "../../core/profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "../../core/thinking.js";
import { createCustomAgentProfileDefinition } from "./agent-profiles.js";
import { createDefaultPiboReliabilityStore, PiboReliabilityStore } from "../../reliability/store.js";
import { listMcpServerInfos, setMcpServerDescription } from "../../mcp/agent-context.js";
import {
	readPiboBasePrompt,
	savePiboCustomBasePrompt,
	setPiboBasePromptMode,
	type PiboBasePromptMode,
} from "../../core/base-prompt.js";
import {
	readPiboCompactionPrompt,
	savePiboCustomCompactionPrompt,
	setPiboCompactionPromptMode,
	type PiboCompactionPromptMode,
} from "../../core/compaction-prompt.js";
import { getDefaultPiboWorkspace } from "../../core/workspace.js";
import { inspectPiPackageSource } from "../../pi-packages/metadata.js";
import { findPiPackage, listPiPackages, removePiPackage, setPiPackageEnabled, upsertPiPackage } from "../../pi-packages/store.js";
import { UserSkillManager } from "../../user-skills/manager.js";
import { listUserSkills } from "../../user-skills/store.js";
import { ChatDataIngestService } from "../../data/ingest-service.js";
import { ChatEventCommandService } from "./data/event-command-service.js";
import { ChatReadStateService } from "./data/read-state-service.js";
import { ChatRoomService } from "./data/room-service.js";
import { ChatSessionQueryService } from "./data/session-query-service.js";
import { ChatTimelineQueryService } from "./data/timeline-query-service.js";
import { ChatProjectService, type PiboProject, type PiboProjectSession, type PiboProjectWorkflowSessionConfiguration, type PiboProjectWorkflowSessionSnapshot } from "./data/project-service.js";
import { PiboDataStore } from "../../data/pibo-store.js";
import { createDefaultPiboCronStore, type PiboCronStore } from "../../cron/store.js";
import { createDefaultPiboRalphStore, type PiboRalphStore } from "../../ralph/store.js";
import { handleChatCronApiRequest } from "./cron-api.js";
import { handleChatRalphApiRequest } from "./ralph-api.js";

export const CHAT_WEB_APP_NAME = "pibo.chat-web";
export const CHAT_WEB_CHANNEL = "pibo.chat-web";
export const CHAT_WEB_MOUNT_PATH = "/apps/chat";
export const CHAT_WEB_API_PREFIX = "/api/chat";

export type ChatWebAppOptions = {
	defaultProfile?: string;
	agentStorePath?: string;
	reliabilityStorePath?: string;
	dataStorePath?: string;
	dataPayloadRootDir?: string;
	projectStorePath?: string;
	cronStorePath?: string;
	ralphStorePath?: string;
};

type ChatPersistenceMetrics = {
	eventCount: number;
	errorCount: number;
	totalIndexingMs: number;
	maxIndexingMs: number;
	lastIndexingMs?: number;
	lastError?: string;
	lastErrorAt?: string;
};

type ChatSessionQuery = {
	upsertSession(session: PiboSession, status?: ChatWebSessionIndexItem["status"]): void;
	upsertSessionsIfChanged(sessions: PiboSession[]): ChatWebSessionBootstrapIndexResult;
	recordEvent(event: PiboOutputEvent, session?: PiboSession, streamId?: number): ChatWebStoredPiboEvent | undefined;
	listSessions(): ChatWebSessionIndexItem[];
	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined;
	hasSessionActivity(piboSessionId: string): boolean;
	deleteSessions(piboSessionIds: string[]): number;
	close?(): void;
};

type ChatTimelineQuery = {
	listEvents(input: ChatEventListInput): StoredChatEvent[];
	listSessionEvents(piboSessionId: string, limit?: number): ChatWebStoredPiboEvent[];
	listAllSessionEvents(piboSessionId: string): ChatWebStoredPiboEvent[];
	listTraceEvents(input: { piboSessionId: string; limit?: number; beforeOrAtSequence?: number; beforeSequence?: number; includeLive?: boolean } | string): ChatWebStoredPiboEvent[];
	countEventsByType(input?: { piboSessionId?: string; eventTypes?: string[] }): Array<{ eventType: string; count: number }>;
	getLatestEventSequence(piboSessionId: string): number;
	getLatestStreamId(input?: { roomId?: string; piboSessionId?: string }): number | undefined;
};

type ChatEventCommands = {
	appendEvent(input: ChatEventAppendInput): StoredChatEvent;
	appendOutputEvent(event: PiboOutputEvent, input?: { roomId?: string; actorId?: string }): StoredChatEvent | undefined;
	findByClientTxn(roomId: string | undefined, actorId: string | undefined, clientTxnId: string): StoredChatEvent | undefined;
	deleteSessions(piboSessionIds: string[]): number;
	deleteRooms(roomIds: string[]): number;
};

type ChatReadState = {
	markSessionRead(piboSessionId: string, principalId: string, lastReadStreamId: number): void;
	countUnreadMessagesBySession(input: { piboSessionIds: string[]; principalId: string }): Map<string, number>;
};

type ChatRoomActions = {
	createRoom(input: CreatePiboRoomInput): PiboRoom;
	updateRoom(id: string, input: UpdatePiboRoomInput): PiboRoom | undefined;
	deleteRooms(ids: string[]): number;
	getRoom(id: string): PiboRoom | undefined;
	listRooms(ownerScope: string): PiboRoom[];
	listRoomTree(ownerScope: string): PiboRoomNode[];
	listRoomSubtree(rootRoomId: string): PiboRoom[];
	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom;
	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember;
	getMember(roomId: string, principalId: string): PiboRoomMember | undefined;
	updateReadCursor(roomId: string, principalId: string, lastReadStreamId: number): PiboRoomMember | undefined;
	requireRoomAccess(roomId: string, principalId: string, action?: "read" | "write" | "admin"): PiboRoom;
	close?(): void;
};

type ChatWebAppState = {
	sessionQuery: ChatSessionQuery;
	timelineQuery: ChatTimelineQuery;
	eventCommands: ChatEventCommands;
	readState: ChatReadState;
	roomService: ChatRoomActions;
	projectService: ChatProjectService;
	agentStore: CustomAgentStore;
	reliabilityStore: PiboReliabilityStore;
	cronStore: PiboCronStore;
	ralphStore: PiboRalphStore;
	dataStore: PiboDataStore;
	ingestService: ChatDataIngestService;
	traceCache: Map<string, PiboSessionTraceView>;
	bootstrapCatalogCache?: { expiresAt: number; value: Promise<ChatBootstrapCatalog> };
	outputCompactor: OutputCompactor;
	subscribedContext?: PiboWebAppContext;
	unsubscribe?: () => void;
	liveListeners: Set<(event: ChatLiveEvent) => void>;
	activeEventStreams: Map<string, Map<string, string>>;
	activeTraceSessions: Set<string>;
	persistenceMetrics: ChatPersistenceMetrics;
	userSkillManager: UserSkillManager;
	syncedUserSkillNames?: Set<string>;
	workflowDraftStore: ChatWorkflowDraftStore;
	workflowPublishedVersionStore: ChatWorkflowPublishedVersionStore;
};

type ChatBootstrapCatalog = {
	agents: ReturnType<NonNullable<PiboWebAppContext["channelContext"]["getProfiles"]>>;
	customAgents: ReturnType<typeof serializeCustomAgents>;
	modelDefaults: PiboModelDefaults;
	modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>>;
	agentCatalog: Awaited<ReturnType<typeof buildAgentCatalog>>;
	capabilities: { actions: ReturnType<PiboWebAppContext["channelContext"]["getGatewayActions"]> };
};

const BOOTSTRAP_CATALOG_CACHE_TTL_MS = 30_000;

function invalidateBootstrapCatalogCache(state: ChatWebAppState): void {
	state.bootstrapCatalogCache = undefined;
}

function loadBootstrapCatalog(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
): Promise<ChatBootstrapCatalog> {
	const now = Date.now();
	if (state.bootstrapCatalogCache && state.bootstrapCatalogCache.expiresAt > now) return state.bootstrapCatalogCache.value;
	const value = Promise.all([
		loadModelCatalog(process.cwd()),
		buildAgentCatalog(context, state),
	]).then(([modelCatalog, agentCatalog]) => ({
		agents: context.channelContext.getProfiles?.() ?? [],
		customAgents: serializeCustomAgents(state.agentStore.list(webSession.ownerScope, { includeArchived: true }), context),
		modelDefaults: loadChatModelDefaults(process.cwd()),
		modelCatalog,
		agentCatalog,
		capabilities: {
			actions: context.channelContext.getGatewayActions(),
		},
	}));
	state.bootstrapCatalogCache = { expiresAt: now + BOOTSTRAP_CATALOG_CACHE_TTL_MS, value };
	value.catch(() => {
		if (state.bootstrapCatalogCache?.value === value) state.bootstrapCatalogCache = undefined;
	});
	return value;
}

type ChatSessionCreateBody = {
	profile?: unknown;
	roomId?: unknown;
};

type ChatProjectCreateBody = {
	name?: unknown;
	description?: unknown;
	projectFolder?: unknown;
	createFolder?: unknown;
};

type ChatProjectPatchBody = {
	name?: unknown;
	description?: unknown;
	archived?: unknown;
};

type ChatProjectDeleteBody = {
	confirmName?: unknown;
	deleteFiles?: unknown;
};

type ChatProjectSessionCreateBody = {
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

type ChatProjectSessionPatchBody = {
	title?: unknown;
	archived?: unknown;
};

type ChatSessionDeleteBody = {
	confirmText?: unknown;
};

type ChatRoomCreateBody = {
	name?: unknown;
	topic?: unknown;
	workspace?: unknown;
	type?: unknown;
	parentRoomId?: unknown;
};

type ChatRoomPatchBody = {
	name?: unknown;
	topic?: unknown;
	workspace?: unknown;
	parentRoomId?: unknown;
	archived?: unknown;
};

type ChatRoomDeleteBody = {
	confirmName?: unknown;
};

type ChatAgentBody = {
	displayName?: unknown;
	description?: unknown;
	nativeTools?: unknown;
	skills?: unknown;
	contextFiles?: unknown;
	subagents?: unknown;
	mcpServers?: unknown;
	piPackages?: unknown;
	mainModel?: unknown;
	subagentModel?: unknown;
	thinkingLevel?: unknown;
	mainThinkingLevel?: unknown;
	subagentThinkingLevel?: unknown;
	fast?: unknown;
	mainFast?: unknown;
	subagentFast?: unknown;
	builtinTools?: unknown;
	builtinToolNames?: unknown;
	autoContextFiles?: unknown;
	runControl?: unknown;
	archived?: unknown;
	confirmName?: unknown;
};

type WorkflowProfilePickerOption = {
	id: string;
	displayName: string;
	description?: string;
	aliases: string[];
	source: "custom" | "global";
	visibility: "private" | "global";
	archived: false;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
};

type WorkflowPickerDiagnostic = {
	code: string;
	message: string;
	severity: "error";
	path: string;
	registryRef: string;
	hint: string;
};

type WorkflowProfilePickerResponse = {
	kind: "profiles";
	options: WorkflowProfilePickerOption[];
	selectedProfileId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

type WorkflowHandlerPickerOption = {
	id: string;
	displayName: string;
	description?: string;
	inputSchema: PiboJsonObject | null;
	outputSchema: PiboJsonObject | null;
};

type WorkflowHandlerPickerResponse = {
	kind: "handlers";
	options: WorkflowHandlerPickerOption[];
	selectedHandlerId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

type WorkflowRegisteredRefOption = {
	id: string;
	displayName: string;
	description?: string;
};

type WorkflowRegisteredRefPickerResponse = {
	kind: "guards" | "adapters";
	options: WorkflowRegisteredRefOption[];
	selectedRefId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

type WorkflowHumanActionOption = WorkflowRegisteredRefOption & {
	kind: string;
};

type WorkflowCatalogVersionRecord = {
	id: string;
	version: string;
	title: string;
	description?: string;
	source: "code" | "ui";
	status: "draft" | "published" | "archived";
	tags: string[];
};

type WorkflowVersionPickerOption = WorkflowCatalogVersionRecord & {
	status: "published";
};

type WorkflowVersionPickerResponse = {
	kind: "workflow-versions";
	options: WorkflowVersionPickerOption[];
	selectedWorkflowId?: string;
	selectedWorkflowVersion?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

type WorkflowDraftDiagnostic = {
	code: string;
	message: string;
	severity: "info" | "warning" | "error";
	path?: string;
	nodeId?: string;
	edgeId?: string;
	registryRef?: string;
	hint?: string;
};

type WorkflowValidationTrigger =
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

type WorkflowValidationSummary = {
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

type WorkflowValidationResponse = {
	validation: WorkflowValidationSummary;
	diagnostics: WorkflowDraftDiagnostic[];
};

type WorkflowDraftRecord = {
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

type OwnedWorkflowDraftRecord = WorkflowDraftRecord & {
	ownerScope: string;
};

type WorkflowDuplicateBody = {
	version?: unknown;
};

type WorkflowNextDraftBody = {
	version?: unknown;
};

type WorkflowDraftPatchBody = {
	definition?: unknown;
	rawDefinitionText?: unknown;
	editTrigger?: unknown;
};

type WorkflowDraftValidateBody = {
	trigger?: unknown;
};

type WorkflowDraftPublishBody = {
	versionIntent?: unknown;
};

type WorkflowDraftStoreRow = {
	draft_id: string;
	workflow_id: string;
	owner_scope: string;
	source: "ui";
	status: "draft";
	base_workflow_id: string | null;
	base_workflow_version: string | null;
	base_definition_hash: string | null;
	target_workflow_version: string | null;
	version_intent: "patch" | "minor" | "major";
	definition_json: string;
	diagnostics_json: string;
	validation_json: string | null;
	validation_state: "unknown" | "valid" | "warning" | "error";
	revision: number;
	created_at: string;
	updated_at: string;
};

type WorkflowPublishedVersionRecord = {
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

type WorkflowPublishedVersionStoreRow = {
	workflow_id: string;
	version: string;
	source: "ui";
	status: "published";
	definition_hash: string;
	definition_json: string;
	published_from_draft_id: string | null;
	published_by: string | null;
	published_at: string;
	created_at: string;
};

class ChatWorkflowDraftStore {
	constructor(private readonly dataStore: PiboDataStore) {
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_ui_drafts (
				draft_id TEXT PRIMARY KEY,
				workflow_id TEXT NOT NULL,
				owner_scope TEXT NOT NULL,
				source TEXT NOT NULL,
				status TEXT NOT NULL,
				base_workflow_id TEXT,
				base_workflow_version TEXT,
				base_definition_hash TEXT,
				target_workflow_version TEXT,
				version_intent TEXT NOT NULL,
				definition_json TEXT NOT NULL,
				diagnostics_json TEXT NOT NULL,
				validation_json TEXT,
				validation_state TEXT NOT NULL,
				revision INTEGER NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_ui_drafts_one_active
				ON workflow_ui_drafts(workflow_id)
				WHERE status = 'draft';
			CREATE INDEX IF NOT EXISTS idx_workflow_ui_drafts_updated
				ON workflow_ui_drafts(updated_at, draft_id);
		`);
	}

	getDraft(draftId: string): OwnedWorkflowDraftRecord | undefined {
		const row = this.dataStore.db.prepare("SELECT * FROM workflow_ui_drafts WHERE draft_id = ?").get(draftId) as WorkflowDraftStoreRow | undefined;
		return row ? workflowDraftFromStoreRow(row) : undefined;
	}

	findActiveDraftByWorkflowId(workflowId: string): OwnedWorkflowDraftRecord | undefined {
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_ui_drafts WHERE workflow_id = ? AND status = 'draft' ORDER BY updated_at DESC, draft_id ASC LIMIT 1")
			.get(workflowId) as WorkflowDraftStoreRow | undefined;
		return row ? workflowDraftFromStoreRow(row) : undefined;
	}

	saveDraft(record: OwnedWorkflowDraftRecord): void {
		this.dataStore.transaction(() => {
			const conflict = this.dataStore.db
				.prepare("SELECT draft_id FROM workflow_ui_drafts WHERE workflow_id = ? AND status = 'draft' AND draft_id <> ? LIMIT 1")
				.get(record.workflowId, record.draftId) as { draft_id: string } | undefined;
			if (conflict) {
				throw new PiboWebHttpError(`Workflow '${record.workflowId}' already has an active draft '${conflict.draft_id}'`, 409);
			}

			this.dataStore.db.prepare(`
				INSERT INTO workflow_ui_drafts (
					draft_id,
					workflow_id,
					owner_scope,
					source,
					status,
					base_workflow_id,
					base_workflow_version,
					base_definition_hash,
					target_workflow_version,
					version_intent,
					definition_json,
					diagnostics_json,
					validation_json,
					validation_state,
					revision,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(draft_id) DO UPDATE SET
					workflow_id = excluded.workflow_id,
					owner_scope = excluded.owner_scope,
					source = excluded.source,
					status = excluded.status,
					base_workflow_id = excluded.base_workflow_id,
					base_workflow_version = excluded.base_workflow_version,
					base_definition_hash = excluded.base_definition_hash,
					target_workflow_version = excluded.target_workflow_version,
					version_intent = excluded.version_intent,
					definition_json = excluded.definition_json,
					diagnostics_json = excluded.diagnostics_json,
					validation_json = excluded.validation_json,
					validation_state = excluded.validation_state,
					revision = excluded.revision,
					created_at = excluded.created_at,
					updated_at = excluded.updated_at
			`).run(
				record.draftId,
				record.workflowId,
				record.ownerScope,
				record.source,
				record.status,
				record.baseWorkflowId ?? null,
				record.baseWorkflowVersion ?? null,
				record.baseDefinitionHash ?? null,
				record.targetWorkflowVersion ?? null,
				record.versionIntent,
				JSON.stringify(record.definition),
				JSON.stringify(record.diagnostics),
				record.validation ? JSON.stringify(record.validation) : null,
				record.validationState,
				record.revision,
				record.createdAt,
				record.updatedAt,
			);
		});
	}
}

function workflowDraftFromStoreRow(row: WorkflowDraftStoreRow): OwnedWorkflowDraftRecord {
	return {
		draftId: row.draft_id,
		workflowId: row.workflow_id,
		source: row.source,
		status: row.status,
		...(row.base_workflow_id ? { baseWorkflowId: row.base_workflow_id } : {}),
		...(row.base_workflow_version ? { baseWorkflowVersion: row.base_workflow_version } : {}),
		...(row.base_definition_hash ? { baseDefinitionHash: row.base_definition_hash } : {}),
		...(row.target_workflow_version ? { targetWorkflowVersion: row.target_workflow_version } : {}),
		versionIntent: row.version_intent,
		definition: JSON.parse(row.definition_json) as PiboJsonObject,
		diagnostics: JSON.parse(row.diagnostics_json) as WorkflowDraftDiagnostic[],
		...(row.validation_json ? { validation: JSON.parse(row.validation_json) as WorkflowValidationSummary } : {}),
		validationState: row.validation_state,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		ownerScope: row.owner_scope,
	};
}

class ChatWorkflowPublishedVersionStore {
	constructor(private readonly dataStore: PiboDataStore) {
		this.dataStore.db.exec(`
			CREATE TABLE IF NOT EXISTS workflow_published_versions (
				workflow_id TEXT NOT NULL,
				version TEXT NOT NULL,
				source TEXT NOT NULL,
				status TEXT NOT NULL,
				definition_hash TEXT NOT NULL,
				definition_json TEXT NOT NULL,
				published_from_draft_id TEXT,
				published_by TEXT,
				published_at TEXT NOT NULL,
				created_at TEXT NOT NULL,
				PRIMARY KEY (workflow_id, version)
			);

			CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_workflow
				ON workflow_published_versions(workflow_id, version);
			CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_published_at
				ON workflow_published_versions(published_at);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_published_versions_draft
				ON workflow_published_versions(published_from_draft_id)
				WHERE published_from_draft_id IS NOT NULL;
		`);
	}

	getPublishedVersionByDraftId(draftId: string): WorkflowPublishedVersionRecord | undefined {
		const row = this.dataStore.db
			.prepare("SELECT * FROM workflow_published_versions WHERE published_from_draft_id = ? ORDER BY published_at ASC LIMIT 1")
			.get(draftId) as WorkflowPublishedVersionStoreRow | undefined;
		return row ? workflowPublishedVersionFromStoreRow(row) : undefined;
	}

	listPublishedVersions(filter: { workflowId?: string } = {}): WorkflowPublishedVersionRecord[] {
		const rows = filter.workflowId
			? this.dataStore.db
				.prepare("SELECT * FROM workflow_published_versions WHERE workflow_id = ? ORDER BY workflow_id ASC, version ASC")
				.all(filter.workflowId) as WorkflowPublishedVersionStoreRow[]
			: this.dataStore.db
				.prepare("SELECT * FROM workflow_published_versions ORDER BY workflow_id ASC, version ASC")
				.all() as WorkflowPublishedVersionStoreRow[];
		return rows.map(workflowPublishedVersionFromStoreRow);
	}

	publishDraft(input: {
		draft: OwnedWorkflowDraftRecord;
		versionIntent: "patch" | "minor" | "major";
		publishedBy: string;
		reservedVersions: string[];
	}): { record: WorkflowPublishedVersionRecord; alreadyPublished: boolean } {
		return this.dataStore.transaction(() => {
			const alreadyPublished = this.getPublishedVersionByDraftId(input.draft.draftId);
			if (alreadyPublished) return { record: alreadyPublished, alreadyPublished: true };

			const existingVersions = [
				...input.reservedVersions,
				...this.listPublishedVersions({ workflowId: input.draft.workflowId }).map((record) => record.version),
			];
			const version = allocateWorkflowPublishedVersion({
				draft: input.draft,
				versionIntent: input.versionIntent,
				existingVersions,
			});
			const definition = workflowDraftDefinitionForPublishedVersion(input.draft.definition, input.draft.workflowId, version);
			const now = new Date().toISOString();
			const record: WorkflowPublishedVersionRecord = {
				workflowId: input.draft.workflowId,
				version,
				source: "ui",
				status: "published",
				definition,
				definitionHash: hashWorkflowDefinitionJson(definition),
				publishedFromDraftId: input.draft.draftId,
				publishedBy: input.publishedBy,
				publishedAt: now,
				createdAt: now,
			};
			this.insertPublishedVersion(record);
			return { record, alreadyPublished: false };
		});
	}

	private insertPublishedVersion(record: WorkflowPublishedVersionRecord): void {
		this.dataStore.db.prepare(`
			INSERT INTO workflow_published_versions (
				workflow_id,
				version,
				source,
				status,
				definition_hash,
				definition_json,
				published_from_draft_id,
				published_by,
				published_at,
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			record.workflowId,
			record.version,
			record.source,
			record.status,
			record.definitionHash,
			canonicalWorkflowDefinitionJson(record.definition),
			record.publishedFromDraftId ?? null,
			record.publishedBy ?? null,
			record.publishedAt,
			record.createdAt,
		);
	}
}

function workflowPublishedVersionFromStoreRow(row: WorkflowPublishedVersionStoreRow): WorkflowPublishedVersionRecord {
	return {
		workflowId: row.workflow_id,
		version: row.version,
		source: row.source,
		status: row.status,
		definitionHash: row.definition_hash,
		definition: JSON.parse(row.definition_json) as PiboJsonObject,
		...(row.published_from_draft_id ? { publishedFromDraftId: row.published_from_draft_id } : {}),
		...(row.published_by ? { publishedBy: row.published_by } : {}),
		publishedAt: row.published_at,
		createdAt: row.created_at,
	};
}

type ChatMcpServerDescriptionBody = {
	description?: unknown;
};

type ChatBasePromptBody = {
	mode?: unknown;
	markdown?: unknown;
};

type ChatPiPackageBody = {
	source?: unknown;
};

type ChatPiPackagePatchBody = {
	enabled?: unknown;
	source?: unknown;
};

type ChatModelDefaultsBody = {
	main?: unknown;
	subagent?: unknown;
	thinking?: unknown;
	mainThinking?: unknown;
	subagentThinking?: unknown;
	fast?: unknown;
	mainFast?: unknown;
	subagentFast?: unknown;
};

type ChatUserSettingsBody = {
	timezone?: unknown;
};

type ChatMessageBody = {
	piboSessionId?: unknown;
	roomId?: unknown;
	text?: unknown;
	clientTxnId?: unknown;
};

type ChatProjectsBootstrap = ChatBootstrapCatalog & {
	identity: PiboWebSession["authSession"]["identity"];
	personalProject: PiboProject;
	project?: PiboProject;
	projects: PiboProject[];
	projectSessions: PiboProjectSession[];
	session?: PiboSession;
	selectedProjectId: string;
	selectedPiboSessionId?: string;
	sessions: PiboWebSessionNode[];
};

type ChatEventCursor = {
	streamId: number;
	frameIndex: number;
};

type TransientChatEvent = {
	roomId?: string;
	piboSessionId?: string;
	eventType: string;
	payload: PiboOutputEvent;
};

type ChatLiveEvent = StoredChatEvent | TransientChatEvent;

type PiboRoomNodeWithUnread = PiboRoom & {
	unreadCount?: number;
	children: PiboRoomNodeWithUnread[];
};

const CHAT_UI_DIST_DIR = resolve(fileURLToPath(new URL("../../../dist/apps/chat-ui", import.meta.url)));
const compressedAssetCache = new Map<string, Uint8Array>();
const TRACE_CACHE_MAX_ENTRIES = 24;

function writeSse(
	controller: ReadableStreamDefaultController<Uint8Array>,
	event: string,
	payload: ChatStreamEvent,
	id?: string,
): void {
	const encoder = new TextEncoder();
	if (id) controller.enqueue(encoder.encode(`id: ${id}\n`));
	controller.enqueue(encoder.encode(`event: ${event}\n`));
	controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function writeSseComment(controller: ReadableStreamDefaultController<Uint8Array>, comment: string): void {
	controller.enqueue(new TextEncoder().encode(`: ${comment}\n\n`));
}

function writeJsonSse(controller: ReadableStreamDefaultController<Uint8Array>, event: string, payload: unknown, id?: string): void {
	const encoder = new TextEncoder();
	if (id) controller.enqueue(encoder.encode(`id: ${id}\n`));
	controller.enqueue(encoder.encode(`event: ${event}\n`));
	controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function requireSameOriginJsonRequest(request: Request): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") {
		throw new PiboWebHttpError("Content-Type must be application/json", 415);
	}

	const origin = request.headers.get("origin");
	if (!origin) {
		throw new PiboWebHttpError("Origin header is required", 403);
	}

	if (origin !== new URL(request.url).origin) {
		throw new PiboWebHttpError("Origin is not allowed", 403);
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

	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}

	if (typeof value === "object") {
		return Object.values(value).every(isJsonValue);
	}

	return false;
}

function principalIdFor(webSession: PiboWebSession): string {
	return webSession.ownerScope;
}

function roomResourcePath(pathname: string): { roomId: string; child?: "events" | "messages" | "read" } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/rooms/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname
		.slice(prefix.length)
		.split("/")
		.filter((part) => part.length > 0);
	if (parts.length < 1 || parts.length > 2) return undefined;
	try {
		const roomId = decodeURIComponent(parts[0]);
		const child = parts[1] ? (decodeURIComponent(parts[1]) as "events" | "messages" | "read") : undefined;
		if (child && child !== "events" && child !== "messages" && child !== "read") return undefined;
		return { roomId, child };
	} catch {
		throw new PiboWebHttpError("Invalid room id", 400);
	}
}

function agentResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/agents/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid agent id", 400);
	}
}

function workflowPickerKind(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/pickers/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedKind = pathname.slice(prefix.length);
	if (!encodedKind || encodedKind.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedKind);
	} catch {
		throw new PiboWebHttpError("Invalid workflow picker kind", 400);
	}
}

function workflowDraftResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/drafts/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow draft id", 400);
	}
}

function workflowDraftActionResource(pathname: string): { draftId: string; action: "validate" | "publish" } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/drafts/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
	try {
		const action = decodeURIComponent(parts[1]);
		if (action !== "validate" && action !== "publish") return undefined;
		return { draftId: decodeURIComponent(parts[0]), action };
	} catch {
		throw new PiboWebHttpError("Invalid workflow draft action", 400);
	}
}

function workflowDuplicateResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	const suffix = "/duplicate";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedId = pathname.slice(prefix.length, -suffix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

function workflowNextDraftResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/workflows/`;
	const suffix = "/drafts";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedId = pathname.slice(prefix.length, -suffix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid workflow id", 400);
	}
}

function piPackageResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/pi-packages/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid Pi package id", 400);
	}
}

function mcpServerResourceName(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/mcp-servers/`;
	const suffix = "/description";
	if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return undefined;
	const encodedName = pathname.slice(prefix.length, -suffix.length);
	if (!encodedName || encodedName.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedName);
	} catch {
		throw new PiboWebHttpError("Invalid MCP server name", 400);
	}
}

function etagForVersion(version: string): string {
	return `"${version}"`;
}

function requestMatchesVersion(request: Request, version: string): boolean {
	const header = request.headers.get("if-none-match");
	if (!header) return false;
	return header
		.split(",")
		.map((value) => value.trim())
		.some((value) => value === "*" || value === etagForVersion(version) || value === `W/${etagForVersion(version)}`);
}

const DEFAULT_TRACE_EVENTS_PAGE_SIZE = 2_000;
const MAX_TRACE_EVENTS_PER_REQUEST = 50_000;

function traceCacheKey(piboSessionId: string, version: string): string {
	return [piboSessionId, version, "structural"].join(":");
}

function withRawTraceTail(trace: PiboSessionTraceView, rawEvents: PiboSessionTraceView["rawEvents"]): PiboSessionTraceView {
	if (rawEvents.length === 0) return trace;
	return { ...trace, rawEvents };
}

function annotateTracePage(
	trace: PiboSessionTraceView,
	events: PiboSessionTraceView["rawEvents"],
	input: { lastEventSequence: number; pageSize: number; beforeSequence?: number },
): PiboSessionTraceView {
	const sequences = events
		.map((event) => event.eventSequence)
		.filter((sequence): sequence is number => typeof sequence === "number");
	const firstEventSequence = sequences.length ? Math.min(...sequences) : undefined;
	const lastEventSequence = sequences.length ? Math.max(...sequences) : undefined;
	return {
		...trace,
		eventCount: input.lastEventSequence,
		eventLimit: input.pageSize,
		pageSize: input.pageSize,
		beforeSequence: input.beforeSequence,
		firstEventSequence,
		lastEventSequence,
		nextBeforeSequence: firstEventSequence,
		hasOlderEvents: firstEventSequence !== undefined ? firstEventSequence > 1 : false,
	};
}

function setTraceCache(cache: Map<string, PiboSessionTraceView>, key: string, trace: PiboSessionTraceView): void {
	if (trace.rawEvents.length > 0) return;
	cache.delete(key);
	cache.set(key, trace);
	while (cache.size > TRACE_CACHE_MAX_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (typeof oldestKey !== "string") break;
		cache.delete(oldestKey);
	}
}

function normalizeRoomName(value: unknown, fallback = "New Chat"): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Room name must be a string", 400);
	const name = value.replace(/\s+/g, " ").trim();
	if (!name) throw new PiboWebHttpError("Room name is required", 400);
	if (name.length > 120) throw new PiboWebHttpError("Room name is too long", 400);
	return name;
}

function normalizeRoomTopic(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Room topic must be a string", 400);
	const topic = value.replace(/\s+/g, " ").trim();
	if (!topic) return undefined;
	if (topic.length > 500) throw new PiboWebHttpError("Room topic is too long", 400);
	return topic;
}

function normalizeOptionalRoomTopic(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return normalizeRoomTopic(value) ?? null;
}

function normalizeRoomType(value: unknown): "space" | "chat" | "agent" {
	if (value === undefined) return "chat";
	if (value === "space" || value === "chat" || value === "agent") return value;
	throw new PiboWebHttpError("Room type is invalid", 400);
}

function normalizeParentRoomId(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Parent room id must be a string", 400);
	return value;
}

function normalizeOptionalParentRoomId(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === "") return null;
	if (typeof value !== "string") throw new PiboWebHttpError("Parent room id must be a string", 400);
	return value;
}

function normalizeRoomArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Room archived flag must be boolean", 400);
	return value;
}

function normalizeRoomWorkspace(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Room workspace must be a string", 400);
	const workspace = value.trim();
	if (!workspace) return undefined;
	if (!isAbsolute(workspace)) {
		throw new PiboWebHttpError("Room workspace must be an absolute path", 400);
	}
	if (!existsSync(workspace)) {
		throw new PiboWebHttpError(`Room workspace does not exist: ${workspace}`, 400);
	}
	if (!statSync(workspace).isDirectory()) {
		throw new PiboWebHttpError(`Room workspace is not a directory: ${workspace}`, 400);
	}
	return workspace;
}

function normalizeOptionalRoomWorkspace(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return normalizeRoomWorkspace(value) ?? null;
}

function normalizeRoomDeleteConfirmation(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Type the room name to permanently delete it.", 400);
	}
	return value.trim();
}

function normalizeAgentDisplayName(value: unknown, fallback = "new-agent"): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Agent name must be a string", 400);
	const name = value.trim();
	if (!name) throw new PiboWebHttpError("Agent name is required", 400);
	if (name.length > 120) throw new PiboWebHttpError("Agent name is too long", 400);
	if (!isValidCustomAgentName(name)) {
		throw new PiboWebHttpError("Agent name must be lowercase kebab-case, for example test-agent", 400);
	}
	return name;
}

function normalizeAgentDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Agent description must be a string", 400);
	const description = value.trim();
	if (!description) return undefined;
	if (description.length > 1000) throw new PiboWebHttpError("Agent description is too long", 400);
	return description;
}

function normalizeNameArray(value: unknown, label: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new PiboWebHttpError(`${label} must be an array`, 400);
	const names = value.map((item) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new PiboWebHttpError(`${label} entries must be non-empty strings`, 400);
		}
		return item.trim();
	});
	return [...new Set(names)];
}

function normalizeRegisteredPiPackages(value: unknown): string[] {
	const names = normalizeNameArray(value, "piPackages");
	const packages = listPiPackages();
	const registered = new Map(packages.flatMap((pkg) => [[pkg.id, pkg.id], [pkg.name, pkg.id]]));
	for (const name of names) {
		if (!registered.has(name)) throw new PiboWebHttpError(`Unknown Pi package "${name}"`, 400);
	}
	return [...new Set(names.map((name) => registered.get(name) ?? name))];
}

function normalizePiPackageWebSource(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Pi package source is required", 400);
	}
	const source = value.trim();
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		throw new PiboWebHttpError("Pi package source must be a https://pi.dev/packages/... URL", 400);
	}
	if (url.origin !== "https://pi.dev" || !url.pathname.startsWith("/packages/") || url.pathname === "/packages/") {
		throw new PiboWebHttpError("Pi package source must be a https://pi.dev/packages/... URL", 400);
	}
	return source;
}

function normalizeBuiltinTools(value: unknown): "default" | "disabled" {
	if (value === undefined) return "default";
	if (value === "default" || value === "disabled") return value;
	throw new PiboWebHttpError("builtinTools must be default or disabled", 400);
}

function normalizeBuiltinToolNames(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	return normalizeNameArray(value, "builtinToolNames");
}

function normalizeAutoContextFiles(value: unknown): boolean {
	if (value === undefined) return true;
	if (typeof value !== "boolean") throw new PiboWebHttpError("autoContextFiles must be a boolean", 400);
	return value;
}

function normalizeRunControl(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new PiboWebHttpError("runControl must be a boolean", 400);
	return value;
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

function normalizeMcpServerDescriptionBody(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("MCP server description must be a string", 400);
	const description = value.replace(/\s+/g, " ").trim();
	if (!description) throw new PiboWebHttpError("MCP server description is required", 400);
	if (description.length > 480) throw new PiboWebHttpError("MCP server description is too long", 400);
	return description;
}

function normalizeBasePromptMode(value: unknown): PiboBasePromptMode {
	if (value === "library" || value === "custom") return value;
	throw new PiboWebHttpError("mode must be library or custom", 400);
}

function normalizeCompactionPromptMode(value: unknown): PiboCompactionPromptMode {
	if (value === "library" || value === "custom") return value;
	throw new PiboWebHttpError("mode must be library or custom", 400);
}

function normalizeBasePromptMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("markdown must be a string", 400);
	return value;
}

function normalizeCompactionPromptMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("markdown must be a string", 400);
	return value;
}

function normalizeUserSkillName(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Skill name is required", 400);
	}
	const name = value.trim();
	if (name.length > 64) throw new PiboWebHttpError("Skill name is too long", 400);
	if (!/^[a-z][a-z0-9-]*$/.test(name)) {
		throw new PiboWebHttpError("Skill name must be lowercase kebab-case, e.g. my-skill", 400);
	}
	return name;
}

function normalizeUserSkillDescription(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("Skill description must be a string", 400);
	return value.trim();
}

function normalizeUserSkillMarkdown(value: unknown): string {
	if (typeof value !== "string") throw new PiboWebHttpError("Skill markdown must be a string", 400);
	return value;
}

function normalizeUserSkillEnabled(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
	return value;
}

function normalizeUserSkillUrl(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Skill URL is required", 400);
	}
	const url = value.trim();
	if (!url.startsWith("http://") && !url.startsWith("https://") && !url.includes("/")) {
		throw new PiboWebHttpError("Skill URL must be a valid URL or owner/repo shorthand", 400);
	}
	return url;
}

function userSkillResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/user-skills/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid user skill id", 400);
	}
}

function normalizeAgentArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("archived must be a boolean", 400);
	return value;
}

function normalizeAgentSubagents(value: unknown): CustomAgentSubagent[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new PiboWebHttpError("subagents must be an array", 400);
	return value.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new PiboWebHttpError("subagent entries must be objects", 400);
		}
		const raw = item as Record<string, unknown>;
		const name = normalizeAgentDisplayName(raw.name, "");
		if (typeof raw.targetProfile !== "string" || raw.targetProfile.trim().length === 0) {
			throw new PiboWebHttpError("subagent targetProfile is required", 400);
		}
		const subagent: CustomAgentSubagent = {
			name,
			targetProfile: raw.targetProfile.trim(),
		};
		const description = normalizeAgentDescription(raw.description);
		if (description) subagent.description = description;
		if (raw.timeoutMs !== undefined) {
			if (typeof raw.timeoutMs !== "number" || !Number.isFinite(raw.timeoutMs) || raw.timeoutMs <= 0) {
				throw new PiboWebHttpError("subagent timeoutMs must be a positive number", 400);
			}
			subagent.timeoutMs = Math.round(raw.timeoutMs);
		}
		if (raw.maxDepth !== undefined) {
			if (typeof raw.maxDepth !== "number" || !Number.isFinite(raw.maxDepth) || raw.maxDepth < 1) {
				throw new PiboWebHttpError("subagent maxDepth must be a positive number", 400);
			}
			subagent.maxDepth = Math.round(raw.maxDepth);
		}
		return subagent;
	});
}

function normalizeClientTxnId(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("clientTxnId must be a string", 400);
	const id = value.trim();
	if (!id) throw new PiboWebHttpError("clientTxnId must be a non-empty string", 400);
	if (id.length > 160) throw new PiboWebHttpError("clientTxnId is too long", 400);
	return id;
}

function normalizeSessionDeleteConfirmation(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError('Type "Delete this session" to permanently delete it.', 400);
	}
	return value.trim();
}

function normalizeMessageText(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Message text is required", 400);
	}
	return value;
}

function accessDenied(error: unknown): never {
	if (error instanceof Error) throw new PiboWebHttpError(error.message, 404);
	throw new PiboWebHttpError("Room is not available for this user", 404);
}

function createAgentStore(path?: string): CustomAgentStore {
	return path ? new CustomAgentStore(path) : createDefaultCustomAgentStore();
}

function loadChatModelDefaults(cwd = process.cwd()): PiboModelDefaults {
	return loadPiboModelDefaults(cwd);
}

function updateChatModelDefaults(body: ChatModelDefaultsBody, cwd = process.cwd()): PiboModelDefaults {
	return savePiboModelDefaults({
		main: normalizeModelProfile(body.main, "main"),
		subagent: normalizeModelProfile(body.subagent, "subagent"),
		thinking: normalizeThinkingLevel(body.thinking, "thinking"),
		mainThinking: normalizeThinkingLevel(body.mainThinking, "mainThinking"),
		subagentThinking: normalizeThinkingLevel(body.subagentThinking, "subagentThinking"),
		fast: normalizeOptionalBoolean(body.fast, "fast"),
		mainFast: normalizeOptionalBoolean(body.mainFast, "mainFast"),
		subagentFast: normalizeOptionalBoolean(body.subagentFast, "subagentFast"),
	}, cwd);
}

function createReliabilityStore(path?: string): PiboReliabilityStore {
	return path ? new PiboReliabilityStore(path) : createDefaultPiboReliabilityStore();
}

function createDataStore(options: ChatWebAppOptions): PiboDataStore {
	return new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
}

function createPersistenceMetrics(): ChatPersistenceMetrics {
	return { eventCount: 0, errorCount: 0, totalIndexingMs: 0, maxIndexingMs: 0 };
}

function recordPersistenceDuration(metrics: ChatPersistenceMetrics, durationMs: number): void {
	metrics.eventCount += 1;
	metrics.totalIndexingMs += durationMs;
	metrics.lastIndexingMs = durationMs;
	metrics.maxIndexingMs = Math.max(metrics.maxIndexingMs, durationMs);
}

function recordPersistenceError(metrics: ChatPersistenceMetrics, error: unknown): void {
	metrics.errorCount += 1;
	metrics.lastError = error instanceof Error ? error.message : String(error);
	metrics.lastErrorAt = new Date().toISOString();
}

function serializePersistenceMetrics(metrics: ChatPersistenceMetrics): ChatPersistenceMetrics & { averageIndexingMs: number } {
	return {
		...metrics,
		averageIndexingMs: metrics.eventCount > 0 ? metrics.totalIndexingMs / metrics.eventCount : 0,
	};
}

function ensureEventIndexing(state: ChatWebAppState, context: PiboWebAppContext): void {
	if (state.subscribedContext === context && state.unsubscribe) return;
	state.unsubscribe?.();
	state.subscribedContext = context;
	state.unsubscribe = context.channelContext.subscribe((event) => {
		const startedAt = performance.now();
		try {
			state.activeTraceSessions.add(event.piboSessionId);
			const session = context.channelContext.getSession(event.piboSessionId);
			const room = session ? ensureSessionRoom(state, context, session) : undefined;
			const result = state.outputCompactor.compact(event);
			for (const liveEvent of result.liveEvents) {
				if (isPersistableOutputEvent(liveEvent)) continue;
				state.sessionQuery.recordEvent(liveEvent, session);
				for (const listener of state.liveListeners) {
					listener({ roomId: room?.id, piboSessionId: liveEvent.piboSessionId, eventType: liveEvent.type, payload: liveEvent });
				}
			}
			for (const persistableEvent of result.persistedEvents) {
				if (!isPersistableOutputEvent(persistableEvent)) continue;
				let stored = state.eventCommands.appendOutputEvent(persistableEvent, {
					roomId: room?.id,
					actorId: session?.ownerScope,
				});
				if (!stored && session) {
					try {
						const createdAt = new Date().toISOString();
						const ingested = state.ingestService.ingestOutputEvent({
							session,
							roomId: room?.id,
							actorId: session.ownerScope,
							event: persistableEvent,
							createdAt,
						});
						stored = {
							streamId: ingested.streamId,
							roomId: room?.id,
							piboSessionId: persistableEvent.piboSessionId,
							eventId: "eventId" in persistableEvent && typeof persistableEvent.eventId === "string" ? persistableEvent.eventId : `pibo.output:${persistableEvent.type}:${ingested.streamId}`,
							eventType: persistableEvent.type,
							actorType: "assistant",
							actorId: session.ownerScope,
							createdAt,
							retentionClass: reliabilityRetentionClassForOutputEvent(persistableEvent) as StoredChatEvent["retentionClass"],
							payload: persistableEvent as unknown as PiboJsonValue,
						};
					} catch (error) {
						console.warn("[chat-web] failed to write output event into V2", error);
					}
				}
				if (!stored) continue;
				if (persistableEvent.type === "assistant_message" || persistableEvent.type === "message_finished" || persistableEvent.type === "session_error") {
					markActiveSessionRead(state, persistableEvent.piboSessionId, stored.streamId);
				}
				state.sessionQuery.recordEvent(persistableEvent, session, stored.streamId);
				state.reliabilityStore.append({
					topic: "pibo.output",
					key: persistableEvent.piboSessionId,
					eventId: `pibo.output:${persistableEvent.piboSessionId}:${persistableEvent.type}:${randomUUID()}`,
					retentionClass: reliabilityRetentionClassForOutputEvent(persistableEvent),
					payload: persistableEvent as PiboJsonValue,
				});
				for (const listener of state.liveListeners) listener(stored);
			}
			recordPersistenceDuration(state.persistenceMetrics, performance.now() - startedAt);
		} catch (error) {
			recordPersistenceError(state.persistenceMetrics, error);
			console.error("[chat-web] failed to index router event", error);
			throw error;
		}
	});
}

function reliabilityRetentionClassForOutputEvent(event: PiboOutputEvent): string {
	if (event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated") return "live_delta";
	if (event.type === "assistant_message" || event.type === "message_started" || event.type === "message_finished") {
		return "chat_message";
	}
	return "trace_event";
}

function appendEventStreamDisconnectEvent(
	state: ChatWebAppState,
	piboSessionId: string,
	type: string,
	payload: Record<string, PiboJsonValue>,
): void {
	state.reliabilityStore.append({
		topic: "chat.event_stream",
		key: piboSessionId,
		eventId: `chat.event_stream:${piboSessionId}:${type}:${randomUUID()}`,
		retentionClass: "trace_event",
		payload: { type, piboSessionId, ...payload },
	});
}

function markEventStreamConnected(state: ChatWebAppState, piboSessionId: string, streamId: string, principalId: string): void {
	const streams = state.activeEventStreams.get(piboSessionId) ?? new Map<string, string>();
	streams.set(streamId, principalId);
	state.activeEventStreams.set(piboSessionId, streams);
}

function markEventStreamDisconnected(input: {
	state: ChatWebAppState;
	piboSessionId: string;
	streamId: string;
}): void {
	const streams = input.state.activeEventStreams.get(input.piboSessionId);
	if (streams) {
		streams.delete(input.streamId);
		if (streams.size === 0) input.state.activeEventStreams.delete(input.piboSessionId);
	}
	appendEventStreamDisconnectEvent(input.state, input.piboSessionId, "event_stream_disconnected", {
		activeStreams: input.state.activeEventStreams.get(input.piboSessionId)?.size ?? 0,
	});
}

function markActiveSessionRead(state: ChatWebAppState, piboSessionId: string, streamId: number): void {
	const streams = state.activeEventStreams.get(piboSessionId);
	if (!streams) return;
	for (const principalId of new Set(streams.values())) {
		state.readState.markSessionRead(piboSessionId, principalId, streamId);
	}
}

function listOwnedSessions(context: PiboWebAppContext, webSession: PiboWebSession): PiboSession[] {
	return context.channelContext.findSessions({ ownerScope: webSession.ownerScope })
		.map((session) => canonicalizeSessionProfile(context, session))
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function canonicalizeSessionProfile(context: PiboWebAppContext, session: PiboSession): PiboSession {
	const canonicalProfile = canonicalProfileName(context, session.profile);
	if (!canonicalProfile || canonicalProfile === session.profile) return session;
	return context.channelContext.updateSession?.(session.id, { profile: canonicalProfile }) ?? {
		...session,
		profile: canonicalProfile,
	};
}

function canonicalProfileName(context: PiboWebAppContext, profileName: string): string | undefined {
	const matched = context.channelContext.getProfiles?.().find(
		(profile) => profile.name === profileName || profile.aliases.includes(profileName),
	);
	return matched?.name;
}

function visibleOwnedSessions(
	sessions: PiboSession[],
	selectedSession: PiboSession,
	includeArchived: boolean,
): PiboSession[] {
	if (includeArchived) return sessions;
	const byId = new Map(sessions.map((session) => [session.id, session]));
	return sessions.filter((session) => session.id === selectedSession.id || !hasArchivedSessionInPath(session, byId));
}

function sessionsInRoom(sessions: PiboSession[], roomId: string): PiboSession[] {
	return sessions.filter((session) => chatRoomIdFromMetadata(session.metadata) === roomId);
}

function sessionsInRoomSubtree(sessions: PiboSession[], roomId: string): PiboSession[] {
	const ids = new Set(sessionsInRoom(sessions, roomId).map((session) => session.id));
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of sessions) {
			if (session.parentId && ids.has(session.parentId) && !ids.has(session.id)) {
				ids.add(session.id);
				changed = true;
			}
		}
	}
	return sessions.filter((session) => ids.has(session.id));
}

function visibleSessionsInRoom(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	sessions: PiboSession[];
	selectedSession: PiboSession;
	selectedRoomId: string;
	includeArchived: boolean;
}): PiboSession[] {
	const roomSessions: PiboSession[] = [];
	const defaultRoom = input.state.roomService.ensureDefaultRoom({
		ownerScope: input.webSession.ownerScope,
		principalId: principalIdFor(input.webSession),
	});
	const selectedRoomIsDefault = input.selectedRoomId === defaultRoom.id;
	for (const session of input.sessions) {
		const roomId = chatRoomIdFromMetadata(session.metadata);
		if (roomId === input.selectedRoomId || (selectedRoomIsDefault && !roomId)) {
			roomSessions.push(roomSessionWithRoom(session, input.selectedRoomId));
		}
	}
	if (!roomSessions.some((session) => session.id === input.selectedSession.id)) {
		roomSessions.push(roomSessionWithRoom(input.selectedSession, input.selectedRoomId));
	}
	return visibleOwnedSessions(roomSessions, input.selectedSession, input.includeArchived);
}

function roomSessionWithRoom(session: PiboSession, roomId: string): PiboSession {
	return chatRoomIdFromMetadata(session.metadata) === roomId
		? session
		: { ...session, metadata: withChatRoomId(session.metadata, roomId) };
}

function paginateSessionNodes(
	nodes: PiboWebSessionNode[],
	input: { archived: boolean; cursor?: string; limit: number },
): { sessions: PiboWebSessionNode[]; nextCursor?: string; totalCount: number } {
	const filtered = nodes.filter((node) => Boolean(node.archived) === input.archived);
	const startIndex = input.cursor ? filtered.findIndex((node) => node.piboSessionId === input.cursor) + 1 : 0;
	const safeStartIndex = Math.max(0, startIndex);
	const sessions = filtered.slice(safeStartIndex, safeStartIndex + input.limit);
	const nextCursor = safeStartIndex + sessions.length < filtered.length ? sessions.at(-1)?.piboSessionId : undefined;
	return { sessions, nextCursor, totalCount: filtered.length };
}

function sessionTreeVersion(nodes: PiboWebSessionNode[]): string {
	return nodes
		.map((node) => `${node.piboSessionId}:${node.lastActivityAt ?? ""}:${node.status}:${node.archived ? "1" : "0"}`)
		.join("|");
}

function selectedRoomIdForSession(state: ChatWebAppState, context: PiboWebAppContext, session: PiboSession): string {
	return ensureSessionRoom(state, context, session).id;
}

function hasArchivedSessionInPath(session: PiboSession, byId: ReadonlyMap<string, PiboSession>): boolean {
	let current: PiboSession | undefined = session;
	while (current) {
		if (isChatWebSessionArchived(current)) return true;
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return false;
}

function ensureDefaultChatSession(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	defaultProfile: string,
	roomId?: string,
): PiboSession {
	const room = roomId
		? requireRoom(state, roomId, webSession, "read")
		: state.roomService.ensureDefaultRoom({
				ownerScope: webSession.ownerScope,
				principalId: principalIdFor(webSession),
			});
	const existing = listOwnedSessions(context, webSession).find(
		(session) =>
			!session.parentId &&
			!isChatWebSessionArchived(session) &&
			chatRoomIdFromMetadata(session.metadata) === room.id,
	);
	if (existing) return existing;
	if (isPiboRoomArchived(room)) {
		const archivedExisting = listOwnedSessions(context, webSession).find(
			(session) => !session.parentId && chatRoomIdFromMetadata(session.metadata) === room.id,
		);
		if (archivedExisting) return archivedExisting;
		throw new PiboWebHttpError("Archived room has no sessions", 404);
	}
	return createPersonalChatSession(context, webSession, defaultProfile, room);
}

function ensureSessionRoom(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	session: PiboSession,
	webSession?: PiboWebSession,
): PiboRoom {
	const roomId = chatRoomIdFromMetadata(session.metadata);
	const existingRoom = roomId ? state.roomService.getRoom(roomId) : undefined;
	if (existingRoom) return existingRoom;
	const ownerScope = session.ownerScope ?? webSession?.ownerScope;
	if (!ownerScope) {
		return state.roomService.ensureDefaultRoom({ ownerScope: "system:unknown", principalId: "system:unknown" });
	}
	const principalId = webSession ? principalIdFor(webSession) : ownerScope;
	const room = state.roomService.ensureDefaultRoom({ ownerScope, principalId });
	if (!chatRoomIdFromMetadata(session.metadata)) {
		context.channelContext.updateSession?.(session.id, { metadata: withChatRoomId(session.metadata, room.id) });
	}
	return room;
}

function requireRoom(
	state: ChatWebAppState,
	roomId: string,
	webSession: PiboWebSession,
	action: "read" | "write" | "admin" = "read",
): PiboRoom {
	let room: PiboRoom;
	try {
		room = state.roomService.requireRoomAccess(roomId, principalIdFor(webSession), action);
	} catch (error) {
		accessDenied(error);
	}
	if (action === "write" && isPiboRoomArchived(room)) {
		throw new PiboWebHttpError("Archived rooms are read-only", 403);
	}
	return room;
}

function createPersonalChatSession(
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	profile: string,
	room: PiboRoom,
): PiboSession {
	return context.channelContext.createSession({
		channel: CHAT_WEB_CHANNEL,
		kind: "chat",
		profile,
		ownerScope: webSession.ownerScope,
		workspace: roomWorkspaceFromMetadata(room.metadata) ?? getDefaultPiboWorkspace(),
		metadata: withChatRoomId(undefined, room.id),
	});
}

function createProjectChatSession(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	project: PiboProject;
	profile: string;
	workflowId?: string;
	workflowVersion?: string;
	title?: string;
	configuredWorkflow?: boolean;
	configuration?: PiboProjectWorkflowSessionConfiguration;
}): PiboSession {
	const workflowSelection = resolveProjectWorkflowSelection(input.state, input.workflowId, input.workflowVersion);
	const session = input.context.channelContext.createSession({
		channel: CHAT_WEB_CHANNEL,
		kind: "chat",
		profile: input.profile,
		ownerScope: input.webSession.ownerScope,
		workspace: input.project.projectFolder,
		...(input.title ? { title: input.title } : {}),
		...(input.configuration?.model ? { activeModel: input.configuration.model } : {}),
		metadata: withWorkflowSessionKind({
			projectId: input.project.id,
			projectSessionKind: "main",
			projectWorkflowId: workflowSelection.id,
			projectWorkflowVersion: workflowSelection.version,
			...(input.configuration ? { projectWorkflowConfiguration: input.configuration } : {}),
		}, "main_workflow"),
	});
	input.state.projectService.addProjectSession({
		projectId: input.project.id,
		piboSessionId: session.id,
		kind: "main",
		workflowId: workflowSelection.id,
		workflowVersion: workflowSelection.version,
		title: session.title,
		state: input.configuredWorkflow ? "configured" : undefined,
		configuration: input.configuration,
	});
	input.state.sessionQuery.upsertSession(session);
	return session;
}

function resolveProjectWorkflowSelection(
	state: ChatWebAppState,
	workflowIdValue: unknown,
	workflowVersionValue?: unknown,
	options: { requireExplicitWorkflowId?: boolean; requireExplicitVersion?: boolean } = {},
): WorkflowVersionPickerOption {
	if (options.requireExplicitWorkflowId && (workflowIdValue === undefined || workflowIdValue === null || workflowIdValue === "")) {
		throw new PiboWebHttpError("Workflow id is required", 400);
	}
	const workflowId = normalizeProjectWorkflowId(workflowIdValue);
	const workflowVersion = normalizeProjectWorkflowVersion(workflowVersionValue);
	if (options.requireExplicitVersion && !workflowVersion) {
		throw new PiboWebHttpError("Workflow version is required", 400);
	}
	const candidates = buildProjectWorkflowVersionCatalog(state).filter((option) => option.id === workflowId);
	const selected = candidates.find((option) => workflowVersion === undefined || option.version === workflowVersion);
	if (!selected) {
		throw new PiboWebHttpError(`Unknown workflow version: ${workflowId}${workflowVersion ? `@${workflowVersion}` : ""}`, 400);
	}
	if (selected.status === "archived") {
		throw new PiboWebHttpError(`Workflow version '${selected.id}@${selected.version}' is archived and cannot create a Project session by default`, 400);
	}
	if (selected.status !== "published") {
		throw new PiboWebHttpError(`Workflow version '${selected.id}@${selected.version}' is not published`, 400);
	}
	return selected as WorkflowVersionPickerOption;
}

function normalizeLegacyProjectWorkflowId(value: unknown): string {
	const workflowId = normalizeProjectWorkflowId(value);
	if (workflowId !== "simple-chat") throw new PiboWebHttpError("Only the simple-chat workflow is available in V1", 400);
	return workflowId;
}

function normalizeProjectWorkflowId(value: unknown): string {
	if (value === undefined || value === null || value === "") return "simple-chat";
	if (typeof value !== "string" || !value.trim()) throw new PiboWebHttpError("Workflow id must be a string", 400);
	return value.trim();
}

function normalizeProjectWorkflowVersion(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" || !value.trim()) throw new PiboWebHttpError("Workflow version must be a string", 400);
	return value.trim();
}

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

function normalizeProjectWorkflowSessionConfiguration(body: ChatProjectSessionCreateBody, definition: PiboJsonObject): PiboProjectWorkflowSessionConfiguration {
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

function createProjectWorkflowSessionSnapshot(input: {
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
		diagnostics: validation.diagnostics as unknown as PiboJsonValue[],
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

function normalizeProjectPath(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new PiboWebHttpError("Project folder is required", 400);
	let projectPath = value.trim();
	if (projectPath === "~") projectPath = process.env.HOME ?? projectPath;
	else if (projectPath.startsWith("~/")) projectPath = `${process.env.HOME ?? ""}${projectPath.slice(1)}`;
	if (!isAbsolute(projectPath)) throw new PiboWebHttpError("Project folder must be an absolute path, e.g. ~/code/my-project or /home/me/code/my-project", 400);
	return resolve(projectPath);
}

function normalizeProjectDescription(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Project description must be a string", 400);
	return value.trim() || undefined;
}

function normalizeProjectArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Project archived flag must be boolean", 400);
	return value;
}

function normalizeProjectSessionArchived(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("Project session archived flag must be boolean", 400);
	return value;
}

function projectResourcePath(pathname: string): { projectId: string; child?: string } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/projects/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
	if (!parts[0]) return undefined;
	return { projectId: parts[0], ...(parts[1] ? { child: parts[1] } : {}) };
}

function projectWorkflowSessionStartResource(pathname: string): { projectId: string; piboSessionId: string } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/projects/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/");
	if (parts.length !== 4 || !parts[0] || parts[1] !== "workflow-sessions" || !parts[2] || parts[3] !== "start") return undefined;
	try {
		return { projectId: decodeURIComponent(parts[0]), piboSessionId: decodeURIComponent(parts[2]) };
	} catch {
		throw new PiboWebHttpError("Invalid Project workflow session start path", 400);
	}
}

function projectSessionResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/project-sessions/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	return decodeURIComponent(encodedId);
}

function resolveDownloadPath(path: string, basePath: string): string {
	return isAbsolute(path) ? resolve(path) : resolve(basePath, path);
}

function contentTypeForDownload(path: string): string {
	switch (extname(path).toLowerCase()) {
		case ".html":
		case ".htm":
			return "text/html; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".md":
		case ".txt":
		case ".log":
			return "text/plain; charset=utf-8";
		case ".pdf":
			return "application/pdf";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return "application/octet-stream";
	}
}

function parseBooleanSearchParam(url: URL, name: string): boolean {
	return url.searchParams.get(name) === "true";
}

function parsePositiveIntSearchParam(url: URL, name: string, fallback: number, max: number): number {
	const raw = url.searchParams.get(name);
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}

function parseOptionalPositiveIntSearchParam(url: URL, name: string): number | undefined {
	const raw = url.searchParams.get(name);
	if (!raw) return undefined;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new PiboWebHttpError(`${name} must be a positive integer`, 400);
	return parsed;
}

function sessionResourceId(pathname: string): string | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/sessions/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const encodedId = pathname.slice(prefix.length);
	if (!encodedId || encodedId.includes("/")) return undefined;
	try {
		return decodeURIComponent(encodedId);
	} catch {
		throw new PiboWebHttpError("Invalid session id", 400);
	}
}

function normalizeSessionTitle(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new PiboWebHttpError("Session title must be a string or null", 400);
	}
	const title = value.replace(/\s+/g, " ").trim();
	if (!title) return null;
	if (title.length > 120) {
		throw new PiboWebHttpError("Session title is too long", 400);
	}
	return title;
}

function metadataWithArchiveState(session: PiboSession, archived: unknown): PiboJsonObject | undefined {
	if (archived === undefined) return undefined;
	if (typeof archived !== "boolean") {
		throw new PiboWebHttpError("Session archived flag must be boolean", 400);
	}
	return withChatWebArchived(session.metadata, archived);
}

function createSessionUpdate(
	context: PiboWebAppContext,
	session: PiboSession,
	body: { title?: unknown; archived?: unknown; profile?: unknown; activeModel?: unknown },
): UpdatePiboSessionInput {
	const update: UpdatePiboSessionInput = {};
	const title = normalizeSessionTitle(body.title);
	if (title !== undefined) update.title = title;
	const metadata = metadataWithArchiveState(session, body.archived);
	if (metadata) update.metadata = metadata;
	if (body.profile !== undefined) {
		update.profile = resolveCreateSessionProfile(context, session.profile, body.profile);
	}
	if (body.activeModel !== undefined) {
		update.activeModel = body.activeModel === null ? null : normalizeModelProfile(body.activeModel, "activeModel");
	}
	if (!("title" in update) && !("metadata" in update) && !("profile" in update) && !("activeModel" in update)) {
		throw new PiboWebHttpError("No session update fields provided", 400);
	}
	return update;
}

function createRoomUpdate(room: PiboRoom, body: ChatRoomPatchBody): {
	name?: string;
	topic?: string | null;
	parentRoomId?: string | null;
	metadata?: PiboJsonObject;
} {
	if (isDefaultPiboRoom(room)) {
		throw new PiboWebHttpError("Personal Chat cannot be changed", 400);
	}
	const update: {
		name?: string;
		topic?: string | null;
		parentRoomId?: string | null;
		metadata?: PiboJsonObject;
	} = {};
	if (body.name !== undefined) update.name = normalizeRoomName(body.name);
	if (body.topic !== undefined) update.topic = normalizeOptionalRoomTopic(body.topic);
	if (body.parentRoomId !== undefined) update.parentRoomId = normalizeOptionalParentRoomId(body.parentRoomId);
	const archived = normalizeRoomArchived(body.archived);
	const workspace = normalizeOptionalRoomWorkspace(body.workspace);
	let metadata = room.metadata;
	let metadataChanged = false;
	if (archived !== undefined) {
		metadata = withPiboRoomArchived(metadata, archived);
		metadataChanged = true;
	}
	if (workspace !== undefined) {
		metadata = withPiboRoomWorkspace(metadata, workspace ?? undefined);
		metadataChanged = true;
	}
	if (metadataChanged) update.metadata = metadata;
	if (Object.keys(update).length === 0) {
		throw new PiboWebHttpError("No room update fields provided", 400);
	}
	return update;
}

function ensureCustomAgentProfiles(state: ChatWebAppState, context: PiboWebAppContext): void {
	if (!context.channelContext.upsertProfile) return;
	for (const agent of state.agentStore.list()) {
		context.channelContext.upsertProfile(createCustomAgentProfileDefinition(agent));
	}
}

function serializeCustomAgent(agent: CustomAgentDefinition, context: PiboWebAppContext) {
	return {
		...agent,
		brokenContextFiles: listBrokenContextFiles(agent.contextFiles, context),
	};
}

function serializeCustomAgents(agents: readonly CustomAgentDefinition[], context: PiboWebAppContext) {
	return agents.map((agent) => serializeCustomAgent(agent, context));
}

function listBrokenContextFiles(keys: readonly string[], context: PiboWebAppContext): string[] {
	const catalog = context.channelContext.getCapabilityCatalog?.();
	if (!catalog) return [];
	const knownKeys = new Set(catalog.contextFiles.map((contextFile) => contextFile.key));
	return keys.filter((key) => !knownKeys.has(key));
}

function syncUserSkills(state: ChatWebAppState, context: PiboWebAppContext): void {
	const registerSkill = context.channelContext.registerSkill;
	const unregisterSkill = context.channelContext.unregisterSkill;
	if (!registerSkill || !unregisterSkill) return;

	const userSkills = state.userSkillManager.list();
	const enabledNames = new Set(userSkills.filter((s) => s.enabled).map((s) => s.name));
	const previouslySyncedNames = state.syncedUserSkillNames ?? new Set<string>();

	// Unregister disabled or removed user skills
	for (const name of previouslySyncedNames) {
		if (!enabledNames.has(name)) {
			unregisterSkill(name);
		}
	}

	// Register only newly enabled user skills. Re-registering an already synced
	// skill would trip the registry duplicate-skill guard and break the web UI.
	for (const skill of userSkills) {
		if (skill.enabled && !previouslySyncedNames.has(skill.name)) {
			registerSkill({ name: skill.name, path: skill.path, enabled: true, kind: "user" });
		}
	}

	state.syncedUserSkillNames = enabledNames;
}

function assertUserSkillNameIsAvailable(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	name: string,
	currentSkillId?: string,
): void {
	const currentSkill = currentSkillId ? state.userSkillManager.get(currentSkillId) : undefined;
	const conflict = (context.channelContext.getCapabilityCatalog?.().skills ?? []).find((skill) => (
		skill.name === name && (!currentSkill || currentSkill.name !== name)
	));
	if (conflict) {
		throw new PiboWebHttpError(`Skill name "${name}" conflicts with an existing registered skill`, 409);
	}
}

function createAgentInput(ownerScope: string, body: ChatAgentBody) {
	return {
		ownerScope,
		displayName: normalizeAgentDisplayName(body.displayName),
		description: normalizeAgentDescription(body.description),
		nativeTools: normalizeNameArray(body.nativeTools, "nativeTools"),
		skills: normalizeNameArray(body.skills, "skills"),
		contextFiles: normalizeNameArray(body.contextFiles, "contextFiles"),
		subagents: normalizeAgentSubagents(body.subagents),
		mcpServers: normalizeNameArray(body.mcpServers, "mcpServers"),
		piPackages: normalizeRegisteredPiPackages(body.piPackages),
		mainModel: normalizeModelProfile(body.mainModel, "mainModel"),
		subagentModel: normalizeModelProfile(body.subagentModel, "subagentModel"),
		thinkingLevel: normalizeThinkingLevel(body.thinkingLevel, "thinkingLevel"),
		mainThinkingLevel: normalizeThinkingLevel(body.mainThinkingLevel, "mainThinkingLevel"),
		subagentThinkingLevel: normalizeThinkingLevel(body.subagentThinkingLevel, "subagentThinkingLevel"),
		fast: normalizeOptionalBoolean(body.fast, "fast"),
		mainFast: normalizeOptionalBoolean(body.mainFast, "mainFast"),
		subagentFast: normalizeOptionalBoolean(body.subagentFast, "subagentFast"),
		builtinTools: normalizeBuiltinTools(body.builtinTools),
		builtinToolNames: normalizeBuiltinToolNames(body.builtinToolNames),
		autoContextFiles: normalizeAutoContextFiles(body.autoContextFiles),
		runControl: normalizeRunControl(body.runControl),
	};
}

function createAgentUpdate(body: ChatAgentBody): UpdateCustomAgentInput {
	const update: UpdateCustomAgentInput = {};
	if (body.displayName !== undefined) update.displayName = normalizeAgentDisplayName(body.displayName);
	if (body.description !== undefined) update.description = normalizeAgentDescription(body.description);
	if (body.nativeTools !== undefined) update.nativeTools = normalizeNameArray(body.nativeTools, "nativeTools");
	if (body.skills !== undefined) update.skills = normalizeNameArray(body.skills, "skills");
	if (body.contextFiles !== undefined) update.contextFiles = normalizeNameArray(body.contextFiles, "contextFiles");
	if (body.subagents !== undefined) update.subagents = normalizeAgentSubagents(body.subagents);
	if (body.mcpServers !== undefined) update.mcpServers = normalizeNameArray(body.mcpServers, "mcpServers");
	if (body.piPackages !== undefined) update.piPackages = normalizeRegisteredPiPackages(body.piPackages);
	if (body.mainModel !== undefined) update.mainModel = normalizeModelProfile(body.mainModel, "mainModel");
	if (body.subagentModel !== undefined) update.subagentModel = normalizeModelProfile(body.subagentModel, "subagentModel");
	if (body.thinkingLevel !== undefined) update.thinkingLevel = normalizeThinkingLevel(body.thinkingLevel, "thinkingLevel");
	if (body.mainThinkingLevel !== undefined) update.mainThinkingLevel = normalizeThinkingLevel(body.mainThinkingLevel, "mainThinkingLevel");
	if (body.subagentThinkingLevel !== undefined) update.subagentThinkingLevel = normalizeThinkingLevel(body.subagentThinkingLevel, "subagentThinkingLevel");
	if (body.fast !== undefined) update.fast = normalizeOptionalBoolean(body.fast, "fast");
	if (body.mainFast !== undefined) update.mainFast = normalizeOptionalBoolean(body.mainFast, "mainFast");
	if (body.subagentFast !== undefined) update.subagentFast = normalizeOptionalBoolean(body.subagentFast, "subagentFast");
	if (body.builtinTools !== undefined) update.builtinTools = normalizeBuiltinTools(body.builtinTools);
	if (body.builtinToolNames !== undefined) update.builtinToolNames = normalizeBuiltinToolNames(body.builtinToolNames);
	if (body.autoContextFiles !== undefined) update.autoContextFiles = normalizeAutoContextFiles(body.autoContextFiles);
	if (body.runControl !== undefined) update.runControl = normalizeRunControl(body.runControl);
	if (Object.keys(update).length === 0 && body.archived === undefined) {
		throw new PiboWebHttpError("No agent update fields provided", 400);
	}
	return update;
}

function requireAgentProfileNameAvailable(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	profileName: string,
	currentAgentId?: string,
): void {
	const currentAgent = currentAgentId ? state.agentStore.get(currentAgentId) : undefined;
	if (currentAgent?.profileName === profileName) return;
	for (const agent of state.agentStore.list(undefined, { includeArchived: true })) {
		if (agent.id !== currentAgentId && agent.profileName === profileName) {
			throw new PiboWebHttpError(`Agent name "${profileName}" already exists`, 400);
		}
	}
	const matchedProfile = context.channelContext.getProfiles?.().find(
		(profile) => profile.name === profileName || profile.aliases.includes(profileName),
	);
	if (matchedProfile) throw new PiboWebHttpError(`Agent name "${profileName}" conflicts with an existing profile`, 400);
}

function requireOwnedAgent(agent: CustomAgentDefinition | undefined, webSession: PiboWebSession): CustomAgentDefinition {
	if (!agent || agent.ownerScope !== webSession.ownerScope) {
		throw new PiboWebHttpError("Agent is not available for this user", 404);
	}
	return agent;
}

async function buildAgentCatalog(context: PiboWebAppContext, state: ChatWebAppState) {
	return {
		...(context.channelContext.getCapabilityCatalog?.() ?? {
			nativeTools: [],
			skills: [],
			subagents: [],
			contextFiles: [],
			packages: [],
			piboTools: [],
			mcpServers: [],
			piPackages: [],
		}),
		mcpServers: await listMcpServerInfos(),
		piPackages: listPiPackages(),
		userSkills: state.userSkillManager.list(),
	};
}

function buildWorkflowProfilePicker(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	selectedProfileId?: string,
): WorkflowProfilePickerResponse {
	const customAgents = state.agentStore.list(webSession.ownerScope, { includeArchived: true });
	const allCustomProfileNames = new Set(customAgents.map((agent) => agent.profileName));
	const archivedCustomAgents = new Map(
		customAgents.filter((agent) => agent.archivedAt).map((agent) => [agent.profileName, agent]),
	);
	const options: WorkflowProfilePickerOption[] = [];

	for (const agent of customAgents) {
		if (agent.archivedAt) continue;
		options.push({
			id: agent.profileName,
			displayName: agent.displayName,
			...(agent.description ? { description: agent.description } : {}),
			aliases: [],
			source: "custom",
			visibility: "private",
			archived: false,
			nativeTools: [...agent.nativeTools],
			skills: [...agent.skills],
			contextFiles: [...agent.contextFiles],
		});
	}

	for (const profile of context.channelContext.getProfiles?.() ?? []) {
		if (allCustomProfileNames.has(profile.name)) continue;
		options.push({
			id: profile.name,
			displayName: profile.name,
			...(profile.description ? { description: profile.description } : {}),
			aliases: [...(profile.aliases ?? [])],
			source: "global",
			visibility: "global",
			archived: false,
			nativeTools: [...(profile.nativeTools ?? [])],
			skills: [...(profile.skills ?? [])],
			contextFiles: [...(profile.contextFiles ?? [])],
		});
	}

	options.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));

	const normalizedSelection = selectedProfileId?.trim() || undefined;
	const activeSelection = normalizedSelection && options.some((option) => option.id === normalizedSelection)
		? normalizedSelection
		: undefined;
	const diagnostics: WorkflowPickerDiagnostic[] = [];
	if (normalizedSelection && !activeSelection) {
		if (archivedCustomAgents.has(normalizedSelection)) {
			diagnostics.push({
				code: "WorkflowGraphError.archivedAgentProfileRef",
				message: `Agent node references archived Agent Designer profile '${normalizedSelection}'.`,
				severity: "error",
				path: "$.nodes.agent.profile.id",
				registryRef: normalizedSelection,
				hint: "Restore the Agent Designer profile or select a non-archived profile before publishing or running this workflow.",
			});
		} else {
			diagnostics.push({
				code: "WorkflowGraphError.unknownAgentProfileRef",
				message: `Agent node references Agent Designer profile '${normalizedSelection}', but it is not available to this user.`,
				severity: "error",
				path: "$.nodes.agent.profile.id",
				registryRef: normalizedSelection,
				hint: "Select one of the non-archived Agent Designer profiles from the picker.",
			});
		}
	}

	return {
		kind: "profiles",
		options,
		...(activeSelection ? { selectedProfileId: activeSelection } : {}),
		diagnostics,
	};
}

const WORKFLOW_HANDLER_PICKER_OPTIONS: WorkflowHandlerPickerOption[] = [
	{
		id: "fixture.handlers.makePlan",
		displayName: "Make plan",
		description: "Registered code handler that turns a topic payload into a step plan.",
		inputSchema: null,
		outputSchema: null,
	},
	{
		id: "fixture.handlers.reviseDraft",
		displayName: "Revise draft",
		description: "Registered code handler that applies review feedback to a draft payload.",
		inputSchema: null,
		outputSchema: null,
	},
	{
		id: "fixture.handlers.summarizeDecision",
		displayName: "Summarize decision",
		description: "Registered code handler that normalizes a review decision into a workflow summary.",
		inputSchema: null,
		outputSchema: null,
	},
];

const WORKFLOW_ADAPTER_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.adapters.textToTopic",
		displayName: "Text to topic",
		description: "Registered deterministic adapter from the workflow fixtures registry.",
	},
	{
		id: "fixture.adapters.draftToSummary",
		displayName: "Draft to summary",
		description: "Registered deterministic adapter from the workflow fixtures registry.",
	},
];

const WORKFLOW_GUARD_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.guards.approved",
		displayName: "Approved",
		description: "Registered guard from the workflow fixtures registry.",
	},
	{
		id: "fixture.guards.needsRevision",
		displayName: "Needs revision",
		description: "Registered guard from the workflow fixtures registry.",
	},
];

const WORKFLOW_PROMPT_ASSET_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.promptBuilders.draftPrompt",
		displayName: "Draft prompt builder",
		description: "Registered prompt asset/prompt-builder ref from the workflow fixtures registry.",
	},
];

const WORKFLOW_HUMAN_ACTION_REF_OPTIONS: WorkflowHumanActionOption[] = [
	{
		id: "fixture.humanActions.approve",
		kind: "approve",
		displayName: "Approve",
		description: "Registered human action for approving a pending workflow wait token.",
	},
	{
		id: "fixture.humanActions.reject",
		kind: "reject",
		displayName: "Reject",
		description: "Registered human action for rejecting a pending workflow wait token.",
	},
];

function buildWorkflowHandlerPicker(selectedHandlerId?: string): WorkflowHandlerPickerResponse {
	const options = [...WORKFLOW_HANDLER_PICKER_OPTIONS]
		.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
	const normalizedSelection = selectedHandlerId?.trim() || undefined;
	const activeSelection = normalizedSelection && options.some((option) => option.id === normalizedSelection)
		? normalizedSelection
		: undefined;
	const diagnostics: WorkflowPickerDiagnostic[] = [];
	if (normalizedSelection && !activeSelection) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownHandlerRef",
			message: `Code node references handler '${normalizedSelection}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: "$.nodes.code.handler",
			registryRef: normalizedSelection,
			hint: "Select a registered handler from the code node picker before publishing or running this workflow.",
		});
	}
	return {
		kind: "handlers",
		options,
		...(activeSelection ? { selectedHandlerId: activeSelection } : {}),
		diagnostics,
	};
}

function buildWorkflowRegisteredRefPicker(
	kind: "guards" | "adapters",
	optionsInput: WorkflowRegisteredRefOption[],
	selectedRefId: string | undefined,
): WorkflowRegisteredRefPickerResponse {
	const options = [...optionsInput]
		.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
	const normalizedSelection = selectedRefId?.trim() || undefined;
	const activeSelection = normalizedSelection && options.some((option) => option.id === normalizedSelection)
		? normalizedSelection
		: undefined;
	const diagnostics: WorkflowPickerDiagnostic[] = [];
	if (normalizedSelection && !activeSelection) {
		const isGuard = kind === "guards";
		diagnostics.push({
			code: isGuard ? "WorkflowGraphError.unknownGuardRef" : "WorkflowGraphError.unknownAdapterRef",
			message: `Workflow edge references ${isGuard ? "guard" : "adapter"} '${normalizedSelection}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: isGuard ? "$.edges.edge.guard.handler" : "$.edges.edge.adapter.transform.id",
			registryRef: normalizedSelection,
			hint: `Select a registered ${isGuard ? "guard" : "adapter"} ref before publishing or running this workflow.`,
		});
	}
	return {
		kind,
		options,
		...(activeSelection ? { selectedRefId: activeSelection } : {}),
		diagnostics,
	};
}

function buildWorkflowVersionPicker(state: ChatWebAppState, selectedWorkflowId?: string, selectedWorkflowVersion?: string): WorkflowVersionPickerResponse {
	const options = buildProjectWorkflowVersionOptions(state);
	const normalizedWorkflowId = selectedWorkflowId?.trim() || undefined;
	const normalizedWorkflowVersion = selectedWorkflowVersion?.trim() || undefined;
	const selected = normalizedWorkflowId
		? options.find((option) => option.id === normalizedWorkflowId && (!normalizedWorkflowVersion || option.version === normalizedWorkflowVersion))
		: options[0];
	const diagnostics: WorkflowPickerDiagnostic[] = [];
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

function buildProjectWorkflowVersionOptions(state?: ChatWebAppState): WorkflowVersionPickerOption[] {
	return buildProjectWorkflowVersionCatalog(state).filter((option): option is WorkflowVersionPickerOption => option.status === "published");
}

const STATIC_WORKFLOW_VERSION_CATALOG: WorkflowCatalogVersionRecord[] = [
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

function buildProjectWorkflowVersionCatalog(state?: ChatWebAppState): WorkflowCatalogVersionRecord[] {
	const recordsByKey = new Map<string, WorkflowCatalogVersionRecord>();
	for (const record of STATIC_WORKFLOW_VERSION_CATALOG) {
		recordsByKey.set(workflowCatalogVersionKey(record.id, record.version), record);
	}
	if (state) {
		for (const record of state.workflowPublishedVersionStore.listPublishedVersions()) {
			recordsByKey.set(workflowCatalogVersionKey(record.workflowId, record.version), workflowCatalogRecordFromPublishedVersion(record));
		}
	}
	return [...recordsByKey.values()];
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

function workflowDefinitionTags(definition: PiboJsonObject): string[] {
	const metadata = isJsonObject(definition.metadata) ? definition.metadata : undefined;
	const tags = metadata && Array.isArray(metadata.tags) ? metadata.tags : [];
	return tags.filter((tag): tag is string => typeof tag === "string");
}

const WORKFLOW_STARTER_DRAFT_ID = "v2-starter-draft";

function workflowDraftBuilderPath(draftId: string): string {
	return `${CHAT_WEB_MOUNT_PATH}/workflows/drafts/${encodeURIComponent(draftId)}`;
}

function serializeWorkflowDraft(record: OwnedWorkflowDraftRecord): WorkflowDraftRecord {
	const { ownerScope: _ownerScope, ...draft } = record;
	return draft;
}

function requireWorkflowDraft(state: ChatWebAppState, webSession: PiboWebSession, draftId: string): WorkflowDraftRecord {
	return serializeWorkflowDraft(requireMutableWorkflowDraft(state, webSession, draftId));
}

function requireValidatedWorkflowDraft(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	draftId: string,
	trigger: WorkflowValidationTrigger = "draft_load",
): WorkflowDraftRecord {
	const record = requireMutableWorkflowDraft(state, webSession, draftId);
	runWorkflowDraftValidation(state, context, webSession, record, trigger);
	return serializeWorkflowDraft(record);
}

function duplicateWorkflowIntoDraft(
	state: ChatWebAppState,
	webSession: PiboWebSession,
	workflowIdValue: unknown,
	workflowVersionValue: unknown,
): WorkflowDraftRecord {
	const workflowId = normalizeProjectWorkflowId(workflowIdValue);
	const workflowVersion = normalizeProjectWorkflowVersion(workflowVersionValue);
	const published = selectPublishedWorkflowVersion(state, workflowId, workflowVersion);
	if (!published) throw new PiboWebHttpError("Published workflow version not found", 404);

	const copyWorkflowId = `ui-${published.id}-copy`;
	const existingDraft = state.workflowDraftStore.findActiveDraftByWorkflowId(copyWorkflowId);
	if (existingDraft) return serializeWorkflowDraft(existingDraft);

	const now = new Date().toISOString();
	const draftId = `draft_${published.id.replace(/[^a-zA-Z0-9_-]/g, "-")}_${published.version.replace(/[^a-zA-Z0-9_-]/g, "-")}_${randomUUID().slice(0, 8)}`;
	const draft: OwnedWorkflowDraftRecord = {
		draftId,
		workflowId: copyWorkflowId,
		source: "ui",
		status: "draft",
		baseWorkflowId: published.id,
		baseWorkflowVersion: published.version,
		baseDefinitionHash: `catalog:${published.id}@${published.version}`,
		versionIntent: "patch",
		definition: createDraftDefinitionFromPublishedWorkflow(published),
		diagnostics: [
			{
				code: "WorkflowBuilderInfo.duplicatedDraft",
				message: `Duplicated '${published.id}@${published.version}' into a UI draft wrapper.`,
				severity: "info",
				path: "$.metadata.migration",
				hint: "Future stories persist edits, validate every change, and publish immutable UI versions.",
			},
		],
		validationState: "warning",
		revision: 1,
		createdAt: now,
		updatedAt: now,
		ownerScope: webSession.ownerScope,
	};
	state.workflowDraftStore.saveDraft(draft);
	return serializeWorkflowDraft(draft);
}

function createNextVersionDraftFromPublishedWorkflow(
	state: ChatWebAppState,
	webSession: PiboWebSession,
	workflowIdValue: unknown,
	workflowVersionValue: unknown,
): { draft: WorkflowDraftRecord; reused: boolean } {
	const workflowId = normalizeProjectWorkflowId(workflowIdValue);
	const workflowVersion = normalizeProjectWorkflowVersion(workflowVersionValue);
	const published = selectPublishedWorkflowVersion(state, workflowId, workflowVersion);
	if (!published) throw new PiboWebHttpError("Published workflow version not found", 404);
	if (published.source !== "ui") {
		throw new PiboWebHttpError("Code workflow projections are read-only; duplicate them to a UI draft before editing", 409);
	}

	const existingDraft = state.workflowDraftStore.findActiveDraftByWorkflowId(published.id);
	if (existingDraft) {
		return { draft: serializeWorkflowDraft(existingDraft), reused: true };
	}

	const now = new Date().toISOString();
	const targetWorkflowVersion = nextPatchWorkflowVersion(published.version);
	const draftId = `draft_${published.id.replace(/[^a-zA-Z0-9_-]/g, "-")}_${published.version.replace(/[^a-zA-Z0-9_-]/g, "-")}_next_${randomUUID().slice(0, 8)}`;
	const draft: OwnedWorkflowDraftRecord = {
		draftId,
		workflowId: published.id,
		source: "ui",
		status: "draft",
		baseWorkflowId: published.id,
		baseWorkflowVersion: published.version,
		baseDefinitionHash: `catalog:${published.id}@${published.version}`,
		targetWorkflowVersion,
		versionIntent: "patch",
		definition: createNextVersionDraftDefinitionFromPublishedWorkflow(published, targetWorkflowVersion),
		diagnostics: [
			{
				code: "WorkflowBuilderInfo.nextVersionDraft",
				message: `Editing '${published.id}@${published.version}' created a draft for next version '${targetWorkflowVersion}'.`,
				severity: "info",
				path: "$.version",
				hint: "Published versions stay immutable; save edits in this draft and publish a new version when validation passes.",
			},
		],
		validationState: "warning",
		revision: 1,
		createdAt: now,
		updatedAt: now,
		ownerScope: webSession.ownerScope,
	};
	state.workflowDraftStore.saveDraft(draft);
	return { draft: serializeWorkflowDraft(draft), reused: false };
}

function selectPublishedWorkflowVersion(state: ChatWebAppState, workflowId: string, version?: string): WorkflowVersionPickerOption | undefined {
	const options = buildProjectWorkflowVersionOptions(state).filter((option) => option.id === workflowId);
	if (!version) return options[0];
	return options.find((option) => option.version === version);
}

function nextPatchWorkflowVersion(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
	if (!match) return `${version}.1`;
	return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function createStarterWorkflowDraft(webSession: PiboWebSession): OwnedWorkflowDraftRecord {
	const now = new Date().toISOString();
	return {
		draftId: WORKFLOW_STARTER_DRAFT_ID,
		workflowId: "ui-starter-workflow",
		source: "ui",
		status: "draft",
		versionIntent: "patch",
		definition: {
			id: "ui-starter-workflow",
			version: "0.1.0-draft",
			title: "Starter UI Workflow Draft",
			description: "Partial Pibo Workflow IR loaded by the Workflow Builder route.",
			metadata: {
				tags: ["ui-draft", "workflows-v2"],
			},
			nodes: {},
			edges: {},
			ui: {
				layout: "auto",
				positions: {},
			},
		},
		diagnostics: [
			{
				code: "WorkflowBuilderWarning.partialDraft",
				message: "This UI draft is intentionally partial and is not publishable yet.",
				severity: "warning",
				path: "$.nodes",
				hint: "Add workflow input/output contracts and at least one node before publishing in later builder stories.",
			},
		],
		validationState: "warning",
		revision: 1,
		createdAt: now,
		updatedAt: now,
		ownerScope: webSession.ownerScope,
	};
}

function createDraftDefinitionFromPublishedWorkflow(workflow: WorkflowVersionPickerOption): PiboJsonObject {
	return createWorkflowDraftDefinition({
		workflowId: `ui-${workflow.id}-copy`,
		version: `${workflow.version}-draft`,
		title: `${workflow.title} Draft`,
		description: workflow.description ?? `UI draft copied from ${workflow.id}@${workflow.version}.`,
		tags: ["ui-draft", ...workflow.tags],
		migrationNotes: `Duplicated from ${workflow.id}@${workflow.version} for Workflow UI Authoring V2.`,
		fromVersion: workflow.version,
	});
}

function createNextVersionDraftDefinitionFromPublishedWorkflow(workflow: WorkflowVersionPickerOption, targetWorkflowVersion: string): PiboJsonObject {
	return createWorkflowDraftDefinition({
		workflowId: workflow.id,
		version: targetWorkflowVersion,
		title: `${workflow.title} Draft`,
		description: workflow.description ?? `Next-version draft for ${workflow.id}@${workflow.version}.`,
		tags: ["ui-draft", "next-version", ...workflow.tags],
		migrationNotes: `Editing immutable ${workflow.id}@${workflow.version}; next publish targets ${targetWorkflowVersion}.`,
		fromVersion: workflow.version,
	});
}

function createWorkflowDraftDefinition(input: {
	workflowId: string;
	version: string;
	title: string;
	description: string;
	tags: string[];
	migrationNotes: string;
	fromVersion: string;
}): PiboJsonObject {
	return createRunnableWorkflowDefinition({
		workflowId: input.workflowId,
		version: input.version,
		title: input.title,
		description: input.description,
		tags: input.tags,
		profileId: "pibo-agent",
		metadata: {
			migration: {
				fromVersion: input.fromVersion,
				notes: input.migrationNotes,
			},
		},
	});
}

function createPublishedWorkflowDefinition(workflow: WorkflowVersionPickerOption, profileId: string): PiboJsonObject {
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

function normalizeWorkflowValidationTrigger(value: unknown, fallback: WorkflowValidationTrigger): WorkflowValidationTrigger {
	if (value === undefined || value === null || value === "") return fallback;
	if (typeof value !== "string") throw new PiboWebHttpError("Workflow validation trigger must be a string", 400);
	const trigger = value as WorkflowValidationTrigger;
	if (trigger !== fallback && !WORKFLOW_EDIT_VALIDATION_TRIGGERS.has(trigger)) {
		throw new PiboWebHttpError(`Workflow validation trigger '${value}' is not allowed for this route`, 400);
	}
	return trigger;
}

function normalizeWorkflowVersionIntent(value: unknown, fallback: "patch" | "minor" | "major"): "patch" | "minor" | "major" {
	if (value === undefined || value === null || value === "") return fallback;
	if (value === "patch" || value === "minor" || value === "major") return value;
	throw new PiboWebHttpError("Workflow version intent must be patch, minor, or major", 400);
}

type ParsedWorkflowSemver = { major: number; minor: number; patch: number };

function allocateWorkflowPublishedVersion(input: {
	draft: OwnedWorkflowDraftRecord;
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

function parseWorkflowSemver(version: string): ParsedWorkflowSemver | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) return undefined;
	return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareWorkflowSemver(left: ParsedWorkflowSemver, right: ParsedWorkflowSemver): number {
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

function workflowDraftDefinitionForPublishedVersion(definition: PiboJsonObject, workflowId: string, version: string): PiboJsonObject {
	return {
		...cloneJsonObject(definition),
		id: workflowId,
		version,
	};
}

function hashWorkflowDefinitionJson(definition: PiboJsonObject): string {
	return `sha256:${createHash("sha256").update(canonicalWorkflowDefinitionJson(definition)).digest("hex")}`;
}

function canonicalWorkflowDefinitionJson(definition: PiboJsonObject): string {
	return JSON.stringify(normalizeForCanonicalJson(definition));
}

function normalizeForCanonicalJson(value: PiboJsonValue | undefined): PiboJsonValue | undefined {
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

function parseWorkflowDraftDefinitionFromPatch(body: WorkflowDraftPatchBody): { definition?: PiboJsonObject; trigger: WorkflowValidationTrigger; diagnostic?: WorkflowDraftDiagnostic } {
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

function withoutRawWorkflowIrParseDiagnostic(diagnostics: WorkflowDraftDiagnostic[]): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.code !== WORKFLOW_RAW_IR_PARSE_DIAGNOSTIC_CODE);
}

function requireMutableWorkflowDraft(state: ChatWebAppState, webSession: PiboWebSession, draftId: string): OwnedWorkflowDraftRecord {
	let record = state.workflowDraftStore.getDraft(draftId);
	if (!record && draftId === WORKFLOW_STARTER_DRAFT_ID) {
		record = createStarterWorkflowDraft(webSession);
		state.workflowDraftStore.saveDraft(record);
	}
	if (!record) throw new PiboWebHttpError("Workflow draft not found", 404);
	return record;
}

function runWorkflowDraftValidation(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	record: OwnedWorkflowDraftRecord,
	trigger: WorkflowValidationTrigger,
): WorkflowValidationResponse {
	const diagnostics = [
		...record.diagnostics.filter((diagnostic) => !isWorkflowValidationPipelineDiagnostic(diagnostic)),
		...validateWorkflowDefinitionForV2(record.definition, { state, context, webSession }),
	];
	const validation = summarizeWorkflowDiagnostics(diagnostics, trigger);
	record.diagnostics = diagnostics;
	record.validationState = validation.validationState;
	record.validation = validation;
	record.updatedAt = validation.checkedAt;
	state.workflowDraftStore.saveDraft(record);
	return { validation, diagnostics };
}

function validatePublishedWorkflowBoundary(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	workflow: WorkflowVersionPickerOption;
	profileId: string;
	trigger: "before_project_session_creation" | "before_workflow_start";
}): WorkflowValidationResponse {
	const definition = createPublishedWorkflowDefinition(input.workflow, input.profileId);
	const diagnostics = validateWorkflowDefinitionForV2(definition, input);
	return {
		diagnostics,
		validation: summarizeWorkflowDiagnostics(diagnostics, input.trigger),
	};
}

function summarizeWorkflowDiagnostics(diagnostics: WorkflowDraftDiagnostic[], trigger: WorkflowValidationTrigger): WorkflowValidationSummary {
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

function isWorkflowValidationPipelineDiagnostic(diagnostic: WorkflowDraftDiagnostic): boolean {
	return WORKFLOW_VALIDATION_DIAGNOSTIC_PREFIXES.some((prefix) => diagnostic.code.startsWith(prefix));
}

function validateWorkflowDefinitionForV2(
	definition: PiboJsonObject,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
): WorkflowDraftDiagnostic[] {
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	validateRequiredString(definition, "id", "$.id", diagnostics);
	validateRequiredString(definition, "version", "$.version", diagnostics);
	validateWorkflowPortLike(definition.input, "$.input", diagnostics);
	validateWorkflowPortLike(definition.output, "$.output", diagnostics);

	const nodes = definition.nodes;
	const nodeIds = isJsonObject(nodes) ? Object.keys(nodes) : [];
	if (!isJsonObject(nodes)) {
		diagnostics.push({
			code: "WorkflowValidationError.missingNodes",
			message: "Workflow IR must include a nodes object.",
			severity: "error",
			path: "$.nodes",
			hint: "Save a Pibo Workflow IR object with nodes before publishing or running.",
		});
	} else if (nodeIds.length === 0) {
		diagnostics.push({
			code: "WorkflowValidationError.emptyGraph",
			message: "Runnable workflows must include at least one node.",
			severity: "error",
			path: "$.nodes",
			hint: "Drafts may stay incomplete, but publish and run/start are blocked until at least one node exists.",
		});
	}

	const edges = definition.edges;
	if (!isJsonObject(edges)) {
		diagnostics.push({
			code: "WorkflowValidationError.missingEdges",
			message: "Workflow IR must include an edges object.",
			severity: "error",
			path: "$.edges",
			hint: "Use an empty object when the workflow has no edges.",
		});
	}

	for (const [nodeId, node] of isJsonObject(nodes) ? Object.entries(nodes) : []) {
		validateWorkflowNodeLike(nodeId, node, input, diagnostics);
	}

	validateWorkflowInitialLike(definition.initial, new Set(nodeIds), diagnostics);

	for (const [edgeId, edge] of isJsonObject(edges) ? Object.entries(edges) : []) {
		validateWorkflowEdgeLike(edgeId, edge, isJsonObject(nodes) ? nodes : {}, diagnostics);
	}

	return diagnostics;
}

function validateWorkflowInitialLike(value: unknown, nodeIds: ReadonlySet<string>, diagnostics: WorkflowDraftDiagnostic[]): void {
	const initialNodes = typeof value === "string"
		? [value]
		: Array.isArray(value) && value.every((entry) => typeof entry === "string")
			? value
			: [];
	if (!initialNodes.length) {
		diagnostics.push({
			code: "WorkflowValidationError.missingInitialNode",
			message: "Workflow IR must choose an initial node.",
			severity: "error",
			path: "$.initial",
			hint: "Set initial to an existing node id before publishing or running.",
		});
		return;
	}
	for (const nodeId of initialNodes) {
		if (!nodeIds.has(nodeId)) {
			diagnostics.push({
				code: "WorkflowGraphError.unknownInitialNode",
				message: `Initial workflow node '${nodeId}' does not exist in nodes.`,
				severity: "error",
				path: "$.initial",
				nodeId,
				hint: "Point initial at an existing node id.",
			});
		}
	}
}

function validateWorkflowNodeLike(
	nodeId: string,
	value: PiboJsonValue,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.nodes.${nodeId}`;
	if (!isJsonObject(value)) {
		diagnostics.push({
			code: "WorkflowValidationError.invalidNode",
			message: `Workflow node '${nodeId}' must be a JSON object.`,
			severity: "error",
			path,
			nodeId,
		});
		return;
	}
	if (value.input !== undefined) validateWorkflowPortLike(value.input, `${path}.input`, diagnostics, { nodeId });
	if (value.output !== undefined) validateWorkflowPortLike(value.output, `${path}.output`, diagnostics, { nodeId });
	validateNoInlineExecutableCode(value, path, diagnostics, { nodeId });

	const kind = value.kind;
	if (kind === "agent") {
		validateWorkflowAgentNodeLike(nodeId, value, input, diagnostics);
		return;
	}
	if (kind === "code") {
		validateWorkflowCodeNodeLike(nodeId, value, diagnostics);
		return;
	}
	if (kind === "workflow") {
		validateWorkflowNestedNodeLike(nodeId, value, input, diagnostics);
		return;
	}
	if (kind === "adapter") {
		validateWorkflowAdapterNodeLike(nodeId, value, diagnostics);
		return;
	}
	if (kind === "human") {
		validateWorkflowHumanNodeLike(nodeId, value, diagnostics);
		return;
	}
	diagnostics.push({
		code: "WorkflowValidationError.unknownNodeKind",
		message: `Workflow node '${nodeId}' must use kind agent, code, workflow, adapter, or human.`,
		severity: "error",
		path: `${path}.kind`,
		nodeId,
		hint: "Use one of the registered V2 editable node kinds.",
	});
}

function validateWorkflowAgentNodeLike(
	nodeId: string,
	node: PiboJsonObject,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.nodes.${nodeId}`;
	if (node.runtime !== "pibo") {
		diagnostics.push({
			code: "WorkflowValidationError.invalidAgentRuntime",
			message: `Agent node '${nodeId}' must use the pibo runtime.`,
			severity: "error",
			path: `${path}.runtime`,
			nodeId,
		});
	}
	const profile = isJsonObject(node.profile) ? node.profile : undefined;
	const profileId = profile && profile.kind === "fixed" && typeof profile.id === "string" ? profile.id.trim() : undefined;
	if (!profileId) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownAgentProfileRef",
			message: `Agent node '${nodeId}' must select a fixed Agent Designer profile.`,
			severity: "error",
			path: `${path}.profile.id`,
			nodeId,
			hint: "Select a non-archived Agent Designer profile from the picker.",
		});
		return;
	}
	const picker = buildWorkflowProfilePicker(input.state, input.context, input.webSession, profileId);
	if (picker.selectedProfileId !== profileId) {
		const diagnostic = picker.diagnostics[0];
		diagnostics.push({
			code: diagnostic?.code ?? "WorkflowGraphError.unknownAgentProfileRef",
			message: diagnostic?.message ?? `Agent node '${nodeId}' references unavailable profile '${profileId}'.`,
			severity: "error",
			path: `${path}.profile.id`,
			nodeId,
			registryRef: profileId,
			hint: diagnostic?.hint ?? "Select a non-archived Agent Designer profile from the picker.",
		});
	}
	if (node.promptTemplate !== undefined && typeof node.promptTemplate !== "string") {
		diagnostics.push({
			code: "WorkflowValidationError.invalidPromptTemplate",
			message: `Agent node '${nodeId}' promptTemplate must be a string when present.`,
			severity: "error",
			path: `${path}.promptTemplate`,
			nodeId,
			hint: "Prompt edits must save text on the Pibo Workflow IR node.",
		});
	}
	if (node.promptTemplate !== undefined && node.promptBuilder !== undefined) {
		diagnostics.push({
			code: "WorkflowGraphError.ambiguousAgentPromptSource",
			message: `Agent node '${nodeId}' declares both promptTemplate and a registered prompt asset ref.`,
			severity: "error",
			path,
			nodeId,
			hint: "Use either direct promptTemplate text or a registered prompt asset/prompt-builder ref, not both.",
		});
	}
	if (node.promptBuilder !== undefined) validateWorkflowPromptAssetRefLike(nodeId, node.promptBuilder, diagnostics);
}

function validateWorkflowCodeNodeLike(nodeId: string, node: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	const path = `$.nodes.${nodeId}`;
	if (node.language !== "typescript") {
		diagnostics.push({
			code: "WorkflowValidationError.invalidCodeLanguage",
			message: `Code node '${nodeId}' must reference a registered TypeScript handler.`,
			severity: "error",
			path: `${path}.language`,
			nodeId,
			hint: "The UI cannot create inline JavaScript, shell, eval, or arbitrary executable code.",
		});
	}
	const handler = typeof node.handler === "string" ? node.handler.trim() : undefined;
	if (!handler || !WORKFLOW_HANDLER_PICKER_OPTIONS.some((option) => option.id === handler)) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownHandlerRef",
			message: handler
				? `Code node '${nodeId}' references handler '${handler}', but it is not registered in the Workflow Registry.`
				: `Code node '${nodeId}' must select a registered handler ref.`,
			severity: "error",
			path: `${path}.handler`,
			nodeId,
			...(handler ? { registryRef: handler } : {}),
			hint: "Select a registered handler from the code node picker before publishing or running this workflow.",
		});
	}
}

function validateWorkflowNestedNodeLike(
	nodeId: string,
	node: PiboJsonObject,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.nodes.${nodeId}`;
	const workflowId = typeof node.workflowId === "string" ? node.workflowId.trim() : undefined;
	const workflowVersion = typeof node.workflowVersion === "string" ? node.workflowVersion.trim() : undefined;
	const selected = workflowId
		? buildProjectWorkflowVersionOptions(input.state).find((option) => option.id === workflowId && (!workflowVersion || option.version === workflowVersion))
		: undefined;
	if (!selected) {
		const registryRef = workflowId ? `${workflowId}${workflowVersion ? `@${workflowVersion}` : ""}` : undefined;
		diagnostics.push({
			code: "WorkflowCatalogError.unknownWorkflowVersion",
			message: registryRef
				? `Nested workflow node '${nodeId}' references unavailable workflow version '${registryRef}'.`
				: `Nested workflow node '${nodeId}' must select a published workflow version.`,
			severity: "error",
			path: `${path}.workflowId`,
			nodeId,
			...(registryRef ? { registryRef } : {}),
			hint: "Select a published workflow version from the nested workflow picker before publishing or running.",
		});
	}
}

function validateWorkflowAdapterNodeLike(nodeId: string, node: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	validateRegisteredAdapterRefLike(node.handler, diagnostics, {
		nodeId,
		path: `$.nodes.${nodeId}.handler`,
		ownerLabel: `Adapter node '${nodeId}'`,
	});
	if (node.mode !== undefined && node.mode !== "deterministic") {
		diagnostics.push({
			code: "WorkflowSecurityError.hiddenLlmCoercion",
			message: `Adapter node '${nodeId}' must use deterministic registered adapter execution.`,
			severity: "error",
			path: `$.nodes.${nodeId}.mode`,
			nodeId,
			hint: "Hidden LLM coercion is not a substitute for registered adapters in V2.",
		});
	}
}

function validateWorkflowHumanNodeLike(nodeId: string, node: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	if (typeof node.prompt !== "string" || !node.prompt.trim()) {
		diagnostics.push({
			code: "WorkflowValidationError.invalidHumanPrompt",
			message: `Human node '${nodeId}' must include a prompt.`,
			severity: "error",
			path: `$.nodes.${nodeId}.prompt`,
			nodeId,
		});
	}
	if (node.schema !== undefined) validateJsonSchemaObjectLike(node.schema, `$.nodes.${nodeId}.schema`, diagnostics, { nodeId, requireObjectRoot: true });
	if (node.actions !== undefined) validateWorkflowHumanActionRefsLike(nodeId, node.actions, diagnostics);
}

function validateWorkflowEdgeLike(edgeId: string, value: PiboJsonValue, nodes: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	const path = `$.edges.${edgeId}`;
	if (!isJsonObject(value)) {
		diagnostics.push({
			code: "WorkflowValidationError.invalidEdge",
			message: `Workflow edge '${edgeId}' must be a JSON object.`,
			severity: "error",
			path,
			edgeId,
		});
		return;
	}
	const nodeIds = new Set(Object.keys(nodes));
	validateNoInlineExecutableCode(value, path, diagnostics, { edgeId });
	validateNoHiddenLlmCoercion(value, path, diagnostics, { edgeId });
	validateWorkflowEdgeEndpoint(edgeId, "from", value.from, nodeIds, diagnostics);
	validateWorkflowEdgeEndpoint(edgeId, "to", value.to, nodeIds, diagnostics);
	if (value.guard !== undefined) validateWorkflowGuardRefLike(edgeId, value.guard, diagnostics);
	if (value.adapter !== undefined) validateWorkflowEdgeAdapterLike(edgeId, value.adapter, nodes, value, diagnostics);
	else validateWorkflowEdgeDirectCompatibility(edgeId, value, nodes, diagnostics);
}

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

function validateNoInlineExecutableCode(
	value: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId">,
): void {
	for (const key of Object.keys(value)) {
		if (!INLINE_EXECUTABLE_FIELD_NAMES.has(key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())) continue;
		diagnostics.push({
			code: "WorkflowSecurityError.inlineExecutableCode",
			message: `${workflowDiagnosticOwnerLabel(target)} declares inline executable field '${key}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.${key}`,
			...target,
			hint: "Use registered handler, adapter, guard, prompt asset, or human action refs selected from V2 pickers instead of inline JavaScript, TypeScript, shell, eval, or arbitrary executable code.",
		});
	}
}

function validateNoHiddenLlmCoercion(
	value: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId">,
): void {
	for (const key of Object.keys(value)) {
		if (!HIDDEN_LLM_COERCION_FIELD_NAMES.has(key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())) continue;
		diagnostics.push({
			code: "WorkflowSecurityError.hiddenLlmCoercion",
			message: `${workflowDiagnosticOwnerLabel(target)} declares hidden LLM coercion field '${key}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.${key}`,
			...target,
			hint: "Use a visible registered adapter node or edge adapter when schemas are incompatible.",
		});
	}
	const kind = typeof value.kind === "string" ? value.kind.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() : "";
	if (kind === "llm" || kind === "llmadapter" || kind === "llmcoercion") {
		diagnostics.push({
			code: "WorkflowSecurityError.hiddenLlmCoercion",
			message: `${workflowDiagnosticOwnerLabel(target)} uses LLM coercion kind '${value.kind}', which is not allowed in Workflow UI Authoring V2.`,
			severity: "error",
			path: `${path}.kind`,
			...target,
			hint: "Use deterministic registered adapters instead of hidden LLM coercion.",
		});
	}
}

function workflowDiagnosticOwnerLabel(target: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId">): string {
	if (target.nodeId) return `Workflow node '${target.nodeId}'`;
	if (target.edgeId) return `Workflow edge '${target.edgeId}'`;
	return "Workflow definition";
}

function validateWorkflowPromptAssetRefLike(nodeId: string, value: unknown, diagnostics: WorkflowDraftDiagnostic[]): void {
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
	if (!WORKFLOW_PROMPT_ASSET_REF_OPTIONS.some((option) => option.id === ref.id)) {
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

function validateRegisteredAdapterRefLike(
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
	if (!WORKFLOW_ADAPTER_REF_OPTIONS.some((option) => option.id === ref.id)) {
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
	}
}

function readRegisteredAdapterRef(value: unknown): { id?: string; valid: boolean } {
	if (!isJsonObject(value)) return { valid: false };
	const id = typeof value.id === "string" ? value.id.trim() : undefined;
	return {
		id,
		valid: value.kind === "adapter" && value.language === "typescript" && Boolean(id),
	};
}

function validateWorkflowGuardRefLike(edgeId: string, value: unknown, diagnostics: WorkflowDraftDiagnostic[]): void {
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
	if (!WORKFLOW_GUARD_REF_OPTIONS.some((option) => option.id === guardId)) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownGuardRef",
			message: `Workflow edge '${edgeId}' references guard '${guardId}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path,
			edgeId,
			registryRef: guardId,
			hint: "Select a registered guard ref before publishing or running this workflow.",
		});
	}
}

function validateWorkflowHumanActionRefsLike(nodeId: string, value: unknown, diagnostics: WorkflowDraftDiagnostic[]): void {
	if (!Array.isArray(value)) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidHumanActionRef",
			message: `Human node '${nodeId}' actions must be an array of registered human action refs.`,
			severity: "error",
			path: `$.nodes.${nodeId}.actions`,
			nodeId,
			hint: "Select registered human actions such as approve/reject; V2 does not create arbitrary action handlers.",
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

function validateWorkflowEdgeAdapterLike(
	edgeId: string,
	value: unknown,
	nodes: PiboJsonObject,
	edge: PiboJsonObject,
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.edges.${edgeId}.adapter`;
	if (!isJsonObject(value)) {
		diagnostics.push({
			code: "WorkflowGraphError.invalidAdapterRef",
			message: `Workflow edge '${edgeId}' adapter must be a registered edge adapter object.`,
			severity: "error",
			path,
			edgeId,
			hint: "Use a visible edge adapter with a registered transform ref; hidden LLM coercion is not allowed.",
		});
		return;
	}
	validateNoInlineExecutableCode(value, path, diagnostics, { edgeId });
	validateNoHiddenLlmCoercion(value, path, diagnostics, { edgeId });
	if (value.kind !== undefined && value.kind !== "edgeAdapter") {
		diagnostics.push({
			code: "WorkflowGraphError.invalidAdapterRef",
			message: `Workflow edge '${edgeId}' adapter kind must be edgeAdapter when declared.`,
			severity: "error",
			path: `${path}.kind`,
			edgeId,
			hint: "Use edgeAdapter with a registered deterministic adapter transform.",
		});
	}
	validateRegisteredAdapterRefLike(value.transform, diagnostics, {
		edgeId,
		path: `${path}.transform`,
		ownerLabel: `Workflow edge '${edgeId}'`,
	});
	validateWorkflowPortLike(value.output, `${path}.output`, diagnostics, { edgeId });
	const targetPort = readEdgeTargetInputPort(edge, nodes);
	if (targetPort && isJsonObject(value.output) && !areWorkflowPortsDirectlyCompatible(value.output, targetPort)) {
		diagnostics.push({
			code: "WorkflowGraphError.incompatibleEdgeAdapterOutput",
			message: `Workflow edge '${edgeId}' adapter output is incompatible with the target input port.`,
			severity: "error",
			path: `${path}.output`,
			edgeId,
			hint: "Set the registered adapter output port to the target input contract; do not use hidden LLM coercion.",
		});
	}
}

function validateWorkflowEdgeDirectCompatibility(edgeId: string, edge: PiboJsonObject, nodes: PiboJsonObject, diagnostics: WorkflowDraftDiagnostic[]): void {
	const sourcePort = readEdgeSourceOutputPort(edge, nodes);
	const targetPort = readEdgeTargetInputPort(edge, nodes);
	if (!sourcePort || !targetPort || areWorkflowPortsDirectlyCompatible(sourcePort, targetPort)) return;
	diagnostics.push({
		code: "WorkflowGraphError.incompatibleEdgePorts",
		message: `Workflow edge '${edgeId}' connects incompatible source output and target input ports without a registered adapter.`,
		severity: "error",
		path: `$.edges.${edgeId}`,
		edgeId,
		hint: "Add a visible registered edge adapter or adapter node. Hidden LLM coercion is not allowed in V2.",
	});
}

function readEdgeSourceOutputPort(edge: PiboJsonObject, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const node = readWorkflowEdgeNode(edge.from, nodes);
	return node && isJsonObject(node.output) ? node.output : undefined;
}

function readEdgeTargetInputPort(edge: PiboJsonObject, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const node = readWorkflowEdgeNode(edge.to, nodes);
	return node && isJsonObject(node.input) ? node.input : undefined;
}

function readWorkflowEdgeNode(endpoint: unknown, nodes: PiboJsonObject): PiboJsonObject | undefined {
	const nodeId = isJsonObject(endpoint) && typeof endpoint.nodeId === "string" ? endpoint.nodeId.trim() : undefined;
	const node = nodeId ? nodes[nodeId] : undefined;
	return isJsonObject(node) ? node : undefined;
}

function areWorkflowPortsDirectlyCompatible(left: PiboJsonObject, right: PiboJsonObject): boolean {
	if (left.kind === "text" && right.kind === "text") return true;
	if (left.kind !== "json" || right.kind !== "json") return false;
	return JSON.stringify(normalizeForCanonicalJson(left.schema)) === JSON.stringify(normalizeForCanonicalJson(right.schema));
}

function validateWorkflowEdgeEndpoint(
	edgeId: string,
	field: "from" | "to",
	value: unknown,
	nodeIds: ReadonlySet<string>,
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	const path = `$.edges.${edgeId}.${field}.nodeId`;
	const nodeId = isJsonObject(value) && typeof value.nodeId === "string" ? value.nodeId.trim() : undefined;
	if (!nodeId || !nodeIds.has(nodeId)) {
		diagnostics.push({
			code: "WorkflowGraphError.unknownEdgeNode",
			message: nodeId
				? `Edge '${edgeId}' ${field} node '${nodeId}' does not exist.`
				: `Edge '${edgeId}' must specify a ${field} node id.`,
			severity: "error",
			path,
			edgeId,
			...(nodeId ? { nodeId } : {}),
			hint: "Connect edges only to existing workflow nodes.",
		});
	}
}

function validateWorkflowPortLike(value: unknown, path: string, diagnostics: WorkflowDraftDiagnostic[], target: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId"> = {}): void {
	if (!isJsonObject(value)) {
		diagnostics.push({
			code: "WorkflowValidationError.missingPort",
			message: `Workflow port '${path}' must be a JSON object.`,
			severity: "error",
			path,
			...target,
			hint: "Use a text port or a JSON port with a JSON Schema subset object.",
		});
		return;
	}
	if (value.kind === "text") return;
	if (value.kind === "json") {
		validateJsonSchemaObjectLike(value.schema, `${path}.schema`, diagnostics, { ...target, requireObjectRoot: true });
		return;
	}
	diagnostics.push({
		code: "WorkflowValidationError.invalidPortKind",
		message: `Workflow port '${path}' must use kind text or json.`,
		severity: "error",
		path: `${path}.kind`,
		...target,
		hint: "Use the existing Workflow IR port kinds; do not introduce a new schema layer.",
	});
}

function validateJsonSchemaObjectLike(
	value: unknown,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	options: Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId"> & { requireObjectRoot: boolean },
): void {
	const { requireObjectRoot, ...target } = options;
	if (!isJsonObject(value)) {
		diagnostics.push({
			code: "WorkflowSchemaError.invalidJsonSchema",
			message: `JSON schema at '${path}' must be an object.`,
			severity: "error",
			path,
			...target,
			hint: "Use the existing JSON Schema subset object; Zod schemas are not part of V2 authoring.",
		});
		return;
	}
	const type = value.type;
	if (type !== undefined && !isSupportedJsonSchemaTypeValue(type)) {
		diagnostics.push({
			code: "WorkflowSchemaError.unsupportedType",
			message: `JSON schema at '${path}' uses an unsupported type.`,
			severity: "error",
			path: `${path}.type`,
			...target,
			hint: "Use string, number, integer, boolean, object, array, or null.",
		});
	}
	if (requireObjectRoot && type !== undefined && type !== "object" && !(Array.isArray(type) && type.includes("object"))) {
		diagnostics.push({
			code: "WorkflowSchemaError.objectRootRequired",
			message: `JSON workflow ports require an object-root schema at '${path}'.`,
			severity: "error",
			path: `${path}.type`,
			...target,
			hint: "Use an object-root schema for workflow JSON ports.",
		});
	}
}

function isSupportedJsonSchemaTypeValue(value: PiboJsonValue): boolean {
	const supported = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
	return typeof value === "string"
		? supported.has(value)
		: Array.isArray(value) && value.every((entry) => typeof entry === "string" && supported.has(entry));
}

function validateRequiredString(
	object: PiboJsonObject,
	key: string,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
): void {
	if (typeof object[key] !== "string" || !(object[key] as string).trim()) {
		diagnostics.push({
			code: "WorkflowValidationError.missingString",
			message: `Workflow IR field '${path}' must be a non-empty string.`,
			severity: "error",
			path,
		});
	}
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

function workflowValidationBlockedResponse(message: string, response: WorkflowValidationResponse, extra: Record<string, unknown> = {}): Response {
	return responseJson({
		error: message,
		validation: response.validation,
		diagnostics: response.diagnostics,
		...extra,
	}, { status: 422 });
}

function agentsSelectingPiPackage(state: ChatWebAppState, packageId: string): CustomAgentDefinition[] {
	const pkg = findPiPackage(packageId);
	const aliases = new Set([packageId, ...(pkg ? [pkg.id, pkg.name] : [])]);
	return state.agentStore
		.list(undefined, { includeArchived: true })
		.filter((agent) => agent.piPackages.some((selected) => aliases.has(selected)));
}

function normalizeAgentDeleteConfirmation(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new PiboWebHttpError("Type the agent name to permanently delete it.", 400);
	}
	return value.trim();
}

function deleteSessionsForAgentProfile(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	profileName: string,
): string[] {
	const deleteSession = context.channelContext.deleteSession;
	if (!deleteSession) throw new PiboWebHttpError("Session deletion is not available", 501);
	const ownedSessions = listOwnedSessions(context, webSession);
	const sessionsById = new Map(ownedSessions.map((session) => [session.id, session]));
	const ids = new Set(ownedSessions.filter((session) => session.profile === profileName).map((session) => session.id));
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of ownedSessions) {
			if (session.parentId && ids.has(session.parentId) && !ids.has(session.id)) {
				ids.add(session.id);
				changed = true;
			}
		}
	}
	const orderedIds = [...ids].sort(
		(left, right) => sessionDepth(sessionsById.get(right), sessionsById) - sessionDepth(sessionsById.get(left), sessionsById),
	);
	state.sessionQuery.deleteSessions(orderedIds);
	state.eventCommands.deleteSessions(orderedIds);
	for (const id of orderedIds) deleteSession(id);
	return orderedIds;
}

function deleteSessionSubtree(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	rootSession: PiboSession,
): string[] {
	const deleteSession = context.channelContext.deleteSession;
	if (!deleteSession) throw new PiboWebHttpError("Session deletion is not available", 501);
	const ownedSessions = listOwnedSessions(context, webSession);
	const sessionsById = new Map(ownedSessions.map((session) => [session.id, session]));
	const ids = new Set([rootSession.id]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of ownedSessions) {
			if (session.parentId && ids.has(session.parentId) && !ids.has(session.id)) {
				ids.add(session.id);
				changed = true;
			}
		}
	}
	const orderedIds = [...ids].sort(
		(left, right) => sessionDepth(sessionsById.get(right), sessionsById) - sessionDepth(sessionsById.get(left), sessionsById),
	);
	state.sessionQuery.deleteSessions(orderedIds);
	state.eventCommands.deleteSessions(orderedIds);
	for (const id of orderedIds) deleteSession(id);
	return orderedIds;
}

function deleteRoomTree(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	room: PiboRoom,
	confirmName: string,
): { deletedRoomIds: string[]; deletedSessionIds: string[] } {
	if (isDefaultPiboRoom(room)) throw new PiboWebHttpError("Personal Chat cannot be deleted", 400);
	if (!isPiboRoomArchived(room)) throw new PiboWebHttpError("Archive the room before permanently deleting it.", 400);
	if (confirmName !== room.name) throw new PiboWebHttpError(`Type "${room.name}" to permanently delete this room.`, 400);
	const deleteSession = context.channelContext.deleteSession;
	if (!deleteSession) throw new PiboWebHttpError("Session deletion is not available", 501);
	const rooms = state.roomService.listRoomSubtree(room.id);
	const roomIds = rooms.map((item) => item.id);
	const roomIdSet = new Set(roomIds);
	const ownedSessions = listOwnedSessions(context, webSession);
	const sessionsById = new Map(ownedSessions.map((session) => [session.id, session]));
	const ids = new Set(
		ownedSessions
			.filter((session) => {
				const roomId = chatRoomIdFromMetadata(session.metadata);
				return roomId ? roomIdSet.has(roomId) : false;
			})
			.map((session) => session.id),
	);
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of ownedSessions) {
			if (session.parentId && ids.has(session.parentId) && !ids.has(session.id)) {
				ids.add(session.id);
				changed = true;
			}
		}
	}
	const orderedSessionIds = [...ids].sort(
		(left, right) => sessionDepth(sessionsById.get(right), sessionsById) - sessionDepth(sessionsById.get(left), sessionsById),
	);
	state.sessionQuery.deleteSessions(orderedSessionIds);
	state.eventCommands.deleteSessions(orderedSessionIds);
	state.eventCommands.deleteRooms(roomIds);
	for (const id of orderedSessionIds) deleteSession(id);
	const orderedRoomIds = [...roomIds].reverse();
	state.roomService.deleteRooms(orderedRoomIds);
	return { deletedRoomIds: orderedRoomIds, deletedSessionIds: orderedSessionIds };
}

function sessionDepth(session: PiboSession | undefined, sessionsById: ReadonlyMap<string, PiboSession>): number {
	let depth = 0;
	let current = session;
	while (current?.parentId) {
		depth += 1;
		current = sessionsById.get(current.parentId);
	}
	return depth;
}

function requireOwnedSession(context: PiboWebAppContext, webSession: PiboWebSession, piboSessionId: string): PiboSession {
	const session = context.channelContext.getSession(piboSessionId);
	if (!session || session.ownerScope !== webSession.ownerScope) {
		throw new PiboWebHttpError("Session is not available for this user", 404);
	}
	return canonicalizeSessionProfile(context, session);
}

function signalResource(pathname: string): { kind: "session" | "tree"; piboSessionId: string } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/signals/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const [kind, encodedId, extra] = pathname.slice(prefix.length).split("/");
	if (extra || (kind !== "session" && kind !== "tree") || !encodedId) return undefined;
	try {
		return { kind, piboSessionId: decodeURIComponent(encodedId) };
	} catch {
		throw new PiboWebHttpError("Invalid session id", 400);
	}
}

function resolveRequestedSession(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	defaultProfile: string,
	piboSessionId?: string,
	roomId?: string,
): PiboSession {
	if (!piboSessionId) return ensureDefaultChatSession(state, context, webSession, defaultProfile, roomId);
	const selected = context.channelContext.getSession(piboSessionId);
	if (!selected || selected.ownerScope !== webSession.ownerScope) {
		throw new PiboWebHttpError("Session is not available for this user", 404);
	}
	const canonicalSelected = canonicalizeSessionProfile(context, selected);
	const selectedRoom = ensureSessionRoom(state, context, canonicalSelected, webSession);
	if (roomId && selectedRoom.id !== roomId) throw new PiboWebHttpError("Session is not available in this room", 404);
	return canonicalSelected;
}

function resolveCreateSessionProfile(
	context: PiboWebAppContext,
	defaultProfile: string,
	requestedProfile: unknown,
): string {
	if (requestedProfile === undefined) return defaultProfile;
	if (typeof requestedProfile !== "string" || requestedProfile.trim().length === 0) {
		throw new PiboWebHttpError("Profile must be a non-empty string", 400);
	}

	const profileName = requestedProfile.trim();
	const profiles = context.channelContext.getProfiles?.() ?? [];
	if (!profiles.length) {
		if (profileName === defaultProfile) return defaultProfile;
		throw new PiboWebHttpError(`Unknown profile "${profileName}"`, 400);
	}

	const matched = profiles.find(
		(profile) => profile.name === profileName || profile.aliases.includes(profileName),
	);
	if (!matched) {
		throw new PiboWebHttpError(`Unknown profile "${profileName}"`, 400);
	}
	return matched.name;
}

function indexOwnedSessions(sessionQuery: ChatSessionQuery, sessions: PiboSession[]): void {
	sessionQuery.upsertSessionsIfChanged(sessions);
}

function markSessionsRead(state: ChatWebAppState, sessions: PiboSession[], principalId: string): void {
	for (const session of sessions) {
		const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: session.id });
		if (latestStreamId !== undefined) state.readState.markSessionRead(session.id, principalId, latestStreamId);
	}
}

function sessionSubtree(sessions: readonly PiboSession[], rootSessionId: string): PiboSession[] {
	const subtree = new Map<string, PiboSession>();
	const root = sessions.find((session) => session.id === rootSessionId);
	if (root) subtree.set(root.id, root);
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of sessions) {
			if (session.parentId && subtree.has(session.parentId) && !subtree.has(session.id)) {
				subtree.set(session.id, session);
				changed = true;
			}
		}
	}
	return [...subtree.values()];
}

function buildSessionUnreadCounts(
	state: ChatWebAppState,
	sessions: PiboSession[],
	principalId: string,
): Map<string, number> {
	const sessionsById = new Map(sessions.map((session) => [session.id, session]));
	const visibleSessionIds = sessions
		.filter((session) => !hasArchivedSessionInPath(session, sessionsById))
		.map((session) => session.id);
	return state.readState.countUnreadMessagesBySession({
		piboSessionIds: visibleSessionIds,
		principalId,
	});
}

function signalStatusFromSnapshot(snapshot: ReturnType<NonNullable<PiboWebAppContext["channelContext"]["snapshotSignalSession"]>> | undefined, piboSessionId: string): { status?: PiboWebSessionStatus; updatedAt?: string } | undefined {
	const session = snapshot?.sessions[piboSessionId];
	if (!session) return undefined;
	if (session.hasError || session.hasErrorDescendant || session.aggregateStatus === "error") return { status: "error", updatedAt: session.updatedAt };
	if (session.isTreeActive) return { status: "running", updatedAt: session.updatedAt };
	return { status: "idle", updatedAt: session.updatedAt };
}

function sessionIndexItemsWithSignalState(
	context: PiboWebAppContext,
	sessions: readonly PiboSession[],
	indexItems: readonly ChatWebSessionIndexItem[],
): ChatWebSessionIndexItem[] {
	const snapshotSignalSession = context.channelContext.snapshotSignalSession;
	if (!snapshotSignalSession) return [...indexItems];
	const bySessionId = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	for (const session of sessions) {
		const existing = bySessionId.get(session.id);
		const signal = signalStatusFromSnapshot(snapshotSignalSession(session.id), session.id);
		if (!signal?.status) continue;
		if (signal.status === "idle" && existing?.status !== "running") continue;
		bySessionId.set(session.id, {
			...(existing ?? {
				piboSessionId: session.id,
				piSessionId: session.piSessionId,
				parentId: session.parentId,
				profile: session.profile,
				channel: session.channel,
				kind: session.kind,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				lastActivityAt: session.updatedAt,
				status: "idle" as const,
			}),
			status: signal.status,
			lastActivityAt: signal.updatedAt ?? existing?.lastActivityAt ?? session.updatedAt,
		});
	}
	return [...bySessionId.values()];
}

function buildRoomUnreadCounts(
	sessions: readonly PiboSession[],
	sessionUnreadCounts: ReadonlyMap<string, number>,
	defaultRoomId: string,
): Map<string, number> {
	const counts = new Map<string, number>();
	const sessionsById = new Map(sessions.map((session) => [session.id, session]));
	for (const session of sessions) {
		if (hasArchivedSessionInPath(session, sessionsById)) continue;
		const unreadCount = sessionUnreadCounts.get(session.id) ?? 0;
		if (unreadCount <= 0) continue;
		let root = session;
		while (root.parentId && sessionsById.has(root.parentId)) {
			root = sessionsById.get(root.parentId)!;
		}
		const roomId = chatRoomIdFromMetadata(root.metadata) ?? chatRoomIdFromMetadata(session.metadata) ?? defaultRoomId;
		counts.set(roomId, (counts.get(roomId) ?? 0) + unreadCount);
	}
	return counts;
}

function roomsWithUnreadCounts(
	rooms: PiboRoomNode[],
	directCounts: ReadonlyMap<string, number>,
): PiboRoomNodeWithUnread[] {
	return rooms.map((room) => {
		const children = roomsWithUnreadCounts(room.children ?? [], directCounts);
		const childCount = children.reduce((sum, child) => sum + (child.unreadCount ?? 0), 0);
		const unreadCount = (directCounts.get(room.id) ?? 0) + childCount;
		return {
			...room,
			...(unreadCount > 0 ? { unreadCount } : {}),
			children,
		};
	});
}

function parseSseCursor(value: string | null): ChatEventCursor | undefined {
	if (!value) return undefined;
	const [stream, frame] = value.split(":");
	const streamId = Number(stream);
	const frameIndex = frame === undefined ? -1 : Number(frame);
	if (!Number.isInteger(streamId) || streamId < 0) return undefined;
	if (!Number.isInteger(frameIndex) || frameIndex < -1) return undefined;
	return { streamId, frameIndex };
}

function isPiboOutputEvent(value: unknown): value is PiboOutputEvent {
	return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string";
}

function liveEventMatches(event: ChatLiveEvent, input: { roomId?: string; piboSessionId?: string }): boolean {
	if (input.roomId && event.roomId !== input.roomId) return false;
	if (input.piboSessionId && event.piboSessionId !== input.piboSessionId) return false;
	return true;
}

function writeChatEventFrames(
	controller: ReadableStreamDefaultController<Uint8Array>,
	event: ChatLiveEvent,
	state: ReturnType<typeof createChatStreamState>,
	cursor?: ChatEventCursor,
): void {
	if (!isPiboOutputEvent(event.payload)) return;
	const piboSessionId = event.piboSessionId ?? event.payload.piboSessionId;
	const streamId = "streamId" in event ? event.streamId : undefined;
	const frames = chatStreamFramesFromOutputEvent(event.payload, state, {
		includeRawEvent: streamId !== undefined && isPersistableOutputEvent(event.payload),
	});
	for (let index = 0; index < frames.length; index += 1) {
		if (cursor && streamId !== undefined && streamId === cursor.streamId && index <= cursor.frameIndex) continue;
		writeSse(controller, "pibo", { ...frames[index], piboSessionId }, streamId === undefined ? undefined : `${streamId}:${index}`);
	}
}

function createEventStream(input: {
	roomId?: string;
	piboSessionId?: string;
	activePiboSessionId?: string;
	principalId: string;
	context: PiboWebAppContext;
	state: ChatWebAppState;
	cursor?: ChatEventCursor;
}): Response {
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	const streamId = randomUUID();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			if (input.activePiboSessionId) markEventStreamConnected(input.state, input.activePiboSessionId, streamId, input.principalId);
			const streamState = createChatStreamState();
			writeSse(controller, "pibo", {
				type: "ready",
				piboSessionId: input.piboSessionId ?? "",
			});
			for (const stored of input.state.timelineQuery.listEvents({
				roomId: input.roomId,
				piboSessionId: input.piboSessionId,
				afterStreamId: input.cursor ? Math.max(0, input.cursor.streamId - 1) : undefined,
				limit: 1000,
			})) {
				writeChatEventFrames(controller, stored, streamState, input.cursor);
			}
			if (input.piboSessionId) {
				for (const snapshot of input.state.outputCompactor.snapshotsForSession(input.piboSessionId)) {
					writeChatEventFrames(
						controller,
						{ piboSessionId: snapshot.piboSessionId, eventType: snapshot.type, payload: snapshot },
						streamState,
					);
				}
			}
			const listener = (event: ChatLiveEvent) => {
				if (!liveEventMatches(event, input)) return;
				writeChatEventFrames(controller, event, streamState);
			};
			input.state.liveListeners.add(listener);
			unsubscribe = () => {
				input.state.liveListeners.delete(listener);
			};
			heartbeat = setInterval(() => writeSseComment(controller, "heartbeat"), 25000);
		},
		cancel() {
			unsubscribe?.();
			unsubscribe = undefined;
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = undefined;
			if (input.activePiboSessionId) {
				markEventStreamDisconnected({
					state: input.state,
					piboSessionId: input.activePiboSessionId,
					streamId,
				});
			}
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		},
	});
}

async function buildProjectsBootstrap(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	defaultProfile: string;
	projectId?: string;
	piboSessionId?: string;
	includeArchived?: boolean;
}): Promise<ChatProjectsBootstrap> {
	const personalProject = input.state.projectService.ensurePersonalProject({ ownerScope: input.webSession.ownerScope });
	const selectedProject = input.projectId ? input.state.projectService.requireProject(input.projectId, { includeArchived: true }) : personalProject;
	let projectSessions = input.state.projectService.listProjectSessions(selectedProject.id, { includeArchived: input.includeArchived });
	if (selectedProject.id === personalProject.id && projectSessions.length === 0) {
		const session = createProjectChatSession({
			state: input.state,
			context: input.context,
			webSession: input.webSession,
			project: personalProject,
			profile: input.defaultProfile,
			workflowId: "simple-chat",
		});
		projectSessions = [input.state.projectService.getProjectSession(session.id)!];
	}
	const rootSessions = projectSessions
		.map((projectSession) => input.context.channelContext.getSession(projectSession.piboSessionId))
		.filter((session): session is PiboSession => Boolean(session));
	const sessions = collectProjectSessionTreeSessions(
		rootSessions,
		input.context.channelContext.findSessions({ ownerScope: input.webSession.ownerScope }),
	);
	const requestedSession = input.piboSessionId ? sessions.find((session) => session.id === input.piboSessionId) : undefined;
	const selectedSession = requestedSession ?? sessions.find((session) => session.id === selectedProject.currentMainSessionId) ?? sessions[0];
	indexOwnedSessions(input.state.sessionQuery, sessions);
	const nodes = await buildSessionNodes(sessions, input.state.sessionQuery.listSessions(), selectedProject.projectFolder, new Map(), { skipPiMetadataFallback: true });
	applyProjectSessionArchiveState(nodes, new Map(projectSessions.map((projectSession) => [projectSession.piboSessionId, Boolean(projectSession.archived)])));
	return {
		identity: input.webSession.authSession.identity,
		personalProject,
		project: selectedProject,
		projects: input.state.projectService.listProjects({ includeArchived: input.includeArchived }),
		projectSessions,
		...(selectedSession ? { session: selectedSession, selectedPiboSessionId: selectedSession.id } : {}),
		selectedProjectId: selectedProject.id,
		sessions: nodes,
		...(await loadBootstrapCatalog(input.state, input.context, input.webSession)),
	};
}

function collectProjectSessionTreeSessions(rootSessions: PiboSession[], candidateSessions: PiboSession[]): PiboSession[] {
	const sessionsById = new Map(rootSessions.map((session) => [session.id, session]));
	let changed = true;
	while (changed) {
		changed = false;
		for (const session of candidateSessions) {
			if (sessionsById.has(session.id)) continue;
			if (!session.parentId || !sessionsById.has(session.parentId)) continue;
			sessionsById.set(session.id, session);
			changed = true;
		}
	}
	return [...sessionsById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function applyProjectSessionArchiveState(nodes: PiboWebSessionNode[], archivedBySessionId: ReadonlyMap<string, boolean>): void {
	for (const node of nodes) {
		const archived = archivedBySessionId.get(node.piboSessionId);
		if (archived !== undefined) node.archived = archived;
		applyProjectSessionArchiveState(node.children, archivedBySessionId);
	}
}

async function sendProjectMessage(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	defaultProfile: string;
	body: ChatMessageBody;
}): Promise<Response> {
	const text = normalizeMessageText(input.body.text);
	const clientTxnId = normalizeClientTxnId(input.body.clientTxnId);
	if (typeof input.body.piboSessionId !== "string") throw new PiboWebHttpError("Project session is required", 400);
	const selectedSession = input.context.channelContext.getSession(input.body.piboSessionId);
	if (!selectedSession || selectedSession.ownerScope !== input.webSession.ownerScope) throw new PiboWebHttpError("Session not found", 404);
	const projectSession = input.state.projectService.getProjectSession(selectedSession.id);
	if (!projectSession) throw new PiboWebHttpError("Project session not found", 404);
	const actorId = principalIdFor(input.webSession);
	const duplicate = clientTxnId ? input.state.eventCommands.findByClientTxn(undefined, actorId, clientTxnId) : undefined;
	if (duplicate) return responseJson({ duplicate: true, event: duplicate });
	const accepted = input.state.eventCommands.appendEvent({
		piboSessionId: selectedSession.id,
		eventType: "user.message.accepted",
		actorType: "user",
		actorId,
		clientTxnId,
		retentionClass: "chat_message",
		payload: {
			type: "user.message.accepted",
			piboSessionId: selectedSession.id,
			projectId: projectSession.projectId,
			text,
			...(clientTxnId ? { clientTxnId } : {}),
		},
	});
	for (const listener of input.state.liveListeners) listener(accepted);
	const messageId = randomUUID();
	const output = await input.context.channelContext.emit({
		type: "message",
		piboSessionId: selectedSession.id,
		id: messageId,
		text,
		source: "user",
	});
	return responseJson({ accepted, output });
}

async function sendChatMessage(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	defaultProfile: string;
	body: ChatMessageBody;
	forcedRoomId?: string;
}): Promise<Response> {
	const text = normalizeMessageText(input.body.text);
	const clientTxnId = normalizeClientTxnId(input.body.clientTxnId);
	const requestedRoomId = input.forcedRoomId ?? (typeof input.body.roomId === "string" ? input.body.roomId : undefined);
	const selectedSession = resolveRequestedSession(
		input.state,
		input.context,
		input.webSession,
		input.defaultProfile,
		typeof input.body.piboSessionId === "string" ? input.body.piboSessionId : undefined,
		requestedRoomId,
	);
	const room = ensureSessionRoom(input.state, input.context, selectedSession, input.webSession);
	if (requestedRoomId && room.id !== requestedRoomId) {
		throw new PiboWebHttpError("Session is not available in this room", 404);
	}
	if (isPiboRoomArchived(room)) {
		throw new PiboWebHttpError("Archived rooms are read-only", 403);
	}
	input.state.sessionQuery.upsertSession(selectedSession);
	const actorId = principalIdFor(input.webSession);
	const duplicate = clientTxnId ? input.state.eventCommands.findByClientTxn(room.id, actorId, clientTxnId) : undefined;
	if (duplicate) return responseJson({ duplicate: true, event: duplicate });
	const accepted = input.state.eventCommands.appendEvent({
		roomId: room.id,
		piboSessionId: selectedSession.id,
		eventType: "user.message.accepted",
		actorType: "user",
		actorId,
		clientTxnId,
		retentionClass: "chat_message",
		payload: {
			type: "user.message.accepted",
			piboSessionId: selectedSession.id,
			roomId: room.id,
			text,
			...(clientTxnId ? { clientTxnId } : {}),
		},
	});
	try {
		input.state.ingestService?.ingestUserMessageAccepted({
			session: selectedSession,
			roomId: room.id,
			actorId,
			text,
			clientTxnId,
			legacyEvent: accepted,
		});
	} catch (error) {
		console.warn("V2 chat data shadow ingest failed", error);
	}
	for (const listener of input.state.liveListeners) listener(accepted);
	const messageId = randomUUID();
	let output: PiboOutputEvent;
	try {
		output = await input.context.channelContext.emit({
			type: "message",
			piboSessionId: selectedSession.id,
			id: messageId,
			text,
			source: "user",
		});
	} catch (error) {
		const failed = input.state.eventCommands.appendEvent({
			roomId: room.id,
			piboSessionId: selectedSession.id,
			eventType: "user.message.failed",
			actorType: "system",
			actorId,
			retentionClass: "audit_event",
			payload: {
				type: "user.message.failed",
				piboSessionId: selectedSession.id,
				roomId: room.id,
				...(clientTxnId ? { clientTxnId } : {}),
				message: error instanceof Error ? error.message : String(error),
			},
		});
		for (const listener of input.state.liveListeners) listener(failed);
		throw error;
	}
	return responseJson({ output, event: accepted });
}

function responseBuiltChatIndex(): Response | undefined {
	const indexPath = resolve(CHAT_UI_DIST_DIR, "index.html");
	if (!existsSync(indexPath)) return undefined;
	return responseHtml(readFileSync(indexPath, "utf8"));
}

function responseBuiltChatAsset(request: Request, pathname: string): Response | undefined {
	if (!pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/assets/`)) return undefined;
	return responseBuiltChatStaticFile(request, pathname, "public, max-age=31536000, immutable");
}

function responseBuiltChatPublicFile(request: Request, pathname: string): Response | undefined {
	const publicFilePaths = new Set([
		`${CHAT_WEB_MOUNT_PATH}/manifest.webmanifest`,
		`${CHAT_WEB_MOUNT_PATH}/sw.js`,
	]);
	if (!publicFilePaths.has(pathname)) return undefined;
	const cacheControl = pathname.endsWith("/sw.js") || pathname.endsWith("/manifest.webmanifest")
		? "no-cache"
		: "public, max-age=31536000, immutable";
	return responseBuiltChatStaticFile(request, pathname, cacheControl);
}

function responseBuiltChatStaticFile(request: Request, pathname: string, cacheControl: string): Response | undefined {
	const relativePath = pathname.slice(`${CHAT_WEB_MOUNT_PATH}/`.length);
	const filePath = resolve(CHAT_UI_DIST_DIR, relativePath);
	if (!filePath.startsWith(CHAT_UI_DIST_DIR) || !existsSync(filePath)) return undefined;
	const body = readFileSync(filePath);
	const headers: Record<string, string> = {
		"content-type": contentTypeFor(filePath),
		"cache-control": cacheControl,
	};
	const encoding = preferredAssetEncoding(request.headers.get("accept-encoding"), filePath);
	if (!encoding) return new Response(body, { headers });
	headers["content-encoding"] = encoding;
	headers["vary"] = "accept-encoding";
	return new Response(compressedAssetBody(filePath, body, encoding), { headers });
}

function isChatAppPath(pathname: string): boolean {
	if (pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/assets/`)) return false;
	if (pathname === `${CHAT_WEB_MOUNT_PATH}/manifest.webmanifest`) return false;
	if (pathname === `${CHAT_WEB_MOUNT_PATH}/sw.js`) return false;
	if (pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/icons/`)) return false;
	return pathname === CHAT_WEB_MOUNT_PATH || pathname.startsWith(`${CHAT_WEB_MOUNT_PATH}/`);
}

function contentTypeFor(path: string): string {
	switch (extname(path)) {
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".webmanifest":
			return "application/manifest+json; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

function preferredAssetEncoding(acceptEncoding: string | null, path: string): "br" | "gzip" | undefined {
	if (!isCompressibleAsset(path) || !acceptEncoding) return undefined;
	if (/\bbr\b/.test(acceptEncoding)) return "br";
	if (/\bgzip\b/.test(acceptEncoding)) return "gzip";
	return undefined;
}

function isCompressibleAsset(path: string): boolean {
	const extension = extname(path);
	return extension === ".js" || extension === ".css" || extension === ".html" || extension === ".json";
}

function compressedAssetBody(path: string, body: Uint8Array, encoding: "br" | "gzip"): Uint8Array {
	const cacheKey = `${encoding}:${path}`;
	const cached = compressedAssetCache.get(cacheKey);
	if (cached) return cached;
	const compressed = encoding === "br" ? brotliCompressSync(body) : gzipSync(body);
	compressedAssetCache.set(cacheKey, compressed);
	return compressed;
}

function createChatHtml(): string {
	return `<!doctype html>
<html lang="de">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#101d22">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-title" content="Pibo Chat">
	<link rel="manifest" href="/apps/chat/manifest.webmanifest">
	<link rel="apple-touch-icon" href="/apps/chat/assets/pwa-images/ios/180.png">
	<title>Pibo Web Chat</title>
	<style>
		:root { color-scheme: dark; font-family: "Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101d22; color: #d8e3e7; }
		* { box-sizing: border-box; }
		body { margin: 0; height: 100vh; overflow: hidden; background: #101d22; }
		button, textarea { font: inherit; }
		button { border: 1px solid #334155; background: #151f24; color: #d8e3e7; border-radius: 3px; padding: 7px 10px; cursor: pointer; }
		button:hover { border-color: #11a4d4; color: #ffffff; }
		button.primary { background: #11a4d4; border-color: #11a4d4; color: #ffffff; }
		button.ghost { background: transparent; }
		.app { display: grid; grid-template-rows: 56px 1fr; height: 100vh; }
		.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; background: #1a262b; border-bottom: 1px solid #1e293b; }
		.brand { font-size: 17px; font-weight: 800; letter-spacing: .08em; color: #e7f7fb; text-transform: uppercase; white-space: nowrap; }
		.tabs { display: flex; gap: 6px; }
		.tab { height: 32px; text-transform: uppercase; font-size: 12px; letter-spacing: .06em; }
		.tab.active { border-color: #11a4d4; color: #11a4d4; background: rgba(17,164,212,.08); }
		.userbar { display: flex; align-items: center; gap: 8px; min-width: 0; color: #94a3b8; font-size: 12px; }
		.workspace { display: grid; grid-template-columns: 300px minmax(0,1fr) 320px; min-height: 0; }
		.sidebar, .inspector { background: #1a262b; border-right: 1px solid #1e293b; min-height: 0; overflow: auto; }
		.inspector { border-right: 0; border-left: 1px solid #1e293b; background: #0e1116; }
		.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.panel-actions { display: flex; align-items: center; gap: 6px; }
		.icon-button { width: 28px; height: 28px; padding: 0; display: grid; place-items: center; line-height: 1; }
		.session-tree { padding: 8px; }
		.session-row { width: 100%; display: grid; grid-template-columns: 28px minmax(0,1fr); align-items: center; margin-bottom: 4px; border: 1px solid transparent; border-radius: 3px; background: transparent; padding: 0 8px 0 0; }
		.session-row.active { border-color: #11a4d4; background: rgba(17,164,212,.10); }
		.session-toggle, .session-select { border: 0; background: transparent; border-radius: 0; padding: 0; }
		.session-toggle { width: 28px; height: 32px; display: grid; place-items: center; color: #64748b; }
		.session-toggle:hover { color: #11a4d4; border-color: transparent; }
		.session-select { min-width: 0; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; align-items: center; text-align: left; padding: 7px 0; }
		.session-select:hover { border-color: transparent; }
		.session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: #e2e8f0; }
		.session-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #64748b; }
		.status-dot { width: 7px; height: 7px; border-radius: 999px; background: #64748b; }
		.status-dot.running { background: #0bda57; box-shadow: 0 0 10px rgba(11,218,87,.35); }
		.status-dot.error { background: #ef4444; }
		.main { min-height: 0; display: grid; grid-template-rows: auto 1fr auto; background: #101d22; }
		.session-head { min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #1e293b; background: #151f24; }
		.session-name { margin: 0; font-size: 16px; line-height: 1.2; }
		.session-meta { margin-top: 4px; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
		.trace-controls { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
		.content { min-height: 0; overflow: auto; padding: 14px; }
		.trace-list { min-width: 620px; display: flex; flex-direction: column; gap: 9px; }
		/* Ported from pydantic-tracing SpanNode/JsonRenderer visual structure. */
		.span-card { border: 1px solid #334155; border-radius: 3px; background: #1a262b; overflow: hidden; }
		.span-card.ok { border-color: rgba(11,218,87,.30); }
		.span-card.running { border-color: rgba(17,164,212,.50); box-shadow: 0 0 10px rgba(17,164,212,.10); }
		.span-card.error { border-color: rgba(255,107,0,.50); }
		.span-card[data-span-type="tool.call"] { border-color: rgba(168,85,247,.52); }
		.span-card[data-span-type="tool.result"] { border-color: rgba(34,197,94,.42); }
		.span-card[data-span-type="model.reasoning"] { border-color: rgba(245,158,11,.48); }
		.span-card[data-span-type="agent.delegation"] { border-color: rgba(249,115,22,.58); }
		.span-card[data-span-type="user.prompt"] { border-color: rgba(6,182,212,.48); }
		.span-header { width: 100%; display: grid; grid-template-columns: 18px 22px minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; background: #151f24; border: 0; text-align: left; }
		.span-card.ok > .span-header { background: rgba(11,218,87,.05); }
		.span-card.running > .span-header { background: rgba(17,164,212,.05); }
		.span-card.error > .span-header { background: rgba(255,107,0,.05); }
		.span-chevron { color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
		.span-icon { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: rgba(17,164,212,.20); color: #11a4d4; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
		.span-card[data-span-type="tool.call"] .span-icon { background: rgba(168,85,247,.20); color: #a855f7; }
		.span-card[data-span-type="tool.result"] .span-icon { background: rgba(34,197,94,.20); color: #22c55e; }
		.span-card[data-span-type="model.reasoning"] .span-icon { background: rgba(245,158,11,.20); color: #f59e0b; }
		.span-card[data-span-type="agent.delegation"] .span-icon { background: rgba(249,115,22,.20); color: #f97316; }
		.span-card[data-span-type="user.prompt"] .span-icon { background: rgba(6,182,212,.20); color: #06b6d4; }
		.span-type-label { color: #cbd5e1; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
		.span-title { color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.span-meta { display: flex; align-items: center; gap: 6px; }
		.span-body { display: none; border-top: 1px solid #1e293b; }
		.span-card.open > .span-body { display: block; }
		.span-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #1e293b; background: rgba(15,23,42,.18); }
		.span-quote { padding: 14px; color: #cbd5e1; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
		.span-code-well { padding: 12px 14px; background: #0e1116; border-bottom: 1px solid #1e293b; overflow: auto; }
		.span-function { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #22c55e; white-space: pre-wrap; }
		.syntax-keyword { color: #c084fc; }
		.syntax-name { color: #fde047; }
		.syntax-key { color: #60a5fa; }
		.syntax-string { color: #86efac; }
		.span-output-summary { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 14px; background: rgba(15,23,42,.28); border-bottom: 1px solid #1e293b; color: #94a3b8; font-size: 12px; }
		.span-output-summary code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
		.span-section { padding: 12px 14px; background: #0e1116; border-top: 1px solid rgba(51,65,85,.55); }
		.span-section-title { margin-bottom: 7px; color: #60a5fa; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
		.span-section-title.output { color: #22c55e; }
		.reasoning-block { padding: 14px; background: rgba(245,158,11,.06); color: #cbd5e1; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
		.reasoning-comment { color: rgba(245,158,11,.75); }
		.delegation-card { padding: 14px; background: rgba(249,115,22,.06); border-bottom: 1px solid rgba(249,115,22,.20); }
		.delegation-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; color: #f97316; font-size: 13px; font-weight: 700; }
		.delegation-query { color: #94a3b8; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.json-renderer { margin: 0; max-height: 24rem; overflow: auto; white-space: pre-wrap; color: #dbeafe; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.trace-node { border: 1px solid #334155; border-radius: 3px; background: #1a262b; overflow: hidden; }
		.trace-node[data-type="user.message"] { border-color: rgba(6,182,212,.42); }
		.trace-node[data-type="assistant.message"] { border-color: rgba(34,197,94,.35); }
		.trace-node[data-type="model.reasoning"] { border-color: rgba(245,158,11,.45); }
		.trace-node[data-type="tool.call"] { border-color: rgba(168,85,247,.45); }
		.trace-node[data-type="agent.delegation"] { border-color: rgba(249,115,22,.55); }
		.trace-node[data-type="agent.async"] { border-color: rgba(249,115,22,.55); }
		.trace-node[data-type="execution.command"] { border-color: rgba(17,164,212,.42); }
		.trace-node[data-type="error"] { border-color: rgba(239,68,68,.65); }
		.trace-header { width: 100%; display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px; padding: 9px 10px; background: #151f24; border: 0; text-align: left; }
		.trace-icon { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; background: rgba(17,164,212,.14); color: #11a4d4; font-size: 11px; }
		.trace-label { color: #cbd5e1; font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
		.trace-summary { margin-top: 3px; color: #94a3b8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.trace-actions { display: flex; align-items: center; gap: 6px; }
		.badge { border: 1px solid #334155; border-radius: 999px; padding: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: #94a3b8; }
		.badge.running { color: #0bda57; border-color: rgba(11,218,87,.35); }
		.badge.error { color: #ef4444; border-color: rgba(239,68,68,.45); }
		.trace-body { display: none; padding: 10px; border-top: 1px solid #1e293b; }
		.trace-node.open > .trace-body { display: block; }
		.payload { margin: 0; white-space: pre-wrap; overflow: auto; max-height: 360px; padding: 10px; border: 1px solid #1e293b; border-radius: 3px; background: #0e1116; color: #dbeafe; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.children { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding-left: 12px; border-left: 1px solid #334155; }
		.composer-wrap { position: relative; padding: 10px 12px; border-top: 1px solid #1e293b; background: #151f24; }
		.composer { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
		textarea { width: 100%; min-height: 48px; max-height: 150px; resize: vertical; border: 1px solid #334155; border-radius: 3px; padding: 10px; background: #0e1116; color: #e2e8f0; }
		.command-menu { position: absolute; left: 12px; bottom: 74px; width: min(520px, calc(100% - 24px)); max-height: 280px; overflow: auto; background: #0e1116; border: 1px solid #11a4d4; border-radius: 3px; box-shadow: 0 12px 30px rgba(0,0,0,.35); z-index: 20; }
		.command-item { display: grid; grid-template-columns: 120px 1fr; gap: 10px; width: 100%; padding: 9px 10px; border: 0; border-bottom: 1px solid #1e293b; text-align: left; background: transparent; }
		.command-item.active { background: rgba(17,164,212,.13); }
		.command-name { color: #11a4d4; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
		.command-desc { color: #94a3b8; font-size: 12px; }
		.inspector-log { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
		.raw-event { border-left: 2px solid #11a4d4; padding: 8px; background: #151f24; }
		.raw-event-type { color: #11a4d4; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; margin-bottom: 5px; }
		.placeholder { padding: 18px; color: #94a3b8; }
		.modal-backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.62); z-index: 50; }
		.modal { width: min(420px, calc(100vw - 32px)); border: 1px solid #334155; border-radius: 4px; background: #1a262b; padding: 16px; }
		.modal h2 { margin: 0 0 8px; font-size: 15px; }
		.modal p { margin: 0 0 14px; color: #94a3b8; font-size: 13px; }
		.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
		.hidden { display: none !important; }
		@media (max-width: 980px) {
			.workspace { grid-template-columns: 240px minmax(0,1fr); }
			.inspector { display: none; }
		}
		@media (max-width: 720px) {
			body { overflow: auto; }
			.app { height: auto; min-height: 100vh; }
			.topbar { flex-wrap: wrap; height: auto; min-height: 56px; padding: 10px; }
			.workspace { grid-template-columns: 1fr; }
			.sidebar { max-height: 260px; }
			.main { min-height: 70vh; }
			.trace-list { min-width: 0; }
			.composer { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<div class="app">
		<header class="topbar">
			<div class="brand">Pibo Chat</div>
			<nav class="tabs">
				<button class="tab active" data-area="sessions">Sessions</button>
				<button class="tab" data-area="agents">Agents</button>
				<button class="tab" data-area="settings">Settings</button>
			</nav>
			<div class="userbar" id="user"></div>
		</header>
		<div class="workspace">
			<aside class="sidebar">
				<div class="panel-head">
					<span id="sidebar-title">Sessions</span>
					<div class="panel-actions">
						<button class="ghost icon-button" id="new-session" title="New Session" aria-label="New Session">+</button>
						<button class="ghost" id="refresh">Refresh</button>
					</div>
				</div>
				<div class="session-tree" id="session-tree"></div>
			</aside>
			<main class="main">
				<div class="session-head">
					<div>
						<h1 class="session-name" id="session-title">Loading</h1>
						<div class="session-meta" id="session-meta"></div>
					</div>
					<div class="trace-controls">
						<button class="ghost" id="thinking-toggle">Thinking Off</button>
						<button class="ghost" id="collapse-all">Collapse All</button>
						<button class="ghost" id="expand-one">Depth 1</button>
						<button class="ghost" id="expand-all">Expand All</button>
					</div>
				</div>
				<section class="content" id="content"></section>
				<div class="composer-wrap" id="composer-wrap">
					<div class="command-menu hidden" id="command-menu"></div>
					<form class="composer" id="composer">
						<textarea id="message" name="message" placeholder="Send Message (/ for commands or $ for skills)"></textarea>
						<button class="primary" type="submit">Send</button>
					</form>
				</div>
			</main>
			<aside class="inspector">
				<div class="panel-head"><span>Raw Events</span><button class="ghost" id="clear-local">Clear UI</button></div>
				<div class="inspector-log" id="raw-log"></div>
			</aside>
		</div>
	</div>
	<div class="modal-backdrop hidden" id="fork-modal">
		<div class="modal">
			<h2>Zur geforkten Session wechseln?</h2>
			<p>Der Fork wurde erstellt. Wenn du wechselst, wird die neue Session geladen.</p>
			<div class="modal-actions">
				<button id="fork-stay">Nein</button>
				<button class="primary" id="fork-switch">Ja</button>
			</div>
		</div>
	</div>
	<script>
		const userEl = document.querySelector("#user");
		const sessionTreeEl = document.querySelector("#session-tree");
		const sessionTitleEl = document.querySelector("#session-title");
		const sessionMetaEl = document.querySelector("#session-meta");
		const contentEl = document.querySelector("#content");
		const rawLogEl = document.querySelector("#raw-log");
		const composer = document.querySelector("#composer");
		const messageInput = document.querySelector("#message");
		const commandMenu = document.querySelector("#command-menu");
		const forkModal = document.querySelector("#fork-modal");
		const newSessionButton = document.querySelector("#new-session");
		let eventSource;
		let bootstrap;
		let selectedPiboSessionId;
		let area = "sessions";
		let pendingForkResult;
		let pendingForkComposerText;
		let showThinking = localStorage.getItem("pibo.chat.showThinking") === "true";
		let selectedAgentProfile = localStorage.getItem("pibo.chat.newSessionProfile") || "";
		let openNodes = new Set(JSON.parse(localStorage.getItem("pibo.chat.openNodes") || "[]"));
		let openSessionNodes = new Set();
		let commandIndex = 0;

		function saveOpenNodes() {
			localStorage.setItem("pibo.chat.openNodes", JSON.stringify(Array.from(openNodes)));
		}
		function escapeText(value) {
			return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
			});
		}
		function pretty(value) {
			if (value == null || value === "") return "";
			if (typeof value === "string") return value;
			try { return JSON.stringify(value, null, 2); } catch { return String(value); }
		}
		function short(value, n) {
			const text = String(value || "").replace(/\\s+/g, " ").trim();
			return text.length > n ? text.slice(0, n - 1) + "…" : text;
		}
		function nodeLabel(type) {
			return {
				"user.message": "User Message",
				"assistant.message": "Agent Message",
				"agent.turn": "Agent Turn",
				"model.reasoning": "Reasoning",
				"tool.call": "Tool Call",
				"tool.result": "Tool Result",
				"agent.delegation": "Agent Delegation",
				"agent.async": "Async Agent",
				"execution.command": "Execution Command",
				"yielded.run": "Yielded Run",
				"error": "Error"
			}[type] || type;
		}
		function nodeIcon(type) {
			return {
				"user.message": "U",
				"assistant.message": "A",
				"agent.turn": "R",
				"model.reasoning": "?",
				"tool.call": "T",
				"tool.result": "O",
				"agent.delegation": "D",
				"agent.async": "A",
				"execution.command": "$",
				"yielded.run": "Y",
				"error": "!"
			}[type] || "*";
		}
		function spanType(type) {
			return {
				"user.message": "user.prompt",
				"assistant.message": "model.response",
				"agent.turn": "agent.run",
				"model.reasoning": "model.reasoning",
				"tool.call": "tool.call",
				"tool.result": "tool.result",
				"agent.delegation": "agent.delegation",
				"agent.async": "agent.async",
				"execution.command": "tool.result",
				"yielded.run": "tool.call",
				"error": "tool.result"
			}[type] || "agent.run";
		}
		function spanLabel(type) {
			const mapped = spanType(type);
			return {
				"agent.run": "Agent Run",
				"tool.call": "Tool Call",
				"tool.result": "Tool Result",
				"model.response": "Model Response",
				"model.reasoning": "Reasoning",
				"agent.delegation": "Agent Delegation",
				"agent.async": "Async Agent",
				"user.prompt": "User Prompt"
			}[mapped] || mapped;
		}
		function spanStatusClass(status) {
			if (status === "error") return "error";
			if (status === "running") return "running";
			return "ok";
		}
		function renderJson(value) {
			return '<pre class="json-renderer">' + escapeText(pretty(value)) + '</pre>';
		}
		function functionSignature(name, args) {
			const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
			const params = Object.entries(input).map(function(entry) {
				const key = entry[0];
				const value = entry[1];
				const raw = typeof value === "string" ? "'" + short(value, 50) + "'" : short(pretty(value), 50);
				return '<span class="syntax-key">' + escapeText(key) + '</span>=<span class="syntax-string">' + escapeText(raw) + '</span>';
			}).join(", ");
			return '<code class="span-function"><span class="syntax-keyword">def</span> <span class="syntax-name">' + escapeText(name || "tool") + '</span>(' + params + ')</code>';
		}
		function renderSpanContent(node) {
			const actionHtml = [];
			if (node.type === "user.message" && node.entryId) actionHtml.push('<button class="ghost fork-button" data-entry-id="' + escapeText(node.entryId) + '">Fork From Here</button>');
			if (node.linkedPiboSessionId) actionHtml.push('<button class="ghost session-link" data-pibo-session-id="' + escapeText(node.linkedPiboSessionId) + '">Open Child Session</button>');
			const actions = actionHtml.length ? '<div class="span-actions">' + actionHtml.join("") + '</div>' : "";

			if (node.type === "user.message") {
				return actions + '<div class="span-quote">' + escapeText(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "assistant.message") {
				return actions + '<div class="span-section"><div class="span-section-title output">Structured Output</div>' + renderJson(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "model.reasoning") {
				return actions + '<div class="reasoning-block"><span class="reasoning-comment">// Model reasoning</span>\\n' + escapeText(node.output || node.summary || "") + '</div>';
			}
			if (node.type === "tool.call" || node.type === "yielded.run") {
				return actions +
					'<div class="span-code-well">' + functionSignature(node.title, node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-output-summary"><span>Output:</span><code>' + escapeText(short(pretty(node.output), 120)) + '</code></div>' : "") +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "tool.result" || node.type === "execution.command") {
				return actions + '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output || node.input || "") + '</div>';
			}
			if (node.type === "agent.delegation") {
				return actions +
					'<div class="delegation-card"><div class="delegation-title">Agent Delegation · ' + escapeText(node.title || "subagent") + '</div><div class="delegation-query">' + escapeText(short(node.summary || pretty(node.input), 220)) + '</div></div>' +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Output</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "agent.async") {
				const input = node.input && typeof node.input === "object" ? node.input : {};
				const startedBy = input.startedBy || "pibo_run_start";
				const runId = input.runId || node.runId || "";
				return actions +
					'<div class="delegation-card"><div class="delegation-title">Async Agent · ' + escapeText(node.title || "subagent") + '</div><div class="delegation-query">Started by ' + escapeText(startedBy) + (runId ? ' · ' + escapeText(runId) : "") + '</div></div>' +
					'<div class="span-section"><div class="span-section-title">Input</div>' + renderJson(node.input || {}) + '</div>' +
					(node.output !== undefined ? '<div class="span-section"><div class="span-section-title output">Run</div>' + renderJson(node.output) + '</div>' : "");
			}
			if (node.type === "error") {
				return actions + '<div class="span-section"><div class="span-section-title">Error</div>' + renderJson(node.error || node.output || "") + '</div>';
			}
			return actions + '<div class="span-section">' + renderJson(node.output || node.input || node.summary || "") + '</div>';
		}

		async function signIn() {
			const response = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ provider: "google", callbackURL: "/apps/chat", disableRedirect: true }),
			});
			const data = await response.json();
			if (!response.ok || !data.url) {
				renderSignedOut(data.message || data.error || "Could not start Google sign in.");
				return;
			}
			location.href = data.url;
		}

			async function clearAuthSession() {
				await fetch("/api/auth/sign-out", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: "{}",
				});
			}

			async function signOut() {
				await clearAuthSession();
				location.reload();
			}

			function renderSignedOut(message) {
				userEl.replaceChildren();
				sessionTreeEl.innerHTML = "";
				contentEl.innerHTML = '<div class="placeholder">' + escapeText(message || "Sign in to start a Pibo session.") + '</div>';
				composer.closest(".composer-wrap").classList.add("hidden");
				const button = document.createElement("button");
				button.className = "primary";
				button.textContent = "Sign in with Google";
				button.addEventListener("click", signIn);
				userEl.append(button);
				sessionTitleEl.textContent = "Signed Out";
				sessionMetaEl.textContent = "";
			}

			function renderSignedIn(data) {
				userEl.replaceChildren();
				const label = document.createElement("span");
				label.textContent = data.identity.email || data.identity.name || data.identity.userId;
				userEl.append(label);
				const button = document.createElement("button");
				button.textContent = "Sign out";
				button.addEventListener("click", signOut);
				userEl.append(button);
				composer.closest(".composer-wrap").classList.remove("hidden");
			}

		function connectEvents() {
			if (eventSource) eventSource.close();
			if (!selectedPiboSessionId) return;
			eventSource = new EventSource("/api/chat/events?piboSessionId=" + encodeURIComponent(selectedPiboSessionId));
			eventSource.addEventListener("pibo", (event) => {
				const payload = JSON.parse(event.data);
				appendRawEvent({ type: payload.type, payload });
				if (payload.type !== "TEXT_MESSAGE_CONTENT" && payload.type !== "REASONING_MESSAGE_CONTENT") {
					void refreshTrace();
				}
			});
			eventSource.onerror = () => appendRawEvent({ type: "stream_error", payload: "Event stream disconnected." });
		}

			async function loadSession() {
				const response = await fetch("/api/chat/bootstrap");
				if (response.status === 401) {
					renderSignedOut();
					return;
				}
				const data = await response.json();
				if (response.status === 403) {
					await clearAuthSession().catch(() => {});
					renderSignedOut("Not authorized. Sign in with an allowed Google account.");
					return;
				}
				if (!response.ok) {
					renderSignedOut(data.error || "Could not load session.");
					return;
				}
				bootstrap = data;
				selectedPiboSessionId = selectedPiboSessionId || data.selectedPiboSessionId;
				ensureSelectedAgentProfile();
				renderSignedIn(data);
				renderArea();
				connectEvents();
		}

		function ensureSelectedAgentProfile() {
			const agents = (bootstrap && bootstrap.agents) || [];
			if (!agents.length) return "";
			const exists = agents.some(function(agent) {
				return agent.name === selectedAgentProfile || (agent.aliases || []).includes(selectedAgentProfile);
			});
			if (!selectedAgentProfile || !exists) {
				selectedAgentProfile = bootstrap.session && bootstrap.session.profile || agents[0].name;
			}
			localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
			return selectedAgentProfile;
		}

		function renderArea() {
			document.querySelectorAll(".tab").forEach(function(tab) {
				tab.classList.toggle("active", tab.dataset.area === area);
			});
			document.querySelector("#sidebar-title").textContent = area[0].toUpperCase() + area.slice(1);
			newSessionButton.classList.toggle("hidden", area !== "sessions");
			if (area === "sessions") {
				renderSessions();
				void refreshTrace();
				return;
			}
			if (area === "agents") {
				renderAgents();
				return;
			}
			renderSettings();
		}
		function renderSessions() {
			sessionTreeEl.innerHTML = "";
			(bootstrap.sessions || []).forEach(function(node) { sessionTreeEl.append(renderSessionNode(node, 0)); });
		}
		function renderSessionNode(node, depth) {
			const children = node.children || [];
			const hasChildren = children.length > 0;
			if (sessionTreeHasSession(children, selectedPiboSessionId)) {
				openSessionNodes.add(node.piboSessionId);
			}
			const expanded = openSessionNodes.has(node.piboSessionId);
			const wrap = document.createElement("div");
			const row = document.createElement("div");
			row.className = "session-row" + (node.piboSessionId === selectedPiboSessionId ? " active" : "");
			row.style.paddingLeft = 8 + depth * 14 + "px";
			row.title = node.piboSessionId;
			if (hasChildren) {
				const toggle = document.createElement("button");
				toggle.type = "button";
				toggle.className = "session-toggle";
				toggle.textContent = expanded ? "v" : ">";
				toggle.setAttribute("aria-expanded", String(expanded));
				toggle.setAttribute("aria-label", expanded ? "Collapse Subsessions" : "Expand Subsessions");
				toggle.title = expanded ? "Collapse Subsessions" : "Expand Subsessions";
				toggle.addEventListener("click", function() {
					if (openSessionNodes.has(node.piboSessionId)) openSessionNodes.delete(node.piboSessionId);
					else openSessionNodes.add(node.piboSessionId);
					renderSessions();
				});
				row.append(toggle);
			} else {
				row.append(document.createElement("span"));
			}
			const select = document.createElement("button");
			select.type = "button";
			select.className = "session-select";
			select.innerHTML =
				'<span><span class="session-title">' + escapeText(node.title) + '</span><span class="session-id">' + escapeText(node.piboSessionId) + '</span></span>' +
				'<span class="status-dot ' + escapeText(node.status) + '"></span>';
			select.addEventListener("click", function() { selectSession(node.piboSessionId); });
			row.append(select);
			wrap.append(row);
			if (expanded) children.forEach(function(child) { wrap.append(renderSessionNode(child, depth + 1)); });
			return wrap;
		}
		function sessionTreeHasSession(nodes, piboSessionId) {
			return (nodes || []).some(function(node) {
				return node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId);
			});
		}
		async function selectSession(piboSessionId) {
			selectedPiboSessionId = piboSessionId;
			connectEvents();
			await refreshBootstrap(false);
			renderArea();
		}
		async function createSession(profile) {
			const selectedProfile = profile || ensureSelectedAgentProfile();
			const created = await postJson("/api/chat/sessions", selectedProfile ? { profile: selectedProfile } : {});
			selectedPiboSessionId = created.session && created.session.id;
			connectEvents();
			await refreshBootstrap(false);
			renderArea();
		}
		async function refreshBootstrap(keepTrace) {
			const response = await fetch("/api/chat/bootstrap?piboSessionId=" + encodeURIComponent(selectedPiboSessionId || ""));
			if (!response.ok) return;
			bootstrap = await response.json();
			selectedPiboSessionId = bootstrap.selectedPiboSessionId;
			if (!keepTrace) renderSessions();
		}
		async function refreshTrace() {
			if (!selectedPiboSessionId) return;
			const response = await fetch("/api/chat/trace?piboSessionId=" + encodeURIComponent(selectedPiboSessionId) + "&includeRawEvents=true&rawEventsLimit=80");
			if (!response.ok) return;
			const trace = await response.json();
			sessionTitleEl.textContent = trace.title || selectedPiboSessionId;
			sessionMetaEl.textContent = trace.piboSessionId + " · " + trace.piSessionId;
			renderTrace(trace.nodes || []);
			renderRawEvents(trace.rawEvents || []);
		}
		function renderTrace(nodes) {
			const visible = nodes.filter(function(node) { return showThinking || node.type !== "model.reasoning"; });
			if (!visible.length) {
				contentEl.innerHTML = '<div class="placeholder">No trace events yet.</div>';
				return;
			}
			const list = document.createElement("div");
			list.className = "trace-list";
			visible.forEach(function(node) { list.append(renderTraceNode(node, 0)); });
			contentEl.replaceChildren(list);
		}
		function renderTraceNode(node, depth) {
			const wrapper = document.createElement("article");
			const mappedSpanType = spanType(node.type);
			wrapper.className = "span-card " + spanStatusClass(node.status) + (openNodes.has(node.id) ? " open" : "");
			wrapper.dataset.spanType = mappedSpanType;
			wrapper.dataset.nodeId = node.id;
			wrapper.style.marginLeft = Math.min(depth * 12, 96) + "px";
			const header = document.createElement("button");
			header.className = "span-header";
			const statusClass = node.status === "running" ? "running" : node.status === "error" ? "error" : "";
			header.innerHTML =
				'<span class="span-chevron">' + (openNodes.has(node.id) ? "v" : ">") + '</span>' +
				'<span class="span-icon">' + escapeText(nodeIcon(node.type)) + '</span>' +
				'<span><span class="span-type-label">' + escapeText(spanLabel(node.type)) + '</span><span class="span-title">' + escapeText(node.title || "") + (node.summary ? " · " + escapeText(short(node.summary, 160)) : "") + '</span></span>' +
				'<span class="span-meta"><span class="badge ' + statusClass + '">' + escapeText(node.status) + '</span></span>';
			header.addEventListener("click", function() {
				if (openNodes.has(node.id)) openNodes.delete(node.id); else openNodes.add(node.id);
				saveOpenNodes();
				wrapper.classList.toggle("open");
				header.querySelector(".span-chevron").textContent = wrapper.classList.contains("open") ? "v" : ">";
			});
			wrapper.append(header);
			const body = document.createElement("div");
			body.className = "span-body";
			body.innerHTML = renderSpanContent(node);
			body.querySelectorAll(".fork-button").forEach(function(button) {
				button.addEventListener("click", function(event) {
					event.stopPropagation();
					void forkFrom(button.dataset.entryId);
				});
			});
			body.querySelectorAll(".session-link").forEach(function(button) {
				button.addEventListener("click", function(event) {
					event.stopPropagation();
					void selectSession(button.dataset.piboSessionId);
				});
			});
			if (node.children && node.children.length) {
				const childWrap = document.createElement("div");
				childWrap.className = "children span-children";
				node.children.filter(function(child) { return showThinking || child.type !== "model.reasoning"; }).forEach(function(child) {
					childWrap.append(renderTraceNode(child, depth + 1));
				});
				body.append(childWrap);
			}
			wrapper.append(body);
			return wrapper;
		}
		function appendRawEvent(event) {
			const item = document.createElement("div");
			item.className = "raw-event";
			item.innerHTML = '<div class="raw-event-type">' + escapeText(event.type) + '</div><pre class="payload">' + escapeText(pretty(event.payload)) + '</pre>';
			rawLogEl.prepend(item);
		}
		function renderRawEvents(events) {
			rawLogEl.innerHTML = "";
			events.slice(-80).reverse().forEach(appendRawEvent);
		}
		function renderAgents() {
			sessionTitleEl.textContent = "Agents";
			sessionMetaEl.textContent = "Profile selection";
			const agents = (bootstrap && bootstrap.agents) || [];
			ensureSelectedAgentProfile();
			sessionTreeEl.innerHTML = agents.map(function(agent) {
				const active = agent.name === selectedAgentProfile ? " active" : "";
				return '<button class="session-row' + active + '" data-profile="' + escapeText(agent.name) + '"><span></span><span><span class="session-title">' + escapeText(agent.name) + '</span><span class="session-id">' + escapeText((agent.aliases || []).join(", ") || "profile") + '</span></span><span class="status-dot"></span></button>';
			}).join("");
			sessionTreeEl.querySelectorAll("[data-profile]").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					renderAgents();
				});
			});
			contentEl.innerHTML = '<div class="trace-list">' + agents.map(function(agent) {
				const selected = agent.name === selectedAgentProfile ? "selected" : "available";
				return '<article class="trace-node open" data-type="agent.turn"><div class="trace-header"><span class="trace-icon">A</span><span><span class="trace-label">' + escapeText(agent.name) + '</span><span class="trace-summary">' + escapeText(agent.description || "No description") + '</span></span><span class="trace-actions"><button class="ghost profile-select" data-profile="' + escapeText(agent.name) + '">' + selected + '</button><button class="ghost profile-create" data-profile="' + escapeText(agent.name) + '">New Session</button></span></div><div class="trace-body"><pre class="payload">' + escapeText(pretty(agent)) + '</pre></div></article>';
			}).join("") + '</div>';
			contentEl.querySelectorAll(".profile-select").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					renderAgents();
				});
			});
			contentEl.querySelectorAll(".profile-create").forEach(function(button) {
				button.addEventListener("click", function() {
					selectedAgentProfile = button.dataset.profile;
					localStorage.setItem("pibo.chat.newSessionProfile", selectedAgentProfile);
					void createSession(selectedAgentProfile);
				});
			});
		}
		function renderSettings() {
			sessionTitleEl.textContent = "Settings";
			sessionMetaEl.textContent = "Browser-local V1 settings";
			sessionTreeEl.innerHTML = '<div class="placeholder">Settings navigation placeholder.</div>';
			contentEl.innerHTML = '<div class="placeholder">Thinking display and trace expansion state are stored in this browser.</div>';
		}
		function availableCommands() {
			const actions = (bootstrap && bootstrap.capabilities && bootstrap.capabilities.actions) || [];
			const commands = [];
			actions.forEach(function(action) {
				(action.slashCommands || []).forEach(function(command) {
					if (command !== "tree") commands.push({ slash: "/" + command, action: action.name, description: action.description || action.name });
				});
			});
			commands.push({ slash: "/thinking-show", action: "thinking-show", description: "Toggle historical thinking display in this browser." });
			return commands;
		}
		function renderCommandMenu() {
			const query = messageInput.value.trim();
			if (!query.startsWith("/")) { commandMenu.classList.add("hidden"); return; }
			const commands = availableCommands().filter(function(command) { return command.slash.startsWith(query.split(/\\s+/)[0]); });
			if (!commands.length) { commandMenu.classList.add("hidden"); return; }
			commandIndex = Math.min(commandIndex, commands.length - 1);
			commandMenu.innerHTML = "";
			commands.forEach(function(command, index) {
				const item = document.createElement("button");
				item.type = "button";
				item.className = "command-item" + (index === commandIndex ? " active" : "");
				item.innerHTML = '<span class="command-name">' + escapeText(command.slash) + '</span><span class="command-desc">' + escapeText(command.description) + '</span>';
				item.addEventListener("click", function() { void runCommand(command); });
				commandMenu.append(item);
			});
			commandMenu.classList.remove("hidden");
		}
		async function runCommand(command) {
			commandMenu.classList.add("hidden");
			const text = messageInput.value.trim();
			messageInput.value = "";
			if (command.action === "thinking-show") {
				showThinking = !showThinking;
				localStorage.setItem("pibo.chat.showThinking", String(showThinking));
				updateThinkingButton();
				await refreshTrace();
				return;
			}
			const levelMatch = text.match(/^\\/thinking\\s+(\\S+)/);
			const params = levelMatch ? { level: levelMatch[1] } : undefined;
			const result = await postJson("/api/chat/action", { piboSessionId: selectedPiboSessionId, action: command.action, params: params });
			appendRawEvent({ type: "command_result", payload: result });
			if (command.action === "session.clone" && result && result.result && result.result.piboSessionId) {
				await selectSession(result.result.piboSessionId);
			}
		}
		async function forkFrom(entryId) {
			const result = await postJson("/api/chat/action", { piboSessionId: selectedPiboSessionId, action: "session.fork", params: { entryId: entryId } });
			appendRawEvent({ type: "fork_result", payload: result });
			pendingForkResult = result && result.result ? result.result : undefined;
			const selectedText = pendingForkResult && typeof pendingForkResult.selectedText === "string" ? pendingForkResult.selectedText : undefined;
			if (pendingForkResult && pendingForkResult.piboSessionId) {
				await selectSession(pendingForkResult.piboSessionId);
			} else {
				await refreshBootstrap(false);
				await refreshTrace();
			}
			if (selectedText !== undefined) {
				messageInput.value = selectedText;
				messageInput.focus();
			}
		}
		async function postJson(url, payload) {
			const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
			const data = await response.json().catch(function() { return { error: "Request failed" }; });
			if (!response.ok) throw new Error(data.error || "Request failed");
			return data;
		}

		newSessionButton.addEventListener("click", function() { void createSession(); });
		composer.addEventListener("submit", async (event) => {
			event.preventDefault();
			const text = messageInput.value.trim();
			if (!text) return;
			const command = availableCommands().find(function(candidate) { return text.split(/\\s+/)[0] === candidate.slash; });
			if (text.startsWith("/") && command) {
				await runCommand(command);
				return;
			}
			messageInput.value = "";
			await postJson("/api/chat/message", { piboSessionId: selectedPiboSessionId, text: text });
			await refreshTrace();
		});
		messageInput.addEventListener("input", renderCommandMenu);
		messageInput.addEventListener("keydown", function(event) {
			if (commandMenu.classList.contains("hidden")) {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					composer.requestSubmit();
				}
				return;
			}
			const count = commandMenu.querySelectorAll(".command-item").length;
			if (event.key === "ArrowDown") { event.preventDefault(); commandIndex = (commandIndex + 1) % count; renderCommandMenu(); }
			if (event.key === "ArrowUp") { event.preventDefault(); commandIndex = (commandIndex - 1 + count) % count; renderCommandMenu(); }
			if (event.key === "Enter" && !event.shiftKey) {
				const item = commandMenu.querySelectorAll(".command-item")[commandIndex];
				if (item) { event.preventDefault(); item.click(); }
			}
		});
		document.querySelectorAll(".tab").forEach(function(tab) {
			tab.addEventListener("click", function() { area = tab.dataset.area; renderArea(); });
		});
		document.querySelector("#refresh").addEventListener("click", function() { void refreshBootstrap(false).then(renderArea); });
		document.querySelector("#clear-local").addEventListener("click", function() { rawLogEl.innerHTML = ""; });
		document.querySelector("#collapse-all").addEventListener("click", function() { openNodes.clear(); saveOpenNodes(); void refreshTrace(); });
		document.querySelector("#expand-all").addEventListener("click", function() {
			contentEl.querySelectorAll(".span-card").forEach(function(node) {
				if (node.dataset.nodeId) openNodes.add(node.dataset.nodeId);
				node.classList.add("open");
				const chevron = node.querySelector(".span-chevron");
				if (chevron) chevron.textContent = "v";
			});
			saveOpenNodes();
		});
		document.querySelector("#expand-one").addEventListener("click", function() {
			openNodes.clear();
			contentEl.querySelectorAll(".trace-list > .span-card").forEach(function(node) {
				if (node.dataset.nodeId) openNodes.add(node.dataset.nodeId);
				node.classList.add("open");
				const chevron = node.querySelector(".span-chevron");
				if (chevron) chevron.textContent = "v";
			});
			saveOpenNodes();
		});
		function updateThinkingButton() {
			document.querySelector("#thinking-toggle").textContent = showThinking ? "Thinking On" : "Thinking Off";
		}
		document.querySelector("#thinking-toggle").addEventListener("click", async function() {
			showThinking = !showThinking;
			localStorage.setItem("pibo.chat.showThinking", String(showThinking));
			updateThinkingButton();
			await refreshTrace();
		});
		document.querySelector("#fork-stay").addEventListener("click", function() {
			forkModal.classList.add("hidden");
			const previousFile = pendingForkResult && pendingForkResult.previous && pendingForkResult.previous.sessionFile;
			const targetPiboSessionId = pendingForkResult && pendingForkResult.piboSessionId ? pendingForkResult.piboSessionId : selectedPiboSessionId;
			pendingForkResult = undefined;
			messageInput.value = pendingForkComposerText || "";
			pendingForkComposerText = undefined;
			if (previousFile) {
				void postJson("/api/chat/action", { piboSessionId: targetPiboSessionId, action: "session.switch", params: { sessionFile: previousFile } })
					.then(function(result) { appendRawEvent({ type: "fork_restore", payload: result }); return refreshTrace(); })
					.catch(function(error) { appendRawEvent({ type: "fork_restore_error", payload: String(error) }); });
			}
		});
		document.querySelector("#fork-switch").addEventListener("click", async function() {
			forkModal.classList.add("hidden");
			const targetPiboSessionId = pendingForkResult && pendingForkResult.piboSessionId ? pendingForkResult.piboSessionId : selectedPiboSessionId;
			pendingForkResult = undefined;
			pendingForkComposerText = undefined;
			if (targetPiboSessionId) await selectSession(targetPiboSessionId);
		});

		updateThinkingButton();
		loadSession();
	</script>
</body>
</html>`;
}

export function createChatWebApp(options: ChatWebAppOptions = {}): PiboWebApp {
	const defaultProfile = options.defaultProfile ?? "codex-compat-openai-web";
	const dataStore = createDataStore(options);
	const state: ChatWebAppState = {
		sessionQuery: new ChatSessionQueryService(dataStore),
		timelineQuery: new ChatTimelineQueryService(dataStore),
		eventCommands: new ChatEventCommandService(dataStore),
		readState: new ChatReadStateService(dataStore),
		roomService: new ChatRoomService(dataStore),
		projectService: new ChatProjectService(options.projectStorePath),
		agentStore: createAgentStore(options.agentStorePath),
		reliabilityStore: createReliabilityStore(options.reliabilityStorePath),
		cronStore: createDefaultPiboCronStore({ path: options.cronStorePath }),
		ralphStore: createDefaultPiboRalphStore({ path: options.ralphStorePath }),
		dataStore,
		ingestService: new ChatDataIngestService(dataStore),
		traceCache: new Map(),
		outputCompactor: new OutputCompactor(),
		liveListeners: new Set(),
		activeEventStreams: new Map(),
		activeTraceSessions: new Set(),
		persistenceMetrics: createPersistenceMetrics(),
		userSkillManager: new UserSkillManager(os.homedir()),
		workflowDraftStore: new ChatWorkflowDraftStore(dataStore),
		workflowPublishedVersionStore: new ChatWorkflowPublishedVersionStore(dataStore),
	};

	const requireSession = (request: Request, context: PiboWebAppContext): Promise<PiboWebSession> =>
		context.requireSession({
			request,
		});

	return {
		name: CHAT_WEB_APP_NAME,
		mountPath: CHAT_WEB_MOUNT_PATH,
		apiPrefix: CHAT_WEB_API_PREFIX,
		async handleRequest(request, context) {
			const url = new URL(request.url);
			ensureEventIndexing(state, context);
			ensureCustomAgentProfiles(state, context);
			syncUserSkills(state, context);

			const builtAsset = responseBuiltChatAsset(request, url.pathname);
			if (builtAsset) return builtAsset;
			const builtPublicFile = responseBuiltChatPublicFile(request, url.pathname);
			if (builtPublicFile) return builtPublicFile;

			if (isChatAppPath(url.pathname) && request.method === "GET") {
				return responseBuiltChatIndex() ?? responseHtml(createChatHtml());
			}

			if (url.pathname === CHAT_WEB_API_PREFIX + "/download" && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const path = url.searchParams.get("path")?.trim();
				if (!path) throw new PiboWebHttpError("Download path is required", 400);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					url.searchParams.get("roomId") || undefined,
				);
				const room = ensureSessionRoom(state, context, selectedSession, webSession);
				const basePath = roomWorkspaceFromMetadata(room.metadata) ?? selectedSession.workspace ?? getDefaultPiboWorkspace();
				const absolutePath = resolveDownloadPath(path, basePath);
				let stat;
				try {
					stat = statSync(absolutePath);
				} catch {
					throw new PiboWebHttpError("File not found: " + absolutePath, 404);
				}
				if (!stat.isFile()) throw new PiboWebHttpError("Path is not a file: " + absolutePath, 400);
				return new Response(Readable.toWeb(createReadStream(absolutePath)) as any, {
					headers: {
						"content-type": contentTypeForDownload(absolutePath),
						"content-length": String(stat.size),
						"content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(basename(absolutePath)),
						"cache-control": "no-store",
					},
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/navigation` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				const requestedRoomId = url.searchParams.get("roomId") || undefined;
				const principalId = principalIdFor(webSession);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					requestedRoomId,
				);
				const selectedRoomId = selectedRoomIdForSession(state, context, selectedSession);
				const ownedSessions = listOwnedSessions(context, webSession);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				const defaultRoom = state.roomService.ensureDefaultRoom({
					ownerScope: webSession.ownerScope,
					principalId,
				});
				indexOwnedSessions(state.sessionQuery, roomSessions);
				const sessionUnreadCounts = buildSessionUnreadCounts(state, ownedSessions, principalId);
				const sessions = await buildSessionNodes(
					roomSessions,
					sessionIndexItemsWithSignalState(context, roomSessions, state.sessionQuery.listSessions()),
					process.cwd(),
					sessionUnreadCounts,
					{ skipPiMetadataFallback: true },
				);
				const roomTree = state.roomService.listRoomTree(webSession.ownerScope);
				const roomUnreadCounts = buildRoomUnreadCounts(ownedSessions, sessionUnreadCounts, defaultRoom.id);
				const rooms = roomsWithUnreadCounts(roomTree, roomUnreadCounts);
				return responseJson({
					identity: webSession.authSession.identity,
					session: selectedSession,
					runtimeStatus: context.channelContext.getSessionRuntimeStatus?.(selectedSession.id),
					room: state.roomService.getRoom(selectedRoomId),
					defaultRoomId: defaultRoom.id,
					selectedRoomId,
					selectedPiboSessionId: selectedSession.id,
					latestRoomStreamId: state.timelineQuery.getLatestStreamId({ roomId: selectedRoomId }),
					rooms,
					sessions,
				}, { headers: { "server-timing": "navigation;desc=\"no_catalog_no_jsonl\"" } });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/bootstrap` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				const markRead = parseBooleanSearchParam(url, "markRead");
				const requestedRoomId = url.searchParams.get("roomId") || undefined;
				const principalId = principalIdFor(webSession);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					requestedRoomId,
				);
				const selectedRoomId = selectedRoomIdForSession(state, context, selectedSession);
				const ownedSessions = listOwnedSessions(context, webSession);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				const defaultRoom = state.roomService.ensureDefaultRoom({
					ownerScope: webSession.ownerScope,
					principalId,
				});
				if (markRead) {
					markSessionsRead(state, sessionSubtree(ownedSessions, selectedSession.id), principalId);
				}
				indexOwnedSessions(state.sessionQuery, roomSessions);
				const sessionUnreadCounts = buildSessionUnreadCounts(state, ownedSessions, principalId);
				const [sessions, catalog] = await Promise.all([
					buildSessionNodes(
						roomSessions,
						sessionIndexItemsWithSignalState(context, roomSessions, state.sessionQuery.listSessions()),
						process.cwd(),
						sessionUnreadCounts,
					),
					loadBootstrapCatalog(state, context, webSession),
				]);
				const roomTree = state.roomService.listRoomTree(webSession.ownerScope);
				const roomUnreadCounts = buildRoomUnreadCounts(ownedSessions, sessionUnreadCounts, defaultRoom.id);
				const rooms = roomsWithUnreadCounts(roomTree, roomUnreadCounts);
				return responseJson({
					identity: webSession.authSession.identity,
					session: selectedSession,
					runtimeStatus: context.channelContext.getSessionRuntimeStatus?.(selectedSession.id),
					room: state.roomService.getRoom(selectedRoomId),
					selectedRoomId,
					selectedPiboSessionId: selectedSession.id,
					latestRoomStreamId: state.timelineQuery.getLatestStreamId({ roomId: selectedRoomId }),
					rooms,
					sessions,
					...catalog,
				});
			}

			if (url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/cron`)) {
				const webSession = await requireSession(request, context);
				const response = await handleChatCronApiRequest({
					request,
					context,
					webSession,
					roomService: state.roomService,
					cronStore: state.cronStore,
					defaultProfile,
				});
				if (response) return response;
			}

			if (url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/ralph`)) {
				const webSession = await requireSession(request, context);
				const response = await handleChatRalphApiRequest({
					request,
					context,
					webSession,
					roomService: state.roomService,
					ralphStore: state.ralphStore,
					defaultProfile,
				});
				if (response) return response;
			}


			if (url.pathname === `${CHAT_WEB_API_PREFIX}/projects/bootstrap` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				return responseJson(await buildProjectsBootstrap({
					state,
					context,
					webSession,
					defaultProfile,
					projectId: url.searchParams.get("projectId") || undefined,
					piboSessionId: url.searchParams.get("piboSessionId") || undefined,
					includeArchived: parseBooleanSearchParam(url, "includeArchived"),
				}));
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/projects/message` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatMessageBody>(request);
				return sendProjectMessage({ state, context, webSession, defaultProfile, body });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/projects` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ projects: state.projectService.listProjects({ includeArchived: parseBooleanSearchParam(url, "includeArchived") }) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/projects` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectCreateBody>(request);
				try {
					const project = state.projectService.createProject({
						ownerScope: webSession.ownerScope,
						name: normalizeRoomName(body.name),
						description: normalizeProjectDescription(body.description),
						projectFolder: normalizeProjectPath(body.projectFolder),
						createFolder: body.createFolder === true,
					});
					return responseJson({ project }, { status: 201 });
				} catch (error) {
					throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
				}
			}

			const projectResource = projectResourcePath(url.pathname);
			if (projectResource && projectResource.child === undefined && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatProjectPatchBody>(request);
				try {
					const project = state.projectService.updateProject(projectResource.projectId, {
						...(body.name !== undefined ? { name: normalizeRoomName(body.name) } : {}),
						...(body.description !== undefined ? { description: normalizeProjectDescription(body.description) ?? null } : {}),
						...(body.archived !== undefined ? { archived: normalizeProjectArchived(body.archived) } : {}),
					});
					if (!project) throw new PiboWebHttpError("Project not found", 404);
					return responseJson({ project });
				} catch (error) {
					if (error instanceof PiboWebHttpError) throw error;
					throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
				}
			}

			if (projectResource && projectResource.child === undefined && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatProjectDeleteBody>(request);
				try {
					return responseJson(state.projectService.deleteProject(projectResource.projectId, {
						confirmName: normalizeRoomDeleteConfirmation(body.confirmName),
						deleteFiles: body.deleteFiles === true,
					}));
				} catch (error) {
					throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
				}
			}

			if (projectResource && projectResource.child === "workflow-sessions" && request.method === "POST" && !projectWorkflowSessionStartResource(url.pathname)) {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectSessionCreateBody>(request);
				const project = state.projectService.requireProject(projectResource.projectId);
				const profile = resolveCreateSessionProfile(context, defaultProfile, body.profile);
				const workflowSelection = resolveProjectWorkflowSelection(state, body.workflowId, body.workflowVersion, { requireExplicitWorkflowId: true, requireExplicitVersion: true });
				const baseDefinition = createPublishedWorkflowDefinition(workflowSelection, profile);
				const configuration = normalizeProjectWorkflowSessionConfiguration(body, baseDefinition);
				const validation = validatePublishedWorkflowBoundary({
					state,
					context,
					webSession,
					workflow: workflowSelection,
					profileId: profile,
					trigger: "before_project_session_creation",
				});
				if (!validation.validation.ok) {
					return workflowValidationBlockedResponse("Workflow version has validation errors and cannot be used to create a Project session", validation, { workflow: workflowSelection });
				}
				const session = createProjectChatSession({
					state,
					context,
					webSession,
					project,
					profile,
					workflowId: workflowSelection.id,
					workflowVersion: workflowSelection.version,
					title: normalizeSessionTitle(body.title) ?? undefined,
					configuredWorkflow: true,
					configuration,
				});
				const snapshot = state.projectService.saveWorkflowSessionSnapshot(createProjectWorkflowSessionSnapshot({
					webSession,
					project,
					session,
					workflow: workflowSelection,
					baseDefinition,
					configuration,
					validation,
				}));
				return responseJson({ session, projectSession: state.projectService.getProjectSession(session.id), workflow: workflowSelection, configuration, snapshot, validation: validation.validation, diagnostics: validation.diagnostics }, { status: 201 });
			}

			const workflowSessionStart = projectWorkflowSessionStartResource(url.pathname);
			if (workflowSessionStart && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const session = requireOwnedSession(context, webSession, workflowSessionStart.piboSessionId);
				const project = state.projectService.requireProject(workflowSessionStart.projectId);
				if (project.ownerScope !== webSession.ownerScope) throw new PiboWebHttpError("Project not found", 404);
				const projectSession = state.projectService.getProjectSession(session.id);
				if (!projectSession || projectSession.projectId !== project.id) throw new PiboWebHttpError("Project workflow session not found", 404);
				const workflowSelection = resolveProjectWorkflowSelection(state, projectSession.workflowId, projectSession.workflowVersion);
				const snapshot = state.projectService.getWorkflowSessionSnapshotForSession(session.id);
				if (!snapshot) throw new PiboWebHttpError("Project workflow session snapshot not found", 409);
				const validation = validatePublishedWorkflowBoundary({
					state,
					context,
					webSession,
					workflow: workflowSelection,
					profileId: session.profile,
					trigger: "before_workflow_start",
				});
				if (!validation.validation.ok) {
					return workflowValidationBlockedResponse("Workflow session has validation errors and cannot be started", validation, { projectSession, workflow: workflowSelection });
				}
				return responseJson({
					projectSession,
					workflow: workflowSelection,
					snapshot,
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					message: "Workflow start validation passed. Run creation is implemented by the V2 Project start story.",
				}, { status: 202 });
			}

			if (projectResource && projectResource.child === "sessions" && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectSessionCreateBody>(request);
				const project = state.projectService.requireProject(projectResource.projectId);
				const profile = resolveCreateSessionProfile(context, defaultProfile, body.profile);
				const workflowId = normalizeLegacyProjectWorkflowId(body.workflowId);
				const session = createProjectChatSession({ state, context, webSession, project, profile, workflowId });
				return responseJson({ session, projectSession: state.projectService.getProjectSession(session.id) }, { status: 201 });
			}

			const projectSessionId = projectSessionResourceId(url.pathname);
			if (projectSessionId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, projectSessionId);
				const body = await readJsonBody<ChatProjectSessionPatchBody>(request);
				const updateSession = context.channelContext.updateSession;
				if (!updateSession) throw new PiboWebHttpError("Session updates are not available", 501);
				const title = normalizeSessionTitle(body.title);
				let updated = selectedSession;
				if (title !== undefined) {
					const next = updateSession(selectedSession.id, { title });
					if (!next) throw new PiboWebHttpError("Session not found", 404);
					updated = next;
					state.sessionQuery.upsertSession(updated);
				}
				const archived = normalizeProjectSessionArchived(body.archived);
				const projectSession = archived === undefined ? state.projectService.getProjectSession(selectedSession.id) : state.projectService.setProjectSessionArchived(selectedSession.id, archived);
				return responseJson({ session: updated, projectSession });
			}

			const requestedSignal = signalResource(url.pathname);
			if (requestedSignal && request.method === "GET") {
				const webSession = await requireSession(request, context);
				requireOwnedSession(context, webSession, requestedSignal.piboSessionId);
				const snapshot = requestedSignal.kind === "session"
					? context.channelContext.snapshotSignalSession?.(requestedSignal.piboSessionId)
					: context.channelContext.snapshotSignalTree?.(requestedSignal.piboSessionId);
				if (!snapshot) throw new PiboWebHttpError("Signal registry is not available", 503);
				return responseJson(snapshot);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/signals/events` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const rootPiboSessionId = url.searchParams.get("rootPiboSessionId") ?? url.searchParams.get("piboSessionId");
				if (!rootPiboSessionId) throw new PiboWebHttpError("rootPiboSessionId is required", 400);
				requireOwnedSession(context, webSession, rootPiboSessionId);
				if (!context.channelContext.snapshotSignalTree || !context.channelContext.subscribeSignalTree) {
					throw new PiboWebHttpError("Signal registry is not available", 503);
				}
				let unsubscribe: (() => void) | undefined;
				const stream = new ReadableStream<Uint8Array>({
					start: (controller) => {
						writeJsonSse(controller, "signal_snapshot", context.channelContext.snapshotSignalTree!(rootPiboSessionId));
						unsubscribe = context.channelContext.subscribeSignalTree!(rootPiboSessionId, (patch) => {
							writeJsonSse(controller, "signal_patch", patch, String(patch.toVersion));
						});
					},
					cancel: () => unsubscribe?.(),
				});
				return new Response(stream, {
					headers: {
						"content-type": "text/event-stream; charset=utf-8",
						"cache-control": "no-store",
						connection: "keep-alive",
					},
				});
			}

			const workflowDraftAction = workflowDraftActionResource(url.pathname);
			if (workflowDraftAction && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const record = requireMutableWorkflowDraft(state, webSession, workflowDraftAction.draftId);
				if (workflowDraftAction.action === "validate") {
					const body = await readJsonBody<WorkflowDraftValidateBody>(request);
					const trigger = normalizeWorkflowValidationTrigger(body.trigger, "graph_edit");
					const validation = runWorkflowDraftValidation(state, context, webSession, record, trigger);
					return responseJson({ draft: serializeWorkflowDraft(record), ...validation });
				}
				const body = await readJsonBody<WorkflowDraftPublishBody>(request);
				record.versionIntent = normalizeWorkflowVersionIntent(body.versionIntent, record.versionIntent);
				const validation = runWorkflowDraftValidation(state, context, webSession, record, "before_publish");
				if (!validation.validation.ok) {
					return workflowValidationBlockedResponse("Workflow draft has validation errors and cannot be published", validation, { draft: serializeWorkflowDraft(record) });
				}
				const publishResult = state.workflowPublishedVersionStore.publishDraft({
					draft: record,
					versionIntent: record.versionIntent,
					publishedBy: principalIdFor(webSession),
					reservedVersions: STATIC_WORKFLOW_VERSION_CATALOG
						.filter((workflow) => workflow.id === record.workflowId && workflow.status === "published")
						.map((workflow) => workflow.version),
				});
				record.targetWorkflowVersion = publishResult.record.version;
				record.definition = publishResult.record.definition;
				record.updatedAt = publishResult.record.publishedAt;
				state.workflowDraftStore.saveDraft(record);
				return responseJson({
					draft: serializeWorkflowDraft(record),
					...validation,
					publishedVersion: publishResult.record,
					alreadyPublished: publishResult.alreadyPublished,
					message: publishResult.alreadyPublished
						? `Workflow draft was already published as ${publishResult.record.workflowId}@${publishResult.record.version}.`
						: `Published ${publishResult.record.workflowId}@${publishResult.record.version} with a ${record.versionIntent} version bump.`,
				}, { status: publishResult.alreadyPublished ? 200 : 201 });
			}

			const workflowDraftId = workflowDraftResourceId(url.pathname);
			if (workflowDraftId && request.method === "GET") {
				const webSession = await requireSession(request, context);
				return responseJson({ draft: requireValidatedWorkflowDraft(state, context, webSession, workflowDraftId) });
			}

			if (workflowDraftId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowDraftPatchBody>(request);
				const record = requireMutableWorkflowDraft(state, webSession, workflowDraftId);
				const { definition, trigger, diagnostic } = parseWorkflowDraftDefinitionFromPatch(body);
				if (definition) {
					record.definition = definition;
					record.diagnostics = withoutRawWorkflowIrParseDiagnostic(record.diagnostics);
					record.revision += 1;
				} else if (diagnostic) {
					record.diagnostics = [...withoutRawWorkflowIrParseDiagnostic(record.diagnostics), diagnostic];
				}
				const validation = runWorkflowDraftValidation(state, context, webSession, record, trigger);
				return responseJson({ draft: serializeWorkflowDraft(record), ...validation });
			}

			const duplicateWorkflowId = workflowDuplicateResourceId(url.pathname);
			if (duplicateWorkflowId && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowDuplicateBody>(request);
				const draft = duplicateWorkflowIntoDraft(state, webSession, duplicateWorkflowId, body.version);
				return responseJson({ draft, builderPath: workflowDraftBuilderPath(draft.draftId) }, { status: 201 });
			}

			const nextDraftWorkflowId = workflowNextDraftResourceId(url.pathname);
			if (nextDraftWorkflowId && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowNextDraftBody>(request);
				const { draft, reused } = createNextVersionDraftFromPublishedWorkflow(state, webSession, nextDraftWorkflowId, body.version);
				return responseJson({ draft, builderPath: workflowDraftBuilderPath(draft.draftId), reused }, { status: reused ? 200 : 201 });
			}

			const pickerKind = workflowPickerKind(url.pathname);
			if (pickerKind && request.method === "GET") {
				const webSession = await requireSession(request, context);
				if (pickerKind === "profiles") {
					return responseJson(buildWorkflowProfilePicker(
						state,
						context,
						webSession,
						url.searchParams.get("selectedProfileId") ?? undefined,
					));
				}
				if (pickerKind === "handlers") {
					return responseJson(buildWorkflowHandlerPicker(
						url.searchParams.get("selectedHandlerId") ?? undefined,
					));
				}
				if (pickerKind === "guards") {
					return responseJson(buildWorkflowRegisteredRefPicker(
						"guards",
						WORKFLOW_GUARD_REF_OPTIONS,
						url.searchParams.get("selectedRefId") ?? undefined,
					));
				}
				if (pickerKind === "adapters") {
					return responseJson(buildWorkflowRegisteredRefPicker(
						"adapters",
						WORKFLOW_ADAPTER_REF_OPTIONS,
						url.searchParams.get("selectedRefId") ?? undefined,
					));
				}
				if (pickerKind === "workflow-versions") {
					return responseJson(buildWorkflowVersionPicker(
						state,
						url.searchParams.get("selectedWorkflowId") ?? undefined,
						url.searchParams.get("selectedWorkflowVersion") ?? undefined,
					));
				}
				throw new PiboWebHttpError(`Workflow picker '${pickerKind}' is not implemented`, 501);
			}

			if ((url.pathname === `${CHAT_WEB_API_PREFIX}/agent-catalog` || url.pathname === `${CHAT_WEB_API_PREFIX}/catalog`) && request.method === "GET") {
				const webSession = await requireSession(request, context);
				if (url.pathname === `${CHAT_WEB_API_PREFIX}/catalog`) {
					return responseJson(await loadBootstrapCatalog(state, context, webSession));
				}
				return responseJson({
					catalog: await buildAgentCatalog(context, state),
					profiles: context.channelContext.getProfiles?.() ?? [],
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/model-defaults` && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatModelDefaultsBody>(request);
				const modelDefaults = updateChatModelDefaults(body, process.cwd());
				invalidateBootstrapCatalogCache(state);
				return responseJson({ modelDefaults });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				return responseJson({ userSettings: loadPiboUserSettings(webSession.ownerScope) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/user-settings` && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatUserSettingsBody>(request);
				const timezone = sanitizeTimezone(body.timezone);
				if (!timezone) throw new PiboWebHttpError("Invalid timezone", 400);
				return responseJson({ userSettings: updatePiboUserSettings(webSession.ownerScope, { timezone }) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/pi-packages` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ packages: listPiPackages() });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/pi-packages` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatPiPackageBody>(request);
				const source = normalizePiPackageWebSource(body.source);
				const pkg = upsertPiPackage(await inspectPiPackageSource(source, process.cwd()), process.cwd());
				invalidateBootstrapCatalogCache(state);
				return responseJson({ package: pkg }, { status: 201 });
			}

			const piPackageId = piPackageResourceId(url.pathname);
			if (piPackageId && request.method === "GET") {
				await requireSession(request, context);
				const pkg = findPiPackage(piPackageId);
				if (!pkg) throw new PiboWebHttpError("Pi package is not registered", 404);
				return responseJson({ package: pkg });
			}

			if (piPackageId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const existing = findPiPackage(piPackageId);
				if (!existing) throw new PiboWebHttpError("Pi package is not registered", 404);
				const body = await readJsonBody<ChatPiPackagePatchBody>(request);
				let pkg = existing;
				let changed = false;
				if (body.source !== undefined) {
					const source = normalizePiPackageWebSource(body.source);
					pkg = upsertPiPackage(await inspectPiPackageSource(source, process.cwd()), process.cwd());
					changed = true;
				}
				if (body.enabled !== undefined) {
					if (typeof body.enabled !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
					const updated = setPiPackageEnabled(pkg.id, body.enabled);
					if (!updated) throw new PiboWebHttpError("Pi package is not registered", 404);
					pkg = updated;
					changed = true;
				}
				if (!changed) throw new PiboWebHttpError("No Pi package update fields provided", 400);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ package: pkg });
			}

			if (piPackageId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const existing = findPiPackage(piPackageId);
				if (!existing) throw new PiboWebHttpError("Pi package is not registered", 404);
				const affectedAgents = agentsSelectingPiPackage(state, piPackageId);
				if (affectedAgents.length > 0) {
					throw new PiboWebHttpError(
						`Pi package is selected by custom agents: ${affectedAgents.map((agent) => agent.profileName).join(", ")}`,
						409,
					);
				}
				const removed = removePiPackage(piPackageId);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ removedPackage: removed });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/user-skills` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ skills: state.userSkillManager.list() });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/user-skills` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<{ name?: unknown; description?: unknown; markdown?: unknown }>(request);
				const name = normalizeUserSkillName(body.name);
				assertUserSkillNameIsAvailable(state, context, name);
				const skill = state.userSkillManager.create({
					name,
					description: normalizeUserSkillDescription(body.description ?? ""),
					markdown: normalizeUserSkillMarkdown(body.markdown ?? ""),
				});
				syncUserSkills(state, context);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ skill }, { status: 201 });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/user-skills/install` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<{ url?: unknown }>(request);
				const skill = await state.userSkillManager.installFromUrl(normalizeUserSkillUrl(body.url));
				try {
					assertUserSkillNameIsAvailable(state, context, skill.name, skill.id);
				} catch (error) {
					state.userSkillManager.remove(skill.id);
					throw error;
				}
				syncUserSkills(state, context);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ skill }, { status: 201 });
			}

			const userSkillId = userSkillResourceId(url.pathname);
			if (userSkillId && request.method === "GET") {
				await requireSession(request, context);
				const skill = state.userSkillManager.get(userSkillId);
				if (!skill) throw new PiboWebHttpError("Skill not found", 404);
				const markdown = state.userSkillManager.getSkillMarkdown(skill.id);
				return responseJson({ skill, markdown });
			}

			if (userSkillId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const existing = state.userSkillManager.get(userSkillId);
				if (!existing) throw new PiboWebHttpError("Skill not found", 404);
				const body = await readJsonBody<{
					name?: unknown;
					description?: unknown;
					markdown?: unknown;
					enabled?: unknown;
				}>(request);
				const input: {
					name?: string;
					description?: string;
					markdown?: string;
					enabled?: boolean;
				} = {};
				if (body.name !== undefined) input.name = normalizeUserSkillName(body.name);
				if (body.description !== undefined) input.description = normalizeUserSkillDescription(body.description);
				if (body.markdown !== undefined) input.markdown = normalizeUserSkillMarkdown(body.markdown);
				if (body.enabled !== undefined) input.enabled = normalizeUserSkillEnabled(body.enabled);
				if (Object.keys(input).length === 0) {
					throw new PiboWebHttpError("No skill update fields provided", 400);
				}
				const nextName = input.name ?? existing.name;
				const nextEnabled = input.enabled ?? existing.enabled;
				if (nextEnabled) {
					assertUserSkillNameIsAvailable(state, context, nextName, existing.id);
				}
				const skill = state.userSkillManager.update(existing.id, input);
				syncUserSkills(state, context);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ skill });
			}

			if (userSkillId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const existing = state.userSkillManager.get(userSkillId);
				if (!existing) throw new PiboWebHttpError("Skill not found", 404);
				state.userSkillManager.remove(existing.id);
				syncUserSkills(state, context);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ removedSkillId: existing.id });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/base-prompt` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ basePrompt: await readPiboBasePrompt(process.cwd()) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/base-prompt` && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatBasePromptBody>(request);
				return responseJson({ basePrompt: setPiboBasePromptMode(normalizeBasePromptMode(body.mode), process.cwd()) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/base-prompt/custom` && request.method === "PUT") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatBasePromptBody>(request);
				return responseJson({ basePrompt: await savePiboCustomBasePrompt(normalizeBasePromptMarkdown(body.markdown), process.cwd()) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ compactionPrompt: await readPiboCompactionPrompt(process.cwd()) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt` && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatBasePromptBody>(request);
				return responseJson({ compactionPrompt: setPiboCompactionPromptMode(normalizeCompactionPromptMode(body.mode), process.cwd()) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/compaction-prompt/custom` && request.method === "PUT") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatBasePromptBody>(request);
				return responseJson({ compactionPrompt: await savePiboCustomCompactionPrompt(normalizeCompactionPromptMarkdown(body.markdown), process.cwd()) });
			}

			const mcpServerName = mcpServerResourceName(url.pathname);
			if (mcpServerName && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<ChatMcpServerDescriptionBody>(request);
				const server = await setMcpServerDescription(
					mcpServerName,
					normalizeMcpServerDescriptionBody(body.description),
				);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ server });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/agents` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				return responseJson({ agents: serializeCustomAgents(state.agentStore.list(webSession.ownerScope, { includeArchived }), context) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/agents` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatAgentBody>(request);
				const input = createAgentInput(webSession.ownerScope, body);
				requireAgentProfileNameAvailable(state, context, input.displayName);
				const agent = state.agentStore.create(input);
				context.channelContext.upsertProfile?.(createCustomAgentProfileDefinition(agent));
				invalidateBootstrapCatalogCache(state);
				return responseJson({ agent: serializeCustomAgent(agent, context) }, { status: 201 });
			}

			const patchAgentId = agentResourceId(url.pathname);
			if (patchAgentId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const existing = requireOwnedAgent(state.agentStore.get(patchAgentId), webSession);
				const body = await readJsonBody<ChatAgentBody>(request);
				const update = createAgentUpdate(body);
				const archived = normalizeAgentArchived(body.archived);
				if (update.displayName) requireAgentProfileNameAvailable(state, context, update.displayName, existing.id);
				const updated = Object.keys(update).length ? state.agentStore.update(patchAgentId, update) : existing;
				const afterUpdate = requireOwnedAgent(updated, webSession);
				const agent = archived === undefined ? afterUpdate : state.agentStore.setArchived(patchAgentId, archived);
				const owned = requireOwnedAgent(agent, webSession);
				if (existing.profileName !== owned.profileName) context.channelContext.removeProfile?.(existing.profileName);
				if (owned.archivedAt) {
					context.channelContext.removeProfile?.(owned.profileName);
				} else {
					context.channelContext.upsertProfile?.(createCustomAgentProfileDefinition(owned));
				}
				invalidateBootstrapCatalogCache(state);
				return responseJson({ agent: serializeCustomAgent(owned, context) });
			}

			if (patchAgentId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const agent = requireOwnedAgent(state.agentStore.get(patchAgentId), webSession);
				if (!agent.archivedAt) throw new PiboWebHttpError("Archive the agent before permanently deleting it.", 400);
				const body = await readJsonBody<ChatAgentBody>(request);
				const confirmName = normalizeAgentDeleteConfirmation(body.confirmName);
				if (confirmName !== agent.profileName) {
					throw new PiboWebHttpError(`Type "${agent.profileName}" to permanently delete this agent and its sessions.`, 400);
				}
				const deletedSessionIds = deleteSessionsForAgentProfile(state, context, webSession, agent.profileName);
				state.agentStore.delete(agent.id);
				context.channelContext.removeProfile?.(agent.profileName);
				invalidateBootstrapCatalogCache(state);
				return responseJson({ deletedAgentId: agent.id, deletedSessionIds });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/session` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const selectedSession = ensureDefaultChatSession(state, context, webSession, defaultProfile);
				state.sessionQuery.upsertSession(selectedSession);
				return responseJson({
					identity: webSession.authSession.identity,
					session: selectedSession,
					room: state.roomService.getRoom(selectedRoomIdForSession(state, context, selectedSession)),
					capabilities: {
						actions: context.channelContext.getGatewayActions(),
					},
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/sessions` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const archivedPage = parseBooleanSearchParam(url, "archived");
				const includeArchived = archivedPage || parseBooleanSearchParam(url, "includeArchived");
				const roomId = url.searchParams.get("roomId") || undefined;
				const cursor = url.searchParams.get("cursor") || undefined;
				const limit = parsePositiveIntSearchParam(url, "limit", archivedPage ? 60 : 120, 500);
				const wantsPage = url.searchParams.has("limit") || url.searchParams.has("cursor") || url.searchParams.has("archived");
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					roomId,
				);
				const selectedRoomId = selectedRoomIdForSession(state, context, selectedSession);
				const ownedSessions = listOwnedSessions(context, webSession);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				indexOwnedSessions(state.sessionQuery, roomSessions);
				const nodes = await buildSessionNodes(
					roomSessions,
					state.sessionQuery.listSessions(),
					process.cwd(),
					new Map(),
				);
				if (!wantsPage) return responseJson(nodes);
				const page = paginateSessionNodes(nodes, { archived: archivedPage, cursor, limit });
				return responseJson({
					roomId: selectedRoomId,
					archived: archivedPage,
					sessions: page.sessions,
					nextCursor: page.nextCursor,
					totalCount: page.totalCount,
					version: sessionTreeVersion(nodes),
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/sessions` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatSessionCreateBody>(request);
				const profile = resolveCreateSessionProfile(context, defaultProfile, body.profile);
				const room =
					typeof body.roomId === "string"
						? requireRoom(state, body.roomId, webSession, "write")
						: state.roomService.ensureDefaultRoom({
								ownerScope: webSession.ownerScope,
								principalId: principalIdFor(webSession),
							});
				const created = createPersonalChatSession(context, webSession, profile, room);
				state.sessionQuery.upsertSession(created);
				return responseJson({ session: created }, { status: 201 });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				state.roomService.ensureDefaultRoom({
					ownerScope: webSession.ownerScope,
					principalId: principalIdFor(webSession),
				});
				return responseJson({ rooms: state.roomService.listRoomTree(webSession.ownerScope) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatRoomCreateBody>(request);
				const parentRoomId = normalizeParentRoomId(body.parentRoomId);
				if (parentRoomId) requireRoom(state, parentRoomId, webSession, "admin");
				const room = state.roomService.createRoom({
					ownerScope: webSession.ownerScope,
					name: normalizeRoomName(body.name),
					topic: normalizeRoomTopic(body.topic),
					metadata: withPiboRoomWorkspace(undefined, normalizeRoomWorkspace(body.workspace)),
					type: normalizeRoomType(body.type),
					parentRoomId,
				});
				state.roomService.ensureMember({ roomId: room.id, principalId: principalIdFor(webSession), role: "owner" });
				return responseJson({ room }, { status: 201 });
			}

			const roomResource = roomResourcePath(url.pathname);
			if (roomResource && roomResource.child === undefined && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const room = requireRoom(state, roomResource.roomId, webSession, "read");
				const ownedSessions = sessionsInRoom(listOwnedSessions(context, webSession), room.id);
				indexOwnedSessions(state.sessionQuery, ownedSessions);
				return responseJson({
					room,
					member: state.roomService.getMember(room.id, principalIdFor(webSession)),
					sessions: await buildSessionNodes(
						ownedSessions,
						state.sessionQuery.listSessions(),
						process.cwd(),
						new Map(),
					),
				});
			}

			if (roomResource && roomResource.child === undefined && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const existingRoom = requireRoom(state, roomResource.roomId, webSession, "admin");
				const body = await readJsonBody<ChatRoomPatchBody>(request);
				const update = createRoomUpdate(existingRoom, body);
				if (update.parentRoomId) requireRoom(state, update.parentRoomId, webSession, "admin");
				const room = state.roomService.updateRoom(roomResource.roomId, update);
				if (!room) throw new PiboWebHttpError("Room not found", 404);
				return responseJson({ room });
			}

			if (roomResource && roomResource.child === undefined && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const room = requireRoom(state, roomResource.roomId, webSession, "admin");
				const body = await readJsonBody<ChatRoomDeleteBody>(request);
				const deleted = deleteRoomTree(
					state,
					context,
					webSession,
					room,
					normalizeRoomDeleteConfirmation(body.confirmName),
				);
				return responseJson(deleted);
			}

			if (roomResource && roomResource.child === "events" && request.method === "GET") {
				const webSession = await requireSession(request, context);
				requireRoom(state, roomResource.roomId, webSession, "read");
				const cursor = parseSseCursor(url.searchParams.get("since"));
				return responseJson({
					events: state.timelineQuery.listEvents({
						roomId: roomResource.roomId,
						afterStreamId: cursor?.streamId,
						limit: 1000,
					}),
				});
			}

			if (roomResource && roomResource.child === "messages" && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				requireRoom(state, roomResource.roomId, webSession, "write");
				const body = await readJsonBody<ChatMessageBody>(request);
				return sendChatMessage({
					state,
					context,
					webSession,
					defaultProfile,
					body,
					forcedRoomId: roomResource.roomId,
				});
			}

			if (roomResource && roomResource.child === "read" && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const room = requireRoom(state, roomResource.roomId, webSession, "read");
				const roomSessions = sessionsInRoomSubtree(listOwnedSessions(context, webSession), room.id);
				markSessionsRead(state, roomSessions, principalIdFor(webSession));
				return responseJson({ ok: true, roomId: room.id, readSessionIds: roomSessions.map((session) => session.id) });
			}

			const sessionReadPrefix = `${CHAT_WEB_API_PREFIX}/sessions/`;
			if (url.pathname.startsWith(sessionReadPrefix) && url.pathname.endsWith("/read") && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const encodedId = url.pathname.slice(sessionReadPrefix.length, -5);
				if (!encodedId || encodedId.includes("/")) {
					throw new PiboWebHttpError("Invalid session id", 400);
				}
				const readSessionId = decodeURIComponent(encodedId);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, readSessionId);
				markSessionsRead(state, sessionSubtree(listOwnedSessions(context, webSession), selectedSession.id), principalIdFor(webSession));
				return responseJson({ ok: true, piboSessionId: selectedSession.id });
			}

			const patchSessionId = sessionResourceId(url.pathname);
			if (patchSessionId && request.method === "PATCH") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, patchSessionId);
				const body = await readJsonBody<{ title?: unknown; archived?: unknown; profile?: unknown; activeModel?: unknown }>(request);
				const updateSession = context.channelContext.updateSession;
				if (!updateSession) {
					throw new PiboWebHttpError("Session updates are not available", 501);
				}
				if (body.profile !== undefined && (state.activeTraceSessions.has(selectedSession.id) || state.sessionQuery.hasSessionActivity(selectedSession.id))) {
					throw new PiboWebHttpError("Session profile can only be changed before the first message.", 400);
				}
				const updated = updateSession(selectedSession.id, createSessionUpdate(context, selectedSession, body));
				if (!updated) throw new PiboWebHttpError("Session not found", 404);
				if (body.archived === true) {
					markSessionsRead(state, sessionSubtree(listOwnedSessions(context, webSession), selectedSession.id), principalIdFor(webSession));
				}
				state.sessionQuery.upsertSession(updated);
				return responseJson({ session: updated });
			}

			if (patchSessionId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, patchSessionId);
				if (!isChatWebSessionArchived(selectedSession)) {
					throw new PiboWebHttpError("Archive the session before permanently deleting it.", 400);
				}
				const body = await readJsonBody<ChatSessionDeleteBody>(request);
				const confirmText = normalizeSessionDeleteConfirmation(body.confirmText);
				if (confirmText !== "Delete this session") {
					throw new PiboWebHttpError('Type "Delete this session" to permanently delete this session.', 400);
				}
				const deletedSessionIds = deleteSessionSubtree(state, context, webSession, selectedSession);
				return responseJson({ deletedSessionIds });
			}

			const sessionKillPrefix = `${CHAT_WEB_API_PREFIX}/sessions/`;
			if (url.pathname.startsWith(sessionKillPrefix) && url.pathname.endsWith("/kill") && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const encodedId = url.pathname.slice(sessionKillPrefix.length, -5);
				if (!encodedId || encodedId.includes("/")) {
					throw new PiboWebHttpError("Invalid session id", 400);
				}
				const killSessionId = decodeURIComponent(encodedId);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, killSessionId);
				const output = await context.channelContext.emit({
					type: "execution",
					piboSessionId: selectedSession.id,
					id: randomUUID(),
					action: "kill",
				});
				return responseJson(output);
			}

			if (url.pathname.startsWith(sessionKillPrefix) && url.pathname.endsWith("/kill-all") && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const encodedId = url.pathname.slice(sessionKillPrefix.length, -9);
				if (!encodedId || encodedId.includes("/")) {
					throw new PiboWebHttpError("Invalid session id", 400);
				}
				const killAllSessionId = decodeURIComponent(encodedId);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, killAllSessionId);
				const output = await context.channelContext.emit({
					type: "execution",
					piboSessionId: selectedSession.id,
					id: randomUUID(),
					action: "kill_all",
				});
				return responseJson(output);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace/summary` && request.method === "GET") {
				const startedAt = performance.now();
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				state.sessionQuery.upsertSession(selectedSession);
				const indexedSession = state.sessionQuery.getSession(selectedSession.id);
				const metadataStartedAt = performance.now();
				const metadata = await loadPiSessionMetadata(selectedSession, selectedSession.workspace ?? process.cwd());
				const metadataMs = performance.now() - metadataStartedAt;
				const lastEventSequence = state.timelineQuery.getLatestEventSequence(selectedSession.id);
				const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: selectedSession.id });
				const version = createTraceViewVersion({
					session: selectedSession,
					sessions: listOwnedSessions(context, webSession),
					events: lastEventSequence > 0
						? [{ id: `seq:${lastEventSequence}`, eventSequence: lastEventSequence, createdAt: indexedSession?.lastActivityAt ?? "" }]
						: [],
					status: indexedSession?.status,
					metadata,
					latestStreamId,
				});
				const headers = {
					etag: etagForVersion(version),
					"x-pibo-trace-version": version,
					"server-timing": [
						`trace_summary;dur=${(performance.now() - startedAt).toFixed(1)}`,
						`trace_metadata;dur=${metadataMs.toFixed(1)}`,
						`trace_events;desc="${lastEventSequence}"`,
					].join(", "),
				};
				if (requestMatchesVersion(request, version)) {
					return new Response(null, { status: 304, headers });
				}
				const summary: PiboSessionTraceSummary = {
					piboSessionId: selectedSession.id,
					piSessionId: selectedSession.piSessionId,
					title: selectedSession.title ?? "Untitled Session",
					version,
					latestStreamId,
					eventCount: lastEventSequence,
					status: indexedSession?.status,
				};
				return responseJson(summary, { headers });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace` && request.method === "GET") {
				const startedAt = performance.now();
				const webSession = await requireSession(request, context);
				const includeRawEvents = parseBooleanSearchParam(url, "includeRawEvents");
				const rawEventsLimit = parsePositiveIntSearchParam(url, "rawEventsLimit", 80, 1000);
				const beforeSequence = parseOptionalPositiveIntSearchParam(url, "beforeSequence");
				const eventLimit = url.searchParams.has("pageSize")
					? parsePositiveIntSearchParam(url, "pageSize", DEFAULT_TRACE_EVENTS_PAGE_SIZE, MAX_TRACE_EVENTS_PER_REQUEST)
					: parsePositiveIntSearchParam(url, "eventLimit", DEFAULT_TRACE_EVENTS_PAGE_SIZE, MAX_TRACE_EVENTS_PER_REQUEST);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				state.sessionQuery.upsertSession(selectedSession);
				const ownedSessions = listOwnedSessions(context, webSession);
				const indexedSession = state.sessionQuery.getSession(selectedSession.id);
				const metadataStartedAt = performance.now();
				const metadata = await loadPiSessionMetadata(selectedSession, selectedSession.workspace ?? process.cwd());
				const metadataMs = performance.now() - metadataStartedAt;
				const lastEventSequence = state.timelineQuery.getLatestEventSequence(selectedSession.id);
				const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: selectedSession.id });
				const version = createTraceViewVersion({
					session: selectedSession,
					sessions: ownedSessions,
					events: lastEventSequence > 0
						? [{ id: `seq:${lastEventSequence}`, eventSequence: lastEventSequence, createdAt: indexedSession?.lastActivityAt ?? "" }]
						: [],
					status: indexedSession?.status,
					metadata,
					latestStreamId,
				});
				const pageCursorKey = beforeSequence === undefined ? "tail" : `before:${beforeSequence}`;
				const cacheKey = traceCacheKey(selectedSession.id, `${version}:limit:${eventLimit}:${pageCursorKey}`);
				const cached = state.traceCache.get(cacheKey);
				const serverTiming = (cacheState: "hit" | "miss", eventCount = 0) => ({
					"server-timing": [
						`trace;dur=${(performance.now() - startedAt).toFixed(1)}`,
						`trace_metadata;dur=${metadataMs.toFixed(1)}`,
						`trace_events;desc="${eventCount}"`,
						`trace_cache;desc="${cacheState}"`,
					].join(", "),
				});
				const baseHeaders = { etag: etagForVersion(version), "x-pibo-trace-version": version };
				if (!includeRawEvents && beforeSequence === undefined && requestMatchesVersion(request, version)) {
					return new Response(null, { status: 304, headers: { ...baseHeaders, ...serverTiming(cached ? "hit" : "miss") } });
				}
				let trace = cached;
				let eventCount = 0;
				if (!trace) {
					const events = state.timelineQuery.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit: eventLimit,
						...(beforeSequence !== undefined ? { beforeSequence } : {}),
					});
					eventCount = events.length;
					trace = await buildTraceView({
						session: selectedSession,
						sessions: ownedSessions,
						events,
						status: indexedSession?.status,
						metadata,
						includeRawEvents: false,
						latestStreamId,
					});
					trace = annotateTracePage(trace, events, { lastEventSequence, pageSize: eventLimit, beforeSequence });
					setTraceCache(state.traceCache, cacheKey, trace);
				}
				if (includeRawEvents) {
					const rawEvents = state.timelineQuery.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit: rawEventsLimit,
						...(beforeSequence !== undefined ? { beforeSequence } : {}),
					});
					eventCount = eventCount || rawEvents.length;
					return responseJson(withRawTraceTail(trace, rawEvents), { headers: { ...baseHeaders, ...serverTiming(cached ? "hit" : "miss", eventCount) } });
				}
				return responseJson(trace, { headers: { ...baseHeaders, ...serverTiming(cached ? "hit" : "miss", eventCount) } });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/debug/persistence` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ persistence: serializePersistenceMetrics(state.persistenceMetrics) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/debug/trace-at-sequence` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				const body = await readJsonBody<{ piboSessionId?: unknown; eventSequence?: unknown }>(request);
				const piboSessionId = typeof body.piboSessionId === "string" ? body.piboSessionId : undefined;
				const eventSequence = typeof body.eventSequence === "number" ? body.eventSequence : undefined;
				if (!piboSessionId || eventSequence === undefined) {
					throw new PiboWebHttpError("Missing piboSessionId or eventSequence", 400);
				}
				const session = context.channelContext.getSession(piboSessionId);
				if (!session) throw new PiboWebHttpError("Session not found", 404);
				const ownedSessions = listOwnedSessions(context, await requireSession(request, context));
				const indexedSession = state.sessionQuery.getSession(piboSessionId);
				const trace = await buildTraceView({
					session,
					sessions: ownedSessions,
					events: state.timelineQuery.listTraceEvents({ piboSessionId, beforeOrAtSequence: eventSequence, limit: DEFAULT_TRACE_EVENTS_PAGE_SIZE }),
					status: indexedSession?.status,
				});
				return responseJson(trace);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/message` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatMessageBody>(request);
				return sendChatMessage({ state, context, webSession, defaultProfile, body });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/action` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<{ piboSessionId?: unknown; action?: unknown; params?: unknown }>(request);
				if (typeof body.action !== "string" || body.action.length === 0) {
					return responseJson({ error: "Action is required" }, { status: 400 });
				}
				if (body.params !== undefined && !isJsonValue(body.params)) {
					return responseJson({ error: "Params must be JSON serializable" }, { status: 400 });
				}
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					typeof body.piboSessionId === "string" ? body.piboSessionId : undefined,
				);
				const room = ensureSessionRoom(state, context, selectedSession, webSession);
				if (isPiboRoomArchived(room)) {
					throw new PiboWebHttpError("Archived rooms are read-only", 403);
				}
				state.sessionQuery.upsertSession(selectedSession);
				const output = await context.channelContext.emit({
					type: "execution",
					piboSessionId: selectedSession.id,
					id: randomUUID(),
					action: body.action,
					...(body.params === undefined ? {} : { params: body.params }),
				});
				return responseJson(output);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/events` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const requestedRoomId = url.searchParams.get("roomId") || undefined;
				const requestedPiboSessionId = url.searchParams.get("piboSessionId") || undefined;
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					requestedPiboSessionId,
					requestedRoomId,
				);
				const cursor = parseSseCursor(url.searchParams.get("since")) ?? parseSseCursor(request.headers.get("last-event-id"));
				if (!requestedRoomId && state.projectService.getProjectSession(selectedSession.id)) {
					return createEventStream({
						piboSessionId: selectedSession.id,
						activePiboSessionId: selectedSession.id,
						principalId: principalIdFor(webSession),
						context,
						state,
						cursor,
					});
				}
				const roomId = requestedRoomId ?? selectedRoomIdForSession(state, context, selectedSession);
				requireRoom(state, roomId, webSession, "read");
				const streamPiboSessionId = requestedPiboSessionId || !requestedRoomId ? selectedSession.id : undefined;
				return createEventStream({
					roomId: streamPiboSessionId ? undefined : roomId,
					piboSessionId: streamPiboSessionId,
					activePiboSessionId: streamPiboSessionId ? selectedSession.id : undefined,
					principalId: principalIdFor(webSession),
					context,
					state,
					cursor,
				});
			}

			return undefined;
		},
	};
}
