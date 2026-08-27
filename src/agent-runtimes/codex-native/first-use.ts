import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	PENDING_NATIVE_SESSION_METADATA_KEY,
	type RuntimeSessionBinding,
} from "../../sessions/runtime-binding.js";
import type { CodexAppServerThread, CodexAppServerThreadItem, CodexAppServerTurn } from "./protocol-types.js";

export const CODEX_FIRST_USE_METADATA_KEY = "codexNativeFirstUse";
export const CODEX_FIRST_USE_METADATA_VERSION = 3;

const LEGACY_BYTE_EXACT_METADATA_VERSIONS = new Set([1, 2]);

const MAX_NATIVE_ID_LENGTH = 512;
const MAX_MESSAGE_ID_LENGTH = 512;
const MAX_PROCESS_START_ID_LENGTH = 64;
const MAX_PID = 0x7fff_ffff;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROCESS_START_ID_PATTERN = /^([1-9][0-9]{0,9}):([1-9][0-9]{0,30})$/;
const TERMINAL_TURN_STATUSES = new Set(["completed", "interrupted", "failed"]);
const PROCESS_INSTANCE_ID = randomUUID();
const activeAttemptIds = new Set<string>();

export type CodexNativePendingFirstUse = {
	version: 1 | 2 | typeof CODEX_FIRST_USE_METADATA_VERSION;
	state: "pending";
	threadId: string;
	messageId: string;
	promptHash: string;
	attemptId: string;
	ownerPid: number;
	ownerProcessStartId?: string;
	ownerProcessInstanceId: string;
};

export type CodexNativeFirstUseDeliveryReceipt = {
	version: 1 | 2 | typeof CODEX_FIRST_USE_METADATA_VERSION;
	state: "delivered";
	messageId: string;
	promptHash: string;
};

export type CodexNativeFirstUseOwnerLiveness = "active" | "dead" | "ambiguous";

export type CodexNativeFirstUseLivenessDependencies = {
	platform?: NodeJS.Platform;
	currentPid?: number;
	currentProcessInstanceId?: string;
	readProcStat?: (pid: number) => string;
	probePid?: (pid: number) => void;
};

type LinuxProcessProbe = {
	liveness: CodexNativeFirstUseOwnerLiveness;
	startId?: string;
};

function boundedNonEmptyString(value: unknown, maximumLength: number): value is string {
	return typeof value === "string"
		&& value.length > 0
		&& value.length <= maximumLength
		&& !/[\u0000-\u001f\u007f]/.test(value);
}

function validPid(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_PID;
}

function errorCode(error: unknown): string | undefined {
	return error && typeof error === "object" && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}

function probeLinuxProcess(
	pid: number,
	readProcStat: (pid: number) => string,
): LinuxProcessProbe {
	let stat: string;
	try {
		stat = readProcStat(pid);
	} catch (error) {
		return ["ENOENT", "ESRCH"].includes(errorCode(error) ?? "")
			? { liveness: "dead" }
			: { liveness: "ambiguous" };
	}
	const close = stat.lastIndexOf(")");
	if (close < 2 || close + 2 >= stat.length) return { liveness: "ambiguous" };
	const fields = stat.slice(close + 2).trim().split(/\s+/);
	if (fields.length <= 19) return { liveness: "ambiguous" };
	if (fields[0] === "Z") return { liveness: "dead" };
	const startTicks = fields[19];
	if (!startTicks || !/^[1-9][0-9]{0,30}$/.test(startTicks)) return { liveness: "ambiguous" };
	return { liveness: "active", startId: `${pid}:${startTicks}` };
}

function probePortableProcess(pid: number, probePid: (pid: number) => void): CodexNativeFirstUseOwnerLiveness {
	try {
		probePid(pid);
		return "active";
	} catch (error) {
		return errorCode(error) === "ESRCH" ? "dead" : "ambiguous";
	}
}

function defaultReadProcStat(pid: number): string {
	return readFileSync(`/proc/${pid}/stat`, "utf8");
}

function defaultProbePid(pid: number): void {
	process.kill(pid, 0);
}

