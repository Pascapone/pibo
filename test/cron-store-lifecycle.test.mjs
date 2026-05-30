import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PiboCronStore } from '../dist/cron/store.js';
import { LEGACY_SHARED_APP_OWNER_SCOPE } from '../dist/shared-app.js';

function createStore() {
  return new PiboCronStore({ path: ':memory:' });
}

function baseJobInput(overrides = {}) {
  return {
    ownerScope: 'user:test',
    target: { kind: 'personal', principalId: 'user:test' },
    profile: 'default',
    prompt: 'run lifecycle check',
    schedule: {
      kind: 'every',
      everyMs: 60 * 60 * 1000,
      anchorMs: Date.parse('2026-05-09T00:00:00.000Z'),
    },
    ...overrides,
  };
}

test('cron store validates required job fields before persisting', () => {
  const store = createStore();
  try {
    const sharedJob = store.createJob(baseJobInput({ ownerScope: '  ', enabled: false }));
    assert.equal(sharedJob.ownerScope, LEGACY_SHARED_APP_OWNER_SCOPE);
    assert.deepEqual(sharedJob.target, { kind: 'personal', principalId: LEGACY_SHARED_APP_OWNER_SCOPE });
    assert.throws(
      () => store.createJob(baseJobInput({ profile: '  ' })),
      /profile is required/,
    );
    assert.throws(
      () => store.createJob(baseJobInput({ prompt: '  ' })),
      /prompt is required/,
    );
    assert.throws(
      () => store.createJob(baseJobInput({ target: { kind: 'room', roomId: '  ' } })),
      /target\.roomId is required/,
    );
    assert.throws(
      () => store.createJob(baseJobInput({
        schedule: { kind: 'at', at: '2026-05-09T07:00:00.000Z' },
      }), new Date('2026-05-09T07:30:00.000Z')),
      /schedule has no future run/,
    );
    assert.deepEqual(store.listJobs({ ownerScope: 'user:other', includeDisabled: true }).map((job) => job.id), [sharedJob.id]);
  } finally {
    store.close();
  }
});

test('cron store completes recurring runs and schedules the next tick', () => {
  const store = createStore();
  try {
    const job = store.createJob(baseJobInput(), new Date('2026-05-09T07:30:00.000Z'));
    assert.equal(job.state.nextRunAt, '2026-05-09T08:00:00.000Z');

    const due = store.reserveDueRuns(1, new Date('2026-05-09T08:00:00.000Z'));
    assert.equal(due.length, 1);
    assert.equal(due[0].job.state.runningAt, '2026-05-09T08:00:00.000Z');

    store.completeRun({ jobId: job.id, runId: due[0].run.id, status: 'ok', piboSessionId: 'ps_ok' }, new Date('2026-05-09T08:05:00.000Z'));
    const updated = store.getJob(job.id);
    assert.equal(updated.enabled, true);
    assert.equal(updated.state.runningAt, undefined);
    assert.equal(updated.state.nextRunAt, '2026-05-09T09:00:00.000Z');
    assert.equal(updated.state.lastStatus, 'ok');
    assert.equal(updated.state.lastPiboSessionId, 'ps_ok');
    assert.equal(updated.state.consecutiveErrors, 0);
  } finally {
    store.close();
  }
});

test('cron store error completion increments and later success resets consecutive errors', () => {
  const store = createStore();
  try {
    const job = store.createJob(baseJobInput(), new Date('2026-05-09T07:30:00.000Z'));

    const first = store.reserveManualRun('user:other', job.id, new Date('2026-05-09T08:00:00.000Z'));
    store.completeRun({ jobId: job.id, runId: first.run.id, status: 'error', error: 'boom' }, new Date('2026-05-09T08:01:00.000Z'));
    const failed = store.getJob(job.id);
    assert.equal(failed.state.runningAt, undefined);
    assert.equal(failed.state.lastStatus, 'error');
    assert.equal(failed.state.lastError, 'boom');
    assert.equal(failed.state.consecutiveErrors, 1);

    const second = store.reserveManualRun('user:test', job.id, new Date('2026-05-09T08:02:00.000Z'));
    store.completeRun({ jobId: job.id, runId: second.run.id, status: 'ok' }, new Date('2026-05-09T08:03:00.000Z'));
    const recovered = store.getJob(job.id);
    assert.equal(recovered.state.lastStatus, 'ok');
    assert.equal(recovered.state.lastError, undefined);
    assert.equal(recovered.state.consecutiveErrors, 0);
  } finally {
    store.close();
  }
});

test('cron store deleteAfterRun keeps failed one-shot jobs but deletes successful ones', () => {
  const store = createStore();
  try {
    const failedJob = store.createJob(baseJobInput({
      schedule: { kind: 'at', at: '2026-05-09T08:00:00.000Z' },
      deleteAfterRun: true,
    }), new Date('2026-05-09T07:30:00.000Z'));
    const failedRun = store.reserveDueRuns(1, new Date('2026-05-09T08:00:00.000Z'))[0].run;
    store.completeRun({ jobId: failedJob.id, runId: failedRun.id, status: 'error', error: 'temporary' }, new Date('2026-05-09T08:01:00.000Z'));
    assert.equal(store.getJob(failedJob.id).state.lastStatus, 'error');

    const okJob = store.createJob(baseJobInput({
      schedule: { kind: 'at', at: '2026-05-09T09:00:00.000Z' },
      deleteAfterRun: true,
    }), new Date('2026-05-09T08:30:00.000Z'));
    const okRun = store.reserveDueRuns(1, new Date('2026-05-09T09:00:00.000Z'))[0].run;
    store.completeRun({ jobId: okJob.id, runId: okRun.id, status: 'ok' }, new Date('2026-05-09T09:01:00.000Z'));
    assert.equal(store.getJob(okJob.id), undefined);
  } finally {
    store.close();
  }
});

test('cron store recovers interrupted runs without leaving jobs running', () => {
  const store = createStore();
  try {
    const job = store.createJob(baseJobInput(), new Date('2026-05-09T07:30:00.000Z'));
    const due = store.reserveDueRuns(1, new Date('2026-05-09T08:00:00.000Z'));
    assert.equal(due.length, 1);

    const recoveredCount = store.recoverInterruptedRuns(new Date('2026-05-09T08:05:00.000Z'));
    assert.equal(recoveredCount, 1);

    const recovered = store.getJob(job.id);
    assert.equal(recovered.state.runningAt, undefined);
    assert.equal(recovered.state.lastStatus, 'error');
    assert.equal(recovered.state.lastError, 'Cron run was interrupted by gateway restart');
    const run = store.getRun(due[0].run.id);
    assert.equal(run.status, 'error');
    assert.equal(run.reason, 'interrupted');
  } finally {
    store.close();
  }
});
