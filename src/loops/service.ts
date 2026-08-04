import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PiboChannelContext } from '../channels/types.js';
import type { PiboJsonObject, PiboOutputEvent } from '../core/events.js';
import { getDefaultPiboWorkspace } from '../core/workspace.js';
import { PiboDataStore } from '../data/pibo-store.js';
import { ChatRoomService } from '../apps/chat/data/room-service.js';
import { isPiboRoomArchived } from '../apps/chat/types/rooms.js';
import { acquireBrowserPoolLease, browserPoolPaths, releaseBrowserPoolLease, restartRecordedBrowserPoolChrome, type BrowserPoolAcquireOptions, type BrowserPoolAcquireResult, type BrowserPoolIdentity, type BrowserPoolPaths, type BrowserPoolReleaseOptions, type BrowserPoolReleaseResult } from '../tools/browser-pool.js';
import { createDefaultPiboLoopStore, PiboLoopStore } from './store.js';
import { createBuiltInLoopStopConditions, evaluateLoopStopPolicy } from './stopping.js';
import { buildLoopTurnPrompt } from './prompts.js';
import type { PiboLoopJob, PiboLoopResourceMetadata, PiboLoopRun, PiboLoopRunFact, PiboLoopRunOutcome, PiboLoopStatus, PiboLoopStopConditionDefinition, PiboLoopStopEvaluationSummary } from './types.js';

const CHAT_WEB_CHANNEL = 'pibo.chat-web';

export type PiboLoopBrowserPoolRelease = (paths: BrowserPoolPaths, identity: BrowserPoolIdentity, options?: BrowserPoolReleaseOptions) => Promise<BrowserPoolReleaseResult>;
export type PiboLoopBrowserPoolAcquire = (paths: BrowserPoolPaths, identity: BrowserPoolIdentity, options?: BrowserPoolAcquireOptions) => Promise<BrowserPoolAcquireResult>;
export type PiboLoopResourceCleanupOptions = { browserPoolRootDir?: string; browserPoolId?: string; browserLeaseIdleTimeoutMs?: number; browserLeaseRenewIntervalMs?: number; acquireBrowserPoolLease?: PiboLoopBrowserPoolAcquire; releaseBrowserPoolLease?: PiboLoopBrowserPoolRelease };
export type PiboLoopServiceOptions = { store?: PiboLoopStore; context: PiboChannelContext; dataStorePath?: string; dataPayloadRootDir?: string; intervalMs?: number; maxConcurrentRuns?: number; runTimeoutMs?: number; resourceCleanup?: PiboLoopResourceCleanupOptions };
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
class LoopRunTimeoutError extends Error {
	constructor(message: string, readonly abortFailed = false) { super(message); this.name = 'LoopRunTimeoutError'; }
}
function isUnknownProfileErrorMessage(message: string): boolean { return /^Unknown profile "[^"]+"/.test(message); }
function isJsonObject(value: unknown): value is PiboJsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }
function mergeRunResources(jobResources: PiboLoopResourceMetadata | undefined, runResources: PiboLoopResourceMetadata | undefined): PiboLoopResourceMetadata | undefined {
	if (!jobResources && !runResources) return undefined;
	const browserLeaseIds = [...new Set([...(jobResources?.browserLeaseIds ?? []), ...(runResources?.browserLeaseIds ?? [])])];
	return {
		...(jobResources ?? {}),
		...(runResources ?? {}),
		...(browserLeaseIds.length ? { browserLeaseIds } : {}),
	};
}
function clearDirtyReason(resources: PiboLoopResourceMetadata): PiboLoopResourceMetadata {
	const clean = { ...resources };
	delete clean.dirtyReason;
	return clean;
}

