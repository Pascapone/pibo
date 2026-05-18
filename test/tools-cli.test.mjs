import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { formatBrowserUseTargets, selectBestChatTarget } from "../dist/tools/browser-use-cdp.js";
import { createPiboXvfbServiceUnit, PIBO_XVFB_SERVICE_PATH, PIBO_XVFB_SERVICE_NAME } from "../dist/tools/linux-virtual-display.js";

const execFileAsync = promisify(execFile);
const cliPath = resolve("dist/bin/pibo.js");

function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForProcess(pid, alive) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (processIsAlive(pid) === alive) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	assert.equal(processIsAlive(pid), alive);
}

function spawnBrowserLikeProcess(commandName, userDataDir) {
	const script = "setInterval(() => {}, 1000)";
	const command = `exec -a ${shellQuote(commandName)} ${shellQuote(process.execPath)} -e ${shellQuote(script)} -- --user-data-dir=${shellQuote(userDataDir)}`;
	return spawn("bash", ["-lc", command], { stdio: "ignore" });
}

function terminateProcess(child) {
	if (!child.killed && processIsAlive(child.pid)) child.kill("SIGKILL");
}

function terminatePid(pid) {
	if (pid && processIsAlive(pid)) process.kill(pid, "SIGKILL");
}

async function waitForFile(path) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			return await readFile(path, "utf8");
		} catch {
			await new Promise((resolveWait) => setTimeout(resolveWait, 50));
		}
	}
	return await readFile(path, "utf8");
}

async function processIsRunningOrSleeping(pid) {
	try {
		const statText = await readFile(`/proc/${pid}/stat`, "utf8");
		const endCommand = statText.lastIndexOf(")");
		const state = statText.slice(endCommand + 2).split(" ")[0];
		return state !== "Z";
	} catch {
		return false;
	}
}

async function waitForProcessGoneOrZombie(pid) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (!(await processIsRunningOrSleeping(pid))) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	assert.equal(await processIsRunningOrSleeping(pid), false);
}

function spawnManagedBrowserProcessTree(commandName, userDataDir, leaderPidPath, childPidPath) {
	const childScript = "setInterval(() => {}, 1000)";
	const script = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: "ignore" });
