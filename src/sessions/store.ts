import { randomUUID } from "node:crypto";
import type { PiboJsonObject } from "../core/events.js";
import type { ModelProfile } from "../core/profiles.js";
import {
	createInitialRuntimeSessionBinding,
	createLegacyPiRuntimeSessionBinding,
	nextRuntimeSessionBinding,
	type CreateRuntimeSessionBindingInput,
	type RuntimeSessionBinding,
	type RuntimeSessionBindingUpdateOptions,
} from "./runtime-binding.js";

export const PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES = 128;

export type PiboSession = {
	id: string;
	/** @deprecated Use runtimeBinding.nativeSessionId for runtime routing. Empty for non-Pi sessions. */
	piSessionId: string;
	runtimeBinding?: RuntimeSessionBinding;
	channel: string;
	kind: string;
	profile: string;
	parentId?: string;
	originId?: string;
	workspace?: string;
	title?: string;
	metadata?: PiboJsonObject;
	activeModel?: ModelProfile;
	createdAt: string;
	updatedAt: string;
};

export type CreatePiboSessionInput = {
	id?: string;
	channel: string;
	kind: string;
	profile: string;
	parentId?: string;
	originId?: string;
	piSessionId?: string;
	runtimeBinding?: CreateRuntimeSessionBindingInput;
	workspace?: string;
	title?: string;
	metadata?: PiboJsonObject;
	activeModel?: ModelProfile;
};

export type UpdatePiboSessionInput = {
	piSessionId?: string;
	profile?: string;
	parentId?: string | null;
	originId?: string | null;
	workspace?: string | null;
	title?: string | null;
	metadata?: PiboJsonObject;
	activeModel?: ModelProfile | null;
};

export type FindPiboSessionsInput = {
	ids?: string[];
	channel?: string;
	kind?: string;
	parentId?: string | null;
	originId?: string;
	profile?: string;
	metadata?: PiboJsonObject;
	activeModel?: ModelProfile | null;
};

export type PiboSessionStore = {
	get(id: string): PiboSession | undefined;
	list?(): PiboSession[];
	create(input: CreatePiboSessionInput): PiboSession;
	update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined;
	delete?(id: string): boolean;
	find(input: FindPiboSessionsInput): PiboSession[];
	getRuntimeBinding?(id: string): RuntimeSessionBinding | undefined;
	updateRuntimeBinding?(
		id: string,
		binding: RuntimeSessionBinding,
		options?: RuntimeSessionBindingUpdateOptions,
	): RuntimeSessionBinding | undefined;
	close?(): void;
	claimOutputRenderSequence?(piboSessionId: string, minimum: number): number;
	observeOutputRenderSequence?(piboSessionId: string, sequence: number): void;
	claimAgentObservationSequence?(parentPiboSessionId: string, minimum: number): number;
	getAgentObservationAutoCursor?(parentPiboSessionId: string, cursorScope: string): number | undefined;
	advanceAgentObservationAutoCursor?(parentPiboSessionId: string, cursorScope: string, sequence: number): number;
	claimOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string): number;
	observeOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string, ordinal: number): void;
	claimOrAttachOutputToolInvocation?(input: import("../core/output-render-sequence.js").OutputToolInvocationTransition): number;
	observeOutputToolInvocation?(input: import("../core/output-render-sequence.js").OutputToolInvocationTransition & { ordinal: number }): void;
	claimOrAttachOutputPart?(input: import("../core/output-render-sequence.js").OutputPartTransition): number;
	observeOutputPart?(input: import("../core/output-render-sequence.js").OutputPartTransition & { index: number }): void;
};

export function createPiboSessionId(): string {
	return `ps_${randomUUID()}`;
}

export function createPiSessionId(): string {
	return randomUUID();
}

