import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type { WorkflowDraftDiagnostic } from "./workflow-persistence.js";

function isJsonValue(value: unknown): value is PiboJsonValue {
	if (
		value === null
		|| typeof value === "string"
		|| typeof value === "boolean"
		|| (typeof value === "number" && Number.isFinite(value))
	) {
		return true;
	}
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (value && typeof value === "object") return Object.values(value).every(isJsonValue);
	return false;
}

function isJsonObject(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

const WORKFLOW_JSON_SCHEMA_SUPPORTED_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const WORKFLOW_JSON_SCHEMA_SUPPORTED_KEYS = new Set([
	"type",
	"title",
	"description",
	"enum",
	"const",
	"default",
	"properties",
	"required",
	"additionalProperties",
	"items",
	"anyOf",
	"oneOf",
	"allOf",
	"$defs",
	"$ref",
]);

type WorkflowJsonSchemaValidationTarget = Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId">;
type WorkflowJsonSchemaValidationContext = { rootSchema: PiboJsonObject; seenRefs: Set<string> };

export function validateJsonSchemaObjectLike(
	value: unknown,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	options: WorkflowJsonSchemaValidationTarget & { requireObjectRoot: boolean },
): void {
	const { requireObjectRoot, ...target } = options;
	if (!isJsonObject(value)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowSchemaError.invalidJsonSchema",
			message: `JSON schema at '${path}' must be an object.`,
			path,
			hint: "Use the existing JSON Schema subset object; Zod schemas are not part of V2 authoring.",
		});
		return;
	}
	validateWorkflowJsonSchemaSubsetLike(value, path, diagnostics, target, {
		context: { rootSchema: value, seenRefs: new Set() },
		root: true,
		requireObjectRoot,
	});
}

function validateWorkflowJsonSchemaSubsetLike(
	value: unknown,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	options: { context: WorkflowJsonSchemaValidationContext; root: boolean; requireObjectRoot: boolean },
): void {
	if (!isJsonObject(value)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.schemaNotObject",
			message: "JSON schema must be an object in the V1 Structured Outputs subset.",
			path,
			hint: "Use an object JSON Schema with a supported type, properties, and required fields.",
		});
		return;
	}

	for (const key of Object.keys(value)) {
		if (!WORKFLOW_JSON_SCHEMA_SUPPORTED_KEYS.has(key)) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.unsupportedSchemaKeyword",
				message: `JSON Schema keyword '${key}' is not supported by the V1 Structured Outputs subset.`,
				path: `${path}.${key}`,
				hint: "Remove the keyword or model the contract with type, properties, items, enum, const, anyOf, $defs, or $ref.",
			});
		}
	}

	if (value.oneOf !== undefined) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.unsupportedOneOf",
			message: "oneOf is not supported by the V1 Structured Outputs subset.",
			path: `${path}.oneOf`,
			hint: "Use anyOf for supported alternatives, or split the contract into explicit adapter/workflow steps.",
		});
	}
	if (value.allOf !== undefined) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.unsupportedAllOf",
			message: "allOf is not supported by the V1 Structured Outputs subset.",
			path: `${path}.allOf`,
			hint: "Flatten the schema into one object with explicit properties and required fields.",
		});
	}

	validateWorkflowJsonSchemaDefsLike(value, path, diagnostics, target, options.context);
	validateWorkflowJsonSchemaRefLike(value, path, diagnostics, target, options);

	if (value.type === undefined && value.$ref === undefined && value.anyOf === undefined) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.schemaTypeMissing",
			message: "JSON schemas must declare a supported type unless they are local $ref or anyOf wrappers.",
			path: `${path}.type`,
			hint: "Add type: 'object', 'array', 'string', 'number', 'integer', 'boolean', or 'null'.",
		});
	}

	const schemaTypes = validateWorkflowJsonSchemaTypeLike(value.type, path, diagnostics, target);
	if (options.root && value.anyOf !== undefined) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.rootAnyOf",
			message: "Root anyOf is not supported for workflow structured output schemas.",
			path: `${path}.anyOf`,
			hint: "Use a root object and place anyOf inside a property or $defs entry.",
		});
	}
	validateWorkflowJsonSchemaAnyOfLike(value, path, diagnostics, target, options.context);

	if (options.root && options.requireObjectRoot && value.$ref === undefined && !schemaTypes.includes("object")) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.rootMustBeObject",
			message: "Structured workflow JSON schemas must have an object root in V1.",
			path: `${path}.type`,
			hint: "Wrap scalar or array values in an object property, e.g. { type: 'object', properties: { value: ... }, required: ['value'], additionalProperties: false }.",
		});
	}

	if (schemaTypes.includes("object") || value.properties !== undefined || value.required !== undefined || value.additionalProperties !== undefined) {
		validateWorkflowJsonObjectSchemaLike(value, path, diagnostics, target, options.context);
	}
	if (schemaTypes.includes("array")) {
		if (value.items === undefined) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.arrayMissingItems",
				message: "Array schemas must declare an items schema.",
				path: `${path}.items`,
				hint: "Add items with another supported V1 schema.",
			});
		} else {
			validateWorkflowJsonSchemaSubsetLike(value.items, `${path}.items`, diagnostics, target, {
				context: options.context,
				root: false,
				requireObjectRoot: false,
			});
		}
	}
	if (value.enum !== undefined && !Array.isArray(value.enum)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.invalidEnum",
			message: "enum must be an array of JSON values.",
			path: `${path}.enum`,
			hint: "Use enum: ['one', 'two'] or remove the enum constraint.",
		});
	}
}

