import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { PiboJsonObject } from "../../core/events.js";

export const PI_TOOL_INTENT_FIELD = "i";

const intentTracingSessions = new WeakSet<AgentSession>();

const PI_TOOL_INTENT_SCHEMA = {
	type: "string",
	minLength: 1,
	description: "Capitalized 2–6-word present-participle intent describing why this tool is being called; no period.",
} as const;

export function piIntentTracingEnabled(runtimeOptions: PiboJsonObject): boolean {
	return runtimeOptions["intentTracing"] === true;
}

export function splitPiToolIntentArguments(value: unknown): { args: unknown; intent?: string } {
	if (!value || typeof value !== "object" || Array.isArray(value)) return { args: value };
	const record = value as Record<string, unknown>;
	const intent = typeof record[PI_TOOL_INTENT_FIELD] === "string" && record[PI_TOOL_INTENT_FIELD].trim()
		? record[PI_TOOL_INTENT_FIELD].trim()
		: undefined;
	const { [PI_TOOL_INTENT_FIELD]: _intent, ...args } = record;
	return intent ? { args, intent } : { args };
}

export function injectPiToolIntentSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
	const record = schema as Record<string, unknown>;
	if (record.type !== "object") return schema;
	const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
		? record.properties as Record<string, unknown>
		: {};
	if (Object.prototype.hasOwnProperty.call(properties, PI_TOOL_INTENT_FIELD)) {
		throw new Error(`Pi intent tracing cannot wrap a tool whose schema already defines "${PI_TOOL_INTENT_FIELD}".`);
	}
	const required = Array.isArray(record.required)
		? record.required.filter((name): name is string => typeof name === "string" && name !== PI_TOOL_INTENT_FIELD)
		: [];
	return {
		...record,
		properties: {
			[PI_TOOL_INTENT_FIELD]: PI_TOOL_INTENT_SCHEMA,
			...properties,
		},
		required: [PI_TOOL_INTENT_FIELD, ...required],
	};
}

export function piIntentTracingInstalled(session: AgentSession): boolean {
	return intentTracingSessions.has(session);
}

export function installPiIntentTracing(session: AgentSession): void {
	if (intentTracingSessions.has(session)) return;
	const wrappedTools = new WeakMap<AgentTool, AgentTool>();
	const wrapActiveTools = () => {
		session.agent.state.tools = session.agent.state.tools.map((tool) => {
			const existing = wrappedTools.get(tool);
			if (existing) return existing;
			const wrapped = wrapPiToolWithIntent(tool);
			wrappedTools.set(tool, wrapped);
			return wrapped;
		});
	};
	const setActiveToolsByName = session.setActiveToolsByName.bind(session);
	session.setActiveToolsByName = (toolNames) => {
		setActiveToolsByName(toolNames);
		wrapActiveTools();
	};
	wrapActiveTools();
	intentTracingSessions.add(session);
}

function wrapPiToolWithIntent(tool: AgentTool): AgentTool {
	const prepareArguments = tool.prepareArguments;
	return {
		...tool,
		parameters: injectPiToolIntentSchema(tool.parameters) as AgentTool["parameters"],
		prepareArguments: (rawArgs) => {
			const { args, intent } = splitPiToolIntentArguments(rawArgs);
			const prepared = prepareArguments ? prepareArguments(args) : args;
			if (!prepared || typeof prepared !== "object" || Array.isArray(prepared)) return prepared as never;
			return {
				...(prepared as Record<string, unknown>),
				...(intent ? { [PI_TOOL_INTENT_FIELD]: intent } : {}),
			} as never;
		},
		execute: async (toolCallId, params, signal, onUpdate) => {
			const { args } = splitPiToolIntentArguments(params);
			return await tool.execute(toolCallId, args as never, signal, onUpdate);
		},
	};
}
