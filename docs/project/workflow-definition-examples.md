---
type: "Reference"
title: "Minimal Workflow Definition Examples"
description: "Provides current minimal Pibo workflow-definition examples and authoring checks."
tags: ["examples", "reference", "workflows"]
status: "draft"
authority: "informative"
migration_lineage:
  source_path: "docs/project/workflow-definition-examples.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "e7318859b181e8f8a09b02fe0a50eb93b39998f9"
  source_bytes: 5877
  source_sha256: "6ca827c01ac3ff17605b67030f84c1d3cd694d9fa7af48880b3e412f91d4c938"
  source_body_sha256: "6ca827c01ac3ff17605b67030f84c1d3cd694d9fa7af48880b3e412f91d4c938"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-08-31T22:47:46Z"
---
# Minimal Workflow Definition Examples

This document shows small TypeScript-managed workflow definitions for Pibo Workflow System V1. The examples use the public `@pasko70/pibo-workflows` package surface and keep executable code behind Workflow Registry refs so definitions remain serializable.

For the overall workflow capability contract, see `docs/project/workflows.md`.

## Minimal text-to-text Pibo agent

Use this shape when a workflow is a repeatable wrapper around one normal Pibo Runtime-backed Agent Designer profile.

```ts
import { fixedProfile, text, validateWorkflow, type WorkflowDefinition } from "@pasko70/pibo-workflows";

export const answerQuestionWorkflow = {
  id: "example.answer-question",
  version: "1.0.0",
  title: "Answer question",
  input: text("User request."),
  output: text("Assistant answer."),
  initial: "answer",
  final: "answer",
  nodes: {
    answer: {
      kind: "agent",
      runtime: "pibo",
      profile: fixedProfile("pibo-agent"),
      input: text("User request."),
      output: text("Assistant answer."),
      promptTemplate: "Answer this request clearly: {{input}}",
    },
  },
  edges: {},
} satisfies WorkflowDefinition;

const validation = validateWorkflow(answerQuestionWorkflow);
if (!validation.ok) {
  throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
}
```

Notes:

- Agent nodes must use `runtime: "pibo"` and a fixed Agent Designer profile.
- The one-node case uses the same node as `initial` and `final`.
- `promptTemplate` can reference `{{input}}`; richer state-backed prompts should use documented prompt-builder refs.

## Minimal JSON code-node workflow

Use this shape when trusted TypeScript code performs deterministic work. The definition stores only the handler id; the actual function is registered in the Workflow Registry.

```ts
import {
  createWorkflowRegistry,
  json,
  registerWorkflowHandler,
  validateWorkflow,
  type WorkflowDefinition,
} from "@pasko70/pibo-workflows";

const topicPort = json(
  {
    type: "object",
    properties: {
      topic: { type: "string" },
    },
    required: ["topic"],
    additionalProperties: false,
  },
  "Topic payload.",
);

const summaryPort = json(
  {
    type: "object",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  },
  "Summary payload.",
);

export const summarizeTopicWorkflow = {
  id: "example.summarize-topic",
  version: "1.0.0",
  title: "Summarize topic",
  input: topicPort,
  output: summaryPort,
  initial: "summarize",
  final: "summarize",
  nodes: {
    summarize: {
      kind: "code",
      language: "typescript",
      handler: "example.handlers.summarizeTopic",
      input: topicPort,
      output: summaryPort,
    },
  },
  edges: {},
} satisfies WorkflowDefinition;

const registry = createWorkflowRegistry();
registerWorkflowHandler(registry, "example.handlers.summarizeTopic", async ({ input }) => {
  const topic = typeof input === "object" && input !== null && !Array.isArray(input) ? String(input.topic ?? "") : "";
  return { output: { summary: `Summary for ${topic}` } };
});

const validation = validateWorkflow(summarizeTopicWorkflow, { registry });
if (!validation.ok) {
  throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
}
```

Notes:

- JSON ports must use the supported V1 Structured Outputs subset: object roots, complete `required`, and `additionalProperties: false` on objects.
- Handler ids should be stable, namespaced strings because they are persisted in workflow definitions and run facts.
- Register handler implementations separately from the definition object.

## Minimal human wait workflow

Use this shape when a workflow must pause for a durable human decision. Human actions are registry-backed refs, and the wait response is validated against the declared output/schema before resume.

```ts
import { json, type WorkflowDefinition } from "@pasko70/pibo-workflows";

const draftPort = json({
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
  additionalProperties: false,
});

const decisionPort = json({
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
});

export const reviewDraftWorkflow = {
  id: "example.review-draft",
  version: "1.0.0",
  title: "Review draft",
  input: draftPort,
  output: decisionPort,
  initial: "review",
  final: "review",
  nodes: {
    review: {
      kind: "human",
      prompt: "Review the draft and approve or reject it.",
      input: draftPort,
      output: decisionPort,
      schema: decisionPort.schema,
      actions: [
        { id: "example.humanActions.approve", kind: "approve" },
        { id: "example.humanActions.reject", kind: "reject" },
      ],
      timeout: { kind: "minutes", value: 60 },
    },
  },
  edges: {},
} satisfies WorkflowDefinition;
```

Notes:

- Human nodes create wait tokens; do not model approval as a hidden agent/tool side effect.
- Register human actions in the Workflow Registry before using registry-backed validation or runtime dispatch.
- Keep the response schema aligned with the node output port so resumed waits can become normal workflow output.

## Checklist for minimal definitions

- Define stable `id` and `version` values.
- Declare workflow-level `input` and `output` ports.
- Set `initial` and `final` to valid node ids.
- Keep `nodes` and `edges` serializable; executable behavior belongs in the registry.
- Validate the definition with `validateWorkflow(...)`, passing a registry when refs should be resolved.
- Add tests under `packages/workflows/src/testing` when examples become fixtures or runtime coverage.
