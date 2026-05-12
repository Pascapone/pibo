/**
 * Canonical TypeScript types for Pibo Workflow System V1 definitions and run facts.
 *
 * These types intentionally model durable IR and registry references. Runtime implementations
 * are referenced by stable ids so persisted workflow records never need inline closures.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type JsonSchemaTypeName =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type JsonSchema = {
  type?: JsonSchemaTypeName | JsonSchemaTypeName[];
  title?: string;
  description?: string;
  enum?: JsonValue[];
  const?: JsonValue;
  default?: JsonValue;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false | JsonSchema;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $defs?: Record<string, JsonSchema>;
  $ref?: string;
};

export type WorkflowId = string;
export type WorkflowVersion = string;
export type WorkflowRunId = string;
export type NodeId = string;
export type EdgeId = string;
export type PortId = string;
export type NodeAttemptId = string;
export type EdgeTransferId = string;
export type WorkflowCheckpointId = string;
export type WorkflowWakeupId = string;
export type WorkflowWaitTokenId = string;
export type WorkflowEventId = string;
export type WorkflowDefinitionSnapshotId = string;
export type WorkflowHumanActionId = string;
export type RegistryRefId = string;
export type PromptTemplate = string;
export type DurationSpec =
  | { kind: "milliseconds"; value: number }
  | { kind: "seconds"; value: number }
  | { kind: "minutes"; value: number }
  | { kind: "iso8601"; value: string };

export type TextWorkflowPort = {
  kind: "text";
  description?: string;
};

export type JsonWorkflowPort = {
  kind: "json";
  schema: JsonSchema;
  description?: string;
};

export type WorkflowPort = TextWorkflowPort | JsonWorkflowPort;
export type WorkflowValue = string | JsonValue;

export type InferPortValue<TPort extends WorkflowPort | undefined> = TPort extends TextWorkflowPort
  ? string
  : TPort extends JsonWorkflowPort
    ? JsonValue
    : WorkflowValue;

export type WorkflowInputFrom<TWorkflow extends { input: WorkflowPort }> = InferPortValue<TWorkflow["input"]>;
export type WorkflowOutputFrom<TWorkflow extends { output: WorkflowPort }> = InferPortValue<TWorkflow["output"]>;
export type NodeInputFrom<TNode extends { input?: WorkflowPort }> = InferPortValue<TNode["input"]>;
export type NodeOutputFrom<TNode extends { output?: WorkflowPort }> = InferPortValue<TNode["output"]>;

export type AgentProfileSelection = {
  kind: "fixed";
  id: string;
};

export type PromptBuilderRef =
  | RegistryRefId
  | {
      kind: "promptBuilder";
      language: "typescript";
      id: RegistryRefId;
    };

export type AgentProfileDefinition = {
  aliases?: string[];
  tools?: string[];
  nativeTools?: string[];
  skills?: string[];
  contextFiles?: string[];
  status?: "active" | "archived";
  archivedAt?: string;
  metadata?: JsonObject;
};

export type SelectionPolicy =
  | { kind: "inherit" }
  | { kind: "only"; ids: string[] }
  | { kind: "exclude"; ids: string[] }
  | { kind: "extend"; ids: string[] };

export type ToolSelectionPolicy = SelectionPolicy;
export type SkillSelectionPolicy = SelectionPolicy;
export type ContextSelectionPolicy = SelectionPolicy;

export type SessionRoutingPolicy = {
  parentSessionId?: string;
  ownerScope?: string;
  projectId?: string;
  roomId?: string;
  channel?: string;
};

export type RuntimeAgentProfileMetadata = {
  id: string;
  requestedId: string;
  aliases?: string[];
  metadata?: JsonObject;
};

export type RuntimeSelectionMetadata = {
  profileId: string;
  requestedProfileId?: string;
  selectedProfile?: RuntimeAgentProfileMetadata;
  tools?: string[];
  skills?: string[];
  contextFiles?: string[];
  routing?: SessionRoutingPolicy;
};

export type StatePath = string;
export type StateScope = "global" | "local" | "edge";
export type ScopedStatePath = `${StateScope}.${string}`;

export type MergePolicy =
  | { kind: "replace" }
  | { kind: "append" }
  | { kind: "shallowMerge" }
  | { kind: "custom"; handler: RegistryRefId };

export type WorkflowStateFieldDefinition = {
  schema: JsonSchema;
  merge?: MergePolicy;
  description?: string;
};

export type WorkflowStateDefinition = {
  global?: Record<StatePath, WorkflowStateFieldDefinition>;
};

export type StateAccessPolicy = {
  reads?: ScopedStatePath[];
  writes?: ScopedStatePath[];
};

export type StatePatch = Record<string, JsonValue | undefined>;

export type RetryBackoffPolicy =
  | { kind: "none" }
  | { kind: "fixed"; delayMs: number }
  | { kind: "linear"; initialMs: number; stepMs: number; maxMs?: number }
  | { kind: "exponential"; initialMs: number; factor?: number; maxMs?: number };

export type RetryPolicy = {
  maxAttempts: number;
  backoff?: RetryBackoffPolicy;
  retryOn?: string[];
};

export type BaseNodeDefinition = {
  id?: NodeId;
  label?: string;
  description?: string;
  input?: WorkflowPort;
  output?: WorkflowPort;
  state?: StateAccessPolicy;
  retry?: RetryPolicy;
  metadata?: WorkflowMetadata;
  ui?: WorkflowNodeUiMetadata;
};

export type AgentNodeDefinition = BaseNodeDefinition & {
  kind: "agent";
  runtime: "pibo";
  profile: AgentProfileSelection;
  tools?: ToolSelectionPolicy;
  skills?: SkillSelectionPolicy;
  context?: ContextSelectionPolicy;
  routing?: SessionRoutingPolicy;
  promptTemplate?: PromptTemplate;
  promptBuilder?: PromptBuilderRef;
};

export type TypeScriptCodeNodeDefinition = BaseNodeDefinition & {
  kind: "code";
  language: "typescript";
  handler: RegistryRefId;
};

export type NestedWorkflowNodeDefinition = BaseNodeDefinition & {
  kind: "workflow";
  workflowId: WorkflowId;
  workflowVersion?: WorkflowVersion;
  namespace?: string;
};

export type HumanNodeDefinition = BaseNodeDefinition & {
  kind: "human";
  prompt: string;
  schema?: JsonSchema;
  actions?: WorkflowHumanActionRef[];
  timeout?: DurationSpec;
};

export type AdapterRef = {
  kind: "adapter";
  language: "typescript";
  id: RegistryRefId;
  params?: JsonObject;
};

export type AdapterNodeDefinition = BaseNodeDefinition & {
  kind: "adapter";
  handler: AdapterRef;
  mode: "deterministic";
};

export type WorkflowNodeDefinition =
  | AgentNodeDefinition
  | TypeScriptCodeNodeDefinition
  | NestedWorkflowNodeDefinition
  | HumanNodeDefinition
  | AdapterNodeDefinition;

export type NodePortRef = {
  nodeId: NodeId;
  portId?: PortId;
};

export type EdgeKind = "data" | "control" | "error" | "resume";
export type JoinPolicy = "all_success" | "one_success" | "none_failed_min_one_success" | "all_done";

export type GuardRef = {
  handler: RegistryRefId;
  priority?: number;
  params?: JsonObject;
};

export type EdgeAdapterDefinition = {
  kind: "edgeAdapter";
  output: WorkflowPort;
  transform: AdapterRef;
};

export type EdgeMapDefinition = {
  from?: StatePath;
  to?: StatePath;
};

export type EdgeStateMapping = {
  reads?: ScopedStatePath[];
  writes?: ScopedStatePath[];
  merge?: MergePolicy;
};

export type WorkflowEdgeDefinition = {
  id: EdgeId;
  from: NodePortRef;
  to: NodePortRef;
  kind?: EdgeKind;
  event?: string;
  guard?: GuardRef;
  priority?: number;
  join?: JoinPolicy;
  map?: EdgeMapDefinition;
  state?: EdgeStateMapping;
  adapter?: EdgeAdapterDefinition;
  metadata?: WorkflowMetadata;
  ui?: WorkflowEdgeUiMetadata;
};

export type LoopPolicy = {
  edgeId: EdgeId;
  maxAttempts: number;
  guard?: GuardRef;
};

export type WorkflowMetadata = {
  useWhen?: string[];
  notFor?: string[];
  examples?: string[];
  tags?: string[];
  routingHints?: Record<string, JsonValue>;
  promptAssetRefs?: RegistryRefId[];
  capabilityRefs?: RegistryRefId[];
  migration?: {
    fromVersion?: WorkflowVersion;
    toVersion?: WorkflowVersion;
    notes?: string;
  };
  [key: string]: JsonValue | string[] | { fromVersion?: string; toVersion?: string; notes?: string } | undefined;
};

export type WorkflowUiMetadata = {
  layout?: "auto" | "manual";
  positions?: Record<NodeId, { x: number; y: number }>;
  collapsed?: NodeId[];
  color?: string;
  icon?: string;
};

export type WorkflowNodeUiMetadata = {
  position?: { x: number; y: number };
  collapsed?: boolean;
  color?: string;
  icon?: string;
};

export type WorkflowEdgeUiMetadata = {
  label?: string;
  color?: string;
};

export type WorkflowDefinition = {
  id: WorkflowId;
  version: WorkflowVersion;
  title?: string;
  description?: string;
  input: WorkflowPort;
  output: WorkflowPort;
  initial: NodeId | NodeId[];
  final?: NodeId | NodeId[];
  nodes: Record<NodeId, WorkflowNodeDefinition>;
  edges: Record<EdgeId, WorkflowEdgeDefinition>;
  state?: WorkflowStateDefinition;
  retry?: RetryPolicy;
  loops?: LoopPolicy[];
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

export type WorkflowDefinitionInput = Omit<WorkflowDefinition, "version"> & {
  version?: WorkflowVersion;
};

export type WorkflowDefinitionSnapshot = {
  id: WorkflowDefinitionSnapshotId;
  workflowId: WorkflowId;
  workflowVersion: WorkflowVersion;
  hash: string;
  definition: WorkflowDefinition;
  createdAt: string;
};

export type WorkflowRecordSource = "code" | "ui";
export type WorkflowRecordStatus = "draft" | "published" | "archived";
export type WorkflowDraftId = string;
export type WorkflowVersionIntent = "patch" | "minor" | "major";
export type WorkflowDraftValidationState = "unknown" | "valid" | "warning" | "error";

export type PartialWorkflowDefinition = Partial<WorkflowDefinition> & {
  id?: WorkflowId;
  version?: WorkflowVersion;
};

export type WorkflowIdentityRecord = {
  workflowId: WorkflowId;
  source: "ui";
  title: string;
  description?: string;
  tags: string[];
  currentDraftId?: WorkflowDraftId;
  latestVersion?: WorkflowVersion;
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
};

export type WorkflowDraftRecord = {
  draftId: WorkflowDraftId;
  workflowId: WorkflowId;
  source: "ui";
  status: "draft";
  baseWorkflowId?: WorkflowId;
  baseWorkflowVersion?: WorkflowVersion;
  baseDefinitionHash?: string;
  versionIntent: WorkflowVersionIntent;
  definition: PartialWorkflowDefinition;
  diagnostics: WorkflowDiagnostic[];
  validationState: WorkflowDraftValidationState;
  revision: number;
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
};

export type WorkflowPublishedVersionRecord = {
  workflowId: WorkflowId;
  version: WorkflowVersion;
  source: "ui";
  status: "published";
  definition: WorkflowDefinition;
  definitionHash: string;
  publishedFromDraftId?: string;
  publishedBy?: string;
  publishedAt: string;
  createdAt: string;
};

export type WorkflowArchiveStateRecord = {
  workflowId: WorkflowId;
  source: "ui";
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
  updatedAt: string;
};

export type WorkflowDeleteTombstoneRecord = {
  workflowId: WorkflowId;
  source: "ui";
  deleted: true;
  deletedAt?: string;
  deletedBy?: string;
  lastKnownTitle: string;
  lastKnownVersion?: WorkflowVersion;
  lastDefinitionHash?: string;
  createdAt: string;
};

export type WorkflowCatalogRecord = {
  id: string;
  workflowId: WorkflowId;
  version?: WorkflowVersion;
  draftId?: WorkflowDraftId;
  title: string;
  description?: string;
  tags: string[];
  source: WorkflowRecordSource;
  status: WorkflowRecordStatus;
  versions: WorkflowVersion[];
  currentDraftId?: WorkflowDraftId;
  validationState?: WorkflowDraftValidationState;
  diagnostics?: WorkflowDiagnostic[];
  definitionHash?: string;
  editable: boolean;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
};

export type DiagnosticSeverity = "info" | "warning" | "error";

export type WorkflowDiagnostic = {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  path?: string;
  workflowId?: WorkflowId;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  statePath?: StatePath;
  registryRef?: RegistryRefId;
  hint?: string;
};

export type ValidationResult =
  | { ok: true; diagnostics: WorkflowDiagnostic[] }
  | { ok: false; diagnostics: WorkflowDiagnostic[] };

export type CompileResult =
  | { ok: true; plan: WorkflowExecutionPlan; diagnostics: WorkflowDiagnostic[] }
  | { ok: false; diagnostics: WorkflowDiagnostic[] };

export type WorkflowRegistryEntry<TValue> = {
  id: RegistryRefId;
  pluginId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  paramsSchema?: JsonSchema;
  value: TValue;
};

export type WorkflowRegistration = {
  id: WorkflowId;
  version: WorkflowVersion;
  hash?: string;
};

export type WorkflowRegistrationOptions = {
  pluginId?: string;
  override?: boolean;
};

export type WorkflowRegistry = {
  workflows: Map<WorkflowId, WorkflowDefinition[]>;
  profiles: Map<RegistryRefId, WorkflowRegistryEntry<AgentProfileDefinition>>;
  handlers: Map<RegistryRefId, WorkflowRegistryEntry<CodeNodeHandler>>;
  adapters: Map<RegistryRefId, WorkflowRegistryEntry<AdapterHandler>>;
  guards: Map<RegistryRefId, WorkflowRegistryEntry<GuardHandler>>;
  promptBuilders: Map<RegistryRefId, WorkflowRegistryEntry<PromptBuilderHandler>>;
  humanActions: Map<RegistryRefId, WorkflowHumanActionDefinition>;
};

export type WorkflowSetupOptions = {
  types?: Record<string, unknown>;
  profiles?: Record<string, AgentProfileDefinition>;
  handlers?: Record<string, CodeNodeHandler>;
  guards?: Record<string, GuardHandler>;
  adapters?: Record<string, AdapterHandler>;
  promptBuilders?: Record<string, PromptBuilderHandler>;
  humanActions?: Record<string, WorkflowHumanActionDefinition>;
  metadata?: WorkflowMetadata;
};

export type WorkflowSetup = {
  defineWorkflow(id: WorkflowId, definition: WorkflowDefinitionInput): WorkflowDefinition;
  registerWorkflow(definition: WorkflowDefinition, options?: WorkflowRegistrationOptions): WorkflowRegistration;
};

export type WorkflowProviders = {
  profiles?: Record<string, AgentProfileDefinition>;
  handlers?: Record<string, CodeNodeHandler>;
  adapters?: Record<string, AdapterHandler>;
  guards?: Record<string, GuardHandler>;
  promptBuilders?: Record<string, PromptBuilderHandler>;
  humanActions?: Record<string, WorkflowHumanActionDefinition>;
};

export type ProvidedWorkflow = {
  definition: WorkflowDefinition;
  providers: WorkflowProviders;
};

export type WorkflowGlobalStateReader = {
  get(path: StatePath): JsonValue | undefined;
};

export type NodeLocalStateReader = WorkflowGlobalStateReader;

export type EdgePayloadReader = {
  get(edgeId: EdgeId): WorkflowValue | undefined;
  all(): Record<EdgeId, WorkflowValue>;
};

export type WorkflowCommand =
  | {
      kind: "requestHumanInput";
      prompt: string;
      schema?: JsonSchema;
      actions?: WorkflowHumanActionRef[];
    }
  | { kind: "cancelWorkflow"; reason?: string }
  | { kind: "emitEvent"; event: WorkflowRuntimeEvent };

export type WorkflowEventEmitter = (event: WorkflowRuntimeEvent) => void | Promise<void>;
export type WorkflowCommandEmitter = (command: WorkflowCommand) => void | Promise<void>;

export type CodeNodeContext<I = WorkflowValue> = {
  input: I;
  global: WorkflowGlobalStateReader;
  local: NodeLocalStateReader;
  edge: EdgePayloadReader;
  emit: WorkflowEventEmitter;
  command: WorkflowCommandEmitter;
};

export type CodeNodeResult<O = WorkflowValue> = {
  output: O;
  globalPatch?: StatePatch;
  localPatch?: StatePatch;
  command?: WorkflowCommand | WorkflowCommand[];
};

export type CodeNodeHandler<I = WorkflowValue, O = WorkflowValue> = (
  ctx: CodeNodeContext<I>,
) => Promise<CodeNodeResult<O>> | CodeNodeResult<O>;

export type AdapterContext<I = WorkflowValue> = {
  input: I;
  edge?: WorkflowEdgeDefinition;
  run?: WorkflowRun;
};

export type AdapterResult<O = WorkflowValue> = {
  output: O;
};

export type AdapterHandler<I = WorkflowValue, O = WorkflowValue> = (
  ctx: AdapterContext<I>,
) => Promise<AdapterResult<O>> | AdapterResult<O>;

export type GuardContext = {
  run?: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  edge?: WorkflowEdgeDefinition;
  input?: WorkflowValue;
  output?: WorkflowValue;
  state?: WorkflowRunState;
};

export type GuardHandler = (ctx: GuardContext) => boolean | Promise<boolean>;

export type PromptBuilderResult =
  | string
  | {
      prompt: string;
      metadata?: Record<string, JsonValue>;
    };

export type PromptBuilderContext<I = WorkflowValue> = {
  input: I;
  state: WorkflowRunState;
  global: WorkflowGlobalStateReader;
  local: NodeLocalStateReader;
  edge: EdgePayloadReader;
  node: AgentNodeDefinition;
  nodeId: NodeId;
  run?: WorkflowRun;
  workflow?: WorkflowDefinition;
};

export type PromptBuilderHandler<I = WorkflowValue> = (
  ctx: PromptBuilderContext<I>,
) => PromptBuilderResult | Promise<PromptBuilderResult>;

export type WorkflowExecutionEnvironment = {
  kind: "host" | "worktree" | "docker" | "remote";
  id?: string;
  metadata?: Record<string, JsonValue>;
};

export type WorkflowRunStatus = "pending" | "running" | "waiting" | "failed" | "completed" | "cancelled";

export type WorkflowRunCursor = {
  nodeId?: NodeId;
  edgeId?: EdgeId;
  status?: WorkflowRunStatus;
};

export type WorkflowRunState = {
  global: Record<string, JsonValue>;
  local?: Record<NodeId, Record<string, JsonValue>>;
};

export type WorkflowCheckpointRef = {
  id: WorkflowCheckpointId;
  namespace: string;
};

export type WorkflowRun = {
  id: WorkflowRunId;
  workflowId: WorkflowId;
  workflowVersion: WorkflowVersion;
  workflowDefinitionHash?: string;
  definitionSnapshotId?: string;
  ownerScope: string;
  parentRunId?: WorkflowRunId;
  parentNodeAttemptId?: NodeAttemptId;
  piboSessionId?: string;
  projectId?: string;
  environment?: WorkflowExecutionEnvironment;
  status: WorkflowRunStatus;
  current: WorkflowRunCursor;
  input: WorkflowValue;
  output?: WorkflowValue;
  state: WorkflowRunState;
  checkpoint?: WorkflowCheckpointRef;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
};

export type WorkflowErrorSummary = {
  code: string;
  message: string;
  retryable?: boolean;
  details?: JsonObject;
};

export type WorkflowLease = {
  ownerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
};

export type NodeAttemptStatus =
  | "pending"
  | "leased"
  | "running"
  | "waiting"
  | "retry_scheduled"
  | "failed"
  | "completed"
  | "skipped"
  | "cancelled";

export type NodeAttempt = {
  id: NodeAttemptId;
  workflowRunId: WorkflowRunId;
  nodeId: NodeId;
  attempt: number;
  kind: WorkflowNodeDefinition["kind"];
  status: NodeAttemptStatus;
  environment?: WorkflowExecutionEnvironment;
  input: WorkflowValue;
  output?: WorkflowValue;
  localState?: Record<string, JsonValue>;
  metadata?: NodeAttemptMetadata;
  error?: WorkflowErrorSummary;
  lease?: WorkflowLease;
  startedAt?: string;
  heartbeatAt?: string;
  completedAt?: string;
  failedAt?: string;
  availableAt?: string;
};

export type RecordedAgentPromptSource = "input" | "promptTemplate" | "promptBuilder";

export type RecordedAgentPrompt = {
  text: string;
  source: RecordedAgentPromptSource;
  tracePrivacy: {
    kind: "ownerScope";
    storage: "workflow-node-attempt";
    redacted: false;
  };
  promptBuilderId?: RegistryRefId;
  builderMetadata?: Record<string, JsonValue>;
};

export type NodeAttemptMetadata = {
  runtime?: RuntimeSelectionMetadata;
  finalPrompt?: RecordedAgentPrompt;
  childRunId?: WorkflowRunId;
  waitTokenId?: WorkflowWaitTokenId;
  adapterId?: RegistryRefId;
  [key: string]: JsonValue | RuntimeSelectionMetadata | RecordedAgentPrompt | undefined;
};

export type EdgeTransferStatus = "pending" | "transferred" | "failed";

export type EdgeTransfer = {
  id: EdgeTransferId;
  workflowRunId: WorkflowRunId;
  edgeId: EdgeId;
  sourceNodeAttemptId: NodeAttemptId;
  targetNodeId: NodeId;
  status: EdgeTransferStatus;
  payload: WorkflowValue;
  adapterAttemptId?: NodeAttemptId;
  createdAt: string;
};

export type WorkflowCheckpoint = {
  id: WorkflowCheckpointId;
  workflowRunId: WorkflowRunId;
  namespace: string;
  cursor: WorkflowRunCursor;
  globalState: Record<string, JsonValue>;
  pendingNodeIds: NodeId[];
  completedNodeIds: NodeId[];
  edgePayloadRefs: EdgeTransferId[];
  createdAt: string;
};

export type WorkflowWakeup = {
  id: WorkflowWakeupId;
  workflowRunId: WorkflowRunId;
  nodeAttemptId?: NodeAttemptId;
  kind: "retry" | "human" | "runtime" | "child_workflow";
  availableAt: string;
  correlationId?: string;
  payload?: WorkflowValue;
  createdAt: string;
};

export type WorkflowHumanActionKind = "approve" | "reject" | "resume" | "cancel" | string;

export type WorkflowHumanActionRef = {
  id: RegistryRefId;
  kind?: WorkflowHumanActionKind;
};

export type WorkflowHumanActionDefinition = {
  id: RegistryRefId;
  kind: WorkflowHumanActionKind;
  title: string;
  description?: string;
  input?: WorkflowPort;
  output?: WorkflowPort;
  handler?: RegistryRefId;
};

export type WorkflowHumanActionRecord = {
  id: WorkflowHumanActionId;
  workflowRunId: WorkflowRunId;
  waitTokenId: WorkflowWaitTokenId;
  kind: WorkflowHumanActionKind;
  actor?: JsonObject;
  payload?: WorkflowValue;
  createdAt: string;
};

export type WorkflowWaitTokenStatus = "pending" | "resumed" | "expired" | "cancelled";

export type WorkflowWaitToken = {
  id: WorkflowWaitTokenId;
  workflowRunId: WorkflowRunId;
  nodeAttemptId?: NodeAttemptId;
  humanNodeId?: NodeId;
  kind?: string;
  actions: WorkflowHumanActionRef[];
  prompt: string;
  schema?: JsonSchema;
  status: WorkflowWaitTokenStatus;
  resumePayload?: WorkflowValue;
  createdAt: string;
  expiresAt?: string;
  resumedAt?: string;
};

export type WorkflowRuntimeEvent =
  | { type: "workflow.started"; runId: WorkflowRunId; workflowId: WorkflowId }
  | { type: "workflow.completed"; runId: WorkflowRunId; output?: WorkflowValue }
  | { type: "workflow.failed"; runId: WorkflowRunId; error: WorkflowErrorSummary }
  | { type: "workflow.cancelled"; runId: WorkflowRunId; reason?: string }
  | { type: "node.started"; runId: WorkflowRunId; nodeAttemptId: NodeAttemptId; nodeId: NodeId }
  | { type: "node.completed"; runId: WorkflowRunId; nodeAttemptId: NodeAttemptId; output?: WorkflowValue }
  | { type: "node.failed"; runId: WorkflowRunId; nodeAttemptId: NodeAttemptId; error: WorkflowErrorSummary }
  | { type: "edge.transferred"; runId: WorkflowRunId; edgeTransferId: EdgeTransferId; edgeId: EdgeId }
  | { type: "wait.created"; runId: WorkflowRunId; waitTokenId: WorkflowWaitTokenId }
  | { type: "wait.resumed"; runId: WorkflowRunId; waitTokenId: WorkflowWaitTokenId; payload?: WorkflowValue }
  | { type: "retry.scheduled"; runId: WorkflowRunId; nodeAttemptId: NodeAttemptId; availableAt: string }
  | { type: "checkpoint.created"; runId: WorkflowRunId; checkpointId: WorkflowCheckpointId };

export type WorkflowEventRecord = {
  id: WorkflowEventId;
  workflowRunId: WorkflowRunId;
  type: WorkflowRuntimeEvent["type"] | string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  attemptId?: NodeAttemptId;
  payload?: WorkflowRuntimeEvent | JsonObject;
  createdAt: string;
};

export type WorkflowSnapshotKind = "kernel" | "xstate" | "ui";

export type WorkflowMachineSnapshot<TInput = WorkflowValue, TOutput = WorkflowValue> = {
  kind: WorkflowSnapshotKind;
  workflowId: WorkflowId;
  runId?: WorkflowRunId;
  status: WorkflowRunStatus;
  current: WorkflowRunCursor;
  input?: TInput;
  output?: TOutput;
  state?: WorkflowRunState;
  version: number;
};

export type WorkflowSnapshotFrom<TWorkflow extends { input: WorkflowPort; output: WorkflowPort }> =
  WorkflowMachineSnapshot<WorkflowInputFrom<TWorkflow>, WorkflowOutputFrom<TWorkflow>>;

export type XStateProjectionSchemaVersion = 1;
export type XStateProjectionKind = "pibo.workflow.xstateProjection";
export type XStateProjectionStateType = "atomic" | "compound" | "parallel" | "final" | "history";
export type XStateProjectionRuntimeStateKind = "node" | "wait" | "retryDelay" | "terminal";
export type XStateProjectionTerminalKind = "completed" | "failed" | "cancelled";

export type XStateProjectionContextShape = {
  /** Projection-only state shape; kernel workflow records remain the durable truth. */
  durableTruth: "kernel";
  global: Record<StatePath, WorkflowStateFieldDefinition>;
  local: Record<NodeId, StateAccessPolicy | undefined>;
  edge: Record<EdgeId, EdgeStateMapping | undefined>;
  exposesPrivatePayloads: false;
};

