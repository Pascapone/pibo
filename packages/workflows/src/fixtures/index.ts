import { adapterRef, edgeAdapter, promptBuilderRef } from "../api/index.js";
import type {
  AdapterHandler,
  CodeNodeHandler,
  GuardHandler,
  JsonObject,
  JsonSchema,
  PromptBuilderHandler,
  WorkflowDefinition,
  WorkflowHumanActionDefinition,
  WorkflowProviders,
  WorkflowSetupOptions,
} from "../types/index.js";

const textInputPort = { kind: "text", description: "Plain text input." } as const;
const textOutputPort = { kind: "text", description: "Plain text output." } as const;

const topicInputSchema: JsonSchema = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Topic to work on." },
  },
  required: ["topic"],
  additionalProperties: false,
};

const draftSchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
  additionalProperties: false,
};

const reviewDecisionSchema: JsonSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
};

const normalizedSummarySchema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["draft", "approved", "rejected", "needs_revision"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
};

const planSchema: JsonSchema = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          done: { type: "boolean" },
        },
        required: ["title", "done"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
};

const topicInputPortJson = {
  kind: "json",
  schema: topicInputSchema,
  description: "Topic payload for workflow fixtures.",
} as const;

const draftPortJson = {
  kind: "json",
  schema: draftSchema,
  description: "Draft article payload.",
} as const;

const reviewDecisionPortJson = {
  kind: "json",
  schema: reviewDecisionSchema,
  description: "Human review decision payload.",
} as const;

const normalizedSummaryPortJson = {
  kind: "json",
  schema: normalizedSummarySchema,
  description: "Normalized summary payload.",
} as const;

const planPortJson = {
  kind: "json",
  schema: planSchema,
  description: "Step plan payload.",
} as const;

export const workflowFixtureRegistryRefs = {
  handlers: {
    makePlan: "fixture.handlers.makePlan",
    reviseDraft: "fixture.handlers.reviseDraft",
    summarizeDecision: "fixture.handlers.summarizeDecision",
  },
  adapters: {
    textToTopic: "fixture.adapters.textToTopic",
    draftToSummary: "fixture.adapters.draftToSummary",
    decisionToSummary: "fixture.adapters.decisionToSummary",
  },
  guards: {
    approved: "fixture.guards.approved",
    needsRevision: "fixture.guards.needsRevision",
  },
  promptBuilders: {
    draftPrompt: "fixture.promptBuilders.draftPrompt",
  },
  humanActions: {
    approve: "fixture.humanActions.approve",
    reject: "fixture.humanActions.reject",
    resume: "fixture.humanActions.resume",
    cancel: "fixture.humanActions.cancel",
  },
} as const;

export const minimalOneNodePiboAgentWorkflowFixture: WorkflowDefinition = {
  id: "fixture.minimal-pibo-agent",
  version: "1.0.0",
  title: "Minimal pibo-agent workflow",
  description: "Smallest useful workflow: one normal Pibo Runtime agent node.",
  input: textInputPort,
  output: textOutputPort,
  initial: "answer",
  final: "answer",
  nodes: {
    answer: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: textInputPort,
      output: textOutputPort,
      promptTemplate: "Answer the user request using normal Pibo Runtime routing: {{input}}",
    },
  },
  edges: {},
  metadata: {
    tags: ["fixture", "minimal", "agent"],
    useWhen: ["Validate that a one-node pibo-agent workflow can be represented."],
  },
};

