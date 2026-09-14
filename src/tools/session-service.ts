import { randomUUID } from "node:crypto";
import type { RuntimePluginHook, PluginHookEvidence } from "../agent-runtime/plugin-hooks.js";
import type { InitialSessionContext } from "../core/profiles.js";
import type { PiboRunToolController } from "../runs/tools.js";
import type { PiboAgentsController, PiboSubagentRunner } from "../subagents/tool.js";
import type { CodexBrowserToolController } from "./codex-browser.js";
import type { PiboToolDefinition, PiboToolDefinitionContext } from "./contract.js";
import type { PluginSessionAvailableTool, PluginSessionToolProviderBinding, PluginSessionToolSet } from "../plugins/runtime.js";
import {
	PiboToolMcpBridge,
	type PiboToolMcpBridgeAddress,
	type PiboToolPayloadWriter,
} from "./mcp-bridge.js";
import type { PiboRuntimeToolController } from "./runtime/tool.js";
import { createPiboSessionToolDefinitions, type SessionToolDefinitionRegistration } from "./session-tool-set.js";

export type PiboPortableToolSessionControllers = {
	agentsController?: PiboAgentsController;
	/** @deprecated Use agentsController. Retained so integrations receive an explicit migration error. */
	subagentRunner?: PiboSubagentRunner;
	runToolController?: PiboRunToolController;
	runtimeToolController?: PiboRuntimeToolController;
	codexBrowserController?: CodexBrowserToolController;
};

export type CreatePiboPortableToolSessionInput = PiboPortableToolSessionControllers & {
	piboSessionId: string;
	piboRoomId?: string;
	runtimeInstanceId: string;
	adapterId: string;
	/** Shared live runtime generation used by tool credentials and resource isolation. */
	sessionGeneration?: string;
	profile: InitialSessionContext;
	goalStorePath?: string;
	pluginHooks?: readonly RuntimePluginHook[];
	recordPluginHook?: (evidence: PluginHookEvidence) => void;
	cwd: string;
	getActiveMessage?: PiboToolDefinitionContext["getActiveMessage"];
	getConversationEntries?: PiboToolDefinitionContext["getConversationEntries"];
	/** Selected providers pinned by the effective plugin generation. */
	sessionToolProviders?: readonly PluginSessionToolProviderBinding[];
	/** Session-owned services exposed by stable public IDs. */
	sessionServices?: Readonly<Record<string, unknown>>;
};

export type PiboPortableToolDefinitionOptions = {
	/** Adapter-private tools may participate in direct run-control only. They are never exposed by the MCP bridge. */
	nativeYieldableTools?: readonly PiboToolDefinition[];
};

export type PiboToolMcpAccess = {
	url: string;
	/** Sensitive bearer credential. Keep it in adapter-owned process state and never log or persist it raw. */
	token: string;
	credentialId: string;
	expiresAt: string;
	allowedToolNames: readonly string[];
};

export interface PiboPortableToolSession {
	readonly piboSessionId: string;
	readonly runtimeInstanceId: string;
	readonly adapterId: string;
	readonly sessionGeneration: string;
	/** Selected augment providers request adapter-native yieldable definitions without naming them. */
	readonly includeNativeTools: boolean;
	createDefinitions(options?: PiboPortableToolDefinitionOptions): PiboToolDefinition[];
	/** Already materialized inventory only; never executes a factory. */
	getDefinitions(): readonly PiboToolDefinition[];
	configureControllers(controllers: Partial<PiboPortableToolSessionControllers>): void;
	setConversationEntriesProvider(provider: PiboToolDefinitionContext["getConversationEntries"] | undefined): void;
	issueMcpAccess(options?: { allowedToolNames?: readonly string[]; ttlMs?: number }): Promise<PiboToolMcpAccess>;
	renewMcpAccess(token: string, ttlMs?: number): PiboToolMcpAccess;
	revokeMcpAccess(token: string): boolean;
	/** Revokes access immediately, then awaits provider cleanup and surfaces cleanup failures. */
	dispose(): Promise<void>;
}

