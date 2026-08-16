import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import { ChatDataIngestService } from "../data/ingest-service.js";
import { PiboDataStore } from "../data/pibo-store.js";
import type { StoredTelemetryTurn, TelemetryInterruptedTurnOutcome } from "../data/telemetry.js";
import type { PiboRunSnapshot } from "../runs/registry.js";
import {
	createPiboSession,
	matchesFindInput,
	type CreatePiboSessionInput,
	type FindPiboSessionsInput,
	type PiboSession,
	type PiboSessionStore,
	type UpdatePiboSessionInput,
} from "./store.js";
import {
	createLegacyPiRuntimeSessionBinding,
	nextRuntimeSessionBinding,
	RuntimeSessionBindingConflictError,
	type RuntimeSessionBinding,
	type RuntimeSessionBindingUpdateOptions,
} from "./runtime-binding.js";

export type PiboRuntimeRecoveryResult = {
	turnId: string;
	piboSessionId: string;
	event: Extract<PiboOutputEvent, { type: "session_error" }>;
	outcome: TelemetryInterruptedTurnOutcome;
};

type SessionRow = {
	id: string;
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
	metadata_json: string;
	created_at: string;
	updated_at: string;
	binding_pibo_session_id: string | null;
	binding_runtime_instance_id: string | null;
	binding_runtime_adapter_id: string | null;
	binding_native_session_id: string | null;
	binding_state: string | null;
	binding_protocol: string | null;
	binding_protocol_version: string | null;
	binding_adapter_version: string | null;
	binding_locator_json: string | null;
	binding_metadata_json: string | null;
	binding_revision: number | null;
	binding_created_at: string | null;
	binding_updated_at: string | null;
};

