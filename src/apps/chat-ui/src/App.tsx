import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import {
	Archive,
	ArchiveRestore,
	AlertTriangle,
	BookOpenText,
	Brain,
	Bug,
	Check,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	ChevronsDown,
	ChevronsUp,
	Copy,
	CopyPlus,
	Edit3,
	EyeOff,
	ExternalLink,
	FolderPlus,
	Key,
	Layers,
	Loader2,
	Lock,
	LogOut,
	Menu,
	MessageSquarePlus,
	MoreVertical,
	Plus,
	Power,
	PowerOff,
	RefreshCw,
	Rows3,
	Save,
	Server,
	Settings,
	SendHorizontal,
	Trash2,
	UserRound,
	User,
	Wrench,
	X,
} from "lucide-react";
import { createUserSkill, createWebAnnotationBinding, deleteCustomAgent, deletePiPackage, deleteProject, deleteRoom, deleteSession, deleteUserSkill, fetchSignalTree, downloadChatFile, getBootstrap, getNavigation, getProjectsBootstrap, getSessionPage, getTrace, getTraceSummary, getUserSettings, getUserSkill, getWorkflowVersionPicker, injectWebAnnotationBinding, installUserSkill, listUserSkills, listWebAnnotations, listWebAnnotationTargets, markRoomRead, markSessionRead, patchCustomAgent, patchModelDefaults, patchPiPackage, patchProject, patchProjectSession, patchRoom, patchSession, patchUserSettings, patchWebAnnotation, postAction, postContextFile, postCustomAgent, postMessage, postPiPackage, postProject, postProjectMessage, postProjectSession, postProjectWorkflowSession, postProjectWorkflowSessionStart, postRoom, postSession, signInWithGoogle, signOut, subscribeSignalTree, updateUserSkill, uploadChatFiles, type ChatUploadedFile, type SaveCustomAgentInput, type UserSettings, type WebAnnotationBindingResponse, type WebAnnotationMessageAttachment, type WebAnnotationOverlayConfig, type WebAnnotationTargetSummary, type WorkflowVersionPickerOption } from "./api";
import { THINKING_LEVELS } from "./types";
import type { AgentCatalog, BootstrapData, CustomAgent, CustomAgentSubagent, ModelCatalog, ModelDefaults, ModelProfile, NavigationData, PiboProject, PiboProjectSession, ProjectsBootstrapData, PiboRoom, PiboSession, PiboSessionTraceSummary, PiboSessionTraceView, PiboSignalPatch, PiboSignalSnapshot, PiboTraceNode, PiboTraceOrderKey, PiboWebSessionNode, PiboWebSessionStatus, ThinkingLevel, UserSkill, WorkflowLifecycleEventRecord } from "./types";
import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";
import { collectBackendNodes, isTraceSnapshotCollectionEnabled } from "./tracing/snapshotCollector";
import { type SessionBreadcrumbItem, type SessionDerivationLink, type SessionOriginLink } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";
import { countRender } from "./renderMetrics";
import { parseTraceStreamFrameId } from "../../../shared/trace-order.js";
import { patchTraceViewWithEvent } from "../../../shared/trace-engine.js";
import { applyTraceLiveEvents } from "./traceLiveReducer";
import { ContextFilesView } from "./context/ContextFilesView";
import { BasePromptView } from "./context/BasePromptView";
import { CompactionPromptView } from "./context/CompactionPromptView";
import { PiboToolsView } from "./context/PiboToolsView";
import { McpToolsView } from "./context/McpToolsView";
import { ContextBuildView } from "./context/ContextBuildView";
import { CronArea } from "./CronArea";
import { RalphArea } from "./RalphArea";
import { WorkflowsArea } from "./WorkflowsArea";
import { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import { DEFAULT_CHAT_SESSION_VIEW_ID, type ChatSessionViewId } from "./session-views/types";
import {
	DEFAULT_RAW_EVENTS_LIMIT,
	DEFAULT_TRACE_EVENTS_PAGE_SIZE,
	chatBootstrapQueryKey,
	chatSessionNavigationQueryKey,
	chatSessionPageQueryKey,
	TRACE_GC_TIME_MS,
	TRACE_STALE_TIME_MS,
	chatTracePageQueryKey,
	chatTraceSummaryQueryKey,
	tracePageQueriesForSession,
	traceSummaryQueriesForSession,
} from "./cache";

type Area = "sessions" | "projects" | "workflows" | "cron" | "ralph" | "agents" | "context" | "settings";
type ContextPanel = "context-files" | "base-prompt" | "compaction-prompt" | "pibo-tools" | "mcp-tools" | "build-context";
type SettingsPanel = "general" | "pi-packages" | "skills" | "providers";

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

type SlashCommand = {
	slash: string;
	action: string;
	description: string;
};

type UploadedChatAttachment = ChatUploadedFile & {
	id: string;
};

type LoadBootstrapOptions = {
	selectSession?: boolean;
	force?: boolean;
};

type NavigationOptions = {
	closeMobileSidebar?: boolean;
};

const LAST_SELECTION_STORAGE_KEY = "pibo.chat.lastSelection";
const SESSION_VIEW_STORAGE_KEY = "pibo.chat.sessionView";
const COMPOSER_DRAFT_STORAGE_PREFIX = "pibo.chat.composerDraft.";
const COMPOSER_HISTORY_STORAGE_KEY = "pibo.chat.composerHistory";
const WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY = "pibo.chat.webAnnotations.cdpUrl";
const WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX = "pibo.chat.webAnnotations.selected.";
const WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY = "pibo.chat.webAnnotations.panelCollapsed";
const COMPOSER_HISTORY_LIMIT = 100;
const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";
const RECENT_SESSION_ACTIVITY_SIGNAL_MS = 3_000;
const SESSION_PAGE_SIZE = 120;
const ARCHIVED_SESSION_PAGE_SIZE = 60;
const PROJECT_ROUTING_UNKNOWN_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const PROJECT_SESSION_VIEW_ALLOWED_IDS: Record<ChatSessionViewId, readonly ChatSessionViewId[]> = {
	terminal: ["terminal"],
	workflow: ["workflow"],
};

type StoredSelection = {
	roomId?: string;
	piboSessionId?: string;
	sessionsByRoom?: Record<string, string>;
};

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

function mergeOlderTracePage(current: PiboSessionTraceView, older: PiboSessionTraceView): PiboSessionTraceView {
	if (current.piboSessionId !== older.piboSessionId) return current;
	const seenNodes = new Set<string>();
	const nodes = [...older.nodes, ...current.nodes].filter((node) => {
		if (seenNodes.has(node.id)) return false;
		seenNodes.add(node.id);
		return true;
	});
	const seenRawEvents = new Set<string>();
	const rawEvents = [...older.rawEvents, ...current.rawEvents].filter((event) => {
		const key = event.id || `${event.eventSequence ?? ""}:${event.type}:${event.createdAt}`;
		if (seenRawEvents.has(key)) return false;
		seenRawEvents.add(key);
		return true;
	});
	return {
		...current,
		version: current.version,
		nodes,
		rawEvents,
		firstEventSequence: older.firstEventSequence ?? current.firstEventSequence,
		nextBeforeSequence: older.nextBeforeSequence,
		hasOlderEvents: older.hasOlderEvents,
		eventLimit: (current.eventLimit ?? 0) + (older.eventLimit ?? older.pageSize ?? 0),
	};
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
	const bootstrapRef = useRef<BootstrapData | null>(null);
	const bootstrapRequestId = useRef(0);
	const activeRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? null;
	const selectedRoom = activeRoomId && bootstrap ? findRoomById(bootstrap.rooms, activeRoomId) ?? bootstrap.room : undefined;
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;

	useEffect(() => {
		showArchivedRef.current = showArchived;
	}, [showArchived]);

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
		return subscribeSignalTree(selectedPiboSessionId, {
			onSnapshot: (snapshot) => {
				setSessionSignals(snapshot);
				setBootstrap((current) => current ? applySignalSnapshotToBootstrap(current, snapshot) : current);
			},
			onPatch: (patch) => {
				setSessionSignals((current) => {
					const next = applySignalPatch(current, patch);
					if (current && next === current) {
						fetchSignalTree(selectedPiboSessionId)
							.then((snapshot) => {
								setSessionSignals(snapshot);
								setBootstrap((latest) => latest ? applySignalSnapshotToBootstrap(latest, snapshot) : latest);
							})
							.catch(() => undefined);
					}
					return next;
				});
				setBootstrap((current) => current ? applySignalPatchToBootstrap(current, patch) : current);
			},
			onError: () => undefined,
		});
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
				if (target.panel === "pi-packages") {
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
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: traceSummaryQueriesForSession(piboSessionId), refetchType: "none" }),
			queryClient.invalidateQueries({ queryKey: tracePageQueriesForSession(piboSessionId), refetchType: "none" }),
		]);
		await Promise.all([
			queryClient.refetchQueries({ queryKey: traceSummaryQueriesForSession(piboSessionId), type: "active" }),
			queryClient.refetchQueries({ queryKey: tracePageQueriesForSession(piboSessionId), type: "active" }),
		]);
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
	const roomsSupported = Boolean(bootstrap.selectedRoomId || bootstrap.room || bootstrap.rooms.length);
	const newSessionProfileOptions = bootstrap.agents;
	const selectedSessionNode = selectedPiboSessionId ? findSessionNode(bootstrap.sessions, selectedPiboSessionId) : undefined;
	const selectedSessionSignal = selectedPiboSessionId ? sessionSignals?.sessions[selectedPiboSessionId] : undefined;
	const selectedRootSignal = sessionSignals?.rootPiboSessionId ? sessionSignals.sessions[sessionSignals.rootPiboSessionId] : undefined;
	const selectedSessionActiveModel = resolveSessionActiveModelLabel(bootstrap, selectedSessionNode ?? {
		profile: defaultProfileFromBootstrap(bootstrap),
		parentId: bootstrap.session?.parentId,
	});
	const personalRoom = findPersonalRoom(bootstrap.rooms);
	const roomGroups = splitRoomNodes(bootstrap.rooms);
	const totalRoomUnreadCount = countUnreadRooms(bootstrap.rooms);
	const contextAgentProfiles = [...new Set([...bootstrap.agents.map((agent) => agent.name), ...bootstrap.customAgents.map((agent) => agent.profileName)])];
	const identity = identityFromBootstrap(bootstrap);

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
				<header className="flex items-center justify-between gap-3 px-4 bg-[#1a262b] border-b border-slate-800 min-h-14 max-[980px]:flex-wrap max-[980px]:py-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setMobileSidebarOpen(true)}
							className="min-[981px]:hidden p-1.5 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							title="Open sidebar"
							aria-label="Open sidebar"
						>
							<Menu size={16} />
						</button>
						<img src="/apps/chat/assets/pwa-images/android/launchericon-512x512.png" alt="Logo" className="h-5 w-auto" />
						<div className="font-extrabold tracking-[0.08em] uppercase text-lg">Pibo Chat</div>
					</div>
					<nav className="flex gap-1 flex-wrap">
					{(["sessions", "projects", "workflows", "cron", "ralph", "agents", "context", "settings"] as const).map((item) => (
						<button
							key={item}
							type="button"
							onClick={() => {
								if (item === "sessions") {
									navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
									return;
								}
								if (item === "projects") {
									navigateToRoute({ area: "projects" });
									return;
								}
								navigateToRoute({ area: item });
							}}
							className={`h-8 px-3 border rounded-sm text-xs uppercase tracking-wider max-[980px]:h-7 max-[980px]:px-2 ${
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
				<div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
					<UserRound size={14} />
					<span className="truncate max-[600px]:hidden">{identity.email || identity.name || identity.userId}</span>
					<button type="button" onClick={() => void signOut().then(() => location.reload())} className="p-1 border border-slate-700 rounded-sm">
						<LogOut size={14} />
					</button>
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
						sessionViewId={sessionViewId}
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
													onSelect={(roomId) => void selectRoom(roomId)}
													onUpdate={(roomId, input) => void updateRoom(roomId, input)}
													onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
													onReadAll={(roomId) => void readAllRoom(roomId)}
													onDelete={requestRoomDelete}
												/>
											</div>
									) : null}
									<div className="min-h-0 flex-1 basis-0 overflow-hidden flex flex-col">
										<div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1">
											<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rooms</div>
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => void createRoom()}
													disabled={creatingRoom}
													title="New Room"
													aria-label="New Room"
													className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
												>
													<Plus size={14} />
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
												onSelect={(roomId) => void selectRoom(roomId)}
												onUpdate={(roomId, input) => void updateRoom(roomId, input)}
												onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
												onReadAll={(roomId) => void readAllRoom(roomId)}
												onDelete={requestRoomDelete}
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
														onSelect={(roomId) => void selectRoom(roomId)}
														onUpdate={(roomId, input) => void updateRoom(roomId, input)}
														onArchive={(roomId, archived) => void setRoomArchived(roomId, archived)}
														onReadAll={(roomId) => void readAllRoom(roomId)}
														onDelete={requestRoomDelete}
													/>
												) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived rooms</div>}
											</div>
										) : null}
										</div>
									</div>
								</>
							) : null}
							<div className="min-h-0 flex-1 basis-0 overflow-hidden flex flex-col">
								<div className="shrink-0 flex items-center justify-between gap-2 px-1 pb-1">
									<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sessions</div>
									<div className="flex items-center gap-1">
										<select
											value={newSessionProfile}
											onChange={(event) => setPreferredNewSessionProfile(event.target.value)}
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
											onClick={() => void createSession()}
											disabled={creatingSession || selectedRoomArchived}
											title="New Session"
											aria-label="New Session"
											className="h-6 w-6 max-[980px]:h-8 max-[980px]:w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
										>
											<Plus size={14} />
										</button>
										<button
											type="button"
											onClick={() => void toggleArchivedSessions()}
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
								<div className="min-h-0 flex-1 overflow-y-auto pr-1">
								{visibleActiveSessions.map((session) => (
									<SessionNode
										key={session.piboSessionId}
										node={session}
										signalNow={signalNow}
										selectedPiboSessionId={selectedPiboSessionId}
										selectedSessionPathIds={selectedSessionPathIds}
										onSelect={(piboSessionId) => void selectSession(piboSessionId)}
										onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
										onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
										onDelete={requestSessionDelete}
										onViewContext={viewSessionContext}
										loadingPiboSessionId={loadingPiboSessionId}
										autoRename={autoRenameSessionId === session.piboSessionId}
										onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
									/>
								))}
								{sessionGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No active sessions</div> : null}
								{sessionGroups.active.length > visibleActiveSessions.length ? (
									<button
										type="button"
										onClick={() => void loadMoreSessionPage(false)}
										disabled={loadingActiveSessions}
										className="mt-2 w-full px-2 py-2 text-[11px] text-slate-400 border border-dashed border-slate-700 rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
									>
										{loadingActiveSessions ? "Loading active sessions…" : `Load more active sessions (${visibleActiveSessions.length} of ${sessionGroups.active.length})`}
									</button>
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
									) : sessionGroups.archived.length ? (
										<>
											<ArchivedSessionsList
												sessions={visibleArchivedSessions}
												signalNow={signalNow}
												selectedPiboSessionId={selectedPiboSessionId}
												selectedSessionPathIds={selectedSessionPathIds}
												onSelect={(piboSessionId) => void selectSession(piboSessionId)}
												onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)}
												onArchive={(piboSessionId, archived) => void setSessionArchived(piboSessionId, archived)}
												onDelete={requestSessionDelete}
												onViewContext={viewSessionContext}
												loadingPiboSessionId={loadingPiboSessionId}
												autoRenameSessionId={autoRenameSessionId}
												onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
											/>
											{sessionGroups.archived.length > visibleArchivedSessions.length ? (
												<button
													type="button"
													onClick={() => void loadMoreSessionPage(true)}
													disabled={loadingArchivedSessions}
													className="mt-2 w-full px-2 py-2 text-[11px] text-slate-400 border border-dashed border-slate-700 rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
												>
													{loadingArchivedSessions ? "Loading archived sessions…" : `Load more archived sessions (${visibleArchivedSessions.length} of ${sessionGroups.archived.length})`}
												</button>
											) : null}
										</>
									) : <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived sessions</div>}
								</div>
							) : null}
								</div>
							</div>
						</div>
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
						onSend={async (text, webAnnotationIds, fileAttachmentPaths) => {
							if (!selectedPiboSessionId || selectedRoomArchived) return;
							try {
								await sendMessageMutation.mutateAsync({
									piboSessionId: selectedPiboSessionId,
									text,
									clientTxnId: createClientTxnId(),
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

function ProjectsArea({
	baseBootstrap,
	routeProjectId,
	routePiboSessionId,
	sessionViewId,
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
	sessionViewId: ChatSessionViewId;
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
				const selected = picker.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion) ?? picker.options[0];
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
	const selectedProjectSession = selectedPiboSessionId ? projectSessions.find((projectSession) => projectSession.piboSessionId === selectedPiboSessionId) : undefined;
	const workflowProjectSessions = projectSessions.filter(isWorkflowBackedProjectSession);
	const activeProjects = data?.projects.filter((project) => !project.archivedAt) ?? [];
	const archivedProjects = data?.projects.filter((project) => project.archivedAt) ?? [];
	const sessionGroups = useMemo(() => data ? splitSessionNodesByArchive(data.sessions, showArchivedSessions) : { active: [], archived: [] }, [data, showArchivedSessions]);
	const selectedSessionPathIds = useMemo(() => selectedPiboSessionId && data ? new Set(findSessionPath(data.sessions, selectedPiboSessionId).map((node) => node.piboSessionId)) : EMPTY_SESSION_PATH_IDS, [data, selectedPiboSessionId]);
	const traceBootstrap = useMemo(() => ({
		...baseBootstrap,
		...(data?.session ? { session: data.session } : {}),
		agents: data?.agents ?? baseBootstrap.agents,
		customAgents: data?.customAgents ?? baseBootstrap.customAgents,
		modelDefaults: data?.modelDefaults ?? baseBootstrap.modelDefaults,
		modelCatalog: data?.modelCatalog ?? baseBootstrap.modelCatalog,
		agentCatalog: data?.agentCatalog ?? baseBootstrap.agentCatalog,
		capabilities: data?.capabilities ?? baseBootstrap.capabilities,
		sessions: data?.sessions ?? [],
	}) as BootstrapData, [baseBootstrap, data]);
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
			setWorkflowCreateDiagnostics([{
				code: "ProjectWorkflowSessionCreate.missingWorkflowVersion",
				message: "Select a workflow version before creating the Project session.",
				severity: "error",
			}]);
			onError("Select a workflow version before creating the Project session.");
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
			const message = response.projectSession.workflowRunId
				? "Workflow run started."
				: "Start accepted after validation. No workflow run record exists yet.";
			setWorkflowStartMessages((current) => ({ ...current, [projectSession.piboSessionId]: message }));
			onError(null);
			await load({ projectId: selectedProject.id, piboSessionId: projectSession.piboSessionId });
		} catch (caught) {
			const diagnostics = workflowDiagnosticsFromError(caught);
			if (diagnostics.length) {
				const codes = diagnostics.map((diagnostic) => diagnostic.code).filter(Boolean).slice(0, 3).join(", ");
				setWorkflowStartMessages((current) => ({
					...current,
					[projectSession.piboSessionId]: `Start blocked: ${codes || "validation diagnostics"}`,
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
			<aside
				className={`min-h-0 overflow-auto bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
					mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
				}`}
			>
				<div className="h-11 px-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider max-[980px]:h-auto max-[980px]:py-2">
					<span>projects</span>
					<div className="flex items-center gap-1">
						<button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh" className="p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><RefreshCw size={13} /></button>
						<button type="button" onClick={onCloseMobileSidebar} title="Close sidebar" aria-label="Close sidebar" className="min-[981px]:hidden p-1 border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={13} /></button>
					</div>
				</div>
				<div className="p-2 space-y-3">
					<div>
						<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Personal Chat</div>
						<ProjectRow project={data!.personalProject} selected={selectedProject?.id === data!.personalProject.id} onSelect={() => onNavigate(data!.personalProject.id, undefined)} />
					</div>
					<div>
						<div className="flex items-center justify-between gap-2 px-1 pb-1">
							<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Projects</div>
							<div className="flex items-center gap-1">
								<button type="button" onClick={() => void createProject()} title="New Project" aria-label="New Project" className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><Plus size={14} /></button>
								<button type="button" onClick={() => { const next = !showArchivedProjects; setShowArchivedProjects(next); localStorage.setItem("pibo.chat.projects.showArchivedProjects", String(next)); }} title="Archived Projects" aria-label="Archived Projects" className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedProjects ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}>{showArchivedProjects ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
							</div>
						</div>
						{activeProjects.map((project) => <ProjectRow key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={() => onNavigate(project.id, undefined)} onRename={(name) => void renameProject(project, name)} onArchive={() => void setProjectArchived(project, true)} />)}
						{activeProjects.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No projects</div> : null}
						{showArchivedProjects ? <div className="mt-3"><div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Projects</div>{archivedProjects.map((project) => <ProjectRow key={project.id} project={project} selected={selectedProject?.id === project.id} onSelect={() => onNavigate(project.id, undefined)} onRename={(name) => void renameProject(project, name)} onArchive={() => void setProjectArchived(project, false)} onDelete={() => void deleteArchivedProject(project)} archived />)}</div> : null}
					</div>
					{workflowProjectSessions.length > 0 ? (
						<WorkflowRunsPanel
							projectSessions={workflowProjectSessions}
							sessionNodes={data!.sessions}
							selectedPiboSessionId={selectedPiboSessionId}
							onSelect={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)}
						/>
					) : null}
					<div>
						<div className="flex items-center justify-between gap-2 px-1 pb-1">
							<div>
								<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Project Sessions</div>
								<div className="text-[10px] text-slate-500">{selectedProjectSession ? workflowSessionLabel(selectedProjectSession) : "Workflow: simple-chat"}</div>
							</div>
							<div className="flex items-center gap-1">
								<button type="button" onClick={() => void createProjectSession()} disabled={creatingSession || !selectedProject} title="New Project Session" aria-label="New Project Session" className="h-6 w-6 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"><Plus size={14} /></button>
								<button type="button" onClick={() => { const next = !showArchivedSessions; setShowArchivedSessions(next); localStorage.setItem("pibo.chat.projects.showArchivedSessions", String(next)); }} title={showArchivedSessions ? "Hide Archived Project Sessions" : "Show Archived Project Sessions"} aria-label={showArchivedSessions ? "Hide Archived Project Sessions" : "Show Archived Project Sessions"} className={`h-6 w-6 inline-flex items-center justify-center border rounded-sm hover:border-[#11a4d4] hover:text-[#11a4d4] ${showArchivedSessions ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-400"}`}>{showArchivedSessions ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
							</div>
						</div>
						{sessionGroups.active.map((session) => <SessionNode key={session.piboSessionId} node={session} signalNow={Date.now()} selectedPiboSessionId={selectedPiboSessionId} selectedSessionPathIds={selectedSessionPathIds} onSelect={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)} onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)} onArchive={(piboSessionId, archived) => void patchProjectSession(piboSessionId, { archived }).then(() => load({ projectId: selectedProject?.id }))} onDelete={(node) => void patchProjectSession(node.piboSessionId, { archived: true }).then(() => load({ projectId: selectedProject?.id }))} onViewContext={onViewContext} loadingPiboSessionId={null} autoRename={autoRenameSessionId === session.piboSessionId} onAutoRenameConsumed={() => setAutoRenameSessionId(null)} showWorkflowSessionKindMarkers />)}
						{sessionGroups.active.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No active project sessions</div> : null}
						{showArchivedSessions ? <div className="mt-3"><div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Archived Project Sessions</div>{sessionGroups.archived.map((session) => <SessionNode key={session.piboSessionId} node={session} signalNow={Date.now()} selectedPiboSessionId={selectedPiboSessionId} selectedSessionPathIds={selectedSessionPathIds} onSelect={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)} onRename={(piboSessionId, title) => void renameSession(piboSessionId, title)} onArchive={(piboSessionId, archived) => void patchProjectSession(piboSessionId, { archived }).then(() => load({ projectId: selectedProject?.id }))} onDelete={(node) => void patchProjectSession(node.piboSessionId, { archived: true }).then(() => load({ projectId: selectedProject?.id }))} onViewContext={onViewContext} loadingPiboSessionId={null} showWorkflowSessionKindMarkers />)}{sessionGroups.archived.length === 0 ? <div className="px-2 py-3 text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm">No archived project sessions</div> : null}</div> : null}
					</div>
				</div>
			</aside>
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