function hashUtf8(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Canonical first-use prompts use LF line endings and Unicode NFC. Pibo hashes
 * this representation before native execution and when proving native history.
 */
export function canonicalizeCodexNativeFirstUsePrompt(prompt: string): string {
	return prompt.replace(/\r\n?/g, "\n").normalize("NFC");
}

export function hashCanonicalCodexNativeFirstUsePrompt(prompt: string): string {
	return hashUtf8(canonicalizeCodexNativeFirstUsePrompt(prompt));
}

function hashPersistedPromptEvidence(
	identity: Pick<CodexNativePendingFirstUse | CodexNativeFirstUseDeliveryReceipt, "version">,
	prompt: string,
): string {
	return LEGACY_BYTE_EXACT_METADATA_VERSIONS.has(identity.version)
		? hashUtf8(prompt)
		: hashCanonicalCodexNativeFirstUsePrompt(prompt);
}

export function codexNativeFirstUseDeliveryReceipt(
	pending: CodexNativePendingFirstUse,
): CodexNativeFirstUseDeliveryReceipt {
	return {
		version: pending.version,
		state: "delivered",
		messageId: pending.messageId,
		promptHash: pending.promptHash,
	};
}

export function readCodexNativePendingFirstUse(
	binding: RuntimeSessionBinding,
): CodexNativePendingFirstUse | undefined {
	const value = binding.metadata?.[CODEX_FIRST_USE_METADATA_KEY];
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("The pending native Codex first-use metadata is invalid.");
	}
	const record = value as Record<string, unknown>;
	const allowedKeys = new Set([
		"version",
		"state",
		"threadId",
		"messageId",
		"promptHash",
		"attemptId",
		"ownerPid",
		"ownerProcessStartId",
		"ownerProcessInstanceId",
	]);
	const ownerProcessStartId = record.ownerProcessStartId;
	const startMatch = typeof ownerProcessStartId === "string"
		? PROCESS_START_ID_PATTERN.exec(ownerProcessStartId)
		: undefined;
	if (
		Object.keys(record).some((key) => !allowedKeys.has(key))
		|| (record.version !== 1 && record.version !== 2 && record.version !== CODEX_FIRST_USE_METADATA_VERSION)
		|| record.state !== "pending"
		|| !boundedNonEmptyString(record.threadId, MAX_NATIVE_ID_LENGTH)
		|| !boundedNonEmptyString(record.messageId, MAX_MESSAGE_ID_LENGTH)
		|| typeof record.promptHash !== "string"
		|| !SHA256_PATTERN.test(record.promptHash)
		|| typeof record.attemptId !== "string"
		|| !UUID_V4_PATTERN.test(record.attemptId)
		|| !validPid(record.ownerPid)
		|| typeof record.ownerProcessInstanceId !== "string"
		|| !UUID_V4_PATTERN.test(record.ownerProcessInstanceId)
		|| (ownerProcessStartId !== undefined
			&& (typeof ownerProcessStartId !== "string"
				|| ownerProcessStartId.length > MAX_PROCESS_START_ID_LENGTH
				|| !startMatch
				|| Number(startMatch[1]) !== record.ownerPid))
	) {
		throw new Error("The pending native Codex first-use metadata is invalid.");
	}
	return record as CodexNativePendingFirstUse;
}

export function readCodexNativeFirstUseDeliveryReceipt(
	binding: RuntimeSessionBinding,
): CodexNativeFirstUseDeliveryReceipt | undefined {
	const value = binding.metadata?.[CODEX_FIRST_USE_METADATA_KEY];
	if (value === undefined) return undefined;
	if (
		binding.state !== "bound"
		|| binding.metadata?.[PENDING_NATIVE_SESSION_METADATA_KEY] !== undefined
		|| !value
		|| typeof value !== "object"
		|| Array.isArray(value)
	) {
		throw new Error("The delivered native Codex first-use receipt is invalid.");
	}
	const record = value as Record<string, unknown>;
	const allowedKeys = new Set(["version", "state", "messageId", "promptHash"]);
	if (
		Object.keys(record).some((key) => !allowedKeys.has(key))
		|| (record.version !== 1 && record.version !== 2 && record.version !== CODEX_FIRST_USE_METADATA_VERSION)
		|| record.state !== "delivered"
		|| !boundedNonEmptyString(record.messageId, MAX_MESSAGE_ID_LENGTH)
		|| typeof record.promptHash !== "string"
		|| !SHA256_PATTERN.test(record.promptHash)
	) {
		throw new Error("The delivered native Codex first-use receipt is invalid.");
	}
	return record as CodexNativeFirstUseDeliveryReceipt;
}

