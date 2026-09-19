import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PluginHost } from '../dist/plugins/host.js';
import { ensureDefaultPluginInstallations, MUSE_NATIVE_RUNTIME_PLUGIN_ID } from '../dist/plugins/default-packages.js';
import { startPluginProductRuntime } from '../dist/plugins/product-runtime.js';
import { PluginRuntimeCoordinator } from '../dist/agent-runtime/plugin-plan.js';
import { InitialSessionContext } from '../dist/core/profiles.js';
import { createAgentPluginSelection } from '../dist/plugins/selection.js';
import { fixture } from './plugin-system-management-helpers.mjs';

const definition = (name) => ({ name, title: name, description: name, inputSchema: Type.Object({}), async execute() { return { content: [{ type: 'text', text: name }] }; } });

async function startedProduct(t) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-drain-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') });
  t.after(() => data.close());
  const host = new PluginHost();
  const artifactRoot = join(root, 'artifacts');
  const product = await startPluginProductRuntime({ host, data, artifactRoot, collectConsumers: async () => [], readSessionPlan: async () => ({}), includeWebProduct: true });
  t.after(() => host.stop());
  return { data, manager: product.manager, artifactRoot };
}

function staleHash(data) {
  const before = data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID);
  assert.equal(before.state, 'active');
  data.plugins.putInstallation({ ...before, contentHash: 'sha256:stale', revision: 'sha256:stale', updatedAt: new Date().toISOString() }, before.stateRevision);
  return before;
}

test('default plugin update defers while drain-blocked instead of bricking the installation', async (t) => {
  const { data, manager, artifactRoot } = await startedProduct(t);
  manager.reserveGeneration({ piboSessionId: 'ps_drain_blocked', generationId: randomUUID(), pluginIds: [MUSE_NATIVE_RUNTIME_PLUGIN_ID] });
  staleHash(data);
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    await ensureDefaultPluginInstallations(manager, artifactRoot, { includeWebProduct: true });
  } finally {
    console.error = original;
  }
  const after = data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID);
  assert.equal(after.state, 'active');
  assert.equal(after.contentHash, 'sha256:stale');
  assert.ok(errors.some((line) => line.includes(MUSE_NATIVE_RUNTIME_PLUGIN_ID) && /defer/i.test(line)), 'deferral must be loud');
});

test('boot resumes a drain-interrupted default plugin update once blockers are gone', async (t) => {
  const { data, manager, artifactRoot } = await startedProduct(t);
  const admission = manager.reserveGeneration({ piboSessionId: 'ps_drain_heal', generationId: randomUUID(), pluginIds: [MUSE_NATIVE_RUNTIME_PLUGIN_ID] });
  const before = staleHash(data);
  await manager.install({ kind: 'local', path: join(artifactRoot, 'default-sources', MUSE_NATIVE_RUNTIME_PLUGIN_ID, before.version) }, { expectedRevision: data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID).stateRevision });
  const pending = data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID);
  const blocked = await manager.activate(MUSE_NATIVE_RUNTIME_PLUGIN_ID, { expectedRevision: pending.stateRevision });
  assert.equal(blocked.state, 'draining');
  assert.equal(data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID).state, 'retiring');
  manager.releaseGenerationAdmission('ps_drain_heal', admission.generationId, admission.revision);
  await ensureDefaultPluginInstallations(manager, artifactRoot, { includeWebProduct: true });
  const after = data.plugins.getInstallation(MUSE_NATIVE_RUNTIME_PLUGIN_ID);
  assert.equal(after.state, 'active');
  assert.notEqual(after.contentHash, 'sha256:stale');
});

test('session rebind releases superseded own-session admissions', async (t) => {
  const f = await fixture(t);
  const installation = await f.active();
  const host = new PluginHost();
  await host.start({ plugins: [{ installation, setup(ctx) { ctx.register('read', { name: 'notes_read', definition: definition('notes_read') }); } }] });
  t.after(() => host.stop());
  const coordinator = new PluginRuntimeCoordinator({ store: f.store, manager: f.manager, host });
  const profile = new InitialSessionContext({ profileName: 'a', pluginSelection: createAgentPluginSelection([installation]), pluginSelectionRevision: 2 });
  const runtime = { adapterId: 'pi', instanceId: 'pi', capabilities: {} };
  const other = coordinator.reserve(profile, runtime, 'ps_other', 'gen-other');
  coordinator.reserve(profile, runtime, 'ps_rebind', 'gen-first');
  assert.equal(f.store.getAdmission('ps_rebind', 'gen-first').state, 'reserved');
  const second = coordinator.reserve(profile, runtime, 'ps_rebind', 'gen-second');
  assert.equal(f.store.getAdmission('ps_rebind', 'gen-first').state, 'released');
  assert.equal(f.store.getAdmission('ps_rebind', 'gen-second').state, 'reserved');
  assert.equal(f.store.getAdmission('ps_other', 'gen-other').state, 'reserved');
  coordinator.release(second);
  coordinator.release(other);
});
