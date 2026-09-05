import type {
	AgentRuntimeForkCandidate,
	AgentRuntimeNativeSessionInfo,
	AgentRuntimeNativeSessionSnapshot,
	AgentRuntimeSessionOperationResult,
} from "../../agent-runtime/types.js";
import {
	CodexAppServerClient,
	CodexAppServerRpcResponseError,
} from "./client.js";
import { redactCodexNativeSensitiveText } from "./redaction.js";
import type {
	CodexAppServerJson,
	CodexAppServerThread,
	CodexAppServerThreadForkParams,
	CodexAppServerThreadItem,
	CodexAppServerThreadListParams,
	CodexAppServerThreadListResponse,
	CodexAppServerThreadReadResponse,
	CodexAppServerThreadResponse,
	CodexAppServerThreadSourceKind,
	CodexAppServerThreadStatus,
	CodexAppServerTurn,
	CodexAppServerTurnStatus,
} from "./protocol-types.js";

export const CODEX_NATIVE_ADAPTER_ID = "codex-native";
const THREAD_LIST_LIMIT = 100;
const THREAD_LIST_SOURCE_KINDS: CodexAppServerThreadSourceKind[] = [
	"cli",
	"vscode",
	"exec",
	"appServer",
	"subAgent",
	"subAgentReview",
	"subAgentCompact",
	"subAgentThreadSpawn",
	"subAgentOther",
	"unknown",
];
const THREAD_MISSING_PATTERN = /\b(?:thread(?:\s+\S+)?\s+(?:not found|not loaded)|no rollout found for (?:thread|conversation) id|failed to resolve rollout path[^\r\n]{0,2048}(?:file does not exist|no such file or directory))\b/i;
const TURN_STATUSES = new Set<CodexAppServerTurnStatus>(["completed", "interrupted", "failed", "inProgress"]);
const THREAD_STATUS_TYPES = new Set<CodexAppServerThreadStatus["type"]>(["notLoaded", "idle", "systemError", "active"]);

export class CodexNativeThreadMissingError extends Error {
	constructor(readonly threadId: string) {
		super("The bound Codex thread is not available in this configured runtime instance.");
		this.name = "CodexNativeThreadMissingError";
	}
}

export class CodexNativeThreadProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexNativeThreadProtocolError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new CodexNativeThreadProtocolError(`Codex ${label} is invalid.`);
	return Number(value);
}

function optionalInteger(value: unknown, label: string): number | null | undefined {
	if (value === undefined || value === null) return value;
	return finiteInteger(value, label);
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new CodexNativeThreadProtocolError(`Codex ${label} is missing.`);
	return value;
}

function optionalString(value: unknown, label: string): string | null | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "string") throw new CodexNativeThreadProtocolError(`Codex ${label} is invalid.`);
	return value;
}

export function validateCodexAppServerThreadStatus(value: unknown): CodexAppServerThreadStatus {
	if (!isRecord(value) || typeof value.type !== "string" || !THREAD_STATUS_TYPES.has(value.type as CodexAppServerThreadStatus["type"])) {
		throw new CodexNativeThreadProtocolError("Codex thread status is invalid.");
	}
	if (value.type === "active") {
		if (!Array.isArray(value.activeFlags) || value.activeFlags.some((flag) => typeof flag !== "string")) {
			throw new CodexNativeThreadProtocolError("Codex active thread flags are invalid.");
		}
		return { type: "active", activeFlags: [...value.activeFlags] as string[] };
	}
	return { type: value.type as "notLoaded" | "idle" | "systemError" };
}

export function validateCodexAppServerThreadItem(value: unknown): CodexAppServerThreadItem {
	if (!isRecord(value)) throw new CodexNativeThreadProtocolError("Codex thread item is invalid.");
	const id = requiredString(value.id, "thread item id");
	const type = requiredString(value.type, "thread item type");
	return structuredClone({ ...value, id, type }) as CodexAppServerThreadItem;
}

