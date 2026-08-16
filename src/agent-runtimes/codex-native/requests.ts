import { randomUUID } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type {
	AgentRuntimeApprovalRequest,
	AgentRuntimeRequestResolution,
	AgentRuntimeSemanticEvent,
	AgentRuntimeUserInputQuestion,
	AgentRuntimeUserInputRequest,
} from "../../agent-runtime/events.js";
import {
	CodexAppServerServerRequestCancelledError,
	type CodexAppServerClient,
} from "./client.js";
import type {
	CodexAppServerApprovalDecision,
	CodexAppServerApprovalResponse,
	CodexAppServerCommandApprovalParams,
	CodexAppServerFileChangeApprovalParams,
	CodexAppServerRequestId,
	CodexAppServerServerRequest,
	CodexAppServerUserInputRequestParams,
	CodexAppServerUserInputResponse,
} from "./protocol-types.js";
import { redactCodexNativeSensitiveText, redactCodexNativeValue } from "./redaction.js";

const MAX_REQUEST_TEXT_LENGTH = 4_000;
const MAX_USER_INPUT_ANSWER_LENGTH = 16_000;
const MAX_USER_INPUT_QUESTIONS = 10;
const MAX_USER_INPUT_OPTIONS = 20;
const APPROVAL_DECISIONS = [
	{ id: "accept", label: "Approve once", description: "Allow this action once." },
	{ id: "acceptForSession", label: "Approve for session", description: "Allow matching actions for the rest of this native session." },
	{ id: "decline", label: "Decline", description: "Deny this action and let the turn continue." },
	{ id: "cancel", label: "Cancel turn", description: "Deny this action and interrupt the active turn." },
] as const;
const APPROVAL_DECISION_IDS = new Set<string>(APPROVAL_DECISIONS.map((decision) => decision.id));

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
};

type PendingApproval = {
	kind: "approval";
	productRequestId: string;
	nativeRequestId: CodexAppServerRequestId;
	nativeRequestKey: string;
	threadId: string;
	turnId: string;
	itemId: string;
	request: AgentRuntimeApprovalRequest;
	deferred: Deferred<CodexAppServerApprovalResponse>;
};

type PendingUserInput = {
	kind: "user_input";
	productRequestId: string;
	nativeRequestId: CodexAppServerRequestId;
	nativeRequestKey: string;
	threadId: string;
	turnId: string;
	itemId: string;
	request: AgentRuntimeUserInputRequest;
	deferred: Deferred<CodexAppServerUserInputResponse>;
};

type PendingRequest = PendingApproval | PendingUserInput;

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`Codex ${label} is invalid.`);
	return value;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value) throw new Error(`Codex ${label} is invalid.`);
	return value;
}

function requiredInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value)) throw new Error(`Codex ${label} is invalid.`);
	return Number(value);
}

function boundedText(value: unknown, fallback = ""): string {
	if (typeof value !== "string") return fallback;
	return redactCodexNativeSensitiveText(value).slice(0, MAX_REQUEST_TEXT_LENGTH);
}

function jsonValue(value: unknown): PiboJsonValue {
	return redactCodexNativeValue(value) as PiboJsonValue;
}

function nativeRequestKey(requestId: CodexAppServerRequestId): string {
	return `${typeof requestId}:${String(requestId)}`;
}

function cloneApproval(request: AgentRuntimeApprovalRequest): AgentRuntimeApprovalRequest {
	return structuredClone(request);
}

function cloneUserInput(request: AgentRuntimeUserInputRequest): AgentRuntimeUserInputRequest {
	return structuredClone(request);
}

function validateScope(
	params: Record<string, unknown>,
	expectedThreadId: string,
	activeTurnId: string | undefined,
	label: string,
): { threadId: string; turnId: string; itemId: string } {
	const threadId = requiredString(params.threadId, `${label} thread id`);
	const turnId = requiredString(params.turnId, `${label} turn id`);
	const itemId = requiredString(params.itemId, `${label} item id`);
	if (threadId !== expectedThreadId) throw new Error(`Codex ${label} belongs to a different native thread.`);
	if (!activeTurnId || turnId !== activeTurnId) throw new Error(`Codex ${label} does not match the active native turn.`);
	return { threadId, turnId, itemId };
}

