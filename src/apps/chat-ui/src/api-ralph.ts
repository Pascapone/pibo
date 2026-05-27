import { requestJson } from "./api-http";
import type { ModelProfile, PiboRalphJob, PiboRalphJobTemplate, PiboRalphRun, PiboRalphStatus, PiboRalphStopConditionInfo, PiboRalphStopPolicy, PiboRalphTarget, ThinkingLevel } from "./types";

export type RalphJobInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboRalphTarget;
	profile: string;
	prompt: string;
	maxIterations?: number | null;
	stopPolicy?: PiboRalphStopPolicy | null;
	modelOverride?: ModelProfile | null;
	thinkingLevel?: ThinkingLevel | null;
	fastMode?: boolean | null;
};

export async function getRalphStatus(): Promise<{ status: PiboRalphStatus }> {
	return requestJson<{ status: PiboRalphStatus }>("/api/chat/ralph/status");
}

export async function getRalphConditions(): Promise<{ conditions: PiboRalphStopConditionInfo[] }> {
	return requestJson<{ conditions: PiboRalphStopConditionInfo[] }>("/api/chat/ralph/conditions");
}

export async function getRalphTemplates(): Promise<{ templates: PiboRalphJobTemplate[] }> {
	return requestJson<{ templates: PiboRalphJobTemplate[] }>("/api/chat/ralph/templates");
}

export async function getRalphJobs(includeDisabled = true): Promise<{ jobs: PiboRalphJob[] }> {
	const suffix = includeDisabled ? "?includeDisabled=true" : "";
	return requestJson<{ jobs: PiboRalphJob[] }>(`/api/chat/ralph/jobs${suffix}`);
}

export async function postRalphJob(input: RalphJobInput): Promise<{ job: PiboRalphJob }> {
	return requestJson<{ job: PiboRalphJob }>("/api/chat/ralph/jobs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function patchRalphJob(id: string, input: Partial<RalphJobInput>): Promise<{ job: PiboRalphJob }> {
	return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function deleteRalphJob(id: string): Promise<{ removed: boolean }> {
	return requestJson<{ removed: boolean }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}`, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function startRalphJob(id: string): Promise<{ run: PiboRalphRun }> {
	return requestJson<{ run: PiboRalphRun }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function stopRalphJob(id: string): Promise<{ job: PiboRalphJob }> {
	return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/stop`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function cancelRalphJob(id: string): Promise<{ job: PiboRalphJob }> {
	return requestJson<{ job: PiboRalphJob }>(`/api/chat/ralph/jobs/${encodeURIComponent(id)}/cancel`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
}

export async function getRalphRuns(jobId?: string, limit = 100): Promise<{ runs: PiboRalphRun[] }> {
	const params = new URLSearchParams();
	if (jobId) params.set("jobId", jobId);
	params.set("limit", String(limit));
	return requestJson<{ runs: PiboRalphRun[] }>(`/api/chat/ralph/runs?${params.toString()}`);
}
