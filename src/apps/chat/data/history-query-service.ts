import { tracePayloadRefForStoredPayload } from "../trace-v2.js";
import { ChatReadProjectionStore } from "../../../data/chat-read-projections.js";
import type { AgentRuntimeHistoryEntry } from "../../../agent-runtime/history.js";
import type { PiboJsonObject } from "../../../core/events.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";

export type ChatProductHistoryCoverage = {
	messageCount: number;
	complete?: boolean;
	revision?: number;
	firstEventSequence?: number;
	lastEventSequence?: number;
	firstCreatedAt?: string;
	lastCreatedAt?: string;
};

const HISTORY_MESSAGE_MAX_BYTES = 64 * 1024;
const HISTORY_ENTRY_RESERVE_MAX_BYTES = 4 * 1024;

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
	constructor(private readonly store: PiboDataStore, private readonly pageByteBudget = Number.POSITIVE_INFINITY) {}

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
        const complete=new ChatReadProjectionStore(this.store.db).status().historyComplete;
        const rows = complete ? this.store.db.prepare(`
          SELECT m.*,h.event_sequence FROM chat_history_index h JOIN chat_messages m ON m.id=h.message_id
          WHERE h.session_id=? AND h.role IN ('user','assistant','system') ${input.beforeSequence!==undefined?"AND h.event_sequence < ?":""}
          ORDER BY h.event_sequence DESC,h.message_id DESC LIMIT ?
        `).all(input.piboSessionId,...(input.beforeSequence!==undefined?[input.beforeSequence]:[]),limit) as HistoryMessageRow[] : this.store.db.prepare(`
			SELECT m.*, e.session_sequence AS event_sequence
			FROM chat_messages m
			LEFT JOIN event_log e ON e.stream_id = m.source_stream_id
			WHERE ${clauses.join(" AND ")}
			ORDER BY m.sequence DESC
			LIMIT ?
		`).all(...values, limit) as HistoryMessageRow[];
		const preparedRows = rows.flatMap((row) => {
			const role = historyRole(row.role);
			return role ? [{ row, role, attributes: parseObject(row.attributes_json) }] : [];
		});
		// Rows arrive newest first. Reserve a bounded share for older rows, then spend the
		// remainder on the tail so requesting more history cannot shorten its newest nodes.
		const reservePerEntry = Number.isFinite(this.pageByteBudget)
			? Math.min(HISTORY_ENTRY_RESERVE_MAX_BYTES, Math.floor(this.pageByteBudget / Math.max(1, preparedRows.length)))
			: Number.POSITIVE_INFINITY;
		let remainingBytes = this.pageByteBudget;
		const entries = preparedRows.map(({ row, role, attributes }, index) => {
			const reservedForOlderEntries = reservePerEntry * (preparedRows.length - index - 1);
			const maximumBytes = Number.isFinite(this.pageByteBudget)
				? Math.min(HISTORY_MESSAGE_MAX_BYTES, Math.max(0, remainingBytes - reservedForOlderEntries))
				: Number.POSITIVE_INFINITY;
			const text = this.readMessageText(row, attributes, maximumBytes);
			if (Number.isFinite(remainingBytes)) remainingBytes = Math.max(0, remainingBytes - Buffer.byteLength(text, "utf8"));
			const contentBytes = row.content_payload_ref
				? this.store.payloads.getPayload(row.content_payload_ref)?.byteSize
				: typeof attributes.inlineText === "string"
					? Buffer.byteLength(attributes.inlineText, "utf8")
					: Buffer.byteLength(row.content_preview ?? "", "utf8");
			const contentTruncated = contentBytes !== undefined && Buffer.byteLength(text, "utf8") < contentBytes;
			return {
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
					tracePayloadRef: contentTruncated && row.content_payload_ref ? tracePayloadRefForStoredPayload({payloadStore:this.store.payloads,piboSessionId:row.session_id,payloadId:row.content_payload_ref,nodeId:`product:${row.id}`,payloadKind:"output"}) as unknown as PiboJsonObject : undefined,
					contentTruncated: contentTruncated || undefined,
					contentBytes: contentTruncated ? contentBytes : undefined,
				}),
			} satisfies AgentRuntimeHistoryEntry;
		});
		return entries.reverse();
	}

	getProductHistoryCoverage(piboSessionId: string): ChatProductHistoryCoverage {
        const complete=new ChatReadProjectionStore(this.store.db).status().historyComplete;
        const count=this.store.db.prepare("SELECT message_count,revision FROM chat_history_counts WHERE session_id=?").get(piboSessionId) as {message_count:number;revision:number}|undefined;
        const edge=(column:"event_sequence"|"created_at",order:"ASC"|"DESC") => this.store.db.prepare(`SELECT ${column} AS value FROM chat_history_index WHERE session_id=? ORDER BY ${column} ${order},message_id ${order} LIMIT 1`).get(piboSessionId) as {value:number|string}|undefined;
        return {messageCount:count?.message_count??0,revision:count?.revision??0,complete,
          firstEventSequence:edge("event_sequence","ASC")?.value as number|undefined,
          lastEventSequence:edge("event_sequence","DESC")?.value as number|undefined,
          firstCreatedAt:edge("created_at","ASC")?.value as string|undefined,
          lastCreatedAt:edge("created_at","DESC")?.value as string|undefined};
    }

	private readMessageText(row: HistoryMessageRow, attributes: PiboJsonObject, maximumBytes: number): string {
		if (row.content_payload_ref) {
			try {
				if (!Number.isFinite(this.pageByteBudget)) return this.store.payloads.readPayloadText(row.content_payload_ref);
				const payload = this.store.payloads.getPayload(row.content_payload_ref);
				if (!payload || payload.byteSize > maximumBytes) return truncateUtf8(row.content_preview ?? "", maximumBytes);
				return this.store.payloads.readPayloadText(row.content_payload_ref);
			} catch {
				// Retain the durable preview if the external payload was removed or corrupted.
			}
		}
		if (typeof attributes.inlineText === "string") return truncateUtf8(attributes.inlineText, maximumBytes);
		return truncateUtf8(row.content_preview ?? "", maximumBytes);
	}
}

function truncateUtf8(value: string, maximumBytes: number): string {
	if (!Number.isFinite(maximumBytes) || Buffer.byteLength(value, "utf8") <= maximumBytes) return value;
	let end = Math.max(0, Math.floor(maximumBytes));
	const bytes = Buffer.from(value, "utf8");
	while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
	return bytes.subarray(0, end).toString("utf8");
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