function approvalRequest(
	requestId: string,
	requestType: "command_execution" | "file_change",
	params: Record<string, unknown>,
): AgentRuntimeApprovalRequest {
	if (requestType === "command_execution") {
		const command = boundedText(params.command, "Codex command");
		const reason = boundedText(params.reason);
		const argumentsValue: PiboJsonObject = {
			command,
			itemId: requiredString(params.itemId, "command approval item id"),
		};
		if (Array.isArray(params.commandActions)) argumentsValue.commandActions = jsonValue(params.commandActions);
		if (params.networkApprovalContext !== undefined && params.networkApprovalContext !== null) {
			argumentsValue.networkApprovalContext = jsonValue(params.networkApprovalContext);
		}
		if (params.proposedExecpolicyAmendment !== undefined && params.proposedExecpolicyAmendment !== null) {
			argumentsValue.proposedExecpolicyAmendment = jsonValue(params.proposedExecpolicyAmendment);
		}
		if (params.proposedNetworkPolicyAmendments !== undefined && params.proposedNetworkPolicyAmendments !== null) {
			argumentsValue.proposedNetworkPolicyAmendments = jsonValue(params.proposedNetworkPolicyAmendments);
		}
		return {
			requestId,
			requestType,
			title: "Run Codex command",
			...(reason ? { detail: reason } : {}),
			arguments: argumentsValue,
			decisions: APPROVAL_DECISIONS.map((decision) => ({ ...decision })),
		};
	}
	const reason = boundedText(params.reason);
	const argumentsValue: PiboJsonObject = {
		itemId: requiredString(params.itemId, "file approval item id"),
	};
	if (typeof params.grantRoot === "string" && params.grantRoot) {
		argumentsValue.grantRoot = boundedText(params.grantRoot);
	}
	return {
		requestId,
		requestType,
		title: "Apply Codex file changes",
		...(reason ? { detail: reason } : {}),
		arguments: argumentsValue,
		decisions: APPROVAL_DECISIONS.map((decision) => ({ ...decision })),
	};
}

function validateOptions(value: unknown, questionId: string): AgentRuntimeUserInputQuestion["options"] {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length > MAX_USER_INPUT_OPTIONS) {
		throw new Error(`Codex user-input options for question "${questionId}" are invalid.`);
	}
	return value.map((entry) => {
		const option = requiredRecord(entry, "user-input option");
		return {
			label: boundedText(requiredString(option.label, "user-input option label")),
			...(typeof option.description === "string"
				? { description: boundedText(option.description) }
				: {}),
		};
	});
}

function userInputQuestion(value: unknown): AgentRuntimeUserInputQuestion {
	const question = requiredRecord(value, "user-input question");
	const id = requiredString(question.id, "user-input question id");
	return {
		id,
		header: boundedText(requiredString(question.header, "user-input question header")),
		question: boundedText(requiredString(question.question, "user-input question text")),
		options: validateOptions(question.options, id),
		multiSelect: false,
		allowFreeform: question.isOther === true,
		secret: question.isSecret === true,
	};
}

function normalizeAnswers(request: AgentRuntimeUserInputRequest, answers: PiboJsonObject): CodexAppServerUserInputResponse {
	const expected = new Set(request.questions.map((question) => question.id));
	for (const key of Object.keys(answers)) {
		if (!expected.has(key)) throw new Error(`Unknown answer id "${key}" for runtime user-input request.`);
	}
	const normalized: Record<string, { answers: string[] }> = {};
	for (const question of request.questions) {
		const value = answers[question.id];
		const values = typeof value === "string"
			? [value]
			: Array.isArray(value) && value.every((entry) => typeof entry === "string")
				? value as string[]
				: undefined;
		if (!values || values.length === 0 || values.some((entry) => entry.length > MAX_USER_INPUT_ANSWER_LENGTH)) {
			throw new Error(`Runtime user-input question "${question.id}" requires at least one bounded string answer.`);
		}
		if (question.multiSelect !== true && values.length > 1) {
			throw new Error(`Runtime user-input question "${question.id}" accepts one answer.`);
		}
		if (question.options?.length && !question.allowFreeform) {
			const allowed = new Set(question.options.map((option) => option.label));
			if (values.some((entry) => !allowed.has(entry))) {
				throw new Error(`Runtime user-input question "${question.id}" requires a listed option.`);
			}
		}
		normalized[question.id] = { answers: [...values] };
	}
	return { answers: normalized };
}

export class CodexNativeRequestController {
	private readonly pendingByProductId = new Map<string, PendingRequest>();
	private readonly productIdByNativeKey = new Map<string, string>();
	private readonly unsubscribeNotifications: () => void;
	private readonly unsubscribeDiagnostics: () => void;
	private disposed = false;

