import type { PiboJsonObject } from "../core/events.js";
import { DEFAULT_AGENT_RUNTIME_INSTANCE_ID } from "../core/profiles.js";
import { readSessionPrefixBinding, readSessionPrefixResourceReference } from "./prefix-capsule.js";
import { readPrefixTransition } from "./prefix-transition.js";

export type AgentRuntimeAdapterId = string;
export type AgentRuntimeInstanceId = string;
export type AgentRuntimeBindingState = "unbound" | "bound" | "missing" | "error";

export const PENDING_NATIVE_SESSION_METADATA_KEY = "piboPendingNativeSession";

export function hasPendingNativeSession(binding: RuntimeSessionBinding): boolean {
	return binding.state === "unbound"
		&& Boolean(binding.nativeSessionId)
		&& binding.metadata?.[PENDING_NATIVE_SESSION_METADATA_KEY] === true;
}

export type AgentRuntimeBindingLocator = {
	kind: "local-file" | "local-directory" | "uri" | "remote" | "adapter-resolved";
	value?: string;
};

export type RuntimeSessionBinding = {
	piboSessionId: string;
	runtimeInstanceId: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	nativeSessionId?: string;
	state: AgentRuntimeBindingState;
	protocol?: string;
	protocolVersion?: string;
	adapterVersion?: string;
	locator?: AgentRuntimeBindingLocator;
	metadata?: PiboJsonObject;
	revision?: number;
	createdAt?: string;
	updatedAt?: string;
};

export type PersistedRuntimeSessionBinding = RuntimeSessionBinding & {
	revision: number;
	createdAt: string;
	updatedAt: string;
};

export type CreateRuntimeSessionBindingInput = {
	runtimeInstanceId: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	nativeSessionId?: string;
	state?: AgentRuntimeBindingState;
	protocol?: string;
	protocolVersion?: string;
	adapterVersion?: string;
	locator?: AgentRuntimeBindingLocator;
	metadata?: PiboJsonObject;
};

export type RuntimeSessionBindingUpdateOptions = {
	expectedRevision?: number;
	mode?: "normal" | "repair" | "rebind";
};

export type RuntimeSessionBindingRebindInput = {
	runtimeInstanceId: string;
	nativeSessionId?: string;
	state?: "unbound" | "bound";
	locator?: AgentRuntimeBindingLocator;
	/** Explicitly discard prior model context instead of importing portable Pibo history. */
	startFresh?: boolean;
	expectedRevision: number;
};

export class RuntimeSessionBindingConflictError extends Error {
	constructor(
		readonly piboSessionId: string,
		readonly expectedRevision: number,
		readonly actualRevision: number,
	) {
		super(
			`Runtime binding for Pibo session "${piboSessionId}" changed concurrently (expected revision ${expectedRevision}, actual revision ${actualRevision}).`,
		);
		this.name = "RuntimeSessionBindingConflictError";
	}
}

export class RuntimeSessionBindingTransitionError extends Error {
	constructor(readonly piboSessionId: string, message: string) {
		super(`Invalid runtime binding transition for Pibo session "${piboSessionId}": ${message}`);
		this.name = "RuntimeSessionBindingTransitionError";
	}
}

