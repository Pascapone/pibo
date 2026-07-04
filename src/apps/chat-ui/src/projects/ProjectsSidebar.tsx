import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  Edit3,
  FolderPlus,
  Lock,
  MoreVertical,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { SessionNode } from "../session-node";
import type { PiboProject, PiboWebSessionNode } from "../types";

export function ProjectsSidebar({
  data,
  selectedProject,
  selectedPiboSessionId,
  activeProjects,
  archivedProjects,
  sessionGroups,
  selectedSessionPathIds,
  autoRenameSessionId,
  creatingSession,
  showArchivedProjects,
  showArchivedSessions,
  mobileSidebarOpen,
  onRefresh,
  onCloseMobileSidebar,
  onCreateProject,
  onToggleArchivedProjects,
  onSelectProject,
  onRenameProject,
  onSetProjectArchived,
  onDeleteArchivedProject,
  onCreateProjectSession,
  onToggleArchivedSessions,
  onSelectSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onViewContext,
  onAutoRenameConsumed,
}: {
  data: {
    sharedDefaultProject: PiboProject;
    sessions: PiboWebSessionNode[];
  };
  selectedProject?: PiboProject;
  selectedPiboSessionId: string | null;
  activeProjects: PiboProject[];
  archivedProjects: PiboProject[];
  sessionGroups: {
    active: PiboWebSessionNode[];
    archived: PiboWebSessionNode[];
  };
  selectedSessionPathIds: ReadonlySet<string>;
  autoRenameSessionId: string | null;
  creatingSession: boolean;
  showArchivedProjects: boolean;
  showArchivedSessions: boolean;
  mobileSidebarOpen: boolean;
  onRefresh: () => void;
  onCloseMobileSidebar: () => void;
  onCreateProject: () => void;
  onToggleArchivedProjects: () => void;
  onSelectProject: (projectId: string) => void;
  onRenameProject: (project: PiboProject, name: string) => void;
  onSetProjectArchived: (project: PiboProject, archived: boolean) => void;
  onDeleteArchivedProject: (project: PiboProject) => void;
  onCreateProjectSession: () => void;
  onToggleArchivedSessions: () => void;
  onSelectSession: (piboSessionId: string) => void;
  onRenameSession: (piboSessionId: string, title: string | null) => void;
  onArchiveSession: (piboSessionId: string, archived: boolean) => void;
  onDeleteSession: (node: PiboWebSessionNode) => void;
  onViewContext: (piboSessionId: string) => void;
  onAutoRenameConsumed: () => void;
}) {
  const signalNow = Date.now();
  return (
    <aside
      className={`min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
        mobileSidebarOpen
          ? "max-[980px]:translate-x-0"
          : "max-[980px]:-translate-x-full"
      }`}
    >
      <div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2">
        <span>projects</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh"
            aria-label="Refresh"
            className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            onClick={onCloseMobileSidebar}
            title="Close sidebar"
            aria-label="Close sidebar"
            className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="p-2 space-y-3">
        <div>
          <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Shared Project
          </div>
          <ProjectRow
            project={data.sharedDefaultProject}
            selected={selectedProject?.id === data.sharedDefaultProject.id}
            onSelect={() => onSelectProject(data.sharedDefaultProject.id)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Projects
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCreateProject}
                title="New Project"
                aria-label="New Project"
                className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={onToggleArchivedProjects}
                title="Archived Projects"
                aria-label="Archived Projects"
                className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedProjects ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
              >
                {showArchivedProjects ? (
                  <ArchiveRestore size={14} />
                ) : (
                  <Archive size={14} />
                )}
              </button>
            </div>
          </div>
          {activeProjects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selected={selectedProject?.id === project.id}
              onSelect={() => onSelectProject(project.id)}
              onRename={(name) => onRenameProject(project, name)}
              onArchive={() => onSetProjectArchived(project, true)}
            />
          ))}
          {activeProjects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">
              No projects
            </div>
          ) : null}
          {showArchivedProjects ? (
            <div className="mt-3">
              <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Archived Projects
              </div>
              {archivedProjects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  selected={selectedProject?.id === project.id}
                  onSelect={() => onSelectProject(project.id)}
                  onRename={(name) => onRenameProject(project, name)}
                  onArchive={() => onSetProjectArchived(project, false)}
                  onDelete={() => onDeleteArchivedProject(project)}
                  archived
                />
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Project Sessions
              </div>
              <div className="text-[10px] text-slate-500">
                Sessions run in the project workspace
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCreateProjectSession}
                disabled={creatingSession || !selectedProject}
                title="New Project Session"
                aria-label="New Project Session"
                className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={onToggleArchivedSessions}
                title={
                  showArchivedSessions
                    ? "Hide Archived Project Sessions"
                    : "Show Archived Project Sessions"
                }
                aria-label={
                  showArchivedSessions
                    ? "Hide Archived Project Sessions"
                    : "Show Archived Project Sessions"
                }
                className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedSessions ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
              >
                {showArchivedSessions ? (
                  <ArchiveRestore size={14} />
                ) : (
                  <Archive size={14} />
                )}
              </button>
            </div>
          </div>
          {sessionGroups.active.map((session) => (
            <SessionNode
              key={session.piboSessionId}
              node={session}
              signalNow={signalNow}
              selectedPiboSessionId={selectedPiboSessionId}
              selectedSessionPathIds={selectedSessionPathIds}
              onSelect={onSelectSession}
              onRename={onRenameSession}
              onArchive={onArchiveSession}
              onDelete={onDeleteSession}
              onViewContext={onViewContext}
              loadingPiboSessionId={null}
              autoRename={autoRenameSessionId === session.piboSessionId}
              onAutoRenameConsumed={onAutoRenameConsumed}
            />
          ))}
          {sessionGroups.active.length === 0 ? (
            <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">
              No active project sessions
            </div>
          ) : null}
          {showArchivedSessions ? (
            <div className="mt-3">
              <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Archived Project Sessions
              </div>
              {sessionGroups.archived.map((session) => (
                <SessionNode
                  key={session.piboSessionId}
                  node={session}
                  signalNow={signalNow}
                  selectedPiboSessionId={selectedPiboSessionId}
                  selectedSessionPathIds={selectedSessionPathIds}
                  onSelect={onSelectSession}
                  onRename={onRenameSession}
                  onArchive={onArchiveSession}
                  onDelete={onDeleteSession}
                  onViewContext={onViewContext}
                  loadingPiboSessionId={null}
                />
              ))}
              {sessionGroups.archived.length === 0 ? (
                <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">
                  No archived project sessions
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function ProjectRow({
  project,
  selected,
  archived,
  onSelect,
  onRename,
  onArchive,
  onDelete,
}: {
  project: PiboProject;
  selected: boolean;
  archived?: boolean;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const sharedDefault =
    project.metadata?.default === true || project.metadata?.personal === true;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(project.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) setDraftName(project.name);
  }, [editing, project.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const handle = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const submitRename = () => {
    const name = draftName.trim();
    if (name && name !== project.name) onRename?.(name);
    setEditing(false);
  };

  return (
    <div
      className={`group flex items-center gap-2 rounded-sm border px-2 py-2 text-sm ${
        sharedDefault
          ? selected
            ? "border-[#0bda57] bg-[#0bda57]/10 text-green-100"
            : "border-[#0bda57]/50 bg-[#0bda57]/5 text-slate-300 hover:border-[#0bda57]"
          : selected
            ? "border-[#11a4d4] bg-[#11a4d4]/10 text-sky-100"
            : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/40"
      }`}
    >
      <span
        className={`h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-sm ${sharedDefault ? "bg-[#0bda57]/15 text-[#0bda57]" : archived ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#151f24] text-slate-500"}`}
      >
        {sharedDefault ? (
          <Lock size={13} />
        ) : archived ? (
          <Archive size={13} />
        ) : (
          <FolderPlus size={13} />
        )}
      </span>
      {editing ? (
        <form
          className="min-w-0 flex-1 grid grid-cols-[1fr_auto_auto] gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <input
            ref={inputRef}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
                setDraftName(project.name);
              }
            }}
            className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
          />
          <button
            type="submit"
            title="Save Project Name"
            aria-label="Save Project Name"
            className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraftName(project.name);
            }}
            title="Cancel Rename"
            aria-label="Cancel Rename"
            className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <X size={13} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate font-medium">{project.name}</span>
          <span className="block truncate text-[11px] text-slate-500">
            {sharedDefault
              ? "shared default project chat"
              : project.projectFolder}
          </span>
        </button>
      )}
      {sharedDefault ? (
        <span
          title="Shared Project is locked"
          aria-label="Shared Project is locked"
          className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-[#0bda57]/50 rounded-sm text-[#0bda57]"
        >
          <Lock
            size={24}
            className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5"
          />
        </span>
      ) : editing ? null : (
        <div
          className="relative opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100"
          ref={menuRef}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            title="Project actions"
            aria-label="Project actions"
            className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <MoreVertical
              size={24}
              className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5"
            />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1 w-48 bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1">
              {onRename ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditing(true);
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
                >
                  <Edit3 size={16} /> Rename Project
                </button>
              ) : null}
              {onArchive ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onArchive();
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
                >
                  {archived ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Archive size={16} />
                  )}{" "}
                  {archived ? "Restore Project" : "Archive Project"}
                </button>
              ) : null}
              {onDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                >
                  <Trash2 size={16} /> Delete Project
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
