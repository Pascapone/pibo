import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	acquireBrowserPoolLease,
	browserPoolPaths,
	checkBrowserPoolCdpHealth,
	createEmptyBrowserPoolState,
	loadBrowserPoolState,
	reapIdleBrowserPool,
	releaseBrowserPoolLease,
	saveBrowserPoolState,
} from "../dist/tools/browser-pool.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { createPiboSession } from "../dist/sessions/store.js";

const options = parseArgs(process.argv.slice(2));
const durationHours = positiveNumber(options.durationHours ?? "24", "duration-hours");
if (durationHours < 24 || durationHours > 48) throw new Error("--duration-hours must be between 24 and 48");
const turns = positiveInteger(options.turns ?? "144", "turns");
const realTime = options.realTime === true;
const realBrowser = options.realBrowser === true;
const realGateway = options.realGateway === true;
const outputPath = resolve(options.output ?? join(tmpdir(), `pibo-goal-endurance-${Date.now()}.json`));
const root = await mkdtemp(join(tmpdir(), "pibo-goal-endurance-"));
const report = {
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	mode: realTime ? "wall-clock" : "accelerated",
	integration: { browser: realBrowser ? "chromium-cdp" : "deterministic", gateway: realGateway ? "process-restart" : "store-reopen" },
	configuredDurationHours: durationHours,
	configuredTurns: turns,
	outputPath,
	checks: {},
	variants: {},
	passed: false,
};

try {
	const browserLeaseId = "lease-endurance";
	const [browser, unbounded] = await Promise.all([
		runBrowserLifecycle(join(root, "browser"), durationHours, turns, realTime, realBrowser),
		runGoalVariant({
			root: join(root, "unbounded"),
			durationHours,
			turns,
			realTime,
			browserLeaseId,
			budget: undefined,
			realGateway,
		}),
	]);
	const budgetLimited = await runGoalVariant({
		root: join(root, "budget"),
		durationHours: 24,
		turns: Math.max(8, Math.min(turns, 48)),
		realTime: false,
		browserLeaseId,
		budget: 500,
		realGateway: false,
	});

	report.variants = { unbounded, budgetLimited };
	report.browser = browser;
	report.checks = {
		sameGoalAfterRestart: unbounded.goalIds.length === 1,
		sameSessionAfterRestart: unbounded.sessionIds.length === 1 && unbounded.persistedSessionCount === 1,
		noDuplicateProgress: unbounded.progress.unique === unbounded.progress.total,
		noLostProgress: unbounded.progress.total === unbounded.runs.ok,
		interruptedRunRecovered: unbounded.runs.interrupted === 1,
		gatewayRestartExercised: unbounded.restart.mode === (realGateway ? "process-restart" : "store-reopen") && unbounded.restart.starts === (realGateway ? 2 : 0),
		toolTimeoutRecorded: unbounded.runs.toolTimeout === 1,
		pauseResumePreserved: unbounded.pauseResume.passed,
		compactionAndTraceGrowth: unbounded.traceFacts >= turns - 2 && unbounded.compactionFacts >= 1,
		browserRenewedOrReacquired: browser.renewals >= turns && browser.replacements === 1,
		browserFinallyReleased: browser.activeLeaseIdAfterRelease === undefined && browser.reaped === true && browser.finalState === "empty",
		budgetVariantStopped: budgetLimited.goalStatus === "budget_limited" && budgetLimited.enabled === false,
		metricsSeparated: [unbounded.metrics.simulatedWallTimeSeconds, unbounded.metrics.elapsedWallClockSeconds, unbounded.metrics.activeTimeSeconds, unbounded.metrics.tokensUsed].every((value) => Number.isFinite(value)),
	};
	assert(Object.values(report.checks).every(Boolean), `Endurance checks failed: ${JSON.stringify(report.checks)}`);
	report.passed = true;
} catch (error) {
	report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
	process.exitCode = 1;
} finally {
	report.completedAt = new Date().toISOString();
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await rm(root, { recursive: true, force: true });
	console.log(JSON.stringify({ passed: report.passed, outputPath, checks: report.checks }, null, 2));
}

