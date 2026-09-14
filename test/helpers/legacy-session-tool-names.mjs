import { PIBO_GOAL_TOOL_NAMES } from "../../dist/loops/tools.js";
import { PIBO_RUN_TOOL_NAMES } from "../../dist/runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../../dist/subagents/tool.js";

/** Frozen pre-4.0 comparison fixture only. Production delivery must not call this helper. */
export function legacySessionToolNames({ nativeToolNames, subagents, goalControl, runControl }) {
	const hasDelegation = subagents.some((agent) => agent.enabled !== false);
	return [...new Set([
		...nativeToolNames,
		...(hasDelegation ? PIBO_AGENT_TOOL_NAMES.filter((name) => name !== "pibo_agents_send_message") : []),
		...(goalControl ? PIBO_GOAL_TOOL_NAMES : []),
		...(runControl || hasDelegation ? PIBO_RUN_TOOL_NAMES : []),
	])].sort();
}
