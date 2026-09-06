import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Debug settings persist validated thresholds and expose the Debug route", async () => {
	const script = String.raw`
		import assert from "node:assert/strict";
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { DebugSettingsView } from "./src/apps/chat-ui/src/settings/DebugSettingsView.tsx";
		import {
			DEFAULT_TOOL_METRIC_THRESHOLDS,
			readStoredToolMetricThresholds,
			writeStoredToolMetricThresholds,
		} from "./src/apps/chat-ui/src/tool-metric-settings.ts";
		import { chatNavigationRequest, chatRouteFromLocation } from "./src/apps/chat-ui/src/app-routes.ts";

		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const stored = new Map();
		globalThis.localStorage = {
			getItem(key) { return stored.get(key) ?? null; },
			setItem(key, value) { stored.set(key, String(value)); },
			removeItem(key) { stored.delete(key); },
		};

		assert.deepEqual(readStoredToolMetricThresholds(), DEFAULT_TOOL_METRIC_THRESHOLDS);
		const custom = {
			durationMs: { elevated: 500, high: 2_000, critical: 8_000 },
			inputTokens: { elevated: 1_000, high: 5_000, critical: 25_000 },
			outputTokens: { elevated: 500, high: 2_000, critical: 10_000 },
		};
		writeStoredToolMetricThresholds(custom);
		assert.deepEqual(readStoredToolMetricThresholds(), custom);
		stored.set("pibo.chat.toolMetricThresholds", JSON.stringify({ durationMs: { elevated: 5, high: 4, critical: 3 } }));
		assert.deepEqual(readStoredToolMetricThresholds(), DEFAULT_TOOL_METRIC_THRESHOLDS);
		assert.deepEqual(chatRouteFromLocation("/settings/debug", {}), { area: "settings", panel: "debug" });
		assert.deepEqual(chatNavigationRequest({ area: "settings", panel: "debug" }, false, "terminal"), { to: "/settings/debug", replace: false });

		const thresholdChanges = [];
		const debugChanges = [];
		let renderer;
		await TestRenderer.act(async () => {
			renderer = TestRenderer.create(React.createElement(DebugSettingsView, {
				debugMode: false,
				onDebugModeChange: (value) => debugChanges.push(value),
				thresholds: DEFAULT_TOOL_METRIC_THRESHOLDS,
				onThresholdsChange: (value) => thresholdChanges.push(value),
			}));
		});
		const debugToggle = renderer.root.findAllByType("button").find((button) => button.props["aria-pressed"] === false);
		await TestRenderer.act(async () => debugToggle.props.onClick());
		assert.deepEqual(debugChanges, [true]);
		const setInput = async (id, value) => {
			const input = renderer.root.findByProps({ id });
			await TestRenderer.act(async () => input.props.onChange({ target: { value } }));
		};
		await setInput("execution-time-elevated", "0.5");
		await setInput("execution-time-high", "2");
		await setInput("execution-time-critical", "8");
		const save = renderer.root.findAllByType("button").find((button) => button.props.children === "Save thresholds");
		await TestRenderer.act(async () => save.props.onClick());
		assert.deepEqual(thresholdChanges.at(-1).durationMs, { elevated: 500, high: 2_000, critical: 8_000 });
		assert.ok(renderer.root.findByProps({ role: "status" }).props.children.includes("saved"));
		await setInput("execution-time-high", "0.2");
		await TestRenderer.act(async () => save.props.onClick());
		assert.equal(thresholdChanges.length, 1);
		assert.ok(renderer.root.findByProps({ role: "alert" }).props.children.includes("increasing"));
		await TestRenderer.act(async () => renderer.unmount());
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
