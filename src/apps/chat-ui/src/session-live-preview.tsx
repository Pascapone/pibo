import { Copy, ExternalLink, Maximize2, PanelTopOpen, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { SessionLivePreview } from "./api-previews";
import { copyTextToClipboard } from "./clipboard";

function healthClass(health: SessionLivePreview["health"]): string {
	if (health === "online") return "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
	if (health === "starting" || health === "stopping") return "border-cyan-500/50 bg-cyan-500/10 text-cyan-300";
	if (health === "offline" || health === "error") return "border-amber-500/50 bg-amber-500/10 text-amber-300";
	return "border-slate-600 bg-slate-800 text-slate-400";
}

function openPreviewWindow(preview: SessionLivePreview): void {
	if (preview.health !== "online") return;
	window.open(preview.openUrl, "_blank", "noopener,noreferrer");
}

function iframeBootstrapUrl(preview: SessionLivePreview, reloadKey: number): string {
	const url = new URL(preview.openUrl, window.location.origin);
	url.searchParams.set("piboPreviewReload", String(reloadKey));
	return url.toString();
}

export function SessionLivePreviewPanel({
	previews,
	selectedPreview,
	loading,
	error,
	reloadKey,
	fullscreen = false,
	actionPending = false,
	onSelect,
	onReload,
	onRefresh,
	onStart,
	onStop,
	onRemove,
	onEnterFullscreen,
}: {
	previews: readonly SessionLivePreview[];
	selectedPreview?: SessionLivePreview;
	loading: boolean;
	error?: string;
	reloadKey: number;
	fullscreen?: boolean;
	actionPending?: boolean;
	onSelect: (previewId: string) => void;
	onReload: () => void;
	onRefresh: () => void;
	onStart: (previewId: string) => void;
	onStop: (previewId: string) => void;
	onRemove: (previewId: string) => void;
	onEnterFullscreen?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	if (loading) return <PreviewMessage label="Loading live previews…" />;
	if (error) return <PreviewMessage label={error} tone="error" />;
	if (!selectedPreview) return <PreviewMessage label="No active live preview is attached to this Pibo Session." />;

	const online = selectedPreview.health === "online";
	const managedTransitioning = selectedPreview.managed && ["running", "starting", "stopping"].includes(selectedPreview.serverState ?? "");
	const canStart = selectedPreview.managed && !managedTransitioning;
	const canStop = selectedPreview.managed && selectedPreview.serverState !== "stopping" && managedTransitioning;
	const copyOpenUrl = () => {
		if (!online) return;
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
			data-pibo-preview-session-id={selectedPreview.piboSessionId}
			data-pibo-preview-public-origin={new URL(selectedPreview.publicUrl).origin}
			data-pibo-preview-fullscreen={fullscreen ? "true" : "false"}
			className="min-h-0 flex-1 bg-[#0e1116] flex flex-col"
		>
			{fullscreen ? null : (
				<div className="min-h-11 border-b border-slate-800 bg-[#151f24] px-3 flex items-center gap-2 max-[640px]:flex-wrap max-[640px]:py-1.5">
					<label className="sr-only" htmlFor="session-live-preview-select">Selected live preview</label>
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
					<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">
						{selectedPreview.serverStopAt && managedTransitioning ? `stops ${formatStopTime(selectedPreview.serverStopAt)}` : "session-linked"}
					</span>
					<PreviewIconButton label="Refresh preview status" onClick={onRefresh}><RefreshCw size={14} /></PreviewIconButton>
					{canStart ? <PreviewIconButton label="Start Preview server" disabled={actionPending} onClick={() => onStart(selectedPreview.id)}><Play size={14} /></PreviewIconButton> : null}
					{canStop ? <PreviewIconButton label="Stop Preview server" disabled={actionPending} onClick={() => onStop(selectedPreview.id)}><Square size={13} /></PreviewIconButton> : null}
					<PreviewIconButton label="Reload live preview" disabled={!online} onClick={onReload}><RefreshCw size={14} /></PreviewIconButton>
					<PreviewIconButton label={copied ? "Copied preview link" : "Copy authenticated preview link"} disabled={!online} onClick={copyOpenUrl}><Copy size={14} /></PreviewIconButton>
					<PreviewIconButton label="Open live preview in new window" disabled={!online} onClick={() => openPreviewWindow(selectedPreview)}><ExternalLink size={14} /></PreviewIconButton>
					{onEnterFullscreen ? <PreviewIconButton label="Enter Preview fullscreen" disabled={!online} onClick={onEnterFullscreen}><Maximize2 size={14} /></PreviewIconButton> : null}
					<PreviewIconButton label="Remove live preview" danger disabled={actionPending} onClick={() => onRemove(selectedPreview.id)}><Trash2 size={14} /></PreviewIconButton>
				</div>
			)}
			{online ? (
				<iframe
					key={`${selectedPreview.piboSessionId}:${selectedPreview.id}:${reloadKey}`}
					title={`Live preview: ${selectedPreview.label}`}
					src={iframeBootstrapUrl(selectedPreview, reloadKey)}
					sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock"
					referrerPolicy="no-referrer"
					className="min-h-0 flex-1 w-full border-0 bg-white"
					data-pibo-debug="session-live-preview-frame"
				/>
			) : (
				<ManagedPreviewState
					preview={selectedPreview}
					actionPending={actionPending}
					onStart={() => onStart(selectedPreview.id)}
				/>
			)}
		</section>
	);
}

export function PreviewFullscreenTopBar({
	preview,
	actionPending = false,
	onReload,
	onStart,
	onStop,
	onExit,
}: {
	preview: SessionLivePreview;
	actionPending?: boolean;
	onReload: () => void;
	onStart: () => void;
	onStop: () => void;
	onExit: () => void;
}) {
	const exitButtonRef = useRef<HTMLButtonElement>(null);
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;
	useEffect(() => {
		const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		const restoreFocus = () => {
			const enterButton = document.querySelector<HTMLButtonElement>(
				'[data-pibo-debug="session-live-preview"] [aria-label="Enter Preview fullscreen"]',
			);
			if (enterButton) enterButton.focus();
			else if (priorFocus?.isConnected) priorFocus.focus();
		};
		exitButtonRef.current?.focus();
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onExitRef.current();
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			window.setTimeout(restoreFocus, 0);
		};
	}, []);

	const online = preview.health === "online";
	const managedTransitioning = preview.managed && ["running", "starting", "stopping"].includes(preview.serverState ?? "");
	return (
		<div data-pibo-debug="preview-fullscreen-top-bar" className="h-8 min-h-8 flex items-center gap-2 border-b border-slate-600 bg-[#151f24] px-2">
			<span className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.label}</span>
			<span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${healthClass(preview.health)}`}>{preview.health}</span>
			{preview.managed && !managedTransitioning ? <PreviewIconButton label="Start Preview server" disabled={actionPending} onClick={onStart}><Play size={14} /></PreviewIconButton> : null}
			{preview.managed && preview.serverState !== "stopping" && managedTransitioning ? <PreviewIconButton label="Stop Preview server" disabled={actionPending} onClick={onStop}><Square size={13} /></PreviewIconButton> : null}
			<PreviewIconButton label="Reload live preview" disabled={!online} onClick={onReload}><RefreshCw size={14} /></PreviewIconButton>
			<PreviewIconButton label="Open live preview in new window" disabled={!online} onClick={() => openPreviewWindow(preview)}><ExternalLink size={14} /></PreviewIconButton>
			<PreviewIconButton buttonRef={exitButtonRef} label="Exit Preview fullscreen" onClick={onExit}><PanelTopOpen size={14} /></PreviewIconButton>
		</div>
	);
}

function ManagedPreviewState({
	preview,
	actionPending,
	onStart,
}: {
	preview: SessionLivePreview;
	actionPending: boolean;
	onStart: () => void;
}) {
	const transitioning = ["running", "starting", "stopping"].includes(preview.serverState ?? "");
	const label = preview.health === "starting"
		? "Starting Preview server…"
		: preview.health === "stopping"
			? "Stopping Preview server…"
			: preview.health === "error"
				? "The Preview server could not stay running."
				: preview.managed && transitioning
					? "The Preview server is running, but its port is not reachable."
					: preview.managed
						? "The Preview server is stopped."
						: "The exposed server is offline.";
	return (
		<div className="min-h-0 flex-1 grid place-items-center bg-[#0e1116] p-6 text-center" role="status" aria-live="polite">
			<div>
				<div className="text-sm text-slate-400">{label}</div>
				{preview.managed && !transitioning ? (
					<button
						type="button"
						disabled={actionPending}
						onClick={onStart}
						className="mt-4 inline-flex items-center gap-2 border border-[#11a4d4] bg-[#11a4d4]/10 px-3 py-2 text-xs font-semibold text-[#7ddfff] hover:bg-[#11a4d4]/20 disabled:opacity-50"
					>
						<Play size={14} /> {actionPending ? "Starting…" : "Start server"}
					</button>
				) : null}
			</div>
		</div>
	);
}

function PreviewIconButton({
	buttonRef,
	label,
	danger = false,
	disabled = false,
	onClick,
	children,
}: {
	buttonRef?: Ref<HTMLButtonElement>;
	label: string;
	danger?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			ref={buttonRef}
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`h-7 w-7 shrink-0 inline-flex items-center justify-center border rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]/60 disabled:cursor-not-allowed disabled:opacity-35 ${danger ? "border-red-500/40 text-red-300 hover:border-red-300 hover:text-red-200" : "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}
		>
			{children}
		</button>
	);
}

export function PreviewMessage({ label, tone = "normal" }: { label: string; tone?: "normal" | "error" }) {
	return <div role={tone === "error" ? "alert" : "status"} className={`min-h-0 flex-1 grid place-items-center bg-[#0e1116] p-6 text-sm ${tone === "error" ? "text-red-200" : "text-slate-500"}`}>{label}</div>;
}

function formatStopTime(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "soon" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
