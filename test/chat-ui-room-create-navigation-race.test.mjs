import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { CdpClient } from "../dist/tools/cdp-client.js";

const cdpUrl = process.env.PIBO_TEST_CDP_URL;

test("Room creation retains optimistic state and newer navigation", { skip: !cdpUrl, timeout: 120_000 }, async (t) => {
	assert.equal(process.env.PIBO_COMPUTE_WORKER, "1", "Use an isolated Docker worker");
	const targets = await (await fetch(`${cdpUrl}/json/list`)).json();
	const target = targets.find((entry) => entry.type === "page" && entry.url.includes("/apps/chat"));
	assert.ok(target, "Authenticated headful Chat target required");
	const origin = new URL(target.url).origin;
	assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	const rooms = [];
	const results = [];
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const waitFor = async (expression) => {
		for (let attempt = 0; attempt < 150; attempt++) {
			if (await client.evaluate(expression)) return;
			await sleep(40);
		}
		throw Error(`Browser condition did not settle: ${expression}`);
	};
	const sessionExpression = `document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId`;
	const snapshot = `(() => ({
		path: location.pathname,
		session: ${sessionExpression},
		roomIds: [...document.querySelectorAll('[data-pibo-debug="room-node"]')].map(row => row.dataset.piboRoomId),
		newRoomEnabled: !!document.querySelector('button[aria-label="New Room"]:not(:disabled)')
	}))()`;
	const visibleMarker = (sessionId) => `(() => {
		const row = [...document.querySelectorAll('[data-row-kind="message.assistant"]')].find(row => row.textContent.includes('ROOM_NAV_TARGET_${sessionId}'));
		const scroller = row?.closest('[data-virtuoso-scroller]');
		if (!row || !scroller || getComputedStyle(row).visibility !== 'visible') return false;
		const rect = row.getBoundingClientRect(), box = scroller.getBoundingClientRect();
		const top = Math.max(rect.top, box.top), bottom = Math.min(rect.bottom, box.bottom);
		const left = Math.max(rect.left, box.left), right = Math.min(rect.right, box.right);
		return bottom > top && right > left && row.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2));
	})()`;
	const openRoom = (roomId) => client.evaluate(`document.querySelector('[data-pibo-debug="room-node"][data-pibo-room-id="${roomId}"] button').click()`);
	const release = () => client.evaluate(`if (window.__roomCreationTest) {
		window.fetch = window.__roomCreationTest.original;
		window.__roomCreationTest.release?.();
	}`);
	const navigate = async (roomId, sessionId) => {
		await client.send("Page.navigate", { url: `${origin}/apps/chat/rooms/${roomId}/sessions/${sessionId}?view=terminal` });
		await waitFor(`${sessionExpression} === '${sessionId}' && !!document.querySelector('button[aria-label="New Room"]:not(:disabled)')`);
	};
	try {
		await client.send("Emulation.setDeviceMetricsOverride", { width: 1431, height: 908, deviceScaleFactor: 1, mobile: false });
		for (let i = 0; i < 2; i++) {
			rooms.push(await client.evaluate(`(async () => {
				const response = await fetch('/api/chat/rooms', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name:'Room navigation '+Date.now()})});
				if (!response.ok) throw Error('Room setup: '+response.status);
				return (await response.json()).room;
			})()`));
		}
		const sessions = [];
		for (const room of rooms) {
			sessions.push(await client.evaluate(`(async () => {
				const response = await fetch('/api/chat/sessions', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({roomId:'${room.id}'})});
				if (!response.ok) throw Error('Session setup: '+response.status);
				return (await response.json()).session.id;
			})()`));
		}
		const scenarios = [
			...['untouched', 'other-room', 'browser-back'].flatMap(action => [
				{ stage: 'post', action, failure: false }, { stage: 'post', action, failure: true },
			]),
			...['untouched', 'other-room', 'browser-back', 'next-room'].map(action => ({ stage: 'navigation', action, failure: false })),
		];
		for (const scenario of scenarios) {
			await t.test(`${scenario.stage}-${scenario.action}-${scenario.failure ? 'failure' : 'success'}`, async () => {
				const result = { scenario };
				results.push(result);
				if (scenario.action === "browser-back") {
					await navigate(rooms[1].id, sessions[1]);
					// Make the previous entry a same-document SPA entry, not a reload
					// that destroys the request wrapper before the response is released.
					await openRoom(rooms[0].id);
					await waitFor(`${sessionExpression} === '${sessions[0]}' && location.pathname.includes('${rooms[0].id}')`);
				} else await navigate(rooms[0].id, sessions[0]);
				try {
					await client.evaluate(`(() => {
						const state = {original:window.fetch, held:false, created:[], stop:false};
						window.__roomCreationTest = state;
						window.fetch = async (...args) => {
							const url = String(args[0]?.url || args[0]);
							if (url === '/api/chat/rooms' && args[1]?.method === 'POST') {
								if (${scenario.failure} && !state.held) {
									state.held = true;
									await new Promise(resolve => state.release = resolve);
									throw Error('INJECTED_ROOM_FAILURE'); // no request sent
								}
								const response = await state.original.apply(window, args);
								state.created.push((await response.clone().json()).room);
								if (${scenario.stage === 'post'} && !state.held) {
									state.held = true;
									await new Promise(resolve => state.release = resolve);
								}
								return response;
							}
							const response = await state.original.apply(window, args);
							if (${scenario.stage === 'navigation'} && !state.held && url.startsWith('/api/chat/navigation') && state.created[0] && url.includes(state.created[0].id)) {
								state.held = true;
								await new Promise(resolve => state.release = resolve);
							}
							return response;
						};
						document.querySelector('button[aria-label="New Room"]').click();
					})()`);
					await waitFor("!!window.__roomCreationTest.release");
					await sleep(300);
					result.pending = await client.evaluate(snapshot);
					const created = await client.evaluate("window.__roomCreationTest.created[0]");
					let expectedRoom = scenario.action === "untouched" ? (scenario.failure ? rooms[0].id : created.id) : rooms[1].id;
					let expectedSession = scenario.action === "untouched" ? (scenario.failure ? sessions[0] : null) : sessions[1];
					if (scenario.action === "browser-back") {
						const history = await client.send("Page.getNavigationHistory");
						await client.send("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex - 1].id });
					} else if (scenario.action === "other-room") await openRoom(rooms[1].id);
					if (scenario.action === "next-room") {
						await waitFor("!!document.querySelector('button[aria-label=\"New Room\"]:not(:disabled)')");
						await client.evaluate("document.querySelector('button[aria-label=\"New Room\"]').click()");
						await waitFor("window.__roomCreationTest.created.length === 2");
						expectedRoom = await client.evaluate("window.__roomCreationTest.created[1].id");
						await waitFor(`location.pathname.includes('${expectedRoom}') && ${sessionExpression}?.startsWith('ps_')`);
						expectedSession = await client.evaluate(sessionExpression);
					} else if (scenario.action !== "untouched") await waitFor(`${sessionExpression} === '${expectedSession}'`);
					if (expectedSession && scenario.action !== "untouched") {
						// Deterministic worker-only content, not provider or reload evidence.
						await client.evaluate(`(async () => {
							const response = await fetch('/api/chat/debug/streaming-fixture', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({piboSessionId:'${expectedSession}', deltas:['ROOM_NAV_TARGET_${expectedSession}'], cadenceMs:10, traceSnapshots:true})});
							if (!response.ok) throw Error('Visible fixture: '+response.status);
						})()`);
						await waitFor(visibleMarker(expectedSession));
					}
					result.expected = { room: expectedRoom, session: expectedSession };
					result.beforeRelease = await client.evaluate(snapshot);
					await client.evaluate(`(() => {
						const state = window.__roomCreationTest;
						state.frames = [];
						const tick = () => {
							state.frames.push({at:performance.now(), session:${sessionExpression}, path:location.pathname});
							if (!state.stop) requestAnimationFrame(tick);
						};
						requestAnimationFrame(tick);
						state.release();
					})()`);
					await sleep(1400);
					await client.evaluate("window.__roomCreationTest.stop = true");
					result.frames = await client.evaluate("window.__roomCreationTest.frames");
					result.afterRelease = await client.evaluate(snapshot);
					t.diagnostic(JSON.stringify({ scenario, pending: result.pending, expected: result.expected, after: result.afterRelease }));
					if (scenario.stage === "post" && scenario.action === "untouched") {
						assert.ok(result.pending.roomIds.some(id => id.startsWith("optimistic-room-")), "Untouched optimistic Room remains until POST settles");
					}
					if (scenario.stage === "navigation") assert.ok(result.pending.newRoomEnabled, "POST completion releases creation controls before hydration");
					assert.ok(result.afterRelease.path.includes(`/rooms/${expectedRoom}`), "Late creation must not overwrite a newer Room choice");
					if (expectedSession) {
						assert.equal(result.afterRelease.session, expectedSession);
						assert.equal(result.frames.filter(frame => frame.session !== expectedSession).length, 0, "No old Session remount under a newer route");
					}
					if (expectedSession && scenario.action !== "untouched") {
						result.visible = await client.evaluate(visibleMarker(expectedSession));
						assert.ok(result.visible, "Correct content remains viewport-visible and unoccluded");
					}
					assert.ok(!result.afterRelease.roomIds.some(id => id.startsWith("optimistic-room-")), "No settled temporary Room remains");
					if (scenario.action === "next-room") {
						const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
						await writeFile("/tmp/room-create-navigation.png", Buffer.from(screenshot.data, "base64"));
					}
				} finally {
					const created = await client.evaluate("window.__roomCreationTest?.created || []").catch(() => []);
					rooms.push(...created);
					await release();
				}
			});
		}
	} finally {
		await writeFile("/tmp/room-create-navigation-results.json", JSON.stringify({ rooms, results }, null, 2));
		await release().catch(() => undefined);
		try {
			for (const room of rooms) {
				await client.evaluate(`(async () => {
					for (const [method, body] of [['PATCH', {archived:true}], ['DELETE', {confirmName:${JSON.stringify(room.name)}}]]) {
						const response = await fetch('/api/chat/rooms/${room.id}', {method, headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
						if (!response.ok) throw Error('Room cleanup: '+response.status);
					}
				})()`);
			}
		} finally { client.close(); }
	}
});
