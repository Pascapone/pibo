import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimalOneNodePiboAgentWorkflowFixture,
  mixedNodeWorkflowFixture,
  validateNodeOutput,
  validateWorkflowInput,
  validateWorkflowOutput,
  validateWorkflowPortValue,
} from "../index.js";
import type { JsonSchema, ValidationResult, WorkflowDiagnostic, WorkflowPort } from "../index.js";

function findDiagnostic(
  result: ValidationResult,
  code: string,
  predicate: (diagnostic: WorkflowDiagnostic) => boolean = () => true,
): WorkflowDiagnostic {
  const diagnostic = result.diagnostics.find((item) => item.code === code && predicate(item));
  assert.ok(
    diagnostic,
    `expected diagnostic ${code}; got ${result.diagnostics.map((item) => item.code).join(", ")}`,
  );
  return diagnostic;
}

describe("workflow interface text/JSON value tests", () => {
  it("accepts valid text values and rejects non-strings at workflow and node output boundaries", () => {
    const textPort: WorkflowPort = { kind: "text" };

    assert.equal(validateWorkflowPortValue(textPort, "plain text").ok, true);
    assert.equal(validateWorkflowInput(minimalOneNodePiboAgentWorkflowFixture, "Explain the workflow.").ok, true);
    assert.equal(validateWorkflowOutput(minimalOneNodePiboAgentWorkflowFixture, "Workflow complete.").ok, true);
    assert.equal(validateNodeOutput(minimalOneNodePiboAgentWorkflowFixture, "answer", "Node complete.").ok, true);

    const inputResult = validateWorkflowInput(minimalOneNodePiboAgentWorkflowFixture, { prompt: "not text" });
    const outputResult = validateWorkflowOutput(minimalOneNodePiboAgentWorkflowFixture, ["not", "text"]);
    const nodeResult = validateNodeOutput(minimalOneNodePiboAgentWorkflowFixture, "answer", null);

    assert.equal(inputResult.ok, false);
    findDiagnostic(inputResult, "WorkflowInterfaceError.textValueExpected", (diagnostic) => diagnostic.path === "$.input");

    assert.equal(outputResult.ok, false);
    findDiagnostic(outputResult, "WorkflowInterfaceError.textValueExpected", (diagnostic) => diagnostic.path === "$.output");

    assert.equal(nodeResult.ok, false);
    findDiagnostic(
      nodeResult,
      "WorkflowInterfaceError.textValueExpected",
      (diagnostic) => diagnostic.nodeId === "answer" && diagnostic.path === "$.nodes.answer.output",
    );
  });

  it("accepts valid JSON workflow values and rejects text or malformed objects for JSON ports", () => {
    assert.equal(validateWorkflowInput(mixedNodeWorkflowFixture, { topic: "Typed interfaces" }).ok, true);
    assert.equal(
      validateWorkflowOutput(mixedNodeWorkflowFixture, {
        summary: "Typed interface tests passed.",
        status: "approved",
      }).ok,
      true,
    );

    const textToJsonResult = validateWorkflowInput(mixedNodeWorkflowFixture, "Typed interfaces");
    const missingResult = validateWorkflowInput(mixedNodeWorkflowFixture, {});
    const extraResult = validateWorkflowInput(mixedNodeWorkflowFixture, {
      topic: "Typed interfaces",
      unexpected: true,
    });
    const outputResult = validateWorkflowOutput(mixedNodeWorkflowFixture, {
      summary: "Typed interface tests passed.",
      status: "archived",
    });

    assert.equal(textToJsonResult.ok, false);
    findDiagnostic(textToJsonResult, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.input");

    assert.equal(missingResult.ok, false);
    findDiagnostic(missingResult, "WorkflowInterfaceError.requiredValueMissing", (diagnostic) => diagnostic.path === "$.input.topic");

    assert.equal(extraResult.ok, false);
    findDiagnostic(extraResult, "WorkflowInterfaceError.unexpectedProperty", (diagnostic) => diagnostic.path === "$.input.unexpected");

    assert.equal(outputResult.ok, false);
    findDiagnostic(outputResult, "WorkflowInterfaceError.enumMismatch", (diagnostic) => diagnostic.path === "$.output.status");
  });

  it("accepts valid JSON node outputs and rejects nested invalid node output values before downstream use", () => {
    assert.equal(
      validateNodeOutput(mixedNodeWorkflowFixture, "plan", {
        steps: [
          { title: "Check text input", done: true },
          { title: "Check JSON output", done: false },
        ],
      }).ok,
      true,
    );

    const result = validateNodeOutput(mixedNodeWorkflowFixture, "plan", {
      steps: [
        { title: "Check text input", done: "yes" },
        { done: false, extra: "field" },
      ],
    });

    assert.equal(result.ok, false);
    findDiagnostic(
      result,
      "WorkflowInterfaceError.valueTypeMismatch",
      (diagnostic) => diagnostic.nodeId === "plan" && diagnostic.path === "$.nodes.plan.output.steps.0.done",
    );
    findDiagnostic(
      result,
      "WorkflowInterfaceError.requiredValueMissing",
      (diagnostic) => diagnostic.nodeId === "plan" && diagnostic.path === "$.nodes.plan.output.steps.1.title",
    );
    findDiagnostic(
      result,
      "WorkflowInterfaceError.unexpectedProperty",
      (diagnostic) => diagnostic.nodeId === "plan" && diagnostic.path === "$.nodes.plan.output.steps.1.extra",
    );
  });

  it("validates direct JSON port outputs with arrays, const values, nullable unions, and integer fields", () => {
    const jsonPort: WorkflowPort = {
      kind: "json",
      schema: strictObjectSchema({
        items: {
          type: "array",
          items: strictObjectSchema({
            id: { type: "integer" },
            kind: { type: "string", const: "task" },
            note: { type: ["string", "null"] },
          }),
        },
      }),
    };

    assert.equal(
      validateWorkflowPortValue(jsonPort, {
        items: [
          { id: 1, kind: "task", note: "ready" },
          { id: 2, kind: "task", note: null },
        ],
      }).ok,
      true,
    );

    const result = validateWorkflowPortValue(
      jsonPort,
      {
        items: [{ id: 1.5, kind: "note", note: false }],
      },
      { path: "$.adapter.output" },
    );

    assert.equal(result.ok, false);
    findDiagnostic(result, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.adapter.output.items.0.id");
    findDiagnostic(result, "WorkflowInterfaceError.constMismatch", (diagnostic) => diagnostic.path === "$.adapter.output.items.0.kind");
    findDiagnostic(result, "WorkflowInterfaceError.valueTypeMismatch", (diagnostic) => diagnostic.path === "$.adapter.output.items.0.note");
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
