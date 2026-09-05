import { useCallback, useEffect, useRef, useState, type DragEventHandler, type ReactNode, type RefObject } from "react";
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
	Pin,
	PinOff,
	Plus,
	Trash2,
	Workflow,
	X,
} from "lucide-react";
import type { BootstrapData, PiboRoom, PiboWebSessionNode } from "./types";
import { ActionMenu, ActionMenuItem } from "./action-menu";
import { copyTextToClipboard } from "./clipboard";
import { SessionNode } from "./session-node";
import {
	findSharedDefaultRoom,
	isArchivedRoom,
	isPinnedRoom,
	isSharedDefaultRoom,
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
	onNewSessionProfileChange: (profile: string) => void;
	selectedRoomArchived: boolean;
	creatingSession: boolean;
	onCreateSession: () => void | Promise<void>;
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
	onSelectSession: (piboSessionId: string) => void | Promise<void>;
	onRenameSession: (piboSessionId: string, title: string | null) => void | Promise<void>;
	onArchiveSession: (piboSessionId: string, archived: boolean) => void | Promise<void>;
	onPinnedSessionChange: (piboSessionId: string, pinned: boolean) => void | Promise<void>;
	onReorderSession: (piboSessionId: string, targetPiboSessionId: string, position: "before" | "after") => void | Promise<void>;
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
	onRenameSession,
	onArchiveSession,
	onPinnedSessionChange,
	onReorderSession,
	onDeleteSession,
	onViewContext,
	loadingPiboSessionId,
	autoRenameSessionId,
	onAutoRenameConsumed,
}: SessionSidebarProps) {
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const newSessionProfileOptions = bootstrap.agents;
	const sharedDefaultRoom = findSharedDefaultRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);
	const archivedSessionsToggleRef = useRef<HTMLButtonElement>(null);
	const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);
	const [roomDropIndicator, setRoomDropIndicator] = useState<{ targetRoomId: string; position: "before" | "after" } | null>(null);
	const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
	const [dropIndicator, setDropIndicator] = useState<{ targetPiboSessionId: string; position: "before" | "after" } | null>(null);
	const firstUnpinnedRoomIndex = roomGroups.active.findIndex((room) => !isPinnedRoom(room));
	const firstUnpinnedSessionIndex = visibleActiveSessions.findIndex((session) => !session.pinned);
	const handleToggleArchivedSessions = async () => {
		const restoreFocus = archivedSessionsToggleRef.current === document.activeElement;
		try {
			await onToggleArchivedSessions();
		} finally {
			requestAnimationFrame(() => {
				if (restoreFocus && document.activeElement === document.body) archivedSessionsToggleRef.current?.focus();
			});
		}
	};

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
					{sharedDefaultRoom ? (
							<div className="shrink-0">
								<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Shared Chat</div>
								<RoomNode
									room={sharedDefaultRoom}
									selectedRoomId={selectedRoomId}
									loadingRoomId={loadingRoomId}
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
									aria-label="Archived Rooms"
									aria-pressed={showArchivedRooms}
									className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedRooms ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
								>
									{showArchivedRooms ? <ArchiveRestore size={14} /> : <Archive size={14} />}
								</button>
							</div>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto pr-1">
						{roomGroups.active.map((room, index) => {
							const showPinnedDivider = firstUnpinnedRoomIndex > 0 && index === firstUnpinnedRoomIndex;
							const indicator = roomDropIndicator?.targetRoomId === room.id ? roomDropIndicator.position : null;
							return (
								<div key={room.id}>
									{showPinnedDivider ? <div data-pibo-debug="pinned-room-divider" className="mx-2 my-1 border-t border-slate-700/80" aria-hidden="true" /> : null}
									<RoomNode
										room={room}
										selectedRoomId={selectedRoomId}
										loadingRoomId={loadingRoomId}
										onSelect={(roomId) => void onSelectRoom(roomId)}
										onUpdate={(roomId, input) => void onUpdateRoom(roomId, input)}
										onArchive={(roomId, archived) => void onArchiveRoom(roomId, archived)}
										onPinnedChange={onPinnedRoomChange ? (roomId, pinned) => void onPinnedRoomChange(roomId, pinned) : undefined}
										onReadAll={(roomId) => void onReadAllRoom(roomId)}
										onDelete={onDeleteRoom}
										draggable={Boolean(onReorderRoom)}
										dropPosition={indicator}
										onRoomDragStart={(event) => {
											setDraggedRoomId(room.id);
											setRoomDropIndicator(null);
											event.dataTransfer.effectAllowed = "move";
											event.dataTransfer.setData("text/pibo-room-id", room.id);
										}}
										onRoomDragOver={(event) => {
											const dragged = roomGroups.active.find((candidate) => candidate.id === draggedRoomId);
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
									/>
								</div>
							);
						})}
						{roomGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No rooms</div> : null}
						{showArchivedRooms ? (
							<div className="mt-3">
								<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Rooms</div>
								{roomGroups.archived.length ? (
									<ArchivedRoomsList
										rooms={roomGroups.archived}
										selectedRoomId={selectedRoomId}
										loadingRoomId={loadingRoomId}
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
							id="new-session-agent-select"
							value={newSessionProfile}
							onChange={(event) => onNewSessionProfileChange(event.target.value)}
							disabled={!newSessionProfileReady || !newSessionProfileOptions.length || creatingRoom || selectedRoomArchived || roomSessionsLoading}
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
						<button type="button" onClick={onCreateWorkflowSession} disabled={creatingSession || creatingRoom || selectedRoomArchived || roomSessionsLoading} title="New Workflow Session" aria-label="New Workflow Session" className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"><Workflow size={14} /></button>
						<button
							data-pibo-debug="new-session-button"
							data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
							data-pibo-state={creatingSession ? "creating" : creatingRoom ? "room-creating" : roomSessionsLoading ? "room-loading" : !newSessionProfileReady ? "profile-loading" : selectedRoomArchived ? "archived-disabled" : "ready"}
							type="button"
							onClick={() => void onCreateSession()}
							disabled={!newSessionProfileReady || creatingSession || creatingRoom || selectedRoomArchived || roomSessionsLoading}
							title="New Session"
							aria-label="New Session"
							className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							<Plus size={14} />
						</button>
						<button
							type="button"
							ref={archivedSessionsToggleRef}
							onClick={() => void handleToggleArchivedSessions()}
							disabled={loadingArchivedSessions}
							title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
							aria-label="Archived Sessions"
							aria-pressed={showArchived}
							className={`h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-70 ${
								showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
							}`}
						>
							{loadingArchivedSessions ? <Loader2 size={14} className="animate-spin" /> : showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
						</button>
					</div>
				</div>
				<div ref={sessionListScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
				{roomSessionsLoading ? (
					<RoomSessionsLoadingSkeleton />
				) : (
					<>
				{visibleActiveSessions.map((session, index) => {
					const showPinnedDivider = firstUnpinnedSessionIndex > 0 && index === firstUnpinnedSessionIndex;
					const indicator = dropIndicator?.targetPiboSessionId === session.piboSessionId ? dropIndicator.position : null;
					return (
						<div key={session.piboSessionId}>
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
								autoRename={autoRenameSessionId === session.piboSessionId}
								onAutoRenameConsumed={() => onAutoRenameConsumed()}
								draggable={!selectedRoomArchived}
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
					</>
				)}
				</div>
			</div>
		</div>
	);
}

function ArchivedRoomsList({
	rooms,
	selectedRoomId,
	loadingRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onReadAll,
	onDelete,
}: {
	rooms: PiboRoom[];
	selectedRoomId: string | null;
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
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");
	const [draftWorkspace, setDraftWorkspace] = useState(room.workspace ?? "");
	const personal = isSharedDefaultRoom(room);
	const archived = isArchivedRoom(room);
	const pinned = isPinnedRoom(room);
	const loading = room.id === loadingRoomId;
	const roomTooltip = roomNodeTooltip(room);
	const pinActionAvailable = depth === 0 && !personal && !archived && Boolean(onPinnedChange);

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
				className={`group relative mb-0.5 border rounded-sm ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${
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
				{dropPosition === "before" ? <span className="pointer-events-none absolute inset-x-1 -top-px z-10 h-px bg-[#11a4d4]" /> : null}
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
						<input
							value={draftWorkspace}
							aria-label={`Room workspace for ${room.name}`}
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
					<div className="grid grid-cols-[1fr_auto] items-center gap-0.5 pr-0.5">
						<button
							type="button"
							onClick={() => onSelect(room.id)}
							aria-current={room.id === selectedRoomId ? "page" : undefined}
							className="h-7 max-[980px]:h-8 min-w-0 text-left px-1.5 flex gap-1.5 items-center"
						>
							<span className={`h-5 w-5 shrink-0 inline-flex items-center justify-center rounded-sm ${personal ? "bg-[#0bda57]/15 text-[#0bda57]" : archived ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#151f24] text-slate-500"}`}>
								{personal ? <Lock size={12} /> : archived ? <Archive size={12} /> : <FolderPlus size={12} />}
							</span>
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
						<div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
							{personal ? (
								<ActionMenu label={`Actions for room ${room.name}`} estimatedHeight={48}>
									<ActionMenuItem onSelect={() => onReadAll(room.id)}>
										<CheckCheck size={16} /> Read All
									</ActionMenuItem>
								</ActionMenu>
							) : (
								<ActionMenu label={`Actions for room ${room.name}`} estimatedHeight={archived ? 144 : pinActionAvailable ? 240 : 192}>
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
			{(room.children ?? []).map((child) => (
				<RoomNode
					key={child.id}
					room={child}
						selectedRoomId={selectedRoomId}
						loadingRoomId={loadingRoomId}
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
