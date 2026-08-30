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
await client.send("Emulation.setDeviceMetricsOverride", { width: 1_431, height: 908, deviceScaleFactor: 1, mobile: false, screenWidth: 1_431, screenHeight: 908 });
await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

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
		assert(frames.length >= 20, `sticky frame recorder captured only ${frames.length} samples`);
		assert(frames.every((frame) => Number.isFinite(frame.bottomGap)), "sticky frame recorder emitted a non-finite bottom gap");
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

	await scenario("tool-display-modes-retain-reading-anchor", async () => {
		await evaluate(`(() => {const select=document.querySelector('select[aria-label="Tool display mode"]');select.value='default';select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
		await sleep(800);
		await waitForStableViewport();
		await detachWithPageUp();
		for (let attempt = 0; attempt < 12; attempt += 1) {
			const current = await measure();
			if (current.bottomGap >= current.clientHeight * 10 || current.scrollTop <= current.clientHeight) break;
			await key("PageUp", "PageUp", 33);
			await sleep(100);
		}
		await waitForStableViewport();
		await sleep(800);
		await waitForStableViewport();
		const results = [];
		for (const mode of ["slim", "intent", "hide", "default"]) {
			const available = await evaluate(`Boolean([...document.querySelectorAll('select[aria-label="Tool display mode"] option')].find((option)=>option.value===${JSON.stringify(mode)}&&!option.disabled))`);
			if (!available) {
				results.push({ mode, skipped: true });
				continue;
			}
			const before = await measure();
			await evaluate(`(() => {const select=document.querySelector('select[aria-label="Tool display mode"]');select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
			await sleep(700);
			const after = await measure();
			const sharedAnchor = [...before.visible].sort((left, right) => Math.abs(left.top) - Math.abs(right.top)).find((row) => after.visible.some((candidate) => candidate.id === row.id));
			const afterAnchor = sharedAnchor ? after.visible.find((row) => row.id === sharedAnchor.id) : after.firstVisible;
			const beforeOffset = sharedAnchor?.top ?? before.firstVisible?.top;
			const offsetDeltaPx = afterAnchor && beforeOffset !== undefined ? afterAnchor.top - beforeOffset : undefined;
			assert(offsetDeltaPx !== undefined && Math.abs(offsetDeltaPx) <= tolerance, `${mode} tool mode anchor drift ${offsetDeltaPx}px`);
			assert(after.stickyButton, `${mode} tool mode reattached the detached viewer`);
			results.push({ mode, before, after, sharedAnchorId: sharedAnchor?.id, offsetDeltaPx });
		}
		return { results };
	});

	await scenario("continuous-wheel-history-and-settle", async () => {
		await client.send("Page.reload", { ignoreCache: true });
		await sleep(500);
		await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal after wheel reload");
		await returnToLatest();
		const before = await measure();
		await startFrameRecorder();
		const geometry = await scrollerGeometry();
		const inputCursors = new Set([before.cursor]);
		let inputCount = 0;
		for (let index = 0; index < 240; index += 1) {
			inputCount += 1;
			await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(geometry.left + geometry.width / 2), y: Math.round(geometry.top + geometry.height / 2), deltaX: 0, deltaY: -650 });
			await sleep(45);
			if (inputCount % 5 !== 0) continue;
			inputCursors.add((await measure()).cursor);
			if (inputCount >= 60 && inputCursors.size >= 4) break;
		}
		const atInputEnd = await measure();
		await markFrameRecorder("input-end");
		await sleep(300);
		const atSettleStart = await measure();
		await markFrameRecorder("settle-start");
		await sleep(1_200);
		const after = await measure();
		const recording = await stopFrameRecorder();
		const frames = recording.frames.filter((frame) => frame.t >= recording.marks["input-end"]);
		const settledFrames = recording.frames.filter((frame) => frame.t >= recording.marks["settle-start"] && frame.reason !== "mutation");
		const cursors = [...new Set(frames.map((frame) => frame.cursor).filter(Boolean))];
		if (before.hasOlder === "true") assert(after.cursor !== before.cursor, "continuous wheel input did not load older history");
		assert(cursors.length <= 2, `wheel history loaded ${cursors.length - 1} pages after input stopped`);
		const anchor = [...atSettleStart.visible].sort((left, right) => Math.abs(left.top) - Math.abs(right.top)).find((row) => settledFrames.some((frame) => frame.rows.some((candidate) => candidate.id === row.id)));
		const anchorOffsets = anchor ? settledFrames.flatMap((frame) => frame.rows.find((row) => row.id === anchor.id)?.top ?? []) : [];
		assert(anchorOffsets.length > 0, `post-wheel anchor ${anchor?.id ?? atSettleStart.firstVisible?.id} disappeared`);
		const anchorRangePx = Math.max(...anchorOffsets) - Math.min(...anchorOffsets);
		assert(anchorRangePx <= Math.max(2, tolerance), `post-wheel anchor range ${anchorRangePx}px`);
		return { before, atInputEnd, atSettleStart, after, inputCount, inputCursors: [...inputCursors], cursors, anchorId: anchor?.id, anchorRangePx, frameCount: frames.length, frames };
	});

	await scenario("continuous-small-wheel-frame-stability", async () => {
		await client.send("Page.reload", { ignoreCache: true });
		await sleep(500);
		await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal after small-wheel reload");
		await returnToLatest();
		const before = await measure();
		assert(before.hasOlder === "true", "small-wheel fixture has no older history");
		await startFrameRecorder();
		const geometry = await scrollerGeometry();
		const inputCursors = new Set([before.cursor]);
		let inputCount = 0;
		for (let index = 0; index < 220; index += 1) {
			inputCount += 1;
			await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(geometry.left + geometry.width / 2), y: Math.round(geometry.top + geometry.height / 2), deltaX: 0, deltaY: -32 });
			await sleep(28);
			if (inputCount % 5 !== 0) continue;
			inputCursors.add((await measure()).cursor);
			if (inputCount >= 80 && inputCursors.size >= 3) break;
		}
		await markFrameRecorder("input-end");
		await sleep(2_500);
		const recording = await stopFrameRecorder();
		const inputEnd = recording.marks["input-end"];
		const paintedFrames = recording.frames.filter((frame) => frame.reason !== "mutation");
		const jumps = [];
		let missingSharedFrames = 0;
		for (let index = 1; index < paintedFrames.length; index += 1) {
			const previous = paintedFrames[index - 1];
			const current = paintedFrames[index];
			const shared = preferredSharedVisibleRow(previous.rows, current.rows);
			if (!shared) {
				missingSharedFrames += 1;
				continue;
			}
			const visualDelta = shared.after.top - shared.before.top;
			if (Math.abs(visualDelta) > 80 || (current.t >= inputEnd && Math.abs(visualDelta) > Math.max(4, tolerance))) {
				jumps.push({ index, t: current.t, afterInput: current.t >= inputEnd, visualDelta, scrollDelta: current.scrollTop - previous.scrollTop, heightDelta: current.scrollHeight - previous.scrollHeight, rowId: shared.before.id });
			}
		}
		assert(inputCursors.size >= 3, `small-wheel input loaded only ${inputCursors.size - 1} history pages`);
		assert(missingSharedFrames === 0, `small-wheel traversal lost every shared conceptual row in ${missingSharedFrames} adjacent frames`);
		assert(jumps.length === 0, `small-wheel traversal produced ${jumps.length} visual jumps; maximum ${Math.max(0, ...jumps.map((jump) => Math.abs(jump.visualDelta)))}px`);
		const maxRenderedRows = Math.max(0, ...recording.frames.map((frame) => frame.rows.length));
		assert(maxRenderedRows <= 60, `small-wheel traversal rendered ${maxRenderedRows} rows`);
		return { before, inputCount, inputCursors: [...inputCursors], frameCount: recording.frames.length, paintedFrameCount: paintedFrames.length, missingSharedFrames, jumps, maxRenderedRows, frames: recording.frames };
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
		await client.send("Page.reload", { ignoreCache: true });
		await sleep(500);
		await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal after scrollbar reload");
		await returnToLatest();
		const before = await measure();
		assert(before.hasOlder === "true", "scrollbar fixture has no older history");
		const geometry = await scrollerGeometry();
		const scrollbarWidth = Math.max(12, geometry.scrollbarWidth);
		const trackTop = geometry.top + scrollbarWidth;
		const trackBottom = geometry.bottom - scrollbarWidth;
		const trackHeight = trackBottom - trackTop;
		const thumbHeight = Math.max(18, trackHeight * geometry.clientHeight / geometry.scrollHeight);
		const x = geometry.right - scrollbarWidth / 2;
		const startY = trackBottom - thumbHeight / 2;
		const endY = geometry.top - 200;
		await mouse("mouseMoved", x, startY, "none");
		await mouse("mousePressed", x, startY, "left");
		const held = [];
		for (let step = 1; step <= 24; step += 1) {
			await mouse("mouseMoved", x, startY + ((endY - startY) * step / 24), "left");
			await sleep(35);
			held.push(await measure());
		}
		await sleep(900);
		const atEdgeHeld = await measure();
		const absoluteReversals = held.slice(1).flatMap((item, index) => item.scrollTop > held[index].scrollTop + 2
			? [{ index: index + 1, deltaPx: item.scrollTop - held[index].scrollTop }]
			: []);
		const normalizedReversals = held.slice(1).flatMap((item, index) => {
			const previous = held[index].scrollTop / Math.max(1, held[index].scrollHeight - held[index].clientHeight);
			const current = item.scrollTop / Math.max(1, item.scrollHeight - item.clientHeight);
			return current > previous + 0.002 ? [{ index: index + 1, delta: current - previous }] : [];
		});
		await mouse("mouseReleased", x, endY, "left");
		assert(held.every((item) => item.cursor === before.cursor) && atEdgeHeld.cursor === before.cursor, "history prepended while the native scrollbar was held");
		assert(absoluteReversals.length === 0, `scrollbar thumb reversed ${absoluteReversals.length} times in absolute position`);
		assert(normalizedReversals.length === 0, `scrollbar thumb reversed ${normalizedReversals.length} times in normalized position`);
		await sleep(25);
		const afterEdge = await measure();
		assert(afterEdge.scrollTop <= tolerance, `scrollbar top-edge release stopped at ${afterEdge.scrollTop}px`);
		await waitFor(cursorChangedExpression(before.cursor), 15_000, "deferred history load after scrollbar release");
		await sleep(500);
		const afterRelease = await measure();
		const retained = await rowMetric(afterEdge.firstVisible?.id);
		assert(retained, `scrollbar edge anchor ${afterEdge.firstVisible?.id} disappeared`);
		assert(Math.abs(retained.top - afterEdge.firstVisible.top) <= tolerance, `scrollbar edge anchor drift ${retained.top - afterEdge.firstVisible.top}px`);
		return { before, held, atEdgeHeld, afterEdge, afterRelease, retained, absoluteReversals, normalizedReversals };
	});

	await scenario("scrollbar-thumb-intentional-reversal", async () => {
		await returnToLatest();
		const geometry = await scrollerGeometry();
		const scrollbarWidth = Math.max(12, geometry.scrollbarWidth);
		const trackTop = geometry.top + scrollbarWidth;
		const trackBottom = geometry.bottom - scrollbarWidth;
		const trackHeight = trackBottom - trackTop;
		const thumbHeight = Math.max(18, trackHeight * geometry.clientHeight / geometry.scrollHeight);
		const x = geometry.right - scrollbarWidth / 2;
		const startY = trackBottom - thumbHeight / 2;
		const upperY = trackTop + trackHeight * 0.45;
		const lowerY = upperY + trackHeight * 0.2;
		await mouse("mouseMoved", x, startY, "none");
		await mouse("mousePressed", x, startY, "left");
		for (let step = 1; step <= 10; step += 1) {
			await mouse("mouseMoved", x, startY + ((upperY - startY) * step / 10), "left");
			await sleep(35);
		}
		await sleep(150);
		const beforeReverse = await measure();
		const reverseSamples = [];
		for (let step = 1; step <= 8; step += 1) {
			await mouse("mouseMoved", x, upperY + ((lowerY - upperY) * step / 8), "left");
			await sleep(35);
			reverseSamples.push(await measure());
		}
		const reversePeak = Math.max(...reverseSamples.map((sample) => sample.scrollTop));
		const reverseThreshold = Math.max(100, (beforeReverse.scrollHeight - beforeReverse.clientHeight) * 0.03);
		assert(reversePeak >= beforeReverse.scrollTop + reverseThreshold, `intentional scrollbar reversal advanced only ${reversePeak - beforeReverse.scrollTop}px`);
		await mouse("mouseReleased", x, lowerY, "left");
		await sleep(250);
		const afterRelease = await measure();
		assert(afterRelease.stickyButton, "intentional scrollbar reversal reattached to latest");
		return { beforeReverse, reverseSamples, reversePeak, reverseThreshold, afterRelease };
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

	await scenario("touch-detach-streaming", async () => {
		await returnToLatest();
		const geometry = await scrollerGeometry();
		const x = Math.round(geometry.left + geometry.width / 2);
		const startY = Math.round(geometry.top + geometry.height * 0.35);
		await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
		for (let step = 1; step <= 12; step += 1) {
			const y = Math.round(startY + geometry.height * 0.5 * step / 12);
			await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
			await sleep(25);
		}
		await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await waitFor(`Boolean(document.querySelector('button[aria-label="Scroll to latest"]'))`, 5_000, "touch detach");
		await waitForStableViewport();
		const before = await measure();
		await postStreamingFixture(40, 20, { traceSnapshots: false });
		await sleep(2_200);
		const after = await measure();
		assertAnchor(before, after, tolerance);
		assert(after.stickyButton, "touch reader reattached during streaming");
		return { before, after, offsetDeltaPx: anchorOffsetDelta(before, after) };
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
		await writeFile(resolve(artifactDir, "transient-replay-reconnect-debug.json"), JSON.stringify({ before, after }, null, 2));
		assertAnchor(before, after, tolerance);
		return { before, after, offsetDeltaPx: anchorOffsetDelta(before, after) };
	});

	await scenario("long-session-reload", async () => {
		await detachWithPageUp();
		const before = await measure();
		const readingAnchor = preferredVisibleRow(before.visible);
		assert(readingAnchor?.id, "reload fixture has no visible conceptual row");
		await sleep(250);
		const stored = await evaluate(`sessionStorage.getItem('pibo.chat.terminalReadingPosition.' + ${JSON.stringify(before.sessionId)})`);
		const storedPosition = stored ? JSON.parse(stored) : undefined;
		assert(storedPosition?.rowId === readingAnchor.id, "reading anchor was not persisted before reload");
		assert(Math.abs(storedPosition.offsetPx - readingAnchor.top) <= tolerance, `stored reading anchor drift ${storedPosition.offsetPx - readingAnchor.top}px before reload`);
		await client.send("Page.reload", { ignoreCache: true });
		await waitFor(`document.querySelector('[data-testid="virtuoso-scroller"]') !== null`, 20_000, "Terminal after reload");
		await waitFor(rowVisibleExpression(readingAnchor.id), 30_000, "restored conceptual row");
		await sleep(800);
		const after = await measure();
		await writeFile(resolve(artifactDir, "long-session-reload-debug.json"), JSON.stringify({ before, readingAnchor, storedPosition, after }, null, 2));
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
		return {sessionId:root.getAttribute('data-pibo-session-id'),cursor:root.getAttribute('data-pibo-trace-next-before'),hasOlder:root.getAttribute('data-pibo-trace-has-older'),scrollTop:scroller.scrollTop,scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,bottomGap:scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight,firstVisible:visible[0]??null,visible,stickyButton:Boolean(document.querySelector('button[aria-label="Scroll to latest"]')),renderedRows:document.querySelectorAll('[data-pibo-terminal-row="true"]').length,mode:document.querySelector('select[aria-label="Tool display mode"]')?.value};
	})()`);
}

async function startFrameRecorder() {
	return evaluate(`(() => {
		const scroller=document.querySelector('[data-testid="virtuoso-scroller"]');
		const root=document.querySelector('[data-pibo-component="CompactTerminalSessionView"]');
		if(!scroller||!root)return false;
		const started=performance.now(),frames=[],marks={};let stopped=false,lastSignature='';
		const capture=(reason)=>{if(stopped)return;const now=performance.now();const viewport=scroller.getBoundingClientRect();const rows=[...document.querySelectorAll('[data-pibo-terminal-row="true"][data-row-id]')].map((row)=>{const rect=row.getBoundingClientRect();return{id:row.getAttribute('data-row-id'),top:Math.round((rect.top-viewport.top)*10)/10,bottom:Math.round((rect.bottom-viewport.top)*10)/10};}).filter((row)=>row.bottom>-200&&row.top<scroller.clientHeight+200).sort((a,b)=>a.top-b.top);const frame={t:Math.round((now-started)*10)/10,reason,scrollTop:Math.round(scroller.scrollTop*10)/10,scrollHeight:Math.round(scroller.scrollHeight*10)/10,bottomGap:Math.round((scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight)*10)/10,cursor:root.getAttribute('data-pibo-trace-next-before'),firstVisible:rows.find((row)=>row.bottom>0)??null,rows};const signature=JSON.stringify([frame.scrollTop,frame.scrollHeight,frame.bottomGap,frame.cursor,frame.firstVisible?.id,rows.map((row)=>[row.id,row.top])]);if(reason==='raf'||signature!==lastSignature||reason==='mark'||reason==='stop'){lastSignature=signature;if(frames.length<5000)frames.push(frame);}};
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
	return evaluate(`(() => { const scroller=document.querySelector('[data-testid="virtuoso-scroller"]'); const rect=scroller.getBoundingClientRect(); return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,scrollbarWidth:scroller.offsetWidth-scroller.clientWidth,clientHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight}; })()`);
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
	const hadButton = await evaluate(`Boolean(document.querySelector('button[aria-label="Scroll to latest"]'))`);
	if (hadButton) await evaluate(`document.querySelector('button[aria-label="Scroll to latest"]')?.click()`);
	else await key("End", "End", 35);
	await waitFor(`(() => {const s=document.querySelector('[data-testid="virtuoso-scroller"]');return s && s.scrollHeight-s.scrollTop-s.clientHeight<=${tolerance} && !document.querySelector('button[aria-label="Scroll to latest"]');})()`, 8_000, "latest content");
	await sleep(350);
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
	const anchor = preferredSharedVisibleRow(before?.visible ?? [], after?.visible ?? []);
	assert(anchor, "missing shared visible anchor");
	const delta = anchor.after.top - anchor.before.top;
	assert(Math.abs(delta) <= pixelTolerance, `anchor ${anchor.before.id} offset drift ${delta}px exceeds ${pixelTolerance}px`);
}

function preferredVisibleRow(rows) {
	return [...(rows ?? [])].sort((left, right) => Math.abs(left.top) - Math.abs(right.top))[0];
}

function preferredSharedVisibleRow(beforeRows, afterRows) {
	const afterById = new Map(afterRows.map((row) => [row.id, row]));
	for (const before of [...beforeRows].sort((left, right) => Math.abs(left.top) - Math.abs(right.top))) {
		const after = afterById.get(before.id);
		if (after) return { before, after };
	}
	return undefined;
}

function anchorOffsetDelta(before, after) {
	const anchor = preferredSharedVisibleRow(before?.visible ?? [], after?.visible ?? []);
	return anchor ? anchor.after.top - anchor.before.top : Number.NaN;
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
