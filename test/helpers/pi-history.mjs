import { piSessionEntriesToAgentRuntimeHistoryEntries } from "../../dist/agent-runtimes/pi/history.js";
import { buildTraceViewFromEvents as buildRuntimeNeutralTraceView } from "../../dist/shared/trace-engine.js";
import { isBuiltInHistoryReconciliationProof } from "../../dist/agent-runtimes/history-proof.js";

export function buildTraceViewFromEvents(input) {
	const { transcriptEntries, ...rest } = input;
	return buildRuntimeNeutralTraceView({
		...rest,
		historyReconciliationAuthoritative: isBuiltInHistoryReconciliationProof(rest.historyReconciliationProof),
		...(transcriptEntries ? { historyEntries: piSessionEntriesToAgentRuntimeHistoryEntries(transcriptEntries) } : {}),
	});
}

export function traceNodesFromEntries(piboSessionId, entries, turnTimings = []) {
	return buildRuntimeNeutralTraceView({
		session: { id: piboSessionId, piSessionId: "" },
		events: [],
		historyEntries: piSessionEntriesToAgentRuntimeHistoryEntries(entries),
		turnTimings,
	}).nodes;
}

export { piSessionEntriesToAgentRuntimeHistoryEntries };
