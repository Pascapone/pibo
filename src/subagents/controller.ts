import { randomUUID } from "node:crypto";
import type { PiboMessageProvenance } from "../core/events.js";
import type { SubagentProfile } from "../core/profiles.js";
import { withPiboSessionModelFallbacksMetadata } from "../core/session-model.js";
import {
	PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE,
	type PluginActiveChildRequestSettlement,
	type PluginChildSessionOrchestration,
	type PluginSessionServiceAccessor,
} from "../plugins/runtime.js";
import { withWorkflowSessionKind } from "../sessions/workflow-session-kind.js";
import {
	piboAgentObservationCursorScopeKey,
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "./observation-query.js";
import {
	piboAgentObservationDetails,
	piboAgentObservationKind,
	piboAgentObservationRole,
	piboAgentObservationSourceFromEvent,
	piboAgentObservationText,
} from "./observations.js";
import {
	normalizePiboAgentSessionName,
	type PiboAgentObservation,
	type PiboAgentsController,
	type PiboManagedAgent,
} from "./tool.js";

export const PIBO_DELEGATION_SEND_TOOL_NAME = "pibo_agents_send_message";

const DEFAULT_SUBAGENT_MAX_DEPTH = 1;
const MAX_SUBAGENT_THREAD_KEY_BYTES = 512;
const CHILD_CHANNEL = "pibo.subagents";
const CHILD_KIND = "subagent";

function delegationAbortError(): Error {
	const error = new Error("Subagent request was aborted.");
	error.name = "AbortError";
	return error;
}

function loopIds(provenance: PiboMessageProvenance | undefined): { loopJobId?: string; loopRunId?: string } {
	if (provenance?.kind === "loop-run") return { loopJobId: provenance.jobId, loopRunId: provenance.runId };
	if (provenance?.kind === "subagent-request") return { loopJobId: provenance.loopJobId, loopRunId: provenance.loopRunId };
	return {};
}

function resolveThreadKey(threadKey: string | undefined): string {
	const normalized = threadKey?.trim();
	if (!normalized) return randomUUID();
	if (Buffer.byteLength(normalized, "utf8") > MAX_SUBAGENT_THREAD_KEY_BYTES) {
		throw new Error(`Subagent thread key exceeds ${MAX_SUBAGENT_THREAD_KEY_BYTES} bytes.`);
	}
	return normalized;
}

function queryFor(parentPiboSessionId: string) {
	return { parentPiboSessionId, channel: CHILD_CHANNEL, kind: CHILD_KIND } as const;
}

function createDelegatedSession(
	host: PluginChildSessionOrchestration,
	parentPiboSessionId: string,
	subagent: SubagentProfile,
	sessionName: string,
	threadKey: string | undefined,
) {
	const maxDepth = subagent.maxDepth ?? DEFAULT_SUBAGENT_MAX_DEPTH;
	if (host.getDepth(parentPiboSessionId) >= maxDepth) {
		throw new Error(`Subagent "${subagent.name}" exceeded max depth ${maxDepth} from Pibo session "${parentPiboSessionId}"`);
	}
	const resolvedThreadKey = resolveThreadKey(threadKey);
	const identityMetadata = {
		subagentName: subagent.name,
		threadKey: resolvedThreadKey,
	};
	const metadata = withPiboSessionModelFallbacksMetadata(withWorkflowSessionKind({
		...identityMetadata,
		subagentToolName: PIBO_DELEGATION_SEND_TOOL_NAME,
		agentStatus: "active",
		...(subagent.thinkingLevel ? { initialThinkingLevel: subagent.thinkingLevel } : {}),
		...(subagent.runtimeOptions && Object.keys(subagent.runtimeOptions).length > 0
			? { initialRuntimeOptions: structuredClone(subagent.runtimeOptions) }
			: {}),
	}, CHILD_KIND), subagent.modelFallbacks ?? []);
	return host.resolveChildSession({
		...queryFor(parentPiboSessionId),
		profile: subagent.targetProfile,
		title: sessionName,
		identityMetadata,
		metadata,
		reuseMetadata: withWorkflowSessionKind({
			subagentToolName: PIBO_DELEGATION_SEND_TOOL_NAME,
			agentStatus: "active",
		}, CHILD_KIND),
		excludeMetadata: { agentStatus: "killed" },
		...(subagent.model ? { activeModel: subagent.model } : {}),
	});
}

function listAgents(host: PluginChildSessionOrchestration, parentPiboSessionId: string): PiboManagedAgent[] {
	return host.listChildSessions(queryFor(parentPiboSessionId)).map(({ session, liveStatus }) => {
		const killed = session.metadata?.agentStatus === "killed";
		const running = !killed && Boolean(liveStatus && (liveStatus.processing || liveStatus.streaming || liveStatus.queuedMessages > 0));
		return {
			agentId: session.id,
			name: typeof session.metadata?.subagentName === "string" ? session.metadata.subagentName : session.profile,
			profile: session.profile,
			...(session.title ? { sessionName: session.title } : {}),
			...(typeof session.metadata?.threadKey === "string" ? { threadKey: session.metadata.threadKey } : {}),
			status: killed ? "killed" : running ? "running" : "idle",
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			...(session.activeModel ? { activeModel: { ...session.activeModel } } : {}),
		};
	});
}

function observeAgents(
	host: PluginChildSessionOrchestration,
	parentPiboSessionId: string,
	input: Parameters<PiboAgentsController["observe"]>[0],
): ReturnType<PiboAgentsController["observe"]> {
	for (const agentId of input.agentIds ?? []) {
		host.requireChildSession({ ...queryFor(parentPiboSessionId), childPiboSessionId: agentId });
	}
	const baseQuery = preparePiboAgentObservationQuery(input);
	const cursorScope = piboAgentObservationCursorScopeKey(baseQuery.filters);
	const explicitAfterSequence = input.afterSequence !== undefined;
	const savedAfterSequence = baseQuery.cursorMode === "auto" && !explicitAfterSequence
		? host.getObservationCursor(parentPiboSessionId, cursorScope)
		: undefined;
	const query = savedAfterSequence === undefined
		? baseQuery
		: preparePiboAgentObservationQuery({ ...input, afterSequence: savedAfterSequence });
	const source = host.readChildOutputs(parentPiboSessionId);
	function* ordered(): IterableIterator<PiboAgentObservation> {
		const records = source.records;
		const start = query.scanOrder === "asc" ? 0 : records.length - 1;
		const end = query.scanOrder === "asc" ? records.length : -1;
		const step = query.scanOrder === "asc" ? 1 : -1;
		for (let index = start; index !== end; index += step) {
			const record = records[index]!;
			const event = record.event;
			const session = record.childSession;
			const observationSource = piboAgentObservationSourceFromEvent(event);
			const role = piboAgentObservationRole(observationSource);
			const text = piboAgentObservationText(observationSource);
			yield {
				sequence: record.sequence,
				createdAt: record.createdAt,
				...(record.requestId ? { requestId: record.requestId } : {}),
				agentId: session.id,
				name: typeof session.metadata?.subagentName === "string" ? session.metadata.subagentName : session.profile,
				...(typeof session.metadata?.threadKey === "string" ? { threadKey: session.metadata.threadKey } : {}),
				eventType: event.type,
				kind: piboAgentObservationKind(event.type),
				...(role ? { role } : {}),
				...(text ? { text } : {}),
				...("toolName" in event && typeof event.toolName === "string" ? { toolName: event.toolName } : {}),
				...("toolCallId" in event && typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}),
				...(event.type === "tool_execution_finished" ? { isError: event.isError } : event.type === "session_error" ? { isError: true } : {}),
				details: piboAgentObservationDetails(event),
			};
		}
	}
	const page = selectPiboAgentObservationPage(ordered(), query, { evictedThrough: source.evictedThroughSequence });
	if (query.cursorMode === "history") return page;
	const initialSnapshot = !explicitAfterSequence && savedAfterSequence === undefined;
	const nextAfterSequence = initialSnapshot || !page.truncated
		? Math.max(page.nextAfterSequence, source.highWaterSequence)
		: page.nextAfterSequence;
	return {
		...page,
		autoCursorSequence: host.advanceObservationCursor(parentPiboSessionId, cursorScope, nextAfterSequence),
	};
}

