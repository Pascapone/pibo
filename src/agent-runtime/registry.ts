import type { PiboJsonObject } from "../core/events.js";
import { validateAgentRuntimeCapabilities } from "./capabilities.js";
import { assertAgentRuntimeSessionContract } from "./contract.js";
import { validateAgentRuntimeProfileCapabilities } from "./profile-validation.js";
import {
	AgentRuntimeAuthError,
	AgentRuntimeCapabilityUnavailableError,
	AgentRuntimeContractError,
	AgentRuntimeRegistrationError,
	AgentRuntimeUnavailableError,
} from "./errors.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	AgentRuntimeAuthTargetOperationResult,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "./auth.js";
import {
	assertAdapterAuthContract,
	assertAuthId,
	cloneAuthOperationResult,
	cloneAuthStatus,
	safeAdapterAuthError,
	scopedAuthContractError,
} from "./auth-contract.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeAdapterDescriptor,
	AgentRuntimeDiagnostic,
	AgentRuntimeDriver,
	AgentRuntimeInstanceDefinition,
	AgentRuntimeInstanceInfo,
	AgentRuntimeInstanceInspection,
	AgentRuntimeSession,
	OpenAgentRuntimeSessionInput,
	ValidateAgentRuntimeProfileInput,
} from "./types.js";

const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_AUTH_API_KEY_LENGTH = 64 * 1_024;
const MAX_AUTH_COMPLETION_CODE_LENGTH = 16 * 1_024;
const MAX_AUTH_PROVIDERS = 256;

function assertRuntimeId(value: string, label: string): void {
	if (!RUNTIME_ID_PATTERN.test(value)) {
		throw new AgentRuntimeRegistrationError(`${label} "${value}" must match ${RUNTIME_ID_PATTERN}.`);
	}
}

function cloneConfig(config: PiboJsonObject): PiboJsonObject {
	return structuredClone(config);
}

export class AgentRuntimeAdapterRegistry {
	private readonly drivers = new Map<string, AgentRuntimeDriver<unknown>>();
	private readonly instances = new Map<string, AgentRuntimeAdapter>();
	private readonly definitions = new Map<string, AgentRuntimeInstanceDefinition>();

	registerDriver<TConfig>(driver: AgentRuntimeDriver<TConfig>): void {
		const descriptor = driver.descriptor;
		assertRuntimeId(descriptor.id, "Agent runtime adapter id");
		if (!descriptor.displayName.trim()) {
			throw new AgentRuntimeRegistrationError(`Agent runtime adapter "${descriptor.id}" requires a display name.`);
		}
		if (this.drivers.has(descriptor.id)) {
			throw new AgentRuntimeRegistrationError(`Agent runtime adapter "${descriptor.id}" is already registered.`);
		}
		if (!descriptor.configSchema || typeof descriptor.configSchema !== "object" || Array.isArray(descriptor.configSchema)) {
			throw new AgentRuntimeRegistrationError(`Agent runtime adapter "${descriptor.id}" requires an object config schema.`);
		}
		const capabilityErrors = validateAgentRuntimeCapabilities(descriptor.capabilities);
		if (capabilityErrors.length > 0) {
			throw new AgentRuntimeRegistrationError(
				`Agent runtime adapter "${descriptor.id}" declares invalid capabilities: ${capabilityErrors.join("; ")}`,
			);
		}
		this.drivers.set(descriptor.id, driver as AgentRuntimeDriver<unknown>);
	}

