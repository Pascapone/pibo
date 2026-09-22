/** Shared plain-JSON boundary, extracted unchanged from the private draft store. */
import { AttachmentDraftError } from "./errors.js";

export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function invalidJson(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_INVALID_JSON", message, retryable: false });
}

function assertJsonLeaf(value: unknown, label: string): void {
	if (value === null || typeof value === "boolean" || typeof value === "string") return;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return;
		throw invalidJson(`${label} must be finite JSON numbers.`);
	}
	if (Array.isArray(value) || isPlainJsonObject(value)) return;
	throw invalidJson(`${label} must be plain JSON (no functions, undefined, BigInt, symbols, or class instances).`);
}

type JsonWalkFrame = { container: unknown[] | Record<string, unknown>; keys: Array<string | number>; index: number };

function jsonChildKeys(container: unknown[] | Record<string, unknown>): Array<string | number> {
	if (Array.isArray(container)) {
		const keys: number[] = [];
		for (let index = 0; index < container.length; index++) keys.push(index);
		return keys;
	}
	return Object.keys(container);
}

/**
 * Iterative structural JSON check with active-ancestor cycle detection. A
 * shared but acyclic reference ({left: shared, right: shared}) is valid plain
 * JSON and accepted; only a true back-reference fails. No depth cap is
 * enforced here: the walker itself is stack-safe, and the later
 * serialization step fails controlled as well. Foreign access failures
 * (throwing getters/proxies) are rejected as non-plain JSON; this is the
 * documented plain-JSON boundary, not a sandbox.
 */
export function assertJsonValue(value: unknown, label: string): void {
	try {
		assertJsonLeaf(value, label);
		if (!Array.isArray(value) && !isPlainJsonObject(value)) return;
		const root = value as unknown[] | Record<string, unknown>;
		const ancestors = new Set<unknown>([root]);
		const stack: JsonWalkFrame[] = [{ container: root, keys: jsonChildKeys(root), index: 0 }];
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			if (frame.index >= frame.keys.length) {
				stack.pop();
				ancestors.delete(frame.container);
				continue;
			}
			const key = frame.keys[frame.index++];
			const child = Array.isArray(frame.container)
				? frame.container[key as number]
				: (frame.container as Record<string, unknown>)[key as string];
			assertJsonLeaf(child, label);
			if (!Array.isArray(child) && !isPlainJsonObject(child)) continue;
			if (ancestors.has(child)) {
				throw invalidJson(`${label} must not contain cycles.`);
			}
			const container = child as unknown[] | Record<string, unknown>;
			ancestors.add(container);
			stack.push({ container, keys: jsonChildKeys(container), index: 0 });
		}
	} catch (error) {
		if (error instanceof AttachmentDraftError) throw error;
		throw invalidJson(`${label} could not be read as plain JSON.`);
	}
}

export function toJsonText(value: unknown, label: string): string {
	try {
		return JSON.stringify(value);
	} catch {
		throw invalidJson(`${label} could not be serialized as JSON.`);
	}
}

export function cloneJson<T>(value: T): T {
	if (value === undefined) return value;
	try {
		return JSON.parse(toJsonText(value, "Value")) as T;
	} catch (error) {
		if (error instanceof AttachmentDraftError) throw error;
		throw invalidJson("Value could not be cloned as JSON.");
	}
}
