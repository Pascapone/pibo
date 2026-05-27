import { AlertTriangle } from "lucide-react";
import type { WorkflowDraftDiagnostic } from "../api-workflows";

export function WorkflowInspectorDiagnostics({ diagnostics, emptyLabel }: { diagnostics: WorkflowDraftDiagnostic[]; emptyLabel: string }) {
	if (!diagnostics.length) {
		return <div className="rounded-sm border border-slate-800 bg-[#101d22] p-2 text-[11px] text-slate-500">{emptyLabel}</div>;
	}
	return (
		<div className="grid gap-2" aria-label="Inspector diagnostics">
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.nodeId ?? diagnostic.edgeId ?? diagnostic.registryRef ?? diagnostic.message}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-2 text-[11px] leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={12} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					{diagnostic.path ? <div className="mt-1 font-mono text-amber-200/80">{diagnostic.path}</div> : null}
					{diagnostic.hint ? <div className="mt-1 text-amber-200/80">{diagnostic.hint}</div> : null}
				</div>
			))}
		</div>
	);
}

export function WorkflowPill({ label }: { label: string }) {
	return <span className="rounded-full border border-slate-700 bg-[#101d22] px-2 py-0.5 text-slate-400">{label}</span>;
}
