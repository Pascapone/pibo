import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Brain, Bug, Check, ChevronsDown, ChevronsUp, EyeOff, Hammer, Maximize2, Plus } from "lucide-react";
import { copyTextToClipboard } from "./clipboard";
import type { getChatSessionView } from "./session-views/registry";
import type { ChatSessionViewId, ToolDisplayMode } from "./session-views/types";
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
  terminalUsageStatus,
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
  onToggleDebugMode,
  onToggleThinking,
  onToggleExpandThinking,
}: {
  title: string | null | undefined;
  contextKind: "room";
  contextLabel: string;
  headerPiboSessionId: string;
  terminalUsageStatus?: unknown;
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
  onToggleDebugMode: () => void;
  onToggleThinking: () => void;
  onToggleExpandThinking: () => void;
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
        <ToolDisplayModeMenu
          value={toolDisplayMode}
          intentSupported={toolIntentSupported}
          onChange={onToolDisplayModeChange}
        />
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

const TOOL_DISPLAY_MODE_OPTIONS: ReadonlyArray<{
  value: ToolDisplayMode;
  label: string;
  description: string;
}> = [
  { value: "default", label: "Default", description: "Show full tool details" },
  { value: "hide", label: "Hide", description: "Hide tool calls" },
  { value: "slim", label: "Slim", description: "Show compact tool rows" },
  { value: "intent", label: "Intent", description: "Show tool intent only" },
];

function ToolDisplayModeMenu({
  value,
  intentSupported,
  onChange,
}: {
  value: ToolDisplayMode;
  intentSupported: boolean;
  onChange: (mode: ToolDisplayMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;
    const selectedIndex = TOOL_DISPLAY_MODE_OPTIONS.findIndex((option) => option.value === value);
    const focusFrame = window.requestAnimationFrame(() => {
      const selectedOption = optionRefs.current[selectedIndex];
      if (selectedOption && !selectedOption.disabled) selectedOption.focus();
      else optionRefs.current.find((option) => option && !option.disabled)?.focus();
    });
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, value]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabledOptions = optionRefs.current.filter((option): option is HTMLButtonElement => Boolean(option && !option.disabled));
    if (!enabledOptions.length) return;
    const currentIndex = enabledOptions.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabledOptions.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + enabledOptions.length) % enabledOptions.length
          : (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
    enabledOptions[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
        title="Choose tool view"
        aria-label="Choose tool view"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-pibo-debug="tool-display-mode"
        className={`h-8 w-8 inline-flex items-center justify-center rounded-sm border transition-colors ${open ? "border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]" : "border-slate-700 text-slate-400 hover:border-[#11a4d4] hover:text-[#11a4d4]"}`}
      >
        <Hammer size={14} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Tool view options"
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 top-full z-50 mt-1 w-56 rounded-sm border border-slate-700 bg-[#151f24] p-1 shadow-2xl shadow-black/50"
        >
          {TOOL_DISPLAY_MODE_OPTIONS.map((option, index) => {
            const selected = option.value === value;
            const disabled = option.value === "intent" && !intentSupported;
            return (
              <button
                key={option.value}
                ref={(node) => { optionRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                title={disabled ? "Tool intent is unavailable for this runtime" : undefined}
                onClick={() => {
                  if (!selected) onChange(option.value);
                  closeMenu(true);
                }}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-slate-300 hover:bg-[#11a4d4]/10 hover:text-[#11a4d4] focus:bg-[#11a4d4]/10 focus:text-[#11a4d4] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className="block text-[10px] text-slate-500">{option.description}</span>
                </span>
                <span className="grid h-4 w-4 shrink-0 place-items-center" aria-hidden="true">
                  {selected ? <Check size={13} /> : null}
                </span>
              </button>
            );
          })}
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
