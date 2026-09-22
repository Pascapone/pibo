/** Shared, browser-safe attachment validation. Registries remain host-owned. */
import { AttachmentDraftError } from "./errors.js";
import type {
	AttachmentProviderLookup,
	AttachmentProviderScope,
	K07AttachmentProvider,
	K07SchemaNode,
} from "./types.js";

export type {
	AttachmentProviderLookup,
	AttachmentProviderScope,
	K07AttachmentProvider,
	K07SchemaNode,
};

const SCHEMA_KEYWORDS = new Set([
	"type",
	"required",
	"properties",
	"items",
	"enum",
	"minLength",
	"maxLength",
	"minimum",
	"maximum",
	"const",
]);

function schemaError(message: string): AttachmentDraftError {
	return new AttachmentDraftError({ code: "ATT_SCHEMA_MISMATCH", message, retryable: false });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
	if (!isObjectRecord(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Declaration-time gate: implemented keywords only; stack-safe and cycle-safe. */
export function assertValidSchemaDeclaration(schema: unknown, label: string): asserts schema is K07SchemaNode {
	const active = new Set<object>();
	const stack: { value: unknown; label: string; exit?: boolean }[] = [{ value: schema, label }];
	while (stack.length) {
		const current = stack.pop()!;
		const node = current.value;
		if (!isSchemaObject(node)) throw schemaError(`${current.label} must be a schema object.`);
		if (current.exit) { active.delete(node); continue; }
		if (active.has(node)) throw schemaError(`${current.label} contains a cyclic schema.`);
		active.add(node);
		stack.push({ ...current, exit: true });
		for (const key of Object.keys(node)) {
			if (!SCHEMA_KEYWORDS.has(key)) throw schemaError(`${current.label} uses unimplemented keyword "${key}".`);
		}
		if (node.type !== undefined && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(node.type as string)) {
			throw schemaError(`${current.label}.type is invalid.`);
		}
		if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every((entry) => typeof entry === "string"))) {
			throw schemaError(`${current.label}.required must be a string array.`);
		}
		if (node.properties !== undefined) {
			if (!isSchemaObject(node.properties)) throw schemaError(`${current.label}.properties must be an object.`);
			for (const [key, child] of Object.entries(node.properties)) stack.push({ value: child, label: `${current.label}.properties.${key}` });
		}
		if (node.items !== undefined) stack.push({ value: node.items, label: `${current.label}.items` });
		if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0)) throw schemaError(`${current.label}.enum must be a nonempty array.`);
		for (const bound of ["minLength", "maxLength", "minimum", "maximum"] as const) {
			const value = node[bound];
			if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
				throw schemaError(`${current.label}.${bound} must be a finite number.`);
			}
			if ((bound === "minLength" || bound === "maxLength") && value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
				throw schemaError(`${current.label}.${bound} must be a nonnegative integer.`);
			}
		}
		for (const [low, high] of [["minLength", "maxLength"], ["minimum", "maximum"]] as const) {
			if (typeof node[low] === "number" && typeof node[high] === "number" && node[low] > node[high]) {
				throw schemaError(`${current.label}.${low} exceeds ${high}.`);
			}
		}
	}
}

/** The public registration seam rejects malformed executable providers. */
export function assertValidAttachmentProvider(provider: unknown): asserts provider is K07AttachmentProvider {
	if (!isObjectRecord(provider) || typeof provider.type !== "string" || !provider.type.trim()) throw schemaError("Attachment provider requires a nonempty type.");
	if (!Array.isArray(provider.schemaVersions) || provider.schemaVersions.length === 0
		|| !provider.schemaVersions.every((version) => Number.isSafeInteger(version) && version >= 0)
		|| new Set(provider.schemaVersions).size !== provider.schemaVersions.length) {
		throw schemaError(`Provider "${provider.type}" requires distinct nonnegative schema versions.`);
	}
	if (!isSchemaObject(provider.schemas)) throw schemaError(`Provider "${provider.type}" requires schemas.`);
	for (const version of provider.schemaVersions) {
		if (!Object.hasOwn(provider.schemas, version)) throw schemaError(`Provider "${provider.type}" declares no schema for schemaVersion ${version}.`);
		assertValidSchemaDeclaration(provider.schemas[version], `schema ${provider.type}@${version}`);
	}
	for (const method of ["validate", "snapshot", "serializeForMessage", "renderTile", "fallbackTitle", "sizeHint"]) {
		if (typeof provider[method] !== "function") throw schemaError(`Provider "${provider.type}" requires ${method}().`);
	}
	if (provider.notifyAccepted !== undefined && typeof provider.notifyAccepted !== "function") throw schemaError(`Provider "${provider.type}" has invalid notifyAccepted.`);
}

function jsonEqual(a: unknown, b: unknown): boolean {
	// JSON object equality is independent of property insertion order.
	const stack: [unknown, unknown][] = [[a, b]];
	const seen = new WeakMap<object, WeakSet<object>>();
	while (stack.length) {
		const [left, right] = stack.pop()!;
		if (left === right) continue;
		if ((!Array.isArray(left) && !isSchemaObject(left)) || (!Array.isArray(right) && !isSchemaObject(right))) return false;
		if (Array.isArray(left) !== Array.isArray(right)) return false;
		const pairs = seen.get(left) ?? new WeakSet<object>();
		if (pairs.has(right)) continue;
		pairs.add(right); seen.set(left, pairs);
		if (Array.isArray(left) && Array.isArray(right)) {
			if (left.length !== right.length) return false;
			for (let index = 0; index < left.length; index++) stack.push([left[index], right[index]]);
		} else {
			const keys = Object.keys(left);
			if (keys.length !== Object.keys(right).length) return false;
			for (const key of keys) {
				if (!Object.hasOwn(right, key)) return false;
				stack.push([(left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]]);
			}
		}
	}
	return true;
}

