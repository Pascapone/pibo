import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { SaveState } from "../api";
import {
	getWorkflowPromptAsset,
	getWorkflowPromptAssetPicker,
	postWorkflowPromptAssetRevision,
	type WorkflowDraftDefinition,
	type WorkflowDraftRecord,
	type WorkflowPromptAssetDocument,
	type WorkflowRegisteredRefPickerResponse,
	type WorkflowValidationTrigger,
} from "../api-workflows";
import { MarkdownEditor } from "../context/MarkdownEditor";
import { DEFAULT_AGENT_PROMPT_TEMPLATE } from "./workflow-node-defaults";
import type { WorkflowJsonObject } from "./workflow-graph-model";
import { registeredRefOptionLabel } from "./workflow-picker-labels";
import { WorkflowPill } from "./workflow-shared-ui";
import { applyWorkflowPromptAssetDocumentToNode, readPromptAssetRefId } from "./workflow-settings-model";
import { RegisteredRefOptionCard, WorkflowInspectorPickerDiagnostics } from "./workflow-registry-cards";

export function WorkflowPromptAssetEditor({ draft, nodeId, node, isSaving, onSaveDefinition }: {
	draft: WorkflowDraftRecord;
	nodeId: string;
	node: WorkflowJsonObject;
	isSaving: boolean;
	onSaveDefinition: (definition: WorkflowDraftDefinition, successMessage: string, options?: { editTrigger?: WorkflowValidationTrigger }) => Promise<void>;
}) {
	const [selectedRef, setSelectedRef] = useState(readPromptAssetRefId(node.promptBuilder));
	const [picker, setPicker] = useState<WorkflowRegisteredRefPickerResponse | undefined>();
	const [asset, setAsset] = useState<WorkflowPromptAssetDocument | undefined>();
	const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
	const [saveState, setSaveState] = useState<SaveState>("saved");
	const [message, setMessage] = useState<string | undefined>();

	useEffect(() => {
		setSelectedRef(readPromptAssetRefId(node.promptBuilder));
	}, [node, nodeId]);

	useEffect(() => {
		let cancelled = false;
		getWorkflowPromptAssetPicker(selectedRef || undefined).then((response) => {
			if (!cancelled) setPicker(response);
		}).catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selectedRef]);

	useEffect(() => {
		let cancelled = false;
		setMessage(undefined);
		if (!selectedRef) {
			setAsset(undefined);
			setLoadState("idle");
			return () => {
				cancelled = true;
			};
		}
		setLoadState("loading");
		getWorkflowPromptAsset(selectedRef)
			.then((response) => {
				if (cancelled) return;
				setAsset(response.asset);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setAsset(undefined);
				setLoadState("error");
				setMessage(error instanceof Error ? error.message : "Failed to load prompt asset");
			});
		return () => {
			cancelled = true;
		};
	}, [selectedRef]);

	const selectedOption = picker?.options.find((option) => option.id === selectedRef);
	const directPromptTemplate = typeof node.promptTemplate === "string" ? node.promptTemplate : DEFAULT_AGENT_PROMPT_TEMPLATE;
	const initialMarkdown = asset?.markdown ?? directPromptTemplate;
	const editorDocumentKey = `${draft.draftId}:${nodeId}:${(asset?.id ?? selectedRef) || "direct-prompt"}:${asset?.revisionId ?? "draft"}`;
	const hasPromptBuilder = Boolean(readPromptAssetRefId(node.promptBuilder));
	const selectedRefIsManaged = selectedRef.startsWith("ui.promptAssets.");
	const promptAssetDisplayName = `${typeof node.label === "string" && node.label.trim() ? node.label.trim() : nodeId} prompt asset`;

	const persistPromptAsset = useCallback(async (markdown: string) => {
		try {
			const response = await postWorkflowPromptAssetRevision({
				assetId: selectedRefIsManaged ? selectedRef : undefined,
				sourceRefId: selectedRef || undefined,
				displayName: promptAssetDisplayName,
				description: `Managed prompt asset for ${nodeId} in draft ${draft.draftId}.`,
				markdown,
			});
			const definition = applyWorkflowPromptAssetDocumentToNode(draft.definition, nodeId, response.asset);
			await onSaveDefinition(definition, `Saved prompt asset revision ${response.asset.revisionId} and updated ${nodeId}.`, { editTrigger: "prompt_edit" });
			setSelectedRef(response.asset.id);
			setAsset(response.asset);
			setMessage(`Saved ${response.asset.displayName} as revision ${response.asset.revisionId}; draft now pins ${response.asset.contentHash}.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Failed to save prompt asset revision");
			throw error;
		}
	}, [draft.definition, draft.draftId, nodeId, onSaveDefinition, promptAssetDisplayName, selectedRef, selectedRefIsManaged]);

	const useSelectedPromptAsset = async () => {
		if (!asset) return;
		const definition = applyWorkflowPromptAssetDocumentToNode(draft.definition, nodeId, asset);
		await onSaveDefinition(definition, `Updated ${nodeId} to use prompt asset ${asset.id}.`, { editTrigger: "prompt_edit" });
		setMessage(`Draft node ${nodeId} now uses ${asset.displayName} at ${asset.contentHash}.`);
	};

	return (
		<div className="grid gap-3 rounded-sm border border-slate-800 bg-[#151f24]/70 p-3" aria-label="Prompt asset Markdown editor">
			<div>
				<div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Prompt asset Markdown editor</div>
				<p className="mt-1 text-[11px] leading-5 text-slate-500">
					Edit prompt assets with the same Markdown editor pattern as Context Files. Saving creates a managed UI asset revision, updates this draft node to a prompt asset ref, and pins the revision id plus content hash in the Pibo Workflow IR.
				</p>
			</div>
			<label className="grid gap-1 font-semibold text-slate-300">
				<span>Prompt asset ref</span>
				<select className="rounded-sm border border-slate-700 bg-[#101d22] px-2 py-1.5 text-slate-100" value={selectedRef} onChange={(event) => setSelectedRef(event.target.value)} disabled={isSaving}>
					<option value="">Create managed asset from direct prompt template</option>
					{picker?.options.map((option) => <option key={option.id} value={option.id}>{registeredRefOptionLabel(option)}</option>)}
				</select>
			</label>
			<WorkflowInspectorPickerDiagnostics diagnostics={picker?.diagnostics ?? []} />
			{selectedOption ? <RegisteredRefOptionCard option={selectedOption} badge={selectedOption.kind === "ui" ? "managed prompt asset" : "registered prompt asset"} /> : null}
			{loadState === "error" ? (
				<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-2 text-[11px] leading-5 text-red-200" role="alert">{message ?? "Failed to load prompt asset."}</div>
			) : null}
			<div className="rounded-sm border border-slate-800 bg-[#101d22] p-2">
				<MarkdownEditor
					documentKey={editorDocumentKey}
					initialMarkdown={initialMarkdown}
					onPersist={persistPromptAsset}
					onSaveStateChange={setSaveState}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2 text-[11px]">
				<WorkflowPill label={hasPromptBuilder ? "promptBuilder ref" : "direct promptTemplate source"} />
				<WorkflowPill label={`Markdown save: ${saveState}`} />
				{asset ? <WorkflowPill label={`${asset.source} · ${asset.revisionId}`} /> : null}
			</div>
			<div className="flex flex-wrap gap-2">
				<button type="button" className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/50 px-3 py-2 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void useSelectedPromptAsset()} disabled={isSaving || !asset}>
					<Save size={13} />
					Use selected asset on draft
				</button>
			</div>
			{message && loadState !== "error" ? <div className="rounded-sm border border-emerald-900/60 bg-emerald-950/20 p-2 text-[11px] leading-5 text-emerald-200" role="status">{message}</div> : null}
			<div className="text-[11px] leading-5 text-slate-500">
				Code/plugin prompt assets are not mutated. Editing a registered asset copies the Markdown into a managed UI prompt asset; later saves append revisions and only affect this draft or future workflow versions that reference the new revision.
			</div>
		</div>
	);
}
