import type { InitialSessionContext } from "../core/profiles.js";
import type { AgentRuntimeCapabilities, AgentRuntimeCapabilityDelivery } from "./capabilities.js";
import type { AgentRuntimeDiagnostic } from "./types.js";

export function validateAgentRuntimeProfileCapabilities(
	profile: InitialSessionContext,
	capabilities: AgentRuntimeCapabilities,
): AgentRuntimeDiagnostic[] {
	const diagnostics: AgentRuntimeDiagnostic[] = [];
	const enabledTools = profile.tools.filter((tool) => tool.enabled !== false);
	const enabledSkills = profile.skills.filter((skill) => skill.enabled !== false);
	const enabledContextFiles = profile.contextFiles.filter((contextFile) => contextFile.enabled !== false);
	const enabledSubagents = profile.subagents.filter((subagent) => subagent.enabled !== false);
	const usesPiboManagedTools = enabledTools.length > 0
		|| enabledSubagents.length > 0
		|| profile.toolPackages.runControl === true
		|| profile.toolPackages.goalControl !== false;

	if (usesPiboManagedTools) {
		pushUnsupportedDeliveryDiagnostic(
			diagnostics,
			capabilities.tools.piboManaged,
			"runtime_pibo_tools_unsupported",
			"tools",
			`Profile "${profile.profileName}" selects Pibo-managed tools or subagents`,
		);
		if (capabilities.tools.piboManaged.support === "mcp") {
			if (!capabilities.tools.piboManaged.transports.includes("streamable-http")) {
				diagnostics.push({
					severity: "error",
					code: "runtime_pibo_tools_streamable_http_required",
					message: `Profile "${profile.profileName}" requires Pibo-managed tools, but this runtime does not accept the session-scoped Streamable HTTP MCP bridge.`,
					path: "tools",
				});
			}
			for (const tool of enabledTools) {
				let portable = tool.definition?.portable !== false;
				if (!tool.definition && tool.createDefinition) {
					try {
						portable = tool.createDefinition({ profileName: profile.profileName }).portable !== false;
					} catch {
						portable = false;
					}
				}
				if (portable) continue;
				diagnostics.push({
					severity: "error",
					code: "runtime_pibo_tool_not_portable",
					message: `Tool "${tool.name}" uses an adapter-private compatibility definition and cannot be delivered through session-scoped MCP.`,
					path: "tools",
					details: { toolName: tool.name },
				});
			}
		}
	}
	if (profile.toolPackages.runControl === true && capabilities.tools.nativeToolYielding.support === "unsupported") {
		diagnostics.push({
			severity: "warning",
			code: "runtime_native_tool_yielding_unsupported",
			message: `Runtime "${profile.runtimeInstanceId}" can yield Pibo-managed tools through pibo_run_start, but cannot wrap private harness-native tools: ${capabilities.tools.nativeToolYielding.reason}`,
			path: "toolPackages.runControl",
		});
	}
	if (profile.mcpServers.length > 0) {
		pushUnsupportedDeliveryDiagnostic(
			diagnostics,
			capabilities.mcp.externalServers,
			"runtime_external_mcp_unsupported",
			"mcpServers",
			`Profile "${profile.profileName}" selects external MCP servers`,
		);
	}
	if (enabledSkills.length > 0) {
		pushUnsupportedDeliveryDiagnostic(
			diagnostics,
			capabilities.skills,
			"runtime_skills_unsupported",
			"skills",
			`Profile "${profile.profileName}" selects skills`,
		);
	}
	if (enabledContextFiles.length > 0 || profile.autoContextFiles) {
		pushUnsupportedDeliveryDiagnostic(
			diagnostics,
			capabilities.context,
			"runtime_context_unsupported",
			"contextFiles",
			`Profile "${profile.profileName}" selects managed or automatic context`,
		);
	}
	if (
		profile.autoContextFiles
		&& capabilities.context.support === "materialized"
		&& !capabilities.context.modes.includes("native-project-discovery")
	) {
		diagnostics.push({
			severity: "error",
			code: "runtime_auto_context_discovery_unsupported",
			message: `Runtime "${profile.runtimeInstanceId}" materializes explicit context but does not support automatic AGENTS.md / CLAUDE.md discovery. Disable automatic context or choose a runtime that declares native-project-discovery.`,
			path: "autoContextFiles",
		});
	}

	const reasoningValues = [
		profile.thinkingLevel,
		profile.mainThinkingLevel,
		profile.subagentThinkingLevel,
	].filter((value): value is NonNullable<typeof value> => value !== undefined);
	if (reasoningValues.length > 0 && !capabilities.reasoning.supported) {
		diagnostics.push({
			severity: "error",
			code: "runtime_reasoning_unsupported",
			message: `Profile "${profile.profileName}" selects reasoning options, but this runtime does not support reasoning control.`,
			path: "thinkingLevel",
		});
	} else if (capabilities.reasoning.values?.length) {
		const supportedValues = new Set(capabilities.reasoning.values);
		for (const value of reasoningValues) {
			if (supportedValues.has(value)) continue;
			diagnostics.push({
				severity: "error",
				code: "runtime_reasoning_value_unsupported",
				message: `Profile "${profile.profileName}" selects unsupported reasoning value "${value}".`,
				path: "thinkingLevel",
				details: { value, supportedValues: [...supportedValues] },
			});
		}
	}
	return diagnostics;
}

function pushUnsupportedDeliveryDiagnostic(
	diagnostics: AgentRuntimeDiagnostic[],
	delivery: AgentRuntimeCapabilityDelivery,
	code: string,
	path: string,
	selection: string,
): void {
	if (delivery.support !== "unsupported") return;
	diagnostics.push({
		severity: "error",
		code,
		message: `${selection}, but runtime delivery is unsupported: ${delivery.reason}`,
		path,
	});
}
