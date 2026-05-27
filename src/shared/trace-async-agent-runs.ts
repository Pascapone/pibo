import { childTraceOrder } from "./trace-order.js";
import { flattenTraceNodes } from "./trace-nodes.js";
import { isSubagentToolName, subagentNameFromToolName } from "./trace-subagent-links.js";
import type { PiboTraceNode, PiboTraceNodeStatus } from "./trace-types.js";

export function attachAsyncAgentRunNode(
	parent: PiboTraceNode,
	piboSessionId: string,
	startedAt?: string,
	delegation?: PiboTraceNode,
): void {
	const node = createAsyncAgentRunNode(parent, piboSessionId, startedAt, delegation);
	if (!node) return;
	const existing = parent.children.find((child) => child.id === node.id);
	if (existing) {
		mergeAsyncAgentRunNode(existing, node);
		existing.runId = node.runId ?? existing.runId;
		return;
	}
	parent.children.push(node);
}

export function reconcileAsyncAgentRunStatuses(nodes: PiboTraceNode[]): void {
	const runSnapshots = new Map<string, { snapshot: Record<string, unknown>; completedAt?: string }>();
	for (const node of flattenTraceNodes(nodes)) {
		const snapshot = extractRunSnapshot(node.output);
		if (!snapshot) continue;
		const runId = stringValue(snapshot.runId);
		if (!runId) continue;
		runSnapshots.set(runId, {
			snapshot,
			completedAt: stringValue(snapshot.completedAt) ?? stringValue(snapshot.updatedAt) ?? node.completedAt,
		});
	}

	for (const node of flattenTraceNodes(nodes)) {
		if (node.type !== "agent.async" || !node.runId) continue;
		const latest = runSnapshots.get(node.runId);
		if (!latest) continue;
		const status = stringValue(latest.snapshot.status);
		if (status !== "completed" && status !== "cancelled" && status !== "failed") continue;
		node.status = status === "failed" ? "error" : "done";
		node.completedAt = latest.completedAt ?? node.completedAt;
		node.output = latest.snapshot;
		if (status === "failed") node.error = stringValue(latest.snapshot.summary) ?? node.error;
	}
}

function createAsyncAgentRunNode(
	parent: PiboTraceNode,
	piboSessionId: string,
	startedAt?: string,
	delegation?: PiboTraceNode,
): PiboTraceNode | undefined {
	if (!isRunStartToolNode(parent)) return undefined;

	const run = extractRunSnapshot(parent.output);
	const input = isRecord(parent.input) ? parent.input : {};
	const toolName = stringValue(run?.toolName) ?? stringValue(input.toolName) ?? delegation?.title;
	if (!toolName || !isSubagentToolName(toolName)) return undefined;

	const subagentName = stringValue(delegation?.summary) ?? subagentNameFromToolName(toolName);
	const runId = stringValue(run?.runId);
	const runStatus = stringValue(run?.status);
	const delegatedArguments = input.arguments;
	const completionPolicy = stringValue(run?.completionPolicy) ?? stringValue(input.completionPolicy);

	return {
		id: `${parent.id}:async-agent`,
		parentId: parent.id,
		piboSessionId,
		eventId: parent.eventId,
		toolCallId: parent.toolCallId,
		runId,
		type: "agent.async",
		title: subagentName,
		status: asyncAgentStatus(parent, runStatus),
		startedAt: delegation?.startedAt ?? startedAt ?? parent.startedAt,
		completedAt: runStatus === "completed" || runStatus === "cancelled" ? parent.completedAt : undefined,
		summary: `Started by ${parent.title}`,
		input: {
			startedBy: parent.title,
			startToolCallId: parent.toolCallId,
			toolName,
			subagentName,
			runId,
			completionPolicy,
			arguments: delegatedArguments,
			threadKey: isRecord(delegation?.input) ? delegation.input.threadKey : undefined,
		},
		output: run,
		error: parent.error,
		linkedPiboSessionId: delegation?.linkedPiboSessionId ?? parent.linkedPiboSessionId,
		source: parent.source,
		stableKey: runId ? `async-agent:${runId}` : `${parent.stableKey ?? parent.id}:async-agent`,
		orderKey: childTraceOrder(parent.orderKey, "agent.async"),
		children: [],
	};
}

export function isRunStartToolNode(node: PiboTraceNode): boolean {
	return node.type === "tool.call" && node.title === "pibo_run_start";
}

function mergeAsyncAgentRunNode(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
	target.linkedPiboSessionId = update.linkedPiboSessionId ?? target.linkedPiboSessionId;
}

function extractRunSnapshot(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	if (isRunSnapshot(value)) return value;
	if (isRecord(value.details) && isRunSnapshot(value.details)) return value.details;
	return undefined;
}

function isRunSnapshot(value: Record<string, unknown>): boolean {
	return typeof value.runId === "string" && typeof value.toolName === "string";
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asyncAgentStatus(parent: PiboTraceNode, runStatus?: string): PiboTraceNodeStatus {
	if (parent.status === "error" || runStatus === "failed") return "error";
	if (runStatus === "completed" || runStatus === "cancelled") return "done";
	return "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
