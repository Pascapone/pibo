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

async function runProbe(source) {
	return execFileAsync(process.execPath, ["--input-type=module", "--eval", source], {
		env: { ...process.env, MCP_DAEMON_REQUEST_TIMEOUT: "1" },
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