export function createPiboDelegationController(
	services: PluginSessionServiceAccessor,
	parentPiboSessionId: string,
): PiboAgentsController {
	const host = services.require<PluginChildSessionOrchestration>(PIBO_SESSION_CHILD_ORCHESTRATION_SERVICE);
	return {
		sendMessage: async ({ subagent, sessionName, message, threadKey, toolCallId, requestId, parentProvenance, signal }) => {
			if (signal?.aborted) throw delegationAbortError();
			if (typeof requestId !== "string" || !requestId.trim()) throw new Error("Delegated agent requestId is required.");
			const normalizedSessionName = normalizePiboAgentSessionName(sessionName);
			const child = createDelegatedSession(host, parentPiboSessionId, subagent, normalizedSessionName, threadKey);
			const resolvedThreadKey = typeof child.metadata?.threadKey === "string" ? child.metadata.threadKey : "";
			const ids = loopIds(parentProvenance);
			const event = {
				type: "message" as const,
				piboSessionId: child.id,
				text: message,
				source: "actor" as const,
				id: randomUUID(),
				provenance: {
					kind: "subagent-request" as const,
					requestId,
					controllerPiboSessionId: parentPiboSessionId,
					...(ids.loopJobId ? { loopJobId: ids.loopJobId } : {}),
					...(ids.loopRunId ? { loopRunId: ids.loopRunId } : {}),
				},
			};
			host.associateRequest(child.id, event.id, requestId);
			host.emitOutput({
				type: "subagent_session",
				piboSessionId: parentPiboSessionId,
				requestId,
				toolCallId,
				toolName: PIBO_DELEGATION_SEND_TOOL_NAME,
				subagentName: subagent.name,
				childPiboSessionId: child.id,
				threadKey: resolvedThreadKey,
			});

			const parentAbortController = new AbortController();
			const requestSignal = signal ? AbortSignal.any([signal, parentAbortController.signal]) : parentAbortController.signal;
			let resolveSettled: ((settlement: PluginActiveChildRequestSettlement) => void) | undefined;
			const settled = new Promise<PluginActiveChildRequestSettlement>((resolve) => { resolveSettled = resolve; });
			const untrack = host.trackActive(parentPiboSessionId, {
				childPiboSessionId: child.id,
				requestId,
				abortController: parentAbortController,
				settled,
			});
			let settlement: PluginActiveChildRequestSettlement = { status: "fulfilled" };
			try {
				const reply = await host.emitMessageAndWaitForReply(event, requestSignal);
				return {
					requestId,
					agentId: child.id,
					name: subagent.name,
					profile: child.profile,
					threadKey: resolvedThreadKey,
					eventId: event.id,
					finalMessage: reply.text,
					reply,
				};
			} catch (error) {
				const confirmedParentCancellation = parentAbortController.signal.aborted && error instanceof Error && error.name === "AbortError";
				if (!confirmedParentCancellation) settlement = { status: "rejected", reason: error };
				throw error;
			} finally {
				host.dissociateRequest(child.id, event.id);
				untrack();
				resolveSettled?.(settlement);
			}
		},
		listAgents: () => listAgents(host, parentPiboSessionId),
		observe: (input) => observeAgents(host, parentPiboSessionId, input),
		killAgent: async (agentId) => {
			const result = await host.killChildSession({
				...queryFor(parentPiboSessionId),
				childPiboSessionId: agentId,
				terminalMetadata: { agentStatus: "killed", killedAt: new Date().toISOString() },
				reason: `killed by parent ${parentPiboSessionId}`,
			});
			return { agentId: result.childPiboSessionId, killed: result.killed, cancelledRuns: result.cancelledRuns };
		},
	};
}
