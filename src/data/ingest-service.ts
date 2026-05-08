import { createHash, randomUUID } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";
import type { PiboDataStore } from "./pibo-store.js";
import { rootSessionId } from "./session-store.js";

export type UserMessageAcceptedIngestInput = {
	session: PiboSession;
	roomId: string;
	actorId: string;
	text: string;
	clientTxnId?: string;
	legacyEvent?: {
		streamId?: number;
		eventId?: string;
		createdAt?: string;
	};
};

export type UserMessageAcceptedIngestResult = {
	streamId: number;
	messageId: string;
	duplicate: boolean;
};

export type OutputEventIngestInput = {
	session: PiboSession;
	roomId?: string;
	actorId?: string;
	event: PiboOutputEvent;
	legacyStreamId?: number;
	createdAt?: string;
};

export type OutputEventIngestResult = {
	streamId: number;
	duplicate: boolean;
	messageId?: string;
	observationId?: string;
};

const INLINE_MESSAGE_PAYLOAD_THRESHOLD_BYTES = 16 * 1024;
const INLINE_JSON_PAYLOAD_THRESHOLD_BYTES = 16 * 1024;

export class ChatDataIngestService {
	constructor(private readonly store: PiboDataStore) {}

	ingestUserMessageAccepted(input: UserMessageAcceptedIngestInput): UserMessageAcceptedIngestResult {
		const idempotencyKey = input.clientTxnId
			? `chat:user.accepted:${input.roomId}:${input.actorId}:${input.clientTxnId}`
			: undefined;
		const messageId = idempotencyKey ? deterministicId("msg", idempotencyKey) : `msg_${randomUUID()}`;
		const existingMessage = this.store.messages.getMessage(messageId);
		if (existingMessage && idempotencyKey) {
			const existingEvent = this.store.eventLog.findByIdempotencyKey(idempotencyKey);
			return {
				streamId: existingEvent?.streamId ?? existingMessage.sourceStreamId ?? 0,
				messageId: existingMessage.id,
				duplicate: true,
			};
		}

		return this.store.transaction(() => {
			const now = input.legacyEvent?.createdAt ?? new Date().toISOString();
			this.store.sessions.upsertSession({ session: input.session, roomId: input.roomId, firstMessagePreview: input.text, lastActivityAt: now });
			const payloadRef = this.writeTextPayloadIfLarge(input.text, now, "chat_message");
			const event = this.store.eventLog.appendEvent({
				sessionId: input.session.id,
				sessionSequence: this.nextEventSequence(input.session.id),
				roomId: input.roomId,
				topic: "chat",
				type: "user.message.accepted",
				source: "user",
				actorType: "user",
				actorId: input.actorId,
				eventId: input.legacyEvent?.eventId,
				idempotencyKey,
				retentionClass: "chat_message",
				payloadRef,
				previewText: previewText(input.text),
				attributes: compactObject({
					clientTxnId: input.clientTxnId,
					legacyStreamId: input.legacyEvent?.streamId,
					inlineText: payloadRef ? undefined : input.text,
				}),
				createdAt: now,
				indexedAt: now,
			});

			const existingAfterEvent = this.store.messages.getMessage(messageId);
			if (existingAfterEvent && idempotencyKey) {
				return { streamId: event.streamId, messageId: existingAfterEvent.id, duplicate: true };
			}

			this.store.messages.insertMessage({
				id: messageId,
				sessionId: input.session.id,
				roomId: input.roomId,
				sequence: this.nextMessageSequence(input.session.id),
				role: "user",
				actorId: input.actorId,
				status: "complete",
				createdAt: now,
				completedAt: now,
				contentPreview: previewText(input.text),
				contentPayloadRef: payloadRef,
				sourceStreamId: event.streamId,
				attributes: compactObject({
					clientTxnId: input.clientTxnId,
					inlineText: payloadRef ? undefined : input.text,
				}) as PiboJsonObject,
			});

			this.upsertNavigation(input.session, input.roomId, previewText(input.text), now, "running");

			return { streamId: event.streamId, messageId, duplicate: false };
		});
	}

