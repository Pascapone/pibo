import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");
const {
	getConfigHash,
	getDaemonClaimPath,
	getDaemonLeasePrefix,
	getPidPath,
	getSocketDir,
	getSocketPath,
	usesFilesystemSocket,
} = await import("../dist/mcp/config.js");
const { getDaemonSpawnArguments, getDaemonSpawnOptions } =
	await import("../dist/mcp/daemon-client.js");
const {
	isProcessRunning,
	readPidFile,
	removePidFile,
	removeSocketFile,
	writeOwnershipFileExclusive,
} = await import("../dist/mcp/daemon.js");

const statefulFixtureServerSource = String.raw`
import { appendFileSync } from "node:fs";

if (process.env.FIXTURE_START_LOG) {
  appendFileSync(process.env.FIXTURE_START_LOG, process.pid + "\n");
}

const tools = [
  {
    name: "process_id",
    description: "Return the fixture process id.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "take_snapshot",
    description: "Create state that a later call must reuse.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description: "Use a uid from the current snapshot.",
    inputSchema: {
      type: "object",
      properties: { uid: { type: "string" } },
      required: ["uid"],
    },
  },
];

let snapshotUid;
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newlineIndex = buffer.indexOf("\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (line) handleMessage(JSON.parse(line));
  }
});

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handleMessage(message) {
  if (message.id === undefined) return;

  if (message.method === "initialize") {
    const delayMs = Number(process.env.FIXTURE_INIT_DELAY_MS ?? 0);
    setTimeout(() => {
      result(message.id, {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "stateful-fixture", version: "1.0.0" },
      });
    }, delayMs);
    return;
  }

  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }

  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params ?? {};
    if (name === "process_id") {
      result(message.id, {
        content: [{ type: "text", text: String(process.pid) }],
      });
      return;
    }
    if (name === "take_snapshot") {
      snapshotUid = "uid-" + process.pid + "-1";
      result(message.id, {
        content: [{ type: "text", text: snapshotUid }],
      });
      return;
    }
    if (name === "click") {
      if (!snapshotUid || args.uid !== snapshotUid) {
        error(message.id, -32602, "No matching snapshot found");
        return;
      }
      result(message.id, {
        content: [{ type: "text", text: "clicked:" + args.uid }],
      });
      return;
    }
  }

  error(message.id, -32601, "method not found: " + message.method);
}
`;

async function waitFor(predicate, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return true;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	return false;
}

async function callMcp(cwd, env, serverName, toolName, args = {}) {
	const result = await execFileAsync(
		process.execPath,
		[cliPath, "mcp", "call", serverName, toolName, JSON.stringify(args)],
		{ cwd, env },
	);
	return result.stdout.trim();
}

let synchronizedCallSequence = 0;

async function runSynchronizedMcpCalls(cwd, env, calls) {
	const sequence = synchronizedCallSequence++;
	const launcherPath = join(cwd, `barrier-launcher-${sequence}.mjs`);
	const readyPath = join(cwd, `barrier-ready-${sequence}.log`);
	const gatePath = join(cwd, `barrier-gate-${sequence}`);
	await writeFile(
		launcherPath,
		String.raw`
import { execFile } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

appendFileSync(process.env.PIBO_TEST_READY_PATH, process.pid + "\n");
while (!existsSync(process.env.PIBO_TEST_GATE_PATH)) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 5));
}
const args = JSON.parse(process.env.PIBO_TEST_CALL_ARGS);
const child = execFile(process.execPath, args, {
  cwd: process.env.PIBO_TEST_CALL_CWD,
  env: JSON.parse(process.env.PIBO_TEST_CALL_ENV),
}, (error, stdout, stderr) => {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = error?.code ?? (error ? 1 : 0);
});
child.stdin?.end();
`,
	);

	const launches = calls.map((call) =>
		execFileAsync(process.execPath, [launcherPath], {
			cwd,
			env: {
				...process.env,
				PIBO_TEST_READY_PATH: readyPath,
				PIBO_TEST_GATE_PATH: gatePath,
				PIBO_TEST_CALL_CWD: cwd,
				PIBO_TEST_CALL_ENV: JSON.stringify(env),
				PIBO_TEST_CALL_ARGS: JSON.stringify([
					cliPath,
					"mcp",
					"call",
					call.serverName,
					call.toolName ?? "process_id",
					JSON.stringify(call.args ?? {}),
				]),
			},
		}),
	);

	assert.equal(
		await waitFor(async () => {
			try {
				return (
					(await readFile(readyPath, "utf8")).trim().split("\n").length ===
					calls.length
				);
			} catch {
				return false;
			}
		}, 5000),
		true,
		"all independent launchers should reach the barrier",
	);
	await writeFile(gatePath, "go");
	return Promise.all(launches);
}

