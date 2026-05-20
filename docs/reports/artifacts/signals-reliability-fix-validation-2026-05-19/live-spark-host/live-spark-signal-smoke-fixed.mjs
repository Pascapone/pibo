import { PiboSessionRouter } from '/root/code/pibo/.worktrees/signals-reliability-fix/src/core/session-router.ts';
import { InMemoryPiboSessionStore } from '/root/code/pibo/.worktrees/signals-reliability-fix/src/sessions/store.ts';
import { createPiboSignalRegistry } from '/root/code/pibo/.worktrees/signals-reliability-fix/src/signals/registry.ts';

const sessionId = `ps_live_spark_fixed_${Date.now()}`;
const store = new InMemoryPiboSessionStore();
const signals = createPiboSignalRegistry();
store.create({
  id: sessionId,
  channel: 'signals.live-smoke',
  kind: 'runtime',
  profile: 'codex-compat-openai-web',
  ownerScope: 'user:signals-live-smoke',
  workspace: '/tmp',
  title: 'Live Spark signal smoke after fix',
  activeModel: { provider: 'openai-codex', id: 'gpt-5.3-codex-spark' },
  metadata: { initialThinkingLevel: 'low', initialFastMode: true },
});
const router = new PiboSessionRouter({ sessionStore: store, signalRegistry: signals, cwd: '/tmp', persistSession: false });
const events = [];
const signalSnapshots = [];
let done;
let failed;
const donePromise = new Promise((resolve, reject) => { done = resolve; failed = reject; });
const deadline = setTimeout(() => failed(new Error('timeout waiting for terminal event')), 120000);
router.subscribe((event) => {
  events.push({ type: event.type, eventId: event.eventId, text: typeof event.text === 'string' ? event.text.slice(0, 200) : undefined, error: event.error });
  const snapshot = signals.snapshotTree(sessionId).sessions[sessionId];
  signalSnapshots.push({ atEvent: event.type, localStatus: snapshot?.localStatus, aggregateStatus: snapshot?.aggregateStatus, isTreeActive: snapshot?.isTreeActive, queuedMessages: snapshot?.queuedMessages, hasError: snapshot?.hasError });
  if (event.type === 'assistant_message' || event.type === 'message_finished' || event.type === 'session_error') done();
});
try {
  const statusBefore = await router.emit({ type: 'execution', piboSessionId: sessionId, action: 'status' });
  const queued = await router.emit({ type: 'message', piboSessionId: sessionId, id: `msg_${Date.now()}`, source: 'user', text: 'Live Spark post-fix signal smoke test. Reply with exactly: OK' });
  await donePromise;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const statusAfter = await router.emit({ type: 'execution', piboSessionId: sessionId, action: 'status' });
  console.log(JSON.stringify({ ok: true, sessionId, statusBefore, queued, statusAfter, finalSignal: signals.snapshotTree(sessionId).sessions[sessionId], events, signalSnapshots }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, sessionId, error: error instanceof Error ? error.message : String(error), finalSignal: signals.snapshotTree(sessionId).sessions[sessionId], events, signalSnapshots }, null, 2));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await router.disposeAll();
}
