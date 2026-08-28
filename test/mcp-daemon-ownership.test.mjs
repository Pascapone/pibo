import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const configModuleUrl = pathToFileURL(resolve("dist/mcp/config.js")).href;
const daemonModuleUrl = pathToFileURL(resolve("dist/mcp/daemon.js")).href;
const clientModuleUrl = pathToFileURL(resolve("dist/mcp/daemon-client.js")).href;

async function runProbe(source, env = {}) {
	return execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
		env: { ...process.env, MCP_DAEMON_REQUEST_TIMEOUT: "1", ...env },
		maxBuffer: 4 * 1024 * 1024,
	});
}

test("stale PID metadata never signals an unrelated reused process", async () => {
	const probe = String.raw`
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const {
  getConfigHash,
  getDaemonClaimPath,
  getPidPath,
  getSocketPath,
} = await import(${JSON.stringify(configModuleUrl)});
const {
  readProcessIdentity,
  removePidFile,
  removeSocketFile,
} = await import(${JSON.stringify(daemonModuleUrl)});
const { getDaemonConnection } = await import(${JSON.stringify(clientModuleUrl)});

async function runCase(label, includeMismatchedIdentity) {
  const serverName = "pid-reuse-" + label + "-" + process.pid;
  const config = { command: "/definitely/not/started" };
  const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
  assert.ok(unrelated.pid);
  const unrelatedExit = new Promise((resolveExit) =>
    unrelated.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const actualIdentity = readProcessIdentity(unrelated.pid);
  assert.ok(actualIdentity);
  const processIdentity = includeMismatchedIdentity
    ? { ...actualIdentity, startToken: actualIdentity.startToken + "-stale" }
    : undefined;
  const pidPath = getPidPath(serverName);
  await mkdir(dirname(pidPath), { recursive: true, mode: 0o700 });
  await writeFile(pidPath, JSON.stringify({
    pid: unrelated.pid,
    configHash: getConfigHash(config),
    generation: "stale-daemon-generation",
    startedAt: "2000-01-01T00:00:00.000Z",
    serverName,
    processIdentity,
  }), { flag: "wx", mode: 0o600 });

  const connection = await getDaemonConnection(serverName, config);
  assert.equal(connection, null);
  process.kill(unrelated.pid, 0);
  unrelated.kill("SIGTERM");
  const exit = await unrelatedExit;
  assert.equal(exit.signal, "SIGTERM");

  removePidFile(serverName);
  removeSocketFile(serverName);
  await rm(getDaemonClaimPath(serverName), { force: true });
  await rm(getSocketPath(serverName), { force: true });
  return { label, survivedCleanup: true };
}

const result = [
  await runCase("unverifiable", false),
  await runCase("mismatched-creation", true),
];
process.stdout.write(JSON.stringify(result));
`;

	const { stdout } = await runProbe(probe);
	assert.deepEqual(JSON.parse(stdout), [
		{ label: "unverifiable", survivedCleanup: true },
		{ label: "mismatched-creation", survivedCleanup: true },
	]);
});

test("reused claim and lease owner PIDs recover without blocking a live process", async () => {
	const fixtureSource = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\\n")) {
    const index = buffer.indexOf("\\n");
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    const send = (result) => process.stdout.write(JSON.stringify({
      jsonrpc: "2.0", id: message.id, result,
    }) + "\\n");
    if (message.method === "initialize") {
      setTimeout(() => send({
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "ownership-reuse", version: "1" },
      }), Number(process.env.INIT_DELAY_MS ?? 0));
    } else if (message.method === "tools/list") {
      send({ tools: [] });
    } else {
      send({});
    }
  }
});
`;
	const probe = String.raw`
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const {
  getConfigHash,
  getDaemonClaimPath,
  getDaemonLeasePrefix,
  getPidPath,
  getSocketPath,
} = await import(${JSON.stringify(configModuleUrl)});
const {
  isProcessRunning,
  processIdentityMatches,
  readOwnershipFilePath,
  readPidFile,
  readProcessIdentity,
  removeOwnershipFile,
  removePidFile,
  removeSocketFile,
  writeOwnershipFileExclusive,
} = await import(${JSON.stringify(daemonModuleUrl)});
const {
  cleanupOrphanedDaemons,
  getDaemonConnection,
} = await import(${JSON.stringify(clientModuleUrl)});