const SESSION_SELECT = `
	SELECT
		s.*,
		b.pibo_session_id AS binding_pibo_session_id,
		b.runtime_instance_id AS binding_runtime_instance_id,
		b.runtime_adapter_id AS binding_runtime_adapter_id,
		b.native_session_id AS binding_native_session_id,
		b.binding_state AS binding_state,
		b.protocol AS binding_protocol,
		b.protocol_version AS binding_protocol_version,
		b.adapter_version AS binding_adapter_version,
		b.locator_json AS binding_locator_json,
		b.metadata_json AS binding_metadata_json,
		b.revision AS binding_revision,
		b.created_at AS binding_created_at,
		b.updated_at AS binding_updated_at
	FROM sessions s
	LEFT JOIN session_runtime_bindings b ON b.pibo_session_id = s.id
`;

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
		const row = this.db.prepare(`${SESSION_SELECT} WHERE s.id = ? AND s.deleted_at IS NULL`).get(id) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	list(): PiboSession[] {
		return (this.db.prepare(`${SESSION_SELECT} WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC`).all() as SessionRow[]).map(sessionFromRow);
	}

	create(input: CreatePiboSessionInput): PiboSession {
		const session = createPiboSession(input);
		this.dataStore.transaction(() => this.insertSession(session));
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
			updated.piSessionId || null,
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
		const clauses = ["s.deleted_at IS NULL"];
		const values: Array<string | null> = [];
		if (input.ids !== undefined) {
			if (input.ids.length === 0) return [];
			clauses.push(`s.id IN (${input.ids.map(() => "?").join(", ")})`);
			values.push(...input.ids);
		}
		if (input.channel !== undefined) { clauses.push("s.channel = ?"); values.push(input.channel); }
		if (input.kind !== undefined) { clauses.push("s.kind = ?"); values.push(input.kind); }
		if (input.parentId !== undefined) {
			if (input.parentId === null) clauses.push("s.parent_id IS NULL");
			else { clauses.push("s.parent_id = ?"); values.push(input.parentId); }
		}
		if (input.originId !== undefined) { clauses.push("s.origin_id = ?"); values.push(input.originId); }
		if (input.profile !== undefined) { clauses.push("s.profile = ?"); values.push(input.profile); }
		if (input.activeModel !== undefined) {
			if (input.activeModel === null) clauses.push("s.active_model_json IS NULL");
			else clauses.push("s.active_model_json IS NOT NULL");
		}
		const rows = this.db.prepare(`${SESSION_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY s.updated_at DESC`).all(...values) as SessionRow[];
		return rows.map(sessionFromRow).filter((session) => matchesFindInput(session, input));
	}

	getRuntimeBinding(id: string): RuntimeSessionBinding | undefined {
		const session = this.get(id);
		return session?.runtimeBinding ? structuredClone(session.runtimeBinding) : undefined;
	}

	updateRuntimeBinding(
		id: string,
		binding: RuntimeSessionBinding,
		options: RuntimeSessionBindingUpdateOptions = {},
	): RuntimeSessionBinding | undefined {
		return this.dataStore.transaction(() => {
			const current = this.getRuntimeBinding(id);
			if (!current) return undefined;
			const currentRevision = current.revision ?? 1;
			const updated = nextRuntimeSessionBinding(current, { ...structuredClone(binding), piboSessionId: id }, options);
			const result = this.db.prepare(`
				UPDATE session_runtime_bindings SET
					runtime_instance_id = ?,
					runtime_adapter_id = ?,
					native_session_id = ?,
					binding_state = ?,
					protocol = ?,
					protocol_version = ?,
					adapter_version = ?,
					locator_json = ?,
					metadata_json = ?,
					revision = ?,
					updated_at = ?
				WHERE pibo_session_id = ? AND revision = ?
			`).run(
				updated.runtimeInstanceId,
				updated.adapterId,
				updated.nativeSessionId ?? null,
				updated.state,
				updated.protocol ?? null,
				updated.protocolVersion ?? null,
				updated.adapterVersion ?? null,
				updated.locator ? JSON.stringify(updated.locator) : null,
				JSON.stringify(updated.metadata ?? {}),
				updated.revision,
				updated.updatedAt,
				id,
				currentRevision,
			);
			if (Number(result.changes ?? 0) === 0) {
				const actual = this.getRuntimeBinding(id);
				throw new RuntimeSessionBindingConflictError(id, currentRevision, actual?.revision ?? 0);
			}
			this.db.prepare(`
				UPDATE sessions SET pi_session_id = ?, updated_at = ?, last_activity_at = MAX(last_activity_at, ?)
				WHERE id = ? AND deleted_at IS NULL
			`).run(
				updated.adapterId === "pi" ? updated.nativeSessionId ?? null : null,
				updated.updatedAt,
				updated.updatedAt,
				id,
			);
			return this.getRuntimeBinding(id);
		});
	}

	getTelemetryStore() {
		return this.dataStore.telemetry;
	}

	recoverInterruptedRuntimeState(input: {
		recoveredRuns?: readonly PiboRunSnapshot[];
		at?: string;
	} = {}): PiboRuntimeRecoveryResult[] {
		const at = input.at ?? new Date().toISOString();
		const runsBySession = groupRunsByController(input.recoveredRuns ?? []);
		return this.dataStore.transaction(() => {
			const recoveredTurns = this.dataStore.telemetry.recoverInterruptedTurns({
				at,
				resolveOutcome: (turn) => recoveryOutcomeForTurn(turn, runsBySession.get(turn.piboSessionId) ?? []),
			});
			if (recoveredTurns.length === 0) return [];
			const ingest = new ChatDataIngestService(this.dataStore);
			const results: PiboRuntimeRecoveryResult[] = [];
			for (const recovered of recoveredTurns) {
				const session = this.get(recovered.turn.piboSessionId);
				if (!session) continue;
				const row = this.db.prepare("SELECT room_id FROM sessions WHERE id = ?").get(session.id) as { room_id: string | null } | undefined;
				const event: Extract<PiboOutputEvent, { type: "session_error" }> = {
					type: "session_error",
					piboSessionId: session.id,
					eventId: recoveryEventId(recovered.turn),
					error: recovered.outcome.summary,
					errorDetails: {
						category: "runtime_restart",
						errorClass: recovered.outcome.status === "aborted" ? "runtime_abort" : "runtime_error",
						code: recovered.outcome.status === "timeout" ? "timeout" : "runtime_interrupted",
						origin: "runtime",
						severity: "error",
						retryable: false,
						userMessage: "The previous gateway runtime ended before this turn completed.",
					},
				};
				this.db.prepare(`
					UPDATE sessions SET
						status = 'error',
						updated_at = ?,
						last_activity_at = MAX(last_activity_at, ?)
					WHERE id = ? AND deleted_at IS NULL
				`).run(at, at, session.id);
				this.db.prepare(`
					UPDATE session_navigation SET
						status = 'error',
						last_activity_at = MAX(last_activity_at, ?),
						sort_key = MAX(sort_key, ?),
						updated_at = ?
					WHERE session_id = ?
				`).run(at, at, at, session.id);
				ingest.ingestOutputEvent({
					session,
					roomId: row?.room_id ?? undefined,
					actorId: session.id,
					event,
					createdAt: at,
				});
				results.push({
					turnId: recovered.turn.turnId,
					piboSessionId: session.id,
					event,
					outcome: recovered.outcome,
				});
			}
			return results;
		});
	}

	close(): void {
		if (this.ownsDataStore) this.dataStore.close();
	}

	private insertSession(session: PiboSession): void {
		const columns = [
			"id", "pi_session_id", "room_id", "root_session_id", "parent_id", "origin_id",
			"channel", "kind", "profile", "active_model_json", "workspace", "title", "first_message_preview",
			"status", "metadata_json", "created_at", "updated_at", "last_activity_at",
		];
		this.db.prepare(`
			INSERT INTO sessions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
		`).run(
			session.id,
			session.piSessionId || null,
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
		this.upsertRuntimeBinding(
			session.runtimeBinding ?? createLegacyPiRuntimeSessionBinding(session.id, session.piSessionId, session.createdAt),
		);
	}

	private upsertRuntimeBinding(binding: RuntimeSessionBinding): void {
		this.db.prepare(`
			INSERT INTO session_runtime_bindings (
				pibo_session_id, runtime_instance_id, runtime_adapter_id, native_session_id,
				binding_state, protocol, protocol_version, adapter_version, locator_json,
				metadata_json, revision, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(pibo_session_id) DO UPDATE SET
				runtime_instance_id = excluded.runtime_instance_id,
				runtime_adapter_id = excluded.runtime_adapter_id,
				native_session_id = excluded.native_session_id,
				binding_state = excluded.binding_state,
				protocol = excluded.protocol,
				protocol_version = excluded.protocol_version,
				adapter_version = excluded.adapter_version,
				locator_json = excluded.locator_json,
				metadata_json = excluded.metadata_json,
				revision = excluded.revision,
				created_at = excluded.created_at,
				updated_at = excluded.updated_at
		`).run(
			binding.piboSessionId,
			binding.runtimeInstanceId,
			binding.adapterId,
			binding.nativeSessionId ?? null,
			binding.state,
			binding.protocol ?? null,
			binding.protocolVersion ?? null,
			binding.adapterVersion ?? null,
			binding.locator ? JSON.stringify(binding.locator) : null,
			JSON.stringify(binding.metadata ?? {}),
			binding.revision ?? 1,
			binding.createdAt ?? new Date().toISOString(),
			binding.updatedAt ?? binding.createdAt ?? new Date().toISOString(),
		);
	}
}

