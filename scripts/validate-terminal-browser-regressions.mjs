import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listCdpTargets, connectCdpTarget } from "../dist/tools/cdp-client.js";

const options = parseArgs(process.argv.slice(2));
const cdpUrl = options.cdpUrl ?? process.env.PIBO_TERMINAL_TEST_CDP_URL;
if (!cdpUrl) throw new Error("Pass --cdp-url or set PIBO_TERMINAL_TEST_CDP_URL");
const tolerance = numberOption(options.tolerance, 1);
const historyPages = numberOption(options.historyPages, 2);
const artifactDir = resolve(options.artifactDir ?? `/tmp/pibo-terminal-browser-regression-${Date.now()}`);
await mkdir(artifactDir, { recursive: true });

const targets = await listCdpTargets({ cdpUrl, timeoutMs: 5_000 });
let target;
let client;
for (const candidate of targets.filter((item) => item.type === "page" && item.url.includes("/apps/chat/") && (!options.targetUrl || item.url.startsWith(options.targetUrl)))) {
	try {
		const candidateClient = await connectCdpTarget(candidate, 5_000);
		const usable = await candidateClient.evaluate(`Boolean(document.querySelector('textarea') && document.querySelector('[data-testid="virtuoso-scroller"]'))`, 5_000);
		if (usable) {
			target = candidate;
			client = candidateClient;
			break;
		}
		candidateClient.close();
	} catch {
		// Try the next Chat Web target.
	}
}
if (!target || !client) throw new Error(`No authenticated responsive Chat Web page target found at ${cdpUrl}`);
for (const duplicate of targets.filter((item) => item.type === "page" && item.id !== target.id && item.url.includes("/apps/chat/") && (!options.targetUrl || item.url.startsWith(options.targetUrl)))) {
	await client.send("Target.closeTarget", { targetId: duplicate.id }).catch(() => undefined);
}
await client.send("Page.enable");
await client.send("Runtime.enable");
await client.send("Network.enable");

const report = { startedAt: new Date().toISOString(), cdpUrl, target: { id: target.id, url: target.url }, tolerance, historyPages, scenarios: {}, passed: false };
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const evaluate = (expression, timeoutMs = 10_000) => client.evaluate(expression, timeoutMs);

