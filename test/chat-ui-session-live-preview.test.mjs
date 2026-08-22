import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("live preview panel keeps the iframe isolated and exposes trusted controls", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { PreviewFullscreenTopBar, SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		globalThis.React = React;
		const preview = {
			id: "pv-ui", piboSessionId: "ps_ui", label: "Website", targetHost: "127.0.0.1", targetPort: 5173,
			workspace: "/workspace", createdAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-23T00:00:00.000Z",
			state: "active", health: "online", publicUrl: "https://pv-ui.preview.test/", openUrl: "/api/previews/pv-ui/open",
		};
		const noop = () => {};
		const panel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			previews: [preview], selectedPreview: preview, loading: false, reloadKey: 1,
			onSelect: noop, onReload: noop, onRefresh: noop, onClose: noop, onEnterFullscreen: noop,
		}));
		assert.match(panel, /data-pibo-debug="session-live-preview"/);
		assert.match(panel, /data-pibo-debug="session-live-preview-frame"/);
		assert.match(panel, /sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock"/);
		assert.match(panel, /referrerPolicy="no-referrer"/);
		assert.match(panel, /aria-label="Enter Preview fullscreen"/);
		assert.match(panel, /aria-label="Close live preview"/);
		const topBar = renderToStaticMarkup(React.createElement(PreviewFullscreenTopBar, { preview, onReload: noop, onExit: noop }));
		assert.match(topBar, /data-pibo-debug="preview-fullscreen-top-bar"/);
		assert.match(topBar, /aria-label="Exit Preview fullscreen"/);
		assert.match(topBar, />Website</);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("session trace integrates Preview as a session and Project view with trusted fullscreen content", () => {
	const pane = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	const layout = readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
	assert.match(pane, /getSessionLivePreviews/);
	assert.match(pane, /id: "preview"/);
	assert.match(pane, /<SessionLivePreviewPanel/);
	assert.match(pane, /<PreviewFullscreenTopBar/);
	assert.match(layout, /fullscreenTopBar/);
	assert.match(layout, /fullscreenContent/);
	assert.match(layout, /hideComposer \? null : <Composer/);
});
