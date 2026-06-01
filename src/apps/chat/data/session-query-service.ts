import type { PiboOutputEvent } from "../../../core/events.js";
import { chatRoomIdFromMetadata } from "../types/rooms.js";
import type { ChatWebSessionBootstrapIndexResult, ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "../types/read-model.js";
import type { PiboSession } from "../../../sessions/store.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import { legacyOwnerScopeForPreCutoverSchemas } from "../../../owner-scope-compat.js";
import { sessionFromRow, statusFromOutputEvent, type SessionRow } from "./chat-data-mappers.js";

export class ChatSessionQueryService {
	constructor(private readonly store: PiboDataStore) {}

	upsertSession(session: PiboSession, status: ChatWebSessionIndexItem["status"] = "idle"): void {
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? "room_default";
		this.store.sessions.upsertSession({ session, roomId, status, lastActivityAt: session.updatedAt });
		this.upsertNavigation(session, roomId, status, session.updatedAt);
	}

	upsertSessionsIfChanged(sessions: PiboSession[]): ChatWebSessionBootstrapIndexResult {
		for (const session of sessions) this.upsertSession(session);
		return { checked: sessions.length, written: sessions.length, skipped: 0 };
	}

	recordEvent(event: PiboOutputEvent, session?: PiboSession): ChatWebStoredPiboEvent | undefined {
		if (session) this.upsertSession(session, statusFromOutputEvent(event));
		return undefined;
	}

	listSessions(): ChatWebSessionIndexItem[] {
		const rows = this.store.db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY last_activity_at DESC, created_at DESC").all() as SessionRow[];
		return rows.map(sessionFromRow);
	}

	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined {
		const row = this.store.db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(piboSessionId) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	hasSessionActivity(piboSessionId: string): boolean {
		const row = this.store.db.prepare("SELECT 1 AS found FROM event_log WHERE session_id = ? AND type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated') LIMIT 1").get(piboSessionId) as { found: number } | undefined;
		return Boolean(row) || this.getSession(piboSessionId)?.status === "running";
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		this.store.db.prepare(`DELETE FROM observations WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM chat_messages WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM event_log WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM session_navigation WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		const result = this.store.db.prepare(`UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?) WHERE id IN (${placeholders})`).run(new Date().toISOString(), ...piboSessionIds);
		return Number(result.changes ?? 0);
	}

	close(): void {}

	private upsertNavigation(session: PiboSession, roomId: string, status: string, now: string): void {
		this.store.navigation.upsertSession({
			ownerScope: legacyOwnerScopeForPreCutoverSchemas(),
			roomId,
			sessionId: session.id,
			rootSessionId: session.parentId ? (typeof session.metadata?.rootSessionId === "string" ? session.metadata.rootSessionId : session.parentId) : session.id,
			parentId: session.parentId,
			originId: session.originId,
			title: session.title || "Untitled Session",
			profile: session.profile,
			status,
			archivedAt: typeof session.metadata?.archivedAt === "string" ? session.metadata.archivedAt : undefined,
			lastActivityAt: now,
			sortKey: now,
			updatedAt: now,
		});
	}
}
