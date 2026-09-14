import { useCallback, useEffect, useState } from "react";
import { BasePromptView } from "./context/BasePromptView";
import { CompactionPromptView } from "./context/CompactionPromptView";
import { ContextFilesView } from "./context/ContextFilesView";
import { AgentsView } from "./agents/AgentsView";
import { removeAgentCatalogUserSkill, upsertAgentCatalogUserSkill } from "./app-agent-catalog-mutations";
import { readStoredDebugFeatures, readStoredDebugMode, readStoredExpandThinking, readStoredShowThinking, writeStoredDebugFeatures, writeStoredDebugMode, writeStoredExpandThinking, writeStoredShowThinking } from "./app-storage";
import { ResponsiveTabSidebarPanel } from "./responsive-pane-sidebar";
import { SettingsView, UserSkillsSettings } from "./settings/SettingsView";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import type { SettingsPanel } from "./settings/types";
import { readStoredToolMetricThresholds, writeStoredToolMetricThresholds } from "./tool-metric-settings";
import type { BootstrapData } from "./types";
import type { CoreWorkspaceRoute } from "./core-workspace-model";

type CoreWorkspaceViewProps = {
	route: CoreWorkspaceRoute;
	bootstrap: BootstrapData;
	active: boolean;
	piboSessionId?: string | null;
	contextFileKey?: string;
	onContextFileKeyChange: (fileKey: string | undefined) => void;
	onBootstrapChange: (bootstrap: BootstrapData) => void;
	onRefresh: () => Promise<BootstrapData>;
	onCreateSession: (profile: string) => Promise<void>;
	onNavigate: (route: CoreWorkspaceRoute) => void;
	onAutosaveHandlerChange: (handler: (() => Promise<void>) | null) => void;
};

type CoreSubview = { id: string; title: string; description: string };

