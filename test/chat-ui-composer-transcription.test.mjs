import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("composer asynchronous status messages expose alert and polite live-region semantics", async () => {
	const source = await readFile(new URL("../src/apps/chat-ui/src/composer/Composer.tsx", import.meta.url), "utf8");
	assert.match(source, /role=\{transcriptionStatus\.error \? "alert" : "status"\}/);
	assert.match(source, /aria-live=\{transcriptionStatus\.error \? "assertive" : "polite"\}/);
	assert.match(source, /role=\{uploadStatus\.error \? "alert" : "status"\}/);
	assert.equal((source.match(/aria-atomic="true"/g) ?? []).length >= 2, true);
	assert.match(source, /aria-label="Hide transcription status"/);
});

test("composer transcription appends recordings without replacing existing text", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { appendTranscribedText } = await import("./src/apps/chat-ui/src/composer/Composer.tsx");
		assert.equal(appendTranscribedText("", " first recording "), "first recording");
		assert.equal(appendTranscribedText("Existing draft", "second recording"), "Existing draft\\n\\nsecond recording");
		assert.equal(appendTranscribedText("Existing draft\\n", "second recording"), "Existing draft\\nsecond recording");
		assert.equal(appendTranscribedText("Keep this", "   "), "Keep this");
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});

test("recording controls support transcribe, transcribe-and-send, and discard outcomes", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { useState } from "react";
		import TestRenderer, { act } from "react-test-renderer";
		import { Composer } from "./src/apps/chat-ui/src/composer/Composer.tsx";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.requestAnimationFrame = () => 1;
		globalThis.cancelAnimationFrame = () => {};
		globalThis.document = { addEventListener() {}, removeEventListener() {} };
		globalThis.window = {};
		const noop = () => {};
		const tracks = [];
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				mediaDevices: {
					getUserMedia: async () => {
						const track = { stopped: false, stop() { this.stopped = true; } };
						tracks.push(track);
						return { getTracks: () => [track] };
					},
				},
			},
		});

		class FakeMediaRecorder {
			static isTypeSupported() { return true; }
			state = "inactive";
			mimeType;
			ondataavailable = null;
			onerror = null;
			onstop = null;
			constructor(_stream, options = {}) { this.mimeType = options.mimeType || "audio/webm"; }
			start() { this.state = "recording"; }
			stop() {
				this.state = "inactive";
				this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
				this.onstop?.();
			}
		}
		globalThis.MediaRecorder = FakeMediaRecorder;

		const transcriptions = ["voice and send", "voice only"];
		let transcriptionRequests = 0;
		globalThis.fetch = async () => {
			const text = transcriptions[transcriptionRequests++];
			return new Response(JSON.stringify({ transcription: { providerId: "fixture", text } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		function Harness({ initialValue, sends }) {
			const [value, setValue] = useState(initialValue);
			return React.createElement(Composer, {
				sessionId: "ps-recording-test",
				commands: [],
				skills: [],
				value,
				focusSignal: 0,
				selectedWebAnnotations: [],
				selectedUploadAttachments: [],
				onValueChange: setValue,
				onCommand: async () => false,
				onDetachWebAnnotation: noop,
				onClearWebAnnotations: noop,
				onAttachUploadedFiles: noop,
				onDetachUploadAttachment: noop,
				onClearUploadAttachments: noop,
				onSend: async (text) => { sends.push(text); },
			});
		}

		const flush = async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
			await new Promise((resolve) => setTimeout(resolve, 0));
		};
		const startRecording = async (renderer) => {
			await act(async () => {
				renderer.root.findByProps({ "data-pibo-debug": "composer-audio-recording" }).props.onClick();
				await flush();
			});
		};

		const sendSends = [];
		let sendRenderer;
		await act(async () => {
			sendRenderer = TestRenderer.create(React.createElement(Harness, { initialValue: "Existing draft", sends: sendSends }));
		});
		await startRecording(sendRenderer);
		assert.equal(sendRenderer.root.findByProps({ "data-pibo-debug": "composer-send" }).props.disabled, false);
		assert.equal(sendRenderer.root.findAllByProps({ "data-pibo-debug": "composer-audio-cancel" }).length, 1);
		await act(async () => {
			sendRenderer.root.findByProps({ "data-pibo-debug": "composer-send" }).props.onClick();
			await flush();
		});
		assert.deepEqual(sendSends, ["Existing draft\\n\\nvoice and send"]);
		assert.equal(sendRenderer.root.findByType("textarea").props.value, "");
		assert.equal(tracks[0].stopped, true);

		const discardSends = [];
		let discardRenderer;
		await act(async () => {
			discardRenderer = TestRenderer.create(React.createElement(Harness, { initialValue: "Keep draft", sends: discardSends }));
		});
		await startRecording(discardRenderer);
		await act(async () => {
			discardRenderer.root.findByProps({ "data-pibo-debug": "composer-audio-cancel" }).props.onClick();
			await flush();
		});
		assert.equal(transcriptionRequests, 1);
		assert.deepEqual(discardSends, []);
		assert.equal(discardRenderer.root.findByType("textarea").props.value, "Keep draft");
		assert.equal(discardRenderer.root.findAllByProps({ "data-pibo-debug": "composer-audio-cancel" }).length, 0);
		assert.equal(tracks[1].stopped, true);

		const transcribeSends = [];
		let transcribeRenderer;
		await act(async () => {
			transcribeRenderer = TestRenderer.create(React.createElement(Harness, { initialValue: "Draft", sends: transcribeSends }));
		});
		await startRecording(transcribeRenderer);
		await act(async () => {
			transcribeRenderer.root.findByProps({ "data-pibo-debug": "composer-audio-recording" }).props.onClick();
			await flush();
		});
		assert.equal(transcriptionRequests, 2);
		assert.deepEqual(transcribeSends, []);
		assert.equal(transcribeRenderer.root.findByType("textarea").props.value, "Draft\\n\\nvoice only");
		assert.equal(tracks[2].stopped, true);

		await act(async () => {
			sendRenderer.unmount();
			discardRenderer.unmount();
			transcribeRenderer.unmount();
		});
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