export function createInitialRuntimeSessionBinding(
	piboSessionId: string,
	input: CreateRuntimeSessionBindingInput,
	now = new Date().toISOString(),
): PersistedRuntimeSessionBinding {
	if (!input.runtimeInstanceId.trim()) {
		throw new RuntimeSessionBindingTransitionError(piboSessionId, "runtime instance id is required");
	}
	if (!input.adapterId.trim()) {
		throw new RuntimeSessionBindingTransitionError(piboSessionId, "runtime adapter id is required");
	}
	const nativeSessionId = normalizedOptionalString(input.nativeSessionId);
	if ((input.state === "bound" || input.state === "missing") && !nativeSessionId) {
		throw new RuntimeSessionBindingTransitionError(piboSessionId, `${input.state} state requires a native session id`);
	}
	const prefix = readSessionPrefixBinding(input.metadata);
	const resources = readSessionPrefixResourceReference(input.metadata);
	if (readPrefixTransition(input.metadata)) throw new RuntimeSessionBindingTransitionError(piboSessionId, "native transitions require an existing binding");
	if (resources && resources.adapterId !== input.adapterId) {
		throw new RuntimeSessionBindingTransitionError(piboSessionId, "resource and runtime binding disagree");
	}
	if (prefix && (prefix.capsule.adapterId !== input.adapterId || prefix.nativeSessionId !== nativeSessionId)) {
		throw new RuntimeSessionBindingTransitionError(piboSessionId, "prefix and native runtime binding disagree");
	}
	return {
		piboSessionId,
		runtimeInstanceId: input.runtimeInstanceId,
		adapterId: input.adapterId,
		nativeSessionId,
		state: input.state ?? "unbound",
		protocol: normalizedOptionalString(input.protocol),
		protocolVersion: normalizedOptionalString(input.protocolVersion),
		adapterVersion: normalizedOptionalString(input.adapterVersion),
		locator: input.locator ? structuredClone(input.locator) : undefined,
		metadata: input.metadata ? structuredClone(input.metadata) : {},
		revision: 1,
		createdAt: now,
		updatedAt: now,
	};
}

export function createLegacyPiRuntimeSessionBinding(
	piboSessionId: string,
	piSessionId: string | undefined,
	now = new Date().toISOString(),
): PersistedRuntimeSessionBinding {
	const nativeSessionId = normalizedOptionalString(piSessionId);
	return createInitialRuntimeSessionBinding(
		piboSessionId,
		{
			runtimeInstanceId: DEFAULT_AGENT_RUNTIME_INSTANCE_ID,
			adapterId: "pi",
			nativeSessionId,
			state: nativeSessionId ? "bound" : "unbound",
			protocol: "pi-sdk",
		},
		now,
	);
}

export function nextRuntimeSessionBinding(
	current: RuntimeSessionBinding,
	next: RuntimeSessionBinding,
	options: RuntimeSessionBindingUpdateOptions = {},
	now = new Date().toISOString(),
): PersistedRuntimeSessionBinding {
	const currentRevision = current.revision ?? 1;
	if (options.expectedRevision !== undefined && currentRevision !== options.expectedRevision) {
		throw new RuntimeSessionBindingConflictError(current.piboSessionId, options.expectedRevision, currentRevision);
	}
	assertRuntimeSessionBindingTransition(current, next, options);
	return {
		...structuredClone(next),
		piboSessionId: current.piboSessionId,
		revision: currentRevision + 1,
		createdAt: current.createdAt ?? now,
		updatedAt: now,
	};
}

