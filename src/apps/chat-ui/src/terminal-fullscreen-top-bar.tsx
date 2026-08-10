import { PanelTopOpen, Plus } from "lucide-react";

export function TerminalFullscreenTopBar({
	title,
	onOpenSessionWindow,
	onExit,
}: {
	title: string | null | undefined;
	onOpenSessionWindow?: () => void;
	onExit: () => void;
}) {
	return (
		<div
			data-pibo-debug="terminal-fullscreen-top-bar"
			className="h-7 min-h-7 flex items-center border-b border-slate-600 bg-[#151f24]"
		>
			<div className="min-w-0 flex-1 truncate text-base font-semibold leading-none">{title}</div>
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
