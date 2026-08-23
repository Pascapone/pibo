import type { PiboJsonObject } from "../core/events.js";
import {
	AGENT_RUNTIME_AUTH_COMPLETION_MODES,
	AGENT_RUNTIME_AUTH_METHOD_IDS,
	type AgentRuntimeAuthCredentialScope,
	type AgentRuntimeAuthMethodCapability,
} from "./auth.js";

export type AgentRuntimeCapabilityDelivery =
	| { support: "unsupported"; reason: string }
	| { support: "native" }
	| { support: "direct" }
	| { support: "mcp"; transports: readonly ("streamable-http" | "stdio")[] }
	| { support: "materialized"; modes: readonly string[] }
	| { support: "degraded"; mode: string; reason: string };

export type AgentRuntimeConfigurableFeatureCapability = {
	supported: boolean;
	configurable: boolean;
	enabledByDefault: boolean;
};

export type AgentRuntimeContextDiscoveryStrategy =
	| "filesystem-ancestors"
	| "codex-project"
	| "omp-project";

export type AgentRuntimeContextDiscoveryCapability = AgentRuntimeConfigurableFeatureCapability & {
	/** Native ancestor-boundary semantics used for exact selected-file deduplication. */
	strategy?: AgentRuntimeContextDiscoveryStrategy;
	/** Ordered filenames checked per discovered ancestor directory; first existing name wins. */
	knownFileNames?: readonly string[];
	/** Runtime-owned user-relative files resolved from the current OS home directory. */
	knownUserRelativePaths?: readonly string[];
	/** Runtime-owned project-relative files resolved only from the exact session cwd. */
	knownCwdRelativePaths?: readonly string[];
	/** Runtime-owned project-relative files resolved from the nearest supported ancestor. */
	knownRelativePaths?: readonly string[];
	/** Runtime-owned project-relative files loaded independently from every supported ancestor directory. */
	knownAncestorRelativePaths?: readonly string[];
};

export type AgentRuntimeCapabilities = {
	lifecycle: {
		persistent: boolean;
		lazyBinding: boolean;
		resume: boolean;
		attach: boolean;
		listNativeSessions: boolean;
		fork: boolean;
		clone: boolean;
		tree: boolean;
	};
	input: {
		text: boolean;
		images: boolean;
		audio: boolean;
		steering: boolean;
		structuredOutput: boolean;
	};
	output: {
		assistantDeltas: boolean;
		reasoning: boolean;
		toolEvents: boolean;
		usage: boolean;
		plans: boolean;
		diffs: boolean;
		rawNativeEvents: boolean;
	};
	tools: {
		piboManaged: AgentRuntimeCapabilityDelivery;
		nativeToolInspection: AgentRuntimeCapabilityDelivery;
		nativeToolYielding: AgentRuntimeCapabilityDelivery;
		intentTracing: AgentRuntimeConfigurableFeatureCapability;
	};
	mcp: {
		externalServers: AgentRuntimeCapabilityDelivery;
		statusInspection: boolean;
	};
	skills: AgentRuntimeCapabilityDelivery;
	context: AgentRuntimeCapabilityDelivery;
	contextDiscovery: AgentRuntimeContextDiscoveryCapability;
	nativeSubagents: AgentRuntimeConfigurableFeatureCapability;
	historyImport: boolean;
	auth: {
		status: boolean;
		methods: readonly AgentRuntimeAuthMethodCapability[];
		cancel: boolean;
		logout: boolean;
		credentialScope: AgentRuntimeAuthCredentialScope;
	};
	models: {
		catalog: boolean;
		switchInSession: boolean;
		optionsSchema?: PiboJsonObject;
	};
	reasoning: {
		supported: boolean;
		values?: readonly string[];
	};
	approvals: {
		supported: boolean;
		structuredUserInput: boolean;
	};
	maintenance: {
		compaction: boolean;
		contextUsage: boolean;
		history: boolean;
		health: boolean;
	};
};

export type AgentRuntimeSessionCapabilities = AgentRuntimeCapabilities;

const BOOLEAN_CAPABILITY_PATHS = [
	"lifecycle.persistent",
	"lifecycle.lazyBinding",
	"lifecycle.resume",
	"lifecycle.attach",
	"lifecycle.listNativeSessions",
	"lifecycle.fork",
	"lifecycle.clone",
	"lifecycle.tree",
	"input.text",
	"input.images",
	"input.audio",
	"input.steering",
	"input.structuredOutput",
	"output.assistantDeltas",
	"output.reasoning",
	"output.toolEvents",
	"output.usage",
	"output.plans",
	"output.diffs",
	"output.rawNativeEvents",
	"mcp.statusInspection",
	"contextDiscovery.supported",
	"contextDiscovery.configurable",
	"contextDiscovery.enabledByDefault",
	"nativeSubagents.supported",
	"nativeSubagents.configurable",
	"nativeSubagents.enabledByDefault",
	"tools.intentTracing.supported",
	"tools.intentTracing.configurable",
	"tools.intentTracing.enabledByDefault",
	"historyImport",
	"auth.status",
	"auth.cancel",
	"auth.logout",
	"models.catalog",
	"models.switchInSession",
	"reasoning.supported",
	"approvals.supported",
	"approvals.structuredUserInput",
	"maintenance.compaction",
	"maintenance.contextUsage",
	"maintenance.history",
	"maintenance.health",
] as const;

