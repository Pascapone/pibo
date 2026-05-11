import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adapterRef,
  boundedReviewLoopWorkflowFixture,
  createWorkflowRegistry,
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  requiredWorkflowFixtures,
  validateNodeOutput,
  validateWorkflow,
  validateWorkflowInput,
  validateWorkflowOutput,
  workflowFixtureProviders,
} from "../index.js";
import type { JsonSchema, ValidationResult, WorkflowDefinition, WorkflowDiagnostic } from "../index.js";

function diagnosticCodes(result: ValidationResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code).sort();
}

function findDiagnostic(
  result: ValidationResult,
  code: string,
  predicate: (diagnostic: WorkflowDiagnostic) => boolean = () => true,
): WorkflowDiagnostic {
  const diagnostic = result.diagnostics.find((item) => item.code === code && predicate(item));
  assert.ok(diagnostic, `expected diagnostic ${code}; got ${diagnosticCodes(result).join(", ")}`);
  return diagnostic;
}

function withDefinitionMutation(mutator: (definition: WorkflowDefinition) => void): WorkflowDefinition {
  const definition = structuredClone(minimalOneNodePiboAgentWorkflowFixture) as WorkflowDefinition;
  mutator(definition);
  return definition;
}

describe("workflow input validation", () => {
  it("accepts valid text and JSON workflow inputs", () => {
    assert.equal(validateWorkflowInput(minimalOneNodePiboAgentWorkflowFixture, "Explain workflows.").ok, true);
    assert.equal(validateWorkflowInput(mixedNodeWorkflowFixture, { topic: "Workflow validation" }).ok, true);
  });

  it("rejects non-string values for text workflow inputs", () => {
    const result = validateWorkflowInput(minimalOneNodePiboAgentWorkflowFixture, { prompt: "not text" });

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.textValueExpected", (diagnostic) => diagnostic.path === "$.input");
  });

  it("rejects JSON workflow inputs with missing, extra, or mismatched properties", () => {
    const missingResult = validateWorkflowInput(mixedNodeWorkflowFixture, {});
    const extraResult = validateWorkflowInput(mixedNodeWorkflowFixture, {
      topic: "Workflow validation",
      extra: true,
    });
    const typeResult = validateWorkflowInput(mixedNodeWorkflowFixture, { topic: 123 });

    assert.equal(missingResult.ok, false);
    findDiagnostic(missingResult, "WorkflowInterfaceError.requiredValueMissing", (diagnostic) => diagnostic.path === "$.input.topic");

    assert.equal(extraResult.ok, false);
    findDiagnostic(extraResult, "WorkflowInterfaceError.unexpectedProperty", (diagnostic) => diagnostic.path === "$.input.extra");

    assert.equal(typeResult.ok, false);
    findDiagnostic(typeResult, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.input.topic");
  });

  it("validates input enum, anyOf, arrays, and local refs", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.input = {
        kind: "json",
        schema: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["draft", "approved"] },
            assignee: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
            tags: {
              type: "array",
              items: { type: "string" },
            },
            item: { $ref: "#/$defs/Item" },
          },
          required: ["status", "assignee", "tags", "item"],
          additionalProperties: false,
          $defs: {
            Item: strictObjectSchema({ id: { type: "string" } }),
          },
        },
      };
    });

    assert.equal(
      validateWorkflowInput(definition, {
        status: "draft",
        assignee: null,
        tags: ["workflow"],
        item: { id: "item-1" },
      }).ok,
      true,
    );

    const result = validateWorkflowInput(definition, {
      status: "archived",
      assignee: 42,
      tags: ["workflow", 99],
      item: { id: 123 },
    });

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.enumMismatch", (diagnostic) => diagnostic.path === "$.input.status");
    findDiagnostic(result, "WorkflowInterfaceError.anyOfNoMatch", (diagnostic) => diagnostic.path === "$.input.assignee");
    findDiagnostic(result, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.input.tags.1");
    findDiagnostic(result, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.input.item.id");
  });
});

