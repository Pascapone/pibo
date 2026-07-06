# Spec: Workflow Runtime Foundation and Manual Trigger

**Status:** Draft
**Created:** 2026-07-06
**Requester / Source:** User request in Pibo session `ps_22ae5cad-f457-4b9e-9f21-cc7ae577ac0c`
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `docs/project/workflows.md`, `docs/project/workflow-interface-adapters.md`

## Why

Users can now compose workflow graphs visually, but the graph cannot be run from the editor. Pibo needs a small manual trigger first, then a runtime foundation that can grow into webhooks, cron jobs, adapters, guards, judge-agent routing, human waits, and Project workflow execution.

The foundation must keep data movement explicit. Agents, adapters, guards, and trigger sources should be interchangeable through stable contracts, not special-case UI logic.

## Goal

Pibo SHALL let a user manually trigger a workflow draft from the Workflows editor and SHALL define runtime interfaces that keep future triggers, transformations, and routing decisions extensible.

## Background / Current State

Current `upstream/dev` has two workflow layers:

1. `packages/workflows` contains TypeScript workflow framework code for IR types, validation, registry refs, runtime node helpers, edge transfer helpers, persistence, inspection, and XState projection.
2. Chat Web contains a Workflows tab with catalog/draft/publish UI, graph editing, node/edge inspectors, registered pickers, Project workflow session creation, and a Project workflow start endpoint.

The product gap is the integration boundary. The Workflows editor does not expose a trigger/run button. Project workflow start creates or returns a run record, but Chat Web does not yet run graph nodes through the package runtime and does not populate real node attempts or edge transfers from product execution.

## Scope

### In Scope

- Manual/test trigger node and editor run flow.
- Runtime request/response contracts for draft and published workflow starts.
- Explicit edge payload envelope and default handoff behavior.
- Adapter and guard extension points, including deterministic adapters and registered guard refs.
- Judge-agent pattern for agentic routing or summarization, modeled as explicit agent nodes.
- Validation and diagnostics for trigger/run readiness.
- Minimal run status/output UI in the Workflows editor.
- Traceability from editor run to runtime facts.

### Out of Scope

- Webhook, cron, scheduled, or external API triggers in the first slice — they must fit the trigger interface but are not implemented first.
- Rich workflow templates, marketplace nodes, or plugin UI builders.
- Hidden automatic LLM transformations on edges.
- Full chat-history handoff by default.
- Inline executable code in UI-authored workflows.
- Raw XState editing.
- Replacing Project Sessions or normal Pibo Session routing.

## Requirements

### Requirement: Current system boundaries are explicit

The system MUST distinguish framework capability, Chat Web authoring, and product runtime integration.

#### Current

The framework package includes runtime helpers, while Chat Web mostly persists and validates UI-authored IR. Product workflow start does not yet execute the whole graph from Chat Web.

#### Target

Specs and implementation must state which layer owns authoring, validation, execution, run persistence, and UI projection.

#### Acceptance

- Developer docs identify `packages/workflows` as the reusable framework layer.
- Chat Web Workflows is identified as authoring plus product run controls.
- The product executor integration is tracked as this change, not assumed already complete.

#### Scenario: Developer reads current docs

- GIVEN a developer opens the workflow docs
- WHEN they inspect current capabilities
- THEN they can tell that editor graph execution is pending
- AND they can tell that package runtime helpers already exist.

### Requirement: Trigger nodes are first-class workflow starts

Workflow IR MUST support trigger nodes as explicit start sources.

#### Current

Workflow IR uses `initial` to identify initial graph nodes, but there is no trigger node kind in the UI/product contract.

#### Target

A trigger node represents an external or manual event source. A trigger run produces the first workflow payload and transfers it through outgoing edges like any other node output.

#### Acceptance

- A trigger node can be rendered with distinct start/play styling in the editor.
- A trigger node has an output port and may declare an input form/schema for manual invocation.
- A trigger node has no required incoming edges in the first slice.
- A workflow can designate a manual trigger node as the run start.
- Future trigger sources can reuse the same runtime start contract.

#### Scenario: Manual trigger starts a draft

- GIVEN a workflow draft contains a manual trigger node connected to an agent node
- WHEN the user clicks Play on the trigger and submits text
- THEN the runtime starts a draft test run
- AND the trigger output is transferred to the connected agent input.

