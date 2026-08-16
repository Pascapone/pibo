import { useMemo, useState } from "react";
import { Check, Lock, Search } from "lucide-react";
import { patchSession } from "../../api";
import type { CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";
import { isModelMenuResult, unwrapActionResult, type ModelMenuModel } from "./loginMenu";

export function TerminalModelCard({
	row,
	piboSessionId,
	onModelChanged,
}: {
	row: CompactTerminalRow;
	piboSessionId?: string;
	onModelChanged?: () => Promise<void>;
}) {
	const output = unwrapActionResult(row.output);
	const menu = isModelMenuResult(output) ? output : undefined;
	const providers = menu?.providers ?? [];
	const models = useMemo(
		() => providers.flatMap((provider) => provider.models.map((model) => ({
			...model,
			providerLabel: provider.label,
			authConfigured: provider.authConfigured,
		}))),
		[providers],
	);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<ModelMenuModel | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return models;
		return models.filter((model) => `${model.providerLabel} ${model.provider} ${model.label} ${model.id}`.toLowerCase().includes(normalized));
	}, [models, query]);

	const selectModel = async (model: ModelMenuModel & { authConfigured?: boolean }) => {
		if (!piboSessionId || busy || model.authConfigured === false) return;
		setBusy(true);
		setSelected(model);
		setMessage(null);
		try {
			await patchSession(piboSessionId, { activeModel: { provider: model.provider, id: model.id } });
			setMessage(`Selected ${model.provider}/${model.id}.`);
			await onModelChanged?.();
		} catch (caught) {
			setMessage(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ml-[1.9rem] max-w-3xl border border-[#3a3a3a] bg-[#111111] text-[12px] shadow-lg" data-shared-terminal-card="model">
			<div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] px-3 py-2">
				<div>
					<div className="text-[#d4d4d4]">Model</div>
					<div className="text-[11px] text-[#737373]">Choose a model exposed by the active runtime.</div>
				</div>
			</div>
			<div className="space-y-2 p-3">
				{providers.length ? (
					<>
						<label className="flex items-center gap-2 border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[#737373]">
							<Search size={13} />
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search models"
								className="min-w-0 flex-1 bg-transparent text-[#d4d4d4] outline-none placeholder:text-[#525252]"
							/>
						</label>
						<div className="max-h-72 overflow-auto border border-[#2a2a2a]">
							{filtered.length ? filtered.map((model) => (
								<button
									key={`${model.provider}:${model.id}`}
									type="button"
									disabled={busy || model.authConfigured === false}
									onClick={() => void selectModel(model)}
									className="grid w-full grid-cols-[150px_1fr_auto] gap-2 border-b border-[#1f1f1f] px-3 py-2 text-left hover:bg-[#38bdf8]/10 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<span className="truncate text-[#737373]">{model.providerLabel}</span>
									<span className="min-w-0">
										<span className="block truncate text-[#d4d4d4]">{model.label}</span>
										<span className="block truncate text-[11px] text-[#737373]">{model.provider}/{model.id}</span>
									</span>
									{model.authConfigured === false
										? <Lock size={13} className="text-[#737373]" aria-label="Provider authentication missing" />
										: selected?.provider === model.provider && selected?.id === model.id
											? <Check size={14} className="text-[#22c55e]" />
											: null}
								</button>
							)) : <div className="px-3 py-2 text-[#737373]">No matching models.</div>}
						</div>
					</>
				) : (
					<div className="text-[#737373]">No models are available for the active runtime.</div>
				)}
				{message ? <div className="text-[11px] text-[#a3a3a3]">{message}</div> : null}
			</div>
		</div>
	);
}
