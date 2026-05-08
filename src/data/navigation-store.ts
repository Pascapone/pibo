import type { DatabaseSync } from "node:sqlite";

export type SessionNavigationUpsertInput = {
	ownerScope: string;
	roomId?: string;
	sessionId: string;
	rootSessionId?: string;
	parentId?: string;
	originId?: string;
	title: string;
	profile: string;
	status: string;
	archivedAt?: string;
	lastActivityAt: string;
	lastMessagePreview?: string;
	childCount?: number;
	sortKey: string;
	updatedAt: string;
};

export type StoredSessionNavigation = SessionNavigationUpsertInput;

export type SessionNavigationListInput = {
	ownerScope: string;
	roomId?: string;
	includeArchived?: boolean;
	limit?: number;
};

type SessionNavigationRow = {
	owner_scope: string;
	room_id: string | null;
	session_id: string;
	root_session_id: string | null;
	parent_id: string | null;
	origin_id: string | null;
	title: string;
	profile: string;
	status: string;
	archived_at: string | null;
	last_activity_at: string;
	last_message_preview: string | null;
	child_count: number;
	sort_key: string;
	updated_at: string;
};

export class NavigationStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	upsertSession(input: SessionNavigationUpsertInput): StoredSessionNavigation {
		this.db.prepare(`
			INSERT INTO session_navigation (
				owner_scope,
				room_id,
				session_id,
				root_session_id,
				parent_id,
				origin_id,
				title,
				profile,
				status,
				archived_at,
				last_activity_at,
				last_message_preview,
				child_count,
				sort_key,
				updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id) DO UPDATE SET
				owner_scope = excluded.owner_scope,
				room_id = excluded.room_id,
				root_session_id = excluded.root_session_id,
				parent_id = excluded.parent_id,
				origin_id = excluded.origin_id,
				title = excluded.title,
				profile = excluded.profile,
				status = excluded.status,
				archived_at = excluded.archived_at,
				last_activity_at = excluded.last_activity_at,
				last_message_preview = excluded.last_message_preview,
				child_count = excluded.child_count,
				sort_key = excluded.sort_key,
				updated_at = excluded.updated_at
		`).run(
			input.ownerScope,
			input.roomId ?? null,
			input.sessionId,
			input.rootSessionId ?? null,
			input.parentId ?? null,
			input.originId ?? null,
			input.title,
			input.profile,
			input.status,
			input.archivedAt ?? null,
			input.lastActivityAt,
			input.lastMessagePreview ?? null,
			input.childCount ?? 0,
			input.sortKey,
			input.updatedAt,
		);
		const stored = this.getSession(input.sessionId);
		if (!stored) throw new Error(`Failed to upsert session navigation \"${input.sessionId}\"`);
		return stored;
	}

	getSession(sessionId: string): StoredSessionNavigation | undefined {
		const row = this.db.prepare("SELECT * FROM session_navigation WHERE session_id = ?").get(sessionId) as SessionNavigationRow | undefined;
		return row ? sessionNavigationFromRow(row) : undefined;
	}

	listSessions(input: SessionNavigationListInput): StoredSessionNavigation[] {
		const clauses = ["owner_scope = ?"];
		const values: Array<string | number> = [input.ownerScope];
		if (input.roomId !== undefined) {
			clauses.push("room_id = ?");
			values.push(input.roomId);
		}
		if (!input.includeArchived) clauses.push("archived_at IS NULL");
		const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));
		const rows = this.db.prepare(`
			SELECT * FROM session_navigation
			WHERE ${clauses.join(" AND ")}
			ORDER BY sort_key DESC, updated_at DESC
			LIMIT ?
		`).all(...values, limit) as SessionNavigationRow[];
		return rows.map(sessionNavigationFromRow);
	}
}

function sessionNavigationFromRow(row: SessionNavigationRow): StoredSessionNavigation {
	return {
		ownerScope: row.owner_scope,
		roomId: row.room_id ?? undefined,
		sessionId: row.session_id,
		rootSessionId: row.root_session_id ?? undefined,
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		title: row.title,
		profile: row.profile,
		status: row.status,
		archivedAt: row.archived_at ?? undefined,
		lastActivityAt: row.last_activity_at,
		lastMessagePreview: row.last_message_preview ?? undefined,
		childCount: row.child_count,
		sortKey: row.sort_key,
		updatedAt: row.updated_at,
	};
}
