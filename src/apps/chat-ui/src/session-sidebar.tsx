import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEventHandler, type ReactNode, type RefObject } from "react";
import {
	Archive,
	ArchiveRestore,
	Check,
	CheckCheck,
	Copy,
	Edit3,
	FolderOpen,
	FolderPlus,
	FolderSearch,
	Loader2,
	Lock,
	Pin,
	PinOff,
	Plus,
	Trash2,
	Workflow,
	X,
} from "lucide-react";
import type { AgentProfile, BootstrapData, PiboRoom, PiboSignalStatusSnapshot, PiboWebSessionNode } from "./types";
import { ActionMenu, ActionMenuItem } from "./action-menu";
import { getSessionPage } from "./api-chat-sessions";
import { appendSessionRoots } from "./app-navigation-merge";
import { readStoredNewSessionProfile } from "./app-storage";
import { copyTextToClipboard } from "./clipboard";
import { FolderPickerDialog } from "./components/FolderPickerDialog";
import { SessionNode } from "./session-node";
import type { OptimisticSessionTitleIntent } from "./optimistic-session-title";
import {
	SESSION_FOLDER_PAGE_SIZE,
	SESSION_FOLDER_PREVIEW_LIMIT,
	applyFolderStatusOverlay,
	expandRoomInFolder,
	filterFolderSessions,
	isRoomExpandedInFolder,
	readSessionFolderState,
	toggleRoomExpandedInFolder,
	writeSessionFolderState,
} from "./session-folder-model";
import {
	findRoomById,
	findSharedDefaultRoom,
	isArchivedRoom,
	isPinnedRoom,
	isSharedDefaultRoom,
	roomNodeTooltip,
	splitRoomNodes,
} from "./session-sidebar-helpers";

const SESSION_INFINITE_SCROLL_ROOT_MARGIN = "240px 0px";

// Chat route transitions can remount the sidebar while the page stays open.
// Retain viewport state for the lifetime of this browser page.
const retainedSessionScrollTopByKey = new Map<string, number>();

const EMPTY_FOREIGN_SESSION_PATH_IDS: ReadonlySet<string> = new Set();

// Selected sessions bleed left to the folder guide line (folder ml-8 minus 20px).
// Rows are full width, so no right bleed is needed and content never shifts.
const FOLDER_SESSION_SELECTION_BLEED_LEFT = 20;

// Stale-while-revalidate cache for foreign room sessions: re-expanding a room
// (or switching back to it) renders instantly with no skeleton flash, while a
// silent background refresh keeps the data fresh.
type ForeignRoomSessionsCacheEntry = {
	sessions: PiboWebSessionNode[];
	nextCursor: string | undefined;
	totalCount: number | undefined;
	loadedCount: number;
	visibleCount: number;
};
const foreignRoomSessionsCache = new Map<string, ForeignRoomSessionsCacheEntry>();

type RoomSessionActions = {
	agents: AgentProfile[];
	defaultProfile: string;
	disabled: boolean;
	showArchived: boolean;
	archivedLoading: boolean;
	onCreateSession: (roomId: string, profile: string) => void | Promise<void>;
	onNewSessionProfileChange: (profile: string, roomId: string) => void;
	onCreateWorkflowSession: () => void;
	onToggleArchivedSessions: () => void | Promise<void>;
};

type RoomFolderToggle = {
	expanded: boolean;
	onToggle: (roomId: string) => void;
};

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
	visible?: boolean;
	bootstrap: BootstrapData;
	selectedRoomId: string | null;
	selectedPiboSessionId: string | null;
	showArchivedRooms: boolean;
	onToggleArchivedRooms: () => void;
	creatingRoom: boolean;
	onCreateRoom: () => void | Promise<void>;
	onSelectRoom: (roomId: string) => void | Promise<void>;
	loadingRoomId?: string | null;
	roomSessionsLoading?: boolean;
	onUpdateRoom: (roomId: string, input: RoomUpdateInput) => void | Promise<void>;
	onArchiveRoom: (roomId: string, archived: boolean) => void | Promise<void>;
	onPinnedRoomChange?: (roomId: string, pinned: boolean) => void | Promise<void>;
	onReorderRoom?: (roomId: string, targetRoomId: string, position: "before" | "after") => void | Promise<void>;
	onReadAllRoom: (roomId: string) => void | Promise<void>;
	onDeleteRoom: (room: PiboRoom) => void;
	newSessionProfile: string;
	newSessionProfileReady: boolean;
	onNewSessionProfileChange: (profile: string, roomId: string) => void;
	selectedRoomArchived: boolean;
	creatingSession: boolean;
	onCreateSession: (roomId: string, profile: string) => void | Promise<void>;
	onCreateWorkflowSession: () => void;
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
	onSelectSession: (piboSessionId: string, roomId?: string) => void | Promise<void>;
	globalSessionStatusSnapshot?: PiboSignalStatusSnapshot | null;
	onRenameSession: (piboSessionId: string, title: string | null) => void | Promise<void>;
	onArchiveSession: (piboSessionId: string, archived: boolean) => void | Promise<void>;
	onPinnedSessionChange: (piboSessionId: string, pinned: boolean) => void | Promise<void>;
	onReorderSession: (piboSessionId: string, targetPiboSessionId: string, position: "before" | "after") => void | Promise<void>;
	onDeleteSession: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
	loadingPiboSessionId?: string | null;
	optimisticTitleIntents?: Readonly<Record<string, OptimisticSessionTitleIntent>>;
	onOptimisticTitleDraftChange?: (operationId: string, draftTitle: string) => void;
	onOptimisticTitleConfirm?: (operationId: string) => void;
	onOptimisticTitleCancel?: (operationId: string) => void;
};

