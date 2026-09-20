import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createHashlineToolDefinition } from "../../tools/hashline.js";
import { invokePiTool, type HeadlessPiTool } from "../pi-tools.js";
import { resolveSandboxPath } from "../sandbox.js";
import type { RemoteModuleTool, RemoteToolContext } from "../tool.js";
import { REMOTE_AGENT_TOOL_NAMES } from "../types.js";

export type RemoteFileDefinitions = {
	read: HeadlessPiTool;
	write: HeadlessPiTool;
	edit: HeadlessPiTool;
	list: HeadlessPiTool;
	find: HeadlessPiTool;
	grep: HeadlessPiTool;
};

export type RemoteFilesModuleOptions = {
	/** Pi tools are created per call so the cwd always matches the request context. */
	definitions?: (cwd: string) => RemoteFileDefinitions;
};

function defaultDefinitions(cwd: string): RemoteFileDefinitions {
	return {
		// Pibo's read variant: same Pi read tool plus LINE#HASH anchors.
		read: createHashlineToolDefinition(cwd) as unknown as HeadlessPiTool,
		write: createWriteToolDefinition(cwd),
		edit: createEditToolDefinition(cwd),
		list: createLsToolDefinition(cwd),
		find: createFindToolDefinition(cwd),
		grep: createGrepToolDefinition(cwd),
	};
}

function confinePathArguments(args: Record<string, unknown>, context: RemoteToolContext): void {
	if (context.mode !== "sandbox") return;
	const candidate = args.path;
	if (typeof candidate !== "string" || !candidate.trim()) return;
	resolveSandboxPath(context.sandboxRoot, candidate);
}

export function buildFilesModuleTools(options: RemoteFilesModuleOptions = {}): RemoteModuleTool[] {
	const create = options.definitions ?? defaultDefinitions;
	// Schemas do not depend on cwd; read them once from a throwaway instance.
	const schemas = create("");
	const passthrough = (tool: {
		name: string;
		title: string;
		description: string;
		key: keyof RemoteFileDefinitions;
		readOnly?: boolean;
	}): RemoteModuleTool => ({
		name: tool.name,
		title: tool.title,
		description: tool.description,
		module: "files",
		inputSchema: schemas[tool.key].parameters,
		...(tool.readOnly ? { readOnly: true } : {}),
		async execute(args, context: RemoteToolContext) {
			confinePathArguments(args, context);
			const definitions = create(context.cwd);
			return await invokePiTool(definitions[tool.key], args, { cwd: context.cwd, signal: context.signal, toolCallId: context.toolCallId });
		},
	});
	return [
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileRead,
			title: "Read file",
			description: "Read a file. Text lines carry LINE#HASH anchors (Pibo hashline format); use offset/limit for large files. Paths are resolved against the room working directory.",
			key: "read",
			readOnly: true,
		}),
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileWrite,
			title: "Write file",
			description: "Create or overwrite a file with the given content.",
			key: "write",
		}),
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileEdit,
			title: "Edit file",
			description: "Make precise file edits with exact text replacement (edits[].oldText must match exactly).",
			key: "edit",
		}),
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileList,
			title: "List directory",
			description: "List directory contents. Defaults to the room working directory.",
			key: "list",
			readOnly: true,
		}),
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileFind,
			title: "Find files",
			description: "Find files by glob pattern (respects .gitignore).",
			key: "find",
			readOnly: true,
		}),
		passthrough({
			name: REMOTE_AGENT_TOOL_NAMES.fileGrep,
			title: "Search file contents",
			description: "Search file contents for patterns (respects .gitignore).",
			key: "grep",
			readOnly: true,
		}),
	];
}
