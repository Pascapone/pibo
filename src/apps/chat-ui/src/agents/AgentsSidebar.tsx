import { useMemo, useState } from "react";
import {
	Archive,
	ArchiveRestore,
	Check,
	ChevronDown,
	ChevronRight,
	CopyPlus,
	Folder,
	FolderInput,
	FolderPlus,
	MessageSquarePlus,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { ActionMenu, ActionMenuItem } from "../action-menu";
import { mobileSidebarA11yProps } from "../mobile-sidebar-accessibility";
import type { BootstrapData, CustomAgent, CustomAgentFolder } from "../types";
import type { AgentDraft } from "./agent-designer-model";

type AgentsSidebarProps = {
	folders: CustomAgentFolder[];
	activeAgents: CustomAgent[];
	archivedAgents: CustomAgent[];
	pluginProfiles: BootstrapData["agents"];
	draft: AgentDraft;
	unsavedAgentDraftVisible: boolean;
	showArchivedAgents: boolean;
	creatingSession: boolean;
	mobileSidebarOpen: boolean;
	isMobileSidebarViewport: boolean;
	onCloseMobileSidebar: () => void;
	onCreateAgent: (folderId?: string) => void;
	onCreateFolder: (name: string) => Promise<void>;
	onRenameFolder: (folderId: string, name: string) => Promise<void>;
	onDeleteFolder: (folderId: string) => Promise<void>;
	onToggleArchivedAgents: () => void;
	onRefresh: () => void;
	onSelectAgent: (agent: CustomAgent) => void;
	onCopyAgent: (agent: CustomAgent) => void;
	onMoveAgent: (agent: CustomAgent, folderId?: string) => void;
	onCreateAgentSession: (agent: CustomAgent) => void;
	onSelectProfile: (profile: BootstrapData["agents"][number]) => void;
	onCopyProfile: (profile: BootstrapData["agents"][number]) => void;
	onCreateProfileSession: (profile: BootstrapData["agents"][number]) => void;
};

export function AgentsSidebar({
	folders,
	activeAgents,
	archivedAgents,
	pluginProfiles,
	draft,
	unsavedAgentDraftVisible,
	showArchivedAgents,
	creatingSession,
	mobileSidebarOpen,
	isMobileSidebarViewport,
	onCloseMobileSidebar,
	onCreateAgent,
	onCreateFolder,
	onRenameFolder,
	onDeleteFolder,
	onToggleArchivedAgents,
	onRefresh,
	onSelectAgent,
	onCopyAgent,
	onMoveAgent,
	onCreateAgentSession,
	onSelectProfile,
	onCopyProfile,
	onCreateProfileSession,
}: AgentsSidebarProps) {
	const [creatingFolder, setCreatingFolder] = useState(false);
	const [folderName, setFolderName] = useState("");
	const [submittingFolder, setSubmittingFolder] = useState(false);
	const knownFolderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
	const activeByFolder = useMemo(() => agentsByFolder(activeAgents, knownFolderIds), [activeAgents, knownFolderIds]);
	const archivedByFolder = useMemo(() => agentsByFolder(archivedAgents, knownFolderIds), [archivedAgents, knownFolderIds]);
	const allByFolder = useMemo(() => agentsByFolder([...activeAgents, ...archivedAgents], knownFolderIds), [activeAgents, archivedAgents, knownFolderIds]);
	const unsavedFolderId = draft.folderId && knownFolderIds.has(draft.folderId) ? draft.folderId : undefined;

	const submitFolder = async () => {
		const name = folderName.trim();
		if (!name || submittingFolder) return;
		setSubmittingFolder(true);
		try {
			await onCreateFolder(name);
			setFolderName("");
			setCreatingFolder(false);
		} catch {
			// The designer-level error banner keeps the failed folder action visible.
		} finally {
			setSubmittingFolder(false);
		}
	};

	return (
		<aside
			data-pibo-mobile-sidebar
			{...mobileSidebarA11yProps(isMobileSidebarViewport, mobileSidebarOpen, "Agents sidebar")}
			data-pibo-debug="agents-sidebar"
			data-pibo-state={mobileSidebarOpen ? "open" : "closed"}
			className={`min-h-0 overflow-hidden flex flex-col bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[300px] max-[980px]:max-w-[86vw] max-[980px]:transition-transform max-[980px]:duration-200 ${
				mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
			}`}
		>
			<div className="h-11 shrink-0 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2">
				<span>Agents</span>
				<div className="flex items-center gap-1">
					<button type="button" onClick={() => onCreateAgent()} title="New unfiled agent" aria-label="New unfiled agent" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<Plus size={13} />
					</button>
					<button type="button" onClick={() => setCreatingFolder((current) => !current)} title="New agent folder" aria-label="New agent folder" aria-pressed={creatingFolder} className={`h-7 w-7 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${creatingFolder ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}>
						<FolderPlus size={13} />
					</button>
					<button type="button" onClick={onToggleArchivedAgents} title={showArchivedAgents ? "Hide archived agents" : "Show archived agents"} aria-label={showArchivedAgents ? "Hide archived agents" : "Show archived agents"} aria-pressed={showArchivedAgents} className={`h-7 w-7 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedAgents ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}>
						{showArchivedAgents ? <ArchiveRestore size={13} /> : <Archive size={13} />}
					</button>
					<button type="button" onClick={onRefresh} title="Refresh agents" aria-label="Refresh agents" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<RefreshCw size={13} />
					</button>
					<button type="button" onClick={onCloseMobileSidebar} title="Close sidebar" aria-label="Close sidebar" className="min-[981px]:hidden h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<X size={13} />
					</button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{creatingFolder ? (
					<form
						className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1 border border-[#11a4d4]/50 bg-[#11a4d4]/5 p-1.5 rounded-sm"
						onSubmit={(event) => {
							event.preventDefault();
							void submitFolder();
						}}
					>
						<input
							id="agent-folder-name"
							name="agentFolderName"
							value={folderName}
							onChange={(event) => setFolderName(event.target.value)}
							placeholder="Folder name"
							aria-label="Folder name"
							autoFocus
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#11a4d4]"
						/>
						<button type="submit" disabled={!folderName.trim() || submittingFolder} title="Create folder" aria-label="Create folder" className="h-8 w-8 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] disabled:opacity-50">
							<Check size={13} />
						</button>
						<button type="button" onClick={() => { setCreatingFolder(false); setFolderName(""); }} title="Cancel folder creation" aria-label="Cancel folder creation" className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<X size={13} />
						</button>
					</form>
				) : null}

				<div className="mb-4">
					<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Custom Agents</div>
					{folders.map((folder) => (
						<AgentFolderGroup
							key={folder.id}
							folder={folder}
							agents={activeByFolder.get(folder.id) ?? []}
							assignedCount={(allByFolder.get(folder.id) ?? []).length}
							folders={folders}
							draft={draft}
							unsavedDraft={unsavedAgentDraftVisible && unsavedFolderId === folder.id ? draft : undefined}
							creatingSession={creatingSession}
							onCreateAgent={() => onCreateAgent(folder.id)}
							onRenameFolder={onRenameFolder}
							onDeleteFolder={onDeleteFolder}
							onSelectAgent={onSelectAgent}
							onCopyAgent={onCopyAgent}
							onMoveAgent={onMoveAgent}
							onCreateSession={onCreateAgentSession}
						/>
					))}
					<AgentFolderGroup
						agents={activeByFolder.get(UNFILED_KEY) ?? []}
						assignedCount={(allByFolder.get(UNFILED_KEY) ?? []).length}
						folders={folders}
						draft={draft}
						unsavedDraft={unsavedAgentDraftVisible && !unsavedFolderId ? draft : undefined}
						creatingSession={creatingSession}
						onCreateAgent={() => onCreateAgent()}
						onRenameFolder={onRenameFolder}
						onDeleteFolder={onDeleteFolder}
						onSelectAgent={onSelectAgent}
						onCopyAgent={onCopyAgent}
						onMoveAgent={onMoveAgent}
						onCreateSession={onCreateAgentSession}
					/>
					{activeAgents.length === 0 && !unsavedAgentDraftVisible && folders.length === 0 ? <EmptySidebarState label="No custom agents" /> : null}
				</div>

				{showArchivedAgents ? (
					<div className="mb-4 border-t border-slate-800 pt-3">
						<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Agents</div>
						{folders.map((folder) => {
							const assigned = archivedByFolder.get(folder.id) ?? [];
							if (!assigned.length) return null;
							return <ArchivedAgentGroup key={folder.id} label={folder.name} agents={assigned} folders={folders} draft={draft} onSelectAgent={onSelectAgent} onCopyAgent={onCopyAgent} onMoveAgent={onMoveAgent} />;
						})}
						{(archivedByFolder.get(UNFILED_KEY) ?? []).length ? <ArchivedAgentGroup label="Unfiled" agents={archivedByFolder.get(UNFILED_KEY) ?? []} folders={folders} draft={draft} onSelectAgent={onSelectAgent} onCopyAgent={onCopyAgent} onMoveAgent={onMoveAgent} /> : null}
						{archivedAgents.length === 0 ? <EmptySidebarState label="No archived agents" /> : null}
					</div>
				) : null}

				<div className="border-t border-slate-800 pt-3">
					<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Read-only Profiles</div>
					{pluginProfiles.map((profile) => (
						<ProfileSidebarRow
							key={profile.name}
							profile={profile}
							selected={draft.source === "profile" && draft.profileName === profile.name}
							creatingSession={creatingSession}
							onSelect={() => onSelectProfile(profile)}
							onCopy={() => onCopyProfile(profile)}
							onCreateSession={() => onCreateProfileSession(profile)}
						/>
					))}
				</div>
			</div>
		</aside>
	);
}

const UNFILED_KEY = "__unfiled__";

function agentsByFolder(agents: CustomAgent[], knownFolderIds: ReadonlySet<string>): Map<string, CustomAgent[]> {
	const groups = new Map<string, CustomAgent[]>();
	for (const agent of agents) {
		const key = agent.folderId && knownFolderIds.has(agent.folderId) ? agent.folderId : UNFILED_KEY;
		const items = groups.get(key) ?? [];
		items.push(agent);
		groups.set(key, items);
	}
	return groups;
}

function AgentFolderGroup({
	folder,
	agents,
	assignedCount,
	folders,
	draft,
	unsavedDraft,
	creatingSession,
	onCreateAgent,
	onRenameFolder,
	onDeleteFolder,
	onSelectAgent,
	onCopyAgent,
	onMoveAgent,
	onCreateSession,
}: {
	folder?: CustomAgentFolder;
	agents: CustomAgent[];
	assignedCount: number;
	folders: CustomAgentFolder[];
	draft: AgentDraft;
	unsavedDraft?: AgentDraft;
	creatingSession: boolean;
	onCreateAgent: () => void;
	onRenameFolder: (folderId: string, name: string) => Promise<void>;
	onDeleteFolder: (folderId: string) => Promise<void>;
	onSelectAgent: (agent: CustomAgent) => void;
	onCopyAgent: (agent: CustomAgent) => void;
	onMoveAgent: (agent: CustomAgent, folderId?: string) => void;
	onCreateSession: (agent: CustomAgent) => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [name, setName] = useState(folder?.name ?? "Unfiled");
	const [busy, setBusy] = useState(false);
	const visibleCount = agents.length + (unsavedDraft ? 1 : 0);
	const assignedOrDraftCount = assignedCount + (unsavedDraft ? 1 : 0);
	const submitRename = async () => {
		if (!folder || !name.trim() || busy) return;
		setBusy(true);
		try {
			await onRenameFolder(folder.id, name.trim());
			setRenaming(false);
		} catch {
			// Keep the rename input open so the user can correct the name.
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="mb-2 border border-slate-800 bg-[#151f24]/70 rounded-sm">
			<div className="group flex min-h-9 items-center gap-1 border-b border-slate-800/80 px-1.5">
				<button type="button" onClick={() => setCollapsed((current) => !current)} aria-expanded={!collapsed} className="h-7 w-7 shrink-0 inline-flex items-center justify-center text-slate-500 hover:text-[#11a4d4]">
					{collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
				</button>
				<span className={`h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-sm ${folder ? "bg-[#11a4d4]/10 text-[#11a4d4]" : "bg-slate-800 text-slate-500"}`}>
					<Folder size={13} />
				</span>
				{renaming && folder ? (
					<form className="min-w-0 flex-1 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1 py-1" onSubmit={(event) => { event.preventDefault(); void submitRename(); }}>
						<input id={`agent-folder-name-${folder.id}`} name="agentFolderName" value={name} onChange={(event) => setName(event.target.value)} autoFocus aria-label="Agent folder name" className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs outline-none focus:border-[#11a4d4]" />
						<button type="submit" disabled={busy || !name.trim()} title="Save folder name" aria-label="Save folder name" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"><Check size={12} /></button>
						<button type="button" onClick={() => { setRenaming(false); setName(folder.name); }} title="Cancel rename" aria-label="Cancel rename" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={12} /></button>
					</form>
				) : (
					<>
						<button type="button" onClick={() => setCollapsed((current) => !current)} className="min-w-0 flex-1 text-left text-xs font-semibold text-slate-300">
							<span className="block truncate">{folder?.name ?? "Unfiled"}</span>
						</button>
						<span className="min-w-5 text-center font-mono text-[10px] tabular-nums text-slate-500">{assignedOrDraftCount}</span>
						<button type="button" onClick={onCreateAgent} title={`New agent in ${folder?.name ?? "Unfiled"}`} aria-label={`New agent in ${folder?.name ?? "Unfiled"}`} className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-slate-500 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4]"><Plus size={12} /></button>
						{folder ? (
							<ActionMenu label={`Actions for folder ${folder.name}`} estimatedHeight={96}>
								<ActionMenuItem onSelect={() => { setName(folder.name); setRenaming(true); }}><FolderInput size={15} /> Rename folder</ActionMenuItem>
								<ActionMenuItem disabled={assignedOrDraftCount > 0} onSelect={() => void onDeleteFolder(folder.id).catch(() => undefined)} className="text-red-300 hover:bg-red-500/10"><Trash2 size={15} /> Delete empty folder</ActionMenuItem>
							</ActionMenu>
						) : <span className="h-7 w-6" />}
					</>
				)}
			</div>
			{collapsed ? null : (
				<div className="p-1">
					{unsavedDraft ? <UnsavedAgentRow draft={unsavedDraft} /> : null}
					{agents.map((agent) => (
						<CustomAgentSidebarRow
							key={agent.id}
							agent={agent}
							folders={folders}
							selected={draft.source === "custom" && draft.id === agent.id}
							createSessionDisabled={creatingSession}
							onSelect={() => onSelectAgent(agent)}
							onCopy={() => onCopyAgent(agent)}
							onMove={(folderId) => onMoveAgent(agent, folderId)}
							onCreateSession={() => onCreateSession(agent)}
						/>
					))}
					{visibleCount === 0 ? <div className="px-2 py-2 text-[11px] text-slate-600">{assignedCount > 0 ? "Archived agents hidden" : "Empty folder"}</div> : null}
				</div>
			)}
		</div>
	);
}

function ArchivedAgentGroup({ label, agents, folders, draft, onSelectAgent, onCopyAgent, onMoveAgent }: {
	label: string;
	agents: CustomAgent[];
	folders: CustomAgentFolder[];
	draft: AgentDraft;
	onSelectAgent: (agent: CustomAgent) => void;
	onCopyAgent: (agent: CustomAgent) => void;
	onMoveAgent: (agent: CustomAgent, folderId?: string) => void;
}) {
	return (
		<div className="mb-2">
			<div className="px-1 py-1 text-[10px] text-slate-600">{label}</div>
			{agents.map((agent) => <CustomAgentSidebarRow key={agent.id} agent={agent} folders={folders} selected={draft.source === "custom" && draft.id === agent.id} createSessionDisabled onSelect={() => onSelectAgent(agent)} onCopy={() => onCopyAgent(agent)} onMove={(folderId) => onMoveAgent(agent, folderId)} onCreateSession={() => {}} />)}
		</div>
	);
}

function UnsavedAgentRow({ draft }: { draft: AgentDraft }) {
	return (
		<div className="mb-1 flex items-center gap-2 border border-[#11a4d4] bg-[#11a4d4]/10 px-2 py-2 rounded-sm">
			<span className="h-6 w-6 shrink-0 inline-flex items-center justify-center bg-[#11a4d4]/10 text-[#11a4d4] rounded-sm"><Plus size={13} /></span>
			<span className="min-w-0">
				<span className="block truncate text-sm text-slate-100">{draft.displayName || "new-agent"}</span>
				<span className="block truncate font-mono text-[10px] text-[#7dd3fc]">unsaved draft</span>
			</span>
		</div>
	);
}

function CustomAgentSidebarRow({ agent, folders, selected, createSessionDisabled, onSelect, onCopy, onMove, onCreateSession }: {
	agent: CustomAgent;
	folders: CustomAgentFolder[];
	selected: boolean;
	createSessionDisabled: boolean;
	onSelect: () => void;
	onCopy: () => void;
	onMove: (folderId?: string) => void;
	onCreateSession: () => void;
}) {
	return (
		<div className={`group mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent hover:border-slate-700 hover:bg-slate-900/30"}`}>
			<button type="button" onClick={onSelect} aria-current={selected ? "page" : undefined} className="min-w-0 text-left px-2 py-1.5">
				<span className="block truncate text-[13px] text-slate-200">{agent.displayName}</span>
				<span className="block truncate font-mono text-[10px] text-slate-500">{agent.profileName}</span>
			</button>
			<div className="pr-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
				<ActionMenu label={`Actions for agent ${agent.displayName}`} estimatedHeight={Math.min(420, 120 + folders.length * 40)}>
					<ActionMenuItem disabled={createSessionDisabled || Boolean(agent.archivedAt)} onSelect={onCreateSession}><MessageSquarePlus size={15} /> New session</ActionMenuItem>
					<ActionMenuItem onSelect={onCopy}><CopyPlus size={15} /> Copy as new agent</ActionMenuItem>
					<div role="presentation" className="border-t border-slate-800 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Move to</div>
					<ActionMenuItem disabled={!agent.folderId} onSelect={() => onMove(undefined)}>{!agent.folderId ? <Check size={15} /> : <Folder size={15} />} Unfiled</ActionMenuItem>
					{folders.map((folder) => (
						<ActionMenuItem key={folder.id} disabled={agent.folderId === folder.id} onSelect={() => onMove(folder.id)}>
							{agent.folderId === folder.id ? <Check size={15} /> : <Folder size={15} />} {folder.name}
						</ActionMenuItem>
					))}
				</ActionMenu>
			</div>
		</div>
	);
}

function ProfileSidebarRow({ profile, selected, creatingSession, onSelect, onCopy, onCreateSession }: {
	profile: BootstrapData["agents"][number];
	selected: boolean;
	creatingSession: boolean;
	onSelect: () => void;
	onCopy: () => void;
	onCreateSession: () => void;
}) {
	return (
		<div className={`group mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent hover:border-slate-700 hover:bg-slate-900/30"}`}>
			<button type="button" onClick={onSelect} aria-current={selected ? "page" : undefined} className="min-w-0 text-left px-2 py-1.5">
				<span className="block truncate text-[13px] text-slate-200">{profile.name}</span>
				<span className="block truncate font-mono text-[10px] text-slate-500">plugin profile</span>
			</button>
			<div className="pr-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
				<ActionMenu label={`Actions for profile ${profile.name}`} estimatedHeight={96}>
					<ActionMenuItem disabled={creatingSession} onSelect={onCreateSession}><MessageSquarePlus size={15} /> New session</ActionMenuItem>
					<ActionMenuItem onSelect={onCopy}><CopyPlus size={15} /> Copy as custom agent</ActionMenuItem>
				</ActionMenu>
			</div>
		</div>
	);
}

function EmptySidebarState({ label }: { label: string }) {
	return <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">{label}</div>;
}