export function validateCodexAppServerTurn(value: unknown): CodexAppServerTurn {
	if (!isRecord(value)) throw new CodexNativeThreadProtocolError("Codex turn is invalid.");
	const id = requiredString(value.id, "turn id");
	if (typeof value.status !== "string" || !TURN_STATUSES.has(value.status as CodexAppServerTurnStatus)) {
		throw new CodexNativeThreadProtocolError("Codex turn status is invalid.");
	}
	if (!Array.isArray(value.items)) throw new CodexNativeThreadProtocolError("Codex turn items are invalid.");
	const itemsView = optionalString(value.itemsView, "turn items view");
	if (itemsView !== undefined && itemsView !== null && !["notLoaded", "summary", "full"].includes(itemsView)) {
		throw new CodexNativeThreadProtocolError("Codex turn items view is invalid.");
	}
	return {
		id,
		status: value.status as CodexAppServerTurnStatus,
		items: value.items.map(validateCodexAppServerThreadItem),
		...(itemsView ? { itemsView: itemsView as "notLoaded" | "summary" | "full" } : {}),
		...((value.startedAt !== undefined) ? { startedAt: optionalInteger(value.startedAt, "turn start timestamp") } : {}),
		...((value.completedAt !== undefined) ? { completedAt: optionalInteger(value.completedAt, "turn completion timestamp") } : {}),
		...((value.durationMs !== undefined) ? { durationMs: optionalInteger(value.durationMs, "turn duration") } : {}),
		...(value.error !== undefined ? { error: structuredClone(value.error) } : {}),
	};
}

export function validateCodexAppServerThread(value: unknown): CodexAppServerThread {
	if (!isRecord(value)) throw new CodexNativeThreadProtocolError("Codex thread response is invalid.");
	if (!Array.isArray(value.turns)) throw new CodexNativeThreadProtocolError("Codex thread turns are invalid.");
	return {
		id: requiredString(value.id, "thread id"),
		preview: typeof value.preview === "string" ? value.preview : "",
		modelProvider: requiredString(value.modelProvider, "thread model provider"),
		createdAt: finiteInteger(value.createdAt, "thread creation timestamp"),
		updatedAt: finiteInteger(value.updatedAt, "thread update timestamp"),
		...((value.recencyAt !== undefined) ? { recencyAt: optionalInteger(value.recencyAt, "thread recency timestamp") } : {}),
		cwd: requiredString(value.cwd, "thread workspace"),
		cliVersion: requiredString(value.cliVersion, "thread CLI version"),
		source: structuredClone(value.source),
		...(value.threadSource !== undefined ? { threadSource: structuredClone(value.threadSource) } : {}),
		status: validateCodexAppServerThreadStatus(value.status),
		ephemeral: value.ephemeral === true,
		turns: value.turns.map(validateCodexAppServerTurn),
		sessionId: requiredString(value.sessionId, "thread session id"),
		...((value.name !== undefined) ? { name: optionalString(value.name, "thread name") } : {}),
		...((value.forkedFromId !== undefined) ? { forkedFromId: optionalString(value.forkedFromId, "fork source id") } : {}),
		...((value.parentThreadId !== undefined) ? { parentThreadId: optionalString(value.parentThreadId, "parent thread id") } : {}),
		...((value.path !== undefined) ? { path: optionalString(value.path, "thread path") } : {}),
	};
}

function threadFromResponse(value: unknown, operation: string): CodexAppServerThread {
	if (!isRecord(value) || !Object.hasOwn(value, "thread")) {
		throw new CodexNativeThreadProtocolError(`Codex ${operation} response is missing its thread.`);
	}
	return validateCodexAppServerThread(value.thread);
}

export type CodexNativeThreadConfiguration = {
	model: string;
	modelProvider: string;
	reasoningEffort?: string | null;
	serviceTier?: string | null;
};

export type CodexNativeThreadSelection = {
	model?: string;
	serviceTier?: string | null;
	personality?: string | null;
	approvalPolicy?: "untrusted" | "on-request" | "never";
	sandbox?: "read-only" | "workspace-write" | "danger-full-access";
	config?: Record<string, CodexAppServerJson>;
	developerInstructions?: string;
};

