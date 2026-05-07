import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import os from "node:os";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../core/events.js";
import { PiboWebHttpError, readJsonBody, responseHtml, responseJson } from "../../web/http.js";
import type { PiboWebApp, PiboWebAppContext, PiboWebSession } from "../../web/types.js";
import type { PiboSession, UpdatePiboSessionInput } from "../../sessions/store.js";
import { ChatEventLog, createDefaultChatEventLog, type StoredChatEvent } from "./event-log.js";
import { OutputCompactor } from "./output-compactor.js";
import { isPersistableOutputEvent } from "./output-event-policy.js";
import { ChatWebReadModel, createDefaultChatWebReadModel } from "./read-model.js";
import {
	chatRoomIdFromMetadata,
	createDefaultPiboRoomStore,
	isDefaultPiboRoom,
	isPiboRoomArchived,
	PiboRoomStore,
	roomWorkspaceFromMetadata,
	withChatRoomId,
	withPiboRoomArchived,
	withPiboRoomWorkspace,
	type PiboRoom,
	type PiboRoomNode,
} from "./rooms.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState, type ChatStreamEvent } from "./stream.js";
import { buildSessionNodes, buildTraceView, createTraceViewVersion, loadPiSessionMetadata, type PiboSessionTraceView } from "./trace.js";
import { isChatWebSessionArchived, withChatWebArchived } from "./session-metadata.js";
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

export const CHAT_WEB_APP_NAME = "pibo.chat-web";
export const CHAT_WEB_CHANNEL = "pibo.chat-web";
export const CHAT_WEB_MOUNT_PATH = "/apps/chat";
export const CHAT_WEB_API_PREFIX = "/api/chat";

export type ChatWebAppOptions = {
	defaultProfile?: string;
	readModelPath?: string;
	eventLogPath?: string;
	roomStorePath?: string;
	agentStorePath?: string;
	reliabilityStorePath?: string;
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

type ChatWebAppState = {
	readModel: ChatWebReadModel;
	eventLog: ChatEventLog;
	roomStore: PiboRoomStore;
	agentStore: CustomAgentStore;
	reliabilityStore: PiboReliabilityStore;
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
	builtinTools?: unknown;
	builtinToolNames?: unknown;
	autoContextFiles?: unknown;
	runControl?: unknown;
	archived?: unknown;
	confirmName?: unknown;
};

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
};

