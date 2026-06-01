import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { computeNextRunAt, parseFriendlySchedule } from '../dist/cron/schedule.js';
import { PiboCronStore } from '../dist/cron/store.js';
import { PRE_CUTOVER_LEGACY_OWNER_SCOPE } from '../dist/owner-scope-compat.js';

const execFileAsync = promisify(execFile);
const cliPath = new URL('../dist/bin/pibo.js', import.meta.url).pathname;

test('cron at schedule returns future date once', () => {
  const now = new Date('2026-05-09T08:00:00.000Z');
  const next = computeNextRunAt({ kind: 'at', at: '2026-05-09T08:20:00.000Z' }, now);
  assert.equal(next?.toISOString(), '2026-05-09T08:20:00.000Z');
  assert.equal(computeNextRunAt({ kind: 'at', at: '2026-05-09T07:59:00.000Z' }, now), undefined);
});

test('cron every schedule computes next anchored tick', () => {
  const next = computeNextRunAt({ kind: 'every', everyMs: 2 * 60 * 60 * 1000, anchorMs: Date.parse('2026-05-09T00:00:00.000Z') }, new Date('2026-05-09T03:01:00.000Z'));
  assert.equal(next?.toISOString(), '2026-05-09T04:00:00.000Z');
});

test('friendly daily schedule becomes cron expression', () => {
  const { schedule } = parseFriendlySchedule({ kind: 'daily', time: '08:30', tz: 'UTC' }, new Date('2026-05-09T00:00:00.000Z'));
  assert.deepEqual(schedule, { kind: 'cron', expr: '30 8 * * *', tz: 'UTC' });
});

