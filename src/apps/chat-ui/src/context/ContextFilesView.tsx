import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, FilePlus2, Files, RefreshCw, Save, Trash2 } from "lucide-react";
import {
	createContextFile,
	listContextFiles,
	readContextFile,
	removeContextFile,
	saveContextFile,
	updateContextFileMetadata,
	type ContextFileDocument,
	type ContextFileInfo,
	type ProductEvent,
	type SaveState,
} from "../api";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

type ContextFileScope = "global" | "agent";

export function ContextFilesView({ agentProfiles }: { agentProfiles: string[] }) {
	const agentOptions = useMemo(() => [...new Set(agentProfiles)].sort((left, right) => left.localeCompare(right)), [agentProfiles]);
	const editorRef = useRef<MarkdownEditorHandle>(null);
	const saveStateRef = useRef<SaveState>("saved");
	const createAgentListId = useId();
	const metadataAgentListId = useId();
	const [files, setFiles] = useState<ContextFileInfo[]>([]);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [document, setDocument] = useState<ContextFileDocument | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [conflict, setConflict] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [formLabel, setFormLabel] = useState("");
	const [formScope, setFormScope] = useState<ContextFileScope>("global");
	const [formAgent, setFormAgent] = useState("");
	const [metadataAgent, setMetadataAgent] = useState("");

	useEffect(() => {
		saveStateRef.current = saveState;
	}, [saveState]);

	const refreshFiles = useCallback(async () => {
		const nextFiles = await listContextFiles();
		setFiles(nextFiles);
		setSelectedKey((current) => current ?? nextFiles[0]?.key ?? null);
	}, []);

	const loadDocument = useCallback(async (key: string) => {
		const nextDocument = await readContextFile(key);
		setDocument(nextDocument);
		setSelectedKey(key);
		setConflict(null);
		setError(null);
	}, []);

	useEffect(() => {
		refreshFiles()
			.catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
			.finally(() => setLoading(false));
	}, [refreshFiles]);

	useEffect(() => {
		if (!selectedKey) {
			setDocument(null);
			return;
		}
		loadDocument(selectedKey).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
	}, [selectedKey, loadDocument]);

	useEffect(() => {
		const events = new EventSource("/api/context-files/events");
		events.addEventListener("pibo-product", (message) => {
			const event = parseProductEvent(message);
			if (!event?.type.startsWith("context-file.")) return;
			void refreshFiles().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));

			const eventKey = event.payload?.key;
			if (!eventKey || eventKey !== selectedKey) return;
			if (event.source === "web") return;

			if (saveStateRef.current === "idle" || saveStateRef.current === "saving") {
				setConflict("This file changed on disk while you had local edits. Review before saving again.");
				return;
			}

			void loadDocument(eventKey).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
		});
		events.onerror = () => {
			setError("Live context-file updates disconnected.");
		};
		return () => events.close();
	}, [loadDocument, refreshFiles, selectedKey]);

	const selectedFile = useMemo(() => files.find((file) => file.key === selectedKey) ?? null, [files, selectedKey]);

	useEffect(() => {
		setMetadataAgent(document?.agentProfileName ?? "");
	}, [document?.agentProfileName, document?.key]);

	const handleSelect = useCallback(async (key: string) => {
		try {
			await editorRef.current?.flushSave();
			await loadDocument(key);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [loadDocument]);

	const handleSubmit = useCallback(async () => {
		try {
			const created = await createContextFile({
				label: formLabel.trim() || undefined,
				scope: formScope,
				agentProfileName: formScope === "agent" ? formAgent.trim() : undefined,
				markdown: "",
			});
			setFormLabel("");
			setFormAgent("");
			setSelectedKey(created.key);
			setDocument(created);
			await refreshFiles();
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [formAgent, formLabel, formScope, refreshFiles]);

	const handlePersist = useCallback(async (markdown: string) => {
		if (!document) return;
		try {
			const saved = await saveContextFile(document.key, {
				markdown,
				expectedVersion: document.version,
			});
			setDocument(saved);
			await refreshFiles();
			setConflict(null);
			setError(null);
		} catch (caught) {
			if (isConflictError(caught)) {
				setDocument(caught.data.file);
				setConflict("This file changed on disk before your save completed. Reload the latest version and retry.");
				return;
			}
			setError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		}
	}, [document, refreshFiles]);

	const handleReload = useCallback(async () => {
		if (!selectedKey) return;
		await loadDocument(selectedKey);
		await refreshFiles();
	}, [loadDocument, refreshFiles, selectedKey]);

	const handleRemove = useCallback(async () => {
		if (!selectedFile?.removable) return;
		try {
			await removeContextFile(selectedFile.key, true);
			setSelectedKey(null);
			setDocument(null);
			await refreshFiles();
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [refreshFiles, selectedFile]);

	const handleScopeChange = useCallback(async (scope: ContextFileScope) => {
		if (!document?.managed) return;
		try {
			const updated = await updateContextFileMetadata(document.key, {
				scope,
				agentProfileName: scope === "agent" ? metadataAgent.trim() || undefined : undefined,
			});
			setDocument(updated);
			await refreshFiles();
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [document, metadataAgent, refreshFiles]);

	return (
		<div className="context-files-view grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] max-[1180px]:grid-cols-[minmax(0,1fr)_280px] max-[920px]:grid-cols-1">
			<main className="flex min-h-0 flex-col bg-[#101d22]">
				<div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4">
					<div className="min-w-0">
						<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">
							{selectedFile ? scopeLabel(selectedFile) : "Context File"}
						</div>
						<h2 className="truncate text-base font-semibold text-slate-100">
							{document?.label || document?.key || "No file selected"}
						</h2>
						{document ? <div className="truncate font-mono text-[11px] text-slate-500">{document.path}</div> : null}
					</div>
					<div className="flex items-center gap-2">
						<span className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs ${savePillClass(saveState)}`}>
							<Save size={14} />
							{saveStateLabel(saveState)}
						</span>
						<button
							className="inline-flex h-8 w-8 items-center justify-center border border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#7dd3fc]"
							type="button"
							title="Reload"
							onClick={() => void handleReload()}
						>
							<RefreshCw size={15} />
						</button>
						<button
							className="inline-flex h-8 w-8 items-center justify-center border border-slate-700 text-slate-400 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45"
							type="button"
							title="Remove managed file"
							disabled={!selectedFile?.removable}
							onClick={() => void handleRemove()}
						>
							<Trash2 size={15} />
						</button>
					</div>
				</div>

				<div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
					{error ? <StatusBanner tone="error" text={error} /> : null}
					{conflict ? <StatusBanner tone="warning" text={conflict} /> : null}
					{document?.managed ? (
						<div className="flex flex-wrap items-center gap-2 border border-slate-800 bg-[#151f24] p-3 text-xs text-slate-400">
							<div className="flex gap-1">
								<button
									type="button"
									className={`inline-flex h-8 items-center justify-center border px-3 uppercase tracking-wider ${
										document.scope === "global"
											? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]"
											: "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
									}`}
									onClick={() => void handleScopeChange("global")}
								>
									Global
								</button>
								<button
									type="button"
									className={`inline-flex h-8 items-center justify-center border px-3 uppercase tracking-wider ${
										document.scope === "agent"
											? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]"
											: "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
									}`}
									onClick={() => void handleScopeChange("agent")}
									disabled={!metadataAgent.trim()}
								>
									Agent
								</button>
							</div>
							<input
								className="h-8 min-w-[16rem] flex-1 border border-slate-700 bg-[#0e1116] px-3 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-[#11a4d4]"
								value={metadataAgent}
								onChange={(event) => setMetadataAgent(event.currentTarget.value)}
								placeholder="agent-profile-name"
								list={metadataAgentListId}
							/>
							<datalist id={metadataAgentListId}>
								{agentOptions.map((profile) => (
									<option key={profile} value={profile} />
								))}
							</datalist>
						</div>
					) : null}

					{document?.exists ? (
						<div className="min-h-0 flex-1 overflow-auto border border-slate-800 bg-[#151f24]">
							<MarkdownEditor
								ref={editorRef}
								documentKey={`${document.key}:${document.version ?? document.updatedAt ?? ""}`}
								initialMarkdown={document.markdown}
								onPersist={handlePersist}
								onSaveStateChange={setSaveState}
							/>
						</div>
					) : (
						<div className="flex items-center gap-2 border border-dashed border-slate-700 bg-[#151f24] px-4 py-5 text-sm text-slate-400">
							<AlertTriangle size={18} />
							{document ? "The selected file is missing on disk." : "Select or create a context file."}
						</div>
					)}
				</div>
			</main>

			<aside className="min-h-0 overflow-auto border-l border-slate-800 bg-[#1a262b] max-[920px]:border-l-0 max-[920px]:border-t">
				<div className="border-b border-slate-800 px-4 py-3">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Context</div>
					<h1 className="mt-1 text-sm font-semibold text-slate-100">Context Files</h1>
				</div>

				<div className="space-y-3 p-3">
					<section className="space-y-2 border border-slate-800 bg-[#151f24] p-3">
						<div className="flex gap-1">
							<button
								className={`inline-flex h-8 items-center justify-center gap-1.5 border px-3 text-xs uppercase tracking-wider ${
									formScope === "global"
										? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]"
										: "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
								}`}
								type="button"
								onClick={() => setFormScope("global")}
							>
								<FilePlus2 size={14} />
								Global
							</button>
							<button
								className={`inline-flex h-8 items-center justify-center gap-1.5 border px-3 text-xs uppercase tracking-wider ${
									formScope === "agent"
										? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]"
										: "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
								}`}
								type="button"
								onClick={() => setFormScope("agent")}
							>
								<Files size={14} />
								Agent
							</button>
						</div>
						<input
							className="h-9 w-full border border-slate-700 bg-[#0e1116] px-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-[#11a4d4]"
							value={formLabel}
							onChange={(event) => setFormLabel(event.currentTarget.value)}
							placeholder="Context file name"
						/>
						{formScope === "agent" ? (
							<>
								<input
									className="h-9 w-full border border-slate-700 bg-[#0e1116] px-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-[#11a4d4]"
									value={formAgent}
									onChange={(event) => setFormAgent(event.currentTarget.value)}
									placeholder="agent-profile-name"
									list={createAgentListId}
								/>
								<datalist id={createAgentListId}>
									{agentOptions.map((profile) => (
										<option key={profile} value={profile} />
									))}
								</datalist>
							</>
						) : null}
						<button
							className="inline-flex h-9 items-center justify-center border border-[#11a4d4] bg-[#11a4d4] px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
							type="button"
							disabled={!formLabel.trim() || (formScope === "agent" && !formAgent.trim())}
							onClick={() => void handleSubmit()}
						>
							Create File
						</button>
					</section>

					<section className="space-y-2" aria-label="Context files">
						<div className="flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
							<Files size={13} />
							<span>{files.length} Files</span>
						</div>
						{loading ? <div className="border border-dashed border-slate-700 px-3 py-4 text-xs text-slate-500">Loading</div> : null}
						<div className="space-y-1">
							{files.map((file) => (
								<button
									type="button"
									key={file.key}
									className={`block w-full border px-3 py-2 text-left ${
										file.key === selectedKey
											? "border-[#11a4d4] bg-[#101d22]"
											: "border-transparent text-slate-300 hover:border-slate-700 hover:bg-[#101d22]"
									}`}
									onClick={() => void handleSelect(file.key)}
								>
									<div className="truncate text-sm font-medium text-slate-100">{file.label || file.key}</div>
									<div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-slate-500">{file.path}</div>
									<div className="mt-2 flex flex-wrap items-center gap-1.5">
										<span className={`inline-flex border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${scopeBadgeClass(file)}`}>
											{scopeLabel(file)}
										</span>
										{file.exists ? null : (
											<span className="inline-flex border border-amber-400/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-200">
												Missing
											</span>
										)}
									</div>
								</button>
							))}
						</div>
						{!loading && files.length === 0 ? (
							<div className="border border-dashed border-slate-700 px-3 py-4 text-xs text-slate-500">No context files registered</div>
						) : null}
					</section>
				</div>
			</aside>
		</div>
	);
}

function StatusBanner({ tone, text }: { tone: "error" | "warning"; text: string }) {
	const toneClass =
		tone === "error"
			? "border-red-500/80 bg-red-500/10 text-red-200"
			: "border-amber-400/80 bg-amber-400/10 text-amber-100";
	return <div className={`border px-3 py-2 text-sm ${toneClass}`}>{text}</div>;
}

function saveStateLabel(state: SaveState): string {
	if (state === "saving") return "Saving";
	if (state === "saved") return "Saved";
	if (state === "error") return "Error";
	return "Unsaved";
}

function savePillClass(state: SaveState): string {
	if (state === "saving") return "border-orange-400/80 bg-orange-400/10 text-orange-100";
	if (state === "saved") return "border-emerald-500/80 bg-emerald-500/10 text-emerald-100";
	if (state === "error") return "border-red-500/80 bg-red-500/10 text-red-200";
	return "border-amber-400/80 bg-amber-400/10 text-amber-100";
}

function scopeLabel(file: Pick<ContextFileInfo, "source" | "scope" | "agentProfileName">): string {
	if (file.source === "plugin") return "Plugin Global";
	if (file.scope === "agent") return file.agentProfileName ? `Agent ${file.agentProfileName}` : "Agent Local";
	return "Global";
}

function scopeBadgeClass(file: Pick<ContextFileInfo, "source" | "scope">): string {
	if (file.source === "plugin") return "border-cyan-500/70 text-cyan-200";
	if (file.scope === "agent") return "border-fuchsia-500/70 text-fuchsia-200";
	return "border-[#11a4d4]/80 text-[#7dd3fc]";
}

function parseProductEvent(message: MessageEvent): ProductEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as ProductEvent;
		return parsed && typeof parsed.type === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isConflictError(error: unknown): error is Error & { status: 409; data: { file: ContextFileDocument } } {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		(error as { status?: unknown }).status === 409 &&
		"data" in error &&
		typeof (error as { data?: unknown }).data === "object" &&
		(error as { data?: { file?: unknown } }).data?.file !== undefined
	);
}
