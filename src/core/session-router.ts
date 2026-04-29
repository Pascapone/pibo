import {
	InitialSessionContext,
	type InitialSessionContextOptions,
	type SubagentProfile,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboRuntime, type PiboRuntimeOptions } from "./runtime.js";
import type { PiboSessionBindingStore } from "../sessions/bindings.js";
import { RoutedSession } from "./routed-session.js";
import type {
	PiboAssistantMessageEvent,
	PiboEventListener,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionOperationResult,
} from "./events.js";
import {
	createSubagentSessionKey,
	getSubagentSessionDepth,
	type PiboSubagentRunner,
} from "../subagents/tool.js";
import { randomUUID } from "node:crypto";
import { PiboRunRegistry, type PiboRunNotification } from "../runs/registry.js";
import type { PiboRunToolController } from "../runs/tools.js";
import { createPiboSessionId, type PiboSessionBinding } from "../sessions/bindings.js";

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

export type PiboSessionRouterOptions = Omit<
	PiboRuntimeOptions,
	"profile" | "subagentRunner" | "runToolController"
> & {
	profile?: InitialSessionContext;
	pluginRegistry?: PiboPluginRegistry;
	bindingStore?: PiboSessionBindingStore;
	forwardPiEvents?: boolean;
};

function profileForSession(
	baseProfile: InitialSessionContext,
	sessionId: string,
	parentSessionId?: string,
): InitialSessionContext {
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		sessionId,
		parentSessionId,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		subagents: baseProfile.subagents,
		contextFiles: baseProfile.contextFiles,
		builtinTools: baseProfile.builtinTools,
	};

	return new InitialSessionContext(options);
}

function formatRunNotification(notification: PiboRunNotification): string {
	return [
		"<pibo_run_notification>",
		JSON.stringify({
			completed: notification.completed.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			failed: notification.failed.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			cancelled: notification.cancelled.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			running: notification.running.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			instruction:
				"Use pibo_run_read for completed or failed runs. Use pibo_run_wait, pibo_run_status, pibo_run_cancel, or pibo_run_ack for runs you still need to manage.",
		}),
		"</pibo_run_notification>",
	].join("\n");
}

