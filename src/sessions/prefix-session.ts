import type { AgentRuntimeBindingPersistence } from "../agent-runtime/types.js";
import { randomUUID } from "node:crypto";
import type { CacheInferenceEvidence } from "../shared/cache-diagnostics.js";
import type { PiboJsonObject } from "../core/events.js";
import type { RuntimeSessionBinding } from "./runtime-binding.js";
import { readPrefixTransition, SESSION_PREFIX_TRANSITION_KEY, type PrefixTransition } from "./prefix-transition.js";
import { PrefixSessionOwnership } from "./prefix-ownership.js";
import { isAgentRuntimeBindingPersistence } from "./runtime-binding-persistence.js";
import {
	PrefixCapsuleStore, PrefixRecoveryRequiredError, readSessionPrefixBinding,
	SESSION_PREFIX_METADATA_KEY, type SessionPrefixBinding,
	validatePrefixReference,
} from "./prefix-capsule.js";
import {
	PrefixResourceBundleStore, PREFIX_RESOURCES_CODEC, SESSION_PREFIX_RESOURCES_KEY,
	type PrefixResources, type RestoredPrefixResources,
} from "./prefix-resources.js";

export type SessionPrefixControllerOptions = {
	store?: PrefixCapsuleStore;
	getBinding: () => RuntimeSessionBinding;
	persistence: AgentRuntimeBindingPersistence;
	onPersisted?: (binding: RuntimeSessionBinding) => void;
	runtimeGeneration?: string;
};

/** Owns artifact publication plus the existing audited binding CAS. */
export class SessionPrefixController {
	private readonly store: PrefixCapsuleStore;
	private sealedPayload?: { digest: string; payload: string };
	private preparing?: Promise<SessionPrefixBinding>;
	private resources?: { digest: string; value: RestoredPrefixResources };
	private preparingResources?: Promise<RestoredPrefixResources>;
	private readonly runtimeGeneration: string;
	private inferenceSequence = 0;
	private inferenceEvidence?: CacheInferenceEvidence;
	private inferenceEvidenceFailed = false;
	private ownership?: PrefixSessionOwnership;

	async acquireOwnership(): Promise<() => void> {
		if (!this.ownership) {
			const binding = this.options.getBinding();
			if (!binding.nativeSessionId) throw new PrefixRecoveryRequiredError("native identity is required before protected ownership");
			this.ownership = await PrefixSessionOwnership.acquire(this.store.root, [
				JSON.stringify(["pibo", binding.piboSessionId]),
				JSON.stringify(["native", binding.adapterId, binding.nativeSessionId]),
			]);
		}
		const owned = this.ownership;
		return () => {
			owned.release();
			if (this.ownership === owned) this.ownership = undefined;
		};
	}

	constructor(private readonly options: SessionPrefixControllerOptions) {
		if (!isAgentRuntimeBindingPersistence(options.persistence)) {
			throw new PrefixRecoveryRequiredError("durable audited binding persistence is unavailable");
		}
		const metadata = options.getBinding().metadata;
		if (readPrefixTransition(metadata) && !readSessionPrefixBinding(metadata)) {
			throw new PrefixRecoveryRequiredError("native transition has lost its sealed prefix");
		}
		this.store = options.store ?? new PrefixCapsuleStore();
		this.runtimeGeneration = options.runtimeGeneration ?? randomUUID();
	}

	get binding(): SessionPrefixBinding | undefined {
		return readSessionPrefixBinding(this.options.getBinding().metadata);
	}

	getRuntimeBinding(): RuntimeSessionBinding {
		return structuredClone(this.options.getBinding());
	}

	get transition(): PrefixTransition | undefined { return readPrefixTransition(this.options.getBinding().metadata); }

