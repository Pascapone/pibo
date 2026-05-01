import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	Archive,
	ArchiveRestore,
	Brain,
	Bug,
	Check,
	ChevronsDown,
	ChevronsUp,
	CopyPlus,
	Edit3,
	EyeOff,
	FolderPlus,
	Layers,
	Lock,
	LogOut,
	MessageSquarePlus,
	Plus,
	RefreshCw,
	Save,
	Settings,
	SendHorizontal,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import { deleteCustomAgent, deleteRoom, deleteSession, getBootstrap, getTrace, patchCustomAgent, patchRoom, patchSession, postAction, postCustomAgent, postMessage, postRoom, postSession, signInWithGoogle, signOut, type SaveCustomAgentInput } from "./api";
import type { AgentCatalog, BootstrapData, CustomAgent, CustomAgentSubagent, PiboRoom, PiboSessionTraceView, PiboTraceNode, PiboTraceOrderKey, PiboWebSessionNode } from "./types";
import { adaptTrace } from "./tracing/adapt";
import { TraceTimeline } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";
import { countRender } from "./renderMetrics";
import { childTraceOrder, compareTraceOrder, liveTraceOrder } from "../../../shared/trace-order.js";

type Area = "sessions" | "agents" | "settings";

export type ChatAppRoute =
	| { area: "sessions"; roomId?: string; piboSessionId?: string }
	| { area: "agents" }
	| { area: "settings" };

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
const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";

type StoredSelection = {
	roomId?: string;
	piboSessionId?: string;
	sessionsByRoom?: Record<string, string>;
};

