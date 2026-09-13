import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "@tanstack/react-router";
import { pluginViewPresentation, type EffectivePluginPlan, type PluginBrowserCatalog, type PluginJsonObject, type PluginQualifiedId, type PluginTabInstance } from "../../../../plugins/sdk";
import { BrowserPluginContext, BrowserPluginHost, PluginErrorBoundary, sessionPluginRequest, type PluginViewProps } from "./browser-host";
import { availablePluginViews, closePluginTab, openPluginTab, parsePluginTabDeepLink, pluginRequest, pluginTabDeepLink, SessionTabController, updatePluginTab } from "./session-tab-controller";
import { PluginManagement } from "./plugin-management";

type Workspace = { controller: SessionTabController; host: BrowserPluginHost | null; plan: EffectivePluginPlan | null; catalog: PluginBrowserCatalog | null; agentId?: string; roomId?: string; error: string | null; openView: PluginViewProps["openView"]; refresh: () => void; activateTab: (instanceId: string) => Promise<boolean>; closeTab: (instanceId: string) => Promise<boolean>; registerBeforeLeave: (instanceId: string, handler: () => Promise<void>) => () => void };
const WorkspaceContext = createContext<Workspace | null>(null);
/** Keyed by session at the application boundary; closures and pending saves retain their original owner. */
export function PluginWorkspaceProvider({ piboSessionId, children }: { piboSessionId: string | null; children: ReactNode }) {
	if (!piboSessionId) return <>{children}</>;
	return <SessionWorkspace key={piboSessionId} piboSessionId={piboSessionId}>{children}</SessionWorkspace>;
}
function SessionWorkspace({ piboSessionId, children }: { piboSessionId: string; children: ReactNode }) {
	const controller = useMemo(() => new SessionTabController(piboSessionId), [piboSessionId]);
	const [, rerender] = useReducer((value) => value + 1, 0);
	const [host, setHost] = useState<BrowserPluginHost | null>(null);
	const [source, setSource] = useState<{ plan: EffectivePluginPlan; catalog: PluginBrowserCatalog; agentId?: string; roomId?: string } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [revision, refresh] = useReducer((value) => value + 1, 0);
	const [, guardsChanged] = useReducer((value) => value + 1, 0);
	const leaveGuards = useRef(new Map<string, () => Promise<void>>());
	const linkHandled = useRef(false);
	useEffect(() => { const unsubscribe = controller.subscribe(rerender); void controller.load(); return () => { unsubscribe(); void controller.flush(); }; }, [controller]);
	useEffect(() => {
		const abort = new AbortController(); let next: BrowserPluginHost | undefined; setError(null);
		void Promise.all([
			pluginRequest<PluginBrowserCatalog>("/api/chat/plugin-browser/catalog", { signal: abort.signal }),
			pluginRequest<{ plan: EffectivePluginPlan; agentId?: string; roomId?: string }>(`/api/chat/sessions/${encodeURIComponent(piboSessionId)}/plugin-plan`, { signal: abort.signal }),
		]).then(async ([catalog, result]) => {
			if (abort.signal.aborted) return;
			if (result.plan.piboSessionId !== piboSessionId) throw new Error("Plan does not belong to this session");
			setSource({ ...result, catalog }); next = new BrowserPluginHost(result.plan, catalog); await next.start();
			if (abort.signal.aborted) { await next.dispose(); return; } setHost(next);
		}).catch((error) => { if (!abort.signal.aborted) setError(String(error)); });
		return () => { abort.abort(); if (next) void next.dispose(); setHost(null); };
	}, [piboSessionId, revision]);
	const registerBeforeLeave = useCallback((instanceId: string, handler: () => Promise<void>) => {
		leaveGuards.current.set(instanceId, handler);
		guardsChanged();
		return () => {
			if (leaveGuards.current.get(instanceId) !== handler) return;
			leaveGuards.current.delete(instanceId);
			guardsChanged();
		};
	}, []);
	const runBeforeLeave = useCallback(async (instanceIds: readonly string[]): Promise<boolean> => {
		try {
			for (const instanceId of instanceIds) await leaveGuards.current.get(instanceId)?.();
			return true;
		} catch (caught) {
			setError(`Plugin view changes were not saved: ${caught instanceof Error ? caught.message : String(caught)}`);
			return false;
		}
	}, []);
	const activateTab = useCallback(async (instanceId: string): Promise<boolean> => {
		const activeTabId = controller.state.activeTabId;
		if (activeTabId && activeTabId !== instanceId && !await runBeforeLeave([activeTabId])) return false;
		controller.edit((state) => ({ ...state, activeTabId: instanceId }));
		return true;
	}, [controller, runBeforeLeave]);
	const closeTab = useCallback(async (instanceId: string): Promise<boolean> => {
		if (!await runBeforeLeave([instanceId])) return false;
		controller.edit((state) => closePluginTab(state, instanceId));
		return true;
	}, [controller, runBeforeLeave]);
	useBlocker({
		disabled: leaveGuards.current.size === 0,
		enableBeforeUnload: false,
		shouldBlockFn: async ({ current, next }) => current.pathname === next.pathname ? false : !await runBeforeLeave([...leaveGuards.current.keys()]),
	});
	const openView: PluginViewProps["openView"] = useCallback((requestedId, subviewId, state) => {
		if (!source) return;
		void (async () => {
			const activeTabId = controller.state.activeTabId;
			if (activeTabId && !await runBeforeLeave([activeTabId])) return;
			// Provenance links may name a non-view contribution; resolve its owner's declared view.
			const entry = source.plan.contributions.find((entry) => entry.id === requestedId);
			const ownerId = entry?.pluginId ?? requestedId.split("/")[0];
			const viewId = entry?.contribution.view && pluginViewPresentation(entry.contribution.view) === "workspace" ? requestedId : source.plan.contributions.find((item) => item.pluginId === ownerId && item.contribution.view && pluginViewPresentation(item.contribution.view) === "workspace")?.id;
			if (!viewId) { setError(`No effective view for ${requestedId}. Its retained history remains readable.`); return; }
			try { controller.edit((tabset) => openPluginTab(tabset, source.plan, source.catalog, viewId, { subviewId, state })); } catch (error) { setError(String(error)); }
		})();
	}, [controller, runBeforeLeave, source]);
	useEffect(() => {
		if (!source || !controller.ready || linkHandled.current) return;
		const link = parsePluginTabDeepLink(new URL(location.href));
		if (!link || link.piboSessionId !== piboSessionId) return;
		linkHandled.current = true;
		try {
			const saved = controller.state.tabs.find((tab) => tab.instanceId === link.instanceId && tab.viewId === link.viewId);
			controller.edit((state) => saved ? { ...state, activeTabId: saved.instanceId } : openPluginTab(state, source.plan, source.catalog, link.viewId, link));
		} catch (error) { setError(`Deep link unavailable: ${String(error)}`); }
	}, [source, controller.ready]);
	const workspace: Workspace = { controller, host, plan: source?.plan ?? null, catalog: source?.catalog ?? null, agentId: source?.agentId, roomId: source?.roomId, error, openView, refresh, activateTab, closeTab, registerBeforeLeave };
	const Shell = host?.shell;
	const shellContent = Shell ? <PluginErrorBoundary fallback={children}><Shell piboSessionId={piboSessionId}>{children}</Shell></PluginErrorBoundary> : children;
	return <WorkspaceContext.Provider value={workspace}><BrowserPluginContext.Provider value={host ? { host, openView } : null}>{shellContent}</BrowserPluginContext.Provider></WorkspaceContext.Provider>;
}
export type PluginWorkspaceCatalogView = { id: PluginQualifiedId; title: string; pluginId: string; piboSessionId: string };

