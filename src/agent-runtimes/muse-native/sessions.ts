import {
	MspError,
	Session,
	readSessionDurability,
	type Connection,
	type SessionDurabilityProfile,
	type SpawnedMspConnection,
} from "@muse-code/sdk";
import type {
	AgentRuntimeForkCandidate,
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
} from "../../agent-runtime/types.js";
import type { PiboJsonObject } from "../../core/events.js";
import type { MuseNativeApprovalMode } from "./config.js";
import type { MuseNativeSessionMcpConfig } from "./resource-delivery.js";

export const MUSE_NATIVE_ADAPTER_ID = "muse-native";

const SESSION_LIST_LIMIT = 100;
const MAX_SESSION_NAME_LENGTH = 256;

export class MuseNativeSessionMissingError extends Error {
	constructor(readonly sessionId: string) {
		super("The bound Muse session is not available in this configured runtime instance.");
		this.name = "MuseNativeSessionMissingError";
	}
}

export class MuseNativeSessionProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MuseNativeSessionProtocolError";
	}
}

export type MuseNativeSessionSummary = {
	sessionId: string;
	name?: string;
	modelId?: string;
	providerId?: string;
	createdAt?: string;
	updatedAt?: string;
	activeTurnId?: string | null;
};

export type MuseNativeSessionStartSelection = {
	workspaceRoot: string;
	modelId?: string;
	providerId?: string;
	approvalMode: MuseNativeApprovalMode;
	mcpConfig?: MuseNativeSessionMcpConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new MuseNativeSessionProtocolError(`Muse ${label} is missing.`);
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new MuseNativeSessionProtocolError(`Muse ${label} is invalid.`);
	return value;
}

function readSessionSummary(value: unknown): MuseNativeSessionSummary {
	if (!isRecord(value)) throw new MuseNativeSessionProtocolError("Muse session object is invalid.");
	const sessionId = requiredString(value.sessionId, "session id");
	const name = optionalString(value.name, "session name")?.slice(0, MAX_SESSION_NAME_LENGTH);
	return {
		sessionId,
		...(name ? { name } : {}),
		...(optionalString(value.modelId, "session model") ? { modelId: value.modelId as string } : {}),
		...(optionalString(value.providerId, "session provider") ? { providerId: value.providerId as string } : {}),
		...(optionalString(value.createdAt, "session created time") ? { createdAt: value.createdAt as string } : {}),
		...(optionalString(value.lastActivityAt ?? value.updatedAt, "session activity time")
			? { updatedAt: (value.lastActivityAt ?? value.updatedAt) as string }
			: {}),
		...(value.activeTurnId === null || typeof value.activeTurnId === "string" ? { activeTurnId: value.activeTurnId } : {}),
	};
}

function museSessionErrorKind(error: unknown): string | undefined {
	if (error instanceof MspError) return error.kind;
	return undefined;
}

function isSessionNotFound(error: unknown): boolean {
	return museSessionErrorKind(error) === "sessionNotFound";
}

type SessionStartOpening = {
	verb: "session/start";
	result: { session: Record<string, unknown>; viewCursor: string };
};

type SessionResumeOpening = {
	verb: "session/resume";
	result: { session: Record<string, unknown>; viewCursor: string; history: unknown; pendingRequests: unknown };
};

type SdkSessionOpening = NonNullable<ConstructorParameters<typeof Session>[0]["opening"]>;

export class MuseNativeConnectionPump {
	private readonly sessions = new Map<string, Session>();
	private readonly turnCompletions = new Map<string, { turnId: string; terminal: string; completedAt: string }[]>();
	private observer: ((method: string, params: unknown) => void) | undefined;
	readonly completedTurns = new Map<string, string[]>();

	constructor(connection: Connection) {
		// The SDK connection holds exactly one notification handler; every consumer shares this pump.
		connection.onNotification((notification) => this.route(notification.method, notification.params));
	}

	setObserver(observer: ((method: string, params: unknown) => void) | undefined): void {
		this.observer = observer;
	}

	register(sessionId: string, session: Session): void {
		this.sessions.set(sessionId, session);
	}

	unregister(sessionId: string): void {
		this.sessions.delete(sessionId);
		this.completedTurns.delete(sessionId);
		this.turnCompletions.delete(sessionId);
	}