export function beginCodexNativeFirstUseAttempt(): Pick<
	CodexNativePendingFirstUse,
	"attemptId" | "ownerPid" | "ownerProcessStartId" | "ownerProcessInstanceId"
> {
	const attemptId = randomUUID();
	let ownerProcessStartId: string | undefined;
	if (process.platform === "linux") {
		const probe = probeLinuxProcess(process.pid, defaultReadProcStat);
		if (probe.liveness !== "active" || !probe.startId) {
			throw new Error("Native Codex first use cannot establish the current process identity safely.");
		}
		ownerProcessStartId = probe.startId;
	}
	activeAttemptIds.add(attemptId);
	return {
		attemptId,
		ownerPid: process.pid,
		...(ownerProcessStartId ? { ownerProcessStartId } : {}),
		ownerProcessInstanceId: PROCESS_INSTANCE_ID,
	};
}

export function endCodexNativeFirstUseAttempt(attemptId: string): void {
	activeAttemptIds.delete(attemptId);
}

export function codexNativePendingFirstUseOwnerLiveness(
	pending: CodexNativePendingFirstUse,
	dependencies: CodexNativeFirstUseLivenessDependencies = {},
): CodexNativeFirstUseOwnerLiveness {
	const platform = dependencies.platform ?? process.platform;
	const currentPid = dependencies.currentPid ?? process.pid;
	const currentProcessInstanceId = dependencies.currentProcessInstanceId ?? PROCESS_INSTANCE_ID;
	let processLiveness: CodexNativeFirstUseOwnerLiveness;
	let observedStartId: string | undefined;
	if (platform === "linux") {
		const probe = probeLinuxProcess(pending.ownerPid, dependencies.readProcStat ?? defaultReadProcStat);
		processLiveness = probe.liveness;
		observedStartId = probe.startId;
		if (processLiveness !== "active") return processLiveness;
		if (!pending.ownerProcessStartId || !observedStartId) return "ambiguous";
		if (pending.ownerProcessStartId !== observedStartId) return "dead";
	} else {
		processLiveness = probePortableProcess(pending.ownerPid, dependencies.probePid ?? defaultProbePid);
		if (processLiveness !== "active") return processLiveness;
	}
	if (pending.ownerPid !== currentPid) return "active";
	if (pending.ownerProcessInstanceId !== currentProcessInstanceId) return "ambiguous";
	return activeAttemptIds.has(pending.attemptId) ? "active" : "dead";
}

function exactTextUserItem(item: CodexAppServerThreadItem): { clientId?: string | null; text: string } | undefined {
	if (item.type !== "userMessage" || !Array.isArray(item.content) || item.content.length !== 1) return undefined;
	const part = item.content[0];
	if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;
	const record = part as Record<string, unknown>;
	if (record.type !== "text" || typeof record.text !== "string") return undefined;
	if (item.clientId !== undefined && item.clientId !== null && typeof item.clientId !== "string") return undefined;
	return { ...(item.clientId !== undefined ? { clientId: item.clientId as string | null } : {}), text: record.text };
}

