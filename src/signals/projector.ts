import type { PiboRunStatus } from "../runs/registry.js";
import { isActiveSignalStatus, isTerminalSignalStatus } from "./aggregate.js";
import type {
	PiboSignalInput,
	PiboSignalMutation,
	PiboSignalNode,
	PiboSignalProducer,
	PiboSignalProjectorContext,
	PiboSignalStatus,
} from "./types.js";

function node(input: Omit<PiboSignalNode, "createdAt" | "updatedAt" | "rootPiboSessionId"> & { rootPiboSessionId?: string }, context: PiboSignalProjectorContext): PiboSignalNode {
	const existing = context.getNode(input.id);
	const timestamp = context.now();
	return {
		...input,
		rootPiboSessionId: input.rootPiboSessionId ?? (input.piboSessionId ? context.getSessionRoot(input.piboSessionId) : input.id),
		createdAt: existing?.createdAt ?? timestamp,
		updatedAt: timestamp,
	};
}

function runStatus(status: PiboRunStatus): PiboSignalStatus {
	if (status === "completed") return "done";
	if (status === "failed") return "error";
	return status;
}

function settleActiveSessionNodes(
	piboSessionId: string,
	context: PiboSignalProjectorContext,
	status: "done" | "error" | "cancelled" | "interrupted",
	terminalSource: "message_finished" | "session_error" | "session_interrupted" | "session_disposed" | "processing_stopped",
): PiboSignalMutation[] {
	return context.getSessionNodes(piboSessionId)
		.filter((node) => node.kind !== "session" && node.kind !== "yielded_run" && isActiveSignalStatus(node.status))
		.filter((node) => terminalSource !== "processing_stopped" || node.kind !== "turn" || node.metadata?.accepted !== true)
		.map((node) => ({
			type: "patch_node",
			nodeId: node.id,
			patch: { status, completedAt: context.now(), metadata: { ...node.metadata, terminalSource } },
		}));
}

export const sessionLifecycleSignalProducer: PiboSignalProducer = {
	name: "session-lifecycle",
	accepts: (input) => ["session_created", "session_disposed", "session_processing_changed", "message_accepted", "queue_changed", "recovery", "session_interrupted", "signal_node_pruned"].includes(input.type),
	project(input, context) {
		const data = input as any;
		if (data.type === "session_created") {
			const session = data.session;
			if (context.getNode(`session:${session.id}`)) return [];
			return [{ type: "upsert_node", node: node({
				id: `session:${session.id}`,
				kind: "session",
				status: "idle",
				piboSessionId: session.id,
				parentPiboSessionId: session.parentId,
				metadata: { kind: session.kind, channel: session.channel, profile: session.profile },
			}, context) }];
		}
		if (data.type === "message_accepted") {
			const activeTurn = context.getSessionNodes(data.piboSessionId)
				.find((candidate) => candidate.kind === "turn" && isActiveSignalStatus(candidate.status));
			const mutations: PiboSignalMutation[] = [
				{ type: "patch_node", nodeId: `session:${data.piboSessionId}`, patch: { status: "running" } },
				{
					type: "upsert_node",
					node: node({
						id: `message:${data.piboSessionId}:${data.eventId}`,
						kind: "message",
						status: "queued",
						piboSessionId: data.piboSessionId,
						metadata: { source: data.source },
					}, context),
				},
			];
			if (!activeTurn) {
				mutations.push({
					type: "upsert_node",
					node: node({
						id: `turn:${data.piboSessionId}:${data.eventId}`,
						kind: "turn",
						status: "starting",
						piboSessionId: data.piboSessionId,
						startedAt: context.now(),
						metadata: { eventId: data.eventId, source: data.source, accepted: true },
					}, context),
				});
			}
			return mutations;
		}
		if (data.type === "session_disposed") {
			return [
				...settleActiveSessionNodes(data.piboSessionId, context, "cancelled", "session_disposed"),
				{ type: "patch_node", nodeId: `session:${data.piboSessionId}`, patch: { status: "disposed", completedAt: context.now(), metadata: { reason: data.reason } } },
			];
		}
		if (data.type === "session_interrupted") {
			return [
				...settleActiveSessionNodes(data.piboSessionId, context, "interrupted", "session_interrupted"),
				{ type: "patch_node", nodeId: `session:${data.piboSessionId}`, patch: { status: "interrupted", completedAt: context.now(), metadata: { reason: data.reason } } },
			];
		}
		if (data.type === "session_processing_changed") {
			const existing = context.getNode(`session:${data.piboSessionId}`);
			const status = existing && isTerminalSignalStatus(existing.status) ? existing.status : data.processing ? "running" : "idle";
			return [
				{ type: "patch_node", nodeId: `session:${data.piboSessionId}`, patch: { status } },
				{ type: "set_session_queue", piboSessionId: data.piboSessionId, queuedMessages: data.queuedMessages },
				...(data.processing ? [] : settleActiveSessionNodes(data.piboSessionId, context, "interrupted", "processing_stopped")),
			];
		}
		if (data.type === "queue_changed") {
			return [
				{ type: "set_session_queue", piboSessionId: data.piboSessionId, queuedMessages: data.queuedMessages },
				{ type: "upsert_node", node: node({ id: `queue:${data.piboSessionId}`, kind: "queue", status: data.queuedMessages > 0 ? "queued" : "idle", piboSessionId: data.piboSessionId, metadata: { queuedMessages: data.queuedMessages } }, context) },
			];
		}
		if (data.type === "recovery") {
			return [{ type: "patch_node", nodeId: `session:${data.piboSessionId}`, patch: { status: "unknown", metadata: { reason: data.reason } } }];
		}
		if (data.type === "signal_node_pruned") {
			return [{ type: "remove_node", nodeId: data.nodeId }];
		}
		return [];
	},
};

