import type { ModelProfile } from "../core/profiles.js";
import type { CommandResultDescriptor, SlashCommandDescriptor } from "../session-ui/index.js";
import type { PiboJsonValue } from "../core/events.js";
import type { PiboSessionTraceView } from "../shared/trace-types.js";

export type CliSourceCapability = "supported" | "unsupported" | "unknown";

export type CliOwnerSummary = {
	ownerScope: string;
	label: string;
	description?: string;
	kind: "web-user" | "root-recovery" | "local" | "legacy";
	isFallback?: boolean;
};

export type CliRoomSummary = {
	id: string;
	title: string;
	description?: string;
	ownerScope?: string;
	isDefault?: boolean;
};

export type CliSessionSummary = {
	id: string;
	title: string;
	roomId?: string;
	profile: string;
	agentId?: string;
	ownerScope?: string;
	workspace?: string;
	status: "idle" | "running" | "error" | "unknown";
	model?: ModelProfile;
	createdAt?: string;
	updatedAt?: string;
};

export type CliAgentSummary = {
	id: string;
	name: string;
	description?: string;
	profileName?: string;
};

export type CliRuntimeStatus = {
	source: string;
	mode: "fake" | "local" | "gateway" | "unknown";
	connected: boolean;
	rooms: CliSourceCapability;
	sessions: CliSourceCapability;
	agents: CliSourceCapability;
	activeOwnerScope?: string;
	activeOwnerLabel?: string;
	activeRoomId?: string;
	activeSessionId?: string;
	activeAgentId?: string;
	activeModel?: ModelProfile;
	message?: string;
	updatedAt: string;
};

export type CreateCliSessionInput = {
	roomId?: string;
	title?: string;
	agentId?: string;
	profile?: string;
	ownerScope?: string;
	workspace?: string;
};

export type CliSessionUpdate = {
	type: "session" | "trace" | "status" | "error";
	session?: CliSessionSummary;
	traceView?: PiboSessionTraceView | null;
	status?: CliRuntimeStatus;
	error?: CliSourceError;
};

export type CliSessionUpdateListener = (update: CliSessionUpdate) => void;

export type RepairLegacyUserUnknownSessionsInput = {
	ownerScope?: string;
	roomId?: string;
	sessionIds?: readonly string[];
};

export type RepairLegacyUserUnknownSessionsResult = {
	ownerScope: string;
	roomId?: string;
	scanned: number;
	repaired: number;
	skipped: number;
	sessionIds: readonly string[];
};

export type ExecuteCliSlashCommandInput = {
	command: string;
	sessionId?: string;
	args?: string;
	ownerScope?: string;
};

export type ExecuteCliSlashCommandResult = {
	command: string;
	actionName: string;
	descriptor: CommandResultDescriptor;
	rawResult?: PiboJsonValue | unknown;
	openSessionId?: string;
	roomId?: string;
};

export type CliOpenSession = {
	session: CliSessionSummary;
	traceView: PiboSessionTraceView | null;
	status: CliRuntimeStatus;
	subscribe(listener: CliSessionUpdateListener): () => void;
	close(): Promise<void> | void;
};

export interface CliSessionSource {
	getActiveOwner(): Promise<CliOwnerSummary>;
	setActiveOwner(ownerScope: string): Promise<CliOwnerSummary>;
	listOwners(): Promise<readonly CliOwnerSummary[]>;
	listRooms(input?: { ownerScope?: string }): Promise<readonly CliRoomSummary[]>;
	listSessions(input?: { roomId?: string; ownerScope?: string }): Promise<readonly CliSessionSummary[]>;
	createSession(input?: CreateCliSessionInput): Promise<CliSessionSummary>;
	openSession(sessionId: string): Promise<CliOpenSession>;
	sendMessage(sessionId: string, text: string): Promise<void>;
	listAgents(): Promise<readonly CliAgentSummary[]>;
	listSlashCommands(): Promise<readonly SlashCommandDescriptor[]>;
	executeSlashCommand(input: ExecuteCliSlashCommandInput): Promise<ExecuteCliSlashCommandResult>;
	setSessionAgent(sessionId: string, agentId: string): Promise<CliSessionSummary>;
	repairLegacyUserUnknownSessions?(input?: RepairLegacyUserUnknownSessionsInput): Promise<RepairLegacyUserUnknownSessionsResult>;
	getStatus(input?: { sessionId?: string }): Promise<CliRuntimeStatus>;
	close(): Promise<void> | void;
}

export class CliSourceError extends Error {
	readonly code: string;
	override readonly cause?: unknown;

	constructor(code: string, message: string, options: { cause?: unknown } = {}) {
		super(message);
		this.name = "CliSourceError";
		this.code = code;
		this.cause = options.cause;
	}
}

export function isCliSourceError(error: unknown): error is CliSourceError {
	return error instanceof CliSourceError;
}
