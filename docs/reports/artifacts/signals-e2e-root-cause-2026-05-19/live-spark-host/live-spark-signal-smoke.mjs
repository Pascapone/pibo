import { PiboSessionRouter } from '/root/code/pibo/src/core/session-router.ts';
import { InMemoryPiboSessionStore } from '/root/code/pibo/src/sessions/store.ts';
import { createPiboSignalRegistry } from '/root/code/pibo/src/signals/registry.ts';

const sessionId = `ps_live_spark_${Date.now()}`;
const store = new InMemoryPiboSessionStore();
const signals = createPiboSignalRegistry();
store.create({
  id: sessionId,
  channel: 'signals.live-smoke',
  kind: 'runtime',
  profile: 'codex-compat-openai-web',
  ownerScope: 'user:signals-live-smoke',
  workspace: '/tmp',
  title: 'Live Spark signal smoke',
  activeModel: { provider: 'openai-codex', id: 'gpt-5.3-codex-spark' },
  metadata: { initialThinkingLevel: 'low', initialFastMode: true },
});

const router = new PiboSessionRouter({
  sessionStore: store,
  signalRegistry: signals,
  cwd: '/tmp',
  persistSession: false,
});

const events = [];
const signalSnapshots = [];
let done;
let failed;
const donePromise = new Promise((resolve, reject) => { done = resolve; failed = reject; });
const deadline = setTimeout(() => failed(new Error('timeout waiting for assistant_message/message_finished/session_error')), 120000);

router.subscribe((event) => {
  const compact = {
    type: event.type,
    eventId: event.eventId,
    piboSessionId: event.piboSessionId,
    text: typeof event.text === 'string' ? event.text.slice(0, 200) : undefined,
    error: typeof event.error === 'string' ? event.error.slice(0, 500) : undefined,
    queuedMessages: event.queuedMessages,
    processing: event.processing,
  };
  events.push(compact);
  const snapshot = signals.snapshotTree(sessionId).sessions[sessionId];
  signalSnapshots.push({
    atEvent: event.type,
    localStatus: snapshot?.localStatus,
    aggregateStatus: snapshot?.aggregateStatus,
    isTreeActive: snapshot?.isTreeActive,
    queuedMessages: snapshot?.queuedMessages,
    hasError: snapshot?.hasError,
    errors: snapshot?.errors?.map((e) => e.message.slice(0, 200)),
  });
  if (event.type === 'assistant_message' || event.type === 'message_finished' || event.type === 'session_error') {
    done();
  }
});

try {
  const statusBefore = await router.emit({ type: 'execution', piboSessionId: sessionId, action: 'status' });
  const beforeSignal = signals.snapshotTree(sessionId);
  const queued = await router.emit({
    type: 'message',
    piboSessionId: sessionId,
    id: `msg_${Date.now()}`,
    source: 'user',
    text: 'Live Spark signal smoke test. Reply with exactly: OK',
  });
  await donePromise;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const statusAfter = await router.emit({ type: 'execution', piboSessionId: sessionId, action: 'status' });
  const finalSignal = signals.snapshotTree(sessionId);
  console.log(JSON.stringify({
    ok: true,
    sessionId,
    statusBefore,
    queued,
    statusAfter,
    beforeSignal: beforeSignal.sessions[sessionId],
    finalSignal: finalSignal.sessions[sessionId],
    events,
    signalSnapshots,
  }, null, 2));
} catch (error) {
  const finalSignal = signals.snapshotTree(sessionId);
  console.log(JSON.stringify({
    ok: false,
    sessionId,
    error: error instanceof Error ? error.message : String(error),
    finalSignal: finalSignal.sessions[sessionId],
    events,
    signalSnapshots,
  }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await router.disposeAll();
}
