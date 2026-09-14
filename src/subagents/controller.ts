import { randomUUID } from "node:crypto";
import type { PiboMessageEvent, PiboMessageProvenance, PiboOutputEvent } from "../core/events.js";
import type { SubagentProfile } from "../core/profiles.js";
import type { PiboSession } from "../sessions/store.js";
import {
	normalizePiboAgentSessionName,
	type PiboAgentObserveInput,
	type PiboAgentsController,
	type PiboManagedAgent,
} from "./tool.js";

export const PIBO_DELEGATION_SEND_TOOL_NAME = "pibo_agents_send_message";

export type PiboActiveDelegationSettlement =
	| { status: "fulfilled" }
	| { status: "rejected"; reason: unknown };

export type PiboActiveDelegationRequest = {
	agentId: string;
	requestId: string;
	abortController: AbortController;
	settled: Promise<PiboActiveDelegationSettlement>;
};

export type PiboDelegationControllerHost = {
	assertDepth(parentPiboSessionId: string, subagent: SubagentProfile): void;
	resolveSession(parentPiboSessionId: string, subagent: SubagentProfile, sessionName: string, threadKey?: string): PiboSession;
	associateRequest(childPiboSessionId: string, eventId: string, requestId: string): void;
	dissociateRequest(childPiboSessionId: string, eventId: string): void;
	emitOutput(event: PiboOutputEvent): void;
	emitMessageAndWaitForReply(event: PiboMessageEvent, signal: AbortSignal): Promise<Extract<PiboOutputEvent, { type: "assistant_message" }>>;
	trackActive(parentPiboSessionId: string, request: PiboActiveDelegationRequest): () => void;
	listAgents(parentPiboSessionId: string): PiboManagedAgent[];
	observeAgents(parentPiboSessionId: string, input: PiboAgentObserveInput): ReturnType<PiboAgentsController["observe"]>;
	killAgent(parentPiboSessionId: string, agentId: string): ReturnType<PiboAgentsController["killAgent"]>;
};

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

export function createPiboDelegationController(host: PiboDelegationControllerHost, parentPiboSessionId: string): PiboAgentsController {
	return {
		sendMessage: async ({ subagent, sessionName, message, threadKey, toolCallId, requestId, parentProvenance, signal }) => {
			if (signal?.aborted) throw delegationAbortError();
			if (typeof requestId !== "string" || !requestId.trim()) throw new Error("Delegated agent requestId is required.");
			host.assertDepth(parentPiboSessionId, subagent);
			const normalizedSessionName = normalizePiboAgentSessionName(sessionName);
			const child = host.resolveSession(parentPiboSessionId, subagent, normalizedSessionName, threadKey);
			const resolvedThreadKey = typeof child.metadata?.threadKey === "string" ? child.metadata.threadKey : "";
			const ids = loopIds(parentProvenance);
			const event: PiboMessageEvent = {
				type: "message",
				piboSessionId: child.id,
				text: message,
				source: "actor",
				id: randomUUID(),
				provenance: {
					kind: "subagent-request",
					requestId,
					controllerPiboSessionId: parentPiboSessionId,
					...(ids.loopJobId ? { loopJobId: ids.loopJobId } : {}),
					...(ids.loopRunId ? { loopRunId: ids.loopRunId } : {}),
				},
			};
			host.associateRequest(child.id, event.id!, requestId);
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
			let resolveSettled: ((settlement: PiboActiveDelegationSettlement) => void) | undefined;
			const settled = new Promise<PiboActiveDelegationSettlement>((resolve) => { resolveSettled = resolve; });
			const untrack = host.trackActive(parentPiboSessionId, {
				agentId: child.id,
				requestId,
				abortController: parentAbortController,
				settled,
			});
			let settlement: PiboActiveDelegationSettlement = { status: "fulfilled" };
			try {
				const reply = await host.emitMessageAndWaitForReply(event, requestSignal);
				return {
					requestId,
					agentId: child.id,
					name: subagent.name,
					profile: child.profile,
					threadKey: resolvedThreadKey,
					eventId: event.id!,
					finalMessage: reply.text,
					reply,
				};
			} catch (error) {
				const confirmedParentCancellation = parentAbortController.signal.aborted && error instanceof Error && error.name === "AbortError";
				if (!confirmedParentCancellation) settlement = { status: "rejected", reason: error };
				throw error;
			} finally {
				host.dissociateRequest(child.id, event.id!);
				untrack();
				resolveSettled?.(settlement);
			}
		},
		listAgents: () => host.listAgents(parentPiboSessionId),
		observe: (input) => host.observeAgents(parentPiboSessionId, input),
		killAgent: (agentId) => host.killAgent(parentPiboSessionId, agentId),
	};
}
