import { useEffect, useRef, useState, type ReactNode } from "react";
import { Brain, Bug, ChevronsDown, ChevronsUp, EyeOff, Maximize2, Plus } from "lucide-react";
import { copyTextToClipboard } from "./clipboard";
import type { getChatSessionView } from "./session-views/registry";
import type { ChatSessionViewId, ToolDisplayMode } from "./session-views/types";
import { WebAnnotationsEntryPoints } from "./web-annotations";
import { TerminalHeaderUsage } from "./session-header-usage";
import {
  WorkflowHeaderMeta,
  type WorkflowHeaderSummary,
} from "./workflows/workflow-session-model";

export function SessionTraceHeader({
  title,
  contextKind,
  contextLabel,
  headerPiboSessionId,
  piboSessionId,
  piboRoomId,
  terminalUsageStatus,
  webAnnotationsDisabled,
  webAnnotationsPanelRendered,
  workflowHeader,
  sessionViewId,
  currentSessionView,
  activeViewId,
  desktopTerminalOnly = false,
  terminalFullscreenAvailable,
  onEnterTerminalFullscreen,
  onOpenSessionWindow,
  debugMode,
  showThinking,
  expandThinking,
  toolDisplayMode,
  toolIntentSupported,
  onToolDisplayModeChange,
  onShowWebAnnotationsPanel,
  onHideWebAnnotationsPanel,
  onToggleDebugMode,
  onToggleThinking,
  onToggleExpandThinking,
  onError,
}: {
  title: string | null | undefined;
  contextKind: "room";
  contextLabel: string;
  headerPiboSessionId: string;
  piboSessionId: string | null;
  piboRoomId?: string;
  terminalUsageStatus?: unknown;
  webAnnotationsDisabled: boolean;
  webAnnotationsPanelRendered: boolean;
  workflowHeader: WorkflowHeaderSummary | null;
  sessionViewId: ChatSessionViewId;
  currentSessionView: ReturnType<typeof getChatSessionView>;
  activeViewId?: string;
  desktopTerminalOnly?: boolean;
  terminalFullscreenAvailable?: boolean;
  onEnterTerminalFullscreen?: () => void;
  onOpenSessionWindow?: () => void;
  debugMode: boolean;
  showThinking: boolean;
  expandThinking: boolean;
  toolDisplayMode: ToolDisplayMode;
  toolIntentSupported: boolean;
  onToolDisplayModeChange: (mode: ToolDisplayMode) => void;
  onShowWebAnnotationsPanel: () => void;
  onHideWebAnnotationsPanel: () => void;
  onToggleDebugMode: () => void;
  onToggleThinking: () => void;
  onToggleExpandThinking: () => void;
  onError: (message: string | null) => void;
}) {
  const [copiedHeaderPiboSessionId, setCopiedHeaderPiboSessionId] = useState<
    string | null
  >(null);
  const copyHeaderPiboSessionTimeout = useRef<number | undefined>(undefined);
  const headerPiboSessionCopied =
    copiedHeaderPiboSessionId === headerPiboSessionId;
  const selectedViewId = activeViewId ?? sessionViewId;
  const showTerminalUsage = currentSessionView.id === "terminal" && selectedViewId === "terminal";
  const contextKindLabel = "Room";

  useEffect(() => {
    return () => {
      if (copyHeaderPiboSessionTimeout.current)
        window.clearTimeout(copyHeaderPiboSessionTimeout.current);
    };
  }, []);

  const copyHeaderPiboSessionId = () => {
    if (!headerPiboSessionId) return;
    void copyTextToClipboard(headerPiboSessionId).catch(() => undefined);
    setCopiedHeaderPiboSessionId(headerPiboSessionId);
    if (copyHeaderPiboSessionTimeout.current)
      window.clearTimeout(copyHeaderPiboSessionTimeout.current);
    copyHeaderPiboSessionTimeout.current = window.setTimeout(
      () => setCopiedHeaderPiboSessionId(null),
      900,
    );
  };

  return (
    <div className="h-14 px-4 bg-[#151f24] border-b border-slate-800 flex items-center justify-between max-[980px]:h-auto max-[980px]:flex-wrap max-[980px]:py-2 max-[980px]:gap-2 @max-[680px]:h-auto @max-[680px]:flex-wrap @max-[680px]:gap-2 @max-[680px]:py-2">
      <div className="min-w-0 flex-1 max-[980px]:order-1 @max-[680px]:order-1">
        <h1 className="text-base font-semibold truncate">{title}</h1>
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500">
          <span
            data-pibo-debug="session-context"
            data-pibo-context-kind={contextKind}
            title={`${contextKindLabel}: ${contextLabel}`}
            aria-label={`${contextKindLabel}: ${contextLabel}`}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5"
          >
            <span className="shrink-0 uppercase tracking-wide text-[#11a4d4]">{contextKindLabel}</span>
            <span className="truncate text-slate-400">{contextLabel}</span>
          </span>
          {headerPiboSessionId ? (
            <>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void copyHeaderPiboSessionId()}
                title={
                  headerPiboSessionCopied
                    ? "Copied Pibo session ID"
                    : "Copy Pibo session ID"
                }
                aria-label={
                  headerPiboSessionCopied
                    ? "Copied Pibo session ID"
                    : "Copy Pibo session ID"
                }
                className={`min-w-0 max-w-48 truncate rounded-sm px-1 font-mono underline-offset-2 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-[#11a4d4] ${headerPiboSessionCopied ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/50" : "text-slate-400 hover:text-[#11a4d4] hover:underline"}`}
              >
                {headerPiboSessionId}
              </button>
            </>
          ) : null}
          {workflowHeader ? (
            <WorkflowHeaderMeta summary={workflowHeader} />
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-[980px]:order-3 max-[980px]:w-full max-[980px]:flex-wrap max-[980px]:gap-1 @max-[680px]:order-3 @max-[680px]:w-full @max-[680px]:flex-wrap @max-[680px]:gap-1">
        {desktopTerminalOnly ? null : (
          <WebAnnotationsEntryPoints
            piboSessionId={piboSessionId}
            piboRoomId={piboRoomId}
            disabled={webAnnotationsDisabled}
            panelVisible={webAnnotationsPanelRendered}
            onShowPanel={onShowWebAnnotationsPanel}
            onHidePanel={onHideWebAnnotationsPanel}
            onError={onError}
          />
        )}
        {onOpenSessionWindow ? (
          <button
            type="button"
            onClick={onOpenSessionWindow}
            title="Open selected session in new window"
            aria-label="Open selected session in new window"
            data-pibo-debug="open-session-window"
            className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 transition-colors hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <Plus size={15} />
          </button>
        ) : null}
        <select
          value={toolDisplayMode}
          onChange={(event) => onToolDisplayModeChange(event.target.value as ToolDisplayMode)}
          title="Tool display mode"
          aria-label="Tool display mode"
          data-pibo-debug="tool-display-mode"
          className="h-8 rounded-sm border border-slate-700 bg-[#0e1116] px-2 text-[11px] font-bold uppercase tracking-wide text-slate-300 outline-none focus:border-[#11a4d4]"
        >
          <option value="default">Tools: Default</option>
          <option value="hide">Tools: Hide</option>
          <option value="slim">Tools: Slim</option>
          <option value="intent" disabled={!toolIntentSupported}>Tools: Intent</option>
        </select>
        {terminalFullscreenAvailable && onEnterTerminalFullscreen ? (
          <button
            type="button"
            onClick={onEnterTerminalFullscreen}
            title="Enter Terminal fullscreen"
            aria-label="Enter Terminal fullscreen"
            data-pibo-debug="enter-terminal-fullscreen"
            className="h-8 w-8 inline-flex items-center justify-center border border-slate-700 rounded-sm text-slate-400 transition-colors hover:border-[#11a4d4] hover:text-[#11a4d4]"
          >
            <Maximize2 size={14} />
          </button>
        ) : null}
        <HeaderIconButton
          onClick={onToggleDebugMode}
          title={debugMode ? "Disable Debug" : "Enable Debug"}
          ariaLabel="Debug"
          active={debugMode}
        >
          <Bug size={14} />
        </HeaderIconButton>
        <HeaderIconButton
          onClick={onToggleThinking}
          title={showThinking ? "Hide Thinking" : "Show Thinking"}
          ariaLabel="Thinking"
          active={showThinking}
        >
          {showThinking ? <Brain size={14} /> : <EyeOff size={14} />}
        </HeaderIconButton>
        {showThinking ? (
          <HeaderIconButton
            onClick={onToggleExpandThinking}
            title={expandThinking ? "Collapse Thinking" : "Expand Thinking"}
            ariaLabel="Thinking expansion"
            active={expandThinking}
          >
            {expandThinking ? (
              <ChevronsDown size={14} />
            ) : (
              <ChevronsUp size={14} />
            )}
          </HeaderIconButton>
        ) : null}
      </div>
      {showTerminalUsage ? (
        <div className="shrink-0 max-[980px]:order-2 @max-[680px]:order-2">
          <TerminalHeaderUsage status={terminalUsageStatus} />
        </div>
      ) : null}
    </div>
  );
}

function HeaderIconButton({
  title,
  ariaLabel,
  ariaControls,
  active,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  ariaControls?: string;
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
      aria-controls={ariaControls}
      aria-pressed={active}
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
