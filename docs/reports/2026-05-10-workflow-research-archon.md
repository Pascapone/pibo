---
type: "Research"
title: "Archon-Recherchebericht für Pibo Workflow System V1"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/2026-05-10-workflow-research-archon.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "c76588e78c56320cd7846735c1683f76815de485"
  source_bytes: 33834
  source_sha256: "a0ad077bfeec95865218b8b66422b622cc72d77abf766a8e67745063810f47bc"
  source_body_sha256: "a0ad077bfeec95865218b8b66422b622cc72d77abf766a8e67745063810f47bc"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Archon-Recherchebericht für Pibo Workflow System V1

**Datum:** 2026-05-10  
**Projekt:** `/root/code/Archon`  
**Quelle:** `https://github.com/coleam00/Archon`  
**Ziel der Analyse:** Prüfen, welche Konzepte, Coding Patterns und Systembausteine für Pibos eigenes Workflow Framework nützlich sind.

## Executive Summary

Archon ist für Pibo hoch relevant. Es ist kein generisches Graph-Framework wie Graphology/Graphlib und auch kein Statechart-System wie XState. Archon ist ein praktisches, produktnahes **AI-Coding-Workflow-System** mit YAML-DAGs, Agent-/Command-Nodes, Bash-/Script-Nodes, Loop-Nodes, Approval-Gates, Provider-Abstraktion, Worktree-Isolation, Persistenz, Events, Web/Chat/CLI-Adaptern und Skill-Dokumentation für Agenten.

Die stärkste Idee für Pibo ist Archons Produktform: **Workflows als repo-lokale, agentenlesbare Dateien**, kombiniert mit einer Engine, die deterministische Struktur vorgibt und Agenten nur dort einsetzt, wo sie Mehrwert bringen. Genau das passt zu unserem Ziel: ein leicht nutzbares Workflow Framework, dessen Komplexität hinter sauberen Interfaces verschwindet.

Archon sollte aber nicht 1:1 kopiert werden. Archons aktuelles Workflow-Modell ist stark YAML-/DAG-/Claude-/CLI-geprägt. Pibo will ein eigenes IR mit Ports, JSON Schema, Adapter-Layern, Pibo Runtime Agent Nodes, TypeScript Code Nodes, global/local state, edge payloads, XState-Projektion und durable kernel. Archon liefert dafür viele konkrete Produktpatterns, aber nicht den endgültigen Kern.

Wichtigste Übernahmekandidaten:

1. Workflow-Dateien als agentenlesbare Authoring-Oberfläche.
2. Strikte Zod-Validierung mit klaren Fehlermeldungen.
3. Flache Node-Definitionen mit mutually-exclusive Node-Modi.
4. Topological layers + `Promise.allSettled` für einfache DAG-Parallelität.
5. `trigger_rule`-Semantik für Fan-in.
6. `when:`-Bedingungen als kleine, fail-closed DSL.
7. Approval Gates und interactive loops als Produktprimitiven.
8. Worktree-/Isolation-Layer als Workflow-Runtime-Umgebung.
9. Provider Registry mit Capability Flags.
10. Event-Emitter + DB-Events für UI/Observability.
11. Skill-/Docs-System, das Agenten progressive Anleitungen gibt.
12. Narrow trait interfaces zwischen Workflow Engine und DB/Core.

Wichtigste Warnungen:

- YAML-DAGs ohne explizite Ports/Edges reichen für Pibo nicht.
- Stringbasierte `$node.output`-Substitution ist praktisch, aber für Pibo V1 zu schwach als Haupt-Datenflussmodell.
- Resume über `node_completed`-Events ist nützlich, aber Pibo braucht stärkere NodeAttempt-/Checkpoint-Semantik.
- Approval-Resume über Statuswechsel `paused -> failed -> resume` ist pragmatisch, aber semantisch unsauber für unser Durable Kernel Design.
- Eine große `dag-executor.ts`-Datei zeigt, dass Pibo früh stärker in Validator, Planner, Executors, State, Events und Durable Kernel aufteilen sollte.

## Projektüberblick

### Top-Level-Struktur

Wichtige Pfade:

