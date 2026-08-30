import { randomUUID } from "node:crypto";
import type { PiboJsonValue } from "./events.js";
import type { PiboReliabilityStore, StoredPiboJob } from "../reliability/store.js";

export type OutputPersistenceRetryContext = {
	payload: PiboJsonValue;
	attempt: number;
	signal: AbortSignal;
	updatePayload(payload: PiboJsonValue): void;
};

export type OutputPersistenceRetryJob = {
	key: string;
	piboSessionId?: string;
	eventId?: string;
	payload?: PiboJsonValue;
	run(context: OutputPersistenceRetryContext): void | Promise<void>;
	onSuccess?(): void;
	onDeadLetter?(error: unknown, attempts: number): void;
};

export type OutputPersistenceRecoveredJob = Omit<OutputPersistenceRetryJob, "run"> & {
	payload: PiboJsonValue;
	attempts: number;
	maxAttempts: number;
};

export type OutputPersistenceRetryQueueOptions = {
	maxPending?: number;
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	maxDeadLetters?: number;
	durableStore?: PiboReliabilityStore;
	queueName?: string;
	workerId?: string;
	visibilityTimeoutMs?: number;
	heartbeatIntervalMs?: number;
	recoveryBatchSize?: number;
};

type DurableEnvelope = {
	version: 1;
	key: string;
	piboSessionId?: string;
	eventId?: string;
	state: PiboJsonValue;
};

type PendingJob = OutputPersistenceRetryJob & {
	attempts: number;
	maxAttempts: number;
	payload: PiboJsonValue;
	timer?: ReturnType<typeof setTimeout>;
	durableJobId?: string;
	durableClaimed?: boolean;
	durableClaimToken?: number;
	execution?: Promise<void>;
	abortController?: AbortController;
	heartbeatTimer?: ReturnType<typeof setInterval>;
	forcePendingAttempt?: boolean;
};

export type OutputPersistenceDeadLetter = {
	key: string;
	piboSessionId?: string;
	eventId?: string;
	attempts: number;
	error: string;
};

const DEFAULT_MAX_PENDING = 4_096;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 25;
const DEFAULT_MAX_DELAY_MS = 1_000;
const DEFAULT_MAX_DEAD_LETTERS = 1_024;
const DEFAULT_QUEUE_NAME = "output-persistence";
const DEFAULT_RECOVERY_BATCH_SIZE = 100;

class LostOutputPersistenceClaimError extends Error {
	constructor() {
		super("Lost durable output persistence claim");
		this.name = "LostOutputPersistenceClaimError";
	}
}

/**
 * Bounded retry with an optional durable Pibo reliability-job backing. The
 * durable envelope stores only correlation metadata plus the caller-owned
 * delivery phase. A recovered process supplies the executable handler again.
 */
export class OutputPersistenceRetryQueue {
	private readonly pending = new Map<string, PendingJob>();
	private readonly deadLetters: OutputPersistenceDeadLetter[] = [];
	private readonly maxPending: number;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly maxDeadLetters: number;
	private readonly durableStore?: PiboReliabilityStore;
	private readonly queueName: string;
	private readonly workerId: string;
	private readonly visibilityTimeoutMs: number;
	private readonly heartbeatIntervalMs: number;
	private readonly recoveryBatchSize: number;
	private readonly blockedDurableJobs = new Map<string, number>();
	private readonly changeWaiters = new Set<() => void>();
	private recoveryFactory?: (job: OutputPersistenceRecoveredJob) => OutputPersistenceRetryJob;
	private recoveryTimer?: ReturnType<typeof setTimeout>;
	private changeVersion = 0;
	private draining = false;
	private disposed = false;

