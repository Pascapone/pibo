import { PiboWebHttpError, readJsonBody, responseJson } from '../../web/http.js';
import type { PiboWebAppContext, PiboWebSession } from '../../web/types.js';
import { getPiboLoopService } from '../../loops/channel.js';
import { listLoopJobTemplates } from '../../loops/templates.js';
import type { ModelProfile } from '../../core/profiles.js';
import { isPiboThinkingLevel, type PiboThinkingLevel } from '../../core/thinking.js';
import type { PiboLoopJob, PiboLoopJobPatchInput, PiboLoopMode, PiboLoopRun, PiboLoopStopPolicy, PiboLoopTarget } from '../../loops/types.js';
import { normalizeLoopStopPolicy, PiboLoopActiveRunModeChangeError, type PiboLoopStore } from '../../loops/store.js';
import { isPiboRoomArchived, type PiboRoom, type PiboRoomNode } from './types/rooms.js';
const CHAT_WEB_API_PREFIX = '/api/chat';
type ChatRoomActions = { getRoom(id: string): PiboRoom | undefined; listRoomTree(): PiboRoomNode[]; requireRoom(roomId: string): PiboRoom; ensureDefaultRoom(input?: { name?: string }): PiboRoom };
export type ChatLoopApiOptions = { request: Request; context: PiboWebAppContext; webSession: PiboWebSession; roomService: ChatRoomActions; loopStore: PiboLoopStore; defaultProfile: string };
type LoopJobBody = { mode?: unknown; name?: unknown; description?: unknown; enabled?: unknown; target?: unknown; profile?: unknown; prompt?: unknown; maxIterations?: unknown; tokenBudget?: unknown; tokenReserve?: unknown; stopPolicy?: unknown; modelOverride?: unknown; thinkingLevel?: unknown; fastMode?: unknown };
function requireSameOriginJsonRequest(request: Request): void { const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase(); if (contentType !== 'application/json') throw new PiboWebHttpError('Content-Type must be application/json', 415); const origin = request.headers.get('origin'); if (!origin) throw new PiboWebHttpError('Origin header is required', 403); if (origin !== new URL(request.url).origin) throw new PiboWebHttpError('Origin is not allowed', 403); }
function accessDenied(error: unknown): never { throw new PiboWebHttpError(error instanceof Error ? error.message : 'Access denied', 403); }
function normalizeString(value: unknown, field: string, options: { required?: boolean; max?: number } = {}): string | undefined { if (value === undefined || value === null) { if (options.required) throw new PiboWebHttpError(`${field} is required`, 400); return undefined; } if (typeof value !== 'string') throw new PiboWebHttpError(`${field} must be a string`, 400); const normalized = value.trim(); if (!normalized && options.required) throw new PiboWebHttpError(`${field} is required`, 400); if (options.max && normalized.length > options.max) throw new PiboWebHttpError(`${field} is too long`, 400); return normalized || undefined; }
function normalizeEnabled(value: unknown): boolean | undefined { if (value === undefined) return undefined; if (typeof value !== 'boolean') throw new PiboWebHttpError('enabled must be a boolean', 400); return value; }
function normalizeMode(value: unknown, fallback: PiboLoopMode): PiboLoopMode { if (value === undefined || value === null || value === '') return fallback; if (value !== 'goal' && value !== 'ralph') throw new PiboWebHttpError('mode must be goal or ralph', 400); return value; }
function normalizeMaxIterations(value: unknown): number | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new PiboWebHttpError('maxIterations must be a positive integer', 400); return value; }
function normalizeTokenBudget(value: unknown): number | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new PiboWebHttpError('tokenBudget must be a positive integer', 400); return value; }
function normalizeTokenReserve(value: unknown): number | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new PiboWebHttpError('tokenReserve must be a non-negative integer', 400); return value; }
function normalizeStopPolicy(value: unknown): PiboLoopStopPolicy | undefined { if (value === undefined || value === null) return undefined; try { return normalizeLoopStopPolicy(value as PiboLoopStopPolicy); } catch (error) { throw new PiboWebHttpError(error instanceof Error ? error.message : 'Invalid stopPolicy', 400); } }
function normalizeModelOverride(value: unknown): ModelProfile | undefined { if (value === undefined || value === null) return undefined; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PiboWebHttpError('modelOverride must be an object', 400); const raw = value as Record<string, unknown>; if (typeof raw.provider !== 'string' || typeof raw.id !== 'string') throw new PiboWebHttpError('modelOverride must include provider and id', 400); const provider = raw.provider.trim(); const id = raw.id.trim(); if (!provider || !id) throw new PiboWebHttpError('modelOverride must include provider and id', 400); return { provider, id }; }
function normalizeThinkingLevel(value: unknown): PiboThinkingLevel | undefined { if (value === undefined || value === null || value === '') return undefined; if (typeof value !== 'string' || !isPiboThinkingLevel(value)) throw new PiboWebHttpError('thinkingLevel must be one of off, minimal, low, medium, high, xhigh, max', 400); return value; }
function normalizeFastMode(value: unknown): boolean | undefined { if (value === undefined || value === null) return undefined; if (typeof value !== 'boolean') throw new PiboWebHttpError('fastMode must be a boolean', 400); return value; }
function normalizeTarget(value: unknown, options: ChatLoopApiOptions): PiboLoopTarget { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PiboWebHttpError('target is required', 400); const raw = value as { kind?: unknown; roomId?: unknown }; if (raw.kind === 'room') { const roomId = normalizeString(raw.roomId, 'target.roomId', { required: true })!; let room: PiboRoom; try { room = options.roomService.requireRoom(roomId); } catch (error) { accessDenied(error); } if (isPiboRoomArchived(room)) throw new PiboWebHttpError('Archived rooms are read-only', 403); return { kind: 'room', roomId }; } if (raw.kind === 'default-chat') { options.roomService.ensureDefaultRoom({ name: 'Shared Chat' }); return { kind: 'default-chat' }; } throw new PiboWebHttpError('target.kind must be room or default-chat', 400); }
function resolveProfile(context: PiboWebAppContext, fallback: string, value: unknown): string { const requested = normalizeString(value, 'profile') ?? fallback; const profile = context.channelContext.getProfiles?.().find((item) => item.name === requested || item.aliases.includes(requested)); if (!profile) throw new PiboWebHttpError(`Unknown profile: ${requested}`, 400); return profile.name; }
function jobResource(pathname: string): { id: string; child?: 'start' | 'stop' | 'cancel' | 'reopen' } | undefined { const prefix = `${CHAT_WEB_API_PREFIX}/loops/jobs/`; if (!pathname.startsWith(prefix)) return undefined; const parts = pathname.slice(prefix.length).split('/').filter(Boolean).map((part) => decodeURIComponent(part)); if (!parts[0] || parts.length > 2) return undefined; if (parts[1] && !['start', 'stop', 'cancel', 'reopen'].includes(parts[1])) return undefined; return { id: parts[0], child: parts[1] as 'start' | 'stop' | 'cancel' | 'reopen' | undefined }; }
function createPatch(body: LoopJobBody, options: ChatLoopApiOptions): PiboLoopJobPatchInput { const patch: PiboLoopJobPatchInput = {}; if (body.mode !== undefined) patch.mode = normalizeMode(body.mode, 'goal'); const name = normalizeString(body.name, 'name', { max: 120 }); if (body.name !== undefined && name !== undefined) patch.name = name; if (body.description !== undefined) patch.description = normalizeString(body.description, 'description', { max: 500 }); const enabled = normalizeEnabled(body.enabled); if (enabled !== undefined) patch.enabled = enabled; if (body.target !== undefined) patch.target = normalizeTarget(body.target, options); if (body.profile !== undefined) patch.profile = resolveProfile(options.context, options.defaultProfile, body.profile); if (body.prompt !== undefined) patch.prompt = normalizeString(body.prompt, 'prompt', { required: true, max: 20_000 }); if (body.maxIterations !== undefined) patch.maxIterations = normalizeMaxIterations(body.maxIterations) ?? null; if (body.tokenBudget !== undefined) patch.tokenBudget = normalizeTokenBudget(body.tokenBudget) ?? null; if (body.tokenReserve !== undefined) patch.tokenReserve = normalizeTokenReserve(body.tokenReserve) ?? null; if (body.stopPolicy !== undefined) patch.stopPolicy = normalizeStopPolicy(body.stopPolicy) ?? null; if (body.modelOverride !== undefined) patch.modelOverride = normalizeModelOverride(body.modelOverride) ?? null; if (body.thinkingLevel !== undefined) patch.thinkingLevel = normalizeThinkingLevel(body.thinkingLevel) ?? null; if (body.fastMode !== undefined) patch.fastMode = normalizeFastMode(body.fastMode) ?? null; if (Object.keys(patch).length === 0) throw new PiboWebHttpError('No Loop job update fields provided', 400); return patch; }

