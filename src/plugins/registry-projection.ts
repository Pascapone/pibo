import type { PluginContribution } from "./manifest.js";
import { PluginHost } from "./host.js";
import { PluginScope } from "./scope.js";

/** Legacy API projections share the host's ownership index; there is no copied active catalog. */
export class PluginRegistryProjection {
	host = new PluginHost();
	private readonly root = new PluginScope("pibo.legacy-composition");
	private current = this.root;

	withScope<T>(scope: PluginScope, action: () => T): T {
		scope.assertOpen();
		const previous = this.current; this.current = scope;
		try { return action(); } finally { this.current = previous; }
	}

	map<T>(kind: string, project?: (value: unknown, contribution: PluginContribution, pluginId: string) => T): Map<string, T> {
		const projection = this;
		const read = (): Map<string, T> => {
			const values = new Map(projection.host.contributions.list<T>(`legacy:${kind}`).map((entry) => [entry.key, entry.value]));
			if (project) for (const entry of projection.host.contributions.list<{ contribution: PluginContribution; value: unknown }>("contribution")) {
				const c = entry.value.contribution;
				if (c.kind !== kind) continue;
				const key = c.name ?? c.id;
				if (values.has(key)) throw new Error(`Legacy/${kind} projection conflicts with host contribution ${entry.key}`);
				values.set(key, project(entry.value.value, c, entry.owner));
			}
			return values;
		};
		return new class extends Map<string, T> {
			override get size() { return read().size; }
			override get(key: string) { return read().get(key); }
			override has(key: string) { return read().has(key); }
			override set(key: string, value: T): this {
				projection.current.assertOpen();
				const existing = projection.host.contributions.list(`legacy:${kind}`).find((entry) => entry.key === key);
				if (existing && existing.owner !== projection.current.pluginId && projection.current !== projection.root) throw new Error(`${kind} ${key} belongs to ${existing.owner}, not ${projection.current.pluginId}`);
				if (!existing && read().has(key)) throw new Error(`${kind} ${key} belongs to an active host contribution`);
				if (existing) projection.host.contributions.remove(`legacy:${kind}`, key);
				projection.host.contributions.register(projection.current, `legacy:${kind}`, key, value);
				return this;
			}
			override delete(key: string): boolean {
				projection.current.assertOpen();
				const existing = projection.host.contributions.list(`legacy:${kind}`).find((entry) => entry.key === key);
				if (existing && existing.owner !== projection.current.pluginId && projection.current !== projection.root) throw new Error(`${kind} ${key} belongs to ${existing.owner}`);
				return projection.host.contributions.remove(`legacy:${kind}`, key);
			}
			override clear(): void { for (const key of this.keys()) this.delete(key); }
			override entries() { return read().entries(); }
			override keys() { return read().keys(); }
			override values() { return read().values(); }
			override [Symbol.iterator]() { return this.entries(); }
			override forEach(callback: (value: T, key: string, map: Map<string, T>) => void, thisArg?: unknown): void {
				for (const [key, value] of read()) callback.call(thisArg, value, key, this);
			}
		}();
	}
}
