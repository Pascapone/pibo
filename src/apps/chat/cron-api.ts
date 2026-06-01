import { PiboWebHttpError, readJsonBody, responseJson } from "../../web/http.js";
import type { PiboWebAppContext, PiboWebSession } from "../../web/types.js";
import { getPiboCronService } from "../../cron/channel.js";
import { parseFriendlySchedule } from "../../cron/schedule.js";
import type { PiboCronJob, PiboCronJobPatchInput, PiboCronRun, PiboCronSchedule, PiboCronScheduleUi, PiboCronTarget } from "../../cron/types.js";
import type { PiboCronStore } from "../../cron/store.js";
import { legacyOwnerScopeForPreCutoverSchemas } from "../../owner-scope-compat.js";
import { isPiboRoomArchived, type PiboRoom, type PiboRoomMember, type PiboRoomNode, type PiboRoomRole } from "./types/rooms.js";

const CHAT_WEB_API_PREFIX = "/api/chat";

type ChatRoomActions = {
	getRoom(id: string): PiboRoom | undefined;
	listRoomTree(ownerScope: string): PiboRoomNode[];
	requireRoomAccess(roomId: string, principalId: string, action?: "read" | "write" | "admin"): PiboRoom;
	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom;
	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember;
};

export type ChatCronApiOptions = {
	request: Request;
	context: PiboWebAppContext;
	webSession: PiboWebSession;
	roomService: ChatRoomActions;
	cronStore: PiboCronStore;
	defaultProfile: string;
};

type CronJobBody = {
	name?: unknown;
	description?: unknown;
	enabled?: unknown;
	target?: unknown;
	profile?: unknown;
	prompt?: unknown;
	schedule?: unknown;
	scheduleUi?: unknown;
	deleteAfterRun?: unknown;
};

function principalIdFor(webSession: PiboWebSession): string {
	void webSession;
	return legacyOwnerScopeForPreCutoverSchemas();
}

function requireSameOriginJsonRequest(request: Request): void {
	const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	if (contentType !== "application/json") throw new PiboWebHttpError("Content-Type must be application/json", 415);
	const origin = request.headers.get("origin");
	if (!origin) throw new PiboWebHttpError("Origin header is required", 403);
	if (origin !== new URL(request.url).origin) throw new PiboWebHttpError("Origin is not allowed", 403);
}

function accessDenied(error: unknown): never {
	throw new PiboWebHttpError(error instanceof Error ? error.message : "Access denied", 403);
}

function normalizeString(value: unknown, field: string, options: { required?: boolean; max?: number } = {}): string | undefined {
	if (value === undefined || value === null) {
		if (options.required) throw new PiboWebHttpError(`${field} is required`, 400);
		return undefined;
	}
	if (typeof value !== "string") throw new PiboWebHttpError(`${field} must be a string`, 400);
	const normalized = value.trim();
	if (!normalized && options.required) throw new PiboWebHttpError(`${field} is required`, 400);
	if (options.max && normalized.length > options.max) throw new PiboWebHttpError(`${field} is too long`, 400);
	return normalized || undefined;
}

function normalizeEnabled(value: unknown): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new PiboWebHttpError("enabled must be a boolean", 400);
	return value;
}

function normalizeTarget(value: unknown, options: ChatCronApiOptions): PiboCronTarget {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiboWebHttpError("target is required", 400);
	const raw = value as { kind?: unknown; roomId?: unknown; principalId?: unknown };
	if (raw.kind === "room") {
		const roomId = normalizeString(raw.roomId, "target.roomId", { required: true })!;
		let room: PiboRoom;
		try {
			room = options.roomService.requireRoomAccess(roomId, principalIdFor(options.webSession), "write");
		} catch (error) {
			accessDenied(error);
		}
		if (isPiboRoomArchived(room)) throw new PiboWebHttpError("Archived rooms are read-only", 403);
		return { kind: "room", roomId };
	}
	if (raw.kind === "personal") {
		const principalId = legacyOwnerScopeForPreCutoverSchemas();
		options.roomService.ensureDefaultRoom({ ownerScope: legacyOwnerScopeForPreCutoverSchemas(), principalId, name: "Shared Chat" });
		return { kind: "personal", principalId };
	}
	throw new PiboWebHttpError("target.kind must be room or personal", 400);
}

