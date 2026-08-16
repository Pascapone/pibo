import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type {
	AgentRuntimeHistoryContentPart,
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryMessageEntry,
	AgentRuntimeHistoryPage,
} from "../../agent-runtime/history.js";
import type { RuntimeSessionBinding } from "../../agent-runtime/types.js";
import type {
	CodexAppServerThread,
	CodexAppServerThreadItem,
	CodexAppServerTurn,
} from "./protocol-types.js";
import { redactCodexNativeSensitiveText } from "./redaction.js";
import { CODEX_NATIVE_ADAPTER_ID } from "./thread.js";

const CODEX_HISTORY_CURSOR_PREFIX = "codex-history:";
const DEFAULT_HISTORY_LIMIT = 100;
const MAX_HISTORY_LIMIT = 200;

type CodexHistoryCursor = {
	v: 1;
	threadId: string;
	beforeIndex: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isoFromSeconds(seconds: number | null | undefined, fallback: number): string {
	const selected = Number.isSafeInteger(seconds) ? Number(seconds) : fallback;
	const date = new Date(selected * 1_000);
	return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function jsonValue(value: unknown, depth = 0): PiboJsonValue {
	if (depth > 32) return "[maximum depth reached]";
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "string") return redactCodexNativeSensitiveText(value);
	if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
	if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, depth + 1));
	if (isRecord(value)) {
		const result: PiboJsonObject = {};
		for (const [key, entry] of Object.entries(value)) {
			if (entry !== undefined) result[key] = jsonValue(entry, depth + 1);
		}
		return result;
	}
	return String(value);
}

function turnStatus(turn: CodexAppServerTurn): AgentRuntimeHistoryMessageEntry["status"] {
	if (turn.status === "inProgress") return "running";
	if (turn.status === "failed") return "error";
	return "complete";
}

function textUserInput(item: CodexAppServerThreadItem): string {
	if (!Array.isArray(item.content)) return "";
	const text: string[] = [];
	for (const part of item.content) {
		if (!isRecord(part) || typeof part.type !== "string") continue;
		if (part.type === "text" && typeof part.text === "string") text.push(redactCodexNativeSensitiveText(part.text));
		else if (part.type === "image" || part.type === "localImage") text.push("[image]");
		else if (part.type === "audio" || part.type === "localAudio") text.push("[audio]");
		else if (part.type === "skill" && typeof part.name === "string") text.push(`[skill: ${part.name}]`);
		else if (part.type === "mention" && typeof part.name === "string") text.push(`[mention: ${part.name}]`);
	}
	return text.join("\n");
}

function reasoningParts(item: CodexAppServerThreadItem): AgentRuntimeHistoryContentPart[] {
	const values = [
		...(Array.isArray(item.summary) ? item.summary : []),
		...(Array.isArray(item.content) ? item.content : []),
	].filter((value): value is string => typeof value === "string" && value.length > 0)
		.map(redactCodexNativeSensitiveText);
	return values.length > 0 ? [{ type: "reasoning", text: values.join("\n") }] : [];
}

