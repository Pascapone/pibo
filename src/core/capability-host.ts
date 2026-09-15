import { randomUUID } from "node:crypto";
import type { PluginHost } from "../plugins/host.js";
import { CapabilityProjection } from "../plugins/capability-projection.js";
import type {
	ContextFileProfile,
	InitialSessionContext,
	SkillProfile,
	SubagentProfile,
	ToolProfile,
	ToolProfileRegistration,
} from "./profiles.js";
import { normalizeToolProfile } from "./profiles.js";
import type { PiboOutputEvent } from "./events.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type {
	PiboTranscriptionProvider,
	PiboTranscriptionProviderInfo,
	PiboTranscriptionRequest,
	PiboTranscriptionResult,
} from "../transcription/types.js";
import {
	PiboSpeechError,
	type PiboSpeechProvider,
	type PiboSpeechProviderInfo,
	type PiboSpeechProviderSession,
	type PiboSpeechRequest,
	type PiboSpeechSessionStartOptions,
	type PiboSpeechSessionStartRequest,
	type PiboSpeechSessionStartResult,
} from "../speech/types.js";
import type {
	PiboGatewayAction,
	PiboGatewayActionInfo,
	PiboPluginEventListener,
	PiboProductEvent,
	PiboProductEventInput,
	PiboProductEventListener,
	PiboCapabilityCatalog,
	PiboProfileInfo,
	PiboProfileBuildContext,
	PiboProfileDefinition,
	PiboLoopStopConditionDefinition,
} from "../plugins/types.js";
import { AgentRuntimeAdapterRegistry } from "../agent-runtime/registry.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeDriver,
	AgentRuntimeInstanceDefinition,
	AgentRuntimeSession,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	OpenAgentRuntimeSessionInput,
	StartAgentRuntimeAuthInput,
} from "../agent-runtime/types.js";

export type PiboCapabilityHostOptions = {
	/** Typed read-through over the one active PluginHost contribution index. */
	host?: PluginHost;
	maxActiveSpeechSessions?: number;
	speechSessionIdleTimeoutMs?: number;
	speechSessionStartTimeoutMs?: number;
};

const MAX_ACTIVE_SPEECH_SESSIONS = 8;
const SPEECH_SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 1_000;
const SPEECH_SESSION_START_TIMEOUT_MS = 30_000;

type Deferred = {
	promise: Promise<void>;
	resolve(): void;
};

type OwnedSpeechProviderSession = {
	session: PiboSpeechProviderSession;
	stop(): Promise<void>;
};

type PendingSpeechStart = {
	controller: AbortController;
	timeout: ReturnType<typeof setTimeout>;
	settled: Deferred;
	release(): void;
};

type ActiveSpeechSession = {
	provider: PiboSpeechProvider;
	owned: OwnedSpeechProviderSession;
	timer: ReturnType<typeof setTimeout>;
	unlinkAbort(): void;
};

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function ownSpeechProviderSession(session: PiboSpeechProviderSession): OwnedSpeechProviderSession {
	let stopPromise: Promise<void> | undefined;
	return {
		session,
		stop() {
			stopPromise ??= Promise.resolve().then(() => session.stop());
			return stopPromise;
		},
	};
}

function speechAbortError(signal: AbortSignal): PiboSpeechError {
	if (signal.reason instanceof PiboSpeechError) return signal.reason;
	const message = signal.reason instanceof Error && signal.reason.message
		? signal.reason.message
		: "Speech session startup was aborted.";
	return new PiboSpeechError(message, "aborted", { cause: signal.reason });
}

async function waitForSpeechProviderStart(
	start: Promise<PiboSpeechProviderSession>,
	signal: AbortSignal,
): Promise<PiboSpeechProviderSession> {
	if (signal.aborted) throw speechAbortError(signal);
	let onAbort: (() => void) | undefined;
	try {
		return await Promise.race([
			start,
			new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(speechAbortError(signal));
				signal.addEventListener("abort", onAbort, { once: true });
			}),
		]);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

