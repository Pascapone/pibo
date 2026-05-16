import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { PiboSession, PiboSessionStore } from "../sessions/store.js";
import {
	CliSourceError,
	type CliAgentSummary,
	type CliOpenSession,
	type CliRoomSummary,
	type CliRuntimeStatus,
	type CliSessionSource,
	type CliSessionSummary,
	type CreateCliSessionInput,
} from "./sessionSource.js";

export type CliRoomProvider = {
	listRooms(input?: { ownerScope?: string }): Promise<readonly CliRoomSummary[]> | readonly CliRoomSummary[];
};

export type LocalCliSessionSourceOptions = {
	ownerScope?: string;
	sessionStore?: PiboSessionStore;
	ownsSessionStore?: boolean;
	roomProvider?: CliRoomProvider;
	pluginRegistry?: PiboPluginRegistry;
	now?: () => string;
	statusMessage?: string;
};

export class LocalCliSessionSource implements CliSessionSource {
	private readonly ownerScope?: string;
	private readonly sessionStore: PiboSessionStore;
	private readonly ownsSessionStore: boolean;
	private readonly roomProvider?: CliRoomProvider;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly now: () => string;
	private readonly statusMessage?: string;
	private closed = false;

	constructor(options: LocalCliSessionSourceOptions = {}) {
		this.ownerScope = options.ownerScope;
		this.sessionStore = options.sessionStore ?? createDefaultPiboDataSessionStore();
		this.ownsSessionStore = options.ownsSessionStore ?? options.sessionStore === undefined;
		this.roomProvider = options.roomProvider;
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.now = options.now ?? (() => new Date().toISOString());
		this.statusMessage = options.statusMessage;
	}

	async listRooms(): Promise<readonly CliRoomSummary[]> {
		this.assertOpen();
		if (this.roomProvider) {
			return (await this.roomProvider.listRooms({ ownerScope: this.ownerScope })).map(cloneJson);
		}
		return deriveRoomsFromSessions(this.readSessions()).map(cloneJson);
	}

	async listSessions(input: { roomId?: string } = {}): Promise<readonly CliSessionSummary[]> {
		this.assertOpen();
		return this.readSessions()
			.filter((session) => input.roomId === undefined || roomIdFromSession(session) === input.roomId)
			.map(sessionToSummary);
	}

	async createSession(_input: CreateCliSessionInput = {}): Promise<CliSessionSummary> {
		this.assertOpen();
		throw new CliSourceError("unsupported", "Local CLI session creation is not implemented yet");
	}

	async openSession(_sessionId: string): Promise<CliOpenSession> {
		this.assertOpen();
		throw new CliSourceError("unsupported", "Local CLI session opening is not implemented yet");
	}

	async sendMessage(_sessionId: string, _text: string): Promise<void> {
		this.assertOpen();
		throw new CliSourceError("unsupported", "Local CLI message sending is not implemented yet");
	}

	async listAgents(): Promise<readonly CliAgentSummary[]> {
		this.assertOpen();
		return this.pluginRegistry.getProfileInfos().map((profile) => ({
			id: profile.name,
			name: profile.name,
			description: profile.description,
			profileName: profile.name,
		}));
	}

	async setSessionAgent(_sessionId: string, _agentId: string): Promise<CliSessionSummary> {
		this.assertOpen();
		throw new CliSourceError("unsupported", "Changing an existing local session profile is not supported by the CLI source");
	}

	async getStatus(input: { sessionId?: string } = {}): Promise<CliRuntimeStatus> {
		this.assertOpen();
		const session = input.sessionId ? this.sessionStore.get(input.sessionId) : undefined;
		const sessions = this.readSessions();
		const rooms = this.roomProvider ? "supported" : deriveRoomsFromSessions(sessions).length > 0 ? "supported" : "unknown";
		return {
			source: "local/direct",
			mode: "local",
			connected: true,
			rooms,
			sessions: "supported",
			agents: "supported",
			activeRoomId: session ? roomIdFromSession(session) : undefined,
			activeSessionId: session?.id,
			activeAgentId: session?.profile,
			activeModel: session?.activeModel,
			message: redactCliSecretText(this.statusMessage ?? `Local CLI source ready; discovered ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`),
			updatedAt: this.now(),
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.ownsSessionStore) this.sessionStore.close?.();
	}

	private readSessions(): PiboSession[] {
		const sessions = this.sessionStore.list ? this.sessionStore.list() : this.sessionStore.find({});
		return sessions
			.filter((session) => this.ownerScope === undefined || session.ownerScope === this.ownerScope)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private assertOpen(): void {
		if (this.closed) throw new CliSourceError("source_closed", "Local CLI session source is closed");
	}
}

export function createLocalCliSessionSource(options: LocalCliSessionSourceOptions = {}): LocalCliSessionSource {
	return new LocalCliSessionSource(options);
}

export function redactCliSecretText(text: string): string {
	return text
		.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(?:sk|pk|pibo|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g, "[redacted]");
}

function sessionToSummary(session: PiboSession): CliSessionSummary {
	return {
		id: session.id,
		title: session.title?.trim() || session.id,
		roomId: roomIdFromSession(session),
		profile: session.profile,
		agentId: session.profile,
		ownerScope: session.ownerScope,
		workspace: session.workspace,
		status: statusFromSession(session),
		model: session.activeModel,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function deriveRoomsFromSessions(sessions: readonly PiboSession[]): CliRoomSummary[] {
	const rooms = new Map<string, CliRoomSummary>();
	for (const session of sessions) {
		const roomId = roomIdFromSession(session);
		if (!roomId || rooms.has(roomId)) continue;
		rooms.set(roomId, {
			id: roomId,
			title: stringMetadata(session, "chatRoomName") ?? stringMetadata(session, "roomName") ?? roomId,
			description: "Derived from local session metadata",
		});
	}
	return [...rooms.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function roomIdFromSession(session: PiboSession): string | undefined {
	return stringMetadata(session, "chatRoomId") ?? stringMetadata(session, "roomId");
}

function statusFromSession(session: PiboSession): CliSessionSummary["status"] {
	const status = session.metadata?.status;
	return status === "idle" || status === "running" || status === "error" ? status : "unknown";
}

function stringMetadata(session: PiboSession, key: string): string | undefined {
	const value = session.metadata?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function cloneJson<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