- `README.md` – Produktpositionierung: AI-Coding-Workflow-Engine.
- `packages/workflows/` – Workflow Loader, Schemas, Executor, DAG Engine, Events, Conditions.
- `packages/core/` – DB, Orchestrator, Config, Workflow Store Adapter, Operations.
- `packages/providers/` – Provider Registry und Provider für Claude, Codex, Pi.
- `packages/isolation/` – Worktree-/Isolation-Abstraktion.
- `packages/git/` – Git-Operationen und Worktree-Helfer.
- `packages/cli/` – CLI für Workflow-Ausführung, Status, Resume, Approval, Isolation.
- `packages/server/` und `packages/web/` – Web/API/UI-Schicht.
- `.archon/workflows/` – Default-, Maintainer-, Experimental- und Test-Workflows.
- `.archon/commands/` – wiederverwendbare Command-Prompts.
- `.claude/skills/archon/` – Skill-Dokumentation, Guides und Referenzen für Agenten.
- `migrations/` – DB-Schema für Workflow Runs, Events, Sessions, Background Dispatch usw.

### Monorepo und Tooling

Root `package.json`:

- Bun Workspaces über `packages/*`.
- TypeScript, ESLint, Prettier, Vitest.
- `bun --filter '*'` für Build/Test/Typecheck.
- `validate` kombiniert Bundled Checks, Typecheck, Lint, Format und Tests.

Für Pibo relevant: Archon trennt Pakete entlang Produktgrenzen: workflows, core, providers, isolation, git, CLI, server, web. Das ist ein gutes Vorbild. Unser Workflow Framework sollte ebenfalls nicht als ein großer Ordner entstehen.

## Architektur und Modulstruktur

### Workflow Engine

`packages/workflows` enthält den Kern:

- `src/loader.ts` – YAML parsing, Zod validation, DAG validation.
- `src/schemas/*` – Workflow-, Node-, Retry-, Loop-, Run-Schemas.
- `src/dag-executor.ts` – DAG execution, node dispatch, retry, loops, approvals, events.
- `src/executor.ts` – workflow-level orchestration wrapper.
- `src/store.ts` – narrow `IWorkflowStore` trait.
- `src/event-emitter.ts` – in-process event emitter.
- `src/router.ts` – AI-router prompt and `/invoke-workflow` parser.
- `src/condition-evaluator.ts` – small condition DSL.
- `src/validation-parser.ts` – extracts structured validation results from Markdown output.

### Core Integration

`packages/core/src/workflows/store-adapter.ts` bridges core DB modules to the workflow engine's `IWorkflowStore` trait. This is one of the cleanest architecture boundaries in Archon. The workflow engine does not import the full DB layer. It depends on a narrow interface.

Relevant pattern:

- workflow package defines the contract
- core package implements it
- callers pass `WorkflowDeps`

For Pibo, this maps well to:

- workflow kernel defines `WorkflowStore`
- Pibo gateway/core implements it
- tests can provide memory stores
- future remote stores can be swapped in

### Orchestrator

`packages/core/src/orchestrator/orchestrator.ts` coordinates platform messages, isolation, workflow dispatch and background execution. It also shows how workflows are product features, not just library calls. Workflows are routed from chat/web/github contexts into execution environments.

### Isolation

`packages/isolation/src/types.ts` defines an abstraction over isolation providers. Worktrees are default, but the type model allows container, VM and remote providers. This strongly overlaps with Pibo's Docker compute worker/worktree direction.

## Workflow Authoring Model

### YAML DAGs

Archon workflows are YAML files with `nodes:`. Example: `.archon/workflows/defaults/archon-idea-to-pr.yaml` defines a long end-to-end workflow from planning through implementation, validation, PR finalization and parallel code reviews.

The authoring model is intentionally concrete:

```yaml
nodes:
  - id: create-plan
    command: archon-create-plan
    context: fresh

  - id: implement-tasks
    command: archon-implement-tasks
    depends_on: [confirm-plan]
    provider: claude
    model: opus[1m]
```

For Pibo, this is a useful contrast rather than a direct direction. Pibo should stay TypeScript framework-first, but the code-defined IR should remain serializable and inspectable so agents, tests, debug tools, and future UI features can reason about it.

### Commands as Prompt Assets

`.archon/commands/defaults/*.md` contains reusable prompt files. Workflow nodes refer to them by name via `command:`. This is elegant because workflow structure and prompt content can evolve separately.

Pibo equivalent:

- Agent nodes should support `promptTemplate` inline for simple cases.
- Non-trivial prompts should be references to registered prompt assets.
- Prompt assets should be versionable and inspectable.
- Workflow definitions should not become giant prompt dumps.

### Skills as Agent-Facing Manuals

`.claude/skills/archon/SKILL.md` routes the agent to specific docs depending on intent. This is highly relevant for Pibo because our CLI and workflow system are agent-facing. The skill includes:

- live workflow list command
- routing table by user intent
- setup/config/init/create workflow guides
- command reference
- good practices
- troubleshooting

For Pibo, this suggests that each workflow capability should ship with an agent-facing skill/guide. Workflows are not only APIs; they need operational literacy.

## Core Datentypen und Interfaces

### WorkflowDefinition

`packages/workflows/src/schemas/workflow.ts` defines top-level fields:

- `name`
- `description`
- provider/model defaults
- web search / reasoning controls
- worktree policy
- checkout mutation policy
- tags
- `nodes: DagNode[]`

Archon's `description` is operationally important: the AI router uses it to pick workflows. Descriptions often include `Use when:` and `NOT for:` sections.

Pibo should adopt this as a first-class metadata pattern:

```ts
type WorkflowMetadata = {
  name: string;
  description: string;
  useWhen?: string[];
  notFor?: string[];
  tags?: string[];
};
```

This helps routing, UI search and agent selection.

### DagNode

`packages/workflows/src/schemas/dag-node.ts` defines a flat schema with mutually exclusive node modes:

- `command`
- `prompt`
- `bash`
- `loop`
- `approval`
- `cancel`
- `script`

This is done with a flat Zod schema and `superRefine`, not a plain discriminated union, because YAML nodes do not require an explicit `type` field. This is a good authoring-pattern, but Pibo's IR should likely use explicit `kind` internally.

Recommended Pibo split:

- TypeScript authoring may allow shorthand builder calls.
- Canonical IR should normalize to explicit `kind: "agent" | "code" | "workflow" | "adapter" | "human" | "cancel"`.

### Node Common Fields

Archon common node fields include:

- `id`
- `depends_on`
- `when`
- `trigger_rule`
- `provider`
- `model`
- `context`
- `output_format`
- tool restrictions
- idle timeout
- retry
- hooks
- MCP path
- skills
- inline agents
- effort/thinking/budget/sandbox

For Pibo, many map directly to Agent node config:

- profile
- tools
- skills
- context
- routing
- output schema
- budget
- timeout
- retry
- sandbox/compute-worker policy

### WorkflowRun

`packages/workflows/src/schemas/workflow-run.ts` defines:

- statuses: `pending`, `running`, `completed`, `failed`, `cancelled`, `paused`
- terminal statuses
- resumable statuses: `failed`, `paused`
- `WorkflowRun` DB shape
- `ApprovalContext`
- `NodeOutput`

Archon stores node output as strings and uses `node_completed` events for completed node outputs. Pibo should preserve the idea but strengthen it:

- `WorkflowRun`
- `NodeAttempt`
- `EdgeTransfer`
- `WorkflowCheckpoint`
- `Wakeup`
- structured `WorkflowValue` instead of only string output

### IWorkflowStore

`packages/workflows/src/store.ts` defines a narrow trait with operations for:

- create/get/update/complete/fail/pause/cancel workflow runs
- find resumable run
- get active run by path
- fail orphaned runs
- create events
- get completed DAG node outputs
- codebase/env lookup

This is one of the best patterns in Archon. Pibo should implement a similar store boundary and avoid direct DB imports in the runtime kernel.

## Datenfluss und Execution Flow

### Load / Validate

`loader.ts` parses YAML using Bun YAML, validates node schemas through Zod, warns about irrelevant fields on node types, validates provider/model compatibility and validates graph structure.

Important validation steps:

- required `name` and `description`
- node-level Zod validation
- unique node IDs
- `depends_on` references exist
- cycle detection via Kahn's algorithm
- `$node.output` references point to known nodes
- markdown code blocks are stripped before scanning prompt references to avoid false positives

The markdown-code stripping pattern is subtle and useful. Pibo should use similar care when validating agent-authored workflow docs and prompt templates.

### Plan / Layers

`dag-executor.ts` builds topological layers with Kahn's algorithm. Nodes in the same layer are independent and run concurrently through `Promise.allSettled`.

