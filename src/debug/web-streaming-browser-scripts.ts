import { browserStreamingBenchmarkLibrary } from "./web-streaming-browser-library.js";

export type StreamingFixtureProfile = "steady" | "jitter" | "burst" | "batch";
export type StreamingFixtureMix = "text" | "reasoning-text" | "markdown" | "gfm-markdown" | "gfm-task-markdown" | "gfm-full-markdown";

export function streamingBenchmarkEventSourceProbeScript(): string {
	return String.raw`
(() => {
  if (window.__piboStreamingBenchmarkEventSourceProbeInstalled || typeof window.EventSource !== 'function') return;
  const OriginalEventSource = window.EventSource;
  const probe = {
    createdAt: new Date().toISOString(),
    openCount: 0,
    errorCount: 0,
    closeCount: 0,
    forcedCloseCount: 0,
    textDropRequested: false,
    textDropDurationMs: undefined,
    textDropUntil: 0,
    textDropCount: 0,
    textDropTextEventCount: 0,
    events: [],
    connections: [],
  };
  Object.defineProperty(probe, '_instances', { value: [], enumerable: false, configurable: false });
  function at() { return typeof performance === 'undefined' ? Date.now() : performance.now(); }
  function isChatEventsUrl(url) { return String(url || '').includes('/api/chat/events'); }
  function pushConnection(kind, info, extra) {
    probe.connections.push({ t: at(), kind, url: info.url, ...(extra || {}) });
    if (probe.connections.length > 200) probe.connections.splice(0, probe.connections.length - 200);
  }
  function WrappedEventSource(url, init) {
    const events = new OriginalEventSource(url, init);
    const info = { url: String(url), createdAt: at(), closed: false, forcedClosing: false };
    probe._instances.push({ events, info });
    events.addEventListener('open', () => {
      probe.openCount += 1;
      pushConnection('open', info, { readyState: events.readyState });
    });
    events.addEventListener('error', () => {
      probe.errorCount += 1;
      pushConnection('error', info, { readyState: events.readyState });
    });
    events.addEventListener('pibo', (message) => {
      let payload;
      try { payload = JSON.parse(message.data); } catch {}
      const type = payload && typeof payload.type === 'string' ? payload.type : undefined;
      const record = {
        t: at(),
        url: info.url,
        lastEventId: message.lastEventId || '',
        type: typeof type === 'string' ? type : undefined,
        liveReplayId: payload && typeof payload.liveReplayId === 'number' && Number.isFinite(payload.liveReplayId) ? payload.liveReplayId : undefined,
        liveReplayReplayed: payload && payload.liveReplay && typeof payload.liveReplay.replayed === 'number' && Number.isFinite(payload.liveReplay.replayed) ? payload.liveReplay.replayed : undefined,
        liveReplayMissed: Boolean(payload && payload.liveReplay && payload.liveReplay.missed === true),
        liveReplayEvictedBefore: payload && payload.liveReplay && typeof payload.liveReplay.evictedBefore === 'number' && Number.isFinite(payload.liveReplay.evictedBefore) ? payload.liveReplay.evictedBefore : undefined,
        liveReplayRequestedAfter: payload && payload.liveReplay && typeof payload.liveReplay.requestedAfter === 'number' && Number.isFinite(payload.liveReplay.requestedAfter) ? payload.liveReplay.requestedAfter : undefined,
        liveReplayNewestAvailable: payload && payload.liveReplay && typeof payload.liveReplay.newestAvailable === 'number' && Number.isFinite(payload.liveReplay.newestAvailable) ? payload.liveReplay.newestAvailable : undefined,
      };
      probe.events.push(record);
      if (probe.events.length > 1000) probe.events.splice(0, probe.events.length - 1000);
    });
    const originalClose = events.close.bind(events);
    events.close = () => {
      if (!info.closed) {
        info.closed = true;
        probe.closeCount += 1;
        pushConnection('close', info, { forced: Boolean(info.forcedClosing), readyState: events.readyState });
      }
      return originalClose();
    };
    return events;
  }
  WrappedEventSource.prototype = OriginalEventSource.prototype;
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource);
  window.EventSource = WrappedEventSource;
  window.__piboStreamingBenchmarkMarkTextDropRequested = (durationMs) => {
    const duration = Math.max(0, Number(durationMs || 0));
    probe.textDropRequested = true;
    probe.textDropDurationMs = duration;
    probe.textDropUntil = at() + duration;
    probe.textDropCount = 0;
    probe.textDropTextEventCount = 0;
    return { durationMs: duration };
  };
  window.__piboStreamingBenchmarkForceReconnect = () => {
    let closed = 0;
    for (const entry of probe._instances) {
      if (!entry || !entry.events || !isChatEventsUrl(entry.info && entry.info.url)) continue;
      if (entry.events.readyState === 2) continue;
      entry.info.forcedClosing = true;
      probe.forcedCloseCount += 1;
      entry.events.close();
      closed += 1;
    }
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    return closed;
  };
  window.__piboStreamingBenchmarkEventSourceProbe = probe;
  window.__piboStreamingBenchmarkEventSourceProbeInstalled = true;
})();
`;
}

