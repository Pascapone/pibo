import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  requiredWorkflowFixtures,
  validateNodeOutput,
  validateWorkflow,
  validateWorkflowInput,
  validateWorkflowOutput,
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
          transform: "fixture.adapters.answerToNext",
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