function archiveParentFor(
	binding: PiboSessionBinding,
	currentSessionId: string,
): Pick<PiboSessionBinding, "parentSessionKey" | "parentSessionId"> {
	if (binding.channel !== "subagent") return {};
	return {
		parentSessionKey: binding.parentSessionKey ?? binding.sessionKey,
		parentSessionId: binding.parentSessionId ?? currentSessionId,
	};
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly runRegistry = new PiboRunRegistry();
	private readonly scheduledRunNotifications = new Map<string, boolean>();
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly bindingStore?: PiboSessionBindingStore;
	private readonly sessionParentKeys = new Map<string, string>();
	private readonly sessionBindings = new Map<string, PiboSessionBinding>();

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
			this.runRegistry.cancelOwnerRuns(event.sessionKey);
			this.scheduledRunNotifications.delete(event.sessionKey);
			this.sessions.delete(event.sessionKey);
			this.sessionParentKeys.delete(event.sessionKey);
			this.sessionBindings.delete(event.sessionKey);
		}
		return output;
	}

	getSessionKeys(): string[] {
		return [...this.sessions.keys()];
	}

	async emitMessageAndWaitForReply(
		event: PiboMessageEvent,
		timeoutMs = 120000,
	): Promise<PiboAssistantMessageEvent> {
		const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? randomUUID() };

		return await new Promise<PiboAssistantMessageEvent>((resolve, reject) => {
			let settled = false;
			const unsubscribe = this.subscribe((output) => {
				if (
					output.sessionKey !== eventWithId.sessionKey ||
					!("eventId" in output) ||
					output.eventId !== eventWithId.id
				) {
					return;
				}
				if (output.type === "assistant_message") {
					finish(output);
				} else if (output.type === "session_error") {
					finish(new Error(output.error));
				}
			});
			const timeout = setTimeout(() => {
				finish(new Error(`Timed out waiting for assistant reply from session "${eventWithId.sessionKey}"`));
			}, timeoutMs);

			const finish = (result: PiboAssistantMessageEvent | Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				unsubscribe();
				if (result instanceof Error) {
					reject(result);
				} else {
					resolve(result);
				}
			};

			this.emit(eventWithId).catch(finish);
		});
	}

	async disposeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		this.runRegistry.cancelAll("Pibo session router was disposed.");
		this.scheduledRunNotifications.clear();
		this.sessionParentKeys.clear();
		this.sessionBindings.clear();
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
		const binding = this.resolveSessionBinding(sessionKey);
		const profile = this.getProfileForSession(sessionKey);
		const runtime = await createPiboRuntime({
			cwd: this.options.cwd,
			persistSession: this.options.persistSession,
			thinkingLevel: this.options.thinkingLevel,
			profile: profileForSession(profile, binding.sessionId, binding.parentSessionId),
			subagentRunner: this.createSubagentRunner(sessionKey),
			runToolController: this.createRunToolController(sessionKey),
		});
		const session = new RoutedSession(
			sessionKey,
			runtime,
			this.emitOutput,
			this.pluginRegistry,
			this.options.forwardPiEvents ?? false,
			(result) => this.updateSessionBinding(result),
		);
		this.sessions.set(sessionKey, session);
		return session;
	}

	private updateSessionBinding(result: PiboSessionOperationResult): void {
		if (result.cancelled) return;

		const sessionKey = result.routeSessionKey;
		const patch = {
			sessionId: result.current.sessionId,
			workspace: result.current.cwd,
		};

		if (this.bindingStore) {
			this.bindingStore.update?.(sessionKey, patch);
		} else {
			const existing = this.sessionBindings.get(sessionKey);
			if (!existing) return;
			this.sessionBindings.set(sessionKey, {
				...existing,
				...patch,
				updatedAt: new Date().toISOString(),
			});
		}

		if (result.previous.sessionId !== result.current.sessionId) {
			this.archivePreviousSessionBinding(result);
		}
	}

	private archivePreviousSessionBinding(result: PiboSessionOperationResult): void {
		const sessionKey = result.routeSessionKey;
		const existing = this.bindingStore?.get(sessionKey) ?? this.sessionBindings.get(sessionKey);
		if (!existing || !result.previous.sessionFile) return;
		if (this.hasSessionBinding(result.previous.sessionId)) return;

		const archiveParent = archiveParentFor(existing, result.current.sessionId);
		const sessionId = result.previous.sessionId;
		const archiveSessionKey = `${sessionKey}:branch:${sessionId}`;
		const externalId = `${existing.externalId}:branch:${sessionId}`;
		const defaultProfile = existing.currentProfile ?? existing.originalProfile;

		if (this.bindingStore) {
			this.bindingStore.resolve({
				channel: existing.channel,
				externalId,
				sessionKey: archiveSessionKey,
				sessionId,
				...archiveParent,
				defaultProfile,
				workspace: result.previous.cwd,
			});
			return;
		}

		if (this.sessionBindings.has(archiveSessionKey)) return;
		const now = new Date().toISOString();
		this.sessionBindings.set(archiveSessionKey, {
			sessionKey: archiveSessionKey,
			sessionId,
			...archiveParent,
			channel: existing.channel,
			externalId,
			originalProfile: defaultProfile,
			workspace: result.previous.cwd,
			createdAt: now,
			updatedAt: now,
		});
	}

	private hasSessionBinding(sessionId: string): boolean {
		const bindings = this.bindingStore?.list?.() ?? [...this.sessionBindings.values()];
		return bindings.some((binding) => binding.sessionId === sessionId);
	}

	private getProfileForSession(sessionKey: string): InitialSessionContext {
		const binding = this.resolveSessionBinding(sessionKey);
		const profileName = binding.currentProfile ?? binding.originalProfile;
		return this.pluginRegistry.createProfile(profileName);
	}

	private createSubagentRunner(parentSessionKey: string): PiboSubagentRunner {
		return {
			runSubagent: async ({ subagent, message, threadKey }) => {
				this.assertSubagentDepth(parentSessionKey, subagent);
				const sessionKey = createSubagentSessionKey(parentSessionKey, subagent.name, threadKey);
				this.sessionParentKeys.set(sessionKey, parentSessionKey);
				this.resolveSubagentBinding(sessionKey, subagent);

				const event: PiboMessageEvent = {
					type: "message",
					sessionKey,
					text: message,
					source: "actor",
					id: randomUUID(),
				};

				const reply = await this.emitMessageAndWaitForReply(event, subagent.timeoutMs);
				return { sessionKey, eventId: event.id!, reply };
			},
		};
	}

	private createRunToolController(parentSessionKey: string): PiboRunToolController {
		return {
			startToolRun: ({ toolName, completionPolicy, execute }) => {
				const run = this.runRegistry.startToolRun({
					ownerSessionKey: parentSessionKey,
					toolName,
					completionPolicy,
				});

				void (async () => {
					try {
						const result = await execute();
						const completed = this.runRegistry.complete(run.runId, result);
						if (completed) this.scheduleRunNotification(parentSessionKey, false);
					} catch (error) {
						const failed = this.runRegistry.fail(
							run.runId,
							error instanceof Error ? error.message : String(error),
						);
						if (failed) this.scheduleRunNotification(parentSessionKey, false);
					}
				})();

				return run;
			},
			listRuns: (options) => this.runRegistry.list(parentSessionKey, options),
			getRunStatus: (runId) => this.runRegistry.status(parentSessionKey, runId),
			waitForRun: (runId, timeoutMs) => this.runRegistry.wait(parentSessionKey, runId, timeoutMs),
			readRun: (runId) => this.runRegistry.read(parentSessionKey, runId),
			cancelRun: async (runId) => {
				const cancelled = this.runRegistry.cancel(parentSessionKey, runId);
				return cancelled;
			},
			ackRun: (runId) => this.runRegistry.ack(parentSessionKey, runId),
		};
	}

	private assertSubagentDepth(parentSessionKey: string, subagent: SubagentProfile): void {
		const maxDepth = subagent.maxDepth ?? 3;
		if (getSubagentSessionDepth(parentSessionKey) >= maxDepth) {
			throw new Error(
				`Subagent "${subagent.name}" exceeded max depth ${maxDepth} from session "${parentSessionKey}"`,
			);
		}
	}

	private resolveSubagentBinding(sessionKey: string, subagent: SubagentProfile): string {
		const targetProfile = this.pluginRegistry.resolveProfileName(subagent.targetProfile);
		const parentSessionKey = this.sessionParentKeys.get(sessionKey);
		const parentSessionId = parentSessionKey ? this.resolveSessionBinding(parentSessionKey).sessionId : undefined;
		const existing = this.bindingStore?.get(sessionKey);
		if (existing) {
			const existingProfile = existing.currentProfile ?? existing.originalProfile;
			if (existingProfile !== targetProfile) {
				throw new Error(
					`Subagent session "${sessionKey}" is already bound to profile "${existingProfile}", not "${targetProfile}"`,
				);
			}
			return targetProfile;
		}

		this.bindingStore?.resolve({
			channel: "subagent",
			externalId: sessionKey,
			sessionKey,
			parentSessionKey,
			parentSessionId,
			defaultProfile: targetProfile,
		});
		if (!this.bindingStore) {
			this.resolveSessionBinding(sessionKey, targetProfile, parentSessionKey);
		}
		return targetProfile;
	}

	private resolveSessionBinding(
		sessionKey: string,
		defaultProfile?: string,
		parentSessionKey = this.sessionParentKeys.get(sessionKey),
	): PiboSessionBinding {
		const existing = this.bindingStore?.get(sessionKey);
		if (existing) return existing;

		const parentSessionId = parentSessionKey ? this.resolveSessionBinding(parentSessionKey).sessionId : undefined;
		const profileName = defaultProfile ?? this.baseProfile.profileName;
		if (this.bindingStore) {
			return this.bindingStore.resolve({
				channel: "runtime",
				externalId: sessionKey,
				sessionKey,
				parentSessionKey,
				parentSessionId,
				defaultProfile: profileName,
			});
		}

		const inMemory = this.sessionBindings.get(sessionKey);
		if (inMemory) return inMemory;

		const now = new Date().toISOString();
		const binding: PiboSessionBinding = {
			sessionKey,
			sessionId: createPiboSessionId(),
			parentSessionKey,
			parentSessionId,
			channel: "runtime",
			externalId: sessionKey,
			originalProfile: profileName,
			createdAt: now,
			updatedAt: now,
		};
		this.sessionBindings.set(sessionKey, binding);
		return binding;
	}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		this.pluginRegistry.notifyEvent(event);
		for (const listener of this.listeners) {
			listener(event);
		}

		if (event.type === "message_finished" && event.source !== "service") {
			this.scheduleRunNotification(event.sessionKey, true);
		}
	};

	private scheduleRunNotification(sessionKey: string, includeAlreadyNotified: boolean): void {
		if (!this.runRegistry.hasPendingNotification(sessionKey, { includeAlreadyNotified })) return;
		const previous = this.scheduledRunNotifications.get(sessionKey);
		if (previous !== undefined) {
			this.scheduledRunNotifications.set(sessionKey, previous || includeAlreadyNotified);
			return;
		}

		this.scheduledRunNotifications.set(sessionKey, includeAlreadyNotified);
		queueMicrotask(() => {
			void this.deliverRunNotification(sessionKey);
		});
	}

	private async deliverRunNotification(sessionKey: string): Promise<void> {
		const includeAlreadyNotified = this.scheduledRunNotifications.get(sessionKey) ?? false;
		this.scheduledRunNotifications.delete(sessionKey);
		const notification = this.runRegistry.createNotification(sessionKey, { includeAlreadyNotified });
		if (!notification) return;

		try {
			const session = await this.getOrCreateSession(sessionKey);
			session.enqueueMessage({
				type: "message",
				sessionKey,
				text: formatRunNotification(notification),
				source: "service",
				id: randomUUID(),
			});
		} catch (error) {
			this.emitOutput({
				type: "session_error",
				sessionKey,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
