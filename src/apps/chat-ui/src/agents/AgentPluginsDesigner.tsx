import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { EffectivePluginPlan, PluginConfigurationTarget, PluginQualifiedId } from "../../../../plugins/sdk.js";
import { getAgentPluginCatalog, previewAgentPlugins, type AgentPluginCatalog } from "../api-agent-designer";
import { acceptAgentPluginRevision, setAgentPluginContribution, setAgentPluginEnabled, type AgentDraft } from "./agent-designer-model";
import { CatalogToggle, DesignerPanel } from "./designer-ui";

export type AgentPluginSettingsTarget = {
	piboSessionId: string; pluginId: string; viewId: PluginQualifiedId; subviewId: string; configurationTarget: PluginConfigurationTarget;
};
export function AgentPluginsDesigner({ draft, setDraft, readOnly, piboSessionId, sessionProfileName, onOpenPluginSettings }: {
	draft: AgentDraft; setDraft: Dispatch<SetStateAction<AgentDraft>>; readOnly: boolean;
	piboSessionId?: string; sessionProfileName?: string; onOpenPluginSettings?: (target: AgentPluginSettingsTarget) => void;
}) {
	const [catalog, setCatalog] = useState<AgentPluginCatalog>();
	const [plan, setPlan] = useState<EffectivePluginPlan>();
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
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
	const selection = draft.pluginSelection;
	return <DesignerPanel title="Plugins">
		<div className="text-xs text-slate-400">Selection applies to future runtime generations. Running sessions keep their pinned plugin revisions.</div>
		{!selection ? <div role="alert" className="text-sm text-amber-200">Legacy selection needs an explicit migration. No plugin defaults have been enabled.</div> : null}
		{draft.pluginMigration ? <details className="border border-slate-700 p-2 text-xs">
			<summary>Migration: {draft.pluginMigration.status} · {draft.pluginMigration.beforeTools.length} previous tools / {draft.pluginMigration.afterTools.length} migrated tools</summary>
			{draft.pluginMigration.diagnostics.map((item, index) => <p key={index}>{item.message}</p>)}
			{draft.pluginMigration.inactivePiPackages.length ? <p>Inactive legacy Pi packages: {draft.pluginMigration.inactivePiPackages.join(", ")}. Original data is backed up; no package code is loaded.</p> : null}
		</details> : null}
		{error ? <div role="alert" className="text-xs text-amber-200">Plugin preview unavailable: {error}</div> : null}
		<div role="status" className="text-xs text-slate-400">{pending ? "Checking server runtime requirements…" : plan ? plan.valid ? "Server preview valid" : "Activation blocked — see contribution reasons" : "No server preview"}</div>
		{plan?.diagnostics.map((item, index) => <p key={`${item.code}:${index}`} className="text-xs text-amber-200">{item.message}</p>)}
		{catalog?.plugins.map((plugin) => {
			const entry = selection?.plugins.find((item) => item.pluginId === plugin.pluginId);
			const agentContributions = plugin.contributions.filter((item) => item.scope === "agent");
			const changedRevision = !!entry && entry.revision !== plugin.revision;
			return <section key={plugin.pluginId} className="border border-slate-700 rounded-sm p-3 space-y-2" aria-label={`Plugin ${plugin.name}`}>
				{agentContributions.length ? <CatalogToggle title={plugin.name} checked={entry?.enabled ?? false}
					description={`${plugin.pluginId} · ${plugin.version} · ${plugin.state}`} meta={entry ? `Pinned ${entry.revision}` : "Not selected"}
					disabled={readOnly || !selection || (!entry?.enabled && (!plugin.enabled || !["active", "pending-activation"].includes(plugin.state)))}
					onToggle={() => setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: setAgentPluginEnabled(current.pluginSelection, plugin, !entry?.enabled) } : current)} />
					: <div className="text-sm">{plugin.name}<span className="ml-2 text-xs text-slate-400">App infrastructure — no agent tools</span></div>}
				{changedRevision ? <div className="text-xs text-amber-200">Installed revision changed. Existing selection is preserved.
					<button type="button" disabled={readOnly} className="ml-2 underline" onClick={() => {
						if (window.confirm(`Accept revision ${plugin.revision} of ${plugin.name}? Required contributions become selected. New optional contributions stay off.`)) setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: acceptAgentPluginRevision(current.pluginSelection, plugin) } : current);
					}}>Review and accept revision</button></div> : null}
				<ul className="space-y-2">
					{plugin.contributions.map((contribution) => {
						const node = plan?.nodes.find((item) => item.contributionId === `${plugin.pluginId}/${contribution.id}`);
						const required = node?.required ?? contribution.required;
						return <li key={contribution.id} className="border-t border-slate-800 pt-2">
							<label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-[#11a4d4]"
								aria-label={`${plugin.name}: ${contribution.title ?? contribution.name ?? contribution.id}${required ? " (required)" : " (optional)"}`}
								checked={contribution.scope === "app" ? node?.selected ?? false : entry?.contributions[contribution.id] === true}
								disabled={readOnly || required || contribution.scope === "app" || !entry?.enabled || changedRevision}
								onChange={(event) => setDraft((current) => current.pluginSelection ? { ...current, pluginSelection: setAgentPluginContribution(current.pluginSelection, plugin.pluginId, contribution, event.target.checked) } : current)} />
								<span>{contribution.title ?? contribution.name ?? contribution.id}<span className="block text-xs text-slate-400">{contribution.kind} · {contribution.scope === "app" ? "App infrastructure" : required ? "Required" : "Optional"} · {plugin.pluginId}/{contribution.id}</span></span></label>
							<p className="ml-5 text-xs text-slate-400">{node ? `${node.status}: ${node.selectionReason}` : "Awaiting server runtime preview"}</p>
						</li>;
					})}
				</ul>
				{plugin.contributions.flatMap((view) => (view.view?.subviews ?? []).filter((subview) => subview.purpose !== "content").flatMap((subview) => (subview.settingsScopes ?? []).map((scope) => {
					const target: PluginConfigurationTarget | undefined = scope === "app" ? { scope, pluginId: plugin.pluginId }
						: scope === "agent" ? draft.id ? { scope, pluginId: plugin.pluginId, agentId: draft.id } : undefined
							: piboSessionId ? { scope, pluginId: plugin.pluginId, piboSessionId } : undefined;
					return <button key={`${view.id}:${subview.id}:${scope}`} type="button" className="mr-3 text-xs text-[#11a4d4] underline disabled:text-slate-500"
						disabled={!piboSessionId || !target || !onOpenPluginSettings}
						onClick={() => { if (piboSessionId && target) onOpenPluginSettings?.({ piboSessionId, pluginId: plugin.pluginId, viewId: `${plugin.pluginId}/${view.id}`, subviewId: subview.id, configurationTarget: target }); }}>
						{subview.title} · {scope === "agent" ? `agent ${draft.profileName ?? draft.displayName}` : scope === "session" ? `session ${piboSessionId ?? "not selected"}` : "app-wide"}
					</button>;
				})))}
			</section>;
		})}
		{selection?.plugins.filter((entry) => !catalog?.plugins.some((plugin) => plugin.pluginId === entry.pluginId)).map((entry) => <div key={entry.pluginId} className="border border-amber-700 p-3 text-xs text-amber-200">
			{entry.pluginId} · pinned {entry.revision} · {entry.enabled ? "selected" : "disabled"} · missing from catalog. Reference and configuration retained.
			{Object.entries(entry.contributions).map(([id, enabled]) => <p key={id}>{id}: {enabled ? "selected" : "disabled"}</p>)}
		</div>)}
		{!piboSessionId ? <p className="text-xs text-slate-400">Select a session to open plugin settings in its fixed session tab.</p> : <p className="text-xs text-slate-400">Settings open in session {piboSessionId}{sessionProfileName && sessionProfileName !== draft.profileName ? ` (${sessionProfileName}); agent-scoped edits still target ${draft.profileName ?? draft.displayName}` : ""}.</p>}
	</DesignerPanel>;
}
