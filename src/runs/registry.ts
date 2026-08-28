import { randomUUID } from "node:crypto";
import type { PiboMessageProvenance } from "../core/events.js";
import type { PiboReliabilityStore, PiboRunStoreRecord } from "../reliability/store.js";
import type { PiboRunTimeoutPhase } from "./lifecycle.js";
import type { PiboRunResourceUsage } from "./resource-isolation.js";

export type PiboRunStatus = "queued" | "running" | "completed" | "failed" | "timed_out" | "cancelled";
export type PiboRunKind = "tool";
export type PiboRunCompletionPolicy = "tracked" | "detached";

export type PiboRunOrigin = {
	eventId: string;
	provenance: PiboMessageProvenance;
};

export type PiboToolRunResult = {
	text?: string;
	details?: unknown;
};

export type PiboRunSnapshot = {
	runId: string;
	kind: PiboRunKind;
	controllerPiboSessionId: string;
	status: PiboRunStatus;
	completionPolicy: PiboRunCompletionPolicy;
	consumed: boolean;
	toolName: string;
	summary?: string;
	timeoutMs?: number;
	timeoutAt?: string;
	timeoutPhase?: PiboRunTimeoutPhase;
	serviceWarning?: string;
	resources?: PiboRunResourceUsage;
	createdAt: string;
	updatedAt: string;
	completedAt?: string;
};

export type PiboRunReadResult = PiboRunSnapshot & {
	result?: PiboToolRunResult;
	error?: string;
};

export type PiboRunWaitResult = PiboRunSnapshot & {
	timedOut: boolean;
};

export type PiboRunAckResult = PiboRunSnapshot & {
	changed: boolean;
};

export type PiboRunNotification = {
	origin?: PiboRunOrigin;
	completed: PiboRunSnapshot[];
	failed: PiboRunSnapshot[];
	timedOut: PiboRunSnapshot[];
	cancelled: PiboRunSnapshot[];
	running: PiboRunSnapshot[];
};

export type PiboRunRegistryEvent =
	| { type: "run_started"; run: PiboRunSnapshot }
	| { type: "run_changed"; run: PiboRunSnapshot; previousStatus?: PiboRunStatus; reason?: string }
	| { type: "run_consumed"; run: PiboRunSnapshot }
	| { type: "run_acknowledged"; run: PiboRunSnapshot }
	| { type: "run_removed"; runId: string; controllerPiboSessionId: string };

export type PiboRunRegistryListener = (event: PiboRunRegistryEvent) => void;

export type PiboRunRegistryOptions = {
	consumedTerminalTtlMs?: number;
	detachedTerminalTtlMs?: number;
	store?: PiboReliabilityStore;
	workerId?: string;
};

export type PiboRunPruneOptions = {
	nowMs?: number;
	consumedTerminalTtlMs?: number;
	detachedTerminalTtlMs?: number;
};

const DEFAULT_CONSUMED_TERMINAL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DETACHED_TERMINAL_TTL_MS = 60 * 1000;

type PiboRunRecord = PiboRunSnapshot & {
	result?: PiboToolRunResult;
	error?: string;
	origin?: PiboRunOrigin;
	notifiedStatus?: PiboRunStatus;
	acknowledgedStatus?: PiboRunStatus;
	jobId?: string;
	retryable?: boolean;
	maxAttempts?: number;
};

type StartToolRunInput = {
	controllerPiboSessionId: string;
	toolName: string;
	params?: unknown;
	completionPolicy?: PiboRunCompletionPolicy;
	retryable?: boolean;
	maxAttempts?: number;
	timeoutMs?: number;
	serviceWarning?: string;
	resources?: PiboRunResourceUsage;
	origin?: PiboRunOrigin;
};

type Waiter = {
	resolve(record: PiboRunRecord): void;
};

function now(): string {
	return new Date().toISOString();
}

function runTimeoutAt(createdAt: string, timeoutMs: number | undefined): string | undefined {
	return timeoutMs === undefined ? undefined : new Date(Date.parse(createdAt) + timeoutMs).toISOString();
}

