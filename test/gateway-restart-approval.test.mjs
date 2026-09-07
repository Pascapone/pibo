import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createWebHostChannel } from '../dist/web/channel.js';
import { restartConfirmationToken } from '../dist/gateway/cli.js';

const exec = promisify(execFile);

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pibo-restart-approval-'));
  const marker = join(root, 'manager');
  const manager = join(root, process.platform === 'win32' ? 'manager.cmd' : 'manager.sh');
  writeFileSync(manager, process.platform === 'win32'
    ? `@echo off\r\necho %*>>"${marker}"\r\n`
    : `#!/bin/sh\nprintf '%s\\n' "$*" >> '${marker}'\n`);
  chmodSync(manager, 0o755);
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const state = { sessions: [], runs: [], inspections: 0, onInspect: undefined };
  const channel = createWebHostChannel({ port, gatewayMode: 'prod', announce: false });
  await channel.start({
    listSessionRuntimeStatuses() {
      state.inspections += 1;
      state.onInspect?.();
      return state.sessions;
    },
    listRuns: () => state.runs,
    getGatewayActions: () => [], getWebApps: () => [],
  });
  return {
    state, marker, root,
    async cli(...args) {
      try {
        const result = await exec(process.execPath, ['dist/bin/pibo.js', 'gateway', 'web', ...args], {
          timeout: 15000,
          env: { ...process.env, PIBO_HOME: root, PIBO_GATEWAY_WEB_HOME: root, PIBO_GATEWAY_WEB_PORT: String(port), PIBO_GATEWAY_MANAGER_COMMAND: manager, PIBO_GATEWAY_HEALTH_RETRIES: '1' },
        });
        return { ...result, code: 0, output: result.stdout + result.stderr };
      } catch (error) {
        return { ...error, output: error.stdout + error.stderr };
      }
    },
    async approval() {
      const result = await this.cli('status');
      assert.equal(result.code, 0, result.output);
      const token = result.output.match(/--confirm (restart-active-agents:[a-f0-9]{64})/)?.[1];
      assert.ok(token, result.output);
      return token;
    },
    async close() { await channel.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

function active(eventId = 'event-1') {
  return { piboSessionId: 'ps_busy', processing: true, streaming: false, queuedMessages: 0, activeEventId: eventId, queuedEventIds: [] };
}

test('delayed legacy force confirmation inspects and blocks newly active work', async () => {
  const f = await fixture();
  try {
    await f.cli('status'); // earlier idle inspection
    f.state.sessions = [active()];
    const before = f.state.inspections;
    const result = await f.cli('restart', '--force', '--confirm', 'restart-active-agents');
    assert.notEqual(result.code, 0, result.output);
    assert.ok(f.state.inspections > before, 'force must fetch execution-time status');
    assert.match(result.output, /ps_busy/);
    assert.equal(existsSync(f.marker), false);
  } finally { await f.close(); }
});

test('idle approval cannot interrupt a turn started before detached execution', async () => {
  const f = await fixture();
  try {
    const token = await f.approval();
    await new Promise(resolve => setTimeout(resolve, 20));
    f.state.sessions = [active()];
    const result = await f.cli('restart', '--force', '--confirm', token);
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /snapshot|approval/i);
    assert.equal(existsSync(f.marker), false);
  } finally { await f.close(); }
});

test('unchanged explicit approval restarts and audits the disclosed sessions and runs', async () => {
  const f = await fixture();
  try {
    f.state.sessions = [{ ...active(), queuedMessages: 1, queuedEventIds: ['queued-1'], activeTelemetry: { isStale: true, activePhase: 'tool_execution' } }];
    f.state.runs = [{ runId: 'run_active', controllerPiboSessionId: 'ps_busy', status: 'running', toolName: 'bash' }];
    const token = await f.approval();
    const before = f.state.inspections;
    const result = await f.cli('restart', '--force', '--confirm', token);
    assert.equal(result.code, 0, result.output);
    assert.ok(f.state.inspections >= before + 2, 'must recheck immediately before invoking manager');
    assert.match(result.output, /ps_busy/);
    assert.match(result.output, /queued-1/);
    assert.match(result.output, /stale telemetry/);
    assert.match(result.output, /run_active/);
    assert.match(readFileSync(f.marker, 'utf8'), /restart/);
    const audit = readFileSync(join(f.root, 'gateway-restart-audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(audit.some(entry => entry.decision === 'approved' && entry.sessionIds.includes('ps_busy') && entry.runIds.includes('run_active')));
  } finally { await f.close(); }
});

for (const [name, mutate] of [
  ['new turn in the same session', state => { state.sessions[0].activeEventId = 'event-2'; }],
  ['different queued message at equal queue depth', state => { state.sessions[0].queuedEventIds = ['queued-2']; }],
  ['new yielded run', state => { state.runs = [{ runId: 'run_new', controllerPiboSessionId: 'ps_busy', status: 'running' }]; }],
]) {
  test(`approval rejects ${name}`, async () => {
    const f = await fixture();
    try {
      f.state.sessions = [{ ...active(), queuedMessages: 1, queuedEventIds: ['queued-1'] }];
      const token = await f.approval();
      mutate(f.state);
      const result = await f.cli('restart', '--force', '--confirm', token);
      assert.notEqual(result.code, 0, result.output);
      assert.equal(existsSync(f.marker), false);
    } finally { await f.close(); }
  });
}

test('work changing during the final recheck aborts even with explicit approval', async () => {
  const f = await fixture();
  try {
    f.state.sessions = [active()];
    const token = await f.approval();
    const changeAt = f.state.inspections + 2;
    f.state.onInspect = () => { if (f.state.inspections === changeAt) f.state.sessions = [active('event-new')]; };
    const result = await f.cli('restart', '--force', '--confirm', token);
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /event-new/);
    assert.equal(existsSync(f.marker), false);
  } finally { await f.close(); }
});

test('snapshot tokens bind gateway generation but ignore progress clocks and list ordering', () => {
  const status = {
    reachable: true, mode: 'prod', generation: 'generation-one',
    runtimeStatuses: [active(), { ...active('other-event'), piboSessionId: 'ps_other' }],
    activeRuns: [],
  };
  const token = restartConfirmationToken(status);
  assert.ok(token);
  assert.equal(restartConfirmationToken({ ...status, runtimeStatuses: [...status.runtimeStatuses].reverse().map(session => ({ ...session, activeTelemetry: { staleForMs: 100, lastProgressAt: 'later' } })) }), token);
  assert.notEqual(restartConfirmationToken({ ...status, generation: 'generation-two' }), token);
  assert.equal(restartConfirmationToken({ ...status, generation: undefined }), undefined);
  assert.equal(restartConfirmationToken({ ...status, runtimeStatuses: [{ ...active(), activeEventId: undefined }] }), undefined);
  assert.equal(restartConfirmationToken({ ...status, ambiguous: true }), undefined);
  assert.equal(restartConfirmationToken({ ...status, reachable: false }), undefined);
});

test('ordinary idle restart rechecks status and invokes the manager', async () => {
  const f = await fixture();
  try {
    const result = await f.cli('restart');
    assert.equal(result.code, 0, result.output);
    assert.ok(f.state.inspections >= 2);
    assert.equal(existsSync(f.marker), true);
  } finally { await f.close(); }
});

test('malformed runtime status cannot be treated as idle or forcibly approved', async () => {
  const f = await fixture();
  try {
    f.state.sessions = [{}];
    for (const args of [[], ['--force', '--confirm', 'restart-active-agents']]) {
      const result = await f.cli('restart', ...args);
      assert.notEqual(result.code, 0, result.output);
      assert.match(result.output, /ambiguous/);
      assert.equal(existsSync(f.marker), false);
    }
  } finally { await f.close(); }
});

test('loss of authoritative status during the final recheck fails closed', async () => {
  const f = await fixture();
  try {
    const changeAt = f.state.inspections + 2;
    f.state.onInspect = () => { if (f.state.inspections === changeAt) throw new Error('status unavailable'); };
    const result = await f.cli('restart');
    assert.notEqual(result.code, 0, result.output);
    assert.equal(existsSync(f.marker), false);
  } finally { await f.close(); }
});

test('ordinary production restart remains blocked for active work', async () => {
  const f = await fixture();
  try {
    f.state.sessions = [active()];
    const result = await f.cli('restart');
    assert.notEqual(result.code, 0, result.output);
    assert.equal(existsSync(f.marker), false);
  } finally { await f.close(); }
});
