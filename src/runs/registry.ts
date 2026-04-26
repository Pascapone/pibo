import { randomUUID } from "node:crypto";

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
	ownerSessionKey: string;
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
};

type StartToolRunInput = {
	ownerSessionKey: string;
	toolName: string;
	completionPolicy?: PiboRunCompletionPolicy;
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
		ownerSessionKey: record.ownerSessionKey,
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

	constructor(private readonly options: PiboRunRegistryOptions = {}) {}

	startToolRun(input: StartToolRunInput): PiboRunSnapshot {
		this.prune();
		const timestamp = now();
		const runId = `run_${randomUUID()}`;
		const record: PiboRunRecord = {
			runId,
			kind: "tool",
			ownerSessionKey: input.ownerSessionKey,
			status: "running",
			completionPolicy: input.completionPolicy ?? "tracked",
			consumed: false,
			toolName: input.toolName,
			createdAt: timestamp,
			updatedAt: timestamp,
			summary: `${input.toolName} run is running.`,
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
		return snapshot(record);
	}

	fail(runId: string, error: string): PiboRunSnapshot | undefined {
		const record = this.runs.get(runId);
		if (!record || terminal(record.status)) return undefined;

		record.status = "failed";
		record.error = error;
		record.summary = `${record.toolName} run failed.`;
		this.finish(record);
		return snapshot(record);
	}

	list(ownerSessionKey: string, options: { includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunSnapshot[] {
		this.prune();
		return [...this.runs.values()]
			.filter((record) => record.ownerSessionKey === ownerSessionKey)
			.filter((record) => options.includeConsumed || !record.consumed)
			.filter((record) => options.includeDetached || record.completionPolicy !== "detached")
			.map(snapshot);
	}

	status(ownerSessionKey: string, runId: string): PiboRunSnapshot {
		return snapshot(this.requireOwned(ownerSessionKey, runId));
	}

	async wait(ownerSessionKey: string, runId: string, timeoutMs: number): Promise<PiboRunWaitResult> {
		const record = this.requireOwned(ownerSessionKey, runId);
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

	read(ownerSessionKey: string, runId: string): PiboRunReadResult {
		const record = this.requireOwned(ownerSessionKey, runId);
		if (terminal(record.status)) {
			record.consumed = true;
			record.updatedAt = now();
		}
		const output: PiboRunReadResult = { ...snapshot(record) };
		if (record.result) output.result = record.result;
		if (record.error) output.error = record.error;
		return output;
	}

	cancel(ownerSessionKey: string, runId: string): PiboRunSnapshot {
		const record = this.requireOwned(ownerSessionKey, runId);
		if (!terminal(record.status)) {
			record.status = "cancelled";
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
		}
		record.consumed = true;
		record.updatedAt = now();
		return snapshot(record);
	}

	ack(ownerSessionKey: string, runId: string): PiboRunSnapshot {
		const record = this.requireOwned(ownerSessionKey, runId);
		record.acknowledgedStatus = record.status;
		if (terminal(record.status)) record.consumed = true;
		record.updatedAt = now();
		return snapshot(record);
	}

	createNotification(
		ownerSessionKey: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): PiboRunNotification | undefined {
		const records = [...this.runs.values()].filter((record) =>
			this.needsNotification(record, ownerSessionKey, options),
		);
		if (records.length === 0) return undefined;

		for (const record of records) {
			record.notifiedStatus = record.status;
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
		ownerSessionKey: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return [...this.runs.values()].some((record) =>
			this.needsNotification(record, ownerSessionKey, options),
		);
	}

	cancelOwnerRuns(ownerSessionKey: string, reason = "Owner session was disposed."): PiboRunSnapshot[] {
		const cancelled: PiboRunSnapshot[] = [];
		for (const record of this.runs.values()) {
			if (record.ownerSessionKey !== ownerSessionKey || terminal(record.status)) continue;
			record.status = "cancelled";
			record.error = reason;
			record.consumed = true;
			record.summary = `${record.toolName} run cancelled.`;
			this.finish(record);
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

		return pruned;
	}

	private requireOwned(ownerSessionKey: string, runId: string): PiboRunRecord {
		const record = this.runs.get(runId);
		if (!record || record.ownerSessionKey !== ownerSessionKey) {
			throw new Error(`Unknown run "${runId}" for session "${ownerSessionKey}"`);
		}
		return record;
	}

	private needsNotification(
		record: PiboRunRecord,
		ownerSessionKey: string,
		options: { includeAlreadyNotified?: boolean } = {},
	): boolean {
		return (
			record.ownerSessionKey === ownerSessionKey &&
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
