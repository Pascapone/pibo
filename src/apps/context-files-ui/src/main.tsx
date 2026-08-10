import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	AlertTriangle,
	FilePlus2,
	Files,
	RefreshCw,
	Save,
	Trash2,
} from "lucide-react";
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
	type ProductEvent,
	type SaveState,
} from "./api";
import { MarkdownEditor, type MarkdownEditorHandle } from "./components/MarkdownEditor";
import "./styles.css";
import "../../shared/markdown-editor.css";

type ContextFileScope = "global" | "agent";

function App() {
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
			refreshFiles().catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));

			const eventKey = event.payload?.key;
			if (!eventKey || eventKey !== selectedKey) return;
			if (event.source === "web") return;

			if (saveStateRef.current === "idle" || saveStateRef.current === "saving") {
				setConflict("This file changed on disk while you had local edits. Review before saving again.");
				return;
			}

			loadDocument(eventKey).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
		});
		events.onerror = () => {
			setError("Live context-file updates disconnected.");
		};
		return () => events.close();
	}, [loadDocument, refreshFiles, selectedKey]);

	const selectedFile = useMemo(
		() => files.find((file) => file.key === selectedKey) ?? null,
		[files, selectedKey],
	);

	useEffect(() => {
		setMetadataAgent(document?.agentProfileName ?? "");
	}, [document?.agentProfileName, document?.key]);

	const handleSelect = useCallback(
		async (key: string) => {
			try {
				await editorRef.current?.flushSave();
				setSelectedKey(key);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		},
		[],
	);

	const handleSubmit = useCallback(async () => {
		try {
			await editorRef.current?.flushSave();
			const file = await createContextFile({
				label: formLabel,
				scope: formScope,
				agentProfileName: formScope === "agent" ? formAgent : undefined,
				markdown: "",
			});
			setFormLabel("");
			setFormAgent("");
			await refreshFiles();
			await hydrateDocument(file);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [formAgent, formLabel, formScope, hydrateDocument, refreshFiles]);

	const handlePersist = useCallback(
		async (markdown: string) => {
			if (!document) return;
			try {
				const saved = await saveContextFile(document.key, {
					markdown,
					expectedVersion: document.version,
				});
				await hydrateDocument(saved);
				setConflict(null);
				await refreshFiles();
			} catch (caught) {
				if (isConflictError(caught)) {
					await hydrateDocument(caught.data.file);
					setConflict("The file changed before save. The editor reloaded the latest disk version.");
				}
				throw caught;
			}
		},
		[document, hydrateDocument, refreshFiles],
	);

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

	const handleScopeChange = useCallback(
		async (scope: ContextFileScope) => {
			if (!document?.managed) return;
			try {
				const updated = await updateContextFileMetadata(document.key, {
					scope,
					agentProfileName: scope === "agent" ? metadataAgent : undefined,
				});
				await hydrateDocument(updated);
				await refreshFiles();
				setError(null);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		},
		[document, hydrateDocument, metadataAgent, refreshFiles],
	);

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
		<div className="app-shell">
			<aside className="sidebar">
				<div className="sidebar-header">
					<div>
						<p className="eyebrow">Pibo</p>
						<h1>Context Files</h1>
					</div>
					<a className="chat-link" href="/apps/chat">Chat</a>
				</div>

				<section className="tool-panel">
					<div className="segmented">
						<button className={formScope === "global" ? "active" : ""} type="button" onClick={() => setFormScope("global")}>
							<FilePlus2 size={15} />
							Global
						</button>
						<button className={formScope === "agent" ? "active" : ""} type="button" onClick={() => setFormScope("agent")}>
							<Files size={15} />
							Agent
						</button>
					</div>
					<input value={formLabel} onChange={(event) => setFormLabel(event.currentTarget.value)} placeholder="Context file name" />
					{formScope === "agent" ? (
						<input value={formAgent} onChange={(event) => setFormAgent(event.currentTarget.value)} placeholder="agent-profile-name" />
					) : null}
					<button className="primary-action" type="button" disabled={!formLabel.trim() || (formScope === "agent" && !formAgent.trim())} onClick={() => void handleSubmit()}>
						Create File
					</button>
				</section>

				<section className="file-list" aria-label="Context files">
					<div className="list-title">
						<Files size={15} />
						<span>{files.length} files</span>
					</div>
					{loading ? <div className="empty">Loading</div> : null}
					{files.map((file) => (
						<button
							type="button"
							key={file.key}
							className={file.key === selectedKey ? "file-row selected" : "file-row"}
							onClick={() => void handleSelect(file.key)}
						>
							<span className="file-name">{file.label || file.key}</span>
							<span className="file-path">{file.path}</span>
							<span className={`scope-badge scope-badge--${file.scope}`}>{scopeLabel(file)}</span>
							<span className={`scope-badge scope-badge--${file.scope}`}>{linkStateLabel(file.linkState)}</span>
							{file.exists ? null : <span className="missing">missing</span>}
						</button>
					))}
					{!loading && files.length === 0 ? <div className="empty">No context files registered</div> : null}
				</section>
			</aside>

			<main className="editor-pane">
				<header className="editor-header">
					<div className="editor-title">
						<p className="eyebrow">{selectedFile ? scopeLabel(selectedFile) : "Context File"}</p>
						<h2>{document?.label || document?.key || "No file selected"}</h2>
						{document ? <p className="path-line">{document.path}</p> : null}
					</div>
					<div className="editor-actions">
						<span className={`save-pill save-pill--${saveState}`}>
							<Save size={15} />
							{saveStateLabel(saveState)}
						</span>
						<button className="icon-button" type="button" title="Reload" onClick={() => void handleReload()}>
							<RefreshCw size={16} />
						</button>
						<button
							className="icon-button danger"
							type="button"
							title="Remove managed file"
							disabled={!selectedFile?.removable}
							onClick={() => void handleRemove()}
						>
							<Trash2 size={16} />
						</button>
					</div>
				</header>

				{error ? <StatusBanner tone="error" text={error} /> : null}
				{conflict ? <StatusBanner tone="warning" text={conflict} /> : null}
				{document ? (
					<div className="scope-controls">
						<div>State: <strong>{linkStateLabel(document.linkState)}</strong></div>
						{document.sourceRef ? <div>Source: <code>{document.sourceRef}</code></div> : null}
						{document.sourceHash ? <div>Hash: <code>{document.sourceHash}</code></div> : null}
					</div>
				) : null}
				{document?.source === "plugin" ? (
					<div className="scope-controls">
						<div>This is a plugin-owned source file. Create a managed copy before editing.</div>
						<button className="primary-action" type="button" disabled={actionBusy} onClick={() => void handleLinkCopy()}>
							Create Managed Copy
						</button>
					</div>
				) : null}
				{document?.managed ? (
					<div className="scope-controls">
						<div className="segmented">
							<button type="button" className={document.scope === "global" ? "active" : ""} onClick={() => void handleScopeChange("global")}>
								Global
							</button>
							<button type="button" className={document.scope === "agent" ? "active" : ""} onClick={() => void handleScopeChange("agent")} disabled={!metadataAgent.trim()}>
								Agent
							</button>
						</div>
						<input value={metadataAgent} onChange={(event) => setMetadataAgent(event.currentTarget.value)} placeholder="agent-profile-name" />
						{document.sourceRef ? (
							<>
								<button className="primary-action" type="button" disabled={actionBusy} onClick={() => void handleResetToSource()}>
									Reset To Source
								</button>
								{document.linkState === "linked-stale" ? (
									<button className="primary-action" type="button" disabled={actionBusy} onClick={() => void handleAdoptSource()}>
										Adopt Source
									</button>
								) : null}
							</>
						) : null}
					</div>
				) : null}

				{document?.exists ? (
					<div className="editor-frame">
						<MarkdownEditor
							ref={editorRef}
							documentKey={document.key}
							initialMarkdown={document.markdown}
							onPersist={handlePersist}
							onSaveStateChange={setSaveState}
							readOnly={!document.editable}
							ariaLabel={document.label ? `${document.label} Markdown editor` : "Context file Markdown editor"}
						/>
					</div>
				) : (
					<div className="empty-editor">
						<AlertTriangle size={20} />
						{document ? "The selected file is missing on disk." : "Select or create a context file."}
					</div>
				)}
				{document?.managed && revisions.length > 0 ? (
					<div className="scope-controls">
						<h3>Revisions</h3>
						<div className="file-list">
							{revisions.map((revision) => (
								<div key={revision.id} className="file-row">
									<div>
										<strong>{revision.kind}</strong> {revision.active ? "(active)" : ""}
									</div>
									<div>{revision.note ?? revision.id}</div>
									<div>{revision.createdAt}</div>
									{revision.active ? null : (
										<button className="primary-action" type="button" disabled={actionBusy} onClick={() => void handleRestoreRevision(revision.id)}>
											Restore
										</button>
									)}
								</div>
							))}
						</div>
					</div>
				) : null}
				{document?.managed && diff ? (
					<div className="scope-controls">
						<h3>Diff</h3>
						<div className="file-list">
							{diff.chunks.map((chunk, index) => (
								<pre key={`${chunk.type}-${index}`} className="file-row">{chunk.lines.map((line) => `${chunk.type === "add" ? "+" : chunk.type === "remove" ? "-" : " "} ${line}`).join("\n")}</pre>
							))}
						</div>
					</div>
				) : null}
			</main>
		</div>
	);
}

function StatusBanner({ tone, text }: { tone: "error" | "warning"; text: string }) {
	return <div className={`status-banner status-banner--${tone}`}>{text}</div>;
}

function saveStateLabel(state: SaveState): string {
	if (state === "saving") return "Saving";
	if (state === "saved") return "Saved";
	if (state === "error") return "Error";
	return "Unsaved";
}

function scopeLabel(file: Pick<ContextFileInfo, "source" | "scope" | "agentProfileName">): string {
	if (file.source === "plugin") return "Plugin Global";
	if (file.scope === "agent") return file.agentProfileName ? `Agent ${file.agentProfileName}` : "Agent Local";
	return "Global";
}

function linkStateLabel(state: ContextFileInfo["linkState"]): string {
	if (state === "plugin-only") return "Plugin Only";
	if (state === "linked-clean") return "Linked Clean";
	if (state === "linked-dirty") return "Linked Dirty";
	if (state === "linked-stale") return "Linked Stale";
	if (state === "orphaned") return "Orphaned";
	return "Managed Unlinked";
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

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
