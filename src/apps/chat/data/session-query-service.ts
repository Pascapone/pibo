import type { PiboOutputEvent } from "../../../core/events.js";
import { chatRoomIdFromMetadata } from "../types/rooms.js";
import type { ChatWebSessionBootstrapIndexResult, ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "../types/read-model.js";
import type { PiboSession } from "../../../sessions/store.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import type { StoredPayload } from "../../../data/payload-store.js";
import { sessionFromRow, statusFromOutputEvent, type SessionRow } from "./chat-data-mappers.js";
import { rootSessionId } from "../../../data/session-store.js";

export class ChatSessionQueryService {
	constructor(private readonly store: PiboDataStore) {}

	upsertSession(
		session: PiboSession,
		status: ChatWebSessionIndexItem["status"] = "idle",
		lastActivityAt = session.updatedAt,
	): void {
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? "room_default";
		this.store.sessions.upsertSession({ session, roomId, status, lastActivityAt });
		this.upsertNavigation(session, roomId, status, lastActivityAt);
	}

	upsertSessionsIfChanged(sessions: PiboSession[]): ChatWebSessionBootstrapIndexResult {
		let written = 0;
		let skipped = 0;
		for (const session of sessions) {
			if (this.sessionIndexMatches(session)) {
				skipped++;
				continue;
			}
			this.upsertSession(session);
			written++;
		}
		return { checked: sessions.length, written, skipped };
	}

	recordEvent(
		event: PiboOutputEvent,
		session?: PiboSession,
		_streamId?: number,
		createdAt = new Date().toISOString(),
	): ChatWebStoredPiboEvent | undefined {
		if (session) {
			const status = statusFromOutputEvent(event);
			if (status) this.upsertSession(session, status, createdAt);
			else this.touchSession(session, createdAt);
		}
		return undefined;
	}

	private touchSession(session: PiboSession, lastActivityAt: string): void {
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? "room_default";
		this.store.sessions.upsertSession({ session, roomId, lastActivityAt });
		this.store.navigation.upsertSession({
			roomId,
			sessionId: session.id,
			rootSessionId: rootSessionId(session),
			parentId: session.parentId,
			originId: session.originId,
			title: session.title || "Untitled Session",
			profile: session.profile,
			lastActivityAt,
			sortKey: lastActivityAt,
			updatedAt: lastActivityAt,
		});
	}

	listSessions(): ChatWebSessionIndexItem[] {
		const rows = this.store.db.prepare(`
			SELECT s.*, b.runtime_instance_id, b.runtime_adapter_id, b.native_session_id, b.binding_state
			FROM sessions s
			LEFT JOIN session_runtime_bindings b ON b.pibo_session_id = s.id
			WHERE s.deleted_at IS NULL
			ORDER BY s.last_activity_at DESC, s.created_at DESC
		`).all() as SessionRow[];
		return rows.map(sessionFromRow);
	}

	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined {
		const row = this.store.db.prepare(`
			SELECT s.*, b.runtime_instance_id, b.runtime_adapter_id, b.native_session_id, b.binding_state
			FROM sessions s
			LEFT JOIN session_runtime_bindings b ON b.pibo_session_id = s.id
			WHERE s.id = ? AND s.deleted_at IS NULL
		`).get(piboSessionId) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	hasSessionActivity(piboSessionId: string): boolean {
		const row = this.store.db.prepare("SELECT 1 AS found FROM event_log WHERE session_id = ? AND type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated') LIMIT 1").get(piboSessionId) as { found: number } | undefined;
		return Boolean(row) || this.getSession(piboSessionId)?.status === "running";
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		const payloadReleaseCounts = this.payloadReleaseCounts(placeholders, piboSessionIds);
		const releasedPayloads: StoredPayload[] = [];
		const deleted = this.store.transaction(() => {
			this.store.db.prepare(`DELETE FROM observations WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
			this.store.db.prepare(`DELETE FROM chat_messages WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
			this.store.db.prepare(`DELETE FROM event_log WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
			this.store.db.prepare(`DELETE FROM session_navigation WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
			for (const [payloadId, count] of payloadReleaseCounts) {
				const released = this.store.payloads.releaseReferences(payloadId, count);
				if (released) releasedPayloads.push(released);
			}
			const result = this.store.db.prepare(`UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?) WHERE id IN (${placeholders})`).run(new Date().toISOString(), ...piboSessionIds);
			return Number(result.changes ?? 0);
		});
		for (const payload of releasedPayloads) this.store.payloads.removeReleasedFile(payload);
		return deleted;
	}

	private payloadReleaseCounts(placeholders: string, piboSessionIds: string[]): Map<string, number> {
		const logicalReferences = new Map<string, Set<string>>();
		const add = (payloadId: string | null, key: string) => {
			if (!payloadId) return;
			let references = logicalReferences.get(payloadId);
			if (!references) {
				references = new Set();
				logicalReferences.set(payloadId, references);
			}
			references.add(key);
		};
		const events = this.store.db.prepare(`SELECT stream_id, payload_ref FROM event_log WHERE session_id IN (${placeholders}) AND payload_ref IS NOT NULL`).all(...piboSessionIds) as Array<{ stream_id: number; payload_ref: string }>;
		const eventPayloads = new Map(events.map((row) => [row.stream_id, row.payload_ref]));
		for (const row of events) add(row.payload_ref, `event:${row.stream_id}`);
		const messages = this.store.db.prepare(`SELECT id, source_stream_id, content_payload_ref FROM chat_messages WHERE session_id IN (${placeholders}) AND content_payload_ref IS NOT NULL`).all(...piboSessionIds) as Array<{ id: string; source_stream_id: number | null; content_payload_ref: string }>;
		for (const row of messages) {
			const linked = row.source_stream_id !== null && eventPayloads.get(row.source_stream_id) === row.content_payload_ref;
			add(row.content_payload_ref, linked ? `event:${row.source_stream_id}` : `message:${row.id}`);
		}
		const observations = this.store.db.prepare(`SELECT id, event_stream_id, payload_ref FROM observations WHERE session_id IN (${placeholders}) AND payload_ref IS NOT NULL`).all(...piboSessionIds) as Array<{ id: string; event_stream_id: number | null; payload_ref: string }>;
		for (const row of observations) {
			const linked = row.event_stream_id !== null && eventPayloads.get(row.event_stream_id) === row.payload_ref;
			add(row.payload_ref, linked ? `event:${row.event_stream_id}` : `observation:${row.id}`);
		}
		return new Map([...logicalReferences].map(([payloadId, references]) => [payloadId, references.size]));
	}

	close(): void {}

	private sessionIndexMatches(session: PiboSession, status: ChatWebSessionIndexItem["status"] = "idle"): boolean {
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? "room_default";
		const title = session.title || "Untitled Session";
		const metadataJson = JSON.stringify(session.metadata ?? {});
		const activeModelJson = session.activeModel ? JSON.stringify(session.activeModel) : null;
		const row = this.store.db.prepare(`
			SELECT
				s.pi_session_id,
				s.room_id,
				s.root_session_id,
				s.parent_id,
				s.origin_id,
				s.channel,
				s.kind,
				s.profile,
				s.active_model_json,
				s.workspace,
				s.title,
				s.status,
				s.metadata_json,
				s.created_at,
				s.updated_at,
				s.last_activity_at,
				b.runtime_instance_id,
				b.runtime_adapter_id,
				b.native_session_id,
				b.binding_state,
				n.status AS navigation_status,
				n.title AS navigation_title,
				n.sort_key AS navigation_sort_key,
				n.updated_at AS navigation_updated_at
			FROM sessions s
			LEFT JOIN session_runtime_bindings b ON b.pibo_session_id = s.id
			LEFT JOIN session_navigation n ON n.session_id = s.id
			WHERE s.id = ? AND s.deleted_at IS NULL
		`).get(session.id) as {
			pi_session_id: string | null;
			room_id: string | null;
			root_session_id: string | null;
			parent_id: string | null;
			origin_id: string | null;
			channel: string;
			kind: string;
			profile: string;
			active_model_json: string | null;
			workspace: string | null;
			title: string;
			status: string;
			metadata_json: string;
			created_at: string;
			updated_at: string;
			last_activity_at: string;
			runtime_instance_id: string | null;
			runtime_adapter_id: string | null;
			native_session_id: string | null;
			binding_state: string | null;
			navigation_status: string | null;
			navigation_title: string | null;
			navigation_sort_key: string | null;
			navigation_updated_at: string | null;
		} | undefined;
		if (!row) return false;
		const binding = session.runtimeBinding;
		return row.pi_session_id === (session.piSessionId || null)
			&& row.runtime_instance_id === (binding?.runtimeInstanceId ?? "pi")
			&& row.runtime_adapter_id === (binding?.adapterId ?? "pi")
			&& row.native_session_id === (binding?.nativeSessionId ?? (session.piSessionId || null))
			&& row.binding_state === (binding?.state ?? (session.piSessionId ? "bound" : "unbound"))
			&& row.room_id === roomId
			&& row.root_session_id === rootSessionId(session)
			&& row.parent_id === (session.parentId ?? null)
			&& row.origin_id === (session.originId ?? null)
			&& row.channel === session.channel
			&& row.kind === session.kind
			&& row.profile === session.profile
			&& row.active_model_json === activeModelJson
			&& row.workspace === (session.workspace ?? null)
			&& row.title === title
			&& row.status === status
			&& row.metadata_json === metadataJson
			&& row.created_at === session.createdAt
			&& row.updated_at >= session.updatedAt
			&& row.last_activity_at >= session.updatedAt
			&& row.navigation_status === status
			&& row.navigation_title === title
			&& row.navigation_sort_key !== null
			&& row.navigation_sort_key >= session.updatedAt
			&& row.navigation_updated_at !== null
			&& row.navigation_updated_at >= session.updatedAt;
	}

	private upsertNavigation(session: PiboSession, roomId: string, status: string, now: string): void {
		this.store.navigation.upsertSession({
			roomId,
			sessionId: session.id,
			rootSessionId: rootSessionId(session),
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