writeFileSync(${JSON.stringify(leaderPidPath)}, String(process.pid));
writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
setInterval(() => {}, 1000);
`;
	return spawn(process.execPath, ["-e", script, "--", `--user-data-dir=${userDataDir}`], {
		argv0: commandName,
		detached: true,
		stdio: "ignore",
	});
}

async function withTargetListServer(targets, run) {
	const server = createServer((request, response) => {
		if (request.url === "/json/list") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(targets));
			return;
		}
		response.writeHead(404);
		response.end("not found");
	});
	await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise((resolveClose) => server.close(resolveClose));
	}
}

test("pibo tools lists curated CLI tools", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-list-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "list"], { cwd, env });

		assert.match(result.stdout, /browser-use/);
		assert.match(result.stdout, /available/);
		assert.match(result.stdout, /ralph\tinstalled\tPibo-native continuous agent job runner/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools exposes Ralph guides and helper discovery", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-ralph-guide-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };

		const show = await execFileAsync("node", [cliPath, "tools", "show", "ralph"], { cwd, env });
		assert.match(show.stdout, /kind: built-in/);
		assert.match(show.stdout, /pibo ralph templates/);
		assert.match(show.stdout, /pibo tools guide ralph ralph/);

		const helper = await execFileAsync("node", [cliPath, "tools", "ralph"], { cwd, env });
		assert.match(helper.stdout, /pibo tools ralph - Ralph job helpers/);
		assert.match(helper.stdout, /pibo ralph add --template <id>/);
		assert.match(helper.stdout, /pibo ralph runs --owner-scope <scope> --job <job-id> --json/);

		const guide = await execFileAsync("node", [cliPath, "tools", "guide", "ralph", "ralph"], { cwd, env });
		assert.match(guide.stdout, /# Ralph CLI Tool/);
		assert.match(guide.stdout, /pibo ralph templates --json/);
		assert.match(guide.stdout, /pibo ralph add/);
		assert.match(guide.stdout, /pibo ralph cancel/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools exposes browser-use guides outside the profile skill system", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-guide-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };

		const guides = await execFileAsync("node", [cliPath, "tools", "guides", "browser-use"], { cwd, env });
		assert.match(guides.stdout, /browser-use/);
		assert.match(guides.stdout, /remote-browser/);

		const guide = await execFileAsync("node", [cliPath, "tools", "guide", "browser-use", "browser-use"], { cwd, env });
		assert.match(guide.stdout, /# Browser Automation with browser-use CLI/);
		assert.match(guide.stdout, /browser-use state/);
		assert.match(guide.stdout, /pibo tools env browser-use/);
		assert.match(guide.stdout, /eval "\$\(pibo tools env browser-use\)"/);
		assert.match(guide.stdout, /npm run --silent dev -- tools env browser-use/);
		assert.match(guide.stdout, /once per persistent shell/);
		assert.match(guide.stdout, /reuse that shell/);
		assert.match(guide.stdout, /tools browser-use targets/);
		assert.match(guide.stdout, /tools browser-use attach-chat/);
		assert.match(guide.stdout, /pibo tools browser-use lease acquire/);
		assert.match(guide.stdout, /PIBO_BROWSER_USE_SESSION/);
		assert.match(guide.stdout, /timeout 30s/);
		assert.match(guide.stdout, /Do not issue parallel/);
		assert.match(guide.stdout, /get value <index>/);
		assert.match(guide.stdout, /get html --selector/);
		assert.doesNotMatch(guide.stdout, /browser-use tab /);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools install supports a no-setup dry target", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-install-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "install", "browser-use", "--no-setup"], { cwd, env });

		assert.match(result.stdout, /Install target browser-use/);
		assert.match(result.stdout, /pibo-home\/tools\/browser-use/);
		assert.match(result.stdout, /desktop: /);
		if (process.platform === "linux" && /desktop: not detected/.test(result.stdout)) {
			assert.match(result.stdout, /linux headed browser hint:/);
			assert.match(result.stdout, /Install a virtual X display if this host has no desktop session\./);
			assert.match(result.stdout, /Xvfb :0 -screen 0 1920x1080x24 -ac -nolisten tcp/);
		}
		assert.match(result.stdout, /env: pibo tools env browser-use/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo browser-use virtual display service unit uses a stable Linux xvfb setup", () => {
	const unit = createPiboXvfbServiceUnit();
	assert.match(unit, /\[Unit\]/);
	assert.match(unit, /Description=Virtual X display for Pibo browser automation/);
	assert.match(unit, /ExecStart=\/usr\/bin\/Xvfb :0 -screen 0 1920x1080x24 -ac -nolisten tcp/);
	assert.match(unit, /WantedBy=multi-user.target/);
	assert.equal(PIBO_XVFB_SERVICE_NAME, "pibo-xvfb.service");
	assert.equal(PIBO_XVFB_SERVICE_PATH, "/etc/systemd/system/pibo-xvfb.service");
});

test("pibo tools env wraps browser-use with the PIBo default profile", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-env-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "env", "browser-use"], { cwd, env });
		const wrapperPath = join(env.PIBO_HOME, "tools", "browser-use", "home", "bin", "browser-use");
		const realBinDir = join(env.PIBO_HOME, "tools", "browser-use", ".venv", "bin");

		assert.ok(result.stdout.includes(`export PATH="${wrapperPath.replace(/\/browser-use$/, "")}:${realBinDir}:$PATH"`));
		const wrapper = await readFile(wrapperPath, "utf8");
		const mode = (await stat(wrapperPath)).mode & 0o777;
		assert.match(wrapper, /--fresh-profile/);
		assert.match(wrapper, /PIBO_BROWSER_USE_DEFAULT_PROFILE/);
		assert.match(wrapper, /PIBO_BROWSER_USE_SESSION:-default/);
		assert.match(wrapper, /ensure_persistent_chrome/);
		assert.match(wrapper, /--cdp-url "\$cdp_url"/);
		assert.equal(mode & 0o111, 0o111);

		await mkdir(realBinDir, { recursive: true });
		const realExecutablePath = join(realBinDir, "browser-use");
		await writeFile(realExecutablePath, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
		await chmod(realExecutablePath, 0o755);
		const fakeChromePath = join(cwd, "google-chrome");
		const fakeChromeArgsPath = join(cwd, "chrome-args.txt");
		await writeFile(fakeChromePath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${fakeChromeArgsPath}"\n`);
		await chmod(fakeChromePath, 0o755);

		const browserUseHome = join(cwd, "browser-use-home");
		const chromeUserDataDir = join(cwd, "chrome-user-data");
		const unrelatedChromeUserDataDir = join(cwd, "unrelated-chrome-user-data");
		const authTemplateUserDataDir = join(cwd, "auth-template-user-data");
		await mkdir(chromeUserDataDir, { recursive: true });
		await mkdir(unrelatedChromeUserDataDir, { recursive: true });
		await mkdir(authTemplateUserDataDir, { recursive: true });

		const managedChromium = spawnBrowserLikeProcess("/usr/bin/chromium", chromeUserDataDir);
		const managedGoogleChrome = spawnBrowserLikeProcess("google-chrome", chromeUserDataDir);
		const unrelatedChromium = spawnBrowserLikeProcess("/usr/bin/chromium", unrelatedChromeUserDataDir);
		const authTemplateChromium = spawnBrowserLikeProcess("/usr/bin/chromium", authTemplateUserDataDir);
		try {
			await Promise.all([
				waitForProcess(managedChromium.pid, true),
				waitForProcess(managedGoogleChrome.pid, true),
				waitForProcess(unrelatedChromium.pid, true),
				waitForProcess(authTemplateChromium.pid, true),
			]);
			const staleCleanup = await execFileAsync(wrapperPath, ["--pibo-ensure-chrome"], {
				cwd,
				env: {
					...env,
					BROWSER_USE_HOME: join(cwd, "browser-use-home-stale-cleanup"),
					PIBO_BROWSER_POOL_WORKER_ID: "test-worker-stale-cleanup",
					PIBO_BROWSER_USE_CHROME: fakeChromePath,
					PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
					PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
				},
			});
			assert.match(staleCleanup.stderr, /terminating stale Chrome process/);
			assert.match(staleCleanup.stdout, /^http:\/\/127\.0\.0\.1:\d+/);
			await Promise.all([
				waitForProcess(managedChromium.pid, false),
				waitForProcess(managedGoogleChrome.pid, false),
			]);
			assert.equal(processIsAlive(unrelatedChromium.pid), true);
			assert.equal(processIsAlive(authTemplateChromium.pid), true);
		} finally {
			for (const child of [managedChromium, managedGoogleChrome, unrelatedChromium, authTemplateChromium]) terminateProcess(child);
		}

		const defaultProfile = await execFileAsync(wrapperPath, ["open", "https://example.test"], {
			cwd,
			env: {
				...env,
				BROWSER_USE_HOME: browserUseHome,
				PIBO_BROWSER_POOL_WORKER_ID: "test-worker",
				PIBO_BROWSER_POOL_LEASE_ID: "lease-default",
				PIBO_BROWSER_POOL_OWNER: "test-owner",
				PIBO_BROWSER_USE_CHROME: fakeChromePath,
				PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
			},
		});
		assert.match(defaultProfile.stderr, /started Chrome profile "PIBo"/);
		assert.match(defaultProfile.stdout, /--cdp-url\nhttp:\/\/127\.0\.0\.1:\d+\nopen\nhttps:\/\/example\.test/);
		const poolStatePath = join(browserUseHome, "pibo-browser-pool", "browser-pools", "test-worker", "default", "state.json");
		const poolState = JSON.parse(await readFile(poolStatePath, "utf8"));
		assert.equal(poolState.state, "leased");
		assert.equal(poolState.workerId, "test-worker");
		assert.equal(poolState.poolId, "default");
		assert.equal(poolState.maxBrowserProcesses, 1);
		assert.equal(poolState.activeLeaseId, "lease-default");
		assert.equal(poolState.owner, "test-owner");
		assert.match(poolState.cdpUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
		assert.equal(poolState.userDataDir, chromeUserDataDir);

		const busyServer = createServer((request, response) => {
			if (request.url === "/json/version") {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify({ Browser: "FakeChrome/1.0" }));
				return;
			}
			response.writeHead(404);
			response.end("not found");
		});
		await new Promise((resolveListen) => busyServer.listen(0, "127.0.0.1", resolveListen));
		try {
			const busyAddress = busyServer.address();
			assert.ok(busyAddress && typeof busyAddress === "object");
			await writeFile(poolStatePath, `${JSON.stringify({
				...poolState,
				pid: process.pid,
				cdpPort: busyAddress.port,
				cdpUrl: `http://127.0.0.1:${busyAddress.port}`,
				activeLeaseId: "other-lease",
				owner: "other-owner",
				idleExpiresAt: "2099-01-01T00:00:00.000Z",
			}, null, 2)}\n`, "utf8");
			await assert.rejects(
				execFileAsync(wrapperPath, ["--pibo-ensure-chrome"], {
					cwd,
					env: {
						...env,
						BROWSER_USE_HOME: browserUseHome,
						PIBO_BROWSER_POOL_WORKER_ID: "test-worker",
						PIBO_BROWSER_POOL_LEASE_ID: "blocked-lease",
						PIBO_BROWSER_USE_CHROME: fakeChromePath,
						PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
						PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
					},
				}),
				(error) => {
					assert.match(error.stderr, /pool-exhausted/);
					return true;
				},
			);
		} finally {
			await new Promise((resolveClose) => busyServer.close(resolveClose));
		}
		await writeFile(poolStatePath, `${JSON.stringify(poolState, null, 2)}\n`, "utf8");
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				await stat(fakeChromeArgsPath);
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		assert.match(await readFile(fakeChromeArgsPath, "utf8"), new RegExp(`--user-data-dir=${chromeUserDataDir}`));
		assert.match(await readFile(fakeChromeArgsPath, "utf8"), /--headless=new/);

		await rm(fakeChromeArgsPath, { force: true });
		const headedProfile = await execFileAsync(wrapperPath, ["--headed", "--session", "headed", "open", "https://example.test"], {
			cwd,
			env: {
				...env,
				BROWSER_USE_HOME: join(cwd, "browser-use-home-headed"),
				PIBO_BROWSER_USE_CHROME: fakeChromePath,
				PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				PIBO_BROWSER_USE_SKIP_CDP_WAIT: "1",
			},
		});
		assert.match(headedProfile.stdout, /--cdp-url\nhttp:\/\/127\.0\.0\.1:\d+\n--headed\n--session\nheaded\nopen\nhttps:\/\/example\.test/);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				await stat(fakeChromeArgsPath);
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		assert.doesNotMatch(await readFile(fakeChromeArgsPath, "utf8"), /--headless=new/);

		const freshProfile = await execFileAsync(wrapperPath, ["--fresh-profile", "open", "https://example.test"], {
			cwd,
			env: { ...env, BROWSER_USE_HOME: browserUseHome },
		});
		assert.doesNotMatch(freshProfile.stdout, /--cdp-url/);
		assert.match(freshProfile.stdout, /open\nhttps:\/\/example\.test/);

		const explicitProfile = await execFileAsync(wrapperPath, ["--profile", "Default", "open", "https://example.test"], {
			cwd,
			env: { ...env, BROWSER_USE_HOME: browserUseHome },
		});
		assert.doesNotMatch(explicitProfile.stderr, /starting new session/);
		assert.match(explicitProfile.stdout, /--profile\nDefault\nopen\nhttps:\/\/example\.test/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo browser-use wrapper terminates stale managed process trees and stale CDP files safely", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-env-tree-cleanup-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		await execFileAsync("node", [cliPath, "tools", "env", "browser-use"], { cwd, env });
		const wrapperPath = join(env.PIBO_HOME, "tools", "browser-use", "home", "bin", "browser-use");
		const browserUseHome = join(cwd, "browser-use-home");
		const chromeUserDataDir = join(cwd, "chrome-user-data");
		const statePath = join(browserUseHome, "pibo-browser-pool", "browser-pools", "tree-worker", "default", "state.json");
		const cdpDir = join(browserUseHome, "pibo-cdp");
		const pidFile = join(cdpDir, "tree.pid");
		const portFile = join(cdpDir, "tree.port");
		const fakeChromePath = join(cwd, "failing-chrome");
		await mkdir(dirname(statePath), { recursive: true });
		await mkdir(cdpDir, { recursive: true });
		await mkdir(chromeUserDataDir, { recursive: true });
		await writeFile(fakeChromePath, "#!/bin/sh\nexit 1\n");
		await chmod(fakeChromePath, 0o755);

		const leaderPidPath = join(cwd, "leader.pid");
		const childPidPath = join(cwd, "child.pid");
		const processTree = spawnManagedBrowserProcessTree("/usr/bin/chromium", chromeUserDataDir, leaderPidPath, childPidPath);
		let leaderPid;
		let childPid;
		try {
			leaderPid = Number.parseInt(await waitForFile(leaderPidPath), 10);
			childPid = Number.parseInt(await waitForFile(childPidPath), 10);
			await waitForProcess(leaderPid, true);
			await waitForProcess(childPid, true);
			await writeFile(statePath, `${JSON.stringify({
				workerId: "tree-worker",
				poolId: "default",
				maxBrowserProcesses: 1,
				pid: leaderPid,
				processGroupId: leaderPid,
				cdpPort: 47777,
				cdpUrl: "http://127.0.0.1:47777",
				userDataDir: chromeUserDataDir,
				state: "stale",
			}, null, 2)}\n`, "utf8");
			await writeFile(pidFile, `${leaderPid}\n`, "utf8");
			await writeFile(portFile, "47777\n", "utf8");

			await assert.rejects(
				execFileAsync(wrapperPath, ["--session", "tree", "--pibo-ensure-chrome"], {
					cwd,
					env: {
						...env,
						BROWSER_USE_HOME: browserUseHome,
						PIBO_BROWSER_POOL_WORKER_ID: "tree-worker",
						PIBO_BROWSER_USE_CHROME: fakeChromePath,
						PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
					},
				}),
				(error) => {
					assert.match(error.stderr, /terminating stale Chrome process group/);
					return true;
				},
			);
			await waitForProcessGoneOrZombie(leaderPid);
			await waitForProcessGoneOrZombie(childPid);
			await assert.rejects(readFile(pidFile, "utf8"), /ENOENT/);
			await assert.rejects(readFile(portFile, "utf8"), /ENOENT/);
		} finally {
			terminatePid(childPid);
			terminatePid(leaderPid);
			terminateProcess(processTree);
		}

		await writeFile(pidFile, "999999\n", "utf8");
		await writeFile(portFile, "47778\n", "utf8");
		await rm(statePath, { force: true });
		await assert.rejects(
			execFileAsync(wrapperPath, ["--session", "tree", "--pibo-ensure-chrome"], {
				cwd,
				env: {
					...env,
					BROWSER_USE_HOME: browserUseHome,
					PIBO_BROWSER_POOL_WORKER_ID: "tree-worker",
					PIBO_BROWSER_USE_CHROME: fakeChromePath,
					PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				},
			}),
		);
		await assert.rejects(readFile(pidFile, "utf8"), /ENOENT/);
		await assert.rejects(readFile(portFile, "utf8"), /ENOENT/);

		await assert.rejects(
			execFileAsync(wrapperPath, ["--session", "missing-pid", "--pibo-ensure-chrome"], {
				cwd,
				env: {
					...env,
					BROWSER_USE_HOME: browserUseHome,
					PIBO_BROWSER_POOL_WORKER_ID: "tree-worker",
					PIBO_BROWSER_USE_CHROME: fakeChromePath,
					PIBO_BROWSER_USE_CHROME_USER_DATA_DIR: chromeUserDataDir,
				},
			}),
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use pool status reports empty, ready, stale, text, and JSON read-only", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-pool-status-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home"), BROWSER_USE_HOME: join(cwd, "browser-use-home") };
		const statePath = join(env.BROWSER_USE_HOME, "pibo-browser-pool", "browser-pools", "worker-status", "default", "state.json");

		const empty = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "status", "--worker-id", "worker-status"], { cwd, env });
		assert.match(empty.stdout, /browser pool status: empty/);
		assert.match(empty.stdout, /worker id: worker-status/);
		assert.match(empty.stdout, /pool id: default/);
		assert.match(empty.stdout, /state file: .*state\.json \(missing\)/);
		await assert.rejects(readFile(statePath, "utf8"), /ENOENT/);

		await mkdir(dirname(statePath), { recursive: true });
		await writeFile(statePath, `${JSON.stringify({
			workerId: "worker-status",
			poolId: "default",
			maxBrowserProcesses: 1,
			pid: 1234,
			processGroupId: 1234,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(cwd, "profile"),
			lastUsedAt: "2026-05-17T00:00:00.000Z",
			idleExpiresAt: "2026-05-17T00:10:00.000Z",
			state: "ready",
		}, null, 2)}\n`, "utf8");

		const readyJson = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "status", "--worker-id", "worker-status", "--json"], { cwd, env });
		const ready = JSON.parse(readyJson.stdout);
		assert.equal(ready.state, "ready");
		assert.equal(ready.readOnly, true);
		assert.equal(ready.cdpUrl, "http://127.0.0.1:4831");
		assert.equal(ready.stateFileExists, true);
		assert.deepEqual(ready.nextCommands, ["pibo tools browser-use pool status --json"]);

		await writeFile(statePath, `${JSON.stringify({
			...ready,
			rootDir: undefined,
			statePath: undefined,
			lockPath: undefined,
			stateFileExists: undefined,
			readOnly: undefined,
			nextCommands: undefined,
			state: "stale",
			lastError: "Recorded browser pid 1234 is not alive",
		}, null, 2)}\n`, "utf8");

		const staleText = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "status", "--worker-id", "worker-status"], { cwd, env });
		assert.match(staleText.stdout, /browser pool status: stale/);
		assert.match(staleText.stdout, /stale\/dirty reason: Recorded browser pid 1234 is not alive/);
		assert.match(staleText.stdout, /Next:/);
		assert.match(staleText.stdout, /pibo tools browser-use pool status --json/);
		assert.match(staleText.stdout, /pibo tools browser-use health/);

		const staleJson = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "status", "--worker-id", "worker-status", "--json"], { cwd, env });
		const stale = JSON.parse(staleJson.stdout);
		assert.equal(stale.state, "stale");
		assert.equal(stale.staleReason, "Recorded browser pid 1234 is not alive");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use pool reap reports JSON counts and dirty next commands", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-pool-reap-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home"), BROWSER_USE_HOME: join(cwd, "browser-use-home") };
		const statePath = join(env.BROWSER_USE_HOME, "pibo-browser-pool", "browser-pools", "worker-reap", "default", "state.json");
		await mkdir(dirname(statePath), { recursive: true });
		await writeFile(statePath, `${JSON.stringify({
			workerId: "worker-reap",
			poolId: "default",
			maxBrowserProcesses: 1,
			pid: 987654321,
			processGroupId: 987654321,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			userDataDir: join(cwd, "profile"),
			lastUsedAt: "2026-05-17T00:00:00.000Z",
			state: "stale",
			lastError: "Recorded browser pid 987654321 is not alive",
		}, null, 2)}\n`, "utf8");

		const emptyWorker = "worker-empty-reap";
		const emptyStatePath = join(env.BROWSER_USE_HOME, "pibo-browser-pool", "browser-pools", emptyWorker, "default", "state.json");
		const emptyResult = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "reap", "--worker-id", emptyWorker, "--idle-timeout-ms", "0", "--json"], { cwd, env });
		const emptyParsed = JSON.parse(emptyResult.stdout);
		assert.equal(emptyParsed.counts.affectedBrowserPools, 0);
		assert.equal(emptyParsed.pools[0].cleanupStatus, "skipped");
		assert.equal(existsSync(emptyStatePath), false);

		const jsonResult = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "reap", "--worker-id", "worker-reap", "--json"], { cwd, env });
		const parsed = JSON.parse(jsonResult.stdout);
		assert.equal(parsed.counts.affectedBrowserPools, 1);
		assert.equal(parsed.counts.terminatedProcessTrees, 0);
		assert.equal(parsed.pools[0].reaped, true);
		assert.equal(parsed.pools[0].cleanupStatus, "success");
		assert.equal(parsed.pools[0].state.state, "empty");

		await writeFile(statePath, `${JSON.stringify({
			workerId: "worker-reap",
			poolId: "default",
			maxBrowserProcesses: 1,
			pid: process.pid,
			processGroupId: process.pid,
			cdpPort: 4831,
			cdpUrl: "http://127.0.0.1:4831",
			lastUsedAt: "2026-05-17T00:00:00.000Z",
			idleExpiresAt: "2026-05-17T00:05:00.000Z",
			state: "ready",
		}, null, 2)}\n`, "utf8");

		const dirty = await execFileAsync("node", [cliPath, "tools", "browser-use", "pool", "reap", "--worker-id", "worker-reap"], { cwd, env });
		assert.match(dirty.stdout, /browser pool reap: failed/);
		assert.match(dirty.stdout, /cleanup status: failed/);
		assert.match(dirty.stdout, /Refusing to terminate browser pid/);
		assert.match(dirty.stdout, /Next:/);
		assert.match(dirty.stdout, /pibo tools browser-use pool status --json/);
		assert.match(dirty.stdout, /pibo tools browser-use health/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use manages isolated authenticated leases", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-use-leases-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const templateDir = join(cwd, "auth-template");
		await mkdir(templateDir, { recursive: true });
		await writeFile(join(templateDir, "Cookies"), "auth-cookie");
		await writeFile(join(templateDir, "DevToolsActivePort"), "do-not-copy");

		const discovery = await execFileAsync("node", [cliPath, "tools", "browser-use"], { cwd, env });
		assert.match(discovery.stdout, /pibo tools browser-use - browser-use helpers/);
		assert.match(discovery.stdout, /eval "\$\(pibo tools env browser-use\)"/);
		assert.match(discovery.stdout, /pibo tools guide browser-use browser-use/);
		assert.match(discovery.stdout, /targets/);
		assert.match(discovery.stdout, /attach-chat/);
		assert.match(discovery.stdout, /lease acquire/);
		assert.match(discovery.stdout, /pool status/);

		const templateEnv = await execFileAsync("node", [cliPath, "tools", "browser-use", "auth-template", "env"], { cwd, env });
		assert.match(templateEnv.stdout, /PIBO_BROWSER_USE_SESSION='pibo-auth-template'/);
		assert.match(templateEnv.stdout, /PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=/);

		const acquired = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"acquire",
			"--app",
			"pibo-chat",
			"--owner",
			"agent-a",
			"--template-dir",
			templateDir,
			"--ttl-minutes",
			"30",
		], { cwd, env });
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_LEASE_ID='pibo-chat-slot-001'/);
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_SESSION='pibo-auth-pibo-chat-slot-001'/);
		assert.match(acquired.stdout, /PIBO_BROWSER_USE_CHROME_USER_DATA_DIR=/);

		const slotDirMatch = acquired.stdout.match(/PIBO_BROWSER_USE_CHROME_USER_DATA_DIR='([^']+)'/);
		assert.ok(slotDirMatch);
		const slotDir = slotDirMatch[1];
		assert.equal(await readFile(join(slotDir, "Cookies"), "utf8"), "auth-cookie");
		await assert.rejects(readFile(join(slotDir, "DevToolsActivePort"), "utf8"), /ENOENT/);

		const listed = await execFileAsync("node", [cliPath, "tools", "browser-use", "lease", "list"], { cwd, env });
		assert.match(listed.stdout, /pibo-chat-slot-001\tactive\tagent-a\tpibo-auth-pibo-chat-slot-001/);

		const released = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"release",
			"pibo-chat-slot-001",
			"--delete-profile",
		], { cwd, env });
		assert.match(released.stdout, /Released pibo-chat-slot-001/);
		await assert.rejects(readFile(join(slotDir, "Cookies"), "utf8"), /ENOENT/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use auth leases coordinate managed browser-pool leases", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-use-managed-leases-"));
	const children = [];
	try {
		const env = {
			...process.env,
			PIBO_HOME: join(cwd, "pibo-home"),
			PIBO_BROWSER_POOL_WORKER_ID: "auth-worker",
			PIBO_BROWSER_USE_CHROME: join(cwd, "missing-chrome"),
		};
		const templateDir = join(cwd, "auth-template");
		await mkdir(templateDir, { recursive: true });
		await writeFile(join(templateDir, "Cookies"), "auth-cookie");
		await writeFile(join(templateDir, "SingletonLock"), "template-lock");

		const acquireMissing = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"acquire",
			"--app",
			"pibo-chat",
			"--owner",
			"agent-missing",
			"--template-dir",
			join(cwd, "empty-template"),
			"--json",
		], { cwd, env });
		const missingLease = JSON.parse(acquireMissing.stdout);
		assert.equal(missingLease.browserPoolLeaseId, "browser-use:pibo-auth-pibo-chat-slot-001");
		assert.equal(missingLease.exports.PIBO_BROWSER_POOL_LEASE_ID, missingLease.browserPoolLeaseId);
		const missingRelease = await execFileAsync("node", [cliPath, "tools", "browser-use", "lease", "release", missingLease.id], { cwd, env });
		assert.match(missingRelease.stdout, /Released pibo-chat-slot-001/);

		const acquireRelease = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"acquire",
			"--app",
			"pibo-chat",
			"--owner",
			"agent-release",
			"--template-dir",
			join(cwd, "empty-template"),
			"--json",
		], { cwd, env });
		const releaseLease = JSON.parse(acquireRelease.stdout);
		const poolStatePath = join(releaseLease.browserPoolRootDir, "browser-pools", releaseLease.browserPoolWorkerId, releaseLease.browserPoolId, "state.json");
		await mkdir(dirname(poolStatePath), { recursive: true });
		await writeFile(poolStatePath, `${JSON.stringify({
			workerId: releaseLease.browserPoolWorkerId,
			poolId: releaseLease.browserPoolId,
			maxBrowserProcesses: 1,
			pid: 999999,
			cdpUrl: "http://127.0.0.1:9",
			userDataDir: releaseLease.userDataDir,
			activeLeaseId: releaseLease.browserPoolLeaseId,
			activeLeaseCount: 1,
			owner: "agent-release",
			state: "leased",
			cleanupStatus: "not-attempted",
		}, null, 2)}\n`, "utf8");
		await execFileAsync("node", [cliPath, "tools", "browser-use", "lease", "release", releaseLease.id], { cwd, env });
		const releasedPoolState = JSON.parse(await readFile(poolStatePath, "utf8"));
		assert.equal(releasedPoolState.activeLeaseId, undefined);
		assert.equal(releasedPoolState.activeLeaseCount, 0);
		assert.equal(releasedPoolState.cleanupStatus, "skipped");

		const acquireExpired = await execFileAsync("node", [
			cliPath,
			"tools",
			"browser-use",
			"lease",
			"acquire",
			"--app",
			"pibo-chat",
			"--owner",
			"agent-expired",
			"--template-dir",
			join(cwd, "empty-template"),
			"--json",
		], { cwd, env });
		const expiredLease = JSON.parse(acquireExpired.stdout);
		const browser = spawnBrowserLikeProcess("chromium", expiredLease.userDataDir);
		children.push(browser);
		await waitForProcess(browser.pid, true);
		const templateBrowser = spawnBrowserLikeProcess("chromium", templateDir);
		children.push(templateBrowser);
		await waitForProcess(templateBrowser.pid, true);
		const expiredPoolStatePath = join(expiredLease.browserPoolRootDir, "browser-pools", expiredLease.browserPoolWorkerId, expiredLease.browserPoolId, "state.json");
		await mkdir(dirname(expiredPoolStatePath), { recursive: true });
		await writeFile(expiredPoolStatePath, `${JSON.stringify({
			workerId: expiredLease.browserPoolWorkerId,
			poolId: expiredLease.browserPoolId,
			maxBrowserProcesses: 1,
			pid: browser.pid,
			cdpUrl: "http://127.0.0.1:9",
			userDataDir: expiredLease.userDataDir,
			activeLeaseId: expiredLease.browserPoolLeaseId,
			activeLeaseCount: 1,
			owner: "agent-expired",
			state: "leased",
			cleanupStatus: "not-attempted",
		}, null, 2)}\n`, "utf8");
		const registryPath = join(expiredLease.browserUseHome, "auth-pool", "leases.json");
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		const registryLease = registry.leases.find((lease) => lease.id === expiredLease.id);
		registryLease.expiresAt = new Date(Date.now() - 60_000).toISOString();
		await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

		const reaped = await execFileAsync("node", [cliPath, "tools", "browser-use", "lease", "reap-stale"], { cwd, env });
		assert.match(reaped.stdout, /Reaped 1 stale browser-use auth lease/);
		await waitForProcess(browser.pid, false);
		assert.equal(processIsAlive(templateBrowser.pid), true);
		assert.equal(await readFile(join(templateDir, "Cookies"), "utf8"), "auth-cookie");
		assert.equal(await readFile(join(templateDir, "SingletonLock"), "utf8"), "template-lock");
		const reapedPoolState = JSON.parse(await readFile(expiredPoolStatePath, "utf8"));
		assert.equal(reapedPoolState.activeLeaseId, undefined);
		assert.equal(reapedPoolState.cleanupStatus, "success");
	} finally {
		for (const child of children) terminateProcess(child);
		await rm(cwd, { recursive: true, force: true });
	}
});

test("pibo tools browser-use lists Chrome targets without launching a browser", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-browser-use-targets-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		await withTargetListServer(
			[
				{
					id: "target-1",
					type: "page",
					title: "Pibo Web Chat",
					url: "http://4788.127.0.0.1.sslip.io/apps/chat",
					webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/target-1",
				},
			],
			async (cdpUrl) => {
				const result = await execFileAsync(
					"node",
					[cliPath, "tools", "browser-use", "targets", "--cdp-url", cdpUrl, "--no-probe"],
					{ cwd, env },
				);

				assert.match(result.stdout, /id\turl\tauth\tcomposer\ttitle/);
				assert.match(result.stdout, /target-1\thttp:\/\/4788\.127\.0\.0\.1\.sslip\.io\/apps\/chat\tunknown\tno\tPibo Web Chat/);
			},
		);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("browser-use target helpers prefer authenticated Chat targets with composers", () => {
	const targets = [
		{
			id: "unauth",
			type: "page",
			title: "Pibo Web Chat",
			url: "http://4788.127.0.0.1.sslip.io/apps/chat",
			webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/unauth",
			auth: "unauthenticated",
			composer: false,
			textareaCount: 0,
		},
		{
			id: "usable",
			type: "page",
			title: "Pibo Web Chat",
			url: "http://4790.127.0.0.1.sslip.io/apps/chat/rooms/room_1/sessions/ps_1",
			webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/usable",
			auth: "authenticated",
			composer: true,
			textareaCount: 1,
		},
	];

	assert.equal(selectBestChatTarget(targets)?.id, "usable");
	assert.match(formatBrowserUseTargets(targets), /usable\t.*\tauthenticated\tyes\tPibo Web Chat/);
});

test("pibo tools pins browser-use to the guide-compatible version", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pibo-tools-show-"));
	try {
		const env = { ...process.env, PIBO_HOME: join(cwd, "pibo-home") };
		const result = await execFileAsync("node", [cliPath, "tools", "show", "browser-use"], { cwd, env });

		assert.match(result.stdout, /browser-use 0\.12\.6/);
		assert.match(result.stdout, /Next:/);
		assert.match(result.stdout, /pibo tools env browser-use/);
		assert.match(result.stdout, /pibo tools guide browser-use browser-use/);
		assert.match(result.stdout, /pibo tools browser-use/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
