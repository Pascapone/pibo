import type { PiboJsonObject } from "../core/events.js";

export type AgentRuntimeCapabilityDelivery =
	| { support: "unsupported"; reason: string }
	| { support: "native" }
	| { support: "direct" }
	| { support: "mcp"; transports: readonly ("streamable-http" | "stdio")[] }
	| { support: "materialized"; modes: readonly string[] }
	| { support: "degraded"; mode: string; reason: string };

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
		nativeToolYielding: AgentRuntimeCapabilityDelivery;
	};
	mcp: {
		externalServers: AgentRuntimeCapabilityDelivery;
		statusInspection: boolean;
	};
	skills: AgentRuntimeCapabilityDelivery;
	context: AgentRuntimeCapabilityDelivery;
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
			nativeToolYielding: unavailable,
		},
		mcp: {
			externalServers: unavailable,
			statusInspection: false,
		},
		skills: unavailable,
		context: unavailable,
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
