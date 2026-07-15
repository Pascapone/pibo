import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
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
import {
  getChatSessionView,
  listChatSessionViews,
} from "./session-views/registry";
import { SessionTraceLayout } from "./session-trace-layout";
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
} from "./composer-send";
import { createClientTxnId } from "./app-session-model";
import {
  createWorkflowHeaderSummary,
  isWorkflowBackedProjectSession,
} from "./projects/project-session-workflow";
import { errorMessage } from "./error-message";

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
  ) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const liveEventSeqRef = useRef(0);
  const [liveTraceOverlay, setLiveTraceOverlay] =
    useState<LiveTraceOverlay | null>(null);
  const {
    baseTraceView,
    rawEventLimit,
    traceSummaryQuery,
    tracePageQuery,
    rawEventsQuery,
    loadingOlderTracePage,
    tracePageReady,
    loadOlderTracePage,
    loadMoreRawEvents,
  } = useSessionTracePage({
    selectedPiboSessionId,
    showRawEvents,
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
    selectedPiboSessionId,
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
    selectedPiboSessionId,
    baseTraceView,
    liveTraceOverlay,
    selectedSessionStatus,
  });

  useSessionTraceLiveStream({
    selectedPiboSessionId,
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

  const handleComposerSend = async (text: string) => {
    if (!selectedPiboSessionId) return;
    const sendPlan = createComposerSendPlan({
      piboSessionId: selectedPiboSessionId,
      text,
      selectedWebAnnotations,
      selectedUploadAttachments,
      eventSequence: liveEventSeqRef.current++,
      now: new Date().toISOString(),
      clientTxnId: createClientTxnId(),
    });
    setLiveTraceOverlay((current) =>
      appendComposerOptimisticEvent(
        current,
        selectedPiboSessionId,
        sendPlan.optimisticEvent,
      ),
    );
    await onSend(
      sendPlan.text,
      sendPlan.webAnnotationIds,
      sendPlan.fileAttachmentPaths,
      sendPlan.clientTxnId,
    );
    clearSelectedWebAnnotationAttachments();
    clearSelectedUploadAttachments();
    await Promise.all([
      tracePageQuery.refetch(),
      webAnnotationsQuery.refetch(),
    ]);
    schedulePostSendTraceRefresh(selectedPiboSessionId);
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
        disabled: !selectedPiboSessionId || selectedRoomArchived,
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
  );
}
