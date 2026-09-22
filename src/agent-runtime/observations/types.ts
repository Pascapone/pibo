import type { PiboJsonValue } from "../../core/events.js";
import type {
	PiboAgentObservationCursorMode,
	PiboAgentObservationKind,
	PiboAgentObservationOrder,
	PiboAgentObservationToolDetail,
} from "./observations.js";

/** Shared observation/query data, independent of delegation or remote transports. */
export type PiboAgentObservation = {
	sequence: number;
	createdAt: string;
	requestId?: string;
	agentId: string;
	name: string;
	threadKey?: string;
	eventType: string;
	kind: PiboAgentObservationKind;
	role?: string;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	details?: PiboJsonValue;
};

export type PiboAgentObserveInput = {
	requestIds?: string[];
	toolCallIds?: string[];
	agentIds?: string[];
	names?: string[];
	threadKeys?: string[];
	eventTypes?: string[];
	kinds?: PiboAgentObservationKind[];
	roles?: string[];
	since?: string;
	until?: string;
	textContains?: string;
	textRegex?: string;
	cursorMode?: PiboAgentObservationCursorMode;
	afterSequence?: number;
	order?: PiboAgentObservationOrder;
	limit?: number;
	includeTools?: boolean;
	toolDetail?: PiboAgentObservationToolDetail;
	includeDetails?: boolean;
};

export type PiboAgentObserveResult = {
	filters: PiboAgentObserveInput;
	observations: PiboAgentObservation[];
	nextAfterSequence: number;
	autoCursorSequence?: number;
	truncated: boolean;
};
