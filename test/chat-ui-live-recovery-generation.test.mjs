import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("selected live recovery is coalesced per session generation and stale failures are fenced", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React, { useRef } from "react";
		import TestRenderer, { act } from "react-test-renderer";
		import { useSessionTraceLiveStream } from "./src/apps/chat-ui/src/tracing/use-session-trace-live-stream.ts";
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const listeners = { window: new Map(), document: new Map() };
		const add = (target, name, listener) => {
			const values = target.get(name) ?? new Set();
			values.add(listener);
			target.set(name, values);
		};
		const remove = (target, name, listener) => target.get(name)?.delete(listener);
		globalThis.window = {
			addEventListener: (name, listener) => add(listeners.window, name, listener),
			removeEventListener: (name, listener) => remove(listeners.window, name, listener),
			setInterval,
			clearInterval,
		};
		globalThis.document = {
			hidden: false,
			visibilityState: "visible",
			addEventListener: (name, listener) => add(listeners.document, name, listener),
			removeEventListener: (name, listener) => remove(listeners.document, name, listener),
		};
		globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
		globalThis.cancelAnimationFrame = clearTimeout;
		class FakeEventSource {
			static instances = [];
			readyState = 1;
			constructor(url) { this.url = url; FakeEventSource.instances.push(this); }
			addEventListener() {}
			close() { this.readyState = 2; }
		}
		globalThis.EventSource = FakeEventSource;
		const requests = new Map();
		const errors = [];
		const calls = [];
		const deferred = () => {
			let resolve, reject;
			const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
			return { promise, resolve, reject };
		};
		for (const id of ["A", "B"]) requests.set(id, { trace: deferred(), bootstrap: deferred() });
		function Harness({ id }) {
			const sequence = useRef(1);
			useSessionTraceLiveStream({
				selectedPiboSessionId: id,
				tracePageData: { piboSessionId: id, eventCount: 0, lastEventSequence: 0, rawEvents: [] },
				currentTraceView: { piboSessionId: id, eventCount: 0, lastEventSequence: 0, rawEvents: [] },
				liveEventSeqRef: sequence,
				selectedSessionStatus: "idle",
				tracePageReady: true,
				setLiveTraceOverlay: () => undefined,
				onRefreshTrace: () => { calls.push("trace:" + id); return requests.get(id).trace.promise; },
				onRefreshBootstrap: () => { calls.push("bootstrap:" + id); return requests.get(id).bootstrap.promise; },
				onError: (message) => { if (message) errors.push(message); },
			});
			return null;
		}
		const fire = (target, name, event = {}) => {
			for (const listener of [...(target.get(name) ?? [])]) listener(event);
		};
		let renderer;
		await act(async () => { renderer = TestRenderer.create(React.createElement(Harness, { id: "A" })); });
		await act(async () => {
			fire(listeners.window, "online");
			fire(listeners.window, "pageshow", { persisted: true });
			fire(listeners.window, "focus");
			fire(listeners.document, "visibilitychange");
		});
		assert.deepEqual(calls, ["trace:A", "bootstrap:A"], "one lifecycle burst starts one recovery pair");

		await act(async () => { renderer.update(React.createElement(Harness, { id: "B" })); });
		await act(async () => { fire(listeners.window, "online"); });
		assert.deepEqual(calls, ["trace:A", "bootstrap:A", "trace:B", "bootstrap:B"], "a hanging A recovery does not block B");

		await act(async () => {
			requests.get("A").trace.reject(new Error("stale A"));
			requests.get("A").bootstrap.resolve();
			await Promise.resolve();
		});
		assert.deepEqual(errors, [], "late A failures cannot set B errors");
		await act(async () => {
			requests.get("B").trace.resolve();
			requests.get("B").bootstrap.resolve();
			await Promise.resolve();
			renderer.unmount();
		});
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