	private route(method: string, params: unknown): void {
		try {
			this.observer?.(method, params);
		} catch {
			// Observers must not break session routing.
		}
		if (!isRecord(params)) return;
		const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
		if (!sessionId) return;
		const session = this.sessions.get(sessionId);
		if (!session) return;
		try {
			session.apply({ method, params });
		} catch {
			// A malformed frame must not break the shared pump; the affected turn surfaces via its own terminal.
		}
		if (method === "turn/completed" && typeof params.turnId === "string" && typeof params.terminal === "string") {
			const completed = this.completedTurns.get(sessionId) ?? [];
			if (!completed.includes(params.turnId)) completed.push(params.turnId);
			this.completedTurns.set(sessionId, completed.slice(-512));
			const ledger = this.turnCompletions.get(sessionId) ?? [];
			ledger.push({ turnId: params.turnId, terminal: params.terminal, completedAt: new Date().toISOString() });
			this.turnCompletions.set(sessionId, ledger.slice(-512));
		}
	}
}

export class MuseNativeSessionController {
	private constructor(
		readonly connection: Connection,
		readonly session: Session,
		public summary: MuseNativeSessionSummary,
		private readonly pump: MuseNativeConnectionPump,
		readonly cwd: string,
	) {}

	static async start(
		connection: Connection,
		pump: MuseNativeConnectionPump,
		durability: SessionDurabilityProfile,
		selection: MuseNativeSessionStartSelection,
	): Promise<MuseNativeSessionController> {
		const params: Record<string, unknown> = {
			workspaceRoot: selection.workspaceRoot,
			approvalMode: selection.approvalMode,
			...(selection.modelId ? { modelId: selection.modelId } : {}),
			...(selection.providerId ? { providerId: selection.providerId } : {}),
			...(selection.mcpConfig ? { config: { mcpServers: selection.mcpConfig } } : {}),
		};
		const result = await connection.command("session/start", params);
		if (!isRecord(result) || !isRecord(result.session) || typeof result.viewCursor !== "string") {
			throw new MuseNativeSessionProtocolError("Muse session/start returned an invalid result.");
		}
		const summary = readSessionSummary(result.session);
		const opening = {
			verb: "session/start",
			result: { session: result.session, viewCursor: result.viewCursor },
		} satisfies SessionStartOpening;
		const session = new Session({
			sessionId: summary.sessionId,
			durability,
			connection,
			opening: opening as unknown as SdkSessionOpening,
		});
		pump.register(summary.sessionId, session);
		return new MuseNativeSessionController(connection, session, summary, pump, selection.workspaceRoot);
	}

	static async resume(
		connection: Connection,
		pump: MuseNativeConnectionPump,
		durability: SessionDurabilityProfile,
		sessionId: string,
		workspaceRoot: string,
		mcpConfig?: MuseNativeSessionMcpConfig,
	): Promise<MuseNativeSessionController> {
		let result: Record<string, unknown>;
		try {
			result = await connection.command("session/resume", {
				sessionId,
				...(mcpConfig ? { config: { mcpServers: mcpConfig } } : {}),
			});
		} catch (error) {
			if (isSessionNotFound(error)) throw new MuseNativeSessionMissingError(sessionId);
			throw error;
		}
		if (!isRecord(result) || !isRecord(result.session) || typeof result.viewCursor !== "string") {
			throw new MuseNativeSessionProtocolError("Muse session/resume returned an invalid result.");
		}
		const summary = readSessionSummary(result.session);
		const opening = {
			verb: "session/resume",
			result: {
				session: result.session,
				viewCursor: result.viewCursor,
				history: result.history,
				pendingRequests: result.pendingRequests,
			},
		} satisfies SessionResumeOpening;
		const session = new Session({
			sessionId: summary.sessionId,
			durability,
			connection,
			opening: opening as unknown as SdkSessionOpening,
		});
		pump.register(summary.sessionId, session);
		return new MuseNativeSessionController(connection, session, summary, pump, workspaceRoot);
	}

	static async read(
		connection: Connection,
		sessionId: string,
	): Promise<MuseNativeSessionSummary> {
		let result: Record<string, unknown>;
		try {
			result = await connection.request("session/read", { sessionId });
		} catch (error) {
			if (isSessionNotFound(error)) throw new MuseNativeSessionMissingError(sessionId);
			throw error;
		}
		if (!isRecord(result) || !isRecord(result.session)) {
			throw new MuseNativeSessionProtocolError("Muse session/read returned an invalid result.");
		}
		return readSessionSummary(result.session);
	}

	static async list(
		connection: Connection,
		workspaceRoot?: string,
	): Promise<MuseNativeSessionSummary[]> {
		const summaries: MuseNativeSessionSummary[] = [];
		let cursor: string | null | undefined;
		// Fill-to-limit paging: sparse pages can return fewer than the limit
		// with a cursor, so up to five pages are fetched to collect 100.
		for (let page = 0; page < 5; page += 1) {
			const params: Record<string, unknown> = { limit: SESSION_LIST_LIMIT };
			if (cursor) params.cursor = cursor;
			if (workspaceRoot) params.workspaceRoot = workspaceRoot;
			const result = await connection.request("session/list", params);
			if (!isRecord(result) || !Array.isArray(result.sessions)) {
				throw new MuseNativeSessionProtocolError("Muse session/list returned an invalid result.");
			}
			for (const entry of result.sessions.slice(0, SESSION_LIST_LIMIT)) summaries.push(readSessionSummary(entry));
			cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
			if (!cursor || summaries.length >= SESSION_LIST_LIMIT) break;
		}
		return summaries.slice(0, SESSION_LIST_LIMIT);
	}

