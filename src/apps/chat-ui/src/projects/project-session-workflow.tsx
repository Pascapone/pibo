import type { ChatSessionViewId } from "../session-views/types";
import type { PiboProject, PiboProjectSession, PiboSession, PiboWebSessionNode, PiboWebSessionStatus } from "../types";

export const PROJECT_SESSION_VIEW_ALLOWED_IDS: Record<ChatSessionViewId, readonly ChatSessionViewId[]> = {
	terminal: ["terminal"],
	workflow: ["workflow"],
};

const PROJECT_ROUTING_UNKNOWN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export type ProjectSessionViewRouting = {
	viewId: ChatSessionViewId;
	workflowProjectSession?: PiboProjectSession;
};

export type WorkflowHeaderSummary = {
	workflowId: string;
	state: string;
	workflowRunId?: string;
};

export function isWorkflowBackedProjectSession(projectSession: PiboProjectSession): boolean {
	return Boolean(projectSession.workflowRunId) || projectSession.state === "workflow" || projectSession.workflowId !== "simple-chat";
}

export function isConfiguredWorkflowSessionPending(projectSession: PiboProjectSession): boolean {
	return isWorkflowBackedProjectSession(projectSession) && projectSession.state === "configured" && !projectSession.workflowRunId;
}

export function resolveProjectSessionViewRouting(input: {
	selectedSessionNode?: PiboWebSessionNode;
	selectedProjectSession?: PiboProjectSession;
	selectedSession?: PiboSession;
	selectedProject?: PiboProject;
}): ProjectSessionViewRouting {
	const workflowSessionKind = input.selectedSessionNode?.workflowSessionKind ?? workflowSessionKindFromProjectMetadata(input.selectedSession?.metadata);
	if (workflowSessionKind === "main_workflow" || workflowSessionKind === "nested_workflow") {
		if (input.selectedProjectSession && !isWorkflowBackedProjectSession(input.selectedProjectSession)) {
			return { viewId: "terminal" };
		}
		if (!input.selectedProjectSession && workflowSessionKind === "main_workflow" && selectedMetadataWorkflowId(input.selectedSession?.metadata) === "simple-chat") {
			return { viewId: "terminal" };
		}
		const workflowProjectSession = input.selectedProjectSession && isWorkflowBackedProjectSession(input.selectedProjectSession)
			? input.selectedProjectSession
			: createWorkflowViewProjectSession({
				selectedSessionNode: input.selectedSessionNode,
				selectedSession: input.selectedSession,
				selectedProject: input.selectedProject,
				workflowSessionKind,
			});
		return { viewId: "workflow", ...(workflowProjectSession ? { workflowProjectSession } : {}) };
	}
	if (workflowSessionKind === "agent_node" || workflowSessionKind === "subagent") {
		return { viewId: "terminal" };
	}
	if (input.selectedProjectSession && isWorkflowBackedProjectSession(input.selectedProjectSession)) {
		return { viewId: "workflow", workflowProjectSession: input.selectedProjectSession };
	}
	return { viewId: "terminal" };
}

function workflowSessionKindFromProjectMetadata(metadata: PiboSession["metadata"] | undefined): PiboWebSessionNode["workflowSessionKind"] {
	const kind = metadataString(metadata, "workflowSessionKind");
	if (kind === "main_workflow" || kind === "nested_workflow" || kind === "agent_node" || kind === "subagent") return kind;
	if (metadataString(metadata, "projectSessionKind") === "main") return "main_workflow";
	return undefined;
}

function selectedMetadataWorkflowId(metadata: PiboSession["metadata"] | undefined): string | undefined {
	return metadataString(metadata, "projectWorkflowId") ?? metadataString(metadata, "workflowId");
}