try {
	await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal scroller");
	await scenario("sticky-on-streaming", async () => {
		await returnToLatest();
		const before = await measure();
		await postStreamingFixture(20, 20, { traceSnapshots: false });
		await sleep(1_500);
		const after = await measure();
		assert(after.bottomGap <= tolerance, `sticky bottom gap ${after.bottomGap}`);
		assert(!after.stickyButton, "sticky viewer unexpectedly detached");
		return { before, after };
	});

	await scenario("sticky-on-frame-stability", async () => {
		await returnToLatest();
		await startFrameRecorder();
		await postStreamingFixture(20, 120, { traceSnapshots: false });
		await sleep(3_000);
		const recording = await stopFrameRecorder();
		const frames = recording.frames.filter((frame) => frame.t >= 200);
		const maxBottomGap = Math.max(0, ...frames.map((frame) => frame.bottomGap));
		assert(maxBottomGap <= Math.max(2, tolerance), `sticky frame bottom gap ${maxBottomGap}px`);
		return { frameCount: frames.length, maxBottomGap, frames };
	});

	await scenario("sticky-off-streaming-and-reconciliation", async () => {
		await detachWithPageUp();
		await waitForStableViewport();
		const before = await measure();
		await postStreamingFixture(30, 20, { traceSnapshots: true });
		await sleep(2_200);
		const after = await measure();
		assertAnchor(before, after, tolerance);
		assert(after.stickyButton, "detached viewer lost Scroll to latest");
		return { before, after, offsetDeltaPx: anchorOffsetDelta(before, after) };
	});

	await scenario("expanded-row-streaming", async () => {
		const row = await findExpandableRow();
		assert(row, "fixture has no expandable Terminal row");
		await evaluate(`(() => { const row=[...document.querySelectorAll('[data-row-id]')].find((item)=>item.getAttribute('data-row-id')===${JSON.stringify(row.id)}); row?.scrollIntoView({block:'start'}); return Boolean(row); })()`);
		await key("ArrowUp", "ArrowUp", 38);
		await sleep(250);
		await doubleClickRow(row.id);
		await waitFor(`document.querySelector('[data-row-id=${JSON.stringify(row.id)}]')?.getAttribute('aria-expanded') === 'true'`, 3_000, "expanded row");
		await waitForStableViewport();
		const before = await rowMetric(row.id);
		await postStreamingFixture(20, 20, { traceSnapshots: false });
		await sleep(1_500);
		const after = await rowMetric(row.id);
		assert(before && after, "expanded anchor row disappeared");
		assert(Math.abs(after.top - before.top) <= tolerance, `expanded row drift ${after.top - before.top}px`);
		await doubleClickRow(row.id);
		return { rowId: row.id, before, after, offsetDeltaPx: after.top - before.top };
	});

	await scenario("wheel-edge-stops-after-one-prepend", async () => {
		await returnToLatest();
		await startFrameRecorder();
		const geometry = await scrollerGeometry();
		for (let index = 0; index < 60; index += 1) {
			await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(geometry.left + geometry.width / 2), y: Math.round(geometry.top + geometry.height / 2), deltaX: 0, deltaY: -450 });
			await sleep(60);
			if ((await measure()).scrollTop <= 0) break;
		}
		const atInputEnd = await measure();
		await markFrameRecorder("input-end");
		if (atInputEnd.hasOlder === "true") await waitFor(cursorChangedExpression(atInputEnd.cursor), 15_000, "wheel-edge history page");
		await sleep(1_500);
		const recording = await stopFrameRecorder();
		const frames = recording.frames.filter((frame) => frame.t >= recording.marks["input-end"]);
		const cursors = [...new Set(frames.map((frame) => frame.cursor).filter(Boolean))];
		assert(cursors.length <= 2, `wheel edge loaded ${cursors.length - 1} pages after input stopped`);
		const anchorOffsets = frames.flatMap((frame) => frame.rows.find((row) => row.id === atInputEnd.firstVisible?.id)?.top ?? []);
		assert(anchorOffsets.length > 0, `wheel-edge anchor ${atInputEnd.firstVisible?.id} disappeared`);
		const anchorRangePx = Math.max(...anchorOffsets) - Math.min(...anchorOffsets);
		assert(anchorRangePx <= Math.max(2, tolerance), `wheel-edge anchor range ${anchorRangePx}px`);
		return { atInputEnd, cursors, anchorRangePx, frameCount: frames.length, frames };
	});

	await scenario("slow-and-rapid-history-prepends", async () => {
		const loads = [];
		for (let index = 0; index < historyPages; index += 1) {
			const delayMs = index === 0 ? 500 : 100;
			await installOlderPageDelay(delayMs);
			const beforeIntent = await measure();
			if (beforeIntent.hasOlder !== "true") break;
			await key("Home", "Home", 36);
			await sleep(750);
			const beforeLoad = await measure();
			await waitFor(cursorChangedExpression(beforeIntent.cursor), 15_000, `history cursor ${beforeIntent.cursor}`);
			await sleep(350);
			const after = await measure();
			const retained = await rowMetric(beforeLoad.firstVisible?.id);
			assert(retained, `history anchor ${beforeLoad.firstVisible?.id} disappeared`);
			assert(Math.abs(retained.top - beforeLoad.firstVisible.top) <= tolerance, `prepend drift ${retained.top - beforeLoad.firstVisible.top}px`);
			loads.push({ beforeIntent, beforeLoad, after, retained, offsetDeltaPx: retained.top - beforeLoad.firstVisible.top, delayMs });
		}
		await installOlderPageDelay(0);
		return { loads };
	});

	await scenario("scrollbar-thumb-drag-defers-history-prepend", async () => {
		await returnToLatest();
		const before = await measure();
		assert(before.hasOlder === "true", "scrollbar fixture has no older history");
		const geometry = await scrollerGeometry();
		await mouse("mouseMoved", geometry.right - 2, geometry.bottom - 12, "none");
		await mouse("mousePressed", geometry.right - 2, geometry.bottom - 12, "left");
		const held = [];
		for (let step = 1; step <= 12; step += 1) {
			await mouse("mouseMoved", geometry.right - 2, geometry.bottom - 12 - ((geometry.height - 24) * step / 12), "left");
			await sleep(35);
			held.push(await measure());
		}
		await evaluate(`document.querySelector('[data-testid="virtuoso-scroller"]').scrollTop=0`);
		await sleep(900);
		const atEdgeHeld = await measure();
		assert(held.every((item) => item.cursor === before.cursor) && atEdgeHeld.cursor === before.cursor, "history prepended while the native scrollbar was held");
		const reversals = held.slice(1).filter((item, index) => item.scrollTop > held[index].scrollTop + 2).length;
		assert(reversals === 0, `scrollbar drag reversed ${reversals} times`);
		await mouse("mouseReleased", geometry.right - 2, geometry.top + 12, "left");
		await waitFor(cursorChangedExpression(before.cursor), 15_000, "deferred history load after scrollbar release");
		await sleep(500);
		return { before, held, atEdgeHeld, afterRelease: await measure(), reversals };
	});

	await scenario("middle-click-descendant-detaches-and-loads-history", async () => {
		await returnToLatest();
		const before = await measure();
		assert(before.hasOlder === "true", "middle-click fixture has no older history");
		const point = await terminalRowPoint();
		assert(point, "no rendered Terminal row for middle-click validation");
		await mouse("mousePressed", point.x, point.y, "middle");
		await mouse("mouseReleased", point.x, point.y, "middle");
		await evaluate(`(() => { const s=document.querySelector('[data-testid="virtuoso-scroller"]'); s.scrollTop=Math.max(0,s.scrollTop-400); })()`);
		await waitFor(`Boolean(document.querySelector('button[aria-label="Scroll to latest"]'))`, 5_000, "middle-click detach");
		await evaluate(`document.querySelector('[data-testid="virtuoso-scroller"]').scrollTop=0`);
		await waitFor(cursorChangedExpression(before.cursor), 15_000, "middle-click history load");
		const after = await measure();
		assert(after.stickyButton, "middle-click history movement snapped back to latest");
		return { before, after };
	});

	await scenario("transient-replay-reconnect", async () => {
		await detachWithPageUp();
		const before = await measure();
		await postStreamingFixture(40, 25, { traceSnapshots: false });
		await sleep(250);
		await client.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
		await sleep(600);
		await client.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
		await sleep(2_800);
		const after = await measure();
		assertAnchor(before, after, tolerance);
		return { before, after, offsetDeltaPx: anchorOffsetDelta(before, after) };
	});

	await scenario("long-session-reload", async () => {
		await detachWithPageUp();
		const before = await measure();
		assert(before.firstVisible?.id, "reload fixture has no visible conceptual row");
		await sleep(250);
		const stored = await evaluate(`sessionStorage.getItem('pibo.chat.terminalReadingPosition.' + ${JSON.stringify(before.sessionId)})`);
		assert(stored && JSON.parse(stored).rowId === before.firstVisible.id, "reading anchor was not persisted before reload");
		await client.send("Page.reload", { ignoreCache: true });
		await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal after reload");
		await waitFor(rowVisibleExpression(before.firstVisible.id), 30_000, "restored conceptual row");
		await sleep(800);
		const after = await measure();
		assertAnchor(before, after, tolerance);
		assert(after.stickyButton, "reload restoration unexpectedly returned to latest");
		return { before, after, offsetDeltaPx: anchorOffsetDelta(before, after) };
	});

	report.passed = true;
} catch (error) {
	report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
	await captureScreenshot("failure").catch(() => undefined);
	throw error;
} finally {
	report.completedAt = new Date().toISOString();
	await writeFile(resolve(artifactDir, "metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
	client.close();
	console.log(JSON.stringify({ passed: report.passed, artifactDir, scenarios: Object.keys(report.scenarios) }, null, 2));
}

async function scenario(name, run) {
	const startedAt = new Date().toISOString();
	try {
		const metrics = await run();
		report.scenarios[name] = { status: "passed", startedAt, completedAt: new Date().toISOString(), ...metrics };
		await captureScreenshot(name);
	} catch (error) {
		report.scenarios[name] = { status: "failed", startedAt, completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
		await captureScreenshot(`${name}-failure`).catch(() => undefined);
		throw error;
	}
}

async function waitFor(expression, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	let latest;
	while (Date.now() < deadline) {
		latest = await evaluate(expression);
		if (latest) return latest;
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${label}; latest=${JSON.stringify(latest)}`);
}

async function measure() {
	return evaluate(`(() => {
		const root=document.querySelector('[data-pibo-component="CompactTerminalSessionView"]');
		const scroller=document.querySelector('[data-testid="virtuoso-scroller"]');
		if (!root || !scroller) return null;
		const viewport=scroller.getBoundingClientRect();
		const visible=[...document.querySelectorAll('[data-pibo-terminal-row="true"]')]
			.map((row)=>{const rect=row.getBoundingClientRect();return{id:row.getAttribute('data-row-id'),kind:row.getAttribute('data-row-kind'),top:rect.top-viewport.top,bottom:rect.bottom-viewport.top};})
			.filter((row)=>row.bottom>0&&row.top<viewport.height).sort((a,b)=>a.top-b.top);
		return {sessionId:root.getAttribute('data-pibo-session-id'),cursor:root.getAttribute('data-pibo-trace-next-before'),hasOlder:root.getAttribute('data-pibo-trace-has-older'),scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,bottomGap:scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight,firstVisible:visible[0]??null,stickyButton:Boolean(document.querySelector('button[aria-label="Scroll to latest"]')),renderedRows:document.querySelectorAll('[data-pibo-terminal-row="true"]').length};
	})()`);
}

async function startFrameRecorder() {
	return evaluate(`(() => {
		const scroller=document.querySelector('[data-testid="virtuoso-scroller"]');
		const root=document.querySelector('[data-pibo-component="CompactTerminalSessionView"]');
		if(!scroller||!root)return false;
		const started=performance.now(),frames=[],marks={};let stopped=false,lastSignature='';
		const capture=(reason)=>{if(stopped)return;const viewport=scroller.getBoundingClientRect();const rows=[...document.querySelectorAll('[data-pibo-terminal-row="true"][data-row-id]')].map((row)=>{const rect=row.getBoundingClientRect();return{id:row.getAttribute('data-row-id'),top:Math.round((rect.top-viewport.top)*10)/10,bottom:Math.round((rect.bottom-viewport.top)*10)/10};}).filter((row)=>row.bottom>-200&&row.top<scroller.clientHeight+200).sort((a,b)=>a.top-b.top);const frame={t:Math.round((performance.now()-started)*10)/10,reason,scrollTop:Math.round(scroller.scrollTop*10)/10,scrollHeight:Math.round(scroller.scrollHeight*10)/10,bottomGap:Math.round((scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight)*10)/10,cursor:root.getAttribute('data-pibo-trace-next-before'),firstVisible:rows.find((row)=>row.bottom>0)??null,rows};const signature=JSON.stringify([frame.scrollTop,frame.scrollHeight,frame.bottomGap,frame.cursor,frame.firstVisible?.id,rows.map((row)=>[row.id,row.top])]);if(signature!==lastSignature||reason==='mark'||reason==='stop'){lastSignature=signature;if(frames.length<1000)frames.push(frame);}};
		const observer=new MutationObserver(()=>capture('mutation'));observer.observe(scroller,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','data-row-id']});
		const raf=()=>{capture('raf');if(!stopped)requestAnimationFrame(raf);};requestAnimationFrame(raf);capture('start');
		window.__piboTerminalFrameRecorder={mark(name){marks[name]=Math.round((performance.now()-started)*10)/10;capture('mark');return marks[name];},stop(){capture('stop');stopped=true;observer.disconnect();return{frames,marks};}};return true;
	})()`);
}

async function markFrameRecorder(name) {
	return evaluate(`window.__piboTerminalFrameRecorder?.mark(${JSON.stringify(name)})`);
}

async function stopFrameRecorder() {
	return evaluate(`window.__piboTerminalFrameRecorder?.stop()`);
}

async function rowMetric(rowId) {
	if (!rowId) return null;
	return evaluate(`(() => {const s=document.querySelector('[data-testid="virtuoso-scroller"]');const row=[...document.querySelectorAll('[data-row-id]')].find((item)=>item.getAttribute('data-row-id')===${JSON.stringify(rowId)});if(!s||!row)return null;const viewport=s.getBoundingClientRect(),rect=row.getBoundingClientRect();return{id:${JSON.stringify(rowId)},top:rect.top-viewport.top,bottom:rect.bottom-viewport.top};})()`);
}

async function scrollerGeometry() {
	return evaluate(`(() => { const rect=document.querySelector('[data-testid="virtuoso-scroller"]').getBoundingClientRect(); return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}; })()`);
}

async function terminalRowPoint() {
	return evaluate(`(() => { const scroller=document.querySelector('[data-testid="virtuoso-scroller"]'); if(!scroller)return null; const viewport=scroller.getBoundingClientRect(); const row=[...document.querySelectorAll('[data-pibo-terminal-row="true"]')].find((item)=>{const rect=item.getBoundingClientRect();return rect.bottom>viewport.top&&rect.top<viewport.bottom;}); if(!row)return null; const rect=row.getBoundingClientRect(); return {x:Math.max(rect.left+1,Math.min(rect.right-1,rect.left+40)),y:Math.max(viewport.top+1,Math.min(viewport.bottom-1,rect.top+Math.min(20,rect.height/2)))}; })()`);
}

async function mouse(type, x, y, button) {
	await client.send("Input.dispatchMouseEvent", { type, x, y, button, buttons: type === "mouseReleased" || button === "none" ? 0 : button === "middle" ? 4 : 1, clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0 });
}

async function key(keyValue, code, keyCode) {
	await evaluate(`(() => {const s=document.querySelector('[data-testid="virtuoso-scroller"]');if(!s)return false;s.tabIndex=0;s.focus();return true;})()`);
	await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyValue, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
	await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
}

async function returnToLatest() {
	await evaluate(`document.querySelector('button[aria-label="Scroll to latest"]')?.click()`);
	await key("End", "End", 35);
	await sleep(500);
	await waitFor(`(() => {const s=document.querySelector('[data-testid="virtuoso-scroller"]');return s && s.scrollHeight-s.scrollTop-s.clientHeight<=${tolerance} && !document.querySelector('button[aria-label="Scroll to latest"]');})()`, 8_000, "latest content");
}

async function detachWithPageUp() {
	await key("PageUp", "PageUp", 33);
	await sleep(120);
	await key("PageUp", "PageUp", 33);
	await waitFor(`Boolean(document.querySelector('button[aria-label="Scroll to latest"]'))`, 5_000, "detached viewer");
	await sleep(250);
}

async function waitForStableViewport() {
	let previous = await measure();
	for (let attempt = 0; attempt < 12; attempt += 1) {
		await sleep(250);
		const current = await measure();
		if (previous?.firstVisible?.id === current?.firstVisible?.id && Math.abs(anchorOffsetDelta(previous, current)) <= 0.5 && Math.abs(current.scrollTop - previous.scrollTop) <= 0.5) return current;
		previous = current;
	}
	throw new Error("Terminal viewport did not settle before the scenario");
}

async function postStreamingFixture(deltaCount, cadenceMs, extra) {
	const deltas = Array.from({ length: deltaCount }, (_, index) => ` browser-${index}`);
	const result = await evaluate(`(async()=>{const p=location.pathname.split('/');const response=await fetch('/api/chat/debug/streaming-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId:p[4],piboSessionId:p[6],deltas:${JSON.stringify(deltas)},cadenceMs:${cadenceMs},...${JSON.stringify(extra)}})});return{status:response.status,body:await response.json()};})()`, 60_000);
	assert(result.status === 200, `streaming fixture returned ${result.status}`);
	return result;
}

async function findExpandableRow() {
	return evaluate(`(() => {const rows=[...document.querySelectorAll('[data-pibo-terminal-row="true"][aria-expanded]')];const row=rows.find((item)=>item.getAttribute('data-row-kind')==='tool.call')??rows[0];return row?{id:row.getAttribute('data-row-id'),kind:row.getAttribute('data-row-kind')}:null;})()`);
}

async function doubleClickRow(rowId) {
	await evaluate(`(() => {const row=[...document.querySelectorAll('[data-row-id]')].find((item)=>item.getAttribute('data-row-id')===${JSON.stringify(rowId)});if(!row)return false;row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0}));return true;})()`);
}

async function installOlderPageDelay(delayMs) {
	await evaluate(`(() => {if(!window.__piboTerminalOriginalFetch)window.__piboTerminalOriginalFetch=window.fetch.bind(window);const original=window.__piboTerminalOriginalFetch;window.fetch=async(...args)=>{const input=args[0];const raw=typeof input==='string'?input:input instanceof Request?input.url:String(input);const url=new URL(raw,location.href);if(${delayMs}>0&&url.pathname==='/api/chat/trace/timeline'&&url.searchParams.has('before'))await new Promise((resolve)=>setTimeout(resolve,${delayMs}));return original(...args);};return true;})()`);
}

async function captureScreenshot(name) {
	const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	await writeFile(resolve(artifactDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

function cursorChangedExpression(cursor) {
	return `(() => {const root=document.querySelector('[data-pibo-component="CompactTerminalSessionView"]');return root && (root.getAttribute('data-pibo-trace-next-before')!==${JSON.stringify(cursor)} || root.getAttribute('data-pibo-trace-has-older')==='false');})()`;
}

function rowVisibleExpression(rowId) {
	return `(() => {const s=document.querySelector('[data-testid="virtuoso-scroller"]');const row=[...document.querySelectorAll('[data-row-id]')].find((item)=>item.getAttribute('data-row-id')===${JSON.stringify(rowId)});if(!s||!row||!document.querySelector('button[aria-label="Scroll to latest"]'))return false;const viewport=s.getBoundingClientRect(),rect=row.getBoundingClientRect();return rect.bottom>viewport.top&&rect.top<viewport.bottom;})()`;
}

function assertAnchor(before, after, pixelTolerance) {
	assert(before?.firstVisible?.id && after?.firstVisible?.id, "missing visible anchor");
	assert(before.firstVisible.id === after.firstVisible.id, `anchor changed from ${before.firstVisible.id} to ${after.firstVisible.id}`);
	const delta = anchorOffsetDelta(before, after);
	assert(Math.abs(delta) <= pixelTolerance, `anchor offset drift ${delta}px exceeds ${pixelTolerance}px`);
}

function anchorOffsetDelta(before, after) {
	return after.firstVisible.top - before.firstVisible.top;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function numberOption(value, fallback) {
	if (value === undefined) return fallback;
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid numeric option: ${value}`);
	return number;
}

function parseArgs(argv) {
	const parsed = {};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			console.log("Usage: node scripts/validate-terminal-browser-regressions.mjs --cdp-url <url> [--target-url <prefix>] [--artifact-dir <dir>] [--tolerance <px>] [--history-pages <count>]");
			process.exit(0);
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
		if (argument === "--cdp-url") parsed.cdpUrl = value;
		else if (argument === "--target-url") parsed.targetUrl = value;
		else if (argument === "--artifact-dir") parsed.artifactDir = value;
		else if (argument === "--tolerance") parsed.tolerance = value;
		else if (argument === "--history-pages") parsed.historyPages = value;
		else throw new Error(`Unknown option ${argument}`);
		index += 1;
	}
	return parsed;
}