export class PiboLoopService {
	private readonly store: PiboLoopStore;
	private readonly dataStore: PiboDataStore;
	private readonly roomService: ChatRoomService;
	private readonly intervalMs: number;
	private readonly maxConcurrentRuns: number;
	private readonly runTimeoutMs: number | undefined;
	private timer: NodeJS.Timeout | undefined;
	private activeRuns = 0;
	private stopped = true;
	private cancelledRuns = new Set<string>();
	private unsubscribeProductEvents: (() => void) | undefined;
	private unsubscribeOutputEvents: (() => void) | undefined;
	constructor(private readonly options: PiboLoopServiceOptions) {
		this.store = options.store ?? createDefaultPiboLoopStore();
		this.dataStore = new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
		this.roomService = new ChatRoomService(this.dataStore);
		this.intervalMs = options.intervalMs ?? 5_000;
		this.maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 2);
		this.runTimeoutMs = options.runTimeoutMs;
	}
	start(): void { if (!this.stopped) return; this.stopped = false; this.store.recoverInterruptedRuns(); this.unsubscribeProductEvents = this.options.context.subscribeProductEvents?.((event) => this.handleProductEvent(event)); this.unsubscribeOutputEvents = this.options.context.subscribe((event) => this.handleOutputEvent(event)); this.arm(250); }
	stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.unsubscribeProductEvents?.(); this.unsubscribeProductEvents = undefined; this.unsubscribeOutputEvents?.(); this.unsubscribeOutputEvents = undefined; this.dataStore.close(); this.store.close(); }
	status(): PiboLoopStatus { return { enabled: !this.stopped, ...this.store.status() }; }
	async startJob(id: string): Promise<PiboLoopRun | undefined> { const job = this.store.updateJob(id, { enabled: true }); if (!job) return undefined; const reserved = await this.reserveAfterBeforeRunEvaluation(job); if (!reserved) return undefined; void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon()); return reserved.run; }
	stopJob(id: string): PiboLoopJob | undefined { const job = this.store.requestStop(id); this.armSoon(); return job; }
	async cancelJob(id: string): Promise<PiboLoopJob | undefined> {
		const job = this.store.requestCancel(id); if (!job) return undefined;
		await this.abortJobIfRunning(job);
		this.armSoon(); return this.store.getJob(id);
	}
	private arm(delayMs?: number): void { if (this.stopped) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), delayMs ?? this.intervalMs); }
	private armSoon(): void { this.arm(250); }
	private async tick(): Promise<void> { if (this.stopped) return; try { await this.abortCancelRequestedJobs(); const capacity = this.maxConcurrentRuns - this.activeRuns; if (capacity > 0) { const jobs = this.store.listJobs({ includeDisabled: false }).filter((job) => !job.state.runningAt).slice(0, capacity); for (const job of jobs) { const reserved = await this.reserveAfterBeforeRunEvaluation(job); if (reserved) void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon()); } } } catch (error) { console.error('[loop] scheduler tick failed', error); } finally { this.arm(); } }
	private async reserveAfterBeforeRunEvaluation(job: PiboLoopJob): Promise<{ job: PiboLoopJob; run: PiboLoopRun } | undefined> {
		const fresh = this.store.getJob(job.id) ?? job;
		if (!fresh.enabled || fresh.state.runningAt) return undefined;
		const { evaluation, conditionStates } = await this.evaluateStopPolicy(fresh, 'before-run');
		if (evaluation.finalAction !== 'continue') { this.store.applyStopEvaluation({ jobId: fresh.id, evaluation, conditionStates, disable: true }); return undefined; }
		this.store.applyStopEvaluation({ jobId: fresh.id, evaluation, conditionStates, disable: false });
		if (fresh.mode === 'goal' && !await this.renewGoalBrowserLeases(fresh)) return undefined;
		return this.store.reserveRun(fresh.id);
	}
	private async abortCancelRequestedJobs(): Promise<void> { for (const job of this.store.listJobs({ includeDisabled: true })) { if (job.state.cancelRequestedAt) await this.abortJobIfRunning(job); } }
	private async abortJobIfRunning(job: PiboLoopJob): Promise<void> {
		if (!job.state.runningAt || !job.state.lastRunId) return;
		const sessionId = job.state.lastPiboSessionId;
		if (!sessionId) {
			this.markRunResourcesDirty(job, 'Cancel requested but active session is unavailable; browser lease may still exist');
			return;
		}
		this.cancelledRuns.add(job.state.lastRunId);
		try {
			await this.options.context.emit({ type: 'execution', piboSessionId: sessionId, action: 'abort', id: `loop_cancel_${randomUUID()}` });
		} catch (error) {
			this.cancelledRuns.delete(job.state.lastRunId);
			this.markRunResourcesDirty(job, `Cancel requested but abort failed: ${errorMessage(error)}`);
		}
	}
	private async executeReserved(job: PiboLoopJob, run: PiboLoopRun): Promise<void> {
		this.activeRuns += 1;
		let heartbeat: NodeJS.Timeout | undefined;
		let heartbeatWork: Promise<boolean> | undefined;
		if (job.mode === 'goal' && (job.resources?.browserLeaseIds?.length ?? 0) > 0) {
			const renew = () => { heartbeatWork ??= this.renewGoalBrowserLeases(this.store.getJob(job.id) ?? job, run).finally(() => { heartbeatWork = undefined; }); };
			heartbeat = setInterval(renew, Math.max(10, this.options.resourceCleanup?.browserLeaseRenewIntervalMs ?? 5 * 60_000));
		}
		const stopHeartbeat = async () => { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; await heartbeatWork; };
		try { const result = await this.executeJob(job, run); await stopHeartbeat(); const cancelled = this.cancelledRuns.delete(run.id); if (job.mode === 'goal') this.store.recordGoalProgress(job.id, { timeUsedSeconds: result.timeUsedSeconds }); const outcome: PiboLoopRunOutcome = { status: cancelled ? 'cancelled' : 'ok', piboSessionId: result.piboSessionId, finalAnswer: result.finalAnswer }; const { evaluation, conditionStates } = await this.evaluateStopPolicy(this.store.getJob(job.id) ?? job, 'after-run', run, outcome); this.store.completeRun({ jobId: job.id, runId: run.id, status: outcome.status, piboSessionId: result.piboSessionId, reason: cancelled ? 'cancelled' : evaluation.reason, stopAfterRun: evaluation.finalAction !== 'continue', stopEvaluation: evaluation, conditionStates }); await this.cleanupRunResources(job, run); }
		catch (error) { await stopHeartbeat(); const cancelled = this.cancelledRuns.delete(run.id); const message = errorMessage(error); const fatalProfileError = !cancelled && isUnknownProfileErrorMessage(message); const timeoutAbortFailed = error instanceof LoopRunTimeoutError && error.abortFailed; const outcome: PiboLoopRunOutcome = { status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : message }; const { evaluation, conditionStates } = await this.evaluateStopPolicy(this.store.getJob(job.id) ?? job, 'after-run', run, outcome); this.store.completeRun({ jobId: job.id, runId: run.id, status: outcome.status, error: outcome.error, reason: cancelled ? 'cancelled' : fatalProfileError ? 'unknown-profile' : timeoutAbortFailed ? 'timeout-abort-failed' : evaluation.reason, stopAfterRun: fatalProfileError || timeoutAbortFailed || evaluation.finalAction !== 'continue', stopEvaluation: evaluation, conditionStates }); await this.cleanupRunResources(job, run); if (!cancelled) console.error(`[loop] job ${job.id} failed`, error); }
		finally { await stopHeartbeat(); this.activeRuns -= 1; }
	}
	private async renewGoalBrowserLeases(job: PiboLoopJob, run?: PiboLoopRun): Promise<boolean> {
		const resources = mergeRunResources(job.resources, run?.resources);
		const leaseIds = resources?.browserLeaseIds ?? [];
		if (!resources || leaseIds.length === 0) return true;
		const workerId = resources.workerId || process.env.PIBO_BROWSER_POOL_WORKER_ID || process.env.PIBO_COMPUTE_WORKER_ID || process.env.HOSTNAME || 'local';
		const poolId = this.options.resourceCleanup?.browserPoolId || process.env.PIBO_BROWSER_POOL_ID || 'default';
		const rootDir = this.options.resourceCleanup?.browserPoolRootDir || process.env.PIBO_BROWSER_POOL_ROOT || join(process.env.BROWSER_USE_HOME || join(homedir(), '.browser-use'), 'pibo-browser-pool');
		const identity: BrowserPoolIdentity = { workerId, poolId };
		const paths = browserPoolPaths(rootDir, identity);
		const acquire = this.options.resourceCleanup?.acquireBrowserPoolLease ?? acquireBrowserPoolLease;
		let retainedUntil: string | undefined;
		for (const leaseId of leaseIds) {
			try {
				const result = await acquire(paths, identity, {
					leaseId,
					holder: run ? `loop:${job.id}:run:${run.id}` : `loop:${job.id}`,
					idleTimeoutMs: this.options.resourceCleanup?.browserLeaseIdleTimeoutMs,
					startBrowser: restartRecordedBrowserPoolChrome,
					lockOptions: { holder: run ? `loop:${job.id}:run:${run.id}` : `loop:${job.id}` },
				});
				if (!result.acquired) throw new Error(result.staleReason);
				retainedUntil = result.state.idleExpiresAt ?? retainedUntil;
			} catch (error) {
				const reason = `Browser lease ${leaseId} could not be renewed or reacquired: ${errorMessage(error)}. Authenticated browser access requires operator attention.`;
				this.markRunResourcesDirty(job, reason);
				this.store.updateGoalStatus(job.id, 'blocked');
				return false;
			}
		}
		const updatedAt = new Date().toISOString();
		const next = clearDirtyReason({ ...resources, workerId, cleanupState: 'active', retainedUntil, updatedAt });
		this.store.updateJobResources(job.id, next);
		if (run) this.store.updateRunResources({ jobId: job.id, runId: run.id, resources: next });
		return true;
	}

	private markRunResourcesDirty(job: PiboLoopJob, dirtyReason: string): void {
		const latestJob = this.store.getJob(job.id) ?? job;
		const runId = latestJob.state.lastRunId ?? job.state.lastRunId;
		const latestRun = runId ? this.store.listRuns({ jobId: latestJob.id, limit: 100 }).find((candidate) => candidate.id === runId) : undefined;
		const resources = mergeRunResources(latestJob.resources, latestRun?.resources);
		if (!resources || (!resources.workerId && (resources.browserLeaseIds ?? []).length === 0)) return;
		const nextResources: PiboLoopResourceMetadata = { ...resources, cleanupState: 'dirty', dirtyReason, updatedAt: new Date().toISOString() };
		try {
			if (latestRun) this.store.updateRunResources({ jobId: latestJob.id, runId: latestRun.id, resources: nextResources });
			this.store.updateJobResources(latestJob.id, nextResources);
		} catch (error) {
			console.error(`[loop] failed to mark resource cleanup dirty for job ${latestJob.id}`, error);
		}
	}
	private async cleanupRunResources(job: PiboLoopJob, run: PiboLoopRun): Promise<void> {
		const latestJob = this.store.getJob(job.id) ?? job;
		const latestRun = this.store.listRuns({ jobId: job.id, limit: 100 }).find((candidate) => candidate.id === run.id) ?? run;
		const resources = mergeRunResources(latestJob.resources, latestRun.resources);
		const leaseIds = resources?.browserLeaseIds ?? [];
		if (!resources || leaseIds.length === 0) return;
		const goalStatus = latestJob.mode === 'goal' ? latestJob.state.goalStatus ?? (latestJob.enabled ? 'active' : 'paused') : undefined;
		if (latestJob.mode === 'goal' && latestJob.enabled && goalStatus === 'active') {
			const retained = clearDirtyReason({ ...resources, cleanupState: 'retained', updatedAt: new Date().toISOString() });
			this.store.updateRunResources({ jobId: job.id, runId: run.id, resources: retained });
			this.store.updateJobResources(job.id, retained);
			return;
		}

		const workerId = resources.workerId || process.env.PIBO_BROWSER_POOL_WORKER_ID || process.env.PIBO_COMPUTE_WORKER_ID || process.env.HOSTNAME || 'local';
		const poolId = this.options.resourceCleanup?.browserPoolId || process.env.PIBO_BROWSER_POOL_ID || 'default';
		const rootDir = this.options.resourceCleanup?.browserPoolRootDir || process.env.PIBO_BROWSER_POOL_ROOT || join(process.env.BROWSER_USE_HOME || join(homedir(), '.browser-use'), 'pibo-browser-pool');
		const identity: BrowserPoolIdentity = { workerId, poolId };
		const paths = browserPoolPaths(rootDir, identity);
		const release = this.options.resourceCleanup?.releaseBrowserPoolLease ?? releaseBrowserPoolLease;
		let dirtyReason: string | undefined;

		for (const leaseId of leaseIds) {
			try {
				const result = await release(paths, identity, { leaseId, lockOptions: { holder: `loop:${run.id}` } });
				if (result.cleanupStatus === 'failed' || result.state.state === 'dirty' || (!result.released && !!result.state.activeLeaseId)) dirtyReason = result.lastError || `Browser lease ${leaseId} cleanup failed`;
			} catch (error) {
				dirtyReason = `Browser lease ${leaseId} cleanup failed: ${errorMessage(error)}`;
			}
			if (dirtyReason) break;
		}

		const updatedAt = new Date().toISOString();
		const nextResources: PiboLoopResourceMetadata = dirtyReason
			? { ...resources, workerId, cleanupState: 'dirty', dirtyReason, updatedAt }
			: clearDirtyReason({ ...resources, workerId, cleanupState: 'released', updatedAt });
		try {
			this.store.updateRunResources({ jobId: job.id, runId: run.id, resources: nextResources });
			this.store.updateJobResources(job.id, nextResources);
		} catch (error) {
			console.error(`[loop] failed to record resource cleanup for run ${run.id}`, error);
		}
	}
	private async evaluateStopPolicy(job: PiboLoopJob, phase: 'before-run' | 'after-run', run?: PiboLoopRun, outcome?: PiboLoopRunOutcome): Promise<{ evaluation: PiboLoopStopEvaluationSummary; conditionStates: Record<string, PiboJsonObject> }> {
		return await evaluateLoopStopPolicy({ job, phase, definitions: this.getStopConditionDefinitions(), facts: this.store.createFactReader(job), run, outcome });
	}
	private getStopConditionDefinitions(): PiboLoopStopConditionDefinition[] { return this.options.context.getLoopStopConditionDefinitions?.() ?? this.options.context.getRalphStopConditionDefinitions?.() ?? createBuiltInLoopStopConditions(); }
	private handleOutputEvent(event: PiboOutputEvent): void {
		if (event.type !== 'assistant_usage') return;
		const job = this.store.getLatestGoalForSession(event.piboSessionId);
		if (!job) return;
		const status = job.state.goalStatus ?? (job.enabled ? 'active' : 'paused');
		if (!job.state.runningAt && status !== 'active') return;
		this.store.recordGoalProgress(job.id, { tokens: event.totalTokens });
	}
	private handleProductEvent(event: { type: string; payload: PiboJsonObject; source: string }): void {
		if (event.type !== 'pibo.loop.fact' && event.type !== 'loop.fact' && event.type !== 'pibo.ralph.fact' && event.type !== 'ralph.fact') return;
		const payload = event.payload;
		if (!isJsonObject(payload.payload)) return;
		if (typeof payload.jobId !== 'string' || typeof payload.type !== 'string') return;
		const source = payload.source === 'pi-extension' || payload.source === 'tool' || payload.source === 'plugin' || payload.source === 'pibo' ? payload.source : 'plugin';
		try { this.store.appendRunFact({ jobId: payload.jobId, runId: typeof payload.runId === 'string' ? payload.runId : undefined, piboSessionId: typeof payload.piboSessionId === 'string' ? payload.piboSessionId : undefined, type: payload.type, source: source as PiboLoopRunFact['source'], payload: payload.payload }); } catch (error) { console.error('[loop] failed to append run fact', error); }
	}
	private async executeJob(job: PiboLoopJob, run: PiboLoopRun): Promise<{ piboSessionId: string; finalAnswer: string; timeUsedSeconds: number }> {
		const reusableSessionId = job.mode === 'goal' ? job.state.lastPiboSessionId : undefined;
		const reusableSession = reusableSessionId ? this.options.context.getSession(reusableSessionId) : undefined;
		const continuation = reusableSession !== undefined;
		const session = reusableSession ?? this.createLoopSession(job, run);
		if (reusableSession) {
			this.options.context.updateSession?.(session.id, {
				title: job.name,
				metadata: { ...(session.metadata ?? {}), loopRunId: run.id, loopMode: job.mode },
				...(job.modelOverride ? { activeModel: { ...job.modelOverride } } : {}),
			});
		}
		this.store.attachRunSession(job.id, run.id, session.id);
		const result = await this.emitMessageAndWait(session.id, buildLoopTurnPrompt(job, continuation, this.goalToolsAvailable(job)));
		return { piboSessionId: session.id, ...result };
	}
	private createLoopSession(job: PiboLoopJob, run: PiboLoopRun) {
		const target = this.resolveTarget(job);
		return this.options.context.createSession({
			channel: CHAT_WEB_CHANNEL,
			kind: 'loop',
			profile: job.profile,
			workspace: target.workspace ?? getDefaultPiboWorkspace(),
			title: job.name,
			activeModel: job.modelOverride ? { ...job.modelOverride } : undefined,
			metadata: {
				...(target.metadata ?? {}),
				chatRoomId: target.roomId,
				loopJobId: job.id,
				loopRunId: run.id,
				loopMode: job.mode,
				loopTargetKind: job.target.kind,
				...(job.mode === 'ralph' ? { ralphJobId: job.id, ralphRunId: run.id } : {}),
				...(job.thinkingLevel ? { initialThinkingLevel: job.thinkingLevel } : {}),
				...(job.fastMode !== undefined ? { initialFastMode: job.fastMode } : {}),
			},
		});
	}
	private goalToolsAvailable(job: PiboLoopJob): boolean {
		if (job.mode !== 'goal') return false;
		try { return this.options.context.createProfile?.(job.profile).toolPackages.goalControl !== false; } catch { return true; }
	}
	private resolveTarget(job: PiboLoopJob): { roomId: string; workspace?: string; metadata?: Record<string, unknown> } { if (job.target.kind === 'room') { const room = this.roomService.getRoom(job.target.roomId); if (!room) throw new Error('Target room no longer exists'); if (isPiboRoomArchived(room)) throw new Error('Target room is archived'); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; } const room = this.roomService.ensureDefaultRoom({ name: 'Shared Chat' }); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; }
	private async emitMessageAndWait(piboSessionId: string, text: string): Promise<{ finalAnswer: string; timeUsedSeconds: number }> {
		const eventId = `loop_msg_${randomUUID()}`;
		const startedAt = Date.now();
		return await new Promise<{ finalAnswer: string; timeUsedSeconds: number }>((resolve, reject) => {
			let settled = false;
			let deltaAnswer = '';
			let finalAnswer = '';
			let lastSessionError: string | undefined;
			let timingOut = false;
			let unsubscribe: (() => void) | undefined;
			let timeout: NodeJS.Timeout | undefined;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				unsubscribe?.();
				if (error) reject(error);
				else resolve({ finalAnswer: finalAnswer || deltaAnswer, timeUsedSeconds: Math.max(0, Math.ceil((Date.now() - startedAt) / 1000)) });
			};
			if (this.runTimeoutMs !== undefined) {
				timeout = setTimeout(() => {
					timingOut = true;
					const message = lastSessionError ? `Loop run timed out after session error: ${lastSessionError}` : 'Loop run timed out';
					void this.options.context.emit({ type: 'execution', piboSessionId, action: 'abort', id: `loop_timeout_${randomUUID()}` })
						.then(() => finish(new LoopRunTimeoutError(message)), (abortError) => finish(new LoopRunTimeoutError(`${message}; session abort failed: ${errorMessage(abortError)}`, true)));
				}, this.runTimeoutMs);
			}
			unsubscribe = this.options.context.subscribe((event: PiboOutputEvent) => {
				if (timingOut || event.piboSessionId !== piboSessionId) return;
				if ('eventId' in event && event.eventId !== eventId) return;
				if (event.type === 'assistant_delta') deltaAnswer += event.text;
				if (event.type === 'assistant_message') { finalAnswer = event.text; lastSessionError = undefined; }
				if (event.type === 'message_finished') finish(lastSessionError ? new Error(lastSessionError) : undefined);
				if (event.type === 'session_error') {
					lastSessionError = event.error;
					finish(new Error(event.error));
				}
			});
			this.options.context.emit({ type: 'message', piboSessionId, id: eventId, source: 'service', text }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
		});
	}
}