export const adapterWorkflowFixture: WorkflowDefinition = {
  id: "fixture.edge-adapter",
  version: "1.0.0",
  title: "Edge adapter workflow",
  description: "Exercises an explicit registered edge adapter from text output to JSON input.",
  input: textInputPort,
  output: normalizedSummaryPortJson,
  initial: "collect",
  final: "summarize",
  nodes: {
    collect: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: textInputPort,
      output: textOutputPort,
      promptTemplate: "Turn the request into a short topic sentence: {{input}}",
    },
    summarize: {
      kind: "code",
      language: "typescript",
      handler: workflowFixtureRegistryRefs.handlers.summarizeDecision,
      input: topicInputPortJson,
      output: normalizedSummaryPortJson,
    },
  },
  edges: {
    "collect-to-summarize": {
      id: "collect-to-summarize",
      from: { nodeId: "collect" },
      to: { nodeId: "summarize" },
      kind: "data",
      adapter: edgeAdapter(adapterRef(workflowFixtureRegistryRefs.adapters.textToTopic), topicInputPortJson),
    },
  },
  metadata: {
    tags: ["fixture", "adapter", "edge"],
  },
};

export const humanWaitWorkflowFixture: WorkflowDefinition = {
  id: "fixture.human-wait",
  version: "1.0.0",
  title: "Human wait workflow",
  description: "Creates a durable human review wait and resumes with a validated decision payload.",
  input: draftPortJson,
  output: reviewDecisionPortJson,
  initial: "review",
  final: "review",
  nodes: {
    review: {
      kind: "human",
      prompt: "Review the draft and choose approve, reject, resume, or cancel.",
      input: draftPortJson,
      output: reviewDecisionPortJson,
      schema: reviewDecisionSchema,
      actions: [
        { id: workflowFixtureRegistryRefs.humanActions.approve, kind: "approve" },
        { id: workflowFixtureRegistryRefs.humanActions.reject, kind: "reject" },
        { id: workflowFixtureRegistryRefs.humanActions.resume, kind: "resume" },
        { id: workflowFixtureRegistryRefs.humanActions.cancel, kind: "cancel" },
      ],
      timeout: { kind: "minutes", value: 60 },
    },
  },
  edges: {},
  metadata: {
    tags: ["fixture", "human", "wait"],
  },
};

export const nestedChildWorkflowFixture: WorkflowDefinition = {
  id: "fixture.nested-child",
  version: "1.0.0",
  title: "Nested child workflow",
  description: "Reusable child workflow that turns text into a normalized summary.",
  input: textInputPort,
  output: normalizedSummaryPortJson,
  initial: "summarize",
  final: "summarize",
  nodes: {
    summarize: {
      kind: "code",
      language: "typescript",
      handler: workflowFixtureRegistryRefs.handlers.summarizeDecision,
      input: textInputPort,
      output: normalizedSummaryPortJson,
    },
  },
  edges: {},
  metadata: {
    tags: ["fixture", "nested", "child"],
  },
};

export const nestedWorkflowFixture: WorkflowDefinition = {
  id: "fixture.nested-parent",
  version: "1.0.0",
  title: "Nested parent workflow",
  description: "Parent workflow delegates work to a registered child workflow node.",
  input: textInputPort,
  output: normalizedSummaryPortJson,
  initial: "child",
  final: "child",
  nodes: {
    child: {
      kind: "workflow",
      workflowId: nestedChildWorkflowFixture.id,
      workflowVersion: nestedChildWorkflowFixture.version,
      namespace: "child-summary",
      input: textInputPort,
      output: normalizedSummaryPortJson,
    },
  },
  edges: {},
  metadata: {
    tags: ["fixture", "nested", "parent"],
  },
};

