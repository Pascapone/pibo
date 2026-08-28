import type {
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	InspectAgentRuntimeHistoryInput,
	ReadAgentRuntimeHistoryInput,
} from "../../agent-runtime/history.js";
import { createCompleteHistoryReconciliationProof } from "../../agent-runtime/history.js";
import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type { RuntimeSessionBinding } from "../../sessions/runtime-binding.js";
import { TRACE_RECONCILIATION_ENTRY_CAP } from "../../shared/trace-limits.js";
import { OmpRpcClient } from "./client.js";
import { OMP_ADAPTER_ID, OMP_ADAPTER_VERSION } from "./thread.js";

const OMP_HISTORY_CURSOR_PREFIX = "omp-history:";
const OMP_HISTORY_PAGE_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 100;

type OmpHistoryCursor = {
	v: 1;
	nativeSessionId: string;
	beforeIndex: number;
};

class OmpHistoryResponseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OmpHistoryResponseError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inspectOmpHistory(
	input: InspectAgentRuntimeHistoryInput,
	runtimeInstanceId: string,
): AgentRuntimeHistoryInspection {
	const binding = input.binding;
	return {
		runtimeInstanceId,
		adapterId: OMP_ADAPTER_ID,
		bindingState: binding.state,
		available: binding.state === "bound" && Boolean(binding.nativeSessionId),
		...(binding.locator ? { locator: binding.locator } : {}),
		version: OMP_ADAPTER_VERSION,
		diagnostics: [],
	};
}

function messageEntryRole(message: unknown): "user" | "assistant" | "tool" | "system" {
	if (isRecord(message) && typeof message.role === "string") {
		const role = message.role;
		if (role === "user" || role === "assistant" || role === "tool" || role === "system") return role;
	}
	return "system";
}

