import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../../core/events.js";
import { normalizeSessionErrorDetails } from "../../../core/session-errors.js";
import type { StoredChatEvent } from "../types/event-store.js";
import { roomWorkspaceFromMetadata, type PiboRoom } from "../types/rooms.js";
import type { ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "../types/read-model.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import type { PayloadStore } from "../../../data/payload-store.js";
import { tracePayloadRefForStoredPayload } from "../trace-v2.js";
import { qualifiedToolNodeId } from "../../../shared/trace-tool-identity.js";

type PiboPayloadReader = Pick<PayloadStore, "getPayload" | "readPayloadBytesBounded" | "readPayloadJsonBounded">;
const MAX_TRACE_EVENT_HYDRATION_BYTES = 1024 * 1024;

export type EventLogRow = {
	stream_id: number;
	session_id: string | null;
	session_sequence: number | null;
	room_id: string | null;
	type: string;
	actor_type: string | null;
	actor_id: string | null;
	event_id: string | null;
	idempotency_key: string | null;
	retention_class: string;
	payload_ref?: string | null;
	preview_text: string | null;
	attributes_json: string;
	created_at: string;
};

export type SessionRow = {
	id: string;
	pi_session_id: string | null;
	parent_id: string | null;
	channel: string;
	kind: string;
	profile: string;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
	status: string;
	runtime_instance_id?: string | null;
	runtime_adapter_id?: string | null;
	native_session_id?: string | null;
	binding_state?: string | null;
};

export type RoomRow = {
	id: string;
	name: string;
	topic: string | null;
	type: "space" | "chat" | "agent";
	parent_room_id: string | null;
	workspace: string | null;
	archived_at: string | null;
	retention_policy_id: string | null;
	metadata_json: string;
	created_at: string;
	updated_at: string;
};

export function storedPiboEventFromV2Row(row: EventLogRow, payloadStore?: PiboPayloadReader): ChatWebStoredPiboEvent | undefined {
	const attributes = parseJsonObject(row.attributes_json);
	const payload = outputPayloadFromV2Row(row, attributes, readPersistedPayload(row, payloadStore));
	if (!payload) return undefined;
	const payloadIdentity = tracePayloadIdentityForEvent(row, attributes);
	const storedPayloadRef = row.payload_ref && row.session_id && payloadStore && payloadIdentity
		? tracePayloadRefForStoredPayload({
			payloadStore,
			piboSessionId: row.session_id,
			payloadId: row.payload_ref,
			...payloadIdentity,
		})
		: undefined;
	const renderSequence = numberAttribute(attributes, "renderSequence") ?? payload.renderSequence;
	return { id: String(row.stream_id), piboSessionId: row.session_id ?? undefined, eventSequence: row.session_sequence ?? undefined, renderSequence, eventId: row.event_id ?? undefined, streamId: row.stream_id, storedPayloadRef, type: row.type, createdAt: row.created_at, payload };
}

export function storedChatEventFromV2Row(row: EventLogRow, payloadStore?: PiboPayloadReader): StoredChatEvent {
	const attributes = parseJsonObject(row.attributes_json);
	return { streamId: row.stream_id, roomId: row.room_id ?? undefined, piboSessionId: row.session_id ?? undefined, eventId: row.event_id ?? `evt_${row.stream_id}`, eventType: row.type, actorType: actorTypeValue(row.actor_type), actorId: row.actor_id ?? undefined, clientTxnId: typeof attributes.clientTxnId === "string" ? attributes.clientTxnId : undefined, createdAt: row.created_at, retentionClass: retentionClassValue(row.retention_class), payload: (outputPayloadFromV2Row(row, attributes, readPersistedPayload(row, payloadStore)) ?? null) as PiboJsonValue };
}

function outputPayloadFromV2Row(row: EventLogRow, attributes: PiboJsonObject, persistedPayload?: PiboJsonValue | string): PiboOutputEvent | undefined {
	const inlinePayload = attributes.inlinePayload ?? persistedPayload;
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload) && typeof inlinePayload.type === "string") {
		return compactObject({
			...inlinePayload,
			renderSequence: numberAttribute(attributes, "renderSequence") ?? inlinePayload.renderSequence,
		}) as PiboOutputEvent;
	}
	const piboSessionId = row.session_id;
	if (!piboSessionId) return undefined;
	const eventIdentityScoped = typeof attributes.eventIdentityScoped === "boolean"
		? attributes.eventIdentityScoped
		: undefined;
	const eventId = eventIdentityScoped === false
		? undefined
		: stringAttribute(attributes, "semanticEventId") ?? row.event_id ?? undefined;
	const base = compactObject({ piboSessionId, eventId, renderSequence: numberAttribute(attributes, "renderSequence"), toolInvocationOrdinal: numberAttribute(attributes, "toolInvocationOrdinal") }) as { piboSessionId: string; eventId?: string; renderSequence?: number; toolInvocationOrdinal?: number };
	if (row.type === "assistant_message" || row.type === "assistant_delta") {
		return compactObject({
			...base,
			type: row.type,
			assistantIndex: numberAttribute(attributes, "assistantIndex"),
			contentIndex: numberAttribute(attributes, "contentIndex"),
			text: typeof inlinePayload === "string" ? inlinePayload : row.preview_text ?? "",
		}) as PiboOutputEvent;
	}
	if (row.type === "message_queued") return { ...base, type: "message_queued", text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "", source: stringAttribute(attributes, "source") ?? "user", queuedMessages: numberAttribute(attributes, "queuedMessages") ?? 1 } as PiboOutputEvent;
	if (row.type === "message_steered") return { ...base, type: "message_steered", text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "", source: stringAttribute(attributes, "source") ?? "user", activeEventId: stringAttribute(attributes, "activeEventId") } as PiboOutputEvent;
	if (row.type === "message_started") return compactObject({
		...base,
		type: "message_started",
		text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "",
		source: stringAttribute(attributes, "source"),
	}) as PiboOutputEvent;
	if (row.type === "message_finished") return compactObject({
		...base,
		type: "message_finished",
		source: stringAttribute(attributes, "source"),
	}) as PiboOutputEvent;
	if (row.type === "assistant_usage") {
		return compactObject({
			...base,
			type: "assistant_usage",
			usageIndex: numberAttribute(attributes, "usageIndex"),
			inputTokens: numberAttribute(attributes, "inputTokens"),
			outputTokens: numberAttribute(attributes, "outputTokens"),
			cacheReadTokens: numberAttribute(attributes, "cacheReadTokens"),
			cacheWriteTokens: numberAttribute(attributes, "cacheWriteTokens"),
			reasoningTokens: numberAttribute(attributes, "reasoningTokens"),
			totalTokens: numberAttribute(attributes, "totalTokens") ?? 0,
			costUsd: numberAttribute(attributes, "costUsd"),
		}) as PiboOutputEvent;
	}
	if (row.type === "thinking_started" || row.type === "thinking_delta" || row.type === "thinking_finished") {
		return compactObject({
			...base,
			type: row.type,
			thinkingIndex: numberAttribute(attributes, "thinkingIndex"),
			contentIndex: numberAttribute(attributes, "contentIndex"),
			...(row.type === "thinking_started" ? {} : { text: typeof inlinePayload === "string" ? inlinePayload : row.preview_text ?? "" }),
		}) as PiboOutputEvent;
	}
	if (row.type === "tool_call") return compactObject({ ...base, type: "tool_call", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null, argsComplete: booleanAttribute(attributes, "argsComplete") ?? true, intent: stringAttribute(attributes, "intent") }) as PiboOutputEvent;
	if (row.type === "tool_execution_started") return compactObject({ ...base, type: "tool_execution_started", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null, intent: stringAttribute(attributes, "intent") }) as PiboOutputEvent;
	if (row.type === "tool_execution_updated") return compactObject({ ...base, type: "tool_execution_updated", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: null, partialResult: inlinePayload ?? null, intent: stringAttribute(attributes, "intent") }) as PiboOutputEvent;
	if (row.type === "tool_execution_finished") return compactObject({ ...base, type: "tool_execution_finished", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", result: inlinePayload ?? null, isError: booleanAttribute(attributes, "isError") ?? false, intent: stringAttribute(attributes, "intent"), toolMetrics: attributes.toolMetrics }) as PiboOutputEvent;
	if (row.type === "subagent_session") {
		const toolName = stringAttribute(attributes, "toolName");
		const subagentName = stringAttribute(attributes, "subagentName");
		const childPiboSessionId = stringAttribute(attributes, "childPiboSessionId");
		if (!toolName || !subagentName || !childPiboSessionId) return undefined;
		return { ...base, type: "subagent_session", toolCallId: stringAttribute(attributes, "toolCallId"), toolName, subagentName, childPiboSessionId, threadKey: stringAttribute(attributes, "threadKey") };
	}
	if (row.type === "execution_result") return { ...base, type: "execution_result", action: row.preview_text ?? stringAttribute(attributes, "action") ?? "execution", result: inlinePayload ?? null };
	if (row.type === "compaction_start") return { ...base, type: "compaction_start", compactionIndex: numberAttribute(attributes, "compactionIndex"), reason: stringAttribute(attributes, "reason") ?? row.preview_text ?? "unknown" } as PiboOutputEvent;
	if (row.type === "compaction_end") return { ...base, type: "compaction_end", compactionIndex: numberAttribute(attributes, "compactionIndex"), reason: stringAttribute(attributes, "reason") ?? row.preview_text ?? "unknown", result: inlinePayload, aborted: booleanAttribute(attributes, "aborted") ?? false, errorMessage: stringAttribute(attributes, "errorMessage") } as PiboOutputEvent;
	if (row.type === "session_error") {
		const error = stringAttribute(attributes, "error") ?? row.preview_text ?? "Error";
		return { ...base, type: "session_error", error, errorDetails: normalizeSessionErrorDetails(error, isRecord(attributes.errorDetails) ? attributes.errorDetails : undefined) } as PiboOutputEvent;
	}
	if (row.type === "user.message.accepted") return { type: "user.message.accepted", piboSessionId, roomId: row.room_id ?? undefined, text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "", clientTxnId: stringAttribute(attributes, "clientTxnId") } as unknown as PiboOutputEvent;
	return { ...base, type: row.type } as PiboOutputEvent;
}

function readPersistedPayload(row: EventLogRow, payloadStore: PiboPayloadReader | undefined): PiboJsonValue | string | undefined {
	if (!row.payload_ref || !payloadStore) return undefined;
	try {
		const metadata = payloadStore.getPayload(row.payload_ref);
		if (!metadata || metadata.byteSize > MAX_TRACE_EVENT_HYDRATION_BYTES) return undefined;
		const text = Buffer.from(payloadStore.readPayloadBytesBounded(row.payload_ref, MAX_TRACE_EVENT_HYDRATION_BYTES)).toString("utf8");
		return metadata.contentType.includes("json") ? JSON.parse(text) as PiboJsonValue : text;
	} catch {
		return undefined;
	}
}

function tracePayloadIdentityForEvent(
	row: EventLogRow,
	attributes: PiboJsonObject,
): { nodeId: string; payloadKind: "input" | "output" } | undefined {
	const toolCallId = stringAttribute(attributes, "toolCallId");
	if (!toolCallId) return undefined;
	const eventId = stringAttribute(attributes, "semanticEventId") ?? row.event_id;
	if (!eventId) return undefined;
	const ordinal = numberAttribute(attributes, "toolInvocationOrdinal") ?? 0;
	const nodeId = qualifiedToolNodeId(toolCallId, eventId, ordinal);
	if (row.type === "tool_call" || row.type === "tool_execution_started") return { nodeId, payloadKind: "input" };
	if (row.type === "tool_execution_updated" || row.type === "tool_execution_finished") return { nodeId, payloadKind: "output" };
	return undefined;
}

export function sessionFromRow(row: SessionRow): ChatWebSessionIndexItem { return { piboSessionId: row.id, piSessionId: row.pi_session_id ?? "", runtimeInstanceId: row.runtime_instance_id ?? undefined, runtimeAdapterId: row.runtime_adapter_id ?? undefined, runtimeBindingState: isRuntimeBindingState(row.binding_state) ? row.binding_state : undefined, nativeSessionId: row.native_session_id ?? undefined, parentId: row.parent_id ?? undefined, profile: row.profile, channel: row.channel, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at, status: row.status === "running" || row.status === "error" ? row.status : "idle" }; }
export function roomFromRow(row: RoomRow): PiboRoom { const metadata = parseJsonObject(row.metadata_json); return { id: row.id, name: row.name, topic: row.topic ?? undefined, workspace: row.workspace ?? roomWorkspaceFromMetadata(metadata), type: row.type, parentRoomId: row.parent_room_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, retentionPolicyId: row.retention_policy_id ?? undefined, metadata }; }
export function parseJsonObject(value: string): PiboJsonObject { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : {}; } catch { return {}; } }
export function stringAttribute(attributes: PiboJsonObject, key: string): string | undefined { const value = attributes[key]; return typeof value === "string" ? value : undefined; }
function booleanAttribute(attributes: PiboJsonObject, key: string): boolean | undefined { const value = attributes[key]; return typeof value === "boolean" ? value : undefined; }
function numberAttribute(attributes: PiboJsonObject, key: string): number | undefined { const value = attributes[key]; return typeof value === "number" ? value : undefined; }
function isRecord(value: unknown): value is PiboJsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function nextSessionSequence(store: PiboDataStore, sessionId: string): number { const row = store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number }; return row.next_sequence; }
export function compactObject(value: Record<string, unknown>): PiboJsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject; }
export function previewForPayload(payload: unknown): string | undefined { if (typeof payload === "object" && payload && "text" in payload && typeof payload.text === "string") return payload.text.slice(0, 512); if (typeof payload === "string") return payload.slice(0, 512); return undefined; }
export function statusFromOutputEvent(event: PiboOutputEvent): ChatWebSessionIndexItem["status"] | undefined {
	if (event.type === "session_error") return "error";
	if (event.type === "message_finished") return "idle";
	if (event.type === "message_queued" || event.type === "message_steered" || event.type === "message_started") return "running";
	return undefined;
}
function isRuntimeBindingState(value: string | null | undefined): value is NonNullable<ChatWebSessionIndexItem["runtimeBindingState"]> { return value === "unbound" || value === "bound" || value === "missing" || value === "error"; }
function actorTypeValue(value: string | null): "user" | "assistant" | "system" | "agent" | undefined { return value === "user" || value === "assistant" || value === "system" || value === "agent" ? value : undefined; }
function retentionClassValue(value: string): "live_delta" | "trace_event" | "chat_message" | "audit_event" { return value === "live_delta" || value === "chat_message" || value === "audit_event" ? value : "trace_event"; }
