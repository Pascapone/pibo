import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CHAT_WEB_CHANNEL } from "../apps/chat/web-app.js";
import { ChatRoomService } from "../apps/chat/data/room-service.js";
import { chatRoomIdFromMetadata, withChatRoomId } from "../apps/chat/types/rooms.js";
import { piboHomePath } from "../core/pibo-home.js";
import { getDefaultPiboWorkspace } from "../core/workspace.js";
import { createDefaultPiboDataStore, type PiboDataStore } from "../data/pibo-store.js";
import { DEFAULT_GATEWAY_PORT as DEFAULT_REMOTE_GATEWAY_PORT } from "../gateway/protocol.js";
import { sendGatewayMessageAndWaitForReply } from "../gateway/request.js";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { PiboSession, PiboSessionStore } from "../sessions/store.js";
import { PiboRemoteAgentAuth, type IssuedDeviceCode, type IssuedRemoteToken } from "./auth.js";
import { PiboRemoteAgentMcpServer, type PiboRemoteAgentServerAddress } from "./mcp-server.js";
import { PiboRemoteAgentOAuth, REMOTE_OAUTH_PATHS } from "./oauth.js";
import { buildBashModuleTools } from "./modules/bash.js";
import { buildFilesModuleTools } from "./modules/files.js";
import { buildObserveModuleTools, type RemoteObservePort } from "./modules/observe.js";
import { buildSessionModuleTools, type RemoteSessionPort, type RemoteSessionSummary } from "./modules/sessions.js";
import { assertAbsoluteSandboxRoot } from "./sandbox.js";
import { createDefaultPiboRemoteAgentStore, PiboRemoteAgentStore } from "./store.js";
import type { RemoteModuleTool, RemoteToolContext } from "./tool.js";
import {
	effectiveRemoteMode,
	REMOTE_AGENT_ALLOWED_PROFILES_MAX_COUNT,
	REMOTE_AGENT_FAMILY_BINDING,
	REMOTE_AGENT_FAMILY_DEFAULT_PROFILE,
	REMOTE_AGENT_HISTORY_DEFAULT_LIMIT,
	REMOTE_AGENT_HISTORY_MAX_LIMIT,
	REMOTE_AGENT_MODULES,
	REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH,
	REMOTE_AGENT_SESSION_METADATA_KEY,
	RemoteAgentError,
	type NewRemoteToolCallRecord,
	type RemoteAgentModuleName,
	type RemoteAgentRuntime,
	type RemoteRoomAgents,
	type RemoteRoomConfig,
	type RemoteRoomConfigPatch,
	type RemoteTokenInfo,
	type RemoteTokenScope,
	type RemoteToolCallRecord,
} from "./types.js";

export type PiboRemoteAgentServiceOptions = {
	store?: PiboRemoteAgentStore;
	sessionStore?: PiboSessionStore;
	dataStore?: PiboDataStore;
	defaultProfile?: string;
	resolveRoomWorkspace?: (roomId: string) => string | undefined;
	sendMessage?: RemoteSessionPort["sendSessionMessage"];
	mcpHost?: "127.0.0.1" | "::1";
	mcpPort?: number;
	publicBaseUrl?: string;
	/** TCP gateway port for remote_session_send (default 4789; dev gateways use 4809). */
	gatewayPort?: number;
	now?: () => number;
};

/** Where the running MCP server publishes its loopback URL for CLI/tab discovery. */
export function remoteAgentAddressFilePath(): string {
	return piboHomePath("remote-agent", "mcp-address.json");
}

export function readRemoteAgentAddressFile(path = remoteAgentAddressFilePath()): PiboRemoteAgentServerAddress & { pid: number } | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { host?: unknown; port?: unknown; url?: unknown; pid?: unknown };
		if (typeof parsed.url !== "string" || typeof parsed.port !== "number" || typeof parsed.pid !== "number") return undefined;
		return { host: typeof parsed.host === "string" ? parsed.host : "127.0.0.1", port: parsed.port, url: parsed.url, pid: parsed.pid };
	} catch {
		return undefined;
	}
}

