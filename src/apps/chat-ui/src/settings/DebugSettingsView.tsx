import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DesignerPanel, InlineCheckboxToggle } from "../agents/designer-ui";
import type { DebugFeatureSettings } from "../../../../shared/debug-features.js";
import { getUserSettings, patchUserSettings } from "../api-settings";
import {
	DEFAULT_TOOL_METRIC_THRESHOLDS,
	type ToolMetricThresholds,
} from "../tool-metric-settings";
import {
	DEFAULT_TOOL_METRIC_TOKEN_CALCULATION,
	TIKTOKEN_ENCODINGS,
	type TiktokenEncoding,
	type ToolMetricTokenCalculation,
} from "../../../../shared/tool-call-token-settings.js";

type ThresholdDraft = {
	durationElevated: string;
	durationHigh: string;
	durationCritical: string;
	inputElevated: string;
	inputHigh: string;
	inputCritical: string;
	outputElevated: string;
	outputHigh: string;
	outputCritical: string;
};

export function DebugSettingsView({
	debugMode,
	onDebugModeChange,
	debugFeatures,
	onDebugFeaturesChange,
	thresholds,
	onThresholdsChange,
}: {
	debugMode: boolean;
	onDebugModeChange: (value: boolean) => void;
	debugFeatures: DebugFeatureSettings;
	onDebugFeaturesChange: (value: DebugFeatureSettings) => void;
	thresholds: ToolMetricThresholds;
	onThresholdsChange: (value: ToolMetricThresholds) => void;
}) {
	const [draft, setDraft] = useState(() => draftFromThresholds(thresholds));
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setDraft(draftFromThresholds(thresholds)), [thresholds]);

	const update = (key: keyof ThresholdDraft, value: string) => {
		setDraft((current) => ({ ...current, [key]: value }));
		setMessage(null);
		setError(null);
	};

	const save = () => {
		const next = thresholdsFromDraft(draft);
		if (!next) {
			setMessage(null);
			setError("Each row must contain three positive, increasing values.");
			return;
		}
		onThresholdsChange(next);
		setError(null);
		setMessage("Debug thresholds saved in this browser.");
	};

	const reset = () => {
		onThresholdsChange(DEFAULT_TOOL_METRIC_THRESHOLDS);
		setDraft(draftFromThresholds(DEFAULT_TOOL_METRIC_THRESHOLDS));
		setError(null);
		setMessage("Default Debug thresholds restored.");
	};

	return (
		<DesignerPanel title="Debug configuration">
			<div className="max-w-3xl">
				<InlineCheckboxToggle
					checked={debugMode}
					title="Enable Debug mode"
					onToggle={() => onDebugModeChange(!debugMode)}
				/>
				<p className="mt-3 text-xs leading-relaxed text-slate-400">
					The header Debug toggle controls whether enabled diagnostics appear. Feature selections remain saved when Debug mode is off.
				</p>
				<div className="mt-4 grid gap-2 border border-slate-800 bg-[#111820] p-3 sm:grid-cols-2">
					<InlineCheckboxToggle
						checked={debugFeatures.toolMetrics}
						title="Tool call metrics"
						onToggle={() => onDebugFeaturesChange({ ...debugFeatures, toolMetrics: !debugFeatures.toolMetrics })}
					/>
					<InlineCheckboxToggle
						checked={debugFeatures.modelInferenceMetrics}
						title="Model inference metrics"
						onToggle={() => onDebugFeaturesChange({ ...debugFeatures, modelInferenceMetrics: !debugFeatures.modelInferenceMetrics })}
					/>
				</div>
				<p className="mt-3 text-xs leading-relaxed text-slate-400">
					Model inference metrics use provider-reported usage. Tool payload counts are diagnostics rather than provider usage or billing;
					the Tool signal rail records the selected calculation method with every completed Tool call.
				</p>
				<div className="mt-5 border-t border-slate-800 pt-5">
					<h2 className="text-xs font-semibold uppercase tracking-wide text-slate-200">Tool metric configuration</h2>
					<TokenCalculationSettings />
				</div>
				<div className="mt-5 grid gap-4">
					<ThresholdRow
						legend="Execution time"
						unit="seconds"
						values={[draft.durationElevated, draft.durationHigh, draft.durationCritical]}
						onChange={(index, value) => update((["durationElevated", "durationHigh", "durationCritical"] as const)[index]!, value)}
					/>
					<ThresholdRow
						legend="Estimated input payload"
						unit="tokens"
						values={[draft.inputElevated, draft.inputHigh, draft.inputCritical]}
						onChange={(index, value) => update((["inputElevated", "inputHigh", "inputCritical"] as const)[index]!, value)}
					/>
					<ThresholdRow
						legend="Estimated output payload"
						unit="tokens"
						values={[draft.outputElevated, draft.outputHigh, draft.outputCritical]}
						onChange={(index, value) => update((["outputElevated", "outputHigh", "outputCritical"] as const)[index]!, value)}
					/>
				</div>
				<div className="mt-5 flex flex-wrap items-center gap-2">
					<button type="button" onClick={save} className="border border-[#11a4d4] bg-[#11a4d4]/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-[#11a4d4]/25">
						Save thresholds
					</button>
					<button type="button" onClick={reset} className="border border-slate-700 bg-[#151f24] px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600">
						Restore defaults
					</button>
				</div>
				{message ? <p role="status" className="mt-3 text-xs text-emerald-300">{message}</p> : null}
				{error ? <p role="alert" className="mt-3 text-xs text-red-300">{error}</p> : null}
			</div>
		</DesignerPanel>
	);
}