export function App({ route }: { route: ChatAppRoute }) {
	countRender("App");
	const navigate = useNavigate();
	const area = route.area;
	const routeRoomId = route.area === "sessions" ? route.roomId : undefined;
	const routePiboSessionId = route.area === "sessions" ? route.piboSessionId : undefined;
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [traceView, setTraceView] = useState<PiboSessionTraceView | null>(null);
	const [traceLoadingSessionId, setTraceLoadingSessionId] = useState<string | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(() => localStorage.getItem("pibo.chat.showThinking") !== "false");
	const [expandThinking, setExpandThinking] = useState(() => localStorage.getItem("pibo.chat.expandThinking") !== "false");
	const [showRawEvents, setShowRawEvents] = useState(() => localStorage.getItem("pibo.chat.showRawEvents") === "true");
	const [showArchived, setShowArchived] = useState(() => localStorage.getItem("pibo.chat.showArchived") === "true");
	const [showArchivedRooms, setShowArchivedRooms] = useState(() => localStorage.getItem("pibo.chat.showArchivedRooms") === "true");
	const [newSessionProfile, setNewSessionProfile] = useState(() => localStorage.getItem("pibo.chat.newSessionProfile") ?? "");
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const [creatingRoom, setCreatingRoom] = useState(false);
	const [deleteRoomTarget, setDeleteRoomTarget] = useState<PiboRoom | null>(null);
	const [deleteRoomConfirmName, setDeleteRoomConfirmName] = useState("");
	const [deletingRoom, setDeletingRoom] = useState(false);
	const [deleteSessionTarget, setDeleteSessionTarget] = useState<PiboWebSessionNode | null>(null);
	const [deleteSessionConfirmText, setDeleteSessionConfirmText] = useState("");
	const [deletingSession, setDeletingSession] = useState(false);
	const showArchivedRef = useRef(showArchived);
	const bootstrapRequestId = useRef(0);
	const traceRequestId = useRef(0);
	const selectedPiboSessionIdRef = useRef<string | null>(null);
	const traceViewSessionId = useRef<string | null>(null);
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);
	const activeRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? null;
	const selectedRoom = activeRoomId && bootstrap ? findRoomById(bootstrap.rooms, activeRoomId) ?? bootstrap.room : undefined;
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;

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

	const navigateToRoute = useCallback(
		(target: ChatAppRoute, replace = false) => {
			if (target.area === "agents") {
				void navigate({ to: "/agents", replace });
				return;
			}
			if (target.area === "settings") {
				void navigate({ to: "/settings", replace });
				return;
			}
			if (target.roomId && target.piboSessionId) {
				void navigate({
					to: "/rooms/$roomId/sessions/$piboSessionId",
					params: { roomId: target.roomId, piboSessionId: target.piboSessionId },
					replace,
				});
				return;
			}
			if (target.roomId) {
				void navigate({ to: "/rooms/$roomId", params: { roomId: target.roomId }, replace });
				return;
			}
			if (target.piboSessionId) {
				void navigate({ to: "/sessions/$piboSessionId", params: { piboSessionId: target.piboSessionId }, replace });
				return;
			}
			void navigate({ to: "/", replace });
		},
		[navigate],
	);

	const navigateToSelectedSession = useCallback(
		(roomId: string | undefined, piboSessionId: string | undefined, replace = false) => {
			if (!piboSessionId) {
				navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}) }, replace);
				return;
			}
			navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}), piboSessionId }, replace);
		},
		[navigateToRoute],
	);

	const loadBootstrap = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadBootstrapOptions = {},
	) => {
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await getBootstrap(piboSessionId, includeArchived, roomId, options.selectSession !== false);
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
		const storedPiboSessionId = routeRoomId ? stored.sessionsByRoom?.[routeRoomId] : stored.piboSessionId;
		const requestedRoomId = route.area === "sessions" ? (routeRoomId ?? (!routePiboSessionId ? stored.roomId : undefined)) : stored.roomId;
		const requestedPiboSessionId = route.area === "sessions"
			? (routePiboSessionId ?? (!routePiboSessionId ? storedPiboSessionId : undefined))
			: stored.piboSessionId;

		const canonicalizeSessionsRoute = (data: BootstrapData, replace = true) => {
			if (route.area !== "sessions") return;
			if (!data.selectedPiboSessionId) return;
			if (route.roomId === data.selectedRoomId && route.piboSessionId === data.selectedPiboSessionId) return;
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, replace);
		};

		loadBootstrap(requestedPiboSessionId, showArchivedRef.current, requestedRoomId)
			.then((data) => {
				canonicalizeSessionsRoute(data);
				setError(null);
			})
			.catch((caught) => {
				if (route.area === "sessions" && routeRoomId && !routePiboSessionId && requestedPiboSessionId) {
					removeStoredRoomSelection(routeRoomId);
					loadBootstrap(undefined, showArchivedRef.current, routeRoomId)
						.then((data) => {
							canonicalizeSessionsRoute(data);
							setError(null);
						})
						.catch((fallbackCaught) =>
							setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
						);
					return;
				}
				const explicitRouteSelection = route.area === "sessions" && Boolean(routeRoomId || routePiboSessionId);
				if (explicitRouteSelection || (!requestedPiboSessionId && !requestedRoomId)) {
					setError(caught instanceof Error ? caught.message : String(caught));
					return;
				}
				clearStoredSelection();
				loadBootstrap()
					.then((data) => {
						canonicalizeSessionsRoute(data);
						setError(null);
					})
					.catch((fallbackCaught) =>
						setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
					);
			});
	}, [loadBootstrap, navigateToSelectedSession, route.area, routePiboSessionId, routeRoomId]);

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
			if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END") {
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

	const setPreferredNewSessionProfile = useCallback((profile: string) => {
		setNewSessionProfile(profile);
		localStorage.setItem("pibo.chat.newSessionProfile", profile);
	}, []);

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
		const data = await loadBootstrap(piboSessionId);
		navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
	}, [loadBootstrap, navigateToSelectedSession]);

	const selectRoom = useCallback(async (roomId: string) => {
		const storedPiboSessionId = readStoredSelection().sessionsByRoom?.[roomId];
		setSelectedRoomId(roomId);
		setSelectedPiboSessionId(storedPiboSessionId ?? null);
		if (storedPiboSessionId) setTraceLoadingSessionId(storedPiboSessionId);
		setTraceView(null);
		try {
			const data = await loadBootstrap(storedPiboSessionId, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
		} catch (caught) {
			if (!storedPiboSessionId) throw caught;
			removeStoredRoomSelection(roomId);
			setSelectedPiboSessionId(null);
			const data = await loadBootstrap(undefined, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
		} finally {
			setTraceLoadingSessionId(null);
		}
	}, [loadBootstrap, navigateToSelectedSession]);

	const createSession = async (profile = newSessionProfile) => {
		if (creatingSession || selectedRoomArchived) return;
		setCreatingSession(true);
		try {
			const created = await postSession(profile || undefined, selectedRoomId ?? undefined);
			setTraceLoadingSessionId(created.session.id);
			setSelectedPiboSessionId(created.session.id);
			setTraceView(null);
			const data = await loadBootstrap(created.session.id, showArchivedRef.current, selectedRoomId ?? undefined);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
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
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
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
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
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
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const requestSessionDelete = (node: PiboWebSessionNode) => {
		setDeleteSessionTarget(node);
		setDeleteSessionConfirmText("");
	};

	const permanentlyDeleteSession = async () => {
		if (!deleteSessionTarget) return;
		setDeletingSession(true);
		try {
			const deleted = await deleteSession(deleteSessionTarget.piboSessionId, deleteSessionConfirmText);
			const deletedSelected = selectedPiboSessionId ? deleted.deletedSessionIds.includes(selectedPiboSessionId) : false;
			if (deletedSelected) {
				setSelectedPiboSessionId(null);
				setTraceView(null);
			}
			const data = await loadBootstrap(
				deletedSelected ? undefined : (selectedPiboSessionId ?? undefined),
				showArchivedRef.current,
				selectedRoomId ?? undefined,
			);
			if (area === "sessions") {
				if (data.selectedPiboSessionId !== selectedPiboSessionId) {
					setTraceLoadingSessionId(data.selectedPiboSessionId);
					setTraceView(null);
				}
				navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			}
			setDeleteSessionTarget(null);
			setDeleteSessionConfirmText("");
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingSession(false);
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
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, roomId);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setRoomArchived = async (roomId: string, archived: boolean) => {
		try {
			await patchRoom(roomId, { archived });
			if (archived) {
				setShowArchivedRooms(true);
				localStorage.setItem("pibo.chat.showArchivedRooms", "true");
			}
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const requestRoomDelete = (room: PiboRoom) => {
		setDeleteRoomTarget(room);
		setDeleteRoomConfirmName("");
	};

	const permanentlyDeleteRoom = async () => {
		if (!deleteRoomTarget) return;
		setDeletingRoom(true);
		try {
			await deleteRoom(deleteRoomTarget.id, deleteRoomConfirmName);
			if (selectedRoomId === deleteRoomTarget.id) {
				setSelectedRoomId(null);
				setSelectedPiboSessionId(null);
				setTraceView(null);
			}
			const data = await loadBootstrap(undefined, showArchivedRef.current);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			setDeleteRoomTarget(null);
			setDeleteRoomConfirmName("");
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingRoom(false);
		}
	};

	const runCommand = async (text: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return false;
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
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await loadTrace(selectedPiboSessionId);
		}
		return true;
	};

	const forkFrom = useCallback(async (entryId: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return;
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
	}, [selectSession, selectedPiboSessionId, selectedRoomArchived]);

	const openSession = useCallback((piboSessionId: string) => void selectSession(piboSessionId), [selectSession]);

	if (error && !bootstrap) {
		return <SignedOut message={error} />;
	}

	if (!bootstrap) {
		return <div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">Loading Pibo Chat...</div>;
	}
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const sessionGroups = splitSessionNodesByArchive(bootstrap.sessions);
	const personalRoom = findPersonalRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);

	return (
		<div className="h-screen overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[56px_1fr]">
			<header className="flex items-center justify-between gap-3 px-4 bg-[#1a262b] border-b border-slate-800">
				<div className="font-extrabold tracking-[0.08em] uppercase text-lg">Pibo Chat</div>
				<nav className="flex gap-1">
					{(["sessions", "agents", "settings"] as const).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => {
								if (item === "sessions") {
									navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
									return;
								}
								navigateToRoute({ area: item });
							}}
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
				className={`min-h-0 ${
					area === "agents" ? "h-full overflow-hidden" : `grid ${
						showRawEvents
						? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
						: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-[240px_minmax(0,1fr)]"
					}`
				}`}
			>
				{area === "agents" ? (
					<AgentsView
						agents={bootstrap.agents}
						initialCustomAgents={bootstrap.customAgents}
						initialCatalog={bootstrap.agentCatalog}
						onSelect={setPreferredNewSessionProfile}
						onCreateSession={(profile) => void createSession(profile)}
						onAgentsChanged={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { selectSession: false })}
						creatingSession={creatingSession || selectedRoomArchived}
					/>
				) : (
				<>
				<aside className="min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800">
					<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
						<span>{area}</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() =>
									void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined).then((data) => {
										if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
									})
								}
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
										{personalRoom ? (
											<div className="mb-3">
												<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Personal Chat</div>
												<RoomNode
													room={personalRoom}
													selectedRoomId={selectedRoomId}
													onSelect={(roomId) => void selectRoom(roomId)}
													onUpdate={(roomId, input) => void updateRoom(roomId, input)}
													onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
													onDelete={requestRoomDelete}
												/>
											</div>
										) : null}
										<div className="flex items-center justify-between gap-2 px-1 pb-1">
											<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rooms</div>
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => void createRoom()}
													disabled={creatingRoom}
													title="New Room"
													aria-label="New Room"
													className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
												>
													<Plus size={12} />
												</button>
												<button
													type="button"
													onClick={() => {
														const next = !showArchivedRooms;
														setShowArchivedRooms(next);
														localStorage.setItem("pibo.chat.showArchivedRooms", String(next));
													}}
													title={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
													aria-label={showArchivedRooms ? "Hide Archived Rooms" : "Show Archived Rooms"}
													className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedRooms ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
												>
													{showArchivedRooms ? <ArchiveRestore size={12} /> : <Archive size={12} />}
												</button>
											</div>
										</div>
										{roomGroups.active.map((room) => (
											<RoomNode
												key={room.id}
												room={room}
												selectedRoomId={selectedRoomId}
												onSelect={(roomId) => void selectRoom(roomId)}
												onUpdate={(roomId, input) => void updateRoom(roomId, input)}
												onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
												onDelete={requestRoomDelete}
											/>
										))}
										{roomGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No rooms</div> : null}
										{showArchivedRooms ? (
											<div className="mt-3">
												<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Rooms</div>
												{roomGroups.archived.map((room) => (
													<RoomNode
														key={room.id}
														room={room}
														selectedRoomId={selectedRoomId}
														onSelect={(roomId) => void selectRoom(roomId)}
														onUpdate={(roomId, input) => void updateRoom(roomId, input)}
														onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
														onDelete={requestRoomDelete}
													/>
												))}
												{roomGroups.archived.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived rooms</div> : null}
											</div>
										) : null}
									</div>
								) : null}
							<div>
								<div className="flex items-center justify-between gap-2 px-1 pb-1">
									<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
									<div className="flex items-center gap-1">
										<button
											type="button"
											onClick={() => void createSession()}
											disabled={creatingSession || selectedRoomArchived}
											title="New Session"
											aria-label="New Session"
											className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
										>
											<Plus size={12} />
										</button>
										<button
											type="button"
											onClick={() => void toggleArchivedSessions()}
											title={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
											aria-label={showArchived ? "Hide Archived Sessions" : "Show Archived Sessions"}
											className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${
												showArchived ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"
											}`}
										>
											{showArchived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
										</button>
									</div>
								</div>
								{sessionGroups.active.map((session) => (
									<SessionNode
										key={session.piboSessionId}
										node={session}
										selectedPiboSessionId={selectedPiboSessionId}
										onSelect={(piboSessionId) => void selectSession(piboSessionId)}
										onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
										onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
										onDelete={requestSessionDelete}
									/>
								))}
								{sessionGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No active sessions</div> : null}
							</div>
							{showArchived ? (
								<div>
									<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Sessions</div>
									{sessionGroups.archived.map((session) => (
										<SessionNode
											key={session.piboSessionId}
											node={session}
											selectedPiboSessionId={selectedPiboSessionId}
											onSelect={(piboSessionId) => void selectSession(piboSessionId)}
											onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
											onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
											onDelete={requestSessionDelete}
										/>
									))}
									{sessionGroups.archived.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived sessions</div> : null}
								</div>
							) : null}
						</div>
					) : (
						<SettingsSidebar />
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
								agentProfiles={bootstrap.agents}
								selectedAgentProfile={newSessionProfile}
								createSessionDisabled={creatingSession || selectedRoomArchived}
								onAgentProfileChange={setPreferredNewSessionProfile}
								onCreateSession={(profile) => void createSession(profile)}
								onFork={forkFrom}
								onOpenSession={openSession}
							/>
							<Composer
								disabled={!selectedPiboSessionId || selectedRoomArchived}
								commands={slashCommands}
								value={composerText}
								focusSignal={composerFocusSignal}
								onValueChange={setComposerText}
								onCommand={runCommand}
								onSend={async (text) => {
									if (!selectedPiboSessionId || selectedRoomArchived) return;
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
					{deleteRoomTarget ? (
						<DeleteRoomModal
							room={deleteRoomTarget}
							confirmName={deleteRoomConfirmName}
							deleting={deletingRoom}
							onConfirmNameChange={setDeleteRoomConfirmName}
							onCancel={() => {
								setDeleteRoomTarget(null);
								setDeleteRoomConfirmName("");
							}}
							onDelete={() => void permanentlyDeleteRoom()}
						/>
					) : null}
					{deleteSessionTarget ? (
					<DeleteSessionModal
						session={deleteSessionTarget}
						confirmText={deleteSessionConfirmText}
						deleting={deletingSession}
						onConfirmTextChange={setDeleteSessionConfirmText}
						onCancel={() => {
							setDeleteSessionTarget(null);
							setDeleteSessionConfirmText("");
						}}
						onDelete={() => void permanentlyDeleteSession()}
					/>
				) : null}
				</>
				)}
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

function DeleteSessionModal({
	session,
	confirmText,
	deleting,
	onConfirmTextChange,
	onCancel,
	onDelete,
}: {
	session: PiboWebSessionNode;
	confirmText: string;
	deleting: boolean;
	onConfirmTextChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Session</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{session.piboSessionId}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived session, its child sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{SESSION_DELETE_CONFIRM_TEXT}</span> to confirm.
					</div>
					<input
						value={confirmText}
						onChange={(event) => onConfirmTextChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={SESSION_DELETE_CONFIRM_TEXT}
						autoFocus
					/>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onCancel}
							disabled={deleting}
							className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onDelete}
							disabled={deleting || confirmText !== SESSION_DELETE_CONFIRM_TEXT}
							className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
						>
							<Trash2 size={14} />
							Delete permanently
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function DeleteRoomModal({
	room,
	confirmName,
	deleting,
	onConfirmNameChange,
	onCancel,
	onDelete,
}: {
	room: PiboRoom;
	confirmName: string;
	deleting: boolean;
	onConfirmNameChange: (value: string) => void;
	onCancel: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4">
			<div className="w-full max-w-lg border border-red-500/70 bg-[#1a262b] rounded-sm shadow-xl">
				<div className="px-4 py-3 border-b border-red-500/50 flex items-center justify-between gap-3">
					<div>
						<h2 className="text-sm font-bold uppercase tracking-wider text-red-200">Delete Room</h2>
						<div className="font-mono text-[11px] text-slate-500 truncate">{room.id}</div>
					</div>
					<button
						type="button"
						onClick={onCancel}
						disabled={deleting}
						title="Cancel"
						aria-label="Cancel"
						className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					>
						<X size={14} />
					</button>
				</div>
				<div className="p-4 grid gap-3">
					<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
						This permanently deletes the archived room, child rooms, all contained sessions, subagent sessions, and their Chat events. This cannot be undone.
					</div>
					<div className="text-sm text-slate-300">
						Type <span className="font-mono text-red-200">{room.name}</span> to confirm.
					</div>
					<input
						value={confirmName}
						onChange={(event) => onConfirmNameChange(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500"
						placeholder={room.name}
						autoFocus
					/>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onCancel}
							disabled={deleting}
							className="h-8 inline-flex items-center border border-slate-700 rounded-sm px-3 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onDelete}
							disabled={deleting || confirmName !== room.name}
							className="h-8 inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50"
						>
							<Trash2 size={14} />
							Delete permanently
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function UnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	const label = count > 99 ? "99+" : String(count);
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#0bda57] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages`}
			title={`${count} unread messages`}
		>
			{label}
		</span>
	);
}

function RoomNode({
	room,
	selectedRoomId,
	onSelect,
	onUpdate,
	onArchive,
	onDelete,
	depth = 0,
}: {
	room: PiboRoom;
	selectedRoomId: string | null;
	onSelect: (roomId: string) => void;
	onUpdate: (roomId: string, input: { name?: string; topic?: string | null }) => void;
	onArchive: (roomId: string, archived: boolean) => void;
	onDelete: (room: PiboRoom) => void;
	depth?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [draftName, setDraftName] = useState(room.name);
	const [draftTopic, setDraftTopic] = useState(room.topic ?? "");
	const personal = isPersonalRoom(room);
	const archived = isArchivedRoom(room);

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
				title={room.id}
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
								<span className="block text-[10px] font-mono truncate text-slate-500">{personal ? "locked personal room" : archived ? "archived" : room.topic || room.type}</span>
							</span>
							<UnreadBadge count={room.unreadCount} />
						</button>
						<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
							{personal ? (
								<span title="Personal Chat is locked" aria-label="Personal Chat is locked" className="h-7 w-7 inline-flex items-center justify-center border border-[#0bda57]/50 rounded-sm text-[#0bda57]">
									<Lock size={13} />
								</span>
							) : archived ? (
								<>
									<button
										type="button"
										onClick={() => onArchive(room.id, false)}
										title="Restore Room"
										aria-label="Restore Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<ArchiveRestore size={13} />
									</button>
									<button
										type="button"
										onClick={() => onDelete(room)}
										title="Delete Room"
										aria-label="Delete Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-red-500/70 rounded-sm text-red-300 hover:bg-red-500/10"
									>
										<Trash2 size={13} />
									</button>
								</>
							) : (
								<>
									<button
										type="button"
										onClick={() => setEditing(true)}
										title="Edit Room"
										aria-label="Edit Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<Edit3 size={13} />
									</button>
									<button
										type="button"
										onClick={() => onArchive(room.id, true)}
										title="Archive Room"
										aria-label="Archive Room"
										className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
									>
										<Archive size={13} />
									</button>
								</>
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
						onDelete={onDelete}
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
	onDelete,
	depth = 0,
}: {
	node: PiboWebSessionNode;
	selectedPiboSessionId: string | null;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	onDelete: (node: PiboWebSessionNode) => void;
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
							className="min-w-0 text-left px-1 py-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className="min-w-0">
								<span className={`block text-sm truncate ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{node.title}</span>
								<span className="block text-[10px] font-mono truncate text-slate-500">{node.piboSessionId}</span>
							</span>
							<UnreadBadge count={node.unreadCount} />
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
						{node.archived ? (
							<button
								type="button"
								onClick={() => onDelete(node)}
								title="Delete Session"
								aria-label="Delete Session"
								className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-300"
							>
								<Trash2 size={13} />
							</button>
						) : null}
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
					onDelete={onDelete}
					depth={depth + 1}
				/>
			)) : null}
		</div>
	);
}

function sessionTreeHasSession(nodes: PiboWebSessionNode[], piboSessionId: string): boolean {
	return nodes.some((node) => node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId));
}

function splitSessionNodesByArchive(nodes: PiboWebSessionNode[]): {
	active: PiboWebSessionNode[];
	archived: PiboWebSessionNode[];
} {
	const active: PiboWebSessionNode[] = [];
	const archived: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (node.archived) {
			archived.push(node);
			continue;
		}
		const children = splitSessionNodesByArchive(node.children);
		active.push({ ...node, children: children.active });
		archived.push(...children.archived);
	}
	return { active, archived };
}

function findPersonalRoom(rooms: PiboRoom[]): PiboRoom | undefined {
	for (const room of rooms) {
		if (isPersonalRoom(room)) return room;
		const child = findPersonalRoom(room.children ?? []);
		if (child) return child;
	}
	return undefined;
}

function findRoomById(rooms: PiboRoom[], roomId: string): PiboRoom | undefined {
	for (const room of rooms) {
		if (room.id === roomId) return room;
		const child = findRoomById(room.children ?? [], roomId);
		if (child) return child;
	}
	return undefined;
}

function splitRoomNodes(nodes: PiboRoom[]): {
	active: PiboRoom[];
	archived: PiboRoom[];
} {
	const active: PiboRoom[] = [];
	const archived: PiboRoom[] = [];
	for (const node of nodes) {
		if (isPersonalRoom(node)) {
			const children = splitRoomNodes(node.children ?? []);
			active.push(...children.active);
			archived.push(...children.archived);
			continue;
		}
		if (isArchivedRoom(node)) {
			archived.push(node);
			continue;
		}
		const children = splitRoomNodes(node.children ?? []);
		active.push({ ...node, children: children.active });
		archived.push(...children.archived);
	}
	return { active, archived };
}

function isPersonalRoom(room: PiboRoom): boolean {
	return room.metadata.default === true;
}

function isArchivedRoom(room: PiboRoom): boolean {
	return typeof room.metadata.chatRoomArchivedAt === "string";
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
	initialCustomAgents,
	initialCatalog,
	onSelect,
	onCreateSession,
	onAgentsChanged,
	creatingSession,
}: {
	agents: BootstrapData["agents"];
	initialCustomAgents: CustomAgent[];
	initialCatalog?: AgentCatalog;
	onSelect: (profile: string) => void;
	onCreateSession: (profile: string) => void;
	onAgentsChanged: () => void;
	creatingSession: boolean;
}) {
	const [catalog, setCatalog] = useState<AgentCatalog | null>(initialCatalog ?? null);
	const [customAgents, setCustomAgents] = useState(initialCustomAgents);
	const [draft, setDraft] = useState<AgentDraft>(() => createBlankAgentDraft(initialCatalog));
	const [saving, setSaving] = useState(false);
	const [showArchivedAgents, setShowArchivedAgents] = useState(() => localStorage.getItem("pibo.chat.showArchivedAgents") === "true");
	const [deleteConfirmName, setDeleteConfirmName] = useState("");
	const [localError, setLocalError] = useState<string | null>(null);
	const designerAvailable = Boolean(catalog);

	useEffect(() => setCustomAgents(initialCustomAgents), [initialCustomAgents]);
	useEffect(() => {
		if (initialCatalog) setCatalog(initialCatalog);
	}, [initialCatalog]);
	const customProfileNames = useMemo(() => new Set(customAgents.map((agent) => agent.profileName)), [customAgents]);
	const pluginProfiles = useMemo(
		() => agents.filter((agent) => !customProfileNames.has(agent.name)),
		[agents, customProfileNames],
	);
	const activeCustomAgents = useMemo(() => customAgents.filter((agent) => !agent.archivedAt), [customAgents]);
	const archivedCustomAgents = useMemo(() => customAgents.filter((agent) => agent.archivedAt), [customAgents]);
	const profileOptions = useMemo(
		() => uniqueProfileOptions(agents, activeCustomAgents),
		[agents, activeCustomAgents],
	);
	const archivedDraft = Boolean(draft.archivedAt);
	const readOnly = draft.source === "profile" || archivedDraft;
	const agentNameError = readOnly ? null : validateAgentName(draft.displayName);
	const draftProfileName = draft.profileName ?? (agentNameError ? "new custom profile" : draft.displayName);

	const saveDraft = async () => {
		if (readOnly) return;
		if (agentNameError) {
			setLocalError(agentNameError);
			return;
		}
		if (!designerAvailable) {
			setLocalError(agentDesignerUnavailableMessage());
			return;
		}
		setSaving(true);
		try {
			const input: SaveCustomAgentInput = {
				displayName: draft.displayName.trim(),
				description: (draft.description ?? "").trim() || undefined,
				nativeTools: draft.nativeTools,
				skills: draft.skills,
				contextFiles: draft.contextFiles,
				subagents: draft.subagents.filter((item) => item.name.trim() && item.targetProfile.trim()),
				builtinTools: draft.builtinTools,
				autoContextFiles: draft.autoContextFiles,
				runControl: draft.runControl,
			};
			const response = draft.id ? await patchCustomAgent(draft.id, input) : await postCustomAgent(input);
			setCustomAgents((current) => {
				const withoutSaved = current.filter((agent) => agent.id !== response.agent.id);
				return [response.agent, ...withoutSaved];
			});
			setDraft(agentToDraft(response.agent));
			onSelect(response.agent.profileName);
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setLocalError(isNotFoundError(message) ? agentDesignerUnavailableMessage() : message);
		} finally {
			setSaving(false);
		}
	};

	const setDraftArchived = async (archived: boolean) => {
		if (!draft.id || draft.source !== "custom") return;
		setSaving(true);
		try {
			const response = await patchCustomAgent(draft.id, { archived });
			if (archived) {
				setShowArchivedAgents(true);
				localStorage.setItem("pibo.chat.showArchivedAgents", "true");
			}
			setCustomAgents((current) => current.map((agent) => (agent.id === response.agent.id ? response.agent : agent)));
			setDraft(agentToDraft(response.agent));
			setDeleteConfirmName("");
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const deleteDraft = async () => {
		if (!draft.id || !draft.profileName || !archivedDraft) return;
		setSaving(true);
		try {
			await deleteCustomAgent(draft.id, deleteConfirmName);
			setCustomAgents((current) => current.filter((agent) => agent.id !== draft.id));
			setDraft(createBlankAgentDraft(catalog ?? undefined));
			setDeleteConfirmName("");
			onAgentsChanged();
			setLocalError(null);
		} catch (caught) {
			setLocalError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="h-full min-h-0 overflow-hidden grid grid-cols-[300px_minmax(0,1fr)] max-[920px]:grid-cols-1">
			<aside className="border-r border-slate-800 bg-[#1a262b] min-h-0 overflow-auto">
				<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider">
					<span>Agents</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={() => setDraft(createBlankAgentDraft(catalog ?? undefined))} title="New Agent" aria-label="New Agent" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<Plus size={13} />
						</button>
						<button
							type="button"
							onClick={() => {
								const next = !showArchivedAgents;
								setShowArchivedAgents(next);
								localStorage.setItem("pibo.chat.showArchivedAgents", String(next));
							}}
							title={showArchivedAgents ? "Hide Archived Agents" : "Show Archived Agents"}
							aria-label={showArchivedAgents ? "Hide Archived Agents" : "Show Archived Agents"}
							className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedAgents ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}
						>
							{showArchivedAgents ? <ArchiveRestore size={13} /> : <Archive size={13} />}
						</button>
						<button type="button" onClick={onAgentsChanged} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
							<RefreshCw size={13} />
						</button>
					</div>
				</div>
				<div className="p-2">
					<AgentList title="Custom Agents">
						{activeCustomAgents.map((agent) => (
							<AgentSidebarRow
								key={agent.id}
								title={agent.displayName}
								subtitle={agent.profileName}
								selected={draft.source === "custom" && draft.id === agent.id}
								onSelect={() => {
									setDraft(agentToDraft(agent));
									onSelect(agent.profileName);
								}}
								onCopy={() => setDraft(copyCustomAgentToDraft(agent))}
								onCreateSession={() => {
									onSelect(agent.profileName);
									onCreateSession(agent.profileName);
								}}
								createSessionDisabled={creatingSession}
							/>
						))}
						{activeCustomAgents.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No custom agents</div> : null}
					</AgentList>
					{showArchivedAgents ? (
						<AgentList title="Archived Custom Agents">
							{archivedCustomAgents.map((agent) => (
								<AgentSidebarRow
									key={agent.id}
									title={agent.displayName}
									subtitle={agent.profileName}
									selected={draft.source === "custom" && draft.id === agent.id}
									onSelect={() => {
										setDraft(agentToDraft(agent));
									}}
									onCopy={() => setDraft(copyCustomAgentToDraft(agent))}
									onCreateSession={() => {}}
									createSessionDisabled
								/>
							))}
							{archivedCustomAgents.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived agents</div> : null}
						</AgentList>
					) : null}
					<AgentList title="Read-only Profiles">
						{pluginProfiles.map((agent) => (
							<AgentSidebarRow
								key={agent.name}
								title={agent.name}
								subtitle={agent.aliases.join(", ") || "plugin"}
								selected={draft.source === "profile" && draft.profileName === agent.name}
								onSelect={() => {
									setDraft(profileToDraft(agent, catalog ?? undefined));
									onSelect(agent.name);
								}}
								onCopy={() => setDraft(copyProfileToDraft(agent, catalog ?? undefined))}
								onCreateSession={() => {
									onSelect(agent.name);
									onCreateSession(agent.name);
								}}
								createSessionDisabled={creatingSession}
							/>
						))}
					</AgentList>
				</div>
			</aside>
			<section className="min-h-0 overflow-auto p-5">
				<div className="flex items-center justify-between gap-3 mb-4">
					<div className="min-w-0">
						<h1 className="text-sm font-bold uppercase tracking-wider">Agent Designer</h1>
						<div className="font-mono text-[11px] text-slate-500 truncate">{draftProfileName}</div>
						<div className="text-[11px] uppercase tracking-wider text-slate-500">{draft.source === "profile" ? "read-only plugin profile" : archivedDraft ? "archived custom agent" : "custom agent"}</div>
					</div>
					<div className="flex items-center gap-2">
						<button type="button" onClick={() => { if (draft.profileName) { onSelect(draft.profileName); onCreateSession(draft.profileName); } }} disabled={!draft.profileName || creatingSession || archivedDraft} title="New Session With Agent" aria-label="New Session With Agent" className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<MessageSquarePlus size={14} />
						</button>
						{draft.source === "custom" && draft.id ? (
							<button type="button" onClick={() => void setDraftArchived(!archivedDraft)} disabled={saving} title={archivedDraft ? "Restore Agent" : "Archive Agent"} aria-label={archivedDraft ? "Restore Agent" : "Archive Agent"} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
								{archivedDraft ? <ArchiveRestore size={14} /> : <Archive size={14} />}
							</button>
						) : null}
						<button type="button" onClick={() => void saveDraft()} disabled={readOnly || !designerAvailable || saving || Boolean(agentNameError)} title="Save Agent" aria-label="Save Agent" className="h-8 w-8 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
							<Save size={14} />
						</button>
					</div>
				</div>
				{designerAvailable ? null : <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">{agentDesignerUnavailableMessage()}</div>}
				{draft.source === "profile" ? <div className="mb-3 border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-sm rounded-sm">This profile is registered by a plugin. Copy it to create an editable custom agent.</div> : null}
				{archivedDraft ? <div className="mb-3 border border-[#f59e0b]/60 bg-[#f59e0b]/10 text-amber-100 px-3 py-2 text-sm rounded-sm">This agent is archived. Restore it before editing or starting new sessions.</div> : null}
				{localError ? <div className="mb-3 border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{localError}</div> : null}
				<div className="grid gap-4">
					<DesignerPanel title="Basics">
						<input value={draft.displayName} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className={`min-w-0 bg-[#0e1116] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60 ${agentNameError ? "border-[#f59e0b]" : "border-slate-700"}`} placeholder="agent-name" />
						{agentNameError ? <div className="text-xs text-amber-100">{agentNameError}</div> : null}
						<textarea value={draft.description} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-[72px] bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="Description" />
						<label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" disabled={readOnly} checked={draft.autoContextFiles} onChange={(event) => setDraft((current) => ({ ...current, autoContextFiles: event.target.checked }))} />Load AGENTS.md / CLAUDE.md</label>
						<label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" disabled={readOnly} checked={draft.builtinTools === "disabled"} onChange={(event) => setDraft((current) => ({ ...current, builtinTools: event.target.checked ? "disabled" : "default" }))} />Disable Pi built-in tools</label>
					</DesignerPanel>
					<CatalogSection title="Native Tools">{catalog?.nativeTools.map((tool) => <CatalogToggle key={tool.name} disabled={readOnly} checked={draft.nativeTools.includes(tool.name)} title={tool.name} description={tool.description} meta={tool.yieldable ? "yieldable" : "direct only"} onToggle={() => setDraft((current) => ({ ...current, nativeTools: toggleName(current.nativeTools, tool.name) }))} />) ?? <EmptyCatalog />}</CatalogSection>
					<CatalogSection title="Skills">{catalog?.skills.map((skill) => <CatalogToggle key={skill.name} disabled={readOnly} checked={draft.skills.includes(skill.name)} title={skill.name} description={skill.path} onToggle={() => setDraft((current) => ({ ...current, skills: toggleName(current.skills, skill.name) }))} />) ?? <EmptyCatalog />}</CatalogSection>
					<CatalogSection title="Packages"><CatalogToggle disabled={readOnly} checked={draft.runControl} title="pibo-run-control" description="Expose pibo_run_* as one package for yielded native tools and subagents." meta="package" onToggle={() => setDraft((current) => ({ ...current, runControl: !current.runControl }))} /></CatalogSection>
					<CatalogSection title="Context Files">{catalog?.contextFiles.map((contextFile) => <CatalogToggle key={contextFile.key} disabled={readOnly} checked={draft.contextFiles.includes(contextFile.key)} title={contextFile.label ?? contextFile.key} description={contextFile.path} onToggle={() => setDraft((current) => ({ ...current, contextFiles: toggleName(current.contextFiles, contextFile.key) }))} />) ?? <EmptyCatalog />}</CatalogSection>
					<SubagentDesigner draft={draft} setDraft={setDraft} profileOptions={profileOptions} readOnly={readOnly} />
					{archivedDraft && draft.profileName ? (
						<DesignerPanel title="Delete Agent">
							<div className="border border-red-500/60 bg-red-500/10 text-red-100 rounded-sm p-3 text-sm">
								Permanently deleting this agent also deletes all Chat sessions that use profile <span className="font-mono">{draft.profileName}</span>.
							</div>
							<input value={deleteConfirmName} onChange={(event) => setDeleteConfirmName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-red-500" placeholder={draft.profileName} />
							<button type="button" onClick={() => void deleteDraft()} disabled={saving || deleteConfirmName !== draft.profileName} className="h-8 w-fit inline-flex items-center gap-2 border border-red-500 rounded-sm px-3 text-red-200 bg-red-500/10 disabled:opacity-50">
								<Trash2 size={14} />
								Delete permanently
							</button>
						</DesignerPanel>
					) : null}
				</div>
			</section>
		</div>
	);
}

type AgentDraft = SaveCustomAgentInput & {
	id?: string;
	profileName?: string;
	archivedAt?: string;
	source: "custom" | "profile";
};

function createBlankAgentDraft(catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: "new-agent",
		description: "",
		nativeTools: [],
		skills: catalog?.skills.some((skill) => skill.name === "pi-agent-harness") ? ["pi-agent-harness"] : [],
		contextFiles: [],
		subagents: [],
		builtinTools: "default",
		autoContextFiles: true,
		runControl: false,
		source: "custom",
	};
}

function agentToDraft(agent: CustomAgent): AgentDraft {
	return {
		id: agent.id,
		profileName: agent.profileName,
		displayName: agent.displayName,
		description: agent.description ?? "",
		nativeTools: agent.nativeTools,
		skills: agent.skills,
		contextFiles: agent.contextFiles,
		subagents: agent.subagents,
		builtinTools: agent.builtinTools,
		autoContextFiles: agent.autoContextFiles ?? true,
		runControl: agent.runControl,
		archivedAt: agent.archivedAt,
		source: "custom",
	};
}

function profileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: profile.name,
		description: profile.description ?? "",
		nativeTools: profile.nativeTools ?? [],
		skills: profile.skills ?? (catalog?.skills.some((skill) => skill.name === "pi-agent-harness") ? ["pi-agent-harness"] : []),
		contextFiles: profile.contextFiles ?? [],
		subagents: profile.subagents ?? [],
		builtinTools: profile.builtinTools ?? "default",
		autoContextFiles: profile.autoContextFiles ?? true,
		runControl: profile.runControl ?? false,
		profileName: profile.name,
		source: "profile",
	};
}

function copyProfileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	const draft = profileToDraft(profile, catalog);
	return {
		...draft,
		displayName: `${profile.name}-copy`,
		id: undefined,
		profileName: undefined,
		source: "custom",
	};
}

function copyCustomAgentToDraft(agent: CustomAgent): AgentDraft {
	const draft = agentToDraft(agent);
	return {
		...draft,
		displayName: `${agent.profileName}-copy`,
		id: undefined,
		profileName: undefined,
		archivedAt: undefined,
		source: "custom",
	};
}

function uniqueProfileOptions(
	agents: BootstrapData["agents"],
	customAgents: CustomAgent[],
): Array<{ value: string; label: string }> {
	const options = new Map<string, string>();
	for (const agent of agents) options.set(agent.name, agent.name);
	for (const agent of customAgents) options.set(agent.profileName, agent.displayName);
	return [...options.entries()].map(([value, label]) => ({ value, label }));
}

function validateAgentName(name: string): string | null {
	if (!name.trim()) return "Agent name is required.";
	if (name.length > 120) return "Agent name is too long.";
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
		return "Use lowercase kebab-case only, for example test-agent.";
	}
	return null;
}

function toggleName(names: string[], name: string): string[] {
	return names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
}

function AgentList({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="mb-4">
			<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			{children}
		</div>
	);
}

function AgentSidebarRow({
	title,
	subtitle,
	selected,
	onSelect,
	onCopy,
	onCreateSession,
	createSessionDisabled,
}: {
	title: string;
	subtitle: string;
	selected: boolean;
	onSelect: () => void;
	onCopy?: () => void;
	onCreateSession: () => void;
	createSessionDisabled: boolean;
}) {
	return (
		<div className={`mb-1 border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent hover:border-slate-700"}`}>
			<div className="grid grid-cols-[1fr_auto_auto] items-center gap-1 p-1">
				<button type="button" onClick={onSelect} className="min-w-0 text-left px-1 py-1">
					<span className="block text-sm truncate text-slate-200">{title}</span>
					<span className="block text-[10px] font-mono truncate text-slate-500">{subtitle}</span>
				</button>
				{onCopy ? (
					<button type="button" onClick={onCopy} title="Copy To Custom Agent" aria-label="Copy To Custom Agent" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<CopyPlus size={13} />
					</button>
				) : (
					<span className="h-7 w-7" />
				)}
				<button type="button" onClick={onCreateSession} disabled={createSessionDisabled} title="New Session With Profile" aria-label="New Session With Profile" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
					<MessageSquarePlus size={13} />
				</button>
			</div>
		</div>
	);
}

function SettingsSidebar() {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Settings</div>
				<button
					type="button"
					className="w-full mb-1 border border-[#11a4d4] bg-[#11a4d4]/10 rounded-sm text-left p-2"
				>
					<span className="block text-sm truncate text-slate-200">General</span>
					<span className="block text-[10px] font-mono truncate text-slate-500">browser-local</span>
				</button>
			</div>
		</div>
	);
}

function DesignerPanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="border border-slate-700 bg-[#1a262b] rounded-sm p-4">
			<div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">{title}</div>
			<div className="grid gap-3">{children}</div>
		</div>
	);
}

function CatalogSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<DesignerPanel title={title}>
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{children}</div>
		</DesignerPanel>
	);
}

function CatalogToggle({
	checked,
	disabled,
	title,
	description,
	meta,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	title: string;
	description?: string;
	meta?: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			disabled={disabled}
			className={`min-w-0 border rounded-sm p-2 text-left grid grid-cols-[18px_1fr] gap-2 disabled:opacity-60 ${
				checked ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"
			}`}
		>
			<span className={`mt-0.5 h-4 w-4 border rounded-sm inline-flex items-center justify-center ${checked ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-600"}`}>
				{checked ? <Check size={12} /> : null}
			</span>
			<span className="min-w-0">
				<span className="block text-sm truncate text-slate-200">{title}</span>
				{description ? <span className="block text-xs text-slate-500 truncate">{description}</span> : null}
				{meta ? <span className="block font-mono text-[10px] text-slate-600 mt-1">{meta}</span> : null}
			</span>
		</button>
	);
}

function EmptyCatalog() {
	return <div className="text-xs text-amber-100 border border-dashed border-[#f59e0b]/50 bg-[#f59e0b]/10 rounded-sm p-3">Agent Designer API unavailable</div>;
}