	registerInstance(definition: AgentRuntimeInstanceDefinition): AgentRuntimeAdapter {
		assertRuntimeId(definition.id, "Agent runtime instance id");
		assertRuntimeId(definition.adapterId, "Agent runtime adapter id");
		if (this.instances.has(definition.id)) {
			throw new AgentRuntimeRegistrationError(`Agent runtime instance "${definition.id}" is already registered.`);
		}
		const driver = this.drivers.get(definition.adapterId);
		if (!driver) {
			throw new AgentRuntimeRegistrationError(
				`Agent runtime instance "${definition.id}" references unknown adapter "${definition.adapterId}".`,
			);
		}
		if (driver.descriptor.supportsMultipleInstances === false) {
			const existing = [...this.definitions.values()].find((candidate) => candidate.adapterId === definition.adapterId);
			if (existing) {
				throw new AgentRuntimeRegistrationError(
					`Agent runtime adapter "${definition.adapterId}" does not support multiple instances (already configured as "${existing.id}").`,
				);
			}
		}

		const rawConfig = cloneConfig(definition.config ?? (driver.defaultConfig() as PiboJsonObject));
		let config: unknown;
		try {
			config = driver.parseConfig(rawConfig);
		} catch (error) {
			throw new AgentRuntimeRegistrationError(
				`Invalid config for agent runtime instance "${definition.id}": ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
		const adapter = driver.create({
			instanceId: definition.id,
			displayName: definition.displayName,
			enabled: definition.enabled !== false,
			config,
		});
		if (adapter.instanceId !== definition.id) {
			throw new AgentRuntimeRegistrationError(
				`Agent runtime driver "${definition.adapterId}" created instance "${adapter.instanceId}" instead of "${definition.id}".`,
			);
		}
		if (adapter.descriptor.id !== definition.adapterId) {
			throw new AgentRuntimeRegistrationError(
				`Agent runtime instance "${definition.id}" was created by adapter "${adapter.descriptor.id}" instead of "${definition.adapterId}".`,
			);
		}
		const historyDeclared = adapter.descriptor.capabilities.maintenance.history;
		if (historyDeclared && (!adapter.inspectHistory || !adapter.readHistory)) {
			throw new AgentRuntimeRegistrationError(
				`Agent runtime instance "${definition.id}" declares maintenance.history but must implement inspectHistory() and readHistory().`,
			);
		}
		assertAdapterAuthContract(adapter);
		this.instances.set(definition.id, adapter);
		this.definitions.set(definition.id, {
			...definition,
			config: cloneConfig(rawConfig),
		});
		return adapter;
	}

	getDriver(adapterId: string): AgentRuntimeDriver<unknown> | undefined {
		return this.drivers.get(adapterId);
	}

	getDescriptor(adapterId: string): AgentRuntimeAdapterDescriptor | undefined {
		return this.drivers.get(adapterId)?.descriptor;
	}

	getInstance(instanceId: string): AgentRuntimeAdapter | undefined {
		return this.instances.get(instanceId);
	}

	async getAuthStatus(instanceId: string): Promise<readonly AgentRuntimeAuthStatus[]> {
		const adapter = this.requireInstance(instanceId);
		if (!adapter.descriptor.capabilities.auth.status || !adapter.getAuthStatus) {
			throw new AgentRuntimeCapabilityUnavailableError("provider authentication status", instanceId);
		}
		let statuses: readonly AgentRuntimeAuthStatus[];
		try {
			statuses = await adapter.getAuthStatus();
		} catch (error) {
			throw safeAdapterAuthError(error, "status read");
		}
		if (!Array.isArray(statuses) || statuses.length > MAX_AUTH_PROVIDERS) {
			throw new AgentRuntimeContractError(
				instanceId,
				`Runtime auth status must contain at most ${MAX_AUTH_PROVIDERS} providers.`,
			);
		}
		const seen = new Set<string>();
		try {
			return statuses.map((status) => {
				const cloned = cloneAuthStatus(status, adapter.descriptor.capabilities.auth.methods);
				if (seen.has(cloned.id)) {
					throw new AgentRuntimeContractError(instanceId, `Runtime auth status repeats provider "${cloned.id}".`);
				}
				seen.add(cloned.id);
				return cloned;
			});
		} catch (error) {
			if (error instanceof AgentRuntimeContractError) throw scopedAuthContractError(error, instanceId);
			throw error;
		}
	}

	async startAuth(instanceId: string, input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthTargetOperationResult> {
		const adapter = this.requireInstance(instanceId);
		assertAuthId(input.providerId, "Auth provider id", instanceId);
		if (adapter.descriptor.capabilities.auth.credentialScope === "adapter-shared") {
			for (const candidate of this.authScopeAdapters(adapter)) {
				if (candidate === adapter || !candidate.descriptor.capabilities.auth.status) continue;
				const pending = (await this.getAuthStatus(candidate.instanceId))
					.some((status) => status.id === input.providerId && status.state === "pending");
				if (pending) {
					throw new AgentRuntimeAuthError(
						"runtime_auth_pending",
						"A login flow is already pending for this adapter-shared provider credential.",
						true,
					);
				}
			}
		}
		const method = adapter.descriptor.capabilities.auth.methods.find((candidate) => candidate.id === input.method);
		if (!method || !adapter.startAuth) {
			throw new AgentRuntimeCapabilityUnavailableError(`provider authentication method "${input.method}"`, instanceId);
		}
		if (
			input.method === "api_key"
			&& (input.apiKey.trim().length === 0 || input.apiKey.length > MAX_AUTH_API_KEY_LENGTH)
		) {
			throw new AgentRuntimeContractError(
				instanceId,
				`API-key authentication requires a non-empty key no longer than ${MAX_AUTH_API_KEY_LENGTH} characters.`,
			);
		}
		try {
			return {
				runtimeInstanceId: instanceId,
				...cloneAuthOperationResult(await adapter.startAuth(input), input.providerId, adapter.descriptor.capabilities.auth.methods),
			};
		} catch (error) {
			if (error instanceof AgentRuntimeContractError) throw scopedAuthContractError(error, instanceId);
			throw safeAdapterAuthError(error, "start");
		}
	}

	async completeAuth(instanceId: string, input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthTargetOperationResult> {
		const adapter = this.requireInstance(instanceId);
		assertAuthId(input.providerId, "Auth provider id", instanceId);
		assertAuthId(input.flowId, "Auth flow id", instanceId);
		if (input.code !== undefined && (input.code.length === 0 || input.code.length > MAX_AUTH_COMPLETION_CODE_LENGTH)) {
			throw new AgentRuntimeContractError(
				instanceId,
				`Authentication completion code must be non-empty and no longer than ${MAX_AUTH_COMPLETION_CODE_LENGTH} characters.`,
			);
		}
		if (!adapter.completeAuth) {
			throw new AgentRuntimeCapabilityUnavailableError("provider authentication completion", instanceId);
		}
		try {
			return {
				runtimeInstanceId: instanceId,
				...cloneAuthOperationResult(await adapter.completeAuth(input), input.providerId, adapter.descriptor.capabilities.auth.methods),
			};
		} catch (error) {
			if (error instanceof AgentRuntimeContractError) throw scopedAuthContractError(error, instanceId);
			throw safeAdapterAuthError(error, "completion");
		}
	}

	async cancelAuth(instanceId: string, input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthTargetOperationResult> {
		const adapter = this.requireInstance(instanceId);
		assertAuthId(input.providerId, "Auth provider id", instanceId);
		assertAuthId(input.flowId, "Auth flow id", instanceId);
		if (!adapter.descriptor.capabilities.auth.cancel || !adapter.cancelAuth) {
			throw new AgentRuntimeCapabilityUnavailableError("provider authentication cancellation", instanceId);
		}
		try {
			return {
				runtimeInstanceId: instanceId,
				...cloneAuthOperationResult(await adapter.cancelAuth(input), input.providerId, adapter.descriptor.capabilities.auth.methods),
			};
		} catch (error) {
			if (error instanceof AgentRuntimeContractError) throw scopedAuthContractError(error, instanceId);
			throw safeAdapterAuthError(error, "cancellation");
		}
	}

	async logoutAuth(instanceId: string, input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthTargetOperationResult> {
		const adapter = this.requireInstance(instanceId);
		assertAuthId(input.providerId, "Auth provider id", instanceId);
		if (!adapter.descriptor.capabilities.auth.logout || !adapter.logoutAuth) {
			throw new AgentRuntimeCapabilityUnavailableError("provider authentication logout", instanceId);
		}
		try {
			let selected: AgentRuntimeAuthOperationResult | undefined;
			for (const candidate of this.authScopeAdapters(adapter)) {
				if (!candidate.descriptor.capabilities.auth.logout || !candidate.logoutAuth) {
					throw new AgentRuntimeContractError(candidate.instanceId, "Adapter-shared auth logout is not implemented consistently.");
				}
				const result = cloneAuthOperationResult(
					await candidate.logoutAuth(input),
					input.providerId,
					candidate.descriptor.capabilities.auth.methods,
				);
				if (candidate === adapter) selected = result;
			}
			if (!selected) throw new AgentRuntimeContractError(instanceId, "Selected runtime auth target was not included in its credential scope.");
			return { runtimeInstanceId: instanceId, ...selected };
		} catch (error) {
			if (error instanceof AgentRuntimeContractError) throw scopedAuthContractError(error, instanceId);
			throw safeAdapterAuthError(error, "logout");
		}
	}

	async disposeAuth(): Promise<void> {
		const results = await Promise.allSettled([...this.instances.values()].map(async (adapter) => await adapter.disposeAuth?.()));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to dispose runtime authentication controllers.");
	}

	async openSession(instanceId: string, input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const adapter = this.requireInstance(instanceId);
		const session = await adapter.openSession(input);
		try {
			assertAgentRuntimeSessionContract(session, instanceId);
		} catch (error) {
			try {
				if (typeof session?.dispose === "function") await session.dispose();
			} catch {
				// Preserve the admission error when best-effort cleanup also fails.
			}
			throw error;
		}
		return session;
	}

	requireInstance(instanceId: string): AgentRuntimeAdapter {
		const adapter = this.instances.get(instanceId);
		if (!adapter || !adapter.enabled) {
			throw new AgentRuntimeUnavailableError(
				instanceId,
				adapter
					? `Agent runtime instance "${instanceId}" is disabled.`
					: `Unknown agent runtime instance "${instanceId}". Available instances: ${this.getInstanceIds().join(", ") || "none"}.`,
			);
		}
		return adapter;
	}

	getAdapterIds(): string[] {
		return [...this.drivers.keys()];
	}

	getInstanceIds(): string[] {
		return [...this.instances.keys()];
	}

	getInstanceInfos(): AgentRuntimeInstanceInfo[] {
		return [...this.instances.values()].map((adapter) => this.instanceInfo(adapter));
	}

	async inspectInstances(): Promise<AgentRuntimeInstanceInspection[]> {
		return await Promise.all([...this.instances.values()].map(async (adapter) => {
			const diagnostics = await this.diagnoseAdapter(adapter);
			let models: AgentRuntimeInstanceInspection["models"];
			let auth: AgentRuntimeInstanceInspection["auth"];
			if (!adapter.enabled) {
				diagnostics.unshift({
					severity: "error",
					code: "runtime_instance_disabled",
					message: `Agent runtime instance "${adapter.instanceId}" is disabled.`,
				});
			} else {
				if (adapter.descriptor.capabilities.models.catalog) {
					if (!adapter.listModels) {
						diagnostics.push({
							severity: "error",
							code: "runtime_model_catalog_contract_missing",
							message: `Agent runtime instance "${adapter.instanceId}" declares a model catalog but does not implement listModels().`,
						});
					} else {
						try {
							models = structuredClone(await adapter.listModels());
							if (models.runtimeInstanceId !== adapter.instanceId) {
								diagnostics.push({
									severity: "error",
									code: "runtime_model_catalog_instance_mismatch",
									message: `Runtime model catalog reported instance "${models.runtimeInstanceId}" instead of "${adapter.instanceId}".`,
								});
							}
							diagnostics.push(...(models.diagnostics ?? []));
						} catch (error) {
							diagnostics.push({
								severity: "error",
								code: "runtime_model_catalog_failed",
								message: error instanceof Error ? error.message : String(error),
							});
						}
					}
				}
				if (adapter.descriptor.capabilities.auth.status) {
					try {
						auth = [...(await this.getAuthStatus(adapter.instanceId))];
					} catch {
						diagnostics.push({
							severity: "warning",
							code: "runtime_auth_status_failed",
							message: `Authentication status is unavailable for runtime instance "${adapter.instanceId}".`,
						});
					}
				}
			}
			return {
				...this.instanceInfo(adapter),
				available: adapter.enabled && !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
				diagnostics,
				...(models ? { models } : {}),
				...(auth ? { auth } : {}),
			};
		}));
	}

	async validateProfile(input: ValidateAgentRuntimeProfileInput): Promise<readonly AgentRuntimeDiagnostic[]> {
		const adapter = this.instances.get(input.profile.runtimeInstanceId);
		if (!adapter) {
			return [{
				severity: "error",
				code: "runtime_instance_unknown",
				message: `Profile "${input.profile.profileName}" selects unknown agent runtime instance "${input.profile.runtimeInstanceId}".`,
			}];
		}
		const diagnostics = await this.diagnoseAdapter(adapter);
		if (!adapter.enabled) {
			diagnostics.unshift({
				severity: "error",
				code: "runtime_instance_disabled",
				message: `Profile "${input.profile.profileName}" selects disabled agent runtime instance "${adapter.instanceId}".`,
			});
		}
		diagnostics.push(...validateAgentRuntimeProfileCapabilities(input.profile, adapter.descriptor.capabilities));
		try {
			diagnostics.push(...adapter.validateProfile(input));
		} catch (error) {
			diagnostics.push({
				severity: "error",
				code: "runtime_profile_validation_failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
		return diagnostics;
	}

	getInstanceDefinition(instanceId: string): AgentRuntimeInstanceDefinition | undefined {
		const definition = this.definitions.get(instanceId);
		return definition
			? { ...definition, ...(definition.config ? { config: cloneConfig(definition.config) } : {}) }
			: undefined;
	}

	private authScopeAdapters(adapter: AgentRuntimeAdapter): AgentRuntimeAdapter[] {
		if (adapter.descriptor.capabilities.auth.credentialScope === "runtime-instance") return [adapter];
		return [...this.instances.values()].filter((candidate) => candidate.enabled && candidate.descriptor.id === adapter.descriptor.id);
	}

	private instanceInfo(adapter: AgentRuntimeAdapter): AgentRuntimeInstanceInfo {
		return {
			id: adapter.instanceId,
			adapterId: adapter.descriptor.id,
			displayName: adapter.displayName,
			enabled: adapter.enabled,
			transport: adapter.descriptor.transport,
			capabilities: structuredClone(adapter.descriptor.capabilities),
			configSchema: cloneConfig(adapter.descriptor.configSchema),
			...(adapter.descriptor.protocol ? { protocol: { ...adapter.descriptor.protocol } } : {}),
		};
	}

	private async diagnoseAdapter(adapter: AgentRuntimeAdapter): Promise<AgentRuntimeDiagnostic[]> {
		try {
			return structuredClone([...(await adapter.diagnose())]);
		} catch (error) {
			return [{
				severity: "error",
				code: "runtime_diagnostics_failed",
				message: error instanceof Error ? error.message : String(error),
			}];
		}
	}
}