function TokenCalculationSettings() {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ["user-settings"], queryFn: getUserSettings });
	const [method, setMethod] = useState<ToolMetricTokenCalculation["method"]>(DEFAULT_TOOL_METRIC_TOKEN_CALCULATION.method);
	const [factor, setFactor] = useState("4");
	const [encoding, setEncoding] = useState<TiktokenEncoding>("o200k_base");
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const calculation = data?.toolMetrics.tokenCalculation;
		if (!calculation) return;
		setMethod(calculation.method);
		if (calculation.method === "characters") setFactor(String(calculation.factor));
		else setEncoding(calculation.encoding);
	}, [data]);

	const save = async () => {
		const parsedFactor = Number(factor);
		const tokenCalculation: ToolMetricTokenCalculation | undefined = method === "characters"
			? Number.isFinite(parsedFactor) && parsedFactor > 0
				? { method, factor: parsedFactor }
				: undefined
			: { method, encoding };
		if (!tokenCalculation) {
			setMessage(null);
			setError("Character factor must be greater than zero.");
			return;
		}
		setSaving(true);
		setMessage(null);
		setError(null);
		try {
			const saved = await patchUserSettings({ toolMetrics: { tokenCalculation } });
			queryClient.setQueryData(["user-settings"], saved);
			setMessage("Token calculation saved. Future Tool calls use this method.");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<fieldset className="mt-5 border border-slate-800 bg-[#111820] p-3">
			<legend className="px-1 text-xs font-semibold text-slate-200">Token calculation</legend>
			<div className="grid gap-3 sm:grid-cols-2">
				<label htmlFor="tool-token-calculation-method" className="text-[11px] text-slate-400">
					<span className="mb-1 block font-semibold uppercase tracking-wide">Method</span>
					<select
						id="tool-token-calculation-method"
						value={method}
						disabled={isLoading || saving}
						onChange={(event) => {
							setMethod(event.target.value as ToolMetricTokenCalculation["method"]);
							setMessage(null);
							setError(null);
						}}
						className="w-full border border-slate-700 bg-[#0b1115] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-[#11a4d4]"
					>
						<option value="characters">Characters ÷ factor</option>
						<option value="tiktoken">Tiktoken</option>
					</select>
				</label>
				{method === "characters" ? (
					<label htmlFor="tool-token-character-factor" className="text-[11px] text-slate-400">
						<span className="mb-1 block font-semibold uppercase tracking-wide">Characters per token</span>
						<input
							id="tool-token-character-factor"
							type="number"
							min="0.1"
							step="0.1"
							value={factor}
							disabled={saving}
							onChange={(event) => setFactor(event.target.value)}
							className="w-full border border-slate-700 bg-[#0b1115] px-2 py-1.5 font-mono text-xs tabular-nums text-slate-100 outline-none focus:border-[#11a4d4]"
						/>
					</label>
				) : (
					<label htmlFor="tool-token-tiktoken-encoding" className="text-[11px] text-slate-400">
						<span className="mb-1 block font-semibold uppercase tracking-wide">Encoding</span>
						<select
							id="tool-token-tiktoken-encoding"
							value={encoding}
							disabled={saving}
							onChange={(event) => setEncoding(event.target.value as TiktokenEncoding)}
							className="w-full border border-slate-700 bg-[#0b1115] px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-[#11a4d4]"
						>
							{TIKTOKEN_ENCODINGS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
						</select>
					</label>
				)}
			</div>
			<p className="mt-3 text-[11px] leading-relaxed text-slate-500">
				Character mode keeps the bounded structural estimate and divides it by the selected factor. Tiktoken lazily loads its
				WASM tokenizer and encodes the serialized payload at Tool start and finish, which uses more CPU and memory. Neither
				method is provider billing attribution.
			</p>
			<button
				type="button"
				onClick={() => void save()}
				disabled={isLoading || saving}
				className="mt-3 border border-[#11a4d4] bg-[#11a4d4]/15 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-[#11a4d4]/25 disabled:opacity-60"
			>
				{saving ? "Saving…" : "Save calculation"}
			</button>
			{message ? <p role="status" className="mt-3 text-xs text-emerald-300">{message}</p> : null}
			{error ? <p role="alert" className="mt-3 text-xs text-red-300">{error}</p> : null}
		</fieldset>
	);
}

function ThresholdRow({
	legend,
	unit,
	values,
	onChange,
}: {
	legend: string;
	unit: string;
	values: readonly [string, string, string];
	onChange: (index: 0 | 1 | 2, value: string) => void;
}) {
	const levels = ["Elevated", "High", "Critical"] as const;
	return (
		<fieldset className="border border-slate-800 bg-[#111820] p-3">
			<legend className="px-1 text-xs font-semibold text-slate-200">{legend}</legend>
			<div className="grid gap-3 sm:grid-cols-3">
				{levels.map((level, index) => {
					const id = `${legend.toLowerCase().replaceAll(" ", "-")}-${level.toLowerCase()}`;
					return (
						<label key={level} htmlFor={id} className="text-[11px] text-slate-400">
							<span className="mb-1 block font-semibold uppercase tracking-wide">{level}</span>
							<div className="flex items-center border border-slate-700 bg-[#0b1115] focus-within:border-[#11a4d4]">
								<input
									id={id}
									type="number"
									min={unit === "seconds" ? "0.1" : "1"}
									step={unit === "seconds" ? "0.1" : "1"}
									value={values[index]}
									onChange={(event) => onChange(index as 0 | 1 | 2, event.target.value)}
									className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs tabular-nums text-slate-100 outline-none"
								/>
								<span className="border-l border-slate-800 px-2 text-[10px] text-slate-500">{unit}</span>
							</div>
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

function draftFromThresholds(thresholds: ToolMetricThresholds): ThresholdDraft {
	return {
		durationElevated: String(thresholds.durationMs.elevated / 1_000),
		durationHigh: String(thresholds.durationMs.high / 1_000),
		durationCritical: String(thresholds.durationMs.critical / 1_000),
		inputElevated: String(thresholds.inputTokens.elevated),
		inputHigh: String(thresholds.inputTokens.high),
		inputCritical: String(thresholds.inputTokens.critical),
		outputElevated: String(thresholds.outputTokens.elevated),
		outputHigh: String(thresholds.outputTokens.high),
		outputCritical: String(thresholds.outputTokens.critical),
	};
}

function thresholdsFromDraft(draft: ThresholdDraft): ToolMetricThresholds | null {
	const duration = [draft.durationElevated, draft.durationHigh, draft.durationCritical].map((value) => Math.round(Number(value) * 1_000));
	const input = [draft.inputElevated, draft.inputHigh, draft.inputCritical].map(Number);
	const output = [draft.outputElevated, draft.outputHigh, draft.outputCritical].map(Number);
	if (!validIncreasing(duration) || !validIncreasing(input) || !validIncreasing(output)) return null;
	return {
		durationMs: { elevated: duration[0]!, high: duration[1]!, critical: duration[2]! },
		inputTokens: { elevated: input[0]!, high: input[1]!, critical: input[2]! },
		outputTokens: { elevated: output[0]!, high: output[1]!, critical: output[2]! },
	};
}

function validIncreasing(values: number[]): boolean {
	return values.every((value) => Number.isSafeInteger(value) && value > 0)
		&& values[0]! < values[1]!
		&& values[1]! < values[2]!;
}
