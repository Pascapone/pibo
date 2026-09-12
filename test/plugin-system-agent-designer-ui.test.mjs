import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
const { AgentPluginsDesigner } = await tsImport("../src/apps/chat-ui/src/agents/AgentPluginsDesigner.tsx", import.meta.url);
const { createBlankAgentDraft } = await tsImport("../src/apps/chat-ui/src/agents/agent-designer-model.ts", import.meta.url);

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const view = { id: "settings", kind: "view", scope: "app", required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "UI" }, view: { title: "Feature", exportName: "Feature", visibility: "infrastructure", instance: "singleton", mount: "unmount", stateSchemaVersion: 1, subviews: [{ id: "preferences", title: "Preferences", purpose: "settings", settingsScopes: ["app", "agent", "session"] }] } };
const tools = ["read", "write"].map((id) => ({ id, name: id, kind: "tool", scope: "agent", required: id === "read", defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Tool" } }));
const entry = { pluginId: "fixture.feature", revision: "pinned", enabled: true, contributions: { read: true, write: false }, config: {} };
const plugin = { pluginId: entry.pluginId, name: "Feature", revision: "pinned", version: "1.0.0", state: "active", enabled: true, initialSelection: entry, contributions: [...tools, view] };
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("rendered plugin toggles preserve mandatory state and exact session/settings scopes; stale preview cannot retarget", async () => {
	const oldFetch = globalThis.fetch; const oldWindow = globalThis.window;
	globalThis.window = { setTimeout, clearTimeout, confirm: () => true };
	let resolveFirst;
	let previewCalls = 0;
	const opened = [];
	let draft = { ...createBlankAgentDraft(), id: "agent_edited", revision: 3, profileName: "edited-agent", pluginSelection: { schemaVersion: 1, plugins: [entry] } };
	let renderer;
	let session = "ps_A";
	const render = () => React.createElement(AgentPluginsDesigner, { draft, readOnly: false, piboSessionId: session, sessionProfileName: "different-agent", onOpenPluginSettings: (target) => opened.push(target), setDraft: (change) => { draft = change(draft); renderer.update(render()); } });
	const plan = (reason) => ({ valid: true, diagnostics: [], nodes: tools.map((tool) => ({ contributionId: `fixture.feature/${tool.id}`, required: tool.required, selected: true, status: "selected", selectionReason: reason })) });
	globalThis.fetch = async (url, init) => {
		if (url === "/api/chat/agent-plugin-catalog") return json({ catalog: { schemaVersion: 1, revision: 1, plugins: [plugin] } });
		assert.equal(url, "/api/chat/agent-plugin-preview");
		const body = JSON.parse(init.body); assert.equal(body.expectedRevision, 3); assert.equal(body.agentId, "agent_edited");
		previewCalls++;
		if (previewCalls === 1) return new Promise((resolve) => { resolveFirst = () => resolve(json({ schemaVersion: 1, plan: plan("STALE-A") })); });
		return json({ schemaVersion: 1, plan: plan("CURRENT-B") });
	};
	try {
		await act(async () => { renderer = create(render()); });
		await act(async () => { await pause(180); });
		const inputs = renderer.root.findAllByType("input");
		assert.equal(inputs.find((item) => item.props["aria-label"] === "Feature: read (required)").props.disabled, true);
		const optional = inputs.find((item) => item.props["aria-label"] === "Feature: write (optional)");
		assert.equal(optional.props.checked, false);
		await act(async () => { optional.props.onChange({ target: { checked: true } }); });
		assert.equal(draft.pluginSelection.plugins[0].contributions.write, true);
		assert.equal(draft.pluginSelection.plugins[0].revision, "pinned");
		await act(async () => { await pause(180); });
		const settingsButtons = renderer.root.findAllByType("button").filter((button) => String(button.props.children).includes("Preferences"));
		assert.equal(settingsButtons.length, 3);
		for (const button of settingsButtons) await act(async () => button.props.onClick());
		assert.deepEqual(opened.map((item) => item.configurationTarget), [
			{ scope: "app", pluginId: "fixture.feature" },
			{ scope: "agent", pluginId: "fixture.feature", agentId: "agent_edited" },
			{ scope: "session", pluginId: "fixture.feature", piboSessionId: "ps_A" },
		]);
		assert.equal(opened.every((item) => item.piboSessionId === "ps_A" && item.viewId === "fixture.feature/settings" && item.subviewId === "preferences"), true);
		const oldSessionClick = settingsButtons[2].props.onClick;
		session = "ps_B";
		await act(async () => renderer.update(render()));
		await act(async () => { resolveFirst(); await pause(0); });
		assert.equal(JSON.stringify(renderer.toJSON()).includes("STALE-A"), false);
		assert.equal(JSON.stringify(renderer.toJSON()).includes("CURRENT-B"), true);
		await act(async () => oldSessionClick());
		assert.equal(opened.at(-1).piboSessionId, "ps_A");
	} finally { if (renderer) await act(async () => renderer.unmount()); globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});
