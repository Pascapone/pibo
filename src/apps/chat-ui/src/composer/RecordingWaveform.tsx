import { useMemo } from "react";

export const RECORDING_WAVEFORM_WINDOW_MS = 3_000;
export const RECORDING_WAVEFORM_SAMPLE_INTERVAL_MS = 50;
export const RECORDING_WAVEFORM_BAR_COUNT = RECORDING_WAVEFORM_WINDOW_MS / RECORDING_WAVEFORM_SAMPLE_INTERVAL_MS;

export type RecordingWaveformSample = {
	at: number;
	level: number;
};

type RecordingWaveformProps = {
	samples: readonly RecordingWaveformSample[];
	elapsedMs: number;
};

export function RecordingWaveform({ samples, elapsedMs }: RecordingWaveformProps) {
	const bars = useMemo(() => recordingWaveformBars(samples), [samples]);
	return (
		<div
			className="mb-2 flex h-12 w-full items-center gap-3 overflow-hidden rounded-full border border-[#11a4d4]/60 bg-[#0e1116] px-4"
			role="status"
			aria-label="Recording audio"
			data-pibo-debug="composer-audio-waveform"
			data-window-ms={RECORDING_WAVEFORM_WINDOW_MS}
			data-sample-count={samples.length}
		>
			<span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-400" aria-hidden="true" />
			<span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-red-300">Rec</span>
			<svg
				className="h-8 min-w-0 flex-1"
				viewBox={`0 0 ${RECORDING_WAVEFORM_BAR_COUNT * 4} 32`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{bars.map((level, index) => {
					const height = Math.max(3, Math.round(level * 28));
					return (
						<rect
							key={index}
							x={index * 4 + 1}
							y={(32 - height) / 2}
							width="2"
							height={height}
							rx="1"
							fill="#11a4d4"
							opacity={0.3 + (index / Math.max(1, bars.length - 1)) * 0.7}
						/>
					);
				})}
			</svg>
			<span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-400" aria-hidden="true">
				{formatRecordingDuration(elapsedMs)}
			</span>
		</div>
	);
}

export function appendRecordingWaveformSample(
	current: readonly RecordingWaveformSample[],
	level: number,
	at: number,
): RecordingWaveformSample[] {
	const normalizedLevel = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
	return [
		...current.filter((sample) => at - sample.at < RECORDING_WAVEFORM_WINDOW_MS),
		{ at, level: normalizedLevel },
	].slice(-RECORDING_WAVEFORM_BAR_COUNT);
}

export function recordingWaveformBars(samples: readonly RecordingWaveformSample[]): number[] {
	const levels = samples.slice(-RECORDING_WAVEFORM_BAR_COUNT).map((sample) => sample.level);
	return [
		...Array.from({ length: Math.max(0, RECORDING_WAVEFORM_BAR_COUNT - levels.length) }, () => 0),
		...levels,
	];
}

export function formatRecordingDuration(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
