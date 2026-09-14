import { PLUGIN_SDK_VERSION, type PluginDiagnostic, type PluginJsonSchema, type PluginManifest } from "./manifest.js";

export class PluginValidationError extends Error {
	constructor(readonly diagnostics: PluginDiagnostic[]) {
		super(diagnostics.map((d) => `${d.code}: ${d.message} [${d.path.join(" -> ")}]`).join("; "));
		this.name = "PluginValidationError";
	}
}
export function pluginDiagnostic(code: string, message: string, path: string[], severity: PluginDiagnostic["severity"] = "error"): PluginDiagnostic {
	return { code, severity, message, path };
}
export function isPluginRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function isPluginJson(value: unknown, seen = new Set<unknown>()): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (!Array.isArray(value) && !isPluginRecord(value)) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const valid = Object.values(value).every((item) => isPluginJson(item, seen));
	seen.delete(value);
	return valid;
}

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function isPluginVersion(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = versionPattern.exec(value);
	return !!match && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part))) && !match[4]?.split(".").some((part) => /^0\d+$/.test(part));
}
function compareVersions(a: string, b: string): number {
	const x = versionPattern.exec(a)!;
	const y = versionPattern.exec(b)!;
	for (let n = 1; n <= 3; n++) if (+x[n] !== +y[n]) return +x[n] > +y[n] ? 1 : -1;
	if (x[4] === y[4]) return 0;
	if (!x[4]) return 1;
	if (!y[4]) return -1;
	const left = x[4].split("."); const right = y[4].split(".");
	for (let n = 0; n < Math.max(left.length, right.length); n++) {
		if (left[n] === right[n]) continue;
		if (left[n] === undefined) return -1;
		if (right[n] === undefined) return 1;
		const ln = /^\d+$/.test(left[n]); const rn = /^\d+$/.test(right[n]);
		if (ln && rn) return +left[n] > +right[n] ? 1 : -1;
		if (ln !== rn) return ln ? -1 : 1;
		return left[n] > right[n] ? 1 : -1;
	}
	return 0;
}
/** Version-1 ranges: *, exact SemVer, ^, ~ and whitespace-conjoined comparators, with || alternatives. Prereleases require exact pins. */
export function isPluginVersionRange(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.split("||").every((part) => part.trim().length > 0 && part.trim().split(/\s+/).every((token) => {
		if (token === "*") return true;
		const version = token.replace(/^(\^|~|>=|<=|>|<|=)/, "");
		return isPluginVersion(version) && (!versionPattern.exec(version)![4] || !/^(\^|~|>=|<=|>|<)/.test(token));
	}));
}
export function satisfiesPluginVersion(version: string, range: string): boolean {
	if (!isPluginVersion(version) || !isPluginVersionRange(range)) return false;
	return range.split("||").some((part) => part.trim().split(/\s+/).every((token) => {
		if (token === "*") return !versionPattern.exec(version)![4];
		const operator = /^(\^|~|>=|<=|>|<|=)/.exec(token)?.[1] ?? "=";
		const expected = token.replace(/^(\^|~|>=|<=|>|<|=)/, "");
		const comparison = compareVersions(version, expected);
		if (versionPattern.exec(version)![4] && !versionPattern.exec(expected)![4]) return false;
		if (operator === "^") {
			const [, major, minor, patch] = versionPattern.exec(expected)!;
			const upper = +major ? `${+major + 1}.0.0` : +minor ? `0.${+minor + 1}.0` : `0.0.${+patch + 1}`;
			return comparison >= 0 && compareVersions(version, upper) < 0;
		}
		if (operator === "~") {
			const [, major, minor] = versionPattern.exec(expected)!;
			return comparison >= 0 && compareVersions(version, `${major}.${+minor + 1}.0`) < 0;
		}
		return operator === ">=" ? comparison >= 0 : operator === "<=" ? comparison <= 0 : operator === ">" ? comparison > 0 : operator === "<" ? comparison < 0 : comparison === 0;
	}));
}

