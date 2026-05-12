import { hashWorkflowDefinition } from "../definition-hash.js";
import type {
  AdapterHandler,
  AdapterRef,
  AgentProfileDefinition,
  CodeNodeHandler,
  GuardHandler,
  PromptBuilderHandler,
  PromptBuilderRef,
  RegistryRefId,
  WorkflowDefinition,
  WorkflowHumanActionDefinition,
  WorkflowProviders,
  WorkflowPublishedVersionRecord,
  WorkflowRegistry,
  WorkflowRegistryEntry,
  WorkflowRegistration,
  WorkflowRegistrationOptions,
  JsonSchema,
} from "../types/index.js";

export type WorkflowRegistryEntryOptions = WorkflowRegistrationOptions & {
  title?: string;
  description?: string;
  tags?: string[];
  paramsSchema?: JsonSchema;
};

export function createWorkflowRegistry(providers: WorkflowProviders = {}): WorkflowRegistry {
  const registry: WorkflowRegistry = {
    workflows: new Map(),
    profiles: new Map(),
    handlers: new Map(),
    adapters: new Map(),
    guards: new Map(),
    promptBuilders: new Map(),
    humanActions: new Map(),
  };

  registerProviders(registry, providers, { override: true });
  return registry;
}

export function registerProviders(
  registry: WorkflowRegistry,
  providers: WorkflowProviders,
  options: WorkflowRegistrationOptions = {},
): WorkflowRegistry {
  for (const [id, profile] of Object.entries(providers.profiles ?? {})) {
    registerWorkflowAgentProfile(registry, id, profile, options);
  }

  for (const [id, handler] of Object.entries(providers.handlers ?? {})) {
    registerWorkflowHandler(registry, id, handler, options);
  }

  for (const [id, adapter] of Object.entries(providers.adapters ?? {})) {
    registerWorkflowAdapter(registry, id, adapter, options);
  }

  for (const [id, guard] of Object.entries(providers.guards ?? {})) {
    registerWorkflowGuard(registry, id, guard, options);
  }

  for (const [id, promptBuilder] of Object.entries(providers.promptBuilders ?? {})) {
    registerWorkflowPromptBuilder(registry, id, promptBuilder, options);
  }

  for (const [id, humanAction] of Object.entries(providers.humanActions ?? {})) {
    registerWorkflowHumanAction(registry, id, humanAction, options);
  }

  return registry;
}

export function registerWorkflowDefinition(
  registry: WorkflowRegistry,
  definition: WorkflowDefinition,
  options: WorkflowRegistrationOptions = {},
): void {
  const versions = registry.workflows.get(definition.id) ?? [];
  const existingIndex = versions.findIndex((item) => item.version === definition.version);

  if (existingIndex >= 0) {
    if (!options.override) {
      throw new Error(`Workflow '${definition.id}@${definition.version}' is already registered.`);
    }

    versions[existingIndex] = definition;
  } else {
    versions.push(definition);
  }

  registry.workflows.set(definition.id, versions);
}

export function resolveWorkflowDefinition(
  registry: Pick<WorkflowRegistry, "workflows">,
  id: string,
  version?: string,
): WorkflowDefinition | undefined {
  const versions = registry.workflows.get(id);
  if (!versions || versions.length === 0) {
    return undefined;
  }

  if (version !== undefined) {
    return versions.find((definition) => definition.version === version);
  }

  return [...versions].sort((left, right) => right.version.localeCompare(left.version))[0];
}

export function registerWorkflowPublishedVersion(
  registry: WorkflowRegistry,
  record: WorkflowPublishedVersionRecord,
  options: WorkflowRegistrationOptions = {},
): WorkflowRegistration {
  assertRegistryPublishedWorkflowVersionRecord(record);
  registerWorkflowDefinition(registry, record.definition, options);
  return { id: record.workflowId, version: record.version, hash: record.definitionHash };
}

export function registerWorkflowPublishedVersions(
  registry: WorkflowRegistry,
  records: Iterable<WorkflowPublishedVersionRecord>,
  options: WorkflowRegistrationOptions = {},
): WorkflowRegistration[] {
  const registrations: WorkflowRegistration[] = [];
  for (const record of records) {
    registrations.push(registerWorkflowPublishedVersion(registry, record, options));
  }
  return registrations;
}

function assertRegistryPublishedWorkflowVersionRecord(record: WorkflowPublishedVersionRecord): void {
  if (record.source !== "ui" || record.status !== "published") {
    throw new Error(`Workflow '${record.workflowId}@${record.version}' is not a UI published version record.`);
  }
  if (record.definition.id !== record.workflowId || record.definition.version !== record.version) {
    throw new Error(`Workflow '${record.workflowId}@${record.version}' published record does not match its definition id/version.`);
  }
  const computedHash = hashWorkflowDefinition(record.definition);
  if (record.definitionHash !== computedHash) {
    throw new Error(`Workflow '${record.workflowId}@${record.version}' published record has an invalid definition hash.`);
  }
}

export function registerWorkflowAgentProfile(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  profile: AgentProfileDefinition,
  options: WorkflowRegistryEntryOptions = {},
): WorkflowRegistryEntry<AgentProfileDefinition> {
  return registerRegistryEntry(registry.profiles, "agent profile", id, profile, options);
}