describe("workflow output validation", () => {
  it("accepts valid text and JSON workflow outputs", () => {
    assert.equal(validateWorkflowOutput(minimalOneNodePiboAgentWorkflowFixture, "Done.").ok, true);
    assert.equal(
      validateWorkflowOutput(mixedNodeWorkflowFixture, {
        summary: "Workflow validation is complete.",
        status: "approved",
      }).ok,
      true,
    );
  });

  it("rejects invalid workflow outputs before completion", () => {
    const textResult = validateWorkflowOutput(minimalOneNodePiboAgentWorkflowFixture, { answer: "not text" });
    const jsonResult = validateWorkflowOutput(mixedNodeWorkflowFixture, {
      summary: "Workflow validation is complete.",
      status: "archived",
    });

    assert.equal(textResult.ok, false);
    findDiagnostic(textResult, "WorkflowInterfaceError.textValueExpected", (diagnostic) => diagnostic.path === "$.output");

    assert.equal(jsonResult.ok, false);
    findDiagnostic(jsonResult, "WorkflowInterfaceError.enumMismatch", (diagnostic) => diagnostic.path === "$.output.status");
  });
});

describe("node output validation", () => {
  it("accepts valid declared node outputs", () => {
    assert.equal(
      validateNodeOutput(mixedNodeWorkflowFixture, "plan", {
        steps: [{ title: "Validate output", done: false }],
      }).ok,
      true,
    );
  });

  it("rejects invalid declared node outputs before downstream use", () => {
    const result = validateNodeOutput(mixedNodeWorkflowFixture, "plan", {
      steps: [{ title: "Validate output", done: "no" }],
    });

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.valueTypeMismatch",
      (diagnostic) => diagnostic.nodeId === "plan" && diagnostic.path === "$.nodes.plan.output.steps.0.done",
    );
  });

  it("reports unknown nodes when validating node output", () => {
    const result = validateNodeOutput(mixedNodeWorkflowFixture, "missing", "anything");

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unknownNode",
      (diagnostic) => diagnostic.nodeId === "missing" && diagnostic.path === "$.nodes.missing",
    );
  });
});

