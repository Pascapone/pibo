import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { RemoteAgentError } from "./types.js";
import type { RemoteToolResult } from "./tool.js";

export type HeadlessPiTool = Pick<ToolDefinition, "name" | "description" | "parameters" | "execute">;

export type InvokePiToolOptions = {
	cwd: string;
	signal?: AbortSignal;
	toolCallId?: string;
};

/**
 * Invoke a Pi coding-agent tool outside a Pi session. File/shell tools only
 * read `ctx.cwd` (bash additionally reads model metadata when session env
 * exposure is enabled, which we always disable here), so a minimal stub is safe.
 */
export async function invokePiTool(
	definition: HeadlessPiTool,
	params: unknown,
	options: InvokePiToolOptions,
): Promise<RemoteToolResult> {
	if (!Value.Check(definition.parameters, params)) {
		const errors = [...Value.Errors(definition.parameters, params)].slice(0, 5).map((error) => {
			const location = (error as { path?: string }).path ?? "/";
			return `${location || "/"}: ${error.message}`;
		});
		throw new RemoteAgentError("args_invalid", `Invalid arguments for ${definition.name}: ${errors.join("; ")}`);
	}
	const toolCallId = options.toolCallId ?? `remote_${randomUUID()}`;
	const stubContext = { cwd: options.cwd } as unknown as Parameters<ToolDefinition["execute"]>[4];
	let result: AgentToolResult<unknown>;
	try {
		result = await definition.execute(
			toolCallId,
			params as never,
			options.signal,
			undefined,
			stubContext,
		);
	} catch (error) {
		throw new RemoteAgentError("tool_failed", error instanceof Error ? error.message : String(error));
	}
	return piResultToRemote(result);
}

export function piResultToRemote(result: AgentToolResult<unknown>): RemoteToolResult {
	const parts: string[] = [];
	for (const item of result.content ?? []) {
		if (item.type === "text") parts.push(item.text);
		else if (item.type === "image") parts.push(`[image omitted: ${item.mimeType}]`);
		else parts.push("[unsupported content omitted]");
	}
	// Pi tools signal failure by throwing (handled in invokePiTool); a returned
	// result is always a success.
	const text = parts.join("\n").trim() || "Tool completed.";
	return {
		text,
		...(result.details !== undefined ? { details: result.details } : {}),
	};
}
