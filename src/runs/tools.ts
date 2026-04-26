import { StringEnum, Type } from "@mariozechner/pi-ai";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import type {
	PiboRunCompletionPolicy,
	PiboRunReadResult,
	PiboRunSnapshot,
	PiboRunWaitResult,
	PiboToolRunResult,
} from "./registry.js";

export type PiboRunStartToolInput = {
	toolName: string;
	params: unknown;
	completionPolicy?: PiboRunCompletionPolicy;
	execute(): Promise<PiboToolRunResult>;
};

export type PiboRunToolController = {
	startToolRun(input: PiboRunStartToolInput): PiboRunSnapshot;
	listRuns(options?: { includeConsumed?: boolean; includeDetached?: boolean }): PiboRunSnapshot[];
	getRunStatus(runId: string): PiboRunSnapshot;
	waitForRun(runId: string, timeoutMs: number): Promise<PiboRunWaitResult>;
	readRun(runId: string): PiboRunReadResult;
	cancelRun(runId: string): Promise<PiboRunSnapshot>;
	ackRun(runId: string): PiboRunSnapshot;
};

function resultText(prefix: string, value: unknown): string {
	return `${prefix}\n${JSON.stringify(value, null, 2)}`;
}

function textFromToolResult(result: { content?: unknown }): string | undefined {
	if (!Array.isArray(result.content)) return undefined;
	const text = result.content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
		})
		.filter(Boolean)
		.join("\n");
	return text || undefined;
}

function requireTool(tools: readonly ToolDefinition[], name: string): ToolDefinition {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`Unknown or non-yieldable tool "${name}"`);
	}
	return tool;
}

