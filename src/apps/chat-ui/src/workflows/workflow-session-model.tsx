import type { PiboSession, PiboWebSessionNode, PiboWebSessionStatus, PiboWorkflowSession } from "../types";

export type WorkflowHeaderSummary = { workflowId: string; state: string; workflowRunId?: string };

export function isWorkflowLinkedSession(node: PiboWebSessionNode | undefined, session?: PiboSession): boolean {
  const kind = node?.workflowSessionKind ?? metadataString(session?.metadata, "workflowSessionKind");
  return kind === "main_workflow" || kind === "nested_workflow";
}

export function workflowSessionFromMetadata(node: PiboWebSessionNode | undefined, session?: PiboSession): PiboWorkflowSession | undefined {
  if (!isWorkflowLinkedSession(node, session)) return undefined;
  const piboSessionId = node?.piboSessionId ?? session?.id;
  const workflowId = metadataString(session?.metadata, "workflowId");
  if (!piboSessionId || !workflowId) return undefined;
  const workflowVersion = metadataString(session?.metadata, "workflowVersion");
  const workflowRunId = metadataString(session?.metadata, "workflowRunId");
  const now = session?.updatedAt ?? node?.lastActivityAt ?? session?.createdAt ?? "";
  return { piboSessionId, workflowId, ...(workflowVersion ? { workflowVersion } : {}), ...(workflowRunId ? { workflowRunId } : {}), state: node?.status === "running" ? "running" : node?.status === "error" ? "failed" : workflowRunId ? "running" : "configured", createdAt: session?.createdAt ?? now, updatedAt: now };
}

export function createWorkflowHeaderSummary(link: PiboWorkflowSession, status?: PiboWebSessionStatus): WorkflowHeaderSummary {
  return { workflowId: link.workflowId, state: workflowStateLabel(link, status), ...(link.workflowRunId ? { workflowRunId: link.workflowRunId } : {}) };
}

export function WorkflowHeaderMeta({ summary }: { summary: WorkflowHeaderSummary }) {
  return <><span className="text-slate-600">·</span><span className="min-w-0 max-w-52 truncate rounded border border-[#11a4d4]/35 bg-[#11a4d4]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#11a4d4]" title={summary.workflowId}>workflow {summary.workflowId}</span><span className={workflowStateBadgeClass(summary.state)}>state {summary.state}</span>{summary.workflowRunId ? <span className="min-w-0 max-w-40 truncate rounded border border-slate-700 bg-slate-900/40 px-1.5 py-0.5 text-[10px] text-slate-400" title={summary.workflowRunId}>run {shortWorkflowId(summary.workflowRunId)}</span> : null}</>;
}

export function workflowStateLabel(link: PiboWorkflowSession, status?: PiboWebSessionStatus): string { if (status === "error") return "failed"; if (status === "running") return "running"; return link.state.replace(/_/g, " "); }
export function workflowStateBadgeClass(value: string): string { const state = value.toLowerCase(); const base = "shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"; if (state.includes("failed") || state.includes("error")) return `${base} border-red-500/40 bg-red-500/10 text-red-300`; if (state.includes("waiting")) return `${base} border-amber-500/40 bg-amber-500/10 text-amber-300`; if (state.includes("complete")) return `${base} border-emerald-500/40 bg-emerald-500/10 text-emerald-300`; return `${base} border-[#11a4d4]/40 bg-[#11a4d4]/10 text-[#11a4d4]`; }
export function shortWorkflowId(value: string): string { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function metadataString(metadata: PiboSession["metadata"], key: string): string | undefined { const value = metadata?.[key]; return typeof value === "string" && value.trim() ? value.trim() : undefined; }
