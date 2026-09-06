import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BootstrapData,
  PiboRuntimeApprovalRequest,
  PiboRuntimeUserInputRequest,
  PiboSignalSnapshot,
  PiboWebSessionStatus,
  ThinkingLevel,
} from "./types";
import type { SlashCommand } from "./chat-commands";
import type { ChatSessionViewId, ToolDisplayMode } from "./session-views/types";
import { getSessionForkCandidates, getSessionStatus, type ChatMessageDelivery } from "./api-chat-sessions";
import { adjacentMessageDeliveryChoice } from "./message-delivery-keyboard";
import { uploadChatFiles } from "./api-chat-files";
import { getLoopSessionGoal } from "./api-loops";
import { getChatSessionView } from "./session-views/registry";
import { SessionTraceLayout } from "./session-trace-layout";
import { DialogShell } from "./components/DialogShell";
import type { LiveTraceOverlay } from "./tracing/live-overlay";
import { useCurrentSessionTrace } from "./tracing/use-current-session-trace";
import { useSessionTracePage } from "./tracing/use-session-trace-page";
import { useSessionTraceLiveStream } from "./tracing/use-session-trace-live-stream";
import type { RuntimeRequestStreamEvent } from "./tracing/chat-stream-events";
import { assertChatUploadCapacity, useSessionUploadAttachments } from "./chat-upload-attachments";
import { useSessionWebAnnotations } from "./use-session-web-annotations";
import { compactWebAnnotationError, WebAnnotationsSessionPanel } from "./web-annotations";
import {
  createSessionTraceViewLinks,
  createSessionTraceViewProps,
  resolveSessionTraceModelBadge,
  resolveSessionTraceTitle,
  sessionCanSteer,
  sessionSupportsFork,
  sessionSupportsForkWhileRunning,
  sessionSupportsToolIntent,
  traceUserMessageRevision,
  withSessionForkCandidates,
} from "./session-trace-view-props";
import {
  appendComposerOptimisticEvent,
  createComposerSendPlan,
  withComposerSendDelivery,
  type ComposerSendPlan,
} from "./composer-send";
import {
  createClientTxnId,
  findSessionNode,
  isSessionComposerDisabled,
} from "./app-session-model";
import { selectedSessionBackendId } from "./selected-session-backend";
import { createWorkflowHeaderSummary, isWorkflowLinkedSession } from "./workflows/workflow-session-model";
import { getSessionWorkflow } from "./api-workflows";
import { errorMessage } from "./error-message";
import {
  canOpenDesktopPwaSessionWindow,
  openCurrentPwaSessionWindow,
} from "./pwa-session-window";
import { RuntimeRequestPanel } from "./runtime-request-panel";
import {
  getSessionLivePreviews,
  removeSessionLivePreview,
  startSessionLivePreview,
  stopSessionLivePreview,
  subscribeSessionLivePreviewEvents,
  type SessionLivePreview,
} from "./api-previews";
import {
  requirePreviewActionAuthority,
  resolveSessionLivePreviewAuthority,
  selectAuthoritativeLivePreview,
  type SessionLivePreviewQueryEnvelope,
  type SessionLivePreviewSelection,
} from "./session-live-preview-authority";
import { PreviewFullscreenTopBar, PreviewMessage, SessionLivePreviewPanel } from "./session-live-preview";
import { RawEventsSidebar } from "./tracing/RawEventsSidebar";
import { JsonRenderer } from "./tracing/JsonRenderer";
import type { DesktopSessionTool } from "./desktop-tabs-model";

const livePreviewQueryKey = (piboSessionId: string) => ["chat", "session-live-previews", piboSessionId] as const;

export function useHostedPreviewFullscreenRecovery(
  fullscreen: boolean,
  previewAvailable: boolean,
  onExitFullscreen?: () => void,
): void {
  const onExitFullscreenRef = useRef(onExitFullscreen);
  onExitFullscreenRef.current = onExitFullscreen;
  useEffect(() => {
    if (fullscreen && !previewAvailable) onExitFullscreenRef.current?.();
  }, [fullscreen, previewAvailable]);
}