function validateWorkflowJsonSchemaDefsLike(
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	context: WorkflowJsonSchemaValidationContext,
): void {
	if (schema.$defs === undefined) return;
	if (!isJsonObject(schema.$defs)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.invalidDefs",
			message: "$defs must be an object keyed by local definition name.",
			path: `${path}.$defs`,
			hint: "Use $defs: { Name: { type: 'object', ... } } for reusable schemas.",
		});
		return;
	}
	for (const [defName, defSchema] of Object.entries(schema.$defs)) {
		validateWorkflowJsonSchemaSubsetLike(defSchema, `${path}.$defs.${defName}`, diagnostics, target, {
			context,
			root: false,
			requireObjectRoot: false,
		});
	}
}

function validateWorkflowJsonSchemaRefLike(
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	options: { context: WorkflowJsonSchemaValidationContext; root: boolean; requireObjectRoot: boolean },
): void {
	if (schema.$ref === undefined) return;
	if (typeof schema.$ref !== "string") {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.invalidRef",
			message: "$ref must be a string local reference.",
			path: `${path}.$ref`,
			hint: "Use local references such as '#/$defs/MyObject'.",
		});
		return;
	}
	const refTarget = resolveWorkflowJsonSchemaLocalRef(options.context.rootSchema, schema.$ref);
	if (!refTarget) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.unresolvedRef",
			message: `JSON Schema reference '${schema.$ref}' could not be resolved.`,
			path: `${path}.$ref`,
			hint: "Only local $defs references are supported in V1, for example '#/$defs/MyObject'.",
		});
		return;
	}
	if (options.context.seenRefs.has(schema.$ref)) return;
	options.context.seenRefs.add(schema.$ref);
	validateWorkflowJsonSchemaSubsetLike(refTarget, `${path}.$ref(${schema.$ref})`, diagnostics, target, options);
	options.context.seenRefs.delete(schema.$ref);
}

function validateWorkflowJsonSchemaAnyOfLike(
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	context: WorkflowJsonSchemaValidationContext,
): void {
	if (schema.anyOf === undefined) return;
	if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.invalidAnyOf",
			message: "anyOf must be a non-empty array of schema objects.",
			path: `${path}.anyOf`,
			hint: "Provide one or more supported schema alternatives.",
		});
		return;
	}
	schema.anyOf.forEach((item, index) => validateWorkflowJsonSchemaSubsetLike(item, `${path}.anyOf.${index}`, diagnostics, target, {
		context,
		root: false,
		requireObjectRoot: false,
	}));
}

