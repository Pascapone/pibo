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
		import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
		const calculationPatches = [];
		let tokenCalculation = { method: "characters", factor: 4 };
		globalThis.fetch = async (path, init = {}) => {
			assert.equal(String(path), "/api/chat/user-settings");
			assert.equal(init.method, "PATCH");
			const body = JSON.parse(init.body);
			calculationPatches.push(body.toolMetrics.tokenCalculation);
			tokenCalculation = body.toolMetrics.tokenCalculation;
			return new Response(JSON.stringify({ userSettings: { toolMetrics: { tokenCalculation } } }), { status: 200 });
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
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
		queryClient.setQueryData(["user-settings"], { toolMetrics: { tokenCalculation } });
		const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
		let renderer;
		await TestRenderer.act(async () => {
			renderer = TestRenderer.create(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(DebugSettingsView, {
				debugMode: false,
				onDebugModeChange: (value) => debugChanges.push(value),
				thresholds: DEFAULT_TOOL_METRIC_THRESHOLDS,
				onThresholdsChange: (value) => thresholdChanges.push(value),
			})));
			await flush(10);
		});
		const method = renderer.root.findByProps({ id: "tool-token-calculation-method" });
		assert.equal(method.props.value, "characters");
		assert.equal(renderer.root.findByProps({ id: "tool-token-character-factor" }).props.value, "4");
		await TestRenderer.act(async () => method.props.onChange({ target: { value: "tiktoken" } }));
		const encoding = renderer.root.findByProps({ id: "tool-token-tiktoken-encoding" });
		await TestRenderer.act(async () => encoding.props.onChange({ target: { value: "p50k_base" } }));
		const saveCalculation = renderer.root.findAllByType("button").find((button) => button.props.children === "Save calculation");
		await TestRenderer.act(async () => { saveCalculation.props.onClick(); await flush(20); });
		assert.deepEqual(calculationPatches.at(-1), { method: "tiktoken", encoding: "p50k_base" });
		assert.ok(renderer.root.findAllByProps({ role: "status" }).some((status) => String(status.props.children).includes("Token calculation saved")));
		await TestRenderer.act(async () => renderer.root.findByProps({ id: "tool-token-calculation-method" }).props.onChange({ target: { value: "characters" } }));
		await TestRenderer.act(async () => renderer.root.findByProps({ id: "tool-token-character-factor" }).props.onChange({ target: { value: "3.5" } }));
		await TestRenderer.act(async () => { saveCalculation.props.onClick(); await flush(20); });
		assert.deepEqual(calculationPatches.at(-1), { method: "characters", factor: 3.5 });
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
		assert.ok(renderer.root.findAllByProps({ role: "status" }).some((status) => String(status.props.children).includes("thresholds saved")));
		await setInput("execution-time-high", "0.2");
		await TestRenderer.act(async () => save.props.onClick());
		assert.equal(thresholdChanges.length, 1);
		assert.ok(renderer.root.findByProps({ role: "alert" }).props.children.includes("increasing"));
		await TestRenderer.act(async () => renderer.unmount());
		queryClient.clear();
	`;
	await assert.doesNotReject(execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() }));
});
