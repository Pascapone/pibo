import type { PluginContribution } from "./manifest.js";
import { PluginHost } from "./host.js";
import { PluginScope } from "./scope.js";

/** Typed Core capability access shares the PluginHost ownership index; there is no copied plugin catalog. */
export class CapabilityProjection {
	host = new PluginHost();
	private readonly root = new PluginScope("@pibo/core", "@pibo/core/capabilities");

	map<T>(kind: string, project?: (value: unknown, contribution: PluginContribution, pluginId: string) => T): Map<string, T> {
		const projection = this;
		const read = (): Map<string, T> => {
			const values = new Map(projection.host.contributions.list<T>(`resource:${kind}`).map((entry) => [entry.key, entry.value]));
			if (project) for (const entry of projection.host.contributions.list<{ contribution: PluginContribution; value: unknown }>("contribution")) {
				const c = entry.value.contribution;
				if (c.kind !== kind) continue;
				const key = c.name ?? c.id;
				if (values.has(key)) throw new Error(`Core ${kind} resource conflicts with host contribution ${entry.key}`);
				values.set(key, project(entry.value.value, c, entry.owner));
			}
			return values;
		};
		return new class extends Map<string, T> {
			override get size() { return read().size; }
			override get(key: string) { return read().get(key); }
			override has(key: string) { return read().has(key); }
			override set(key: string, value: T): this {
				projection.root.assertOpen();
				const existing = projection.host.contributions.list(`resource:${kind}`).find((entry) => entry.key === key);
				if (!existing && read().has(key)) throw new Error(`${kind} ${key} belongs to an active plugin contribution`);
				if (existing) projection.host.contributions.remove(`resource:${kind}`, key, projection.root.instanceId);
				projection.host.contributions.register(projection.root, `resource:${kind}`, key, value);
				return this;
			}
			override delete(key: string): boolean {
				projection.root.assertOpen();
				return projection.host.contributions.remove(`resource:${kind}`, key, projection.root.instanceId);
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
