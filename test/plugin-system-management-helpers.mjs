import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PiboDataStore } from '../dist/data/pibo-store.js';
import { PluginManager } from '../dist/plugins/manager.js';
export function manifest(extra = {}) {
  return { schemaVersion: 1, id: 'test.notes', name: 'Notes', version: '1.0.0', sdk: '^1.0.0', entrypoints: { backend: 'backend.mjs', browser: 'browser.mjs' }, contributions: [{ id: 'read', kind: 'tool', name: 'notes_read', scope: 'agent', required: true, defaultEnabled: true, schemaVersion: 1, context: { kind: 'none', reason: 'Tool schema only' } }], config: { schemaVersion: 1, schema: { type: 'object', properties: { description: { type: 'string' } }, additionalProperties: false } }, ...extra };
}
export async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-management-'));
  const source = join(root, 'source'); await mkdir(source);
  await writeFile(join(source, 'pibo.plugin.json'), JSON.stringify(manifest(options.manifest)));
  await writeFile(join(source, 'backend.mjs'), 'export const activated = true;');
  await writeFile(join(source, 'browser.mjs'), 'export const Notes = () => null;');
  const data = new PiboDataStore(join(root, 'pibo.sqlite'), { payloadRootDir: join(root, 'payloads') });
  let consumers = []; let state = 'inactive'; let stops = 0; let starts = 0;
  const lifecycle = { async activate(artifact) { starts++; await import(pathToFileURL(join(artifact.artifactPath, artifact.manifest.entrypoints.backend)).href); state = 'active'; }, async deactivate() { stops++; state = 'inactive'; }, async status() { return state; } };
  const managerOptions = { store: data.plugins, artifactRoot: join(root, 'artifacts'), collectConsumers: async () => consumers, lifecycle, ...options.manager };
  const manager = new PluginManager(managerOptions);
  t.after(async () => { data.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, data, store: data.plugins, manager, managerOptions, lifecycle, setConsumers(value) { consumers = value; }, setHostState(value) { state = value; }, get starts() { return starts; }, get stops() { return stops; }, async install() { return manager.install({ kind: 'local', path: source }, { expectedRevision: data.plugins.getInstallation('test.notes')?.stateRevision ?? 0 }); }, async active() { await this.install(); await manager.activate('test.notes', { expectedRevision: data.plugins.getInstallation('test.notes').stateRevision }); return data.plugins.getInstallation('test.notes'); } };
}
export function tabset(piboSessionId, value = 'A') {
  return { schemaVersion: 1, piboSessionId, revision: 0, tabs: [{ instanceId: 'tab-1', piboSessionId, pluginId: 'test.notes', viewId: 'test.notes/view', pluginRevision: 'sha256:fixture', stateSchemaVersion: 1, state: { value }, fallback: 'Notes unavailable' }], activeTabId: 'tab-1', layout: {} };
}
export function plan(installation, required = true) {
  return { schemaVersion: 1, kind: 'generation', piboSessionId: 'ps_a', generation: 'g1', catalogRevision: 1, selectionRevision: 1, runtime: { adapterId: 'pi', instanceId: 'pi', capabilities: {} }, selection: { schemaVersion: 1, plugins: [{ pluginId: installation.pluginId, enabled: true, revision: installation.revision, contributions: { read: true }, config: {} }] }, plugins: [{ pluginId: installation.pluginId, revision: installation.revision, version: installation.version, contentHash: installation.contentHash }], contributions: [{ id: 'test.notes/read', pluginId: installation.pluginId, pluginRevision: installation.revision, contribution: installation.manifest.contributions[0], config: {}, required, selectionReason: 'required', dependencyPath: [] }], resources: [], configurations: [], pluginConfigurations: { [installation.pluginId]: {} }, nodes: [], diagnostics: [], valid: true };
}
export function snapshot(installation, required = true) { return { piboSessionId: 'ps_a', generationId: 'g1', plan: plan(installation, required), createdAt: '2026-09-12T00:00:00.000Z' }; }
export async function uninstall(f) {
  const op = await f.manager.planUninstall('test.notes');
  return f.manager.confirmUninstall({ planId: op.id, pluginIdText: 'test.notes', expectedRevision: op.installationRevision });
}