function agentDesignerUnavailableMessage(): string {
	return "Agent Designer API unavailable. Restart the Pibo web gateway after pulling/building the latest backend.";
}

function isNotFoundError(message: string): boolean {
	return message.toLowerCase().includes("not found") || message.includes("404");
}

function SubagentDesigner({
	draft,
	setDraft,
	profileOptions,
	readOnly,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	profileOptions: Array<{ value: string; label: string }>;
	readOnly: boolean;
}) {
	const updateSubagent = (index: number, patch: Partial<CustomAgentSubagent>) => {
		setDraft((current) => ({
			...current,
			subagents: current.subagents.map((subagent, itemIndex) => itemIndex === index ? { ...subagent, ...patch } : subagent),
		}));
	};

	return (
		<DesignerPanel title="Subagents">
			<div className="flex justify-end">
				<button
					type="button"
					disabled={readOnly}
					onClick={() => setDraft((current) => ({
						...current,
						subagents: [...current.subagents, { name: "helper", targetProfile: profileOptions[0]?.value ?? "pibo-minimal", maxDepth: 3 }],
					}))}
					className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
					title="Add Subagent"
					aria-label="Add Subagent"
				>
					<Plus size={13} />
				</button>
			</div>
			<div className="grid gap-2">
				{draft.subagents.map((subagent, index) => (
					<div key={index} className="grid grid-cols-[1fr_1fr_80px_auto] max-[1100px]:grid-cols-1 gap-2 border border-slate-800 bg-[#151f24] p-2 rounded-sm">
						<input value={subagent.name} disabled={readOnly} onChange={(event) => updateSubagent(index, { name: event.target.value })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="name" />
						<select value={subagent.targetProfile} disabled={readOnly} onChange={(event) => updateSubagent(index, { targetProfile: event.target.value })} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60">
							{profileOptions.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
						</select>
						<input type="number" min={1} disabled={readOnly} value={subagent.maxDepth ?? 3} onChange={(event) => updateSubagent(index, { maxDepth: Number(event.target.value) || 1 })} className="bg-[#0e1116] border border-slate-700 rounded-sm px-2 py-1 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" />
						<button type="button" disabled={readOnly} onClick={() => setDraft((current) => ({ ...current, subagents: current.subagents.filter((_, itemIndex) => itemIndex !== index) }))} className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-300 disabled:opacity-50" title="Remove Subagent" aria-label="Remove Subagent">
							<X size={14} />
						</button>
					</div>
				))}
				{draft.subagents.length === 0 ? <div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">No subagents configured</div> : null}
			</div>
		</DesignerPanel>
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
				General
			</h1>
			<DesignerPanel title="General">
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
				<label className="flex items-center gap-2 text-sm">
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
			</DesignerPanel>
		</div>
	);
}

type RawEvent = PiboSessionTraceView["rawEvents"][number];
type CompactRawEvent = RawEvent & { count: number };

type ChatStreamEventMeta = {
	streamFrameId?: string;
	streamFrameIndex?: number;
};

type ChatStreamEvent = ChatStreamEventMeta & (
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
	| { type: "RAW_EVENT"; event: unknown }
);

function chatStreamEvent(message: MessageEvent): ChatStreamEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		if (typeof parsed.type !== "string") return undefined;
		const streamFrameIndex = streamFrameIndexFromId(message.lastEventId);
		return {
			...(parsed as ChatStreamEvent),
			...(message.lastEventId ? { streamFrameId: message.lastEventId } : {}),
			...(streamFrameIndex === undefined ? {} : { streamFrameIndex }),
		};
	} catch {
		return undefined;
	}
}

function streamFrameIndexFromId(value: string): number | undefined {
	const frame = value.split(":")[1];
	if (frame === undefined) return undefined;
	const parsed = Number(frame);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function liveOrder(event: ChatStreamEvent, nodeType: PiboTraceNode["type"]): PiboTraceOrderKey {
	return liveTraceOrder(event.streamFrameIndex, nodeType);
}

function applyChatStreamEvents(view: PiboSessionTraceView, events: ChatStreamEvent[]): PiboSessionTraceView {
	if (!events.length) return view;
	return events.reduce(applyChatStreamEvent, view);
}

function applyChatStreamEvent(view: PiboSessionTraceView, event: ChatStreamEvent): PiboSessionTraceView {
	if (event.type === "ready") return view;
	if (event.streamFrameId && view.rawEvents.some((rawEvent) => rawEvent.id === `stream:${event.streamFrameId}`)) {
		return view;
	}
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
				source: "live",
				stableKey: `turn:${event.runId}`,
				orderKey: liveOrder(event, "agent.turn"),
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
				source: "live",
				stableKey: `error:${event.runId ?? createdAt}`,
				orderKey: liveOrder(event, "error"),
				children: [],
			});
			break;
		}
		case "TEXT_MESSAGE_START":
			nodes = upsertTraceNode(nodes, assistantNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "assistant.message")));
			break;
		case "TEXT_MESSAGE_CONTENT":
			nodes = appendTextToNode(nodes, assistantNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "assistant.message")), event.delta);
			break;
		case "TEXT_MESSAGE_END":
			nodes = upsertTraceNode(nodes, {
				...assistantNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "assistant.message")),
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
			nodes = upsertTraceNode(nodes, reasoningNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "model.reasoning")));
			break;
		case "REASONING_MESSAGE_CONTENT":
			nodes = appendTextToNode(nodes, reasoningNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "model.reasoning")), event.delta);
			break;
		case "REASONING_MESSAGE_END":
			nodes = upsertTraceNode(nodes, {
				...reasoningNode(event.messageId, view.piboSessionId, createdAt, liveOrder(event, "model.reasoning")),
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
				source: "live",
				stableKey: `tool:${event.toolCallId}`,
				orderKey: liveOrder(event, "tool.call"),
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
				source: "live",
				stableKey: event.toolCallId ? `tool:${event.toolCallId}` : `subagent:${event.childPiboSessionId}`,
				orderKey: liveOrder(event, "agent.delegation"),
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
				source: "live",
				stableKey: `execution:${event.runId ?? event.action}`,
				orderKey: liveOrder(event, "execution.command"),
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
			startedAt: node.startedAt ?? update.startedAt,
			source: node.source ?? update.source,
			stableKey: node.stableKey ?? update.stableKey,
			orderKey: node.orderKey ?? update.orderKey,
			children: update.children.length ? update.children : node.children,
		}));
	}
	const parent = update.parentId ? findTraceNode(nodes, update.parentId) : undefined;
	if (parent) {
		return updateTraceNode(nodes, parent.id, (node) => ({
			...node,
			children: sortTraceNodes([...(node.children ?? []), update]),
		}));
	}
	return sortTraceNodes([...nodes, update]);
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

function sortTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	return [...nodes]
		.sort(compareTraceNodes)
		.map((node) => (node.children.length ? { ...node, children: sortTraceNodes(node.children) } : node));
}

function compareTraceNodes(left: PiboTraceNode, right: PiboTraceNode): number {
	const byTraceOrder = compareTraceOrder(left.orderKey, right.orderKey);
	if (byTraceOrder !== 0) return byTraceOrder;
	return (left.startedAt ?? "").localeCompare(right.startedAt ?? "") || left.id.localeCompare(right.id);
}

function findTraceNode(nodes: PiboTraceNode[], id: string): PiboTraceNode | undefined {
	for (const node of nodes) {
		if (node.id === id) return node;
		const child = findTraceNode(node.children ?? [], id);
		if (child) return child;
	}
	return undefined;
}

function assistantNode(
	eventId: string,
	piboSessionId: string,
	startedAt: string,
	orderKey: PiboTraceOrderKey,
): PiboTraceNode {
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
		source: "live",
		stableKey: `assistant:${eventId}`,
		orderKey,
		children: [],
	};
}

function reasoningNode(
	eventId: string,
	piboSessionId: string,
	startedAt: string,
	orderKey: PiboTraceOrderKey,
): PiboTraceNode {
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
		source: "live",
		stableKey: `reasoning:${eventId}`,
		orderKey,
		children: [],
	};
}

