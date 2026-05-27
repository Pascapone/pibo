import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { patchWorkflowDraft, type WorkflowDraftRecord } from "../api-workflows";
import { WorkflowInspectorDiagnostics, WorkflowPill } from "./workflow-shared-ui";

const RAW_IR_PARSE_DIAGNOSTIC_CODE = "WorkflowBuilderWarning.invalidRawIrText";

type WorkflowRawIrEditorSaveState = "idle" | "saving" | "saved" | "warning" | "error";

export function WorkflowRawIrEditor({ draft, onDraftChange }: { draft: WorkflowDraftRecord; onDraftChange: (draft: WorkflowDraftRecord) => void }) {
	const formattedDraftDefinition = useMemo(() => JSON.stringify(draft.definition, null, 2), [draft.definition]);
	const [rawText, setRawText] = useState(formattedDraftDefinition);
	const [isDirty, setIsDirty] = useState(false);
	const [saveState, setSaveState] = useState<WorkflowRawIrEditorSaveState>("idle");
	const [statusMessage, setStatusMessage] = useState<string | undefined>();
	const rawParseDiagnostics = draft.diagnostics.filter((diagnostic) => diagnostic.code === RAW_IR_PARSE_DIAGNOSTIC_CODE);

	useEffect(() => {
		if (!isDirty) {
			setRawText(formattedDraftDefinition);
		}
	}, [formattedDraftDefinition, isDirty]);

	const saveRawIr = async () => {
		setSaveState("saving");
		setStatusMessage(undefined);
		try {
			const response = await patchWorkflowDraft(draft.draftId, { rawDefinitionText: rawText, editTrigger: "raw_ir_edit" });
			onDraftChange(response.draft);
			const hasRawParseWarning = response.diagnostics.some((diagnostic) => diagnostic.code === RAW_IR_PARSE_DIAGNOSTIC_CODE);
			if (hasRawParseWarning) {
				setIsDirty(true);
				setSaveState("warning");
				setStatusMessage("Raw Workflow IR text was not saved; the last valid draft object remains unchanged.");
				return;
			}
			setRawText(JSON.stringify(response.draft.definition, null, 2));
			setIsDirty(false);
			setSaveState("saved");
			setStatusMessage(`Saved raw Workflow IR to the draft. Validation state: ${response.validation.validationState}.`);
		} catch (error) {
			setSaveState("error");
			setStatusMessage(error instanceof Error ? error.message : "Failed to save raw Workflow IR text");
		}
	};

	const resetRawIr = () => {
		setRawText(formattedDraftDefinition);
		setIsDirty(false);
		setSaveState("idle");
		setStatusMessage("Reset the editor from the last valid Pibo Workflow IR object.");
	};

	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-4" aria-label="Raw Pibo Workflow IR editor panel">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Raw Pibo Workflow IR editor</div>
					<h4 className="mt-1 text-sm font-bold text-slate-100">Safe raw Workflow IR sync</h4>
					<p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">
						Edit only Pibo Workflow IR JSON. Saving valid JSON parses into the same draft object used by the graph and inspectors. Invalid JSON or non-object text returns a warning diagnostic and keeps the last valid draft object unchanged; raw XState JSON is not exposed here.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-[11px]">
					<WorkflowPill label={`last valid rev ${draft.revision}`} />
					{isDirty ? <WorkflowPill label="unsaved raw text" /> : null}
				</div>
			</div>

			<div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
				<div className="flex flex-col gap-2">
					<label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500" htmlFor="workflow-raw-ir-editor">
						Editable Pibo Workflow IR JSON
					</label>
					<textarea
						id="workflow-raw-ir-editor"
						aria-label="Raw Pibo Workflow IR editor"
						className="min-h-[26rem] rounded-sm border border-slate-800 bg-[#101d22] p-3 font-mono text-[11px] leading-5 text-slate-100 outline-none transition focus:border-[#11a4d4]"
						spellCheck={false}
						value={rawText}
						onChange={(event) => {
							setRawText(event.target.value);
							setIsDirty(true);
							setSaveState("idle");
							setStatusMessage(undefined);
						}}
					/>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-emerald-600/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => void saveRawIr()}
							disabled={saveState === "saving"}
						>
							{saveState === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
							Save raw IR
						</button>
						<button
							type="button"
							className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
							onClick={resetRawIr}
							disabled={saveState === "saving"}
						>
							<RefreshCw size={13} />
							Reset from current draft
						</button>
					</div>
					{statusMessage ? (
						<div className={`rounded-sm border p-3 text-xs leading-5 ${saveState === "error" ? "border-red-900/70 bg-red-950/40 text-red-200" : saveState === "warning" ? "border-amber-700/70 bg-amber-950/30 text-amber-100" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-200"}`} role={saveState === "error" || saveState === "warning" ? "alert" : "status"}>
							{statusMessage}
						</div>
					) : null}
					{rawParseDiagnostics.length ? <WorkflowInspectorDiagnostics diagnostics={rawParseDiagnostics} emptyLabel="No raw IR parse diagnostics." /> : null}
				</div>

				<div>
					<div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Last valid Pibo Workflow IR object</div>
					<pre aria-label="Pibo Workflow IR draft" className="max-h-[32rem] overflow-auto rounded-sm border border-slate-800 bg-[#101d22] p-3 text-[11px] leading-5 text-slate-200">
						{formattedDraftDefinition}
					</pre>
				</div>
			</div>
		</div>
	);
}