export function createDefaultPiboDataSessionStore(): PiboDataSessionStore {
	return new PiboDataSessionStore(new PiboDataStore());
}

function groupRunsByController(runs: readonly PiboRunSnapshot[]): Map<string, PiboRunSnapshot[]> {
	const grouped = new Map<string, PiboRunSnapshot[]>();
	for (const run of runs) {
		const items = grouped.get(run.controllerPiboSessionId) ?? [];
		items.push(run);
		grouped.set(run.controllerPiboSessionId, items);
	}
	return grouped;
}

function recoveryOutcomeForTurn(turn: StoredTelemetryTurn, runs: readonly PiboRunSnapshot[]): TelemetryInterruptedTurnOutcome {
	if (turn.status === "queued") {
		return {
			status: "aborted",
			summary: "Queued turn was interrupted by gateway restart before it could start.",
		};
	}
	const timedOut = runs.find((run) => run.status === "timed_out");
	if (timedOut) {
		return {
			status: "timeout",
			summary: `Gateway restart recovery timed out yielded run ${timedOut.runId} before this turn completed.`,
		};
	}
	const failed = runs.find((run) => run.status === "failed");
	if (failed) {
		return {
			status: "error",
			summary: `Gateway restart recovery failed yielded run ${failed.runId} before this turn completed.`,
		};
	}
	const queued = runs.find((run) => run.status === "queued");
	if (queued) {
		return {
			status: "aborted",
			summary: `Gateway restart interrupted this turn; yielded run ${queued.runId} was queued for retry.`,
		};
	}
	return {
		status: "aborted",
		summary: "Turn was interrupted by gateway restart.",
	};
}

function recoveryEventId(turn: StoredTelemetryTurn): string {
	if (turn.eventId) return turn.eventId;
	if (turn.inputEventId) return turn.inputEventId;
	return turn.turnId.startsWith("turn_") ? turn.turnId.slice("turn_".length) : turn.turnId;
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id ?? "",
		runtimeBinding: runtimeBindingFromRow(row),
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
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

function runtimeBindingFromRow(row: SessionRow): RuntimeSessionBinding {
	if (!row.binding_runtime_instance_id || !row.binding_runtime_adapter_id || !row.binding_state) {
		return createLegacyPiRuntimeSessionBinding(row.id, row.pi_session_id ?? undefined, row.created_at);
	}
	return {
		piboSessionId: row.binding_pibo_session_id ?? row.id,
		runtimeInstanceId: row.binding_runtime_instance_id,
		adapterId: row.binding_runtime_adapter_id,
		nativeSessionId: row.binding_native_session_id ?? undefined,
		state: isRuntimeBindingState(row.binding_state) ? row.binding_state : "error",
		protocol: row.binding_protocol ?? undefined,
		protocolVersion: row.binding_protocol_version ?? undefined,
		adapterVersion: row.binding_adapter_version ?? undefined,
		locator: row.binding_locator_json
			? parseJsonObject(row.binding_locator_json) as RuntimeSessionBinding["locator"]
			: undefined,
		metadata: parseJsonObject(row.binding_metadata_json),
		revision: row.binding_revision ?? 1,
		createdAt: row.binding_created_at ?? row.created_at,
		updatedAt: row.binding_updated_at ?? row.updated_at,
	};
}

function isRuntimeBindingState(value: string): value is RuntimeSessionBinding["state"] {
	return value === "unbound" || value === "bound" || value === "missing" || value === "error";
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