function messageString(message: unknown, keys: readonly string[]): string | undefined {
	if (!isRecord(message)) return undefined;
	for (const key of keys) {
		const value = message[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function messageEntryId(message: unknown): string | undefined {
	return messageString(message, ["entryId", "id", "messageId"]);
}

function messageText(message: unknown): string {
	if (typeof message === "string") return message;
	if (!isRecord(message)) return "";
	if (typeof message.text === "string") return message.text;
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		const parts: string[] = [];
		for (const part of message.content) {
			if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
		}
		return parts.join("\n");
	}
	return "";
}

function jsonValue(value: unknown, depth = 0): PiboJsonValue {
	if (depth > 32) return "[maximum depth reached]";
	if (value === null || typeof value === "boolean" || typeof value === "string") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (Array.isArray(value)) return value.map((child) => jsonValue(child, depth + 1));
	if (isRecord(value)) {
		const result: PiboJsonObject = {};
		for (const [key, child] of Object.entries(value)) {
			if (child !== undefined) result[key] = jsonValue(child, depth + 1);
		}
		return result;
	}
	return String(value);
}

function toHistoryEntry(
	message: unknown,
	sequence: number,
	binding: RuntimeSessionBinding,
	historyScopeId: string,
): AgentRuntimeHistoryEntry {
	const role = messageEntryRole(message);
	const content = messageText(message) || "[empty message]";
	const nativeEntryId = messageEntryId(message);
	const nativeTurnId = messageString(message, ["turnId", "nativeTurnId"]);
	const nativeSessionId = binding.nativeSessionId ?? "omp";
	const historyPosition = `omp:${nativeSessionId}:message:${sequence}`;
	const toolCallId = role === "tool"
		? messageString(message, ["toolCallId", "callId"]) ?? `omp-tool:${nativeSessionId}:${sequence}`
		: undefined;
	const toolName = role === "tool" ? messageString(message, ["toolName", "name"]) ?? "OMP Tool" : undefined;
	return {
		id: `omp:${nativeSessionId}:message:${sequence}`,
		type: "message",
		source: "native",
		createdAt: isRecord(message) && typeof message.timestamp === "string"
			? message.timestamp
			: new Date(0).toISOString(),
		sequence,
		historyPosition,
		historyScopeId,
		...(nativeTurnId ? { nativeTurnId } : {}),
		...(nativeEntryId ? { nativeEntryId } : {}),
		role,
		content,
		...(toolCallId ? {
			toolCallId,
			toolName,
			result: isRecord(message) && message.result !== undefined ? jsonValue(message.result) : content,
			isError: isRecord(message) && message.isError === true,
			status: isRecord(message) && message.isError === true ? "error" as const : "complete" as const,
		} : {}),
	};
}

function selectedLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_HISTORY_LIMIT;
	if (!Number.isSafeInteger(value) || value <= 0) throw new OmpHistoryResponseError("OMP native history limit must be a positive integer.");
	return Math.min(value, OMP_HISTORY_PAGE_LIMIT);
}

function encodeCursor(cursor: OmpHistoryCursor): string {
	return `${OMP_HISTORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeCursor(value: string | undefined, nativeSessionId: string): OmpHistoryCursor | undefined {
	if (!value) return undefined;
	if (!value.startsWith(OMP_HISTORY_CURSOR_PREFIX)) throw new OmpHistoryResponseError("Invalid OMP native history cursor.");
	try {
		const parsed = JSON.parse(Buffer.from(value.slice(OMP_HISTORY_CURSOR_PREFIX.length), "base64url").toString("utf8")) as Partial<OmpHistoryCursor>;
		if (
			parsed.v !== 1
			|| parsed.nativeSessionId !== nativeSessionId
			|| !Number.isSafeInteger(parsed.beforeIndex)
			|| Number(parsed.beforeIndex) < 0
		) throw new Error("invalid cursor");
		return parsed as OmpHistoryCursor;
	} catch {
		throw new OmpHistoryResponseError("Invalid OMP native history cursor.");
	}
}

function messagesPageData(result: unknown): { messages: unknown[]; nextCursor?: string; totalMessages: number } {
	const data = isRecord(result) ? result.data : undefined;
	if (
		!isRecord(data)
		|| !Array.isArray(data.messages)
		|| !Number.isSafeInteger(data.totalMessages)
		|| Number(data.totalMessages) < 0
	) throw new OmpHistoryResponseError("OMP returned an invalid native history page.");
	return {
		messages: data.messages,
		...(typeof data.nextCursor === "string" && data.nextCursor.length > 0 ? { nextCursor: data.nextCursor } : {}),
		totalMessages: Number(data.totalMessages),
	};
}

async function readCompleteOmpMessages(client: OmpRpcClient): Promise<unknown[]> {
	const pages: unknown[][] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	let expectedTotal: number | undefined;
	let collected = 0;
	let pageRequests = 0;
	do {
		pageRequests += 1;
		if (pageRequests > TRACE_RECONCILIATION_ENTRY_CAP + 1) {
			throw new OmpHistoryResponseError("OMP native history exceeded the bounded provider page sequence.");
		}
		const result = await client.request({
			type: "get_messages_page",
			...(cursor ? { cursor } : {}),
			limit: OMP_HISTORY_PAGE_LIMIT,
		}, "get_messages_page");
		const page = messagesPageData(result);
		expectedTotal ??= page.totalMessages;
		if (page.totalMessages !== expectedTotal) {
			throw new OmpHistoryResponseError("OMP native history changed while its proof was collected.");
		}
		if (page.messages.length > OMP_HISTORY_PAGE_LIMIT) {
			throw new OmpHistoryResponseError("OMP native history exceeded the requested provider page bound.");
		}
		if (expectedTotal > TRACE_RECONCILIATION_ENTRY_CAP) {
			throw new OmpHistoryResponseError(`OMP native history exceeds the ${TRACE_RECONCILIATION_ENTRY_CAP}-entry proof bound.`);
		}
		if (collected + page.messages.length > expectedTotal) {
			throw new OmpHistoryResponseError("OMP native history pages exceed their declared total.");
		}
		pages.push(page.messages);
		collected += page.messages.length;
		if (collected === expectedTotal) {
			if (page.nextCursor) {
				throw new OmpHistoryResponseError("OMP native history cursor extends beyond its declared total.");
			}
			break;
		}
		if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
			throw new OmpHistoryResponseError("OMP native history cannot prove a complete bounded page sequence.");
		}
		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	} while (true);
	if (collected !== expectedTotal) throw new OmpHistoryResponseError("OMP native history proof is incomplete.");
	return pages.reverse().flat();
}

export async function readOmpHistory(
	client: OmpRpcClient,
	input: ReadAgentRuntimeHistoryInput,
	runtimeInstanceId: string,
	binding: RuntimeSessionBinding,
): Promise<AgentRuntimeHistoryPage> {
	const nativeSessionId = binding.nativeSessionId ?? "omp";
	const historyScopeId = `omp:${runtimeInstanceId}:${nativeSessionId}`;
	try {
		const messages = await readCompleteOmpMessages(client);
		const allEntries = messages.map((message, sequence) =>
			toHistoryEntry(message, sequence, binding, historyScopeId)
		);
		const beforeTimestampMs = input.beforeTimestamp === undefined ? undefined : Date.parse(input.beforeTimestamp);
		if (beforeTimestampMs !== undefined && Number.isNaN(beforeTimestampMs)) {
			throw new OmpHistoryResponseError("OMP native history beforeTimestamp is invalid.");
		}
		const filtered = beforeTimestampMs === undefined
			? allEntries
			: allEntries.filter((entry) => Date.parse(entry.createdAt) < beforeTimestampMs);
		const cursor = decodeCursor(input.cursor, nativeSessionId);
		const end = Math.min(cursor?.beforeIndex ?? filtered.length, filtered.length);
		const limit = selectedLimit(input.limit);
		const start = Math.max(0, end - limit);
		const entries = filtered.slice(start, end);
		return {
			runtimeInstanceId,
			adapterId: OMP_ADAPTER_ID,
			source: "native",
			entries,
			reconciliationProof: createCompleteHistoryReconciliationProof(allEntries, historyScopeId),
			orderOffset: start,
			...(start > 0 ? { nextCursor: encodeCursor({ v: 1, nativeSessionId, beforeIndex: start }) } : {}),
			hasMore: start > 0,
		};
	} catch (error) {
		if (error instanceof OmpHistoryResponseError) throw error;
		throw new OmpHistoryResponseError("OMP native history could not establish a complete bounded proof.");
	}
}

function emptyPage(runtimeInstanceId: string): AgentRuntimeHistoryPage {
	return {
		runtimeInstanceId,
		adapterId: OMP_ADAPTER_ID,
		source: "native",
		entries: [],
		reconciliationProof: { complete: false, entries: [] },
		hasMore: false,
	};
}

export function emptyOmpHistoryPage(runtimeInstanceId: string): AgentRuntimeHistoryPage {
	return emptyPage(runtimeInstanceId);
}