export function createPiboSession(input: CreatePiboSessionInput, now = new Date().toISOString()): PiboSession {
	const id = input.id ?? createPiboSessionId();
	const requestedBinding = input.runtimeBinding ?? {
		runtimeInstanceId: "pi",
		adapterId: "pi",
		state: "unbound" as const,
		protocol: "pi-sdk",
	};
	let piSessionId = input.piSessionId?.trim() ?? "";
	let nativeSessionId = requestedBinding.nativeSessionId?.trim() || undefined;
	if (requestedBinding.adapterId === "pi") {
		if (piSessionId && nativeSessionId && piSessionId !== nativeSessionId) {
			throw new Error(`Pi session "${piSessionId}" does not match runtime binding native session "${nativeSessionId}"`);
		}
		nativeSessionId = nativeSessionId ?? (piSessionId || createPiSessionId());
		piSessionId = nativeSessionId;
	}
	const runtimeBinding = createInitialRuntimeSessionBinding(id, {
		...requestedBinding,
		nativeSessionId,
	}, now);
	return {
		id,
		piSessionId,
		runtimeBinding,
		channel: input.channel,
		kind: input.kind,
		profile: input.profile,
		parentId: input.parentId,
		originId: input.originId,
		workspace: input.workspace,
		title: input.title,
		metadata: input.metadata ?? {},
		activeModel: input.activeModel ? { ...input.activeModel } : undefined,
		createdAt: now,
		updatedAt: now,
	};
}

export class InMemoryPiboSessionStore implements PiboSessionStore {
	private readonly byId = new Map<string, PiboSession>();
	private readonly byPiSessionId = new Map<string, PiboSession>();
	private readonly byNativeSession = new Map<string, PiboSession>();
	private readonly outputRenderHighWater = new Map<string, number>();
	private readonly agentObservationNextSequence = new Map<string, number>();
	private readonly agentObservationAutoCursors = new Map<string, number>();
	private readonly outputToolInvocationNextOrdinal = new Map<string, number>();

	get(id: string): PiboSession | undefined {
		return this.byId.get(id);
	}

	list(): PiboSession[] {
		return this.sort([...this.byId.values()]);
	}

	create(input: CreatePiboSessionInput): PiboSession {
		const session = createPiboSession(input);
		if (this.byId.has(session.id)) {
			throw new Error(`Pibo session "${session.id}" already exists`);
		}
		if (session.piSessionId && this.byPiSessionId.has(session.piSessionId)) {
			throw new Error(`Pi session "${session.piSessionId}" is already attached to a Pibo session`);
		}
		this.assertNativeSessionAvailable(session.runtimeBinding, session.id);
		this.set(session);
		return session;
	}

	update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined {
		const existing = this.byId.get(id);
		if (!existing) return undefined;
		if (input.piSessionId && input.piSessionId !== existing.piSessionId) {
			const attached = this.byPiSessionId.get(input.piSessionId);
			if (attached && attached.id !== id) {
				throw new Error(`Pi session "${input.piSessionId}" is already attached to Pibo session "${attached.id}"`);
			}
		}

		let runtimeBinding = existing.runtimeBinding ?? createLegacyPiRuntimeSessionBinding(existing.id, existing.piSessionId, existing.createdAt);
		if (input.piSessionId !== undefined && input.piSessionId !== existing.piSessionId && runtimeBinding.adapterId === "pi") {
			runtimeBinding = nextRuntimeSessionBinding(runtimeBinding, {
				...runtimeBinding,
				nativeSessionId: input.piSessionId,
				state: input.piSessionId ? "bound" : "unbound",
			}, { mode: "rebind", expectedRevision: runtimeBinding.revision });
		}
		const updated: PiboSession = {
			...existing,
			piSessionId: input.piSessionId ?? existing.piSessionId,
			runtimeBinding,
			profile: input.profile ?? existing.profile,
			parentId: input.parentId === null ? undefined : input.parentId ?? existing.parentId,
			originId: input.originId === null ? undefined : input.originId ?? existing.originId,
			workspace: input.workspace === null ? undefined : input.workspace ?? existing.workspace,
			title: input.title === null ? undefined : input.title ?? existing.title,
			metadata: input.metadata ?? existing.metadata,
			activeModel: input.activeModel === null ? undefined : input.activeModel ? { ...input.activeModel } : existing.activeModel,
			updatedAt: new Date().toISOString(),
		};
		this.assertNativeSessionAvailable(updated.runtimeBinding, id);
		this.set(updated, existing.piSessionId, existing.runtimeBinding);
		return updated;
	}

	claimOutputRenderSequence(piboSessionId: string, minimum: number): number {
		const session = this.byId.get(piboSessionId);
		if (!session) return minimum;
		const current = Math.max(
			this.outputRenderHighWater.get(piboSessionId) ?? 0,
			outputRenderSequenceHighWater(session.metadata),
		);
		const next = Math.max(minimum, current + 1);
		this.outputRenderHighWater.set(piboSessionId, next);
		return next;
	}

