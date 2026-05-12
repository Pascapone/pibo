import type { ReactNode } from "react";
import { Activity, AlertTriangle, CheckCircle2, Circle, Clock3, Database, ExternalLink, GitBranch, History, Layers3, ListChecks, Route, XCircle } from "lucide-react";
import { JsonRenderer } from "../tracing/JsonRenderer";
import type { PiboProjectSession, PiboProjectWorkflowDefinitionLink, PiboSessionSignalSnapshot, PiboSessionTraceView, PiboTraceNode, PiboWebSessionNode, PiboWebSessionStatus, WorkflowLifecycleEventRecord } from "../types";
import type { ChatSessionViewProps } from "./types";

type WorkflowNodeStatus = "idle" | "active" | "waiting" | "completed" | "failed" | "cancelled";

type WorkflowVisualNode = {
	id: string;
	label: string;
	kind: string;
	status: WorkflowNodeStatus;
	description: string;
};

type WorkflowVisualEdge = {
	id: string;
	source: string;
	target: string;
	label: string;
};

type WorkflowFinalOutput = {
	value: unknown;
	source: string;
};

type WorkflowValidationError = {
	id: string;
	message: string;
	code?: string;
	path?: string;
	source?: string;
};

type WorkflowRunHistoryEntry = {
	id: string;
	status: string;
	currentNodeId?: string;
	updatedAt: string;
	source: string;
};

type WorkflowNodeAttemptSummary = {
	id: string;
	nodeId: string;
	label: string;
	kind: string;
	status: string;
	attempt: number;
	source: string;
	startedAt?: string;
	completedAt?: string;
};

type WorkflowEdgeTransferSummary = {
	id: string;
	edgeId: string;
	status: string;
	source: string;
	createdAt?: string;
};

type WorkflowRuntimeErrorSummary = {
	id: string;
	message: string;
	code?: string;
	source?: string;
};

export function WorkflowXStateSessionView({
	traceView,
	isLoading,
	selectedSessionStatus,
	selectedSessionSignal,
	workflowProjectSession,
	workflowLifecycleEvents,
	sessionNodes,
	onOpenSession,
}: ChatSessionViewProps) {
	const workflowModel = workflowProjectSession ? createProjectSessionWorkflowModel(workflowProjectSession, traceView, selectedSessionStatus, selectedSessionSignal, workflowLifecycleEvents ?? [], sessionNodes) : null;

	if (!workflowModel) {
		return (
			<section className="min-w-0 flex-1 overflow-auto bg-[#0b0f14] p-4 text-slate-300">
				<div className="mx-auto flex max-w-4xl flex-col gap-4">
					<div className="rounded-sm border border-slate-800 bg-[#111820] p-4">
						<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
							<Layers3 size={16} className="text-[#11a4d4]" />
							Workflow / XState
						</div>
						<p className="mt-2 text-sm text-slate-400">
							{isLoading ? "Loading session trace…" : "This session is not linked to a workflow run, so no Workflow/XState projection is available."}
						</p>
					</div>
					<WorkflowProjectionBoundaryNotice />
				</div>
			</section>
		);
	}

	return (
		<section className="min-w-0 flex-1 overflow-auto bg-[#0b0f14] p-4 text-slate-300">
			<div className="mx-auto flex max-w-6xl flex-col gap-4">
				<WorkflowSummaryCard model={workflowModel} />
				<WorkflowProjectionBoundaryNotice />
				<WorkflowExecutionShell model={workflowModel} />
				<WorkflowRunInspectionPanel model={workflowModel} />
				<WorkflowNavigationLinks model={workflowModel} onOpenSession={onOpenSession} />
				<WorkflowGraph nodes={workflowModel.nodes} edges={workflowModel.edges} />
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
					<WorkflowRuntimeSnapshot model={workflowModel} />
					<div className="flex min-w-0 flex-col gap-4">
						<WorkflowNodeStatusList model={workflowModel} />
						<WorkflowResultAndValidationPanel model={workflowModel} />
						<WorkflowProjectionFacts model={workflowModel} />
					</div>
				</div>
			</div>
		</section>
	);
}

type WorkflowConfigurationSummary = {
	inputKeys: string[];
	promptOverrideNodeIds: string[];
};

type WorkflowPendingHumanAction = {
	id: string;
	label: string;
	source: string;
};

type WorkflowNestedSessionLink = {
	piboSessionId: string;
	title: string;
	kind: string;
	workflowSessionKind?: PiboWebSessionNode["workflowSessionKind"];
};

type WorkflowProjectSessionUiModel = {
	workflowId: string;
	workflowVersion?: string;
	workflowRunId?: string;
	piboSessionId: string;
	state: string;
	status: WorkflowNodeStatus;
	traceTitle?: string;
	traceVersion?: string;
	latestStreamId?: number;
	nodes: WorkflowVisualNode[];
	edges: WorkflowVisualEdge[];
	configuration: WorkflowConfigurationSummary;
	definitionLink: PiboProjectWorkflowDefinitionLink;
	nestedSessionLinks: WorkflowNestedSessionLink[];
	pendingHumanActions: WorkflowPendingHumanAction[];
	runHistory: WorkflowRunHistoryEntry[];
	nodeAttempts: WorkflowNodeAttemptSummary[];
	edgeTransfers: WorkflowEdgeTransferSummary[];
	runtimeErrors: WorkflowRuntimeErrorSummary[];
	finalOutput?: WorkflowFinalOutput;
	validationErrors: WorkflowValidationError[];
	snapshot: Record<string, unknown>;
};

function WorkflowSummaryCard({ model }: { model: WorkflowProjectSessionUiModel }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#111820] p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
						<Layers3 size={16} className="text-[#11a4d4]" />
						Workflow / XState Projection
					</div>
					<div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
						<WorkflowBadge tone="blue">{model.workflowId}</WorkflowBadge>
						{model.workflowRunId ? <WorkflowBadge tone="slate">run {shortWorkflowValue(model.workflowRunId)}</WorkflowBadge> : null}
						<WorkflowBadge tone={badgeToneForStatus(model.status)}>{model.state}</WorkflowBadge>
					</div>
				</div>
				<div className="min-w-0 text-right font-mono text-[11px] text-slate-500">
					<div className="truncate">session {shortWorkflowValue(model.piboSessionId)}</div>
					{model.latestStreamId !== undefined ? <div>stream {model.latestStreamId}</div> : null}
				</div>
			</div>
			<p className="mt-3 text-sm text-slate-400">
				Dedicated Project workflow execution surface. This view derives the current XState-style UI snapshot from project-session workflow linkage and live session state while keeping kernel records as durable truth.
			</p>
		</div>
	);
}

