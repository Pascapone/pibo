import { randomUUID } from "node:crypto";
import type { PiboChannelContext } from "../../channels/types.js";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../../core/events.js";
import type { PiboSession } from "../../sessions/store.js";
import type { WorkflowDraftDiagnostic } from "./workflow-persistence.js";

export type WorkflowManualTriggerNodeAttempt = {
	id: string;
	workflowRunId: string;
	nodeId: string;
	kind: "trigger" | "agent";
	status: "completed" | "failed";
	input: string;
	output?: string;
	piboSessionId?: string;
	startedAt: string;
	completedAt?: string;
	failedAt?: string;
	error?: { code: string; message: string };
};

export type WorkflowManualTriggerEdgeTransfer = {
	id: string;
	workflowRunId: string;
	edgeId: string;
	sourceNodeAttemptId: string;
	targetNodeId: string;
	status: "transferred";
	payload: string;
	createdAt: string;
};

export type WorkflowManualTriggerRun = {
	id: string;
	workflowId: string;
	workflowVersion: string;
	status: "completed" | "failed";
	triggerNodeId: string;
	input: string;
	output?: string;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
	failedAt?: string;
};

export type WorkflowManualTriggerRunResult = {
	ok: boolean;
	run?: WorkflowManualTriggerRun;
	nodeAttempts: WorkflowManualTriggerNodeAttempt[];
	edgeTransfers: WorkflowManualTriggerEdgeTransfer[];
	diagnostics: WorkflowDraftDiagnostic[];
	output?: string;
	error?: { code: string; message: string };
};

export type WorkflowManualTriggerRuntimeOptions = {
	definition: PiboJsonObject;
	triggerNodeId: string;
	input: string;
	actorId?: string;
	draftId?: string;
	channelContext: PiboChannelContext;
	channel: string;
	defaultWorkspace: string;
	onSessionCreated?: (session: PiboSession) => void;
	resolveProfile: (profileId: string) => string | undefined;
};

type PendingAgentInput = { nodeId: string; input: string; viaEdgeId: string; sourceAttemptId: string };

export async function runWorkflowManualTextTrigger(options: WorkflowManualTriggerRuntimeOptions): Promise<WorkflowManualTriggerRunResult> {
	const diagnostics = validateWorkflowManualTextTrigger(options.definition, options.triggerNodeId, options.input, options.resolveProfile);
	if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
		return { ok: false, nodeAttempts: [], edgeTransfers: [], diagnostics, error: { code: "WorkflowRuntimeError.manualTriggerRunBlocked", message: "Manual trigger run was blocked by validation errors." } };
	}

	const now = new Date().toISOString();
	const workflowId = stringValue(options.definition.id) || "workflow";
	const workflowVersion = stringValue(options.definition.version) || "draft";
	const run: WorkflowManualTriggerRun = {
		id: `wfr_${randomUUID()}`,
		workflowId,
		workflowVersion,
		status: "completed",
		triggerNodeId: options.triggerNodeId,
		input: options.input,
		createdAt: now,
		updatedAt: now,
	};
	const nodeAttempts: WorkflowManualTriggerNodeAttempt[] = [];
	const edgeTransfers: WorkflowManualTriggerEdgeTransfer[] = [];
	const triggerAttempt: WorkflowManualTriggerNodeAttempt = {
		id: `wna_${randomUUID()}`,
		workflowRunId: run.id,
		nodeId: options.triggerNodeId,
		kind: "trigger",
		status: "completed",
		input: options.input,
		output: options.input,
		startedAt: now,
		completedAt: now,
	};
	nodeAttempts.push(triggerAttempt);

	const queue: PendingAgentInput[] = [];
	enqueueOutgoingEdges(options.definition, run.id, triggerAttempt, queue, edgeTransfers);
	const executedNodes = new Set<string>();
	let lastOutput = options.input;

	while (queue.length) {
		const pending = queue.shift()!;
		if (executedNodes.has(pending.nodeId)) {
			const failedAt = new Date().toISOString();
			run.status = "failed";
			run.failedAt = failedAt;
			run.updatedAt = failedAt;
			return {
				ok: false,
				run,
				nodeAttempts,
				edgeTransfers,
				diagnostics: [{
					code: "WorkflowRuntimeError.joinUnsupported",
					message: `Workflow node '${pending.nodeId}' received more than one input, but manual trigger V1 does not support joins yet.`,
					severity: "error",
					nodeId: pending.nodeId,
					edgeId: pending.viaEdgeId,
					path: `$.edges.${pending.viaEdgeId}`,
				}],
				error: { code: "WorkflowRuntimeError.joinUnsupported", message: "Manual trigger run failed because a join node was reached." },
			};
		}
		executedNodes.add(pending.nodeId);

		const result = await runAgentNode({ ...options, runId: run.id, nodeId: pending.nodeId, input: pending.input });
		nodeAttempts.push(result.attempt);
		if (!result.ok) {
			const failedAt = new Date().toISOString();
			run.status = "failed";
			run.failedAt = failedAt;
			run.updatedAt = failedAt;
			return { ok: false, run, nodeAttempts, edgeTransfers, diagnostics: result.diagnostics, error: result.attempt.error };
		}
		lastOutput = result.output;
		enqueueOutgoingEdges(options.definition, run.id, result.attempt, queue, edgeTransfers);
	}

	const completedAt = new Date().toISOString();
	run.output = lastOutput;
	run.completedAt = completedAt;
	run.updatedAt = completedAt;
	return { ok: true, run, nodeAttempts, edgeTransfers, diagnostics, output: lastOutput };
}