export const mixedNodeWorkflowFixture: WorkflowDefinition = {
  id: "fixture.mixed-nodes",
  version: "1.0.0",
  title: "Mixed node workflow",
  description: "Representative graph with code, agent, human, adapter, and nested workflow nodes.",
  input: topicInputPortJson,
  output: normalizedSummaryPortJson,
  initial: "plan",
  final: "child-summary",
  nodes: {
    plan: {
      kind: "code",
      language: "typescript",
      handler: workflowFixtureRegistryRefs.handlers.makePlan,
      input: topicInputPortJson,
      output: planPortJson,
      state: {
        reads: ["global.topic"],
        writes: ["global.plan"],
      },
    },
    draft: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: planPortJson,
      output: draftPortJson,
      promptBuilder: promptBuilderRef(workflowFixtureRegistryRefs.promptBuilders.draftPrompt),
    },
    review: {
      kind: "human",
      prompt: "Approve the draft before normalization.",
      input: draftPortJson,
      output: reviewDecisionPortJson,
      schema: reviewDecisionSchema,
      actions: [{ id: workflowFixtureRegistryRefs.humanActions.approve, kind: "approve" }],
    },
    normalize: {
      kind: "adapter",
      handler: adapterRef(workflowFixtureRegistryRefs.adapters.decisionToSummary),
      mode: "deterministic",
      input: reviewDecisionPortJson,
      output: normalizedSummaryPortJson,
    },
    "child-summary": {
      kind: "workflow",
      workflowId: nestedChildWorkflowFixture.id,
      workflowVersion: nestedChildWorkflowFixture.version,
      namespace: "mixed-child",
      input: textInputPort,
      output: normalizedSummaryPortJson,
    },
  },
  edges: {
    "plan-to-draft": {
      id: "plan-to-draft",
      from: { nodeId: "plan" },
      to: { nodeId: "draft" },
      kind: "data",
    },
    "draft-to-review": {
      id: "draft-to-review",
      from: { nodeId: "draft" },
      to: { nodeId: "review" },
      kind: "data",
    },
    "review-to-normalize": {
      id: "review-to-normalize",
      from: { nodeId: "review" },
      to: { nodeId: "normalize" },
      kind: "resume",
      guard: { handler: workflowFixtureRegistryRefs.guards.approved, priority: 1 },
    },
    "normalize-to-child": {
      id: "normalize-to-child",
      from: { nodeId: "normalize" },
      to: { nodeId: "child-summary" },
      kind: "data",
      adapter: edgeAdapter(adapterRef(workflowFixtureRegistryRefs.adapters.draftToSummary), textInputPort),
    },
  },
  state: {
    global: {
      topic: { schema: topicInputSchema, merge: { kind: "replace" } },
      plan: { schema: planSchema, merge: { kind: "replace" } },
    },
  },
  metadata: {
    tags: ["fixture", "mixed", "all-node-kinds"],
  },
};

export const debugSerializationWorkflowFixture: WorkflowDefinition = {
  id: "fixture.debug-serialization",
  version: "1.0.0",
  title: "Debug serialization fixture",
  description: "Stable fixture for deterministic debug serialization snapshots.",
  input: topicInputPortJson,
  output: draftPortJson,
  initial: "draft",
  final: "draft",
  nodes: {
    draft: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: topicInputPortJson,
      output: draftPortJson,
      promptTemplate: "Write a concise draft about {{input.topic}}.",
      tools: { kind: "inherit" },
      skills: { kind: "inherit" },
      context: { kind: "inherit" },
      routing: { channel: "workflow-fixture" },
      metadata: {
        tags: ["debug", "serialization"],
      },
      ui: {
        position: { x: 120, y: 80 },
        color: "blue",
        icon: "bot",
      },
    },
  },
  edges: {},
  metadata: {
    examples: ["Snapshot this fixture after normalization."],
    tags: ["fixture", "debug", "serialization"],
    routingHints: { preferredChannel: "workflow-fixture" },
    promptAssetRefs: ["fixture.prompts.conciseDraft"],
  },
  ui: {
    layout: "manual",
    positions: { draft: { x: 120, y: 80 } },
  },
};

