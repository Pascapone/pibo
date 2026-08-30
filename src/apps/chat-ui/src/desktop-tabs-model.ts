import type { ChatAppRoute } from "./app-routes";

export const DESKTOP_TABS_STORAGE_KEY = "pibo.chat.desktopTabs.v1";
export const DESKTOP_TAB_STATE_VERSION = 1 as const;
export const DESKTOP_TAB_MIN_WIDTH = 360;
export const DESKTOP_TAB_MAX_WIDTH = 920;
export const DESKTOP_TAB_DEFAULT_WIDTH = 520;
export const DESKTOP_TAB_LIMIT = 24;

export type DesktopSessionTool = "preview" | "raw-events" | "web-annotations" | "runtime-requests" | "session-inspector";

export type DesktopTabTarget =
	| { kind: "route"; route: Exclude<ChatAppRoute, { area: "sessions" }> }
	| { kind: "session-tool"; tool: DesktopSessionTool };

export type DesktopTab = {
	id: string;
	target: DesktopTabTarget;
	title: string;
	createdAt: number;
	lastActivatedAt: number;
};

export type DesktopTabState = {
	version: typeof DESKTOP_TAB_STATE_VERSION;
	tabs: DesktopTab[];
	activeTabId: string | null;
	width: number;
	collapsed: boolean;
};

export function emptyDesktopTabState(): DesktopTabState {
	return {
		version: DESKTOP_TAB_STATE_VERSION,
		tabs: [],
		activeTabId: null,
		width: DESKTOP_TAB_DEFAULT_WIDTH,
		collapsed: false,
	};
}

export function desktopTabTargetKey(target: DesktopTabTarget): string {
	if (target.kind === "session-tool") return `tool:${target.tool}`;
	const route = target.route;
	if (route.area === "projects") return route.projectId ? `projects:${route.projectId}` : "projects";
	if (route.area === "workflows") {
		if (route.draftId) return `workflows:draft:${route.draftId}`;
		if (route.viewWorkflowId && route.viewWorkflowVersion) return `workflows:view:${route.viewWorkflowId}:${route.viewWorkflowVersion}`;
		return "workflows";
	}
	return `route:${route.area}`;
}

export function desktopTabTitle(target: DesktopTabTarget): string {
	if (target.kind === "session-tool") {
		if (target.tool === "preview") return "Preview";
		if (target.tool === "raw-events") return "Raw Events";
		if (target.tool === "web-annotations") return "Annotations";
		if (target.tool === "runtime-requests") return "Runtime Requests";
		return "Session Inspector";
	}
	const route = target.route;
	if (route.area === "vscode") return "VS Code";
	if (route.area === "cron") return "Cron";
	if (route.area === "loops") return "Loops";
	if (route.area === "agents") return "Agent Designer";
	if (route.area === "context") return "Context";
	if (route.area === "settings") return "Settings";
	if (route.area === "projects") return route.projectId ? `Project · ${route.projectId}` : "Projects";
	if (route.draftId) return `Workflow · ${route.draftId}`;
	if (route.viewWorkflowId) return `Workflow · ${route.viewWorkflowId}`;
	return "Workflows";
}

export function routeDesktopTabTarget(route: ChatAppRoute): DesktopTabTarget | null {
	return route.area === "sessions" ? null : { kind: "route", route };
}

export function openDesktopTab(
	state: DesktopTabState,
	target: DesktopTabTarget,
	options: { id?: string; now?: number } = {},
): DesktopTabState {
	const now = options.now ?? Date.now();
	const key = desktopTabTargetKey(target);
	const existingIndex = state.tabs.findIndex((tab) => desktopTabTargetKey(tab.target) === key);
	if (existingIndex >= 0) {
		const existing = state.tabs[existingIndex]!;
		const tabs = state.tabs.slice();
		tabs[existingIndex] = {
			...existing,
			target,
			title: desktopTabTitle(target),
			lastActivatedAt: now,
		};
		return { ...state, tabs, activeTabId: existing.id, collapsed: false };
	}
	const id = options.id ?? createDesktopTabId();
	const tab: DesktopTab = {
		id,
		target,
		title: desktopTabTitle(target),
		createdAt: now,
		lastActivatedAt: now,
	};
	const retained = state.tabs.length >= DESKTOP_TAB_LIMIT ? state.tabs.slice(-(DESKTOP_TAB_LIMIT - 1)) : state.tabs;
	return { ...state, tabs: [...retained, tab], activeTabId: id, collapsed: false };
}