function assertCodexNativeFirstUseTurnEvidence(
	identity: Pick<CodexNativePendingFirstUse | CodexNativeFirstUseDeliveryReceipt, "messageId" | "promptHash" | "version">,
	turn: CodexAppServerTurn,
	state: "pending" | "delivered",
): void {
	if (!TERMINAL_TURN_STATUSES.has(turn.status)) {
		throw new Error(`The ${state} native Codex first turn is not terminal and cannot be reconciled safely.`);
	}
	const userItems = turn.items.filter((item) => item.type === "userMessage");
	const evidence = userItems.map(exactTextUserItem);
	if (evidence.length === 0 || evidence.some((item) => !item)) {
		throw new Error(`The ${state} native Codex first turn has ambiguous user input evidence.`);
	}
	const exactEvidence = evidence as Array<{ clientId?: string | null; text: string }>;
	const evidenceWithClientIds = exactEvidence.filter((item) => item.clientId !== undefined && item.clientId !== null);
	let firstRequestEvidence: { clientId?: string | null; text: string };
	if (evidenceWithClientIds.length > 0) {
		if (evidenceWithClientIds.length !== exactEvidence.length) {
			throw new Error(`The ${state} native Codex first turn has ambiguous user input evidence.`);
		}
		const matches = evidenceWithClientIds.filter((item) => item.clientId === identity.messageId);
		if (matches.length === 0) {
			throw new Error(`The ${state} native Codex first turn does not match the persisted message id.`);
		}
		if (matches.length > 1) {
			throw new Error(`The ${state} native Codex first turn has ambiguous user input evidence.`);
		}
		firstRequestEvidence = matches[0]!;
	} else {
		if (exactEvidence.length !== 1) {
			throw new Error(`The ${state} native Codex first turn has ambiguous user input evidence.`);
		}
		firstRequestEvidence = exactEvidence[0]!;
	}
	if (hashPersistedPromptEvidence(identity, firstRequestEvidence.text) !== identity.promptHash) {
		throw new Error(`The ${state} native Codex first turn does not match the persisted prompt hash.`);
	}
	if (
		firstRequestEvidence.clientId !== undefined
		&& firstRequestEvidence.clientId !== null
		&& !boundedNonEmptyString(firstRequestEvidence.clientId, MAX_MESSAGE_ID_LENGTH)
	) {
		throw new Error(`The ${state} native Codex first turn has invalid message identity evidence.`);
	}
}

export function assertCodexNativePendingFirstUseTurn(
	pending: CodexNativePendingFirstUse,
	thread: CodexAppServerThread,
): void {
	if (thread.id !== pending.threadId || thread.turns.length !== 1) {
		throw new Error("The pending native Codex first turn is missing, multiple, or belongs to another thread.");
	}
	assertCodexNativeFirstUseTurnEvidence(pending, thread.turns[0]!, "pending");
}

export function assertCodexNativeFirstUseDeliveryReceiptTurn(
	receipt: CodexNativeFirstUseDeliveryReceipt,
	thread: CodexAppServerThread,
): CodexAppServerTurn {
	const firstTurn = thread.turns[0];
	if (!firstTurn) throw new Error("The delivered native Codex first turn is missing.");
	assertCodexNativeFirstUseTurnEvidence(receipt, firstTurn, "delivered");
	return firstTurn;
}

export function isExactCodexNativeFirstUseDeliveryReplay(
	receipt: CodexNativeFirstUseDeliveryReceipt,
	messageId: string,
	prompt: string,
): boolean {
	if (messageId !== receipt.messageId) return false;
	if (hashPersistedPromptEvidence(receipt, prompt) !== receipt.promptHash) {
		throw new Error("Native Codex first-use replay reuses the delivered message id with a different prompt.");
	}
	return true;
}

export function assertCodexNativePendingFirstUseRequest(
	pending: CodexNativePendingFirstUse,
	messageId: string,
	prompt: string,
): void {
	if (messageId !== pending.messageId || hashPersistedPromptEvidence(pending, prompt) !== pending.promptHash) {
		throw new Error("Native Codex first-use retry does not match the persisted message id and prompt.");
	}
}

export function assertCodexNativeFirstUseMessageId(messageId: string): void {
	if (!boundedNonEmptyString(messageId, MAX_MESSAGE_ID_LENGTH)) {
		throw new Error("Native Codex first-use message id is invalid.");
	}
}