export const boundedReviewLoopWorkflowFixture: WorkflowDefinition = {
  id: "fixture.bounded-review-loop",
  version: "1.0.0",
  title: "Bounded review loop workflow",
  description: "Review/fix loop with an explicit back-edge maxAttempts policy.",
  input: topicInputPortJson,
  output: reviewDecisionPortJson,
  initial: "draft",
  final: "review",
  nodes: {
    draft: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: topicInputPortJson,
      output: draftPortJson,
      promptTemplate: "Create or revise a draft for {{input.topic}}.",
      retry: { maxAttempts: 2, backoff: { kind: "fixed", delayMs: 1_000 } },
    },
    review: {
      kind: "human",
      prompt: "Approve the draft or request one more revision.",
      input: draftPortJson,
      output: reviewDecisionPortJson,
      schema: reviewDecisionSchema,
      actions: [
        { id: workflowFixtureRegistryRefs.humanActions.approve, kind: "approve" },
        { id: workflowFixtureRegistryRefs.humanActions.resume, kind: "resume" },
      ],
    },
    revise: {
      kind: "code",
      language: "typescript",
      handler: workflowFixtureRegistryRefs.handlers.reviseDraft,
      input: reviewDecisionPortJson,
      output: topicInputPortJson,
      state: {
        reads: ["global.reviewNotes"],
        writes: ["global.revisionCount"],
      },
    },
  },
  edges: {
    "draft-to-review": {
      id: "draft-to-review",
      from: { nodeId: "draft" },
      to: { nodeId: "review" },
      kind: "data",
    },
    "needs-revision": {
      id: "needs-revision",
      from: { nodeId: "review" },
      to: { nodeId: "revise" },
      kind: "control",
      guard: { handler: workflowFixtureRegistryRefs.guards.needsRevision, priority: 2 },
    },
    "revise-to-draft": {
      id: "revise-to-draft",
      from: { nodeId: "revise" },
      to: { nodeId: "draft" },
      kind: "data",
    },
  },
  loops: [
    {
      edgeId: "revise-to-draft",
      maxAttempts: 3,
      guard: { handler: workflowFixtureRegistryRefs.guards.needsRevision },
    },
  ],
  state: {
    global: {
      reviewNotes: {
        schema: reviewDecisionSchema,
        merge: { kind: "replace" },
      },
      revisionCount: {
        schema: { type: "integer" },
        merge: { kind: "replace" },
      },
    },
  },
  metadata: {
    tags: ["fixture", "review-loop", "bounded-back-edge"],
  },
};

export const requiredWorkflowFixtures: readonly WorkflowDefinition[] = [
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  adapterWorkflowFixture,
  humanWaitWorkflowFixture,
  nestedChildWorkflowFixture,
  nestedWorkflowFixture,
  debugSerializationWorkflowFixture,
  boundedReviewLoopWorkflowFixture,
];

export const workflowFixtureDefinitionsById: Readonly<Record<string, WorkflowDefinition>> = Object.fromEntries(
  requiredWorkflowFixtures.map((definition) => [definition.id, definition]),
);

const makePlanHandler: CodeNodeHandler = ({ input }) => {
  const topic = readObjectField(input, "topic", "Untitled topic");
  return {
    output: {
      steps: [
        { title: `Research ${topic}`, done: false },
        { title: `Draft ${topic}`, done: false },
      ],
    },
  };
};

const reviseDraftHandler: CodeNodeHandler = ({ input }) => {
  const notes = readObjectField(input, "notes", "Apply review notes");
  return {
    output: {
      topic: notes,
    },
  };
};

const summarizeDecisionHandler: CodeNodeHandler = ({ input }) => ({
  output: {
    summary: typeof input === "string" ? input : JSON.stringify(input),
    status: "draft",
  },
});

const textToTopicAdapter: AdapterHandler = ({ input }) => ({
  output: {
    topic: typeof input === "string" ? input : JSON.stringify(input),
  },
});

const draftToSummaryAdapter: AdapterHandler = ({ input }) => ({
  output: typeof input === "string" ? input : readObjectField(input, "summary", JSON.stringify(input)),
});