const fixtureSource = ${JSON.stringify(fixtureSource)};

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return false;
}

async function closeDaemon(serverName, identity) {
  try {
    await new Promise((resolveClose) => {
      let settled = false;
      const socket = createConnection(getSocketPath(serverName), () => {
        socket.write(JSON.stringify({
          id: "cleanup",
          type: "close",
          generation: identity.generation,
        }) + "\\n");
      });
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolveClose();
      };
      const timeout = setTimeout(finish, 1000);
      let response = "";
      socket.on("data", (chunk) => {
        response += chunk.toString();
        if (response.includes("\\n")) {
          finish();
        }
      });
      socket.on("error", finish);
    });
  } catch {}
  await waitFor(() => !isProcessRunning(identity.pid), 1000);
  removePidFile(serverName, identity);
  removeSocketFile(serverName);
}

const cwd = await mkdtemp(join(tmpdir(), "pibo-ownership-pid-reuse-"));
const fixturePath = join(cwd, "fixture.mjs");
const serverName = "ownership-reused-pid-" + process.pid;
const claimPath = getDaemonClaimPath(serverName);
const leasePrefix = getDaemonLeasePrefix(serverName);
let unrelated;
let unrelatedExit;
let activeConnection;
let finalIdentity;

try {
  await writeFile(fixturePath, fixtureSource);
  unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
  assert.ok(unrelated.pid);
  unrelatedExit = new Promise((resolveExit) =>
    unrelated.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const unrelatedIdentity = readProcessIdentity(unrelated.pid);
  assert.ok(unrelatedIdentity);

  const configA = {
    command: process.execPath,
    args: [fixturePath],
    env: { MARKER: "A", INIT_DELAY_MS: "300" },
  };
  const staleClaim = {
    ownerPid: unrelated.pid,
    generation: "legacy-stale-claim",
    configHash: getConfigHash(configA),
    startedAt: "2000-01-01T00:00:00.000Z",
    serverName,
  };
  assert.equal(writeOwnershipFileExclusive(claimPath, staleClaim), true);

  const claimStarted = Date.now();
  const pendingConnection = getDaemonConnection(serverName, configA);
  assert.equal(await waitFor(() => {
    const current = readOwnershipFilePath(claimPath);
    return current !== null && current.generation !== staleClaim.generation;
  }, 1000), true);
  const liveClaim = readOwnershipFilePath(claimPath);
  assert.ok(liveClaim && !("daemonGeneration" in liveClaim));
  assert.equal(liveClaim.ownerPid, process.pid);
  assert.ok(liveClaim.ownerNonce);
  assert.equal(processIdentityMatches(
    readProcessIdentity(process.pid),
    liveClaim.ownerProcessIdentity,
  ), true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  await cleanupOrphanedDaemons();
  assert.equal(readOwnershipFilePath(claimPath)?.generation, liveClaim.generation);

  activeConnection = await pendingConnection;
  const claimElapsedMs = Date.now() - claimStarted;
  assert.ok(activeConnection);
  assert.ok(claimElapsedMs < 2000, "stale claim must not consume the request timeout");
  assert.equal(existsSync(claimPath), false);

  const leaseDirectory = dirname(leasePrefix);
  const leaseNamePrefix = basename(leasePrefix);
  const liveLeaseNames = (await readdir(leaseDirectory)).filter((name) =>
    name.startsWith(leaseNamePrefix),
  );
  assert.equal(liveLeaseNames.length, 1);
  const liveLeasePath = join(leaseDirectory, liveLeaseNames[0]);
  const liveLease = readOwnershipFilePath(liveLeasePath);
  assert.ok(liveLease && "daemonGeneration" in liveLease);
  assert.ok(liveLease.ownerNonce);
  assert.equal(processIdentityMatches(
    readProcessIdentity(process.pid),
    liveLease.ownerProcessIdentity,
  ), true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  await cleanupOrphanedDaemons();
  assert.equal(readOwnershipFilePath(liveLeasePath)?.generation, liveLease.generation);

  const firstIdentity = readPidFile(serverName);
  assert.ok(firstIdentity);
  await activeConnection.close();
  activeConnection = undefined;

  const mismatchedIdentity = {
    ...unrelatedIdentity,
    startToken: unrelatedIdentity.startToken + "-stale",
  };
  const staleLeases = [
    {
      ownerPid: unrelated.pid,
      generation: "legacy-stale-lease",
      daemonGeneration: firstIdentity.generation,
      configHash: firstIdentity.configHash,
      startedAt: "2000-01-01T00:00:00.000Z",
      serverName,
    },
    {
      ownerPid: unrelated.pid,
      ownerProcessIdentity: mismatchedIdentity,
      ownerNonce: "expired-stale-owner",
      generation: "identity-stale-lease",
      daemonGeneration: firstIdentity.generation,
      configHash: firstIdentity.configHash,
      startedAt: "2000-01-01T00:00:00.000Z",
      serverName,
    },
  ];
  for (const lease of staleLeases) {
    assert.equal(writeOwnershipFileExclusive(leasePrefix + lease.generation, lease), true);
  }

  const configB = {
    command: process.execPath,
    args: [fixturePath],
    env: { MARKER: "B", INIT_DELAY_MS: "0" },
  };
  const replacementStarted = Date.now();
  const replacement = await getDaemonConnection(serverName, configB);
  const replacementElapsedMs = Date.now() - replacementStarted;
  assert.ok(replacement);
  assert.ok(replacementElapsedMs < 2000, "stale leases must not consume the request timeout");
  finalIdentity = readPidFile(serverName);
  assert.ok(finalIdentity);
  assert.equal(finalIdentity.configHash, getConfigHash(configB));
  assert.notEqual(finalIdentity.generation, firstIdentity.generation);
  for (const lease of staleLeases) {
    assert.equal(existsSync(leasePrefix + lease.generation), false);
  }
  process.kill(unrelated.pid, 0);

  await replacement.close();
  await closeDaemon(serverName, finalIdentity);
  finalIdentity = undefined;
  unrelated.kill("SIGTERM");
  const unrelatedResult = await unrelatedExit;
  unrelated = undefined;
  assert.equal(unrelatedResult.signal, "SIGTERM");

  process.stdout.write(JSON.stringify({
    claimRecovered: true,
    claimElapsedMs,
    liveClaimPreserved: true,
    liveLeasePreserved: true,
    configReplacementRecovered: true,
    replacementElapsedMs,
    unrelatedProcessSurvived: true,
  }));
} finally {
  if (activeConnection) await activeConnection.close();
  if (finalIdentity) await closeDaemon(serverName, finalIdentity);
  if (unrelated?.pid && isProcessRunning(unrelated.pid)) {
    unrelated.kill("SIGTERM");
    await unrelatedExit;
  }
  try {
    for (const name of await readdir(dirname(leasePrefix))) {
      if (name.startsWith(basename(leasePrefix))) {
        const path = join(dirname(leasePrefix), name);
        const ownership = readOwnershipFilePath(path);
        if (ownership) removeOwnershipFile(path, ownership.generation);
      }
    }
  } catch {}
  const remaining = readPidFile(serverName);
  if (remaining) await closeDaemon(serverName, remaining);
  await rm(claimPath, { force: true });
  await rm(getPidPath(serverName), { force: true });
  await rm(cwd, { recursive: true, force: true });
}
`;

	const { stdout } = await runProbe(probe, {
		MCP_DAEMON_REQUEST_TIMEOUT: "5",
		MCP_DAEMON_TIMEOUT: "30",
	});
	const result = JSON.parse(stdout);
	assert.deepEqual(
		{
			claimRecovered: result.claimRecovered,
			liveClaimPreserved: result.liveClaimPreserved,
			liveLeasePreserved: result.liveLeasePreserved,
			configReplacementRecovered: result.configReplacementRecovered,
			unrelatedProcessSurvived: result.unrelatedProcessSurvived,
		},
		{
			claimRecovered: true,
			liveClaimPreserved: true,
			liveLeasePreserved: true,
			configReplacementRecovered: true,
			unrelatedProcessSurvived: true,
		},
	);
	assert.ok(result.claimElapsedMs < 2000);
	assert.ok(result.replacementElapsedMs < 2000);
});

test("PID and endpoint cleanup preserve a newer generation in every owner path", async () => {
	const probe = String.raw`
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";

const originalRenameSync = fs.renameSync;
const originalUnlinkSync = fs.unlinkSync;
const originalWriteFileSync = fs.writeFileSync;
let injection;
fs.renameSync = (oldPath, newPath) => {
  if (injection?.path === oldPath) {
    const current = injection;
    injection = undefined;
    current.replace();
  }
  return originalRenameSync(oldPath, newPath);
};
syncBuiltinESMExports();

const {
  getDaemonClaimPath,
  getPidPath,
  getSocketDir,
  getSocketPath,
} = await import(${JSON.stringify(configModuleUrl)});
const {
  readOwnershipFilePath,
  readPidFile,
  removeDaemonState,
  removeOwnershipFile,
  removePidFile,
  writeOwnershipFileExclusive,
} = await import(${JSON.stringify(daemonModuleUrl)});
const { cleanupOrphanedDaemons } = await import(${JSON.stringify(clientModuleUrl)});

async function removeServerFiles(serverName) {
  const directory = getSocketDir();
  const prefix = basename(getPidPath(serverName)).slice(0, -4);
  try {
    for (const file of await readdir(directory)) {
      if (file.startsWith(prefix)) await rm(directory + "/" + file, { force: true });
    }
  } catch {}
}

function pidRecord(serverName, generation, pid) {
  return {
    pid,
    configHash: generation + "-config",
    generation,
    startedAt: generation === "old" ? "2000-01-01T00:00:00.000Z" : "2030-01-01T00:00:00.000Z",
    serverName,
  };
}

async function exerciseOwnerPath(label) {
  const serverName = "owner-path-" + label + "-" + process.pid;
  const pidPath = getPidPath(serverName);
  const socketPath = getSocketPath(serverName);
  const claimPath = getDaemonClaimPath(serverName);
  const oldPid = pidRecord(serverName, "old", 2100000001);
  const newerPid = pidRecord(serverName, "new", 2100000002);
  await mkdir(dirname(pidPath), { recursive: true, mode: 0o700 });
  await writeFile(pidPath, JSON.stringify(oldPid), { flag: "wx", mode: 0o600 });
  await writeFile(socketPath, "old-socket", { flag: "wx", mode: 0o600 });
  const claim = {
    ownerPid: process.pid,
    generation: "claim-" + label,
    configHash: "old-config",
    startedAt: new Date().toISOString(),
    serverName,
  };
  assert.equal(writeOwnershipFileExclusive(claimPath, claim), true);
  injection = {
    path: pidPath,
    replace() {
      originalUnlinkSync(pidPath);
      originalWriteFileSync(pidPath, JSON.stringify(newerPid), { flag: "wx", mode: 0o600 });
      originalUnlinkSync(socketPath);
      originalWriteFileSync(socketPath, "new-socket", { flag: "wx", mode: 0o600 });
    },
  };
  const removed = removeDaemonState(serverName, oldPid, {
    path: claimPath,
    generation: claim.generation,
  });
  assert.equal(removed, false);
  assert.equal(readPidFile(serverName)?.generation, newerPid.generation);
  assert.equal(await readFile(socketPath, "utf8"), "new-socket");
  removeOwnershipFile(claimPath, claim.generation);
  await removeServerFiles(serverName);
  return label;
}

const ownerPaths = [];
for (const label of ["elected-recovery", "explicit-stop", "daemon-self-cleanup"]) {
  ownerPaths.push(await exerciseOwnerPath(label));
}

const opportunisticServer = "opportunistic-" + process.pid;
const opportunisticPidPath = getPidPath(opportunisticServer);
const opportunisticSocketPath = getSocketPath(opportunisticServer);
const oldOpportunisticPid = pidRecord(opportunisticServer, "old", 2100000001);
const newOpportunisticPid = pidRecord(opportunisticServer, "new", 2100000002);
await mkdir(dirname(opportunisticPidPath), { recursive: true, mode: 0o700 });
await writeFile(opportunisticPidPath, JSON.stringify(oldOpportunisticPid), { flag: "wx", mode: 0o600 });
await writeFile(opportunisticSocketPath, "old-socket", { flag: "wx", mode: 0o600 });
injection = {
  path: opportunisticPidPath,
  replace() {
    originalUnlinkSync(opportunisticPidPath);
    originalWriteFileSync(opportunisticPidPath, JSON.stringify(newOpportunisticPid), { flag: "wx", mode: 0o600 });
    originalUnlinkSync(opportunisticSocketPath);
    originalWriteFileSync(opportunisticSocketPath, "new-socket", { flag: "wx", mode: 0o600 });
  },
};
await cleanupOrphanedDaemons();
assert.equal(readPidFile(opportunisticServer)?.generation, "new");
assert.equal(await readFile(opportunisticSocketPath, "utf8"), "new-socket");
await removeServerFiles(opportunisticServer);

const pidRaceServer = "pid-only-race-" + process.pid;
const pidRacePath = getPidPath(pidRaceServer);
const oldPidRace = pidRecord(pidRaceServer, "old", 2100000001);
const newPidRace = pidRecord(pidRaceServer, "new", 2100000002);
await writeFile(pidRacePath, JSON.stringify(oldPidRace), { flag: "wx", mode: 0o600 });
injection = {
  path: pidRacePath,
  replace() {
    originalUnlinkSync(pidRacePath);
    originalWriteFileSync(pidRacePath, JSON.stringify(newPidRace), { flag: "wx", mode: 0o600 });
  },
};
assert.equal(removePidFile(pidRaceServer, oldPidRace), false);
assert.equal(readPidFile(pidRaceServer)?.generation, "new");
await removeServerFiles(pidRaceServer);

const malformedServer = "malformed-claim-" + process.pid;
const malformedPath = getDaemonClaimPath(malformedServer);
await writeFile(malformedPath, "{truncated", { flag: "wx", mode: 0o600 });
const old = new Date(Date.now() - 60_000);
fs.utimesSync(malformedPath, old, old);
await cleanupOrphanedDaemons();
assert.equal(fs.existsSync(malformedPath), false);

await writeFile(malformedPath, "{truncated", { flag: "wx", mode: 0o600 });
fs.utimesSync(malformedPath, old, old);
const newerClaim = {
  ownerPid: process.pid,
  generation: "newer-valid-claim",
  configHash: "new-config",
  startedAt: new Date().toISOString(),
  serverName: malformedServer,
};
injection = {
  path: malformedPath,
  replace() {
    originalUnlinkSync(malformedPath);
    originalWriteFileSync(malformedPath, JSON.stringify(newerClaim), { flag: "wx", mode: 0o600 });
  },
};
await cleanupOrphanedDaemons();
assert.equal(readOwnershipFilePath(malformedPath)?.generation, newerClaim.generation);
removeOwnershipFile(malformedPath, newerClaim.generation);
await removeServerFiles(malformedServer);

process.stdout.write(JSON.stringify({
  ownerPaths,
  opportunisticSurvived: true,
  pidOnlyReplacementSurvived: true,
  malformedRecovered: true,
  malformedReplacementSurvived: true,
}));
`;

	const { stdout } = await runProbe(probe);
	assert.deepEqual(JSON.parse(stdout), {
		ownerPaths: ["elected-recovery", "explicit-stop", "daemon-self-cleanup"],
		opportunisticSurvived: true,
		pidOnlyReplacementSurvived: true,
		malformedRecovered: true,
		malformedReplacementSurvived: true,
	});
});