const schemaKeys = new Set(["$schema", "$id", "title", "description", "default", "examples", "type", "enum", "const", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "anyOf", "oneOf", "allOf"]);
export function validatePluginConfigSchema(schema: unknown, path: string[] = ["schema"]): PluginDiagnostic[] {
	const diagnostics: PluginDiagnostic[] = [];
	const fail = (message: string, at: string[]) => diagnostics.push(pluginDiagnostic("invalid-config-schema", message, at));
	if (!isPluginJson(schema)) return [pluginDiagnostic("invalid-config-schema", "Schema must be finite JSON", path)];
	function visit(s: unknown, at: string[]): void {
		if (typeof s === "boolean") return;
		if (!isPluginRecord(s)) { fail("Schema must be an object or boolean", at); return; }
		for (const key of Object.keys(s)) if (!schemaKeys.has(key)) fail(`Unsupported schema keyword ${key}`, [...at, key]);
		if (s.type !== undefined) {
			const types = Array.isArray(s.type) ? s.type : [s.type];
			if (!types.length || types.some((type) => !["null", "object", "array", "integer", "number", "string", "boolean"].includes(String(type)))) fail("Unknown schema type", at);
		}
		if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((key) => typeof key !== "string") || new Set(s.required).size !== s.required.length)) fail("required must contain unique property names", at);
		if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || new Set(s.enum.map(canonicalPluginJson)).size !== s.enum.length)) fail("enum must contain unique values", at);
		for (const key of ["minItems", "maxItems", "minLength", "maxLength"]) if (s[key] !== undefined && (!Number.isSafeInteger(s[key]) || Number(s[key]) < 0)) fail(`${key} must be a nonnegative integer`, at);
		for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) if (s[key] !== undefined && typeof s[key] !== "number") fail(`${key} must be a number`, at);
		if (s.uniqueItems !== undefined && typeof s.uniqueItems !== "boolean") fail("uniqueItems must be boolean", at);
		if (s.pattern !== undefined) { try { if (typeof s.pattern !== "string") throw new Error(); new RegExp(s.pattern); } catch { fail("Invalid schema pattern", at); } }
		if (s.properties !== undefined) {
			if (!isPluginRecord(s.properties)) fail("properties must be an object", at);
			else for (const [key, child] of Object.entries(s.properties)) visit(child, [...at, "properties", key]);
		}
		for (const key of ["additionalProperties", "items"]) if (s[key] !== undefined) visit(s[key], [...at, key]);
		for (const key of ["allOf", "anyOf", "oneOf"]) if (s[key] !== undefined) {
			if (!Array.isArray(s[key]) || !s[key].length) fail(`${key} must be a nonempty array`, at);
			else s[key].forEach((child, index) => visit(child, [...at, key, String(index)]));
		}
	}
	visit(schema, path);
	return diagnostics;
}

