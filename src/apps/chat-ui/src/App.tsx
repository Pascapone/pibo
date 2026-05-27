import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import {
	AlertTriangle,
	BookA,
	BookOpenText,
	Brain,
	Bug,
	ChevronsDown,
	ChevronsUp,
	Copy,
	EyeOff,
	Layers,
	LogOut,
	List,
	Menu,
	Plus,
	RefreshCw,
	Rows3,
	Server,
	SendHorizontal,
	Trash2,
	UserRound,
	Wrench,
	X,
} from "lucide-react";
import { signInWithGoogle, signOut } from "./api-auth";
import { deleteProject, deleteRoom, deleteSession, getBootstrap, getNavigation, getProjectsBootstrap, getSessionPage, markRoomRead, markSessionRead, patchProject, patchProjectSession, patchRoom, patchSession, postAction, postMessage, postProject, postProjectMessage, postProjectSession, postRoom, postSession } from "./api-chat-sessions";
import { downloadChatFile, uploadChatFiles, type ChatUploadedFile } from "./api-chat-files";
import { fetchSignalTree, getTrace, getTraceSummary, subscribeSignalTree } from "./api-trace-signals";
import { createWebAnnotationBinding, injectWebAnnotationBinding, listWebAnnotations, listWebAnnotationTargets, patchWebAnnotation, type WebAnnotationBindingResponse, type WebAnnotationMessageAttachment, type WebAnnotationOverlayConfig, type WebAnnotationTargetSummary } from "./api-web-annotations";
import { listUserSkills } from "./api-agent-designer";
import { getWorkflowVersionPicker, postProjectWorkflowSession, postProjectWorkflowSessionStart, type WorkflowVersionPickerOption } from "./api-workflows";
import { THINKING_LEVELS } from "./types";
import type { AgentCatalog, BootstrapData, ModelProfile, NavigationData, PiboProject, PiboProjectSession, ProjectsBootstrapData, PiboRoom, PiboSession, PiboSessionTraceSummary, PiboSessionTraceView, PiboSignalPatch, PiboSignalSnapshot, PiboTraceNode, PiboTraceOrderKey, PiboWebSessionNode, PiboWebSessionStatus, ThinkingLevel, UserSkill, WorkflowLifecycleEventRecord } from "./types";
import type { ChatWebStoredEvent } from "../../../shared/trace-types.js";
import { collectBackendNodes, isTraceSnapshotCollectionEnabled } from "./tracing/snapshotCollector";
import { type SessionBreadcrumbItem, type SessionDerivationLink, type SessionOriginLink } from "./tracing/TraceTimeline";
import { JsonRenderer } from "./tracing/JsonRenderer";
import { compactRawEvents } from "./tracing/raw-events";
import {
	annotateLiveTraceForkEntryIds,
	collectPersistedUserMessageIndex,
	isUserMessageQueuedEvent,
	overlayIncludesOptimisticUserMessage,
	reconcileOptimisticUserMessages,
} from "./tracing/optimistic-user-messages";
import { countRender } from "./renderMetrics";
import { patchTraceViewWithEvents } from "../../../shared/trace-engine.js";
import { applyTraceLiveEvents } from "./traceLiveReducer";
import {
	chatStreamEvent,
	consumeFirstLiveContentFlush,
	eventShouldRefreshNavigation,
	eventTraceRefreshDelay,
	eventUpdatesLiveOverlay,
	liveSessionStatusFromEvent,
	recordEventLiveCursor,
	recordTraceLiveCursor,
	resetLiveContentFlushTracking,
	traceStreamCursorAfterStream,
	type ChatStreamEvent,
	type LiveStreamCursor,
} from "./tracing/chat-stream-events";
import { ContextFilesView } from "./context/ContextFilesView";
import { BasePromptView } from "./context/BasePromptView";
import { CompactionPromptView } from "./context/CompactionPromptView";
import { PiboToolsView } from "./context/PiboToolsView";
import { McpToolsView } from "./context/McpToolsView";
import { ContextBuildView } from "./context/ContextBuildView";
import { CronArea } from "./CronArea";
import { RalphArea } from "./RalphArea";
import { WorkflowsArea } from "./WorkflowsArea";
import type { PiPackageCatalogItem } from "./agents/agent-designer-model";
import { AgentsView } from "./agents/AgentsView";
import { copyTextToClipboard } from "./clipboard";
import { SessionSidebar } from "./session-sidebar";
import { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import type { ChatSessionViewId } from "./session-views/types";
import {
	appendStoredComposerHistory,
	clearStoredSelection,
	readStoredComposerDraft,
	readStoredComposerHistory,
	readStoredSelection,
	readStoredSessionView,
	removeStoredRoomSelection,
	writeStoredComposerDraft,
	writeStoredSelection,
	writeStoredSessionView,
} from "./app-storage";
import {
	parseStoredWebAnnotationOverlayState,
	parseWebAnnotationOverlayState,
	readStoredSelectedWebAnnotationIds,
	readStoredWebAnnotationOverlayState,
	readStoredWebAnnotationsCdpUrl,
	readStoredWebAnnotationToggleShortcut,
	readStoredWebAnnotationsPanelCollapsed,
	storedWebAnnotationOverlayStateKey,
	writeStoredSelectedWebAnnotationIds,
	writeStoredWebAnnotationsCdpUrl,
	writeStoredWebAnnotationsPanelCollapsed,
	type WebAnnotationOverlayPanelState,
} from "./web-annotation-storage";
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
import {
	isStreamingDebugEnabled,
	recordStreamingDebugEnqueue,
	recordStreamingDebugFlush,
	recordStreamingDebugLiveError,
	recordStreamingDebugLiveOpen,
	recordStreamingDebugLiveTraceCompute,
	recordStreamingDebugStreamEvent,
	recordStreamingDebugTraceRefreshEnd,
	recordStreamingDebugTraceRefreshScheduled,
	recordStreamingDebugTraceRefreshStart,
	recordStreamingDebugTraceState,
	shouldDropStreamingBenchmarkOverlayEvent,
} from "./streamingDebug";
import {
	countUnreadRooms,
	findRoomById,
	isArchivedRoom,
	limitSessionNodesForSidebar,
	nextRecentSessionSignalExpiryMs,
	sessionNodeTitle,
	splitSessionNodesByArchive,
} from "./session-sidebar-helpers";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SettingsView } from "./settings/SettingsView";
import type { SettingsPanel } from "./settings/types";
import { ProjectsSidebar } from "./projects/ProjectsSidebar";
import {
	ConfiguredWorkflowStartPanel,
	ProjectWorkflowSessionCreatePanel,
	workflowDiagnosticsFromError,
	workflowVersionOptionKey,
	type WorkflowUiDiagnostic,
} from "./projects/ProjectWorkflowPanels";
import {
	createMissingWorkflowVersionDiagnostics,
	createProjectsTraceBootstrap,
	findSelectedProjectSession,
	findSelectedWorkflowVersionOption,
	listWorkflowProjectSessions,
	splitProjectsByArchive,
	workflowStartAcceptedMessage,
	workflowStartBlockedMessage,
} from "./projects/ProjectsAreaModel";
import {
	PROJECT_SESSION_VIEW_ALLOWED_IDS,
	WorkflowHeaderMeta,
	createWorkflowHeaderSummary,
	isConfiguredWorkflowSessionPending,
	isWorkflowBackedProjectSession,
	resolveProjectSessionViewRouting,
} from "./projects/project-session-workflow";

