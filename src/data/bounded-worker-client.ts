import { Worker, type WorkerOptions } from "node:worker_threads";

export type StoragePriority = "admission" | "output" | "background";
export class StorageUnavailableError extends Error {
	constructor(readonly code: "storage_overloaded" | "storage_deadline" | "storage_unknown" | "storage_closed" | "storage_worker_failed" | "storage_payload_limit", message: string) {
		super(message);
		this.name = "StorageUnavailableError";
	}
}
export type BoundedWorkerOptions = {
	maxPending?: number;
	maxPendingBytes?: number;
	maxMessageBytes?: number;
	maxAgeMs?: number;
	agingMs?: number;
	startupTimeoutMs?: number;
	workerOptions?: WorkerOptions;
};
type Pending = {
	id: number;
	command: unknown;
	bytes: number;
	priority: number;
	queuedAt: number;
	deadline: number;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
	settled: boolean;
};

/** Count bounded structured data without creating a second serialized payload. */
export function boundedMessageBytes(value: unknown, maximum: number): number {
	let bytes = 0;
	let nodes = 0;
	const stack: Array<{ value: unknown; leave?: boolean }> = [{ value }];
	const seen = new Set<object>();
	while (stack.length) {
		const frame = stack.pop()!;
		const item = frame.value;
		if (frame.leave) { seen.delete(item as object); continue; }
		if (++nodes > 100_000) throw new StorageUnavailableError("storage_payload_limit", "Storage message has too many fields.");
		if (typeof item === "string") bytes += Buffer.byteLength(item, "utf8") + 8;
		else if (item === null || item === undefined || typeof item === "boolean" || typeof item === "number") bytes += 8;
		else if (ArrayBuffer.isView(item)) bytes += item.byteLength + 16;
		else if (item instanceof ArrayBuffer) bytes += item.byteLength + 16;
		else if (typeof item === "object") {
			if (seen.has(item)) throw new StorageUnavailableError("storage_payload_limit", "Storage messages must be acyclic.");
			seen.add(item);
			stack.push({ value: item, leave: true });
			bytes += 16;
			for (const key in item) {
				if (!Object.hasOwn(item, key)) continue;
				const child = (item as Record<string, unknown>)[key];
				bytes += Buffer.byteLength(key, "utf8") + 8;
				stack.push({ value: child });
				if (stack.length > 100_000 || bytes > maximum) throw new StorageUnavailableError("storage_payload_limit", "Storage message exceeds its budget.");
			}
		} else throw new StorageUnavailableError("storage_payload_limit", "Unsupported storage message value.");
		if (bytes > maximum) throw new StorageUnavailableError("storage_payload_limit", "Storage message exceeds its byte budget; use payload references.");
	}
	return bytes;
}

/** One in-flight RPC keeps the worker's hidden message queue bounded. */
export class BoundedWorkerClient {
	private readonly worker: Worker;
	private readonly queue: Pending[] = [];
	private inFlight?: Pending;
	private pendingBytes = 0;
	private nextId = 0;
	private ready = false;
	private closed = false;
	private exited = false;
	private termination?: Promise<number>;
	private readonly startupTimer: ReturnType<typeof setTimeout>;
	private completed = 0;
	private rejected = 0;
	private lastResponseAt?: number;
	private workerIdentity?: Record<string, unknown>;
	private readonly maximum: Required<Omit<BoundedWorkerOptions, "workerOptions">>;

