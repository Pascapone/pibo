import { Copy, ExternalLink, Maximize2, PanelTopOpen, RefreshCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SessionLivePreview } from "./api-previews";
import { copyTextToClipboard } from "./clipboard";

function healthClass(health: SessionLivePreview["health"]): string {
	if (health === "online") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
	if (health === "offline") return "border-amber-500/50 bg-amber-500/10 text-amber-300";
	return "border-slate-600 bg-slate-800 text-slate-400";
}

function openPreviewWindow(preview: SessionLivePreview): void {
	window.open(preview.openUrl, "_blank", "noopener,noreferrer");
}

export function SessionLivePreviewPanel({
	previews,
	selectedPreview,
	loading,
	error,
	reloadKey,
	fullscreen = false,
	onSelect,
	onReload,
	onRefresh,
	onClose,
	onEnterFullscreen,
}: {
	previews: readonly SessionLivePreview[];
	selectedPreview?: SessionLivePreview;
	loading: boolean;
	error?: string;
	reloadKey: number;
	fullscreen?: boolean;
	onSelect: (previewId: string) => void;
	onReload: () => void;
	onRefresh: () => void;
	onClose: (previewId: string) => void;
	onEnterFullscreen?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	if (loading && previews.length === 0) return <PreviewMessage label="Loading live previews…" />;
	if (error && previews.length === 0) return <PreviewMessage label={error} tone="error" />;
	if (!selectedPreview) return <PreviewMessage label="No active live preview is attached to this session." />;

	const copyOpenUrl = () => {
		const url = new URL(selectedPreview.openUrl, window.location.origin).toString();
		void copyTextToClipboard(url).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 900);
		});
	};

	return (
		<section
			data-pibo-debug="session-live-preview"
			data-pibo-preview-id={selectedPreview.id}
			data-pibo-preview-fullscreen={fullscreen ? "true" : "false"}
			className="min-h-0 flex-1 bg-[#0e1116] flex flex-col"
		>
			{fullscreen ? null : (
				<div className="min-h-11 border-b border-slate-800 bg-[#151f24] px-3 flex items-center gap-2">
					<select
						id="session-live-preview-select"
						name="session-live-preview"
						value={selectedPreview.id}
						onChange={(event) => onSelect(event.target.value)}
						aria-label="Selected live preview"
						className="min-w-0 max-w-72 h-8 border border-slate-700 bg-[#0e1116] px-2 text-xs text-slate-200 focus:border-[#11a4d4] focus:outline-none"
					>
						{previews.map((preview) => <option key={preview.id} value={preview.id}>{preview.label}</option>)}
					</select>
					<span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${healthClass(selectedPreview.health)}`}>
						{selectedPreview.health}
					</span>
					<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">:{selectedPreview.targetPort}</span>
					<PreviewIconButton label="Refresh preview status" onClick={onRefresh}><RefreshCw size={14} /></PreviewIconButton>
					<PreviewIconButton label="Reload live preview" onClick={onReload}><RefreshCw size={14} /></PreviewIconButton>
					<PreviewIconButton label={copied ? "Copied preview link" : "Copy authenticated preview link"} onClick={copyOpenUrl}><Copy size={14} /></PreviewIconButton>
					<PreviewIconButton label="Open live preview in new window" onClick={() => openPreviewWindow(selectedPreview)}><ExternalLink size={14} /></PreviewIconButton>
					{onEnterFullscreen ? <PreviewIconButton label="Enter Preview fullscreen" onClick={onEnterFullscreen}><Maximize2 size={14} /></PreviewIconButton> : null}
					<PreviewIconButton label="Close live preview" danger onClick={() => onClose(selectedPreview.id)}><Trash2 size={14} /></PreviewIconButton>
				</div>
			)}
			<iframe
				key={`${selectedPreview.id}:${reloadKey}`}
				title={`Live preview: ${selectedPreview.label}`}
				src={`${selectedPreview.openUrl}?reload=${reloadKey}`}
				sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock"
				referrerPolicy="no-referrer"
				className="min-h-0 flex-1 w-full border-0 bg-white"
				data-pibo-debug="session-live-preview-frame"
			/>
		</section>
	);
}

export function PreviewFullscreenTopBar({
	preview,
	onReload,
	onExit,
}: {
	preview: SessionLivePreview;
	onReload: () => void;
	onExit: () => void;
}) {
	return (
		<div data-pibo-debug="preview-fullscreen-top-bar" className="h-8 min-h-8 flex items-center gap-2 border-b border-slate-600 bg-[#151f24] px-2">
			<span className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.label}</span>
			<span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${healthClass(preview.health)}`}>{preview.health}</span>
			<PreviewIconButton label="Reload live preview" onClick={onReload}><RefreshCw size={14} /></PreviewIconButton>
			<PreviewIconButton label="Open live preview in new window" onClick={() => openPreviewWindow(preview)}><ExternalLink size={14} /></PreviewIconButton>
			<PreviewIconButton label="Exit Preview fullscreen" onClick={onExit}><PanelTopOpen size={14} /></PreviewIconButton>
		</div>
	);
}

function PreviewIconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onClick}
			className={`h-7 w-7 shrink-0 inline-flex items-center justify-center border rounded-sm transition-colors ${danger ? "border-red-500/40 text-red-300 hover:border-red-300 hover:text-red-200" : "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}
		>
			{children}
		</button>
	);
}

function PreviewMessage({ label, tone = "normal" }: { label: string; tone?: "normal" | "error" }) {
	return <div className={`min-h-0 flex-1 grid place-items-center bg-[#0e1116] p-6 text-sm ${tone === "error" ? "text-red-200" : "text-slate-500"}`}>{label}</div>;
}