function threadSessionFromResponse(value: unknown, operation: string): {
	thread: CodexAppServerThread;
	configuration: CodexNativeThreadConfiguration;
} {
	const record = isRecord(value) ? value : undefined;
	const thread = threadFromResponse(value, operation);
	if (!record) throw new CodexNativeThreadProtocolError(`Codex ${operation} response is invalid.`);
	const reasoningEffort = optionalString(record.reasoningEffort, `${operation} reasoning effort`);
	const serviceTier = optionalString(record.serviceTier, `${operation} service tier`);
	return {
		thread,
		configuration: {
			model: requiredString(record.model, `${operation} model`),
			modelProvider: requiredString(record.modelProvider, `${operation} model provider`),
			...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
			...(serviceTier !== undefined ? { serviceTier } : {}),
		},
	};
}

export function isCodexNativeThreadMissingError(error: unknown): boolean {
	return error instanceof CodexNativeThreadMissingError
		|| (error instanceof CodexAppServerRpcResponseError
			&& error.rpcCode === -32600
			&& THREAD_MISSING_PATTERN.test(error.message));
}

function normalizeThreadError(error: unknown, threadId: string): never {
	if (isCodexNativeThreadMissingError(error)) throw new CodexNativeThreadMissingError(threadId);
	throw error;
}

