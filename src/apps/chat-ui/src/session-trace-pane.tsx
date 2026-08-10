import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  BootstrapData,
  PiboProjectSession,
  PiboSignalSnapshot,
  PiboWebSessionStatus,
  ThinkingLevel,
  WorkflowLifecycleEventRecord,
} from "./types";
import type { SlashCommand } from "./chat-commands";
import type { ChatSessionViewId } from "./session-views/types";
import type { ChatMessageDelivery } from "./api-chat-sessions";
import { getLoopSessionGoal } from "./api-loops";
import {
  getChatSessionView,
  listChatSessionViews,
} from "./session-views/registry";
import { SessionTraceLayout } from "./session-trace-layout";
import { DialogShell } from "./components/DialogShell";
import type { SessionTraceHeaderExtraViewTab } from "./session-trace-header";
import type { LiveTraceOverlay } from "./tracing/live-overlay";
import { useCurrentSessionTrace } from "./tracing/use-current-session-trace";
import { useSessionTracePage } from "./tracing/use-session-trace-page";
import { useSessionTraceLiveStream } from "./tracing/use-session-trace-live-stream";
import { useSessionUploadAttachments } from "./chat-upload-attachments";
import { useSessionWebAnnotations } from "./use-session-web-annotations";
import { compactWebAnnotationError } from "./web-annotations";
import {
  createSessionTraceViewLinks,
  createSessionTraceViewProps,
  resolveSessionTraceModelBadge,
  resolveSessionTraceTitle,
} from "./session-trace-view-props";
import {
  appendComposerOptimisticEvent,
  createComposerSendPlan,
  withComposerSendDelivery,
  type ComposerSendPlan,
} from "./composer-send";
import {
  createClientTxnId,
  isSessionComposerDisabled,
} from "./app-session-model";
import { selectedSessionBackendId } from "./selected-session-backend";
import {
  createWorkflowHeaderSummary,
  isWorkflowBackedProjectSession,
} from "./projects/project-session-workflow";
import { errorMessage } from "./error-message";
import {
  canOpenDesktopPwaSessionWindow,
  openCurrentPwaSessionWindow,
} from "./pwa-session-window";

