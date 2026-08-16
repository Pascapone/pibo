import type { ResolvedPiboDebugStore } from "./stores.js";
import { inspectDebugEvents } from "./events.js";
import { inspectDebugMessageShow, inspectDebugMessagesList } from "./messages.js";
import { formatNextCommands } from "./next-commands.js";
import { inspectDebugSession, parseDebugSessionInput } from "./session.js";
import { inspectDebugTrace } from "./trace.js";

export type DebugSummaryResult = {
	piboSessionId: string;
	runtimeInstanceId?: unknown;
	runtimeAdapterId?: unknown;
	nativeSessionId?: unknown;
	runtimeBindingState?: unknown;
	status?: unknown;
	traceStatus?: string;
	roomId?: unknown;
	title?: unknown;
	createdAt?: unknown;
	updatedAt?: unknown;
	lastActivityAt?: unknown;
	messages: Record<string, number>;
	finalAssistant?: { available: boolean; bytes?: number; streamId?: number; preview?: string };
	toolCallCount?: unknown;
	failedToolCallCount: number;
	nextCommands: string[];
};

export async function inspectDebugSummary(input: string, stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore }): Promise<DebugSummaryResult> {
	const parsed = parseDebugSessionInput(input);
	const session = inspectDebugSession(input, stores, {});
	const messages = inspectDebugMessagesList(parsed.piboSessionId, stores.chat, { limit: 1000 }).messages;
	const final = inspectDebugMessageShow(parsed.piboSessionId, stores.chat, "assistant:last", { maxBytes: 240 });
	let traceStatus: string | undefined;
	try {
		traceStatus = (await inspectDebugTrace(parsed.piboSessionId, stores, { check: true })).status;
	} catch {
		traceStatus = undefined;
	}
	const failedToolCallCount = inspectDebugEvents(parsed.piboSessionId, stores.chat, { type: "tool_execution_finished", fields: ["isError", "result.status", "result.details.status"], limit: 1000 }).events.filter((event) => event.isError === true || event["result.status"] === "error" || event["result.details.status"] === "error" || event["result.details.status"] === "failed").length;
	const messageCounts = messages.reduce<Record<string, number>>((counts, message) => {
		counts[message.role] = (counts[message.role] ?? 0) + 1;
		return counts;
	}, {});
	return {
		piboSessionId: parsed.piboSessionId,
		runtimeInstanceId: session.runtimeBinding?.runtime_instance_id,
		runtimeAdapterId: session.runtimeBinding?.runtime_adapter_id,
		nativeSessionId: session.runtimeBinding?.native_session_id,
		runtimeBindingState: session.runtimeBinding?.binding_state,
		status: session.session.status,
		traceStatus,
		roomId: session.room.sessionRoomId,
		title: session.session.title,
		createdAt: session.session.created_at,
		updatedAt: session.session.updated_at,
		lastActivityAt: session.session.last_activity_at,
		messages: messageCounts,
		finalAssistant: final.message ? { available: true, bytes: final.message.contentBytes, streamId: final.message.streamId, preview: final.message.preview } : { available: false },
		toolCallCount: session.chat?.tool_call_count,
		failedToolCallCount,
		nextCommands: [
			`pibo debug final ${parsed.piboSessionId}`,
			`pibo debug failures ${parsed.piboSessionId}`,
			`pibo debug messages ${parsed.piboSessionId} list`,
			`pibo debug trace ${parsed.piboSessionId} --check`,
			`pibo debug events ${parsed.piboSessionId} --limit 20`,
		],
	};
}

export function formatDebugSummary(result: DebugSummaryResult): string {
	const lines: string[] = [];
	lines.push(`piboSessionId: ${result.piboSessionId}`);
	if (result.runtimeInstanceId !== undefined) lines.push(`runtimeInstanceId: ${result.runtimeInstanceId}`);
	if (result.runtimeAdapterId !== undefined) lines.push(`runtimeAdapterId: ${result.runtimeAdapterId}`);
	if (result.nativeSessionId !== undefined) lines.push(`nativeSessionId: ${result.nativeSessionId}`);
	if (result.runtimeBindingState !== undefined) lines.push(`runtimeBindingState: ${result.runtimeBindingState}`);
	if (result.status !== undefined) lines.push(`status: ${result.status}`);
	if (result.traceStatus) lines.push(`traceStatus: ${result.traceStatus}`);
	if (result.roomId) lines.push(`roomId: ${result.roomId}`);
	if (result.title) lines.push(`title: ${result.title}`);
	if (result.createdAt) lines.push(`createdAt: ${result.createdAt}`);
	if (result.updatedAt) lines.push(`updatedAt: ${result.updatedAt}`);
	if (result.lastActivityAt) lines.push(`lastActivityAt: ${result.lastActivityAt}`);
	lines.push(`messages: ${Object.entries(result.messages).map(([role, count]) => `${count} ${role}`).join(", ") || "0"}`);
	if (result.finalAssistant?.available) lines.push(`finalAssistant: available, ${result.finalAssistant.bytes} bytes, stream_id=${result.finalAssistant.streamId}`);
	else lines.push("finalAssistant: unavailable");
	if (result.toolCallCount !== undefined) lines.push(`toolCalls: ${result.toolCallCount}`);
	lines.push(`failures: ${result.failedToolCallCount} tool executions`);
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}