export function activateDesktopTab(state: DesktopTabState, tabId: string, now = Date.now()): DesktopTabState {
	if (state.activeTabId === tabId && !state.collapsed) return state;
	if (!state.tabs.some((tab) => tab.id === tabId)) return state;
	return {
		...state,
		activeTabId: tabId,
		collapsed: false,
		tabs: state.tabs.map((tab) => tab.id === tabId ? { ...tab, lastActivatedAt: now } : tab),
	};
}

export function closeDesktopTab(state: DesktopTabState, tabId: string): DesktopTabState {
	const index = state.tabs.findIndex((tab) => tab.id === tabId);
	if (index < 0) return state;
	const tabs = state.tabs.filter((tab) => tab.id !== tabId);
	if (state.activeTabId !== tabId) return { ...state, tabs };
	const neighbor = tabs[index] ?? tabs[index - 1] ?? null;
	return { ...state, tabs, activeTabId: neighbor?.id ?? null, collapsed: tabs.length ? state.collapsed : false };
}

export function reorderDesktopTab(state: DesktopTabState, tabId: string, toIndex: number): DesktopTabState {
	const fromIndex = state.tabs.findIndex((tab) => tab.id === tabId);
	if (fromIndex < 0 || state.tabs.length < 2) return state;
	const bounded = Math.max(0, Math.min(state.tabs.length - 1, toIndex));
	if (bounded === fromIndex) return state;
	const tabs = state.tabs.slice();
	const [tab] = tabs.splice(fromIndex, 1);
	tabs.splice(bounded, 0, tab!);
	return { ...state, tabs };
}

export function moveDesktopTab(state: DesktopTabState, tabId: string, delta: -1 | 1): DesktopTabState {
	const index = state.tabs.findIndex((tab) => tab.id === tabId);
	return index < 0 ? state : reorderDesktopTab(state, tabId, index + delta);
}

export function resizeDesktopTabs(state: DesktopTabState, width: number): DesktopTabState {
	return { ...state, width: clampDesktopTabWidth(width) };
}

export function clampDesktopTabWidth(width: number): number {
	if (!Number.isFinite(width)) return DESKTOP_TAB_DEFAULT_WIDTH;
	return Math.round(Math.max(DESKTOP_TAB_MIN_WIDTH, Math.min(DESKTOP_TAB_MAX_WIDTH, width)));
}