	ingestOutputEvent(input: OutputEventIngestInput): OutputEventIngestResult {
		const event = input.event;
		const idempotencyKey = outputIdempotencyKey(event);
		if (idempotencyKey) {
			const existing = this.store.eventLog.findByIdempotencyKey(idempotencyKey);
			if (existing) {
				return {
					streamId: existing.streamId,
					duplicate: true,
					messageId: messageIdForOutputEvent(event),
					observationId: observationIdForOutputEvent(event),
				};
			}
		}

		return this.store.transaction(() => {
			const now = input.createdAt ?? new Date().toISOString();
			if (input.roomId) {
				this.store.sessions.upsertSession({ session: input.session, roomId: input.roomId, lastActivityAt: now, status: outputSessionStatus(event) });
			}
			const payload = payloadForOutputEvent(event);
			const payloadRef = payload ? this.writePayloadIfLarge(payload.value, payload.contentType, now, retentionClassForOutputEvent(event)) : undefined;
			const storedEvent = this.store.eventLog.appendEvent({
				sessionId: input.session.id,
				sessionSequence: this.nextEventSequence(input.session.id),
				roomId: input.roomId,
				topic: "pibo.output",
				type: event.type,
				source: "actor",
				actorType: actorTypeForOutputEvent(event),
				actorId: input.actorId,
				turnId: turnIdForOutputEvent(event),
				eventId: eventIdForOutputEvent(event),
				toolCallId: "toolCallId" in event ? event.toolCallId : undefined,
				runId: eventIdForOutputEvent(event),
				idempotencyKey,
				retentionClass: retentionClassForOutputEvent(event),
				payloadRef,
				previewText: previewTextForOutputEvent(event),
				attributes: compactObject({
					legacyStreamId: input.legacyStreamId,
					inlinePayload: payloadRef ? undefined : toPiboJsonValue(payload?.value),
					...attributesForOutputEvent(event),
				}),
				createdAt: now,
				indexedAt: now,
			});

			let messageId: string | undefined;
			if (event.type === "assistant_message") {
				messageId = messageIdForOutputEvent(event);
				if (messageId && !this.store.messages.getMessage(messageId)) {
					this.store.messages.insertMessage({
						id: messageId,
						sessionId: input.session.id,
						roomId: input.roomId,
						sequence: this.nextMessageSequence(input.session.id),
						turnId: turnIdForOutputEvent(event),
						role: "assistant",
						actorId: input.actorId,
						status: "complete",
						createdAt: now,
						completedAt: now,
						contentPreview: previewText(event.text),
						contentPayloadRef: payloadRef,
						sourceStreamId: storedEvent.streamId,
						attributes: compactObject({
							eventId: event.eventId,
							assistantIndex: event.assistantIndex,
							contentIndex: event.contentIndex,
							inlineText: payloadRef ? undefined : event.text,
						}) as PiboJsonObject,
					});
				}
			}

			const observationId = observationIdForOutputEvent(event);
			this.store.observations.insertObservation({
				id: observationId,
				sessionId: input.session.id,
				turnId: turnIdForOutputEvent(event),
				eventStreamId: storedEvent.streamId,
				kind: observationKindForOutputEvent(event),
				role: observationRoleForOutputEvent(event),
				name: observationNameForOutputEvent(event),
				status: observationStatusForOutputEvent(event),
				startedAt: now,
				endedAt: isTerminalOutputEvent(event) ? now : undefined,
				previewText: previewTextForOutputEvent(event),
				payloadRef,
				attributes: compactObject({ eventType: event.type, eventId: eventIdForOutputEvent(event), ...attributesForOutputEvent(event) }),
			});

			if (input.roomId && (event.type === "assistant_message" || event.type === "message_finished" || event.type === "session_error")) {
				this.upsertNavigation(input.session, input.roomId, previewTextForOutputEvent(event), now, outputSessionStatus(event));
			}

			return { streamId: storedEvent.streamId, duplicate: false, messageId, observationId };
		});
	}

