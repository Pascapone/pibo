import { pluginViewPresentation, type EffectivePluginPlan, type PluginBrowserCatalog, type PluginJsonObject, type PluginQualifiedId, type PluginSessionTabset, type PluginTabInstance } from "../../../../plugins/sdk";

export function emptyPluginTabset(piboSessionId: string): PluginSessionTabset {
	if (!piboSessionId.startsWith("ps_")) throw new Error("Select a Pibo Session before opening tabs");
	return { schemaVersion: 1, piboSessionId, revision: 0, tabs: [], activeTabId: null, layout: {} };
}
export function availablePluginViews(plan: EffectivePluginPlan, catalog: PluginBrowserCatalog) {
	return plan.contributions.filter((entry) => entry.contribution.view && pluginViewPresentation(entry.contribution.view) === "workspace" && catalog.plugins.some((plugin) => plugin.pluginId === entry.pluginId && plugin.revision === entry.pluginRevision && plugin.browserEntry));
}
export function openPluginTab(tabset: PluginSessionTabset, plan: EffectivePluginPlan, catalog: PluginBrowserCatalog, viewId: PluginQualifiedId, options: { instanceId?: string; instanceKey?: string; subviewId?: string; state?: PluginJsonObject } = {}): PluginSessionTabset {
	if (plan.piboSessionId !== tabset.piboSessionId) throw new Error("Plan/session mismatch");
	const entry = availablePluginViews(plan, catalog).find((item) => item.id === viewId);
	if (!entry?.contribution.view) throw new Error("View is not effective for this session");
	const view = entry.contribution.view;
	if (options.subviewId && !view.subviews?.some((item) => item.id === options.subviewId)) throw new Error("Unknown plugin subview");
	const existing = tabset.tabs.find((tab) => tab.viewId === viewId && (view.instance === "singleton" || (options.instanceKey !== undefined && tab.instanceKey === options.instanceKey)));
	if (existing) return { ...tabset, activeTabId: existing.instanceId, tabs: tabset.tabs.map((tab) => tab === existing ? { ...tab, ...(options.subviewId ? { subviewId: options.subviewId } : {}), ...(options.state ? { state: { ...tab.state, ...options.state } } : {}) } : tab) };
	if (tabset.tabs.length >= 100) throw new Error("Close a tab before opening another (100 tab limit)");
	const tab: PluginTabInstance = { instanceId: options.instanceId ?? crypto.randomUUID(), piboSessionId: tabset.piboSessionId, pluginId: entry.pluginId, viewId, pluginRevision: entry.pluginRevision, stateSchemaVersion: view.stateSchemaVersion, state: options.state ? structuredClone(options.state) : {}, fallback: view.title, ...(options.subviewId ? { subviewId: options.subviewId } : {}), ...(options.instanceKey ? { instanceKey: options.instanceKey } : {}) };
	return { ...tabset, tabs: [...tabset.tabs, tab], activeTabId: tab.instanceId };
}
export function updatePluginTab(tabset: PluginSessionTabset, instanceId: string, patch: { state?: PluginJsonObject; subviewId?: string }): PluginSessionTabset {
	return { ...tabset, tabs: tabset.tabs.map((tab) => tab.instanceId === instanceId ? { ...tab, ...patch } : tab) };
}
export function closePluginTab(tabset: PluginSessionTabset, instanceId: string): PluginSessionTabset {
	const index = tabset.tabs.findIndex((tab) => tab.instanceId === instanceId);
	const tabs = tabset.tabs.filter((tab) => tab.instanceId !== instanceId);
	return { ...tabset, tabs, activeTabId: tabset.activeTabId === instanceId ? (tabs[index] ?? tabs[index - 1])?.instanceId ?? null : tabset.activeTabId };
}
export class PluginHttpError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function pluginRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(path, { ...init, credentials: "same-origin", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
	if (!response.ok) throw new PluginHttpError((await response.text()).slice(0, 1000) || response.statusText, response.status);
	return response.json() as Promise<T>;
}
export type TabsetTransport = {
	read: (id: string) => Promise<PluginSessionTabset | null>;
	write: (tabset: PluginSessionTabset, expectedRevision: number) => Promise<PluginSessionTabset>;
};
export const tabsetTransport: TabsetTransport = {
	read: async (id) => (await pluginRequest<{ tabset: PluginSessionTabset | null }>(`/api/chat/sessions/${encodeURIComponent(id)}/plugin-tabs`)).tabset,
	write: async (tabset, expectedRevision) => (await pluginRequest<{ tabset: PluginSessionTabset }>(`/api/chat/sessions/${encodeURIComponent(tabset.piboSessionId)}/plugin-tabs`, { method: "PUT", body: JSON.stringify({ tabset, expectedRevision }) })).tabset,
};
/** One controller per fixed session. In-flight writes never consult a global selection. */
export const SESSION_CONTROLLER_CACHE_LIMIT = 8;

export class SessionTabController {
	state: PluginSessionTabset;
	ready = false;
	error: Error | null = null;
	conflict = false;
	private listeners = new Set<() => void>();
	private change = 0;
	private saved = 0;
	private pending?: Promise<void>;
	private loading?: Promise<void>;
	private loadGeneration = 0;
	constructor(readonly piboSessionId: string, private transport = tabsetTransport) { this.state = emptyPluginTabset(piboSessionId); }
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private emit() { for (const listener of this.listeners) listener(); }
	ensureLoaded(): Promise<void> {
		if (this.ready) return Promise.resolve();
		if (this.loading) return this.loading;
		this.loading = this.load().finally(() => { this.loading = undefined; });
		return this.loading;
	}
	async load() {
		const generation = ++this.loadGeneration;
		const changeAtStart = this.change;
		try {
			const remote = await this.transport.read(this.piboSessionId);
			if (generation !== this.loadGeneration || changeAtStart !== this.change) return;
			if (remote && (remote.piboSessionId !== this.piboSessionId || remote.tabs.some((tab) => tab.piboSessionId !== this.piboSessionId))) throw new Error("Server returned a cross-session tabset");
			this.state = remote ?? emptyPluginTabset(this.piboSessionId); this.ready = true; this.error = null; this.conflict = false; this.change = this.saved = 0;
		} catch (error) {
			if (generation !== this.loadGeneration || changeAtStart !== this.change) return;
			this.error = error instanceof Error ? error : new Error(String(error));
		}
		this.emit();
	}
	edit(update: (state: PluginSessionTabset) => PluginSessionTabset) {
		if (!this.ready || this.conflict) throw new Error("Resolve tabset loading/conflict before editing");
		const next = update(this.state);
		if (next.piboSessionId !== this.piboSessionId || next.tabs.some((tab) => tab.piboSessionId !== this.piboSessionId)) throw new Error("A tab cannot move to another session");
		this.state = { ...next, revision: this.state.revision }; this.change++; this.emit(); void this.flush();
	}
	flush(): Promise<void> {
		if (this.pending) return this.pending;
		if (this.conflict || !this.ready || this.saved === this.change) return Promise.resolve();
		this.pending = this.saveLoop().finally(() => { this.pending = undefined; });
		return this.pending;
	}
	private async saveLoop() {
		while (this.saved !== this.change && !this.conflict) {
			const version = this.change; const sent = this.state;
			try {
				const result = await this.transport.write(sent, sent.revision);
				if (result.piboSessionId !== this.piboSessionId || result.tabs.some((tab) => tab.piboSessionId !== this.piboSessionId)) throw new Error("Save response belongs to another session");
				this.state = { ...this.state, revision: result.revision }; this.saved = version; this.error = null;
			} catch (error) {
				this.error = error instanceof Error ? error : new Error(String(error));
				this.conflict = error instanceof PluginHttpError && error.status === 409;
				this.emit(); return;
			}
			this.emit();
		}
	}
	get dirty() { return this.change !== this.saved; }
	get evictionSafe() { return !this.dirty && !this.conflict && !this.pending && !this.loading; }
}

export function pruneSessionTabControllerCache(
	controllers: Map<string, SessionTabController>,
	retainedPiboSessionId: string,
	limit = SESSION_CONTROLLER_CACHE_LIMIT,
): void {
	while (controllers.size > limit) {
		const candidate = [...controllers].find(([piboSessionId, controller]) =>
			piboSessionId !== retainedPiboSessionId && controller.evictionSafe,
		);
		if (!candidate) return;
		controllers.delete(candidate[0]);
	}
}

export function retainSessionTabController(
	controllers: Map<string, SessionTabController>,
	piboSessionId: string,
	create: (piboSessionId: string) => SessionTabController = (id) => new SessionTabController(id),
	limit = SESSION_CONTROLLER_CACHE_LIMIT,
): SessionTabController {
	const existing = controllers.get(piboSessionId);
	const controller = existing ?? create(piboSessionId);
	controllers.delete(piboSessionId);
	controllers.set(piboSessionId, controller);
	pruneSessionTabControllerCache(controllers, piboSessionId, limit);
	return controller;
}

export async function guardPluginTabRefresh(
	controller: SessionTabController,
	instanceId: string,
	runBeforeLeave: (instanceIds: readonly string[]) => Promise<boolean>,
): Promise<boolean> {
	if (!await runBeforeLeave([instanceId])) return false;
	await controller.flush();
	return !controller.dirty && !controller.conflict && !controller.error;
}

export function pluginTabDeepLink(tab: PluginTabInstance): string {
	const params = new URLSearchParams({ piboSessionId: tab.piboSessionId, pluginView: tab.viewId, pluginTab: tab.instanceId });
	if (tab.subviewId) params.set("pluginSubview", tab.subviewId);
	return `/sessions/${encodeURIComponent(tab.piboSessionId)}?${params}`;
}
export function parsePluginTabDeepLink(url: URL): { piboSessionId: string; viewId: PluginQualifiedId; instanceId?: string; subviewId?: string } | null {
	const id = url.searchParams.get("piboSessionId"); const viewId = url.searchParams.get("pluginView");
	if (!id?.startsWith("ps_") || !viewId || !/^[^/]+\/[^/]+$/.test(viewId)) return null;
	return { piboSessionId: id, viewId: viewId as PluginQualifiedId, instanceId: url.searchParams.get("pluginTab") ?? undefined, subviewId: url.searchParams.get("pluginSubview") ?? undefined };
}