export type XStateProjectionInvokeInput =
  | { kind: "workflowInput" }
  | { kind: "nodeInput"; nodeId: NodeId }
  | { kind: "edgePayload"; edgeId: EdgeId }
  | { kind: "snapshotRef"; snapshotKind: WorkflowSnapshotKind };

export type XStateProjectionActor = {
  id: string;
  src: string;
  nodeId: NodeId;
  kind: WorkflowNodeDefinition["kind"];
  input: XStateProjectionInvokeInput;
  childWorkflowId?: WorkflowId;
  childWorkflowVersion?: WorkflowVersion;
  metadata?: WorkflowMetadata;
};

export type XStateProjectionGuard = {
  id: string;
  ref: RegistryRefId;
  edgeId?: EdgeId;
  description?: string;
};

export type XStateProjectionActionKind =
  | "startNode"
  | "completeNode"
  | "transferEdge"
  | "enterWait"
  | "resumeWait"
  | "scheduleRetry"
  | "recordFailure"
  | "cancelWorkflow";

export type XStateProjectionAction = {
  id: string;
  kind: XStateProjectionActionKind;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  durableEffect: boolean;
};

export type XStateProjectionDelay = {
  id: string;
  kind: "retry" | "humanTimeout";
  nodeId?: NodeId;
  edgeId?: EdgeId;
  duration?: DurationSpec;
  durableWakeup: true;
};

