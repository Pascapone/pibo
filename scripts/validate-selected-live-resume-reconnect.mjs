import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectCdpTarget, listCdpTargets } from "../dist/tools/cdp-client.js";

const options = parseArgs(process.argv.slice(2));
const cdpUrl = options.cdpUrl ?? process.env.PIBO_SELECTED_LIVE_TEST_CDP_URL;
if (!cdpUrl) throw new Error("Pass --cdp-url or set PIBO_SELECTED_LIVE_TEST_CDP_URL");
const artifactDir = resolve(options.artifactDir ?? `/tmp/pibo-selected-live-resume-${Date.now()}`);
await mkdir(artifactDir, { recursive: true });

const targets = await listCdpTargets({ cdpUrl, timeoutMs: 5_000 });
const target = targets.find((item) => item.type === "page" && item.url.includes("/apps/chat/") && (!options.targetUrl || item.url.startsWith(options.targetUrl)));
if (!target) throw new Error(`No Chat Web target found at ${cdpUrl}`);
const client = await connectCdpTarget(target, 5_000);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const evaluate = (expression, timeoutMs = 10_000) => client.evaluate(expression, timeoutMs);
const report = { startedAt: new Date().toISOString(), cdpUrl, target: { id: target.id, url: target.url }, passed: false };