	private nextEventSequence(sessionId: string): number {
		const row = this.store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private nextMessageSequence(sessionId: string): number {
		const row = this.store.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM chat_messages WHERE session_id = ?").get(sessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private writeTextPayloadIfLarge(text: string, createdAt: string, retentionClass: string): string | undefined {
		if (Buffer.byteLength(text, "utf8") <= INLINE_MESSAGE_PAYLOAD_THRESHOLD_BYTES) return undefined;
		return this.store.payloads.writePayload({
			value: text,
			contentType: "text/plain; charset=utf-8",
			retentionClass,
			createdAt,
		}).id;
	}

	private writePayloadIfLarge(value: PiboJsonValue | string, contentType: string, createdAt: string, retentionClass: string): string | undefined {
		const bytes = Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
		const threshold = typeof value === "string" ? INLINE_MESSAGE_PAYLOAD_THRESHOLD_BYTES : INLINE_JSON_PAYLOAD_THRESHOLD_BYTES;
		if (bytes <= threshold) return undefined;
		return this.store.payloads.writePayload({ value, contentType, retentionClass, createdAt }).id;
	}

	private upsertNavigation(session: PiboSession, roomId: string, lastMessagePreview: string | undefined, now: string, status: string): void {
		this.store.navigation.upsertSession({
			ownerScope: session.ownerScope ?? "user:unknown",
			roomId,
			sessionId: session.id,
			rootSessionId: rootSessionId(session),
			parentId: session.parentId,
			originId: session.originId,
			title: session.title || lastMessagePreview || "Untitled Session",
			profile: session.profile,
			status,
			lastActivityAt: now,
			lastMessagePreview,
			sortKey: now,
			updatedAt: now,
		});
	}
}

function deterministicId(prefix: string, value: string): string {
	return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function hashJson(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex").slice(0, 16);
}

function previewText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 512) : undefined;
}

function compactObject(value: Record<string, unknown>): PiboJsonObject {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject;
}

function outputIdempotencyKey(event: PiboOutputEvent): string | undefined {
	const base = eventIdForOutputEvent(event) ?? ("toolCallId" in event ? event.toolCallId : undefined);
	if (!base) return undefined;
	return `pibo.output:${event.piboSessionId}:${event.type}:${base}:${outputPartKey(event)}`;
}

function outputPartKey(event: PiboOutputEvent): string {
	if (event.type === "tool_call") return `${event.toolCallId}:${event.argsComplete ? "complete" : "partial"}:${hashJson(event.args)}`;
	if ("toolCallId" in event) return event.toolCallId ?? "main";
	if (event.type === "assistant_message") return String(event.assistantIndex ?? event.contentIndex ?? 0);
	if (event.type === "assistant_delta") return String(event.assistantIndex ?? event.contentIndex ?? 0);
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") return String(event.thinkingIndex ?? event.contentIndex ?? 0);
	if (event.type === "execution_result") return event.action;
	return "main";
}

function messageIdForOutputEvent(event: PiboOutputEvent): string | undefined {
	if (event.type !== "assistant_message") return undefined;
	return deterministicId("msg", outputIdempotencyKey(event) ?? JSON.stringify(event));
}

function observationIdForOutputEvent(event: PiboOutputEvent): string {
	return deterministicId("obs", outputIdempotencyKey(event) ?? JSON.stringify(event));
}

function turnIdForOutputEvent(event: PiboOutputEvent): string | undefined {
	return eventIdForOutputEvent(event) ?? ("toolCallId" in event ? event.toolCallId : undefined);
}

function eventIdForOutputEvent(event: PiboOutputEvent): string | undefined {
	return "eventId" in event ? event.eventId : undefined;
}

function retentionClassForOutputEvent(event: PiboOutputEvent): string {
	if (event.type === "assistant_message" || event.type === "message_started" || event.type === "message_finished") return "chat_message";
	if (event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated") return "live_delta";
	return "trace_event";
}

function actorTypeForOutputEvent(event: PiboOutputEvent): string {
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type.startsWith("thinking_")) return "assistant";
	if (event.type.startsWith("tool_") || event.type === "subagent_session") return "agent";
	if (event.type === "session_error") return "system";
	return "agent";
}

