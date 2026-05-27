import { useEffect, useState, type ReactNode } from "react";
import { BookA, ChevronsDown, ChevronsUp, Plus, RefreshCw, Rows3, Trash2, X } from "lucide-react";
import {
	createWebAnnotationBinding,
	injectWebAnnotationBinding,
	listWebAnnotationTargets,
	type WebAnnotationBindingResponse,
	type WebAnnotationMessageAttachment,
	type WebAnnotationOverlayConfig,
	type WebAnnotationTargetSummary,
} from "./api-web-annotations";
import {
	readStoredWebAnnotationsCdpUrl,
	readStoredWebAnnotationToggleShortcut,
	writeStoredWebAnnotationsCdpUrl,
} from "./web-annotation-storage";

export function WebAnnotationsSessionPanel({
	piboSessionId,
	annotations,
	selectedIds,
	loading,
	error,
	collapsed,
	onRefresh,
	onToggle,
	onClear,
	onCollapse,
	onClose,
}: {
	piboSessionId: string | null;
	annotations: WebAnnotationMessageAttachment[];
	selectedIds: readonly string[];
	loading: boolean;
	error: string | null;
	collapsed: boolean;
	onRefresh: () => void;
	onToggle: (annotationId: string) => void;
	onClear: () => void;
	onCollapse: () => void;
	onClose: () => void;
}) {
	if (!piboSessionId) return null;
	return (
		<section className="border-t border-slate-800 bg-[#101d22] px-3 py-2 sm:px-4" data-pibo-debug="web-annotations-session-panel" data-pibo-session-id={piboSessionId}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Web annotations</div>
						<span className="rounded-sm border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">{annotations.length}</span>
						{selectedIds.length ? <span className="rounded-sm border border-[#11a4d4]/50 px-1.5 py-0.5 text-[10px] text-[#11a4d4]">{selectedIds.length} attached</span> : null}
					</div>
					{collapsed ? null : <div className="text-[11px] text-slate-500">Global annotation list. Selected attachments are remembered per session.</div>}
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<button type="button" onClick={onRefresh} disabled={loading} title="Refresh annotations" aria-label="Refresh annotations" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50 sm:h-7 sm:w-7" data-pibo-debug="web-annotations-refresh">
						<RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
					</button>
					<button type="button" onClick={onClear} disabled={loading || !annotations.length} title="Clear visible annotations" aria-label="Clear visible annotations" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50 sm:h-7 sm:w-7">
						<Trash2 size={12} />
					</button>
					<button type="button" onClick={onCollapse} title={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} aria-label={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] sm:h-7 sm:w-7">
						{collapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
					</button>
					<button type="button" onClick={onClose} title="Hide annotations panel" aria-label="Hide annotations panel" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] sm:h-7 sm:w-7">
						<X size={12} />
					</button>
				</div>
			</div>
			{collapsed ? null : error ? (
				<div className="rounded-sm border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200" data-pibo-debug="web-annotations-error">{boundedUiText(error, 220)}</div>
			) : loading && !annotations.length ? (
				<div className="rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2 text-xs text-slate-400" data-pibo-debug="web-annotations-loading">Loading annotations…</div>
			) : !annotations.length ? (
				<div className="rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2 text-xs text-slate-500" data-pibo-debug="web-annotations-empty">No open annotations for this session.</div>
			) : (
				<div className="mt-2 grid max-h-[min(40svh,18rem)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:max-h-56 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]" data-pibo-debug="web-annotations-list">
					{annotations.map((annotation) => {
						const selected = selectedIds.includes(annotation.id);
						return (
							<div key={annotation.id} data-pibo-debug="web-annotation-chip" data-web-annotation-id={annotation.id} data-web-annotation-session-id={annotation.piboSessionId} data-web-annotation-selected={selected ? "true" : "false"} className={`min-w-0 rounded-sm border px-3 py-2 text-xs ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#0e1116]"}`}>
								<div className="mb-1 flex items-center justify-between gap-2">
									<span className="min-w-0 truncate font-mono text-[11px] text-slate-500">{annotation.status} · {annotation.targetKind}</span>
									<button type="button" onClick={() => onToggle(annotation.id)} className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-2 text-[11px] sm:h-6 sm:px-1.5 ${selected ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}>
										{selected ? <X size={11} /> : <Plus size={11} />} {selected ? "Detach" : "Attach"}
									</button>
								</div>
								<div className="truncate text-slate-200" title={annotation.primaryTarget || annotation.label || annotation.selector || annotation.id}>{boundedUiText(annotation.primaryTarget || annotation.label || annotation.selector || annotation.id, 120)}</div>
								{annotation.piboContext ? <div className="truncate font-mono text-[11px] text-[#11a4d4]" title={annotation.piboContext}>{boundedUiText(annotation.piboContext, 140)}</div> : null}
								<div className="truncate font-mono text-[11px] text-slate-500" title={annotation.url}>{webAnnotationUrlLabel(annotation.url)}</div>
								<div className="mt-1 line-clamp-2 text-slate-400" title={annotation.note}>{boundedUiText(annotation.note, 180)}</div>
								<div className="mt-1 text-[11px] text-slate-600">{shortWorkflowTimestamp(annotation.createdAt)}</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

export function WebAnnotationsEntryPoints({
	piboSessionId,
	piboRoomId,
	disabled,
	panelVisible,
	onShowPanel,
	onHidePanel,
	onError,
}: {
	piboSessionId: string | null;
	piboRoomId?: string;
	disabled: boolean;
	panelVisible: boolean;
	onShowPanel: () => void;
	onHidePanel: () => void;
	onError: (message: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [cdpUrl, setCdpUrl] = useState(() => readStoredWebAnnotationsCdpUrl());
	const [targets, setTargets] = useState<WebAnnotationTargetSummary[]>([]);
	const [targetsState, setTargetsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<{ kind: "info" | "success" | "error"; message: string } | null>(null);

	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	useEffect(() => {
		writeStoredWebAnnotationsCdpUrl(cdpUrl);
	}, [cdpUrl]);

	const loadTargets = async () => {
		if (!piboSessionId) return;
		setTargetsState("loading");
		setStatus(null);
		try {
			const result = await listWebAnnotationTargets(cdpUrl);
			setTargets(result.targets.filter((target) => target.type === "page" || target.attachable));
			setTargetsState("loaded");
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "CDP unavailable");
			setTargets([]);
			setTargetsState("error");
			setStatus({ kind: "error", message });
			onError(message);
		}
	};

	const injectCreatedBinding = async (result: WebAnnotationBindingResponse) => {
		if (!piboSessionId) throw new Error("No active session context");
		return injectWebAnnotationBinding(result.binding.id, compactWebAnnotationRequest({ piboSessionId, piboRoomId, cdpUrl, annotationShortcut: readStoredWebAnnotationToggleShortcut() }));
	};

	const startCurrentPageAnnotation = async () => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		setBusy(true);
		setStatus({ kind: "info", message: "Injecting annotation overlay into this Pibo page…" });
		try {
			const binding = await createWebAnnotationBinding({
				piboSessionId,
				piboRoomId,
				url: window.location.href,
				title: document.title,
				sameOrigin: true,
				annotationShortcut: readStoredWebAnnotationToggleShortcut(),
			});
			if (!binding.overlay) throw new Error("Overlay config missing from same-origin binding response");
			await installSameOriginWebAnnotationOverlay(binding.overlay);
			setStatus({ kind: "success", message: "Annotation overlay is ready on this Pibo page. Open the overlay controls or use the shortcut to start annotating." });
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "Current-page annotation failed");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	const startUrlAnnotation = async () => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		const targetUrl = url.trim();
		if (!targetUrl) {
			setStatus({ kind: "error", message: "URL is required" });
			return;
		}
		if (isLikelyWebAnnotationCdpUrl(targetUrl)) {
			const message = "That looks like a CDP endpoint. Put it in CDP URL, and put the page you want to annotate in Annotate URL.";
			setStatus({ kind: "error", message });
			onError(message);
			return;
		}
		setBusy(true);
		setStatus({ kind: "info", message: "Opening target and injecting overlay…" });
		try {
			const binding = await createWebAnnotationBinding(compactWebAnnotationRequest({ piboSessionId, piboRoomId, url: targetUrl, cdpUrl }));
			const injected = await injectCreatedBinding(binding);
			setStatus({ kind: "success", message: `Annotation overlay injected for ${webAnnotationTargetLabel(injected.target ?? binding.target, injected.binding.url)}` });
			setUrl("");
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "Annotation failed");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	const attachTarget = async (target: WebAnnotationTargetSummary) => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		setBusy(true);
		setStatus({ kind: "info", message: "Binding selected target and injecting overlay…" });
		try {
			const binding = await createWebAnnotationBinding(compactWebAnnotationRequest({ piboSessionId, piboRoomId, targetId: target.id, cdpUrl }));
			const injected = await injectCreatedBinding(binding);
			setStatus({ kind: "success", message: `Annotation overlay injected for ${webAnnotationTargetLabel(injected.target ?? target, injected.binding.url)}` });
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, target.attachable ? "Target annotation failed" : "Target not attachable");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="relative" data-pibo-debug="web-annotations-entry" data-pibo-session-id={piboSessionId ?? undefined}>
			<HeaderIconButton
				onClick={() => {
					if (disabled) return;
					setOpen((current) => !current);
					if (!panelVisible) onShowPanel();
				}}
				title={disabled ? "Select an active session to annotate a web page" : panelVisible ? "Web Annotations" : "Show Web Annotations"}
				ariaLabel="Web Annotations"
				active={open || panelVisible}
			>
				<BookA size={14} />
			</HeaderIconButton>
			{open && !disabled ? (
				<div className="fixed inset-x-2 bottom-3 z-40 max-h-[calc(100svh-1.5rem)] overflow-y-auto rounded-sm border border-slate-700 bg-[#0e1116] p-3 text-sm shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-[min(420px,calc(100vw-24px))] sm:max-h-[calc(100svh-5rem)]" role="dialog" aria-label="Web Annotations">
					<div className="mb-2 flex items-start justify-between gap-3">
						<div>
							<div className="text-xs font-bold uppercase tracking-wider text-[#11a4d4]">Web Annotations</div>
							<div className="mt-1 text-xs text-slate-500">Start an inactive overlay for this Pibo page, or bind a CDP target for external pages.</div>
						</div>
						<div className="flex items-center gap-1">
							<button type="button" onClick={panelVisible ? onHidePanel : onShowPanel} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label={panelVisible ? "Hide annotation list" : "Show annotation list"} title={panelVisible ? "Hide annotation list" : "Show annotation list"}>
								<Rows3 size={14} />
							</button>
							<button type="button" onClick={() => setOpen(false)} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Close Web Annotations panel">
								<X size={14} />
							</button>
						</div>
					</div>
					<button type="button" onClick={() => void startCurrentPageAnnotation()} disabled={busy} className="mb-3 h-10 w-full rounded-sm bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 sm:h-9" data-pibo-debug="web-annotations-current-page">
						Annotate this Pibo page
					</button>
					<label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="web-annotation-url">Annotate URL via CDP</label>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
						<input
							id="web-annotation-url"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							onKeyDown={(event) => { if (event.key === "Enter") void startUrlAnnotation(); }}
							placeholder="http://localhost:5173"
							disabled={busy}
							className="h-10 min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 text-base text-slate-100 outline-none focus:border-[#11a4d4] disabled:opacity-60 sm:h-9 sm:text-xs"
						/>
						<button type="button" onClick={() => void startUrlAnnotation()} disabled={busy || !url.trim()} className="h-10 rounded-sm bg-[#11a4d4] px-3 text-xs font-medium text-white disabled:opacity-50 sm:h-9">
							Annotate
						</button>
					</div>
					<label className="mt-3 mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="web-annotation-cdp-url">CDP URL (optional)</label>
					<input
						id="web-annotation-cdp-url"
						value={cdpUrl}
						onChange={(event) => setCdpUrl(event.target.value)}
						placeholder="Use gateway default"
						disabled={busy}
						className="h-10 w-full rounded-sm border border-slate-800 bg-[#151f24] px-2 font-mono text-base text-slate-300 outline-none focus:border-[#11a4d4] disabled:opacity-60 sm:h-8 sm:text-[11px]"
					/>
					<div className="mt-3 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Existing targets</div>
						<button type="button" onClick={() => void loadTargets()} disabled={busy || targetsState === "loading"} className="inline-flex h-7 items-center gap-1 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<RefreshCw size={12} className={targetsState === "loading" ? "animate-spin" : undefined} /> Refresh
						</button>
					</div>
					<div className="mt-2 max-h-[min(34svh,14rem)] overflow-auto rounded-sm border border-slate-800 sm:max-h-56">
						{targetsState === "idle" ? <div className="px-3 py-3 text-xs text-slate-500">Refresh to list reachable browser targets.</div> : null}
						{targetsState === "loading" ? <div className="px-3 py-3 text-xs text-slate-400">Loading targets…</div> : null}
						{targetsState === "loaded" && !targets.length ? <div className="px-3 py-3 text-xs text-slate-500">No attachable browser targets found.</div> : null}
						{targets.map((target) => (
							<div key={target.id} className="grid grid-cols-1 gap-2 border-b border-slate-800 px-3 py-2 last:border-b-0 sm:grid-cols-[1fr_auto]">
								<div className="min-w-0">
									<div className="truncate text-xs text-slate-200" title={target.title || target.url}>{boundedUiText(target.title || "Untitled target", 120)}</div>
									<div className="truncate font-mono text-[11px] text-slate-500" title={target.url}>{boundedUiText(target.url || target.id, 160)}</div>
								</div>
								<button type="button" onClick={() => void attachTarget(target)} disabled={busy || !target.attachable} title={target.attachable ? "Attach selected target" : "Target is not attachable"} className="h-9 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-40 sm:h-8">
									Attach
								</button>
							</div>
						))}
					</div>
					{status ? (
						<div className={`mt-2 rounded-sm border px-2 py-2 text-xs ${status.kind === "error" ? "border-red-900 bg-red-950/40 text-red-200" : status.kind === "success" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-slate-700 bg-[#151f24] text-slate-300"}`}>
							{status.message}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function HeaderIconButton({
	title,
	ariaLabel,
	active,
	onClick,
	children,
}: {
	title: string;
	ariaLabel: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={ariaLabel}
			className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm transition-colors ${
				active
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]"
					: "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
			}`}
		>
			{children}
		</button>
	);
}

function compactWebAnnotationRequest<T extends Record<string, string | undefined>>(input: T): T {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value && value.trim())) as T;
}

function isLikelyWebAnnotationCdpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.port === "56663" || parsed.pathname.startsWith("/json/");
	} catch {
		return false;
	}
}

function installSameOriginWebAnnotationOverlay(config: WebAnnotationOverlayConfig): Promise<void> {
	return new Promise((resolve, reject) => {
		const targetWindow = window as typeof window & {
			__piboWebAnnotationConfig?: WebAnnotationOverlayConfig;
			__piboWebAnnotations?: { remove?: () => void };
		};
		try {
			targetWindow.__piboWebAnnotations?.remove?.();
			targetWindow.__piboWebAnnotationConfig = config;
			const script = document.createElement("script");
			script.src = `/apps/web-annotations/overlay.js?ts=${Date.now()}`;
			script.async = true;
			script.onload = () => resolve();
			script.onerror = () => reject(new Error("Could not load Web Annotation overlay script"));
			document.head.appendChild(script);
		} catch (error) {
			reject(error);
		}
	});
}

export function compactWebAnnotationError(caught: unknown, fallback: string): string {
	const message = errorMessage(caught);
	if (!message || message === "undefined") return fallback;
	if (/target.*not found|selected cdp target/i.test(message)) return `Target not found: ${message}`;
	if (/inject|overlay|evaluation/i.test(message)) return `Injection failed: ${message}`;
	if (/cdp endpoint.*is unreachable|failed to fetch|fetch failed|chrome target discovery|cdp unavailable|econnrefused|connect/i.test(message)) {
		return `CDP unavailable: ${message}`;
	}
	return `${fallback}: ${message}`;
}

function webAnnotationTargetLabel(target: WebAnnotationTargetSummary | undefined, fallbackUrl?: string): string {
	const value = target?.url || fallbackUrl || target?.title || "target";
	return webAnnotationUrlLabel(target?.title || value);
}

function webAnnotationUrlLabel(value: string): string {
	try {
		const parsed = new URL(value);
		return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return boundedUiText(value, 80);
	}
}

function boundedUiText(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function shortWorkflowTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}
