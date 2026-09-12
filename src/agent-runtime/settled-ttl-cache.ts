export class SettledTtlCache<T> {
	private pending?: Promise<T>;
	private resolved?: { expiresAt: number; value: T };

	constructor(
		private readonly ttlMs: number,
		private readonly now: () => number = Date.now,
	) {}

	peek(): T | undefined {
		if (!this.resolved || this.resolved.expiresAt <= this.now()) return undefined;
		return this.resolved.value;
	}

	load(loader: () => Promise<T>): Promise<T> {
		const resolved = this.peek();
		if (resolved !== undefined) return Promise.resolve(resolved);
		if (this.pending) return this.pending;
		const pending = Promise.resolve().then(loader);
		this.pending = pending;
		pending.then((value) => {
			if (this.pending !== pending) return;
			this.resolved = { expiresAt: this.now() + this.ttlMs, value };
			this.pending = undefined;
		}).catch(() => {
			if (this.pending === pending) this.pending = undefined;
		});
		return pending;
	}

	invalidate(): void {
		this.pending = undefined;
		this.resolved = undefined;
	}
}
