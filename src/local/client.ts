import { randomUUID } from "node:crypto";
import type {
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboJsonValue,
	PiboOutputEvent,
} from "../core/events.js";
import { PiboSessionRouter } from "../core/session-router.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type { PiboGatewayActionInfo } from "../plugins/types.js";
import {
	createPiboSessionId,
	type PiboSessionBinding,
	type PiboSessionBindingStore,
	type ResolveSessionBindingInput,
} from "../sessions/bindings.js";

export const LOCAL_TUI_CHANNEL_NAME = "local-tui";

export type LocalRoutedTuiOptions = {
	cwd?: string;
	persistSession?: boolean;
	profile?: string;
	sessionName?: string;
	pluginRegistry?: PiboPluginRegistry;
};

export type LocalRoutedTuiCapabilities = {
	actions: PiboGatewayActionInfo[];
};

export type LocalRoutedTuiEventListener = (event: PiboOutputEvent) => void;

export type LocalRoutedTuiClientLike = {
	readonly binding: PiboSessionBinding;
	readonly capabilities: LocalRoutedTuiCapabilities;
	onEvent(listener: LocalRoutedTuiEventListener): () => void;
	sendMessage(text: string): Promise<unknown>;
	sendExecution(action: PiboExecutionAction, params?: PiboJsonValue): Promise<unknown>;
	close(): void | Promise<void>;
};

class InMemorySessionBindingStore implements PiboSessionBindingStore {
	private readonly bySessionKey = new Map<string, PiboSessionBinding>();
	private readonly byChannelExternalId = new Map<string, PiboSessionBinding>();

	get(sessionKey: string): PiboSessionBinding | undefined {
		return this.bySessionKey.get(sessionKey);
	}

	resolve(input: ResolveSessionBindingInput): PiboSessionBinding {
		const channelExternalId = `${input.channel}:${input.externalId}`;
		const existing = this.byChannelExternalId.get(channelExternalId);
		if (existing) return existing;

		const now = new Date().toISOString();
		const binding: PiboSessionBinding = {
			sessionKey: input.sessionKey ?? `${input.channel}:${input.externalId}`,
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
		this.bySessionKey.set(binding.sessionKey, binding);
		this.byChannelExternalId.set(channelExternalId, binding);
		return binding;
	}
}

export class LocalRoutedTuiClient implements LocalRoutedTuiClientLike {
	readonly capabilities: LocalRoutedTuiCapabilities;

	private readonly unsubscribe: () => void;
	private readonly eventListeners = new Set<LocalRoutedTuiEventListener>();
	private closed = false;

	constructor(
		private readonly router: PiboSessionRouter,
		readonly binding: PiboSessionBinding,
		capabilities: LocalRoutedTuiCapabilities,
	) {
		this.capabilities = capabilities;
		this.unsubscribe = router.subscribe((event) => {
			if (event.sessionKey !== this.binding.sessionKey) return;
			for (const listener of this.eventListeners) {
				listener(event);
			}
		});
	}

	onEvent(listener: LocalRoutedTuiEventListener): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	sendMessage(text: string): Promise<unknown> {
		return this.router.emit({
			type: "message",
			sessionKey: this.binding.sessionKey,
			id: randomUUID(),
			text,
			source: "ui",
		});
	}

	sendExecution(action: PiboExecutionAction, params?: PiboJsonValue): Promise<unknown> {
		const event: PiboExecutionEvent =
			params === undefined
				? { type: "execution", sessionKey: this.binding.sessionKey, id: randomUUID(), action }
				: { type: "execution", sessionKey: this.binding.sessionKey, id: randomUUID(), action, params };
		return this.router.emit(event);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.unsubscribe();
		this.eventListeners.clear();
		await this.router.disposeAll();
	}
}

function createLocalSessionKey(profile: string, sessionName: string): string {
	return `${LOCAL_TUI_CHANNEL_NAME}:${profile}:${sessionName}`;
}

export function createLocalRoutedTuiClient(options: LocalRoutedTuiOptions = {}): LocalRoutedTuiClient {
	const registry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
	const profileName = registry.resolveProfileName(options.profile ?? "pibo-minimal");
	const profile = registry.createProfile(profileName);
	const sessionName = options.sessionName ?? "default";
	const bindingStore = new InMemorySessionBindingStore();
	const binding = bindingStore.resolve({
		channel: LOCAL_TUI_CHANNEL_NAME,
		externalId: `${profileName}:${sessionName}`,
		sessionKey: createLocalSessionKey(profileName, sessionName),
		defaultProfile: profileName,
		workspace: options.cwd,
	});
	const router = new PiboSessionRouter({
		cwd: options.cwd,
		persistSession: options.persistSession,
		pluginRegistry: registry,
		profile,
		bindingStore,
	});

	return new LocalRoutedTuiClient(router, binding, { actions: registry.getGatewayActionInfos() });
}