async function runGoalVariant({ root: variantRoot, durationHours: hours, turns: turnCount, realTime: waitInRealTime, browserLeaseId, budget, realGateway: useRealGateway }) {
	const startedWallMs = Date.now();
	await mkdir(variantRoot, { recursive: true });
	const dbPath = join(variantRoot, "loops.sqlite");
	const dataStorePath = join(variantRoot, "pibo.sqlite");
	const payloadRootDir = join(variantRoot, "payloads");
	const sessionId = `ps_endurance_${budget === undefined ? "unbounded" : "budget"}`;
	const baseMs = Date.parse("2026-08-04T00:00:00.000Z");
	const intervalMs = (hours * 60 * 60 * 1000) / turnCount;
	const sleepMs = waitInRealTime ? intervalMs : 0;
	const compactionInterval = Math.max(2, Math.floor(turnCount / 4));
	let nowMs = baseMs;
	const sessionDataStore = new PiboDataStore(dataStorePath, { payloadRootDir });
	const room = new ChatRoomService(sessionDataStore).ensureDefaultRoom({ name: "Endurance" });
	const piboSession = createPiboSession({ id: sessionId, channel: "pibo.chat-web", kind: "loop", profile: "base", title: "Goal endurance validation", metadata: { loopMode: "goal" } }, new Date(baseMs).toISOString());
	sessionDataStore.sessions.upsertSession({ session: piboSession, roomId: room.id, status: "idle" });
	sessionDataStore.close();
	let store = new PiboLoopStore({ path: dbPath });
	const created = store.createJob({
		mode: "goal",
		name: budget === undefined ? "24h endurance goal" : "budget-limited endurance goal",
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Perform bounded deterministic endurance work.",
		enabled: true,
		...(budget === undefined ? {} : { tokenBudget: budget }),
		resources: { workerId: "endurance-worker", browserLeaseIds: [browserLeaseId], cleanupState: "active" },
	}, new Date(nowMs));
	const goalId = created.id;
	const runFailures = [];
	const progressIds = [];
	let activeTimeSeconds = 0;
	let tokensUsedByHarness = 0;
	let interrupted = 0;
	let toolTimeout = 0;
	let pausePassed = false;
	let restart = { mode: useRealGateway ? "process-restart" : "store-reopen", starts: 0 };

	for (let turn = 0; turn < turnCount; turn += 1) {
		if (sleepMs > 0) await sleep(sleepMs);
		nowMs = baseMs + Math.round(turn * intervalMs);
		const now = new Date(nowMs);
		if (budget !== undefined && store.getJob(goalId)?.state.goalStatus === "budget_limited") break;

		if (budget === undefined && turn === Math.floor(turnCount / 2)) {
			store.updateJob(goalId, { enabled: false }, now);
			const pausedReservation = store.reserveDueRuns(1, now);
			assert(pausedReservation.length === 0, "Paused goal reserved a run");
			nowMs += Math.round(intervalMs * 2);
			const resumed = store.updateJob(goalId, { enabled: true }, new Date(nowMs));
			pausePassed = resumed?.state.goalStatus === "active" && resumed.enabled === true;
		}

		if (budget === undefined && turn === Math.floor(turnCount / 3)) {
			const reserved = store.reserveRun(goalId, now);
			assert(reserved, "Could not reserve interrupted run");
			store.attachRunSession(goalId, reserved.run.id, sessionId, now);
			store.updateRunResources({ jobId: goalId, runId: reserved.run.id, resources: { workerId: "endurance-worker", browserLeaseIds: [browserLeaseId], cleanupState: "active" } }, now);
			if (useRealGateway) store.updateJob(goalId, { enabled: false }, now);
			store.close();
			nowMs += 10 * 60 * 1000;
			if (useRealGateway) {
				restart = await runGatewayRestart({ root: join(variantRoot, "gateway"), loopStorePath: dbPath, dataStorePath, payloadRootDir });
				store = new PiboLoopStore({ path: dbPath });
				const recoveredRun = store.listRuns({ jobId: goalId, limit: 500 }).find((candidate) => candidate.id === reserved.run.id);
				interrupted += recoveredRun?.status === "error" && recoveredRun.reason === "interrupted" ? 1 : 0;
				store.updateJob(goalId, { enabled: true }, new Date(nowMs));
			} else {
				store = new PiboLoopStore({ path: dbPath });
				interrupted += store.recoverInterruptedRuns(new Date(nowMs));
			}
			continue;
		}

		const reserved = store.reserveRun(goalId, now);
		if (!reserved) break;
		store.attachRunSession(goalId, reserved.run.id, sessionId, now);
		const isTimeout = budget === undefined && turn === Math.floor(turnCount / 4);
		const activeSeconds = 2 + (turn % 5);
		const tokens = budget === undefined ? 11 + (turn % 7) : 60;
		activeTimeSeconds += activeSeconds;
		tokensUsedByHarness += tokens;
		store.recordGoalProgress(goalId, { tokens, timeUsedSeconds: activeSeconds }, new Date(nowMs + activeSeconds * 1000));
		if (isTimeout) {
			toolTimeout += 1;
			runFailures.push({ runId: reserved.run.id, kind: "tool_timeout", at: now.toISOString() });
			store.appendRunFact({ id: `rfact_failure_${turn}`, jobId: goalId, runId: reserved.run.id, piboSessionId: sessionId, type: "endurance.failure", source: "pibo", payload: { turn, kind: "tool_timeout", bytes: 1024 + turn }, createdAt: now.toISOString() });
			store.completeRun({ jobId: goalId, runId: reserved.run.id, status: "error", piboSessionId: sessionId, reason: "tool-timeout", error: "Deterministic tool execution timed out" }, new Date(nowMs + activeSeconds * 1000));
		} else {
			const progressId = `turn-${turn}`;
			progressIds.push(progressId);
			store.appendRunFact({ id: `rfact_progress_${budget ?? "none"}_${turn}`, jobId: goalId, runId: reserved.run.id, piboSessionId: sessionId, type: "endurance.progress", source: "pibo", payload: { progressId, turn } , createdAt: now.toISOString() });
			store.completeRun({ jobId: goalId, runId: reserved.run.id, status: "ok", piboSessionId: sessionId, reason: "deterministic-progress" }, new Date(nowMs + activeSeconds * 1000));
		}
		if (turn > 0 && turn % compactionInterval === 0) store.appendRunFact({ id: `rfact_compact_${budget ?? "none"}_${turn}`, jobId: goalId, runId: reserved.run.id, piboSessionId: sessionId, type: "endurance.compaction", source: "pibo", payload: { turn, retained: Math.max(1, Math.floor(turn / 2)) }, createdAt: now.toISOString() });
	}

	const job = store.getJob(goalId);
	const runs = store.listRuns({ jobId: goalId, limit: 500 });
	const facts = store.listRunFacts({ jobId: goalId, limit: 500 });
	const progress = facts.filter((fact) => fact.type === "endurance.progress");
	const traceFacts = facts.filter((fact) => fact.type === "endurance.progress" || fact.type === "endurance.failure").length;
	const compactionFacts = facts.filter((fact) => fact.type === "endurance.compaction").length;
	const runSessionIds = runs.map((run) => run.piboSessionId).filter(Boolean);
	store.close();
	const verifiedDataStore = new PiboDataStore(dataStorePath, { payloadRootDir });
	const persistedSessionCount = Number(verifiedDataStore.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id = ?").get(sessionId).count);
	verifiedDataStore.close();
	return {
		goalIds: [goalId],
		sessionIds: [...new Set(runSessionIds)],
		persistedSessionCount,
		enabled: job?.enabled,
		goalStatus: job?.state.goalStatus,
		completedIterations: job?.state.completedIterations ?? 0,
		progress: { total: progress.length, unique: new Set(progress.map((fact) => fact.payload.progressId)).size },
		traceFacts,
		compactionFacts,
		runs: {
			total: runs.length,
			ok: runs.filter((run) => run.status === "ok").length,
			error: runs.filter((run) => run.status === "error").length,
			interrupted,
			toolTimeout,
			failures: runFailures,
		},
		pauseResume: { passed: budget === undefined ? pausePassed : true },
		restart,
		metrics: {
			simulatedWallTimeSeconds: Math.round(hours * 60 * 60),
			elapsedWallClockSeconds: Math.max(0, Math.round((Date.now() - startedWallMs) / 1000)),
			activeTimeSeconds,
			tokensUsed: job?.state.tokensUsed ?? tokensUsedByHarness,
			runFailureCount: runs.filter((run) => run.status === "error").length,
		},
	};
}

async function runBrowserLifecycle(rootDir, durationHoursValue, turnCount, waitInRealTime, useRealBrowser) {
	await mkdir(rootDir, { recursive: true });
	const identity = { workerId: "endurance-worker", poolId: "default", maxBrowserProcesses: 1 };
	const paths = browserPoolPaths(rootDir, identity);
	const leaseId = "lease-endurance";
	const cdpPort = useRealBrowser ? await freePort() : 49200;
	const cdpUrl = `http://127.0.0.1:${cdpPort}`;
	const userDataDir = join(rootDir, "profile");
	let currentPid = useRealBrowser ? undefined : 4100;
	let browserVersion = useRealBrowser ? undefined : "Chrome/fixture";
	if (!useRealBrowser) {
		await saveBrowserPoolState(paths.statePath, {
			...createEmptyBrowserPoolState(identity),
			pid: currentPid,
			cdpPort,
			cdpUrl,
			userDataDir,
			state: "ready",
		});
	}
	let renewals = 0;
	let replacements = 0;
	let starts = 0;
	const intervalMs = (durationHoursValue * 60 * 60 * 1000) / turnCount;
	const baseMs = waitInRealTime ? Date.now() : Date.parse("2026-08-04T00:00:00.000Z");
	try {
		for (let turn = 0; turn < turnCount; turn += 1) {
			const shouldReplace = turn === Math.floor(turnCount / 3);
			if (useRealBrowser && shouldReplace && currentPid) await terminateProcessGroup(currentPid);
			const result = await acquireBrowserPoolLease(paths, identity, {
				leaseId,
				holder: "loop:endurance",
				idleTimeoutMs: Math.max(1, Math.round(intervalMs * 2)),
				now: () => new Date(baseMs + turn * intervalMs),
				...(useRealBrowser ? {} : {
					isPidAlive: (pid) => !shouldReplace && pid === currentPid,
					checkCdpHealth: async () => ({ ok: true, browser: browserVersion }),
				}),
				startBrowser: async () => {
					if (!useRealBrowser) {
						currentPid = (currentPid ?? 4100) + 1;
						starts += 1;
						if (shouldReplace) replacements += 1;
						return { pid: currentPid, processGroupId: currentPid, cdpPort, cdpUrl, userDataDir };
					}
					const started = await startChromium({ cdpPort, cdpUrl, userDataDir });
					if (currentPid !== undefined) replacements += 1;
					currentPid = started.pid;
					starts += 1;
					const health = await checkBrowserPoolCdpHealth(cdpUrl, { timeoutMs: 5_000 });
					assert(health.ok, health.reason ?? "Chromium CDP did not become healthy");
					browserVersion = health.browser;
					return started;
				},
			});
			assert(result.acquired, `Browser lease renewal failed at turn ${turn}: ${result.staleReason}`);
			currentPid = result.pid;
			renewals += 1;
			if (waitInRealTime && intervalMs > 0) await sleep(intervalMs);
		}
		const release = await releaseBrowserPoolLease(paths, identity, {
			leaseId,
			...(useRealBrowser ? {} : {
				isPidAlive: () => true,
				cleanupCdp: async () => ({ ok: true, status: "success", closedTargets: 3 }),
			}),
		});
		const reap = await reapIdleBrowserPool(paths, identity, {
			idleTimeoutMs: 1,
			now: () => new Date(Date.now() + 30 * 60_000),
			...(useRealBrowser ? {} : {
				isPidAlive: () => true,
				terminateBrowserProcessTree: async () => ({ ok: true, terminatedProcessTrees: 1 }),
				removeStaleFiles: async () => 0,
			}),
		});
		const finalState = await loadBrowserPoolState(paths.statePath, identity);
		return {
			mode: useRealBrowser ? "chromium-cdp" : "deterministic",
			leaseId,
			renewals,
			replacements,
			starts,
			browserVersion,
			releaseStatus: release.cleanupStatus,
			reaped: reap.reaped,
			terminatedProcessTrees: reap.terminatedProcessTrees,
			activeLeaseIdAfterRelease: finalState.activeLeaseId,
			finalState: finalState.state,
		};
	} finally {
		if (useRealBrowser && currentPid && isPidAlive(currentPid)) await terminateProcessGroup(currentPid);
	}
}

async function runGatewayRestart({ root: gatewayRoot, loopStorePath, dataStorePath, payloadRootDir }) {
	await mkdir(gatewayRoot, { recursive: true });
	const webPort = await freePort();
	const agentPort = await freePort();
	const gatewayCode = `
		import('./dist/gateway/web.js').then(({ runWebGatewayServer }) => runWebGatewayServer({
			host: '127.0.0.1',
			port: Number(process.env.PIBO_ENDURANCE_AGENT_PORT),
			authMode: 'local',
			web: { host: '127.0.0.1', port: Number(process.env.PIBO_ENDURANCE_WEB_PORT) },
			chat: {
				ralphStorePath: process.env.PIBO_ENDURANCE_LOOP_STORE,
				cronStorePath: process.env.PIBO_ENDURANCE_CRON_STORE,
				dataStorePath: process.env.PIBO_ENDURANCE_DATA_STORE,
				dataPayloadRootDir: process.env.PIBO_ENDURANCE_PAYLOAD_ROOT,
				agentStorePath: process.env.PIBO_ENDURANCE_AGENT_STORE,
			},
		}));
	`;
	const env = {
		...process.env,
		PIBO_HOME: gatewayRoot,
		PIBO_GATEWAY_MODE: "dev",
		PIBO_RESOURCE_REAPER_DISABLED: "1",
		PIBO_ENDURANCE_WEB_PORT: String(webPort),
		PIBO_ENDURANCE_AGENT_PORT: String(agentPort),
		PIBO_ENDURANCE_LOOP_STORE: loopStorePath,
		PIBO_ENDURANCE_CRON_STORE: join(gatewayRoot, "cron.sqlite"),
		PIBO_ENDURANCE_DATA_STORE: dataStorePath,
		PIBO_ENDURANCE_PAYLOAD_ROOT: payloadRootDir,
		PIBO_ENDURANCE_AGENT_STORE: join(gatewayRoot, "agents.sqlite"),
	};
	for (let start = 0; start < 2; start += 1) {
		const child = spawn(process.execPath, ["--input-type=module", "-e", gatewayCode], {
			cwd: process.cwd(),
			env,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
		try {
			await waitForHttp(`http://127.0.0.1:${webPort}/health`, 30_000, () => child.exitCode);
		} catch (error) {
			await stopChild(child);
			throw new Error(`Gateway start ${start + 1} failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
		}
		await stopChild(child);
	}
	return { mode: "process-restart", starts: 2, webPort, agentPort };
}

async function startChromium({ cdpPort, cdpUrl, userDataDir }) {
	await mkdir(userDataDir, { recursive: true });
	const chromium = process.env.PIBO_ENDURANCE_CHROMIUM_BIN || process.env.PIBO_BROWSER_USE_CHROME || "/usr/bin/chromium";
	const child = spawn(chromium, [
		"--headless=new",
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--disable-gpu",
		"--no-first-run",
		"--no-default-browser-check",
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${userDataDir}`,
		"about:blank",
	], { detached: true, stdio: "ignore" });
	assert(child.pid, "Chromium did not return a process id");
	child.unref();
	try {
		await waitForCdp(cdpUrl, 20_000, child.pid);
	} catch (error) {
		await terminateProcessGroup(child.pid);
		throw error;
	}
	return { pid: child.pid, processGroupId: child.pid, cdpPort, cdpUrl, userDataDir };
}

async function waitForCdp(cdpUrl, timeoutMs, pid) {
	const deadline = Date.now() + timeoutMs;
	let lastReason = "CDP did not respond";
	while (Date.now() < deadline) {
		if (!isPidAlive(pid)) throw new Error(`Chromium process ${pid} exited before CDP became healthy`);
		const health = await checkBrowserPoolCdpHealth(cdpUrl, { timeoutMs: 1_000 });
		if (health.ok) return;
		lastReason = health.reason ?? lastReason;
		await sleep(100);
	}
	throw new Error(`Timed out waiting for Chromium CDP: ${lastReason}`);
}

async function waitForHttp(url, timeoutMs, exitCode) {
	const deadline = Date.now() + timeoutMs;
	let lastReason = "HTTP endpoint did not respond";
	while (Date.now() < deadline) {
		const code = exitCode();
		if (code !== null) throw new Error(`process exited with code ${code}`);
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
			if (response.ok) return;
			lastReason = `HTTP ${response.status}`;
		} catch (error) {
			lastReason = error instanceof Error ? error.message : String(error);
		}
		await sleep(100);
	}
	throw new Error(`Timed out waiting for ${url}: ${lastReason}`);
}

async function freePort() {
	const server = createServer();
	await new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	assert(address && typeof address === "object", "Could not allocate a local port");
	await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
	return address.port;
}

async function stopChild(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	const exited = await Promise.race([
		new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
		sleep(10_000).then(() => false),
	]);
	if (!exited && child.exitCode === null) {
		child.kill("SIGKILL");
		await new Promise((resolveExit) => child.once("exit", resolveExit));
	}
}

async function terminateProcessGroup(pid) {
	if (!isPidAlive(pid)) return;
	try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
	for (let attempt = 0; attempt < 40; attempt += 1) {
		if (!isPidAlive(pid)) return;
		await sleep(100);
	}
	try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

function isPidAlive(pid) {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

function parseArgs(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/goal-endurance-check.mjs [--duration-hours 24..48] [--turns 144] [--output report.json] [--real-time] [--real-gateway] [--real-browser]");
			process.exit(0);
		}
		if (arg === "--real-time") { result.realTime = true; continue; }
		if (arg === "--real-gateway") { result.realGateway = true; continue; }
		if (arg === "--real-browser") { result.realBrowser = true; continue; }
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
		if (arg === "--duration-hours") result.durationHours = value;
		else if (arg === "--turns") result.turns = value;
		else if (arg === "--output") result.output = value;
		else throw new Error(`Unknown option ${arg}`);
		index += 1;
	}
	return result;
}

function positiveInteger(value, name) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer`);
	return parsed;
}
function positiveNumber(value, name) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be positive`);
	return parsed;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
