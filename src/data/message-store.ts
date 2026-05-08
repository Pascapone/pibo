import type { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../core/events.js";

export type ChatMessageInsertInput = {
	id: string;
	sessionId: string;
	roomId?: string;
	sequence: number;
	turnId?: string;
	role: string;
	actorId?: string;
	status: string;
	createdAt: string;
	completedAt?: string;
	contentPreview?: string;
	contentPayloadRef?: string;
	sourceStreamId?: number;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	attributes?: PiboJsonObject;
};

export type StoredChatMessage = ChatMessageInsertInput & { attributes: PiboJsonObject };

type ChatMessageRow = {
	id: string;
	session_id: string;
	room_id: string | null;
	sequence: number;
	turn_id: string | null;
	role: string;
	actor_id: string | null;
	status: string;
	created_at: string;
	completed_at: string | null;
	content_preview: string | null;
	content_payload_ref: string | null;
	source_stream_id: number | null;
	input_tokens: number | null;
	output_tokens: number | null;
	cost_usd: number | null;
	attributes_json: string;
};

export class MessageStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	insertMessage(input: ChatMessageInsertInput): StoredChatMessage {
		this.db.prepare(`
			INSERT INTO chat_messages (
				id,
				session_id,
				room_id,
				sequence,
				turn_id,
				role,
				actor_id,
				status,
				created_at,
				completed_at,
				content_preview,
				content_payload_ref,
				source_stream_id,
				input_tokens,
				output_tokens,
				cost_usd,
				attributes_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			input.id,
			input.sessionId,
			input.roomId ?? null,
			input.sequence,
			input.turnId ?? null,
			input.role,
			input.actorId ?? null,
			input.status,
			input.createdAt,
			input.completedAt ?? null,
			input.contentPreview ?? null,
			input.contentPayloadRef ?? null,
			input.sourceStreamId ?? null,
			input.inputTokens ?? null,
			input.outputTokens ?? null,
			input.costUsd ?? null,
			JSON.stringify(input.attributes ?? {}),
		);
		const stored = this.getMessage(input.id);
		if (!stored) throw new Error(`Failed to insert chat message \"${input.id}\"`);
		return stored;
	}

	getMessage(id: string): StoredChatMessage | undefined {
		const row = this.db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as ChatMessageRow | undefined;
		return row ? messageFromRow(row) : undefined;
	}

	listMessages(sessionId: string): StoredChatMessage[] {
		const rows = this.db.prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sequence ASC").all(sessionId) as ChatMessageRow[];
		return rows.map(messageFromRow);
	}
}

function messageFromRow(row: ChatMessageRow): StoredChatMessage {
	return {
		id: row.id,
		sessionId: row.session_id,
		roomId: row.room_id ?? undefined,
		sequence: row.sequence,
		turnId: row.turn_id ?? undefined,
		role: row.role,
		actorId: row.actor_id ?? undefined,
		status: row.status,
		createdAt: row.created_at,
		completedAt: row.completed_at ?? undefined,
		contentPreview: row.content_preview ?? undefined,
		contentPayloadRef: row.content_payload_ref ?? undefined,
		sourceStreamId: row.source_stream_id ?? undefined,
		inputTokens: row.input_tokens ?? undefined,
		outputTokens: row.output_tokens ?? undefined,
		costUsd: row.cost_usd ?? undefined,
		attributes: JSON.parse(row.attributes_json) as PiboJsonObject,
	};
}
