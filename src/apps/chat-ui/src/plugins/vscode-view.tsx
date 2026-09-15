import { RefreshCw, ServerCrash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginViewProps } from "../../../../plugins/sdk";

const VSCODE_WEB_INTEGRATION_API = "/api/chat/vscode-web";
const VSCODE_WORKBENCH_POLL_MS = 50;
const VSCODE_WORKBENCH_READY_TIMEOUT_MS = 60_000;
const VSCODE_WORKBENCH_THEME_SELECTORS = [".vs", ".vs-dark", ".hc-black", ".hc-light"] as const;

type VscodeWorkbenchDocument = Pick<Document, "querySelector">;
type VscodeWebIntegration = { url: string; workspaceRoot?: string };

export function vscodeWorkbenchReady(frameDocument: VscodeWorkbenchDocument | null | undefined): boolean {
	return Boolean(
		frameDocument?.querySelector(".monaco-workbench")
		&& VSCODE_WORKBENCH_THEME_SELECTORS.some((selector) => frameDocument.querySelector(selector)),
	);
}

export function vscodeWebUrl(baseUrl: string, folder?: string, documentUrl = "http://localhost/"): string {
	const target = new URL(baseUrl, documentUrl);
	if (target.origin !== new URL(documentUrl).origin) throw new Error("VS Code Web URL must use the Pibo Chat origin.");
	if (folder) target.searchParams.set("folder", folder);
	else target.searchParams.delete("folder");
	return `${target.pathname}${target.search}${target.hash}`;
}

export function VscodeView({ active, signal }: PluginViewProps) {
	const [integration, setIntegration] = useState<VscodeWebIntegration | null | undefined>();
	const [probeStatus, setProbeStatus] = useState<"checking" | "ready" | "unavailable">("checking");
	const [probeError, setProbeError] = useState<string | null>(null);
	const [frameReady, setFrameReady] = useState(false);
	const [retryKey, setRetryKey] = useState(0);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const readinessTimerRef = useRef<number | null>(null);

	const frameUrl = useMemo(() => integration
		? vscodeWebUrl(integration.url, integration.workspaceRoot, window.location.href)
		: "", [integration]);

	useEffect(() => {
		const controller = new AbortController();
		const combinedSignal = AbortSignal.any([signal, controller.signal]);
		setProbeStatus("checking");
		setProbeError(null);
		setIntegration(undefined);
		fetch(VSCODE_WEB_INTEGRATION_API, { credentials: "same-origin", cache: "no-store", signal: combinedSignal })
			.then(async (response) => {
				if (!response.ok) throw new Error(`VS Code integration returned HTTP ${response.status}.`);
				const payload = await response.json() as { integration?: VscodeWebIntegration | null };
				setIntegration(payload.integration ?? null);
				if (!payload.integration) {
					setProbeStatus("unavailable");
					setProbeError("VS Code Web is not configured for this Pibo gateway.");
				}
			})
			.catch((error: unknown) => {
				if (combinedSignal.aborted) return;
				setIntegration(null);
				setProbeStatus("unavailable");
				setProbeError(error instanceof Error ? error.message : String(error));
			});
		return () => controller.abort();
	}, [retryKey, signal]);

	useEffect(() => {
		if (!frameUrl) return;
		const controller = new AbortController();
		const combinedSignal = AbortSignal.any([signal, controller.signal]);
		setProbeStatus("checking");
		setProbeError(null);
		fetch(new URL(frameUrl, window.location.href), {
			method: "GET",
			credentials: "same-origin",
			cache: "no-store",
			headers: { accept: "text/html" },
			signal: combinedSignal,
		})
			.then((response) => {
				const contentType = response.headers.get("content-type") ?? "";
				if (!response.ok || !contentType.toLowerCase().includes("text/html")) throw new Error(`VS Code Web returned HTTP ${response.status}.`);
				setProbeStatus("ready");
			})
			.catch((error: unknown) => {
				if (combinedSignal.aborted) return;
				setProbeStatus("unavailable");
				setProbeError(error instanceof Error ? error.message : String(error));
			});
		return () => controller.abort();
	}, [frameUrl, retryKey, signal]);

	useEffect(() => {
		setFrameReady(false);
		if (readinessTimerRef.current !== null) window.clearTimeout(readinessTimerRef.current);
		readinessTimerRef.current = null;
		return () => {
			if (readinessTimerRef.current !== null) window.clearTimeout(readinessTimerRef.current);
			readinessTimerRef.current = null;
		};
	}, [frameUrl]);

	const waitForWorkbench = () => {
		if (readinessTimerRef.current !== null) window.clearTimeout(readinessTimerRef.current);
		setFrameReady(false);
		const startedAt = Date.now();
		const inspectFrame = () => {
			let ready = false;
			try { ready = vscodeWorkbenchReady(frameRef.current?.contentDocument); } catch { ready = false; }
			if (ready) {
				readinessTimerRef.current = window.setTimeout(() => {
					setFrameReady(true);
					readinessTimerRef.current = null;
				}, 100);
				return;
			}
			if (Date.now() - startedAt >= VSCODE_WORKBENCH_READY_TIMEOUT_MS) {
				readinessTimerRef.current = null;
				setProbeStatus("unavailable");
				setProbeError("VS Code Web did not finish starting.");
				return;
			}
			readinessTimerRef.current = window.setTimeout(inspectFrame, VSCODE_WORKBENCH_POLL_MS);
		};
		inspectFrame();
	};

	return <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#101d22]" aria-label="VS Code Web">
		<div className="relative min-h-0 flex-1 bg-[#101d22]">
			{probeStatus === "ready" && frameUrl ? <>
				{!frameReady ? <div className="absolute inset-0 z-10 grid place-items-center bg-[#101d22]" role="status" aria-live="polite"><div className="flex items-center gap-3 text-sm text-slate-300"><RefreshCw size={16} className="animate-spin text-[#11a4d4]" />Starting VS Code…</div></div> : null}
				<iframe ref={frameRef} key={frameUrl} src={frameUrl} title="VS Code Web" allow="clipboard-read; clipboard-write" onLoad={waitForWorkbench} aria-hidden={!frameReady} tabIndex={active && frameReady ? 0 : -1} className={`h-full w-full border-0 bg-[#101d22] ${frameReady ? "visible" : "invisible"}`} />
			</> : probeStatus === "checking" ? <div className="grid h-full place-items-center text-sm text-slate-400">Connecting to VS Code Web…</div> : <div className="grid h-full place-items-center p-6"><div className="max-w-lg rounded-sm border border-orange-500/40 bg-orange-500/10 p-5 text-sm text-slate-300" role="alert"><div className="flex items-center gap-2 font-bold uppercase tracking-wider text-orange-300"><ServerCrash size={16} />VS Code Web unavailable</div><p className="mt-3 break-words text-slate-400">{probeError ?? "The embedded IDE did not respond."}</p><p className="mt-2 text-xs text-slate-500">Configure <code className="text-slate-300">PIBO_VSCODE_WEB_URL</code> with a same-origin path.</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-4 inline-flex items-center gap-2 rounded-sm bg-[#11a4d4] px-3 py-2 text-xs font-bold uppercase tracking-wider text-white"><RefreshCw size={14} />Retry</button></div></div>}
		</div>
	</main>;
}
