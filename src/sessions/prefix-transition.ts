import type { PiboJsonObject } from "../core/events.js";
import { PrefixRecoveryRequiredError, SESSION_PREFIX_TRANSITION_KEY } from "./prefix-capsule.js";

export { SESSION_PREFIX_TRANSITION_KEY } from "./prefix-capsule.js";
/** One bounded durable receipt; older receipts remain in the binding audit. */
export type PrefixTransition = {
	format: 1;
	id: string;
	reason: "compaction";
	fromEpoch: number;
	nativeSessionId: string;
	sourceHead: string | null;
	state: "pending" | "completed" | "aborted";
};

export function readPrefixTransition(metadata: PiboJsonObject | undefined): PrefixTransition | undefined {
	if (!metadata || !Object.hasOwn(metadata, SESSION_PREFIX_TRANSITION_KEY)) return undefined;
	const value = metadata[SESSION_PREFIX_TRANSITION_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)
		|| value.format !== 1 || value.reason !== "compaction"
		|| typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id)
		|| !Number.isSafeInteger(value.fromEpoch) || Number(value.fromEpoch) < 1
		|| typeof value.nativeSessionId !== "string" || !value.nativeSessionId || value.nativeSessionId.length > 1024
		|| !(value.sourceHead === null || typeof value.sourceHead === "string" && value.sourceHead.length > 0 && value.sourceHead.length <= 256)
		|| !["pending", "completed", "aborted"].includes(String(value.state))) {
		throw new PrefixRecoveryRequiredError("invalid native prefix transition receipt");
	}
	return { format: 1, id: value.id, reason: "compaction", fromEpoch: Number(value.fromEpoch),
		nativeSessionId: value.nativeSessionId, sourceHead: value.sourceHead,
		state: value.state as PrefixTransition["state"] };
}
