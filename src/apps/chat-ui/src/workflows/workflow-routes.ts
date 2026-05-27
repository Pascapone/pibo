export const STARTER_DRAFT_ID = "v2-starter-draft";

export type WorkflowVersionSelection = { workflowId: string; workflowVersion: string };

export function workflowVersionSelectionKey(workflowId: string, workflowVersion: string): string {
	return `${workflowId}@${workflowVersion}`;
}

export function parseWorkflowVersionKey(value: string): WorkflowVersionSelection | undefined {
	const atIndex = value.lastIndexOf("@");
	if (atIndex <= 0 || atIndex === value.length - 1) return undefined;
	return { workflowId: value.slice(0, atIndex), workflowVersion: value.slice(atIndex + 1) };
}

export function workflowVersionViewerPath(workflowId: string, workflowVersion: string): string {
	return `/apps/chat/workflows/view/${encodeURIComponent(workflowId)}/${encodeURIComponent(workflowVersion)}`;
}

export function workflowBuilderDraftPath(draftId: string): string {
	return `/apps/chat/workflows/drafts/${encodeURIComponent(draftId)}`;
}

export function openBuilderPath(path: string): void {
	if (typeof window === "undefined") return;
	window.location.assign(path);
}
