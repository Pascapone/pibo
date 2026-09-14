import {
	Braces,
	ChevronLeft,
	ChevronRight,
	ChevronsRight,
	Clock3,
	GitBranch,
	Layers3,
	ListTree,
	MessageSquareText,
	PanelRightClose,
	PanelRightOpen,
	Plus,
	RefreshCw,
	Settings,
	Sparkles,
	TerminalSquare,
	Workflow,
	X,
	type LucideIcon,
} from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
} from "react";
import type { ChatAppRoute } from "./app-routes";
import { DESKTOP_COLLAPSED_SIDEBAR_WIDTH, DESKTOP_TERMINAL_MIN_WIDTH } from "./desktop-session-sidebar-model";
import { usePluginWorkspaceCatalogViews, usePluginWorkspaceRefreshGuard } from "./plugins/plugin-workspace";
import {
	activateDesktopTab,
	activeDesktopTab,
	closeDesktopTab,
	DESKTOP_TAB_MAX_WIDTH,
	DESKTOP_TAB_MIN_WIDTH,
	desktopTabKeepsMounted,
	desktopTabPluginViewId,
	desktopTabStateFromSessionTabset,
	desktopTabStateToSessionLayout,
	emptyDesktopTabState,
	moveDesktopTab,
	openDesktopNewTab,
	openDesktopTab,
	reconcileDesktopRoute,
	replaceDesktopNewTab,
	reorderDesktopTab,
	resizeDesktopTabs,
	type DesktopModuleTabTarget,
	type DesktopSessionTool,
	type DesktopTab,
	type DesktopTabState,
	type DesktopTabTarget,
	sessionTabsetHasDesktopState,
	serializeDesktopTabState,
} from "./desktop-tabs-model";
import type { SessionTabController } from "./plugins/session-tab-controller";

type CatalogEntry = {
	id: string;
	label: string;
	description: string;
	icon: LucideIcon;
	target?: DesktopModuleTabTarget;
	sessionsAction?: true;
};

type DesktopTabDragInsertion = {
	draggedTabId: string;
	overTabId: string;
	position: "before" | "after";
	toIndex: number;
};

export function desktopTabInsertionIndex(
	tabs: readonly DesktopTab[],
	draggedTabId: string,
	overTabId: string,
	position: "before" | "after",
): number {
	const remaining = tabs.filter((tab) => tab.id !== draggedTabId);
	const overIndex = remaining.findIndex((tab) => tab.id === overTabId);
	if (overIndex < 0) return Math.max(0, remaining.length);
	return overIndex + (position === "after" ? 1 : 0);
}

const SESSION_TOOL_CATALOG: readonly CatalogEntry[] = [
	{ id: "preview", label: "Preview", description: "Live session preview", icon: Sparkles, target: { kind: "session-tool", tool: "preview" } },
	{ id: "raw-events", label: "Raw Events", description: "Raw trace and event payloads", icon: Braces, target: { kind: "session-tool", tool: "raw-events" } },
	{ id: "web-annotations", label: "Web Annotations", description: "Annotations attached to this session", icon: MessageSquareText, target: { kind: "session-tool", tool: "web-annotations" } },
	{ id: "runtime-requests", label: "Runtime Requests", description: "Approvals and runtime input", icon: TerminalSquare, target: { kind: "session-tool", tool: "runtime-requests" } },
	{ id: "session-inspector", label: "Session Inspector", description: "Session, signal, and runtime metadata", icon: ListTree, target: { kind: "session-tool", tool: "session-inspector" } },
] as const;

export function desktopTabCatalog(): readonly CatalogEntry[] {
	const routes: CatalogEntry[] = [
		{ id: "sessions", label: "Sessions", description: "Focus the fixed Rooms and Sessions navigation", icon: Layers3, sessionsAction: true },
		{ id: "workflows", label: "Workflows", description: "Workflow definitions and drafts", icon: Workflow, target: { kind: "route", route: { area: "workflows" } } },
		{ id: "cron", label: "Cron", description: "Scheduled jobs", icon: Clock3, target: { kind: "route", route: { area: "cron" } } },
		{ id: "loops", label: "Loops", description: "Goal and legacy Ralph loops", icon: GitBranch, target: { kind: "route", route: { area: "loops" } } },
		{ id: "agents", label: "Agent Designer", description: "Agents, profiles, and capability selection", icon: Sparkles, target: { kind: "route", route: { area: "agents" } } },
		{ id: "context", label: "Context", description: "Context files, prompts, and MCP tools", icon: Braces, target: { kind: "route", route: { area: "context" } } },
		{ id: "settings", label: "Settings", description: "Chat and runtime settings", icon: Settings, target: { kind: "route", route: { area: "settings" } } },
	];
	return [...routes, ...SESSION_TOOL_CATALOG];
}

