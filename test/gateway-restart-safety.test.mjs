import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkActiveWork, RESTART_CONFIRMATION_TOKEN } from '../dist/gateway/cli.js';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWebHostChannel } from '../dist/web/channel.js';

const idle = { reachable: true, mode: 'prod', runtimeStatuses: [], activeRuns: [] };

describe('gateway restart safety', () => {
  it('blocks with processing sessions', () => {
    assert.equal(checkActiveWork({ ...idle, runtimeStatuses: [{ piboSessionId: 's1', processing: true }] }).unsafe, true);
  });
  it('blocks with streaming sessions', () => {
    assert.equal(checkActiveWork({ ...idle, runtimeStatuses: [{ piboSessionId: 's1', streaming: true }] }).unsafe, true);
  });
  it('blocks with queued messages', () => {
    assert.equal(checkActiveWork({ ...idle, runtimeStatuses: [{ piboSessionId: 's1', queuedMessages: 1 }] }).unsafe, true);
  });
  it('blocks with stale telemetry hints', () => {
    const check = checkActiveWork({ ...idle, runtimeStatuses: [{ piboSessionId: 's1', activeTelemetry: { isStale: true, activePhase: 'tool_args' } }] });
    assert.equal(check.unsafe, true);
    assert.match(check.reasons.join('\n'), /s1 has stale telemetry in tool_args/);
  });
  it('blocks with active yielded runs', () => {
    assert.equal(checkActiveWork({ ...idle, activeRuns: [{ runId: 'r1', status: 'running' }] }).unsafe, true);
  });
  it('blocks when status is unavailable', () => {
    assert.equal(checkActiveWork({ reachable: true, mode: 'unknown', error: 'no status', runtimeStatuses: [], activeRuns: [] }).unsafe, true);
  });
  it('allows restart when gateway is idle', () => {
    assert.equal(checkActiveWork(idle).unsafe, false);
  });
  it('exports the exact force confirmation token', () => {
    assert.equal(RESTART_CONFIRMATION_TOKEN, 'restart-active-agents');
  });
});

describe('deploy scripts', () => {
  it('do not call direct restart operations', () => {
    for (const path of ['scripts/deploy-web.sh', 'scripts/deploy-web-dev.sh']) {
      const script = readFileSync(path, 'utf8');
      assert.doesNotMatch(script, /systemctl|restart pibo|stop pibo/);
    }
  });
  it('print CLI restart instructions', () => {
    assert.match(readFileSync('scripts/deploy-web.sh', 'utf8'), /pibo gateway web restart/);
    assert.match(readFileSync('scripts/deploy-web-dev.sh', 'utf8'), /pibo gateway dev restart/);
  });
});


function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : resolve(port));
    });
    server.once('error', reject);
  });
}

async function waitUntilReachable(port) {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/gateway/status`);
      if (response.ok) return await response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`fake gateway on ${port} did not become reachable`);
}

describe('gateway status endpoint', () => {
  it('uses direct run registry summaries instead of scanning stored session snapshots', async () => {
    const port = await freePort();
    const channel = createWebHostChannel({ port, gatewayMode: 'prod', announce: false });
    await channel.start({
      listSessionRuntimeStatuses: () => [],
      listRuns: () => [
        { runId: 'run_active', kind: 'tool', ownerPiboSessionId: 'ps_1', status: 'running', completionPolicy: 'tracked', consumed: false, toolName: 'bash', createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z' },
        { runId: 'run_done', kind: 'tool', ownerPiboSessionId: 'ps_1', status: 'completed', completionPolicy: 'tracked', consumed: false, toolName: 'bash', createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' },
      ],
      listSessions: () => { throw new Error('status endpoint should not scan all stored sessions'); },
      snapshotSignalTree: () => { throw new Error('status endpoint should not snapshot session trees'); },
      getGatewayActions: () => [],
      getWebApps: () => [],
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/gateway/status`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.mode, 'prod');
      assert.deepEqual(body.activeRuns.map((run) => run.runId), ['run_active']);
    } finally {
      await channel.stop();
    }
  });
});


describe('gateway start command', () => {
  it('starts a dev gateway that is not reachable yet', async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'pibo-gateway-start-'));
    const pidPath = join(dir, 'gateway.pid');
    const scriptPath = join(dir, 'manager.sh');
    writeFileSync(scriptPath, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" != "start" ]]; then exit 42; fi
node -e 'const http=require("node:http"); const fs=require("node:fs"); const port=Number(process.env.FAKE_GATEWAY_PORT); const server=http.createServer((req,res)=>{ if(req.url==="/gateway/status"){ res.setHeader("content-type","application/json"); res.end(JSON.stringify({status:"ok",mode:"dev",runtimeStatuses:[],activeRuns:[]})); return; } res.statusCode=404; res.end("not found"); }); server.listen(port,"127.0.0.1",()=>fs.writeFileSync(process.env.FAKE_GATEWAY_PID,String(process.pid)));' >/dev/null 2>&1 &
`, 'utf8');
    chmodSync(scriptPath, 0o755);
    const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', 'dev', 'start'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PIBO_GATEWAY_DEV_PORT: String(port),
        PIBO_GATEWAY_MANAGER_COMMAND: scriptPath,
        PIBO_GATEWAY_HEALTH_RETRIES: '30',
        PIBO_GATEWAY_HEALTH_INTERVAL_MS: '50',
        FAKE_GATEWAY_PORT: String(port),
        FAKE_GATEWAY_PID: pidPath,
      },
    });
    try {
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Gateway started successfully/);
      assert.equal((await waitUntilReachable(port)).mode, 'dev');
    } finally {
      try { process.kill(Number(readFileSync(pidPath, 'utf8')), 'SIGTERM'); } catch {}
    }
  });

  it('blocks start when a reachable gateway has the wrong mode', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/gateway/status') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ status: 'ok', mode: 'prod', runtimeStatuses: [], activeRuns: [] }));
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : undefined;
    try {
      const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', 'dev', 'start'], {
        encoding: 'utf8',
        env: { ...process.env, PIBO_GATEWAY_DEV_PORT: String(port) },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Start blocked: gateway state is ambiguous/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
