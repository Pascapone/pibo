import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { PiboSession } from "../sessions/store.js";
import {
	BestEffortTelemetryService,
	type StoredTelemetryProviderRequest,
	type StoredTelemetryTurn,
	type TelemetryProviderRequestStatus,
	type TelemetryStore,
} from "../data/telemetry.js";
import type { ModelProfile } from "./profiles.js";

type ProviderTelemetryModel = ModelProfile & { api?: string };

type ProviderTelemetryOptions = {
	store?: TelemetryStore;
	session: PiboSession;
	model?: ProviderTelemetryModel;
	onError?: (error: unknown) => void;
};

type ProviderResponseSummary = {
	status?: number;
	headers?: Record<string, string>;
	at?: string;
};

type ProviderRequestStartOptions = {
	at?: string;
	model?: ProviderTelemetryModel;
};

export class PiboProviderTelemetryRecorder {
	private readonly telemetry: BestEffortTelemetryService;
	private activeProviderRequestId?: string;

	constructor(private readonly options: ProviderTelemetryOptions) {
		this.telemetry = new BestEffortTelemetryService(options.store, options.onError);
	}

	recordRequestStart(payload: unknown, options: ProviderRequestStartOptions = {}): StoredTelemetryProviderRequest | undefined {
		if (!this.options.store) return undefined;
		try {
			const turn = this.activeTurn();
			if (!turn) return undefined;
			const now = options.at ?? new Date().toISOString();
			const model = modelInfo(options.model, this.options.model, payload);
			const providerRequestId = `pr_${randomUUID()}`;
			const phaseId = this.nextPhaseId(turn.turnId, "provider_request");
			this.telemetry.upsertPhase({
				phaseId,
				turnId: turn.turnId,
				piboSessionId: turn.piboSessionId,
				rootSessionId: turn.rootSessionId,
				roomId: turn.roomId,
				name: "provider_request",
				status: "open",
				startedAt: now,
				lastProgressAt: now,
				providerRequestId,
				eventId: turn.eventId ?? turn.inputEventId,
				summary: "provider request started",
			});
			this.telemetry.upsertTurn({
				turnId: turn.turnId,
				piboSessionId: turn.piboSessionId,
				rootSessionId: turn.rootSessionId,
				roomId: turn.roomId,
				eventId: turn.eventId ?? turn.inputEventId,
				status: "running",
				currentPhase: "provider_request",
				lastProgressAt: now,
				queueDepth: turn.queueDepth,
				summary: "provider request started",
			});
			const request = this.telemetry.upsertProviderRequest({
				providerRequestId,
				piboSessionId: turn.piboSessionId,
				rootSessionId: turn.rootSessionId,
				roomId: turn.roomId,
				turnId: turn.turnId,
				phaseId,
				provider: model.provider,
				api: model.api,
				model: model.id,
				transport: "sse",
				serviceTier: serviceTierFromPayload(payload),
				status: "started",
				startedAt: now,
				captureMode: "metadata_only",
			});
			this.activeProviderRequestId = request?.providerRequestId ?? providerRequestId;
			return request;
		} catch (error) {
			this.options.onError?.(error);
			return undefined;
		}
	}

	recordResponse(input: ProviderResponseSummary): StoredTelemetryProviderRequest | undefined {
		if (!this.options.store) return undefined;
		try {
			const request = this.activeProviderRequest();
			if (!request) return undefined;
			const now = input.at ?? new Date().toISOString();
			this.telemetry.finishPhase(request.phaseId ?? `${request.turnId}:provider_request`, {
				status: "ok",
				endedAt: now,
				lastProgressAt: now,
				summary: "provider response received",
			});
			const streamPhaseId = `${request.turnId}:provider_stream:${request.providerRequestId}`;
			this.telemetry.upsertPhase({
				phaseId: streamPhaseId,
				turnId: request.turnId,
				piboSessionId: request.piboSessionId,
				rootSessionId: request.rootSessionId,
				roomId: request.roomId,
				name: "provider_stream",
				status: "open",
				startedAt: now,
				lastProgressAt: now,
				providerRequestId: request.providerRequestId,
				eventId: request.eventId,
				summary: "provider response headers received",
			});
			this.telemetry.upsertTurn({
				turnId: request.turnId,
				piboSessionId: request.piboSessionId,
				rootSessionId: request.rootSessionId,
				roomId: request.roomId,
				eventId: request.eventId,
				status: "running",
				currentPhase: "provider_stream",
				lastProgressAt: now,
				summary: "provider response received",
			});
			return this.updateProviderRequest(request, {
				status: "headers",
				responseHeadersAt: now,
				firstByteAt: request.firstByteAt ?? now,
				httpStatus: input.status,
				phaseId: request.phaseId,
			});
		} catch (error) {
			this.options.onError?.(error);
			return undefined;
		}
	}

