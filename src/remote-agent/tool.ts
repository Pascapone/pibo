import type { TSchema } from "typebox";
import type { RemoteAgentMode, RemoteAgentModuleName } from "./types.js";

/** Execution context for one remote tool call. Resolved per request from token + room config. */
export type RemoteToolContext = {
	roomId: string;
	tokenId: string;
	label: string;
	mode: RemoteAgentMode;
	/** Absolute sandbox root. Only enforced when mode is "sandbox". */
	sandboxRoot: string;
	/** Working directory for file/bash tools. */
	cwd: string;
	toolCallId: string;
	signal?: AbortSignal;
};

export type RemoteToolResult = {
	text: string;
	isError?: boolean;
	details?: unknown;
};

export type RemoteModuleTool = {
	name: string;
	title: string;
	description: string;
	module: RemoteAgentModuleName;
	/** TypeBox schema: doubles as the MCP inputSchema and the validation schema. */
	inputSchema: TSchema;
	readOnly?: boolean;
	execute(args: Record<string, unknown>, context: RemoteToolContext): Promise<RemoteToolResult>;
};
