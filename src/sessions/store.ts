import { randomUUID } from "node:crypto";
import type { PiboJsonObject } from "../core/events.js";
import type { ModelProfile } from "../core/profiles.js";

export type PiboSession = {
	id: string;
	piSessionId: string;
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
	close?(): void;
};

export function createPiboSessionId(): string {
	return `ps_${randomUUID()}`;
}

export function createPiSessionId(): string {
	return randomUUID();
}

export function createPiboSession(input: CreatePiboSessionInput, now = new Date().toISOString()): PiboSession {
	return {
		id: input.id ?? createPiboSessionId(),
		piSessionId: input.piSessionId ?? createPiSessionId(),
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
		if (this.byPiSessionId.has(session.piSessionId)) {
			throw new Error(`Pi session "${session.piSessionId}" is already attached to a Pibo session`);
		}
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

		const updated: PiboSession = {
			...existing,
			piSessionId: input.piSessionId ?? existing.piSessionId,
			profile: input.profile ?? existing.profile,
			parentId: input.parentId === null ? undefined : input.parentId ?? existing.parentId,
			originId: input.originId === null ? undefined : input.originId ?? existing.originId,
			workspace: input.workspace === null ? undefined : input.workspace ?? existing.workspace,
			title: input.title === null ? undefined : input.title ?? existing.title,
			metadata: input.metadata ?? existing.metadata,
			activeModel: input.activeModel === null ? undefined : input.activeModel ? { ...input.activeModel } : existing.activeModel,
			updatedAt: new Date().toISOString(),
		};
		this.set(updated, existing.piSessionId);
		return updated;
	}

	delete(id: string): boolean {
		const existing = this.byId.get(id);
		if (!existing) return false;
		this.byId.delete(id);
		this.byPiSessionId.delete(existing.piSessionId);
		return true;
	}

	find(input: FindPiboSessionsInput): PiboSession[] {
		return this.sort([...this.byId.values()].filter((session) => matchesFindInput(session, input)));
	}

	private set(session: PiboSession, previousPiSessionId?: string): void {
		this.byId.set(session.id, session);
		if (previousPiSessionId && previousPiSessionId !== session.piSessionId) {
			this.byPiSessionId.delete(previousPiSessionId);
		}
		this.byPiSessionId.set(session.piSessionId, session);
	}

	private sort(sessions: PiboSession[]): PiboSession[] {
		return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}
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

function metadataMatches(metadata: PiboJsonObject | undefined, expected: PiboJsonObject): boolean {
	const actual = metadata ?? {};
	for (const [key, value] of Object.entries(expected)) {
		if (JSON.stringify(actual[key]) !== JSON.stringify(value)) return false;
	}
	return true;
}