	private activeTurn(): StoredTelemetryTurn | undefined {
		const detail = this.options.store?.getSessionTelemetry(this.options.session.id, { limit: 10 });
		const active = detail?.activeTurn;
		if (!active || (active.status !== "queued" && active.status !== "running")) return undefined;
		return active;
	}

	private activeProviderRequest(): StoredTelemetryProviderRequest | undefined {
		if (this.activeProviderRequestId) {
			const active = this.options.store?.getProviderRequest(this.activeProviderRequestId);
			if (active && !isTerminalProviderStatus(active.status)) return active;
		}
		const turn = this.activeTurn();
		if (!turn) return undefined;
		const timeline = this.options.store?.getTurnTimeline(turn.turnId, { limit: 100 });
		return [...(timeline?.providerRequests ?? [])].reverse().find((request) => !isTerminalProviderStatus(request.status));
	}

	private nextPhaseId(turnId: string, phaseName: "provider_request"): string {
		const count = this.options.store?.getTurnTimeline(turnId, { limit: 100 })?.phases.filter((phase) => phase.name === phaseName).length ?? 0;
		return count === 0 ? `${turnId}:${phaseName}` : `${turnId}:${phaseName}:${count + 1}`;
	}

	private updateProviderRequest(
		existing: StoredTelemetryProviderRequest,
		input: Partial<Pick<StoredTelemetryProviderRequest, "status" | "responseHeadersAt" | "firstByteAt" | "httpStatus" | "phaseId">>,
	): StoredTelemetryProviderRequest | undefined {
		return this.telemetry.upsertProviderRequest({
			providerRequestId: existing.providerRequestId,
			piboSessionId: existing.piboSessionId,
			rootSessionId: existing.rootSessionId,
			roomId: existing.roomId,
			turnId: existing.turnId,
			phaseId: input.phaseId ?? existing.phaseId,
			provider: existing.provider,
			api: existing.api,
			model: existing.model,
			transport: existing.transport,
			serviceTier: existing.serviceTier,
			status: input.status ?? existing.status,
			responseHeadersAt: input.responseHeadersAt,
			firstByteAt: input.firstByteAt,
			httpStatus: input.httpStatus,
			rawEventCount: existing.rawEventCount,
			normalizedEventCount: existing.normalizedEventCount,
			parseErrorCount: existing.parseErrorCount,
			unknownEventCount: existing.unknownEventCount,
			bytesReceived: existing.bytesReceived,
			eventTypeCounts: existing.eventTypeCounts,
			captureMode: existing.captureMode,
			retentionClass: existing.retentionClass,
		});
	}
}

export function createPiboProviderTelemetryExtension(options: ProviderTelemetryOptions): ExtensionFactory {
	return (pi) => {
		const recorder = new PiboProviderTelemetryRecorder(options);
		pi.on("before_provider_request", (event, ctx) => {
			recorder.recordRequestStart(event.payload, { model: modelFromContext(ctx) ?? options.model });
		});
		pi.on("after_provider_response", (event) => {
			recorder.recordResponse({ status: event.status, headers: event.headers });
		});
	};
}

export function isTerminalProviderStatus(status: TelemetryProviderRequestStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted" || status === "timeout";
}

function modelInfo(primary: ProviderTelemetryModel | undefined, fallback: ProviderTelemetryModel | undefined, payload: unknown): Required<ProviderTelemetryModel> {
	const payloadModel = modelIdFromPayload(payload);
	return {
		provider: primary?.provider ?? fallback?.provider ?? "unknown",
		id: primary?.id ?? fallback?.id ?? payloadModel ?? "unknown",
		api: primary?.api ?? fallback?.api ?? "unknown",
	};
}

function modelFromContext(ctx: unknown): ProviderTelemetryModel | undefined {
	const getModel = typeof ctx === "object" && ctx !== null && "getModel" in ctx ? (ctx as { getModel?: () => unknown }).getModel : undefined;
	if (typeof getModel !== "function") return undefined;
	const model = getModel();
	if (!model || typeof model !== "object") return undefined;
	const candidate = model as { provider?: unknown; id?: unknown; api?: unknown };
	const provider = typeof candidate.provider === "string" && candidate.provider.length > 0 ? candidate.provider : undefined;
	const id = typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : undefined;
	const api = typeof candidate.api === "string" && candidate.api.length > 0 ? candidate.api : undefined;
	return provider && id ? { provider, id, api } : undefined;
}

function modelIdFromPayload(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const value = (payload as { model?: unknown }).model;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function serviceTierFromPayload(payload: unknown): string | undefined {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const value = (payload as { service_tier?: unknown; serviceTier?: unknown }).service_tier ?? (payload as { serviceTier?: unknown }).serviceTier;
	return typeof value === "string" && value.length > 0 ? value.slice(0, 128) : undefined;
}