export type XStateProjectionStateMeta = {
  pibo: {
    kind: XStateProjectionRuntimeStateKind;
    nodeId?: NodeId;
    nodeKind?: WorkflowNodeDefinition["kind"];
    actorId?: string;
    wait?: {
      durable: true;
      resumeEvent: string;
      waitTokenId?: WorkflowWaitTokenId;
      actions?: WorkflowHumanActionRef[];
      timeout?: DurationSpec;
    };
    retry?: {
      durable: true;
      delayId: string;
      policy?: RetryPolicy;
    };
    terminal?: {
      status: Extract<WorkflowRunStatus, "completed" | "failed" | "cancelled">;
    };
    ui?: WorkflowNodeUiMetadata;
    description?: string;
    tags?: string[];
  };
};

export type XStateProjectionTransitionMeta = {
  pibo: {
    edgeId?: EdgeId;
    edgeKind?: EdgeKind;
    guardRef?: RegistryRefId;
    adapterRef?: RegistryRefId;
    join?: JoinPolicy;
    priority?: number;
    ui?: WorkflowEdgeUiMetadata;
  };
};

export type XStateProjectionTransitionConfig = {
  target?: string | string[];
  guard?: string | { type: string; params?: JsonObject };
  actions?: string[];
  reenter?: boolean;
  meta?: XStateProjectionTransitionMeta;
};

