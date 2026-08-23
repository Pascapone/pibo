import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("recording waveform keeps exactly the latest three seconds of bounded samples", async () => {
	const script = `
		import assert from "node:assert/strict";
		const {
			RECORDING_WAVEFORM_BAR_COUNT,
			RECORDING_WAVEFORM_SAMPLE_INTERVAL_MS,
			RECORDING_WAVEFORM_WINDOW_MS,
			appendRecordingWaveformSample,
			formatRecordingDuration,
			recordingWaveformBars,
		} = await import("./src/apps/chat-ui/src/composer/RecordingWaveform.tsx");

		assert.equal(RECORDING_WAVEFORM_WINDOW_MS, 3_000);
		assert.equal(RECORDING_WAVEFORM_SAMPLE_INTERVAL_MS, 50);
		assert.equal(RECORDING_WAVEFORM_BAR_COUNT, 60);

		let samples = appendRecordingWaveformSample([], -1, 0);
		samples = appendRecordingWaveformSample(samples, 0.5, 2_999);
		assert.deepEqual(samples, [{ at: 0, level: 0 }, { at: 2_999, level: 0.5 }]);
		samples = appendRecordingWaveformSample(samples, 2, 3_000);
		assert.deepEqual(samples, [{ at: 2_999, level: 0.5 }, { at: 3_000, level: 1 }]);

		const bars = recordingWaveformBars(samples);
		assert.equal(bars.length, 60);
		assert.deepEqual(bars.slice(-2), [0.5, 1]);
		assert.ok(bars.slice(0, -2).every((level) => level === 0));
		assert.equal(formatRecordingDuration(0), "0:00");
		assert.equal(formatRecordingDuration(65_999), "1:05");
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});

test("recording waveform is a full-radius component above the composer input row", () => {
	const waveformSource = readFileSync(resolve("src/apps/chat-ui/src/composer/RecordingWaveform.tsx"), "utf8");
	const composerSource = readFileSync(resolve("src/apps/chat-ui/src/composer/Composer.tsx"), "utf8");
	assert.match(waveformSource, /data-pibo-debug="composer-audio-waveform"/);
	assert.match(waveformSource, /rounded-full/);
	assert.match(waveformSource, /data-window-ms=\{RECORDING_WAVEFORM_WINDOW_MS\}/);
	assert.ok(composerSource.indexOf("<RecordingWaveform") < composerSource.indexOf('className="grid grid-cols-[1fr_auto_auto]'));
});
