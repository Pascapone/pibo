export type AgentDelegationStatus = "running" | "completed" | "failed" | "cancelled";

export type AgentDelegationChildSignal = {
	localStatus: string;
	aggregateStatus: string;
	isLocalActive: boolean;
	hasActiveDescendant: boolean;
	isTreeActive: boolean;
	isSettled?: boolean;
	hasError: boolean;
	hasErrorDescendant: boolean;
};

export function resolveAgentDelegationStatus(
	childSignal: AgentDelegationChildSignal | undefined,
	fallbackStatus: "running" | "done" | "error" = "done",
	traceTerminal = false,
): AgentDelegationStatus {
	if (!childSignal) return fallbackStatus === "running" ? "running" : fallbackStatus === "error" ? "failed" : "completed";
	if (traceTerminal) return fallbackStatus === "error" ? "failed" : "completed";
	const statuses = [childSignal.localStatus, childSignal.aggregateStatus];
	if (statuses.some(isCancelledSignalStatus)) return "cancelled";
	if (childSignal.hasError || childSignal.hasErrorDescendant || statuses.some(isFailedSignalStatus)) return "failed";
	if (childSignal.isSettled === false || childSignal.isTreeActive || childSignal.isLocalActive || childSignal.hasActiveDescendant || statuses.some(isRunningSignalStatus)) return "running";
	if (fallbackStatus === "running" && statuses.every(isIdleSignalStatus)) return "running";
	return "completed";
}

export function extractAgentDelegationName(input: unknown, title?: string, summary?: string): string {
	const record = isRecord(input) ? input : undefined;
	const rawName = stringValue(record?.subagentName)
		?? subagentNameFromToolName(title)
		?? stringValue(summary)
		?? stringValue(title)
		?? "Subagent";
	return titleCaseAgentName(rawName);
}

export function extractAgentDelegationTask(input: unknown): string | undefined {
	if (typeof input === "string") return nonEmpty(input);
	if (!isRecord(input)) return undefined;
	for (const key of ["message", "task", "prompt", "query"] as const) {
		const value = nonEmpty(input[key]);
		if (value) return value;
	}
	return extractAgentDelegationTask(input.arguments);
}

export function compactAgentDelegationTask(input: unknown, maxLength = 180): string | undefined {
	const task = extractAgentDelegationTask(input)?.replace(/\s+/g, " ").trim();
	if (!task || maxLength < 1) return undefined;
	return task.length <= maxLength ? task : `${task.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function formatAgentDelegationDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	return `${minutes}m ${seconds}s`;
}

function isRunningSignalStatus(status: string): boolean {
	return ["queued", "starting", "running", "streaming", "waiting", "blocked", "retrying", "compacting", "pausing", "paused"].includes(status);
}

function isIdleSignalStatus(status: string): boolean {
	return status === "idle" || status === "unknown";
}

function isFailedSignalStatus(status: string): boolean {
	return status === "error";
}

function isCancelledSignalStatus(status: string): boolean {
	return status === "cancelled" || status === "interrupted" || status === "disposed";
}

function subagentNameFromToolName(value: string | undefined): string | undefined {
	const name = nonEmpty(value);
	if (!name) return undefined;
	return name.replace(/^pibo_subagent_/, "");
}

function titleCaseAgentName(value: string): string {
	return value
		.replace(/^pibo_subagent_/, "")
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ") || "Subagent";
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringValue(value: unknown): string | undefined {
	return nonEmpty(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