function itemEntry(
	thread: CodexAppServerThread,
	turn: CodexAppServerTurn,
	item: CodexAppServerThreadItem,
	sequence: number,
): AgentRuntimeHistoryMessageEntry | undefined {
	const createdAt = isoFromSeconds(turn.startedAt ?? turn.completedAt, thread.updatedAt);
	const base = {
		id: `codex:${thread.id}:${turn.id}:${item.id}`,
		type: "message" as const,
		source: "native" as const,
		createdAt,
		sequence,
		turnId: turn.id,
		nativeTurnId: turn.id,
		nativeEntryId: item.id,
		status: turnStatus(turn),
	};
	if (item.type === "userMessage") {
		return { ...base, role: "user", content: textUserInput(item) };
	}
	if (item.type === "agentMessage" && typeof item.text === "string") {
		return { ...base, role: "assistant", content: redactCodexNativeSensitiveText(item.text) };
	}
	if (item.type === "reasoning") {
		const content = reasoningParts(item);
		if (content.length === 0) return undefined;
		return { ...base, role: "assistant", content };
	}
	if (item.type === "commandExecution") {
		const command = typeof item.command === "string" ? redactCodexNativeSensitiveText(item.command) : "Codex command";
		const output = typeof item.aggregatedOutput === "string" ? redactCodexNativeSensitiveText(item.aggregatedOutput) : "";
		const status = typeof item.status === "string" ? item.status : "completed";
		return {
			...base,
			role: "tool",
			content: output || "Codex command execution",
			toolCallId: item.id,
			toolName: "codex_command",
			result: output,
			isError: status === "failed" || status === "declined",
			metadata: { command },
		};
	}
	if (item.type === "fileChange") {
		const status = typeof item.status === "string" ? item.status : "completed";
		return {
			...base,
			role: "tool",
			content: "Codex file change",
			toolCallId: item.id,
			toolName: "codex_file_change",
			result: jsonValue(item.changes),
			isError: status === "failed" || status === "declined",
		};
	}
	if (item.type === "mcpToolCall") {
		const server = typeof item.server === "string" ? item.server : "mcp";
		const tool = typeof item.tool === "string" ? item.tool : "tool";
		const status = typeof item.status === "string" ? item.status : "completed";
		return {
			...base,
			role: "tool",
			content: status === "failed" ? "Codex MCP tool failed" : "Codex MCP tool result",
			toolCallId: item.id,
			toolName: `${server}/${tool}`,
			result: jsonValue(item.result ?? item.error ?? null),
			isError: status === "failed",
		};
	}
	if (item.type === "dynamicToolCall") {
		const tool = typeof item.tool === "string" ? item.tool : "dynamic_tool";
		const status = typeof item.status === "string" ? item.status : "completed";
		return {
			...base,
			role: "tool",
			content: status === "failed" ? "Codex dynamic tool failed" : "Codex dynamic tool result",
			toolCallId: item.id,
			toolName: tool,
			result: jsonValue(item.contentItems ?? item.success ?? null),
			isError: status === "failed" || item.success === false,
		};
	}
	if (item.type === "webSearch") {
		return {
			...base,
			role: "tool",
			content: typeof item.query === "string" ? item.query : "Codex web search",
			toolCallId: item.id,
			toolName: "codex_web_search",
			result: jsonValue(item.results ?? null),
			isError: false,
		};
	}
	return undefined;
}

export function codexThreadHistoryEntries(thread: CodexAppServerThread): AgentRuntimeHistoryEntry[] {
	const entries: AgentRuntimeHistoryEntry[] = [];
	let sequence = 0;
	if (thread.name) {
		entries.push({
			id: `codex:${thread.id}:session-info`,
			type: "session_info",
			source: "native",
			createdAt: isoFromSeconds(thread.createdAt, thread.createdAt),
			sequence: sequence++,
			nativeEntryId: thread.id,
			name: redactCodexNativeSensitiveText(thread.name),
		});
	}
	for (const turn of thread.turns) {
		for (const item of turn.items) {
			const entry = itemEntry(thread, turn, item, sequence);
			if (!entry) continue;
			entries.push(entry);
			sequence += 1;
		}
		if (turn.status === "failed" && turn.error !== undefined) {
			entries.push({
				id: `codex:${thread.id}:${turn.id}:error`,
				type: "message",
				source: "native",
				createdAt: isoFromSeconds(turn.completedAt ?? turn.startedAt, thread.updatedAt),
				sequence: sequence++,
				turnId: turn.id,
				nativeTurnId: turn.id,
				nativeEntryId: `${turn.id}:error`,
				role: "assistant",
				content: "Codex turn failed.",
				status: "error",
				error: "Codex turn failed.",
			});
		}
	}
	return entries;
}

