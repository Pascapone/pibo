import type { PiboJsonObject, PiboJsonValue } from "../../core/events.js";
import type { WorkflowDraftDiagnostic } from "./workflow-persistence.js";

type WorkflowRegisteredRefParamsTarget = Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId"> & {
	kind: "guard" | "adapter";
	path: string;
	diagnosticLabel: string;
	registryRef: string;
};

type WorkflowRegisteredRefParamsValidationTarget = Pick<WorkflowDraftDiagnostic, "nodeId" | "edgeId"> & {
	diagnosticLabel: string;
	registryRef: string;
};

export function validateWorkflowRegisteredRefParamsLike(
	value: unknown,
	paramsSchema: PiboJsonObject | null,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowRegisteredRefParamsTarget,
): void {
	if (value === undefined) return;
	const code = target.kind === "guard" ? "WorkflowGraphError.invalidGuardParams" : "WorkflowGraphError.invalidAdapterParams";
	if (!paramsSchema) {
		diagnostics.push({
			code: target.kind === "guard" ? "WorkflowGraphError.unexpectedGuardParams" : "WorkflowGraphError.unexpectedAdapterParams",
			message: `${target.diagnosticLabel} declares params, but registry ref '${target.registryRef}' does not expose a paramsSchema.`,
			severity: "error",
			path: target.path,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			registryRef: target.registryRef,
			hint: "Remove params or select a registered ref whose picker metadata includes paramsSchema.",
		});
		return;
	}
	if (!isJsonObject(value)) {
		diagnostics.push({
			code,
			message: `${target.diagnosticLabel} params for '${target.registryRef}' must be a JSON object matching the registry paramsSchema.`,
			severity: "error",
			path: target.path,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			registryRef: target.registryRef,
			hint: "Edit params as JSON object data only; inline handlers or arbitrary code are not allowed.",
		});
		return;
	}
	validateWorkflowParamsValueAgainstSchema(value, paramsSchema, target.path, diagnostics, target, code);
}

function validateWorkflowParamsValueAgainstSchema(
	value: unknown,
	schema: PiboJsonObject,
	path: string,
	diagnostics: WorkflowDraftDiagnostic[],
	target: WorkflowRegisteredRefParamsValidationTarget,
	code: "WorkflowGraphError.invalidGuardParams" | "WorkflowGraphError.invalidAdapterParams",
): void {
	const typeNames = readParamsSchemaTypes(schema.type);
	if (typeNames.length && !typeNames.some((typeName) => workflowParamValueMatchesType(value, typeName))) {
		diagnostics.push({
			code,
			message: `${target.diagnosticLabel} params for '${target.registryRef}' do not match the registry paramsSchema type at '${path}'.`,
			severity: "error",
			path,
			nodeId: target.nodeId,
			edgeId: target.edgeId,
			registryRef: target.registryRef,
			hint: "Use the selected ref's paramsSchema from the picker when editing params.",
		});
		return;
	}
	if (isJsonObject(value)) {
		const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === "string") : [];
		for (const requiredKey of required) {
			if (Object.hasOwn(value, requiredKey)) continue;
			diagnostics.push({
				code,
				message: `${target.diagnosticLabel} params for '${target.registryRef}' are missing required registry paramsSchema field '${requiredKey}'.`,
				severity: "error",
				path: workflowParamsChildPath(path, requiredKey),
				nodeId: target.nodeId,
				edgeId: target.edgeId,
				registryRef: target.registryRef,
				hint: "Add the required params field or remove the params block.",
			});
		}
		const properties = isJsonObject(schema.properties) ? schema.properties : {};
		for (const [key, propertyValue] of Object.entries(value)) {
			const propertySchema = properties[key];
			if (isJsonObject(propertySchema)) {
				validateWorkflowParamsValueAgainstSchema(propertyValue, propertySchema, workflowParamsChildPath(path, key), diagnostics, target, code);
			} else if (schema.additionalProperties === false) {
				diagnostics.push({
					code,
					message: `${target.diagnosticLabel} params for '${target.registryRef}' include field '${key}', which is not allowed by the registry paramsSchema.`,
					severity: "error",
					path: workflowParamsChildPath(path, key),
					nodeId: target.nodeId,
					edgeId: target.edgeId,
					registryRef: target.registryRef,
					hint: "Remove fields not declared by the selected ref's paramsSchema.",
				});
			}
		}
	}
	if (Array.isArray(value) && isJsonObject(schema.items)) {
		value.forEach((item, index) => validateWorkflowParamsValueAgainstSchema(item, schema.items as PiboJsonObject, `${path}.${index}`, diagnostics, target, code));
	}
}

function readParamsSchemaTypes(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
	return [];
}

function workflowParamValueMatchesType(value: unknown, typeName: string): boolean {
	if (typeName === "string") return typeof value === "string";
	if (typeName === "number") return typeof value === "number";
	if (typeName === "integer") return typeof value === "number" && Number.isInteger(value);
	if (typeName === "boolean") return typeof value === "boolean";
	if (typeName === "object") return isJsonObject(value);
	if (typeName === "array") return Array.isArray(value);
	if (typeName === "null") return value === null;
	return true;
}

function workflowParamsChildPath(path: string, key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

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
