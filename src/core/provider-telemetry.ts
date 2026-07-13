import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PiboSession } from "../sessions/store.js";
import {
	BestEffortTelemetryService,
	type StoredTelemetryProviderRequest,
	type StoredTelemetryTurn,
	type TelemetryProviderRequestStatus,
	type TelemetryStore,
} from "../data/telemetry.js";
import type { AsyncTelemetryWriter } from "../data/telemetry-writer.js";
import type { ModelProfile } from "./profiles.js";
import { normalizeSessionErrorDetails } from "./session-errors.js";

type ProviderTelemetryModel = ModelProfile & { api?: string };

type ProviderTelemetryOptions = {
	store?: TelemetryStore;
	session: PiboSession;
	model?: ProviderTelemetryModel;
	writer?: AsyncTelemetryWriter;
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

type ProviderMessageEndOptions = {
	at?: string;
};

type ProviderAssistantMessage = {
	role?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
	api?: unknown;
	provider?: unknown;
	model?: unknown;
};

export class PiboProviderTelemetryRecorder {
	private readonly telemetry: BestEffortTelemetryService;
	private activeProviderRequestId?: string;

	constructor(private readonly options: ProviderTelemetryOptions) {
		this.telemetry = new BestEffortTelemetryService(options.store, options.onError);
	}

	recordRequestStart(payload: unknown, options: ProviderRequestStartOptions = {}): StoredTelemetryProviderRequest | undefined {
		const capturedOptions = { ...options, at: options.at ?? new Date().toISOString() };
		return this.schedule(() => this.recordRequestStartNow(providerPayloadSnapshot(payload), capturedOptions));
	}

	private recordRequestStartNow(payload: unknown, options: ProviderRequestStartOptions): StoredTelemetryProviderRequest | undefined {
		if (!this.options.store) return undefined;
		try {
			const turn = this.activeTurn();
			if (!turn) return undefined;
			const now = options.at ?? new Date().toISOString();
			if (this.activeProviderRequest()) {
				this.finishActiveProviderRequest("aborted", now, "provider request superseded", undefined, "provider_superseded");
			}
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
		const captured = { status: input.status, at: input.at ?? new Date().toISOString() };
		return this.schedule(() => this.recordResponseNow(captured));
	}

	private recordResponseNow(input: ProviderResponseSummary): StoredTelemetryProviderRequest | undefined {
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
			const streamPhaseId = providerStreamPhaseId(request);
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

	// The assistant message boundary ends the provider stream even when the wider
	// Pibo turn continues with a long-running tool or another provider request.
	recordMessageEnd(message: unknown, options: ProviderMessageEndOptions = {}): StoredTelemetryProviderRequest | undefined {
		if (!isAssistantMessage(message)) return undefined;
		const captured = providerAssistantMessageSnapshot(message);
		const capturedOptions = { ...options, at: options.at ?? new Date().toISOString() };
		return this.schedule(() => this.recordMessageEndNow(captured, capturedOptions));
	}

	private recordMessageEndNow(message: ProviderAssistantMessage, options: ProviderMessageEndOptions): StoredTelemetryProviderRequest | undefined {
		if (!this.options.store) return undefined;
		const status = providerStatusForMessage(message);
		const summary = providerSummaryForStatus(status);
		const errorMessage = safeMessageError(message);
		const errorDetails = status === "error"
			? normalizeSessionErrorDetails(errorMessage ?? "Provider request failed.", {
				api: optionalString(message.api),
				provider: optionalString(message.provider),
				model: optionalString(message.model),
			})
			: undefined;
		return this.finishActiveProviderRequest(status, options.at ?? new Date().toISOString(), summary, errorMessage, errorDetails?.category ?? errorDetails?.errorClass);
	}

	recordShutdown(reason: string, at = new Date().toISOString()): StoredTelemetryProviderRequest | undefined {
		return this.schedule(() => this.finishActiveProviderRequest("aborted", at, reason, undefined, "runtime_abort"));
	}

	private schedule<T>(write: () => T): T | undefined {
		if (this.options.writer) {
			this.options.writer.enqueue(write, this.options.onError);
			return undefined;
		}
		return write();
	}

	private finishActiveProviderRequest(
		status: Extract<TelemetryProviderRequestStatus, "completed" | "error" | "aborted">,
		now: string,
		summary: string,
		errorMessage?: string,
		errorCategory?: string,
	): StoredTelemetryProviderRequest | undefined {
		if (!this.options.store) return undefined;
		try {
			const request = this.activeProviderRequest();
			if (!request) return undefined;
			const phaseStatus = status === "completed" ? "ok" : status;
			const requestPhaseId = request.phaseId ?? `${request.turnId}:provider_request`;
			if (this.options.store.getPhase(requestPhaseId)?.status === "open") {
				this.telemetry.finishPhase(requestPhaseId, { status: phaseStatus, endedAt: now, lastProgressAt: now, summary });
			}
			const streamPhaseId = providerStreamPhaseId(request);
			if (this.options.store.getPhase(streamPhaseId)?.status === "open") {
				this.telemetry.finishPhase(streamPhaseId, { status: phaseStatus, endedAt: now, lastProgressAt: now, summary });
			}
			const updated = this.updateProviderRequest(request, {
				status,
				completedAt: now,
				errorCategory: status === "error" ? errorCategory ?? "provider_error" : status === "aborted" ? errorCategory ?? "runtime_abort" : undefined,
				errorMessage,
			});
			this.activeProviderRequestId = undefined;
			return updated;
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
		return this.options.store?.getActiveProviderRequestForTurn(turn.turnId);
	}

	private nextPhaseId(turnId: string, phaseName: "provider_request"): string {
		const count = this.options.store?.countPhasesForTurn(turnId, phaseName) ?? 0;
		return count === 0 ? `${turnId}:${phaseName}` : `${turnId}:${phaseName}:${count + 1}`;
	}

	private updateProviderRequest(
		existing: StoredTelemetryProviderRequest,
		input: Partial<Pick<StoredTelemetryProviderRequest, "status" | "responseHeadersAt" | "firstByteAt" | "httpStatus" | "phaseId" | "completedAt" | "errorCategory" | "errorMessage">>,
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
			completedAt: input.completedAt,
			rawEventCount: existing.rawEventCount,
			normalizedEventCount: existing.normalizedEventCount,
			parseErrorCount: existing.parseErrorCount,
			unknownEventCount: existing.unknownEventCount,
			bytesReceived: existing.bytesReceived,
			eventTypeCounts: existing.eventTypeCounts,
			eventStreamId: existing.eventStreamId,
			eventId: existing.eventId,
			payloadRef: existing.payloadRef,
			errorCategory: input.errorCategory,
			errorMessage: input.errorMessage,
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
		pi.on("message_end", (event) => {
			recorder.recordMessageEnd(event.message);
		});
		pi.on("session_shutdown", (event) => {
			recorder.recordShutdown(`provider session shutdown: ${event.reason}`);
		});
	};
}

export function isTerminalProviderStatus(status: TelemetryProviderRequestStatus): boolean {
	return status === "completed" || status === "error" || status === "aborted" || status === "timeout";
}

function isAssistantMessage(message: unknown): message is ProviderAssistantMessage {
	return Boolean(message && typeof message === "object" && (message as ProviderAssistantMessage).role === "assistant");
}

function providerStatusForMessage(message: ProviderAssistantMessage): Extract<TelemetryProviderRequestStatus, "completed" | "error" | "aborted"> {
	if (message.stopReason === "error") return "error";
	if (message.stopReason === "aborted") return "aborted";
	return "completed";
}

function providerSummaryForStatus(status: Extract<TelemetryProviderRequestStatus, "completed" | "error" | "aborted">): string {
	if (status === "error") return "provider stream failed";
	if (status === "aborted") return "provider stream aborted";
	return "provider stream completed";
}

function providerStreamPhaseId(request: Pick<StoredTelemetryProviderRequest, "turnId" | "providerRequestId">): string {
	return `${request.turnId}:provider_stream:${request.providerRequestId}`;
}

function safeMessageError(message: ProviderAssistantMessage): string | undefined {
	return typeof message.errorMessage === "string" && message.errorMessage.trim().length > 0
		? message.errorMessage.replace(/\s+/g, " ").trim().slice(0, 512)
		: undefined;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
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

function providerAssistantMessageSnapshot(message: ProviderAssistantMessage): ProviderAssistantMessage {
	return {
		role: message.role,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage,
		api: message.api,
		provider: message.provider,
		model: message.model,
	};
}

function providerPayloadSnapshot(payload: unknown): unknown {
	return {
		model: modelIdFromPayload(payload),
		service_tier: serviceTierFromPayload(payload),
	};
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
