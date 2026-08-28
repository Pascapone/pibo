import { PanelTopOpen, Plus } from "lucide-react";

export function TerminalFullscreenTopBar({
	title,
	contextKind,
	contextLabel,
	onOpenSessionWindow,
	onExit,
}: {
	title: string | null | undefined;
	contextKind: "room" | "project";
	contextLabel: string;
	onOpenSessionWindow?: () => void;
	onExit: () => void;
}) {
	const contextKindLabel = contextKind === "project" ? "Project" : "Room";
	return (
		<div
			data-pibo-debug="terminal-fullscreen-top-bar"
			className="h-7 min-h-7 flex items-center border-b border-slate-600 bg-[#151f24]"
		>
			<div className="flex min-w-0 flex-1 items-center">
				<div
					data-pibo-debug="session-context"
					data-pibo-context-kind={contextKind}
					title={`${contextKindLabel}: ${contextLabel}`}
					aria-label={`${contextKindLabel}: ${contextLabel}`}
					className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1.5 px-2 font-mono text-[10px] leading-none"
				>
					<span className="shrink-0 uppercase tracking-wide text-[#11a4d4]">{contextKindLabel}</span>
					<span className="truncate text-slate-300">{contextLabel}</span>
				</div>
				<span className="shrink-0 text-slate-600">·</span>
				<div className="min-w-0 flex-1 truncate px-2 text-base font-semibold leading-none">{title}</div>
			</div>
			{onOpenSessionWindow ? (
				<button
					type="button"
					onClick={onOpenSessionWindow}
					title="Open selected session in new window"
					aria-label="Open selected session in new window"
					data-pibo-debug="open-session-window"
					className="h-full w-7 shrink-0 inline-flex items-center justify-center text-slate-400 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4]"
				>
					<Plus size={14} />
				</button>
			) : null}
			<button
				type="button"
				onClick={onExit}
				title="Show normal top bar"
				aria-label="Exit Terminal fullscreen"
				className="h-full w-7 shrink-0 inline-flex items-center justify-center text-slate-400 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4]"
			>
				<PanelTopOpen size={14} />
			</button>
		</div>
	);
}