	observeOutputRenderSequence(piboSessionId: string, sequence: number): void {
		const session = this.byId.get(piboSessionId);
		if (!session) return;
		const current = Math.max(this.outputRenderHighWater.get(piboSessionId) ?? 0, outputRenderSequenceHighWater(session.metadata));
		if (sequence > current) this.outputRenderHighWater.set(piboSessionId, sequence);
	}

	claimAgentObservationSequence(parentPiboSessionId: string, minimum: number): number {
		if (!this.byId.has(parentPiboSessionId)) return minimum;
		const sequence = Math.max(minimum, this.agentObservationNextSequence.get(parentPiboSessionId) ?? 1);
		this.agentObservationNextSequence.set(parentPiboSessionId, sequence + 1);
		return sequence;
	}

	getAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string): number | undefined {
		if (!this.byId.has(parentPiboSessionId)) return undefined;
		return this.agentObservationAutoCursors.get(agentObservationAutoCursorKey(parentPiboSessionId, cursorScope));
	}

	advanceAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string, sequence: number): number {
		if (!this.byId.has(parentPiboSessionId)) return sequence;
		const key = agentObservationAutoCursorKey(parentPiboSessionId, cursorScope);
		const advanced = Math.max(this.agentObservationAutoCursors.get(key) ?? 0, sequence);
		this.agentObservationAutoCursors.delete(key);
		this.agentObservationAutoCursors.set(key, advanced);
		const prefix = `${JSON.stringify([parentPiboSessionId]).slice(0, -1)},`;
		let scopeCount = 0;
		for (const existingKey of this.agentObservationAutoCursors.keys()) {
			if (existingKey.startsWith(prefix)) scopeCount += 1;
		}
		for (const existingKey of this.agentObservationAutoCursors.keys()) {
			if (scopeCount <= PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES) break;
			if (!existingKey.startsWith(prefix)) continue;
			this.agentObservationAutoCursors.delete(existingKey);
			scopeCount -= 1;
		}
		return advanced;
	}

	claimOutputToolInvocationOrdinal(piboSessionId: string, eventId: string, toolCallId: string): number {
		const key = outputToolInvocationCounterKey(piboSessionId, eventId, toolCallId);
		const ordinal = this.outputToolInvocationNextOrdinal.get(key) ?? 0;
		this.outputToolInvocationNextOrdinal.set(key, ordinal + 1);
		return ordinal;
	}

	observeOutputToolInvocationOrdinal(piboSessionId: string, eventId: string, toolCallId: string, ordinal: number): void {
		const key = outputToolInvocationCounterKey(piboSessionId, eventId, toolCallId);
		this.outputToolInvocationNextOrdinal.set(key, Math.max(this.outputToolInvocationNextOrdinal.get(key) ?? 0, ordinal + 1));
	}

	getRuntimeBinding(id: string): RuntimeSessionBinding | undefined {
		const session = this.byId.get(id);
		if (!session) return undefined;
		return structuredClone(session.runtimeBinding ?? createLegacyPiRuntimeSessionBinding(session.id, session.piSessionId, session.createdAt));
	}

	updateRuntimeBinding(
		id: string,
		binding: RuntimeSessionBinding,
		options: RuntimeSessionBindingUpdateOptions = {},
	): RuntimeSessionBinding | undefined {
		const existing = this.byId.get(id);
		if (!existing) return undefined;
		const current = existing.runtimeBinding ?? createLegacyPiRuntimeSessionBinding(existing.id, existing.piSessionId, existing.createdAt);
		const updatedBinding = nextRuntimeSessionBinding(current, { ...structuredClone(binding), piboSessionId: id }, options);
		this.assertNativeSessionAvailable(updatedBinding, id);
		const updatedSession: PiboSession = {
			...existing,
			piSessionId: updatedBinding.adapterId === "pi" ? updatedBinding.nativeSessionId ?? "" : "",
			runtimeBinding: updatedBinding,
			updatedAt: updatedBinding.updatedAt,
		};
		this.set(updatedSession, existing.piSessionId, current);
		return structuredClone(updatedBinding);
	}

	delete(id: string): boolean {
		const existing = this.byId.get(id);
		if (!existing) return false;
		this.byId.delete(id);
		if (existing.piSessionId) this.byPiSessionId.delete(existing.piSessionId);
		const nativeKey = runtimeBindingNativeKey(existing.runtimeBinding);
		if (nativeKey) this.byNativeSession.delete(nativeKey);
		this.outputRenderHighWater.delete(id);
		this.agentObservationNextSequence.delete(id);
		const observationCursorPrefix = `${JSON.stringify([id]).slice(0, -1)},`;
		for (const key of this.agentObservationAutoCursors.keys()) {
			if (key.startsWith(observationCursorPrefix)) this.agentObservationAutoCursors.delete(key);
		}
		const counterPrefix = `${JSON.stringify([id]).slice(0, -1)},`;
		for (const key of this.outputToolInvocationNextOrdinal.keys()) {
			if (key.startsWith(counterPrefix)) this.outputToolInvocationNextOrdinal.delete(key);
		}
		return true;
	}

	find(input: FindPiboSessionsInput): PiboSession[] {
		return this.sort([...this.byId.values()].filter((session) => matchesFindInput(session, input)));
	}

	private set(
		session: PiboSession,
		previousPiSessionId?: string,
		previousBinding?: RuntimeSessionBinding,
	): void {
		this.byId.set(session.id, session);
		if (previousPiSessionId && previousPiSessionId !== session.piSessionId) {
			this.byPiSessionId.delete(previousPiSessionId);
		}
		if (session.piSessionId) this.byPiSessionId.set(session.piSessionId, session);
		const previousNativeKey = runtimeBindingNativeKey(previousBinding);
		const nativeKey = runtimeBindingNativeKey(session.runtimeBinding);
		if (previousNativeKey && previousNativeKey !== nativeKey) this.byNativeSession.delete(previousNativeKey);
		if (nativeKey) this.byNativeSession.set(nativeKey, session);
	}

	private assertNativeSessionAvailable(binding: RuntimeSessionBinding | undefined, piboSessionId: string): void {
		const key = runtimeBindingNativeKey(binding);
		if (!key) return;
		const attached = this.byNativeSession.get(key);
		if (attached && attached.id !== piboSessionId) {
			throw new Error(
				`Native session "${binding?.nativeSessionId}" for adapter "${binding?.adapterId}" is already attached to Pibo session "${attached.id}"`,
			);
		}
	}

	private sort(sessions: PiboSession[]): PiboSession[] {
		return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}
}

