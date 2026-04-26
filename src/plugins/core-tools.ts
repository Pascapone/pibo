import { spawn } from "node:child_process";
import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { ToolProfile } from "../core/profiles.js";

type ExecResult = {
	command: string;
	cwd: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

const DEFAULT_MAX_OUTPUT_CHARS = 20000;

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n[truncated ${value.length - maxChars} chars]`;
}

const piboEchoTool = defineTool({
	name: "pibo_echo",
	label: "Pibo Echo",
	description: "Echo a short message. Use this only to verify that pibo custom tools are available.",
	promptSnippet: "Echo a short message to verify pibo custom tool wiring.",
	parameters: Type.Object({
		message: Type.String({ description: "Message to echo back" }),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: params.message }],
			details: { echoed: params.message },
		};
	},
});

const piboWorkspaceInfoTool = defineTool({
	name: "pibo_workspace_info",
	label: "Pibo Workspace Info",
	description: "Return the current pibo workspace path and basic runtime metadata.",
	promptSnippet: "Return the current pibo workspace path and basic runtime metadata.",
	parameters: Type.Object({}),
	async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							cwd: ctx.cwd,
							hasUI: ctx.hasUI,
						},
						null,
						2,
					),
				},
			],
			details: {
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
			},
		};
	},
});

const piboExecTool = defineTool({
	name: "pibo_exec",
	label: "Pibo Exec",
	description: "Run a shell command on this machine with full agent privileges.",
	promptSnippet:
		"Run a shell command on this machine. Use directly for short commands, or wrap with pibo_run_start for long-running commands.",
	parameters: Type.Object({
		command: Type.String({ description: "Shell command to run through bash -lc" }),
		cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the pibo runtime cwd." })),
		timeoutMs: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds. Omit for no timeout." })),
		maxOutputChars: Type.Optional(Type.Number({ description: "Maximum stdout/stderr chars returned per stream" })),
	}),
	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const cwd = params.cwd ?? ctx.cwd;
		const maxOutputChars = Math.max(0, params.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS);
		const result = await new Promise<ExecResult>((resolve, reject) => {
			const child = spawn("bash", ["-lc", params.command], {
				cwd,
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timeout =
				params.timeoutMs && params.timeoutMs > 0
					? setTimeout(() => {
							timedOut = true;
							child.kill("SIGTERM");
						}, params.timeoutMs)
					: undefined;
			const abort = () => {
				timedOut = false;
				child.kill("SIGTERM");
			};

			signal?.addEventListener("abort", abort, { once: true });
			child.stdout?.on("data", (chunk) => {
				stdout += String(chunk);
			});
			child.stderr?.on("data", (chunk) => {
				stderr += String(chunk);
			});
			child.once("error", (error) => {
				if (timeout) clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				reject(error);
			});
			child.once("close", (exitCode, exitSignal) => {
				if (timeout) clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				resolve({
					command: params.command,
					cwd,
					exitCode,
					signal: exitSignal,
					stdout: truncate(stdout, maxOutputChars),
					stderr: truncate(stderr, maxOutputChars),
					timedOut,
				});
			});
		});

		const text = [
			`exitCode: ${result.exitCode}`,
			result.signal ? `signal: ${result.signal}` : undefined,
			result.timedOut ? "timedOut: true" : undefined,
			result.stdout ? `stdout:\n${result.stdout}` : undefined,
			result.stderr ? `stderr:\n${result.stderr}` : undefined,
		].filter(Boolean).join("\n\n");

		return {
			content: [{ type: "text", text }],
			details: result,
			isError: result.exitCode !== 0,
		};
	},
});

export function createPiboTestToolProfiles(): ToolProfile[] {
	return [
		createToolProfile(piboEchoTool),
		createToolProfile(piboWorkspaceInfoTool),
		createToolProfile(piboExecTool),
	];
}

function createToolProfile(definition: ToolDefinition): ToolProfile {
	return {
		name: definition.name,
		description: definition.description,
		definition,
	};
}