	constructor(
		private readonly client: CodexAppServerClient,
		private readonly getThreadId: () => string,
		private readonly getActiveTurnId: () => string | undefined,
		private readonly structuredUserInputEnabled: boolean,
		private readonly emit: (event: AgentRuntimeSemanticEvent) => void,
	) {
		client.setServerRequestHandler((request) => this.handleServerRequest(request));
		this.unsubscribeNotifications = client.subscribeNotifications((notification) => {
			if (this.disposed) return;
			if (notification.method === "serverRequest/resolved") this.handleResolvedNotification(notification.params);
			else if (notification.method === "turn/completed") this.handleTurnCompleted(notification.params);
			else if (notification.method === "turn/started") this.handleTurnStarted(notification.params);
		});
		this.unsubscribeDiagnostics = client.subscribeDiagnostics((diagnostic) => {
			if (this.disposed || diagnostic.level !== "error") return;
			for (const pending of [...this.pendingByProductId.values()]) this.cancelPending(pending, "aborted");
		});
	}

	get pendingApproval(): AgentRuntimeApprovalRequest | undefined {
		return this.pendingApprovals[0];
	}

	get pendingUserInput(): AgentRuntimeUserInputRequest | undefined {
		return this.pendingUserInputs[0];
	}

	get pendingApprovals(): readonly AgentRuntimeApprovalRequest[] {
		return [...this.pendingByProductId.values()]
			.filter((pending): pending is PendingApproval => pending.kind === "approval")
			.map((pending) => cloneApproval(pending.request));
	}

	get pendingUserInputs(): readonly AgentRuntimeUserInputRequest[] {
		return [...this.pendingByProductId.values()]
			.filter((pending): pending is PendingUserInput => pending.kind === "user_input")
			.map((pending) => cloneUserInput(pending.request));
	}

	async respondToApproval(requestId: string, decision: string): Promise<void> {
		const pending = this.pendingByProductId.get(requestId);
		if (!pending || pending.kind !== "approval") throw new Error("The runtime approval request is no longer pending.");
		if (!APPROVAL_DECISION_IDS.has(decision) || !pending.request.decisions?.some((candidate) => candidate.id === decision)) {
			throw new Error(`Unsupported runtime approval decision "${decision}".`);
		}
		this.removePending(pending, "responded");
		pending.deferred.resolve({ decision: decision as CodexAppServerApprovalDecision });
	}

	async respondToUserInput(requestId: string, answers: PiboJsonObject): Promise<void> {
		const pending = this.pendingByProductId.get(requestId);
		if (!pending || pending.kind !== "user_input") throw new Error("The runtime user-input request is no longer pending.");
		const response = normalizeAnswers(pending.request, answers);
		this.removePending(pending, "responded");
		pending.deferred.resolve(response);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.unsubscribeNotifications();
		this.unsubscribeDiagnostics();
		this.client.setServerRequestHandler(undefined);
		for (const pending of [...this.pendingByProductId.values()]) this.cancelPending(pending, "aborted");
	}

	private async handleServerRequest(request: CodexAppServerServerRequest): Promise<unknown> {
		if (this.disposed) throw new CodexAppServerServerRequestCancelledError();
		if (request.method === "item/commandExecution/requestApproval") return await this.handleCommandApproval(request);
		if (request.method === "item/fileChange/requestApproval") return await this.handleFileApproval(request);
		if (request.method === "item/tool/requestUserInput") return await this.handleUserInput(request);
		throw new Error(`Unsupported Codex server request method: ${request.method}`);
	}

	private async handleCommandApproval(request: CodexAppServerServerRequest): Promise<CodexAppServerApprovalResponse> {
		const params = requiredRecord(request.params, "command approval request") as CodexAppServerCommandApprovalParams & Record<string, unknown>;
		const scope = validateScope(params, this.getThreadId(), this.getActiveTurnId(), "command approval request");
		requiredInteger(params.startedAtMs, "command approval start timestamp");
		const pending = this.createApproval(request.id, scope, approvalRequest(randomUUID(), "command_execution", params));
		return await pending.deferred.promise;
	}

	private async handleFileApproval(request: CodexAppServerServerRequest): Promise<CodexAppServerApprovalResponse> {
		const params = requiredRecord(request.params, "file approval request") as CodexAppServerFileChangeApprovalParams & Record<string, unknown>;
		const scope = validateScope(params, this.getThreadId(), this.getActiveTurnId(), "file approval request");
		requiredInteger(params.startedAtMs, "file approval start timestamp");
		const pending = this.createApproval(request.id, scope, approvalRequest(randomUUID(), "file_change", params));
		return await pending.deferred.promise;
	}