function ProjectWorkflowSessionCreatePanel({
	project,
	options,
	selectedOptionKey,
	titleValue,
	loadState,
	errorMessage,
	creating,
	diagnostics,
	onSelectedOptionChange,
	onTitleChange,
	onCreate,
}: {
	project: PiboProject;
	options: WorkflowVersionPickerOption[];
	selectedOptionKey: string;
	titleValue: string;
	loadState: "loading" | "loaded" | "error";
	errorMessage: string | null;
	creating: boolean;
	diagnostics: WorkflowUiDiagnostic[];
	onSelectedOptionChange: (value: string) => void;
	onTitleChange: (value: string) => void;
	onCreate: () => void;
}) {
	const selectedOption = options.find((option) => workflowVersionOptionKey(option) === selectedOptionKey);
	const disabled = creating || loadState !== "loaded" || !selectedOption || Boolean(project.archivedAt);
	return (
		<section className="rounded-sm border border-slate-800 bg-[#151f24] p-4 shadow-lg shadow-black/10" aria-labelledby="project-workflow-create-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 max-w-2xl">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Layers size={13} />Workflow-backed session</div>
					<h2 id="project-workflow-create-title" className="mt-1 text-sm font-bold text-slate-100">Create workflow Project session</h2>
					<p className="mt-1 text-xs leading-5 text-slate-500">
						Choose a published workflow version from the global catalog and save a configured Project session. Creation does not start a workflow run.
					</p>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
					Project: <span className="text-slate-300">{project.name}</span>
				</div>
			</div>
			<div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto] md:items-end">
				<label className="grid gap-1.5 text-xs font-semibold text-slate-300">
					<span>Workflow version</span>
					<select
						aria-label="Workflow version"
						className="rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
						value={selectedOptionKey}
						onChange={(event) => onSelectedOptionChange(event.target.value)}
						disabled={creating || loadState !== "loaded"}
					>
						<option value="">Select a workflow version</option>
						{options.map((option) => (
							<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
						))}
					</select>
				</label>
				<label className="grid gap-1.5 text-xs font-semibold text-slate-300">
					<span>Session name</span>
					<input
						aria-label="Workflow session name"
						className="rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#11a4d4] disabled:opacity-60"
						value={titleValue}
						onChange={(event) => onTitleChange(event.target.value)}
						placeholder="Optional"
						disabled={creating}
					/>
				</label>
				<button
					type="button"
					onClick={onCreate}
					disabled={disabled}
					className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/60 bg-[#11a4d4]/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#11a4d4] transition hover:bg-[#11a4d4]/15 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
				>
					{creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
					Save configured session
				</button>
			</div>
			{selectedOption ? (
				<div className="mt-3 rounded-sm border border-slate-800 bg-[#101d22]/70 p-3 text-xs leading-5 text-slate-500">
					<span className="font-semibold text-slate-300">{selectedOption.title}</span> <span className="font-mono text-slate-400">{selectedOption.id}@{selectedOption.version}</span>
					{selectedOption.description ? <span> — {selectedOption.description}</span> : null}
				</div>
			) : null}
			<ProjectWorkflowScopeBoundaryPanel />
			{loadState === "loading" ? <div className="mt-3 text-xs text-slate-500">Loading workflow catalog…</div> : null}
			{loadState === "error" ? <div className="mt-3 rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-200" role="alert">{errorMessage ?? "Failed to load workflow catalog."}</div> : null}
			{diagnostics.length ? <WorkflowDiagnosticsNotice label="Create-blocking diagnostics" diagnostics={diagnostics} /> : null}
		</section>
	);
}

function WorkflowDiagnosticsNotice({ label, diagnostics }: { label: string; diagnostics: WorkflowUiDiagnostic[] }) {
	return (
		<div className="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100" role="alert" aria-label={label}>
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200"><AlertTriangle size={12} />{label}</div>
			<div className="mt-2 space-y-2">
				{diagnostics.map((diagnostic, index) => (
					<div key={`${diagnostic.code ?? "diagnostic"}:${diagnostic.path ?? diagnostic.registryRef ?? diagnostic.nodeId ?? diagnostic.edgeId ?? index}`} className="rounded-sm border border-red-500/25 bg-[#0b0f14]/60 p-2">
						<div className="break-words text-red-100">{diagnostic.message ?? diagnostic.code ?? "Workflow validation blocked this action."}</div>
						<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
							{diagnostic.code ? <span>{diagnostic.code}</span> : null}
							{diagnostic.path ? <span>{diagnostic.path}</span> : null}
							{diagnostic.nodeId ? <span>node:{diagnostic.nodeId}</span> : null}
							{diagnostic.edgeId ? <span>edge:{diagnostic.edgeId}</span> : null}
							{diagnostic.registryRef ? <span>{diagnostic.registryRef}</span> : null}
						</div>
						{diagnostic.hint ? <div className="mt-1 text-[11px] text-red-100/75">{diagnostic.hint}</div> : null}
					</div>
				))}
			</div>
		</div>
	);
}

function ProjectWorkflowScopeBoundaryPanel() {
	return (
		<div className="mt-3 rounded-sm border border-amber-700/60 bg-amber-950/15 p-3 text-[11px] leading-5 text-amber-100/80" aria-label="Project workflow V2 explicit non-goals">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200"><Lock size={12} />V2 scope boundary</div>
			<p className="mt-2">
				Project workflow sessions select published catalog versions and save configured sessions only. They do not expose workflow templates, workflow slash commands, workflow tools for agents, inline TypeScript/JavaScript/shell/eval code, raw XState editing, TypeScript export, YAML/JSON product import/export, or Zod schema authoring.
			</p>
		</div>
	);
}

function ConfiguredWorkflowStartPanel({
	projectSession,
	lifecycleEvents,
	starting,
	message,
	onStart,
}: {
	projectSession: PiboProjectSession;
	lifecycleEvents: readonly WorkflowLifecycleEventRecord[];
	starting: boolean;
	message: string | null;
	onStart: () => void;
}) {
	const configurationSummary = workflowConfiguredSessionConfigurationSummary(projectSession);
	const validationEvent = latestWorkflowSessionValidationEvent(projectSession.piboSessionId, lifecycleEvents);
	const validation = workflowConfiguredSessionValidationSummary(validationEvent);
	const blockingDiagnostics = latestWorkflowStartBlockingDiagnostics(projectSession.piboSessionId, lifecycleEvents);
	const messageClass = workflowStartPanelMessageClass(message);
	return (
		<section className="rounded-sm border border-[#11a4d4]/35 bg-[#111820] p-4 shadow-lg shadow-black/10" aria-labelledby="project-workflow-start-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 max-w-2xl">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Power size={13} />Configured/not-started</div>
					<h2 id="project-workflow-start-title" className="mt-1 text-sm font-bold text-slate-100">Ready to start workflow</h2>
					<p className="mt-1 text-xs leading-5 text-slate-500">
						This Project session is saved for review. Start explicitly when the configuration is ready.
					</p>
				</div>
				<button
					type="button"
					onClick={onStart}
					disabled={starting}
					className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
				>
					{starting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
					Start workflow
				</button>
			</div>
			<div className="mt-4 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Workflow</div>
					<div className="mt-1 truncate font-mono text-slate-300" title={projectSession.workflowId}>{projectSession.workflowId}</div>
					{projectSession.workflowVersion ? <div className="mt-1 text-slate-500">version {projectSession.workflowVersion}</div> : null}
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Configuration summary</div>
					<div className="mt-1 text-slate-300">{configurationSummary.primary}</div>
					<div className="mt-1 text-slate-500">{configurationSummary.secondary}</div>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Validation state</div>
					<div className={validation.className}>{validation.label}</div>
					<div className="mt-1 text-slate-500">{validation.description}</div>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Run history</div>
					<div className="mt-1 text-slate-300">No current run attempts</div>
					<div className="mt-1 text-slate-500">No workflow run record exists until Start succeeds.</div>
				</div>
			</div>
			{blockingDiagnostics.length ? (
				<div className="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100" role="alert" aria-label="Start-blocking diagnostics">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200"><AlertTriangle size={12} />Start-blocking diagnostics</div>
					<div className="mt-2 space-y-2">
						{blockingDiagnostics.map((diagnostic, index) => (
							<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.registryRef ?? index}`} className="rounded-sm border border-red-500/25 bg-[#0b0f14]/60 p-2">
								<div className="break-words text-red-100">{diagnostic.message}</div>
								<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
									<span>{diagnostic.code}</span>
									{diagnostic.path ? <span>{diagnostic.path}</span> : null}
									{diagnostic.registryRef ? <span>{diagnostic.registryRef}</span> : null}
								</div>
								{diagnostic.hint ? <div className="mt-1 text-[11px] text-red-100/75">{diagnostic.hint}</div> : null}
							</div>
						))}
					</div>
				</div>
			) : null}
			{message ? <div className={`mt-3 rounded-sm border p-3 text-xs ${messageClass}`} role="status">{message}</div> : null}
		</section>
	);
}

type WorkflowLifecycleDiagnostic = WorkflowLifecycleEventRecord["diagnostics"][number];
type WorkflowUiDiagnostic = Partial<WorkflowLifecycleDiagnostic> & { code?: string; message?: string };

function workflowConfiguredSessionConfigurationSummary(projectSession: PiboProjectSession): { primary: string; secondary: string } {
	const configuration = projectSession.configuration;
	const inputCount = Object.keys(configuration?.inputValues ?? {}).length;
	const promptOverrideCount = Object.keys(configuration?.promptOverrides ?? {}).length;
	const modelLabel = configuration?.model ? `${configuration.model.provider}/${configuration.model.id}` : "default model";
	const thinkingLabel = configuration?.thinkingLevel ? `${configuration.thinkingLevel} thinking` : "default thinking";
	const fastModeLabel = configuration?.fastMode === true ? "fast mode on" : configuration?.fastMode === false ? "fast mode off" : "default speed";
	return {
		primary: `${inputCount} input ${inputCount === 1 ? "value" : "values"} · ${promptOverrideCount} prompt ${promptOverrideCount === 1 ? "override" : "overrides"}`,
		secondary: `${modelLabel} · ${thinkingLabel} · ${fastModeLabel}`,
	};
}

function latestWorkflowSessionValidationEvent(piboSessionId: string, events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleEventRecord | undefined {
	return latestWorkflowLifecycleEvent(events.filter((event) => event.piboSessionId === piboSessionId && Boolean(event.validation)));
}

function latestWorkflowStartBlockingDiagnostics(piboSessionId: string, events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleDiagnostic[] {
	const blockedEvent = latestWorkflowLifecycleEvent(events.filter((event) => event.piboSessionId === piboSessionId && event.type === "project.workflow_start.blocked"));
	return (blockedEvent?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "error");
}

function latestWorkflowLifecycleEvent(events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleEventRecord | undefined {
	return events.reduce<WorkflowLifecycleEventRecord | undefined>((latest, event) => {
		if (!latest) return event;
		return event.createdAt > latest.createdAt ? event : latest;
	}, undefined);
}

function workflowConfiguredSessionValidationSummary(event: WorkflowLifecycleEventRecord | undefined): { label: string; description: string; className: string } {
	if (!event?.validation) {
		return {
			label: "not checked yet",
			description: "Validation runs before Start creates a workflow run.",
			className: "mt-1 text-slate-300",
		};
	}
	const validation = event.validation;
	const counts = `${validation.errorCount} errors · ${validation.warningCount} warnings`;
	if (validation.blocksRun || validation.validationState === "error") {
		return {
			label: `blocked · ${counts}`,
			description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
			className: "mt-1 text-red-200",
		};
	}
	if (validation.validationState === "warning") {
		return {
			label: `warnings · ${counts}`,
			description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
			className: "mt-1 text-amber-200",
		};
	}
	return {
		label: `valid · ${counts}`,
		description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
		className: "mt-1 text-emerald-200",
	};
}

function workflowStartPanelMessageClass(message: string | null): string {
	if (message?.toLowerCase().includes("blocked")) return "border-red-500/40 bg-red-500/10 text-red-200";
	return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
}

function shortWorkflowTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function workflowVersionOptionKey(option: WorkflowVersionPickerOption): string {
	return `${option.id}@${option.version}`;
}

function workflowVersionOptionLabel(option: WorkflowVersionPickerOption): string {
	return `${option.title} (${option.id}@${option.version})`;
}

function WorkflowRunsPanel({
	projectSessions,
	sessionNodes,
	selectedPiboSessionId,
	onSelect,
}: {
	projectSessions: PiboProjectSession[];
	sessionNodes: PiboWebSessionNode[];
	selectedPiboSessionId: string | null;
	onSelect: (piboSessionId: string) => void;
}) {
	return (
		<div>
			<div className="flex items-center justify-between gap-2 px-1 pb-1">
				<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Workflow Runs</div>
				<div className="text-[10px] text-slate-500">{projectSessions.length}</div>
			</div>
			<div className="space-y-1">
				{projectSessions.map((projectSession) => {
					const sessionNode = findSessionNode(sessionNodes, projectSession.piboSessionId);
					const title = sessionNode ? sessionNodeTitle(sessionNode) : projectSession.title ?? projectSession.piboSessionId;
					const selected = projectSession.piboSessionId === selectedPiboSessionId;
					const stateLabel = workflowStateLabel(projectSession, sessionNode?.status);
					return (
						<button
							key={`${projectSession.workflowRunId ?? projectSession.piboSessionId}:${projectSession.piboSessionId}`}
							type="button"
							onClick={() => onSelect(projectSession.piboSessionId)}
							className={`w-full text-left rounded-sm border px-2 py-2 transition-colors ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 hover:border-slate-700 hover:bg-slate-800/40"}`}
							title={projectSession.workflowRunId ?? projectSession.workflowId}
						>
							<span className="flex items-center justify-between gap-2">
								<span className="min-w-0 text-xs font-medium text-slate-200 truncate">{title}</span>
								<span className={workflowStateBadgeClass(projectSession, sessionNode?.status)}>{stateLabel}</span>
							</span>
							<span className="mt-1 block text-[10px] text-slate-500 truncate">{projectSession.workflowId}</span>
							{projectSession.workflowRunId ? <span className="block text-[10px] font-mono text-slate-500 truncate">run {shortWorkflowId(projectSession.workflowRunId)}</span> : null}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function isWorkflowBackedProjectSession(projectSession: PiboProjectSession): boolean {
	return Boolean(projectSession.workflowRunId) || projectSession.state === "workflow" || projectSession.workflowId !== "simple-chat";
}

function isConfiguredWorkflowSessionPending(projectSession: PiboProjectSession): boolean {
	return isWorkflowBackedProjectSession(projectSession) && projectSession.state === "configured" && !projectSession.workflowRunId;
}

type ProjectSessionViewRouting = {
	viewId: ChatSessionViewId;
	workflowProjectSession?: PiboProjectSession;
};

function resolveProjectSessionViewRouting(input: {
	selectedSessionNode?: PiboWebSessionNode;
	selectedProjectSession?: PiboProjectSession;
	selectedSession?: PiboSession;
	selectedProject?: PiboProject;
}): ProjectSessionViewRouting {
	const workflowSessionKind = input.selectedSessionNode?.workflowSessionKind ?? workflowSessionKindFromProjectMetadata(input.selectedSession?.metadata);
	if (workflowSessionKind === "main_workflow" || workflowSessionKind === "nested_workflow") {
		if (input.selectedProjectSession && !isWorkflowBackedProjectSession(input.selectedProjectSession)) {
			return { viewId: "terminal" };
		}
		if (!input.selectedProjectSession && workflowSessionKind === "main_workflow" && selectedMetadataWorkflowId(input.selectedSession?.metadata) === "simple-chat") {
			return { viewId: "terminal" };
		}
		const workflowProjectSession = input.selectedProjectSession && isWorkflowBackedProjectSession(input.selectedProjectSession)
			? input.selectedProjectSession
			: createWorkflowViewProjectSession({
				selectedSessionNode: input.selectedSessionNode,
				selectedSession: input.selectedSession,
				selectedProject: input.selectedProject,
				workflowSessionKind,
			});
		return { viewId: "workflow", ...(workflowProjectSession ? { workflowProjectSession } : {}) };
	}
	if (workflowSessionKind === "agent_node" || workflowSessionKind === "subagent") {
		return { viewId: "terminal" };
	}
	if (input.selectedProjectSession && isWorkflowBackedProjectSession(input.selectedProjectSession)) {
		return { viewId: "workflow", workflowProjectSession: input.selectedProjectSession };
	}
	return { viewId: "terminal" };
}

function workflowSessionKindFromProjectMetadata(metadata: PiboSession["metadata"] | undefined): PiboWebSessionNode["workflowSessionKind"] {
	const kind = metadataString(metadata, "workflowSessionKind");
	if (kind === "main_workflow" || kind === "nested_workflow" || kind === "agent_node" || kind === "subagent") return kind;
	if (metadataString(metadata, "projectSessionKind") === "main") return "main_workflow";
	return undefined;
}

function selectedMetadataWorkflowId(metadata: PiboSession["metadata"] | undefined): string | undefined {
	return metadataString(metadata, "projectWorkflowId") ?? metadataString(metadata, "workflowId");
}

function createWorkflowViewProjectSession(input: {
	selectedSessionNode?: PiboWebSessionNode;
	selectedSession?: PiboSession;
	selectedProject?: PiboProject;
	workflowSessionKind: "main_workflow" | "nested_workflow";
}): PiboProjectSession | undefined {
	const piboSessionId = input.selectedSessionNode?.piboSessionId ?? input.selectedSession?.id;
	if (!piboSessionId) return undefined;
	const metadata = input.selectedSession?.metadata;
	const workflowId = selectedMetadataWorkflowId(metadata)
		?? (input.workflowSessionKind === "nested_workflow" ? "nested-workflow-session" : "workflow-session");
	const workflowVersion = metadataString(metadata, "projectWorkflowVersion") ?? metadataString(metadata, "workflowVersion");
	const workflowRunId = metadataString(metadata, "workflowRunId");
	return {
		projectId: input.selectedProject?.id ?? metadataString(metadata, "projectId") ?? "project",
		piboSessionId,
		kind: input.workflowSessionKind === "nested_workflow" ? "sub" : "main",
		workflowId,
		...(workflowVersion ? { workflowVersion } : {}),
		...(workflowRunId ? { workflowRunId } : {}),
		...(input.selectedSessionNode?.parentId ? { parentMainSessionId: input.selectedSessionNode.parentId } : {}),
		...(input.selectedSessionNode?.title || input.selectedSession?.title ? { title: input.selectedSessionNode?.title ?? input.selectedSession?.title } : {}),
		state: workflowStateFromSessionNode(input.selectedSessionNode, workflowRunId),
		...(input.selectedSessionNode?.archived !== undefined ? { archived: input.selectedSessionNode.archived } : {}),
		createdAt: input.selectedSession?.createdAt ?? PROJECT_ROUTING_UNKNOWN_TIMESTAMP,
		updatedAt: input.selectedSession?.updatedAt ?? input.selectedSessionNode?.lastActivityAt ?? PROJECT_ROUTING_UNKNOWN_TIMESTAMP,
	};
}

function workflowStateFromSessionNode(sessionNode: PiboWebSessionNode | undefined, workflowRunId: string | undefined): PiboProjectSession["state"] {
	if (sessionNode?.status === "error") return "failed";
	if (sessionNode?.status === "running") return "running";
	return workflowRunId ? "workflow" : "configured";
}

function metadataString(metadata: PiboSession["metadata"] | undefined, key: string): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function workflowSessionLabel(projectSession: PiboProjectSession): string {
	if (!isWorkflowBackedProjectSession(projectSession)) return `Workflow: ${projectSession.workflowId}`;
	const run = projectSession.workflowRunId ? ` · run ${shortWorkflowId(projectSession.workflowRunId)}` : "";
	return `Workflow: ${projectSession.workflowId}${run} · ${workflowStateLabel(projectSession)}`;
}

type WorkflowHeaderSummary = {
	workflowId: string;
	state: string;
	workflowRunId?: string;
};

function createWorkflowHeaderSummary(projectSession: PiboProjectSession, selectedSessionStatus: PiboWebSessionStatus | undefined): WorkflowHeaderSummary {
	return {
		workflowId: projectSession.workflowId,
		state: workflowStateLabel(projectSession, selectedSessionStatus),
		...(projectSession.workflowRunId ? { workflowRunId: projectSession.workflowRunId } : {}),
	};
}

function WorkflowHeaderMeta({ summary }: { summary: WorkflowHeaderSummary }) {
	return (
		<>
			<span className="text-slate-600">·</span>
			<span className="min-w-0 max-w-52 truncate rounded border border-[#11a4d4]/35 bg-[#11a4d4]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#11a4d4]" title={summary.workflowId}>
				workflow {summary.workflowId}
			</span>
			<span className={workflowStateBadgeClassFromLabel(summary.state)}>state {summary.state}</span>
			{summary.workflowRunId ? (
				<span className="min-w-0 max-w-40 truncate rounded border border-slate-700 bg-slate-900/40 px-1.5 py-0.5 text-[10px] text-slate-400" title={summary.workflowRunId}>
					run {shortWorkflowId(summary.workflowRunId)}
				</span>
			) : null}
		</>
	);
}

function workflowStateLabel(projectSession: PiboProjectSession, selectedSessionStatus?: PiboWebSessionStatus): string {
	if (projectSession.archived) return "archived";
	if (projectSession.state && projectSession.state !== "workflow") return projectSession.state.replace(/_/g, " ");
	if (selectedSessionStatus === "running") return "running";
	if (selectedSessionStatus === "error") return "failed";
	if (projectSession.state) return projectSession.state.replace(/_/g, " ");
	return projectSession.workflowRunId ? "workflow" : projectSession.kind;
}

function workflowStateBadgeClass(projectSession: PiboProjectSession, selectedSessionStatus?: PiboWebSessionStatus): string {
	return workflowStateBadgeClassFromLabel(workflowStateLabel(projectSession, selectedSessionStatus), projectSession.archived);
}

function workflowStateBadgeClassFromLabel(stateLabel: string, archived = false): string {
	const state = stateLabel.toLowerCase();
	const base = "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide";
	if (archived) return `${base} border-slate-700 text-slate-500`;
	if (state.includes("failed") || state.includes("error")) return `${base} border-red-500/40 text-red-300 bg-red-500/10`;
	if (state.includes("waiting")) return `${base} border-amber-500/40 text-amber-300 bg-amber-500/10`;
	if (state.includes("complete") || state.includes("done")) return `${base} border-emerald-500/40 text-emerald-300 bg-emerald-500/10`;
	return `${base} border-[#11a4d4]/40 text-[#11a4d4] bg-[#11a4d4]/10`;
}

function shortWorkflowId(value: string): string {
	return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function ProjectRow({ project, selected, archived, onSelect, onRename, onArchive, onDelete }: { project: PiboProject; selected: boolean; archived?: boolean; onSelect: () => void; onRename?: (name: string) => void; onArchive?: () => void; onDelete?: () => void }) {
	const personal = project.metadata?.personal === true;
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
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
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
		<div className={`group flex items-center gap-2 rounded-sm border px-2 py-2 text-sm ${
			personal
				? selected
					? "border-[#0bda57] bg-[#0bda57]/10 text-green-100"
					: "border-[#0bda57]/50 bg-[#0bda57]/5 text-slate-300 hover:border-[#0bda57]"
				: selected
					? "border-[#11a4d4] bg-[#11a4d4]/10 text-sky-100"
					: "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-900/40"
		}`}>
			<span className={`h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-sm ${personal ? "bg-[#0bda57]/15 text-[#0bda57]" : archived ? "bg-[#f59e0b]/15 text-[#f59e0b]" : "bg-[#151f24] text-slate-500"}`}>
				{personal ? <Lock size={13} /> : archived ? <Archive size={13} /> : <FolderPlus size={13} />}
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
					<button type="submit" title="Save Project Name" aria-label="Save Project Name" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><Check size={13} /></button>
					<button type="button" onClick={() => { setEditing(false); setDraftName(project.name); }} title="Cancel Rename" aria-label="Cancel Rename" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"><X size={13} /></button>
				</form>
			) : (
				<button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
					<span className="block truncate font-medium">{project.name}</span>
					<span className="block truncate text-[11px] text-slate-500">{personal ? "locked personal project chat" : project.projectFolder}</span>
				</button>
			)}
			{personal ? (
				<span title="Personal Chat is locked" aria-label="Personal Chat is locked" className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-[#0bda57]/50 rounded-sm text-[#0bda57]">
					<Lock size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
				</span>
			) : editing ? null : (
				<div className="relative opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100" ref={menuRef}>
					<button type="button" onClick={() => setMenuOpen((value) => !value)} title="Project actions" aria-label="Project actions" className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<MoreVertical size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
					</button>
					{menuOpen ? (
						<div className="absolute right-0 top-full z-50 mt-1 w-48 bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1">
							{onRename ? <button type="button" onClick={() => { setMenuOpen(false); setEditing(true); }} className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"><Edit3 size={16} /> Rename Project</button> : null}
							{onArchive ? <button type="button" onClick={() => { setMenuOpen(false); onArchive(); }} className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2">{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {archived ? "Restore Project" : "Archive Project"}</button> : null}
							{onDelete ? <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }} className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/10 flex items-center gap-2"><Trash2 size={16} /> Delete Project</button> : null}
						</div>
					) : null}
				</div>
			)}
		</div>
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

function SessionTracePane({
	bootstrap,
	selectedPiboSessionId,
	selectedRoomId,
	selectedRoomArchived,
	selectedSessionProfile,
	selectedSessionActiveModel,
	selectedSessionStatus,
	selectedSessionSignal,
	workflowProjectSession,
	workflowLifecycleEvents,
	projectSessionCreatePanel,
	workflowStartPanel,
	sessionViewId,
	sessionViews,
	currentSessionView,
	allowedSessionViewIds,
	creatingSession,
	showRawEvents,
	showThinking,
	expandThinking,
	commands,
	skills,
	composerText,
	composerFocusSignal,
	onComposerTextChange,
	onToggleRawEvents,
	onToggleThinking,
	onToggleExpandThinking,
	onSessionAgentProfileChange,
	onFork,
	onOpenSession,
	onSelectSessionView,
	onCommand,
	onThinkingLevelChange,
	onRefreshTrace,
	onRefreshBootstrap,
	onSend,
	onError,
}: {
	bootstrap: BootstrapData;
	selectedPiboSessionId: string | null;
	selectedRoomId: string | null;
	selectedRoomArchived: boolean;
	selectedSessionProfile: string;
	selectedSessionActiveModel?: string;
	selectedSessionStatus?: PiboWebSessionStatus;
	selectedSessionSignal?: PiboSignalSnapshot["sessions"][string];
	workflowProjectSession?: PiboProjectSession;
	workflowLifecycleEvents?: readonly WorkflowLifecycleEventRecord[];
	projectSessionCreatePanel?: ReactNode;
	workflowStartPanel?: ReactNode;
	sessionViewId: ChatSessionViewId;
	sessionViews: ReturnType<typeof listChatSessionViews>;
	currentSessionView: ReturnType<typeof getChatSessionView>;
	allowedSessionViewIds?: readonly ChatSessionViewId[];
	creatingSession: boolean;
	showRawEvents: boolean;
	showThinking: boolean;
	expandThinking: boolean;
	commands: SlashCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	composerText: string;
	composerFocusSignal: number;
	onComposerTextChange: Dispatch<SetStateAction<string>>;
	onToggleRawEvents: () => void;
	onToggleThinking: () => void;
	onToggleExpandThinking: () => void;
	onSessionAgentProfileChange: (profile: string) => void;
	onFork: (entryId: string) => void;
	onOpenSession: (piboSessionId: string) => void;
	onSelectSessionView: (viewId: ChatSessionViewId) => void;
	onCommand: (text: string) => Promise<boolean>;
	onThinkingLevelChange: (level: ThinkingLevel) => void;
	onRefreshTrace: () => Promise<void>;
	onRefreshBootstrap: () => Promise<unknown>;
	onSend: (text: string, webAnnotationIds?: readonly string[], fileAttachmentPaths?: readonly string[]) => Promise<void>;
	onError: (message: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);
	const liveEventSeqRef = useRef(0);
	const [liveTraceOverlay, setLiveTraceOverlay] = useState<LiveTraceOverlay | null>(null);
	const [traceEventLimit, setTraceEventLimit] = useState(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
	const [rawEventLimit, setRawEventLimit] = useState(DEFAULT_RAW_EVENTS_LIMIT);
	const [baseTraceView, setBaseTraceView] = useState<PiboSessionTraceView | null>(null);
	const [selectedWebAnnotationIds, setSelectedWebAnnotationIds] = useState<string[]>([]);
	const [selectedUploadAttachmentsBySession, setSelectedUploadAttachmentsBySession] = useState<Record<string, UploadedChatAttachment[]>>({});
	const [webAnnotationsPanelVisible, setWebAnnotationsPanelVisible] = useState(false);
	const [webAnnotationsPanelCollapsed, setWebAnnotationsPanelCollapsed] = useState(() => readStoredWebAnnotationsPanelCollapsed());
	const [clearingWebAnnotations, setClearingWebAnnotations] = useState(false);
	const [copiedHeaderPiboSessionId, setCopiedHeaderPiboSessionId] = useState<string | null>(null);
	const copyHeaderPiboSessionTimeout = useRef<number | undefined>(undefined);
	const traceSummaryQueryKey = useMemo(
		() => selectedPiboSessionId ? chatTraceSummaryQueryKey(selectedPiboSessionId) : null,
		[selectedPiboSessionId],
	);
	const tracePageQueryKey = useMemo(
		() =>
			selectedPiboSessionId
				? chatTracePageQueryKey(selectedPiboSessionId, { includeRawEvents: showRawEvents, rawEventsLimit: rawEventLimit, pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE })
				: null,
		[rawEventLimit, selectedPiboSessionId, showRawEvents],
	);
	const traceSummaryQuery = useQuery({
		queryKey: traceSummaryQueryKey ?? ["chat", "trace-summary", "idle"],
		queryFn: async () => {
			if (!selectedPiboSessionId || !traceSummaryQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceSummary>(traceSummaryQueryKey);
			const response = await getTraceSummary(selectedPiboSessionId, cached?.version);
			if (response.notModified && cached) return cached;
			if (!response.summary) throw new Error("Trace summary response missing payload.");
			return response.summary;
		},
		enabled: Boolean(selectedPiboSessionId),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});
	const tracePageQuery = useQuery({
		queryKey: tracePageQueryKey ?? ["chat", "trace-page", "idle", "compact", rawEventLimit, DEFAULT_TRACE_EVENTS_PAGE_SIZE, "tail"],
		queryFn: async () => {
			if (!selectedPiboSessionId || !tracePageQueryKey) throw new Error("Session is required");
			const cached = queryClient.getQueryData<PiboSessionTraceView>(tracePageQueryKey);
			const response = await getTrace(selectedPiboSessionId, {
				includeRawEvents: showRawEvents,
				rawEventsLimit: rawEventLimit,
				pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
				knownVersion: cached?.version,
			});
			if (response.notModified && cached) return cached;
			if (!response.trace) throw new Error("Trace page response missing payload.");
			return response.trace;
		},
		enabled: Boolean(selectedPiboSessionId),
		staleTime: TRACE_STALE_TIME_MS,
		gcTime: TRACE_GC_TIME_MS,
		refetchOnWindowFocus: false,
		retry: 1,
	});
	const webAnnotationsQuery = useQuery({
		queryKey: ["web-annotations", "owner", selectedPiboSessionId],
		queryFn: async () => {
			if (!selectedPiboSessionId) throw new Error("Session is required");
			return listWebAnnotations(selectedPiboSessionId, { limit: 100, scope: "owner" });
		},
		enabled: Boolean(selectedPiboSessionId) && (webAnnotationsPanelVisible || selectedWebAnnotationIds.length > 0),
		staleTime: 1_000,
		refetchOnWindowFocus: webAnnotationsPanelVisible,
		refetchInterval: webAnnotationsPanelVisible ? 5_000 : false,
		retry: 1,
	});
	const visibleWebAnnotations = useMemo(
		() => (webAnnotationsQuery.data?.annotations ?? []).filter((annotation) => annotation.status !== "resolved" && annotation.status !== "dismissed"),
		[webAnnotationsQuery.data?.annotations],
	);
	const selectedWebAnnotations = useMemo(
		() => selectedWebAnnotationIds
			.map((id) => visibleWebAnnotations.find((annotation) => annotation.id === id))
			.filter((annotation): annotation is WebAnnotationMessageAttachment => Boolean(annotation)),
		[selectedWebAnnotationIds, visibleWebAnnotations],
	);
	const selectedUploadAttachments = useMemo(
		() => selectedPiboSessionId ? selectedUploadAttachmentsBySession[selectedPiboSessionId] ?? [] : [],
		[selectedPiboSessionId, selectedUploadAttachmentsBySession],
	);

	useEffect(() => {
		setTraceEventLimit(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
		setRawEventLimit(DEFAULT_RAW_EVENTS_LIMIT);
		setBaseTraceView(null);
		setLiveTraceOverlay(null);
		setSelectedWebAnnotationIds(selectedPiboSessionId ? readStoredSelectedWebAnnotationIds(selectedPiboSessionId) : []);
	}, [selectedPiboSessionId]);

	useEffect(() => {
		if (!webAnnotationsQuery.data) return;
		if (!visibleWebAnnotations.length) {
			setSelectedWebAnnotationIds((current) => {
				if (current.length && selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, []);
				return current.length ? [] : current;
			});
			return;
		}
		const visibleIds = new Set(visibleWebAnnotations.map((annotation) => annotation.id));
		setSelectedWebAnnotationIds((current) => {
			const next = current.filter((id) => visibleIds.has(id));
			if (next.length !== current.length && selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, next);
			return next.length === current.length ? current : next;
		});
	}, [selectedPiboSessionId, visibleWebAnnotations, webAnnotationsQuery.data]);

	// TanStack Query caches only bounded trace pages and summaries. The render path
	// reads from local state so a synchronous cache hit cannot rehydrate a trace in
	// the same click task that switched sessions.
	useEffect(() => {
		const trace = tracePageQuery.data;
		if (!trace || trace.piboSessionId !== selectedPiboSessionId) return;
		const maxSeq = trace.rawEvents
			.map((e) => e.eventSequence ?? 0)
			.reduce((a, b) => Math.max(a, b), 0);
		liveEventSeqRef.current = Math.max(liveEventSeqRef.current, maxSeq + 1);
		startTransition(() => {
			setBaseTraceView(trace);
			setLiveTraceOverlay((current) => trimLiveOverlayForBaseTrace(current, trace));
		});
	}, [selectedPiboSessionId, tracePageQuery.data]);

	const currentTraceView = useMemo(() => {
		if (!selectedPiboSessionId || !bootstrap) return null;
		if (baseTraceView?.piboSessionId !== selectedPiboSessionId) return null;
		const sessionStatus = findSessionNode(bootstrap.sessions, selectedPiboSessionId)?.status ?? "idle";
		const overlayEvents = liveTraceOverlay?.piboSessionId === selectedPiboSessionId
			? liveTraceOverlay.events
			: [];
		if (!overlayEvents.length) return reconcileOptimisticUserMessages(baseTraceView);
		const liveTrace = patchTraceViewWithEvents(baseTraceView, overlayEvents, sessionStatus);
		annotateLiveTraceForkEntryIds(liveTrace.nodes, baseTraceView.nodes);
		return reconcileOptimisticUserMessages(liveTrace);
	}, [liveTraceOverlay, selectedPiboSessionId, bootstrap, baseTraceView]);

	const loadOlderTracePage = useCallback(async () => {
		if (!selectedPiboSessionId || !currentTraceView?.nextBeforeSequence) return;
		const beforeSequence = currentTraceView.nextBeforeSequence;
		const queryKey = chatTracePageQueryKey(selectedPiboSessionId, {
			includeRawEvents: showRawEvents,
			rawEventsLimit: rawEventLimit,
			pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
			beforeSequence,
		});
		const olderTrace = await queryClient.fetchQuery({
			queryKey,
			queryFn: async () => {
				const cached = queryClient.getQueryData<PiboSessionTraceView>(queryKey);
				const response = await getTrace(selectedPiboSessionId, {
					includeRawEvents: showRawEvents,
					rawEventsLimit: rawEventLimit,
					pageSize: DEFAULT_TRACE_EVENTS_PAGE_SIZE,
					beforeSequence,
					knownVersion: cached?.version,
				});
				if (response.notModified && cached) return cached;
				if (!response.trace) throw new Error("Trace page response missing payload.");
				return response.trace;
			},
			staleTime: TRACE_STALE_TIME_MS,
			gcTime: TRACE_GC_TIME_MS,
		});
		startTransition(() => {
			setBaseTraceView((current) => current ? mergeOlderTracePage(current, olderTrace) : olderTrace);
			setTraceEventLimit((current) => current + (olderTrace.pageSize ?? DEFAULT_TRACE_EVENTS_PAGE_SIZE));
		});
	}, [currentTraceView?.nextBeforeSequence, queryClient, rawEventLimit, selectedPiboSessionId, showRawEvents]);

	const flushPendingStreamEvents = useCallback((piboSessionId: string) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId);
		if (!pending?.length) return;
		setLiveTraceOverlay((current) => {
			const currentEvents = current?.piboSessionId === piboSessionId ? current.events : [];
			return {
				piboSessionId,
				events: applyTraceLiveEvents({
					currentEvents,
					streamEvents: pending,
					piboSessionId,
					nextSequence: () => liveEventSeqRef.current++,
				}),
			};
		});
		pendingStreamEventsBySession.current.delete(piboSessionId);
	}, []);

	const schedulePendingStreamFlush = useCallback(() => {
		if (pendingStreamFrame.current !== undefined || !selectedPiboSessionId) return;
		pendingStreamFrame.current = requestAnimationFrame(() => {
			pendingStreamFrame.current = undefined;
			flushPendingStreamEvents(selectedPiboSessionId);
		});
	}, [flushPendingStreamEvents, selectedPiboSessionId]);

	const enqueueStreamEvent = useCallback((piboSessionId: string, event: ChatStreamEvent, flushImmediately = false) => {
		const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
		pending.push(event);
		pendingStreamEventsBySession.current.set(piboSessionId, pending);
		if (flushImmediately || piboSessionId !== selectedPiboSessionId) {
			flushPendingStreamEvents(piboSessionId);
		} else {
			schedulePendingStreamFlush();
		}
	}, [flushPendingStreamEvents, schedulePendingStreamFlush, selectedPiboSessionId]);

	useEffect(() => {
		return () => {
			if (pendingStreamFrame.current !== undefined) {
				cancelAnimationFrame(pendingStreamFrame.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!selectedPiboSessionId || !tracePageQueryKey) return;
		if (!currentTraceView || currentTraceView.piboSessionId !== selectedPiboSessionId) return;
		const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
		if (currentTraceView?.latestStreamId !== undefined) {
			params.set("since", `${currentTraceView.latestStreamId}:999999`);
		}
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		let traceTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapRefreshInFlight = false;
		let bootstrapRefreshPending = false;
		const scheduleTraceRefresh = (delayMs: number, reset = false) => {
			if (traceTimer) {
				if (!reset) return;
				clearTimeout(traceTimer);
			}
			traceTimer = setTimeout(() => {
				traceTimer = undefined;
				onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
			}, delayMs);
		};
		const refreshBootstrap = () => {
			if (bootstrapRefreshInFlight) {
				bootstrapRefreshPending = true;
				return;
			}
			bootstrapRefreshInFlight = true;
			onRefreshBootstrap()
				.catch((caught) => onError(errorMessage(caught)))
				.finally(() => {
					bootstrapRefreshInFlight = false;
					if (!bootstrapRefreshPending) return;
					bootstrapRefreshPending = false;
					scheduleBootstrapRefresh(250, true);
				});
		};
		const scheduleBootstrapRefresh = (delayMs: number, reset = false) => {
			if (bootstrapTimer) {
				if (!reset) return;
				clearTimeout(bootstrapTimer);
			}
			bootstrapTimer = setTimeout(() => {
				bootstrapTimer = undefined;
				refreshBootstrap();
			}, delayMs);
		};
		const scheduleTerminalBootstrapRefresh = () => {
			scheduleBootstrapRefresh(900, true);
		};
		events.addEventListener("pibo", (message) => {
			const event = chatStreamEvent(message);
			if (!event) return;
			const targetPiboSessionId = event.piboSessionId || selectedPiboSessionId;
			const flushImmediately = event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT";
			if (targetPiboSessionId === selectedPiboSessionId) {
				enqueueStreamEvent(targetPiboSessionId, event, flushImmediately);
			}
			const traceRefreshDelay = eventTraceRefreshDelay(event);
			if (targetPiboSessionId === selectedPiboSessionId && traceRefreshDelay !== undefined) {
				scheduleTraceRefresh(traceRefreshDelay, true);
			} else if (targetPiboSessionId === selectedPiboSessionId && event.type !== "ready" && event.type !== "RAW_EVENT") {
				scheduleTraceRefresh(1500, true);
			}
			if (eventShouldRefreshNavigation(event)) {
				const terminal = event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
				if (terminal) {
					scheduleTerminalBootstrapRefresh();
				} else {
					scheduleBootstrapRefresh(targetPiboSessionId === selectedPiboSessionId ? 0 : 150);
				}
			}
		});
		return () => {
			if (traceTimer) clearTimeout(traceTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			events.close();
		};
	}, [currentTraceView?.latestStreamId, currentTraceView?.piboSessionId, enqueueStreamEvent, onError, onRefreshBootstrap, onRefreshTrace, selectedPiboSessionId, tracePageQueryKey]);

	const selectedTrace = null;
	const selectedSessionNode = selectedPiboSessionId ? findSessionNode(bootstrap.sessions, selectedPiboSessionId) : undefined;
	const traceThinkingState = resolveTraceThinkingState(currentTraceView);
	const sessionActiveModelBadge = formatSessionModelBadge(
		selectedSessionActiveModel,
		bootstrap.runtimeStatus?.thinkingLevel ?? traceThinkingState.level ?? resolveSessionThinkingLevel(bootstrap, selectedSessionProfile, Boolean(selectedSessionNode?.parentId)),
		bootstrap.runtimeStatus?.fastMode ?? traceThinkingState.fast ?? resolveSessionFastMode(bootstrap, selectedSessionProfile, Boolean(selectedSessionNode?.parentId)) ?? false,
	);
	const sessionBreadcrumbs = useMemo(
		() => selectedPiboSessionId ? createSessionBreadcrumbs(bootstrap.sessions, selectedPiboSessionId) : [],
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const originSession = useMemo(
		() => selectedPiboSessionId ? createOriginSessionLink(bootstrap.sessions, selectedPiboSessionId) : undefined,
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const derivedSessions = useMemo(
		() => selectedPiboSessionId ? createDerivedSessionLinks(bootstrap.sessions, selectedPiboSessionId) : [],
		[bootstrap.sessions, selectedPiboSessionId],
	);
	const rawEvents = useMemo(
		() => (showRawEvents ? compactRawEvents(currentTraceView?.rawEvents ?? []) : []),
		[showRawEvents, currentTraceView?.rawEvents],
	);
	const loadingTrace = Boolean(selectedPiboSessionId) && tracePageQuery.isFetching && !currentTraceView;
	const traceError = tracePageQuery.error ? errorMessage(tracePageQuery.error) : traceSummaryQuery.error ? errorMessage(traceSummaryQuery.error) : null;

	useEffect(() => {
		if (!currentTraceView?.piboSessionId) return;
		flushPendingStreamEvents(currentTraceView.piboSessionId);
	}, [currentTraceView?.piboSessionId, flushPendingStreamEvents]);

	useEffect(() => {
		const handleVisibilityChange = () => {
			if (!currentTraceView?.piboSessionId || !isTraceSnapshotCollectionEnabled()) return;
			collectBackendNodes(currentTraceView.piboSessionId, `tab:${document.visibilityState}`, currentTraceView.nodes, {
				traceVersion: currentTraceView.version,
				latestStreamId: currentTraceView.latestStreamId,
				lastRawEventId: currentTraceView.rawEvents.at(-1)?.id,
			});
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [currentTraceView]);

	useEffect(() => {
		return () => {
			if (copyHeaderPiboSessionTimeout.current) window.clearTimeout(copyHeaderPiboSessionTimeout.current);
		};
	}, []);

	useEffect(() => {
		const handleSaved = () => {
			setWebAnnotationsPanelVisible(true);
			void webAnnotationsQuery.refetch();
		};
		window.addEventListener("pibo:web-annotation-saved", handleSaved);
		return () => window.removeEventListener("pibo:web-annotation-saved", handleSaved);
	}, [webAnnotationsQuery]);

	const headerPiboSessionId = currentTraceView?.piboSessionId ?? selectedPiboSessionId ?? "";
	const headerPiboSessionCopied = copiedHeaderPiboSessionId === headerPiboSessionId;
	const workflowHeader = workflowProjectSession && isWorkflowBackedProjectSession(workflowProjectSession)
		? createWorkflowHeaderSummary(workflowProjectSession, selectedSessionStatus)
		: null;
	const allowedSessionViewIdSet = useMemo(() => allowedSessionViewIds ? new Set(allowedSessionViewIds) : null, [allowedSessionViewIds]);
	const copyHeaderPiboSessionId = () => {
		if (!headerPiboSessionId) return;
		void copyTextToClipboard(headerPiboSessionId).catch(() => undefined);
		setCopiedHeaderPiboSessionId(headerPiboSessionId);
		if (copyHeaderPiboSessionTimeout.current) window.clearTimeout(copyHeaderPiboSessionTimeout.current);
		copyHeaderPiboSessionTimeout.current = window.setTimeout(() => setCopiedHeaderPiboSessionId(null), 900);
	};

	const updateSelectedWebAnnotationIds = useCallback((updater: (current: string[]) => string[]) => {
		setSelectedWebAnnotationIds((current) => {
			const next = updater(current);
			if (selectedPiboSessionId) writeStoredSelectedWebAnnotationIds(selectedPiboSessionId, next);
			return next;
		});
	}, [selectedPiboSessionId]);

	const toggleWebAnnotationAttachment = (annotationId: string) => {
		updateSelectedWebAnnotationIds((current) => current.includes(annotationId)
			? current.filter((id) => id !== annotationId)
			: [...current, annotationId].slice(0, 5));
	};

	const clearSelectedWebAnnotationAttachments = () => updateSelectedWebAnnotationIds(() => []);

	const attachUploadedFiles = useCallback((files: readonly ChatUploadedFile[]) => {
		if (!selectedPiboSessionId || !files.length) return;
		setSelectedUploadAttachmentsBySession((current) => {
			const existing = current[selectedPiboSessionId] ?? [];
			const existingPaths = new Set(existing.map((file) => file.path));
			const additions = files
				.filter((file) => file.path && !existingPaths.has(file.path))
				.map((file): UploadedChatAttachment => ({ ...file, id: `upload-${createClientTxnId()}` }));
			if (!additions.length) return current;
			return {
				...current,
				[selectedPiboSessionId]: [...existing, ...additions].slice(0, 10),
			};
		});
	}, [selectedPiboSessionId]);

	const detachUploadAttachment = (attachmentId: string) => {
		if (!selectedPiboSessionId) return;
		setSelectedUploadAttachmentsBySession((current) => {
			const existing = current[selectedPiboSessionId] ?? [];
			const next = existing.filter((attachment) => attachment.id !== attachmentId);
			if (next.length === existing.length) return current;
			return { ...current, [selectedPiboSessionId]: next };
		});
	};

	const clearSelectedUploadAttachments = () => {
		if (!selectedPiboSessionId) return;
		setSelectedUploadAttachmentsBySession((current) => {
			if (!(current[selectedPiboSessionId]?.length)) return current;
			return { ...current, [selectedPiboSessionId]: [] };
		});
	};

	const toggleWebAnnotationsPanelCollapsed = () => {
		setWebAnnotationsPanelCollapsed((current) => {
			const next = !current;
			writeStoredWebAnnotationsPanelCollapsed(next);
			return next;
		});
	};

	const clearVisibleWebAnnotations = async () => {
		if (!visibleWebAnnotations.length || clearingWebAnnotations) return;
		if (!window.confirm(`Dismiss ${visibleWebAnnotations.length} visible web annotations? This keeps sent messages but clears the annotation list.`)) return;
		setClearingWebAnnotations(true);
		try {
			await Promise.all(visibleWebAnnotations.map((annotation) => patchWebAnnotation(annotation.id, { piboSessionId: annotation.piboSessionId, status: "dismissed", summary: "Cleared from Chat Web UI" })));
			clearSelectedWebAnnotationAttachments();
			await webAnnotationsQuery.refetch();
		} catch (caught) {
			onError(compactWebAnnotationError(caught, "Could not clear web annotations"));
		} finally {
			setClearingWebAnnotations(false);
		}
	};

	const handleComposerSend = async (text: string) => {
		if (!selectedPiboSessionId) return;
		const webAnnotationIds = selectedWebAnnotations.map((annotation) => annotation.id);
		const fileAttachmentPaths = selectedUploadAttachments.map((attachment) => attachment.path);
		const now = new Date().toISOString();
		const eventId = `optimistic:user-message:${createClientTxnId()}`;
		const optimisticEvent: ChatWebStoredEvent = {
			id: eventId,
			piboSessionId: selectedPiboSessionId,
			eventSequence: liveEventSeqRef.current++,
			eventId,
			type: "message_queued",
			createdAt: now,
			payload: {
				type: "message_queued",
				piboSessionId: selectedPiboSessionId,
				eventId,
				queuedMessages: 1,
				text,
				...(fileAttachmentPaths.length ? { fileAttachmentPaths } : {}),
				source: "user",
			},
		};
		setLiveTraceOverlay((current) => ({
			piboSessionId: selectedPiboSessionId,
			events: [...(current?.piboSessionId === selectedPiboSessionId ? current.events : []), optimisticEvent],
		}));
		await onSend(text, webAnnotationIds, fileAttachmentPaths);
		clearSelectedWebAnnotationAttachments();
		clearSelectedUploadAttachments();
		await Promise.all([tracePageQuery.refetch(), webAnnotationsQuery.refetch()]);
	};

	return (
		<>
			<main
				data-pibo-debug="chat-shell"
				data-pibo-session-id={selectedPiboSessionId ?? undefined}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-view-id={sessionViewId}
				data-pibo-state={loadingTrace ? "loading" : traceError ? "error" : selectedPiboSessionId ? "ready" : "empty"}
				className="min-h-0 flex flex-col"
			>
				<div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between max-[980px]:h-auto max-[980px]:flex-wrap max-[980px]:py-2 max-[980px]:gap-2">
					<div className="min-w-0">
						<h1 className="text-base font-semibold truncate">
							{currentTraceView?.title ?? selectedPiboSessionId ?? bootstrap.room?.name ?? selectedRoomId}
						</h1>
						<div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500">
							<span className="truncate">{bootstrap.room?.name ?? selectedRoomId ?? "Room"}</span>
							{headerPiboSessionId ? (
								<>
									<span className="text-slate-600">·</span>
									<button
										type="button"
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => void copyHeaderPiboSessionId()}
										title={headerPiboSessionCopied ? "Copied Pibo session ID" : "Copy Pibo session ID"}
										aria-label={headerPiboSessionCopied ? "Copied Pibo session ID" : "Copy Pibo session ID"}
										className={`min-w-0 max-w-48 truncate rounded-sm px-1 font-mono underline-offset-2 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#11a4d4] ${headerPiboSessionCopied ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/50" : "text-slate-400 hover:text-[#11a4d4] hover:underline"}`}
									>
										{headerPiboSessionId}
									</button>
								</>
							) : null}
							{workflowHeader ? <WorkflowHeaderMeta summary={workflowHeader} /> : null}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<WebAnnotationsEntryPoints
							piboSessionId={selectedPiboSessionId}
							piboRoomId={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
							disabled={!selectedPiboSessionId || selectedRoomArchived}
							panelVisible={webAnnotationsPanelVisible}
							onShowPanel={() => setWebAnnotationsPanelVisible(true)}
							onHidePanel={() => setWebAnnotationsPanelVisible(false)}
							onError={onError}
						/>
						<div className="flex items-center rounded-sm border border-slate-700 bg-[#0e1116] p-0.5">
							{sessionViews.map((view) => {
								const disabledByRouting = Boolean(allowedSessionViewIdSet && !allowedSessionViewIdSet.has(view.id));
								return (
									<button
										key={view.id}
										type="button"
										onClick={() => { if (!disabledByRouting) onSelectSessionView(view.id); }}
										disabled={disabledByRouting}
										title={disabledByRouting ? `Project session routing uses the ${currentSessionView.label} view for this session kind.` : view.description ?? view.label}
										aria-label={disabledByRouting ? `${view.label} view unavailable for this Project session kind` : `Switch to ${view.label} view`}
										className={`min-w-20 px-2.5 py-1 text-[11px] font-bold tracking-wide max-[980px]:min-w-0 max-[980px]:px-1.5 disabled:cursor-not-allowed disabled:text-slate-600 ${
											sessionViewId === view.id
												? "bg-[#11a4d4]/10 text-[#11a4d4]"
												: "text-slate-400 hover:text-[#11a4d4] disabled:hover:text-slate-600"
										}`}
									>
										{view.label}
									</button>
								);
							})}
						</div>
						<HeaderIconButton
							onClick={onToggleRawEvents}
							title={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
							ariaLabel={showRawEvents ? "Hide Raw Events" : "Show Raw Events"}
							active={showRawEvents}
						>
							<Bug size={14} />
						</HeaderIconButton>
						<HeaderIconButton
							onClick={onToggleThinking}
							title={showThinking ? "Hide Thinking" : "Show Thinking"}
							ariaLabel={showThinking ? "Hide Thinking" : "Show Thinking"}
							active={showThinking}
						>
							{showThinking ? <Brain size={14} /> : <EyeOff size={14} />}
						</HeaderIconButton>
						{showThinking ? (
							<HeaderIconButton
								onClick={onToggleExpandThinking}
								title={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
								ariaLabel={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
								active={expandThinking}
							>
								{expandThinking ? <ChevronsDown size={14} /> : <ChevronsUp size={14} />}
							</HeaderIconButton>
						) : null}
					</div>
				</div>
				{projectSessionCreatePanel ? (
					<div className="border-b border-slate-800 bg-[#101d22] px-4 py-3">
						{projectSessionCreatePanel}
					</div>
				) : null}
				{workflowStartPanel ? (
					<div className="border-b border-slate-800 bg-[#101d22] px-4 py-3">
						{workflowStartPanel}
					</div>
				) : null}
				{currentTraceView?.hasOlderEvents ? (
					<div className="border-b border-slate-800 bg-[#101d22] px-4 py-2 text-center">
						<button
							type="button"
							onClick={() => void loadOlderTracePage()}
							disabled={tracePageQuery.isFetching}
							className="rounded-sm border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
						>
							{tracePageQuery.isFetching ? "Loading history…" : `Load older trace history (${Math.min(currentTraceView.eventLimit ?? traceEventLimit, currentTraceView.eventCount ?? traceEventLimit)} of ${currentTraceView.eventCount ?? "many"} events)`}
						</button>
					</div>
				) : null}
				{traceError && !currentTraceView ? (
					<div className="min-h-0 flex-1 p-4 text-sm text-red-200">{traceError}</div>
				) : (
					currentSessionView.render({
						traceView: currentTraceView,
						selectedTrace,
						isLoading: loadingTrace,
						showThinking,
						expandThinking,
						sessionAgentProfile: selectedSessionProfile,
						sessionActiveModel: sessionActiveModelBadge,
						selectedSessionStatus,
						selectedSessionSignal,
						workflowProjectSession,
						workflowLifecycleEvents,
						sessionNodes: bootstrap.sessions,
						sessionBreadcrumbs,
						originSession,
						derivedSessions,
						agentProfiles: bootstrap.agents,
						sessionProfileChangeDisabled: creatingSession || selectedRoomArchived,
						onSessionAgentProfileChange,
						onFork,
						onOpenSession,
						onThinkingLevelChange,
						onModelChanged: async () => {
							await onRefreshBootstrap();
							await onRefreshTrace();
						},
						onRefreshBootstrap,
						onError,
					})
				)}
				{webAnnotationsPanelVisible ? (
					<WebAnnotationsSessionPanel
						piboSessionId={selectedPiboSessionId}
						annotations={visibleWebAnnotations}
						selectedIds={selectedWebAnnotationIds}
						loading={webAnnotationsQuery.isLoading || webAnnotationsQuery.isFetching || clearingWebAnnotations}
						error={webAnnotationsQuery.error ? errorMessage(webAnnotationsQuery.error) : null}
						collapsed={webAnnotationsPanelCollapsed}
						onRefresh={() => void webAnnotationsQuery.refetch()}
						onToggle={toggleWebAnnotationAttachment}
						onClear={() => void clearVisibleWebAnnotations()}
						onCollapse={toggleWebAnnotationsPanelCollapsed}
						onClose={() => setWebAnnotationsPanelVisible(false)}
					/>
				) : null}
				<Composer
					sessionId={selectedPiboSessionId}
					disabled={!selectedPiboSessionId || selectedRoomArchived}
					commands={commands}
					skills={skills}
					value={composerText}
					focusSignal={composerFocusSignal}
					selectedWebAnnotations={selectedWebAnnotations}
					selectedUploadAttachments={selectedUploadAttachments}
					onValueChange={onComposerTextChange}
					onCommand={onCommand}
					onDetachWebAnnotation={(id) => updateSelectedWebAnnotationIds((current) => current.filter((candidate) => candidate !== id))}
					onClearWebAnnotations={clearSelectedWebAnnotationAttachments}
					onAttachUploadedFiles={attachUploadedFiles}
					onDetachUploadAttachment={detachUploadAttachment}
					onClearUploadAttachments={clearSelectedUploadAttachments}
					onSend={handleComposerSend}
				/>
			</main>

			{showRawEvents ? (
				<aside className="min-h-0 overflow-auto bg-[#0e1116] border-l border-slate-800 max-[980px]:hidden">
					<div className="h-11 px-3 border-b border-slate-800 flex items-center text-xs font-bold uppercase tracking-wider">Raw Events</div>
					<div className="p-3 flex flex-col gap-2">
						{currentTraceView && rawEvents.length >= rawEventLimit ? (
							<button
								type="button"
								onClick={() => setRawEventLimit((current) => current + DEFAULT_RAW_EVENTS_LIMIT)}
								disabled={tracePageQuery.isFetching}
								className="mb-1 rounded-sm border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-60"
							>
								{tracePageQuery.isFetching ? "Loading raw events…" : `Load older raw events (${rawEvents.length})`}
							</button>
						) : null}
						{rawEvents.slice(-rawEventLimit).reverse().map((event) => (
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
		</>
	);
}

function patchTraceViewWithEvents(
	view: PiboSessionTraceView,
	events: ChatWebStoredEvent[],
	sessionStatus: PiboWebSessionNode["status"],
): PiboSessionTraceView {
	return events.reduce((current, event) => patchTraceViewWithEvent(current, event, sessionStatus), view);
}

type BootstrapMutationSnapshot = {
	localBootstrap: BootstrapData | null;
	queryData: Array<[readonly unknown[], BootstrapData | undefined]>;
};

function createBootstrapMutationSnapshot(queryClient: QueryClient, localBootstrap: BootstrapData | null): BootstrapMutationSnapshot {
	return {
		localBootstrap,
		queryData: queryClient.getQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }),
	};
}

function addSessionNodeToBootstrap(data: BootstrapData, node: PiboWebSessionNode): BootstrapData {
	if (findSessionNode(data.sessions, node.piboSessionId)) return data;
	return { ...data, sessions: [node, ...data.sessions] };
}

function removeSessionsFromBootstrap(data: BootstrapData, piboSessionIds: ReadonlySet<string>): BootstrapData {
	const sessions = removeSessionNodes(data.sessions, piboSessionIds);
	const selectedDeleted = piboSessionIds.has(data.selectedPiboSessionId);
	return {
		...data,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		sessions,
	};
}

function removeSessionNodes(nodes: PiboWebSessionNode[], piboSessionIds: ReadonlySet<string>): PiboWebSessionNode[] {
	let changed = false;
	const next: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (piboSessionIds.has(node.piboSessionId)) {
			changed = true;
			continue;
		}
		const children = removeSessionNodes(node.children, piboSessionIds);
		if (children !== node.children) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

function sessionSubtreeIds(node: PiboWebSessionNode): Set<string> {
	const ids = new Set<string>([node.piboSessionId]);
	for (const child of node.children) {
		for (const id of sessionSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

function replaceOptimisticSessionNode(
	data: BootstrapData,
	tempId: string | undefined,
	node: PiboWebSessionNode,
): BootstrapData {
	if (!tempId) return addSessionNodeToBootstrap(data, node);
	let replaced = false;
	const sessions = replaceSessionNode(data.sessions, tempId, () => {
		replaced = true;
		return node;
	});
	return {
		...data,
		selectedPiboSessionId: data.selectedPiboSessionId === tempId ? node.piboSessionId : data.selectedPiboSessionId,
		session: data.session.id === tempId ? piboSessionFromSessionNode(node, data.session) : data.session,
		sessions: replaced ? sessions : [node, ...sessions],
	};
}

function updateSessionFromPiboSession(data: BootstrapData, session: PiboSession): BootstrapData {
	const archived = typeof session.metadata?.chatWebArchivedAt === "string";
	return {
		...data,
		session: data.session.id === session.id ? session : data.session,
		sessions: replaceSessionNode(data.sessions, session.id, (node) => ({
			...node,
			profile: session.profile,
			activeModel: session.activeModel,
			title: session.title || node.title || "Untitled Session",
			archived,
		})),
	};
}

function updateSessionNodeInBootstrap(
	data: BootstrapData,
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): BootstrapData {
	const session = data.session.id === piboSessionId ? piboSessionFromSessionNode(updater(sessionNodeFromSession(data.session)), data.session) : data.session;
	return { ...data, session, sessions: replaceSessionNode(data.sessions, piboSessionId, updater) };
}

function addRoomToBootstrap(data: BootstrapData, room: PiboRoom): BootstrapData {
	if (findRoomById(data.rooms, room.id)) return data;
	return {
		...data,
		room,
		selectedRoomId: room.id,
		selectedPiboSessionId: "",
		rooms: [room, ...data.rooms],
	};
}

function replaceRoomInBootstrap(data: BootstrapData, roomId: string, room: PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? room : data.room,
		selectedRoomId: data.selectedRoomId === roomId ? room.id : data.selectedRoomId,
		rooms: replaceRoomNode(data.rooms, roomId, () => room),
	};
}

function updateRoomInBootstrap(data: BootstrapData, roomId: string, updater: (room: PiboRoom) => PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? updater(data.room) : data.room,
		rooms: replaceRoomNode(data.rooms, roomId, updater),
	};
}

function removeRoomsFromBootstrap(data: BootstrapData, roomIds: ReadonlySet<string>): BootstrapData {
	const selectedDeleted = roomIds.has(data.selectedRoomId);
	return {
		...data,
		room: data.room && roomIds.has(data.room.id) ? undefined : data.room,
		selectedRoomId: selectedDeleted ? "" : data.selectedRoomId,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		rooms: removeRoomNodes(data.rooms, roomIds),
	};
}

function replaceRoomNode(nodes: PiboRoom[], roomId: string, updater: (room: PiboRoom) => PiboRoom): PiboRoom[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id === roomId) {
			changed = true;
			return updater(node);
		}
		const originalChildren = node.children ?? [];
		const children = replaceRoomNode(originalChildren, roomId, updater);
		if (children === originalChildren) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

function removeRoomNodes(nodes: PiboRoom[], roomIds: ReadonlySet<string>): PiboRoom[] {
	let changed = false;
	const next: PiboRoom[] = [];
	for (const node of nodes) {
		if (roomIds.has(node.id)) {
			changed = true;
			continue;
		}
		const originalChildren = node.children ?? [];
		const children = removeRoomNodes(originalChildren, roomIds);
		if (children !== originalChildren) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

function createOptimisticRoom(id: string, userId: string, name: string): PiboRoom {
	const now = new Date().toISOString();
	return {
		id,
		ownerScope: `user:${userId}`,
		name,
		type: "chat",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		children: [],
	};
}

function roomWithArchivedState(room: PiboRoom, archived: boolean): PiboRoom {
	const metadata = { ...room.metadata };
	if (archived) metadata.chatRoomArchivedAt = new Date().toISOString();
	else delete metadata.chatRoomArchivedAt;
	return { ...room, metadata, updatedAt: new Date().toISOString() };
}

function roomSubtreeIds(room: PiboRoom): Set<string> {
	const ids = new Set<string>([room.id]);
	for (const child of room.children ?? []) {
		for (const id of roomSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

function replaceSessionNode(
	nodes: PiboWebSessionNode[],
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): PiboWebSessionNode[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.piboSessionId === piboSessionId) {
			changed = true;
			return updater(node);
		}
		const children = replaceSessionNode(node.children, piboSessionId, updater);
		if (children === node.children) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

function createOptimisticSessionNode(piboSessionId: string, profile: string): PiboWebSessionNode {
	return {
		piboSessionId,
		piSessionId: "pending",
		profile,
		title: "New Session",
		status: "idle",
		lastActivityAt: new Date().toISOString(),
		derivedSessions: [],
		children: [],
	};
}

function sessionNodeFromSession(session: PiboSession): PiboWebSessionNode {
	return {
		piboSessionId: session.id,
		piSessionId: session.piSessionId,
		profile: session.profile,
		activeModel: session.activeModel,
		title: session.title || "Untitled Session",
		archived: typeof session.metadata?.chatWebArchivedAt === "string",
		status: "idle",
		lastActivityAt: session.updatedAt,
		derivedSessions: [],
		children: [],
	};
}

function piboSessionFromSessionNode(node: PiboWebSessionNode, base: PiboSession): PiboSession {
	return {
		...base,
		id: node.piboSessionId,
		piSessionId: node.piSessionId,
		profile: node.profile,
		activeModel: node.activeModel,
		title: sessionNodeTitle(node),
		updatedAt: node.lastActivityAt ?? base.updatedAt,
	};
}

function reconcileOptimisticUserMessages(view: PiboSessionTraceView): PiboSessionTraceView {
	const persistedByText = new Map<string, number>();
	collectPersistedUserMessageText(view.nodes, persistedByText);
	if (!persistedByText.size) return view;
	const { nodes, changed } = dropReplacedOptimisticUserMessages(view.nodes, persistedByText);
	return changed ? { ...view, nodes } : view;
}

function collectPersistedUserMessageText(nodes: readonly PiboTraceNode[], byText: Map<string, number>): void {
	for (const node of nodes) {
		if (node.type === "user.message" && !isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			if (text) byText.set(text, (byText.get(text) ?? 0) + 1);
		}
		collectPersistedUserMessageText(node.children, byText);
	}
}

function dropReplacedOptimisticUserMessages(
	nodes: readonly PiboTraceNode[],
	persistedByText: Map<string, number>,
): { nodes: PiboTraceNode[]; changed: boolean } {
	let changed = false;
	const next: PiboTraceNode[] = [];
	for (const node of nodes) {
		if (isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			const persistedCount = text ? persistedByText.get(text) ?? 0 : 0;
			if (persistedCount > 0) {
				persistedByText.set(text, persistedCount - 1);
				changed = true;
				continue;
			}
		}
		const childResult = dropReplacedOptimisticUserMessages(node.children, persistedByText);
		changed = changed || childResult.changed;
		next.push(childResult.changed ? { ...node, children: childResult.nodes } : node);
	}
	return { nodes: changed ? next : nodes as PiboTraceNode[], changed };
}

function isOptimisticUserMessageNode(node: PiboTraceNode): boolean {
	if (node.type !== "user.message") return false;
	return [node.id, node.stableKey, node.eventId]
		.filter((value): value is string => typeof value === "string")
		.some((value) => value.startsWith("optimistic:user-message:") || value.includes(":optimistic:user-message:"));
}

function trimLiveOverlayForBaseTrace(overlay: LiveTraceOverlay | null, baseTrace: PiboSessionTraceView): LiveTraceOverlay | null {
	if (!overlay || overlay.piboSessionId !== baseTrace.piboSessionId) return overlay;
	const latestStreamId = baseTrace.latestStreamId;
	const events = latestStreamId === undefined
		? overlay.events
		: overlay.events.filter((event) => event.streamId === undefined || event.streamId > latestStreamId);
	return events.length ? { ...overlay, events } : null;
}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
}

function workflowDiagnosticsFromError(caught: unknown): WorkflowUiDiagnostic[] {
	if (!caught || typeof caught !== "object" || !("data" in caught)) return [];
	const data = (caught as { data?: unknown }).data;
	if (!data || typeof data !== "object" || !("diagnostics" in data)) return [];
	const diagnostics = (data as { diagnostics?: unknown }).diagnostics;
	if (!Array.isArray(diagnostics)) return [];
	return diagnostics.filter((diagnostic): diagnostic is WorkflowUiDiagnostic => Boolean(diagnostic) && typeof diagnostic === "object");
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

function SessionNode({
	node,
	signalNow,
	selectedPiboSessionId,
	selectedSessionPathIds,
	onSelect,
	onRename,
	onArchive,
	onDelete,
	onViewContext,
	depth = 0,
	loadingPiboSessionId,
	autoRename = false,
	onAutoRenameConsumed,
	showWorkflowSessionKindMarkers = false,
}: {
	node: PiboWebSessionNode;
	signalNow: number;
	selectedPiboSessionId: string | null;
	selectedSessionPathIds: ReadonlySet<string>;
	onSelect: (piboSessionId: string) => void;
	onRename: (piboSessionId: string, title: string | null) => void;
	onArchive: (piboSessionId: string, archived: boolean) => void;
	onDelete: (node: PiboWebSessionNode) => void;
	onViewContext: (piboSessionId: string) => void;
	depth?: number;
	loadingPiboSessionId?: string | null;
	autoRename?: boolean;
	onAutoRenameConsumed?: () => void;
	showWorkflowSessionKindMarkers?: boolean;
}) {
	const safeTitle = sessionNodeTitle(node);
	const sessionTooltip = sessionNodeTooltip(node);
	const [editing, setEditing] = useState(false);
	const [draftTitle, setDraftTitle] = useState(safeTitle);
	const titleInputRef = useRef<HTMLInputElement>(null);
	const hasChildren = node.children.length > 0;
	const hasSelectedDescendant = selectedPiboSessionId !== null && node.piboSessionId !== selectedPiboSessionId && selectedSessionPathIds.has(node.piboSessionId);
	const [expanded, setExpanded] = useState(hasSelectedDescendant);
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!menuOpen) return;
		const handle = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", handle);
		return () => document.removeEventListener("mousedown", handle);
	}, [menuOpen]);

	useEffect(() => {
		if (!editing) setDraftTitle(safeTitle);
	}, [editing, safeTitle]);

	useEffect(() => {
		if (!autoRename) return;
		setDraftTitle(safeTitle === "Untitled Session" ? "" : safeTitle);
		setEditing(true);
		onAutoRenameConsumed?.();
	}, [autoRename, safeTitle, onAutoRenameConsumed]);

	useLayoutEffect(() => {
		if (!editing) return;
		titleInputRef.current?.focus();
		titleInputRef.current?.select();
	}, [editing]);

	useEffect(() => {
		if (hasSelectedDescendant) setExpanded(true);
	}, [hasSelectedDescendant]);

	const submitRename = () => {
		const title = draftTitle.trim();
		onRename(node.piboSessionId, title ? title : null);
		setEditing(false);
	};
	const signal = sessionNodeSignal(node, signalNow);
	const loading = loadingPiboSessionId === node.piboSessionId;
	const workflowKind = showWorkflowSessionKindMarkers ? workflowSessionKindPresentation(node.workflowSessionKind) : null;
	const WorkflowKindIcon = workflowKind?.Icon;

	return (
		<div>
			<div
				data-pibo-component="SessionNode"
				data-pibo-debug="session-row"
				data-pibo-session-id={node.piboSessionId}
				data-pibo-title={safeTitle}
				data-pibo-selected={node.piboSessionId === selectedPiboSessionId ? "true" : "false"}
				data-pibo-state={loading ? "loading" : node.status ?? "idle"}
				data-pibo-archived={node.archived ? "true" : "false"}
				data-pibo-unread-count={node.unreadCount ?? 0}
				className={`group w-full grid grid-cols-[1fr_auto] gap-1 items-center mb-1 border rounded-sm ${
					node.piboSessionId === selectedPiboSessionId ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-transparent"
				}`}
				style={{ paddingLeft: 8 + depth * 14 }}
				title={sessionTooltip}
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
							ref={titleInputRef}
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setEditing(false);
									setDraftTitle(safeTitle);
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
								setDraftTitle(safeTitle);
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
							aria-label={workflowKind ? `${workflowKind.ariaLabel}: ${safeTitle}` : `Open session ${safeTitle}`}
							className="min-w-0 text-left px-1 py-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center"
						>
							<span className="min-w-0">
								<span className="flex min-w-0 items-center gap-1.5">
									{workflowKind && WorkflowKindIcon ? (
										<span className={`h-4 w-4 shrink-0 inline-flex items-center justify-center rounded-sm border ${workflowKind.className}`} title={workflowKind.ariaLabel} aria-label={workflowKind.ariaLabel}>
											<WorkflowKindIcon size={11} aria-hidden="true" />
										</span>
									) : null}
									<span className={`block min-w-0 truncate text-sm ${node.archived ? "text-slate-500" : "text-slate-200"}`}>{safeTitle}</span>
								</span>
								<span className="mt-0.5 flex min-w-0 items-center gap-1.5">
									{workflowKind ? <span className={`shrink-0 rounded-sm border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${workflowKind.className}`} title={workflowKind.ariaLabel}>{workflowKind.label}</span> : null}
									<span className="min-w-0 truncate font-mono text-[10px] text-slate-500">{node.piboSessionId}</span>
								</span>
							</span>
						</button>
						<span className="grid grid-rows-[16px_16px] place-items-center gap-0.5">
							{loading ? (
								<Loader2 size={13} className="text-[#11a4d4] animate-spin" aria-label="Loading session" />
							) : (
								<span className={signal.className} title={signal.title} aria-label={signal.title} />
							)}
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
					<div className="flex items-center gap-1 pr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity max-[980px]:opacity-100">
						<div className="relative" ref={menuRef}>
							<button
								type="button"
								onClick={() => setMenuOpen((v) => !v)}
								title="Session actions"
								aria-label="Session actions"
								className="h-7 w-7 max-[980px]:h-9 max-[980px]:w-9 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"
							>
								<MoreVertical size={24} className="w-3.5 h-3.5 max-[980px]:w-5 max-[980px]:h-5" />
							</button>
							{menuOpen && (
								<div className="absolute right-0 top-full z-50 mt-1 w-48 bg-[#1a262b] border border-slate-700 rounded-sm shadow-lg py-1">
									{node.archived ? (
										<>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onArchive(node.piboSessionId, false); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<ArchiveRestore size={16} /> Restore Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onViewContext(node.piboSessionId); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Bug size={16} /> View Context
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onDelete(node); }}
												className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-500/10 flex items-center gap-2"
											>
												<Trash2 size={16} /> Delete Session
											</button>
										</>
									) : (
										<>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); setEditing(true); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Edit3 size={16} /> Rename Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onArchive(node.piboSessionId, true); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Archive size={16} /> Archive Session
											</button>
											<button
												type="button"
												onClick={() => { setMenuOpen(false); onViewContext(node.piboSessionId); }}
												className="w-full text-left px-3 py-2.5 text-sm text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] flex items-center gap-2"
											>
												<Bug size={16} /> View Context
											</button>
										</>
									)}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
			{expanded ? node.children.map((child) => (
				<SessionNode
					key={child.piboSessionId}
					node={child}
					signalNow={signalNow}
					selectedPiboSessionId={selectedPiboSessionId}
					selectedSessionPathIds={selectedSessionPathIds}
					onSelect={onSelect}
					onRename={onRename}
					onArchive={onArchive}
					onDelete={onDelete}
					onViewContext={onViewContext}
					depth={depth + 1}
					loadingPiboSessionId={loadingPiboSessionId}
					showWorkflowSessionKindMarkers={showWorkflowSessionKindMarkers}
				/>
			)) : null}
		</div>
	);
}

function roomNodeTooltip(room: Pick<PiboRoom, "id" | "name">): string {
	return `${room.name || "Untitled Room"}\n${room.id}`;
}

function sessionNodeTooltip(node: PiboWebSessionNode): string {
	return `${sessionNodeTitle(node)}\n${node.piboSessionId}`;
}

function sessionNodeTitle(node: PiboWebSessionNode): string {
	return typeof node.title === "string" && node.title ? node.title : "Untitled Session";
}

function workflowSessionKindPresentation(kind: PiboWebSessionNode["workflowSessionKind"]): { label: string; ariaLabel: string; className: string; Icon: typeof Layers } | null {
	switch (kind) {
		case "main_workflow":
			return { label: "main workflow", ariaLabel: "Main workflow session", className: "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]", Icon: Layers };
		case "nested_workflow":
			return { label: "nested workflow", ariaLabel: "Nested workflow session", className: "border-violet-400/40 bg-violet-500/10 text-violet-300", Icon: Copy };
		case "agent_node":
			return { label: "agent node", ariaLabel: "Workflow agent node session", className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300", Icon: UserRound };
		case "subagent":
			return { label: "subagent", ariaLabel: "Subagent session", className: "border-amber-400/40 bg-amber-500/10 text-amber-300", Icon: User };
		default:
			return null;
	}
}

function sessionNodeSignal(node: PiboWebSessionNode, now: number): { className: string; title: string } {
	const base = "session-signal h-2 w-2 rounded-full";
	if (node.status === "error" && (node.unreadCount ?? 0) > 0) {
		return { className: `${base} session-signal-error`, title: "Run failed" };
	}
	if (node.status === "running") {
		return { className: `${base} session-signal-running`, title: "Runtime is working" };
	}
	if (node.status !== "error" && ((node.unreadCount ?? 0) > 0 || sessionWasRecentlyActive(node, now))) {
		return { className: `${base} session-signal-unread`, title: "New completed assistant message" };
	}
	return { className: `${base} session-signal-idle`, title: "Idle" };
}

function sessionWasRecentlyActive(node: PiboWebSessionNode, now: number): boolean {
	if (!node.lastActivityAt) return false;
	const timestamp = Date.parse(node.lastActivityAt);
	return Number.isFinite(timestamp) && now - timestamp < RECENT_SESSION_ACTIVITY_SIGNAL_MS;
}

function nextRecentSessionSignalExpiryMs(nodes: readonly PiboWebSessionNode[], now: number): number | undefined {
	let nextMs: number | undefined;
	const visit = (node: PiboWebSessionNode) => {
		if (node.status !== "running" && node.status !== "error" && (node.unreadCount ?? 0) === 0 && node.lastActivityAt) {
			const timestamp = Date.parse(node.lastActivityAt);
			if (Number.isFinite(timestamp)) {
				const remainingMs = RECENT_SESSION_ACTIVITY_SIGNAL_MS - (now - timestamp);
				if (remainingMs > 0) nextMs = nextMs === undefined ? remainingMs : Math.min(nextMs, remainingMs);
			}
		}
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return nextMs === undefined ? undefined : nextMs + 50;
}

function sessionTreeHasSession(nodes: PiboWebSessionNode[], piboSessionId: string): boolean {
	return nodes.some((node) => node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId));
}

function createOriginSessionLink(nodes: PiboWebSessionNode[], piboSessionId: string): SessionOriginLink | undefined {
	const selected = findSessionNode(nodes, piboSessionId);
	if (!selected?.originId) return undefined;
	const origin = findSessionNode(nodes, selected.originId);
	return {
		piboSessionId: selected.originId,
		label: origin ? sessionBreadcrumbLabel(origin, 0) : selected.originId,
	};
}

function createDerivedSessionLinks(nodes: PiboWebSessionNode[], piboSessionId: string): SessionDerivationLink[] {
	const selected = findSessionNode(nodes, piboSessionId);
	return selected?.derivedSessions.map((session) => ({
		piboSessionId: session.piboSessionId,
		label: sessionLabel(session),
		profile: session.profile,
		status: session.status,
	})) ?? [];
}

function createSessionBreadcrumbs(nodes: PiboWebSessionNode[], piboSessionId: string): SessionBreadcrumbItem[] {
	const path = findSessionPath(nodes, piboSessionId);
	return path.map((node, index) => ({
		piboSessionId: node.piboSessionId,
		label: sessionBreadcrumbLabel(node, index),
	}));
}

function defaultProfileFromBootstrap(bootstrap: BootstrapData): string {
	return bootstrap.session?.profile ?? bootstrap.agents[0]?.name ?? bootstrap.customAgents[0]?.profileName ?? "";
}

function identityFromBootstrap(bootstrap: BootstrapData | null | undefined): BootstrapData["identity"] {
	return bootstrap?.identity ?? { userId: "user" };
}

function resolveSessionActiveModelLabel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): string | undefined {
	const model = resolveSessionActiveModel(bootstrap, session);
	return model ? formatModelProfile(model) : undefined;
}

function resolveSessionActiveModel(
	bootstrap: BootstrapData,
	session: Pick<PiboWebSessionNode, "profile" | "parentId" | "activeModel">,
): ModelProfile | undefined {
	if (session.activeModel) return session.activeModel;
	const staticAgent = bootstrap.agents.find((agent) => agent.name === session.profile);
	if (staticAgent?.model) return staticAgent.model;

	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === session.profile);
	const profileModel = staticAgent ?? customAgent;
	if (session.parentId) return profileModel?.subagentModel ?? bootstrap.modelDefaults?.subagent;
	return profileModel?.mainModel ?? bootstrap.modelDefaults?.main;
}

function resolveSessionThinkingLevel(bootstrap: BootstrapData, profileName: string, isSubagent = false): ThinkingLevel | undefined {
	const staticAgent = bootstrap.agents.find((agent) => agent.name === profileName);
	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = staticAgent ?? customAgent;
	if (isSubagent) return profile?.subagentThinkingLevel ?? profile?.thinkingLevel ?? bootstrap.modelDefaults?.subagentThinking ?? bootstrap.modelDefaults?.thinking;
	return profile?.mainThinkingLevel ?? profile?.thinkingLevel ?? bootstrap.modelDefaults?.mainThinking ?? bootstrap.modelDefaults?.thinking;
}

function resolveSessionFastMode(bootstrap: BootstrapData, profileName: string, isSubagent = false): boolean | undefined {
	const staticAgent = bootstrap.agents.find((agent) => agent.name === profileName);
	const customAgent = bootstrap.customAgents.find((agent) => agent.profileName === profileName);
	const profile = staticAgent ?? customAgent;
	if (isSubagent) return profile?.subagentFast ?? profile?.fast ?? bootstrap.modelDefaults?.subagentFast ?? bootstrap.modelDefaults?.fast;
	return profile?.mainFast ?? profile?.fast ?? bootstrap.modelDefaults?.mainFast ?? bootstrap.modelDefaults?.fast;
}

function formatSessionModelBadge(modelLabel: string | undefined, thinkingLevel: ThinkingLevel | undefined, fast: boolean): string | undefined {
	if (!modelLabel) return undefined;
	return [modelLabel, thinkingLevel, fast ? "fast" : undefined].filter(Boolean).join(" ");
}

function resolveTraceThinkingState(traceView: PiboSessionTraceView | null): { level?: ThinkingLevel; fast?: boolean } {
	let state: { level?: ThinkingLevel; fast?: boolean } = {};
	if (!traceView) return state;
	for (const node of flattenTraceNodes(traceView.nodes)) {
		if (node.type !== "execution.command" || (node.title !== "thinking" && node.title !== "fast_mode")) continue;
		const output = node.output && typeof node.output === "object" ? node.output as Record<string, unknown> : undefined;
		const level = typeof output?.level === "string" && isThinkingLevel(output.level) ? output.level : undefined;
		state = {
			level: level ?? state.level,
			fast: node.title === "fast_mode" ? output?.mode === "fast" : state.fast,
		};
	}
	return state;
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children)]);
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return THINKING_LEVELS.includes(value as ThinkingLevel);
}

function copyTextToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.appendChild(textarea);
	textarea.select();
	try {
		document.execCommand("copy");
		return Promise.resolve();
	} finally {
		document.body.removeChild(textarea);
	}
}

function findSessionNode(nodes: PiboWebSessionNode[], piboSessionId: string): PiboWebSessionNode | undefined {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findSessionNode(node.children, piboSessionId);
		if (child) return child;
	}
	return undefined;
}

function findSessionPath(
	nodes: PiboWebSessionNode[],
	piboSessionId: string,
	path: PiboWebSessionNode[] = [],
): PiboWebSessionNode[] {
	for (const node of nodes) {
		const nextPath = [...path, node];
		if (node.piboSessionId === piboSessionId) return nextPath;
		const childPath = findSessionPath(node.children, piboSessionId, nextPath);
		if (childPath.length) return childPath;
	}
	return [];
}

function sessionBreadcrumbLabel(node: PiboWebSessionNode, index: number): string {
	if (!index) return node.profile || node.title;
	if (node.subagentName && node.subagentName !== node.profile) return `${node.subagentName} (${node.profile})`;
	return node.profile || node.subagentName || node.title;
}

function sessionLabel(session: Pick<PiboWebSessionNode, "title" | "profile" | "subagentName">): string {
	if (session.subagentName && session.subagentName !== session.profile) return `${session.subagentName} (${session.profile})`;
	return session.title || session.profile || session.subagentName || "Untitled Session";
}

function splitSessionNodesByArchive(nodes: PiboWebSessionNode[], includeArchived = true): {
	active: PiboWebSessionNode[];
	archived: PiboWebSessionNode[];
} {
	const active: PiboWebSessionNode[] = [];
	const archived: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (node.archived) {
			if (includeArchived) archived.push(node);
			continue;
		}
		const children = splitSessionNodesByArchive(node.children, includeArchived);
		active.push({ ...node, children: children.active });
		if (includeArchived) archived.push(...children.archived);
	}
	return { active, archived };
}

function limitSessionNodesForSidebar(
	nodes: PiboWebSessionNode[],
	limit: number,
	selectedPiboSessionId: string | null,
): PiboWebSessionNode[] {
	if (nodes.length <= limit) return nodes;
	const visible = nodes.slice(0, limit);
	if (!selectedPiboSessionId) return visible;
	const selectedTopLevel = nodes.find((node) => node.piboSessionId === selectedPiboSessionId || sessionTreeHasSession(node.children, selectedPiboSessionId));
	if (!selectedTopLevel || visible.some((node) => node.piboSessionId === selectedTopLevel.piboSessionId)) return visible;
	return [...visible, selectedTopLevel];
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

function countUnreadRooms(rooms: readonly PiboRoom[]): number {
	return rooms.reduce((sum, room) => sum + (room.unreadCount ?? 0), 0);
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

function formatRoomSummary(room: PiboRoom): string {
	if (room.topic && room.workspace) return `${room.topic} | ${room.workspace}`;
	if (room.topic) return room.topic;
	if (room.workspace) return room.workspace;
	return room.type;
}

function WebAnnotationsSessionPanel({
	piboSessionId,
	annotations,
	selectedIds,
	loading,
	error,
	collapsed,
	onRefresh,
	onToggle,
	onClear,
	onCollapse,
	onClose,
}: {
	piboSessionId: string | null;
	annotations: WebAnnotationMessageAttachment[];
	selectedIds: readonly string[];
	loading: boolean;
	error: string | null;
	collapsed: boolean;
	onRefresh: () => void;
	onToggle: (annotationId: string) => void;
	onClear: () => void;
	onCollapse: () => void;
	onClose: () => void;
}) {
	if (!piboSessionId) return null;
	return (
		<section className="border-t border-slate-800 bg-[#101d22] px-4 py-2" data-pibo-debug="web-annotations-session-panel" data-pibo-session-id={piboSessionId}>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Web annotations</div>
						<span className="rounded-sm border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">{annotations.length}</span>
						{selectedIds.length ? <span className="rounded-sm border border-[#11a4d4]/50 px-1.5 py-0.5 text-[10px] text-[#11a4d4]">{selectedIds.length} attached</span> : null}
					</div>
					{collapsed ? null : <div className="text-[11px] text-slate-500">Global annotation list. Selected attachments are remembered per session.</div>}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button type="button" onClick={onRefresh} disabled={loading} title="Refresh annotations" aria-label="Refresh annotations" className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50" data-pibo-debug="web-annotations-refresh">
						<RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
					</button>
					<button type="button" onClick={onClear} disabled={loading || !annotations.length} title="Clear visible annotations" aria-label="Clear visible annotations" className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50">
						<Trash2 size={12} />
					</button>
					<button type="button" onClick={onCollapse} title={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} aria-label={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						{collapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
					</button>
					<button type="button" onClick={onClose} title="Hide annotations panel" aria-label="Hide annotations panel" className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						<X size={12} />
					</button>
				</div>
			</div>
			{collapsed ? null : error ? (
				<div className="rounded-sm border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200" data-pibo-debug="web-annotations-error">{boundedUiText(error, 220)}</div>
			) : loading && !annotations.length ? (
				<div className="rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2 text-xs text-slate-400" data-pibo-debug="web-annotations-loading">Loading annotations…</div>
			) : !annotations.length ? (
				<div className="rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2 text-xs text-slate-500" data-pibo-debug="web-annotations-empty">No open annotations for this session.</div>
			) : (
				<div className="mt-2 grid max-h-56 grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2 overflow-y-auto pr-1" data-pibo-debug="web-annotations-list">
					{annotations.map((annotation) => {
						const selected = selectedIds.includes(annotation.id);
						return (
							<div key={annotation.id} data-pibo-debug="web-annotation-chip" data-web-annotation-id={annotation.id} data-web-annotation-session-id={annotation.piboSessionId} data-web-annotation-selected={selected ? "true" : "false"} className={`min-w-0 rounded-sm border px-3 py-2 text-xs ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#0e1116]"}`}>
								<div className="mb-1 flex items-center justify-between gap-2">
									<span className="min-w-0 truncate font-mono text-[11px] text-slate-500">{annotation.status} · {annotation.targetKind}</span>
									<button type="button" onClick={() => onToggle(annotation.id)} className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-[11px] ${selected ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}>
										{selected ? <X size={11} /> : <Plus size={11} />} {selected ? "Detach" : "Attach"}
									</button>
								</div>
								<div className="truncate text-slate-200" title={annotation.primaryTarget || annotation.label || annotation.selector || annotation.id}>{boundedUiText(annotation.primaryTarget || annotation.label || annotation.selector || annotation.id, 120)}</div>
								{annotation.piboContext ? <div className="truncate font-mono text-[11px] text-[#11a4d4]" title={annotation.piboContext}>{boundedUiText(annotation.piboContext, 140)}</div> : null}
								<div className="truncate font-mono text-[11px] text-slate-500" title={annotation.url}>{webAnnotationUrlLabel(annotation.url)}</div>
								<div className="mt-1 line-clamp-2 text-slate-400" title={annotation.note}>{boundedUiText(annotation.note, 180)}</div>
								<div className="mt-1 text-[11px] text-slate-600">{shortWorkflowTimestamp(annotation.createdAt)}</div>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}

function WebAnnotationsEntryPoints({
	piboSessionId,
	piboRoomId,
	disabled,
	panelVisible,
	onShowPanel,
	onHidePanel,
	onError,
}: {
	piboSessionId: string | null;
	piboRoomId?: string;
	disabled: boolean;
	panelVisible: boolean;
	onShowPanel: () => void;
	onHidePanel: () => void;
	onError: (message: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [cdpUrl, setCdpUrl] = useState(() => readStoredWebAnnotationsCdpUrl());
	const [targets, setTargets] = useState<WebAnnotationTargetSummary[]>([]);
	const [targetsState, setTargetsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<{ kind: "info" | "success" | "error"; message: string } | null>(null);

	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	useEffect(() => {
		writeStoredWebAnnotationsCdpUrl(cdpUrl);
	}, [cdpUrl]);

	const loadTargets = async () => {
		if (!piboSessionId) return;
		setTargetsState("loading");
		setStatus(null);
		try {
			const result = await listWebAnnotationTargets(cdpUrl);
			setTargets(result.targets.filter((target) => target.type === "page" || target.attachable));
			setTargetsState("loaded");
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "CDP unavailable");
			setTargets([]);
			setTargetsState("error");
			setStatus({ kind: "error", message });
			onError(message);
		}
	};

	const injectCreatedBinding = async (result: WebAnnotationBindingResponse) => {
		if (!piboSessionId) throw new Error("No active session context");
		return injectWebAnnotationBinding(result.binding.id, compactWebAnnotationRequest({ piboSessionId, piboRoomId, cdpUrl }));
	};

	const startCurrentPageAnnotation = async () => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		setBusy(true);
		setStatus({ kind: "info", message: "Injecting annotation overlay into this Pibo page…" });
		try {
			const binding = await createWebAnnotationBinding({
				piboSessionId,
				piboRoomId,
				url: window.location.href,
				title: document.title,
				sameOrigin: true,
			});
			if (!binding.overlay) throw new Error("Overlay config missing from same-origin binding response");
			await installSameOriginWebAnnotationOverlay(binding.overlay);
			setStatus({ kind: "success", message: "Annotation overlay is ready on this Pibo page. Use the overlay button to enable annotation mode." });
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "Current-page annotation failed");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	const startUrlAnnotation = async () => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		const targetUrl = url.trim();
		if (!targetUrl) {
			setStatus({ kind: "error", message: "URL is required" });
			return;
		}
		if (isLikelyWebAnnotationCdpUrl(targetUrl)) {
			const message = "That looks like a CDP endpoint. Put it in CDP URL, and put the page you want to annotate in Annotate URL.";
			setStatus({ kind: "error", message });
			onError(message);
			return;
		}
		setBusy(true);
		setStatus({ kind: "info", message: "Opening target and injecting overlay…" });
		try {
			const binding = await createWebAnnotationBinding(compactWebAnnotationRequest({ piboSessionId, piboRoomId, url: targetUrl, cdpUrl }));
			const injected = await injectCreatedBinding(binding);
			setStatus({ kind: "success", message: `Annotation overlay injected for ${webAnnotationTargetLabel(injected.target ?? binding.target, injected.binding.url)}` });
			setUrl("");
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, "Annotation failed");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	const attachTarget = async (target: WebAnnotationTargetSummary) => {
		if (!piboSessionId || busy) return;
		onShowPanel();
		setBusy(true);
		setStatus({ kind: "info", message: "Binding selected target and injecting overlay…" });
		try {
			const binding = await createWebAnnotationBinding(compactWebAnnotationRequest({ piboSessionId, piboRoomId, targetId: target.id, cdpUrl }));
			const injected = await injectCreatedBinding(binding);
			setStatus({ kind: "success", message: `Annotation overlay injected for ${webAnnotationTargetLabel(injected.target ?? target, injected.binding.url)}` });
			onError(null);
		} catch (caught) {
			const message = compactWebAnnotationError(caught, target.attachable ? "Target annotation failed" : "Target not attachable");
			setStatus({ kind: "error", message });
			onError(message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="relative" data-pibo-debug="web-annotations-entry" data-pibo-session-id={piboSessionId ?? undefined}>
			<HeaderIconButton
				onClick={() => {
					if (disabled) return;
					setOpen((current) => !current);
					if (!panelVisible) onShowPanel();
				}}
				title={disabled ? "Select an active session to annotate a web page" : panelVisible ? "Web Annotations" : "Show Web Annotations"}
				ariaLabel="Web Annotations"
				active={open || panelVisible}
			>
				<Bug size={14} />
			</HeaderIconButton>
			{open && !disabled ? (
				<div className="absolute right-0 top-full z-40 mt-2 w-[min(420px,calc(100vw-24px))] rounded-sm border border-slate-700 bg-[#0e1116] p-3 text-sm shadow-xl" role="dialog" aria-label="Web Annotations">
					<div className="mb-2 flex items-start justify-between gap-3">
						<div>
							<div className="text-xs font-bold uppercase tracking-wider text-[#11a4d4]">Web Annotations</div>
							<div className="mt-1 text-xs text-slate-500">Start an inactive overlay for this Pibo page, or bind a CDP target for external pages.</div>
						</div>
						<div className="flex items-center gap-1">
							<button type="button" onClick={panelVisible ? onHidePanel : onShowPanel} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label={panelVisible ? "Hide annotation list" : "Show annotation list"} title={panelVisible ? "Hide annotation list" : "Show annotation list"}>
								<Rows3 size={14} />
							</button>
							<button type="button" onClick={() => setOpen(false)} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Close Web Annotations panel">
								<X size={14} />
							</button>
						</div>
					</div>
					<button type="button" onClick={() => void startCurrentPageAnnotation()} disabled={busy} className="mb-3 h-9 w-full rounded-sm bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50" data-pibo-debug="web-annotations-current-page">
						Annotate this Pibo page
					</button>
					<label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="web-annotation-url">Annotate URL via CDP</label>
					<div className="grid grid-cols-[1fr_auto] gap-2">
						<input
							id="web-annotation-url"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							onKeyDown={(event) => { if (event.key === "Enter") void startUrlAnnotation(); }}
							placeholder="http://localhost:5173"
							disabled={busy}
							className="h-9 min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 text-xs text-slate-100 outline-none focus:border-[#11a4d4] disabled:opacity-60"
						/>
						<button type="button" onClick={() => void startUrlAnnotation()} disabled={busy || !url.trim()} className="h-9 rounded-sm bg-[#11a4d4] px-3 text-xs font-medium text-white disabled:opacity-50">
							Annotate
						</button>
					</div>
					<label className="mt-3 mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="web-annotation-cdp-url">CDP URL (optional)</label>
					<input
						id="web-annotation-cdp-url"
						value={cdpUrl}
						onChange={(event) => setCdpUrl(event.target.value)}
						placeholder="Use gateway default"
						disabled={busy}
						className="h-8 w-full rounded-sm border border-slate-800 bg-[#151f24] px-2 font-mono text-[11px] text-slate-300 outline-none focus:border-[#11a4d4] disabled:opacity-60"
					/>
					<div className="mt-3 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Existing targets</div>
						<button type="button" onClick={() => void loadTargets()} disabled={busy || targetsState === "loading"} className="inline-flex h-7 items-center gap-1 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<RefreshCw size={12} className={targetsState === "loading" ? "animate-spin" : undefined} /> Refresh
						</button>
					</div>
					<div className="mt-2 max-h-56 overflow-auto rounded-sm border border-slate-800">
						{targetsState === "idle" ? <div className="px-3 py-3 text-xs text-slate-500">Refresh to list reachable browser targets.</div> : null}
						{targetsState === "loading" ? <div className="px-3 py-3 text-xs text-slate-400">Loading targets…</div> : null}
						{targetsState === "loaded" && !targets.length ? <div className="px-3 py-3 text-xs text-slate-500">No attachable browser targets found.</div> : null}
						{targets.map((target) => (
							<div key={target.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-slate-800 px-3 py-2 last:border-b-0">
								<div className="min-w-0">
									<div className="truncate text-xs text-slate-200" title={target.title || target.url}>{boundedUiText(target.title || "Untitled target", 120)}</div>
									<div className="truncate font-mono text-[11px] text-slate-500" title={target.url}>{boundedUiText(target.url || target.id, 160)}</div>
								</div>
								<button type="button" onClick={() => void attachTarget(target)} disabled={busy || !target.attachable} title={target.attachable ? "Attach selected target" : "Target is not attachable"} className="h-8 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-40">
									Attach
								</button>
							</div>
						))}
					</div>
					{status ? (
						<div className={`mt-2 rounded-sm border px-2 py-2 text-xs ${status.kind === "error" ? "border-red-900 bg-red-950/40 text-red-200" : status.kind === "success" ? "border-emerald-900/60 bg-emerald-950/30 text-emerald-300" : "border-slate-700 bg-[#151f24] text-slate-300"}`}>
							{status.message}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function compactWebAnnotationRequest<T extends Record<string, string | undefined>>(input: T): T {
	return Object.fromEntries(Object.entries(input).filter(([, value]) => value && value.trim())) as T;
}

function isLikelyWebAnnotationCdpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.port === "56663" || parsed.pathname.startsWith("/json/");
	} catch {
		return false;
	}
}

function installSameOriginWebAnnotationOverlay(config: WebAnnotationOverlayConfig): Promise<void> {
	return new Promise((resolve, reject) => {
		const targetWindow = window as typeof window & {
			__piboWebAnnotationConfig?: WebAnnotationOverlayConfig;
			__piboWebAnnotations?: { remove?: () => void };
		};
		try {
			targetWindow.__piboWebAnnotations?.remove?.();
			targetWindow.__piboWebAnnotationConfig = config;
			const script = document.createElement("script");
			script.src = `/apps/web-annotations/overlay.js?ts=${Date.now()}`;
			script.async = true;
			script.onload = () => resolve();
			script.onerror = () => reject(new Error("Could not load Web Annotation overlay script"));
			document.head.appendChild(script);
		} catch (error) {
			reject(error);
		}
	});
}

function readStoredWebAnnotationsCdpUrl(): string {
	try {
		return localStorage.getItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

function writeStoredWebAnnotationsCdpUrl(value: string): void {
	try {
		if (value.trim()) localStorage.setItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY, value.trim());
		else localStorage.removeItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY);
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

function readStoredSelectedWebAnnotationIds(piboSessionId: string): string[] {
	try {
		const raw = localStorage.getItem(WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX + piboSessionId);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(0, 5) : [];
	} catch {
		return [];
	}
}

function writeStoredSelectedWebAnnotationIds(piboSessionId: string, ids: readonly string[]): void {
	try {
		const key = WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX + piboSessionId;
		const unique = [...new Set(ids.filter((id) => id.trim()))].slice(0, 5);
		if (unique.length) localStorage.setItem(key, JSON.stringify(unique));
		else localStorage.removeItem(key);
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

function readStoredWebAnnotationsPanelCollapsed(): boolean {
	try {
		return localStorage.getItem(WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

function writeStoredWebAnnotationsPanelCollapsed(value: boolean): void {
	try {
		localStorage.setItem(WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY, String(value));
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

function compactWebAnnotationError(caught: unknown, fallback: string): string {
	const message = errorMessage(caught);
	if (!message || message === "undefined") return fallback;
	if (/target.*not found|selected cdp target/i.test(message)) return `Target not found: ${message}`;
	if (/inject|overlay|evaluation/i.test(message)) return `Injection failed: ${message}`;
	if (/cdp endpoint.*is unreachable|failed to fetch|fetch failed|chrome target discovery|cdp unavailable|econnrefused|connect/i.test(message)) {
		return `CDP unavailable: ${message}`;
	}
	return `${fallback}: ${message}`;
}

function webAnnotationTargetLabel(target: WebAnnotationTargetSummary | undefined, fallbackUrl?: string): string {
	const value = target?.url || fallbackUrl || target?.title || "target";
	return webAnnotationUrlLabel(target?.title || value);
}

function webAnnotationUrlLabel(value: string): string {
	try {
		const parsed = new URL(value);
		return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	} catch {
		return boundedUiText(value, 80);
	}
}

function boundedUiText(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function Composer({
	sessionId,
	disabled = false,
	commands,
	skills,
	value,
	focusSignal,
	selectedWebAnnotations,
	selectedUploadAttachments,
	onValueChange,
	onCommand,
	onDetachWebAnnotation,
	onClearWebAnnotations,
	onAttachUploadedFiles,
	onDetachUploadAttachment,
	onClearUploadAttachments,
	onSend,
}: {
	sessionId: string | null;
	disabled?: boolean;
	commands: SlashCommand[];
	skills: Array<{ name: string; description?: string; path?: string }>;
	value: string;
	focusSignal: number;
	selectedWebAnnotations: WebAnnotationMessageAttachment[];
	selectedUploadAttachments: UploadedChatAttachment[];
	onValueChange: (value: string) => void;
	onCommand: (text: string) => Promise<boolean>;
	onDetachWebAnnotation: (annotationId: string) => void;
	onClearWebAnnotations: () => void;
	onAttachUploadedFiles: (files: readonly ChatUploadedFile[]) => void;
	onDetachUploadAttachment: (attachmentId: string) => void;
	onClearUploadAttachments: () => void;
	onSend: (text: string) => Promise<void>;
}) {
	const composerRootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const clipboardUploadButtonRef = useRef<HTMLButtonElement>(null);
	const activeCommandRef = useRef<HTMLButtonElement>(null);
	const activeSkillRef = useRef<HTMLButtonElement>(null);
	const historyNavRef = useRef<{ entries: string[]; index: number; draft: string } | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [activeSkillIndex, setActiveSkillIndex] = useState(0);
	const [cursorPos, setCursorPos] = useState(0);
	const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [uploadStatus, setUploadStatus] = useState<{ message: string; copyText?: string; error: boolean } | null>(null);
	const [pendingClipboardImage, setPendingClipboardImage] = useState<ClipboardImageUpload | null>(null);

	const skillTrigger = useMemo(() => {
		for (let i = cursorPos - 1; i >= 0; i--) {
			const char = value[i];
			if (char === " " || char === "\n" || char === "\t") break;
			if (char === "$") {
				if (i > 0 && value[i - 1] === "\\") continue;
				const query = value.slice(i + 1, cursorPos).toLowerCase();
				return { query, startPos: i, endPos: cursorPos };
			}
		}
		return null;
	}, [value, cursorPos]);

	const commandTrigger = value.trim().startsWith("/") ? value.trim().split(/\s+/)[0] : null;
	const skillSuggestionKey = skillTrigger ? composerSkillSuggestionKey(skillTrigger.startPos, value.slice(skillTrigger.startPos, cursorPos)) : null;
	const commandSuggestionKey = commandTrigger ? composerCommandSuggestionKey(commandTrigger) : null;

	const rawFilteredSkills = useMemo(() => {
		if (!skillTrigger) return [];
		return skills.filter((skill) => skill.name.toLowerCase().startsWith(skillTrigger.query));
	}, [skillTrigger, skills]);

	const rawFiltered = useMemo(() => {
		if (!commandTrigger) return [];
		return commands.filter((command) => command.slash.startsWith(commandTrigger));
	}, [commandTrigger, commands]);

	const filteredSkills = skillSuggestionKey && dismissedSuggestionKeys.includes(skillSuggestionKey) ? [] : rawFilteredSkills;
	const filtered = commandSuggestionKey && dismissedSuggestionKeys.includes(commandSuggestionKey) ? [] : rawFiltered;

	const dismissSuggestionKey = useCallback((key: string | null) => {
		if (!key) return;
		setDismissedSuggestionKeys((current) => current.includes(key) ? current : [...current, key]);
	}, []);

	const dismissVisibleSuggestions = useCallback(() => {
		const keys = [
			rawFilteredSkills.length ? skillSuggestionKey : null,
			rawFiltered.length ? commandSuggestionKey : null,
		].filter((key): key is string => Boolean(key));
		if (!keys.length) return;
		setDismissedSuggestionKeys((current) => {
			const next = new Set(current);
			for (const key of keys) next.add(key);
			return next.size === current.length ? current : [...next];
		});
	}, [commandSuggestionKey, rawFiltered.length, rawFilteredSkills.length, skillSuggestionKey]);

	useEffect(() => {
		const currentKeys = [skillSuggestionKey, commandSuggestionKey].filter((key): key is string => Boolean(key));
		setDismissedSuggestionKeys((current) => current.filter((key) => currentKeys.includes(key)));
	}, [commandSuggestionKey, skillSuggestionKey]);

	useEffect(() => {
		if (!filtered.length || activeIndex < filtered.length) return;
		setActiveIndex(0);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		if (!filteredSkills.length || activeSkillIndex < filteredSkills.length) return;
		setActiveSkillIndex(0);
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => activeCommandRef.current?.scrollIntoView({ block: "nearest" }));
		return () => cancelAnimationFrame(frame);
	}, [activeIndex, filtered.length]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => activeSkillRef.current?.scrollIntoView({ block: "nearest" }));
		return () => cancelAnimationFrame(frame);
	}, [activeSkillIndex, filteredSkills.length]);

	useEffect(() => {
		historyNavRef.current = null;
	}, [sessionId]);

	useEffect(() => {
		if (!pendingClipboardImage) return;
		const frame = requestAnimationFrame(() => clipboardUploadButtonRef.current?.focus());
		return () => {
			cancelAnimationFrame(frame);
			URL.revokeObjectURL(pendingClipboardImage.previewUrl);
		};
	}, [pendingClipboardImage]);

	useEffect(() => {
		if (focusSignal <= 0) return;
		const input = inputRef.current;
		if (!input) return;
		const cursorPosition = input.value.length;
		input.focus();
		input.setSelectionRange(cursorPosition, cursorPosition);
		setCursorPos(cursorPosition);
	}, [focusSignal]);

	useEffect(() => {
		if (!filtered.length && !filteredSkills.length) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (composerRootRef.current?.contains(target)) return;
			dismissVisibleSuggestions();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [dismissVisibleSuggestions, filtered.length, filteredSkills.length]);

	useLayoutEffect(() => {
		resizeComposerInput(inputRef.current);
	}, [value]);

	const insertSkill = (skillName: string) => {
		if (!skillTrigger || !inputRef.current) return;
		const before = value.slice(0, skillTrigger.startPos);
		const after = value.slice(skillTrigger.endPos);
		const newValue = before + "$" + skillName + after;
		onValueChange(newValue);
		dismissSuggestionKey(composerSkillSuggestionKey(skillTrigger.startPos, `$${skillName}`));
		const newCursorPos = skillTrigger.startPos + 1 + skillName.length;
		setCursorPos(newCursorPos);
		requestAnimationFrame(() => {
			inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
			setCursorPos(newCursorPos);
		});
	};

	const setHistoryValue = (text: string) => {
		onValueChange(text);
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			const cursorPosition = input.value.length;
			input.setSelectionRange(cursorPosition, cursorPosition);
			setCursorPos(cursorPosition);
		});
	};

	const navigateHistory = (direction: "previous" | "next") => {
		const existing = historyNavRef.current;
		if (!existing) {
			if (direction === "next" || value !== "") return false;
			const entries = readStoredComposerHistory();
			if (!entries.length) return false;
			const index = direction === "previous" ? entries.length - 1 : 0;
			historyNavRef.current = { entries, index, draft: value };
			setHistoryValue(entries[index]);
			return true;
		}

		if (direction === "previous") {
			const index = Math.max(0, existing.index - 1);
			historyNavRef.current = { ...existing, index };
			setHistoryValue(existing.entries[index]);
			return true;
		}

		const index = existing.index + 1;
		if (index >= existing.entries.length) {
			historyNavRef.current = null;
			setHistoryValue(existing.draft);
			return true;
		}
		historyNavRef.current = { ...existing, index };
		setHistoryValue(existing.entries[index]);
		return true;
	};

	const openUploadDialog = () => {
		if (disabled || uploading) return;
		fileInputRef.current?.click();
	};

	const closeClipboardImageDialog = () => {
		setPendingClipboardImage(null);
	};

	const handleClipboardImagePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		if (disabled || uploading) return;
		const imageFiles = clipboardImageFiles(event.clipboardData);
		if (!imageFiles.length) return;

		event.preventDefault();
		dismissVisibleSuggestions();
		setUploadStatus(null);
		const file = imageFiles[0];
		setPendingClipboardImage((current) => {
			if (current) URL.revokeObjectURL(current.previewUrl);
			return {
				file,
				previewUrl: URL.createObjectURL(file),
			};
		});
	};

	const confirmClipboardImageUpload = async () => {
		if (!pendingClipboardImage || uploading) return;
		const file = pendingClipboardImage.file;
		setPendingClipboardImage(null);
		await handleFileSelection([file]);
	};

	const handleFileSelection = async (selectedFiles: readonly File[]) => {
		if (!selectedFiles.length) return;
		setUploading(true);
		setUploadStatus({ message: `Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}...`, error: false });
		try {
			const result = await uploadChatFiles(selectedFiles);
			onAttachUploadedFiles(result.files);
			setUploadStatus(null);
		} catch (caught) {
			setUploadStatus({ message: caught instanceof Error ? caught.message : String(caught), error: true });
		} finally {
			setUploading(false);
		}
	};

	const submit = async () => {
		if (disabled) return;
		const text = value.trim();
		if (!text) return;
		if (filteredSkills.length) {
			insertSkill(filteredSkills[Math.min(activeSkillIndex, filteredSkills.length - 1)].name);
			return;
		}
		if (filtered.length && !commands.some((command) => command.slash === text.split(/\s+/)[0])) {
			const selectedSlash = filtered[Math.min(activeIndex, filtered.length - 1)].slash;
			onValueChange(selectedSlash);
			dismissSuggestionKey(composerCommandSuggestionKey(selectedSlash));
			return;
		}
		historyNavRef.current = null;
		appendStoredComposerHistory(text);
		onValueChange("");
		if (text.split(/\s+/)[0] === "/upload") {
			openUploadDialog();
			return;
		}
		if (text.startsWith("/") && (await onCommand(text))) return;
		await onSend(text);
	};

	return (
		<div
			ref={composerRootRef}
			data-pibo-debug="composer"
			data-pibo-session-id={sessionId ?? undefined}
			data-pibo-state={disabled ? "disabled" : value ? "non-empty" : "empty"}
			className="relative p-3 bg-[#151f24] border-t border-slate-800 max-[980px]:p-2"
		>
			<input
				ref={fileInputRef}
				type="file"
				multiple
				className="hidden"
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					event.target.value = "";
					void handleFileSelection(files);
				}}
			/>
			{uploadStatus ? (
				<div className={`mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs ${uploadStatus.error ? "border-red-900 bg-red-950/40 text-red-200" : uploadStatus.copyText ? "border-green-900/60 bg-green-950/30 text-green-300" : "border-slate-700 bg-[#0e1116] text-slate-300"}`}>
					<span className="min-w-0 flex-1 truncate">{uploadStatus.message}</span>
					{uploadStatus.copyText ? (
						<button
							type="button"
							onClick={() => void copyTextToClipboard(uploadStatus.copyText!)}
							title="Copy uploaded file path"
							aria-label="Copy uploaded file path"
							className="shrink-0 rounded-sm p-0.5 text-slate-400 hover:bg-slate-800 hover:text-[#11a4d4]"
						>
							<Copy size={13} />
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setUploadStatus(null)}
						title="Hide upload status"
						aria-label="Hide upload status"
						className="shrink-0 rounded-sm p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
					>
						<X size={13} />
					</button>
				</div>
			) : null}
			{pendingClipboardImage ? (
				<div
					className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
					role="dialog"
					aria-modal="true"
					aria-label="Upload pasted image"
					onKeyDown={(event) => {
						if (event.key === "Escape") closeClipboardImageDialog();
					}}
				>
					<div className="w-full max-w-md rounded-sm border border-slate-700 bg-[#151f24] shadow-2xl">
						<div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
							<div>
								<div className="text-sm font-semibold text-slate-100">Pasted image detected</div>
								<div className="mt-1 text-xs text-slate-400">Upload this clipboard image to ~/.pibo/uploads?</div>
							</div>
							<button type="button" onClick={closeClipboardImageDialog} className="rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200" aria-label="Cancel pasted image upload">
								<X size={14} />
							</button>
						</div>
						<div className="space-y-3 px-4 py-4">
							<img src={pendingClipboardImage.previewUrl} alt="Pasted clipboard image preview" className="max-h-64 w-full rounded-sm border border-slate-800 bg-[#0e1116] object-contain" />
							<div className="flex items-center justify-between gap-3 text-xs text-slate-400">
								<span className="min-w-0 truncate font-mono">{pendingClipboardImage.file.name}</span>
								<span className="shrink-0 font-mono">{formatBytes(pendingClipboardImage.file.size)}</span>
							</div>
						</div>
						<div className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">
							<button type="button" onClick={closeClipboardImageDialog} className="h-8 rounded-sm border border-slate-700 px-3 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100">Cancel</button>
							<button ref={clipboardUploadButtonRef} type="button" onClick={() => void confirmClipboardImageUpload()} disabled={uploading} className="h-8 rounded-sm bg-[#11a4d4] px-3 text-xs font-medium text-white disabled:opacity-50">Upload image</button>
						</div>
					</div>
				</div>
			) : null}
			{filteredSkills.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-emerald-500 rounded-sm shadow-xl">
					{filteredSkills.map((skill, index) => (
						<button
							key={skill.name}
							ref={index === activeSkillIndex ? activeSkillRef : null}
							type="button"
							onClick={() => insertSkill(skill.name)}
							className={`w-full grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-left border-b border-slate-800 ${index === activeSkillIndex ? "bg-emerald-500/15" : ""}`}
						>
							<span className="font-mono text-emerald-400">${skill.name}</span>
							<span className="text-xs text-slate-400">{skill.description ?? skill.path ?? ""}</span>
						</button>
					))}
				</div>
			) : null}
			{selectedUploadAttachments.length ? (
				<div className="mb-2 rounded-sm border border-slate-800 bg-[#0e1116] px-2.5 py-1.5" data-pibo-debug="composer-upload-attachments" data-upload-attachment-count={selectedUploadAttachments.length}>
					<div className="mb-1.5 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Attached uploads</div>
						<button type="button" onClick={onClearUploadAttachments} className="text-[11px] text-slate-500 hover:text-[#11a4d4]">Clear</button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{selectedUploadAttachments.map((attachment) => (
							<div key={attachment.id} title={attachment.path} className="inline-flex max-w-80 items-center gap-1 rounded-sm border border-emerald-500/45 bg-emerald-500/10 px-2 py-1 text-left text-[11px] text-slate-200" data-pibo-debug="composer-upload-attachment-chip" data-upload-path={attachment.path}>
								<span className="min-w-0 truncate">{boundedUiText(attachment.name || attachment.path, 100)}</span>
								<button type="button" onClick={() => void copyTextToClipboard(attachment.path)} title="Copy uploaded file path" aria-label="Copy uploaded file path" className="shrink-0 rounded-sm p-0.5 text-emerald-300 hover:bg-slate-800 hover:text-[#11a4d4]">
									<Copy size={11} />
								</button>
								<button type="button" onClick={() => onDetachUploadAttachment(attachment.id)} title={`Detach ${attachment.name || attachment.path}`} aria-label={`Detach ${attachment.name || attachment.path}`} className="shrink-0 rounded-sm p-0.5 text-emerald-300 hover:bg-slate-800 hover:text-slate-100">
									<X size={11} />
								</button>
							</div>
						))}
					</div>
				</div>
			) : null}
			{selectedWebAnnotations.length ? (
				<div className="mb-2 rounded-sm border border-slate-800 bg-[#0e1116] px-3 py-2" data-pibo-debug="composer-web-annotations" data-web-annotation-count={selectedWebAnnotations.length}>
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Attached web annotations</div>
						<button type="button" onClick={onClearWebAnnotations} className="text-[11px] text-slate-500 hover:text-[#11a4d4]">Clear</button>
					</div>
					<div className="flex flex-wrap gap-1.5">
						{selectedWebAnnotations.map((annotation) => (
							<button key={annotation.id} type="button" onClick={() => onDetachWebAnnotation(annotation.id)} title={`Detach ${annotation.id}`} className="inline-flex max-w-72 items-center gap-1 rounded-sm border border-[#11a4d4]/50 bg-[#11a4d4]/10 px-2 py-1 text-left text-[11px] text-slate-200" data-pibo-debug="composer-web-annotation-chip" data-web-annotation-id={annotation.id}>
								<span className="min-w-0 truncate">{boundedUiText(annotation.primaryTarget || annotation.label || annotation.note || annotation.id, 100)}</span>
								<X size={11} className="shrink-0 text-[#11a4d4]" />
							</button>
						))}
					</div>
				</div>
			) : null}
			{filtered.length ? (
				<div className="absolute left-3 bottom-full mb-2 w-[min(520px,calc(100%-24px))] max-h-72 overflow-auto bg-[#0e1116] border border-[#11a4d4] rounded-sm shadow-xl">
					{filtered.map((command, index) => (
						<button
							key={command.slash}
							ref={index === activeIndex ? activeCommandRef : null}
							type="button"
							onClick={() => {
								onValueChange(command.slash);
								dismissSuggestionKey(composerCommandSuggestionKey(command.slash));
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
					data-pibo-debug="composer-input"
					data-pibo-session-id={sessionId ?? undefined}
					data-pibo-state={disabled ? "disabled" : value ? "non-empty" : "empty"}
					rows={1}
					value={value}
					disabled={disabled}
					onChange={(event) => {
						historyNavRef.current = null;
						onValueChange(event.target.value);
						setCursorPos(event.target.selectionStart);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && (filteredSkills.length || filtered.length)) {
							event.preventDefault();
							event.stopPropagation();
							dismissVisibleSuggestions();
							return;
						}
						if (filteredSkills.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveSkillIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filteredSkills.length : (current - 1 + filteredSkills.length) % filteredSkills.length,
							);
							return;
						}
						if (filtered.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
							event.preventDefault();
							setActiveIndex((current) =>
								event.key === "ArrowDown" ? (current + 1) % filtered.length : (current - 1 + filtered.length) % filtered.length,
							);
							return;
						}
						if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.altKey && !event.ctrlKey && !event.metaKey) {
							if (navigateHistory(event.key === "ArrowUp" ? "previous" : "next")) {
								event.preventDefault();
								return;
							}
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					onPaste={handleClipboardImagePaste}
					placeholder={disabled ? "Select a session to message" : "Send Message (/ for commands or $ for skills)"}
					className="h-10 min-h-10 resize-none overflow-hidden bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm leading-5 outline-none focus:border-[#11a4d4] disabled:opacity-50 [scrollbar-gutter:stable]"
				/>
				<button
					type="button"
					disabled={disabled || uploading}
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

type ClipboardImageUpload = {
	file: File;
	previewUrl: string;
};

function composerSkillSuggestionKey(startPos: number, token: string): string {
	return `skill:${startPos}:${token}`;
}

function composerCommandSuggestionKey(commandToken: string): string {
	return `command:${commandToken}`;
}

function clipboardImageFiles(data: DataTransfer): File[] {
	const itemFiles = Array.from(data.items)
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => Boolean(file));
	const files = itemFiles.length ? itemFiles : Array.from(data.files).filter((file) => file.type.startsWith("image/"));
	return files.map(normalizeClipboardImageFile);
}

function normalizeClipboardImageFile(file: File): File {
	if (file.name && file.name !== "image.png") return file;
	return new File([file], screenshotUploadFilename(file.type), {
		type: file.type || "image/png",
		lastModified: Date.now(),
	});
}

function screenshotUploadFilename(type: string): string {
	const extension = imageExtension(type);
	const now = new Date();
	const stamp = [
		now.getFullYear(),
		padDatePart(now.getMonth() + 1),
		padDatePart(now.getDate()),
		"-",
		padDatePart(now.getHours()),
		padDatePart(now.getMinutes()),
		padDatePart(now.getSeconds()),
	].join("");
	return `screenshot-${stamp}${extension}`;
}

function imageExtension(type: string): string {
	switch (type) {
		case "image/jpeg":
			return ".jpg";
		case "image/gif":
			return ".gif";
		case "image/webp":
			return ".webp";
		case "image/svg+xml":
			return ".svg";
		default:
			return ".png";
	}
}

function padDatePart(value: number): string {
	return String(value).padStart(2, "0");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function resizeComposerInput(input: HTMLTextAreaElement | null) {
	if (!input) return;
	if (!input.value.includes("\n") && input.value.length < 80) {
		input.style.height = "";
		input.style.overflowY = "hidden";
		return;
	}
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
	modelCatalog,
	onSelect,
	onCreateSession,
	onEditContextFile,
	onEditMcpServer,
	onAgentsChanged,
	creatingSession,
}: {
	agents: BootstrapData["agents"];
	initialCustomAgents: CustomAgent[];
	initialCatalog?: AgentCatalog;
	modelCatalog?: ModelCatalog;
	onSelect: (profile: string) => void;
	onCreateSession: (profile: string) => void;
	onEditContextFile: (key: string) => void;
	onEditMcpServer: (name: string) => void;
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
	const [newContextFileName, setNewContextFileName] = useState("");
	const [newContextFileScope, setNewContextFileScope] = useState<"global" | "agent">("agent");
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
	const visibleContextFiles = useMemo(
		() => catalog?.contextFiles.filter((contextFile) => {
			if ((contextFile.scope ?? "global") !== "agent") return true;
			return contextFile.agentProfileName === draftProfileName || draft.contextFiles.includes(contextFile.key);
		}) ?? [],
		[catalog, draft.contextFiles, draftProfileName],
	);
	const nativeToolGroups = useMemo(
		() => buildNativeToolGroups(catalog?.nativeTools ?? [], draft.nativeTools),
		[catalog?.nativeTools, draft.nativeTools],
	);
	const skillGroups = useMemo(
		() => buildSkillGroups(catalog?.skills ?? [], draft.skills),
		[catalog?.skills, draft.skills],
	);
	const contextFileGroups = useMemo(
		() => buildContextFileGroups(visibleContextFiles, draft.contextFiles),
		[visibleContextFiles, draft.contextFiles],
	);

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
				mcpServers: draft.mcpServers,
				piPackages: draft.piPackages,
				mainModel: draft.mainModel,
				subagentModel: draft.subagentModel,
				thinkingLevel: draft.thinkingLevel ?? null,
				mainThinkingLevel: draft.mainThinkingLevel ?? null,
				subagentThinkingLevel: draft.subagentThinkingLevel ?? null,
				fast: draft.fast,
				mainFast: draft.mainFast,
				subagentFast: draft.subagentFast,
				builtinTools: draft.builtinTools,
				builtinToolNames: draft.builtinToolNames,
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

	const createContextFileForDraft = async () => {
		if (readOnly || !designerAvailable || !newContextFileName.trim()) return;
		if (agentNameError) {
			setLocalError(agentNameError);
			return;
		}
		setSaving(true);
		try {
			const response = await postContextFile({
				label: newContextFileName.trim(),
				scope: newContextFileScope,
				agentProfileName: newContextFileScope === "agent" ? draftProfileName : undefined,
				markdown: "",
			});
			const file = response.file;
			setCatalog((current) => current ? { ...current, contextFiles: [...current.contextFiles, file] } : current);
			setDraft((current) => ({
				...current,
				contextFiles: current.contextFiles.includes(file.key) ? current.contextFiles : [...current.contextFiles, file.key],
			}));
			setNewContextFileName("");
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
						{draft.source === "profile" && draft.hardPinnedModel ? (
							<div className="border border-slate-700 bg-[#151f24] text-slate-300 px-3 py-2 text-xs rounded-sm">
								This plugin profile hard-pins <span className="font-mono">{formatModelProfile(draft.hardPinnedModel)}</span>. Main-agent and subagent defaults do not apply.
							</div>
						) : null}
						<AgentRuntimeOptions
							title="Main Agent"
							modelTitle="Main Agent Model"
							model={draft.mainModel}
							thinking={draft.mainThinkingLevel}
							fast={draft.mainFast ?? false}
							modelCatalog={modelCatalog}
							readOnly={readOnly}
							modelHint="Unset to use the settings default."
							onModelChange={(mainModel) => setDraft((current) => ({ ...current, mainModel }))}
							onThinkingChange={(mainThinkingLevel) => setDraft((current) => ({ ...current, mainThinkingLevel }))}
							onFastChange={(mainFast) => setDraft((current) => ({ ...current, mainFast }))}
						/>
						<AgentRuntimeOptions
							title="Subagent"
							modelTitle="Subagent Model"
							model={draft.subagentModel}
							thinking={draft.subagentThinkingLevel}
							fast={draft.subagentFast ?? false}
							modelCatalog={modelCatalog}
							readOnly={readOnly}
							modelHint="Unset to use the settings default."
							onModelChange={(subagentModel) => setDraft((current) => ({ ...current, subagentModel }))}
							onThinkingChange={(subagentThinkingLevel) => setDraft((current) => ({ ...current, subagentThinkingLevel }))}
							onFastChange={(subagentFast) => setDraft((current) => ({ ...current, subagentFast }))}
						/>
						<InlineCheckboxToggle disabled={readOnly} checked={draft.autoContextFiles} title="Load AGENTS.md / CLAUDE.md" onToggle={() => setDraft((current) => ({ ...current, autoContextFiles: !current.autoContextFiles }))} />
						<BuiltinToolsDesigner draft={draft} setDraft={setDraft} readOnly={readOnly} />
					</DesignerPanel>
					<DesignerPanel title="Tools">
						<CatalogGroupGrid
							groups={nativeToolGroups}
							empty={catalog ? <EmptyCatalog message="No native tools registered" /> : <EmptyCatalog />}
							renderItem={(tool) => (
								<CatalogToggle
									key={tool.name}
									disabled={readOnly}
									checked={draft.nativeTools.includes(tool.name)}
									title={tool.name}
									description={tool.description}
									meta={tool.yieldable ? "yieldable" : "direct only"}
									onToggle={() => setDraft((current) => ({ ...current, nativeTools: toggleName(current.nativeTools, tool.name) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<DesignerPanel title="Skills">
						<CatalogGroupGrid
							groups={skillGroups}
							empty={catalog ? <EmptyCatalog message="No skills registered" /> : <EmptyCatalog />}
							renderItem={(skill) => (
								<CatalogToggle
									key={skill.name}
									disabled={readOnly}
									checked={draft.skills.includes(skill.name)}
									title={skill.name}
									description={skill.path}
									meta={skillMeta(skill)}
									metaClass={skill.kind === "user" ? "text-amber-200" : "text-[#11a4d4]"}
									onToggle={() => setDraft((current) => ({ ...current, skills: toggleName(current.skills, skill.name) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<CatalogSection title="Packages"><CatalogToggle disabled={readOnly} checked={draft.runControl} title="pibo-run-control" description="Expose pibo_run_* as one package for yielded native tools and subagents." meta="package" onToggle={() => setDraft((current) => ({ ...current, runControl: !current.runControl }))} /></CatalogSection>
					<PiPackagesDesigner
						packages={catalog?.piPackages}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
					/>
					<DesignerPanel title="Context Files">
						{draft.brokenContextFiles?.length ? (
							<div className="border border-red-500/60 bg-red-500/10 rounded-sm p-3 space-y-2">
								<div className="flex items-start gap-2 text-red-100">
									<AlertTriangle size={14} className="mt-0.5 shrink-0" />
									<div className="space-y-1">
										<div className="text-sm font-medium">This agent references missing context files.</div>
										<div className="text-xs text-red-200/90">Remove these broken links and save the agent to persist the cleanup.</div>
									</div>
								</div>
								<div className="grid gap-2">
									{draft.brokenContextFiles.map((contextFileKey) => (
										<div key={contextFileKey} className="flex items-center gap-2 border border-red-500/40 bg-[#2a1417] rounded-sm px-3 py-2">
											<div className="min-w-0 flex-1">
												<div className="truncate text-sm text-red-100">{contextFileKey}</div>
												<div className="text-[11px] uppercase tracking-wider text-red-300/80">Broken link</div>
											</div>
											<button
												type="button"
												disabled={readOnly}
												onClick={() => setDraft((current) => ({
													...current,
													contextFiles: current.contextFiles.filter((item) => item !== contextFileKey),
													brokenContextFiles: (current.brokenContextFiles ?? []).filter((item) => item !== contextFileKey),
												}))}
												className="h-8 w-8 inline-flex items-center justify-center border border-red-500/60 rounded-sm text-red-200 hover:border-red-400 hover:text-red-100 disabled:opacity-50"
												title="Remove Broken Context File"
												aria-label="Remove Broken Context File"
											>
												<X size={14} />
											</button>
										</div>
									))}
								</div>
							</div>
						) : null}
						<div className="grid grid-cols-[1fr_auto] gap-2">
							<input value={newContextFileName} disabled={readOnly} onChange={(event) => setNewContextFileName(event.target.value)} className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60" placeholder="New context file" />
							<button type="button" disabled={readOnly || saving || !newContextFileName.trim() || Boolean(agentNameError)} onClick={() => void createContextFileForDraft()} title="Create Context File" aria-label="Create Context File" className="h-9 w-9 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
								<Plus size={14} />
							</button>
						</div>
						<div className="inline-flex w-fit gap-1 border border-slate-800 bg-[#0e1116] rounded-sm p-1">
							<button type="button" disabled={readOnly} onClick={() => setNewContextFileScope("agent")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "agent" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Agent</button>
							<button type="button" disabled={readOnly} onClick={() => setNewContextFileScope("global")} className={`px-2 py-1 text-xs rounded-sm ${newContextFileScope === "global" ? "bg-[#11a4d4]/20 text-sky-100" : "text-slate-500 hover:text-slate-300"}`}>Global</button>
						</div>
						<CatalogGroupGrid
							groups={contextFileGroups}
							empty={catalog ? <EmptyCatalog message="No context files registered" /> : <EmptyCatalog />}
							renderItem={(contextFile) => (
								<CatalogToggle
									key={contextFile.key}
									disabled={readOnly}
									checked={draft.contextFiles.includes(contextFile.key)}
									title={contextFile.label ?? contextFile.key}
									description={contextFile.path}
									meta={contextFileMeta(contextFile)}
									metaClass="text-[#11a4d4]"
									actionLabel="Edit"
									actionIcon={<Edit3 size={12} />}
									onAction={() => onEditContextFile(contextFile.key)}
									onToggle={() => setDraft((current) => ({ ...current, contextFiles: toggleName(current.contextFiles, contextFile.key) }))}
								/>
							)}
						/>
					</DesignerPanel>
					<SubagentDesigner draft={draft} setDraft={setDraft} profileOptions={profileOptions} readOnly={readOnly} />
					<McpServersDesigner
						servers={catalog?.mcpServers}
						draft={draft}
						setDraft={setDraft}
						readOnly={readOnly}
						onEditServer={onEditMcpServer}
					/>
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
	hardPinnedModel?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	mainThinkingLevel?: ThinkingLevel;
	subagentThinkingLevel?: ThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	brokenContextFiles?: string[];
	source: "custom" | "profile";
};

function createBlankAgentDraft(catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: "new-agent",
		description: "",
		nativeTools: [],
		skills: hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : [],
		contextFiles: [],
		subagents: [],
		mcpServers: [],
		piPackages: [],
		mainModel: undefined,
		subagentModel: undefined,
		thinkingLevel: undefined,
		mainThinkingLevel: undefined,
		subagentThinkingLevel: undefined,
		fast: false,
		mainFast: false,
		subagentFast: false,
		builtinTools: "default",
		builtinToolNames: [...DEFAULT_BUILTIN_TOOL_NAMES],
		autoContextFiles: true,
		runControl: false,
		brokenContextFiles: [],
		hardPinnedModel: undefined,
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
		mcpServers: agent.mcpServers,
		piPackages: agent.piPackages ?? [],
		mainModel: agent.mainModel,
		subagentModel: agent.subagentModel,
		thinkingLevel: agent.thinkingLevel,
		mainThinkingLevel: agent.mainThinkingLevel,
		subagentThinkingLevel: agent.subagentThinkingLevel,
		fast: agent.fast ?? false,
		mainFast: agent.mainFast ?? false,
		subagentFast: agent.subagentFast ?? false,
		builtinTools: agent.builtinTools,
		builtinToolNames: normalizeBuiltinToolNames(agent.builtinToolNames, agent.builtinTools),
		autoContextFiles: agent.autoContextFiles ?? true,
		runControl: agent.runControl,
		brokenContextFiles: agent.brokenContextFiles ?? [],
		archivedAt: agent.archivedAt,
		hardPinnedModel: undefined,
		source: "custom",
	};
}

function profileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: profile.name,
		description: profile.description ?? "",
		nativeTools: profile.nativeTools ?? [],
		skills: profile.skills ?? (hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : []),
		contextFiles: profile.contextFiles ?? [],
		subagents: profile.subagents ?? [],
		mcpServers: profile.mcpServers ?? [],
		piPackages: profile.piPackages ?? [],
		mainModel: profile.mainModel ?? profile.model,
		subagentModel: profile.subagentModel ?? profile.model,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel ?? profile.thinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel ?? profile.thinkingLevel,
		fast: profile.fast ?? false,
		mainFast: profile.mainFast ?? profile.fast ?? false,
		subagentFast: profile.subagentFast ?? profile.fast ?? false,
		builtinTools: profile.builtinTools ?? "default",
		builtinToolNames: normalizeBuiltinToolNames(profile.builtinToolNames, profile.builtinTools),
		autoContextFiles: profile.autoContextFiles ?? true,
		runControl: profile.runControl ?? false,
		brokenContextFiles: [],
		hardPinnedModel: profile.model,
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
		hardPinnedModel: undefined,
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

function normalizeBuiltinToolNames(names: string[] | undefined, mode: "default" | "disabled" = "default"): string[] {
	if (mode === "disabled") return [];
	const selected = new Set(names ?? DEFAULT_BUILTIN_TOOL_NAMES);
	return DEFAULT_BUILTIN_TOOL_NAMES.filter((name) => selected.has(name));
}

type NativeToolCatalogItem = AgentCatalog["nativeTools"][number];
type ContextFileCatalogItem = AgentCatalog["contextFiles"][number];
type PiPackageCatalogItem = AgentCatalog["piPackages"][number];
type SkillCatalogItem = AgentCatalog["skills"][number];
type CatalogGroupKind = "builtin" | "plugin" | "custom" | "user";
const CODEX_COMPAT_TOOL_NAMES = new Set([
	"apply_patch",
	"web_search",
	"view_image",
]);
const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;
const BUILTIN_TOOL_DESCRIPTIONS: Record<(typeof DEFAULT_BUILTIN_TOOL_NAMES)[number], string> = {
	read: "Read workspace files.",
	bash: "Run shell commands.",
	edit: "Edit existing files.",
	write: "Create or overwrite files.",
};
const CATALOG_GROUP_RENDER_LIMIT = 100;

type CatalogGroup<T> = {
	key: string;
	title: string;
	description: string;
	kind: CatalogGroupKind;
	items: T[];
	selectedCount: number;
	totalCount: number;
	defaultOpen: boolean;
};

function buildNativeToolGroups(tools: NativeToolCatalogItem[], selectedNames: string[]): CatalogGroup<NativeToolCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<NativeToolCatalogItem>>();
	for (const tool of tools) {
		const pluginId = tool.pluginId ?? (CODEX_COMPAT_TOOL_NAMES.has(tool.name) ? "pibo.codex-compat" : undefined);
		const pluginName = tool.pluginName ?? (pluginId === "pibo.codex-compat" ? "Codex Compat" : undefined);
		const isNative = !pluginId || pluginId === "pibo.core";
		const key = isNative ? "builtin" : `plugin:${pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isNative ? "Built-in Tools" : pluginDisplayName(pluginId, pluginName),
			description: isNative ? "Built-in Pibo tool catalog" : pluginId ?? "plugin",
			kind: isNative ? "builtin" : "plugin",
		});
		group.items.push(tool);
		if (selected.has(tool.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin"]);
}

function buildSkillGroups(skills: SkillCatalogItem[], selectedNames: string[]): CatalogGroup<SkillCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<SkillCatalogItem>>();
	for (const skill of skills) {
		const kind = skill.kind;
		const key = kind === "plugin" ? `plugin:${skill.pluginId ?? skill.name}` : kind;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: skillGroupTitle(skill),
			description: skillGroupDescription(skill),
			kind: skill.kind,
		});
		group.items.push(skill);
		if (selected.has(skill.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin", "user"]);
}

function buildContextFileGroups(files: ContextFileCatalogItem[], selectedKeys: string[]): CatalogGroup<ContextFileCatalogItem>[] {
	const selected = new Set(selectedKeys);
	const groups = new Map<string, CatalogGroup<ContextFileCatalogItem>>();
	for (const file of files) {
		const isBuiltIn = file.pluginId === "pibo.core";
		const isCustom = !file.pluginId;
		const key = isBuiltIn ? "builtin" : isCustom ? "custom" : `plugin:${file.pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isBuiltIn ? "Built-in Context Files" : isCustom ? "Custom" : pluginDisplayName(file.pluginId, file.pluginName),
			description: isBuiltIn ? "Pibo-owned built-in context file catalog" : isCustom ? "Loose context files without a plugin owner" : file.pluginId ?? "plugin",
			kind: isBuiltIn ? "builtin" : isCustom ? "custom" : "plugin",
		});
		group.items.push(file);
		if (selected.has(file.key)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "custom", "plugin"]);
}

function getOrCreateCatalogGroup<T>(
	groups: Map<string, CatalogGroup<T>>,
	key: string,
	options: Pick<CatalogGroup<T>, "title" | "description" | "kind">,
): CatalogGroup<T> {
	const existing = groups.get(key);
	if (existing) return existing;
	const created: CatalogGroup<T> = {
		key,
		title: options.title,
		description: options.description,
		kind: options.kind,
		items: [],
		selectedCount: 0,
		totalCount: 0,
		defaultOpen: false,
	};
	groups.set(key, created);
	return created;
}

function finalizeCatalogGroups<T>(
	groups: Map<string, CatalogGroup<T>>,
	kindOrder: CatalogGroupKind[],
): CatalogGroup<T>[] {
	const order = new Map(kindOrder.map((kind, index) => [kind, index]));
	const sorted = [...groups.values()].sort((left, right) => {
		const leftOrder = order.get(left.kind) ?? kindOrder.length;
		const rightOrder = order.get(right.kind) ?? kindOrder.length;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.title.localeCompare(right.title);
	});
	return sorted.map((group) => ({
		...group,
		defaultOpen: false,
	}));
}

function pluginDisplayName(pluginId: string | undefined, pluginName: string | undefined): string {
	if (pluginId === "pibo.codex-compat") return "Codex Compat";
	if (pluginName) return pluginName;
	if (!pluginId) return "Plugin";
	const lastSegment = pluginId.split(".").filter(Boolean).at(-1) ?? pluginId;
	return lastSegment.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function skillGroupTitle(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Built-in Skills";
	if (skill.kind === "user") return "User Skills";
	return pluginDisplayName(skill.pluginId, skill.pluginName);
}

function skillGroupDescription(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Pibo-owned built-in skill catalog";
	if (skill.kind === "user") return "User-managed skills";
	return skill.pluginId ?? "plugin";
}

function skillMeta(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "built-in skill";
	if (skill.kind === "user") return "user skill";
	return skill.pluginName ?? skill.pluginId ?? "plugin skill";
}

function hasBuiltinSkill(catalog: AgentCatalog | undefined, name: string): boolean {
	return catalog?.skills.some((skill) => skill.kind === "builtin" && skill.name === name) ?? false;
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

function SettingsSidebar({
	activePanel,
	onSelect,
	piPackageCount,
	userSkillCount,
}: {
	activePanel: SettingsPanel;
	onSelect: (panel: SettingsPanel) => void;
	piPackageCount: number;
	userSkillCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Settings</div>
				<button
					type="button"
					onClick={() => onSelect("general")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "general"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Settings size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">General</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">browser + runtime</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pi-packages")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pi-packages"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pi Packages</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">runtime-packages</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{piPackageCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("skills")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "skills"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Skills</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">user-managed</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{userSkillCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("providers")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "providers"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Key size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Providers</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">auth + api keys</span>
					</div>
				</button>
			</div>
		</div>
	);
}

function ContextSidebar({
	activePanel,
	onSelect,
	toolCount,
	mcpServerCount,
}: {
	activePanel: ContextPanel;
	onSelect: Dispatch<SetStateAction<ContextPanel>>;
	toolCount: number;
	mcpServerCount: number;
}) {
	return (
		<div className="p-2">
			<div className="mb-4">
				<div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Context</div>
				<button
					type="button"
					onClick={() => onSelect("context-files")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "context-files"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Layers size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Context Files</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">managed-editor</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("base-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "base-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<BookOpenText size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Base Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">system-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("compaction-prompt")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "compaction-prompt"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Brain size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Compaction Prompt</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">summary-prompt</span>
					</div>
				</button>
				<button
					type="button"
					onClick={() => onSelect("pibo-tools")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "pibo-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Wrench size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">Pibo Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">installed-tool-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{toolCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("mcp-tools")}
					className={`mb-1 flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "mcp-tools"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Server size={13} className="text-[#11a4d4]" />
					<div className="min-w-0 flex-1">
						<span className="block truncate text-sm text-slate-200">MCP Tools</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">mcp-context</span>
					</div>
					<span className="inline-flex min-w-6 items-center justify-center border border-slate-700 bg-[#101d22] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
						{mcpServerCount}
					</span>
				</button>
				<button
					type="button"
					onClick={() => onSelect("build-context")}
					className={`flex w-full items-center gap-2 border p-2 text-left ${
						activePanel === "build-context"
							? "border-[#11a4d4] bg-[#11a4d4]/10"
							: "border-slate-800 bg-[#151f24] hover:border-slate-700"
					}`}
				>
					<Bug size={13} className="text-[#11a4d4]" />
					<div className="min-w-0">
						<span className="block truncate text-sm text-slate-200">Build Context</span>
						<span className="block truncate font-mono text-[10px] text-slate-500">runtime-snapshot</span>
					</div>
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

function CatalogGroupGrid<T>({
	groups,
	empty,
	renderItem,
}: {
	groups: CatalogGroup<T>[];
	empty: ReactNode;
	renderItem: (item: T) => ReactNode;
}) {
	if (groups.length === 0) return <>{empty}</>;
	return (
		<div className="grid gap-2">
			{groups.map((group) => (
				<CatalogGroupCard key={group.key} group={group} renderItem={renderItem} />
			))}
		</div>
	);
}

function CatalogGroupCard<T>({
	group,
	renderItem,
}: {
	group: CatalogGroup<T>;
	renderItem: (item: T) => ReactNode;
}) {
	const [open, setOpen] = useState(group.defaultOpen);
	const visibleItems = group.items.slice(0, CATALOG_GROUP_RENDER_LIMIT);
	const hiddenCount = group.items.length - visibleItems.length;
	const accentClass = group.kind === "custom" || group.kind === "user"
		? "border-[#f59e0b]/70 text-amber-100 bg-[#f59e0b]/10"
		: "border-[#11a4d4]/70 text-sky-100 bg-[#11a4d4]/10";
	return (
		<div className={`border rounded-sm ${open ? "border-slate-700 bg-[#101d22]" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 p-2 text-left">
				<span className={`h-6 w-6 shrink-0 inline-flex items-center justify-center border rounded-sm ${accentClass}`}>
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-slate-100">{group.title}</span>
					<span className="block truncate font-mono text-[10px] text-slate-500">{group.description}</span>
				</span>
				<span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums" aria-label={`${group.selectedCount} of ${group.totalCount} selected`}>
					<span className="text-[#11a4d4]">{group.selectedCount}</span>
					<span className="text-slate-500">/{group.totalCount}</span>
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-800 p-2">
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">{visibleItems.map(renderItem)}</div>
					{hiddenCount > 0 ? <div className="mt-2 text-xs text-slate-500">Showing first {CATALOG_GROUP_RENDER_LIMIT} of {group.items.length} items. Use Context to manage the full catalog.</div> : null}
				</div>
			) : null}
		</div>
	);
}

function CatalogToggle({
	checked,
	disabled,
	title,
	description,
	meta,
	metaClass,
	actionLabel,
	actionIcon,
	actionDisabled,
	onAction,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	title: string;
	description?: string;
	meta?: string;
	metaClass?: string;
	actionLabel?: string;
	actionIcon?: ReactNode;
	actionDisabled?: boolean;
	onAction?: () => void;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={() => {
				if (!disabled) onToggle();
			}}
			aria-disabled={disabled}
			className={`min-w-0 border rounded-sm p-2 text-left grid grid-cols-[18px_1fr] gap-2 ${disabled && !onAction ? "opacity-60" : ""} ${
				checked ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24] hover:border-slate-700"
			}`}
		>
			<SelectionCheckbox checked={checked} className="mt-0.5" />
			<span className="min-w-0">
				<span className="flex items-start justify-between gap-2">
					<span className="min-w-0 flex-1">
						<span className="block text-sm truncate text-slate-200">{title}</span>
					</span>
					{actionLabel && onAction ? (
						<span className="shrink-0">
							<span
								role="button"
								tabIndex={0}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									if (!actionDisabled) onAction();
								}}
								onKeyDown={(event) => {
									if ((event.key === "Enter" || event.key === " ") && !actionDisabled) {
										event.preventDefault();
										event.stopPropagation();
										onAction();
									}
								}}
								className={`inline-flex h-6 items-center justify-center gap-1 border px-1.5 text-[10px] uppercase tracking-wider ${
									actionDisabled
										? "border-slate-800 text-slate-600"
										: "border-[#11a4d4]/70 text-[#7dd3fc] hover:border-[#11a4d4] hover:text-sky-100"
								}`}
							>
								{actionIcon}
								{actionLabel}
							</span>
						</span>
					) : null}
				</span>
				{description ? <span className="block text-xs text-slate-500 truncate">{description}</span> : null}
				{meta ? <span className={`block font-mono text-[10px] mt-1 ${metaClass ?? "text-slate-600"}`}>{meta}</span> : null}
			</span>
		</button>
	);
}

function PiPackagesDesigner({
	packages,
	draft,
	setDraft,
	readOnly,
}: {
	packages?: PiPackageCatalogItem[];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const allPackages = packages ?? [];
	const packageList = allPackages.filter(isSelectablePiPackage);
	const selectedCount = packageList.filter((pkg) => isPiPackageSelected(draft.piPackages, pkg)).length;

	const toggleExpanded = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<DesignerPanel title="Pi Packages">
			<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
				{packageList.length} available / {selectedCount} selected / {allPackages.length} registered
			</div>
			{packages ? (
				packageList.length ? (
					<div className="grid gap-2">
						{packageList.map((pkg) => (
							<PiPackageCard
								key={pkg.id}
								pkg={pkg}
								selected={isPiPackageSelected(draft.piPackages, pkg)}
								readOnly={readOnly}
								expanded={expanded.has(pkg.id)}
								busy={false}
								onToggleSelected={() => {
									if (!readOnly) {
										setDraft((current) => ({ ...current, piPackages: togglePiPackageSelection(current.piPackages, pkg) }));
									}
								}}
								onToggleExpanded={() => toggleExpanded(pkg.id)}
							/>
						))}
					</div>
				) : <EmptyCatalog message="No installed and enabled Pi packages available. Manage Pi Packages in Settings." />
			) : <EmptyCatalog />}
		</DesignerPanel>
	);
}

function PiPackageCard({
	pkg,
	selected,
	readOnly,
	expanded,
	busy,
	onToggleSelected,
	onToggleExpanded,
	onToggleEnabled,
	onUnregister,
}: {
	pkg: PiPackageCatalogItem;
	selected: boolean;
	readOnly: boolean;
	expanded: boolean;
	busy: boolean;
	onToggleSelected: () => void;
	onToggleExpanded: () => void;
	onToggleEnabled?: () => void;
	onUnregister?: () => void;
}) {
	const hasErrors = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error");
	const selectable = !readOnly && (pkg.enabled || selected);
	return (
		<div className={`border rounded-sm ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#151f24]"} ${!pkg.enabled ? "opacity-75" : ""}`}>
			<div className="grid grid-cols-[1fr_auto] gap-2 p-2">
				<button type="button" disabled={!selectable} onClick={onToggleSelected} className="min-w-0 grid grid-cols-[18px_1fr] gap-2 text-left disabled:cursor-not-allowed">
					<SelectionCheckbox checked={selected} disabled={!selectable} className="mt-0.5" />
					<span className="min-w-0">
						<span className="flex items-center gap-2">
							<span className="min-w-0 truncate text-sm text-slate-200">{pkg.name}</span>
							<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{pkg.enabled ? "enabled" : "disabled"}</span>
						</span>
						<span className="block text-xs text-slate-500 truncate">{pkg.description ?? pkg.source}</span>
						<span className={`block font-mono text-[10px] mt-1 ${hasErrors ? "text-[#f59e0b]" : "text-[#11a4d4]"}`}>{piPackageMeta(pkg)}</span>
					</span>
				</button>
				<div className="flex items-start gap-1">
					<button type="button" onClick={onToggleExpanded} title={expanded ? "Hide Details" : "Show Details"} aria-label={expanded ? "Hide Details" : "Show Details"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>
					{onToggleEnabled ? (
						<button type="button" disabled={busy} onClick={onToggleEnabled} title={pkg.enabled ? "Disable Package" : "Enable Package"} aria-label={pkg.enabled ? "Disable Package" : "Enable Package"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							{pkg.enabled ? <PowerOff size={13} /> : <Power size={13} />}
						</button>
					) : null}
					{onUnregister ? (
						<button type="button" disabled={busy} onClick={onUnregister} title="Unregister Package" aria-label="Unregister Package" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-400 hover:text-red-300 disabled:opacity-50">
							<Trash2 size={13} />
						</button>
					) : null}
				</div>
			</div>
			{expanded ? <PiPackageDetails pkg={pkg} /> : null}
		</div>
	);
}

function PiPackageDetails({ pkg }: { pkg: PiPackageCatalogItem }) {
	return (
		<div className="border-t border-slate-800 p-3 grid gap-3 text-xs text-slate-300">
			<PackageDetailGrid rows={[
				["Source", pkg.source],
				["Install", pkg.installSpec],
				["Version", pkg.version],
				["Added", pkg.addedAt],
				["Updated", pkg.updatedAt],
			]} />
			{pkg.repositoryUrl ? (
				<a href={pkg.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-[#7dd3fc] hover:text-sky-100">
					<ExternalLink size={12} />
					Source repository
				</a>
			) : null}
			<PackageResourceList title="Extensions" values={pkg.extensionPaths} />
			<PackageResourceList title="Skills" values={pkg.skillNames} />
			<PackageResourceList title="Prompts" values={pkg.promptNames} />
			<PackageResourceList title="Themes" values={pkg.themeNames} />
			<PackageResourceList title="Tools" values={pkg.discoveredToolNames} />
			{pkg.diagnostics.length ? (
				<div className="grid gap-1">
					<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Diagnostics</div>
					{pkg.diagnostics.map((diagnostic, index) => (
						<div key={`${diagnostic.type}:${index}`} className={`border px-2 py-1 rounded-sm ${diagnostic.type === "error" ? "border-red-500/50 text-red-200 bg-red-500/10" : diagnostic.type === "warning" ? "border-[#f59e0b]/50 text-amber-100 bg-[#f59e0b]/10" : "border-slate-700 text-slate-400 bg-[#0e1116]"}`}>
							<span className="font-mono uppercase text-[10px] mr-2">{diagnostic.type}</span>
							{diagnostic.message}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function PackageDetailGrid({ rows }: { rows: Array<[string, string | undefined]> }) {
	const visibleRows = rows.filter(([, value]) => value);
	if (visibleRows.length === 0) return null;
	return (
		<div className="grid gap-1">
			{visibleRows.map(([label, value]) => (
				<div key={label} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
					<span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
					<span className="min-w-0 break-all font-mono text-[11px] text-slate-300">{value}</span>
				</div>
			))}
		</div>
	);
}

function PackageResourceList({ title, values }: { title: string; values?: string[] }) {
	if (!values?.length) return null;
	return (
		<div className="grid gap-1">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			<div className="flex flex-wrap gap-1">
				{values.map((value) => <span key={value} className="max-w-full break-all border border-slate-700 bg-[#0e1116] px-2 py-1 font-mono text-[11px] text-slate-300 rounded-sm">{value}</span>)}
			</div>
		</div>
	);
}

function BuiltinToolsDesigner({
	draft,
	setDraft,
	readOnly,
}: {
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
}) {
	const selectedTools = normalizeBuiltinToolNames(draft.builtinToolNames, draft.builtinTools);
	const [open, setOpen] = useState(selectedTools.length !== DEFAULT_BUILTIN_TOOL_NAMES.length);
	const toggleBuiltinTool = (name: string) => {
		setDraft((current) => {
			const currentSelection = normalizeBuiltinToolNames(current.builtinToolNames, current.builtinTools);
			const nextSelection = toggleName(currentSelection, name);
			return {
				...current,
				builtinTools: nextSelection.length === 0 ? "disabled" : "default",
				builtinToolNames: nextSelection,
			};
		});
	};

	return (
		<div className={`border rounded-sm ${open ? "border-slate-700 bg-[#101d22]" : "border-slate-800 bg-[#151f24] hover:border-slate-700"}`}>
			<button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 p-2 text-left">
				<span className="h-6 w-6 shrink-0 inline-flex items-center justify-center border rounded-sm border-[#11a4d4]/70 text-sky-100 bg-[#11a4d4]/10">
					{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium text-slate-100">Pi Built-in Tools</span>
					<span className="block truncate font-mono text-[10px] text-slate-500">basic model tools</span>
				</span>
				<span className="shrink-0 text-right font-mono text-sm font-semibold tabular-nums" aria-label={`${selectedTools.length} of ${DEFAULT_BUILTIN_TOOL_NAMES.length} enabled`}>
					<span className="text-[#11a4d4]">{selectedTools.length}</span>
					<span className="text-slate-500">/{DEFAULT_BUILTIN_TOOL_NAMES.length}</span>
				</span>
			</button>
			{open ? (
				<div className="border-t border-slate-800 p-2">
					<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
						{DEFAULT_BUILTIN_TOOL_NAMES.map((toolName) => (
							<CatalogToggle
								key={toolName}
								disabled={readOnly}
								checked={selectedTools.includes(toolName)}
								title={toolName}
								description={BUILTIN_TOOL_DESCRIPTIONS[toolName]}
								meta="built-in"
								onToggle={() => toggleBuiltinTool(toolName)}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function InlineCheckboxToggle({
	checked,
	disabled,
	title,
	onToggle,
}: {
	checked: boolean;
	disabled?: boolean;
	title: string;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			aria-pressed={checked}
			onClick={onToggle}
			className="inline-flex w-fit items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100 disabled:opacity-60"
		>
			<SelectionCheckbox checked={checked} disabled={disabled} />
			<span>{title}</span>
		</button>
	);
}

function SelectionCheckbox({
	checked,
	disabled,
	className = "",
}: {
	checked: boolean;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<span className={`h-4 w-4 shrink-0 border rounded-sm inline-flex items-center justify-center ${checked ? "border-[#11a4d4] text-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-600 text-transparent"} ${disabled ? "opacity-70" : ""} ${className}`}>
			{checked ? <Check size={12} /> : null}
		</span>
	);
}

function contextFileMeta(contextFile: AgentCatalog["contextFiles"][number]): string {
	const source = contextFile.source ?? "plugin";
	const scope = contextFile.scope ?? "global";
	if (contextFile.pluginId === "pibo.core") return "built-in global";
	if (source === "plugin") return "plugin global";
	if (scope === "agent") return contextFile.agentProfileName ? `agent ${contextFile.agentProfileName}` : "agent local";
	return "managed global";
}

function isPiPackageSelected(selected: string[], pkg: PiPackageCatalogItem): boolean {
	return selected.includes(pkg.id) || selected.includes(pkg.name);
}

function togglePiPackageSelection(selected: string[], pkg: PiPackageCatalogItem): string[] {
	if (isPiPackageSelected(selected, pkg)) return selected.filter((name) => name !== pkg.id && name !== pkg.name);
	return [...selected, pkg.id];
}

function isSelectablePiPackage(pkg: PiPackageCatalogItem): boolean {
	return pkg.enabled && pkg.installStatus === "installed";
}

function piPackageMeta(pkg: AgentCatalog["piPackages"][number]): string {
	const resources = pkg.resourceTypes.length ? pkg.resourceTypes.join(" + ") : "resources pending";
	const version = pkg.version ? `v${pkg.version}` : pkg.installStatus;
	const diagnostics = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error") ? " / needs attention" : "";
	const enabled = pkg.enabled ? "enabled" : "disabled";
	return `${resources} / ${version} / ${enabled}${diagnostics}`;
}

function EmptyCatalog({ message = "Agent Designer API unavailable" }: { message?: string }) {
	return <div className="text-xs text-amber-100 border border-dashed border-[#f59e0b]/50 bg-[#f59e0b]/10 rounded-sm p-3">{message}</div>;
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
						subagents: [...current.subagents, { name: "helper", targetProfile: profileOptions[0]?.value ?? "codex-compat-openai-web", maxDepth: 3 }],
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

function McpServersDesigner({
	servers,
	draft,
	setDraft,
	readOnly,
	onEditServer,
}: {
	servers?: AgentCatalog["mcpServers"];
	draft: AgentDraft;
	setDraft: Dispatch<SetStateAction<AgentDraft>>;
	readOnly: boolean;
	onEditServer: (serverName: string) => void;
}) {
	return (
		<DesignerPanel title="MCP Servers">
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				{servers ? servers.map((server) => {
					const selectionDisabled = readOnly || !server.hasDescription;
					return (
						<div key={server.name} className={`border rounded-sm bg-[#151f24] p-2 ${draft.mcpServers.includes(server.name) ? "border-[#11a4d4]" : server.hasDescription ? "border-slate-800" : "border-[#f59e0b]/60"}`}>
							<button
								type="button"
								disabled={selectionDisabled}
								onClick={() => setDraft((current) => ({ ...current, mcpServers: toggleName(current.mcpServers, server.name) }))}
								className="grid w-full min-w-0 grid-cols-[18px_1fr] gap-2 text-left disabled:opacity-60"
							>
								<SelectionCheckbox checked={draft.mcpServers.includes(server.name)} disabled={selectionDisabled} className="mt-0.5" />
								<span className="min-w-0">
									<span className="flex items-center gap-2">
										<Server size={13} className="text-[#11a4d4]" />
										<span className="block text-sm truncate text-slate-200">{server.name}</span>
									</span>
									<span className="block font-mono text-[10px] mt-1 text-slate-600">
										{server.transport}{server.descriptionSource ? ` / ${server.descriptionSource}` : ""}
									</span>
								</span>
							</button>
							{server.hasDescription ? (
								<div className="mt-2 text-xs text-slate-400">{server.description}</div>
							) : (
								<div className="mt-2 flex items-center gap-2 text-xs text-amber-100">
									<AlertTriangle size={13} />
									Missing agent description
								</div>
							)}
							<div className="mt-2 flex justify-end">
								<button
									type="button"
									onClick={() => onEditServer(server.name)}
									title="Edit MCP Tool Context"
									aria-label="Edit MCP Tool Context"
									className="inline-flex h-6 items-center justify-center gap-1 border border-[#11a4d4]/70 px-1.5 text-[10px] uppercase tracking-wider text-[#7dd3fc] hover:border-[#11a4d4] hover:text-sky-100"
								>
									<Edit3 size={12} />
									Edit
								</button>
							</div>
						</div>
					);
				}) : <EmptyCatalog />}
				{servers && servers.length === 0 ? <div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">No MCP servers configured</div> : null}
			</div>
		</DesignerPanel>
	);
}

import { ProviderSettingsView } from "./settings/ProviderSettingsView";

function SettingsView({
	activePanel,
	showThinking,
	setShowThinking,
	expandThinking,
	setExpandThinking,
	modelDefaults,
	modelCatalog,
	onModelDefaultsChanged,
	piPackages,
	onPiPackageChanged,
	onPiPackageRemoved,
	userSkills,
	onUserSkillChanged,
	onUserSkillRemoved,
	piboSessionId,
	onProviderAuthChanged,
}: {
	activePanel: SettingsPanel;
	showThinking: boolean;
	setShowThinking: (value: boolean) => void;
	expandThinking: boolean;
	setExpandThinking: (value: boolean) => void;
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	onModelDefaultsChanged: (value: ModelDefaults) => void;
	piPackages?: PiPackageCatalogItem[];
	onPiPackageChanged: (pkg: PiPackageCatalogItem) => void;
	onPiPackageRemoved: (pkg: PiPackageCatalogItem) => void;
	userSkills?: UserSkill[];
	onUserSkillChanged: (skill: UserSkill) => void;
	onUserSkillRemoved: (skillId: string) => void;
	piboSessionId?: string | null;
	onProviderAuthChanged?: () => void | Promise<void>;
}) {
	if (activePanel === "pi-packages") {
		return (
			<div className="p-6 overflow-auto">
				<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
					<Layers size={16} />
					Pi Packages
				</h1>
				<PiPackagesSettings packages={piPackages} onPackageChanged={onPiPackageChanged} onPackageRemoved={onPiPackageRemoved} />
			</div>
		);
	}

	if (activePanel === "skills") {
		return (
			<div className="overflow-auto p-6 max-[640px]:p-3">
				<h1 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
					<Wrench size={16} />
					Skills
				</h1>
				<UserSkillsSettings skills={userSkills} onSkillChanged={onUserSkillChanged} onSkillRemoved={onUserSkillRemoved} />
			</div>
		);
	}

	if (activePanel === "providers") {
		return (
			<div className="p-6 overflow-auto">
				<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
					<Key size={16} />
					Providers
				</h1>
				<ProviderSettingsView piboSessionId={piboSessionId} onProviderAuthChanged={onProviderAuthChanged} />
			</div>
		);
	}

	return (
		<div className="p-6 overflow-auto">
			<h1 className="text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
				<Settings size={16} />
				General
			</h1>
			<DesignerPanel title="General">
				<UserTimezoneSettings />
				<InlineCheckboxToggle
					checked={showThinking}
					title="Show thinking blocks"
					onToggle={() => {
						const next = !showThinking;
						setShowThinking(next);
						localStorage.setItem("pibo.chat.showThinking", String(next));
					}}
				/>
				<InlineCheckboxToggle
					checked={expandThinking}
					disabled={!showThinking}
					title="Expand thinking blocks"
					onToggle={() => {
						const next = !expandThinking;
						setExpandThinking(next);
						localStorage.setItem("pibo.chat.expandThinking", String(next));
					}}
				/>
				<ModelDefaultsSettings
					modelDefaults={modelDefaults}
					modelCatalog={modelCatalog}
					onChanged={onModelDefaultsChanged}
				/>
			</DesignerPanel>
		</div>
	);
}

const FALLBACK_TIMEZONES = [
	"UTC",
	"Europe/Berlin",
	"Europe/London",
	"Europe/Paris",
	"Europe/Madrid",
	"Europe/Rome",
	"Europe/Amsterdam",
	"Europe/Vienna",
	"Europe/Zurich",
	"Europe/Warsaw",
	"Europe/Istanbul",
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/Toronto",
	"America/Sao_Paulo",
	"America/Mexico_City",
	"Asia/Dubai",
	"Asia/Jerusalem",
	"Asia/Kolkata",
	"Asia/Bangkok",
	"Asia/Singapore",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Asia/Seoul",
	"Australia/Sydney",
	"Australia/Melbourne",
	"Pacific/Auckland",
] as const;

function UserTimezoneSettings() {
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({ queryKey: ["user-settings"], queryFn: getUserSettings });
	const timezoneOptions = useMemo(() => buildTimezoneOptions(data?.timezone), [data?.timezone]);
	const [draft, setDraft] = useState("UTC");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (data?.timezone) setDraft(data.timezone);
	}, [data?.timezone]);

	const save = async (timezone = draft) => {
		setSaving(true);
		setError(null);
		try {
			const saved = await patchUserSettings({ timezone } satisfies UserSettings);
			setDraft(saved.timezone);
			queryClient.setQueryData(["user-settings"], saved);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="border-b border-slate-800 pb-4 mb-4">
			<div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">User timezone</div>
			<div className="max-w-xl">
				<select
					value={draft}
					disabled={isLoading || saving}
					onChange={(event) => {
						const timezone = event.target.value;
						setDraft(timezone);
						void save(timezone);
					}}
					className="w-full min-w-0 rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					{timezoneOptions.map((option) => (
						<option key={option.value} value={option.value}>{option.label}</option>
					))}
				</select>
			</div>
			<div className="mt-2 text-[11px] text-slate-500">Choose a city-based timezone. Changes are saved automatically and loaded into every runtime context together with the user ID and current Pibo Session ID.</div>
			{saving ? <div className="mt-2 text-xs text-slate-400">Saving…</div> : null}
			{error ? <div className="mt-2 text-xs text-red-300">{error}</div> : null}
		</div>
	);
}

function buildTimezoneOptions(currentTimezone: string | undefined): Array<{ value: string; label: string }> {
	const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
	const zones = new Set<string>(["UTC", ...(intl.supportedValuesOf?.("timeZone") ?? FALLBACK_TIMEZONES)]);
	if (currentTimezone) zones.add(currentTimezone);
	return [...zones]
		.map((timezone) => ({ value: timezone, label: timezoneLabel(timezone), offset: timezoneOffsetMinutes(timezone) }))
		.sort((a, b) => a.offset - b.offset || a.label.localeCompare(b.label))
		.map(({ value, label }) => ({ value, label }));
}

function timezoneLabel(timezone: string): string {
	const city = timezone === "UTC" ? "UTC" : timezone.split("/").pop()?.replaceAll("_", " ") ?? timezone;
	const region = timezone.includes("/") ? timezone.split("/")[0].replaceAll("_", " ") : undefined;
	const offset = timezoneOffsetLabel(timezone);
	return `${city}${region ? ` (${region})` : ""} — ${offset}`;
}

function timezoneOffsetLabel(timezone: string): string {
	try {
		const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(new Date());
		return parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "UTC") ?? timezone;
	} catch {
		return timezone;
	}
}

function timezoneOffsetMinutes(timezone: string): number {
	const label = timezoneOffsetLabel(timezone);
	const match = /^UTC(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(label);
	if (!match?.groups?.sign) return 0;
	const direction = match.groups.sign === "-" ? -1 : 1;
	return direction * (Number(match.groups.hours) * 60 + Number(match.groups.minutes ?? 0));
}

function ModelDefaultsSettings({
	modelDefaults,
	modelCatalog,
	onChanged,
}: {
	modelDefaults?: ModelDefaults;
	modelCatalog?: ModelCatalog;
	onChanged: (value: ModelDefaults) => void;
}) {
	const [draft, setDraft] = useState<ModelDefaults>(modelDefaults ?? {});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setDraft(modelDefaults ?? {});
	}, [modelDefaults]);

	const save = async (next: ModelDefaults) => {
		setDraft(next);
		setSaving(true);
		try {
			const saved = await patchModelDefaults(next);
			onChanged(saved);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="grid gap-3 border-t border-slate-800 pt-3">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Runtime Model Defaults</div>
			<AgentRuntimeOptions
				title="Main Agent"
				modelTitle="Main Agent Default"
				model={draft.main}
				thinking={draft.mainThinking}
				fast={draft.mainFast ?? false}
				modelCatalog={modelCatalog}
				readOnly={saving}
				modelHint="Unset to use provider fallback."
				configuredProvidersOnly
				onModelChange={(main) => void save({ ...draft, main })}
				onThinkingChange={(mainThinking) => void save({ ...draft, mainThinking })}
				onFastChange={(mainFast) => void save({ ...draft, mainFast })}
			/>
			<AgentRuntimeOptions
				title="Subagent"
				modelTitle="Subagent Default"
				model={draft.subagent}
				thinking={draft.subagentThinking}
				fast={draft.subagentFast ?? false}
				modelCatalog={modelCatalog}
				readOnly={saving}
				modelHint="Unset to use provider fallback."
				configuredProvidersOnly
				onModelChange={(subagent) => void save({ ...draft, subagent })}
				onThinkingChange={(subagentThinking) => void save({ ...draft, subagentThinking })}
				onFastChange={(subagentFast) => void save({ ...draft, subagentFast })}
			/>
			{error ? <div className="text-xs text-amber-100">{error}</div> : null}
		</div>
	);
}

function AgentRuntimeOptions({
	title,
	modelTitle,
	model,
	thinking,
	fast,
	modelCatalog,
	readOnly,
	modelHint,
	configuredProvidersOnly = false,
	onModelChange,
	onThinkingChange,
	onFastChange,
}: {
	title: string;
	modelTitle: string;
	model?: ModelProfile;
	thinking?: ThinkingLevel;
	fast?: boolean;
	modelCatalog?: ModelCatalog;
	readOnly: boolean;
	modelHint?: string;
	configuredProvidersOnly?: boolean;
	onModelChange: (value: ModelProfile | undefined) => void;
	onThinkingChange: (value: ThinkingLevel | undefined) => void;
	onFastChange: (value: boolean) => void;
}) {
	return (
		<div className="grid gap-2 border border-slate-800 rounded-sm p-3">
			<div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
			<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_auto] lg:items-start">
				<ModelSelector
					title={modelTitle}
					catalog={modelCatalog}
					value={model}
					allowUnset
					readOnly={readOnly}
					hint={modelHint}
					emptyProviderLabel="Default"
					configuredProvidersOnly={configuredProvidersOnly}
					onChange={onModelChange}
				/>
				<ThinkingLevelSelector
					title="Thinking"
					value={thinking}
					readOnly={readOnly}
					reserveHintSpace
					onChange={onThinkingChange}
				/>
				<div className="grid gap-2 pb-1">
					<div className="text-[11px] uppercase tracking-wider text-slate-500">Fast</div>
					<div className="h-4" aria-hidden="true" />
					<button
						type="button"
						disabled={readOnly}
						onClick={() => onFastChange(!fast)}
						className="inline-flex h-9 w-fit items-center gap-2 text-left text-sm text-slate-300 hover:text-slate-100 disabled:opacity-60"
					>
						<SelectionCheckbox checked={fast === true} disabled={readOnly} />
						<span>{fast ? "Fast on" : "Fast off"}</span>
					</button>
				</div>
			</div>
		</div>
	);
}

function ThinkingLevelSelector({
	title,
	value,
	readOnly,
	hint,
	reserveHintSpace = false,
	onChange,
}: {
	title: string;
	value?: ThinkingLevel;
	readOnly: boolean;
	hint?: string;
	reserveHintSpace?: boolean;
	onChange: (value: ThinkingLevel | undefined) => void;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
				<button
					type="button"
					disabled={readOnly || !value}
					onClick={() => onChange(undefined)}
					className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-50"
				>
					Unset
				</button>
			</div>
			{hint ? <div className="text-xs text-slate-500">{hint}</div> : reserveHintSpace ? <div className="h-4" aria-hidden="true" /> : null}
			<select
				value={value ?? ""}
				disabled={readOnly}
				onChange={(event) => onChange(event.target.value ? (event.target.value as ThinkingLevel) : undefined)}
				className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
			>
				<option value="">Default</option>
				{THINKING_LEVELS.map((level) => (
					<option key={level} value={level}>{level}</option>
				))}
			</select>
		</div>
	);
}

function ModelSelector({
	title,
	catalog,
	value,
	allowUnset,
	readOnly,
	hint,
	emptyProviderLabel = "Select provider",
	configuredProvidersOnly = false,
	onChange,
}: {
	title: string;
	catalog?: ModelCatalog;
	value?: ModelProfile;
	allowUnset: boolean;
	readOnly: boolean;
	hint?: string;
	emptyProviderLabel?: string;
	configuredProvidersOnly?: boolean;
	onChange: (value: ModelProfile | undefined) => void;
}) {
	const [providerId, setProviderId] = useState(value?.provider ?? "");
	const [modelId, setModelId] = useState(value?.id ?? "");
	const catalogProviders = catalog?.providers ?? [];
	const providers = catalogProviders.filter((provider) => !configuredProvidersOnly || provider.authConfigured);
	const selectedProvider = providers.find((provider) => provider.id === providerId);
	const unconfiguredSelectedProvider = configuredProvidersOnly
		? catalogProviders.find((provider) => provider.id === providerId && !provider.authConfigured)
		: undefined;
	const hasStaleProvider = Boolean(providerId) && !selectedProvider;
	const staleProviderLabel = hasStaleProvider
		? unconfiguredSelectedProvider
			? `${unconfiguredSelectedProvider.label} (not configured)`
			: `${providerId} (unknown provider)`
		: "";
	const selectedModel = selectedProvider?.models.find((model) => model.id === modelId);
	const hasStaleModel = Boolean(providerId && modelId && selectedProvider && !selectedModel);
	const providerModels = selectedProvider?.models ?? [];
	const providerAuthConfigured = selectedProvider?.authConfigured;

	useEffect(() => {
		setProviderId(value?.provider ?? "");
		setModelId(value?.id ?? "");
	}, [value?.id, value?.provider]);

	return (
		<div className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<div className="text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
				{allowUnset ? (
					<button
						type="button"
						disabled={readOnly || (!providerId && !modelId)}
						onClick={() => {
							setProviderId("");
							setModelId("");
							onChange(undefined);
						}}
						className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 disabled:opacity-50"
					>
						Unset
					</button>
				) : null}
			</div>
			{hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
			{providers.length === 0 ? (
				<div className="text-xs text-slate-500 border border-dashed border-slate-700 rounded-sm p-3">
					{catalogProviders.length === 0
						? "Model catalog unavailable."
						: "No configured providers. Configure a provider under Settings > Providers."}
				</div>
			) : null}
			<div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-2">
				<select
					value={providerId}
					disabled={readOnly}
					onChange={(event) => {
						const nextProviderId = event.target.value;
						setProviderId(nextProviderId);
						setModelId("");
					}}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					<option value="">{emptyProviderLabel}</option>
					{providers.map((provider) => (
						<option key={provider.id} value={provider.id}>
							{provider.label}
						</option>
					))}
					{hasStaleProvider ? <option value={providerId}>{staleProviderLabel}</option> : null}
				</select>
				<select
					value={modelId}
					disabled={readOnly}
					onChange={(event) => {
						const nextModelId = event.target.value;
						setModelId(nextModelId);
						if (providerId && nextModelId) onChange({ provider: providerId, id: nextModelId });
					}}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
				>
					<option value="">{providerId ? "Select model" : "Select provider first"}</option>
					{providerModels.map((model) => (
						<option key={model.id} value={model.id}>
							{model.label}
						</option>
					))}
					{hasStaleModel ? <option value={modelId}>{`${modelId} (unknown model)`}</option> : null}
				</select>
			</div>
			{providerId ? (
				<div className="text-xs text-slate-500">
					{hasStaleProvider
						? unconfiguredSelectedProvider
							? "Stored provider is no longer configured."
							: "Stored provider is no longer present in the catalog."
						: providerAuthConfigured
							? "Provider auth configured."
							: "Provider auth missing."}
				</div>
			) : null}
			{hasStaleModel ? <div className="text-xs text-amber-100">Stored model is no longer present in the catalog.</div> : null}
		</div>
	);
}

function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
}

function PiPackagesSettings({
	packages,
	onPackageChanged,
	onPackageRemoved,
}: {
	packages?: PiPackageCatalogItem[];
	onPackageChanged: (pkg: PiPackageCatalogItem) => void;
	onPackageRemoved: (pkg: PiPackageCatalogItem) => void;
}) {
	const [source, setSource] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const packageList = packages ?? [];
	const installedCount = packageList.filter((pkg) => pkg.installStatus === "installed").length;
	const enabledCount = packageList.filter((pkg) => pkg.enabled).length;

	const addPackage = async () => {
		if (busy) return;
		setBusy("add");
		try {
			const pkg = await postPiPackage(source);
			onPackageChanged(pkg);
			setSource("");
			setExpanded((current) => new Set(current).add(pkg.id));
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const toggleEnabled = async (pkg: PiPackageCatalogItem) => {
		if (busy) return;
		setBusy(`${pkg.id}:enabled`);
		try {
			const next = await patchPiPackage(pkg.id, { enabled: !pkg.enabled });
			onPackageChanged(next);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const unregisterPackage = async (pkg: PiPackageCatalogItem) => {
		if (busy) return;
		if (!window.confirm(`Unregister Pi package "${pkg.name}"?`)) return;
		setBusy(`${pkg.id}:delete`);
		try {
			const removed = await deletePiPackage(pkg.id);
			onPackageRemoved(removed);
			setExpanded((current) => {
				const next = new Set(current);
				next.delete(pkg.id);
				return next;
			});
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const toggleExpanded = (id: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<DesignerPanel title="Pi Package Management">
			<div className="grid gap-2">
				<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
					<input
						value={source}
						disabled={!packages || busy === "add"}
						onChange={(event) => setSource(event.target.value)}
						className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] disabled:opacity-60"
						placeholder="https://pi.dev/packages/package-name"
					/>
					<button type="button" disabled={!packages || busy === "add" || !source.trim()} onClick={() => void addPackage()} title="Add Pi Package" aria-label="Add Pi Package" className="h-9 w-9 inline-flex items-center justify-center border border-[#11a4d4] rounded-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50">
						<Plus size={14} />
					</button>
				</div>
				<div className="text-[11px] text-slate-500">Extensions execute code in the Pi runtime. Review package source before adding it.</div>
				{error ? <div className="border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{error}</div> : null}
				<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
					{packageList.length} registered / {installedCount} installed / {enabledCount} enabled
				</div>
			</div>
			{packages ? (
				packageList.length ? (
					<div className="grid gap-2">
						{packageList.map((pkg) => (
							<PiPackageManagementCard
								key={pkg.id}
								pkg={pkg}
								expanded={expanded.has(pkg.id)}
								busy={busy?.startsWith(`${pkg.id}:`) ?? false}
								onToggleExpanded={() => toggleExpanded(pkg.id)}
								onToggleEnabled={() => void toggleEnabled(pkg)}
								onUnregister={() => void unregisterPackage(pkg)}
							/>
						))}
					</div>
				) : <EmptyCatalog message="No Pi packages registered" />
			) : <EmptyCatalog />}
		</DesignerPanel>
	);
}

function UserSkillsSettings({
	skills,
	onSkillChanged,
	onSkillRemoved,
}: {
	skills?: UserSkill[];
	onSkillChanged: (skill: UserSkill) => void;
	onSkillRemoved: (skillId: string) => void;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [installOpen, setInstallOpen] = useState(false);
	const [editSkill, setEditSkill] = useState<UserSkill | null>(null);
	const [editMarkdown, setEditMarkdown] = useState<string>("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const skillList = skills ?? [];
	const enabledCount = skillList.filter((s) => s.enabled).length;

	const toggleEnabled = async (skill: UserSkill) => {
		if (busy) return;
		setBusy(`${skill.id}:enabled`);
		try {
			const next = await updateUserSkill(skill.id, { enabled: !skill.enabled });
			onSkillChanged(next);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const removeSkill = async (skill: UserSkill) => {
		if (busy) return;
		if (!window.confirm(`Delete skill "${skill.name}"?`)) return;
		setBusy(`${skill.id}:delete`);
		try {
			await deleteUserSkill(skill.id);
			onSkillRemoved(skill.id);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleCreate = async (input: { name: string; description: string; markdown: string }) => {
		setBusy("create");
		try {
			const skill = await createUserSkill(input);
			onSkillChanged(skill);
			setCreateOpen(false);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleInstall = async (url: string) => {
		setBusy("install");
		try {
			const skill = await installUserSkill(url);
			onSkillChanged(skill);
			setInstallOpen(false);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	const handleEdit = async (id: string, input: { name: string; description: string; markdown: string }) => {
		setBusy("edit");
		try {
			const skill = await updateUserSkill(id, input);
			onSkillChanged(skill);
			setEditSkill(null);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<DesignerPanel title="Skill Management">
				<div className="grid gap-2">
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							disabled={busy === "create"}
							onClick={() => setCreateOpen(true)}
							className="inline-flex items-center gap-2 border border-[#11a4d4] rounded-sm px-3 py-2 text-sm text-[#11a4d4] bg-[#11a4d4]/10 disabled:opacity-50"
						>
							<Plus size={14} />
							Create Skill
						</button>
						<button
							type="button"
							disabled={busy === "install"}
							onClick={() => setInstallOpen(true)}
							className="inline-flex items-center gap-2 border border-slate-700 rounded-sm px-3 py-2 text-sm text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
						>
							<ExternalLink size={14} />
							Install from URL
						</button>
					</div>
					{error ? <div className="border border-red-500/60 bg-red-500/10 text-red-200 px-3 py-2 text-sm rounded-sm">{error}</div> : null}
					<div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
						{skillList.length} skills / {enabledCount} enabled
					</div>
				</div>
				{skills ? (
					skillList.length ? (
						<div className="grid gap-2">
							{skillList.map((skill) => (
								<div key={skill.id} className={`border rounded-sm p-2 ${skill.enabled ? "border-slate-800 bg-[#151f24]" : "border-slate-800 bg-[#151f24] opacity-75"}`}>
									<div className="flex items-center justify-between gap-2 max-[640px]:items-start">
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 flex-wrap items-center gap-2">
												<span className="min-w-0 truncate text-sm text-slate-200">{skill.name}</span>
												<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${skill.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{skill.enabled ? "enabled" : "disabled"}</span>
												<span className="shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider border-slate-700 text-slate-500">{skill.source}</span>
											</div>
											<div className="truncate text-xs text-slate-500">{skill.description || skill.path}</div>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={() => void toggleEnabled(skill)}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
											>
												{skill.enabled ? <PowerOff size={13} /> : <Power size={13} />}
											</button>
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={async () => {
														try {
															const data = await getUserSkill(skill.id);
															setEditSkill(skill);
															setEditMarkdown(data.markdown);
														} catch {
															setEditSkill(skill);
															setEditMarkdown("");
														}
													}}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50"
											>
												<Edit3 size={13} />
											</button>
											<button
												type="button"
												disabled={busy?.startsWith(`${skill.id}:`) ?? false}
												onClick={() => void removeSkill(skill)}
												className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
											>
												<Trash2 size={13} />
											</button>
										</div>
									</div>
								</div>
							))}
						</div>
					) : <EmptyCatalog message="No user skills" />
				) : <EmptyCatalog />}
			</DesignerPanel>
			{createOpen ? (
				<SkillEditModal
					title="Create Skill"
					onSave={handleCreate}
					onClose={() => setCreateOpen(false)}
					busy={busy === "create"}
				/>
			) : null}
			{installOpen ? (
				<SkillInstallModal
					onInstall={handleInstall}
					onClose={() => setInstallOpen(false)}
					busy={busy === "install"}
				/>
			) : null}
			{editSkill ? (
				<SkillEditModal
					title="Edit Skill"
					initialName={editSkill.name}
					initialDescription={editSkill.description}
					initialMarkdown={editMarkdown}
					onSave={(input) => void handleEdit(editSkill.id, input)}
					onClose={() => setEditSkill(null)}
					busy={busy === "edit"}
				/>
			) : null}
		</>
	);
}

function SkillEditModal({
	title,
	initialName = "",
	initialDescription = "",
	initialMarkdown = "",
	onSave,
	onClose,
	busy,
}: {
	title: string;
	initialName?: string;
	initialDescription?: string;
	initialMarkdown?: string;
	onSave: (input: { name: string; description: string; markdown: string }) => void;
	onClose: () => void;
	busy: boolean;
}) {
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription);
	const [markdown, setMarkdown] = useState(initialMarkdown);

	return (
		<Modal onClose={onClose}>
			<h2 className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-bold uppercase tracking-wider">
				<Edit3 size={16} />
				{title}
			</h2>
			<div className="grid gap-3 p-4">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Skill name (kebab-case)"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Short description"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<textarea
					value={markdown}
					onChange={(e) => setMarkdown(e.target.value)}
					placeholder="Markdown instructions..."
					rows={10}
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4] resize-vertical"
				/>
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="px-3 py-2 text-sm border border-slate-700 rounded-sm hover:border-slate-500">Cancel</button>
					<button
						type="button"
						disabled={busy || !name.trim()}
						onClick={() => onSave({ name, description, markdown })}
						className="px-3 py-2 text-sm border border-[#11a4d4] rounded-sm bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50"
					>
						{busy ? "Saving..." : "Save"}
					</button>
				</div>
			</div>
		</Modal>
	);
}

function SkillInstallModal({
	onInstall,
	onClose,
	busy,
}: {
	onInstall: (url: string) => void;
	onClose: () => void;
	busy: boolean;
}) {
	const [url, setUrl] = useState("");

	return (
		<Modal onClose={onClose}>
			<h2 className="flex items-center gap-2 border-b border-slate-800 px-4 py-3 text-sm font-bold uppercase tracking-wider">
				<ExternalLink size={16} />
				Install Skill
			</h2>
			<div className="grid gap-3 p-4">
				<input
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://skills.sh/owner/skills/skill-name"
					className="min-w-0 bg-[#0e1116] border border-slate-700 rounded-sm px-3 py-2 text-sm outline-none focus:border-[#11a4d4]"
				/>
				<div className="text-[11px] text-slate-500">
					Supports skills.sh URLs, GitHub tree URLs, or owner/repo shorthand.
				</div>
				<div className="flex justify-end gap-2">
					<button type="button" onClick={onClose} className="px-3 py-2 text-sm border border-slate-700 rounded-sm hover:border-slate-500">Cancel</button>
					<button
						type="button"
						disabled={busy || !url.trim()}
						onClick={() => onInstall(url)}
						className="px-3 py-2 text-sm border border-[#11a4d4] rounded-sm bg-[#11a4d4]/10 text-[#11a4d4] disabled:opacity-50"
					>
						{busy ? "Installing..." : "Install"}
					</button>
				</div>
			</div>
		</Modal>
	);
}

function PiPackageManagementCard({
	pkg,
	expanded,
	busy,
	onToggleExpanded,
	onToggleEnabled,
	onUnregister,
}: {
	pkg: PiPackageCatalogItem;
	expanded: boolean;
	busy: boolean;
	onToggleExpanded: () => void;
	onToggleEnabled: () => void;
	onUnregister: () => void;
}) {
	const hasErrors = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error");
	return (
		<div className={`border rounded-sm ${pkg.enabled ? "border-slate-800 bg-[#151f24]" : "border-slate-800 bg-[#151f24] opacity-75"}`}>
			<div className="grid grid-cols-[1fr_auto] gap-2 p-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="min-w-0 truncate text-sm text-slate-200">{pkg.name}</span>
						<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.enabled ? "border-[#11a4d4]/60 text-[#7dd3fc]" : "border-slate-700 text-slate-500"}`}>{pkg.enabled ? "enabled" : "disabled"}</span>
						<span className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${pkg.installStatus === "installed" ? "border-[#0bda57]/50 text-green-300" : "border-[#f59e0b]/50 text-amber-100"}`}>{pkg.installStatus}</span>
					</div>
					<div className="truncate text-xs text-slate-500">{pkg.description ?? pkg.source}</div>
					<div className={`font-mono text-[10px] mt-1 ${hasErrors ? "text-[#f59e0b]" : "text-[#11a4d4]"}`}>{piPackageMeta(pkg)}</div>
				</div>
				<div className="flex items-start gap-1">
					<button type="button" onClick={onToggleExpanded} title={expanded ? "Hide Details" : "Show Details"} aria-label={expanded ? "Hide Details" : "Show Details"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]">
						{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>
					<button type="button" disabled={busy} onClick={onToggleEnabled} title={pkg.enabled ? "Disable Package" : "Enable Package"} aria-label={pkg.enabled ? "Disable Package" : "Enable Package"} className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
						{pkg.enabled ? <PowerOff size={13} /> : <Power size={13} />}
					</button>
					<button type="button" disabled={busy} onClick={onUnregister} title="Unregister Package" aria-label="Unregister Package" className="h-7 w-7 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 hover:border-red-400 hover:text-red-300 disabled:opacity-50">
						<Trash2 size={13} />
					</button>
				</div>
			</div>
			{expanded ? <PiPackageDetails pkg={pkg} /> : null}
		</div>
	);
}

type RawEvent = PiboSessionTraceView["rawEvents"][number];
type CompactRawEvent = RawEvent & { count: number };
type LiveTraceOverlay = {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
};

type ChatStreamEventMeta = {
	piboSessionId?: string;
	streamFrameId?: string;
	streamId?: number;
	streamFrameIndex?: number;
};

type ChatStreamEvent = ChatStreamEventMeta & (
	| { type: "ready"; piboSessionId: string }
	| { type: "RUN_STARTED"; runId: string; input?: { text?: string; source?: string } }
	| { type: "RUN_FINISHED"; runId: string }
	| { type: "RUN_ERROR"; runId?: string; message: string; errorDetails?: unknown }
	| { type: "TEXT_MESSAGE_START"; messageId: string; runId?: string; role: "assistant" }
	| { type: "TEXT_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "TEXT_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "REASONING_MESSAGE_START"; messageId: string; runId?: string }
	| { type: "REASONING_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "REASONING_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "TOOL_CALL_START"; toolCallId: string; toolName: string; args?: unknown; runId?: string }
	| { type: "TOOL_CALL_ARGS"; toolCallId: string; toolName?: string; args: unknown; argsComplete: boolean; runId?: string; partialResult?: unknown; sourceEventType?: "tool_call" | "tool_execution_updated" }
	| { type: "TOOL_CALL_RESULT"; toolCallId: string; toolName?: string; result: unknown; isError: boolean; runId?: string }
	| { type: "AGENT_DELEGATION"; toolCallId?: string; toolName: string; subagentName: string; childPiboSessionId: string; threadKey?: string }
	| { type: "EXECUTION_RESULT"; runId?: string; eventId?: string; action: string; result: unknown }
	| { type: "RAW_EVENT"; event: { type: string; [key: string]: unknown } }
);

function chatStreamEvent(message: MessageEvent): ChatStreamEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		if (typeof parsed.type !== "string") return undefined;
		const streamFrame = message.lastEventId ? parseTraceStreamFrameId(message.lastEventId) : undefined;
		return {
			...(parsed as ChatStreamEvent),
			...(message.lastEventId ? { streamFrameId: message.lastEventId } : {}),
			...(streamFrame ? { streamId: streamFrame.streamId, streamFrameIndex: streamFrame.frameIndex } : {}),
		};
	} catch {
		return undefined;
	}
}

function eventTraceRefreshDelay(event: ChatStreamEvent): number | undefined {
	if (
		event.type === "RUN_FINISHED" ||
		event.type === "TEXT_MESSAGE_END"
	) {
		return 300;
	}
	if (event.type === "RUN_ERROR") {
		return 0;
	}
	return undefined;
}

function eventShouldRefreshNavigation(event: ChatStreamEvent): boolean {
	return event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
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

function findAgentProfile(profiles: BootstrapData["agents"], name: string): BootstrapData["agents"][number] | undefined {
	return profiles.find((profile) => profile.name === name || profile.aliases.includes(name));
}

function profileExists(profiles: BootstrapData["agents"], name: string): boolean {
	return Boolean(findAgentProfile(profiles, name));
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

function readStoredComposerDraft(piboSessionId: string): string {
	try {
		return localStorage.getItem(COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId) ?? "";
	} catch {
		return "";
	}
}

function writeStoredComposerDraft(piboSessionId: string, text: string): void {
	try {
		const key = COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId;
		if (text) {
			localStorage.setItem(key, text);
		} else {
			localStorage.removeItem(key);
		}
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredComposerHistory(): string[] {
	try {
		const raw = localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.slice(-COMPOSER_HISTORY_LIMIT);
	} catch {
		return [];
	}
}

function appendStoredComposerHistory(text: string): void {
	const entry = text.trim();
	if (!entry) return;
	const entries = readStoredComposerHistory();
	if (entries.at(-1) === entry) return;
	try {
		localStorage.setItem(COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify([...entries, entry].slice(-COMPOSER_HISTORY_LIMIT)));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredSessionView(): ChatSessionViewId {
	try {
		const stored = localStorage.getItem(SESSION_VIEW_STORAGE_KEY);
		return stored === "terminal" ? "terminal" : DEFAULT_CHAT_SESSION_VIEW_ID;
	} catch {
		return DEFAULT_CHAT_SESSION_VIEW_ID;
	}
}

function writeStoredSessionView(viewId: ChatSessionViewId): void {
	try {
		localStorage.setItem(SESSION_VIEW_STORAGE_KEY, viewId);
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

function annotateLiveTraceForkEntryIds(liveNodes: PiboTraceNode[], persistedNodes: readonly PiboTraceNode[]): void {
	const persistedUserMessages = flattenPiboTraceNodes(persistedNodes)
		.filter((node) => node.type === "user.message" && node.entryId)
		.map((node) => ({ entryId: node.entryId!, text: traceNodeText(node) }));
	if (!persistedUserMessages.length) return;
	const used = new Set<string>();
	for (const node of flattenPiboTraceNodes(liveNodes)) {
		if (node.type !== "user.message" || node.entryId) continue;
		const text = traceNodeText(node);
		const match = persistedUserMessages.find((candidate) => !used.has(candidate.entryId) && candidate.text === text);
		if (!match) continue;
		node.entryId = match.entryId;
		used.add(match.entryId);
	}
}

function flattenPiboTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const visit = (items: readonly PiboTraceNode[]) => {
		for (const item of items) {
			flattened.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return flattened;
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}

type SignalSessionUpdate = { status?: PiboWebSessionNode["status"]; updatedAt?: string };

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
	const status = update?.status;
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
			const derivedStatusChanged = Boolean(derivedUpdate?.status && derivedUpdate.status !== derived.status);
			return {
				...derived,
				status: derivedUpdate?.status ?? derived.status,
				lastActivityAt: derivedStatusChanged
					? latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt, new Date().toISOString())
					: latestIsoTimestamp(derived.lastActivityAt, derivedUpdate?.updatedAt),
			};
		}),
	};
}

function signalSessionUpdate(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): SignalSessionUpdate | undefined {
	const status = signalLegacyStatus(snapshot);
	if (!snapshot && !status) return undefined;
	return { status, updatedAt: snapshot?.updatedAt };
}

function signalLegacyStatus(snapshot: PiboSignalSnapshot["sessions"][string] | undefined): PiboWebSessionNode["status"] | undefined {
	if (!snapshot) return undefined;
	if (snapshot.hasError || snapshot.hasErrorDescendant || snapshot.aggregateStatus === "error") return "error";
	if (snapshot.isTreeActive) return "running";
	return "idle";
}

function liveSessionStatusFromEvent(event: ChatStreamEvent): PiboWebSessionNode["status"] | undefined {
	if (event.type === "RUN_ERROR") return "error";
	if (event.type === "RUN_FINISHED" || event.type === "TEXT_MESSAGE_END") return "idle";
	if (
		event.type === "RUN_STARTED" ||
		event.type === "TEXT_MESSAGE_START" ||
		event.type === "TEXT_MESSAGE_CONTENT" ||
		event.type === "REASONING_MESSAGE_START" ||
		event.type === "REASONING_MESSAGE_CONTENT" ||
		event.type === "TOOL_CALL_START" ||
		event.type === "TOOL_CALL_ARGS" ||
		event.type === "AGENT_DELEGATION"
	) {
		return "running";
	}
	return undefined;
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
