import type { AgentPluginCatalog } from "../chat-ui/src/api-agent-designer-plugin-types.js";
export type { AgentPluginCatalog } from "../chat-ui/src/api-agent-designer-plugin-types.js";
import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import { CHAT_WEB_API_PREFIX } from "./chat-api-routes.js";
import { createAgentInput, createAgentUpdate, type ChatAgentBody } from "./chat-request-normalizers.js";
import type { CreateCustomAgentInput, UpdateCustomAgentInput } from "./agent-store.js";
import { LEGACY_AGENT_SELECTION_FIELDS, isUnresolvedAgentPluginMigration, type CustomAgentDefinition, type CustomAgentStore } from "./agent-store.js";
import { createAgentPluginSelection, validateAgentPluginSelection } from "../../plugins/selection.js";
import { resolvePluginContributions } from "../../plugins/resolution.js";
import { pluginJson, PluginConflictError } from "../../plugins/store.js";
import type { AgentPluginSelection, EffectivePluginPlan, IndependentPluginResource, PluginCatalog, PluginConfigurationSnapshot, PluginContribution, PluginResolutionInput, PluginRuntimeTarget } from "../../plugins/sdk.js";

export function buildAgentPluginCatalog(catalog: PluginCatalog): AgentPluginCatalog {
	return { schemaVersion: 1, revision: catalog.revision, plugins: catalog.installations.map((item) => ({
		pluginId: item.pluginId, name: item.manifest.name, revision: item.revision, version: item.version, state: item.state, enabled: item.enabled,
		contributions: structuredClone(item.manifest.contributions), initialSelection: createAgentPluginSelection([item]).plugins[0],
	})) };
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function validatePluginAgentMutation(body: unknown, existing?: CustomAgentDefinition): { schemaVersion: 2; pluginSelection?: AgentPluginSelection; expectedRevision?: number } {
	if (!record(body) || body.schemaVersion !== 2) throw new PiboWebHttpError("Agent payload schemaVersion 2 is required; legacy payloads need explicit migration", 400);
	for (const field of LEGACY_AGENT_SELECTION_FIELDS) if (Object.hasOwn(body, field)) throw new PiboWebHttpError(`Legacy field "${field}" cannot be written by agent API v2; use explicit migration`, 400);
	if (existing && !existing.pluginSelection) throw new PiboWebHttpError("Legacy agent must be journal-migrated before v2 mutation", 409);
	if (!existing && !Object.hasOwn(body, "pluginSelection")) throw new PiboWebHttpError("pluginSelection is required", 400);
	if (Object.hasOwn(body, "pluginSelection")) {
		const diagnostics = validateAgentPluginSelection(body.pluginSelection);
		if (diagnostics.length) throw new PiboWebHttpError(diagnostics.map((item) => item.message).join("; "), 400);
	}
	if (existing && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== existing.revision)) throw new PluginConflictError("Agent revision changed; reload before saving");
	if (!existing && body.expectedRevision !== undefined && body.expectedRevision !== 0) throw new PiboWebHttpError("New agents require expectedRevision 0 or no expectedRevision", 400);
	return { schemaVersion: 2, ...(Object.hasOwn(body, "pluginSelection") ? { pluginSelection: structuredClone(body.pluginSelection) as AgentPluginSelection } : {}),
		...(existing ? { expectedRevision: existing.revision } : {}) };
}

/** Existing model/folder/subagent normalizers retained, but their legacy defaults never reach v2 persistence. */
export function normalizePluginAgentCreate(body: unknown): CreateCustomAgentInput {
	const mutation = validatePluginAgentMutation(body);
	const normalized: CreateCustomAgentInput = createAgentInput(body as ChatAgentBody);
	for (const field of LEGACY_AGENT_SELECTION_FIELDS) delete (normalized as Record<string, unknown>)[field];
	return { ...normalized, schemaVersion: 2, pluginSelection: mutation.pluginSelection };
}
export function normalizePluginAgentUpdate(body: unknown, existing: CustomAgentDefinition): { update: UpdateCustomAgentInput; expectedRevision: number } {
	const mutation = validatePluginAgentMutation(body, existing);
	const normalized: UpdateCustomAgentInput = createAgentUpdate(body as ChatAgentBody);
	for (const field of LEGACY_AGENT_SELECTION_FIELDS) delete (normalized as Record<string, unknown>)[field];
	return { update: { ...normalized, ...(mutation.pluginSelection ? { pluginSelection: mutation.pluginSelection } : {}) }, expectedRevision: mutation.expectedRevision! };
}