	private async handleUserInput(request: CodexAppServerServerRequest): Promise<CodexAppServerUserInputResponse> {
		if (!this.structuredUserInputEnabled) throw new Error("Codex structured user input is not enabled for this configured runtime instance.");
		const params = requiredRecord(request.params, "user-input request") as CodexAppServerUserInputRequestParams & Record<string, unknown>;
		const scope = validateScope(params, this.getThreadId(), this.getActiveTurnId(), "user-input request");
		if (typeof params.isBlocking !== "boolean") throw new Error("Codex user-input blocking state is invalid.");
		if (!Array.isArray(params.questions) || params.questions.length === 0 || params.questions.length > MAX_USER_INPUT_QUESTIONS) {
			throw new Error("Codex user-input questions are invalid.");
		}
		const questions = params.questions.map(userInputQuestion);
		if (new Set(questions.map((question) => question.id)).size !== questions.length) {
			throw new Error("Codex user-input question ids must be unique.");
		}
		const productRequestId = randomUUID();
		const runtimeRequest: AgentRuntimeUserInputRequest = {
			requestId: productRequestId,
			questions,
			blocking: params.isBlocking,
		};
		const pending: PendingUserInput = {
			kind: "user_input",
			productRequestId,
			nativeRequestId: request.id,
			nativeRequestKey: nativeRequestKey(request.id),
			...scope,
			request: runtimeRequest,
			deferred: deferred<CodexAppServerUserInputResponse>(),
		};
		this.addPending(pending);
		this.emit({ type: "user_input_requested", request: cloneUserInput(runtimeRequest) });
		return await pending.deferred.promise;
	}

	private createApproval(
		nativeRequestId: CodexAppServerRequestId,
		scope: { threadId: string; turnId: string; itemId: string },
		runtimeRequest: AgentRuntimeApprovalRequest,
	): PendingApproval {
		const pending: PendingApproval = {
			kind: "approval",
			productRequestId: runtimeRequest.requestId,
			nativeRequestId,
			nativeRequestKey: nativeRequestKey(nativeRequestId),
			...scope,
			request: runtimeRequest,
			deferred: deferred<CodexAppServerApprovalResponse>(),
		};
		this.addPending(pending);
		this.emit({ type: "approval_requested", request: cloneApproval(runtimeRequest) });
		return pending;
	}

	private addPending(pending: PendingRequest): void {
		if (this.productIdByNativeKey.has(pending.nativeRequestKey)) throw new Error("Codex repeated a pending server request id.");
		this.pendingByProductId.set(pending.productRequestId, pending);
		this.productIdByNativeKey.set(pending.nativeRequestKey, pending.productRequestId);
	}

	private removePending(pending: PendingRequest, resolution: AgentRuntimeRequestResolution): void {
		if (!this.pendingByProductId.delete(pending.productRequestId)) return;
		this.productIdByNativeKey.delete(pending.nativeRequestKey);
		this.emit(pending.kind === "approval"
			? { type: "approval_resolved", requestId: pending.productRequestId, resolution }
			: { type: "user_input_resolved", requestId: pending.productRequestId, resolution });
	}

	private cancelPending(pending: PendingRequest, resolution: AgentRuntimeRequestResolution): void {
		this.removePending(pending, resolution);
		pending.deferred.reject(new CodexAppServerServerRequestCancelledError());
	}

	private handleResolvedNotification(value: unknown): void {
		const params = requiredRecord(value, "server-request resolution notification");
		if (requiredString(params.threadId, "server-request resolution thread id") !== this.getThreadId()) return;
		const requestId = params.requestId;
		if ((typeof requestId !== "string" && typeof requestId !== "number") || (typeof requestId === "number" && !Number.isSafeInteger(requestId))) {
			throw new Error("Codex server-request resolution id is invalid.");
		}
		const productRequestId = this.productIdByNativeKey.get(nativeRequestKey(requestId));
		if (!productRequestId) return;
		const pending = this.pendingByProductId.get(productRequestId);
		if (pending) this.cancelPending(pending, "cleared");
	}

	private handleTurnCompleted(value: unknown): void {
		const params = requiredRecord(value, "turn completion notification");
		if (requiredString(params.threadId, "turn completion thread id") !== this.getThreadId()) return;
		const turn = requiredRecord(params.turn, "completed turn");
		const turnId = requiredString(turn.id, "completed turn id");
		for (const pending of [...this.pendingByProductId.values()]) {
			if (pending.turnId === turnId) this.cancelPending(pending, "cleared");
		}
	}

	private handleTurnStarted(value: unknown): void {
		const params = requiredRecord(value, "turn start notification");
		if (requiredString(params.threadId, "turn start thread id") !== this.getThreadId()) return;
		const turn = requiredRecord(params.turn, "started turn");
		const turnId = requiredString(turn.id, "started turn id");
		for (const pending of [...this.pendingByProductId.values()]) {
			if (pending.turnId !== turnId) this.cancelPending(pending, "expired");
		}
	}
}
