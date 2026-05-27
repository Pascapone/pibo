import type { PiboJsonObject } from "../../core/events.js";
import type { PiboWebSession } from "../../web/types.js";
import type { ProjectWorkflowHumanActionRegistryOption } from "./project-workflow-human-actions.js";
import {
	hashPromptAssetMarkdown,
	workflowPromptAssetDocumentFromRecords,
	type ChatWorkflowPromptAssetStore,
	type WorkflowPromptAssetDocument,
} from "./workflow-persistence.js";

export type WorkflowPickerDiagnostic = {
	code: string;
	message: string;
	severity: "error";
	path: string;
	registryRef: string;
	hint: string;
};

export type WorkflowRegisteredRefOption = {
	id: string;
	displayName: string;
	description?: string;
	paramsSchema: PiboJsonObject | null;
	kind?: string;
};

export type WorkflowRegisteredRefPickerResponse = {
	kind: "guards" | "adapters" | "human-actions" | "prompt-assets";
	options: WorkflowRegisteredRefOption[];
	selectedRefId?: string;
	diagnostics: WorkflowPickerDiagnostic[];
};

export const WORKFLOW_ADAPTER_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.adapters.textToTopic",
		displayName: "Text to topic",
		description: "Registered deterministic adapter from the workflow fixtures registry.",
		paramsSchema: null,
	},
	{
		id: "fixture.adapters.draftToSummary",
		displayName: "Draft to summary",
		description: "Registered deterministic adapter from the workflow fixtures registry.",
		paramsSchema: {
			type: "object",
			properties: {
				format: { type: "string", description: "Presentation format for the summarized payload." },
			},
			required: ["format"],
			additionalProperties: false,
		},
	},
];

export const WORKFLOW_GUARD_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.guards.approved",
		displayName: "Approved",
		description: "Registered guard from the workflow fixtures registry.",
		paramsSchema: {
			type: "object",
			properties: {
				expected: { type: "boolean", description: "Expected approval flag for this guarded route." },
			},
			required: ["expected"],
			additionalProperties: false,
		},
	},
	{
		id: "fixture.guards.needsRevision",
		displayName: "Needs revision",
		description: "Registered guard from the workflow fixtures registry.",
		paramsSchema: null,
	},
];

export const WORKFLOW_PROMPT_ASSET_REF_OPTIONS: WorkflowRegisteredRefOption[] = [
	{
		id: "fixture.promptBuilders.draftPrompt",
		displayName: "Draft prompt builder",
		description: "Registered prompt asset/prompt-builder ref from the workflow fixtures registry.",
		paramsSchema: null,
		kind: "code",
	},
];

export const WORKFLOW_HUMAN_ACTION_REF_OPTIONS: ProjectWorkflowHumanActionRegistryOption[] = [
	{
		id: "fixture.humanActions.approve",
		kind: "approve",
		displayName: "Approve",
		description: "Registered human action for approving a pending workflow wait token.",
		paramsSchema: null,
	},
	{
		id: "fixture.humanActions.reject",
		kind: "reject",
		displayName: "Reject",
		description: "Registered human action for rejecting a pending workflow wait token.",
		paramsSchema: null,
	},
	{
		id: "fixture.humanActions.resume",
		kind: "resume",
		displayName: "Resume",
		description: "Registered human action for resuming a pending workflow wait token with a payload.",
		paramsSchema: null,
	},
	{
		id: "fixture.humanActions.cancel",
		kind: "cancel",
		displayName: "Cancel",
		description: "Registered human action for cancelling a pending workflow wait token.",
		paramsSchema: null,
	},
];

const WORKFLOW_STATIC_PROMPT_ASSET_MARKDOWN: Record<string, string> = {
	"fixture.promptBuilders.draftPrompt": "Draft a concise response from the workflow input.\n\n{{input}}",
};

type WorkflowPromptAssetStoreReader = Pick<ChatWorkflowPromptAssetStore, "listAssets" | "getAsset" | "getActiveRevision">;

export type WorkflowPromptAssetPickerState = {
	workflowPromptAssetStore: WorkflowPromptAssetStoreReader;
};

