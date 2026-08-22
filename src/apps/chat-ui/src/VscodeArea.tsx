import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderOpen, RefreshCw, ServerCrash } from "lucide-react";
import { getProjects } from "./api-chat-sessions";
import type { PiboProject, VscodeWebIntegration } from "./types";

export function vscodeWebUrl(baseUrl: string, folder?: string, documentUrl = "http://localhost/"): string {
	const target = new URL(baseUrl, documentUrl);
	if (folder) target.searchParams.set("folder", folder);
	else target.searchParams.delete("folder");
	const documentOrigin = new URL(documentUrl).origin;
	return target.origin === documentOrigin
		? `${target.pathname}${target.search}${target.hash}`
		: target.toString();
}

export function VscodeArea({ integration }: { integration?: VscodeWebIntegration }) {
	const [projects, setProjects] = useState<PiboProject[]>([]);
	const [selectedFolder, setSelectedFolder] = useState(integration?.workspaceRoot ?? "");
	const [probeStatus, setProbeStatus] = useState<"checking" | "ready" | "unavailable">("checking");
	const [probeError, setProbeError] = useState<string | null>(null);
	const [retryKey, setRetryKey] = useState(0);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		setSelectedFolder(integration?.workspaceRoot ?? "");
	}, [integration?.url, integration?.workspaceRoot]);

	useEffect(() => {
		let active = true;
		getProjects()
			.then(({ projects: nextProjects }) => {
				if (active) setProjects(nextProjects.filter((project) => !project.archivedAt));
			})
			.catch(() => {
				if (active) setProjects([]);
			});
		return () => {
			active = false;
		};
	}, []);

	const frameUrl = useMemo(() => {
		if (!integration) return "";
		return vscodeWebUrl(integration.url, selectedFolder || undefined, window.location.href);
	}, [integration, selectedFolder]);

	useEffect(() => {
		if (!integration || !frameUrl) {
			setProbeStatus("unavailable");
			setProbeError("VS Code Web is not configured for this Pibo gateway.");
			return;
		}
		const target = new URL(frameUrl, window.location.href);
		if (target.origin !== window.location.origin) {
			setProbeStatus("ready");
			setProbeError(null);
			return;
		}
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
	}, [frameUrl, integration, retryKey]);

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

	const projectOptions = projects
		.filter((project) => project.projectFolder !== integration.workspaceRoot)
		.sort((left, right) => left.name.localeCompare(right.name));

	return (
		<main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#101d22]" aria-label="VS Code Web">
			<div className="flex min-h-11 shrink-0 items-center gap-2 border-b border-slate-800 bg-[#151f24] px-3">
				<FolderOpen size={15} className="shrink-0 text-[#11a4d4]" />
				<label htmlFor="vscode-project-folder" className="sr-only">Open project folder</label>
				<select
					id="vscode-project-folder"
					value={selectedFolder}
					onChange={(event) => setSelectedFolder(event.target.value)}
					className="min-w-0 max-w-md flex-1 rounded-sm border border-slate-700 bg-[#0e1116] px-2 py-1.5 text-xs text-slate-200 focus:border-[#11a4d4] focus:outline-none"
				>
					<option value="">Last opened folder</option>
					{integration.workspaceRoot ? <option value={integration.workspaceRoot}>Workspace root — {integration.workspaceRoot}</option> : null}
					{projectOptions.map((project) => (
						<option key={project.id} value={project.projectFolder}>{project.name} — {project.projectFolder}</option>
					))}
				</select>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={() => {
							setReloadKey((value) => value + 1);
							setRetryKey((value) => value + 1);
						}}
						className="grid h-8 w-8 place-items-center rounded-sm border border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						title="Reload VS Code"
						aria-label="Reload VS Code"
					>
						<RefreshCw size={14} />
					</button>
					<a
						href={frameUrl}
						target="_blank"
						rel="noreferrer"
						className="grid h-8 w-8 place-items-center rounded-sm border border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						title="Open VS Code in a new tab"
						aria-label="Open VS Code in a new tab"
					>
						<ExternalLink size={14} />
					</a>
				</div>
			</div>

			<div className="relative min-h-0 flex-1 bg-[#0e1116]">
				{probeStatus === "ready" ? (
					<iframe
						key={`${frameUrl}:${reloadKey}`}
						src={frameUrl}
						title="VS Code Web"
						allow="clipboard-read; clipboard-write"
						className="h-full w-full border-0 bg-[#0e1116]"
					/>
				) : probeStatus === "checking" ? (
					<div className="grid h-full place-items-center text-sm text-slate-400">Connecting to VS Code Web…</div>
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