const DELIVERY_CAPABILITY_PATHS = [
	"tools.piboManaged",
	"tools.nativeToolInspection",
	"tools.nativeToolYielding",
	"mcp.externalServers",
	"skills",
	"context",
] as const;

function readPath(value: unknown, path: string): unknown {
	let current = value;
	for (const segment of path.split(".")) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function safeDeclaredRelativePath(value: string): boolean {
	const normalized = value.replaceAll("\\", "/");
	return !normalized.startsWith("/")
		&& !/^[A-Za-z]:/.test(normalized)
		&& !normalized.includes("\0")
		&& normalized.split("/").every((segment) => segment !== "..");
}

function validateDelivery(path: string, value: unknown, errors: string[]): void {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		errors.push(`${path} must be a capability-delivery object`);
		return;
	}
	const delivery = value as Record<string, unknown>;
	const support = delivery.support;
	if (!["unsupported", "native", "direct", "mcp", "materialized", "degraded"].includes(String(support))) {
		errors.push(`${path}.support is invalid`);
		return;
	}
	if ((support === "unsupported" || support === "degraded") && (typeof delivery.reason !== "string" || !delivery.reason.trim())) {
		errors.push(`${path}.reason must explain ${support} support`);
	}
	if (support === "degraded" && (typeof delivery.mode !== "string" || !delivery.mode.trim())) {
		errors.push(`${path}.mode is required for degraded support`);
	}
	if (support === "mcp") {
		const transports = delivery.transports;
		if (!Array.isArray(transports) || transports.length === 0 || transports.some((item) => item !== "streamable-http" && item !== "stdio")) {
			errors.push(`${path}.transports must contain supported MCP transports`);
		}
	}
	if (support === "materialized") {
		const modes = delivery.modes;
		if (!Array.isArray(modes) || modes.length === 0 || modes.some((item) => typeof item !== "string" || !item.trim())) {
			errors.push(`${path}.modes must contain at least one non-empty mode`);
		}
	}
}

