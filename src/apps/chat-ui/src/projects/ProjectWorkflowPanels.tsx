import { AlertTriangle, Layers, Loader2, Lock, Power, Save } from "lucide-react";
import type { WorkflowVersionPickerOption } from "../api-workflows";
import type { PiboProject, PiboProjectSession, WorkflowLifecycleEventRecord } from "../types";

export type WorkflowLifecycleDiagnostic = WorkflowLifecycleEventRecord["diagnostics"][number];
export type WorkflowUiDiagnostic = Partial<WorkflowLifecycleDiagnostic> & { code?: string; message?: string };

export function ProjectWorkflowSessionCreatePanel({
	project,
	options,
	selectedOptionKey,
	titleValue,
	loadState,
	errorMessage,
	creating,
	diagnostics,
	onSelectedOptionChange,
	onTitleChange,
	onCreate,
}: {
	project: PiboProject;
	options: WorkflowVersionPickerOption[];
	selectedOptionKey: string;
	titleValue: string;
	loadState: "loading" | "loaded" | "error";
	errorMessage: string | null;
	creating: boolean;
	diagnostics: WorkflowUiDiagnostic[];
	onSelectedOptionChange: (value: string) => void;
	onTitleChange: (value: string) => void;
	onCreate: () => void;
}) {
	const selectedOption = options.find((option) => workflowVersionOptionKey(option) === selectedOptionKey);
	const disabled = creating || loadState !== "loaded" || !selectedOption || Boolean(project.archivedAt);
	return (
		<section className="rounded-sm border border-slate-800 bg-[#151f24] p-4 shadow-lg shadow-black/10" aria-labelledby="project-workflow-create-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 max-w-2xl">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Layers size={13} />Workflow-backed session</div>
					<h2 id="project-workflow-create-title" className="mt-1 text-sm font-bold text-slate-100">Create workflow Project session</h2>
					<p className="mt-1 text-xs leading-5 text-slate-500">
						Choose a published workflow version from the global catalog and save a configured Project session. Creation does not start a workflow run.
					</p>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-500">
					Project: <span className="text-slate-300">{project.name}</span>
				</div>
			</div>
			<div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_auto] md:items-end">
				<label className="grid gap-1.5 text-xs font-semibold text-slate-300">
					<span>Workflow version</span>
					<select
						aria-label="Workflow version"
						className="rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-[#11a4d4] disabled:opacity-60"
						value={selectedOptionKey}
						onChange={(event) => onSelectedOptionChange(event.target.value)}
						disabled={creating || loadState !== "loaded"}
					>
						<option value="">Select a workflow version</option>
						{options.map((option) => (
							<option key={workflowVersionOptionKey(option)} value={workflowVersionOptionKey(option)}>{workflowVersionOptionLabel(option)}</option>
						))}
					</select>
				</label>
				<label className="grid gap-1.5 text-xs font-semibold text-slate-300">
					<span>Session name</span>
					<input
						aria-label="Workflow session name"
						className="rounded-sm border border-slate-700 bg-[#101d22] px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-[#11a4d4] disabled:opacity-60"
						value={titleValue}
						onChange={(event) => onTitleChange(event.target.value)}
						placeholder="Optional"
						disabled={creating}
					/>
				</label>
				<button
					type="button"
					onClick={onCreate}
					disabled={disabled}
					className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-[#11a4d4]/60 bg-[#11a4d4]/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#11a4d4] transition hover:bg-[#11a4d4]/15 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
				>
					{creating ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
					Save configured session
				</button>
			</div>
			{selectedOption ? (
				<div className="mt-3 rounded-sm border border-slate-800 bg-[#101d22]/70 p-3 text-xs leading-5 text-slate-500">
					<span className="font-semibold text-slate-300">{selectedOption.title}</span> <span className="font-mono text-slate-400">{selectedOption.id}@{selectedOption.version}</span>
					{selectedOption.description ? <span> — {selectedOption.description}</span> : null}
				</div>
			) : null}
			<ProjectWorkflowScopeBoundaryPanel />
			{loadState === "loading" ? <div className="mt-3 text-xs text-slate-500">Loading workflow catalog…</div> : null}
			{loadState === "error" ? <div className="mt-3 rounded-sm border border-red-900/70 bg-red-950/40 p-3 text-xs text-red-200" role="alert">{errorMessage ?? "Failed to load workflow catalog."}</div> : null}
			{diagnostics.length ? <WorkflowDiagnosticsNotice label="Create-blocking diagnostics" diagnostics={diagnostics} /> : null}
		</section>
	);
}

function WorkflowDiagnosticsNotice({ label, diagnostics }: { label: string; diagnostics: WorkflowUiDiagnostic[] }) {
	return (
		<div className="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100" role="alert" aria-label={label}>
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200"><AlertTriangle size={12} />{label}</div>
			<div className="mt-2 space-y-2">
				{diagnostics.map((diagnostic, index) => (
					<div key={`${diagnostic.code ?? "diagnostic"}:${diagnostic.path ?? diagnostic.registryRef ?? diagnostic.nodeId ?? diagnostic.edgeId ?? index}`} className="rounded-sm border border-red-500/25 bg-[#0b0f14]/60 p-2">
						<div className="break-words text-red-100">{diagnostic.message ?? diagnostic.code ?? "Workflow validation blocked this action."}</div>
						<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
							{diagnostic.code ? <span>{diagnostic.code}</span> : null}
							{diagnostic.path ? <span>{diagnostic.path}</span> : null}
							{diagnostic.nodeId ? <span>node:{diagnostic.nodeId}</span> : null}
							{diagnostic.edgeId ? <span>edge:{diagnostic.edgeId}</span> : null}
							{diagnostic.registryRef ? <span>{diagnostic.registryRef}</span> : null}
						</div>
						{diagnostic.hint ? <div className="mt-1 text-[11px] text-red-100/75">{diagnostic.hint}</div> : null}
					</div>
				))}
			</div>
		</div>
	);
}

function ProjectWorkflowScopeBoundaryPanel() {
	return (
		<div className="mt-3 rounded-sm border border-amber-700/60 bg-amber-950/15 p-3 text-[11px] leading-5 text-amber-100/80" aria-label="Project workflow V2 explicit non-goals">
			<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200"><Lock size={12} />V2 scope boundary</div>
			<p className="mt-2">
				Project workflow sessions select published catalog versions and save configured sessions only. They do not expose workflow templates, workflow slash commands, workflow tools for agents, inline TypeScript/JavaScript/shell/eval code, raw XState editing, TypeScript export, YAML/JSON product import/export, or Zod schema authoring.
			</p>
		</div>
	);
}

export function ConfiguredWorkflowStartPanel({
	projectSession,
	lifecycleEvents,
	starting,
	message,
	onStart,
}: {
	projectSession: PiboProjectSession;
	lifecycleEvents: readonly WorkflowLifecycleEventRecord[];
	starting: boolean;
	message: string | null;
	onStart: () => void;
}) {
	const configurationSummary = workflowConfiguredSessionConfigurationSummary(projectSession);
	const validationEvent = latestWorkflowSessionValidationEvent(projectSession.piboSessionId, lifecycleEvents);
	const validation = workflowConfiguredSessionValidationSummary(validationEvent);
	const blockingDiagnostics = latestWorkflowStartBlockingDiagnostics(projectSession.piboSessionId, lifecycleEvents);
	const messageClass = workflowStartPanelMessageClass(message);
	return (
		<section className="rounded-sm border border-[#11a4d4]/35 bg-[#111820] p-4 shadow-lg shadow-black/10" aria-labelledby="project-workflow-start-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 max-w-2xl">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#11a4d4]"><Power size={13} />Configured/not-started</div>
					<h2 id="project-workflow-start-title" className="mt-1 text-sm font-bold text-slate-100">Ready to start workflow</h2>
					<p className="mt-1 text-xs leading-5 text-slate-500">
						This Project session is saved for review. Start explicitly when the configuration is ready.
					</p>
				</div>
				<button
					type="button"
					onClick={onStart}
					disabled={starting}
					className="inline-flex min-h-10 items-center justify-center gap-2 rounded-sm border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/40 disabled:text-slate-500"
				>
					{starting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
					Start workflow
				</button>
			</div>
			<div className="mt-4 grid gap-2 text-xs md:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Workflow</div>
					<div className="mt-1 truncate font-mono text-slate-300" title={projectSession.workflowId}>{projectSession.workflowId}</div>
					{projectSession.workflowVersion ? <div className="mt-1 text-slate-500">version {projectSession.workflowVersion}</div> : null}
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Configuration summary</div>
					<div className="mt-1 text-slate-300">{configurationSummary.primary}</div>
					<div className="mt-1 text-slate-500">{configurationSummary.secondary}</div>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Validation state</div>
					<div className={validation.className}>{validation.label}</div>
					<div className="mt-1 text-slate-500">{validation.description}</div>
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#101d22]/70 p-3">
					<div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Run history</div>
					<div className="mt-1 text-slate-300">No current run attempts</div>
					<div className="mt-1 text-slate-500">No workflow run record exists until Start succeeds.</div>
				</div>
			</div>
			{blockingDiagnostics.length ? (
				<div className="mt-3 rounded-sm border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100" role="alert" aria-label="Start-blocking diagnostics">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-200"><AlertTriangle size={12} />Start-blocking diagnostics</div>
					<div className="mt-2 space-y-2">
						{blockingDiagnostics.map((diagnostic, index) => (
							<div key={`${diagnostic.code}:${diagnostic.path ?? diagnostic.registryRef ?? index}`} className="rounded-sm border border-red-500/25 bg-[#0b0f14]/60 p-2">
								<div className="break-words text-red-100">{diagnostic.message}</div>
								<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
									<span>{diagnostic.code}</span>
									{diagnostic.path ? <span>{diagnostic.path}</span> : null}
									{diagnostic.registryRef ? <span>{diagnostic.registryRef}</span> : null}
								</div>
								{diagnostic.hint ? <div className="mt-1 text-[11px] text-red-100/75">{diagnostic.hint}</div> : null}
							</div>
						))}
					</div>
				</div>
			) : null}
			{message ? <div className={`mt-3 rounded-sm border p-3 text-xs ${messageClass}`} role="status">{message}</div> : null}
		</section>
	);
}

function workflowConfiguredSessionConfigurationSummary(projectSession: PiboProjectSession): { primary: string; secondary: string } {
	const configuration = projectSession.configuration;
	const inputCount = Object.keys(configuration?.inputValues ?? {}).length;
	const promptOverrideCount = Object.keys(configuration?.promptOverrides ?? {}).length;
	const modelLabel = configuration?.model ? `${configuration.model.provider}/${configuration.model.id}` : "default model";
	const thinkingLabel = configuration?.thinkingLevel ? `${configuration.thinkingLevel} thinking` : "default thinking";
	const fastModeLabel = configuration?.fastMode === true ? "fast mode on" : configuration?.fastMode === false ? "fast mode off" : "default speed";
	return {
		primary: `${inputCount} input ${inputCount === 1 ? "value" : "values"} · ${promptOverrideCount} prompt ${promptOverrideCount === 1 ? "override" : "overrides"}`,
		secondary: `${modelLabel} · ${thinkingLabel} · ${fastModeLabel}`,
	};
}

function latestWorkflowSessionValidationEvent(piboSessionId: string, events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleEventRecord | undefined {
	return latestWorkflowLifecycleEvent(events.filter((event) => event.piboSessionId === piboSessionId && Boolean(event.validation)));
}

function latestWorkflowStartBlockingDiagnostics(piboSessionId: string, events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleDiagnostic[] {
	const blockedEvent = latestWorkflowLifecycleEvent(events.filter((event) => event.piboSessionId === piboSessionId && event.type === "project.workflow_start.blocked"));
	return (blockedEvent?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "error");
}

function latestWorkflowLifecycleEvent(events: readonly WorkflowLifecycleEventRecord[]): WorkflowLifecycleEventRecord | undefined {
	return events.reduce<WorkflowLifecycleEventRecord | undefined>((latest, event) => {
		if (!latest) return event;
		return event.createdAt > latest.createdAt ? event : latest;
	}, undefined);
}

function workflowConfiguredSessionValidationSummary(event: WorkflowLifecycleEventRecord | undefined): { label: string; description: string; className: string } {
	if (!event?.validation) {
		return {
			label: "not checked yet",
			description: "Validation runs before Start creates a workflow run.",
			className: "mt-1 text-slate-300",
		};
	}
	const validation = event.validation;
	const counts = `${validation.errorCount} errors · ${validation.warningCount} warnings`;
	if (validation.blocksRun || validation.validationState === "error") {
		return {
			label: `blocked · ${counts}`,
			description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
			className: "mt-1 text-red-200",
		};
	}
	if (validation.validationState === "warning") {
		return {
			label: `warnings · ${counts}`,
			description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
			className: "mt-1 text-amber-200",
		};
	}
	return {
		label: `valid · ${counts}`,
		description: `Last checked ${shortWorkflowTimestamp(validation.checkedAt)} at ${validation.trigger}.`,
		className: "mt-1 text-emerald-200",
	};
}

function workflowStartPanelMessageClass(message: string | null): string {
	if (message?.toLowerCase().includes("blocked")) return "border-red-500/40 bg-red-500/10 text-red-200";
	return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
}

function shortWorkflowTimestamp(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return parsed.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

export function workflowVersionOptionKey(option: WorkflowVersionPickerOption): string {
	return `${option.id}@${option.version}`;
}

function workflowVersionOptionLabel(option: WorkflowVersionPickerOption): string {
	return `${option.title} (${option.id}@${option.version})`;
}

export function workflowDiagnosticsFromError(caught: unknown): WorkflowUiDiagnostic[] {
	if (!caught || typeof caught !== "object" || !("data" in caught)) return [];
	const data = (caught as { data?: unknown }).data;
	if (!data || typeof data !== "object" || !("diagnostics" in data)) return [];
	const diagnostics = (data as { diagnostics?: unknown }).diagnostics;
	if (!Array.isArray(diagnostics)) return [];
	return diagnostics.filter((diagnostic): diagnostic is WorkflowUiDiagnostic => Boolean(diagnostic) && typeof diagnostic === "object");
}
