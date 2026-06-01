import type { PiboJsonObject } from "../core/events.js";

export type PiboCronTarget =
	| { kind: "room"; roomId: string }
	| { kind: "default-chat" };

export type PiboCronSchedule =
	| { kind: "at"; at: string }
	| { kind: "every"; everyMs: number; anchorMs?: number }
	| { kind: "cron"; expr: string; tz?: string };

export type PiboCronScheduleUi =
	| { preset: "in"; amount: number; unit: "minutes" | "hours" | "days" }
	| { preset: "at"; localDateTime: string; tz?: string }
	| { preset: "every"; amount: number; unit: "minutes" | "hours" | "days" }
	| { preset: "daily"; time: string; tz?: string }
	| { preset: "weekly"; weekdays: number[]; time: string; tz?: string }
	| { preset: "monthly"; dayOfMonth: number; time: string; tz?: string }
	| { preset: "advanced"; expr: string; tz?: string };

export type PiboCronJobState = {
	nextRunAt?: string;
	runningAt?: string;
	lastRunAt?: string;
	lastStatus?: "ok" | "error" | "skipped";
	lastError?: string;
	lastRunId?: string;
	lastPiboSessionId?: string;
	consecutiveErrors?: number;
};

export type PiboCronJob = {
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	target: PiboCronTarget;
	profile: string;
	prompt: string;
	schedule: PiboCronSchedule;
	scheduleUi?: PiboCronScheduleUi;
	deleteAfterRun?: boolean;
	state: PiboCronJobState;
	createdAt: string;
	updatedAt: string;
};

export type PiboCronRunStatus = "queued" | "running" | "ok" | "error" | "skipped";

export type PiboCronRun = {
	id: string;
	jobId: string;
	piboSessionId?: string;
	status: PiboCronRunStatus;
	reason?: string;
	error?: string;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type PiboCronJobCreateInput = {
	name?: string;
	description?: string;
	enabled?: boolean;
	target: PiboCronTarget;
	profile: string;
	prompt: string;
	schedule: PiboCronSchedule;
	scheduleUi?: PiboCronScheduleUi;
	deleteAfterRun?: boolean;
};

export type PiboCronJobPatchInput = Partial<Pick<PiboCronJobCreateInput, "name" | "description" | "enabled" | "target" | "profile" | "prompt" | "schedule" | "scheduleUi" | "deleteAfterRun">>;

export type PiboCronStatus = {
	enabled: boolean;
	jobs: number;
	running: number;
	nextRunAt?: string;
};

export type PiboCronResolvedTarget = {
	roomId: string;
	workspace?: string;
	metadata?: PiboJsonObject;
};
