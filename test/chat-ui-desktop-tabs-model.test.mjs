import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("desktop tabs model covers dedupe, close focus, reorder, persistence, and route reconciliation", async () => {
	const script = `
		import assert from "node:assert/strict";
		const model = await import("./src/apps/chat-ui/src/desktop-tabs-model.ts");
		let state = model.emptyDesktopTabState();
		state = model.openDesktopTab(state, { kind: "route", route: { area: "projects" } }, { id: "projects", now: 1 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "vscode" } }, { id: "vscode", now: 2 });
		state = model.openDesktopTab(state, { kind: "session-tool", tool: "preview" }, { id: "preview", now: 3 });
		assert.deepEqual(state.tabs.map((tab) => tab.id), ["projects", "vscode", "preview"]);
		assert.equal(state.activeTabId, "preview");

		state = model.openDesktopTab(state, { kind: "route", route: { area: "projects", projectId: "p-1" } }, { id: "project-1", now: 4 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "projects", projectId: "p-2" } }, { id: "project-2", now: 5 });
		assert.equal(state.tabs.filter((tab) => tab.target.kind === "route" && tab.target.route.area === "projects").length, 3);

		state = model.openDesktopTab(state, { kind: "route", route: { area: "settings", panel: "general" } }, { id: "settings", now: 6 });
		state = model.openDesktopTab(state, { kind: "route", route: { area: "settings", panel: "providers" } }, { id: "duplicate-settings", now: 7 });
		assert.equal(state.tabs.filter((tab) => tab.target.kind === "route" && tab.target.route.area === "settings").length, 1);
		assert.equal(model.activeDesktopTab(state).target.route.panel, "providers");

		state = model.activateDesktopTab(state, "vscode", 8);
		state = model.closeDesktopTab(state, "vscode");
		assert.equal(state.activeTabId, "preview", "close focuses the right neighbor");
		state = model.moveDesktopTab(state, "preview", 1);
		assert.equal(state.tabs.at(2).id, "preview");
		state = model.reorderDesktopTab(state, "preview", 0);
		assert.equal(state.tabs[0].id, "preview");
		const withoutInactive = model.closeDesktopTab(state, "projects");
		assert.equal(withoutInactive.activeTabId, state.activeTabId, "closing an inactive tab keeps focus");
		let one = model.openDesktopTab(model.emptyDesktopTabState(), { kind: "session-tool", tool: "preview" }, { id: "only", now: 1 });
		one = model.closeDesktopTab(one, "only");
		assert.equal(one.activeTabId, null);
		assert.deepEqual(one.tabs, []);

		state = model.resizeDesktopTabs(state, 5_000);
		assert.equal(state.width, model.DESKTOP_TAB_MAX_WIDTH);
		state = { ...state, collapsed: true };
		const restored = model.parseDesktopTabState(model.serializeDesktopTabState(state));
		assert.deepEqual(restored.tabs.map((tab) => tab.id), state.tabs.map((tab) => tab.id));
		assert.equal(restored.collapsed, true);
		assert.equal(restored.width, model.DESKTOP_TAB_MAX_WIDTH);
		assert.deepEqual(model.parseDesktopTabState("broken"), model.emptyDesktopTabState());

		const beforeSessions = restored;
		assert.equal(model.reconcileDesktopRoute(beforeSessions, { area: "sessions", piboSessionId: "ps_1" }), beforeSessions);
		const routed = model.reconcileDesktopRoute(beforeSessions, { area: "agents" }, { id: "agents", now: 9 });
		assert.equal(model.activeDesktopTab(routed).target.route.area, "agents");
		for (const area of ["projects", "vscode", "workflows", "cron", "loops", "agents", "context", "settings"]) {
			const next = model.reconcileDesktopRoute(model.emptyDesktopTabState(), { area }, { id: area, now: 10 });
			assert.equal(model.activeDesktopTab(next).target.route.area, area);
		}

		const storage = new Map();
		model.writeDesktopTabState(routed, { setItem: (key, value) => storage.set(key, value) });
		assert.equal(model.readDesktopTabState({ getItem: (key) => storage.get(key) ?? null }).activeTabId, routed.activeTabId);
		assert.doesNotThrow(() => model.writeDesktopTabState(routed, { setItem: () => { throw new Error("blocked"); } }));
		assert.deepEqual(model.readDesktopTabState({ getItem: () => { throw new Error("blocked"); } }), model.emptyDesktopTabState());
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
