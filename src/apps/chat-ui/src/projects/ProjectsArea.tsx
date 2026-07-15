import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteProject,
  getProjectsBootstrap,
  patchProject,
  patchProjectSession,
  patchSession,
  postAction,
  postProject,
  postProjectMessage,
  postProjectSession,
} from "../api-chat-sessions";
import type {
  BootstrapData,
  PiboProject,
  ProjectsBootstrapData,
  ThinkingLevel,
} from "../types";
import { readStoredComposerDraft } from "../app-storage";
import {
  defaultProfileFromBootstrap,
  findSessionNode,
  findSessionPath,
  resolveSessionActiveModelLabel,
} from "../app-session-model";
import { splitSessionNodesByArchive } from "../session-sidebar-helpers";
import {
  getChatSessionView,
  listChatSessionViews,
} from "../session-views/registry";
import type { ChatSessionViewId } from "../session-views/types";
import { SessionTracePane } from "../session-trace-pane";
import type { SlashCommand } from "../chat-commands";
import { errorMessage } from "../error-message";
import { ProjectsSidebar } from "./ProjectsSidebar";
import { CreateProjectDialog } from "./CreateProjectDialog";
import {
  createProjectsTraceBootstrap,
  splitProjectsByArchive,
} from "./ProjectsAreaModel";
import { projectModules } from "./project-modules";

type NavigationOptions = {
  closeMobileSidebar?: boolean;
};