function createWorkflowViewProjectSession(input: {
	selectedSessionNode?: PiboWebSessionNode;
	selectedSession?: PiboSession;
	selectedProject?: PiboProject;
	workflowSessionKind: "main_workflow" | "nested_workflow";
}): PiboProjectSession | undefined {
	const piboSessionId = input.selectedSessionNode?.piboSessionId ?? input.selectedSession?.id;
	if (!piboSessionId) return undefined;
	const metadata = input.selectedSession?.metadata;
	const workflowId = selectedMetadataWorkflowId(metadata)
		?? (input.workflowSessionKind === "nested_workflow" ? "nested-workflow-session" : "workflow-session");
	const workflowVersion = metadataString(metadata, "projectWorkflowVersion") ?? metadataString(metadata, "workflowVersion");
	const workflowRunId = metadataString(metadata, "workflowRunId");
	return {
		projectId: input.selectedProject?.id ?? metadataString(metadata, "projectId") ?? "project",
		piboSessionId,
		kind: input.workflowSessionKind === "nested_workflow" ? "sub" : "main",
		workflowId,
		...(workflowVersion ? { workflowVersion } : {}),
		...(workflowRunId ? { workflowRunId } : {}),
		...(input.selectedSessionNode?.parentId ? { parentMainSessionId: input.selectedSessionNode.parentId } : {}),
		...(input.selectedSessionNode?.title || input.selectedSession?.title ? { title: input.selectedSessionNode?.title ?? input.selectedSession?.title } : {}),
		state: workflowStateFromSessionNode(input.selectedSessionNode, workflowRunId),
		...(input.selectedSessionNode?.archived !== undefined ? { archived: input.selectedSessionNode.archived } : {}),
		createdAt: input.selectedSession?.createdAt ?? PROJECT_ROUTING_UNKNOWN_TIMESTAMP,
		updatedAt: input.selectedSession?.updatedAt ?? input.selectedSessionNode?.lastActivityAt ?? PROJECT_ROUTING_UNKNOWN_TIMESTAMP,
	};
}

function workflowStateFromSessionNode(sessionNode: PiboWebSessionNode | undefined, workflowRunId: string | undefined): PiboProjectSession["state"] {
	if (sessionNode?.status === "error") return "failed";
	if (sessionNode?.status === "running") return "running";
	return workflowRunId ? "workflow" : "configured";
}

function metadataString(metadata: PiboSession["metadata"] | undefined, key: string): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function workflowSessionLabel(projectSession: PiboProjectSession): string {
	if (!isWorkflowBackedProjectSession(projectSession)) return `Workflow: ${projectSession.workflowId}`;
	const run = projectSession.workflowRunId ? ` · run ${shortWorkflowId(projectSession.workflowRunId)}` : "";
	return `Workflow: ${projectSession.workflowId}${run} · ${workflowStateLabel(projectSession)}`;
}

export function createWorkflowHeaderSummary(projectSession: PiboProjectSession, selectedSessionStatus: PiboWebSessionStatus | undefined): WorkflowHeaderSummary {
	return {
		workflowId: projectSession.workflowId,
		state: workflowStateLabel(projectSession, selectedSessionStatus),
		...(projectSession.workflowRunId ? { workflowRunId: projectSession.workflowRunId } : {}),
	};
}

export function WorkflowHeaderMeta({ summary }: { summary: WorkflowHeaderSummary }) {
	return (
		<>
			<span className="text-slate-600">·</span>
			<span className="min-w-0 max-w-52 truncate rounded border border-[#11a4d4]/35 bg-[#11a4d4]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#11a4d4]" title={summary.workflowId}>
				workflow {summary.workflowId}
			</span>
			<span className={workflowStateBadgeClassFromLabel(summary.state)}>state {summary.state}</span>
			{summary.workflowRunId ? (
				<span className="min-w-0 max-w-40 truncate rounded border border-slate-700 bg-slate-900/40 px-1.5 py-0.5 text-[10px] text-slate-400" title={summary.workflowRunId}>
					run {shortWorkflowId(summary.workflowRunId)}
				</span>
			) : null}
		</>
	);
}

export function workflowStateLabel(projectSession: PiboProjectSession, selectedSessionStatus?: PiboWebSessionStatus): string {
	if (projectSession.archived) return "archived";
	if (projectSession.state && projectSession.state !== "workflow") return projectSession.state.replace(/_/g, " ");
	if (selectedSessionStatus === "running") return "running";
	if (selectedSessionStatus === "error") return "failed";
	if (projectSession.state) return projectSession.state.replace(/_/g, " ");
	return projectSession.workflowRunId ? "workflow" : projectSession.kind;
}

export function workflowStateBadgeClass(projectSession: PiboProjectSession, selectedSessionStatus?: PiboWebSessionStatus): string {
	return workflowStateBadgeClassFromLabel(workflowStateLabel(projectSession, selectedSessionStatus), projectSession.archived);
}

export function workflowStateBadgeClassFromLabel(stateLabel: string, archived = false): string {
	const state = stateLabel.toLowerCase();
	const base = "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide";
	if (archived) return `${base} border-slate-700 text-slate-500`;
	if (state.includes("failed") || state.includes("error")) return `${base} border-red-500/40 text-red-300 bg-red-500/10`;
	if (state.includes("waiting")) return `${base} border-amber-500/40 text-amber-300 bg-amber-500/10`;
	if (state.includes("complete") || state.includes("done")) return `${base} border-emerald-500/40 text-emerald-300 bg-emerald-500/10`;
	return `${base} border-[#11a4d4]/40 text-[#11a4d4] bg-[#11a4d4]/10`;
}

export function shortWorkflowId(value: string): string {
	return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}
