import type { AgentRuntimeCapabilityDelivery } from "./capabilities.js";
import type { AgentRuntimeDiagnostic } from "./types.js";
import type { AgentRuntimeResourceInspection } from "./resources.js";
import type {
	PiboContextBuildNode,
	PiboContextBuildRuntimeInfo,
	PiboContextBuildSnapshot,
} from "../core/context-build.js";
import { InitialSessionContext } from "../core/profiles.js";

export function profileWithRuntimeInstance(profile: InitialSessionContext, runtimeInstanceId: string): InitialSessionContext {
	if (profile.runtimeInstanceId === runtimeInstanceId) return profile;
	return new InitialSessionContext({
		profileName: profile.profileName,
		runtimeInstanceId,
		runtimeOptions: profile.runtimeOptions,
		sessionId: profile.sessionId,
		parentSessionId: profile.parentSessionId,
		model: profile.model,
		mainModel: profile.mainModel,
		subagentModel: profile.subagentModel,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel,
		fast: profile.fast,
		mainFast: profile.mainFast,
		subagentFast: profile.subagentFast,
		skills: profile.skills,
		tools: profile.tools,
		subagents: profile.subagents,
		mcpServers: profile.mcpServers,
		piPackages: profile.piPackages,
		contextFiles: profile.contextFiles,
		builtinTools: profile.builtinTools,
		builtinToolNames: profile.builtinToolNames,
		autoContextFiles: profile.autoContextFiles,
		toolPackages: profile.toolPackages,
	});
}

