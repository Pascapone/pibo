import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiboJsonObject } from "../../core/events.js";

export const PI_TOOL_INTENT_FIELD = "i";
const PI_TOOL_INTENT_FALLBACK_FIELD = "__pibo_intent";

const intentTracingSessions = new WeakMap<AgentSession, Map<string, string>>();

const PI_TOOL_INTENT_SCHEMA = {
	type: "string",
	minLength: 1,
	description: "Capitalized 2–6-word present-participle intent describing why this tool is being called; no period.",
} as const;

export function piIntentTracingEnabled(runtimeOptions: PiboJsonObject): boolean {
	return runtimeOptions["intentTracing"] === true;
}

export function splitPiToolIntentArguments(value: unknown, intentField = PI_TOOL_INTENT_FIELD): { args: unknown; intent?: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { args: value };
	const record = value as Record<string, unknown>;
	const intentValue = record[intentField];
	const intent = typeof intentValue === "string" && intentValue.trim() ? intentValue.trim() : undefined;
	const { [intentField]: _intent, ...args } = record;
	return intent ? { args, intent } : { args };
}

export function piToolIntentFieldForSchema(schema: unknown): string {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return PI_TOOL_INTENT_FIELD;
	const record = schema as Record<string, unknown>;
	if (record.type !== "object") return PI_TOOL_INTENT_FIELD;
	const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
		? record.properties as Record<string, unknown>
		: {};
	const required = new Set(Array.isArray(record.required)
		? record.required.filter((name): name is string => typeof name === "string")
		: []);
	const fieldIsUsed = (field: string) => Object.prototype.hasOwnProperty.call(properties, field) || required.has(field);
	if (!fieldIsUsed(PI_TOOL_INTENT_FIELD)) return PI_TOOL_INTENT_FIELD;
	let candidate = PI_TOOL_INTENT_FALLBACK_FIELD;
	let suffix = 2;
	while (fieldIsUsed(candidate)) candidate = `${PI_TOOL_INTENT_FALLBACK_FIELD}_${suffix++}`;
	return candidate;
}

export function injectPiToolIntentSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
	const record = schema as Record<string, unknown>;
	if (record.type !== "object") return schema;
	const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
		? record.properties as Record<string, unknown>
		: {};
	const intentField = piToolIntentFieldForSchema(schema);
	const required = Array.isArray(record.required)
		? record.required.filter((name): name is string => typeof name === "string" && name !== intentField)
		: [];
	return {
		...record,
		properties: {
			[intentField]: PI_TOOL_INTENT_SCHEMA,
			...properties,
		},
		required: [intentField, ...required],
	};
}

export function piIntentTracingInstalled(session: AgentSession): boolean {
	return intentTracingSessions.has(session);
}

export function piToolIntentField(session: AgentSession, toolName: string): string | undefined {
	return intentTracingSessions.get(session)?.get(toolName);
}

export function installPiIntentTracing(session: AgentSession): void {
	if (intentTracingSessions.has(session)) return;
	const intentFields = new Map<string, string>();
	const wrappedTools = new WeakMap<AgentTool, { tool: AgentTool; intentField: string }>();
	const wrapActiveTools = () => {
		session.agent.state.tools = session.agent.state.tools.map((tool) => {
			const existing = wrappedTools.get(tool);
			if (existing) {
				intentFields.set(tool.name, existing.intentField);
				return existing.tool;
			}
			const wrapped = wrapPiToolWithIntent(tool);
			wrappedTools.set(tool, wrapped);
			intentFields.set(tool.name, wrapped.intentField);
			return wrapped.tool;
		});
	};
	const setActiveToolsByName = session.setActiveToolsByName.bind(session);
	session.setActiveToolsByName = (toolNames) => {
		setActiveToolsByName(toolNames);
		wrapActiveTools();
	};
	intentTracingSessions.set(session, intentFields);
	wrapActiveTools();
}

function wrapPiToolWithIntent(tool: AgentTool): { tool: AgentTool; intentField: string } {
	const prepareArguments = tool.prepareArguments;
	const intentField = piToolIntentFieldForSchema(tool.parameters);
	return {
		intentField,
		tool: {
			...tool,
			parameters: injectPiToolIntentSchema(tool.parameters) as AgentTool["parameters"],
			prepareArguments: (rawArgs) => {
				const { args, intent } = splitPiToolIntentArguments(rawArgs, intentField);
				const prepared = prepareArguments ? prepareArguments(args) : args;
				if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) return prepared as never;
				return {
					...(prepared as Record<string, unknown>),
					...(intent ? { [intentField]: intent } : {}),
				} as never;
			},
			execute: async (toolCallId, params, signal, onUpdate) => {
				const { args } = splitPiToolIntentArguments(params, intentField);
				return await tool.execute(toolCallId, args as never, signal, onUpdate);
			},
		},
	};
}