export const outputSignalProducer: PiboSignalProducer = {
	name: "pibo-output",
	accepts: (input) => input.type === "pibo_output",
	project(input, context) {
		const data = input as any;
		if (data.type !== "pibo_output") return [];
		const event = data.event;
		const piboSessionId = event.piboSessionId;
		const mutations: PiboSignalMutation[] = [];
		const eventTurn = event.eventId ? context.getNode(`turn:${piboSessionId}:${event.eventId}`) : undefined;
		const explicitTerminalAfterFallback = eventTurn?.metadata?.terminalSource === "processing_stopped"
			&& (event.type === "message_finished" || event.type === "session_error");
		if (eventTurn && isTerminalSignalStatus(eventTurn.status) && !explicitTerminalAfterFallback) return [];
		if (event.type === "message_queued") {
			mutations.push({ type: "set_session_queue", piboSessionId, queuedMessages: event.queuedMessages });
			mutations.push({ type: "upsert_node", node: node({ id: `message:${piboSessionId}:${event.eventId ?? context.now()}`, kind: "message", status: "queued", piboSessionId, metadata: { source: event.source } }, context) });
		}
		if (event.type === "message_started") {
			mutations.push({ type: "patch_node", nodeId: `session:${piboSessionId}`, patch: { status: "running" } });
			if (event.eventId) {
				mutations.push({ type: "patch_node", nodeId: `message:${piboSessionId}:${event.eventId}`, patch: { status: "done", completedAt: context.now() } });
				mutations.push({ type: "upsert_node", node: node({ id: `turn:${piboSessionId}:${event.eventId}`, kind: "turn", status: "running", piboSessionId, startedAt: eventTurn?.startedAt ?? context.now(), metadata: { eventId: event.eventId, source: event.source } }, context) });
			}
		}
		if (event.type === "assistant_delta") {
			mutations.push({ type: "upsert_node", node: node({ id: `assistant_stream:${piboSessionId}:${event.eventId ?? "current"}:${event.assistantIndex ?? 0}`, kind: "assistant_stream", status: "streaming", piboSessionId, parentNodeId: event.eventId ? `turn:${piboSessionId}:${event.eventId}` : undefined }, context) });
		}
		if (event.type === "assistant_message") {
			mutations.push({ type: "patch_node", nodeId: `assistant_stream:${piboSessionId}:${event.eventId ?? "current"}:${event.assistantIndex ?? 0}`, patch: { status: "done", completedAt: context.now() } });
		}
		if (event.type === "thinking_started" || event.type === "thinking_delta") {
			mutations.push({ type: "upsert_node", node: node({ id: `thinking_stream:${piboSessionId}:${event.eventId ?? "current"}:${event.thinkingIndex ?? 0}`, kind: "thinking_stream", status: "streaming", piboSessionId, parentNodeId: event.eventId ? `turn:${piboSessionId}:${event.eventId}` : undefined }, context) });
		}
		if (event.type === "thinking_finished") {
			mutations.push({ type: "patch_node", nodeId: `thinking_stream:${piboSessionId}:${event.eventId ?? "current"}:${event.thinkingIndex ?? 0}`, patch: { status: "done", completedAt: context.now() } });
		}
		if (event.type === "tool_call" || event.type === "tool_execution_started" || event.type === "tool_execution_updated") {
			mutations.push({ type: "upsert_node", node: node({ id: `tool:${piboSessionId}:${event.toolCallId}`, kind: "tool_call", status: event.type === "tool_call" ? "starting" : "running", piboSessionId, parentNodeId: event.eventId ? `turn:${piboSessionId}:${event.eventId}` : undefined, metadata: { toolCallId: event.toolCallId, toolName: event.toolName, argsComplete: event.type === "tool_call" ? event.argsComplete : undefined } }, context) });
		}
		if (event.type === "tool_execution_finished") {
			mutations.push({ type: "patch_node", nodeId: `tool:${piboSessionId}:${event.toolCallId}`, patch: { status: event.isError ? "error" : "done", completedAt: context.now(), error: event.isError ? { message: "Tool execution failed.", source: "tool" } : undefined, metadata: { toolCallId: event.toolCallId, toolName: event.toolName } } });
		}
		if (event.type === "subagent_session") {
			mutations.push({ type: "upsert_node", node: node({ id: `subagent:${piboSessionId}:${event.childPiboSessionId}`, kind: "subagent_session", status: "running", piboSessionId, parentNodeId: event.toolCallId ? `tool:${piboSessionId}:${event.toolCallId}` : undefined, parentPiboSessionId: piboSessionId, childPiboSessionId: event.childPiboSessionId, metadata: { toolName: event.toolName, subagentName: event.subagentName, threadKey: event.threadKey } }, context) });
		}
		if (event.type === "compaction_start") {
			mutations.push({ type: "upsert_node", node: node({ id: `compaction:${piboSessionId}:${event.reason}`, kind: "compaction", status: "compacting", piboSessionId, metadata: { reason: event.reason } }, context) });
		}
		if (event.type === "compaction_end") {
			mutations.push({ type: "patch_node", nodeId: `compaction:${piboSessionId}:${event.reason}`, patch: { status: event.aborted ? "cancelled" : event.errorMessage ? "error" : "done", completedAt: context.now(), error: event.errorMessage ? { message: event.errorMessage, source: "pi" } : undefined } });
		}
		if (event.type === "message_finished") {
			const existingSession = context.getNode(`session:${piboSessionId}`);
			if (!existingSession || !isTerminalSignalStatus(existingSession.status)) {
				mutations.push({ type: "patch_node", nodeId: `session:${piboSessionId}`, patch: { status: "idle" } });
			}
			if (event.eventId) {
				mutations.push({ type: "patch_node", nodeId: `message:${piboSessionId}:${event.eventId}`, patch: { status: "done", completedAt: context.now() } });
				mutations.push({ type: "patch_node", nodeId: `turn:${piboSessionId}:${event.eventId}`, patch: { status: "done", completedAt: context.now(), metadata: { ...eventTurn?.metadata, terminalSource: "message_finished" } } });
			}
			mutations.push(...settleActiveSessionNodes(piboSessionId, context, "done", "message_finished"));
		}
		if (event.type === "session_error") {
			mutations.push({ type: "set_session_queue", piboSessionId, queuedMessages: 0 });
			mutations.push(...settleActiveSessionNodes(piboSessionId, context, "error", "session_error"));
			mutations.push({ type: "patch_node", nodeId: `session:${piboSessionId}`, patch: { status: "error", completedAt: context.now(), error: { message: event.error, source: "pi" } } });
			if (event.eventId) {
				mutations.push({ type: "patch_node", nodeId: `message:${piboSessionId}:${event.eventId}`, patch: { status: "error", completedAt: context.now(), error: { message: event.error, source: "pi" } } });
				mutations.push({ type: "patch_node", nodeId: `turn:${piboSessionId}:${event.eventId}`, patch: { status: "error", completedAt: context.now(), error: { message: event.error, source: "pi" }, metadata: { ...eventTurn?.metadata, terminalSource: "session_error" } } });
			}
		}
		return mutations;
	},
};

export const runSignalProducer: PiboSignalProducer = {
	name: "runs",
	accepts: (input) => input.type === "run_changed" || input.type === "run_removed",
	project(input, context) {
		const data = input as any;
		if (data.type === "run_removed") return [{ type: "remove_node", nodeId: `run:${data.runId}` }];
		if (data.type !== "run_changed") return [];
		const run = data.run;
		return [{ type: "upsert_node", node: node({ id: `run:${run.runId}`, kind: "yielded_run", status: runStatus(run.status), piboSessionId: run.controllerPiboSessionId, startedAt: run.createdAt, completedAt: run.completedAt, error: run.status === "failed" ? { message: run.summary ?? "Run failed.", source: "run" } : undefined, metadata: { runId: run.runId, toolName: run.toolName, completionPolicy: run.completionPolicy, consumed: run.consumed, summary: run.summary, previousStatus: data.previousStatus, reason: data.reason } }, context) }];
	},
};

export function createDefaultSignalProducers(): PiboSignalProducer[] {
	return [sessionLifecycleSignalProducer, outputSignalProducer, runSignalProducer];
}
