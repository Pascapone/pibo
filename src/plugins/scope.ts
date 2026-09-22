export type PluginDisposer = () => void | Promise<void>;

/** One ownership boundary. Cleanup is LIFO, exhaustive, asynchronous and once-only. */
export class PluginScope {
	readonly signal: AbortSignal;
	private readonly controller = new AbortController();
	private readonly disposers: PluginDisposer[] = [];
	private disposal?: Promise<void>;
	private readonly children = new Set<PluginScope>();
	private onDisposed?: () => void;
	private state: "open" | "disposing" | "disposed" | "failed" = "open";

	constructor(readonly pluginId: string, readonly instanceId: string = pluginId) {
		this.signal = this.controller.signal;
	}

	get status() { return this.state; }
	get activeChildren(): number { return [...this.children].filter((child) => child.status !== "disposed").length; }

	assertOpen(): void {
		if (this.state !== "open") throw new Error(`Plugin scope ${this.instanceId} is ${this.state}`);
	}

	defer(disposer: PluginDisposer): () => Promise<void> {
		this.assertOpen();
		if (typeof disposer !== "function") throw new TypeError("Plugin disposer must be a function");
		let result: Promise<void> | undefined;
		const once = () => result ??= Promise.resolve().then(disposer);
		this.disposers.push(once);
		return once;
	}

	child(instanceId: string): PluginScope {
		this.assertOpen();
		const child = new PluginScope(this.pluginId, `${this.instanceId}/${instanceId}`);
		this.children.add(child);
		const disposeChild = this.defer(() => child.dispose());
		child.onDisposed = () => {
			this.children.delete(child);
			const index = this.disposers.indexOf(disposeChild);
			if (index >= 0) this.disposers.splice(index, 1);
		};
		return child;
	}

	/** Register a listener without importing DOM/Node EventEmitter types. */
	listen(target: { addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void }, type: string, listener: () => void): PluginDisposer {
		this.assertOpen();
		target.addEventListener(type, listener);
		return this.defer(() => target.removeEventListener(type, listener));
	}

	interval(callback: () => void, milliseconds: number): PluginDisposer {
		this.assertOpen();
		if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new Error("Plugin interval must be positive and finite");
		const timer = setInterval(callback, milliseconds);
		return this.defer(() => clearInterval(timer));
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.state = "disposing";
		this.controller.abort();
		this.disposal = Promise.resolve().then(async () => {
			const errors: unknown[] = [];
			for (const dispose of this.disposers.splice(0).reverse()) {
				try { await dispose(); } catch (error) { errors.push(error); }
			}
			this.state = errors.length ? "failed" : "disposed";
			if (errors.length) throw new AggregateError(errors, `Plugin scope ${this.instanceId} cleanup failed`);
			const onDisposed = this.onDisposed;
			this.onDisposed = undefined;
			onDisposed?.();
		});
		return this.disposal;
	}
}
