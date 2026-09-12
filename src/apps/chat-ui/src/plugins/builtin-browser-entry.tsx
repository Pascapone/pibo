/** Ordinary prebuilt browser entry. Build alongside the app with shared React/query/router chunks. */
import { useEffect, useState } from "react";
import { ContextFilesView } from "../context/ContextFilesView";
import { BasePromptView } from "../context/BasePromptView";
import { CompactionPromptView } from "../context/CompactionPromptView";
import { UserSkillsSettings } from "../settings/SettingsView";
import { AgentsView } from "../agents/AgentsView";
import { WorkflowsArea } from "../WorkflowsArea";
import { CronArea } from "../CronArea";
import { LoopArea } from "../LoopArea";
import { getBootstrap, postSession } from "../api-chat-sessions";
import type { BootstrapData } from "../types";
import type { PluginViewProps } from "./browser-host";
export { BuildContextView } from "./build-context-view";

function useBoundBootstrap(props: PluginViewProps) {
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null); const [error, setError] = useState<string | null>(null);
	const refresh = () => { void getBootstrap(props.piboSessionId, false, props.roomId, false, { signal: props.signal }).then((data) => { if (!props.signal.aborted) setBootstrap(data); }).catch((error) => { if (!props.signal.aborted) setError(String(error)); }); };
	useEffect(refresh, [props.piboSessionId, props.signal]);
	return { bootstrap, refresh, error };
}
export function UserResourcesView(props: PluginViewProps) {
	const { bootstrap, refresh, error } = useBoundBootstrap(props);
	const profiles = bootstrap?.agents.map((agent) => agent.name) ?? [];
	const subview = props.tab.subviewId;
	if (error) return <p role="alert">{error}</p>;
	if (subview === "skills") return <div className="p-3"><p className="mb-2 text-xs text-slate-400">User-owned skills · app scope · independent of resource plugins</p><UserSkillsSettings skills={bootstrap?.agentCatalog?.userSkills} onSkillChanged={refresh} onSkillRemoved={refresh} /></div>;
	if (subview === "base-prompt") return <BasePromptView />;
	if (subview === "compaction-prompt") return <CompactionPromptView />;
	return <ContextFilesView agentProfiles={profiles} selectedFileKey={typeof props.state.selectedFileKey === "string" ? props.state.selectedFileKey : undefined} />;
}
export function AgentDesignerView(props: PluginViewProps) {
	const { bootstrap, refresh, error } = useBoundBootstrap(props);
	const [creating, setCreating] = useState(false);
	if (error) return <p role="alert">{error}</p>;
	if (!bootstrap) return <p role="status">Loading agent definitions…</p>;
	return <AgentsView agents={bootstrap.agents} initialCustomAgents={bootstrap.customAgents} initialAgentFolders={bootstrap.agentFolders} initialCatalog={bootstrap.agentCatalog} modelCatalog={bootstrap.modelCatalog} onCreateSession={(profile) => { setCreating(true); void postSession(profile, props.roomId).then((result) => { location.assign(`/sessions/${encodeURIComponent(result.session.id)}`); }).finally(() => setCreating(false)); }} onEditContextFile={(fileKey) => { window.dispatchEvent(new CustomEvent("pibo:plugin-navigation", { detail: { piboSessionId: props.piboSessionId, legacyArea: "context", state: { selectedFileKey: fileKey } } })); }} onEditMcpServer={() => window.dispatchEvent(new CustomEvent("pibo:plugin-navigation", { detail: { piboSessionId: props.piboSessionId, legacyArea: "mcp-tools" } }))} onAgentsChanged={refresh} onAutosaveHandlerChange={(save) => { if (save) props.signal.addEventListener("abort", () => { void save(); }, { once: true }); }} creatingSession={creating} mobileSidebarOpen={false} isMobileSidebarViewport={false} onCloseMobileSidebar={() => undefined} surface="tab" />;
}
export function WorkflowsView(props: PluginViewProps) {
	return <WorkflowsArea draftId={typeof props.state.draftId === "string" ? props.state.draftId : undefined} viewWorkflowId={typeof props.state.viewWorkflowId === "string" ? props.state.viewWorkflowId : undefined} viewWorkflowVersion={typeof props.state.viewWorkflowVersion === "string" ? props.state.viewWorkflowVersion : undefined} />;
}
export function CronView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <CronArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading cron…"}</p>;
}
export function LoopsView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <LoopArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading loops…"}</p>;
}
