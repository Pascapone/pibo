/** Pibo Remote Agent: shared types and constants. UI-facing copy lives with the tab/API layers. */

export const REMOTE_AGENT_PLUGIN_ID = "pibo.remote-agent";
export const REMOTE_AGENT_MCP_SERVER_NAME = "pibo-remote-agent";
export const REMOTE_AGENT_MCP_SERVER_VERSION = "1";

/** Token prefix. Only the SHA-256 hash is ever persisted. */
export const REMOTE_AGENT_TOKEN_PREFIX = "pibo_remote_";
/** Default token lifetime: 30 days (CEO decision). */
export const REMOTE_AGENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Device codes are short-lived and single-use. */
export const REMOTE_AGENT_CODE_TTL_MS = 10 * 60 * 1000;
/** Unambiguous alphabet for device codes (no 0/O, 1/I/L). */
export const REMOTE_AGENT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REMOTE_AGENT_CODE_LENGTH = 8;
export const REMOTE_AGENT_TOKEN_LABEL_MAX_LENGTH = 80;

export const REMOTE_AGENT_MODULES = ["sessions", "observe", "files", "bash"] as const;
export type RemoteAgentModuleName = (typeof REMOTE_AGENT_MODULES)[number];

export type RemoteAgentMode = "sandbox" | "yolo";
export type RemoteAgentRuntime = "muse" | "pi";

/** Default session profile (agent) per room runtime family. */
export const REMOTE_AGENT_FAMILY_DEFAULT_PROFILE: Record<RemoteAgentRuntime, string> = {
	muse: "muse-native",
	pi: "base",
};

/** Session runtime binding per room runtime family (matches UI-created sessions). */
export const REMOTE_AGENT_FAMILY_BINDING: Record<RemoteAgentRuntime, { runtimeInstanceId: string; adapterId: string; protocol: string }> = {
	muse: { runtimeInstanceId: "muse-native", adapterId: "muse-native", protocol: "muse-session-protocol" },
	pi: { runtimeInstanceId: "pi", adapterId: "pi", protocol: "pi-sdk" },
};

export const REMOTE_AGENT_PROFILE_NAME_MAX_LENGTH = 120;
export const REMOTE_AGENT_ALLOWED_PROFILES_MAX_COUNT = 50;

/** MCP tool names use underscores: the MCP spec allows only [A-Za-z0-9_-]. */
export const REMOTE_AGENT_TOOL_NAMES = {
	ping: "remote_ping",
	sessionCreate: "remote_session_create",
	sessionList: "remote_session_list",
	sessionSend: "remote_session_send",
	sessionAgents: "remote_session_agents",
	sessionObserve: "remote_session_observe",
	fileRead: "remote_file_read",
	fileWrite: "remote_file_write",
	fileEdit: "remote_file_edit",
	fileList: "remote_file_list",
	fileFind: "remote_file_find",
	fileGrep: "remote_file_grep",
	bashRun: "remote_bash_run",
} as const;

export const REMOTE_AGENT_MODULE_TOOLS: Record<RemoteAgentModuleName, readonly string[]> = {
	sessions: [REMOTE_AGENT_TOOL_NAMES.sessionCreate, REMOTE_AGENT_TOOL_NAMES.sessionList, REMOTE_AGENT_TOOL_NAMES.sessionSend, REMOTE_AGENT_TOOL_NAMES.sessionAgents],
	observe: [REMOTE_AGENT_TOOL_NAMES.sessionObserve],
	files: [
		REMOTE_AGENT_TOOL_NAMES.fileRead,
		REMOTE_AGENT_TOOL_NAMES.fileWrite,
		REMOTE_AGENT_TOOL_NAMES.fileEdit,
		REMOTE_AGENT_TOOL_NAMES.fileList,
		REMOTE_AGENT_TOOL_NAMES.fileFind,
		REMOTE_AGENT_TOOL_NAMES.fileGrep,
	],
	bash: [REMOTE_AGENT_TOOL_NAMES.bashRun],
};

export function isRemoteAgentModuleName(value: unknown): value is RemoteAgentModuleName {
	return typeof value === "string" && (REMOTE_AGENT_MODULES as readonly string[]).includes(value);
}

export function toolModuleForToolName(toolName: string): RemoteAgentModuleName | undefined {
	for (const [module, tools] of Object.entries(REMOTE_AGENT_MODULE_TOOLS) as Array<[RemoteAgentModuleName, readonly string[]]>) {
		if (tools.includes(toolName)) return module;
	}
	return undefined;
}