export function uniqueRuntimeDiagnostics(diagnostics: readonly AgentRuntimeDiagnostic[]): AgentRuntimeDiagnostic[] {
	const seen = new Set<string>();
	return diagnostics.filter((diagnostic) => {
		const key = `${diagnostic.severity}:${diagnostic.code}:${diagnostic.message}:${diagnostic.path ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildPortableRuntimeContextSnapshot(input: {
	profile: InitialSessionContext;
	runtime: PiboContextBuildRuntimeInfo;
	cwd: string;
	piboSessionId: string;
	piboRoomId?: string;
	activeModel?: InitialSessionContext["model"];
	resources?: AgentRuntimeResourceInspection;
}): PiboContextBuildSnapshot {
	const profile = input.profile;
	const nodes: PiboContextBuildNode[] = [];
	const addNode = (node: Omit<PiboContextBuildNode, "order">) => nodes.push({ ...node, order: nodes.length });
	addNode({
		id: "runtime",
		kind: "metadata",
		title: "Agent Runtime",
		source: "runtime",
		state: input.runtime.available ? "active" : "error",
		badges: [input.runtime.adapterId.toUpperCase(), input.runtime.available ? "AVAILABLE" : "UNAVAILABLE"],
		metadata: {
			runtimeInstanceId: input.runtime.runtimeInstanceId,
			adapterId: input.runtime.adapterId,
			transport: input.runtime.transport,
			bindingState: input.runtime.bindingState,
			protocol: input.runtime.protocol?.name,
			runtimeOptionKeys: Object.keys(profile.runtimeOptions),
		},
		payloadJson: input.runtime.capabilities,
	});
	addRuntimeContributionGroup(nodes, "tools", "Pibo Tools and Subagents", [
		...profile.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name),
		...profile.subagents.filter((subagent) => subagent.enabled !== false).map((subagent) => `subagent:${subagent.name} -> ${subagent.targetProfile}`),
		...(profile.toolPackages.goalControl !== false ? ["package:pibo-goal-control"] : []),
		...(profile.toolPackages.runControl === true ? ["package:pibo-run-control"] : []),
	], input.runtime.capabilities.tools.piboManaged);
	addNativeToolInspectionNode(nodes, input.runtime.capabilities.tools.nativeToolInspection);
	if (profile.toolPackages.runControl === true) {
		addNativeToolYieldingNode(nodes, input.runtime.capabilities.tools.nativeToolYielding);
	}
	if (input.resources) {
		addRuntimeResourceGroup(nodes, "skills", "Skills", "skill", input.resources.skills.map((skill) => ({
			id: skill.contributionId,
			title: skill.name,
			source: skill.kind === "builtin" ? "library" : skill.kind === "user" ? "custom" : "plugin",
			path: skill.materializedPath ?? skill.sourcePath,
			metadata: { kind: skill.kind },
		})), input.resources);
		addRuntimeResourceGroup(nodes, "context", "Context", "context_file", input.resources.context.map((contribution) => ({
			id: contribution.id,
			title: contribution.label,
			source: contribution.source === "pibo-product" ? "pibo"
				: contribution.source === "generated" ? "generated"
					: contribution.source,
			path: contribution.materializedPath ?? contribution.path ?? contribution.sourcePath,
			bytes: contribution.byteSize,
			metadata: { kind: contribution.kind, intent: contribution.intent, required: contribution.required },
		})), input.resources);
		addRuntimeResourceGroup(nodes, "mcp", "External MCP Servers", "runtime_extension", input.resources.mcpServers.map((server) => ({
			id: server.contributionId,
			title: server.name,
			source: "profile",
			metadata: {
				transport: server.transport,
				connectionStatus: server.status,
				toolNames: server.tools.map((tool) => tool.name),
				resourceUris: server.resources.map((resource) => resource.uri),
				resourceTemplates: server.resourceTemplates.map((resource) => resource.uriTemplate),
				secretEnvironmentKeys: server.secretEnvironmentKeys,
			},
		})), input.resources);
	} else {
		addRuntimeContributionGroup(nodes, "skills", "Skills", profile.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.name), input.runtime.capabilities.skills);
		addRuntimeContributionGroup(nodes, "context", "Context", [
			...(profile.autoContextFiles ? ["automatic:AGENTS.md/CLAUDE.md"] : []),
			...profile.contextFiles.filter((file) => file.enabled !== false).map((file) => file.key ?? file.path),
		], input.runtime.capabilities.context);
		addRuntimeContributionGroup(nodes, "mcp", "External MCP Servers", [...profile.mcpServers], input.runtime.capabilities.mcp.externalServers);
	}
	if (profile.piPackages.some((pkg) => pkg.enabled !== false)) {
		addNode({
			id: "adapter-packages",
			kind: "runtime_extension",
			title: "Adapter Packages",
			source: "profile",
			state: input.runtime.adapterId === "pi" ? "active" : "warning",
			badges: ["PI PACKAGES"],
			notes: input.runtime.adapterId === "pi" ? undefined : ["Pi packages are adapter-specific and require explicit support from the selected runtime."],
			metadata: { packages: profile.piPackages.filter((pkg) => pkg.enabled !== false).map((pkg) => pkg.id) },
		});
	}
	addNode({
		id: "model-options",
		kind: "metadata",
		title: "Model and Runtime Options",
		source: "profile",
		state: "active",
		metadata: {
			activeModel: input.activeModel,
			mainModel: profile.mainModel,
			subagentModel: profile.subagentModel,
			mainThinkingLevel: profile.mainThinkingLevel ?? profile.thinkingLevel,
			subagentThinkingLevel: profile.subagentThinkingLevel ?? profile.thinkingLevel,
			mainFast: profile.mainFast ?? profile.fast,
			subagentFast: profile.subagentFast ?? profile.fast,
			builtinTools: profile.builtinTools,
			builtinToolNames: profile.builtinToolNames,
		},
	});
	for (const [index, diagnostic] of input.runtime.diagnostics.entries()) {
		addNode({
			id: `runtime-diagnostic-${index}`,
			kind: "diagnostic",
			title: diagnostic.code,
			source: "runtime",
			state: diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warning" : "active",
			badges: [diagnostic.severity.toUpperCase()],
			hydratedText: diagnostic.message,
			metadata: diagnostic.path ? { path: diagnostic.path } : undefined,
		});
	}
	for (const [index, diagnostic] of (input.resources?.diagnostics ?? []).entries()) {
		addNode({
			id: `resource-diagnostic-${index}`,
			kind: "diagnostic",
			title: diagnostic.code,
			source: "runtime",
			state: diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warning" : "active",
			badges: [diagnostic.severity.toUpperCase(), "RESOURCE"],
			hydratedText: diagnostic.message,
			metadata: diagnostic.contributionId ? { contributionId: diagnostic.contributionId } : undefined,
		});
	}
	const resourceDiagnostics = input.resources?.diagnostics ?? [];
	const warnings = input.runtime.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length
		+ resourceDiagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
	const errors = input.runtime.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
		+ resourceDiagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		profileName: profile.profileName,
		piboSessionId: input.piboSessionId,
		piboRoomId: input.piboRoomId,
		cwd: input.cwd,
		activeModel: input.activeModel,
		runtime: input.runtime,
		summary: {
			topLevelNodes: nodes.length,
			totalNodes: nodes.reduce((count, node) => count + 1 + (node.children?.length ?? 0), 0),
			estimatedTokens: 0,
			warnings,
			errors,
		},
		nodes,
		diagnostics: [
			...input.runtime.diagnostics.map((diagnostic) => ({ type: diagnostic.severity, message: diagnostic.message })),
			...resourceDiagnostics.map((diagnostic) => ({ type: diagnostic.severity, message: diagnostic.message })),
		],
	};
}

function addNativeToolInspectionNode(
	nodes: PiboContextBuildNode[],
	delivery: AgentRuntimeCapabilityDelivery,
): void {
	const supported = delivery.support !== "unsupported";
	const mode = runtimeDeliveryMode(delivery);
	const reason = delivery.support === "unsupported" || delivery.support === "degraded" ? delivery.reason : undefined;
	nodes.push({
		id: "tools/native-inspection",
		order: nodes.length,
		kind: "runtime_extension",
		title: "Harness-Native Tool Inspection",
		source: "runtime",
		state: supported ? delivery.support === "degraded" ? "warning" : "active" : "warning",
		badges: [mode.toUpperCase()],
		metadata: { deliveryMode: mode },
		notes: [
			"Harness-native tools remain owned and executed by the selected runtime.",
			...(reason ? [reason] : []),
		],
	});
}

function addNativeToolYieldingNode(
	nodes: PiboContextBuildNode[],
	delivery: AgentRuntimeCapabilityDelivery,
): void {
	const supported = delivery.support !== "unsupported";
	const mode = runtimeDeliveryMode(delivery);
	const reason = delivery.support === "unsupported" || delivery.support === "degraded" ? delivery.reason : undefined;
	nodes.push({
		id: "tools/native-yielding",
		order: nodes.length,
		kind: "runtime_extension",
		title: "Private Harness-Native Tool Yielding",
		source: "runtime",
		state: supported ? delivery.support === "degraded" ? "warning" : "active" : "warning",
		badges: [mode.toUpperCase()],
		metadata: { deliveryMode: mode, piboManagedToolYieldingUnaffected: true },
		notes: [
			"pibo_run_start can always wrap selected Pibo-managed tools when Pibo tool delivery is supported.",
			...(reason ? [reason] : []),
		],
	});
}

function addRuntimeResourceGroup(
	nodes: PiboContextBuildNode[],
	id: string,
	title: string,
	kind: PiboContextBuildNode["kind"],
	items: readonly {
		id: string;
		title: string;
		source?: PiboContextBuildNode["source"];
		path?: string;
		bytes?: number;
		metadata?: Record<string, unknown>;
	}[],
	resources: AgentRuntimeResourceInspection,
): void {
	const reports = new Map(resources.delivery.map((report) => [report.contributionId, report]));
	const children = items.map((item, index): PiboContextBuildNode => {
		const report = reports.get(item.id);
		const status = report?.status ?? "failed";
		return {
			id: `${id}/${index}`,
			parentId: id,
			order: index,
			kind,
			title: item.title,
			source: item.source ?? "profile",
			state: status === "failed" || status === "unsupported"
				? "error"
				: status === "degraded"
					? "warning"
					: "active",
			badges: [status.toUpperCase(), ...(report ? [report.mode.toUpperCase(), report.fidelity.toUpperCase()] : [])],
			...(item.path ? { path: item.path } : {}),
			...(item.bytes !== undefined ? { bytes: item.bytes } : {}),
			metadata: {
				...item.metadata,
				contributionId: item.id,
				deliveryStatus: status,
				deliveryMode: report?.mode,
				fidelity: report?.fidelity,
				target: report?.target,
			},
			notes: report?.diagnostic ? [report.diagnostic] : undefined,
		};
	});
	const hasError = children.some((child) => child.state === "error");
	const hasWarning = children.some((child) => child.state === "warning");
	nodes.push({
		id,
		order: nodes.length,
		kind: id === "skills" ? "skills" : id === "context" ? "context_files" : "runtime_extension",
		title,
		source: "profile",
		state: hasError ? "error" : hasWarning ? "warning" : children.length > 0 ? "active" : "disabled",
		badges: [hasError ? "FAILED" : hasWarning ? "DEGRADED" : children.length > 0 ? "DELIVERED" : "EMPTY"],
		metadata: { selectedCount: children.length, sessionGeneration: resources.sessionGeneration },
		children,
	});
}

function addRuntimeContributionGroup(
	nodes: PiboContextBuildNode[],
	id: string,
	title: string,
	items: readonly string[],
	delivery: AgentRuntimeCapabilityDelivery,
): void {
	const state = delivery.support === "unsupported" ? "error" : delivery.support === "degraded" ? "warning" : items.length > 0 ? "active" : "disabled";
	const reason = delivery.support === "unsupported" || delivery.support === "degraded" ? delivery.reason : undefined;
	const mode = runtimeDeliveryMode(delivery);
	nodes.push({
		id,
		order: nodes.length,
		kind: id === "tools" ? "tool_surface" : id === "skills" ? "skills" : id === "context" ? "context_files" : "runtime_extension",
		title,
		source: "profile",
		state,
		badges: [mode.toUpperCase()],
		metadata: { deliveryMode: mode, selectedCount: items.length },
		notes: reason ? [reason] : undefined,
		children: items.map((item, index) => ({
			id: `${id}/${index}`,
			parentId: id,
			order: index,
			kind: id === "tools" ? "tool" : id === "skills" ? "skill" : id === "context" ? "context_file" : "runtime_extension",
			title: item,
			source: "profile",
			state: delivery.support === "unsupported" ? "error" : delivery.support === "degraded" ? "warning" : "active",
			badges: [mode.toUpperCase()],
			notes: reason ? [reason] : undefined,
		})),
	});
}

function runtimeDeliveryMode(delivery: AgentRuntimeCapabilityDelivery): string {
	if (delivery.support === "mcp") return `mcp:${delivery.transports.join(",")}`;
	if (delivery.support === "materialized") return `materialized:${delivery.modes.join(",")}`;
	if (delivery.support === "degraded") return `degraded:${delivery.mode}`;
	return delivery.support;
}
