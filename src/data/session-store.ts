import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";

export type SessionUpsertInput = {
	session: PiboSession;
	roomId: string;
	status?: string;
	firstMessagePreview?: string;
	lastActivityAt?: string;
};

export class SessionStore {
	constructor(private readonly db: DatabaseSync) {}

	upsertSession(input: SessionUpsertInput): void {
		const now = input.lastActivityAt ?? new Date().toISOString();
		const title = input.session.title || previewText(input.firstMessagePreview ?? "") || "Untitled Session";
		const baseColumns = [
			"id", "pi_session_id", "room_id", "root_session_id", "parent_id", "origin_id", "channel", "kind", "profile", "active_model_json", "workspace", "title", "first_message_preview", "status", "metadata_json", "created_at", "updated_at", "last_activity_at",
		];
		const values = [
			input.session.id,
			input.session.piSessionId,
			input.roomId,
			rootSessionId(input.session),
			input.session.parentId ?? null,
			input.session.originId ?? null,
			input.session.channel,
			input.session.kind,
			input.session.profile,
			input.session.activeModel ? JSON.stringify(input.session.activeModel) : null,
			input.session.workspace ?? null,
			title,
			previewText(input.firstMessagePreview ?? "") ?? null,
			input.status ?? "running",
			JSON.stringify((input.session.metadata ?? {}) as PiboJsonObject),
			input.session.createdAt,
			now,
			now,
		];
		const assignments = [
			"pi_session_id = excluded.pi_session_id",
			"room_id = excluded.room_id",
			"root_session_id = excluded.root_session_id",
			"parent_id = excluded.parent_id",
			"origin_id = excluded.origin_id",
			"channel = excluded.channel",
			"kind = excluded.kind",
			"profile = excluded.profile",
			"active_model_json = excluded.active_model_json",
			"workspace = excluded.workspace",
			"title = excluded.title",
			"first_message_preview = COALESCE(sessions.first_message_preview, excluded.first_message_preview)",
			"status = excluded.status",
			"metadata_json = excluded.metadata_json",
			"updated_at = excluded.updated_at",
			"last_activity_at = excluded.last_activity_at",
		];
		this.db.prepare(`
			INSERT INTO sessions (${baseColumns.join(", ")})
			VALUES (${baseColumns.map(() => "?").join(", ")})
			ON CONFLICT(id) DO UPDATE SET ${assignments.join(", ")}
		`).run(...values);
	}
}

export function rootSessionId(session: PiboSession): string {
	return session.parentId ? (typeof session.metadata?.rootSessionId === "string" ? session.metadata.rootSessionId : session.parentId) : session.id;
}

function previewText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 512) : undefined;
}
