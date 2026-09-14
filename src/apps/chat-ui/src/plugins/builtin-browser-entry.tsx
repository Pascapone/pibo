/** Ordinary prebuilt browser entry. Build alongside the app with shared React/query/router chunks. */
import { useEffect, useState } from "react";
import { MinimalWorkflowsArea } from "../MinimalWorkflowsArea";
import { WorkflowVersionPanel } from "../desktop-workflow-version-panel";
import { CronArea } from "../CronArea";
import { LoopArea } from "../LoopArea";
import { getBootstrap } from "../api-chat-sessions";
import type { BootstrapData } from "../types";
import type { PluginViewProps } from "./browser-host";
import { useSessionWebAnnotations } from "../use-session-web-annotations";
import { compactWebAnnotationError, WebAnnotationsControls, WebAnnotationsSessionPanel } from "../web-annotations";
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