export function useDesktopTabWorkspace(
	route: ChatAppRoute,
	enabled: boolean,
	controller: SessionTabController | null,
	routeOwnership: { selectionGeneration: number; ready: boolean } = { selectionGeneration: 0, ready: true },
): {
	state: DesktopTabState;
	setState: Dispatch<SetStateAction<DesktopTabState>>;
} {
	const [, setControllerRevision] = useState(0);
	useEffect(() => controller?.subscribe(() => setControllerRevision((value) => value + 1)), [controller]);
	const state = enabled && controller?.ready ? desktopTabStateFromSessionTabset(controller.state) : emptyDesktopTabState();
	const stateKey = serializeDesktopTabState(state);
	const routeKey = useMemo(() => JSON.stringify(route), [route]);
	// A route may seed only the Session selection generation that observed it; Session state renders before client routing catches up.
	const routeOwnerRef = useRef<{ routeKey: string; selectionGeneration: number | null }>({
		routeKey,
		selectionGeneration: routeOwnership.ready ? routeOwnership.selectionGeneration : null,
	});
	if (routeOwnerRef.current.routeKey !== routeKey) {
		routeOwnerRef.current = {
			routeKey,
			selectionGeneration: routeOwnership.ready ? routeOwnership.selectionGeneration : null,
		};
	} else if (routeOwnerRef.current.selectionGeneration === null && routeOwnership.ready) {
		routeOwnerRef.current = { routeKey, selectionGeneration: routeOwnership.selectionGeneration };
	}
	const routeBelongsToSelection = routeOwnerRef.current.selectionGeneration === routeOwnership.selectionGeneration;
	useEffect(() => {
		if (!enabled || !controller?.ready || controller.conflict || !routeBelongsToSelection) return;
		const next = reconcileDesktopRoute(state, route);
		const shouldInitialize = !sessionTabsetHasDesktopState(controller.state) && (next.tabs.length > 0 || route.area !== "sessions");
		if (!shouldInitialize && serializeDesktopTabState(next) === stateKey) return;
		try {
			controller.edit((tabset) => ({ ...tabset, layout: desktopTabStateToSessionLayout(tabset.layout, next) }));
		} catch {
			// Loading and CAS conflicts are rendered by the shared Session workspace.
		}
	}, [controller, enabled, routeBelongsToSelection, routeKey, routeOwnership.selectionGeneration, stateKey]);
	const setState = useCallback<Dispatch<SetStateAction<DesktopTabState>>>((update) => {
		if (!enabled || !controller?.ready || controller.conflict) return;
		try {
			controller.edit((tabset) => {
				const current = desktopTabStateFromSessionTabset(tabset);
				const next = typeof update === "function" ? update(current) : update;
				return { ...tabset, layout: desktopTabStateToSessionLayout(tabset.layout, next) };
			});
		} catch {
			// Loading and CAS conflicts are rendered by the shared Session workspace.
		}
	}, [controller, enabled]);
	return { state, setState };
}