function outputRenderSequenceHighWater(metadata: PiboJsonObject | undefined): number {
	const value = metadata?.outputRenderSequenceHighWater;
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function agentObservationAutoCursorKey(parentPiboSessionId: string, cursorScope: string): string {
	return JSON.stringify([parentPiboSessionId, cursorScope]);
}

function outputToolInvocationCounterKey(piboSessionId: string, eventId: string, toolCallId: string): string {
	return JSON.stringify([piboSessionId, eventId, toolCallId]);
}

export function matchesFindInput(session: PiboSession, input: FindPiboSessionsInput): boolean {
	if (input.ids && !input.ids.includes(session.id)) return false;
	if (input.channel !== undefined && session.channel !== input.channel) return false;
	if (input.kind !== undefined && session.kind !== input.kind) return false;
	if (input.parentId !== undefined) {
		if (input.parentId === null) {
			if (session.parentId !== undefined) return false;
		} else if (session.parentId !== input.parentId) {
			return false;
		}
	}
	if (input.originId !== undefined && session.originId !== input.originId) return false;
	if (input.profile !== undefined && session.profile !== input.profile) return false;
	if (input.activeModel !== undefined) {
		if (input.activeModel === null) {
			if (session.activeModel !== undefined) return false;
		} else if (session.activeModel?.provider !== input.activeModel.provider || session.activeModel?.id !== input.activeModel.id) {
			return false;
		}
	}
	if (input.metadata && !metadataMatches(session.metadata, input.metadata)) return false;
	return true;
}

function runtimeBindingNativeKey(binding: RuntimeSessionBinding | undefined): string | undefined {
	return binding?.nativeSessionId ? `${binding.adapterId}\0${binding.nativeSessionId}` : undefined;
}

function metadataMatches(metadata: PiboJsonObject | undefined, expected: PiboJsonObject): boolean {
	const actual = metadata ?? {};
	for (const [key, value] of Object.entries(expected)) {
		if (JSON.stringify(actual[key]) !== JSON.stringify(value)) return false;
	}
	return true;
}