export function streamingBenchmarkFixtureHtml(fixtureProfile: StreamingFixtureProfile, fixtureMix: StreamingFixtureMix): string {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Streaming Benchmark Fixture</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.4} [data-pibo-component]{white-space:pre-wrap}</style>
</head>
<body data-pibo-debug="chat-app">
<h1>Streaming Benchmark Fixture</h1>
<div data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="assistant-message">hello</div>
<script>
(() => {
  function nowIso() { return new Date().toISOString(); }
  const target = document.querySelector('[data-pibo-component="MarkdownRendererHost"]');
  const textDeltas = [' a', ' b', ' c', ' d', ' e', ' f', ' g', ' h', ' i', ' j', ' k', ' l'];
  const markdownDeltas = [' **a**', ' **b**', ' **c**', ' **d**', ' **e**', ' **f**', ' **g**', ' **h**', ' **i**', ' **j**', ' **k**', ' **l**'];
  const gfmMarkdownDeltas = [' ~~a~~', ' ~~b~~', ' ~~c~~', ' ~~d~~', ' ~~e~~', ' ~~f~~', ' ~~g~~', ' ~~h~~', ' ~~i~~', ' ~~j~~', ' ~~k~~', ' ~~l~~'];
  const gfmTaskMarkdownDeltas = ['- [ ] [_**a**_](https://e.co/a)', ' [_**b**_](https://e.co/b)', ' [_**c**_](https://e.co/c)', ' [_**d**_](https://e.co/d)', ' [_**e**_](https://e.co/e)', ' [_**f**_](https://e.co/f)', ' [_**g**_](https://e.co/g)', ' [_**h**_](https://e.co/h)', ' [_**i**_](https://e.co/i)', ' [_**j**_](https://e.co/j)', ' [_**k**_](https://e.co/k)', ' [_**l**_](https://e.co/l)'];
  const gfmFullMarkdownDeltas = ['- [ ] [_~~a~~_](https://e.co/a)', ' [_~~b~~_](https://e.co/b)', ' [_~~c~~_](https://e.co/c)', ' [_~~d~~_](https://e.co/d)', ' [_~~e~~_](https://e.co/e)', ' [_~~f~~_](https://e.co/f)', ' [_~~g~~_](https://e.co/g)', ' [_~~h~~_](https://e.co/h)', ' [_~~i~~_](https://e.co/i)', ' [_~~j~~_](https://e.co/j)', ' [_~~k~~_](https://e.co/k)', ' [_~~l~~_](https://e.co/l)'];
  const cadenceMs = 100;
  const profile = ${JSON.stringify(fixtureProfile)};
  const mix = ${JSON.stringify(fixtureMix)};
  const deltas = mix === 'markdown' ? markdownDeltas : (mix === 'gfm-markdown' ? gfmMarkdownDeltas : (mix === 'gfm-task-markdown' ? gfmTaskMarkdownDeltas : (mix === 'gfm-full-markdown' ? gfmFullMarkdownDeltas : textDeltas)));
  const reasoningDeltas = mix === 'reasoning-text' ? [' think', ' plan', ' check', ' answer'] : [];
  const scheduleMs = buildSchedule(deltas.length, cadenceMs, profile);
  const reasoningScheduleMs = reasoningDeltas.map((_, index) => Math.max(10, Math.round((index + 1) * cadenceMs / 2)));
  let timers = [];
  function buildSchedule(count, cadence, timingProfile) {
    const delays = [];
    let elapsed = 0;
    for (let index = 0; index < count; index += 1) {
      let gap = cadence;
      if (timingProfile === 'jitter') {
        const jitter = [-30, 50, -20, 30, -40, 60, -10, 40, -50, 70, -20, 30][index % 12];
        gap = Math.max(10, cadence + jitter);
      } else if (timingProfile === 'burst') {
        gap = index > 0 && index % 3 !== 0 ? Math.max(10, Math.round(cadence / 5)) : Math.max(cadence, Math.round(cadence * 2.5));
      } else if (timingProfile === 'batch') {
        gap = index % 4 === 0 ? Math.max(cadence, Math.round(cadence * 3)) : 0;
      }
      elapsed += gap;
      delays.push(elapsed);
    }
    return delays;
  }
  function snapshot() {
    const now = nowIso();
    return {
      startedAt: now,
      updatedAt: now,
      eventCount: 0,
      textDeltaCount: 0,
      textDeltaBytes: 0,
      reasoningDeltaCount: 0,
      reasoningDeltaBytes: 0,
      enqueueCount: 0,
      flushCount: 0,
      flushedEventCount: 0,
      overlayUpdateCount: 0,
      overlayEventCount: 0,
      traceRefreshStartedCount: 0,
      traceRefreshCompletedCount: 0,
      traceRefreshFailedCount: 0,
      traceBaseUpdateCount: 0,
      traceBaseOutputLength: 0,
      currentOutputLength: target.textContent.length,
      lastDurableCursor: undefined,
      lastTransientLiveId: 'live:-1',
    };
  }
  window.__piboStreamingDebugReset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    target.textContent = 'hello';
    window.__piboStreamingDebug = snapshot();
    return window.__piboStreamingDebug;
  };
  window.__piboStreamingFixtureConfig = { deltaCount: deltas.length, reasoningDeltaCount: reasoningDeltas.length, cadenceMs, profile, mix, scheduleMs, reasoningScheduleMs, textBytes: deltas.join('').length, reasoningBytes: reasoningDeltas.join('').length };
  window.__piboStreamingFixtureStart = () => {
    window.__piboStreamingDebugReset();
    reasoningDeltas.forEach((delta, index) => {
      timers.push(setTimeout(() => {
        const debug = window.__piboStreamingDebug;
        const at = nowIso();
        debug.eventCount += 1;
        debug.firstEventAt ??= at;
        debug.firstReasoningDeltaAt ??= at;
        debug.reasoningDeltaCount += 1;
        debug.reasoningDeltaBytes += delta.length;
        debug.firstEnqueueAt ??= at;
        debug.enqueueCount += 1;
        debug.firstFlushAt ??= at;
        debug.flushCount += 1;
        debug.flushedEventCount += 1;
        debug.firstOverlayUpdateAt ??= at;
        debug.overlayUpdateCount += 1;
        debug.overlayEventCount += 1;
        debug.lastEventAt = at;
        debug.updatedAt = at;
        debug.lastTransientLiveId = 'live:reasoning-' + index;
      }, reasoningScheduleMs[index]));
    });
    deltas.forEach((delta, index) => {
      timers.push(setTimeout(() => {
        target.textContent += delta;
        const debug = window.__piboStreamingDebug;
        const at = nowIso();
        debug.eventCount += 1;
        debug.firstEventAt ??= at;
        debug.firstTextDeltaAt ??= at;
        debug.textDeltaCount += 1;
        debug.textDeltaBytes += delta.length;
        debug.firstEnqueueAt ??= at;
        debug.enqueueCount += 1;
        debug.firstFlushAt ??= at;
        debug.flushCount += 1;
        debug.flushedEventCount += 1;
        debug.firstOverlayUpdateAt ??= at;
        debug.overlayUpdateCount += 1;
        debug.overlayEventCount += 1;
        debug.currentOutputLength = target.textContent.length;
        debug.lastEventAt = at;
        debug.updatedAt = at;
        debug.lastTransientLiveId = 'live:' + index;
      }, scheduleMs[index]));
    });
    return window.__piboStreamingFixtureConfig;
  };
  window.__piboStreamingDebugReset();
})();
</script>
</body>
</html>`;
}

export function buildStreamingBenchmarkExpression(durationMs: number, input: { startFixture?: boolean; startBackendFixture?: boolean; fixtureProfile?: StreamingFixtureProfile; fixtureMix?: StreamingFixtureMix; fixturePreludeMessages?: number; simulateReconnect?: boolean; simulateTraceCatchup?: boolean; simulateOverlayDrop?: boolean } = {}): string {
	return `(async () => {
  const options = ${JSON.stringify({ durationMs, startFixture: Boolean(input.startFixture), startBackendFixture: Boolean(input.startBackendFixture), fixtureProfile: input.fixtureProfile ?? "steady", fixtureMix: input.fixtureMix ?? "text", fixturePreludeMessages: input.fixturePreludeMessages ?? 0, simulateReconnect: Boolean(input.simulateReconnect), simulateTraceCatchup: Boolean(input.simulateTraceCatchup), simulateOverlayDrop: Boolean(input.simulateOverlayDrop), reconnectAtMs: input.simulateReconnect ? 325 : undefined, traceCatchupDropMs: input.simulateTraceCatchup ? 1300 : undefined })};
  ${browserStreamingBenchmarkLibrary()}
  return await runStreamingBenchmark(options);
})()`;
}
