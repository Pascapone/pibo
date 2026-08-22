import {
	type PiboToolDefinition,
	type PiboToolExecutionContext,
	type PiboToolResult,
} from "../../tools/contract.js";
import type { PiboPortableToolSession } from "../../tools/session-service.js";
import { OmpRpcClient } from "./client.js";
import type {
	OmpRpcHostToolCallRequest,
	OmpRpcHostToolCancelRequest,
	OmpRpcHostToolParameterSchema,
	OmpRpcHostToolResult,
} from "./protocol-types.js";

const DEFAULT_MAX_TOOL_CALL_TIMEOUT_MS = 5 * 60_000;
// Test hook: lets unit tests exercise the abort-on-timeout path quickly.
function maxToolCallTimeoutMs(): number {
	if (typeof process !== "undefined" && process.env?.PIBO_OMP_TOOL_TIMEOUT_MS) {
		const parsed = Number(process.env.PIBO_OMP_TOOL_TIMEOUT_MS);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_MAX_TOOL_CALL_TIMEOUT_MS;
}
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

/** Resolve the input-schema JSON Schema from a Pibo tool definition. */
function toolInputSchema(definition: PiboToolDefinition): OmpRpcHostToolParameterSchema {
	if (isRecord(definition.inputSchema)) {
		return definition.inputSchema as OmpRpcHostToolParameterSchema;
	}
	if (isRecord(definition.parameters)) {
		return definition.parameters as OmpRpcHostToolParameterSchema;
	}
	return { type: "object", properties: {} };
}

/** Flatten a Pibo tool result's content parts into host-tool text content. */
function flattenToolResult(result: PiboToolResult): OmpRpcHostToolResult {
	const parts: string[] = [];
	for (const item of result.content ?? []) {
		if (item.type === "text") {
			parts.push(item.text);
		} else if (item.type === "image") {
			parts.push("[image content]");
		} else if ("text" in item) {
			parts.push(String((item as { text: string }).text ?? ""));
		} else {
			parts.push(JSON.stringify(item));
		}
	}
	const content = parts.join("\n");
	return result.isError ? { content, isError: true } : { content };
}

/**
 * Bridges Pibo's portable tool session over OMP's host-tool RPC protocol.
 *
 * - `install` sends Pibo's tool definitions via `set_host_tools` so OMP mounts
 *   them directly (matching by name).
 * - `handleFrame` processes `host_tool_call` / `host_tool_cancel` frames from
 *   OMP, executes the underlying Pibo tool (same contract the Pi direct
 *   compiler uses), and replies with `host_tool_result`.
 *
 * OMP preserves its native tools and base prompt; Pibo adds only its own
 * portable tools, and only Pibo-hosted tools are governed by Pibo.
 */
export class OmpHostToolBridge {
	private readonly tools = new Map<string, PiboToolDefinition>();
	private readonly activeCalls = new Map<string, AbortController>();
	private dispossed = false;

	constructor(
		private readonly client: OmpRpcClient,
		private readonly portableTools: PiboPortableToolSession | undefined,
		private readonly executionContext: PiboToolExecutionContext,
		private readonly emitWarning: (message: string) => void,
	) {}

	get installedNames(): string[] {
		return [...this.tools.keys()];
	}

	/** Send the current Pibo portable tool definitions to OMP via set_host_tools. */
	async install(): Promise<string[]> {
		if (!this.portableTools || this.dispossed) {
			await this.client.request({ type: "set_host_tools", tools: [] }, "set_host_tools");
			return [];
		}
		const definitions = this.portableTools.createDefinitions();
		this.tools.clear();
		const wire: Array<{
			name: string;
			description: string;
			parameters: OmpRpcHostToolParameterSchema;
		}> = [];
		for (const def of definitions) {
			if (typeof def.name !== "string" || def.name.length === 0 || def.portable === false) continue;
			this.tools.set(def.name, def);
			wire.push({
				name: def.name,
				description: typeof def.description === "string" ? def.description : "",
				parameters: toolInputSchema(def),
			});
		}
		const result = await this.client.request({ type: "set_host_tools", tools: wire }, "set_host_tools");
		const data = result["data" as keyof typeof result];
		const toolNames = isRecord(data) && Array.isArray(data.toolNames)
			? data.toolNames.filter((n): n is string => typeof n === "string")
			: [];
		return toolNames;
	}

	/**
	 * Handle a host tool frame from OMP. Returns true when the frame was a host
	 * tool call/cancel (consumed); false otherwise.
	 */
	handleFrame(frame: unknown): boolean {
		if (!isRecord(frame)) return false;
		if (frame.type === "host_tool_call") {
			void this.handleToolCall(frame as unknown as OmpRpcHostToolCallRequest);
			return true;
		}
		if (frame.type === "host_tool_cancel") {
			void this.handleToolCancel(frame as unknown as OmpRpcHostToolCancelRequest);
			return true;
		}
		return false;
	}

	private async handleToolCall(frame: OmpRpcHostToolCallRequest): Promise<void> {
		const toolName = typeof frame.toolName === "string" ? frame.toolName : "unknown";
		const toolCallId = stringValue(frame.toolCallId);
		const definition = this.tools.get(toolName);
		if (!definition) {
			await this.client
				.sendSideChannel({ type: "host_tool_result", toolCallId, result: { content: `error: unknown host tool "${toolName}"`, isError: true } }, "host_tool_result")
				.catch(() => {});
			return;
		}
		const controller = new AbortController();
		this.activeCalls.set(toolCallId, controller);
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		// Forward incremental Pibo tool progress as host_tool_update when the tool
		// callback provides it.
		const onUpdate = definition.portable === false ? undefined : (update: unknown) => {
			void this.client
				.sendSideChannel({ type: "host_tool_update", toolCallId, partialResult: update }, "host_tool_update")
				.catch(() => {});
		};
		try {
			const prepared = definition.prepareInput ? definition.prepareInput(frame.arguments) : frame.arguments;
			const result = await Promise.race([
				definition.execute(
					toolCallId,
					prepared,
					controller.signal,
					onUpdate,
					this.executionContext,
				),
				new Promise<never>((_, reject) => {
					timeoutHandle = setTimeout(() => {
						// Abort the underlying Pibo tool so timeout doesn't leak a
						// still-running background execution.
						controller.abort();
						reject(new Error(`OMP host tool "${toolName}" timed out.`));
					}, maxToolCallTimeoutMs());
				}),
			]);
			clearTimeout(timeoutHandle);
			const wire = this.sanitize(flattenToolResult(result));
			await this.client.sendSideChannel({ type: "host_tool_result", toolCallId, result: wire }, "host_tool_result");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.emitWarning(`OMP host tool "${toolName}" failed: ${message}`);
			try {
				await this.client.sendSideChannel(
					{ type: "host_tool_result", toolCallId, result: { content: `error: ${message}`, isError: true } },
					"host_tool_result",
				);
			} catch {
				// best-effort; the client may already be closing
			}
		} finally {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			this.activeCalls.delete(toolCallId);
		}
	}

	private async handleToolCancel(frame: OmpRpcHostToolCancelRequest): Promise<void> {
		const toolCallId = stringValue(frame.toolCallId);
		const active = this.activeCalls.get(toolCallId);
		if (active) active.abort();
		this.activeCalls.delete(toolCallId);
	}

	private sanitize(result: OmpRpcHostToolResult): OmpRpcHostToolResult {
		const serialized = JSON.stringify(result.content ?? "");
		if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
			return { content: "[result truncated by Pibo]", isError: result.isError };
		}
		return result;
	}

	/** Cancel all in-flight host tool calls (used on abort/dispose). */
	async cancelAll(): Promise<void> {
		for (const controller of this.activeCalls.values()) controller.abort();
		this.activeCalls.clear();
	}

	dispose(): void {
		if (this.dispossed) return;
		this.dispossed = true;
		for (const controller of this.activeCalls.values()) controller.abort();
		this.activeCalls.clear();
	}
}