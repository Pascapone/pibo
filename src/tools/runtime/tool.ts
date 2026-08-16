import { Type } from "typebox";
import { piboStringEnum } from "../schema.js";
import { definePiboTool, type PiboToolDefinition } from "../contract.js";
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
		description: "Run Python/Node code in persistent runtime sessions; exec runs normal scripts.",
		yieldable: true,
		builtInPiboTool: "runtime",
	};
}

type RuntimeToolParams = {
	action: "exec" | "inspect" | "vars" | "interrupt" | "list";
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

export function createRuntimeToolDefinition(controller: PiboRuntimeToolController): PiboToolDefinition {
	return definePiboTool({
		name: "runtime",
		title: "Runtime",
		description: "Run Python/Node code in persistent sessions. Use this instead of bash for Python/Node execution except trivial one-line shell checks.",
		promptSnippet: "Use runtime for Python/Node execution, especially longer snippets (~20+ lines), uncertain code, or objects/state to inspect. Prefer runtime over bash for Python/Node except trivial one-line shell checks. Auto-starts on exec; print values you need. Runtime keeps variables and processes alive between calls; reuse sessionId to inspect or continue from that state after partial failures. This saves output tokens and keeps your mental model tied to live state. Use read for file contents; use bash for shell commands and package installs.",
		executionMode: "parallel",
		inputSchema: Type.Object({
			action: piboStringEnum(["exec", "inspect", "vars", "interrupt", "list"], { description: "Runtime action to perform." }),
			runtime: Type.Optional(piboStringEnum(["python", "node"], { description: "Runtime kind; default python." })),
			name: Type.Optional(Type.String({ description: "Optional human-readable runtime name." })),
			target: Type.Optional(Type.Any({ description: "Auto-start target options such as { type: 'local', cwd, executable, args, env }." })),
			sessionId: Type.Optional(Type.String({ description: "Existing runtime session id; omit to use auto runtime." })),
			code: Type.Optional(Type.String({ description: "Code to execute for exec." })),
			timeoutMs: Type.Optional(Type.Number({ description: "Action timeout in milliseconds." })),
			mode: Type.Optional(piboStringEnum(["exec", "eval", "auto"], { description: "For exec: execution mode. Use eval when you need an expression result." })),
			closeOnSuccess: Type.Optional(Type.Boolean({ description: "For exec: close the runtime only if execution succeeds." })),
			expression: Type.Optional(Type.String({ description: "Expression to inspect." })),
			what: Type.Optional(piboStringEnum(["summary", "signature", "members", "source", "doc", "all"], { description: "Inspection detail to return." })),
			maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes for summaries or inspect fields." })),
			includePrivate: Type.Optional(Type.Boolean({ description: "For vars: include private names." })),
			maxItems: Type.Optional(Type.Number({ description: "For vars: maximum variables to return." })),
		}),
		async execute(_toolCallId, params: RuntimeToolParams) {
			let result: unknown;
			try {
				switch (params.action) {
					case "exec":
						result = await controller.exec({
							sessionId: params.sessionId,
							runtime: params.runtime,
							name: params.name,
							target: validateTarget(params.target),
							code: requireString(params.code, "code"),
							timeoutMs: params.timeoutMs,
							mode: params.mode,
							closeOnSuccess: params.closeOnSuccess,
						});
						break;
					case "inspect":
						result = await controller.inspect({
							sessionId: params.sessionId,
							runtime: params.runtime,
							expression: requireString(params.expression, "expression"),
							what: params.what,
							maxBytes: params.maxBytes,
						});
						break;
					case "vars":
						result = await controller.vars({ sessionId: params.sessionId, runtime: params.runtime, includePrivate: params.includePrivate, maxItems: params.maxItems, maxBytes: params.maxBytes });
						break;
					case "interrupt":
						result = await controller.interrupt({ sessionId: params.sessionId, runtime: params.runtime });
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
