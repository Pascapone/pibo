import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import {
	AlertTriangle,
	LogOut,
	List,
	Menu,
	RefreshCw,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import { signInWithGoogle, signOut } from "./api-auth";
import { deleteRoom, deleteSession, getBootstrap, getNavigation, getSessionPage, markRoomRead, markSessionRead, patchRoom, patchSession, postAction, postMessage, postRoom, postSession } from "./api-chat-sessions";
import { downloadChatFile } from "./api-chat-files";
import { fetchSignalTree, subscribeSignalTree } from "./api-trace-signals";
import { listUserSkills } from "./api-agent-designer";
import type { AgentCatalog, BootstrapData, NavigationData, PiboRoom, PiboSignalPatch, PiboSignalSnapshot, PiboWebSessionNode, UserSkill } from "./types";
import { countRender } from "./renderMetrics";
import {
	chatStreamEvent,
	eventShouldRefreshNavigation,
	liveSessionStatusFromEvent,
} from "./tracing/chat-stream-events";
import { ContextFilesView } from "./context/ContextFilesView";
import { BasePromptView } from "./context/BasePromptView";
import { CompactionPromptView } from "./context/CompactionPromptView";
import { PiboToolsView } from "./context/PiboToolsView";
import { McpToolsView } from "./context/McpToolsView";
import { ContextBuildView } from "./context/ContextBuildView";
import { ContextSidebar } from "./context/ContextSidebar";
import type { ContextPanel } from "./context/types";
import { CronArea } from "./CronArea";
import { RalphArea } from "./RalphArea";
import { WorkflowsArea } from "./WorkflowsArea";
import type { PiPackageCatalogItem } from "./agents/agent-designer-model";
import { AgentsView } from "./agents/AgentsView";
import { SessionTracePane } from "./session-trace-pane";
import { SessionSidebar } from "./session-sidebar";
import { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import type { ChatSessionViewId } from "./session-views/types";
import {
	clearStoredSelection,
	readStoredComposerDraft,
	readStoredSelection,
	readStoredSessionView,
	removeStoredRoomSelection,
	writeStoredComposerDraft,
	writeStoredSelection,
	writeStoredSessionView,
} from "./app-storage";
import {
	addRoomToBootstrap,
	addSessionNodeToBootstrap,
	createBootstrapMutationSnapshot,
	createOptimisticRoom,
	createOptimisticSessionNode,
	removeRoomsFromBootstrap,
	removeSessionsFromBootstrap,
	replaceOptimisticSessionNode,
	replaceRoomInBootstrap,
	roomSubtreeIds,
	roomWithArchivedState,
	sessionNodeFromSession,
	sessionSubtreeIds,
	updateRoomInBootstrap,
	updateSessionFromPiboSession,
	updateSessionNodeInBootstrap,
	type BootstrapMutationSnapshot,
} from "./app-bootstrap-mutations";
import {
	chatBootstrapQueryKey,
	chatSessionNavigationQueryKey,
	chatSessionPageQueryKey,
	tracePageQueriesForSession,
	traceSummaryQueriesForSession,
} from "./cache";
import {
	recordStreamingDebugTraceRefreshEnd,
	recordStreamingDebugTraceRefreshStart,
} from "./streamingDebug";
import {
	countUnreadRooms,
	findRoomById,
	isArchivedRoom,
	limitSessionNodesForSidebar,
	nextRecentSessionSignalExpiryMs,
	splitSessionNodesByArchive,
} from "./session-sidebar-helpers";
import {
	createClientTxnId,
	defaultProfileFromBootstrap,
	findSessionNode,
	findSessionPath,
	identityFromBootstrap,
	resolveSessionActiveModelLabel,
} from "./app-session-model";
import type { SlashCommand } from "./chat-commands";
import { errorMessage } from "./error-message";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SettingsView } from "./settings/SettingsView";
import type { SettingsPanel } from "./settings/types";
import { ProjectsArea } from "./projects/ProjectsArea";

type Area = "sessions" | "projects" | "workflows" | "cron" | "ralph" | "agents" | "context" | "settings";
const MAIN_NAV_AREAS: readonly Area[] = ["sessions", "projects", "workflows", "cron", "ralph", "agents", "context", "settings"];

export type ChatAppRoute =
	| { area: "sessions"; roomId?: string; piboSessionId?: string; sessionViewId?: ChatSessionViewId }
	| { area: "projects"; projectId?: string; piboSessionId?: string; sessionViewId?: ChatSessionViewId }
	| { area: "workflows"; draftId?: string; viewWorkflowId?: string; viewWorkflowVersion?: string }
	| { area: "agents" }
	| { area: "cron" }
	| { area: "ralph" }
	| { area: "context"; piboSessionId?: string }
	| { area: "settings"; panel?: SettingsPanel };

type ForkActionResponse = {
	result: {
		piboSessionId?: string;
		cancelled?: boolean;
		selectedText?: string;
	};
};

type LoadBootstrapOptions = {
	selectSession?: boolean;
	force?: boolean;
};

type NavigationOptions = {
	closeMobileSidebar?: boolean;
};

const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";
const SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS = 750;
const SESSION_PAGE_SIZE = 120;
const ARCHIVED_SESSION_PAGE_SIZE = 60;
const EMPTY_SESSION_PATH_IDS = new Set<string>();

async function loadBootstrapQueryData(
	queryClient: QueryClient,
	input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		markRead?: boolean;
		force?: boolean;
	},
): Promise<BootstrapData> {
	const queryKey = chatBootstrapQueryKey(input.piboSessionId, input.includeArchived, input.roomId);
	await queryClient.removeQueries({ queryKey, exact: true });
	return getBootstrap(input.piboSessionId, input.includeArchived, input.roomId, Boolean(input.markRead));
}

async function loadNavigationQueryData(
	queryClient: QueryClient,
	input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		force?: boolean;
	},
): Promise<NavigationData> {
	const queryKey = chatSessionNavigationQueryKey(input.includeArchived, input.roomId, input.piboSessionId);
	await queryClient.removeQueries({ queryKey, exact: true });
	return getNavigation(input.piboSessionId, input.includeArchived, input.roomId);
}

function mergeNavigationIntoBootstrap(
	current: BootstrapData,
	navigation: NavigationData,
	options: { readSessionId?: string } = {},
): BootstrapData {
	const readSessionIds = options.readSessionId ? collectSessionSubtreeIds(current.sessions, options.readSessionId) : new Set<string>();
	const previousUnreadBySessionId = new Map<string, number>();
	collectSessionUnreadCounts(current.sessions, previousUnreadBySessionId);
	const clearedUnreadCount = [...readSessionIds].reduce((sum, sessionId) => sum + (previousUnreadBySessionId.get(sessionId) ?? 0), 0);
	return {
		...current,
		identity: navigation.identity,
		session: navigation.session,
		room: navigation.room,
		selectedRoomId: navigation.selectedRoomId,
		selectedPiboSessionId: navigation.selectedPiboSessionId,
		latestRoomStreamId: navigation.latestRoomStreamId,
		rooms: mergeNavigationRooms(current.rooms, navigation.rooms, navigation.selectedRoomId, clearedUnreadCount),
		sessions: mergeNavigationSessions(navigation.sessions, readSessionIds, previousUnreadBySessionId),
	};
}

function collectSessionUnreadCounts(sessions: readonly PiboWebSessionNode[], output: Map<string, number>): void {
	for (const session of sessions) {
		output.set(session.piboSessionId, session.unreadCount ?? 0);
		collectSessionUnreadCounts(session.children, output);
	}
}

function collectSessionSubtreeIds(sessions: readonly PiboWebSessionNode[], rootSessionId: string): Set<string> {
	const ids = new Set<string>();
	const visit = (session: PiboWebSessionNode): boolean => {
		if (session.piboSessionId === rootSessionId) {
			collectAllSessionIds(session, ids);
			return true;
		}
		return session.children.some((child) => visit(child));
	};
	for (const session of sessions) visit(session);
	return ids;
}

function collectAllSessionIds(session: PiboWebSessionNode, output: Set<string>): void {
	output.add(session.piboSessionId);
	for (const child of session.children) collectAllSessionIds(child, output);
}

function mergeNavigationSessions(
	next: readonly PiboWebSessionNode[],
	readSessionIds: ReadonlySet<string>,
	previousUnreadBySessionId: ReadonlyMap<string, number>,
): PiboWebSessionNode[] {
	return next.map((session) => {
		const preservedUnread = previousUnreadBySessionId.get(session.piboSessionId);
		const unreadCount = readSessionIds.has(session.piboSessionId) ? 0 : (session.unreadCount ?? preservedUnread ?? 0);
		return {
			...session,
			...(unreadCount > 0 ? { unreadCount } : { unreadCount: undefined }),
			children: mergeNavigationSessions(session.children, readSessionIds, previousUnreadBySessionId),
		};
	});
}

function mergeNavigationRooms(
	current: readonly PiboRoom[],
	next: readonly PiboRoom[],
	selectedRoomId: string | undefined,
	clearedUnreadCount: number,
): PiboRoom[] {
	const previousUnreadByRoomId = new Map<string, number>();
	collectRoomUnreadCounts(current, previousUnreadByRoomId);
	return mergeRoomNodes(next, previousUnreadByRoomId, selectedRoomId, clearedUnreadCount).rooms;
}

function collectRoomUnreadCounts(rooms: readonly PiboRoom[], output: Map<string, number>): void {
	for (const room of rooms) {
		output.set(room.id, room.unreadCount ?? 0);
		collectRoomUnreadCounts(room.children ?? [], output);
	}
}