export type XStateProjectionInvokeConfig = {
  id: string;
  src: string;
  input?: XStateProjectionInvokeInput;
  onDone?: XStateProjectionTransitionConfig;
  onError?: XStateProjectionTransitionConfig;
};

export type XStateProjectionStateNodeConfig = {
  id?: string;
  type?: XStateProjectionStateType;
  description?: string;
  tags?: string[];
  entry?: string[];
  exit?: string[];
  invoke?: XStateProjectionInvokeConfig | XStateProjectionInvokeConfig[];
  on?: Record<string, XStateProjectionTransitionConfig | XStateProjectionTransitionConfig[]>;
  after?: Record<string, XStateProjectionTransitionConfig | XStateProjectionTransitionConfig[]>;
  always?: XStateProjectionTransitionConfig | XStateProjectionTransitionConfig[];
  states?: Record<string, XStateProjectionStateNodeConfig>;
  meta?: XStateProjectionStateMeta;
};

export type XStateProjectionMachineMeta = {
  pibo: {
    schemaVersion: XStateProjectionSchemaVersion;
    workflowId: WorkflowId;
    workflowVersion: WorkflowVersion;
    snapshotKinds: WorkflowSnapshotKind[];
    contextShape: XStateProjectionContextShape;
    actors: Record<string, XStateProjectionActor>;
    guards: Record<string, XStateProjectionGuard>;
    actions: Record<string, XStateProjectionAction>;
    delays: Record<string, XStateProjectionDelay>;
    finalStates: Record<XStateProjectionTerminalKind, string>;
    metadata?: WorkflowMetadata;
    ui?: WorkflowUiMetadata;
  };
};

