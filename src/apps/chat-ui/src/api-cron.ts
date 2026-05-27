import { requestJson } from "./api-http";
import type { PiboCronJob, PiboCronRun, PiboCronSchedule, PiboCronStatus, PiboCronTarget } from "./types";

export type CronScheduleInput =
	| { kind: "in"; value: string }
	| { kind: "at"; at: string }
	| { kind: "at"; value: string; tz?: string }
	| { kind: "every"; value: string }
	| { kind: "daily"; time: string; tz?: string }
	| { kind: "weekly"; weekdays: string; time: string; tz?: string }
	| { kind: "monthly"; dayOfMonth: number; time: string; tz?: string }
	| { kind: "cron"; expr: string; tz?: string }
	| PiboCronSchedule;

export type CronJobInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboCronTarget;
	profile?: string;
	prompt: string;
	schedule: CronScheduleInput;
	deleteAfterRun?: boolean;
};

export async function getCronStatus(): Promise<{ status: PiboCronStatus }> {
	return requestJson<{ status: PiboCronStatus }>("/api/chat/cron/status");
}

export async function getCronJobs(includeDisabled = true): Promise<{ jobs: PiboCronJob[] }> {
	const params = new URLSearchParams();
	if (includeDisabled) params.set("includeDisabled", "true");
	const suffix = params.size ? `?${params.toString()}` : "";
	return requestJson<{ jobs: PiboCronJob[] }>(`/api/chat/cron/jobs${suffix}`);
}

export async function postCronJob(input: CronJobInput): Promise<{ job: PiboCronJob }> {
	return requestJson<{ job: PiboCronJob }>("/api/chat/cron/jobs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchCronJob(id: string, input: Partial<CronJobInput>): Promise<{ job: PiboCronJob }> {
	return requestJson<{ job: PiboCronJob }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteCronJob(id: string): Promise<{ removed: boolean }> {
	return requestJson<{ removed: boolean }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function runCronJobNow(id: string): Promise<{ run: PiboCronRun }> {
	return requestJson<{ run: PiboCronRun }>(`/api/chat/cron/jobs/${encodeURIComponent(id)}/run`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
}

export async function getCronRuns(jobId?: string, limit = 100): Promise<{ runs: PiboCronRun[] }> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (jobId) params.set("jobId", jobId);
	return requestJson<{ runs: PiboCronRun[] }>(`/api/chat/cron/runs?${params.toString()}`);
}
