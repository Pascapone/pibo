import { randomUUID } from "node:crypto";
import type { EffectivePluginPlan, PluginBuildProvenanceNode } from "../plugins/contributions.js";
import type { PluginStore } from "../plugins/store.js";
import type { PluginRuntimeCoordinator } from "./plugin-plan.js";
import type { InitialSessionContext } from "../core/profiles.js";
import type { PluginRuntimeTarget } from "../plugins/contributions.js";
import type { PiboRuntimeResourceSession } from "./resources.js";
import type { PiboToolDefinition } from "../tools/contract.js";
import { redactSensitiveText, redactSensitiveValue } from "../core/sensitive-data-redaction.js";
import type { PluginHookEvidence } from "./plugin-hooks.js";

export type PluginContextBuildSnapshot = {
	schemaVersion: 1; snapshotId: string; kind: "actual" | "preview"; createdAt: string;
	piboSessionId?: string; generation?: string; plan: EffectivePluginPlan;
	nodes: PluginBuildProvenanceNode[];
	boundaries: string[];
};
function safeText(text: string): { text: string; redacted: boolean; visibility: "model" } {
	const redacted = redactSensitiveText(text);
	return { text: redacted, redacted: redacted !== text, visibility: "model" };
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
	return value;
}

/** Pure projection. No runtime, resource service, tool factory, hooks, file writes or MCP discovery. */
export function buildPluginContextPreview(plan: EffectivePluginPlan): PluginContextBuildSnapshot {
	return freeze({ schemaVersion: 1, snapshotId: `preview-${randomUUID()}`, kind: "preview", createdAt: new Date().toISOString(), piboSessionId: plan.piboSessionId, plan: redactSensitiveValue(plan) as EffectivePluginPlan, nodes: redactSensitiveValue(plan.nodes) as PluginBuildProvenanceNode[], boundaries: [
		"Preview only: dynamic factories, hooks and MCP discovery are not executed.",
		"Native harness prompt, history and internal compaction are not observable through this projection.",
	] });
}

