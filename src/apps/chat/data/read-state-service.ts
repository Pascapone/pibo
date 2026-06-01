import type { PiboDataStore } from "../../../data/pibo-store.js";

export class ChatReadStateService {
	constructor(private readonly store: PiboDataStore) {}

	markSessionRead(piboSessionId: string, lastReadStreamId: number): void {
		const now = new Date().toISOString();
		this.store.db.prepare(`
			INSERT INTO app_session_read_state (session_id, last_read_stream_id, last_read_at, updated_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(session_id) DO UPDATE SET
				last_read_stream_id = MAX(app_session_read_state.last_read_stream_id, excluded.last_read_stream_id),
				last_read_at = excluded.last_read_at,
				updated_at = excluded.updated_at
		`).run(piboSessionId, lastReadStreamId, now, now);
	}

	countUnreadMessagesBySession(input: { piboSessionIds: string[] }): Map<string, number> {
		const counts = new Map<string, number>();
		if (!input.piboSessionIds.length) return counts;
		for (let offset = 0; offset < input.piboSessionIds.length; offset += 400) {
			const ids = [...new Set(input.piboSessionIds)].slice(offset, offset + 400);
			const placeholders = ids.map(() => "?").join(", ");
			const rows = this.store.db.prepare(`
				SELECT e.session_id, COUNT(*) AS count
				FROM event_log e
				LEFT JOIN app_session_read_state reads ON reads.session_id = e.session_id
				WHERE e.session_id IN (${placeholders})
					AND e.stream_id > COALESCE(reads.last_read_stream_id, 0)
					AND (
						(e.retention_class = 'chat_message' AND e.type IN ('user.message.accepted', 'assistant_message'))
						OR e.type = 'session_error'
					)
				GROUP BY e.session_id
			`).all(...ids) as Array<{ session_id: string; count: number }>;
			for (const row of rows) if (Number(row.count) > 0) counts.set(row.session_id, Number(row.count));
		}
		return counts;
	}
}
