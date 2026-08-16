import type { PiboJsonObject } from "../core/events.js";
import { DEFAULT_AGENT_RUNTIME_INSTANCE_ID } from "../core/profiles.js";

export type AgentRuntimeAdapterId = string;
export type AgentRuntimeInstanceId = string;
export type AgentRuntimeBindingState = "unbound" | "bound" | "missing" | "error";

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
