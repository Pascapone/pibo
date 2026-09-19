import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { EffectivePluginPlan, PluginContribution, PluginDiagnostic, PluginRuntimeRequirement } from "../../../../plugins/sdk.js";
import { getAgentPluginCatalog, previewAgentPlugins, type AgentPluginCatalog } from "../api-agent-designer";
import { acceptAgentPluginRevision, buildPluginBuiltinToolReplacementMap, setAgentPluginContribution, setAgentPluginEnabled, type AgentDraft } from "./agent-designer-model";
import { DesignerPanel } from "./designer-ui";

const CATEGORY_ORDER = ["Tools", "Skills", "Context", "Subagents", "Views", "MCP", "Input handling", "Other"];
function contributionCategory(contribution: PluginContribution): string {
	if (contribution.kind === "tool") return "Tools";
	if (contribution.kind === "skill") return "Skills";
	if (contribution.kind === "context-file") return "Context";
	if (contribution.kind === "subagent") return "Subagents";
	if (contribution.kind === "view" || contribution.kind === "terminal-card" || contribution.kind === "renderer") return "Views";
	if (contribution.kind.startsWith("mcp")) return "MCP";
	if (contribution.kind === "hook") return "Input handling";
	return "Other";
}
function contributionLabel(contribution: PluginContribution): string {
	return contribution.title ?? contribution.name?.replaceAll("_", " ") ?? contribution.id.replaceAll("-", " ");
}
function runtimeRequirementText(runtime: PluginRuntimeRequirement | undefined): string | undefined {
	if (!runtime) return undefined;
	const parts: string[] = [];
	if (runtime.adapterIds?.length) parts.push(`adapters: ${runtime.adapterIds.join(", ")}`);
	if (runtime.instanceIds?.length) parts.push(`instances: ${runtime.instanceIds.join(", ")}`);
	if (runtime.capabilities?.length) parts.push(`capabilities: ${runtime.capabilities.join(", ")}`);
	if (runtime.deliveryModes?.length) parts.push(`delivery modes: ${runtime.deliveryModes.join(", ")}`);
	return parts.length ? `Requires ${parts.join(" · ")}` : undefined;
}
function diagnosticTone(severity: PluginDiagnostic["severity"]): string {
	return severity === "error" ? "text-red-200" : "text-amber-200";
}

