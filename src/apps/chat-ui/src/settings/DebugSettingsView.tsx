import { useEffect, useState } from "react";
import { DesignerPanel, InlineCheckboxToggle } from "../agents/designer-ui";
import {
	DEFAULT_TOOL_METRIC_THRESHOLDS,
	type ToolMetricThresholds,
} from "../tool-metric-settings";

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
	thresholds,
	onThresholdsChange,
}: {
	debugMode: boolean;
	onDebugModeChange: (value: boolean) => void;
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
		<DesignerPanel title="Tool diagnostics">
			<div className="max-w-3xl">
				<InlineCheckboxToggle
					checked={debugMode}
					title="Show Tool Debug metrics"
					onToggle={() => onDebugModeChange(!debugMode)}
				/>
				<p className="mt-3 text-xs leading-relaxed text-slate-400">
					Thresholds control only the signal-rail colors. Tool payload counts are estimates based on serialized characters ÷ 4,
					not provider usage or billing tokens. JSON escaping, punctuation, Unicode, and model-specific tokenizers can make the
					estimate differ from the tokens eventually charged in a model request.
				</p>
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