function secondsToIso(seconds: number | null | undefined): string | undefined {
	if (!Number.isSafeInteger(seconds)) return undefined;
	const date = new Date(Number(seconds) * 1_000);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function userMessageText(item: CodexAppServerThreadItem): string | undefined {
	if (item.type !== "userMessage" || !Array.isArray(item.content)) return undefined;
	const text = item.content
		.filter((part): part is { type: string; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
		.map((part) => redactCodexNativeSensitiveText(part.text))
		.join("\n");
	return text || undefined;
}

function threadLeafId(thread: CodexAppServerThread): string | null {
	return thread.turns.at(-1)?.id ?? null;
}

export function codexThreadSnapshot(
	runtimeInstanceId: string,
	thread: CodexAppServerThread,
): AgentRuntimeNativeSessionSnapshot {
	return {
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		runtimeInstanceId,
		nativeSessionId: thread.id,
		locator: { kind: "adapter-resolved" },
		leafId: threadLeafId(thread),
		cwd: thread.cwd,
		name: thread.name ? redactCodexNativeSensitiveText(thread.name) : undefined,
		metadata: {
			cliVersion: thread.cliVersion,
			modelProvider: thread.modelProvider,
			status: thread.status.type,
		},
	};
}

export function codexThreadInfo(
	runtimeInstanceId: string,
	thread: CodexAppServerThread,
): AgentRuntimeNativeSessionInfo {
	return {
		...codexThreadSnapshot(runtimeInstanceId, thread),
		createdAt: secondsToIso(thread.createdAt),
		updatedAt: secondsToIso(thread.updatedAt),
		firstMessage: thread.preview ? redactCodexNativeSensitiveText(thread.preview) : undefined,
	};
}

type CodexThreadForkTarget = AgentRuntimeForkCandidate & {
	previousTurnId?: string;
};

function codexThreadForkTargets(thread: CodexAppServerThread): CodexThreadForkTarget[] {
	return thread.turns.flatMap((turn, index) => {
		const userMessage = turn.items.find((item) => item.type === "userMessage");
		if (!userMessage) return [];
		return [{
			entryId: userMessage.id,
			text: userMessageText(userMessage) ?? `Codex turn ${turn.id}`,
			...(index > 0 ? { previousTurnId: thread.turns[index - 1]!.id } : {}),
		}];
	});
}

export function codexThreadForkCandidates(thread: CodexAppServerThread): AgentRuntimeForkCandidate[] {
	return codexThreadForkTargets(thread).map(({ entryId, text }) => ({ entryId, text }));
}

export class CodexNativeThreadController {
	private readonly knownThreads = new Map<string, CodexAppServerThread>();

	private constructor(
		readonly client: CodexAppServerClient,
		private currentThread: CodexAppServerThread,
		private currentConfiguration: CodexNativeThreadConfiguration,
		private readonly inheritedSelection: Pick<
			CodexNativeThreadSelection,
			"approvalPolicy" | "sandbox" | "config" | "developerInstructions" | "personality"
		>,
	) {
		this.knownThreads.set(currentThread.id, structuredClone(currentThread));
	}

	static async start(
		client: CodexAppServerClient,
		workspace: string,
		selection: CodexNativeThreadSelection = {},
	): Promise<CodexNativeThreadController> {
		const response = await client.request<CodexAppServerThreadResponse>("thread/start", {
			cwd: workspace,
			ephemeral: false,
			...(selection.model ? { model: selection.model } : {}),
			...(selection.serviceTier !== undefined ? { serviceTier: selection.serviceTier } : {}),
			...(selection.personality !== undefined ? { personality: selection.personality } : {}),
			...(selection.approvalPolicy ? { approvalPolicy: selection.approvalPolicy } : {}),
			...(selection.sandbox ? { sandbox: selection.sandbox } : {}),
			...(selection.config ? { config: selection.config } : {}),
			...(selection.developerInstructions ? { developerInstructions: selection.developerInstructions } : {}),
		});
		const selected = threadSessionFromResponse(response, "thread/start");
		return new CodexNativeThreadController(client, selected.thread, selected.configuration, {
			...(selection.approvalPolicy ? { approvalPolicy: selection.approvalPolicy } : {}),
			...(selection.sandbox ? { sandbox: selection.sandbox } : {}),
			...(selection.config ? { config: structuredClone(selection.config) } : {}),
			...(selection.developerInstructions ? { developerInstructions: selection.developerInstructions } : {}),
			...(selection.personality !== undefined ? { personality: selection.personality } : {}),
		});
	}

	static async resume(
		client: CodexAppServerClient,
		threadId: string,
		workspace: string,
		selection: CodexNativeThreadSelection = {},
	): Promise<CodexNativeThreadController> {
		try {
			const response = await client.request<CodexAppServerThreadResponse>("thread/resume", {
				threadId,
				cwd: workspace,
				...(selection.model ? { model: selection.model } : {}),
				...(selection.serviceTier !== undefined ? { serviceTier: selection.serviceTier } : {}),
				...(selection.personality !== undefined ? { personality: selection.personality } : {}),
				...(selection.approvalPolicy ? { approvalPolicy: selection.approvalPolicy } : {}),
				...(selection.sandbox ? { sandbox: selection.sandbox } : {}),
				...(selection.config ? { config: selection.config } : {}),
				...(selection.developerInstructions ? { developerInstructions: selection.developerInstructions } : {}),
			});
			const selected = threadSessionFromResponse(response, "thread/resume");
			const thread = selected.thread;
			if (thread.id !== threadId) throw new CodexNativeThreadProtocolError("Codex resumed a different thread than requested.");
			return new CodexNativeThreadController(client, thread, selected.configuration, {
				...(selection.approvalPolicy ? { approvalPolicy: selection.approvalPolicy } : {}),
				...(selection.sandbox ? { sandbox: selection.sandbox } : {}),
				...(selection.config ? { config: structuredClone(selection.config) } : {}),
				...(selection.developerInstructions ? { developerInstructions: selection.developerInstructions } : {}),
				...(selection.personality !== undefined ? { personality: selection.personality } : {}),
			});
		} catch (error) {
			return normalizeThreadError(error, threadId);
		}
	}

	static async read(client: CodexAppServerClient, threadId: string, includeTurns: boolean): Promise<CodexAppServerThread> {
		try {
			const response = await client.request<CodexAppServerThreadReadResponse>("thread/read", { threadId, includeTurns });
			const thread = threadFromResponse(response, "thread/read");
			if (thread.id !== threadId) throw new CodexNativeThreadProtocolError("Codex read a different thread than requested.");
			return thread;
		} catch (error) {
			return normalizeThreadError(error, threadId);
		}
	}

	get thread(): CodexAppServerThread {
		return structuredClone(this.currentThread);
	}

	get configuration(): CodexNativeThreadConfiguration {
		return structuredClone(this.currentConfiguration);
	}

	getSnapshot(runtimeInstanceId: string): AgentRuntimeNativeSessionSnapshot {
		return codexThreadSnapshot(runtimeInstanceId, this.currentThread);
	}

	getForkCandidates(): AgentRuntimeForkCandidate[] {
		return codexThreadForkCandidates(this.currentThread);
	}

	getForkCandidatesWhileRunning(): AgentRuntimeForkCandidate[] {
		return codexThreadForkCandidates({
			...this.currentThread,
			turns: this.currentThread.turns.filter((turn) => turn.status !== "inProgress"),
		});
	}

	setStatus(status: CodexAppServerThreadStatus): void {
		this.currentThread = { ...this.currentThread, status: structuredClone(status) };
		this.knownThreads.set(this.currentThread.id, structuredClone(this.currentThread));
	}

	recordTurn(turn: CodexAppServerTurn): void {
		const turns = this.currentThread.turns.map((entry) => structuredClone(entry));
		const existingIndex = turns.findIndex((entry) => entry.id === turn.id);
		if (existingIndex >= 0) turns[existingIndex] = structuredClone(turn);
		else turns.push(structuredClone(turn));
		const terminal = turn.status !== "inProgress";
		const updatedAt = Math.max(
			this.currentThread.updatedAt,
			turn.completedAt ?? turn.startedAt ?? Math.floor(Date.now() / 1_000),
		);
		this.currentThread = {
			...this.currentThread,
			turns,
			updatedAt,
			recencyAt: updatedAt,
			status: terminal ? { type: "idle" } : { type: "active", activeFlags: [] },
		};
		this.knownThreads.set(this.currentThread.id, structuredClone(this.currentThread));
	}

	async list(runtimeInstanceId: string, workspace: string): Promise<AgentRuntimeNativeSessionInfo[]> {
		const params: CodexAppServerThreadListParams = {
			cwd: workspace,
			limit: THREAD_LIST_LIMIT,
			sortKey: "updated_at",
			sortDirection: "desc",
			archived: false,
			sourceKinds: THREAD_LIST_SOURCE_KINDS,
		};
		const response = await this.client.request<CodexAppServerThreadListResponse>("thread/list", params);
		if (!isRecord(response) || !Array.isArray(response.data)) {
			throw new CodexNativeThreadProtocolError("Codex thread/list response is invalid.");
		}
		const threads = new Map<string, CodexAppServerThread>();
		for (const value of response.data) {
			const thread = validateCodexAppServerThread(value);
			threads.set(thread.id, thread);
			this.knownThreads.set(thread.id, structuredClone(thread));
		}
		for (const thread of this.knownThreads.values()) {
			if (thread.cwd === workspace && !threads.has(thread.id)) {
				threads.set(thread.id, structuredClone(thread));
			}
		}
		return [...threads.values()]
			.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
			.map((thread) => codexThreadInfo(runtimeInstanceId, thread));
	}

	async fork(
		runtimeInstanceId: string,
		workspace: string,
		entryId: string,
		validateThread?: (threadId: string) => Promise<void>,
	): Promise<AgentRuntimeSessionOperationResult> {
		if (!entryId.trim()) throw new Error("Codex thread fork requires a native user-message id.");
		const target = codexThreadForkTargets(this.currentThread).find((candidate) => candidate.entryId === entryId);
		if (target) {
			if (!target.previousTurnId) {
				return this.branchBeforeFirstTurn(runtimeInstanceId, workspace, target);
			}
			return await this.forkAt(runtimeInstanceId, workspace, target.previousTurnId, validateThread, target);
		}
		const legacyTurn = this.currentThread.turns.find((turn) => turn.id === entryId);
		if (!legacyTurn) throw new Error(`Codex fork target "${entryId}" was not found.`);
		const legacyText = legacyTurn.items.map(userMessageText).find((text) => text?.trim());
		return await this.forkAt(runtimeInstanceId, workspace, entryId, validateThread, {
			entryId,
			text: legacyText ?? `Codex turn ${entryId}`,
		});
	}

	async forkWhileRunning(
		runtimeInstanceId: string,
		workspace: string,
		entryId: string,
		validateThread?: (threadId: string) => Promise<void>,
	): Promise<AgentRuntimeSessionOperationResult> {
		if (!entryId.trim()) throw new Error("Codex thread fork requires a native user-message id.");
		const target = codexThreadForkTargets({
			...this.currentThread,
			turns: this.currentThread.turns.filter((turn) => turn.status !== "inProgress"),
		}).find((candidate) => candidate.entryId === entryId);
		if (!target) throw new Error("Fork target is not a completed user message.");
		const result = !target.previousTurnId
			? this.branchBeforeFirstTurn(runtimeInstanceId, workspace, target)
			: await this.forkAt(runtimeInstanceId, workspace, target.previousTurnId, validateThread, target, false);
		return { ...result, sourceSessionUnchanged: true };
	}

	async clone(
		runtimeInstanceId: string,
		workspace: string,
		validateThread?: (threadId: string) => Promise<void>,
	): Promise<AgentRuntimeSessionOperationResult> {
		return await this.forkAt(runtimeInstanceId, workspace, undefined, validateThread);
	}

	private async forkAt(
		runtimeInstanceId: string,
		workspace: string,
		lastTurnId?: string,
		validateThread?: (threadId: string) => Promise<void>,
		selectedTarget?: AgentRuntimeForkCandidate,
		adoptFork = true,
	): Promise<AgentRuntimeSessionOperationResult> {
		const previousThread = this.currentThread;
		const previous = codexThreadSnapshot(runtimeInstanceId, previousThread);
		const params: CodexAppServerThreadForkParams = {
			threadId: previousThread.id,
			...(lastTurnId ? { lastTurnId } : {}),
			cwd: workspace,
			ephemeral: false,
			...(this.inheritedSelection.approvalPolicy ? { approvalPolicy: this.inheritedSelection.approvalPolicy } : {}),
			...(this.inheritedSelection.sandbox ? { sandbox: this.inheritedSelection.sandbox } : {}),
			...(this.inheritedSelection.config ? { config: structuredClone(this.inheritedSelection.config) } : {}),
			...(this.inheritedSelection.developerInstructions
				? { developerInstructions: this.inheritedSelection.developerInstructions }
				: {}),
		};
		try {
			const response = await this.client.request<CodexAppServerThreadResponse>("thread/fork", params);
			const selected = threadSessionFromResponse(response, "thread/fork");
			const forked = selected.thread;
			if (forked.id === previousThread.id) {
				throw new CodexNativeThreadProtocolError("Codex thread/fork returned the source thread id.");
			}
			await validateThread?.(forked.id);
			if (adoptFork) {
				this.knownThreads.set(previousThread.id, structuredClone(previousThread));
				this.currentThread = forked;
				this.currentConfiguration = selected.configuration;
			}
			this.knownThreads.set(forked.id, structuredClone(forked));
			return {
				previous,
				current: codexThreadSnapshot(runtimeInstanceId, forked),
				cancelled: false,
				...(selectedTarget?.text ? { selectedText: selectedTarget.text } : {}),
				...(selectedTarget ? { summaryEntryId: selectedTarget.entryId } : {}),
			};
		} catch (error) {
			return normalizeThreadError(error, previousThread.id);
		}
	}

	private branchBeforeFirstTurn(
		runtimeInstanceId: string,
		workspace: string,
		target: AgentRuntimeForkCandidate,
	): AgentRuntimeSessionOperationResult {
		const previousThread = this.currentThread;
		return {
			previous: codexThreadSnapshot(runtimeInstanceId, previousThread),
			current: {
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				runtimeInstanceId,
				cwd: workspace,
				leafId: null,
			},
			cancelled: false,
			selectedText: target.text,
			summaryEntryId: target.entryId,
		};
	}
}
