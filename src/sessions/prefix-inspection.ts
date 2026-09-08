import type { PiboJsonObject } from "../core/events.js";
import { readSessionPrefixBinding, SESSION_PREFIX_RESOURCES_KEY, validatePrefixReference } from "./prefix-capsule.js";
import { readPrefixTransition } from "./prefix-transition.js";
import { PREFIX_RESOURCES_CODEC } from "./prefix-resources.js";

export type SessionPrefixInspection = {
	status: "uninitialized" | "legacy-unverified" | "preparing" | "sealed" | "transition-pending" | "recovery-required";
	verification: "metadata-only";
	epoch?: number;
	digest?: string;
	codec?: string;
	evidence?: "adapter-inputs" | "provider-request";
	reason?: string;
};

/** Cheap read-only inventory; it deliberately does not assert native/wire equality. */
export function inspectSessionPrefix(input: {
	metadata?: unknown;
	adapterId?: string;
	nativeSessionId?: string;
	state?: string;
}): SessionPrefixInspection {
	const verification = "metadata-only" as const;
	try {
		if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata))) throw new Error("metadata");
		const metadata = input.metadata as PiboJsonObject | undefined;
		const prefix = readSessionPrefixBinding(metadata);
		const transition = readPrefixTransition(metadata);
		const resources = metadata?.[SESSION_PREFIX_RESOURCES_KEY];
		if (resources !== undefined) {
			validatePrefixReference(resources);
			if (resources.adapterId !== input.adapterId || resources.codec !== PREFIX_RESOURCES_CODEC) throw new Error("resources");
		}
		if (!prefix) {
			if (transition) throw new Error("orphan transition");
			return { status: resources ? "preparing" : input.state === "unbound" ? "uninitialized" : "legacy-unverified", verification };
		}
		if (prefix.capsule.adapterId !== input.adapterId || prefix.nativeSessionId !== input.nativeSessionId) throw new Error("identity");
		if (transition && (transition.nativeSessionId !== prefix.nativeSessionId
			|| (transition.state === "pending" ? transition.fromEpoch !== prefix.epoch
				: transition.fromEpoch + Number(transition.state === "completed") > prefix.epoch))) throw new Error("epoch");
		return { status: transition?.state === "pending" ? "transition-pending" : "sealed", verification,
			epoch: prefix.epoch, digest: prefix.capsule.digest, codec: prefix.capsule.codec, evidence: prefix.evidence, reason: prefix.reason };
	} catch {
		// Corrupt metadata and its raw payload must not turn into an implicit legacy session.
		return { status: "recovery-required", verification, reason: "invalid-prefix-metadata" };
	}
}
