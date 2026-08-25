import type { SubagentProfile } from "../core/profiles.js";
import { listAvailableAgents } from "./tool.js";

export const PIBO_DELEGATED_AGENT_CONTEXT_PATH = "pibo://runtime/delegated-agents.md";

export function getDelegatedAgentContextFile(
	subagents: readonly SubagentProfile[],
): { path: string; content: string } | undefined {
	const agents = listAvailableAgents(subagents);
	if (agents.length === 0) return undefined;
	const catalog = agents.map((agent) => {
		const runtime = [
			agent.model ? `${agent.model.provider}/${agent.model.id}` : undefined,
			agent.thinkingLevel ? `thinking ${agent.thinkingLevel}` : undefined,
		].filter(Boolean).join(", ");
		return `- \`${agent.name}\` → \`${agent.profile}\`${runtime ? ` (${runtime})` : ""}: ${agent.description}`;
	}).join("\n");
	return {
		path: PIBO_DELEGATED_AGENT_CONTEXT_PATH,
		content: [
			"# Delegated Agent Management",
			"",
			"This session has Pibo-managed delegated agents. Dispatch is yielded-only: never call `pibo_agents_send_message` directly. Start it through `pibo_run_start`, then manage the returned run ID.",
			"",
			"## Available agents",
			"",
			catalog,
			"",
			"## Required workflow",
			"",
			"```text",
			"pibo_run_start({",
			"  toolName: \"pibo_agents_send_message\",",
			"  arguments: { name, message, threadKey? },",
			"  completionPolicy?: \"tracked\" | \"detached\"",
			"}) -> { runId }",
			"",
			"pibo_run_wait({ runId, timeoutMs? })       # bounded wait only; expiry does not stop the child",
			"pibo_run_status({ runId })                 # compact lifecycle state",
			"pibo_agents_observe({ requestIds?: [runId], afterSequence?, limit?, includeTools?, toolDetail?, ... })",
			"pibo_run_read({ runId })                   # terminal result, including the complete final agent message",
			"pibo_run_cancel({ runId })                 # explicit request cancellation",
			"pibo_agents_list_agents({})                # available definitions and persistent child instances",
			"pibo_agents_kill({ agentId })              # terminate one persistent child session subtree",
			"```",
			"",
			"Reuse a stable `threadKey` to continue the same child Pibo Session. A wait timeout is only an orchestrator wake-up. Observe defaults to the newest 20 completed assistant messages with streaming deltas, duplicate tool progress events, and tools hidden. Set `includeTools: true` for compact tool call/result summaries, `toolDetail: \"full\"` only for bounded diagnostics, and `limit: 50` when a larger page is necessary. Use `afterSequence` from the prior result for polling.",
			"",
			"Observe progress and decide whether to continue waiting, steer through a new message after the current turn, cancel the request, or kill the child session.",
			"",
			"For substantial reports, ask the child to persist a Markdown artifact and include its path in the complete final message.",
		].join("\n"),
	};
}
