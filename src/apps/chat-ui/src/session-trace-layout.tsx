import type { ComponentProps, ReactNode } from "react";

import { Composer } from "./composer/Composer";
import { SessionTraceHeader } from "./session-trace-header";
import type { getChatSessionView } from "./session-views/registry";
import type { ChatSessionViewProps } from "./session-views/types";
import type { PiboSessionTraceView } from "./types";
import { WebAnnotationsSessionPanel } from "./web-annotations";
import { RawEventsSidebar } from "./tracing/RawEventsSidebar";

type SessionTraceLayoutProps = {
  selectedPiboSessionId: string | null;
  selectedRoomId: string | null;
  fallbackRoomId?: string;
  sessionViewId: string;
  loadingTrace: boolean;
  roomNavigationPending?: boolean;
  sessionNavigationPending?: boolean;
  traceError: string | null;
  showRawEvents: boolean;
  currentTraceView: PiboSessionTraceView | null;
  rawEventLimit: number;
  tracePageFetching: boolean;
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
  roomNavigationPending = false,
  sessionNavigationPending = false,
  traceError,
  showRawEvents,
  currentTraceView,
  rawEventLimit,
  tracePageFetching,
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
  const terminalLoading = roomNavigationPending || sessionNavigationPending || loadingTrace;
  return (
    <>
      <main
        data-pibo-debug="chat-shell"
        data-pibo-session-id={selectedPiboSessionId ?? undefined}
        data-pibo-room-id={selectedRoomId ?? fallbackRoomId ?? undefined}
        data-pibo-view-id={sessionViewId}
        data-pibo-state={
          roomNavigationPending
            ? "room-loading"
            : sessionNavigationPending
            ? "session-loading"
            : loadingTrace
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
        {projectModulePanel ? (
          projectModulePanel
        ) : terminalLoading ? (
          <TerminalLoadingSkeleton label={roomNavigationPending ? "Loading room" : "Loading session"} />
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

function TerminalLoadingSkeleton({ label }: { label: string }) {
	const rows = [
		{ kind: "tool", lines: 5 },
		{ kind: "markdown", lines: 4 },
		{ kind: "command", lines: 4 },
		{ kind: "tool", lines: 3 },
		{ kind: "markdown", lines: 5 },
	] as const;
	return (
		<section
			data-pibo-debug="room-navigation-loading"
			className="relative min-w-0 flex-1 overflow-hidden bg-[#0b0b0b] text-[#d4d4d4]"
			aria-live="polite"
			aria-label={label}
		>
			<div className="min-h-0 h-full overflow-hidden font-mono text-[12px] leading-[1.45]">
				<div className="px-4">
					<div className="group border-b border-[#141414] py-2">
						<div className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 leading-[1.45]">
							<span className="flex items-center text-[#38bdf8]">
								<span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
							</span>
							<span className="flex min-w-0 items-center gap-2">
								<span className="font-semibold text-[#d4d4d4]">{label}</span>
								<span className="h-2 w-24 rounded-sm bg-[#262626] animate-pulse" />
							</span>
						</div>
					</div>
					{rows.map((row, index) => (
						<TerminalSkeletonRow key={index} kind={row.kind} lineCount={row.lines} />
					))}
				</div>
			</div>
		</section>
	);
}

function TerminalSkeletonRow({ kind, lineCount }: { kind: "tool" | "markdown" | "command"; lineCount: number }) {
	const isCommand = kind === "command";
	const isMarkdown = kind === "markdown";
	return (
		<div className={`group border-b border-[#141414] py-2 animate-pulse ${isCommand ? "bg-[#f59e0b]/5" : ""}`} aria-hidden="true">
			{Array.from({ length: lineCount }).map((_, index) => {
				const bullet = index === 0 && !isMarkdown;
				const detail = index > 0 && !isMarkdown;
				return (
					<div key={index} className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 leading-[1.45]">
						<span className="flex items-center text-[#737373]">
							{bullet ? <span className={`h-1.5 w-1.5 rounded-full ${isCommand ? "bg-[#f59e0b]" : "bg-[#22c55e]"}`} /> : detail ? <span className="text-[10px]">L</span> : null}
						</span>
						<span className="min-w-0 py-[3px]">
							{index === 0 ? (
								<span className="inline-flex min-w-0 items-center gap-2">
									<span className={`h-[13px] rounded-sm ${isMarkdown ? "w-56 bg-[#d4d4d4]/45" : isCommand ? "w-28 bg-[#f59e0b]/65" : "w-24 bg-[#22c55e]/65"}`} />
									{isMarkdown ? null : <span className="h-[13px] w-64 rounded-sm bg-[#262626]" />}
								</span>
							) : (
								<span className={`block h-[10px] rounded-sm bg-[#262626] ${index === lineCount - 1 ? "w-[42%]" : index % 2 === 0 ? "w-[72%]" : "w-[58%]"}`} />
							)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
