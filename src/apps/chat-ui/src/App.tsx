import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { RefreshCw, X } from "lucide-react";
import { getBootstrap, getNavigation, getSessionPage, markRoomRead, markSessionRead, patchRoom, patchSession, postAction, postMessage, postRoom, postSession } from "./api-chat-sessions";
import { navigateToChatRoute, type ChatAppRoute, type NavigationOptions } from "./app-routes";
import { downloadChatFile, type ChatDownloadProgress } from "./api-chat-files";
import { fetchSignalTree, subscribeSignalTree } from "./api-trace-signals";
import { listUserSkills } from "./api-agent-designer";
import type { AgentCatalog, BootstrapData, NavigationData, PiboSignalPatch, PiboSignalSnapshot, UserSkill } from "./types";
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
import type { PiPackageCatalogItem } from "./agents/agent-designer-model";
import { AgentsView } from "./agents/AgentsView";
import { SessionTracePane } from "./session-trace-pane";
import { SessionSidebar } from "./session-sidebar";
import { getChatSessionView, listChatSessionViews } from "./session-views/registry";
import type { ChatSessionViewId } from "./session-views/types";
import {
	clearStoredSelection,
	readStoredComposerDraft,
	readStoredExpandThinking,
	readStoredNewSessionProfile,
	readStoredSelection,
	readStoredSessionView,
	readStoredShowArchivedRooms,
	readStoredShowArchivedSessions,
	readStoredShowRawEvents,
	readStoredShowThinking,
	removeStoredNewSessionProfile,
	removeStoredRoomSelection,
	writeStoredComposerDraft,
	writeStoredExpandThinking,
	writeStoredNewSessionProfile,
	writeStoredSelection,
	writeStoredSessionView,
	writeStoredShowArchivedRooms,
	writeStoredShowArchivedSessions,
	writeStoredShowRawEvents,
	writeStoredShowThinking,
} from "./app-storage";
import {
	addRoomToBootstrap,
	addSessionNodeToBootstrap,
	createBootstrapMutationSnapshot,
	createOptimisticRoom,
	createOptimisticSessionNode,
	replaceOptimisticSessionNode,
	replaceRoomInBootstrap,
	roomWithArchivedState,
	sessionNodeFromSession,
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
	fallbackRoomIdWhenHidingArchived,
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
import {
	commandActionParams,
	getResultPiboSessionId,
	normalizeDownloadCommandPath,
	parseForkActionResponse,
} from "./app-command-actions";
import { availableSkillsForSession, buildSlashCommands } from "./app-command-catalog";
import {
	hasExplicitSessionsRouteSelection,
	routeSelectionRequest,
	sessionsRouteCanonicalSelection,
	shouldSkipRouteSelectionLoad,
} from "./app-route-selection";
import { errorMessage } from "./error-message";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { SettingsView } from "./settings/SettingsView";
import type { SettingsPanel } from "./settings/types";
import { ProjectsArea } from "./projects/ProjectsArea";
import { MinimalWorkflowsArea } from "./MinimalWorkflowsArea";
import { DeleteRoomModal, DeleteSessionModal } from "./delete-confirmation-modals";
import { AppErrorBanner, AppHeader, FallbackGatewayBanner, SignedOut, type AppArea as Area } from "./app-chrome";
import {
	applySelectedSignalPatch,
	applySignalPatchToBootstrap,
	applySignalSnapshotToBootstrap,
	shouldCommitSelectedSignalSnapshot,
	signalLegacyStatus,
	signalSnapshotIncludesSession,
} from "./app-signal-status";
import { appendSessionRoots, markSessionSubtreeReadInBootstrap, mergeNavigationIntoBootstrap } from "./app-navigation-merge";
import {
	removeAgentCatalogPiPackage,
	removeAgentCatalogUserSkill,
	updateAgentCatalogMcpServer,
	upsertAgentCatalogPiPackage,
	upsertAgentCatalogUserSkill,
} from "./app-agent-catalog-mutations";
import { useAppDeleteActions } from "./app-delete-actions";
import { roomSummaryStreamUrl } from "./room-summary-stream";

export type { ChatAppRoute } from "./app-routes";

type LoadBootstrapOptions = {
	selectSession?: boolean;
	force?: boolean;
	signal?: AbortSignal;
};

type LoadNavigationOptions = {
	force?: boolean;
	readSessionId?: string;
	signal?: AbortSignal;
};

const SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS = 750;
const NAVIGATION_FALLBACK_REFRESH_MS = 30_000;
const SESSION_PAGE_SIZE = 120;
const ARCHIVED_SESSION_PAGE_SIZE = 60;
const EMPTY_SESSION_PATH_IDS = new Set<string>();

type ChatDownloadStatus = ChatDownloadProgress & {
	key: string;
	status: "starting" | "running" | "completed" | "failed";
	duplicateAttempted?: boolean;
	error?: string;
};

function fallbackDownloadFilename(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/");
	return normalized.split("/").filter(Boolean).pop() ?? "download";
}

function formatDownloadBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
	return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function downloadProgressLabel(status: ChatDownloadStatus): string {
	if (status.status === "starting") return "Preparing download…";
	if (status.status === "failed") return status.error ?? "Download failed";
	if (status.totalBytes && status.totalBytes > 0) {
		const percent = Math.min(100, Math.floor((status.receivedBytes / status.totalBytes) * 100));
		return `${percent}% · ${formatDownloadBytes(status.receivedBytes)} of ${formatDownloadBytes(status.totalBytes)}`;
	}
	return status.receivedBytes > 0 ? `${formatDownloadBytes(status.receivedBytes)} received` : "Waiting for bytes…";
}

function isAbortError(value: unknown): boolean {
	return value instanceof DOMException && value.name === "AbortError";
}

function streamIdFromEventSourceId(lastEventId: string): number | undefined {
	const streamId = Number(lastEventId.split(":", 1)[0]);
	return Number.isFinite(streamId) ? streamId : undefined;
}

async function loadBootstrapQueryData(
	queryClient: QueryClient,
	input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		markRead?: boolean;
		force?: boolean;
		signal?: AbortSignal;
	},
): Promise<BootstrapData> {
	const queryKey = chatBootstrapQueryKey(input.piboSessionId, input.includeArchived, input.roomId);
	await queryClient.removeQueries({ queryKey, exact: true });
	return getBootstrap(input.piboSessionId, input.includeArchived, input.roomId, Boolean(input.markRead), { signal: input.signal });
}