function mergeRoomNodes(
	rooms: readonly PiboRoom[],
	previousUnreadByRoomId: ReadonlyMap<string, number>,
	selectedRoomId: string | undefined,
	clearedUnreadCount: number,
): { rooms: PiboRoom[]; selectedRoomFound: boolean } {
	let selectedRoomFound = false;
	const merged = rooms.map((room) => {
		const childResult = mergeRoomNodes(room.children ?? [], previousUnreadByRoomId, selectedRoomId, clearedUnreadCount);
		const roomContainsSelection = room.id === selectedRoomId || childResult.selectedRoomFound;
		selectedRoomFound = selectedRoomFound || roomContainsSelection;
		const preservedUnread = room.unreadCount ?? previousUnreadByRoomId.get(room.id) ?? 0;
		const unreadCount = roomContainsSelection && clearedUnreadCount > 0 ? Math.max(0, preservedUnread - clearedUnreadCount) : preservedUnread;
		return {
			...room,
			...(unreadCount > 0 ? { unreadCount } : { unreadCount: undefined }),
			...(room.children ? { children: childResult.rooms } : {}),
		};
	});
	return { rooms: merged, selectedRoomFound };
}

function appendSessionRoots(current: PiboWebSessionNode[], next: PiboWebSessionNode[]): PiboWebSessionNode[] {
	if (!next.length) return current;
	const seen = new Set(current.map((session) => session.piboSessionId));
	const appended = next.filter((session) => !seen.has(session.piboSessionId));
	return appended.length ? [...current, ...appended] : current;
}