test('cron store persists app-global jobs, ignores owner filters, and reserves a due run once', () => {
  const store = new PiboCronStore({ path: ':memory:' });
  const now = new Date('2026-05-09T08:00:00.000Z');
  const job = store.createJob({
    ownerScope: 'user:a',
    target: { kind: 'personal', principalId: 'user:a' },
    profile: 'default',
    prompt: 'do it',
    schedule: { kind: 'at', at: '2026-05-09T08:01:00.000Z' },
  }, now);
  assert.equal(job.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
  assert.deepEqual(job.target, { kind: 'personal', principalId: PRE_CUTOVER_LEGACY_OWNER_SCOPE });
  assert.deepEqual(store.listJobs({ ownerScope: 'user:b', includeDisabled: true }).map((item) => item.id), [job.id]);
  assert.equal(store.reserveDueRuns(10, now).length, 0);
  const due = store.reserveDueRuns(10, new Date('2026-05-09T08:02:00.000Z'));
  assert.equal(due.length, 1);
  assert.equal(due[0].job.id, job.id);
  assert.equal(store.reserveDueRuns(10, new Date('2026-05-09T08:02:00.000Z')).length, 0);
  store.completeRun({ jobId: job.id, runId: due[0].run.id, status: 'ok', piboSessionId: 'ps_test' }, new Date('2026-05-09T08:03:00.000Z'));
  const updated = store.getJob(job.id);
  assert.equal(updated.enabled, false);
  assert.equal(updated.state.lastPiboSessionId, 'ps_test');
  assert.equal(store.listRuns({ ownerScope: 'user:b' })[0].ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
  store.close();
});

test('cron store jointly exposes and controls historical user cron jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-historical-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    let store = new PiboCronStore({ path: storePath });
    const now = new Date('2026-05-09T08:00:00.000Z');
    const jobA = store.createJob({ ownerScope: 'user:a', target: { kind: 'personal', principalId: 'user:a' }, profile: 'default', prompt: 'a', schedule: { kind: 'at', at: '2026-05-09T08:10:00.000Z' } }, now);
    const jobB = store.createJob({ ownerScope: 'user:b', target: { kind: 'personal', principalId: 'user:b' }, profile: 'default', prompt: 'b', schedule: { kind: 'at', at: '2026-05-09T08:20:00.000Z' } }, now);
    store.close();

    const db = new DatabaseSync(storePath);
    db.exec("ALTER TABLE pibo_cron_jobs ADD COLUMN owner_scope TEXT NOT NULL DEFAULT 'shared:app'");
    db.prepare('UPDATE pibo_cron_jobs SET owner_scope = ?, target_json = ? WHERE id = ?').run('user:a', JSON.stringify({ kind: 'personal', principalId: 'user:a' }), jobA.id);
    db.prepare('UPDATE pibo_cron_jobs SET owner_scope = ?, target_json = ? WHERE id = ?').run('user:b', JSON.stringify({ kind: 'personal', principalId: 'user:b' }), jobB.id);
    db.close();

    store = new PiboCronStore({ path: storePath });
    assert.deepEqual(store.listJobs({ ownerScope: 'user:c', includeDisabled: true }).map((job) => job.id).sort(), [jobA.id, jobB.id].sort());
    const updated = store.updateJob('user:c', jobA.id, { name: 'updated by c', target: { kind: 'personal', principalId: 'user:c' } });
    assert.equal(updated.name, 'updated by c');
    assert.equal(updated.ownerScope, 'user:a');
    assert.deepEqual(updated.target, { kind: 'personal', principalId: PRE_CUTOVER_LEGACY_OWNER_SCOPE });
    const reserved = store.reserveManualRun('user:c', jobA.id, new Date('2026-05-09T08:03:00.000Z'));
    assert.equal(reserved.job.id, jobA.id);
    assert.equal(reserved.run.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
    assert.deepEqual(store.listRuns({ ownerScope: 'user:b' }).map((run) => run.id), [reserved.run.id]);
    assert.equal(store.removeJob('user:c', jobB.id), true);
    assert.equal(store.getJob(jobB.id), undefined);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cron CLI creates shared jobs without owner scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    const result = await execFileAsync('node', [cliPath, 'cron', '--store', storePath, 'add', '--personal', '--daily', '09:10', '--prompt', 'do it', '--json']);
    const job = JSON.parse(result.stdout);
    assert.equal(job.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
    assert.deepEqual(job.target, { kind: 'personal', principalId: PRE_CUTOVER_LEGACY_OWNER_SCOPE });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cron CLI treats explicit owner scope as deprecated no-op', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    const result = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'add',
      '--personal',
      '--daily',
      '09:10',
      '--prompt',
      'do it',
      '--json',
    ]);
    const job = JSON.parse(result.stdout);
    assert.equal(job.ownerScope, PRE_CUTOVER_LEGACY_OWNER_SCOPE);
    assert.deepEqual(job.target, { kind: 'personal', principalId: PRE_CUTOVER_LEGACY_OWNER_SCOPE });
    assert.match(result.stderr, /--owner-scope is deprecated for Cron and ignored/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cron CLI edits prompt, target, profile, and schedule', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pibo-cron-cli-'));
  const storePath = join(root, 'cron.sqlite');
  try {
    const added = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'add',
      '--personal',
      '--daily',
      '09:10',
      '--prompt',
      'old prompt',
      '--json',
    ]);
    const original = JSON.parse(added.stdout);
    const edited = await execFileAsync('node', [
      cliPath,
      'cron',
      '--store',
      storePath,
      '--owner-scope',
      'user:test',
      'edit',
      original.id,
      '--room',
      'room_123',
      '--every',
      '2h',
      '--agent',
      'agent-x',
      '--prompt',
      'new prompt',
      '--name',
      'new name',
      '--delete-after-run',
      '--json',
    ]);
    const job = JSON.parse(edited.stdout);
    assert.equal(job.id, original.id);
    assert.equal(job.name, 'new name');
    assert.equal(job.prompt, 'new prompt');
    assert.equal(job.profile, 'agent-x');
    assert.deepEqual(job.target, { kind: 'room', roomId: 'room_123' });
    assert.equal(job.schedule.kind, 'every');
    assert.equal(job.schedule.everyMs, 2 * 60 * 60 * 1000);
    assert.equal(job.deleteAfterRun, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
