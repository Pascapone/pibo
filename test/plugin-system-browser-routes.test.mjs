import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pluginBrowserRoute, handlePluginBrowserRoute } from '../dist/apps/chat/plugin-browser-routes.js';
import { fixture } from './plugin-system-management-helpers.mjs';

function readAsset(installation, path) {
  return handlePluginBrowserRoute({
    route: { action: 'asset', pluginId: installation.pluginId, revision: installation.revision, path },
    request: new Request('http://chat.test/asset'), installations: [installation], catalogRevision: 1,
    assertSessionAccess() { throw new Error('Asset has no session'); },
    getSessionPlan() { throw new Error('Asset read must not create a plan'); },
  });
}

test('root browser entry does not publish backend or private sibling data', async t => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'private.json'), '{"private":true}');
  const installation = await f.active();
  assert.match(await (await readAsset(installation, 'browser.mjs')).text(), /Notes/);
  for (const path of ['backend.mjs', 'private.json']) await assert.rejects(readAsset(installation, path), e => e.statusCode === 403);
});

test('dedicated public subtree serves chunks but rejects traversal and symlinks to backend', async t => {
  const f = await fixture(t, { manifest: { entrypoints: { backend: 'backend.mjs', browser: 'public/browser.mjs' } } });
  await mkdir(join(f.source, 'public'));
  await writeFile(join(f.source, 'public/browser.mjs'), 'export const view = true;');
  await writeFile(join(f.source, 'public/chunk.js'), 'export const shared = true;');
  const installation = await f.active();
  assert.equal((await readAsset(installation, 'public/chunk.js')).status, 200);
  await assert.rejects(readAsset(installation, '../backend.mjs'), e => e.statusCode === 400);
  await assert.rejects(readAsset(installation, 'backend.mjs'), e => e.statusCode === 403);
  await symlink('../backend.mjs', join(installation.artifactPath, 'public/escape.mjs'));
  await assert.rejects(readAsset(installation, 'public/escape.mjs'), e => e.statusCode === 403);
  const route = pluginBrowserRoute('/api/chat/plugin-browser/assets/test.notes/rev/public/%2e%2e/backend.mjs', 'GET');
  await assert.rejects(readAsset(installation, route.path), e => e.statusCode === 400);
  assert.throws(() => pluginBrowserRoute('/api/chat/plugin-browser/assets/test.notes/rev/%zz', 'GET'), e => e.statusCode === 400);
});

test('a browser subtree containing the declared backend is never public', async t => {
  const f = await fixture(t, { manifest: { entrypoints: { backend: 'public/backend.mjs', browser: 'public/browser.mjs' } } });
  await mkdir(join(f.source, 'public'));
  await writeFile(join(f.source, 'public/browser.mjs'), 'export const view = true;');
  await writeFile(join(f.source, 'public/backend.mjs'), 'export const backend = true;');
  const installation = await f.active();
  for (const path of ['public/browser.mjs', 'public/backend.mjs']) await assert.rejects(readAsset(installation, path), e => e.statusCode === 403);
});