function sameOrigin(left: PiboRunOrigin | undefined, right: PiboRunOrigin | undefined): boolean {
	if (!left || !right) return left === right;
	if (left.eventId !== right.eventId || left.provenance.kind !== right.provenance.kind) return false;
	if (left.provenance.kind === "loop-run" && right.provenance.kind === "loop-run") {
		return left.provenance.jobId === right.provenance.jobId
			&& left.provenance.runId === right.provenance.runId
			&& left.provenance.cause === right.provenance.cause
			&& left.provenance.rootEventId === right.provenance.rootEventId;
	}
	if (left.provenance.kind === "subagent-request" && right.provenance.kind === "subagent-request") {
		return left.provenance.requestId === right.provenance.requestId
			&& left.provenance.controllerPiboSessionId === right.provenance.controllerPiboSessionId
			&& left.provenance.loopJobId === right.provenance.loopJobId
			&& left.provenance.loopRunId === right.provenance.loopRunId;
	}
	return false;
}

function formatTimeout(timeoutMs: number | undefined): string {
	if (timeoutMs === undefined) return "its configured timeout";
	return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s timeout` : `${timeoutMs}ms timeout`;
}

function snapshot(record: PiboRunRecord): PiboRunSnapshot {
	const output: PiboRunSnapshot = {
		runId: record.runId,
		kind: record.kind,
		controllerPiboSessionId: record.controllerPiboSessionId,
		status: record.status,
		completionPolicy: record.completionPolicy,
		consumed: record.consumed,
		toolName: record.toolName,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
	if (record.summary) output.summary = record.summary;
	if (record.timeoutMs !== undefined) output.timeoutMs = record.timeoutMs;
	if (record.timeoutAt) output.timeoutAt = record.timeoutAt;
	if (record.timeoutPhase) output.timeoutPhase = record.timeoutPhase;
	if (record.serviceWarning) output.serviceWarning = record.serviceWarning;
	if (record.resources) output.resources = structuredClone(record.resources);
	if (record.completedAt) output.completedAt = record.completedAt;
	return output;
}

function terminal(status: PiboRunStatus): boolean {
	return status === "completed" || status === "failed" || status === "timed_out" || status === "cancelled";
}

export class PiboRunRegistry {
	private readonly runs = new Map<string, PiboRunRecord>();
	private readonly waiters = new Map<string, Waiter[]>();
	private readonly listeners = new Set<PiboRunRegistryListener>();
	private readonly recoveredRuns: PiboRunSnapshot[] = [];
	private readonly workerId: string;

	subscribe(listener: PiboRunRegistryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	constructor(private readonly options: PiboRunRegistryOptions = {}) {
		this.workerId = options.workerId ?? `run-registry:${process.pid}:${randomUUID()}`;
		if (this.options.store) {
			for (const recovered of this.options.store.recoverInterruptedRuns(this.workerId)) {
				this.recoveredRuns.push(snapshot(recordFromStored(recovered)));
			}
			for (const record of this.options.store.listRuns({ includeConsumed: true, includeDetached: true })) {
				this.runs.set(record.runId, recordFromStored(record));
			}
		}
	}

	listRecoveredRuns(): PiboRunSnapshot[] {
		return this.recoveredRuns.map((run) => ({ ...run }));
	}

	startToolRun(input: StartToolRunInput): PiboRunSnapshot {
		this.prune();
		if (this.options.store) {
			const stored = this.options.store.createRun({
				controllerPiboSessionId: input.controllerPiboSessionId,
				toolName: input.toolName,
				completionPolicy: input.completionPolicy ?? "tracked",
				params: input.params,
				retryable: input.retryable ?? false,
				maxAttempts: input.maxAttempts ?? 1,
				timeoutMs: input.timeoutMs,
				serviceWarning: input.serviceWarning,
				resources: input.resources,
				workerId: this.workerId,
				origin: input.origin,
			});
			const record = recordFromStored(stored);
			this.runs.set(record.runId, record);
			const output = snapshot(record);
			this.notify({ type: "run_started", run: output });
			return output;
		}
		const timestamp = now();
		const runId = `run_${randomUUID()}`;
		const record: PiboRunRecord = {
			runId,
			kind: "tool",
			controllerPiboSessionId: input.controllerPiboSessionId,
			status: "running",
			completionPolicy: input.completionPolicy ?? "tracked",
			consumed: false,
			toolName: input.toolName,
			createdAt: timestamp,
			updatedAt: timestamp,
			summary: `${input.toolName} run is running.`,
			retryable: input.retryable ?? false,
			maxAttempts: Math.max(1, input.maxAttempts ?? 1),
			...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs, timeoutAt: runTimeoutAt(timestamp, input.timeoutMs) } : {}),
			...(input.serviceWarning ? { serviceWarning: input.serviceWarning } : {}),
			...(input.resources ? { resources: structuredClone(input.resources) } : {}),
			...(input.origin ? { origin: structuredClone(input.origin) } : {}),
		};
		this.runs.set(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_started", run: output });
		return output;
	}

	updateResources(runId: string, resources: PiboRunResourceUsage): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record) return undefined;
		record.resources = structuredClone(resources);
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		return snapshot(record);
	}

	complete(runId: string, result: PiboToolRunResult): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		const previousStatus = record.status;
		record.status = "completed";
		record.result = result;
		record.summary = `${record.toolName} run completed.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.ack(record.jobId, this.workerId);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus });
		return output;
	}

	resourceLimit(runId: string, error: string, resources: PiboRunResourceUsage): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		const previousStatus = record.status;
		record.status = "failed";
		record.error = error;
		record.resources = structuredClone(resources);
		record.summary = `${record.toolName} run was stopped by yielded-run resource limits.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.fail(record.jobId, this.workerId, error);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus, reason: error });
		return output;
	}

	fail(runId: string, error: string): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		const previousStatus = record.status;
		record.status = "failed";
		record.error = error;
		record.summary = `${record.toolName} run failed.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.fail(record.jobId, this.workerId, error);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus, reason: error });
		return output;
	}

	timeOut(runId: string, error: string, timeoutPhase: PiboRunTimeoutPhase): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		const previousStatus = record.status;
		record.status = "timed_out";
		record.error = error;
		record.timeoutPhase = timeoutPhase;
		record.summary = timeoutPhase === "lifetime"
			? `${record.toolName} run started successfully, then reached ${formatTimeout(record.timeoutMs)}.`
			: `${record.toolName} run reached ${formatTimeout(record.timeoutMs)} before startup was confirmed.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.fail(record.jobId, this.workerId, error);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus, reason: error });
		return output;
	}

	list(controllerPiboSessionId: string, options: { includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunSnapshot[] {
		this.prune();
		return [...this.runs.values()]
			.filter((record) => record.controllerPiboSessionId === controllerPiboSessionId)
			.filter((record) => options.includeConsumed || !record.consumed)
			.filter((record) => options.includeDetached || record.completionPolicy !== "detached")
			.map(snapshot);
	}

	listAll(options: { includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunSnapshot[] {
		this.prune();
		return [...this.runs.values()]
			.filter((record) => options.includeConsumed || !record.consumed)
			.filter((record) => options.includeDetached || record.completionPolicy !== "detached")
			.map(snapshot);
	}

	listActiveControllerRuns(controllerPiboSessionId: string): PiboRunSnapshot[] {
		return [...this.runs.values()]
			.filter((record) => record.controllerPiboSessionId === controllerPiboSessionId && !terminal(record.status))
			.map(snapshot);
	}

	listActiveRuns(): PiboRunSnapshot[] {
		return [...this.runs.values()]
			.filter((record) => !terminal(record.status))
			.map(snapshot);
	}

	status(controllerPiboSessionId: string, runId: string): PiboRunSnapshot {
		return snapshot(this.requireRunForController(controllerPiboSessionId, runId));
	}

	async wait(controllerPiboSessionId: string, runId: string, timeoutMs: number): Promise<PiboRunWaitResult> {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		if (terminal(record.status)) return { ...snapshot(record), timedOut: false };

		const boundedTimeoutMs = Math.max(0, Math.min(timeoutMs, 300000));
		const completed = await new Promise<PiboRunRecord | undefined>((resolve) => {
			const timeout = setTimeout(() => {
				removeWaiter();
				resolve(undefined);
			}, boundedTimeoutMs);
			const waiter: Waiter = {
				resolve: (updated) => {
					clearTimeout(timeout);
					resolve(updated);
				},
			};
			const removeWaiter = () => {
				const waiters = this.waiters.get(runId);
				if (!waiters) return;
				const index = waiters.indexOf(waiter);
				if (index >= 0) waiters.splice(index, 1);
				if (waiters.length === 0) this.waiters.delete(runId);
			};
			const waiters = this.waiters.get(runId) ?? [];
			waiters.push(waiter);
			this.waiters.set(runId, waiters);
		});

		if (!completed) return { ...snapshot(record), timedOut: true };
		return { ...snapshot(completed), timedOut: false };
	}

	read(controllerPiboSessionId: string, runId: string): PiboRunReadResult {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		if (terminal(record.status) && !record.consumed) {
			record.consumed = true;
			record.updatedAt = now();
			this.options.store?.updateRun(runId, record);
			this.notify({ type: "run_consumed", run: snapshot(record) });
		}
		const output: PiboRunReadResult = { ...snapshot(record) };
		if (record.result) output.result = record.result;
		if (record.error) output.error = record.error;
		return output;
	}

	cancel(controllerPiboSessionId: string, runId: string, reason = "Run was cancelled."): PiboRunSnapshot {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		const previousStatus = record.status;
		if (!terminal(record.status)) {
			record.status = "cancelled";
			record.error = reason;
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			if (record.jobId) this.options.store?.fail(record.jobId, this.workerId, reason);
		}
		record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus, reason });
		return output;
	}

	ack(controllerPiboSessionId: string, runId: string): PiboRunAckResult {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		const consumesTerminalRun = terminal(record.status) && !record.consumed;
		if (record.acknowledgedStatus === record.status && !consumesTerminalRun) return { ...snapshot(record), changed: false };
		record.acknowledgedStatus = record.status;
		if (terminal(record.status)) record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_acknowledged", run: output });
		return { ...output, changed: true };
	}

	suppressNotification(controllerPiboSessionId: string, runId: string): PiboRunSnapshot {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		record.acknowledgedStatus = record.status;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		return snapshot(record);
	}

	suppressControllerNotifications(controllerPiboSessionId: string): PiboRunSnapshot[] {
		const suppressed: PiboRunSnapshot[] = [];
		for (const record of this.runs.values()) {
			if (record.controllerPiboSessionId !== controllerPiboSessionId || record.completionPolicy !== "tracked") continue;
			record.acknowledgedStatus = record.status;
			record.updatedAt = now();
			this.options.store?.updateRun(record.runId, record);
			suppressed.push(snapshot(record));
		}
		return suppressed;
	}

	createNotification(
		controllerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): PiboRunNotification | undefined {
		const pendingRecords = [...this.runs.values()].filter((record) =>
			this.needsNotification(record, controllerPiboSessionId, options),
		);
		if (pendingRecords.length === 0) return undefined;
		const origin = pendingRecords[0].origin;
		const records = pendingRecords.filter((record) => sameOrigin(record.origin, origin));

		for (const record of records) {
			record.notifiedStatus = record.status;
			this.options.store?.updateRun(record.runId, record);
		}

		const notification: PiboRunNotification = {
			...(origin ? { origin: structuredClone(origin) } : {}),
			completed: [],
			failed: [],
			timedOut: [],
			cancelled: [],
			running: [],
		};
		for (const record of records) {
			const item = snapshot(record);
			if (record.status === "completed") notification.completed.push(item);
			else if (record.status === "failed") notification.failed.push(item);
			else if (record.status === "timed_out") notification.timedOut.push(item);
			else if (record.status === "cancelled") notification.cancelled.push(item);
			else notification.running.push(item);
		}
		return notification;
	}

	releaseNotification(
		controllerPiboSessionId: string,
		notification: PiboRunNotification,
	): PiboRunSnapshot[] {
		const released: PiboRunSnapshot[] = [];
		const items = [
			...notification.completed,
			...notification.failed,
			...notification.timedOut,
			...notification.cancelled,
			...notification.running,
		];
		for (const item of items) {
			const record = this.runs.get(item.runId);
			if (!record || record.controllerPiboSessionId !== controllerPiboSessionId) continue;
			if (record.status !== item.status || record.notifiedStatus !== item.status) continue;
			record.notifiedStatus = undefined;
			record.updatedAt = now();
			this.options.store?.updateRun(record.runId, record);
			released.push(snapshot(record));
		}
		return released;
	}

	hasPendingNotification(
		controllerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return [...this.runs.values()].some((record) =>
			this.needsNotification(record, controllerPiboSessionId, options),
		);
	}

	prune(options: PiboRunPruneOptions = {}): number {
		const nowMs = options.nowMs ?? Date.now();
		const consumedTerminalTtlMs =
			options.consumedTerminalTtlMs ??
			this.options.consumedTerminalTtlMs ??
			DEFAULT_CONSUMED_TERMINAL_TTL_MS;
		const detachedTerminalTtlMs =
			options.detachedTerminalTtlMs ??
			this.options.detachedTerminalTtlMs ??
			DEFAULT_DETACHED_TERMINAL_TTL_MS;
		let pruned = 0;

		for (const [runId, record] of this.runs) {
			if (!terminal(record.status) || !record.completedAt) continue;

			const ageMs = nowMs - Date.parse(record.completedAt);
			const shouldPrune =
				(record.completionPolicy === "detached" && ageMs >= detachedTerminalTtlMs) ||
				(record.completionPolicy === "tracked" && record.consumed && ageMs >= consumedTerminalTtlMs);
			if (!shouldPrune) continue;

			this.runs.delete(runId);
			this.notify({ type: "run_removed", runId, controllerPiboSessionId: record.controllerPiboSessionId });
			pruned += 1;
		}
		if (this.options.store) {
			this.options.store.pruneRuns({ consumedTerminalTtlMs, detachedTerminalTtlMs, nowMs });
		}
		return pruned;
	}

	private requireRunForController(controllerPiboSessionId: string, runId: string): PiboRunRecord {
		const record = this.runs.get(runId);
		if (!record || record.controllerPiboSessionId !== controllerPiboSessionId) {
			throw new Error(`Unknown run "${runId}" for session "${controllerPiboSessionId}"`);
		}
		return record;
	}

	private needsNotification(
		record: PiboRunRecord,
		controllerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return (
			record.controllerPiboSessionId === controllerPiboSessionId &&
			record.completionPolicy === "tracked" &&
			!record.consumed &&
			record.acknowledgedStatus !== record.status &&
			(options.includeAlreadyNotified || record.notifiedStatus !== record.status)
		);
	}

	private finish(record: PiboRunRecord): void {
		const timestamp = now();
		record.updatedAt = timestamp;
		record.completedAt = timestamp;
		this.resolveWaiters(record);
	}

	private resolveWaiters(record: PiboRunRecord): void {
		const waiters = this.waiters.get(record.runId);
		if (!waiters) return;
		this.waiters.delete(record.runId);
		for (const waiter of waiters) {
			waiter.resolve(record);
		}
	}

	private notify(event: PiboRunRegistryEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

function recordFromStored(record: PiboRunStoreRecord): PiboRunRecord {
	return {
		runId: record.runId,
		kind: record.kind,
		controllerPiboSessionId: record.controllerPiboSessionId,
		status: record.status,
		completionPolicy: record.completionPolicy,
		consumed: record.consumed,
		toolName: record.toolName,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		summary: record.summary,
		completedAt: record.completedAt,
		result: record.result,
		error: record.error,
		notifiedStatus: record.notifiedStatus,
		acknowledgedStatus: record.acknowledgedStatus,
		jobId: record.jobId,
		retryable: record.retryable,
		maxAttempts: record.maxAttempts,
		timeoutMs: record.timeoutMs,
		timeoutAt: record.timeoutAt,
		timeoutPhase: record.timeoutPhase,
		serviceWarning: record.serviceWarning,
		resources: record.resources,
		origin: record.origin,
	};
}