type SchemaCheck = { schema: K07SchemaNode; value: unknown; path: string };

function checkNode(check: SchemaCheck, push: (next: SchemaCheck) => void): void {
	const { schema, value, path } = check;
	if (schema.enum !== undefined && !schema.enum.some((entry) => jsonEqual(entry, value))) {
		throw schemaError(`${path} is not an allowed enum value.`);
	}
	if (schema.const !== undefined && !jsonEqual(schema.const, value)) {
		throw schemaError(`${path} does not match const.`);
	}
	if (schema.type !== undefined) {
		const ok =
			(schema.type === "object" && isSchemaObject(value)) ||
			(schema.type === "array" && Array.isArray(value)) ||
			(schema.type === "string" && typeof value === "string") ||
			(schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
			(schema.type === "integer" && typeof value === "number" && Number.isInteger(value)) ||
			(schema.type === "boolean" && typeof value === "boolean") ||
			(schema.type === "null" && value === null);
		if (!ok) throw schemaError(`${path} must be ${schema.type}.`);
	}
	if (typeof value === "string") {
		const length = Array.from(value).length;
		if (schema.minLength !== undefined && length < schema.minLength) {
			throw schemaError(`${path} is shorter than minLength ${schema.minLength}.`);
		}
		if (schema.maxLength !== undefined && length > schema.maxLength) {
			throw schemaError(`${path} exceeds maxLength ${schema.maxLength}.`);
		}
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		if (schema.minimum !== undefined && value < schema.minimum) {
			throw schemaError(`${path} is below minimum ${schema.minimum}.`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			throw schemaError(`${path} exceeds maximum ${schema.maximum}.`);
		}
	}
	if (isSchemaObject(value)) {
		for (const key of schema.required ?? []) {
			if (!Object.hasOwn(value, key)) throw schemaError(`${path} is missing required "${key}".`);
		}
		const properties = schema.properties ?? {};
		for (const [key, child] of Object.entries(properties)) {
			if (Object.hasOwn(value, key)) push({ schema: child, value: (value as Record<string, unknown>)[key], path: `${path}.${key}` });
		}
	}
	if (Array.isArray(value) && schema.items !== undefined) {
		value.forEach((entry, index) => push({ schema: schema.items as K07SchemaNode, value: entry, path: `${path}[${index}]` }));
	}
}

/** Iterative domain check of JSON payloads against an already validated, acyclic schema. */
export function validateAgainstSchema(schema: K07SchemaNode, payload: unknown, label: string): void {
	const stack: SchemaCheck[] = [{ schema, value: payload, path: label }];
	while (stack.length > 0) {
		const next = stack.pop() as SchemaCheck;
		checkNode(next, (child) => stack.push(child));
	}
}

export type ProviderRegistryClient = {
	require(type: string): K07AttachmentProvider;
	validatePayload(type: string, schemaVersion: number, payload: unknown): void;
};

/**
 * TEST SEAM ONLY. A static map is not a global silent production lookup:
 * production lookups resolve through the installed plugin set of the session
 * (B-EXPORT-01 names the neutral API + browser/server transfer proof).
 */
export function createStaticProviderMap(providers: K07AttachmentProvider[]): AttachmentProviderLookup {
	const byType = new Map(providers.map((provider) => [provider.type, provider]));
	return (type: string) => byType.get(type);
}

export function createProviderRegistryClient(lookup: AttachmentProviderLookup, scope: AttachmentProviderScope): ProviderRegistryClient {
	const boundScope = Object.freeze({ ...scope });
	const require = (type: string): K07AttachmentProvider => {
		const provider = lookup(type, boundScope);
		if (!provider || provider.type !== type) {
			throw new AttachmentDraftError({
				code: "ATT_PROVIDER_MISSING",
				message: `No attachment provider registered for type "${type}".`,
				retryable: false,
			});
		}
		// Live resource providers may change: validate in O(schema size) per lookup
		// rather than caching an executable declaration beyond its owning scope.
		assertValidAttachmentProvider(provider);
		return provider;
	};
	return {
		require,
		validatePayload(type: string, schemaVersion: number, payload: unknown): void {
			const provider = require(type);
			if (!provider.schemaVersions.includes(schemaVersion)) {
				throw schemaError(`Provider "${type}" does not support schemaVersion ${schemaVersion}.`);
			}
			const declared = provider.schemas[schemaVersion];
			if (declared === undefined) {
				throw schemaError(`Provider "${type}" declares no schema for schemaVersion ${schemaVersion}.`);
			}
			assertValidSchemaDeclaration(declared, `schema ${type}@${schemaVersion}`);
			validateAgainstSchema(declared, payload, `payload ${type}@${schemaVersion}`);
			provider.validate(payload);
		},
	};
}