### Requirement: Manual/test trigger is the first trigger implementation

The first product trigger MUST be a manual/test trigger in the Workflows editor.

#### Current

Users cannot run a workflow draft directly from the Workflows editor.

#### Target

The manual trigger node exposes a Play action. The action opens a compact prompt/input dialog. Submitting starts an editor test run for the selected draft.

#### Acceptance

- The editor can add a manual trigger node from the graph context menu or node palette.
- The trigger visually reads as the workflow start button, not as a normal agent node.
- Clicking Play opens input appropriate to the trigger/workflow input port: text first, JSON when configured.
- Invalid JSON input is rejected before runtime execution.
- Running status and result/error appear without layout-shifting top banners.
- The first slice does not require publishing the workflow.

#### Scenario: JSON trigger input validation

- GIVEN a manual trigger declares a JSON input schema
- WHEN the user clicks Play and enters invalid JSON
- THEN no run starts
- AND the editor shows a validation diagnostic tied to the trigger input.

### Requirement: Runtime start requests use a stable envelope

All trigger sources MUST start workflows through the same run request envelope.

#### Current

Project workflow start accepts a session id and creates a run record. Editor trigger, webhook, and cron starts do not exist.

#### Target

A workflow run request includes source kind, workflow/draft identity, input value, actor, optional project/session links, idempotency key, and execution mode.

#### Acceptance

- Manual editor runs use `source.kind = "manual.editor"` or equivalent.
- Project session starts use the same envelope with project/session links.
- Future webhook and cron starts can supply different source kinds without changing node executors.
- The run response includes run id, status, diagnostics, and optional final output.

#### Scenario: Same executor for editor and Project start

- GIVEN one published workflow can be started from a Project session and one draft can be started from the editor
- WHEN both start paths create run requests
- THEN both requests flow through the same executor contract
- AND differ only in source metadata and persistence policy.

### Requirement: Edge payloads are explicit and minimal by default

The runtime MUST move data between nodes as explicit edge payloads, not as implicit full session history.

#### Current

Authoring supports edges and ports, but product execution does not yet define the default agent-to-agent handoff.

#### Target

A node output becomes an edge payload. The downstream node receives that payload as its input. Full upstream chat history is not included unless a node, adapter, or prompt builder explicitly reads linked session metadata under policy.

#### Acceptance

- Direct text-to-text edges pass the upstream text output as downstream input.
- Direct JSON-to-compatible-JSON edges pass the upstream JSON value as downstream input.
- Incompatible ports fail validation unless an adapter is declared.
- Edge payload records include source node, target node, edge id, value summary/redaction metadata, producer attempt id, and transfer status.
- Agent session transcripts are linked metadata, not default edge payload.

#### Scenario: Two-agent default handoff

- GIVEN Agent A outputs text
- AND Agent B has a text input port
- WHEN Agent A completes
- THEN the edge transfers Agent A's output text to Agent B
- AND Agent B's prompt receives that text as workflow input
- AND Agent B does not automatically receive Agent A's full chat transcript.

### Requirement: Transformations are plug-and-play and explicit

The system MUST support data transformation through registered deterministic adapters, visible adapter nodes, and explicit agent nodes.

#### Current

The framework and UI support adapter refs, edge adapters, and visible adapter nodes, but product graph execution is not wired end-to-end.

#### Target

Adapters are registered deterministic transforms. Agentic transformations, summarization, or semantic rewriting are represented as normal agent nodes, not hidden edge behavior.

#### Acceptance

- Edge adapters can transform a source payload to the target input contract.
- Visible adapter nodes can transform data as inspectable node attempts.
- Agent nodes can be used as summarizers, judges, normalizers, or routers when the transformation requires model reasoning.
- The saved graph shows every transformation step.
- Hidden LLM coercion remains forbidden.

#### Scenario: Agent summarizer between agents

- GIVEN Agent A produces a long text output
- AND the workflow places a Summarizer Agent node between Agent A and Agent B
- WHEN Agent A completes
- THEN the summarizer receives Agent A's output as input
- AND Agent B receives only the summarizer's declared output.

### Requirement: Routing decisions are explicit gates

