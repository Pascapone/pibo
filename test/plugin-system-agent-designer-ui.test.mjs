import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import TestRenderer from "react-test-renderer";
const { AgentPluginsDesigner } = await tsImport("../src/apps/chat-ui/src/agents/AgentPluginsDesigner.tsx", import.meta.url);
const { createBlankAgentDraft } = await tsImport("../src/apps/chat-ui/src/agents/agent-designer-model.ts", import.meta.url);

globalThis.React = React;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = TestRenderer;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tools = ["read", "write"].map((id) => ({ id, name: id, title: id === "read" ? "Read files" : "Write files", kind: "tool", scope: "agent", required: id === "read", defaultEnabled: true, schemaVersion: 1, context: { kind: "none", reason: "Tool" } }));
const entry = { pluginId: "fixture.feature", revision: "pinned", enabled: true, contributions: { read: true, write: false }, config: {} };
const plugin = { pluginId: entry.pluginId, name: "Feature", revision: "pinned", version: "1.0.0", state: "active", enabled: true, initialSelection: entry, contributions: tools };
const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("Agent Designer has one scroll owner and cannot programmatically scroll its containing pane", async () => {
	const [agentsSource, pluginsSource, workspaceSource] = await Promise.all([
		readFile(new URL("../src/apps/chat-ui/src/agents/AgentsView.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/apps/chat-ui/src/agents/AgentPluginsDesigner.tsx", import.meta.url), "utf8"),
		readFile(new URL("../src/apps/chat-ui/src/plugins/plugin-workspace.tsx", import.meta.url), "utf8"),
	]);
	assert.match(agentsSource, /data-pibo-debug="agent-designer-root"[^>]*overflow-clip/);
	assert.match(agentsSource, /data-pibo-debug="agent-designer-main"/);
	assert.doesNotMatch(pluginsSource, /scrollIntoView/);
	assert.match(workspaceSource, /min-h-0 flex-1 overflow-clip/);
});

test("blocked automatic migration is explained without a regular review or apply flow", async () => {
	const oldFetch = globalThis.fetch; const oldWindow = globalThis.window;
	globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: (callback) => callback(), confirm: () => true };
	const report = { schemaVersion: 1, status: "conflict", sourceHash: "source-hash", selection: { schemaVersion: 1, plugins: [entry] }, before: ["fixture.feature/read"], after: [], beforeTools: ["read"], afterTools: [], mcpServers: ["filesystem"], userSkills: ["personal-skill"], userContextFiles: ["personal-context"], resourceSnapshots: [], inactivePiPackages: [], diagnostics: [{ code: "legacy-owner-unknown", severity: "error", message: "Owner is unresolved", path: ["agent_legacy"] }] };
	const legacyDraft = { ...createBlankAgentDraft(), id: "agent_legacy", revision: 8, profileName: "legacy-agent", pluginSelection: report.selection, pluginMigration: report };
	let renderer;
	globalThis.fetch = async (url) => {
		if (url === "/api/chat/agent-plugin-catalog") return json({ catalog: { schemaVersion: 1, revision: 1, plugins: [plugin] } });
		throw new Error(`unexpected request ${url}`);
	};
	try {
		await act(async () => { renderer = create(React.createElement(AgentPluginsDesigner, { draft: legacyDraft, setDraft: () => undefined, readOnly: false })); await pause(0); });
		const rendered = JSON.stringify(renderer.toJSON());
		assert.match(rendered, /Automatic Pibo 4\.0 migration is blocked/);
		assert.match(rendered, /Owner is unresolved/);
		assert.equal(rendered.includes("Review previous selection"), false);
		assert.equal(rendered.includes("Migrate this exact selection"), false);
	} finally { if (renderer) await act(async () => renderer.unmount()); globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});

test("plugin cards start collapsed, categorize only agent contributions, and preserve required/optional state", async () => {
	const oldFetch = globalThis.fetch; const oldWindow = globalThis.window;
	globalThis.window = { setTimeout, clearTimeout, requestAnimationFrame: (callback) => callback(), confirm: () => true };
	let resolveFirst;
	let previewCalls = 0;
	let draft = { ...createBlankAgentDraft(), id: "agent_edited", revision: 3, profileName: "edited-agent", pluginSelection: { schemaVersion: 1, plugins: [entry] } };
	let renderer;
	const render = () => React.createElement(AgentPluginsDesigner, { draft, readOnly: false, setDraft: (change) => { draft = change(draft); renderer.update(render()); } });
	const plan = (reason) => ({ valid: true, diagnostics: [], nodes: tools.map((tool) => ({ contributionId: `fixture.feature/${tool.id}`, required: tool.required, selected: tool.id === "read", status: "selected", selectionReason: reason })) });
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
		const expander = renderer.root.findAllByType("button").find((button) => button.props["aria-expanded"] === false);
		assert.ok(expander);
		assert.equal(renderer.root.findAllByType("input").length, 0);
		assert.equal(JSON.stringify(renderer.toJSON()).includes("Tools"), false);
		await act(async () => expander.props.onClick());
		assert.equal(JSON.stringify(renderer.toJSON()).includes("Tools"), true);
		const inputs = renderer.root.findAllByType("input");
		assert.equal(inputs.find((item) => item.props["aria-label"] === "Feature: Read files (required)").props.disabled, true);
		const optional = inputs.find((item) => item.props["aria-label"] === "Feature: Write files (optional)");
		assert.equal(optional.props.checked, false);
		await act(async () => { optional.props.onChange({ target: { checked: true } }); });
		assert.equal(draft.pluginSelection.plugins[0].contributions.write, true);
		assert.equal(draft.pluginSelection.plugins[0].revision, "pinned");
		await act(async () => { await pause(180); });
		await act(async () => { resolveFirst(); await pause(0); });
		assert.equal(JSON.stringify(renderer.toJSON()).includes("STALE-A"), false);
		assert.equal(JSON.stringify(renderer.toJSON()).includes("CURRENT-B"), true);
		assert.equal(JSON.stringify(renderer.toJSON()).includes("Preferences"), false);
	} finally { if (renderer) await act(async () => renderer.unmount()); globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
});
