import { randomUUID } from "node:crypto";
import type { PiboReliabilityStore, PiboRunStoreRecord } from "../reliability/store.js";

export type PiboRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type PiboRunKind = "tool";
export type PiboRunCompletionPolicy = "tracked" | "detached";

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

export type PiboRunNotification = {
	completed: PiboRunSnapshot[];
	failed: PiboRunSnapshot[];
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
};

type Waiter = {
	resolve(record: PiboRunRecord): void;
};

function now(): string {
	return new Date().toISOString();
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
	if (record.completedAt) output.completedAt = record.completedAt;
	return output;
}

function terminal(status: PiboRunStatus): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

export class PiboRunRegistry {
	private readonly runs = new Map<string, PiboRunRecord>();
	private readonly waiters = new Map<string, Waiter[]>();
	private readonly listeners = new Set<PiboRunRegistryListener>();

	subscribe(listener: PiboRunRegistryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	constructor(private readonly options: PiboRunRegistryOptions = {}) {
		if (this.options.store) {
			this.options.store.recoverInterruptedRuns();
			for (const record of this.options.store.listRuns({ includeConsumed: true, includeDetached: true })) {
				this.runs.set(record.runId, recordFromStored(record));
			}
		}
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
		};
		this.runs.set(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_started", run: output });
		return output;
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
		if (record.jobId) this.options.store?.ack(record.jobId, `run-registry:${process.pid}`);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus });
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
		if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, error);
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
		if (terminal(record.status)) {
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

	cancel(controllerPiboSessionId: string, runId: string): PiboRunSnapshot {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		const previousStatus = record.status;
		if (!terminal(record.status)) {
			record.status = "cancelled";
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, "Run was cancelled.");
		}
		record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_changed", run: output, previousStatus, reason: "Run was cancelled." });
		return output;
	}

	ack(controllerPiboSessionId: string, runId: string): PiboRunSnapshot {
		const record = this.requireRunForController(controllerPiboSessionId, runId);
		record.acknowledgedStatus = record.status;
		if (terminal(record.status)) record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		const output = snapshot(record);
		this.notify({ type: "run_acknowledged", run: output });
		return output;
	}

	createNotification(
		controllerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): PiboRunNotification | undefined {
		const records = [...this.runs.values()].filter((record) =>
			this.needsNotification(record, controllerPiboSessionId, options),
		);
		if (records.length === 0) return undefined;

		for (const record of records) {
			record.notifiedStatus = record.status;
			this.options.store?.updateRun(record.runId, record);
		}

		const notification: PiboRunNotification = {
			completed: [],
			failed: [],
			cancelled: [],
			running: [],
		};
		for (const record of records) {
			const item = snapshot(record);
			if (record.status === "completed") notification.completed.push(item);
			else if (record.status === "failed") notification.failed.push(item);
			else if (record.status === "cancelled") notification.cancelled.push(item);
			else notification.running.push(item);
		}
		return notification;
	}

	hasPendingNotification(
		controllerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return [...this.runs.values()].some((record) =>
			this.needsNotification(record, controllerPiboSessionId, options),
		);
	}

	cancelControllerRuns(controllerPiboSessionId: string, reason = "Controller Pibo session was disposed."): PiboRunSnapshot[] {
		const cancelled: PiboRunSnapshot[] = [];
		for (const record of this.runs.values()) {
			if (record.controllerPiboSessionId !== controllerPiboSessionId || terminal(record.status)) continue;
			record.status = "cancelled";
			record.error = reason;
			record.consumed = true;
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			this.options.store?.updateRun(record.runId, record);
			if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, reason);
			const output = snapshot(record);
			this.notify({ type: "run_changed", run: output, previousStatus: "running", reason });
			cancelled.push(output);
		}
		return cancelled;
	}

	cancelAll(reason = "Run registry was disposed."): PiboRunSnapshot[] {
		const cancelled: PiboRunSnapshot[] = [];
		for (const record of this.runs.values()) {
			if (terminal(record.status)) continue;
			record.status = "cancelled";
			record.error = reason;
			record.consumed = true;
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			this.options.store?.updateRun(record.runId, record);
			if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, reason);
			const output = snapshot(record);
			this.notify({ type: "run_changed", run: output, previousStatus: "running", reason });
			cancelled.push(output);
		}
		return cancelled;
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
	};
}
