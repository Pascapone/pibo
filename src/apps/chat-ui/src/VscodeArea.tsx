import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ServerCrash } from "lucide-react";
import type { VscodeWebIntegration } from "./types";

const VSCODE_WORKBENCH_POLL_MS = 50;
const VSCODE_WORKBENCH_READY_TIMEOUT_MS = 60_000;

export function vscodeWebUrl(baseUrl: string, folder?: string, documentUrl = "http://localhost/"): string {
	const target = new URL(baseUrl, documentUrl);
	if (target.origin !== new URL(documentUrl).origin) {
		throw new Error("VS Code Web URL must use the Pibo Chat origin.");
	}
	if (folder) target.searchParams.set("folder", folder);
	else target.searchParams.delete("folder");
	return `${target.pathname}${target.search}${target.hash}`;
}

export function VscodeArea({ integration }: { integration?: VscodeWebIntegration }) {
	const [probeStatus, setProbeStatus] = useState<"checking" | "ready" | "unavailable">("checking");
	const [probeError, setProbeError] = useState<string | null>(null);
	const [frameReady, setFrameReady] = useState(false);
	const [retryKey, setRetryKey] = useState(0);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const frameReadinessTimerRef = useRef<number | null>(null);

	const frameUrl = useMemo(() => {
		if (!integration) return "";
		return vscodeWebUrl(integration.url, integration.workspaceRoot || undefined, window.location.href);
	}, [integration?.url, integration?.workspaceRoot]);

	useEffect(() => {
		if (!frameUrl) {
			setProbeStatus("unavailable");
			setProbeError("VS Code Web is not configured for this Pibo gateway.");
			return;
		}
		const target = new URL(frameUrl, window.location.href);
		const controller = new AbortController();
		setProbeStatus("checking");
		setProbeError(null);
		fetch(target.toString(), {
			method: "GET",
			credentials: "same-origin",
			cache: "no-store",
			headers: { accept: "text/html" },
			signal: controller.signal,
		})
			.then((response) => {
				const contentType = response.headers.get("content-type") ?? "";
				if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
					throw new Error(`VS Code Web returned HTTP ${response.status}.`);
				}
				setProbeStatus("ready");
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) return;
				setProbeStatus("unavailable");
				setProbeError(error instanceof Error ? error.message : String(error));
			});
		return () => controller.abort();
	}, [frameUrl, retryKey]);

	useEffect(() => {
		setFrameReady(false);
		if (frameReadinessTimerRef.current !== null) {
			window.clearTimeout(frameReadinessTimerRef.current);
			frameReadinessTimerRef.current = null;
		}
		return () => {
			if (frameReadinessTimerRef.current !== null) {
				window.clearTimeout(frameReadinessTimerRef.current);
				frameReadinessTimerRef.current = null;
			}
		};
	}, [frameUrl]);

	const waitForDarkWorkbench = () => {
		if (frameReadinessTimerRef.current !== null) window.clearTimeout(frameReadinessTimerRef.current);
		setFrameReady(false);
		const startedAt = Date.now();
		const inspectFrame = () => {
			let darkWorkbenchReady = false;
			try {
				const frameDocument = frameRef.current?.contentDocument;
				darkWorkbenchReady = Boolean(
					frameDocument?.querySelector(".monaco-workbench")
					&& frameDocument.querySelector(".vs-dark, .hc-black"),
				);
			} catch {
				darkWorkbenchReady = false;
			}
			if (darkWorkbenchReady) {
				frameReadinessTimerRef.current = window.setTimeout(() => {
					setFrameReady(true);
					frameReadinessTimerRef.current = null;
				}, 100);
				return;
			}
			if (Date.now() - startedAt >= VSCODE_WORKBENCH_READY_TIMEOUT_MS) {
				frameReadinessTimerRef.current = null;
				setProbeStatus("unavailable");
				setProbeError("VS Code Web did not finish starting in dark mode.");
				return;
			}
			frameReadinessTimerRef.current = window.setTimeout(inspectFrame, VSCODE_WORKBENCH_POLL_MS);
		};
		inspectFrame();
	};

	if (!integration) {
		return (
			<main className="grid min-h-0 place-items-center bg-[#101d22] p-6" aria-label="VS Code Web">
				<div className="max-w-lg border border-slate-700 bg-[#1a262b] p-5 text-sm text-slate-300 rounded-sm">
					<div className="flex items-center gap-2 text-slate-100 font-bold uppercase tracking-wider"><ServerCrash size={16} className="text-orange-400" /> VS Code Web unavailable</div>
					<p className="mt-3 text-slate-400">Configure <code className="text-slate-200">PIBO_VSCODE_WEB_URL</code> on the gateway to enable the embedded IDE.</p>
				</div>
			</main>
		);
	}

	return (
		<main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#101d22]" aria-label="VS Code Web">
			<div className="relative min-h-0 flex-1 bg-[#101d22]">
				{probeStatus === "ready" ? (
					<>
						{!frameReady ? (
							<div className="absolute inset-0 z-10 grid place-items-center bg-[#101d22]" role="status" aria-live="polite">
								<div className="flex items-center gap-3 text-sm text-slate-300">
									<RefreshCw size={16} className="animate-spin text-[#11a4d4]" />
									Starting VS Code in dark mode…
								</div>
							</div>
						) : null}
						<iframe
							ref={frameRef}
							key={frameUrl}
							src={frameUrl}
							title="VS Code Web"
							allow="clipboard-read; clipboard-write"
							onLoad={waitForDarkWorkbench}
							aria-hidden={!frameReady}
							tabIndex={frameReady ? 0 : -1}
							className={`h-full w-full border-0 bg-[#101d22] ${frameReady ? "visible" : "invisible"}`}
						/>
					</>
				) : probeStatus === "checking" ? (
					<div className="grid h-full place-items-center bg-[#101d22] text-sm text-slate-400">Connecting to VS Code Web…</div>
				) : (
					<div className="grid h-full place-items-center p-6">
						<div className="max-w-lg border border-orange-500/40 bg-orange-500/10 p-5 text-sm text-slate-300 rounded-sm" role="alert">
							<div className="flex items-center gap-2 font-bold uppercase tracking-wider text-orange-300"><ServerCrash size={16} /> VS Code Web is not reachable</div>
							<p className="mt-3 break-words text-slate-400">{probeError ?? "The embedded IDE did not respond."}</p>
							<button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-4 inline-flex items-center gap-2 rounded-sm bg-[#11a4d4] px-3 py-2 text-xs font-bold uppercase tracking-wider text-white">
								<RefreshCw size={14} /> Retry
							</button>
						</div>
					</div>
				)}
			</div>
		</main>
	);
}
