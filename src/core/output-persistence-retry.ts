import { randomUUID } from "node:crypto";
import type { PiboJsonValue } from "./events.js";
import type { PiboReliabilityStore, StoredPiboJob } from "../reliability/store.js";

export type OutputPersistenceRetryContext = {
	payload: PiboJsonValue;
	attempt: number;
	updatePayload(payload: PiboJsonValue): void;
};

export type OutputPersistenceRetryJob = {
	key: string;
	piboSessionId?: string;
	eventId?: string;
	payload?: PiboJsonValue;
	run(context: OutputPersistenceRetryContext): void;
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
};

type DurableEnvelope = {
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
	}

	enqueue(job: OutputPersistenceRetryJob): void {
		if (this.disposed) throw new Error("Output persistence retry queue is disposed");
		const existing = this.pending.get(job.key);
		if (existing) {
			if (existing.timer) clearTimeout(existing.timer);
			existing.timer = undefined;
			this.attempt(existing, true);
			return;
		}
		if (this.pending.size >= this.maxPending) {
			this.recordDeadLetter(job, new Error("output persistence retry queue capacity exceeded"), 0);
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
		this.attempt(pending, false);
	}

	recover(factory: (job: OutputPersistenceRecoveredJob) => OutputPersistenceRetryJob): void {
		if (!this.durableStore) return;
		for (const durableJob of this.durableStore.listJobs({ queue: this.queueName, limit: this.maxPending })) {
			const envelope = parseDurableEnvelope(durableJob.payload);
			if (!envelope || this.pending.has(envelope.key)) continue;
			const recovered = factory({
				key: envelope.key,
				piboSessionId: envelope.piboSessionId,
				eventId: envelope.eventId,
				payload: envelope.state,
				attempts: durableJob.attempts,
				maxAttempts: durableJob.maxAttempts,
			});
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
			this.attempt(pending, false);
		}
	}

	flushNow(): void {
		for (const job of [...this.pending.values()]) {
			if (job.timer) clearTimeout(job.timer);
			job.timer = undefined;
			this.attempt(job, true);
		}
	}

	async drain(): Promise<void> {
		while (this.pending.size > 0) {
			this.flushNow();
			await Promise.resolve();
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const job of this.pending.values()) {
			if (job.timer) clearTimeout(job.timer);
			if (job.durableJobId && job.durableClaimed) {
				this.durableStore?.releaseJob(job.durableJobId, this.workerId);
			}
		}
		this.pending.clear();
	}

	debugState(): { pending: number; deadLetters: readonly OutputPersistenceDeadLetter[] } {
		return { pending: this.pending.size, deadLetters: this.deadLetters.map((entry) => ({ ...entry })) };
	}

	private attempt(job: PendingJob, forcePending: boolean): void {
		if (!this.pending.has(job.key) || this.disposed) return;
		let attempt = job.attempts + 1;
		if (job.durableJobId) {
			const claimed = this.durableStore?.claimRecoverableJob(job.durableJobId, this.workerId, this.visibilityTimeoutMs, forcePending);
			if (!claimed) {
				this.schedule(job, this.baseDelayMs);
				return;
			}
			job.durableClaimed = true;
			job.attempts = claimed.attempts;
			job.maxAttempts = claimed.maxAttempts;
			attempt = claimed.attempts;
			const envelope = parseDurableEnvelope(claimed.payload);
			if (envelope) job.payload = envelope.state;
		} else {
			job.attempts = attempt;
		}
		try {
			job.run({
				payload: job.payload,
				attempt,
				updatePayload: (payload) => {
					job.payload = payload;
					if (job.durableJobId) {
						const updated = this.durableStore?.updateJobPayload(
							job.durableJobId,
							this.workerId,
							durableEnvelope(job, payload),
						);
						if (!updated) throw new Error("Failed to persist output delivery phase");
					}
				},
			});
			if (job.durableJobId && !this.durableStore?.ack(job.durableJobId, this.workerId)) {
				throw new Error("Failed to acknowledge durable output persistence job");
			}
			this.pending.delete(job.key);
			try {
				job.onSuccess?.();
			} catch (error) {
				console.error("[pibo] output persistence success callback failed", { ...correlation(job, attempt, "callback_failed"), queue: this.queueName }, error);
			}
		} catch (error) {
			job.durableClaimed = false;
			if (job.durableJobId) {
				this.durableStore?.retry(job.durableJobId, this.workerId, {
					error: errorMessage(error),
					delayMs: retryDelay(job.attempts, this.baseDelayMs, this.maxDelayMs),
				});
			}
			if (job.attempts >= job.maxAttempts) {
				this.pending.delete(job.key);
				this.recordDeadLetter(job, error, job.attempts);
				return;
			}
			const delayMs = retryDelay(job.attempts, this.baseDelayMs, this.maxDelayMs);
			console.warn("[pibo] output persistence retry scheduled", { ...correlation(job, job.attempts, "pending"), queue: this.queueName });
			this.schedule(job, delayMs);
		}
	}

	private schedule(job: PendingJob, delayMs: number): void {
		if (job.timer) clearTimeout(job.timer);
		job.timer = setTimeout(() => {
			job.timer = undefined;
			this.attempt(job, false);
		}, delayMs);
		job.timer.unref?.();
	}

	private recordDeadLetter(job: OutputPersistenceRetryJob, error: unknown, attempts: number): void {
		const entry = {
			key: job.key,
			piboSessionId: job.piboSessionId,
			eventId: job.eventId,
			attempts,
			error: errorMessage(error),
		};
		this.deadLetters.push(entry);
		if (this.deadLetters.length > this.maxDeadLetters) this.deadLetters.splice(0, this.deadLetters.length - this.maxDeadLetters);
		console.error("[pibo] output persistence dead letter", { ...entry, queue: this.queueName, status: "dead" });
		try {
			job.onDeadLetter?.(error, attempts);
		} catch (callbackError) {
			console.error("[pibo] output persistence dead-letter callback failed", { ...correlation(job, attempts, "callback_failed"), queue: this.queueName }, callbackError);
		}
	}
}

function durableEnvelope(job: Pick<OutputPersistenceRetryJob, "key" | "piboSessionId" | "eventId">, state: PiboJsonValue): DurableEnvelope {
	return {
		key: job.key,
		...(job.piboSessionId ? { piboSessionId: job.piboSessionId } : {}),
		...(job.eventId ? { eventId: job.eventId } : {}),
		state,
	};
}

function parseDurableEnvelope(value: PiboJsonValue): DurableEnvelope | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, PiboJsonValue | undefined>;
	if (typeof candidate.key !== "string" || !("state" in candidate)) return undefined;
	return {
		key: candidate.key,
		...(typeof candidate.piboSessionId === "string" ? { piboSessionId: candidate.piboSessionId } : {}),
		...(typeof candidate.eventId === "string" ? { eventId: candidate.eventId } : {}),
		state: candidate.state ?? null,
	};
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
