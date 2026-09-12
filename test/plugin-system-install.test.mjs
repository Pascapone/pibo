import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fixture, manifest, snapshot } from './plugin-system-management-helpers.mjs';
import { PluginManager } from '../dist/plugins/manager.js';
import { PluginHost } from '../dist/plugins/host.js';
import { createStagedPluginDefinition } from '../dist/plugins/staged-definition.js';

test('local and versioned package artifacts have identical content identity and inspection never imports', async (t) => {
  const f = await fixture(t); const marker = join(f.root, 'executed');
  await writeFile(join(f.source, 'backend.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes');`);
  await writeFile(join(f.source, 'package.json'), JSON.stringify({ name: '@test/notes', version: '1.0.0', scripts: { install: 'exit 99' } }));
  const archive = join(f.root, 'notes.tgz'); execFileSync('tar', ['-czf', archive, '--transform=s,^,package/,', '-C', f.source, 'pibo.plugin.json', 'backend.mjs', 'browser.mjs', 'package.json']);
  const local = await f.manager.inspect({ kind: 'local', path: f.source });
  const packaged = await f.manager.inspect({ kind: 'package', path: archive, name: '@test/notes', version: '1.0.0' });
  assert.equal(local.contentHash, packaged.contentHash); await assert.rejects(access(marker));
  await f.manager.install({ kind: 'package', path: archive, name: '@test/notes', version: '1.0.0' }, { expectedRevision: 0 });
  await assert.rejects(access(marker));
  await f.manager.activate('test.notes', { expectedRevision: 1 }); assert.equal(await readFile(marker, 'utf8'), 'yes');
});
test('ordinary staged package lazily activates through the real core host and cleans every registration', async (t) => {
  const f = await fixture(t); const marker = join(f.root, 'host-setup');
  await writeFile(join(f.source, 'backend.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported'); export function setup(context) { context.register('read', { execute: () => 'notes' }); return () => writeFileSync(${JSON.stringify(marker)}, 'disposed'); }`);
  await f.install(); const installation = { ...f.store.getInstallation('test.notes'), enabled: true };
  const definition = createStagedPluginDefinition(installation); await assert.rejects(access(marker));
  const host = new PluginHost();
  await assert.rejects(host.start({ plugins: [{ ...definition, installation: { ...installation, manifest: { ...installation.manifest, dependencies: [{ id: 'missing.plugin', version: '^1.0.0' }] } } }] }), /Missing plugin/);
  await assert.rejects(access(marker));
  await host.start({ plugins: [definition] }); assert.equal(host.inspect().state, 'active'); assert.equal(host.contributions.list('contribution').length, 1); assert.equal(await readFile(marker, 'utf8'), 'imported');
  await host.stop(); assert.equal(host.contributions.list().length, 0); assert.equal(await readFile(marker, 'utf8'), 'disposed');
});
test('dry-run creates no installation, operation, staged files or executable effects', async (t) => {
  const f = await fixture(t); const result = await f.manager.install({ kind: 'local', path: f.source }, { expectedRevision: 0, dryRun: true });
  assert.equal(result.dryRun, true); assert.deepEqual(f.store.listInstallations(), []); assert.deepEqual(f.store.listOperations(), []);
  await assert.rejects(access(f.managerOptions.artifactRoot));
});
test('SDK, entrypoint, dependency, archive integrity, symlinks and mutable stage failures stay inactive', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ sdk: '^99.0.0' })));
  await assert.rejects(f.install(), /SDK|sdk|compatible/);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ entrypoints: { backend: '../outside.mjs' } })));
  await assert.rejects(f.install(), /path|entry|manifest/i);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ dependencies: [{ id: 'missing.plugin', version: '^1.0.0' }] })));
  await assert.rejects(f.install(), /dependency/);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest()));
  await symlink('/etc/passwd', join(f.source, 'escape')); await assert.rejects(f.install(), /symlink/);
  const { unlink } = await import('node:fs/promises'); await unlink(join(f.source, 'escape'));
  await f.install(); const installation = f.store.getInstallation('test.notes');
  const { chmod } = await import('node:fs/promises'); await chmod(join(installation.artifactPath, 'backend.mjs'), 0o600); await writeFile(join(installation.artifactPath, 'backend.mjs'), 'changed');
  await assert.rejects(f.manager.activate('test.notes', { expectedRevision: installation.stateRevision }), /hash/);
  assert.equal(f.starts, 0); assert.equal(f.store.getInstallation('test.notes').state, 'installed');
  await assert.rejects(f.manager.inspect({ kind: 'package', path: join(f.source, 'backend.mjs'), name: '@test/notes', version: 'latest' }), /exact version/);
  await assert.rejects(f.manager.inspect({ kind: 'package', path: join(f.source, 'backend.mjs'), name: '@test/notes', version: '1.0.0', integrity: 'sha256-wrong' }), /integrity/);
});
test('source edits do not alter staged execution, updates wait for a safe drain', async (t) => {
  const f = await fixture(t); const initial = await f.active();
  await writeFile(join(f.source, 'backend.mjs'), 'export const version = 2;');
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ version: '2.0.0' })));
  f.setConsumers([{ kind: 'run', id: 'run_a', usage: 'active' }]);
  await f.install(); const pending = f.store.getInstallation('test.notes'); assert.equal(pending.state, 'pending-activation'); assert.equal(pending.revision, initial.revision);
  const op = await f.manager.activate('test.notes', { expectedRevision: pending.stateRevision }); assert.equal(op.state, 'draining'); assert.equal(f.starts, 1);
  assert.throws(() => f.manager.assertCanActivate(['test.notes']), /cannot accept/);
  f.setConsumers([]); await f.manager.resumeOperation(op.id); assert.equal(f.store.getInstallation('test.notes').version, '2.0.0'); assert.equal(f.starts, 2);
});
test('A21 real process death after content staging is recoverable and never imports staged code', async (t) => {
  const f = await fixture(t); const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {PiboDataStore} from './dist/data/pibo-store.js';
    import {PluginManager} from './dist/plugins/manager.js';
    const data = new PiboDataStore(${JSON.stringify(f.data.path)}, {payloadRootDir:${JSON.stringify(f.root + '/payloads')}});
    const manager = new PluginManager({store:data.plugins,artifactRoot:${JSON.stringify(f.managerOptions.artifactRoot)},checkpoint(stage){if(stage==='staged')process.kill(process.pid,'SIGKILL')}});
    await manager.install({kind:'local',path:${JSON.stringify(f.source)}},{expectedRevision:0});
  `], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(child.signal, 'SIGKILL', child.stderr); assert.equal(f.store.listInstallations().length, 0); const staged = f.store.listOperations()[0]; assert.equal(staged.state, 'staging'); assert.ok(staged.artifact.artifactPath);
  const recovered = await f.manager.recover(); assert.equal(recovered[0].state, 'failed'); assert.equal(f.starts, 0);
  assert.deepEqual(await f.manager.recover(), recovered); await f.install(); assert.equal(f.store.getInstallation('test.notes').state, 'installed');
});
test('failed update staging keeps the old active revision and historical generation unchanged', async (t) => {
  const f = await fixture(t); const before = await f.active(); const historical = snapshot(before); f.store.putGenerationSnapshot(historical);
  await writeFile(join(f.source, 'pibo.plugin.json'), JSON.stringify(manifest({ version: '2.0.0' })));
  const manager = new PluginManager({ ...f.managerOptions, checkpoint(stage) { if (stage === 'staged') throw new Error('failed new artifact commit'); } });
  await assert.rejects(manager.install({ kind: 'local', path: f.source }, { expectedRevision: before.stateRevision }), /failed new artifact/);
  assert.deepEqual(f.store.getInstallation('test.notes'), before); assert.deepEqual(f.store.getGenerationSnapshot('ps_a', 'g1'), historical); f.manager.assertCanActivate(['test.notes']); assert.equal(f.starts, 1);
});
test('staging crash and import failure recover without an active partial installation', async (t) => {
  const f = await fixture(t); const manager = new PluginManager({ ...f.managerOptions, checkpoint(stage) { if (stage === 'staged') throw new Error('crash after stage'); } });
  await assert.rejects(manager.install({ kind: 'local', path: f.source }, { expectedRevision: 0 }), /crash/);
  assert.equal(f.store.getInstallation('test.notes'), undefined); await f.manager.recover(); assert.equal(f.starts, 0);
  await writeFile(join(f.source, 'backend.mjs'), 'throw new Error("broken import");'); await f.install();
  const op = await f.manager.activate('test.notes', { expectedRevision: 1 }); assert.equal(op.state, 'failed'); assert.match(op.diagnostic, /broken import/);
  assert.equal(f.store.getInstallation('test.notes').state, 'retiring');
});