const decisionToSummaryAdapter: AdapterHandler = ({ input }) => ({
  output: {
    summary: readObjectField(input, "notes", "No review notes provided."),
    status: readBooleanField(input, "approved", false) ? "approved" : "needs_revision",
  },
});

const approvedGuard: GuardHandler = ({ output, input }) => readBooleanField(output ?? input, "approved", false);
const needsRevisionGuard: GuardHandler = ({ output, input }) => !readBooleanField(output ?? input, "approved", false);

const draftPromptBuilder: PromptBuilderHandler = ({ input }) => {
  const topic = readObjectField(input, "topic", JSON.stringify(input));
  return `Write a draft from the workflow plan for: ${topic}`;
};

export const workflowFixtureProviders: WorkflowProviders = {
  profiles: {
    "pibo-agent": {
      tools: ["read", "bash", "edit", "write"],
      skills: [],
      contextFiles: [],
    },
  },
  handlers: {
    [workflowFixtureRegistryRefs.handlers.makePlan]: makePlanHandler,
    [workflowFixtureRegistryRefs.handlers.reviseDraft]: reviseDraftHandler,
    [workflowFixtureRegistryRefs.handlers.summarizeDecision]: summarizeDecisionHandler,
  },
  adapters: {
    [workflowFixtureRegistryRefs.adapters.textToTopic]: textToTopicAdapter,
    [workflowFixtureRegistryRefs.adapters.draftToSummary]: draftToSummaryAdapter,
    [workflowFixtureRegistryRefs.adapters.decisionToSummary]: decisionToSummaryAdapter,
  },
  guards: {
    [workflowFixtureRegistryRefs.guards.approved]: approvedGuard,
    [workflowFixtureRegistryRefs.guards.needsRevision]: needsRevisionGuard,
  },
  promptBuilders: {
    [workflowFixtureRegistryRefs.promptBuilders.draftPrompt]: draftPromptBuilder,
  },
  humanActions: makeHumanActionDefinitions(),
};

export const workflowFixtureSetupOptions: WorkflowSetupOptions = {
  profiles: workflowFixtureProviders.profiles,
  handlers: workflowFixtureProviders.handlers,
  adapters: workflowFixtureProviders.adapters,
  guards: workflowFixtureProviders.guards,
  promptBuilders: workflowFixtureProviders.promptBuilders,
  humanActions: workflowFixtureProviders.humanActions,
  metadata: {
    tags: ["fixture", "registry"],
  },
};

function makeHumanActionDefinitions(): Record<string, WorkflowHumanActionDefinition> {
  return {
    [workflowFixtureRegistryRefs.humanActions.approve]: {
      id: workflowFixtureRegistryRefs.humanActions.approve,
      kind: "approve",
      title: "Approve",
      output: reviewDecisionPortJson,
    },
    [workflowFixtureRegistryRefs.humanActions.reject]: {
      id: workflowFixtureRegistryRefs.humanActions.reject,
      kind: "reject",
      title: "Reject",
      output: reviewDecisionPortJson,
    },
    [workflowFixtureRegistryRefs.humanActions.resume]: {
      id: workflowFixtureRegistryRefs.humanActions.resume,
      kind: "resume",
      title: "Resume with decision",
      input: reviewDecisionPortJson,
      output: reviewDecisionPortJson,
    },
    [workflowFixtureRegistryRefs.humanActions.cancel]: {
      id: workflowFixtureRegistryRefs.humanActions.cancel,
      kind: "cancel",
      title: "Cancel workflow",
    },
  };
}

function readObjectField(value: unknown, key: string, fallback: string): string {
  if (!isJsonObject(value)) {
    return fallback;
  }

  const field = value[key];
  return typeof field === "string" ? field : fallback;
}

function readBooleanField(value: unknown, key: string, fallback: boolean): boolean {
  if (!isJsonObject(value)) {
    return fallback;
  }

  const field = value[key];
  return typeof field === "boolean" ? field : fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
