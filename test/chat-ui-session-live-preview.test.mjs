import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("Preview authority rejects stale session data, errors, and configured emptiness", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { resolveSessionLivePreviewAuthority, selectAuthoritativeLivePreview, requirePreviewActionAuthority } = await import("./src/apps/chat-ui/src/session-live-preview-authority.ts");
		const previewA = { id: "pv-a", piboSessionId: "ps_a" };
		const previewB = { id: "pv-b", piboSessionId: "ps_b" };
		const stale = resolveSessionLivePreviewAuthority({
			selectedPiboSessionId: "ps_b",
			data: { piboSessionId: "ps_a", configured: true, previews: [previewA] },
			loading: true,
		});
		assert.equal(stale.kind, "loading");
		assert.deepEqual(stale.previews, []);
		assert.equal(selectAuthoritativeLivePreview(stale, { piboSessionId: "ps_a", previewId: "pv-a" }), undefined);
		const failed = resolveSessionLivePreviewAuthority({
			selectedPiboSessionId: "ps_b",
			data: { piboSessionId: "ps_a", configured: true, previews: [previewA] },
			loading: false,
			error: "current session failed",
		});
		assert.equal(failed.kind, "error");
		assert.deepEqual(failed.previews, []);
		assert.equal(resolveSessionLivePreviewAuthority({ selectedPiboSessionId: "ps_b", data: { piboSessionId: "ps_b", configured: false, previews: [] }, loading: false }).kind, "unconfigured");
		assert.equal(resolveSessionLivePreviewAuthority({ selectedPiboSessionId: "ps_b", data: { piboSessionId: "ps_b", configured: true, previews: [] }, loading: false }).kind, "empty");
		const ready = resolveSessionLivePreviewAuthority({ selectedPiboSessionId: "ps_b", data: { piboSessionId: "ps_b", configured: true, previews: [previewB] }, loading: false });
		assert.equal(selectAuthoritativeLivePreview(ready, { piboSessionId: "ps_a", previewId: "pv-a" }).id, "pv-b");
		assert.throws(() => requirePreviewActionAuthority("ps_b", previewA), /different Pibo Session/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("live preview panel keeps the iframe isolated and exposes trusted lifecycle controls", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { PreviewFullscreenTopBar, SessionLivePreviewPanel } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		globalThis.React = React;
		globalThis.window = { location: { origin: "https://chat.example.test" }, open() {}, setTimeout() {} };
		const external = {
			id: "pv-ui", piboSessionId: "ps_ui", label: "Website", managed: false,
			createdAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-23T00:00:00.000Z",
			state: "active", health: "online", publicUrl: "https://pv-ui.preview.test/", openUrl: "/api/previews/pv-ui/open",
		};
		const noop = () => {};
		const props = { onSelect: noop, onReload: noop, onRefresh: noop, onStart: noop, onStop: noop, onRemove: noop };
		const panel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [external], selectedPreview: external, loading: false, reloadKey: 1, onEnterFullscreen: noop,
		}));
		assert.match(panel, /data-pibo-preview-session-id="ps_ui"/);
		assert.ok(panel.includes('data-pibo-preview-public-origin="https://pv-ui.preview.test"'));
		assert.match(panel, /data-pibo-debug="session-live-preview-frame"/);
		assert.match(panel, /sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-modals allow-popups allow-pointer-lock"/);
		assert.match(panel, /referrerPolicy="no-referrer"/);
		assert.match(panel, /aria-label="Enter Preview fullscreen"/);
		assert.match(panel, /aria-label="Remove live preview"/);
		assert.doesNotMatch(panel, /Start Preview server|Stop Preview server/);

		const stopped = { ...external, id: "pv-managed", managed: true, serverState: "stopped", health: "stopped" };
		const stoppedPanel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [stopped], selectedPreview: stopped, loading: false, reloadKey: 0,
		}));
		assert.doesNotMatch(stoppedPanel, /data-pibo-debug="session-live-preview-frame"/);
		assert.match(stoppedPanel, /aria-label="Start Preview server"/);
		assert.match(stoppedPanel, /Start server/);
		assert.doesNotMatch(stoppedPanel, /startCommand|workspace|managerPid|serverGeneration/);

		const running = { ...stopped, serverState: "running", health: "online", serverStopAt: "2026-08-23T00:10:00.000Z" };
		const runningPanel = renderToStaticMarkup(React.createElement(SessionLivePreviewPanel, {
			...props, previews: [running], selectedPreview: running, loading: false, reloadKey: 0,
		}));
		assert.match(runningPanel, /aria-label="Stop Preview server"/);
		assert.match(runningPanel, /data-pibo-debug="session-live-preview-frame"/);

		const topBar = renderToStaticMarkup(React.createElement(PreviewFullscreenTopBar, {
			preview: running, onReload: noop, onStart: noop, onStop: noop, onExit: noop,
		}));
		assert.match(topBar, /data-pibo-debug="preview-fullscreen-top-bar"/);
		assert.match(topBar, /aria-label="Stop Preview server"/);
		assert.match(topBar, /aria-label="Exit Preview fullscreen"/);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("Preview fullscreen restores focus after Escape, click, and session replacement", async () => {
	const script = `
		import assert from "node:assert/strict";
		import React from "react";
		import TestRenderer from "react-test-renderer";
		import { PreviewFullscreenTopBar } from "./src/apps/chat-ui/src/session-live-preview.tsx";
		const { act, create } = TestRenderer;
		globalThis.React = React;
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		class MockElement {
			constructor(name, documentMock) { this.name = name; this.documentMock = documentMock; this.isConnected = true; this.focusCount = 0; }
			focus() { this.focusCount += 1; this.documentMock.activeElement = this; }
		}
		globalThis.HTMLElement = MockElement;
		const preview = {
			id: "pv-focus", piboSessionId: "ps_focus", label: "Focus Preview", managed: true,
			createdAt: "2026-08-22T00:00:00.000Z", expiresAt: "2026-08-23T00:00:00.000Z",
			state: "active", health: "online", serverState: "running",
			publicUrl: "https://pv-focus.preview.test/", openUrl: "/api/previews/pv-focus/open",
		};
		async function scenario(trigger) {
			const listeners = new Map();
			const timers = [];
			const documentMock = { activeElement: undefined, queryResult: undefined,
				querySelector(selector) {
					assert.equal(selector, '[data-pibo-debug="session-live-preview"] [aria-label="Enter Preview fullscreen"]');
					return this.queryResult;
				},
			};
			const prior = new MockElement("prior", documentMock);
			const enter = new MockElement("enter-current-session", documentMock);
			const exit = new MockElement("exit", documentMock);
			documentMock.activeElement = prior;
			documentMock.queryResult = enter;
			globalThis.document = documentMock;
			globalThis.window = {
				location: { origin: "https://chat.example.test" },
				open() {},
				addEventListener(type, listener) { listeners.set(type, listener); },
				removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
				setTimeout(callback) { timers.push(callback); return timers.length; },
			};
			let exits = 0;
			let renderer;
			await act(async () => {
				renderer = create(React.createElement(PreviewFullscreenTopBar, {
					preview, onReload() {}, onStart() {}, onStop() {}, onExit() { exits += 1; },
				}), {
					createNodeMock(element) {
						return element.props?.["aria-label"] === "Exit Preview fullscreen"
							? exit
							: new MockElement("host", documentMock);
					},
				});
			});
			assert.equal(exit.focusCount, 1, "fullscreen entry must focus the exit control");
			if (trigger === "escape") {
				const event = { key: "Escape", prevented: false, preventDefault() { this.prevented = true; } };
				await act(async () => listeners.get("keydown")(event));
				assert.equal(event.prevented, true);
				assert.equal(exits, 1);
			} else if (trigger === "click") {
				await act(async () => renderer.root.findByProps({ "aria-label": "Exit Preview fullscreen" }).props.onClick());
				assert.equal(exits, 1);
			}
			await act(async () => renderer.unmount());
			assert.equal(listeners.has("keydown"), false);
			for (const callback of timers.splice(0)) callback();
			assert.equal(enter.focusCount, 1, "cleanup must focus the current session's newly mounted Enter control");
			assert.equal(prior.focusCount, 0, "cleanup must not return focus to an unmounted stale control");
		}
		await scenario("escape");
		await scenario("click");
		await scenario("session-replacement");
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});

test("Session and Project trace panes scope lifecycle state and fullscreen to the selected Pibo Session", () => {
	const pane = readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	const layout = readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");
	const preview = readFileSync("src/apps/chat-ui/src/session-live-preview.tsx", "utf8");
	assert.match(pane, /selectedPreviewSessionRef\.current = selectedBackendPiboSessionId/);
	assert.match(pane, /resolveSessionLivePreviewAuthority/);
	assert.match(pane, /requirePreviewActionAuthority/);
	assert.match(pane, /queryClient\.setQueryData<SessionLivePreviewQueryEnvelope>/);
	assert.match(pane, /id: "preview"/);
	assert.match(pane, /<SessionLivePreviewPanel/);
	assert.match(pane, /<PreviewFullscreenTopBar/);
	assert.match(layout, /fullscreenTopBar/);
	assert.match(layout, /fullscreenContent/);
	assert.match(layout, /hideComposer \? null : <Composer/);
	assert.match(preview, /window\.addEventListener\("keydown", handleKeyDown, true\)/);
	assert.match(preview, /\[aria-label="Enter Preview fullscreen"\]/);
	assert.match(preview, /window\.setTimeout\(restoreFocus, 0\)/);
});