export function usePluginWorkspaceCatalogViews(): readonly PluginWorkspaceCatalogView[] {
	const workspace = useContext(WorkspaceContext);
	return useMemo(() => workspace?.plan && workspace.catalog
		? availablePluginViews(workspace.plan, workspace.catalog).map((entry) => ({
			id: entry.id,
			title: entry.contribution.view!.title,
			pluginId: entry.pluginId,
			piboSessionId: workspace.controller.piboSessionId,
		}))
		: [], [workspace?.plan, workspace?.catalog]);
}

export function PluginWorkspaceView({
	viewId,
	subviewId,
	state,
	active = true,
}: {
	viewId: PluginQualifiedId;
	subviewId?: string;
	state?: PluginJsonObject;
	active?: boolean;
}) {
	const workspace = useContext(WorkspaceContext);
	const stateKey = JSON.stringify(state ?? {});
	const requestKey = `${workspace?.controller.piboSessionId ?? "none"}:${viewId}:${subviewId ?? ""}:${stateKey}`;
	const appliedRequestKey = useRef<string | null>(null);
	const effectiveEntry = workspace?.plan?.contributions.find((entry) => entry.id === viewId && entry.contribution.view);
	const current = workspace?.controller.state.tabs.find((tab) => tab.viewId === viewId && tab.pluginRevision === effectiveEntry?.pluginRevision);
	const stale = workspace?.controller.state.tabs.find((tab) => tab.viewId === viewId && tab.pluginRevision !== effectiveEntry?.pluginRevision);
	useEffect(() => {
		if (!active || !workspace?.controller.ready || !workspace.plan || !workspace.catalog || !effectiveEntry?.contribution.view) return;
		void (async () => {
			const applyRequest = appliedRequestKey.current !== requestKey;
			if (!current && stale && stale.stateSchemaVersion === effectiveEntry.contribution.view!.stateSchemaVersion) {
				const mergedState = applyRequest && state ? { ...stale.state, ...state } : stale.state;
				workspace.controller.edit((tabset) => openPluginTab(
					closePluginTab(tabset, stale.instanceId),
					workspace.plan!,
					workspace.catalog!,
					viewId,
					{ instanceId: stale.instanceId, subviewId: applyRequest ? subviewId ?? stale.subviewId : stale.subviewId, state: mergedState },
				));
				appliedRequestKey.current = requestKey;
				return;
			}
			if (!current) {
				workspace.openView(viewId, subviewId, state);
				appliedRequestKey.current = requestKey;
				return;
			}
			if (workspace.controller.state.activeTabId !== current.instanceId && !await workspace.activateTab(current.instanceId)) return;
			const mergedState = applyRequest && state ? { ...current.state, ...state } : current.state;
			const subviewChanged = Boolean(applyRequest && subviewId && current.subviewId !== subviewId);
			const stateChanged = applyRequest && state ? JSON.stringify(mergedState) !== JSON.stringify(current.state) : false;
			if (subviewChanged || stateChanged) workspace.controller.edit((tabset) => updatePluginTab(tabset, current.instanceId, {
				...(subviewChanged ? { subviewId } : {}),
				...(stateChanged ? { state: mergedState } : {}),
			}));
			appliedRequestKey.current = requestKey;
		})();
	}, [active, workspace?.controller.ready, workspace?.plan, workspace?.catalog, workspace?.activateTab, workspace?.openView, effectiveEntry, current, stale, viewId, subviewId, state, requestKey]);
	if (!workspace) return <div className="grid h-full place-items-center p-4 text-xs text-slate-400">Select or create a session to open this module.</div>;
	if (workspace.error || workspace.controller.error) return <div role="alert" className="p-4 text-xs text-orange-300">{workspace.error ?? workspace.controller.error?.message}</div>;
	if (!workspace.controller.ready || !current || !workspace.host) return <div className="grid h-full place-items-center p-4 text-xs text-slate-400">Loading {viewId}…</div>;
	return <div className="h-full min-h-0 overflow-hidden"><PluginTabPanel workspace={workspace} tab={current} active={active} showSubviewNavigation={viewId !== "pibo.product-ui/settings"} /></div>;
}

