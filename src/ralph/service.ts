import { randomUUID } from 'node:crypto';
import type { PiboChannelContext } from '../channels/types.js';
import type { PiboOutputEvent } from '../core/events.js';
import { getDefaultPiboWorkspace } from '../core/workspace.js';
import { PiboDataStore } from '../data/pibo-store.js';
import { ChatRoomService } from '../apps/chat/data/room-service.js';
import { isPiboRoomArchived } from '../apps/chat/types/rooms.js';
import { createDefaultPiboRalphStore, PiboRalphStore } from './store.js';
import type { PiboRalphJob, PiboRalphRun, PiboRalphStatus } from './types.js';

const CHAT_WEB_CHANNEL = 'pibo.chat-web';
const PROMISE_COMPLETE_STOP_TOKEN = '<promise>COMPLETE</promise>';

export type PiboRalphServiceOptions = { store?: PiboRalphStore; context: PiboChannelContext; dataStorePath?: string; dataPayloadRootDir?: string; intervalMs?: number; maxConcurrentRuns?: number; runTimeoutMs?: number };
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function buildRalphPrompt(job: PiboRalphJob): string { return ['You are running a continuous Pibo Ralph job.', `Job: ${job.name}`, `Target: ${job.target.kind}`, '', `Complete the task below. Return the result in this session. When this session finishes, Ralph may start a fresh session with the same task. If your final answer contains the exact sequence ${PROMISE_COMPLETE_STOP_TOKEN}, Ralph will stop and not start another iteration.`, '', 'Task:', job.prompt].join('\n'); }

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
	constructor(private readonly options: PiboRalphServiceOptions) {
		this.store = options.store ?? createDefaultPiboRalphStore();
		this.dataStore = new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
		this.roomService = new ChatRoomService(this.dataStore);
		this.intervalMs = options.intervalMs ?? 5_000;
		this.maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 2);
		this.runTimeoutMs = options.runTimeoutMs ?? 30 * 60_000;
	}
	start(): void { if (!this.stopped) return; this.stopped = false; this.store.recoverInterruptedRuns(); this.arm(250); }
	stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.dataStore.close(); this.store.close(); }
	status(): PiboRalphStatus { return { enabled: !this.stopped, ...this.store.status() }; }
	async startJob(ownerScope: string, id: string): Promise<PiboRalphRun | undefined> { const reserved = this.store.reserveRun(ownerScope, id); if (!reserved) return undefined; void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon()); return reserved.run; }
	stopJob(ownerScope: string, id: string): PiboRalphJob | undefined { const job = this.store.requestStop(ownerScope, id); this.armSoon(); return job; }
	async cancelJob(ownerScope: string, id: string): Promise<PiboRalphJob | undefined> {
		const job = this.store.requestCancel(ownerScope, id); if (!job) return undefined;
		await this.abortJobIfRunning(job);
		this.armSoon(); return this.store.getOwnedJob(ownerScope, id);
	}
	private arm(delayMs?: number): void { if (this.stopped) return; if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.tick(), delayMs ?? this.intervalMs); }
	private armSoon(): void { this.arm(250); }
	private async tick(): Promise<void> { if (this.stopped) return; try { await this.abortCancelRequestedJobs(); const capacity = this.maxConcurrentRuns - this.activeRuns; if (capacity > 0) { const due = this.store.reserveDueRuns(capacity); for (const { job, run } of due) void this.executeReserved(job, run).finally(() => this.armSoon()); } } catch (error) { console.error('[ralph] scheduler tick failed', error); } finally { this.arm(); } }
	private async abortCancelRequestedJobs(): Promise<void> { for (const job of this.store.listJobs({ includeDisabled: true })) { if (job.state.cancelRequestedAt) await this.abortJobIfRunning(job); } }
	private async abortJobIfRunning(job: PiboRalphJob): Promise<void> { const sessionId = job.state.lastPiboSessionId; if (sessionId && job.state.runningAt && job.state.lastRunId) { this.cancelledRuns.add(job.state.lastRunId); await this.options.context.emit({ type: 'execution', piboSessionId: sessionId, action: 'abort', id: `ralph_cancel_${randomUUID()}` }); } }
	private async executeReserved(job: PiboRalphJob, run: PiboRalphRun): Promise<void> {
		this.activeRuns += 1;
		try { const result = await this.executeJob(job, run); const cancelled = this.cancelledRuns.delete(run.id); const promiseComplete = !cancelled && result.finalAnswer.includes(PROMISE_COMPLETE_STOP_TOKEN); this.store.completeRun({ jobId: job.id, runId: run.id, status: cancelled ? 'cancelled' : 'ok', piboSessionId: result.piboSessionId, reason: cancelled ? 'cancelled' : promiseComplete ? 'promise-complete' : undefined, stopAfterRun: promiseComplete }); }
		catch (error) { const cancelled = this.cancelledRuns.delete(run.id); this.store.completeRun({ jobId: job.id, runId: run.id, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : errorMessage(error), reason: cancelled ? 'cancelled' : undefined }); if (!cancelled) console.error(`[ralph] job ${job.id} failed`, error); }
		finally { this.activeRuns -= 1; }
	}
	private async executeJob(job: PiboRalphJob, run: PiboRalphRun): Promise<{ piboSessionId: string; finalAnswer: string }> {
		const target = this.resolveTarget(job);
		const session = this.options.context.createSession({ channel: CHAT_WEB_CHANNEL, kind: 'ralph', profile: job.profile, ownerScope: job.ownerScope, workspace: target.workspace ?? getDefaultPiboWorkspace(), title: job.name, metadata: { ...(target.metadata ?? {}), chatRoomId: target.roomId, ralphJobId: job.id, ralphRunId: run.id, ralphTargetKind: job.target.kind } });
		this.store.attachRunSession(job.id, run.id, session.id);
		const finalAnswer = await this.emitMessageAndWait(session.id, buildRalphPrompt(job), { isCancelled: () => this.cancelledRuns.has(run.id) }); return { piboSessionId: session.id, finalAnswer };
	}
	private resolveTarget(job: PiboRalphJob): { roomId: string; workspace?: string; metadata?: Record<string, unknown> } { if (job.target.kind === 'room') { const room = this.roomService.getRoom(job.target.roomId); if (!room) throw new Error('Target room no longer exists'); if (isPiboRoomArchived(room)) throw new Error('Target room is archived'); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; } const room = this.roomService.ensureDefaultRoom({ ownerScope: job.ownerScope, principalId: job.target.principalId, name: 'Personal Chat' }); return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() }; }
	private async emitMessageAndWait(piboSessionId: string, text: string, options: { isCancelled?: () => boolean } = {}): Promise<string> {
		const eventId = `ralph_msg_${randomUUID()}`;
		return await new Promise<string>((resolve, reject) => { let settled = false; let deltaAnswer = ''; let finalAnswer = ''; let lastSessionError: string | undefined; let unsubscribe: (() => void) | undefined; const timeout = setTimeout(() => finish(new Error(lastSessionError ? `Ralph run timed out after session error: ${lastSessionError}` : 'Ralph run timed out')), this.runTimeoutMs); const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); unsubscribe?.(); if (error) reject(error); else resolve(finalAnswer || deltaAnswer); }; unsubscribe = this.options.context.subscribe((event: PiboOutputEvent) => { if (event.piboSessionId !== piboSessionId) return; if ('eventId' in event && event.eventId !== eventId) return; if (event.type === 'assistant_delta') deltaAnswer += event.text; if (event.type === 'assistant_message') finalAnswer = event.text; if (event.type === 'message_finished') finish(); if (event.type === 'session_error') { lastSessionError = event.error; if (options.isCancelled?.()) finish(new Error(event.error)); } }); this.options.context.emit({ type: 'message', piboSessionId, id: eventId, source: 'service', text }).catch((error) => finish(error instanceof Error ? error : new Error(String(error)))); });
	}
}
