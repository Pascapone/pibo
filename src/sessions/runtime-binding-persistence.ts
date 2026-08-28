import type { AgentRuntimeBindingPersistence } from "../agent-runtime/types.js";
import type { RuntimeSessionBinding } from "./runtime-binding.js";
import { resolvePiboDataRuntimeBindingCas } from "./pibo-data-store.js";
import type { PiboSessionStore } from "./store.js";
import { resolveSqliteRuntimeBindingCas } from "./sqlite-store.js";

type AuditedRuntimeBindingCas = (
	id: string,
	binding: RuntimeSessionBinding,
	options?: { expectedRevision?: number },
) => RuntimeSessionBinding | undefined;

export type CreateAgentRuntimeBindingPersistenceOptions = {
	piboSessionId: string;
	onPersisted?: (binding: RuntimeSessionBinding) => void;
};

const runtimeBindingPersistenceCapabilities = new WeakSet<object>();

function auditedRuntimeBindingCas(
	store: PiboSessionStore,
): AuditedRuntimeBindingCas | undefined {
	return (resolvePiboDataRuntimeBindingCas(store) ?? resolveSqliteRuntimeBindingCas(store)) as
		| AuditedRuntimeBindingCas
		| undefined;
}

/**
 * Mints runtime-binding persistence only for exact audited built-in stores.
 * The capability closes over the audited prototype CAS, so mutable instance
 * members and structural look-alikes cannot authorize native first use.
 */
export function createAgentRuntimeBindingPersistence(
	store: PiboSessionStore,
	options: CreateAgentRuntimeBindingPersistenceOptions,
): AgentRuntimeBindingPersistence | undefined {
	const compareAndSet = auditedRuntimeBindingCas(store);
	if (!compareAndSet) return undefined;
	const piboSessionId = options.piboSessionId;
	const onPersisted = options.onPersisted;
	const capability = Object.freeze({
		async compareAndSet(
			binding: RuntimeSessionBinding,
			expectedRevision: number,
		): Promise<RuntimeSessionBinding> {
			const updated = compareAndSet(
				piboSessionId,
				{ ...structuredClone(binding), piboSessionId },
				{ expectedRevision },
			);
			if (!updated) throw new Error(`Pibo session "${piboSessionId}" no longer exists.`);
			onPersisted?.(structuredClone(updated));
			return updated;
		},
	}) satisfies AgentRuntimeBindingPersistence;
	runtimeBindingPersistenceCapabilities.add(capability);
	return capability;
}

export function isAgentRuntimeBindingPersistence(
	value: AgentRuntimeBindingPersistence | undefined,
): value is AgentRuntimeBindingPersistence {
	return typeof value === "object"
		&& value !== null
		&& runtimeBindingPersistenceCapabilities.has(value);
}
