import { randomUUID } from "node:crypto";
import {
	InitialSessionContext,
	type InitialSessionContextOptions,
	type SubagentProfile,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboRuntime, type PiboRuntimeOptions } from "./runtime.js";
import { RoutedSession } from "./routed-session.js";
import type {
	PiboAssistantMessageEvent,
	PiboEventListener,
	PiboExecutionEvent,
	PiboJsonObject,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionOperationResult,
} from "./events.js";
import { createSubagentToolName, type PiboSubagentRunner } from "../subagents/tool.js";
import { PiboRunRegistry, type PiboRunNotification } from "../runs/registry.js";
import type { PiboRunToolController } from "../runs/tools.js";
import { createDefaultPiboReliabilityStore, type PiboReliabilityStore } from "../reliability/store.js";
import {
	InMemoryPiboSessionStore,
	type PiboSession,
	type PiboSessionStore,
} from "../sessions/store.js";

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
	sessionStore?: PiboSessionStore;
	forwardPiEvents?: boolean;
	reliabilityStore?: PiboReliabilityStore;
};

const DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

function profileForSession(
	baseProfile: InitialSessionContext,
	piSessionId: string,
	parentPiSessionId?: string,
): InitialSessionContext {
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		sessionId: piSessionId,
		parentSessionId: parentPiSessionId,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		subagents: baseProfile.subagents,
		contextFiles: baseProfile.contextFiles,
		builtinTools: baseProfile.builtinTools,
		autoContextFiles: baseProfile.autoContextFiles,
		toolPackages: baseProfile.toolPackages,
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

function isRunNotificationServiceMessage(event: PiboMessageEvent): boolean {
	return event.source === "service" && event.text.startsWith("<pibo_run_notification>");
}

function isTerminalRunStatus(status: string): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

function asJsonObject(value: PiboJsonObject | undefined): PiboJsonObject {
	return value ?? {};
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly runRegistry: PiboRunRegistry;
	private readonly scheduledRunNotifications = new Map<string, boolean>();
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly sessionStore: PiboSessionStore;
	private readonly reliabilityStore?: PiboReliabilityStore;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.sessionStore = options.sessionStore ?? new InMemoryPiboSessionStore();
		this.baseProfile = options.profile ?? this.pluginRegistry.createProfile("pibo-minimal");
		this.reliabilityStore = options.reliabilityStore ?? (options.persistSession === false ? undefined : createDefaultPiboReliabilityStore(options.cwd));
		this.runRegistry = new PiboRunRegistry({ store: this.reliabilityStore });
	}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		const session = await this.getOrCreateSession(event.piboSessionId);

		if (event.type === "message") {
			return session.enqueueMessage(event);
		}

		const output = await session.executeAction(event);
		if (event.action === "dispose") {
			this.runRegistry.cancelOwnerRuns(event.piboSessionId);
			this.scheduledRunNotifications.delete(event.piboSessionId);
			this.sessions.delete(event.piboSessionId);
		}
		return output;
	}

	getPiboSessionIds(): string[] {
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
					output.piboSessionId !== eventWithId.piboSessionId ||
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
				finish(new Error(`Timed out waiting for assistant reply from Pibo session "${eventWithId.piboSessionId}"`));
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
		await Promise.all(sessions.map((session) => session.dispose()));
	}

	private async getOrCreateSession(piboSessionId: string): Promise<RoutedSession> {
		const existing = this.sessions.get(piboSessionId);
		if (existing) return existing;

		const pending = this.pendingSessions.get(piboSessionId);
		if (pending) return pending;

		const created = this.createRoutedSession(piboSessionId);
		this.pendingSessions.set(piboSessionId, created);
		try {
			return await created;
		} finally {
			this.pendingSessions.delete(piboSessionId);
		}
	}

	private async createRoutedSession(piboSessionId: string): Promise<RoutedSession> {
		const piboSession = this.resolvePiboSession(piboSessionId);
		const profile = this.pluginRegistry.createProfile(piboSession.profile);
		const parentPiSessionId = piboSession.parentId
			? this.resolvePiboSession(piboSession.parentId).piSessionId
			: undefined;
		const runtime = await createPiboRuntime({
			cwd: piboSession.workspace ?? this.options.cwd,
			persistSession: this.options.persistSession,
			thinkingLevel: this.options.thinkingLevel,
			profile: profileForSession(profile, piboSession.piSessionId, parentPiSessionId),
			subagentRunner: this.createSubagentRunner(piboSession.id),
			runToolController: this.createRunToolController(piboSession.id),
		});
		const session = new RoutedSession(
			piboSession.id,
			runtime,
			this.emitOutput,
			this.pluginRegistry,
			this.options.forwardPiEvents ?? false,
			(result, event) => this.handleSessionOperation(result, event),
		);
		this.sessions.set(piboSession.id, session);
		return session;
	}

	private async handleSessionOperation(
		result: PiboSessionOperationResult,
		event: PiboExecutionEvent,
	): Promise<void> {
		if (result.cancelled) return;

		if (event.action === "session.fork" || event.action === "session.clone") {
			const action = event.action as "session.fork" | "session.clone";
			const created = this.createDerivedSession(result, action);
			result.piboSessionId = created.id;
			await this.resetCachedSession(event.piboSessionId);
			return;
		}

		this.sessionStore.update(event.piboSessionId, {
			piSessionId: result.current.piSessionId,
			workspace: result.current.cwd,
		});
	}

	private createDerivedSession(
		result: PiboSessionOperationResult,
		action: "session.fork" | "session.clone",
	): PiboSession {
		const source = this.resolvePiboSession(result.piboSessionId);
		return this.sessionStore.create({
			channel: source.channel,
			kind: "branch",
			profile: source.profile,
			ownerScope: source.ownerScope,
			parentId: source.kind === "subagent" ? source.parentId : undefined,
			originId: source.id,
			piSessionId: result.current.piSessionId,
			workspace: result.current.cwd,
			title: source.title,
			metadata: {
				...asJsonObject(source.metadata),
				originAction: action,
				originPiSessionId: result.previous.piSessionId,
			},
		});
	}

	private async resetCachedSession(piboSessionId: string): Promise<void> {
		const cached = this.sessions.get(piboSessionId);
		this.sessions.delete(piboSessionId);
		await cached?.dispose();
	}

	private resolvePiboSession(piboSessionId: string): PiboSession {
		const existing = this.sessionStore.get(piboSessionId);
		if (existing) return existing;

		return this.sessionStore.create({
			id: piboSessionId,
			channel: "pibo.runtime",
			kind: "runtime",
			profile: this.baseProfile.profileName,
			workspace: this.options.cwd,
		});
	}

	private createSubagentRunner(parentPiboSessionId: string): PiboSubagentRunner {
		return {
			runSubagent: async ({ subagent, message, threadKey, toolCallId }) => {
				this.assertSubagentDepth(parentPiboSessionId, subagent);
				const child = this.resolveSubagentSession(parentPiboSessionId, subagent, threadKey);
				const toolName = createSubagentToolName(subagent.name);

				const event: PiboMessageEvent = {
					type: "message",
					piboSessionId: child.id,
					text: message,
					source: "actor",
					id: randomUUID(),
				};

				this.emitOutput({
					type: "subagent_session",
					piboSessionId: parentPiboSessionId,
					toolCallId,
					toolName,
					subagentName: subagent.name,
					childPiboSessionId: child.id,
					threadKey: typeof child.metadata?.threadKey === "string" ? child.metadata.threadKey : undefined,
				});

				const reply = await this.emitMessageAndWaitForReply(
					event,
					subagent.timeoutMs ?? DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS,
				);
				return { piboSessionId: child.id, eventId: event.id!, reply };
			},
		};
	}

	private createRunToolController(parentPiboSessionId: string): PiboRunToolController {
		return {
			startToolRun: ({ toolName, params, completionPolicy, retryable, maxAttempts, execute }) => {
				const run = this.runRegistry.startToolRun({
					ownerPiboSessionId: parentPiboSessionId,
					toolName,
					params,
					completionPolicy,
					retryable,
					maxAttempts,
				});

				void (async () => {
					try {
						const result = await execute();
						const completed = this.runRegistry.complete(run.runId, result);
						if (completed) this.scheduleRunNotification(parentPiboSessionId, false);
					} catch (error) {
						const failed = this.runRegistry.fail(
							run.runId,
							error instanceof Error ? error.message : String(error),
						);
						if (failed) this.scheduleRunNotification(parentPiboSessionId, false);
					}
				})();

				return run;
			},
			listRuns: (options) => this.runRegistry.list(parentPiboSessionId, options),
			getRunStatus: (runId) => this.runRegistry.status(parentPiboSessionId, runId),
			waitForRun: (runId, timeoutMs) => this.runRegistry.wait(parentPiboSessionId, runId, timeoutMs),
			readRun: (runId) => {
				const run = this.runRegistry.read(parentPiboSessionId, runId);
				if (run.consumed && isTerminalRunStatus(run.status)) {
					this.refreshQueuedRunNotifications(parentPiboSessionId);
				}
				return run;
			},
			cancelRun: async (runId) => {
				const cancelled = this.runRegistry.cancel(parentPiboSessionId, runId);
				this.refreshQueuedRunNotifications(parentPiboSessionId);
				return cancelled;
			},
			ackRun: (runId) => {
				const run = this.runRegistry.ack(parentPiboSessionId, runId);
				this.refreshQueuedRunNotifications(parentPiboSessionId);
				return run;
			},
		};
	}

	private assertSubagentDepth(parentPiboSessionId: string, subagent: SubagentProfile): void {
		const maxDepth = subagent.maxDepth ?? 3;
		if (this.getSubagentDepth(parentPiboSessionId) >= maxDepth) {
			throw new Error(
				`Subagent "${subagent.name}" exceeded max depth ${maxDepth} from Pibo session "${parentPiboSessionId}"`,
			);
		}
	}

	private getSubagentDepth(piboSessionId: string): number {
		let depth = 0;
		let current = this.sessionStore.get(piboSessionId);
		const seen = new Set<string>();
		while (current?.parentId) {
			if (seen.has(current.parentId)) break;
			seen.add(current.parentId);
			depth += 1;
			current = this.sessionStore.get(current.parentId);
		}
		return depth;
	}

	private resolveSubagentSession(
		parentPiboSessionId: string,
		subagent: SubagentProfile,
		threadKey?: string,
	): PiboSession {
			const targetProfile = this.pluginRegistry.resolveProfileName(subagent.targetProfile);
			const parent = this.resolvePiboSession(parentPiboSessionId);
			const resolvedThreadKey = threadKey?.trim() ? threadKey.trim() : randomUUID();
			const metadata: PiboJsonObject = {
				subagentName: subagent.name,
				subagentToolName: createSubagentToolName(subagent.name),
				threadKey: resolvedThreadKey,
			};
			const parentChatRoomId = typeof parent.metadata?.chatRoomId === "string" ? parent.metadata.chatRoomId : undefined;
			if (parentChatRoomId) metadata.chatRoomId = parentChatRoomId;
			const legacyMetadata: PiboJsonObject = parentChatRoomId
				? {
						subagentName: subagent.name,
						subagentToolName: createSubagentToolName(subagent.name),
						threadKey: resolvedThreadKey,
					}
				: metadata;
			const existing = this.sessionStore.find({
				channel: "pibo.subagents",
				kind: "subagent",
				parentId: parent.id,
				profile: targetProfile,
				metadata,
			})[0] ?? this.sessionStore.find({
				channel: "pibo.subagents",
				kind: "subagent",
				parentId: parent.id,
				profile: targetProfile,
				metadata: legacyMetadata,
			})[0];
			if (existing) {
				if (parentChatRoomId && existing.metadata?.chatRoomId !== parentChatRoomId) {
					return this.sessionStore.update(existing.id, { metadata: { ...(existing.metadata ?? {}), chatRoomId: parentChatRoomId } }) ?? existing;
				}
				return existing;
			}

			return this.sessionStore.create({
				channel: "pibo.subagents",
				kind: "subagent",
				profile: targetProfile,
				ownerScope: parent.ownerScope,
				parentId: parent.id,
				workspace: parent.workspace,
				metadata,
			});
		}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		this.pluginRegistry.notifyEvent(event);
		for (const listener of this.listeners) {
			listener(event);
		}

		if (event.type === "message_finished" && event.source !== "service") {
			this.scheduleRunNotification(event.piboSessionId, true);
		}
	};

	private scheduleRunNotification(piboSessionId: string, includeAlreadyNotified: boolean): void {
		if (!this.runRegistry.hasPendingNotification(piboSessionId, { includeAlreadyNotified })) return;
		const previous = this.scheduledRunNotifications.get(piboSessionId);
		if (previous !== undefined) {
			this.scheduledRunNotifications.set(piboSessionId, previous || includeAlreadyNotified);
			return;
		}

		this.scheduledRunNotifications.set(piboSessionId, includeAlreadyNotified);
		queueMicrotask(() => {
			void this.deliverRunNotification(piboSessionId);
		});
	}

	private refreshQueuedRunNotifications(piboSessionId: string): void {
		const removed = this.sessions.get(piboSessionId)?.removeQueuedMessages(isRunNotificationServiceMessage) ?? 0;
		if (removed > 0) this.scheduleRunNotification(piboSessionId, true);
	}

	private async deliverRunNotification(piboSessionId: string): Promise<void> {
		const includeAlreadyNotified = this.scheduledRunNotifications.get(piboSessionId) ?? false;
		this.scheduledRunNotifications.delete(piboSessionId);
		const notification = this.runRegistry.createNotification(piboSessionId, { includeAlreadyNotified });
		if (!notification) return;

		try {
			const session = await this.getOrCreateSession(piboSessionId);
			session.enqueueMessage({
				type: "message",
				piboSessionId,
				text: formatRunNotification(notification),
				source: "service",
				id: randomUUID(),
			});
		} catch (error) {
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
