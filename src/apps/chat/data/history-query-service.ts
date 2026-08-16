import type { AgentRuntimeHistoryEntry } from "../../../agent-runtime/history.js";
import type { PiboJsonObject } from "../../../core/events.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";

export type ChatProductHistoryCoverage = {
	messageCount: number;
	firstEventSequence?: number;
	lastEventSequence?: number;
	firstCreatedAt?: string;
	lastCreatedAt?: string;
};

type HistoryMessageRow = {
	id: string;
	session_id: string;
	sequence: number;
	turn_id: string | null;
	role: string;
	status: string;
	created_at: string;
	completed_at: string | null;
	content_preview: string | null;
	content_payload_ref: string | null;
	source_stream_id: number | null;
	attributes_json: string;
	event_sequence: number | null;
};

export class ChatHistoryQueryService {
	constructor(private readonly store: PiboDataStore) {}

	listProductHistoryEntries(input: {
		piboSessionId: string;
		limit?: number;
		beforeSequence?: number;
	}): AgentRuntimeHistoryEntry[] {
		const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
		const clauses = ["m.session_id = ?", "m.role IN ('user', 'assistant', 'system')"];
		const values: Array<string | number> = [input.piboSessionId];
		if (input.beforeSequence !== undefined) {
			clauses.push("COALESCE(e.session_sequence, m.sequence) < ?");
			values.push(input.beforeSequence);
		}
		const rows = this.store.db.prepare(`
			SELECT m.*, e.session_sequence AS event_sequence
			FROM chat_messages m
			LEFT JOIN event_log e ON e.stream_id = m.source_stream_id
			WHERE ${clauses.join(" AND ")}
			ORDER BY m.sequence DESC
			LIMIT ?
		`).all(...values, limit) as HistoryMessageRow[];
		return rows.reverse().flatMap((row) => {
			const role = historyRole(row.role);
			if (!role) return [];
			const attributes = parseObject(row.attributes_json);
			const text = this.readMessageText(row, attributes);
			return [{
				id: `product:${row.id}`,
				type: "message" as const,
				source: "product" as const,
				createdAt: row.created_at,
				sequence: row.event_sequence ?? row.sequence,
				turnId: row.turn_id ?? undefined,
				role,
				content: text,
				assistantIndex: numberValue(attributes.assistantIndex),
				contentIndex: numberValue(attributes.contentIndex),
				status: historyStatus(row.status),
				metadata: compactObject({
					messageId: row.id,
					sourceStreamId: row.source_stream_id ?? undefined,
					completedAt: row.completed_at ?? undefined,
					payloadRef: row.content_payload_ref ?? undefined,
				}),
			} satisfies AgentRuntimeHistoryEntry];
		});
	}

	getProductHistoryCoverage(piboSessionId: string): ChatProductHistoryCoverage {
		const row = this.store.db.prepare(`
			SELECT
				COUNT(*) AS message_count,
				MIN(e.session_sequence) AS first_event_sequence,
				MAX(e.session_sequence) AS last_event_sequence,
				MIN(m.created_at) AS first_created_at,
				MAX(m.created_at) AS last_created_at
			FROM chat_messages m
			LEFT JOIN event_log e ON e.stream_id = m.source_stream_id
			WHERE m.session_id = ?
		`).get(piboSessionId) as {
			message_count: number;
			first_event_sequence: number | null;
			last_event_sequence: number | null;
			first_created_at: string | null;
			last_created_at: string | null;
		};
		return {
			messageCount: Number(row.message_count ?? 0),
			firstEventSequence: row.first_event_sequence ?? undefined,
			lastEventSequence: row.last_event_sequence ?? undefined,
			firstCreatedAt: row.first_created_at ?? undefined,
			lastCreatedAt: row.last_created_at ?? undefined,
		};
	}

	private readMessageText(row: HistoryMessageRow, attributes: PiboJsonObject): string {
		if (row.content_payload_ref) {
			try {
				return this.store.payloads.readPayloadText(row.content_payload_ref);
			} catch {
				// Retain the durable preview if the external payload was removed or corrupted.
			}
		}
		if (typeof attributes.inlineText === "string") return attributes.inlineText;
		return row.content_preview ?? "";
	}
}

function historyRole(role: string): "user" | "assistant" | "system" | undefined {
	return role === "user" || role === "assistant" || role === "system" ? role : undefined;
}

function historyStatus(status: string): "complete" | "running" | "error" {
	if (status === "running" || status === "streaming" || status === "in_progress") return "running";
	if (status === "error" || status === "failed") return "error";
	return "complete";
}

function parseObject(value: string): PiboJsonObject {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : {};
	} catch {
		return {};
	}
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactObject(value: Record<string, unknown>): PiboJsonObject | undefined {
	const compact = Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject;
	return Object.keys(compact).length ? compact : undefined;
}