export function validateAgentRuntimeCapabilities(value: unknown): string[] {
	const errors: string[] = [];
	for (const path of BOOLEAN_CAPABILITY_PATHS) {
		if (typeof readPath(value, path) !== "boolean") errors.push(`${path} must be boolean`);
	}
	for (const path of DELIVERY_CAPABILITY_PATHS) validateDelivery(path, readPath(value, path), errors);

	const persistent = readPath(value, "lifecycle.persistent");
	for (const path of ["lifecycle.resume", "lifecycle.attach"] as const) {
		if (readPath(value, path) === true && persistent !== true) errors.push(`${path} requires lifecycle.persistent`);
	}
	const reasoningSupported = readPath(value, "reasoning.supported");
	const reasoningValues = readPath(value, "reasoning.values");
	if (reasoningValues !== undefined) {
		if (!Array.isArray(reasoningValues) || reasoningValues.some((item) => typeof item !== "string" || !item.trim())) {
			errors.push("reasoning.values must be an array of non-empty strings");
		} else if (new Set(reasoningValues).size !== reasoningValues.length) {
			errors.push("reasoning.values must not contain duplicates");
		}
	}
	if (reasoningSupported === false && Array.isArray(reasoningValues) && reasoningValues.length > 0) {
		errors.push("reasoning.values must be omitted or empty when reasoning is unsupported");
	}
	for (const feature of ["contextDiscovery", "nativeSubagents", "tools.intentTracing"] as const) {
		const supported = readPath(value, `${feature}.supported`);
		const configurable = readPath(value, `${feature}.configurable`);
		const enabledByDefault = readPath(value, `${feature}.enabledByDefault`);
		if (configurable === true && supported !== true) {
			errors.push(`${feature}.configurable requires ${feature}.supported`);
		}
		if (enabledByDefault === true && supported !== true) {
			errors.push(`${feature}.enabledByDefault requires ${feature}.supported`);
		}
	}
	const contextDiscoveryStrategy = readPath(value, "contextDiscovery.strategy");
	if (contextDiscoveryStrategy !== undefined
		&& !["filesystem-ancestors", "codex-project", "omp-project"].includes(String(contextDiscoveryStrategy))) {
		errors.push("contextDiscovery.strategy must be filesystem-ancestors, codex-project, or omp-project when provided");
	}
	if (contextDiscoveryStrategy !== undefined && readPath(value, "contextDiscovery.supported") !== true) {
		errors.push("contextDiscovery.strategy requires contextDiscovery.supported");
	}
	for (const field of ["knownFileNames", "knownUserRelativePaths", "knownCwdRelativePaths", "knownRelativePaths", "knownAncestorRelativePaths"] as const) {
		const knownContextPaths = readPath(value, `contextDiscovery.${field}`);
		if (knownContextPaths === undefined) continue;
		if (!Array.isArray(knownContextPaths)) {
			errors.push(`contextDiscovery.${field} must be an array of non-empty strings when provided`);
			continue;
		}
		if (knownContextPaths.some((name) => typeof name !== "string" || !name.trim())) {
			errors.push(`contextDiscovery.${field} must be an array of non-empty strings when provided`);
		} else if (new Set(knownContextPaths).size !== knownContextPaths.length) {
			errors.push(`contextDiscovery.${field} must not contain duplicates`);
		} else if (field === "knownFileNames" && knownContextPaths.some((name) => name.includes("/") || name.includes("\\") || name === "." || name === "..")) {
			errors.push("contextDiscovery.knownFileNames entries must be plain filenames");
		} else if (field !== "knownFileNames" && knownContextPaths.some((path) => !safeDeclaredRelativePath(path))) {
			errors.push(`contextDiscovery.${field} entries must be safe relative paths`);
		}
		if (readPath(value, "contextDiscovery.supported") !== true && knownContextPaths.length > 0) {
			errors.push(`contextDiscovery.${field} requires contextDiscovery.supported`);
		}
	}
	const authMethods = readPath(value, "auth.methods");
	if (!Array.isArray(authMethods)) {
		errors.push("auth.methods must be an array");
	} else {
		const seen = new Set<string>();
		for (const [index, method] of authMethods.entries()) {
			if (!method || typeof method !== "object" || Array.isArray(method)) {
				errors.push(`auth.methods[${index}] must be an auth-method object`);
				continue;
			}
			const record = method as Record<string, unknown>;
			if (!AGENT_RUNTIME_AUTH_METHOD_IDS.includes(record.id as never)) {
				errors.push(`auth.methods[${index}].id is invalid`);
			} else if (seen.has(String(record.id))) {
				errors.push(`auth.methods contains duplicate method "${String(record.id)}"`);
			} else {
				seen.add(String(record.id));
			}
			if (!AGENT_RUNTIME_AUTH_COMPLETION_MODES.includes(record.completion as never)) {
				errors.push(`auth.methods[${index}].completion is invalid`);
			}
		}
	}
	const authScope = readPath(value, "auth.credentialScope");
	if (authScope !== "runtime-instance" && authScope !== "adapter-shared") {
		errors.push("auth.credentialScope must be runtime-instance or adapter-shared");
	}
	const authStatus = readPath(value, "auth.status");
	if (Array.isArray(authMethods) && authMethods.length > 0 && authStatus !== true) {
		errors.push("auth.methods requires auth.status");
	}
	if ((readPath(value, "auth.cancel") === true || readPath(value, "auth.logout") === true) && authStatus !== true) {
		errors.push("auth.cancel and auth.logout require auth.status");
	}
	const optionsSchema = readPath(value, "models.optionsSchema");
	if (optionsSchema !== undefined && (!optionsSchema || typeof optionsSchema !== "object" || Array.isArray(optionsSchema))) {
		errors.push("models.optionsSchema must be a JSON Schema object");
	}
	return errors;
}

export function unsupportedAgentRuntimeCapability(reason: string): AgentRuntimeCapabilityDelivery {
	return { support: "unsupported", reason };
}

export function createMinimalAgentRuntimeCapabilities(): AgentRuntimeCapabilities {
	const unavailable = unsupportedAgentRuntimeCapability("This runtime adapter does not provide this capability.");
	return {
		lifecycle: {
			persistent: false,
			lazyBinding: false,
			resume: false,
			attach: false,
			listNativeSessions: false,
			fork: false,
			clone: false,
			tree: false,
		},
		input: {
			text: true,
			images: false,
			audio: false,
			steering: false,
			structuredOutput: false,
		},
		output: {
			assistantDeltas: true,
			reasoning: false,
			toolEvents: false,
			usage: false,
			plans: false,
			diffs: false,
			rawNativeEvents: false,
		},
		tools: {
			piboManaged: unavailable,
			nativeToolInspection: unavailable,
			nativeToolYielding: unavailable,
			intentTracing: {
				supported: false,
				configurable: false,
				enabledByDefault: false,
			},
		},
		mcp: {
			externalServers: unavailable,
			statusInspection: false,
		},
		skills: unavailable,
		context: unavailable,
		contextDiscovery: {
			supported: false,
			configurable: false,
			enabledByDefault: false,
		},
		nativeSubagents: {
			supported: false,
			configurable: false,
			enabledByDefault: false,
		},
		historyImport: false,
		auth: {
			status: false,
			methods: [],
			cancel: false,
			logout: false,
			credentialScope: "runtime-instance",
		},
		models: {
			catalog: false,
			switchInSession: false,
		},
		reasoning: {
			supported: false,
		},
		approvals: {
			supported: false,
			structuredUserInput: false,
		},
		maintenance: {
			compaction: false,
			contextUsage: false,
			history: false,
			health: true,
		},
	};
}