export type RemoteRoomModuleSelection = Record<RemoteAgentModuleName, boolean>;

export type RemoteRoomConfig = {
	roomId: string;
	enabled: boolean;
	mode: RemoteAgentMode;
	runtime: RemoteAgentRuntime;
	sandboxPath: string;
	modules: RemoteRoomModuleSelection;
	/** Default session profile (agent) for remote-created sessions. Empty = family default. */
	defaultProfile: string;
	/** Profiles the remote client may select. Empty = family default only. */
	allowedProfiles: string[];
	/**
	 * Stored sandbox internet wish for Muse sessions created through the remote agent.
	 * Only read while the effective mode is sandbox; YOLO and Pi always have internet on.
	 * Missing (pre-feature rows) means off.
	 */
	allowInternet: boolean;
	updatedAt: string;
};

export type RemoteRoomConfigPatch = {
	enabled?: boolean;
	mode?: RemoteAgentMode;
	runtime?: RemoteAgentRuntime;
	sandboxPath?: string;
	modules?: Partial<Record<RemoteAgentModuleName, boolean>>;
	defaultProfile?: string;
	allowedProfiles?: string[];
	allowInternet?: boolean;
};

/** Pibo session metadata key marking sessions created through the remote agent. */
export const REMOTE_AGENT_SESSION_METADATA_KEY = "remoteAgentCreated";

export type RemoteRoomAgentEntry = {
	name: string;
	isDefault: boolean;
};

export type RemoteRoomAgents = {
	runtime: RemoteAgentRuntime;
	runtimeInstanceId: string;
	defaultProfile: string;
	agents: RemoteRoomAgentEntry[];
};

/** Pi has no sandbox support, so its effective mode is always YOLO. */
export function effectiveRemoteMode(config: Pick<RemoteRoomConfig, "mode" | "runtime">): RemoteAgentMode {
	return config.runtime === "pi" ? "yolo" : config.mode;
}

/**
 * Effective internet access for Muse sessions of the remote agent. YOLO and Pi
 * always have internet on; sandboxed Muse sessions use the stored wish. A
 * missing wish (pre-feature configs) securely defaults to off.
 */
export function effectiveRemoteInternetAccess(
	config: Pick<RemoteRoomConfig, "mode" | "runtime"> & { allowInternet?: boolean },
): boolean {
	if (config.runtime === "pi") return true;
	if (config.mode === "yolo") return true;
	return config.allowInternet === true;
}

export type RemoteDeviceCode = {
	code: string;
	roomId: string;
	label?: string;
	expiresAt: string;
	used: boolean;
	usedAt?: string;
	createdAt: string;
};

export type RemoteTokenInfo = {
	id: string;
	label: string;
	roomId: string;
	modules: RemoteAgentModuleName[];
	createdAt: string;
	expiresAt: string;
	revoked: boolean;
	revokedAt?: string;
};

export type RemoteTokenScope = {
	tokenId: string;
	label: string;
	roomId: string;
	modules: RemoteAgentModuleName[];
	expiresAt: string;
};

/** Where a remote tool call arrived: MCP protocol or REST (GPT-style) endpoint. */
export type RemoteToolCallTransport = "mcp" | "rest";

/** One recorded remote tool invocation. Args/results are truncated JSON strings. */
export type RemoteToolCallRecord = {
	id: number;
	toolCallId: string;
	roomId: string;
	tokenId: string;
	label: string;
	transport: RemoteToolCallTransport;
	toolName: string;
	argsJson: string;
	ok: boolean;
	resultText?: string;
	resultJson?: string;
	error?: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
};

export type NewRemoteToolCallRecord = Omit<RemoteToolCallRecord, "id">;

/** History API pagination + retention bounds. */
export const REMOTE_AGENT_HISTORY_DEFAULT_LIMIT = 100;
export const REMOTE_AGENT_HISTORY_MAX_LIMIT = 200;
export const REMOTE_AGENT_HISTORY_RETAIN_PER_ROOM = 500;
/** Max persisted bytes per JSON payload (args/details). Longer payloads are truncated. */
export const REMOTE_AGENT_HISTORY_JSON_MAX_BYTES = 8192;
/** Max persisted chars of the result text preview. Longer texts are truncated. */
export const REMOTE_AGENT_HISTORY_TEXT_MAX_CHARS = 2000;

/** Error with a stable machine-readable code for the API/CLI/MCP layers. */
export class RemoteAgentError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "RemoteAgentError";
		this.code = code;
	}
}
