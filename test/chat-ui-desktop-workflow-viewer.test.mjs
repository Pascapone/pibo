import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("desktop workflow version tab renders the exact deep-link viewer", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { DesktopWorkflowVersionPanel, desktopWorkflowVersionSelection } from "./src/apps/chat-ui/src/desktop-workflow-version-panel.tsx";
		import { chatNavigationRequest, chatRouteFromLocation } from "./src/apps/chat-ui/src/app-routes.ts";
		import { workflowVersionViewerPath } from "./src/apps/chat-ui/src/workflows/workflow-routes.ts";
		globalThis.React = React;

		const path = workflowVersionViewerPath("wf/deep", "v 7");
		assert.equal(path, "/apps/chat/workflows/view/wf%2Fdeep/v%207");
		const route = chatRouteFromLocation(path, {});
		assert.deepEqual(route, { area: "workflows", viewWorkflowId: "wf/deep", viewWorkflowVersion: "v 7" });
		assert.deepEqual(chatNavigationRequest(route, false, "terminal"), {
			to: "/workflows/view/$workflowId/$workflowVersion",
			params: { workflowId: "wf/deep", workflowVersion: "v 7" },
			replace: false,
		});

		const selection = desktopWorkflowVersionSelection(route);
		assert.deepEqual(selection, { workflowId: "wf/deep", workflowVersion: "v 7" });
		const markup = renderToStaticMarkup(React.createElement(DesktopWorkflowVersionPanel, selection));
		assert.equal(markup.includes("Loading workflow viewer wf/deep@v 7"), true);
		assert.doesNotMatch(markup, /Open a draft to start authoring/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
		cwd: process.cwd(),
		maxBuffer: 4 * 1024 * 1024,
	});
});
