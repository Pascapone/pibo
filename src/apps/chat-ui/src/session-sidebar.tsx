import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
	Archive,
	ArchiveRestore,
	Check,
	CheckCheck,
	Copy,
	Edit3,
	FolderPlus,
	Loader2,
	Lock,
	MoreVertical,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import type { BootstrapData, PiboRoom, PiboWebSessionNode } from "./types";
import { copyTextToClipboard } from "./clipboard";
import { SessionNode } from "./session-node";
import {
	findPersonalRoom,
	formatRoomSummary,
	isArchivedRoom,
	isPersonalRoom,
	roomNodeTooltip,
	splitRoomNodes,
} from "./session-sidebar-helpers";

const SESSION_INFINITE_SCROLL_ROOT_MARGIN = "240px 0px";

function unreadBadgeLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

function UnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#38bdf8] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages`}
			title={`${count} unread messages`}
		>
			{unreadBadgeLabel(count)}
		</span>
	);
}

export type RoomUpdateInput = { name?: string; topic?: string | null; workspace?: string | null };

export type SessionSidebarProps = {
	bootstrap: BootstrapData;
	selectedRoomId: string | null;
	selectedPiboSessionId: string | null;
	showArchivedRooms: boolean;
	onToggleArchivedRooms: () => void;
	creatingRoom: boolean;
	onCreateRoom: () => void | Promise<void>;
	onSelectRoom: (roomId: string) => void | Promise<void>;
	onUpdateRoom: (roomId: string, input: RoomUpdateInput) => void | Promise<void>;
	onArchiveRoom: (roomId: string, archived: boolean) => void | Promise<void>;
	onReadAllRoom: (roomId: string) => void | Promise<void>;
	onDeleteRoom: (room: PiboRoom) => void;
	newSessionProfile: string;
	onNewSessionProfileChange: (profile: string) => void;
	selectedRoomArchived: boolean;
	creatingSession: boolean;
	onCreateSession: () => void | Promise<void>;
	showArchived: boolean;
	onToggleArchivedSessions: () => void | Promise<void>;
	loadingArchivedSessions: boolean;
	visibleActiveSessions: PiboWebSessionNode[];
	visibleArchivedSessions: PiboWebSessionNode[];
	totalActiveSessionCount: number;
	totalArchivedSessionCount: number;
	hasMoreActiveSessions: boolean;
	hasMoreArchivedSessions: boolean;
	loadingActiveSessions: boolean;
	sessionListScrollRef: RefObject<HTMLDivElement | null>;
	onLoadMoreSessions: (archived: boolean) => void | Promise<void>;
	signalNow: number;
	selectedSessionPathIds: ReadonlySet<string>;
	onSelectSession: (piboSessionId: string) => void | Promise<void>;
	onRenameSession: (piboSessionId: string, title: string | null) => void | Promise<void>;
	onArchiveSession: (piboSessionId: string, archived: boolean) => void | Promise<void>;
	onDeleteSession: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
	loadingPiboSessionId?: string | null;
	autoRenameSessionId?: string | null;
	onAutoRenameConsumed: () => void;
};

