import { randomUUID } from 'node:crypto';
import type { PiboChannelContext } from '../channels/types.js';
import type { PiboJsonObject, PiboOutputEvent } from '../core/events.js';
import { getDefaultPiboWorkspace } from '../core/workspace.js';
import { PiboDataStore } from '../data/pibo-store.js';
import { ChatRoomService } from '../apps/chat/data/room-service.js';
import { isPiboRoomArchived } from '../apps/chat/types/rooms.js';
import { createDefaultPiboRalphStore, PiboRalphStore } from './store.js';
import { createBuiltInRalphStopConditions, evaluateRalphStopPolicy } from './stopping.js';
import type { PiboRalphJob, PiboRalphRun, PiboRalphRunFact, PiboRalphRunOutcome, PiboRalphStatus, PiboRalphStopConditionDefinition, PiboRalphStopEvaluationSummary } from './types.js';

const CHAT_WEB_CHANNEL = 'pibo.chat-web';

export type PiboRalphServiceOptions = { store?: PiboRalphStore; context: PiboChannelContext; dataStorePath?: string; dataPayloadRootDir?: string; intervalMs?: number; maxConcurrentRuns?: number; runTimeoutMs?: number };
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function buildRalphPrompt(job: PiboRalphJob): string { return ['You are running a continuous Pibo Ralph job.', `Job: ${job.name}`, `Target: ${job.target.kind}`, '', 'Complete the task below. Return the result in this session. When this session finishes, Ralph may start a fresh session with the same task unless a configured stop condition is satisfied.', 'Important: if this job uses a promise-complete stop condition, do not quote, negate, explain, or mention its literal completion marker unless the task is fully complete and you intend to stop the job.', '', 'Task:', job.prompt].join('\n'); }
function isJsonObject(value: unknown): value is PiboJsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }

export class PiboRalphService {
	private readonly store: PiboRalphStore;
	private readonly dataStore: PiboDataStore;
	private readonly roomService: ChatRoomService;
	private readonly intervalMs: number;
	private readonly maxConcurrentRuns: number;
	private readonly runTimeoutMs: number;
	private timer: NodeJS.Timeout | undefined;
	private activeRuns = 0;
	private stopped = true;
	private cancelledRuns = new Set<string>();
	private unsubscribeProductEvents: (() => void) | undefined;
	constructor(private readonly options: PiboRalphServiceOptions) {
		this.store = options.store ?? createDefaultPiboRalphStore();
		this.dataStore = new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
		this.roomService = new ChatRoomService(this.dataStore);
		this.intervalMs = options.intervalMs ?? 5_000;
		this.maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 2);
		this.runTimeoutMs = options.runTimeoutMs ?? 30 * 60_000;
	}
	start(): void { if (!this.stopped) return; this.stopped = false; this.store.recoverInterruptedRuns(); this.unsubscribeProductEvents = this.options.context.subscribeProductEvents?.((event) => this.handleProductEvent(event)); this.arm(250); }
	stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.unsubscribeProductEvents?.(); this.unsubscribeProductEvents = undefined; this.dataStore.close(); this.store.close(); }
	status(): PiboRalphStatus { return { enabled: !this.stopped, ...this.store.status() }; }
	async startJob(ownerScope: string, id: string): Promise<PiboRalphRun | undefined> { const job = this.store.updateJob(ownerScope, id, { enabled: true }); if (!job) return undefined; const reserved = await this.reserveAfterBeforeRunEvaluation(job); if (!reserved) return undefined; void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon()); return reserved.run; }
	stopJob(ownerScope: string, id: string): PiboRalphJob | undefined { const job = this.store.requestStop(ownerScope, id); this.armSoon(); return job; }
	async cancelJob(ownerScope: string, id: string): Promise<PiboRalphJob | undefined> {
		const job = this.store.requestCancel(ownerScope, id); if (!job) return undefined;
		await this.abortJobIfRunning(job);
		this.armSoon(); return this.store.getOwnedJob(ownerScope, id);
	}
	private arm(delayMs?: number): void { if (this.stopped) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), delayMs ?? this.intervalMs); }
	private armSoon(): void { this.arm(250); }
	private async tick(): Promise<void> { if (this.stopped) return; try { await this.abortCancelRequestedJobs(); const capacity = this.maxConcurrentRuns - this.activeRuns; if (capacity > 0) { const jobs = this.store.listJobs({ includeDisabled: false }).filter((job) => !job.state.runningAt).slice(0, capacity); for (const job of jobs) { const reserved = await this.reserveAfterBeforeRunEvaluation(job); if (reserved) void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon()); } } } catch (error) { console.error('[ralph] scheduler tick failed', error); } finally { this.arm(); } }
	private async reserveAfterBeforeRunEvaluation(job: PiboRalphJob): Promise<{ job: PiboRalphJob; run: PiboRalphRun } | undefined> {
		const fresh = this.store.getJob(job.id) ?? job;
		if (!fresh.enabled || fresh.state.runningAt) return undefined;
		const { evaluation, conditionStates } = await this.evaluateStopPolicy(fresh, 'before-run');
		if (evaluation.finalAction !== 'continue') { this.store.applyStopEvaluation({ jobId: fresh.id, evaluation, conditionStates, disable: true }); return undefined; }
		this.store.applyStopEvaluation({ jobId: fresh.id, evaluation, conditionStates, disable: false });
		return this.store.reserveRun(fresh.ownerScope, fresh.id);
	}
	private async abortCancelRequestedJobs(): Promise<void> { for (const job of this.store.listJobs({ includeDisabled: true })) { if (job.state.cancelRequestedAt) await this.abortJobIfRunning(job); } }
	private async abortJobIfRunning(job: PiboRalphJob): Promise<void> { const sessionId = job.state.lastPiboSessionId; if (sessionId && job.state.runningAt && job.state.lastRunId) { this.cancelledRuns.add(job.state.lastRunId); await this.options.context.emit({ type: 'execution', piboSessionId: sessionId, action: 'abort', id: `ralph_cancel_${randomUUID()}` }); } }
	private async executeReserved(job: PiboRalphJob, run: PiboRalphRun): Promise<void> {
		this.activeRuns += 1;
		try { const result = await this.executeJob(job, run); const cancelled = this.cancelledRuns.delete(run.id); const outcome: PiboRalphRunOutcome = { status: cancelled ? 'cancelled' : 'ok', piboSessionId: result.piboSessionId, finalAnswer: result.finalAnswer }; const { evaluation, conditionStates } = await this.evaluateStopPolicy(this.store.getJob(job.id) ?? job, 'after-run', run, outcome); this.store.completeRun({ jobId: job.id, runId: run.id, status: outcome.status, piboSessionId: result.piboSessionId, reason: cancelled ? 'cancelled' : evaluation.reason, stopAfterRun: evaluation.finalAction !== 'continue', stopEvaluation: evaluation, conditionStates }); }
		catch (error) { const cancelled = this.cancelledRuns.delete(run.id); const outcome: PiboRalphRunOutcome = { status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : errorMessage(error) }; const { evaluation, conditionStates } = await this.evaluateStopPolicy(this.store.getJob(job.id) ?? job, 'after-run', run, outcome); this.store.completeRun({ jobId: job.id, runId: run.id, status: outcome.status, error: outcome.error, reason: cancelled ? 'cancelled' : evaluation.reason, stopAfterRun: evaluation.finalAction !== 'continue', stopEvaluation: evaluation, conditionStates }); if (!cancelled) console.error(`[ralph] job ${job.id} failed`, error); }
		finally { this.activeRuns -= 1; }
	}
	private async evaluateStopPolicy(job: PiboRalphJob, phase: 'before-run' | 'after-run', run?: PiboRalphRun, outcome?: PiboRalphRunOutcome): Promise<{ evaluation: PiboRalphStopEvaluationSummary; conditionStates: Record<string, PiboJsonObject> }> {
		return await evaluateRalphStopPolicy({ job, phase, definitions: this.getStopConditionDefinitions(), facts: this.store.createFactReader(job), run, outcome });
	}
	private getStopConditionDefinitions(): PiboRalphStopConditionDefinition[] { return this.options.context.getRalphStopConditionDefinitions?.() ?? createBuiltInRalphStopConditions(); }
	private handleProductEvent(event: { type: string; payload: PiboJsonObject; source: string }): void {
		if (event.type !== 'pibo.ralph.fact' && event.type !== 'ralph.fact') return;
		const payload = event.payload;
		if (!isJsonObject(payload.payload)) return;
		if (typeof payload.ownerScope !== 'string' || typeof payload.jobId !== 'string' || typeof payload.type !== 'string') return;
		const source = payload.source === 'pi-extension' || payload.source === 'tool' || payload.source === 'plugin' || payload.source === 'pibo' ? payload.source : 'plugin';
		try { this.store.appendRunFact({ ownerScope: payload.ownerScope, jobId: payload.jobId, runId: typeof payload.runId === 'string' ? payload.runId : undefined, piboSessionId: typeof payload.piboSessionId === 'string' ? payload.piboSessionId : undefined, type: payload.type, source: source as PiboRalphRunFact['source'], payload: payload.payload }); } catch (error) { console.error('[ralph] failed to append run fact', error); }
	}
	private async executeJob(job: PiboRalphJob, run: PiboRalphRun): Promise<{ piboSessionId: string; finalAnswer: string }> {
		const target = this.resolveTarget(job);
		const session = this.options.context.createSession({
			channel: CHAT_WEB_CHANNEL,
			kind: 'ralph',
			profile: job.profile,
			ownerScope: job.ownerScope,
			workspace: target.workspace ?? getDefaultPiboWorkspace(),
			title: job.name,
			activeModel: job.modelOverride ? { ...job.modelOverride } : undefined,
			metadata: {
				...(target.metadata ?? {}),
				chatRoomId: target.roomId,
				ralphJobId: job.id,
				ralphRunId: run.id,
				ralphTargetKind: job.target.kind,
				...(job.thinkingLevel ? { initialThinkingLevel: job.thinkingLevel } : {}),
				...(job.fastMode !== undefined ? { initialFastMode: job.fastMode } : {}),
			},
		});
		this.store.attachRunSession(job.id, run.id, session.id);
		const finalAnswer = await this.emitMessageAndWait(session.id, buildRalphPrompt(job), { isCancelled: () => this.cancelledRuns.has(run.id) }); return { piboSessionId: session.id, finalAnswer };
	}
	private resolveTarget(job: PiboRalphJob): { roomId: string; workspace?: string; metadata?: Record<string, unknown> } { if (job.target.kind === 'room') { const room = this.roomService.getRoom(job.target.roomId); if (!room) throw new Error('Target room no longer exists'); if (isPiboRoomArchived(room)) throw new Error('Target room is archived'); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; } const room = this.roomService.ensureDefaultRoom({ ownerScope: job.ownerScope, principalId: job.target.principalId, name: 'Personal Chat' }); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; }
	private async emitMessageAndWait(piboSessionId: string, text: string, options: { isCancelled?: () => boolean } = {}): Promise<string> {
		const eventId = `ralph_msg_${randomUUID()}`;
		return await new Promise<string>((resolve, reject) => { let settled = false; let deltaAnswer = ''; let finalAnswer = ''; let lastSessionError: string | undefined; let unsubscribe: (() => void) | undefined; const timeout = setTimeout(() => finish(new Error(lastSessionError ? `Ralph run timed out after session error: ${lastSessionError}` : 'Ralph run timed out')), this.runTimeoutMs); const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); unsubscribe?.(); if (error) reject(error); else resolve(finalAnswer || deltaAnswer); }; unsubscribe = this.options.context.subscribe((event: PiboOutputEvent) => { if (event.piboSessionId !== piboSessionId) return; if ('eventId' in event && event.eventId !== eventId) return; if (event.type === 'assistant_delta') deltaAnswer += event.text; if (event.type === 'assistant_message') finalAnswer = event.text; if (event.type === 'message_finished') finish(); if (event.type === 'session_error') { lastSessionError = event.error; if (options.isCancelled?.()) finish(new Error(event.error)); } }); this.options.context.emit({ type: 'message', piboSessionId, id: eventId, source: 'service', text }).catch((error) => finish(error instanceof Error ? error : new Error(String(error)))); });
	}
}