function normalizeSchedule(value: unknown): { schedule: PiboCronSchedule; scheduleUi?: PiboCronScheduleUi } {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new PiboWebHttpError("schedule is required", 400);
	const raw = value as Record<string, unknown>;
	try {
		if (raw.kind === "at" && typeof raw.at === "string") return { schedule: { kind: "at", at: raw.at } };
		if (raw.kind === "at" && typeof raw.value === "string") return parseFriendlySchedule({ kind: "at", value: raw.value, tz: typeof raw.tz === "string" ? raw.tz : undefined });
		if (raw.kind === "every" && typeof raw.everyMs === "number") return { schedule: { kind: "every", everyMs: raw.everyMs, anchorMs: typeof raw.anchorMs === "number" ? raw.anchorMs : Date.now() } };
		if (raw.kind === "every" && typeof raw.value === "string") return parseFriendlySchedule({ kind: "every", value: raw.value });
		if (raw.kind === "cron" && typeof raw.expr === "string") return { schedule: { kind: "cron", expr: raw.expr, tz: typeof raw.tz === "string" ? raw.tz : undefined } };
		if (raw.kind === "in" && typeof raw.value === "string") return parseFriendlySchedule({ kind: "in", value: raw.value });
		if (raw.kind === "daily" && typeof raw.time === "string") return parseFriendlySchedule({ kind: "daily", time: raw.time, tz: typeof raw.tz === "string" ? raw.tz : undefined });
		if (raw.kind === "weekly" && typeof raw.time === "string" && (typeof raw.weekdays === "string" || Array.isArray(raw.weekdays))) return parseFriendlySchedule({ kind: "weekly", time: raw.time, weekdays: raw.weekdays as string | number[], tz: typeof raw.tz === "string" ? raw.tz : undefined });
		if (raw.kind === "monthly" && typeof raw.time === "string" && typeof raw.dayOfMonth === "number") return parseFriendlySchedule({ kind: "monthly", time: raw.time, dayOfMonth: raw.dayOfMonth, tz: typeof raw.tz === "string" ? raw.tz : undefined });
	} catch (error) {
		throw new PiboWebHttpError(error instanceof Error ? error.message : String(error), 400);
	}
	throw new PiboWebHttpError("Unsupported schedule", 400);
}

function resolveProfile(context: PiboWebAppContext, fallback: string, value: unknown): string {
	const requested = normalizeString(value, "profile") ?? fallback;
	const profile = context.channelContext.getProfiles?.().find((item) => item.name === requested || item.aliases.includes(requested));
	if (!profile) throw new PiboWebHttpError(`Unknown profile: ${requested}`, 400);
	return profile.name;
}

function jobResource(pathname: string): { id: string; child?: "run" } | undefined {
	const prefix = `${CHAT_WEB_API_PREFIX}/cron/jobs/`;
	if (!pathname.startsWith(prefix)) return undefined;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
	if (!parts[0] || parts.length > 2) return undefined;
	if (parts[1] && parts[1] !== "run") return undefined;
	return { id: parts[0], child: parts[1] as "run" | undefined };
}

type CronApiTarget = { kind: "room"; roomId: string } | { kind: "personal" };
type CronApiJob = Omit<PiboCronJob, "ownerScope" | "target"> & { target: CronApiTarget };
type CronApiRun = Omit<PiboCronRun, "ownerScope">;
function serializeTarget(target: PiboCronTarget): CronApiTarget {
	return target.kind === "room" ? target : { kind: "personal" };
}
function serializeJob(job: PiboCronJob): CronApiJob {
	const { ownerScope: _ownerScope, target, ...rest } = job;
	return { ...rest, target: serializeTarget(target) };
}
function serializeRun(run: PiboCronRun): CronApiRun {
	const { ownerScope: _ownerScope, ...rest } = run;
	return rest;
}