export type XStateProjectionMachineConfig = {
  id: WorkflowId;
  initial: string;
  context?: Record<string, JsonValue>;
  states: Record<string, XStateProjectionStateNodeConfig>;
  on?: Record<string, XStateProjectionTransitionConfig | XStateProjectionTransitionConfig[]>;
  meta: XStateProjectionMachineMeta;
};

export type XStateProjectionState = {
  id: string;
  nodeId?: NodeId;
  kind: XStateProjectionRuntimeStateKind;
  type?: XStateProjectionStateType;
  actorId?: string;
  invoke?: XStateProjectionInvokeConfig;
  entry?: string[];
  exit?: string[];
  after?: Record<string, XStateProjectionTransitionConfig | XStateProjectionTransitionConfig[]>;
  tags?: string[];
  meta?: XStateProjectionStateMeta;
};

export type XStateProjectionTransition = {
  id?: string;
  event: string;
  source: string;
  target: string;
  edgeId?: EdgeId;
  guard?: RegistryRefId;
  actions?: string[];
  meta?: XStateProjectionTransitionMeta;
};

export type XStateMachineProjection = {
  kind: XStateProjectionKind;
  schemaVersion: XStateProjectionSchemaVersion;
  id: WorkflowId;
  version: WorkflowVersion;
  initial: string;
  config: XStateProjectionMachineConfig;
  states: Record<string, XStateProjectionState>;
  transitions: XStateProjectionTransition[];
  actors: Record<string, XStateProjectionActor>;
  guards: Record<string, XStateProjectionGuard>;
  actions: Record<string, XStateProjectionAction>;
  delays: Record<string, XStateProjectionDelay>;
  contextShape: XStateProjectionContextShape;
  finalStates: Record<XStateProjectionTerminalKind, string>;
  metadata?: WorkflowMetadata;
  ui?: WorkflowUiMetadata;
};

