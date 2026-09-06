import assert from "node:assert/strict";
import test from "node:test";
import { CdpClient } from "../dist/tools/cdp-client.js";

const cdpUrl = process.env.PIBO_TEST_CDP_URL;

test("Terminal preserves follow and reading positions when its viewport shrinks", { skip: !cdpUrl, timeout: 90_000 }, async (t) => {
	assert.equal(process.env.PIBO_COMPUTE_WORKER, "1", "Run only in an isolated Docker worker");
	const targets = await (await fetch(`${cdpUrl}/json/list`)).json();
	const target = targets.find((entry) => entry.type === "page" && entry.url.includes("/apps/chat"));
	assert.ok(target, "An authenticated headful Chat target is required");
	const origin = new URL(target.url).origin;
	assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Never inject fixtures into a public app");
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	let room;
	try {
		room = await client.evaluate(`(async () => {
			const response = await fetch('/api/chat/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Viewport resize regression ' + Date.now() }) });
			if (!response.ok) throw Error('Room creation failed');
			return (await response.json()).room;
		})()`);
		for (const width of [1431, 390]) {
			await t.test(`${width}px retains bottom and detached anchor through external header growth`, async () => {
				await client.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
				const session = await client.evaluate(`(async () => {
					const response = await fetch('/api/chat/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomId: ${JSON.stringify(room.id)} }) });
					if (!response.ok) throw Error('Session creation failed');
					return (await response.json()).session.id;
				})()`);
				await client.send("Page.navigate", { url: `${origin}/apps/chat/rooms/${room.id}/sessions/${session}?view=terminal` });
				await new Promise((resolve) => setTimeout(resolve, 700));
				await client.evaluate(`(async () => {
					const deltas = Array.from({ length: 80 }, (_, i) => (i + 1) + '. **A real streamed paragraph for viewport measurement.**\\n\\n');
					deltas.push('VIEWPORT_RESIZE_END');
					const response = await fetch('/api/chat/debug/streaming-fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ piboSessionId: ${JSON.stringify(session)}, preludeMessages: 12, deltas, cadenceMs: 10, traceSnapshots: true }) });
					if (!response.ok) throw Error('Fixture failed');
				})()`);
				await client.evaluate(`(async () => {
					for (let attempt = 0; attempt < 50; attempt++) {
						const terminal = document.querySelector('[data-pibo-debug="compact-terminal-session-view"]');
						const scroller = terminal?.querySelector('[data-virtuoso-scroller]');
						const row = terminal ? [...terminal.querySelectorAll('[data-pibo-debug="terminal-row"]')].at(-1) : undefined;
						if (scroller && row && terminal.textContent.includes('VIEWPORT_RESIZE_END') && getComputedStyle(row).visibility === 'visible' && row.getBoundingClientRect().height > scroller.clientHeight * 2 && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1) {
							await new Promise(resolve => setTimeout(resolve, 250));
							return;
						}
						await new Promise(resolve => setTimeout(resolve, 100));
					}
					throw Error('Tall streamed fixture did not settle at bottom');
				})()`, 7000);
				// Model delayed header hydration outside the observed list, not a forced list height.
				// The tall final row is produced through the real live/Markdown rendering pipeline.
				const before = await client.evaluate(`(() => {
					const terminal = document.querySelector('[data-pibo-debug="compact-terminal-session-view"]');
					if (!terminal?.textContent.includes('VIEWPORT_RESIZE_END')) throw Error('Incomplete fixture');
					const scroller = terminal.querySelector('[data-virtuoso-scroller]');
					const header = document.createElement('div');
					header.style.flex = '0 0 0px';
					scroller.parentElement.parentElement.insertBefore(header, scroller.parentElement);
					const snap = () => {
						const box = scroller.getBoundingClientRect();
						const rows = [...terminal.querySelectorAll('[data-pibo-debug="terminal-row"]')].filter(row => { const r = row.getBoundingClientRect(); return getComputedStyle(row).visibility === 'visible' && r.bottom > box.top && r.top < box.bottom; });
						return { height: scroller.clientHeight, scrollHeight: scroller.scrollHeight, gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop, top: scroller.scrollTop, row: rows[0]?.dataset.rowId, offset: rows[0]?.getBoundingClientRect().top - box.top, rowHeight: rows[0]?.getBoundingClientRect().height, detached: !!terminal.querySelector('button[aria-label="Scroll to latest"]') };
					};
					window.__viewportResizeTest = { header, scroller, snap };
					return snap();
				})()`);
				t.diagnostic(`${width}px initial geometry: ${JSON.stringify(before)}`);
				assert.ok(before.rowHeight > before.height * 2, "A tall final row must isolate viewport-only resize");
				assert.ok(before.gap <= 1, "Fixture starts at bottom");
				const resize = async (height) => client.evaluate(`(async () => {
					const { header, snap } = window.__viewportResizeTest;
					header.style.flexBasis = '${height}px';
					await new Promise(resolve => setTimeout(resolve, 250));
					return snap();
				})()`);
				const shrunk = await resize(30);
				assert.equal(before.height - shrunk.height, 30);
				assert.equal(shrunk.scrollHeight, before.scrollHeight, "Only viewport height changes");
				assert.ok(shrunk.gap <= 1, `Following bottom left a ${shrunk.gap}px gap`);
				await resize(0);
				const point = await client.evaluate(`(() => { const b = window.__viewportResizeTest.scroller.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
				await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -450 });
				await new Promise((resolve) => setTimeout(resolve, 600));
				const detached = await client.evaluate("window.__viewportResizeTest.snap()");
				assert.ok(detached.detached && detached.gap > 100, "Real wheel input detaches following");
				for (const height of [30, 60, 0]) {
					const state = await resize(height);
					assert.equal(state.row, detached.row);
					assert.ok(Math.abs(state.offset - detached.offset) <= 1, "Detached row offset stays stable");
					assert.ok(state.detached && state.gap > 100, "Resize must not reattach the reader");
				}
				await client.evaluate(`(() => {
					const state = window.__viewportResizeTest;
					state.wheelFrames = [state.snap().top];
					state.wheelEvents = [];
					state.scroller.addEventListener('wheel', e => state.wheelEvents.push({ phase: 'capture', deltaY: e.deltaY, top: state.snap().top, target: e.target.tagName }), { once: true, capture: true });
					state.scroller.addEventListener('wheel', e => state.wheelEvents.push({ phase: 'bubble', top: state.snap().top, prevented: e.defaultPrevented }), { once: true });
					const start = performance.now();
					const sample = () => { state.wheelFrames.push(state.snap().top); if (performance.now() - start < 500) requestAnimationFrame(sample); };
					requestAnimationFrame(sample);
				})()`);
				await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -120 });
				await resize(30);
				await new Promise((resolve) => setTimeout(resolve, 300));
				const wheelFrames = await client.evaluate("window.__viewportResizeTest.wheelFrames");
				t.diagnostic(`${width}px concurrent wheel scrollTop samples: ${JSON.stringify(wheelFrames)}; events: ${JSON.stringify(await client.evaluate("window.__viewportResizeTest.wheelEvents"))}`);
				assert.ok(wheelFrames[0] - wheelFrames.at(-1) >= 100, "Concurrent header growth must not swallow upward wheel input");
				assert.ok(wheelFrames.every((top, i) => i === 0 || top <= wheelFrames[i - 1] + 1), "Viewport resizing must not kick an upward wheel back down");
				t.diagnostic(`${width}px: viewport-only shrink ${before.height}→${shrunk.height}, bottom gap ${shrunk.gap}px; detached anchor preserved`);
			});
		}
	} finally {
		try {
			if (room) await client.evaluate(`(async () => {
				const path = '/api/chat/rooms/' + ${JSON.stringify(room.id)};
				for (const [method, body] of [['PATCH', { archived: true }], ['DELETE', { confirmName: ${JSON.stringify(room.name)} }]]) {
					const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
					if (!response.ok) throw Error('Room cleanup failed: ' + response.status);
				}
			})()`);
		} finally {
			client.close();
		}
	}
});