export function assertRuntimeSessionBindingTransition(
	current: RuntimeSessionBinding,
	next: RuntimeSessionBinding,
	options: RuntimeSessionBindingUpdateOptions = {},
): void {
	const mode = options.mode ?? "normal";
	const previousPrefix = readSessionPrefixBinding(current.metadata);
	const nextPrefix = readSessionPrefixBinding(next.metadata);
	const previousResources = readSessionPrefixResourceReference(current.metadata);
	const nextResources = readSessionPrefixResourceReference(next.metadata);
	const previousTransition = readPrefixTransition(current.metadata);
	const nextTransition = readPrefixTransition(next.metadata);
	if (previousTransition && !nextTransition) throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "native transition receipt cannot be discarded");
	if (JSON.stringify(previousTransition) !== JSON.stringify(nextTransition) && nextTransition) {
		if (previousTransition?.state === "pending") {
			if (JSON.stringify({ ...previousTransition, state: nextTransition.state }) !== JSON.stringify(nextTransition)
				|| nextTransition.state === "pending" || !previousPrefix || !nextPrefix
				|| nextPrefix.epoch !== previousPrefix.epoch + Number(nextTransition.state === "completed")
				|| nextTransition.state === "completed" && nextPrefix.reason !== "compaction"
				|| JSON.stringify(nextPrefix.capsule) !== JSON.stringify(previousPrefix.capsule)) {
				throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "native transition completion does not match its pending receipt");
			}
		} else if (nextTransition.state !== "pending" || nextTransition.id === previousTransition?.id
			|| !previousPrefix || nextTransition.fromEpoch !== previousPrefix.epoch
			|| nextTransition.nativeSessionId !== current.nativeSessionId
			|| JSON.stringify(previousPrefix) !== JSON.stringify(nextPrefix)) {
			throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "native transition must begin against the current sealed epoch");
		}
	} else if (previousTransition?.state === "pending" && JSON.stringify(previousPrefix) !== JSON.stringify(nextPrefix)) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "pending native transition must be resolved before changing the epoch");
	}
	if ((previousResources || previousPrefix) && JSON.stringify(previousResources) !== JSON.stringify(nextResources)) {
		if (!previousPrefix || !nextPrefix || nextPrefix.epoch !== previousPrefix.epoch + 1
			|| !["explicit-refresh", "runtime-change"].includes(nextPrefix.reason)) {
			throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "frozen resources require an explicit prefix transition");
		}
	}
	if (nextResources && nextResources.adapterId !== next.adapterId) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "resource and runtime binding disagree");
	}
	if (previousPrefix) {
		if (!nextPrefix) {
			throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "a sealed prefix cannot be silently discarded");
		}
		if (nextPrefix.epoch === previousPrefix.epoch) {
			if (JSON.stringify(previousPrefix) !== JSON.stringify(nextPrefix)) {
				throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "a sealed prefix is immutable within its epoch");
			}
		} else if (nextPrefix.epoch !== previousPrefix.epoch + 1 || nextPrefix.reason === "initial") {
			throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "prefix transitions require the next epoch and an explicit reason");
		}
	}
	if (nextPrefix && (nextPrefix.capsule.adapterId !== next.adapterId || nextPrefix.nativeSessionId !== next.nativeSessionId)) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "prefix and native runtime binding disagree");
	}
	if (!next.runtimeInstanceId.trim()) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "runtime instance id is required");
	}
	if (!next.adapterId.trim()) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, "runtime adapter id is required");
	}
	if (
		(current.runtimeInstanceId !== next.runtimeInstanceId || current.adapterId !== next.adapterId)
		&& mode !== "rebind"
	) {
		throw new RuntimeSessionBindingTransitionError(
			current.piboSessionId,
			"changing the runtime instance or adapter requires rebind mode",
		);
	}
	if (current.state === "unbound" && next.state === "bound" && options.expectedRevision === undefined) {
		throw new RuntimeSessionBindingTransitionError(
			current.piboSessionId,
			"unbound to bound requires an expected revision",
		);
	}
	if ((current.state === "missing" || current.state === "error") && next.state === "bound" && mode === "normal") {
		throw new RuntimeSessionBindingTransitionError(
			current.piboSessionId,
			`${current.state} to bound requires repair or rebind mode`,
		);
	}
	if (current.state === "bound" && next.state === "unbound" && mode !== "rebind") {
		throw new RuntimeSessionBindingTransitionError(
			current.piboSessionId,
			"bound to unbound requires rebind mode",
		);
	}
	if (
		current.state === "bound"
		&& next.state === "bound"
		&& current.nativeSessionId !== next.nativeSessionId
		&& mode !== "rebind"
	) {
		throw new RuntimeSessionBindingTransitionError(
			current.piboSessionId,
			"changing a bound native session id requires rebind mode",
		);
	}
	if ((next.state === "bound" || next.state === "missing") && !normalizedOptionalString(next.nativeSessionId)) {
		throw new RuntimeSessionBindingTransitionError(current.piboSessionId, `${next.state} state requires a native session id`);
	}
}

function normalizedOptionalString(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}
