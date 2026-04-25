import {
	InitialSessionContext,
	type InitialSessionContextOptions,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboRuntime, type PiboRuntimeOptions } from "./runtime.js";
import type { PiboSessionBindingStore } from "../sessions/bindings.js";
import { RoutedSession } from "./routed-session.js";
import type {
	PiboEventListener,
	PiboInputEvent,
	PiboOutputEvent,
} from "./events.js";

export type {
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./events.js";

export type PiboSessionRouterOptions = Omit<PiboRuntimeOptions, "profile"> & {
	profile?: InitialSessionContext;
	pluginRegistry?: PiboPluginRegistry;
	bindingStore?: PiboSessionBindingStore;
	forwardPiEvents?: boolean;
};

function profileForSession(baseProfile: InitialSessionContext, sessionKey: string): InitialSessionContext {
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		sessionId: sessionKey,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		contextFiles: baseProfile.contextFiles,
		builtinTools: baseProfile.builtinTools,
	};

	return new InitialSessionContext(options);
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly bindingStore?: PiboSessionBindingStore;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.bindingStore = options.bindingStore;
		this.baseProfile = options.profile ?? this.pluginRegistry.createProfile("pibo-minimal");
	}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		const session = await this.getOrCreateSession(event.sessionKey);

		if (event.type === "message") {
			return session.enqueueMessage(event);
		}

		const output = await session.executeAction(event);
		if (event.action === "dispose") {
			this.sessions.delete(event.sessionKey);
		}
		return output;
	}

	getSessionKeys(): string[] {
		return [...this.sessions.keys()];
	}

	async disposeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(sessions.map((session) => session.dispose()));
	}

	private async getOrCreateSession(sessionKey: string): Promise<RoutedSession> {
		const existing = this.sessions.get(sessionKey);
		if (existing) return existing;

		const pending = this.pendingSessions.get(sessionKey);
		if (pending) return pending;

		const created = this.createRoutedSession(sessionKey);
		this.pendingSessions.set(sessionKey, created);
		try {
			return await created;
		} finally {
			this.pendingSessions.delete(sessionKey);
		}
	}

	private async createRoutedSession(sessionKey: string): Promise<RoutedSession> {
		const profile = this.getProfileForSession(sessionKey);
		const runtime = await createPiboRuntime({
			cwd: this.options.cwd,
			persistSession: this.options.persistSession,
			profile: profileForSession(profile, sessionKey),
		});
		const session = new RoutedSession(
			sessionKey,
			runtime,
			this.emitOutput,
			this.pluginRegistry,
			this.options.forwardPiEvents ?? false,
		);
		this.sessions.set(sessionKey, session);
		return session;
	}

	private getProfileForSession(sessionKey: string): InitialSessionContext {
		const binding = this.bindingStore?.get(sessionKey);
		const profileName = binding?.currentProfile ?? binding?.originalProfile;
		if (!profileName) return this.baseProfile;
		return this.pluginRegistry.createProfile(profileName);
	}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		this.pluginRegistry.notifyEvent(event);
		for (const listener of this.listeners) {
			listener(event);
		}
	};
}