/** Small explicit JSON-Schema subset; unsupported keywords fail closed instead of being ignored. */
export function validatePluginConfig(schema: PluginJsonSchema, value: unknown, path: string[] = ["config"]): PluginDiagnostic[] {
	const diagnostics = validatePluginConfigSchema(schema, [...path, "schema"]);
	if (diagnostics.length) return diagnostics;
	const fail = (message: string, at: string[]) => diagnostics.push(pluginDiagnostic("invalid-config", message, at));
	function visit(s: unknown, v: unknown, at: string[]): void {
		if (typeof s === "boolean") { if (!s) fail("Value prohibited by schema", at); return; }
		if (!isPluginRecord(s)) { fail("Schema must be an object", at); return; }
		for (const key of Object.keys(s)) if (!schemaKeys.has(key)) fail(`Unsupported schema keyword ${key}`, at);
		if (s.type !== undefined) {
			const types = Array.isArray(s.type) ? s.type : [s.type];
			const matches = types.some((type) => type === "null" ? v === null : type === "object" ? isPluginRecord(v) : type === "array" ? Array.isArray(v) : type === "integer" ? Number.isSafeInteger(v) : ["string", "number", "boolean"].includes(String(type)) && typeof v === type);
			if (!matches) { fail(`Expected ${types.join(" or ")}`, at); return; }
		}
		if (Array.isArray(s.enum) && !s.enum.some((item) => canonicalPluginJson(item) === canonicalPluginJson(v))) fail("Value is not in enum", at);
		if ("const" in s && canonicalPluginJson(s.const) !== canonicalPluginJson(v)) fail("Value differs from const", at);
		for (const key of ["allOf", "anyOf", "oneOf"]) if (s[key] !== undefined) {
			if (!Array.isArray(s[key])) { fail(`${key} must be an array`, at); continue; }
			const results = s[key].map((child) => validatePluginConfig(child as PluginJsonSchema, v, at));
			const passed = results.filter((result) => !result.length).length;
			if (key === "allOf") diagnostics.push(...results.flat());
			else if (key === "anyOf" ? passed === 0 : passed !== 1) fail(`${key} did not match`, at);
		}
		if (isPluginRecord(v)) {
			if (Array.isArray(s.required)) for (const key of s.required) if (typeof key !== "string" || !Object.hasOwn(v, key)) fail(`Missing required property ${key}`, at);
			const properties = isPluginRecord(s.properties) ? s.properties : {};
			for (const [key, item] of Object.entries(v)) {
				if (Object.hasOwn(properties, key)) visit(properties[key], item, [...at, key]);
				else if (s.additionalProperties === false) fail(`Unknown property ${key}`, [...at, key]);
				else if (isPluginRecord(s.additionalProperties)) visit(s.additionalProperties, item, [...at, key]);
			}
		}
		if (Array.isArray(v)) {
			if (typeof s.minItems === "number" && v.length < s.minItems) fail("Too few items", at);
			if (typeof s.maxItems === "number" && v.length > s.maxItems) fail("Too many items", at);
			if (s.uniqueItems === true && new Set(v.map(canonicalPluginJson)).size !== v.length) fail("Duplicate items", at);
			if (s.items !== undefined) v.forEach((item, index) => visit(s.items, item, [...at, String(index)]));
		}
		if (typeof v === "string") {
			if (typeof s.minLength === "number" && v.length < s.minLength) fail("String too short", at);
			if (typeof s.maxLength === "number" && v.length > s.maxLength) fail("String too long", at);
			if (typeof s.pattern === "string") { try { if (!new RegExp(s.pattern).test(v)) fail("Pattern mismatch", at); } catch { fail("Invalid schema pattern", at); } }
		}
		if (typeof v === "number") {
			if (typeof s.minimum === "number" && v < s.minimum || typeof s.maximum === "number" && v > s.maximum || typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum || typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) fail("Number outside bounds", at);
		}
	}
	if (!isPluginJson(value)) fail("Configuration must be finite JSON data", path);
	else visit(schema, value, path);
	return diagnostics;
}
export function canonicalPluginJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalPluginJson).join(",")}]`;
	if (isPluginRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalPluginJson(value[key])}`).join(",")}}`;
	return JSON.stringify(value) ?? "undefined";
}
export function freezePluginValue<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const item of Object.values(value)) freezePluginValue(item);
		Object.freeze(value);
	}
	return value;
}

export type PluginManifestValidationOptions = { sdkVersion?: string; files?: readonly string[] };
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const qualifiedPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export function validatePluginManifest(value: unknown, options: PluginManifestValidationOptions = {}): PluginDiagnostic[] {
	const diagnostics: PluginDiagnostic[] = [];
	const root = isPluginRecord(value) && typeof value.id === "string" ? value.id : "manifest";
	const fail = (code: string, message: string, path: string[] = []) => diagnostics.push({ ...pluginDiagnostic(code, message, [root, ...path]), pluginId: root });
	if (!isPluginRecord(value) || !isPluginJson(value)) return [pluginDiagnostic("invalid-manifest", "Manifest must be finite JSON data", [root])];
	const m = value;
	if (m.schemaVersion !== 1) fail("manifest-schema-version", "Only manifest schemaVersion 1 is supported");
	if (typeof m.id !== "string" || !idPattern.test(m.id)) fail("invalid-plugin-id", "Invalid plugin ID");
	if (typeof m.name !== "string" || !m.name.trim()) fail("invalid-manifest", "Plugin name is required");
	if (!isPluginVersion(m.version)) fail("invalid-version", "Plugin version must be exact SemVer");
	if (!isPluginVersionRange(m.sdk) || !satisfiesPluginVersion(options.sdkVersion ?? PLUGIN_SDK_VERSION, m.sdk)) fail("sdk-incompatible", `SDK requirement ${m.sdk} is not supported`);
	const strings = (v: unknown) => Array.isArray(v) && v.every((entry) => typeof entry === "string" && entry.length > 0);
	function requirements(v: unknown, path: string[], provider = false): void {
		if (v === undefined) return;
		if (!Array.isArray(v)) { fail("invalid-dependency", "Dependencies must be an array", path); return; }
		const ids = new Set<string>();
		for (const [i, item] of v.entries()) {
			const at = [...path, String(i)];
			if (!isPluginRecord(item) || typeof item.id !== "string" || !idPattern.test(item.id) || !(provider ? isPluginVersion(item.version) : isPluginVersionRange(item.version))) { fail("invalid-dependency", "Invalid dependency identity or version", at); continue; }
			if (ids.has(item.id)) fail("duplicate-dependency", `Duplicate or contradictory dependency ${item.id}`, at);
			ids.add(item.id);
			if (item.optional !== undefined && typeof item.optional !== "boolean") fail("invalid-dependency", "optional must be boolean", at);
			if (item.replaces !== undefined && (!strings(item.replaces) || (item.replaces as string[]).includes(root))) fail("invalid-replacement", "Replacement must name other providers", at);
		}
	}
	requirements(m.dependencies, ["dependencies"]);
	if (m.services !== undefined) {
		if (!isPluginRecord(m.services)) fail("invalid-services", "services must be an object");
		else { requirements(m.services.provides, ["services", "provides"], true); requirements(m.services.requires, ["services", "requires"]); }
	}
	if (m.entrypoints !== undefined) {
		if (!isPluginRecord(m.entrypoints)) fail("invalid-entrypoint", "entrypoints must be an object");
		else for (const [kind, path] of Object.entries(m.entrypoints)) {
			if (!["backend", "browser"].includes(kind) || typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes(":") || path.includes("?") || path.includes("#") || path.split("/").some((part) => part === ".." || part === "." || !part) || /[\x00-\x1f]/.test(path)) fail("invalid-entrypoint", `Unsafe entrypoint ${String(path)}`, ["entrypoints", kind]);
			else if (options.files && !options.files.includes(path)) fail("missing-entrypoint", `Entrypoint not in artifact: ${path}`, ["entrypoints", kind]);
		}
	}
	if (m.config !== undefined && (!isPluginRecord(m.config) || !Number.isSafeInteger(m.config.schemaVersion) || Number(m.config.schemaVersion) < 1 || !isPluginRecord(m.config.schema))) fail("invalid-config-schema", "Config requires schemaVersion and schema");
	if (isPluginRecord(m.config)) {
		if (isPluginRecord(m.config.schema)) diagnostics.push(...validatePluginConfigSchema(m.config.schema, [root, "config", "schema"]));
		if (m.config.scopes !== undefined && (!strings(m.config.scopes) || (m.config.scopes as string[]).some((scope) => !["app", "agent", "session"].includes(scope)) || new Set(m.config.scopes as string[]).size !== (m.config.scopes as string[]).length)) fail("invalid-config-scope", "Config scopes must be unique app, agent or session values", ["config", "scopes"]);
	}
	if (m.dataSchemaVersion !== undefined && (!Number.isSafeInteger(m.dataSchemaVersion) || Number(m.dataSchemaVersion) < 1)) fail("invalid-data-schema", "dataSchemaVersion must be positive");
	if (!Array.isArray(m.contributions)) { fail("invalid-contributions", "contributions must be an array"); return diagnostics; }
	const ids = new Set<string>();
	for (const [index, c] of m.contributions.entries()) {
		const at = ["contributions", String(index)];
		if (!isPluginRecord(c)) { fail("invalid-contribution", "Contribution must be an object", at); continue; }
		if (typeof c.id !== "string" || !idPattern.test(c.id)) { fail("invalid-contribution-id", "Invalid local contribution ID", at); continue; }
		at.push(c.id);
		if (ids.has(c.id)) fail("duplicate-contribution", `Duplicate contribution ${c.id}`, at);
		ids.add(c.id);
		if (c.schemaVersion !== 1) fail("contribution-schema-version", "Only contribution schemaVersion 1 is supported", at);
		if (typeof c.kind !== "string" || !c.kind.trim() || !["app", "agent"].includes(String(c.scope)) || typeof c.required !== "boolean" || typeof c.defaultEnabled !== "boolean") fail("invalid-contribution", "kind, scope, required and defaultEnabled are required", at);
		if (c.required === true && c.defaultEnabled !== true) fail("contradictory-selection", "Required contributions must be default-enabled", at);
		if (c.name !== undefined && (typeof c.name !== "string" || !c.name.trim())) fail("invalid-contribution-name", "Contribution name must be nonempty", at);
		if (c.kind === "session-tool-provider" && c.scope !== "app") fail("invalid-session-tool-provider", "Session tool providers are app-scoped infrastructure; individual tool contributions are agent-selected", at);
		if (c.sessionToolProvider !== undefined) {
			if (c.kind !== "tool" || c.scope !== "agent" || typeof c.name !== "string" || !c.name.trim() || typeof c.sessionToolProvider !== "string" || !qualifiedPattern.test(c.sessionToolProvider)) fail("invalid-session-tool-binding", "A session tool binding requires an agent-scoped named tool and a qualified provider contribution", at);
			if (!Array.isArray(c.dependsOn) || !(c.dependsOn as unknown[]).includes(c.sessionToolProvider)) fail("missing-session-tool-provider-dependency", "A session tool must depend on its declared provider contribution", at);
		}
		if (c.direct !== undefined && (c.kind !== "tool" || typeof c.direct !== "boolean")) fail("invalid-tool-delivery", "direct is valid only as a boolean tool property", at);
		if (c.yieldable !== undefined && (c.kind !== "tool" || typeof c.yieldable !== "boolean")) fail("invalid-tool-yieldability", "yieldable is valid only as a boolean tool property", at);
		if (c.metadata !== undefined && !isPluginRecord(c.metadata)) fail("invalid-contribution-metadata", "Contribution metadata must be an object", at);
		if (c.order !== undefined && (typeof c.order !== "number" || !Number.isFinite(c.order))) fail("invalid-order", "order must be finite", at);
		if (!isPluginRecord(c.context) || (c.context.kind === "none" ? typeof c.context.reason !== "string" || !c.context.reason.trim() : c.context.kind !== "context" || typeof c.context.stage !== "string" || !c.context.stage || typeof c.context.description !== "string" || !c.context.description || !["eager", "progressive", "runtime"].includes(String(c.context.loading)))) fail("missing-context-effect", "Every contribution needs explicit context effect or no-context reason", at);
		for (const key of ["dependsOn", "replaces"]) if (c[key] !== undefined && (!strings(c[key]) || (c[key] as string[]).some((id) => !qualifiedPattern.test(id) || id === `${root}/${c.id}`) || new Set(c[key] as string[]).size !== (c[key] as string[]).length)) fail("invalid-contribution-dependency", `Invalid ${key}`, at);
		requirements(c.services, [...at, "services"]);
		if (c.runtime !== undefined && (!isPluginRecord(c.runtime) || Object.entries(c.runtime).some(([key, value]) => !["adapterIds", "instanceIds", "capabilities", "deliveryModes"].includes(key) || !strings(value)))) fail("invalid-runtime-requirement", "Invalid runtime predicate", at);
		if (c.configSchema !== undefined) diagnostics.push(...validatePluginConfigSchema(c.configSchema, [root, ...at, "configSchema"]));
		if (c.view !== undefined) {
			const v = c.view;
			const presentationValid = isPluginRecord(v) && ["workspace", "internal"].includes(String(v.presentation));
			const legacyVisibilityValid = isPluginRecord(v) && ["session", "infrastructure"].includes(String(v.visibility));
			if (!isPluginRecord(v) || typeof v.title !== "string" || !v.title || typeof v.exportName !== "string" || !v.exportName || (!presentationValid && !legacyVisibilityValid) || !["singleton", "multiple"].includes(String(v.instance)) || !["unmount", "keep-alive"].includes(String(v.mount)) || !Number.isSafeInteger(v.stateSchemaVersion) || Number(v.stateSchemaVersion) < 1) fail("invalid-view", "Invalid browser view contract", at);
			else {
				if (v.presentation !== undefined && !presentationValid) fail("invalid-view", "presentation must be workspace or internal", at);
				if (v.visibility !== undefined && !legacyVisibilityValid) fail("invalid-view", "Legacy visibility must be session or infrastructure", at);
				if (v.subviewNavigation !== undefined && !["host", "renderer"].includes(String(v.subviewNavigation))) fail("invalid-view", "subviewNavigation must be host or renderer", at);
				if (!isPluginRecord(m.entrypoints) || !m.entrypoints.browser) fail("missing-browser-entrypoint", "Views require a prebuilt browser entrypoint", at);
				if (v.stateSchema !== undefined) diagnostics.push(...validatePluginConfigSchema(v.stateSchema, [root, ...at, "view", "stateSchema"]));
				if ((v.presentation === "internal" || v.presentation === undefined && v.visibility === "infrastructure") && c.scope !== "app") fail("invalid-view-scope", "Internal views must be app-scoped", at);
				if (v.subviews !== undefined) {
					const subIds = new Set<string>();
					if (!Array.isArray(v.subviews)) fail("invalid-subview", "subviews must be an array", at);
					else for (const sub of v.subviews) {
						if (!isPluginRecord(sub) || typeof sub.id !== "string" || !idPattern.test(sub.id) || subIds.has(sub.id) || typeof sub.title !== "string" || !["content", "settings", "context"].includes(String(sub.purpose)) || sub.settingsScopes !== undefined && (!strings(sub.settingsScopes) || (sub.settingsScopes as string[]).some((scope) => !["app", "agent", "session"].includes(scope)))) fail("invalid-subview", "Invalid or duplicate subview/settings scope", at);
						else subIds.add(sub.id);
					}
				}
			}
		}
	}
	for (const c of m.contributions) if (isPluginRecord(c) && Array.isArray(c.dependsOn)) for (const dependency of c.dependsOn) {
		if (typeof dependency === "string" && dependency.startsWith(`${root}/`) && !ids.has(dependency.slice(root.length + 1))) fail("missing-contribution-dependency", `Missing local dependency ${dependency}`, [String(c.id), dependency]);
	}
	for (const c of m.contributions) if (isPluginRecord(c) && typeof c.sessionToolProvider === "string") {
		const [providerPluginId, providerLocalId] = c.sessionToolProvider.split("/");
		const provider = providerPluginId === root ? m.contributions.find((candidate) => isPluginRecord(candidate) && candidate.id === providerLocalId) : undefined;
		if (!provider || !isPluginRecord(provider) || provider.kind !== "session-tool-provider" || provider.scope !== "app") fail("invalid-session-tool-provider", `Session tool provider ${c.sessionToolProvider} must be an app-scoped provider contribution in the same package`, [String(c.id), c.sessionToolProvider]);
	}
	return diagnostics;
}
export function parsePluginManifest(value: unknown, options: PluginManifestValidationOptions = {}): PluginManifest {
	const diagnostics = validatePluginManifest(value, options);
	if (diagnostics.length) throw new PluginValidationError(diagnostics);
	return freezePluginValue(structuredClone(value as PluginManifest));
}