export function App({ route }: { route: ChatAppRoute }) {
	countRender("App");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const area = route.area;
	const routeRoomId = route.area === "sessions" ? route.roomId : undefined;
	const routeProjectId = route.area === "projects" ? route.projectId : undefined;
	const routePiboSessionId = route.area === "sessions" || route.area === "projects" || route.area === "context" ? route.piboSessionId : undefined;
	const routeSessionViewId = route.area === "sessions" || route.area === "projects" ? route.sessionViewId : undefined;
	const settingsPanel: SettingsPanel = route.area === "settings" ? route.panel ?? "general" : "general";
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showThinking, setShowThinking] = useState(() => localStorage.getItem("pibo.chat.showThinking") !== "false");
	const [expandThinking, setExpandThinking] = useState(() => localStorage.getItem("pibo.chat.expandThinking") !== "false");
	const [showRawEvents, setShowRawEvents] = useState(() => localStorage.getItem("pibo.chat.showRawEvents") === "true");
	const [showArchived, setShowArchived] = useState(() => localStorage.getItem("pibo.chat.showArchived") === "true");
	const [showArchivedRooms, setShowArchivedRooms] = useState(() => localStorage.getItem("pibo.chat.showArchivedRooms") === "true");
	const [newSessionProfile, setNewSessionProfile] = useState(() => localStorage.getItem("pibo.chat.newSessionProfile") ?? "");
	const [sessionViewId, setSessionViewId] = useState<ChatSessionViewId>(() => routeSessionViewId ?? readStoredSessionView());
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const creatingSessionRef = useRef(false);
	const [loadingActiveSessions, setLoadingActiveSessions] = useState(false);
	const [loadingArchivedSessions, setLoadingArchivedSessions] = useState(false);
	const [visibleActiveSessionCount, setVisibleActiveSessionCount] = useState(SESSION_PAGE_SIZE);
	const [visibleArchivedSessionCount, setVisibleArchivedSessionCount] = useState(ARCHIVED_SESSION_PAGE_SIZE);
	const [loadingPiboSessionId, setLoadingPiboSessionId] = useState<string | null>(null);
	const [autoRenameSessionId, setAutoRenameSessionId] = useState<string | null>(null);
	const [contextPanel, setContextPanel] = useState<ContextPanel>("build-context");
	const [selectedContextFileKey, setSelectedContextFileKey] = useState<string | null>(null);
	const [selectedMcpServerName, setSelectedMcpServerName] = useState<string | null>(null);
	const [creatingRoom, setCreatingRoom] = useState(false);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [mobileAreaMenuOpen, setMobileAreaMenuOpen] = useState(false);
	const mobileAreaMenuRef = useRef<HTMLDivElement>(null);
	const [deleteRoomTarget, setDeleteRoomTarget] = useState<PiboRoom | null>(null);
	const [deleteRoomConfirmName, setDeleteRoomConfirmName] = useState("");
	const [deletingRoom, setDeletingRoom] = useState(false);
	const [deleteSessionTarget, setDeleteSessionTarget] = useState<PiboWebSessionNode | null>(null);
	const [gatewayMode, setGatewayMode] = useState<"main" | "fallback" | null>(null);
	const [sessionSignals, setSessionSignals] = useState<PiboSignalSnapshot | null>(null);
	const [signalNow, setSignalNow] = useState(() => Date.now());
	const [deleteSessionConfirmText, setDeleteSessionConfirmText] = useState("");
	const [deletingSession, setDeletingSession] = useState(false);
	const showArchivedRef = useRef(showArchived);
	const sessionListScrollRef = useRef<HTMLDivElement>(null);
	const bootstrapRef = useRef<BootstrapData | null>(null);
	const bootstrapRequestId = useRef(0);
	const activeRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? null;
	const selectedRoom = activeRoomId && bootstrap ? findRoomById(bootstrap.rooms, activeRoomId) ?? bootstrap.room : undefined;
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;

	useEffect(() => {
		showArchivedRef.current = showArchived;
	}, [showArchived]);

	useEffect(() => {
		if (!mobileAreaMenuOpen) return;
		const handlePointerDown = (event: MouseEvent | TouchEvent) => {
			if (mobileAreaMenuRef.current && !mobileAreaMenuRef.current.contains(event.target as Node)) setMobileAreaMenuOpen(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMobileAreaMenuOpen(false);
		};
		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("touchstart", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("touchstart", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [mobileAreaMenuOpen]);

	useEffect(() => {
		bootstrapRef.current = bootstrap;
	}, [bootstrap]);

	useEffect(() => {
		setVisibleActiveSessionCount(SESSION_PAGE_SIZE);
		setVisibleArchivedSessionCount(ARCHIVED_SESSION_PAGE_SIZE);
	}, [selectedRoomId, showArchived]);

	useEffect(() => {
		setSignalNow(Date.now());
	}, [bootstrap]);

	useEffect(() => {
		if (area !== "sessions" || !selectedPiboSessionId) {
			setSessionSignals(null);
			return;
		}
		let signalRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const refreshSignalSnapshot = (delayMs: number) => {
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			signalRecoveryTimer = setTimeout(() => {
				signalRecoveryTimer = undefined;
				fetchSignalTree(selectedPiboSessionId)
					.then((snapshot) => {
						setSessionSignals(snapshot);
						setBootstrap((latest) => latest ? applySignalSnapshotToBootstrap(latest, snapshot) : latest);
					})
					.catch(() => undefined);
			}, delayMs);
		};
		const unsubscribe = subscribeSignalTree(selectedPiboSessionId, {
			onSnapshot: (snapshot) => {
				if (signalRecoveryTimer) {
					clearTimeout(signalRecoveryTimer);
					signalRecoveryTimer = undefined;
				}
				setSessionSignals(snapshot);
				setBootstrap((current) => current ? applySignalSnapshotToBootstrap(current, snapshot) : current);
			},
			onPatch: (patch) => {
				setSessionSignals((current) => {
					const next = applySignalPatch(current, patch);
					if (current && next === current) refreshSignalSnapshot(0);
					return next;
				});
				setBootstrap((current) => current ? applySignalPatchToBootstrap(current, patch) : current);
			},
			onError: () => refreshSignalSnapshot(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS),
		});
		return () => {
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			unsubscribe();
		};
	}, [area, selectedPiboSessionId]);

	useEffect(() => {
		const nextExpiryMs = bootstrap ? nextRecentSessionSignalExpiryMs(bootstrap.sessions, signalNow) : undefined;
		if (nextExpiryMs === undefined) return;
		const timer = setTimeout(() => setSignalNow(Date.now()), Math.max(50, nextExpiryMs));
		return () => clearTimeout(timer);
	}, [bootstrap, signalNow]);

	useEffect(() => {
		const check = async () => {
			try {
				const res = await fetch("/health", { signal: AbortSignal.timeout(3000) });
				if (res.ok) {
					const data = await res.json();
					setGatewayMode(data.mode === "fallback" ? "fallback" : "main");
				} else {
					setGatewayMode(null);
				}
			} catch {
				setGatewayMode(null);
			}
		};
		void check();
		const id = setInterval(check, 5000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (area !== "sessions" && area !== "projects") return;
		const next = routeSessionViewId ?? readStoredSessionView();
		setSessionViewId((current) => (current === next ? current : next));
	}, [area, routeSessionViewId]);

	useEffect(() => {
		writeStoredSessionView(sessionViewId);
	}, [sessionViewId]);
	const navigateToRoute = useCallback(
		(target: ChatAppRoute, replace = false, nextSessionViewId = sessionViewId, options: NavigationOptions = {}) => {
			if (options.closeMobileSidebar !== false) setMobileSidebarOpen(false);
			const sessionViewSearch = { view: nextSessionViewId };
			if (target.area === "projects") {
				if (target.projectId && target.piboSessionId) {
					void navigate({
						to: "/projects/$projectId/sessions/$piboSessionId",
						params: { projectId: target.projectId, piboSessionId: target.piboSessionId },
						search: sessionViewSearch,
						replace,
					});
					return;
				}
				if (target.projectId) {
					void navigate({ to: "/projects/$projectId", params: { projectId: target.projectId }, search: sessionViewSearch, replace });
					return;
				}
				void navigate({ to: "/projects", search: sessionViewSearch, replace });
				return;
			}
			if (target.area === "workflows") {
				if (target.draftId) {
					void navigate({ to: "/workflows/drafts/$draftId", params: { draftId: target.draftId }, replace });
					return;
				}
				void navigate({ to: "/workflows", replace });
				return;
			}
			if (target.area === "agents") {
				void navigate({ to: "/agents", replace });
				return;
			}
			if (target.area === "cron") {
				void navigate({ to: "/cron", replace });
				return;
			}
			if (target.area === "ralph") {
				void navigate({ to: "/ralph", replace });
				return;
			}
			if (target.area === "context") {
				void navigate({
					to: "/context",
					search: target.piboSessionId ? { piboSessionId: target.piboSessionId } : {},
					replace,
				});
				return;
			}
			if (target.area === "settings") {
				if (target.panel === "shortcuts") {
					void navigate({ to: "/settings/shortcuts", replace });
				} else if (target.panel === "pi-packages") {
					void navigate({ to: "/settings/pi-packages", replace });
				} else if (target.panel === "skills") {
					void navigate({ to: "/settings/skills", replace });
				} else if (target.panel === "providers") {
					void navigate({ to: "/settings/providers", replace });
				} else {
					void navigate({ to: "/settings", replace });
				}
				return;
			}
			if (target.roomId && target.piboSessionId) {
				void navigate({
					to: "/rooms/$roomId/sessions/$piboSessionId",
					params: { roomId: target.roomId, piboSessionId: target.piboSessionId },
					search: sessionViewSearch,
					replace,
				});
				return;
			}
			if (target.roomId) {
				void navigate({ to: "/rooms/$roomId", params: { roomId: target.roomId }, search: sessionViewSearch, replace });
				return;
			}
			if (target.piboSessionId) {
				void navigate({
					to: "/sessions/$piboSessionId",
					params: { piboSessionId: target.piboSessionId },
					search: sessionViewSearch,
					replace,
				});
				return;
			}
			void navigate({ to: "/", search: sessionViewSearch, replace });
		},
		[navigate, sessionViewId],
	);

	const navigateToSelectedSession = useCallback(
		(roomId: string | undefined, piboSessionId: string | undefined, replace = false, options: NavigationOptions = {}) => {
			if (!piboSessionId) {
				navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}) }, replace, sessionViewId, options);
				return;
			}
			navigateToRoute({ area: "sessions", ...(roomId ? { roomId } : {}), piboSessionId }, replace, sessionViewId, options);
		},
		[navigateToRoute, sessionViewId],
	);

	const navigateToSelectedProjectSession = useCallback(
		(projectId: string | undefined, piboSessionId: string | undefined, replace = false, options: NavigationOptions = {}) => {
			if (!piboSessionId) {
				navigateToRoute({ area: "projects", ...(projectId ? { projectId } : {}) }, replace, sessionViewId, options);
				return;
			}
			navigateToRoute({ area: "projects", ...(projectId ? { projectId } : {}), piboSessionId }, replace, sessionViewId, options);
		},
		[navigateToRoute, sessionViewId],
	);

	const viewSessionContext = useCallback((piboSessionId: string) => {
		setContextPanel("build-context");
		navigateToRoute({ area: "context", piboSessionId });
	}, [navigateToRoute]);

	const openContextFileEditor = useCallback((key: string) => {
		setSelectedContextFileKey(key);
		setContextPanel("context-files");
		navigateToRoute({ area: "context" });
	}, [navigateToRoute]);

	const openMcpToolsEditor = useCallback((name: string) => {
		setSelectedMcpServerName(name);
		setContextPanel("mcp-tools");
		navigateToRoute({ area: "context" });
	}, [navigateToRoute]);

	const updateMcpServerInBootstrap = useCallback((server: AgentCatalog["mcpServers"][number]) => {
		setBootstrap((current) => current ? {
			...current,
			agentCatalog: current.agentCatalog ? {
				...current.agentCatalog,
				mcpServers: current.agentCatalog.mcpServers.map((candidate) => candidate.name === server.name ? server : candidate),
			} : current.agentCatalog,
		} : current);
	}, []);

	const upsertPiPackageInBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		const applyPackage = (current: BootstrapData | null | undefined) => {
			if (!current?.agentCatalog) return current;
			const others = current.agentCatalog.piPackages.filter((candidate) => candidate.id !== pkg.id);
			return {
				...current,
				agentCatalog: {
					...current.agentCatalog,
					piPackages: [...others, pkg].sort((left, right) => left.name.localeCompare(right.name)),
				},
			};
		};
		setBootstrap((current) => applyPackage(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyPackage(current) ?? undefined);
	}, [queryClient]);

	const removePiPackageFromBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		const applyRemoval = (current: BootstrapData | null | undefined) => current?.agentCatalog ? {
			...current,
			agentCatalog: {
				...current.agentCatalog,
				piPackages: current.agentCatalog.piPackages.filter((candidate) => candidate.id !== pkg.id),
			},
		} : current;
		setBootstrap((current) => applyRemoval(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyRemoval(current) ?? undefined);
	}, [queryClient]);

	const upsertUserSkillInBootstrap = useCallback((skill: UserSkill) => {
		const applySkill = (current: BootstrapData | null | undefined) => {
			if (!current?.agentCatalog) return current;
			const others = current.agentCatalog.userSkills.filter((candidate) => candidate.id !== skill.id);
			return {
				...current,
				agentCatalog: {
					...current.agentCatalog,
					userSkills: [...others, skill].sort((left, right) => left.name.localeCompare(right.name)),
				},
			};
		};
		setBootstrap((current) => applySkill(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applySkill(current) ?? undefined);
	}, [queryClient]);

	const removeUserSkillFromBootstrap = useCallback((skillId: string) => {
		const applyRemoval = (current: BootstrapData | null | undefined) => current?.agentCatalog ? {
			...current,
			agentCatalog: {
				...current.agentCatalog,
				userSkills: current.agentCatalog.userSkills.filter((candidate) => candidate.id !== skillId),
			},
		} : current;
		setBootstrap((current) => applyRemoval(current) ?? null);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => applyRemoval(current) ?? undefined);
	}, [queryClient]);

	const loadBootstrap = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadBootstrapOptions = {},
	) => {
		const currentBootstrap = bootstrapRef.current;
		if (currentBootstrap && options.selectSession !== false && !options.force) {
			if (piboSessionId) await markSessionRead(piboSessionId);
			const requestId = bootstrapRequestId.current + 1;
			bootstrapRequestId.current = requestId;
			const navigation = await loadNavigationQueryData(queryClient, { piboSessionId, includeArchived, roomId });
			const data = mergeNavigationIntoBootstrap(currentBootstrap, navigation, { readSessionId: piboSessionId });
			if (requestId !== bootstrapRequestId.current) return data;
			setBootstrap(data);
			setSelectedPiboSessionId(data.selectedPiboSessionId);
			setSelectedRoomId(data.selectedRoomId);
			return data;
		}
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await loadBootstrapQueryData(queryClient, {
			piboSessionId,
			includeArchived,
			roomId,
			markRead: options.selectSession !== false,
			force: options.force,
		});
		if (requestId !== bootstrapRequestId.current) return data;
		setBootstrap(data);
		if (options.selectSession !== false) setSelectedPiboSessionId(data.selectedPiboSessionId);
		setSelectedRoomId(data.selectedRoomId);
		return data;
	}, [queryClient]);

	const loadNavigation = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: { force?: boolean; readSessionId?: string } = {},
	) => {
		const currentBootstrap = bootstrapRef.current;
		if (!currentBootstrap) return loadBootstrap(piboSessionId, includeArchived, roomId, { force: options.force });
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const navigation = await loadNavigationQueryData(queryClient, { piboSessionId, includeArchived, roomId, force: options.force });
		const data = mergeNavigationIntoBootstrap(currentBootstrap, navigation, { readSessionId: options.readSessionId });
		if (requestId !== bootstrapRequestId.current) return data;
		setBootstrap(data);
		setSelectedPiboSessionId(data.selectedPiboSessionId);
		setSelectedRoomId(data.selectedRoomId);
		return data;
	}, [loadBootstrap, queryClient]);

	useEffect(() => {
		if (area !== "sessions") return;
		let stopped = false;
		const refreshVisibleNavigation = () => {
			if (stopped || document.hidden || !bootstrapRef.current) return;
			loadNavigation(selectedPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId ?? undefined, { force: true })
				.catch(() => undefined);
		};
		const interval = window.setInterval(refreshVisibleNavigation, 2500);
		return () => {
			stopped = true;
			window.clearInterval(interval);
		};
	}, [activeRoomId, area, loadNavigation, selectedPiboSessionId]);

	useEffect(() => {
		const stored = readStoredSelection();
		const storedPiboSessionId = routeRoomId ? stored.sessionsByRoom?.[routeRoomId] : stored.piboSessionId;
		const requestedRoomId = route.area === "sessions"
			? (routeRoomId ?? (!routePiboSessionId ? stored.roomId : undefined))
			: route.area === "context" && routePiboSessionId
				? undefined
				: stored.roomId;
		const requestedPiboSessionId = route.area === "sessions"
			? (routePiboSessionId ?? (!routePiboSessionId ? storedPiboSessionId : undefined))
			: route.area === "context"
				? routePiboSessionId
				: stored.piboSessionId;

		const canonicalizeSessionsRoute = (data: BootstrapData, replace = true) => {
			if (route.area !== "sessions") return;
			if (!data.selectedPiboSessionId) return;
			if (route.roomId === data.selectedRoomId && route.piboSessionId === data.selectedPiboSessionId) return;
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, replace);
		};

		if (bootstrap && route.area !== "sessions") {
			if (route.area !== "context" || !routePiboSessionId || bootstrap.selectedPiboSessionId === routePiboSessionId) return;
		}

		if (creatingSessionRef.current) {
			return;
		}

		if (
			bootstrap &&
			route.area === "sessions" &&
			route.piboSessionId &&
			bootstrap.selectedPiboSessionId === route.piboSessionId &&
			bootstrap.selectedRoomId === route.roomId
		) {
			return;
		}

		const loadRouteData = bootstrap ? loadNavigation : loadBootstrap;
		loadRouteData(requestedPiboSessionId, showArchivedRef.current, requestedRoomId)
			.then((data) => {
				canonicalizeSessionsRoute(data);
				setError(null);
			})
			.catch((caught) => {
				if (route.area === "sessions" && routeRoomId && !routePiboSessionId && requestedPiboSessionId) {
					removeStoredRoomSelection(routeRoomId);
					loadRouteData(undefined, showArchivedRef.current, routeRoomId)
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
				loadRouteData()
					.then((data) => {
						canonicalizeSessionsRoute(data);
						setError(null);
					})
					.catch((fallbackCaught) =>
						setError(fallbackCaught instanceof Error ? fallbackCaught.message : String(fallbackCaught)),
					);
			});
	}, [bootstrap, loadBootstrap, loadNavigation, navigateToSelectedSession, route.area, routePiboSessionId, routeRoomId]);

	useEffect(() => {
		if (!selectedRoomId && !selectedPiboSessionId) return;
		writeStoredSelection({
			roomId: selectedRoomId ?? undefined,
			piboSessionId: selectedPiboSessionId ?? undefined,
		});
	}, [selectedPiboSessionId, selectedRoomId]);

	useEffect(() => {
		setComposerText(selectedPiboSessionId ? readStoredComposerDraft(selectedPiboSessionId) : "");
	}, [selectedPiboSessionId]);

	const updateComposerText: Dispatch<SetStateAction<string>> = useCallback((next) => {
		setComposerText((current) => {
			const resolved = typeof next === "function" ? next(current) : next;
			if (selectedPiboSessionId) writeStoredComposerDraft(selectedPiboSessionId, resolved);
			return resolved;
		});
	}, [selectedPiboSessionId]);

	const sessionViews = useMemo(() => listChatSessionViews(), []);
	const currentSessionView = useMemo(() => getChatSessionView(sessionViewId), [sessionViewId]);

	useEffect(() => {
		if (!bootstrap?.agents.length) return;
		const sessionProfile = defaultProfileFromBootstrap(bootstrap);
		const preferredProfile = newSessionProfile || sessionProfile;
		const matchedProfile = findAgentProfile(bootstrap.agents, preferredProfile);
		if (matchedProfile) {
			if (newSessionProfile !== matchedProfile.name) {
				setNewSessionProfile(matchedProfile.name);
				localStorage.setItem("pibo.chat.newSessionProfile", matchedProfile.name);
			}
			return;
		}
		const fallbackProfile = findAgentProfile(bootstrap.agents, sessionProfile)?.name ?? bootstrap.agents[0].name;
		setNewSessionProfile(fallbackProfile);
		localStorage.setItem("pibo.chat.newSessionProfile", fallbackProfile);
	}, [bootstrap, newSessionProfile]);

	const setPreferredNewSessionProfile = useCallback((profile: string) => {
		setNewSessionProfile(profile);
		localStorage.setItem("pibo.chat.newSessionProfile", profile);
	}, []);

	const refreshTrace = useCallback(async (piboSessionId: string) => {
		const startedAt = recordStreamingDebugTraceRefreshStart(piboSessionId);
		let failed = false;
		try {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: traceSummaryQueriesForSession(piboSessionId), refetchType: "none" }),
				queryClient.invalidateQueries({ queryKey: tracePageQueriesForSession(piboSessionId), refetchType: "none" }),
			]);
			await Promise.all([
				queryClient.refetchQueries({ queryKey: traceSummaryQueriesForSession(piboSessionId), type: "active" }),
				queryClient.refetchQueries({ queryKey: tracePageQueriesForSession(piboSessionId), type: "active" }),
			]);
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			recordStreamingDebugTraceRefreshEnd(piboSessionId, startedAt, failed);
		}
	}, [queryClient]);
	const refreshSelectedTrace = useCallback(
		() => selectedPiboSessionId ? refreshTrace(selectedPiboSessionId) : Promise.resolve(),
		[refreshTrace, selectedPiboSessionId],
	);
	const refreshSelectedBootstrap = useCallback(
		() => loadNavigation(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true }),
		[loadNavigation, selectedPiboSessionId, selectedRoomId],
	);
	const refreshAfterProviderAuthChanged = useCallback(async () => {
		setError(null);
		const targetPiboSessionId = selectedPiboSessionId ?? undefined;
		await loadBootstrap(targetPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined, { force: true, selectSession: false });
		if (targetPiboSessionId) await refreshTrace(targetPiboSessionId);
	}, [loadBootstrap, refreshTrace, selectedPiboSessionId, selectedRoomId]);

	const updateBootstrapCache = useCallback((updater: (data: BootstrapData) => BootstrapData) => {
		setBootstrap((current) => current ? updater(current) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? updater(current) : current);
	}, [queryClient]);

	const latestRoomStreamId = bootstrap?.latestRoomStreamId;

	useEffect(() => {
		if (area !== "sessions" || !activeRoomId) return;
		const params = new URLSearchParams({ roomId: activeRoomId });
		params.set("mode", "summary");
		params.set("since", `${latestRoomStreamId ?? 0}:999999`);
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleFullBootstrapRefresh = () => {
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId, { force: true, selectSession: false })
					.catch((caught) => setError(errorMessage(caught)));
			}, 900);
		};
		events.addEventListener("pibo", (message) => {
			const event = chatStreamEvent(message);
			if (!event || event.type === "ready") return;
			const targetPiboSessionId = event.piboSessionId;
			const status = liveSessionStatusFromEvent(event);
			if (targetPiboSessionId && status) {
				const lastActivityAt = new Date().toISOString();
				updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, targetPiboSessionId, (node) => ({ ...node, status, lastActivityAt })));
			}
			if (eventShouldRefreshNavigation(event)) scheduleFullBootstrapRefresh();
		});
		return () => {
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			events.close();
		};
	}, [activeRoomId, area, latestRoomStreamId, loadBootstrap, selectedPiboSessionId, updateBootstrapCache]);

	const restoreBootstrapSnapshot = useCallback((snapshot: BootstrapMutationSnapshot | undefined) => {
		if (!snapshot) return;
		setBootstrap(snapshot.localBootstrap);
		for (const [queryKey, data] of snapshot.queryData) queryClient.setQueryData(queryKey, data);
	}, [queryClient]);

	const createSessionMutation = useMutation({
		mutationFn: ({ profile, roomId }: { profile: string; roomId?: string }) => postSession(profile || undefined, roomId),
		onMutate: async ({ profile }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			const previousSelectedPiboSessionId = selectedPiboSessionId;
			const tempId = `optimistic-session-${createClientTxnId()}`;
			setSelectedPiboSessionId(tempId);
			updateBootstrapCache((current) => {
				const optimisticNode = createOptimisticSessionNode(tempId, profile || defaultProfileFromBootstrap(current));
				const next = addSessionNodeToBootstrap(current, optimisticNode);
				return { ...next, selectedPiboSessionId: tempId };
			});
			return { snapshot, tempId, previousSelectedPiboSessionId };
		},
		onError: (_error, _variables, context) => {
			restoreBootstrapSnapshot(context?.snapshot);
			setSelectedPiboSessionId(context?.previousSelectedPiboSessionId ?? null);
		},
		onSuccess: (created, _variables, context) => {
			setSelectedPiboSessionId(created.session.id);
			updateBootstrapCache((current) => replaceOptimisticSessionNode(current, context?.tempId, sessionNodeFromSession(created.session)));
		},
	});

	const renameSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, title }: { piboSessionId: string; title: string | null }) => patchSession(piboSessionId, { title }),
		onMutate: async ({ piboSessionId, title }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, title: title || "Untitled Session" })));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const archiveSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, archived }: { piboSessionId: string; archived: boolean }) => patchSession(piboSessionId, { archived }),
		onMutate: async ({ piboSessionId, archived }) => {
			await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, archived, unreadCount: archived ? 0 : node.unreadCount })));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const sendMessageMutation = useMutation({
		mutationFn: ({ piboSessionId, text, clientTxnId, roomId, webAnnotationIds, fileAttachmentPaths }: { piboSessionId: string; text: string; clientTxnId: string; roomId?: string; webAnnotationIds?: readonly string[]; fileAttachmentPaths?: readonly string[] }) =>
			postMessage(piboSessionId, text, clientTxnId, roomId, webAnnotationIds, fileAttachmentPaths),
		onMutate: async ({ piboSessionId }) => {
			await queryClient.cancelQueries({ queryKey: tracePageQueriesForSession(piboSessionId) });
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, status: "running", lastActivityAt: new Date().toISOString() })));
		},
		onError: (_error, variables) => {
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, variables.piboSessionId, (node) => ({ ...node, status: "error" })));
		},
	});

	const updateSelectedSessionProfile = useCallback(async (profile: string) => {
		if (!selectedPiboSessionId || !bootstrap || profile === defaultProfileFromBootstrap(bootstrap)) return;
		try {
			await patchSession(selectedPiboSessionId, { profile });
			setPreferredNewSessionProfile(profile);
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await refreshTrace(selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [area, bootstrap, loadBootstrap, navigateToSelectedSession, refreshTrace, selectedPiboSessionId, selectedRoomId, setPreferredNewSessionProfile]);

	const slashCommands = useMemo<SlashCommand[]>(() => {
		const actions = bootstrap?.capabilities.actions ?? [];
		const commands = actions.flatMap((action): SlashCommand[] =>
			action.slashCommands
				.filter((command) => command !== "tree")
				.map((command): SlashCommand => ({
					slash: `/${command}`,
					action: action.name,
					description: action.name === "thinking" && command === "thinking"
						? "Show thinking level or use /thinking <level>."
						: action.description ?? action.name,
				})),
		);
		commands.push(
			{
				slash: "/download",
				action: "download",
				description: "Download a file by absolute path or relative to the current working directory.",
			},
			{
				slash: "/upload",
				action: "upload",
				description: "Upload one or more files to ~/.pibo/uploads.",
			},
			{
				slash: "/thinking-show",
				action: "thinking-show",
				description: "Toggle historical thinking display in this browser.",
			},
		);
		return commands;
	}, [bootstrap]);

	const skills = useMemo(() => {
		if (!bootstrap) return [];
		const catalogSkills = bootstrap.agentCatalog?.skills ?? [];
		const userSkills = bootstrap.agentCatalog?.userSkills ?? [];
		const allSkills = [...catalogSkills, ...userSkills];

		const fallbackProfile = defaultProfileFromBootstrap(bootstrap);
		const selectedSessionProfile = selectedPiboSessionId
			? findSessionNode(bootstrap.sessions, selectedPiboSessionId)?.profile ?? fallbackProfile
			: fallbackProfile;

		const agentSkills = [
			...bootstrap.agents.map((agent) => ({ name: agent.name, skills: agent.skills })),
			...bootstrap.customAgents.map((agent) => ({ name: agent.profileName, skills: agent.skills })),
		];
		const currentAgent = agentSkills.find((agent) => agent.name === selectedSessionProfile);
		const allowedSkillNames = new Set(currentAgent?.skills ?? []);

		return allSkills.filter((skill) => allowedSkillNames.has(skill.name));
	}, [bootstrap, selectedPiboSessionId]);

	const selectSession = useCallback(async (piboSessionId: string) => {
		flushSync(() => {
			setSelectedPiboSessionId(piboSessionId);
			setLoadingPiboSessionId(piboSessionId);
			setMobileSidebarOpen(false);
		});
		navigateToSelectedSession(selectedRoomId ?? bootstrap?.selectedRoomId, piboSessionId, false, { closeMobileSidebar: false });
		try {
			await markSessionRead(piboSessionId);
			const data = await loadNavigation(piboSessionId, showArchivedRef.current, selectedRoomId ?? bootstrap?.selectedRoomId, { readSessionId: piboSessionId });
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, true, { closeMobileSidebar: false });
		} finally {
			setLoadingPiboSessionId((current) => current === piboSessionId ? null : current);
		}
	}, [bootstrap?.selectedRoomId, loadNavigation, navigateToSelectedSession, selectedRoomId]);

	const selectRoom = useCallback(async (roomId: string, options: NavigationOptions = {}) => {
		const navigationOptions = { ...options, closeMobileSidebar: false };
		const storedPiboSessionId = readStoredSelection().sessionsByRoom?.[roomId];
		setSelectedRoomId(roomId);
		setSelectedPiboSessionId(storedPiboSessionId ?? null);
		try {
			const data = await loadNavigation(storedPiboSessionId, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, navigationOptions);
		} catch (caught) {
			if (!storedPiboSessionId) throw caught;
			removeStoredRoomSelection(roomId);
			setSelectedPiboSessionId(null);
			const data = await loadNavigation(undefined, showArchivedRef.current, roomId);
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, navigationOptions);
		}
	}, [loadNavigation, navigateToSelectedSession]);

	const createSession = async (profile = newSessionProfile) => {
		if (creatingSession || selectedRoomArchived) return;
		creatingSessionRef.current = true;
		setCreatingSession(true);
		try {
			const created = await createSessionMutation.mutateAsync({ profile, roomId: selectedRoomId ?? undefined });
			setSelectedPiboSessionId(created.session.id);
			setAutoRenameSessionId(created.session.id);
			navigateToSelectedSession(selectedRoomId ?? bootstrap?.selectedRoomId ?? undefined, created.session.id, false, { closeMobileSidebar: false });
			const data = await loadBootstrap(created.session.id, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			creatingSessionRef.current = false;
			setCreatingSession(false);
		}
	};

	const toggleArchivedSessions = async () => {
		const next = !showArchived;
		setShowArchived(next);
		localStorage.setItem("pibo.chat.showArchived", String(next));

		if (!next) {
			setLoadingArchivedSessions(false);
			setError(null);
			return;
		}

		setLoadingArchivedSessions(true);
		try {
			const data = await loadNavigation(selectedPiboSessionId ?? undefined, true, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoadingArchivedSessions(false);
		}
	};

	const renameSession = async (piboSessionId: string, title: string | null) => {
		try {
			await renameSessionMutation.mutateAsync({ piboSessionId, title });
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			if (area === "sessions") await refreshTrace(data.selectedPiboSessionId);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setSessionArchived = async (piboSessionId: string, archived: boolean) => {
		try {
			await archiveSessionMutation.mutateAsync({ piboSessionId, archived });
			const keepSelected = !(archived && !showArchived && selectedPiboSessionId === piboSessionId);
			const data = await loadBootstrap(
				keepSelected ? (selectedPiboSessionId ?? undefined) : undefined,
				showArchivedRef.current,
				selectedRoomId ?? undefined,
				{ force: true },
			);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
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
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDeletedIds = sessionSubtreeIds(deleteSessionTarget);
		const optimisticDeletedSelected = selectedPiboSessionId ? optimisticDeletedIds.has(selectedPiboSessionId) : false;
		if (optimisticDeletedSelected) setSelectedPiboSessionId(null);
		updateBootstrapCache((data) => removeSessionsFromBootstrap(data, optimisticDeletedIds));
		try {
			const deleted = await deleteSession(deleteSessionTarget.piboSessionId, deleteSessionConfirmText);
			const deletedSelected = selectedPiboSessionId ? deleted.deletedSessionIds.includes(selectedPiboSessionId) : optimisticDeletedSelected;
			if (deletedSelected) {
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(
				deletedSelected ? undefined : (selectedPiboSessionId ?? undefined),
				showArchivedRef.current,
				selectedRoomId ?? undefined,
				{ force: true },
			);
			if (area === "sessions") {
				navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			}
			setDeleteSessionTarget(null);
			setDeleteSessionConfirmText("");
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDeletedSelected) setSelectedPiboSessionId(selectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingSession(false);
		}
	};

	const createRoom = async () => {
		if (creatingRoom) return;
		setCreatingRoom(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const tempId = `optimistic-room-${createClientTxnId()}`;
		const optimisticRoom = createOptimisticRoom(tempId, identityFromBootstrap(bootstrap).userId, "New Chat");
		setSelectedRoomId(tempId);
		setSelectedPiboSessionId(null);
		updateBootstrapCache((data) => addRoomToBootstrap(data, optimisticRoom));
		try {
			const created = await postRoom({ name: "New Chat" });
			updateBootstrapCache((data) => replaceRoomInBootstrap(data, tempId, created.room));
			await selectRoom(created.room.id, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			setSelectedRoomId(selectedRoomId);
			setSelectedPiboSessionId(selectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setCreatingRoom(false);
		}
	};

	const updateRoom = async (roomId: string, input: { name?: string; topic?: string | null; workspace?: string | null }) => {
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, (room) => ({
			...room,
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.topic !== undefined ? { topic: input.topic ?? undefined } : {}),
			...(input.workspace !== undefined ? { workspace: input.workspace ?? undefined } : {}),
			updatedAt: new Date().toISOString(),
		})));
		try {
			const { room } = await patchRoom(roomId, input);
			updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, () => room));
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, roomId, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const readAllRoom = async (roomId: string) => {
		try {
			await markRoomRead(roomId);
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true, selectSession: false });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const setRoomArchived = async (roomId: string, archived: boolean) => {
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		if (archived) {
			setShowArchivedRooms(true);
			localStorage.setItem("pibo.chat.showArchivedRooms", "true");
		}
		updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, (room) => roomWithArchivedState(room, archived)));
		try {
			const { room } = await patchRoom(roomId, { archived });
			updateBootstrapCache((data) => updateRoomInBootstrap(data, roomId, () => room));
			const data = await loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
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
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const optimisticDeletedRoomIds = roomSubtreeIds(deleteRoomTarget);
		const optimisticDeletedSelected = selectedRoomId ? optimisticDeletedRoomIds.has(selectedRoomId) : false;
		if (optimisticDeletedSelected) {
			setSelectedRoomId(null);
			setSelectedPiboSessionId(null);
		}
		updateBootstrapCache((data) => removeRoomsFromBootstrap(data, optimisticDeletedRoomIds));
		try {
			await deleteRoom(deleteRoomTarget.id, deleteRoomConfirmName);
			if (selectedRoomId === deleteRoomTarget.id) {
				setSelectedRoomId(null);
				setSelectedPiboSessionId(null);
			}
			const data = await loadBootstrap(undefined, showArchivedRef.current, undefined, { force: true });
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			setDeleteRoomTarget(null);
			setDeleteRoomConfirmName("");
			setError(null);
		} catch (caught) {
			restoreBootstrapSnapshot(snapshot);
			if (optimisticDeletedSelected) {
				setSelectedRoomId(selectedRoomId);
				setSelectedPiboSessionId(selectedPiboSessionId);
			}
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setDeletingRoom(false);
		}
	};

	const runCommand = useCallback(async (text: string) => {
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
		if (command.action === "download") {
			const path = normalizeDownloadCommandPath(text.slice(commandText.length));
			if (!path) {
				setError("Usage: /download <path>");
				return true;
			}
			try {
				await downloadChatFile(path, {
					piboSessionId: selectedPiboSessionId,
					roomId: selectedRoomId ?? undefined,
				});
				setError(null);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
			return true;
		}
		const commandArgs = text.slice(commandText.length).trim();
		const params = command.action === "thinking" && commandArgs
			? { level: commandArgs.split(/\s+/, 1)[0] }
			: command.action === "compact" && commandArgs
				? { customInstructions: commandArgs }
				: undefined;
		const result = await postAction(selectedPiboSessionId, command.action, params);
		const derivedPiboSessionId = getResultPiboSessionId(result);
		if ((command.action === "session.clone" || command.action === "session.fork") && derivedPiboSessionId) {
			await selectSession(derivedPiboSessionId);
		} else {
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await refreshTrace(selectedPiboSessionId);
		}
		return true;
	}, [area, loadBootstrap, navigateToSelectedSession, refreshTrace, selectSession, selectedPiboSessionId, selectedRoomArchived, selectedRoomId, showThinking, slashCommands]);

	const forkFrom = useCallback(async (entryId: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return;
		const result = parseForkActionResponse(await postAction(selectedPiboSessionId, "session.fork", { entryId }));
		if (result?.result.cancelled) return;
		if (!result) throw new Error("Unexpected fork action response");
		const selectedText = typeof result.result.selectedText === "string" ? result.result.selectedText : undefined;
		if (selectedText !== undefined && result.result.piboSessionId) {
			writeStoredComposerDraft(result.result.piboSessionId, selectedText);
		}
		if (result.result.piboSessionId) {
			await selectSession(result.result.piboSessionId);
		}
		if (selectedText !== undefined) {
			setComposerText(selectedText);
			setComposerFocusSignal((current) => current + 1);
		}
	}, [selectSession, selectedPiboSessionId, selectedRoomArchived]);

	const openSession = useCallback((piboSessionId: string) => void selectSession(piboSessionId), [selectSession]);
	const selectSessionView = useCallback(
		(nextViewId: ChatSessionViewId) => {
			setSessionViewId(nextViewId);
			if (area === "projects") {
				navigateToRoute(
					{
						area: "projects",
						...(routeProjectId ? { projectId: routeProjectId } : {}),
						...(routePiboSessionId ? { piboSessionId: routePiboSessionId } : {}),
					},
					false,
					nextViewId,
				);
				return;
			}
			if (area !== "sessions") return;
			navigateToRoute(
				{
					area: "sessions",
					...(selectedRoomId ? { roomId: selectedRoomId } : {}),
					...(selectedPiboSessionId ? { piboSessionId: selectedPiboSessionId } : {}),
				},
				false,
				nextViewId,
			);
		},
		[area, navigateToRoute, routePiboSessionId, routeProjectId, selectedPiboSessionId, selectedRoomId],
	);

	const sessionGroups = useMemo(() => bootstrap ? splitSessionNodesByArchive(bootstrap.sessions, showArchived) : { active: [], archived: [] }, [bootstrap?.sessions, showArchived]);
	const visibleActiveSessions = useMemo(
		() => limitSessionNodesForSidebar(sessionGroups.active, visibleActiveSessionCount, selectedPiboSessionId),
		[sessionGroups.active, selectedPiboSessionId, visibleActiveSessionCount],
	);
	const visibleArchivedSessions = useMemo(
		() => showArchived ? sessionGroups.archived.slice(0, visibleArchivedSessionCount) : [],
		[sessionGroups.archived, showArchived, visibleArchivedSessionCount],
	);
	const hasMoreActiveSessions = sessionGroups.active.length > visibleActiveSessions.length;
	const hasMoreArchivedSessions = showArchived && sessionGroups.archived.length > visibleArchivedSessions.length;
	const selectedSessionPathIds = useMemo(
		() => selectedPiboSessionId ? new Set(findSessionPath(bootstrap?.sessions ?? [], selectedPiboSessionId).map((node) => node.piboSessionId)) : EMPTY_SESSION_PATH_IDS,
		[bootstrap?.sessions, selectedPiboSessionId],
	);
	const loadMoreSessionPage = useCallback(async (archived: boolean) => {
		if (!activeRoomId) return;
		const currentSessions = archived ? visibleArchivedSessions : visibleActiveSessions;
		const cursor = currentSessions.at(-1)?.piboSessionId;
		if (archived) setLoadingArchivedSessions(true);
		else setLoadingActiveSessions(true);
		try {
			const limit = archived ? ARCHIVED_SESSION_PAGE_SIZE : SESSION_PAGE_SIZE;
			const page = await queryClient.fetchQuery({
				queryKey: chatSessionPageQueryKey(activeRoomId, archived, cursor, limit),
				queryFn: () => getSessionPage({ roomId: activeRoomId, piboSessionId: selectedPiboSessionId ?? undefined, archived, cursor, limit }),
				staleTime: 30_000,
				gcTime: 30 * 60_000,
			});
			setBootstrap((current) => current ? { ...current, sessions: appendSessionRoots(current.sessions, page.sessions) } : current);
			if (archived) setVisibleArchivedSessionCount((current) => current + limit);
			else setVisibleActiveSessionCount((current) => current + limit);
		} finally {
			if (archived) setLoadingArchivedSessions(false);
			else setLoadingActiveSessions(false);
		}
	}, [activeRoomId, queryClient, selectedPiboSessionId, visibleActiveSessions, visibleArchivedSessions]);

	if (error && !bootstrap) {
		return <SignedOut message={error} />;
	}

	if (!bootstrap) {
		return <div className="min-h-screen bg-[#101d22] text-slate-300 grid place-items-center">Loading Pibo Chat...</div>;
	}
	const selectedSessionNode = selectedPiboSessionId ? findSessionNode(bootstrap.sessions, selectedPiboSessionId) : undefined;
	const selectedSessionSignal = selectedPiboSessionId ? sessionSignals?.sessions[selectedPiboSessionId] : undefined;
	const selectedRootSignal = sessionSignals?.rootPiboSessionId ? sessionSignals.sessions[sessionSignals.rootPiboSessionId] : undefined;
	const selectedSessionActiveModel = resolveSessionActiveModelLabel(bootstrap, selectedSessionNode ?? {
		profile: defaultProfileFromBootstrap(bootstrap),
		parentId: bootstrap.session?.parentId,
	});
	const totalRoomUnreadCount = countUnreadRooms(bootstrap.rooms);
	const contextAgentProfiles = [...new Set([...bootstrap.agents.map((agent) => agent.name), ...bootstrap.customAgents.map((agent) => agent.profileName)])];
	const identity = identityFromBootstrap(bootstrap);
	const selectMainNavArea = (item: Area) => {
		setMobileAreaMenuOpen(false);
		if (item === "sessions") {
			navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
			return;
		}
		if (item === "projects") {
			navigateToRoute({ area: "projects" });
			return;
		}
		navigateToRoute({ area: item });
	};

	return (
		<>
			{gatewayMode === "fallback" && (
				<div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center text-sm font-bold py-1.5 px-4 flex items-center justify-center gap-2 shadow-lg">
					<AlertTriangle size={16} />
					Recovery Mode: Main gateway is down. You are connected to a fallback instance.
				</div>
			)}
			<div
				data-pibo-debug="chat-app"
				data-pibo-area={area}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-selected-session-id={selectedPiboSessionId ?? bootstrap.selectedPiboSessionId ?? undefined}
				className="h-dvh overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[auto_auto_1fr]"
			>
				<header className="relative flex items-center gap-3 px-4 bg-[#1a262b] border-b border-slate-800 min-h-14 max-[980px]:px-3">
					<div className="flex min-w-0 items-center gap-2">
						<button
							type="button"
							onClick={() => setMobileSidebarOpen(true)}
							className="min-[981px]:hidden shrink-0 p-1.5 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							title="Open sidebar"
							aria-label="Open sidebar"
						>
							<Menu size={16} />
						</button>
						<img src="/apps/chat/assets/pwa-images/android/launchericon-512x512.png" alt="Logo" className="h-5 w-auto shrink-0" />
						<div className="truncate font-extrabold tracking-[0.08em] uppercase text-lg max-[420px]:text-base">Pibo Chat</div>
					</div>
					<nav className="flex gap-1 max-[1200px]:hidden min-[1201px]:absolute min-[1201px]:left-1/2 min-[1201px]:-translate-x-1/2">
						{MAIN_NAV_AREAS.map((item) => (
							<button
								key={item}
								type="button"
								onClick={() => selectMainNavArea(item)}
								className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider ${
									area === item ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"
								}`}
							>
								<span className="inline-flex items-center gap-1.5">
									<span>{item}</span>
									{item === "sessions" ? <MobileUnreadBadge count={totalRoomUnreadCount} /> : null}
								</span>
							</button>
						))}
					</nav>
					<div className="ml-auto flex shrink-0 items-center justify-end gap-2 text-xs text-slate-400 min-[1201px]:ml-0">
						<UserRound size={14} />
						<span className="truncate max-[600px]:hidden">{identity.email || identity.name || identity.userId}</span>
						<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4]" title="Sign out" aria-label="Sign out">
							<LogOut size={14} />
						</button>
						<div className="relative min-[1201px]:hidden" ref={mobileAreaMenuRef}>
							<button
								type="button"
								onClick={() => setMobileAreaMenuOpen((open) => !open)}
								className={`p-1 border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${mobileAreaMenuOpen ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-700 text-slate-400"}`}
								title="Open navigation menu"
								aria-label="Open navigation menu"
								aria-expanded={mobileAreaMenuOpen}
							>
								<List size={14} />
							</button>
							{mobileAreaMenuOpen ? (
								<div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-sm border border-slate-700 bg-[#1a262b] p-1 shadow-xl" role="menu" aria-label="Main navigation">
									{MAIN_NAV_AREAS.map((item) => (
										<button
											key={item}
											type="button"
											onClick={() => selectMainNavArea(item)}
											className={`flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-xs uppercase tracking-wider ${
												area === item ? "bg-[#11a4d4]/10 text-[#11a4d4]" : "text-slate-300 hover:bg-slate-800/80 hover:text-[#11a4d4]"
											}`}
											role="menuitem"
										>
											<span>{item}</span>
											{item === "sessions" ? <MobileUnreadBadge count={totalRoomUnreadCount} /> : null}
										</button>
									))}
								</div>
							) : null}
						</div>
					</div>
				</header>

			<div>{error ? <AppErrorBanner message={error} onDismiss={() => setError(null)} /> : null}</div>

			<div
				data-pibo-debug="route-shell"
				data-pibo-area={area}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
				className={`min-h-0 ${
					(area === "agents" || area === "workflows" || area === "cron" || area === "ralph") ? "h-full overflow-hidden" : `grid ${
						(area === "sessions" || area === "projects") && showRawEvents
						? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-1"
						: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1"
					}`
				}`}
			>
				{area === "cron" ? (
					<CronArea bootstrap={bootstrap} mobileSidebarOpen={mobileSidebarOpen} onCloseMobileSidebar={() => setMobileSidebarOpen(false)} />
				) : area === "ralph" ? (
					<RalphArea bootstrap={bootstrap} mobileSidebarOpen={mobileSidebarOpen} onCloseMobileSidebar={() => setMobileSidebarOpen(false)} />
				) : area === "agents" ? (
					<AgentsView
						agents={bootstrap.agents}
						initialCustomAgents={bootstrap.customAgents}
						initialCatalog={bootstrap.agentCatalog}
						modelCatalog={bootstrap.modelCatalog}
						onSelect={setPreferredNewSessionProfile}
						onCreateSession={(profile) => void createSession(profile)}
						onEditContextFile={openContextFileEditor}
						onEditMcpServer={openMcpToolsEditor}
						onAgentsChanged={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { selectSession: false })}
						creatingSession={creatingSession || selectedRoomArchived}
					/>
				) : area === "workflows" ? (
					<WorkflowsArea
						draftId={route.area === "workflows" ? route.draftId : undefined}
						viewWorkflowId={route.area === "workflows" ? route.viewWorkflowId : undefined}
						viewWorkflowVersion={route.area === "workflows" ? route.viewWorkflowVersion : undefined}
					/>
				) : area === "projects" ? (
					<ProjectsArea
						baseBootstrap={bootstrap}
						routeProjectId={routeProjectId}
						routePiboSessionId={routePiboSessionId}
						sessionViews={sessionViews}
						showRawEvents={showRawEvents}
						showThinking={showThinking}
						expandThinking={expandThinking}
						commands={slashCommands}
						skills={skills}
						mobileSidebarOpen={mobileSidebarOpen}
						onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
						onNavigate={navigateToSelectedProjectSession}
						onViewContext={viewSessionContext}
						onSelectSessionView={selectSessionView}
						onToggleRawEvents={() => {
							const next = !showRawEvents;
							setShowRawEvents(next);
							localStorage.setItem("pibo.chat.showRawEvents", String(next));
						}}
						onToggleThinking={() => {
							const next = !showThinking;
							setShowThinking(next);
							localStorage.setItem("pibo.chat.showThinking", String(next));
						}}
						onToggleExpandThinking={() => {
							const next = !expandThinking;
							setExpandThinking(next);
							localStorage.setItem("pibo.chat.expandThinking", String(next));
						}}
						onThinkingLevelChange={(level) => void postAction(routePiboSessionId ?? "", "thinking", { level })}
						onError={setError}
					/>
				) : (
				<>
				{/* Mobile sidebar backdrop */}
				<div
					className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
						mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
					}`}
					onClick={() => setMobileSidebarOpen(false)}
				/>
				<aside
					data-pibo-debug="sidebar-shell"
					data-pibo-area={area}
					data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
					data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
					data-pibo-state={mobileSidebarOpen ? "open" : "closed"}
					className={`min-h-0 overflow-hidden flex flex-col bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
						mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
					}`}
				>
					<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2 max-[980px]:flex-wrap">
						<span>{area}</span>
						<div className="flex items-center gap-1">
							{area === "sessions" ? (
								<button
									type="button"
									onClick={() =>
										void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true }).then((data) => {
											if (selectedPiboSessionId) void refreshTrace(selectedPiboSessionId);
											if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
										})
									}
									title="Refresh"
									aria-label="Refresh"
									className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
								>
									<RefreshCw size={13} />
								</button>
							) : null}
							<button
								type="button"
								onClick={() => setMobileSidebarOpen(false)}
								className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
								title="Close sidebar"
								aria-label="Close sidebar"
							>
								<X size={13} />
							</button>
						</div>
					</div>
					{area === "sessions" ? (
						<SessionSidebar
							bootstrap={bootstrap}
							selectedRoomId={selectedRoomId}
							selectedPiboSessionId={selectedPiboSessionId}
							showArchivedRooms={showArchivedRooms}
							onToggleArchivedRooms={() => {
								const next = !showArchivedRooms;
								setShowArchivedRooms(next);
								localStorage.setItem("pibo.chat.showArchivedRooms", String(next));
							}}
							creatingRoom={creatingRoom}
							onCreateRoom={() => createRoom()}
							onSelectRoom={selectRoom}
							onUpdateRoom={updateRoom}
							onArchiveRoom={setRoomArchived}
							onReadAllRoom={readAllRoom}
							onDeleteRoom={requestRoomDelete}
							newSessionProfile={newSessionProfile}
							onNewSessionProfileChange={setPreferredNewSessionProfile}
							selectedRoomArchived={selectedRoomArchived}
							creatingSession={creatingSession}
							onCreateSession={() => createSession()}
							showArchived={showArchived}
							onToggleArchivedSessions={toggleArchivedSessions}
							loadingArchivedSessions={loadingArchivedSessions}
							visibleActiveSessions={visibleActiveSessions}
							visibleArchivedSessions={visibleArchivedSessions}
							totalActiveSessionCount={sessionGroups.active.length}
							totalArchivedSessionCount={sessionGroups.archived.length}
							hasMoreActiveSessions={hasMoreActiveSessions}
							hasMoreArchivedSessions={hasMoreArchivedSessions}
							loadingActiveSessions={loadingActiveSessions}
							sessionListScrollRef={sessionListScrollRef}
							onLoadMoreSessions={loadMoreSessionPage}
							signalNow={signalNow}
							selectedSessionPathIds={selectedSessionPathIds}
							onSelectSession={selectSession}
							onRenameSession={renameSession}
							onArchiveSession={setSessionArchived}
							onDeleteSession={requestSessionDelete}
							onViewContext={viewSessionContext}
							loadingPiboSessionId={loadingPiboSessionId}
							autoRenameSessionId={autoRenameSessionId}
							onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
						/>
					) : area === "context" ? (
						<ContextSidebar
							activePanel={contextPanel}
							onSelect={setContextPanel}
							toolCount={bootstrap.agentCatalog?.piboTools.length ?? 0}
							mcpServerCount={bootstrap.agentCatalog?.mcpServers.length ?? 0}
						/>
					) : (
						<SettingsSidebar
							activePanel={settingsPanel}
							onSelect={(panel) => navigateToRoute({ area: "settings", panel })}
							piPackageCount={bootstrap.agentCatalog?.piPackages.length ?? 0}
							userSkillCount={bootstrap.agentCatalog?.userSkills.length ?? 0}
						/>
					)}
				</aside>

				{area === "sessions" ? (
					<SessionTracePane
						bootstrap={bootstrap}
						selectedPiboSessionId={selectedPiboSessionId}
						selectedRoomId={selectedRoomId}
						selectedRoomArchived={selectedRoomArchived}
						selectedSessionProfile={selectedSessionNode?.profile ?? defaultProfileFromBootstrap(bootstrap)}
						selectedSessionActiveModel={selectedSessionActiveModel}
						selectedSessionStatus={signalLegacyStatus(selectedSessionSignal ?? selectedRootSignal) ?? selectedSessionNode?.status}
						selectedSessionSignal={selectedSessionSignal}
						sessionViewId={sessionViewId}
						sessionViews={sessionViews}
						currentSessionView={currentSessionView}
						creatingSession={creatingSession}
						showRawEvents={showRawEvents}
						showThinking={showThinking}
						expandThinking={expandThinking}
						commands={slashCommands}
						skills={skills}
						composerText={composerText}
						composerFocusSignal={composerFocusSignal}
						onComposerTextChange={updateComposerText}
						onToggleRawEvents={() => {
							const next = !showRawEvents;
							setShowRawEvents(next);
							localStorage.setItem("pibo.chat.showRawEvents", String(next));
						}}
						onToggleThinking={() => {
							const next = !showThinking;
							setShowThinking(next);
							localStorage.setItem("pibo.chat.showThinking", String(next));
						}}
						onToggleExpandThinking={() => {
							const next = !expandThinking;
							setExpandThinking(next);
							localStorage.setItem("pibo.chat.expandThinking", String(next));
						}}
						onSessionAgentProfileChange={(profile) => void updateSelectedSessionProfile(profile)}
						onFork={forkFrom}
						onOpenSession={openSession}
						onSelectSessionView={selectSessionView}
						onCommand={runCommand}
						onThinkingLevelChange={(level) => void runCommand(`/thinking ${level}`)}
						onRefreshTrace={refreshSelectedTrace}
						onRefreshBootstrap={refreshSelectedBootstrap}
						onSend={async (text, webAnnotationIds, fileAttachmentPaths, clientTxnId) => {
							if (!selectedPiboSessionId || selectedRoomArchived) return;
							try {
								await sendMessageMutation.mutateAsync({
									piboSessionId: selectedPiboSessionId,
									text,
									clientTxnId: clientTxnId ?? createClientTxnId(),
									roomId: selectedRoomId ?? undefined,
									webAnnotationIds,
									fileAttachmentPaths,
								});
								await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
								setError(null);
							} catch (caught) {
								setError(caught instanceof Error ? caught.message : String(caught));
							}
						}}
						onError={setError}
					/>
					) : (
						<main className="min-h-0 flex flex-col">
							{area === "context" ? (
								contextPanel === "pibo-tools" ? (
									<PiboToolsView tools={bootstrap.agentCatalog?.piboTools ?? []} />
								) : contextPanel === "mcp-tools" ? (
									<McpToolsView
										servers={bootstrap.agentCatalog?.mcpServers ?? []}
										selectedServerName={selectedMcpServerName}
										onServerSaved={updateMcpServerInBootstrap}
									/>
								) : contextPanel === "build-context" ? (
									<ContextBuildView piboSessionId={routePiboSessionId ?? null} />
								) : contextPanel === "base-prompt" ? (
									<BasePromptView />
								) : contextPanel === "compaction-prompt" ? (
									<CompactionPromptView />
								) : (
									<ContextFilesView agentProfiles={contextAgentProfiles} selectedFileKey={selectedContextFileKey} />
								)
							) : (
								<SettingsView
									activePanel={settingsPanel}
									showThinking={showThinking}
									setShowThinking={setShowThinking}
									expandThinking={expandThinking}
									setExpandThinking={setExpandThinking}
									modelDefaults={bootstrap.modelDefaults}
									modelCatalog={bootstrap.modelCatalog}
									onModelDefaultsChanged={(modelDefaults) => {
										setBootstrap((current) => current ? { ...current, modelDefaults } : current);
									}}
									piPackages={bootstrap.agentCatalog?.piPackages}
									onPiPackageChanged={upsertPiPackageInBootstrap}
									onPiPackageRemoved={removePiPackageFromBootstrap}
									userSkills={bootstrap.agentCatalog?.userSkills}
									onUserSkillChanged={upsertUserSkillInBootstrap}
									onUserSkillRemoved={removeUserSkillFromBootstrap}
									piboSessionId={selectedPiboSessionId}
									onProviderAuthChanged={refreshAfterProviderAuthChanged}
								/>
							)}
						</main>
					)}
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
	</>
	);
}

function AppErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
	return (
		<div className="border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-100 flex items-start justify-between gap-3">
			<div className="min-w-0 flex items-start gap-2">
				<AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-300" />
				<div className="min-w-0">
					<div className="text-[11px] font-bold uppercase tracking-wider text-red-300">Session Error</div>
					<div className="break-words">{message}</div>
				</div>
			</div>
			<button
				type="button"
				onClick={onDismiss}
				className="shrink-0 rounded-sm border border-red-500/40 px-2 py-1 text-[11px] uppercase tracking-wider text-red-200 hover:border-red-300 hover:text-red-100"
			>
				Dismiss
			</button>
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

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={onClose}>
			<div className="w-full max-w-lg border border-slate-700 bg-[#1a262b] rounded-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
				{children}
			</div>
		</div>
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

function unreadBadgeLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

function MobileUnreadBadge({ count }: { count?: number }) {
	if (!count || count <= 0) return null;
	return (
		<span
			className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-[#38bdf8] text-[#0e1116] text-[10px] font-bold tabular-nums leading-none"
			aria-label={`${count} unread messages across all rooms`}
			title={`${count} unread messages across all rooms`}
		>
			{unreadBadgeLabel(count)}
		</span>
	);
}



function findAgentProfile(profiles: BootstrapData["agents"], name: string): BootstrapData["agents"][number] | undefined {
	return profiles.find((profile) => profile.name === name || profile.aliases.includes(name));
}

function profileExists(profiles: BootstrapData["agents"], name: string): boolean {
	return Boolean(findAgentProfile(profiles, name));
}

function normalizeDownloadCommandPath(value: string): string {
	const path = value.trim();
	if (path.length >= 2) {
		const first = path[0];
		const last = path[path.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return path.slice(1, -1).trim();
		}
	}
	return path;
}

function parseForkActionResponse(value: unknown): ForkActionResponse | null {
	if (!isRecord(value) || !isRecord(value.result)) return null;
	return value as ForkActionResponse;
}

function getResultPiboSessionId(value: unknown): string | undefined {
	if (!isRecord(value) || !isRecord(value.result)) return undefined;
	return typeof value.result.piboSessionId === "string" ? value.result.piboSessionId : undefined;
}

type SignalSessionUpdate = { status?: PiboWebSessionNode["status"]; updatedAt?: string; isTreeActive?: boolean };

function latestIsoTimestamp(...values: Array<string | undefined>): string | undefined {
	let latest: string | undefined;
	let latestMs = -Infinity;
	for (const value of values) {
		if (!value) continue;
		const ms = Date.parse(value);
		if (!Number.isFinite(ms) || ms < latestMs) continue;
		latest = value;
		latestMs = ms;
	}
	return latest;
}

function applySignalSnapshotToBootstrap(bootstrap: BootstrapData, snapshot: PiboSignalSnapshot): BootstrapData {
	return updateBootstrapSessionStatuses(bootstrap, (piboSessionId) => signalSessionUpdate(snapshot.sessions[piboSessionId]));
}

function applySignalPatchToBootstrap(bootstrap: BootstrapData, patch: PiboSignalPatch): BootstrapData {
	const updates = new Map(patch.sessionSnapshots.map((snapshot) => [snapshot.piboSessionId, signalSessionUpdate(snapshot)]));
	return updateBootstrapSessionStatuses(bootstrap, (piboSessionId) => updates.get(piboSessionId));
}

function updateBootstrapSessionStatuses(
	bootstrap: BootstrapData,
	updateFor: (piboSessionId: string) => SignalSessionUpdate | undefined,
): BootstrapData {
	return {
		...bootstrap,
		sessions: bootstrap.sessions.map((node) => updateSignalStatusInSessionNode(node, updateFor)),
	};
}

function updateSignalStatusInSessionNode(
	node: PiboWebSessionNode,
	updateFor: (piboSessionId: string) => SignalSessionUpdate | undefined,
): PiboWebSessionNode {
	const update = updateFor(node.piboSessionId);
	const status = acknowledgedSignalStatus(update, sessionNodeUnreadCount(node));
	const statusChanged = Boolean(status && status !== node.status);
	const lastActivityAt = statusChanged
		? latestIsoTimestamp(node.lastActivityAt, update?.updatedAt, new Date().toISOString())
		: latestIsoTimestamp(node.lastActivityAt, update?.updatedAt);
	return {
		...node,
		status: status ?? node.status,
		lastActivityAt,
		children: node.children.map((child) => updateSignalStatusInSessionNode(child, updateFor)),
		derivedSessions: node.derivedSessions.map((derived) => {
			const derivedUpdate = updateFor(derived.piboSessionId);
			const derivedStatus = acknowledgedSignalStatus(derivedUpdate, 0);
			const derivedStatusChanged = Boolean(derivedStatus && derivedStatus !== derived.status);
			return {
				...derived,
				status: derivedStatus ?? derived.status,
				lastActivityAt: derivedStatusChanged
					? latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt, new Date().toISOString())
					: latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt),
			};
		}),
	};
}

function sessionNodeUnreadCount(node: PiboWebSessionNode): number {
	return (node.unreadCount ?? 0) + node.children.reduce((sum, child) => sum + sessionNodeUnreadCount(child), 0);
}

function acknowledgedSignalStatus(update: SignalSessionUpdate | undefined, unreadCount: number): PiboWebSessionNode["status"] | undefined {
	if (update?.status !== "error") return update?.status;
	return unreadCount > 0 ? "error" : update.isTreeActive ? "running" : "idle";
}

function signalSessionUpdate(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): SignalSessionUpdate | undefined {
	const status = signalLegacyStatus(snapshot);
	if (!snapshot && !status) return undefined;
	return { status, updatedAt: snapshot?.updatedAt, isTreeActive: snapshot?.isTreeActive };
}

function signalLegacyStatus(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): PiboWebSessionNode["status"] | undefined {
	if (!snapshot) return undefined;
	if (snapshot.hasError || snapshot.hasErrorDescendant || snapshot.aggregateStatus === "error") return "error";
	if (snapshot.isTreeActive) return "running";
	return "idle";
}

function applySignalPatch(current: PiboSignalSnapshot | null, patch: PiboSignalPatch): PiboSignalSnapshot | null {
	if (!current || current.rootPiboSessionId !== patch.rootPiboSessionId || current.version !== patch.fromVersion) return current;
	const nodes = { ...current.nodes };
	for (const id of patch.removes) delete nodes[id];
	for (const node of patch.upserts) nodes[node.id] = node;
	const sessions = { ...current.sessions };
	for (const snapshot of patch.sessionSnapshots) sessions[snapshot.piboSessionId] = snapshot;
	return { ...current, version: patch.toVersion, generatedAt: patch.generatedAt, nodes, sessions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
