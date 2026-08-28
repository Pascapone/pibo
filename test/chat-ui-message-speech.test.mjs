import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runTsxScenario(script) {
	const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		maxBuffer: 4 * 1024 * 1024,
	});
	return JSON.parse(stdout.trim().split("\n").at(-1));
}

test("message speech lifecycle owns cancellation, stale requests, concurrent buttons, and audio resources", async () => {
	const result = await runTsxScenario(String.raw`
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { MessageSpeechButton } from "./src/apps/chat-ui/src/components/MessageSpeechButton.tsx";

		const { act, create } = TestRenderer;
		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const startQueue = [];
		const speakDeferred = new Map();
		const requests = [];
		const createdUrls = [];
		const revokedUrls = [];
		globalThis.URL.createObjectURL = (value) => { createdUrls.push(value); return "blob:test"; };
		globalThis.URL.revokeObjectURL = (value) => revokedUrls.push(value);

		function deferred() {
			let resolve;
			let reject;
			const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
			return { promise, resolve, reject };
		}
		function response(payload, status = 200) {
			return new Response(status === 204 ? null : JSON.stringify(payload), {
				status,
				headers: status === 204 ? undefined : { "content-type": "application/json" },
			});
		}
		function session(id) {
			return { speechSession: { providerId: "openai-codex", sessionId: id, answerSdp: "answer-" + id } };
		}
		globalThis.fetch = async (path, init = {}) => {
			const url = String(path);
			requests.push({ url, method: init.method ?? "GET", aborted: init.signal?.aborted ?? false });
			if (url === "/api/chat/speech/sessions" && init.method === "POST") {
				const next = startQueue.shift();
				if (next?.deferred) return next.deferred.promise;
				if (next?.error) return response({ error: next.error }, next.status ?? 503);
				return response(session(next?.id ?? "session-default"), 201);
			}
			const match = url.match(/^\/api\/chat\/speech\/sessions\/([^/]+)(?:\/speak)?$/);
			if (!match) throw new Error("Unexpected fetch " + url);
			const id = decodeURIComponent(match[1]);
			if (url.endsWith("/speak")) {
				const pending = speakDeferred.get(id);
				return pending ? pending.promise : response(undefined, 204);
			}
			return response(undefined, 204);
		};

		let decodeFailure = false;
		let resumeFailure = false;
		const allTracks = [];
		const allSources = [];
		function track(name) {
			const listeners = new Map();
			const value = {
				name,
				stopCount: 0,
				stop() { this.stopCount += 1; },
				addEventListener(type, listener) { listeners.set(type, listener); },
				emit(type) { listeners.get(type)?.(); },
			};
			allTracks.push(value);
			return value;
		}
		class MockAudioContext {
			static instances = [];
			constructor() {
				this.sampleRate = 100;
				this.destination = {};
				this.closeCount = 0;
				this.localTrack = track("local-" + MockAudioContext.instances.length);
				MockAudioContext.instances.push(this);
			}
			async resume() {
				if (resumeFailure) { resumeFailure = false; throw new Error("Audio playback was rejected"); }
			}
			createMediaStreamDestination() {
				const localTrack = this.localTrack;
				return { stream: { getAudioTracks: () => [localTrack], getTracks: () => [localTrack] } };
			}
			createMediaStreamSource() {
				if (decodeFailure) { decodeFailure = false; throw new Error("Audio stream decode failed"); }
				return { disconnectCount: 0, connect() {}, disconnect() { this.disconnectCount += 1; } };
			}
			createAnalyser() {
				return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData(values) { values.fill(0.02); } };
			}
			createBuffer(channels, length) {
				return { getChannelData: () => new Float32Array(length) };
			}
			createBufferSource() {
				const listeners = new Map();
				const source = {
					buffer: null,
					startCount: 0,
					stopCount: 0,
					disconnectCount: 0,
					connect() {},
					disconnect() { this.disconnectCount += 1; },
					start() { this.startCount += 1; },
					stop() { this.stopCount += 1; },
					addEventListener(type, listener) { listeners.set(type, listener); },
				};
				allSources.push(source);
				return source;
			}
			async close() { this.closeCount += 1; }
		}
		class MockDataChannel {
			constructor() { this.listeners = new Map(); }
			addEventListener(type, listener) { this.listeners.set(type, listener); }
			emit(type) { this.listeners.get("message")?.({ data: JSON.stringify({ type }) }); }
		}
		class MockPeer {
			static instances = [];
			constructor() {
				this.iceGatheringState = "complete";
				this.connectionState = "connected";
				this.localDescription = { type: "offer", sdp: "offer" };
				this.closeCount = 0;
				this.channel = new MockDataChannel();
				MockPeer.instances.push(this);
			}
			addEventListener() {}
			removeEventListener() {}
			addTransceiver() {}
			createDataChannel() { return this.channel; }
			async createOffer() { return { type: "offer", sdp: "offer" }; }
			async setLocalDescription(value) { this.localDescription = value; }
			async setRemoteDescription(value) { this.remoteDescription = value; }
			close() { this.closeCount += 1; }
		}
		globalThis.AudioContext = MockAudioContext;
		globalThis.RTCPeerConnection = MockPeer;

		const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
		const clickEvent = () => ({ stopPropagation() {} });
		const button = (renderer, index = 0) => renderer.root.findAllByProps({ "data-pibo-component": "MessageSpeechButton" })[index];
		const state = (renderer, index = 0) => button(renderer, index).props["data-speech-state"];

		const lateStart = deferred();
		startQueue.push({ deferred: lateStart });
		let renderer;
		await act(async () => { renderer = create(React.createElement(MessageSpeechButton, { text: "first", scopeKey: "ps-one:row" })); });
		const idleContract = {
			label: button(renderer).props["aria-label"],
			busy: button(renderer).props["aria-busy"],
			disabled: button(renderer).props.disabled ?? false,
		};
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(); });
		const loadingContract = { state: state(renderer), label: button(renderer).props["aria-label"], busy: button(renderer).props["aria-busy"] };
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(); });
		const cancelledState = state(renderer);
		lateStart.resolve(response(session("late-session"), 201));
		await act(async () => { await flush(10); });
		const lateDeleteCount = requests.filter((item) => item.url === "/api/chat/speech/sessions/late-session" && item.method === "DELETE").length;

		startQueue.push({ error: "provider unavailable", status: 503 });
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(10); });
		const retryContract = {
			state: state(renderer),
			label: button(renderer).props["aria-label"],
			alerts: renderer.root.findAllByProps({ role: "alert" }).length,
		};

		const speakOne = deferred();
		speakDeferred.set("playing-session", speakOne);
		startQueue.push({ id: "playing-session" });
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(10); });
		const playingPeer = MockPeer.instances.at(-1);
		await act(async () => {
			playingPeer.channel.emit("output_transcript.added");
			playingPeer.channel.emit("session.context.appended");
			await flush(170);
		});
		const playingContract = { state: state(renderer), label: button(renderer).props["aria-label"], sources: allSources.length };
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(); });
		speakOne.resolve(response(undefined, 204));
		await act(async () => { await flush(10); });
		const stopContract = {
			state: state(renderer),
			deletes: requests.filter((item) => item.url === "/api/chat/speech/sessions/playing-session" && item.method === "DELETE").length,
			sourceStops: allSources.reduce((sum, source) => sum + source.stopCount, 0),
		};

		resumeFailure = true;
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(10); });
		const playReject = { state: state(renderer), title: button(renderer).props.title, closed: MockAudioContext.instances.at(-1).closeCount };

		const decodeSpeak = deferred();
		speakDeferred.set("decode-session", decodeSpeak);
		startQueue.push({ id: "decode-session" });
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(10); });
		decodeFailure = true;
		const decodeTrack = track("decode-output");
		await act(async () => {
			MockPeer.instances.at(-1).ontrack({ track: decodeTrack, streams: [{}] });
			await flush();
		});
		const decodeReject = {
			state: state(renderer),
			title: button(renderer).props.title,
			deletes: requests.filter((item) => item.url === "/api/chat/speech/sessions/decode-session" && item.method === "DELETE").length,
		};

		const staleSwitch = deferred();
		startQueue.push({ deferred: staleSwitch });
		await act(async () => { button(renderer).props.onClick(clickEvent()); await flush(); });
		await act(async () => {
			renderer.update(React.createElement(MessageSpeechButton, { text: "second", scopeKey: "ps-two:row" }));
			await flush();
		});
		staleSwitch.resolve(response(session("switched-session"), 201));
		await act(async () => { await flush(10); });
		const switchContract = {
			state: state(renderer),
			deletes: requests.filter((item) => item.url === "/api/chat/speech/sessions/switched-session" && item.method === "DELETE").length,
		};

		await act(async () => { renderer.unmount(); await flush(); });
		const unmountCleanup = {
			peersClosed: MockPeer.instances.every((peer) => peer.closeCount === 1),
			contextsClosed: MockAudioContext.instances.every((context) => context.closeCount === 1),
			localTracksStopped: MockAudioContext.instances.every((context) => context.localTrack.stopCount === 1),
		};

		const concurrentSpeakA = deferred();
		const concurrentSpeakB = deferred();
		speakDeferred.set("concurrent-a", concurrentSpeakA);
		speakDeferred.set("concurrent-b", concurrentSpeakB);
		startQueue.push({ id: "concurrent-a" }, { id: "concurrent-b" });
		let concurrent;
		await act(async () => {
			concurrent = create(React.createElement(React.Fragment, null,
				React.createElement(MessageSpeechButton, { text: "A", scopeKey: "a" }),
				React.createElement(MessageSpeechButton, { text: "B", scopeKey: "b" }),
			));
		});
		await act(async () => {
			button(concurrent, 0).props.onClick(clickEvent());
			button(concurrent, 1).props.onClick(clickEvent());
			await flush(10);
		});
		const concurrentPeers = MockPeer.instances.slice(-2);
		await act(async () => {
			concurrentPeers[0].channel.emit("output_transcript.added");
			concurrentPeers[1].channel.emit("output_transcript.added");
			await flush();
		});
		const bothPlaying = [state(concurrent, 0), state(concurrent, 1)];
		await act(async () => { button(concurrent, 0).props.onClick(clickEvent()); await flush(); });
		const independentStop = [state(concurrent, 0), state(concurrent, 1)];
		await act(async () => { concurrent.unmount(); await flush(); });
		concurrentSpeakA.resolve(response(undefined, 204));
		concurrentSpeakB.resolve(response(undefined, 204));

		console.log(JSON.stringify({
			idleContract,
			loadingContract,
			cancelledState,
			lateDeleteCount,
			retryContract,
			playingContract,
			stopContract,
			playReject,
			decodeReject,
			switchContract,
			unmountCleanup,
			bothPlaying,
			independentStop,
			createdUrls: createdUrls.length,
			revokedUrls: revokedUrls.length,
		}));
	`);

	assert.deepEqual(result.idleContract, { label: "Read message aloud", busy: false, disabled: false });
	assert.deepEqual(result.loadingContract, { state: "loading", label: "Cancel message audio", busy: true });
	assert.equal(result.cancelledState, "idle");
	assert.equal(result.lateDeleteCount, 1);
	assert.deepEqual(result.retryContract, { state: "error", label: "Retry message audio", alerts: 1 });
	assert.deepEqual(result.playingContract, { state: "playing", label: "Stop message audio", sources: 1 });
	assert.deepEqual(result.stopContract, { state: "idle", deletes: 1, sourceStops: 1 });
	assert.deepEqual(result.playReject, { state: "error", title: "Audio playback was rejected", closed: 1 });
	assert.deepEqual(result.decodeReject, { state: "error", title: "Audio stream decode failed", deletes: 1 });
	assert.deepEqual(result.switchContract, { state: "idle", deletes: 1 });
	assert.deepEqual(result.unmountCleanup, { peersClosed: true, contextsClosed: true, localTracksStopped: true });
	assert.deepEqual(result.bothPlaying, ["playing", "playing"]);
	assert.deepEqual(result.independentStop, ["idle", "playing"]);
	assert.equal(result.createdUrls, 0);
	assert.equal(result.revokedUrls, 0);
});

