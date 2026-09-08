import { createHash, randomUUID } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../core/events.js";
import { outputIdentityFingerprint, outputPartFingerprint } from "../core/output-render-sequence.js";
import type { PiboSession } from "../sessions/store.js";
import type { PiboDataStore } from "./pibo-store.js";
import type { PreparedPayload } from "./payload-store.js";
import { rootSessionId } from "./session-store.js";

export type UserMessageAcceptedIngestInput = {
	session: PiboSession;
	roomId: string;
	actorId: string;
	text: string;
	clientTxnId?: string;
	/** Stable Pibo input identity when acceptance precedes runtime output. */
	eventId?: string;
	legacyEvent?: {
		streamId?: number;
		eventId?: string;
		createdAt?: string;
	};
	preparedPayload?: PreparedPayload;
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

export class PiboOutputIdentityCollisionError extends Error {
	readonly code = "pibo_output_identity_collision";

	constructor(
		readonly idempotencyKey: string,
		readonly existingFingerprint: string,
		readonly incomingFingerprint: string,
	) {
		super(`Pibo output identity collision for "${idempotencyKey}"`);
		this.name = "PiboOutputIdentityCollisionError";
	}
}

export function outputPersistenceErrorIsRetryable(error: unknown): boolean {
	if (error instanceof PiboOutputIdentityCollisionError) return false;
	if (error && typeof error === "object" && "code" in error && error.code === "pibo_output_identity_collision") return false;
	if (error instanceof AggregateError) {
		return error.errors.length === 0 || error.errors.some(outputPersistenceErrorIsRetryable);
	}
	return true;
}

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

		const now = input.legacyEvent?.createdAt ?? new Date().toISOString();
		const preparedPayload = input.preparedPayload ?? this.prepareUserMessagePayload(input.text, now);
		return this.store.transaction(() => {
			this.store.sessions.upsertSession({ session: input.session, roomId: input.roomId, firstMessagePreview: input.text, lastActivityAt: now, preserveRuntimeBinding: true });
			const payloadRef = preparedPayload ? this.store.payloads.commitPreparedPayload(preparedPayload).id : undefined;
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
				turnId: input.eventId,
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

			this.upsertNavigation(input.session, input.roomId, previewText(input.text), now, input.eventId ? undefined : "running");

			return { streamId: event.streamId, messageId, duplicate: false };
		});
	}

	prepareUserMessagePayload(text: string, createdAt: string): PreparedPayload | undefined {
		return this.prepareTextPayloadIfLarge(text, createdAt, "chat_message");
	}

	ingestOutputEvent(input: OutputEventIngestInput): OutputEventIngestResult {
		const event = input.event;
		const idempotencyKey = outputIdempotencyKey(event);
		const identityFingerprint = outputIdentityFingerprint(event);
		const partFingerprint = isOutputPartEvent(event) ? outputPartFingerprint(event) : undefined;
		if (idempotencyKey) {
			const existing = this.store.eventLog.findByIdempotencyKey(idempotencyKey);
			if (existing) {
				const existingFingerprint = typeof existing.attributes.identityFingerprint === "string"
					? existing.attributes.identityFingerprint
					: undefined;
				if (existingFingerprint && existingFingerprint !== identityFingerprint) {
					const now = input.createdAt ?? new Date().toISOString();
					this.store.eventLog.appendEvent({
						sessionId: input.session.id,
						sessionSequence: this.nextEventSequence(input.session.id),
						roomId: input.roomId,
						topic: "pibo.diagnostic",
						type: "pibo.output.identity_collision",
						source: "pibo-ingest",
						actorType: "system",
						actorId: input.actorId,
						eventId: eventIdForOutputEvent(event),
						idempotencyKey: `${idempotencyKey}:collision:${identityFingerprint}`,
						retentionClass: "audit_event",
						previewText: `Output identity collision for ${event.type}`,
						attributes: {
							outputIdempotencyKey: idempotencyKey,
							existingFingerprint,
							incomingFingerprint: identityFingerprint,
							incomingType: event.type,
						},
						createdAt: now,
						indexedAt: now,
					});
					throw new PiboOutputIdentityCollisionError(idempotencyKey, existingFingerprint, identityFingerprint);
				}
				return {
					streamId: existing.streamId,
					duplicate: true,
					messageId: messageIdForOutputEvent(event),
					observationId: observationIdForOutputEvent(event),
				};
			}
		}

		const now = input.createdAt ?? new Date().toISOString();
		const payload = payloadForOutputEvent(event);
		const preparedPayload = payload ? this.preparePayloadIfLarge(payload.value, payload.contentType, now, retentionClassForOutputEvent(event)) : undefined;
		return this.store.transaction(() => {
			if (event.type === "compaction_end" && !event.aborted && !event.errorMessage && !event.compactionStats) {
				event.compactionStats = this.compactionStats(input.session.id, event.result);
			}
			if (input.roomId) {
				this.store.sessions.upsertSession({ session: input.session, roomId: input.roomId, lastActivityAt: now, status: outputSessionStatus(event), preserveRuntimeBinding: true });
			}
			const payloadRef = preparedPayload ? this.store.payloads.commitPreparedPayload(preparedPayload).id : undefined;
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
					identityFingerprint,
					outputPartFingerprint: partFingerprint,
					eventIdentityScoped: eventIdForOutputEvent(event) !== undefined,
					semanticEventId: eventIdForOutputEvent(event),
					legacyStreamId: input.legacyStreamId,
					inlinePayload: payloadRef ? undefined : toPiboJsonValue(payload?.value),
					...attributesForOutputEvent(event),
				}),
				createdAt: now,
				indexedAt: now,
			});

			let messageId: string | undefined;
			if (event.type === "message_finished" && event.eventId) {
				this.store.messages.completeAssistantMessagesForTurn({
					sessionId: input.session.id,
					turnId: event.eventId,
					completedAt: now,
				});
			}
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
				const navigationPreview = event.type === "message_finished" ? undefined : previewTextForOutputEvent(event);
				this.upsertNavigation(input.session, input.roomId, navigationPreview, now, outputSessionStatus(event));
			}

			return { streamId: storedEvent.streamId, duplicate: false, messageId, observationId };
		});
	}

	private compactionStats(sessionId: string, result: unknown): NonNullable<Extract<PiboOutputEvent, { type: "compaction_end" }>["compactionStats"]> {
		const boundary = this.store.db.prepare(`
			SELECT COALESCE(MAX(session_sequence), 0) AS sequence
			FROM event_log
			WHERE session_id = ?
				AND type = 'compaction_end'
				AND COALESCE(json_extract(attributes_json, '$.aborted'), 0) = 0
				AND json_extract(attributes_json, '$.errorMessage') IS NULL
		`).get(sessionId) as { sequence: number };
		const segmentWhere = `session_id = ? AND type = 'tool_execution_finished' AND session_sequence > ?`;
		const count = this.store.db.prepare(`SELECT COUNT(*) AS count FROM event_log WHERE ${segmentWhere}`)
			.get(sessionId, boundary.sequence) as { count: number };
		const maxRow = this.store.db.prepare(`
			SELECT attributes_json
			FROM event_log
			WHERE ${segmentWhere}
				AND json_type(attributes_json, '$.toolMetrics.outputTokens') IN ('integer', 'real')
			ORDER BY json_extract(attributes_json, '$.toolMetrics.outputTokens') DESC
			LIMIT 1
		`).get(sessionId, boundary.sequence) as { attributes_json: string } | undefined;
		const maxToolOutput = maxRow ? toolMetricsFromAttributes(maxRow.attributes_json) : undefined;
		return compactObject({
			toolCallCount: count.count,
			maxToolOutputTokens: maxToolOutput?.outputTokens,
			maxToolOutputTokenBasis: maxToolOutput?.tokenBasis,
			compactionTokens: compactionTokenCount(result),
		}) as NonNullable<Extract<PiboOutputEvent, { type: "compaction_end" }>["compactionStats"]>;
	}

	private nextEventSequence(sessionId: string): number {
		const row = this.store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private nextMessageSequence(sessionId: string): number {
		const row = this.store.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM chat_messages WHERE session_id = ?").get(sessionId) as { next_sequence: number };
		return row.next_sequence;
	}

	private prepareTextPayloadIfLarge(text: string, createdAt: string, retentionClass: string): PreparedPayload | undefined {
		if (Buffer.byteLength(text, "utf8") <= INLINE_MESSAGE_PAYLOAD_THRESHOLD_BYTES) return undefined;
		return this.store.payloads.preparePayload({
			value: text,
			contentType: "text/plain; charset=utf-8",
			retentionClass,
			createdAt,
		});
	}

	private preparePayloadIfLarge(value: PiboJsonValue | string, contentType: string, createdAt: string, retentionClass: string): PreparedPayload | undefined {
		const bytes = Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
		const threshold = typeof value === "string" ? INLINE_MESSAGE_PAYLOAD_THRESHOLD_BYTES : INLINE_JSON_PAYLOAD_THRESHOLD_BYTES;
		if (bytes <= threshold) return undefined;
		return this.store.payloads.preparePayload({ value, contentType, retentionClass, createdAt });
	}

	private upsertNavigation(session: PiboSession, roomId: string, lastMessagePreview: string | undefined, now: string, status?: string): void {
		this.store.navigation.upsertSession({
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

function toolMetricsFromAttributes(attributesJson: string): { outputTokens?: number; tokenBasis?: import("../shared/tool-call-token-settings.js").ToolMetricTokenBasis } | undefined {
	try {
		const attributes = JSON.parse(attributesJson) as unknown;
		if (!isRecord(attributes) || !isRecord(attributes.toolMetrics)) return undefined;
		const outputTokens = nonNegativeFiniteNumber(attributes.toolMetrics.outputTokens);
		const tokenBasis = typeof attributes.toolMetrics.tokenBasis === "string"
			? attributes.toolMetrics.tokenBasis as import("../shared/tool-call-token-settings.js").ToolMetricTokenBasis
			: undefined;
		return { outputTokens, tokenBasis };
	} catch {
		return undefined;
	}
}

function compactionTokenCount(result: unknown): number | undefined {
	if (!isRecord(result)) return undefined;
	return nonNegativeFiniteNumber(result.tokensBefore);
}

function nonNegativeFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deterministicId(prefix: string, value: string): string {
	return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function hashJson(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	const record = value as Record<string, unknown>;
	const entries = Object.keys(record)
		.sort()
		.filter((key) => record[key] !== undefined)
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
	return `{${entries.join(",")}}`;
}

function previewText(text: string): string | undefined {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 512) : undefined;
}

function compactObject(value: Record<string, unknown>): PiboJsonObject {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject;
}

export function outputIdempotencyKey(event: PiboOutputEvent): string | undefined {
	const base = eventIdForOutputEvent(event) ?? ("toolCallId" in event ? event.toolCallId : undefined);
	if (base) return `pibo.output:${event.piboSessionId}:${event.type}:${base}:${outputPartKey(event)}`;
	if (Number.isSafeInteger(event.renderSequence) && (event.renderSequence ?? 0) > 0) {
		return `pibo.output:${event.piboSessionId}:${event.type}:render:${event.renderSequence}`;
	}
	return undefined;
}

export function outputPersistenceDeliveryKey(event: PiboOutputEvent): string {
	return outputIdempotencyKey(event)
		?? `pibo.output:${event.piboSessionId}:${event.type}:render:${event.renderSequence ?? "unpositioned"}`;
}

function outputPartKey(event: PiboOutputEvent): string {
	if (event.type === "tool_call") return `${event.toolCallId}:${event.toolInvocationOrdinal ?? 0}:${event.argsComplete ? "complete" : "partial"}:${hashJson(event.args)}`;
	if ("toolCallId" in event) return `${event.toolCallId ?? "main"}:${event.toolInvocationOrdinal ?? 0}`;
	if (event.type === "assistant_message") return String(event.assistantIndex ?? event.contentIndex ?? 0);
	if (event.type === "assistant_delta") return String(event.assistantIndex ?? event.contentIndex ?? 0);
	if (event.type === "assistant_usage") return String(event.usageIndex ?? hashJson({ inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, reasoningTokens: event.reasoningTokens, totalTokens: event.totalTokens, costUsd: event.costUsd }));
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") return String(event.thinkingIndex ?? event.contentIndex ?? 0);
	if (event.type === "compaction_start" || event.type === "compaction_end") return String(event.compactionIndex ?? 0);
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
	if (event.type === "message_queued" || event.type === "message_steered" || event.type === "message_started") return previewText(event.text);
	if (event.type === "tool_call" || event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") return event.toolName;
	if (event.type === "subagent_session") return `${event.subagentName} via ${event.toolName}`;
	if (event.type === "execution_result") return event.action;
	if (event.type === "session_error") return previewText(event.error);
	if (event.type === "compaction_start" || event.type === "compaction_end") return event.reason;
	return event.type;
}

function attributesForOutputEvent(event: PiboOutputEvent): Record<string, unknown> {
	return { renderSequence: event.renderSequence, toolInvocationOrdinal: event.toolInvocationOrdinal, ...specificAttributesForOutputEvent(event) };
}

function specificAttributesForOutputEvent(event: PiboOutputEvent): Record<string, unknown> {
	if (event.type === "message_queued") return { inlineText: event.text, source: event.source, queuedMessages: event.queuedMessages };
	if (event.type === "message_steered") return { inlineText: event.text, source: event.source, activeEventId: event.activeEventId };
	if (event.type === "message_started") return { inlineText: event.text, source: event.source };
	if (event.type === "message_finished") return { source: event.source };
	if (event.type === "assistant_message" || event.type === "assistant_delta") return { assistantIndex: event.assistantIndex, contentIndex: event.contentIndex };
	if (event.type === "assistant_usage") return {
		usageIndex: event.usageIndex,
		inputTokens: event.inputTokens,
		outputTokens: event.outputTokens,
		cacheReadTokens: event.cacheReadTokens,
		cacheWriteTokens: event.cacheWriteTokens,
		reasoningTokens: event.reasoningTokens,
		totalTokens: event.totalTokens,
		costUsd: event.costUsd,
	};
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") return { thinkingIndex: event.thinkingIndex, contentIndex: event.contentIndex };
	if (event.type === "tool_call") return { toolCallId: event.toolCallId, toolName: event.toolName, argsComplete: event.argsComplete, intent: event.intent };
	if (event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") return { toolCallId: event.toolCallId, toolName: event.toolName, isError: "isError" in event ? event.isError : undefined, intent: event.intent, toolMetrics: event.type === "tool_execution_finished" ? event.toolMetrics : undefined };
	if (event.type === "subagent_session") return { toolCallId: event.toolCallId, toolName: event.toolName, subagentName: event.subagentName, childPiboSessionId: event.childPiboSessionId, threadKey: event.threadKey };
	if (event.type === "execution_result") return { action: event.action };
	if (event.type === "session_error") return { error: event.error, ...(event.errorDetails ? { errorDetails: event.errorDetails } : {}) };
	if (event.type === "compaction_start" || event.type === "compaction_end") return { compactionIndex: event.compactionIndex, reason: event.reason, aborted: "aborted" in event ? event.aborted : undefined, errorMessage: "errorMessage" in event ? event.errorMessage : undefined, compactionStats: "compactionStats" in event ? event.compactionStats : undefined };
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

function isOutputPartEvent(event: PiboOutputEvent): boolean {
	return event.type === "assistant_delta"
		|| event.type === "assistant_message"
		|| event.type === "thinking_started"
		|| event.type === "thinking_delta"
		|| event.type === "thinking_finished"
		|| event.type === "assistant_usage"
		|| event.type === "compaction_start"
		|| event.type === "compaction_end";
}

function isTerminalOutputEvent(event: PiboOutputEvent): boolean {
	return !event.type.endsWith("_started") && event.type !== "tool_call" && event.type !== "assistant_delta" && event.type !== "thinking_delta" && event.type !== "tool_execution_updated";
}

function outputSessionStatus(event: PiboOutputEvent): string | undefined {
	if (event.type === "session_error") return "error";
	if (event.type === "message_finished") return "idle";
	if (event.type === "message_queued" || event.type === "message_steered" || event.type === "message_started") return "running";
	return undefined;
}

function toPiboJsonValue(value: unknown): PiboJsonValue | undefined {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
}

function toPiboJsonValueOrNull(value: unknown): PiboJsonValue {
	return toPiboJsonValue(value) ?? null;
}