describe("workflow definition validation", () => {
  it("accepts the required workflow fixtures", () => {
    for (const fixture of requiredWorkflowFixtures) {
      const result = validateWorkflow(fixture);
      assert.equal(result.ok, true, `${fixture.id} should validate: ${diagnosticCodes(result).join(", ")}`);
    }
  });

  it("accepts bounded review-loop back-edges and registered guard refs", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const result = validateWorkflow(boundedReviewLoopWorkflowFixture, { registry });

    assert.equal(result.ok, true, diagnosticCodes(result).join(", "));
  });

  it("rejects invalid retry policies without positive maxAttempts", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.retry = {
        maxAttempts: 0,
        backoff: { kind: "fixed", delayMs: -1 },
        retryOn: ["WorkflowRuntimeError.timeout", ""],
      };
      draft.nodes.answer.retry = {
        maxAttempts: 1.5,
        backoff: { kind: "exponential", initialMs: 100, factor: 1 },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowRetryError.invalidMaxAttempts", (diagnostic) => diagnostic.path === "$.retry.maxAttempts");
    findDiagnostic(result, "WorkflowRetryError.invalidBackoffPolicy", (diagnostic) => diagnostic.path === "$.retry.backoff.delayMs");
    findDiagnostic(result, "WorkflowRetryError.invalidRetryOn", (diagnostic) => diagnostic.path === "$.retry.retryOn.1");
    findDiagnostic(result, "WorkflowRetryError.invalidMaxAttempts", (diagnostic) => diagnostic.path === "$.nodes.answer.retry.maxAttempts");
    findDiagnostic(result, "WorkflowRetryError.invalidBackoffPolicy", (diagnostic) => diagnostic.path === "$.nodes.answer.retry.backoff.factor");
  });

  it("rejects loop policies without an existing guarded back-edge and maxAttempts", () => {
    const definition = structuredClone(boundedReviewLoopWorkflowFixture) as WorkflowDefinition;
    definition.loops = [
      { edgeId: "missing-edge", maxAttempts: 0 },
      { edgeId: "draft-to-review", maxAttempts: 2 },
    ];

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowGraphError.unknownLoopEdge", (diagnostic) => diagnostic.path === "$.loops.0.edgeId");
    findDiagnostic(result, "WorkflowRetryError.invalidMaxAttempts", (diagnostic) => diagnostic.path === "$.loops.0.maxAttempts");
    findDiagnostic(result, "WorkflowGraphError.unboundedBackEdge", (diagnostic) => diagnostic.path === "$.loops.1");
  });

  it("validates loop and edge guard refs against the Workflow Registry when one is provided", () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const definition = structuredClone(boundedReviewLoopWorkflowFixture) as WorkflowDefinition;
    assert.equal(definition.loops?.[0]?.guard?.handler !== undefined, true);
    if (definition.loops?.[0]?.guard) {
      definition.loops[0].guard.handler = "fixture.guards.missing";
    }

    const result = validateWorkflow(definition, { registry });

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowGraphError.unknownGuardRef", (diagnostic) => diagnostic.path === "$.loops.0.guard.handler");
  });

  it("rejects agent nodes that do not select the V1 Pibo Runtime", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer = {
        ...draft.nodes.answer,
        runtime: "other-runtime",
      } as unknown as WorkflowDefinition["nodes"][string];
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.invalidAgentRuntimeSelection",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.runtime",
    );
  });

  it("rejects agent nodes without a fixed Agent Designer profile selection", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer = {
        ...draft.nodes.answer,
        profile: { kind: "dynamic", id: "pibo-agent" },
      } as unknown as WorkflowDefinition["nodes"][string];
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.invalidAgentProfileSelection",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.profile",
    );
  });

  it("rejects JSON workflow ports with non-object roots", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.input = {
        kind: "json",
        schema: { type: "string" },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.rootMustBeObject", (diagnostic) => diagnostic.path === "$.input.schema.type");
  });

  it("rejects root anyOf schemas for workflow ports", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.output = {
        kind: "json",
        schema: {
          anyOf: [
            {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          ],
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.rootAnyOf", (diagnostic) => diagnostic.path === "$.output.schema.anyOf");
  });

  it("rejects object schemas that are not strict Structured Outputs objects", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer.output = {
        kind: "json",
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["answer"],
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.objectAdditionalProperties",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.output.schema.additionalProperties",
    );
    findDiagnostic(
      result,
      "WorkflowInterfaceError.objectPropertyNotRequired",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.output.schema.required",
    );
  });

  it("rejects malformed human response schemas", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer = {
        kind: "human",
        prompt: "Choose the next step.",
        schema: {
          type: "object",
          properties: {
            decision: {
              oneOf: [{ type: "string", enum: ["approve", "reject"] }],
            },
          },
          required: ["decision"],
          additionalProperties: false,
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unsupportedOneOf",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.schema.properties.decision.oneOf",
    );
  });

  it("accepts scoped node state read/write declarations", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.state = {
        global: {
          projectGoal: { schema: { type: "string" } },
          summary: { schema: { type: "string" } },
        },
      };
      draft.nodes.answer.state = {
        reads: ["global.projectGoal", "local.previousDraft", "edge.answer-to-next"],
        writes: ["global.summary", "local.lastSummary"],
      };
    });

    assert.equal(validateWorkflow(definition).ok, true);
  });

  it("rejects invalid node state declarations", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.state = {
        global: {
          projectGoal: { schema: { type: "string" } },
        },
      };
      draft.nodes.answer.state = {
        reads: ["global.missing", "unknown.projectGoal" as `global.${string}`, "local.", 42 as unknown as `global.${string}`],
        writes: ["edge.answer-to-next", "global.summary"],
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowStateError.unknownGlobalStatePath",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.state.reads.0",
    );
    findDiagnostic(
      result,
      "WorkflowStateError.invalidStatePath",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.state.reads.1",
    );
    findDiagnostic(
      result,
      "WorkflowStateError.invalidStateAccessDeclaration",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.state.reads.3",
    );
    findDiagnostic(
      result,
      "WorkflowStateError.edgeStateWriteNotAllowed",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.state.writes.0",
    );
    findDiagnostic(
      result,
      "WorkflowStateError.unknownGlobalStatePath",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.state.writes.1",
    );
  });

  it("rejects ambiguous concurrent global state writes without a merge policy", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.state = {
        global: {
          summary: { schema: { type: "string" } },
        },
      };
      draft.nodes.answer.state = {
        writes: ["global.summary"],
      };
      draft.nodes.secondWriter = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.secondWriter",
        output: { kind: "text" },
        state: {
          writes: ["global.summary"],
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowStateError.ambiguousConcurrentGlobalStateWrite",
      (diagnostic) => diagnostic.path === "$.state.global.summary",
    );
  });

  it("accepts multiple global state writers when an explicit merge policy is declared", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.state = {
        global: {
          findings: {
            schema: { type: "array", items: { type: "string" } },
            merge: { kind: "append" },
          },
        },
      };
      draft.nodes.answer.state = {
        writes: ["global.findings"],
      };
      draft.nodes.secondWriter = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.secondWriter",
        output: { kind: "text" },
        state: {
          writes: ["global.findings"],
        },
      };
    });

    assert.equal(validateWorkflow(definition).ok, true);
  });

  it("rejects edges that reference missing source or target nodes", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.edges["missing-links"] = {
        id: "missing-links",
        from: { nodeId: "missing-source" },
        to: { nodeId: "missing-target" },
        kind: "data",
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.unknownSourceNode",
      (diagnostic) =>
        diagnostic.edgeId === "missing-links" &&
        diagnostic.nodeId === "missing-source" &&
        diagnostic.path === "$.edges.missing-links.from.nodeId",
    );
    findDiagnostic(
      result,
      "WorkflowGraphError.unknownTargetNode",
      (diagnostic) =>
        diagnostic.edgeId === "missing-links" &&
        diagnostic.nodeId === "missing-target" &&
        diagnostic.path === "$.edges.missing-links.to.nodeId",
    );
  });

  it("accepts direct edges with compatible source output and target input ports", () => {
    const definition = withDefinitionMutation((draft) => {
      const payloadSchema = strictObjectSchema({ value: { type: "string" } });
      draft.nodes.answer.output = { kind: "json", schema: payloadSchema };
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: structuredClone(payloadSchema) as JsonSchema },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
      };
    });

    assert.equal(validateWorkflow(definition).ok, true);
  });

  it("rejects direct edges with incompatible source output and target input ports", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: strictObjectSchema({ value: { type: "string" } }) },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.incompatibleEdgePorts",
      (diagnostic) => diagnostic.edgeId === "answer-to-next" && diagnostic.path === "$.edges.answer-to-next",
    );
  });

  it("rejects direct JSON edges when schema compatibility cannot be proven", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.answer.output = { kind: "json", schema: strictObjectSchema({ value: { type: "number" } }) };
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: strictObjectSchema({ value: { type: "string" } }) },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowGraphError.incompatibleEdgePorts", (diagnostic) => diagnostic.edgeId === "answer-to-next");
  });

  it("accepts incompatible source and target ports when an edge uses a registered adapter ref whose output matches the target", () => {
    const targetSchema = strictObjectSchema({ value: { type: "string" } });
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: targetSchema },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
        adapter: {
          kind: "edgeAdapter",
          transform: adapterRef("fixture.adapters.answerToNext"),
          output: { kind: "json", schema: structuredClone(targetSchema) as JsonSchema },
        },
      };
    });

    assert.equal(validateWorkflow(definition).ok, true);
  });

  it("rejects edge adapters that do not use registered TypeScript adapter refs", () => {
    const targetSchema = strictObjectSchema({ value: { type: "string" } });
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: targetSchema },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
        adapter: {
          kind: "edgeAdapter",
          transform: "fixture.adapters.answerToNext" as unknown as ReturnType<typeof adapterRef>,
          output: { kind: "json", schema: structuredClone(targetSchema) as JsonSchema },
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.invalidAdapterRef",
      (diagnostic) => diagnostic.edgeId === "answer-to-next" && diagnostic.path === "$.edges.answer-to-next.adapter.transform",
    );
  });

  it("rejects edge adapters whose declared output does not match the target input", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: strictObjectSchema({ value: { type: "string" } }) },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        kind: "data",
        adapter: {
          kind: "edgeAdapter",
          transform: adapterRef("fixture.adapters.answerToNext"),
          output: { kind: "text" },
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowGraphError.incompatibleEdgeAdapterOutput",
      (diagnostic) => diagnostic.edgeId === "answer-to-next" && diagnostic.path === "$.edges.answer-to-next.adapter.output",
    );
  });

  it("rejects malformed edge adapter output schemas", () => {
    const definition = withDefinitionMutation((draft) => {
      draft.nodes.next = {
        kind: "code",
        language: "typescript",
        handler: "fixture.handlers.next",
        input: { kind: "json", schema: strictObjectSchema({ value: { type: "string" } }) },
        output: { kind: "text" },
      };
      draft.edges["answer-to-next"] = {
        id: "answer-to-next",
        from: { nodeId: "answer" },
        to: { nodeId: "next" },
        adapter: {
          kind: "edgeAdapter",
          transform: adapterRef("fixture.adapters.answerToNext"),
          output: {
            kind: "json",
            schema: {
              $ref: "#/$defs/Missing",
            },
          },
        },
      };
    });

    const result = validateWorkflow(definition);

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unresolvedRef",
      (diagnostic) => diagnostic.edgeId === "answer-to-next" && diagnostic.path === "$.edges.answer-to-next.adapter.output.schema.$ref",
    );
  });
});

function strictObjectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
