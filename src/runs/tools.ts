import { Type } from "typebox";
import { piboStringEnum } from "../tools/schema.js";
import { definePiboTool, type PiboToolDefinition } from "../tools/contract.js";
import { foregroundServiceWarning, hasMeaningfulTimeoutOutput, isConfiguredTimeoutError, PiboRunExecutionTimeoutError, resolveRunTimeoutMs } from "./lifecycle.js";
import { PiboRunResourceLimitError, prepareYieldedRunExecution, type PiboRunResourceUsage } from "./resource-isolation.js";
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
	retryable?: boolean;
	maxAttempts?: number;
	timeoutMs?: number;
	serviceWarning?: string;
	resources?: PiboRunResourceUsage;
	execute(): Promise<PiboToolRunResult>;
	cancel?(): Promise<void>;
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

function requireTool(tools: readonly PiboToolDefinition[], name: string): PiboToolDefinition {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`Unknown or non-yieldable tool "${name}"`);
	}
	return tool;
}

async function waitForRunCancellationSettlement(settled: Promise<void>, timeoutMs = 15_000): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			settled,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`Yielded run did not settle within ${timeoutMs}ms after cancellation.`)), timeoutMs);
				timer.unref?.();
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function createRunToolDefinitions(
	yieldableTools: readonly PiboToolDefinition[],
	controller: PiboRunToolController,
): PiboToolDefinition[] {
	const toolNames = yieldableTools.map((tool) => tool.name);

	return [
		definePiboTool({
			name: "pibo_run_start",
			title: "Pibo Run Start",
			description:
				"Start a yieldable tool as a yielded run. The run records its configured timeout and classifies lifetime expiry separately from command failure. Use detached only for intentional fire-and-forget work.",
			promptSnippet:
				"Use pibo_run_start to run a yieldable tool in the background. It returns a runId. Use pibo_run_read for completed results and pibo_run_wait/status/list/cancel/ack to manage runs.",
			executionMode: "parallel",
			inputSchema: Type.Object({
				toolName: piboStringEnum(toolNames, { description: "Yieldable tool name to start" }),
				arguments: Type.Any({ description: "Arguments object for the selected tool" }),
				completionPolicy: Type.Optional(
					piboStringEnum(["tracked", "detached"], {
						description:
							"tracked reminds this agent about completion; detached is fire-and-forget and creates no automatic reminders.",
						default: "tracked",
					}),
				),
			}),
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const tool = requireTool(yieldableTools, params.toolName);
				const timeoutMs = resolveRunTimeoutMs(tool.name, params.arguments);
				const serviceWarning = foregroundServiceWarning(tool.name, params.arguments, timeoutMs);
				const prepared = prepareYieldedRunExecution(tool.name, params.arguments);
				const runAbortController = new AbortController();
				const runSignal = signal ? AbortSignal.any([signal, runAbortController.signal]) : runAbortController.signal;
				let executionStarted = false;
				let resolveExecutionSettled: (() => void) | undefined;
				const executionSettled = new Promise<void>((resolve) => {
					resolveExecutionSettled = resolve;
				});
				let observedOutput = false;
				const run = controller.startToolRun({
					toolName: tool.name,
					params: params.arguments,
					completionPolicy: params.completionPolicy as PiboRunCompletionPolicy | undefined,
					timeoutMs,
					serviceWarning,
					resources: prepared.resources,
					async cancel() {
						runAbortController.abort(new Error("Yielded run was cancelled."));
							await prepared.cancel();
							if (executionStarted) await waitForRunCancellationSettlement(executionSettled);
					},
					async execute() {
						executionStarted = true;
						try {
							const result = await prepared.execute(() => tool.execute(toolCallId, prepared.params, runSignal, (update) => {
								observedOutput ||= hasMeaningfulTimeoutOutput(update);
								onUpdate?.(update);
							}, ctx));
							const resultObject = result as { content?: unknown; details?: unknown; isError?: unknown };
							const text = textFromToolResult(resultObject);
							if (resultObject.isError === true) {
								if (timeoutMs !== undefined && isConfiguredTimeoutError(text ?? "")) throw new PiboRunExecutionTimeoutError(text ?? `${tool.name} timed out.`, observedOutput || hasMeaningfulTimeoutOutput(text) ? "lifetime" : "startup");
								throw new Error(text ?? `${tool.name} returned an error result.`);
							}
							return { text, details: resultObject.details ?? result };
						} catch (error) {
							if (error instanceof PiboRunExecutionTimeoutError || error instanceof PiboRunResourceLimitError) throw error;
							if (timeoutMs !== undefined && isConfiguredTimeoutError(error)) throw new PiboRunExecutionTimeoutError(error instanceof Error ? error.message : String(error), observedOutput ? "lifetime" : "startup");
							throw error;
						} finally {
							resolveExecutionSettled?.();
						}
					},
				});
				const prefix = serviceWarning ? `Started yielded run ${run.runId}.\nWarning: ${serviceWarning}` : `Started yielded run ${run.runId}.`;
				return {
					content: [{ type: "text", text: resultText(prefix, run) }],
					details: run,
				};
			},
		}),
		definePiboTool({
			name: "pibo_run_list",
			title: "Pibo Run List",
			description: "List yielded runs owned by this agent session.",
			promptSnippet: "Use pibo_run_list to inspect yielded runs owned by this session.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
		definePiboTool({
			name: "pibo_run_status",
			title: "Pibo Run Status",
			description: "Read compact status for one yielded run.",
			promptSnippet: "Use pibo_run_status to inspect one yielded run without reading its full result.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
		definePiboTool({
			name: "pibo_run_wait",
			title: "Pibo Run Wait",
			description: "Wait a bounded time for a yielded run. Timeout is normal and does not mean failure.",
			promptSnippet: "Use pibo_run_wait when blocked on a run. Timeout is normal; call again or continue other work.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
		definePiboTool({
			name: "pibo_run_read",
			title: "Pibo Run Read",
			description: "Read the terminal result, timeout reason, or error for a yielded run.",
			promptSnippet: "Use pibo_run_read to retrieve a completed, failed, or timed_out run result. Reading terminal tracked runs consumes reminders.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
		definePiboTool({
			name: "pibo_run_cancel",
			title: "Pibo Run Cancel",
			description: "Cancel a yielded run if possible and suppress future reminders.",
			promptSnippet: "Use pibo_run_cancel when a yielded run is no longer needed.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
		definePiboTool({
			name: "pibo_run_ack",
			title: "Pibo Run Ack",
			description: "Acknowledge a yielded run update and suppress reminders for its current state.",
			promptSnippet:
				"Use pibo_run_ack when you intentionally do not need to read a completed result or do not need more reminders for the current running state.",
			executionMode: "parallel",
			inputSchema: Type.Object({
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
