import assert from "node:assert/strict";
import test from "node:test";
import { CdpClient } from "../dist/tools/cdp-client.js";

// Opt-in: this test creates disposable Rooms in the worker's authenticated browser.
const cdpUrl = process.env.PIBO_TEST_CDP_URL;
test("Terminal reveals correctly positioned histories without a fixed hidden interval", { skip: !cdpUrl, timeout: 90_000 }, async (t) => {
	assert.equal(process.env.PIBO_COMPUTE_WORKER, "1", "run browser mutation checks inside a Docker worker");
	const targets = await (await fetch(`${cdpUrl}/json/list`)).json();
	const target = targets.find((entry) => entry.type === "page" && new URL(entry.url).pathname.startsWith("/apps/chat"));
	assert.ok(target, "an authenticated headful Chat target is required");
	const origin = new URL(target.url).origin;
	assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "use the worker-local app, not a public deployment");
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	const post = (path, body, method = "POST") => client.evaluate(`(async () => {
		const response = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} });
		const data = await response.json();
		if (!response.ok) throw new Error(JSON.stringify(data));
		return data;
	})()`);
	async function waitFor(expression) {
		for (let attempt = 0; attempt < 200; attempt++) {
			try { if (await client.evaluate(expression)) return; } catch { /* Navigation replaces the evaluation context. */ }
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		assert.fail(`Browser condition did not settle: ${expression}`);
	}
	const name = `Terminal visibility regression ${Date.now()}`;
	let room;
	try {
		room = (await post("/api/chat/rooms", { name })).room;
		const empty = (await post("/api/chat/sessions", { roomId: room.id })).session;
		for (const [count, width, height] of [[12, 1431, 908], [300, 1431, 908], [12, 390, 844], [300, 390, 844]]) {
			await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
			await t.test(`${width}px / ${count} completed messages retain the bottom from their first visible frame`, async () => {
				const session = (await post("/api/chat/sessions", { roomId: room.id })).session;
				await client.send("Page.navigate", { url: `${origin}/apps/chat/rooms/${room.id}/sessions/${session.id}?view=terminal&debugStreaming=1` });
				await waitFor(`document.querySelector('[data-pibo-debug="chat-shell"]')?.dataset.piboSessionId === ${JSON.stringify(session.id)} && window.__piboStreamingDebug?.lastReadyState === 1`);
				await post("/api/chat/debug/streaming-fixture", { piboSessionId: session.id, roomId: room.id, preludeMessages: count, preludeOnly: true, traceSnapshots: true });
				const marker = `prelude ${count - 1}`;
				await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.innerText.includes(${JSON.stringify(marker)})`);
				const result = await client.evaluate(`(async () => {
					const sessionId = ${JSON.stringify(session.id)}, emptyId = ${JSON.stringify(empty.id)}, marker = ${JSON.stringify(marker)};
					const samples = [], actions = [];
					const started = performance.now();
					let selected, stopped = false;
					const sample = () => {
						if (stopped) return;
						const terminal = document.querySelector('[data-pibo-debug="compact-terminal-session-view"]');
						const scroller = terminal?.querySelector('[data-virtuoso-scroller]');
						const box = scroller?.getBoundingClientRect();
						const rows = terminal ? [...terminal.querySelectorAll('[data-pibo-debug="terminal-row"]')] : [];
						const visible = rows.filter(row => {
							const bounds = row.getBoundingClientRect();
							return box && getComputedStyle(row).visibility === "visible" && bounds.bottom > box.top && bounds.top < box.bottom;
						});
						samples.push({ ms: performance.now() - started, selected, session: terminal?.dataset.piboSessionId,
							mounted: terminal?.textContent.includes(marker), revealed: terminal?.innerText.includes(marker), visible: visible.length,
							visibleTail: visible.some(row => row.innerText.includes(marker)),
							gap: scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : undefined });
						requestAnimationFrame(sample);
					};
					requestAnimationFrame(sample);
					try {
						for (const id of [emptyId, sessionId, emptyId, sessionId]) {
							const openSidebar = document.querySelector('button[aria-label="Open sidebar"]');
							if (openSidebar) {
								openSidebar.click();
								await new Promise(resolve => setTimeout(resolve, 300));
							}
							selected = id;
							actions.push({ id, ms: performance.now() - started });
							const button = document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="' + id + '"] button[aria-label^="Open session"]');
							if (!button) throw new Error("Missing sidebar button");
							button.click();
							await new Promise(resolve => setTimeout(resolve, 800));
						}
						return { actions, samples };
					} finally { stopped = true; }
				})()`, 10_000);
				for (const action of result.actions.filter((entry) => entry.id === session.id)) {
					const frames = result.samples.filter((frame) => frame.ms >= action.ms && frame.ms < action.ms + 800 && frame.session === session.id);
					const mounted = frames.find((frame) => frame.mounted);
					const revealed = frames.find((frame) => frame.revealed && frame.visible);
					assert.ok(mounted && revealed, "the correct tail must render and become visible");
					assert.ok(revealed.ms - mounted.ms < 100, `already mounted rows remained hidden for ${revealed.ms - mounted.ms} ms`);
					assert.deepEqual(frames.filter((frame) => frame.visible && (frame.gap > 24 || !frame.visibleTail)), [], "never reveal an intermediate top/middle position");
					t.diagnostic(`${count} rows: click-to-visible ${(revealed.ms - action.ms).toFixed(1)} ms, mounted-to-visible ${(revealed.ms - mounted.ms).toFixed(1)} ms`);
				}
			});
		}
	} finally {
		try {
			if (room) {
				await post(`/api/chat/rooms/${room.id}`, { archived: true }, "PATCH");
				await post(`/api/chat/rooms/${room.id}`, { confirmName: name }, "DELETE");
			}
			await client.send("Page.navigate", { url: target.url });
		} finally {
			client.close();
		}
	}
});
