import { performance } from "node:perf_hooks";
import { types } from "node:util";
import type { PiboOutputEvent } from "./events.js";
import { legacyOutputIdentityFingerprintCandidates, OUTPUT_IDENTITY_FINGERPRINT_VERSION, outputIdentityFingerprint } from "./output-render-sequence.js";
import { outputPersistenceDeliveryKey } from "../data/ingest-service.js";

export type OutputCollisionClassification = {
	classification: "equivalent-v2" | "equivalent-legacy" | "semantic-conflict" | "insufficient-evidence" | "unsupported-version" | "budget-exceeded";
	repairable: boolean;
	fingerprintVersion: 2;
	bodyCompared: boolean;
	reason: string;
};

/** Proves semantic equality from two complete events and an independently checked
 * persisted fingerprint. This neither authenticates provenance nor changes data.
 */
export function classifyOutputCollision(input: {
	incoming: PiboOutputEvent;
	existing: { event: PiboOutputEvent; identityFingerprint: string; identityFingerprintVersion?: number };
	maxBytes?: number;
}): OutputCollisionClassification {
	const result = (classification: OutputCollisionClassification["classification"], reason: string, bodyCompared = false): OutputCollisionClassification => ({
		classification, repairable: classification === "equivalent-v2" || classification === "equivalent-legacy",
		fingerprintVersion: OUTPUT_IDENTITY_FINGERPRINT_VERSION, bodyCompared, reason,
	});
	const maxBytes = input.maxBytes ?? 262144;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) return result("budget-exceeded", "Byte budget must be between 1 and 1048576.");
	const version = input.existing?.identityFingerprintVersion;
	if (version !== undefined && version !== 1 && version !== 2) return result("unsupported-version", "Stored fingerprint version is unsupported.");
	const fingerprint = input.existing?.identityFingerprint;
	if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) return result("insufficient-evidence", "Stored fingerprint is missing or invalid.");
	try {
		const budget = { bytes: maxBytes, nodes: 16384, until: performance.now() + 1000 };
		const incoming = boundedCopy(input.incoming, budget) as PiboOutputEvent;
		const existing = boundedCopy(input.existing.event, budget) as PiboOutputEvent;
		if (!supportedEvent(incoming) || !supportedEvent(existing)) return result("insufficient-evidence", "Complete assistant or terminal events with explicit identities are required.");
		const canonicalFingerprint = outputIdentityFingerprint(existing);
		const storedV2 = version !== 1 && fingerprint === canonicalFingerprint;
		const storedLegacy = version !== 2 && legacyOutputIdentityFingerprintCandidates(existing).includes(fingerprint);
		if (!storedV2 && !storedLegacy) return result("insufficient-evidence", "The reconstructed canonical event does not reproduce its stored fingerprint.");
		const same = outputPersistenceDeliveryKey(incoming) === outputPersistenceDeliveryKey(existing)
			&& outputIdentityFingerprint(incoming) === canonicalFingerprint;
		if (performance.now() > budget.until) return result("budget-exceeded", "Classification time budget exceeded.");
		if (!same) return result("semantic-conflict", "Full semantic content or delivery identity differs.", true);
		return result(storedV2 ? "equivalent-v2" : "equivalent-legacy", "Canonical fingerprint independently verified and full v2 semantic content matches.", true);
	} catch (error) {
		return error instanceof ClassificationBudgetError
			? result("budget-exceeded", "Input exceeds the byte, node, depth or time budget.")
			: result("insufficient-evidence", "Input is not a complete plain JSON event.");
	}
}

function supportedEvent(event: PiboOutputEvent): boolean {
	if (!event || typeof event !== "object" || typeof event.piboSessionId !== "string" || !event.piboSessionId
		|| !("eventId" in event) || typeof event.eventId !== "string" || !event.eventId) return false;
	if (event.type === "message_finished") return typeof event.source === "string" && Boolean(event.source);
	if (event.type !== "assistant_message" || typeof event.text !== "string") return false;
	return [event.assistantIndex, event.contentIndex].every(index => index === undefined || Number.isSafeInteger(index) && index >= 0);
}

class ClassificationBudgetError extends Error {}
type CopyBudget = { bytes: number; nodes: number; until: number };
function boundedCopy(value: unknown, budget: CopyBudget, depth = 0, ancestors = new Set<object>()): unknown {
	if (--budget.nodes < 0 || depth > 64 || performance.now() > budget.until) throw new ClassificationBudgetError();
	const charge = (bytes: number) => { budget.bytes -= bytes; if (budget.bytes < 0) throw new ClassificationBudgetError(); };
	if (typeof value === "string") {
		// Reject large strings before allocating their escaped representation.
		if (value.length > budget.bytes) throw new ClassificationBudgetError();
		charge(Buffer.byteLength(JSON.stringify(value))); return value;
	}
	if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
		if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid number");
		charge(value === undefined ? 4 : JSON.stringify(value).length); return value;
	}
	if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) throw new Error("Invalid JSON structure");
	const array = Array.isArray(value);
	if (array ? Object.getPrototypeOf(value) !== Array.prototype : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid JSON prototype");
	if (array && value.length > budget.nodes) throw new ClassificationBudgetError();
	charge(2); ancestors.add(value);
	const copy: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
	let members = 0;
	try {
		for (const key in value) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable) continue;
			if (!("value" in descriptor)) throw new Error("Accessors are not JSON");
			if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw new Error("Invalid array member");
			members++;
			boundedCopy(key, budget, depth + 1, ancestors); charge(2);
			Object.defineProperty(copy, key, { value: boundedCopy(descriptor.value, budget, depth + 1, ancestors), enumerable: true, configurable: true, writable: true });
		}
		if (array && members !== value.length) throw new Error("Sparse arrays are not complete JSON");
		return copy;
	} finally { ancestors.delete(value); }
}
