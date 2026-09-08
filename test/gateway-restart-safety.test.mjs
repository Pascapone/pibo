import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { checkActiveWork, RESTART_CONFIRMATION_TOKEN } from '../dist/gateway/cli.js';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

describe('managed gateway help', () => {
  it('keeps nested lifecycle help side-effect free', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pibo-gateway-help-'));
    const markerPath = join(dir, 'manager-invoked');
    const managerPath = join(dir, 'manager.mjs');
    const scriptPath = join(dir, process.platform === 'win32' ? 'manager.cmd' : 'manager.sh');
    writeFileSync(managerPath, `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FAKE_GATEWAY_MANAGER_MARKER, process.argv.slice(2).join(' '));
process.exitCode = 42;
`, 'utf8');
    if (process.platform === 'win32') {
      writeFileSync(scriptPath, `@echo off\r\n"${process.execPath}" "${managerPath}" %*\r\n`, 'utf8');
    } else {
      writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n"${process.execPath}" "${managerPath}" "$@"\n`, 'utf8');
      chmodSync(scriptPath, 0o755);
    }

    try {
      for (const target of ['web', 'dev']) {
        for (const action of ['start', 'restart']) {
          rmSync(markerPath, { force: true });
          const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', target, action, '--help'], {
            encoding: 'utf8',
            env: {
              ...process.env,
              PIBO_GATEWAY_MANAGER_COMMAND: scriptPath,
              PIBO_GATEWAY_WEB_PORT: '1',
              PIBO_GATEWAY_DEV_PORT: '1',
              FAKE_GATEWAY_MANAGER_MARKER: markerPath,
            },
          });
          assert.equal(result.status, 0, `${target} ${action}\n${result.stdout}\n${result.stderr}`);
          assert.match(result.stdout, /pibo gateway - Gateway management/);
          assert.match(result.stdout, /Next:\n  pibo gateway web status\n  pibo gateway dev status/);
          assert.doesNotMatch(result.stderr, /Starting|Restarting|Restart blocked/);
          assert.equal(existsSync(markerPath), false, `${target} ${action} invoked the gateway manager`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function executableDeployLines(script) {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => !/^(echo|printf)\b/.test(line));
}

describe('deploy scripts', () => {
  it('do not call direct restart, stop, or kill operations', () => {
    for (const path of ['scripts/deploy-web.sh', 'scripts/deploy-web-dev.sh']) {
      const executable = executableDeployLines(readFileSync(path, 'utf8')).join('\n');
      assert.doesNotMatch(executable, /\bsystemctl\b/);
      assert.doesNotMatch(executable, /\bservice\b.*\brestart\b/);
      assert.doesNotMatch(executable, /\bpkill\b|\bkill\b/);
      assert.doesNotMatch(executable, /\bpibo\s+gateway\s+(?:web\s+|dev\s+)?restart\b/);
      assert.doesNotMatch(executable, /\bdist\/bin\/pibo\.js\s+gateway\s+(?:web\s+|dev\s+)?restart\b/);
      assert.doesNotMatch(executable, /\brestart\s+pibo\b|\bstop\s+pibo\b/);
    }
  });
  it('print CLI restart instructions', () => {
    assert.match(readFileSync('scripts/deploy-web.sh', 'utf8'), /pibo gateway web restart/);
    assert.match(readFileSync('scripts/deploy-web-dev.sh', 'utf8'), /pibo gateway dev restart/);
  });
  it('keeps hosted dev public URLs in environment configuration', () => {
    const script = readFileSync('scripts/deploy-web-dev.sh', 'utf8');
    assert.doesNotMatch(script, /https:\/\/dev\.pibo/);
    assert.doesNotMatch(script, /neuralnexus\.me/);
    assert.match(script, /PIBO_DEPLOY_ENV_FILE/);
    assert.match(script, /PIBO_DEV_PUBLIC_URL/);
    assert.match(script, /PIBO_DEV_BASE_URL/);
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
  it('reports degraded run-job reliability without counting orphan jobs as active runs', async () => {
    const port = await freePort();
    const channel = createWebHostChannel({ port, gatewayMode: 'prod', announce: false });
    await channel.start({
      listSessionRuntimeStatuses: () => [],
      listRuns: () => [],
      getRunJobReliabilityStatus: () => ({ status: 'degraded', expiredOrphanRunJobs: 0, orphanRunDeadLetters: 3 }),
      getGatewayActions: () => [],
      getWebApps: () => [],
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/gateway/status`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.activeRuns, []);
      assert.deepEqual(body.reliability, { status: 'degraded', expiredOrphanRunJobs: 0, orphanRunDeadLetters: 3 });
    } finally {
      await channel.stop();
    }
  });

  it('uses direct run registry summaries instead of scanning stored session snapshots', async () => {
    const port = await freePort();
    const channel = createWebHostChannel({ port, gatewayMode: 'prod', announce: false });
    await channel.start({
      listSessionRuntimeStatuses: () => [],
      listRuns: () => [
        { runId: 'run_active', kind: 'tool', controllerPiboSessionId: 'ps_1', status: 'running', completionPolicy: 'tracked', consumed: false, toolName: 'bash', createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z' },
        { runId: 'run_done', kind: 'tool', controllerPiboSessionId: 'ps_1', status: 'completed', completionPolicy: 'tracked', consumed: false, toolName: 'bash', createdAt: '2026-05-16T00:00:00.000Z', updatedAt: '2026-05-16T00:00:00.000Z', completedAt: '2026-05-16T00:00:01.000Z' },
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
  it('reports app storage status failures as ambiguous instead of healthy',async()=>{
    const port=await freePort();const channel=createWebHostChannel({port,gatewayMode:'prod',announce:false});
    await channel.start({listSessionRuntimeStatuses:()=>[],listRuns:()=>[],getGatewayActions:()=>[],getWebApps:()=>[{name:'fixture',mountPath:'/fixture',apiPrefix:'/api/fixture',handleRequest(){},gatewayStatus(){return {durableMessageQueue:{status:'ambiguous',storage:{available:false,error:'storage timeout'},degradedReasons:['durable queue storage read failed']}};}}]});
    try{const body=await(await fetch(`http://127.0.0.1:${port}/gateway/status`)).json();assert.equal(body.status,'degraded');assert.equal(body.durableMessageQueue.storage.available,false);assert.match(body.durableMessageQueue.storage.error,/storage timeout/);}finally{await channel.stop();}
  });
});


test('gateway doctor reports degraded run-job reliability without presenting it as active work', async () => {
  const port = await freePort();
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      status: 'ok',
      mode: 'dev',
      generation: 'test-generation',
      runtimeStatuses: [],
      activeRuns: [],
      reliability: { status: 'degraded', expiredOrphanRunJobs: 0, orphanRunDeadLetters: 2 },
      durableMessageQueue: { status: 'healthy', storage: { available: true } },
    }));
  });
  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/bin/pibo.js', 'gateway', 'dev', 'doctor'], {
        env: { ...process.env, PIBO_GATEWAY_DEV_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /active yielded runs: 0/);
    assert.match(result.stdout, /run-job reliability: degraded/);
    assert.match(result.stdout, /expired orphan jobs: 0/);
    assert.match(result.stdout, /orphan DLQ records: 2/);
    assert.doesNotMatch(result.stdout, /restart safety: blocked/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});



