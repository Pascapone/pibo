import type { PiboRunNotification } from "./registry.js";

const RUN_NOTIFICATION_OPEN = "<pibo_run_notification>";
const RUN_NOTIFICATION_CLOSE = "</pibo_run_notification>";

export function formatPiboRunReminderMessage(notification: PiboRunNotification, maxDurationMs: number): string {
	return [
		RUN_NOTIFICATION_OPEN,
		JSON.stringify({
			completed: notification.completed.map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, toolName: run.toolName, summary: run.summary })),
			failed: notification.failed.map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, toolName: run.toolName, summary: run.summary, resourceLimitReason: run.resources?.limitReason, resourceUnit: run.resources?.unitName })),
			timedOut: notification.timedOut.map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, toolName: run.toolName, summary: run.summary, timeoutMs: run.timeoutMs, timeoutPhase: run.timeoutPhase })),
			cancelled: notification.cancelled.map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, toolName: run.toolName, summary: run.summary })),
			running: notification.running.map((run) => ({ runId: run.runId, kind: run.kind, status: run.status, toolName: run.toolName, summary: run.summary })),
			instruction: [
				`This autonomous run-reminder turn stops after ${maxDurationMs / 60_000} minutes of wall-clock time.`,
				"Handle the listed runs promptly, then finish the turn. Do not start new subagents, yielded runs, or other long-running work from this reminder; leave larger follow-up work for a separate user-initiated or Goal continuation turn.",
				"Use the selected Run Control tools to read terminal runs or wait, inspect, cancel, and acknowledge work that still needs management.",
			].join(" "),
		}),
		RUN_NOTIFICATION_CLOSE,
	].join("\n");
}

export function isPiboRunReminderServiceMessage(event: { source?: string; text: string }): boolean {
	return event.source === "service" && event.text.startsWith(RUN_NOTIFICATION_OPEN);
}
