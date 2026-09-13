import { randomUUID } from "node:crypto";
import type { InitialSessionContext } from "../core/profiles.js";
import type { PiboContextBuildNode, PiboContextBuildSnapshot } from "../core/context-build.js";
import { redactSensitiveValue } from "../core/sensitive-data-redaction.js";

/** Conservative compatibility projection for legacy callers. It never claims observed execution. */
export function buildLegacyContextPreview(profile: InitialSessionContext, cwd: string, piboSessionId?: string, piboRoomId?: string): PiboContextBuildSnapshot {
	const nodes: PiboContextBuildNode[] = [];
	const add = (node: Omit<PiboContextBuildNode, "order">) => nodes.push({ ...node, order: nodes.length });
	add({ id: "preview-boundary", kind: "metadata", title: "Pure configuration preview — not actual model input", source: "runtime", state: "warning", notes: ["No runtime, MCP connection, tool factory or hook was executed.", "Native prompt, discovered context, dynamic tool schemas and compaction remain unknown until captured during a generation."], metadata: { snapshotId: `preview-${randomUUID()}`, kind: "preview", actual: false } });
	for (const tool of profile.tools) add({ id: `tool:${tool.name}`, kind: "tool_definition", title: tool.name, source: "profile", state: tool.enabled === false ? "disabled" : "skipped", schemaJson: tool.definition ? redactSensitiveValue(tool.definition.inputSchema) : undefined, notes: ["Declared schema metadata is not a system-prompt paragraph.", ...(tool.createDefinition ? ["Dynamic factory not executed during inspection."] : [])] });
	for (const skill of profile.skills) add({ id: `skill:${skill.name}`, kind: "skill", title: skill.name, source: skill.kind === "user" ? "managed" : "plugin", path: skill.path, state: skill.enabled === false ? "disabled" : "skipped", notes: ["Progressive skill; body is not injected by selection. Delivery not observed."] });
	for (const file of profile.contextFiles) add({ id: `context:${file.key ?? file.path}`, kind: "context_file", title: file.key ?? file.path, path: file.path, source: file.source === "plugin" ? "plugin" : "managed", state: file.enabled === false ? "disabled" : "skipped", notes: ["Selected file reference; actual hydration not observed."] });
	for (const agent of profile.subagents) add({ id: `subagent:${agent.name}`, kind: "metadata", title: agent.name, source: "profile", state: agent.enabled === false ? "disabled" : "skipped", metadata: redactSensitiveValue(agent) as Record<string, unknown>, notes: ["Child resolves its own target profile and plugin generation, independently of parent."] });
	for (const server of profile.mcpServers) add({ id: `mcp:${server}`, kind: "metadata", title: server, source: "profile", state: "skipped", notes: ["MCP not connected by inspection; external OMP MCP remains unsupported. Internal tool bridge is independent."] });
	return { version: 1, generatedAt: new Date().toISOString(), profileName: profile.profileName, cwd, piboSessionId, piboRoomId, nodes, summary: { topLevelNodes: nodes.length, totalNodes: nodes.length, estimatedTokens: 0, warnings: 1, errors: 0 }, diagnostics: [{ type: "warning", message: "Pure preview only; read a persisted plugin build for actual generation evidence." }] };
}