export function createRunToolDefinitions(
	yieldableTools: readonly ToolDefinition[],
	controller: PiboRunToolController,
): ToolDefinition[] {
	const toolNames = yieldableTools.map((tool) => tool.name);

	return [
		defineTool({
			name: "pibo_run_start",
			label: "Pibo Run Start",
			description:
				"Start a yieldable tool as a yielded run. Use tracked when the result may matter later; use detached only for intentional fire-and-forget work.",
			promptSnippet:
				"Use pibo_run_start to run a yieldable tool in the background. It returns a runId. Use pibo_run_read for completed results and pibo_run_wait/status/list/cancel/ack to manage runs.",
			executionMode: "parallel",
			parameters: Type.Object({
				toolName: StringEnum(toolNames, { description: "Yieldable tool name to start" }),
				arguments: Type.Any({ description: "Arguments object for the selected tool" }),
				completionPolicy: Type.Optional(
					StringEnum(["tracked", "detached"], {
						description:
							"tracked reminds this agent about completion; detached is fire-and-forget and creates no automatic reminders.",
						default: "tracked",
					}),
				),
			}),
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const tool = requireTool(yieldableTools, params.toolName);
				const run = controller.startToolRun({
					toolName: tool.name,
					params: params.arguments,
					completionPolicy: params.completionPolicy as PiboRunCompletionPolicy | undefined,
					async execute() {
						const result = await tool.execute(toolCallId, params.arguments, signal, onUpdate, ctx);
						const resultObject = result as { content?: unknown; details?: unknown; isError?: unknown };
						const text = textFromToolResult(resultObject);
						if (resultObject.isError === true) {
							throw new Error(text ?? `${tool.name} returned an error result.`);
						}
						return {
							text,
							details: resultObject.details ?? result,
						};
					},
				});
				return {
					content: [{ type: "text", text: resultText(`Started yielded run ${run.runId}.`, run) }],
					details: run,
				};
			},
		}),
		defineTool({
			name: "pibo_run_list",
			label: "Pibo Run List",
			description: "List yielded runs owned by this agent session.",
			promptSnippet: "Use pibo_run_list to inspect yielded runs owned by this session.",
			executionMode: "parallel",
			parameters: Type.Object({
				includeConsumed: Type.Optional(Type.Boolean({ description: "Include already read, cancelled, or acknowledged runs" })),
				includeDetached: Type.Optional(Type.Boolean({ description: "Include fire-and-forget detached runs" })),
			}),
			async execute(_toolCallId, params) {
				const runs = controller.listRuns({
					includeConsumed: params.includeConsumed,
					includeDetached: params.includeDetached,
				});
				return {
					content: [{ type: "text", text: resultText("Runs:", { runs }) }],
					details: { runs },
				};
			},
		}),
		defineTool({
			name: "pibo_run_status",
			label: "Pibo Run Status",
			description: "Read compact status for one yielded run.",
			promptSnippet: "Use pibo_run_status to inspect one yielded run without reading its full result.",
			executionMode: "parallel",
			parameters: Type.Object({
				runId: Type.String({ description: "Run id returned by pibo_run_start" }),
			}),
			async execute(_toolCallId, params) {
				const run = controller.getRunStatus(params.runId);
				return {
					content: [{ type: "text", text: resultText(`Run ${run.runId} status: ${run.status}.`, run) }],
					details: run,
				};
			},
		}),
		defineTool({
			name: "pibo_run_wait",
			label: "Pibo Run Wait",
			description: "Wait a bounded time for a yielded run. Timeout is normal and does not mean failure.",
			promptSnippet: "Use pibo_run_wait when blocked on a run. Timeout is normal; call again or continue other work.",
			executionMode: "parallel",
			parameters: Type.Object({
				runId: Type.String({ description: "Run id returned by pibo_run_start" }),
				timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait time in milliseconds, clamped to 300000" })),
			}),
			async execute(_toolCallId, params) {
				const run = await controller.waitForRun(params.runId, params.timeoutMs ?? 30000);
				return {
					content: [
						{
							type: "text",
							text: resultText(
								run.timedOut
									? `Run ${run.runId} is still ${run.status}; wait timed out.`
									: `Run ${run.runId} reached ${run.status}.`,
								run,
							),
						},
					],
					details: run,
				};
			},
		}),
		defineTool({
			name: "pibo_run_read",
			label: "Pibo Run Read",
			description: "Read the terminal result or error for a yielded run.",
			promptSnippet: "Use pibo_run_read to retrieve a completed or failed run result. Reading terminal tracked runs consumes reminders.",
			executionMode: "parallel",
			parameters: Type.Object({
				runId: Type.String({ description: "Run id returned by pibo_run_start" }),
			}),
			async execute(_toolCallId, params) {
				const run = controller.readRun(params.runId);
				const text = run.result?.text ?? run.error ?? `Run ${run.runId} is ${run.status}; no terminal result is available yet.`;
				return {
					content: [{ type: "text", text }],
					details: run,
				};
			},
		}),
		defineTool({
			name: "pibo_run_cancel",
			label: "Pibo Run Cancel",
			description: "Cancel a yielded run if possible and suppress future reminders.",
			promptSnippet: "Use pibo_run_cancel when a yielded run is no longer needed.",
			executionMode: "parallel",
			parameters: Type.Object({
				runId: Type.String({ description: "Run id returned by pibo_run_start" }),
			}),
			async execute(_toolCallId, params) {
				const run = await controller.cancelRun(params.runId);
				return {
					content: [{ type: "text", text: resultText(`Cancelled run ${run.runId}.`, run) }],
					details: run,
				};
			},
		}),
		defineTool({
			name: "pibo_run_ack",
			label: "Pibo Run Ack",
			description: "Acknowledge a yielded run update and suppress reminders for its current state.",
			promptSnippet:
				"Use pibo_run_ack when you intentionally do not need to read a completed result or do not need more reminders for the current running state.",
			executionMode: "parallel",
			parameters: Type.Object({
				runId: Type.String({ description: "Run id returned by pibo_run_start" }),
			}),
			async execute(_toolCallId, params) {
				const run = controller.ackRun(params.runId);
				return {
					content: [{ type: "text", text: resultText(`Acknowledged run ${run.runId}.`, run) }],
					details: run,
				};
			},
		}),
	];
}
