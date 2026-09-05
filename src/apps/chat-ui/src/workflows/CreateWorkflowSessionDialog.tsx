import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { DialogShell } from "../components/DialogShell";
import { errorMessage } from "../error-message";
import { getWorkflowVersionInspect, getWorkflowVersionPicker, postWorkflowSession, type CreateWorkflowSessionInput, type WorkflowVersionPickerOption } from "../api-workflows";
import { THINKING_LEVELS, type BootstrapData, type ModelProfile } from "../types";

export type WorkflowSessionSelection = { workflowId: string; workflowVersion: string };

export function CreateWorkflowSessionDialog({ open, bootstrap, initialSelection, onClose, onCreated }: {
  open: boolean;
  bootstrap: BootstrapData;
  initialSelection?: WorkflowSessionSelection;
  onClose: () => void;
  onCreated: (result: Awaited<ReturnType<typeof postWorkflowSession>>, roomId?: string) => void | Promise<void>;
}) {
  const [options, setOptions] = useState<WorkflowVersionPickerOption[]>([]);
  const [selection, setSelection] = useState("");
  const [definition, setDefinition] = useState<Record<string, unknown>>();
  const [roomId, setRoomId] = useState(bootstrap.selectedRoomId);
  const [workspace, setWorkspace] = useState(bootstrap.room?.workspace ?? "");
  const [profile, setProfile] = useState(bootstrap.session?.profile ?? bootstrap.agents[0]?.name ?? "");
  const [title, setTitle] = useState("");
  const [inputText, setInputText] = useState("{}");
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [modelKey, setModelKey] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [fastMode, setFastMode] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string>();
  const firstRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setApiError(undefined);
    setRoomId(bootstrap.selectedRoomId);
    setWorkspace(bootstrap.room?.workspace ?? "");
    setProfile(bootstrap.session?.profile ?? bootstrap.agents[0]?.name ?? "");
    setTitle(""); setInputText("{}"); setPromptOverrides({}); setModelKey(""); setThinkingLevel(""); setFastMode("");
    getWorkflowVersionPicker(initialSelection ? { selectedWorkflowId: initialSelection.workflowId, selectedWorkflowVersion: initialSelection.workflowVersion } : {})
      .then((response) => {
        if (cancelled) return;
        setOptions(response.options);
        const selected = response.options.find((option) => option.id === initialSelection?.workflowId && option.version === initialSelection.workflowVersion) ?? response.options[0];
        setSelection(selected ? optionKey(selected) : "");
      })
      .catch((caught) => { if (!cancelled) setApiError(errorMessage(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, initialSelection?.workflowId, initialSelection?.workflowVersion, bootstrap.selectedRoomId]);

  const selected = options.find((option) => optionKey(option) === selection);
  useEffect(() => {
    if (!open || !selected) { setDefinition(undefined); return; }
    let cancelled = false;
    setLoading(true);
    getWorkflowVersionInspect(selected.id, selected.version)
      .then((response) => { if (!cancelled) setDefinition(response.definition); })
      .catch((caught) => { if (!cancelled) setApiError(errorMessage(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, selected?.id, selected?.version]);

  const eligibleNodeIds = useMemo(() => workflowPromptOverrideEligibleNodeIds(definition), [definition]);
  const models = bootstrap.modelCatalog?.providers.flatMap((provider) => provider.models) ?? [];
  const activeRoom = bootstrap.rooms.find((room) => room.id === roomId) ?? (bootstrap.room?.id === roomId ? bootstrap.room : undefined);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || submitting) return;
    setApiError(undefined);
    let inputValues: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(inputText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Workflow inputs must be a JSON object.");
      inputValues = parsed as Record<string, unknown>;
    } catch (caught) { setApiError(caught instanceof Error ? caught.message : "Workflow inputs must be valid JSON."); return; }
    const model = modelFromKey(modelKey);
    const input: CreateWorkflowSessionInput = {
      roomId: roomId || undefined, workspace: workspace.trim() || undefined, profile: profile || undefined,
      workflowId: selected.id, workflowVersion: selected.version, title: title.trim() || undefined,
      inputValues,
      promptOverrides: Object.fromEntries(Object.entries(promptOverrides).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()])),
      ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel: thinkingLevel as CreateWorkflowSessionInput["thinkingLevel"] } : {}),
      ...(fastMode ? { fastMode: fastMode === "true" } : {}),
    };
    setSubmitting(true);
    try { const result = await postWorkflowSession(input); await onCreated(result, roomId || undefined); onClose(); }
    catch (caught) { setApiError(errorMessage(caught)); }
    finally { setSubmitting(false); }
  };

  if (!open) return null;
  return <DialogShell title="New Workflow Session" description="Configure a published workflow as a normal Session. Creation does not execute it." onClose={onClose} initialFocusRef={firstRef} closeDisabled={submitting}>
    <form className="grid max-h-[80dvh] gap-4 overflow-auto p-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Workflow version"><select ref={firstRef} aria-label="Workflow version" value={selection} onChange={(e) => setSelection(e.target.value)} disabled={loading || submitting} className={controlClass}><option value="">Select a published workflow</option>{options.map((option) => <option key={optionKey(option)} value={optionKey(option)}>{option.title} ({option.id}@{option.version})</option>)}</select></Field>
        <Field label="Room"><select aria-label="Workflow Session Room" value={roomId} onChange={(e) => { const id = e.target.value; setRoomId(id); setWorkspace(bootstrap.rooms.find((room) => room.id === id)?.workspace ?? ""); }} disabled={submitting} className={controlClass}>{bootstrap.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></Field>
        <Field label="Workspace"><input aria-label="Workflow Session workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder={activeRoom?.workspace ?? "Room default"} disabled={submitting} className={controlClass} /></Field>
        <Field label="Agent profile"><select aria-label="Workflow Session profile" value={profile} onChange={(e) => setProfile(e.target.value)} disabled={submitting} className={controlClass}>{bootstrap.agents.map((agent) => <option key={agent.name} value={agent.name}>{agent.name}</option>)}</select></Field>
        <Field label="Session title"><input aria-label="Workflow Session title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={selected?.title ?? "Optional"} disabled={submitting} className={controlClass} /></Field>
      </div>
      <Field label="Workflow inputs (JSON object)"><textarea aria-label="Workflow input values" value={inputText} onChange={(e) => setInputText(e.target.value)} rows={4} spellCheck={false} disabled={submitting} className={`${controlClass} min-h-24 py-2 font-mono text-xs`} /><div className="mt-1 text-[11px] text-slate-500">Input schema: <code>{JSON.stringify(selected?.paramsSchema ?? {})}</code></div></Field>
      {eligibleNodeIds.length ? <fieldset className="grid gap-3 rounded-sm border border-slate-800 p-3"><legend className="px-1 text-xs font-semibold text-slate-300">Eligible prompt overrides</legend>{eligibleNodeIds.map((nodeId) => <Field key={nodeId} label={nodeId}><textarea aria-label={`Prompt override for ${nodeId}`} value={promptOverrides[nodeId] ?? ""} onChange={(e) => setPromptOverrides((current) => ({ ...current, [nodeId]: e.target.value }))} rows={3} disabled={submitting} className={`${controlClass} py-2`} /></Field>)}</fieldset> : <div className="text-xs text-slate-500">This workflow exposes no prompt-overridable agent nodes.</div>}
      <fieldset className="grid gap-3 rounded-sm border border-slate-800 p-3 sm:grid-cols-3"><legend className="px-1 text-xs font-semibold text-slate-300">Workflow-wide runtime overrides</legend>
        <Field label="Model"><select aria-label="Workflow model override" value={modelKey} onChange={(e) => setModelKey(e.target.value)} className={controlClass}><option value="">Workflow default</option>{models.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.label}</option>)}</select></Field>
        <Field label="Thinking"><select aria-label="Workflow thinking override" value={thinkingLevel} onChange={(e) => setThinkingLevel(e.target.value)} className={controlClass}><option value="">Workflow default</option>{THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></Field>
        <Field label="Fast mode"><select aria-label="Workflow fast mode override" value={fastMode} onChange={(e) => setFastMode(e.target.value)} className={controlClass}><option value="">Workflow default</option><option value="true">On</option><option value="false">Off</option></select></Field>
      </fieldset>
      <div className="rounded-sm border border-amber-800/60 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-100/80">Only workflow inputs, explicitly eligible prompts, and workflow-wide model, thinking, and fast-mode settings can be overridden. Registered profiles, handlers, adapters, guards, assets, and executable boundaries remain unchanged.</div>
      {apiError ? <div role="alert" className="rounded-sm border border-red-900 bg-red-950/30 p-3 text-xs text-red-200">{apiError}</div> : null}
      <div className="flex justify-end gap-2 border-t border-slate-800 pt-3"><button type="button" onClick={onClose} disabled={submitting} className="h-8 rounded-sm border border-slate-700 px-3 text-xs">Cancel</button><button type="submit" disabled={!selected || loading || submitting} className="inline-flex h-8 items-center gap-2 rounded-sm bg-[#11a4d4] px-3 text-xs font-semibold text-white disabled:opacity-50">{submitting ? <Loader2 size={13} className="animate-spin" /> : null}Create Workflow Session</button></div>
    </form>
  </DialogShell>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-xs font-semibold text-slate-300"><span>{label}</span><div className="mt-1.5">{children}</div></label>; }
const controlClass = "w-full rounded-sm border border-slate-700 bg-[#0e1116] px-3 py-2 text-sm text-slate-100 outline-none focus:border-[#11a4d4] disabled:opacity-50";
function optionKey(option: WorkflowVersionPickerOption) { return `${option.id}@${option.version}`; }
function modelFromKey(value: string): ModelProfile | undefined { const index = value.indexOf("/"); return index > 0 ? { provider: value.slice(0, index), id: value.slice(index + 1) } : undefined; }
function workflowPromptOverrideEligibleNodeIds(definition: Record<string, unknown> | undefined): string[] {
  const nodes = definition?.nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return [];
  return Object.entries(nodes).filter(([, raw]) => { if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false; const node = raw as Record<string, unknown>; const metadata = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata) ? node.metadata as Record<string, unknown> : undefined; const overrides = metadata?.sessionOverrides && typeof metadata.sessionOverrides === "object" && !Array.isArray(metadata.sessionOverrides) ? metadata.sessionOverrides as Record<string, unknown> : undefined; return node.kind === "agent" && node.runtime === "pibo" && typeof node.promptTemplate === "string" && overrides?.prompt === true; }).map(([id]) => id).sort();
}