export function validateWorkflowManualTextTrigger(definition: PiboJsonObject, triggerNodeId: string, input: string, resolveProfile: (profileId: string) => string | undefined): WorkflowDraftDiagnostic[] {
	const diagnostics: WorkflowDraftDiagnostic[] = [];
	const nodes = objectValue(definition.nodes);
	const edges = objectValue(definition.edges);
	const trigger = objectValue(nodes?.[triggerNodeId]);
	if (!trigger) {
		diagnostics.push({ code: "WorkflowRuntimeError.unknownTriggerNode", message: `Manual trigger node '${triggerNodeId}' does not exist.`, severity: "error", nodeId: triggerNodeId, path: `$.nodes.${triggerNodeId}` });
		return diagnostics;
	}
	if (trigger.kind !== "trigger") diagnostics.push({ code: "WorkflowRuntimeError.triggerNodeRequired", message: `Workflow node '${triggerNodeId}' is not a trigger node.`, severity: "error", nodeId: triggerNodeId, path: `$.nodes.${triggerNodeId}.kind` });
	const triggerConfig = objectValue(trigger.trigger);
	if (triggerConfig?.kind !== "manual") diagnostics.push({ code: "WorkflowRuntimeError.manualTriggerRequired", message: `Workflow trigger node '${triggerNodeId}' must use manual trigger kind.`, severity: "error", nodeId: triggerNodeId, path: `$.nodes.${triggerNodeId}.trigger.kind` });
	if (objectValue(trigger.output)?.kind !== "text") diagnostics.push({ code: "WorkflowRuntimeError.textTriggerOutputRequired", message: `Workflow trigger node '${triggerNodeId}' must declare a text output port.`, severity: "error", nodeId: triggerNodeId, path: `$.nodes.${triggerNodeId}.output` });
	if (typeof input !== "string") diagnostics.push({ code: "WorkflowInterfaceError.textValueExpected", message: "Manual trigger input must be text.", severity: "error", path: "$.input" });

	for (const [edgeId, rawEdge] of Object.entries(edges ?? {})) {
		const edge = objectValue(rawEdge);
		if (!edge) continue;
		if (edge.guard) diagnostics.push({ code: "WorkflowRuntimeError.edgeGuardUnsupported", message: `Workflow edge '${edgeId}' uses a guard, which manual trigger V1 does not execute yet.`, severity: "error", edgeId, path: `$.edges.${edgeId}.guard` });
		if (edge.adapter) diagnostics.push({ code: "WorkflowRuntimeError.edgeAdapterUnsupported", message: `Workflow edge '${edgeId}' uses an adapter, which manual trigger V1 does not execute yet.`, severity: "error", edgeId, path: `$.edges.${edgeId}.adapter` });
		const from = objectValue(edge.from);
		const to = objectValue(edge.to);
		const source = typeof from?.nodeId === "string" ? objectValue(nodes?.[from.nodeId]) : undefined;
		const targetNodeId = typeof to?.nodeId === "string" ? to.nodeId : "";
		const target = targetNodeId ? objectValue(nodes?.[targetNodeId]) : undefined;
		if (!source || !target) continue;
		if (source.kind !== "trigger" && source.kind !== "agent") continue;
		if (target.kind !== "agent") diagnostics.push({ code: "WorkflowRuntimeError.agentTargetRequired", message: `Workflow edge '${edgeId}' targets a non-agent node, which manual trigger V1 does not execute yet.`, severity: "error", edgeId, nodeId: targetNodeId, path: `$.edges.${edgeId}.to.nodeId` });
		const sourceOutput = objectValue(source.output);
		const targetInput = objectValue(target.input);
		if (sourceOutput?.kind && targetInput?.kind && (sourceOutput.kind !== "text" || targetInput.kind !== "text")) {
			diagnostics.push({ code: "WorkflowGraphError.incompatibleEdgePorts", message: `Workflow edge '${edgeId}' must connect text output to text input for manual trigger V1.`, severity: "error", edgeId, path: `$.edges.${edgeId}` });
		}
		if (target.kind === "agent") {
			const profile = objectValue(target.profile);
			const profileId = typeof profile?.id === "string" ? profile.id : "";
			if (!profileId || !resolveProfile(profileId)) diagnostics.push({ code: "WorkflowRuntimeError.unknownAgentProfile", message: `Agent node '${targetNodeId}' references unavailable profile '${profileId || "<missing>"}'.`, severity: "error", nodeId: targetNodeId, path: `$.nodes.${targetNodeId}.profile.id` });
		}
	}
	return diagnostics;
}

