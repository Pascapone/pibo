import {
	defineTool,
	type AgentToolResult,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
	PiboToolDefinition,
	PiboToolDefinitionContext,
	PiboToolResult,
} from "../../tools/contract.js";

export type CompilePiboToolForPiOptions = PiboToolDefinitionContext & {
	runtimeInstanceId?: string;
	sessionGeneration?: string;
};

function resultDetails(result: PiboToolResult): unknown {
	const hasPortableMetadata = result.structuredContent !== undefined
		|| (result.payloadRefs?.length ?? 0) > 0
		|| result.metadata !== undefined;
	if (!hasPortableMetadata) return result.details;

	const base = result.details && typeof result.details === "object" && !Array.isArray(result.details)
		? { ...(result.details as Record<string, unknown>) }
		: result.details === undefined
			? {}
			: { value: result.details };
	return {
		...base,
		_pibo: {
			...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
			...(result.payloadRefs?.length ? { payloadRefs: [...result.payloadRefs] } : {}),
			...(result.metadata ? { metadata: { ...result.metadata } } : {}),
		},
	};
}

export function piboToolResultToPi(result: PiboToolResult): AgentToolResult<unknown> {
	const content: AgentToolResult<unknown>["content"] = [];
	for (const item of result.content) {
		if (item.type === "text") {
			content.push({ type: "text", text: item.text });
		} else if (item.data !== undefined) {
			content.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else {
			content.push({
				type: "text",
				text: item.payloadRef
					? `Image payload stored as ${item.payloadRef}`
					: item.alt ?? "Image result omitted.",
			});
		}
	}
	return {
		content,
		details: resultDetails(result),
		...(result.isError !== undefined ? { isError: result.isError } : {}),
	};
}

/** Compile a Pibo-managed JSON-Schema tool into Pi's direct in-process tool contract. */
export function compilePiboToolForPi(
	definition: PiboToolDefinition,
	options: CompilePiboToolForPiOptions = {},
): ToolDefinition {
	return defineTool({
		name: definition.name,
		label: definition.title,
		description: definition.description,
		...(definition.promptSnippet ? { promptSnippet: definition.promptSnippet } : {}),
		...(definition.promptGuidelines ? { promptGuidelines: [...definition.promptGuidelines] } : {}),
		parameters: definition.inputSchema,
		...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
		...(definition.prepareInput ? { prepareArguments: definition.prepareInput } : {}),
		async execute(toolCallId, input, signal, onUpdate, nativeContext) {
			const result = await definition.execute(
				toolCallId,
				input,
				signal,
				onUpdate
					? (update) => onUpdate(piboToolResultToPi(update))
					: undefined,
				{
					...options,
					cwd: options.cwd ?? process.cwd(),
					adapterId: "pi",
					nativeContext,
				},
			);
			return piboToolResultToPi(result);
		},
	});
}
