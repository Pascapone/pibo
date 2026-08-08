import { requestJson } from "./api-http";
import type { ModelProfile, PiboLoopJob, PiboLoopJobTemplate, PiboLoopMode, PiboLoopRun, PiboLoopStatus, PiboLoopStopConditionInfo, PiboLoopStopPolicy, PiboLoopTarget, ThinkingLevel } from "./types";

export type LoopJobInput = {
	mode?: PiboLoopMode;
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboLoopTarget;
	profile: string;
	prompt: string;
	maxIterations?: number | null;
	tokenBudget?: number | null;
	tokenReserve?: number | null;
	stopPolicy?: PiboLoopStopPolicy | null;
	modelOverride?: ModelProfile | null;
	thinkingLevel?: ThinkingLevel | null;
	fastMode?: boolean | null;
};

export async function getLoopStatus(): Promise<{ status: PiboLoopStatus }> {
	return requestJson<{ status: PiboLoopStatus }>("/api/chat/loops/status");
}

export async function getLoopConditions(): Promise<{ conditions: PiboLoopStopConditionInfo[] }> {
	return requestJson<{ conditions: PiboLoopStopConditionInfo[] }>("/api/chat/loops/conditions");
}

export async function getLoopTemplates(): Promise<{ templates: PiboLoopJobTemplate[] }> {
	return requestJson<{ templates: PiboLoopJobTemplate[] }>("/api/chat/loops/templates");
}

export async function getLoopJobs(includeDisabled = true): Promise<{ jobs: PiboLoopJob[] }> {
	const suffix = includeDisabled ? "?includeDisabled=true" : "";
	return requestJson<{ jobs: PiboLoopJob[] }>(`/api/chat/loops/jobs${suffix}`);
}

export async function postLoopJob(input: LoopJobInput): Promise<{ job: PiboLoopJob }> {
	return requestJson<{ job: PiboLoopJob }>("/api/chat/loops/jobs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchLoopJob(id: string, input: Partial<LoopJobInput>): Promise<{ job: PiboLoopJob }> {
	return requestJson<{ job: PiboLoopJob }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteLoopJob(id: string): Promise<{ removed: boolean }> {
	return requestJson<{ removed: boolean }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function startLoopJob(id: string): Promise<{ run: PiboLoopRun }> {
	return requestJson<{ run: PiboLoopRun }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function reopenLoopJob(id: string): Promise<{ job: PiboLoopJob }> {
	return requestJson<{ job: PiboLoopJob }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}/reopen`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirmTerminalReopen: true }),
	});
}

export async function stopLoopJob(id: string): Promise<{ job: PiboLoopJob }> {
	return requestJson<{ job: PiboLoopJob }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}/stop`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function cancelLoopJob(id: string): Promise<{ job: PiboLoopJob }> {
	return requestJson<{ job: PiboLoopJob }>(`/api/chat/loops/jobs/${encodeURIComponent(id)}/cancel`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function getLoopRuns(jobId?: string, limit = 100): Promise<{ runs: PiboLoopRun[] }> {
	const params = new URLSearchParams();
	if (jobId) params.set("jobId", jobId);
	params.set("limit", String(limit));
	return requestJson<{ runs: PiboLoopRun[] }>(`/api/chat/loops/runs?${params.toString()}`);
}
