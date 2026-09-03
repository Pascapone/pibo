import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
	DESKTOP_COLLAPSED_SIDEBAR_WIDTH,
	DESKTOP_SESSION_SIDEBAR_MAX_WIDTH,
	DESKTOP_SESSION_SIDEBAR_MIN_WIDTH,
	readDesktopSessionSidebarState,
	resizeDesktopSessionSidebar,
	type DesktopSessionSidebarState,
	writeDesktopSessionSidebarState,
} from "./desktop-session-sidebar-model";

export function useDesktopSessionSidebar(): {
	state: DesktopSessionSidebarState;
	setState: React.Dispatch<React.SetStateAction<DesktopSessionSidebarState>>;
} {
	const [state, setState] = useState<DesktopSessionSidebarState>(() => readDesktopSessionSidebarState());
	useEffect(() => writeDesktopSessionSidebarState(state), [state]);
	return { state, setState };
}

export function DesktopSessionSidebar({
	state,
	onStateChange,
	onRefresh,
	children,
	hidden = false,
}: {
	state: DesktopSessionSidebarState;
	onStateChange: (state: DesktopSessionSidebarState) => void;
	onRefresh: () => void;
	children: ReactNode;
	hidden?: boolean;
}) {
	const shellStyle = {
		width: state.collapsed ? `${DESKTOP_COLLAPSED_SIDEBAR_WIDTH}px` : `${state.width}px`,
	} as CSSProperties;

	const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? state.width;
		const move = (moveEvent: PointerEvent) => onStateChange(resizeDesktopSessionSidebar(state, startWidth + moveEvent.clientX - startX));
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

	return (
		<aside
			data-pibo-debug="desktop-session-sidebar"
			data-pibo-state={state.collapsed ? "collapsed" : "open"}
			tabIndex={-1}
			hidden={hidden}
			aria-hidden={hidden || undefined}
			className="relative min-h-0 shrink-0 overflow-hidden border-r border-slate-800 bg-[#1a262b] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#11a4d4]"
			style={shellStyle}
		>
			<div
				role="separator"
				aria-label="Resize Sessions sidebar"
				aria-orientation="vertical"
				aria-valuemin={DESKTOP_SESSION_SIDEBAR_MIN_WIDTH}
				aria-valuemax={DESKTOP_SESSION_SIDEBAR_MAX_WIDTH}
				aria-valuenow={state.width}
				tabIndex={state.collapsed ? -1 : 0}
				onPointerDown={startResize}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					const currentWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? state.width;
					onStateChange(resizeDesktopSessionSidebar(state, currentWidth + (event.key === "ArrowRight" ? 24 : -24)));
				}}
				className={`absolute inset-y-0 -right-1 z-20 w-2 touch-none cursor-col-resize outline-none hover:bg-[#11a4d4]/35 focus-visible:bg-[#11a4d4]/60 ${state.collapsed ? "hidden" : ""}`}
			/>
			{state.collapsed ? (
				<div className="flex h-full flex-col items-center gap-2 bg-[#151f24] py-2">
					<button
						type="button"
						onClick={() => onStateChange({ ...state, collapsed: false })}
						className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"
						title="Reopen Sessions sidebar"
						aria-label="Reopen Sessions sidebar"
					>
						<PanelLeftOpen size={15} />
					</button>
					<span className="mt-1 font-mono text-[10px] text-slate-500 [writing-mode:vertical-rl]">Sessions</span>
				</div>
			) : (
				<div className="flex h-full min-h-0 flex-col">
					<div className="flex h-11 shrink-0 items-center justify-between border-b border-slate-800 px-3 text-xs font-bold uppercase tracking-wider">
						<span className="truncate">Sessions</span>
						<div className="flex shrink-0 items-center gap-1">
							<button type="button" onClick={onRefresh} title="Refresh Sessions" aria-label="Refresh Sessions" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"><RefreshCw size={13} /></button>
							<button type="button" onClick={() => onStateChange({ ...state, collapsed: true })} title="Collapse Sessions sidebar" aria-label="Collapse Sessions sidebar" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]"><PanelLeftClose size={13} /></button>
						</div>
					</div>
					{children}
				</div>
			)}
		</aside>
	);
}