This is a good V1 execution model:

- easy to explain
- easy to visualize
- supports simple parallelism
- avoids a heavy Pregel/superstep runtime

Pibo should adopt this for the first compiled execution plan, while preserving room for future loop/superstep features.

### Node Dispatch

The DAG executor dispatches by node type:

- AI command/prompt node
- bash node
- loop node
- approval node
- cancel node
- script node

Each path returns a `NodeOutput` with status and output string. The layer reducer stores outputs in `nodeOutputs` for downstream substitution and conditions.

Pibo should use the same dispatch concept but with stronger executor modules:

- `AgentNodeExecutor`
- `TypeScriptCodeNodeExecutor`
- `NestedWorkflowExecutor`
- `AdapterExecutor`
- `HumanWaitExecutor`
- `CancelExecutor`

### Data Flow

Archon's main data flow mechanism is string substitution:

- `$USER_MESSAGE`
- `$CONTEXT`
- `$nodeId.output`
- `$nodeId.output.field` for JSON output

This is very ergonomic, especially for prompt workflows. But it is not enough for Pibo's typed workflow goal.

Pibo should use a two-layer model:

1. typed ports and edge payloads for runtime truth
2. template variables as an authoring convenience over those payloads

So Pibo can support:

```text
{{input.title}}
{{nodes.plan.output.tasks}}
{{state.global.projectGoal}}
```

but internally store structured `WorkflowValue` and `EdgeTransfer` records.

### Trigger Rules

Archon supports fan-in semantics:

- `all_success`
- `one_success`
- `none_failed_min_one_success`
- `all_done`

This is directly useful for Pibo. It is simpler and more product-friendly than exposing full join logic immediately. Pibo should include these as built-in join policies.

### Conditions

`condition-evaluator.ts` implements a small DSL:

- equality / inequality
- numeric comparisons
- dot access into JSON output
- `&&` and `||` with AND precedence
- no parentheses
- fail-closed on parse errors

For Pibo, this is a good lesson: small deterministic guard DSLs beat arbitrary JavaScript for persisted workflows. However, Pibo should prefer named guard refs in IR and optionally provide a simple expression syntax for authoring.

## Retry / Replay / Resume / Persistenz

### Retry

Archon has node-level retry config:

- `max_attempts`
- `delay_ms`
- `on_error: transient | all`

The DAG executor applies exponential backoff by multiplying delay with `2 ** attempt`. It classifies errors and never retries fatal errors even when `on_error: all`.

Pibo should reuse this shape conceptually:

```ts
type RetryPolicy = {
  maxAttempts: number;
  backoff: BackoffPolicy;
  retryOn: "transient" | "all" | string[];
};
```

But retry decisions should be pure functions in our runtime kernel and persist `availableAt` rather than sleeping in-process for durable retries.

### Resume

Archon can resume failed or paused runs. It pre-populates `nodeOutputs` from prior `node_completed` events through `getCompletedDagNodeOutputs`, then skips successful prior nodes.

This is a very relevant pattern: **resume by replaying completed node outputs**, not by re-running everything.

Pibo should strengthen it:

- completed `NodeAttempt`s are durable records
- edge transfers are durable records
- checkpoints store current graph cursor and state
- resume reconstructs runnable queue from attempts/transfers/checkpoints

### Approval Resume

Archon approval gates pause the workflow and store `ApprovalContext` in run metadata. Approval writes events and changes status so the workflow can resume. Interactive loop approval stores user input for the next iteration.

This is valuable but Pibo should avoid overloading status `failed` as a resume trigger. Our model should include explicit statuses:

- `waiting`
- `resume_requested`
- `retry_scheduled`
- `running`

### Persistenz

Relevant migrations:

- `migrations/008_workflow_runs.sql`
- `migrations/012_workflow_events.sql`
- later migrations add resume path, activity, message history, background dispatch

Archon stores lean UI events in DB and verbose logs separately. This is a good pattern for Pibo:

- DB events for structured state and UI
- trace/log files or event stream for verbose provider/tool content
- artifacts in per-run directories

## Events und Observability

`event-emitter.ts` defines a typed event emitter for workflow execution. It is singleton, run-to-conversation mapped, and fire-and-forget. Listener errors do not break workflow execution.

Events include:

- workflow started/completed/failed
- node started/completed/failed/skipped
- loop iteration events
- tool started/completed
- approval pending
- artifacts
- cancellation

Pibo should adopt the principle but make event naming stable and product-owned, e.g.:

- `workflow.started`
- `node.attempt.started`
- `node.attempt.completed`
- `edge.transferred`
- `wait.entered`
- `wait.resumed`
- `artifact.emitted`

Archon's distinction between DB events and in-process emitter is also useful. Pibo should have both:

- durable event log / workflow run records
- live event stream for Chat Web/SSE

## Isolation und Worktrees

Archon has a substantial isolation layer:

- worktree provider as default
- abstraction for future container/VM/remote providers
- request types for issue, PR, review, thread, task
- branch naming and adoption semantics
- cleanup and health checks
- blocked/error states with user messages

This directly maps to Pibo's Docker compute worker/worktree direction. Pibo can reuse the architectural idea:

```ts
type WorkflowExecutionEnvironment =
  | { kind: "host" }
  | { kind: "worktree"; path: string; branch: string }
  | { kind: "docker-worker"; workerId: string; worktree: string }
  | { kind: "remote"; id: string };
```

Important Archon lesson: isolation is not a side detail. It is part of workflow dispatch and must be visible in run metadata, UI and cleanup commands.

## Provider Registry und Agent Integration

`packages/providers/src/registry.ts` is a typed registry with:

- `registerProvider`
- `getAgentProvider`
- `getProviderCapabilities`
- `getProviderInfoList`
- built-in providers
- community providers

`packages/providers/src/types.ts` defines a clean provider contract and `ProviderCapabilities`.

This is strongly relevant for Pibo. We already have Pibo profiles/tools/skills. For workflow nodes, we should include capability validation:

- supports structured output?
- supports session resume?
- supports skills?
- supports MCP/tools?
- supports cost controls?
- supports environment injection?

Archon's Pi provider integration is especially relevant because it wraps `@mariozechner/pi-coding-agent` and handles tricky runtime issues through dynamic imports and shims. It also includes a semaphore for Pi concurrency limits. For Pibo, the lesson is broader: node executors need provider/runtime capability flags and concurrency controls.

## CLI, Routing und Product UX

Archon CLI exposes:

- `workflow list`
- `workflow run`
- `workflow status`
- `workflow resume`
- `workflow approve`
- `workflow reject`
- `workflow abandon`
- `workflow cleanup`
- `workflow event emit`
- `isolation list/cleanup/complete`
- `continue`
- `serve`
- `validate workflows`

For Pibo, this is a good operator surface. Our CLI is agent-facing and should remain progressively discoverable, but workflow commands should include the same core operations:

- list definitions
- validate definition
- run workflow
- inspect run
- resume run
- approve/reject wait
- cancel run
- show graph/XState projection
- show events
- cleanup stale runs/workers

Archon's AI router is also interesting. It builds a prompt from workflow descriptions and asks the model to emit `/invoke-workflow`. For Pibo, this could become a routing assistant or deterministic resolver, but should not be the only mechanism. We should combine:

- exact workflow invocation
- slash commands
- UI workflow selection
- optional AI-assisted routing using `useWhen` / `notFor`

## Tests und Quality Patterns

Archon has many targeted tests across packages:

- workflow loader and validator tests
- DAG executor tests
- condition evaluator tests
- event emitter tests
- runtime checks
- script discovery and script node deps tests
- provider registry tests
- isolation resolver/factory tests
- DB tests
- CLI tests

Good patterns:

1. Test pure helpers separately.
2. Export small functions for timing-sensitive policies, e.g. `shouldContinueStreamingForStatus`.
3. Use compile-time assertions to catch type drift, e.g. `WorkflowConfig` compatibility and `NodeOutput` coverage.
4. Make event persistence non-throwing and test the boundary.
5. Test validation for silent field misuse, not only happy paths.

Pibo should copy the testing philosophy: many narrow tests around validators, guards, graph invariants, retry decisions, resume reconstruction and UI projection.

## Elegante Coding Patterns

### 1. Flat authoring schema + normalized runtime union

Archon uses a YAML-friendly flat schema with mutually exclusive fields. This makes authoring easy. Pibo can support similar shorthand while normalizing to explicit `kind` internally.

### 2. Zod as schema and type source

Archon derives most types from Zod schemas and documents the exceptions. Pibo should do the same for workflow IR and persisted JSON shapes.

