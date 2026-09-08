import type { AgentRuntimeBindingPersistence } from "../agent-runtime/types.js";
import type { PiboJsonObject } from "../core/events.js";
import type { RuntimeSessionBinding } from "./runtime-binding.js";
import { isAgentRuntimeBindingPersistence } from "./runtime-binding-persistence.js";
import {
	PrefixCapsuleStore, PrefixRecoveryRequiredError, readSessionPrefixBinding,
	SESSION_PREFIX_METADATA_KEY, type SessionPrefixBinding,
} from "./prefix-capsule.js";

export type SessionPrefixControllerOptions = {
	store?: PrefixCapsuleStore;
	getBinding: () => RuntimeSessionBinding;
	persistence: AgentRuntimeBindingPersistence;
	onPersisted?: (binding: RuntimeSessionBinding) => void;
};

/** Owns artifact publication plus the existing audited binding CAS. */
export class SessionPrefixController {
	private readonly store: PrefixCapsuleStore;
	private sealedPayload?: { digest: string; payload: string };
	private preparing?: Promise<SessionPrefixBinding>;

	constructor(private readonly options: SessionPrefixControllerOptions) {
		if (!isAgentRuntimeBindingPersistence(options.persistence)) {
			throw new PrefixRecoveryRequiredError("durable audited binding persistence is unavailable");
		}
		this.store = options.store ?? new PrefixCapsuleStore();
	}

	get binding(): SessionPrefixBinding | undefined {
		return readSessionPrefixBinding(this.options.getBinding().metadata);
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
