import type { TraceOrderKey } from "./trace-order.js";
import type { PiboTraceNode } from "./trace-types.js";

type RunNotificationRun = {
	runId?: unknown;
	kind?: unknown;
	status?: unknown;
	toolName?: unknown;
	summary?: unknown;
};

export type RunNotificationPayload = {
	completed?: unknown;
	failed?: unknown;
	cancelled?: unknown;
	running?: unknown;
	instruction?: unknown;
};

export function parseRunNotificationText(text: string | undefined): RunNotificationPayload | undefined {
	// Legacy history support only: live yielded-run state is projected from Session Signals.
	const trimmed = (text ?? "").trim();
	const start = "<pibo_run_notification>";
	const end = "</pibo_run_notification>";
	if (!trimmed.startsWith(start) || !trimmed.endsWith(end)) return undefined;

	const jsonText = trimmed.slice(start.length, trimmed.length - end.length).trim();
	try {
		const parsed = JSON.parse(jsonText) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as RunNotificationPayload;
	} catch {
		return undefined;
	}
}

export function createRunNotificationNode(input: {
	id: string;
	piboSessionId: string;
	eventId?: string;
	entryId?: string;
	startedAt?: string;
	source?: PiboTraceNode["source"];
	stableKey?: string;
	orderKey?: TraceOrderKey;
	notification: RunNotificationPayload;
}): PiboTraceNode {
	const runs = runNotificationRuns(input.notification);
	const singleRun = runs.length === 1 ? runs[0] : undefined;
	const failedCount = countRunGroup(input.notification.failed);
	const runningCount = countRunGroup(input.notification.running);
	return {
		id: input.id,
		entryId: input.entryId,
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		runId: typeof singleRun?.runId === "string" ? singleRun.runId : undefined,
		type: "yielded.run",
		title: "Run Notification",
		status: failedCount > 0 ? "error" : runningCount > 0 ? "running" : "done",
		startedAt: input.startedAt,
		summary: runNotificationSummary(input.notification),
		output: input.notification,
		source: input.source,
		stableKey: input.stableKey ?? input.id,
		orderKey: input.orderKey,
		children: [],
	};
}

function runNotificationRuns(notification: RunNotificationPayload): RunNotificationRun[] {
	return [
		...runGroup(notification.completed),
		...runGroup(notification.failed),
		...runGroup(notification.cancelled),
		...runGroup(notification.running),
	];
}

function runGroup(value: unknown): RunNotificationRun[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function countRunGroup(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function runNotificationSummary(notification: RunNotificationPayload): string {
	const parts = [
		[countRunGroup(notification.completed), "completed"],
		[countRunGroup(notification.failed), "failed"],
		[countRunGroup(notification.cancelled), "cancelled"],
		[countRunGroup(notification.running), "running"],
	]
		.filter(([count]) => Number(count) > 0)
		.map(([count, label]) => `${count} ${label}`);
	return parts.length ? parts.join(", ") : "No yielded run updates";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