const EMPTY_SESSION_PATH_IDS = new Set<string>();
type ProjectViewTabId = "info";

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
  onNavigate: (
    projectId: string | undefined,
    piboSessionId: string | undefined,
    replace?: boolean,
    options?: NavigationOptions,
  ) => void;
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
  const [showArchivedProjects, setShowArchivedProjects] = useState(
    () =>
      localStorage.getItem("pibo.chat.projects.showArchivedProjects") ===
      "true",
  );
  const [showArchivedSessions, setShowArchivedSessions] = useState(
    () =>
      localStorage.getItem("pibo.chat.projects.showArchivedSessions") ===
      "true",
  );
  const [creatingSession, setCreatingSession] = useState(false);
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [activeProjectViewTab, setActiveProjectViewTab] =
    useState<ProjectViewTabId | null>(null);
  const [autoRenameSessionId, setAutoRenameSessionId] = useState<string | null>(
    null,
  );
  const [composerText, setComposerText] = useState(() =>
    routePiboSessionId ? readStoredComposerDraft(routePiboSessionId) : "",
  );
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);

  const load = useCallback(
    async (input: { projectId?: string; piboSessionId?: string } = {}) => {
      setLoading(true);
      try {
        const next = await getProjectsBootstrap({
          projectId: input.projectId ?? routeProjectId,
          piboSessionId: input.piboSessionId ?? routePiboSessionId,
          includeArchived: showArchivedProjects || showArchivedSessions,
        });
        setData(next);
        if (
          !routeProjectId ||
          next.selectedProjectId !== routeProjectId ||
          (next.selectedPiboSessionId &&
            next.selectedPiboSessionId !== routePiboSessionId)
        ) {
          onNavigate(next.selectedProjectId, next.selectedPiboSessionId, true, {
            closeMobileSidebar: false,
          });
        }
        onError(null);
        return next;
      } catch (caught) {
        onError(errorMessage(caught));
        throw caught;
      } finally {
        setLoading(false);
      }
    },
    [
      onError,
      onNavigate,
      routePiboSessionId,
      routeProjectId,
      showArchivedProjects,
      showArchivedSessions,
    ],
  );

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    setComposerText(
      routePiboSessionId ? readStoredComposerDraft(routePiboSessionId) : "",
    );
  }, [routePiboSessionId]);

  const selectedProject = data?.project;
  const selectedPiboSessionId = data?.selectedPiboSessionId ?? null;
  const selectedSessionNode =
    selectedPiboSessionId && data
      ? findSessionNode(data.sessions, selectedPiboSessionId)
      : undefined;
  const selectedSessionProfile =
    selectedSessionNode?.profile ?? defaultProfileFromBootstrap(baseBootstrap);
  const projectSessions = data?.projectSessions ?? [];
  const projectGroups = splitProjectsByArchive(data?.projects);
  const activeProjects = projectGroups.active;
  const archivedProjects = projectGroups.archived;
  const sessionGroups = useMemo(
    () =>
      data
        ? splitSessionNodesByArchive(data.sessions, showArchivedSessions)
        : { active: [], archived: [] },
    [data, showArchivedSessions],
  );
  const selectedSessionPathIds = useMemo(
    () =>
      selectedPiboSessionId && data
        ? new Set(
            findSessionPath(data.sessions, selectedPiboSessionId).map(
              (node) => node.piboSessionId,
            ),
          )
        : EMPTY_SESSION_PATH_IDS,
    [data, selectedPiboSessionId],
  );
  const traceBootstrap = useMemo(
    () => createProjectsTraceBootstrap(baseBootstrap, data),
    [baseBootstrap, data],
  );
  const projectCurrentSessionView = useMemo(
    () => getChatSessionView("terminal"),
    [],
  );
  const projectInfoPanel =
    activeProjectViewTab === "info" && selectedProject ? (
      <ProjectInfoPanel
        project={selectedProject}
        sessionCount={projectSessions.length}
      />
    ) : null;
  const projectExtraViewTabs = useMemo(
    () => [
      {
        id: "project-info",
        label: "Info",
        description: "Project workspace and project-scoped module overview.",
        active: activeProjectViewTab === "info",
        onSelect: () => setActiveProjectViewTab("info"),
      },
    ],
    [activeProjectViewTab],
  );
  const selectProjectSessionView = (viewId: ChatSessionViewId) => {
    setActiveProjectViewTab(null);
    onSelectSessionView(viewId);
  };

  const createProject = async (input: {
    name: string;
    projectFolder: string;
    description?: string;
  }) => {
    const { project } = await postProject({ ...input, createFolder: true });
    return project.id;
  };

  const openCreatedProject = async (projectId: string) => {
    await load({ projectId });
    onNavigate(projectId, undefined);
  };

  const createProjectSession = async () => {
    if (!selectedProject) return;
    setCreatingSession(true);
    try {
      const created = await postProjectSession(selectedProject.id, {
        profile: selectedSessionProfile,
        workflowId: "simple-chat",
      });
      setAutoRenameSessionId(created.session.id);
      onNavigate(selectedProject.id, created.session.id, false, {
        closeMobileSidebar: false,
      });
      await load({
        projectId: selectedProject.id,
        piboSessionId: created.session.id,
      });
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setCreatingSession(false);
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
      await load({
        projectId: selectedProject?.id,
        piboSessionId: selectedPiboSessionId ?? undefined,
      });
    } catch (caught) {
      onError(errorMessage(caught));
    }
  };

  const setProjectArchived = async (
    project: PiboProject,
    archived: boolean,
  ) => {
    try {
      await patchProject(project.id, { archived });
      const next = await load({ projectId: archived ? undefined : project.id });
      if (archived && selectedProject?.id === project.id)
        onNavigate(next.selectedProjectId, next.selectedPiboSessionId);
    } catch (caught) {
      onError(errorMessage(caught));
    }
  };

  const deleteArchivedProject = async (project: PiboProject) => {
    const confirmName = window.prompt(
      `Type the project name to permanently delete "${project.name}".`,
    );
    if (confirmName === null) return;
    const deleteFiles = window.confirm(
      `Also delete the real project folder?\n\n${project.projectFolder}`,
    );
    try {
      await deleteProject(project.id, { confirmName, deleteFiles });
      const next = await load({
        projectId:
          selectedProject?.id === project.id ? undefined : selectedProject?.id,
      });
      if (selectedProject?.id === project.id)
        onNavigate(next.selectedProjectId, next.selectedPiboSessionId);
    } catch (caught) {
      onError(errorMessage(caught));
    }
  };

  const runCommand = async (text: string) => {
    if (!selectedPiboSessionId) return false;
    const commandText = text.trim().split(/\s+/)[0];
    const command = commands.find(
      (candidate) => candidate.slash === commandText,
    );
    if (!command) return false;
    await postAction(selectedPiboSessionId, command.action);
    await load({
      projectId: selectedProject?.id,
      piboSessionId: selectedPiboSessionId,
    });
    return true;
  };

  if (loading && !data) {
    return (
      <main className="min-h-0 grid place-items-center text-slate-400">
        Loading Projects...
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-0 grid place-items-center bg-[#101d22] p-6 text-slate-300">
        <div
          className="max-w-lg rounded-sm border border-red-900/70 bg-red-950/30 p-4 text-sm leading-6 text-red-100"
          role="alert"
        >
          <div className="font-bold">Projects could not be loaded</div>
          <div className="mt-1 text-xs text-red-100/80">
            The Projects bootstrap response was empty or unavailable. Refresh to
            try again.
          </div>
          <button
            type="button"
            className="mt-3 rounded-sm border border-red-400/60 px-3 py-1.5 text-xs font-semibold text-red-100 hover:border-red-300"
            onClick={() => void load()}
          >
            Refresh Projects
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <CreateProjectDialog
        open={createProjectDialogOpen}
        onClose={() => setCreateProjectDialogOpen(false)}
        onCreate={createProject}
        onCreated={(projectId) =>
          void openCreatedProject(projectId).catch(() => undefined)
        }
      />
      <div
        className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
          mobileSidebarOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={onCloseMobileSidebar}
      />
      <ProjectsSidebar
        data={data}
        selectedProject={selectedProject}
        selectedPiboSessionId={selectedPiboSessionId}
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
        onCreateProject={() => setCreateProjectDialogOpen(true)}
        onToggleArchivedProjects={() => {
          const next = !showArchivedProjects;
          setShowArchivedProjects(next);
          localStorage.setItem(
            "pibo.chat.projects.showArchivedProjects",
            String(next),
          );
        }}
        onSelectProject={(projectId) => onNavigate(projectId, undefined)}
        onRenameProject={(project, name) => void renameProject(project, name)}
        onSetProjectArchived={(project, archived) =>
          void setProjectArchived(project, archived)
        }
        onDeleteArchivedProject={(project) =>
          void deleteArchivedProject(project)
        }
        onCreateProjectSession={() => void createProjectSession()}
        onToggleArchivedSessions={() => {
          const next = !showArchivedSessions;
          setShowArchivedSessions(next);
          localStorage.setItem(
            "pibo.chat.projects.showArchivedSessions",
            String(next),
          );
        }}
        onSelectSession={(piboSessionId) =>
          onNavigate(selectedProject?.id, piboSessionId)
        }
        onRenameSession={(piboSessionId, title) =>
          void renameSession(piboSessionId, title)
        }
        onArchiveSession={(piboSessionId, archived) =>
          void patchProjectSession(piboSessionId, { archived }).then(() =>
            load({ projectId: selectedProject?.id }),
          )
        }
        onDeleteSession={(node) =>
          void patchProjectSession(node.piboSessionId, { archived: true }).then(
            () => load({ projectId: selectedProject?.id }),
          )
        }
        onViewContext={onViewContext}
        onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
      />
      <SessionTracePane
        bootstrap={traceBootstrap}
        selectedPiboSessionId={selectedPiboSessionId}
        selectedRoomId={null}
        selectedRoomArchived={Boolean(selectedProject?.archivedAt)}
        selectedSessionProfile={selectedSessionProfile}
        selectedSessionActiveModel={resolveSessionActiveModelLabel(
          traceBootstrap,
          selectedSessionNode ?? { profile: selectedSessionProfile },
        )}
        selectedSessionStatus={selectedSessionNode?.status}
        sessionViewId="terminal"
        sessionViews={sessionViews}
        currentSessionView={projectCurrentSessionView}
        allowedSessionViewIds={["terminal"]}
        extraViewTabs={projectExtraViewTabs}
        activeViewId={
          activeProjectViewTab ? `project-${activeProjectViewTab}` : "terminal"
        }
        projectModulePanel={projectInfoPanel}
        creatingSession={creatingSession}
        showRawEvents={showRawEvents}
        showThinking={showThinking}
        expandThinking={expandThinking}
        commands={commands}
        skills={skills}
        composerText={composerText}
        composerFocusSignal={composerFocusSignal}
        onComposerTextChange={(next) =>
          setComposerText((current) =>
            typeof next === "function" ? next(current) : next,
          )
        }
        onToggleRawEvents={onToggleRawEvents}
        onToggleThinking={onToggleThinking}
        onToggleExpandThinking={onToggleExpandThinking}
        onSessionAgentProfileChange={async (profile) => {
          if (selectedPiboSessionId)
            await patchSession(selectedPiboSessionId, { profile });
        }}
        onFork={() => undefined}
        onOpenSession={(piboSessionId) =>
          onNavigate(selectedProject?.id, piboSessionId)
        }
        onSelectSessionView={selectProjectSessionView}
        onCommand={runCommand}
        onThinkingLevelChange={onThinkingLevelChange}
        onRefreshTrace={async () => undefined}
        onRefreshBootstrap={async () => {
          await load({
            projectId: selectedProject?.id,
            piboSessionId: selectedPiboSessionId ?? undefined,
          });
        }}
        onSend={async (
          text,
          _webAnnotationIds,
          _fileAttachmentPaths,
          clientTxnId,
        ) => {
          if (!selectedPiboSessionId) return;
          await postProjectMessage(selectedPiboSessionId, text, clientTxnId);
        }}
        onError={onError}
      />
    </>
  );
}

function ProjectInfoPanel({
  project,
  sessionCount,
}: {
  project: PiboProject;
  sessionCount: number;
}) {
  const projectDisplayName =
    project.metadata?.default === true ? "Project Manager" : project.name;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#0e1116] p-4 text-sm text-slate-300">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-sm border border-slate-800 bg-[#151f24] p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#11a4d4]">
            Project Info
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-100">
            {projectDisplayName}
          </h2>
          <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
            <ProjectInfoFact
              label="Workspace"
              value={project.projectFolder}
              monospace
            />
            <ProjectInfoFact label="Sessions" value={String(sessionCount)} />
            <ProjectInfoFact
              label="Status"
              value={project.archivedAt ? "archived" : "active"}
            />
            <ProjectInfoFact label="Project id" value={project.id} monospace />
          </div>
        </section>

        <section className="rounded-sm border border-slate-800 bg-[#151f24] p-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
            Project views
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
            Project-scoped capabilities live in top-level view tabs, not in the
            sidebar. Terminal stays a clean session view; future views can be
            enabled here without becoming session rows.
          </p>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {projectModules.map((module) => (
              <div
                key={module.id}
                className={`rounded-sm border px-3 py-3 text-xs ${module.enabled ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#8bdcf4]" : "border-slate-800 bg-[#101d22]/60 text-slate-500"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{module.label}</span>
                  <span className="text-[10px] uppercase tracking-wider">
                    {module.enabled ? "active" : "later"}
                  </span>
                </div>
                <div className="mt-2 text-[11px] leading-5 opacity-80">
                  {module.description}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProjectInfoFact({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-sm border border-slate-800 bg-[#101d22] p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 break-words text-slate-200 ${monospace ? "font-mono text-[11px]" : "text-xs"}`}
      >
        {value}
      </div>
    </div>
  );
}