/** Record only observed runtime deliveries; selected metadata is never invented model text. */
export function capturePluginContextBuild(input: { plan: EffectivePluginPlan; resources: PiboRuntimeResourceSession; tools: readonly PiboToolDefinition[] }): PluginContextBuildSnapshot {
	const { plan, resources } = input;
	if (plan.kind !== "generation" || plan.generation !== resources.sessionGeneration || plan.piboSessionId !== resources.piboSessionId) throw new Error("Build snapshot generation mismatch");
	const inspection = resources.getInspection();
	const nodes = structuredClone(plan.nodes);
	const add = (node: Omit<PluginBuildProvenanceNode, "schemaVersion" | "order" | "predecessors">) => nodes.push({ ...node, schemaVersion: 1, order: nodes.length, predecessors: nodes.length ? [nodes[nodes.length - 1]!.id] : [] });
	const delivery = (id: string) => {
		const report = inspection.delivery.find((item) => item.contributionId === id);
		return report ? { ...report, generation: plan.generation!, target: report.target ?? inspection.adapterId } : undefined;
	};
	for (const resource of resources.getContextContributions()) {
		const report = delivery(resource.id);
		add({ id: `runtime/${resource.id}`, kind: "context-file", origin: resource.source === "plugin" ? "plugin" : resource.source === "managed" ? "user" : "harness", context: { kind: "context", stage: "context", description: resource.label, loading: "eager" }, status: report?.status ?? "not-loaded", selected: true, selectionReason: resource.source, delivery: report, fallback: resource.label,
			content: resource.content !== undefined && report && ["delivered", "degraded"].includes(report.status) ? safeText(resource.content) : { visibility: "inspector", redacted: false, unavailableReason: "No observed text delivery" } });
	}
	for (const skill of inspection.skills) add({ id: `runtime/${skill.contributionId}`, kind: "skill", origin: skill.kind === "user" ? "user" : "plugin", context: { kind: "context", stage: "skills", description: skill.name, loading: "progressive" }, status: delivery(skill.contributionId)?.status ?? "not-loaded", selected: true, selectionReason: "selected skill resource", delivery: delivery(skill.contributionId), fallback: skill.name, content: { visibility: "inspector", redacted: false, unavailableReason: "Progressive skill: discovery metadata/path delivered; body is read on demand, not injected" } });
	for (const tool of input.tools) {
		const owner = plan.contributions.find((entry) => entry.contribution.kind === "tool" && entry.contribution.name === tool.name);
		const node = owner ? nodes.find((entry) => entry.id === owner.id || entry.contributionId === owner.id) : undefined;
		const evidence = { status: "delivered" as const, mode: inspection.adapterId === "pi" ? "direct" : inspection.adapterId === "omp" ? "host-bridge" : "session-tool-bridge", target: inspection.runtimeInstanceId, fidelity: "equivalent", generation: plan.generation! };
		if (node) { node.delivery = evidence; node.status = "delivered"; }
		add({ id: `runtime/tool:${tool.name}`, kind: "tool-schema", origin: owner ? "plugin" : "harness", ...(owner ? { pluginId: owner.pluginId, pluginRevision: owner.pluginRevision, contributionId: owner.id } : {}), context: { kind: "context", stage: "tools", description: tool.description, loading: "runtime" }, status: "delivered", selected: true, selectionReason: "adapter accepted controlled tool definition", delivery: evidence, fallback: tool.name,
			// A tool schema is a separate tool channel, never a system-prompt paragraph.
			content: { visibility: "inspector", redacted: true, text: JSON.stringify(redactSensitiveValue({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) } });
	}
	for (const report of inspection.delivery) {
		const owner = plan.contributions.find((entry) => {
			const name = entry.contribution.name ?? entry.contribution.id;
			return report.contributionId === entry.id || report.contributionId === `${entry.contribution.kind === "mcp-server" ? "mcp" : entry.contribution.kind}:${name}`;
		});
		const node = owner && nodes.find((entry) => entry.contributionId === owner.id || entry.id === owner.id);
		if (node) { node.delivery = delivery(report.contributionId); node.status = report.status; }
	}
	return freeze({ schemaVersion: 1, snapshotId: `build-${randomUUID()}`, kind: "actual", createdAt: new Date().toISOString(), piboSessionId: plan.piboSessionId, generation: plan.generation, plan: redactSensitiveValue(plan) as EffectivePluginPlan, nodes: redactSensitiveValue(nodes) as PluginBuildProvenanceNode[], boundaries: ["Recorded Pibo-controlled generation assembly, not a complete wire prompt.", "Native harness base prompt, internal history/compaction and external hooks are not observed.", "Skill bodies are progressive; tool schemas and inspector metadata are not system prompt text."] });
}
export function persistPluginContextBuild(store: PluginStore, snapshot: PluginContextBuildSnapshot): void {
	if (!snapshot.piboSessionId || !snapshot.generation || snapshot.kind !== "actual") throw new Error("Only actual generation snapshots can be persisted here");
	store.putBuildSnapshot({ piboSessionId: snapshot.piboSessionId, generationId: snapshot.generation, snapshotId: snapshot.snapshotId, kind: "actual", data: snapshot, createdAt: snapshot.createdAt });
}
export function persistPluginHookEvidence(store: PluginStore, evidence: PluginHookEvidence): void {
	store.putBuildSnapshot({ piboSessionId: evidence.piboSessionId, generationId: evidence.generation, snapshotId: `hook-${evidence.id}`, kind: "actual", data: evidence, createdAt: new Date().toISOString() });
}
/** Web API helper: actual is persisted history; preview is explicitly requested and pure. */
export function inspectPluginBuildContext(input: { store: PluginStore; piboSessionId: string; snapshotId?: string; preview?: { coordinator: PluginRuntimeCoordinator; profile: InitialSessionContext; runtime: PluginRuntimeTarget } }): { actual: PluginContextBuildSnapshot | null; preview: PluginContextBuildSnapshot | null; diagnostic?: string } {
	const candidates = input.snapshotId ? [input.snapshotId] : input.store.listBuildSnapshots(input.piboSessionId).filter((item) => item.kind === "actual" && item.snapshotId.startsWith("build-")).map((item) => item.snapshotId).reverse();
	let actual: PluginContextBuildSnapshot | null = null;
	for (const id of candidates) {
		const stored = input.store.getBuildSnapshot(input.piboSessionId, id);
		const data = stored?.data as PluginContextBuildSnapshot | undefined;
		if (stored?.kind === "actual" && data?.schemaVersion === 1 && data.kind === "actual" && Array.isArray(data.nodes)) { actual = structuredClone(data); break; }
	}
	const preview = input.preview ? buildPluginContextPreview(input.preview.coordinator.preview(input.preview.profile, input.preview.runtime, input.piboSessionId)) : null;
	return { actual, preview, ...(!actual ? { diagnostic: "No recorded build exists; legacy generation composition is unknown, not reconstructed." } : {}) };
}

/** Copy channels are explicit. No metadata or tool schema is mixed into model context text. */
export function exportPluginContextBuild(snapshot: PluginContextBuildSnapshot): { modelText: string; metadata: unknown; completeWirePrompt: false } {
	return { modelText: snapshot.nodes.filter((node) => node.content?.visibility === "model" && ["delivered", "degraded"].includes(node.status)).map((node) => node.content!.text ?? "").filter(Boolean).join("\n\n"), metadata: redactSensitiveValue(snapshot), completeWirePrompt: false };
}