	constructor(options: OutputPersistenceRetryQueueOptions = {}) {
		this.maxPending = positiveInteger(options.maxPending, DEFAULT_MAX_PENDING);
		this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
		this.baseDelayMs = positiveInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
		this.maxDelayMs = positiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS);
		this.maxDeadLetters = positiveInteger(options.maxDeadLetters, DEFAULT_MAX_DEAD_LETTERS);
		this.durableStore = options.durableStore;
		this.queueName = options.queueName ?? DEFAULT_QUEUE_NAME;
		this.workerId = options.workerId ?? `output-persistence:${process.pid}:${randomUUID()}`;
		this.visibilityTimeoutMs = positiveInteger(options.visibilityTimeoutMs, 30_000);
		this.heartbeatIntervalMs = Math.min(
			this.visibilityTimeoutMs,
			positiveInteger(options.heartbeatIntervalMs, Math.max(1, Math.floor(this.visibilityTimeoutMs / 3))),
		);
		this.recoveryBatchSize = positiveInteger(options.recoveryBatchSize, DEFAULT_RECOVERY_BATCH_SIZE);
	}

	enqueue(job: OutputPersistenceRetryJob): void {
		if (this.disposed) throw new Error("Output persistence retry queue is disposed");
		const existing = this.pending.get(job.key);
		if (existing) {
			const retryWasScheduled = existing.timer !== undefined;
			if (existing.timer) clearTimeout(existing.timer);
			existing.timer = undefined;
			// A retry timer is published only after run() has failed. Its Promise
			// bookkeeping can still be waiting for the next microtask, so clear that
			// settled execution before honoring an immediate producer replay.
			if (retryWasScheduled) existing.execution = undefined;
			this.startAttempt(existing, true);
			return;
		}
		if (this.pending.size >= this.maxPending) {
			this.recordDeadLetter(job, new Error("output persistence retry queue capacity exceeded"), 0, "capacity_exceeded", true);
			return;
		}
		const payload = job.payload ?? null;
		let durableJob: StoredPiboJob | undefined;
		if (this.durableStore) {
			durableJob = this.durableStore.enqueue({
				queue: this.queueName,
				payload: durableEnvelope(job, payload),
				maxAttempts: this.maxAttempts,
				idempotencyKey: job.key,
			});
		}
		const pending: PendingJob = {
			...job,
			payload,
			attempts: durableJob?.attempts ?? 0,
			maxAttempts: durableJob?.maxAttempts ?? this.maxAttempts,
			...(durableJob ? { durableJobId: durableJob.jobId } : {}),
		};
		this.pending.set(job.key, pending);
		this.notifyChange();
		this.startAttempt(pending, false);
	}

	quarantine(reasonCode: string): void {
		if (this.disposed) return;
		this.recordDeadLetter(
			{ key: `quarantine:${randomUUID()}`, payload: null, run() {} },
			new Error(reasonCode),
			0,
			reasonCode,
			true,
		);
	}

	recover(factory: (job: OutputPersistenceRecoveredJob) => OutputPersistenceRetryJob): void {
		if (!this.durableStore) return;
		this.recoveryFactory = factory;
		this.pumpRecovery();
	}

	flushNow(): void {
		for (const job of [...this.pending.values()]) {
			if (job.timer) clearTimeout(job.timer);
			job.timer = undefined;
			this.startAttempt(job, true);
		}
	}

	async drain(): Promise<void> {
		if (this.disposed) return;
		this.draining = true;
		try {
			for (;;) {
				const observedVersion = this.changeVersion;
				this.flushNow();
				this.pumpRecovery();
				const executions = [...this.pending.values()]
					.map((job) => job.execution)
					.filter((execution): execution is Promise<void> => execution !== undefined);
				if (executions.length > 0) {
					await Promise.allSettled(executions);
					continue;
				}
				const durableWorkRemains = !!this.recoveryFactory && !!this.durableStore?.hasRecoverableJobs(this.queueName, true);
				if (this.pending.size === 0 && !durableWorkRemains) return;
				this.scheduleRecovery();
				await this.waitForChange(observedVersion);
			}
		} finally {
			this.draining = false;
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
		this.recoveryTimer = undefined;
		for (const job of this.pending.values()) {
			if (job.timer) clearTimeout(job.timer);
			this.clearHeartbeat(job);
			job.abortController?.abort();
			if (job.durableJobId && job.durableClaimed) {
				this.durableStore?.releaseJob(job.durableJobId, this.workerId, 0, job.durableClaimToken);
			}
		}
		this.pending.clear();
		this.blockedDurableJobs.clear();
		this.notifyChange();
	}

	debugState(): { pending: number; activeHeartbeats: number; deadLetters: readonly OutputPersistenceDeadLetter[] } {
		return {
			pending: this.pending.size,
			activeHeartbeats: [...this.pending.values()].filter((job) => job.heartbeatTimer !== undefined).length,
			deadLetters: this.deadLetters.map((entry) => ({ ...entry })),
		};
	}

	private startAttempt(job: PendingJob, forcePending: boolean): void {
		if (!this.pending.has(job.key) || this.disposed) return;
		if (job.execution) {
			if (forcePending) job.forcePendingAttempt = true;
			return;
		}
		job.forcePendingAttempt = false;
		const execution = this.attempt(job, forcePending);
		job.execution = execution;
		void execution.finally(() => {
			if (job.execution === execution) job.execution = undefined;
			this.notifyChange();
			if (job.forcePendingAttempt && this.pending.has(job.key)) {
				job.forcePendingAttempt = false;
				if (job.timer) clearTimeout(job.timer);
				job.timer = undefined;
				this.startAttempt(job, true);
			}
			this.pumpRecovery();
		});
	}

	private async attempt(job: PendingJob, forcePending: boolean): Promise<void> {
		if (!this.pending.has(job.key) || this.disposed) return;
		let attempt = job.attempts + 1;
		if (job.durableJobId) {
			const claimed = this.durableStore?.claimRecoverableJob(job.durableJobId, this.workerId, this.visibilityTimeoutMs, forcePending);
			if (!claimed) {
				this.reconcileClaimMiss(job);
				return;
			}
			job.durableClaimed = true;
			job.durableClaimToken = claimed.claimToken;
			job.attempts = claimed.attempts;
			job.maxAttempts = claimed.maxAttempts;
			attempt = claimed.attempts;
			const parsed = parseDurableEnvelope(claimed.payload);
			if (!parsed.envelope) {
				this.durableStore?.quarantineJob(claimed.jobId, parsed.reason, correlationFields(job));
				this.pending.delete(job.key);
				return;
			}
			job.payload = parsed.envelope.state;
		} else {
			job.attempts = attempt;
		}
		const abortController = new AbortController();
		job.abortController = abortController;
		this.startHeartbeat(job, abortController);
		try {
			await job.run({
				payload: job.payload,
				attempt,
				signal: abortController.signal,
				updatePayload: (payload) => {
					job.payload = payload;
					if (job.durableJobId) {
						const updated = this.durableStore?.updateJobPayload(
							job.durableJobId,
							this.workerId,
							durableEnvelope(job, payload),
							job.durableClaimToken,
						);
						if (!updated) throw new LostOutputPersistenceClaimError();
					}
				},
			});
			if (abortController.signal.aborted) throw new LostOutputPersistenceClaimError();
			if (job.durableJobId && !this.durableStore?.ack(job.durableJobId, this.workerId, job.durableClaimToken)) {
				if (this.durableStore?.hasLiveJob(job.durableJobId)) throw new LostOutputPersistenceClaimError();
			}
			this.pending.delete(job.key);
			job.durableClaimed = false;
			try {
				job.onSuccess?.();
			} catch (error) {
				console.error("[pibo] output persistence success callback failed", { ...correlation(job, attempt, "callback_failed"), queue: this.queueName }, error);
			}
		} catch (error) {
			if (this.disposed) return;
			job.durableClaimed = false;
			if (job.durableJobId) {
				const retried = error instanceof LostOutputPersistenceClaimError ? false : this.durableStore?.retry(job.durableJobId, this.workerId, {
					error: errorMessage(error),
					delayMs: retryDelay(job.attempts, this.baseDelayMs, this.maxDelayMs),
					claimToken: job.durableClaimToken,
				});
				if (!retried) {
					this.reconcileClaimMiss(job);
					return;
				}
			}
			if (job.attempts >= job.maxAttempts) {
				this.pending.delete(job.key);
				this.recordDeadLetter(job, error, job.attempts, "max_attempts", false);
				return;
			}
			const delayMs = retryDelay(job.attempts, this.baseDelayMs, this.maxDelayMs);
			console.warn("[pibo] output persistence retry scheduled", { ...correlation(job, job.attempts, "pending"), queue: this.queueName });
			this.schedule(job, delayMs);
		} finally {
			this.clearHeartbeat(job);
			job.abortController = undefined;
			job.durableClaimToken = undefined;
		}
	}

	private schedule(job: PendingJob, delayMs: number): void {
		if (job.timer) clearTimeout(job.timer);
		job.timer = setTimeout(() => {
			job.timer = undefined;
			this.notifyChange();
			this.startAttempt(job, false);
		}, delayMs);
		job.timer.unref?.();
		this.notifyChange();
	}

	private recordDeadLetter(
		job: OutputPersistenceRetryJob,
		error: unknown,
		attempts: number,
		reason: string,
		persistDurable: boolean,
	): void {
		const entry = {
			key: job.key,
			piboSessionId: job.piboSessionId,
			eventId: job.eventId,
			attempts,
			error: errorMessage(error),
		};
		this.deadLetters.push(entry);
		if (this.deadLetters.length > this.maxDeadLetters) this.deadLetters.splice(0, this.deadLetters.length - this.maxDeadLetters);
		if (persistDurable && this.durableStore) {
			this.durableStore.deadLetter({
				queue: this.queueName,
				payload: sanitizedQuarantineEnvelope(job, reason),
				attempts,
				maxAttempts: this.maxAttempts,
				idempotencyKey: job.key,
				reason,
				error: errorMessage(error),
			});
		}
		console.error("[pibo] output persistence dead letter", { ...entry, queue: this.queueName, status: "dead" });
		try {
			job.onDeadLetter?.(error, attempts);
		} catch (callbackError) {
			console.error("[pibo] output persistence dead-letter callback failed", { ...correlation(job, attempts, "callback_failed"), queue: this.queueName }, callbackError);
		}
	}

	private pumpRecovery(): void {
		if (this.disposed || !this.recoveryFactory || !this.durableStore) return;
		const timestamp = Date.now();
		for (const [jobId, retryAt] of this.blockedDurableJobs) {
			if (retryAt <= timestamp) this.blockedDurableJobs.delete(jobId);
		}
		while (this.pending.size < this.maxPending) {
			const excludedJobIds = [
				...this.blockedDurableJobs.keys(),
				...[...this.pending.values()].flatMap((job) => job.durableJobId ? [job.durableJobId] : []),
			];
			const jobs = this.durableStore.listRecoverableJobs({
				queue: this.queueName,
				limit: Math.min(this.recoveryBatchSize, this.maxPending - this.pending.size),
				excludeJobIds: excludedJobIds,
				includeDeferredPending: this.draining,
			});
			if (jobs.length === 0) break;
			let admitted = 0;
			for (const durableJob of jobs) {
				const parsed = parseDurableEnvelope(durableJob.payload);
				if (!parsed.envelope) {
					this.durableStore.quarantineJob(durableJob.jobId, parsed.reason);
					continue;
				}
				const envelope = parsed.envelope;
				if (this.pending.has(envelope.key)) continue;
				let recovered: OutputPersistenceRetryJob;
				try {
					recovered = this.recoveryFactory({
						key: envelope.key,
						piboSessionId: envelope.piboSessionId,
						eventId: envelope.eventId,
						payload: envelope.state,
						attempts: durableJob.attempts,
						maxAttempts: durableJob.maxAttempts,
					});
				} catch {
					this.durableStore.quarantineJob(durableJob.jobId, "payload_invalid");
					continue;
				}
				const pending: PendingJob = {
					...recovered,
					key: envelope.key,
					piboSessionId: envelope.piboSessionId,
					eventId: envelope.eventId,
					payload: envelope.state,
					attempts: durableJob.attempts,
					maxAttempts: durableJob.maxAttempts,
					durableJobId: durableJob.jobId,
				};
				this.pending.set(pending.key, pending);
				admitted += 1;
				this.startAttempt(pending, this.draining);
			}
			this.notifyChange();
			if (admitted === 0 && jobs.every((job) => this.durableStore?.hasLiveJob(job.jobId))) break;
		}
		this.scheduleRecovery();
	}

	private reconcileClaimMiss(job: PendingJob): void {
		this.pending.delete(job.key);
		job.durableClaimed = false;
		if (job.durableJobId && this.durableStore?.hasLiveJob(job.durableJobId)) {
			this.blockedDurableJobs.set(job.durableJobId, Date.now() + this.baseDelayMs);
		}
		this.notifyChange();
		this.scheduleRecovery();
	}

	private startHeartbeat(job: PendingJob, abortController: AbortController): void {
		if (!job.durableJobId || job.durableClaimToken === undefined) return;
		job.heartbeatTimer = setInterval(() => {
			const renewed = this.durableStore?.heartbeat(
				job.durableJobId!,
				this.workerId,
				this.visibilityTimeoutMs,
				job.durableClaimToken,
			);
			if (!renewed) abortController.abort();
		}, this.heartbeatIntervalMs);
		job.heartbeatTimer.unref?.();
	}

	private clearHeartbeat(job: PendingJob): void {
		if (job.heartbeatTimer) clearInterval(job.heartbeatTimer);
		job.heartbeatTimer = undefined;
	}

	private scheduleRecovery(): void {
		if (this.disposed || !this.recoveryFactory || !this.durableStore || this.recoveryTimer) return;
		if (!this.durableStore.hasJobs(this.queueName)) return;
		const nextBlockedAt = Math.min(...this.blockedDurableJobs.values(), Date.now() + this.baseDelayMs);
		const delayMs = Math.max(1, nextBlockedAt - Date.now());
		this.recoveryTimer = setTimeout(() => {
			this.recoveryTimer = undefined;
			this.notifyChange();
			this.pumpRecovery();
		}, delayMs);
		this.recoveryTimer.unref?.();
	}

	private notifyChange(): void {
		this.changeVersion += 1;
		for (const resolve of this.changeWaiters) resolve();
		this.changeWaiters.clear();
	}

	private waitForChange(observedVersion: number): Promise<void> {
		if (this.changeVersion !== observedVersion) return Promise.resolve();
		return new Promise((resolve) => this.changeWaiters.add(resolve));
	}
}

