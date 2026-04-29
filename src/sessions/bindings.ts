import { randomUUID } from "node:crypto";

export type PiboSessionBinding = {
	sessionKey: string;
	sessionId: string;
	parentSessionKey?: string;
	parentSessionId?: string;
	channel: string;
	externalId: string;
	originalProfile: string;
	currentProfile?: string;
	workspace?: string;
	createdAt: string;
	updatedAt: string;
};

export type UpdateSessionBindingInput = {
	sessionId?: string;
	parentSessionId?: string;
	currentProfile?: string;
	workspace?: string;
};

export type ResolveSessionBindingInput = {
	channel: string;
	externalId: string;
	defaultProfile: string;
	sessionKey?: string;
	sessionId?: string;
	parentSessionKey?: string;
	parentSessionId?: string;
	workspace?: string;
};

export type PiboSessionBindingStore = {
	get(sessionKey: string): PiboSessionBinding | undefined;
	list?(): PiboSessionBinding[];
	update?(sessionKey: string, input: UpdateSessionBindingInput): PiboSessionBinding | undefined;
	resolve(input: ResolveSessionBindingInput): PiboSessionBinding;
	close?(): void;
};

export function createPiboSessionId(): string {
	return randomUUID();
}

export function createSessionBinding(input: ResolveSessionBindingInput, now = new Date().toISOString()): PiboSessionBinding {
	return {
		sessionKey: input.sessionKey ?? createDefaultSessionKey(input),
		sessionId: input.sessionId ?? createPiboSessionId(),
		parentSessionKey: input.parentSessionKey,
		parentSessionId: input.parentSessionId,
		channel: input.channel,
		externalId: input.externalId,
		originalProfile: input.defaultProfile,
		workspace: input.workspace,
		createdAt: now,
		updatedAt: now,
	};
}

export function createDefaultSessionKey(input: Pick<ResolveSessionBindingInput, "channel" | "externalId">): string {
	return `${input.channel}:${input.externalId}`;
}

export class InMemorySessionBindingStore implements PiboSessionBindingStore {
	private readonly bySessionKey = new Map<string, PiboSessionBinding>();
	private readonly byChannelExternalId = new Map<string, PiboSessionBinding>();
	private readonly bySessionId = new Map<string, PiboSessionBinding>();

	get(sessionKey: string): PiboSessionBinding | undefined {
		return this.bySessionKey.get(sessionKey);
	}

	list(): PiboSessionBinding[] {
		return [...this.bySessionKey.values()];
	}

	update(sessionKey: string, input: UpdateSessionBindingInput): PiboSessionBinding | undefined {
		const existing = this.bySessionKey.get(sessionKey);
		if (!existing) return undefined;
		if (input.sessionId && input.sessionId !== existing.sessionId) {
			const existingSession = this.bySessionId.get(input.sessionId);
			if (existingSession) return existingSession;
		}

		const updated: PiboSessionBinding = {
			...existing,
			sessionId: input.sessionId ?? existing.sessionId,
			parentSessionId: input.parentSessionId ?? existing.parentSessionId,
			currentProfile: input.currentProfile ?? existing.currentProfile,
			workspace: input.workspace ?? existing.workspace,
			updatedAt: new Date().toISOString(),
		};
		this.setBinding(updated, existing.sessionId);
		return updated;
	}

	resolve(input: ResolveSessionBindingInput): PiboSessionBinding {
		const channelExternalId = createDefaultSessionKey(input);
		const existing = this.byChannelExternalId.get(channelExternalId);
		if (existing) return existing;
		if (input.sessionId) {
			const existingSession = this.bySessionId.get(input.sessionId);
			if (existingSession) return existingSession;
		}

		const binding = createSessionBinding(input);
		this.setBinding(binding);
		return binding;
	}

	private setBinding(binding: PiboSessionBinding, previousSessionId?: string): void {
		this.bySessionKey.set(binding.sessionKey, binding);
		this.byChannelExternalId.set(createDefaultSessionKey(binding), binding);
		if (previousSessionId && previousSessionId !== binding.sessionId) {
			this.bySessionId.delete(previousSessionId);
		}
		this.bySessionId.set(binding.sessionId, binding);
	}
}
