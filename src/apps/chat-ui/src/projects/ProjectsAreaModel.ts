import type { WorkflowVersionPickerOption } from "../api-workflows";
import type { BootstrapData, PiboProject, PiboProjectSession, ProjectsBootstrapData } from "../types";
import type { WorkflowUiDiagnostic } from "./ProjectWorkflowPanels";
import { isWorkflowBackedProjectSession } from "./project-session-workflow";

export type ProjectArchiveGroups = {
	active: PiboProject[];
	archived: PiboProject[];
};

export function splitProjectsByArchive(projects: readonly PiboProject[] | undefined): ProjectArchiveGroups {
	const active: PiboProject[] = [];
	const archived: PiboProject[] = [];
	for (const project of projects ?? []) {
		if (project.archivedAt) archived.push(project);
		else active.push(project);
	}
	return { active, archived };
}

export function findSelectedProjectSession(projectSessions: readonly PiboProjectSession[], selectedPiboSessionId: string | null | undefined): PiboProjectSession | undefined {
	return selectedPiboSessionId ? projectSessions.find((projectSession) => projectSession.piboSessionId === selectedPiboSessionId) : undefined;
}

export function listWorkflowProjectSessions(projectSessions: readonly PiboProjectSession[]): PiboProjectSession[] {
	return projectSessions.filter(isWorkflowBackedProjectSession);
}

export function createProjectsTraceBootstrap(baseBootstrap: BootstrapData, data: ProjectsBootstrapData | null): BootstrapData {
	return {
		...baseBootstrap,
		...(data?.session ? { session: data.session } : {}),
		agents: data?.agents ?? baseBootstrap.agents,
		customAgents: data?.customAgents ?? baseBootstrap.customAgents,
		modelDefaults: data?.modelDefaults ?? baseBootstrap.modelDefaults,
		modelCatalog: data?.modelCatalog ?? baseBootstrap.modelCatalog,
		agentCatalog: data?.agentCatalog ?? baseBootstrap.agentCatalog,
		capabilities: data?.capabilities ?? baseBootstrap.capabilities,
		sessions: data?.sessions ?? [],
	};
}

export function findSelectedWorkflowVersionOption(
	options: readonly WorkflowVersionPickerOption[],
	selectedWorkflowId: string | undefined,
	selectedWorkflowVersion: string | undefined,
): WorkflowVersionPickerOption | undefined {
	return options.find((option) => option.id === selectedWorkflowId && option.version === selectedWorkflowVersion) ?? options[0];
}

export function createMissingWorkflowVersionDiagnostics(): WorkflowUiDiagnostic[] {
	return [{
		code: "ProjectWorkflowSessionCreate.missingWorkflowVersion",
		message: "Select a workflow version before creating the Project session.",
		severity: "error",
	}];
}

export function workflowStartAcceptedMessage(workflowRunId: string | undefined): string {
	return workflowRunId
		? "Workflow run started."
		: "Start accepted after validation. No workflow run record exists yet.";
}

export function workflowStartBlockedMessage(diagnostics: readonly WorkflowUiDiagnostic[]): string {
	const codes = diagnostics.map((diagnostic) => diagnostic.code).filter(Boolean).slice(0, 3).join(", ");
	return `Start blocked: ${codes || "validation diagnostics"}`;
}
