import assert from "node:assert/strict";
import test from "node:test";
import { CdpClient } from "../dist/tools/cdp-client.js";

const cdpUrl = process.env.PIBO_TEST_CDP_URL;

test("post-create hydration preserves newer Session and Room navigation", { skip: !cdpUrl, timeout: 90_000 }, async (t) => {
	assert.equal(process.env.PIBO_COMPUTE_WORKER, "1", "Use an isolated Docker worker");
	const targets = await (await fetch(`${cdpUrl}/json/list`)).json();
	const target = targets.find((entry) => entry.type === "page" && entry.url.includes("/apps/chat"));
	assert.ok(target, "An authenticated headful Chat target is required");
	const origin = new URL(target.url).origin;
	assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
	const client = new CdpClient(target.webSocketDebuggerUrl);
	await client.connect();
	const rooms = [];
	const roomNames = new Map();
	const waitFor = async (expression) => {
		for (let attempt = 0; attempt < 100; attempt++) {
			if (await client.evaluate(expression)) return;
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
		throw Error(`Browser condition did not settle: ${expression}`);
	};
	const release = () => client.evaluate("if(window.__createNavigationTest){window.fetch=window.__createNavigationTest.original;window.__createNavigationTest.release?.()}");
	try {
		await client.send("Emulation.setDeviceMetricsOverride", { width: 1431, height: 908, deviceScaleFactor: 1, mobile: false });
		for (let i = 0; i < 2; i++) {
			const room = await client.evaluate(`(async () => {
				const response = await fetch('/api/chat/rooms', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Creation navigation regression '+Date.now()})});
				if(!response.ok) throw Error('Room setup failed');
				return (await response.json()).room;
			})()`);
			rooms.push(room.id);
			roomNames.set(room.id, room.name);
		}
		const sessions = [];
		for (const roomId of [rooms[0], rooms[0], rooms[1]]) {
			sessions.push(await client.evaluate(`(async () => {
				const response = await fetch('/api/chat/sessions', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId:${JSON.stringify(roomId)}})});
				if(!response.ok) throw Error('Session setup failed');
				return (await response.json()).session.id;
			})()`));
		}
		for (const scenario of ["untouched", "session-before-refresh", "session-after-refresh", "other-room", "browser-back", "next-create"]) {
			await t.test(scenario, async () => {
				await client.send("Page.navigate", { url: `${origin}/apps/chat/rooms/${rooms[0]}/sessions/${sessions[0]}?view=terminal` });
				await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(sessions[0])} && !!document.querySelector('button[aria-label="New Session"]:not(:disabled)')`);
				// Hold the real response after POST succeeded, not the optimistic POST itself.
				await client.evaluate(`(() => {
					const original=window.fetch,state={original,held:false};window.__createNavigationTest=state;
					window.fetch=async(...args)=>{const url=String(args[0]?.url||args[0]);const response=await original(...args);if(url.startsWith('/api/chat/bootstrap')&&!state.held){state.held=true;await new Promise(resolve=>state.release=resolve);}return response;};
					document.querySelector('button[aria-label="New Session"]').click();
				})()`);
				try {
					await waitFor("window.__createNavigationTest.held");
					await waitFor(`(() => {const id=document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId;return id?.startsWith('ps_')&&!${JSON.stringify(sessions)}.includes(id)})()`);
					const created = await client.evaluate("document.querySelector('[data-pibo-debug=\"compact-terminal-session-view\"]')?.dataset.piboSessionId");
					assert.ok(created?.startsWith("ps_") && !sessions.includes(created), "POST has resolved to a real new Session");
					let expected = scenario === "untouched" ? created : scenario === "other-room" ? sessions[2] : scenario === "browser-back" ? sessions[0] : sessions[1];
					if (scenario === "untouched" || scenario === "next-create") {
						await waitFor("!!document.querySelector('button[aria-label=\"New Session\"]:not(:disabled)')");
					}
					if (scenario === "next-create") {
						await client.evaluate("document.querySelector('button[aria-label=\"New Session\"]').click()");
						await waitFor(`(() => {const id=document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId;return id?.startsWith('ps_')&&id!==${JSON.stringify(created)}&&!${JSON.stringify(sessions)}.includes(id)})()`);
						expected = await client.evaluate("document.querySelector('[data-pibo-debug=\"compact-terminal-session-view\"]').dataset.piboSessionId");
					}
					const roomId = scenario === "other-room" ? rooms[1] : rooms[0];
					if (scenario === "other-room") {
						await client.evaluate(`document.querySelector('[data-pibo-debug="room-node"][data-pibo-room-id="${rooms[1]}"] button').click()`);
						await waitFor(`!!document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"]')`);
					}
					if (scenario !== "untouched" && scenario !== "next-create") {
						if (scenario === "browser-back") {
							const history = await client.send("Page.getNavigationHistory");
							await client.send("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex - 1].id });
						} else {
							await client.evaluate(`document.querySelector('[data-pibo-debug="session-row"][data-pibo-session-id="${expected}"] button[aria-label^="Open session"]').click()`);
						}
						await waitFor(`document.querySelector('[data-pibo-debug="compact-terminal-session-view"]')?.dataset.piboSessionId===${JSON.stringify(expected)}`);
						// Seed after selection: transient debug streams are not persisted reload fixtures.
						await new Promise((resolve) => setTimeout(resolve, 100));
						await client.evaluate(`(async () => {const response=await fetch('/api/chat/debug/streaming-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({piboSessionId:${JSON.stringify(expected)},deltas:['VISIBLE_NAVIGATION_TARGET_${expected}'],cadenceMs:10,traceSnapshots:true})});if(!response.ok)throw Error('Visible-content fixture failed')})()`);
						if (scenario === "session-after-refresh") await new Promise((resolve) => setTimeout(resolve, 900));
					}
					await release();
					await new Promise((resolve) => setTimeout(resolve, 1200));
					const result = await client.evaluate(`(() => {const term=document.querySelector('[data-pibo-debug="compact-terminal-session-view"]');const marker='VISIBLE_NAVIGATION_TARGET_${expected}';const row=[...document.querySelectorAll('[data-pibo-debug="terminal-row"]')].find(row=>row.textContent.includes(marker));const box=term?.querySelector('[data-virtuoso-scroller]')?.getBoundingClientRect();const rect=row?.getBoundingClientRect();return{session:term?.dataset.piboSessionId,path:location.pathname,visible:!!(box&&rect&&getComputedStyle(row).visibility==='visible'&&rect.bottom>box.top&&rect.top<box.bottom)}})()`);
					t.diagnostic(`${scenario}: ${JSON.stringify(result)}`);
					assert.equal(result.session, expected, "Late creation must not steal the newer Session selection");
					assert.ok(result.path.includes(`/rooms/${roomId}/sessions/${expected}`), "Route and selected content agree");
					if (scenario !== "untouched" && scenario !== "next-create") assert.ok(result.visible, "Correct target content is viewport-visible");
				} finally { await release(); }
			});
		}
	} finally {
		await release().catch(() => undefined);
		try {
			for (const roomId of rooms) {
				await client.evaluate(`(async()=>{for(const [method,body] of [['PATCH',{archived:true}],['DELETE',{confirmName:${JSON.stringify(roomNames.get(roomId))}}]]){const response=await fetch('/api/chat/rooms/${roomId}',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error('Room cleanup failed: '+response.status)}})()`);
			}
		} finally { client.close(); }
	}
});
