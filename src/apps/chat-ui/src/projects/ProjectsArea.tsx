import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteProject, getProjectsBootstrap, patchProject, patchProjectSession, patchSession, postAction, postProject, postProjectMessage, postProjectSession } from "../api-chat-sessions";
import { getWorkflowVersionPicker, postProjectWorkflowSession, postProjectWorkflowSessionStart, type WorkflowVersionPickerOption } from "../api-workflows";
import type { BootstrapData, PiboProject, PiboProjectSession, ProjectsBootstrapData, ThinkingLevel } from "../types";
import { readStoredComposerDraft } from "../app-storage";
import { createClientTxnId, defaultProfileFromBootstrap, findSessionNode, findSessionPath, resolveSessionActiveModelLabel } from "../app-session-model";
import { splitSessionNodesByArchive } from "../session-sidebar-helpers";
import { getChatSessionView, listChatSessionViews } from "../session-views/registry";
import type { ChatSessionViewId } from "../session-views/types";
import { SessionTracePane } from "../session-trace-pane";
import type { SlashCommand } from "../chat-commands";
import { errorMessage } from "../error-message";
import { ProjectsSidebar } from "./ProjectsSidebar";
import {
	ConfiguredWorkflowStartPanel,
	ProjectWorkflowSessionCreatePanel,
	workflowDiagnosticsFromError,
	workflowVersionOptionKey,
	type WorkflowUiDiagnostic,
} from "./ProjectWorkflowPanels";
import {
	createMissingWorkflowVersionDiagnostics,
	createProjectsTraceBootstrap,
	findSelectedProjectSession,
	findSelectedWorkflowVersionOption,
	listWorkflowProjectSessions,
	splitProjectsByArchive,
	workflowStartAcceptedMessage,
	workflowStartBlockedMessage,
} from "./ProjectsAreaModel";
import {
	PROJECT_SESSION_VIEW_ALLOWED_IDS,
	isConfiguredWorkflowSessionPending,
	resolveProjectSessionViewRouting,
} from "./project-session-workflow";

type NavigationOptions = {
	closeMobileSidebar?: boolean;
};

const EMPTY_SESSION_PATH_IDS = new Set<string>();

