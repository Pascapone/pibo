import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Check, RefreshCw, Save } from "lucide-react";
import { type SaveState } from "../api";
import {
	getCompactionPrompt,
	saveCustomCompactionPrompt,
	setCompactionPromptMode,
	type CompactionPromptMode,
	type CompactionPromptSnapshot,
} from "../api-settings";

export function CompactionPromptView() {
	const [snapshot, setSnapshot] = useState<CompactionPromptSnapshot | null>(null);
	const [viewMode, setViewMode] = useState<CompactionPromptMode>("library");
	const [customMarkdown, setCustomMarkdown] = useState("");
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const next = await getCompactionPrompt();
			setSnapshot(next);
			setViewMode(next.effectiveMode);
			setCustomMarkdown(next.custom.exists ? next.custom.markdown : next.library.markdown);
			setSaveState("saved");
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const visibleMarkdown = useMemo(() => {
		if (!snapshot) return "";
		return viewMode === "library" ? snapshot.library.markdown : customMarkdown;
	}, [customMarkdown, snapshot, viewMode]);

	const activateMode = useCallback(async (mode: CompactionPromptMode) => {
		setBusy(true);
		try {
			const next = await setCompactionPromptMode(mode);
			setSnapshot(next);
			setViewMode(mode);
			setCustomMarkdown(next.custom.exists ? next.custom.markdown : next.library.markdown);
			setSaveState("saved");
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, []);

	const saveCustom = useCallback(async () => {
		setBusy(true);
		setSaveState("saving");
		try {
			const next = await saveCustomCompactionPrompt(customMarkdown);
			setSnapshot(next);
			setViewMode("custom");
			setCustomMarkdown(next.custom.markdown);
			setSaveState("saved");
			setError(null);
		} catch (caught) {
			setSaveState("error");
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [customMarkdown]);

	const customActive = snapshot?.effectiveMode === "custom";

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#101d22]">
			<div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-[#151f24] px-4">
				<div className="min-w-0">
					<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#11a4d4]">Compaction Prompt</div>
					<h2 className="truncate text-base font-semibold text-slate-100">
						{snapshot?.effectiveMode === "custom" ? "Custom Compaction Prompt" : "Library Compaction Prompt"}
					</h2>
					<div className="truncate font-mono text-[11px] text-slate-500">
						{snapshot ? (snapshot.effectiveMode === "custom" ? snapshot.custom.path : snapshot.library.path) : "loading"}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<span className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs ${customActive ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#7dd3fc]" : "border-slate-700 bg-[#101d22] text-slate-300"}`}>
						<Brain size={14} />
						Active: {snapshot?.effectiveMode ?? "library"}
					</span>
					<button
						type="button"
						title="Reload"
						onClick={() => void load()}
						className="inline-flex h-8 w-8 items-center justify-center border border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#7dd3fc]"
					>
						<RefreshCw size={15} />
					</button>
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)] max-[980px]:grid-cols-1">
				<aside className="border-r border-slate-800 bg-[#151f24] p-3 max-[980px]:border-b max-[980px]:border-r-0">
					<div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Source</div>
					<button
						type="button"
						onClick={() => setViewMode("library")}
						className={`mb-2 w-full border p-2 text-left ${viewMode === "library" ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#101d22] hover:border-slate-700"}`}
					>
						<span className="flex items-center justify-between gap-2">
							<span className="block text-sm text-slate-200">Library</span>
							{!customActive ? <span className="font-mono text-[10px] uppercase tracking-wider text-[#7dd3fc]">Active</span> : null}
						</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">read-only</span>
					</button>
					<button
						type="button"
						onClick={() => setViewMode("custom")}
						className={`mb-4 w-full border p-2 text-left ${viewMode === "custom" ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#101d22] hover:border-slate-700"}`}
					>
						<span className="flex items-center justify-between gap-2">
							<span className="block text-sm text-slate-200">Custom</span>
							{customActive ? <span className="font-mono text-[10px] uppercase tracking-wider text-[#7dd3fc]">Active</span> : null}
						</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">{snapshot?.custom.exists ? "editable" : "not-created"}</span>
					</button>

					<div className="space-y-2">
						<CustomCompactionPromptToggle
							checked={customActive}
							disabled={busy || !snapshot}
							onToggle={() => void activateMode(customActive ? "library" : "custom")}
						/>
						<button
							type="button"
							disabled={busy || viewMode !== "custom"}
							onClick={() => void saveCustom()}
							className="inline-flex h-8 w-full items-center justify-center gap-2 border border-slate-700 bg-[#101d22] px-3 text-xs uppercase tracking-wider text-slate-300 hover:border-[#11a4d4] hover:text-[#7dd3fc] disabled:cursor-not-allowed disabled:opacity-45"
						>
							<Save size={14} />
							{saveState === "saving" ? "Saving" : "Save Custom"}
						</button>
					</div>
				</aside>

				<main className="flex min-h-0 flex-col gap-3 p-4">
					{error ? <div className="border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
					{loading ? (
						<div className="border border-slate-800 bg-[#151f24] p-4 text-sm text-slate-400">Loading compaction prompt...</div>
					) : (
						<textarea
							value={visibleMarkdown}
							readOnly={viewMode === "library"}
							onChange={(event) => {
								setCustomMarkdown(event.target.value);
								setSaveState("idle");
							}}
							spellCheck={false}
							className="min-h-0 flex-1 resize-none border border-slate-800 bg-[#0e1116] p-4 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-[#11a4d4] read-only:text-slate-400"
						/>
					)}
				</main>
			</div>
		</div>
	);
}

function CustomCompactionPromptToggle({
	checked,
	disabled,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			aria-pressed={checked}
			onClick={onToggle}
			className="flex w-full items-center gap-2 border border-slate-800 bg-[#101d22] p-2 text-left text-sm text-slate-300 hover:border-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<SelectionCheckbox checked={checked} disabled={disabled} />
			<span className="min-w-0">
				<span className="block truncate">Use custom compaction prompt</span>
				<span className="block truncate font-mono text-[10px] text-slate-500">{checked ? "custom active" : "library active"}</span>
			</span>
		</button>
	);
}

function SelectionCheckbox({
	checked,
	disabled,
}: {
	checked: boolean;
	disabled?: boolean;
}) {
	return (
		<span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${checked ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]" : "border-slate-600 text-transparent"} ${disabled ? "opacity-70" : ""}`}>
			{checked ? <Check size={12} /> : null}
		</span>
	);
}