function sessionSummary(session: PiboSession): RemoteSessionSummary {
	return {
		id: session.id,
		...(session.title ? { title: session.title } : {}),
		profile: session.profile,
		channel: session.channel,
		kind: session.kind,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

/** Fill agent defaults by runtime family; the default is always an allowed agent. */
function normalizeRoomAgents(config: Pick<RemoteRoomConfig, "runtime" | "defaultProfile" | "allowedProfiles">): { defaultProfile: string; allowedProfiles: string[] } {
	const familyDefault = REMOTE_AGENT_FAMILY_DEFAULT_PROFILE[config.runtime];
	const defaultProfile = config.defaultProfile.trim() || familyDefault;
	const allowed = [defaultProfile];
	for (const name of config.allowedProfiles) {
		const trimmed = name.trim();
		if (trimmed && !allowed.includes(trimmed)) allowed.push(trimmed);
	}
	return { defaultProfile, allowedProfiles: allowed };
}

function validateAgentsPatch(patch: RemoteRoomConfigPatch): void {
	if (patch.defaultProfile !== undefined) {
		const trimmed = patch.defaultProfile.trim();
		if (!trimmed) throw new RemoteAgentError("profile_invalid", "defaultProfile must not be empty.");
		if (trimmed.length > REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH) {
			throw new RemoteAgentError("profile_invalid", `defaultProfile must be at most ${REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH} characters.`);
		}
	}
	if (patch.allowedProfiles !== undefined) {
		if (!Array.isArray(patch.allowedProfiles)) throw new RemoteAgentError("profile_invalid", "allowedProfiles must be an array of profile names.");
		if (patch.allowedProfiles.length > REMOTE_AGENT_ALLOWED_PROFILES_MAX_COUNT) {
			throw new RemoteAgentError("profile_invalid", `allowedProfiles must hold at most ${REMOTE_AGENT_ALLOWED_PROFILES_MAX_COUNT} profiles.`);
		}
		for (const name of patch.allowedProfiles) {
			if (typeof name !== "string" || !name.trim()) throw new RemoteAgentError("profile_invalid", "allowedProfiles must hold non-empty profile names.");
			if (name.trim().length > REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH) {
				throw new RemoteAgentError("profile_invalid", `Profile names must be at most ${REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH} characters.`);
			}
		}
	}
}

export class PiboRemoteAgentService {
	private readonly store: PiboRemoteAgentStore;
	private readonly ownsStore: boolean;
	private readonly sessionStore: PiboSessionStore;
	private readonly dataStore: PiboDataStore;
	private readonly auth: PiboRemoteAgentAuth;
	private readonly server: PiboRemoteAgentMcpServer;
	private readonly sessionPort: RemoteSessionPort;
	private readonly observePort: RemoteObservePort;
	private readonly defaultProfile: string;
	private readonly resolveRoomWorkspace?: (roomId: string) => string | undefined;
	private readonly publicBaseUrl?: string;
	private readonly gatewayPort?: number;
	private readonly now: () => number;

	constructor(options: PiboRemoteAgentServiceOptions = {}) {
		this.store = options.store ?? createDefaultPiboRemoteAgentStore();
		this.ownsStore = options.store === undefined;
		this.sessionStore = options.sessionStore ?? createDefaultPiboDataSessionStore();
		this.dataStore = options.dataStore ?? createDefaultPiboDataStore();
		this.now = options.now ?? Date.now;
		this.auth = new PiboRemoteAgentAuth({ store: this.store, now: this.now });
		this.defaultProfile = options.defaultProfile ?? "default";
		this.resolveRoomWorkspace = options.resolveRoomWorkspace;
		const gatewayPort = options.gatewayPort;
		this.gatewayPort = gatewayPort;
		const sendMessage = options.sendMessage ?? (async (sessionId, message) => {
			const result = await sendGatewayMessageAndWaitForReply({
				type: "message",
				piboSessionId: sessionId,
				text: message,
				source: "actor",
			}, ...(gatewayPort !== undefined ? [{ port: gatewayPort }] : []));
			if (!result.response.ok) {
				throw new RemoteAgentError("send_failed", result.response.error?.message ?? "Gateway rejected the message.");
			}
			return { eventId: result.reply.eventId ?? result.response.id, reply: result.reply.text };
		});
		this.sessionPort = this.createSessionPort(sendMessage);
		this.observePort = this.createObservePort();
		const publicBaseUrl = options.publicBaseUrl?.trim().replace(/\/+$/, "") || undefined;
		this.publicBaseUrl = publicBaseUrl;
		const oauth = new PiboRemoteAgentOAuth({
			resolveIssuer: () => publicBaseUrl ?? this.serverAddressForIssuer(),
			port: {
				listEnabledRoomIds: () => this.store.listEnabledRoomIds(),
				roomDisplayName: (roomId) => this.roomDisplayName(roomId),
				getRoomConfig: (roomId) => this.getRoomConfig(roomId),
				isRoomActive: (roomId) => this.isRoomActive(roomId),
				claimDeviceCode: (code, roomId) => this.claimOAuthDeviceCode(code, roomId),
				issueToken: (roomId, label, modules) => {
					const issued = this.auth.issueToken(roomId, label, modules);
					return { token: issued.token, expiresAt: issued.info.expiresAt };
				},
			},
			now: this.now,
		});
		this.server = new PiboRemoteAgentMcpServer({
			...(options.mcpHost ? { host: options.mcpHost } : {}),
			...(options.mcpPort !== undefined ? { port: options.mcpPort } : {}),
			...(publicBaseUrl ? { publicBaseUrl } : {}),
			oauth,
			authenticate: (token) => this.auth.authenticate(token),
			isRoomActive: (roomId) => this.isRoomActive(roomId),
			resolveTools: (scope) => this.resolveTools(scope),
			resolveContext: (scope, toolCallId, signal) => this.resolveContext(scope, toolCallId, signal),
			catalogTools: () => this.catalogTools(),
			recordToolCall: (record) => this.recordToolCall(record),
		});
	}

	close(): void {
		if (this.ownsStore) this.store.close();
	}

	get roomStore(): PiboRemoteAgentStore {
		return this.store;
	}

	// -- room config ------------------------------------------------------

	/**
	 * Default working directory for a room, mirroring UI-created sessions:
	 * explicit resolver, then the room workspace, then the default workspace.
	 */
	defaultSandboxPath(roomId: string): string {
		return this.resolveRoomWorkspace?.(roomId)?.trim()
			|| this.roomWorkspaceOf(roomId)
			|| getDefaultPiboWorkspace();
	}

	private roomWorkspaceOf(roomId: string): string | undefined {
		try {
			return new ChatRoomService(this.dataStore).getRoom(roomId)?.workspace?.trim() || undefined;
		} catch {
			return undefined;
		}
	}

	getRoomConfig(roomId: string): RemoteRoomConfig {
		const stored = this.store.getRoomConfig(roomId) ?? {
			roomId,
			enabled: false,
			mode: "sandbox",
			runtime: "muse",
			sandboxPath: this.defaultSandboxPath(roomId),
			modules: { sessions: true, observe: true, files: true, bash: false },
			defaultProfile: "",
			allowedProfiles: [],
			allowInternet: false,
			updatedAt: new Date(this.now()).toISOString(),
		};
		// Empty stored path follows the room default (project folder).
		const sandboxPath = stored.sandboxPath.trim() || this.defaultSandboxPath(roomId);
		return { ...stored, sandboxPath, ...normalizeRoomAgents(stored) };
	}

	/** Agents (profiles) the remote client may use in this room. */
	listRoomAgents(roomId: string): RemoteRoomAgents {
		const config = this.getRoomConfig(roomId);
		return {
			runtime: config.runtime,
			runtimeInstanceId: REMOTE_AGENT_FAMILY_BINDING[config.runtime].runtimeInstanceId,
			defaultProfile: config.defaultProfile,
			agents: config.allowedProfiles.map((name) => ({ name, isDefault: name === config.defaultProfile })),
		};
	}

	setRoomConfig(roomId: string, patch: RemoteRoomConfigPatch): RemoteRoomConfig {
		const trimmed = roomId.trim();
		if (!trimmed) throw new RemoteAgentError("room_invalid", "roomId is required.");
		if (patch.mode !== undefined && patch.mode !== "sandbox" && patch.mode !== "yolo") {
			throw new RemoteAgentError("mode_invalid", "mode must be sandbox or yolo.");
		}
		if (patch.runtime !== undefined && patch.runtime !== "muse" && patch.runtime !== "pi") {
			throw new RemoteAgentError("runtime_invalid", "runtime must be muse or pi.");
		}
		if (patch.allowInternet !== undefined && typeof patch.allowInternet !== "boolean") {
			throw new RemoteAgentError("internet_invalid", "allowInternet must be a boolean.");
		}
		if (patch.modules !== undefined) {
			for (const key of Object.keys(patch.modules)) {
				if (!REMOTE_AGENT_MODULES.includes(key as RemoteAgentModuleName)) {
					throw new RemoteAgentError("module_invalid", `Unknown module: ${key}.`);
				}
			}
		}
		validateAgentsPatch(patch);
		let sandboxPath = patch.sandboxPath?.trim();
		// Empty clears the override: the room follows its default (project folder) again.
		if (sandboxPath) sandboxPath = assertAbsoluteSandboxRoot(sandboxPath);
		const stored = this.store.getRoomConfig(trimmed);
		const nextRuntime: RemoteAgentRuntime = patch.runtime ?? stored?.runtime ?? "muse";
		const agentsPatch: Pick<RemoteRoomConfigPatch, "defaultProfile" | "allowedProfiles"> = {};
		if (patch.defaultProfile !== undefined) agentsPatch.defaultProfile = patch.defaultProfile.trim();
		if (patch.allowedProfiles !== undefined) {
			agentsPatch.allowedProfiles = [...new Set(patch.allowedProfiles.map((name) => name.trim()).filter(Boolean))];
		}
		if (stored && patch.runtime !== undefined && patch.runtime !== stored.runtime
			&& patch.defaultProfile === undefined && patch.allowedProfiles === undefined) {
			// Family switch without explicit agents: reset to the new family defaults.
			agentsPatch.defaultProfile = REMOTE_AGENT_FAMILY_DEFAULT_PROFILE[nextRuntime];
			agentsPatch.allowedProfiles = [REMOTE_AGENT_FAMILY_DEFAULT_PROFILE[nextRuntime]];
		}
		this.store.upsertRoomConfig(trimmed, {
			...patch,
			...agentsPatch,
			...(sandboxPath !== undefined ? { sandboxPath } : {}),
		}, { sandboxPath: this.defaultSandboxPath(trimmed), now: new Date(this.now()).toISOString() });
		// Return normalized (family defaults, default always allowed).
		const normalized = this.getRoomConfig(trimmed);
		// Always materialize: the path doubles as the session workspace in every mode.
		if (normalized.enabled) mkdirSync(normalized.sandboxPath, { recursive: true });
		if (!normalized.enabled) {
			this.server.closeRoomSessions(trimmed);
			this.auth.revokeRoomTokens(trimmed);
		}
		return normalized;
	}

	listRoomConfigs(): RemoteRoomConfig[] {
		return this.store.listRoomConfigs();
	}

	isRoomActive(roomId: string): boolean {
		return this.store.getRoomConfig(roomId)?.enabled === true;
	}

	private serverAddressForIssuer(): string {
		const address = this.server.getAddress();
		if (!address) return "http://127.0.0.1:0";
		return address.url.replace(/\/mcp$/, "");
	}

	/** Chat display name for a room id (consent page); undefined for synthetic ids. */
	roomDisplayName(roomId: string): string | undefined {
		try {
			return new ChatRoomService(this.dataStore).getRoom(roomId)?.name;
		} catch {
			return undefined;
		}
	}

	/** MCP URL for humans (tab, API): public when exposed, loopback otherwise. */
	displayMcpUrl(): string | undefined {
		if (this.publicBaseUrl) return `${this.publicBaseUrl}/mcp`;
		return this.server.getAddress()?.url;
	}

	get oauth(): PiboRemoteAgentOAuth {
		return this.server.oauthHandler;
	}

	oauthDiscovery(): { issuer: string; authorizeUrl: string; tokenUrl: string; metadataUrl: string } {
		const oauth = this.oauth;
		return {
			issuer: oauth.issuer(),
			authorizeUrl: oauth.endpoint(REMOTE_OAUTH_PATHS.authorize),
			tokenUrl: oauth.endpoint(REMOTE_OAUTH_PATHS.token),
			metadataUrl: oauth.endpoint(REMOTE_OAUTH_PATHS.protectedResourceMetadata),
		};
	}

	claimOAuthDeviceCode(code: string, roomId: string): { label: string } {
		const trimmed = roomId.trim();
		if (!this.isRoomActive(trimmed)) {
			throw new RemoteAgentError("room_inactive", "Enable remote access for this room first.");
		}
		const record = this.auth.claimDeviceCode(code, trimmed);
		return { label: record.label ?? "ChatGPT plugin" };
	}

	// -- auth ---------------------------------------------------------------

	createDeviceCode(roomId: string, label?: string): IssuedDeviceCode {
		if (!this.isRoomActive(roomId.trim())) {
			throw new RemoteAgentError("room_inactive", "Enable remote access for this room first.");
		}
		return this.auth.createDeviceCode(roomId, label);
	}

	redeemDeviceCode(code: string): IssuedRemoteToken {
		// Peek at the code's room first so the token snapshots the room's current modules.
		const normalized = code.trim().toUpperCase();
		const record = this.store.getDeviceCode(normalized);
		if (!record) throw new RemoteAgentError("code_invalid", "Device code is unknown, already used, or expired.");
		const config = this.getRoomConfig(record.roomId);
		if (!config.enabled) throw new RemoteAgentError("room_inactive", "Remote access is disabled for this room.");
		const modules = REMOTE_AGENT_MODULES.filter((module) => config.modules[module]);
		return this.auth.redeemDeviceCode(normalized, modules);
	}

	createToken(roomId: string, label?: string): IssuedRemoteToken {
		const trimmed = roomId.trim();
		const config = this.getRoomConfig(trimmed);
		if (!config.enabled) throw new RemoteAgentError("room_inactive", "Enable remote access for this room first.");
		const modules = REMOTE_AGENT_MODULES.filter((module) => config.modules[module]);
		return this.auth.issueToken(trimmed, label, modules);
	}

	listTokens(roomId?: string): RemoteTokenInfo[] {
		return this.auth.listTokens(roomId);
	}

	revokeToken(id: string): boolean {
		const revoked = this.auth.revokeToken(id);
		if (revoked) this.server.closeTokenSessions(id);
		return revoked;
	}

	pruneExpired(): { codes: number; tokens: number } {
		return this.auth.pruneExpired();
	}

	recordToolCall(record: NewRemoteToolCallRecord): void {
		try {
			this.store.insertToolCall(record);
		} catch {
			// History must never break tool execution.
		}
	}

	listToolCalls(roomId: string, limit = REMOTE_AGENT_HISTORY_DEFAULT_LIMIT): RemoteToolCallRecord[] {
		const parsed = Math.floor(limit);
		const clamped = Math.min(Math.max(Number.isFinite(parsed) ? parsed : REMOTE_AGENT_HISTORY_DEFAULT_LIMIT, 1), REMOTE_AGENT_HISTORY_MAX_LIMIT);
		return this.store.listToolCalls(roomId.trim(), clamped);
	}

	// -- MCP server -----------------------------------------------------------

	async ensureStarted(): Promise<PiboRemoteAgentServerAddress> {
		const address = await this.server.start();
		// Discovery aid only: a failing address file must never break the server.
		try {
			const file = remoteAgentAddressFilePath();
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, `${JSON.stringify({ ...address, pid: process.pid })}\n`, { mode: 0o600 });
		} catch (error) {
			console.error(`[pibo] Remote Agent could not publish its address file: ${error instanceof Error ? error.message : String(error)}`);
		}
		return address;
	}

	getAddress(): PiboRemoteAgentServerAddress | undefined {
		return this.server.getAddress();
	}

	async stop(): Promise<void> {
		await this.server.stop();
		try {
			const current = readRemoteAgentAddressFile();
			if (current && current.pid === process.pid) rmSync(remoteAgentAddressFilePath(), { force: true });
		} catch {}
	}

	status(): {
		running: boolean;
		url?: string;
		enabledRooms: string[];
		connections: number;
		gatewayPort: number;
		oauth: { issuer: string; authorizeUrl: string; tokenUrl: string; metadataUrl: string };
	} {
		const address = this.server.getAddress();
		const enabledRooms = this.store.listEnabledRoomIds();
		const now = new Date(this.now()).toISOString();
		const connections = this.store.listTokens().filter((token) => !token.revoked && token.expiresAt > now).length;
		return {
			running: address !== undefined,
			...(address ? { url: address.url } : {}),
			enabledRooms,
			connections,
			gatewayPort: this.gatewayPort ?? DEFAULT_REMOTE_GATEWAY_PORT,
			oauth: this.oauthDiscovery(),
		};
	}

	// -- internals ------------------------------------------------------------

	private createSessionPort(sendMessage: RemoteSessionPort["sendSessionMessage"]): RemoteSessionPort {
		const sessions = this.sessionStore;
		const defaultProfile = this.defaultProfile;
		const defaultSandboxPath = (roomId: string): string => this.defaultSandboxPath(roomId);
		const listAgents = (roomId: string): RemoteRoomAgents => this.listRoomAgents(roomId);
		return {
			listRoomSessions(roomId: string): RemoteSessionSummary[] {
				return sessions.find({ channel: CHAT_WEB_CHANNEL })
					.filter((session) => chatRoomIdFromMetadata(session.metadata) === roomId)
					.map(sessionSummary);
			},
			getRoomSession(roomId: string, sessionId: string) {
				const session = sessions.get(sessionId);
				if (!session || chatRoomIdFromMetadata(session.metadata) !== roomId) return undefined;
				return { ...sessionSummary(session), roomId };
			},
			createRoomSession(roomId: string, input: { title?: string; profile?: string }): RemoteSessionSummary {
				// The runtime requires an existing cwd (YOLO rooms never had it materialized).
				mkdirSync(defaultSandboxPath(roomId), { recursive: true });
				const agents = listAgents(roomId);
				const requested = input.profile?.trim() || agents.defaultProfile || defaultProfile;
				if (!agents.agents.some((agent) => agent.name === requested)) {
					throw new RemoteAgentError("profile_forbidden", `Profile "${requested}" is not enabled for this room. Allowed: ${agents.agents.map((agent) => agent.name).join(", ") || "(none)"}.`);
				}
				const binding = REMOTE_AGENT_FAMILY_BINDING[agents.runtime];
				const created = sessions.create({
					channel: CHAT_WEB_CHANNEL,
					kind: "chat",
					profile: requested,
					workspace: defaultSandboxPath(roomId),
					...(input.title?.trim() ? { title: input.title.trim() } : {}),
					// The marker lets the Muse adapter apply this room's internet posture
				// to exactly the remote-created sessions; interactive room sessions
				// keep the engine default.
				metadata: { ...withChatRoomId(undefined, roomId), [REMOTE_AGENT_SESSION_METADATA_KEY]: true },
					runtimeBinding: {
						runtimeInstanceId: binding.runtimeInstanceId,
						adapterId: binding.adapterId,
						state: "unbound",
						protocol: binding.protocol,
					},
				});
				return sessionSummary(created);
			},
			sendSessionMessage: sendMessage,
			listRoomAgents: (roomId: string) => this.listRoomAgents(roomId),
		};
	}

	private createObservePort(): RemoteObservePort {
		const sessions = this.sessionStore;
		const data = this.dataStore;
		return {
			getRoomSession(roomId: string, sessionId: string) {
				const session = sessions.get(sessionId);
				if (!session || chatRoomIdFromMetadata(session.metadata) !== roomId) return undefined;
				return { id: session.id, ...(session.title ? { title: session.title } : {}) };
			},
			listSessionMessages(sessionId: string) {
				return data.messages.listMessages(sessionId).map((message) => ({
					id: message.id,
					role: message.role,
					text: message.contentPreview ?? "",
					createdAt: message.createdAt,
				}));
			},
			listSessionObservations(sessionId: string, limit: number) {
				return data.observations.listObservations(sessionId, limit).map((record) => ({
					sequence: record.sequence,
					kind: record.kind,
					status: record.status,
					...(record.previewText ? { text: record.previewText } : {}),
					...(record.kind === "tool" && record.name ? { toolName: record.name } : {}),
					startedAt: record.startedAt,
				}));
			},
		};
	}

	/** Ungated catalog for the public OpenAPI document. Runtime calls stay token-gated. */
	catalogTools(): RemoteModuleTool[] {
		return [
			...buildSessionModuleTools(this.sessionPort),
			...buildObserveModuleTools(this.observePort),
			...buildFilesModuleTools(),
			...buildBashModuleTools(),
		];
	}

	private resolveTools(scope: RemoteTokenScope): RemoteModuleTool[] {
		const config = this.getRoomConfig(scope.roomId);
		const tools: RemoteModuleTool[] = [];
		if (scope.modules.includes("sessions") && config.modules.sessions) tools.push(...buildSessionModuleTools(this.sessionPort));
		if (scope.modules.includes("observe") && config.modules.observe) tools.push(...buildObserveModuleTools(this.observePort));
		if (scope.modules.includes("files") && config.modules.files) tools.push(...buildFilesModuleTools());
		if (scope.modules.includes("bash") && config.modules.bash) tools.push(...buildBashModuleTools());
		return tools;
	}

	private resolveContext(scope: RemoteTokenScope, toolCallId: string, signal?: AbortSignal): RemoteToolContext {
		const config = this.getRoomConfig(scope.roomId);
		const mode = effectiveRemoteMode(config);
		const sandboxRoot = config.sandboxPath || this.defaultSandboxPath(scope.roomId);
		return {
			roomId: scope.roomId,
			tokenId: scope.tokenId,
			label: scope.label,
			mode,
			sandboxRoot,
			cwd: sandboxRoot,
			toolCallId,
			...(signal ? { signal } : {}),
		};
	}
}

export function createDefaultPiboRemoteAgentService(options: PiboRemoteAgentServiceOptions = {}): PiboRemoteAgentService {
	return new PiboRemoteAgentService(options);
}