describe('gateway durable queue doctor',()=>{
 it('exits nonzero for a durable FIFO inconsistency while runtime health is good',async()=>{
  const port=await freePort(),dir=mkdtempSync(join(tmpdir(),'pibo-gateway-durable-doctor-')),script=join(dir,'server.mjs');
  writeFileSync(script,`import {createServer} from 'node:http';createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'degraded',mode:'prod',generation:'test',runtimeStatuses:[],activeRuns:[],durableMessageQueue:{status:'degraded',storage:{available:true},counts:[{state:'accepted',delivery:'queue',count:1,bytes:1}],interruptedPredecessors:1,blockedSuccessors:1,expiredOwnedLeases:0,oldestDispatchableWaitMs:0,oldestBlockedWaitMs:1000,affectedScopes:[{sessionId:'ps_scope',roomId:'room_scope',blockingCommandId:'cmd_block',blockedSince:1,blockedSuccessors:1}],degradedReasons:['interrupted predecessor']}}));}).listen(${port},'127.0.0.1');`);
  const server=spawn(process.execPath,[script],{stdio:'ignore'});try{await waitUntilReachable(port);const result=spawnSync(process.execPath,['dist/bin/pibo.js','gateway','web','doctor','--json'],{encoding:'utf8',env:{...process.env,PIBO_GATEWAY_WEB_PORT:String(port)}});assert.notEqual(result.status,0);const body=JSON.parse(result.stdout);assert.equal(body.runtimeStatuses.length,0);assert.equal(body.durableMessageQueue.status,'degraded');assert.deepEqual(body.nextCommands,['pibo gateway web doctor','pibo debug message-queue']);}finally{server.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
 });
});

describe('gateway start command', () => {
  it('uses the custom web service identity persisted by user-host setup', async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'pibo-gateway-service-name-'));
    const markerPath = join(dir, 'manager-argv');
    const managerPath = join(dir, 'manager.mjs');
    const scriptPath = join(dir, process.platform === 'win32' ? 'manager.cmd' : 'manager.sh');
    writeFileSync(join(dir, 'gateway-web-service'), 'pibo-web-custom\n', 'utf8');
    writeFileSync(managerPath, `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.FAKE_GATEWAY_MANAGER_MARKER, process.argv.slice(2).join(' '));
process.exitCode = 42;
`, 'utf8');
    if (process.platform === 'win32') {
      writeFileSync(scriptPath, `@echo off\r\n"${process.execPath}" "${managerPath}" %*\r\n`, 'utf8');
    } else {
      writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n"${process.execPath}" "${managerPath}" "$@"\n`, 'utf8');
      chmodSync(scriptPath, 0o755);
    }

    try {
      const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', 'web', 'start'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PIBO_HOME: dir,
          PIBO_GATEWAY_WEB_PORT: String(port),
          PIBO_GATEWAY_MANAGER_COMMAND: scriptPath,
          FAKE_GATEWAY_MANAGER_MARKER: markerPath,
        },
      });
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(markerPath, 'utf8'), 'start pibo-web-custom');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts a dev gateway that is not reachable yet', async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'pibo-gateway-start-'));
    const pidPath = join(dir, 'gateway.pid');
    const serverPath = join(dir, 'fake-gateway.mjs');
    const managerPath = join(dir, 'manager.mjs');
    const scriptPath = join(dir, process.platform === 'win32' ? 'manager.cmd' : 'manager.sh');
    writeFileSync(serverPath, `
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
const port = Number(process.env.FAKE_GATEWAY_PORT);
const server = createServer((req, res) => {
  if (req.url === '/gateway/status') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', mode: 'dev', runtimeStatuses: [], activeRuns: [] }));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
server.listen(port, '127.0.0.1', () => writeFileSync(process.env.FAKE_GATEWAY_PID, String(process.pid)));
`, 'utf8');
    writeFileSync(managerPath, `
import { spawn } from 'node:child_process';
if (process.argv[2] !== 'start') process.exit(42);
const child = spawn(process.execPath, [${JSON.stringify(serverPath)}], { detached: true, stdio: 'ignore', env: process.env });
child.unref();
`, 'utf8');
    if (process.platform === 'win32') {
      writeFileSync(scriptPath, `@echo off\r\n"${process.execPath}" "${managerPath}" %1\r\n`, 'utf8');
    } else {
      writeFileSync(scriptPath, `#!/usr/bin/env bash\nset -euo pipefail\n"${process.execPath}" "${managerPath}" "$1"\n`, 'utf8');
      chmodSync(scriptPath, 0o755);
    }
    const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', 'dev', 'start'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PIBO_GATEWAY_DEV_HOME: join(dir, 'pibo-home'),
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks start when a legacy port-specific PID file has a live gateway owner', async () => {
    const port = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'pibo-gateway-owner-'));
    writeFileSync(join(dir, 'gateway-3701.pid'), String(process.pid), 'utf8');
    try {
      const result = spawnSync(process.execPath, ['dist/bin/pibo.js', 'gateway', 'dev', 'start'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PIBO_GATEWAY_DEV_HOME: dir,
          PIBO_GATEWAY_DEV_PORT: String(port),
          PIBO_GATEWAY_MANAGER_COMMAND: join(dir, 'manager-must-not-run'),
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /already owned by gateway PID/);
      assert.match(result.stderr, /instead of starting a second gateway with the same PIBO_HOME/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
