import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { RefreshCw, X } from "lucide-react";
import { getBootstrap, getNavigation, getSessionPage, markRoomRead, markSessionRead, patchRoom, patchRoomOrder, patchSession, patchSessionOrder, postAction, postMessage, postRoom, postSession } from "./api-chat-sessions";
import { navigateToChatRoute, type ChatAppRoute, type NavigationOptions } from "./app-routes";
import { downloadChatFile, type ChatDownloadProgress } from "./api-chat-files";
import { fetchSignalStatuses, fetchSignalTree, subscribeSignalStatuses, subscribeSignalTree } from "./api-trace-signals";
import { listUserSkills } from "./api-agent-designer";
import type { AgentCatalog, BootstrapData, NavigationData, PiboSignalPatch, PiboSignalSnapshot, PiboSignalStatusPatch, PiboSignalStatusSnapshot, UserSkill } from "./types";
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
import { LoopArea } from "./LoopArea";
import type { PiPackageCatalogItem } from "./agents/agent-designer-model";
import { AgentsView } from "./agents/AgentsView";
import { SessionTracePane } from "./session-trace-pane";
import { SessionSidebar } from "./session-sidebar";
import { DesktopSessionSidebar, useDesktopSessionSidebar } from "./desktop-session-sidebar";
import { DESKTOP_COLLAPSED_SIDEBAR_WIDTH } from "./desktop-session-sidebar-model";
import { getChatSessionView } from "./session-views/registry";
import type { ChatSessionViewId, ToolDisplayMode } from "./session-views/types";
import {
	clearStoredSelection,
	readStoredComposerDraft,
	readStoredExpandThinking,
	readStoredNewSessionProfile,
	readStoredSelection,
	readStoredSessionView,
	readStoredShowArchivedRooms,
	readStoredShowArchivedSessions,
	readStoredDebugMode,
	readStoredShowThinking,
	readStoredToolDisplayMode,
	removeStoredNewSessionProfile,
	removeStoredRoomSelection,
	writeStoredComposerDraft,
	writeStoredExpandThinking,
	writeStoredNewSessionProfile,
	writeStoredSelection,
	writeStoredSessionView,
	writeStoredShowArchivedRooms,
	writeStoredShowArchivedSessions,
	writeStoredDebugMode,
	writeStoredShowThinking,
	writeStoredToolDisplayMode,
} from "./app-storage";
import {
	addRoomToBootstrap,
	addSessionNodeToBootstrap,
	applyBootstrapUpdateForRoom,
	createBootstrapMutationSnapshot,
	createOptimisticRoom,
	createOptimisticSessionNode,
	replaceOptimisticSessionNode,
	reorderRoomRootsInBootstrap,
	reorderSessionRootsInBootstrap,
	replaceRoomInBootstrap,
	resolveOptimisticSessionCreateOutcome,
	rollbackOptimisticSessionNode,
	restoreBootstrapSelection,
	roomWithArchivedState,
	sessionNodeFromSession,
	setRoomPinnedInBootstrap,
	setSessionPinnedInBootstrap,
	updateRoomInBootstrap,
	updateSessionFromPiboSession,
	updateSessionNodeInBootstrap,
	type BootstrapMutationSnapshot,
	type OptimisticSessionCreateOutcome,
} from "./app-bootstrap-mutations";
import {
	chatBootstrapQueryKey,
	chatSessionNavigationGeneration,
	chatSessionPageQueryKey,
	invalidateChatSessionNavigationCache,
	loadChatSessionNavigationQueryData,
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
	resolveRoomContextLabel,
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
	isSessionComposerDisabled,
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
import { classifyBootstrapError, type BootstrapErrorState } from "./app-bootstrap-error";
import { errorMessage } from "./error-message";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import { ResponsiveTabSidebarPanel } from "./responsive-pane-sidebar";
import { SettingsView } from "./settings/SettingsView";
import type { SettingsPanel } from "./settings/types";
import { MinimalWorkflowsArea } from "./MinimalWorkflowsArea";
import { CreateWorkflowSessionDialog, type WorkflowSessionSelection } from "./workflows/CreateWorkflowSessionDialog";
import { RoutedWorkflowsPanel } from "./desktop-workflow-version-panel";
import { VscodeArea } from "./VscodeArea";
import { DeleteRoomModal, DeleteSessionModal } from "./delete-confirmation-modals";
import { AppErrorBanner, AppHeader, BootstrapLoadError, FallbackGatewayBanner, SignedOut, type AppArea as Area } from "./app-chrome";
import { mobileSidebarA11yProps, useMobileSidebarModal, useMobileSidebarViewport } from "./mobile-sidebar-accessibility";
import {
	applySelectedSignalPatch,
	applySignalPatchToBootstrap,
	applySignalSnapshotToBootstrap,
	applySignalStatusPatch,
	applySignalStatusPatchToBootstrap,
	applySignalStatusSnapshotToBootstrap,
	retainSelectedSignalSnapshot,
	shouldCommitSelectedSignalSnapshot,
	shouldCommitSignalStatusSnapshot,
	shouldReconcileSelectedSignalTree,
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
import { roomSummaryStreamUrl, shouldRefreshNavigationFromRoomSummary } from "./room-summary-stream";
import { selectedSessionBackendId } from "./selected-session-backend";
import {
	DesktopTabSidebar,
	activateTabInDesktopTabs,
	desktopTabTool,
	openTargetInDesktopTabs,
	useDesktopTabWorkspace,
} from "./desktop-tabs";
import {
	activeDesktopTab,
	applyGuardedDesktopTabTransition,
	closeDesktopTab,
	type DesktopSessionTool,
	type DesktopTab,
	type DesktopTabTarget,
} from "./desktop-tabs-model";

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
const SIGNAL_TREE_INITIAL_FALLBACK_DELAY_MS = 5_000;
const SIGNAL_TREE_RECONCILE_INTERVAL_MS = 30_000;
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
	return loadChatSessionNavigationQueryData(
		queryClient,
		input,
		() => getNavigation(input.piboSessionId, input.includeArchived, input.roomId, { signal: input.signal }),
	);
}

export function App({ route }: { route: ChatAppRoute }) {
	countRender("App");
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const isMobileSidebarViewport = useMobileSidebarViewport();
	const desktopTabsEnabled = !isMobileSidebarViewport;
	const desktopWorkspace = useDesktopTabWorkspace(route, desktopTabsEnabled);
	const desktopSessionSidebar = useDesktopSessionSidebar();
	const desktopActiveTab = activeDesktopTab(desktopWorkspace.state);
	const desktopActiveTool = desktopTabTool(desktopActiveTab);
	const desktopPanelRoute = desktopActiveTab?.target.kind === "route" ? desktopActiveTab.target.route : undefined;
	const area: Area = desktopTabsEnabled ? "sessions" : route.area;
	const routeRoomId = route.area === "sessions" ? route.roomId : undefined;
	const routePiboSessionId = route.area === "sessions" || route.area === "context" ? route.piboSessionId : undefined;
	const routeSessionViewId = route.area === "sessions" ? route.sessionViewId : undefined;
	const routeWorkflowDraftId = route.area === "workflows" ? route.draftId : undefined;
	const settingsPanel: SettingsPanel = route.area === "settings" ? route.panel ?? "general" : "general";
	const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
	const selectedPiboSessionIdRef = useRef<string | null>(null);
	const optimisticSessionCreateOutcomeRef = useRef<OptimisticSessionCreateOutcome | null>(null);
	const [selectedPiboSessionId, setSelectedPiboSessionIdState] = useState<string | null>(null);
	const setSelectedPiboSessionId = useCallback<Dispatch<SetStateAction<string | null>>>((next) => {
		if (typeof next === "function") {
			setSelectedPiboSessionIdState((current) => {
				const resolved = next(current);
				selectedPiboSessionIdRef.current = resolved;
				return resolved;
			});
			return;
		}
		selectedPiboSessionIdRef.current = next;
		setSelectedPiboSessionIdState(next);
	}, []);
	const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [bootstrapError, setBootstrapError] = useState<BootstrapErrorState | null>(null);
	const [downloadStatus, setDownloadStatus] = useState<ChatDownloadStatus | null>(null);
	const activeDownloadKeysRef = useRef<Set<string>>(new Set());
	const [showThinking, setShowThinking] = useState(readStoredShowThinking);
	const [expandThinking, setExpandThinking] = useState(readStoredExpandThinking);
	const [debugMode, setDebugMode] = useState(readStoredDebugMode);
	const showRawEvents = false;
	const toggleDebugMode = () => setDebugMode((current) => {
		writeStoredDebugMode(!current);
		return !current;
	});
	const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>(readStoredToolDisplayMode);
	const [showArchived, setShowArchived] = useState(readStoredShowArchivedSessions);
	const [showArchivedRooms, setShowArchivedRooms] = useState(readStoredShowArchivedRooms);
	const [newSessionProfile, setNewSessionProfile] = useState("");
	const [newSessionProfileRoomId, setNewSessionProfileRoomId] = useState<string | null>(null);
	const [sessionViewId, setSessionViewId] = useState<ChatSessionViewId>(() => routeSessionViewId ?? readStoredSessionView());
	const [terminalFullscreen, setTerminalFullscreen] = useState(false);
	const [desktopPreviewFullscreen, setDesktopPreviewFullscreen] = useState(false);
	const [composerText, setComposerText] = useState("");
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [creatingSession, setCreatingSession] = useState(false);
	const [workflowSessionDialog, setWorkflowSessionDialog] = useState<{ selection?: WorkflowSessionSelection } | null>(null);
	const creatingSessionRef = useRef(false);
	const agentAutosaveHandlerRef = useRef<(() => Promise<void>) | null>(null);
	const skipNextAgentNavigationGuardRef = useRef(false);
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
	const [desktopToolHosts, setDesktopToolHosts] = useState<Partial<Record<DesktopSessionTool, Element | null>>>({});
	const desktopToolHostCallbacks = useMemo(() => {
		const tools: DesktopSessionTool[] = ["preview", "raw-events", "web-annotations", "runtime-requests", "session-inspector"];
		return Object.fromEntries(tools.map((tool) => [tool, (node: HTMLDivElement | null) => {
			setDesktopToolHosts((current) => current[tool] === node ? current : { ...current, [tool]: node });
		}])) as Record<DesktopSessionTool, (node: HTMLDivElement | null) => void>;
	}, []);
	useEffect(() => {
		if (!desktopTabsEnabled || desktopActiveTool !== "preview") setDesktopPreviewFullscreen(false);
	}, [desktopActiveTool, desktopTabsEnabled]);
	const mobileSidebarTriggerRef = useRef<HTMLButtonElement>(null);
	const hideMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
	const closeMobileSidebar = useMobileSidebarModal({
		isMobileViewport: isMobileSidebarViewport,
		isOpen: mobileSidebarOpen,
		onClose: hideMobileSidebar,
		triggerRef: mobileSidebarTriggerRef,
	});
	const [mobileAreaMenuOpen, setMobileAreaMenuOpen] = useState(false);
	const [gatewayMode, setGatewayMode] = useState<"main" | "fallback" | null>(null);
	const [sessionSignals, setSessionSignals] = useState<PiboSignalSnapshot | null>(null);
	const sessionSignalsRef = useRef<PiboSignalSnapshot | null>(null);
	const sessionStatusSignalsRef = useRef<PiboSignalStatusSnapshot | null>(null);
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
	const selectedRoomContextLabel = resolveRoomContextLabel(
		bootstrap?.rooms ?? [],
		activeRoomId,
		bootstrap?.room,
	);
	const selectedRoomArchived = selectedRoom ? isArchivedRoom(selectedRoom) : false;
	const loadingSelectedRoom = Boolean(loadingRoomId && loadingRoomId === selectedRoomId);
	const selectedBackendPiboSessionId = selectedSessionBackendId(selectedPiboSessionId);
	const overlayCurrentSignals = useCallback((data: BootstrapData): BootstrapData => {
		const statusSnapshot = sessionStatusSignalsRef.current;
		const withGlobalStatuses = statusSnapshot ? applySignalStatusSnapshotToBootstrap(data, statusSnapshot) : data;
		const selectedSnapshot = sessionSignalsRef.current;
		return data.selectedPiboSessionId && signalSnapshotIncludesSession(selectedSnapshot, data.selectedPiboSessionId)
			? applySignalSnapshotToBootstrap(withGlobalStatuses, selectedSnapshot)
			: withGlobalStatuses;
	}, []);

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

	const commitSignalStatusSnapshot = useCallback((snapshot: PiboSignalStatusSnapshot) => {
		if (!shouldCommitSignalStatusSnapshot(sessionStatusSignalsRef.current, snapshot)) return false;
		sessionStatusSignalsRef.current = snapshot;
		setBootstrap((current) => current ? applySignalStatusSnapshotToBootstrap(current, snapshot) : current);
		return true;
	}, []);

	const commitSignalStatusPatch = useCallback((patch: PiboSignalStatusPatch) => {
		const result = applySignalStatusPatch(sessionStatusSignalsRef.current, patch);
		if (result.needsRefresh) return false;
		sessionStatusSignalsRef.current = result.snapshot;
		setBootstrap((current) => current ? applySignalStatusPatchToBootstrap(current, patch) : current);
		return true;
	}, []);

	useEffect(() => {
		if (area === "sessions" && selectedBackendPiboSessionId) return undefined;
		let active = true;
		let signalRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const controller = new AbortController();
		const refreshSignalStatuses = (delayMs: number) => {
			if (!active) return;
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			signalRecoveryTimer = setTimeout(() => {
				signalRecoveryTimer = undefined;
				fetchSignalStatuses({ signal: controller.signal })
					.then((snapshot) => {
						if (active && !controller.signal.aborted) commitSignalStatusSnapshot(snapshot);
					})
					.catch(() => {
						if (!controller.signal.aborted) refreshSignalStatuses(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS);
					});
			}, delayMs);
		};
		const signalStatusHandlers = {
			onSnapshot: (snapshot: PiboSignalStatusSnapshot) => {
				if (!active || !shouldCommitSignalStatusSnapshot(sessionStatusSignalsRef.current, snapshot)) return;
				if (signalRecoveryTimer) {
					clearTimeout(signalRecoveryTimer);
					signalRecoveryTimer = undefined;
				}
				commitSignalStatusSnapshot(snapshot);
			},
			onPatch: (patch: PiboSignalStatusPatch) => {
				if (active && !commitSignalStatusPatch(patch)) refreshSignalStatuses(0);
			},
			onError: () => refreshSignalStatuses(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS),
		};
		let unsubscribeSignalStatuses: () => void = () => undefined;
		const reconnectSignalStatuses = () => {
			if (!active) return;
			unsubscribeSignalStatuses();
			unsubscribeSignalStatuses = subscribeSignalStatuses(signalStatusHandlers);
		};
		const refreshVisibleSignalStatuses = () => {
			if (document.visibilityState === "visible") reconnectSignalStatuses();
		};
		unsubscribeSignalStatuses = subscribeSignalStatuses(signalStatusHandlers);
		window.addEventListener("pageshow", reconnectSignalStatuses);
		document.addEventListener("visibilitychange", refreshVisibleSignalStatuses);
		return () => {
			active = false;
			controller.abort();
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			window.removeEventListener("pageshow", reconnectSignalStatuses);
			document.removeEventListener("visibilitychange", refreshVisibleSignalStatuses);
			unsubscribeSignalStatuses();
		};
	}, [area, commitSignalStatusPatch, commitSignalStatusSnapshot, selectedBackendPiboSessionId]);

	useEffect(() => {
		if (area !== "sessions" || !selectedBackendPiboSessionId) {
			sessionSignalsRef.current = null;
			setSessionSignals(null);
			return;
		}
		const retainedSnapshot = retainSelectedSignalSnapshot(sessionSignalsRef.current, selectedBackendPiboSessionId);
		sessionSignalsRef.current = retainedSnapshot;
		setSessionSignals(retainedSnapshot);

		let active = true;
		let signalRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
		let signalStatusRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const controller = new AbortController();
		const commitSignalSnapshot = (snapshot: PiboSignalSnapshot) => {
			if (!active || controller.signal.aborted || !shouldCommitSelectedSignalSnapshot(sessionSignalsRef.current, snapshot, selectedBackendPiboSessionId)) return;
			sessionSignalsRef.current = snapshot;
			setSessionSignals(snapshot);
			setBootstrap((current) => current ? applySignalSnapshotToBootstrap(current, snapshot) : current);
		};
		const refreshSignalSnapshot = (delayMs: number) => {
			if (!active) return;
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			signalRecoveryTimer = setTimeout(() => {
				signalRecoveryTimer = undefined;
				fetchSignalTree(selectedBackendPiboSessionId, { signal: controller.signal })
					.then(commitSignalSnapshot)
					.catch(() => {
						if (!controller.signal.aborted) refreshSignalSnapshot(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS);
					});
			}, delayMs);
		};
		const refreshSignalStatuses = (delayMs: number) => {
			if (!active) return;
			if (signalStatusRecoveryTimer) clearTimeout(signalStatusRecoveryTimer);
			signalStatusRecoveryTimer = setTimeout(() => {
				signalStatusRecoveryTimer = undefined;
				fetchSignalStatuses({ signal: controller.signal })
					.then((snapshot) => {
						if (active && !controller.signal.aborted) commitSignalStatusSnapshot(snapshot);
					})
					.catch(() => {
						if (!controller.signal.aborted) refreshSignalStatuses(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS);
					});
			}, delayMs);
		};
		const signalTreeHandlers = {
			onSnapshot: (snapshot: PiboSignalSnapshot) => {
				if (!active || !shouldCommitSelectedSignalSnapshot(sessionSignalsRef.current, snapshot, selectedBackendPiboSessionId)) return;
				if (signalRecoveryTimer) {
					clearTimeout(signalRecoveryTimer);
					signalRecoveryTimer = undefined;
				}
				commitSignalSnapshot(snapshot);
			},
			onPatch: (patch: PiboSignalPatch) => {
				if (!active) return;
				const result = applySelectedSignalPatch(sessionSignalsRef.current, patch, selectedBackendPiboSessionId);
				if (result.needsRefresh) {
					refreshSignalSnapshot(0);
					return;
				}
				sessionSignalsRef.current = result.snapshot;
				setSessionSignals(result.snapshot);
				setBootstrap((bootstrapData) => bootstrapData ? applySignalPatchToBootstrap(bootstrapData, patch) : bootstrapData);
			},
			onStatusSnapshot: (snapshot: PiboSignalStatusSnapshot) => {
				if (!active || !shouldCommitSignalStatusSnapshot(sessionStatusSignalsRef.current, snapshot)) return;
				if (signalStatusRecoveryTimer) {
					clearTimeout(signalStatusRecoveryTimer);
					signalStatusRecoveryTimer = undefined;
				}
				commitSignalStatusSnapshot(snapshot);
			},
			onStatusPatch: (patch: PiboSignalStatusPatch) => {
				if (active && !commitSignalStatusPatch(patch)) refreshSignalStatuses(0);
			},
			onError: () => {
				refreshSignalSnapshot(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS);
				refreshSignalStatuses(SIGNAL_TREE_ERROR_RECOVERY_DELAY_MS);
			},
		};
		let unsubscribeSignalTree: () => void = () => undefined;
		const reconnectSignalTree = () => {
			if (!active) return;
			unsubscribeSignalTree();
			unsubscribeSignalTree = subscribeSignalTree(selectedBackendPiboSessionId, signalTreeHandlers);
			refreshSignalSnapshot(SIGNAL_TREE_INITIAL_FALLBACK_DELAY_MS);
		};
		const refreshVisibleSignalTree = () => {
			if (document.visibilityState === "visible") reconnectSignalTree();
		};
		const shouldReconcileSignalTree = () => {
			const selectedSession = bootstrapRef.current ? findSessionNode(bootstrapRef.current.sessions, selectedBackendPiboSessionId) : undefined;
			return shouldReconcileSelectedSignalTree(sessionSignalsRef.current, selectedBackendPiboSessionId, selectedSession?.status);
		};
		unsubscribeSignalTree = subscribeSignalTree(selectedBackendPiboSessionId, signalTreeHandlers);
		window.addEventListener("pageshow", reconnectSignalTree);
		document.addEventListener("visibilitychange", refreshVisibleSignalTree);
		const signalReconcileTimer = window.setInterval(() => {
			if (document.visibilityState === "visible" && shouldReconcileSignalTree()) refreshSignalSnapshot(0);
		}, SIGNAL_TREE_RECONCILE_INTERVAL_MS);
		refreshSignalSnapshot(SIGNAL_TREE_INITIAL_FALLBACK_DELAY_MS);
		return () => {
			active = false;
			controller.abort();
			if (signalRecoveryTimer) clearTimeout(signalRecoveryTimer);
			if (signalStatusRecoveryTimer) clearTimeout(signalStatusRecoveryTimer);
			window.removeEventListener("pageshow", reconnectSignalTree);
			document.removeEventListener("visibilitychange", refreshVisibleSignalTree);
			window.clearInterval(signalReconcileTimer);
			unsubscribeSignalTree();
		};
	}, [area, commitSignalStatusPatch, commitSignalStatusSnapshot, selectedBackendPiboSessionId]);

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
		if (area !== "sessions") return;
		const next = routeSessionViewId ?? readStoredSessionView();
		setSessionViewId((current) => (current === next ? current : next));
	}, [area, routeSessionViewId]);

	useEffect(() => {
		writeStoredSessionView(sessionViewId);
	}, [sessionViewId]);

	useEffect(() => {
		setTerminalFullscreen(false);
	}, [area]);

	useEffect(() => {
		if (area === "sessions" && sessionViewId !== "terminal") setTerminalFullscreen(false);
	}, [area, sessionViewId]);

	const enterTerminalFullscreen = useCallback(() => {
		setMobileSidebarOpen(false);
		setMobileAreaMenuOpen(false);
		setTerminalFullscreen(true);
	}, []);
	const navigateToRoute = useCallback(
		(target: ChatAppRoute, replace = false, nextSessionViewId = sessionViewId, options: NavigationOptions = {}) => {
			if (options.closeMobileSidebar !== false) closeMobileSidebar();
			navigateToChatRoute(
				navigate,
				target,
				replace,
				nextSessionViewId,
				options.preserveHash === true,
				options.preserveSearch === true,
			);
		},
		[closeMobileSidebar, navigate, sessionViewId],
	);

	const updateAgentAutosaveHandler = useCallback((handler: (() => Promise<void>) | null) => {
		agentAutosaveHandlerRef.current = handler;
	}, []);
	const flushAgentBeforeNavigation = useCallback(async ({ current, next }: { current: { pathname: string }; next: { pathname: string } }) => {
		if (current.pathname === next.pathname) return false;
		if (skipNextAgentNavigationGuardRef.current) {
			skipNextAgentNavigationGuardRef.current = false;
			return false;
		}
		const autosave = agentAutosaveHandlerRef.current;
		if (!autosave) return false;
		try {
			await autosave();
			return false;
		} catch (caught) {
			setError(`Agent Designer changes were not saved: ${caught instanceof Error ? caught.message : String(caught)}`);
			return true;
		}
	}, []);
	useBlocker({
		disabled: desktopTabsEnabled
			? desktopActiveTab?.target.kind !== "route" || desktopActiveTab.target.route.area !== "agents"
			: area !== "agents",
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
			chatSessionNavigationGeneration(queryClient),
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
			if (selectedPiboSessionId && !selectedBackendPiboSessionId) return;
			inFlight = true;
			loadNavigation(selectedBackendPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId ?? undefined, { force: true })
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
	}, [activeRoomId, area, loadNavigation, selectedBackendPiboSessionId, selectedPiboSessionId]);

	useEffect(() => {
		const stored = readStoredSelection();
		const { requestedRoomId, requestedPiboSessionId } = routeSelectionRequest(route, stored);

		const canonicalizeSessionsRoute = (data: BootstrapData, replace = true) => {
			const selection = sessionsRouteCanonicalSelection(route, data);
			if (!selection) return;
			navigateToSelectedSession(selection.selectedRoomId, selection.selectedPiboSessionId, replace, {
				preserveHash: true,
				preserveSearch: true,
			});
		};

		if (shouldSkipRouteSelectionLoad({ bootstrap, creatingSession: creatingSessionRef.current, route })) return;

		const loadRouteData = bootstrap ? loadNavigation : loadBootstrap;
		const clearBootstrapError = () => {
			setBootstrapError(null);
			setError(null);
		};
		const reportBootstrapError = (caught: unknown) => {
			if (!bootstrapRef.current) setBootstrapError(classifyBootstrapError(caught));
			setError(errorMessage(caught));
		};

		loadRouteData(requestedPiboSessionId, showArchivedRef.current, requestedRoomId)
			.then((data) => {
				canonicalizeSessionsRoute(data);
				clearBootstrapError();
			})
			.catch((caught) => {
				if (route.area === "sessions" && routeRoomId && !routePiboSessionId && requestedPiboSessionId) {
					removeStoredRoomSelection(routeRoomId);
					loadRouteData(undefined, showArchivedRef.current, routeRoomId)
						.then((data) => {
							canonicalizeSessionsRoute(data);
							clearBootstrapError();
						})
						.catch(reportBootstrapError);
					return;
				}
				const explicitRouteSelection = hasExplicitSessionsRouteSelection(route);
				if (explicitRouteSelection || (!requestedPiboSessionId && !requestedRoomId)) {
					reportBootstrapError(caught);
					return;
				}
				clearStoredSelection();
				loadRouteData()
					.then((data) => {
						canonicalizeSessionsRoute(data);
						clearBootstrapError();
					})
					.catch(reportBootstrapError);
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
	const updateBootstrapCacheForRoom = useCallback((roomId: string, updater: (data: BootstrapData) => BootstrapData) => {
		setBootstrap((current) => current ? applyBootstrapUpdateForRoom(current, roomId, updater) : current);
		queryClient.setQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }, (current) =>
			current ? applyBootstrapUpdateForRoom(current, roomId, updater) : current,
		);
	}, [queryClient]);
	const prepareSessionNavigationMutation = useCallback(async () => {
		bootstrapRequestId.current += 1;
		navigationInFlightRef.current.clear();
		await Promise.all([
			queryClient.cancelQueries({ queryKey: ["chat", "bootstrap"] }),
			invalidateChatSessionNavigationCache(queryClient),
		]);
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
		let events: EventSource | undefined;
		let navigationTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleNavigationRefresh = () => {
			if (selectedPiboSessionId && !selectedBackendPiboSessionId) return;
			if (navigationTimer) clearTimeout(navigationTimer);
			navigationTimer = setTimeout(() => {
				navigationTimer = undefined;
				loadNavigation(selectedBackendPiboSessionId ?? undefined, showArchivedRef.current, activeRoomId, { force: true })
					.catch((caught) => {
						if (!isAbortError(caught)) setError(errorMessage(caught));
					});
			}, 900);
		};
		const handleRoomSummaryEvent = (message: Event) => {
			const event = chatStreamEvent(message as MessageEvent);
			if (!event || event.type === "ready") return;
			const messageStreamId = streamIdFromEventSourceId((message as MessageEvent).lastEventId);
			const replayFrame = messageStreamId !== undefined && messageStreamId <= latestRoomStreamId;
			const targetPiboSessionId = event.piboSessionId;
			const streamStatus = liveSessionStatusFromEvent(event);
			if (targetPiboSessionId && streamStatus) {
				const signalStatus = sessionStatusSignalsRef.current?.sessions[targetPiboSessionId]?.status
					?? signalLegacyStatus(sessionSignalsRef.current?.sessions[targetPiboSessionId]);
				const status = signalStatus ?? streamStatus;
				const lastActivityAt = new Date().toISOString();
				updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, targetPiboSessionId, (node) => ({ ...node, status, lastActivityAt })));
			}
			if (shouldRefreshNavigationFromRoomSummary({
				replayFrame,
				eventRefreshesNavigation: eventShouldRefreshNavigation(event),
				targetPiboSessionId,
				selectedBackendPiboSessionId: selectedBackendPiboSessionId ?? undefined,
			})) scheduleNavigationRefresh();
		};
		const suspendRoomSummary = () => {
			if (navigationTimer) clearTimeout(navigationTimer);
			navigationTimer = undefined;
			events?.close();
			events = undefined;
		};
		const connectRoomSummary = () => {
			suspendRoomSummary();
			events = new EventSource(roomSummaryUrl);
			events.addEventListener("pibo", handleRoomSummaryEvent);
		};
		connectRoomSummary();
		window.addEventListener("pagehide", suspendRoomSummary);
		window.addEventListener("pageshow", connectRoomSummary);
		return () => {
			window.removeEventListener("pagehide", suspendRoomSummary);
			window.removeEventListener("pageshow", connectRoomSummary);
			suspendRoomSummary();
		};
	}, [activeRoomId, area, bootstrap?.selectedRoomId, latestRoomStreamId, loadNavigation, selectedBackendPiboSessionId, selectedPiboSessionId, updateBootstrapCache]);

	const restoreBootstrapSnapshot = useCallback((
		snapshot: BootstrapMutationSnapshot | undefined,
		selectedPiboSessionIdOverride?: string | null,
	) => {
		if (!snapshot) return;
		setBootstrap(restoreBootstrapSelection(snapshot.localBootstrap, selectedPiboSessionIdOverride) ?? null);
		for (const [queryKey, data] of snapshot.queryData) {
			queryClient.setQueryData(queryKey, restoreBootstrapSelection(data, selectedPiboSessionIdOverride) ?? undefined);
		}
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
		onMutate: async ({ profile, roomId }) => {
			optimisticSessionCreateOutcomeRef.current = null;
			await prepareSessionNavigationMutation();
			const originRoomId = roomId ?? bootstrap?.selectedRoomId ?? "";
			const previousSelectedPiboSessionId = selectedPiboSessionIdRef.current;
			const tempId = `optimistic-session-${createClientTxnId()}`;
			if (bootstrapRef.current?.selectedRoomId === originRoomId) setSelectedPiboSessionId(tempId);
			updateBootstrapCacheForRoom(originRoomId, (current) => {
				const optimisticNode = createOptimisticSessionNode(tempId, profile || defaultProfileFromBootstrap(current));
				const next = addSessionNodeToBootstrap(current, optimisticNode);
				return { ...next, selectedPiboSessionId: tempId };
			});
			return { tempId, previousSelectedPiboSessionId, originRoomId };
		},
		onError: (_error, _variables, context) => {
			const outcome = resolveOptimisticSessionCreateOutcome({
				status: "failure",
				currentSelectedPiboSessionId: selectedPiboSessionIdRef.current,
				tempId: context?.tempId,
				previousSelectedPiboSessionId: context?.previousSelectedPiboSessionId,
			});
			optimisticSessionCreateOutcomeRef.current = outcome;
			if (context?.originRoomId && context.tempId) {
				updateBootstrapCacheForRoom(context.originRoomId, (current) =>
					rollbackOptimisticSessionNode(current, context.tempId, context.previousSelectedPiboSessionId ?? null),
				);
			}
			setSelectedPiboSessionId(outcome.selectedPiboSessionId);
		},
		onSuccess: (created, _variables, context) => {
			const outcome = resolveOptimisticSessionCreateOutcome({
				status: "success",
				currentSelectedPiboSessionId: selectedPiboSessionIdRef.current,
				tempId: context?.tempId,
				previousSelectedPiboSessionId: context?.previousSelectedPiboSessionId,
				createdPiboSessionId: created.session.id,
			});
			optimisticSessionCreateOutcomeRef.current = outcome;
			if (context?.originRoomId) {
				updateBootstrapCacheForRoom(context.originRoomId, (current) =>
					replaceOptimisticSessionNode(current, context.tempId, sessionNodeFromSession(created.session)),
				);
			}
			setSelectedPiboSessionId(outcome.selectedPiboSessionId);
		},
	});

	const renameSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, title }: { piboSessionId: string; title: string | null }) => patchSession(piboSessionId, { title }),
		onMutate: async ({ piboSessionId, title }) => {
			await prepareSessionNavigationMutation();
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
			await prepareSessionNavigationMutation();
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => updateSessionNodeInBootstrap(data, piboSessionId, (node) => ({ ...node, archived, unreadCount: archived ? 0 : node.unreadCount })));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const pinSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, pinned }: { piboSessionId: string; pinned: boolean }) => patchSession(piboSessionId, { pinned }),
		onMutate: async ({ piboSessionId, pinned }) => {
			await prepareSessionNavigationMutation();
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => setSessionPinnedInBootstrap(data, piboSessionId, pinned));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ session }) => updateBootstrapCache((data) => updateSessionFromPiboSession(data, session)),
	});

	const reorderSessionMutation = useMutation({
		mutationFn: ({ piboSessionId, targetPiboSessionId, position }: { piboSessionId: string; targetPiboSessionId: string; position: "before" | "after" }) =>
			patchSessionOrder(piboSessionId, { targetPiboSessionId, position }),
		onMutate: async ({ piboSessionId, targetPiboSessionId, position }) => {
			await prepareSessionNavigationMutation();
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => reorderSessionRootsInBootstrap(data, piboSessionId, targetPiboSessionId, position));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
	});

	const pinRoomMutation = useMutation({
		mutationFn: ({ roomId, pinned }: { roomId: string; pinned: boolean }) => patchRoom(roomId, { pinned }),
		onMutate: async ({ roomId, pinned }) => {
			await prepareSessionNavigationMutation();
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => setRoomPinnedInBootstrap(data, roomId, pinned));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
		onSuccess: ({ room }) => updateBootstrapCache((data) => updateRoomInBootstrap(data, room.id, (current) => ({ ...room, children: current.children }))),
	});

	const reorderRoomMutation = useMutation({
		mutationFn: ({ roomId, targetRoomId, position }: { roomId: string; targetRoomId: string; position: "before" | "after" }) =>
			patchRoomOrder(roomId, { targetRoomId, position }),
		onMutate: async ({ roomId, targetRoomId, position }) => {
			await prepareSessionNavigationMutation();
			const snapshot = createBootstrapMutationSnapshot(queryClient, bootstrap);
			updateBootstrapCache((data) => reorderRoomRootsInBootstrap(data, roomId, targetRoomId, position));
			return { snapshot };
		},
		onError: (_error, _variables, context) => restoreBootstrapSnapshot(context?.snapshot),
	});

	const sendMessageMutation = useMutation({
		mutationFn: ({ piboSessionId, text, clientTxnId, roomId, webAnnotationIds, fileAttachmentPaths, delivery }: { piboSessionId: string; text: string; clientTxnId: string; roomId?: string; webAnnotationIds?: readonly string[]; fileAttachmentPaths?: readonly string[]; delivery?: "queue" | "steer" }) =>
			postMessage(piboSessionId, text, clientTxnId, roomId, webAnnotationIds, fileAttachmentPaths, delivery),
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
			const data = await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined);
			if (area === "sessions") navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
			await refreshTrace(selectedPiboSessionId);
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, [area, bootstrap, loadBootstrap, navigateToSelectedSession, refreshTrace, selectedPiboSessionId, selectedRoomId]);

	const slashCommands = useMemo(() => buildSlashCommands(bootstrap?.capabilities.actions ?? []), [bootstrap]);
	const skills = useMemo(() => availableSkillsForSession(bootstrap, selectedPiboSessionId), [bootstrap, selectedPiboSessionId]);

	const selectSession = useCallback(async (piboSessionId: string) => {
		const targetRoomId = selectedRoomId ?? bootstrap?.selectedRoomId;
		flushSync(() => {
			setSelectedPiboSessionId(piboSessionId);
			setLoadingPiboSessionId(piboSessionId);
			closeMobileSidebar();
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
	}, [bootstrap?.selectedRoomId, closeMobileSidebar, loadNavigation, navigateToSelectedSession, selectedRoomId, updateBootstrapCache]);

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
			closeMobileSidebar();
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
	}, [closeMobileSidebar, loadNavigation, navigateToSelectedSession]);

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
		const originRoomId = selectedRoomId ?? bootstrap?.selectedRoomId ?? "";
		creatingSessionRef.current = true;
		setCreatingSession(true);
		try {
			const created = await createSessionMutation.mutateAsync({ profile, roomId: originRoomId || undefined });
			const outcome = optimisticSessionCreateOutcomeRef.current;
			if (outcome?.autoRenameCreatedSession) setAutoRenameSessionId(created.session.id);
			if (outcome?.navigateToCreatedSession) {
				navigateToSelectedSession(originRoomId || undefined, created.session.id, false, { closeMobileSidebar: false });
				const data = await loadBootstrap(created.session.id, showArchivedRef.current, originRoomId || undefined, { force: true });
				navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId, false, { closeMobileSidebar: false });
			}
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			optimisticSessionCreateOutcomeRef.current = null;
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

	const setSessionPinned = async (piboSessionId: string, pinned: boolean) => {
		try {
			await pinSessionMutation.mutateAsync({ piboSessionId, pinned });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const reorderSession = async (piboSessionId: string, targetPiboSessionId: string, position: "before" | "after") => {
		try {
			await reorderSessionMutation.mutateAsync({ piboSessionId, targetPiboSessionId, position });
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

	const setRoomPinned = async (roomId: string, pinned: boolean) => {
		try {
			await pinRoomMutation.mutateAsync({ roomId, pinned });
			setError(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const reorderRoom = async (roomId: string, targetRoomId: string, position: "before" | "after") => {
		try {
			await reorderRoomMutation.mutateAsync({ roomId, targetRoomId, position });
			setError(null);
		} catch (caught) {
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
	const openWorkflowSessionDialog = useCallback((workflowId?: string, workflowVersion?: string) => {
		setWorkflowSessionDialog({ ...(workflowId && workflowVersion ? { selection: { workflowId, workflowVersion } } : {}) });
	}, []);
	const acceptCreatedWorkflowSession = useCallback(async (result: { session: { id: string } }, roomId?: string) => {
		const data = await loadBootstrap(result.session.id, showArchivedRef.current, roomId, { force: true });
		setSessionViewId("workflow");
		navigateToRoute({ area: "sessions", roomId: data.selectedRoomId, piboSessionId: result.session.id }, false, "workflow");
	}, [loadBootstrap, navigateToRoute]);

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
			setBootstrap((current) => current
				? overlayCurrentSignals({ ...current, sessions: appendSessionRoots(current.sessions, page.sessions) })
				: current);
			if (archived) setVisibleArchivedSessionCount((current) => current + limit);
			else setVisibleActiveSessionCount((current) => current + limit);
		} finally {
			if (archived) setLoadingArchivedSessions(false);
			else setLoadingActiveSessions(false);
		}
	}, [activeRoomId, overlayCurrentSignals, queryClient, selectedPiboSessionId, visibleActiveSessions, visibleArchivedSessions]);

	if (bootstrapError && !bootstrap) {
		return bootstrapError.kind === "authentication-required"
			? <SignedOut message={bootstrapError.message} />
			: <BootstrapLoadError message={bootstrapError.message} onRetry={() => window.location.reload()} />;
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
	const isTerminalFullscreen = terminalFullscreen
		&& area === "sessions"
		&& sessionViewId === "terminal";
	const isDesktopPreviewFullscreen = desktopTabsEnabled
		&& desktopPreviewFullscreen
		&& desktopActiveTool === "preview";
	const isAppFullscreen = isTerminalFullscreen || isDesktopPreviewFullscreen;
	const routeShellClassName = isTerminalFullscreen
		? "h-full overflow-hidden grid grid-cols-[minmax(0,1fr)]"
		: (area === "vscode" || area === "workflows" || area === "cron" || area === "loops" || area === "agents")
			? "h-full overflow-hidden"
			: `grid ${area === "sessions" && showRawEvents
				? "grid-cols-[300px_minmax(0,1fr)_320px] max-[980px]:grid-cols-1"
				: "grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1"
			}`;
	const selectMainNavArea = (item: Area) => {
		setMobileAreaMenuOpen(false);
		if (item === "sessions") {
			navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
			return;
		}
		navigateToRoute({ area: item });
	};
	const desktopSessionsRoute: Extract<ChatAppRoute, { area: "sessions" }> = {
		area: "sessions",
		...(selectedRoomId ?? bootstrap.selectedRoomId ? { roomId: selectedRoomId ?? bootstrap.selectedRoomId } : {}),
		...(selectedPiboSessionId ?? bootstrap.selectedPiboSessionId ? { piboSessionId: selectedPiboSessionId ?? bootstrap.selectedPiboSessionId } : {}),
	};
	const applyDesktopWorkspaceTransition = async (
		next: typeof desktopWorkspace.state,
		options: { saveClosingTab?: DesktopTab } = {},
	): Promise<boolean> => {
		const currentActive = activeDesktopTab(desktopWorkspace.state);
		const closingAgent = options.saveClosingTab?.target.kind === "route" && options.saveClosingTab.target.route.area === "agents";
		const savesAgent = Boolean(closingAgent || (currentActive?.target.kind === "route" && currentActive.target.route.area === "agents" && currentActive.id !== next.activeTabId));
		const result = await applyGuardedDesktopTabTransition({
			current: desktopWorkspace.state,
			next,
			sessionsRoute: desktopSessionsRoute,
			closingTab: options.saveClosingTab,
			autosave: agentAutosaveHandlerRef.current,
			onCommit: desktopWorkspace.setState,
			onNavigate: (target) => {
				if (savesAgent) skipNextAgentNavigationGuardRef.current = true;
				navigateToRoute(target);
				if (savesAgent) window.setTimeout(() => { skipNextAgentNavigationGuardRef.current = false; }, 0);
			},
		});
		if (!result.allowed) {
			setError(`Agent Designer changes were not saved: ${result.error instanceof Error ? result.error.message : String(result.error)}`);
			return false;
		}
		return true;
	};
	const setDesktopWorkspaceState = (next: typeof desktopWorkspace.state) => {
		void applyDesktopWorkspaceTransition(next);
	};
	const openDesktopTarget = async (target: DesktopTabTarget) => {
		const next = openTargetInDesktopTabs(desktopWorkspace.state, target);
		await applyDesktopWorkspaceTransition(next);
	};
	const activateDesktopWorkspaceTab = async (tab: DesktopTab) => {
		await applyDesktopWorkspaceTransition(activateTabInDesktopTabs(desktopWorkspace.state, tab.id));
	};
	const closeDesktopWorkspaceTab = async (tab: DesktopTab): Promise<boolean> => {
		return applyDesktopWorkspaceTransition(closeDesktopTab(desktopWorkspace.state, tab.id), { saveClosingTab: tab });
	};
	const closeDesktopSessionTool = (tool: DesktopSessionTool) => {
		const tab = desktopWorkspace.state.tabs.find((candidate) => candidate.target.kind === "session-tool" && candidate.target.tool === tool);
		if (tab) void closeDesktopWorkspaceTab(tab);
	};
	const focusDesktopSessions = async (newTab?: DesktopTab) => {
		if (newTab && !await closeDesktopWorkspaceTab(newTab)) return;
		navigateToSelectedSession(selectedRoomId ?? bootstrap.selectedRoomId, selectedPiboSessionId ?? bootstrap.selectedPiboSessionId);
		window.setTimeout(() => document.querySelector<HTMLElement>('[data-pibo-debug="desktop-session-sidebar"] button')?.focus(), 0);
	};
	const renderDesktopPanel = (tab: DesktopTab, active: boolean) => {
		if (tab.target.kind === "new-tab") return null;
		if (tab.target.kind === "session-tool") {
			return <div ref={desktopToolHostCallbacks[tab.target.tool]} className={`h-full min-h-0 overflow-hidden ${tab.target.tool === "preview" ? "flex flex-col" : ""}`} data-pibo-debug={`desktop-session-tool-${tab.target.tool}`} />;
		}
		const panelRoute = tab.target.route;
		if (panelRoute.area === "vscode") return <VscodeArea integration={bootstrap.integrations?.vscode} />;
		if (panelRoute.area === "cron") return <CronArea bootstrap={bootstrap} mobileSidebarOpen={false} onCloseMobileSidebar={() => undefined} surface="tab" />;
		if (panelRoute.area === "loops") return <LoopArea bootstrap={bootstrap} mobileSidebarOpen={false} onCloseMobileSidebar={() => undefined} surface="tab" />;
		if (panelRoute.area === "agents") {
			return (
				<AgentsView
					agents={bootstrap.agents}
					initialCustomAgents={bootstrap.customAgents}
					initialAgentFolders={bootstrap.agentFolders}
					initialCatalog={bootstrap.agentCatalog}
					modelCatalog={bootstrap.modelCatalog}
					onCreateSession={(profile) => void createSession(profile)}
					onEditContextFile={openContextFileEditor}
					onEditMcpServer={openMcpToolsEditor}
					onAgentsChanged={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { selectSession: false })}
					onAutosaveHandlerChange={updateAgentAutosaveHandler}
					creatingSession={creatingSession || selectedRoomArchived}
					mobileSidebarOpen={false}
					isMobileSidebarViewport={false}
					onCloseMobileSidebar={() => undefined}
					surface="tab"
				/>
			);
		}
		if (panelRoute.area === "workflows") {
			return (
				<RoutedWorkflowsPanel
					route={panelRoute}
					surface="desktop"
					fallback={<MinimalWorkflowsArea room={bootstrap.room} draftId={panelRoute.draftId} onNavigateDraft={(draftId) => { if (active) navigateToRoute({ area: "workflows", draftId }); }} onCreateWorkflowSession={openWorkflowSessionDialog} />}
				/>
			);
		}
		if (panelRoute.area === "context") {
			return (
				<ResponsiveTabSidebarPanel
					label="Context"
					sidebar={<ContextSidebar activePanel={contextPanel} onSelect={setContextPanel} toolCount={bootstrap.agentCatalog?.piboTools.length ?? 0} mcpServerCount={bootstrap.agentCatalog?.mcpServers.length ?? 0} />}
					contentOverflow="hidden"
				>
					{contextPanel === "pibo-tools" ? <PiboToolsView tools={bootstrap.agentCatalog?.piboTools ?? []} /> : contextPanel === "mcp-tools" ? <McpToolsView servers={bootstrap.agentCatalog?.mcpServers ?? []} selectedServerName={selectedMcpServerName} onServerSaved={updateMcpServerInBootstrap} /> : contextPanel === "build-context" ? <ContextBuildView piboSessionId={panelRoute.piboSessionId ?? selectedPiboSessionId} /> : contextPanel === "base-prompt" ? <BasePromptView /> : contextPanel === "compaction-prompt" ? <CompactionPromptView /> : <ContextFilesView agentProfiles={contextAgentProfiles} selectedFileKey={selectedContextFileKey} />}
				</ResponsiveTabSidebarPanel>
			);
		}
		const panel = panelRoute.panel ?? "general";
		return (
			<ResponsiveTabSidebarPanel
				label="Settings"
				sidebar={<SettingsSidebar activePanel={panel} onSelect={(nextPanel) => navigateToRoute({ area: "settings", panel: nextPanel })} piPackageCount={bootstrap.agentCatalog?.piPackages.length ?? 0} userSkillCount={bootstrap.agentCatalog?.userSkills.length ?? 0} />}
			>
				<SettingsView activePanel={panel} showThinking={showThinking} setShowThinking={setShowThinking} expandThinking={expandThinking} setExpandThinking={setExpandThinking} modelDefaults={bootstrap.modelDefaults} modelCatalog={bootstrap.modelCatalog} onModelDefaultsChanged={(modelDefaults) => setBootstrap((current) => current ? { ...current, modelDefaults } : current)} piPackages={bootstrap.agentCatalog?.piPackages} onPiPackageChanged={upsertPiPackageInBootstrap} onPiPackageRemoved={removePiPackageFromBootstrap} userSkills={bootstrap.agentCatalog?.userSkills} onUserSkillChanged={upsertUserSkillInBootstrap} onUserSkillRemoved={removeUserSkillFromBootstrap} piboSessionId={selectedPiboSessionId} onProviderAuthChanged={refreshAfterProviderAuthChanged} />
			</ResponsiveTabSidebarPanel>
		);
	};

	return (
		<>
			<CreateWorkflowSessionDialog open={Boolean(workflowSessionDialog)} bootstrap={bootstrap} initialSelection={workflowSessionDialog?.selection} onClose={() => setWorkflowSessionDialog(null)} onCreated={acceptCreatedWorkflowSession} />
			{gatewayMode === "fallback" && !isAppFullscreen ? <FallbackGatewayBanner /> : null}
			<div
				data-pibo-debug="chat-app"
				data-pibo-area={area}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-selected-session-id={selectedPiboSessionId ?? bootstrap.selectedPiboSessionId ?? undefined}
				data-pibo-terminal-fullscreen={isTerminalFullscreen ? "true" : "false"}
				data-pibo-preview-fullscreen={isDesktopPreviewFullscreen ? "true" : "false"}
				className={`h-dvh overflow-hidden bg-[#101d22] text-slate-200 grid ${isAppFullscreen ? "grid-rows-[1fr]" : desktopTabsEnabled ? "grid-rows-[auto_1fr]" : "grid-rows-[auto_auto_1fr]"}`}
			>
				{isAppFullscreen || desktopTabsEnabled ? null : (
					<AppHeader
						area={area}
						identity={identity}
						mobileAreaMenuOpen={mobileAreaMenuOpen}
						mobileSidebarTriggerRef={mobileSidebarTriggerRef}
						totalRoomUnreadCount={totalRoomUnreadCount}
						vscodeEnabled={Boolean(bootstrap.integrations?.vscode)}
						showMobileSidebarTrigger={area !== "vscode"}
						onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
						onSelectMainNavArea={selectMainNavArea}
						onToggleMobileAreaMenu={() => setMobileAreaMenuOpen((open) => !open)}
						onCloseMobileAreaMenu={() => setMobileAreaMenuOpen(false)}
					/>
				)}

				{isAppFullscreen ? null : (
					<div>
						{error ? <AppErrorBanner message={error} onDismiss={() => setError(null)} /> : null}
						{downloadStatus ? <DownloadStatusBanner status={downloadStatus} onDismiss={() => setDownloadStatus(null)} /> : null}
					</div>
				)}

			{desktopTabsEnabled ? (
				<div
					data-pibo-debug="desktop-route-shell"
					data-pibo-area={desktopPanelRoute?.area ?? "sessions"}
					className="min-h-0 flex overflow-hidden"
				>
					<DesktopSessionSidebar
						state={desktopSessionSidebar.state}
						onStateChange={desktopSessionSidebar.setState}
						identity={identity}
						onRefresh={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { force: true }).then((data) => {
							if (selectedPiboSessionId) void refreshTrace(selectedPiboSessionId);
							navigateToSelectedSession(data.selectedRoomId, data.selectedPiboSessionId);
						})}
						hidden={isAppFullscreen}
					>
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
							onPinnedRoomChange={setRoomPinned}
							onReorderRoom={reorderRoom}
							onReadAllRoom={readAllRoom}
							onDeleteRoom={requestRoomDelete}
							newSessionProfile={newSessionProfile}
							newSessionProfileReady={newSessionProfileRoomId === (selectedRoomId ?? bootstrap.selectedRoomId)}
							onNewSessionProfileChange={setPreferredNewSessionProfile}
							selectedRoomArchived={selectedRoomArchived}
							creatingSession={creatingSession}
							onCreateSession={() => createSession()}
							onCreateWorkflowSession={() => openWorkflowSessionDialog()}
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
							onPinnedSessionChange={setSessionPinned}
							onReorderSession={reorderSession}
							onDeleteSession={requestSessionDelete}
							onViewContext={viewSessionContext}
							loadingPiboSessionId={loadingPiboSessionId}
							autoRenameSessionId={autoRenameSessionId}
							onAutoRenameConsumed={() => setAutoRenameSessionId(null)}
						/>
					</DesktopSessionSidebar>
					<main data-pibo-debug="desktop-session-center" hidden={isDesktopPreviewFullscreen} aria-hidden={isDesktopPreviewFullscreen || undefined} className="min-h-0 min-w-[250px] flex-1 overflow-hidden">
						<SessionTracePane
							bootstrap={bootstrap}
							selectedPiboSessionId={selectedPiboSessionId}
							selectedRoomId={selectedRoomId}
							contextLabel={selectedRoomContextLabel}
							selectedRoomArchived={selectedRoomArchived}
							roomNavigationPending={loadingSelectedRoom}
							sessionNavigationPending={Boolean(loadingPiboSessionId && loadingPiboSessionId === selectedPiboSessionId)}
							selectedSessionProfile={selectedSessionNode?.profile ?? defaultProfileFromBootstrap(bootstrap)}
							selectedSessionActiveModel={selectedSessionActiveModel}
							selectedSessionStatus={signalLegacyStatus(selectedSessionSignal ?? selectedRootSignal) ?? selectedSessionNode?.status}
							selectedSessionSignal={selectedSessionSignal}
							signals={sessionSignals ?? undefined}
							sessionViewId={sessionViewId}
							currentSessionView={currentSessionView}
							containerResponsive
							creatingSession={creatingSession}
							terminalFullscreen={isTerminalFullscreen}
							onEnterTerminalFullscreen={enterTerminalFullscreen}
							onExitTerminalFullscreen={() => setTerminalFullscreen(false)}
							showRawEvents={showRawEvents}
							showThinking={showThinking}
							expandThinking={expandThinking}
							toolDisplayMode={toolDisplayMode}
							commands={slashCommands}
							skills={skills}
							composerText={composerText}
							composerFocusSignal={composerFocusSignal}
							onComposerTextChange={updateComposerText}
							debugMode={debugMode}
							onToggleDebugMode={toggleDebugMode}
							onToggleThinking={() => { const next = !showThinking; setShowThinking(next); writeStoredShowThinking(next); }}
							onToggleExpandThinking={() => { const next = !expandThinking; setExpandThinking(next); writeStoredExpandThinking(next); }}
							onToolDisplayModeChange={(mode) => { setToolDisplayMode(mode); writeStoredToolDisplayMode(mode); }}
							onSessionAgentProfileChange={(profile) => void updateSelectedSessionProfile(profile)}
							onFork={forkFrom}
							onOpenSession={openSession}
							onCommand={runCommand}
							onThinkingLevelChange={(level) => void runCommand(`/thinking ${level}`)}
							onRefreshTrace={refreshSelectedTrace}
							onRefreshBootstrap={refreshSelectedBootstrap}
							desktopActiveTool={desktopActiveTool}
							desktopToolHosts={desktopToolHosts}
							onOpenDesktopTool={(tool) => void openDesktopTarget({ kind: "session-tool", tool })}
							onCloseDesktopTool={closeDesktopSessionTool}
							desktopPreviewFullscreen={isDesktopPreviewFullscreen}
							onEnterDesktopPreviewFullscreen={() => setDesktopPreviewFullscreen(true)}
							onExitDesktopPreviewFullscreen={() => setDesktopPreviewFullscreen(false)}
							onSend={async (text, webAnnotationIds, fileAttachmentPaths, clientTxnId, delivery) => {
								if (isSessionComposerDisabled(selectedPiboSessionId, selectedRoomArchived) || !selectedPiboSessionId) return;
								try {
									await sendMessageMutation.mutateAsync({ piboSessionId: selectedPiboSessionId, text, clientTxnId: clientTxnId ?? createClientTxnId(), roomId: selectedRoomId ?? undefined, webAnnotationIds, fileAttachmentPaths, delivery });
									await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
									setError(null);
								} catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); throw caught; }
							}}
							onError={setError}
						/>
					</main>
					<DesktopTabSidebar
						state={desktopWorkspace.state}
						vscodeEnabled={Boolean(bootstrap.integrations?.vscode)}
						onStateChange={setDesktopWorkspaceState}
						onActivate={(tab) => void activateDesktopWorkspaceTab(tab)}
						onClose={closeDesktopWorkspaceTab}
						onFocusSessions={(newTab) => void focusDesktopSessions(newTab)}
						renderPanel={(tab, active) => renderDesktopPanel(tab, active)}
						reservedLeftWidth={desktopSessionSidebar.state.collapsed ? DESKTOP_COLLAPSED_SIDEBAR_WIDTH : desktopSessionSidebar.state.width}
						hidden={isTerminalFullscreen}
						fullscreen={isDesktopPreviewFullscreen}
					/>
					{deleteRoomTarget ? <DeleteRoomModal room={deleteRoomTarget} confirmName={deleteRoomConfirmName} deleting={deletingRoom} onConfirmNameChange={setDeleteRoomConfirmName} onCancel={cancelRoomDelete} onDelete={() => void permanentlyDeleteRoom()} /> : null}
					{deleteSessionTarget ? <DeleteSessionModal session={deleteSessionTarget} confirmText={deleteSessionConfirmText} deleting={deletingSession} onConfirmTextChange={setDeleteSessionConfirmText} onCancel={cancelSessionDelete} onDelete={() => void permanentlyDeleteSession()} /> : null}
				</div>
			) : (
			<div
				data-pibo-debug="route-shell"
				data-pibo-area={area}
				data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
				data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
				className={`min-h-0 ${routeShellClassName}`}
			>
				{area === "vscode" ? (
					<VscodeArea integration={bootstrap.integrations?.vscode} />
				) : area === "cron" ? (
					<CronArea bootstrap={bootstrap} mobileSidebarOpen={mobileSidebarOpen} onCloseMobileSidebar={closeMobileSidebar} />
				) : area === "loops" ? (
					<LoopArea bootstrap={bootstrap} mobileSidebarOpen={mobileSidebarOpen} onCloseMobileSidebar={closeMobileSidebar} />
				) : area === "agents" ? (
					<AgentsView
						agents={bootstrap.agents}
						initialCustomAgents={bootstrap.customAgents}
						initialAgentFolders={bootstrap.agentFolders}
						initialCatalog={bootstrap.agentCatalog}
						modelCatalog={bootstrap.modelCatalog}
						onCreateSession={(profile) => void createSession(profile)}
						onEditContextFile={openContextFileEditor}
						onEditMcpServer={openMcpToolsEditor}
						onAgentsChanged={() => void loadBootstrap(selectedPiboSessionId ?? undefined, showArchivedRef.current, selectedRoomId ?? undefined, { selectSession: false })}
						onAutosaveHandlerChange={updateAgentAutosaveHandler}
						creatingSession={creatingSession || selectedRoomArchived}
						mobileSidebarOpen={mobileSidebarOpen}
						isMobileSidebarViewport={isMobileSidebarViewport}
						onCloseMobileSidebar={closeMobileSidebar}
					/>
				) : area === "workflows" ? (
					<RoutedWorkflowsPanel
						route={route.area === "workflows" ? route : { area: "workflows", draftId: routeWorkflowDraftId }}
						surface="mobile"
						fallback={(
							<MinimalWorkflowsArea
								room={bootstrap.room}
								draftId={routeWorkflowDraftId}
								onNavigateDraft={(nextDraftId) => navigateToRoute({ area: "workflows", draftId: nextDraftId })}
								onCreateWorkflowSession={openWorkflowSessionDialog}
							/>
						)}
					/>
				) : (
				<>
				{/* Mobile sidebar backdrop */}
				<div
					data-pibo-mobile-sidebar-backdrop
					aria-hidden="true"
					className={`fixed inset-0 z-30 bg-black/60 min-[981px]:hidden transition-opacity duration-200 ${
						isTerminalFullscreen ? "hidden" : mobileSidebarOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
					}`}
					onClick={closeMobileSidebar}
				/>
				<aside
					data-pibo-mobile-sidebar
					{...mobileSidebarA11yProps(isMobileSidebarViewport, mobileSidebarOpen, "Chat sidebar")}
					data-pibo-debug="sidebar-shell"
					data-pibo-area={area}
					data-pibo-room-id={selectedRoomId ?? bootstrap.selectedRoomId ?? undefined}
					data-pibo-selected-session-id={selectedPiboSessionId ?? undefined}
					data-pibo-state={mobileSidebarOpen ? "open" : "closed"}
					className={`min-h-0 overflow-hidden flex flex-col bg-[#1a262b] border-r border-slate-800 max-[980px]:fixed max-[980px]:left-0 max-[980px]:top-0 max-[980px]:bottom-0 max-[980px]:z-40 max-[980px]:w-[280px] max-[980px]:transition-transform max-[980px]:duration-200 ${
						isTerminalFullscreen ? "hidden" : mobileSidebarOpen ? "max-[980px]:translate-x-0" : "max-[980px]:-translate-x-full"
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
								onClick={closeMobileSidebar}
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
							onPinnedRoomChange={setRoomPinned}
							onReorderRoom={reorderRoom}
							onReadAllRoom={readAllRoom}
							onDeleteRoom={requestRoomDelete}
							newSessionProfile={newSessionProfile}
							newSessionProfileReady={newSessionProfileRoomId === (selectedRoomId ?? bootstrap.selectedRoomId)}
							onNewSessionProfileChange={setPreferredNewSessionProfile}
							selectedRoomArchived={selectedRoomArchived}
							creatingSession={creatingSession}
							onCreateSession={() => createSession()}
							onCreateWorkflowSession={() => openWorkflowSessionDialog()}
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
							onPinnedSessionChange={setSessionPinned}
							onReorderSession={reorderSession}
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
						contextLabel={selectedRoomContextLabel}
						selectedRoomArchived={selectedRoomArchived}
						roomNavigationPending={loadingSelectedRoom}
						sessionNavigationPending={Boolean(loadingPiboSessionId && loadingPiboSessionId === selectedPiboSessionId)}
						selectedSessionProfile={selectedSessionNode?.profile ?? defaultProfileFromBootstrap(bootstrap)}
						selectedSessionActiveModel={selectedSessionActiveModel}
						selectedSessionStatus={signalLegacyStatus(selectedSessionSignal ?? selectedRootSignal) ?? selectedSessionNode?.status}
						selectedSessionSignal={selectedSessionSignal}
						signals={sessionSignals ?? undefined}
						sessionViewId={sessionViewId}
						currentSessionView={currentSessionView}
						creatingSession={creatingSession}
						terminalFullscreen={isTerminalFullscreen}
						onEnterTerminalFullscreen={enterTerminalFullscreen}
						onExitTerminalFullscreen={() => setTerminalFullscreen(false)}
						showRawEvents={showRawEvents}
						showThinking={showThinking}
						expandThinking={expandThinking}
						toolDisplayMode={toolDisplayMode}
						commands={slashCommands}
						skills={skills}
						composerText={composerText}
						composerFocusSignal={composerFocusSignal}
						onComposerTextChange={updateComposerText}
						debugMode={debugMode}
						onToggleDebugMode={toggleDebugMode}
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
						onToolDisplayModeChange={(mode) => {
							setToolDisplayMode(mode);
							writeStoredToolDisplayMode(mode);
						}}
						onSessionAgentProfileChange={(profile) => void updateSelectedSessionProfile(profile)}
						onFork={forkFrom}
						onOpenSession={openSession}
						onCommand={runCommand}
						onThinkingLevelChange={(level) => void runCommand(`/thinking ${level}`)}
						onRefreshTrace={refreshSelectedTrace}
						onRefreshBootstrap={refreshSelectedBootstrap}
						onSend={async (text, webAnnotationIds, fileAttachmentPaths, clientTxnId, delivery) => {
							if (isSessionComposerDisabled(selectedPiboSessionId, selectedRoomArchived) || !selectedPiboSessionId) return;
							try {
								await sendMessageMutation.mutateAsync({
									piboSessionId: selectedPiboSessionId,
									text,
									clientTxnId: clientTxnId ?? createClientTxnId(),
									roomId: selectedRoomId ?? undefined,
									webAnnotationIds,
									fileAttachmentPaths,
									delivery,
								});
								await loadBootstrap(selectedPiboSessionId, showArchivedRef.current, selectedRoomId ?? undefined, { force: true });
								setError(null);
							} catch (caught) {
								setError(caught instanceof Error ? caught.message : String(caught));
								throw caught;
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
			)}

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