	async beginCompaction(sourceHead: string | null): Promise<PrefixTransition | undefined> {
		const runtime = structuredClone(this.options.getBinding());
		const prefix = readSessionPrefixBinding(runtime.metadata);
		if (!prefix) return undefined;
		if (this.transition?.state === "pending") throw new PrefixRecoveryRequiredError("a native prefix transition is already pending");
		const transition: PrefixTransition = { format: 1, id: randomUUID(), reason: "compaction",
			fromEpoch: prefix.epoch, nativeSessionId: prefix.nativeSessionId, sourceHead, state: "pending" };
		const persisted = await this.options.persistence.compareAndSet({ ...runtime,
			metadata: { ...runtime.metadata, [SESSION_PREFIX_TRANSITION_KEY]: transition as unknown as PiboJsonObject },
		}, runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
		return transition;
	}

	/** Native state must be synced and inspected before completing this audited CAS. */
	async finishCompaction(id: string, changed: boolean): Promise<void> {
		const runtime = structuredClone(this.options.getBinding());
		const transition = readPrefixTransition(runtime.metadata);
		const prefix = readSessionPrefixBinding(runtime.metadata);
		if (!transition || transition.id !== id) throw new PrefixRecoveryRequiredError("native prefix transition receipt changed concurrently");
		if (transition.state !== "pending") throw new PrefixRecoveryRequiredError("native prefix transition is already resolved");
		if (!prefix || prefix.epoch !== transition.fromEpoch) throw new PrefixRecoveryRequiredError("native prefix transition epoch changed concurrently");
		if (prefix.nativeSessionId !== transition.nativeSessionId) throw new PrefixRecoveryRequiredError("native prefix transition identity changed concurrently");
		const persisted = await this.options.persistence.compareAndSet({ ...runtime, metadata: {
			...runtime.metadata,
			[SESSION_PREFIX_TRANSITION_KEY]: { ...transition, state: changed ? "completed" : "aborted" },
			[SESSION_PREFIX_METADATA_KEY]: { ...prefix, epoch: prefix.epoch + Number(changed), reason: changed ? "compaction" : prefix.reason } as unknown as PiboJsonObject,
		} }, runtime.revision!);
		this.options.onPersisted?.(structuredClone(persisted));
	}

	/** Only compact, already computed facts. No prompt serialization on the telemetry path. */
	recordInference(facts: { cacheKeyDigest?: string; configurationDigest?: string }): void {
		// Operational checks have already completed at the dispatch boundary.
		// Diagnostics must neither block it nor reuse the preceding request's facts.
		this.inferenceEvidence = undefined;
		try {
			const prefix = this.binding;
			this.inferenceEvidence = {
				id: `${this.runtimeGeneration}:${++this.inferenceSequence}`, atMs: Date.now(),
				runtimeGeneration: this.runtimeGeneration, prefixDigest: prefix?.capsule.digest,
				...(prefix ? { epoch: String(prefix.epoch) } : {}),
				...facts, historyContinuity: "unknown",
			};
			this.inferenceEvidenceFailed = false;
		} catch { this.inferenceEvidenceFailed = true; }
	}

	getCacheEvidence(): CacheInferenceEvidence | undefined {
		// The routed best-effort collector counts this as a dropped observation.
		if (this.inferenceEvidenceFailed) throw new Error("Cache inference evidence unavailable");
		return this.inferenceEvidence ? { ...this.inferenceEvidence } : undefined;
	}

	async restoreResources(): Promise<RestoredPrefixResources | undefined> {
		const runtime = this.options.getBinding();
		const reference = runtime.metadata?.[SESSION_PREFIX_RESOURCES_KEY];
		if (reference === undefined) return undefined;
		validatePrefixReference(reference);
		if (reference.adapterId !== runtime.adapterId || reference.codec !== PREFIX_RESOURCES_CODEC) throw new PrefixRecoveryRequiredError("resource adapter or codec changed");
		if (this.resources?.digest === reference.digest) return this.resources.value;
		const value = await new PrefixResourceBundleStore(this.store).restore(reference);
		this.resources = { digest: reference.digest, value };
		return value;
	}

	/** Publish resource state before any native prompt can contain its stable paths. */
	async sealResources(capture: () => Promise<PrefixResources>): Promise<RestoredPrefixResources> {
		if (this.preparingResources) return this.preparingResources;
		this.preparingResources = (async () => {
			const restored = await this.restoreResources();
			if (restored) return restored;
			const runtime = structuredClone(this.options.getBinding());
			if (this.binding) throw new PrefixRecoveryRequiredError("sealed prefix is missing its original resources");
			if (runtime.revision === undefined) throw new PrefixRecoveryRequiredError("resource sealing requires a durable binding");
			const result = await new PrefixResourceBundleStore(this.store).put(runtime.adapterId, await capture());
			const persisted = await this.options.persistence.compareAndSet({
				...runtime,
				metadata: { ...runtime.metadata, [SESSION_PREFIX_RESOURCES_KEY]: result.reference as unknown as PiboJsonObject },
			}, runtime.revision);
			this.options.onPersisted?.(structuredClone(persisted));
			this.resources = { digest: result.reference.digest, value: result.resources };
			return result.resources;
		})();
		try { return await this.preparingResources; } finally { this.preparingResources = undefined; }
	}

	async restore(codec: string): Promise<string | undefined> {
		const runtime = this.options.getBinding();
		const prefix = readSessionPrefixBinding(runtime.metadata);
		if (!prefix) return undefined;
		if (prefix.nativeSessionId !== runtime.nativeSessionId) throw new PrefixRecoveryRequiredError("native session identity changed");
		if (prefix.capsule.adapterId !== runtime.adapterId || prefix.capsule.codec !== codec) throw new PrefixRecoveryRequiredError("unsupported runtime or codec");
		if (this.sealedPayload?.digest === prefix.capsule.digest) return this.sealedPayload.payload;
		const payload = await this.store.read(prefix.capsule, { adapterId: runtime.adapterId, codec });
		this.sealedPayload = { digest: prefix.capsule.digest, payload };
		return payload;
	}

	async seal(input: { codec: string; payload: string; nativeSessionId: string; evidence: SessionPrefixBinding["evidence"]; hasHistoricalModelInput: boolean }): Promise<SessionPrefixBinding> {
		if (this.preparing) {
			await this.preparing;
			return this.seal(input);
		}
		const previous = this.binding;
		if (previous) {
			if (previous.nativeSessionId !== input.nativeSessionId || await this.restore(input.codec) !== input.payload) {
				throw new PrefixRecoveryRequiredError("attempted to replace an already sealed prefix");
			}
			return previous;
		}
		if (input.hasHistoricalModelInput) throw new PrefixRecoveryRequiredError("legacy history has no proven original prefix; explicit rebaseline is required");
		const runtime = structuredClone(this.options.getBinding());
		if (!runtime.nativeSessionId || runtime.nativeSessionId !== input.nativeSessionId || runtime.revision === undefined) {
			throw new PrefixRecoveryRequiredError("native session must be durably bound before sealing");
		}
		this.preparing = (async () => {
			const capsule = await this.store.put(runtime.adapterId, input.codec, input.payload);
			const prefix: SessionPrefixBinding = {
				format: 1, epoch: 1, status: "sealed", capsule, reason: "initial",
				nativeSessionId: input.nativeSessionId, evidence: input.evidence,
			};
			const persisted = await this.options.persistence.compareAndSet({
				...runtime,
				metadata: { ...runtime.metadata, [SESSION_PREFIX_METADATA_KEY]: prefix as unknown as PiboJsonObject },
			}, runtime.revision!);
			this.options.onPersisted?.(structuredClone(persisted));
			this.sealedPayload = { digest: capsule.digest, payload: input.payload };
			return prefix;
		})();
		try { return await this.preparing; } finally { this.preparing = undefined; }
	}

	/** Call after a proven native transition. The immutable base artifact is reused. */
	async advanceEpoch(reason: "compaction" | "model-change"): Promise<SessionPrefixBinding | undefined> {
		const runtime = structuredClone(this.options.getBinding());
		const previous = readSessionPrefixBinding(runtime.metadata);
		if (!previous) return undefined;
		const next: SessionPrefixBinding = { ...previous, epoch: previous.epoch + 1, reason };
		const persisted = await this.options.persistence.compareAndSet({
			...runtime, metadata: { ...runtime.metadata, [SESSION_PREFIX_METADATA_KEY]: next as unknown as PiboJsonObject },
		}, runtime.revision ?? 1);
		this.options.onPersisted?.(structuredClone(persisted));
		return next;
	}
}