type LoopApiTarget = { kind: 'room'; roomId: string } | { kind: 'default-chat' };
type LoopApiJob = Omit<PiboLoopJob, 'target'> & { target: LoopApiTarget };
type LoopApiRun = PiboLoopRun;
function serializeTarget(target: PiboLoopTarget): LoopApiTarget { return target.kind === 'room' ? target : { kind: 'default-chat' }; }
function serializeJob(job: PiboLoopJob): LoopApiJob { const { target, ...rest } = job; return { ...rest, target: serializeTarget(target) }; }
function serializeRun(run: PiboLoopRun): LoopApiRun { return run; }
export async function handleChatLoopApiRequest(options: ChatLoopApiOptions): Promise<Response | undefined> {
	const { request, loopStore } = options;
	const url = new URL(request.url);
	const legacyRalphRequest = url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/ralph`);
	if (!legacyRalphRequest && !url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/loops`) && !url.pathname.startsWith(`${CHAT_WEB_API_PREFIX}/loop`)) return undefined;
	const apiPath = url.pathname.replace(/^\/api\/chat\/(?:ralph|loop)(?=\/|$)/, `${CHAT_WEB_API_PREFIX}/loops`);
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/status` && request.method === 'GET') return responseJson({ status: getPiboLoopService()?.status() ?? { enabled: false, ...loopStore.status() } });
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/conditions` && request.method === 'GET') return responseJson({ conditions: options.context.channelContext.getLoopStopConditionInfos?.() ?? options.context.channelContext.getCapabilityCatalog?.().loopStopConditions ?? [] });
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/templates` && request.method === 'GET') return responseJson({ templates: listLoopJobTemplates() });
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/session-goal` && request.method === 'GET') {
		const piboSessionId = normalizeString(url.searchParams.get('piboSessionId'), 'piboSessionId', { required: true, max: 200 })!;
		const goal = loopStore.getSessionGoalOwner(piboSessionId) ?? loopStore.getLatestGoalForSession(piboSessionId);
		return responseJson({ goal: goal ? serializeJob(goal) : null });
	}
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/jobs` && request.method === 'GET') return responseJson({ jobs: loopStore.listJobs({ includeDisabled: url.searchParams.get('includeDisabled') === 'true' }).map(serializeJob) });
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/jobs` && request.method === 'POST') {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<LoopJobBody>(request);
		const mode = normalizeMode(body.mode, legacyRalphRequest ? 'ralph' : 'goal');
		const tokenBudget = normalizeTokenBudget(body.tokenBudget);
		const tokenReserve = normalizeTokenReserve(body.tokenReserve);
		if (mode === 'ralph' && (tokenBudget !== undefined || tokenReserve !== undefined)) throw new PiboWebHttpError('tokenBudget and tokenReserve are only available for goal mode', 400);
		const job = loopStore.createJob({ mode, name: normalizeString(body.name, 'name', { max: 120 }), description: normalizeString(body.description, 'description', { max: 500 }), enabled: normalizeEnabled(body.enabled), target: normalizeTarget(body.target, options), profile: resolveProfile(options.context, options.defaultProfile, body.profile), prompt: normalizeString(body.prompt, 'prompt', { required: true, max: 20_000 })!, maxIterations: normalizeMaxIterations(body.maxIterations), tokenBudget, tokenReserve, stopPolicy: normalizeStopPolicy(body.stopPolicy), modelOverride: normalizeModelOverride(body.modelOverride), thinkingLevel: normalizeThinkingLevel(body.thinkingLevel), fastMode: normalizeFastMode(body.fastMode) });
		return responseJson({ job: serializeJob(job) }, { status: 201 });
	}
	if (apiPath === `${CHAT_WEB_API_PREFIX}/loops/runs` && request.method === 'GET') { const jobId = url.searchParams.get('jobId') || undefined; const limit = Number(url.searchParams.get('limit') ?? '100'); if (jobId && !loopStore.getJob(jobId)) throw new PiboWebHttpError('Loop job not found', 404); return responseJson({ runs: loopStore.listRuns({ jobId, limit: Number.isFinite(limit) ? limit : 100 }).map(serializeRun) }); }
	const resource = jobResource(apiPath); if (!resource) return undefined;
	if (resource.child && request.method === 'POST') { requireSameOriginJsonRequest(request); const service = getPiboLoopService(); if (!service) throw new PiboWebHttpError('Loop service is not running', 503); if (resource.child === 'start') { const run = await service.startJob(resource.id); if (!run) throw new PiboWebHttpError('Loop job not found, already running, or stopped by a before-run condition', 404); return responseJson({ run: serializeRun(run) }, { status: 202 }); } if (resource.child === 'stop') { const job = service.stopJob(resource.id); if (!job) throw new PiboWebHttpError('Loop job not found', 404); return responseJson({ job: serializeJob(job) }); } if (resource.child === 'cancel') { const job = await service.cancelJob(resource.id); if (!job) throw new PiboWebHttpError('Loop job not found', 404); return responseJson({ job: serializeJob(job) }); } const body = await readJsonBody<{ confirmTerminalReopen?: unknown }>(request); if (body.confirmTerminalReopen !== true) throw new PiboWebHttpError('confirmTerminalReopen must be true', 400); try { return responseJson({ job: serializeJob(service.reopenGoal(resource.id, { confirmed: true, actorId: options.webSession.authSession.identity.userId })) }); } catch (error) { throw new PiboWebHttpError(error instanceof Error ? error.message : 'Goal reopen failed', 409); } }
	if (resource.child) return undefined;
	if (request.method === 'GET') { const job = loopStore.getJob(resource.id); if (!job) throw new PiboWebHttpError('Loop job not found', 404); return responseJson({ job: serializeJob(job) }); }
	if (request.method === 'PATCH') {
		requireSameOriginJsonRequest(request);
		const body = await readJsonBody<LoopJobBody>(request);
		const patch = createPatch(body, options);
		const existing = loopStore.getJob(resource.id);
		if (!existing) throw new PiboWebHttpError('Loop job not found', 404);
		if ((patch.mode ?? existing.mode) === 'ralph' && ((patch.tokenBudget !== undefined && patch.tokenBudget !== null) || (patch.tokenReserve !== undefined && patch.tokenReserve !== null))) throw new PiboWebHttpError('tokenBudget and tokenReserve are only available for goal mode', 400);
		let job: PiboLoopJob | undefined;
		try { job = loopStore.updateJob(resource.id, patch); }
		catch (error) {
			if (error instanceof PiboLoopActiveRunModeChangeError) throw new PiboWebHttpError(error.message, 409);
			throw error;
		}
		if (!job) throw new PiboWebHttpError('Loop job not found', 404);
		return responseJson({ job: serializeJob(job) });
	}
	if (request.method === 'DELETE') { requireSameOriginJsonRequest(request); try { return responseJson({ removed: getPiboLoopService()?.removeJob(resource.id) ?? loopStore.removeJob(resource.id) }); } catch (error) { throw new PiboWebHttpError(error instanceof Error ? error.message : 'Loop removal failed', 409); } }
	return undefined;
}
