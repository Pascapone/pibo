import type { PluginScope } from "./scope.js";

export type OwnedPluginRegistration<T = unknown> = { owner: string; scopeId: string; kind: string; key: string; value: T };

/** Shared index for all executable registrations, including service-defined contribution kinds. */
export class PluginContributionRegistry {
	private readonly entries = new Map<string, OwnedPluginRegistration>();

	register<T>(scope: PluginScope, kind: string, key: string, value: T): () => Promise<void> {
		scope.assertOpen();
		if (!kind || !key) throw new Error("Plugin registration requires a kind and key");
		const identity = JSON.stringify([kind, key]);
		const existing = this.entries.get(identity);
		if (existing) throw new Error(`Duplicate ${kind} ${key}: ${existing.owner} and ${scope.pluginId}`);
		const entry = { owner: scope.pluginId, scopeId: scope.instanceId, kind, key, value };
		this.entries.set(identity, entry);
		return scope.defer(() => { if (this.entries.get(identity) === entry) this.entries.delete(identity); });
	}

	/** Transitional synchronous projection mutations; executable lifecycle still owns disposal. */
	remove(kind: string, key: string, scopeId?: string): boolean {
		const identity = JSON.stringify([kind, key]);
		const entry = this.entries.get(identity);
		if (!entry || scopeId !== undefined && entry.scopeId !== scopeId) return false;
		return this.entries.delete(identity);
	}

	removeScope(scopeId: string): void {
		for (const [key, entry] of this.entries) if (entry.scopeId === scopeId) this.entries.delete(key);
	}

	get<T = unknown>(kind: string, key: string): T | undefined {
		return this.entries.get(JSON.stringify([kind, key]))?.value as T | undefined;
	}

	list<T = unknown>(kind?: string): OwnedPluginRegistration<T>[] {
		return [...this.entries.values()].filter((entry) => kind === undefined || entry.kind === kind).map((entry) => ({ ...entry })) as OwnedPluginRegistration<T>[];
	}
}

export class PluginServiceRegistry {
	constructor(private readonly registrations: PluginContributionRegistry = new PluginContributionRegistry()) {}

	provide<T>(scope: PluginScope, id: string, version: string, value: T): () => Promise<void> {
		if (value === undefined) throw new Error(`Service ${id} cannot be undefined`);
		return this.registrations.register(scope, "service", id, { version, value });
	}

	get<T = unknown>(id: string): T | undefined {
		return this.registrations.get<{ version: string; value: T }>("service", id)?.value;
	}

	require<T = unknown>(id: string): T {
		const value = this.get<T>(id);
		if (value === undefined) throw new Error(`Service ${id} is not available`);
		return value;
	}

	owners(): Record<string, string> {
		return Object.fromEntries(this.registrations.list("service").map((entry) => [entry.key, entry.owner]));
	}

	versions(): Record<string, string> {
		return Object.fromEntries(this.registrations.list<{ version: string }>("service").map((entry) => [entry.key, entry.value.version]));
	}
}
