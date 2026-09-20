import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { invokePiTool, type HeadlessPiTool } from "../pi-tools.js";
import type { RemoteModuleTool, RemoteToolContext } from "../tool.js";
import { REMOTE_AGENT_TOOL_NAMES } from "../types.js";

export type RemoteBashModuleOptions = {
	definition?: (cwd: string) => HeadlessPiTool;
};

function defaultDefinition(cwd: string): HeadlessPiTool {
	// No Pi session exists here, so session env exposure is disabled; commands
	// still run with cwd set to the room working directory.
	return createBashToolDefinition(cwd, { exposeSessionEnvironment: false });
}

export function buildBashModuleTools(options: RemoteBashModuleOptions = {}): RemoteModuleTool[] {
	const create = options.definition ?? defaultDefinition;
	const schema = create("").parameters;
	const runTool: RemoteModuleTool = {
		name: REMOTE_AGENT_TOOL_NAMES.bashRun,
		title: "Run shell command",
		description: "Execute a bash command with cwd set to the room working directory. In sandbox mode the room owner must still trust this connection: prefer read-only commands for untrusted agents.",
		module: "bash",
		inputSchema: schema,
		async execute(args, context: RemoteToolContext) {
			const definition = create(context.cwd);
			return await invokePiTool(definition, args, { cwd: context.cwd, signal: context.signal, toolCallId: context.toolCallId });
		},
	};
	return [runTool];
}
