import { AlertTriangle } from "lucide-react";
import type { WorkflowPickerDiagnostic, WorkflowRegisteredRefOption } from "../api-workflows";
import { WorkflowPill } from "./workflow-shared-ui";

export function WorkflowInspectorPickerDiagnostics({ diagnostics }: { diagnostics: WorkflowPickerDiagnostic[] }) {
	if (!diagnostics.length) return null;
	return (
		<div className="grid gap-2" aria-label="Inspector picker diagnostics">
			{diagnostics.map((diagnostic) => (
				<div key={`${diagnostic.code}:${diagnostic.registryRef}`} className="rounded-sm border border-amber-700/70 bg-amber-950/30 p-2 text-[11px] leading-5 text-amber-100">
					<div className="flex items-center gap-2 font-bold text-amber-200"><AlertTriangle size={12} />{diagnostic.code}</div>
					<div className="mt-1">{diagnostic.message}</div>
					<div className="mt-1 font-mono text-amber-200/80">{diagnostic.path}</div>
					<div className="mt-1 text-amber-200/80">{diagnostic.hint}</div>
				</div>
			))}
		</div>
	);
}

export function RegisteredRefOptionCard({ option, badge }: { option: WorkflowRegisteredRefOption; badge: string }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#151f24]/70 p-3 text-xs leading-5 text-slate-400">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<div className="font-semibold text-slate-200">{option.displayName}</div>
					<div className="mt-1 font-mono text-[11px] text-slate-300">{option.id}</div>
				</div>
				<WorkflowPill label={badge} />
			</div>
			{option.description ? <div className="mt-2 text-slate-500">{option.description}</div> : null}
			{option.paramsSchema ? <div className="mt-3"><HandlerSchemaPreview label="paramsSchema" schema={option.paramsSchema} /></div> : null}
		</div>
	);
}

export function HandlerSchemaPreview({ label, schema }: { label: string; schema: Record<string, unknown> | null }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#101d22] p-2">
			<div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
			<pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-300">{formatNullableSchema(schema)}</pre>
		</div>
	);
}

function formatNullableSchema(schema: Record<string, unknown> | null): string {
	return schema ? JSON.stringify(schema, null, 2) : "null";
}
