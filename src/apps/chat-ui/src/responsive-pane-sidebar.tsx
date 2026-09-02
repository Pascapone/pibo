import { PanelLeftOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useMobileSidebarModal } from "./mobile-sidebar-accessibility";

export type PaneSurface = "route" | "tab";

export function usePaneSidebar({
	surface,
	mobileOpen,
	mobileViewport,
	onMobileClose,
	breakpoint = 760,
}: {
	surface: PaneSurface;
	mobileOpen: boolean;
	mobileViewport: boolean;
	onMobileClose: () => void;
	breakpoint?: number;
}) {
	const rootElementRef = useRef<HTMLDivElement>(null);
	const sidebarRef = useRef<HTMLElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
	const [tabNarrow, setTabNarrow] = useState(false);
	const [tabOpen, setTabOpen] = useState(false);
	const rootRef = useCallback((node: HTMLDivElement | null) => {
		rootElementRef.current = node;
		setRootElement(node);
	}, []);

	useEffect(() => {
		if (surface !== "tab" || !rootElement) return;
		const update = () => {
			const narrow = rootElement.getBoundingClientRect().width <= breakpoint;
			setTabNarrow(narrow);
			if (!narrow) setTabOpen(false);
		};
		update();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(update);
		observer.observe(rootElement);
		return () => observer.disconnect();
	}, [breakpoint, rootElement, surface]);

	const closeTabSidebar = useCallback(() => setTabOpen(false), []);
	const closeContainedSidebar = useMobileSidebarModal({
		isMobileViewport: surface === "tab" && tabNarrow,
		isOpen: surface === "tab" && tabOpen,
		onClose: closeTabSidebar,
		triggerRef,
		sidebarRef,
		rootRef: rootElementRef,
	});

	const isOverlay = surface === "tab" ? tabNarrow : mobileViewport;
	const isOpen = surface === "tab" ? tabOpen : mobileOpen;
	return {
		rootRef,
		sidebarRef,
		triggerRef,
		isOverlay,
		isOpen,
		openSidebar: () => surface === "tab" ? setTabOpen(true) : undefined,
		closeSidebar: surface === "tab" ? closeContainedSidebar : onMobileClose,
	};
}

export function ResponsiveTabSidebarPanel({
	label,
	sidebar,
	children,
	sidebarWidth = 210,
	contentOverflow = "auto",
}: {
	label: string;
	sidebar: ReactNode;
	children: ReactNode;
	sidebarWidth?: number;
	contentOverflow?: "auto" | "hidden";
}) {
	const layout = usePaneSidebar({
		surface: "tab",
		mobileOpen: false,
		mobileViewport: false,
		onMobileClose: () => undefined,
		breakpoint: 680,
	});

	return (
		<div
			ref={layout.rootRef}
			data-pibo-responsive-tab-panel={label.toLowerCase()}
			className={`relative grid h-full min-h-0 overflow-hidden ${layout.isOverlay ? "grid-cols-1" : "grid-cols-[var(--pibo-panel-sidebar-width)_minmax(0,1fr)]"}`}
			style={{ "--pibo-panel-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
		>
			<div
				data-pibo-mobile-sidebar-backdrop
				aria-hidden="true"
				className={`absolute inset-0 z-30 bg-black/60 transition-opacity duration-200 ${layout.isOverlay ? "block" : "hidden"} ${layout.isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
				onClick={layout.closeSidebar}
			/>
			<aside
				ref={layout.sidebarRef}
				data-pibo-mobile-sidebar
				aria-hidden={layout.isOverlay && !layout.isOpen ? true : undefined}
				inert={layout.isOverlay && !layout.isOpen ? true : undefined}
				role={layout.isOverlay && layout.isOpen ? "dialog" : undefined}
				aria-modal={layout.isOverlay && layout.isOpen ? true : undefined}
				aria-label={layout.isOverlay && layout.isOpen ? `${label} sidebar` : undefined}
				tabIndex={layout.isOverlay && layout.isOpen ? -1 : undefined}
				className={`min-h-0 overflow-hidden border-r border-slate-800 bg-[#1a262b] flex flex-col ${layout.isOverlay ? `absolute inset-y-0 left-0 z-40 w-[min(${sidebarWidth}px,86%)] transition-transform duration-200 ${layout.isOpen ? "translate-x-0" : "-translate-x-full"}` : "relative"}`}
			>
				{layout.isOverlay ? (
					<div className="flex h-10 items-center justify-between border-b border-slate-800 px-3 text-xs font-bold uppercase tracking-wider">
						<span>{label}</span>
						<button type="button" onClick={layout.closeSidebar} title={`Close ${label}`} aria-label={`Close ${label}`} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={13} /></button>
					</div>
				) : null}
				<div className="min-h-0 flex-1 overflow-auto">{sidebar}</div>
			</aside>
			<main className="flex min-h-0 min-w-0 flex-col bg-[#101d22]">
				{layout.isOverlay ? (
					<div className="flex h-10 shrink-0 items-center border-b border-slate-800 bg-[#151f24] px-3">
						<button ref={layout.triggerRef} type="button" onClick={layout.openSidebar} className="inline-flex h-7 items-center gap-2 rounded-sm border border-slate-700 px-2 text-xs font-semibold text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]" aria-label={`Open ${label}`}><PanelLeftOpen size={13} /> {label}</button>
					</div>
				) : null}
				<div className={`@container min-h-0 min-w-0 flex-1 ${contentOverflow === "auto" ? "overflow-auto" : "overflow-hidden"}`}>{children}</div>
			</main>
		</div>
	);
}