export type WorkflowXStateUiModelSchemaVersion = 1;
export type WorkflowXStateUiModelKind = "pibo.workflow.xstateUiModel";
export type WorkflowXStateUiNodeStatus =
  | "idle"
  | "active"
  | "waiting"
  | "retry_scheduled"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowXStateUiProjectionSummary = {
  kind: XStateProjectionKind;
  schemaVersion: XStateProjectionSchemaVersion;
  workflowId: WorkflowId;
  workflowVersion: WorkflowVersion;
  initialStateId: string;
  durableTruth: XStateProjectionContextShape["durableTruth"];
  exposesPrivatePayloads: XStateProjectionContextShape["exposesPrivatePayloads"];
  snapshotKinds: WorkflowSnapshotKind[];
};

export type WorkflowXStateUiNode = {
  id: string;
  label: string;
  kind: XStateProjectionRuntimeStateKind;
  type?: XStateProjectionStateType;
  nodeId?: NodeId;
  nodeKind?: WorkflowNodeDefinition["kind"];
  actorId?: string;
  status: WorkflowXStateUiNodeStatus;
  tags: string[];
  description?: string;
  position?: { x: number; y: number };
  collapsed?: boolean;
  color?: string;
  icon?: string;
  wait?: XStateProjectionStateMeta["pibo"]["wait"];
  retry?: XStateProjectionStateMeta["pibo"]["retry"];
  terminal?: XStateProjectionStateMeta["pibo"]["terminal"];
};