### 3. Narrow trait interfaces

`IWorkflowStore` is excellent. Runtime packages should not import DB implementations.

### 4. Topological layers as V1 execution plan

Simple, observable and enough for many workflows.

### 5. Capability registry

Provider capability flags let the engine warn or fail when a node asks for unsupported features. Pibo should use the same pattern for runtime/profile/tool capabilities.

### 6. Fail-closed guard DSL

Invalid `when:` conditions skip rather than risk running wrong nodes. Pibo guards should similarly be conservative.

### 7. Approval as first-class node

Archon treats human approval as a workflow primitive. Pibo should not hide HIL inside generic callbacks.

### 8. Worktree isolation as dispatch concern

Isolation is part of workflow lifecycle, not an executor footnote.

### 9. Event stream + DB persistence

Live updates and durable observability are separate concerns but share event types.

### 10. Agent-facing skill docs

The Archon skill is an excellent pattern for teaching agents how to use a workflow product.

## Schwächen / Nicht direkt übernehmen

### 1. Too much in `dag-executor.ts`

The executor file is large and handles many concerns:

- node dispatch
- provider/model resolution
- retry
- approvals
- loops
- shell/script execution
- logging
- event emission
- status checks
- prompt substitution

Pibo should split earlier:

- planner/compiler
- executor loop
- node executors
- retry policy
- state/edge transfer
- wait manager
- event projector

### 2. String output as primary data model

Archon stores `NodeOutput.output` as string. Structured output exists via `output_format`, but downstream access is still string/template oriented. Pibo's framework needs structured `WorkflowValue` and schema validation at ports.

### 3. `depends_on` as only edge model

Archon edges are implicit through `depends_on`. Pibo needs explicit edges with source/target ports, kind, guard, adapter and state mapping.

### 4. Resume via completed-node events only

Useful but not enough for Pibo. We need attempts, edge transfers, checkpoints and wait tokens.

### 5. Approval status hack

Transitioning paused approvals to failed to enable resume is pragmatic but semantically confusing. Pibo should model resume states explicitly.

### 6. YAML-first limitations

YAML is great for Archon's workflow style, but Pibo's chosen direction is TypeScript framework authoring, JSON-serializable IR, XState projection, and later UI editing.

### 7. Provider-specific fields on generic nodes

Archon supports many provider/node fields in one base schema, with warnings for ignored fields. Pibo should separate common node fields from runtime-specific config more cleanly.

## Konkrete Empfehlungen für Pibo V1

### 1. Add a file authoring layer in addition to TypeScript builder

Our docs now emphasize TypeScript object and builder APIs. Archon shows that workflow definitions need to be easy for agents to inspect and reason about. For Pibo, the right adaptation is not workflow files; it is a clear TypeScript framework syntax, deterministic IR serialization for debugging, and registry-backed discovery.

### 2. Keep `useWhen` / `notFor` metadata

Workflow routing should not depend only on name. Add metadata fields:

```ts
type WorkflowRoutingHints = {
  useWhen?: string[];
  notFor?: string[];
  examples?: string[];
};
```

This helps CLI, Chat Web and agents choose workflows.

### 3. Normalize shorthand authoring to explicit IR

Allow easy authoring:

```yaml
- id: validate
  code: pibo.validate
```

but normalize to:

```json
{
  "kind": "code",
  "language": "typescript",
  "handler": "pibo.validate"
}
```

### 4. Adopt trigger rules as join policies

Add to our edge/compiler model:

```ts
type JoinPolicy =
  | "all_success"
  | "one_success"
  | "none_failed_min_one_success"
  | "all_done";
```

This gives fan-in behavior without full channel complexity.

### 5. Add a simple guard DSL only as authoring sugar

Pibo IR should store named guards. But authoring can allow expressions like:

```yaml
when: "$classify.output.type == 'BUG'"
```

The compiler can turn that into a deterministic guard ref or reject it.

### 6. Model human approval/wait as its own node kind

Our current design includes commands and wait tokens. Archon argues for a visible `human` / `approval` node kind too:

```ts
type HumanNode = {
  kind: "human";
  message: string;
  captureResponse?: boolean;
  onReject?: WorkflowEdgeRef | PromptRef;
};
```

This will improve UI editing and XState projection.