function enqueueOutgoingEdges(definition: PiboJsonObject, runId: string, sourceAttempt: WorkflowManualTriggerNodeAttempt, queue: PendingAgentInput[], transfers: WorkflowManualTriggerEdgeTransfer[]): void {
	const edges = objectValue(definition.edges) ?? {};
	for (const [edgeId, rawEdge] of Object.entries(edges).sort(([left], [right]) => left.localeCompare(right))) {
		const edge = objectValue(rawEdge);
		const from = objectValue(edge?.from);
		const to = objectValue(edge?.to);
		if (from?.nodeId !== sourceAttempt.nodeId || typeof to?.nodeId !== "string") continue;
		const payload = sourceAttempt.output ?? "";
		transfers.push({ id: `wet_${randomUUID()}`, workflowRunId: runId, edgeId, sourceNodeAttemptId: sourceAttempt.id, targetNodeId: to.nodeId, status: "transferred", payload, createdAt: new Date().toISOString() });
		queue.push({ nodeId: to.nodeId, input: payload, viaEdgeId: edgeId, sourceAttemptId: sourceAttempt.id });
	}
}

async function runAgentNode(options: WorkflowManualTriggerRuntimeOptions & { runId: string; nodeId: string; input: string }): Promise<{ ok: true; attempt: WorkflowManualTriggerNodeAttempt; output: string } | { ok: false; attempt: WorkflowManualTriggerNodeAttempt; diagnostics: WorkflowDraftDiagnostic[] }> {
	const startedAt = new Date().toISOString();
	const node = objectValue(objectValue(options.definition.nodes)?.[options.nodeId]) ?? {};
	const profileId = stringValue(objectValue(node.profile)?.id) || "base";
	const resolvedProfile = options.resolveProfile(profileId) ?? profileId;
	const attempt: WorkflowManualTriggerNodeAttempt = { id: `wna_${randomUUID()}`, workflowRunId: options.runId, nodeId: options.nodeId, kind: "agent", status: "completed", input: options.input, startedAt };
	try {
		const session = options.channelContext.createSession({
			channel: options.channel,
			kind: "workflow-agent",
			profile: resolvedProfile,
			workspace: options.defaultWorkspace,
			title: `${stringValue(options.definition.id) || "Workflow"} · ${stringValue(node.label) || options.nodeId}`,
			metadata: {
				workflowRunId: options.runId,
				workflowRunSource: "manual.editor",
				...(options.draftId ? { workflowDraftId: options.draftId } : {}),
				workflowTriggerNodeId: options.triggerNodeId,
				workflowNodeId: options.nodeId,
				workflowNodeAttemptId: attempt.id,
				workflowNodeLabel: stringValue(node.label) || options.nodeId,
				...(options.actorId ? { actorId: options.actorId } : {}),
			},
		});
		options.onSessionCreated?.(session);
		attempt.piboSessionId = session.id;
		const prompt = renderPromptTemplate(stringValue(node.promptTemplate) || "{{input}}", options.input);
		const output = await emitMessageAndWaitForAssistant(options.channelContext, session.id, prompt);
		attempt.output = output;
		attempt.completedAt = new Date().toISOString();
		return { ok: true, attempt, output };
	} catch (error) {
		attempt.status = "failed";
		attempt.failedAt = new Date().toISOString();
		attempt.error = { code: "WorkflowRuntimeError.agentNodeFailed", message: error instanceof Error ? error.message : "Agent node failed with a non-Error value." };
		return { ok: false, attempt, diagnostics: [{ code: attempt.error.code, message: attempt.error.message, severity: "error", nodeId: options.nodeId, path: `$.nodes.${options.nodeId}` }] };
	}
}

function emitMessageAndWaitForAssistant(channelContext: PiboChannelContext, piboSessionId: string, text: string, timeoutMs = 120000): Promise<string> {
	return new Promise((resolve, reject) => {
		const eventId = `wfm_${randomUUID()}`;
		let settled = false;
		let timeout: ReturnType<typeof setTimeout>;
		let unsubscribe = () => {};
		const finish = (value: string | Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			unsubscribe();
			if (value instanceof Error) reject(value);
			else resolve(value);
		};
		timeout = setTimeout(() => finish(new Error(`Timed out waiting for assistant reply from workflow agent session '${piboSessionId}'.`)), timeoutMs);
		unsubscribe = channelContext.subscribe((event: PiboOutputEvent) => {
			if (event.piboSessionId !== piboSessionId) return;
			if (event.type === "assistant_message") {
				if (event.eventId === eventId) finish(event.text);
				return;
			}
			if (event.type === "session_error" && event.eventId === eventId) finish(new Error(event.error));
		});
		channelContext.emit({ type: "message", piboSessionId, id: eventId, text, source: "actor" }).catch(finish);
	});
}

function renderPromptTemplate(template: string, input: string): string {
	return template.replace(/{{\s*input\s*}}/g, input);
}

function objectValue(value: unknown): PiboJsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as PiboJsonObject : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