function validateWorkflowJsonSchemaTypeLike(value: unknown, path: string, diagnostics: WorkflowDraftDiagnostic[], target: WorkflowJsonSchemaValidationTarget): string[] {
	if (value === undefined) return [];
	const values = Array.isArray(value) ? value : [value];
	if (values.length === 0) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.emptyType",
			message: "Schema type arrays must include at least one supported type.",
			path: `${path}.type`,
			hint: "Use a supported type such as 'object', or a nullable pair such as ['string', 'null'].",
		});
		return [];
	}
	const seen = new Set<string>();
	const validTypes: string[] = [];
	values.forEach((typeName, index) => {
		if (typeof typeName !== "string" || !WORKFLOW_JSON_SCHEMA_SUPPORTED_TYPES.has(typeName)) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.unsupportedSchemaType",
				message: `Schema type '${String(typeName)}' is not supported by the V1 Structured Outputs subset.`,
				path: Array.isArray(value) ? `${path}.type.${index}` : `${path}.type`,
				hint: "Use one of string, number, integer, boolean, object, array, or null.",
			});
			return;
		}
		if (seen.has(typeName)) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.duplicateSchemaType",
				message: `Schema type '${typeName}' is duplicated.`,
				path: Array.isArray(value) ? `${path}.type.${index}` : `${path}.type`,
				hint: "List each schema type only once.",
			});
			return;
		}
		seen.add(typeName);
		validTypes.push(typeName);
	});
	return validTypes;
}

function validateWorkflowJsonObjectSchemaLike(
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	context: WorkflowJsonSchemaValidationContext,
): void {
	if (schema.additionalProperties !== false) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.objectAdditionalProperties",
			message: "Object schemas must set additionalProperties: false in the V1 Structured Outputs subset.",
			path: `${path}.additionalProperties`,
			hint: "Add additionalProperties: false to every object schema.",
		});
	}
	if (schema.properties !== undefined && !isJsonObject(schema.properties)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.invalidProperties",
			message: "Object schema properties must be an object.",
			path: `${path}.properties`,
			hint: "Use properties: { fieldName: { type: 'string' } }.",
		});
		return;
	}
	const propertyEntries = Object.entries(isJsonObject(schema.properties) ? schema.properties : {});
	if (propertyEntries.length > 0 && !Array.isArray(schema.required)) {
		addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
			code: "WorkflowInterfaceError.objectRequiredMissing",
			message: "Object schemas must list every property in required.",
			path: `${path}.required`,
			hint: "Set required to exactly the object property names; use nullable types for optional semantics.",
		});
	}
	const required = Array.isArray(schema.required) ? schema.required : [];
	const requiredSet = new Set(required.filter((entry): entry is string => typeof entry === "string"));
	for (const [propertyName, propertySchema] of propertyEntries) {
		if (!requiredSet.has(propertyName)) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.objectPropertyNotRequired",
				message: `Object property '${propertyName}' must be listed in required.`,
				path: `${path}.required`,
				hint: "Structured Outputs requires every object field to be required; use a union with null for nullable fields.",
			});
		}
		validateWorkflowJsonSchemaSubsetLike(propertySchema, `${path}.properties.${propertyName}`, diagnostics, target, {
			context,
			root: false,
			requireObjectRoot: false,
		});
	}
	for (const requiredName of required) {
		if (typeof requiredName !== "string") {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.invalidRequiredEntry",
				message: "required entries must be strings.",
				path: `${path}.required`,
				hint: "List required property names as strings.",
			});
			continue;
		}
		if (isJsonObject(schema.properties) && !Object.hasOwn(schema.properties, requiredName)) {
			addWorkflowJsonSchemaDiagnostic(diagnostics, target, {
				code: "WorkflowInterfaceError.requiredUnknownProperty",
				message: `Required property '${requiredName}' is not declared in properties.`,
				path: `${path}.required`,
				hint: "Remove the unknown required name or add a matching property schema.",
			});
		}
	}
}

function resolveWorkflowJsonSchemaLocalRef(rootSchema: PiboJsonObject, ref: string): unknown {
	if (!ref.startsWith("#/$defs/")) return undefined;
	const defs = isJsonObject(rootSchema.$defs) ? rootSchema.$defs : undefined;
	if (!defs) return undefined;
	const pointer = ref.slice("#/$defs/".length).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
	let current: unknown = defs;
	for (const segment of pointer) {
		if (!isJsonObject(current) || !Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

function addWorkflowJsonSchemaDiagnostic(
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowJsonSchemaValidationTarget,
	input: Pick<WorkflowDraftDiagnostic, "code" | "message" | "path" | "hint">,
): void {
	diagnostics.push({
		...input,
		severity: "error",
		...target,
	});
}

