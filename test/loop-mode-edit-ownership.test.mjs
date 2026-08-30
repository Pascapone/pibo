import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { handleChatLoopApiRequest } from "../dist/apps/chat/loop-api.js";
import { PiboLoopStore } from "../dist/loops/store.js";
import { PiboWebHttpError } from "../dist/web/http.js";

const activeModeError = /mode cannot be changed while a Loop run is active/;

function createJob(store, input = {}) {
	return store.createJob({
		mode: "goal",
		enabled: true,
		target: { kind: "default-chat" },
		profile: "base",
		prompt: "Keep working on the objective.",
		...input,
	});
}

function apiOptions(loopStore, request) {
	return {
		request,
		loopStore,
		defaultProfile: "base",
		webSession: { user: { id: "test" } },
		context: { channelContext: { getProfiles: () => [{ name: "base", aliases: [] }], getLoopStopConditionInfos: () => [] } },
		roomService: {
			getRoom: () => undefined,
			listRoomTree: () => [],
			requireRoom: () => { throw new Error("not used"); },
			ensureDefaultRoom: () => ({ id: "room_default", name: "Shared Chat", type: "chat", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {} }),
		},
	};
}

test("active mode edits are rejected across CLI, API, and SQLite reopen", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-mode-active-"));
	const path = join(dir, "loops.sqlite");
	let store = new PiboLoopStore({ path });
	try {
		const job = createJob(store);
		const reserved = store.reserveRun(job.id, new Date("2026-08-30T10:00:00.000Z"));
		assert.ok(reserved);

		assert.throws(() => store.updateJob(job.id, { mode: "ralph" }), activeModeError);
		const afterStoreEdit = store.getJob(job.id);
		assert.equal(afterStoreEdit?.mode, "goal");
		assert.equal(afterStoreEdit?.state.runningAt, reserved.job.state.runningAt);
		assert.equal(afterStoreEdit?.state.lastRunId, reserved.run.id);

		const ralph = createJob(store, { mode: "ralph" });
		const ralphRun = store.reserveRun(ralph.id, new Date("2026-08-30T10:00:30.000Z"));
		assert.ok(ralphRun);
		assert.throws(() => store.updateJob(ralph.id, { mode: "goal" }), activeModeError);
		assert.equal(store.getJob(ralph.id)?.state.lastRunId, ralphRun.run.id);

		const apiRequest = new Request(`http://localhost/api/chat/loops/jobs/${job.id}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", origin: "http://localhost" },
			body: JSON.stringify({ mode: "ralph" }),
		});
		await assert.rejects(
			handleChatLoopApiRequest(apiOptions(store, apiRequest)),
			(error) => error instanceof PiboWebHttpError && error.statusCode === 409 && activeModeError.test(error.message),
		);

		const cli = spawnSync(process.execPath, ["dist/bin/pibo.js", "loop", "--store", path, "edit", job.id, "--mode", "ralph", "--json"], { encoding: "utf8" });
		assert.notEqual(cli.status, 0);
		assert.match(cli.stderr, activeModeError);

		store.close();
		store = new PiboLoopStore({ path });
		const reopened = store.getJob(job.id);
		assert.equal(reopened?.mode, "goal");
		assert.equal(reopened?.state.runningAt, reserved.job.state.runningAt);
		assert.equal(reopened?.state.lastRunId, reserved.run.id);
		assert.equal(store.reserveRun(job.id), undefined);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("idle mode edits and active non-mode edits preserve their lifecycle invariants", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const idle = createJob(store, { enabled: false });
		assert.equal(store.updateJob(idle.id, { mode: "ralph" })?.mode, "ralph");
		const returned = store.updateJob(idle.id, { mode: "goal" });
		assert.equal(returned?.mode, "goal");
		assert.equal(returned?.state.runningAt, undefined);

		const active = createJob(store);
		const reserved = store.reserveRun(active.id, new Date("2026-08-30T11:00:00.000Z"));
		assert.ok(reserved);
		const edited = store.updateJob(active.id, { name: "Updated while active", prompt: "Continue safely." });
		assert.equal(edited?.name, "Updated while active");
		assert.equal(edited?.state.runningAt, reserved.job.state.runningAt);
		assert.equal(edited?.state.lastRunId, reserved.run.id);
		assert.equal(store.reserveRun(active.id), undefined);
	} finally {
		store.close();
	}
});

test("the owning completion permits a later sequential mode change and run", () => {
	const store = new PiboLoopStore({ path: ":memory:" });
	try {
		const job = createJob(store);
		const first = store.reserveRun(job.id, new Date("2026-08-30T12:00:00.000Z"));
		assert.ok(first);
		store.completeRun({ jobId: job.id, runId: first.run.id, status: "ok" }, new Date("2026-08-30T12:01:00.000Z"));
		assert.equal(store.updateJob(job.id, { mode: "ralph" })?.mode, "ralph");
		const second = store.reserveRun(job.id, new Date("2026-08-30T12:02:00.000Z"));
		assert.ok(second);
		store.completeRun({ jobId: job.id, runId: second.run.id, status: "ok" }, new Date("2026-08-30T12:03:00.000Z"));
		assert.equal(store.getJob(job.id)?.state.runningAt, undefined);
		assert.equal(store.getJob(job.id)?.state.lastRunId, second.run.id);
		assert.equal(store.getJob(job.id)?.state.completedIterations, 2);
	} finally {
		store.close();
	}
});

test("a stale completion cannot erase a newer reservation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-stale-completion-"));
	const path = join(dir, "loops.sqlite");
	let store = new PiboLoopStore({ path });
	try {
		const job = createJob(store);
		const first = store.reserveRun(job.id, new Date("2026-08-30T13:00:00.000Z"));
		assert.ok(first);
		store.close();

		const db = new DatabaseSync(path);
		const row = db.prepare("SELECT state_json FROM pibo_ralph_jobs WHERE id = ?").get(job.id);
		const corrupted = JSON.parse(row.state_json);
		delete corrupted.runningAt;
		delete corrupted.lastRunId;
		db.prepare("UPDATE pibo_ralph_jobs SET state_json = ? WHERE id = ?").run(JSON.stringify(corrupted), job.id);
		db.close();

		store = new PiboLoopStore({ path });
		const second = store.reserveRun(job.id, new Date("2026-08-30T13:01:00.000Z"));
		assert.ok(second);
		store.completeRun({ jobId: job.id, runId: first.run.id, status: "ok" }, new Date("2026-08-30T13:02:00.000Z"));

		const afterStale = store.getJob(job.id);
		assert.equal(store.getRun(first.run.id)?.status, "ok");
		assert.equal(afterStale?.state.runningAt, second.job.state.runningAt);
		assert.equal(afterStale?.state.lastRunId, second.run.id);
		assert.equal(store.reserveRun(job.id), undefined);
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("concurrent mode edit and trigger serialize without losing the active reservation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-loop-mode-race-"));
	const path = join(dir, "loops.sqlite");
	const store = new PiboLoopStore({ path });
	try {
		const job = createJob(store);
		const moduleUrl = pathToFileURL(join(process.cwd(), "dist/loops/store.js")).href;
		const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
		const workers = ["edit", "reserve"].map((action) => new Worker(`
			const { parentPort, workerData } = require("node:worker_threads");
			(async () => {
				const { PiboLoopStore } = await import(workerData.moduleUrl);
				const gate = new Int32Array(workerData.gate);
				Atomics.add(gate, 0, 1);
				Atomics.notify(gate, 0);
				Atomics.wait(gate, 1, 0);
				const store = new PiboLoopStore({ path: workerData.path });
				try {
					const result = workerData.action === "edit"
						? store.updateJob(workerData.jobId, { mode: "ralph" })
						: store.reserveRun(workerData.jobId);
					parentPort.postMessage({ action: workerData.action, ok: true, mode: result?.mode ?? result?.job?.mode, runId: result?.run?.id });
				} catch (error) {
					parentPort.postMessage({ action: workerData.action, ok: false, error: error.message });
				} finally { store.close(); }
			})();
		`, { eval: true, workerData: { action, gate, jobId: job.id, moduleUrl, path } }));
		const ready = new Int32Array(gate);
		while (Atomics.load(ready, 0) < 2) Atomics.wait(ready, 0, Atomics.load(ready, 0), 100);
		Atomics.store(ready, 1, 1);
		Atomics.notify(ready, 1, 2);
		const results = await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
			worker.once("message", resolve);
			worker.once("error", reject);
		})));

		const finalJob = store.getJob(job.id);
		const runs = store.listRuns({ jobId: job.id });
		assert.equal(runs.length, 1);
		assert.equal(runs[0].status, "running");
		assert.equal(finalJob?.state.lastRunId, runs[0].id);
		assert.ok(finalJob?.state.runningAt);
		assert.equal(store.reserveRun(job.id), undefined);
		const edit = results.find((result) => result.action === "edit");
		assert.ok(edit.ok || activeModeError.test(edit.error));
		assert.equal(finalJob?.mode, edit.ok ? "ralph" : "goal");
	} finally {
		store.close();
		await rm(dir, { recursive: true, force: true });
	}
});