type Area = "sessions" | "projects" | "workflows" | "cron" | "ralph" | "agents" | "context" | "settings";
type ContextPanel = "context-files" | "base-prompt" | "compaction-prompt" | "pibo-tools" | "mcp-tools" | "build-context";
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

const SESSION_DELETE_CONFIRM_TEXT = "Delete this session";
const LIVE_STREAM_RECONNECT_BASE_DELAY_MS = 500;
const LIVE_STREAM_RECONNECT_MAX_DELAY_MS = 10_000;
const LIVE_STREAM_STALE_MS = 45_000;
const HIDDEN_STREAM_FLUSH_DELAY_MS = 100;
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
				const selected = findSelectedWorkflowVersionOption(picker.options, picker.selectedWorkflowId, picker.selectedWorkflowVersion);
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
	const selectedProjectSession = findSelectedProjectSession(projectSessions, selectedPiboSessionId);
	const workflowProjectSessions = listWorkflowProjectSessions(projectSessions);
	const projectGroups = splitProjectsByArchive(data?.projects);
	const activeProjects = projectGroups.active;
	const archivedProjects = projectGroups.archived;
	const sessionGroups = useMemo(() => data ? splitSessionNodesByArchive(data.sessions, showArchivedSessions) : { active: [], archived: [] }, [data, showArchivedSessions]);
	const selectedSessionPathIds = useMemo(() => selectedPiboSessionId && data ? new Set(findSessionPath(data.sessions, selectedPiboSessionId).map((node) => node.piboSessionId)) : EMPTY_SESSION_PATH_IDS, [data, selectedPiboSessionId]);
	const traceBootstrap = useMemo(() => createProjectsTraceBootstrap(baseBootstrap, data), [baseBootstrap, data]);
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
			const diagnostics = createMissingWorkflowVersionDiagnostics();
			setWorkflowCreateDiagnostics(diagnostics);
			onError(diagnostics[0]?.message ?? "Select a workflow version before creating the Project session.");
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
			const message = workflowStartAcceptedMessage(response.projectSession.workflowRunId);
			setWorkflowStartMessages((current) => ({ ...current, [projectSession.piboSessionId]: message }));
			onError(null);
			await load({ projectId: selectedProject.id, piboSessionId: projectSession.piboSessionId });
		} catch (caught) {
			const diagnostics = workflowDiagnosticsFromError(caught);
			if (diagnostics.length) {
				setWorkflowStartMessages((current) => ({
					...current,
					[projectSession.piboSessionId]: workflowStartBlockedMessage(diagnostics),
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
			<ProjectsSidebar
				data={data!}
				selectedProject={selectedProject}
				selectedPiboSessionId={selectedPiboSessionId}
				selectedProjectSession={selectedProjectSession}
				workflowProjectSessions={workflowProjectSessions}
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
				onCreateProject={() => void createProject()}
				onToggleArchivedProjects={() => {
					const next = !showArchivedProjects;
					setShowArchivedProjects(next);
					localStorage.setItem("pibo.chat.projects.showArchivedProjects", String(next));
				}}
				onSelectProject={(projectId) => onNavigate(projectId, undefined)}
				onRenameProject={(project, name) => void renameProject(project, name)}
				onSetProjectArchived={(project, archived) => void setProjectArchived(project, archived)}
				onDeleteArchivedProject={(project) => void deleteArchivedProject(project)}
				onCreateProjectSession={() => void createProjectSession()}
				onToggleArchivedSessions={() => {
					const next = !showArchivedSessions;
					setShowArchivedSessions(next);
					localStorage.setItem("pibo.chat.projects.showArchivedSessions", String(next));
				}}
				onSelectSession={(piboSessionId) => onNavigate(selectedProject?.id, piboSessionId)}
				onRenameSession={(piboSessionId, title) => void renameSession(piboSessionId, title)}
				onArchiveSession={(piboSessionId, archived) => void patchProjectSession(piboSessionId, { archived }).then(() => load({ projectId: selectedProject?.id }))}
				onDeleteSession={(node) => void patchProjectSession(node.piboSessionId, { archived: true }).then(() => load({ projectId: selectedProject?.id }))}
				onViewContext={onViewContext}
				onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
			/>
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

function shortWorkflowTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
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
	onSend: (text: string, webAnnotationIds?: readonly string[], fileAttachmentPaths?: readonly string[], clientTxnId?: string) => Promise<void>;
	onError: (message: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const pendingStreamEventsBySession = useRef(new Map<string, ChatStreamEvent[]>());
	const pendingStreamFrame = useRef<number | undefined>(undefined);
	const pendingStreamTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const firstLiveContentFlushKeysBySession = useRef(new Map<string, Set<string>>());
	const liveEventSeqRef = useRef(0);
	const latestLiveCursorBySession = useRef(new Map<string, LiveStreamCursor>());
	const selectedLiveStreamRef = useRef<SelectedLiveEventStream | null>(null);
	const selectedLiveStreamReconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const selectedLiveStreamReconnectAttempts = useRef(0);
	const [selectedLiveStreamReconnectGeneration, setSelectedLiveStreamReconnectGeneration] = useState(0);
	const [liveTraceOverlay, setLiveTraceOverlay] = useState<LiveTraceOverlay | null>(null);
	const [traceEventLimit, setTraceEventLimit] = useState(DEFAULT_TRACE_EVENTS_PAGE_SIZE);
	const [rawEventLimit, setRawEventLimit] = useState(DEFAULT_RAW_EVENTS_LIMIT);
	const [baseTraceView, setBaseTraceView] = useState<PiboSessionTraceView | null>(null);
	const [selectedWebAnnotationIds, setSelectedWebAnnotationIds] = useState<string[]>([]);
	const [selectedUploadAttachmentsBySession, setSelectedUploadAttachmentsBySession] = useState<Record<string, UploadedChatAttachment[]>>({});
	const [webAnnotationsPanelVisible, setWebAnnotationsPanelVisible] = useState(false);
	const [webAnnotationOverlayState, setWebAnnotationOverlayState] = useState<WebAnnotationOverlayPanelState | null>(() => selectedPiboSessionId ? readStoredWebAnnotationOverlayState(selectedPiboSessionId) : null);
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
	const webAnnotationOverlayInstalled = Boolean(
		selectedPiboSessionId
		&& webAnnotationOverlayState?.piboSessionId === selectedPiboSessionId
		&& webAnnotationOverlayState.installed,
	);
	const webAnnotationsPanelRendered = Boolean(selectedPiboSessionId) && (webAnnotationsPanelVisible || webAnnotationOverlayInstalled);
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
		enabled: Boolean(selectedPiboSessionId) && (webAnnotationsPanelRendered || selectedWebAnnotationIds.length > 0),
		staleTime: 1_000,
		refetchOnWindowFocus: webAnnotationsPanelRendered,
		refetchInterval: webAnnotationsPanelRendered ? 5_000 : false,
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
		setWebAnnotationOverlayState(selectedPiboSessionId ? readStoredWebAnnotationOverlayState(selectedPiboSessionId) : null);
	}, [selectedPiboSessionId]);

	useEffect(() => {
		if (!selectedPiboSessionId) return;
		const applyOverlayState = (state: WebAnnotationOverlayPanelState | null) => {
			if (!state || state.piboSessionId !== selectedPiboSessionId) return;
			setWebAnnotationOverlayState((current) => {
				if (state.installed) return state;
				if (current?.installed && current.bindingId && state.bindingId && current.bindingId !== state.bindingId) return current;
				return state;
			});
			if (state.installed) {
				void webAnnotationsQuery.refetch();
			} else {
				setWebAnnotationsPanelVisible(false);
			}
		};
		const handleOverlayState = (event: Event) => applyOverlayState(parseWebAnnotationOverlayState((event as CustomEvent).detail));
		const handleStorage = (event: StorageEvent) => {
			if (event.key !== storedWebAnnotationOverlayStateKey(selectedPiboSessionId)) return;
			applyOverlayState(parseStoredWebAnnotationOverlayState(event.newValue));
		};
		const refreshFromStorage = () => applyOverlayState(readStoredWebAnnotationOverlayState(selectedPiboSessionId));
		window.addEventListener("pibo:web-annotation-overlay-state", handleOverlayState);
		window.addEventListener("storage", handleStorage);
		window.addEventListener("focus", refreshFromStorage);
		document.addEventListener("visibilitychange", refreshFromStorage);
		refreshFromStorage();
		return () => {
			window.removeEventListener("pibo:web-annotation-overlay-state", handleOverlayState);
			window.removeEventListener("storage", handleStorage);
			window.removeEventListener("focus", refreshFromStorage);
			document.removeEventListener("visibilitychange", refreshFromStorage);
		};
	}, [selectedPiboSessionId, webAnnotationsQuery.refetch]);

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
		if (trace.latestStreamId !== undefined) {
			recordTraceLiveCursor(latestLiveCursorBySession.current, trace.piboSessionId, trace.latestStreamId);
		}
		if (isStreamingDebugEnabled()) {
			recordStreamingDebugTraceState(trace.piboSessionId, {
				overlayEventCount: 0,
				traceBaseOutputLength: traceAssistantOutputLength(trace),
				traceBaseUpdated: true,
			});
		}
		startTransition(() => {
			setBaseTraceView(trace);
			setLiveTraceOverlay((current) => trimLiveOverlayForBaseTrace(current, trace));
		});
	}, [selectedPiboSessionId, tracePageQuery.data]);

	const reconciledBaseTraceView = useMemo(
		() => baseTraceView ? reconcileOptimisticUserMessages(baseTraceView) : null,
		[baseTraceView],
	);

	const persistedUserMessageIndexForBaseTrace = useMemo(
		() => reconciledBaseTraceView ? collectPersistedUserMessageIndex(reconciledBaseTraceView.nodes) : new Map<string, string[]>(),
		[reconciledBaseTraceView],
	);

	const currentTraceComputation = useMemo((): { traceView: PiboSessionTraceView | null; liveTraceComputeDurationMs?: number } => {
		if (!selectedPiboSessionId) return { traceView: null };
		if (reconciledBaseTraceView?.piboSessionId !== selectedPiboSessionId) return { traceView: null };
		const overlayEvents = liveTraceOverlay?.piboSessionId === selectedPiboSessionId
			? liveTraceOverlay.events
			: [];
		if (!overlayEvents.length) return { traceView: reconciledBaseTraceView };
		const measureCompute = isStreamingDebugEnabled();
		const startedAt = measureCompute ? performance.now() : 0;
		const liveTrace = patchTraceViewWithEvents(reconciledBaseTraceView, overlayEvents, selectedSessionStatus ?? "idle");
		const hasOptimisticUserMessage = overlayIncludesOptimisticUserMessage(overlayEvents);
		if (hasOptimisticUserMessage) annotateLiveTraceForkEntryIds(liveTrace.nodes, persistedUserMessageIndexForBaseTrace);
		const traceView = hasOptimisticUserMessage ? reconcileOptimisticUserMessages(liveTrace) : liveTrace;
		return { traceView, liveTraceComputeDurationMs: measureCompute ? performance.now() - startedAt : undefined };
	}, [liveTraceOverlay, selectedPiboSessionId, selectedSessionStatus, reconciledBaseTraceView, persistedUserMessageIndexForBaseTrace]);
	const currentTraceView = currentTraceComputation.traceView;

	useEffect(() => {
		if (!selectedPiboSessionId || !currentTraceView?.piboSessionId || !isStreamingDebugEnabled()) return;
		recordStreamingDebugTraceState(currentTraceView.piboSessionId, {
			overlayEventCount: liveTraceOverlay?.piboSessionId === currentTraceView.piboSessionId ? liveTraceOverlay.events.length : 0,
			traceBaseOutputLength: traceAssistantOutputLength(baseTraceView),
			currentOutputLength: traceAssistantOutputLength(currentTraceView),
		});
		if (currentTraceComputation.liveTraceComputeDurationMs !== undefined) {
			recordStreamingDebugLiveTraceCompute(currentTraceView.piboSessionId, currentTraceComputation.liveTraceComputeDurationMs);
		}
	}, [baseTraceView, currentTraceComputation.liveTraceComputeDurationMs, currentTraceView, liveTraceOverlay, selectedPiboSessionId]);

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
			const events = applyTraceLiveEvents({
				currentEvents,
				streamEvents: pending,
				piboSessionId,
				nextSequence: () => liveEventSeqRef.current++,
			});
			recordStreamingDebugFlush(piboSessionId, pending.length, events.length);
			return {
				piboSessionId,
				events,
			};
		});
		pendingStreamEventsBySession.current.delete(piboSessionId);
	}, []);

	const schedulePendingStreamFlush = useCallback(() => {
		if (pendingStreamFrame.current !== undefined || pendingStreamTimer.current !== undefined || !selectedPiboSessionId) return;
		if (document.hidden) {
			pendingStreamTimer.current = setTimeout(() => {
				pendingStreamTimer.current = undefined;
				flushPendingStreamEvents(selectedPiboSessionId);
			}, HIDDEN_STREAM_FLUSH_DELAY_MS);
			return;
		}
		pendingStreamFrame.current = requestAnimationFrame(() => {
			pendingStreamFrame.current = undefined;
			flushPendingStreamEvents(selectedPiboSessionId);
		});
	}, [flushPendingStreamEvents, selectedPiboSessionId]);

	const enqueueStreamEvent = useCallback((piboSessionId: string, event: ChatStreamEvent, flushImmediately = false) => {
		resetLiveContentFlushTracking(firstLiveContentFlushKeysBySession.current, piboSessionId, event);
		const shouldFlushImmediately = flushImmediately || consumeFirstLiveContentFlush(firstLiveContentFlushKeysBySession.current, piboSessionId, event);
		const pending = pendingStreamEventsBySession.current.get(piboSessionId) ?? [];
		pending.push(event);
		pendingStreamEventsBySession.current.set(piboSessionId, pending);
		recordStreamingDebugEnqueue(piboSessionId, event, pending.length, shouldFlushImmediately);
		if (shouldFlushImmediately || piboSessionId !== selectedPiboSessionId) {
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
			if (pendingStreamTimer.current !== undefined) {
				clearTimeout(pendingStreamTimer.current);
			}
			if (selectedLiveStreamReconnectTimer.current !== undefined) {
				clearTimeout(selectedLiveStreamReconnectTimer.current);
			}
		};
	}, []);

	const recordLatestLiveStreamCursor = useCallback((piboSessionId: string, event: ChatStreamEvent) => {
		recordEventLiveCursor(latestLiveCursorBySession.current, piboSessionId, event);
	}, []);

	const requestSelectedLiveStreamReconnect = useCallback((delayMs = 0) => {
		if (selectedLiveStreamReconnectTimer.current !== undefined) {
			if (delayMs > 0) return;
			clearTimeout(selectedLiveStreamReconnectTimer.current);
		}
		selectedLiveStreamReconnectTimer.current = setTimeout(() => {
			selectedLiveStreamReconnectTimer.current = undefined;
			setSelectedLiveStreamReconnectGeneration((current) => current + 1);
		}, delayMs);
	}, []);

	const recoverSelectedLiveStream = useCallback(() => {
		if (!selectedPiboSessionId) return;
		flushPendingStreamEvents(selectedPiboSessionId);
		void onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
		void onRefreshBootstrap().catch((caught) => onError(errorMessage(caught)));
		const liveStream = selectedLiveStreamRef.current;
		const stale = !liveStream
			|| liveStream.piboSessionId !== selectedPiboSessionId
			|| liveStream.events.readyState === 2
			|| Date.now() - liveStream.lastActivityAt > LIVE_STREAM_STALE_MS;
		if (stale) requestSelectedLiveStreamReconnect();
	}, [flushPendingStreamEvents, onError, onRefreshBootstrap, onRefreshTrace, requestSelectedLiveStreamReconnect, selectedPiboSessionId]);

	useEffect(() => {
		if (!selectedPiboSessionId || !tracePageQueryKey) return;
		if (!currentTraceView || currentTraceView.piboSessionId !== selectedPiboSessionId) return;
		const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
		params.set("mode", "live");
		const latestLiveCursor = latestLiveCursorBySession.current.get(selectedPiboSessionId);
		const latestCursor = latestLiveCursor?.cursor
			?? (currentTraceView.latestStreamId !== undefined ? traceStreamCursorAfterStream(currentTraceView.latestStreamId) : undefined);
		if (latestCursor !== undefined) {
			params.set("since", latestCursor);
		}
		if (latestLiveCursor?.liveReplayId !== undefined) {
			params.set("liveSince", String(latestLiveCursor.liveReplayId));
		}
		const events = new EventSource(`/api/chat/events?${params.toString()}`);
		const openedAt = Date.now();
		selectedLiveStreamRef.current = { piboSessionId: selectedPiboSessionId, events, openedAt, lastActivityAt: openedAt };
		let closed = false;
		let traceTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
		let bootstrapRefreshInFlight = false;
		let bootstrapRefreshPending = false;
		const scheduleTraceRefresh = (delayMs: number, reset = false) => {
			if (traceTimer) {
				if (!reset) return;
				clearTimeout(traceTimer);
			}
			recordStreamingDebugTraceRefreshScheduled(selectedPiboSessionId, delayMs);
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
		events.onopen = () => {
			selectedLiveStreamReconnectAttempts.current = 0;
			if (selectedLiveStreamReconnectTimer.current !== undefined) {
				clearTimeout(selectedLiveStreamReconnectTimer.current);
				selectedLiveStreamReconnectTimer.current = undefined;
			}
			recordStreamingDebugLiveOpen(selectedPiboSessionId, events.readyState);
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) liveStream.lastActivityAt = Date.now();
		};
		events.onerror = () => {
			if (closed) return;
			recordStreamingDebugLiveError(selectedPiboSessionId, events.readyState);
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) {
				liveStream.lastErrorAt = Date.now();
			}
			const attempt = selectedLiveStreamReconnectAttempts.current++;
			const delayMs = Math.min(LIVE_STREAM_RECONNECT_MAX_DELAY_MS, LIVE_STREAM_RECONNECT_BASE_DELAY_MS * 2 ** attempt);
			requestSelectedLiveStreamReconnect(delayMs);
		};
		events.addEventListener("pibo", (message) => {
			if (closed) return;
			const event = chatStreamEvent(message);
			if (!event) return;
			const targetPiboSessionId = event.piboSessionId || selectedPiboSessionId;
			const liveStream = selectedLiveStreamRef.current;
			if (liveStream?.events === events) liveStream.lastActivityAt = Date.now();
			recordLatestLiveStreamCursor(targetPiboSessionId, event);
			recordStreamingDebugStreamEvent(targetPiboSessionId, event, message.lastEventId, events.readyState);
			if (targetPiboSessionId === selectedPiboSessionId && event.type === "ready" && event.liveReplay?.missed) {
				scheduleTraceRefresh(0, true);
			}
			if (shouldDropStreamingBenchmarkOverlayEvent(event)) return;
			const flushImmediately = event.type !== "TEXT_MESSAGE_CONTENT" && event.type !== "REASONING_MESSAGE_CONTENT";
			if (targetPiboSessionId === selectedPiboSessionId && eventUpdatesLiveOverlay(event)) {
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
			closed = true;
			if (traceTimer) clearTimeout(traceTimer);
			if (bootstrapTimer) clearTimeout(bootstrapTimer);
			flushPendingStreamEvents(selectedPiboSessionId);
			if (selectedLiveStreamRef.current?.events === events) selectedLiveStreamRef.current = null;
			events.close();
		};
	}, [currentTraceView?.piboSessionId, enqueueStreamEvent, flushPendingStreamEvents, onError, onRefreshBootstrap, onRefreshTrace, recordLatestLiveStreamCursor, requestSelectedLiveStreamReconnect, selectedLiveStreamReconnectGeneration, selectedPiboSessionId, tracePageQueryKey]);

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
		const recover = () => recoverSelectedLiveStream();
		const recoverWhenVisible = () => {
			if (!document.hidden) recoverSelectedLiveStream();
		};
		window.addEventListener("focus", recover);
		window.addEventListener("online", recover);
		window.addEventListener("pageshow", recover);
		document.addEventListener("visibilitychange", recoverWhenVisible);
		return () => {
			window.removeEventListener("focus", recover);
			window.removeEventListener("online", recover);
			window.removeEventListener("pageshow", recover);
			document.removeEventListener("visibilitychange", recoverWhenVisible);
		};
	}, [recoverSelectedLiveStream]);

	useEffect(() => {
		if (!selectedPiboSessionId || selectedSessionStatus !== "running") return;
		const timer = window.setInterval(() => {
			flushPendingStreamEvents(selectedPiboSessionId);
			onRefreshTrace().catch((caught) => onError(errorMessage(caught)));
		}, 1000);
		return () => window.clearInterval(timer);
	}, [flushPendingStreamEvents, onError, onRefreshTrace, selectedPiboSessionId, selectedSessionStatus]);

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
		const clientTxnId = createClientTxnId();
		const eventId = clientTxnId;
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
				clientTxnId,
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
		await onSend(text, webAnnotationIds, fileAttachmentPaths, clientTxnId);
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
							panelVisible={webAnnotationsPanelRendered}
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
				{webAnnotationsPanelRendered ? (
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

function trimLiveOverlayForBaseTrace(overlay: LiveTraceOverlay | null, baseTrace: PiboSessionTraceView): LiveTraceOverlay | null {
	if (!overlay || overlay.piboSessionId !== baseTrace.piboSessionId) return overlay;
	const latestStreamId = baseTrace.latestStreamId;
	const confirmedEventKeys = confirmedTraceEventKeys(baseTrace);
	const confirmedUserMessageTexts = confirmedTranscriptUserMessageTexts(baseTrace.nodes);
	const events = overlay.events.filter((event) => {
		if (latestStreamId !== undefined && event.streamId !== undefined && event.streamId <= latestStreamId) return false;
		if (isUserMessageQueuedEvent(event) && confirmedUserMessageTexts.has(event.payload.text)) return false;
		const key = traceEventConfirmationKey(event);
		return !key || !confirmedEventKeys.has(key);
	});
	return events.length ? { ...overlay, events } : null;
}

function confirmedTranscriptUserMessageTexts(nodes: readonly PiboTraceNode[]): Set<string> {
	const texts = new Set<string>();
	for (const node of nodes) {
		if (node.type === "user.message" && node.source === "transcript") {
			const text = traceNodeText(node);
			if (text) texts.add(text);
		}
		for (const text of confirmedTranscriptUserMessageTexts(node.children)) texts.add(text);
	}
	return texts;
}

function confirmedTraceEventKeys(trace: PiboSessionTraceView): Set<string> {
	const keys = new Set<string>();
	for (const event of trace.rawEvents) {
		const key = traceEventConfirmationKey(event);
		if (key) keys.add(key);
	}
	collectConfirmedTraceNodeKeys(trace.nodes, keys);
	return keys;
}

function collectConfirmedTraceNodeKeys(nodes: readonly PiboTraceNode[], keys: Set<string>): void {
	for (const node of nodes) {
		if (node.type === "user.message") {
			const eventId = node.id.startsWith("event:message_queued:") ? node.id.slice("event:message_queued:".length) : undefined;
			if (eventId) keys.add(`${node.piboSessionId}:message_queued:${eventId}`);
			if (node.source === "transcript" && node.entryId) keys.add(`${node.piboSessionId}:message_queued:${node.entryId}`);
		}
		if (node.eventId && node.type === "assistant.message") {
			keys.add(`${node.piboSessionId}:assistant_delta:${node.eventId}`);
			keys.add(`${node.piboSessionId}:assistant_message:${node.eventId}`);
		}
		if (node.eventId && node.type === "model.reasoning") {
			keys.add(`${node.piboSessionId}:thinking_delta:${node.eventId}`);
			keys.add(`${node.piboSessionId}:thinking_finished:${node.eventId}`);
		}
		collectConfirmedTraceNodeKeys(node.children, keys);
	}
}

function traceEventConfirmationKey(event: ChatWebStoredEvent): string | undefined {
	const payload = event.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const eventId = "eventId" in payload && typeof payload.eventId === "string" ? payload.eventId : event.eventId;
	const piboSessionId = "piboSessionId" in payload && typeof payload.piboSessionId === "string" ? payload.piboSessionId : event.piboSessionId;
	if (!eventId || !piboSessionId) return undefined;
	return `${piboSessionId}:${event.type}:${eventId}`;
}

function errorMessage(caught: unknown): string {
	return caught instanceof Error ? caught.message : String(caught);
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

function formatModelProfile(model: ModelProfile): string {
	return `${model.provider}/${model.id}`;
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
		<section className="border-t border-slate-800 bg-[#101d22] px-3 py-2 sm:px-4" data-pibo-debug="web-annotations-session-panel" data-pibo-session-id={piboSessionId}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Web annotations</div>
						<span className="rounded-sm border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">{annotations.length}</span>
						{selectedIds.length ? <span className="rounded-sm border border-[#11a4d4]/50 px-1.5 py-0.5 text-[10px] text-[#11a4d4]">{selectedIds.length} attached</span> : null}
					</div>
					{collapsed ? null : <div className="text-[11px] text-slate-500">Global annotation list. Selected attachments are remembered per session.</div>}
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					<button type="button" onClick={onRefresh} disabled={loading} title="Refresh annotations" aria-label="Refresh annotations" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50 sm:h-7 sm:w-7" data-pibo-debug="web-annotations-refresh">
						<RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
					</button>
					<button type="button" onClick={onClear} disabled={loading || !annotations.length} title="Clear visible annotations" aria-label="Clear visible annotations" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50 sm:h-7 sm:w-7">
						<Trash2 size={12} />
					</button>
					<button type="button" onClick={onCollapse} title={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} aria-label={collapsed ? "Expand annotations panel" : "Collapse annotations panel"} className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] sm:h-7 sm:w-7">
						{collapsed ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}
					</button>
					<button type="button" onClick={onClose} title="Hide annotations panel" aria-label="Hide annotations panel" className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] sm:h-7 sm:w-7">
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
				<div className="mt-2 grid max-h-[min(40svh,18rem)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:max-h-56 sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]" data-pibo-debug="web-annotations-list">
					{annotations.map((annotation) => {
						const selected = selectedIds.includes(annotation.id);
						return (
							<div key={annotation.id} data-pibo-debug="web-annotation-chip" data-web-annotation-id={annotation.id} data-web-annotation-session-id={annotation.piboSessionId} data-web-annotation-selected={selected ? "true" : "false"} className={`min-w-0 rounded-sm border px-3 py-2 text-xs ${selected ? "border-[#11a4d4] bg-[#11a4d4]/10" : "border-slate-800 bg-[#0e1116]"}`}>
								<div className="mb-1 flex items-center justify-between gap-2">
									<span className="min-w-0 truncate font-mono text-[11px] text-slate-500">{annotation.status} · {annotation.targetKind}</span>
									<button type="button" onClick={() => onToggle(annotation.id)} className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-sm border px-2 text-[11px] sm:h-6 sm:px-1.5 ${selected ? "border-[#11a4d4] text-[#11a4d4]" : "border-slate-700 text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}>
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
		return injectWebAnnotationBinding(result.binding.id, compactWebAnnotationRequest({ piboSessionId, piboRoomId, cdpUrl, annotationShortcut: readStoredWebAnnotationToggleShortcut() }));
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
				annotationShortcut: readStoredWebAnnotationToggleShortcut(),
			});
			if (!binding.overlay) throw new Error("Overlay config missing from same-origin binding response");
			await installSameOriginWebAnnotationOverlay(binding.overlay);
			setStatus({ kind: "success", message: "Annotation overlay is ready on this Pibo page. Open the overlay controls or use the shortcut to start annotating." });
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
				<BookA size={14} />
			</HeaderIconButton>
			{open && !disabled ? (
				<div className="fixed inset-x-2 bottom-3 z-40 max-h-[calc(100svh-1.5rem)] overflow-y-auto rounded-sm border border-slate-700 bg-[#0e1116] p-3 text-sm shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:bottom-auto sm:mt-2 sm:w-[min(420px,calc(100vw-24px))] sm:max-h-[calc(100svh-5rem)]" role="dialog" aria-label="Web Annotations">
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
					<button type="button" onClick={() => void startCurrentPageAnnotation()} disabled={busy} className="mb-3 h-10 w-full rounded-sm bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 sm:h-9" data-pibo-debug="web-annotations-current-page">
						Annotate this Pibo page
					</button>
					<label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-500" htmlFor="web-annotation-url">Annotate URL via CDP</label>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
						<input
							id="web-annotation-url"
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							onKeyDown={(event) => { if (event.key === "Enter") void startUrlAnnotation(); }}
							placeholder="http://localhost:5173"
							disabled={busy}
							className="h-10 min-w-0 rounded-sm border border-slate-700 bg-[#151f24] px-2 text-base text-slate-100 outline-none focus:border-[#11a4d4] disabled:opacity-60 sm:h-9 sm:text-xs"
						/>
						<button type="button" onClick={() => void startUrlAnnotation()} disabled={busy || !url.trim()} className="h-10 rounded-sm bg-[#11a4d4] px-3 text-xs font-medium text-white disabled:opacity-50 sm:h-9">
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
						className="h-10 w-full rounded-sm border border-slate-800 bg-[#151f24] px-2 font-mono text-base text-slate-300 outline-none focus:border-[#11a4d4] disabled:opacity-60 sm:h-8 sm:text-[11px]"
					/>
					<div className="mt-3 flex items-center justify-between gap-2">
						<div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Existing targets</div>
						<button type="button" onClick={() => void loadTargets()} disabled={busy || targetsState === "loading"} className="inline-flex h-7 items-center gap-1 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-50">
							<RefreshCw size={12} className={targetsState === "loading" ? "animate-spin" : undefined} /> Refresh
						</button>
					</div>
					<div className="mt-2 max-h-[min(34svh,14rem)] overflow-auto rounded-sm border border-slate-800 sm:max-h-56">
						{targetsState === "idle" ? <div className="px-3 py-3 text-xs text-slate-500">Refresh to list reachable browser targets.</div> : null}
						{targetsState === "loading" ? <div className="px-3 py-3 text-xs text-slate-400">Loading targets…</div> : null}
						{targetsState === "loaded" && !targets.length ? <div className="px-3 py-3 text-xs text-slate-500">No attachable browser targets found.</div> : null}
						{targets.map((target) => (
							<div key={target.id} className="grid grid-cols-1 gap-2 border-b border-slate-800 px-3 py-2 last:border-b-0 sm:grid-cols-[1fr_auto]">
								<div className="min-w-0">
									<div className="truncate text-xs text-slate-200" title={target.title || target.url}>{boundedUiText(target.title || "Untitled target", 120)}</div>
									<div className="truncate font-mono text-[11px] text-slate-500" title={target.url}>{boundedUiText(target.url || target.id, 160)}</div>
								</div>
								<button type="button" onClick={() => void attachTarget(target)} disabled={busy || !target.attachable} title={target.attachable ? "Attach selected target" : "Target is not attachable"} className="h-9 rounded-sm border border-slate-700 px-2 text-[11px] text-slate-300 hover:border-[#11a4d4] hover:text-[#11a4d4] disabled:opacity-40 sm:h-8">
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

type LiveTraceOverlay = {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
};

type SelectedLiveEventStream = {
	piboSessionId: string;
	events: EventSource;
	openedAt: number;
	lastActivityAt: number;
	lastErrorAt?: number;
};

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

function forEachPiboTraceNode(nodes: readonly PiboTraceNode[], visitNode: (node: PiboTraceNode) => void): void {
	for (const node of nodes) {
		visitNode(node);
		forEachPiboTraceNode(node.children, visitNode);
	}
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}

function traceAssistantOutputLength(trace: PiboSessionTraceView | null | undefined): number | undefined {
	if (!trace) return undefined;
	let length = 0;
	forEachPiboTraceNode(trace.nodes, (node) => {
		if (node.type === "assistant.message") length += traceNodeText(node).length;
	});
	return length;
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