export function buildWorkflowRegisteredRefPicker(
	kind: WorkflowRegisteredRefPickerResponse["kind"],
	optionsInput: readonly WorkflowRegisteredRefOption[],
	selectedRefId: string | undefined,
): WorkflowRegisteredRefPickerResponse {
	const options = [...optionsInput]
		.sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id));
	const normalizedSelection = selectedRefId?.trim() || undefined;
	const activeSelection = normalizedSelection && options.some((option) => option.id === normalizedSelection)
		? normalizedSelection
		: undefined;
	const diagnostics: WorkflowPickerDiagnostic[] = [];
	if (normalizedSelection && !activeSelection) {
		diagnostics.push(workflowRegisteredRefPickerDiagnostic(kind, normalizedSelection));
	}
	return {
		kind,
		options,
		...(activeSelection ? { selectedRefId: activeSelection } : {}),
		diagnostics,
	};
}

export function buildWorkflowPromptAssetPicker(
	state: WorkflowPromptAssetPickerState,
	webSession: PiboWebSession,
	selectedRefId: string | undefined,
): WorkflowRegisteredRefPickerResponse {
	const uiOptions = state.workflowPromptAssetStore.listAssets(webSession.ownerScope).map((asset): WorkflowRegisteredRefOption => ({
		id: asset.assetId,
		displayName: asset.displayName,
		...(asset.description ? { description: asset.description } : {}),
		paramsSchema: null,
		kind: "ui",
	}));
	return buildWorkflowRegisteredRefPicker("prompt-assets", [...WORKFLOW_PROMPT_ASSET_REF_OPTIONS, ...uiOptions], selectedRefId);
}

export function getWorkflowPromptAssetDocument(
	state: WorkflowPromptAssetPickerState,
	webSession: PiboWebSession,
	assetId: string,
): WorkflowPromptAssetDocument | undefined {
	const staticOption = WORKFLOW_PROMPT_ASSET_REF_OPTIONS.find((option) => option.id === assetId);
	if (staticOption) {
		const markdown = WORKFLOW_STATIC_PROMPT_ASSET_MARKDOWN[assetId] ?? "";
		const now = "code";
		return {
			id: staticOption.id,
			displayName: staticOption.displayName,
			...(staticOption.description ? { description: staticOption.description } : {}),
			source: "code",
			readOnly: true,
			revisionId: `code:${staticOption.id}:1`,
			contentHash: hashPromptAssetMarkdown(markdown),
			markdown,
			createdAt: now,
			updatedAt: now,
		};
	}
	const asset = state.workflowPromptAssetStore.getAsset(webSession.ownerScope, assetId);
	const revision = asset ? state.workflowPromptAssetStore.getActiveRevision(webSession.ownerScope, assetId) : undefined;
	return asset && revision ? workflowPromptAssetDocumentFromRecords(asset, revision) : undefined;
}

export function isWorkflowPromptAssetRegistered(state: WorkflowPromptAssetPickerState, webSession: PiboWebSession, assetId: string): boolean {
	return WORKFLOW_PROMPT_ASSET_REF_OPTIONS.some((option) => option.id === assetId)
		|| Boolean(state.workflowPromptAssetStore.getAsset(webSession.ownerScope, assetId));
}

function workflowRegisteredRefPickerDiagnostic(kind: WorkflowRegisteredRefPickerResponse["kind"], registryRef: string): WorkflowPickerDiagnostic {
	if (kind === "guards") {
		return {
			code: "WorkflowGraphError.unknownGuardRef",
			message: `Workflow edge references guard '${registryRef}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: "$.edges.edge.guard.handler",
			registryRef,
			hint: "Select a registered guard ref before publishing or running this workflow.",
		};
	}
	if (kind === "adapters") {
		return {
			code: "WorkflowGraphError.unknownAdapterRef",
			message: `Workflow edge references adapter '${registryRef}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: "$.edges.edge.adapter.transform.id",
			registryRef,
			hint: "Select a registered adapter ref before publishing or running this workflow.",
		};
	}
	if (kind === "human-actions") {
		return {
			code: "WorkflowGraphError.unknownHumanActionRef",
			message: `Human node references human action '${registryRef}', but it is not registered in the Workflow Registry.`,
			severity: "error",
			path: "$.nodes.human.actions.0.id",
			registryRef,
			hint: "Select a registered human action before publishing or running this workflow.",
		};
	}
	return {
		code: "WorkflowGraphError.unknownPromptBuilderRef",
		message: `Agent node references prompt asset '${registryRef}', but it is not registered in the Workflow Registry.`,
		severity: "error",
		path: "$.nodes.agent.promptBuilder.id",
		registryRef,
		hint: "Select a registered prompt asset ref before publishing or running this workflow.",
	};
}
