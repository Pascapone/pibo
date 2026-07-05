import type { ChatEventListInput, StoredChatEvent } from "../types/event-store.js";
import type { ChatWebStoredPiboEvent } from "../types/read-model.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import { storedChatEventFromV2Row, storedPiboEventFromV2Row, type EventLogRow } from "./chat-data-mappers.js";

export class ChatTimelineQueryService {
	constructor(private readonly store: PiboDataStore) {}

	listEvents(input: ChatEventListInput = {}): StoredChatEvent[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.roomId) { clauses.push("room_id = ?"); values.push(input.roomId); }
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		if (input.afterStreamId !== undefined) { clauses.push("stream_id > ?"); values.push(input.afterStreamId); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.min(input.limit ?? 1000, 5000));
		const rows = this.store.db.prepare(`SELECT * FROM event_log ${where} ORDER BY stream_id ASC LIMIT ?`).all(...values, limit) as EventLogRow[];
		return rows.map(storedChatEventFromV2Row);
	}

	listSessionEvents(piboSessionId: string, limit = 1000): ChatWebStoredPiboEvent[] {
		return this.listTraceEvents({ piboSessionId, limit, includeLive: true });
	}

	listAllSessionEvents(piboSessionId: string): ChatWebStoredPiboEvent[] {
		return this.listTraceEvents({ piboSessionId, limit: 10000, includeLive: true });
	}

	listTraceEvents(input: { piboSessionId: string; limit?: number; beforeOrAtSequence?: number; beforeSequence?: number; includeLive?: boolean } | string): ChatWebStoredPiboEvent[] {
		const piboSessionId = typeof input === "string" ? input : input.piboSessionId;
		const limit = Math.max(1, Math.min((typeof input === "string" ? undefined : input.limit) ?? 2000, 10000));
		const beforeOrAtSequence = typeof input === "string" ? undefined : input.beforeOrAtSequence;
		const beforeSequence = typeof input === "string" ? undefined : input.beforeSequence;
		const includeLive = typeof input === "string" ? false : input.includeLive === true;
		const clauses = ["session_id = ?"];
		const values: Array<string | number> = [piboSessionId];
		if (!includeLive) clauses.push("type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated')");
		if (beforeSequence !== undefined) {
			clauses.push("session_sequence < ?");
			values.push(beforeSequence);
		} else if (beforeOrAtSequence !== undefined) {
			clauses.push("session_sequence <= ?");
			values.push(beforeOrAtSequence);
		}
		const rows = this.store.db.prepare(`
			SELECT * FROM (
				SELECT * FROM event_log
				WHERE ${clauses.join(" AND ")}
				ORDER BY session_sequence DESC, stream_id DESC
				LIMIT ?
			)
			ORDER BY session_sequence ASC, stream_id ASC
		`).all(...values, limit) as EventLogRow[];
		return rows.map(storedPiboEventFromV2Row).filter((event): event is ChatWebStoredPiboEvent => event !== undefined);
	}

	countEventsByType(input: { piboSessionId?: string; eventTypes?: string[] } = {}): Array<{ eventType: string; count: number }> {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		if (input.eventTypes?.length) { clauses.push(`type IN (${input.eventTypes.map(() => "?").join(", ")})`); values.push(...input.eventTypes); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.store.db.prepare(`SELECT type, COUNT(*) AS count FROM event_log ${where} GROUP BY type ORDER BY type`).all(...values) as Array<{ type: string; count: number }>;
		return rows.map((row) => ({ eventType: row.type, count: Number(row.count) }));
	}

	getLatestEventSequence(piboSessionId: string): number {
		const row = this.store.db.prepare(`
			SELECT session_sequence AS latest_sequence
			FROM event_log
			WHERE session_id = ?
			ORDER BY session_sequence DESC, stream_id DESC
			LIMIT 1
		`).get(piboSessionId) as { latest_sequence: number } | undefined;
		return row?.latest_sequence ?? 0;
	}

	getLatestStreamId(input: { roomId?: string; piboSessionId?: string } = {}): number | undefined {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.roomId) { clauses.push("room_id = ?"); values.push(input.roomId); }
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const row = this.store.db.prepare(`SELECT MAX(stream_id) AS stream_id FROM event_log ${where}`).get(...values) as { stream_id: number | null } | undefined;
		return row?.stream_id ?? undefined;
	}
}
