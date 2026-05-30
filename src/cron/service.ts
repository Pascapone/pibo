import { randomUUID } from "node:crypto";
import type { PiboChannelContext } from "../channels/types.js";
import type { PiboOutputEvent } from "../core/events.js";
import { getDefaultPiboWorkspace } from "../core/workspace.js";
import { PiboDataStore } from "../data/pibo-store.js";
import { ChatRoomService } from "../apps/chat/data/room-service.js";
import { isPiboRoomArchived } from "../apps/chat/types/rooms.js";
import { getSharedAppLegacyOwnerScope } from "../shared-app.js";
import { formatSchedule } from "./schedule.js";
import { createDefaultPiboCronStore, PiboCronStore } from "./store.js";
import type { PiboCronJob, PiboCronRun, PiboCronStatus } from "./types.js";

const CHAT_WEB_CHANNEL = "pibo.chat-web";

export type PiboCronServiceOptions = {
	store?: PiboCronStore;
	context: PiboChannelContext;
	dataStorePath?: string;
	dataPayloadRootDir?: string;
	intervalMs?: number;
	maxConcurrentRuns?: number;
	runTimeoutMs?: number;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildCronPrompt(job: PiboCronJob): string {
	return [
		"You are running a scheduled Pibo job.",
		`Job: ${job.name}`,
		`Schedule: ${formatSchedule(job.schedule, job.scheduleUi)}`,
		`Target: ${job.target.kind}`,
		"",
		"Complete the scheduled task below. Return the result in this session. Do not create another cron job unless the original task explicitly asks for it.",
		"",
		"Task:",
		job.prompt,
	].join("\n");
}

export class PiboCronService {
	private readonly store: PiboCronStore;
	private readonly dataStore: PiboDataStore;
	private readonly roomService: ChatRoomService;
	private readonly intervalMs: number;
	private readonly maxConcurrentRuns: number;
	private readonly runTimeoutMs: number;
	private timer: NodeJS.Timeout | undefined;
	private activeRuns = 0;
	private stopped = true;

	constructor(private readonly options: PiboCronServiceOptions) {
		this.store = options.store ?? createDefaultPiboCronStore();
		this.dataStore = new PiboDataStore(options.dataStorePath, { payloadRootDir: options.dataPayloadRootDir });
		this.roomService = new ChatRoomService(this.dataStore);
		this.intervalMs = options.intervalMs ?? 60_000;
		this.maxConcurrentRuns = Math.max(1, options.maxConcurrentRuns ?? 2);
		this.runTimeoutMs = options.runTimeoutMs ?? 30 * 60_000;
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.store.recoverInterruptedRuns();
		this.arm(1000);
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.dataStore.close();
		this.store.close();
	}

	status(): PiboCronStatus {
		return { enabled: !this.stopped, ...this.store.status() };
	}

	async runJobNow(ownerScope: string, id: string): Promise<PiboCronRun> {
		void ownerScope;
		const reserved = this.store.reserveManualRun(getSharedAppLegacyOwnerScope(), id);
		if (!reserved) throw new Error("Cron job not found");
		void this.executeReserved(reserved.job, reserved.run).finally(() => this.armSoon());
		return reserved.run;
	}

	private arm(delayMs?: number): void {
		if (this.stopped) return;
		if (this.timer) clearTimeout(this.timer);
		const status = this.store.status();
		const nextDelay = status.nextRunAt ? Math.max(1000, new Date(status.nextRunAt).getTime() - Date.now()) : this.intervalMs;
		this.timer = setTimeout(() => void this.tick(), Math.min(delayMs ?? nextDelay, this.intervalMs));
	}

	private armSoon(): void {
		this.arm(1000);
	}

	private async tick(): Promise<void> {
		if (this.stopped) return;
		try {
			const capacity = this.maxConcurrentRuns - this.activeRuns;
			if (capacity > 0) {
				const due = this.store.reserveDueRuns(capacity);
				for (const { job, run } of due) void this.executeReserved(job, run).finally(() => this.armSoon());
			}
		} catch (error) {
			console.error("[cron] scheduler tick failed", error);
		} finally {
			this.arm();
		}
	}

	private async executeReserved(job: PiboCronJob, run: PiboCronRun): Promise<void> {
		this.activeRuns += 1;
		try {
			const piboSessionId = await this.executeJob(job, run);
			this.store.completeRun({ jobId: job.id, runId: run.id, status: "ok", piboSessionId });
		} catch (error) {
			this.store.completeRun({ jobId: job.id, runId: run.id, status: "error", error: errorMessage(error) });
			console.error(`[cron] job ${job.id} failed`, error);
		} finally {
			this.activeRuns -= 1;
		}
	}

	private async executeJob(job: PiboCronJob, run: PiboCronRun): Promise<string> {
		const target = this.resolveTarget(job);
		const session = this.options.context.createSession({
			channel: CHAT_WEB_CHANNEL,
			kind: "cron",
			profile: job.profile,
			ownerScope: getSharedAppLegacyOwnerScope(),
			workspace: target.workspace ?? getDefaultPiboWorkspace(),
			title: job.name,
			metadata: {
				...(target.metadata ?? {}),
				chatRoomId: target.roomId,
				cronJobId: job.id,
				cronRunId: run.id,
				cronTargetKind: job.target.kind,
			},
		});
		await this.emitMessageAndWait(session.id, buildCronPrompt(job));
		return session.id;
	}

	private resolveTarget(job: PiboCronJob): { roomId: string; workspace?: string; metadata?: Record<string, unknown> } {
		if (job.target.kind === "room") {
			const room = this.roomService.getRoom(job.target.roomId);
			if (!room) throw new Error("Target room no longer exists");
			if (isPiboRoomArchived(room)) throw new Error("Target room is archived");
			return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() };
		}
		const room = this.roomService.ensureDefaultRoom({ ownerScope: getSharedAppLegacyOwnerScope(), principalId: getSharedAppLegacyOwnerScope(), name: "Shared Chat" });
		return { roomId: room.id, workspace: room.workspace ?? getDefaultPiboWorkspace() };
	}

	private async emitMessageAndWait(piboSessionId: string, text: string): Promise<void> {
		const eventId = `cron_msg_${randomUUID()}`;
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let unsubscribe: (() => void) | undefined;
			const timeout = setTimeout(() => {
				finish(new Error("Cron run timed out"));
			}, this.runTimeoutMs);
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				unsubscribe?.();
				if (error) reject(error);
				else resolve();
			};
			unsubscribe = this.options.context.subscribe((event: PiboOutputEvent) => {
				if (event.piboSessionId !== piboSessionId) return;
				if ("eventId" in event && event.eventId !== eventId) return;
				if (event.type === "message_finished") finish();
				if (event.type === "session_error") finish(new Error(event.error));
			});
			this.options.context.emit({ type: "message", piboSessionId, id: eventId, source: "service", text }).catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
		});
	}
}