export function agentIndependentResources(agent: Pick<CustomAgentDefinition, "skills" | "contextFiles" | "subagents" | "builtinTools" | "builtinToolNames">, runtime: PluginRuntimeTarget): IndependentPluginResource[] {
	return [
		...agent.skills.map((name, order): IndependentPluginResource => ({ id: `user-skill:${name}`, name, kind: "skill", origin: "user", reference: name, order,
			context: { kind: "context", stage: "skills", description: "Independent user skill", loading: "progressive" } })),
		...agent.contextFiles.map((name, order): IndependentPluginResource => ({ id: `user-context:${name}`, name, kind: "context-file", origin: "user", reference: name, order,
			context: { kind: "context", stage: "context", description: "Independent user context", loading: "eager" } })),
		...agent.subagents.map((subagent, order): IndependentPluginResource => ({ id: `manual-subagent:${subagent.name}`, name: subagent.name, kind: "subagent", origin: "manual", reference: subagent.targetProfile, order,
			metadata: JSON.parse(JSON.stringify(subagent)), context: { kind: "context", stage: "subagents", description: "Manual subagent configuration", loading: "runtime" } })),
		...(runtime.adapterId === "pi" && agent.builtinTools !== "disabled" ? agent.builtinToolNames.map((name): IndependentPluginResource => ({
			id: `harness-tool:${name}`, name, kind: "harness-tool", origin: "harness", reference: name, context: { kind: "none", reason: "Pi harness built-in" },
		})) : []),
	];
}
export type AgentPluginPreviewOptions = {
	agent: CustomAgentDefinition; catalog: PluginCatalog; runtime: PluginRuntimeTarget;
	configurations?: PluginConfigurationSnapshot[]; services?: Record<string, string>; providers?: PluginResolutionInput["providers"]; serviceProviders?: PluginResolutionInput["serviceProviders"];
};
export function resolveAgentPluginPreview(options: AgentPluginPreviewOptions): EffectivePluginPlan {
	if (!options.agent.pluginSelection) throw new PiboWebHttpError("Legacy agent needs an explicit plugin migration before activation", 409);
	const plan = resolvePluginContributions({ catalog: options.catalog, runtime: options.runtime, selection: options.agent.pluginSelection,
		selectionRevision: options.agent.revision, agentId: options.agent.id, kind: "preview", resources: agentIndependentResources(options.agent, options.runtime),
		configurations: options.configurations, services: options.services, providers: options.providers, serviceProviders: options.serviceProviders });
	if (isUnresolvedAgentPluginMigration(options.agent)) return { ...plan, valid: false, diagnostics: [...plan.diagnostics, {
		code: "legacy-migration-unresolved", severity: "error", path: [options.agent.id], message: "Legacy migration conflict requires an explicit reconciled plugin selection before activation",
	}] };
	return plan;
}
export function validateAgentPluginPlanMutation(options: AgentPluginPreviewOptions & { existing?: CustomAgentDefinition }): EffectivePluginPlan {
	const plan = resolveAgentPluginPreview(options);
	if (!plan.valid) {
		const resolutionFields = (agent: CustomAgentDefinition) => ({ pluginSelection: agent.pluginSelection, runtimeInstanceId: agent.runtimeInstanceId,
			runtimeOptions: agent.runtimeOptions, skills: agent.skills, contextFiles: agent.contextFiles, subagents: agent.subagents,
			builtinTools: agent.builtinTools, builtinToolNames: agent.builtinToolNames });
		// Preserve unresolved references when editing unrelated metadata. Never permit an activation through this exception.
		if (!options.existing || pluginJson(resolutionFields(options.existing)) !== pluginJson(resolutionFields(options.agent))) {
			throw new PiboWebHttpError(plan.diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; "), 400);
		}
	}
	return plan;
}
export type AgentPluginRoute = { kind: "catalog" } | { kind: "preview" };
export function agentPluginRoute(pathname: string, method: string): AgentPluginRoute | undefined {
	if (pathname === `${CHAT_WEB_API_PREFIX}/agent-plugin-catalog` && method === "GET") return { kind: "catalog" };
	if (pathname === `${CHAT_WEB_API_PREFIX}/agent-plugin-preview` && method === "POST") return { kind: "preview" };
	return undefined;
}
export async function handleAgentPluginRoute(options: {
	route: AgentPluginRoute; request: Request; agents: CustomAgentStore; catalog: PluginCatalog;
	resolveRuntime: (instanceId: string) => PluginRuntimeTarget | Promise<PluginRuntimeTarget>;
	configurations?: PluginConfigurationSnapshot[]; services?: Record<string, string>; providers?: PluginResolutionInput["providers"]; serviceProviders?: PluginResolutionInput["serviceProviders"];
}): Promise<Response> {
	if (options.route.kind === "catalog") return responseJson({ catalog: buildAgentPluginCatalog(options.catalog) });
	const body = await readJsonBody<Record<string, unknown>>(options.request);
	const existing = typeof body.agentId === "string" ? options.agents.get(body.agentId) : undefined;
	if (body.agentId !== undefined && !existing) throw new PiboWebHttpError("Agent not found", 404);
	const mutation = validatePluginAgentMutation(body, existing);
	if (typeof body.runtimeInstanceId !== "string" || !body.runtimeInstanceId.trim()) throw new PiboWebHttpError("runtimeInstanceId is required", 400);
	for (const key of ["skills", "contextFiles", "builtinToolNames"] as const) if (!Array.isArray(body[key]) || (body[key] as unknown[]).some((item) => typeof item !== "string")) throw new PiboWebHttpError(`${key} must be a string array`, 400);
	if (!Array.isArray(body.subagents) || body.subagents.some((item) => !record(item) || typeof item.name !== "string" || typeof item.targetProfile !== "string")) throw new PiboWebHttpError("Invalid manual subagents", 400);
	const runtime = await options.resolveRuntime(body.runtimeInstanceId);
	// Pure draft construction; no store update or runtime activation.
	const baseline = existing ?? { id: "preview", revision: 0, displayName: "preview", profileName: "preview", runtimeOptions: {}, skills: [], contextFiles: [], subagents: [], builtinTools: "default", builtinToolNames: [] } as unknown as CustomAgentDefinition;
	const agent = { ...baseline, pluginSelection: mutation.pluginSelection ?? baseline.pluginSelection, runtimeInstanceId: body.runtimeInstanceId,
		skills: body.skills as string[], contextFiles: body.contextFiles as string[], subagents: body.subagents as CustomAgentDefinition["subagents"],
		builtinTools: body.builtinTools === "disabled" ? "disabled" as const : "default" as const, builtinToolNames: body.builtinToolNames as string[] };
	return responseJson({ schemaVersion: 1, plan: resolveAgentPluginPreview({ ...options, agent, runtime }) });
}