export function activeDesktopTab(state: DesktopTabState): DesktopTab | null {
	return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

export function desktopTabKeepsMounted(tab: DesktopTab): boolean {
	if (tab.target.kind === "session-tool") return tab.target.tool === "preview";
	return tab.target.route.area === "vscode";
}

export function desktopRouteForState(
	state: DesktopTabState,
	sessionsRoute: Extract<ChatAppRoute, { area: "sessions" }>,
): ChatAppRoute {
	const active = activeDesktopTab(state);
	return active?.target.kind === "route" ? active.target.route : sessionsRoute;
}

export function desktopTransitionNeedsAgentSave(current: DesktopTab | null, nextActiveTabId: string | null): boolean {
	return current?.target.kind === "route"
		&& current.target.route.area === "agents"
		&& current.id !== nextActiveTabId;
}

export async function guardDesktopAgentTransition(
	required: boolean,
	autosave: (() => Promise<void>) | null,
): Promise<{ allowed: true } | { allowed: false; error: unknown }> {
	if (!required || !autosave) return { allowed: true };
	try {
		await autosave();
		return { allowed: true };
	} catch (error) {
		return { allowed: false, error };
	}
}

export async function applyGuardedDesktopTabTransition({
	current,
	next,
	sessionsRoute,
	closingTab,
	autosave,
	onCommit,
	onNavigate,
}: {
	current: DesktopTabState;
	next: DesktopTabState;
	sessionsRoute: Extract<ChatAppRoute, { area: "sessions" }>;
	closingTab?: DesktopTab;
	autosave: (() => Promise<void>) | null;
	onCommit: (state: DesktopTabState) => void;
	onNavigate: (route: ChatAppRoute) => void;
}): Promise<{ allowed: true } | { allowed: false; error: unknown }> {
	const currentActive = activeDesktopTab(current);
	const closingAgent = closingTab?.target.kind === "route" && closingTab.target.route.area === "agents";
	const saveResult = await guardDesktopAgentTransition(
		Boolean(closingAgent || desktopTransitionNeedsAgentSave(currentActive, next.activeTabId)),
		autosave,
	);
	if (!saveResult.allowed) return saveResult;
	const currentRoute = desktopRouteForState(current, sessionsRoute);
	const nextRoute = desktopRouteForState(next, sessionsRoute);
	onCommit(next);
	if (JSON.stringify(currentRoute) !== JSON.stringify(nextRoute)) onNavigate(nextRoute);
	return { allowed: true };
}

export function reconcileDesktopRoute(state: DesktopTabState, route: ChatAppRoute, options: { id?: string; now?: number } = {}): DesktopTabState {
	const target = routeDesktopTabTarget(route);
	return target ? { ...openDesktopTab(state, target, options), collapsed: state.collapsed } : state;
}

export function serializeDesktopTabState(state: DesktopTabState): string {
	return JSON.stringify({
		...state,
		width: clampDesktopTabWidth(state.width),
		tabs: state.tabs.slice(0, DESKTOP_TAB_LIMIT),
		activeTabId: state.tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : null,
	});
}

export function parseDesktopTabState(value: string | null | undefined): DesktopTabState {
	if (!value) return emptyDesktopTabState();
	try {
		const candidate = JSON.parse(value) as unknown;
		if (!isRecord(candidate) || candidate.version !== DESKTOP_TAB_STATE_VERSION || !Array.isArray(candidate.tabs)) return emptyDesktopTabState();
		const parsedTabs = candidate.tabs
			.slice(0, DESKTOP_TAB_LIMIT)
			.map(parseDesktopTab)
			.filter((tab): tab is DesktopTab => tab !== null);
		const tabs: DesktopTab[] = [];
		const retainedIds = new Set<string>();
		const retainedTargets = new Map<string, string>();
		const idAliases = new Map<string, string>();
		for (const tab of parsedTabs) {
			const targetKey = desktopTabTargetKey(tab.target);
			const retainedTargetId = retainedTargets.get(targetKey);
			if (retainedIds.has(tab.id) || retainedTargetId) {
				idAliases.set(tab.id, retainedTargetId ?? tab.id);
				continue;
			}
			tabs.push(tab);
			retainedIds.add(tab.id);
			retainedTargets.set(targetKey, tab.id);
			idAliases.set(tab.id, tab.id);
		}
		const requestedActiveTabId = typeof candidate.activeTabId === "string"
			? idAliases.get(candidate.activeTabId)
			: undefined;
		const activeTabId = requestedActiveTabId && tabs.some((tab) => tab.id === requestedActiveTabId)
			? requestedActiveTabId
			: tabs[0]?.id ?? null;
		return {
			version: DESKTOP_TAB_STATE_VERSION,
			tabs,
			activeTabId,
			width: clampDesktopTabWidth(typeof candidate.width === "number" ? candidate.width : DESKTOP_TAB_DEFAULT_WIDTH),
			collapsed: candidate.collapsed === true && tabs.length > 0,
		};
	} catch {
		return emptyDesktopTabState();
	}
}

export function readDesktopTabState(storage: Pick<Storage, "getItem"> | undefined = safeLocalStorage()): DesktopTabState {
	try {
		return parseDesktopTabState(storage?.getItem(DESKTOP_TABS_STORAGE_KEY));
	} catch {
		return emptyDesktopTabState();
	}
}

export function writeDesktopTabState(state: DesktopTabState, storage: Pick<Storage, "setItem"> | undefined = safeLocalStorage()): void {
	try {
		storage?.setItem(DESKTOP_TABS_STORAGE_KEY, serializeDesktopTabState(state));
	} catch {
		// Storage is an optional enhancement. The live in-memory state remains authoritative.
	}
}

function parseDesktopTab(value: unknown): DesktopTab | null {
	if (!isRecord(value) || typeof value.id !== "string" || !value.id || !isDesktopTabTarget(value.target)) return null;
	const createdAt = finiteNumber(value.createdAt) ?? Date.now();
	return {
		id: value.id,
		target: value.target,
		title: typeof value.title === "string" && value.title.trim() ? value.title : desktopTabTitle(value.target),
		createdAt,
		lastActivatedAt: finiteNumber(value.lastActivatedAt) ?? createdAt,
	};
}

function isDesktopTabTarget(value: unknown): value is DesktopTabTarget {
	if (!isRecord(value)) return false;
	if (value.kind === "session-tool") return isDesktopSessionTool(value.tool);
	return value.kind === "route" && isRecord(value.route) && isDesktopRoute(value.route);
}

function isDesktopSessionTool(value: unknown): value is DesktopSessionTool {
	return value === "preview" || value === "raw-events" || value === "web-annotations" || value === "runtime-requests" || value === "session-inspector";
}

function isDesktopRoute(value: Record<string, unknown>): value is Exclude<ChatAppRoute, { area: "sessions" }> {
	if (value.area === "vscode" || value.area === "agents" || value.area === "cron" || value.area === "loops") return true;
	if (value.area === "projects" || value.area === "workflows" || value.area === "context" || value.area === "settings") return true;
	return false;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeLocalStorage(): Storage | undefined {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

function createDesktopTabId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `tab-${crypto.randomUUID()}`;
	return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
