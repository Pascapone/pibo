import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2, Plus, Save } from "lucide-react";
import {
	getWorkflowAdapterPicker,
	getWorkflowGuardPicker,
	getWorkflowHandlerPicker,
	getWorkflowHumanActionPicker,
	getWorkflowProfilePicker,
	getWorkflowVersionPicker,
	type WorkflowDraftDefinition,
	type WorkflowDraftDiagnostic,
	type WorkflowDraftRecord,
	type WorkflowRegisteredRefOption,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowValidationTrigger,
	type WorkflowHandlerPickerResponse,
	type WorkflowProfilePickerResponse,
	type WorkflowVersionPickerResponse,
} from "../api-workflows";
import {
	readWorkflowEdgeDefinitions,
	readWorkflowNodeDefinitions,
	workflowNodeKind,
	type WorkflowJsonObject,
} from "./workflow-graph-model";
import {
	applyWorkflowEdgeAdapterChoice,
	createWorkflowEdgePortDetails,
	insertWorkflowAdapterNodeForEdge,
	readWorkflowEdgeAdapterRef,
	type WorkflowEdgePortDetails,
} from "./workflow-edge-adapters";
import {
	DEFAULT_WORKFLOW_JSON_SCHEMA,
	DEFAULT_WRITE_STATE_SCOPES,
	WORKFLOW_STATE_SCOPES,
	applyWorkflowEdgeInspectorForm,
	applyWorkflowNodeInspectorForm,
	createWorkflowEdgeInspectorFormState,
	createWorkflowNodeInspectorFormState,
	readWorkflowGlobalStatePaths,
	toggleHumanActionChoice,
	workflowNodeStateAccessChanged,
	workflowStateAccessChanged,
	workflowStatePathOptions,
	type OptionalWorkflowPortKindSelection,
	type WorkflowEdgeInspectorFormState,
	type WorkflowHumanTimeoutKind,
	type WorkflowNodeInspectorFormState,
	type WorkflowPortKindSelection,
	type WorkflowStateAccessFormState,
	type WorkflowStateScope,
} from "./workflow-inspector-forms";
import type { WorkflowGraphInspectorSlotProps } from "./WorkflowGraphCanvas";
import { WorkflowPromptAssetEditor } from "./WorkflowPromptAssetEditor";
import { WorkflowVersionDiagnostics } from "./WorkflowVersionViewer";
import { HandlerSchemaPreview, RegisteredRefOptionCard, WorkflowInspectorPickerDiagnostics } from "./workflow-registry-cards";
import { WorkflowInspectorDiagnostics, WorkflowPill } from "./workflow-shared-ui";
import { handlerOptionLabel, profileOptionLabel, registeredRefOptionLabel, workflowVersionOptionKey, workflowVersionOptionLabel } from "./workflow-picker-labels";
import { parseWorkflowVersionKey, workflowVersionSelectionKey } from "./workflow-routes";
import {
	applyWorkflowSettingsForm,
	createDefaultGlobalStateField,
	createWorkflowSettingsFormState,
	workflowSettingsStateChanged,
	type WorkflowGlobalStateFieldFormState,
	type WorkflowGlobalStateMergeKind,
	type WorkflowSettingsFormState,
} from "./workflow-settings-model";

export function WorkflowInspectorsPanel({
	draft,
	selectedElement,
	nodeIds,
	isSaving,
	onSaveDefinition,
}: WorkflowGraphInspectorSlotProps) {
	const selectedNode = selectedElement?.type === "node" ? readWorkflowNodeDefinitions(draft.definition)[selectedElement.id] : undefined;
	const selectedEdge = selectedElement?.type === "edge" ? readWorkflowEdgeDefinitions(draft.definition)[selectedElement.id] : undefined;

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow inspectors">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">Workflow inspectors</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Inspector saves update the same Pibo Workflow IR draft as the graph canvas; XState remains projection-only.
				</p>
			</div>
			<WorkflowSettingsInspector draft={draft} isSaving={isSaving} onSaveDefinition={onSaveDefinition} />
			{selectedElement?.type === "node" && selectedNode ? (
				<WorkflowNodeInspector
					draft={draft}
					nodeId={selectedElement.id}
					node={selectedNode}
					isSaving={isSaving}
					onSaveDefinition={onSaveDefinition}
				/>
			) : selectedElement?.type === "edge" && selectedEdge ? (
				<WorkflowEdgeInspector
					draft={draft}
					edgeId={selectedElement.id}
					edge={selectedEdge}
					nodeIds={nodeIds}
					isSaving={isSaving}
					onSaveDefinition={onSaveDefinition}
				/>
			) : (
				<div className="rounded-sm border border-dashed border-slate-700 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
					Select a canvas node or edge to open the node or edge inspector. Workflow settings remain editable at all times.
				</div>
			)}
		</div>
	);
}

function workflowDiagnosticsForNode(diagnostics: WorkflowDraftDiagnostic[], nodeId: string): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.nodeId === nodeId || diagnostic.path?.startsWith(`$.nodes.${nodeId}`));
}

function workflowDiagnosticsForEdge(diagnostics: WorkflowDraftDiagnostic[], edgeId: string): WorkflowDraftDiagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.edgeId === edgeId || diagnostic.path?.startsWith(`$.edges.${edgeId}`));
}

