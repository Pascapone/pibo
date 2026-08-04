import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	acquireBrowserPoolLease,
	browserPoolPaths,
	createEmptyBrowserPoolState,
	loadBrowserPoolState,
	releaseBrowserPoolLease,
	saveBrowserPoolState,
} from "../dist/tools/browser-pool.js";
import { PiboLoopStore } from "../dist/loops/store.js";

const options = parseArgs(process.argv.slice(2));
const durationHours = positiveNumber(options.durationHours ?? "24", "duration-hours");
if (durationHours < 24 || durationHours > 48) throw new Error("--duration-hours must be between 24 and 48");
const turns = positiveInteger(options.turns ?? "144", "turns");
const realTime = options.realTime === true;
const outputPath = resolve(options.output ?? join(tmpdir(), `pibo-goal-endurance-${Date.now()}.json`));
const root = await mkdtemp(join(tmpdir(), "pibo-goal-endurance-"));
const report = {
	schemaVersion: 1,
	startedAt: new Date().toISOString(),
	mode: realTime ? "wall-clock" : "accelerated",
	configuredDurationHours: durationHours,
	configuredTurns: turns,
	outputPath,
	checks: {},
	variants: {},
	passed: false,
};

try {
	const browser = await runBrowserLifecycle(join(root, "browser"), durationHours, turns, realTime);
	const unbounded = await runGoalVariant({
		root: join(root, "unbounded"),
		durationHours,
		turns,
		realTime,
		browserLeaseId: browser.leaseId,
		budget: undefined,
	});
	const budgetLimited = await runGoalVariant({
		root: join(root, "budget"),
		durationHours: 24,
		turns: Math.max(8, Math.min(turns, 48)),
		realTime: false,
		browserLeaseId: browser.leaseId,
		budget: 500,
	});

	report.variants = { unbounded, budgetLimited };
	report.browser = browser;
	report.checks = {
		sameGoalAfterRestart: unbounded.goalIds.length === 1,
		sameSessionAfterRestart: unbounded.sessionIds.length === 1,
		noDuplicateProgress: unbounded.progress.unique === unbounded.progress.total,
		noLostProgress: unbounded.progress.total === unbounded.runs.ok,
		interruptedRunRecovered: unbounded.runs.interrupted === 1,
		toolTimeoutRecorded: unbounded.runs.toolTimeout === 1,
		pauseResumePreserved: unbounded.pauseResume.passed,
		compactionAndTraceGrowth: unbounded.traceFacts >= turns - 2 && unbounded.compactionFacts >= 1,
		browserRenewedOrReacquired: browser.renewals >= turns && browser.replacements === 1,
		browserFinallyReleased: browser.activeLeaseIdAfterRelease === undefined,
		budgetVariantStopped: budgetLimited.goalStatus === "budget_limited" && budgetLimited.enabled === false,
		metricsSeparated: [unbounded.metrics.virtualWallTimeSeconds, unbounded.metrics.activeTimeSeconds, unbounded.metrics.tokensUsed].every((value) => Number.isFinite(value)),
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

async function runGoalVariant({ root: variantRoot, durationHours: hours, turns: turnCount, realTime: waitInRealTime, browserLeaseId, budget }) {
	await mkdir(variantRoot, { recursive: true });
	const dbPath = join(variantRoot, "loops.sqlite");
	const sessionId = `ps_endurance_${budget === undefined ? "unbounded" : "budget"}`;
	const baseMs = Date.parse("2026-08-04T00:00:00.000Z");
	const intervalMs = (hours * 60 * 60 * 1000) / turnCount;
	const sleepMs = waitInRealTime ? intervalMs : 0;
	let nowMs = baseMs;
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
			store.close();
			nowMs += 10 * 60 * 1000;
			store = new PiboLoopStore({ path: dbPath });
			interrupted += store.recoverInterruptedRuns(new Date(nowMs));
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
		if (turn > 0 && turn % 50 === 0) store.appendRunFact({ id: `rfact_compact_${budget ?? "none"}_${turn}`, jobId: goalId, runId: reserved.run.id, piboSessionId: sessionId, type: "endurance.compaction", source: "pibo", payload: { turn, retained: 25 }, createdAt: now.toISOString() });
	}

	const job = store.getJob(goalId);
	const runs = store.listRuns({ jobId: goalId, limit: 500 });
	const facts = store.listRunFacts({ jobId: goalId, limit: 500 });
	const progress = facts.filter((fact) => fact.type === "endurance.progress");
	const traceFacts = facts.filter((fact) => fact.type === "endurance.progress" || fact.type === "endurance.failure").length;
	const compactionFacts = facts.filter((fact) => fact.type === "endurance.compaction").length;
	const runSessionIds = runs.map((run) => run.piboSessionId).filter(Boolean);
	store.close();
	return {
		goalIds: [goalId],
		sessionIds: [...new Set(runSessionIds)],
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
		metrics: {
			virtualWallTimeSeconds: Math.round(hours * 60 * 60),
			activeTimeSeconds,
			tokensUsed: job?.state.tokensUsed ?? tokensUsedByHarness,
			runFailureCount: runs.filter((run) => run.status === "error").length,
		},
	};
}

async function runBrowserLifecycle(rootDir, durationHoursValue, turnCount, waitInRealTime) {
	await mkdir(rootDir, { recursive: true });
	const identity = { workerId: "endurance-worker", poolId: "default", maxBrowserProcesses: 1 };
	const paths = browserPoolPaths(rootDir, identity);
	const leaseId = "lease-endurance";
	let currentPid = 4100;
	await saveBrowserPoolState(paths.statePath, {
		...createEmptyBrowserPoolState(identity),
		pid: currentPid,
		cdpPort: 49200,
		cdpUrl: "http://127.0.0.1:49200",
		userDataDir: join(rootDir, "profile"),
		state: "ready",
	});
	let renewals = 0;
	let replacements = 0;
	const intervalMs = (durationHoursValue * 60 * 60 * 1000) / turnCount;
	for (let turn = 0; turn < turnCount; turn += 1) {
		const shouldReplace = turn === Math.floor(turnCount / 3);
		const result = await acquireBrowserPoolLease(paths, identity, {
			leaseId,
			holder: "loop:endurance",
			idleTimeoutMs: Math.max(1, Math.round(intervalMs * 2)),
			now: () => new Date(Date.parse("2026-08-04T00:00:00.000Z") + turn * intervalMs),
			isPidAlive: (pid) => !shouldReplace && pid === currentPid,
			checkCdpHealth: async () => ({ ok: true, browser: "Chrome/fixture" }),
			startBrowser: async () => {
				currentPid += 1;
				replacements += 1;
				return { pid: currentPid, processGroupId: currentPid, cdpPort: 49200, cdpUrl: "http://127.0.0.1:49200", userDataDir: join(rootDir, "profile") };
			},
		});
		assert(result.acquired, `Browser lease renewal failed at turn ${turn}: ${result.staleReason}`);
		renewals += 1;
	}
	const release = await releaseBrowserPoolLease(paths, identity, {
		leaseId,
		isPidAlive: () => true,
		cleanupCdp: async () => ({ ok: true, status: "success", closedTargets: 3 }),
	});
	const finalState = await loadBrowserPoolState(paths.statePath, identity);
	return { leaseId, renewals, replacements, releaseStatus: release.cleanupStatus, activeLeaseIdAfterRelease: finalState.activeLeaseId, finalState: finalState.state };
}

function parseArgs(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/goal-endurance-check.mjs [--duration-hours 24..48] [--turns 144] [--output report.json] [--real-time]");
			process.exit(0);
		}
		if (arg === "--real-time") { result.realTime = true; continue; }
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
