import { randomUUID } from "node:crypto";
import type { PiboOutputEvent } from "../../../core/events.js";
import type { ChatEventAppendInput, StoredChatEvent } from "../types/event-store.js";
import { isLiveOnlyOutputEvent } from "../output-event-policy.js";
import type { StoredPiboEventLogRow } from "../../../data/event-log.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import { compactObject, nextSessionSequence, previewForPayload, storedChatEventFromV2Row, type EventLogRow } from "./chat-data-mappers.js";

export function chatClientTransactionKey(roomId: string | undefined, actorId: string | undefined, clientTxnId: string): string {
	return `chat:user.accepted:${roomId ?? ""}:${actorId ?? ""}:${clientTxnId}`;
}

export class ChatEventCommandService {
	constructor(private readonly store: PiboDataStore) {}

	appendEvent(input: ChatEventAppendInput): StoredChatEvent {
		const createdAt = input.createdAt ?? new Date().toISOString();
		const eventId = input.eventId ?? `ce_${randomUUID()}`;
		const idempotencyKey = input.clientTxnId ? chatClientTransactionKey(input.roomId, input.actorId, input.clientTxnId) : `chat:event:${eventId}`;
		const stored = this.store.eventLog.appendEvent({
			sessionId: input.piboSessionId,
			sessionSequence: input.piboSessionId ? nextSessionSequence(this.store, input.piboSessionId) : undefined,
			roomId: input.roomId,
			topic: "chat",
			type: input.eventType,
			source: input.actorType ?? "chat-web",
			actorType: input.actorType,
			actorId: input.actorId,
			eventId,
			idempotencyKey,
			retentionClass: input.retentionClass,
			previewText: previewForPayload(input.payload),
			attributes: compactObject({ clientTxnId: input.clientTxnId, inlinePayload: input.payload }),
			createdAt,
			indexedAt: createdAt,
		});
		return chatEventFromStoredRow(stored);
	}

	appendOutputEvent(event: PiboOutputEvent, _input: { roomId?: string; actorId?: string } = {}): StoredChatEvent | undefined {
		// Runtime output ingestion is owned by ChatDataIngestService. Avoid a second event_log insert here.
		if (isLiveOnlyOutputEvent(event)) return undefined;
		return undefined;
	}

	findByClientTxn(roomId: string | undefined, actorId: string | undefined, clientTxnId: string): StoredChatEvent | undefined {
		if (!roomId || !actorId) return undefined;
		// Empty IDs are not valid HTTP transaction keys. Retain the legacy direct-call
		// lookup contract without adding a scan fallback to ordinary indexed misses.
		if (clientTxnId === "") {
			const row = this.store.db.prepare("SELECT * FROM event_log WHERE room_id = ? AND actor_id = ? AND json_extract(attributes_json, '$.clientTxnId') = ? ORDER BY stream_id ASC LIMIT 1").get(roomId, actorId, clientTxnId) as EventLogRow | undefined;
			return row ? storedChatEventFromV2Row(row) : undefined;
		}
		const row = this.store.eventLog.findByIdempotencyKey(chatClientTransactionKey(roomId, actorId, clientTxnId));
		return row ? chatEventFromStoredRow(row) : undefined;
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		const result = this.store.db.prepare(`DELETE FROM event_log WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		return Number(result.changes ?? 0);
	}

	deleteRooms(roomIds: string[]): number {
		if (!roomIds.length) return 0;
		const placeholders = roomIds.map(() => "?").join(", ");
		const result = this.store.db.prepare(`DELETE FROM event_log WHERE room_id IN (${placeholders})`).run(...roomIds);
		return Number(result.changes ?? 0);
	}
}

function chatEventFromStoredRow(stored: StoredPiboEventLogRow): StoredChatEvent {
	return storedChatEventFromV2Row({
		stream_id: stored.streamId,
		session_id: stored.sessionId ?? null,
		session_sequence: stored.sessionSequence ?? null,
		room_id: stored.roomId ?? null,
		type: stored.type,
		actor_type: stored.actorType ?? null,
		actor_id: stored.actorId ?? null,
		event_id: stored.eventId ?? null,
		idempotency_key: stored.idempotencyKey ?? null,
		retention_class: stored.retentionClass,
		preview_text: stored.previewText ?? null,
		attributes_json: JSON.stringify(stored.attributes),
		created_at: stored.createdAt,
	});
}