function WorkflowProjectionBoundaryNotice() {
	return (
		<div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-200">
						<AlertTriangle size={14} />
						Workflow IR source-of-truth boundary
					</div>
					<p className="mt-2 max-w-3xl text-xs leading-5 text-amber-100/80">
						Projects inspect configured sessions, workflow runs, and the XState-style projection derived from Pibo Workflow IR. Authoring stays in the Workflows tab; raw XState editing and inline executable code are not exposed here.
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap gap-2">
					<span className="rounded border border-amber-500/40 bg-[#0b0f14]/50 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100/80">IR: source of truth</span>
					<span className="rounded border border-amber-500/40 bg-[#0b0f14]/50 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100/80">XState: projection only</span>
				</div>
			</div>
		</div>
	);
}

function WorkflowExecutionShell({ model }: { model: WorkflowProjectSessionUiModel }) {
	const activeNode = currentWorkflowNode(model);
	const selectedWorkflow = `${model.workflowId}${model.workflowVersion ? `@${model.workflowVersion}` : ""}`;
	return (
		<div className="grid gap-4 lg:grid-cols-3" aria-label="Projects workflow execution shell">
			<WorkflowShellCard title="Workflow configured-session view" icon={<ListChecks size={14} />}>
				<div className="space-y-3 text-xs text-slate-400">
					<WorkflowShellFact label="selected workflow" value={selectedWorkflow} />
					<WorkflowShellFact label="session state" value={model.workflowRunId ? "started" : "configured/not-started"} />
					<WorkflowShellFact label="input keys" value={String(model.configuration.inputKeys.length)} />
					<WorkflowShellFact label="prompt overrides" value={String(model.configuration.promptOverrideNodeIds.length)} />
					<p className="leading-5 text-slate-500">
						Saved configuration is reviewed here before Start. Workflow selection and session overrides remain immutable for this configured Project session.
					</p>
				</div>
			</WorkflowShellCard>
			<WorkflowShellCard title="Workflow run view" icon={<Activity size={14} />}>
				<div className="space-y-3 text-xs text-slate-400">
					<WorkflowShellFact label="run id" value={model.workflowRunId ? shortWorkflowValue(model.workflowRunId) : "not started"} />
					<WorkflowShellFact label="status" value={model.state} />
					<WorkflowShellFact label="current node" value={activeNode?.label ?? "none"} />
					<WorkflowShellFact label="output" value={model.finalOutput ? "available" : "empty"} />
					<WorkflowShellFact label="error" value={model.runtimeErrors.length ? `${model.runtimeErrors.length} runtime errors` : model.validationErrors.length ? `${model.validationErrors.length} validation diagnostics` : "none"} />
					<p className="leading-5 text-slate-500">
						This workflow run view container is the stable Project home for status, current node, output, and error sections.
					</p>
				</div>
			</WorkflowShellCard>
			<WorkflowShellCard title="Human action area" icon={<Clock3 size={14} />}>
				<div className="space-y-3 text-xs text-slate-400">
					{model.pendingHumanActions.length ? (
						<div className="space-y-2">
							{model.pendingHumanActions.map((action) => (
								<div key={action.id} className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-2 text-amber-100">
									<div className="font-semibold">{action.label}</div>
									<div className="mt-1 font-mono text-[10px] text-amber-100/70">{action.source}</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-sm border border-slate-800 bg-[#0b0f14] p-3 text-slate-500">
							No pending human action. Approval, rejection, resume, and cancel controls will render here when a workflow wait token exists.
						</div>
					)}
					<p className="leading-5 text-slate-500">
						This human action area lives inside the workflow run context and stays separate from normal Terminal chat controls.
					</p>
				</div>
			</WorkflowShellCard>
		</div>
	);
}

function WorkflowRunInspectionPanel({ model }: { model: WorkflowProjectSessionUiModel }) {
	const activeNode = currentWorkflowNode(model);
	const displayedErrors = [
		...model.runtimeErrors.map((error) => ({ ...error, source: error.source ?? "runtime" })),
		...model.validationErrors.map((error) => ({ ...error, source: error.source ?? "validation" })),
	].slice(0, 8);
	return (
		<section className="rounded-sm border border-slate-800 bg-[#111820] p-4 text-sm" aria-label="Workflow run inspection panel">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
						<Database size={14} />
						Workflow run inspection
					</div>
					<p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
						Status, current node, history, attempts, transfers, output, and errors are rendered from Project session and workflow run facts when a run is linked. The XState graph remains a visualization projection only.
					</p>
				</div>
				<div className="flex shrink-0 flex-wrap gap-2 text-[10px] uppercase tracking-wide">
					<span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-200">kernel/run records: truth</span>
					<span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-100">XState projection only</span>
				</div>
			</div>
			<div className="mt-4 grid gap-3 lg:grid-cols-3">
				<WorkflowInspectionSection title="Status" badge={model.state} icon={<Activity size={14} />}>
					<WorkflowInspectionFact label="run id" value={model.workflowRunId ? shortWorkflowValue(model.workflowRunId) : "not started"} />
					<WorkflowInspectionFact label="status" value={model.state} />
					<WorkflowInspectionFact label="record source" value={model.workflowRunId ? "Project workflow run id" : "no run record yet"} />
				</WorkflowInspectionSection>
				<WorkflowInspectionSection title="Current node" badge={activeNode?.status ?? "none"} icon={<Route size={14} />}>
					<WorkflowInspectionFact label="node" value={activeNode?.label ?? "none"} />
					<WorkflowInspectionFact label="node id" value={activeNode?.id ?? "none"} />
					<WorkflowInspectionFact label="source" value="project/session run cursor" />
				</WorkflowInspectionSection>
				<WorkflowInspectionSection title="Run history" badge={`${model.runHistory.length}`} icon={<History size={14} />}>
					{model.runHistory.length ? (
						<div className="space-y-2">
							{model.runHistory.map((run) => (
								<div key={run.id} className="rounded-sm border border-slate-800 bg-[#0b0f14] p-2">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 truncate font-mono text-xs text-slate-200">{shortWorkflowValue(run.id)}</div>
										<span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${workflowFactStatusClass(run.status)}`}>{run.status}</span>
									</div>
									<div className="mt-1 text-[11px] text-slate-500">{run.currentNodeId ? `current ${run.currentNodeId}` : "no current node"} · {run.source}</div>
									<div className="mt-1 font-mono text-[10px] text-slate-600">updated {run.updatedAt}</div>
								</div>
							))}
						</div>
					) : (
						<WorkflowEmptyState>No workflow run history for this selected Project session yet.</WorkflowEmptyState>
					)}
				</WorkflowInspectionSection>
			</div>
			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<WorkflowInspectionSection title="Node attempts" badge={`${model.nodeAttempts.length}`} icon={<ListChecks size={14} />}>
					{model.nodeAttempts.length ? (
						<div className="space-y-2">
							{model.nodeAttempts.map((attempt) => (
								<div key={attempt.id} className="rounded-sm border border-slate-800 bg-[#0b0f14] p-2">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate text-xs font-semibold text-slate-200">{attempt.label}</div>
											<div className="mt-1 font-mono text-[10px] text-slate-500">{attempt.nodeId} · attempt {attempt.attempt}</div>
										</div>
										<span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${workflowFactStatusClass(attempt.status)}`}>{attempt.status}</span>
									</div>
									<div className="mt-1 text-[11px] text-slate-500">{attempt.kind} · {attempt.source}</div>
								</div>
							))}
						</div>
					) : (
						<WorkflowEmptyState>No node attempts recorded for this workflow run yet.</WorkflowEmptyState>
					)}
				</WorkflowInspectionSection>
				<WorkflowInspectionSection title="Edge transfers" badge={`${model.edgeTransfers.length}`} icon={<GitBranch size={14} />}>
					{model.edgeTransfers.length ? (
						<div className="space-y-2">
							{model.edgeTransfers.map((transfer) => (
								<div key={transfer.id} className="rounded-sm border border-slate-800 bg-[#0b0f14] p-2">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 truncate font-mono text-xs text-slate-200">{transfer.edgeId}</div>
										<span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${workflowFactStatusClass(transfer.status)}`}>{transfer.status}</span>
									</div>
									<div className="mt-1 text-[11px] text-slate-500">{transfer.source}{transfer.createdAt ? ` · ${transfer.createdAt}` : ""}</div>
								</div>
							))}
						</div>
					) : (
						<WorkflowEmptyState>No edge transfers recorded for this workflow run yet.</WorkflowEmptyState>
					)}
				</WorkflowInspectionSection>
				<WorkflowInspectionSection title="Output" badge={model.finalOutput ? "available" : "empty"} icon={<CheckCircle2 size={14} />}>
					{model.finalOutput ? (
						<div className="rounded-sm border border-slate-800 bg-[#0b0f14] p-2">
							<div className="mb-2 font-mono text-[10px] text-slate-500">{model.finalOutput.source}</div>
							<JsonRenderer value={model.finalOutput.value} defaultExpandLevel={1} maxHeight="12rem" showControls={false} />
						</div>
					) : (
						<WorkflowEmptyState>No workflow output has been recorded for this run yet.</WorkflowEmptyState>
					)}
				</WorkflowInspectionSection>
				<WorkflowInspectionSection title="Error" badge={displayedErrors.length ? `${displayedErrors.length}` : "none"} icon={<AlertTriangle size={14} />}>
					{displayedErrors.length ? (
						<div className="space-y-2">
							{displayedErrors.map((error) => (
								<div key={error.id} className="rounded-sm border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-100">
									<div className="break-words">{error.message}</div>
									<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
										{error.code ? <span>{error.code}</span> : null}
										{error.source ? <span>{error.source}</span> : null}
									</div>
								</div>
							))}
						</div>
					) : (
						<WorkflowEmptyState>No workflow run errors are recorded.</WorkflowEmptyState>
					)}
				</WorkflowInspectionSection>
			</div>
		</section>
	);
}

function WorkflowNavigationLinks({ model, onOpenSession }: { model: WorkflowProjectSessionUiModel; onOpenSession: (piboSessionId: string) => void }) {
	const definitionHref = workflowDefinitionLinkHref(model.definitionLink);
	return (
		<section className="rounded-sm border border-slate-800 bg-[#111820] p-4 text-sm" aria-label="Workflow navigation links">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
						<ExternalLink size={14} />
						Workflow navigation links
					</div>
					<p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">
						Use these run-view links to move between real nested workflow sessions and the Workflows tab definition. Snapshot-only history is shown when the live definition is deleted or unavailable.
					</p>
				</div>
				{model.definitionLink.status === "live" && definitionHref ? (
					<a
						className="inline-flex shrink-0 items-center justify-center gap-1 rounded-sm border border-[#11a4d4]/50 px-3 py-1.5 text-xs font-semibold text-[#8bdcf4] transition hover:border-[#11a4d4] hover:text-slate-100"
						href={definitionHref}
					>
						<ExternalLink size={13} />
						Open live workflow definition
					</a>
				) : null}
			</div>
			<div className="mt-4 grid gap-3 lg:grid-cols-2">
				<div className="rounded-sm border border-slate-800 bg-[#0f171e] p-3" aria-label="Nested workflow child session links">
					<div className="mb-3 flex items-center justify-between gap-2">
						<div className="text-xs font-bold uppercase tracking-wider text-slate-500">Nested workflow child sessions</div>
						<span className="rounded border border-slate-700 bg-[#0b0f14] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{model.nestedSessionLinks.length}</span>
					</div>
					{model.nestedSessionLinks.length ? (
						<div className="space-y-2">
							{model.nestedSessionLinks.map((link) => (
								<button
									key={link.piboSessionId}
									type="button"
									onClick={() => onOpenSession(link.piboSessionId)}
									className="w-full rounded-sm border border-slate-800 bg-[#0b0f14] p-2 text-left transition hover:border-[#11a4d4]/60 hover:bg-[#102331]"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate text-xs font-semibold text-slate-200">{link.title}</div>
											<div className="mt-1 font-mono text-[10px] text-slate-500">{shortWorkflowValue(link.piboSessionId)}</div>
										</div>
										<span className="rounded border border-[#11a4d4]/40 bg-[#11a4d4]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#8bdcf4]">open session</span>
									</div>
								</button>
							))}
						</div>
					) : (
						<WorkflowEmptyState>No nested workflow child sessions are linked under this selected Project session yet.</WorkflowEmptyState>
					)}
				</div>
				<div className="rounded-sm border border-slate-800 bg-[#0f171e] p-3" aria-label="Workflow definition link state">
					<div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Workflow definition link</div>
					{model.definitionLink.status === "live" && definitionHref ? (
						<div className="rounded-sm border border-emerald-500/35 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-100">
							<div className="font-semibold">Live workflow definition exists</div>
							<div className="mt-1 font-mono text-[11px] text-emerald-100/80">{workflowDefinitionRefLabel(model.definitionLink)}</div>
							{model.definitionLink.definitionHash ? <div className="mt-1 font-mono text-[10px] text-emerald-100/60">snapshot {shortWorkflowValue(model.definitionLink.definitionHash)}</div> : null}
						</div>
					) : (
						<div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
							<div className="font-semibold">Definition deleted — snapshot-only definition-deleted state</div>
							<div className="mt-1 font-mono text-[11px] text-amber-100/80">{workflowDefinitionRefLabel(model.definitionLink)}</div>
							<div className="mt-1 text-amber-100/80">{model.definitionLink.tombstoneLabel ?? "Historical run inspection uses the immutable Project session snapshot instead of a broken live definition link."}</div>
							{model.definitionLink.definitionHash ? <div className="mt-1 font-mono text-[10px] text-amber-100/60">snapshot {shortWorkflowValue(model.definitionLink.definitionHash)}</div> : null}
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

function WorkflowInspectionSection({ title, badge, icon, children }: { title: string; badge: string; icon: ReactNode; children: ReactNode }) {
	return (
		<section className="min-w-0 rounded-sm border border-slate-800 bg-[#0f171e] p-3" aria-label={title}>
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
					<span className="text-[#11a4d4]">{icon}</span>
					{title}
				</div>
				<span className="shrink-0 rounded border border-slate-700 bg-[#0b0f14] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{badge}</span>
			</div>
			{children}
		</section>
	);
}

function WorkflowInspectionFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-slate-800/70 py-2 first:pt-0 last:border-b-0 last:pb-0">
			<span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
			<span className="min-w-0 max-w-[14rem] truncate text-right font-mono text-xs text-slate-300" title={value}>{value}</span>
		</div>
	);
}

function WorkflowEmptyState({ children }: { children: ReactNode }) {
	return <div className="rounded-sm border border-dashed border-slate-800 bg-[#0b0f14] p-3 text-xs leading-5 text-slate-500">{children}</div>;
}

function WorkflowShellCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
	return (
		<section className="rounded-sm border border-slate-800 bg-[#111820] p-4" aria-label={title}>
			<div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
				<span className="text-[#11a4d4]">{icon}</span>
				{title}
			</div>
			{children}
		</section>
	);
}

function WorkflowShellFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-start justify-between gap-3 border-b border-slate-800/70 pb-2 last:border-b-0 last:pb-0">
			<span className="uppercase tracking-wide text-slate-500">{label}</span>
			<span className="min-w-0 max-w-[12rem] truncate text-right font-mono text-slate-300" title={value}>{value}</span>
		</div>
	);
}

function currentWorkflowNode(model: WorkflowProjectSessionUiModel): WorkflowVisualNode | undefined {
	return model.nodes.find((node) => node.status === "active" || node.status === "waiting") ?? model.nodes[0];
}

function WorkflowGraph({ nodes, edges }: { nodes: WorkflowVisualNode[]; edges: WorkflowVisualEdge[] }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#0f171e] p-4">
			<div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
				<Route size={14} />
				Visual State Flow
			</div>
			<div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
				{nodes.map((node, index) => (
					<WorkflowGraphItem key={node.id} node={node} edge={edges[index]} />
				))}
			</div>
		</div>
	);
}

function WorkflowGraphItem({ node, edge }: { node: WorkflowVisualNode; edge?: WorkflowVisualEdge }) {
	return (
		<>
			<div className={`rounded-sm border p-3 ${nodeCardClass(node.status)}`}>
				<div className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2">
						<WorkflowStatusIcon status={node.status} />
						<div className="min-w-0 truncate text-sm font-semibold text-slate-100">{node.label}</div>
					</div>
					<span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{node.kind}</span>
				</div>
				<p className="mt-2 text-xs text-slate-400">{node.description}</p>
			</div>
			{edge ? (
				<div className="hidden items-center justify-center text-center text-[10px] uppercase tracking-wide text-slate-500 md:flex">
					<div>
						<GitBranch size={14} className="mx-auto mb-1 text-[#11a4d4]" />
						{edge.label}
					</div>
				</div>
			) : null}
		</>
	);
}

function WorkflowRuntimeSnapshot({ model }: { model: WorkflowProjectSessionUiModel }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#111820] p-4">
			<div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
				<Activity size={14} />
				Current UI Snapshot
			</div>
			<JsonRenderer value={model.snapshot} showControls={false} />
		</div>
	);
}

function WorkflowNodeStatusList({ model }: { model: WorkflowProjectSessionUiModel }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#111820] p-4 text-sm">
			<div className="mb-3 flex items-center justify-between gap-3">
				<div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
					<ListChecks size={14} />
					Node Statuses
				</div>
				<span className="font-mono text-[11px] text-slate-500">{model.nodes.length} nodes</span>
			</div>
			<div className="space-y-2">
				{model.nodes.map((node) => (
					<div key={node.id} className={`rounded-sm border px-3 py-2 ${nodeCardClass(node.status)}`}>
						<div className="flex min-w-0 items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-2">
								<span className="mt-0.5 shrink-0"><WorkflowStatusIcon status={node.status} /></span>
								<div className="min-w-0">
									<div className="truncate text-sm font-semibold text-slate-100">{node.label}</div>
									<div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{node.id}</div>
								</div>
							</div>
							<div className="flex shrink-0 flex-col items-end gap-1">
								<span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${statusTextClass(node.status)}`}>{node.status}</span>
								<span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{node.kind}</span>
							</div>
						</div>
						<p className="mt-2 text-xs text-slate-400">{node.description}</p>
					</div>
				))}
			</div>
			<p className="mt-3 text-xs text-slate-500">
				Node status is reconstructed from the workflow run linkage and live session state; persisted kernel records remain the durable source of truth.
			</p>
		</div>
	);
}

function WorkflowResultAndValidationPanel({ model }: { model: WorkflowProjectSessionUiModel }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#111820] p-4 text-sm">
			<div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
				<CheckCircle2 size={14} />
				Final Output & Validation
			</div>
			<div className="space-y-4">
				<div>
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Final output</div>
						{model.finalOutput ? <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{model.finalOutput.source}</span> : null}
					</div>
					{model.finalOutput ? (
						<div className="rounded-sm border border-slate-800 bg-[#0b0f14] p-2">
							<JsonRenderer value={model.finalOutput.value} defaultExpandLevel={1} maxHeight="14rem" showControls={false} />
						</div>
					) : (
						<div className="rounded-sm border border-slate-800 bg-[#0b0f14] p-3 text-xs text-slate-500">
							No final workflow output is available yet. Completed workflow-backed sessions show the final assistant output here.
						</div>
					)}
				</div>
				<div>
					<div className="mb-2 flex items-center justify-between gap-2">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Validation errors</div>
						<span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${model.validationErrors.length ? "border-red-500/40 bg-red-500/10 text-red-300" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"}`}>
							{model.validationErrors.length ? `${model.validationErrors.length} found` : "none"}
						</span>
					</div>
					{model.validationErrors.length ? (
						<div className="space-y-2">
							{model.validationErrors.map((error) => (
								<div key={error.id} className="rounded-sm border border-red-500/35 bg-red-500/10 p-2">
									<div className="flex min-w-0 items-start gap-2 text-xs text-red-200">
										<AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-300" />
										<div className="min-w-0">
											<div className="break-words">{error.message}</div>
											<div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px] text-red-200/70">
												{error.code ? <span>{error.code}</span> : null}
												{error.path ? <span>{error.path}</span> : null}
												{error.source ? <span>{error.source}</span> : null}
											</div>
										</div>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="rounded-sm border border-slate-800 bg-[#0b0f14] p-3 text-xs text-slate-500">
							No workflow validation diagnostics were found in the current session trace.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function WorkflowProjectionFacts({ model }: { model: WorkflowProjectSessionUiModel }) {
	return (
		<div className="rounded-sm border border-slate-800 bg-[#111820] p-4 text-sm">
			<div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
				<Circle size={14} />
				Projection Facts
			</div>
			<dl className="space-y-3">
				<WorkflowFact label="projection kind" value="pibo.workflow.xstateUiModel" />
				<WorkflowFact label="schema" value="v1" />
				<WorkflowFact label="durable truth" value="kernel" />
				<WorkflowFact label="private payloads" value="not exposed" />
				<WorkflowFact label="states" value={String(model.nodes.length)} />
				<WorkflowFact label="transitions" value={String(model.edges.length)} />
				<WorkflowFact label="trace" value={model.traceVersion ?? "pending"} />
			</dl>
		</div>
	);
}

function WorkflowFact({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-3 border-b border-slate-800/70 pb-2 last:border-b-0 last:pb-0">
			<dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
			<dd className="min-w-0 truncate text-right font-mono text-xs text-slate-300">{value}</dd>
		</div>
	);
}

function createProjectSessionWorkflowModel(
	projectSession: PiboProjectSession,
	traceView: PiboSessionTraceView | null,
	selectedSessionStatus: PiboWebSessionStatus | undefined,
	selectedSessionSignal: PiboSessionSignalSnapshot | undefined,
	workflowLifecycleEvents: readonly WorkflowLifecycleEventRecord[],
	sessionNodes: readonly PiboWebSessionNode[],
): WorkflowProjectSessionUiModel | null {
	if (!isWorkflowBackedProjectSession(projectSession)) return null;
	const state = workflowStateLabel(projectSession, selectedSessionStatus);
	const status = workflowNodeStatus(projectSession, selectedSessionStatus);
	const activeStateId = stateIdForStatus(status);
	const finalOutput = collectWorkflowFinalOutput(traceView, status);
	const validationErrors = [
		...collectWorkflowValidationErrors(traceView),
		...collectWorkflowLifecycleValidationErrors(projectSession, workflowLifecycleEvents),
	];
	const runHistory = collectWorkflowRunHistory(projectSession, state, activeStateId);
	const nodeAttempts = collectWorkflowNodeAttempts(traceView, projectSession.workflowRunId);
	const edgeTransfers = collectWorkflowEdgeTransfers(traceView, projectSession.workflowRunId);
	const runtimeErrors = collectWorkflowRuntimeErrors(traceView, selectedSessionSignal);
	const definitionLink = resolveWorkflowDefinitionLink(projectSession);
	const nestedSessionLinks = collectNestedWorkflowSessionLinks(sessionNodes, projectSession.piboSessionId);
	const nodes: WorkflowVisualNode[] = [
		{
			id: "workflow.entry",
			label: "workflow entry",
			kind: "initial",
			status: status === "idle" ? "active" : "completed",
			description: "Project session is linked to a workflow-capable route.",
		},
		{
			id: "node.session",
			label: traceView?.title ?? "pibo session actor",
			kind: "agent",
			status: activeStateId === "node.session" ? status : status === "completed" ? "completed" : "idle",
			description: "Normal Pibo routed session used as the visible workflow actor.",
		},
		{
			id: terminalStateIdForStatus(status),
			label: terminalLabelForStatus(status),
			kind: "terminal",
			status: activeStateId.startsWith("workflow.") ? status : "idle",
			description: "Terminal state projected from the current workflow/session state.",
		},
	];
	return {
		workflowId: projectSession.workflowId,
		...(projectSession.workflowVersion ? { workflowVersion: projectSession.workflowVersion } : {}),
		...(projectSession.workflowRunId ? { workflowRunId: projectSession.workflowRunId } : {}),
		piboSessionId: projectSession.piboSessionId,
		state,
		status,
		traceTitle: traceView?.title,
		traceVersion: traceView?.version,
		latestStreamId: traceView?.latestStreamId,
		nodes,
		edges: [
			{ id: "workflow.transition.entry.session", source: "workflow.entry", target: "node.session", label: "WORKFLOW.START" },
			{ id: "workflow.transition.session.terminal", source: "node.session", target: terminalStateIdForStatus(status), label: terminalEventForStatus(status) },
		],
		configuration: summarizeWorkflowConfiguration(projectSession),
		definitionLink,
		nestedSessionLinks,
		pendingHumanActions: collectPendingHumanActions(projectSession, selectedSessionSignal),
		runHistory,
		nodeAttempts,
		edgeTransfers,
		runtimeErrors,
		...(finalOutput ? { finalOutput } : {}),
		validationErrors,
		snapshot: {
			kind: "pibo.workflow.xstateUiModel",
			schemaVersion: 1,
			projection: {
				workflowId: projectSession.workflowId,
				initialStateId: "workflow.entry",
				durableTruth: "kernel",
				exposesPrivatePayloads: false,
			},
			authoring: {
				location: "workflows_tab",
				rawXStateEditingUi: "not_exposed",
				inlineExecutableCodeUi: "not_exposed",
			},
			current: {
				snapshotKind: "ui",
				...(projectSession.workflowRunId ? { runId: projectSession.workflowRunId } : {}),
				status: state,
				stateIds: [activeStateId],
				nodeId: activeStateId === "node.session" ? "session" : undefined,
			},
			nodeStatuses: nodes.map((node) => ({ id: node.id, kind: node.kind, status: node.status })),
			runInspection: {
				durableTruth: "kernel_run_records",
				xstateProjectionOnly: true,
				runHistoryCount: runHistory.length,
				nodeAttemptCount: nodeAttempts.length,
				edgeTransferCount: edgeTransfers.length,
				runtimeErrorCount: runtimeErrors.length,
			},
			result: {
				hasFinalOutput: Boolean(finalOutput),
				validationErrorCount: validationErrors.length,
			},
			actors: [{ id: "workflow.actor.session", kind: "agent", piboSessionId: projectSession.piboSessionId }],
			definitionLink: {
				status: definitionLink.status,
				workflowId: definitionLink.workflowId,
				workflowVersion: definitionLink.workflowVersion,
				hasLiveLink: definitionLink.status === "live" && Boolean(workflowDefinitionLinkHref(definitionLink)),
			},
			nestedWorkflowSessionCount: nestedSessionLinks.length,
		},
	};
}

function resolveWorkflowDefinitionLink(projectSession: PiboProjectSession): PiboProjectWorkflowDefinitionLink {
	if (projectSession.workflowDefinitionLink) return projectSession.workflowDefinitionLink;
	if (projectSession.workflowVersion) {
		return {
			status: "live",
			workflowId: projectSession.workflowId,
			workflowVersion: projectSession.workflowVersion,
			title: projectSession.title ?? projectSession.workflowId,
			href: workflowDefinitionViewerPath(projectSession.workflowId, projectSession.workflowVersion),
		};
	}
	return {
		status: "snapshot_only_definition_deleted",
		workflowId: projectSession.workflowId,
		title: projectSession.title ?? projectSession.workflowId,
		tombstoneLabel: "Historical run inspection uses the immutable Project session snapshot instead of a broken live definition link.",
	};
}

function collectNestedWorkflowSessionLinks(sessionNodes: readonly PiboWebSessionNode[], rootPiboSessionId: string): WorkflowNestedSessionLink[] {
	const root = findWorkflowSessionNode(sessionNodes, rootPiboSessionId);
	if (!root) return [];
	const links: WorkflowNestedSessionLink[] = [];
	const visit = (nodes: readonly PiboWebSessionNode[]) => {
		for (const node of nodes) {
			if (node.workflowSessionKind === "nested_workflow") {
				links.push({
					piboSessionId: node.piboSessionId,
					title: node.title,
					kind: node.workflowSessionKind ?? node.profile ?? "workflow",
					...(node.workflowSessionKind ? { workflowSessionKind: node.workflowSessionKind } : {}),
				});
			}
			visit(node.children);
		}
	};
	visit(root.children);
	return links;
}

function findWorkflowSessionNode(nodes: readonly PiboWebSessionNode[], piboSessionId: string): PiboWebSessionNode | undefined {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findWorkflowSessionNode(node.children, piboSessionId);
		if (child) return child;
	}
	return undefined;
}

function workflowDefinitionLinkHref(link: PiboProjectWorkflowDefinitionLink): string | undefined {
	if (link.status !== "live") return undefined;
	if (link.href) return link.href;
	if (!link.workflowVersion) return undefined;
	return workflowDefinitionViewerPath(link.workflowId, link.workflowVersion);
}

function workflowDefinitionViewerPath(workflowId: string, workflowVersion: string): string {
	return `/apps/chat/workflows/view/${encodeURIComponent(workflowId)}/${encodeURIComponent(workflowVersion)}`;
}

function workflowDefinitionRefLabel(link: PiboProjectWorkflowDefinitionLink): string {
	return `${link.workflowId}${link.workflowVersion ? `@${link.workflowVersion}` : ""}`;
}

function summarizeWorkflowConfiguration(projectSession: PiboProjectSession): WorkflowConfigurationSummary {
	const configuration = projectSession.configuration;
	return {
		inputKeys: Object.keys(configuration?.inputValues ?? {}).sort(),
		promptOverrideNodeIds: Object.keys(configuration?.promptOverrides ?? {}).sort(),
	};
}

function collectPendingHumanActions(
	projectSession: PiboProjectSession,
	selectedSessionSignal: PiboSessionSignalSnapshot | undefined,
): WorkflowPendingHumanAction[] {
	const state = workflowStateLabel(projectSession, undefined).toLowerCase();
	const signalStatus = [selectedSessionSignal?.aggregateStatus, selectedSessionSignal?.localStatus]
		.filter((value): value is string => typeof value === "string")
		.join(" ")
		.toLowerCase();
	const hasPendingHumanAction = state.includes("waiting")
		|| state.includes("blocked")
		|| signalStatus.includes("waiting")
		|| signalStatus.includes("blocked")
		|| Boolean(selectedSessionSignal?.hasBlockedDescendant);
	if (!hasPendingHumanAction) return [];
	return [{
		id: `human-action:${projectSession.piboSessionId}`,
		label: "Awaiting human action",
		source: selectedSessionSignal ? "session signal" : "project session state",
	}];
}

function collectWorkflowRunHistory(projectSession: PiboProjectSession, state: string, currentNodeId: string): WorkflowRunHistoryEntry[] {
	if (!projectSession.workflowRunId) return [];
	return [{
		id: projectSession.workflowRunId,
		status: state,
		currentNodeId,
		updatedAt: projectSession.updatedAt,
		source: "project session run record",
	}];
}

function collectWorkflowNodeAttempts(traceView: PiboSessionTraceView | null, workflowRunId: string | undefined): WorkflowNodeAttemptSummary[] {
	if (!workflowRunId || !traceView) return [];
	return flattenTraceNodes(traceView.nodes)
		.filter(isTraceNodeAttemptFact)
		.slice(0, 8)
		.map((node, index) => ({
			id: node.id,
			nodeId: node.stableKey ?? node.entryId ?? node.type,
			label: node.title || node.type,
			kind: node.type,
			status: traceStatusToAttemptStatus(node.status),
			attempt: index + 1,
			source: "session trace fact",
			...(node.startedAt ? { startedAt: node.startedAt } : {}),
			...(node.completedAt ? { completedAt: node.completedAt } : {}),
		}));
}

function isTraceNodeAttemptFact(node: PiboTraceNode): boolean {
	return node.type === "agent.turn"
		|| node.type === "tool.call"
		|| node.type === "execution.command"
		|| node.type === "agent.delegation"
		|| node.type === "agent.async"
		|| node.type === "yielded.run"
		|| node.type === "error";
}

function traceStatusToAttemptStatus(status: PiboTraceNode["status"]): string {
	if (status === "done") return "completed";
	if (status === "error") return "failed";
	return "running";
}

function collectWorkflowEdgeTransfers(traceView: PiboSessionTraceView | null, workflowRunId: string | undefined): WorkflowEdgeTransferSummary[] {
	if (!workflowRunId || !traceView) return [];
	const transfers: WorkflowEdgeTransferSummary[] = [];
	for (const event of traceView.rawEvents) {
		if (!isRecord(event.payload)) continue;
		const payloadType = stringValue(event.payload.type);
		const payloadRunId = stringValue(event.payload.runId);
		if (payloadType !== "edge.transferred" || (payloadRunId && payloadRunId !== workflowRunId)) continue;
		const edgeId = stringValue(event.payload.edgeId);
		if (!edgeId) continue;
		transfers.push({
			id: stringValue(event.payload.edgeTransferId) ?? event.id,
			edgeId,
			status: "transferred",
			source: event.type,
			createdAt: event.createdAt,
		});
	}
	return transfers.slice(0, 8);
}

function collectWorkflowRuntimeErrors(
	traceView: PiboSessionTraceView | null,
	selectedSessionSignal: PiboSessionSignalSnapshot | undefined,
): WorkflowRuntimeErrorSummary[] {
	const errors: WorkflowRuntimeErrorSummary[] = [];
	for (const signalError of selectedSessionSignal?.errors ?? []) {
		errors.push({
			id: `signal:${errors.length}`,
			message: signalError.message,
			...(signalError.code ? { code: signalError.code } : {}),
			source: signalError.source ?? "session signal",
		});
	}
	if (traceView) {
		for (const node of flattenTraceNodes(traceView.nodes)) {
			const message = node.error ?? (node.status === "error" ? validationMessageFromValue(node.output) ?? validationMessageFromValue(node.summary) : undefined);
			if (!message) continue;
			errors.push({ id: `node:${node.id}`, message, source: node.type });
		}
		for (const event of traceView.rawEvents) {
			if (!isRecord(event.payload)) continue;
			const payloadError = event.payload.error;
			const message = isRecord(payloadError) ? stringValue(payloadError.message) : stringValue(payloadError);
			const code = isRecord(payloadError) ? stringValue(payloadError.code) : undefined;
			if (!message) continue;
			errors.push({
				id: `event:${event.id}`,
				message,
				...(code ? { code } : {}),
				source: event.type,
			});
		}
	}
	return dedupeRuntimeErrors(errors).slice(0, 8);
}

function dedupeRuntimeErrors(errors: WorkflowRuntimeErrorSummary[]): WorkflowRuntimeErrorSummary[] {
	const seen = new Set<string>();
	return errors.filter((error) => {
		const key = `${error.code ?? ""}:${error.message}:${error.source ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function collectWorkflowFinalOutput(traceView: PiboSessionTraceView | null, status: WorkflowNodeStatus): WorkflowFinalOutput | undefined {
	if (status !== "completed" || !traceView) return undefined;
	const nodes = flattenTraceNodes(traceView.nodes);
	const assistantOutput = [...nodes]
		.reverse()
		.find((node) => node.type === "assistant.message" && node.status === "done" && (node.output !== undefined || node.summary));
	if (assistantOutput) {
		return { value: assistantOutput.output ?? assistantOutput.summary ?? "", source: "assistant.message" };
	}
	const completedOutput = [...nodes]
		.reverse()
		.find((node) => node.status === "done" && node.type !== "user.message" && node.type !== "model.reasoning" && node.output !== undefined);
	return completedOutput ? { value: completedOutput.output, source: completedOutput.type } : undefined;
}

function collectWorkflowLifecycleValidationErrors(
	projectSession: PiboProjectSession,
	workflowLifecycleEvents: readonly WorkflowLifecycleEventRecord[],
): WorkflowValidationError[] {
	const errors: WorkflowValidationError[] = [];
	for (const event of workflowLifecycleEvents) {
		if (event.piboSessionId !== projectSession.piboSessionId) continue;
		if (event.type !== "project.workflow_start.blocked" && event.validation?.trigger !== "before_workflow_start") continue;
		for (const diagnostic of event.diagnostics) {
			if (diagnostic.severity !== "error") continue;
			errors.push({
				id: `lifecycle:${event.id}:${errors.length}`,
				message: diagnostic.message,
				code: diagnostic.code,
				path: diagnostic.path,
				source: "start lifecycle event",
			});
		}
	}
	return dedupeValidationErrors(errors).slice(0, 8);
}

function collectWorkflowValidationErrors(traceView: PiboSessionTraceView | null): WorkflowValidationError[] {
	if (!traceView) return [];
	const errors: WorkflowValidationError[] = [];
	for (const node of flattenTraceNodes(traceView.nodes)) {
		const nodeError = node.error ?? validationMessageFromValue(node.output) ?? validationMessageFromValue(node.summary);
		if (!nodeError) continue;
		const validationText = [node.title, node.summary, node.error, node.type].filter((value): value is string => typeof value === "string").join(" ");
		if (!isValidationLike(validationText) && !isValidationLike(nodeError)) continue;
		errors.push({
			id: `node:${node.id}`,
			message: nodeError,
			...(node.type ? { source: node.type } : {}),
		});
	}
	for (const event of traceView.rawEvents) {
		extractValidationDiagnostics(event.payload, `event:${event.id}`, errors);
	}
	return dedupeValidationErrors(errors).slice(0, 8);
}

function flattenTraceNodes(nodes: readonly PiboTraceNode[]): PiboTraceNode[] {
	const flattened: PiboTraceNode[] = [];
	const visit = (items: readonly PiboTraceNode[]) => {
		for (const item of items) {
			flattened.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return flattened;
}

function extractValidationDiagnostics(value: unknown, idPrefix: string, errors: WorkflowValidationError[], depth = 0): void {
	if (depth > 4 || !isRecord(value)) return;
	const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics : undefined;
	if (diagnostics) {
		for (const diagnostic of diagnostics) {
			if (!isRecord(diagnostic)) continue;
			const message = stringValue(diagnostic.message) ?? validationMessageFromValue(diagnostic);
			if (!message) continue;
			errors.push({
				id: `${idPrefix}:diagnostic:${errors.length}`,
				message,
				...(stringValue(diagnostic.code) ? { code: stringValue(diagnostic.code) } : {}),
				...(stringValue(diagnostic.path) ? { path: stringValue(diagnostic.path) } : {}),
				source: "workflow.diagnostic",
			});
		}
	}
	const error = value.error;
	if (isRecord(error)) {
		const code = stringValue(error.code);
		const message = stringValue(error.message) ?? validationMessageFromValue(error);
		if (message && isValidationLike([code, message].filter(Boolean).join(" "))) {
			errors.push({
				id: `${idPrefix}:error:${errors.length}`,
				message,
				...(code ? { code } : {}),
				source: "workflow.error",
			});
		}
	} else if (typeof error === "string" && isValidationLike(error)) {
		errors.push({ id: `${idPrefix}:error:${errors.length}`, message: error, source: "workflow.error" });
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === "diagnostics" || key === "error") continue;
		if (key !== "payload" && key !== "output" && key !== "result" && key !== "data") continue;
		extractValidationDiagnostics(child, `${idPrefix}:${key}`, errors, depth + 1);
	}
}

function validationMessageFromValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return undefined;
	return stringValue(value.message) ?? stringValue(value.error) ?? stringValue(value.summary);
}

function isValidationLike(value: string): boolean {
	const normalized = value.toLowerCase();
	return normalized.includes("validation")
		|| normalized.includes("validate")
		|| normalized.includes("diagnostic")
		|| normalized.includes("workflowinterfaceerror")
		|| normalized.includes("workflowruntimeerror.validation");
}

function dedupeValidationErrors(errors: WorkflowValidationError[]): WorkflowValidationError[] {
	const seen = new Set<string>();
	return errors.filter((error) => {
		const key = `${error.code ?? ""}:${error.path ?? ""}:${error.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkflowBackedProjectSession(projectSession: PiboProjectSession): boolean {
	return Boolean(projectSession.workflowRunId) || projectSession.state === "workflow" || projectSession.workflowId !== "simple-chat";
}

function workflowStateLabel(projectSession: PiboProjectSession, selectedSessionStatus: PiboWebSessionStatus | undefined): string {
	if (projectSession.archived) return "archived";
	if (projectSession.state && projectSession.state !== "workflow") return projectSession.state.replace(/_/g, " ");
	if (selectedSessionStatus === "running") return "running";
	if (selectedSessionStatus === "error") return "failed";
	return projectSession.workflowRunId ? "workflow" : projectSession.kind;
}

function workflowNodeStatus(projectSession: PiboProjectSession, selectedSessionStatus: PiboWebSessionStatus | undefined): WorkflowNodeStatus {
	const state = workflowStateLabel(projectSession, selectedSessionStatus).toLowerCase();
	if (projectSession.archived) return "cancelled";
	if (state.includes("complete") || state.includes("done")) return "completed";
	if (state.includes("fail") || state.includes("error")) return "failed";
	if (state.includes("cancel")) return "cancelled";
	if (state.includes("wait") || state.includes("blocked")) return "waiting";
	return selectedSessionStatus === "running" ? "active" : "active";
}

function stateIdForStatus(status: WorkflowNodeStatus): string {
	if (status === "completed") return "workflow.completed";
	if (status === "failed") return "workflow.failed";
	if (status === "cancelled") return "workflow.cancelled";
	return "node.session";
}

function terminalStateIdForStatus(status: WorkflowNodeStatus): string {
	if (status === "failed") return "workflow.failed";
	if (status === "cancelled") return "workflow.cancelled";
	return "workflow.completed";
}

function terminalLabelForStatus(status: WorkflowNodeStatus): string {
	if (status === "failed") return "failed";
	if (status === "cancelled") return "cancelled";
	return "completed";
}

function terminalEventForStatus(status: WorkflowNodeStatus): string {
	if (status === "failed") return "WORKFLOW.FAIL";
	if (status === "cancelled") return "WORKFLOW.CANCEL";
	return "WORKFLOW.NODE.DONE";
}

function WorkflowStatusIcon({ status }: { status: WorkflowNodeStatus }) {
	if (status === "completed") return <CheckCircle2 size={16} className="text-emerald-300" />;
	if (status === "failed") return <XCircle size={16} className="text-red-300" />;
	if (status === "cancelled") return <AlertTriangle size={16} className="text-slate-400" />;
	if (status === "waiting") return <Clock3 size={16} className="text-amber-300" />;
	if (status === "active") return <Activity size={16} className="text-[#11a4d4]" />;
	return <Circle size={16} className="text-slate-500" />;
}

function WorkflowBadge({ tone, children }: { tone: "blue" | "slate" | "green" | "amber" | "red"; children: ReactNode }) {
	const classes = {
		blue: "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]",
		slate: "border-slate-700 bg-slate-900/50 text-slate-300",
		green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
		amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
		red: "border-red-500/40 bg-red-500/10 text-red-300",
	};
	return <span className={`rounded border px-2 py-1 font-mono ${classes[tone]}`}>{children}</span>;
}

function badgeToneForStatus(status: WorkflowNodeStatus): "blue" | "slate" | "green" | "amber" | "red" {
	if (status === "completed") return "green";
	if (status === "failed" || status === "cancelled") return "red";
	if (status === "waiting") return "amber";
	return "blue";
}

function nodeCardClass(status: WorkflowNodeStatus): string {
	if (status === "completed") return "border-emerald-500/40 bg-emerald-500/10";
	if (status === "failed") return "border-red-500/40 bg-red-500/10";
	if (status === "cancelled") return "border-slate-600 bg-slate-800/40";
	if (status === "waiting") return "border-amber-500/40 bg-amber-500/10";
	if (status === "active") return "border-[#11a4d4]/50 bg-[#11a4d4]/10 shadow-[0_0_0_1px_rgba(17,164,212,0.18)]";
	return "border-slate-800 bg-[#111820]";
}

function statusTextClass(status: WorkflowNodeStatus): string {
	if (status === "completed") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
	if (status === "failed" || status === "cancelled") return "border-red-500/40 bg-red-500/10 text-red-300";
	if (status === "waiting") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
	if (status === "active") return "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]";
	return "border-slate-700 bg-slate-900/50 text-slate-400";
}

function workflowFactStatusClass(status: string): string {
	const normalized = status.toLowerCase();
	if (normalized.includes("complete") || normalized.includes("done") || normalized.includes("transferred")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
	if (normalized.includes("fail") || normalized.includes("error") || normalized.includes("cancel")) return "border-red-500/40 bg-red-500/10 text-red-300";
	if (normalized.includes("wait") || normalized.includes("blocked")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
	if (normalized.includes("run") || normalized.includes("active") || normalized.includes("workflow")) return "border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]";
	return "border-slate-700 bg-slate-900/50 text-slate-400";
}

function shortWorkflowValue(value: string): string {
	return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}