	get sessionId(): string {
		return this.summary.sessionId;
	}

	get activeTurnId(): string | undefined {
		return this.session.fold.activeTurnId ?? undefined;
	}

	completedTurnIds(): string[] {
		return [...(this.pump.completedTurns.get(this.sessionId) ?? [])];
	}

	getSnapshot(runtimeInstanceId: string): {
		adapterId: typeof MUSE_NATIVE_ADAPTER_ID;
		runtimeInstanceId: string;
		nativeSessionId: string;
		cwd: string;
		name?: string;
		metadata?: PiboJsonObject;
	} {
		return {
			adapterId: MUSE_NATIVE_ADAPTER_ID,
			runtimeInstanceId,
			nativeSessionId: this.sessionId,
			cwd: this.cwd,
			...(this.summary.name ? { name: this.summary.name } : {}),
			metadata: {
				...(this.summary.modelId ? { museModelId: this.summary.modelId } : {}),
				...(this.summary.providerId ? { museProviderId: this.summary.providerId } : {}),
				...(this.summary.createdAt ? { museCreatedAt: this.summary.createdAt } : {}),
			},
		};
	}

	async listSessions(runtimeInstanceId: string): Promise<AgentRuntimeNativeSessionInfo[]> {
		const summaries = await MuseNativeSessionController.list(this.connection, this.cwd);
		return summaries.map((summary) => ({
			adapterId: MUSE_NATIVE_ADAPTER_ID,
			runtimeInstanceId,
			nativeSessionId: summary.sessionId,
			cwd: this.cwd,
			...(summary.name ? { name: summary.name } : {}),
			...(summary.createdAt ? { createdAt: summary.createdAt } : {}),
			...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
		}));
	}

	getForkCandidates(): AgentRuntimeForkCandidate[] {
		return this.completedTurnIds().map((turnId, index) => ({
			entryId: turnId,
			text: `Turn ${index + 1} (${turnId.slice(0, 8)})`,
		}));
	}

	async fork(
		runtimeInstanceId: string,
		cwd: string,
		entryId: string | undefined,
		durability: SessionDurabilityProfile,
	): Promise<{ controller: MuseNativeSessionController; previous: AgentRuntimeNativeSessionSnapshot; current: AgentRuntimeNativeSessionSnapshot }> {
		const params: Record<string, unknown> = { sessionId: this.sessionId };
		if (entryId) params.cutPoint = { lastTurnId: entryId };
		let result: Record<string, unknown>;
		try {
			result = await this.connection.command("session/fork", params);
		} catch (error) {
			if (isSessionNotFound(error)) throw new MuseNativeSessionMissingError(this.sessionId);
			if (museSessionErrorKind(error) === "forkBoundaryInvalid") {
				throw new Error(
					entryId
						? `Muse fork target "${entryId}" is not a valid fork boundary in native session "${this.sessionId}".`
						: `Muse fork of native session "${this.sessionId}" was rejected: no valid fork boundary.`,
				);
			}
			throw error;
		}
		if (!isRecord(result) || !isRecord(result.session) || typeof result.viewCursor !== "string") {
			throw new MuseNativeSessionProtocolError("Muse session/fork returned an invalid result.");
		}
		const summary = readSessionSummary(result.session);
		const opening = {
			verb: "session/resume",
			result: {
				session: result.session,
				viewCursor: result.viewCursor,
				history: result.history,
				pendingRequests: result.pendingRequests,
			},
		} satisfies SessionResumeOpening;
		const session = new Session({
			sessionId: summary.sessionId,
			durability,
			connection: this.connection,
			opening: opening as unknown as SdkSessionOpening,
		});
		this.pump.register(summary.sessionId, session);
		const next = new MuseNativeSessionController(this.connection, session, summary, this.pump, cwd);
		return {
			controller: next,
			previous: {
				adapterId: MUSE_NATIVE_ADAPTER_ID,
				runtimeInstanceId,
				nativeSessionId: this.sessionId,
				cwd: this.cwd,
			},
			current: next.getSnapshot(runtimeInstanceId),
		};
	}

	detach(): void {
		this.pump.unregister(this.sessionId);
	}
}

export function readMuseDurability(spawned: SpawnedMspConnection): SessionDurabilityProfile {
	return readSessionDurability(spawned.initializeResult);
}
