import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as ReactQuery from "@tanstack/react-query";

// C1-R01 fixture support bundle (built by the browser test with real React).
// Provides the host bridge the pilot bundle expects, mounts the REAL pilot
// VscodeView from its built artefact URL, and records console output for CDP
// retrieval. No product gateway, no product session, no real VS Code server.

const consoleLog = [];
for (const level of ["log", "warn", "error"]) {
	const original = console[level].bind(console);
	console[level] = (...args) => {
		consoleLog.push({ level, text: args.map((value) => String(value)).join(" ").slice(0, 2000) });
		original(...args);
	};
}

globalThis.__C1_CONSOLE__ = consoleLog;
globalThis.__C1_CALLS__ = [];
globalThis.__PIBO_BROWSER_PLUGIN_BRIDGE__ = { React: React.default ?? React, ReactDOM: ReactDOM.default ?? ReactDOM, ReactQuery };

function viewProps(signal, calls) {
	return {
		tab: {
			instanceId: "tab-fixture-1",
			piboSessionId: "ps_fixture",
			pluginId: "pibo.vscode-web",
			viewId: "pibo.vscode-web/view",
			pluginRevision: "fixture",
			stateSchemaVersion: 1,
			state: {},
			fallback: "VS Code Web unavailable",
		},
		piboSessionId: "ps_fixture",
		active: true,
		signal,
		state: {},
		updateState: (state) => { calls.push({ stub: "updateState", state }); },
		request: async (path) => { calls.push({ stub: "request", path }); throw new Error(`no fixture request backend for ${path}`); },
		openView: (viewId, subviewId) => { calls.push({ stub: "openView", viewId, subviewId }); },
		registerBeforeLeave: (handler) => {
			calls.push({ stub: "registerBeforeLeave" });
			return () => { calls.push({ stub: "unregisterBeforeLeave" }); };
		},
	};
}

const fixture = {
	controller: null,
	root: null,
	async mount(pilotUrl) {
		if (this.root) throw new Error("fixture already mounted");
		this.controller = new AbortController();
		const pilot = await import(pilotUrl);
		if (typeof pilot.VscodeView !== "function") throw new Error("pilot bundle does not export VscodeView");
		this.root = createRoot(document.getElementById("root"));
		this.root.render(React.createElement(pilot.VscodeView, viewProps(this.controller.signal, globalThis.__C1_CALLS__)));
		return true;
	},
	unmount() {
		this.root?.unmount();
		this.root = null;
		return document.getElementById("root").innerHTML;
	},
	abort() {
		this.controller?.abort();
		return true;
	},
};

globalThis.__C1_FIXTURE__ = fixture;
