import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolProfile } from "../../core/profiles.js";
import type {
	RuntimeCloseInput,
	RuntimeCloseResult,
	RuntimeExecInput,
	RuntimeExecResult,
	RuntimeInspectInput,
	RuntimeInspectResult,
	RuntimeInterruptInput,
	RuntimeInterruptResult,
	RuntimeListInput,
	RuntimeListResult,
	RuntimeStartInput,
	RuntimeStartResult,
	RuntimeVarsInput,
	RuntimeVarsResult,
} from "./types.js";

export type PiboRuntimeToolController = {
	start(input: RuntimeStartInput): Promise<RuntimeStartResult>;
	exec(input: RuntimeExecInput): Promise<RuntimeExecResult>;
	inspect(input: RuntimeInspectInput): Promise<RuntimeInspectResult>;
	vars(input: RuntimeVarsInput): Promise<RuntimeVarsResult>;
	interrupt(input: RuntimeInterruptInput): Promise<RuntimeInterruptResult>;
	close(input: RuntimeCloseInput): Promise<RuntimeCloseResult>;
	list(input: RuntimeListInput): Promise<RuntimeListResult> | RuntimeListResult;
};

export function createRuntimeToolProfile(): ToolProfile {
	return {
		name: "runtime",
		description: "Start and use persistent Python/Node runtime sessions with structured exec, inspect, vars, interrupt, close, and list actions.",
		yieldable: true,
		builtInPiboTool: "runtime",
	};
}

type RuntimeToolParams = {
	action: "start" | "exec" | "inspect" | "vars" | "interrupt" | "close" | "list";
	runtime?: "python" | "node";
	name?: string;
	target?: unknown;
	sessionId?: string;
	code?: string;
	timeoutMs?: number;
	mode?: "exec" | "eval" | "auto";
	closeOnSuccess?: boolean;
	expression?: string;
	what?: "summary" | "signature" | "members" | "source" | "doc" | "all";
	maxBytes?: number;
	includePrivate?: boolean;
	maxItems?: number;
	force?: boolean;
};

function requireString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`runtime.${field} must be a non-empty string`);
	return value;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function validateTarget(value: unknown): RuntimeStartInput["target"] {
	const object = asObject(value);
	if (!object) return undefined;
	const target: RuntimeStartInput["target"] = {};
	if (object.type !== undefined) {
		if (object.type !== "local" && object.type !== "docker" && object.type !== "ssh") throw new Error("runtime.target.type must be local, docker, or ssh");
		target.type = object.type;
	}
	if (object.cwd !== undefined) target.cwd = requireString(object.cwd, "target.cwd");
	if (object.executable !== undefined) target.executable = requireString(object.executable, "target.executable");
	if (object.args !== undefined) {
		if (!Array.isArray(object.args) || object.args.some((arg) => typeof arg !== "string")) throw new Error("runtime.target.args must be an array of strings");
		target.args = [...object.args] as string[];
	}
	if (object.env !== undefined) {
		const env = asObject(object.env);
		if (!env) throw new Error("runtime.target.env must be an object");
		target.env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, requireString(value, `target.env.${key}`)]));
	}
	return target;
}

function resultStatus(result: unknown): string | undefined {
	return asObject(result)?.status as string | undefined;
}

function isErrorStatus(status: string | undefined): boolean {
	return status !== undefined && status !== "ok";
}

function formatRuntimeResult(result: unknown): string {
	const object = asObject(result) ?? {};
	const lines = [
		`status: ${object.status ?? "unknown"}`,
	];
	if (object.sessionId) lines.push(`sessionId: ${object.sessionId}`);
	if (object.runtime) lines.push(`runtime: ${object.runtime}`);
	if (object.autoClosed !== undefined) lines.push(`autoClosed: ${object.autoClosed}`);
	if (object.executionCount !== undefined) lines.push(`executionCount: ${object.executionCount}`);
	if (object.durationMs !== undefined) lines.push(`durationMs: ${object.durationMs}`);
	if (typeof object.stdout === "string" && object.stdout.length > 0) lines.push("", "stdout:", object.stdout);
	if (typeof object.stderr === "string" && object.stderr.length > 0) lines.push("", "stderr:", object.stderr);
	if (object.result !== undefined && object.result !== null) lines.push("", "result:", JSON.stringify(object.result, null, 2));
	if (object.error !== undefined) lines.push("", "error:", JSON.stringify(object.error, null, 2));
	if (object.sessions !== undefined) lines.push("", "sessions:", JSON.stringify(object.sessions, null, 2));
	if (object.variables !== undefined) lines.push("", "variables:", JSON.stringify(object.variables, null, 2));
	if (object.summary !== undefined) lines.push("", "summary:", JSON.stringify(object.summary, null, 2));
	if (object.signature !== undefined) lines.push("", "signature:", String(object.signature));
	if (object.members !== undefined) lines.push("", "members:", JSON.stringify(object.members, null, 2));
	if (object.source !== undefined) lines.push("", "source:", String(object.source));
	if (object.doc !== undefined) lines.push("", "doc:", String(object.doc));
	if (object.closed !== undefined) lines.push(`closed: ${object.closed}`);
	if (object.message !== undefined) lines.push(`message: ${object.message}`);
	return lines.join("\n");
}