function CoreSubviewNavigation({ label, activeId, items, onSelect }: { label: string; activeId: string; items: readonly CoreSubview[]; onSelect: (id: string) => void }) {
	return <nav aria-label={`${label} sections`} className="space-y-1 p-2" data-pibo-sidebar-navigation>
		<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
		{items.map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? "page" : undefined} onClick={() => onSelect(item.id)} className={`block w-full border p-2 text-left ${activeId === item.id ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<span className="block truncate text-sm text-slate-200">{item.title}</span>
			<span className="block truncate font-mono text-[10px] text-slate-500">{item.description}</span>
		</button>)}
	</nav>;
}

const CONTEXT_SUBVIEWS: readonly CoreSubview[] = [
	{ id: "context-files", title: "Context Files", description: "managed + plugin files" },
	{ id: "skills", title: "Skills", description: "user-managed resources" },
	{ id: "base-prompt", title: "Base Prompt", description: "runtime foundation" },
	{ id: "compaction-prompt", title: "Compaction Prompt", description: "history compaction" },
] as const;

function CoreContextView({ bootstrap, selectedFileKey, onSelectedFileKeyChange, onBootstrapChange, onRefresh }: {
	bootstrap: BootstrapData;
	selectedFileKey?: string;
	onSelectedFileKeyChange: (fileKey: string | undefined) => void;
	onBootstrapChange: (bootstrap: BootstrapData) => void;
	onRefresh: () => Promise<BootstrapData>;
}) {
	const [subview, setSubview] = useState("context-files");
	useEffect(() => {
		if (selectedFileKey) setSubview("context-files");
	}, [selectedFileKey]);
	const content = subview === "skills"
		? <div className="p-3"><p className="mb-2 text-xs text-slate-400">User-owned skills · app scope · independent of resource plugins</p><UserSkillsSettings skills={bootstrap.agentCatalog?.userSkills} onSkillChanged={(skill) => { onBootstrapChange(upsertAgentCatalogUserSkill(bootstrap, skill)); void onRefresh(); }} onSkillRemoved={(skillId) => { onBootstrapChange(removeAgentCatalogUserSkill(bootstrap, skillId)); void onRefresh(); }} /></div>
		: subview === "base-prompt"
			? <BasePromptView />
			: subview === "compaction-prompt"
				? <CompactionPromptView />
				: <ContextFilesView agentProfiles={bootstrap.agents.map((agent) => agent.name)} selectedFileKey={selectedFileKey} />;
	return <ResponsiveTabSidebarPanel
		label="Context"
		sidebar={<CoreSubviewNavigation label="Context" activeId={subview} items={CONTEXT_SUBVIEWS} onSelect={(next) => { setSubview(next); if (next !== "context-files") onSelectedFileKeyChange(undefined); }} />}
		contentOverflow="hidden"
	>
		{content}
	</ResponsiveTabSidebarPanel>;
}

function CoreSettingsView({ route, bootstrap, piboSessionId, onBootstrapChange, onRefresh, onNavigate }: {
	route: Extract<CoreWorkspaceRoute, { area: "settings" }>;
	bootstrap: BootstrapData;
	piboSessionId?: string | null;
	onBootstrapChange: (bootstrap: BootstrapData) => void;
	onRefresh: () => Promise<BootstrapData>;
	onNavigate: (route: CoreWorkspaceRoute) => void;
}) {
	const [showThinking, setShowThinking] = useState(readStoredShowThinking);
	const [expandThinking, setExpandThinking] = useState(readStoredExpandThinking);
	const [debugMode, setDebugMode] = useState(readStoredDebugMode);
	const [debugFeatures, setDebugFeatures] = useState(readStoredDebugFeatures);
	const [toolMetrics, setToolMetrics] = useState(readStoredToolMetricThresholds);
	const panel: SettingsPanel = route.panel ?? "general";
	return <ResponsiveTabSidebarPanel
		label="Settings"
		sidebar={<SettingsSidebar activePanel={panel} userSkillCount={bootstrap.agentCatalog?.userSkills.length ?? 0} onSelect={(next) => onNavigate({ area: "settings", panel: next })} />}
		sidebarWidth={220}
		contentOverflow="hidden"
	>
		<SettingsView activePanel={panel} showThinking={showThinking} setShowThinking={(value) => { setShowThinking(value); writeStoredShowThinking(value); }} expandThinking={expandThinking} setExpandThinking={(value) => { setExpandThinking(value); writeStoredExpandThinking(value); }} debugMode={debugMode} onDebugModeChange={(value) => { setDebugMode(value); writeStoredDebugMode(value); }} debugFeatures={debugFeatures} onDebugFeaturesChange={(value) => { setDebugFeatures(value); writeStoredDebugFeatures(value); }} toolMetricThresholds={toolMetrics} onToolMetricThresholdsChange={(value) => { setToolMetrics(value); writeStoredToolMetricThresholds(value); }} modelDefaults={bootstrap.modelDefaults} modelCatalog={bootstrap.modelCatalog} onModelDefaultsChanged={(modelDefaults) => onBootstrapChange({ ...bootstrap, modelDefaults })} userSkills={bootstrap.agentCatalog?.userSkills} onUserSkillChanged={(skill) => { onBootstrapChange(upsertAgentCatalogUserSkill(bootstrap, skill)); void onRefresh(); }} onUserSkillRemoved={(skillId) => { onBootstrapChange(removeAgentCatalogUserSkill(bootstrap, skillId)); void onRefresh(); }} piboSessionId={piboSessionId} onProviderAuthChanged={() => { void onRefresh(); }} />
	</ResponsiveTabSidebarPanel>;
}

function CoreAgentDesignerView({ bootstrap, active, onRefresh, onCreateSession, onOpenContextFile, onAutosaveHandlerChange }: {
	bootstrap: BootstrapData;
	active: boolean;
	onRefresh: () => Promise<BootstrapData>;
	onCreateSession: (profile: string) => Promise<void>;
	onOpenContextFile: (fileKey: string) => void;
	onAutosaveHandlerChange: (handler: (() => Promise<void>) | null) => void;
}) {
	const [creating, setCreating] = useState(false);
	const [autosave, setAutosave] = useState<(() => Promise<void>) | null>(null);
	const handleAutosaveChange = useCallback((save: (() => Promise<void>) | null) => setAutosave(() => save), []);
	useEffect(() => {
		if (!active) return;
		onAutosaveHandlerChange(autosave);
		return () => onAutosaveHandlerChange(null);
	}, [active, autosave, onAutosaveHandlerChange]);
	return <AgentsView agents={bootstrap.agents} initialCustomAgents={bootstrap.customAgents} initialAgentFolders={bootstrap.agentFolders} initialCatalog={bootstrap.agentCatalog} modelCatalog={bootstrap.modelCatalog} onCreateSession={(profile) => { setCreating(true); void onCreateSession(profile).finally(() => setCreating(false)); }} onEditContextFile={onOpenContextFile} onAgentsChanged={() => { void onRefresh(); }} onAutosaveHandlerChange={handleAutosaveChange} creatingSession={creating} mobileSidebarOpen={false} isMobileSidebarViewport={false} onCloseMobileSidebar={() => undefined} surface="tab" />;
}

export function CoreWorkspaceView(props: CoreWorkspaceViewProps) {
	if (props.route.area === "agents") return <CoreAgentDesignerView bootstrap={props.bootstrap} active={props.active} onRefresh={props.onRefresh} onCreateSession={props.onCreateSession} onOpenContextFile={(fileKey) => { props.onContextFileKeyChange(fileKey); props.onNavigate({ area: "context", piboSessionId: props.piboSessionId ?? undefined }); }} onAutosaveHandlerChange={props.onAutosaveHandlerChange} />;
	if (props.route.area === "context") return <CoreContextView bootstrap={props.bootstrap} selectedFileKey={props.contextFileKey} onSelectedFileKeyChange={props.onContextFileKeyChange} onBootstrapChange={props.onBootstrapChange} onRefresh={props.onRefresh} />;
	return <CoreSettingsView route={props.route} bootstrap={props.bootstrap} piboSessionId={props.piboSessionId} onBootstrapChange={props.onBootstrapChange} onRefresh={props.onRefresh} onNavigate={props.onNavigate} />;
}