async function readStartedPids(path) {
	try {
		return (await readFile(path, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map(Number);
	} catch {
		return [];
	}
}

async function terminatePid(pid) {
	if (!Number.isInteger(pid) || pid <= 0 || !isProcessRunning(pid)) return;
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	await waitFor(() => !isProcessRunning(pid), 3000);
}

async function cleanDaemonState(serverName, fixturePids = []) {
	const daemon = readPidFile(serverName);
	if (daemon) await terminatePid(daemon.pid);
	for (const pid of fixturePids) await terminatePid(pid);
	removeSocketFile(serverName);
	removePidFile(serverName);
	try {
		await rm(getDaemonClaimPath(serverName), { force: true });
		const directory = dirname(getDaemonLeasePrefix(serverName));
		const prefix = basename(getDaemonLeasePrefix(serverName));
		for (const file of await readdir(directory)) {
			if (file.startsWith(prefix))
				await rm(join(directory, file), { force: true });
		}
	} catch {
		// State may already be clean.
	}
}

test("MCP daemon constructs deterministic per-user Windows named pipes", () => {
	const firstPipe = getSocketPath("chrome-devtools", "win32");
	const repeatedPipe = getSocketPath("chrome-devtools", "win32");
	const secondPipe = getSocketPath("unity", "win32");
	assert.match(firstPipe, /^\\\\\.\\pipe\\pibo-mcp-[a-f0-9]{12}-[a-f0-9]{16}$/);
	assert.equal(repeatedPipe, firstPipe);
	assert.notEqual(firstPipe, secondPipe);
	assert.equal(usesFilesystemSocket("win32"), false);
	assert.equal(usesFilesystemSocket("darwin"), true);
	assert.equal(usesFilesystemSocket("linux"), true);
	assert.equal(usesFilesystemSocket("aix"), true);
	assert.equal(firstPipe.startsWith(getSocketDir("win32")), false);
});

test("MCP daemon uses bounded collision-resistant endpoint metadata names", () => {
	const pidPath = getPidPath("../chrome/devtools", "win32");
	assert.equal(dirname(pidPath), getSocketDir("win32"));
	assert.match(basename(pidPath), /^[a-f0-9]{16}\.pid$/);
	assert.notEqual(
		getPidPath("CON", "win32").toLowerCase(),
		getPidPath("con", "win32").toLowerCase(),
	);

	const posixSocket = getSocketPath("../chrome/devtools", "linux");
	assert.equal(dirname(posixSocket), getSocketDir("linux"));
	assert.match(basename(posixSocket), /^[a-f0-9]{16}\.sock$/);
	assert.equal(getSocketPath("../chrome/devtools", "linux"), posixSocket);
	assert.ok(getSocketPath("雪".repeat(1000), "linux").length < 100);
	assert.notEqual(
		getSocketPath("\ud800", "win32"),
		getSocketPath("�", "win32"),
	);

	const endpoints = new Set();
	for (let index = 0; index < 10_000; index += 1) {
		endpoints.add(getSocketPath(`collision-probe-${index}`, "win32"));
	}
	assert.equal(endpoints.size, 10_000);
	assert.match(
		basename(getDaemonClaimPath("../chrome/devtools", "win32")),
		/^[a-f0-9]{16}\.lock$/,
	);
	assert.match(
		basename(getDaemonLeasePrefix("../chrome/devtools", "win32")),
		/^[a-f0-9]{16}\.lease-$/,
	);
});

test("detached daemon spawn hides Windows consoles and preserves argv boundaries", () => {
	const options = getDaemonSpawnOptions();
	assert.equal(options.detached, true);
	assert.equal(options.stdio, "ignore");
	assert.equal(options.windowsHide, true);
	assert.notEqual(options.env, process.env);
	assert.equal(options.env.PATH, process.env.PATH);

	const serverName = 'quote" slash\\ space 雪';
	const config = {
		command: "C:\\Program Files\\node.exe",
		args: ['--value="quoted"', "space value", "trailing\\"],
		env: { TOKEN: 'quote"\\雪' },
	};
	const args = getDaemonSpawnArguments(
		"C:\\Program Files\\pibo\\daemon.js",
		serverName,
		config,
		"generation-value",
	);
	assert.deepEqual(args.slice(-5), [
		"C:\\Program Files\\pibo\\daemon.js",
		"--daemon",
		serverName,
		JSON.stringify(config),
		"generation-value",
	]);
	assert.deepEqual(JSON.parse(args.at(-2)), config);
});

test("MCP daemon Windows IPC abstraction handles escaping, errors, and cleanup", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-win32-sim-"));
	const configModuleUrl = pathToFileURL(resolve("dist/mcp/config.js")).href;
	const daemonModuleUrl = pathToFileURL(resolve("dist/mcp/daemon.js")).href;
	const simulationServerName = '..\\\\CON/quote"/space /unicode-雪';
	const simulation = String.raw`
import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";

Object.defineProperty(process, "platform", {
  configurable: true,
  value: "win32",
});

const {
  getPidPath,
  getSocketDir,
  getSocketPath,
  usesFilesystemSocket,
} = await import(${JSON.stringify(configModuleUrl)});
const {
  readPidFile,
  removePidFile,
  removeSocketFile,
  writePidFile,
} = await import(${JSON.stringify(daemonModuleUrl)});

const serverName = ${JSON.stringify(simulationServerName)};
const endpoint = getSocketPath(serverName);
assert.match(endpoint, /^\\\\\.\\pipe\\pibo-mcp-[a-f0-9]{12}-[a-f0-9]{16}$/);
assert.equal(usesFilesystemSocket(), false);
assert.equal(endpoint.startsWith(getSocketDir()), false);
assert.match(getPidPath(serverName), /[\\/][a-f0-9]{16}\.pid$/);

const connectError = await new Promise((resolveError) => {
  const socket = createConnection(endpoint);
  socket.once("connect", () => resolveError(null));
  socket.once("error", resolveError);
});
assert.ok(connectError instanceof Error);

const server = createServer((socket) => {
  socket.once("data", (data) => socket.end("reply:" + data.toString()));
});
await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(endpoint, resolveListen);
});
const reply = await new Promise((resolveReply, rejectReply) => {
  const socket = createConnection(endpoint, () => socket.write("ping"));
  let text = "";
  socket.on("data", (data) => { text += data.toString(); });
  socket.once("end", () => resolveReply(text));
  socket.once("error", rejectReply);
});
assert.equal(reply, "reply:ping");
await new Promise((resolveClose, rejectClose) => {
  server.close((error) => error ? rejectClose(error) : resolveClose());
});

writePidFile(serverName, "config-hash", "generation-hash");
assert.equal(readPidFile(serverName)?.serverName, serverName);
assert.equal(readPidFile(serverName)?.generation, "generation-hash");
assert.equal((await stat(getPidPath(serverName))).mode & 0o777, 0o600);
removePidFile(serverName);
assert.equal(readPidFile(serverName), null);

await rm(endpoint, { force: true });
await writeFile(endpoint, "filesystem sentinel");
removeSocketFile(serverName);
assert.equal(await readFile(endpoint, "utf8"), "filesystem sentinel");
await rm(endpoint, { force: true });

process.stdout.write("win32-ipc-simulation-ok");
`;

	try {
		const result = await execFileAsync(
			process.execPath,
			["--input-type=module", "--eval", simulation],
			{ cwd },
		);
		assert.equal(result.stdout, "win32-ipc-simulation-ok");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("MCP daemon config hashes include nested values independent of key order", () => {
	const first = {
		command: "node",
		args: ["server.mjs"],
		env: { B: "two", A: "one" },
		pibo: { descriptionSource: "user", description: "Fixture" },
	};
	const reordered = {
		pibo: { description: "Fixture", descriptionSource: "user" },
		env: { A: "one", B: "two" },
		args: ["server.mjs"],
		command: "node",
	};
	const changedNestedValue = {
		...reordered,
		env: { A: "changed", B: "two" },
	};

	assert.equal(getConfigHash(first), getConfigHash(reordered));
	assert.notEqual(getConfigHash(first), getConfigHash(changedNestedValue));
});

test("simultaneous first calls across processes elect one daemon in repeated rounds", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-election-race-"));
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const allFixturePids = new Set();

	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		for (let round = 0; round < 10; round += 1) {
			const serverName = `election-${process.pid}-${Date.now()}-${round}`;
			const configPath = join(cwd, `mcp-${round}.json`);
			const startLogPath = join(cwd, `starts-${round}.log`);
			await writeFile(
				configPath,
				JSON.stringify({
					mcpServers: {
						[serverName]: {
							command: process.execPath,
							args: [serverPath],
							env: {
								FIXTURE_START_LOG: startLogPath,
								FIXTURE_INIT_DELAY_MS: "150",
							},
						},
					},
				}),
			);
			const env = {
				...process.env,
				MCP_CONFIG_PATH: configPath,
				MCP_DAEMON_REQUEST_TIMEOUT: "10",
				MCP_DAEMON_TIMEOUT: "30",
				MCP_TIMEOUT: "10",
				NO_COLOR: "1",
			};
			delete env.MCP_NO_DAEMON;
			const results = await runSynchronizedMcpCalls(
				cwd,
				env,
				Array.from({ length: 8 }, () => ({ serverName })),
			);
			const returnedPids = results.map(({ stdout }) => Number(stdout.trim()));
			assert.equal(
				new Set(returnedPids).size,
				1,
				`round ${round} should converge`,
			);
			const startedPids = await readStartedPids(startLogPath);
			startedPids.forEach((pid) => allFixturePids.add(pid));
			assert.deepEqual(
				startedPids,
				[returnedPids[0]],
				`round ${round} should spawn once`,
			);
			assert.ok(readPidFile(serverName)?.generation);
			assert.equal(existsSync(getDaemonClaimPath(serverName)), false);
			await cleanDaemonState(serverName, startedPids);
		}
	} finally {
		for (const pid of allFixturePids) await terminatePid(pid);
		await rm(cwd, { recursive: true, force: true });
	}
});

test("a crashed startup winner is adopted without duplicate MCP spawn", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-winner-crash-"));
	const serverName = `winner-crash-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const configPath = join(cwd, "mcp_servers.json");
	const startLogPath = join(cwd, "starts.log");
	let winner;
	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		await writeFile(
			configPath,
			JSON.stringify({
				mcpServers: {
					[serverName]: {
						command: process.execPath,
						args: [serverPath],
						env: {
							FIXTURE_START_LOG: startLogPath,
							FIXTURE_INIT_DELAY_MS: "1200",
						},
					},
				},
			}),
		);
		const env = {
			...process.env,
			MCP_CONFIG_PATH: configPath,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "30",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete env.MCP_NO_DAEMON;
		winner = spawn(
			process.execPath,
			[cliPath, "mcp", "call", serverName, "process_id", "{}"],
			{ cwd, env, stdio: "ignore" },
		);
		assert.equal(
			await waitFor(
				async () => (await readStartedPids(startLogPath)).length === 1,
			),
			true,
			"winner should spawn the MCP process before it crashes",
		);
		assert.equal(existsSync(getDaemonClaimPath(serverName)), true);
		winner.kill("SIGKILL");
		await new Promise((resolveExit) => winner.once("exit", resolveExit));

		const results = await runSynchronizedMcpCalls(
			cwd,
			env,
			Array.from({ length: 6 }, () => ({ serverName })),
		);
		const fixturePids = await readStartedPids(startLogPath);
		assert.equal(fixturePids.length, 1);
		assert.deepEqual(
			new Set(results.map(({ stdout }) => Number(stdout.trim()))),
			new Set(fixturePids),
		);
	} finally {
		if (winner && winner.exitCode === null) winner.kill("SIGKILL");
		await cleanDaemonState(serverName, await readStartedPids(startLogPath));
		await rm(cwd, { recursive: true, force: true });
	}
});

test("a crashed election loser cannot disturb the winner", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-loser-crash-"));
	const serverName = `loser-crash-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const configPath = join(cwd, "mcp_servers.json");
	const startLogPath = join(cwd, "starts.log");
	let winner;
	let loser;
	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		await writeFile(
			configPath,
			JSON.stringify({
				mcpServers: {
					[serverName]: {
						command: process.execPath,
						args: [serverPath],
						env: {
							FIXTURE_START_LOG: startLogPath,
							FIXTURE_INIT_DELAY_MS: "900",
						},
					},
				},
			}),
		);
		const env = {
			...process.env,
			MCP_CONFIG_PATH: configPath,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "30",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete env.MCP_NO_DAEMON;
		const args = [cliPath, "mcp", "call", serverName, "process_id", "{}"];
		winner = spawn(process.execPath, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		assert.equal(
			await waitFor(() => existsSync(getDaemonClaimPath(serverName))),
			true,
		);
		loser = spawn(process.execPath, args, { cwd, env, stdio: "ignore" });
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		loser.kill("SIGKILL");
		const winnerOutput = await new Promise((resolveOutput, rejectOutput) => {
			let stdout = "";
			let stderr = "";
			winner.stdout.on("data", (data) => {
				stdout += data;
			});
			winner.stderr.on("data", (data) => {
				stderr += data;
			});
			winner.once("error", rejectOutput);
			winner.once("exit", (code) =>
				code === 0
					? resolveOutput(stdout.trim())
					: rejectOutput(new Error(stderr)),
			);
		});
		const repeatedOutput = await callMcp(cwd, env, serverName, "process_id");
		assert.equal(repeatedOutput, winnerOutput);
		assert.deepEqual(await readStartedPids(startLogPath), [
			Number(winnerOutput),
		]);
	} finally {
		if (winner && winner.exitCode === null) winner.kill("SIGKILL");
		if (loser && loser.exitCode === null) loser.kill("SIGKILL");
		await cleanDaemonState(serverName, await readStartedPids(startLogPath));
		await rm(cwd, { recursive: true, force: true });
	}
});

test("dead stale ownership and PID metadata recover under concurrent callers", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-stale-owner-"));
	const serverName = `stale-owner-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const configPath = join(cwd, "mcp_servers.json");
	const startLogPath = join(cwd, "starts.log");
	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		const serverConfig = {
			command: process.execPath,
			args: [serverPath],
			env: { FIXTURE_START_LOG: startLogPath },
		};
		await writeFile(
			configPath,
			JSON.stringify({ mcpServers: { [serverName]: serverConfig } }),
		);
		assert.equal(
			writeOwnershipFileExclusive(getDaemonClaimPath(serverName), {
				ownerPid: 2_000_000_000,
				generation: "stale-generation",
				configHash: getConfigHash(serverConfig),
				startedAt: "2000-01-01T00:00:00.000Z",
				serverName,
			}),
			true,
		);
		await writeFile(
			getPidPath(serverName),
			JSON.stringify({
				pid: 2_000_000_000,
				configHash: getConfigHash(serverConfig),
				generation: "dead-daemon-generation",
				startedAt: "2000-01-01T00:00:00.000Z",
				serverName,
			}),
		);
		await new Promise((resolveWait) => setTimeout(resolveWait, 150));
		const env = {
			...process.env,
			MCP_CONFIG_PATH: configPath,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "30",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete env.MCP_NO_DAEMON;
		const results = await runSynchronizedMcpCalls(
			cwd,
			env,
			Array.from({ length: 6 }, () => ({ serverName })),
		);
		const fixturePids = await readStartedPids(startLogPath);
		assert.equal(fixturePids.length, 1);
		assert.deepEqual(
			new Set(results.map(({ stdout }) => Number(stdout.trim()))),
			new Set(fixturePids),
		);
		assert.notEqual(
			readPidFile(serverName)?.generation,
			"dead-daemon-generation",
		);
		assert.equal(existsSync(getDaemonClaimPath(serverName)), false);
	} finally {
		await cleanDaemonState(serverName, await readStartedPids(startLogPath));
		await rm(cwd, { recursive: true, force: true });
	}
});

test("simultaneous config changes serialize active daemon generations", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-config-race-"));
	const serverName = `config-race-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const startLogPath = join(cwd, "starts.log");
	const configAPath = join(cwd, "config-a.json");
	const configBPath = join(cwd, "config-b.json");
	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		for (const [path, marker] of [
			[configAPath, "A"],
			[configBPath, "B"],
		]) {
			await writeFile(
				path,
				JSON.stringify({
					mcpServers: {
						[serverName]: {
							command: process.execPath,
							args: [serverPath],
							env: {
								FIXTURE_START_LOG: startLogPath,
								CONFIG_MARKER: marker,
							},
						},
					},
				}),
			);
		}
		const baseEnv = {
			...process.env,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "30",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete baseEnv.MCP_NO_DAEMON;
		const [first, second] = await Promise.all([
			callMcp(
				cwd,
				{ ...baseEnv, MCP_CONFIG_PATH: configAPath },
				serverName,
				"process_id",
			),
			callMcp(
				cwd,
				{ ...baseEnv, MCP_CONFIG_PATH: configBPath },
				serverName,
				"process_id",
			),
		]);
		assert.ok(Number.isInteger(Number(first)));
		assert.ok(Number.isInteger(Number(second)));
		assert.notEqual(first, second);
		assert.equal((await readStartedPids(startLogPath)).length, 2);
	} finally {
		await cleanDaemonState(serverName, await readStartedPids(startLogPath));
		await rm(cwd, { recursive: true, force: true });
	}
});

test("sequential MCP CLI calls reuse one daemon and preserve server state", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-mcp-daemon-state-"));
	const serverName = `stateful-${process.pid}-${Date.now()}`;
	const serverPath = join(cwd, "stateful-fixture.mjs");
	const configPath = join(cwd, "mcp_servers.json");
	const startLogPath = join(cwd, "starts.log");
	const observedServerPids = new Set();
	const writeFixtureConfig = (initDelayMs) =>
		writeFile(
			configPath,
			JSON.stringify({
				mcpServers: {
					[serverName]: {
						command: process.execPath,
						args: [serverPath],
						env: {
							FIXTURE_START_LOG: startLogPath,
							FIXTURE_INIT_DELAY_MS: initDelayMs,
						},
					},
				},
			}),
		);

	try {
		await writeFile(serverPath, statefulFixtureServerSource);
		await writeFixtureConfig("5500");

		const env = {
			...process.env,
			MCP_CONFIG_PATH: configPath,
			MCP_DAEMON_REQUEST_TIMEOUT: "10",
			MCP_DAEMON_TIMEOUT: "5",
			MCP_DEBUG: "1",
			MCP_TIMEOUT: "10",
			NO_COLOR: "1",
		};
		delete env.MCP_NO_DAEMON;

		const firstServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(firstServerPid);
		assert.ok(Number.isInteger(firstServerPid) && firstServerPid > 0);

		const firstDaemon = readPidFile(serverName);
		assert.ok(firstDaemon);
		assert.ok(isProcessRunning(firstDaemon.pid));

		const secondServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(secondServerPid);
		assert.equal(secondServerPid, firstServerPid);
		assert.equal(readPidFile(serverName)?.pid, firstDaemon.pid);

		const snapshotUid = await callMcp(cwd, env, serverName, "take_snapshot");
		assert.equal(snapshotUid, `uid-${firstServerPid}-1`);
		assert.equal(
			await callMcp(cwd, env, serverName, "click", { uid: snapshotUid }),
			`clicked:${snapshotUid}`,
		);

		const starts = (await readFile(startLogPath, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean);
		assert.deepEqual(starts, [String(firstServerPid)]);

		await writeFixtureConfig("0");
		const restartedServerPid = Number(
			await callMcp(cwd, env, serverName, "process_id"),
		);
		observedServerPids.add(restartedServerPid);
		assert.notEqual(restartedServerPid, firstServerPid);
		const restartedDaemon = readPidFile(serverName);
		assert.ok(restartedDaemon);
		assert.notEqual(restartedDaemon.pid, firstDaemon.pid);
		assert.equal(isProcessRunning(firstDaemon.pid), false);
		assert.equal(isProcessRunning(firstServerPid), false);
		assert.deepEqual(
			(await readFile(startLogPath, "utf8")).trim().split("\n").filter(Boolean),
			[String(firstServerPid), String(restartedServerPid)],
		);

		assert.equal(
			await waitFor(() => !isProcessRunning(restartedDaemon.pid)),
			true,
			"daemon should stop after its idle timeout",
		);
		assert.equal(
			await waitFor(() => !isProcessRunning(restartedServerPid)),
			true,
			"stdio MCP server should stop with the daemon",
		);
		assert.equal(
			await waitFor(() => readPidFile(serverName) === null),
			true,
			"daemon PID metadata should be removed after shutdown",
		);
	} finally {
		try {
			const startedPids = (await readFile(startLogPath, "utf8"))
				.trim()
				.split("\n")
				.map(Number)
				.filter((pid) => Number.isInteger(pid) && pid > 0);
			for (const pid of startedPids) observedServerPids.add(pid);
		} catch {
			// The fixture may have failed before starting.
		}

		const daemon = readPidFile(serverName);
		if (daemon && isProcessRunning(daemon.pid)) {
			try {
				process.kill(daemon.pid, "SIGTERM");
			} catch {
				// Already stopped.
			}
			await waitFor(() => !isProcessRunning(daemon.pid), 3000);
		}
		for (const pid of observedServerPids) {
			if (!isProcessRunning(pid)) continue;
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Already stopped.
			}
		}
		removeSocketFile(serverName);
		removePidFile(serverName);
		await rm(cwd, { recursive: true, force: true });
	}
});
