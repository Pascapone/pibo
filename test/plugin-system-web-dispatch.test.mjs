import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createChatWebApp } from '../dist/apps/chat/web-app.js';
import { PiboWebHttpError } from '../dist/web/http.js';
import { PLUGIN_MANAGEMENT_SERVICE } from '../dist/plugins/product-services.js';
import { fixture, tabset, plan } from './plugin-system-management-helpers.mjs';

async function harness(t, options = {}) {
	const cleanup = [];
	const f = await fixture({ after(callback) { cleanup.push(callback); } });
	const app = createChatWebApp({
		dataStorePath: join(f.root, 'pibo.sqlite'), dataPayloadRootDir: join(f.root, 'payloads'),
		agentStorePath: join(f.root, 'agents.sqlite'), reliabilityStorePath: join(f.root, 'reliability.sqlite'),
		workflowStorePath: join(f.root, 'workflows.sqlite'), cronStorePath: join(f.root, 'cron.sqlite'), ralphStorePath: join(f.root, 'loops.sqlite'),
		...options,
	});
	t.after(async () => { await app.dispose(); for (const callback of cleanup) await callback(); });
	let serviceReads = 0;
	const context = {
		async requireSession({ request }) {
			if (request.headers.get('authorization') !== 'test-session') throw new PiboWebHttpError('Sign in required', 401);
			return { appContext: 'app', authSession: { identity: { userId: 'human' } } };
		},
		channelContext: {
			getService(id) { serviceReads++; assert.equal(id, PLUGIN_MANAGEMENT_SERVICE); return f.manager; },
			getSession(id) { return ['ps_a', 'ps_b'].includes(id) ? { id, profile: 'base', workspace: f.root } : undefined; },
			getProfiles() { throw new Error('Plugin read unexpectedly rebuilt the profile catalog'); },
			createProfile() { throw new Error('Read unexpectedly built a runtime profile'); },
			emit() { throw new Error('Read unexpectedly emitted a command'); },
			subscribe() { throw new Error('Plugin route unexpectedly activated event indexing'); },
		},
	};
	return { ...f, get serviceReads() { return serviceReads; }, async request(path, options = {}) {
		const headers = { authorization: 'test-session', origin: 'http://chat.test', 'content-type': 'application/json', ...options.headers };
		return app.handleRequest(new Request(`http://chat.test${path}`, { ...options, headers }), context);
	} };
}

test('real Chat Web dispatcher authenticates before consulting plugin services', async t => {
	const f = await harness(t);
	await assert.rejects(f.request('/api/chat/plugins', { headers: { authorization: '' } }), e => e.statusCode === 401);
	assert.equal(f.serviceReads, 0);
	const response = await f.request('/api/chat/plugins');
	assert.deepEqual(await response.json(), { installations: [] });
});

test('plugin mutations enforce existing same-origin boundary before manager writes', async t => {
	const f = await harness(t);
	await assert.rejects(f.request('/api/chat/sessions/ps_a/plugin-tabs', {
		method: 'PUT', headers: { origin: 'http://attacker.test' }, body: JSON.stringify({ tabset: tabset('ps_a'), expectedRevision: 0 }),
	}), e => e.statusCode === 403);
	assert.equal(f.store.getTabset('ps_a'), undefined);
});

test('session tab writes use original URL session, CAS, and read without runtime activation', async t => {
	const f = await harness(t);
	const saved = await f.request('/api/chat/sessions/ps_a/plugin-tabs', { method: 'PUT', body: JSON.stringify({ tabset: tabset('ps_a', 'A'), expectedRevision: 0 }) });
	assert.equal((await saved.json()).tabset.revision, 1);
	await assert.rejects(f.request('/api/chat/sessions/ps_b/plugin-tabs', { method: 'PUT', body: JSON.stringify({ tabset: tabset('ps_a', 'late A'), expectedRevision: 0 }) }), e => e.statusCode === 400);
	await assert.rejects(f.request('/api/chat/sessions/ps_a/plugin-tabs', { method: 'PUT', body: JSON.stringify({ tabset: tabset('ps_a', 'stale A'), expectedRevision: 0 }) }), e => e.statusCode === 409);
	const a = await (await f.request('/api/chat/sessions/ps_a/plugin-tabs')).json();
	const b = await (await f.request('/api/chat/sessions/ps_b/plugin-tabs')).json();
	assert.equal(a.tabset.tabs[0].state.value, 'A');
	assert.equal(b.tabset, null);
	await assert.rejects(f.request('/api/chat/sessions/ps_missing/plugin-tabs'), e => e.statusCode === 404);
	assert.deepEqual(await (await f.request('/api/chat/sessions/ps_a/plugin-builds')).json(), { snapshots: [] });
});


test('recorded generations and pure previews remain separate on the real authenticated route', async t => {
  let previewCalls = 0;
  let preview;
  const f = await harness(t, { pluginSessionPlan: async (id, kind) => {
    previewCalls++; assert.equal(id, 'ps_a'); assert.equal(kind, 'preview'); return { plan: preview };
  } });
  const installation = await f.active();
  const recorded = plan(installation);
  preview = { ...recorded, kind: 'preview', generation: undefined, selectionRevision: 7 };
  await assert.rejects(f.request('/api/chat/sessions/ps_a/plugin-plan?kind=actual'), e => e.statusCode === 404);
  assert.equal(previewCalls, 0);
  f.store.putGenerationSnapshot({ piboSessionId: 'ps_a', generationId: 'g1', plan: recorded, createdAt: '2026-09-12T00:00:00Z' });
  const actual = await (await f.request('/api/chat/sessions/ps_a/plugin-plan?kind=actual')).json();
  const next = await (await f.request('/api/chat/sessions/ps_a/plugin-plan?kind=preview')).json();
  const current = await (await f.request('/api/chat/sessions/ps_a/plugin-plan')).json();
  assert.equal(actual.plan.kind, 'generation'); assert.equal(actual.plan.generation, 'g1');
  assert.equal(next.plan.kind, 'preview'); assert.equal(next.plan.selectionRevision, 7);
  assert.deepEqual(current.plan, actual.plan); assert.equal(previewCalls, 1);
  assert.deepEqual(f.store.listGenerationSnapshots('ps_a')[0].plan, actual.plan);
  await assert.rejects(f.request('/api/chat/sessions/ps_a/plugin-plan?kind=unknown'), e => e.statusCode === 400);
});

test('a late preview from a different session cannot be exposed under the requested session URL', async t => {
  const f = await harness(t, { pluginSessionPlan: async () => ({ plan: { piboSessionId: 'ps_b', kind: 'preview' } }) });
  await assert.rejects(f.request('/api/chat/sessions/ps_a/plugin-plan?kind=preview'), e => e.statusCode === 409);
});
