import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../core/events.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import type { PiboWebApp, PiboWebAppContext, PiboWebSession } from "../../web/types.js";
import type { PiboSession } from "../../sessions/store.js";
import { OutputCompactor } from "./output-compactor.js";
import { isLiveOnlyOutputEvent, isPersistableOutputEvent } from "./output-event-policy.js";
import type { ChatEventAppendInput, ChatEventListInput, StoredChatEvent } from "./types/event-store.js";
import type { ChatWebSessionBootstrapIndexResult, ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "./types/read-model.js";
import {
	chatRoomIdFromMetadata,
	isDefaultPiboRoom,
	isPiboRoomArchived,
	roomWorkspaceFromMetadata,
	withChatRoomId,
	withPiboRoomWorkspace,
	type CreatePiboRoomInput,
	type PiboRoom,
	type PiboRoomNode,
	type UpdatePiboRoomInput,
} from "./types/rooms.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState, nextTransientChatStreamFrameId, type ChatStreamEvent } from "./stream.js";
import { buildSessionNodes, buildTraceView, createTraceViewVersion, loadPiSessionMetadata, readTailEntries, type PiboSessionTraceView, type PiboWebSessionNode, type PiboWebSessionStatus } from "./trace.js";
import type { ChatWebStoredEvent, PiboSessionTraceSummary, TraceTimelinePage } from "../../shared/trace-types.js";
import {
	DEFAULT_TRACE_EVENTS_PAGE_SIZE,
	MAX_TRACE_EVENTS_PER_REQUEST,
	annotateTracePage,
	etagForVersion,
	estimateTraceViewBytes,
	traceCacheEstimatedBytes,
	liveSnapshotVersion,
	requestMatchesVersion,
	setTraceCache,
	traceCacheKey,
	withLiveSnapshots,
	withRawTraceTail,
} from "./chat-trace-helpers.js";
import {
	TRACE_V2_DEFAULT_TIMELINE_LIMIT,
	TRACE_V2_MAX_TIMELINE_LIMIT,
	TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES,
	TRACE_V2_PAYLOAD_MAX_LIMIT_BYTES,
	TRACE_V2_RAW_EVENTS_DEFAULT_LIMIT,
	TRACE_V2_RAW_EVENTS_MAX_LIMIT,
	TRACE_V2_TIMELINE_HARD_BYTES,
	parseTracePayloadRef,
	readTracePayloadChunk,
	traceRawEventsPageFromEvents,
	traceTimelinePageFromView,
} from "./trace-v2.js";
import { isChatWebSessionArchived } from "./session-metadata.js";
import { withWorkflowSessionKind } from "../../sessions/workflow-session-kind.js";
import {
	CustomAgentStore,
	createDefaultCustomAgentStore,
	type CustomAgentDefinition,
} from "./agent-store.js";
import {
	loadPiboModelDefaults,
	type PiboModelDefaults,
} from "../../core/model-defaults.js";
import { inspectPiboContextBuild } from "../../core/context-build.js";
import { loadPiboUserSettings, updateTelemetryRetentionLastPrunedAt } from "../../core/user-settings.js";
import { isTelemetryRetentionMaintenanceDue, maybeRunTelemetryRetentionMaintenance, type TelemetryRetentionMaintenanceState } from "./telemetry-retention-service.js";
import { loadModelCatalog } from "./model-catalog.js";
import { createCustomAgentProfileDefinition } from "./agent-profiles.js";
import { createDefaultPiboReliabilityStore, PiboReliabilityStore } from "../../reliability/store.js";
import { listMcpServerInfos } from "../../mcp/agent-context.js";
import { getDefaultPiboWorkspace } from "../../core/workspace.js";
import { findPiPackage, listPiPackages } from "../../pi-packages/store.js";
import { UserSkillManager } from "../../user-skills/manager.js";
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
import { prepareWebAnnotationMessageAttachments, type PreparedWebAnnotationAttachments } from "../../web-annotations/attachments.js";
import { createDefaultWebAnnotationStore, type WebAnnotationStore } from "../../web-annotations/store.js";
import { CHAT_WEB_MOUNT_PATH, isChatAppPath, responseBuiltChatAsset, responseBuiltChatPublicFile, responseChatAppShell, CHAT_VSCODE_MOUNT_PATH, isVscodeAppPath, responseBuiltVscodeAsset, responseVscodeAppShell } from "./static-assets.js";
import { executeProviderAuthAction, isProviderAuthAction, providerAuthActionResponse } from "./provider-auth-actions.js";
import { prepareChatFileAttachments, resolveDownloadPath, responseChatFileDownload, saveUploadedChatFiles } from "./chat-files.js";
import {
	chatSettingsRoute,
	chatSettingsRouteInvalidatesBootstrapCatalog,
	chatSettingsRouteRequiresSameOrigin,
	handleChatSettingsRoute,
} from "./chat-settings-routes.js";
import {
	chatCapabilityRoute,
	chatCapabilityRouteRequiresSameOrigin,
	handleChatCapabilityRoute,
} from "./chat-capability-routes.js";
import {
	chatUserSkillRoute,
	chatUserSkillRouteRequiresSameOrigin,
	handleChatUserSkillRoute,
	syncChatUserSkills,
} from "./chat-user-skill-routes.js";
import {
	CHAT_WEB_API_PREFIX,
	agentResourceId,
	projectResourcePath,
	projectSessionResourceId,
	projectWorkflowHumanActionsResource,
	projectWorkflowSessionStartResource,
	roomResourcePath,
	sessionActionResource,
	sessionResourceId,
	signalResource,
	workflowArchiveResourceId,
	workflowCatalogResourceId,
	workflowDraftActionResource,
	workflowDraftResourceId,
	workflowDuplicateResourceId,
	workflowNextDraftResourceId,
	workflowPickerKind,
	workflowPromptAssetResourceId,
	workflowVersionResource,
} from "./chat-api-routes.js";
import {
	assertProjectSessionPatchFields,
	buildStreamingFixtureSchedule,
	createAgentInput,
	createAgentUpdate,
	createRoomUpdate,
	createSessionUpdate,
	normalizeAgentArchived,
	normalizeClientTxnId,
	normalizeMessageText,
	normalizeParentRoomId,
	normalizeProjectArchived,
	normalizeProjectDescription,
	normalizeProjectPath,
	normalizeProjectSessionArchived,
	normalizeRoomDeleteConfirmation,
	normalizeRoomName,
	normalizeRoomTopic,
	normalizeRoomType,
	normalizeRoomWorkspace,
	normalizeSessionDeleteConfirmation,
	normalizeSessionTitle,
	normalizeStreamingFixtureCadenceMs,
	normalizeStreamingFixtureDeltas,
	normalizeStreamingFixtureMix,
	normalizeStreamingFixturePreludeMessages,
	normalizeStreamingFixturePreludeOnly,
	normalizeStreamingFixtureProfile,
	normalizeStreamingFixtureSuppressLiveDeltas,
	normalizeStreamingFixtureTraceSnapshots,
	resolveCreateSessionProfile,
	type ChatAgentBody,
	type ChatMessageBody,
	type ChatProjectCreateBody,
	type ChatProjectDeleteBody,
	type ChatProjectPatchBody,
	type ChatProjectSessionPatchBody,
	type ChatRoomCreateBody,
	type ChatRoomDeleteBody,
	type ChatRoomPatchBody,
	type ChatSessionCreateBody,
	type ChatSessionDeleteBody,
	type ChatStreamingFixtureBody,
} from "./chat-request-normalizers.js";
import {
	ChatWorkflowArchiveStore,
	ChatWorkflowDraftStore,
	ChatWorkflowLifecycleEventStore,
	ChatWorkflowPromptAssetStore,
	ChatWorkflowPublishedVersionStore,
	ChatWorkflowTombstoneStore,
	canonicalWorkflowDefinitionJson,
	compareWorkflowSemver,
	hashWorkflowDefinitionJson,
	normalizeWorkflowPromptAssetLabel,
	parseWorkflowSemver,
	sanitizeWorkflowDiagnostics,
	type WorkflowArchiveStateRecord,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowLifecycleEventInput,
	type WorkflowLifecycleEventRecord,
	type WorkflowPromptAssetDocument,
	type WorkflowPublishedVersionRecord,
	type WorkflowTombstoneRecord,
	type WorkflowValidationResponse,
	type WorkflowValidationTrigger,
} from "./workflow-persistence.js";
import {
	normalizeProjectWorkflowHumanActionBody,
	projectWorkflowHumanActionDiagnosticResponse,
	projectWorkflowHumanActionLifecyclePayload,
	projectWorkflowHumanActionRuntimeDiagnostic,
	projectWorkflowHumanActionSubmittedLifecyclePayload,
	projectWorkflowPendingHumanActionFromToken,
	validateProjectWorkflowHumanActionRequest,
	type ChatProjectWorkflowHumanActionBody,
} from "./project-workflow-human-actions.js";
import {
	createProjectWorkflowRunCurrent,
	createProjectWorkflowSessionSnapshot,
	normalizeProjectWorkflowSessionConfiguration,
	workflowVersionFromSnapshot,
	type ChatProjectSessionCreateBody,
} from "./project-workflow-sessions.js";
import {
	STATIC_WORKFLOW_VERSION_CATALOG,
	buildProjectWorkflowVersionCatalog,
	buildProjectWorkflowVersionOptions,
	buildWorkflowCatalogInspect as buildWorkflowCatalogInspectWithServices,
	buildWorkflowCatalogList as buildWorkflowCatalogListWithServices,
	buildWorkflowVersionHistory,
	buildWorkflowVersionInspect as buildWorkflowVersionInspectWithServices,
	buildWorkflowVersionList as buildWorkflowVersionListWithServices,
	buildWorkflowVersionPicker,
	compareWorkflowCatalogVersionRecords,
	createPublishedWorkflowDefinition,
	selectWorkflowCatalogDisplayVersion,
	workflowDefinitionTags,
	workflowVersionPickerOptionFromCatalogRecord,
	type WorkflowCatalogInspectResponse,
	type WorkflowCatalogListResponse,
	type WorkflowCatalogRecord,
	type WorkflowCatalogServices,
	type WorkflowCatalogVersionRecord,
	type WorkflowPublishedVersionSelection,
	type WorkflowVersionInspectResponse,
	type WorkflowVersionListResponse,
	type WorkflowVersionPickerOption,
} from "./workflow-catalog.js";
import {
	cloneJsonObject,
	isWorkflowValidationPipelineDiagnostic,
	normalizeWorkflowValidationTrigger,
	normalizeWorkflowVersionIntent,
	parseWorkflowDraftDefinitionFromPatch,
	summarizeWorkflowDiagnostics,
	withoutRawWorkflowIrParseDiagnostic,
	type WorkflowDraftPatchBody,
} from "./workflow-validation-helpers.js";
import {
	validateWorkflowEdgeAdapterOutputCompatibilityLike,
	validateWorkflowEdgeDirectCompatibilityLike,
} from "./workflow-edge-compatibility.js";
import { validateJsonSchemaObjectLike } from "./workflow-json-schema-validation.js";
import {
	WORKFLOW_ADAPTER_REF_OPTIONS,
	WORKFLOW_GUARD_REF_OPTIONS,
	WORKFLOW_HUMAN_ACTION_REF_OPTIONS,
	buildWorkflowPromptAssetPicker,
	buildWorkflowRegisteredRefPicker,
	getWorkflowPromptAssetDocument,
	isWorkflowPromptAssetRegistered,
	type WorkflowPickerDiagnostic,
} from "./workflow-registered-ref-pickers.js";
import {
	validateRegisteredAdapterRefLike,
	validateWorkflowGuardRefLike,
	validateWorkflowHumanActionRefsLike,
	validateWorkflowPromptAssetRefLike,
} from "./workflow-registered-ref-validation.js";
import {
	validateNoHiddenLlmCoercion,
	validateNoInlineExecutableCode,
	validateWorkflowDefinitionSecurityBoundary,
} from "./workflow-v2-security-validation.js";

export const CHAT_WEB_APP_NAME = "pibo.chat-web";
export const CHAT_WEB_CHANNEL = "pibo.chat-web";
export { CHAT_WEB_MOUNT_PATH } from "./static-assets.js";
export { CHAT_WEB_API_PREFIX } from "./chat-api-routes.js";

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
	markSessionRead(piboSessionId: string, lastReadStreamId: number): void;
	countUnreadMessagesBySession(input: { piboSessionIds: string[] }): Map<string, number>;
};

type ChatRoomActions = {
	createRoom(input: CreatePiboRoomInput): PiboRoom;
	updateRoom(id: string, input: UpdatePiboRoomInput): PiboRoom | undefined;
	deleteRooms(ids: string[]): number;
	getRoom(id: string): PiboRoom | undefined;
	listRooms(): PiboRoom[];
	listRoomTree(): PiboRoomNode[];
	listRoomSubtree(rootRoomId: string): PiboRoom[];
	ensureDefaultRoom(input?: { name?: string }): PiboRoom;
	updateReadCursor(roomId: string, lastReadStreamId: number): void;
	requireRoom(roomId: string): PiboRoom;
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
	traceTimelinePageCache: Map<string, TraceTimelinePage>;
	bootstrapCatalogCache?: { expiresAt: number; value: Promise<ChatBootstrapCatalog> };
	outputCompactor: OutputCompactor;
	subscribedContext?: PiboWebAppContext;
	unsubscribe?: () => void;
	liveListeners: Set<(event: ChatLiveEvent) => void>;
	transientReplaySequence: number;
	transientReplayBuffer: TransientChatReplayRecord[];
	transientReplayBufferBytes: number;
	transientReplayEvictedBeforeByScope: Map<string, number>;
	activeEventStreams: Map<string, Set<string>>;
	activeTraceSessions: Set<string>;
	persistenceMetrics: ChatPersistenceMetrics;
	resourceMetrics: ChatGatewayResourceMetrics;
	eventLoopDelay: IntervalHistogram;
	userSkillManager: UserSkillManager;
	syncedUserSkillNames?: Set<string>;
	workflowDraftStore: ChatWorkflowDraftStore;
	workflowPublishedVersionStore: ChatWorkflowPublishedVersionStore;
	workflowArchiveStore: ChatWorkflowArchiveStore;
	workflowTombstoneStore: ChatWorkflowTombstoneStore;
	workflowLifecycleEventStore: ChatWorkflowLifecycleEventStore;
	workflowPromptAssetStore: ChatWorkflowPromptAssetStore;
	telemetryRetentionMaintenance: TelemetryRetentionMaintenanceState;
};

