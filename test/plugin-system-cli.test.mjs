import test from 'node:test';
import assert from 'node:assert/strict';
import { runPluginCli } from '../dist/plugins/cli.js';
import { pluginManagementRoute, pluginManagementRouteRequiresSameOrigin, handlePluginManagementRoute } from '../dist/apps/chat/plugin-management-routes.js';
import { fixture, tabset } from './plugin-system-management-helpers.mjs';

test('progressive CLI discovery and JSON install/status/uninstall exercise real persistence', async (t) => {
  const f = await fixture(t); let lines = []; const cli = async (args) => { lines = []; const code = await runPluginCli(args, { manager: f.manager, write: (text) => lines.push(text) }); return { code, text: lines.join('\n') }; };
  const root = await cli([]); assert.equal(root.code, 0); assert.match(root.text, /uninstall/); assert.doesNotMatch(root.text, /plugin-id-text/);
  const nested = await cli(['uninstall', '--help']); assert.match(nested.text, /plan \| confirm/); assert.doesNotMatch(nested.text, /expected-revision/);
  const detail = await cli(['uninstall', 'confirm', '--help']); assert.match(detail.text, /plugin-id-text/);
  assert.equal((await cli(['install', f.source, '--expected-revision', '0', '--dry-run', '--json'])).code, 0); assert.equal(f.store.listInstallations().length, 0);
  let result = await cli(['install', f.source, '--expected-revision', '0', '--json']); assert.equal(result.code, 0); assert.equal(JSON.parse(result.text).installation.state, 'installed');
  result = await cli(['activate', 'test.notes', '--expected-revision', '1', '--json']); assert.equal(result.code, 0);
  result = await cli(['config', 'set', 'test.notes', '--scope', 'app', '--schema-version', '1', '--expected-revision', '0', '--values-json', '{"description":"configured"}', '--json']); assert.equal(result.code, 0); assert.equal(JSON.parse(result.text).values.description, 'configured');
  result = await cli(['config', 'show', 'test.notes', '--scope', 'app', '--json']); assert.equal(JSON.parse(result.text).revision, 1);
  assert.equal((await cli(['activate', 'test.notes', '--expected-revision', String(f.store.getInstallation('test.notes').stateRevision), '--dry-run'])).code, 1);
  assert.match((await cli(['list'])).text, /test.notes 1.0.0 active/);
  result = await cli(['uninstall', 'plan', 'test.notes', '--json']); const plan = JSON.parse(result.text); assert.equal(plan.impact.sessionsPreserved, true);
  const unsafeDry = await cli(['uninstall', 'confirm', plan.id, '--plugin-id-text', 'test.notes', '--expected-revision', String(plan.installationRevision), '--dry-run']); assert.equal(unsafeDry.code, 1); assert.equal(f.store.getInstallation('test.notes').state, 'active');
  result = await cli(['uninstall', 'confirm', plan.id, '--plugin-id-text', 'wrong', '--expected-revision', String(plan.installationRevision), '--json']); assert.equal(result.code, 1);
  result = await cli(['uninstall', 'confirm', plan.id, '--plugin-id-text', 'test.notes', '--expected-revision', String(plan.installationRevision), '--json']); assert.equal(result.code, 0); assert.equal(JSON.parse(result.text).state, 'complete');
  assert.equal((await cli(['install', f.source, '--expected-revision', '-1'])).code, 1);
  assert.equal((await cli(['list', '--surprise'])).code, 1);
});
test('management routes require same-origin mutation and fixed session access/CAS', async (t) => {
  const f = await fixture(t); const seen = [];
  const request = async (path, method = 'GET', body) => {
    const route = pluginManagementRoute(path, method); assert.ok(route);
    return handlePluginManagementRoute({ route, request: new Request('http://localhost' + path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), manager: f.manager, store: f.store, assertSessionAccess: (id) => { seen.push(id); if (id === 'ps_forbidden') throw new Error('forbidden session'); } });
  };
  const path = '/api/chat/sessions/ps_a/plugin-tabs'; assert.equal(pluginManagementRouteRequiresSameOrigin(pluginManagementRoute(path, 'PUT')), true); assert.equal(pluginManagementRouteRequiresSameOrigin(pluginManagementRoute(path, 'GET')), false);
  const saved = await (await request(path, 'PUT', { tabset: tabset('ps_a'), expectedRevision: 0 })).json(); assert.equal(saved.tabset.revision, 1);
  await assert.rejects(request(path, 'PUT', { tabset: tabset('ps_a'), expectedRevision: 0 }), /changed/);
  await assert.rejects(request('/api/chat/sessions/ps_b/plugin-tabs', 'PUT', { tabset: tabset('ps_a'), expectedRevision: 0 }), /route session differ/);
  await assert.rejects(request('/api/chat/sessions/ps_forbidden/plugin-tabs'), /forbidden/);
  assert.deepEqual(seen, ['ps_a', 'ps_a', 'ps_b', 'ps_forbidden']);
});
test('configuration route rejects late save targeting another session and validates manifest schema', async (t) => {
  const f = await fixture(t); await f.install();
  const route = pluginManagementRoute('/api/chat/plugins/test.notes/config', 'PUT');
  const send = (configuration) => handlePluginManagementRoute({ route, request: new Request('http://localhost/api/chat/plugins/test.notes/config?scope=session&targetId=ps_b', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ configuration, expectedRevision: 0 }) }), manager: f.manager, store: f.store, assertSessionAccess() {} });
  const config = { target: { scope: 'session', pluginId: 'test.notes', piboSessionId: 'ps_a' }, schemaVersion: 1, revision: 0, values: { description: 'A draft' } };
  await assert.rejects(send(config), /differs from URL/);
  await assert.rejects(send({ ...config, target: { ...config.target, piboSessionId: 'ps_b' }, values: { unknown: true } }), /configuration invalid/);
  assert.equal(f.store.getConfig(config.target), undefined);
});
