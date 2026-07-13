import type { TelemetryStore } from "./telemetry.js";

export type AsyncTelemetryWriterOptions = {
	/** Delay used to collect telemetry from concurrent routed sessions into one transaction. */
	flushIntervalMs?: number;
	/** Hard queue bound. Reaching it drains synchronously rather than dropping telemetry. */
	maxPendingOperations?: number;
	onError?: (error: unknown) => void;
};

type PendingTelemetryOperation = {
	write: () => void;
	onError?: (error: unknown) => void;
};

const DEFAULT_FLUSH_INTERVAL_MS = 25;
const DEFAULT_MAX_PENDING_OPERATIONS = 1_024;

/**
 * Gateway-scoped, ordered telemetry writer.
 *
 * Normal writes are deferred briefly so telemetry from multiple routed sessions
 * shares one SQLite transaction. The queue never drops lifecycle events: when
 * the hard bound is reached, it drains immediately in the caller instead.
 */
export class AsyncTelemetryWriter {
	private readonly flushIntervalMs: number;
	private readonly maxPendingOperations: number;
	private pending: PendingTelemetryOperation[] = [];
	private flushTimer?: ReturnType<typeof setTimeout>;
	private flushing = false;
	private closed = false;

	constructor(
		private readonly store: TelemetryStore,
		private readonly options: AsyncTelemetryWriterOptions = {},
	) {
		this.flushIntervalMs = nonNegativeFinite(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS);
		this.maxPendingOperations = positiveInteger(options.maxPendingOperations, DEFAULT_MAX_PENDING_OPERATIONS);
	}

	enqueue(write: () => void, onError?: (error: unknown) => void): boolean {
		if (this.closed) {
			this.reportError(new Error("Telemetry writer is closed."), onError);
			return false;
		}
		this.pending.push({ write, onError });
		if (this.pending.length >= this.maxPendingOperations) {
			this.flushNow();
		} else {
			this.scheduleFlush();
		}
		return true;
	}

	async flush(): Promise<void> {
		this.flushNow();
	}

	async dispose(): Promise<void> {
		if (this.closed) return;
		this.flushNow();
		this.closed = true;
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			this.flushNow();
		}, this.flushIntervalMs);
		this.flushTimer.unref();
	}

	private flushNow(): void {
		if (this.flushing) return;
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = undefined;
		this.flushing = true;
		try {
			while (this.pending.length > 0) {
				const batch = this.pending;
				this.pending = [];
				try {
					this.store.transaction(() => {
						for (const operation of batch) {
							try {
								operation.write();
							} catch (error) {
								this.reportError(error, operation.onError);
							}
						}
					});
				} catch (error) {
					for (const operation of batch) this.reportError(error, operation.onError);
				}
			}
		} finally {
			this.flushing = false;
			if (!this.closed && this.pending.length > 0) this.scheduleFlush();
		}
	}

	private reportError(error: unknown, operationHandler?: (error: unknown) => void): void {
		try {
			operationHandler?.(error);
		} catch {
			// Telemetry error reporting must not affect runtime work.
		}
		if (operationHandler === this.options.onError) return;
		try {
			this.options.onError?.(error);
		} catch {
			// Telemetry error reporting must not affect runtime work.
		}
	}
}

function nonNegativeFinite(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