async function loadNavigationQueryData(
	queryClient: QueryClient,
	input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		force?: boolean;
		signal?: AbortSignal;
	},
): Promise<NavigationData> {
	const queryKey = chatSessionNavigationQueryKey(input.includeArchived, input.roomId, input.piboSessionId);
	if (!input.force) {
		const cached = queryClient.getQueryData<NavigationData>(queryKey);
		if (cached) return cached;
	} else {
		await queryClient.removeQueries({ queryKey, exact: true });
	}
	const navigation = await getNavigation(input.piboSessionId, input.includeArchived, input.roomId, { signal: input.signal });
	queryClient.setQueryData(queryKey, navigation);
	return navigation;
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
	const routeWorkflowDraftId = route.area === "workflows" ? route.draftId : undefined;
	const settingsPanel: SettingsPanel = route.area === "settings" ? route.panel ?? "general" : "general";
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [downloadStatus, setDownloadStatus] = useState<ChatDownloadStatus | null>(null);
	const activeDownloadKeysRef = useRef<Set<string>>(new Set());
	const [showThinking, setShowThinking] = useState(readStoredShowThinking);
	const [expandThinking, setExpandThinking] = useState(readStoredExpandThinking);
	const [showRawEvents, setShowRawEvents] = useState(readStoredShowRawEvents);
	const [showArchived, setShowArchived] = useState(readStoredShowArchivedSessions);
	const [showArchivedRooms, setShowArchivedRooms] = useState(readStoredShowArchivedRooms);
	const [newSessionProfile, setNewSessionProfile] = useState("");
	const [newSessionProfileRoomId, setNewSessionProfileRoomId] = useState<string | null>(null);
	const [sessionViewId, setSessionViewId] = useState<ChatSessionViewId>(() => routeSessionViewId ?? readStoredSessionView());
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const creatingSessionRef = useRef(false);
	const agentAutosaveHandlerRef = useRef<(() => Promise<void>) | null>(null);
	const [loadingActiveSessions, setLoadingActiveSessions] = useState(false);
	const [loadingArchivedSessions, setLoadingArchivedSessions] = useState(false);
	const [visibleActiveSessionCount, setVisibleActiveSessionCount] = useState(SESSION_PAGE_SIZE);
	const [visibleArchivedSessionCount, setVisibleArchivedSessionCount] = useState(ARCHIVED_SESSION_PAGE_SIZE);
	const [loadingPiboSessionId, setLoadingPiboSessionId] = useState<string | null>(null);
	const [loadingRoomId, setLoadingRoomId] = useState<string | null>(null);
	const [autoRenameSessionId, setAutoRenameSessionId] = useState<string | null>(null);
	const [contextPanel, setContextPanel] = useState<ContextPanel>("build-context");
	const [selectedContextFileKey, setSelectedContextFileKey] = useState<string | null>(null);
	const [selectedMcpServerName, setSelectedMcpServerName] = useState<string | null>(null);
	const [creatingRoom, setCreatingRoom] = useState(false);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [mobileAreaMenuOpen, setMobileAreaMenuOpen] = useState(false);
	const mobileAreaMenuRef = useRef<HTMLDivElement>(null);
	const [gatewayMode, setGatewayMode] = useState<"main" | "fallback" | null>(null);
	const [sessionSignals, setSessionSignals] = useState<PiboSignalSnapshot | null>(null);
	const sessionSignalsRef = useRef<PiboSignalSnapshot | null>(null);
	const [signalNow, setSignalNow] = useState(() => Date.now());
	const showArchivedRef = useRef(showArchived);
	const sessionListScrollRef = useRef<HTMLDivElement>(null);
	const bootstrapRef = useRef<BootstrapData | null>(null);
	const bootstrapRequestId = useRef(0);
	const navigationInFlightRef = useRef(new Map<string, Promise<NavigationData>>());
	const roomSwitchControllerRef = useRef<AbortController | null>(null);
	const roomSwitchGenerationRef = useRef(0);
	const activeRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? null;
	const selectedRoom = activeRoomId && bootstrap ? findRoomById(bootstrap.rooms, activeRoomId) ?? bootstrap.room : undefined;
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;
	const loadingSelectedRoom = Boolean(loadingRoomId && loadingRoomId === selectedRoomId);
	const overlayCurrentSignals = useCallback((data: BootstrapData): BootstrapData => {
		const snapshot = sessionSignalsRef.current;
		return data.selectedPiboSessionId && signalSnapshotIncludesSession(snapshot, data.selectedPiboSessionId)
			? applySignalSnapshotToBootstrap(data, snapshot)
			: data;
	}, []);

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
		sessionSignalsRef.current = null;
		setSessionSignals(null);
		if (area !== "sessions" || !selectedPiboSessionId) return;

		let active = true;
		let signalRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const controller = new AbortController();
		const commitSignalSnapshot = (snapshot: PiboSignalSnapshot) => {
			if (!active || controller.signal.aborted || !shouldCommitSelectedSignalSnapshot(sessionSignalsRef.current, snapshot, selectedPiboSessionId)) return;
			sessionSignalsRef.current = snapshot;
			setSessionSignals(snapshot);
			setBootstrap((current) => current ? applySignalSnapshotToBootstrap(current, snapshot) : current);
		};
		const refreshSignalSnapshot = (delayMs: number) => {
			if (!active) return;
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			signalRecoveryTimer = setTimeout(() => {
				signalRecoveryTimer = undefined;
				fetchSignalTree(selectedPiboSessionId, { signal: controller.signal })
					.then(commitSignalSnapshot)
					.catch(() => undefined);
			}, delayMs);
		};
		const signalTreeHandlers = {
			onSnapshot: (snapshot: PiboSignalSnapshot) => {
				if (!active || !shouldCommitSelectedSignalSnapshot(sessionSignalsRef.current, snapshot, selectedPiboSessionId)) return;
				if (signalRecoveryTimer) {
					clearTimeout(signalRecoveryTimer);
					signalRecoveryTimer = undefined;
				}
				commitSignalSnapshot(snapshot);
			},
			onPatch: (patch: PiboSignalPatch) => {
				if (!active) return;
				const result = applySelectedSignalPatch(sessionSignalsRef.current, patch, selectedPiboSessionId);
				if (result.needsRefresh) {
					refreshSignalSnapshot(0);
					return;
				}
				sessionSignalsRef.current = result.snapshot;
				setSessionSignals(result.snapshot);
				setBootstrap((bootstrapData) => bootstrapData ? applySignalPatchToBootstrap(bootstrapData, patch) : bootstrapData);
			},
			onError: () => refreshSignalSnapshot(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS),
		};
		let unsubscribeSignalTree: () => void = () => undefined;
		const reconnectSignalTree = () => {
			if (!active) return;
			unsubscribeSignalTree();
			unsubscribeSignalTree = subscribeSignalTree(selectedPiboSessionId, signalTreeHandlers);
			refreshSignalSnapshot(0);
		};
		const refreshVisibleSignalTree = () => {
			if (document.visibilityState === "visible") reconnectSignalTree();
		};
		unsubscribeSignalTree = subscribeSignalTree(selectedPiboSessionId, signalTreeHandlers);
		window.addEventListener("pageshow", reconnectSignalTree);
		document.addEventListener("visibilitychange", refreshVisibleSignalTree);
		refreshSignalSnapshot(0);
		return () => {
			active = false;
			controller.abort();
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			window.removeEventListener("pageshow", reconnectSignalTree);
			document.removeEventListener("visibilitychange", refreshVisibleSignalTree);
			unsubscribeSignalTree();
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
			navigateToChatRoute(navigate, target, replace, nextSessionViewId);
		},
		[navigate, sessionViewId],
	);

	const updateAgentAutosaveHandler = useCallback((handler: (() => Promise<void>) | null) => {
		agentAutosaveHandlerRef.current = handler;
	}, []);
	const flushAgentBeforeNavigation = useCallback(async ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) => {
		if (current.pathname === next.pathname) return false;
		const autosave = agentAutosaveHandlerRef.current;
		if (!autosave) return false;
		try {
			await autosave();
			return false;
		} catch {
			return true;
		}
	}, []);
	useBlocker({
		disabled: area !== "agents",
		enableBeforeUnload: false,
		shouldBlockFn: flushAgentBeforeNavigation,
	});

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
		setBootstrap((current) => current ? updateAgentCatalogMcpServer(current, server) : current);
	}, []);

	const upsertPiPackageInBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		setBootstrap((current) => current ? upsertAgentCatalogPiPackage(current, pkg) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? upsertAgentCatalogPiPackage(current, pkg) : current);
	}, [queryClient]);

	const removePiPackageFromBootstrap = useCallback((pkg: PiPackageCatalogItem) => {
		setBootstrap((current) => current ? removeAgentCatalogPiPackage(current, pkg.id) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? removeAgentCatalogPiPackage(current, pkg.id) : current);
	}, [queryClient]);

	const upsertUserSkillInBootstrap = useCallback((skill: UserSkill) => {
		setBootstrap((current) => current ? upsertAgentCatalogUserSkill(current, skill) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? upsertAgentCatalogUserSkill(current, skill) : current);
	}, [queryClient]);

	const removeUserSkillFromBootstrap = useCallback((skillId: string) => {
		setBootstrap((current) => current ? removeAgentCatalogUserSkill(current, skillId) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) => current ? removeAgentCatalogUserSkill(current, skillId) : current);
	}, [queryClient]);

	const fetchNavigation = useCallback((input: {
		piboSessionId?: string;
		includeArchived?: boolean;
		roomId?: string;
		force?: boolean;
		signal?: AbortSignal;
	}) => {
		const key = JSON.stringify([
			input.piboSessionId ?? "",
			input.includeArchived === true ? "archived" : "active",
			input.roomId ?? "",
			input.force === true ? "force" : "cached",
		]);
		if (input.signal) return loadNavigationQueryData(queryClient, input);
		const inFlight = navigationInFlightRef.current.get(key);
		if (inFlight) return inFlight;
		const request = loadNavigationQueryData(queryClient, input).finally(() => {
			if (navigationInFlightRef.current.get(key) === request) navigationInFlightRef.current.delete(key);
		});
		navigationInFlightRef.current.set(key, request);
		return request;
	}, [queryClient]);

	const loadBootstrap = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadBootstrapOptions = {},
	) => {
		const currentBootstrap = bootstrapRef.current;
		if (currentBootstrap && options.selectSession !== false && !options.force) {
			if (piboSessionId) void markSessionRead(piboSessionId).catch(() => undefined);
			const requestId = bootstrapRequestId.current + 1;
			bootstrapRequestId.current = requestId;
			const navigation = await fetchNavigation({ piboSessionId, includeArchived, roomId, signal: options.signal });
			const data = mergeNavigationIntoBootstrap(currentBootstrap, navigation, { readSessionId: piboSessionId });
			if (requestId !== bootstrapRequestId.current) return data;
			const next = overlayCurrentSignals(data);
			setBootstrap(next);
			setSelectedPiboSessionId(next.selectedPiboSessionId);
			setSelectedRoomId(next.selectedRoomId);
			return next;
		}
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const data = await loadBootstrapQueryData(queryClient, {
			piboSessionId,
			includeArchived,
			roomId,
			markRead: options.selectSession !== false,
			force: options.force,
			signal: options.signal,
		});
		if (requestId !== bootstrapRequestId.current) return data;
		const next = overlayCurrentSignals(data);
		setBootstrap(next);
		if (options.selectSession !== false) setSelectedPiboSessionId(next.selectedPiboSessionId);
		setSelectedRoomId(next.selectedRoomId);
		return next;
	}, [overlayCurrentSignals, queryClient]);

	const loadNavigation = useCallback(async (
		piboSessionId?: string,
		includeArchived = showArchivedRef.current,
		roomId?: string,
		options: LoadNavigationOptions = {},
	) => {
		const currentBootstrap = bootstrapRef.current;
		if (!currentBootstrap) return loadBootstrap(piboSessionId, includeArchived, roomId, { force: options.force, signal: options.signal });
		const requestId = bootstrapRequestId.current + 1;
		bootstrapRequestId.current = requestId;
		const navigation = await fetchNavigation({ piboSessionId, includeArchived, roomId, force: options.force, signal: options.signal });
		const data = mergeNavigationIntoBootstrap(currentBootstrap, navigation, { readSessionId: options.readSessionId });
		if (requestId !== bootstrapRequestId.current) return data;
		const next = overlayCurrentSignals(data);
		setBootstrap(next);
		setSelectedPiboSessionId(next.selectedPiboSessionId);
		setSelectedRoomId(next.selectedRoomId);
		return next;
	}, [fetchNavigation, loadBootstrap, overlayCurrentSignals]);

	useEffect(() => {
		if (area !== "sessions") return;
		let stopped = false;
		let inFlight = false;
		const refreshVisibleNavigation = () => {
			if (stopped || inFlight || document.hidden || !bootstrapRef.current) return;
			inFlight = true;
			loadNavigation(selectedPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId ?? undefined, { force: true })
				.catch(() => undefined)
				.finally(() => {
					inFlight = false;
				});
		};
		const interval = window.setInterval(refreshVisibleNavigation, NAVIGATION_FALLBACK_REFRESH_MS);
		const refreshWhenVisible = () => {
			if (!document.hidden) refreshVisibleNavigation();
		};
		window.addEventListener("focus", refreshVisibleNavigation);
		document.addEventListener("visibilitychange", refreshWhenVisible);
		return () => {
			stopped = true;
			window.clearInterval(interval);
			window.removeEventListener("focus", refreshVisibleNavigation);
			document.removeEventListener("visibilitychange", refreshWhenVisible);
		};
	}, [activeRoomId, area, loadNavigation, selectedPiboSessionId]);

	useEffect(() => {
		const stored = readStoredSelection();
		const { requestedRoomId, requestedPiboSessionId } = routeSelectionRequest(route, stored);

		const canonicalizeSessionsRoute = (data: BootstrapData, replace = true) => {
			const selection = sessionsRouteCanonicalSelection(route, data);
			if (!selection) return;
			navigateToSelectedSession(selection.selectedRoomId, selection.selectedPiboSessionId, replace);
		};

		if (shouldSkipRouteSelectionLoad({ bootstrap, creatingSession: creatingSessionRef.current, route })) return;

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
				const explicitRouteSelection = hasExplicitSessionsRouteSelection(route);
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
		const roomId = bootstrap.selectedRoomId;
		if (loadingRoomId || !roomId || roomId.startsWith("optimistic-room-")) return;
		const sessionProfile = defaultProfileFromBootstrap(bootstrap);
		const storedProfile = readStoredNewSessionProfile(roomId);
		const legacyProfile = storedProfile ? "" : readStoredNewSessionProfile();
		const matchedProfile = findAgentProfile(bootstrap.agents, storedProfile || legacyProfile || sessionProfile);
		const nextProfile = matchedProfile?.name ?? findAgentProfile(bootstrap.agents, sessionProfile)?.name ?? bootstrap.agents[0].name;
		setNewSessionProfile(nextProfile);
		setNewSessionProfileRoomId(roomId);
		if (storedProfile !== nextProfile) writeStoredNewSessionProfile(nextProfile, roomId);
		if (legacyProfile) writeStoredNewSessionProfile("");
	}, [bootstrap, loadingRoomId]);

	const setPreferredNewSessionProfile = useCallback((profile: string) => {
		setNewSessionProfile(profile);
		const roomId = selectedRoomId ?? bootstrapRef.current?.selectedRoomId;
		if (roomId) {
			setNewSessionProfileRoomId(roomId);
			writeStoredNewSessionProfile(profile, roomId);
		}
	}, [selectedRoomId]);

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
		const roomSummaryUrl = roomSummaryStreamUrl({
			area,
			activeRoomId,
			bootstrapSelectedRoomId: bootstrap?.selectedRoomId,
			latestRoomStreamId,
		});
		if (!roomSummaryUrl || !activeRoomId || typeof latestRoomStreamId !== "number") return;
		const events = new EventSource(roomSummaryUrl);
		let navigationTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleNavigationRefresh = () => {
			if (navigationTimer) clearTimeout(navigationTimer);
			navigationTimer = setTimeout(() => {
				navigationTimer = undefined;
				loadNavigation(selectedPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId, { force: true })
					.catch((caught) => {
						if (!isAbortError(caught)) setError(errorMessage(caught));
					});
			}, 900);
		};
		events.addEventListener("pibo", (message) => {
			const event = chatStreamEvent(message);
			if (!event || event.type === "ready") return;
			const messageStreamId = streamIdFromEventSourceId((message as MessageEvent).lastEventId);
			const replayFrame = messageStreamId !== undefined && messageStreamId <= latestRoomStreamId;
			const targetPiboSessionId = event.piboSessionId;
			const streamStatus = liveSessionStatusFromEvent(event);
			if (targetPiboSessionId && streamStatus) {
				const signalStatus = signalLegacyStatus(sessionSignalsRef.current?.sessions[targetPiboSessionId]);
				const status = signalStatus ?? streamStatus;
				const lastActivityAt = new Date().toISOString();
				updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, targetPiboSessionId, (node) => ({ ...node, status, lastActivityAt })));
			}
			if (!replayFrame && eventShouldRefreshNavigation(event)) scheduleNavigationRefresh();
		});
		return () => {
			if (navigationTimer) clearTimeout(navigationTimer);
			events.close();
		};
	}, [activeRoomId, area, bootstrap?.selectedRoomId, latestRoomStreamId, loadNavigation, selectedPiboSessionId, updateBootstrapCache]);

	const restoreBootstrapSnapshot = useCallback((snapshot: BootstrapMutationSnapshot | undefined) => {
		if (!snapshot) return;
		setBootstrap(snapshot.localBootstrap);
		for (const [queryKey, data] of snapshot.queryData) queryClient.setQueryData(queryKey, data);
	}, [queryClient]);

	const {
		deleteRoomTarget,
		deleteRoomConfirmName,
		deletingRoom,
		setDeleteRoomConfirmName,
		requestRoomDelete,
		cancelRoomDelete,
		permanentlyDeleteRoom,
		deleteSessionTarget,
		deleteSessionConfirmText,
		deletingSession,
		setDeleteSessionConfirmText,
		requestSessionDelete,
		cancelSessionDelete,
		permanentlyDeleteSession,
	} = useAppDeleteActions({
		queryClient,
		bootstrap,
		selectedPiboSessionId,
		selectedRoomId,
		showArchivedRef,
		isSessionsArea: area === "sessions",
		loadBootstrap,
		navigateToSelectedSession,
		updateBootstrapCache,
		restoreBootstrapSnapshot,
		setSelectedPiboSessionId,
		setSelectedRoomId,
		setError,
	});

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

	const slashCommands = useMemo(() => buildSlashCommands(bootstrap?.capabilities.actions ?? []), [bootstrap]);
	const skills = useMemo(() => availableSkillsForSession(bootstrap, selectedPiboSessionId), [bootstrap, selectedPiboSessionId]);

	const selectSession = useCallback(async (piboSessionId: string) => {
		const targetRoomId = selectedRoomId ?? bootstrap?.selectedRoomId;
		flushSync(() => {
			setSelectedPiboSessionId(piboSessionId);
			setLoadingPiboSessionId(piboSessionId);
			setMobileSidebarOpen(false);
		});
		updateBootstrapCache((current) => markSessionSubtreeReadInBootstrap(current, piboSessionId, targetRoomId ?? current.selectedRoomId));
		navigateToSelectedSession(targetRoomId, piboSessionId, false, { closeMobileSidebar: false });
		void markSessionRead(piboSessionId).catch(() => undefined);
		window.setTimeout(() => {
			setLoadingPiboSessionId((current) => current === piboSessionId ? null : current);
		}, 50);
		window.setTimeout(() => {
			if (bootstrapRef.current?.selectedPiboSessionId !== piboSessionId) return;
			void loadNavigation(piboSessionId, showArchivedRef.current, targetRoomId, { readSessionId: piboSessionId })
				.then((data) => {
					if (bootstrapRef.current?.selectedPiboSessionId !== piboSessionId) return;
					navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, true, { closeMobileSidebar: false });
				})
				.catch((caught) => {
					if (!isAbortError(caught) && bootstrapRef.current?.selectedPiboSessionId === piboSessionId) setError(errorMessage(caught));
				});
		}, 750);
	}, [bootstrap?.selectedRoomId, loadNavigation, navigateToSelectedSession, selectedRoomId, updateBootstrapCache]);

	const selectRoom = useCallback(async (roomId: string, options: NavigationOptions = {}) => {
		const navigationOptions = { ...options, closeMobileSidebar: false };
		const storedPiboSessionId = readStoredSelection().sessionsByRoom?.[roomId];
		const generation = roomSwitchGenerationRef.current + 1;
		roomSwitchGenerationRef.current = generation;
		roomSwitchControllerRef.current?.abort();
		const controller = new AbortController();
		roomSwitchControllerRef.current = controller;
		flushSync(() => {
			setSelectedRoomId(roomId);
			setSelectedPiboSessionId(storedPiboSessionId ?? null);
			setNewSessionProfileRoomId(null);
			setLoadingRoomId(roomId);
			setMobileSidebarOpen(false);
		});
		try {
			const data = await loadNavigation(storedPiboSessionId, showArchivedRef.current, roomId, { signal: controller.signal });
			if (roomSwitchGenerationRef.current !== generation || controller.signal.aborted) return;
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, navigationOptions);
		} catch (caught) {
			if (isAbortError(caught)) return;
			if (!storedPiboSessionId) throw caught;
			removeStoredRoomSelection(roomId);
			setSelectedPiboSessionId(null);
			const data = await loadNavigation(undefined, showArchivedRef.current, roomId, { signal: controller.signal });
			if (roomSwitchGenerationRef.current !== generation || controller.signal.aborted) return;
			navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, navigationOptions);
		} finally {
			if (roomSwitchGenerationRef.current === generation) {
				if (roomSwitchControllerRef.current === controller) roomSwitchControllerRef.current = null;
				setLoadingRoomId((current) => current === roomId ? null : current);
			}
		}
	}, [loadNavigation, navigateToSelectedSession]);

	const toggleArchivedRooms = useCallback(() => {
		const next = !showArchivedRooms;
		setShowArchivedRooms(next);
		writeStoredShowArchivedRooms(next);
		if (next || !bootstrap) return;

		const fallbackRoomId = fallbackRoomIdWhenHidingArchived(bootstrap.rooms, activeRoomId);
		if (!fallbackRoomId) return;
		void selectRoom(fallbackRoomId, { closeMobileSidebar: false }).catch((caught) => {
			setError(caught instanceof Error ? caught.message : String(caught));
		});
	}, [activeRoomId, bootstrap, selectRoom, showArchivedRooms]);

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
		writeStoredShowArchivedSessions(next);

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

	const createRoom = async () => {
		if (creatingRoom) return;
		setCreatingRoom(true);
		await queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] });
		const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
		const tempId = `optimistic-room-${createClientTxnId()}`;
		const optimisticRoom = createOptimisticRoom(tempId, "New Chat");
		setSelectedRoomId(tempId);
		setSelectedPiboSessionId(null);
		setNewSessionProfileRoomId(null);
		setLoadingRoomId(tempId);
		updateBootstrapCache((data) => addRoomToBootstrap(data, optimisticRoom));
		try {
			const created = await postRoom({ name: "New Chat" });
			removeStoredRoomSelection(tempId);
			removeStoredNewSessionProfile(tempId);
			updateBootstrapCache((data) => replaceRoomInBootstrap(data, tempId, created.room));
			await selectRoom(created.room.id, { closeMobileSidebar: false });
			setError(null);
		} catch (caught) {
			removeStoredRoomSelection(tempId);
			removeStoredNewSessionProfile(tempId);
			restoreBootstrapSnapshot(snapshot);
			setSelectedRoomId(selectedRoomId);
			setSelectedPiboSessionId(selectedPiboSessionId);
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoadingRoomId((current) => current === tempId ? null : current);
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
			writeStoredShowArchivedRooms(true);
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

	const runCommand = useCallback(async (text: string) => {
		if (!selectedPiboSessionId || selectedRoomArchived) return false;
		const commandText = text.trim().split(/\s+/)[0];
		const command = slashCommands.find((candidate) => candidate.slash === commandText);
		if (!command) return false;
		if (command.action === "thinking-show") {
			const next = !showThinking;
			setShowThinking(next);
			writeStoredShowThinking(next);
			return true;
		}
		if (command.action === "download") {
			const path = normalizeDownloadCommandPath(text.slice(commandText.length));
			if (!path) {
				setError("Usage: /download <path>");
				return true;
			}
			const key = `${selectedPiboSessionId}:${path}`;
			if (activeDownloadKeysRef.current.has(key)) {
				setDownloadStatus((current) => current?.key === key ? { ...current, duplicateAttempted: true } : {
					key,
					path,
					filename: fallbackDownloadFilename(path),
					receivedBytes: 0,
					status: "running",
					duplicateAttempted: true,
				});
				return true;
			}
			activeDownloadKeysRef.current.add(key);
			setDownloadStatus({ key, path, filename: fallbackDownloadFilename(path), receivedBytes: 0, status: "starting" });
			try {
				const result = await downloadChatFile(path, {
					piboSessionId: selectedPiboSessionId,
					roomId: selectedRoomId ?? undefined,
					onStart: (progress) => setDownloadStatus((current) => ({
						...progress,
						key,
						status: "running",
						duplicateAttempted: current?.key === key ? current.duplicateAttempted : false,
					})),
					onProgress: (progress) => setDownloadStatus((current) => ({
						...progress,
						key,
						status: "running",
						duplicateAttempted: current?.key === key ? current.duplicateAttempted : false,
					})),
				});
				setDownloadStatus((current) => ({
					...result,
					key,
					status: "completed",
					duplicateAttempted: current?.key === key ? current.duplicateAttempted : false,
				}));
				setError(null);
			} catch (caught) {
				const message = caught instanceof Error ? caught.message : String(caught);
				setDownloadStatus((current) => ({
					key,
					path,
					filename: current?.key === key ? current.filename : fallbackDownloadFilename(path),
					receivedBytes: current?.key === key ? current.receivedBytes : 0,
					totalBytes: current?.key === key ? current.totalBytes : undefined,
					status: "failed",
					error: message,
				}));
				setError(message);
			} finally {
				activeDownloadKeysRef.current.delete(key);
			}
			return true;
		}
		const params = commandActionParams(command.action, text.slice(commandText.length).trim());
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
			{gatewayMode === "fallback" ? <FallbackGatewayBanner /> : null}
			<div
				data-pibo-debug="chat-app"
				data-pibo-area={area}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-selected-session-id={selectedPiboSessionId ?? bootstrap.selectedPiboSessionId ?? undefined}
				className="h-dvh overflow-hidden bg-[#101d22] text-slate-200 grid grid-rows-[auto_auto_1fr]"
			>
				<AppHeader
					area={area}
					identity={identity}
					mobileAreaMenuOpen={mobileAreaMenuOpen}
					mobileAreaMenuRef={mobileAreaMenuRef}
					totalRoomUnreadCount={totalRoomUnreadCount}
					onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
					onSelectMainNavArea={selectMainNavArea}
					onToggleMobileAreaMenu={() => setMobileAreaMenuOpen((open) => !open)}
				/>

			<div>
				{error ? <AppErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
				{downloadStatus ? <DownloadStatusBanner status={downloadStatus} onDismiss={() => setDownloadStatus(null)} /> : null}
			</div>

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
						onAutosaveHandlerChange={updateAgentAutosaveHandler}
						creatingSession={creatingSession || selectedRoomArchived}
					/>
				) : area === "workflows" ? (
					<MinimalWorkflowsArea
						draftId={routeWorkflowDraftId}
						onNavigateDraft={(nextDraftId) => navigateToRoute({ area: "workflows", draftId: nextDraftId })}
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
							writeStoredShowRawEvents(next);
						}}
						onToggleThinking={() => {
							const next = !showThinking;
							setShowThinking(next);
							writeStoredShowThinking(next);
						}}
						onToggleExpandThinking={() => {
							const next = !expandThinking;
							setExpandThinking(next);
							writeStoredExpandThinking(next);
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
							onToggleArchivedRooms={toggleArchivedRooms}
							creatingRoom={creatingRoom}
							onCreateRoom={() => createRoom()}
							onSelectRoom={selectRoom}
							loadingRoomId={loadingRoomId}
							roomSessionsLoading={loadingSelectedRoom}
							onUpdateRoom={updateRoom}
							onArchiveRoom={setRoomArchived}
							onReadAllRoom={readAllRoom}
							onDeleteRoom={requestRoomDelete}
							newSessionProfile={newSessionProfile}
							newSessionProfileReady={newSessionProfileRoomId === (selectedRoomId ?? bootstrap.selectedRoomId)}
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
						roomNavigationPending={loadingSelectedRoom}
						sessionNavigationPending={Boolean(loadingPiboSessionId && loadingPiboSessionId === selectedPiboSessionId)}
						selectedSessionProfile={selectedSessionNode?.profile ?? defaultProfileFromBootstrap(bootstrap)}
						selectedSessionActiveModel={selectedSessionActiveModel}
						selectedSessionStatus={signalLegacyStatus(selectedSessionSignal ?? selectedRootSignal) ?? selectedSessionNode?.status}
						selectedSessionSignal={selectedSessionSignal}
						signals={sessionSignals ?? undefined}
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
							writeStoredShowRawEvents(next);
						}}
						onToggleThinking={() => {
							const next = !showThinking;
							setShowThinking(next);
							writeStoredShowThinking(next);
						}}
						onToggleExpandThinking={() => {
							const next = !expandThinking;
							setExpandThinking(next);
							writeStoredExpandThinking(next);
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
							onCancel={cancelRoomDelete}
							onDelete={() => void permanentlyDeleteRoom()}
						/>
					) : null}
					{deleteSessionTarget ? (
						<DeleteSessionModal
							session={deleteSessionTarget}
							confirmText={deleteSessionConfirmText}
							deleting={deletingSession}
							onConfirmTextChange={setDeleteSessionConfirmText}
							onCancel={cancelSessionDelete}
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

function DownloadStatusBanner({ status, onDismiss }: { status: ChatDownloadStatus; onDismiss: () => void }) {
	const running = status.status === "starting" || status.status === "running";
	const progressPercent = status.totalBytes && status.totalBytes > 0
		? Math.min(100, Math.max(0, (status.receivedBytes / status.totalBytes) * 100))
		: undefined;
	const tone = status.status === "failed"
		? "border-red-500/40 bg-red-500/10 text-red-100"
		: status.status === "completed"
			? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
			: "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-slate-100";
	const stateLabel = status.status === "completed" ? "Download ready" : status.status === "failed" ? "Download failed" : "Download in progress";
	return (
		<div className={`border-b px-4 py-2 text-sm ${tone}`} role="status" aria-live="polite">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="text-[11px] font-bold uppercase tracking-wider opacity-80">{stateLabel}</div>
					<div className="min-w-0 truncate font-medium" title={status.path}>{status.filename}</div>
					<div className="mt-1 text-xs text-slate-300">
						{downloadProgressLabel(status)}
						{status.duplicateAttempted && running ? <span className="ml-2 text-amber-200">Already downloading this file. Please wait.</span> : null}
					</div>
					{progressPercent !== undefined && running ? (
						<div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-[#0e1116]" aria-label={`Download progress ${Math.floor(progressPercent)}%`}>
							<div className="h-full bg-[#11a4d4] transition-[width]" style={{ width: `${progressPercent}%` }} />
						</div>
					) : null}
					{progressPercent === undefined && running ? <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-[#0e1116]"><div className="h-full w-1/3 animate-pulse bg-[#11a4d4]" /></div> : null}
				</div>
				{running ? null : (
					<button
						type="button"
						onClick={onDismiss}
						className="shrink-0 rounded-sm border border-slate-600 px-2 py-1 text-[11px] uppercase tracking-wider text-slate-200 hover:border-[#11a4d4] hover:text-[#11a4d4]"
					>
						Dismiss
					</button>
				)}
			</div>
		</div>
	);
}

function findAgentProfile(profiles: BootstrapData["agents"], name: string): BootstrapData["agents"][number] | undefined {
	return profiles.find((profile) => profile.name === name || profile.aliases.includes(name));
}

function profileExists(profiles: BootstrapData["agents"], name: string): boolean {
	return Boolean(findAgentProfile(profiles, name));
}