test("speech settings distinguish catalog empty, failure, unknown, and unconfigured providers", async () => {
	const result = await runTsxScenario(String.raw`
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
		import { SettingsView } from "./src/apps/chat-ui/src/settings/SettingsView.tsx";

		const { act, create } = TestRenderer;
		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
		function textOf(value) {
			if (typeof value === "string" || typeof value === "number") return String(value);
			if (Array.isArray(value)) return value.map(textOf).join("");
			if (value?.children) return textOf(value.children);
			if (value?.props) return textOf(value.props.children);
			return "";
		}
		const baseSettings = {
			timezone: "UTC",
			shortcuts: { webAnnotationsToggle: "Alt+Shift+A" },
			transcription: { providerId: "openai-chatgpt" },
			speech: { providerId: "openai-codex" },
			telemetryRetention: { enabled: true, days: 30 },
		};
		async function renderScenario(kind) {
			globalThis.fetch = async (path) => {
				if (String(path) === "/api/chat/user-settings") {
					const selected = kind === "unknown" ? "missing-provider" : "openai-codex";
					return new Response(JSON.stringify({ userSettings: { ...baseSettings, speech: { providerId: selected } } }), { status: 200 });
				}
				if (String(path) !== "/api/chat/speech/providers") throw new Error("Unexpected fetch " + path);
				if (kind === "failure") return new Response(JSON.stringify({ error: "Speech catalog failed" }), { status: 503 });
				const providers = kind === "empty" ? [] : [{
					id: kind === "unknown" ? "other-provider" : "openai-codex",
					name: kind === "unconfigured" ? "OpenAI Codex Subscription" : "Configured Speech",
					configured: kind !== "unconfigured",
					description: "Provider description",
				}];
				return new Response(JSON.stringify({ providers, selectedProviderId: kind === "unknown" ? "missing-provider" : "openai-codex" }), { status: 200 });
			};
			const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
			let renderer;
			await act(async () => {
				renderer = create(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(SettingsView, {
					activePanel: "speech",
					showThinking: true,
					setShowThinking() {},
					expandThinking: false,
					setExpandThinking() {},
					onModelDefaultsChanged() {},
					onPiPackageChanged() {},
					onPiPackageRemoved() {},
					onUserSkillChanged() {},
					onUserSkillRemoved() {},
				})));
			});
			await act(async () => { await flush(50); });
			const select = renderer.root.findByType("select");
			const options = renderer.root.findAllByType("option").map((option) => ({ value: option.props.value, disabled: option.props.disabled ?? false, text: textOf(option) }));
			const value = { text: textOf(renderer.toJSON()), disabled: select.props.disabled, options };
			await act(async () => { renderer.unmount(); await flush(); });
			queryClient.clear();
			return value;
		}
		const values = {};
		for (const kind of ["empty", "failure", "unknown", "unconfigured"]) values[kind] = await renderScenario(kind);
		console.log(JSON.stringify(values));
	`);

	assert.match(result.empty.text, /No speech providers are registered/);
	assert.doesNotMatch(result.empty.text, /Speech catalog failed/);
	assert.equal(result.empty.disabled, true);
	assert.match(result.failure.text, /Speech catalog failed/);
	assert.doesNotMatch(result.failure.text, /No speech providers are registered/);
	assert.match(result.unknown.text, /missing-provider \(unavailable\)/);
	assert.match(result.unknown.text, /selected speech provider is unavailable/i);
	assert.equal(result.unknown.options[0].value, "missing-provider");
	assert.match(result.unconfigured.text, /requires authentication before it can read messages aloud/);
	assert.equal(result.unconfigured.options[0].disabled, true);
	assert.match(result.unconfigured.text, /independently from transcription, chat-model providers, and future preview settings/);
});