export function createRuntimeToolDefinition(controller: PiboRuntimeToolController): ToolDefinition {
	return defineTool({
		name: "runtime",
		label: "Runtime",
		description: "Start and use persistent Python runtime sessions. Supports start, exec, inspect, vars, interrupt, close, and list. Node runtime is reserved for a later backend.",
		promptSnippet: "Use runtime for stateful Python/Node exploration. Set closeOnSuccess on exec for one-shot code: success closes the runtime; failure keeps prior state for inspection and repair. Use bash for shell commands and package installs.",
		executionMode: "parallel",
		parameters: Type.Object({
			action: StringEnum(["start", "exec", "inspect", "vars", "interrupt", "close", "list"], { description: "Runtime action to perform." }),
			runtime: Type.Optional(StringEnum(["python", "node"], { description: "Runtime kind for start. Python is implemented first." })),
			name: Type.Optional(Type.String({ description: "Optional human-readable runtime name." })),
			target: Type.Optional(Type.Any({ description: "Runtime target options such as { type: 'local', cwd, executable, args, env }." })),
			sessionId: Type.Optional(Type.String({ description: "Runtime session id returned by start." })),
			code: Type.Optional(Type.String({ description: "Code to execute for exec." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Action timeout in milliseconds." })),
			mode: Type.Optional(StringEnum(["exec", "eval", "auto"], { description: "Execution mode for exec." })),
			closeOnSuccess: Type.Optional(Type.Boolean({ description: "For exec: close the runtime only if execution succeeds." })),
			expression: Type.Optional(Type.String({ description: "Expression to inspect." })),
			what: Type.Optional(StringEnum(["summary", "signature", "members", "source", "doc", "all"], { description: "Inspection detail to return." })),
			maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes for summaries or inspect fields." })),
			includePrivate: Type.Optional(Type.Boolean({ description: "For vars: include private names." })),
			maxItems: Type.Optional(Type.Number({ description: "For vars: maximum variables to return." })),
			force: Type.Optional(Type.Boolean({ description: "For close: force process termination." })),
		}),
		async execute(_toolCallId, params: RuntimeToolParams) {
			let result: unknown;
			try {
				switch (params.action) {
					case "start":
						result = await controller.start({
							runtime: params.runtime ?? "python",
							name: params.name,
							target: validateTarget(params.target),
							timeoutMs: params.timeoutMs,
						});
						break;
					case "exec":
						result = await controller.exec({
							sessionId: requireString(params.sessionId, "sessionId"),
							code: requireString(params.code, "code"),
							timeoutMs: params.timeoutMs,
							mode: params.mode,
							closeOnSuccess: params.closeOnSuccess,
						});
						break;
					case "inspect":
						result = await controller.inspect({
							sessionId: requireString(params.sessionId, "sessionId"),
							expression: requireString(params.expression, "expression"),
							what: params.what,
							maxBytes: params.maxBytes,
						});
						break;
					case "vars":
						result = await controller.vars({ sessionId: requireString(params.sessionId, "sessionId"), includePrivate: params.includePrivate, maxItems: params.maxItems, maxBytes: params.maxBytes });
						break;
					case "interrupt":
						result = await controller.interrupt({ sessionId: requireString(params.sessionId, "sessionId") });
						break;
					case "close":
						result = await controller.close({ sessionId: requireString(params.sessionId, "sessionId"), force: params.force });
						break;
					case "list":
						result = await controller.list({});
						break;
				}
			} catch (error) {
				result = {
					status: "failed",
					error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { name: "RuntimeToolError", message: String(error) },
				};
			}

			const status = resultStatus(result);
			return {
				content: [{ type: "text", text: formatRuntimeResult(result) }],
				details: result,
				isError: isErrorStatus(status),
			};
		},
	});
}