export function inspectCodexThreadHistory(
	runtimeInstanceId: string,
	binding: RuntimeSessionBinding,
	thread: CodexAppServerThread,
): AgentRuntimeHistoryInspection {
	return {
		runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		bindingState: binding.state,
		available: true,
		locator: { kind: "adapter-resolved" },
		title: thread.name ? redactCodexNativeSensitiveText(thread.name) : undefined,
		firstMessage: thread.preview ? redactCodexNativeSensitiveText(thread.preview) : undefined,
		createdAt: isoFromSeconds(thread.createdAt, thread.createdAt),
		updatedAt: isoFromSeconds(thread.updatedAt, thread.updatedAt),
		entryCount: thread.turns.length > 0 ? codexThreadHistoryEntries(thread).length : undefined,
		version: thread.cliVersion,
		diagnostics: [],
	};
}

export function unavailableCodexThreadHistoryInspection(
	runtimeInstanceId: string,
	binding: RuntimeSessionBinding,
	code: string,
	message: string,
): AgentRuntimeHistoryInspection {
	return {
		runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		bindingState: binding.state,
		available: false,
		diagnostics: [{
			severity: binding.state === "missing" ? "error" : "warning",
			code,
			message,
		}],
	};
}

function encodeCursor(cursor: CodexHistoryCursor): string {
	return `${CODEX_HISTORY_CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

function decodeCursor(value: string | undefined, threadId: string): CodexHistoryCursor | undefined {
	if (!value) return undefined;
	if (!value.startsWith(CODEX_HISTORY_CURSOR_PREFIX)) throw new Error("Invalid Codex native history cursor.");
	try {
		const parsed = JSON.parse(Buffer.from(value.slice(CODEX_HISTORY_CURSOR_PREFIX.length), "base64url").toString("utf8")) as Partial<CodexHistoryCursor>;
		if (parsed.v !== 1 || parsed.threadId !== threadId || !Number.isSafeInteger(parsed.beforeIndex) || Number(parsed.beforeIndex) < 0) {
			throw new Error("invalid cursor");
		}
		return parsed as CodexHistoryCursor;
	} catch {
		throw new Error("Invalid Codex native history cursor.");
	}
}

function selectedLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_HISTORY_LIMIT;
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Codex native history limit must be a positive integer.");
	return Math.min(value, MAX_HISTORY_LIMIT);
}

export function pageCodexThreadHistory(input: {
	runtimeInstanceId: string;
	binding: RuntimeSessionBinding;
	thread: CodexAppServerThread;
	cursor?: string;
	beforeTimestamp?: string;
	limit?: number;
}): AgentRuntimeHistoryPage {
	const allEntries = codexThreadHistoryEntries(input.thread);
	const beforeTimestampMs = input.beforeTimestamp === undefined ? undefined : Date.parse(input.beforeTimestamp);
	if (beforeTimestampMs !== undefined && Number.isNaN(beforeTimestampMs)) {
		throw new Error("Codex native history beforeTimestamp is invalid.");
	}
	const filtered = beforeTimestampMs === undefined
		? allEntries
		: allEntries.filter((entry) => Date.parse(entry.createdAt) < beforeTimestampMs);
	const cursor = decodeCursor(input.cursor, input.thread.id);
	const end = Math.min(cursor?.beforeIndex ?? filtered.length, filtered.length);
	const limit = selectedLimit(input.limit);
	const start = Math.max(0, end - limit);
	const entries = filtered.slice(start, end);
	const hasMore = start > 0;
	return {
		runtimeInstanceId: input.runtimeInstanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		source: "native",
		entries,
		orderOffset: start,
		...(hasMore ? { nextCursor: encodeCursor({ v: 1, threadId: input.thread.id, beforeIndex: start }) } : {}),
		hasMore,
		inspection: inspectCodexThreadHistory(input.runtimeInstanceId, input.binding, input.thread),
	};
}