function WorkflowSettingsInspector({ draft, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowSettingsFormState>(() => createWorkflowSettingsFormState(draft.definition));

	useEffect(() => {
		setForm(createWorkflowSettingsFormState(draft.definition));
	}, [draft.definition]);

	const update = <K extends keyof WorkflowSettingsFormState>(key: K, value: WorkflowSettingsFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const updateGlobalStateField = <K extends keyof WorkflowGlobalStateFieldFormState>(index: number, key: K, value: WorkflowGlobalStateFieldFormState[K]) => {
		setForm((current) => ({
			...current,
			globalStateFields: current.globalStateFields.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field),
		}));
	};

	const addGlobalStateField = () => {
		setForm((current) => ({
			...current,
			globalStateFields: [...current.globalStateFields, createDefaultGlobalStateField(current.globalStateFields)],
		}));
	};

	const removeGlobalStateField = (index: number) => {
		setForm((current) => ({
			...current,
			globalStateFields: current.globalStateFields.filter((_, fieldIndex) => fieldIndex !== index),
		}));
	};

	const saveSettings = () => {
		const definition = applyWorkflowSettingsForm(draft.definition, form);
		const editTrigger: WorkflowValidationTrigger = workflowSettingsStateChanged(draft.definition, form) ? "state_edit" : "schema_edit";
		void onSaveDefinition(definition, "Saved workflow settings inspector edits to the draft IR.", { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Workflow settings inspector</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Workflow title</span>
					<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.title} onChange={(event) => update("title", event.target.value)} />
				</label>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Workflow description</span>
					<textarea className="min-h-20 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.description} onChange={(event) => update("description", event.target.value)} />
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowPortEditor label="Workflow input port" kind={form.inputKind} description={form.inputDescription} schemaText={form.inputSchemaText} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} onSchemaChange={(value) => update("inputSchemaText", value)} />
					<WorkflowPortEditor label="Workflow output port" kind={form.outputKind} description={form.outputDescription} schemaText={form.outputSchemaText} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} onSchemaChange={(value) => update("outputSchemaText", value)} />
				</div>
				<WorkflowGlobalStateFieldsEditor
					fields={form.globalStateFields}
					onAddField={addGlobalStateField}
					onRemoveField={removeGlobalStateField}
					onUpdateField={updateGlobalStateField}
				/>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowListTextEditor label="metadata.tags" value={form.metadataTags} onChange={(value) => update("metadataTags", value)} />
					<WorkflowListTextEditor label="metadata.useWhen" value={form.metadataUseWhen} onChange={(value) => update("metadataUseWhen", value)} />
					<WorkflowListTextEditor label="metadata.notFor" value={form.metadataNotFor} onChange={(value) => update("metadataNotFor", value)} />
					<WorkflowListTextEditor label="metadata.examples" value={form.metadataExamples} onChange={(value) => update("metadataExamples", value)} />
				</div>
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveSettings} disabled={isSaving}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save workflow settings
				</button>
			</div>
		</details>
	);
}

