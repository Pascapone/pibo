import type {
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	InspectAgentRuntimeHistoryInput,
	ReadAgentRuntimeHistoryInput,
} from "../../agent-runtime/history.js";
import type { RuntimeSessionBinding } from "../../sessions/runtime-binding.js";
import { OmpRpcClient } from "./client.js";
import { OMP_ADAPTER_ID } from "./thread.js";
import { OMP_ADAPTER_VERSION } from "./thread.js";

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
	if (isRecord(message)) {
		if (typeof message.role === "string") {
			const role = message.role;
			if (role === "user" || role === "assistant" || role === "tool" || role === "system") return role;
		}
	}
	return "system";
}

function messageEntryId(message: unknown): string | undefined {
	if (!isRecord(message)) return undefined;
	for (const key of ["entryId", "id", "messageId"]) {
		const value = message[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
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

function toHistoryEntry(message: unknown, sequence: number, binding: RuntimeSessionBinding): AgentRuntimeHistoryEntry {
	const role = messageEntryRole(message);
	const content = messageText(message);
	const nativeEntryId = messageEntryId(message);
	return {
		id: nativeEntryId ? `omp:${nativeEntryId}` : `${binding.nativeSessionId ?? "omp"}-${sequence}`,
		type: "message",
		source: "native",
		createdAt: isRecord(message) && typeof message.timestamp === "string"
			? message.timestamp
			: new Date().toISOString(),
		sequence,
		...(nativeEntryId ? { nativeEntryId } : {}),
		role,
		content: content || "[empty message]",
	};
}

export async function readOmpHistory(
	client: OmpRpcClient,
	input: ReadAgentRuntimeHistoryInput,
	runtimeInstanceId: string,
	binding: RuntimeSessionBinding,
): Promise<AgentRuntimeHistoryPage> {
	try {
		const result = await client.request(
			{
				type: "get_messages_page",
				...(input.cursor ? { cursor: input.cursor } : {}),
				...(input.limit ? { limit: input.limit } : {}),
			},
			"get_messages_page",
		);
		const data = result["data" as keyof typeof result];
		if (!isRecord(data) || !Array.isArray(data.messages)) {
			return emptyPage(runtimeInstanceId);
		}
		const entries: AgentRuntimeHistoryEntry[] = [];
		let sequence = 0;
		for (const message of data.messages) {
			entries.push(toHistoryEntry(message, sequence++, binding));
		}
		return {
			runtimeInstanceId,
			adapterId: OMP_ADAPTER_ID,
			source: "native",
			entries,
			...(typeof data.nextCursor === "string" ? { nextCursor: data.nextCursor } : {}),
			hasMore: typeof data.nextCursor === "string" && data.nextCursor.length > 0,
		};
	} catch {
		return emptyPage(runtimeInstanceId);
	}
}

function emptyPage(runtimeInstanceId: string): AgentRuntimeHistoryPage {
	return {
		runtimeInstanceId,
		adapterId: OMP_ADAPTER_ID,
		source: "native",
		entries: [],
		hasMore: false,
	};
}
export function emptyOmpHistoryPage(runtimeInstanceId: string): AgentRuntimeHistoryPage {
	return {
		runtimeInstanceId,
		adapterId: OMP_ADAPTER_ID,
		source: "native",
		entries: [],
		hasMore: false,
	};
}