function durableEnvelope(job: Pick<OutputPersistenceRetryJob, "key" | "piboSessionId" | "eventId">, state: PiboJsonValue): DurableEnvelope {
	return {
		version: 1,
		key: job.key,
		...(job.piboSessionId ? { piboSessionId: job.piboSessionId } : {}),
		...(job.eventId ? { eventId: job.eventId } : {}),
		state,
	};
}

function parseDurableEnvelope(value: PiboJsonValue): { envelope?: DurableEnvelope; reason: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { reason: "payload_malformed" };
	const candidate = value as Record<string, PiboJsonValue | undefined>;
	if (candidate.version !== 1) return { reason: "payload_version_unsupported" };
	if (typeof candidate.key !== "string" || !("state" in candidate)) return { reason: "payload_malformed" };
	return {
		reason: "",
		envelope: {
			version: 1,
			key: candidate.key,
			...(typeof candidate.piboSessionId === "string" ? { piboSessionId: candidate.piboSessionId } : {}),
			...(typeof candidate.eventId === "string" ? { eventId: candidate.eventId } : {}),
			state: candidate.state ?? null,
		},
	};
}

function sanitizedQuarantineEnvelope(
	job: Pick<OutputPersistenceRetryJob, "key" | "piboSessionId" | "eventId">,
	reasonCode: string,
): DurableEnvelope {
	return durableEnvelope(job, { phase: "quarantined", reasonCode });
}

function correlationFields(
	job: Pick<OutputPersistenceRetryJob, "key" | "piboSessionId" | "eventId">,
): { key: string; piboSessionId?: string; eventId?: string } {
	return { key: job.key, ...(job.piboSessionId ? { piboSessionId: job.piboSessionId } : {}), ...(job.eventId ? { eventId: job.eventId } : {}) };
}

function retryDelay(attempts: number, baseDelayMs: number, maxDelayMs: number): number {
	return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempts - 1)));
}

function correlation(job: Pick<OutputPersistenceRetryJob, "key" | "piboSessionId" | "eventId">, attempt: number, status: string): Record<string, unknown> {
	return { queue: DEFAULT_QUEUE_NAME, key: job.key, piboSessionId: job.piboSessionId, eventId: job.eventId, attempt, status };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