### 7. Add `cancel` / terminal control nodes

Archon's cancel node is useful. Pibo should include explicit terminal control nodes or commands for:

- cancel
- fail
- complete
- handoff

### 8. Add `script`/code distinction carefully

Archon distinguishes `bash` and `script` nodes. Pibo currently says TypeScript Code Nodes. We should keep V1 to registered TypeScript handlers, but later add explicit shell/process nodes if needed. Do not overload TypeScript Code Nodes with arbitrary shell.

### 9. Put provider/runtime capabilities into validation

Before execution, validate Agent node config against the selected Pibo Runtime profile/provider capabilities:

- structured output support
- tools/skills availability
- session resume
- sandbox/worktree support
- max budget
- concurrency limit

### 10. Add a concurrency-control primitive

Archon's Pi provider semaphore is a concrete solution for provider rate limits. Pibo should have a generic concurrency policy:

```ts
type RuntimeConcurrencyPolicy = {
  key: string;
  maxConcurrent: number;
};
```

### 11. Add event persistence as best-effort but state persistence as required

Archon treats workflow event creation as non-throwing. For Pibo:

- event projection can be best-effort
- run/attempt/checkpoint writes must be required
- failures must be clearly separated

### 12. Add validation for prompt/template references

Archon checks `$node.output` references and avoids false positives inside markdown code. Pibo should validate template refs:

- node ids exist
- output fields exist where schemas allow proof
- state paths are declared
- references inside escaped/code blocks are ignored or explicitly marked literal

### 13. Adopt project/global/bundled workflow discovery precedence

Archon's workflow source model is useful:

- bundled defaults
- global user workflows
- project workflows

Pibo could use:

```text
plugin workflows < user workflows < project workflows
```

with conflict diagnostics.

### 14. Add CLI operations matching Archon but Pibo-style

Proposed Pibo commands:

```text
pibo workflow list
pibo workflow validate <id-or-file>
pibo workflow run <id>
pibo workflow inspect <run-id>
pibo workflow resume <run-id>
pibo workflow approve <run-id>
pibo workflow reject <run-id>
pibo workflow cancel <run-id>
pibo workflow graph <id> --xstate
```

Keep progressive discovery; do not dump all help at once.

### 15. Use Archon-like skills/docs for workflow authoring

Add a Pibo skill for workflow authoring once implementation starts:

- quick start
- node reference
- adapter reference
- guard reference
- examples
- troubleshooting

## Changes Suggested to Current Pibo Design Docs

Based on Archon, I would sharpen our existing design docs as follows:

1. Keep workflow authoring TypeScript-first and add deterministic IR serialization/debug views next to builder/object APIs.
2. Add **Human/Approval Node** as a first-class node type, not only a command.
3. Add **Cancel/Terminal Node** or terminal command semantics.
4. Add **JoinPolicy / trigger rules** to edge/fan-in design.
5. Add **Workflow discovery precedence**: plugin/bundled, user/global, project.
6. Add **routing hints**: `useWhen`, `notFor`, examples.
7. Add **provider/runtime capability validation** to compiler.
8. Add **concurrency policies** for runtime providers.
9. Add **template reference validation** to validator.
10. Clarify that shell/script execution is out of V1 unless explicitly added; TypeScript code nodes remain registered handlers.

## Relevance Matrix

| Archon concept | Pibo relevance | Recommendation |
|---|---:|---|
| YAML workflows | Low for direct adoption | Do not add file authoring in V1; use as inspiration for readable TypeScript DSL and debug IR. |
| Command prompt files | High | Add prompt asset refs for Agent nodes. |
| DAG `depends_on` | Medium | Use explicit edges instead, but preserve simple authoring sugar. |
| Topological layers | High | Use for V1 execution plan. |
| `trigger_rule` | High | Add as join policy. |
| `when:` DSL | Medium | Use as authoring sugar, compile to named guard/diagnostic. |
| Loop node | Medium | Useful, but Pibo should model loops through explicit loop policy/state. |
| Approval node | Very high | Add first-class Human/Approval node and durable wait tokens. |
| Bash node | Low-Medium | Defer or model separately from TypeScript code nodes. |
| Script node | Medium | V1 should use registered TypeScript handlers, not inline scripts. |
| Provider registry | High | Use capability validation for Agent nodes. |
| Worktree isolation | High | Align with Pibo Docker compute worker/worktree model. |
| Event emitter | High | Use typed live events + durable run state. |
| Resume from node events | Medium | Upgrade to NodeAttempt/Checkpoint model. |
| Agent skill docs | Very high | Use for workflow authoring/operator guidance. |

