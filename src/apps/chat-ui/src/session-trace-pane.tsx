import { withMessageReceipts } from "./tracing/message-receipts";
import {
  useCallback,
  useContext,
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
import type { ChatSessionViewId, ChatSessionViewProps, ToolDisplayMode } from "./session-views/types";
import { getMessageReceipts, getSessionForkCandidates, getSessionStatus, type ChatMessageDelivery } from "./api-chat-sessions";
import { BrowserPluginContext } from "./plugins/browser-host";
import { useIndexedComposerAttachments } from "./attachments/use-indexed-attachments";
import { deliverTypedIndexedAttachments } from "./attachments/core-attachment-delivery-client";
import { addWithProvider } from "./attachments/core-attachment-provider-commands";
import { structuredComposerIntent } from "./attachments/core-attachment-composer-intent";
import { createMessageReceiptsQuery } from "./attachments/core-attachment-receipts";
import type { AttachmentPreparedSubmission } from "./attachments/core-attachment-draft";
import { AttachmentDraftError } from "../../../attachments/errors";
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
import { compactWebAnnotationError, WebAnnotationsControls, WebAnnotationsSessionPanel } from "./web-annotations";
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
  beginComposerDraftSend,
  createComposerDraftTracker,
  createComposerSendPlan,
  restoreComposerDraftSend,
  settleComposerDraftSend,
  updateComposerDraft,
  withComposerSendDelivery,
  type ComposerSendPlan,
  readPendingMessageTransaction,
  rememberPendingMessageTransaction,
  samePendingMessageIntent,
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
import { DEFAULT_TOOL_METRIC_THRESHOLDS, type ToolMetricThresholds } from "./tool-metric-settings";

const livePreviewQueryKey = (piboSessionId: string) => ["chat", "session-live-previews", piboSessionId] as const;

export function SessionTracePane({
  bootstrap,
  selectedPiboSessionId,
  selectedRoomId,
  targetToolCallNodeId,
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
  debugFeatures,
  toolMetricThresholds = DEFAULT_TOOL_METRIC_THRESHOLDS,
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
  onSendPrepared,
  onError,
  desktopActiveTool = null,
  desktopToolHosts,
}: {
  bootstrap: BootstrapData;
  selectedPiboSessionId: string | null;
  selectedRoomId: string | null;
  targetToolCallNodeId?: string;
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
  debugFeatures?: ChatSessionViewProps["debugFeatures"];
  toolMetricThresholds?: ToolMetricThresholds;
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
  onSendPrepared: (prepared: AttachmentPreparedSubmission, expectedOwnerUserId: string) => Promise<unknown>;
  onError: (message: string | null) => void;
  desktopActiveTool?: DesktopSessionTool | null;
  desktopToolHosts?: Partial<Record<DesktopSessionTool, Element | null>>;
}) {
  const queryClient = useQueryClient();
  const [initialRetryTransaction] = useState(readPendingMessageTransaction);
  const retrySendPlanRef = useRef<ReturnType<typeof readPendingMessageTransaction>>(initialRetryTransaction);
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
  const composerDraftRef = useRef(createComposerDraftTracker(composerText));
  const composerDraftSessionRef = useRef(selectedPiboSessionId);
  const [runtimeApprovals, setRuntimeApprovals] = useState<PiboRuntimeApprovalRequest[]>([]);
  const [runtimeUserInputs, setRuntimeUserInputs] = useState<PiboRuntimeUserInputRequest[]>([]);
  const deliverySendIdsRef = useRef(new Set<string>());
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const steerButtonRef = useRef<HTMLButtonElement>(null);
  const selectedBackendPiboSessionId = selectedSessionBackendId(selectedPiboSessionId);
  const ownerUserId = bootstrap.identity?.userId;
  const pluginContext = useContext(BrowserPluginContext);
  const typedAttachments = useIndexedComposerAttachments(ownerUserId, selectedBackendPiboSessionId);
  const composerOwnerRef = useRef(ownerUserId);
  useEffect(() => {
    if (composerOwnerRef.current === ownerUserId) return;
    composerOwnerRef.current = ownerUserId;
    setPendingSendPlan(null);
    retrySendPlanRef.current = null;
    rememberPendingMessageTransaction(null);
    composerDraftRef.current = createComposerDraftTracker(composerText);
  }, [ownerUserId, composerText]);
  useEffect(() => {
    if (
      composerDraftSessionRef.current === selectedPiboSessionId
      && composerDraftRef.current.value === composerText
    ) return;
    composerDraftSessionRef.current = selectedPiboSessionId;
    composerDraftRef.current = createComposerDraftTracker(composerText);
  }, [composerText, selectedPiboSessionId]);

  const updateTrackedComposerText = useCallback<Dispatch<SetStateAction<string>>>((update) => {
    const current = composerDraftRef.current.value;
    const next = typeof update === "function" ? update(current) : update;
    composerDraftRef.current = updateComposerDraft(composerDraftRef.current, next);
    onComposerTextChange(next);
  }, [onComposerTextChange]);
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
  const hasAvailableAgentRuntime = bootstrap.agentCatalog?.agentRuntimes.some((runtime) => runtime.enabled && runtime.available) ?? false;
  const sessionGoalQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? ["chat", "session-goal", selectedBackendPiboSessionId]
      : ["chat", "session-goal", "idle"],
    queryFn: ({ signal }) => getLoopSessionGoal(selectedBackendPiboSessionId!, { signal }),
    enabled: Boolean(selectedBackendPiboSessionId && hasAvailableAgentRuntime),
    refetchInterval: selectedBackendPiboSessionId && hasAvailableAgentRuntime ? 5_000 : false,
  });
  const selectedPreviewSessionRef = useRef<string | undefined>(selectedBackendPiboSessionId);
  selectedPreviewSessionRef.current = selectedBackendPiboSessionId;
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
    enabled: Boolean(selectedBackendPiboSessionId && hasAvailableAgentRuntime),
    refetchInterval: (query) => selectedBackendPiboSessionId && hasAvailableAgentRuntime && query.state.data?.configured !== false ? 5_000 : false,
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
    webAnnotationsQuery,
    clearingWebAnnotations,
    toggleWebAnnotationAttachment,
    detachWebAnnotationAttachment,
    clearSelectedWebAnnotationAttachments,
    clearVisibleWebAnnotations,
  } = useSessionWebAnnotations({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    onError,
    formatError: compactWebAnnotationError,
    forcePanelVisible: false,
  });
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

  const structuredAttachments = typedAttachments.loaded?.view.records.map((record) => ({
    id: record.envelope.id as string,
    title: record.envelope.type === "pibo.core/note" && typeof (record.payload as { text?: unknown }).text === "string"
      ? (record.payload as { text: string }).text : record.envelope.type,
  })) ?? [];
  const addStructuredNote = async (text: string) => {
    const sessionId = selectedBackendPiboSessionId;
    const draft = typedAttachments.draft;
    const host = pluginContext?.host;
    if (!ownerUserId || !sessionId || !draft || !host || host.plan.piboSessionId !== sessionId) {
      throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "The session's structured attachment draft or provider is not ready.", retryable: true });
    }
    const loaded = await typedAttachments.reload();
    if (!loaded) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "The structured attachment owner changed.", retryable: false });
    await addWithProvider({ draft, expectedRevision: loaded.revision,
      lookup: host.lookupAttachmentProvider.bind(host), scope: { sessionId }, type: "pibo.core/note", schemaVersion: 1, source: { text } });
    typedAttachments.assertCurrent(ownerUserId, sessionId, draft);
    await typedAttachments.reload();
  };
  const detachStructuredAttachment = async (id: string) => {
    const sessionId = selectedBackendPiboSessionId;
    const draft = typedAttachments.draft;
    if (!ownerUserId || !sessionId || !draft) throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "The structured attachment owner changed.", retryable: false });
    const loaded = await typedAttachments.reload();
    const record = loaded?.view.records.find((item) => item.envelope.id === id);
    if (!loaded || !record) throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Structured attachment changed; reload before removing.", retryable: false });
    await draft.execute(loaded.revision, { kind: "remove", id: record.envelope.id });
    typedAttachments.assertCurrent(ownerUserId, sessionId, draft);
    await typedAttachments.reload();
  };

  const rawCurrentTraceView = useCurrentSessionTrace({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    baseTraceView,
    liveTraceOverlay: selectedLiveTraceOverlay,
    selectedSessionStatus,
  });
  const forkSupported = sessionSupportsFork(bootstrap, selectedPiboSessionId, selectedSessionProfile);
  const forkWhileRunningSupported = sessionSupportsForkWhileRunning(bootstrap, selectedPiboSessionId, selectedSessionProfile);
  const messageReceiptsQuery = useQuery({
    queryKey: ["chat", "message-receipts", selectedBackendPiboSessionId],
    queryFn: () => getMessageReceipts(selectedBackendPiboSessionId!),
    enabled: Boolean(selectedBackendPiboSessionId),
    refetchInterval: 1_000,
    retry: false,
  });
  const currentTraceView = useMemo(() => withMessageReceipts(rawCurrentTraceView, messageReceiptsQuery.data?.receipts ?? []), [rawCurrentTraceView,messageReceiptsQuery.data]);

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
    retrySendPlanRef.current = sendPlan;
    rememberPendingMessageTransaction(sendPlan);
    const sessionId = sendPlan.piboSessionId;
    const draft = typedAttachments.draft;
    if (ownerUserId && selectedBackendPiboSessionId === sessionId && !draft) {
      throw new AttachmentDraftError({ code: "ATT_STORAGE_FAILED", message: typedAttachments.error ?? "Attachment draft is opening; retry the unchanged send after it loads.", retryable: true });
    }
    const loaded = draft ? await typedAttachments.reload() : undefined;
    const bound = Boolean(loaded && (loaded.view.openSnapshots.some((entry) => entry.clientTxnId === sendPlan.clientTxnId)
      || Object.hasOwn(loaded.view.preparedSubmissions, sendPlan.clientTxnId)
      || loaded.view.acceptedTransactions.includes(sendPlan.clientTxnId)));
    const currentIntent = structuredComposerIntent(loaded?.view.records ?? [], ownerUserId);
    if (!bound && currentIntent !== sendPlan.attachmentIntent) {
      throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "Structured attachments changed before send; review them and retry.", retryable: false });
    }
    const typed = Boolean(bound || loaded?.view.records.length);
    if (!typed && sendPlan.text === "") {
      throw new AttachmentDraftError({ code: "ATT_STALE_REVISION", message: "The structured attachment was removed before this empty-text send; review and retry.", retryable: false });
    }
    if (typed) {
      if (!draft || !loaded || !ownerUserId || selectedBackendPiboSessionId !== sessionId) {
        throw new AttachmentDraftError({ code: "ATT_ACCESS_DENIED", message: "Typed attachment owner or Pibo Session changed.", retryable: false });
      }
      if (sendPlan.fileAttachmentPaths.length) {
        throw new AttachmentDraftError({ code: "ATT_INVALID_JSON", message: "Typed attachments cannot be sent together with legacy uploaded paths. Detach the legacy uploads first.", retryable: false });
      }
      if (!loaded.view.acceptedTransactions.includes(sendPlan.clientTxnId)) {
        const host = pluginContext?.host;
        if (!host || host.plan.piboSessionId !== sessionId) {
          throw new AttachmentDraftError({ code: "ATT_PROVIDER_MISSING", message: "Attachment providers for this Pibo Session are not ready.", retryable: true });
        }
        await deliverTypedIndexedAttachments({
          draft, expectedRevision: loaded.revision,
          lookup: host.lookupAttachmentProvider.bind(host), getPin: host.getAttachmentProviderPin.bind(host),
          scope: { sessionId }, clientTxnId: sendPlan.clientTxnId, text: sendPlan.text, delivery,
          ...(selectedRoomId ? { roomId: selectedRoomId } : {}), webAnnotationIds: sendPlan.webAnnotationIds,
          query: createMessageReceiptsQuery({ sessionId, fetchJson: () => getMessageReceipts(sessionId) }),
          postPrepared: (prepared) => onSendPrepared(prepared, ownerUserId),
          beforePost: () => typedAttachments.assertCurrent(ownerUserId, sessionId, draft),
        });
        void typedAttachments.reload().catch(() => undefined);
      }
      // Admission is durable here; a background bootstrap refresh is not
      // allowed to roll back the original typed send or consume twice.
      void onRefreshBootstrap().catch((caught) => onError(errorMessage(caught)));
    } else {
      await onSend(
        sendPlan.text,
        sendPlan.webAnnotationIds,
        sendPlan.fileAttachmentPaths,
        sendPlan.clientTxnId,
        delivery,
      );
    }
    retrySendPlanRef.current = null;
    rememberPendingMessageTransaction(null);
    composerDraftRef.current = settleComposerDraftSend(composerDraftRef.current, sendPlan.clientTxnId);
    void messageReceiptsQuery.refetch();
    clearSelectedWebAnnotationAttachments();
    clearSelectedUploadAttachments();
    // Acceptance is already durable; a refresh error must not roll the send back.
    void Promise.all([
      tracePageQuery.refetch(),
      webAnnotationsQuery.refetch(),
    ]).catch((caught) => onError(errorMessage(caught)));
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
    const restored = restoreComposerDraftSend(composerDraftRef.current, sendPlan);
    composerDraftRef.current = restored.tracker;
    if (restored.restored) onComposerTextChange(restored.tracker.value);
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
    // Do not replace a recovered typed retry identity while its draft is still
    // opening: an empty transient view cannot describe that prepared body.
    if (ownerUserId && selectedBackendPiboSessionId === selectedPiboSessionId && !typedAttachments.draft) {
      onError(typedAttachments.error ?? "Attachment draft is opening; retry the unchanged send after it loads.");
      return;
    }
    const attachmentIntent = structuredComposerIntent(typedAttachments.loaded?.view.records ?? [], ownerUserId);
    const sendPlan = createComposerSendPlan({
      piboSessionId: selectedPiboSessionId,
      text,
      attachmentIntent,
      selectedWebAnnotations,
      selectedUploadAttachments,
      eventSequence: liveEventSeqRef.current++,
      now: new Date().toISOString(),
      clientTxnId: samePendingMessageIntent(retrySendPlanRef.current, { piboSessionId: selectedPiboSessionId, text, attachmentIntent, webAnnotationIds: selectedWebAnnotations.map(a => a.id), fileAttachmentPaths: selectedUploadAttachments.map(a => a.path) }) ? retrySendPlanRef.current!.clientTxnId : createClientTxnId(),
    });
    composerDraftRef.current = beginComposerDraftSend(composerDraftRef.current, sendPlan);
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
    const restored = restoreComposerDraftSend(composerDraftRef.current, pendingSendPlan);
    composerDraftRef.current = restored.tracker;
    if (restored.restored) onComposerTextChange(restored.tracker.value);
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
    debugFeatures,
    toolMetricThresholds,
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
    targetToolCallNodeId,
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
  const previewPanelRequested = livePreviewSelected;
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
            fullscreen={false}
            onEnterFullscreen={onEnterTerminalFullscreen}
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
    "raw-events": (
      <RawEventsSidebar
        traceView={currentTraceView}
        eventLimit={rawEventLimit}
        isFetching={rawEventsQuery.isFetching}
        visible
        onLoadOlder={loadMoreRawEvents}
      />
    ),
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
        terminalUsageStatus: terminalUsageQuery.data,
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
        onToggleDebugMode,
        onToggleThinking,
        onToggleExpandThinking,
      }}
      auxiliaryPanel={livePreviewPanel}
      currentSessionView={currentSessionView}
      sessionViewProps={sessionViewProps}
      runtimeRequestPanel={selectedBackendPiboSessionId && !livePreviewSelected ? (
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
        ownerUserId,
        disabled: composerDisabled,
        commands,
        skills,
        value: composerText,
        focusSignal: composerFocusSignal,
        selectedWebAnnotations,
        selectedUploadAttachments,
        structuredAttachments,
        onAddStructuredNote: ownerUserId && selectedBackendPiboSessionId ? addStructuredNote : undefined,
        onDetachStructuredAttachment: detachStructuredAttachment,
        onValueChange: updateTrackedComposerText,
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