	constructor(url: URL, options: BoundedWorkerOptions = {}) {
		this.maximum = {
			maxPending: options.maxPending ?? 128,
			maxPendingBytes: options.maxPendingBytes ?? 8 * 1024 * 1024,
			maxMessageBytes: options.maxMessageBytes ?? 1024 * 1024,
			maxAgeMs: options.maxAgeMs ?? 500,
			agingMs: options.agingMs ?? 100,
			startupTimeoutMs: options.startupTimeoutMs ?? 10_000,
		};
		for (const limit of Object.values(this.maximum)) if (!Number.isFinite(limit) || limit <= 0) throw new Error("Storage budgets must be positive finite numbers.");
		this.worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: 256 }, ...options.workerOptions });
		this.worker.unref();
		this.startupTimer = setTimeout(() => this.fail(new StorageUnavailableError("storage_worker_failed", "Storage worker startup timed out.")), this.maximum.startupTimeoutMs);
		this.worker.on("message", (message: { ready?: boolean; worker?: Record<string, unknown>; id?: number; value?: unknown; error?: { code?: string; message?: string } }) => {
			this.lastResponseAt = performance.now();
			if (message.worker) this.workerIdentity = message.worker;
			if (message.ready) { clearTimeout(this.startupTimer); this.ready = true; this.workerIdentity = message.worker; this.pump(); return; }
			const pending = this.inFlight;
			if (!pending || message.id !== pending.id) return;
			this.inFlight = undefined;
			this.pendingBytes -= pending.bytes;
			clearTimeout(pending.timer);
			if (!pending.settled) {
				pending.settled = true;
				if (message.error) {
					this.rejected++;
					pending.reject(Object.assign(new Error(message.error.message ?? "Storage operation failed."), { code: message.error.code ?? "storage_operation_failed" }));
				} else {
					try { boundedMessageBytes(message.value, this.maximum.maxMessageBytes); this.completed++; pending.resolve(message.value); }
					catch (error) { this.rejected++; pending.reject(error as Error); }
				}
			}
			this.pump();
		});
		this.worker.on("error", () => this.fail(new StorageUnavailableError("storage_worker_failed", "Storage worker failed; in-flight commit state must be reconciled.")));
		this.worker.on("exit", () => { this.exited=true; if (!this.closed) this.fail(new StorageUnavailableError("storage_worker_failed", "Storage worker exited.")); });
	}

	request<T>(command: unknown, options: { priority?: StoragePriority; timeoutMs?: number } = {}): Promise<T> {
		if (this.closed) return Promise.reject(new StorageUnavailableError("storage_closed", "Storage worker is closed."));
		let bytes: number;
		try { bytes = boundedMessageBytes(command, this.maximum.maxMessageBytes); } catch (error) { return Promise.reject(error); }
		if (this.queue.length + Number(Boolean(this.inFlight)) >= this.maximum.maxPending || this.pendingBytes + bytes > this.maximum.maxPendingBytes) {
			this.rejected++;
			return Promise.reject(new StorageUnavailableError("storage_overloaded", "Storage capacity exhausted; retry with the same transaction ID."));
		}
		const age = Math.min(options.timeoutMs ?? this.maximum.maxAgeMs, this.maximum.maxAgeMs);
		if (!Number.isFinite(age) || age <= 0) return Promise.reject(new StorageUnavailableError("storage_deadline", "Storage deadline elapsed."));
		return new Promise<T>((resolve, reject) => {
			const now = performance.now();
			const pending: Pending = {
				id: ++this.nextId, command, bytes, queuedAt: now, deadline: now + age,
				priority: options.priority === "background" ? 2 : options.priority === "output" ? 1 : 0,
				resolve: value => resolve(value as T), reject, settled: false,
				timer: setTimeout(() => {
					if (pending.settled) return;
					pending.settled = true;
					this.rejected++;
					if (this.inFlight === pending) {
						reject(new StorageUnavailableError("storage_unknown", "Storage response deadline elapsed; reconcile the same transaction ID before retrying."));
						this.fail(new StorageUnavailableError("storage_worker_failed", "Storage worker exceeded its execution deadline."));
					}
					else {
						const index = this.queue.indexOf(pending);
						if (index >= 0) { this.queue.splice(index, 1); this.pendingBytes -= pending.bytes; }
						reject(new StorageUnavailableError("storage_deadline", "Storage queue deadline elapsed before execution."));
					}
				}, age),
			};
			this.pendingBytes += bytes;
			this.queue.push(pending);
			this.pump();
		});
	}

	status() {
		return { ready: this.ready, closed: this.closed, exited:this.exited, queued: this.queue.length, inFlight: Boolean(this.inFlight), pendingBytes: this.pendingBytes, oldestAgeMs: Math.max(0, ...this.queue.map(entry => performance.now() - entry.queuedAt), this.inFlight ? performance.now() - this.inFlight.queuedAt : 0), lastResponseAgeMs: this.lastResponseAt === undefined ? undefined : performance.now() - this.lastResponseAt, completed: this.completed, rejected: this.rejected, worker: this.workerIdentity, limits: { ...this.maximum } };
	}
	async close(): Promise<void> {
		this.fail(new StorageUnavailableError("storage_closed", "Storage worker closed; reconcile any in-flight transaction."), false);
		await (this.termination ??= this.worker.terminate());
	}
	private fail(error: Error, terminateWorker = true): void {
		if (this.closed) return;
		this.closed = true;
		clearTimeout(this.startupTimer);
		for (const pending of [...this.queue, ...(this.inFlight ? [this.inFlight] : [])]) {
			clearTimeout(pending.timer);
			if (!pending.settled) { pending.settled = true; pending.reject(pending === this.inFlight ? new StorageUnavailableError("storage_unknown", "Storage worker stopped during execution; reconcile the transaction ID.") : error); this.rejected++; }
		}
		this.queue.length = 0;
		this.inFlight = undefined;
		this.pendingBytes = 0;
		if (terminateWorker) this.termination ??= this.worker.terminate();
	}
	private pump(): void {
		if (!this.ready || this.closed || this.inFlight || !this.queue.length) return;
		const now = performance.now();
		let index = 0;
		const score = (entry: Pending) => entry.priority - (now - entry.queuedAt) / this.maximum.agingMs;
		for (let i = 1; i < this.queue.length; i++) if (score(this.queue[i]!) < score(this.queue[index]!)) index = i;
		const pending = this.queue.splice(index, 1)[0]!;
		this.inFlight = pending;
		try { this.worker.postMessage({ id: pending.id, command: pending.command, deadline: pending.deadline, maxResultBytes: this.maximum.maxMessageBytes }); }
		catch { this.fail(new StorageUnavailableError("storage_worker_failed", "Storage IPC failed.")); }
	}
}