export function ProjectsArea({
	baseBootstrap,
	routeProjectId,
	routePiboSessionId,
	sessionViews,
	showRawEvents,
	showThinking,
	expandThinking,
	commands,
	skills,
	onNavigate,
	onViewContext,
	onSelectSessionView,
	onToggleRawEvents,
	onToggleThinking,
	onToggleExpandThinking,
	onThinkingLevelChange,
	mobileSidebarOpen,
	onCloseMobileSidebar,
	onError,
}: {
	baseBootstrap: BootstrapData;
	routeProjectId?: string;
	routePiboSessionId?: string;
	sessionViews: ReturnType<typeof listChatSessionViews>;
	showRawEvents: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	commands: SlashCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	onNavigate: (projectId: string | undefined, piboSessionId: string | undefined, replace?: boolean, options?: NavigationOptions) => void;
	onViewContext: (piboSessionId: string) => void;
	onSelectSessionView: (viewId: ChatSessionViewId) => void;
	onToggleRawEvents: () => void;
	onToggleThinking: () => void;
	onToggleExpandThinking: () => void;
	onThinkingLevelChange: (level: ThinkingLevel) => void;
	mobileSidebarOpen: boolean;
	onCloseMobileSidebar: () => void;
	onError: (message: string | null) => void;
}) {
	const [data, setData] = useState<ProjectsBootstrapData | null>(null);
	const [loading, setLoading] = useState(true);
	const [showArchivedProjects, setShowArchivedProjects] = useState(() => localStorage.getItem("pibo.chat.projects.showArchivedProjects") === "true");
	const [showArchivedSessions, setShowArchivedSessions] = useState(() => localStorage.getItem("pibo.chat.projects.showArchivedSessions") === "true");
	const [creatingSession, setCreatingSession] = useState(false);
	const [creatingWorkflowSession, setCreatingWorkflowSession] = useState(false);
	const [workflowPickerState, setWorkflowPickerState] = useState<"loading" | "loaded" | "error">("loading");
	const [workflowPickerError, setWorkflowPickerError] = useState<string | null>(null);
	const [workflowVersionOptions, setWorkflowVersionOptions] = useState<WorkflowVersionPickerOption[]>([]);
	const [selectedWorkflowVersionKey, setSelectedWorkflowVersionKey] = useState("");
	const [workflowSessionTitle, setWorkflowSessionTitle] = useState("");
	const [startingWorkflowSessionId, setStartingWorkflowSessionId] = useState<string | null>(null);
	const [workflowStartMessages, setWorkflowStartMessages] = useState<Record<string, string>>({});
	const [workflowCreateDiagnostics, setWorkflowCreateDiagnostics] = useState<WorkflowUiDiagnostic[]>([]);
	const [autoRenameSessionId, setAutoRenameSessionId] = useState<string | null>(null);
	const [composerText, setComposerText] = useState(() => routePiboSessionId ? readStoredComposerDraft(routePiboSessionId) : "");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);

	const load = useCallback(async (input: { projectId?: string; piboSessionId?: string } = {}) => {
		setLoading(true);
		try {
			const next = await getProjectsBootstrap({
				projectId: input.projectId ?? routeProjectId,
				piboSessionId: input.piboSessionId ?? routePiboSessionId,
				includeArchived: showArchivedProjects || showArchivedSessions,
			});
			setData(next);
			if (!routeProjectId || next.selectedProjectId !== routeProjectId || (next.selectedPiboSessionId && next.selectedPiboSessionId !== routePiboSessionId)) {
				onNavigate(next.selectedProjectId, next.selectedPiboSessionId, true, { closeMobileSidebar: false });
			}
			onError(null);
			return next;
		} catch (caught) {
			onError(errorMessage(caught));
			throw caught;
		} finally {
			setLoading(false);
		}
	}, [onError, onNavigate, routePiboSessionId, routeProjectId, showArchivedProjects, showArchivedSessions]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		let cancelled = false;
		setWorkflowPickerState("loading");
		setWorkflowPickerError(null);
		getWorkflowVersionPicker()
			.then((picker) => {
				if (cancelled) return;
				setWorkflowVersionOptions(picker.options);
				const selected = findSelectedWorkflowVersionOption(picker.options, picker.selectedWorkflowId, picker.selectedWorkflowVersion);
				setSelectedWorkflowVersionKey((current) => current || (selected ? workflowVersionOptionKey(selected) : ""));
				setWorkflowPickerState("loaded");
			})
			.catch((caught: unknown) => {
				if (cancelled) return;
				setWorkflowPickerError(errorMessage(caught));
				setWorkflowPickerState("error");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setComposerText(routePiboSessionId ? readStoredComposerDraft(routePiboSessionId) : "");
	}, [routePiboSessionId]);

	const selectedProject = data?.project;
	const selectedPiboSessionId = data?.selectedPiboSessionId ?? null;
	const selectedSessionNode = selectedPiboSessionId && data ? findSessionNode(data.sessions, selectedPiboSessionId) : undefined;
	const selectedSessionProfile = selectedSessionNode?.profile ?? defaultProfileFromBootstrap(baseBootstrap);
	const projectSessions = data?.projectSessions ?? [];
	const selectedProjectSession = findSelectedProjectSession(projectSessions, selectedPiboSessionId);
	const workflowProjectSessions = listWorkflowProjectSessions(projectSessions);
	const projectGroups = splitProjectsByArchive(data?.projects);
	const activeProjects = projectGroups.active;
	const archivedProjects = projectGroups.archived;
	const sessionGroups = useMemo(() => data ? splitSessionNodesByArchive(data.sessions, showArchivedSessions) : { active: [], archived: [] }, [data, showArchivedSessions]);
	const selectedSessionPathIds = useMemo(() => selectedPiboSessionId && data ? new Set(findSessionPath(data.sessions, selectedPiboSessionId).map((node) => node.piboSessionId)) : EMPTY_SESSION_PATH_IDS, [data, selectedPiboSessionId]);
	const traceBootstrap = useMemo(() => createProjectsTraceBootstrap(baseBootstrap, data), [baseBootstrap, data]);
	const projectSessionViewRouting = useMemo(() => resolveProjectSessionViewRouting({
		selectedSessionNode,
		selectedProjectSession,
		selectedSession: data?.session,
		selectedProject,
	}), [data?.session, selectedProject, selectedProjectSession, selectedSessionNode]);
	const projectCurrentSessionView = useMemo(() => getChatSessionView(projectSessionViewRouting.viewId), [projectSessionViewRouting.viewId]);

	const createProject = async () => {
		const name = window.prompt("Project name");
		if (!name) return;
		const projectFolder = window.prompt("Project folder path (absolute path, e.g. ~/code/my-project or /home/me/code/my-project)");
		if (!projectFolder) return;
		const description = window.prompt("Description (optional)") ?? undefined;
		try {
			const { project } = await postProject({ name, projectFolder, createFolder: true, ...(description ? { description } : {}) });
			await load({ projectId: project.id });
			onNavigate(project.id, undefined);
		} catch (caught) {
			onError(errorMessage(caught));
		}
	};

	const createProjectSession = async () => {
		if (!selectedProject) return;
		setCreatingSession(true);
		try {
			const created = await postProjectSession(selectedProject.id, { profile: selectedSessionProfile, workflowId: "simple-chat" });
			setAutoRenameSessionId(created.session.id);
			onNavigate(selectedProject.id, created.session.id, false, { closeMobileSidebar: false });
			await load({ projectId: selectedProject.id, piboSessionId: created.session.id });
		} catch (caught) {
			onError(errorMessage(caught));
		} finally {
			setCreatingSession(false);
		}
	};

	const createWorkflowProjectSession = async () => {
		if (!selectedProject) return;
		const selectedWorkflow = workflowVersionOptions.find((option) => workflowVersionOptionKey(option) === selectedWorkflowVersionKey);
		if (!selectedWorkflow) {
			const diagnostics = createMissingWorkflowVersionDiagnostics();
			setWorkflowCreateDiagnostics(diagnostics);
			onError(diagnostics[0]?.message ?? "Select a workflow version before creating the Project session.");
			return;
		}
		setCreatingWorkflowSession(true);
		setWorkflowCreateDiagnostics([]);
		try {
			const title = workflowSessionTitle.trim();
			const created = await postProjectWorkflowSession(selectedProject.id, {
				profile: selectedSessionProfile,
				workflowId: selectedWorkflow.id,
				workflowVersion: selectedWorkflow.version,
				...(title ? { title } : {}),
			});
			setWorkflowSessionTitle("");
			setWorkflowCreateDiagnostics([]);
			onNavigate(selectedProject.id, created.session.id, false, { closeMobileSidebar: false });
			await load({ projectId: selectedProject.id, piboSessionId: created.session.id });
		} catch (caught) {
			setWorkflowCreateDiagnostics(workflowDiagnosticsFromError(caught));
			onError(errorMessage(caught));
		} finally {
			setCreatingWorkflowSession(false);
		}
	};

	const startWorkflowProjectSession = async (projectSession: PiboProjectSession) => {
		if (!selectedProject) return;
		setStartingWorkflowSessionId(projectSession.piboSessionId);
		try {
			const response = await postProjectWorkflowSessionStart(selectedProject.id, projectSession.piboSessionId);
			const message = workflowStartAcceptedMessage(response.projectSession.workflowRunId);
			setWorkflowStartMessages((current) => ({ ...current, [projectSession.piboSessionId]: message }));
			onError(null);
			await load({ projectId: selectedProject.id, piboSessionId: projectSession.piboSessionId });
		} catch (caught) {
			const diagnostics = workflowDiagnosticsFromError(caught);
			if (diagnostics.length) {
				setWorkflowStartMessages((current) => ({
					...current,
					[projectSession.piboSessionId]: workflowStartBlockedMessage(diagnostics),
				}));
			}
			onError(errorMessage(caught));
			await load({ projectId: selectedProject.id, piboSessionId: projectSession.piboSessionId });
		} finally {
			setStartingWorkflowSessionId(null);
		}
	};

	const renameSession = async (piboSessionId: string, title: string | null) => {
		try {
			await patchProjectSession(piboSessionId, { title });
			await load({ projectId: selectedProject?.id, piboSessionId });
		} catch (caught) {
			onError(errorMessage(caught));
		}
	};

	const renameProject = async (project: PiboProject, name: string) => {
		try {
			await patchProject(project.id, { name });
			await load({ projectId: selectedProject?.id, piboSessionId: selectedPiboSessionId ?? undefined });
		} catch (caught) {
			onError(errorMessage(caught));
		}
	};

	const setProjectArchived = async (project: PiboProject, archived: boolean) => {
		try {
			await patchProject(project.id, { archived });
			const next = await load({ projectId: archived ? undefined : project.id });
			if (archived && selectedProject?.id === project.id) onNavigate(next.selectedProjectId, next.selectedPiboSessionId);
		} catch (caught) {
			onError(errorMessage(caught));
		}
	};

	const deleteArchivedProject = async (project: PiboProject) => {
		const confirmName = window.prompt(`Type the project name to permanently delete "${project.name}".`);
		if (confirmName === null) return;
		const deleteFiles = window.confirm(`Also delete the real project folder?\n\n${project.projectFolder}`);
		try {
			await deleteProject(project.id, { confirmName, deleteFiles });
			const next = await load({ projectId: selectedProject?.id === project.id ? undefined : selectedProject?.id });
			if (selectedProject?.id === project.id) onNavigate(next.selectedProjectId, next.selectedPiboSessionId);
		} catch (caught) {
			onError(errorMessage(caught));
		}
	};

	const runCommand = async (text: string) => {
		if (!selectedPiboSessionId) return false;
		const commandText = text.trim().split(/\s+/)[0];
		const command = commands.find((candidate) => candidate.slash === commandText);
		if (!command) return false;
		await postAction(selectedPiboSessionId, command.action);
		await load({ projectId: selectedProject?.id, piboSessionId: selectedPiboSessionId });
		return true;
	};

	const workflowStartPanel = selectedProject && selectedProjectSession && isConfiguredWorkflowSessionPending(selectedProjectSession) ? (
		<ConfiguredWorkflowStartPanel
			projectSession={selectedProjectSession}
			lifecycleEvents={data?.workflowLifecycleEvents ?? []}
			starting={startingWorkflowSessionId === selectedProjectSession.piboSessionId}
			message={workflowStartMessages[selectedProjectSession.piboSessionId] ?? null}
			onStart={() => void startWorkflowProjectSession(selectedProjectSession)}
		/>
	) : null;

	if (loading && !data) {
		return <main className="min-h-0 grid place-items-center text-slate-400">Loading Projects...</main>;
	}

	return (
		<>
			<div
				className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
					mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
				}`}
				onClick={onCloseMobileSidebar}
			/>
			<ProjectsSidebar
				data={data!}
				selectedProject={selectedProject}
				selectedPiboSessionId={selectedPiboSessionId}
				selectedProjectSession={selectedProjectSession}
				workflowProjectSessions={workflowProjectSessions}
				activeProjects={activeProjects}
				archivedProjects={archivedProjects}
				sessionGroups={sessionGroups}
				selectedSessionPathIds={selectedSessionPathIds}
				autoRenameSessionId={autoRenameSessionId}
				creatingSession={creatingSession}
				showArchivedProjects={showArchivedProjects}
				showArchivedSessions={showArchivedSessions}
				mobileSidebarOpen={mobileSidebarOpen}
				onRefresh={() => void load()}
				onCloseMobileSidebar={onCloseMobileSidebar}
				onCreateProject={() => void createProject()}
				onToggleArchivedProjects={() => {
					const next = !showArchivedProjects;
					setShowArchivedProjects(next);
					localStorage.setItem("pibo.chat.projects.showArchivedProjects", String(next));
				}}
				onSelectProject={(projectId) => onNavigate(projectId, undefined)}
				onRenameProject={(project, name) => void renameProject(project, name)}
				onSetProjectArchived={(project, archived) => void setProjectArchived(project, archived)}
				onDeleteArchivedProject={(project) => void deleteArchivedProject(project)}
				onCreateProjectSession={() => void createProjectSession()}
				onToggleArchivedSessions={() => {
					const next = !showArchivedSessions;
					setShowArchivedSessions(next);
					localStorage.setItem("pibo.chat.projects.showArchivedSessions", String(next));
				}}
				onSelectSession={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)}
				onRenameSession={(piboSessionId, title) => void renameSession(piboSessionId, title)}
				onArchiveSession={(piboSessionId, archived) => void patchProjectSession(piboSessionId, { archived }).then(() => load({ projectId: selectedProject?.id }))}
				onDeleteSession={(node) => void patchProjectSession(node.piboSessionId, { archived: true }).then(() => load({ projectId: selectedProject?.id }))}
				onViewContext={onViewContext}
				onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
			/>
			<SessionTracePane
				bootstrap={traceBootstrap}
				selectedPiboSessionId={selectedPiboSessionId}
				selectedRoomId={null}
				selectedRoomArchived={Boolean(selectedProject?.archivedAt)}
				workflowProjectSession={projectSessionViewRouting.workflowProjectSession}
				workflowLifecycleEvents={data?.workflowLifecycleEvents ?? []}
				projectSessionCreatePanel={selectedProject ? (
					<ProjectWorkflowSessionCreatePanel
						project={selectedProject}
						options={workflowVersionOptions}
						selectedOptionKey={selectedWorkflowVersionKey}
						titleValue={workflowSessionTitle}
						loadState={workflowPickerState}
						errorMessage={workflowPickerError}
						creating={creatingWorkflowSession}
						diagnostics={workflowCreateDiagnostics}
						onSelectedOptionChange={(value) => {
							setSelectedWorkflowVersionKey(value);
							setWorkflowCreateDiagnostics([]);
						}}
						onTitleChange={setWorkflowSessionTitle}
						onCreate={() => void createWorkflowProjectSession()}
					/>
				) : null}
				workflowStartPanel={workflowStartPanel}
				selectedSessionProfile={selectedSessionProfile}
				selectedSessionActiveModel={resolveSessionActiveModelLabel(traceBootstrap, selectedSessionNode ?? { profile: selectedSessionProfile })}
				selectedSessionStatus={selectedSessionNode?.status}
				sessionViewId={projectSessionViewRouting.viewId}
				sessionViews={sessionViews}
				currentSessionView={projectCurrentSessionView}
				allowedSessionViewIds={PROJECT_SESSION_VIEW_ALLOWED_IDS[projectSessionViewRouting.viewId]}
				creatingSession={creatingSession || creatingWorkflowSession}
				showRawEvents={showRawEvents}
				showThinking={showThinking}
				expandThinking={expandThinking}
				commands={commands}
				skills={skills}
				composerText={composerText}
				composerFocusSignal={composerFocusSignal}
				onComposerTextChange={(next) => setComposerText((current) => typeof next === "function" ? next(current) : next)}
				onToggleRawEvents={onToggleRawEvents}
				onToggleThinking={onToggleThinking}
				onToggleExpandThinking={onToggleExpandThinking}
				onSessionAgentProfileChange={async (profile) => { if (selectedPiboSessionId) await patchSession(selectedPiboSessionId, { profile }); }}
				onFork={() => undefined}
				onOpenSession={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)}
				onSelectSessionView={onSelectSessionView}
				onCommand={runCommand}
				onThinkingLevelChange={onThinkingLevelChange}
				onRefreshTrace={async () => undefined}
				onRefreshBootstrap={async () => { await load({ projectId: selectedProject?.id, piboSessionId: selectedPiboSessionId ?? undefined }); }}
				onSend={async (text) => {
					if (!selectedPiboSessionId) return;
					await postProjectMessage(selectedPiboSessionId, text, createClientTxnId());
					await load({ projectId: selectedProject?.id, piboSessionId: selectedPiboSessionId });
				}}
				onError={onError}
			/>
		</>
	);
}
