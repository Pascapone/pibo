import type { PiboJsonObject } from "../core/events.js";
import { validateAgentRuntimeCapabilities } from "./capabilities.js";
import { assertAgentRuntimeSessionContract } from "./contract.js";
import { AgentRuntimeRegistrationError, AgentRuntimeUnavailableError } from "./errors.js";
import type {
	AgentRuntimeAdapter,
	AgentRuntimeAdapterDescriptor,
	AgentRuntimeDriver,
	AgentRuntimeInstanceDefinition,
	AgentRuntimeInstanceInfo,
	AgentRuntimeSession,
	OpenAgentRuntimeSessionInput,
} from "./types.js";

const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

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

	async openSession(instanceId: string, input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession> {
		const adapter = this.requireInstance(instanceId);
		const session = await adapter.openSession(input);
		try {
			assertAgentRuntimeSessionContract(session);
		} catch (error) {
			await session.dispose().catch(() => {});
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
		return [...this.instances.values()].map((adapter) => ({
			id: adapter.instanceId,
			adapterId: adapter.descriptor.id,
			displayName: adapter.displayName,
			enabled: adapter.enabled,
			transport: adapter.descriptor.transport,
			capabilities: structuredClone(adapter.descriptor.capabilities),
			configSchema: cloneConfig(adapter.descriptor.configSchema),
			...(adapter.descriptor.protocol ? { protocol: { ...adapter.descriptor.protocol } } : {}),
		}));
	}

	getInstanceDefinition(instanceId: string): AgentRuntimeInstanceDefinition | undefined {
		const definition = this.definitions.get(instanceId);
		return definition
			? { ...definition, ...(definition.config ? { config: cloneConfig(definition.config) } : {}) }
			: undefined;
	}
}
