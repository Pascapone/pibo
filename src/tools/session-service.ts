import { randomUUID } from "node:crypto";
import type { InitialSessionContext } from "../core/profiles.js";
import type { PiboRunToolController } from "../runs/tools.js";
import type { PiboSubagentRunner } from "../subagents/tool.js";
import type { CodexBrowserToolController } from "./codex-browser.js";
import type { PiboToolDefinition, PiboToolDefinitionContext } from "./contract.js";
import {
	PiboToolMcpBridge,
	type PiboToolMcpBridgeAddress,
	type PiboToolPayloadWriter,
} from "./mcp-bridge.js";
import type { PiboRuntimeToolController } from "./runtime/tool.js";
import { createPiboSessionToolDefinitions } from "./session-tool-set.js";

export type PiboPortableToolSessionControllers = {
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
	cwd: string;
	getActiveMessage?: PiboToolDefinitionContext["getActiveMessage"];
	getConversationEntries?: PiboToolDefinitionContext["getConversationEntries"];
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
	createDefinitions(options?: PiboPortableToolDefinitionOptions): PiboToolDefinition[];
	configureControllers(controllers: Partial<PiboPortableToolSessionControllers>): void;
	setConversationEntriesProvider(provider: PiboToolDefinitionContext["getConversationEntries"] | undefined): void;
	issueMcpAccess(options?: { allowedToolNames?: readonly string[]; ttlMs?: number }): Promise<PiboToolMcpAccess>;
	renewMcpAccess(token: string, ttlMs?: number): PiboToolMcpAccess;
	revokeMcpAccess(token: string): boolean;
	dispose(): void;
}

export type PiboPortableToolServiceOptions = {
	bridge?: PiboToolMcpBridge;
	payloadWriter?: PiboToolPayloadWriter;
};

type SessionRecord = {
	key: string;
	active: boolean;
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
		for (const record of this.sessions.values()) {
			record.active = false;
			this.bridge.credentials.revokeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
			this.bridge.closeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
		}
		this.sessions.clear();
		await this.bridge.stop();
	}

	private createDefinitions(record: SessionRecord, options: PiboPortableToolDefinitionOptions = {}): PiboToolDefinition[] {
		if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
		return createPiboSessionToolDefinitions({
			profile: record.input.profile,
			toolContext: {
				piboSessionId: record.input.piboSessionId,
				piboRoomId: record.input.piboRoomId,
				profileName: record.input.profile.profileName,
				cwd: record.input.cwd,
				getActiveMessage: record.input.getActiveMessage,
				getConversationEntries: record.getConversationEntries,
			},
			...record.controllers,
			nativeYieldableTools: options.nativeYieldableTools,
		});
	}

	private resolveTools(piboSessionId: string, generation: string): PiboToolDefinition[] {
		const record = this.sessions.get(sessionKey(piboSessionId, generation));
		if (!record?.active) return [];
		return this.createDefinitions(record).filter((tool) => tool.portable !== false);
	}

	private createSessionHandle(record: SessionRecord): PiboPortableToolSession {
		return {
			piboSessionId: record.input.piboSessionId,
			runtimeInstanceId: record.input.runtimeInstanceId,
			adapterId: record.input.adapterId,
			sessionGeneration: record.sessionGeneration,
			createDefinitions: (options) => this.createDefinitions(record, options),
			configureControllers: (controllers) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				record.controllers = { ...record.controllers, ...controllers };
			},
			setConversationEntriesProvider: (provider) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				record.getConversationEntries = provider;
			},
			issueMcpAccess: async (options = {}) => {
				if (!record.active) throw new Error(`Portable tool session for "${record.input.piboSessionId}" is disposed.`);
				const availableToolNames = this.createDefinitions(record)
					.filter((tool) => tool.portable !== false)
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
			dispose: () => {
				if (!record.active) return;
				record.active = false;
				this.sessions.delete(record.key);
				this.bridge.credentials.revokeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
				this.bridge.closeSessionGeneration(record.input.piboSessionId, record.sessionGeneration);
			},
		};
	}
}
