import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboPluginRegistry, definePiboPlugin } from "../dist/plugins/registry.js";
import { PiboRalphService } from "../dist/ralph/service.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { createBuiltInRalphStopConditions, evaluateRalphStopPolicy, PROMISE_COMPLETE_STOP_TOKEN } from "../dist/ralph/stopping.js";
import { createPiboSession } from "../dist/sessions/store.js";

test("plugin registry exposes registered Ralph stop conditions", () => {
	const registry = PiboPluginRegistry.create({ plugins: [definePiboPlugin({ id: "test.conditions", register(api) { api.registerRalphStopCondition({ type: "test.stop", name: "Test stop", phases: ["after-run"], evaluate: () => ({ action: "stop-after-run", reason: "test" }) }); } })] });
	const infos = registry.getRalphStopConditionInfos();
	assert.equal(infos.length, 1);
	assert.equal(infos[0].type, "test.stop");
	assert.equal(infos[0].pluginId, "test.conditions");
	assert.equal(registry.getCapabilityCatalog().ralphStopConditions[0].type, "test.stop");
});

test("Ralph store persists stop policies, state, and run facts", () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const stopPolicy = { mode: "any", conditions: [{ id: "fact", type: "pibo.ralph.fact-count", options: { factType: "git.commit.created" } }] };
		const job = store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "work", stopPolicy });
		assert.deepEqual(store.getJob(job.id).stopPolicy, stopPolicy);
		const fact = store.appendRunFact({ ownerScope: "user:a", jobId: job.id, runId: "rrun_1", type: "git.commit.created", source: "plugin", payload: { sha: "abc" } });
		assert.equal(fact.type, "git.commit.created");
		assert.equal(store.createFactReader(job).count({ type: "git.commit.created", runId: "rrun_1" }), 1);
		const cleared = store.updateJob("user:a", job.id, { stopPolicy: null });
		assert.equal(cleared.stopPolicy, undefined);
	} finally { store.close(); }
});

test("Ralph stop evaluator composes any, all, and stateful custom conditions", async () => {
	const definitions = [{ type: "test.counter", name: "Counter", phases: ["after-run"], evaluate(context) { const count = Number(context.state.count ?? 0) + 1; return { action: count >= 2 ? "stop-after-run" : "continue", reason: count >= 2 ? "counter" : undefined, nextState: { count } }; } }];
	const job = { id: "ralph_1", ownerScope: "user:a", name: "job", enabled: true, target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "work", stopPolicy: { mode: "any", conditions: [{ id: "counter", type: "test.counter" }] }, state: { completedIterations: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	const facts = { list: () => [], count: () => 0 };
	const first = await evaluateRalphStopPolicy({ job, phase: "after-run", definitions, facts });
	assert.equal(first.evaluation.finalAction, "continue");
	assert.deepEqual(first.conditionStates.counter, { count: 1 });
	const second = await evaluateRalphStopPolicy({ job: { ...job, state: { ...job.state, conditionStates: first.conditionStates } }, phase: "after-run", definitions, facts });
	assert.equal(second.evaluation.finalAction, "stop-after-run");
	assert.equal(second.evaluation.reason, "counter");
	const all = await evaluateRalphStopPolicy({ job: { ...job, stopPolicy: { mode: "all", conditions: [{ id: "counter", type: "test.counter" }, { id: "missing", type: "missing.type" }] } }, phase: "after-run", definitions, facts });
	assert.equal(all.evaluation.finalAction, "continue");
});

test("Ralph max-iterations counts completed run attempts regardless of outcome", async () => {
	const store = new PiboRalphStore({ path: ":memory:" });
	try {
		const job = store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "work", enabled: true, maxIterations: 1 });
		const reserved = store.reserveRun("user:a", job.id);
		assert.ok(reserved);

		store.completeRun({ jobId: job.id, runId: reserved.run.id, status: "error", error: "failed" });

		const saved = store.getJob(job.id);
		assert.equal(saved.enabled, false);
		assert.equal(saved.state.completedIterations, 1);
		assert.equal(saved.state.lastStatus, "error");
	} finally { store.close(); }
});

test("Ralph max-iterations stop condition counts failed after-run outcomes", async () => {
	const job = { id: "ralph_1", ownerScope: "user:a", name: "job", enabled: true, target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "work", maxIterations: 1, state: { completedIterations: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
	const facts = { list: () => [], count: () => 0 };
	const result = await evaluateRalphStopPolicy({
		job,
		phase: "after-run",
		definitions: createBuiltInRalphStopConditions(),
		facts,
		outcome: { status: "error", error: "failed" },
	});

	assert.equal(result.evaluation.finalAction, "stop-after-run");
	assert.equal(result.evaluation.reason, "max-iterations");
	assert.deepEqual(result.evaluation.decisions.find((decision) => decision.id === "max-iterations").details, { maxIterations: 1, completedIterations: 1 });
});

test("Ralph service preserves promise-complete and max-iteration stop behavior through conditions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pibo-ralph-stop-"));
	const store = new PiboRalphStore({ path: ":memory:" });
	const listeners = new Set();
	const context = {
		async emit(event) {
			if (event.type === "message") queueMicrotask(() => { for (const listener of listeners) { listener({ type: "assistant_message", piboSessionId: event.piboSessionId, eventId: event.id, text: `done ${PROMISE_COMPLETE_STOP_TOKEN}` }); listener({ type: "message_finished", piboSessionId: event.piboSessionId, eventId: event.id }); } });
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id ?? "evt", action: "test", result: {} };
		},
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		createSession(input) { return createPiboSession({ ...input, id: `ps_${Date.now()}` }); },
		getSession() { return undefined; }, findSessions() { return []; }, getGatewayActions() { return []; }, getWebApps() { return []; },
		getRalphStopConditionDefinitions() { return createBuiltInRalphStopConditions(); },
	};
	const service = new PiboRalphService({ store, context, dataStorePath: join(dir, "data.sqlite"), dataPayloadRootDir: join(dir, "payloads"), runTimeoutMs: 5_000 });
	try {
		const job = store.createJob({ ownerScope: "user:a", target: { kind: "personal", principalId: "user:a" }, profile: "codex", prompt: "work", maxIterations: 5 });
		const run = await service.startJob("user:a", job.id);
		assert.ok(run);
		await waitFor(() => store.getJob(job.id).state.lastStatus === "ok");
		const saved = store.getJob(job.id);
		assert.equal(saved.enabled, false);
		assert.equal(saved.state.lastStopEvaluation.reason, "promise-complete");
		assert.equal(store.listRuns({ jobId: job.id })[0].reason, "promise-complete");
	} finally { service.stop(); await rm(dir, { recursive: true, force: true }); }
});

async function waitFor(predicate, timeoutMs = 1_000) {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
