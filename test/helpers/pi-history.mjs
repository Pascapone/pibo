import { piSessionEntriesToAgentRuntimeHistoryEntries } from "../../dist/agent-runtimes/pi/history.js";
import { buildTraceViewFromEvents as buildRuntimeNeutralTraceView } from "../../dist/shared/trace-engine.js";

export function buildTraceViewFromEvents(input) {
	const { transcriptEntries, ...rest } = input;
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
