import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";
import {
	PiboRunResourceLimitError,
	parseLinuxMeminfo,
	parseLinuxPressure,
	prepareYieldedRunExecution,
	resolveYieldedRunResourcePolicy,
	systemdRunCommand,
	windowsProcessTreeCommand,
} from "../dist/runs/resource-isolation.js";

const execFileAsync = promisify(execFile);
const hasSystemd = process.platform === "linux" && existsSync("/run/systemd/system");

function safePolicyEnv(overrides = {}) {
	return {
		PIBO_YIELDED_RUN_ISOLATION: process.platform === "win32" ? "windows-process-tree" : "systemd",
		PIBO_YIELDED_RUN_MEMORY_HIGH_BYTES: String(128 * 1024 * 1024),
		PIBO_YIELDED_RUN_MEMORY_MAX_BYTES: String(256 * 1024 * 1024),
		PIBO_YIELDED_RUN_TASKS_MAX: "32",
		PIBO_YIELDED_RUN_CPU_QUOTA_PERCENT: "100",
		PIBO_YIELDED_RUN_IO_WEIGHT: "50",
		PIBO_YIELDED_RUN_MONITOR_INTERVAL_MS: "100",
		PIBO_YIELDED_RUN_MIN_HOST_AVAILABLE_BYTES: "0",
		PIBO_YIELDED_RUN_MAX_MEMORY_FULL_PSI_AVG10: "1000",
		PIBO_YIELDED_RUN_MAX_IO_FULL_PSI_AVG10: "1000",
		...overrides,
	};
}

test("yielded-run resource policy resolves enforced cgroup defaults and overrides", () => {
	const defaults = resolveYieldedRunResourcePolicy({});
	assert.equal(defaults.mode, process.platform === "win32" ? "windows-process-tree" : "systemd");
	assert.equal(defaults.memoryHighBytes, 1280 * 1024 * 1024);
	assert.equal(defaults.memoryMaxBytes, 1792 * 1024 * 1024);
	assert.equal(defaults.tasksMax, 128);
	assert.equal(defaults.cpuQuotaPercent, 200);
	assert.equal(defaults.ioWeight, 100);

	const overridden = resolveYieldedRunResourcePolicy(safePolicyEnv());
	assert.equal(overridden.memoryHighBytes, 128 * 1024 * 1024);
	assert.equal(overridden.memoryMaxBytes, 256 * 1024 * 1024);
	assert.equal(overridden.tasksMax, 32);
});

test("Linux MemAvailable and pressure parsers expose lifetime admission inputs", () => {
	assert.deepEqual(parseLinuxMeminfo("MemFree: 100 kB\nMemAvailable: 900 kB\n"), {
		freeBytes: 100 * 1024,
		availableBytes: 900 * 1024,
	});
	assert.deepEqual(parseLinuxPressure("some avg10=1.25 avg60=0.50 avg300=0.25 total=1\nfull avg10=0.75 avg60=0.25 avg300=0.10 total=2\n"), {
		someAvg10: 1.25,
		fullAvg10: 0.75,
	});
});

test("systemd wrapper places Bash in a dedicated bounded transient service", () => {
	const policy = resolveYieldedRunResourcePolicy({ ...safePolicyEnv(), PIBO_YIELDED_RUN_ISOLATION: "systemd" });
	const command = systemdRunCommand("printf 'ok'", "pibo-yielded-test.service", policy, "/tmp/pibo-yielded-test.metrics");
	assert.match(command, /systemd-run/);
	assert.match(command, /--slice=pibo-yielded\.slice/);
	assert.match(command, /MemoryHigh=134217728/);
	assert.match(command, /MemoryMax=268435456/);
	assert.match(command, /TasksMax=32/);
	assert.match(command, /CPUQuota=100%/);
	assert.match(command, /IOWeight=50/);
	assert.match(command, /KillMode=control-group/);
	assert.match(command, /printf/);
});

test("Windows process-tree wrapper records the native Bash PID before user work", () => {
	const command = windowsProcessTreeCommand("printf 'ok'", "C:\\Temp\\pibo yielded.pid");
	assert.match(command, /ps -W/);
	assert.match(command, /awk -v p=\$\$/);
	assert.match(command, /C:\/Temp\/pibo yielded\.pid/);
	assert.match(command, /printf 'ok'/);
});

test("non-process yielded tools remain in-process and preserve their arguments", async () => {
	const prepared = prepareYieldedRunExecution("read", { path: "README.md" }, { env: safePolicyEnv() });
	assert.equal(prepared.resources.isolationMode, "off");
	assert.deepEqual(prepared.params, { path: "README.md" });
	assert.equal(await prepared.execute(async () => "ok"), "ok");
});