try {
	await client.send("Page.enable");
	await client.send("Runtime.enable");
	await evaluate(`localStorage.setItem('pibo.chat.debugStreaming','1')`);
	await client.send("Page.addScriptToEvaluateOnNewDocument", { source: eventSourceHarnessSource() });
	await client.send("Page.reload", { ignoreCache: true });
	await waitFor(`Boolean(document.querySelector('textarea') && window.__piboTestEventSources?.some((item) => item.role === 'selected-live' && item.readyState === 1))`, 30_000, "selected live stream after reload");
	await evaluate(`window.__piboStreamingDebugReset?.()`);

	const tokenPrefix = `halfopen-${Date.now()}-`;
	const deltas = Array.from({ length: 12 }, (_, index) => `${tokenPrefix}${String(index + 1).padStart(2, "0")}`);
	const fixture = await evaluate(`(() => {
		const parts=location.pathname.split('/');
		const roomId=parts[4];
		const piboSessionId=parts[6] || document.querySelector('[data-pibo-session-id]')?.getAttribute('data-pibo-session-id');
		if(!roomId||!piboSessionId) return {started:false,roomId,piboSessionId};
		window.__piboHalfOpenFixture=fetch('/api/chat/debug/streaming-fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({roomId,piboSessionId,deltas:${JSON.stringify(deltas)},cadenceMs:750,traceSnapshots:false})}).then(async(response)=>({status:response.status,body:await response.json()}));
		return {started:true,roomId,piboSessionId};
	})()`);
	assert(fixture.started, `could not start fixture: ${JSON.stringify(fixture)}`);
	await waitFor(`(window.__piboStreamingDebug?.textDeltaCount ?? 0) >= 3`, 15_000, "first three selected-live deltas");

	const beforeResume = await evaluate(`(() => {
		const streams=window.__piboTestEventSources.filter((item)=>item.role==='selected-live');
		const current=streams.at(-1);
		current.dropPibo=true;
		window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
		return {count:streams.length,url:current.url,readyState:current.readyState,receivedPibo:current.receivedPibo,suppressedPibo:current.suppressedPibo};
	})()`);
	assert(beforeResume.readyState === 1, `half-open control was not OPEN: ${JSON.stringify(beforeResume)}`);
	await sleep(2_500);
	const suppressed = await evaluate(`window.__piboTestEventSources.filter((item)=>item.role==='selected-live').at(-1)?.suppressedPibo ?? 0`);
	assert(suppressed > 0, "the half-open harness did not suppress any pibo frames");

	await evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))`);
	await waitFor(`window.__piboTestEventSources.filter((item)=>item.role==='selected-live').length >= ${beforeResume.count + 1}`, 10_000, "replacement selected-live stream");
	await waitFor(`window.__piboTestEventSources.filter((item)=>item.role==='selected-live').at(-1)?.readyState === 1`, 10_000, "replacement selected-live open");
	await evaluate(`window.__piboHalfOpenFixture`, 30_000);
	await waitFor(`(window.__piboStreamingDebug?.textDeltaCount ?? 0) >= ${deltas.length}`, 20_000, "complete replayed selected-live deltas");
	await sleep(3_000);

	const afterResume = await evaluate(`(() => {
		const streams=window.__piboTestEventSources.filter((item)=>item.role==='selected-live');
		const text=document.body.innerText;
		const tokens=${JSON.stringify(deltas)};
		return {
			streams:streams.map((item)=>({url:item.url,readyState:item.readyState,receivedPibo:item.receivedPibo,suppressedPibo:item.suppressedPibo,closed:item.closed})),
			tokenCounts:Object.fromEntries(tokens.map((token)=>[token,text.split(token).length-1])),
			debug:window.__piboStreamingDebug,
		};
	})()`);
	assert(afterResume.streams.length >= beforeResume.count + 1, "selected-live stream was not replaced");
	const replacement = afterResume.streams.at(-1);
	assert(replacement.readyState === 1, "replacement selected-live stream is not open");
	assert(/[?&](?:since|liveSince)=/.test(replacement.url), `replacement lacks a replay cursor: ${replacement.url}`);
	assert(afterResume.debug?.textDeltaCount === deltas.length, `expected ${deltas.length} selected-live deltas, got ${afterResume.debug?.textDeltaCount}`);
	const expectedOutput = deltas.join("");
	const expectedBytes = new TextEncoder().encode(expectedOutput).length;
	assert(afterResume.debug?.textDeltaBytes === expectedBytes, `replayed output bytes ${afterResume.debug?.textDeltaBytes} did not match ${expectedBytes}`);
	const replayedOutputLength = Number(afterResume.debug?.currentOutputLength ?? 0) - Number(afterResume.debug?.traceBaseOutputLength ?? 0);
	assert(replayedOutputLength === expectedOutput.length, `replayed output length ${replayedOutputLength} did not match ${expectedOutput.length}`);

	const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	await writeFile(resolve(artifactDir, "selected-live-resume.png"), Buffer.from(screenshot.data, "base64"));
	report.beforeResume = beforeResume;
	report.afterResume = afterResume;
	report.fixture = fixture;
	report.passed = true;
} catch (error) {
	report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
	const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }).catch(() => undefined);
	if (screenshot?.data) await writeFile(resolve(artifactDir, "failure.png"), Buffer.from(screenshot.data, "base64"));
	throw error;
} finally {
	report.completedAt = new Date().toISOString();
	await writeFile(resolve(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
	client.close();
	console.log(JSON.stringify({ passed: report.passed, artifactDir }, null, 2));
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

function eventSourceHarnessSource() {
	return `(() => {
		const NativeEventSource=window.EventSource;
		if(!NativeEventSource||window.__piboTestEventSources)return;
		const instances=[];
		class TestEventSource {
			static CONNECTING=NativeEventSource.CONNECTING;
			static OPEN=NativeEventSource.OPEN;
			static CLOSED=NativeEventSource.CLOSED;
			constructor(url,config){
				this.native=new NativeEventSource(url,config);
				this.url=String(url);
				this.withCredentials=this.native.withCredentials;
				this.role=this.url.includes('mode=live')&&this.url.includes('piboSessionId=')?'selected-live':this.url.includes('mode=summary')?'room-summary':'other';
				this.dropPibo=false;
				this.receivedPibo=0;
				this.suppressedPibo=0;
				this.closed=false;
				this.listenerMap=new Map();
				this.handlerMap=new Map();
				instances.push(this);
			}
			get readyState(){return this.native.readyState;}
			addEventListener(type,listener,options){
				const wrapped=(event)=>{
					if(type==='pibo'){
						this.receivedPibo+=1;
						if(this.dropPibo){this.suppressedPibo+=1;return;}
					}
					if(typeof listener==='function')listener.call(this,event);else listener?.handleEvent?.(event);
				};
				const items=this.listenerMap.get(listener)||[];
				items.push({type,wrapped,options});
				this.listenerMap.set(listener,items);
				this.native.addEventListener(type,wrapped,options);
			}
			removeEventListener(type,listener,options){
				for(const item of this.listenerMap.get(listener)||[]){if(item.type===type)this.native.removeEventListener(type,item.wrapped,options??item.options);}
				this.listenerMap.delete(listener);
			}
			close(){this.closed=true;this.native.close();}
			setHandler(type,listener){
				const existing=this.handlerMap.get(type);
				if(existing)this.removeEventListener(type,existing);
				if(listener){this.handlerMap.set(type,listener);this.addEventListener(type,listener);}else this.handlerMap.delete(type);
			}
			get onopen(){return this.handlerMap.get('open')??null;}
			set onopen(listener){this.setHandler('open',listener);}
			get onerror(){return this.handlerMap.get('error')??null;}
			set onerror(listener){this.setHandler('error',listener);}
			get onmessage(){return this.handlerMap.get('message')??null;}
			set onmessage(listener){this.setHandler('message',listener);}
		}
		window.__piboTestEventSources=instances;
		window.EventSource=TestEventSource;
	})();`;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function parseArgs(argv) {
	const parsed = {};
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			console.log("Usage: node scripts/validate-selected-live-resume-reconnect.mjs --cdp-url <url> [--target-url <prefix>] [--artifact-dir <dir>]");
			process.exit(0);
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
		if (argument === "--cdp-url") parsed.cdpUrl = value;
		else if (argument === "--target-url") parsed.targetUrl = value;
		else if (argument === "--artifact-dir") parsed.artifactDir = value;
		else throw new Error(`Unknown option ${argument}`);
		index += 1;
	}
	return parsed;
}