function WorkflowNodeInspector({ draft, nodeId, node, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	nodeId: string;
	node: WorkflowJsonObject;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowNodeInspectorFormState>(() => createWorkflowNodeInspectorFormState(node));
	const [profilePicker, setProfilePicker] = useState<WorkflowProfilePickerResponse | undefined>();
	const [handlerPicker, setHandlerPicker] = useState<WorkflowHandlerPickerResponse | undefined>();
	const [adapterPicker, setAdapterPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [workflowPicker, setWorkflowPicker] = useState<WorkflowVersionPickerResponse | undefined>();
	const [humanActionPicker, setHumanActionPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const nodeKind = workflowNodeKind(node);
	const nodeDiagnostics = workflowDiagnosticsForNode(draft.diagnostics, nodeId);
	const selectedAdapterOption = adapterPicker?.options.find((option) => option.id === (adapterPicker?.selectedRefId ?? form.adapterRef));
	const selectedHumanActionIds = useMemo(() => new Set(form.humanActionRefs.map((action) => action.id)), [form.humanActionRefs]);

	useEffect(() => {
		setForm(createWorkflowNodeInspectorFormState(node));
	}, [node, nodeId]);

	useEffect(() => {
		if (nodeKind !== "agent") return;
		let cancelled = false;
		getWorkflowProfilePicker(form.profileId || undefined).then((picker) => {
			if (!cancelled) setProfilePicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.profileId]);

	useEffect(() => {
		if (nodeKind !== "code") return;
		let cancelled = false;
		getWorkflowHandlerPicker(form.handlerId || undefined).then((picker) => {
			if (!cancelled) setHandlerPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.handlerId]);

	useEffect(() => {
		if (nodeKind !== "adapter") return;
		let cancelled = false;
		getWorkflowAdapterPicker(form.adapterRef || undefined).then((picker) => {
			if (!cancelled) setAdapterPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.adapterRef]);

	useEffect(() => {
		if (nodeKind !== "workflow") return;
		let cancelled = false;
		const selection = parseWorkflowVersionKey(form.workflowVersionKey);
		getWorkflowVersionPicker({
			selectedWorkflowId: selection?.workflowId,
			selectedWorkflowVersion: selection?.workflowVersion,
		}).then((picker) => {
			if (!cancelled) setWorkflowPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind, form.workflowVersionKey]);

	useEffect(() => {
		if (nodeKind !== "human") return;
		let cancelled = false;
		getWorkflowHumanActionPicker()
			.then((picker) => {
				if (!cancelled) setHumanActionPicker(picker);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [nodeKind]);

	const update = <K extends keyof WorkflowNodeInspectorFormState>(key: K, value: WorkflowNodeInspectorFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const toggleHumanAction = (option: WorkflowRegisteredRefOption, checked: boolean) => {
		setForm((current) => ({
			...current,
			humanActionRefs: toggleHumanActionChoice(current.humanActionRefs, option, checked),
		}));
	};

	const saveNode = () => {
		const definition = applyWorkflowNodeInspectorForm(draft.definition, nodeId, form);
		const editTrigger: WorkflowValidationTrigger = workflowNodeStateAccessChanged(node, form)
			? "state_edit"
			: nodeKind === "agent" || nodeKind === "human" ? "prompt_edit" : "schema_edit";
		void onSaveDefinition(definition, `Saved node inspector edits for ${nodeId}.`, { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Node inspector: {nodeId}</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<div className="flex flex-wrap gap-2 text-[11px]"><WorkflowPill label={`${nodeKind} node`} /><WorkflowPill label={`${nodeDiagnostics.length} diagnostics`} /></div>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Node label</span>
					<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.label} onChange={(event) => update("label", event.target.value)} />
				</label>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Node description</span>
					<textarea className="min-h-16 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.description} onChange={(event) => update("description", event.target.value)} />
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<WorkflowOptionalPortEditor label="Node input port" kind={form.inputKind} description={form.inputDescription} schemaText={form.inputSchemaText} onKindChange={(value) => update("inputKind", value)} onDescriptionChange={(value) => update("inputDescription", value)} onSchemaChange={(value) => update("inputSchemaText", value)} />
					<WorkflowOptionalPortEditor label="Node output port" kind={form.outputKind} description={form.outputDescription} schemaText={form.outputSchemaText} onKindChange={(value) => update("outputKind", value)} onDescriptionChange={(value) => update("outputDescription", value)} onSchemaChange={(value) => update("outputSchemaText", value)} />
				</div>
				<WorkflowStateAccessEditor label="Node" definition={draft.definition} value={form.stateAccess} onChange={(stateAccess) => update("stateAccess", stateAccess)} />
				{nodeKind === "agent" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Agent node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Agent profile ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={profilePicker?.selectedProfileId ?? form.profileId} onChange={(event) => update("profileId", event.target.value)}>
								<option value="">Select a non-archived profile</option>
								{profilePicker?.options.map((option) => <option key={option.id} value={option.id}>{profileOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={profilePicker?.diagnostics ?? []} />
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Prompt template</span>
							<textarea className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-slate-100" value={form.promptTemplate} onChange={(event) => update("promptTemplate", event.target.value)} />
							<span className="text-[11px] font-normal leading-5 text-slate-500">Saving direct prompt text writes <code className="rounded bg-slate-900 px-1 text-slate-300">promptTemplate</code> on this Pibo Workflow IR node.</span>
						</label>
						<WorkflowPromptAssetEditor draft={draft} nodeId={nodeId} node={node} isSaving={isSaving} onSaveDefinition={onSaveDefinition} />
					</div>
				) : null}
				{nodeKind === "code" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Code node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Registered code handler</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={handlerPicker?.selectedHandlerId ?? form.handlerId} onChange={(event) => update("handlerId", event.target.value)}>
								<option value="">Select a registered handler ref</option>
								{handlerPicker?.options.map((option) => <option key={option.id} value={option.id}>{handlerOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={handlerPicker?.diagnostics ?? []} />
					</div>
				) : null}
				{nodeKind === "adapter" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Adapter node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Registered adapter ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={adapterPicker?.selectedRefId ?? form.adapterRef} onChange={(event) => update("adapterRef", event.target.value)}>
								<option value="">Select a registered adapter ref</option>
								{adapterPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowInspectorPickerDiagnostics diagnostics={adapterPicker?.diagnostics ?? []} />
						{selectedAdapterOption?.paramsSchema ? (
							<WorkflowParamsEditor
								label="Adapter params JSON"
								schema={selectedAdapterOption.paramsSchema}
								value={form.adapterParamsText}
								onChange={(value) => update("adapterParamsText", value)}
							/>
						) : null}
						<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 text-[11px] leading-5 text-slate-500">
							Adapter nodes store only a registered deterministic adapter ref. Inline transformation code and hidden LLM coercion are not exposed by the UI.
						</div>
					</div>
				) : null}
				{nodeKind === "workflow" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Nested workflow ref</span>
							<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={workflowPicker?.selectedWorkflowId && workflowPicker.selectedWorkflowVersion ? workflowVersionSelectionKey(workflowPicker.selectedWorkflowId, workflowPicker.selectedWorkflowVersion) : form.workflowVersionKey} onChange={(event) => update("workflowVersionKey", event.target.value)}>
								<option value="">Select a published workflow version</option>
								{workflowPicker?.options.map((option) => <option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>)}
							</select>
						</label>
						<WorkflowVersionDiagnostics diagnostics={workflowPicker?.diagnostics ?? []} ariaLabel="Workflow node diagnostics" />
					</div>
				) : null}
				{nodeKind === "human" ? (
					<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Human node fields">
						<label className="grid gap-1 font-semibold text-slate-300">
							<span>Human prompt</span>
							<textarea className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={form.humanPrompt} onChange={(event) => update("humanPrompt", event.target.value)} />
						</label>
						<WorkflowSchemaTextEditor label="Human node resume payload schema JSON" value={form.humanSchemaText} onChange={(value) => update("humanSchemaText", value)} />
						<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" aria-label="Human action choices">
							<div>
								<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Registered action choices</div>
								<p className="mt-1 text-[11px] leading-5 text-slate-500">
									Actions are selected from the Workflow Registry. The label, action kind, and payload requirements come from picker metadata.
								</p>
							</div>
							{humanActionPicker?.options.length ? humanActionPicker.options.map((option) => (
								<label key={option.id} className="grid gap-1 rounded-sm border border-slate-800 bg-[#101d22] p-2 text-slate-300">
									<span className="inline-flex items-center gap-2 font-semibold">
										<input
											type="checkbox"
											className="h-3.5 w-3.5 accent-[#11a4d4]"
											checked={selectedHumanActionIds.has(option.id)}
											onChange={(event) => toggleHumanAction(option, event.target.checked)}
										/>
										<span>{option.displayName}</span>
										<WorkflowPill label={`kind: ${option.kind ?? "registered"}`} />
									</span>
									<span className="text-[11px] font-normal leading-5 text-slate-500">{option.description ?? option.id}</span>
									<span className="text-[11px] font-normal leading-5 text-slate-500">Payload requirements: {option.paramsSchema ? JSON.stringify(option.paramsSchema) : "none"}</span>
								</label>
							)) : (
								<div className="rounded-sm border border-dashed border-slate-700 p-2 text-[11px] leading-5 text-slate-500">No registered human actions are available from the picker.</div>
							)}
							<WorkflowInspectorPickerDiagnostics diagnostics={humanActionPicker?.diagnostics ?? []} />
							<div className="flex flex-wrap gap-2 text-[11px]" aria-label="Selected human action refs">
								{form.humanActionRefs.length ? form.humanActionRefs.map((action) => (
									<WorkflowPill key={`${action.id}:${action.kind ?? ""}`} label={`${action.id}${action.kind ? ` (${action.kind})` : ""}`} />
								)) : <span className="text-slate-500">No human action refs selected.</span>}
							</div>
						</div>
						<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 md:grid-cols-[1fr_1fr]" aria-label="Human node timeout">
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>Timeout kind</span>
								<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.humanTimeoutKind} onChange={(event) => update("humanTimeoutKind", event.target.value as WorkflowHumanTimeoutKind)}>
									<option value="none">No timeout</option>
									<option value="milliseconds">Milliseconds</option>
									<option value="seconds">Seconds</option>
									<option value="minutes">Minutes</option>
									<option value="iso8601">ISO-8601 duration</option>
								</select>
							</label>
							<label className="grid gap-1 font-semibold text-slate-300">
								<span>Timeout value</span>
								<input
									className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
									type={form.humanTimeoutKind === "iso8601" ? "text" : "number"}
									min={form.humanTimeoutKind === "iso8601" ? undefined : 1}
									placeholder={form.humanTimeoutKind === "iso8601" ? "PT1H" : "60"}
									value={form.humanTimeoutValue}
									onChange={(event) => update("humanTimeoutValue", event.target.value)}
									disabled={form.humanTimeoutKind === "none"}
								/>
							</label>
						</div>
					</div>
				) : null}
				<WorkflowInspectorDiagnostics diagnostics={nodeDiagnostics} emptyLabel="No diagnostics for selected node." />
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveNode} disabled={isSaving}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save node inspector
				</button>
			</div>
		</details>
	);
}

function WorkflowStateAccessEditor({ label, definition, value, onChange, allowEdgeWrites = false }: {
	label: string;
	definition: WorkflowDraftDefinition;
	value: WorkflowStateAccessFormState;
	onChange: (value: WorkflowStateAccessFormState) => void;
	allowEdgeWrites?: boolean;
}) {
	const readPathOptions = workflowStatePathOptions(definition, value.readScope, [...value.reads, ...value.writes]);
	const writeScopes = allowEdgeWrites ? WORKFLOW_STATE_SCOPES : DEFAULT_WRITE_STATE_SCOPES;
	const writePathOptions = workflowStatePathOptions(definition, value.writeScope, [...value.reads, ...value.writes]);
	const canAddRead = Boolean(value.readPath.trim());
	const canAddWrite = Boolean(value.writePath.trim()) && (allowEdgeWrites || value.writeScope !== "edge");
	const update = <K extends keyof WorkflowStateAccessFormState>(key: K, nextValue: WorkflowStateAccessFormState[K]) => onChange({ ...value, [key]: nextValue });
	const addEntry = (direction: "reads" | "writes") => {
		const scope = direction === "reads" ? value.readScope : value.writeScope;
		const path = (direction === "reads" ? value.readPath : value.writePath).trim();
		if (!path) return;
		const entry = `${scope}.${path}`;
		const entries = value[direction];
		if (entries.includes(entry)) return;
		onChange({ ...value, [direction]: [...entries, entry] });
	};
	const removeEntry = (direction: "reads" | "writes", entry: string) => onChange({
		...value,
		[direction]: value[direction].filter((candidate) => candidate !== entry),
	});

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22]/70 p-3" aria-label={`${label} simple state mapping controls`}>
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label} simple state mappings</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Add simple scoped state reads and writes as Pibo Workflow IR <code className="rounded bg-slate-900 px-1 text-slate-300">state.reads</code> and <code className="rounded bg-slate-900 px-1 text-slate-300">state.writes</code> arrays. Complex state mapping DSLs remain raw Workflow IR only.
				</p>
			</div>
			<div className="grid gap-2 md:grid-cols-[0.7fr_1fr_auto]">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Read scope</span>
					<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value.readScope} onChange={(event) => update("readScope", event.target.value as WorkflowStateScope)}>
						{WORKFLOW_STATE_SCOPES.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
					</select>
				</label>
				<WorkflowStatePathSelect label="Read path" value={value.readPath} options={readPathOptions} onChange={(path) => update("readPath", path)} />
				<button type="button" className="self-end rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => addEntry("reads")} disabled={!canAddRead}>Add read</button>
			</div>
			<WorkflowStateEntryList label="Reads" entries={value.reads} onRemove={(entry) => removeEntry("reads", entry)} />
			<div className="grid gap-2 md:grid-cols-[0.7fr_1fr_auto]">
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Write scope</span>
					<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value.writeScope} onChange={(event) => update("writeScope", event.target.value as WorkflowStateScope)}>
						{writeScopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
					</select>
				</label>
				<WorkflowStatePathSelect label="Write path" value={value.writePath} options={writePathOptions} onChange={(path) => update("writePath", path)} />
				<button type="button" className="self-end rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => addEntry("writes")} disabled={!canAddWrite}>Add write</button>
			</div>
			<WorkflowStateEntryList label="Writes" entries={value.writes} onRemove={(entry) => removeEntry("writes", entry)} />
			{value.writeScope === "global" && !readWorkflowGlobalStatePaths(definition).length ? (
				<div className="rounded-sm border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] leading-5 text-amber-100">Declare global state fields in the workflow settings inspector before selecting global read/write paths.</div>
			) : null}
		</div>
	);
}

function WorkflowStatePathSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
	const normalizedOptions = value && !options.includes(value) ? [value, ...options] : options;
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={value} onChange={(event) => onChange(event.target.value)}>
				<option value="">Select path</option>
				{normalizedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
			</select>
		</label>
	);
}

function WorkflowStateEntryList({ label, entries, onRemove }: { label: string; entries: string[]; onRemove: (entry: string) => void }) {
	return (
		<div className="grid gap-1">
			<div className="text-[11px] font-semibold text-slate-400">{label}</div>
			{entries.length ? (
				<div className="flex flex-wrap gap-2">
					{entries.map((entry) => (
						<button key={entry} type="button" className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-red-500/60 hover:text-red-100" onClick={() => onRemove(entry)} title={`Remove ${entry}`}>
							{entry} ×
						</button>
					))}
				</div>
			) : <div className="text-[11px] text-slate-500">No {label.toLowerCase()} declared.</div>}
		</div>
	);
}

function WorkflowEdgeInspector({ draft, edgeId, edge, nodeIds, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	edgeId: string;
	edge: WorkflowJsonObject;
	nodeIds: string[];
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [form, setForm] = useState<WorkflowEdgeInspectorFormState>(() => createWorkflowEdgeInspectorFormState(edge, nodeIds));
	const [guardPicker, setGuardPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [adapterPicker, setAdapterPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [adapterDialogOpen, setAdapterDialogOpen] = useState(false);
	const edgeDiagnostics = workflowDiagnosticsForEdge(draft.diagnostics, edgeId);
	const edgePortDetails = createWorkflowEdgePortDetails(draft.definition, edge);
	const hasIncompatibleEdgeDiagnostic = edgeDiagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.incompatibleEdgePorts");
	const selectedGuardOption = guardPicker?.options.find((option) => option.id === (guardPicker?.selectedRefId ?? form.guardHandler));
	const selectedAdapterOption = adapterPicker?.options.find((option) => option.id === (adapterPicker?.selectedRefId ?? form.adapterRef));

	useEffect(() => {
		setForm(createWorkflowEdgeInspectorFormState(edge, nodeIds));
	}, [edge, edgeId, nodeIds]);

	useEffect(() => {
		setAdapterDialogOpen(false);
	}, [edgeId]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowGuardPicker(form.guardHandler || undefined).then((picker) => {
			if (!cancelled) setGuardPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [form.guardHandler]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowAdapterPicker(form.adapterRef || undefined).then((picker) => {
			if (!cancelled) setAdapterPicker(picker);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [form.adapterRef]);

	const update = <K extends keyof WorkflowEdgeInspectorFormState>(key: K, value: WorkflowEdgeInspectorFormState[K]) => {
		setForm((current) => ({ ...current, [key]: value }));
	};

	const saveEdge = () => {
		const definition = applyWorkflowEdgeInspectorForm(draft.definition, edgeId, form);
		const editTrigger: WorkflowValidationTrigger = workflowStateAccessChanged(edge.state, form.stateAccess) ? "state_edit" : "edge_edit";
		void onSaveDefinition(definition, `Saved edge inspector edits for ${edgeId}.`, { editTrigger });
	};

	return (
		<details className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" open>
			<summary className="cursor-pointer text-xs font-bold text-slate-200">Edge inspector: {edgeId}</summary>
			<div className="mt-3 grid gap-3 text-xs">
				<div className="flex flex-wrap gap-2 text-[11px]"><WorkflowPill label={`${form.kind} edge`} /><WorkflowPill label={`${edgeDiagnostics.length} diagnostics`} /></div>
				<div className="grid gap-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Source node</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.sourceNodeId} onChange={(event) => update("sourceNodeId", event.target.value)}>
							<option value="">Select source</option>
							{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Target node</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.targetNodeId} onChange={(event) => update("targetNodeId", event.target.value)}>
							<option value="">Select target</option>
							{nodeIds.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Source port id</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.sourcePortId} onChange={(event) => update("sourcePortId", event.target.value)} placeholder="default" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Target port id</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.targetPortId} onChange={(event) => update("targetPortId", event.target.value)} placeholder="default" />
					</label>
				</div>
				<label className="grid gap-1 font-semibold text-slate-300">
					<span>Edge kind</span>
					<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.kind} onChange={(event) => update("kind", event.target.value as WorkflowEdgeInspectorFormState["kind"])}>
						<option value="data">data</option>
						<option value="control">control</option>
						<option value="error">error</option>
						<option value="resume">resume</option>
					</select>
				</label>
				<div className="grid gap-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Guard ref</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={guardPicker?.selectedRefId ?? form.guardHandler} onChange={(event) => update("guardHandler", event.target.value)}>
							<option value="">No guard</option>
							{guardPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Guard priority</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={form.guardPriority} onChange={(event) => update("guardPriority", event.target.value)} placeholder="optional integer" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300 md:col-span-2">
						<span>Edge adapter ref</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={adapterPicker?.selectedRefId ?? form.adapterRef} onChange={(event) => update("adapterRef", event.target.value)}>
							<option value="">No edge adapter</option>
							{adapterPicker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>
				</div>
				{selectedGuardOption?.paramsSchema ? (
					<WorkflowParamsEditor label="Guard params JSON" schema={selectedGuardOption.paramsSchema} value={form.guardParamsText} onChange={(value) => update("guardParamsText", value)} />
				) : null}
				{selectedAdapterOption?.paramsSchema ? (
					<WorkflowParamsEditor label="Edge adapter params JSON" schema={selectedAdapterOption.paramsSchema} value={form.adapterParamsText} onChange={(value) => update("adapterParamsText", value)} />
				) : null}
				<WorkflowStateAccessEditor label="Edge" definition={draft.definition} value={form.stateAccess} onChange={(stateAccess) => update("stateAccess", stateAccess)} allowEdgeWrites />
				<button
					type="button"
					className={`inline-flex items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${hasIncompatibleEdgeDiagnostic ? "border-amber-600/70 text-amber-100 hover:border-amber-400" : "border-slate-700 text-slate-300 hover:border-[#11a4d4]/60 hover:text-slate-100"}`}
					onClick={() => setAdapterDialogOpen(true)}
					disabled={isSaving || !edgePortDetails.sourcePort || !edgePortDetails.targetPort}
				>
					<Link2 size={13} />
					{hasIncompatibleEdgeDiagnostic ? "Fix incompatible edge with adapter" : "Open compatible edge adapter dialog"}
				</button>
				{adapterDialogOpen ? (
					<WorkflowEdgeAdapterDialog
						draft={draft}
						edgeId={edgeId}
						edge={edge}
						edgePortDetails={edgePortDetails}
						isSaving={isSaving}
						onClose={() => setAdapterDialogOpen(false)}
						onSaveDefinition={onSaveDefinition}
					/>
				) : null}
				<WorkflowInspectorPickerDiagnostics diagnostics={[...(guardPicker?.diagnostics ?? []), ...(adapterPicker?.diagnostics ?? [])]} />
				<WorkflowInspectorDiagnostics diagnostics={edgeDiagnostics} emptyLabel="No diagnostics for selected edge." />
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={saveEdge} disabled={isSaving || !form.sourceNodeId || !form.targetNodeId}>
					{isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
					Save edge inspector
				</button>
			</div>
		</details>
	);
}

function WorkflowEdgeAdapterDialog({ draft, edgeId, edge, edgePortDetails, isSaving, onClose, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	edgeId: string;
	edge: WorkflowJsonObject;
	edgePortDetails: WorkflowEdgePortDetails;
	isSaving: boolean;
	onClose: () => void;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [selectedAdapterRef, setSelectedAdapterRef] = useState(readWorkflowEdgeAdapterRef(edge));
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowAdapterPicker(selectedAdapterRef || undefined)
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setSelectedAdapterRef((current) => current || (response.options[0]?.id ?? ""));
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load compatible adapters");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedAdapterRef]);

	const selectedOption = picker?.options.find((option) => option.id === selectedAdapterRef);
	const canApply = Boolean(selectedOption && edgePortDetails.sourcePort && edgePortDetails.targetPort && loadState === "loaded" && !isSaving);

	const useAsEdgeAdapter = async () => {
		if (!selectedAdapterRef) return;
		await onSaveDefinition(
			applyWorkflowEdgeAdapterChoice(draft.definition, edgeId, selectedAdapterRef),
			`Applied ${selectedAdapterRef} as edge adapter for ${edgeId}.`,
			{ editTrigger: "edge_edit" },
		);
		onClose();
	};

	const insertAdapterNode = async () => {
		if (!selectedAdapterRef) return;
		const definition = insertWorkflowAdapterNodeForEdge(draft.definition, edgeId, selectedAdapterRef);
		await onSaveDefinition(definition, `Inserted adapter node for ${edgeId} using ${selectedAdapterRef}.`, { editTrigger: "graph_edit" });
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="workflow-edge-adapter-dialog-title">
			<div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-sm border border-slate-700 bg-[#101d22] p-4 shadow-2xl shadow-black/40">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Link2 size={13} />Compatible edge adapter dialog</div>
						<h4 id="workflow-edge-adapter-dialog-title" className="mt-1 text-sm font-bold text-slate-100">Choose a registered adapter for {edgeId}</h4>
						<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
							The dialog shows the source output and target input schemas from the Pibo Workflow IR. Use a registered adapter as an explicit edge adapter, or insert a visible adapter node between the endpoints.
						</p>
					</div>
					<button type="button" className="rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" onClick={onClose}>Close</button>
				</div>

				<div className="mt-4 grid gap-3 md:grid-cols-2">
					<HandlerSchemaPreview label={`From schema${edgePortDetails.sourceNodeId ? ` (${edgePortDetails.sourceNodeId})` : ""}`} schema={edgePortDetails.sourcePort ?? null} />
					<HandlerSchemaPreview label={`To schema${edgePortDetails.targetNodeId ? ` (${edgePortDetails.targetNodeId})` : ""}`} schema={edgePortDetails.targetPort ?? null} />
				</div>

				<div className={`mt-3 rounded-sm border p-3 text-xs leading-5 ${edgePortDetails.directlyCompatible ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-200" : "border-amber-700/70 bg-amber-950/30 text-amber-100"}`}>
					{edgePortDetails.directlyCompatible
						? "These ports are directly compatible. An adapter is optional and remains explicit if selected."
						: "These ports are not directly compatible. Select a registered adapter instead of hidden LLM coercion or inline transformation code."}
				</div>

				<div className="mt-4 grid gap-3 text-xs">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Compatible registered adapter</span>
						<select
							aria-label="Compatible registered adapter"
							className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100"
							value={selectedAdapterRef}
							onChange={(event) => setSelectedAdapterRef(event.target.value)}
							disabled={loadState === "loading" || loadState === "error" || isSaving}
						>
							<option value="">Select a registered adapter ref</option>
							{picker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
						</select>
					</label>

					{loadState === "error" ? <div className="rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs leading-5 text-red-200" role="alert">{errorMessage ?? "Failed to load compatible adapters."}</div> : null}
					<WorkflowInspectorPickerDiagnostics diagnostics={picker?.diagnostics ?? []} />
					{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge="selected adapter" /> : null}
					<div className="grid gap-2" aria-label="Compatible adapter candidates">
						<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Compatible adapter candidates</div>
						{picker?.options.map((option) => <RegisteredRefOptionCard key={option.id} option={option} badge="compatible adapter" />)}
					</div>

					<div className="grid gap-2 md:grid-cols-2">
						<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void useAsEdgeAdapter()} disabled={!canApply}>
							<Link2 size={13} />
							Use as edge adapter
						</button>
						<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void insertAdapterNode()} disabled={!canApply}>
							<Plus size={13} />
							Insert adapter node
						</button>
					</div>

					<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
						Both actions persist Pibo Workflow IR only. Edge adapters store <code className="rounded bg-slate-900 px-1 text-slate-300">adapter.transform.id</code>; inserted adapter nodes store a visible deterministic adapter handler ref.
					</div>
				</div>
			</div>
		</div>
	);
}

function WorkflowPortEditor({ label, kind, description, schemaText, onKindChange, onDescriptionChange, onSchemaChange }: {
	label: string;
	kind: WorkflowPortKindSelection;
	description: string;
	schemaText: string;
	onKindChange: (kind: WorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
	onSchemaChange: (schemaText: string) => void;
}) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>{label}</span>
				<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={kind} onChange={(event) => onKindChange(event.target.value as WorkflowPortKindSelection)}>
					<option value="text">text</option>
					<option value="json">json</option>
				</select>
			</label>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Description</span>
				<input className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional port description" />
			</label>
			{kind === "json" ? <WorkflowSchemaTextEditor label={`${label} raw JSON schema`} value={schemaText} onChange={onSchemaChange} /> : null}
		</div>
	);
}

function WorkflowOptionalPortEditor({ label, kind, description, schemaText, onKindChange, onDescriptionChange, onSchemaChange }: {
	label: string;
	kind: OptionalWorkflowPortKindSelection;
	description: string;
	schemaText: string;
	onKindChange: (kind: OptionalWorkflowPortKindSelection) => void;
	onDescriptionChange: (description: string) => void;
	onSchemaChange: (schemaText: string) => void;
}) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>{label}</span>
				<select className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={kind} onChange={(event) => onKindChange(event.target.value as OptionalWorkflowPortKindSelection)}>
					<option value="none">inherit/default</option>
					<option value="text">text</option>
					<option value="json">json</option>
				</select>
			</label>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Description</span>
				<input className="rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 text-slate-100" value={description} onChange={(event) => onDescriptionChange(event.target.value)} disabled={kind === "none"} placeholder="Optional port description" />
			</label>
			{kind === "json" ? <WorkflowSchemaTextEditor label={`${label} raw JSON schema`} value={schemaText} onChange={onSchemaChange} /> : null}
		</div>
	);
}

function WorkflowGlobalStateFieldsEditor({ fields, onAddField, onRemoveField, onUpdateField }: {
	fields: WorkflowGlobalStateFieldFormState[];
	onAddField: () => void;
	onRemoveField: (index: number) => void;
	onUpdateField: <K extends keyof WorkflowGlobalStateFieldFormState>(index: number, key: K, value: WorkflowGlobalStateFieldFormState[K]) => void;
}) {
	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#101d22] p-3" aria-label="Workflow global state fields">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Workflow global state fields</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Declare simple global state paths for node and edge state mapping dropdowns. State schema changes run draft validation and may invalidate connected graph diagnostics without blocking draft save.
				</p>
			</div>
			{fields.length ? fields.map((field, index) => (
				<div key={`${index}:${field.path}`} className="grid gap-2 rounded-sm border border-slate-800 bg-[#151f24]/70 p-2 md:grid-cols-2">
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Global state path</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.path} onChange={(event) => onUpdateField(index, "path", event.target.value)} placeholder="projectGoal" />
					</label>
					<label className="grid gap-1 font-semibold text-slate-300">
						<span>Merge policy</span>
						<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.mergeKind} onChange={(event) => onUpdateField(index, "mergeKind", event.target.value as WorkflowGlobalStateMergeKind)}>
							<option value="none">No merge policy</option>
							<option value="replace">replace</option>
							<option value="append">append</option>
							<option value="shallowMerge">shallowMerge</option>
						</select>
					</label>
					<label className="grid gap-1 font-semibold text-slate-300 md:col-span-2">
						<span>Description</span>
						<input className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={field.description} onChange={(event) => onUpdateField(index, "description", event.target.value)} placeholder="Optional state description" />
					</label>
					<div className="md:col-span-2">
						<WorkflowSchemaTextEditor label={`Global state ${field.path || index + 1} schema JSON`} value={field.schemaText} onChange={(value) => onUpdateField(index, "schemaText", value)} />
					</div>
					<button type="button" className="rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-red-500/70 hover:text-red-100" onClick={() => onRemoveField(index)}>Remove state field</button>
				</div>
			)) : <div className="rounded-sm border border-dashed border-slate-700 p-2 text-[11px] leading-5 text-slate-500">No global state fields declared. Local and edge path dropdowns remain available for simple node-local state and edge payload access.</div>}
			<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" onClick={onAddField}>
				<Plus size={13} />
				Add global state field
			</button>
		</div>
	);
}

function WorkflowSchemaTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<textarea
				className="min-h-36 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-100"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={JSON.stringify(DEFAULT_WORKFLOW_JSON_SCHEMA, null, 2)}
				spellCheck={false}
				aria-label={label}
			/>
			<span className="text-[11px] font-normal leading-5 text-slate-500">Raw JSON Schema subset only. Unsupported keywords return workflow diagnostics; no Zod, AJV, or form-builder schema layer is introduced.</span>
		</label>
	);
}

function WorkflowListTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
	return (
		<label className="grid gap-1 font-semibold text-slate-300">
			<span>{label}</span>
			<textarea className="min-h-16 rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={value} onChange={(event) => onChange(event.target.value)} placeholder="One value per line" />
		</label>
	);
}

function WorkflowParamsEditor({ label, schema, value, onChange }: { label: string; schema: Record<string, unknown>; value: string; onChange: (value: string) => void }) {
	return (
		<div className="grid gap-2 rounded-sm border border-slate-800 bg-[#101d22] p-2" aria-label={label}>
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<HandlerSchemaPreview label="paramsSchema" schema={schema} />
			<textarea
				className="min-h-24 rounded-sm border border-slate-700 bg-[#151f24] px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-100"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder="{}"
				aria-label={`${label} value`}
			/>
			<div className="text-[11px] leading-5 text-slate-500">Params save as data on the selected registry ref. No inline code path is created.</div>
		</div>
	);
}
