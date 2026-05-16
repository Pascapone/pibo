import type { PiboOutputEvent, PiboEventSource, PiboJsonObject, PiboSessionStatus } from "./events.js";
import type { PiboSession } from "../sessions/store.js";
import {
	BestEffortTelemetryService,
	type TelemetryPhaseName,
	type TelemetryPhaseStatus,
	type TelemetryStore,
	type TelemetryTurnSource,
	type TelemetryTurnStatus,
} from "../data/telemetry.js";

type RuntimeTelemetryContext = {
	session?: PiboSession;
	status?: PiboSessionStatus;
};

type TurnContext = {
	turnId: string;
	eventId?: string;
	piboSessionId: string;
	rootSessionId?: string;
	roomId?: string;
	source: TelemetryTurnSource;
	queueDepth?: number;
};

const TERMINAL_TURN_STATUSES = new Set<TelemetryTurnStatus>(["ok", "error", "aborted", "timeout"]);

export class PiboRuntimeTelemetryRecorder {
	private readonly telemetry: BestEffortTelemetryService;

	constructor(private readonly store?: TelemetryStore, private readonly onError?: (error: unknown) => void) {
		this.telemetry = new BestEffortTelemetryService(store, onError);
	}

	recordOutput(event: PiboOutputEvent, context: RuntimeTelemetryContext = {}): void {
		if (!this.store) return;
		try {
			this.recordOutputUnsafe(event, context);
		} catch (error) {
			this.onError?.(error);
		}
	}

	private recordOutputUnsafe(event: PiboOutputEvent, context: RuntimeTelemetryContext): void {
		switch (event.type) {
			case "message_queued":
				this.recordMessageQueued(event, context);
				return;
			case "message_started":
				this.recordMessageStarted(event, context);
				return;
			case "message_finished":
				this.recordMessageFinished(event, context);
				return;
			case "session_error":
				this.recordTurnTerminal(event, context, "error", "error", event.error);
				return;
			case "execution_result":
				this.recordExecutionResult(event, context);
				return;
			default:
				return;
		}
	}

