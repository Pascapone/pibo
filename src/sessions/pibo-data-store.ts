import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import type { OutputPartTransition, OutputToolInvocationTransition } from "../core/output-render-sequence.js";
import { ChatDataIngestService } from "../data/ingest-service.js";
import { PiboDataStore } from "../data/pibo-store.js";
import type { StoredTelemetryTurn, TelemetryInterruptedTurnOutcome } from "../data/telemetry.js";
import type { PiboRunSnapshot } from "../runs/registry.js";
import {
	PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES,
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
	readonly #concreteRuntimeBindingCasIdentity: boolean;
	private readonly dataStore: PiboDataStore;
	private readonly db: DatabaseSync;
	private readonly ownsDataStore: boolean;

	constructor(dataStore: PiboDataStore | string = new PiboDataStore()) {
		this.#concreteRuntimeBindingCasIdentity = new.target === PiboDataSessionStore;
		if (typeof dataStore === "string") {
			this.dataStore = new PiboDataStore(dataStore);
			this.ownsDataStore = true;
		} else {
			this.dataStore = dataStore;
			this.ownsDataStore = false;
		}
		this.db = this.dataStore.db;
	}

	/** @internal Read-only concrete-construction identity; it cannot mint authorization. */
	static hasConcreteRuntimeBindingCasIdentity(store: unknown): store is PiboDataSessionStore {
		return typeof store === "object"
			&& store !== null
			&& #concreteRuntimeBindingCasIdentity in store
			&& store.#concreteRuntimeBindingCasIdentity;
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

	claimOutputRenderSequence(piboSessionId: string, minimum: number): number {
		return this.dataStore.transaction(() => {
			const session = this.db.prepare("SELECT 1 AS present FROM sessions WHERE id = ? AND deleted_at IS NULL").get(piboSessionId) as { present: number } | undefined;
			if (!session) return minimum;
			const row = this.db.prepare("SELECT high_water FROM session_output_render_high_water WHERE pibo_session_id = ?").get(piboSessionId) as { high_water: number } | undefined;
			const current = Math.max(row?.high_water ?? 0, this.durableOutputRenderSequenceHighWater(piboSessionId));
			const next = Math.max(minimum, current + 1);
			this.db.prepare(`
				INSERT INTO session_output_render_high_water (pibo_session_id, high_water, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(pibo_session_id) DO UPDATE SET
					high_water = MAX(session_output_render_high_water.high_water, excluded.high_water),
					updated_at = CASE
						WHEN excluded.high_water > session_output_render_high_water.high_water THEN excluded.updated_at
						ELSE session_output_render_high_water.updated_at
					END
			`).run(piboSessionId, next, new Date().toISOString());
			return next;
		});
	}

	private durableOutputRenderSequenceHighWater(piboSessionId: string): number {
		const row = this.db.prepare(`
			SELECT MAX(MAX(
				COALESCE(CAST(json_extract(attributes_json, '$.renderSequence') AS INTEGER), 0),
				COALESCE(session_sequence, 0)
			)) AS high_water
			FROM event_log
			WHERE session_id = ?
		`).get(piboSessionId) as { high_water: number | null } | undefined;
		const value = row?.high_water;
		return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
	}

	observeOutputRenderSequence(piboSessionId: string, sequence: number): void {
		this.dataStore.transaction(() => {
			this.db.prepare(`
				INSERT INTO session_output_render_high_water (pibo_session_id, high_water, updated_at)
				SELECT id, ?, ? FROM sessions WHERE id = ? AND deleted_at IS NULL
				ON CONFLICT(pibo_session_id) DO UPDATE SET
					high_water = MAX(session_output_render_high_water.high_water, excluded.high_water),
					updated_at = CASE
						WHEN excluded.high_water > session_output_render_high_water.high_water THEN excluded.updated_at
						ELSE session_output_render_high_water.updated_at
					END
			`).run(sequence, new Date().toISOString(), piboSessionId);
		});
	}

	claimAgentObservationSequence(parentPiboSessionId: string, minimum: number): number {
		return this.dataStore.transaction(() => {
			const session = this.db.prepare("SELECT 1 AS present FROM sessions WHERE id = ? AND deleted_at IS NULL").get(parentPiboSessionId) as { present: number } | undefined;
			if (!session) return minimum;
			const row = this.db.prepare("SELECT next_sequence FROM session_agent_observation_counters WHERE parent_pibo_session_id = ?").get(parentPiboSessionId) as { next_sequence: number } | undefined;
			const migrationSafeSeed = Math.trunc(Date.now()) * 1_000;
			const sequence = Math.max(minimum, row?.next_sequence ?? migrationSafeSeed);
			this.db.prepare(`
				INSERT INTO session_agent_observation_counters (parent_pibo_session_id, next_sequence, updated_at)
				VALUES (?, ?, ?)
				ON CONFLICT(parent_pibo_session_id) DO UPDATE SET
					next_sequence = excluded.next_sequence,
					updated_at = excluded.updated_at
			`).run(parentPiboSessionId, sequence + 1, new Date().toISOString());
			return sequence;
		});
	}

	getAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string): number | undefined {
		const row = this.db.prepare(`
			SELECT sequence
			FROM session_agent_observation_auto_cursors
			WHERE parent_pibo_session_id = ? AND cursor_scope = ?
		`).get(parentPiboSessionId, cursorScope) as { sequence: number } | undefined;
		return row?.sequence;
	}

	advanceAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string, sequence: number): number {
		return this.dataStore.transaction(() => {
			this.db.prepare(`
				INSERT INTO session_agent_observation_auto_cursors (
					parent_pibo_session_id, cursor_scope, sequence, updated_at
				)
				SELECT id, ?, ?, ? FROM sessions WHERE id = ? AND deleted_at IS NULL
				ON CONFLICT(parent_pibo_session_id, cursor_scope) DO UPDATE SET
					sequence = MAX(session_agent_observation_auto_cursors.sequence, excluded.sequence),
					updated_at = CASE
						WHEN excluded.sequence > session_agent_observation_auto_cursors.sequence THEN excluded.updated_at
						ELSE session_agent_observation_auto_cursors.updated_at
					END
			`).run(cursorScope, sequence, new Date().toISOString(), parentPiboSessionId);
			this.db.prepare(`
				DELETE FROM session_agent_observation_auto_cursors
				WHERE parent_pibo_session_id = ?
					AND cursor_scope <> ?
					AND cursor_scope NOT IN (
						SELECT cursor_scope
						FROM session_agent_observation_auto_cursors
						WHERE parent_pibo_session_id = ? AND cursor_scope <> ?
						ORDER BY updated_at DESC, cursor_scope DESC
						LIMIT ?
					)
			`).run(
				parentPiboSessionId,
				cursorScope,
				parentPiboSessionId,
				cursorScope,
				PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES - 1,
			);
			return this.getAgentObservationAutoCursor(parentPiboSessionId, cursorScope) ?? sequence;
		});
	}

	claimOrAttachOutputPart(input: OutputPartTransition): number {
		return this.dataStore.transaction(() => {
			const indexAttribute = outputPartIndexAttribute(input.kind);
			const eventTypes = [...outputPartEventTypes(input.kind), "message_finished"];
			const placeholders = eventTypes.map(() => "?").join(", ");
			const rows = this.db.prepare(`
				SELECT type, attributes_json
				FROM event_log
				WHERE session_id = ? AND event_id = ? AND type IN (${placeholders})
				ORDER BY stream_id ASC
			`).all(input.piboSessionId, input.eventId, ...eventTypes) as Array<{ type: string; attributes_json: string }>;
			let maximum = -1;
			let turnCompleted = false;
			const persistedParts: Array<{ index: number; attributes: PiboJsonObject }> = [];
			for (const row of rows) {
				if (row.type === "message_finished") {
					turnCompleted = true;
					continue;
				}
				const attributes = parseJsonObject(row.attributes_json);
				const index = attributes[indexAttribute];
				if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) continue;
				maximum = Math.max(maximum, index);
				persistedParts.push({ index, attributes });
			}
			// An unfinished durable part may still belong to another process. Only a
			// completed turn provides enough evidence to reattach an exact replay.
			if (turnCompleted) {
				const matchesReplay = ({ attributes }: { attributes: PiboJsonObject }) =>
					attributes.outputPartFingerprint === input.fingerprint
					|| attributes.identityFingerprint === input.identityFingerprint;
				const replay = (input.suppliedIndex === undefined
					? undefined
					: persistedParts.find((part) => part.index === input.suppliedIndex && matchesReplay(part)))
					?? persistedParts.find(matchesReplay);
				if (replay) {
					this.observeOutputPartIndex(input, replay.index);
					return replay.index;
				}
			}
			const minimum = Math.max(input.proposedIndex, maximum + 1);
			const row = this.db.prepare(`
				INSERT INTO session_output_part_counters (
					pibo_session_id, event_id, part_kind, next_index, updated_at
				) VALUES (?, ?, ?, ? + 1, ?)
				ON CONFLICT(pibo_session_id, event_id, part_kind) DO UPDATE SET
					next_index = MAX(session_output_part_counters.next_index, ?) + 1,
					updated_at = excluded.updated_at
				RETURNING next_index - 1 AS part_index
			`).get(input.piboSessionId, input.eventId, input.kind, minimum, new Date().toISOString(), minimum) as { part_index: number };
			return row.part_index;
		});
	}

	observeOutputPart(input: OutputPartTransition & { index: number }): void {
		this.dataStore.transaction(() => {
			this.observeOutputPartIndex(input, input.index);
		});
	}

	private observeOutputPartIndex(input: OutputPartTransition, index: number): void {
		this.db.prepare(`
			INSERT INTO session_output_part_counters (
				pibo_session_id, event_id, part_kind, next_index, updated_at
			) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(pibo_session_id, event_id, part_kind) DO UPDATE SET
				next_index = MAX(session_output_part_counters.next_index, excluded.next_index),
				updated_at = CASE
					WHEN excluded.next_index > session_output_part_counters.next_index THEN excluded.updated_at
					ELSE session_output_part_counters.updated_at
				END
		`).run(input.piboSessionId, input.eventId, input.kind, index + 1, new Date().toISOString());
	}

	claimOutputToolInvocationOrdinal(piboSessionId: string, eventId: string, toolCallId: string): number {
		return this.dataStore.transaction(() => {
			const durable = this.db.prepare(`
				SELECT MAX(COALESCE(CAST(json_extract(attributes_json, '$.toolInvocationOrdinal') AS INTEGER), 0)) AS maximum
				FROM event_log
				WHERE session_id = ? AND event_id = ? AND tool_call_id = ?
			`).get(piboSessionId, eventId, toolCallId) as { maximum: number | null };
			const minimumNextOrdinal = typeof durable.maximum === "number" && Number.isSafeInteger(durable.maximum)
				? durable.maximum + 1
				: 0;
			const row = this.db.prepare(`
				INSERT INTO session_tool_invocation_counters (
					pibo_session_id, event_id, tool_call_id, next_ordinal, updated_at
				) VALUES (?, ?, ?, ? + 1, ?)
				ON CONFLICT(pibo_session_id, event_id, tool_call_id) DO UPDATE SET
					next_ordinal = MAX(session_tool_invocation_counters.next_ordinal, ? ) + 1,
					updated_at = excluded.updated_at
				RETURNING next_ordinal - 1 AS ordinal
			`).get(piboSessionId, eventId, toolCallId, minimumNextOrdinal, new Date().toISOString(), minimumNextOrdinal) as { ordinal: number };
			return row.ordinal;
		});
	}

	observeOutputToolInvocationOrdinal(piboSessionId: string, eventId: string, toolCallId: string, ordinal: number): void {
		this.dataStore.transaction(() => {
			this.db.prepare(`
				INSERT INTO session_tool_invocation_counters (
					pibo_session_id, event_id, tool_call_id, next_ordinal, updated_at
				) VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(pibo_session_id, event_id, tool_call_id) DO UPDATE SET
					next_ordinal = MAX(session_tool_invocation_counters.next_ordinal, excluded.next_ordinal),
					updated_at = CASE
						WHEN excluded.next_ordinal > session_tool_invocation_counters.next_ordinal THEN excluded.updated_at
						ELSE session_tool_invocation_counters.updated_at
					END
			`).run(piboSessionId, eventId, toolCallId, ordinal + 1, new Date().toISOString());
		});
	}

	claimOrAttachOutputToolInvocation(input: OutputToolInvocationTransition): number {
		return this.dataStore.transaction(() => {
			const rows = this.db.prepare(`
				SELECT invocation_ordinal, call_fingerprint, status, seen_call
				FROM session_tool_invocations
				WHERE pibo_session_id = ? AND event_id = ? AND tool_call_id = ?
				ORDER BY invocation_ordinal DESC
			`).all(input.piboSessionId, input.eventId, input.toolCallId) as Array<{
				invocation_ordinal: number;
				call_fingerprint: string | null;
				status: "open" | "closed";
				seen_call: number;
			}>;
			const latestOpen = rows.find((row) => row.status === "open");
			let ordinal: number;
			if (
				input.eventType === "tool_call"
				&& latestOpen
				&& (
					latestOpen.seen_call === 0
					|| latestOpen.call_fingerprint === null
					|| latestOpen.call_fingerprint === input.callFingerprint
				)
			) {
				ordinal = latestOpen.invocation_ordinal;
			} else if (input.eventType !== "tool_call" && latestOpen) {
				ordinal = latestOpen.invocation_ordinal;
			} else if (input.eventType !== "tool_call" && rows[0]) {
				// A lifecycle replay after completion belongs to the last proven
				// invocation. Only a new tool_call may cross a closed boundary.
				ordinal = rows[0].invocation_ordinal;
			} else {
				ordinal = this.claimOutputToolInvocationOrdinal(input.piboSessionId, input.eventId, input.toolCallId);
			}
			this.persistToolInvocationTransition(input, ordinal);
			return ordinal;
		});
	}

	observeOutputToolInvocation(input: OutputToolInvocationTransition & { ordinal: number }): void {
		this.dataStore.transaction(() => {
			this.observeOutputToolInvocationOrdinal(input.piboSessionId, input.eventId, input.toolCallId, input.ordinal);
			this.persistToolInvocationTransition(input, input.ordinal);
		});
	}

	private persistToolInvocationTransition(input: OutputToolInvocationTransition, ordinal: number): void {
		const timestamp = new Date().toISOString();
		const seenCall = input.eventType === "tool_call" ? 1 : 0;
		const seenStarted = input.eventType === "tool_execution_started" ? 1 : 0;
		const seenUpdated = input.eventType === "tool_execution_updated" ? 1 : 0;
		const seenFinished = input.eventType === "tool_execution_finished" ? 1 : 0;
		this.db.prepare(`
			INSERT INTO session_tool_invocations (
				pibo_session_id, event_id, tool_call_id, invocation_ordinal,
				call_fingerprint, status, seen_call, seen_started, seen_updated, seen_finished,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(pibo_session_id, event_id, tool_call_id, invocation_ordinal) DO UPDATE SET
				call_fingerprint = COALESCE(session_tool_invocations.call_fingerprint, excluded.call_fingerprint),
				status = CASE
					WHEN session_tool_invocations.status = 'closed' OR excluded.status = 'closed' THEN 'closed'
					ELSE 'open'
				END,
				seen_call = MAX(session_tool_invocations.seen_call, excluded.seen_call),
				seen_started = MAX(session_tool_invocations.seen_started, excluded.seen_started),
				seen_updated = MAX(session_tool_invocations.seen_updated, excluded.seen_updated),
				seen_finished = MAX(session_tool_invocations.seen_finished, excluded.seen_finished),
				updated_at = excluded.updated_at
		`).run(
			input.piboSessionId,
			input.eventId,
			input.toolCallId,
			ordinal,
			input.callFingerprint ?? null,
			seenFinished ? "closed" : "open",
			seenCall,
			seenStarted,
			seenUpdated,
			seenFinished,
			timestamp,
			timestamp,
		);
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

	getDataStore(): PiboDataStore {
		return this.dataStore;
	}

	getTelemetryStore() {
		return this.dataStore.telemetry;
	}

	getPayloadStore() {
		return this.dataStore.payloads;
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

const auditedPiboDataGet = PiboDataSessionStore.prototype.get;
const auditedPiboDataGetRuntimeBinding = PiboDataSessionStore.prototype.getRuntimeBinding;
const auditedPiboDataRuntimeBindingCas = PiboDataSessionStore.prototype.updateRuntimeBinding;
const hasConcretePiboDataRuntimeBindingCasIdentity = PiboDataSessionStore.hasConcreteRuntimeBindingCasIdentity;

/** @internal Resolves only the original CAS of an exact, genuinely constructed built-in store. */
export function resolvePiboDataRuntimeBindingCas(
	store: unknown,
): typeof auditedPiboDataRuntimeBindingCas | undefined {
	if (
		!hasConcretePiboDataRuntimeBindingCasIdentity(store)
		|| Object.getPrototypeOf(store) !== PiboDataSessionStore.prototype
		|| Object.prototype.hasOwnProperty.call(store, "get")
		|| Object.prototype.hasOwnProperty.call(store, "getRuntimeBinding")
		|| Object.prototype.hasOwnProperty.call(store, "updateRuntimeBinding")
		|| PiboDataSessionStore.prototype.get !== auditedPiboDataGet
		|| PiboDataSessionStore.prototype.getRuntimeBinding !== auditedPiboDataGetRuntimeBinding
		|| PiboDataSessionStore.prototype.updateRuntimeBinding !== auditedPiboDataRuntimeBindingCas
	) return undefined;
	const auditedStore = new Proxy(store, {
		get(target, property) {
			if (property === "get") return auditedPiboDataGet;
			if (property === "getRuntimeBinding") return auditedPiboDataGetRuntimeBinding;
			if (property === "updateRuntimeBinding") return auditedPiboDataRuntimeBindingCas;
			return Reflect.get(target, property, target);
		},
	});
	return auditedPiboDataRuntimeBindingCas.bind(auditedStore);
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

function outputPartIndexAttribute(kind: OutputPartTransition["kind"]): string {
	switch (kind) {
		case "assistant": return "assistantIndex";
		case "thinking": return "thinkingIndex";
		case "usage": return "usageIndex";
		case "compaction": return "compactionIndex";
	}
}

function outputPartEventTypes(kind: OutputPartTransition["kind"]): string[] {
	switch (kind) {
		case "assistant": return ["assistant_delta", "assistant_message"];
		case "thinking": return ["thinking_started", "thinking_delta", "thinking_finished"];
		case "usage": return ["assistant_usage"];
		case "compaction": return ["compaction_start", "compaction_end"];
	}
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