export function DesktopTabSidebar({
	state,
	onStateChange,
	onActivate,
	onClose,
	onBeforeRefresh,
	onFocusSessions,
	renderPanel,
	reservedLeftWidth,
	hidden = false,
	fullscreen = false,
}: {
	state: DesktopTabState;
	onStateChange: (state: DesktopTabState) => void;
	onActivate: (tab: DesktopTab) => void;
	onClose: (tab: DesktopTab) => boolean | Promise<boolean>;
	onBeforeRefresh?: (tab: DesktopTab) => boolean | Promise<boolean>;
	onFocusSessions: (newTab: DesktopTab) => void | Promise<void>;
	renderPanel: (tab: DesktopTab, active: boolean) => ReactNode;
	reservedLeftWidth: number;
	hidden?: boolean;
	fullscreen?: boolean;
}) {
	const plusButtonRef = useRef<HTMLButtonElement>(null);
	const catalogRef = useRef<HTMLDivElement>(null);
	const tabListRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const dragTabIdRef = useRef<string | null>(null);
	const [dragInsertion, setDragInsertion] = useState<DesktopTabDragInsertion | null>(null);
	const [refreshVersions, setRefreshVersions] = useState<Record<string, number>>({});
	const preparePluginRefresh = usePluginWorkspaceRefreshGuard();
	const focusAfterCloseRef = useRef(false);
	const activeTab = activeDesktopTab(state);
	const pluginViews = usePluginWorkspaceCatalogViews();
	const entries = useMemo(() => {
		const representedViews = new Set([
			"pibo.product-ui/user-resources",
			"pibo.product-ui/agent-designer",
			"pibo.product-ui/settings",
			"pibo.product-ui/workflows",
			"pibo.product-ui/cron",
			"pibo.product-ui/loops",
			"pibo.web-annotations/annotations",
		]);
		return [
			...desktopTabCatalog(),
			...pluginViews.filter((view) => !representedViews.has(view.id)).map((view) => ({
				id: `plugin:${view.id}`,
				label: view.title,
				description: `Plugin module · ${view.pluginId}`,
				icon: Layers3,
				target: { kind: "plugin-view" as const, piboSessionId: view.piboSessionId, viewId: view.id, title: view.title },
			})),
		];
	}, [pluginViews]);

	useLayoutEffect(() => {
		if (activeTab?.target.kind === "new-tab") catalogRef.current?.querySelector<HTMLButtonElement>("button[data-catalog-entry]")?.focus();
	}, [activeTab?.id]);

	useEffect(() => {
		if (state.collapsed || !activeTab) return;
		tabRefs.current.get(activeTab.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeTab?.id, state.collapsed]);

	useLayoutEffect(() => {
		if (!focusAfterCloseRef.current) return;
		focusAfterCloseRef.current = false;
		if (state.activeTabId) tabRefs.current.get(state.activeTabId)?.focus();
		else plusButtonRef.current?.focus();
	}, [state.activeTabId, state.tabs.length]);

	const requestClose = useCallback(async (tab: DesktopTab) => {
		focusAfterCloseRef.current = true;
		const closed = await onClose(tab);
		if (!closed) focusAfterCloseRef.current = false;
	}, [onClose]);
	const refreshTab = useCallback(async (tab: DesktopTab) => {
		const allowed = onBeforeRefresh
			? await onBeforeRefresh(tab)
			: !(desktopTabPluginViewId(tab.target)) || await preparePluginRefresh(desktopTabPluginViewId(tab.target)!);
		if (!allowed) return;
		setRefreshVersions((current) => ({ ...current, [tab.id]: (current[tab.id] ?? 0) + 1 }));
	}, [onBeforeRefresh, preparePluginRefresh]);

	const onCatalogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const buttons = [...catalogRef.current?.querySelectorAll<HTMLButtonElement>("button[data-catalog-entry]") ?? []];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let next = -1;
		if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % buttons.length;
		if (event.key === "ArrowUp") next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
		if (event.key === "Home") next = 0;
		if (event.key === "End") next = buttons.length - 1;
		if (next >= 0) {
			event.preventDefault();
			buttons[next]?.focus();
		}
	};

	const chooseCatalogEntry = (entry: CatalogEntry) => {
		if (!activeTab || activeTab.target.kind !== "new-tab") return;
		if (entry.sessionsAction) {
			void onFocusSessions(activeTab);
			return;
		}
		if (entry.target) onStateChange(replaceDesktopNewTab(state, activeTab.id, entry.target));
	};

	const focusTabAt = (index: number) => {
		const tab = state.tabs[Math.max(0, Math.min(state.tabs.length - 1, index))];
		if (tab) tabRefs.current.get(tab.id)?.focus();
	};

	const tabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: DesktopTab, index: number) => {
		if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			event.preventDefault();
			const delta = event.key === "ArrowLeft" ? -1 : 1;
			onStateChange(moveDesktopTab(state, tab.id, delta));
			window.setTimeout(() => tabRefs.current.get(tab.id)?.focus(), 0);
			return;
		}
		if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
			event.preventDefault();
			if (event.key === "Home") focusTabAt(0);
			else if (event.key === "End") focusTabAt(state.tabs.length - 1);
			else focusTabAt((index + (event.key === "ArrowLeft" ? -1 : 1) + state.tabs.length) % state.tabs.length);
			return;
		}
		if (event.key === "Delete") {
			event.preventDefault();
			void requestClose(tab);
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onActivate(tab);
		}
	};

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const resizeHandle = event.currentTarget;
		const pointerId = event.pointerId;
		const startX = event.clientX;
		const startWidth = resizeHandle.parentElement?.getBoundingClientRect().width ?? state.width;
		const move = (moveEvent: PointerEvent) => onStateChange(resizeDesktopTabs(state, startWidth + startX - moveEvent.clientX));
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			window.removeEventListener("pointercancel", stop);
			if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
			document.body.style.removeProperty("cursor");
			document.body.style.removeProperty("user-select");
		};
		resizeHandle.setPointerCapture(pointerId);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
		window.addEventListener("pointercancel", stop);
	};

	const shellStyle = {
		"--pibo-desktop-tabs-width": `${state.width}px`,
		width: fullscreen
			? "100%"
			: state.collapsed
				? `${DESKTOP_COLLAPSED_SIDEBAR_WIDTH}px`
				: `min(${state.width}px, max(0px, calc(100vw - ${reservedLeftWidth + DESKTOP_TERMINAL_MIN_WIDTH}px)))`,
	} as CSSProperties;

	return (
		<aside
			data-pibo-debug="desktop-tab-sidebar"
			data-pibo-state={fullscreen ? "preview-fullscreen" : state.collapsed ? "collapsed" : "open"}
			data-pibo-preview-fullscreen={fullscreen ? "true" : "false"}
			aria-label="Open workspace tabs"
			aria-hidden={hidden || undefined}
			hidden={hidden}
			className={`relative min-h-0 shrink-0 bg-[#101d22] ${fullscreen ? "border-l-0" : "border-l border-slate-700"}`}
			style={shellStyle}
		>
			<div
				role="separator"
				aria-label="Resize workspace tabs"
				aria-orientation="vertical"
				aria-valuemin={DESKTOP_TAB_MIN_WIDTH}
				aria-valuemax={DESKTOP_TAB_MAX_WIDTH}
				aria-valuenow={state.width}
				tabIndex={state.collapsed || fullscreen ? -1 : 0}
				onPointerDown={startResize}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					const currentWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? state.width;
					onStateChange(resizeDesktopTabs(state, currentWidth + (event.key === "ArrowLeft" ? 24 : -24)));
				}}
				className={`absolute inset-y-0 -left-1 z-20 w-2 touch-none cursor-col-resize outline-none hover:bg-[#11a4d4]/35 focus-visible:bg-[#11a4d4]/60 ${state.collapsed || fullscreen ? "hidden" : ""}`}
			/>
			{state.collapsed && !fullscreen ? (
				<div className="flex h-full flex-col items-center gap-2 border-l border-slate-800 bg-[#151f24] py-2">
					<button
						type="button"
						onClick={() => onStateChange({ ...state, collapsed: false })}
						className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"
						title="Reopen workspace tabs"
						aria-label="Reopen workspace tabs"
					>
						<PanelRightOpen size={15} />
					</button>
					<span className="mt-1 font-mono text-[10px] text-slate-500 [writing-mode:vertical-rl]">{state.tabs.length} tabs</span>
				</div>
			) : (
				<div className={`grid h-full min-h-0 ${fullscreen ? "grid-rows-[0_minmax(0,1fr)]" : "grid-rows-[40px_minmax(0,1fr)]"}`}>
					<div hidden={fullscreen} className="relative flex min-w-0 items-stretch border-b border-slate-800 bg-[#151f24]">
						<button type="button" onClick={() => tabListRef.current?.scrollBy({ left: -220, behavior: "smooth" })} title="Scroll tabs left" aria-label="Scroll tabs left" className="w-7 shrink-0 border-r border-slate-800 text-slate-500 hover:text-[#11a4d4]"><ChevronLeft size={13} className="mx-auto" /></button>
						<div
							ref={tabListRef}
							role="tablist"
							aria-label="Workspace tabs"
							onDragLeave={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragInsertion(null);
							}}
							className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
						>
							{state.tabs.map((tab, index) => {
								const selected = tab.id === state.activeTabId;
								const gapBefore = dragInsertion?.overTabId === tab.id && dragInsertion.position === "before";
								const gapAfter = dragInsertion?.overTabId === tab.id && dragInsertion.position === "after";
								return (
									<div key={tab.id} className="flex shrink-0 items-center">
										{gapBefore ? <DesktopTabDropGap index={dragInsertion.toIndex} /> : null}
										<div
										draggable
											onClick={() => onActivate(tab)}
											onDragStart={(event) => {
												dragTabIdRef.current = tab.id;
												event.dataTransfer.effectAllowed = "move";
												event.dataTransfer.setData("text/plain", tab.id);
											}}
											onDragOver={(event) => {
												event.preventDefault();
												event.dataTransfer.dropEffect = "move";
												const draggedTabId = dragTabIdRef.current;
												if (!draggedTabId || draggedTabId === tab.id) return;
												const bounds = event.currentTarget.getBoundingClientRect();
												const position = event.clientX >= bounds.left + bounds.width / 2 ? "after" : "before";
												const toIndex = desktopTabInsertionIndex(state.tabs, draggedTabId, tab.id, position);
												setDragInsertion((current) => current?.draggedTabId === draggedTabId && current.overTabId === tab.id && current.position === position
													? current
													: { draggedTabId, overTabId: tab.id, position, toIndex });
											}}
											onDrop={(event) => {
												event.preventDefault();
												const draggedTabId = dragTabIdRef.current;
												if (draggedTabId && dragInsertion?.draggedTabId === draggedTabId) onStateChange(reorderDesktopTab(state, draggedTabId, dragInsertion.toIndex));
												dragTabIdRef.current = null;
												setDragInsertion(null);
											}}
											onDragEnd={() => { dragTabIdRef.current = null; setDragInsertion(null); }}
											className={`group flex h-10 min-w-[9.5rem] max-w-[13rem] items-center border-r border-slate-800 ${dragTabIdRef.current === tab.id ? "opacity-60" : ""} ${selected ? "bg-[#101d22] text-[#7ddfff]" : "bg-[#151f24] text-slate-400 hover:bg-slate-800/60"}`}
									>
										<button
											ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
											id={`desktop-tab-${tab.id}`}
											type="button"
											role="tab"
											aria-selected={selected}
											aria-controls={`desktop-tabpanel-${tab.id}`}
											tabIndex={selected ? 0 : -1}
											onKeyDown={(event) => tabKeyDown(event, tab, index)}
											title={`${tab.title}. Alt+Shift+Arrow reorders; Delete closes.`}
											className="h-full min-w-0 flex-1 truncate px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"
										>
											{tab.title}
										</button>
										<button type="button" onClick={(event) => { event.stopPropagation(); void refreshTab(tab); }} title={`Refresh ${tab.title}`} aria-label={`Refresh ${tab.title}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-500 opacity-70 hover:bg-slate-700 hover:text-slate-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"><RefreshCw size={11} /></button>
										<button type="button" onClick={(event) => { event.stopPropagation(); void requestClose(tab); }} title={`Close ${tab.title}`} aria-label={`Close ${tab.title}`} className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-500 opacity-70 hover:bg-slate-700 hover:text-slate-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"><X size={12} /></button>
										</div>
										{gapAfter ? <DesktopTabDropGap index={dragInsertion.toIndex} /> : null}
									</div>
								);
							})}
							<button ref={plusButtonRef} type="button" onClick={() => onStateChange(openDesktopNewTab(state))} title="New Tab" aria-label="New Tab" className="w-9 shrink-0 border-r border-slate-800 text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"><Plus size={15} className="mx-auto" /></button>
						</div>
						<button type="button" onClick={() => tabListRef.current?.scrollBy({ left: 220, behavior: "smooth" })} title="Scroll tabs right" aria-label="Scroll tabs right" className="w-7 shrink-0 border-l border-slate-800 text-slate-500 hover:text-[#11a4d4]"><ChevronRight size={13} className="mx-auto" /></button>
						<button type="button" onClick={() => onStateChange({ ...state, collapsed: true })} title="Collapse workspace tabs" aria-label="Collapse workspace tabs" className="w-9 shrink-0 border-l border-slate-800 text-slate-400 hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"><PanelRightClose size={15} className="mx-auto" /></button>
					</div>
					<div className={`relative min-h-0 overflow-hidden bg-[#101d22] ${fullscreen ? "row-start-2" : ""}`}>
						{state.tabs.length ? state.tabs.map((tab) => {
							const selected = tab.id === state.activeTabId;
							return (
								<section key={tab.id} id={`desktop-tabpanel-${tab.id}`} role="tabpanel" aria-labelledby={`desktop-tab-${tab.id}`} hidden={!selected} className="h-full min-h-0 overflow-hidden">
									<Fragment key={`${tab.id}:${refreshVersions[tab.id] ?? 0}`}>
										{tab.target.kind === "new-tab" ? (
											<DesktopNewTabCatalog ref={selected ? catalogRef : undefined} entries={entries} onKeyDown={onCatalogKeyDown} onChoose={chooseCatalogEntry} />
										) : selected || desktopTabKeepsMounted(tab) ? renderPanel(tab, selected) : null}
									</Fragment>
								</section>
							);
						}) : (
							<div className="grid h-full place-items-center p-6 text-center"><div><ChevronsRight size={22} className="mx-auto text-slate-600" /><div className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-300">No workspace tabs</div><p className="mt-2 text-xs text-slate-500">Use + to open a product area or a session tool.</p></div></div>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}

function DesktopTabDropGap({ index }: { index: number }) {
	return <span aria-hidden="true" data-pibo-debug="desktop-tab-drop-gap" data-pibo-insertion-index={index} className="desktop-tab-drop-gap h-6 w-2 shrink-0 rounded-sm bg-[#11a4d4]/75 motion-reduce:animate-none" />;
}

const DesktopNewTabCatalog = function DesktopNewTabCatalog({
	ref,
	entries,
	onKeyDown,
	onChoose,
}: {
	ref?: React.Ref<HTMLDivElement>;
	entries: readonly CatalogEntry[];
	onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
	onChoose: (entry: CatalogEntry) => void;
}) {
	return (
		<div data-pibo-debug="desktop-new-tab" className="grid h-full min-h-0 place-items-center overflow-auto p-6">
			<div ref={ref} role="navigation" aria-label="New Tab module catalog" onKeyDown={onKeyDown} className="grid w-full max-w-2xl grid-cols-2 gap-1 border border-slate-700 bg-[#1a262b] p-3 max-[1180px]:grid-cols-1">
				<div className="col-span-full px-2 pb-2 pt-0.5">
					<h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">New Tab</h2>
					<p className="mt-1 text-[10px] text-slate-500">Open a product area or session tool</p>
				</div>
				{entries.map((entry) => {
					const Icon = entry.icon;
					return (
						<button key={entry.id} data-catalog-entry type="button" onClick={() => onChoose(entry)} className="flex min-w-0 items-start gap-2 rounded-sm border border-transparent px-2 py-2 text-left hover:border-slate-700 hover:bg-[#101d22] focus-visible:border-[#11a4d4] focus-visible:bg-[#101d22] focus-visible:outline-none">
							<Icon size={15} className="mt-0.5 shrink-0 text-[#11a4d4]" />
							<span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{entry.label}</span><span className="block text-[10px] leading-4 text-slate-500">{entry.description}</span></span>
						</button>
					);
				})}
			</div>
		</div>
	);
};

export function nextDesktopTabStateAfterClose(state: DesktopTabState, tabId: string): DesktopTabState {
	return closeDesktopTab(state, tabId);
}

export function desktopTabTool(tab: DesktopTab | null): DesktopSessionTool | null {
	return tab?.target.kind === "session-tool" ? tab.target.tool : null;
}

export function openTargetInDesktopTabs(state: DesktopTabState, target: DesktopTabTarget): DesktopTabState {
	return openDesktopTab(state, target);
}

export function activateTabInDesktopTabs(state: DesktopTabState, tabId: string): DesktopTabState {
	return activateDesktopTab(state, tabId);
}

export function resetDesktopTabsForTests(): DesktopTabState {
	return emptyDesktopTabState();
}