export function SessionTracePane({
  bootstrap,
  selectedPiboSessionId,
  selectedRoomId,
  selectedRoomArchived,
  roomNavigationPending,
  sessionNavigationPending,
  selectedSessionProfile,
  selectedSessionActiveModel,
  selectedSessionStatus,
  selectedSessionSignal,
  signals,
  workflowProjectSession,
  workflowLifecycleEvents,
  projectSessionCreatePanel,
  workflowStartPanel,
  projectModulePanel,
  extraViewTabs,
  activeViewId,
  sessionViewId,
  sessionViews,
  currentSessionView,
  allowedSessionViewIds,
  creatingSession,
  terminalFullscreen = false,
  onEnterTerminalFullscreen,
  onExitTerminalFullscreen,
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
  roomNavigationPending?: boolean;
  sessionNavigationPending?: boolean;
  selectedSessionProfile: string;
  selectedSessionActiveModel?: string;
  selectedSessionStatus?: PiboWebSessionStatus;
  selectedSessionSignal?: PiboSignalSnapshot["sessions"][string];
  signals?: PiboSignalSnapshot;
  workflowProjectSession?: PiboProjectSession;
  workflowLifecycleEvents?: readonly WorkflowLifecycleEventRecord[];
  projectSessionCreatePanel?: ReactNode;
  workflowStartPanel?: ReactNode;
  projectModulePanel?: ReactNode;
  extraViewTabs?: readonly SessionTraceHeaderExtraViewTab[];
  activeViewId?: string;
  sessionViewId: ChatSessionViewId;
  sessionViews: ReturnType<typeof listChatSessionViews>;
  currentSessionView: ReturnType<typeof getChatSessionView>;
  allowedSessionViewIds?: readonly ChatSessionViewId[];
  creatingSession: boolean;
  terminalFullscreen?: boolean;
  onEnterTerminalFullscreen?: () => void;
  onExitTerminalFullscreen?: () => void;
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
  onSend: (
    text: string,
    webAnnotationIds?: readonly string[],
    fileAttachmentPaths?: readonly string[],
    clientTxnId?: string,
    delivery?: ChatMessageDelivery,
  ) => Promise<void>;
  onError: (message: string | null) => void;
}) {
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
  const deliverySendIdsRef = useRef(new Set<string>());
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const selectedBackendPiboSessionId = selectedSessionBackendId(selectedPiboSessionId);
  const sessionGoalQuery = useQuery({
    queryKey: selectedBackendPiboSessionId
      ? ["chat", "session-goal", selectedBackendPiboSessionId]
      : ["chat", "session-goal", "idle"],
    queryFn: ({ signal }) => getLoopSessionGoal(selectedBackendPiboSessionId!, { signal }),
    enabled: Boolean(selectedBackendPiboSessionId),
    refetchInterval: selectedBackendPiboSessionId ? 5_000 : false,
  });
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
    showRawEvents,
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

  const currentTraceView = useCurrentSessionTrace({
    selectedPiboSessionId: selectedBackendPiboSessionId,
    baseTraceView,
    liveTraceOverlay: selectedLiveTraceOverlay,
    selectedSessionStatus,
  });

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
  );

  const headerPiboSessionId =
    currentTraceView?.piboSessionId ?? selectedPiboSessionId ?? "";
  const workflowHeader =
    workflowProjectSession &&
    isWorkflowBackedProjectSession(workflowProjectSession)
      ? createWorkflowHeaderSummary(
          workflowProjectSession,
          selectedSessionStatus,
        )
      : null;

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
    if (selectedSessionStatus === "running") {
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

  const sessionViewProps = createSessionTraceViewProps({
    currentTraceView,
    isLoading: loadingTrace,
    showThinking,
    expandThinking,
    selectedSessionProfile,
    sessionActiveModelBadge,
    selectedSessionStatus,
    selectedSessionSignal,
    signals,
    sessionGoal: sessionGoalQuery.data?.goal,
    workflowProjectSession,
    workflowLifecycleEvents,
    sessionNodes: bootstrap.sessions,
    sessionLinks,
    agentProfiles: bootstrap.agents,
    sessionProfileChangeDisabled: creatingSession || selectedRoomArchived,
    onSessionAgentProfileChange,
    onFork,
    onOpenSession,
    onLoadOlderTracePage: () =>
      void loadOlderTracePage(currentTraceView?.nextBeforeCursor ?? currentTraceView?.nextBeforeSequence),
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
              className="rounded-sm border border-slate-700 bg-[#151f24] p-3 text-left transition hover:border-[#11a4d4] hover:bg-[#11a4d4]/10 disabled:opacity-50"
              data-pibo-debug="message-delivery-queue"
            >
              <span className="block text-xs font-bold uppercase tracking-wider text-[#11a4d4]">Queue</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">Run it as the next turn after the active turn finishes.</span>
            </button>
            <button
              type="button"
              onClick={() => void chooseDelivery("steer")}
              className="rounded-sm border border-amber-500/50 bg-amber-500/5 p-3 text-left transition hover:border-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
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
      showRawEvents={showRawEvents}
      currentTraceView={currentTraceView}
      rawEventLimit={rawEventLimit}
      tracePageFetching={showRawEvents ? rawEventsQuery.isFetching : tracePageQuery.isFetching}
      onLoadMoreRawEvents={loadMoreRawEvents}
      terminalFullscreen={terminalFullscreen}
      onOpenSessionWindow={onOpenSessionWindow}
      onExitTerminalFullscreen={onExitTerminalFullscreen ?? (() => undefined)}
      headerProps={{
        title: resolveSessionTraceTitle({
          sessionNodes: bootstrap.sessions,
          selectedPiboSessionId,
          traceTitle: currentTraceView?.title,
          fallback: bootstrap.room?.name ?? selectedRoomId ?? undefined,
        }),
        roomLabel: bootstrap.room?.name ?? selectedRoomId ?? "Room",
        headerPiboSessionId,
        piboSessionId: selectedPiboSessionId,
        piboRoomId: selectedRoomId ?? bootstrap.selectedRoomId ?? undefined,
        webAnnotationsDisabled: !selectedPiboSessionId || selectedRoomArchived,
        webAnnotationsPanelRendered,
        workflowHeader,
        sessionViewId,
        sessionViews,
        currentSessionView,
        allowedSessionViewIds,
        extraViewTabs,
        activeViewId,
        terminalFullscreenAvailable: currentSessionView.id === "terminal" && (activeViewId ?? sessionViewId) === "terminal",
        onEnterTerminalFullscreen,
        onOpenSessionWindow,
        showRawEvents,
        showThinking,
        expandThinking,
        onShowWebAnnotationsPanel: () => setWebAnnotationsPanelVisible(true),
        onHideWebAnnotationsPanel: () => setWebAnnotationsPanelVisible(false),
        onSelectSessionView,
        onToggleRawEvents,
        onToggleThinking,
        onToggleExpandThinking,
        onError,
      }}
      projectSessionCreatePanel={projectSessionCreatePanel}
      workflowStartPanel={workflowStartPanel}
      projectModulePanel={projectModulePanel}
      currentSessionView={currentSessionView}
      sessionViewProps={sessionViewProps}
      webAnnotationsPanelRendered={webAnnotationsPanelRendered}
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
    </>
  );
}