test("real yielded Bash smoke runs in the bounded transient cgroup and records peaks", { skip: !hasSystemd }, async () => {
	const prepared = prepareYieldedRunExecution("bash", { command: "printf isolated-output" }, {
		env: safePolicyEnv(),
		unitName: `pibo-yielded-test-${process.pid}.service`,
	});
	const result = await prepared.execute(async () => {
		const { stdout } = await execFileAsync("/bin/bash", ["-lc", prepared.params.command], { timeout: 30_000 });
		return stdout;
	});
	assert.match(result, /isolated-output/);
	assert.equal(prepared.resources.isolationMode, "systemd");
	assert.match(prepared.resources.cgroup?.controlGroup ?? "", /pibo-yielded/);
	assert.ok((prepared.resources.cgroup?.memoryPeakBytes ?? 0) > 0);
	assert.equal(prepared.resources.cgroup?.memoryMaxBytes, 256 * 1024 * 1024);
	assert.ok((prepared.resources.cgroup?.tasksPeak ?? 0) >= 1);
	assert.equal(prepared.resources.limitReason, undefined);
});

test("explicit cancellation terminates the isolated process tree", { skip: !hasSystemd }, async () => {
	const unitName = `pibo-yielded-cancel-cleanup-${process.pid}.service`;
	const prepared = prepareYieldedRunExecution("bash", { command: "printf started; sleep 30" }, {
		env: safePolicyEnv(),
		unitName,
	});
	try {
		const execution = prepared.execute(async () => {
			await execFileAsync("/bin/bash", ["-lc", prepared.params.command], { timeout: 30_000 });
		});
		let active = false;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			active = await execFileAsync("systemctl", ["is-active", unitName], { timeout: 5_000 })
				.then(({ stdout }) => stdout.trim() === "active")
				.catch(() => false);
			if (active) break;
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.equal(active, true);
		await prepared.cancel();
		await assert.rejects(execution);
		const activeState = await execFileAsync("systemctl", ["is-active", unitName], { timeout: 5_000 })
			.then(({ stdout }) => stdout.trim())
			.catch((error) => String(error.stdout ?? "").trim());
		assert.notEqual(activeState, "active");
	} finally {
		await execFileAsync("systemctl", ["stop", unitName], { timeout: 5_000 }).catch(() => undefined);
		await execFileAsync("systemctl", ["reset-failed", unitName], { timeout: 5_000 }).catch(() => undefined);
	}
});

test("outer execution failure terminates the isolated process tree", { skip: !hasSystemd }, async () => {
	const unitName = `pibo-yielded-timeout-cleanup-${process.pid}.service`;
	const prepared = prepareYieldedRunExecution("bash", { command: "sleep 30" }, {
		env: safePolicyEnv(),
		unitName,
	});
	try {
		await assert.rejects(prepared.execute(async () => {
			await execFileAsync("/bin/bash", ["-lc", prepared.params.command], { timeout: 500 });
		}));
		const activeState = await execFileAsync("systemctl", ["is-active", unitName], { timeout: 5_000 })
			.then(({ stdout }) => stdout.trim())
			.catch((error) => String(error.stdout ?? "").trim());
		assert.notEqual(activeState, "active");
		assert.ok(prepared.resources.completedAt);
	} finally {
		await execFileAsync("systemctl", ["stop", unitName], { timeout: 5_000 }).catch(() => undefined);
		await execFileAsync("systemctl", ["reset-failed", unitName], { timeout: 5_000 }).catch(() => undefined);
	}
});

test("lifetime pressure monitoring terminates the isolated workload as resource_limited", { skip: !hasSystemd }, async () => {
	const prepared = prepareYieldedRunExecution("bash", {
		command: "python3 -c 'x=bytearray(256*1024*1024); x[::4096]=b\"x\"*(len(x)//4096); print(len(x))'",
	}, {
		env: safePolicyEnv({
			PIBO_YIELDED_RUN_MEMORY_HIGH_BYTES: String(48 * 1024 * 1024),
			PIBO_YIELDED_RUN_MEMORY_MAX_BYTES: String(64 * 1024 * 1024),
			PIBO_YIELDED_RUN_MAX_MEMORY_FULL_PSI_AVG10: "0.01",
		}),
		unitName: `pibo-yielded-oom-test-${process.pid}.service`,
	});
	await assert.rejects(
		prepared.execute(async () => {
			await execFileAsync("/bin/bash", ["-lc", prepared.params.command], { timeout: 10_000 });
		}),
		(error) => error instanceof PiboRunResourceLimitError && /resource_limited/.test(error.message),
	);
	assert.match(prepared.resources.limitReason ?? "", /memory full PSI|OOM|MemoryMax|resource limit/i);
	assert.ok((prepared.resources.cgroup?.memoryPeakBytes ?? 0) > 0);
	assert.equal(prepared.resources.cgroup?.memoryMaxBytes, 64 * 1024 * 1024);
});