export type WorkflowXStateUiEdge = {
  id: string;
  source: string;
  target: string;
  event: string;
  edgeId?: EdgeId;
  edgeKind?: EdgeKind;
  guardRef?: RegistryRefId;
  adapterRef?: RegistryRefId;
  actions: string[];
  label?: string;
  color?: string;
  priority?: number;
};

export type WorkflowXStateUiActor = {
  id: string;
  nodeId: NodeId;
  kind: WorkflowNodeDefinition["kind"];
  src: string;
  childWorkflowId?: WorkflowId;
  childWorkflowVersion?: WorkflowVersion;
};

export type WorkflowXStateUiCurrent = {
  snapshotKind?: WorkflowSnapshotKind;
  runId?: WorkflowRunId;
  status?: WorkflowRunStatus;
  stateIds: string[];
  nodeId?: NodeId;
  edgeId?: EdgeId;
};

export type WorkflowXStateUiModel = {
  kind: WorkflowXStateUiModelKind;
  schemaVersion: WorkflowXStateUiModelSchemaVersion;
  projection: WorkflowXStateUiProjectionSummary;
  current?: WorkflowXStateUiCurrent;
  nodes: WorkflowXStateUiNode[];
  edges: WorkflowXStateUiEdge[];
  actors: WorkflowXStateUiActor[];
  guards: XStateProjectionGuard[];
  actions: XStateProjectionAction[];
  delays: XStateProjectionDelay[];
  finalStates: Record<XStateProjectionTerminalKind, string>;
  ui?: WorkflowUiMetadata;
};

