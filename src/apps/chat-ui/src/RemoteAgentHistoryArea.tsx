import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { listRemoteToolCalls, type RemoteToolCallRecord } from "./api-remote-agent";
import { JsonRenderer } from "./tracing/JsonRenderer";
import type { BootstrapData } from "./types";

const POLL_INTERVAL_MS = 5000;

function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleTimeString([], { hour12: false });
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function HistoryRow({ record, expanded, onToggle }: { record: RemoteToolCallRecord; expanded: boolean; onToggle: () => void }) {
	return (
		<div className="border-b border-slate-800/70 last:border-b-0">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800/40"
			>
				<span className="shrink-0 text-slate-500">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
				<span className="shrink-0 font-mono text-slate-400" title={record.startedAt}>{formatTime(record.startedAt)}</span>
				<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${record.ok ? "bg-emerald-400" : "bg-red-400"}`} title={record.ok ? "ok" : record.error ?? "error"} />
				<span className="min-w-0 flex-1 truncate">
					<span className="font-medium text-slate-200">{record.toolName}</span>
					<span className="text-slate-500"> · {record.label || "unlabeled"} </span>
					<span className="font-mono text-slate-600" title={record.tokenId}>{shortId(record.tokenId)}</span>
				</span>
				<span className="hidden shrink-0 font-mono text-[10px] uppercase text-slate-600 sm:inline">{record.transport}</span>
				<span className="shrink-0 font-mono text-slate-500">{formatDuration(record.durationMs)}</span>
			</button>
			{expanded && (
				<div className="space-y-1.5 px-2 pb-2 pl-6">
					{record.error && (
						<p className="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-1 font-mono text-[11px] text-red-200">{record.error}</p>
					)}
					<div>
						<div className="pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Arguments</div>
						<JsonRenderer value={record.argsJson} defaultExpandLevel={2} maxHeight="12rem" showControls={false} />
					</div>
					{record.resultJson !== undefined && (
						<div>
							<div className="pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Result</div>
							<JsonRenderer value={record.resultJson} defaultExpandLevel={1} maxHeight="12rem" showControls={false} />
						</div>
					)}
					{record.resultJson === undefined && record.resultText !== undefined && (
						<div>
							<div className="pb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Result</div>
							<pre className="max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-300" style={{ maxHeight: "12rem" }}>{record.resultText}</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function RemoteAgentHistoryArea({ bootstrap, initialRoomId }: { bootstrap: BootstrapData; initialRoomId?: string }) {
	const rooms = useMemo(
		() => [...bootstrap.rooms].sort((a, b) => a.name.localeCompare(b.name)),
		[bootstrap.rooms],
	);
	const [roomId, setRoomId] = useState(initialRoomId || bootstrap.selectedRoomId || rooms[0]?.id || "");
	const [records, setRecords] = useState<RemoteToolCallRecord[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const [clientFilter, setClientFilter] = useState("");
	const [autoRefresh, setAutoRefresh] = useState(true);

	const load = useCallback(async (id: string) => {
		if (!id) return;
		setLoading(true);
		setError(null);
		try {
			const result = await listRemoteToolCalls(id);
			setRecords(result.toolCalls);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		setExpandedId(null);
		setClientFilter("");
		if (roomId) void load(roomId);
	}, [roomId, load]);

	useEffect(() => {
		if (!autoRefresh || !roomId) return;
		const timer = window.setInterval(() => {
			void listRemoteToolCalls(roomId).then(
				(result) => setRecords(result.toolCalls),
				() => undefined,
			);
		}, POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [autoRefresh, roomId]);

	const clients = useMemo(() => {
		const seen = new Map<string, string>();
		for (const record of records) {
			if (!seen.has(record.tokenId)) seen.set(record.tokenId, record.label || "unlabeled");
		}
		return [...seen.entries()].map(([tokenId, label]) => ({ tokenId, label }));
	}, [records]);

	const visible = clientFilter ? records.filter((record) => record.tokenId === clientFilter) : records;

	if (rooms.length === 0) {
		return <p className="p-3 text-[13px] text-slate-400">Create a room first to see remote tool history.</p>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-[#151f24] px-2 py-1.5">
				<label htmlFor="remote-history-room" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Room</label>
				<select
					id="remote-history-room"
					value={roomId}
					onChange={(event) => setRoomId(event.target.value)}
					className="min-w-0 flex-1 bg-[#101d22] border border-slate-700 rounded-sm text-[12px] px-1.5 py-1 focus:border-[#11a4d4] focus:outline-none sm:max-w-44"
				>
					{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
				</select>
				<label htmlFor="remote-history-client" className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Client</label>
				<select
					id="remote-history-client"
					value={clientFilter}
					onChange={(event) => setClientFilter(event.target.value)}
					className="min-w-0 flex-1 bg-[#101d22] border border-slate-700 rounded-sm text-[12px] px-1.5 py-1 focus:border-[#11a4d4] focus:outline-none sm:max-w-40"
				>
					<option value="">All ({records.length})</option>
					{clients.map((client) => (
						<option key={client.tokenId} value={client.tokenId}>{client.label} · {shortId(client.tokenId)}</option>
					))}
				</select>
				<label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-slate-400">
					<input
						type="checkbox"
						checked={autoRefresh}
						onChange={(event) => setAutoRefresh(event.target.checked)}
						className="accent-[#11a4d4]"
					/>
					Live
				</label>
				<button
					type="button"
					onClick={() => roomId && void load(roomId)}
					disabled={loading}
					title="Refresh"
					aria-label="Refresh history"
					className="shrink-0 p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
				>
					{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
				</button>
			</div>
			{error && <p role="alert" className="mx-2 mt-2 shrink-0 text-[12px] border border-red-500/40 bg-red-500/10 text-red-200 rounded-sm px-2 py-1">{error}</p>}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{visible.length === 0 && !loading
					? <p className="p-3 text-[12px] text-slate-500">No tool calls yet. Calls from connected clients appear here newest first.</p>
					: visible.map((record) => (
						<HistoryRow
							key={record.id}
							record={record}
							expanded={expandedId === record.id}
							onToggle={() => setExpandedId((current) => (current === record.id ? null : record.id))}
						/>
					))}
			</div>
		</div>
	);
}