	private recordMessageQueued(
		event: Extract<PiboOutputEvent, { type: "message_queued" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, event.source, context);
		if (!turn) return;
		const now = new Date().toISOString();
		const queueDepth = event.queuedMessages;
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			inputEventId: turn.eventId,
			eventId: turn.eventId,
			source: turn.source,
			status: "queued",
			currentPhase: "queued",
			queuedAt: now,
			lastProgressAt: now,
			queuedBehind: Math.max(0, queueDepth - 1),
			queueDepth,
			summary: "message queued",
			metadata: sessionMetadata(context.session),
		});
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, "queued"),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: "queued",
			status: "open",
			startedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: "waiting in routed-session queue",
		});
	}

	private recordMessageStarted(
		event: Extract<PiboOutputEvent, { type: "message_started" }>,
		context: RuntimeTelemetryContext,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, event.source, context);
		if (!turn) return;
		const now = new Date().toISOString();
		this.telemetry.finishPhase(phaseId(turn.turnId, "queued"), { status: "ok", endedAt: now, lastProgressAt: now });
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, "message_started"),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: "message_started",
			status: "open",
			startedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: "routed message started",
		});
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			inputEventId: turn.eventId,
			eventId: turn.eventId,
			source: turn.source,
			status: "running",
			currentPhase: "message_started",
			startedAt: now,
			lastProgressAt: now,
			queueDepth: turn.queueDepth,
			summary: "message processing started",
			metadata: sessionMetadata(context.session),
		});
	}

	private recordMessageFinished(
		event: Extract<PiboOutputEvent, { type: "message_finished" }>,
		context: RuntimeTelemetryContext,
	): void {
		this.recordTurnTerminal(event, context, "ok", "finish", "message finished");
	}

	private recordExecutionResult(
		event: Extract<PiboOutputEvent, { type: "execution_result" }>,
		context: RuntimeTelemetryContext,
	): void {
		if (event.action === "abort" || event.action === "dispose" || event.action === "kill_all") {
			this.recordTurnTerminal(event, context, "aborted", "abort", `${event.action} requested`);
			return;
		}
		if (event.action === "clear_queue") {
			this.recordTurnProgress(event, context, "queued", "clear_queue requested");
		}
	}

	private recordTurnProgress(
		event: Pick<PiboOutputEvent, "piboSessionId"> & { eventId?: string },
		context: RuntimeTelemetryContext,
		phaseName: TelemetryPhaseName,
		summary: string,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context) ?? this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const now = new Date().toISOString();
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, phaseName),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: phaseName,
			status: "open",
			startedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary,
		});
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			eventId: turn.eventId,
			status: "running",
			currentPhase: phaseName,
			lastProgressAt: now,
			queueDepth: turn.queueDepth,
			summary,
		});
	}

	private recordTurnTerminal(
		event: Pick<PiboOutputEvent, "piboSessionId"> & { eventId?: string },
		context: RuntimeTelemetryContext,
		status: Extract<TelemetryTurnStatus, "ok" | "error" | "aborted" | "timeout">,
		phaseName: TelemetryPhaseName,
		summary: string,
	): void {
		const turn = this.turnContextForEvent(event.piboSessionId, event.eventId, undefined, context) ?? this.activeTurnContext(event.piboSessionId, context);
		if (!turn) return;
		const now = new Date().toISOString();
		this.finishOpenPhases(turn.turnId, terminalPhaseStatus(status), now);
		this.telemetry.upsertPhase({
			phaseId: phaseId(turn.turnId, phaseName),
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			name: phaseName,
			status: terminalPhaseStatus(status),
			startedAt: now,
			endedAt: now,
			lastProgressAt: now,
			eventId: turn.eventId,
			summary: safeSummary(summary),
		});
		this.telemetry.upsertTurn({
			turnId: turn.turnId,
			piboSessionId: turn.piboSessionId,
			rootSessionId: turn.rootSessionId,
			roomId: turn.roomId,
			eventId: turn.eventId,
			status,
			currentPhase: phaseName,
			completedAt: now,
			lastProgressAt: now,
			queueDepth: turn.queueDepth,
			summary: safeSummary(summary),
		});
	}

	private finishOpenPhases(turnId: string, status: TelemetryPhaseStatus, now: string): void {
		const timeline = this.store?.getTurnTimeline(turnId, { limit: 100 });
		for (const phase of timeline?.phases ?? []) {
			if (phase.status !== "open") continue;
			this.telemetry.finishPhase(phase.phaseId, { status, endedAt: now, lastProgressAt: now });
		}
	}

	private turnContextForEvent(
		piboSessionId: string,
		eventId: string | undefined,
		source: PiboEventSource | undefined,
		context: RuntimeTelemetryContext,
	): TurnContext | undefined {
		if (!eventId) return undefined;
		const rootSessionId = rootSessionIdFor(context.session, piboSessionId);
		return {
			turnId: turnIdForEvent(eventId),
			eventId,
			piboSessionId,
			rootSessionId,
			roomId: roomIdFor(context.session),
			source: telemetrySource(source),
			queueDepth: context.status?.queuedMessages,
		};
	}

	private activeTurnContext(piboSessionId: string, context: RuntimeTelemetryContext): TurnContext | undefined {
		const detail = this.store?.getSessionTelemetry(piboSessionId, { limit: 10 });
		const active = detail?.activeTurn;
		if (!active || TERMINAL_TURN_STATUSES.has(active.status)) return undefined;
		return {
			turnId: active.turnId,
			eventId: active.eventId ?? active.inputEventId,
			piboSessionId,
			rootSessionId: active.rootSessionId ?? rootSessionIdFor(context.session, piboSessionId),
			roomId: active.roomId ?? roomIdFor(context.session),
			source: active.source,
			queueDepth: context.status?.queuedMessages ?? active.queueDepth,
		};
	}
}

export function turnIdForEvent(eventId: string): string {
	return `turn_${eventId}`;
}

function phaseId(turnId: string, phaseName: TelemetryPhaseName): string {
	return `${turnId}:${phaseName}`;
}

function telemetrySource(source: PiboEventSource | undefined): TelemetryTurnSource {
	if (source === "user") return "user";
	if (source === "ui") return "ui";
	if (source === "service") return "system";
	return "rpc";
}

function terminalPhaseStatus(status: TelemetryTurnStatus): TelemetryPhaseStatus {
	if (status === "ok") return "ok";
	if (status === "aborted") return "aborted";
	if (status === "timeout") return "timeout";
	return "error";
}

function rootSessionIdFor(session: PiboSession | undefined, fallback: string): string {
	if (!session) return fallback;
	if (session.parentId) {
		const value = session.metadata?.rootSessionId;
		return typeof value === "string" && value.length > 0 ? value : session.parentId;
	}
	return session.id;
}

function roomIdFor(session: PiboSession | undefined): string | undefined {
	const value = session?.metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sessionMetadata(session: PiboSession | undefined): PiboJsonObject {
	const metadata: PiboJsonObject = {};
	if (session?.channel) metadata.channel = session.channel;
	if (session?.kind) metadata.kind = session.kind;
	if (session?.profile) metadata.profile = session.profile;
	return metadata;
}

function safeSummary(summary: string): string {
	return summary.replace(/\s+/g, " ").trim().slice(0, 512);
}
