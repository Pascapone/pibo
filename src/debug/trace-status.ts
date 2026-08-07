export type DebugTraceLifecycleStatus = "done" | "running" | "error";
export type DebugTraceSessionStatus = "idle" | "running" | "error";
export type DebugTraceStatusSource = "event-log" | "session-store";

export type DebugTraceSessionStatusResolution = {
	status: DebugTraceSessionStatus;
	source: DebugTraceStatusSource;
};

export type DebugTraceStatusSummary = {
	status: DebugTraceLifecycleStatus;
	errorNodeCount: number;
};

export function resolveDebugTraceSessionStatus(
	sessionStatus: string,
	eventTypes: readonly string[],
): DebugTraceSessionStatusResolution {
	for (let index = eventTypes.length - 1; index >= 0; index -= 1) {
		switch (eventTypes[index]) {
			case "session_error":
				return { status: "error", source: "event-log" };
			case "message_started":
				return { status: "running", source: "event-log" };
			case "message_finished":
				return { status: "idle", source: "event-log" };
		}
	}
	return {
		status: sessionStatus === "running" || sessionStatus === "error" ? sessionStatus : "idle",
		source: "session-store",
	};
}

export function summarizeDebugTraceStatus(
	sessionStatus: DebugTraceSessionStatus,
	nodeStatuses: readonly string[],
): DebugTraceStatusSummary {
	const errorNodeCount = nodeStatuses.filter((status) => status === "error").length;
	if (sessionStatus === "error") return { status: "error", errorNodeCount };
	if (sessionStatus === "running" || nodeStatuses.some((status) => status === "running")) {
		return { status: "running", errorNodeCount };
	}
	return { status: "done", errorNodeCount };
}
