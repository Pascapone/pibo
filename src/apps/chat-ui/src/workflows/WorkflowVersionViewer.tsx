import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import {
	getWorkflowVersionHistory,
	type WorkflowCatalogVersionRecord,
	type WorkflowPickerDiagnostic,
	type WorkflowVersionHistoryResponse,
} from "../api-workflows";
import { WorkflowPill } from "./workflow-shared-ui";

export function WorkflowVersionViewer({ workflowId, workflowVersion }: { workflowId: string; workflowVersion: string }) {
	const [picker, setPicker] = useState<WorkflowVersionHistoryResponse | undefined>();
	const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
	const [errorMessage, setErrorMessage] = useState<string | undefined>();

	useEffect(() => {
		let cancelled = false;
		setLoadState("loading");
		setErrorMessage(undefined);
		getWorkflowVersionHistory({ selectedWorkflowId: workflowId, selectedWorkflowVersion: workflowVersion })
			.then((response) => {
				if (cancelled) return;
				setPicker(response);
				setLoadState("loaded");
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setErrorMessage(error instanceof Error ? error.message : "Failed to load workflow viewer");
				setLoadState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [workflowId, workflowVersion]);

	const selectedOption = useMemo(
		() => picker?.options.find((option) => option.id === picker.selectedWorkflowId && option.version === picker.selectedWorkflowVersion),
		[picker],
	);

	if (loadState === "loading") {
		return (
			<div className="flex w-full items-center gap-2 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4 text-sm text-slate-300" aria-live="polite">
				<Loader2 size={16} className="animate-spin text-[#11a4d4]" />
				Loading workflow viewer {workflowId}@{workflowVersion}…
			</div>
		);
	}

	if (loadState === "error") {
		return (
			<div className="rounded-sm border border-red-900/70 bg-red-950/40 p-4 text-sm leading-6 text-red-200" role="alert">
				<div className="font-bold">Could not load workflow viewer</div>
				<div className="mt-1 text-xs">{errorMessage ?? "Failed to load workflow metadata."}</div>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-4 rounded-sm border border-slate-800 bg-[#101d22]/70 p-4">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]">
						<ExternalLink size={13} />
						Workflow version viewer
					</div>
					<h3 className="mt-1 text-lg font-bold text-slate-100">{selectedOption?.title ?? `${workflowId}@${workflowVersion}`}</h3>
					<p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
						This separate viewer is the nested workflow navigation target. Parent graphs do not inline-expand nested workflow internals in V2.
					</p>
				</div>
				<a className="shrink-0 rounded-sm border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-[#11a4d4]/60 hover:text-slate-100" href="/apps/chat/workflows">
					Back to Workflows
				</a>
			</div>

			{selectedOption ? <WorkflowVersionSelectionSummary option={selectedOption} /> : null}
			<WorkflowVersionDiagnostics diagnostics={picker?.diagnostics ?? []} ariaLabel="Workflow viewer diagnostics" />

			<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-[11px] leading-5 text-slate-500">
				Viewer mode shows registry metadata and navigation context only. To change a child workflow, open its own UI draft or duplicate/edit a published workflow from the Workflow Library.
			</div>
		</div>
	);
}

export function WorkflowVersionSelectionSummary({ option }: { option: WorkflowCatalogVersionRecord }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="font-semibold text-slate-200">Selected workflow: {option.title}</div>
			<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}@{option.version}</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={`${option.source} source`} />
				<WorkflowPill label={option.status} />
				{option.tags.map((tag) => <WorkflowPill key={tag} label={tag} />)}
			</div>
		</div>
	);
}

export function WorkflowVersionOptionCard({ option }: { option: WorkflowCatalogVersionRecord }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.title}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}@{option.version}</div>
				</div>
				<WorkflowPill label="published workflow" />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			<div className="mt-3 flex flex-wrap gap-2 text-[11px]">
				<WorkflowPill label={`${option.source} source`} />
				{option.tags.map((tag) => <WorkflowPill key={tag} label={tag} />)}
			</div>
		</div>
	);
}

export function WorkflowVersionDiagnostics({ diagnostics, ariaLabel }: { diagnostics: WorkflowPickerDiagnostic[]; ariaLabel: string }) {
	if (!diagnostics.length) return null;
	return (
		<div className="grid gap-2" aria-label={ariaLabel}>
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={13} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-1 font-mono text-[11px] text-amber-200/80">{diagnostic.path}</div>
					<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
				</div>
			))}
		</div>
	);
}