The runtime MUST support routing decisions through registered guards and explicit judge-agent patterns.

#### Current

The UI can persist edge guards selected from registered refs, but product execution does not yet apply guards over real edge payloads.

#### Target

A guard decides whether an edge may fire. Deterministic guards are registry refs. Judge agents are normal agent nodes that emit a structured decision payload consumed by downstream guards or router nodes.

#### Acceptance

- An edge with no guard is eligible when its source node completes successfully and port compatibility passes.
- An edge with a deterministic guard fires only when the guard returns true.
- Multiple eligible outgoing edges can be supported by a declared routing policy.
- Judge-agent decisions are persisted as agent outputs, not hidden guard internals.
- Abort/cancel routes are represented as explicit terminal or error/control edges.

#### Scenario: Judge routes to revise or finish

- GIVEN a Judge Agent node outputs `{ "decision": "revise" }`
- AND outgoing edges use guards for `revise` and `approved`
- WHEN the judge completes
- THEN only the matching guarded edge fires
- AND the run records the judge output and guard decision.

### Requirement: Agent node handoff preserves Pibo Session boundaries

Agent nodes MUST execute through normal Pibo Session routing and link sessions to workflow facts.

#### Current

`packages/workflows` has Pibo routing adapter contracts. Chat Web product execution must connect them to real session routing.

#### Target

Each agent node attempt may create or address a Pibo Session. Workflow records store the linked Pibo Session id, selected profile, prompt/input summary, status, output, and errors without owning normal session storage.

#### Acceptance

- Agent nodes use fixed Agent Designer profiles.
- The workflow executor creates/sends messages through Pibo routing, not a separate model client.
- Node attempts link to Pibo Session ids.
- Normal session transcripts remain in normal session stores.
- Workflow facts can be inspected without duplicating private transcripts.

#### Scenario: Agent node creates linked child session

- GIVEN an editor test run reaches an agent node
- WHEN the node starts
- THEN Pibo creates or links a child/agent-node session
- AND the workflow run records that session id as metadata.

### Requirement: Editor run UI stays minimal

The Workflows editor MUST add run controls without reintroducing the previous overbuilt UI.

#### Current

Recent UI work intentionally restored a basic Workflows page and graph editor.

#### Target

The editor shows only the controls needed for manual trigger testing: Play on trigger, input dialog, running state, output/error panel, and persistent bottom status.

#### Acceptance

- No large always-visible run orchestration panel is added in the first slice.
- Advanced trigger config remains collapsed or absent until later phases.
- Existing graph editing, layout persistence, edge dragging, inspector, and bottom status bar remain intact.
- The user can test the simple two-agent workflow from the editor with a few clicks.

#### Scenario: Simple editor test run

- GIVEN a workflow draft is open
- WHEN the user clicks the manual trigger Play action
- THEN the existing graph remains visible
- AND run feedback appears in a compact, non-disruptive area.

### Requirement: Validation blocks unsafe or impossible runs

The runtime MUST validate trigger input, graph shape, registry refs, ports, adapters, guards, and profiles before execution.

#### Current

Draft and publish validation exists, but run-blocking product execution validation is incomplete.

#### Target

A run cannot start when required runtime dependencies or contracts are invalid.

#### Acceptance

- Missing trigger input, malformed JSON, missing initial/trigger, unknown node refs, unknown registry refs, and incompatible ports produce structured diagnostics.
- Drafts may remain invalid while editing.
- Play/Start blocks only the attempted run, not draft saving.
- Diagnostics identify path, node id, edge id, registry ref, severity, and hint when known.

#### Scenario: Missing agent profile

- GIVEN an agent node references an unavailable profile
- WHEN the user attempts an editor test run
- THEN the run is blocked
- AND the diagnostic points to that agent node profile ref.

### Requirement: Runtime facts drive inspection and projection

Workflow run UI and XState projection MUST derive from runtime facts.

#### Current

The Project Workflow view can show configured/start records and derived UI summaries, but real node attempts and edge transfers are mostly absent from product execution.

#### Target

Editor and Project run views consume the same run facts: run status, node attempts, edge transfers, wait tokens, human actions, events, final output, and diagnostics.

#### Acceptance