type ChatMessageBody = {
	piboSessionId?: unknown;
	roomId?: unknown;
	text?: unknown;
	clientTxnId?: unknown;
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

function roomResourcePath(pathname: string): { roomId: string; child?: "events" | "messages" } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/rooms/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname
		.slice(prefix.length)
		.split("/")
		.filter((part) => part.length > 0);
	if (parts.length < 1 || parts.length > 2) return undefined;
	try {
		const roomId = decodeURIComponent(parts[0]);
		const child = parts[1] ? (decodeURIComponent(parts[1]) as "events" | "messages") : undefined;
		if (child && child !== "events" && child !== "messages") return undefined;
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

const TRACE_RENDER_EVENTS_LIMIT = 10_000;

function traceCacheKey(piboSessionId: string, version: string): string {
	return [piboSessionId, version, "structural"].join(":");
}

function withRawTraceTail(trace: PiboSessionTraceView, rawEvents: PiboSessionTraceView["rawEvents"]): PiboSessionTraceView {
	if (rawEvents.length === 0) return trace;
	return { ...trace, rawEvents };
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

function createReadModel(path?: string): ChatWebReadModel {
	return path ? new ChatWebReadModel(path) : createDefaultChatWebReadModel();
}

function createEventLog(path?: string): ChatEventLog {
	return path ? new ChatEventLog(path) : createDefaultChatEventLog();
}

function createRoomStore(path?: string): PiboRoomStore {
	return path ? new PiboRoomStore(path) : createDefaultPiboRoomStore();
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
	}, cwd);
}

function createReliabilityStore(path?: string): PiboReliabilityStore {
	return path ? new PiboReliabilityStore(path) : createDefaultPiboReliabilityStore();
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
				state.readModel.recordEvent(liveEvent, session);
				for (const listener of state.liveListeners) {
					listener({ roomId: room?.id, piboSessionId: liveEvent.piboSessionId, eventType: liveEvent.type, payload: liveEvent });
				}
			}
			for (const persistableEvent of result.persistedEvents) {
				if (!isPersistableOutputEvent(persistableEvent)) continue;
				const stored = state.eventLog.appendOutputEvent(persistableEvent, {
					roomId: room?.id,
					actorId: session?.ownerScope,
				});
				if (!stored) continue;
				if (persistableEvent.type === "assistant_message" || persistableEvent.type === "message_finished") {
					markActiveSessionRead(state, persistableEvent.piboSessionId, stored.streamId);
				}
				state.readModel.recordEvent(persistableEvent, session, stored.streamId);
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
		state.eventLog.markSessionRead(piboSessionId, principalId, streamId);
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
	const defaultRoom = input.state.roomStore.ensureDefaultRoom({
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
		: state.roomStore.ensureDefaultRoom({
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
	const existingRoom = roomId ? state.roomStore.getRoom(roomId) : undefined;
	if (existingRoom) return existingRoom;
	const ownerScope = session.ownerScope ?? webSession?.ownerScope;
	if (!ownerScope) {
		return state.roomStore.ensureDefaultRoom({ ownerScope: "system:unknown", principalId: "system:unknown" });
	}
	const principalId = webSession ? principalIdFor(webSession) : ownerScope;
	const room = state.roomStore.ensureDefaultRoom({ ownerScope, principalId });
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
		room = state.roomStore.requireRoomAccess(roomId, principalIdFor(webSession), action);
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
	state.readModel.deleteSessions(orderedIds);
	state.eventLog.deleteSessions(orderedIds);
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
	state.readModel.deleteSessions(orderedIds);
	state.eventLog.deleteSessions(orderedIds);
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
	const rooms = state.roomStore.listRoomSubtree(room.id);
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
	state.readModel.deleteSessions(orderedSessionIds);
	state.eventLog.deleteSessions(orderedSessionIds);
	state.eventLog.deleteRooms(roomIds);
	for (const id of orderedSessionIds) deleteSession(id);
	const orderedRoomIds = [...roomIds].reverse();
	state.roomStore.deleteRooms(orderedRoomIds);
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

function indexOwnedSessions(readModel: ChatWebReadModel, sessions: PiboSession[]): void {
	readModel.upsertSessionsIfChanged(sessions);
}

function markSessionsRead(state: ChatWebAppState, sessions: PiboSession[], principalId: string): void {
	for (const session of sessions) {
		const latestStreamId = state.eventLog.getLatestStreamId({ piboSessionId: session.id });
		if (latestStreamId !== undefined) state.eventLog.markSessionRead(session.id, principalId, latestStreamId);
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
	return state.eventLog.countUnreadMessagesBySession({
		piboSessionIds: visibleSessionIds,
		principalId,
	});
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
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? defaultRoomId;
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
			for (const stored of input.state.eventLog.listEvents({
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
	input.state.readModel.upsertSession(selectedSession);
	const actorId = principalIdFor(input.webSession);
	const duplicate = clientTxnId ? input.state.eventLog.findByClientTxn(room.id, actorId, clientTxnId) : undefined;
	if (duplicate) return responseJson({ duplicate: true, event: duplicate });
	const accepted = input.state.eventLog.appendEvent({
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
		const failed = input.state.eventLog.appendEvent({
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
		`${CHAT_WEB_MOUNT_PATH}/icons/pibo-icon-192.png`,
		`${CHAT_WEB_MOUNT_PATH}/icons/pibo-icon-512.png`,
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
	<link rel="apple-touch-icon" href="/apps/chat/icons/pibo-icon-192.png">
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
						<textarea id="message" name="message" placeholder="Message selected session or type /"></textarea>
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
	const storagePath = options.readModelPath;
	const state: ChatWebAppState = {
		readModel: createReadModel(storagePath),
		eventLog: createEventLog(options.eventLogPath ?? storagePath),
		roomStore: createRoomStore(options.roomStorePath ?? storagePath),
		agentStore: createAgentStore(options.agentStorePath ?? storagePath),
		reliabilityStore: createReliabilityStore(options.reliabilityStorePath),
		traceCache: new Map(),
		outputCompactor: new OutputCompactor(),
		liveListeners: new Set(),
		activeEventStreams: new Map(),
		activeTraceSessions: new Set(),
		persistenceMetrics: createPersistenceMetrics(),
		userSkillManager: new UserSkillManager(os.homedir()),
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
				const defaultRoom = state.roomStore.ensureDefaultRoom({
					ownerScope: webSession.ownerScope,
					principalId,
				});
				if (markRead) {
					markSessionsRead(state, [selectedSession], principalId);
				}
				indexOwnedSessions(state.readModel, roomSessions);
				const sessionUnreadCounts = buildSessionUnreadCounts(state, ownedSessions, principalId);
				const [sessions, catalog] = await Promise.all([
					buildSessionNodes(
						roomSessions,
						state.readModel.listSessions(),
						process.cwd(),
						sessionUnreadCounts,
					),
					loadBootstrapCatalog(state, context, webSession),
				]);
				const roomTree = state.roomStore.listRoomTree(webSession.ownerScope);
				const roomUnreadCounts = buildRoomUnreadCounts(ownedSessions, sessionUnreadCounts, defaultRoom.id);
				const rooms = roomsWithUnreadCounts(roomTree, roomUnreadCounts);
				return responseJson({
					identity: webSession.authSession.identity,
					session: selectedSession,
					room: state.roomStore.getRoom(selectedRoomId),
					selectedRoomId,
					selectedPiboSessionId: selectedSession.id,
					rooms,
					sessions,
					...catalog,
				});
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

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/agent-catalog` && request.method === "GET") {
				await requireSession(request, context);
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
				state.readModel.upsertSession(selectedSession);
				return responseJson({
					identity: webSession.authSession.identity,
					session: selectedSession,
					room: state.roomStore.getRoom(selectedRoomIdForSession(state, context, selectedSession)),
					capabilities: {
						actions: context.channelContext.getGatewayActions(),
					},
				});
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/sessions` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const includeArchived = parseBooleanSearchParam(url, "includeArchived");
				const roomId = url.searchParams.get("roomId") || undefined;
				const selectedSession = ensureDefaultChatSession(state, context, webSession, defaultProfile, roomId);
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
				indexOwnedSessions(state.readModel, roomSessions);
				return responseJson(
					await buildSessionNodes(
						roomSessions,
						state.readModel.listSessions(),
						process.cwd(),
						new Map(),
					),
				);
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/sessions` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatSessionCreateBody>(request);
				const profile = resolveCreateSessionProfile(context, defaultProfile, body.profile);
				const room =
					typeof body.roomId === "string"
						? requireRoom(state, body.roomId, webSession, "write")
						: state.roomStore.ensureDefaultRoom({
								ownerScope: webSession.ownerScope,
								principalId: principalIdFor(webSession),
							});
				const created = createPersonalChatSession(context, webSession, profile, room);
				state.readModel.upsertSession(created);
				return responseJson({ session: created }, { status: 201 });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "GET") {
				const webSession = await requireSession(request, context);
				state.roomStore.ensureDefaultRoom({
					ownerScope: webSession.ownerScope,
					principalId: principalIdFor(webSession),
				});
				return responseJson({ rooms: state.roomStore.listRoomTree(webSession.ownerScope) });
			}

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "POST") {
				requireSameOriginJsonRequest(request);
				const webSession = await requireSession(request, context);
				const body = await readJsonBody<ChatRoomCreateBody>(request);
				const parentRoomId = normalizeParentRoomId(body.parentRoomId);
				if (parentRoomId) requireRoom(state, parentRoomId, webSession, "admin");
				const room = state.roomStore.createRoom({
					ownerScope: webSession.ownerScope,
					name: normalizeRoomName(body.name),
					topic: normalizeRoomTopic(body.topic),
					metadata: withPiboRoomWorkspace(undefined, normalizeRoomWorkspace(body.workspace)),
					type: normalizeRoomType(body.type),
					parentRoomId,
				});
				state.roomStore.ensureMember({ roomId: room.id, principalId: principalIdFor(webSession), role: "owner" });
				return responseJson({ room }, { status: 201 });
			}

			const roomResource = roomResourcePath(url.pathname);
			if (roomResource && roomResource.child === undefined && request.method === "GET") {
				const webSession = await requireSession(request, context);
				const room = requireRoom(state, roomResource.roomId, webSession, "read");
				const ownedSessions = sessionsInRoom(listOwnedSessions(context, webSession), room.id);
				indexOwnedSessions(state.readModel, ownedSessions);
				return responseJson({
					room,
					member: state.roomStore.getMember(room.id, principalIdFor(webSession)),
					sessions: await buildSessionNodes(
						ownedSessions,
						state.readModel.listSessions(),
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
				const room = state.roomStore.updateRoom(roomResource.roomId, update);
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
					events: state.eventLog.listEvents({
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
				if (body.profile !== undefined && (state.activeTraceSessions.has(selectedSession.id) || state.readModel.hasSessionActivity(selectedSession.id))) {
					throw new PiboWebHttpError("Session profile can only be changed before the first message.", 400);
				}
				const updated = updateSession(selectedSession.id, createSessionUpdate(context, selectedSession, body));
				if (!updated) throw new PiboWebHttpError("Session not found", 404);
				if (body.archived === true) {
					markSessionsRead(state, sessionSubtree(listOwnedSessions(context, webSession), selectedSession.id), principalIdFor(webSession));
				}
				state.readModel.upsertSession(updated);
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

			if (url.pathname === `${CHAT_WEB_API_PREFIX}/trace` && request.method === "GET") {
				const startedAt = performance.now();
				const webSession = await requireSession(request, context);
				const includeRawEvents = parseBooleanSearchParam(url, "includeRawEvents");
				const rawEventsLimit = parsePositiveIntSearchParam(url, "rawEventsLimit", 80, 1000);
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
				);
				state.readModel.upsertSession(selectedSession);
				const ownedSessions = listOwnedSessions(context, webSession);
				const indexedSession = state.readModel.getSession(selectedSession.id);
				const metadataStartedAt = performance.now();
				const metadata = await loadPiSessionMetadata(selectedSession, selectedSession.workspace ?? process.cwd());
				const metadataMs = performance.now() - metadataStartedAt;
				const lastEventSequence = state.readModel.getLatestEventSequence(selectedSession.id);
				const latestStreamId = state.eventLog.getLatestStreamId({ piboSessionId: selectedSession.id });
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
				const cacheKey = traceCacheKey(selectedSession.id, version);
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
				if (!includeRawEvents && requestMatchesVersion(request, version)) {
					return new Response(null, { status: 304, headers: { ...baseHeaders, ...serverTiming(cached ? "hit" : "miss") } });
				}
				let trace = cached;
				let eventCount = 0;
				if (!trace) {
					const events = state.readModel.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit: TRACE_RENDER_EVENTS_LIMIT,
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
					setTraceCache(state.traceCache, cacheKey, trace);
				}
				if (includeRawEvents) {
					const rawEvents = state.readModel.listTraceEvents({
						piboSessionId: selectedSession.id,
						limit: rawEventsLimit,
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
				const indexedSession = state.readModel.getSession(piboSessionId);
				const trace = await buildTraceView({
					session,
					sessions: ownedSessions,
					events: state.readModel.listTraceEvents({ piboSessionId, beforeOrAtSequence: eventSequence, limit: TRACE_RENDER_EVENTS_LIMIT }),
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
				state.readModel.upsertSession(selectedSession);
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
				const selectedSession = resolveRequestedSession(
					state,
					context,
					webSession,
					defaultProfile,
					url.searchParams.get("piboSessionId") || undefined,
					requestedRoomId,
				);
				const roomId = requestedRoomId ?? selectedRoomIdForSession(state, context, selectedSession);
				requireRoom(state, roomId, webSession, "read");
				const cursor = parseSseCursor(url.searchParams.get("since")) ?? parseSseCursor(request.headers.get("last-event-id"));
				return createEventStream({
					roomId: url.searchParams.has("roomId") ? roomId : undefined,
					piboSessionId: url.searchParams.has("roomId") ? undefined : selectedSession.id,
					activePiboSessionId: selectedSession.id,
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