function createPatch(body: CronJobBody, options: ChatCronApiOptions): PiboCronJobPatchInput {
	const patch: PiboCronJobPatchInput = {};
	const name = normalizeString(body.name, "name", { max: 120 });
	if (body.name !== undefined && name !== undefined) patch.name = name;
	if (body.description !== undefined) patch.description = normalizeString(body.description, "description", { max: 500 });
	const enabled = normalizeEnabled(body.enabled);
	if (enabled !== undefined) patch.enabled = enabled;
	if (body.target !== undefined) patch.target = normalizeTarget(body.target, options);
	if (body.profile !== undefined) patch.profile = resolveProfile(options.context, options.defaultProfile, body.profile);
	if (body.prompt !== undefined) patch.prompt = normalizeString(body.prompt, "prompt", { required: true, max: 20_000 });
	if (body.schedule !== undefined) {
		const normalized = normalizeSchedule(body.schedule);
		patch.schedule = normalized.schedule;
		patch.scheduleUi = normalized.scheduleUi;
	}
	if (body.deleteAfterRun !== undefined) {
		if (typeof body.deleteAfterRun !== "boolean") throw new PiboWebHttpError("deleteAfterRun must be a boolean", 400);
		patch.deleteAfterRun = body.deleteAfterRun;
	}
	if (Object.keys(patch).length === 0) throw new PiboWebHttpError("No cron job update fields provided", 400);
	return patch;
}

export async function handleChatCronApiRequest(options: ChatCronApiOptions): Promise<Response | undefined> {
	const { request, cronStore } = options;
	const url = new URL(request.url);
	if (!url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/cron`)) return undefined;

	if (url.pathname === `${CHAT_WEB_API_PREFIX}/cron/status` && request.method === "GET") {
		return responseJson({ status: getPiboCronService()?.status() ?? { enabled: false, ...cronStore.status() } });
	}

	if (url.pathname === `${CHAT_WEB_API_PREFIX}/cron/jobs` && request.method === "GET") {
		return responseJson({ jobs: cronStore.listJobs({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }).map(serializeJob) });
	}

	if (url.pathname === `${CHAT_WEB_API_PREFIX}/cron/jobs` && request.method === "POST") {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<CronJobBody>(request);
		const normalized = normalizeSchedule(body.schedule);
		const job = cronStore.createJob({
			ownerScope: legacyOwnerScopeForPreCutoverSchemas(),
			name: normalizeString(body.name, "name", { max: 120 }),
			description: normalizeString(body.description, "description", { max: 500 }),
			enabled: normalizeEnabled(body.enabled),
			target: normalizeTarget(body.target, options),
			profile: resolveProfile(options.context, options.defaultProfile, body.profile),
			prompt: normalizeString(body.prompt, "prompt", { required: true, max: 20_000 })!,
			schedule: normalized.schedule,
			scheduleUi: normalized.scheduleUi,
			deleteAfterRun: body.deleteAfterRun === true,
		});
		return responseJson({ job: serializeJob(job) }, { status: 201 });
	}

	if (url.pathname === `${CHAT_WEB_API_PREFIX}/cron/runs` && request.method === "GET") {
		const jobId = url.searchParams.get("jobId") || undefined;
		const limit = Number(url.searchParams.get("limit") ?? "100");
		if (jobId && !cronStore.getJob(jobId)) throw new PiboWebHttpError("Cron job not found", 404);
		return responseJson({ runs: cronStore.listRuns({ jobId, limit: Number.isFinite(limit) ? limit : 100 }).map(serializeRun) });
	}

	const resource = jobResource(url.pathname);
	if (!resource) return undefined;

	if (resource.child === "run" && request.method === "POST") {
		requireSameOriginJsonRequest(request);
		const service = getPiboCronService();
		if (!service) throw new PiboWebHttpError("Cron service is not running", 503);
		return responseJson({ run: serializeRun(await service.runJobNow(legacyOwnerScopeForPreCutoverSchemas(), resource.id)) }, { status: 202 });
	}

	if (resource.child) return undefined;

	if (request.method === "GET") {
		const job = cronStore.getJob(resource.id);
		if (!job) throw new PiboWebHttpError("Cron job not found", 404);
		return responseJson({ job: serializeJob(job) });
	}

	if (request.method === "PATCH") {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<CronJobBody>(request);
		const job = cronStore.updateJob(legacyOwnerScopeForPreCutoverSchemas(), resource.id, createPatch(body, options));
		if (!job) throw new PiboWebHttpError("Cron job not found", 404);
		return responseJson({ job: serializeJob(job) });
	}

	if (request.method === "DELETE") {
		requireSameOriginJsonRequest(request);
		return responseJson({ removed: cronStore.removeJob(legacyOwnerScopeForPreCutoverSchemas(), resource.id) });
	}

	return undefined;
}
