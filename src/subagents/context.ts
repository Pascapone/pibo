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
			"  arguments: { name, sessionName, message, threadKey? },",
			"  completionPolicy?: \"tracked\" | \"detached\"",
			"}) -> { runId }",
			"",
			"pibo_run_wait({ runId, timeoutMs? })       # bounded wait only; expiry does not stop the child",
			"pibo_run_status({ runId })                 # compact lifecycle state",
			"pibo_agents_observe({ requestIds?: [runId], cursorMode?: \"auto\"|\"history\", textContains?, textRegex?, afterSequence?, limit?, includeTools?, toolDetail?, ... })",
			"pibo_run_read({ runId })                   # terminal result, including the complete final agent message",
			"pibo_run_cancel({ runId })                 # explicit request cancellation",
			"pibo_agents_list_agents({})                # available definitions and persistent child instances",
			"pibo_agents_kill({ agentId })              # terminate one persistent child session subtree",
			"```",
			"",
			"Set `sessionName` on every send to a nonblank human-readable child title of at most 40 Unicode code points. Pibo trims surrounding whitespace and rejects missing, blank, non-string, or oversized names before creating a yielded run or child session. Reuse a stable `threadKey` to continue the same child Pibo Session; a new `sessionName` updates its title without changing identity. A wait timeout only wakes the orchestrator. Observe uses `cursorMode: \"auto\"` by default: the first equivalent query returns the newest completed assistant messages, and later calls return only unread messages. Use `cursorMode: \"history\"` only to reread earlier observations. Streaming deltas, duplicate tool progress events, and tools are hidden by default. Inspect tools only when a child stalls, reports an error, or needs targeted diagnosis; prefer exact `toolCallIds`, then `includeTools: true`, and use `toolDetail: \"full\"` only when summaries are insufficient. Use `textContains` for case-insensitive substring matching or `textRegex` for rg/Rust-regex matching; both must match when supplied together. Text, regex, identity, and event filters create separate automatic query cursors; an explicit `afterSequence` overrides and advances the matching automatic cursor.",
			"",
			"Observe progress and decide whether to continue waiting, steer through a new message after the current turn, cancel the request, or kill the child session.",
			"",
			"For substantial reports, ask the child to persist a Markdown artifact and include its path in the complete final message.",
		].join("\n"),
	};
}
