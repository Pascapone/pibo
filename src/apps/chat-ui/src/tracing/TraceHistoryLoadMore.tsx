import type { PiboSessionTraceView } from "../types";

type TraceHistoryLoadMoreProps = {
	traceView: PiboSessionTraceView | null;
	eventLimit: number;
	isFetching: boolean;
	onLoadOlder: () => void;
};

export function TraceHistoryLoadMore({ traceView, eventLimit, isFetching, onLoadOlder }: TraceHistoryLoadMoreProps) {
	if (!traceView?.hasOlderEvents) return null;

	const visibleEventCount = Math.min(traceView.eventLimit ?? eventLimit, traceView.eventCount ?? eventLimit);
	const totalEventCount = traceView.eventCount ?? "many";

	return (
		<div className="border-b border-slate-800 bg-[#101d22] px-4 py-2 text-center">
			<button
				type="button"
				onClick={onLoadOlder}
				disabled={isFetching}
				className="rounded-sm border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
			>
				{isFetching ? "Loading history…" : `Load older trace history (${visibleEventCount} of ${totalEventCount} events)`}
			</button>
		</div>
	);
}
