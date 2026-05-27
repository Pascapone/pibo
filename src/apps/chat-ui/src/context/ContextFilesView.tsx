import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, FilePlus2, Files, RefreshCw, Save, Trash2 } from "lucide-react";
import {
	adoptContextFileSource,
	createContextFile,
	diffContextFile,
	linkContextFileFromPlugin,
	listContextFileRevisions,
	listContextFiles,
	readContextFile,
	removeContextFile,
	resetContextFileToSource,
	restoreContextFileRevision,
	saveContextFile,
	updateContextFileMetadata,
	type ContextFileDiff,
	type ContextFileDocument,
	type ContextFileInfo,
	type ContextFileRevision,
} from "../api-context-files";
import type { ProductEvent, SaveState } from "../api";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";

type ContextFileScope = "global" | "agent";

export function ContextFilesView({ agentProfiles, selectedFileKey }: { agentProfiles: string[]; selectedFileKey?: string | null }) {
	const agentOptions = useMemo(() => [...new Set(agentProfiles)].sort((left, right) => left.localeCompare(right)), [agentProfiles]);
	const editorRef = useRef<MarkdownEditorHandle>(null);
	const saveStateRef = useRef<SaveState>("saved");
	const [files, setFiles] = useState<ContextFileInfo[]>([]);
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [document, setDocument] = useState<ContextFileDocument | null>(null);
	const [revisions, setRevisions] = useState<ContextFileRevision[]>([]);
	const [diff, setDiff] = useState<ContextFileDiff | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [conflict, setConflict] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [actionBusy, setActionBusy] = useState(false);
	const [formLabel, setFormLabel] = useState("");
	const [formScope, setFormScope] = useState<ContextFileScope>("global");
	const [formAgent, setFormAgent] = useState("");
	const [metadataAgent, setMetadataAgent] = useState("");

	useEffect(() => {
		saveStateRef.current = saveState;
	}, [saveState]);

	const hydrateDocument = useCallback(async (nextDocument: ContextFileDocument) => {
		setDocument(nextDocument);
		setSelectedKey(nextDocument.key);
		setConflict(null);
		setError(null);
		if (!nextDocument.managed) {
			setRevisions([]);
			setDiff(null);
			return;
		}
		const [revisionPayload, nextDiff] = await Promise.all([
			listContextFileRevisions(nextDocument.key),
			nextDocument.sourceRef ? diffContextFile(nextDocument.key).catch(() => null) : Promise.resolve(null),
		]);
		setRevisions(revisionPayload.revisions);
		setDiff(nextDiff);
	}, []);

	const refreshFiles = useCallback(async () => {
		const nextFiles = await listContextFiles();
		setFiles(nextFiles);
		setSelectedKey((current) => current ?? nextFiles[0]?.key ?? null);
	}, []);

	const loadDocument = useCallback(async (key: string) => {
		const nextDocument = await readContextFile(key);
		await hydrateDocument(nextDocument);
	}, [hydrateDocument]);

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

	useEffect(() => {
		if (formScope !== "agent" || formAgent || agentOptions.length === 0) return;
		setFormAgent(agentOptions[0]);
	}, [agentOptions, formAgent, formScope]);

	const handleSelect = useCallback(async (key: string) => {
		try {
			await editorRef.current?.flushSave();
			await loadDocument(key);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [loadDocument]);

	useEffect(() => {
		if (!selectedFileKey || selectedFileKey === selectedKey) return;
		let cancelled = false;
		void (async () => {
			try {
				await editorRef.current?.flushSave();
				if (!cancelled) setSelectedKey(selectedFileKey);
			} catch (caught) {
				if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedFileKey, selectedKey]);

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
			await hydrateDocument(created);
			await refreshFiles();
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [formAgent, formLabel, formScope, hydrateDocument, refreshFiles]);

	const handlePersist = useCallback(async (markdown: string) => {
		if (!document) return;
		try {
			const saved = await saveContextFile(document.key, {
				markdown,
				expectedVersion: document.version,
			});
			await hydrateDocument(saved);
			await refreshFiles();
			setConflict(null);
			setError(null);
		} catch (caught) {
			if (isConflictError(caught)) {
				await hydrateDocument(caught.data.file);
				setConflict("This file changed on disk before your save completed. Reload the latest version and retry.");
				return;
			}
			setError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		}
	}, [document, hydrateDocument, refreshFiles]);

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
		setActionBusy(true);
		try {
			const updated = await updateContextFileMetadata(document.key, {
				scope,
				agentProfileName: scope === "agent" ? metadataAgent.trim() || undefined : undefined,
			});
			await hydrateDocument(updated);
			await refreshFiles();
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setActionBusy(false);
		}
	}, [document, hydrateDocument, metadataAgent, refreshFiles]);

	const handleMetadataAgentChange = useCallback((nextAgent: string) => {
		setMetadataAgent(nextAgent);
		if (!document?.managed || !nextAgent || (document.scope === "agent" && nextAgent === (document.agentProfileName ?? ""))) return;
		setActionBusy(true);
		void updateContextFileMetadata(document.key, {
			scope: "agent",
			agentProfileName: nextAgent,
		})
			.then(async (updated) => {
				await hydrateDocument(updated);
				await refreshFiles();
				setError(null);
			})
			.catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
			.finally(() => setActionBusy(false));
	}, [document, hydrateDocument, refreshFiles]);

	const handleLinkCopy = useCallback(async () => {
		if (!selectedFile || selectedFile.source !== "plugin") return;
		setActionBusy(true);
		try {
			const created = await linkContextFileFromPlugin(selectedFile.key);
			await refreshFiles();
			await hydrateDocument(created);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setActionBusy(false);
		}
	}, [hydrateDocument, refreshFiles, selectedFile]);

	const handleResetToSource = useCallback(async () => {
		if (!document?.managed || !document.sourceRef) return;
		setActionBusy(true);
		try {
			const updated = await resetContextFileToSource(document.key);
			await refreshFiles();
			await hydrateDocument(updated);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setActionBusy(false);
		}
	}, [document, hydrateDocument, refreshFiles]);

	const handleAdoptSource = useCallback(async () => {
		if (!document?.managed || document.linkState !== "linked-stale") return;
		setActionBusy(true);
		try {
			const updated = await adoptContextFileSource(document.key);
			await refreshFiles();
			await hydrateDocument(updated);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setActionBusy(false);
		}
	}, [document, hydrateDocument, refreshFiles]);

	const handleRestoreRevision = useCallback(async (revisionId: string) => {
		if (!document?.managed) return;
		setActionBusy(true);
		try {
			const updated = await restoreContextFileRevision(document.key, revisionId);
			await refreshFiles();
			await hydrateDocument(updated);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setActionBusy(false);
		}
	}, [document, hydrateDocument, refreshFiles]);

	return (
		<div className="context-files-view grid h-full min-h-0 grid-cols-[minmax(0,1fr)_300px] max-[1120px]:grid-cols-[minmax(0,1fr)_260px] max-[900px]:flex max-[900px]:flex-col max-[900px]:overflow-auto">
			<main className="flex min-h-0 flex-col bg-[#101d22] max-[900px]:min-h-[70vh] max-[900px]:shrink-0">
				<div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4 max-[640px]:h-auto max-[640px]:flex-wrap max-[640px]:py-3">
					<div className="min-w-0">
						<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">
							{selectedFile ? scopeLabel(selectedFile) : "Context File"}
						</div>
						<h2 className="truncate text-base font-semibold text-slate-100">
							{document?.label || document?.key || "No file selected"}
						</h2>
						{document ? <div className="truncate font-mono text-[11px] text-slate-500">{document.path}</div> : null}
					</div>
					<div className="flex shrink-0 items-center gap-2">
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

				<div className="flex min-h-0 flex-1 flex-col gap-3 p-4 max-[640px]:p-3">
					{error ? <StatusBanner tone="error" text={error} /> : null}
					{conflict ? <StatusBanner tone="warning" text={conflict} /> : null}
					{document ? (
						<div className="flex flex-wrap items-center gap-3 border border-slate-800 bg-[#151f24] px-3 py-2 text-xs text-slate-400">
							<div>State: <span className="text-slate-100">{linkStateLabel(document.linkState)}</span></div>
							{document.sourceRef ? <div className="min-w-0 break-all font-mono text-[11px] text-slate-500">{document.sourceRef}</div> : null}
							{document.sourceHash ? <div className="min-w-0 break-all font-mono text-[11px] text-slate-500">{document.sourceHash}</div> : null}
						</div>
					) : null}
					{document?.source === "plugin" ? (
						<div className="flex flex-wrap items-center gap-3 border border-slate-800 bg-[#151f24] p-3 text-xs text-slate-400">
							<div>Plugin context files are immutable in Pibo. Create a managed copy before editing.</div>
							<button
								className="inline-flex min-h-8 items-center justify-center border border-[#11a4d4] bg-[#11a4d4]/10 px-3 py-1 text-xs uppercase tracking-wider text-[#7dd3fc] disabled:opacity-45"
								type="button"
								disabled={actionBusy}
								onClick={() => void handleLinkCopy()}
							>
								Create Managed Copy
							</button>
						</div>
					) : null}
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
									disabled={actionBusy}
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
									disabled={actionBusy || !metadataAgent.trim()}
								>
									Agent
								</button>
							</div>
							<AgentProfileSelect
								value={metadataAgent}
								options={optionListWithSelectedAgent(agentOptions, metadataAgent)}
								placeholder="Select agent"
								disabled={actionBusy}
								onChange={handleMetadataAgentChange}
								compact
							/>
							{document.sourceRef ? (
								<button
									className="inline-flex h-8 items-center justify-center border border-[#11a4d4] bg-[#11a4d4]/10 px-3 uppercase tracking-wider text-[#7dd3fc] disabled:opacity-45"
									type="button"
									disabled={actionBusy}
									onClick={() => void handleResetToSource()}
								>
									Reset To Source
								</button>
							) : null}
							{document.linkState === "linked-stale" ? (
								<button
									className="inline-flex h-8 items-center justify-center border border-amber-400/70 bg-amber-400/10 px-3 uppercase tracking-wider text-amber-100 disabled:opacity-45"
									type="button"
									disabled={actionBusy}
									onClick={() => void handleAdoptSource()}
								>
									Adopt Source
								</button>
							) : null}
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
								readOnly={!document.editable}
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

			<aside className="min-h-0 overflow-auto border-l border-slate-800 bg-[#1a262b] max-[900px]:order-first max-[900px]:shrink-0 max-[900px]:border-l-0 max-[900px]:border-b max-[900px]:overflow-visible">
				<div className="border-b border-slate-800 px-4 py-3">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Context</div>
					<h1 className="mt-1 text-sm font-semibold text-slate-100">Context Files</h1>
				</div>

				<div className="space-y-3 p-3">
					<section className="space-y-2 border border-slate-800 bg-[#151f24] p-3 max-[640px]:overflow-hidden">
						<div className="flex flex-wrap gap-1">
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
							<AgentProfileSelect
								value={formAgent}
								options={agentOptions}
								placeholder="Select agent"
								onChange={setFormAgent}
							/>
						) : null}
						<button
							className="inline-flex h-9 w-full items-center justify-center border border-[#11a4d4] bg-[#11a4d4] px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
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
									<div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-slate-500 max-[640px]:whitespace-normal max-[640px]:break-all">{file.path}</div>
									<div className="mt-2 flex flex-wrap items-center gap-1.5">
										<span className={`inline-flex border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${scopeBadgeClass(file)}`}>
											{scopeLabel(file)}
										</span>
										<span className={`inline-flex border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${linkStateBadgeClass(file.linkState)}`}>
											{linkStateLabel(file.linkState)}
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

					{document?.managed ? (
						<section className="space-y-2" aria-label="Selected context file history">
							<div className="px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">File Details</div>
							<DetailDisclosure title="Revision History" meta={`${revisions.length} revisions`}>
								<ContextFileRevisionsPanel revisions={revisions} actionBusy={actionBusy} onRestore={handleRestoreRevision} />
							</DetailDisclosure>
							{diff ? (
								<DetailDisclosure title="Source Diff" meta={`${diff.chunks.length} chunks`}>
									<ContextFileDiffPanel diff={diff} />
								</DetailDisclosure>
							) : null}
						</section>
					) : null}
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

function DetailDisclosure({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
	return (
		<details className="group border border-slate-800 bg-[#151f24]">
			<summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200">
				<span className="font-bold uppercase tracking-wider text-slate-300">{title}</span>
				<span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
					{meta ? <span>{meta}</span> : null}
					<span aria-hidden="true">▾</span>
				</span>
			</summary>
			<div className="max-h-[34vh] overflow-auto border-t border-slate-800 p-2">
				{children}
			</div>
		</details>
	);
}

function ContextFileRevisionsPanel({
	revisions,
	actionBusy,
	onRestore,
}: {
	revisions: ContextFileRevision[];
	actionBusy: boolean;
	onRestore: (revisionId: string) => void;
}) {
	if (revisions.length === 0) {
		return <div className="border border-dashed border-slate-700 px-3 py-4 text-xs text-slate-500">No revisions recorded yet.</div>;
	}

	return (
		<div className="space-y-2">
			{revisions.map((revision) => (
				<div key={revision.id} className="space-y-2 border border-slate-800 bg-[#101d22] px-3 py-2 text-xs text-slate-400">
					<div>
						<div className="font-medium text-slate-100">{revision.kind} {revision.active ? "(active)" : ""}</div>
						<div className="break-words">{revision.note ?? revision.id}</div>
						<div className="break-all font-mono text-[11px] text-slate-500">{revision.createdAt}</div>
					</div>
					{revision.active ? null : (
						<button
							className="inline-flex h-8 items-center justify-center border border-slate-700 px-3 text-[11px] uppercase tracking-wider text-slate-300 hover:border-[#11a4d4] hover:text-[#7dd3fc] disabled:opacity-45"
							type="button"
							disabled={actionBusy}
							onClick={() => onRestore(revision.id)}
						>
							Restore
						</button>
					)}
				</div>
			))}
		</div>
	);
}

function ContextFileDiffPanel({ diff }: { diff: ContextFileDiff }) {
	return (
		<div className="space-y-1">
			{diff.chunks.map((chunk, index) => (
				<pre key={`${chunk.type}-${index}`} className={`overflow-auto border px-3 py-2 text-xs ${
					chunk.type === "add"
						? "border-emerald-500/60 bg-emerald-500/10 text-emerald-100"
						: chunk.type === "remove"
							? "border-red-500/60 bg-red-500/10 text-red-100"
							: "border-slate-800 bg-[#101d22] text-slate-300"
				}`}>{chunk.lines.map((line) => `${chunk.type === "add" ? "+" : chunk.type === "remove" ? "-" : " "} ${line}`).join("\n")}</pre>
			))}
		</div>
	);
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

function AgentProfileSelect({
	value,
	options,
	placeholder,
	disabled = false,
	onChange,
	compact = false,
}: {
	value: string;
	options: string[];
	placeholder: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	compact?: boolean;
}) {
	return (
		<div className={`relative ${compact ? "min-w-[16rem] flex-1 max-[640px]:min-w-full" : ""}`}>
			<select
				className={`w-full appearance-none border border-slate-700 bg-[#0e1116] pr-9 text-slate-200 outline-none focus:border-[#11a4d4] disabled:cursor-not-allowed disabled:opacity-60 ${compact ? "h-8 px-3 text-xs" : "h-9 px-3 text-sm"}`}
				value={value}
				disabled={disabled || options.length === 0}
				onChange={(event) => onChange(event.currentTarget.value)}
			>
				{!value ? <option value="">{placeholder}</option> : null}
				{options.length === 0 ? <option value="">{placeholder}</option> : null}
				{options.map((profile) => (
					<option key={profile} value={profile}>{profile}</option>
				))}
			</select>
			<span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-slate-500">
				<ChevronDown size={14} />
			</span>
		</div>
	);
}

function optionListWithSelectedAgent(options: string[], selectedAgent: string): string[] {
	if (!selectedAgent || options.includes(selectedAgent)) return options;
	return [selectedAgent, ...options];
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

function linkStateLabel(state: ContextFileInfo["linkState"]): string {
	if (state === "plugin-only") return "Plugin Only";
	if (state === "linked-clean") return "Linked Clean";
	if (state === "linked-dirty") return "Linked Dirty";
	if (state === "linked-stale") return "Linked Stale";
	if (state === "orphaned") return "Orphaned";
	return "Managed Unlinked";
}

function linkStateBadgeClass(state: ContextFileInfo["linkState"]): string {
	if (state === "plugin-only") return "border-cyan-500/70 text-cyan-200";
	if (state === "linked-clean") return "border-emerald-500/70 text-emerald-200";
	if (state === "linked-dirty") return "border-orange-400/70 text-orange-100";
	if (state === "linked-stale") return "border-amber-400/70 text-amber-100";
	if (state === "orphaned") return "border-red-500/70 text-red-200";
	return "border-slate-600 text-slate-300";
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
