import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adapterRef,
  adapterWorkflowFixture,
  createWorkflowRegistry,
  hasWorkflowAdapter,
  hasWorkflowAgentProfile,
  hasWorkflowHumanAction,
  hasWorkflowPromptBuilder,
  humanWaitWorkflowFixture,
  mixedNodeWorkflowFixture,
  promptBuilderRef,
  registerWorkflowAdapter,
  registerWorkflowAgentProfile,
  registerWorkflowHumanAction,
  registerWorkflowPromptBuilder,
  resolveWorkflowAdapter,
  resolveWorkflowAgentProfile,
  resolveWorkflowHumanAction,
  resolveWorkflowPromptBuilder,
  validateWorkflow,
  workflowFixtureProviders,
  workflowFixtureRegistryRefs,
} from "../index.js";
import type { AdapterHandler, PromptBuilderHandler, WorkflowDefinition } from "../index.js";

describe("workflow registry adapter resolution", () => {
  it("registers and resolves Agent Designer profiles by fixed profile id", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(hasWorkflowAgentProfile(registry, "pibo-agent"), true);
    assert.deepEqual(resolveWorkflowAgentProfile(registry, "pibo-agent")?.value.tools, ["read", "bash", "edit", "write"]);

    registerWorkflowAgentProfile(registry, "fixture.agent.custom", { skills: ["custom-skill"] });
    assert.deepEqual(resolveWorkflowAgentProfile(registry, "fixture.agent.custom")?.value.skills, ["custom-skill"]);
  });

  it("registers and resolves deterministic TypeScript adapters by adapter ref", async () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const ref = adapterRef(workflowFixtureRegistryRefs.adapters.textToTopic);

    assert.equal(hasWorkflowAdapter(registry, ref), true);

    const entry = resolveWorkflowAdapter(registry, ref);
    assert.ok(entry);
    assert.equal(entry.id, workflowFixtureRegistryRefs.adapters.textToTopic);

    const result = await entry.value({ input: "Registry adapters" });
    assert.deepEqual(result.output, { topic: "Registry adapters" });
  });

  it("stores registry entry paramsSchema metadata for picker-driven params editors", () => {
    const registry = createWorkflowRegistry();
    const adapter: AdapterHandler = ({ input }) => ({ output: input });
    const paramsSchema = {
      type: "object" as const,
      properties: {
        format: { type: "string" as const },
      },
      required: ["format"],
      additionalProperties: false as const,
    };

    const entry = registerWorkflowAdapter(registry, "fixture.adapters.withParams", adapter, { paramsSchema });

    assert.deepEqual(entry.paramsSchema, paramsSchema);
    assert.deepEqual(resolveWorkflowAdapter(registry, "fixture.adapters.withParams")?.paramsSchema, paramsSchema);
  });

  it("rejects duplicate adapter registrations unless override is explicit", () => {
    const registry = createWorkflowRegistry();
    const first: AdapterHandler = ({ input }) => ({ output: String(input) });
    const second: AdapterHandler = ({ input }) => ({ output: `override:${String(input)}` });

    registerWorkflowAdapter(registry, "fixture.adapters.duplicate", first);
    assert.throws(
      () => registerWorkflowAdapter(registry, "fixture.adapters.duplicate", second),
      /already registered/,
    );

    const entry = registerWorkflowAdapter(registry, "fixture.adapters.duplicate", second, { override: true });
    assert.equal(entry.value, second);
    assert.equal(resolveWorkflowAdapter(registry, "fixture.adapters.duplicate")?.value, second);
  });

  it("registers and resolves TypeScript prompt builders by prompt builder ref", async () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const ref = promptBuilderRef(workflowFixtureRegistryRefs.promptBuilders.draftPrompt);

    assert.equal(hasWorkflowPromptBuilder(registry, ref), true);

    const entry = resolveWorkflowPromptBuilder(registry, ref);
    assert.ok(entry);
    assert.equal(entry.id, workflowFixtureRegistryRefs.promptBuilders.draftPrompt);

    const result = await entry.value({
      input: { topic: "Registry prompt builders" },
      state: { global: {} },
      global: { get: () => undefined },
      local: { get: () => undefined },
      edge: { get: () => undefined, all: () => ({}) },
      node: mixedNodeWorkflowFixture.nodes.draft as Extract<WorkflowDefinition["nodes"][string], { kind: "agent" }>,
      nodeId: "draft",
    });
    assert.equal(result, "Write a draft from the workflow plan for: Registry prompt builders");
  });

  it("registers and resolves extensible human actions", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const approveId = workflowFixtureRegistryRefs.humanActions.approve;

    assert.equal(hasWorkflowHumanAction(registry, approveId), true);
    assert.equal(resolveWorkflowHumanAction(registry, approveId)?.kind, "approve");

    const custom = registerWorkflowHumanAction(registry, "fixture.humanActions.escalate", {
      id: "fixture.humanActions.escalate",
      kind: "escalate",
      title: "Escalate",
    });
    assert.equal(custom.kind, "escalate");
    assert.equal(resolveWorkflowHumanAction(registry, "fixture.humanActions.escalate")?.title, "Escalate");
  });

  it("rejects duplicate prompt builder registrations unless override is explicit", () => {
    const registry = createWorkflowRegistry();
    const first: PromptBuilderHandler = ({ input }) => `first:${String(input)}`;
    const second: PromptBuilderHandler = ({ input }) => ({ prompt: `second:${String(input)}` });

    registerWorkflowPromptBuilder(registry, "fixture.promptBuilders.duplicate", first);
    assert.throws(
      () => registerWorkflowPromptBuilder(registry, "fixture.promptBuilders.duplicate", second),
      /already registered/,
    );

    const entry = registerWorkflowPromptBuilder(registry, "fixture.promptBuilders.duplicate", second, { override: true });
    assert.equal(entry.value, second);
    assert.equal(resolveWorkflowPromptBuilder(registry, "fixture.promptBuilders.duplicate")?.value, second);
  });

  it("validates code node handler refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(adapterWorkflowFixture, { registry }).ok, true);

    const missingHandlerRegistry = createWorkflowRegistry({
      adapters: workflowFixtureProviders.adapters,
      profiles: workflowFixtureProviders.profiles,
    });
    const missingRegistryResult = validateWorkflow(adapterWorkflowFixture, { registry: missingHandlerRegistry });

    assert.equal(missingRegistryResult.ok, false);
    assert.ok(
      missingRegistryResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownHandlerRef" &&
          diagnostic.nodeId === "summarize" &&
          diagnostic.registryRef === workflowFixtureRegistryRefs.handlers.summarizeDecision &&
          diagnostic.path === "$.nodes.summarize.handler",
      ),
    );
  });

  it("validates fixed Agent Designer profile refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(adapterWorkflowFixture, { registry }).ok, true);

    const definition = structuredClone(adapterWorkflowFixture) as WorkflowDefinition;
    const collectNode = definition.nodes.collect;
    assert.equal(collectNode.kind, "agent");
    if (collectNode.kind === "agent") {
      collectNode.profile = { kind: "fixed", id: "missing-profile" };
    }

    const result = validateWorkflow(definition, { registry });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownAgentProfileRef" &&
          diagnostic.nodeId === "collect" &&
          diagnostic.path === "$.nodes.collect.profile.id",
      ),
    );
  });

  it("rejects archived Agent Designer profile refs when the Workflow Registry marks them archived", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    registerWorkflowAgentProfile(registry, "archived-agent", { status: "archived" });
    const definition = structuredClone(adapterWorkflowFixture) as WorkflowDefinition;
    const collectNode = definition.nodes.collect;
    assert.equal(collectNode.kind, "agent");
    if (collectNode.kind === "agent") {
      collectNode.profile = { kind: "fixed", id: "archived-agent" };
    }

    const result = validateWorkflow(definition, { registry });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.archivedAgentProfileRef" &&
          diagnostic.nodeId === "collect" &&
          diagnostic.registryRef === "archived-agent" &&
          diagnostic.path === "$.nodes.collect.profile.id",
      ),
    );
  });

  it("validates edge adapter refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(adapterWorkflowFixture, { registry }).ok, true);

    const missingRegistryResult = validateWorkflow(adapterWorkflowFixture, { registry: createWorkflowRegistry() });

    assert.equal(missingRegistryResult.ok, false);
    assert.ok(
      missingRegistryResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownAdapterRef" &&
          diagnostic.edgeId === "collect-to-summarize" &&
          diagnostic.path === "$.edges.collect-to-summarize.adapter.transform.id",
      ),
    );
  });

  it("validates agent prompt builder refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(mixedNodeWorkflowFixture, { registry }).ok, true);

    const missingRegistryResult = validateWorkflow(mixedNodeWorkflowFixture, { registry: createWorkflowRegistry() });

    assert.equal(missingRegistryResult.ok, false);
    assert.ok(
      missingRegistryResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownPromptBuilderRef" &&
          diagnostic.nodeId === "draft" &&
          diagnostic.path === "$.nodes.draft.promptBuilder.id",
      ),
    );
  });

  it("rejects agent nodes that declare both promptTemplate and promptBuilder", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const definition = structuredClone(mixedNodeWorkflowFixture) as WorkflowDefinition;
    const draftNode = definition.nodes.draft;
    assert.equal(draftNode.kind, "agent");
    if (draftNode.kind === "agent") {
      draftNode.promptTemplate = "Also draft {{input.topic}}";
    }

    const result = validateWorkflow(definition, { registry });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.ambiguousAgentPromptSource" && diagnostic.nodeId === "draft",
      ),
    );
  });

  it("validates human action refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(humanWaitWorkflowFixture, { registry }).ok, true);

    const missingRegistryResult = validateWorkflow(humanWaitWorkflowFixture, { registry: createWorkflowRegistry() });

    assert.equal(missingRegistryResult.ok, false);
    assert.ok(
      missingRegistryResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownHumanActionRef" &&
          diagnostic.nodeId === "review" &&
          diagnostic.path === "$.nodes.review.actions.0.id",
      ),
    );

    const mismatched = structuredClone(humanWaitWorkflowFixture) as WorkflowDefinition;
    const reviewNode = mismatched.nodes.review;
    assert.equal(reviewNode.kind, "human");
    if (reviewNode.kind === "human" && reviewNode.actions) {
      reviewNode.actions[0] = { ...reviewNode.actions[0], kind: "reject" };
    }

    const mismatchResult = validateWorkflow(mismatched, { registry });
    assert.equal(mismatchResult.ok, false);
    assert.ok(
      mismatchResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.humanActionKindMismatch" &&
          diagnostic.nodeId === "review" &&
          diagnostic.path === "$.nodes.review.actions.0.kind",
      ),
    );
  });

  it("validates visible adapter node refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);

    assert.equal(validateWorkflow(mixedNodeWorkflowFixture, { registry }).ok, true);

    const definition = structuredClone(mixedNodeWorkflowFixture) as WorkflowDefinition;
    const normalizeNode = definition.nodes.normalize;
    assert.equal(normalizeNode.kind, "adapter");
    if (normalizeNode.kind === "adapter") {
      normalizeNode.handler = adapterRef("fixture.adapters.missing");
    }

    const result = validateWorkflow(definition, { registry });

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowGraphError.unknownAdapterRef" &&
          diagnostic.nodeId === "normalize" &&
          diagnostic.path === "$.nodes.normalize.handler.id",
      ),
    );
  });
});