function payloadForOutputEvent(event: PiboOutputEvent): { value: PiboJsonValue | string; contentType: string } | undefined {
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "thinking_finished") {
		return { value: event.text ?? "", contentType: "text/plain; charset=utf-8" };
	}
	if (event.type === "tool_call" || event.type === "tool_execution_started") return { value: toPiboJsonValueOrNull(event.args), contentType: "application/json" };
	if (event.type === "tool_execution_updated") return { value: toPiboJsonValueOrNull(event.partialResult), contentType: "application/json" };
	if (event.type === "tool_execution_finished") return { value: toPiboJsonValueOrNull(event.result), contentType: "application/json" };
	if (event.type === "execution_result") return { value: toPiboJsonValueOrNull(event.result), contentType: "application/json" };
	if (event.type === "pi_event") return { value: toPiboJsonValueOrNull(event.event), contentType: "application/json" };
	if (event.type === "compaction_end" && event.result !== undefined) return { value: toPiboJsonValueOrNull(event.result), contentType: "application/json" };
	return undefined;
}

function previewTextForOutputEvent(event: PiboOutputEvent): string | undefined {
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "thinking_finished") return previewText(event.text ?? "");
	if (event.type === "message_started") return previewText(event.text);
	if (event.type === "tool_call" || event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") return event.toolName;
	if (event.type === "subagent_session") return `${event.subagentName} via ${event.toolName}`;
	if (event.type === "execution_result") return event.action;
	if (event.type === "session_error") return previewText(event.error);
	if (event.type === "compaction_start" || event.type === "compaction_end") return event.reason;
	return event.type;
}

function attributesForOutputEvent(event: PiboOutputEvent): Record<string, unknown> {
	if (event.type === "assistant_message" || event.type === "assistant_delta") return { assistantIndex: event.assistantIndex, contentIndex: event.contentIndex };
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") return { thinkingIndex: event.thinkingIndex, contentIndex: event.contentIndex };
	if (event.type === "tool_call") return { toolCallId: event.toolCallId, toolName: event.toolName, argsComplete: event.argsComplete };
	if (event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") return { toolCallId: event.toolCallId, toolName: event.toolName, isError: "isError" in event ? event.isError : undefined };
	if (event.type === "subagent_session") return { toolCallId: event.toolCallId, toolName: event.toolName, subagentName: event.subagentName, childPiboSessionId: event.childPiboSessionId, threadKey: event.threadKey };
	if (event.type === "execution_result") return { action: event.action };
	if (event.type === "session_error") return { error: event.error };
	if (event.type === "compaction_start" || event.type === "compaction_end") return { reason: event.reason, aborted: "aborted" in event ? event.aborted : undefined, errorMessage: "errorMessage" in event ? event.errorMessage : undefined };
	return {};
}

function observationKindForOutputEvent(event: PiboOutputEvent): string {
	if (event.type === "assistant_message" || event.type === "assistant_delta") return "message";
	if (event.type.startsWith("thinking_")) return "thinking";
	if (event.type.startsWith("tool_") || event.type === "subagent_session") return "tool";
	if (event.type === "execution_result") return "execution";
	if (event.type === "session_error") return "error";
	if (event.type.startsWith("compaction_")) return "compaction";
	return "event";
}

function observationRoleForOutputEvent(event: PiboOutputEvent): string | undefined {
	if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type.startsWith("thinking_")) return "assistant";
	if (event.type.startsWith("tool_")) return "tool";
	return undefined;
}

function observationNameForOutputEvent(event: PiboOutputEvent): string | undefined {
	if ("toolName" in event) return event.toolName;
	if (event.type === "execution_result") return event.action;
	return event.type;
}

function observationStatusForOutputEvent(event: PiboOutputEvent): string {
	if (event.type.endsWith("_started") || event.type === "tool_call" || event.type === "compaction_start") return "running";
	if (event.type === "session_error") return "error";
	if (event.type === "tool_execution_finished" && event.isError) return "error";
	return "completed";
}

function isTerminalOutputEvent(event: PiboOutputEvent): boolean {
	return !event.type.endsWith("_started") && event.type !== "tool_call" && event.type !== "assistant_delta" && event.type !== "thinking_delta" && event.type !== "tool_execution_updated";
}

function outputSessionStatus(event: PiboOutputEvent): string {
	if (event.type === "session_error") return "error";
	if (event.type === "message_finished") return "idle";
	return "running";
}

function toPiboJsonValue(value: unknown): PiboJsonValue | undefined {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
}

function toPiboJsonValueOrNull(value: unknown): PiboJsonValue {
	return toPiboJsonValue(value) ?? null;
}
