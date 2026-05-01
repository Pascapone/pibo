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
	ownerPiboSessionId: string;
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
	ownerPiboSessionId: string;
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
		ownerPiboSessionId: record.ownerPiboSessionId,
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
				ownerPiboSessionId: input.ownerPiboSessionId,
				toolName: input.toolName,
				completionPolicy: input.completionPolicy ?? "tracked",
				params: input.params,
				retryable: input.retryable ?? false,
				maxAttempts: input.maxAttempts ?? 1,
			});
			const record = recordFromStored(stored);
			this.runs.set(record.runId, record);
			return snapshot(record);
		}
		const timestamp = now();
		const runId = `run_${randomUUID()}`;
		const record: PiboRunRecord = {
			runId,
			kind: "tool",
			ownerPiboSessionId: input.ownerPiboSessionId,
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
		return snapshot(record);
	}

	complete(runId: string, result: PiboToolRunResult): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		record.status = "completed";
		record.result = result;
		record.summary = `${record.toolName} run completed.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.ack(record.jobId, `run-registry:${process.pid}`);
		return snapshot(record);
	}

	fail(runId: string, error: string): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		record.status = "failed";
		record.error = error;
		record.summary = `${record.toolName} run failed.`;
		this.finish(record);
		this.options.store?.updateRun(runId, record);
		if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, error);
		return snapshot(record);
	}

	list(ownerPiboSessionId: string, options: { includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunSnapshot[] {
		this.prune();
		return [...this.runs.values()]
			.filter((record) => record.ownerPiboSessionId === ownerPiboSessionId)
			.filter((record) => options.includeConsumed || !record.consumed)
			.filter((record) => options.includeDetached || record.completionPolicy !== "detached")
			.map(snapshot);
	}

	status(ownerPiboSessionId: string, runId: string): PiboRunSnapshot {
		return snapshot(this.requireOwned(ownerPiboSessionId, runId));
	}

	async wait(ownerPiboSessionId: string, runId: string, timeoutMs: number): Promise<PiboRunWaitResult> {
		const record = this.requireOwned(ownerPiboSessionId, runId);
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

	read(ownerPiboSessionId: string, runId: string): PiboRunReadResult {
		const record = this.requireOwned(ownerPiboSessionId, runId);
		if (terminal(record.status)) {
			record.consumed = true;
			record.updatedAt = now();
			this.options.store?.updateRun(runId, record);
		}
		const output: PiboRunReadResult = { ...snapshot(record) };
		if (record.result) output.result = record.result;
		if (record.error) output.error = record.error;
		return output;
	}

	cancel(ownerPiboSessionId: string, runId: string): PiboRunSnapshot {
		const record = this.requireOwned(ownerPiboSessionId, runId);
		if (!terminal(record.status)) {
			record.status = "cancelled";
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, "Run was cancelled.");
		}
		record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		return snapshot(record);
	}

	ack(ownerPiboSessionId: string, runId: string): PiboRunSnapshot {
		const record = this.requireOwned(ownerPiboSessionId, runId);
		record.acknowledgedStatus = record.status;
		if (terminal(record.status)) record.consumed = true;
		record.updatedAt = now();
		this.options.store?.updateRun(runId, record);
		return snapshot(record);
	}

	createNotification(
		ownerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): PiboRunNotification | undefined {
		const records = [...this.runs.values()].filter((record) =>
			this.needsNotification(record, ownerPiboSessionId, options),
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
		ownerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return [...this.runs.values()].some((record) =>
			this.needsNotification(record, ownerPiboSessionId, options),
		);
	}

	cancelOwnerRuns(ownerPiboSessionId: string, reason = "Owner Pibo session was disposed."): PiboRunSnapshot[] {
		const cancelled: PiboRunSnapshot[] = [];
		for (const record of this.runs.values()) {
			if (record.ownerPiboSessionId !== ownerPiboSessionId || terminal(record.status)) continue;
			record.status = "cancelled";
			record.error = reason;
			record.consumed = true;
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
			this.options.store?.updateRun(record.runId, record);
			if (record.jobId) this.options.store?.fail(record.jobId, `run-registry:${process.pid}`, reason);
			cancelled.push(snapshot(record));
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
			cancelled.push(snapshot(record));
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
			pruned += 1;
		}
		if (this.options.store) {
			this.options.store.pruneRuns({ consumedTerminalTtlMs, detachedTerminalTtlMs, nowMs });
		}
		return pruned;
	}

	private requireOwned(ownerPiboSessionId: string, runId: string): PiboRunRecord {
		const record = this.runs.get(runId);
		if (!record || record.ownerPiboSessionId !== ownerPiboSessionId) {
			throw new Error(`Unknown run "${runId}" for session "${ownerPiboSessionId}"`);
		}
		return record;
	}

	private needsNotification(
		record: PiboRunRecord,
		ownerPiboSessionId: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return (
			record.ownerPiboSessionId === ownerPiboSessionId &&
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
}

function recordFromStored(record: PiboRunStoreRecord): PiboRunRecord {
	return {
		runId: record.runId,
		kind: record.kind,
		ownerPiboSessionId: record.ownerPiboSessionId,
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
