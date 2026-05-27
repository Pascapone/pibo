export function browserStreamingBenchmarkLibrary(): string {
	return String.raw`
const ASSISTANT_SELECTOR = '[data-pibo-component="MarkdownRendererHost"][data-pibo-markdown-kind="assistant-message"]';
function nowIso() { return new Date().toISOString(); }
function cloneDebugSnapshot(value) {
  if (!value || typeof value !== 'object') return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return undefined; }
}
function numericDelta(before, after, keys) {
  const delta = {};
  for (const key of keys) {
    const left = before && typeof before[key] === 'number' ? before[key] : 0;
    const right = after && typeof after[key] === 'number' ? after[key] : 0;
    delta[key] = right - left;
  }
  return delta;
}
function stats(values) {
  const nums = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!nums.length) return { count: 0 };
  const pick = (q) => nums[Math.min(nums.length - 1, Math.max(0, Math.floor((nums.length - 1) * q)))];
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return {
    count: nums.length,
    min: Math.round(nums[0] * 1000) / 1000,
    p50: Math.round(pick(0.50) * 1000) / 1000,
    p90: Math.round(pick(0.90) * 1000) / 1000,
    p99: Math.round(pick(0.99) * 1000) / 1000,
    max: Math.round(nums[nums.length - 1] * 1000) / 1000,
    avg: Math.round(avg * 1000) / 1000,
  };
}
function fetchWithTimeout(url, init, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function installOverlayDropSimulation(enabled) {
  if (!enabled) {
    delete window.__piboStreamingBenchmarkShouldDropOverlayEvent;
    delete window.__piboStreamingBenchmarkOverlayDrop;
    return undefined;
  }
  const state = {
    requested: true,
    installed: true,
    dropTypes: ['TEXT_MESSAGE_CONTENT', 'REASONING_MESSAGE_CONTENT'],
    droppedCount: 0,
    passedCount: 0,
  };
  window.__piboStreamingBenchmarkOverlayDrop = state;
  window.__piboStreamingBenchmarkShouldDropOverlayEvent = (event) => {
    const type = event && typeof event.type === 'string' ? event.type : '';
    if (state.dropTypes.includes(type)) {
      state.droppedCount += 1;
      state.lastDroppedType = type;
      return true;
    }
    state.passedCount += 1;
    return false;
  };
  return state;
}
function numberArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'number' && Number.isFinite(item)) : [];
}
function scheduleGaps(scheduleMs) {
  const gaps = [];
  let previous = 0;
  for (const delay of scheduleMs) {
    gaps.push(delay - previous);
    previous = delay;
  }
  return gaps;
}
function createSseProbe(piboSessionId, startedAt) {
  const result = {
    requested: true,
    installed: false,
    url: '/api/chat/events?piboSessionId=' + encodeURIComponent(piboSessionId) + '&mode=live&probe=streaming-benchmark-' + Date.now(),
    headers: {},
    aborted: false,
    errors: [],
    chunkCount: 0,
    chunkBytes: { count: 0 },
    chunkGapsMs: { count: 0 },
    textEventsPerChunk: { count: 0 },
    eventCount: 0,
    textEventCount: 0,
    reasoningEventCount: 0,
    textDeltaBytes: { count: 0 },
    textEventGapsMs: { count: 0 },
    idCount: 0,
    transientIdCount: 0,
    durableIdCount: 0,
    otherIdCount: 0,
  };
  const chunkBytes = [];
  const chunkGaps = [];
  const textEventsPerChunk = [];
  const textDeltaBytes = [];
  const textEventGaps = [];
  const ids = [];
  let lastChunkAt;
  let lastTextAt;
  let buffer = '';
  let stopped = false;
  let finished = false;
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const decoder = typeof TextDecoder === 'undefined' ? undefined : new TextDecoder();
  const encoder = typeof TextEncoder === 'undefined' ? undefined : new TextEncoder();
  const byteLength = (text) => encoder ? encoder.encode(text).length : String(text || '').length;
  const finalize = () => {
    result.chunkCount = chunkBytes.length;
    result.chunkBytes = stats(chunkBytes);
    result.chunkGapsMs = stats(chunkGaps);
    result.textEventsPerChunk = stats(textEventsPerChunk);
    result.textDeltaBytes = stats(textDeltaBytes);
    result.textEventGapsMs = stats(textEventGaps);
    result.idCount = ids.length;
    result.transientIdCount = ids.filter((id) => /^live:\d+$/.test(id)).length;
    result.durableIdCount = ids.filter((id) => /^\d+:\d+$/.test(id)).length;
    result.otherIdCount = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id)).length;
    result.lastEventId = ids.at(-1);
    return result;
  };
  const elapsed = (t) => Math.round((t - startedAt) * 1000) / 1000;
  const consumeBlock = (block, t) => {
    if (!block.trim()) return 0;
    let eventName = '';
    let id = '';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (id) ids.push(id);
    if (eventName && eventName !== 'pibo') return 0;
    result.eventCount += 1;
    result.firstEventMs ??= elapsed(t);
    let payload;
    try { payload = data.length ? JSON.parse(data.join('\n')) : undefined; } catch (error) { result.errors.push('parse: ' + String(error && error.message ? error.message : error)); }
    if (!payload || typeof payload.type !== 'string') return 0;
    if (payload.type === 'TEXT_MESSAGE_CONTENT') {
      result.textEventCount += 1;
      result.firstTextEventMs ??= elapsed(t);
      const delta = typeof payload.delta === 'string' ? payload.delta : '';
      textDeltaBytes.push(byteLength(delta));
      if (lastTextAt !== undefined) textEventGaps.push(t - lastTextAt);
      lastTextAt = t;
      return 1;
    }
    if (payload.type === 'REASONING_MESSAGE_CONTENT') {
      result.reasoningEventCount += 1;
      result.firstReasoningEventMs ??= elapsed(t);
    }
    return 0;
  };
  if (typeof fetch !== 'function' || !decoder) {
    result.errors.push('fetch streaming unavailable');
    return { result: finalize(), stop: async () => finalize() };
  }
  const done = (async () => {
    try {
      const response = await fetch(result.url, { headers: { accept: 'text/event-stream' }, signal: controller && controller.signal });
      result.status = response.status;
      response.headers.forEach((value, key) => { result.headers[key] = value; });
      if (!response.body || typeof response.body.getReader !== 'function') throw new Error('ReadableStream unavailable');
      result.installed = true;
      const reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const t = performance.now();
        result.firstChunkMs ??= elapsed(t);
        if (lastChunkAt !== undefined) chunkGaps.push(t - lastChunkAt);
        lastChunkAt = t;
        const value = next.value || new Uint8Array();
        chunkBytes.push(value.byteLength || value.length || 0);
        buffer += decoder.decode(value, { stream: true });
        let chunkTextEvents = 0;
        while (true) {
          const index = buffer.search(/\r?\n\r?\n/);
          if (index < 0) break;
          const separatorLength = buffer[index] === '\r' ? 4 : 2;
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + separatorLength);
          chunkTextEvents += consumeBlock(block, t);
        }
        textEventsPerChunk.push(chunkTextEvents);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consumeBlock(buffer, performance.now());
    } catch (error) {
      if (stopped || (error && error.name === 'AbortError')) result.aborted = true;
      else result.errors.push(String(error && error.message ? error.message : error));
    } finally {
      finished = true;
      finalize();
    }
  })();
  return {
    result,
    stop: async () => {
      stopped = true;
      if (controller) controller.abort();
      await Promise.race([done.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2500))]);
      if (!finished) {
        result.aborted = true;
        result.errors.push('stop timeout after abort');
      }
      return finalize();
    },
  };
}
async function waitForSseProbeReady(probe, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (!probe || probe.installed || probe.status || (probe.errors && probe.errors.length)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function createTraceProbe(piboSessionId, startedAt, intervalMs) {
  const result = {
    requested: true,
    installed: true,
    piboSessionId,
    intervalMs,
    sampleCount: 0,
    fetchCount: 0,
    failedFetchCount: 0,
    liveVersionCount: 0,
    maxAssistantOutputLength: 0,
    samples: [],
  };
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const t = Math.round(performance.now() - startedAt);
      const response = await fetchWithTimeout('/api/chat/trace?piboSessionId=' + encodeURIComponent(piboSessionId) + '&includeRawEvents=true&rawEventsLimit=80', {}, 2500);
      if (!response.ok) throw new Error(response.status + ' ' + response.statusText);
      const trace = await response.json();
      result.fetchCount += 1;
      const version = typeof trace.version === 'string' ? trace.version : undefined;
      const rawEvents = Array.isArray(trace.rawEvents) ? trace.rawEvents : [];
      const assistantOutputLength = maxTraceAssistantOutputLength(trace);
      const liveVersion = Boolean(version && version.includes(':live:'));
      const sampleResult = {
        t,
        version,
        eventCount: typeof trace.eventCount === 'number' ? trace.eventCount : undefined,
        rawEventCount: rawEvents.length,
        assistantOutputLength,
        liveVersion,
        rawEventTypes: countRawTraceEventTypes(rawEvents),
      };
      result.samples.push(sampleResult);
      if (result.samples.length > 80) result.samples.shift();
      result.sampleCount = result.samples.length;
      result.maxAssistantOutputLength = Math.max(result.maxAssistantOutputLength, assistantOutputLength);
      result.finalAssistantOutputLength = assistantOutputLength;
      if (typeof sampleResult.eventCount === 'number') {
        result.durableEventCountStart ??= sampleResult.eventCount;
        result.durableEventCountEnd = sampleResult.eventCount;
      }
      if (liveVersion) {
        result.liveVersionCount += 1;
        result.firstLiveVersionMs ??= t;
      }
    } catch {
      result.failedFetchCount += 1;
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => { sample().catch(() => {}); }, intervalMs);
  return { result, sample, stop: () => clearInterval(timer) };
}
function countRawTraceEventTypes(rawEvents) {
  const counts = {};
  for (const event of rawEvents) {
    const type = typeof event?.type === 'string' ? event.type : (typeof event?.payload?.type === 'string' ? event.payload.type : 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
function maxTraceAssistantOutputLength(trace) {
  let max = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'assistant.message' && typeof node.output === 'string') max = Math.max(max, node.output.length);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  if (Array.isArray(trace?.nodes)) trace.nodes.forEach(visit);
  return max;
}
function summarizeEventSourceProbe(startedAt, requested, forcedReconnectAtMs, textDropRequested, textDropDurationMs) {
  const probe = window.__piboStreamingBenchmarkEventSourceProbe;
  if (!requested) return undefined;
  if (!probe) {
    return {
      requested,
      installed: false,
      forcedReconnectAtMs,
      openCount: 0,
      openCountAfterStart: 0,
      errorCount: 0,
      errorCountAfterStart: 0,
      closeCount: 0,
      forcedCloseCount: 0,
      forcedCloseCountAfterStart: 0,
      eventCount: 0,
      eventCountAfterStart: 0,
      textEventCount: 0,
      textEventCountAfterStart: 0,
      reasoningEventCount: 0,
      reasoningEventCountAfterStart: 0,
      transientIdCount: 0,
      uniqueTransientIdCount: 0,
      transientIdCountAfterStart: 0,
      uniqueTransientIdCountAfterStart: 0,
      durableIdCount: 0,
      otherIdCount: 0,
      transientIdResetObserved: false,
      reconnectObserved: false,
      textDropRequested: Boolean(textDropRequested),
      textDropDurationMs,
      textDropCount: 0,
      textDropTextEventCount: 0,
      streams: [],
    };
  }
  const streamEvents = (Array.isArray(probe.events) ? probe.events : []).filter((event) => String(event.url || '').includes('/api/chat/events'));
  const afterStartStreamEvents = streamEvents.filter((event) => typeof event.t === 'number' && event.t >= startedAt);
  const afterStartConnections = (Array.isArray(probe.connections) ? probe.connections : []).filter((event) => typeof event.t === 'number' && event.t >= startedAt && String(event.url || '').includes('/api/chat/events'));
  const ids = streamEvents.map((event) => event.lastEventId).filter(Boolean);
  const afterStartIds = afterStartStreamEvents.map((event) => event.lastEventId).filter(Boolean);
  const transientIds = ids.filter((id) => /^live:\d+$/.test(id));
  const afterStartTransientIds = afterStartIds.filter((id) => /^live:\d+$/.test(id));
  const durableIds = ids.filter((id) => /^\d+:\d+$/.test(id));
  const otherIds = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id));
  const firstEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt);
  const firstTextEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt, 'TEXT_MESSAGE_CONTENT');
  const firstReasoningEventMsAfterStart = firstProbeEventMs(afterStartStreamEvents, startedAt, 'REASONING_MESSAGE_CONTENT');
  const forcedCloseCountAfterStart = afterStartConnections.filter((event) => event.kind === 'close' && event.forced).length;
  const openCountAfterStart = afterStartConnections.filter((event) => event.kind === 'open').length;
  const streams = summarizeEventSourceStreams(streamEvents, afterStartConnections, startedAt);
  return {
    requested,
    installed: true,
    forcedReconnectAtMs,
    openCount: Number(probe.openCount || 0),
    openCountAfterStart,
    errorCount: Number(probe.errorCount || 0),
    errorCountAfterStart: afterStartConnections.filter((event) => event.kind === 'error').length,
    closeCount: Number(probe.closeCount || 0),
    forcedCloseCount: Number(probe.forcedCloseCount || 0),
    forcedCloseCountAfterStart,
    eventCount: streamEvents.length,
    eventCountAfterStart: afterStartStreamEvents.length,
    textEventCount: streamEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
    textEventCountAfterStart: afterStartStreamEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
    reasoningEventCount: streamEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
    reasoningEventCountAfterStart: afterStartStreamEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
    transientIdCount: transientIds.length,
    uniqueTransientIdCount: new Set(transientIds).size,
    transientIdCountAfterStart: afterStartTransientIds.length,
    uniqueTransientIdCountAfterStart: new Set(afterStartTransientIds).size,
    durableIdCount: durableIds.length,
    otherIdCount: otherIds.length,
    lastEventId: ids.at(-1),
    firstTransientId: transientIds[0],
    firstEventMsAfterStart,
    firstTextEventMsAfterStart,
    firstReasoningEventMsAfterStart,
    lastTransientId: transientIds.at(-1),
    transientIdResetObserved: new Set(transientIds).size < transientIds.length,
    reconnectObserved: forcedCloseCountAfterStart > 0 && openCountAfterStart > 0,
    textDropRequested: Boolean(textDropRequested),
    textDropDurationMs: textDropRequested ? Number(probe.textDropDurationMs || textDropDurationMs || 0) || undefined : undefined,
    textDropCount: textDropRequested ? Number(probe.textDropCount || 0) : 0,
    textDropTextEventCount: textDropRequested ? Number(probe.textDropTextEventCount || 0) : 0,
    streams,
  };
}
function firstProbeEventMs(events, startedAt, type) {
  const event = events.find((item) => typeof item.t === 'number' && (type === undefined || item.type === type));
  return event ? Math.round((event.t - startedAt) * 1000) / 1000 : undefined;
}
function summarizeEventSourceStreams(streamEvents, afterStartConnections, startedAt) {
  const groups = new Map();
  const ensureGroup = (rawUrl) => {
    const parsed = parseChatEventsProbeUrl(rawUrl);
    const key = [parsed.role, parsed.piboSessionId || '', parsed.roomId || '', parsed.mode || '', parsed.url].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        url: parsed.url,
        mode: parsed.mode,
        role: parsed.role,
        piboSessionId: parsed.piboSessionId,
        roomId: parsed.roomId,
        sinceValues: [],
        liveSinceValues: [],
        openCountAfterStart: 0,
        errorCountAfterStart: 0,
        closeCountAfterStart: 0,
        forcedCloseCountAfterStart: 0,
        events: [],
      };
      groups.set(key, group);
    }
    if (parsed.since && !group.sinceValues.includes(parsed.since)) group.sinceValues.push(parsed.since);
    if (parsed.liveSince && !group.liveSinceValues.includes(parsed.liveSince)) group.liveSinceValues.push(parsed.liveSince);
    return group;
  };
  for (const event of streamEvents) ensureGroup(event.url).events.push(event);
  for (const connection of afterStartConnections) {
    const group = ensureGroup(connection.url);
    if (connection.kind === 'open') group.openCountAfterStart += 1;
    else if (connection.kind === 'error') group.errorCountAfterStart += 1;
    else if (connection.kind === 'close') {
      group.closeCountAfterStart += 1;
      if (connection.forced) group.forcedCloseCountAfterStart += 1;
    }
  }
  return Array.from(groups.values()).map((group) => {
    const events = group.events;
    const afterStartEvents = events.filter((event) => typeof event.t === 'number' && event.t >= startedAt);
    const ids = events.map((event) => event.lastEventId).filter(Boolean);
    const afterStartIds = afterStartEvents.map((event) => event.lastEventId).filter(Boolean);
    const transientIds = ids.filter((id) => /^live:\d+$/.test(id));
    const afterStartTransientIds = afterStartIds.filter((id) => /^live:\d+$/.test(id));
    const liveReplayReplayedCount = events.reduce((total, event) => total + (typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0), 0);
    const liveReplayReplayedCountAfterStart = afterStartEvents.reduce((total, event) => total + (typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0), 0);
    const liveReplayMisses = events.filter((event) => event.liveReplayMissed === true);
    const afterStartLiveReplayMisses = afterStartEvents.filter((event) => event.liveReplayMissed === true);
    const liveReplayDuplicateCount = countLiveReplayDuplicateIds(events);
    const liveReplayDuplicateCountAfterStart = countLiveReplayDuplicateIds(events, startedAt);
    const liveReplayEvictedBeforeValues = events.map((event) => event.liveReplayEvictedBefore).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const liveReplayCursorLagValues = events.map((event) => typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) && typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? Math.max(0, event.liveReplayNewestAvailable - event.liveReplayRequestedAfter) : undefined).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const afterStartLiveReplayCursorLagValues = afterStartEvents.map((event) => typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) && typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? Math.max(0, event.liveReplayNewestAvailable - event.liveReplayRequestedAfter) : undefined).filter((value) => typeof value === 'number' && Number.isFinite(value));
    const firstEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt);
    const firstTextEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt, 'TEXT_MESSAGE_CONTENT');
    const firstReasoningEventMsAfterStart = firstProbeEventMs(afterStartEvents, startedAt, 'REASONING_MESSAGE_CONTENT');
    const durableIds = ids.filter((id) => /^\d+:\d+$/.test(id));
    const otherIds = ids.filter((id) => !/^live:\d+$/.test(id) && !/^\d+:\d+$/.test(id));
    return {
      url: group.url,
      mode: group.mode,
      role: group.role,
      piboSessionId: group.piboSessionId,
      roomId: group.roomId,
      sinceValues: group.sinceValues,
      liveSinceValues: group.liveSinceValues,
      openCountAfterStart: group.openCountAfterStart,
      errorCountAfterStart: group.errorCountAfterStart,
      closeCountAfterStart: group.closeCountAfterStart,
      forcedCloseCountAfterStart: group.forcedCloseCountAfterStart,
      eventCount: events.length,
      eventCountAfterStart: afterStartEvents.length,
      textEventCount: events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
      textEventCountAfterStart: afterStartEvents.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT').length,
      reasoningEventCount: events.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
      reasoningEventCountAfterStart: afterStartEvents.filter((event) => event.type === 'REASONING_MESSAGE_CONTENT').length,
      transientIdCount: transientIds.length,
      uniqueTransientIdCount: new Set(transientIds).size,
      transientIdCountAfterStart: afterStartTransientIds.length,
      uniqueTransientIdCountAfterStart: new Set(afterStartTransientIds).size,
      durableIdCount: durableIds.length,
      otherIdCount: otherIds.length,
      liveReplayEventCount: liveReplayReplayedCount,
      liveReplayEventCountAfterStart: liveReplayReplayedCountAfterStart,
      liveReplayMissedCount: liveReplayMisses.length,
      liveReplayMissedCountAfterStart: afterStartLiveReplayMisses.length,
      liveReplayDuplicateCount,
      liveReplayDuplicateCountAfterStart,
      liveReplayEvictedBeforeMax: liveReplayEvictedBeforeValues.length ? Math.max(...liveReplayEvictedBeforeValues) : undefined,
      liveReplayCursorLagMax: liveReplayCursorLagValues.length ? Math.max(...liveReplayCursorLagValues) : undefined,
      liveReplayCursorLagMaxAfterStart: afterStartLiveReplayCursorLagValues.length ? Math.max(...afterStartLiveReplayCursorLagValues) : undefined,
      lastEventId: ids.at(-1),
      firstEventMsAfterStart,
      firstTextEventMsAfterStart,
      firstReasoningEventMsAfterStart,
    };
  }).sort((left, right) => roleSort(left.role) - roleSort(right.role) || left.url.localeCompare(right.url));
}
function countLiveReplayDuplicateIds(events, startedAt) {
  const seen = new Set();
  let duplicateCount = 0;
  const ordered = events.slice().sort((left, right) => Number(left.t || 0) - Number(right.t || 0));
  for (const event of ordered) {
    const requestedAfter = typeof event.liveReplayRequestedAfter === 'number' && Number.isFinite(event.liveReplayRequestedAfter) ? event.liveReplayRequestedAfter : undefined;
    const newestAvailable = typeof event.liveReplayNewestAvailable === 'number' && Number.isFinite(event.liveReplayNewestAvailable) ? event.liveReplayNewestAvailable : undefined;
    const replayed = typeof event.liveReplayReplayed === 'number' && Number.isFinite(event.liveReplayReplayed) ? event.liveReplayReplayed : 0;
    const countThisStatus = startedAt === undefined || (typeof event.t === 'number' && event.t >= startedAt);
    if (countThisStatus && replayed > 0 && requestedAfter !== undefined && newestAvailable !== undefined) {
      for (const replayId of seen) {
        if (replayId > requestedAfter && replayId <= newestAvailable) duplicateCount += 1;
      }
    }
    if (typeof event.liveReplayId === 'number' && Number.isFinite(event.liveReplayId)) seen.add(event.liveReplayId);
  }
  return duplicateCount;
}
function parseChatEventsProbeUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || ''), location.href); } catch { parsed = new URL('/api/chat/events', location.href); }
  const params = parsed.searchParams;
  const mode = params.get('mode') || undefined;
  const piboSessionId = params.get('piboSessionId') || undefined;
  const roomId = params.get('roomId') || undefined;
  const role = mode === 'summary' || (roomId && !piboSessionId) ? 'room-summary' : (mode === 'live' || piboSessionId ? 'selected-live' : 'chat-events');
  const withoutResume = new URL(parsed.href);
  withoutResume.searchParams.delete('since');
  withoutResume.searchParams.delete('liveSince');
  return {
    url: withoutResume.pathname + (withoutResume.search ? withoutResume.search : ''),
    mode,
    role,
    piboSessionId,
    roomId,
    since: params.get('since') || undefined,
    liveSince: params.get('liveSince') || undefined,
  };
}
function roleSort(role) {
  if (role === 'selected-live') return 0;
  if (role === 'room-summary') return 1;
  return 2;
}
function streamingBenchmarkRegressions(result) {
  const failures = [];
  const fixture = result.fixture;
  const expectedDeltas = fixture && typeof fixture.deltaCount === 'number' ? fixture.deltaCount : undefined;
  const expectedReasoningDeltas = fixture && typeof fixture.reasoningDeltaCount === 'number' ? fixture.reasoningDeltaCount : undefined;
  const cadenceMs = fixture && typeof fixture.cadenceMs === 'number' ? fixture.cadenceMs : 100;
  const textDeltas = result.debugDelta && typeof result.debugDelta.textDeltaCount === 'number' ? result.debugDelta.textDeltaCount : 0;
  const reasoningDeltas = result.debugDelta && typeof result.debugDelta.reasoningDeltaCount === 'number' ? result.debugDelta.reasoningDeltaCount : 0;
  const domPositive = result.dom.positiveUpdateCount || 0;
  const domGapP90 = result.dom.gapsMs && typeof result.dom.gapsMs.p90 === 'number' ? result.dom.gapsMs.p90 : undefined;
  const domJumpMax = result.dom.positiveCharJumps && typeof result.dom.positiveCharJumps.max === 'number' ? result.dom.positiveCharJumps.max : undefined;
  const firstPositiveMs = typeof result.dom.firstPositiveUpdateMs === 'number' ? result.dom.firstPositiveUpdateMs : undefined;
  const longTaskMax = result.longTasks.length ? Math.max(...result.longTasks) : 0;
  const traceCatchupRequested = Boolean(result.eventSource && result.eventSource.textDropRequested);
  const reconnectRequested = Boolean(result.eventSource && typeof result.eventSource.forcedReconnectAtMs === 'number');
  if (!result.debugAfter) failures.push('debug counters unavailable');
  if (fixture) {
    if (!fixture.available) failures.push('fixture unavailable');
    if (!fixture.started) failures.push('fixture did not start');
    if (fixture.error) failures.push('fixture error: ' + fixture.error);
    if (!traceCatchupRequested && expectedDeltas !== undefined && textDeltas < expectedDeltas) failures.push('text deltas ' + textDeltas + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && expectedReasoningDeltas !== undefined && reasoningDeltas < expectedReasoningDeltas) failures.push('reasoning deltas ' + reasoningDeltas + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (!traceCatchupRequested && expectedDeltas !== undefined && domPositive < Math.max(1, expectedDeltas - 2)) failures.push('positive DOM updates ' + domPositive + ' < ' + Math.max(1, expectedDeltas - 2));
    if (!traceCatchupRequested && domGapP90 !== undefined && domGapP90 > Math.max(300, cadenceMs * 3)) failures.push('DOM p90 gap ' + domGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && domJumpMax !== undefined && domJumpMax > 4) failures.push('DOM max jump ' + domJumpMax + ' chars exceeds gate');
    if (!traceCatchupRequested && firstPositiveMs !== undefined && firstPositiveMs > 500) failures.push('first visible update ' + firstPositiveMs + 'ms exceeds gate');
    if (traceCatchupRequested) {
      const traceRefreshes = result.debugDelta && typeof result.debugDelta.traceRefreshCompletedCount === 'number' ? result.debugDelta.traceRefreshCompletedCount : 0;
      if (traceRefreshes < 1) failures.push('trace catch-up did not complete a trace refresh');
      const maxVisibleLength = result.dom && typeof result.dom.lengthMax === 'number' ? result.dom.lengthMax : result.dom && result.dom.lengthEnd;
      if (!result.dom || !(maxVisibleLength > result.dom.lengthStart)) failures.push('trace catch-up did not advance visible DOM output');
      if (expectedDeltas !== undefined && textDeltas > Math.max(1, expectedDeltas - 2)) failures.push('trace catch-up did not suppress live text deltas before recovery');
      if (!result.trace) failures.push('trace catch-up trace probe unavailable');
      else {
        if (result.trace.sampleCount < 1 || result.trace.fetchCount < 1) failures.push('trace catch-up trace probe did not fetch samples');
        if (result.trace.liveVersionCount < 1) failures.push('trace catch-up trace probe did not observe live snapshot version');
        if (result.trace.maxAssistantOutputLength < 1) failures.push('trace catch-up trace probe did not observe assistant output');
      }
    }
  }
  if (result.eventSource && result.eventSource.requested) {
    if (!result.eventSource.installed) failures.push('EventSource probe unavailable');
    const selectedLiveStreams = Array.isArray(result.eventSource.streams) ? result.eventSource.streams.filter((stream) => stream.role === 'selected-live') : [];
    const selectedLive = selectedLiveStreams.length > 1
      ? selectedLiveStreams.reduce((total, stream) => ({
          textEventCountAfterStart: total.textEventCountAfterStart + (stream.textEventCountAfterStart || 0),
          reasoningEventCountAfterStart: total.reasoningEventCountAfterStart + (stream.reasoningEventCountAfterStart || 0),
          liveReplayEventCountAfterStart: total.liveReplayEventCountAfterStart + (stream.liveReplayEventCountAfterStart || 0),
          liveReplayMissedCountAfterStart: total.liveReplayMissedCountAfterStart + (stream.liveReplayMissedCountAfterStart || 0),
          liveReplayDuplicateCountAfterStart: total.liveReplayDuplicateCountAfterStart + (stream.liveReplayDuplicateCountAfterStart || 0),
          liveSinceValues: Array.from(new Set(total.liveSinceValues.concat(stream.liveSinceValues || []))),
        }), { textEventCountAfterStart: 0, reasoningEventCountAfterStart: 0, liveReplayEventCountAfterStart: 0, liveReplayMissedCountAfterStart: 0, liveReplayDuplicateCountAfterStart: 0, liveSinceValues: [] })
      : selectedLiveStreams[0];
    if (!selectedLive) failures.push('EventSource selected-live stream was not observed');
    if (!traceCatchupRequested && selectedLive && expectedDeltas !== undefined && selectedLive.textEventCountAfterStart < expectedDeltas) failures.push('selected-live text events after start ' + selectedLive.textEventCountAfterStart + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && selectedLive && expectedReasoningDeltas !== undefined && selectedLive.reasoningEventCountAfterStart < expectedReasoningDeltas) failures.push('selected-live reasoning events after start ' + selectedLive.reasoningEventCountAfterStart + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (traceCatchupRequested) {
      if (selectedLive && selectedLive.textEventCountAfterStart > Math.max(1, (expectedDeltas || 0) - 2)) failures.push('trace catch-up selected-live text was not suppressed');
    } else {
      if (reconnectRequested && result.eventSource.forcedCloseCountAfterStart < 1) failures.push('EventSource forced close was not observed');
      if (reconnectRequested && result.eventSource.openCountAfterStart < 1) failures.push('EventSource reconnect open was not observed');
      if (reconnectRequested && selectedLive && (selectedLive.liveReplayMissedCountAfterStart || 0) > 0) failures.push('selected-live transient replay missed buffered events');
      if (reconnectRequested && selectedLive && (selectedLive.liveReplayDuplicateCountAfterStart || 0) > 0) failures.push('selected-live transient replay duplicated already observed frames');
      if (reconnectRequested && selectedLive && (selectedLive.liveSinceValues || []).length > 0 && (selectedLive.liveReplayEventCountAfterStart || 0) < 1) failures.push('selected-live transient replay cursor did not replay buffered events');
      if (result.eventSource.transientIdCountAfterStart < 1) failures.push('EventSource transient live ids were not observed');
    }
  }
  if (result.sse && result.sse.requested) {
    if (!result.sse.installed) failures.push('SSE fetch probe unavailable');
    if (result.sse.status && result.sse.status !== 200) failures.push('SSE fetch status ' + result.sse.status);
    if (result.sse.headers && String(result.sse.headers['x-accel-buffering'] || '').toLowerCase() !== 'no') failures.push('SSE X-Accel-Buffering header is not no');
    if (result.sse.errors && result.sse.errors.length) failures.push('SSE fetch errors: ' + result.sse.errors.slice(0, 2).join('; '));
    if (!traceCatchupRequested && expectedDeltas !== undefined && result.sse.textEventCount < expectedDeltas) failures.push('SSE text events ' + result.sse.textEventCount + ' < fixture deltas ' + expectedDeltas);
    if (!traceCatchupRequested && expectedReasoningDeltas !== undefined && result.sse.reasoningEventCount < expectedReasoningDeltas) failures.push('SSE reasoning events ' + result.sse.reasoningEventCount + ' < fixture reasoning deltas ' + expectedReasoningDeltas);
    if (!traceCatchupRequested && expectedDeltas !== undefined && result.sse.transientIdCount < expectedDeltas) failures.push('SSE transient live ids ' + result.sse.transientIdCount + ' < fixture deltas ' + expectedDeltas);
    const sseGapGate = Math.max(300, cadenceMs * 3);
    const sseChunkGapP90 = result.sse.chunkGapsMs && typeof result.sse.chunkGapsMs.p90 === 'number' ? result.sse.chunkGapsMs.p90 : undefined;
    const sseTextGapP90 = result.sse.textEventGapsMs && typeof result.sse.textEventGapsMs.p90 === 'number' ? result.sse.textEventGapsMs.p90 : undefined;
    const sseTextPerChunkP90 = result.sse.textEventsPerChunk && typeof result.sse.textEventsPerChunk.p90 === 'number' ? result.sse.textEventsPerChunk.p90 : undefined;
    if (!traceCatchupRequested && sseChunkGapP90 !== undefined && sseChunkGapP90 > sseGapGate) failures.push('SSE chunk p90 gap ' + sseChunkGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && sseTextGapP90 !== undefined && sseTextGapP90 > sseGapGate) failures.push('SSE text p90 gap ' + sseTextGapP90 + 'ms exceeds gate');
    if (!traceCatchupRequested && sseTextPerChunkP90 !== undefined && sseTextPerChunkP90 > 2) failures.push('SSE text events per chunk p90 ' + sseTextPerChunkP90 + ' exceeds gate');
  }
  if (longTaskMax > 50) failures.push('long task max ' + Math.round(longTaskMax * 1000) / 1000 + 'ms exceeds 50ms');
  return failures;
}
function assistantTargets() {
  return Array.from(document.querySelectorAll(ASSISTANT_SELECTOR));
}
function selectedAssistantText(initialTargets, ignorePreludeTargets) {
  const targets = assistantTargets();
  const texts = [];
  for (const target of targets) {
    if (initialTargets && initialTargets.has(target)) continue;
    const text = target.innerText || target.textContent || '';
    if (ignorePreludeTargets && /\bprelude\b/i.test(text)) continue;
    texts.push(text);
  }
  return texts.join('\n');
}
async function waitForAssistantDomSettle(timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastText = selectedAssistantText();
  let stableSamples = 0;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = selectedAssistantText();
    if (text === lastText) {
      stableSamples += 1;
      if (stableSamples >= 5) return;
    } else {
      stableSamples = 0;
      lastText = text;
    }
  }
}
async function runStreamingBenchmark(options) {
  const warnings = [];
  const selectedSessionId = () => document.querySelector('[data-pibo-debug="chat-shell"]')?.getAttribute('data-pibo-session-id')
    || document.querySelector('[data-pibo-selected-session-id]')?.getAttribute('data-pibo-selected-session-id')
    || undefined;
  let reset = false;
  let backendPreludeError;
  let backendPreludeConfig;
  try { localStorage.setItem('pibo.chat.debugStreaming', '1'); } catch (error) { warnings.push('failed to set debugStreaming localStorage: ' + String(error)); }
  if (options.startBackendFixture && options.fixturePreludeMessages > 0) {
    const piboSessionId = selectedSessionId();
    if (!piboSessionId) {
      backendPreludeError = 'selected Chat session not found in DOM';
      warnings.push('backend streaming fixture prelude was requested but selected Chat session was not found');
    } else {
      try {
        const response = await fetchWithTimeout('/api/chat/debug/streaming-fixture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ piboSessionId, preludeOnly: true, preludeMessages: options.fixturePreludeMessages }),
        }, 10000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : response.status + ' ' + response.statusText);
        backendPreludeConfig = payload.fixture || payload;
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, Math.max(1000, options.fixturePreludeMessages * 5))));
        await waitForAssistantDomSettle(Math.min(8000, Math.max(1000, options.fixturePreludeMessages * 5)));
      } catch (error) {
        backendPreludeError = String(error && error.message ? error.message : error);
        warnings.push('failed to start backend streaming fixture prelude: ' + backendPreludeError);
      }
    }
  }
  const fixtureDomInitialTargets = options.startBackendFixture ? new WeakSet(assistantTargets()) : undefined;
  const ignorePreludeDomTargets = Boolean(options.startBackendFixture && options.fixturePreludeMessages > 0);
  const startedAt = performance.now();
  const debugStateBeforeReset = cloneDebugSnapshot(window.__piboStreamingDebug);
  if (typeof window.__piboStreamingDebugReset === 'function') {
    try { window.__piboStreamingDebugReset(); reset = true; } catch (error) { warnings.push('failed to reset __piboStreamingDebug: ' + String(error)); }
  }
  const overlayDrop = installOverlayDropSimulation(Boolean(options.simulateOverlayDrop));

  const debugBefore = cloneDebugSnapshot(window.__piboStreamingDebug);
  const initialText = selectedAssistantText(fixtureDomInitialTargets, ignorePreludeDomTargets);
  const targetCountStart = assistantTargets().length;
  const updates = [];
  const positiveJumps = [];
  let currentLength = initialText.length;
  let maxLength = initialText.length;
  let lastPositiveAt;
  let firstPositiveUpdateMs;
  const sample = () => {
    const text = selectedAssistantText(fixtureDomInitialTargets, ignorePreludeDomTargets);
    const length = text.length;
    if (length === currentLength) return;
    maxLength = Math.max(maxLength, length);
    const t = performance.now() - startedAt;
    const delta = length - currentLength;
    updates.push({ t, length, delta });
    if (delta > 0) {
      positiveJumps.push(delta);
      firstPositiveUpdateMs ??= t;
      lastPositiveAt = t;
    }
    currentLength = length;
  };
  const observer = new MutationObserver(sample);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  const rafGaps = [];
  let rafCount = 0;
  let lastRaf;
  let rafHandle;
  const onRaf = (t) => {
    rafCount += 1;
    if (lastRaf !== undefined) rafGaps.push(t - lastRaf);
    lastRaf = t;
    rafHandle = requestAnimationFrame(onRaf);
  };
  rafHandle = requestAnimationFrame(onRaf);

  const longTasks = [];
  let perfObserver;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration || 0);
      });
      perfObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      warnings.push('longtask PerformanceObserver unavailable');
    }
  } else {
    warnings.push('PerformanceObserver unavailable');
  }

  let fixtureStarted = false;
  let fixtureConfig;
  let backendFixtureError;
  let traceProbe;
  let sseProbe;
  if (options.startFixture) {
    if (typeof window.__piboStreamingFixtureStart === 'function') {
      try { fixtureConfig = window.__piboStreamingFixtureStart(); fixtureStarted = true; } catch (error) { warnings.push('failed to start streaming fixture: ' + String(error)); }
    } else {
      warnings.push('streaming fixture was requested but window.__piboStreamingFixtureStart is unavailable');
    }
  } else if (options.startBackendFixture) {
    if (options.simulateReconnect && typeof window.__piboStreamingBenchmarkForceReconnect === 'function') {
      setTimeout(() => {
        try { window.__piboStreamingBenchmarkForceReconnect(); } catch (error) { warnings.push('failed to force EventSource reconnect: ' + String(error)); }
      }, options.reconnectAtMs || 325);
    } else if (options.simulateReconnect) {
      warnings.push('EventSource reconnect simulation was requested but the probe is unavailable');
    }
    if (options.simulateTraceCatchup && typeof window.__piboStreamingBenchmarkMarkTextDropRequested === 'function') {
      try { window.__piboStreamingBenchmarkMarkTextDropRequested(options.traceCatchupDropMs || 1300); } catch (error) { warnings.push('failed to mark EventSource text drop request: ' + String(error)); }
    } else if (options.simulateTraceCatchup) {
      warnings.push('trace catch-up simulation was requested but the EventSource probe is unavailable');
    }
    const piboSessionId = selectedSessionId();
    if (options.simulateTraceCatchup && piboSessionId) {
      traceProbe = createTraceProbe(piboSessionId, startedAt, 250);
      await traceProbe.sample();
    }
    if (!piboSessionId) {
      backendFixtureError = 'selected Chat session not found in DOM';
      warnings.push('backend streaming fixture was requested but selected Chat session was not found');
    } else {
      sseProbe = createSseProbe(piboSessionId, startedAt);
      await waitForSseProbeReady(sseProbe.result, 500);
      try {
        const response = await fetchWithTimeout('/api/chat/debug/streaming-fixture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ piboSessionId, profile: options.fixtureProfile, mix: options.fixtureMix, ...((options.simulateReconnect || options.simulateTraceCatchup) ? { cadenceMs: 150 } : {}), ...(options.simulateTraceCatchup ? { traceSnapshots: true, suppressLiveDeltas: true } : {}) }),
        }, options.simulateTraceCatchup ? 15000 : 5000);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : response.status + ' ' + response.statusText);
        fixtureConfig = payload.fixture || payload;
        fixtureStarted = true;
      } catch (error) {
        backendFixtureError = String(error && error.message ? error.message : error);
        warnings.push('failed to start backend streaming fixture: ' + backendFixtureError);
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, options.durationMs));
  sample();
  if (traceProbe) {
    await traceProbe.sample();
    traceProbe.stop();
  }
  const sseSummary = sseProbe ? await sseProbe.stop() : undefined;
  observer.disconnect();
  if (rafHandle !== undefined) cancelAnimationFrame(rafHandle);
  try { perfObserver && perfObserver.disconnect(); } catch {}

  const debugAfter = cloneDebugSnapshot(window.__piboStreamingDebug);
  const overlayDropSummary = overlayDrop ? cloneDebugSnapshot(window.__piboStreamingBenchmarkOverlayDrop) : undefined;
  installOverlayDropSimulation(false);
  if (!debugAfter) warnings.push('window.__piboStreamingDebug was absent; run with ?debugStreaming=1 or start a fresh stream after this command enables localStorage');
  const positiveUpdates = updates.filter((update) => update.delta > 0);
  const positiveGaps = [];
  for (let i = 1; i < positiveUpdates.length; i++) positiveGaps.push(positiveUpdates[i].t - positiveUpdates[i - 1].t);
  const debugDelta = numericDelta(debugBefore, debugAfter, [
    'liveOpenCount',
    'liveErrorCount',
    'eventCount',
    'textDeltaCount',
    'textDeltaBytes',
    'reasoningDeltaCount',
    'reasoningDeltaBytes',
    'enqueueCount',
    'flushCount',
    'flushedEventCount',
    'overlayUpdateCount',
    'liveTraceComputeCount',
    'liveTraceComputeDurationMsTotal',
    'markdownRenderCount',
    'markdownRenderPlainCount',
    'markdownRenderFullCount',
    'markdownRenderCommonMarkCount',
    'markdownRenderGfmCount',
    'markdownRenderGfmFastCount',
    'markdownRenderDurationMsTotal',
    'markdownRenderCommonMarkDurationMsTotal',
    'markdownRenderGfmDurationMsTotal',
    'markdownRenderGfmFastDurationMsTotal',
    'traceRefreshStartedCount',
    'traceRefreshCompletedCount',
    'traceRefreshFailedCount',
    'traceBaseUpdateCount',
  ]);
  const domGaps = stats(positiveGaps);
  const domJumps = stats(positiveJumps);
  const fixtureScheduleMs = numberArray(fixtureConfig && fixtureConfig.scheduleMs);
  const fixtureReasoningScheduleMs = numberArray(fixtureConfig && fixtureConfig.reasoningScheduleMs);
  const fixtureSummary = (options.startFixture || options.startBackendFixture) ? {
    requested: true,
    mode: options.startBackendFixture ? 'backend' : 'browser',
    profile: fixtureConfig && typeof fixtureConfig.profile === 'string' ? fixtureConfig.profile : options.fixtureProfile,
    mix: fixtureConfig && typeof fixtureConfig.mix === 'string' ? fixtureConfig.mix : options.fixtureMix,
    simulation: options.simulateTraceCatchup ? 'trace-catchup' : (options.simulateReconnect ? 'reconnect' : (options.simulateOverlayDrop ? 'overlay-drop' : undefined)),
    available: options.startBackendFixture ? !backendFixtureError : typeof window.__piboStreamingFixtureStart === 'function',
    started: fixtureStarted,
    deltaCount: fixtureConfig && typeof fixtureConfig.deltaCount === 'number' ? fixtureConfig.deltaCount : undefined,
    reasoningDeltaCount: fixtureConfig && typeof fixtureConfig.reasoningDeltaCount === 'number' ? fixtureConfig.reasoningDeltaCount : undefined,
    cadenceMs: fixtureConfig && typeof fixtureConfig.cadenceMs === 'number' ? fixtureConfig.cadenceMs : undefined,
    scheduleMs: fixtureScheduleMs.length ? fixtureScheduleMs : undefined,
    scheduleGapsMs: fixtureScheduleMs.length ? stats(scheduleGaps(fixtureScheduleMs)) : undefined,
    reasoningScheduleMs: fixtureReasoningScheduleMs.length ? fixtureReasoningScheduleMs : undefined,
    reasoningScheduleGapsMs: fixtureReasoningScheduleMs.length ? stats(scheduleGaps(fixtureReasoningScheduleMs)) : undefined,
    textBytes: fixtureConfig && typeof fixtureConfig.textBytes === 'number' ? fixtureConfig.textBytes : undefined,
    reasoningBytes: fixtureConfig && typeof fixtureConfig.reasoningBytes === 'number' ? fixtureConfig.reasoningBytes : undefined,
    piboSessionId: fixtureConfig && typeof fixtureConfig.piboSessionId === 'string' ? fixtureConfig.piboSessionId : undefined,
    preludeMessages: backendPreludeConfig && typeof backendPreludeConfig.preludeMessages === 'number' ? backendPreludeConfig.preludeMessages : (options.fixturePreludeMessages || undefined),
    error: backendPreludeError || backendFixtureError,
  } : undefined;
  const eventSourceSummary = summarizeEventSourceProbe(startedAt, Boolean(options.startBackendFixture), options.reconnectAtMs, Boolean(options.simulateTraceCatchup), options.traceCatchupDropMs);
  const traceSummary = traceProbe && traceProbe.result;
  const regressions = streamingBenchmarkRegressions({
    debugAfter,
    debugDelta,
    fixture: fixtureSummary,
    eventSource: eventSourceSummary,
    sse: sseSummary,
    trace: traceSummary,
    dom: { lengthStart: initialText.length, lengthEnd: currentLength, lengthMax: maxLength, positiveUpdateCount: positiveUpdates.length, gapsMs: domGaps, positiveCharJumps: domJumps, firstPositiveUpdateMs },
    longTasks,
  });
  return {
    kind: 'streaming-benchmark',
    createdAt: nowIso(),
    url: location.href,
    title: document.title,
    durationMs: options.durationMs,
    debug: {
      enabledRequested: true,
      available: Boolean(debugAfter),
      reset,
      before: debugBefore,
      stateBeforeReset: debugStateBeforeReset,
      after: debugAfter,
      delta: debugDelta,
    },
    dom: {
      selector: ASSISTANT_SELECTOR,
      targetCountStart,
      targetCountEnd: assistantTargets().length,
      lengthStart: initialText.length,
      lengthEnd: currentLength,
      lengthMax: maxLength,
      updateCount: updates.length,
      positiveUpdateCount: positiveUpdates.length,
      firstPositiveUpdateMs: firstPositiveUpdateMs === undefined ? undefined : Math.round(firstPositiveUpdateMs),
      lastPositiveUpdateMs: lastPositiveAt === undefined ? undefined : Math.round(lastPositiveAt),
      gapsMs: domGaps,
      positiveCharJumps: domJumps,
    },
    raf: { count: rafCount, gapsMs: stats(rafGaps) },
    longTasks: {
      count: longTasks.length,
      totalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0) * 1000) / 1000,
      maxMs: Math.round((longTasks.length ? Math.max(...longTasks) : 0) * 1000) / 1000,
    },
    fixture: fixtureSummary,
    eventSource: eventSourceSummary,
    sse: sseSummary,
    trace: traceSummary,
    overlayDrop: overlayDropSummary,
    regressions,
    warnings,
  };
}
`;
}
