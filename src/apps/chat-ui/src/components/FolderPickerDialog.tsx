import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { browseFilesystem, type FilesystemBrowseEntry } from "../api-filesystem";
import { errorMessage } from "../error-message";
import "./folder-picker.css";

type DirectoryView = {
	kind: "directory";
	path: string;
	parent: string | null;
	entries: FilesystemBrowseEntry[];
	truncated: boolean;
};

type RootsView = { kind: "roots" };

type View = DirectoryView | RootsView;

type HistoryTarget = string | null;

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled])",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

export function FolderPickerDialog({ open, initialPath, onSelect, onClose }: {
	open: boolean;
	initialPath?: string;
	onSelect: (path: string) => void;
	onClose: () => void;
}) {
	const [view, setView] = useState<View | null>(null);
	const [roots, setRoots] = useState<string[]>([]);
	const [separator, setSeparator] = useState<"/" | "\\">("/");
	const [history, setHistory] = useState<{ entries: HistoryTarget[]; index: number }>({ entries: [], index: -1 });
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const requestRef = useRef(0);
	const overlayRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const addressRef = useRef<HTMLElement>(null);
	const titleId = useId();
	const pathFieldId = useId();

	const pushHistory = useCallback((target: HistoryTarget) => {
		setHistory((current) => {
			const base = current.entries.slice(0, current.index + 1);
			if (base[base.length - 1] === target) return { entries: base, index: base.length - 1 };
			const entries = [...base, target];
			return { entries, index: entries.length - 1 };
		});
	}, []);

	const navigate = useCallback((target: HistoryTarget | undefined, addHistory = true) => {
		setSelectedPath(null);
		setLoadError(undefined);
		if (target === null) {
			requestRef.current += 1;
			setLoading(false);
			setView({ kind: "roots" });
			if (addHistory) pushHistory(null);
			return;
		}
		const requestId = ++requestRef.current;
		setLoading(true);
		void browseFilesystem(target?.trim() ? target.trim() : undefined)
			.then((result) => {
				if (requestRef.current !== requestId) return;
				setRoots(result.roots);
				setSeparator(result.separator);
				setView({ kind: "directory", path: result.path, parent: result.parent, entries: result.entries, truncated: result.truncated });
				if (addHistory) pushHistory(result.path);
				setLoading(false);
			})
			.catch((caught) => {
				if (requestRef.current !== requestId) return;
				setLoading(false);
				setLoadError(errorMessage(caught));
			});
	}, [pushHistory]);

	useEffect(() => {
		if (!open) return;
		requestRef.current += 1;
		setHistory({ entries: [], index: -1 });
		setSelectedPath(null);
		setLoadError(undefined);
		setView(null);
		navigate(initialPath?.trim() ? initialPath.trim() : undefined);
	}, [open, initialPath, navigate]);

	useEffect(() => {
		if (!open) return;
		const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const frame = window.requestAnimationFrame(() => listRef.current?.focus());
		return () => {
			window.cancelAnimationFrame(frame);
			if (previouslyFocused?.isConnected) previouslyFocused.focus();
		};
	}, [open ]);

	useEffect(() => {
		const node = addressRef.current;
		if (!node) return;
		const frame = window.requestAnimationFrame(() => {
			node.scrollLeft = node.scrollWidth;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [view]);

	const goBack = useCallback(() => {
		if (history.index <= 0) return;
		const target = history.entries[history.index - 1];
		setHistory((current) => ({ entries: current.entries, index: current.index - 1 }));
		navigate(target, false);
	}, [history, navigate]);

	const goForward = useCallback(() => {
		if (history.index >= history.entries.length - 1) return;
		const target = history.entries[history.index + 1];
		setHistory((current) => ({ entries: current.entries, index: current.index + 1 }));
		navigate(target, false);
	}, [history, navigate]);

	const goUp = useCallback(() => {
		if (view?.kind !== "directory") return;
		if (view.parent) navigate(view.parent);
		else if (roots.length > 1) navigate(null);
	}, [view, roots, navigate]);

	const handleOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const activeElement = document.activeElement;
		if (!focusable.includes(activeElement as HTMLElement)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (event.shiftKey && activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Backspace") {
			event.preventDefault();
			goBack();
		}
		if (event.altKey && event.key === "ArrowUp") {
			event.preventDefault();
			goUp();
		}
	};

	if (!open) return null;

	const crumbs = view?.kind === "directory" ? splitCrumbs(view.path, separator) : [];
	const rows: Array<{ name: string; path: string; modifiedAt: string | null; drive: boolean }> =
		view?.kind === "directory"
			? view.entries.map((entry) => ({ name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt, drive: false }))
			: view?.kind === "roots"
				? roots.map((root) => ({ name: displayRootName(root), path: root, modifiedAt: null, drive: true }))
				: [];
	const canGoBack = history.index > 0;
	const canGoForward = history.index < history.entries.length - 1;
	const canGoUp = view?.kind === "directory" && (view.parent !== null || roots.length > 1);
	const footerPath = view?.kind === "directory" ? view.path : "";
	const showLoading = loading;
	const showError = !loading && loadError !== undefined;
	const showEmpty = !loading && loadError === undefined && rows.length === 0;

	return (
		<div
			className="pibo-folder-picker"
			ref={overlayRef}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
			onKeyDown={handleOverlayKeyDown}
		>
			<div className="dialog-backdrop">
				<section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
					<header className="dialog-titlebar">
						<div className="dialog-title">
							<span className="dialog-app-mark" aria-hidden="true">
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-panels-top-left preview-icon"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
							</span>
							<div className="dialog-title-text">
								<strong id={titleId}>Projektordner auswählen</strong>
								<span>Pibo / Folder Picker</span>
							</div>
						</div>
						<button className="window-close" type="button" aria-label="Dialog schließen" onClick={onClose}>
							<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
						</button>
					</header>

					<div className="navigation-bar">
						<div className="nav-buttons" aria-label="Navigation">
							<button className="nav-button" type="button" aria-label="Zurück" title="Zurück (Backspace)" disabled={!canGoBack} onClick={goBack}>
								<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
							</button>
							<button className="nav-button" type="button" aria-label="Vorwärts" title="Vorwärts" disabled={!canGoForward} onClick={goForward}>
								<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
							</button>
							<button className="nav-button" type="button" aria-label="Eine Ebene höher" title="Eine Ebene höher (Alt + Pfeil hoch)" disabled={!canGoUp} onClick={goUp}>
								<svg viewBox="0 0 24 24"><path d="m18 15-6-6-6 6" /></svg>
							</button>
						</div>
						<nav className="address-bar" ref={addressRef} aria-label="Aktueller Pfad">
							<span className="address-root-icon" aria-hidden="true">
								<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-monitor preview-icon"><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></svg>
							</span>
							{view?.kind === "roots" ? (
								<span className="crumb current crumb-static">Laufwerke</span>
							) : (
								crumbs.map((crumb, index) => (
									<span key={`${crumb.path}:${index}`} style={{ display: "contents" }}>
										{index > 0 ? <span className="crumb-separator">›</span> : null}
										<button
											type="button"
											className={`crumb${index === crumbs.length - 1 ? " current" : ""}`}
											onClick={() => navigate(crumb.path)}
										>
											{crumb.label}
										</button>
									</span>
								))
							)}
						</nav>
					</div>

					<section className="folder-view" aria-label="Ordner">
						<div className="list-header" aria-hidden="true">
							<div className="folder-cell">Name</div>
							<div className="folder-cell">Änderungsdatum</div>
							<div className="folder-cell">Typ</div>
						</div>
						<div className="folder-list" ref={listRef} role="listbox" aria-label="Ordner in diesem Verzeichnis" tabIndex={0} onKeyDown={handleListKeyDown}>
							{!showLoading && !showError ? rows.map((row) => (
								<div
									key={row.path}
									className={`folder-row${selectedPath === row.path ? " selected" : ""}`}
									role="option"
									aria-selected={selectedPath === row.path}
									tabIndex={0}
									title={row.path}
									onClick={() => setSelectedPath(row.path)}
									onDoubleClick={() => navigate(row.path)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											navigate(row.path);
										}
									}}
								>
									<div className="folder-cell folder-name-cell">
										<span className="folder-icon" aria-hidden="true">
											{row.drive ? (
												<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-monitor preview-icon"><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></svg>
											) : (
												<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder preview-icon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
											)}
										</span>
										<span className="folder-name">{row.name}</span>
									</div>
									<div className="folder-cell folder-meta">{formatModifiedAt(row.modifiedAt)}</div>
									<div className="folder-cell folder-meta">{row.drive ? "Laufwerk" : "Dateiordner"}</div>
								</div>
							)) : null}
							{!showLoading && !showError && view?.kind === "directory" && view.truncated ? (
								<div className="folder-row" aria-hidden="true">
									<div className="folder-cell folder-name-cell"><span className="folder-name">… weitere Ordner werden nicht angezeigt</span></div>
									<div className="folder-cell folder-meta" />
									<div className="folder-cell folder-meta" />
								</div>
							) : null}
						</div>
						{showLoading ? (
							<div className="empty-view">
								<div>
									<strong>Verzeichnis wird geladen …</strong>
									<span>Einen Moment bitte.</span>
								</div>
							</div>
						) : null}
						{showError ? (
							<div className="empty-view" data-tone="error" role="alert">
								<div>
									<strong>Verzeichnis kann nicht geöffnet werden.</strong>
									<span>{loadError}</span>
									<div><button type="button" className="button secondary retry-button" onClick={() => navigate(view?.kind === "directory" ? view.path : initialPath?.trim() ? initialPath.trim() : undefined, false)}>Erneut versuchen</button></div>
								</div>
							</div>
						) : null}
						{showEmpty ? (
							<div className="empty-view">
								<div>
									<strong>Dieser Ordner ist leer.</strong>
									<span>Es werden ausschließlich Unterordner angezeigt.</span>
								</div>
							</div>
						) : null}
					</section>

					<footer className="dialog-footer">
						<div className="folder-field">
							<label htmlFor={pathFieldId}>Ordner:</label>
							<div className="folder-path-field" id={pathFieldId} role="textbox" aria-readonly="true" title={footerPath}>{footerPath}</div>
						</div>
						<div className="footer-actions">
							<button className="button secondary" type="button" onClick={onClose}>Abbrechen</button>
							<button
								className="button primary"
								type="button"
								disabled={view?.kind !== "directory" || loading}
								title={view?.kind === "directory" ? `Diesen Ordner auswählen: ${view.path}` : undefined}
								onClick={() => {
									if (view?.kind === "directory") {
										onSelect(view.path);
										onClose();
									}
								}}
							>
								Ordner auswählen
							</button>
						</div>
					</footer>
				</section>
			</div>
		</div>
	);
}

function splitCrumbs(path: string, separator: "/" | "\\"): Array<{ label: string; path: string }> {
	const parts = path.split(separator).filter((part) => part.length > 0);
	const prefix = separator === "/" ? "/" : path.startsWith("\\\\") ? "\\\\" : "";
	const crumbs = parts.map((part, index) => {
		let full = `${prefix}${parts.slice(0, index + 1).join(separator)}`;
		if (/^[A-Za-z]:$/.test(full)) full += separator;
		return { label: part, path: full };
	});
	if (!crumbs.length) crumbs.push({ label: separator, path: separator });
	return crumbs;
}

function displayRootName(root: string): string {
	return root.length > 1 && (root.endsWith("/") || root.endsWith("\\")) ? root.slice(0, -1) : root;
}

function formatModifiedAt(iso: string | null): string {
	if (!iso) return "–";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "–";
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