## Quellen / Wichtige Pfade

### Root / Product

- `/root/code/Archon/README.md`
- `/root/code/Archon/package.json`
- `/root/code/Archon/CLAUDE.md`
- `/root/code/Archon/CONTRIBUTING.md`

### Workflow Engine

- `/root/code/Archon/packages/workflows/src/loader.ts`
- `/root/code/Archon/packages/workflows/src/dag-executor.ts`
- `/root/code/Archon/packages/workflows/src/executor.ts`
- `/root/code/Archon/packages/workflows/src/router.ts`
- `/root/code/Archon/packages/workflows/src/store.ts`
- `/root/code/Archon/packages/workflows/src/event-emitter.ts`
- `/root/code/Archon/packages/workflows/src/condition-evaluator.ts`
- `/root/code/Archon/packages/workflows/src/validation-parser.ts`

### Schemas

- `/root/code/Archon/packages/workflows/src/schemas/index.ts`
- `/root/code/Archon/packages/workflows/src/schemas/workflow.ts`
- `/root/code/Archon/packages/workflows/src/schemas/dag-node.ts`
- `/root/code/Archon/packages/workflows/src/schemas/workflow-run.ts`
- `/root/code/Archon/packages/workflows/src/schemas/retry.ts`
- `/root/code/Archon/packages/workflows/src/schemas/loop.ts`

### Core / DB / Operations

- `/root/code/Archon/packages/core/src/workflows/store-adapter.ts`
- `/root/code/Archon/packages/core/src/operations/workflow-operations.ts`
- `/root/code/Archon/packages/core/src/orchestrator/orchestrator.ts`
- `/root/code/Archon/packages/core/src/config/config-types.ts`
- `/root/code/Archon/packages/core/src/db/workflows.ts`
- `/root/code/Archon/packages/core/src/db/workflow-events.ts`

### Providers / Isolation

- `/root/code/Archon/packages/providers/src/types.ts`
- `/root/code/Archon/packages/providers/src/registry.ts`
- `/root/code/Archon/packages/providers/src/community/pi/provider.ts`
- `/root/code/Archon/packages/isolation/src/types.ts`
- `/root/code/Archon/packages/isolation/src/resolver.ts`

### CLI / Skills / Docs

- `/root/code/Archon/packages/cli/src/cli.ts`
- `/root/code/Archon/.claude/skills/archon/SKILL.md`
- `/root/code/Archon/.claude/docs/workflow-yaml-reference.md`
- `/root/code/Archon/.claude/skills/archon/references/workflow-dag.md`
- `/root/code/Archon/.claude/skills/archon/references/good-practices.md`

### Example Workflows

- `/root/code/Archon/.archon/workflows/defaults/archon-idea-to-pr.yaml`
- `/root/code/Archon/.archon/workflows/defaults/archon-test-loop-dag.yaml`
- `/root/code/Archon/.archon/workflows/defaults/archon-comprehensive-pr-review.yaml`
- `/root/code/Archon/.archon/workflows/test-workflows/e2e-pi-smoke.yaml`

## Schlussfazit

Archon ist die bisher produktnächste Referenz für Pibos Workflow Framework. LangGraphJS zeigt Agent-Graph-Orchestrierung, OpenWorkflow zeigt Durable Execution, Graphology/Graphlib zeigen Graph Stores und Algorithmen, XState zeigt Statecharts/Actors/Inspection. Archon zeigt, wie daraus ein nutzbares Produkt für AI Coding wird.

Pibo sollte besonders Archons Routing-, Isolation-, Provider-, Event-, Approval- und Skill-Patterns aufnehmen. Unser Authoring bleibt jedoch TypeScript-Framework-first und unser Kernel sollte stärker typisiert, port-/edge-orientiert und durable sein als Archons YAML-DAG-Engine. Die beste Richtung ist daher:

> Archons Produkt-UX-Patterns + Pibos TypeScript Workflow Framework und eigenes IR + OpenWorkflow-artiger Durable Kernel + LangGraph/XState-artige Orchestrierungsprojektion.
