import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function runOverlayCacheScenario() {
	const script = `
		import assert from "node:assert/strict";
		const {
			reconcileLiveTraceOverlayCache,
			restoreLiveTraceOverlayForSession,
		} = await import("./src/apps/chat-ui/src/tracing/live-overlay.ts");

		const active = {
			piboSessionId: "ps-active",
			events: [{
				id: "optimistic",
				streamId: 8,
				piboSessionId: "ps-active",
				type: "message_steered",
				createdAt: "2026-08-07T02:17:00.000Z",
				payload: { type: "message_steered", piboSessionId: "ps-active", source: "user", text: "Keep it" },
			}],
		};
		const cache = new Map();
		assert.equal(restoreLiveTraceOverlayForSession(cache, active, "ps-idle"), null);
		assert.equal(cache.get("ps-active"), active);
		assert.equal(restoreLiveTraceOverlayForSession(cache, null, "ps-active"), active);

		const idle = { piboSessionId: "ps-idle", events: [] };
		assert.deepEqual(reconcileLiveTraceOverlayCache(cache, idle, {
			piboSessionId: "ps-active",
			piSessionId: "pi-active",
			title: "Active",
			version: 1,
			latestStreamId: 7,
			eventCount: 0,
			eventLimit: 100,
			hasOlderEvents: false,
			rawEvents: [],
			nodes: [],
		}), active);
		assert.equal(cache.get("ps-idle"), idle);

		const baseTrace = {
			piboSessionId: "ps-active",
			piSessionId: "pi-active",
			title: "Active",
			version: 1,
			latestStreamId: 8,
			eventCount: 0,
			eventLimit: 100,
			hasOlderEvents: false,
			rawEvents: [],
			nodes: [],
		};
		assert.equal(reconcileLiveTraceOverlayCache(cache, active, baseTrace), null);
		assert.equal(cache.has("ps-active"), false);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
}

test("session overlay cache restores on navigation and trims confirmed events", async () => {
	await assert.doesNotReject(runOverlayCacheScenario());
});

test("delivery selection closes before awaiting and navigation restores before paint", () => {
	const paneSource = fs.readFileSync("src/apps/chat-ui/src/session-trace-pane.tsx", "utf8");
	assert.match(paneSource, /const sendPlan = pendingSendPlan;\s+setPendingSendPlan\(null\);\s+setDeliverySending\(true\);\s+try \{\s+await deliverComposerSend\(sendPlan, delivery\)/);
	assert.match(paneSource, /rollbackComposerSend\(sendPlan, caught\)/);
	assert.doesNotMatch(paneSource, /await deliverComposerSend\(pendingSendPlan, delivery\)/);

	const pageSource = fs.readFileSync("src/apps/chat-ui/src/tracing/use-session-trace-page.ts", "utf8");
	assert.match(pageSource, /useLayoutEffect\(\(\) => \{\s+const cachedTrace/);
	assert.match(pageSource, /baseTraceViewCacheRef\.current\.set\(current\.piboSessionId, current\)/);
	assert.match(pageSource, /baseTraceViewCacheRef\.current\.get\(selectedPiboSessionId\)/);
	assert.match(pageSource, /restoreLiveTraceOverlayForSession/);
});
