import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuntimeSessionRegistry } from "../dist/tools/runtime/registry.js";
import { createRuntimeToolDefinition } from "../dist/tools/runtime/tool.js";

const pythonAvailable = spawnSync(process.platform === "win32" ? "python" : "python3", ["--version"], { stdio: "ignore" }).status === 0;

function runtimeTest(runtime, name, run) {
	test(`${runtime} ${name}`, { skip: runtime === "python" && !pythonAvailable ? "python is unavailable" : false }, run);
}

function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error?.code === "ESRCH") return false;
		throw error;
	}
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Timed out waiting for ${message}`);
}

async function withRegistry(run) {
	const cwd = mkdtempSync(join(tmpdir(), "pibo-runtime-interrupt-"));
	const registry = new RuntimeSessionRegistry({ cwd });
	try {
		return await run(registry, cwd);
	} finally {
		const pids = registry.list("controller").sessions.map((session) => session.pid).filter(Number.isInteger);
		await registry.closeAll({ force: true });
		for (const pid of pids) {
			if (processAlive(pid)) process.kill(pid, "SIGKILL");
		}
		for (const pid of pids) await waitFor(() => !processAlive(pid), `runtime process ${pid} cleanup`);
		rmSync(cwd, { recursive: true, force: true });
	}
}

function assignCode(runtime, name, value) {
	return runtime === "node" ? `globalThis.${name} = ${value}` : `${name} = ${value}`;
}

function activeCode(runtime, markerPath) {
	if (runtime === "node") return `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "entered"); new Promise(() => {})`;
	return `with open(${JSON.stringify(markerPath)}, "w") as marker:\n    marker.write("entered")\nwhile True:\n    pass`;
}

for (const runtime of ["node", "python"]) {
	runtimeTest(runtime, "idle interrupts are repeatable no-ops that preserve explicit and implicit execution", async () => {
		await withRegistry(async (registry) => {
			const tool = createRuntimeToolDefinition(registry.createController("controller"));
			const started = await tool.execute("start", { action: "exec", runtime, code: assignCode(runtime, "before", 1) });
			assert.equal(started.details.status, "ok");
			const sessionId = started.details.sessionId;
			const before = await tool.execute("before", { action: "list" });
			const pid = before.details.sessions.find((session) => session.sessionId === sessionId).pid;

			for (const callId of ["interrupt-1", "interrupt-2"]) {
				const interrupted = await tool.execute(callId, { action: "interrupt", sessionId });
				assert.equal(interrupted.details.status, "ok");
				assert.match(interrupted.details.message, /idle|no active execution/i);
			}
			await new Promise((resolve) => setTimeout(resolve, 30));
			assert.equal(processAlive(pid), true);

			const listed = await tool.execute("listed", { action: "list" });
			assert.equal(listed.details.sessions.find((session) => session.sessionId === sessionId).status, "idle");
			const variables = await tool.execute("vars", { action: "vars", sessionId });
			assert.equal(variables.details.status, "ok");
			assert.ok(variables.details.variables.some((entry) => entry.name === "before"));

			const explicit = await tool.execute("explicit", { action: "exec", sessionId, code: "before + 1", mode: "eval" });
			assert.equal(explicit.details.status, "ok");
			assert.equal(explicit.details.result.repr, "2");
			const implicit = await tool.execute("implicit", { action: "exec", runtime, code: assignCode(runtime, "after", 2) });
			assert.equal(implicit.details.status, "ok");
			assert.equal(implicit.details.sessionId, sessionId);
			assert.equal((await tool.execute("final", { action: "list" })).details.sessions.length, 1);
		});
	});

	runtimeTest(runtime, "active interrupt preserves backend semantics and unaffected live sessions", async () => {
		await withRegistry(async (registry, cwd) => {
			const active = await registry.start("controller", { runtime });
			assert.equal(active.status, "ok");
			const otherRuntime = runtime === "node" ? "python" : "node";
			if (otherRuntime === "python" && !pythonAvailable) return;
			const unaffected = await registry.start("controller", { runtime: otherRuntime });
			assert.equal(unaffected.status, "ok");
			const markerPath = join(cwd, `${runtime}-entered`);
			const pending = registry.exec("controller", { sessionId: active.sessionId, code: activeCode(runtime, markerPath), timeoutMs: 5_000 });
			await waitFor(() => existsSync(markerPath), `${runtime} active execution entry`);

			const interrupted = await registry.interrupt("controller", { sessionId: active.sessionId });
			assert.equal(interrupted.status, "ok");
			const result = await pending;
			assert.equal(result.status, runtime === "python" ? "interrupted" : "failed");
			await waitFor(() => registry.list("controller").sessions.find((session) => session.sessionId === active.sessionId)?.status !== "busy", `${runtime} interrupt settlement`);

			const repeated = await registry.interrupt("controller", { sessionId: active.sessionId });
			assert.equal(repeated.status, runtime === "python" ? "ok" : "failed");
			if (runtime === "python") assert.match(repeated.message, /idle|no active execution/i);

			const unaffectedExec = await registry.exec("controller", { sessionId: unaffected.sessionId, code: assignCode(otherRuntime, "unaffected", 1) });
			assert.equal(unaffectedExec.status, "ok");
			assert.equal(registry.list("controller").sessions.find((session) => session.sessionId === unaffected.sessionId).status, "idle");

			const implicit = await registry.exec("controller", { runtime, code: assignCode(runtime, "recovered", 1) });
			assert.equal(implicit.status, "ok");
			if (runtime === "python") assert.equal(implicit.sessionId, active.sessionId);
			else assert.notEqual(implicit.sessionId, active.sessionId);
		});
	});

	runtimeTest(runtime, "dead workers reconcile through vars and list before explicit or implicit routing", async () => {
		await withRegistry(async (registry) => {
			const first = await registry.start("controller", { runtime });
			assert.equal(first.status, "ok");
			process.kill(first.pid, "SIGKILL");

			const variables = await registry.vars("controller", { sessionId: first.sessionId });
			assert.equal(variables.status, "failed");
			assert.equal(registry.list("controller").sessions.find((session) => session.sessionId === first.sessionId).status, "failed");
			const implicit = await registry.exec("controller", { runtime, code: assignCode(runtime, "replacement", 1) });
			assert.equal(implicit.status, "ok");
			assert.notEqual(implicit.sessionId, first.sessionId);

			const replacement = registry.list("controller").sessions.find((session) => session.sessionId === implicit.sessionId);
			process.kill(replacement.pid, "SIGKILL");
			await waitFor(() => !processAlive(replacement.pid), `${runtime} replacement process exit`);
			assert.equal(registry.list("controller").sessions.find((session) => session.sessionId === replacement.sessionId).status, "failed");
			const explicit = await registry.exec("controller", { sessionId: replacement.sessionId, code: assignCode(runtime, "never", 1) });
			assert.equal(explicit.status, "not_found");
			const recreated = await registry.exec("controller", { runtime, code: assignCode(runtime, "recreated", 1) });
			assert.equal(recreated.status, "ok");
			assert.notEqual(recreated.sessionId, replacement.sessionId);
		});
	});
}
