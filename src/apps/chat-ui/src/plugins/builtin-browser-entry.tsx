/** Ordinary prebuilt browser entry. Build alongside the app with shared React/query/router chunks. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ContextFilesView } from "../context/ContextFilesView";
import { BasePromptView } from "../context/BasePromptView";
import { CompactionPromptView } from "../context/CompactionPromptView";
import { SettingsView, UserSkillsSettings } from "../settings/SettingsView";
import { SettingsSidebar } from "../settings/SettingsSidebar";
import type { SettingsPanel } from "../settings/types";
import { AgentsView } from "../agents/AgentsView";
import { MinimalWorkflowsArea } from "../MinimalWorkflowsArea";
import { WorkflowVersionPanel } from "../desktop-workflow-version-panel";
import { CronArea } from "../CronArea";
import { LoopArea } from "../LoopArea";
import { getBootstrap } from "../api-chat-sessions";
import type { BootstrapData } from "../types";
import type { PluginBrowserSetup, PluginViewProps } from "./browser-host";
import { useSessionWebAnnotations } from "../use-session-web-annotations";
import { compactWebAnnotationError, WebAnnotationsControls, WebAnnotationsSessionPanel } from "../web-annotations";
import { readStoredDebugFeatures, readStoredDebugMode, readStoredExpandThinking, readStoredShowThinking, writeStoredDebugFeatures, writeStoredDebugMode, writeStoredExpandThinking, writeStoredShowThinking } from "../app-storage";
import { readStoredToolMetricThresholds, writeStoredToolMetricThresholds } from "../tool-metric-settings";
import { removeAgentCatalogUserSkill, upsertAgentCatalogUserSkill } from "../app-agent-catalog-mutations";
import { ResponsiveTabSidebarPanel } from "../responsive-pane-sidebar";
export { BuildContextView } from "./build-context-view";

type FirstPartySubview = { id: string; title: string; description: string };

function FirstPartySubviewNavigation({ label, activeId, items, onSelect }: { label: string; activeId: string; items: readonly FirstPartySubview[]; onSelect: (id: string) => void }) {
	return <nav aria-label={`${label} sections`} className="space-y-1 p-2" data-pibo-sidebar-navigation>
		<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
		{items.map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? "page" : undefined} onClick={() => onSelect(item.id)} className={`block w-full border p-2 text-left ${activeId === item.id ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<span className="block truncate text-sm text-slate-200">{item.title}</span>
			<span className="block truncate font-mono text-[10px] text-slate-500">{item.description}</span>
		</button>)}
	</nav>;
}

const TOOL_FAMILY_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "settings", title: "Settings", description: "configuration + lifecycle" },
	{ id: "context", title: "Context", description: "runtime delivery" },
];

export function ToolFamilyView(props: PluginViewProps) {
	const pluginId = props.tab.pluginId;
	const subview = props.tab.subviewId === "context" ? "context" : "settings";
	return <ResponsiveTabSidebarPanel
		label={props.tab.fallback}
		sidebar={<FirstPartySubviewNavigation label={props.tab.fallback} activeId={subview} items={TOOL_FAMILY_SUBVIEWS} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
	>
		<div className="space-y-3 p-4 text-sm text-slate-300">
			<h2 className="font-semibold text-slate-100">{subview === "context" ? "Context delivery" : props.tab.fallback}</h2>
			<p>{subview === "context" ? "Context and runtime delivery follow the immutable plugin selection and capability report." : "Agent delivery is controlled by the immutable plugin selection and runtime capability report. This system view does not grant tools."}</p>
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt className="text-slate-500">Plugin</dt><dd className="font-mono">{pluginId}</dd><dt className="text-slate-500">Revision</dt><dd className="break-all font-mono">{props.tab.pluginRevision}</dd><dt className="text-slate-500">Session</dt><dd className="font-mono">{props.piboSessionId}</dd></dl>
		</div>
	</ResponsiveTabSidebarPanel>;
}

const WEB_ANNOTATION_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "annotations", title: "Annotations", description: "saved browser notes" },
	{ id: "settings", title: "Settings", description: "capture + shortcut" },
	{ id: "context", title: "Context", description: "delivery boundaries" },
];

export function WebAnnotationsView(props: PluginViewProps) {
	const [error, setError] = useState<string | null>(null);
	const annotations = useSessionWebAnnotations({
		selectedPiboSessionId: props.piboSessionId,
		onError: setError,
		formatError: compactWebAnnotationError,
		forcePanelVisible: true,
	});
	const subview = WEB_ANNOTATION_SUBVIEWS.find((item) => item.id === props.tab.subviewId)?.id ?? "annotations";
	const content = subview === "settings"
		? <WebAnnotationsControls piboSessionId={props.piboSessionId} piboRoomId={props.roomId} disabled={false} onError={setError} />
		: subview === "context"
			? <div className="space-y-2 p-4 text-sm text-slate-300"><p>Web Annotation tools receive the current Pibo Session ID from runtime context. The skill body loads progressively; API, settings, and browser state are not injected into model context.</p><p className="text-xs text-slate-500">App, agent, and session configuration previews are separate from immutable saved generation plans.</p></div>
			: <WebAnnotationsSessionPanel
				piboSessionId={props.piboSessionId}
				annotations={annotations.visibleWebAnnotations}
				selectedIds={annotations.selectedWebAnnotationIds}
				loading={annotations.webAnnotationsQuery.isFetching || annotations.clearingWebAnnotations}
				error={error ?? (annotations.webAnnotationsQuery.error ? compactWebAnnotationError(annotations.webAnnotationsQuery.error, "Could not load web annotations") : null)}
				onRefresh={() => { void annotations.webAnnotationsQuery.refetch(); }}
				onToggle={annotations.toggleWebAnnotationAttachment}
				onClear={() => { void annotations.clearVisibleWebAnnotations(); }}
			/>;
	return <ResponsiveTabSidebarPanel
		label="Web Annotations"
		sidebar={<FirstPartySubviewNavigation label="Web Annotations" activeId={subview} items={WEB_ANNOTATION_SUBVIEWS} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
	>
		{content}
	</ResponsiveTabSidebarPanel>;
}

function useBoundBootstrap(props: PluginViewProps) {
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null); const [error, setError] = useState<string | null>(null);
	const refresh = () => { void getBootstrap(props.piboSessionId, false, props.roomId, false, { signal: props.signal }).then((data) => { if (!props.signal.aborted) setBootstrap(data); }).catch((error) => { if (!props.signal.aborted) setError(String(error)); }); };
	useEffect(refresh, [props.piboSessionId, props.signal]);
	return { bootstrap, setBootstrap, refresh, error };
}
const USER_RESOURCE_SUBVIEWS: readonly FirstPartySubview[] = [
	{ id: "context-files", title: "Context Files", description: "managed + plugin files" },
	{ id: "skills", title: "Skills", description: "user-managed resources" },
	{ id: "base-prompt", title: "Base Prompt", description: "runtime foundation" },
	{ id: "compaction-prompt", title: "Compaction Prompt", description: "history compaction" },
];

export function UserResourcesView(props: PluginViewProps) {
	const { bootstrap, setBootstrap, refresh, error } = useBoundBootstrap(props);
	const profiles = bootstrap?.agents.map((agent) => agent.name) ?? [];
	const subview = USER_RESOURCE_SUBVIEWS.find((item) => item.id === props.tab.subviewId)?.id ?? "context-files";
	if (error) return <p role="alert">{error}</p>;
	const content = subview === "skills"
		? <div className="p-3"><p className="mb-2 text-xs text-slate-400">User-owned skills · app scope · independent of resource plugins</p><UserSkillsSettings skills={bootstrap?.agentCatalog?.userSkills} onSkillChanged={(skill) => { setBootstrap((current) => current ? upsertAgentCatalogUserSkill(current, skill) : current); refresh(); }} onSkillRemoved={(skillId) => { setBootstrap((current) => current ? removeAgentCatalogUserSkill(current, skillId) : current); refresh(); }} /></div>
		: subview === "base-prompt"
			? <BasePromptView />
			: subview === "compaction-prompt"
				? <CompactionPromptView />
				: <ContextFilesView agentProfiles={profiles} selectedFileKey={typeof props.state.selectedFileKey === "string" ? props.state.selectedFileKey : undefined} />;
	return <ResponsiveTabSidebarPanel
		label="Context"
		sidebar={<FirstPartySubviewNavigation label="Context" activeId={subview} items={USER_RESOURCE_SUBVIEWS} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
		contentOverflow="hidden"
	>
		{content}
	</ResponsiveTabSidebarPanel>;
}
const SETTINGS_PANELS = new Set<SettingsPanel>(["general", "plugins", "debug", "concurrency", "previews", "transcription", "speech", "shortcuts", "maintenance", "skills", "providers"]);
export function GlobalSettingsView(props: PluginViewProps) {
	const { bootstrap, setBootstrap, refresh, error } = useBoundBootstrap(props);
	const [showThinking, setShowThinking] = useState(readStoredShowThinking);
	const [expandThinking, setExpandThinking] = useState(readStoredExpandThinking);
	const [debugMode, setDebugMode] = useState(readStoredDebugMode);
	const [debugFeatures, setDebugFeatures] = useState(readStoredDebugFeatures);
	const [toolMetrics, setToolMetrics] = useState(readStoredToolMetricThresholds);
	const panel = SETTINGS_PANELS.has(props.tab.subviewId as SettingsPanel) ? props.tab.subviewId as SettingsPanel : "general";
	if (error) return <p role="alert">{error}</p>;
	if (!bootstrap) return <p role="status">Loading settings…</p>;
	return <ResponsiveTabSidebarPanel
		label="Settings"
		sidebar={<SettingsSidebar activePanel={panel} userSkillCount={bootstrap.agentCatalog?.userSkills.length ?? 0} onSelect={(next) => props.openView(props.tab.viewId, next)} />}
		sidebarWidth={220}
		contentOverflow="hidden"
	>
		<SettingsView activePanel={panel} showThinking={showThinking} setShowThinking={(value) => { setShowThinking(value); writeStoredShowThinking(value); }} expandThinking={expandThinking} setExpandThinking={(value) => { setExpandThinking(value); writeStoredExpandThinking(value); }} debugMode={debugMode} onDebugModeChange={(value) => { setDebugMode(value); writeStoredDebugMode(value); }} debugFeatures={debugFeatures} onDebugFeaturesChange={(value) => { setDebugFeatures(value); writeStoredDebugFeatures(value); }} toolMetricThresholds={toolMetrics} onToolMetricThresholdsChange={(value) => { setToolMetrics(value); writeStoredToolMetricThresholds(value); }} modelDefaults={bootstrap.modelDefaults} modelCatalog={bootstrap.modelCatalog} onModelDefaultsChanged={(modelDefaults) => setBootstrap((current) => current ? { ...current, modelDefaults } : current)} userSkills={bootstrap.agentCatalog?.userSkills} onUserSkillChanged={(skill) => { setBootstrap((current) => current ? upsertAgentCatalogUserSkill(current, skill) : current); refresh(); }} onUserSkillRemoved={(skillId) => { setBootstrap((current) => current ? removeAgentCatalogUserSkill(current, skillId) : current); refresh(); }} piboSessionId={props.piboSessionId} agentId={props.agentId} onProviderAuthChanged={refresh} />
	</ResponsiveTabSidebarPanel>;
}
export function StandardShell({ children }: { children: ReactNode; piboSessionId: string }) { return <>{children}</>; }
export function setupStandardShell(host: PluginBrowserSetup) { host.registerShell("pibo.standard-shell/shell", StandardShell); }

export function AgentDesignerView(props: PluginViewProps) {
	const { bootstrap, refresh, error } = useBoundBootstrap(props);
	const [creating, setCreating] = useState(false);
	const [autosave, setAutosave] = useState<(() => Promise<void>) | null>(null);
	const handleAutosaveChange = useCallback((save: (() => Promise<void>) | null) => setAutosave(() => save), []);
	useEffect(() => autosave ? props.registerBeforeLeave(autosave) : undefined, [autosave, props.registerBeforeLeave]);
	if (error) return <p role="alert">{error}</p>;
	if (!bootstrap) return <p role="status">Loading agent definitions…</p>;
	return <AgentsView agents={bootstrap.agents} initialCustomAgents={bootstrap.customAgents} initialAgentFolders={bootstrap.agentFolders} initialCatalog={bootstrap.agentCatalog} modelCatalog={bootstrap.modelCatalog} onCreateSession={(profile) => { if (!props.createSession) return; setCreating(true); void props.createSession(profile).finally(() => setCreating(false)); }} onEditContextFile={(fileKey) => props.openView("pibo.product-ui/user-resources", "context-files", { selectedFileKey: fileKey })} onAgentsChanged={refresh} onAutosaveHandlerChange={handleAutosaveChange} creatingSession={creating} mobileSidebarOpen={false} isMobileSidebarViewport={false} onCloseMobileSidebar={() => undefined} surface="tab" />;
}
export function WorkflowsView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	const viewWorkflowId = typeof props.state.viewWorkflowId === "string" ? props.state.viewWorkflowId : undefined;
	const viewWorkflowVersion = typeof props.state.viewWorkflowVersion === "string" ? props.state.viewWorkflowVersion : undefined;
	if (!bootstrap) return <p role={error ? "alert" : "status"}>{error ?? "Loading workflows…"}</p>;
	if (viewWorkflowId && viewWorkflowVersion) return <WorkflowVersionPanel workflowId={viewWorkflowId} workflowVersion={viewWorkflowVersion} />;
	return <MinimalWorkflowsArea
		room={bootstrap.room}
		draftId={typeof props.state.draftId === "string" ? props.state.draftId : undefined}
		onNavigateDraft={(draftId) => props.updateState({ ...props.state, draftId })}
	/>;
}
export function CronView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <CronArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading cron…"}</p>;
}
export function LoopsView(props: PluginViewProps) {
	const { bootstrap, error } = useBoundBootstrap(props);
	return bootstrap ? <LoopArea bootstrap={bootstrap} surface="tab" /> : <p role={error ? "alert" : "status"}>{error ?? "Loading loops…"}</p>;
}
