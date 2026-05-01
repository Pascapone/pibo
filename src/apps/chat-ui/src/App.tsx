import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	Archive,
	ArchiveRestore,
	Brain,
	Bug,
	Check,
	ChevronsDown,
	ChevronsUp,
	Edit3,
	EyeOff,
	FolderPlus,
	Layers,
	LogOut,
	MessageSquarePlus,
	RefreshCw,
	Settings,
	SendHorizontal,
	UserRound,
	X,
} from "lucide-react";
import { getBootstrap, getTrace, patchRoom, patchSession, postAction, postMessage, postRoom, postSession, signInWithGoogle, signOut } from "./api";
import type { BootstrapData, PiboRoom, PiboSessionTraceView, PiboTraceNode, PiboWebSessionNode } from "./types";
import { adaptTrace } from "./tracing/adapt";
import { TraceTimeline } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";
import { countRender } from "./renderMetrics";

type Area = "sessions" | "agents" | "settings";

type ForkActionResponse = {
	result: {
		piboSessionId?: string;
		cancelled?: boolean;
		selectedText?: string;
	};
};

type LoadBootstrapOptions = {
	selectSession?: boolean;
};

const LAST_SELECTION_STORAGE_KEY = "pibo.chat.lastSelection";

type StoredSelection = {
	roomId?: string;
	piboSessionId?: string;
};

