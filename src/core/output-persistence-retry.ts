export type OutputPersistenceRetryJob = {
	key: string;
	run(): void;
	onSuccess?(): void;
	onDeadLetter?(error: unknown, attempts: number): void;
};

export type OutputPersistenceRetryQueueOptions = {
	maxPending?: number;
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	maxDeadLetters?: number;
};

type PendingJob = OutputPersistenceRetryJob & {
	attempts: number;
	timer?: ReturnType<typeof setTimeout>;
};

export type OutputPersistenceDeadLetter = {
	key: string;
	attempts: number;
	error: string;
};

const DEFAULT_MAX_PENDING = 4_096;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 25;
const DEFAULT_MAX_DELAY_MS = 1_000;
const DEFAULT_MAX_DEAD_LETTERS = 1_024;

/**
 * Bounded automatic retry for synchronous projection writes. Jobs keep their
 * original deterministic delivery key and prepared compaction until success,
 * so retries cannot mint a second persistence identity.
 */
export class OutputPersistenceRetryQueue {
	private readonly pending = new Map<string, PendingJob>();
	private readonly deadLetters: OutputPersistenceDeadLetter[] = [];
	private readonly maxPending: number;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly maxDelayMs: number;
	private readonly maxDeadLetters: number;
	private disposed = false;

	constructor(options: OutputPersistenceRetryQueueOptions = {}) {
		this.maxPending = positiveInteger(options.maxPending, DEFAULT_MAX_PENDING);
		this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
		this.baseDelayMs = positiveInteger(options.baseDelayMs, DEFAULT_BASE_DELAY_MS);
		this.maxDelayMs = positiveInteger(options.maxDelayMs, DEFAULT_MAX_DELAY_MS);
		this.maxDeadLetters = positiveInteger(options.maxDeadLetters, DEFAULT_MAX_DEAD_LETTERS);
	}

	enqueue(job: OutputPersistenceRetryJob): void {
		if (this.disposed) throw new Error("Output persistence retry queue is disposed");
		const existing = this.pending.get(job.key);
		if (existing) {
			if (existing.timer) clearTimeout(existing.timer);
			existing.timer = undefined;
			this.attempt(existing);
			return;
		}
		if (this.pending.size >= this.maxPending) {
			this.recordDeadLetter(job, new Error("output persistence retry queue capacity exceeded"), 0);
			return;
		}
		const pending = { ...job, attempts: 0 };
		this.pending.set(job.key, pending);
		this.attempt(pending);
	}

	flushNow(): void {
		for (const job of [...this.pending.values()]) {
			if (job.timer) clearTimeout(job.timer);
			job.timer = undefined;
			this.attempt(job);
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
		while (this.pending.size > 0) this.flushNow();
		this.disposed = true;
		for (const job of this.pending.values()) if (job.timer) clearTimeout(job.timer);
		this.pending.clear();
	}

	debugState(): { pending: number; deadLetters: readonly OutputPersistenceDeadLetter[] } {
		return { pending: this.pending.size, deadLetters: this.deadLetters.map((entry) => ({ ...entry })) };
	}

	private attempt(job: PendingJob): void {
		if (!this.pending.has(job.key)) return;
		job.attempts += 1;
		try {
			job.run();
			this.pending.delete(job.key);
			try {
				job.onSuccess?.();
			} catch (error) {
				console.error("[pibo] output persistence success callback failed", error);
			}
		} catch (error) {
			if (job.attempts >= this.maxAttempts) {
				this.pending.delete(job.key);
				this.recordDeadLetter(job, error, job.attempts);
				return;
			}
			const delayMs = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** (job.attempts - 1)));
			job.timer = setTimeout(() => {
				job.timer = undefined;
				this.attempt(job);
			}, delayMs);
			job.timer.unref?.();
		}
	}

	private recordDeadLetter(job: OutputPersistenceRetryJob, error: unknown, attempts: number): void {
		const entry = { key: job.key, attempts, error: error instanceof Error ? error.message : String(error) };
		this.deadLetters.push(entry);
		if (this.deadLetters.length > this.maxDeadLetters) this.deadLetters.splice(0, this.deadLetters.length - this.maxDeadLetters);
		try {
			job.onDeadLetter?.(error, attempts);
		} catch (callbackError) {
			console.error("[pibo] output persistence dead-letter callback failed", callbackError);
		}
	}
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