export function PluginWorkspaceTabs({ hidden = false, narrow = false }: { hidden?: boolean; narrow?: boolean }) {
	const workspace = useContext(WorkspaceContext);
	const [catalogOpen, setCatalogOpen] = useState(false); const [recovery, setRecovery] = useState(false); const [management, setManagement] = useState(false);
	const [localCopy, setLocalCopy] = useState<string | null>(null);
	const tabButtons = useRef(new Map<string, HTMLButtonElement>());
	if (hidden) return null;
	if (!workspace) return <aside className="p-3 text-xs text-slate-400">Select or create a session to open plugin tabs.</aside>;
	const { controller, host, plan, catalog } = workspace;
	const state = controller.state;
	const active = state.tabs.find((tab) => tab.instanceId === state.activeTabId);
	const views = plan && catalog ? availablePluginViews(plan, catalog) : [];
	const edit = (update: Parameters<SessionTabController["edit"]>[0]) => { try { controller.edit(update); } catch { /* Controller exposes loading/conflict state below. */ } };
	return <aside data-plugin-workspace data-pibo-session-id={controller.piboSessionId} className={`${narrow ? "w-full" : "w-[min(42vw,640px)] min-w-[320px]"} min-h-0 flex flex-col border-l border-slate-800 bg-[#1a262b] text-slate-200`}>
		<header className="flex flex-wrap items-center gap-1 border-b border-slate-700 p-2 text-xs">
			<button className="border border-slate-600 px-2 py-1 hover:text-cyan-300 disabled:opacity-40" disabled={!controller.ready || controller.conflict} onClick={() => setCatalogOpen(!catalogOpen)}>Open plugin</button>
			<button className="px-2 py-1 text-slate-400" onClick={() => setRecovery(!recovery)}>Recovery</button><button className="px-2 py-1 text-slate-400" onClick={() => setManagement(!management)}>Manage plugins</button>
			<span className="text-[10px] text-slate-500 font-mono truncate" title={controller.piboSessionId}>{controller.piboSessionId}</span>
		</header>
		{recovery ? <section className="p-3 border-b border-slate-700 text-xs space-y-2" data-plugin-recovery><p>Recovery is independent of plugin renderers. No runtime is started.</p><button className="text-cyan-300" onClick={workspace.refresh}>Reload catalog and modules</button><a className="block text-cyan-300" target="_blank" rel="noreferrer" href={`/api/chat/sessions/${encodeURIComponent(controller.piboSessionId)}/plugin-recovery`}>Read session recovery report</a><button onClick={() => setLocalCopy(JSON.stringify(state, null, 2))}>Export retained tab state</button><p>Unbound v1 tabs are not attached automatically. Import requires selecting a session and resolving each old view.</p><LegacyTabImport workspace={workspace} /></section> : null}
		{management ? <PluginManagement onChanged={workspace.refresh} /> : null}
		{localCopy ? <textarea aria-label="Retained tabset export" readOnly value={localCopy} className="m-2 min-h-32 bg-[#0e1116] font-mono text-xs" /> : null}
		{workspace.error || controller.error ? <div role="alert" className="p-3 text-xs text-orange-300">{workspace.error ?? controller.error?.message}{controller.conflict ? <><p>Another browser saved this session. Your local state has been retained, not overwritten.</p><button className="underline mr-2" onClick={() => setLocalCopy(JSON.stringify(state, null, 2))}>Export local edits</button><button className="underline" onClick={() => { setLocalCopy(JSON.stringify(state, null, 2)); void controller.load(); }}>Keep local copy and load server version</button></> : <button className="underline ml-2" onClick={() => { void controller.flush(); workspace.refresh(); }}>Retry</button>}</div> : null}
		{catalogOpen ? <div className="p-2 grid gap-1 border-b border-slate-700 max-h-64 overflow-auto">{views.length ? views.map((view) => <button className="text-left border border-slate-700 p-2 text-xs hover:border-cyan-600" key={view.id} onClick={() => { workspace.openView(view.id); setCatalogOpen(false); }}>{view.contribution.view!.title}<span className="block text-slate-500 font-mono">{view.id}</span></button>) : <p className="text-xs text-slate-400">No effective browser views in this session plan.</p>}</div> : null}
		<div role="tablist" aria-label="Session plugin tabs" className="flex overflow-x-auto border-b border-slate-700 shrink-0">{state.tabs.map((tab, index) => <div key={tab.instanceId} className="flex shrink-0"><button ref={(node) => { if (node) tabButtons.current.set(tab.instanceId, node); else tabButtons.current.delete(tab.instanceId); }} role="tab" id={`plugin-tab-${tab.instanceId}`} aria-controls={`plugin-panel-${tab.instanceId}`} aria-selected={tab === active} tabIndex={tab === active ? 0 : -1} className={`text-xs px-3 py-2 border-b ${tab === active ? "text-cyan-300 border-cyan-500 bg-cyan-500/10" : "text-slate-400 border-transparent"}`} onClick={() => { void workspace.activateTab(tab.instanceId); }} onKeyDown={(event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(event.key)) return; event.preventDefault();
			if (event.key === "Delete") { void workspace.closeTab(tab.instanceId); return; }
			const next = state.tabs[event.key === "Home" ? 0 : event.key === "End" ? state.tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + state.tabs.length) % state.tabs.length]!;
			if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) edit((state) => { const tabs = [...state.tabs]; tabs.splice(index, 1); tabs.splice(state.tabs.indexOf(next), 0, tab); return { ...state, tabs }; });
			else { edit((state) => ({ ...state, activeTabId: next.instanceId })); tabButtons.current.get(next.instanceId)?.focus(); }
		}}>{tab.fallback}</button><button className="px-1 text-xs text-slate-500" aria-label={`Close ${tab.fallback}`} onClick={() => { void workspace.closeTab(tab.instanceId); }}>×</button></div>)}</div>
		<div className="min-h-0 flex-1 overflow-hidden relative">{state.tabs.map((tab) => {
			const entry = plan?.contributions.find((entry) => entry.id === tab.viewId && entry.pluginRevision === tab.pluginRevision);
			const visible = tab === active;
			if (!visible && entry?.contribution.view?.mount !== "keep-alive") return null;
			return <div key={tab.instanceId} role="tabpanel" id={`plugin-panel-${tab.instanceId}`} aria-labelledby={`plugin-tab-${tab.instanceId}`} hidden={!visible} className="h-full min-h-0 overflow-auto"><PluginTabPanel workspace={workspace} tab={tab} active={visible} /></div>;
		})}{!state.tabs.length ? <p className="p-4 text-xs text-slate-400">{controller.ready ? "Open a view from this session’s effective plugin plan." : "Loading session tabset…"}</p> : null}</div>
		<footer className="border-t border-slate-800 px-2 py-1 text-[10px] text-slate-500">Revision {state.revision} · {controller.dirty ? "Unsaved local changes" : "Saved"}{active ? <a className="ml-2 text-cyan-400" href={pluginTabDeepLink(active)}>Session deep link</a> : null}{host?.errors.size ? <span className="ml-2 text-orange-300">{host.errors.size} module failure(s)</span> : null}</footer>
	</aside>;
}
function PluginTabPanel({ workspace, tab, active, showSubviewNavigation = true }: { workspace: Workspace; tab: PluginTabInstance; active: boolean; showSubviewNavigation?: boolean }) {
	const { host, plan, controller } = workspace;
	const registerBeforeLeave = useCallback((handler: () => Promise<void>) => workspace.registerBeforeLeave(tab.instanceId, handler), [tab.instanceId, workspace.registerBeforeLeave]);
	const abort = useMemo(() => new AbortController(), [tab.instanceId, active, host]);
	useEffect(() => () => abort.abort(), [abort]);
	const entry = plan?.contributions.find((entry) => entry.id === tab.viewId && entry.pluginRevision === tab.pluginRevision);
	const view = entry?.contribution.view;
	const Component = host?.views.get(tab.viewId);
	const fallback = <div className="p-3 text-xs space-y-2" data-plugin-placeholder><h3>{tab.fallback}</h3><p>Plugin unavailable, disabled, incompatible, or failed. Saved state is retained.</p><p className="text-orange-300">{host?.errors.get(tab.pluginId)}</p><pre className="whitespace-pre-wrap break-all font-mono">{JSON.stringify(tab.state, null, 2)}</pre></div>;
	if (!view || !Component || view.stateSchemaVersion !== tab.stateSchemaVersion) return fallback;
	const subview = view.subviews?.find((item) => item.id === tab.subviewId);
	return <div className="h-full flex flex-col min-h-0">
		{showSubviewNavigation && view.subviews?.length ? <nav aria-label={`${view.title} subviews`} className="flex gap-1 p-2 border-b border-slate-700">{view.subviews.map((item) => <button key={item.id} aria-current={tab.subviewId === item.id ? "page" : undefined} className={`text-xs px-2 py-1 ${tab.subviewId === item.id ? "text-cyan-300 bg-cyan-500/10" : "text-slate-400"}`} onClick={() => controller.edit((state) => updatePluginTab(state, tab.instanceId, { subviewId: item.id }))}>{item.title}</button>)}</nav> : null}
		<div className="min-h-0 flex-1 overflow-auto"><PluginErrorBoundary key={`${tab.instanceId}:${tab.pluginRevision}`} fallback={fallback}><Component tab={tab} piboSessionId={tab.piboSessionId} agentId={workspace.agentId} roomId={workspace.roomId} active={active} signal={abort.signal} state={tab.state} updateState={(state) => { if (!abort.signal.aborted) controller.edit((current) => updatePluginTab(current, tab.instanceId, { state })); }}request={sessionPluginRequest(tab.piboSessionId, tab.pluginId, abort.signal)} openView={workspace.openView} registerBeforeLeave={registerBeforeLeave} /></PluginErrorBoundary></div>
	</div>;
}
function LegacyTabImport({ workspace }: { workspace: Workspace }) {
	const [value, setValue] = useState(""); const [target, setTarget] = useState(""); const [error, setError] = useState("");
	const views = workspace.plan && workspace.catalog ? availablePluginViews(workspace.plan, workspace.catalog) : [];
	return <details><summary>Explicit v1 import</summary><p>Paste a legacy tab’s JSON and choose its replacement. The old browser store is not modified.</p><textarea aria-label="Legacy tab JSON" value={value} onChange={(event) => setValue(event.target.value)} className="w-full bg-[#0e1116]" /><select aria-label="Import target view" value={target} onChange={(event) => setTarget(event.target.value)} className="bg-[#151f24]"><option value="">Choose replacement</option>{views.map((view) => <option key={view.id} value={view.id}>{view.contribution.view!.title}</option>)}</select><button disabled={!target || !value} onClick={() => { try { const legacy: unknown = JSON.parse(value); if (!legacy || typeof legacy !== "object") throw new Error("Expected a legacy tab object"); workspace.controller.edit((state) => { const opened = openPluginTab(state, workspace.plan!, workspace.catalog!, target as PluginQualifiedId); return updatePluginTab(opened, opened.activeTabId!, { state: { ...opened.tabs.find((tab) => tab.instanceId === opened.activeTabId)!.state, legacyImport: JSON.parse(value) } }); }); setValue(""); setError(""); } catch (error) { setError(String(error)); } }}>Import into {workspace.controller.piboSessionId}</button>{error ? <p role="alert">{error}</p> : null}</details>;
}