export function App() {
	countRender("App");
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [traceView, setTraceView] = useState<PiboSessionTraceView | null>(null);
	const [traceLoadingSessionId, setTraceLoadingSessionId] = useState<string | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [area, setArea] = useState<Area>("sessions");
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(() => localStorage.getItem("pibo.chat.showThinking") !== "false");
	const [expandThinking, setExpandThinking] = useState(() => localStorage.getItem("pibo.chat.expandThinking") !== "false");
	const [showRawEvents, setShowRawEvents] = useState(() => localStorage.getItem("pibo.chat.showRawEvents") === "true");
	const [showArchived, setShowArchived] = useState(() => localStorage.getItem("pibo.chat.showArchived") === "true");
	const [newSessionProfile, setNewSessionProfile] = useState(() => localStorage.getItem("pibo.chat.newSessionProfile") ?? "");
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const [creatingRoom, setCreatingRoom] = useState(false);
	const showArchivedRef = useRef(showArchived);
	const bootstrapRequestId = useRef(0);
	const traceRequestId = useRef(0);
	const selectedPiboSessionIdRef = useRef<string | null>(null);
	const traceViewSessionId = useRef<string | null>(null);
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);

	useEffect(() => {
		showArchivedRef.current = showArchived;
	}, [showArchived]);

	useEffect(() => {
		selectedPiboSessionIdRef.current = selectedPiboSessionId;
	}, [selectedPiboSessionId]);

	useEffect(() => {
		traceViewSessionId.current = traceView?.piboSessionId ?? null;
	}, [traceView?.piboSessionId]);

	const flushPendingStreamEvents = useCallback((piboSessionId: string) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId);
		if (!pending?.length) return;
		pendingStreamEventsBySession.current.delete(piboSessionId);
		setTraceView((current) => {
			if (current?.piboSessionId !== piboSessionId) return current;
			return applyChatStreamEvents(current, pending);
		});
	}, []);

	const schedulePendingStreamFlush = useCallback(() => {
		if (pendingStreamFrame.current !== undefined) return;
		pendingStreamFrame.current = requestAnimationFrame(() => {
			pendingStreamFrame.current = undefined;
			const piboSessionId = selectedPiboSessionIdRef.current;
			if (piboSessionId) flushPendingStreamEvents(piboSessionId);
		});
	}, [flushPendingStreamEvents]);

	const enqueueStreamEvent = useCallback(
		(piboSessionId: string, event: ChatStreamEvent, flushImmediately = false) => {
			const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
			pending.push(event);
			pendingStreamEventsBySession.current.set(piboSessionId, pending);
			if (flushImmediately) {
				flushPendingStreamEvents(piboSessionId);
			} else {
				schedulePendingStreamFlush();
			}
		},
		[flushPendingStreamEvents, schedulePendingStreamFlush],
	);

	useEffect(() => {
		return () => {
			if (pendingStreamFrame.current !== undefined) {
				cancelAnimationFrame(pendingStreamFrame.current);
			}
		};
	}, []);

	const loadBootstrap = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadBootstrapOptions = {},
	) => {
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await getBootstrap(piboSessionId, includeArchived, roomId);
		if (requestId !== bootstrapRequestId.current) return data;
		setBootstrap(data);
		if (options.selectSession !== false) setSelectedPiboSessionId(data.selectedPiboSessionId);
		setSelectedRoomId(data.selectedRoomId);
		return data;
	}, []);

	const loadTrace = useCallback(async (piboSessionId: string, options: { showLoading?: boolean } = {}) => {
		const requestId = traceRequestId.current + 1;
		traceRequestId.current = requestId;
		if (options.showLoading) setTraceLoadingSessionId(piboSessionId);
		try {
			const trace = await getTrace(piboSessionId);
			if (requestId !== traceRequestId.current) return;
			const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
			pendingStreamEventsBySession.current.delete(piboSessionId);
			setTraceView(applyChatStreamEvents(trace, pending));
		} finally {
			if (requestId === traceRequestId.current) {
				setTraceLoadingSessionId((current) => (current === piboSessionId ? null : current));
			}
		}
	}, []);

	useEffect(() => {
		const stored = readStoredSelection();
		loadBootstrap(stored.piboSessionId, showArchivedRef.current, stored.roomId).catch((caught) => {
			if (stored.piboSessionId && stored.roomId) {
				loadBootstrap(stored.piboSessionId, showArchivedRef.current).catch(() => {
					clearStoredSelection();
					loadBootstrap().catch((fallbackCaught) =>
						setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
					);
				});
				return;
			}
			if (!stored.piboSessionId && !stored.roomId) {
				setError(caught instanceof Error ? caught.message : String(caught));
				return;
			}
			clearStoredSelection();
			loadBootstrap().catch((fallbackCaught) =>
				setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
			);
		});
	}, [loadBootstrap]);

	useEffect(() => {
		if (!selectedRoomId && !selectedPiboSessionId) return;
		writeStoredSelection({
			roomId: selectedRoomId ?? undefined,
			piboSessionId: selectedPiboSessionId ?? undefined,
		});
	}, [selectedPiboSessionId, selectedRoomId]);

	useEffect(() => {
		if (!selectedPiboSessionId || area !== "sessions") return;
		setTraceView((current) => (current?.piboSessionId === selectedPiboSessionId ? current : null));
		loadTrace(selectedPiboSessionId, { showLoading: traceViewSessionId.current !== selectedPiboSessionId }).catch((caught) =>
			setError(caught instanceof Error ? caught.message : String(caught)),
		);
		const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
		if (selectedRoomId) params.set("roomId", selectedRoomId);
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		let traceTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleTraceRefresh = (delayMs: number) => {
			if (traceTimer) return;
			traceTimer = setTimeout(() => {
				traceTimer = undefined;
				loadTrace(selectedPiboSessionId).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
			}, delayMs);
		};
		const scheduleBootstrapRefresh = (delayMs: number) => {
			if (bootstrapTimer) return;
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined).catch((caught) =>
					setError(caught instanceof Error ? caught.message : String(caught)),
				);
			}, delayMs);
		};
		events.addEventListener("pibo", (message) => {
			const event = chatStreamEvent(message);
			if (!event) return;
			const flushImmediately = event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT";
			enqueueStreamEvent(selectedPiboSessionId, event, flushImmediately);
			if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
				scheduleTraceRefresh(0);
				scheduleBootstrapRefresh(0);
			} else if (event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT") {
				scheduleBootstrapRefresh(150);
			}
		});
		return () => {
			if (traceTimer) clearTimeout(traceTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			events.close();
		};
	}, [area, enqueueStreamEvent, loadBootstrap, loadTrace, selectedPiboSessionId, selectedRoomId]);

	const currentTraceView = traceView?.piboSessionId === selectedPiboSessionId ? traceView : null;

	const selectedTrace = useMemo(() => {
		if (!currentTraceView) return null;
		return adaptTrace(currentTraceView.piboSessionId, currentTraceView.title, currentTraceView.nodes);
	}, [currentTraceView]);

	const rawEvents = useMemo(
		() => (showRawEvents ? compactRawEvents(currentTraceView?.rawEvents ?? []) : []),
		[showRawEvents, currentTraceView?.rawEvents],
	);

	useEffect(() => {
		if (!bootstrap?.agents.length) return;
		const preferredProfile = newSessionProfile || bootstrap.session.profile;
		if (profileExists(bootstrap.agents, preferredProfile)) {
			if (newSessionProfile !== preferredProfile) {
				setNewSessionProfile(preferredProfile);
				localStorage.setItem("pibo.chat.newSessionProfile", preferredProfile);
			}
			return;
		}
		const fallbackProfile = profileExists(bootstrap.agents, bootstrap.session.profile)
			? bootstrap.session.profile
			: bootstrap.agents[0].name;
		setNewSessionProfile(fallbackProfile);
		localStorage.setItem("pibo.chat.newSessionProfile", fallbackProfile);
	}, [bootstrap, newSessionProfile]);

	const slashCommands = useMemo(() => {
		const actions = bootstrap?.capabilities.actions ?? [];
		const commands = actions.flatMap((action) =>
			action.slashCommands
				.filter((command) => command !== "tree")
				.map((command) => ({ slash: `/${command}`, action: action.name, description: action.description ?? action.name })),
		);
		commands.push({
			slash: "/thinking-show",
			action: "thinking-show",
			description: "Toggle historical thinking display in this browser.",
		});
		return commands;
	}, [bootstrap]);

	const selectSession = useCallback(async (piboSessionId: string) => {
		setTraceLoadingSessionId(piboSessionId);
		setSelectedPiboSessionId(piboSessionId);
		setTraceView((current) => (current?.piboSessionId === piboSessionId ? current : null));
		await loadBootstrap(piboSessionId);
	}, [loadBootstrap]);

	const selectRoom = useCallback(async (roomId: string) => {
		setSelectedRoomId(roomId);
		setSelectedPiboSessionId(null);
		setTraceView(null);
		await loadBootstrap(undefined, showArchivedRef.current, roomId, { selectSession: false });
		setTraceLoadingSessionId(null);
		setArea("sessions");
	}, [loadBootstrap]);

	const createSession = async (profile = newSessionProfile) => {
		if (creatingSession) return;
		setCreatingSession(true);
		try {
			const created = await postSession(profile || undefined, selectedRoomId ?? undefined);
			setTraceLoadingSessionId(created.session.id);
			setArea("sessions");
			setSelectedPiboSessionId(created.session.id);
			setTraceView(null);
			await loadBootstrap(created.session.id, showArchivedRef.current, selectedRoomId ?? undefined);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreatingSession(false);
		}
	};

	const toggleArchivedSessions = async () => {
		const next = !showArchived;
		setShowArchived(next);
		localStorage.setItem("pibo.chat.showArchived", String(next));
		try {
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, next, selectedRoomId ?? undefined);
			if (area === "sessions" && data.selectedPiboSessionId !== selectedPiboSessionId) {
				setTraceLoadingSessionId(data.selectedPiboSessionId);
				setTraceView(null);
			}
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const renameSession = async (piboSessionId: string, title: string | null) => {
		try {
			await patchSession(piboSessionId, { title });
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") await loadTrace(data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setSessionArchived = async (piboSessionId: string, archived: boolean) => {
		try {
			await patchSession(piboSessionId, { archived });
			const keepSelected = !(archived && !showArchived && selectedPiboSessionId === piboSessionId);
			const data = await loadBootstrap(
				keepSelected ? (selectedPiboSessionId ?? undefined) : undefined,
				showArchivedRef.current,
				selectedRoomId ?? undefined,
			);
			if (area === "sessions" && data.selectedPiboSessionId !== selectedPiboSessionId) {
				setTraceLoadingSessionId(data.selectedPiboSessionId);
				setTraceView(null);
			}
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const createRoom = async () => {
		if (creatingRoom) return;
		setCreatingRoom(true);
		try {
			const created = await postRoom({ name: "New Chat" });
			await selectRoom(created.room.id);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreatingRoom(false);
		}
	};

	const updateRoom = async (roomId: string, input: { name?: string; topic?: string | null }) => {
		try {
			await patchRoom(roomId, input);
			await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, roomId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const runCommand = async (text: string) => {
		if (!selectedPiboSessionId) return false;
		const commandText = text.trim().split(/\s+/)[0];
		const command = slashCommands.find((candidate) => candidate.slash === commandText);
		if (!command) return false;
		if (command.action === "thinking-show") {
			const next = !showThinking;
			setShowThinking(next);
			localStorage.setItem("pibo.chat.showThinking", String(next));
			return true;
		}
		const level = text.match(/^\/thinking\s+(\S+)/)?.[1];
		const result = await postAction(selectedPiboSessionId, command.action, level ? { level } : undefined);
		const derivedPiboSessionId = getResultPiboSessionId(result);
		if ((command.action === "session.clone" || command.action === "session.fork") && derivedPiboSessionId) {
			await selectSession(derivedPiboSessionId);
		} else {
			await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			await loadTrace(selectedPiboSessionId);
		}
		return true;
	};

	const forkFrom = useCallback(async (entryId: string) => {
		if (!selectedPiboSessionId) return;
		const result = parseForkActionResponse(await postAction(selectedPiboSessionId, "session.fork", { entryId }));
		if (result?.result.cancelled) return;
		if (!result) throw new Error("Unexpected fork action response");
		if (typeof result.result.selectedText === "string") {
			setComposerText(result.result.selectedText);
			setComposerFocusSignal((current) => current + 1);
		}
		if (result.result.piboSessionId) {
			await selectSession(result.result.piboSessionId);
		}
	}, [selectSession, selectedPiboSessionId]);

	const openSession = useCallback((piboSessionId: string) => void selectSession(piboSessionId), [selectSession]);

	if (error && !bootstrap) {
		return <SignedOut message={error} />;
	}

	if (!bootstrap) {
		return <div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">Loading Pibo Chat...</div>;
	}
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);

	return (
		<div className="h-screen overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[56px_1fr]">
			<header className="flex items-center justify-between gap-3 px-4 bg-[#1a262b] border-b border-slate-800">
				<div className="font-extrabold tracking-[0.08em] uppercase text-lg">Pibo Chat</div>
				<nav className="flex gap-1">
					{(["sessions", "agents", "settings"] as const).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => setArea(item)}
							className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider ${
								area === item ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"
							}`}
						>
							{item}
						</button>
					))}
				</nav>
				<div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
					<UserRound size={14} />
					<span className="truncate">{bootstrap.identity.email || bootstrap.identity.name || bootstrap.identity.userId}</span>
					<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm">
						<LogOut size={14} />
					</button>
				</div>
			</header>

			<div
				className={`min-h-0 grid ${
					showRawEvents
						? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
						: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
				}`}
			>
				<aside className="min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800">
					<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
						<span>{area}</span>
						<div className="flex items-center gap-1">
							{area === "sessions" && roomsSupported ? (
								<button
									type="button"
									onClick={() => void createRoom()}
									disabled={creatingRoom}
									title="New Room"
									aria-label="New Room"
									className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
								>
									<FolderPlus size={13} />
								</button>
							) : null}
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() => void createSession()}
									disabled={creatingSession}
									title="New Session"
									aria-label="New Session"
									className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
								>
									<MessageSquarePlus size={13} />
								</button>
							) : null}
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() => void toggleArchivedSessions()}
									title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
									aria-label={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
									className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${
										showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
									}`}
								>
									{showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
								</button>
							) : null}
							<button
								type="button"
								onClick={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined)}
								title="Refresh"
								aria-label="Refresh"
								className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<RefreshCw size={13} />
							</button>
						</div>
					</div>
					{area === "sessions" ? (
						<div className="p-2 space-y-3">
							{roomsSupported ? (
								<div>
									<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Rooms</div>
									{bootstrap.rooms.map((room) => (
										<RoomNode
											key={room.id}
											room={room}
											selectedRoomId={selectedRoomId}
											onSelect={(roomId) => void selectRoom(roomId)}
											onUpdate={(roomId, input) => void updateRoom(roomId, input)}
										/>
									))}
								</div>
							) : null}
							<div>
								<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
								{bootstrap.sessions.map((session) => (
									<SessionNode
										key={session.piboSessionId}
										node={session}
										selectedPiboSessionId={selectedPiboSessionId}
										onSelect={(piboSessionId) => void selectSession(piboSessionId)}
										onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
										onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
									/>
								))}
							</div>
						</div>
					) : area === "agents" ? (
						<div className="p-2">
							{bootstrap.agents.map((agent) => (
								<button
									key={agent.name}
									type="button"
									onClick={() => {
										setNewSessionProfile(agent.name);
										localStorage.setItem("pibo.chat.newSessionProfile", agent.name);
									}}
									className={`w-full mb-1 px-2 py-2 border rounded-sm text-left ${
										agent.name === newSessionProfile ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
									}`}
								>
									<span className="block text-sm truncate text-slate-200">{agent.name}</span>
									<span className="block text-[10px] font-mono truncate text-slate-500">
										{agent.aliases.length ? agent.aliases.join(", ") : "profile"}
									</span>
								</button>
							))}
						</div>
					) : (
						<div className="p-3 text-sm text-slate-400">Browser-local settings.</div>
					)}
				</aside>

				<main className="min-h-0 flex flex-col">
					{area === "sessions" ? (
						<>
							<div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between">
								<div className="min-w-0">
									<h1 className="text-base font-semibold truncate">
										{currentTraceView?.title ?? selectedPiboSessionId ?? bootstrap.room?.name ?? selectedRoomId}
									</h1>
									<div className="font-mono text-[11px] text-slate-500 truncate">
										{bootstrap.room?.name ?? selectedRoomId ?? "Room"} · {currentTraceView?.piboSessionId}{" "}
										{currentTraceView ? `· ${currentTraceView.piSessionId}` : ""}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<HeaderIconButton
										onClick={() => {
											const next = !showRawEvents;
											setShowRawEvents(next);
											localStorage.setItem("pibo.chat.showRawEvents", String(next));
										}}
										title={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
										ariaLabel={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
										active={showRawEvents}
									>
										<Bug size={14} />
									</HeaderIconButton>
									<HeaderIconButton
										onClick={() => {
											const next = !showThinking;
											setShowThinking(next);
											localStorage.setItem("pibo.chat.showThinking", String(next));
										}}
										title={showThinking ? "Hide Thinking" : "Show Thinking"}
										ariaLabel={showThinking ? "Hide Thinking" : "Show Thinking"}
										active={showThinking}
									>
										{showThinking ? <Brain size={14} /> : <EyeOff size={14} />}
									</HeaderIconButton>
									{showThinking ? (
										<HeaderIconButton
											onClick={() => {
												const next = !expandThinking;
												setExpandThinking(next);
												localStorage.setItem("pibo.chat.expandThinking", String(next));
											}}
											title={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
											ariaLabel={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
											active={expandThinking}
										>
											{expandThinking ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
										</HeaderIconButton>
									) : null}
								</div>
							</div>
							<TraceTimeline
								trace={selectedTrace}
								isLoading={Boolean(selectedPiboSessionId && traceLoadingSessionId === selectedPiboSessionId)}
								showThinking={showThinking}
								expandThinking={expandThinking}
								sessionAgentProfile={bootstrap.session.profile}
								activeAgentProfile={newSessionProfile}
								onFork={forkFrom}
								onOpenSession={openSession}
							/>
							<Composer
								disabled={!selectedPiboSessionId}
								commands={slashCommands}
								value={composerText}
								focusSignal={composerFocusSignal}
								onValueChange={setComposerText}
								onCommand={runCommand}
								onSend={async (text) => {
									if (!selectedPiboSessionId) return;
									try {
										await postMessage(selectedPiboSessionId, text, createClientTxnId(), selectedRoomId ?? undefined);
										await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
										await loadTrace(selectedPiboSessionId);
										setError(null);
									} catch (caught) {
										setError(caught instanceof Error ? caught.message : String(caught));
									}
								}}
							/>
						</>
					) : area === "agents" ? (
						<AgentsView
							agents={bootstrap.agents}
							selectedProfile={newSessionProfile}
							onSelect={(profile) => {
								setNewSessionProfile(profile);
								localStorage.setItem("pibo.chat.newSessionProfile", profile);
							}}
							onCreateSession={(profile) => void createSession(profile)}
							creatingSession={creatingSession}
						/>
					) : (
						<SettingsView
							showThinking={showThinking}
							setShowThinking={setShowThinking}
							expandThinking={expandThinking}
							setExpandThinking={setExpandThinking}
						/>
					)}
				</main>

				{showRawEvents ? (
					<aside className="min-h-0 overflow-auto bg-[#0e1116] border-l border-slate-800 max-[980px]:hidden">
						<div className="h-11 px-3 border-b border-slate-800 flex items-center text-xs font-bold uppercase tracking-wider">Raw Events</div>
						<div className="p-3 flex flex-col gap-2">
							{rawEvents.slice(-80).reverse().map((event) => (
								<div key={event.id} className="border-l-2 border-[#11a4d4] bg-[#151f24] p-2">
									<div className="flex items-center justify-between gap-2 text-[#11a4d4] font-mono text-[11px] mb-1">
										<span>{event.type}</span>
										{event.count > 1 ? <span className="text-slate-500">x{event.count}</span> : null}
									</div>
									<JsonRenderer value={event.payload} showControls={false} />
								</div>
							))}
						</div>
					</aside>
				) : null}
			</div>

		</div>
	);
}

function SignedOut({ message }: { message: string }) {
	return (
		<div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">
			<div className="border border-slate-700 bg-[#1a262b] p-5 rounded-sm">
				<div className="mb-4 text-sm text-slate-400">{message}</div>
				<button type="button" onClick={() => void signInWithGoogle()} className="px-3 py-2 bg-[#11a4d4] rounded-sm">
					Sign in with Google
				</button>
			</div>
		</div>
	);
}

function HeaderIconButton({
	title,
	ariaLabel,
	active,
	onClick,
	children,
}: {
	title: string;
	ariaLabel: string;
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={ariaLabel}
			className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm transition-colors ${
				active
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]"
					: "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
			}`}
		>
			{children}
		</button>
	);
}

function RoomNode({
	room,
	selectedRoomId,
	onSelect,
	onUpdate,
	depth = 0,
}: {
	room: PiboRoom;
	selectedRoomId: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null }) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");

	useEffect(() => {
		if (!editing) {
			setDraftName(room.name);
			setDraftTopic(room.topic ?? "");
		}
	}, [editing, room.name, room.topic]);

	const submit = () => {
		const name = draftName.trim();
		if (!name) return;
		onUpdate(room.id, { name, topic: draftTopic.trim() || null });
		setEditing(false);
	};

	return (
		<div>
			<div
				className={`group mb-1 border rounded-sm ${
					room.id === selectedRoomId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ marginLeft: depth * 12 }}
				title={room.id}
			>
				{editing ? (
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
						<button type="button" onClick={() => onSelect(room.id)} className="min-w-0 text-left px-2 py-1">
							<span className="block text-sm truncate text-slate-200">{room.name}</span>
							<span className="block text-[10px] font-mono truncate text-slate-500">{room.topic || room.type}</span>
						</button>
						<button
							type="button"
							onClick={() => setEditing(true)}
							title="Edit Room"
							aria-label="Edit Room"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Edit3 size={13} />
						</button>
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
					depth={depth + 1}
				/>
			))}
		</div>
	);
}

function SessionNode({
	node,
	selectedPiboSessionId,
	onSelect,
	onRename,
	onArchive,
	depth = 0,
}: {
	node: PiboWebSessionNode;
	selectedPiboSessionId: string | null;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(node.title);
	const hasChildren = node.children.length > 0;
	const hasSelectedDescendant = selectedPiboSessionId ? sessionTreeHasSession(node.children, selectedPiboSessionId) : false;
	const [expanded, setExpanded] = useState(hasSelectedDescendant);

	useEffect(() => {
		if (!editing) setDraftTitle(node.title);
	}, [editing, node.title]);

	useEffect(() => {
		if (hasSelectedDescendant) setExpanded(true);
	}, [hasSelectedDescendant]);

	const submitRename = () => {
		const title = draftTitle.trim();
		onRename(node.piboSessionId, title ? title : null);
		setEditing(false);
	};

	return (
		<div>
			<div
				className={`group w-full grid grid-cols-[1fr_auto] gap-1 items-center mb-1 border rounded-sm ${
					node.piboSessionId === selectedPiboSessionId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ paddingLeft: 8 + depth * 14 }}
				title={node.piboSessionId}
			>
				{editing ? (
					<form
						className="min-w-0 grid grid-cols-[1fr_auto_auto] gap-1 py-1 pr-1"
						onSubmit={(event) => {
							event.preventDefault();
							submitRename();
						}}
					>
						<input
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setEditing(false);
									setDraftTitle(node.title);
								}
							}}
							autoFocus
							className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4]"
						/>
						<button
							type="submit"
							title="Save Session Title"
							aria-label="Save Session Title"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Check size={13} />
						</button>
						<button
							type="button"
							onClick={() => {
								setEditing(false);
								setDraftTitle(node.title);
							}}
							title="Cancel Rename"
							aria-label="Cancel Rename"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<X size={13} />
						</button>
					</form>
				) : (
					<div className="min-w-0 grid grid-cols-[1fr_auto] gap-2 items-center py-1 pr-1">
						<button
							type="button"
							onClick={() => {
								if (hasChildren && node.piboSessionId === selectedPiboSessionId) {
									setExpanded((current) => !current);
									return;
								}
								onSelect(node.piboSessionId);
							}}
							className="min-w-0 text-left px-1 py-1"
						>
							<span className={`block text-sm truncate ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{node.title}</span>
							<span className="block text-[10px] font-mono truncate text-slate-500">{node.piboSessionId}</span>
						</button>
						<span className="grid grid-rows-[16px_16px] place-items-center gap-0.5">
							<span className={`h-2 w-2 rounded-full ${node.status === "running" ? "bg-[#0bda57]" : node.status === "error" ? "bg-red-500" : "bg-slate-600"}`} />
							{hasChildren ? (
								<button
									type="button"
									onClick={() => setExpanded((current) => !current)}
									aria-expanded={expanded}
									title={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									aria-label={expanded ? "Collapse Subsessions" : "Expand Subsessions"}
									className={`h-4 w-4 inline-flex items-center justify-center rounded-sm transition-colors ${
										expanded ? "text-[#0bda57]" : "text-slate-600 hover:text-[#11a4d4]"
									}`}
								>
									<Layers size={13} />
								</button>
							) : (
								<span className="h-4 w-4" />
							)}
						</span>
					</div>
				)}
				{editing ? null : (
					<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
						<button
							type="button"
							onClick={() => setEditing(true)}
							title="Rename Session"
							aria-label="Rename Session"
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							<Edit3 size={13} />
						</button>
						<button
							type="button"
							onClick={() => onArchive(node.piboSessionId, !node.archived)}
							title={node.archived ? "Restore Session" : "Archive Session"}
							aria-label={node.archived ? "Restore Session" : "Archive Session"}
							className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
						>
							{node.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
						</button>
					</div>
				)}
			</div>
			{expanded ? node.children.map((child) => (
				<SessionNode
					key={child.piboSessionId}
					node={child}
					selectedPiboSessionId={selectedPiboSessionId}
					onSelect={onSelect}
					onRename={onRename}
					onArchive={onArchive}
					depth={depth + 1}
				/>
			)) : null}
		</div>
	);
}

function sessionTreeHasSession(nodes: PiboWebSessionNode[], piboSessionId: string): boolean {
	return nodes.some((node) => node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId));
}

function Composer({
	disabled = false,
	commands,
	value,
	focusSignal,
	onValueChange,
	onCommand,
	onSend,
}: {
	disabled?: boolean;
	commands: Array<{ slash: string; action: string; description: string }>;
	value: string;
	focusSignal: number;
	onValueChange: (value: string) => void;
	onCommand: (text: string) => Promise<boolean>;
	onSend: (text: string) => Promise<void>;
}) {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const activeCommandRef = useRef<HTMLButtonElement>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const filtered = value.trim().startsWith("/")
		? commands.filter((command) => command.slash.startsWith(value.trim().split(/\s+/)[0]))
		: [];

	useEffect(() => {
		if (!filtered.length || activeIndex < filtered.length) return;
		setActiveIndex(0);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		activeCommandRef.current?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		if (focusSignal <= 0) return;
		const input = inputRef.current;
		if (!input) return;
		const cursorPosition = input.value.length;
		input.focus();
		input.setSelectionRange(cursorPosition, cursorPosition);
	}, [focusSignal]);

	useLayoutEffect(() => {
		resizeComposerInput(inputRef.current);
	}, [value]);

	const submit = async () => {
		if (disabled) return;
		const text = value.trim();
		if (!text) return;
		if (filtered.length && !commands.some((command) => command.slash === text.split(/\s+/)[0])) {
			onValueChange(filtered[Math.min(activeIndex, filtered.length - 1)].slash);
			return;
		}
		onValueChange("");
		if (text.startsWith("/") && (await onCommand(text))) return;
		await onSend(text);
	};

	return (
		<div className="relative p-3 bg-[#151f24] border-t border-slate-800">
			{filtered.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-[#11a4d4] rounded-sm shadow-xl">
					{filtered.map((command, index) => (
						<button
							key={command.slash}
							ref={index === activeIndex ? activeCommandRef : null}
							type="button"
							onClick={() => {
								onValueChange(command.slash);
								setActiveIndex(index);
							}}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeIndex ? "bg-[#11a4d4]/15" : ""}`}
						>
							<span className="font-mono text-[#11a4d4]">{command.slash}</span>
							<span className="text-xs text-slate-400">{command.description}</span>
						</button>
					))}
				</div>
			) : null}
			<div className="grid grid-cols-[1fr_auto] items-end gap-2">
				<textarea
					ref={inputRef}
					rows={1}
					value={value}
					disabled={disabled}
					onChange={(event) => onValueChange(event.target.value)}
					onKeyDown={(event) => {
						if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filtered.length : (current - 1 + filtered.length) % filtered.length,
							);
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder={disabled ? "Select a session to message" : "Message selected session or type /"}
					className="h-10 min-h-10 resize-none overflow-hidden bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm leading-5 outline-none focus:border-[#11a4d4] disabled:opacity-50 [scrollbar-gutter:stable]"
				/>
				<button
					type="button"
					disabled={disabled}
					onClick={() => void submit()}
					title="Send message"
					aria-label="Send message"
					className="h-10 w-10 self-end inline-flex items-center justify-center bg-[#11a4d4] rounded-sm text-white disabled:opacity-50"
				>
					<SendHorizontal size={16} />
				</button>
			</div>
		</div>
	);
}

function resizeComposerInput(input: HTMLTextAreaElement | null) {
	if (!input) return;
	const style = window.getComputedStyle(input);
	const lineHeight = cssPx(style.lineHeight, 20);
	const borderFrame = cssPx(style.borderTopWidth) + cssPx(style.borderBottomWidth);
	const maxScrollHeight = lineHeight * 5 + cssPx(style.paddingTop) + cssPx(style.paddingBottom);

	input.style.height = "auto";
	const scrollHeight = input.scrollHeight;
	const hasOverflow = scrollHeight > maxScrollHeight;
	input.style.height = `${Math.min(scrollHeight, maxScrollHeight) + borderFrame}px`;
	input.style.overflowY = hasOverflow ? "auto" : "hidden";
	if (hasOverflow && input.selectionStart === input.value.length && input.selectionEnd === input.value.length) {
		input.scrollTop = scrollHeight;
	}
}

function cssPx(value: string, fallback = 0): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function createClientTxnId(): string {
	const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
	return `web-${Date.now().toString(36)}-${randomId}`;
}

function AgentsView({
	agents,
	selectedProfile,
	onSelect,
	onCreateSession,
	creatingSession,
}: {
	agents: BootstrapData["agents"];
	selectedProfile: string;
	onSelect: (profile: string) => void;
	onCreateSession: (profile: string) => void;
	creatingSession: boolean;
}) {
	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4">Agents</h1>
			<div className="grid gap-3">
				{agents.map((agent) => (
					<div
						key={agent.name}
						className={`border bg-[#1a262b] rounded-sm p-4 ${
							agent.name === selectedProfile ? "border-[#11a4d4]" : "border-slate-700"
						}`}
					>
						<div className="flex items-center justify-between gap-3">
							<div className="min-w-0">
								<div className="font-semibold truncate">{agent.name}</div>
								{agent.aliases.length ? (
									<div className="font-mono text-[11px] text-slate-500 truncate">{agent.aliases.join(", ")}</div>
								) : null}
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => onSelect(agent.name)}
									title="Select Agent Profile"
									aria-label="Select Agent Profile"
									className={`h-8 w-8 inline-flex items-center justify-center border rounded-sm ${
										agent.name === selectedProfile ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
									}`}
								>
									<Check size={14} />
								</button>
								<button
									type="button"
									onClick={() => {
										onSelect(agent.name);
										onCreateSession(agent.name);
									}}
									disabled={creatingSession}
									title="New Session With Profile"
									aria-label="New Session With Profile"
									className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
								>
									<MessageSquarePlus size={14} />
								</button>
							</div>
						</div>
						<div className="text-sm text-slate-400 mt-1">{agent.description || "No description"}</div>
					</div>
				))}
			</div>
		</div>
	);
}

function SettingsView({
	showThinking,
	setShowThinking,
	expandThinking,
	setExpandThinking,
}: {
	showThinking: boolean;
	setShowThinking: (value: boolean) => void;
	expandThinking: boolean;
	setExpandThinking: (value: boolean) => void;
}) {
	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
				<Settings size={16} />
				Settings
			</h1>
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={showThinking}
					onChange={(event) => {
						setShowThinking(event.target.checked);
						localStorage.setItem("pibo.chat.showThinking", String(event.target.checked));
					}}
				/>
				Show thinking blocks
			</label>
			<label className="mt-3 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={expandThinking}
					disabled={!showThinking}
					onChange={(event) => {
						setExpandThinking(event.target.checked);
						localStorage.setItem("pibo.chat.expandThinking", String(event.target.checked));
					}}
				/>
				Expand thinking blocks
			</label>
		</div>
	);
}

type RawEvent = PiboSessionTraceView["rawEvents"][number];
type CompactRawEvent = RawEvent & { count: number };

type ChatStreamEvent =
	| { type: "ready"; piboSessionId: string }
	| { type: "RUN_STARTED"; runId: string; input?: { text?: string; source?: string } }
	| { type: "RUN_FINISHED"; runId: string }
	| { type: "RUN_ERROR"; runId?: string; message: string }
	| { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
	| { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
	| { type: "TEXT_MESSAGE_END"; messageId: string; finalText?: string }
	| { type: "REASONING_MESSAGE_START"; messageId: string }
	| { type: "REASONING_MESSAGE_CONTENT"; messageId: string; delta: string }
	| { type: "REASONING_MESSAGE_END"; messageId: string; finalText?: string }
	| { type: "TOOL_CALL_START"; toolCallId: string; toolName: string; args?: unknown; runId?: string }
	| { type: "TOOL_CALL_ARGS"; toolCallId: string; args: unknown; argsComplete: boolean }
	| { type: "TOOL_CALL_RESULT"; toolCallId: string; result: unknown; isError: boolean }
	| { type: "AGENT_DELEGATION"; toolCallId?: string; toolName: string; subagentName: string; childPiboSessionId: string; threadKey?: string }
	| { type: "EXECUTION_RESULT"; runId?: string; action: string; result: unknown }
	| { type: "RAW_EVENT"; event: unknown };

function chatStreamEvent(message: MessageEvent): ChatStreamEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		return typeof parsed.type === "string" ? (parsed as ChatStreamEvent) : undefined;
	} catch {
		return undefined;
	}
}

function applyChatStreamEvents(view: PiboSessionTraceView, events: ChatStreamEvent[]): PiboSessionTraceView {
	if (!events.length) return view;
	return events.reduce(applyChatStreamEvent, view);
}

function applyChatStreamEvent(view: PiboSessionTraceView, event: ChatStreamEvent): PiboSessionTraceView {
	if (event.type === "ready") return view;
	const createdAt = new Date().toISOString();
	let nodes = view.nodes;

	switch (event.type) {
		case "RUN_STARTED":
			nodes = upsertTraceNode(nodes, {
				id: messageTurnNodeId(event.runId),
				piboSessionId: view.piboSessionId,
				eventId: event.runId,
				type: "agent.turn",
				title: "Agent Turn",
				status: "running",
				startedAt: createdAt,
				summary: event.input?.text,
				input: event.input,
				children: [],
			});
			break;
		case "RUN_FINISHED":
			nodes = updateTraceNode(nodes, messageTurnNodeId(event.runId), (node) => ({
				...node,
				status: "done",
				completedAt: createdAt,
			}));
			break;
		case "RUN_ERROR": {
			if (event.runId) {
				nodes = updateTraceNode(nodes, messageTurnNodeId(event.runId), (node) => ({
					...node,
					status: "error",
					completedAt: createdAt,
					error: event.message,
				}));
			}
			nodes = upsertTraceNode(nodes, {
				id: `event:error:${event.runId ?? createdAt}`,
				parentId: event.runId ? messageTurnNodeId(event.runId) : undefined,
				piboSessionId: view.piboSessionId,
				eventId: event.runId,
				type: "error",
				title: "Error",
				status: "error",
				startedAt: createdAt,
				error: event.message,
				output: event.message,
				children: [],
			});
			break;
		}
		case "TEXT_MESSAGE_START":
			nodes = upsertTraceNode(nodes, assistantNode(event.messageId, view.piboSessionId, createdAt));
			break;
		case "TEXT_MESSAGE_CONTENT":
			nodes = appendTextToNode(nodes, assistantNode(event.messageId, view.piboSessionId, createdAt), event.delta);
			break;
		case "TEXT_MESSAGE_END":
			nodes = upsertTraceNode(nodes, {
				...assistantNode(event.messageId, view.piboSessionId, createdAt),
				status: "done",
				completedAt: createdAt,
				...(event.finalText === undefined ? {} : { summary: event.finalText, output: event.finalText }),
			});
			nodes = updateTraceNode(nodes, messageTurnNodeId(event.messageId), (node) => ({
				...node,
				status: "done",
				completedAt: createdAt,
			}));
			break;
		case "REASONING_MESSAGE_START":
			nodes = upsertTraceNode(nodes, reasoningNode(event.messageId, view.piboSessionId, createdAt));
			break;
		case "REASONING_MESSAGE_CONTENT":
			nodes = appendTextToNode(nodes, reasoningNode(event.messageId, view.piboSessionId, createdAt), event.delta);
			break;
		case "REASONING_MESSAGE_END":
			nodes = upsertTraceNode(nodes, {
				...reasoningNode(event.messageId, view.piboSessionId, createdAt),
				status: "done",
				completedAt: createdAt,
				...(event.finalText === undefined ? {} : { summary: event.finalText, output: event.finalText }),
			});
			break;
		case "TOOL_CALL_START":
			nodes = upsertTraceNode(nodes, {
				id: toolNodeId(event.toolCallId),
				parentId: event.runId ? messageTurnNodeId(event.runId) : undefined,
				piboSessionId: view.piboSessionId,
				eventId: event.runId,
				toolCallId: event.toolCallId,
				type: "tool.call",
				title: event.toolName,
				status: "running",
				startedAt: createdAt,
				input: event.args,
				children: [],
			});
			break;
		case "TOOL_CALL_ARGS":
			nodes = updateTraceNode(nodes, toolNodeId(event.toolCallId), (node) => ({ ...node, input: event.args }));
			break;
		case "TOOL_CALL_RESULT":
			nodes = updateTraceNode(nodes, toolNodeId(event.toolCallId), (node) => ({
				...withAsyncAgentRunChild(
					{
						...node,
						status: event.isError ? "error" : "done",
						completedAt: createdAt,
						output: event.result,
						error: event.isError ? stringifyUnknown(event.result) : node.error,
					},
					view.piboSessionId,
					createdAt,
				),
			}));
			break;
		case "AGENT_DELEGATION": {
			const id = event.toolCallId ? toolNodeId(event.toolCallId) : `event:subagent:${event.childPiboSessionId}`;
			const existing = findTraceNode(nodes, id);
			if (existing && isRunStartToolNode(existing)) {
				nodes = updateTraceNode(nodes, id, (node) =>
					withAsyncAgentDelegationChild(node, event, view.piboSessionId, createdAt),
				);
				break;
			}
			nodes = upsertTraceNode(nodes, {
				id,
				piboSessionId: view.piboSessionId,
				toolCallId: event.toolCallId,
				type: "agent.delegation",
				title: event.toolName,
				status: "running",
				startedAt: createdAt,
				summary: event.subagentName,
				input: { subagentName: event.subagentName, threadKey: event.threadKey },
				linkedPiboSessionId: event.childPiboSessionId,
				children: [],
			});
			break;
		}
		case "EXECUTION_RESULT":
			if (isInternalSessionOperation(event.action)) break;
			nodes = upsertTraceNode(nodes, {
				id: `event:execution_result:${event.runId ?? event.action}`,
				piboSessionId: view.piboSessionId,
				eventId: event.runId,
				type: "execution.command",
				title: event.action,
				status: "done",
				startedAt: createdAt,
				input: { action: event.action },
				output: event.result,
				children: [],
			});
			break;
		case "RAW_EVENT":
			break;
	}

	return {
		...view,
		nodes,
		rawEvents: appendRawStreamEvent(view.rawEvents, event, createdAt),
	};
}

function upsertTraceNode(nodes: PiboTraceNode[], update: PiboTraceNode): PiboTraceNode[] {
	const existing = findTraceNode(nodes, update.id);
	if (existing) {
		return updateTraceNode(nodes, update.id, (node) => ({
			...node,
			...update,
			children: update.children.length ? update.children : node.children,
		}));
	}
	const parent = update.parentId ? findTraceNode(nodes, update.parentId) : undefined;
	if (parent) {
		return updateTraceNode(nodes, parent.id, (node) => ({
			...node,
			children: [...(node.children ?? []), update],
		}));
	}
	return [...nodes, update];
}

function updateTraceNode(
	nodes: PiboTraceNode[],
	id: string,
	update: (node: PiboTraceNode) => PiboTraceNode,
): PiboTraceNode[] {
	const result = updateTraceNodeInTree(nodes, id, update);
	return result ?? nodes;
}

function updateTraceNodeInTree(
	nodes: PiboTraceNode[],
	id: string,
	update: (node: PiboTraceNode) => PiboTraceNode,
): PiboTraceNode[] | undefined {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (node.id === id) {
			const updated = update(node);
			if (updated === node) return undefined;
			const next = nodes.slice();
			next[index] = updated;
			return next;
		}
		const updatedChildren = updateTraceNodeInTree(node.children ?? [], id, update);
		if (updatedChildren) {
			const next = nodes.slice();
			next[index] = { ...node, children: updatedChildren };
			return next;
		}
	}
	return undefined;
}

function appendTextToNode(nodes: PiboTraceNode[], node: PiboTraceNode, delta: string): PiboTraceNode[] {
	const existing = findTraceNode(nodes, node.id);
	if (!existing) {
		return upsertTraceNode(nodes, { ...node, summary: delta, output: delta });
	}
	const text = `${typeof existing.output === "string" ? existing.output : ""}${delta}`;
	return updateTraceNode(nodes, existing.id, (current) => ({
		...current,
		status: "running",
		summary: text,
		output: text,
	}));
}

function findTraceNode(nodes: PiboTraceNode[], id: string): PiboTraceNode | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		const child = findTraceNode(node.children ?? [], id);
		if (child) return child;
	}
	return undefined;
}

function assistantNode(eventId: string, piboSessionId: string, startedAt: string): PiboTraceNode {
	return {
		id: assistantMessageNodeId(eventId),
		parentId: messageTurnNodeId(eventId),
		piboSessionId,
		eventId,
		type: "assistant.message",
		title: "Agent Message",
		status: "running",
		startedAt,
		summary: "",
		output: "",
		children: [],
	};
}

function reasoningNode(eventId: string, piboSessionId: string, startedAt: string): PiboTraceNode {
	return {
		id: thinkingNodeId(eventId),
		parentId: messageTurnNodeId(eventId),
		piboSessionId,
		eventId,
		type: "model.reasoning",
		title: "Thinking",
		status: "running",
		startedAt,
		summary: "",
		output: "",
		children: [],
	};
}

function appendRawStreamEvent(events: RawEvent[], event: ChatStreamEvent, createdAt: string): RawEvent[] {
	return [
		...events.slice(-999),
		{
			id: `stream:${createdAt}:${events.length}`,
			type: event.type,
			createdAt,
			payload: event,
		},
	];
}

function messageTurnNodeId(eventId: string): string {
	return `event:message:${eventId}`;
}

function assistantMessageNodeId(eventId: string): string {
	return `event:assistant:${eventId}`;
}

function thinkingNodeId(eventId: string): string {
	return `event:thinking:${eventId}`;
}

function toolNodeId(toolCallId: string): string {
	return `tool:${toolCallId}`;
}

function withAsyncAgentDelegationChild(
	parent: PiboTraceNode,
	event: Extract<ChatStreamEvent, { type: "AGENT_DELEGATION" }>,
	piboSessionId: string,
	startedAt: string,
): PiboTraceNode {
	const child = createAsyncAgentRunNode(parent, piboSessionId, startedAt, {
		toolName: event.toolName,
		subagentName: event.subagentName,
		threadKey: event.threadKey,
		linkedPiboSessionId: event.childPiboSessionId,
	});
	return child ? withTraceChild(parent, child) : parent;
}

function withAsyncAgentRunChild(parent: PiboTraceNode, piboSessionId: string, startedAt: string): PiboTraceNode {
	const child = createAsyncAgentRunNode(parent, piboSessionId, startedAt);
	return child ? withTraceChild(parent, child) : parent;
}

function withTraceChild(parent: PiboTraceNode, child: PiboTraceNode): PiboTraceNode {
	const existing = parent.children.find((candidate) => candidate.id === child.id);
	if (!existing) return { ...parent, children: [...parent.children, child] };
	return {
		...parent,
		children: parent.children.map((candidate) =>
			candidate.id === child.id
				? {
						...candidate,
						...child,
						runId: child.runId ?? candidate.runId,
						linkedPiboSessionId: child.linkedPiboSessionId ?? candidate.linkedPiboSessionId,
						children: candidate.children,
					}
				: candidate,
		),
	};
}

function createAsyncAgentRunNode(
	parent: PiboTraceNode,
	piboSessionId: string,
	startedAt: string,
	delegation?: { toolName: string; subagentName: string; threadKey?: string; linkedPiboSessionId?: string },
): PiboTraceNode | undefined {
	if (!isRunStartToolNode(parent)) return undefined;
	const run = extractRunSnapshot(parent.output);
	const input = isRecord(parent.input) ? parent.input : {};
	const toolName = stringField(run?.toolName) || stringField(input.toolName) || delegation?.toolName;
	if (!toolName || !toolName.startsWith("pibo_subagent_")) return undefined;
	const runId = stringField(run?.runId);
	const runStatus = stringField(run?.status);
	const subagentName = delegation?.subagentName || toolName.slice("pibo_subagent_".length);
	const completionPolicy = stringField(run?.completionPolicy) || stringField(input.completionPolicy);

	return {
		id: `${parent.id}:async-agent`,
		parentId: parent.id,
		piboSessionId,
		eventId: parent.eventId,
		toolCallId: parent.toolCallId,
		runId,
		type: "agent.async",
		title: subagentName,
		status: asyncAgentStatus(parent, runStatus),
		startedAt,
		completedAt: runStatus === "completed" || runStatus === "cancelled" ? parent.completedAt : undefined,
		summary: `Started by ${parent.title}`,
		input: {
			startedBy: parent.title,
			startToolCallId: parent.toolCallId,
			toolName,
			subagentName,
			runId,
			completionPolicy,
			arguments: input.arguments,
			threadKey: delegation?.threadKey,
		},
		output: run,
		error: parent.error,
		linkedPiboSessionId: delegation?.linkedPiboSessionId ?? parent.linkedPiboSessionId,
		children: [],
	};
}

function isRunStartToolNode(node: PiboTraceNode): boolean {
	return node.type === "tool.call" && node.title === "pibo_run_start";
}

function extractRunSnapshot(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.runId === "string" && typeof value.toolName === "string") return value;
	if (isRecord(value.details) && typeof value.details.runId === "string" && typeof value.details.toolName === "string") {
		return value.details;
	}
	return undefined;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asyncAgentStatus(parent: PiboTraceNode, runStatus: string): PiboTraceNode["status"] {
	if (parent.status === "error" || runStatus === "failed") return "error";
	if (runStatus === "completed" || runStatus === "cancelled") return "done";
	return "running";
}

function isInternalSessionOperation(action: string): boolean {
	return action === "session.fork" || action === "session.clone" || action === "session.switch";
}

function stringifyUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function compactRawEvents(events: RawEvent[]): CompactRawEvent[] {
	const compacted: CompactRawEvent[] = [];
	for (const event of events) {
		const previous = compacted[compacted.length - 1];
		if (previous && canMergeRawDelta(previous, event)) {
			previous.count += 1;
			previous.createdAt = event.createdAt;
			previous.payload = {
				...(isRecord(previous.payload) ? previous.payload : {}),
				text: `${textFromPayload(previous.payload)}${textFromPayload(event.payload)}`,
			};
			continue;
		}
		compacted.push({ ...event, count: 1 });
	}
	return compacted;
}

function profileExists(profiles: BootstrapData["agents"], name: string): boolean {
	return profiles.some((profile) => profile.name === name || profile.aliases.includes(name));
}

function readStoredSelection(): StoredSelection {
	try {
		const raw = localStorage.getItem(LAST_SELECTION_STORAGE_KEY);
		if (!raw) return {};
		const value = JSON.parse(raw);
		if (!isRecord(value)) return {};
		return {
			roomId: typeof value.roomId === "string" && value.roomId ? value.roomId : undefined,
			piboSessionId: typeof value.piboSessionId === "string" && value.piboSessionId ? value.piboSessionId : undefined,
		};
	} catch {
		return {};
	}
}

function writeStoredSelection(selection: StoredSelection): void {
	try {
		localStorage.setItem(LAST_SELECTION_STORAGE_KEY, JSON.stringify(selection));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function clearStoredSelection(): void {
	try {
		localStorage.removeItem(LAST_SELECTION_STORAGE_KEY);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function canMergeRawDelta(left: RawEvent, right: RawEvent): boolean {
	if (left.type !== right.type) return false;
	if (
		left.type !== "assistant_delta" &&
		left.type !== "thinking_delta" &&
		left.type !== "TEXT_MESSAGE_CONTENT" &&
		left.type !== "REASONING_MESSAGE_CONTENT"
	) {
		return false;
	}
	const leftPayload = isRecord(left.payload) ? left.payload : {};
	const rightPayload = isRecord(right.payload) ? right.payload : {};
	return eventKeyFromPayload(leftPayload) === eventKeyFromPayload(rightPayload);
}

function textFromPayload(payload: unknown): string {
	if (!isRecord(payload)) return "";
	if (typeof payload.text === "string") return payload.text;
	return typeof payload.delta === "string" ? payload.delta : "";
}

function eventKeyFromPayload(payload: Record<string, unknown>): unknown {
	return payload.eventId ?? payload.messageId;
}

function parseForkActionResponse(value: unknown): ForkActionResponse | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return value as ForkActionResponse;
}

function getResultPiboSessionId(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.result)) return undefined;
	return typeof value.result.piboSessionId === "string" ? value.result.piboSessionId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