export function registerWorkflowHandler(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  handler: CodeNodeHandler,
  options: WorkflowRegistryEntryOptions = {},
): WorkflowRegistryEntry<CodeNodeHandler> {
  return registerRegistryEntry(registry.handlers, "handler", id, handler, options);
}

export function registerWorkflowAdapter(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  adapter: AdapterHandler,
  options: WorkflowRegistryEntryOptions = {},
): WorkflowRegistryEntry<AdapterHandler> {
  return registerRegistryEntry(registry.adapters, "adapter", id, adapter, options);
}

export function registerWorkflowGuard(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  guard: GuardHandler,
  options: WorkflowRegistryEntryOptions = {},
): WorkflowRegistryEntry<GuardHandler> {
  return registerRegistryEntry(registry.guards, "guard", id, guard, options);
}

export function registerWorkflowPromptBuilder(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  promptBuilder: PromptBuilderHandler,
  options: WorkflowRegistryEntryOptions = {},
): WorkflowRegistryEntry<PromptBuilderHandler> {
  return registerRegistryEntry(registry.promptBuilders, "promptBuilder", id, promptBuilder, options);
}

export function registerWorkflowHumanAction(
  registry: WorkflowRegistry,
  id: RegistryRefId,
  humanAction: WorkflowHumanActionDefinition,
  options: WorkflowRegistrationOptions = {},
): WorkflowHumanActionDefinition {
  if (registry.humanActions.has(id) && !options.override) {
    throw new Error(`Workflow human action '${id}' is already registered.`);
  }

  registry.humanActions.set(id, humanAction);
  return humanAction;
}

export function resolveWorkflowHumanAction(
  registry: Pick<WorkflowRegistry, "humanActions">,
  ref: RegistryRefId,
): WorkflowHumanActionDefinition | undefined {
  return registry.humanActions.get(ref);
}

export function hasWorkflowHumanAction(registry: Pick<WorkflowRegistry, "humanActions">, ref: RegistryRefId): boolean {
  return resolveWorkflowHumanAction(registry, ref) !== undefined;
}

export function resolveWorkflowAgentProfile(
  registry: Pick<WorkflowRegistry, "profiles">,
  ref: RegistryRefId,
): WorkflowRegistryEntry<AgentProfileDefinition> | undefined {
  return registry.profiles.get(ref);
}

export function hasWorkflowAgentProfile(registry: Pick<WorkflowRegistry, "profiles">, ref: RegistryRefId): boolean {
  return resolveWorkflowAgentProfile(registry, ref) !== undefined;
}

export function resolveWorkflowHandler(
  registry: Pick<WorkflowRegistry, "handlers">,
  ref: RegistryRefId,
): WorkflowRegistryEntry<CodeNodeHandler> | undefined {
  return registry.handlers.get(ref);
}

export function hasWorkflowHandler(registry: Pick<WorkflowRegistry, "handlers">, ref: RegistryRefId): boolean {
  return resolveWorkflowHandler(registry, ref) !== undefined;
}

export function resolveWorkflowAdapter(
  registry: Pick<WorkflowRegistry, "adapters">,
  ref: AdapterRef | RegistryRefId,
): WorkflowRegistryEntry<AdapterHandler> | undefined {
  const id = typeof ref === "string" ? ref : ref.id;
  return registry.adapters.get(id);
}

export function hasWorkflowAdapter(registry: Pick<WorkflowRegistry, "adapters">, ref: AdapterRef | RegistryRefId): boolean {
  return resolveWorkflowAdapter(registry, ref) !== undefined;
}

export function resolveWorkflowPromptBuilder(
  registry: Pick<WorkflowRegistry, "promptBuilders">,
  ref: PromptBuilderRef,
): WorkflowRegistryEntry<PromptBuilderHandler> | undefined {
  return registry.promptBuilders.get(getPromptBuilderRefId(ref));
}

export function hasWorkflowPromptBuilder(registry: Pick<WorkflowRegistry, "promptBuilders">, ref: PromptBuilderRef): boolean {
  return resolveWorkflowPromptBuilder(registry, ref) !== undefined;
}

function getPromptBuilderRefId(ref: PromptBuilderRef): RegistryRefId {
  return typeof ref === "string" ? ref : ref.id;
}

function registerRegistryEntry<TValue>(
  entries: Map<RegistryRefId, WorkflowRegistryEntry<TValue>>,
  kind: string,
  id: RegistryRefId,
  value: TValue,
  options: WorkflowRegistryEntryOptions,
): WorkflowRegistryEntry<TValue> {
  if (entries.has(id) && !options.override) {
    throw new Error(`Workflow ${kind} '${id}' is already registered.`);
  }

  const entry = withOptionalEntryMetadata(
    {
      id,
      value,
    },
    options,
  );
  entries.set(id, entry);
  return entry;
}

function withOptionalEntryMetadata<TValue>(
  entry: WorkflowRegistryEntry<TValue>,
  options: WorkflowRegistryEntryOptions,
): WorkflowRegistryEntry<TValue> {
  return {
    ...entry,
    ...(options.pluginId ? { pluginId: options.pluginId } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.tags ? { tags: options.tags } : {}),
    ...(options.paramsSchema ? { paramsSchema: options.paramsSchema } : {}),
  };
}
