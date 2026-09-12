import { useEffect, useState } from "react";
import type { PluginConfigurationSnapshot, PluginConfigurationTarget, PluginJsonObject, PluginSettingsScope } from "../../../../plugins/sdk";
import { PluginHttpError, pluginRequest } from "./session-tab-controller";

export function pluginConfigurationPath(target: PluginConfigurationTarget) {
	const targetId = target.scope === "agent" ? target.agentId : target.scope === "session" ? target.piboSessionId : "app";
	return `/api/chat/plugins/${encodeURIComponent(target.pluginId)}/config?${new URLSearchParams({ scope: target.scope, targetId })}`;
}
export function PluginSettings({ pluginId, piboSessionId, agentId, scopes }: { pluginId: string; piboSessionId: string; agentId?: string; scopes: PluginSettingsScope[] }) {
	const [scope, setScope] = useState<PluginSettingsScope>(scopes.includes("session") ? "session" : scopes[0] ?? "app");
	const target: PluginConfigurationTarget | null = scope === "agent" ? agentId ? { scope, pluginId, agentId } : null : scope === "session" ? { scope, pluginId, piboSessionId } : { scope, pluginId };
	return <section className="border-b border-slate-700 p-3 text-xs" aria-label="Plugin configuration">
		<label className="flex flex-wrap items-center gap-2">Configuration scope <select className="bg-[#151f24] border border-slate-600 p-1" value={scope} onChange={(event) => setScope(event.target.value as PluginSettingsScope)}>{scopes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
		{target ? <ConfigurationEditor key={JSON.stringify(target)} target={target} /> : <p role="status">This session has no editable agent target.</p>}
	</section>;
}
function ConfigurationEditor({ target }: { target: PluginConfigurationTarget }) {
	const [snapshot, setSnapshot] = useState<PluginConfigurationSnapshot | null>(null);
	const [text, setText] = useState(""); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [conflict, setConflict] = useState(false);
	const path = pluginConfigurationPath(target);
	useEffect(() => {
		const abort = new AbortController();
		void pluginRequest<{ configuration: PluginConfigurationSnapshot | null }>(path, { signal: abort.signal }).then(({ configuration }) => {
			if (abort.signal.aborted) return;
			const next = configuration ?? { target, revision: 0, schemaVersion: 1, values: {} };
			setSnapshot(next); setText(JSON.stringify(next.values, null, 2));
		}).catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
		return () => abort.abort();
	}, [path]);
	const save = async () => {
		if (!snapshot || saving || conflict) return;
		setSaving(true); setError(null);
		try {
			const values: unknown = JSON.parse(text);
			if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Configuration must be a JSON object");
			// target/path and revision are captured by this editor instance, never read from current selection.
			const { configuration } = await pluginRequest<{ configuration: PluginConfigurationSnapshot }>(path, { method: "PUT", body: JSON.stringify({ configuration: { ...snapshot, target, values: values as PluginJsonObject }, expectedRevision: snapshot.revision }) });
			setSnapshot(configuration);
		} catch (error) { setError(error instanceof Error ? error.message : String(error)); setConflict(error instanceof PluginHttpError && error.status === 409); }
		finally { setSaving(false); }
	};
	return <div className="mt-2 space-y-2">
		<p className="font-mono break-all">Target: {target.scope === "agent" ? target.agentId : target.scope === "session" ? target.piboSessionId : "App · all agents and sessions"}</p>
		<p className="text-slate-400">Saved defaults apply at the next generation boundary. Active generation snapshots are unchanged.</p>
		<textarea aria-label="Plugin configuration JSON" spellCheck={false} className="w-full min-h-32 bg-[#0e1116] border border-slate-600 p-2 font-mono" value={text} onChange={(event) => setText(event.target.value)} disabled={!snapshot || conflict} />
		<button type="button" className="border border-slate-600 rounded-sm px-2 py-1 disabled:opacity-50" disabled={!snapshot || saving || conflict} onClick={() => void save()}>{saving ? "Saving…" : `Save ${target.scope} configuration`}</button>
		{error ? <p role="alert" className="text-orange-300">{conflict ? "Another browser changed this configuration. Copy your edits, then reopen this subview to reload. " : ""}{error}</p> : null}
	</div>;
}
