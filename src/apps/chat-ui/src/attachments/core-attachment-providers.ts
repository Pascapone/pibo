/**
 * K07 v1 provider surface (D1-G1, productive vertical).
 *
 * Consumes the shared attachment-provider contract from
 * `src/attachments/types.ts` (single home per I-K07-DECISION-01 §1): the
 * registry itself lives in the existing plugin framework
 * (`PluginSetupContext.registerResource`, B-owned); this module only consumes
 * a lookup function, so no second registry is invented. Until B names the
 * neutral lookup export (B-EXPORT-01), hosts pass an explicit lookup and C's
 * real provider is exercised through the integration test seam.
 *
 * Validation boundary: the core checks scope/JSON/type-registration/session/
 * transaction/revision; the provider checks its domain payload (hand-rolled
 * `validate` and/or declared `schemas` in the shared window). Both must pass
 * before any write. Unknown type → ATT_PROVIDER_MISSING.
 */

import { AttachmentDraftError } from "../../../../attachments/errors.js";
import type {
	AttachmentProviderLookup,
	AttachmentProviderScope,
	K07AttachmentProvider,
	K07SchemaNode,
} from "../../../../attachments/types.js";

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

function isSchemaObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Declaration-time gate: only implemented keywords, well-formed bounds. */
export function assertValidSchemaDeclaration(schema: unknown, label: string): asserts schema is K07SchemaNode {
	if (!isSchemaObject(schema)) {
		throw schemaError(`${label} must be a schema object.`);
	}
	for (const key of Object.keys(schema)) {
		if (!SCHEMA_KEYWORDS.has(key)) {
			throw schemaError(`${label} uses unimplemented keyword "${key}".`);
		}
	}
	const node = schema as Record<string, unknown>;
	if (node.type !== undefined && !["object", "array", "string", "number", "integer", "boolean", "null"].includes(node.type as string)) {
		throw schemaError(`${label}.type is invalid.`);
	}
	if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every((entry) => typeof entry === "string"))) {
		throw schemaError(`${label}.required must be a string array.`);
	}
	if (node.properties !== undefined) {
		if (!isSchemaObject(node.properties)) throw schemaError(`${label}.properties must be an object.`);
		for (const [key, child] of Object.entries(node.properties)) assertValidSchemaDeclaration(child, `${label}.properties.${key}`);
	}
	if (node.items !== undefined) assertValidSchemaDeclaration(node.items, `${label}.items`);
	if (node.enum !== undefined && !Array.isArray(node.enum)) throw schemaError(`${label}.enum must be an array.`);
	for (const bound of ["minLength", "maxLength", "minimum", "maximum"] as const) {
		const value = node[bound];
		if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
			throw schemaError(`${label}.${bound} must be a finite number.`);
		}
	}
}

function jsonEqual(a: unknown, b: unknown): boolean {
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
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
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			throw schemaError(`${path} is shorter than minLength ${schema.minLength}.`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
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
			if (!(key in value)) throw schemaError(`${path} is missing required "${key}".`);
		}
		const properties = schema.properties ?? {};
		for (const [key, child] of Object.entries(properties)) {
			if (key in value) push({ schema: child, value: (value as Record<string, unknown>)[key], path: `${path}.${key}` });
		}
	}
	if (Array.isArray(value) && schema.items !== undefined) {
		value.forEach((entry, index) => push({ schema: schema.items as K07SchemaNode, value: entry, path: `${path}[${index}]` }));
	}
}

/** Iterative payload check against a declared schema (stack-safe, no depth cap). */
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
	return {
		require(type: string): K07AttachmentProvider {
			const provider = lookup(type, scope);
			if (!provider) {
				throw new AttachmentDraftError({
					code: "ATT_PROVIDER_MISSING",
					message: `No attachment provider registered for type "${type}".`,
					retryable: false,
				});
			}
			return provider;
		},
		validatePayload(type: string, schemaVersion: number, payload: unknown): void {
			const provider = lookup(type, scope);
			if (!provider) {
				throw new AttachmentDraftError({
					code: "ATT_PROVIDER_MISSING",
					message: `No attachment provider registered for type "${type}".`,
					retryable: false,
				});
			}
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
