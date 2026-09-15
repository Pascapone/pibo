import { piSessionEntriesToAgentRuntimeHistoryEntries } from "../../dist/agent-runtimes/pi/history.js";
import { buildTraceViewFromEvents as buildRuntimeNeutralTraceView } from "../../dist/shared/trace-engine.js";
import { authorizeAgentRuntimeHistoryProof } from "../../dist/agent-runtime/history-authority.js";
import { isBuiltInHistoryReconciliationProof } from "../../dist/agent-runtimes/history-proof.js";

const builtInHistoryAuthority = { isHistoryReconciliationProof: isBuiltInHistoryReconciliationProof };

export function buildTraceViewFromEvents(input) {
	const { transcriptEntries, ...rest } = input;
	authorizeAgentRuntimeHistoryProof(builtInHistoryAuthority, rest.historyReconciliationProof);
	return buildRuntimeNeutralTraceView({
		...rest,
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
