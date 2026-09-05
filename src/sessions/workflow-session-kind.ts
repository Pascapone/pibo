import type { PiboJsonObject } from "../core/events.js";

export const PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY = "workflowSessionKind" as const;
export const PIBO_WORKFLOW_SESSION_KINDS = ["main_workflow", "nested_workflow", "agent_node", "subagent"] as const;

export type PiboWorkflowSessionKind = (typeof PIBO_WORKFLOW_SESSION_KINDS)[number];

export function isPiboWorkflowSessionKind(value: unknown): value is PiboWorkflowSessionKind {
	return typeof value === "string" && (PIBO_WORKFLOW_SESSION_KINDS as readonly string[]).includes(value);
}

export function workflowSessionKindFromMetadata(metadata: PiboJsonObject | undefined): PiboWorkflowSessionKind | undefined {
	const value = metadata?.[PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY];
	if (isPiboWorkflowSessionKind(value)) return value;

	return undefined;
}

export function withWorkflowSessionKind(
	metadata: PiboJsonObject | undefined,
	workflowSessionKind: PiboWorkflowSessionKind,
): PiboJsonObject {
	return {
		...(metadata ?? {}),
		[PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY]: workflowSessionKind,
	};
}