export function SessionSidebar({
	bootstrap,
	selectedRoomId,
	selectedPiboSessionId,
	showArchivedRooms,
	onToggleArchivedRooms,
	creatingRoom,
	onCreateRoom,
	onSelectRoom,
	onUpdateRoom,
	onArchiveRoom,
	onReadAllRoom,
	onDeleteRoom,
	newSessionProfile,
	onNewSessionProfileChange,
	selectedRoomArchived,
	creatingSession,
	onCreateSession,
	showArchived,
	onToggleArchivedSessions,
	loadingArchivedSessions,
	visibleActiveSessions,
	visibleArchivedSessions,
	totalActiveSessionCount,
	totalArchivedSessionCount,
	hasMoreActiveSessions,
	hasMoreArchivedSessions,
	loadingActiveSessions,
	sessionListScrollRef,
	onLoadMoreSessions,
	signalNow,
	selectedSessionPathIds,
	onSelectSession,
	onRenameSession,
	onArchiveSession,
	onDeleteSession,
	onViewContext,
	loadingPiboSessionId,
	autoRenameSessionId,
	onAutoRenameConsumed,
}: SessionSidebarProps) {
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const newSessionProfileOptions = bootstrap.agents;
	const personalRoom = findPersonalRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);

	return (
		<div
			data-pibo-debug="session-list"
			data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
			data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
			data-pibo-state={showArchived ? "archived-visible" : "active-only"}
			className="min-h-0 flex-1 overflow-hidden p-2 flex flex-col gap-3"
		>
			{roomsSupported ? (
				<>
					{personalRoom ? (
							<div className="shrink-0">
								<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Personal Chat</div>
								<RoomNode
									room={personalRoom}
									selectedRoomId={selectedRoomId}
									onSelect={(roomId) => void onSelectRoom(roomId)}
									onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
									onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
									onReadAll={(roomId) => void onReadAllRoom(roomId)}
									onDelete={onDeleteRoom}
								/>
							</div>
					) : null}
					<div className="min-h-0 flex-1 basis-0 overflow-hidden flex flex-col">
						<div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1">
							<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rooms</div>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={() => void onCreateRoom()}
									disabled={creatingRoom}
									title="New Room"
									aria-label="New Room"
									className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
								>
									<Plus size={14} />
								</button>
								<button
									type="button"
									onClick={onToggleArchivedRooms}
									title={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
									aria-label={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
									className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedRooms ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
								>
									{showArchivedRooms ? <ArchiveRestore size={14} /> : <Archive size={14} />}
								</button>
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto pr-1">
						{roomGroups.active.map((room) => (
							<RoomNode
								key={room.id}
								room={room}
								selectedRoomId={selectedRoomId}
								onSelect={(roomId) => void onSelectRoom(roomId)}
								onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
								onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
								onReadAll={(roomId) => void onReadAllRoom(roomId)}
								onDelete={onDeleteRoom}
							/>
						))}
						{roomGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No rooms</div> : null}
						{showArchivedRooms ? (
							<div className="mt-3">
								<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Rooms</div>
								{roomGroups.archived.length ? (
									<ArchivedRoomsList
										rooms={roomGroups.archived}
										selectedRoomId={selectedRoomId}
										onSelect={(roomId) => void onSelectRoom(roomId)}
										onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
										onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
										onReadAll={(roomId) => void onReadAllRoom(roomId)}
										onDelete={onDeleteRoom}
									/>
								) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived rooms</div>}
							</div>
						) : null}
						</div>
					</div>
				</>
			) : null}
			<div className="min-h-0 flex-1 basis-0 overflow-hidden flex flex-col border-t border-slate-700/80 pt-3">
				<div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1">
					<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
					<div className="flex items-center gap-1">
						<select
							value={newSessionProfile}
							onChange={(event) => onNewSessionProfileChange(event.target.value)}
							disabled={!newSessionProfileOptions.length || selectedRoomArchived}
							title="Agent for new sessions"
							aria-label="Agent for new sessions"
							className="h-6 w-28 max-[980px]:h-8 max-[980px]:w-32 max-[980px]:text-sm rounded-sm border border-slate-700 bg-[#101d22] px-1.5 text-[11px] font-medium normal-case tracking-normal text-slate-300 outline-none hover:border-[#11a4d4] focus:border-[#11a4d4] disabled:opacity-50"
						>
							{newSessionProfileOptions.map((profile) => (
								<option key={profile.name} value={profile.name} title={profile.description ?? profile.name}>
									{profile.name}
								</option>
							))}
						</select>
						<button
							data-pibo-debug="new-session-button"
							data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
							data-pibo-state={creatingSession ? "creating" : selectedRoomArchived ? "archived-disabled" : "ready"}
							type="button"
							onClick={() => void onCreateSession()}
							disabled={creatingSession || selectedRoomArchived}
							title="New Session"
							aria-label="New Session"
							className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							<Plus size={14} />
						</button>
						<button
							type="button"
							onClick={() => void onToggleArchivedSessions()}
							disabled={loadingArchivedSessions}
							title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
							aria-label={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
							className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-70 ${
								showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
							}`}
						>
							{loadingArchivedSessions ? <Loader2 size={14} className="animate-spin" /> : showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
						</button>
					</div>
				</div>
				<div ref={sessionListScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
				{visibleActiveSessions.map((session) => (
					<SessionNode
						key={session.piboSessionId}
						node={session}
						signalNow={signalNow}
						selectedPiboSessionId={selectedPiboSessionId}
						selectedSessionPathIds={selectedSessionPathIds}
						onSelect={(piboSessionId) => void onSelectSession(piboSessionId)}
						onRename={(piboSessionId, title) => void onRenameSession(piboSessionId, title)}
						onArchive={(piboSessionId, archived) => void onArchiveSession(piboSessionId, archived)}
						onDelete={onDeleteSession}
						onViewContext={onViewContext}
						loadingPiboSessionId={loadingPiboSessionId}
						autoRename={autoRenameSessionId === session.piboSessionId}
						onAutoRenameConsumed={() => onAutoRenameConsumed()}
					/>
				))}
				{totalActiveSessionCount === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No active sessions</div> : null}
				{hasMoreActiveSessions ? (
					<SessionSidebarLoadMoreButton
						debugName="active-session-load-more"
						loading={loadingActiveSessions}
						rootRef={sessionListScrollRef}
						onLoadMore={() => onLoadMoreSessions(false)}
					>
						{loadingActiveSessions ? "Loading active sessions…" : `Load more active sessions (${visibleActiveSessions.length} of ${totalActiveSessionCount})`}
					</SessionSidebarLoadMoreButton>
				) : null}
			{showArchived ? (
				<div className="mt-3">
					<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
						<span>Archived Sessions</span>
						{loadingArchivedSessions ? <Loader2 size={12} className="text-[#11a4d4] animate-spin" aria-label="Loading archived sessions" /> : null}
					</div>
					{loadingArchivedSessions ? (
						<div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm flex items-center gap-2">
							<Loader2 size={13} className="text-[#11a4d4] animate-spin" /> Loading archived sessions
						</div>
					) : totalArchivedSessionCount ? (
						<>
							<ArchivedSessionsList
								sessions={visibleArchivedSessions}
								signalNow={signalNow}
								selectedPiboSessionId={selectedPiboSessionId}
								selectedSessionPathIds={selectedSessionPathIds}
								onSelect={(piboSessionId) => void onSelectSession(piboSessionId)}
								onRename={(piboSessionId, title) => void onRenameSession(piboSessionId, title)}
								onArchive={(piboSessionId, archived) => void onArchiveSession(piboSessionId, archived)}
								onDelete={onDeleteSession}
								onViewContext={onViewContext}
								loadingPiboSessionId={loadingPiboSessionId}
								autoRenameSessionId={autoRenameSessionId}
								onAutoRenameConsumed={() => onAutoRenameConsumed()}
							/>
							{hasMoreArchivedSessions ? (
								<SessionSidebarLoadMoreButton
									debugName="archived-session-load-more"
									loading={loadingArchivedSessions}
									rootRef={sessionListScrollRef}
									onLoadMore={() => onLoadMoreSessions(true)}
								>
									{loadingArchivedSessions ? "Loading archived sessions…" : `Load more archived sessions (${visibleArchivedSessions.length} of ${totalArchivedSessionCount})`}
								</SessionSidebarLoadMoreButton>
							) : null}
						</>
					) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived sessions</div>}
				</div>
			) : null}
				</div>
			</div>
		</div>
	);
}

function ArchivedRoomsList({
	rooms,
	selectedRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onReadAll,
	onDelete,
}: {
	rooms: PiboRoom[];
	selectedRoomId: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => void;
	onArchive: (roomId: string, archived: boolean) => void;
	onReadAll: (roomId: string) => void;
	onDelete: (room: PiboRoom) => void;
}) {
	return (
		<div>
			{rooms.map((room) => (
				<RoomNode
					key={room.id}
					room={room}
					selectedRoomId={selectedRoomId}
					onSelect={onSelect}
					onUpdate={onUpdate}
					onArchive={onArchive}
					onReadAll={onReadAll}
					onDelete={onDelete}
				/>
			))}
		</div>
	);
}

function SessionSidebarLoadMoreButton({
	children,
	debugName,
	loading,
	rootRef,
	onLoadMore,
}: {
	children: ReactNode;
	debugName: string;
	loading: boolean;
	rootRef: RefObject<HTMLElement | null>;
	onLoadMore: () => void | Promise<void>;
}) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const onLoadMoreRef = useRef(onLoadMore);
	const requestedRef = useRef(false);

	useEffect(() => {
		onLoadMoreRef.current = onLoadMore;
	}, [onLoadMore]);

	useEffect(() => {
		if (!loading) requestedRef.current = false;
	}, [loading]);

	const triggerLoadMore = useCallback(() => {
		if (requestedRef.current || loading) return;
		requestedRef.current = true;
		void Promise.resolve(onLoadMoreRef.current()).finally(() => {
			requestedRef.current = false;
		});
	}, [loading]);

	useEffect(() => {
		if (loading || typeof IntersectionObserver === "undefined") return;
		const target = buttonRef.current;
		if (!target) return;
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			triggerLoadMore();
		}, {
			root: rootRef.current,
			rootMargin: SESSION_INFINITE_SCROLL_ROOT_MARGIN,
			threshold: 0,
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [loading, rootRef, triggerLoadMore]);

	return (
		<button
			ref={buttonRef}
			data-pibo-debug={debugName}
			type="button"
			onClick={triggerLoadMore}
			disabled={loading}
			className="mt-2 w-full px-2 py-2 text-[11px] text-slate-400 border border-dashed border-slate-700 rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
		>
			{children}
		</button>
	);
}

function ArchivedSessionsList({
	sessions,
	signalNow,
	selectedPiboSessionId,
	selectedSessionPathIds,
	onSelect,
	onRename,
	onArchive,
	onDelete,
	onViewContext,
	loadingPiboSessionId,
	autoRenameSessionId,
	onAutoRenameConsumed,
}: {
	sessions: PiboWebSessionNode[];
	signalNow: number;
	selectedPiboSessionId: string | null;
	selectedSessionPathIds: ReadonlySet<string>;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	onDelete: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
	loadingPiboSessionId?: string | null;
	autoRenameSessionId?: string | null;
	onAutoRenameConsumed?: () => void;
}) {
	return (
		<div>
			{sessions.map((session) => (
				<SessionNode
					key={session.piboSessionId}
					node={session}
					signalNow={signalNow}
					selectedPiboSessionId={selectedPiboSessionId}
					selectedSessionPathIds={selectedSessionPathIds}
					onSelect={onSelect}
					onRename={onRename}
					onArchive={onArchive}
					onDelete={onDelete}
					onViewContext={onViewContext}
					loadingPiboSessionId={loadingPiboSessionId}
					autoRename={autoRenameSessionId === session.piboSessionId}
					onAutoRenameConsumed={onAutoRenameConsumed}
				/>
			))}
		</div>
	);
}

function RoomNode({
	room,
	selectedRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onReadAll,
	onDelete,
	depth = 0,
}: {
	room: PiboRoom;
	selectedRoomId: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => void;
	onArchive: (roomId: string, archived: boolean) => void;
	onReadAll: (roomId: string) => void;
	onDelete: (room: PiboRoom) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");
	const [draftWorkspace, setDraftWorkspace] = useState(room.workspace ?? "");
	const personal = isPersonalRoom(room);
	const archived = isArchivedRoom(room);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const roomTooltip = roomNodeTooltip(room);

	const copyRoomId = () => {
		void copyTextToClipboard(room.id).catch(() => undefined);
	};

	useEffect(() => {
		if (!menuOpen) return;
		const handle = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", handle);
		return () => document.removeEventListener("mousedown", handle);
	}, [menuOpen]);

	useEffect(() => {
		if (!editing) {
			setDraftName(room.name);
			setDraftTopic(room.topic ?? "");
			setDraftWorkspace(room.workspace ?? "");
		}
	}, [editing, room.name, room.topic, room.workspace]);

	const submit = () => {
		const name = draftName.trim();
		if (!name) return;
		onUpdate(room.id, { name, topic: draftTopic.trim() || null, workspace: draftWorkspace.trim() || null });
		setEditing(false);
	};

	return (
		<div>
			<div
				className={`group mb-1 border rounded-sm ${
					personal
						? room.id === selectedRoomId
							? "border-[#0bda57] bg-[#0bda57]/10"
							: "border-[#0bda57]/50 bg-[#0bda57]/5"
						: room.id === selectedRoomId
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: archived
								? "border-[#f59e0b]/40 bg-[#f59e0b]/5"
								: "border-transparent"
				}`}
				style={{ marginLeft: depth * 12 }}
				title={roomTooltip}
			>
				{editing && !personal ? (
					<form
						className="grid gap-1 p-1"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<input
							value={draftName}
							onChange={(event) => setDraftName(event.target.value)}
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
							autoFocus
						/>
						<input
							value={draftTopic}
							onChange={(event) => setDraftTopic(event.target.value)}
							placeholder="Topic"
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs outline-none focus:border-[#11a4d4]"
						/>
						<input
							value={draftWorkspace}
							onChange={(event) => setDraftWorkspace(event.target.value)}
							placeholder="Workspace (/absolute/path)"
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-[#11a4d4]"
						/>
						<div className="flex justify-end gap-1">
							<button type="submit" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
								<Check size={13} />
							</button>
							<button
								type="button"
								onClick={() => setEditing(false)}
								className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<X size={13} />
							</button>
						</div>
					</form>
				) : (
					<div className="grid grid-cols-[1fr_auto] items-center gap-1 py-1 pr-1">
						<button
							type="button"
							onClick={() => onSelect(room.id)}
							className="min-w-0 text-left px-2 py-1 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className={`h-6 w-6 inline-flex items-center justify-center rounded-sm ${personal ? "bg-[#0bda57]/15 text-[#0bda57]" : archived ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#151f24] text-slate-500"}`}>
								{personal ? <Lock size={13} /> : archived ? <Archive size={13} /> : <FolderPlus size={13} />}
							</span>
							<span className="min-w-0">
								<span className={`block text-sm truncate ${archived ? "text-slate-500" : "text-slate-200"}`}>{room.name}</span>
								<span className="block text-[10px] font-mono truncate text-slate-500">{personal ? "locked personal room" : archived ? "archived" : formatRoomSummary(room)}</span>
							</span>
							<UnreadBadge count={room.unreadCount} />
						</button>
						<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
							{personal ? (
								<span title="Personal Chat is locked" aria-label="Personal Chat is locked" className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-[#0bda57]/50 rounded-sm text-[#0bda57]">
									<Lock size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
								</span>
							) : (
								<div className="relative" ref={menuRef}>
									<button
										type="button"
										onClick={() => setMenuOpen((v) => !v)}
										title="Room actions"
										aria-label="Room actions"
										className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<MoreVertical size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
									</button>
									{menuOpen && (
										<div className="absolute right-0 top-full z-50 mt-1 w-48 bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1">
											{archived ? (
												<>
													<button
														type="button"
														onClick={() => { copyRoomId(); setMenuOpen(false); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<Copy size={16} /> Copy Room ID
													</button>
													<button
														type="button"
														onClick={() => { setMenuOpen(false); onArchive(room.id, false); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<ArchiveRestore size={16} /> Restore Room
													</button>
													<button
														type="button"
														onClick={() => { setMenuOpen(false); onDelete(room); }}
														className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/10 flex items-center gap-2"
													>
														<Trash2 size={16} /> Delete Room
													</button>
												</>
											) : (
												<>
													<button
														type="button"
														onClick={() => { copyRoomId(); setMenuOpen(false); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<Copy size={16} /> Copy Room ID
													</button>
													<button
														type="button"
														onClick={() => { setMenuOpen(false); setEditing(true); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<Edit3 size={16} /> Edit Room
													</button>
													<button
														type="button"
														onClick={() => { setMenuOpen(false); onReadAll(room.id); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<CheckCheck size={16} /> Read All
													</button>
													<button
														type="button"
														onClick={() => { setMenuOpen(false); onArchive(room.id, true); }}
														className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
													>
														<Archive size={16} /> Archive Room
													</button>
												</>
											)}
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
			{(room.children ?? []).map((child) => (
				<RoomNode
					key={child.id}
					room={child}
						selectedRoomId={selectedRoomId}
						onSelect={onSelect}
						onUpdate={onUpdate}
						onArchive={onArchive}
						onReadAll={onReadAll}
						onDelete={onDelete}
						depth={depth + 1}
					/>
			))}
		</div>
	);
}
