import type { AgentRuntimeHistoryEntry } from "../../agent-runtime/history.js";
import type { AgentRuntimePortableHistory } from "../../agent-runtime/portable-history.js";
import type { CodexAppServerClient } from "./client.js";
import type {
	CodexAppServerJson,
	CodexAppServerThreadInjectItemsParams,
	CodexAppServerThreadInjectItemsResponse,
} from "./protocol-types.js";

function jsonString(value: unknown): string {
	try {
		return JSON.stringify(value ?? null);
	} catch {
		return JSON.stringify({ portableFallback: "History value was not JSON serializable." });
	}
}

function textFromEntry(entry: AgentRuntimeHistoryEntry): string {
	if (entry.type === "session_info") return entry.name;
	if (typeof entry.content === "string") return entry.content;
	return entry.content.flatMap((part) => {
		if (part.type === "text" || part.type === "reasoning") return [part.text];
		return [];
	}).join("\n");
}

function responseItems(entry: AgentRuntimeHistoryEntry): CodexAppServerJson[] {
	if (entry.type === "session_info") {
		return [{
			type: "message",
			role: "developer",
			content: [{ type: "input_text", text: `[Pibo portable session information]\n${entry.name}` }],
		}];
	}
	if (entry.role === "tool") {
		return [{
			type: "function_call_output",
			call_id: entry.toolCallId ?? entry.id,
			output: typeof entry.content === "string" ? entry.content : jsonString(entry.result),
		}];
	}
	if (entry.role === "assistant") {
		const items: CodexAppServerJson[] = [];
		const text = textFromEntry(entry);
		if (text) {
			items.push({
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text }],
			});
		}
		if (Array.isArray(entry.content)) {
			for (const part of entry.content) {
				if (part.type !== "tool_call") continue;
				items.push({
					type: "function_call",
					name: part.toolName,
					arguments: jsonString(part.input),
					call_id: part.toolCallId,
				});
			}
		}
		return items;
	}
	const text = textFromEntry(entry);
	if (!text) return [];
	return [{
		type: "message",
		role: entry.role === "system" ? "developer" : "user",
		content: [{ type: "input_text", text }],
	}];
}

export async function injectPortableHistoryIntoCodex(
	client: CodexAppServerClient,
	threadId: string,
	history: AgentRuntimePortableHistory,
): Promise<void> {
	const items = history.entries.flatMap(responseItems);
	if (items.length === 0) return;
	await client.request<CodexAppServerThreadInjectItemsResponse, CodexAppServerThreadInjectItemsParams>(
		"thread/inject_items",
		{ threadId, items },
	);
}
