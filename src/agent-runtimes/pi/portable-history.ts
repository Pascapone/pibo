import type { Message, ToolCall } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PiboJsonValue } from "../../core/events.js";
import type { AgentRuntimeHistoryEntry } from "../../agent-runtime/history.js";
import type { AgentRuntimePortableHistory } from "../../agent-runtime/portable-history.js";

function timestamp(createdAt: string): number {
	const parsed = Date.parse(createdAt);
	return Number.isFinite(parsed) ? parsed : Date.now();
}

function textContent(entry: AgentRuntimeHistoryEntry): string {
	if (entry.type === "session_info") return entry.name;
	if (typeof entry.content === "string") return entry.content;
	return entry.content.flatMap((part) => {
		if (part.type === "text" || part.type === "reasoning") return [part.text];
		return [];
	}).join("\n");
}

function toolArguments(value: PiboJsonValue | undefined): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	return value === undefined ? {} : { value };
}

function assistantMessage(entry: Extract<AgentRuntimeHistoryEntry, { type: "message" }>): Message | undefined {
	const content: Array<{ type: "text"; text: string } | ToolCall> = [];
	if (typeof entry.content === "string") {
		if (entry.content) content.push({ type: "text", text: entry.content });
	} else {
		for (const part of entry.content) {
			if (part.type === "text") content.push({ type: "text", text: part.text });
			if (part.type === "tool_call") {
				content.push({
					type: "toolCall",
					id: part.toolCallId,
					name: part.toolName,
					arguments: toolArguments(part.input),
				});
			}
		}
	}
	if (content.length === 0) return undefined;
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "pibo-portable-history",
		model: "portable-history",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
		timestamp: timestamp(entry.createdAt),
	};
}

function portableMessage(entry: AgentRuntimeHistoryEntry): Message | undefined {
	if (entry.type === "session_info") {
		return {
			role: "user",
			content: `[Pibo portable session information]\n${entry.name}`,
			timestamp: timestamp(entry.createdAt),
		};
	}
	if (entry.role === "assistant") return assistantMessage(entry);
	if (entry.role === "tool") {
		return {
			role: "toolResult",
			toolCallId: entry.toolCallId ?? entry.id,
			toolName: entry.toolName ?? "tool",
			content: [{ type: "text", text: textContent(entry) }],
			details: entry.result,
			isError: entry.isError === true || entry.status === "error",
			timestamp: timestamp(entry.createdAt),
		};
	}
	const text = textContent(entry);
	if (!text) return undefined;
	return {
		role: "user",
		content: entry.role === "system"
			? `[Pibo portable system context]\n${text}`
			: text,
		timestamp: timestamp(entry.createdAt),
	};
}

export function importPortableHistoryIntoPi(
	sessionManager: SessionManager,
	history: AgentRuntimePortableHistory,
): void {
	for (const entry of history.entries) {
		const message = portableMessage(entry);
		if (message) sessionManager.appendMessage(message);
	}
}
