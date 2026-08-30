import {
	Braces,
	ChevronLeft,
	ChevronRight,
	ChevronsRight,
	Clock3,
	Code2,
	FolderKanban,
	GitBranch,
	Layers3,
	ListTree,
	MessageSquareText,
	PanelRightClose,
	PanelRightOpen,
	Plus,
	Settings,
	Sparkles,
	TerminalSquare,
	Workflow,
	X,
	type LucideIcon,
} from "lucide-react";
import {
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
import {
	activateDesktopTab,
	activeDesktopTab,
	closeDesktopTab,
	DESKTOP_TAB_MAX_WIDTH,
	DESKTOP_TAB_MIN_WIDTH,
	desktopTabKeepsMounted,
	emptyDesktopTabState,
	moveDesktopTab,
	openDesktopTab,
	readDesktopTabState,
	reconcileDesktopRoute,
	reorderDesktopTab,
	resizeDesktopTabs,
	type DesktopSessionTool,
	type DesktopTab,
	type DesktopTabState,
	type DesktopTabTarget,
	writeDesktopTabState,
} from "./desktop-tabs-model";

type CatalogEntry = {
	id: string;
	label: string;
	description: string;
	icon: LucideIcon;
	target?: DesktopTabTarget;
	sessionsAction?: true;
};

export function desktopCatalogPointerIsOutside(
	catalog: Pick<Node, "contains"> | null,
	plusButton: Pick<Node, "contains"> | null,
	target: Node,
): boolean {
	return !catalog?.contains(target) && !plusButton?.contains(target);
}

const SESSION_TOOL_CATALOG: readonly CatalogEntry[] = [
	{ id: "preview", label: "Preview", description: "Live session preview", icon: Sparkles, target: { kind: "session-tool", tool: "preview" } },
	{ id: "raw-events", label: "Raw Events", description: "Raw trace and event payloads", icon: Braces, target: { kind: "session-tool", tool: "raw-events" } },
	{ id: "web-annotations", label: "Web Annotations", description: "Annotations attached to this session", icon: MessageSquareText, target: { kind: "session-tool", tool: "web-annotations" } },
	{ id: "runtime-requests", label: "Runtime Requests", description: "Approvals and runtime input", icon: TerminalSquare, target: { kind: "session-tool", tool: "runtime-requests" } },
	{ id: "session-inspector", label: "Session Inspector", description: "Session, signal, and runtime metadata", icon: ListTree, target: { kind: "session-tool", tool: "session-inspector" } },
] as const;

export function desktopTabCatalog(_vscodeEnabled: boolean): readonly CatalogEntry[] {
	const routes: CatalogEntry[] = [
		{ id: "sessions", label: "Sessions", description: "Focus the fixed Rooms and Sessions navigation", icon: Layers3, sessionsAction: true },
		{ id: "projects", label: "Projects", description: "Project workspaces and project sessions", icon: FolderKanban, target: { kind: "route", route: { area: "projects" } } },
		{ id: "vscode", label: "VS Code", description: "Embedded workspace editor", icon: Code2, target: { kind: "route", route: { area: "vscode" } } },
		{ id: "workflows", label: "Workflows", description: "Workflow definitions and drafts", icon: Workflow, target: { kind: "route", route: { area: "workflows" } } },
		{ id: "cron", label: "Cron", description: "Scheduled jobs", icon: Clock3, target: { kind: "route", route: { area: "cron" } } },
		{ id: "loops", label: "Loops", description: "Goal and legacy Ralph loops", icon: GitBranch, target: { kind: "route", route: { area: "loops" } } },
		{ id: "agents", label: "Agent Designer", description: "Agents, profiles, and capability selection", icon: Sparkles, target: { kind: "route", route: { area: "agents" } } },
		{ id: "context", label: "Context", description: "Context files, prompts, and MCP tools", icon: Braces, target: { kind: "route", route: { area: "context" } } },
		{ id: "settings", label: "Settings", description: "Chat and runtime settings", icon: Settings, target: { kind: "route", route: { area: "settings" } } },
	];
	return [...routes, ...SESSION_TOOL_CATALOG];
}

export function useDesktopTabWorkspace(route: ChatAppRoute, enabled: boolean): {
	state: DesktopTabState;
	setState: Dispatch<SetStateAction<DesktopTabState>>;
} {
	const [state, setState] = useState<DesktopTabState>(() => readDesktopTabState());
	const routeKey = useMemo(() => JSON.stringify(route), [route]);
	useEffect(() => {
		if (!enabled) return;
		setState((current) => reconcileDesktopRoute(current, route));
	}, [enabled, routeKey]);
	useEffect(() => {
		if (enabled) writeDesktopTabState(state);
	}, [enabled, state]);
	return { state, setState };
}

export function DesktopTabSidebar({
	state,
	vscodeEnabled,
	onStateChange,
	onActivate,
	onClose,
	onOpenTarget,
	onFocusSessions,
	renderPanel,
	hidden = false,
	fullscreen = false,
}: {
	state: DesktopTabState;
	vscodeEnabled: boolean;
	onStateChange: (state: DesktopTabState) => void;
	onActivate: (tab: DesktopTab) => void;
	onClose: (tab: DesktopTab) => boolean | Promise<boolean>;
	onOpenTarget: (target: DesktopTabTarget) => void;
	onFocusSessions: () => void;
	renderPanel: (tab: DesktopTab, active: boolean) => ReactNode;
	hidden?: boolean;
	fullscreen?: boolean;
}) {
	const [catalogOpen, setCatalogOpen] = useState(false);
	const plusButtonRef = useRef<HTMLButtonElement>(null);
	const catalogRef = useRef<HTMLDivElement>(null);
	const tabListRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const dragTabIdRef = useRef<string | null>(null);
	const focusAfterCloseRef = useRef(false);
	const activeTab = activeDesktopTab(state);
	const entries = useMemo(() => desktopTabCatalog(vscodeEnabled), [vscodeEnabled]);

	useLayoutEffect(() => {
		if (catalogOpen) catalogRef.current?.querySelector<HTMLButtonElement>("button[data-catalog-entry]")?.focus();
	}, [catalogOpen]);

	useEffect(() => {
		if (!catalogOpen) return;
		const closeFromOutside = (event: PointerEvent) => {
			const target = event.target as Node;
			if (desktopCatalogPointerIsOutside(catalogRef.current, plusButtonRef.current, target)) setCatalogOpen(false);
		};
		window.addEventListener("pointerdown", closeFromOutside);
		return () => window.removeEventListener("pointerdown", closeFromOutside);
	}, [catalogOpen]);

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

	const closeCatalog = useCallback((restoreFocus = true) => {
		setCatalogOpen(false);
		if (restoreFocus) window.setTimeout(() => plusButtonRef.current?.focus(), 0);
	}, []);

	const onCatalogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			closeCatalog();
			return;
		}
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
		const startX = event.clientX;
		const startWidth = state.width;
		const move = (moveEvent: PointerEvent) => onStateChange(resizeDesktopTabs(state, startWidth + startX - moveEvent.clientX));
		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
			document.body.style.removeProperty("cursor");
			document.body.style.removeProperty("user-select");
		};
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop);
	};

	const shellStyle = {
		"--pibo-desktop-tabs-width": `${state.width}px`,
		width: fullscreen ? "100%" : state.collapsed ? "44px" : `min(${state.width}px, calc(100vw - 740px))`,
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
					onStateChange(resizeDesktopTabs(state, state.width + (event.key === "ArrowLeft" ? 24 : -24)));
				}}
				className={`absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize outline-none hover:bg-[#11a4d4]/35 focus-visible:bg-[#11a4d4]/60 ${state.collapsed || fullscreen ? "hidden" : ""}`}
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
						<div ref={tabListRef} role="tablist" aria-label="Workspace tabs" className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							{state.tabs.map((tab, index) => {
								const selected = tab.id === state.activeTabId;
								return (
									<div
										key={tab.id}
										draggable
										onDragStart={(event) => { dragTabIdRef.current = tab.id; event.dataTransfer.effectAllowed = "move"; }}
										onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
										onDrop={(event) => { event.preventDefault(); if (dragTabIdRef.current) onStateChange(reorderDesktopTab(state, dragTabIdRef.current, index)); dragTabIdRef.current = null; }}
										className={`group flex h-10 min-w-[9.5rem] max-w-[13rem] items-center border-r border-slate-800 ${selected ? "bg-[#101d22] text-[#7ddfff]" : "bg-[#151f24] text-slate-400 hover:bg-slate-800/60"}`}
									>
										<button
											ref={(node) => { if (node) tabRefs.current.set(tab.id, node); else tabRefs.current.delete(tab.id); }}
											id={`desktop-tab-${tab.id}`}
											type="button"
											role="tab"
											aria-selected={selected}
											aria-controls={`desktop-tabpanel-${tab.id}`}
											tabIndex={selected ? 0 : -1}
											onClick={() => onActivate(tab)}
											onKeyDown={(event) => tabKeyDown(event, tab, index)}
											title={`${tab.title}. Alt+Shift+Arrow reorders; Delete closes.`}
											className="min-w-0 flex-1 truncate px-2 text-left text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"
										>
											{tab.title}
										</button>
										<button type="button" onClick={() => void requestClose(tab)} title={`Close ${tab.title}`} aria-label={`Close ${tab.title}`} className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-500 opacity-70 hover:bg-slate-700 hover:text-slate-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"><X size={12} /></button>
									</div>
								);
							})}
						</div>
						<button type="button" onClick={() => tabListRef.current?.scrollBy({ left: 220, behavior: "smooth" })} title="Scroll tabs right" aria-label="Scroll tabs right" className="w-7 shrink-0 border-l border-slate-800 text-slate-500 hover:text-[#11a4d4]"><ChevronRight size={13} className="mx-auto" /></button>
						<button ref={plusButtonRef} type="button" onClick={() => setCatalogOpen((open) => !open)} aria-haspopup="menu" aria-expanded={catalogOpen} title="Open workspace catalog" aria-label="Open workspace catalog" className="w-9 shrink-0 border-l border-slate-800 text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"><Plus size={15} className="mx-auto" /></button>
						<button type="button" onClick={() => onStateChange({ ...state, collapsed: true })} title="Collapse workspace tabs" aria-label="Collapse workspace tabs" className="w-9 shrink-0 border-l border-slate-800 text-slate-400 hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"><PanelRightClose size={15} className="mx-auto" /></button>
						{catalogOpen ? (
							<div ref={catalogRef} role="menu" aria-label="Workspace catalog" onKeyDown={onCatalogKeyDown} className="absolute right-1 top-[calc(100%+4px)] z-50 grid w-[min(31rem,calc(100vw-2rem))] grid-cols-2 gap-1 border border-slate-700 bg-[#1a262b] p-2 shadow-2xl">
								<div className="col-span-2 px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Open a product area or session tool</div>
								{entries.map((entry) => {
									const Icon = entry.icon;
									return (
										<button
											key={entry.id}
											data-catalog-entry
											type="button"
											role="menuitem"
											onClick={() => { closeCatalog(false); if (entry.sessionsAction) onFocusSessions(); else if (entry.target) onOpenTarget(entry.target); }}
											className="flex min-w-0 items-start gap-2 rounded-sm border border-transparent px-2 py-2 text-left hover:border-slate-700 hover:bg-[#101d22] focus-visible:border-[#11a4d4] focus-visible:bg-[#101d22] focus-visible:outline-none"
										>
											<Icon size={15} className="mt-0.5 shrink-0 text-[#11a4d4]" />
											<span className="min-w-0"><span className="block truncate text-xs font-semibold text-slate-200">{entry.label}</span><span className="block text-[10px] leading-4 text-slate-500">{entry.description}</span></span>
										</button>
									);
								})}
							</div>
						) : null}
					</div>
					<div className={`relative min-h-0 overflow-hidden bg-[#101d22] ${fullscreen ? "row-start-2" : ""}`}>
						{state.tabs.length ? state.tabs.map((tab) => {
							const selected = tab.id === state.activeTabId;
							return (
								<section key={tab.id} id={`desktop-tabpanel-${tab.id}`} role="tabpanel" aria-labelledby={`desktop-tab-${tab.id}`} hidden={!selected} className="h-full min-h-0 overflow-hidden">
									{selected || desktopTabKeepsMounted(tab) ? renderPanel(tab, selected) : null}
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