export type PiboPortableToolServiceOptions = {
	bridge?: PiboToolMcpBridge;
	payloadWriter?: PiboToolPayloadWriter;
};

type SessionRecord = {
	key: string;
	active: boolean;
	definitions?: PiboToolDefinition[];
	nativeYieldableTools?: readonly PiboToolDefinition[];
	nativeToolNames?: ReadonlySet<string>;
	providerToolSets?: PluginSessionToolSet[];
	baseProviderTools?: SessionToolDefinitionRegistration[];
	augmentProviderTools?: SessionToolDefinitionRegistration[];
	providerCleanupPromises?: Promise<void>[];
	providerCleanupErrors?: unknown[];
	disposePromise?: Promise<void>;
	input: CreatePiboPortableToolSessionInput;
	controllers: PiboPortableToolSessionControllers;
	getConversationEntries?: PiboToolDefinitionContext["getConversationEntries"];
	sessionGeneration: string;
};

function sessionKey(piboSessionId: string, sessionGeneration: string): string {
	return `${piboSessionId}\u0000${sessionGeneration}`;
}

function assertIdentifier(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

export class PiboPortableToolService {
	readonly bridge: PiboToolMcpBridge;
	private readonly sessions = new Map<string, SessionRecord>();

	constructor(options: PiboPortableToolServiceOptions = {}) {
		this.bridge = options.bridge ?? new PiboToolMcpBridge({
			payloadWriter: options.payloadWriter,
			resolveTools: (scope) => this.resolveTools(scope.piboSessionId, scope.sessionGeneration),
			isSessionGenerationActive: (scope) => this.sessions.get(sessionKey(scope.piboSessionId, scope.sessionGeneration))?.active === true,
			resolveExecutionContext: (scope) => {
				const record = this.sessions.get(sessionKey(scope.piboSessionId, scope.sessionGeneration));
				return record
					? {
						piboSessionId: record.input.piboSessionId,
						piboRoomId: record.input.piboRoomId,
						profileName: record.input.profile.profileName,
						cwd: record.input.cwd,
						getActiveMessage: record.input.getActiveMessage,
						getConversationEntries: record.getConversationEntries,
					}
					: {};
			},
		});
	}

	createSession(input: CreatePiboPortableToolSessionInput): PiboPortableToolSession {
		const piboSessionId = assertIdentifier(input.piboSessionId, "piboSessionId");
		const runtimeInstanceId = assertIdentifier(input.runtimeInstanceId, "runtimeInstanceId");
		const adapterId = assertIdentifier(input.adapterId, "adapterId");
		const cwd = assertIdentifier(input.cwd, "cwd");
		const sessionGeneration = input.sessionGeneration
			? assertIdentifier(input.sessionGeneration, "sessionGeneration")
			: randomUUID();
		const key = sessionKey(piboSessionId, sessionGeneration);
		const record: SessionRecord = {
			key,
			active: true,
			input: {
				...input,
				piboSessionId,
				runtimeInstanceId,
				adapterId,
				cwd,
			},
			controllers: {
				agentsController: input.agentsController,
				subagentRunner: input.subagentRunner,
				runToolController: input.runToolController,
				runtimeToolController: input.runtimeToolController,
				codexBrowserController: input.codexBrowserController,
			},
			getConversationEntries: input.getConversationEntries,
			sessionGeneration,
		};
		this.sessions.set(key, record);
		return this.createSessionHandle(record);
	}

	async dispose(): Promise<void> {
		const records = [...this.sessions.values()];
		const results = await Promise.allSettled(records.map((record) => this.disposeSessionRecord(record)));
		await this.bridge.stop();
		const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
		if (errors.length > 0) throw new AggregateError(errors, "Portable tool service cleanup failed");
	}

	private createDefinitions(record: SessionRecord, options: PiboPortableToolDefinitionOptions = {}): PiboToolDefinition[] {
		if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
		if (record.definitions) {
			if (options.nativeYieldableTools !== undefined && record.nativeYieldableTools !== options.nativeYieldableTools) throw new Error("Adapter-native tool inventory changed after session tool materialization");
			return record.definitions;
		}
		record.nativeYieldableTools = options.nativeYieldableTools;
		record.nativeToolNames = new Set(options.nativeYieldableTools?.map((tool) => tool.name) ?? []);
		const baseProviderTools = this.createProviderTools(record, "base", []);
		const baseContributionByName = new Map(baseProviderTools.map((tool) => [tool.definition.name, tool.contributionId] as const));
		const definitions = createPiboSessionToolDefinitions({
			profile: record.input.profile,
			pluginHooks: record.input.pluginHooks,
			pluginHookScope: record.input.recordPluginHook ? { piboSessionId: record.input.piboSessionId, generation: record.sessionGeneration, record: record.input.recordPluginHook } : undefined,
			toolContext: {
				piboSessionId: record.input.piboSessionId,
				piboRoomId: record.input.piboRoomId,
				profileName: record.input.profile.profileName,
				cwd: record.input.cwd,
				getActiveMessage: record.input.getActiveMessage,
				getConversationEntries: record.getConversationEntries,
			},
			nativeYieldableTools: options.nativeYieldableTools,
			sessionToolDefinitions: baseProviderTools,
			createAugmentedSessionToolDefinitions: (availableTools) => this.createProviderTools(record, "augment", availableTools.map((definition) => {
				const contributionId = baseContributionByName.get(definition.name);
				return contributionId ? { contributionId, definition } : { definition };
			})),
		});
		const duplicates = definitions.map((tool) => tool.name).filter((name, index, names) => names.indexOf(name) !== index);
		if (duplicates.length > 0) throw new Error(`Session tool name conflict: ${[...new Set(duplicates)].sort().join(", ")}`);
		record.definitions = definitions;
		return definitions;
	}

	private createProviderTools(record: SessionRecord, phase: "base" | "augment", availableTools: readonly PluginSessionAvailableTool[]): SessionToolDefinitionRegistration[] {
		const cached = phase === "base" ? record.baseProviderTools : record.augmentProviderTools;
		if (cached) return cached;
		const sets: PluginSessionToolSet[] = [];
		const tools: SessionToolDefinitionRegistration[] = [];
		try {
			for (const binding of record.input.sessionToolProviders ?? []) {
				if ((binding.provider.phase ?? "base") !== phase) continue;
				const providerPlugin = Object.freeze({
					id: binding.pluginId,
					contributionId: binding.providerContributionId,
					revision: binding.pluginRevision,
					configuration: Object.freeze(structuredClone(binding.configuration)),
					contributionConfiguration: Object.freeze(structuredClone(binding.contributionConfiguration)),
				});
				const selectedTools = binding.selectedTools.map((selected) => Object.freeze({
					contributionId: selected.contributionId,
					name: selected.name,
					direct: selected.direct,
					yieldable: selected.yieldable,
					selectionReason: selected.selectionReason ?? "explicit",
					dependencyPath: Object.freeze([...(selected.dependencyPath ?? [selected.contributionId])]),
					configuration: Object.freeze(structuredClone(selected.configuration)),
					contributionConfiguration: Object.freeze(structuredClone(selected.contributionConfiguration)),
				}));
				const selectedById = new Map(selectedTools.map((selected) => [selected.contributionId, selected]));
				const sessionServices = record.input.sessionServices ?? {};
				const dependencyOnly = phase === "augment" && selectedTools.every((selected) => selected.selectionReason === "dependency");
				const dependencySources = dependencyOnly ? new Set(selectedTools.flatMap((selected) => selected.dependencyPath)) : undefined;
				const providerAvailableTools = dependencySources
					? availableTools.filter((tool) => tool.contributionId !== undefined && dependencySources.has(tool.contributionId))
					: availableTools;
				const toolSet = binding.provider.createSession(Object.freeze({
					piboSessionId: record.input.piboSessionId,
					piboRoomId: record.input.piboRoomId,
					profileName: record.input.profile.profileName,
					cwd: record.input.cwd,
					getActiveMessage: record.input.getActiveMessage,
					getConversationEntries: () => record.getConversationEntries?.() ?? [],
					runtimeInstanceId: record.input.runtimeInstanceId,
					adapterId: record.input.adapterId,
					sessionGeneration: record.sessionGeneration,
					plugin: providerPlugin,
					selectedTools,
					availableTools: Object.freeze(providerAvailableTools.map((tool) => Object.freeze({ ...tool }))),
					services: Object.freeze({
						get: <T>(id: string) => sessionServices[id] as T | undefined,
						require: <T>(id: string) => {
							const value = sessionServices[id] as T | undefined;
							if (value === undefined) throw new Error(`Session service ${id} is unavailable for ${binding.providerContributionId}`);
							return value;
						},
					}),
				}));
				if (!toolSet || !Array.isArray(toolSet.tools)) throw new Error(`Session tool provider ${binding.providerContributionId} returned an invalid tool set`);
				sets.push(toolSet);
				const returned = new Set<string>();
				for (const registration of toolSet.tools) {
					const selected = registration && selectedById.get(registration.contributionId);
					const definition = registration?.definition;
					if (!selected) throw new Error(`Session tool provider ${binding.providerContributionId} returned undeclared or unselected tool ${registration?.contributionId ?? "<missing>"}`);
					if (returned.has(selected.contributionId)) throw new Error(`Session tool provider ${binding.providerContributionId} returned duplicate tool ${selected.contributionId}`);
					if (!definition || definition.name !== selected.name || !definition.inputSchema || typeof definition.inputSchema !== "object" || typeof definition.execute !== "function") throw new Error(`Session tool ${selected.contributionId} does not match its declared name/schema contract`);
					returned.add(selected.contributionId);
					const plugin = Object.freeze({ id: binding.pluginId, contributionId: selected.contributionId, revision: binding.pluginRevision, configuration: selected.configuration, contributionConfiguration: selected.contributionConfiguration });
					tools.push({ contributionId: selected.contributionId, direct: selected.direct, yieldable: selected.yieldable, definition: { ...definition, inputSchema: structuredClone(definition.inputSchema), execute: (callId, input, signal, onUpdate, context) => {
						if (!record.active || this.sessions.get(record.key) !== record) throw new Error(`Session tool provider generation ${record.sessionGeneration} is no longer active`);
						if (context.sessionGeneration && context.sessionGeneration !== record.sessionGeneration) throw new Error("Session tool execution generation does not match its provider binding");
						return definition.execute(callId, input, signal, onUpdate, { ...context, plugin });
					} } });
				}
				const missing = selectedTools.filter((selected) => !returned.has(selected.contributionId));
				if (missing.length > 0) throw new Error(`Session tool provider ${binding.providerContributionId} omitted selected tools: ${missing.map((entry) => entry.contributionId).join(", ")}`);
			}
		} catch (error) {
			this.queueProviderCleanup(record, sets);
			throw error;
		}
		record.providerToolSets = [...(record.providerToolSets ?? []), ...sets];
		if (phase === "base") record.baseProviderTools = tools;
		else record.augmentProviderTools = tools;
		return tools;
	}

	private queueProviderCleanup(record: SessionRecord, sets = record.providerToolSets ?? []): void {
		record.providerToolSets = undefined;
		record.baseProviderTools = undefined;
		record.augmentProviderTools = undefined;
		record.providerCleanupPromises ??= [];
		record.providerCleanupErrors ??= [];
		for (const set of [...sets].reverse()) {
			const cleanup = Promise.resolve().then(() => set.dispose?.()).catch((error) => { record.providerCleanupErrors!.push(error); });
			record.providerCleanupPromises.push(cleanup);
		}
	}

	private async finishProviderCleanup(record: SessionRecord): Promise<void> {
		this.queueProviderCleanup(record);
		await Promise.all(record.providerCleanupPromises ?? []);
		const errors = record.providerCleanupErrors ?? [];
		record.providerCleanupPromises = [];
		record.providerCleanupErrors = [];
		if (errors.length > 0) throw new AggregateError(errors, `Session tool provider cleanup failed for generation ${record.sessionGeneration}`);
	}

	private disposeSessionRecord(record: SessionRecord): Promise<void> {
		if (record.disposePromise) return record.disposePromise;
		record.active = false;
		this.sessions.delete(record.key);
		this.bridge.credentials.revokeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
		this.bridge.closeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
		record.disposePromise = this.finishProviderCleanup(record);
		return record.disposePromise;
	}

	private resolveTools(piboSessionId: string, generation: string): PiboToolDefinition[] {
		const record = this.sessions.get(sessionKey(piboSessionId, generation));
		if (!record?.active) return [];
		return this.createDefinitions(record).filter((tool) => tool.portable !== false && !record.nativeToolNames?.has(tool.name));
	}

	private createSessionHandle(record: SessionRecord): PiboPortableToolSession {
		return {
			piboSessionId: record.input.piboSessionId,
			runtimeInstanceId: record.input.runtimeInstanceId,
			adapterId: record.input.adapterId,
			sessionGeneration: record.sessionGeneration,
			includeNativeTools: record.input.sessionToolProviders?.some((binding) => binding.provider.includeNativeTools === true) ?? false,
			createDefinitions: (options) => this.createDefinitions(record, options),
			getDefinitions: () => [...(record.definitions ?? [])],
			configureControllers: (controllers) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				record.controllers = { ...record.controllers, ...controllers };
				record.definitions = undefined;
			},
			setConversationEntriesProvider: (provider) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				record.getConversationEntries = provider;
			},
			issueMcpAccess: async (options = {}) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				const availableToolNames = this.createDefinitions(record)
					.filter((tool) => tool.portable !== false && !record.nativeToolNames?.has(tool.name))
					.map((tool) => tool.name);
				const requested = options.allowedToolNames
					? [...new Set(options.allowedToolNames)]
					: availableToolNames;
				const available = new Set(availableToolNames);
				const unavailable = requested.filter((name) => !available.has(name));
				if (unavailable.length > 0) {
					throw new Error(`Portable MCP tools are unavailable for this session: ${unavailable.join(", ")}`);
				}
				const address: PiboToolMcpBridgeAddress = await this.bridge.start();
				const issued = this.bridge.issueCredential({
					piboSessionId: record.input.piboSessionId,
					piboRoomId: record.input.piboRoomId,
					profileName: record.input.profile.profileName,
					runtimeInstanceId: record.input.runtimeInstanceId,
					adapterId: record.input.adapterId,
					sessionGeneration: record.sessionGeneration,
					cwd: record.input.cwd,
					allowedToolNames: requested,
				}, options.ttlMs);
				return {
					url: address.url,
					token: issued.token,
					credentialId: issued.info.credentialId,
					expiresAt: issued.info.expiresAt,
					allowedToolNames: [...issued.info.allowedToolNames],
				};
			},
			renewMcpAccess: (token, ttlMs) => {
				const current = this.bridge.credentials.authenticate(token, { touch: false });
				if (
					current.piboSessionId !== record.input.piboSessionId
					|| current.sessionGeneration !== record.sessionGeneration
				) {
					throw new Error("Tool credential belongs to a different Pibo runtime session generation.");
				}
				const renewed = this.bridge.credentials.renew(token, ttlMs);
				const address = this.bridge.getAddress();
				if (!address) throw new Error("Pibo tool MCP bridge is not running.");
				return {
					url: address.url,
					token,
					credentialId: renewed.credentialId,
					expiresAt: renewed.expiresAt,
					allowedToolNames: [...renewed.allowedToolNames],
				};
			},
			revokeMcpAccess: (token) => {
				let current;
				try {
					current = this.bridge.credentials.authenticate(token, { touch: false });
				} catch {
					return false;
				}
				if (
					current.piboSessionId !== record.input.piboSessionId
					|| current.sessionGeneration !== record.sessionGeneration
				) return false;
				const revoked = this.bridge.credentials.revoke(token);
				if (revoked) this.bridge.closeCredentialSessions(current.credentialId);
				return revoked;
			},
			dispose: () => this.disposeSessionRecord(record),
		};
	}
}