type ChatGatewayResourceMetrics = {
	reliabilityPayloadWrites: Record<"inline" | "over_64kb" | "over_1mb" | "over_10mb", number>;
	reliabilityPayloadExternalized: number;
	recentWarnings: Array<{ at: string; message: string }>;
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
		customAgents: serializeCustomAgents(state.agentStore.list({ includeArchived: true }), context),
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

type WorkflowProfilePickerOption = {
	id: string;
	displayName: string;
	description?: string;
	paramsSchema: PiboJsonObject | null;
	aliases: string[];
	source: "custom" | "global";
	visibility: "global";
	archived: false;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
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
	paramsSchema: PiboJsonObject | null;
	inputSchema: PiboJsonObject | null;
	outputSchema: PiboJsonObject | null;
};

type WorkflowHandlerPickerResponse = {
	kind: "handlers";
	options: WorkflowHandlerPickerOption[];
	selectedHandlerId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

type WorkflowCreateDraftResponse = {
	draft: WorkflowDraftRecord;
	builderPath: string;
};


type WorkflowDuplicateBody = {
	version?: unknown;
};

type WorkflowNextDraftBody = {
	version?: unknown;
};

type WorkflowArchiveBody = {
	reason?: unknown;
};

type WorkflowDeleteBody = {
	confirmWorkflowId?: unknown;
};

type WorkflowCreateDraftBody = {
	workflowId?: unknown;
	title?: unknown;
	description?: unknown;
	tags?: unknown;
	definition?: unknown;
};

type WorkflowDraftValidateBody = {
	trigger?: unknown;
};

type WorkflowDraftPublishBody = {
	versionIntent?: unknown;
};

type WorkflowPromptAssetSaveBody = {
	assetId?: unknown;
	sourceRefId?: unknown;
	displayName?: unknown;
	description?: unknown;
	markdown?: unknown;
};



type ChatProjectsBootstrap = ChatBootstrapCatalog & {
	identity: PiboWebSession["authSession"]["identity"];
	sharedDefaultProject: PiboProject;
	project?: PiboProject;
	projects: PiboProject[];
	projectSessions: PiboProjectSession[];
	workflowLifecycleEvents: WorkflowLifecycleEventRecord[];
	session?: PiboSession;
	selectedProjectId: string;
	selectedPiboSessionId?: string;
	sessions: PiboWebSessionNode[];
};

type ChatEventCursor = {
	streamId: number;
	frameIndex: number;
};

type ChatEventStreamMode = "live" | "summary";

type TransientChatEvent = {
	roomId?: string;
	piboSessionId?: string;
	eventType: string;
	payload: PiboOutputEvent;
	replaySequence?: number;
};

type ChatLiveEvent = StoredChatEvent | TransientChatEvent;

type TransientChatReplayRecord = TransientChatEvent & {
	replaySequence: number;
	createdAtMs: number;
};

type TransientReplayStatus = {
	requestedAfter: number;
	replayed: number;
	missed: boolean;
	evictedBefore?: number;
	oldestAvailable?: number;
	newestAvailable?: number;
	bufferSize: number;
	maxEvents: number;
};

type PiboRoomNodeWithUnread = PiboRoom & {
	unreadCount?: number;
	children: PiboRoomNodeWithUnread[];
};

const TRACE_CACHE_MAX_ENTRIES = 24;
const TRACE_V1_COMPAT_MAX_EVENTS_PER_REQUEST = DEFAULT_TRACE_EVENTS_PAGE_SIZE;
const TRACE_TIMELINE_PAGE_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const TRANSIENT_REPLAY_BUFFER_MAX_EVENTS = 1000;
const TRANSIENT_REPLAY_BUFFER_MAX_BYTES = 2 * 1024 * 1024;
const RELIABILITY_INLINE_PAYLOAD_MAX_BYTES = 64 * 1024;
const RESOURCE_WARNING_RING_MAX = 25;

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
	requireSameOriginRequest(request, "application/json");
}

function requireSameOriginMultipartRequest(request: Request): void {
	requireSameOriginRequest(request, "multipart/form-data");
}

function requireSameOriginRequest(request: Request, expectedContentType: string): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== expectedContentType) {
		throw new PiboWebHttpError(`Content-Type must be ${expectedContentType}`, 415);
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

function auditActorIdFor(webSession: PiboWebSession): string {
	return webSession.authSession.identity.userId;
}

function recordWorkflowLifecycleEvent(
	state: ChatWebAppState,
	webSession: PiboWebSession,
	input: Omit<WorkflowLifecycleEventInput, "actorId"> & { actorId?: string },
): WorkflowLifecycleEventRecord {
	return state.workflowLifecycleEventStore.record({
		...input,
		actorId: input.actorId ?? auditActorIdFor(webSession),
	});
}

let defaultChatWebAnnotationStore: WebAnnotationStore | undefined;

function getChatWebAnnotationStore(): WebAnnotationStore {
	defaultChatWebAnnotationStore ??= createDefaultWebAnnotationStore();
	return defaultChatWebAnnotationStore;
}

function prepareWebAnnotationAttachments(input: {
	piboSessionId: string;
	messageText: string;
	attachmentIds: unknown;
}): PreparedWebAnnotationAttachments {
	try {
		return prepareWebAnnotationMessageAttachments({
			store: getChatWebAnnotationStore(),
			piboSessionId: input.piboSessionId,
			messageText: input.messageText,
			attachmentIds: input.attachmentIds,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = /not available for this session/.test(message) ? 404 : 400;
		throw new PiboWebHttpError(message, status);
	}
}

function markWebAnnotationsAttached(prepared: PreparedWebAnnotationAttachments): void {
	if (!prepared.annotations.length) return;
	const store = getChatWebAnnotationStore();
	for (const annotation of prepared.annotations) {
		if (annotation.status !== "attached") {
			store.patchAnnotation(annotation.piboSessionId, annotation.id, { status: "attached" });
		}
	}
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

function createReliabilityStore(path?: string): PiboReliabilityStore {
	return path ? new PiboReliabilityStore(path) : createDefaultPiboReliabilityStore();
}

function createDataStore(options: ChatWebAppOptions): PiboDataStore {
	return new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
}

function createPersistenceMetrics(): ChatPersistenceMetrics {
	return { eventCount: 0, errorCount: 0, totalIndexingMs: 0, maxIndexingMs: 0 };
}

function createResourceMetrics(): ChatGatewayResourceMetrics {
	return {
		reliabilityPayloadWrites: { inline: 0, over_64kb: 0, over_1mb: 0, over_10mb: 0 },
		reliabilityPayloadExternalized: 0,
		recentWarnings: [],
	};
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

function pushResourceWarning(metrics: ChatGatewayResourceMetrics, message: string): void {
	metrics.recentWarnings.push({ at: new Date().toISOString(), message });
	while (metrics.recentWarnings.length > RESOURCE_WARNING_RING_MAX) metrics.recentWarnings.shift();
}

function serializeGatewayResourceDiagnostics(state: ChatWebAppState) {
	const memory = process.memoryUsage();
	const activeEventStreams = [...state.activeEventStreams.values()].reduce((total, streams) => total + streams.size, 0);
	return {
		memory: {
			heapUsed: memory.heapUsed,
			heapTotal: memory.heapTotal,
			rss: memory.rss,
			external: memory.external,
			arrayBuffers: memory.arrayBuffers,
		},
		eventLoopDelay: {
			meanMs: Number.isFinite(state.eventLoopDelay.mean) ? state.eventLoopDelay.mean / 1_000_000 : 0,
			maxMs: Number.isFinite(state.eventLoopDelay.max) ? state.eventLoopDelay.max / 1_000_000 : 0,
			p95Ms: state.eventLoopDelay.percentile(95) / 1_000_000,
		},
		streams: {
			liveListeners: state.liveListeners.size,
			activeEventStreams,
			activeTraceSessions: state.activeTraceSessions.size,
		},
		traceCache: {
			entries: state.traceCache.size,
			estimatedBytes: traceCacheEstimatedBytes(state.traceCache),
		},
		traceTimelinePageCache: {
			entries: state.traceTimelinePageCache.size,
			estimatedBytes: traceTimelinePageCacheEstimatedBytes(state.traceTimelinePageCache),
			maxBytes: TRACE_TIMELINE_PAGE_CACHE_MAX_BYTES,
		},
		transientReplay: {
			events: state.transientReplayBuffer.length,
			estimatedBytes: state.transientReplayBufferBytes,
			maxEvents: TRANSIENT_REPLAY_BUFFER_MAX_EVENTS,
			maxBytes: TRANSIENT_REPLAY_BUFFER_MAX_BYTES,
		},
		reliabilityPayloads: state.resourceMetrics.reliabilityPayloadWrites,
		reliabilityPayloadExternalized: state.resourceMetrics.reliabilityPayloadExternalized,
		recentWarnings: state.resourceMetrics.recentWarnings,
	};
}

function setTraceTimelinePageCache(
	cache: Map<string, TraceTimelinePage>,
	key: string,
	page: TraceTimelinePage,
	maxEntries = TRACE_CACHE_MAX_ENTRIES,
	maxBytes = TRACE_TIMELINE_PAGE_CACHE_MAX_BYTES,
): void {
	cache.delete(key);
	cache.set(key, page);
	while (cache.size > maxEntries || traceTimelinePageCacheEstimatedBytes(cache) > maxBytes) {
		const oldestKey = cache.keys().next().value;
		if (typeof oldestKey !== "string") break;
		cache.delete(oldestKey);
	}
}

function traceTimelinePageCacheEstimatedBytes(cache: ReadonlyMap<string, TraceTimelinePage>): number {
	let bytes = 0;
	for (const page of cache.values()) bytes += Buffer.byteLength(JSON.stringify(page), "utf8");
	return bytes;
}

function createFastTraceV2Version(input: {
	session: PiboSession;
	sessions: PiboSession[];
	lastEventSequence: number;
	lastActivityAt?: string;
	status?: PiboWebSessionStatus;
	latestStreamId?: number;
	transcript?: {
		sessionSize?: number;
		sessionMtimeMs?: number;
		modified?: string;
	};
}): string {
	const relevantSessions = input.sessions
		.map((session) => ({
			id: session.id,
			parentId: session.parentId ?? null,
			originId: session.originId ?? null,
			updatedAt: session.updatedAt,
			title: session.title ?? null,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	return createHash("sha1")
		.update(JSON.stringify({
			session: {
				id: input.session.id,
				piSessionId: input.session.piSessionId,
				profile: input.session.profile,
				title: input.session.title ?? null,
				updatedAt: input.session.updatedAt,
			},
			status: input.status ?? "idle",
			events: {
				lastSequence: input.lastEventSequence,
				lastActivityAt: input.lastActivityAt ?? null,
				latestStreamId: input.latestStreamId ?? null,
			},
			transcript: {
				sessionSize: input.transcript?.sessionSize ?? null,
				sessionMtimeMs: input.transcript?.sessionMtimeMs ?? null,
				modified: input.transcript?.modified ?? null,
			},
			sessions: relevantSessions,
		}))
		.digest("hex");
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
				const transient = recordTransientReplayEvent(state, { roomId: room?.id, piboSessionId: liveEvent.piboSessionId, eventType: liveEvent.type, payload: liveEvent });
				if (isLiveOnlyOutputEvent(liveEvent) && !hasLiveObserver(state, liveEvent.piboSessionId)) continue;
				for (const listener of state.liveListeners) {
					listener(transient);
				}
			}
			for (const persistableEvent of result.persistedEvents) {
				if (!isPersistableOutputEvent(persistableEvent)) continue;
				let stored = state.eventCommands.appendOutputEvent(persistableEvent, {
					roomId: room?.id,
					actorId: session?.id,
				});
				if (!stored && session) {
					try {
						const createdAt = new Date().toISOString();
						const ingested = state.ingestService.ingestOutputEvent({
							session,
							roomId: room?.id,
							actorId: session.id,
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
							actorId: session.id,
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
					payload: boundedReliabilityOutputPayload(state, persistableEvent),
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

function boundedReliabilityOutputPayload(state: ChatWebAppState, event: PiboOutputEvent): PiboJsonValue {
	const bytes = estimateJsonBytes(event);
	recordReliabilityPayloadBucket(state.resourceMetrics, bytes);
	if (bytes <= RELIABILITY_INLINE_PAYLOAD_MAX_BYTES) return event as PiboJsonValue;

	const compacted = compactLargeOutputEventFields(state, event);
	const compactedBytes = estimateJsonBytes(compacted);
	if (compactedBytes <= RELIABILITY_INLINE_PAYLOAD_MAX_BYTES) {
		state.resourceMetrics.reliabilityPayloadExternalized += 1;
		return compacted;
	}

	const payload = state.dataStore.payloads.writePayload({
		value: toPiboJsonValue(event),
		contentType: "application/json",
		retentionClass: reliabilityRetentionClassForOutputEvent(event),
	});
	state.resourceMetrics.reliabilityPayloadExternalized += 1;
	pushResourceWarning(state.resourceMetrics, `Externalized over-budget reliability payload for ${event.type} (${bytes} bytes).`);
	return {
		type: event.type,
		piboSessionId: event.piboSessionId,
		eventId: "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined,
		payloadRef: payload.id,
		payloadBytes: payload.byteSize,
		preview: payload.previewText,
		truncated: true,
	} as PiboJsonValue;
}

function recordReliabilityPayloadBucket(metrics: ChatGatewayResourceMetrics, bytes: number): void {
	if (bytes > 10 * 1024 * 1024) metrics.reliabilityPayloadWrites.over_10mb += 1;
	else if (bytes > 1024 * 1024) metrics.reliabilityPayloadWrites.over_1mb += 1;
	else if (bytes > RELIABILITY_INLINE_PAYLOAD_MAX_BYTES) metrics.reliabilityPayloadWrites.over_64kb += 1;
	else metrics.reliabilityPayloadWrites.inline += 1;
}

function compactLargeOutputEventFields(state: ChatWebAppState, event: PiboOutputEvent): PiboJsonValue {
	if (!event || typeof event !== "object" || Array.isArray(event)) return event as PiboJsonValue;
	const result: Record<string, unknown> = { ...event };
	for (const key of ["result", "partialResult", "text", "args", "errorDetails"]) {
		if (!(key in result)) continue;
		const value = result[key];
		if (value === undefined || value === null || estimateJsonBytes(value) <= RELIABILITY_INLINE_PAYLOAD_MAX_BYTES / 2) continue;
		const payload = state.dataStore.payloads.writePayload({
			value: toPiboJsonValue(value),
			contentType: typeof value === "string" ? "text/plain; charset=utf-8" : "application/json",
			retentionClass: reliabilityRetentionClassForOutputEvent(event),
		});
		result[`${key}PayloadRef`] = payload.id;
		result[`${key}PayloadBytes`] = payload.byteSize;
		result[`${key}Preview`] = payload.previewText;
		result[key] = typeof value === "string" ? payload.previewText ?? "" : undefined;
	}
	return toPiboJsonValue(result);
}

function toPiboJsonValue(value: unknown): PiboJsonValue {
	return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
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

function markEventStreamConnected(state: ChatWebAppState, piboSessionId: string, streamId: string): void {
	const streams = state.activeEventStreams.get(piboSessionId) ?? new Set<string>();
	streams.add(streamId);
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

function hasLiveObserver(state: ChatWebAppState, piboSessionId: string): boolean {
	return (state.activeEventStreams.get(piboSessionId)?.size ?? 0) > 0;
}

function listLiveObservers(state: ChatWebAppState): Array<{ piboSessionId: string; count: number }> {
	return Array.from(state.activeEventStreams.entries())
		.map(([piboSessionId, streams]) => ({ piboSessionId, count: streams.size }))
		.filter((observer) => observer.count > 0);
}

function markActiveSessionRead(state: ChatWebAppState, piboSessionId: string, streamId: number): void {
	if (!state.activeEventStreams.get(piboSessionId)?.size) return;
	state.readState.markSessionRead(piboSessionId, streamId);
}

function listSharedSessions(context: PiboWebAppContext): PiboSession[] {
	const sessions = context.channelContext.listSessions?.() ?? context.channelContext.findSessions({});
	return sessions
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

function visibleSharedSessions(
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
	const defaultRoom = input.state.roomService.ensureDefaultRoom();
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
	return visibleSharedSessions(roomSessions, input.selectedSession, input.includeArchived);
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
		: state.roomService.ensureDefaultRoom();
	const existing = listSharedSessions(context).find(
		(session) =>
			!session.parentId &&
			!isChatWebSessionArchived(session) &&
			chatRoomIdFromMetadata(session.metadata) === room.id,
	);
	if (existing) return existing;
	if (isPiboRoomArchived(room)) {
		const archivedExisting = listSharedSessions(context).find(
			(session) => !session.parentId && chatRoomIdFromMetadata(session.metadata) === room.id,
		);
		if (archivedExisting) return archivedExisting;
		throw new PiboWebHttpError("Archived room has no sessions", 404);
	}
	return createSharedChatSession(context, webSession, defaultProfile, room);
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
	void webSession;
	const room = state.roomService.ensureDefaultRoom();
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
		room = state.roomService.requireRoom(roomId);
	} catch (error) {
		accessDenied(error);
	}
	if (action === "write" && isPiboRoomArchived(room)) {
		throw new PiboWebHttpError("Archived rooms are read-only", 403);
	}
	return room;
}

function listSharedProjects(state: ChatWebAppState, _webSession: PiboWebSession, options: { includeArchived?: boolean } = {}): PiboProject[] {
	return state.projectService.listProjects(options);
}

function requireSharedProject(
	state: ChatWebAppState,
	_webSession: PiboWebSession,
	projectId: string,
	options: { includeArchived?: boolean } = {},
): PiboProject {
	try {
		return state.projectService.requireProject(projectId, options);
	} catch {
		throw new PiboWebHttpError("Project not found", 404);
	}
}

function createSharedChatSession(
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	profile: string,
	room: PiboRoom,
): PiboSession {
	return context.channelContext.createSession({
		channel: CHAT_WEB_CHANNEL,
		kind: "chat",
		profile,
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
	return workflowVersionPickerOptionFromCatalogRecord({ ...selected, status: "published" });
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

function normalizeWorkflowArchiveReason(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw new PiboWebHttpError("Workflow archive reason must be a string", 400);
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 500) : undefined;
}

function normalizeWorkflowDraftTitle(value: unknown, fallback?: string): string {
	const source = value === undefined || value === null || value === "" ? fallback : value;
	if (typeof source !== "string") throw new PiboWebHttpError("Workflow title must be a string", 400);
	const title = source.replace(/\s+/g, " ").trim();
	if (!title) throw new PiboWebHttpError("Workflow title is required", 400);
	if (title.length > 160) throw new PiboWebHttpError("Workflow title is too long", 400);
	return title;
}

function normalizeWorkflowDraftDescription(value: unknown, fallback?: string): string | undefined {
	const source = value === undefined || value === null || value === "" ? fallback : value;
	if (source === undefined || source === null || source === "") return undefined;
	if (typeof source !== "string") throw new PiboWebHttpError("Workflow description must be a string", 400);
	const description = source.replace(/\s+/g, " ").trim();
	if (!description) return undefined;
	if (description.length > 1000) throw new PiboWebHttpError("Workflow description is too long", 400);
	return description;
}

function normalizeWorkflowDraftTags(value: unknown, fallback: string[] = []): string[] {
	const source = value === undefined || value === null ? fallback : value;
	if (!Array.isArray(source)) throw new PiboWebHttpError("Workflow tags must be an array of strings", 400);
	return [...new Set(source.map((tag) => {
		if (typeof tag !== "string") throw new PiboWebHttpError("Workflow tags must be strings", 400);
		return tag.replace(/\s+/g, " ").trim();
	}).filter(Boolean))].slice(0, 20);
}

function normalizeWorkflowCreateWorkflowId(value: unknown, fallbackTitle: string): string {
	const source = value === undefined || value === null || value === ""
		? `ui-${workflowSlugFromTitle(fallbackTitle)}-${randomUUID().slice(0, 8)}`
		: value;
	if (typeof source !== "string") throw new PiboWebHttpError("Workflow id must be a string", 400);
	const workflowId = source.trim();
	if (!workflowId) throw new PiboWebHttpError("Workflow id is required", 400);
	if (workflowId.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workflowId)) {
		throw new PiboWebHttpError("Workflow id may contain only letters, numbers, dots, underscores, and dashes", 400);
	}
	return workflowId;
}

function workflowSlugFromTitle(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	return slug || "workflow";
}

function requireWorkflowDeleteConfirmation(value: unknown, workflowId: string): void {
	if (typeof value !== "string" || value.trim() !== workflowId) {
		throw new PiboWebHttpError(`Type "${workflowId}" to delete this workflow.`, 400);
	}
}

const PROJECT_SESSION_PATCH_FIELDS = new Set([
	"title",
	"archived",
]);

function validateProjectWorkflowSnapshotForStart(
	snapshot: PiboProjectWorkflowSessionSnapshot,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
): WorkflowValidationResponse {
	const diagnostics = sanitizeWorkflowDiagnostics(validateWorkflowDefinitionForV2(snapshot.effectiveDefinition, input));
	return {
		diagnostics,
		validation: summarizeWorkflowDiagnostics(diagnostics, "before_workflow_start"),
	};
}

function updateProjectWorkflowRunSessionMetadata(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	session: PiboSession;
	workflowRunId: string;
}): void {
	if (input.session.metadata?.workflowRunId === input.workflowRunId) return;
	const updateSession = input.context.channelContext.updateSession;
	if (!updateSession) return;
	const updated = updateSession(input.session.id, {
		metadata: {
			...(input.session.metadata ?? {}),
			workflowRunId: input.workflowRunId,
		},
	});
	if (updated) input.state.sessionQuery.upsertSession(updated);
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

function parseNonNegativeIntSearchParam(url: URL, name: string, fallback: number, max: number): number {
	const raw = url.searchParams.get(name);
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.min(parsed, max);
}

function parseOptionalPositiveIntSearchParam(url: URL, name: string): number | undefined {
	const raw = url.searchParams.get(name);
	if (!raw) return undefined;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new PiboWebHttpError(`${name} must be a positive integer`, 400);
	return parsed;
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

function requireAgentProfileNameAvailable(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	profileName: string,
	currentAgentId?: string,
): void {
	const currentAgent = currentAgentId ? state.agentStore.get(currentAgentId) : undefined;
	if (currentAgent?.profileName === profileName) return;
	for (const agent of state.agentStore.list({ includeArchived: true })) {
		if (agent.id !== currentAgentId && agent.profileName === profileName) {
			throw new PiboWebHttpError(`Agent name "${profileName}" already exists`, 400);
		}
	}
	const matchedProfile = context.channelContext.getProfiles?.().find(
		(profile) => profile.name === profileName || profile.aliases.includes(profileName),
	);
	if (matchedProfile && matchedProfile.name !== currentAgent?.profileName) throw new PiboWebHttpError(`Agent name "${profileName}" conflicts with an existing profile`, 400);
}

function requireSharedAgent(agent: CustomAgentDefinition | undefined): CustomAgentDefinition {
	if (!agent) {
		throw new PiboWebHttpError("Agent not found", 404);
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
	_webSession: PiboWebSession,
	selectedProfileId?: string,
): WorkflowProfilePickerResponse {
	const customAgents = state.agentStore.list({ includeArchived: true });
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
			paramsSchema: null,
			aliases: [],
			source: "custom",
			visibility: "global",
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
			paramsSchema: null,
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
				message: `Agent node references Agent Designer profile '${normalizedSelection}', but it is not available in the app context.`,
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
		paramsSchema: null,
		inputSchema: null,
		outputSchema: null,
	},
	{
		id: "fixture.handlers.reviseDraft",
		displayName: "Revise draft",
		description: "Registered code handler that applies review feedback to a draft payload.",
		paramsSchema: null,
		inputSchema: null,
		outputSchema: null,
	},
	{
		id: "fixture.handlers.summarizeDecision",
		displayName: "Summarize decision",
		description: "Registered code handler that normalizes a review decision into a workflow summary.",
		paramsSchema: null,
		inputSchema: null,
		outputSchema: null,
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

function saveWorkflowPromptAssetRevision(
	state: ChatWebAppState,
	webSession: PiboWebSession,
	body: WorkflowPromptAssetSaveBody,
): WorkflowPromptAssetDocument {
	const markdown = typeof body.markdown === "string" ? body.markdown : undefined;
	if (markdown === undefined) throw new PiboWebHttpError("Workflow prompt asset markdown is required", 400);
	const requestedAssetId = typeof body.assetId === "string" && body.assetId.trim() ? body.assetId.trim() : undefined;
	const sourceRefId = typeof body.sourceRefId === "string" && body.sourceRefId.trim() ? body.sourceRefId.trim() : undefined;
	if (requestedAssetId && !requestedAssetId.startsWith("ui.promptAssets.")) {
		throw new PiboWebHttpError("Only managed UI prompt assets can receive new revisions", 400);
	}
	if (!requestedAssetId && sourceRefId && !isWorkflowPromptAssetRegistered(state, webSession, sourceRefId)) {
		throw new PiboWebHttpError(`Workflow prompt asset '${sourceRefId}' is not registered`, 404);
	}
	const sourceDocument = sourceRefId ? getWorkflowPromptAssetDocument(state, webSession, sourceRefId) : undefined;
	const displayName = normalizeWorkflowPromptAssetLabel(body.displayName ?? (sourceDocument ? `${sourceDocument.displayName} copy` : undefined));
	const description = typeof body.description === "string" && body.description.trim()
		? body.description.trim()
		: sourceDocument?.description ?? "Managed Workflow Builder prompt asset revision.";
	return state.workflowPromptAssetStore.saveRevision({
		assetId: requestedAssetId,
		displayName,
		description,
		markdown,
		actorId: webSession.authSession.identity.userId,
	});
}

function createWorkflowDraftIdentity(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	body: WorkflowCreateDraftBody,
): WorkflowCreateDraftResponse {
	const inputDefinition = body.definition === undefined ? undefined : normalizeWorkflowCreateDefinition(body.definition);
	const fallbackTitle = inputDefinition && typeof inputDefinition.title === "string" ? inputDefinition.title : undefined;
	const title = normalizeWorkflowDraftTitle(body.title, fallbackTitle);
	const workflowId = normalizeWorkflowCreateWorkflowId(body.workflowId ?? inputDefinition?.id, title);
	const description = normalizeWorkflowDraftDescription(body.description, inputDefinition && typeof inputDefinition.description === "string" ? inputDefinition.description : undefined);
	const tags = normalizeWorkflowDraftTags(body.tags, inputDefinition ? workflowDefinitionTags(inputDefinition) : ["ui-draft"]);
	assertWorkflowCreateIdentityAvailable(state, context, webSession, workflowId);

	const now = new Date().toISOString();
	const draftId = `draft_${workflowId.replace(/[^a-zA-Z0-9_-]/g, "-")}_${randomUUID().slice(0, 8)}`;
	const definition = inputDefinition
		? workflowCreateDefinitionWithIdentity(inputDefinition, { workflowId, title, description, tags })
		: createEmptyWorkflowDraftDefinition({ workflowId, title, description, tags });
	const draft: WorkflowDraftRecord = {
		draftId,
		workflowId,
		source: "ui",
		status: "draft",
		versionIntent: "patch",
		definition,
		diagnostics: [
			{
				code: "WorkflowBuilderInfo.createdDraft",
				message: `Created UI workflow draft '${workflowId}'.`,
				severity: "info",
				path: "$.id",
				hint: "Drafts may be incomplete until validation passes before publish or run.",
			},
		],
		validationState: "warning",
		revision: 1,
		createdAt: now,
		updatedAt: now,
	};
	state.workflowDraftStore.saveDraft(draft);
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.draft.saved",
		workflowId: draft.workflowId,
		workflowVersion: typeof draft.definition.version === "string" ? draft.definition.version : undefined,
		draftId: draft.draftId,
		status: "saved",
		diagnostics: draft.diagnostics,
		payload: { operation: "create" },
	});
	runWorkflowDraftValidation(state, context, webSession, draft, "draft_load");
	return { draft: serializeWorkflowDraft(draft), builderPath: workflowDraftBuilderPath(draft.draftId) };
}

function normalizeWorkflowCreateDefinition(value: unknown): PiboJsonObject {
	if (!isJsonObject(value)) throw new PiboWebHttpError("Workflow definition must be a JSON object", 400);
	return cloneJsonObject(value);
}

function assertWorkflowCreateIdentityAvailable(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowId: string,
): void {
	if (state.workflowTombstoneStore.getWorkflowTombstone(workflowId)) throw new PiboWebHttpError("Workflow id has been deleted", 409);
	const existing = buildWorkflowCatalogList(state, context, webSession, { includeArchived: true }).workflows.find((record) => record.id === workflowId);
	if (existing || state.workflowDraftStore.findActiveDraftByWorkflowId(workflowId) || state.workflowPublishedVersionStore.listPublishedVersions({ workflowId }).length) {
		throw new PiboWebHttpError(`Workflow '${workflowId}' already exists`, 409);
	}
}

function workflowCreateDefinitionWithIdentity(
	definition: PiboJsonObject,
	input: { workflowId: string; title: string; description?: string; tags: string[] },
): PiboJsonObject {
	const next = cloneJsonObject(definition);
	next.id = input.workflowId;
	if (typeof next.version !== "string" || !next.version.trim()) next.version = "0.1.0-draft";
	next.title = input.title;
	if (input.description) next.description = input.description;
	else delete next.description;
	next.metadata = workflowMetadataWithTags(next.metadata, input.tags);
	if (!isJsonObject(next.nodes)) next.nodes = {};
	if (!isJsonObject(next.edges)) next.edges = {};
	if (!isJsonObject(next.ui)) next.ui = { layout: "auto", positions: {} };
	return next;
}

function createEmptyWorkflowDraftDefinition(input: { workflowId: string; title: string; description?: string; tags: string[] }): PiboJsonObject {
	return {
		id: input.workflowId,
		version: "0.1.0-draft",
		title: input.title,
		...(input.description ? { description: input.description } : {}),
		metadata: { tags: input.tags },
		nodes: {},
		edges: {},
		ui: { layout: "auto", positions: {} },
	};
}

function workflowMetadataWithTags(value: unknown, tags: string[]): PiboJsonObject {
	const metadata = isJsonObject(value) ? cloneJsonObject(value) : {};
	metadata.tags = tags;
	return metadata;
}

const WORKFLOW_STARTER_DRAFT_ID = "v2-starter-draft";

function workflowDraftBuilderPath(draftId: string): string {
	return `${CHAT_WEB_MOUNT_PATH}/workflows/drafts/${encodeURIComponent(draftId)}`;
}

function serializeWorkflowDraft(record: WorkflowDraftRecord): WorkflowDraftRecord {
	return {
		...record,
		diagnostics: sanitizeWorkflowDiagnostics(record.diagnostics),
	};
}

function getWorkflowCatalogServices(): WorkflowCatalogServices<ChatWebAppState> {
	return {
		validateDefinition: validateWorkflowDefinitionForV2,
		summarizeDiagnostics: summarizeWorkflowDiagnostics,
		runDraftValidation: runWorkflowDraftValidation,
		serializeDraft: serializeWorkflowDraft,
	};
}

function buildWorkflowCatalogList(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	options: { includeArchived?: boolean } = {},
): WorkflowCatalogListResponse {
	return buildWorkflowCatalogListWithServices(state, context, webSession, getWorkflowCatalogServices(), options);
}

function buildWorkflowCatalogInspect(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowId: string,
	options: { includeArchived?: boolean; version?: string; draftId?: string } = {},
): WorkflowCatalogInspectResponse {
	return buildWorkflowCatalogInspectWithServices(state, context, webSession, getWorkflowCatalogServices(), workflowId, options);
}

function buildWorkflowVersionList(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowId: string,
	options: { includeArchived?: boolean } = {},
): WorkflowVersionListResponse {
	return buildWorkflowVersionListWithServices(state, context, webSession, getWorkflowCatalogServices(), workflowId, options);
}

function buildWorkflowVersionInspect(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowId: string,
	version: string,
	options: { includeArchived?: boolean } = {},
): WorkflowVersionInspectResponse {
	return buildWorkflowVersionInspectWithServices(state, context, webSession, getWorkflowCatalogServices(), workflowId, version, options);
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
	const draft: WorkflowDraftRecord = {
		draftId,
		workflowId: copyWorkflowId,
		source: "ui",
		status: "draft",
		baseWorkflowId: published.id,
		baseWorkflowVersion: published.version,
		baseDefinitionHash: published.definitionHash,
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
	};
	state.workflowDraftStore.saveDraft(draft);
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.draft.saved",
		workflowId: draft.workflowId,
		workflowVersion: draft.baseWorkflowVersion,
		draftId: draft.draftId,
		status: "saved",
		diagnostics: draft.diagnostics,
		payload: {
			operation: "duplicate",
			baseWorkflowId: published.id,
			baseWorkflowVersion: published.version,
		},
	});
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
	const draft: WorkflowDraftRecord = {
		draftId,
		workflowId: published.id,
		source: "ui",
		status: "draft",
		baseWorkflowId: published.id,
		baseWorkflowVersion: published.version,
		baseDefinitionHash: published.definitionHash,
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
	};
	state.workflowDraftStore.saveDraft(draft);
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.draft.saved",
		workflowId: draft.workflowId,
		workflowVersion: draft.baseWorkflowVersion,
		draftId: draft.draftId,
		status: "saved",
		diagnostics: draft.diagnostics,
		payload: {
			operation: "edit_published",
			baseWorkflowId: published.id,
			baseWorkflowVersion: published.version,
			targetWorkflowVersion,
		},
	});
	return { draft: serializeWorkflowDraft(draft), reused: false };
}

function archiveWorkflowIdentity(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowIdValue: unknown,
	reasonValue: unknown,
): { workflow: WorkflowCatalogRecord; archiveState: WorkflowArchiveStateRecord } {
	const workflowId = normalizeProjectWorkflowId(workflowIdValue);
	const catalog = buildWorkflowCatalogList(state, context, webSession, { includeArchived: true });
	const workflow = catalog.workflows.find((record) => record.id === workflowId);
	if (!workflow) throw new PiboWebHttpError("Workflow not found", 404);
	if (workflow.source !== "ui") {
		throw new PiboWebHttpError("Code workflow projections are read-only; duplicate them to a UI draft before archiving", 409);
	}
	const archiveState = state.workflowArchiveStore.setWorkflowArchived({
		workflowId,
		archivedBy: auditActorIdFor(webSession),
		archiveReason: normalizeWorkflowArchiveReason(reasonValue),
	});
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.archive.updated",
		workflowId,
		status: "accepted",
		diagnostics: [],
		payload: {
			archived: true,
			archiveReason: archiveState.archiveReason ?? null,
			archiveScope: "workflow_identity",
		},
	});
	const archivedWorkflow = buildWorkflowCatalogList(state, context, webSession, { includeArchived: true }).workflows.find((record) => record.id === workflowId);
	if (!archivedWorkflow) throw new PiboWebHttpError("Archived workflow not found", 500);
	return { workflow: archivedWorkflow, archiveState };
}

function deleteWorkflowIdentity(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	workflowIdValue: unknown,
	body: WorkflowDeleteBody,
): { workflowId: string; deleted: true; tombstone: WorkflowTombstoneRecord } {
	const workflowId = normalizeProjectWorkflowId(workflowIdValue);
	const catalog = buildWorkflowCatalogList(state, context, webSession, { includeArchived: true });
	const workflow = catalog.workflows.find((record) => record.id === workflowId);
	if (!workflow) throw new PiboWebHttpError("Workflow not found", 404);
	if (workflow.source !== "ui") {
		throw new PiboWebHttpError("Code workflow projections are read-only; duplicate them to a UI draft before deleting", 409);
	}
	requireWorkflowDeleteConfirmation(body.confirmWorkflowId, workflow.id);
	const displayVersion = selectWorkflowCatalogDisplayVersion(workflow.versions);
	const tombstone = state.workflowTombstoneStore.setWorkflowDeleted({
		workflowId,
		deletedBy: auditActorIdFor(webSession),
		lastKnownTitle: workflow.title,
		...(displayVersion?.version ? { lastKnownVersion: displayVersion.version } : {}),
		...(displayVersion?.definitionHash ? { lastDefinitionHash: displayVersion.definitionHash } : {}),
	});
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.delete.tombstoned",
		workflowId,
		workflowVersion: tombstone.lastKnownVersion,
		status: "accepted",
		diagnostics: [],
		payload: {
			deleted: true,
			lastKnownTitle: tombstone.lastKnownTitle,
			lastKnownVersion: tombstone.lastKnownVersion ?? null,
			lastDefinitionHash: tombstone.lastDefinitionHash ?? null,
		},
	});
	return { workflowId, deleted: true, tombstone };
}

function selectPublishedWorkflowVersion(state: ChatWebAppState, workflowId: string, version?: string): WorkflowPublishedVersionSelection | undefined {
	const options = buildProjectWorkflowVersionOptions(state).filter((option) => option.id === workflowId);
	const selected = version ? options.find((option) => option.version === version) : options[0];
	if (!selected) return undefined;
	return resolvePublishedWorkflowDefinitionForProfile(state, selected, "base");
}

function resolvePublishedWorkflowDefinitionForProfile(
	state: ChatWebAppState,
	workflow: WorkflowVersionPickerOption,
	profileId: string,
): WorkflowPublishedVersionSelection {
	const persisted = state.workflowPublishedVersionStore
		.listPublishedVersions({ workflowId: workflow.id })
		.find((record) => record.version === workflow.version);
	if (persisted) {
		return {
			...workflow,
			definition: cloneJsonObject(persisted.definition),
			definitionHash: persisted.definitionHash,
		};
	}

	const definition = createPublishedWorkflowDefinition(workflow, profileId);
	return {
		...workflow,
		definition,
		definitionHash: hashWorkflowDefinitionJson(definition),
	};
}

function nextPatchWorkflowVersion(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
	if (!match) return `${version}.1`;
	return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function createStarterWorkflowDraft(webSession: PiboWebSession): WorkflowDraftRecord {
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
	};
}

function createDraftDefinitionFromPublishedWorkflow(workflow: WorkflowPublishedVersionSelection): PiboJsonObject {
	return clonePublishedWorkflowDefinitionForDraft(workflow, {
		workflowId: `ui-${workflow.id}-copy`,
		version: `${workflow.version}-draft`,
		title: `${workflow.title} Draft`,
		description: workflow.description ?? `UI draft copied from ${workflow.id}@${workflow.version}.`,
		tags: ["ui-draft", ...workflow.tags],
		migrationNotes: `Duplicated from ${workflow.id}@${workflow.version} for Workflow UI Authoring V2.`,
	});
}

function createNextVersionDraftDefinitionFromPublishedWorkflow(workflow: WorkflowPublishedVersionSelection, targetWorkflowVersion: string): PiboJsonObject {
	return clonePublishedWorkflowDefinitionForDraft(workflow, {
		workflowId: workflow.id,
		version: targetWorkflowVersion,
		title: `${workflow.title} Draft`,
		description: workflow.description ?? `Next-version draft for ${workflow.id}@${workflow.version}.`,
		tags: ["ui-draft", "next-version", ...workflow.tags],
		migrationNotes: `Editing immutable ${workflow.id}@${workflow.version}; next publish targets ${targetWorkflowVersion}.`,
	});
}

function clonePublishedWorkflowDefinitionForDraft(
	workflow: WorkflowPublishedVersionSelection,
	input: {
		workflowId: string;
		version: string;
		title: string;
		description: string;
		tags: string[];
		migrationNotes: string;
	},
): PiboJsonObject {
	const definition = cloneJsonObject(workflow.definition);
	definition.id = input.workflowId;
	definition.version = input.version;
	definition.title = input.title;
	definition.description = input.description;
	delete definition.xstate;

	const existingMetadata = isJsonObject(definition.metadata) ? cloneJsonObject(definition.metadata) : {};
	const existingTags = Array.isArray(existingMetadata.tags) ? existingMetadata.tags.filter((tag): tag is string => typeof tag === "string") : [];
	const existingMigration = isJsonObject(existingMetadata.migration) ? cloneJsonObject(existingMetadata.migration) : {};
	definition.metadata = {
		...existingMetadata,
		tags: [...new Set([...input.tags, ...existingTags])],
		migration: {
			...existingMigration,
			fromWorkflowId: workflow.id,
			fromVersion: workflow.version,
			fromDefinitionHash: workflow.definitionHash,
			notes: input.migrationNotes,
		},
	};
	if (!isJsonObject(definition.ui)) {
		definition.ui = {
			layout: "auto",
			positions: {},
		};
	}
	return definition;
}

function requireMutableWorkflowDraft(state: ChatWebAppState, webSession: PiboWebSession, draftId: string): WorkflowDraftRecord {
	let record = state.workflowDraftStore.getDraft(draftId);
	if (!record && draftId === WORKFLOW_STARTER_DRAFT_ID) {
		record = createStarterWorkflowDraft(webSession);
		state.workflowDraftStore.saveDraft(record);
		recordWorkflowLifecycleEvent(state, webSession, {
			type: "workflow.draft.saved",
			workflowId: record.workflowId,
			workflowVersion: typeof record.definition.version === "string" ? record.definition.version : undefined,
			draftId: record.draftId,
			status: "saved",
			diagnostics: record.diagnostics,
			payload: { operation: "starter" },
		});
	}
	if (!record) throw new PiboWebHttpError("Workflow draft not found", 404);
	if (state.workflowTombstoneStore.getWorkflowTombstone(record.workflowId)) {
		throw new PiboWebHttpError("Workflow has been deleted", 404);
	}
	return record;
}

function runWorkflowDraftValidation(
	state: ChatWebAppState,
	context: PiboWebAppContext,
	webSession: PiboWebSession,
	record: WorkflowDraftRecord,
	trigger: WorkflowValidationTrigger,
): WorkflowValidationResponse {
	const diagnostics = sanitizeWorkflowDiagnostics([
		...record.diagnostics.filter((diagnostic) => !isWorkflowValidationPipelineDiagnostic(diagnostic)),
		...validateWorkflowDefinitionForV2(record.definition, { state, context, webSession }),
	]);
	const validation = summarizeWorkflowDiagnostics(diagnostics, trigger);
	record.diagnostics = diagnostics;
	record.validationState = validation.validationState;
	record.validation = validation;
	record.updatedAt = validation.checkedAt;
	state.workflowDraftStore.saveDraft(record);
	recordWorkflowLifecycleEvent(state, webSession, {
		type: "workflow.validation.completed",
		workflowId: record.workflowId,
		workflowVersion: typeof record.definition.version === "string" ? record.definition.version : undefined,
		draftId: record.draftId,
		status: validation.ok ? "accepted" : "blocked",
		validation,
		diagnostics,
		payload: { trigger: validation.trigger },
	});
	return { validation, diagnostics };
}

function validatePublishedWorkflowBoundary(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	definition: PiboJsonObject;
	trigger: "before_project_session_creation" | "before_workflow_start";
}): WorkflowValidationResponse {
	const diagnostics = sanitizeWorkflowDiagnostics(validateWorkflowDefinitionForV2(input.definition, input));
	return {
		diagnostics,
		validation: summarizeWorkflowDiagnostics(diagnostics, input.trigger),
	};
}

function validateWorkflowDefinitionForV2(
	definition: PiboJsonObject,
	input: { state: ChatWebAppState; context: PiboWebAppContext; webSession: PiboWebSession },
): WorkflowDraftDiagnostic[] {
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	validateWorkflowDefinitionSecurityBoundary(definition, diagnostics);
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

	return sanitizeWorkflowDiagnostics(diagnostics);
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
	if (node.promptBuilder !== undefined) validateWorkflowPromptAssetRefLike(nodeId, node.promptBuilder, input, diagnostics);
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
		diagnosticLabel: `Adapter node '${nodeId}'`,
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
	else validateWorkflowEdgeDirectCompatibilityLike(edgeId, value, nodes, diagnostics);
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
		diagnosticLabel: `Workflow edge '${edgeId}'`,
	});
	validateWorkflowPortLike(value.output, `${path}.output`, diagnostics, { edgeId });
	validateWorkflowEdgeAdapterOutputCompatibilityLike(edgeId, value.output, edge, nodes, diagnostics);
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
		diagnostics: sanitizeWorkflowDiagnostics(response.diagnostics),
		...extra,
	}, { status: 422 });
}

function agentsSelectingPiPackage(state: ChatWebAppState, packageId: string): CustomAgentDefinition[] {
	const pkg = findPiPackage(packageId);
	const aliases = new Set([packageId, ...(pkg ? [pkg.id, pkg.name] : [])]);
	return state.agentStore
		.list({ includeArchived: true })
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
	profileNames: readonly string[],
): string[] {
	const deleteSession = context.channelContext.deleteSession;
	if (!deleteSession) throw new PiboWebHttpError("Session deletion is not available", 501);
	const ownedSessions = listSharedSessions(context);
	const sessionsById = new Map(ownedSessions.map((session) => [session.id, session]));
	const profileNameSet = new Set(profileNames);
	const ids = new Set(ownedSessions.filter((session) => profileNameSet.has(session.profile)).map((session) => session.id));
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
	const ownedSessions = listSharedSessions(context);
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
	if (isDefaultPiboRoom(room)) throw new PiboWebHttpError("Default chat cannot be deleted", 400);
	if (!isPiboRoomArchived(room)) throw new PiboWebHttpError("Archive the room before permanently deleting it.", 400);
	if (confirmName !== room.name) throw new PiboWebHttpError(`Type "${room.name}" to permanently delete this room.`, 400);
	const deleteSession = context.channelContext.deleteSession;
	if (!deleteSession) throw new PiboWebHttpError("Session deletion is not available", 501);
	const rooms = state.roomService.listRoomSubtree(room.id);
	const roomIds = rooms.map((item) => item.id);
	const roomIdSet = new Set(roomIds);
	const ownedSessions = listSharedSessions(context);
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

function requireSharedSession(context: PiboWebAppContext, piboSessionId: string): PiboSession {
	const session = context.channelContext.getSession(piboSessionId);
	if (!session) {
		throw new PiboWebHttpError("Session not found", 404);
	}
	return canonicalizeSessionProfile(context, session);
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
	if (!selected) {
		throw new PiboWebHttpError("Session not found", 404);
	}
	const canonicalSelected = canonicalizeSessionProfile(context, selected);
	const selectedRoom = ensureSessionRoom(state, context, canonicalSelected, webSession);
	if (roomId && selectedRoom.id !== roomId) throw new PiboWebHttpError("Session is not available in this room", 404);
	return canonicalSelected;
}

async function buildContextBuildSnapshotForRequest(input: {
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	piboSessionId?: string;
}) {
	const createProfile = input.context.channelContext.createProfile;
	if (!createProfile) throw new PiboWebHttpError("Profile inspection is not available", 503);
	if (!input.piboSessionId) throw new PiboWebHttpError("piboSessionId is required", 400);

	const selectedSession = requireSharedSession(input.context, input.piboSessionId);
	const profile = createProfile(selectedSession.profile);
	const userSettings = loadPiboUserSettings();
	const cwd = selectedSession?.workspace ?? getDefaultPiboWorkspace();
	return inspectPiboContextBuild({
		cwd,
		profile,
		activeModel: selectedSession?.activeModel,
		persistSession: false,
		sessionContext: {
			piboSessionId: selectedSession?.id,
			piboRoomId: selectedSession ? chatRoomIdFromMetadata(selectedSession.metadata) : undefined,
			timezone: userSettings.timezone,
		},
	});
}

function indexSharedSessions(sessionQuery: ChatSessionQuery, sessions: PiboSession[]): void {
	sessionQuery.upsertSessionsIfChanged(sessions);
}

function markSessionsRead(state: ChatWebAppState, sessions: PiboSession[]): void {
	for (const session of sessions) {
		const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: session.id });
		if (latestStreamId !== undefined) state.readState.markSessionRead(session.id, latestStreamId);
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
): Map<string, number> {
	const sessionsById = new Map(sessions.map((session) => [session.id, session]));
	const visibleSessionIds = sessions
		.filter((session) => !hasArchivedSessionInPath(session, sessionsById))
		.map((session) => session.id);
	return state.readState.countUnreadMessagesBySession({
		piboSessionIds: visibleSessionIds,
	});
}

function hasUnreadInSessionSubtree(sessions: readonly PiboSession[], sessionUnreadCounts: ReadonlyMap<string, number>, rootSessionId: string): boolean {
	return sessionSubtree(sessions, rootSessionId).some((session) => (sessionUnreadCounts.get(session.id) ?? 0) > 0);
}

function signalStatusFromSnapshot(
	snapshot: ReturnType<NonNullable<PiboWebAppContext["channelContext"]["snapshotSignalSession"]>> | undefined,
	piboSessionId: string,
	options: { sessions?: readonly PiboSession[]; sessionUnreadCounts?: ReadonlyMap<string, number> } = {},
): { status?: PiboWebSessionStatus; updatedAt?: string } | undefined {
	const session = snapshot?.sessions[piboSessionId];
	if (!session) return undefined;
	const hasSignalError = session.hasError || session.hasErrorDescendant || session.aggregateStatus === "error";
	const hasUnreadError = options.sessions && options.sessionUnreadCounts
		? hasUnreadInSessionSubtree(options.sessions, options.sessionUnreadCounts, piboSessionId)
		: true;
	if (hasSignalError && hasUnreadError) return { status: "error", updatedAt: session.updatedAt };
	if (session.isTreeActive) return { status: "running", updatedAt: session.updatedAt };
	return { status: "idle", updatedAt: session.updatedAt };
}

function sessionIndexItemsWithSignalState(
	context: PiboWebAppContext,
	sessions: readonly PiboSession[],
	indexItems: readonly ChatWebSessionIndexItem[],
	sessionUnreadCounts: ReadonlyMap<string, number> = new Map(),
): ChatWebSessionIndexItem[] {
	const snapshotSignalSession = context.channelContext.snapshotSignalSession;
	if (!snapshotSignalSession) return [...indexItems];
	const bySessionId = new Map(indexItems.map((item) => [item.piboSessionId, item]));
	for (const session of sessions) {
		const existing = bySessionId.get(session.id);
		const signal = signalStatusFromSnapshot(snapshotSignalSession(session.id), session.id, { sessions, sessionUnreadCounts });
		if (!signal?.status) continue;
		if (signal.status === "idle" && existing?.status !== "running" && existing?.status !== "error") continue;
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

function parseTransientReplayCursor(value: string | null): number | undefined {
	if (!value) return undefined;
	const cursor = Number(value);
	return Number.isInteger(cursor) && cursor >= 0 ? cursor : undefined;
}

function defaultEventStreamMode(input: { requestedRoomId?: string; requestedPiboSessionId?: string }): ChatEventStreamMode {
	if (input.requestedPiboSessionId) return "live";
	if (input.requestedRoomId) return "summary";
	return "live";
}

function parseEventStreamMode(value: string | null, fallback: ChatEventStreamMode): ChatEventStreamMode {
	if (value === "live" || value === "summary") return value;
	return fallback;
}

function isPiboOutputEvent(value: unknown): value is PiboOutputEvent {
	return !!value && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string";
}

function liveEventMatches(event: ChatLiveEvent, input: { roomId?: string; piboSessionId?: string }): boolean {
	if (input.roomId && event.roomId !== input.roomId) return false;
	if (input.piboSessionId && event.piboSessionId !== input.piboSessionId) return false;
	return true;
}

function recordTransientReplayEvent(state: ChatWebAppState, event: Omit<TransientChatEvent, "replaySequence">): TransientChatEvent {
	const replaySequence = ++state.transientReplaySequence;
	const recorded: TransientChatReplayRecord = { ...event, replaySequence, createdAtMs: Date.now() };
	state.transientReplayBuffer.push(recorded);
	state.transientReplayBufferBytes += estimateJsonBytes(recorded);
	while (
		state.transientReplayBuffer.length > TRANSIENT_REPLAY_BUFFER_MAX_EVENTS ||
		state.transientReplayBufferBytes > TRANSIENT_REPLAY_BUFFER_MAX_BYTES
	) {
		const removed = state.transientReplayBuffer.splice(0, Math.max(1, state.transientReplayBuffer.length - TRANSIENT_REPLAY_BUFFER_MAX_EVENTS));
		if (!removed.length) break;
		for (const evicted of removed) recordTransientReplayEviction(state, evicted);
	}
	return recorded;
}

function parseTimelineBeforeCursor(url: URL): number | undefined {
	const before = parseOptionalPositiveIntSearchParam(url, "beforeSequence");
	if (before !== undefined) return before;
	const cursor = url.searchParams.get("before") ?? url.searchParams.get("cursor");
	if (!cursor || cursor === "tail") return undefined;
	const parsed = Number.parseInt(cursor, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new PiboWebHttpError("Trace cursor must be tail or a positive sequence", 400);
	return parsed;
}

function transientReplayScopeKeys(input: { roomId?: string; piboSessionId?: string }): string[] {
	const keys: string[] = [];
	if (input.piboSessionId) keys.push(`session:${input.piboSessionId}`);
	if (input.roomId) keys.push(`room:${input.roomId}`);
	return keys;
}

function recordTransientReplayEviction(state: ChatWebAppState, event: TransientChatReplayRecord): void {
	state.transientReplayBufferBytes = Math.max(0, state.transientReplayBufferBytes - estimateJsonBytes(event));
	for (const key of transientReplayScopeKeys(event)) {
		state.transientReplayEvictedBeforeByScope.set(key, Math.max(state.transientReplayEvictedBeforeByScope.get(key) ?? 0, event.replaySequence));
	}
}

function estimateJsonBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	} catch {
		return Buffer.byteLength(String(value), "utf8");
	}
}

function transientReplayEvictedBefore(state: ChatWebAppState, input: { roomId?: string; piboSessionId?: string }): number | undefined {
	const values = transientReplayScopeKeys(input)
		.map((key) => state.transientReplayEvictedBeforeByScope.get(key))
		.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
	return values.length ? Math.max(...values) : undefined;
}

function collectTransientReplayEvents(
	state: ChatWebAppState,
	input: { roomId?: string; piboSessionId?: string; afterReplaySequence?: number },
): { events: TransientChatEvent[]; status?: TransientReplayStatus } {
	const afterReplaySequence = input.afterReplaySequence;
	if (afterReplaySequence === undefined) return { events: [] };
	const events = state.transientReplayBuffer.filter((event) => event.replaySequence > afterReplaySequence && liveEventMatches(event, input));
	const sequences = events.map((event) => event.replaySequence);
	const evictedBefore = transientReplayEvictedBefore(state, input);
	return {
		events,
		status: {
			requestedAfter: afterReplaySequence,
			replayed: events.length,
			missed: evictedBefore !== undefined && afterReplaySequence < evictedBefore,
			...(evictedBefore !== undefined ? { evictedBefore } : {}),
			...(sequences.length ? { oldestAvailable: Math.min(...sequences), newestAvailable: Math.max(...sequences) } : {}),
			bufferSize: state.transientReplayBuffer.length,
			maxEvents: TRANSIENT_REPLAY_BUFFER_MAX_EVENTS,
		},
	};
}

function writeChatEventFrames(
	controller: ReadableStreamDefaultController<Uint8Array>,
	event: ChatLiveEvent,
	state: ReturnType<typeof createChatStreamState>,
	cursor?: ChatEventCursor,
	options: { mode: ChatEventStreamMode } = { mode: "live" },
): void {
	if (!isPiboOutputEvent(event.payload)) return;
	if (options.mode === "summary" && isLiveOnlyOutputEvent(event.payload)) return;
	const piboSessionId = event.piboSessionId ?? event.payload.piboSessionId;
	const streamId = "streamId" in event ? event.streamId : undefined;
	const frames = chatStreamFramesFromOutputEvent(event.payload, state, {
		includeRawEvent: streamId !== undefined && isPersistableOutputEvent(event.payload),
	});
	for (let index = 0; index < frames.length; index += 1) {
		if (cursor && streamId !== undefined && streamId === cursor.streamId && index <= cursor.frameIndex) continue;
		const frameId = streamId === undefined ? nextTransientChatStreamFrameId(state) : `${streamId}:${index}`;
		writeSse(controller, "pibo", {
			...frames[index],
			piboSessionId,
			...(!("streamId" in event) && event.replaySequence !== undefined ? { liveReplayId: event.replaySequence } : {}),
		}, frameId);
	}
}

function createEventStream(input: {
	roomId?: string;
	piboSessionId?: string;
	activePiboSessionId?: string;
	mode: ChatEventStreamMode;
	context: PiboWebAppContext;
	state: ChatWebAppState;
	cursor?: ChatEventCursor;
	transientReplayCursor?: number;
}): Response {
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let registeredLiveObserver = false;
	const streamId = randomUUID();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			if (input.mode === "live" && input.activePiboSessionId) {
				markEventStreamConnected(input.state, input.activePiboSessionId, streamId);
				registeredLiveObserver = true;
			}
			const streamState = createChatStreamState();
			const transientReplay = input.mode === "live" ? collectTransientReplayEvents(input.state, {
				roomId: input.roomId,
				piboSessionId: input.piboSessionId,
				afterReplaySequence: input.transientReplayCursor,
			}) : undefined;
			writeSse(controller, "pibo", {
				type: "ready",
				piboSessionId: input.piboSessionId ?? "",
				...(transientReplay?.status ? { liveReplay: transientReplay.status } : {}),
			});
			for (const stored of input.state.timelineQuery.listEvents({
				roomId: input.roomId,
				piboSessionId: input.piboSessionId,
				afterStreamId: input.cursor ? Math.max(0, input.cursor.streamId - 1) : undefined,
				limit: 1000,
			})) {
				writeChatEventFrames(controller, stored, streamState, input.cursor, { mode: input.mode });
			}
			if (input.mode === "live" && input.piboSessionId) {
				if (input.transientReplayCursor === undefined) {
					for (const snapshot of input.state.outputCompactor.snapshotsForSession(input.piboSessionId)) {
						writeChatEventFrames(
							controller,
							{ piboSessionId: snapshot.piboSessionId, eventType: snapshot.type, payload: snapshot },
							streamState,
							undefined,
							{ mode: input.mode },
						);
					}
				}
				for (const replay of transientReplay?.events ?? []) {
					writeChatEventFrames(controller, replay, streamState, undefined, { mode: input.mode });
				}
			}
			const listener = (event: ChatLiveEvent) => {
				if (!liveEventMatches(event, input)) return;
				writeChatEventFrames(controller, event, streamState, undefined, { mode: input.mode });
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
			if (registeredLiveObserver && input.activePiboSessionId) {
				markEventStreamDisconnected({
					state: input.state,
					piboSessionId: input.activePiboSessionId,
					streamId,
				});
				registeredLiveObserver = false;
			}
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			"x-accel-buffering": "no",
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
	const sharedDefaultProject = input.state.projectService.ensureSharedDefaultProject();
	const selectedProject = input.projectId ? requireSharedProject(input.state, input.webSession, input.projectId, { includeArchived: true }) : sharedDefaultProject;
	let storedProjectSessions = input.state.projectService
		.listProjectSessions(selectedProject.id, { includeArchived: input.includeArchived })
		.filter((projectSession) => projectSession.workflowId === "simple-chat");
	if (selectedProject.id === sharedDefaultProject.id && storedProjectSessions.length === 0) {
		const session = createProjectChatSession({
			state: input.state,
			context: input.context,
			webSession: input.webSession,
			project: sharedDefaultProject,
			profile: input.defaultProfile,
			workflowId: "simple-chat",
		});
		storedProjectSessions = [input.state.projectService.getProjectSession(session.id)!];
	}
	const projectSessions = storedProjectSessions;
	const rootSessions = projectSessions
		.map((projectSession) => input.context.channelContext.getSession(projectSession.piboSessionId))
		.filter((session): session is PiboSession => Boolean(session));
	const sessions = collectProjectSessionTreeSessions(
		rootSessions,
		listSharedSessions(input.context),
	);
	const requestedSession = input.piboSessionId ? sessions.find((session) => session.id === input.piboSessionId) : undefined;
	const selectedSession = requestedSession ?? sessions.find((session) => session.id === selectedProject.currentMainSessionId) ?? sessions[0];
	indexSharedSessions(input.state.sessionQuery, sessions);
	const nodes = await buildSessionNodes(sessions, input.state.sessionQuery.listSessions(), selectedProject.projectFolder, new Map(), { skipPiMetadataFallback: true });
	applyProjectSessionArchiveState(nodes, new Map(projectSessions.map((projectSession) => [projectSession.piboSessionId, Boolean(projectSession.archived)])));
	return {
		identity: input.webSession.authSession.identity,
		sharedDefaultProject,
		project: selectedProject,
		projects: listSharedProjects(input.state, input.webSession, { includeArchived: input.includeArchived }),
		projectSessions,
		workflowLifecycleEvents: [],
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

function enrichProjectSessionWorkflowDefinitionLink(state: ChatWebAppState, projectSession: PiboProjectSession): PiboProjectSession {
	if (!isProjectWorkflowBackedSession(projectSession)) return projectSession;
	const snapshot = state.projectService.getWorkflowSessionSnapshotForSession(projectSession.piboSessionId);
	const workflowId = projectSession.workflowId;
	const workflowVersion = projectSession.workflowVersion ?? snapshot?.workflow.version;
	const catalogRecord = workflowVersion
		? buildProjectWorkflowVersionCatalog(state).find((record) => record.id === workflowId && record.version === workflowVersion)
		: undefined;
	const snapshotHash = snapshot?.workflow.effectiveDefinitionHash ?? snapshot?.deletedDefinitionFallback.effectiveDefinitionHash;
	if (catalogRecord && catalogRecord.status !== "deleted") {
		return {
			...projectSession,
			workflowDefinitionLink: {
				status: "live",
				workflowId,
				workflowVersion: catalogRecord.version,
				title: catalogRecord.title,
				...(snapshotHash ? { definitionHash: snapshotHash } : {}),
				href: workflowDefinitionViewerPath(catalogRecord.id, catalogRecord.version),
			},
		};
	}
	const fallback = snapshot?.deletedDefinitionFallback;
	const definitionHash = fallback?.effectiveDefinitionHash ?? snapshotHash;
	return {
		...projectSession,
		workflowDefinitionLink: {
			status: "snapshot_only_definition_deleted",
			workflowId,
			...(workflowVersion ? { workflowVersion } : {}),
			title: fallback?.title ?? snapshot?.workflow.title ?? projectSession.title ?? workflowId,
			...(definitionHash ? { definitionHash } : {}),
			tombstoneLabel: fallback?.tombstoneLabel ?? "Definition deleted or no longer available in the live Workflow catalog.",
		},
	};
}

function enrichProjectSessionWorkflowWaitTokens(state: ChatWebAppState, projectSession: PiboProjectSession): PiboProjectSession {
	if (!projectSession.workflowRunId) return projectSession;
	const waitTokens = state.projectService.listProjectWorkflowWaitTokens({
		projectId: projectSession.projectId,
		piboSessionId: projectSession.piboSessionId,
		workflowRunId: projectSession.workflowRunId,
		status: "pending",
		limit: 20,
	});
	if (!waitTokens.length) return projectSession;
	return {
		...projectSession,
		pendingHumanActions: waitTokens.map((token) => projectWorkflowPendingHumanActionFromToken(token, WORKFLOW_HUMAN_ACTION_REF_OPTIONS)),
	};
}

function submitProjectWorkflowHumanAction(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	projectId: string;
	piboSessionId: string;
	body: ChatProjectWorkflowHumanActionBody;
}): Response {
	const project = requireSharedProject(input.state, input.webSession, input.projectId);
	const session = requireSharedSession(input.context, input.piboSessionId);
	const projectSession = input.state.projectService.getProjectSession(session.id);
	if (!projectSession || projectSession.projectId !== project.id) throw new PiboWebHttpError("Project workflow session not found", 404);
	if (!projectSession.workflowRunId) {
		return projectWorkflowHumanActionDiagnosticResponse("Project workflow session has no workflow run to resolve", [{
			code: "WorkflowRuntimeError.workflowRunMissing",
			message: "This Project workflow session has not started a workflow run, so no human wait token can be resolved.",
			severity: "error",
			path: "$.workflowRunId",
			hint: "Start the configured workflow session before submitting human actions.",
		}], 409, undefined, WORKFLOW_HUMAN_ACTION_REF_OPTIONS);
	}

	const normalized = normalizeProjectWorkflowHumanActionBody(input.body);
	if (normalized.diagnostics.length) {
		return projectWorkflowHumanActionDiagnosticResponse("Human action request is invalid", normalized.diagnostics, 400, undefined, WORKFLOW_HUMAN_ACTION_REF_OPTIONS);
	}
	const request = normalized.request!;
	const waitToken = input.state.projectService.getProjectWorkflowWaitToken(request.waitTokenId);
	const validation = validateProjectWorkflowHumanActionRequest({
		projectSession,
		waitToken,
		request,
		humanActionOptions: WORKFLOW_HUMAN_ACTION_REF_OPTIONS,
	});
	if (validation.diagnostics.length) {
		if (waitToken && validation.expiredAt) {
			input.state.projectService.saveProjectWorkflowWaitToken({ ...waitToken, status: "expired", resolvedAt: validation.checkedAt });
		}
		recordWorkflowLifecycleEvent(input.state, input.webSession, {
			type: "workflow.human_action.submitted",
			workflowId: projectSession.workflowId,
			...(projectSession.workflowVersion ? { workflowVersion: projectSession.workflowVersion } : {}),
			projectId: project.id,
			piboSessionId: session.id,
			workflowRunId: projectSession.workflowRunId,
			status: "blocked",
			diagnostics: validation.diagnostics,
			payload: projectWorkflowHumanActionLifecyclePayload(request),
		});
		return projectWorkflowHumanActionDiagnosticResponse("Human action was rejected by wait-token validation", validation.diagnostics, validation.httpStatus, waitToken, WORKFLOW_HUMAN_ACTION_REF_OPTIONS);
	}

	try {
		const result = input.state.projectService.resolveProjectWorkflowHumanAction({
			projectId: project.id,
			piboSessionId: session.id,
			workflowRunId: projectSession.workflowRunId,
			waitTokenId: request.waitTokenId,
			...(validation.actionRef?.id ? { actionId: validation.actionRef.id } : {}),
			kind: validation.actionKind!,
			actor: {
				userId: input.webSession.authSession.identity.userId,
				...(input.webSession.authSession.identity.email ? { email: input.webSession.authSession.identity.email } : {}),
			},
			...(request.payload !== undefined ? { payload: request.payload } : {}),
		});
		const enrichedProjectSession = enrichProjectSessionWorkflowWaitTokens(input.state, enrichProjectSessionWorkflowDefinitionLink(input.state, result.projectSession));
		recordWorkflowLifecycleEvent(input.state, input.webSession, {
			type: "workflow.human_action.submitted",
			workflowId: result.projectSession.workflowId,
			...(result.projectSession.workflowVersion ? { workflowVersion: result.projectSession.workflowVersion } : {}),
			projectId: project.id,
			piboSessionId: session.id,
			workflowRunId: result.run.id,
			status: "submitted",
			diagnostics: [],
			payload: projectWorkflowHumanActionSubmittedLifecyclePayload(result.waitToken.id, result.action),
		});
		return responseJson({
			ok: true,
			projectSession: enrichedProjectSession,
			waitToken: result.waitToken,
			action: result.action,
			run: result.run,
			diagnostics: [],
		}, { status: result.action.kind === "cancel" ? 200 : 202 });
	} catch (error) {
		const diagnostics = [projectWorkflowHumanActionRuntimeDiagnostic(error, request.waitTokenId)];
		recordWorkflowLifecycleEvent(input.state, input.webSession, {
			type: "workflow.human_action.submitted",
			workflowId: projectSession.workflowId,
			...(projectSession.workflowVersion ? { workflowVersion: projectSession.workflowVersion } : {}),
			projectId: project.id,
			piboSessionId: session.id,
			workflowRunId: projectSession.workflowRunId,
			status: "blocked",
			diagnostics,
			payload: projectWorkflowHumanActionLifecyclePayload(request),
		});
		return projectWorkflowHumanActionDiagnosticResponse("Human action was rejected by wait-token validation", diagnostics, 409, waitToken, WORKFLOW_HUMAN_ACTION_REF_OPTIONS);
	}
}

function isProjectWorkflowBackedSession(projectSession: PiboProjectSession): boolean {
	return Boolean(projectSession.workflowRunId) || projectSession.state === "workflow" || projectSession.workflowId !== "simple-chat";
}

function workflowDefinitionViewerPath(workflowId: string, workflowVersion: string): string {
	return `${CHAT_WEB_MOUNT_PATH}/workflows/view/${encodeURIComponent(workflowId)}/${encodeURIComponent(workflowVersion)}`;
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
	const selectedSession = requireSharedSession(input.context, input.body.piboSessionId);
	const projectSession = input.state.projectService.getProjectSession(selectedSession.id);
	if (!projectSession) throw new PiboWebHttpError("Project session not found", 404);
	const actorId = auditActorIdFor(input.webSession);
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
	const messageId = clientTxnId ?? randomUUID();
	const output = await input.context.channelContext.emit({
		type: "message",
		piboSessionId: selectedSession.id,
		id: messageId,
		text,
		source: "user",
	});
	return responseJson({ accepted, output });
}

function startChatStreamingFixture(input: {
	state: ChatWebAppState;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	defaultProfile: string;
	body: ChatStreamingFixtureBody;
}): Response {
	const requestedRoomId = typeof input.body.roomId === "string" ? input.body.roomId : undefined;
	const selectedSession = resolveRequestedSession(
		input.state,
		input.context,
		input.webSession,
		input.defaultProfile,
		typeof input.body.piboSessionId === "string" ? input.body.piboSessionId : undefined,
		requestedRoomId,
	);
	const room = ensureSessionRoom(input.state, input.context, selectedSession, input.webSession);
	if (requestedRoomId && room.id !== requestedRoomId) throw new PiboWebHttpError("Session is not available in this room", 404);
	if (isPiboRoomArchived(room)) throw new PiboWebHttpError("Archived rooms are read-only", 403);
	input.state.sessionQuery.upsertSession(selectedSession);

	const cadenceMs = normalizeStreamingFixtureCadenceMs(input.body.cadenceMs);
	const profile = normalizeStreamingFixtureProfile(input.body.profile);
	const mix = normalizeStreamingFixtureMix(input.body.mix);
	const preludeMessages = normalizeStreamingFixturePreludeMessages(input.body.preludeMessages);
	const preludeOnly = normalizeStreamingFixturePreludeOnly(input.body.preludeOnly);
	const deltas = normalizeStreamingFixtureDeltas(input.body.deltas, mix);
	const traceSnapshots = normalizeStreamingFixtureTraceSnapshots(input.body.traceSnapshots);
	const suppressLiveDeltas = normalizeStreamingFixtureSuppressLiveDeltas(input.body.suppressLiveDeltas);
	const scheduleMs = buildStreamingFixtureSchedule(deltas.length, cadenceMs, profile);
	const reasoningDeltas = mix === "reasoning-text" ? [" think", " plan", " check", " answer"] : [];
	const reasoningScheduleMs = reasoningDeltas.map((_, index) => Math.max(10, Math.round(((index + 1) * cadenceMs) / 2)));
	const eventId = `streaming-fixture-${randomUUID()}`;
	const emit = (event: PiboOutputEvent) => {
		if (traceSnapshots && (event.type === "assistant_delta" || event.type === "assistant_message" || event.type === "message_finished")) {
			input.state.outputCompactor.compact(event);
		}
		if (suppressLiveDeltas && event.type === "assistant_delta") return;
		const liveEvent = recordTransientReplayEvent(input.state, {
			roomId: room.id,
			piboSessionId: selectedSession.id,
			eventType: event.type,
			payload: event,
		});
		for (const listener of input.state.liveListeners) listener(liveEvent);
	};
	const emitAt = (delayMs: number, event: PiboOutputEvent) => {
		setTimeout(() => emit(event), delayMs);
	};
	for (let index = 0; index < preludeMessages; index += 1) {
		const preludeEventId = `streaming-fixture-prelude-${randomUUID()}`;
		const text = ` prelude ${index}`;
		emit({ type: "message_started", piboSessionId: selectedSession.id, eventId: preludeEventId, text: "Streaming benchmark prelude", source: "service" });
		emit({ type: "assistant_delta", piboSessionId: selectedSession.id, eventId: preludeEventId, assistantIndex: 0, text });
		emit({ type: "assistant_message", piboSessionId: selectedSession.id, eventId: preludeEventId, assistantIndex: 0, text });
		emit({ type: "message_finished", piboSessionId: selectedSession.id, eventId: preludeEventId, source: "service" });
	}
	if (preludeOnly) {
		return responseJson({
			fixture: {
				piboSessionId: selectedSession.id,
				roomId: room.id,
				preludeMessages,
				preludeOnly,
			},
		});
	}

	emit({ type: "message_started", piboSessionId: selectedSession.id, eventId, text: "Streaming benchmark fixture", source: "service" });
	if (reasoningDeltas.length) {
		emit({ type: "thinking_started", piboSessionId: selectedSession.id, eventId, thinkingIndex: 0 });
		reasoningDeltas.forEach((delta, index) => {
			emitAt(reasoningScheduleMs[index] ?? Math.max(10, Math.round(((index + 1) * cadenceMs) / 2)), { type: "thinking_delta", piboSessionId: selectedSession.id, eventId, thinkingIndex: 0, text: delta });
		});
		emitAt((reasoningScheduleMs[reasoningScheduleMs.length - 1] ?? 0) + Math.max(10, Math.round(cadenceMs / 2)), { type: "thinking_finished", piboSessionId: selectedSession.id, eventId, thinkingIndex: 0, text: reasoningDeltas.join("") });
	}
	deltas.forEach((delta, index) => {
		emitAt(scheduleMs[index] ?? cadenceMs * (index + 1), { type: "assistant_delta", piboSessionId: selectedSession.id, eventId, assistantIndex: 0, text: delta });
	});
	const finalText = deltas.join("");
	const finalReasoning = reasoningDeltas.join("");
	const finishDelayMs = Math.max(scheduleMs[scheduleMs.length - 1] ?? 0, reasoningScheduleMs[reasoningScheduleMs.length - 1] ?? 0) + cadenceMs;
	emitAt(finishDelayMs, { type: "assistant_message", piboSessionId: selectedSession.id, eventId, assistantIndex: 0, text: finalText });
	emitAt(finishDelayMs, { type: "message_finished", piboSessionId: selectedSession.id, eventId, source: "service" });

	return responseJson({
		fixture: {
			piboSessionId: selectedSession.id,
			roomId: room.id,
			eventId,
			deltaCount: deltas.length,
			cadenceMs,
			profile,
			mix,
			preludeMessages,
			traceSnapshots,
			suppressLiveDeltas,
			scheduleMs,
			reasoningScheduleMs,
			reasoningDeltaCount: reasoningDeltas.length,
			textBytes: new TextEncoder().encode(finalText).length,
			reasoningBytes: new TextEncoder().encode(finalReasoning).length,
		},
	});
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
	const actorId = auditActorIdFor(input.webSession);
	const duplicate = clientTxnId ? input.state.eventCommands.findByClientTxn(room.id, actorId, clientTxnId) : undefined;
	if (duplicate) return responseJson({ duplicate: true, event: duplicate });
	const webAnnotationContext = prepareWebAnnotationAttachments({
		piboSessionId: selectedSession.id,
		messageText: text,
		attachmentIds: input.body.webAnnotationIds,
	});
	const fileAttachmentContext = prepareChatFileAttachments({
		messageText: webAnnotationContext.messageText,
		attachmentPaths: input.body.fileAttachmentPaths,
	});
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
			text: fileAttachmentContext.messageText,
			...(webAnnotationContext.attachments.length ? {
				webAnnotationIds: webAnnotationContext.ids,
				webAnnotationAttachments: webAnnotationContext.attachments,
				webAnnotationContext: webAnnotationContext.modelContext,
			} : {}),
			...(fileAttachmentContext.attachments.length ? {
				fileAttachmentPaths: fileAttachmentContext.paths,
				fileAttachments: fileAttachmentContext.attachments,
				fileAttachmentContext: fileAttachmentContext.modelContext,
			} : {}),
			...(clientTxnId ? { clientTxnId } : {}),
		},
	});
	try {
		input.state.ingestService?.ingestUserMessageAccepted({
			session: selectedSession,
			roomId: room.id,
			actorId,
			text: fileAttachmentContext.messageText,
			clientTxnId,
			legacyEvent: accepted,
		});
	} catch (error) {
		console.warn("V2 chat data shadow ingest failed", error);
	}
	for (const listener of input.state.liveListeners) listener(accepted);
	const messageId = clientTxnId ?? randomUUID();
	let output: PiboOutputEvent;
	try {
		output = await input.context.channelContext.emit({
			type: "message",
			piboSessionId: selectedSession.id,
			id: messageId,
			text: fileAttachmentContext.messageText,
			source: "user",
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		input.context.channelContext.reportSessionError?.(selectedSession.id, errorMessage, { eventId: messageId, source: "pibo" });
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
				message: errorMessage,
			},
		});
		for (const listener of input.state.liveListeners) listener(failed);
		throw error;
	}
	markWebAnnotationsAttached(webAnnotationContext);
	return responseJson({ output, event: accepted });
}


export function createChatWebApp(options: ChatWebAppOptions = {}): PiboWebApp {
	const defaultProfile = options.defaultProfile ?? "base";
	const dataStore = createDataStore(options);
	const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
	eventLoopDelay.enable();
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
		traceTimelinePageCache: new Map(),
		outputCompactor: new OutputCompactor(),
		liveListeners: new Set(),
		transientReplaySequence: 0,
		transientReplayBuffer: [],
		transientReplayBufferBytes: 0,
		transientReplayEvictedBeforeByScope: new Map(),
		activeEventStreams: new Map(),
		activeTraceSessions: new Set(),
		persistenceMetrics: createPersistenceMetrics(),
		resourceMetrics: createResourceMetrics(),
		eventLoopDelay,
		userSkillManager: new UserSkillManager(os.homedir()),
		workflowDraftStore: new ChatWorkflowDraftStore(dataStore),
		workflowPublishedVersionStore: new ChatWorkflowPublishedVersionStore(dataStore),
		workflowArchiveStore: new ChatWorkflowArchiveStore(dataStore),
		workflowTombstoneStore: new ChatWorkflowTombstoneStore(dataStore),
		workflowLifecycleEventStore: new ChatWorkflowLifecycleEventStore(dataStore),
		workflowPromptAssetStore: new ChatWorkflowPromptAssetStore(dataStore),
		telemetryRetentionMaintenance: {},
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
			if (isTelemetryRetentionMaintenanceDue({ state: state.telemetryRetentionMaintenance })) {
				maybeRunTelemetryRetentionMaintenance({
					state: state.telemetryRetentionMaintenance,
					dataStore: state.dataStore,
					settings: loadPiboUserSettings().telemetryRetention,
					context,
					onPruned: updateTelemetryRetentionLastPrunedAt,
				});
			}
			ensureEventIndexing(state, context);
			ensureCustomAgentProfiles(state, context);
			syncChatUserSkills({
				userSkillManager: state.userSkillManager,
				channelContext: context.channelContext,
				previouslySyncedNames: state.syncedUserSkillNames,
				setSyncedUserSkillNames: (names) => {
					state.syncedUserSkillNames = names;
				},
			});

			const builtAsset = responseBuiltChatAsset(request, url.pathname);
			if (builtAsset) return builtAsset;
			const builtPublicFile = responseBuiltChatPublicFile(request, url.pathname);
			if (builtPublicFile) return builtPublicFile;

			if (isChatAppPath(url.pathname) && request.method === "GET") {
				return responseChatAppShell();
			}

			const builtVscodeAsset = responseBuiltVscodeAsset(request, url.pathname);
			if (builtVscodeAsset) return builtVscodeAsset;
			if (isVscodeAppPath(url.pathname) && request.method === "GET") {
				return responseVscodeAppShell();
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/upload` && request.method === "POST") {
				requireSameOriginMultipartRequest(request);
				await requireSession(request, context);
				return responseJson(await saveUploadedChatFiles(request), { status: 201 });
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
				return responseChatFileDownload(absolutePath);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/navigation` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				const requestedRoomId = url.searchParams.get("roomId") || undefined;
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					requestedRoomId,
				);
				const selectedRoomId = selectedRoomIdForSession(state, context, selectedSession);
				const ownedSessions = listSharedSessions(context);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				const defaultRoom = state.roomService.ensureDefaultRoom();
				indexSharedSessions(state.sessionQuery, roomSessions);
				const sessionUnreadCounts = buildSessionUnreadCounts(state, ownedSessions);
				const sessions = await buildSessionNodes(
					roomSessions,
					sessionIndexItemsWithSignalState(context, roomSessions, state.sessionQuery.listSessions(), sessionUnreadCounts),
					process.cwd(),
					sessionUnreadCounts,
					{ skipPiMetadataFallback: true },
				);
				const roomTree = state.roomService.listRoomTree();
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
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					requestedRoomId,
				);
				const selectedRoomId = selectedRoomIdForSession(state, context, selectedSession);
				const ownedSessions = listSharedSessions(context);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				const defaultRoom = state.roomService.ensureDefaultRoom();
				if (markRead) {
					markSessionsRead(state, sessionSubtree(ownedSessions, selectedSession.id));
				}
				indexSharedSessions(state.sessionQuery, roomSessions);
				const sessionUnreadCounts = buildSessionUnreadCounts(state, ownedSessions);
				const [sessions, catalog] = await Promise.all([
					buildSessionNodes(
						roomSessions,
						sessionIndexItemsWithSignalState(context, roomSessions, state.sessionQuery.listSessions(), sessionUnreadCounts),
						process.cwd(),
						sessionUnreadCounts,
					),
					loadBootstrapCatalog(state, context, webSession),
				]);
				const roomTree = state.roomService.listRoomTree();
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

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/context-build` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const snapshot = await buildContextBuildSnapshotForRequest({
					context,
					webSession,
					piboSessionId: url.searchParams.get("piboSessionId") || undefined,
				});
				return responseJson({ snapshot });
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
				const webSession = await requireSession(request, context);
				return responseJson({ projects: listSharedProjects(state, webSession, { includeArchived: parseBooleanSearchParam(url, "includeArchived") }) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/projects` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectCreateBody>(request);
				try {
					const project = state.projectService.createProject({
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
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectPatchBody>(request);
				try {
					requireSharedProject(state, webSession, projectResource.projectId, { includeArchived: true });
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
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectDeleteBody>(request);
				try {
					requireSharedProject(state, webSession, projectResource.projectId, { includeArchived: true });
					return responseJson(state.projectService.deleteProject(projectResource.projectId, {
						confirmName: normalizeRoomDeleteConfirmation(body.confirmName),
						deleteFiles: body.deleteFiles === true,
					}));
				} catch (error) {
					if (error instanceof PiboWebHttpError) throw error;
					throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
				}
			}

			const workflowHumanActionResource = projectWorkflowHumanActionsResource(url.pathname);
			if (workflowHumanActionResource && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectWorkflowHumanActionBody>(request);
				return submitProjectWorkflowHumanAction({
					state,
					context,
					webSession,
					projectId: workflowHumanActionResource.projectId,
					piboSessionId: workflowHumanActionResource.piboSessionId,
					body,
				});
			}

			if (projectResource && projectResource.child === "workflow-sessions" && request.method === "POST" && !projectWorkflowSessionStartResource(url.pathname) && !workflowHumanActionResource) {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectSessionCreateBody>(request);
				const project = requireSharedProject(state, webSession, projectResource.projectId);
				const profile = resolveCreateSessionProfile(context, defaultProfile, body.profile);
				const workflowSelection = resolveProjectWorkflowSelection(state, body.workflowId, body.workflowVersion, { requireExplicitWorkflowId: true, requireExplicitVersion: true });
				const publishedWorkflow = resolvePublishedWorkflowDefinitionForProfile(state, workflowSelection, profile);
				const baseDefinition = cloneJsonObject(publishedWorkflow.definition);
				const configuration = normalizeProjectWorkflowSessionConfiguration(body, baseDefinition);
				const validation = validatePublishedWorkflowBoundary({
					state,
					context,
					webSession,
					definition: baseDefinition,
					trigger: "before_project_session_creation",
				});
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "workflow.validation.completed",
					workflowId: workflowSelection.id,
					workflowVersion: workflowSelection.version,
					projectId: project.id,
					status: validation.validation.ok ? "accepted" : "blocked",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: { trigger: validation.validation.trigger, boundary: "project_session_creation" },
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
					workflow: publishedWorkflow,
					baseDefinition,
					configuration,
					validation,
				}));
				const projectSession = state.projectService.getProjectSession(session.id);
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "project.workflow_session.created",
					workflowId: workflowSelection.id,
					workflowVersion: workflowSelection.version,
					projectId: project.id,
					piboSessionId: session.id,
					status: "accepted",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: { snapshotId: snapshot.id, profile },
				});
				return responseJson({ session, projectSession, workflow: workflowSelection, configuration, snapshot, validation: validation.validation, diagnostics: validation.diagnostics }, { status: 201 });
			}

			const workflowSessionStart = projectWorkflowSessionStartResource(url.pathname);
			if (workflowSessionStart && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const session = requireSharedSession(context, workflowSessionStart.piboSessionId);
				const project = requireSharedProject(state, webSession, workflowSessionStart.projectId);
				const projectSession = state.projectService.getProjectSession(session.id);
				if (!projectSession || projectSession.projectId !== project.id) throw new PiboWebHttpError("Project workflow session not found", 404);
				const snapshot = state.projectService.getWorkflowSessionSnapshotForSession(session.id);
				if (!snapshot) throw new PiboWebHttpError("Project workflow session snapshot not found", 409);
				const workflowSelection = workflowVersionFromSnapshot(snapshot);
				if (projectSession.workflowRunId) {
					const existingRun = state.projectService.getProjectWorkflowRun(projectSession.workflowRunId);
					if (existingRun) {
						updateProjectWorkflowRunSessionMetadata({ state, context, session, workflowRunId: existingRun.id });
						return responseJson({
							projectSession,
							workflow: workflowSelection,
							snapshot,
							run: existingRun,
							alreadyStarted: true,
							validation: existingRun.validation ?? summarizeWorkflowDiagnostics([], "before_workflow_start"),
							diagnostics: [],
							message: "Workflow run already exists for this Project session.",
						}, { status: 200 });
					}
				}
				const validation = validateProjectWorkflowSnapshotForStart(snapshot, { state, context, webSession });
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "workflow.validation.completed",
					workflowId: workflowSelection.id,
					workflowVersion: workflowSelection.version,
					projectId: project.id,
					piboSessionId: session.id,
					workflowRunId: projectSession.workflowRunId,
					status: validation.validation.ok ? "accepted" : "blocked",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: { trigger: validation.validation.trigger, boundary: "workflow_start", snapshotId: snapshot.id },
				});
				if (!validation.validation.ok) {
					recordWorkflowLifecycleEvent(state, webSession, {
						type: "project.workflow_start.blocked",
						workflowId: workflowSelection.id,
						workflowVersion: workflowSelection.version,
						projectId: project.id,
						piboSessionId: session.id,
						workflowRunId: projectSession.workflowRunId,
						status: "blocked",
						validation: validation.validation,
						diagnostics: validation.diagnostics,
						payload: { snapshotId: snapshot.id, profile: session.profile },
					});
					return workflowValidationBlockedResponse("Workflow session has validation errors and cannot be started", validation, { projectSession, workflow: workflowSelection });
				}
				const startResult = state.projectService.startWorkflowSessionRun({
					projectId: project.id,
					piboSessionId: session.id,
					runId: `wfr_${randomUUID()}`,
					workflowId: snapshot.workflow.id,
					workflowVersion: snapshot.workflow.version,
					snapshotId: snapshot.id,
					effectiveDefinitionHash: snapshot.workflow.effectiveDefinitionHash,
					current: createProjectWorkflowRunCurrent(snapshot.effectiveDefinition),
					inputValues: snapshot.inputValues,
					validation: validation.validation as unknown as PiboJsonObject,
				});
				updateProjectWorkflowRunSessionMetadata({ state, context, session, workflowRunId: startResult.run.id });
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "project.workflow_start.accepted",
					workflowId: workflowSelection.id,
					workflowVersion: workflowSelection.version,
					projectId: project.id,
					piboSessionId: session.id,
					workflowRunId: startResult.run.id,
					status: "accepted",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: { snapshotId: snapshot.id, profile: session.profile, alreadyStarted: startResult.alreadyStarted },
				});
				if (!startResult.alreadyStarted) {
					recordWorkflowLifecycleEvent(state, webSession, {
						type: "workflow.run.status_changed",
						workflowId: workflowSelection.id,
						workflowVersion: workflowSelection.version,
						projectId: project.id,
						piboSessionId: session.id,
						workflowRunId: startResult.run.id,
						status: "changed",
						validation: validation.validation,
						diagnostics: validation.diagnostics,
						payload: { snapshotId: snapshot.id, state: startResult.run.status, current: startResult.run.current },
					});
				}
				return responseJson({
					projectSession: startResult.projectSession,
					workflow: workflowSelection,
					snapshot,
					run: startResult.run,
					alreadyStarted: startResult.alreadyStarted,
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					message: startResult.alreadyStarted ? "Workflow run already exists for this Project session." : "Workflow run started.",
				}, { status: startResult.alreadyStarted ? 200 : 202 });
			}

			if (projectResource && projectResource.child === "sessions" && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatProjectSessionCreateBody>(request);
				const project = requireSharedProject(state, webSession, projectResource.projectId);
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
				assertProjectSessionPatchFields(body);
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
				requireSharedSession(context, requestedSignal.piboSessionId);
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
				requireSharedSession(context, rootPiboSessionId);
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

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/workflows` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived") || parseBooleanSearchParam(url, "archived");
				return responseJson(buildWorkflowCatalogList(state, context, webSession, { includeArchived }));
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/workflows` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowCreateDraftBody>(request);
				return responseJson(createWorkflowDraftIdentity(state, context, webSession, body), { status: 201 });
			}

			const workflowVersion = workflowVersionResource(url.pathname);
			if (workflowVersion && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived") || parseBooleanSearchParam(url, "archived");
				return responseJson(workflowVersion.version
					? buildWorkflowVersionInspect(state, context, webSession, workflowVersion.workflowId, workflowVersion.version, { includeArchived })
					: buildWorkflowVersionList(state, context, webSession, workflowVersion.workflowId, { includeArchived }));
			}

			const workflowCatalogId = workflowCatalogResourceId(url.pathname);
			if (workflowCatalogId && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived") || parseBooleanSearchParam(url, "archived");
				return responseJson(buildWorkflowCatalogInspect(state, context, webSession, workflowCatalogId, {
					includeArchived,
					version: url.searchParams.get("version") ?? undefined,
					draftId: url.searchParams.get("draftId") ?? undefined,
				}));
			}

			if (workflowCatalogId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowDeleteBody>(request);
				return responseJson(deleteWorkflowIdentity(state, context, webSession, workflowCatalogId, body));
			}

			const workflowPromptAssetId = workflowPromptAssetResourceId(url.pathname);
			if (workflowPromptAssetId && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const asset = getWorkflowPromptAssetDocument(state, webSession, workflowPromptAssetId);
				if (!asset) throw new PiboWebHttpError("Workflow prompt asset not found", 404);
				return responseJson({ asset });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/workflows/prompt-assets` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowPromptAssetSaveBody>(request);
				return responseJson({ asset: saveWorkflowPromptAssetRevision(state, webSession, body) }, { status: 201 });
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
					recordWorkflowLifecycleEvent(state, webSession, {
						type: "workflow.publish.blocked",
						workflowId: record.workflowId,
						workflowVersion: typeof record.definition.version === "string" ? record.definition.version : undefined,
						draftId: record.draftId,
						status: "blocked",
						validation: validation.validation,
						diagnostics: validation.diagnostics,
						payload: { versionIntent: record.versionIntent },
					});
					return workflowValidationBlockedResponse("Workflow draft has validation errors and cannot be published", validation, { draft: serializeWorkflowDraft(record) });
				}
				const publishResult = state.workflowPublishedVersionStore.publishDraft({
					draft: record,
					versionIntent: record.versionIntent,
					publishedBy: auditActorIdFor(webSession),
					reservedVersions: STATIC_WORKFLOW_VERSION_CATALOG
						.filter((workflow) => workflow.id === record.workflowId && workflow.status === "published")
						.map((workflow) => workflow.version),
				});
				record.targetWorkflowVersion = publishResult.record.version;
				record.definition = publishResult.record.definition;
				record.updatedAt = publishResult.record.publishedAt;
				state.workflowDraftStore.saveDraft(record);
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "workflow.publish.accepted",
					workflowId: publishResult.record.workflowId,
					workflowVersion: publishResult.record.version,
					draftId: record.draftId,
					status: "accepted",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: {
						versionIntent: record.versionIntent,
						alreadyPublished: publishResult.alreadyPublished,
						definitionHash: publishResult.record.definitionHash,
					},
				});
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
				recordWorkflowLifecycleEvent(state, webSession, {
					type: "workflow.draft.saved",
					workflowId: record.workflowId,
					workflowVersion: typeof record.definition.version === "string" ? record.definition.version : undefined,
					draftId: record.draftId,
					status: "saved",
					validation: validation.validation,
					diagnostics: validation.diagnostics,
					payload: { operation: "patch", trigger, revision: record.revision },
				});
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

			const archiveWorkflowId = workflowArchiveResourceId(url.pathname);
			if (archiveWorkflowId && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<WorkflowArchiveBody>(request);
				return responseJson(archiveWorkflowIdentity(state, context, webSession, archiveWorkflowId, body.reason));
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/workflows/lifecycle-events` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				return responseJson({
					events: state.workflowLifecycleEventStore.listEvents({
						type: url.searchParams.get("type") ?? undefined,
						workflowId: url.searchParams.get("workflowId") ?? undefined,
						draftId: url.searchParams.get("draftId") ?? undefined,
						projectId: url.searchParams.get("projectId") ?? undefined,
						piboSessionId: url.searchParams.get("piboSessionId") ?? undefined,
						workflowRunId: url.searchParams.get("workflowRunId") ?? undefined,
						limit: parsePositiveIntSearchParam(url, "limit", 100, 500),
					}),
				});
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
				if (pickerKind === "human-actions") {
					return responseJson(buildWorkflowRegisteredRefPicker(
						"human-actions",
						WORKFLOW_HUMAN_ACTION_REF_OPTIONS,
						url.searchParams.get("selectedRefId") ?? undefined,
					));
				}
				if (pickerKind === "prompt-assets") {
					return responseJson(buildWorkflowPromptAssetPicker(
						state,
						webSession,
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
				if (pickerKind === "version-history") {
					return responseJson(buildWorkflowVersionHistory(
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

			const settingsRoute = chatSettingsRoute(url.pathname, request.method);
			if (settingsRoute) {
				if (chatSettingsRouteRequiresSameOrigin(settingsRoute)) requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const response = await handleChatSettingsRoute({
					route: settingsRoute,
					request,
					cwd: process.cwd(),
					dataStore: state.dataStore,
				});
				if (chatSettingsRouteInvalidatesBootstrapCatalog(settingsRoute)) invalidateBootstrapCatalogCache(state);
				return response;
			}

			const capabilityRoute = chatCapabilityRoute(url.pathname, request.method);
			if (capabilityRoute) {
				if (chatCapabilityRouteRequiresSameOrigin(capabilityRoute)) requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				return handleChatCapabilityRoute({
					route: capabilityRoute,
					request,
					cwd: process.cwd(),
					invalidateBootstrapCatalogCache: () => invalidateBootstrapCatalogCache(state),
					agentsSelectingPiPackage: (packageId) => agentsSelectingPiPackage(state, packageId),
				});
			}

			const userSkillRoute = chatUserSkillRoute(url.pathname, request.method);
			if (userSkillRoute) {
				if (chatUserSkillRouteRequiresSameOrigin(userSkillRoute)) requireSameOriginJsonRequest(request);
				await requireSession(request, context);
				return handleChatUserSkillRoute({
					route: userSkillRoute,
					request,
					userSkillManager: state.userSkillManager,
					channelContext: context.channelContext,
					previouslySyncedNames: state.syncedUserSkillNames,
					setSyncedUserSkillNames: (names) => {
						state.syncedUserSkillNames = names;
					},
					invalidateBootstrapCatalogCache: () => invalidateBootstrapCatalogCache(state),
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/agents` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				return responseJson({ agents: serializeCustomAgents(state.agentStore.list({ includeArchived }), context) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/agents` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatAgentBody>(request);
				const input = createAgentInput(body);
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
				const existing = requireSharedAgent(state.agentStore.get(patchAgentId));
				const body = await readJsonBody<ChatAgentBody>(request);
				const update = createAgentUpdate(body);
				const archived = normalizeAgentArchived(body.archived);
				if (update.displayName) requireAgentProfileNameAvailable(state, context, update.displayName, existing.id);
				const updated = Object.keys(update).length ? state.agentStore.update(patchAgentId, update) : existing;
				const afterUpdate = requireSharedAgent(updated);
				const agent = archived === undefined ? afterUpdate : state.agentStore.setArchived(patchAgentId, archived);
				const sharedAgent = requireSharedAgent(agent);
				if (existing.profileName !== sharedAgent.profileName) context.channelContext.removeProfile?.(existing.profileName);
				if (sharedAgent.archivedAt) {
					context.channelContext.removeProfile?.(sharedAgent.profileName);
				} else {
					context.channelContext.upsertProfile?.(createCustomAgentProfileDefinition(sharedAgent));
				}
				invalidateBootstrapCatalogCache(state);
				return responseJson({ agent: serializeCustomAgent(sharedAgent, context) });
			}

			if (patchAgentId && request.method === "DELETE") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const agent = requireSharedAgent(state.agentStore.get(patchAgentId));
				if (!agent.archivedAt) throw new PiboWebHttpError("Archive the agent before permanently deleting it.", 400);
				const body = await readJsonBody<ChatAgentBody>(request);
				const confirmName = normalizeAgentDeleteConfirmation(body.confirmName);
				if (confirmName !== agent.profileName) {
					throw new PiboWebHttpError(`Type "${agent.profileName}" to permanently delete this agent and its sessions.`, 400);
				}
				const deletedSessionIds = deleteSessionsForAgentProfile(state, context, webSession, [agent.profileName, ...agent.profileAliases]);
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
				const ownedSessions = listSharedSessions(context);
				const roomSessions = visibleSessionsInRoom({
					state,
					context,
					webSession,
					sessions: ownedSessions,
					selectedSession,
					selectedRoomId,
					includeArchived,
				});
				indexSharedSessions(state.sessionQuery, roomSessions);
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
						: state.roomService.ensureDefaultRoom();
				const created = createSharedChatSession(context, webSession, profile, room);
				state.sessionQuery.upsertSession(created);
				return responseJson({ session: created }, { status: 201 });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				state.roomService.ensureDefaultRoom();
				const workspaceFilter = url.searchParams.get("workspace");
				if (workspaceFilter) {
					const rooms = state.roomService
						.listRooms()
						.filter((room) => room.workspace === workspaceFilter);
					return responseJson({ rooms });
				}
				return responseJson({ rooms: state.roomService.listRoomTree() });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatRoomCreateBody>(request);
				const parentRoomId = normalizeParentRoomId(body.parentRoomId);
				if (parentRoomId) requireRoom(state, parentRoomId, webSession, "admin");
				const room = state.roomService.createRoom({
					name: normalizeRoomName(body.name),
					topic: normalizeRoomTopic(body.topic),
					metadata: withPiboRoomWorkspace(undefined, normalizeRoomWorkspace(body.workspace)),
					type: normalizeRoomType(body.type),
					parentRoomId,
				});
				return responseJson({ room }, { status: 201 });
			}

			const roomResource = roomResourcePath(url.pathname);
			if (roomResource && roomResource.child === undefined && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const room = requireRoom(state, roomResource.roomId, webSession, "read");
				const ownedSessions = sessionsInRoom(listSharedSessions(context), room.id);
				indexSharedSessions(state.sessionQuery, ownedSessions);
				return responseJson({
					room,
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
				const roomSessions = sessionsInRoomSubtree(listSharedSessions(context), room.id);
				markSessionsRead(state, roomSessions);
				return responseJson({ ok: true, roomId: room.id, readSessionIds: roomSessions.map((session) => session.id) });
			}

			const sessionAction = sessionActionResource(url.pathname);
			if (sessionAction?.action === "read" && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, sessionAction.piboSessionId);
				markSessionsRead(state, sessionSubtree(listSharedSessions(context), selectedSession.id));
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
				const update = createSessionUpdate(context, selectedSession, body);
				if ("activeModel" in update) {
					try {
						await context.channelContext.setLiveSessionActiveModel?.(selectedSession.id, update.activeModel ?? undefined);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						const status = /idle/i.test(message) ? 409 : 400;
						throw new PiboWebHttpError(message, status);
					}
				}
				const updated = updateSession(selectedSession.id, update);
				if (!updated) throw new PiboWebHttpError("Session not found", 404);
				if (body.archived === true) {
					markSessionsRead(state, sessionSubtree(listSharedSessions(context), selectedSession.id));
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

			if ((sessionAction?.action === "kill" || sessionAction?.action === "kill-all") && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const selectedSession = resolveRequestedSession(state, context, webSession, defaultProfile, sessionAction.piboSessionId);
				const output = await context.channelContext.emit({
					type: "execution",
					piboSessionId: selectedSession.id,
					id: randomUUID(),
					action: sessionAction.action === "kill" ? "kill" : "kill_all",
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
					sessions: listSharedSessions(context),
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

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace/timeline` && request.method === "GET") {
				const startedAt = performance.now();
				const webSession = await requireSession(request, context);
				const beforeSequence = parseTimelineBeforeCursor(url);
				const limit = parsePositiveIntSearchParam(url, "limit", TRACE_V2_DEFAULT_TIMELINE_LIMIT, TRACE_V2_MAX_TIMELINE_LIMIT);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				state.sessionQuery.upsertSession(selectedSession);
				const ownedSessions = listSharedSessions(context);
				const indexedSession = state.sessionQuery.getSession(selectedSession.id);
				let metadataMs = 0;
				const lastEventSequence = state.timelineQuery.getLatestEventSequence(selectedSession.id);
				const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: selectedSession.id });
				const liveSnapshots = beforeSequence === undefined ? state.outputCompactor.snapshotsForSession(selectedSession.id) : [];
				const transcriptMetadata = beforeSequence === undefined
					? await loadPiSessionMetadata(selectedSession, selectedSession.workspace ?? process.cwd())
					: undefined;
				const baseVersion = createFastTraceV2Version({
					session: selectedSession,
					sessions: ownedSessions,
					lastEventSequence,
					lastActivityAt: indexedSession?.lastActivityAt,
					status: indexedSession?.status,
					latestStreamId,
					transcript: transcriptMetadata,
				});
				const snapshotVersion = liveSnapshotVersion(liveSnapshots);
				const version = snapshotVersion ? `${baseVersion}:live:${snapshotVersion}` : baseVersion;
				const pageCursorKey = beforeSequence === undefined ? "tail" : `before:${beforeSequence}`;
				const cacheKey = traceCacheKey(selectedSession.id, `${baseVersion}:v2:limit:${limit}:${pageCursorKey}`);
				const pageCacheKey = traceCacheKey(selectedSession.id, `${version}:v2-page:limit:${limit}:${pageCursorKey}`);
				const cachedPage = state.traceTimelinePageCache.get(pageCacheKey);
				const cached = state.traceCache.get(cacheKey);
				const baseHeaders = {
					etag: etagForVersion(version),
					"x-pibo-trace-version": version,
					"cache-control": "no-store",
				};
				if (beforeSequence === undefined && requestMatchesVersion(request, version)) {
					return new Response(null, { status: 304, headers: baseHeaders });
				}
				if (cachedPage) {
					return responseJson(cachedPage, {
						headers: {
							...baseHeaders,
							"server-timing": [
								`trace_timeline;dur=${(performance.now() - startedAt).toFixed(1)}`,
								`trace_metadata;dur=${metadataMs.toFixed(1)}`,
								`trace_events;desc="0"`,
								`trace_cache;desc="page-hit"`,
							].join(", "),
						},
					});
				}
				let trace = cached;
				let eventCount = 0;
				if (!trace) {
					const events = state.timelineQuery.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit,
						...(beforeSequence !== undefined ? { beforeSequence } : {}),
					});
					const transcriptEntries = beforeSequence === undefined && transcriptMetadata?.sessionPath
						? readTailEntries(transcriptMetadata.sessionPath)
						: [];
					eventCount = events.length;
					trace = await buildTraceView({
						session: selectedSession,
						sessions: ownedSessions,
						events,
						status: indexedSession?.status,
						metadata: transcriptMetadata ?? {},
						transcriptEntries,
						includeRawEvents: false,
						latestStreamId,
					});
					trace = annotateTracePage(trace, events, { lastEventSequence, pageSize: limit, beforeSequence });
					setTraceCache(state.traceCache, cacheKey, trace, TRACE_CACHE_MAX_ENTRIES);
				}
				trace = withLiveSnapshots(trace, liveSnapshots, {
					piboSessionId: selectedSession.id,
					lastEventSequence,
					status: liveSnapshots.length ? "running" : indexedSession?.status,
				});
				trace = { ...trace, version };
				const page = traceTimelinePageFromView({
					trace,
					payloadStore: state.dataStore.payloads,
					limit,
					byteLimit: TRACE_V2_TIMELINE_HARD_BYTES,
					fromTail: beforeSequence === undefined,
				});
				setTraceTimelinePageCache(state.traceTimelinePageCache, pageCacheKey, page);
				return responseJson(page, {
					headers: {
						...baseHeaders,
						"server-timing": [
							`trace_timeline;dur=${(performance.now() - startedAt).toFixed(1)}`,
							`trace_metadata;dur=${metadataMs.toFixed(1)}`,
							`trace_events;desc="${eventCount}"`,
							`trace_cache;desc="${cached ? "hit" : "miss"}"`,
						].join(", "),
					},
				});
			}

			if (url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/trace/payload/`) && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const ref = decodeURIComponent(url.pathname.slice(`${CHAT_WEB_API_PREFIX}/trace/payload/`.length));
				const parsed = parseTracePayloadRef(ref);
				if (!parsed) throw new PiboWebHttpError("Invalid trace payload ref", 400);
				resolveRequestedSession(state, context, webSession, defaultProfile, parsed.piboSessionId);
				const offset = parseNonNegativeIntSearchParam(url, "offset", 0, Number.MAX_SAFE_INTEGER);
				const limit = parsePositiveIntSearchParam(url, "limit", TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES, TRACE_V2_PAYLOAD_MAX_LIMIT_BYTES);
				const chunk = readTracePayloadChunk({ payloadStore: state.dataStore.payloads, ref, offset, limit });
				if (!chunk) throw new PiboWebHttpError("Trace payload not found", 404);
				return responseJson(chunk, { headers: { "cache-control": "no-store" } });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace/raw-events` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const beforeSequence = parseTimelineBeforeCursor(url);
				const limit = parsePositiveIntSearchParam(url, "limit", TRACE_V2_RAW_EVENTS_DEFAULT_LIMIT, TRACE_V2_RAW_EVENTS_MAX_LIMIT);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				const events = state.timelineQuery.listTraceEvents({
					piboSessionId: selectedSession.id,
					limit,
					...(beforeSequence !== undefined ? { beforeSequence } : {}),
				});
				return responseJson(traceRawEventsPageFromEvents({
					piboSessionId: selectedSession.id,
					events,
					payloadStore: state.dataStore.payloads,
					limit,
				}), { headers: { "cache-control": "no-store" } });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace` && request.method === "GET") {
				const startedAt = performance.now();
				const webSession = await requireSession(request, context);
				const includeRawEvents = parseBooleanSearchParam(url, "includeRawEvents");
				const rawEventsLimit = parsePositiveIntSearchParam(url, "rawEventsLimit", 80, 1000);
				const beforeSequence = parseOptionalPositiveIntSearchParam(url, "beforeSequence");
				const eventLimit = url.searchParams.has("pageSize")
					? parsePositiveIntSearchParam(url, "pageSize", DEFAULT_TRACE_EVENTS_PAGE_SIZE, TRACE_V1_COMPAT_MAX_EVENTS_PER_REQUEST)
					: parsePositiveIntSearchParam(url, "eventLimit", DEFAULT_TRACE_EVENTS_PAGE_SIZE, TRACE_V1_COMPAT_MAX_EVENTS_PER_REQUEST);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				state.sessionQuery.upsertSession(selectedSession);
				const ownedSessions = listSharedSessions(context);
				const indexedSession = state.sessionQuery.getSession(selectedSession.id);
				const metadataStartedAt = performance.now();
				const metadata = await loadPiSessionMetadata(selectedSession, selectedSession.workspace ?? process.cwd());
				const metadataMs = performance.now() - metadataStartedAt;
				const lastEventSequence = state.timelineQuery.getLatestEventSequence(selectedSession.id);
				const latestStreamId = state.timelineQuery.getLatestStreamId({ piboSessionId: selectedSession.id });
				const liveSnapshots = beforeSequence === undefined ? state.outputCompactor.snapshotsForSession(selectedSession.id) : [];
				const baseVersion = createTraceViewVersion({
					session: selectedSession,
					sessions: ownedSessions,
					events: lastEventSequence > 0
						? [{ id: `seq:${lastEventSequence}`, eventSequence: lastEventSequence, createdAt: indexedSession?.lastActivityAt ?? "" }]
						: [],
					status: indexedSession?.status,
					metadata,
					latestStreamId,
				});
				const snapshotVersion = liveSnapshotVersion(liveSnapshots);
				const version = snapshotVersion ? `${baseVersion}:live:${snapshotVersion}` : baseVersion;
				const pageCursorKey = beforeSequence === undefined ? "tail" : `before:${beforeSequence}`;
				const cacheKey = traceCacheKey(selectedSession.id, `${baseVersion}:limit:${eventLimit}:${pageCursorKey}`);
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
					setTraceCache(state.traceCache, cacheKey, trace, TRACE_CACHE_MAX_ENTRIES);
				}
				trace = withLiveSnapshots(trace, liveSnapshots, {
					piboSessionId: selectedSession.id,
					lastEventSequence,
					status: liveSnapshots.length ? "running" : indexedSession?.status,
				});
				const estimatedTraceBytes = estimateTraceViewBytes(trace);
				if (estimatedTraceBytes > TRACE_V2_TIMELINE_HARD_BYTES) {
					pushResourceWarning(state.resourceMetrics, `Rejected over-budget V1 trace response for ${selectedSession.id} (${estimatedTraceBytes} estimated bytes).`);
					return responseJson({
						error: "Full trace response exceeds the V1 compatibility budget. Use /api/chat/trace/timeline and payload refs.",
						estimatedBytes: estimatedTraceBytes,
						budgetBytes: TRACE_V2_TIMELINE_HARD_BYTES,
					}, { status: 413, headers: { ...baseHeaders, "x-pibo-trace-v1-deprecated": "true", ...serverTiming(cached ? "hit" : "miss", eventCount) } });
				}
				if (includeRawEvents) {
					const rawEvents = state.timelineQuery.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit: rawEventsLimit,
						...(beforeSequence !== undefined ? { beforeSequence } : {}),
					});
					eventCount = eventCount || rawEvents.length;
					return responseJson(withRawTraceTail(trace, rawEvents), { headers: { ...baseHeaders, "x-pibo-trace-v1-deprecated": "true", ...serverTiming(cached ? "hit" : "miss", eventCount) } });
				}
				return responseJson({ ...trace, rawEvents: [] }, { headers: { ...baseHeaders, "x-pibo-trace-v1-deprecated": "true", ...serverTiming(cached ? "hit" : "miss", eventCount) } });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/debug/persistence` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({
					persistence: serializePersistenceMetrics(state.persistenceMetrics),
					liveObservers: listLiveObservers(state),
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/debug/resources` && request.method === "GET") {
				await requireSession(request, context);
				return responseJson({ gateway: serializeGatewayResourceDiagnostics(state) }, { headers: { "cache-control": "no-store" } });
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
				const ownedSessions = listSharedSessions(context);
				const indexedSession = state.sessionQuery.getSession(piboSessionId);
				const trace = await buildTraceView({
					session,
					sessions: ownedSessions,
					events: state.timelineQuery.listTraceEvents({ piboSessionId, beforeOrAtSequence: eventSequence, limit: DEFAULT_TRACE_EVENTS_PAGE_SIZE }),
					status: indexedSession?.status,
				});
				return responseJson(trace);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/debug/streaming-fixture` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatStreamingFixtureBody>(request);
				return startChatStreamingFixture({ state, context, webSession, defaultProfile, body });
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
				const piboSessionId = typeof body.piboSessionId === "string" ? body.piboSessionId : undefined;
				if (isProviderAuthAction(body.action)) {
					return providerAuthActionResponse({ piboSessionId, action: body.action, result: await executeProviderAuthAction(body.action, body.params) });
				}
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					piboSessionId,
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
				const streamMode = parseEventStreamMode(
					url.searchParams.get("mode"),
					defaultEventStreamMode({ requestedRoomId, requestedPiboSessionId }),
				);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					requestedPiboSessionId,
					requestedRoomId,
				);
				const cursor = parseSseCursor(url.searchParams.get("since")) ?? parseSseCursor(request.headers.get("last-event-id"));
				const transientReplayCursor = parseTransientReplayCursor(url.searchParams.get("liveSince"));
				if (!requestedRoomId && state.projectService.getProjectSession(selectedSession.id)) {
					return createEventStream({
						piboSessionId: selectedSession.id,
						activePiboSessionId: selectedSession.id,
						mode: streamMode,
						context,
						state,
						cursor,
						transientReplayCursor,
					});
				}
				const roomId = requestedRoomId ?? selectedRoomIdForSession(state, context, selectedSession);
				requireRoom(state, roomId, webSession, "read");
				const streamPiboSessionId = requestedPiboSessionId || !requestedRoomId ? selectedSession.id : undefined;
				return createEventStream({
					roomId: streamPiboSessionId ? undefined : roomId,
					piboSessionId: streamPiboSessionId,
					activePiboSessionId: streamPiboSessionId ? selectedSession.id : undefined,
					mode: streamMode,
					context,
					state,
					cursor,
					transientReplayCursor,
				});
			}

			return undefined;
		},
	};
}
