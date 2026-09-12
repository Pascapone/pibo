import {
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type DragEvent,
} from "react";
import { LoaderCircle, Upload } from "lucide-react";
import { BrowserPluginContext, runPluginInputHooks } from "./plugins/browser-host";

type TerminalFileDropTargetProps = Omit<
  ComponentPropsWithoutRef<"main">,
  "onDragEnter" | "onDragLeave" | "onDragOver" | "onDrop"
> & {
  enabled: boolean;
  onFilesDropped: (files: readonly File[]) => Promise<void>;
};

export function TerminalFileDropTarget({
  enabled,
  onFilesDropped,
  children,
  className,
  ...mainProps
}: TerminalFileDropTargetProps) {
  const pluginContext = useContext(BrowserPluginContext);
  const dropAbort = useMemo(() => new AbortController(), [pluginContext?.host]);
  useEffect(() => () => dropAbort.abort(), [dropAbort]);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFileCount, setUploadingFileCount] = useState(0);
  const uploading = uploadingFileCount > 0;

  useEffect(() => {
    if (enabled) return;
    dragDepthRef.current = 0;
    setDragActive(false);
  }, [enabled]);

  const resetDragState = () => {
    dragDepthRef.current = 0;
    setDragActive(false);
  };

  const claimFileDrag = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = enabled && !uploading ? "copy" : "none";
    return true;
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!claimFileDrag(event) || !enabled || uploading) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    claimFileDrag(event);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!claimFileDrag(event) || dragDepthRef.current === 0) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = async (event: DragEvent<HTMLElement>) => {
    if (!claimFileDrag(event)) return;
    resetDragState();
    if (!enabled || uploading) return;
    const files = droppedFiles(event.dataTransfer);
    if (!files.length) return;

    setUploadingFileCount(files.length);
    setDropError(null);
    try {
      if (pluginContext?.host.plan.piboSessionId) {
        const result = await runPluginInputHooks(pluginContext.host.hooks, "drop", files.map((file) => ({ name: file.name, size: file.size, type: file.type })), pluginContext.host.plan.piboSessionId, dropAbort.signal);
        if (result.transformations.length) throw new Error("File drop hooks may accept or reject files; file transformations require a registered upload adapter");
      }
      dropAbort.signal.throwIfAborted();
      await onFilesDropped(files);
    } catch (error) {
      if (!dropAbort.signal.aborted) setDropError(String(error));
    } finally {
      setUploadingFileCount(0);
    }
  };

  const dropState = uploading ? "uploading" : dragActive ? "drag-active" : "idle";

  return (
    <main
      {...mainProps}
      data-pibo-file-drop-state={dropState}
      className={`relative ${className ?? ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDragEnd={resetDragState}
      onDrop={handleDrop}
    >
      {children}
      {dropError ? <p role="alert" className="absolute bottom-0 p-2 text-xs text-orange-300 bg-[#151f24]">{dropError}</p> : null}
      {dragActive || uploading ? (
        <TerminalFileDropOverlay uploadingFileCount={uploadingFileCount} />
      ) : null}
    </main>
  );
}

export function TerminalFileDropOverlay({ uploadingFileCount }: { uploadingFileCount: number }) {
  const uploading = uploadingFileCount > 0;
  return (
    <div
      data-pibo-debug="terminal-file-drop-overlay"
      data-pibo-state={uploading ? "uploading" : "drag-active"}
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-[#071015]/90 p-6 backdrop-blur-[2px]"
    >
      <div className="flex max-w-sm flex-col items-center rounded-sm border border-dashed border-[#11a4d4] bg-[#0e1116]/95 px-8 py-7 text-center shadow-2xl shadow-black/50">
        {uploading ? (
          <LoaderCircle size={36} className="mb-3 animate-spin text-[#11a4d4]" aria-hidden="true" />
        ) : (
          <Upload size={36} className="mb-3 text-[#11a4d4]" aria-hidden="true" />
        )}
        <span className="text-sm font-semibold text-slate-100">
          {uploading
            ? `Uploading ${uploadingFileCount} file${uploadingFileCount === 1 ? "" : "s"}…`
            : "Drop files to upload"}
        </span>
        <span className="mt-1 text-xs leading-5 text-slate-400">
          {uploading
            ? "Saving to the Pibo uploads directory"
            : "Images and other files will be attached to your next message."}
        </span>
      </div>
    </div>
  );
}

export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files")
    || Array.from(dataTransfer.items).some((item) => item.kind === "file");
}

export function droppedFiles(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files);
}
