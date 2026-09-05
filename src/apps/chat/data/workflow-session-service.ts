import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { WorkflowDefinition, WorkflowHumanActionRecord, WorkflowRun, WorkflowWaitToken } from "@pasko70/pibo-workflows";
import { SqliteWorkflowRunStore } from "@pasko70/pibo-workflows";
import { piboHomePath } from "../../../core/pibo-home.js";
import type { PiboJsonObject, PiboJsonValue } from "../../../core/events.js";
import type {
	PiboWorkflowHumanActionKind,
	PiboWorkflowHumanActionRecord,
	PiboWorkflowRun,
	PiboWorkflowRunStatus,
	PiboWorkflowSessionConfiguration,
	PiboWorkflowSessionLink,
	PiboWorkflowSessionSnapshot,
	PiboWorkflowSessionState,
	PiboWorkflowWaitToken,
	PiboWorkflowWaitTokenStatus,
	ResolveWorkflowHumanActionResult,
	StartWorkflowRunResult,
} from "./workflow-session-model.js";

export type * from "./workflow-session-model.js";

export class ChatWorkflowSessionService {
	readonly path: string;
	readonly runtimeStore: SqliteWorkflowRunStore;
	readonly catalogDataStore: Pick<SqliteWorkflowRunStore, "db" | "transaction">;

	constructor(path = piboHomePath("pibo-workflows.sqlite")) {
		this.path = path === ":memory:" ? path : resolve(path);
		this.runtimeStore = new SqliteWorkflowRunStore(this.path);
		this.catalogDataStore = this.runtimeStore;
	}

	close(): void { this.runtimeStore.close(); }

	getWorkflowSession(piboSessionId: string): PiboWorkflowSessionLink | undefined {
		const row = this.runtimeStore.db.prepare("SELECT * FROM workflow_session_links WHERE pibo_session_id = ?").get(piboSessionId) as WorkflowSessionLinkRow | undefined;
		if (!row) {
			const run = this.runtimeStore.listRuns({ piboSessionId, limit: 1 })[0];
			return run ? { piboSessionId, workflowId: run.workflowId, workflowVersion: run.workflowVersion, workflowRunId: run.id, state: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt } : undefined;
		}
		const run = row.workflow_run_id ? this.runtimeStore.getRun(row.workflow_run_id) : undefined;
		return workflowSessionFromRow(row, run?.status);
	}

	addWorkflowSession(input: {
		piboSessionId: string;
		workflowId: string;
		workflowVersion?: string;
		workflowRunId?: string;
		state?: PiboWorkflowSessionState;
		configuration?: PiboWorkflowSessionConfiguration;
	}): PiboWorkflowSessionLink {
		if (input.state && !["configured", "pending", "running", "waiting", "completed", "failed", "cancelled"].includes(input.state)) throw new Error(`Unsupported Workflow session state '${input.state}'`);
		const existing = this.getWorkflowSession(input.piboSessionId);
		const workflowVersion = input.workflowVersion ?? existing?.workflowVersion;
		const workflowRunId = input.workflowRunId ?? existing?.workflowRunId;
		const configuration = input.configuration ?? existing?.configuration;
		if (existing) assertImmutableWorkflowSelection(existing, { ...input, workflowVersion, workflowRunId, configuration });
		if (workflowRunId) {
			const run = this.runtimeStore.getRun(workflowRunId);
			if (run && (run.workflowId !== input.workflowId || run.workflowVersion !== workflowVersion)) {
				throw new Error("Workflow run linkage conflicts with the workflow session");
			}
		}
		const now = new Date().toISOString();
		this.runtimeStore.db.prepare(`INSERT INTO workflow_session_links (
			pibo_session_id, workflow_id, workflow_version, workflow_run_id, state, configuration_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pibo_session_id) DO UPDATE SET
			workflow_id = excluded.workflow_id,
			workflow_version = excluded.workflow_version,
			workflow_run_id = excluded.workflow_run_id,
			state = excluded.state,
			configuration_json = excluded.configuration_json,
			updated_at = excluded.updated_at`).run(
			input.piboSessionId,
			input.workflowId,
			workflowVersion ?? null,
			workflowRunId ?? null,
			input.state ?? existing?.state ?? "configured",
			configuration ? JSON.stringify(configuration) : null,
			existing?.createdAt ?? now,
			now,
		);
		return this.getWorkflowSession(input.piboSessionId)!;
	}

