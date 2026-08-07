export type DebugTraceLifecycleStatus = "done" | "running" | "error";

export type DebugTraceStatusSummary = {
	status: DebugTraceLifecycleStatus;
	errorNodeCount: number;
};

export function summarizeDebugTraceStatus(
	sessionStatus: string,
	nodeStatuses: readonly string[],
): DebugTraceStatusSummary {
	const errorNodeCount = nodeStatuses.filter((status) => status === "error").length;
	if (sessionStatus === "error") return { status: "error", errorNodeCount };
	if (sessionStatus === "running" || nodeStatuses.some((status) => status === "running")) {
		return { status: "running", errorNodeCount };
	}
	return { status: "done", errorNodeCount };
}
