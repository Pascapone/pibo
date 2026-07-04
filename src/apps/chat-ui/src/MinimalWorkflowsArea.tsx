import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyPlus, Loader2, Plus, Save, Search } from "lucide-react";
import {
  getWorkflowCatalog,
  getWorkflowDraft,
  getWorkflowVersionInspect,
  patchWorkflowDraft,
  postWorkflowCreateDraft,
  postWorkflowDuplicateDraft,
  type WorkflowCatalogRecord,
  type WorkflowCatalogVersionSummary,
  type WorkflowDraftRecord,
} from "./api-workflows";
import { WorkflowGraphCanvas, type WorkflowGraphInspectorSlotProps } from "./workflows/WorkflowGraphCanvas";
import { WorkflowInspectorsPanel } from "./workflows/WorkflowInspectorsPanel";
import { readWorkflowEdgeDefinitions, readWorkflowNodeDefinitions } from "./workflows/workflow-graph-model";

export function MinimalWorkflowsArea({
  draftId,
  onNavigateDraft,
}: {
  draftId?: string;
  onNavigateDraft: (draftId: string) => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowCatalogRecord[]>([]);
  const [draft, setDraft] = useState<WorkflowDraftRecord | undefined>();
  const [readOnlyView, setReadOnlyView] = useState<ReadOnlyWorkflowView | undefined>();
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [draftLoadState, setDraftLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [busy, setBusy] = useState<"new" | "select" | "duplicate" | "save" | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const loadWorkflows = useCallback(async () => {
    setLoadState("loading");
    try {
      const response = await getWorkflowCatalog();
      setWorkflows(response.workflows);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load workflows");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!draftId) {
      setDraft(undefined);
      setDraftLoadState("idle");
      return;
    }
    let cancelled = false;
    setReadOnlyView(undefined);
    setDraftLoadState("loading");
    setErrorMessage(undefined);
    getWorkflowDraft(draftId)
      .then((response) => {
        if (cancelled) return;
        setDraft(response.draft);
        setDraftLoadState("loaded");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDraft(undefined);
        setDraftLoadState("error");
        setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow draft");
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  useEffect(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown);
  }, []);

  const options = useMemo(() => workflows.map(workflowOptionFromCatalogRecord), [workflows]);
  const activeWorkflowId = draft?.workflowId ?? readOnlyView?.workflowId;
  const selectedOption = activeWorkflowId ? options.find((option) => option.workflowId === activeWorkflowId) : undefined;
  const filteredOptions = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length || selectedOption?.label === query) return options;
    return options.filter((option) => terms.every((term) => option.searchText.includes(term)));
  }, [options, query, selectedOption]);

  useEffect(() => {
    if (selectedOption && !pickerOpen) setQuery(selectedOption.label);
  }, [pickerOpen, selectedOption]);

  const openReadOnlyWorkflow = async (option: WorkflowPickerOption) => {
    if (!option.latestPublishedVersion) throw new Error("This workflow has no draft or published version to open.");
    const response = await getWorkflowVersionInspect(option.workflowId, option.latestPublishedVersion);
    const now = new Date().toISOString();
    setDraft(undefined);
    setReadOnlyView({
      workflowId: option.workflowId,
      workflowVersion: option.latestPublishedVersion,
      title: response.workflow.title || option.label,
      source: response.workflow.source,
      draft: {
        draftId: `readonly_${option.workflowId}_${option.latestPublishedVersion}`,
        workflowId: option.workflowId,
        source: "ui",
        status: "draft",
        versionIntent: "patch",
        definition: response.definition,
        diagnostics: response.diagnostics,
        validationState: response.validation.validationState,
        validation: response.validation,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
  };

  const selectWorkflow = async (option: WorkflowPickerOption) => {
    setBusy("select");
    setPickerOpen(false);
    setMessage(undefined);
    setErrorMessage(undefined);
    try {
      if (option.activeDraftId) {
        setReadOnlyView(undefined);
        onNavigateDraft(option.activeDraftId);
        return;
      }
      await openReadOnlyWorkflow(option);
      setMessage(`Opened ${option.label} as read-only.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to select workflow");
    } finally {
      setBusy(undefined);
    }
  };

  const createWorkflow = async () => {
    const title = window.prompt("Workflow name");
    if (!title?.trim()) return;
    setBusy("new");
    setMessage(undefined);
    setErrorMessage(undefined);
    try {
      const response = await postWorkflowCreateDraft({ title: title.trim() });
      setReadOnlyView(undefined);
      setMessage(`Created workflow ${response.draft.workflowId}.`);
      await loadWorkflows();
      onNavigateDraft(response.draft.draftId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create workflow");
    } finally {
      setBusy(undefined);
    }
  };

  const duplicateReadOnlyWorkflow = async () => {
    if (!readOnlyView) return;
    setBusy("duplicate");
    setMessage(undefined);
    setErrorMessage(undefined);
    try {
      const response = await postWorkflowDuplicateDraft(readOnlyView.workflowId, { version: readOnlyView.workflowVersion });
      setReadOnlyView(undefined);
      setMessage(`Duplicated ${readOnlyView.title}.`);
      await loadWorkflows();
      onNavigateDraft(response.draft.draftId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to duplicate workflow");
    } finally {
      setBusy(undefined);
    }
  };

  const saveWorkflow = async () => {
    if (!draft) return;
    setBusy("save");
    setMessage(undefined);
    setErrorMessage(undefined);
    try {
      const response = await patchWorkflowDraft(draft.draftId, { definition: draft.definition, editTrigger: "graph_edit" });
      setDraft(response.draft);
      setMessage(response.message ?? `Saved ${draft.workflowId}.`);
      await loadWorkflows();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save workflow");
    } finally {
      setBusy(undefined);
    }
  };

  const updateDraftDefinition = useCallback((definition: WorkflowDraftRecord["definition"]) => {
    setDraft((current) => current ? { ...current, definition } : current);
  }, []);
  const handlePersistedDraftChange = useCallback((nextDraft: WorkflowDraftRecord) => {
    setDraft(nextDraft);
    void loadWorkflows();
  }, [loadWorkflows]);

  const isLoading = loadState === "loading" || draftLoadState === "loading";
  const activeTitle = selectedOption?.label ?? readOnlyView?.title ?? (draft ? draft.workflowId : "No workflow selected");
  const graphDraft = draft ?? readOnlyView?.draft;

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#101d22] text-slate-200" aria-label="Workflows">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 bg-[#151f24] px-3 py-2">
        <button
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#11a4d4]/60 text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void createWorkflow()}
          disabled={Boolean(busy)}
          title="Create workflow"
          aria-label="Create workflow"
        >
          {busy === "new" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        </button>

        <div className="relative min-w-0 flex-1 basis-64" ref={pickerRef}>
          <div className="flex h-9 min-w-0 items-center gap-2 rounded-sm border border-slate-700 bg-[#101d22] px-2 focus-within:border-[#11a4d4]">
            <Search size={14} className="shrink-0 text-slate-500" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              value={query}
              onFocus={() => setPickerOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setPickerOpen(true);
              }}
              placeholder="Search workflows by name, id, tag, status…"
              aria-label="Search workflows"
            />
          </div>
          {pickerOpen ? (
            <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-sm border border-slate-700 bg-[#151f24] p-1 shadow-2xl" role="listbox" aria-label="Workflow results">
              {loadState === "loading" ? <WorkflowPickerMessage>Loading workflows…</WorkflowPickerMessage> : null}
              {loadState === "loaded" && filteredOptions.length === 0 ? <WorkflowPickerMessage>No workflows match this search.</WorkflowPickerMessage> : null}
              {filteredOptions.map((option) => (
                <button
                  key={option.workflowId}
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 rounded-sm px-3 py-2 text-left text-xs transition hover:bg-slate-800/80 ${activeWorkflowId === option.workflowId ? "bg-[#11a4d4]/10 text-[#8bdcf4]" : "text-slate-300"}`}
                  onClick={() => void selectWorkflow(option)}
                  disabled={Boolean(busy)}
                  role="option"
                  aria-selected={activeWorkflowId === option.workflowId}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{option.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">{option.description}</span>
                  </span>
                  <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${option.activeDraftId ? "border-emerald-700/60 text-emerald-300" : "border-amber-700/60 text-amber-300"}`}>
                    {option.activeDraftId ? "draft" : "read only"}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm border border-emerald-700/70 px-3 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:border-emerald-400 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void saveWorkflow()}
          disabled={!draft || Boolean(busy)}
        >
          {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>

      {readOnlyView ? (
        <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 border-b border-amber-700/50 bg-amber-950/20 px-3 py-1.5 text-xs text-amber-100">
          <div className="min-w-0 truncate">
            <span className="mr-2 rounded-sm border border-amber-500/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">Read only</span>
            {readOnlyView.title} · {readOnlyView.workflowId}@{readOnlyView.workflowVersion}
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-amber-500/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100 hover:border-amber-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void duplicateReadOnlyWorkflow()}
            disabled={Boolean(busy)}
          >
            {busy === "duplicate" ? <Loader2 size={12} className="animate-spin" /> : <CopyPlus size={12} />}
            Duplicate
          </button>
        </div>
      ) : null}

      {message || errorMessage || isLoading ? (
        <div className={`shrink-0 border-b px-3 py-1.5 text-xs ${errorMessage ? "border-red-900/70 bg-red-950/40 text-red-200" : "border-slate-800 bg-[#101d22] text-slate-400"}`} role={errorMessage ? "alert" : "status"}>
          {errorMessage ?? (isLoading ? "Loading workflow surface…" : message)}
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden p-3">
        {graphDraft ? (
          <WorkflowGraphCanvas
            draft={graphDraft}
            onDraftChange={readOnlyView ? () => undefined : handlePersistedDraftChange}
            fullHeight
            compactHeader
            readOnly={Boolean(readOnlyView)}
            onDraftDefinitionChange={readOnlyView ? undefined : updateDraftDefinition}
            renderInspectors={(props) => readOnlyView ? <ReadOnlyWorkflowDetails {...props} /> : <WorkflowInspectorsPanel {...props} />}
          />
        ) : (
          <div className="grid h-full min-w-0 place-items-center rounded-sm border border-dashed border-slate-700 bg-[#151f24]/50 p-6 text-center">
            <div>
              <div className="text-lg font-bold text-slate-100">{activeTitle}</div>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Create a workflow with the plus button or search and select an existing workflow above. Published and built-in workflows open read-only and can be duplicated before editing.
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

type ReadOnlyWorkflowView = {
  workflowId: string;
  workflowVersion: string;
  title: string;
  source: WorkflowCatalogRecord["source"];
  draft: WorkflowDraftRecord;
};

type WorkflowPickerOption = {
  workflowId: string;
  label: string;
  description: string;
  activeDraftId?: string;
  latestPublishedVersion?: string;
  searchText: string;
};

function workflowOptionFromCatalogRecord(record: WorkflowCatalogRecord): WorkflowPickerOption {
  const latestPublished = latestPublishedVersion(record.versions);
  const tags = record.tags.join(", ");
  const descriptionParts = [record.id, record.status, record.source, tags].filter(Boolean);
  const keywords = [record.id, record.title, record.description, record.status, record.source, tags, latestPublished?.version].filter((value): value is string => Boolean(value));
  return {
    workflowId: record.id,
    label: record.title || record.id,
    description: descriptionParts.join(" · "),
    ...(record.activeDraftId ? { activeDraftId: record.activeDraftId } : {}),
    ...(latestPublished ? { latestPublishedVersion: latestPublished.version } : {}),
    searchText: keywords.join(" ").toLowerCase(),
  };
}

function latestPublishedVersion(versions: WorkflowCatalogVersionSummary[]): WorkflowCatalogVersionSummary | undefined {
  return [...versions].reverse().find((version) => version.status === "published");
}

function ReadOnlyWorkflowDetails({ draft, selectedElement }: WorkflowGraphInspectorSlotProps) {
  const nodes = readWorkflowNodeDefinitions(draft.definition);
  const edges = readWorkflowEdgeDefinitions(draft.definition);
  const value = selectedElement?.type === "node"
    ? nodes[selectedElement.id]
    : selectedElement?.type === "edge"
      ? edges[selectedElement.id]
      : draft.definition;
  const title = selectedElement ? `${selectedElement.type} ${selectedElement.id}` : "Workflow definition";
  return (
    <div className="min-w-0 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Read-only workflow details">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Read-only details</div>
      <div className="mt-2 truncate text-xs font-semibold text-slate-200">{title}</div>
      <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-slate-800 bg-[#0c171c] p-2 text-[11px] leading-5 text-slate-300">{JSON.stringify(value ?? {}, null, 2)}</pre>
    </div>
  );
}

function WorkflowPickerMessage({ children }: { children: string }) {
  return <div className="px-3 py-2 text-xs text-slate-500">{children}</div>;
}