	saveWorkflowSessionSnapshot(snapshot: PiboWorkflowSessionSnapshot): PiboWorkflowSessionSnapshot {
		return this.runtimeStore.transaction(() => {
			const link = this.getWorkflowSession(snapshot.piboSessionId);
			if (!link) throw new Error("Workflow session not found");
			if (link.workflowId !== snapshot.workflow.id || (link.workflowVersion && link.workflowVersion !== snapshot.workflow.version)) {
				throw new Error("Workflow session snapshot does not match selected workflow");
			}
			const existing = this.getWorkflowSessionSnapshot(snapshot.id);
			if (existing) {
				if (canonicalJson(existing) !== canonicalJson(snapshot)) throw new Error("Workflow session snapshots are immutable");
				return existing;
			}
			const existingForSession = this.getWorkflowSessionSnapshotForSession(snapshot.piboSessionId);
			if (existingForSession) throw new Error(`Workflow session '${snapshot.piboSessionId}' already has a configuration snapshot`);
			const definitionSnapshot = this.runtimeStore.listDefinitionSnapshots({ workflowId: snapshot.workflow.id, workflowVersion: snapshot.workflow.version, hash: snapshot.workflow.effectiveDefinitionHash, limit: 1 })[0];
			if (definitionSnapshot && canonicalJson(definitionSnapshot.definition) !== canonicalJson(snapshot.effectiveDefinition)) {
				throw new Error("Executable Workflow definition snapshot conflicts with the session snapshot");
			}
			if (!definitionSnapshot) this.runtimeStore.saveDefinitionSnapshot({
				id: snapshot.id,
				workflowId: snapshot.workflow.id,
				workflowVersion: snapshot.workflow.version,
				hash: snapshot.workflow.effectiveDefinitionHash,
				definition: snapshot.effectiveDefinition as unknown as WorkflowDefinition,
				createdAt: snapshot.createdAt,
			});
			this.runtimeStore.db.prepare(`INSERT INTO workflow_session_snapshots (
				id, pibo_session_id, workflow_id, workflow_version, base_definition_hash, effective_definition_hash, snapshot_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
				snapshot.id, snapshot.piboSessionId, snapshot.workflow.id, snapshot.workflow.version,
				snapshot.workflow.baseDefinitionHash, snapshot.workflow.effectiveDefinitionHash,
				JSON.stringify(snapshot), snapshot.createdAt,
			);
			return snapshot;
		});
	}

	getWorkflowSessionSnapshot(id: string): PiboWorkflowSessionSnapshot | undefined {
		const row = this.runtimeStore.db.prepare("SELECT * FROM workflow_session_snapshots WHERE id = ?").get(id) as WorkflowSessionSnapshotRow | undefined;
		return row ? workflowSessionSnapshotFromRow(row) : undefined;
	}

	getWorkflowSessionSnapshotForSession(piboSessionId: string): PiboWorkflowSessionSnapshot | undefined {
		const row = this.runtimeStore.db.prepare("SELECT * FROM workflow_session_snapshots WHERE pibo_session_id = ?").get(piboSessionId) as WorkflowSessionSnapshotRow | undefined;
		return row ? workflowSessionSnapshotFromRow(row) : undefined;
	}

	startWorkflowSessionRun(input: {
		piboSessionId: string;
		runId: string;
		workflowId: string;
		workflowVersion: string;
		snapshotId: string;
		effectiveDefinitionHash: string;
		current: PiboJsonObject;
		inputValues: PiboJsonObject;
		validation?: PiboJsonObject;
	}): StartWorkflowRunResult {
		return this.runtimeStore.transaction(() => {
			const link = this.getWorkflowSession(input.piboSessionId);
			if (!link) throw new Error("Workflow session not found");
			if (link.workflowId !== input.workflowId || link.workflowVersion !== input.workflowVersion) throw new Error("Workflow session selection is immutable");
			const snapshot = this.getWorkflowSessionSnapshot(input.snapshotId);
			if (!snapshot || snapshot.piboSessionId !== input.piboSessionId) throw new Error("Workflow session snapshot not found");
			if (snapshot.workflow.id !== input.workflowId || snapshot.workflow.version !== input.workflowVersion || snapshot.workflow.effectiveDefinitionHash !== input.effectiveDefinitionHash) {
				throw new Error("Workflow session snapshot does not match selected workflow");
			}
			if (link.workflowRunId) {
				const existingRun = this.getWorkflowRun(link.workflowRunId);
				if (!existingRun) throw new Error("Workflow session references a missing Workflow run");
				return { workflowSession: this.getWorkflowSession(input.piboSessionId)!, run: existingRun, alreadyStarted: true };
			}
			if (this.runtimeStore.getRun(input.runId)) throw new Error(`Workflow run '${input.runId}' already exists`);
			const definitionSnapshot = this.runtimeStore.listDefinitionSnapshots({ workflowId: input.workflowId, workflowVersion: input.workflowVersion, hash: input.effectiveDefinitionHash, limit: 1 })[0];
			if (!definitionSnapshot) throw new Error("Executable Workflow definition snapshot not found");
			const now = new Date().toISOString();
			const run: WorkflowRun = {
				id: input.runId,
				workflowId: input.workflowId,
				workflowVersion: input.workflowVersion,
				workflowDefinitionHash: input.effectiveDefinitionHash,
				definitionSnapshotId: definitionSnapshot.id,
				piboSessionId: input.piboSessionId,
				status: "running",
				current: input.current,
				input: input.inputValues,
				state: { global: {} },
				...(input.validation ? { validation: input.validation } : {}),
				createdAt: now,
				updatedAt: now,
			};
			this.runtimeStore.saveRun(run);
			this.runtimeStore.db.prepare("UPDATE workflow_session_links SET workflow_run_id = ?, state = 'running', updated_at = ? WHERE pibo_session_id = ? AND workflow_run_id IS NULL")
				.run(run.id, now, input.piboSessionId);
			return { workflowSession: this.getWorkflowSession(input.piboSessionId)!, run: workflowRunToPublic(run, snapshot.id), alreadyStarted: false };
		});
	}

	getWorkflowRun(runId: string): PiboWorkflowRun | undefined {
		const run = this.runtimeStore.getRun(runId);
		return run ? workflowRunToPublic(run, run.piboSessionId ? this.getWorkflowSessionSnapshotForSession(run.piboSessionId)?.id : undefined) : undefined;
	}

	getWorkflowRunForSession(piboSessionId: string): PiboWorkflowRun | undefined {
		const link = this.getWorkflowSession(piboSessionId);
		if (link?.workflowRunId) return this.getWorkflowRun(link.workflowRunId);
		const runs = this.runtimeStore.listRuns({ piboSessionId, limit: 2 });
		if (runs.length > 1) throw new Error(`Workflow session '${piboSessionId}' has multiple root runs`);
		return runs[0] ? this.getWorkflowRun(runs[0].id) : undefined;
	}

	listWorkflowRuns(filter: { piboSessionId?: string; workflowId?: string; status?: PiboWorkflowRunStatus; limit?: number } = {}): PiboWorkflowRun[] {
		if (filter.piboSessionId) {
			const run = this.getWorkflowRunForSession(filter.piboSessionId);
			return run && (!filter.workflowId || run.workflowId === filter.workflowId) && (!filter.status || run.status === filter.status) ? [run] : [];
		}
		return this.runtimeStore.listRuns(filter).map((run) => this.getWorkflowRun(run.id)!);
	}

	saveWorkflowWaitToken(token: PiboWorkflowWaitToken): PiboWorkflowWaitToken {
		return this.runtimeStore.transaction(() => {
			this.assertRunSession(token.workflowRunId, token.piboSessionId);
			this.runtimeStore.saveWaitToken(publicWaitTokenToRuntime(token));
			if (token.status === "pending") this.updateRunAndRootLinkState(token.workflowRunId, "waiting", token.createdAt);
			return this.getWorkflowWaitToken(token.id)!;
		});
	}

	getWorkflowWaitToken(waitTokenId: string): PiboWorkflowWaitToken | undefined {
		const token = this.runtimeStore.getWaitToken(waitTokenId);
		if (!token) return undefined;
		return this.runtimeWaitTokenToPublic(token);
	}

	listWorkflowWaitTokens(filter: { piboSessionId?: string; workflowRunId?: string; status?: PiboWorkflowWaitTokenStatus; limit?: number } = {}): PiboWorkflowWaitToken[] {
		let workflowRunId = filter.workflowRunId;
		if (filter.piboSessionId) {
			const run = this.getWorkflowRunForSession(filter.piboSessionId);
			if (!run) return [];
			if (workflowRunId && workflowRunId !== run.id) return [];
			workflowRunId = run.id;
		}
		return this.runtimeStore.listWaitTokens({ workflowRunId, status: filter.status, limit: filter.limit }).map((token) => this.runtimeWaitTokenToPublic(token));
	}

	expireWorkflowWaitToken(input: { piboSessionId: string; workflowRunId: string; waitTokenId: string; resolvedAt?: string }): { waitToken: PiboWorkflowWaitToken; run: PiboWorkflowRun; workflowSession: PiboWorkflowSessionLink } {
		return this.runtimeStore.transaction(() => {
			this.assertRunSession(input.workflowRunId, input.piboSessionId);
			const token = this.runtimeStore.getWaitToken(input.waitTokenId);
			if (!token || token.workflowRunId !== input.workflowRunId) throw new Error("Workflow wait token not found for this Workflow session");
			if (token.status !== "pending") throw new Error(`Workflow wait token is ${token.status} and cannot be expired again`);
			const resolvedAt = input.resolvedAt ?? new Date().toISOString();
			if (!Number.isFinite(Date.parse(resolvedAt))) throw new Error("Workflow wait token expiry resolution time is invalid");
			if (!token.expiresAt || Date.parse(token.expiresAt) > Date.parse(resolvedAt)) throw new Error("Workflow wait token has not expired");
			for (const pending of this.runtimeStore.listWaitTokens({ workflowRunId: input.workflowRunId, status: "pending", limit: 500 })) {
				if (pending.expiresAt && Date.parse(pending.expiresAt) <= Date.parse(resolvedAt)) this.runtimeStore.saveWaitToken({ ...pending, status: "expired", resumedAt: resolvedAt });
			}
			const stillPending = this.runtimeStore.listWaitTokens({ workflowRunId: input.workflowRunId, status: "pending", limit: 1 }).length > 0;
			this.updateRunAndRootLinkState(input.workflowRunId, stillPending ? "waiting" : "failed", resolvedAt);
			return { waitToken: this.getWorkflowWaitToken(input.waitTokenId)!, run: this.getWorkflowRun(input.workflowRunId)!, workflowSession: this.getWorkflowSession(input.piboSessionId)! };
		});
	}

	resolveWorkflowHumanAction(input: {
		piboSessionId: string;
		workflowRunId: string;
		waitTokenId: string;
		actionId?: string;
		kind: PiboWorkflowHumanActionKind;
		actor?: PiboJsonObject;
		payload?: PiboJsonObject | PiboJsonValue;
		actionRecordId?: string;
		actedAt?: string;
	}): ResolveWorkflowHumanActionResult {
		const actedAt = input.actedAt ?? new Date().toISOString();
		const tokenBefore = this.runtimeStore.getWaitToken(input.waitTokenId);
		if (tokenBefore?.expiresAt && tokenBefore.status === "pending" && Date.parse(tokenBefore.expiresAt) <= Date.parse(actedAt)) {
			this.expireWorkflowWaitToken({ ...input, resolvedAt: actedAt });
			throw new Error(`Workflow wait token expired at ${tokenBefore.expiresAt}`);
		}
		return this.runtimeStore.transaction(() => {
			this.assertRunSession(input.workflowRunId, input.piboSessionId);
			const token = this.runtimeStore.getWaitToken(input.waitTokenId);
			if (!token || token.workflowRunId !== input.workflowRunId) throw new Error("Workflow wait token not found for this Workflow session");
			if (token.status !== "pending") throw new Error(`Workflow wait token is ${token.status} and cannot be resolved again`);
			const actionRef = input.actionId ? token.actions.find((action) => action.id === input.actionId) : token.actions.find((action) => action.kind === input.kind);
			if (!actionRef) throw new Error("Workflow wait token does not offer the requested human action");
			if (actionRef.kind && actionRef.kind !== input.kind) throw new Error("Workflow wait token action kind does not match the requested kind");
			const action: WorkflowHumanActionRecord = {
				id: input.actionRecordId ?? `wha_${randomUUID()}`,
				workflowRunId: input.workflowRunId,
				waitTokenId: input.waitTokenId,
				actionId: actionRef.id,
				kind: input.kind,
				...(input.actor ? { actor: input.actor } : {}),
				...(input.payload !== undefined ? { payload: input.payload } : {}),
				createdAt: actedAt,
			};
			if (this.runtimeStore.getHumanAction(action.id)) throw new Error(`Workflow human action '${action.id}' already exists`);
			this.runtimeStore.saveHumanAction(action);
			const cancelled = input.kind === "cancel";
			this.runtimeStore.saveWaitToken({ ...token, status: cancelled ? "cancelled" : "resumed", ...(input.payload !== undefined ? { resumePayload: input.payload } : {}), resumedAt: actedAt });
			this.updateRunAndRootLinkState(input.workflowRunId, cancelled ? "cancelled" : "running", actedAt);
			return {
				waitToken: this.getWorkflowWaitToken(input.waitTokenId)!,
				action: this.runtimeHumanActionToPublic(action),
				run: this.getWorkflowRun(input.workflowRunId)!,
				workflowSession: this.getWorkflowSession(input.piboSessionId)!,
			};
		});
	}

	listWorkflowHumanActions(filter: { piboSessionId?: string; workflowRunId?: string; waitTokenId?: string; limit?: number } = {}): PiboWorkflowHumanActionRecord[] {
		let workflowRunId = filter.workflowRunId;
		if (filter.piboSessionId) {
			const run = this.getWorkflowRunForSession(filter.piboSessionId);
			if (!run) return [];
			if (workflowRunId && workflowRunId !== run.id) return [];
			workflowRunId = run.id;
		}
		return this.runtimeStore.listHumanActions({ workflowRunId, waitTokenId: filter.waitTokenId, limit: filter.limit }).map((action) => this.runtimeHumanActionToPublic(action));
	}

	private assertRunSession(workflowRunId: string, piboSessionId: string): WorkflowRun {
		const run = this.runtimeStore.getRun(workflowRunId);
		if (!run || (run.piboSessionId !== piboSessionId && this.getWorkflowSession(piboSessionId)?.workflowRunId !== workflowRunId)) throw new Error("Workflow run does not belong to this Workflow session");
		return run;
	}

	private updateRunAndRootLinkState(workflowRunId: string, status: PiboWorkflowRunStatus, at: string): void {
		const run = this.runtimeStore.getRun(workflowRunId);
		if (!run) throw new Error("Workflow run not found");
		this.runtimeStore.saveRun({
			...run,
			status,
			current: { ...run.current, status },
			updatedAt: at,
			...(status === "failed" ? { failedAt: run.failedAt ?? at } : {}),
			...(status === "cancelled" ? { cancelledAt: run.cancelledAt ?? at } : {}),
			...(status === "completed" ? { completedAt: run.completedAt ?? at } : {}),
		});
		this.runtimeStore.db.prepare("UPDATE workflow_session_links SET state = ?, updated_at = ? WHERE workflow_run_id = ?").run(status, at, workflowRunId);
	}

	private runtimeWaitTokenToPublic(token: WorkflowWaitToken): PiboWorkflowWaitToken {
		const run = this.runtimeStore.getRun(token.workflowRunId);
		if (!run?.piboSessionId) throw new Error(`Workflow wait token '${token.id}' references a missing session-linked run`);
		return {
			id: token.id, piboSessionId: run.piboSessionId, workflowRunId: token.workflowRunId,
			...(token.nodeAttemptId ? { nodeAttemptId: token.nodeAttemptId } : {}),
			...(token.humanNodeId ? { humanNodeId: token.humanNodeId } : {}),
			actions: token.actions, prompt: token.prompt,
			...(token.schema ? { schema: token.schema as PiboJsonObject } : {}), status: token.status,
			...(token.resumePayload !== undefined ? { resumePayload: token.resumePayload as PiboJsonValue } : {}),
			createdAt: token.createdAt, ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
			...(token.resumedAt ? { resolvedAt: token.resumedAt } : {}),
		};
	}

	private runtimeHumanActionToPublic(action: WorkflowHumanActionRecord): PiboWorkflowHumanActionRecord {
		const run = this.runtimeStore.getRun(action.workflowRunId);
		if (!run?.piboSessionId) throw new Error(`Workflow human action '${action.id}' references a missing session-linked run`);
		return { id: action.id, piboSessionId: run.piboSessionId, workflowRunId: action.workflowRunId, waitTokenId: action.waitTokenId,
			...(action.actionId ? { actionId: action.actionId } : {}), kind: action.kind,
			...(action.actor ? { actor: action.actor as PiboJsonObject } : {}), ...(action.payload !== undefined ? { payload: action.payload as PiboJsonValue } : {}), createdAt: action.createdAt };
	}
}

type WorkflowSessionLinkRow = { pibo_session_id: string; workflow_id: string; workflow_version: string | null; workflow_run_id: string | null; state: PiboWorkflowSessionState; configuration_json: string | null; created_at: string; updated_at: string };
type WorkflowSessionSnapshotRow = { id: string; pibo_session_id: string; workflow_id: string; workflow_version: string; base_definition_hash: string; effective_definition_hash: string; snapshot_json: string; created_at: string };

function workflowSessionFromRow(row: WorkflowSessionLinkRow, runStatus?: WorkflowRun["status"]): PiboWorkflowSessionLink {
	const configuration = row.configuration_json ? parseJsonObject(row.configuration_json) as PiboWorkflowSessionConfiguration : undefined;
	return { piboSessionId: row.pibo_session_id, workflowId: row.workflow_id,
		...(row.workflow_version ? { workflowVersion: row.workflow_version } : {}), ...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
		state: normalizePublicRunStatus(runStatus) ?? row.state, ...(configuration ? { configuration } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

function workflowSessionSnapshotFromRow(row: WorkflowSessionSnapshotRow): PiboWorkflowSessionSnapshot {
	const parsed = JSON.parse(row.snapshot_json) as PiboWorkflowSessionSnapshot;
	if (!parsed || typeof parsed !== "object" || parsed.id !== row.id || parsed.piboSessionId !== row.pibo_session_id || parsed.workflow?.id !== row.workflow_id || parsed.workflow.version !== row.workflow_version || parsed.workflow.baseDefinitionHash !== row.base_definition_hash || parsed.workflow.effectiveDefinitionHash !== row.effective_definition_hash) {
		throw new Error(`Malformed Workflow session snapshot '${row.id}'`);
	}
	return parsed;
}

function workflowRunToPublic(run: WorkflowRun, sessionSnapshotId?: string): PiboWorkflowRun {
	return { ...run, id: run.id, piboSessionId: run.piboSessionId, workflowId: run.workflowId, workflowVersion: run.workflowVersion,
		snapshotId: sessionSnapshotId, definitionSnapshotId: run.definitionSnapshotId, effectiveDefinitionHash: run.workflowDefinitionHash, status: run.status,
		current: run.current as PiboJsonObject, input: run.input as PiboJsonValue, ...(run.output !== undefined ? { output: run.output as PiboJsonValue } : {}),
		inputValues: run.input && typeof run.input === "object" && !Array.isArray(run.input) ? run.input as PiboJsonObject : {},
		...(run.validation ? { validation: run.validation as PiboJsonObject } : {}), createdAt: run.createdAt, updatedAt: run.updatedAt,
		...(run.completedAt ? { completedAt: run.completedAt } : {}), ...(run.failedAt ? { failedAt: run.failedAt } : {}), ...(run.cancelledAt ? { cancelledAt: run.cancelledAt } : {}) };
}

function publicWaitTokenToRuntime(token: PiboWorkflowWaitToken): WorkflowWaitToken {
	return { id: token.id, workflowRunId: token.workflowRunId, ...(token.nodeAttemptId ? { nodeAttemptId: token.nodeAttemptId } : {}),
		...(token.humanNodeId ? { humanNodeId: token.humanNodeId } : {}), actions: token.actions, prompt: token.prompt,
		...(token.schema ? { schema: token.schema } : {}), status: token.status,
		...(token.resumePayload !== undefined ? { resumePayload: token.resumePayload } : {}), createdAt: token.createdAt,
		...(token.expiresAt ? { expiresAt: token.expiresAt } : {}), ...(token.resolvedAt ? { resumedAt: token.resolvedAt } : {}) };
}

function assertImmutableWorkflowSelection(existing: PiboWorkflowSessionLink, next: { workflowId: string; workflowVersion?: string; workflowRunId?: string; configuration?: PiboWorkflowSessionConfiguration }): void {
	if (existing.workflowId !== next.workflowId || existing.workflowVersion !== next.workflowVersion) throw new Error("Workflow session selection is immutable");
	if (existing.workflowRunId && next.workflowRunId && existing.workflowRunId !== next.workflowRunId) throw new Error("Workflow session run id is immutable");
	if (canonicalJson(existing.configuration) !== canonicalJson(next.configuration)) throw new Error("Workflow session configuration is immutable");
}

function normalizePublicRunStatus(status: WorkflowRun["status"] | undefined): PiboWorkflowRunStatus | undefined {
	return status === "pending" || status === "running" || status === "waiting" || status === "completed" || status === "failed" || status === "cancelled" ? status : undefined;
}
function canonicalJson(value: unknown): string { return JSON.stringify(value ?? null); }
function parseJsonObject(value: string): PiboJsonObject { const parsed = JSON.parse(value) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Malformed Workflow JSON object"); return parsed as PiboJsonObject; }
