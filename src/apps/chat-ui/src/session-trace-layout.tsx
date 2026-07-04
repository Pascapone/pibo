import type { ComponentProps, ReactNode } from "react";

import { Composer } from "./composer/Composer";
import { SessionTraceHeader } from "./session-trace-header";
import type { getChatSessionView } from "./session-views/registry";
import type { ChatSessionViewProps } from "./session-views/types";
import type { PiboSessionTraceView } from "./types";
import { WebAnnotationsSessionPanel } from "./web-annotations";
import { RawEventsSidebar } from "./tracing/RawEventsSidebar";
import { TraceHistoryLoadMore } from "./tracing/TraceHistoryLoadMore";

type SessionTraceLayoutProps = {
  selectedPiboSessionId: string | null;
  selectedRoomId: string | null;
  fallbackRoomId?: string;
  sessionViewId: string;
  loadingTrace: boolean;
  traceError: string | null;
  showRawEvents: boolean;
  currentTraceView: PiboSessionTraceView | null;
  traceEventLimit: number;
  rawEventLimit: number;
  tracePageFetching: boolean;
  onLoadOlderTracePage: (beforeSequence?: number) => void;
  onLoadMoreRawEvents: () => void;
  headerProps: ComponentProps<typeof SessionTraceHeader>;
  projectSessionCreatePanel?: ReactNode;
  workflowStartPanel?: ReactNode;
  projectModulePanel?: ReactNode;
  currentSessionView: ReturnType<typeof getChatSessionView>;
  sessionViewProps: ChatSessionViewProps;
  webAnnotationsPanelRendered: boolean;
  webAnnotationsPanelProps: ComponentProps<typeof WebAnnotationsSessionPanel>;
  composerProps: ComponentProps<typeof Composer>;
};

export function SessionTraceLayout({
  selectedPiboSessionId,
  selectedRoomId,
  fallbackRoomId,
  sessionViewId,
  loadingTrace,
  traceError,
  showRawEvents,
  currentTraceView,
  traceEventLimit,
  rawEventLimit,
  tracePageFetching,
  onLoadOlderTracePage,
  onLoadMoreRawEvents,
  headerProps,
  projectSessionCreatePanel,
  workflowStartPanel,
  projectModulePanel,
  currentSessionView,
  sessionViewProps,
  webAnnotationsPanelRendered,
  webAnnotationsPanelProps,
  composerProps,
}: SessionTraceLayoutProps) {
  return (
    <>
      <main
        data-pibo-debug="chat-shell"
        data-pibo-session-id={selectedPiboSessionId ?? undefined}
        data-pibo-room-id={selectedRoomId ?? fallbackRoomId ?? undefined}
        data-pibo-view-id={sessionViewId}
        data-pibo-state={
          loadingTrace
            ? "loading"
            : traceError
              ? "error"
              : selectedPiboSessionId
                ? "ready"
                : "empty"
        }
        className="min-h-0 flex flex-col"
      >
        <SessionTraceHeader {...headerProps} />
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
        <TraceHistoryLoadMore
          traceView={currentTraceView}
          eventLimit={traceEventLimit}
          isFetching={tracePageFetching}
          onLoadOlder={() =>
            onLoadOlderTracePage(currentTraceView?.nextBeforeSequence)
          }
        />
        {projectModulePanel ? (
          projectModulePanel
        ) : traceError && !currentTraceView ? (
          <div className="min-h-0 flex-1 p-4 text-sm text-red-200">
            {traceError}
          </div>
        ) : (
          currentSessionView.render(sessionViewProps)
        )}
        {webAnnotationsPanelRendered ? (
          <WebAnnotationsSessionPanel {...webAnnotationsPanelProps} />
        ) : null}
        <Composer {...composerProps} />
      </main>

      <RawEventsSidebar
        traceView={currentTraceView}
        eventLimit={rawEventLimit}
        isFetching={tracePageFetching}
        visible={showRawEvents}
        onLoadOlder={onLoadMoreRawEvents}
      />
    </>
  );
}