- A started editor test run has a run id and observable status.
- Node attempt records appear as nodes start, complete, wait, or fail.
- Edge transfer records appear when payloads move.
- XState/UI projection remains read-only and reconstructable from facts.

#### Scenario: Edge transfer appears in run view

- GIVEN a two-agent test run completes Agent A and transfers data to Agent B
- WHEN the user inspects the run
- THEN the UI shows an edge transfer from Agent A to Agent B.

## Edge Cases

- Trigger node has no outgoing edges: the run ends after trigger output or blocks with a clear diagnostic, depending on declared workflow output.
- Multiple trigger nodes exist: only the clicked/manual source starts; future external triggers identify their trigger id.
- User clicks Play while a run is active: UI either disables Play or starts a distinct run with a distinct id.
- Node output violates its declared output port: downstream edges do not fire and the run records a validation failure.
- Multiple outgoing edges match: runtime follows declared routing policy; if absent, deterministic default is all eligible data/control edges.
- Guard throws or times out: edge is marked failed/skipped and the run records a guard diagnostic.
- Agent node is cancelled/aborted: run records cancellation and does not silently continue unless an explicit error/control route is eligible.

## Constraints

- **Compatibility:** Existing workflow drafts, node positions, edge route metadata, and published versions must continue to load.
- **Security / Privacy:** No inline executable code, no hidden LLM coercion, and no full transcript handoff by default.
- **Performance:** Editor test runs must stream or poll bounded status without blocking graph editing.
- **Persistence:** Draft test runs must be identifiable as test/editor runs and not confused with production Project workflow runs.
- **UX:** Keep Workflows editor basic. Add only the minimal run affordances for the first slice.

## Success Criteria

- [ ] SC-001: A user can add or use a manual trigger node in the Workflows editor.
- [ ] SC-002: A user can click Play, enter text, and run trigger → agent from a draft.
- [ ] SC-003: A user can run trigger → agent → agent and see the first agent output passed as the second agent input.
- [ ] SC-004: The system does not pass full upstream chat history by default.
- [ ] SC-005: Incompatible edge ports block run unless an explicit adapter is configured.
- [ ] SC-006: Runtime facts include run id, node attempts, edge transfers, final output or error diagnostics.
- [ ] SC-007: A judge-agent pattern can be represented as a normal agent node plus guarded outgoing edges, even if full UI helper affordances come later.
- [ ] SC-008: The spec supports future webhook/cron triggers without changing node executor contracts.

## Assumptions and Open Questions

### Assumptions

- `packages/workflows` remains the preferred reusable runtime/validation package where product integration can reuse it.
- Manual editor test runs should not require publishing a workflow.
- Agent nodes should continue to use fixed Agent Designer profiles for predictability.
- JSON trigger input can start as raw JSON text before a generated form UI exists.

### Open Questions

- Should draft editor test runs persist in the existing project workflow tables, the package workflow store, or a new product workflow run store?
- Should editor test runs create visible child Pibo Sessions in the Projects/sidebar tree, or keep them scoped to the Workflows editor until the user opens details?
- What is the default behavior for multiple eligible outgoing edges: fire all, first by priority, or require an explicit routing policy?
- How should cancellation propagate from an editor run to active agent-node Pibo Sessions?
- Should manual trigger nodes be stored as `kind: "trigger"` with `trigger.kind`, or as a specialized node kind such as `kind: "manualTrigger"`?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Current system boundaries are explicit | Developer reads current docs | T0 | Draft |
| Trigger nodes are first-class workflow starts | Manual trigger starts a draft | T1, T2 | Draft |
| Manual/test trigger is first implementation | JSON trigger input validation | T2 | Draft |
| Runtime start requests use a stable envelope | Same executor for editor and Project start | T3 | Draft |
| Edge payloads are explicit and minimal | Two-agent default handoff | T4 | Draft |
| Transformations are plug-and-play | Agent summarizer between agents | T5 | Draft |
| Routing decisions are explicit gates | Judge routes to revise or finish | T6 | Draft |
| Agent node handoff preserves boundaries | Agent node creates linked child session | T4 | Draft |
| Editor run UI stays minimal | Simple editor test run | T2 | Draft |
| Validation blocks unsafe runs | Missing agent profile | T7 | Draft |
| Runtime facts drive inspection | Edge transfer appears in run view | T8 | Draft |