export function AgentPluginsDesigner({ draft, setDraft, readOnly, onBuiltinToolReplacementsChange }: {
	draft: AgentDraft; setDraft: Dispatch<SetStateAction<AgentDraft>>; readOnly: boolean;
	onBuiltinToolReplacementsChange?: (replacements: Map<string, string[]>) => void;
}) {
	const [catalog, setCatalog] = useState<AgentPluginCatalog>();
	const [plan, setPlan] = useState<EffectivePluginPlan>();
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const [openPlugins, setOpenPlugins] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		let current = true;
		void getAgentPluginCatalog().then((result) => { if (current) setCatalog(result.catalog); }).catch((caught) => { if (current) setError(String(caught)); });
		return () => { current = false; };
	}, []);
	const previewKey = JSON.stringify({ agentId: draft.id, expectedRevision: draft.revision, runtimeInstanceId: draft.runtimeInstanceId,
		pluginSelection: draft.pluginSelection, skills: draft.skills, contextFiles: draft.contextFiles, subagents: draft.subagents,
		builtinTools: draft.builtinTools, builtinToolNames: draft.builtinToolNames });
	useEffect(() => {
		let current = true;
		setPlan(undefined);
		if (!draft.pluginSelection) { setPending(false); return; }
		setPending(true);
		const timer = window.setTimeout(() => {
			void previewAgentPlugins({ schemaVersion: 2, ...JSON.parse(previewKey) }).then((result) => {
				if (current) { setPlan(result.plan); setError(undefined); }
			}).catch((caught) => { if (current) setError(String(caught)); }).finally(() => { if (current) setPending(false); });
		}, 150);
		return () => { current = false; window.clearTimeout(timer); };
	}, [previewKey, catalog?.revision]);
	const replacements = useMemo(() => buildPluginBuiltinToolReplacementMap(plan), [plan]);
	useEffect(() => {
		onBuiltinToolReplacementsChange?.(replacements);
		return () => onBuiltinToolReplacementsChange?.(new Map());
	}, [onBuiltinToolReplacementsChange, replacements]);
	const togglePluginCard = (pluginId: string) => {
		setOpenPlugins((current) => {
			const next = new Set(current);
			if (next.has(pluginId)) next.delete(pluginId); else next.add(pluginId);
			return next;
		});
	};
	// Diagnostics render where the problem is: per plugin card and per
	// capability. Only unattributed diagnostics stay at the top.
	const { diagnosticsByPlugin, globalDiagnostics, blockedPluginCount } = useMemo(() => {
		const byPlugin = new Map<string, PluginDiagnostic[]>();
		const global: PluginDiagnostic[] = [];
		const known = new Set((catalog?.plugins ?? []).map((plugin) => plugin.pluginId));
		for (const diagnostic of plan?.diagnostics ?? []) {
			if (diagnostic.pluginId && known.has(diagnostic.pluginId)) {
				byPlugin.set(diagnostic.pluginId, [...byPlugin.get(diagnostic.pluginId) ?? [], diagnostic]);
			} else {
				global.push(diagnostic);
			}
		}
		const blocked = [...byPlugin.values()].filter((items) => items.some((item) => item.severity === "error")).length;
		return { diagnosticsByPlugin: byPlugin, globalDiagnostics: global, blockedPluginCount: blocked };
	}, [plan, catalog]);
	const selection = draft.pluginSelection;
	return <DesignerPanel title="Plugins">
		<div className="text-xs text-slate-400">Choose only capabilities delivered to this agent. Installation, system services, workspace modules, and configuration are managed separately.</div>
		{draft.pluginMigration?.status === "conflict" ? <div role="alert" className="space-y-2 border border-amber-700/60 bg-amber-950/20 p-3 text-sm text-amber-100">
			<p>Automatic Pibo 4.0 migration is blocked for this agent. Its previous configuration and resource backup are retained, and runtime admission remains disabled until the listed ownership conflict is repaired.</p>
		</div> : null}
		{draft.pluginMigration ? <details className="border border-slate-700 p-2 text-xs">
			<summary>Previous selection migration · {draft.pluginMigration.status}</summary>
			<p className="mt-2">{draft.pluginMigration.beforeTools.length} previous tools / {draft.pluginMigration.afterTools.length} migrated tools</p>
			{draft.pluginMigration.diagnostics.map((item, index) => <p key={index}>{item.message}</p>)}
			{draft.pluginMigration.inactivePiPackages.length ? <p>Inactive legacy Pi packages: {draft.pluginMigration.inactivePiPackages.join(", ")}. Original data is backed up; no package code is loaded.</p> : null}
		</details> : null}
		{error ? <div role="alert" className="text-xs text-amber-200">{error}</div> : null}
		<div role="status" className="text-xs text-slate-400">{pending ? "Checking runtime support…" : plan ? plan.valid ? "Selection is supported" : "Selection is blocked — review the reasons below" : draft.pluginMigration?.status === "conflict" ? "Automatic migration blocked" : selection ? "No server preview" : "Selection unavailable"}</div>
		{globalDiagnostics.map((item, index) => <p key={`${item.code}:${index}`} className={`text-xs ${diagnosticTone(item.severity)}`}>{item.message}</p>)}
		{blockedPluginCount > 0 ? <p role="status" className="text-xs text-slate-400">{blockedPluginCount} {blockedPluginCount === 1 ? "plugin is" : "plugins are"} blocked — details at {blockedPluginCount === 1 ? "the plugin" : "each plugin"} below</p> : null}
		{catalog?.plugins.map((plugin) => {
			const entry = selection?.plugins.find((item) => item.pluginId === plugin.pluginId);
			const changedRevision = !!entry && entry.revision !== plugin.revision;
			const open = openPlugins.has(plugin.pluginId);
			const selectedCount = plugin.contributions.filter((contribution) => entry?.contributions[contribution.id] === true).length;
			const pluginDiagnostics = diagnosticsByPlugin.get(plugin.pluginId) ?? [];
			const pluginBlocked = pluginDiagnostics.some((item) => item.severity === "error");
			const pluginWarned = !pluginBlocked && pluginDiagnostics.length > 0;
			const bannerMessages = [...new Map(pluginDiagnostics.map((item) => {
				const key = `${item.severity}:${item.message}`;
				const count = pluginDiagnostics.filter((other) => other.severity === item.severity && other.message === item.message).length;
				return [key, { severity: item.severity, message: count > 1 ? `${item.message} (${count} capabilities)` : item.message }];
			})).values()];
			const categories = new Map<string, PluginContribution[]>();
			for (const contribution of plugin.contributions) {
				const category = contributionCategory(contribution);
				categories.set(category, [...categories.get(category) ?? [], contribution]);
			}
			return <section key={plugin.pluginId} data-agent-plugin-card className="overflow-hidden rounded-sm border border-slate-700 bg-[#151f24]" aria-label={`Plugin ${plugin.name}`}>
				<div className="flex items-center gap-2 p-2">
					<button type="button" aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => togglePluginCard(plugin.pluginId)}>
						<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-slate-700 text-slate-400">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
						<span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-100">{plugin.name}</span><span className="block text-xs text-slate-500">{entry?.enabled ? `${selectedCount} of ${plugin.contributions.length} capabilities selected` : "Not selected for this agent"}{changedRevision ? " · update review required" : ""}{pluginBlocked ? " · blocked" : pluginWarned ? " · needs attention" : ""}</span></span>
					</button>
					<button type="button" aria-pressed={entry?.enabled ?? false} disabled={readOnly || !selection || changedRevision || (!entry?.enabled && (!plugin.enabled || !["active", "pending-activation"].includes(plugin.state)))} className={`shrink-0 border px-2 py-1 text-xs disabled:opacity-50 ${entry?.enabled ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]" : "border-slate-700 text-slate-400"}`} onClick={() => setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: setAgentPluginEnabled(current.pluginSelection, plugin, !entry?.enabled) } : current)}>{entry?.enabled ? "Selected" : "Select"}</button>
				</div>
				{changedRevision ? <div className="border-t border-amber-800/50 p-2 text-xs text-amber-200">An installed update changed this plugin. Existing choices are preserved until review.
					<button type="button" disabled={readOnly} className="ml-2 underline" onClick={() => { if (window.confirm(`Accept the installed update for ${plugin.name}? Required capabilities become selected; new optional capabilities stay off.`)) setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: acceptAgentPluginRevision(current.pluginSelection, plugin) } : current); }}>Review update</button></div> : null}
				{bannerMessages.length > 0 ? <ul className="grid gap-1 border-t border-amber-800/50 p-2 text-xs">{bannerMessages.map((item, index) => <li key={index} className={diagnosticTone(item.severity)}>{item.message}</li>)}</ul> : null}
				{open ? <div className="grid gap-3 border-t border-slate-800 p-3">{CATEGORY_ORDER.flatMap((category) => {
					const contributions = categories.get(category); if (!contributions?.length) return [];
					return [<section key={category}><h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{category}</h4><ul className="grid gap-1">{contributions.map((contribution) => {
						const qualifiedId = `${plugin.pluginId}/${contribution.id}`;
						const node = plan?.nodes.find((item) => item.contributionId === qualifiedId);
						const required = node?.required ?? contribution.required;
						const checked = entry?.contributions[contribution.id] === true;
						const contributionDiagnostics = pluginDiagnostics.filter((item) => item.contributionId === qualifiedId);
						const freshDiagnostics = contributionDiagnostics.filter((item) => !(node?.selectionReason.includes(item.message) ?? false));
						const blockedNode = node?.status === "unsupported" || node?.status === "required-conflict";
						const requirement = (blockedNode || contributionDiagnostics.some((item) => item.code === "runtime-unsupported"))
							? runtimeRequirementText(contribution.runtime)
							: undefined;
						return <li key={contribution.id}><label className={`flex items-start gap-2 border border-slate-800 p-2 text-sm ${required ? "cursor-default" : "cursor-pointer"}`}><input type="checkbox" className="sr-only" aria-label={`${plugin.name}: ${contributionLabel(contribution)}${required ? " (required)" : " (optional)"}`} checked={checked} disabled={readOnly || required || !entry?.enabled || changedRevision} onChange={(event) => setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: setAgentPluginContribution(current.pluginSelection, plugin.pluginId, contribution, event.target.checked) } : current)} /><span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border ${checked ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-600 text-transparent"}`}>{checked ? <Check size={12} /> : null}</span><span><span className="text-slate-200">{contributionLabel(contribution)}</span><span className="block text-xs text-slate-500">{required ? "Required when this plugin is selected" : "Optional"}{node ? ` · ${node.selectionReason}` : ""}</span>{freshDiagnostics.map((item, index) => <span key={`${item.code}:${index}`} className={`block text-xs ${diagnosticTone(item.severity)}`}>{item.message}</span>)}{requirement ? <span className="block text-xs text-slate-500">{requirement}</span> : null}</span></label></li>;
					})}</ul></section>];
				})}</div> : null}
			</section>;
		})}
		{selection?.plugins.filter((entry) => !catalog?.plugins.some((plugin) => plugin.pluginId === entry.pluginId)).map((entry) => <div key={entry.pluginId} className="border border-amber-700 p-3 text-xs text-amber-200">
			A previously selected plugin is no longer installed. Its choices and configuration are retained for recovery.
			<ul className="mt-2 list-disc pl-4">{Object.entries(entry.contributions).map(([id, selected]) => <li key={id}>{id}: {selected ? "selected" : "not selected"}</li>)}</ul>
			<button type="button" disabled={readOnly} className="mt-2 block underline disabled:opacity-50" onClick={() => setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: { ...current.pluginSelection, plugins: current.pluginSelection.plugins.filter((item) => item.pluginId !== entry.pluginId) } } : current)}>Remove retained reference</button>
		</div>)}
	</DesignerPanel>;
}
