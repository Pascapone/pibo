import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";
import { PiboDataStore } from "../data/pibo-store.js";
import {
	createPiboSession,
	matchesFindInput,
	type CreatePiboSessionInput,
	type FindPiboSessionsInput,
	type PiboSession,
	type PiboSessionStore,
	type UpdatePiboSessionInput,
} from "./store.js";

type SessionRow = {
	id: string;
	pi_session_id: string | null;
	owner_scope: string;
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
	metadata_json: string;
	created_at: string;
	updated_at: string;
};

export class PiboDataSessionStore implements PiboSessionStore {
	private readonly dataStore: PiboDataStore;
	private readonly db: DatabaseSync;
	private readonly ownsDataStore: boolean;

	constructor(dataStore: PiboDataStore | string = new PiboDataStore()) {
		if (typeof dataStore === "string") {
			this.dataStore = new PiboDataStore(dataStore);
			this.ownsDataStore = true;
		} else {
			this.dataStore = dataStore;
			this.ownsDataStore = false;
		}
		this.db = this.dataStore.db;
	}

	get(id: string): PiboSession | undefined {
		const row = this.db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(id) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	list(): PiboSession[] {
		return (this.db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as SessionRow[]).map(sessionFromRow);
	}

	create(input: CreatePiboSessionInput): PiboSession {
		const session = createPiboSession(input);
		this.insertSession(session);
		const created = this.get(session.id);
		if (!created) throw new Error(`Failed to create Pibo session "${session.id}"`);
		return created;
	}

	update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined {
		const existing = this.get(id);
		if (!existing) return undefined;
		if (input.piSessionId && input.piSessionId !== existing.piSessionId) {
			const attached = this.db
				.prepare("SELECT id FROM sessions WHERE pi_session_id = ? AND id <> ? AND deleted_at IS NULL")
				.get(input.piSessionId, id) as { id: string } | undefined;
			if (attached) throw new Error(`Pi session "${input.piSessionId}" is already attached to Pibo session "${attached.id}"`);
		}
		const updated: PiboSession = {
			...existing,
			piSessionId: input.piSessionId ?? existing.piSessionId,
			profile: input.profile ?? existing.profile,
			ownerScope: input.ownerScope ?? existing.ownerScope,
			parentId: input.parentId === null ? undefined : input.parentId ?? existing.parentId,
			originId: input.originId === null ? undefined : input.originId ?? existing.originId,
			workspace: input.workspace === null ? undefined : input.workspace ?? existing.workspace,
			title: input.title === null ? undefined : input.title ?? existing.title,
			metadata: input.metadata ?? existing.metadata,
			activeModel: input.activeModel === null ? undefined : input.activeModel ? { ...input.activeModel } : existing.activeModel,
			updatedAt: new Date().toISOString(),
		};
		this.db.prepare(`
			UPDATE sessions SET
				pi_session_id = ?,
				owner_scope = ?,
				root_session_id = ?,
				parent_id = ?,
				origin_id = ?,
				profile = ?,
				active_model_json = ?,
				workspace = ?,
				title = ?,
				metadata_json = ?,
				updated_at = ?,
				last_activity_at = MAX(last_activity_at, ?)
			WHERE id = ? AND deleted_at IS NULL
		`).run(
			updated.piSessionId,
			updated.ownerScope ?? "user:unknown",
			rootSessionId(updated),
			updated.parentId ?? null,
			updated.originId ?? null,
			updated.profile,
			updated.activeModel ? JSON.stringify(updated.activeModel) : null,
			updated.workspace ?? null,
			updated.title ?? "Untitled Session",
			JSON.stringify(updated.metadata ?? {}),
			updated.updatedAt,
			updated.updatedAt,
			id,
		);
		return this.get(id);
	}

	delete(id: string): boolean {
		const result = this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
		return Number(result.changes ?? 0) > 0;
	}

	find(input: FindPiboSessionsInput): PiboSession[] {
		const clauses = ["deleted_at IS NULL"];
		const values: Array<string | null> = [];
		if (input.ids !== undefined) {
			if (input.ids.length === 0) return [];
			clauses.push(`id IN (${input.ids.map(() => "?").join(", ")})`);
			values.push(...input.ids);
		}
		if (input.channel !== undefined) { clauses.push("channel = ?"); values.push(input.channel); }
		if (input.kind !== undefined) { clauses.push("kind = ?"); values.push(input.kind); }
		if (input.ownerScope !== undefined) { clauses.push("owner_scope = ?"); values.push(input.ownerScope); }
		if (input.parentId !== undefined) {
			if (input.parentId === null) clauses.push("parent_id IS NULL");
			else { clauses.push("parent_id = ?"); values.push(input.parentId); }
		}
		if (input.originId !== undefined) { clauses.push("origin_id = ?"); values.push(input.originId); }
		if (input.profile !== undefined) { clauses.push("profile = ?"); values.push(input.profile); }
		if (input.activeModel !== undefined) {
			if (input.activeModel === null) clauses.push("active_model_json IS NULL");
			else clauses.push("active_model_json IS NOT NULL");
		}
		const rows = this.db.prepare(`SELECT * FROM sessions WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`).all(...values) as SessionRow[];
		return rows.map(sessionFromRow).filter((session) => matchesFindInput(session, input));
	}

	getTelemetryStore() {
		return this.dataStore.telemetry;
	}

	close(): void {
		if (this.ownsDataStore) this.dataStore.close();
	}

	private insertSession(session: PiboSession): void {
		this.db.prepare(`
			INSERT INTO sessions (
				id, pi_session_id, owner_scope, room_id, root_session_id, parent_id, origin_id,
				channel, kind, profile, active_model_json, workspace, title, first_message_preview,
				status, metadata_json, created_at, updated_at, last_activity_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			session.id,
			session.piSessionId,
			session.ownerScope ?? "user:unknown",
			roomIdFromMetadata(session.metadata),
			rootSessionId(session),
			session.parentId ?? null,
			session.originId ?? null,
			session.channel,
			session.kind,
			session.profile,
			session.activeModel ? JSON.stringify(session.activeModel) : null,
			session.workspace ?? null,
			session.title ?? "Untitled Session",
			previewText(session.title ?? "") ?? null,
			"idle",
			JSON.stringify(session.metadata ?? {}),
			session.createdAt,
			session.updatedAt,
			session.updatedAt,
		);
	}
}

export function createDefaultPiboDataSessionStore(): PiboDataSessionStore {
	return new PiboDataSessionStore(new PiboDataStore());
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id ?? "",
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		ownerScope: row.owner_scope ?? undefined,
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		workspace: row.workspace ?? undefined,
		title: row.title ?? undefined,
		metadata: parseJsonObject(row.metadata_json),
		activeModel: row.active_model_json ? JSON.parse(row.active_model_json) : undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseJsonObject(json: string | null | undefined): PiboJsonObject {
	if (!json) return {};
	try {
		const value = JSON.parse(json);
		return value && typeof value === "object" && !Array.isArray(value) ? value as PiboJsonObject : {};
	} catch {
		return {};
	}
}

function rootSessionId(session: PiboSession): string {
	return session.parentId ? (typeof session.metadata?.rootSessionId === "string" ? session.metadata.rootSessionId : session.parentId) : session.id;
}

function roomIdFromMetadata(metadata: PiboJsonObject | undefined): string | null {
	const value = metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : null;
}

function previewText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 512) : undefined;
}