export function SessionTracePane({
  bootstrap,
  selectedPiboSessionId,
  selectedRoomId,
  contextKind = "room",
  contextLabel,
  selectedRoomArchived,
  roomNavigationPending,
  sessionNavigationPending,
  selectedSessionProfile,
  selectedSessionActiveModel,
  selectedSessionStatus,
  selectedSessionSignal,
  signals,

  activeViewId,
  sessionViewId,
  currentSessionView,
  desktopTerminalOnly = false,
  containerResponsive = false,
  creatingSession,
  terminalFullscreen = false,
  onEnterTerminalFullscreen,
  onExitTerminalFullscreen,
  showRawEvents,
  showThinking,
  debugMode,
  expandThinking,
  toolDisplayMode,
  commands,
  skills,
  composerText,
  composerFocusSignal,
  onComposerTextChange,
  onToggleDebugMode,
  onToggleThinking,
  onToggleExpandThinking,
  onToolDisplayModeChange,
  onSessionAgentProfileChange,
  onFork,
  onOpenSession,
  onCommand,
  onThinkingLevelChange,
  onRefreshTrace,
  onRefreshBootstrap,
  onSend,
  onError,
  desktopActiveTool = null,
  desktopToolHosts,
  onOpenDesktopTool,
  onCloseDesktopTool,
  desktopPreviewFullscreen = false,
  onEnterDesktopPreviewFullscreen,
  onExitDesktopPreviewFullscreen,
}: {
  bootstrap: BootstrapData;
  selectedPiboSessionId: string | null;
  selectedRoomId: string | null;
  contextKind?: "room";
  contextLabel?: string;
  selectedRoomArchived: boolean;
  roomNavigationPending?: boolean;
  sessionNavigationPending?: boolean;
  selectedSessionProfile: string;
  selectedSessionActiveModel?: string;
  selectedSessionStatus?: PiboWebSessionStatus;
  selectedSessionSignal?: PiboSignalSnapshot["sessions"][string];
  signals?: PiboSignalSnapshot;
  activeViewId?: string;
  sessionViewId: ChatSessionViewId;
  currentSessionView: ReturnType<typeof getChatSessionView>;
  desktopTerminalOnly?: boolean;
  containerResponsive?: boolean;
  creatingSession: boolean;
  terminalFullscreen?: boolean;
  onEnterTerminalFullscreen?: () => void;
  onExitTerminalFullscreen?: () => void;
  showRawEvents: boolean;
  showThinking: boolean;
  debugMode: boolean;
  expandThinking: boolean;
  toolDisplayMode: ToolDisplayMode;
  commands: SlashCommand[];
  skills: Array<{ name: string; description?: string; path?: string }>;
  composerText: string;
  composerFocusSignal: number;
  onComposerTextChange: Dispatch<SetStateAction<string>>;
  onToggleDebugMode: () => void;
  onToggleThinking: () => void;
  onToggleExpandThinking: () => void;
  onToolDisplayModeChange: (mode: ToolDisplayMode) => void;
  onSessionAgentProfileChange: (profile: string) => void;
  onFork: (entryId: string) => void;
  onOpenSession: (piboSessionId: string) => void;
  onCommand: (text: string) => Promise<boolean>;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onRefreshTrace: () => Promise<void>;
  onRefreshBootstrap: () => Promise<unknown>;
  onSend: (
    text: string,
    webAnnotationIds?: readonly string[],
    fileAttachmentPaths?: readonly string[],
    clientTxnId?: string,
    delivery?: ChatMessageDelivery,
  ) => Promise<void>;
  onError: (message: string | null) => void;
  desktopActiveTool?: DesktopSessionTool | null;
  desktopToolHosts?: Partial<Record<DesktopSessionTool, Element | null>>;
  onOpenDesktopTool?: (tool: DesktopSessionTool) => void;
  onCloseDesktopTool?: (tool: DesktopSessionTool) => void;
  desktopPreviewFullscreen?: boolean;
  onEnterDesktopPreviewFullscreen?: () => void;
  onExitDesktopPreviewFullscreen?: () => void;
}) {
  const queryClient = useQueryClient();
  const liveEventSeqRef = useRef(0);
  const liveTraceOverlayCacheRef = useRef<Map<string, LiveTraceOverlay>>(new Map());
  const [liveTraceOverlay, setLiveTraceOverlayState] =
    useState<LiveTraceOverlay | null>(null);
  const setLiveTraceOverlay = useCallback<Dispatch<SetStateAction<LiveTraceOverlay | null>>>((update) => {
    setLiveTraceOverlayState((current) => {
      const next = typeof update === "function"
        ? update(current)
        : update;
      if (next) liveTraceOverlayCacheRef.current.set(next.piboSessionId, next);
      return next;
    });
  }, []);
  const [pendingSendPlan, setPendingSendPlan] =
    useState<ComposerSendPlan | null>(null);
  const [runtimeApprovals, setRuntimeApprovals] = useState<PiboRuntimeApprovalRequest[]>([]);
  const [runtimeUserInputs, setRuntimeUserInputs] = useState<PiboRuntimeUserInputRequest[]>([]);
  const deliverySendIdsRef = useRef(new Set<string>());
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const steerButtonRef = useRef<HTMLButtonElement>(null);
  const selectedBackendPiboSessionId = selectedSessionBackendId(selectedPiboSessionId);
  useEffect(() => {
    const status = bootstrap.runtimeStatus?.piboSessionId === selectedBackendPiboSessionId
      ? bootstrap.runtimeStatus
      : undefined;
    setRuntimeApprovals(status?.pendingApprovals ? [...status.pendingApprovals] : []);
    setRuntimeUserInputs(status?.pendingUserInputs ? [...status.pendingUserInputs] : []);
  }, [bootstrap.runtimeStatus, selectedBackendPiboSessionId]);
  const handleRuntimeRequestEvent = useCallback((event: RuntimeRequestStreamEvent) => {
    if (event.type === "RUNTIME_APPROVAL_REQUESTED") {
      setRuntimeApprovals((current) => [...current.filter((request) => request.requestId !== event.request.requestId), event.request]);
      return;
    }
    if (event.type === "RUNTIME_USER_INPUT_REQUESTED") {
      setRuntimeUserInputs((current) => [...current.filter((request) => request.requestId !== event.request.requestId), event.request]);
      return;
    }
    setRuntimeApprovals((current) => current.filter((request) => request.requestId !== event.requestId));
    setRuntimeUserInputs((current) => current.filter((request) => request.requestId !== event.requestId));
  }, []);
  const removeRuntimeRequest = useCallback((requestId: string) => {
    setRuntimeApprovals((current) => current.filter((request) => request.requestId !== requestId));
    setRuntimeUserInputs((current) => current.filter((request) => request.requestId !== requestId));
  }, []);
  const sessionGoalQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? ["chat", "session-goal", selectedBackendPiboSessionId]
      : ["chat", "session-goal", "idle"],
    queryFn: ({ signal }) => getLoopSessionGoal(selectedBackendPiboSessionId!, { signal }),
    enabled: Boolean(selectedBackendPiboSessionId),
    refetchInterval: selectedBackendPiboSessionId ? 5_000 : false,
  });
  const selectedPreviewSessionRef = useRef<string | undefined>(selectedBackendPiboSessionId);
  selectedPreviewSessionRef.current = selectedBackendPiboSessionId;
  const openDesktopToolRef = useRef(onOpenDesktopTool);
  openDesktopToolRef.current = onOpenDesktopTool;
  const desktopPreviewAutoOpenEnabled = Boolean(onOpenDesktopTool);
  const [livePreviewViewSessionId, setLivePreviewViewSessionId] = useState<string | null>(null);
  const [selectedLivePreview, setSelectedLivePreview] = useState<SessionLivePreviewSelection | undefined>();
  const [livePreviewReload, setLivePreviewReload] = useState<{ piboSessionId: string; value: number } | undefined>();
  const pendingLivePreviewActionsRef = useRef(new Set<string>());
  const [pendingLivePreviewActions, setPendingLivePreviewActions] = useState<ReadonlySet<string>>(new Set());
  const livePreviewsQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? livePreviewQueryKey(selectedBackendPiboSessionId)
      : livePreviewQueryKey("idle"),
    queryFn: async ({ signal }) => {
      const piboSessionId = selectedBackendPiboSessionId!;
      const response = await getSessionLivePreviews(piboSessionId, { signal });
      return { piboSessionId, ...response } satisfies SessionLivePreviewQueryEnvelope;
    },
    enabled: Boolean(selectedBackendPiboSessionId),
    refetchInterval: (query) => selectedBackendPiboSessionId && query.state.data?.configured !== false ? 5_000 : false,
    retry: false,
  });
	const livePreviewAuthority = resolveSessionLivePreviewAuthority({
		selectedPiboSessionId: selectedBackendPiboSessionId ?? undefined,
    data: livePreviewsQuery.data,
    loading: livePreviewsQuery.isPending && Boolean(selectedBackendPiboSessionId),
    error: livePreviewsQuery.isError ? errorMessage(livePreviewsQuery.error) : undefined,
  });
  const livePreviews = livePreviewAuthority.kind === "ready" ? livePreviewAuthority.previews : [];
  const selectedLivePreviewRecord = selectAuthoritativeLivePreview(livePreviewAuthority, selectedLivePreview);
  useHostedPreviewFullscreenRecovery(
    desktopPreviewFullscreen,
    livePreviewAuthority.kind === "ready" && Boolean(selectedLivePreviewRecord),
    onExitDesktopPreviewFullscreen,
  );
  const livePreviewSelected = Boolean(selectedBackendPiboSessionId && livePreviewViewSessionId === selectedBackendPiboSessionId);
  const terminalUsageEnabled = Boolean(
    selectedBackendPiboSessionId
    && !terminalFullscreen
    && !livePreviewSelected
    && currentSessionView.id === "terminal"
    && (activeViewId ?? sessionViewId) === "terminal",
  );
  const terminalUsageQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? ["chat", "terminal-header-usage", selectedBackendPiboSessionId, selectedSessionStatus]
      : ["chat", "terminal-header-usage", "idle"],
    queryFn: () => getSessionStatus(selectedBackendPiboSessionId!, { activate: false }),
    enabled: terminalUsageEnabled,
    refetchInterval: terminalUsageEnabled ? 30_000 : false,
    staleTime: 15_000,
    retry: false,
  });
  const livePreviewReloadKey = livePreviewReload?.piboSessionId === selectedBackendPiboSessionId ? livePreviewReload.value : 0;

  useEffect(() => {
    if (!selectedBackendPiboSessionId || livePreviewViewSessionId === selectedBackendPiboSessionId) return;
    if (livePreviewViewSessionId && terminalFullscreen) onExitTerminalFullscreen?.();
    setLivePreviewViewSessionId(null);
    setSelectedLivePreview(undefined);
    setLivePreviewReload(undefined);
  }, [livePreviewViewSessionId, onExitTerminalFullscreen, selectedBackendPiboSessionId, terminalFullscreen]);

  useEffect(() => {
    if (livePreviewAuthority.kind !== "ready") return;
    if (selectedLivePreview?.piboSessionId === livePreviewAuthority.piboSessionId
      && livePreviewAuthority.previews.some((preview) => preview.id === selectedLivePreview.previewId)) return;
    setSelectedLivePreview({
      piboSessionId: livePreviewAuthority.piboSessionId,
      previewId: livePreviewAuthority.previews[0]!.id,
    });
  }, [livePreviewAuthority, selectedLivePreview]);

  useEffect(() => {
    if (!desktopPreviewAutoOpenEnabled || !selectedBackendPiboSessionId) return;
    const piboSessionId = selectedBackendPiboSessionId;
    return subscribeSessionLivePreviewEvents(piboSessionId, ({ preview }) => {
      if (selectedPreviewSessionRef.current !== piboSessionId || preview.piboSessionId !== piboSessionId) return;
      queryClient.setQueryData<SessionLivePreviewQueryEnvelope>(livePreviewQueryKey(piboSessionId), (current) => ({
        piboSessionId,
        configured: true,
        previews: [preview, ...(current?.piboSessionId === piboSessionId ? current.previews.filter((candidate) => candidate.id !== preview.id) : [])],
      }));
      setSelectedLivePreview({ piboSessionId, previewId: preview.id });
      openDesktopToolRef.current?.("preview");
    });
  }, [desktopPreviewAutoOpenEnabled, queryClient, selectedBackendPiboSessionId]);
  const openSessionWindowAvailable = Boolean(selectedBackendPiboSessionId) && canOpenDesktopPwaSessionWindow();
  const openSelectedSessionWindow = useCallback(() => {
    if (openCurrentPwaSessionWindow()) return;
    onError("The browser blocked the new Pibo window.");
  }, [onError]);
  const onOpenSessionWindow = openSessionWindowAvailable ? openSelectedSessionWindow : undefined;
  const {
    baseTraceView,
    liveTraceOverlay: selectedLiveTraceOverlay,
    rawEventLimit,
    traceSummaryQuery,
    tracePageQuery,
    rawEventsQuery,
    loadingOlderTracePage,
    tracePageReady,
    loadOlderTracePage,
    loadMoreRawEvents,
  } = useSessionTracePage({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    showRawEvents: showRawEvents || Boolean(desktopToolHosts?.["raw-events"]),
    liveTraceOverlay,
    liveTraceOverlayCacheRef,
    setLiveTraceOverlay,
  });
  const {
    selectedWebAnnotationIds,
    selectedWebAnnotations,
    visibleWebAnnotations,
    webAnnotationsPanelCollapsed,
    webAnnotationsPanelRendered,
    webAnnotationsPanelVisible,
    webAnnotationsQuery,
    clearingWebAnnotations,
    setWebAnnotationsPanelVisible,
    toggleWebAnnotationAttachment,
    detachWebAnnotationAttachment,
    clearSelectedWebAnnotationAttachments,
    toggleWebAnnotationsPanelCollapsed,
    clearVisibleWebAnnotations,
  } = useSessionWebAnnotations({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    onError,
    formatError: compactWebAnnotationError,
    forcePanelVisible: Boolean(desktopToolHosts?.["web-annotations"]),
  });
  const closeWebAnnotationsPanel = useCallback(() => {
    closeHostedWebAnnotations(
      Boolean(desktopToolHosts?.["web-annotations"]),
      onCloseDesktopTool,
      setWebAnnotationsPanelVisible,
    );
  }, [desktopToolHosts, onCloseDesktopTool, setWebAnnotationsPanelVisible]);
  const createUploadAttachmentId = useCallback(
    () => `upload-${createClientTxnId()}`,
    [],
  );
  const {
    selectedUploadAttachments,
    attachUploadedFiles,
    detachUploadAttachment,
    clearSelectedUploadAttachments,
  } = useSessionUploadAttachments(
    selectedPiboSessionId,
    createUploadAttachmentId,
  );

  const currentTraceView = useCurrentSessionTrace({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    baseTraceView,
    liveTraceOverlay: selectedLiveTraceOverlay,
    selectedSessionStatus,
  });
  const forkSupported = sessionSupportsFork(bootstrap, selectedPiboSessionId, selectedSessionProfile);
  const forkWhileRunningSupported = sessionSupportsForkWhileRunning(bootstrap, selectedPiboSessionId, selectedSessionProfile);
  const forkCandidateRevision = traceUserMessageRevision(currentTraceView);
  const forkCandidateStatusRevision = selectedSessionStatus ?? "unknown";
  const forkCandidatesEnabled = Boolean(selectedBackendPiboSessionId)
    && forkCandidateRevision !== "none"
    && forkCandidateRevision !== "0:"
    && forkSupported
    && !selectedRoomArchived
    && (selectedSessionStatus !== "running" || forkWhileRunningSupported);
  const forkCandidatesQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? ["chat", "fork-candidates", selectedBackendPiboSessionId, forkCandidateRevision, forkCandidateStatusRevision]
      : ["chat", "fork-candidates", "idle", "none", forkCandidateStatusRevision],
    queryFn: ({ signal }) => getSessionForkCandidates(selectedBackendPiboSessionId!, { signal }),
    enabled: forkCandidatesEnabled,
    staleTime: 0,
    retry: false,
  });
  const forkableTraceView = useMemo(
    () => forkCandidatesEnabled && forkCandidatesQuery.data
      ? withSessionForkCandidates(currentTraceView, forkCandidatesQuery.data.messages)
      : currentTraceView,
    [currentTraceView, forkCandidatesEnabled, forkCandidatesQuery.data],
  );

  useSessionTraceLiveStream({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    tracePageData: tracePageQuery.data,
    currentTraceView,
    liveEventSeqRef,
    selectedSessionStatus,
    tracePageReady,
    setLiveTraceOverlay,
    onRefreshTrace,
    onRefreshBootstrap,
    onRuntimeRequestEvent: handleRuntimeRequestEvent,
    onError,
  });

  const sessionActiveModelBadge = resolveSessionTraceModelBadge({
    bootstrap,
    selectedPiboSessionId,
    selectedSessionProfile,
    selectedSessionActiveModel,
    currentTraceView,
  });
  const sessionLinks = useMemo(
    () =>
      createSessionTraceViewLinks(bootstrap.sessions, selectedPiboSessionId),
    [bootstrap.sessions, selectedPiboSessionId],
  );
  const loadingTrace =
    Boolean(selectedPiboSessionId) &&
    tracePageQuery.isFetching &&
    !currentTraceView;
  const traceError = tracePageQuery.error
    ? errorMessage(tracePageQuery.error)
    : traceSummaryQuery.error
      ? errorMessage(traceSummaryQuery.error)
      : null;
  const composerDisabled = isSessionComposerDisabled(
    selectedPiboSessionId,
    selectedRoomArchived,
  ) || Boolean(roomNavigationPending || sessionNavigationPending);
  const terminalFileDropEnabled =
    !livePreviewSelected &&
    !composerDisabled &&
    currentSessionView.id === "terminal" &&
    (activeViewId ?? sessionViewId) === "terminal";
  const handleTerminalFilesDropped = useCallback(async (files: readonly File[]) => {
    try {
      assertChatUploadCapacity(selectedUploadAttachments.length, files.length);
      const result = await uploadChatFiles(files);
      attachUploadedFiles(result.files);
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }, [attachUploadedFiles, onError, selectedUploadAttachments.length]);

  const headerPiboSessionId =
    currentTraceView?.piboSessionId ?? selectedPiboSessionId ?? "";
  const selectedWorkflowNode = selectedPiboSessionId ? findSessionNode(bootstrap.sessions, selectedPiboSessionId) : undefined;
  const selectedWorkflowSession = bootstrap.session?.id === selectedPiboSessionId ? bootstrap.session : undefined;
  const workflowSessionLinked = isWorkflowLinkedSession(selectedWorkflowNode, selectedWorkflowSession);
  const workflowInspection = useQuery({
    queryKey: ["chat", "session-workflow", selectedPiboSessionId],
    queryFn: () => getSessionWorkflow(selectedPiboSessionId!),
    enabled: Boolean(selectedPiboSessionId && workflowSessionLinked),
    refetchInterval: 5000,
    retry: false,
  });
  const workflowLink = workflowInspection.data?.workflowSession;
  const workflowHeader = workflowLink ? createWorkflowHeaderSummary(workflowLink) : null;

  const schedulePostSendTraceRefresh = (piboSessionId: string) => {
    for (const delayMs of [750, 2000, 5000, 10000]) {
      window.setTimeout(() => {
        if (selectedPiboSessionId !== piboSessionId) return;
        void tracePageQuery
          .refetch()
          .catch((caught) => onError(errorMessage(caught)));
      }, delayMs);
    }
  };

  const deliverComposerSend = async (
    initialPlan: ComposerSendPlan,
    delivery: ChatMessageDelivery,
  ) => {
    const sendPlan = withComposerSendDelivery(initialPlan, delivery);
    setLiveTraceOverlay((current) =>
      appendComposerOptimisticEvent(
        current,
        sendPlan.piboSessionId,
        sendPlan.optimisticEvent,
      ),
    );
    await onSend(
      sendPlan.text,
      sendPlan.webAnnotationIds,
      sendPlan.fileAttachmentPaths,
      sendPlan.clientTxnId,
      delivery,
    );
    clearSelectedWebAnnotationAttachments();
    clearSelectedUploadAttachments();
    await Promise.all([
      tracePageQuery.refetch(),
      webAnnotationsQuery.refetch(),
    ]);
    schedulePostSendTraceRefresh(sendPlan.piboSessionId);
  };

  const rollbackComposerSend = (sendPlan: ComposerSendPlan, caught: unknown) => {
    setLiveTraceOverlay((current) => {
      const target = current?.piboSessionId === sendPlan.piboSessionId
        ? current
        : liveTraceOverlayCacheRef.current.get(sendPlan.piboSessionId) ?? null;
      if (!target) return current;
      const events = target.events.filter((event) => event.id !== sendPlan.clientTxnId);
      const next = events.length ? { ...target, events } : null;
      if (next) liveTraceOverlayCacheRef.current.set(sendPlan.piboSessionId, next);
      else liveTraceOverlayCacheRef.current.delete(sendPlan.piboSessionId);
      return current?.piboSessionId === sendPlan.piboSessionId ? next : current;
    });
    onComposerTextChange((current) => current || sendPlan.text);
    onError(errorMessage(caught));
  };

  const canSteer = sessionCanSteer(
    bootstrap,
    selectedBackendPiboSessionId,
    selectedSessionProfile,
    selectedSessionSignal,
  );

  const handleComposerSend = async (text: string) => {
    if (composerDisabled || !selectedPiboSessionId) return;
    const sendPlan = createComposerSendPlan({
      piboSessionId: selectedPiboSessionId,
      text,
      selectedWebAnnotations,
      selectedUploadAttachments,
      eventSequence: liveEventSeqRef.current++,
      now: new Date().toISOString(),
      clientTxnId: createClientTxnId(),
    });
    if (canSteer) {
      setPendingSendPlan(sendPlan);
      return;
    }
    try {
      await deliverComposerSend(sendPlan, "queue");
    } catch (caught) {
      rollbackComposerSend(sendPlan, caught);
    }
  };

  const closeDeliveryDialog = () => {
    if (!pendingSendPlan) return;
    onComposerTextChange((current) => current || pendingSendPlan.text);
    setPendingSendPlan(null);
  };

  const chooseDelivery = async (delivery: ChatMessageDelivery) => {
    const sendPlan = pendingSendPlan;
    if (!sendPlan || deliverySendIdsRef.current.has(sendPlan.clientTxnId)) return;
    deliverySendIdsRef.current.add(sendPlan.clientTxnId);
    setPendingSendPlan((current) =>
      current?.clientTxnId === sendPlan.clientTxnId ? null : current,
    );
    onError(null);
    try {
      await deliverComposerSend(sendPlan, delivery);
    } catch (caught) {
      rollbackComposerSend(sendPlan, caught);
    } finally {
      deliverySendIdsRef.current.delete(sendPlan.clientTxnId);
    }
  };

  const moveDeliveryChoiceFocus = (
    currentDelivery: ChatMessageDelivery,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const nextDelivery = adjacentMessageDeliveryChoice(currentDelivery, event);
    if (!nextDelivery) return;
    event.preventDefault();
    (nextDelivery === "queue" ? queueButtonRef : steerButtonRef).current?.focus();
  };

  const toolIntentSupported = sessionSupportsToolIntent(bootstrap, selectedPiboSessionId, selectedSessionProfile);
  const effectiveToolDisplayMode = toolDisplayMode === "intent" && !toolIntentSupported ? "slim" : toolDisplayMode;
  const sessionViewProps = createSessionTraceViewProps({
    currentTraceView: forkableTraceView,
    isLoading: loadingTrace,
    showThinking,
    debugMode,
    expandThinking,
    toolDisplayMode: effectiveToolDisplayMode,
    selectedSessionProfile,
    sessionActiveModelBadge,
    sessionRuntimeBinding: bootstrap.session?.id === selectedBackendPiboSessionId ? bootstrap.session.runtimeBinding : undefined,
    selectedSessionStatus,
    selectedSessionSignal,
    signals,
    sessionGoal: sessionGoalQuery.data?.goal,
    selectedPiboSessionId,
    workflowSessionLinked,
    sessionNodes: bootstrap.sessions,
    sessionLinks,
    agentProfiles: bootstrap.agents,
    sessionProfileChangeDisabled: creatingSession || selectedRoomArchived,
    onSessionAgentProfileChange,
    onFork,
    onOpenSession,
    onLoadOlderTracePage: () =>
      loadOlderTracePage(currentTraceView?.nextBeforeCursor ?? currentTraceView?.nextBeforeSequence),
    hasOlderTraceEvents:
      currentTraceView?.hasOlderEvents === true ||
      currentTraceView?.nextBeforeCursor !== undefined ||
      typeof currentTraceView?.nextBeforeSequence === "number",
    isFetchingOlderTracePage: loadingOlderTracePage,
    onThinkingLevelChange,
    onRefreshTrace,
    onRefreshBootstrap,
    onError,
  });

  const setLivePreviewActionPending = (key: string, pending: boolean) => {
    if (pending) pendingLivePreviewActionsRef.current.add(key);
    else pendingLivePreviewActionsRef.current.delete(key);
    setPendingLivePreviewActions(new Set(pendingLivePreviewActionsRef.current));
  };
  const runLivePreviewAction = async (
    previewId: string,
    action: "start" | "stop" | "remove",
  ) => {
    const piboSessionId = selectedBackendPiboSessionId;
    if (!piboSessionId) return;
    const actionKey = `${piboSessionId}:${previewId}`;
    if (pendingLivePreviewActionsRef.current.has(actionKey)) return;
    setLivePreviewActionPending(actionKey, true);
    try {
      const result = action === "start"
        ? await startSessionLivePreview(previewId)
        : action === "stop"
          ? await stopSessionLivePreview(previewId)
          : (await removeSessionLivePreview(previewId)).preview;
      const preview = requirePreviewActionAuthority(piboSessionId, result);
      queryClient.setQueryData<SessionLivePreviewQueryEnvelope>(livePreviewQueryKey(piboSessionId), (current) => {
        if (!current || current.piboSessionId !== piboSessionId) return current;
        return {
          ...current,
          previews: action === "remove"
            ? current.previews.filter((candidate) => candidate.id !== preview.id)
            : current.previews.map((candidate) => candidate.id === preview.id ? preview : candidate),
        };
      });
      if (selectedPreviewSessionRef.current === piboSessionId) {
        if (action === "start") {
          setLivePreviewReload((current) => ({
            piboSessionId,
            value: current?.piboSessionId === piboSessionId ? current.value + 1 : 1,
          }));
        }
        if (action === "remove" && selectedLivePreview?.piboSessionId === piboSessionId && selectedLivePreview.previewId === preview.id) {
          setSelectedLivePreview(undefined);
        }
      }
      await queryClient.invalidateQueries({ queryKey: livePreviewQueryKey(piboSessionId), exact: true });
    } catch (caught) {
      if (selectedPreviewSessionRef.current === piboSessionId) onError(errorMessage(caught));
    } finally {
      setLivePreviewActionPending(actionKey, false);
    }
  };
  const refreshLivePreviewFrame = () => {
    if (!selectedBackendPiboSessionId) return;
    setLivePreviewReload((current) => ({
      piboSessionId: selectedBackendPiboSessionId,
      value: current?.piboSessionId === selectedBackendPiboSessionId ? current.value + 1 : 1,
    }));
  };
  const selectLivePreview = (previewId: string) => {
    if (!selectedBackendPiboSessionId) return;
    setSelectedLivePreview({ piboSessionId: selectedBackendPiboSessionId, previewId });
  };
  const selectedLivePreviewActionPending = selectedLivePreviewRecord
    ? pendingLivePreviewActions.has(`${selectedLivePreviewRecord.piboSessionId}:${selectedLivePreviewRecord.id}`)
    : false;
  const previewAuthorityMessage = livePreviewAuthority.kind === "loading"
    ? <PreviewMessage label="Loading live previews…" />
    : livePreviewAuthority.kind === "error"
      ? <PreviewMessage label={livePreviewAuthority.message} tone="error" />
      : livePreviewAuthority.kind === "unconfigured"
        ? <PreviewMessage label="Live previews are not configured on this Pibo instance." />
        : <PreviewMessage label="No active live preview is attached to this Pibo Session." />;
  const previewPanelRequested = livePreviewSelected || Boolean(desktopToolHosts?.preview);
  const previewPanelContent = previewPanelRequested
    ? livePreviewAuthority.kind === "ready" && selectedLivePreviewRecord
      ? (
          <SessionLivePreviewPanel
            previews={livePreviews}
            selectedPreview={selectedLivePreviewRecord}
            loading={false}
            reloadKey={livePreviewReloadKey}
            onSelect={selectLivePreview}
            onReload={refreshLivePreviewFrame}
            onRefresh={() => void livePreviewsQuery.refetch()}
            onStart={(previewId) => void runLivePreviewAction(previewId, "start")}
            onStop={(previewId) => void runLivePreviewAction(previewId, "stop")}
            onRemove={(previewId) => void runLivePreviewAction(previewId, "remove")}
            actionPending={selectedLivePreviewActionPending}
            fullscreen={desktopPreviewFullscreen}
            onEnterFullscreen={onEnterDesktopPreviewFullscreen ?? onEnterTerminalFullscreen}
            onExitFullscreen={onExitDesktopPreviewFullscreen}
          />
        )
      : previewAuthorityMessage
    : undefined;
  const livePreviewPanel = livePreviewSelected ? previewPanelContent : undefined;
  const previewFullscreenContent = livePreviewSelected
    ? livePreviewAuthority.kind === "ready" && selectedLivePreviewRecord
      ? (
          <SessionLivePreviewPanel
            previews={livePreviews}
            selectedPreview={selectedLivePreviewRecord}
            loading={false}
            reloadKey={livePreviewReloadKey}
            fullscreen
            onSelect={selectLivePreview}
            onReload={refreshLivePreviewFrame}
            onRefresh={() => void livePreviewsQuery.refetch()}
            onStart={(previewId) => void runLivePreviewAction(previewId, "start")}
            onStop={(previewId) => void runLivePreviewAction(previewId, "stop")}
            onRemove={(previewId) => void runLivePreviewAction(previewId, "remove")}
            actionPending={selectedLivePreviewActionPending}
          />
        )
      : previewAuthorityMessage
    : undefined;
  const previewFullscreenTopBar = livePreviewSelected && selectedLivePreviewRecord ? (
    <PreviewFullscreenTopBar
      preview={selectedLivePreviewRecord}
      onReload={refreshLivePreviewFrame}
      onStart={() => void runLivePreviewAction(selectedLivePreviewRecord.id, "start")}
      onStop={() => void runLivePreviewAction(selectedLivePreviewRecord.id, "stop")}
      actionPending={selectedLivePreviewActionPending}
      onExit={onExitTerminalFullscreen ?? (() => undefined)}
    />
  ) : undefined;

  const desktopAnnotationsPanel = (
    <div className="h-full overflow-auto bg-[#101d22]">
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
        onClose={closeWebAnnotationsPanel}
      />
    </div>
  );
  const desktopRuntimeRequestsPanel = selectedBackendPiboSessionId ? (
    <div className="h-full overflow-auto bg-[#101d22]">
      {runtimeApprovals.length || runtimeUserInputs.length ? (
        <RuntimeRequestPanel
          piboSessionId={selectedBackendPiboSessionId}
          approvals={runtimeApprovals}
          userInputs={runtimeUserInputs}
          onResolved={removeRuntimeRequest}
          onError={onError}
        />
      ) : (
        <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-500" data-pibo-debug="desktop-runtime-requests-empty">No pending runtime requests for this Pibo Session.</div>
      )}
    </div>
  ) : <DesktopSessionToolEmpty label="Select a Pibo Session to inspect runtime requests." />;
  const desktopInspectorPanel = selectedPiboSessionId ? (
    <div className="h-full overflow-auto bg-[#0e1116] p-3" data-pibo-debug="desktop-session-inspector">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#11a4d4]">Selected Pibo Session</div>
      <JsonRenderer value={{
        piboSessionId: selectedPiboSessionId,
        roomId: selectedRoomId ?? bootstrap.selectedRoomId,
        profile: selectedSessionProfile,
        activeModel: selectedSessionActiveModel,
        status: selectedSessionStatus,
        runtimeStatus: bootstrap.runtimeStatus?.piboSessionId === selectedBackendPiboSessionId ? bootstrap.runtimeStatus : undefined,
        signal: selectedSessionSignal,
      }} />
    </div>
  ) : <DesktopSessionToolEmpty label="Select a Pibo Session to inspect it." />;
  const desktopToolPanels: Partial<Record<DesktopSessionTool, ReactNode>> = {
    preview: previewPanelContent ?? <DesktopSessionToolEmpty label="Select a Pibo Session to view its Preview." />,
    "raw-events": (
      <RawEventsSidebar
        traceView={currentTraceView}
        eventLimit={rawEventLimit}
        isFetching={rawEventsQuery.isFetching}
        visible
        onLoadOlder={loadMoreRawEvents}
      />
    ),
    "web-annotations": desktopAnnotationsPanel,
    "runtime-requests": desktopRuntimeRequestsPanel,
    "session-inspector": desktopInspectorPanel,
  };

  return (
    <>
      {pendingSendPlan ? (
        <DialogShell
          title="Session is running"
          description="Choose how this message should be delivered."
          onClose={closeDeliveryDialog}
          initialFocusRef={queueButtonRef}
        >
          <div className="grid gap-2 p-4 sm:grid-cols-2" data-pibo-debug="message-delivery-dialog">
            <button
              ref={queueButtonRef}
              type="button"
              onClick={() => void chooseDelivery("queue")}
              onKeyDown={(event) => moveDeliveryChoiceFocus("queue", event)}
              className="rounded-sm border border-slate-700 bg-[#151f24] p-3 text-left transition hover:border-[#11a4d4] hover:bg-[#11a4d4]/10 focus-visible:border-[#11a4d4] focus-visible:bg-[#11a4d4]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#11a4d4]/50 disabled:opacity-50"
              data-pibo-debug="message-delivery-queue"
            >
              <span className="block text-xs font-bold uppercase tracking-wider text-[#11a4d4]">Queue</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Run it as the next turn after the active turn finishes.</span>
            </button>
            <button
              ref={steerButtonRef}
              type="button"
              onClick={() => void chooseDelivery("steer")}
              onKeyDown={(event) => moveDeliveryChoiceFocus("steer", event)}
              className="rounded-sm border border-amber-500/50 bg-amber-500/5 p-3 text-left transition hover:border-amber-400 hover:bg-amber-500/10 focus-visible:border-amber-400 focus-visible:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:opacity-50"
              data-pibo-debug="message-delivery-steer"
            >
              <span className="block text-xs font-bold uppercase tracking-wider text-amber-400">Steer</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Add it to the active turn after the current tool finishes, before the next model step.</span>
            </button>
          </div>
        </DialogShell>
      ) : null}
      <SessionTraceLayout
      selectedPiboSessionId={selectedPiboSessionId}
      selectedRoomId={selectedRoomId}
      fallbackRoomId={bootstrap.selectedRoomId ?? undefined}
      sessionViewId={sessionViewId}
      loadingTrace={loadingTrace}
      roomNavigationPending={roomNavigationPending}
      sessionNavigationPending={sessionNavigationPending}
      traceError={traceError}
      showRawEvents={showRawEvents && !livePreviewSelected && desktopActiveTool !== "raw-events"}
      currentTraceView={currentTraceView}
      rawEventLimit={rawEventLimit}
      tracePageFetching={showRawEvents ? rawEventsQuery.isFetching : tracePageQuery.isFetching}
      onLoadMoreRawEvents={loadMoreRawEvents}
      terminalFullscreen={terminalFullscreen}
      fullscreenTopBar={previewFullscreenTopBar}
      fullscreenContent={previewFullscreenContent}
      hideComposer={livePreviewSelected}
      terminalFileDropEnabled={terminalFileDropEnabled}
      onTerminalFilesDropped={handleTerminalFilesDropped}
      onOpenSessionWindow={onOpenSessionWindow}
      onExitTerminalFullscreen={onExitTerminalFullscreen ?? (() => undefined)}
      headerProps={{
        title: resolveSessionTraceTitle({
          sessionNodes: bootstrap.sessions,
          selectedPiboSessionId,
          traceTitle: currentTraceView?.title,
          fallback: "No session selected",
        }),
        contextKind,
        contextLabel:
          contextLabel ??
          (bootstrap.room?.id === selectedRoomId
            ? bootstrap.room.name
            : undefined) ??
          selectedRoomId ??
          "Unknown room",
        headerPiboSessionId,
        piboSessionId: selectedPiboSessionId,
        piboRoomId: selectedRoomId ?? bootstrap.selectedRoomId ?? undefined,
        terminalUsageStatus: terminalUsageQuery.data,
        webAnnotationsDisabled: !selectedPiboSessionId || selectedRoomArchived,
        webAnnotationsPanelRendered,
        workflowHeader,
        sessionViewId,
        currentSessionView,
        activeViewId: livePreviewSelected ? "preview" : activeViewId,
        desktopTerminalOnly,
        terminalFullscreenAvailable: !livePreviewSelected && currentSessionView.id === "terminal" && (activeViewId ?? sessionViewId) === "terminal",
        onEnterTerminalFullscreen,
        onOpenSessionWindow,
        debugMode,
        showThinking,
        expandThinking,
        toolDisplayMode: effectiveToolDisplayMode,
        toolIntentSupported,
        onToolDisplayModeChange,
        onShowWebAnnotationsPanel: () => onOpenDesktopTool ? onOpenDesktopTool("web-annotations") : setWebAnnotationsPanelVisible(true),
        onHideWebAnnotationsPanel: () => setWebAnnotationsPanelVisible(false),
        onToggleDebugMode,
        onToggleThinking,
        onToggleExpandThinking,
        onError,
      }}
      auxiliaryPanel={livePreviewPanel}
      currentSessionView={currentSessionView}
      sessionViewProps={sessionViewProps}
      webAnnotationsPanelRendered={webAnnotationsPanelRendered && !livePreviewSelected && desktopActiveTool !== "web-annotations"}
      webAnnotationsPanelProps={{
        piboSessionId: selectedPiboSessionId,
        annotations: visibleWebAnnotations,
        selectedIds: selectedWebAnnotationIds,
        loading:
          webAnnotationsQuery.isLoading ||
          webAnnotationsQuery.isFetching ||
          clearingWebAnnotations,
        error: webAnnotationsQuery.error
          ? errorMessage(webAnnotationsQuery.error)
          : null,
        collapsed: webAnnotationsPanelCollapsed,
        onRefresh: () => void webAnnotationsQuery.refetch(),
        onToggle: toggleWebAnnotationAttachment,
        onClear: () => void clearVisibleWebAnnotations(),
        onCollapse: toggleWebAnnotationsPanelCollapsed,
        onClose: () => setWebAnnotationsPanelVisible(false),
      }}
      runtimeRequestPanel={selectedBackendPiboSessionId && !livePreviewSelected && desktopActiveTool !== "runtime-requests" ? (
        <RuntimeRequestPanel
          piboSessionId={selectedBackendPiboSessionId}
          approvals={runtimeApprovals}
          userInputs={runtimeUserInputs}
          onResolved={removeRuntimeRequest}
          onError={onError}
        />
      ) : undefined}
      containerResponsive={containerResponsive}
      composerProps={{
        sessionId: selectedPiboSessionId,
        disabled: composerDisabled,
        commands,
        skills,
        value: composerText,
        focusSignal: composerFocusSignal,
        selectedWebAnnotations,
        selectedUploadAttachments,
        onValueChange: onComposerTextChange,
        onCommand,
        onDetachWebAnnotation: detachWebAnnotationAttachment,
        onClearWebAnnotations: clearSelectedWebAnnotationAttachments,
        onAttachUploadedFiles: attachUploadedFiles,
        onDetachUploadAttachment: detachUploadAttachment,
        onClearUploadAttachments: clearSelectedUploadAttachments,
        onSend: handleComposerSend,
      }}
      />
      {desktopToolHosts ? (Object.entries(desktopToolHosts) as Array<[DesktopSessionTool, Element | null | undefined]>).map(([tool, host]) =>
        host && desktopToolPanels[tool] ? createPortal(desktopToolPanels[tool], host, `desktop-session-tool-${tool}`) : null,
      ) : null}
    </>
  );
}

function DesktopSessionToolEmpty({ label }: { label: string }) {
  return <div className="grid h-full place-items-center bg-[#0e1116] p-6 text-center text-sm text-slate-500">{label}</div>;
}

export function closeHostedWebAnnotations(
  hosted: boolean,
  onCloseDesktopTool: ((tool: DesktopSessionTool) => void) | undefined,
  setPanelVisible: (visible: boolean) => void,
): void {
  if (hosted && onCloseDesktopTool) onCloseDesktopTool("web-annotations");
  else setPanelVisible(false);
}