function positiveTimeout(value: number | undefined, fallback: number, name: string): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive safe integer`);
	return selected;
}

async function waitBounded(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			promise,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, timeoutMs);
				timer.unref?.();
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

type WebAppRoute = {
	label: "mountPath" | "apiPrefix";
	prefix: string;
};

function getWebAppRoutes(app: PiboWebApp): WebAppRoute[] {
	return [
		{ label: "mountPath", prefix: app.mountPath },
		{ label: "apiPrefix", prefix: app.apiPrefix },
	];
}

function validateWebRoute(appName: string, label: string, prefix: string): void {
	if (!prefix.startsWith("/")) {
		throw new Error(`Web app "${appName}" ${label} must start with "/"`);
	}
	if (prefix.length > 1 && prefix.endsWith("/")) {
		throw new Error(`Web app "${appName}" ${label} must not end with "/"`);
	}
}

function webRoutesOverlap(left: string, right: string): boolean {
	return left === right || left === "/" || right === "/" || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function toolIsPortable(tool: ToolProfile): boolean {
	if (tool.portable !== undefined) return tool.portable;
	if (tool.definition) return tool.definition.portable !== false;
	// Inventory must never execute factories. Undeclared factory portability is unknown/private.
	return !tool.createDefinition;
}

export class PiboCapabilityHost {
	private readonly maxActiveSpeechSessions: number;
	private readonly speechSessionIdleTimeoutMs: number;
	private readonly speechSessionStartTimeoutMs: number;
	private readonly projection = new CapabilityProjection();
	private readonly agentRuntimes = new AgentRuntimeAdapterRegistry();
	private projectedAgentRuntimeSignature = "";
	private projectedAgentRuntimeDriverIds: string[] = [];
	private projectedAgentRuntimeInstanceIds: string[] = [];
	private readonly tools = this.projection.map<ToolProfile>("tool", (value, _contribution, pluginId) => normalizeToolProfile({ ...(value as ToolProfileRegistration), pluginId }));
	private readonly subagents = this.projection.map<SubagentProfile>("subagent", (value) => value as SubagentProfile);
	private readonly skills = this.projection.map<SkillProfile>("skill", (value, _contribution, pluginId) => ({ ...(value as SkillProfile), pluginId }));
	private readonly contextFiles = this.projection.map<ContextFileProfile>("context-file", (value, _contribution, pluginId) => ({ ...(value as ContextFileProfile), source: (value as ContextFileProfile).source ?? "plugin", pluginId }));
	private readonly profiles = this.projection.map<PiboProfileDefinition>("profile", (value) => value as PiboProfileDefinition);
	private readonly profileAliases = this.projection.map<string>("profile-alias");
	private readonly gatewayActions = this.projection.map<PiboGatewayAction>("gateway-action", (value) => value as PiboGatewayAction);
	private readonly gatewaySlashCommands = this.projection.map<string>("gateway-slash-command");
	private readonly channels = this.projection.map<PiboChannel>("channel", (value) => value as PiboChannel);
	private readonly authServices = this.projection.map<PiboAuthService>("auth-service", (value) => value as PiboAuthService);
	private readonly transcriptionProviders = this.projection.map<PiboTranscriptionProvider>("transcription-provider", (value) => value as PiboTranscriptionProvider);
	private readonly speechProviders = this.projection.map<PiboSpeechProvider>("speech-provider", (value) => value as PiboSpeechProvider);
	private readonly pendingSpeechStarts = new Map<string, PendingSpeechStart>();
	private readonly speechSessions = new Map<string, ActiveSpeechSession>();
	private speechProvidersDisposed = false;
	private speechDisposePromise?: Promise<void>;
	private readonly webApps = this.projection.map<PiboWebApp>("web-app", (value) => value as PiboWebApp);
	private readonly ownerNames = this.projection.map<string>("owner-name");
	private readonly eventListeners = new Set<PiboPluginEventListener>();
	private readonly productEventListeners = new Set<PiboProductEventListener>();
	private readonly loopStopConditions = this.projection.map<{ definition: PiboLoopStopConditionDefinition; pluginId?: string }>("loop-stop-condition", (value, _contribution, pluginId) => ({ definition: value as PiboLoopStopConditionDefinition, pluginId }));
	private get pluginNames(): Map<string, string> {
		return new Map([...this.ownerNames.entries(), ...this.projection.host.inspect().plugins.map((entry) => [entry.pluginId, entry.manifest.name] as const)]);
	}
	private readonly eventErrors: string[] = [];

	constructor(options: PiboCapabilityHostOptions = {}) {
		if (options.host) this.projection.host = options.host;
		this.maxActiveSpeechSessions = positiveTimeout(options.maxActiveSpeechSessions, MAX_ACTIVE_SPEECH_SESSIONS, "maxActiveSpeechSessions");
		this.speechSessionIdleTimeoutMs = positiveTimeout(options.speechSessionIdleTimeoutMs, SPEECH_SESSION_IDLE_TIMEOUT_MS, "speechSessionIdleTimeoutMs");
		this.speechSessionStartTimeoutMs = positiveTimeout(options.speechSessionStartTimeoutMs, SPEECH_SESSION_START_TIMEOUT_MS, "speechSessionStartTimeoutMs");
	}

	static create(options: PiboCapabilityHostOptions = {}): PiboCapabilityHost {
		return new PiboCapabilityHost(options);
	}

	getPluginHost(): PluginHost { return this.projection.host; }

	private syncProjectedAgentRuntimes(): void {
		const entries = this.projection.host.contributions.list<{ installation: { revision: string }; contribution: { kind: string }; value: unknown }>("contribution")
			.filter((entry) => entry.value.contribution.kind === "agent-runtime-driver" || entry.value.contribution.kind === "agent-runtime-instance");
		const signature = entries.map((entry) => `${entry.key}:${entry.value.installation.revision}`).sort().join("|");
		if (signature === this.projectedAgentRuntimeSignature) return;
		for (const id of [...this.projectedAgentRuntimeInstanceIds].reverse()) this.agentRuntimes.unregisterInstance(id);
		for (const id of [...this.projectedAgentRuntimeDriverIds].reverse()) this.agentRuntimes.unregisterDriver(id);
		this.projectedAgentRuntimeDriverIds = [];
		this.projectedAgentRuntimeInstanceIds = [];
		for (const entry of entries.filter((item) => item.value.contribution.kind === "agent-runtime-driver")) {
			const driver = entry.value.value as AgentRuntimeDriver<unknown>;
			this.agentRuntimes.registerDriver(driver);
			this.projectedAgentRuntimeDriverIds.push(driver.descriptor.id);
		}
		for (const entry of entries.filter((item) => item.value.contribution.kind === "agent-runtime-instance")) {
			const instance = entry.value.value as AgentRuntimeInstanceDefinition;
			this.agentRuntimes.registerInstance(instance);
			this.projectedAgentRuntimeInstanceIds.push(instance.id);
		}
		this.projectedAgentRuntimeSignature = signature;
	}

	registerAgentRuntimeDriver<TConfig>(driver: AgentRuntimeDriver<TConfig>): void {
		this.agentRuntimes.registerDriver(driver);
	}

	registerAgentRuntimeInstance(instance: AgentRuntimeInstanceDefinition): AgentRuntimeAdapter {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.registerInstance(instance);
	}

	getAgentRuntimeAdapter(instanceId: string): AgentRuntimeAdapter | undefined {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.getInstance(instanceId);
	}

	requireAgentRuntimeAdapter(instanceId: string): AgentRuntimeAdapter {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.requireInstance(instanceId);
	}

	openAgentRuntimeSession(instanceId: string, input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.openSession(instanceId, input);
	}

	getAgentRuntimeInstanceIds(): string[] {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.getInstanceIds();
	}

	inspectAgentRuntimeInstances() {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.inspectInstances();
	}

	getAgentRuntimeAuthStatus(runtimeInstanceId: string) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.getAuthStatus(runtimeInstanceId);
	}

	startAgentRuntimeAuth(runtimeInstanceId: string, input: StartAgentRuntimeAuthInput) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.startAuth(runtimeInstanceId, input);
	}

	completeAgentRuntimeAuth(runtimeInstanceId: string, input: CompleteAgentRuntimeAuthInput) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.completeAuth(runtimeInstanceId, input);
	}

	cancelAgentRuntimeAuth(runtimeInstanceId: string, input: CancelAgentRuntimeAuthInput) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.cancelAuth(runtimeInstanceId, input);
	}

	logoutAgentRuntimeAuth(runtimeInstanceId: string, input: LogoutAgentRuntimeAuthInput) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.logoutAuth(runtimeInstanceId, input);
	}

	disposeAgentRuntimeAuth() {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.disposeAuth();
	}

	validateAgentRuntimeProfile(profile: InitialSessionContext, workspace?: string) {
		this.syncProjectedAgentRuntimes();
		return this.agentRuntimes.validateProfile({ profile, workspace });
	}

	registerCapabilityOwnerName(id: string, name: string): void {
		this.ownerNames.set(id, name);
	}

	registerTool(tool: ToolProfileRegistration): void {
		const normalized = normalizeToolProfile(tool);
		this.addUnique(this.tools, normalized.name, normalized, "tool");
	}

	registerTools(tools: readonly ToolProfileRegistration[]): void {
		for (const tool of tools) {
			this.registerTool(tool);
		}
	}

	registerSubagent(subagent: SubagentProfile): void {
		this.addUnique(this.subagents, subagent.name, subagent, "subagent");
	}

	registerSubagents(subagents: readonly SubagentProfile[]): void {
		for (const subagent of subagents) {
			this.registerSubagent(subagent);
		}
	}

	registerSkill(skill: SkillProfile): void {
		this.addUnique(this.skills, skill.name, skill, "skill");
	}

	unregisterSkill(name: string): boolean {
		return this.skills.delete(name);
	}

	getRegisteredSkillNames(): string[] {
		return [...this.skills.keys()];
	}

	registerContextFile(contextFile: ContextFileProfile): void {
		this.addUnique(this.contextFiles, contextFileKey(contextFile), contextFile, "context file");
	}

	upsertContextFile(contextFile: ContextFileProfile): void {
		this.contextFiles.set(contextFileKey(contextFile), contextFile);
	}

	removeContextFile(key: string): void {
		this.contextFiles.delete(key);
	}

	registerProfile(profile: PiboProfileDefinition): void {
		this.addUnique(this.profiles, profile.name, profile, "profile");
		this.registerProfileAliases(profile);
	}

	upsertProfile(profile: PiboProfileDefinition): void {
		this.profiles.set(profile.name, profile);
		for (const [alias, profileName] of this.profileAliases.entries()) {
			if (profileName === profile.name) this.profileAliases.delete(alias);
		}
		this.registerProfileAliases(profile);
	}

	removeProfile(name: string): void {
		const resolvedName = this.profileAliases.get(name) ?? name;
		if (!this.profiles.delete(resolvedName)) return;
		for (const [alias, profileName] of this.profileAliases.entries()) {
			if (profileName === resolvedName) this.profileAliases.delete(alias);
		}
	}

	registerGatewayAction(action: PiboGatewayAction): void {
		const slashCommands = this.getGatewaySlashCommandsToRegister(action);
		this.addUnique(this.gatewayActions, action.name, action, "gateway action");
		for (const slashCommand of slashCommands) {
			this.gatewaySlashCommands.set(slashCommand, action.name);
		}
	}

	upsertGatewayAction(action: PiboGatewayAction): void {
		for (const [slashCommand, actionName] of this.gatewaySlashCommands.entries()) {
			if (actionName === action.name) this.gatewaySlashCommands.delete(slashCommand);
		}
		this.gatewayActions.set(action.name, action);
		for (const slashCommand of this.getGatewaySlashCommandsToRegister(action)) {
			this.gatewaySlashCommands.set(slashCommand, action.name);
		}
	}

	registerChannel(channel: PiboChannel): void {
		this.addUnique(this.channels, channel.name, channel, "channel");
	}

	registerAuthService(service: PiboAuthService): void {
		const existing = this.getAuthService();
		if (existing) {
			throw new Error(`Auth service "${existing.name}" is already registered`);
		}
		this.authServices.set(service.name, service);
	}

	registerTranscriptionProvider(provider: PiboTranscriptionProvider): void {
		this.addUnique(this.transcriptionProviders, provider.id, provider, "transcription provider");
	}

	async getTranscriptionProviderInfos(): Promise<PiboTranscriptionProviderInfo[]> {
		return await Promise.all([...this.transcriptionProviders.values()].map(async (provider) => ({
			id: provider.id,
			name: provider.name,
			description: provider.description,
			configured: provider.isConfigured ? await Promise.resolve(provider.isConfigured()).catch(() => false) : true,
			pluginId: provider.pluginId,
			pluginName: provider.pluginId ? this.pluginNames.get(provider.pluginId) : undefined,
		})));
	}

	async transcribe(providerId: string, input: PiboTranscriptionRequest): Promise<PiboTranscriptionResult> {
		const provider = this.getRequired(this.transcriptionProviders, providerId, "transcription provider");
		return { providerId, ...await provider.transcribe(input) };
	}

	registerSpeechProvider(provider: PiboSpeechProvider): void {
		this.addUnique(this.speechProviders, provider.id, provider, "speech provider");
	}

	getSpeechProviderIds(): string[] {
		return [...this.speechProviders.keys()];
	}

	async getSpeechProviderInfos(): Promise<PiboSpeechProviderInfo[]> {
		return await Promise.all([...this.speechProviders.values()].map(async (provider) => ({
			id: provider.id,
			name: provider.name,
			description: provider.description,
			configured: provider.isConfigured ? await Promise.resolve(provider.isConfigured()).catch(() => false) : true,
			pluginId: provider.pluginId,
			pluginName: provider.pluginId ? this.pluginNames.get(provider.pluginId) : undefined,
		})));
	}

	async startSpeechSession(
		providerId: string,
		input: PiboSpeechSessionStartRequest,
		options: PiboSpeechSessionStartOptions = {},
	): Promise<PiboSpeechSessionStartResult> {
		const provider = this.getRequired(this.speechProviders, providerId, "speech provider");
		if (this.speechProvidersDisposed) throw new PiboSpeechError("Speech providers are shutting down.", "aborted");
		if (this.speechSessions.size + this.pendingSpeechStarts.size >= this.maxActiveSpeechSessions) {
			throw new PiboSpeechError("Too many speech sessions are active. Try again shortly.", "capacity_exceeded");
		}

		const reservationId = randomUUID();
		const controller = new AbortController();
		const settled = deferred();
		const abortFromCaller = () => controller.abort(options.signal?.reason);
		if (options.signal?.aborted) abortFromCaller();
		else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
		const timeout = setTimeout(() => {
			controller.abort(new PiboSpeechError("Speech session startup timed out.", "provider_error"));
		}, this.speechSessionStartTimeoutMs);
		timeout.unref?.();
		let owned: OwnedSpeechProviderSession | undefined;
		let published = false;
		let releaseInFinally = true;
		let reservationReleased = false;
		const releaseReservation = () => {
			if (reservationReleased) return;
			reservationReleased = true;
			clearTimeout(timeout);
			this.pendingSpeechStarts.delete(reservationId);
			settled.resolve();
			if (!published) options.signal?.removeEventListener("abort", abortFromCaller);
		};
		this.pendingSpeechStarts.set(reservationId, { controller, timeout, settled, release: releaseReservation });
		let providerSettled = false;
		let providerResult: PiboSpeechProviderSession | undefined;
		const providerStart = Promise.resolve()
			.then(() => provider.startSession(input, { signal: controller.signal }))
			.then(
				(session) => {
					providerSettled = true;
					providerResult = session;
					return session;
				},
				(error) => {
					providerSettled = true;
					throw error;
				},
			);
		try {
			if (controller.signal.aborted) throw speechAbortError(controller.signal);
			owned = ownSpeechProviderSession(await waitForSpeechProviderStart(providerStart, controller.signal));
			if (controller.signal.aborted || this.speechProvidersDisposed) {
				await owned.stop().catch(() => {});
				throw speechAbortError(controller.signal);
			}
			const { sessionId, answerSdp } = owned.session;
			if (this.speechSessions.has(sessionId)) {
				await owned.stop().catch(() => {});
				throw new PiboSpeechError("Speech provider returned a duplicate session.", "provider_error");
			}
			const unlinkAbort = () => options.signal?.removeEventListener("abort", abortFromCaller);
			const entry = {
				provider,
				owned,
				timer: setTimeout(() => {
					void this.closeSpeechSession(sessionId, entry).catch(() => {});
				}, this.speechSessionIdleTimeoutMs),
				unlinkAbort,
			};
			entry.timer.unref?.();
			this.speechSessions.set(sessionId, entry);
			published = true;
			controller.signal.addEventListener("abort", () => {
				void this.closeSpeechSession(sessionId, entry).catch(() => {});
			}, { once: true });
			if (controller.signal.aborted) {
				await this.closeSpeechSession(sessionId, entry).catch(() => {});
				throw speechAbortError(controller.signal);
			}
			return { providerId, sessionId, answerSdp };
		} catch (error) {
			if (controller.signal.aborted && !owned && providerResult) {
				await ownSpeechProviderSession(providerResult).stop().catch(() => {});
			} else if (controller.signal.aborted && !providerSettled) {
				releaseInFinally = false;
				options.signal?.removeEventListener("abort", abortFromCaller);
				void providerStart
					.then(async (lateSession) => await ownSpeechProviderSession(lateSession).stop())
					.catch(() => {})
					.finally(releaseReservation);
			}
			if (controller.signal.aborted) throw speechAbortError(controller.signal);
			throw error;
		} finally {
			if (releaseInFinally) releaseReservation();
		}
	}

	async speakSpeechSession(sessionId: string, input: PiboSpeechRequest): Promise<void> {
		const entry = this.speechSessions.get(sessionId);
		if (!entry) throw new PiboSpeechError("Speech session was not found.", "session_not_found");
		let speechError: unknown;
		try {
			await entry.owned.session.speak(input);
		} catch (error) {
			speechError = error;
		} finally {
			try {
				await this.closeSpeechSession(sessionId, entry);
			} catch (error) {
				if (speechError === undefined) speechError = error;
			}
		}
		if (speechError !== undefined) throw speechError;
	}

	async stopSpeechSession(sessionId: string): Promise<void> {
		const entry = this.speechSessions.get(sessionId);
		if (!entry) return;
		await this.closeSpeechSession(sessionId, entry);
	}

	async disposeSpeechProviders(): Promise<void> {
		this.speechDisposePromise ??= (async () => {
			this.speechProvidersDisposed = true;
			const shutdownError = new PiboSpeechError("Speech providers are shutting down.", "aborted");
			const pending = [...this.pendingSpeechStarts.values()];
			for (const reservation of pending) reservation.controller.abort(shutdownError);
			const cleanup = Promise.allSettled([
				...([...this.speechSessions.entries()].map(
					async ([sessionId, entry]) => await this.closeSpeechSession(sessionId, entry),
				)),
				...pending.map((reservation) => reservation.settled.promise),
				...([...this.speechProviders.values()].map(async (provider) => await provider.dispose?.())),
			]);
			await waitBounded(cleanup, this.speechSessionStartTimeoutMs);
			for (const reservation of this.pendingSpeechStarts.values()) reservation.release();
		})();
		await this.speechDisposePromise;
	}

	private closeSpeechSession(sessionId: string, entry: ActiveSpeechSession): Promise<void> {
		clearTimeout(entry.timer);
		entry.unlinkAbort();
		if (this.speechSessions.get(sessionId) === entry) this.speechSessions.delete(sessionId);
		return entry.owned.stop();
	}

	registerWebApp(app: PiboWebApp): void {
		if (this.webApps.has(app.name)) {
			throw new Error(`Duplicate web app "${app.name}"`);
		}
		this.validateWebAppRoutes(app);
		this.webApps.set(app.name, app);
	}

	registerLoopStopCondition(condition: PiboLoopStopConditionDefinition, pluginId?: string): void {
		if (!condition.type.trim()) throw new Error('Loop stop condition type is required');
		if (!condition.name.trim()) throw new Error(`Loop stop condition "${condition.type}" name is required`);
		if (condition.phases.length === 0) throw new Error(`Loop stop condition "${condition.type}" must support at least one phase`);
		this.addUnique(this.loopStopConditions, condition.type, { definition: { ...condition, phases: [...condition.phases] }, pluginId }, 'Loop stop condition');
	}

	registerRalphStopCondition(condition: PiboLoopStopConditionDefinition, pluginId?: string): void { this.registerLoopStopCondition(condition, pluginId); }

	getLoopStopConditionDefinitions(): PiboLoopStopConditionDefinition[] {
		return [...this.loopStopConditions.values()].map((entry) => entry.definition);
	}

	getRalphStopConditionDefinitions(): PiboLoopStopConditionDefinition[] { return this.getLoopStopConditionDefinitions(); }

	getLoopStopConditionInfos() {
		return [...this.loopStopConditions.values()].map((entry) => ({
			type: entry.definition.type,
			name: entry.definition.name,
			description: entry.definition.description,
			phases: [...entry.definition.phases],
			optionsSchema: entry.definition.optionsSchema,
			defaultOptions: entry.definition.defaultOptions,
			pluginId: entry.pluginId,
			pluginName: entry.pluginId ? this.pluginNames.get(entry.pluginId) : undefined,
		}));
	}

	getRalphStopConditionInfos() { return this.getLoopStopConditionInfos(); }

	onEvent(listener: PiboPluginEventListener): void {
		this.eventListeners.add(listener);
	}

	onProductEvent(listener: PiboProductEventListener): () => void {
		this.productEventListeners.add(listener);
		return () => {
			this.productEventListeners.delete(listener);
		};
	}

	createProfile(name: string): InitialSessionContext {
		const resolvedName = this.resolveProfileName(name);
		const profile = this.profiles.get(resolvedName);
		if (!profile) throw new Error(`Unknown profile "${name}"`);

		return profile.create(this.createProfileBuildContext());
	}

	getProfileNames(): string[] {
		return [...this.profiles.keys()];
	}

	getProfileInfos(): PiboProfileInfo[] {
		const context = this.createProfileBuildContext();
		return [...this.profiles.values()].map((profile) => {
			const sessionContext = profile.create(context);
			return {
				name: profile.name,
				description: profile.description,
				aliases: [...(profile.aliases ?? [])],
				runtimeInstanceId: sessionContext.runtimeInstanceId,
				runtimeOptions: structuredClone(sessionContext.runtimeOptions),
				nativeTools: sessionContext.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name),
				skills: sessionContext.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.name),
				contextFiles: sessionContext.contextFiles.filter((contextFile) => contextFile.enabled !== false).map(contextFileKey),
				diagnostics: sessionContext.diagnostics.map((diagnostic) => ({ ...diagnostic })),
				subagents: sessionContext.subagents.filter((subagent) => subagent.enabled !== false),
				mcpServers: [...sessionContext.mcpServers],
				model: sessionContext.model ? { ...sessionContext.model } : undefined,
				mainModel: sessionContext.mainModel ? { ...sessionContext.mainModel } : undefined,
				mainModelFallbacks: sessionContext.mainModelFallbacks.map((model) => ({ ...model })),
				subagentModel: sessionContext.subagentModel ? { ...sessionContext.subagentModel } : undefined,
				thinkingLevel: sessionContext.thinkingLevel,
				mainThinkingLevel: sessionContext.mainThinkingLevel,
				subagentThinkingLevel: sessionContext.subagentThinkingLevel,
				fast: sessionContext.fast,
				mainFast: sessionContext.mainFast,
				subagentFast: sessionContext.subagentFast,
				builtinTools: sessionContext.builtinTools,
				builtinToolNames: [...sessionContext.builtinToolNames],
				autoContextFiles: sessionContext.autoContextFiles,
				nativeSubagents: sessionContext.nativeSubagents,
				runControl: sessionContext.toolPackages.runControl === true,
				goalControl: sessionContext.toolPackages.goalControl !== false,
			};
		});
	}

	getCapabilityCatalog(): PiboCapabilityCatalog {
		this.syncProjectedAgentRuntimes();
		const tools = new Map([...this.tools.values()].map((tool) => [tool.name, tool]));
		for (const installation of this.projection.host.inspect().plugins) {
			for (const contribution of installation.manifest.contributions) {
				if (contribution.scope !== "agent" || contribution.kind !== "tool") continue;
				const name = contribution.name ?? contribution.id;
				if (!tools.has(name)) tools.set(name, normalizeToolProfile({
					name,
					description: contribution.context.kind === "context" ? contribution.context.description : contribution.title ?? name,
					pluginId: installation.pluginId,
					providerBacked: true,
					portable: contribution.runtime === undefined,
					yieldable: contribution.yieldable,
					...(Array.isArray(contribution.metadata?.replacesBuiltinTools)
						? { replacesBuiltinTools: contribution.metadata.replacesBuiltinTools.filter((item): item is string => typeof item === "string") }
						: {}),
				}));
			}
		}
		return {
			agentRuntimes: this.agentRuntimes.getInstanceInfos(),
			nativeTools: [...tools.values()].map((tool) => ({
				name: tool.name,
				description: tool.description,
				yieldable: tool.yieldable !== false,
				hasDefinition: tool.definition !== undefined || tool.createDefinition !== undefined || tool.providerBacked === true,
				portable: toolIsPortable(tool),
				...(tool.replacesBuiltinTools?.length ? { replacesBuiltinTools: [...tool.replacesBuiltinTools] } : {}),
				pluginId: tool.pluginId,
				pluginName: tool.pluginId ? this.pluginNames.get(tool.pluginId) : undefined,
				...(tool.providerTool ? { providerTool: tool.providerTool } : {}),
			})),
			skills: [...this.skills.values()].map((skill) => ({
				name: skill.name,
				path: skill.path,
				kind: skill.kind ?? "plugin",
				pluginId: skill.pluginId,
				pluginName: skill.pluginId ? this.pluginNames.get(skill.pluginId) : undefined,
			})),
			subagents: [...this.subagents.values()].map((subagent) => ({
				name: subagent.name,
				description: subagent.description,
				targetProfile: subagent.targetProfile,
				timeoutMs: subagent.timeoutMs,
				model: subagent.model ? { ...subagent.model } : undefined,
				thinkingLevel: subagent.thinkingLevel,
				...(subagent.runtimeOptions ? { runtimeOptions: structuredClone(subagent.runtimeOptions) } : {}),
				maxDepth: subagent.maxDepth,
			})),
			contextFiles: [...this.contextFiles.entries()].map(([key, contextFile]) => ({
				key,
				label: contextFile.label,
				path: contextFile.path,
				scope: contextFile.scope ?? "global",
				source: contextFile.source ?? "plugin",
				pluginId: contextFile.pluginId,
				pluginName: contextFile.pluginId ? this.pluginNames.get(contextFile.pluginId) : undefined,
				agentProfileName: contextFile.agentProfileName,
			})),
			mcpServers: [],
			loopStopConditions: this.getLoopStopConditionInfos(),
			ralphStopConditions: this.getLoopStopConditionInfos(),
		};
	}

	resolveProfileName(name: string): string {
		const projectedAlias = [...this.profiles.values()].find((profile) => profile.aliases?.includes(name))?.name;
		const resolvedName = this.profileAliases.get(name) ?? projectedAlias ?? name;
		if (!this.profiles.has(resolvedName)) {
			throw new Error(`Unknown profile "${name}". Available profiles: ${this.getProfileNames().join(", ")}`);
		}
		return resolvedName;
	}

	getGatewayAction(name: string): PiboGatewayAction | undefined {
		return this.gatewayActions.get(name);
	}

	getGatewayActionInfos(): PiboGatewayActionInfo[] {
		return [...this.gatewayActions.values()]
			.filter((action) => action.hidden !== true)
			.map((action) => ({
				name: action.name,
				description: action.description,
				slashCommands: [...(action.slashCommands ?? [])],
			}));
	}

	getChannels(): PiboChannel[] {
		return [...this.channels.values()];
	}

	getAuthService(): PiboAuthService | undefined {
		return this.authServices.values().next().value;
	}

	getWebApps(): PiboWebApp[] {
		return [...this.webApps.values()];
	}

	getEventErrors(): string[] {
		return [...this.eventErrors];
	}

	notifyEvent(event: PiboOutputEvent): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (error) {
				this.eventErrors.push(error instanceof Error ? error.message : String(error));
			}
		}
	}

	emitProductEvent(input: PiboProductEventInput): PiboProductEvent {
		const event: PiboProductEvent = {
			...input,
			id: input.id ?? randomUUID(),
			createdAt: input.createdAt ?? new Date().toISOString(),
		};
		for (const listener of this.productEventListeners) {
			try {
				listener(event);
			} catch (error) {
				this.eventErrors.push(error instanceof Error ? error.message : String(error));
			}
		}
		return event;
	}

	private createProfileBuildContext(): PiboProfileBuildContext {
		return {
			getTool: (name) => this.getProfileTool(name),
			getTools: (names) => names.map((name) => this.getProfileTool(name)),
			getSkill: (name) => this.getRequired(this.skills, name, "skill"),
			getContextFile: (key) => this.getRequired(this.contextFiles, key, "context file"),
			getSubagent: (name) => this.getRequired(this.subagents, name, "subagent"),
			getSubagents: (names) => names.map((name) => this.getRequired(this.subagents, name, "subagent")),
		};
	}

	private getProfileTool(name: string): ToolProfile {
		const registered = this.tools.get(name);
		if (registered) return registered;
		for (const installation of this.projection.host.inspect().plugins) {
			const contribution = installation.manifest.contributions.find((candidate) =>
				candidate.scope === "agent"
				&& candidate.kind === "tool"
				&& (candidate.name ?? candidate.id) === name,
			);
			if (!contribution) continue;
			return normalizeToolProfile({
				name,
				description: contribution.title ?? name,
				pluginId: installation.pluginId,
				providerBacked: true,
			});
		}
		throw new Error(`Unknown tool "${name}"`);
	}

	private getRequired<T>(map: ReadonlyMap<string, T>, key: string, label: string): T {
		const value = map.get(key);
		if (!value) {
			throw new Error(`Unknown ${label} "${key}"`);
		}
		return value;
	}

	private registerProfileAliases(profile: PiboProfileDefinition): void {
		for (const alias of profile.aliases ?? []) {
			const existingAliasProfile = this.profileAliases.get(alias);
			if (this.profiles.has(alias) || (existingAliasProfile && existingAliasProfile !== profile.name)) {
				throw new Error(`Profile alias "${alias}" is already registered`);
			}
			this.profileAliases.set(alias, profile.name);
		}
	}

	private addUnique<T>(map: Map<string, T>, key: string, value: T, label: string): void {
		if (map.has(key)) {
			throw new Error(`Duplicate ${label} "${key}"`);
		}
		map.set(key, value);
	}

	private validateWebAppRoutes(app: PiboWebApp): void {
		const routes = getWebAppRoutes(app);
		for (const route of routes) {
			validateWebRoute(app.name, route.label, route.prefix);
		}
		for (const existing of this.webApps.values()) {
			for (const route of routes) {
				for (const existingRoute of getWebAppRoutes(existing)) {
					if (webRoutesOverlap(route.prefix, existingRoute.prefix)) {
						throw new Error(
							`Web app route "${route.prefix}" for "${app.name}" overlaps ${existingRoute.label} "${existingRoute.prefix}" from web app "${existing.name}"`,
						);
					}
				}
			}
		}
	}

	private getGatewaySlashCommandsToRegister(action: PiboGatewayAction): string[] {
		if (action.hidden === true) return [];
		const slashCommands: string[] = [];
		for (const slashCommand of action.slashCommands ?? []) {
			if (!slashCommand || slashCommand.startsWith("/") || /\s/.test(slashCommand)) {
				throw new Error(`Invalid slash command "${slashCommand}" for gateway action "${action.name}"`);
			}
			const existingAction = this.gatewaySlashCommands.get(slashCommand);
			if (existingAction) {
				throw new Error(
					`Duplicate slash command "${slashCommand}" for gateway actions "${existingAction}" and "${action.name}"`,
				);
			}
			if (slashCommands.includes(slashCommand)) {
				throw new Error(`Duplicate slash command "${slashCommand}" for gateway action "${action.name}"`);
			}
			slashCommands.push(slashCommand);
		}
		return slashCommands;
	}
}

function contextFileKey(contextFile: ContextFileProfile): string {
	return contextFile.key ?? contextFile.label ?? contextFile.path;
}

