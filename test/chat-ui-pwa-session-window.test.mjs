import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runPwaSessionWindowScenario() {
	const script = `
		import assert from "node:assert/strict";
		import {
			createPwaSessionWindowTarget,
			isDesktopPwaWindow,
		} from "./src/apps/chat-ui/src/pwa-session-window.ts";

		const desktopNavigator = {
			maxTouchPoints: 0,
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
			userAgentData: { mobile: false },
		};
		const media = (standalone, overlay = false) => (query) => ({
			matches: query.includes("window-controls-overlay") ? overlay : standalone,
		});

		assert.equal(isDesktopPwaWindow(media(true), desktopNavigator), true);
		assert.equal(isDesktopPwaWindow(media(false, true), desktopNavigator), true);
		assert.equal(isDesktopPwaWindow(media(false), desktopNavigator), false);
		assert.equal(isDesktopPwaWindow(media(true), { ...desktopNavigator, userAgentData: { mobile: true } }), false);
		assert.equal(isDesktopPwaWindow(media(true), {
			maxTouchPoints: 5,
			userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel)",
		}), false);
		assert.equal(isDesktopPwaWindow(media(true), {
			maxTouchPoints: 5,
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
		}), false);

		const href = "https://pibo.example/apps/chat/rooms/room-1/sessions/ps-selected?view=terminal";
		assert.deepEqual(createPwaSessionWindowTarget(href, "window-1"), {
			url: href,
			name: "pibo-session-window-1",
			features: "width=1280,height=900",
		});
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("selected-session windows are available only in desktop PWA display modes", async () => {
	await assert.doesNotReject(runPwaSessionWindowScenario());
});

test("SessionTracePane passes the same selected-session window action to normal and fullscreen toolbars", () => {
	const paneSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	const layoutSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-layout.tsx", "utf8");

	assert.match(paneSource, /Boolean\(selectedBackendPiboSessionId\) && canOpenDesktopPwaSessionWindow\(\)/);
	assert.match(paneSource, /openCurrentPwaSessionWindow\(\)/);
	assert.match(paneSource, /onOpenSessionWindow=\{onOpenSessionWindow\}/);
	assert.match(paneSource, /onOpenSessionWindow,/);
	assert.match(layoutSource, /<TerminalFullscreenTopBar[\s\S]*onOpenSessionWindow=\{onOpenSessionWindow\}/);
});
