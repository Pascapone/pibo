import type { SubagentProfile } from "../core/profiles.js";

export const PIBO_DELEGATED_AGENT_CONTEXT_PATH = "pibo://runtime/delegated-agents.md";

export function getDelegatedAgentContextFile(
	subagents: readonly SubagentProfile[],
): { path: string; content: string } | undefined {
	const agents = subagents
		.filter((subagent) => subagent.enabled !== false)
		.map((subagent) => ({
			name: subagent.name,
			description: subagent.description?.trim() || `Targets profile ${subagent.targetProfile}.`,
			profile: subagent.targetProfile,
			...(subagent.model ? { model: { ...subagent.model } } : {}),
			...(subagent.thinkingLevel ? { thinkingLevel: subagent.thinkingLevel } : {}),
		}));
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
			"This session has Pibo-managed delegated agents. The delegation tools are part of the session whenever at least one enabled delegated agent is configured.",
			"",
			"## Available agents",
			"",
			catalog,
			"",
			"## Workflow",
			"",
			"pibo_agents_send_message({ name, sessionName, message, threadKey? })",
			"pibo_agents_observe({ requestIds?, agentIds?, names?, cursorMode?, ... })",
			"pibo_agents_list_agents({})",
			"pibo_agents_kill({ agentId })",
			"",
			"Call pibo_agents_send_message directly and wait for its reply. If the optional Pibo Run Control tools are present, you may instead wrap the send with pibo_run_start and use run wait, status, read, or cancel for asynchronous lifecycle control.",
			"",
			"Set sessionName on every send to a nonblank human-readable child title of at most 40 Unicode code points. Pibo trims surrounding whitespace and rejects invalid values before creating a child session. Reuse a stable threadKey to continue the same child Pibo Session; a new sessionName updates its title without changing identity.",
			"",
			"Observe uses cursorMode auto by default: the first equivalent query returns the newest completed assistant messages, and later calls return only unread messages. Use cursorMode history only to reread earlier observations. Streaming deltas, duplicate tool progress events, and tools are hidden by default. Inspect tools only when a child stalls, reports an error, or needs targeted diagnosis.",
			"",
			"For substantial reports, ask the child to persist a Markdown artifact and include its path in the complete final message.",
		].join("\n"),
	};
}
