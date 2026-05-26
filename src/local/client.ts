import { randomUUID } from "node:crypto";
import type {
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboJsonValue,
	PiboOutputEvent,
} from "../core/events.js";
import type { PiboRuntimeOptions } from "../core/runtime.js";
import { PiboSessionRouter } from "../core/session-router.js";
import { createDefaultPiboPluginRegistry, createPiboProfileFromRegistryOrDefault, resolvePiboProfileNameFromRegistryOrDefault } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type { PiboGatewayActionInfo } from "../plugins/types.js";
import { getDefaultPiboWorkspace } from "../core/workspace.js";
import {
	InMemoryPiboSessionStore,
	type PiboSession,
} from "../sessions/store.js";

export const LOCAL_TUI_CHANNEL_NAME = "local-tui";

export type LocalRoutedTuiOptions = {
	cwd?: string;
	persistSession?: boolean;
	profile?: string;
	sessionName?: string;
	showThinking?: boolean;
	thinkingLevel?: PiboRuntimeOptions["thinkingLevel"];
	pluginRegistry?: PiboPluginRegistry;
};

export type LocalRoutedTuiCapabilities = {
	actions: PiboGatewayActionInfo[];
};

export type LocalRoutedTuiEventListener = (event: PiboOutputEvent) => void;

export type LocalRoutedTuiClientLike = {
	readonly piboSession: PiboSession;
	readonly capabilities: LocalRoutedTuiCapabilities;
	onEvent(listener: LocalRoutedTuiEventListener): () => void;
	sendMessage(text: string): Promise<unknown>;
	sendExecution(action: PiboExecutionAction, params?: PiboJsonValue): Promise<unknown>;
	close(): void | Promise<void>;
};

export class LocalRoutedTuiClient implements LocalRoutedTuiClientLike {
	readonly capabilities: LocalRoutedTuiCapabilities;

	private readonly unsubscribe: () => void;
	private readonly eventListeners = new Set<LocalRoutedTuiEventListener>();
	private closed = false;

	constructor(
		private readonly router: PiboSessionRouter,
		readonly piboSession: PiboSession,
		capabilities: LocalRoutedTuiCapabilities,
	) {
		this.capabilities = capabilities;
		this.unsubscribe = router.subscribe((event) => {
			if (event.piboSessionId !== this.piboSession.id) return;
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
			piboSessionId: this.piboSession.id,
			id: randomUUID(),
			text,
			source: "ui",
		});
	}

	sendExecution(action: PiboExecutionAction, params?: PiboJsonValue): Promise<unknown> {
		const event: PiboExecutionEvent =
			params === undefined
				? { type: "execution", piboSessionId: this.piboSession.id, id: randomUUID(), action }
				: { type: "execution", piboSessionId: this.piboSession.id, id: randomUUID(), action, params };
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

export function createLocalRoutedTuiClient(options: LocalRoutedTuiOptions = {}): LocalRoutedTuiClient {
	const registry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
	const profileName = resolvePiboProfileNameFromRegistryOrDefault(registry, options.profile);
	const profile = createPiboProfileFromRegistryOrDefault(registry, profileName);
	const sessionName = options.sessionName ?? "default";
	const workspace = options.cwd ?? getDefaultPiboWorkspace();
	const sessionStore = new InMemoryPiboSessionStore();
	const piboSession = sessionStore.create({
		channel: LOCAL_TUI_CHANNEL_NAME,
		kind: "local",
		profile: profileName,
		title: sessionName,
		workspace,
	});
	const router = new PiboSessionRouter({
		cwd: workspace,
		persistSession: options.persistSession,
		thinkingLevel: options.thinkingLevel,
		pluginRegistry: registry,
		profile,
		sessionStore,
	});

	return new LocalRoutedTuiClient(router, piboSession, { actions: registry.getGatewayActionInfos() });
}