export function SessionSidebar({
	visible = true,
	bootstrap,
	selectedRoomId,
	selectedPiboSessionId,
	showArchivedRooms,
	onToggleArchivedRooms,
	creatingRoom,
	onCreateRoom,
	onSelectRoom,
	loadingRoomId,
	roomSessionsLoading = false,
	onUpdateRoom,
	onArchiveRoom,
	onPinnedRoomChange,
	onReorderRoom,
	onReadAllRoom,
	onDeleteRoom,
	newSessionProfile,
	newSessionProfileReady,
	onNewSessionProfileChange,
	selectedRoomArchived,
	creatingSession,
	onCreateSession,
	onCreateWorkflowSession,
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
	globalSessionStatusSnapshot = null,
	onRenameSession,
	onArchiveSession,
	onPinnedSessionChange,
	onReorderSession,
	onDeleteSession,
	onViewContext,
	loadingPiboSessionId,
	optimisticTitleIntents = {},
	onOptimisticTitleDraftChange = () => undefined,
	onOptimisticTitleConfirm = () => undefined,
	onOptimisticTitleCancel = () => undefined,
}: SessionSidebarProps) {
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const newSessionProfileOptions = bootstrap.agents;
	const sharedDefaultRoom = findSharedDefaultRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);
	const folderRooms = sharedDefaultRoom ? [{ ...sharedDefaultRoom, children: [] }, ...roomGroups.active] : roomGroups.active;
	const activeRoomId = selectedRoomId ?? bootstrap.selectedRoomId ?? null;
	const selectedSessionRoomId = selectedPiboSessionId ? activeRoomId : null;
	const [folderState, setFolderState] = useState(() => expandRoomInFolder(readSessionFolderState(), activeRoomId));
	const pinnedSessionsOnly = folderState.pinnedSessionsOnly;
	const toggleFolderRoomExpanded = useCallback((roomId: string) => {
		setFolderState((current) => toggleRoomExpandedInFolder(current, roomId));
	}, []);
	useEffect(() => {
		writeSessionFolderState(folderState);
	}, [folderState]);
	useEffect(() => {
		setFolderState((current) => expandRoomInFolder(current, activeRoomId));
	}, [activeRoomId]);
	const sessionScrollTopByKeyRef = useRef(retainedSessionScrollTopByKey);
	const sessionScrollKey = (selectedRoomId ?? bootstrap.selectedRoomId ?? "none") + ":" + (showArchived ? "archived" : "active");
	const activeSessionScrollKeyRef = useRef(sessionScrollKey);
	const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);
	const [roomDropIndicator, setRoomDropIndicator] = useState<{ targetRoomId: string; position: "before" | "after" } | null>(null);
	const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
	const [dropIndicator, setDropIndicator] = useState<{ targetPiboSessionId: string; position: "before" | "after" } | null>(null);
	const sharedFolderOffset = sharedDefaultRoom ? 1 : 0;
	const firstUnpinnedRoomIndex = folderRooms.findIndex((room, index) => index >= sharedFolderOffset && !isPinnedRoom(room));
	const folderActiveSessions = useMemo(
		() => filterFolderSessions(visibleActiveSessions, pinnedSessionsOnly),
		[visibleActiveSessions, pinnedSessionsOnly],
	);
	const firstUnpinnedSessionIndex = folderActiveSessions.findIndex((session) => !session.pinned);
	const selectedRoomVisibleInTree = !activeRoomId
		|| Boolean(findRoomById(folderRooms, activeRoomId))
		|| (showArchivedRooms && Boolean(findRoomById(roomGroups.archived, activeRoomId)));

	useLayoutEffect(() => {
		activeSessionScrollKeyRef.current = sessionScrollKey;
		if (!visible) return;
		const scrollTop = sessionScrollTopByKeyRef.current.get(sessionScrollKey) ?? 0;
		if (sessionListScrollRef.current) sessionListScrollRef.current.scrollTop = scrollTop;
	}, [
		visible,
		sessionScrollKey,
		roomSessionsLoading,
		sessionListScrollRef,
	]);

	const sessionActionsForRoom = (room: PiboRoom): RoomSessionActions => ({
		agents: newSessionProfileOptions,
		defaultProfile: room.id === activeRoomId ? newSessionProfile : readStoredNewSessionProfile(room.id),
		disabled: !newSessionProfileReady || !newSessionProfileOptions.length || creatingSession || creatingRoom || isArchivedRoom(room) || roomSessionsLoading,
		showArchived,
		archivedLoading: loadingArchivedSessions,
		onCreateSession,
		onNewSessionProfileChange,
		onCreateWorkflowSession,
		onToggleArchivedSessions,
	});

	const handleTreeScroll = (event: React.UIEvent<HTMLDivElement>) => {
		if (visible && !roomSessionsLoading) sessionScrollTopByKeyRef.current.set(activeSessionScrollKeyRef.current, event.currentTarget.scrollTop);
	};

	const renderSelectedRoomSessions = (selectionBleedLeft = FOLDER_SESSION_SELECTION_BLEED_LEFT) => (
		<>
			<div>
			{roomSessionsLoading ? (
				<RoomSessionsLoadingSkeleton />
			) : (
				<>
			{folderActiveSessions.map((session, index) => {
				const showPinnedDivider = firstUnpinnedSessionIndex > 0 && index === firstUnpinnedSessionIndex;
				const indicator = dropIndicator?.targetPiboSessionId === session.piboSessionId ? dropIndicator.position : null;
				const optimisticTitleIntent = optimisticTitleIntents[session.piboSessionId];
				const pendingCreation = optimisticTitleIntent?.createStatus === "pending";
				return (
					<div key={optimisticTitleIntent?.operationId ?? session.piboSessionId}>
						{showPinnedDivider ? <div data-pibo-debug="pinned-session-divider" className="mx-2 my-1 border-t border-slate-700/80" aria-hidden="true" /> : null}
						<SessionNode
							node={session}
							signalNow={signalNow}
							selectedPiboSessionId={selectedPiboSessionId}
							selectedSessionPathIds={selectedSessionPathIds}
							onSelect={(piboSessionId) => void onSelectSession(piboSessionId)}
							onRename={(piboSessionId, title) => void onRenameSession(piboSessionId, title)}
							onArchive={(piboSessionId, archived) => void onArchiveSession(piboSessionId, archived)}
							onPinnedChange={(piboSessionId, pinned) => void onPinnedSessionChange(piboSessionId, pinned)}
							onDelete={onDeleteSession}
							onViewContext={onViewContext}
							loadingPiboSessionId={loadingPiboSessionId}
							selectionBleedLeft={selectionBleedLeft}
							mutationsDisabled={pendingCreation}
							optimisticTitleIntent={optimisticTitleIntent}
							onOptimisticTitleDraftChange={onOptimisticTitleDraftChange}
							onOptimisticTitleConfirm={onOptimisticTitleConfirm}
							onOptimisticTitleCancel={onOptimisticTitleCancel}
							draggable={!selectedRoomArchived && !pendingCreation}
							dropPosition={indicator}
							onSessionDragStart={(event) => {
								setDraggedSessionId(session.piboSessionId);
								setDropIndicator(null);
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/pibo-session-id", session.piboSessionId);
							}}
							onSessionDragOver={(event) => {
								const dragged = visibleActiveSessions.find((candidate) => candidate.piboSessionId === draggedSessionId);
								if (!dragged || dragged.piboSessionId === session.piboSessionId || Boolean(dragged.pinned) !== Boolean(session.pinned)) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								const bounds = event.currentTarget.getBoundingClientRect();
								setDropIndicator({
									targetPiboSessionId: session.piboSessionId,
									position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
								});
							}}
							onSessionDrop={(event) => {
								event.preventDefault();
								if (draggedSessionId && dropIndicator?.targetPiboSessionId === session.piboSessionId) {
									void onReorderSession(draggedSessionId, session.piboSessionId, dropIndicator.position);
								}
								setDraggedSessionId(null);
								setDropIndicator(null);
							}}
							onSessionDragEnd={() => {
								setDraggedSessionId(null);
								setDropIndicator(null);
							}}
						/>
					</div>
				);
			})}
			{folderActiveSessions.length === 0 && !hasMoreActiveSessions ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">{pinnedSessionsOnly && totalActiveSessionCount > 0 ? "No pinned sessions" : "No active sessions"}</div> : null}
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
					<div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3 flex items-center gap-2">
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
							selectionBleedLeft={selectionBleedLeft}
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
				) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3">No archived sessions</div>}
			</div>
		) : null}
				</>
			)}
			</div>
		</>
	);

	const renderRoomFolderSessions = (room: PiboRoom) => {
		// During room navigation keep the foreign (cached) list instead of flashing the
		// skeleton: the clicked room stays visually stable and flips to the props-driven
		// list once the new data has arrived. Uncached rooms keep the skeleton.
		if (room.id === activeRoomId && (!roomSessionsLoading || !foreignRoomSessionsCache.has(room.id))) return renderSelectedRoomSessions();
		return (
			<ForeignRoomFolderSessions
				key={room.id}
				roomId={room.id}
				rooms={bootstrap.rooms}
				pinnedSessionsOnly={pinnedSessionsOnly}
				selectedPiboSessionId={selectedPiboSessionId}
				signalNow={signalNow}
				loadingPiboSessionId={loadingPiboSessionId}
				globalSessionStatusSnapshot={globalSessionStatusSnapshot}
				onSelectSession={onSelectSession}
				onRenameSession={onRenameSession}
				onArchiveSession={onArchiveSession}
				onPinnedSessionChange={onPinnedSessionChange}
				onDeleteSession={onDeleteSession}
				onViewContext={onViewContext}
			/>
		);
	};

	const renderNestedRoomFolder = (child: PiboRoom, depth: number) => (
		<RoomFolderBranch
			key={child.id}
			room={child}
			expanded={isRoomExpandedInFolder(folderState, child.id)}
			header={
				<RoomNode
					room={child}
					selectedRoomId={selectedRoomId}
					selectedSessionRoomId={selectedSessionRoomId}
					loadingRoomId={loadingRoomId}
					onSelect={(roomId) => void onSelectRoom(roomId)}
					onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
					onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
					onReadAll={(roomId) => void onReadAllRoom(roomId)}
					onDelete={onDeleteRoom}
					depth={depth}
					renderNestedRoom={renderNestedRoomFolder}
					folderToggle={{ expanded: isRoomExpandedInFolder(folderState, child.id), onToggle: toggleFolderRoomExpanded }}
					sessionActions={sessionActionsForRoom(child)}
				/>
			}
		>
			{renderRoomFolderSessions(child)}
		</RoomFolderBranch>
	);

	return (
		<div
			data-pibo-debug="session-list"
			data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
			data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
			data-pibo-state={showArchived ? "archived-visible" : "active-only"}
			className="min-h-0 flex-1 overflow-hidden py-2 flex flex-col gap-3"
		>
			{roomsSupported ? (
				<>
					<div className="shrink-0 flex items-center justify-between gap-2 px-3 pb-1">
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
								aria-label="Archived Rooms"
								aria-pressed={showArchivedRooms}
								className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedRooms ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
							>
								{showArchivedRooms ? <ArchiveRestore size={14} /> : <Archive size={14} />}
							</button>
							<button
								type="button"
								onClick={() => setFolderState((current) => ({ ...current, pinnedSessionsOnly: !current.pinnedSessionsOnly }))}
								title={pinnedSessionsOnly ? "Show all sessions" : "Show pinned sessions only"}
								aria-label="Pinned sessions only"
								aria-pressed={pinnedSessionsOnly}
								className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${pinnedSessionsOnly ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
							>
								<Pin size={14} />
							</button>
						</div>
					</div>
					<div
						ref={sessionListScrollRef}
						data-pibo-debug="session-scroll-region"
						data-pibo-scroll-key={sessionScrollKey}
						className="min-h-0 flex-1 overflow-y-auto"
						onScroll={handleTreeScroll}
					>
						{folderRooms.map((room, index) => {
							const showPinnedDivider = firstUnpinnedRoomIndex > sharedFolderOffset && index === firstUnpinnedRoomIndex;
							const indicator = roomDropIndicator?.targetRoomId === room.id ? roomDropIndicator.position : null;
							return (
								<div key={room.id}>
									{showPinnedDivider ? <div data-pibo-debug="pinned-room-divider" className="mx-2 my-1 border-t border-slate-700/80" aria-hidden="true" /> : null}
									<RoomFolderBranch
										room={room}
										expanded={isRoomExpandedInFolder(folderState, room.id)}
										header={
											<RoomNode
												room={room}
												selectedRoomId={selectedRoomId}
												selectedSessionRoomId={selectedSessionRoomId}
												loadingRoomId={loadingRoomId}
												onSelect={(roomId) => void onSelectRoom(roomId)}
												onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
												onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
												onPinnedChange={onPinnedRoomChange ? (roomId, pinned) => void onPinnedRoomChange(roomId, pinned) : undefined}
												onReadAll={(roomId) => void onReadAllRoom(roomId)}
												onDelete={onDeleteRoom}
												draggable={room.id !== sharedDefaultRoom?.id && Boolean(onReorderRoom)}
												dropPosition={indicator}
												onRoomDragStart={(event) => {
													setDraggedRoomId(room.id);
													setRoomDropIndicator(null);
													event.dataTransfer.effectAllowed = "move";
													event.dataTransfer.setData("text/pibo-room-id", room.id);
												}}
												onRoomDragOver={(event) => {
													const dragged = folderRooms.find((candidate) => candidate.id === draggedRoomId);
													if (!dragged || dragged.id === room.id || isPinnedRoom(dragged) !== isPinnedRoom(room)) return;
													event.preventDefault();
													event.dataTransfer.dropEffect = "move";
													const bounds = event.currentTarget.getBoundingClientRect();
													setRoomDropIndicator({
														targetRoomId: room.id,
														position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
													});
												}}
												onRoomDrop={(event) => {
													event.preventDefault();
													if (draggedRoomId && roomDropIndicator?.targetRoomId === room.id) {
														void onReorderRoom?.(draggedRoomId, room.id, roomDropIndicator.position);
													}
													setDraggedRoomId(null);
													setRoomDropIndicator(null);
												}}
												onRoomDragEnd={() => {
													setDraggedRoomId(null);
													setRoomDropIndicator(null);
												}}
												renderNestedRoom={renderNestedRoomFolder}
												folderToggle={{ expanded: isRoomExpandedInFolder(folderState, room.id), onToggle: toggleFolderRoomExpanded }}
												sessionActions={sessionActionsForRoom(room)}
											/>
										}
									>
										{renderRoomFolderSessions(room)}
									</RoomFolderBranch>
								</div>
							);
						})}
						{folderRooms.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No rooms</div> : null}
						{showArchivedRooms ? (
							<div className="mt-3">
								<div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Rooms</div>
								{roomGroups.archived.length ? (
									<ArchivedRoomsList
										rooms={roomGroups.archived}
										selectedRoomId={selectedRoomId}
										selectedSessionRoomId={selectedSessionRoomId}
										loadingRoomId={loadingRoomId}
										onSelect={(roomId) => void onSelectRoom(roomId)}
										onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
										onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
										onReadAll={(roomId) => void onReadAllRoom(roomId)}
										onDelete={onDeleteRoom}
									/>
								) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3">No archived rooms</div>}
							</div>
						) : null}
						{roomsSupported && activeRoomId && !selectedRoomVisibleInTree ? (
							<div className="mt-3 border-t border-slate-700/80 pt-3">
								{renderSelectedRoomSessions(0)}
							</div>
						) : null}
					</div>
				</>
			) : (
				<div
					ref={sessionListScrollRef}
					data-pibo-debug="session-scroll-region"
					data-pibo-scroll-key={sessionScrollKey}
					className="min-h-0 flex-1 overflow-y-auto"
					onScroll={handleTreeScroll}
				>
					{renderSelectedRoomSessions(0)}
				</div>
			)}
		</div>
	);
}

function ArchivedRoomsList({
	rooms,
	selectedRoomId,
	selectedSessionRoomId,
	loadingRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onReadAll,
	onDelete,
}: {
	rooms: PiboRoom[];
	selectedRoomId: string | null;
	selectedSessionRoomId?: string | null;
	loadingRoomId?: string | null;
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
					selectedSessionRoomId={selectedSessionRoomId}
					loadingRoomId={loadingRoomId}
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

function RoomSessionsLoadingSkeleton() {
	const rows = [0, 1, 2, 3, 4];
	return (
		<div
			data-pibo-debug="room-sessions-loading"
			className="space-y-0.5"
			aria-live="polite"
			aria-label="Loading room sessions"
		>
			{rows.map((row) => (
				<div
					key={row}
					className={`h-7 max-[980px]:h-8 w-full grid grid-cols-[1fr_auto] gap-1 items-center border rounded-sm animate-pulse ${
						row === 0 ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
					}`}
					style={{ paddingLeft: 8 }}
					aria-hidden="true"
				>
					<div className="min-w-0 h-full grid grid-cols-[1fr_auto] gap-2 items-center pr-0.5">
						<span className={`block h-3 min-w-0 rounded-sm ${row === 0 ? "w-44 bg-slate-300/75" : row % 2 === 0 ? "w-40 bg-slate-400/35" : "w-36 bg-slate-400/30"}`} />
						<span className={`h-2 w-2 rounded-full ${row === 0 ? "bg-[#11a4d4]" : row % 2 === 0 ? "bg-slate-600" : "bg-[#11a4d4]/55"}`} />
					</div>
					<span className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8" />
				</div>
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
	selectionBleedLeft,
	autoRenameSessionId,
	onAutoRenameConsumed,
}: {
	selectionBleedLeft: number;
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
					selectionBleedLeft={selectionBleedLeft}
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
	loadingRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onPinnedChange,
	onReadAll,
	onDelete,
	depth = 0,
	draggable = false,
	dropPosition = null,
	onRoomDragStart,
	onRoomDragOver,
	onRoomDrop,
	onRoomDragEnd,
	renderNestedRoom,
	folderToggle,
	sessionActions,
	selectedSessionRoomId,
}: {
	room: PiboRoom;
	selectedRoomId: string | null;
	loadingRoomId?: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => void;
	onArchive: (roomId: string, archived: boolean) => void;
	onPinnedChange?: (roomId: string, pinned: boolean) => void;
	onReadAll: (roomId: string) => void;
	onDelete: (room: PiboRoom) => void;
	depth?: number;
	draggable?: boolean;
	dropPosition?: "before" | "after" | null;
	onRoomDragStart?: DragEventHandler<HTMLDivElement>;
	onRoomDragOver?: DragEventHandler<HTMLDivElement>;
	onRoomDrop?: DragEventHandler<HTMLDivElement>;
	onRoomDragEnd?: DragEventHandler<HTMLDivElement>;
	renderNestedRoom?: (room: PiboRoom, depth: number) => ReactNode;
	folderToggle?: RoomFolderToggle;
	sessionActions?: RoomSessionActions;
	selectedSessionRoomId?: string | null;
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");
	const [draftWorkspace, setDraftWorkspace] = useState(room.workspace ?? "");
	const [pickerOpen, setPickerOpen] = useState(false);
	const personal = isSharedDefaultRoom(room);
	const archived = isArchivedRoom(room);
	const pinned = isPinnedRoom(room);
	const loading = room.id === loadingRoomId;
	const roomTooltip = roomNodeTooltip(room);
	const pinActionAvailable = depth === 0 && !personal && !archived && Boolean(onPinnedChange);
	const selected = room.id === selectedRoomId;
	const selectedSessionActions = selected ? sessionActions : undefined;
	const hasSelectedSession = selectedSessionRoomId === room.id;
	const roomIconTileClassName = `h-5 w-5 inline-flex items-center justify-center rounded-sm border ${personal
		? `${hasSelectedSession ? "border-[#0bda57]" : "border-transparent"} bg-[#151f24] text-[#0bda57]`
		: archived
			? `${hasSelectedSession ? "border-[#f59e0b]" : "border-transparent"} bg-[#f59e0b]/15 text-[#f59e0b]`
			: `${hasSelectedSession ? "border-[#11a4d4] text-[#11a4d4]" : "border-transparent text-slate-500"} bg-[#151f24]`}`;

	const copyRoomId = () => {
		void copyTextToClipboard(room.id).catch(() => undefined);
	};

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
				data-pibo-debug="room-node"
				data-pibo-room-id={room.id}
				data-pibo-state={loading ? "loading" : room.id === selectedRoomId ? "selected" : archived ? "archived" : "idle"}
				data-pibo-pinned={pinned ? "true" : "false"}
				draggable={draggable}
				onDragStart={onRoomDragStart}
				onDragOver={onRoomDragOver}
				onDrop={onRoomDrop}
				onDragEnd={onRoomDragEnd}
				className={`group relative mb-0.5 border border-transparent rounded-sm flex items-center pl-2 pr-3 ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
				style={{ marginLeft: depth * 12 }}
				title={roomTooltip}
			>
				{dropPosition === "before" ? <span className="pointer-events-none absolute inset-x-1 -top-px z-10 h-px bg-[#11a4d4]" /> : null}
				{folderToggle ? (
					<button
						type="button"
						data-pibo-debug="room-folder-toggle"
						onClick={(event) => {
							event.stopPropagation();
							folderToggle.onToggle(room.id);
						}}
						aria-expanded={folderToggle.expanded}
						aria-label={folderToggle.expanded ? `Collapse room ${room.name}` : `Expand room ${room.name}`}
						title={folderToggle.expanded ? "Collapse room" : "Expand room"}
						className="ml-0.5 h-7 w-5 shrink-0 inline-flex items-center justify-center rounded-sm text-slate-500 hover:text-[#11a4d4]"
					>
						<span className={roomIconTileClassName}>
							{personal ? <Lock size={12} /> : archived ? <Archive size={12} /> : folderToggle.expanded ? <FolderOpen size={12} /> : <FolderPlus size={12} />}
						</span>
					</button>
				) : null}
				{editing && !personal ? (
					<form
						className="grid gap-1 p-1 flex-1 min-w-0"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<input
							value={draftName}
							aria-label={`Room name for ${room.name}`}
							onChange={(event) => setDraftName(event.target.value)}
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
							autoFocus
						/>
						<input
							value={draftTopic}
							aria-label={`Room topic for ${room.name}`}
							onChange={(event) => setDraftTopic(event.target.value)}
							placeholder="Topic"
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs outline-none focus:border-[#11a4d4]"
						/>
						<div className="flex min-w-0 gap-1">
							<input
								value={draftWorkspace}
								aria-label={`Room workspace for ${room.name}`}
								onChange={(event) => setDraftWorkspace(event.target.value)}
								placeholder="Workspace (/absolute/path)"
								className="min-w-0 flex-1 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-xs font-mono outline-none focus:border-[#11a4d4]"
							/>
							<button
								type="button"
								onClick={() => setPickerOpen(true)}
								title="Projektordner auswählen"
								aria-label={`Projektordner für ${room.name} auswählen`}
								className="h-7 w-7 shrink-0 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<FolderSearch size={13} />
							</button>
						</div>
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
					<div className={`grid flex-1 min-w-0 items-center gap-0.5 pr-0.5 ${sessionActions ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"}`}>
						<button
							type="button"
							onClick={() => (folderToggle ? folderToggle.onToggle(room.id) : onSelect(room.id))}
							aria-current={room.id === selectedRoomId ? "page" : undefined}
							className="h-7 max-[980px]:h-8 min-w-0 text-left px-1 flex gap-1.5 items-center"
						>
							{folderToggle ? null : (
								<span className={`${roomIconTileClassName} shrink-0`}>
									{personal ? <Lock size={12} /> : archived ? <Archive size={12} /> : <FolderPlus size={12} />}
								</span>
							)}
							{pinned && !archived ? (
								<span className="shrink-0 text-[#11a4d4]" title="Pinned room" aria-label="Pinned room">
									<Pin size={11} fill="currentColor" aria-hidden="true" />
								</span>
							) : null}
							<span className={`min-w-0 flex-1 truncate text-[13px] leading-none ${archived ? "text-slate-500" : "text-slate-200"}`}>{room.name}</span>
							<span className="ml-auto inline-flex items-center justify-end gap-1">
								{loading ? <Loader2 size={12} className="animate-spin text-[#11a4d4]" aria-label="Loading room" /> : null}
								<UnreadBadge count={room.unreadCount} />
							</span>
						</button>
						{sessionActions ? (
							<ActionMenu
								label={`New session in ${room.name}`}
								triggerIcon={<Plus size={14} />}
								estimatedHeight={sessionActions.agents.length * 40 + 8}
								disabled={sessionActions.disabled}
							>
								{sessionActions.agents.map((agent) => (
									<ActionMenuItem
										key={agent.name}
										onSelect={() => {
											sessionActions.onNewSessionProfileChange(agent.name, room.id);
											void sessionActions.onCreateSession(room.id, agent.name);
										}}
									>
										<span className="w-4 shrink-0 inline-flex items-center justify-center text-[#11a4d4]">
											{agent.name === sessionActions.defaultProfile ? <Check size={14} aria-label="Default agent" /> : null}
										</span>
										<span className="truncate" title={agent.description ?? agent.name}>{agent.name}</span>
									</ActionMenuItem>
								))}
							</ActionMenu>
						) : null}
						<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
							{personal ? (
								<ActionMenu label={`Actions for room ${room.name}`} estimatedHeight={selectedSessionActions ? 144 : 48}>
									{selectedSessionActions && (
										<>
											<ActionMenuItem onSelect={selectedSessionActions.onCreateWorkflowSession}>
												<Workflow size={16} /> New Workflow Session
											</ActionMenuItem>
											<ActionMenuItem
												onSelect={() => void selectedSessionActions.onToggleArchivedSessions()}
												disabled={selectedSessionActions.archivedLoading}
											>
												{selectedSessionActions.showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{" "}
												{selectedSessionActions.showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
											</ActionMenuItem>
										</>
									)}
									<ActionMenuItem onSelect={() => onReadAll(room.id)}>
										<CheckCheck size={16} /> Read All
									</ActionMenuItem>
								</ActionMenu>
							) : (
								<ActionMenu label={`Actions for room ${room.name}`} estimatedHeight={(archived ? 144 : pinActionAvailable ? 240 : 192) + (selectedSessionActions && !archived ? 96 : 0)}>
									{archived ? (
										<>
											<ActionMenuItem onSelect={copyRoomId}>
												<Copy size={16} /> Copy Room ID
											</ActionMenuItem>
											<ActionMenuItem onSelect={() => onArchive(room.id, false)}>
												<ArchiveRestore size={16} /> Restore Room
											</ActionMenuItem>
											<ActionMenuItem onSelect={() => onDelete(room)} className="text-red-300 hover:bg-red-500/10">
												<Trash2 size={16} /> Delete Room
											</ActionMenuItem>
										</>
									) : (
										<>
											{selectedSessionActions && (
												<>
													<ActionMenuItem onSelect={selectedSessionActions.onCreateWorkflowSession}>
														<Workflow size={16} /> New Workflow Session
													</ActionMenuItem>
													<ActionMenuItem
														onSelect={() => void selectedSessionActions.onToggleArchivedSessions()}
														disabled={selectedSessionActions.archivedLoading}
													>
														{selectedSessionActions.showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{" "}
														{selectedSessionActions.showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
													</ActionMenuItem>
												</>
											)}
											{pinActionAvailable ? (
												<ActionMenuItem onSelect={() => onPinnedChange?.(room.id, !pinned)}>
													{pinned ? <PinOff size={16} /> : <Pin size={16} />} {pinned ? "Unpin Room" : "Pin Room"}
												</ActionMenuItem>
											) : null}
											<ActionMenuItem onSelect={copyRoomId}>
												<Copy size={16} /> Copy Room ID
											</ActionMenuItem>
											<ActionMenuItem onSelect={() => setEditing(true)}>
												<Edit3 size={16} /> Edit Room
											</ActionMenuItem>
											<ActionMenuItem onSelect={() => onReadAll(room.id)}>
												<CheckCheck size={16} /> Read All
											</ActionMenuItem>
											<ActionMenuItem onSelect={() => onArchive(room.id, true)}>
												<Archive size={16} /> Archive Room
											</ActionMenuItem>
										</>
									)}
								</ActionMenu>
							)}
						</div>
					</div>
				)}
				{dropPosition === "after" ? <span className="pointer-events-none absolute inset-x-1 -bottom-px z-10 h-px bg-[#11a4d4]" /> : null}
			</div>
			{(room.children ?? []).map((child) => renderNestedRoom
				? renderNestedRoom(child, depth + 1)
				: (
					<RoomNode
						key={child.id}
						room={child}
						selectedRoomId={selectedRoomId}
						selectedSessionRoomId={selectedSessionRoomId}
						loadingRoomId={loadingRoomId}
						onSelect={onSelect}
						onUpdate={onUpdate}
						onArchive={onArchive}
						onReadAll={onReadAll}
						onDelete={onDelete}
						depth={depth + 1}
					/>
				))}
			<FolderPickerDialog
				open={pickerOpen}
				initialPath={draftWorkspace}
				onSelect={(path) => setDraftWorkspace(path)}
				onClose={() => setPickerOpen(false)}
			/>
		</div>
	);
}

function RoomFolderBranch({
	room,
	expanded,
	header,
	children,
}: {
	room: PiboRoom;
	expanded: boolean;
	header: ReactNode;
	children: ReactNode;
}) {
	return (
		<div data-pibo-debug="room-folder" data-pibo-room-id={room.id} data-pibo-state={expanded ? "expanded" : "collapsed"}>
			{header}
			{expanded ? (
				<div data-pibo-debug="room-folder-sessions" className="relative ml-8">
					<span aria-hidden="true" className="pointer-events-none absolute -top-0.5 bottom-1 w-px bg-slate-600/45" style={{ left: -20 }} />
					{children}
				</div>
			) : null}
		</div>
	);
}

function ForeignRoomFolderSessions({
	roomId,
	rooms,
	pinnedSessionsOnly,
	selectedPiboSessionId,
	signalNow,
	loadingPiboSessionId,
	globalSessionStatusSnapshot,
	onSelectSession,
	onRenameSession,
	onArchiveSession,
	onPinnedSessionChange,
	onDeleteSession,
	onViewContext,
}: {
	roomId: string;
	rooms: PiboRoom[];
	pinnedSessionsOnly: boolean;
	selectedPiboSessionId: string | null;
	signalNow: number;
	loadingPiboSessionId?: string | null;
	globalSessionStatusSnapshot?: PiboSignalStatusSnapshot | null;
	onSelectSession: (piboSessionId: string, roomId?: string) => void | Promise<void>;
	onRenameSession: (piboSessionId: string, title: string | null) => void | Promise<void>;
	onArchiveSession: (piboSessionId: string, archived: boolean) => void | Promise<void>;
	onPinnedSessionChange: (piboSessionId: string, pinned: boolean) => void | Promise<void>;
	onDeleteSession: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
}) {
	const cachedForeignSessions = foreignRoomSessionsCache.get(roomId);
	const [sessions, setSessions] = useState<PiboWebSessionNode[]>(() => cachedForeignSessions?.sessions ?? []);
	const [nextCursor, setNextCursor] = useState<string | undefined>(() => cachedForeignSessions?.nextCursor);
	const [totalCount, setTotalCount] = useState<number | undefined>(() => cachedForeignSessions?.totalCount);
	const [loading, setLoading] = useState(() => !cachedForeignSessions);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [visibleCount, setVisibleCount] = useState(() => cachedForeignSessions?.visibleCount ?? SESSION_FOLDER_PREVIEW_LIMIT);
	const loadedCountRef = useRef(cachedForeignSessions?.loadedCount ?? 0);
	const pendingRef = useRef(false);

	const refreshRoomSessions = useCallback(async () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setLoading(true);
		setError(null);
		try {
			const page = await getSessionPage({ roomId, archived: false, limit: Math.max(loadedCountRef.current, SESSION_FOLDER_PAGE_SIZE) });
			loadedCountRef.current = page.sessions.length;
			setSessions(page.sessions);
			setNextCursor(page.nextCursor);
			setTotalCount(page.totalCount);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			pendingRef.current = false;
			setLoading(false);
		}
	}, [roomId]);

	// Refresh on mount/room change and when this room's own unread count changes.
	// Never on unrelated bootstrap updates (session switches, signals), which
	// otherwise refetch every expanded foreign room and reshuffle the sidebar.
	const foreignRoomUnreadCount = rooms.find((candidate) => candidate.id === roomId)?.unreadCount;
	useEffect(() => {
		void refreshRoomSessions();
	}, [refreshRoomSessions, foreignRoomUnreadCount]);
	useEffect(() => {
		if (loading && sessions.length === 0) return;
		foreignRoomSessionsCache.set(roomId, {
			sessions,
			nextCursor,
			totalCount,
			loadedCount: loadedCountRef.current,
			visibleCount,
		});
	}, [roomId, loading, sessions, nextCursor, totalCount, visibleCount]);

	const overlaidSessions = useMemo(
		() => applyFolderStatusOverlay(sessions, globalSessionStatusSnapshot),
		[sessions, globalSessionStatusSnapshot],
	);
	const filteredSessions = useMemo(
		() => filterFolderSessions(overlaidSessions, pinnedSessionsOnly),
		[overlaidSessions, pinnedSessionsOnly],
	);
	const visibleSessions = pinnedSessionsOnly ? filteredSessions : filteredSessions.slice(0, visibleCount);
	const hasMorePages = nextCursor != null || (totalCount != null && sessions.length < totalCount);
	const hasMore = pinnedSessionsOnly ? hasMorePages : visibleCount < filteredSessions.length || hasMorePages;
	const showMoreLabel = pinnedSessionsOnly || totalCount == null
		? "Show more"
		: `Show more (${visibleSessions.length} of ${totalCount})`;

	const showMoreSessions = () => {
		if (loadingMore || loading) return;
		if (!pinnedSessionsOnly && visibleCount < filteredSessions.length) {
			setVisibleCount((current) => current + SESSION_FOLDER_PAGE_SIZE);
			return;
		}
		if (!hasMorePages) return;
		const cursor = sessions.at(-1)?.piboSessionId;
		if (!cursor) return;
		setLoadingMore(true);
		setError(null);
		getSessionPage({ roomId, archived: false, cursor, limit: SESSION_FOLDER_PAGE_SIZE })
			.then((page) => {
				setSessions((current) => {
					const next = appendSessionRoots(current, page.sessions);
					loadedCountRef.current = next.length;
					return next;
				});
				setNextCursor(page.nextCursor);
				setTotalCount(page.totalCount);
				setVisibleCount((current) => current + SESSION_FOLDER_PAGE_SIZE);
			})
			.catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
			.finally(() => setLoadingMore(false));
	};

	const refreshAfterMutation = (mutation: void | Promise<void>) => {
		void Promise.resolve(mutation).then(() => refreshRoomSessions()).catch(() => undefined);
	};

	if (loading && sessions.length === 0) {
		return (
			<div data-pibo-debug="room-sessions-loading" role="status" aria-label="Loading room sessions" className="flex h-7 items-center px-2">
				<Loader2 size={13} className="text-slate-500 animate-spin" aria-hidden="true" />
			</div>
		);
	}
	if (error && sessions.length === 0) {
		return (
			<div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3 flex items-center justify-between gap-2">
				<span className="truncate">Couldn't load sessions</span>
				<button
					type="button"
					onClick={() => void refreshRoomSessions()}
					className="shrink-0 px-2 py-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
				>
					Retry
				</button>
			</div>
		);
	}
	return (
		<div>
			{error ? (
				<div className="mb-1 px-2 py-1.5 text-[11px] text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3 flex items-center justify-between gap-2">
					<span className="truncate">Couldn't refresh sessions</span>
					<button
						type="button"
						onClick={() => void refreshRoomSessions()}
						className="shrink-0 text-slate-400 hover:text-[#11a4d4]"
					>
						Retry
					</button>
				</div>
			) : null}
			{visibleSessions.map((session) => (
				<SessionNode
					key={session.piboSessionId}
					node={session}
					signalNow={signalNow}
					selectedPiboSessionId={selectedPiboSessionId}
					selectedSessionPathIds={EMPTY_FOREIGN_SESSION_PATH_IDS}
					onSelect={(piboSessionId) => void onSelectSession(piboSessionId, roomId)}
					onRename={(piboSessionId, title) => refreshAfterMutation(onRenameSession(piboSessionId, title))}
					onArchive={(piboSessionId, archived) => refreshAfterMutation(onArchiveSession(piboSessionId, archived))}
					onPinnedChange={(piboSessionId, pinned) => refreshAfterMutation(onPinnedSessionChange(piboSessionId, pinned))}
					onDelete={onDeleteSession}
					onViewContext={onViewContext}
					loadingPiboSessionId={loadingPiboSessionId}
					selectionBleedLeft={FOLDER_SESSION_SELECTION_BLEED_LEFT}
				/>
			))}
			{visibleSessions.length === 0 && !hasMore ? (
				<div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm mr-3">
					{pinnedSessionsOnly ? "No pinned sessions" : "No sessions"}
				</div>
			) : null}
			{hasMore ? (
				<button
					type="button"
					data-pibo-debug="room-folder-show-more"
					onClick={showMoreSessions}
					disabled={loadingMore}
					className="mt-1 w-full px-2 py-1.5 text-left text-[11px] text-slate-500 hover:text-[#11a4d4] disabled:opacity-60"
				>
					{loadingMore ? "Loading sessions…" : showMoreLabel}
				</button>
			) : null}
		</div>
	);
}