function appendRawStreamEvent(events: RawEvent[], event: ChatStreamEvent, createdAt: string): RawEvent[] {
	return [
		...events.slice(-999),
		{
			id: event.streamFrameId ? `stream:${event.streamFrameId}` : `stream:${createdAt}:${events.length}`,
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
	if (!existing) return { ...parent, children: sortTraceNodes([...parent.children, child]) };
	return {
		...parent,
		children: sortTraceNodes(
			parent.children.map((candidate) =>
				candidate.id === child.id
					? {
							...candidate,
							...child,
							runId: child.runId ?? candidate.runId,
							linkedPiboSessionId: child.linkedPiboSessionId ?? candidate.linkedPiboSessionId,
							startedAt: candidate.startedAt ?? child.startedAt,
							source: candidate.source ?? child.source,
							stableKey: candidate.stableKey ?? child.stableKey,
							orderKey: candidate.orderKey ?? child.orderKey,
							children: candidate.children,
						}
					: candidate,
			),
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
		source: parent.source,
		stableKey: runId ? `async-agent:${runId}` : `${parent.stableKey ?? parent.id}:async-agent`,
		orderKey: childTraceOrder(parent.orderKey, "agent.async"),
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
		const sessionsByRoom = isRecord(value.sessionsByRoom)
			? Object.fromEntries(
					Object.entries(value.sessionsByRoom).filter(
						(entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1]),
					),
				)
			: undefined;
		return {
			roomId: typeof value.roomId === "string" && value.roomId ? value.roomId : undefined,
			piboSessionId: typeof value.piboSessionId === "string" && value.piboSessionId ? value.piboSessionId : undefined,
			...(sessionsByRoom && Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
		};
	} catch {
		return {};
	}
}

function writeStoredSelection(selection: StoredSelection): void {
	try {
		const previous = readStoredSelection();
		const sessionsByRoom = { ...(previous.sessionsByRoom ?? {}), ...(selection.sessionsByRoom ?? {}) };
		if (selection.roomId && selection.piboSessionId) sessionsByRoom[selection.roomId] = selection.piboSessionId;
		localStorage.setItem(
			LAST_SELECTION_STORAGE_KEY,
			JSON.stringify({
				roomId: selection.roomId,
				piboSessionId: selection.piboSessionId,
				...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
			}),
		);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function removeStoredRoomSelection(roomId: string): void {
	try {
		const stored = readStoredSelection();
		if (!stored.sessionsByRoom?.[roomId]) return;
		const { [roomId]: _removed, ...sessionsByRoom } = stored.sessionsByRoom;
		localStorage.setItem(
			LAST_SELECTION_STORAGE_KEY,
			JSON.stringify({
				roomId: stored.roomId,
				piboSessionId: stored.piboSessionId,
				...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
			}),
		);
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
