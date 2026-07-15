import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../../core/events.js";
import { normalizeSessionErrorDetails } from "../../../core/session-errors.js";
import type { StoredChatEvent } from "../types/event-store.js";
import { roomWorkspaceFromMetadata, type PiboRoom } from "../types/rooms.js";
import type { ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "../types/read-model.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";

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

export function storedPiboEventFromV2Row(row: EventLogRow): ChatWebStoredPiboEvent | undefined {
	const attributes = parseJsonObject(row.attributes_json);
	const payload = outputPayloadFromV2Row(row, attributes);
	if (!payload) return undefined;
	return { id: String(row.stream_id), piboSessionId: row.session_id ?? undefined, eventSequence: row.session_sequence ?? undefined, eventId: row.event_id ?? undefined, streamId: row.stream_id, type: row.type, createdAt: row.created_at, payload };
}

export function storedChatEventFromV2Row(row: EventLogRow): StoredChatEvent {
	const attributes = parseJsonObject(row.attributes_json);
	return { streamId: row.stream_id, roomId: row.room_id ?? undefined, piboSessionId: row.session_id ?? undefined, eventId: row.event_id ?? `evt_${row.stream_id}`, eventType: row.type, actorType: actorTypeValue(row.actor_type), actorId: row.actor_id ?? undefined, clientTxnId: typeof attributes.clientTxnId === "string" ? attributes.clientTxnId : undefined, createdAt: row.created_at, retentionClass: retentionClassValue(row.retention_class), payload: (outputPayloadFromV2Row(row, attributes) ?? null) as PiboJsonValue };
}

function outputPayloadFromV2Row(row: EventLogRow, attributes: PiboJsonObject): PiboOutputEvent | undefined {
	const inlinePayload = attributes.inlinePayload;
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload) && typeof inlinePayload.type === "string") return inlinePayload as PiboOutputEvent;
	const piboSessionId = row.session_id;
	if (!piboSessionId) return undefined;
	const base = compactObject({ piboSessionId, eventId: row.event_id ?? undefined }) as { piboSessionId: string; eventId?: string };
	if (row.type === "assistant_message") return { ...base, type: "assistant_message", text: row.preview_text ?? "" };
	if (row.type === "message_queued") return { ...base, type: "message_queued", text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "", source: stringAttribute(attributes, "source") ?? "user", queuedMessages: numberAttribute(attributes, "queuedMessages") ?? 1 } as PiboOutputEvent;
	if (row.type === "message_started") return { ...base, type: "message_started", text: row.preview_text ?? "" };
	if (row.type === "message_finished") return { ...base, type: "message_finished" };
	if (row.type === "thinking_started") return { ...base, type: "thinking_started" };
	if (row.type === "thinking_finished") return { ...base, type: "thinking_finished", text: row.preview_text ?? "" };
	if (row.type === "tool_call") return { ...base, type: "tool_call", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null, argsComplete: booleanAttribute(attributes, "argsComplete") ?? true };
	if (row.type === "tool_execution_started") return { ...base, type: "tool_execution_started", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null };
	if (row.type === "tool_execution_updated") return { ...base, type: "tool_execution_updated", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: null, partialResult: inlinePayload ?? null };
	if (row.type === "tool_execution_finished") return { ...base, type: "tool_execution_finished", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", result: inlinePayload ?? null, isError: booleanAttribute(attributes, "isError") ?? false };
	if (row.type === "subagent_session") {
		const toolName = stringAttribute(attributes, "toolName");
		const subagentName = stringAttribute(attributes, "subagentName");
		const childPiboSessionId = stringAttribute(attributes, "childPiboSessionId");
		if (!toolName || !subagentName || !childPiboSessionId) return undefined;
		return { ...base, type: "subagent_session", toolCallId: stringAttribute(attributes, "toolCallId"), toolName, subagentName, childPiboSessionId, threadKey: stringAttribute(attributes, "threadKey") };
	}
	if (row.type === "execution_result") return { ...base, type: "execution_result", action: row.preview_text ?? stringAttribute(attributes, "action") ?? "execution", result: inlinePayload ?? null };
	if (row.type === "session_error") {
		const error = stringAttribute(attributes, "error") ?? row.preview_text ?? "Error";
		return { ...base, type: "session_error", error, errorDetails: normalizeSessionErrorDetails(error, isRecord(attributes.errorDetails) ? attributes.errorDetails : undefined) } as PiboOutputEvent;
	}
	if (row.type === "user.message.accepted") return { type: "user.message.accepted", piboSessionId, roomId: row.room_id ?? undefined, text: stringAttribute(attributes, "inlineText") ?? row.preview_text ?? "", clientTxnId: stringAttribute(attributes, "clientTxnId") } as unknown as PiboOutputEvent;
	return { ...base, type: row.type } as PiboOutputEvent;
}

export function sessionFromRow(row: SessionRow): ChatWebSessionIndexItem { return { piboSessionId: row.id, piSessionId: row.pi_session_id ?? row.id, parentId: row.parent_id ?? undefined, profile: row.profile, channel: row.channel, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at, status: row.status === "running" || row.status === "error" ? row.status : "idle" }; }
export function roomFromRow(row: RoomRow): PiboRoom { const metadata = parseJsonObject(row.metadata_json); return { id: row.id, name: row.name, topic: row.topic ?? undefined, workspace: row.workspace ?? roomWorkspaceFromMetadata(metadata), type: row.type, parentRoomId: row.parent_room_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, retentionPolicyId: row.retention_policy_id ?? undefined, metadata }; }
export function parseJsonObject(value: string): PiboJsonObject { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : {}; } catch { return {}; } }
export function stringAttribute(attributes: PiboJsonObject, key: string): string | undefined { const value = attributes[key]; return typeof value === "string" ? value : undefined; }
function booleanAttribute(attributes: PiboJsonObject, key: string): boolean | undefined { const value = attributes[key]; return typeof value === "boolean" ? value : undefined; }
function numberAttribute(attributes: PiboJsonObject, key: string): number | undefined { const value = attributes[key]; return typeof value === "number" ? value : undefined; }
function isRecord(value: unknown): value is PiboJsonObject { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function nextSessionSequence(store: PiboDataStore, sessionId: string): number { const row = store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number }; return row.next_sequence; }
export function compactObject(value: Record<string, unknown>): PiboJsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject; }
export function previewForPayload(payload: unknown): string | undefined { if (typeof payload === "object" && payload && "text" in payload && typeof payload.text === "string") return payload.text.slice(0, 512); if (typeof payload === "string") return payload.slice(0, 512); return undefined; }
export function statusFromOutputEvent(event: PiboOutputEvent): ChatWebSessionIndexItem["status"] { if (event.type === "session_error") return "error"; if (event.type === "message_finished") return "idle"; return "running"; }
function actorTypeValue(value: string | null): "user" | "assistant" | "system" | "agent" | undefined { return value === "user" || value === "assistant" || value === "system" || value === "agent" ? value : undefined; }
function retentionClassValue(value: string): "live_delta" | "trace_event" | "chat_message" | "audit_event" { return value === "live_delta" || value === "chat_message" || value === "audit_event" ? value : "trace_event"; }