export type WorkflowInspectionEvent =
  | { type: "@pibo.workflow.actor.created"; actorId: string; nodeId?: NodeId }
  | { type: "@pibo.workflow.event.sent"; actorId: string; event: WorkflowRuntimeEvent }
  | { type: "@pibo.workflow.transition"; runId: WorkflowRunId; from: string; to: string; edgeId?: EdgeId }
  | { type: "@pibo.workflow.snapshot"; runId: WorkflowRunId; snapshot: WorkflowMachineSnapshot }
  | { type: "@pibo.workflow.action"; runId: WorkflowRunId; action: string }
  | { type: "@pibo.workflow.child.output"; runId: WorkflowRunId; childRunId: WorkflowRunId; output: WorkflowValue }
  | { type: "@pibo.workflow.wait.entered"; runId: WorkflowRunId; reason: string }
  | { type: "@pibo.workflow.wait.resumed"; runId: WorkflowRunId; value?: WorkflowValue };

export type WorkflowInspectionListener = (event: WorkflowInspectionEvent) => void;
export type Unsubscribe = () => void;

export type PersistedActorSnapshot = {
  actorId: string;
  kind: WorkflowNodeDefinition["kind"];
  snapshot: JsonValue;
  createdAt: string;
};

export type PiboWorkflowActor<I = unknown, O = unknown, S = unknown> = {
  id: string;
  kind: WorkflowNodeDefinition["kind"];
  start(input: I): Promise<void> | void;
  send(event: WorkflowRuntimeEvent): void;
  stop(reason?: string): Promise<void> | void;
  getSnapshot(): S;
  persist?(): PersistedActorSnapshot;
  restore?(snapshot: PersistedActorSnapshot): void;
  inspect?(listener: WorkflowInspectionListener): Unsubscribe;
};

export type CompiledNode = WorkflowNodeDefinition & {
  id: NodeId;
};

export type CompiledEdge = WorkflowEdgeDefinition;

export type CompiledLoopPolicy = LoopPolicy;
export type CompiledJoinPolicy = {
  nodeId: NodeId;
  policy: JoinPolicy;
};
export type CompiledStatePolicy = WorkflowStateDefinition;

export type WorkflowExecutionPlan = {
  definitionId: WorkflowId;
  definitionVersion: WorkflowVersion;
  nodes: Record<NodeId, CompiledNode>;
  edges: Record<EdgeId, CompiledEdge>;
  initialNodeIds: NodeId[];
  terminalNodeIds: NodeId[];
  loops: CompiledLoopPolicy[];
  joins: CompiledJoinPolicy[];
  state: CompiledStatePolicy;
  xstateProjection: XStateMachineProjection;
};