test("speech controls coexist with current terminal image, fork, trace, and route contracts", async () => {
	const [button, terminal, trace, routes, main, sidebar, settings] = await Promise.all([
		readFile("src/apps/chat-ui/src/components/MessageSpeechButton.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/tracing/SpanNode.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/app-routes.ts", "utf8"),
		readFile("src/apps/chat-ui/src/main.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/settings/SettingsSidebar.tsx", "utf8"),
		readFile("src/apps/chat-ui/src/settings/SettingsView.tsx", "utf8"),
	]);

	assert.match(button, /aria-label=\{label\}/);
	assert.match(button, /aria-busy=\{state === "loading"\}/);
	assert.match(button, /role="alert"/);
	assert.match(button, /AbortController/);
	assert.match(button, /requestIdRef/);
	assert.match(button, /stopChatSpeechSession\(session\.sessionId\)/);
	assert.match(button, /outputTracks/);
	assert.match(button, /inputSource\.stop\(\)/);
	assert.match(terminal, /TerminalImageDialog/);
	assert.match(terminal, /MessageForkButton/);
	assert.match(terminal, /MessageSpeechButton/);
	assert.match(terminal, /View image preview/);
	assert.match(terminal, /isInteractiveEventTarget/);
	assert.match(trace, /SpanHeaderActions[\s\S]*SpanHeaderTiming/);
	assert.match(trace, /MessageSpeechButton/);
	assert.match(routes, /part === "speech"/);
	assert.match(routes, /panel === "speech"/);
	assert.match(main, /path: "settings\/speech"/);
	assert.match(main, /settingsSpeechRoute/);
	assert.match(sidebar, /onSelect\("speech"\)/);
	assert.match(settings, /patchUserSettings\(\{ speech: \{ providerId \} \}\)/);
	assert.match(settings, /independently from transcription/);
});
