import { useEffect, useState } from "react";
import type { EffectivePluginPlan, PluginBuildProvenanceNode, PluginQualifiedId } from "../../../../plugins/sdk";
import { pluginRequest } from "./session-tab-controller";
import type { PluginViewProps } from "./browser-host";

type BuildRecord = { piboSessionId: string; generationId: string; snapshotId: string; kind: "actual" | "preview"; createdAt: string; data?: unknown };
export function recordedBuildNodes(data: unknown): PluginBuildProvenanceNode[] {
	if (!data || typeof data !== "object") return [];
	const object = data as { nodes?: unknown; plan?: { nodes?: unknown }; pluginProvenance?: { nodes?: unknown } };
	const nodes = object.nodes ?? object.pluginProvenance?.nodes ?? object.plan?.nodes;
	return Array.isArray(nodes) ? nodes.filter((node): node is PluginBuildProvenanceNode => Boolean(node) && node.schemaVersion === 1 && typeof node.id === "string" && typeof node.status === "string" && typeof node.fallback === "string") : [];
}
export function BuildContextView(props: PluginViewProps) {
	const [builds, setBuilds] = useState<BuildRecord[]>([]); const [nodes, setNodes] = useState<PluginBuildProvenanceNode[]>([]); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
	const selected = typeof props.state.snapshotId === "string" ? props.state.snapshotId : "";
	const [preview, setPreview] = useState(false);
	useEffect(() => {
		const abort = new AbortController();
		void pluginRequest<{ snapshots: BuildRecord[] }>(`/api/chat/sessions/${encodeURIComponent(props.piboSessionId)}/plugin-builds`, { signal: abort.signal }).then(({ snapshots }) => { if (!abort.signal.aborted) setBuilds(snapshots); }).catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
		return () => abort.abort();
	}, [props.piboSessionId]);
	useEffect(() => {
		if (!selected && !preview) { setNodes([]); return; }
		const abort = new AbortController(); setLoading(true); setError(null); setNodes([]);
		const base = `/api/chat/sessions/${encodeURIComponent(props.piboSessionId)}`;
		const load = preview
			? pluginRequest<{ plan: EffectivePluginPlan }>(`${base}/plugin-plan?kind=preview`, { signal: abort.signal }).then(({ plan }) => { if (plan.kind !== "preview" || plan.piboSessionId !== props.piboSessionId) throw new Error("Expected a pure preview for this session"); return plan.nodes; })
			: pluginRequest<{ snapshot: BuildRecord }>(`${base}/plugin-builds/${encodeURIComponent(selected)}`, { signal: abort.signal }).then(({ snapshot }) => { if (snapshot.piboSessionId !== props.piboSessionId) throw new Error("Snapshot session mismatch"); return recordedBuildNodes(snapshot.data); });
		void load.then((next) => { if (!abort.signal.aborted) setNodes(next); }).catch((error) => { if (!abort.signal.aborted) setError(String(error)); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
		return () => abort.abort();
	}, [props.piboSessionId, selected, preview]);
	const copyModelContent = async (node: PluginBuildProvenanceNode) => {
		const content = renderPluginNodeModelContentForCopy(node);
		if (!content) return;
		try {
			await navigator.clipboard.writeText(content);
			setCopiedNodeId(node.id);
			window.setTimeout(() => setCopiedNodeId((current) => current === node.id ? null : current), 1200);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};
	return <section className="h-full overflow-auto p-3 space-y-3 text-xs" data-plugin-build-context>
		<h2 className="font-bold uppercase">Build Context</h2>
		<p className="font-mono break-all">Session {props.piboSessionId}</p>
		<div className="flex flex-wrap gap-2"><select aria-label="Recorded build" className="bg-[#151f24] border border-slate-600 max-w-full p-1" value={selected} onChange={(event) => { setPreview(false); props.updateState({ ...props.state, snapshotId: event.target.value }); }}><option value="">Select recorded build</option>{builds.map((build) => <option key={build.snapshotId} value={build.snapshotId}>{build.kind} · {build.createdAt} · {build.generationId}</option>)}</select><button className="border border-slate-600 p-1" onClick={() => setPreview(true)}>Pure preview of next build</button></div>
		<p className="text-cyan-300">{preview ? "Preview · current resolution only, not delivered context" : "Recorded snapshot · immutable generation evidence"}</p>
		<p className="text-slate-400">Reading this inspector does not start a runtime, connect MCP, or execute hooks. Inspector metadata is not model prompt text.</p>
		{loading ? <p role="status">Loading recorded evidence…</p> : null}{error ? <p role="alert" className="text-orange-300">{error}</p> : null}
		{!loading && !nodes.length ? <p>No recorded nodes for this selection. Missing evidence is not reconstructed from today’s catalog.</p> : null}
		{[...nodes].sort((a, b) => a.order - b.order).map((node) => <BuildNode key={node.id} node={node} copied={copiedNodeId === node.id} onCopy={() => { void copyModelContent(node); }} onOpen={props.openView} />)}
	</section>;
}
export function renderPluginNodeModelContentForCopy(node: PluginBuildProvenanceNode): string {
	if (node.content?.visibility !== "model" || node.content.redacted || !node.content.text) return "";
	return node.content.text;
}

function BuildNode({ node, copied, onCopy, onOpen }: { node: PluginBuildProvenanceNode; copied: boolean; onCopy: () => void; onOpen: (id: PluginQualifiedId, subview?: string) => void }) {
	return <details className="border border-slate-700 rounded-sm"><summary className="p-2 cursor-pointer flex flex-wrap gap-2"><span className="font-mono text-slate-500">{node.order}</span><span>{node.fallback}</span><span className="text-cyan-300">{node.status}</span><span className="text-slate-400">{node.origin}</span></summary>
		<div className="p-2 space-y-2 border-t border-slate-700"><p className="font-mono break-all">{node.id} · {node.pluginRevision ?? node.origin}</p><p>{node.selectionReason}</p><p>Installed: {String(node.installed ?? "unknown")} · Global: {String(node.globallyActive ?? "unknown")} · Agent: {String(node.agentSelected ?? "unknown")} · Effective: {String(node.selected)} · Required: {String(node.required ?? false)}</p>
		<p>{node.context.kind === "none" ? `No context effect: ${node.context.reason}` : `${node.context.stage} · ${node.context.loading} · ${node.context.description}`}</p>
		{node.content ? <><p>{node.content.visibility} · {node.content.redacted ? "redacted" : "not redacted"}</p><pre className="whitespace-pre-wrap break-words bg-[#0e1116] p-2">{node.content.redacted ? "Content redacted" : node.content.text ?? node.content.unavailableReason ?? `Payload reference: ${node.content.payloadRef ?? "unavailable"}`}</pre></> : <p>Content was not recorded.</p>}
		{node.delivery ? <p>Delivery: {node.delivery.status} · {node.delivery.mode} → {node.delivery.target} · {node.delivery.fidelity} · generation {node.delivery.generation} {node.delivery.diagnostic}</p> : <p>No delivery evidence recorded.</p>}
		{node.transformations?.map((item) => <p key={item.id}>{item.owner}: {item.operation} · {item.description}</p>)}
		{node.configurationRevisions?.map((item, index) => <p key={index}>Configuration {item.scope} revision {item.revision}</p>)}
		<p>Predecessors: {node.predecessors.join(", ") || "none"}</p>{node.tokens ? <p>{node.tokens.value} tokens ({node.tokens.method})</p> : null}
		<div className="flex flex-wrap gap-3">{renderPluginNodeModelContentForCopy(node) ? <button type="button" className="text-cyan-300 underline" onClick={onCopy}>{copied ? "Copied model content" : "Copy model content"}</button> : null}{node.contributionId ? <button type="button" className="text-cyan-300 underline" onClick={() => onOpen(node.contributionId!)}>Open owner plugin</button> : null}</div></div>
	</details>;
}
