import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatWorkflowSessionService } from "../dist/apps/chat/data/workflow-session-service.js";

const definition = { id: "workflow.review", version: "1.0.0", nodes: { agent: { kind: "agent", promptTemplate: "Review {{input}}" } }, edges: {} };
const configuration = {
	inputValues: { topic: "Review" }, promptOverrides: { agent: "Review {{input}}" }, promptOverrideEligibleNodeIds: ["agent"],
	overrideScopes: { promptOverrides: "eligible_agent_node", model: "workflow", thinkingLevel: "workflow", fastMode: "workflow" },
	model: { provider: "openai", id: "fixture-model" }, thinkingLevel: "low", fastMode: false,
};
function snapshotFor(id) {
	return {
		id: `wfs_${id}`, schemaVersion: 1, createdAt: "2026-05-12T00:00:00.000Z", createdBy: "fixture", piboSessionId: id,
		workflow: { id: definition.id, version: definition.version, source: "ui", title: "Review", tags: [], baseDefinitionHash: "sha256:base", effectiveDefinitionHash: "sha256:effective" },
		baseDefinition: definition, effectiveDefinition: definition, inputValues: configuration.inputValues, promptOverrides: configuration.promptOverrides,
		overridePolicy: { promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate", eligiblePromptNodeIds: ["agent"], modelScope: "workflow", thinkingLevelScope: "workflow", fastModeScope: "workflow" },
		promptAssetPins: [], validation: { trigger: "before_workflow_session_creation", ok: true },
		deletedDefinitionFallback: { workflowId: definition.id, workflowVersion: definition.version, effectiveDefinitionHash: "sha256:effective" },
	};
}
function configure(service, id = "ps_root") {
	service.addWorkflowSession({ piboSessionId: id, workflowId: definition.id, workflowVersion: definition.version, configuration, state: "configured" });
	return service.saveWorkflowSessionSnapshot(snapshotFor(id));
}
function start(service, id = "ps_root", runId = `wfr_${id}`) {
	const snapshot = service.getWorkflowSessionSnapshotForSession(id);
	return service.startWorkflowSessionRun({ piboSessionId: id, runId, workflowId: definition.id, workflowVersion: definition.version, snapshotId: snapshot.id, effectiveDefinitionHash: snapshot.workflow.effectiveDefinitionHash, current: { status: "pending", initialNodeIds: ["agent"] }, inputValues: configuration.inputValues });
}
function wait(service, id, expiresAt, piboSessionId = "ps_root") {
	return service.saveWorkflowWaitToken({ id, piboSessionId, workflowRunId: "wfr_ps_root", actions: [{ id: "approve", kind: "approve" }, { id: "cancel", kind: "cancel" }], prompt: `Review ${id}`, status: "pending", createdAt: "2026-01-01T00:00:00.000Z", ...(expiresAt ? { expiresAt } : {}) });
}
function withStore(fn) {
	const root = mkdtempSync(join(tmpdir(), "pibo-workflow-session-"));
	const path = join(root, "pibo-workflows.sqlite");
	const service = new ChatWorkflowSessionService(path);
	try { return fn(service, path); } finally { service.close(); rmSync(root, { recursive: true, force: true }); }
}

test("Workflow Sessions persist immutable selection/configuration without starting", () => withStore((service) => {
	configure(service);
	const linked = service.getWorkflowSession("ps_root");
	assert.equal(linked.state, "configured");
	assert.equal(linked.workflowRunId, undefined);
	assert.deepEqual(linked.configuration, configuration);
	assert.equal(service.listWorkflowRuns().length, 0);
	assert.throws(() => service.addWorkflowSession({ piboSessionId: "ps_root", workflowId: "other", workflowVersion: "1.0.0" }), /selection is immutable/i);
	assert.throws(() => service.addWorkflowSession({ piboSessionId: "ps_root", workflowId: definition.id, workflowVersion: "2.0.0" }), /selection is immutable/i);
	assert.throws(() => service.addWorkflowSession({ piboSessionId: "ps_root", workflowId: definition.id, configuration: { ...configuration, inputValues: { changed: true } } }), /configuration is immutable/i);
	assert.throws(() => service.addWorkflowSession({ piboSessionId: "ps_invalid", workflowId: definition.id, state: "paused" }), /unsupported.*state/i);
}));

test("Session snapshots are immutable and survive reopening", () => withStore((service, path) => {
	const snapshot = configure(service);
	assert.deepEqual(service.getWorkflowSessionSnapshot(snapshot.id), snapshot);
	assert.deepEqual(service.saveWorkflowSessionSnapshot(snapshot), snapshot);
	assert.throws(() => service.saveWorkflowSessionSnapshot({ ...snapshot, inputValues: { changed: true } }), /immutable/i);
	assert.throws(() => service.saveWorkflowSessionSnapshot({ ...snapshot, id: "wfs_duplicate" }), /already has a configuration snapshot/i);
	const reopened = new ChatWorkflowSessionService(path);
	try { assert.deepEqual(reopened.getWorkflowSessionSnapshotForSession("ps_root"), snapshot); } finally { reopened.close(); }
}));

test("two configured Sessions can share an executable definition without sharing configuration identity", () => withStore((service) => {
	const first = configure(service, "ps_first");
	const second = configure(service, "ps_second");
	assert.notEqual(first.id, second.id);
	const left = start(service, "ps_first");
	const right = start(service, "ps_second");
	assert.notEqual(left.run.id, right.run.id);
	assert.equal(left.run.snapshotId, first.id);
	assert.equal(right.run.snapshotId, second.id);
	assert.equal(service.runtimeStore.listDefinitionSnapshots().length, 1);
}));

test("start is transactional and idempotent across service instances", () => withStore((service, path) => {
	configure(service);
	const first = start(service);
	assert.equal(first.alreadyStarted, false);
	assert.equal(first.workflowSession.state, "pending");
	assert.equal(first.run.status, "pending", "recording a run does not pretend an executor started");
	assert.deepEqual(first.run.current.initialNodeIds, ["agent"]);
	const reopened = new ChatWorkflowSessionService(path);
	try {
		const second = start(reopened, "ps_root", "wfr_second_attempt");
		assert.equal(second.alreadyStarted, true);
		assert.equal(second.run.id, first.run.id);
		assert.equal(reopened.listWorkflowRuns({ piboSessionId: "ps_root" }).length, 1);
		assert.equal(reopened.runtimeStore.getRun(first.run.id).piboSessionId, "ps_root");
	} finally { reopened.close(); }
}));

test("root, agent and nested Sessions can link to one canonical Workflow run", () => withStore((service) => {
	configure(service); const { run } = start(service);
	for (const piboSessionId of ["ps_agent", "ps_nested"]) {
		service.addWorkflowSession({ piboSessionId, workflowId: definition.id, workflowVersion: definition.version, workflowRunId: run.id });
		assert.equal(service.getWorkflowRunForSession(piboSessionId).id, run.id);
	}
	assert.equal(service.runtimeStore.listRuns().length, 1);
}));

test("expiry preserves actionable waits and durably fails runs whose waits are exhausted", () => withStore((service, path) => {
	configure(service); start(service);
	wait(service, "wwt_expired", "2026-02-01T00:00:00.000Z");
	wait(service, "wwt_also_expired", "2026-03-01T00:00:00.000Z");
	wait(service, "wwt_live", "2099-01-01T00:00:00.000Z");
	assert.throws(() => service.resolveWorkflowHumanAction({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_expired", actionId: "approve", kind: "approve", actedAt: "2026-09-02T00:00:00.000Z" }), /expired at 2026-02-01/);
	assert.equal(service.getWorkflowWaitToken("wwt_also_expired").status, "expired");
	assert.equal(service.getWorkflowRun("wfr_ps_root").status, "waiting");
	assert.deepEqual(service.listWorkflowWaitTokens({ workflowRunId: "wfr_ps_root", status: "pending" }).map((entry) => entry.id), ["wwt_live"]);
	assert.throws(() => service.expireWorkflowWaitToken({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_live", resolvedAt: "invalid" }), /invalid/i);
	const result = service.expireWorkflowWaitToken({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_live", resolvedAt: "2100-01-01T00:00:00.000Z" });
	assert.equal(result.run.status, "failed");
	assert.equal(result.run.failedAt, "2100-01-01T00:00:00.000Z");
	const reopened = new ChatWorkflowSessionService(path);
	try { assert.equal(reopened.getWorkflowSession("ps_root").state, "failed"); } finally { reopened.close(); }
}));

test("human actions are run-linked, transactional, auditable and single-use", () => withStore((service) => {
	configure(service); start(service); wait(service, "wwt_review");
	assert.throws(() => service.resolveWorkflowHumanAction({ piboSessionId: "ps_other", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_review", actionId: "approve", kind: "approve" }), /belong/i);
	assert.throws(() => service.resolveWorkflowHumanAction({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_review", actionId: "missing", kind: "approve" }), /offer/i);
	const result = service.resolveWorkflowHumanAction({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_review", actionId: "approve", kind: "approve", payload: null, actionRecordId: "wha_record" });
	assert.equal(result.waitToken.status, "resumed");
	assert.equal(result.action.payload, null);
	assert.equal(service.runtimeStore.listHumanActions().length, 1);
	assert.throws(() => service.resolveWorkflowHumanAction({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_review", actionId: "approve", kind: "approve" }), /cannot be resolved again/i);
	wait(service, "wwt_second");
	assert.throws(() => service.resolveWorkflowHumanAction({ piboSessionId: "ps_root", workflowRunId: "wfr_ps_root", waitTokenId: "wwt_second", actionId: "approve", kind: "approve", actionRecordId: "wha_record" }), /already exists|immutable|unique/i);
	assert.equal(service.getWorkflowWaitToken("wwt_second").status, "pending");
	assert.equal(service.listWorkflowHumanActions()[0].waitTokenId, "wwt_review");
}));

test("inspection accepts canonical editor and kernel runs without inventing configuration snapshots", () => withStore((service) => {
	service.runtimeStore.saveRun({ id: "wfr_editor", workflowId: definition.id, workflowVersion: definition.version, piboSessionId: "ps_agent", status: "completed", current: { status: "completed" }, input: "a text trigger", output: "actual output", state: { global: {} }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:01.000Z" });
	assert.equal(service.getWorkflowRunForSession("ps_agent").output, "actual output");
	assert.equal(service.listWorkflowRuns()[0].input, "a text trigger");
	assert.equal(service.getWorkflowSessionSnapshotForSession("ps_agent"), undefined);
}));
