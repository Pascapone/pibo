import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from 'typebox';
import { runPluginHooks, wrapPluginToolHooks } from '../dist/agent-runtime/plugin-hooks.js';
import { createPiboSessionToolDefinitions } from '../dist/tools/session-tool-set.js';
import { InitialSessionContext } from '../dist/core/profiles.js';

const hook = (id, phase, run, extra = {}) => ({ descriptor: { id: `test.hooks/${id}`, phase, order: 0, required: true, timeoutMs: 100, ...extra }, run });
const scope = (records = []) => ({ piboSessionId: 'ps_a', generation: 'g1', record: evidence => records.push(evidence) });
const transform = value => ({ action: 'transform', value, provenance: { description: 'controlled transform', inputRefs: ['input:1'] } });
const tool = (execute) => ({ name: 'write_note', title: 'Write', description: 'Write note', inputSchema: Type.Object({ text: Type.String() }), execute });

test('hooks order by order then qualified identity; transformations revalidate before tool execution', async () => {
  const records = [], calls = [];
  const wrapped = wrapPluginToolHooks(tool(async (_, input) => { calls.push(input.text); return { content: [{ type: 'text', text: input.text }] }; }), [
    hook('b', 'pre-tool', input => transform({ text: input.text + 'B' })),
    hook('a', 'pre-tool', input => transform({ text: input.text + 'A' })),
    hook('first', 'pre-tool', input => transform({ text: input.text + '0' }), { order: -1 }),
  ], scope(records));
  await wrapped.execute('c1', { text: 'x' }, undefined, undefined, { cwd: '/tmp' });
  assert.deepEqual(calls, ['x0AB']);
  assert.deepEqual(records.map(e => e.hookId), ['test.hooks/first', 'test.hooks/a', 'test.hooks/b']);
  assert.ok(records.every(e => e.generation === 'g1' && e.piboSessionId === 'ps_a' && e.status === 'transformed'));
});

test('invalid required pre transform and missing provenance fail closed, no external call', async () => {
  let calls = 0;
  for (const result of [transform({ text: 7 }), { action: 'transform', value: { text: 'changed' } }, { action: 'reject', reason: 'deny' }]) {
    const wrapped = wrapPluginToolHooks(tool(async () => { calls++; return { content: [] }; }), [hook('deny', 'pre-tool', () => result)], scope());
    await assert.rejects(wrapped.execute('c', { text: 'x' }, undefined, undefined, { cwd: '/tmp' }), /blocked pre-tool/);
  }
  assert.equal(calls, 0);
});

test('optional failing observer is recorded; post failure never rewrites successful external execution', async () => {
  let calls = 0; const records = [];
  const wrapped = wrapPluginToolHooks(tool(async () => { calls++; return { content: [{ type: 'text', text: 'committed' }] }; }), [
    hook('observer', 'pre-tool', () => { throw new Error('API_KEY=hidden'); }, { required: false }),
    hook('post', 'post-tool', () => { throw new Error('Bearer hidden'); }),
  ], scope(records));
  const result = await wrapped.execute('c', { text: 'x' }, undefined, undefined, { cwd: '/tmp' });
  assert.equal(calls, 1); assert.equal(result.content[0].text, 'committed');
  assert.equal(records[1].executed, true); assert.equal(records[1].status, 'failed');
  assert.ok(!JSON.stringify(records).includes('hidden'));
});

test('hook timeout aborts hook signal and blocks required pre execution', async () => {
  let aborted = false;
  const hooks = [hook('slow', 'input', (_, context) => new Promise(() => context.signal.addEventListener('abort', () => { aborted = true; })), { timeoutMs: 15 })];
  await assert.rejects(runPluginHooks(hooks, 'input', 'hello', scope(), value => typeof value === 'string'), /blocked input/);
  assert.equal(aborted, true);
});

test('already cancelled input does not invoke hook; identity is host scoped and values cannot mutate input', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(runPluginHooks([hook('input', 'input', () => { calls++; return { action: 'continue' }; })], 'input', 'x', { ...scope(), signal: controller.signal }, value => typeof value === 'string'));
  assert.equal(calls, 0);
  const input = { text: 'original' };
  const result = await runPluginHooks([hook('mutation', 'pre-tool', (value, context) => { value.text = 'mutated'; assert.equal(context.piboSessionId, 'ps_a'); return { action: 'continue' }; })], 'pre-tool', input, scope(), () => true);
  assert.deepEqual(result, { text: 'original' });
});

test('default tool assembly applies hooks to controlled tools but not native harness definitions', async () => {
  const calls = []; const records = [];
  const managed = tool(async () => ({ content: [] }));
  const native = { ...managed, name: 'native_bash', portable: false };
  const profile = new InitialSessionContext({ profileName: 'a', tools: [{ name: managed.name, definition: managed }], toolPackages: { goalControl: false } });
  const definitions = createPiboSessionToolDefinitions({ profile, nativeYieldableTools: [native], pluginHooks: [hook('observe', 'pre-tool', () => { calls.push('hook'); return { action: 'continue' }; })], pluginHookScope: scope(records) });
  await definitions.find(t => t.name === managed.name).execute('managed', { text: 'x' }, undefined, undefined, { cwd: '/tmp' });
  await definitions.find(t => t.name === native.name).execute('native', { text: 'x' }, undefined, undefined, { cwd: '/tmp' });
  assert.deepEqual(calls, ['hook']);
});


test('post-tool evidence storage failure cannot erase an already committed external result', async () => {
  const wrapped = wrapPluginToolHooks(tool(async () => ({ content: [{ type: 'text', text: 'committed' }] })), [hook('post', 'post-tool', () => ({ action: 'continue' }))], { ...scope(), record() { throw new Error('store unavailable'); } });
  const result = await wrapped.execute('c', { text: 'x' }, undefined, undefined, { cwd: '/tmp' });
  assert.equal(result.content[0].text, 'committed');
});
