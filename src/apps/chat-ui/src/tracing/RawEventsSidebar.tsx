import { useMemo } from "react";
import type { PiboSessionTraceView } from "../types";
import { JsonRenderer } from "./JsonRenderer";
import { compactRawEvents } from "./raw-events";

type RawEventsSidebarProps = {
	traceView: PiboSessionTraceView | null;
	eventLimit: number;
	isFetching: boolean;
	visible: boolean;
	onLoadOlder: () => void;
};

export function RawEventsSidebar({
	traceView,
	eventLimit,
	isFetching,
	visible,
	onLoadOlder,
}: RawEventsSidebarProps) {
	const rawEvents = useMemo(
		() => (visible ? compactRawEvents(traceView?.rawEvents ?? []) : []),
		[traceView?.rawEvents, visible],
	);

	if (!visible) return null;

	return (
		<aside className="min-h-0 overflow-auto bg-[#0e1116] border-l border-slate-800 max-[980px]:hidden">
			<div className="h-11 px-3 border-b border-slate-800 flex items-center text-xs font-bold uppercase tracking-wider">Raw Events</div>
			<div className="p-3 flex flex-col gap-2">
				{traceView && rawEvents.length >= eventLimit ? (
					<button
						type="button"
						onClick={onLoadOlder}
						disabled={isFetching}
						className="mb-1 rounded-sm border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
					>
						{isFetching ? "Loading raw events…" : `Load older raw events (${rawEvents.length})`}
					</button>
				) : null}
				{rawEvents.slice(-eventLimit).reverse().map((event) => (
					<div key={event.id} className="border-l-2 border-[#11a4d4] bg-[#151f24] p-2">
						<div className="flex items-center justify-between gap-2 text-[#11a4d4] font-mono text-[11px] mb-1">
							<span>{event.type}</span>
							{event.count > 1 ? <span className="text-slate-500">x{event.count}</span> : null}
						</div>
						<JsonRenderer value={event.payload} showControls={false} />
					</div>
				))}
			</div>
		</aside>
	);
}
