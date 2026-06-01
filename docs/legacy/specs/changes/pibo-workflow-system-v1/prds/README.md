# PRD Catalog: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Source change:** `docs/specs/changes/pibo-workflow-system-v1/`

This directory translates the Pibo Workflow System V1 proposal, spec, design, task list, and references into implementation-grade PRDs.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../design-framework-architecture.md`
- `../design-authoring-api.md`
- `../design-runtime-kernel.md`
- `../design-xstate-integration.md`
- `../tasks.md`
- `../references.md`
- `../structured-outputs-json-schema-subset.md`

## PRDs

| PRD | Scope | Primary implementers |
|---|---|---|
| `01-product-overview.md` | End-to-end product, personas, core workflow value, release success | Product, engineering leads |
| `02-authoring-api-and-registry.md` | TypeScript workflow framework, object/builder APIs, registry, plugin registration | Framework/API engineers |
| `03-interfaces-composition-state.md` | Ports, JSON schema subset, edges, adapters, guards, joins, state, loops | Framework/runtime engineers |
| `04-runtime-kernel-and-persistence.md` | Durable execution kernel, SQLite workflow store, replay, leases, retries, cancellation | Runtime/storage engineers |
| `05-node-executors-and-agent-runtime.md` | Agent, code, nested workflow, adapter executors, prompt construction, Pibo Runtime integration | Runtime/agent engineers |
| `06-human-actions-cli-project-ui.md` | Human approval/input, wait tokens, CLI/debug commands, Projects tab, Workflow/XState tab | Full-stack engineers |
| `07-xstate-projection-and-inspection.md` | XState projection, Pibo actor contract, snapshots, inspection events, future editor boundaries | UI/runtime engineers |
| `08-security-observability-testing-rollout.md` | Cross-cutting security, privacy, observability, evals, rollout, operational readiness | Engineering leads/QA/SRE |
| `09-implementation-completeness-contract.md` | Second-pass completeness contract, exact MUST checklist, source/task traceability | All implementation agents/reviewers |

## Global Decisions Inherited by All PRDs

- Workflows are TypeScript code using the Pibo Workflow Framework in `packages/workflows`.
- The Workflow Registry is the canonical V1 catalog for workflow definitions, handlers, adapters, guards, prompt assets, human actions, plugin registrations, and capability metadata.
- The runtime uses a fresh SQLite database named `pibo-workflows.sqlite` for workflow-specific facts.
- Normal Pibo/Pi session traces, tool calls, spans, transcripts, and session records stay in existing stores.
- V1 structured ports use the OpenAI Structured Outputs / tool-calling JSON Schema subset.
- Agent nodes run through normal Pibo Runtime/session routing with explicit Agent Designer profiles.
- Adapters are registered deterministic TypeScript adapters only; hidden coercion is out of scope.
- Backtracking is allowed only through explicit guarded back-edges or retry policies with `maxAttempts`.
- XState is a dependency for projection, visualization, inspection, local orchestration support, and future editing; it is not durable truth.
- Human waits use durable Pibo wait tokens.

## Traceability Matrix

| Spec requirement | PRD coverage |
|---|---|
| Workflow is a first-class runtime unit | `01`, `04`, `05`, `09` |
| Text and structured JSON interfaces | `02`, `03`, `08`, `09` |
| Workflows compose through edges | `03`, `04`, `09` |
| Explicit interface adapters | `03`, `05`, `09` |
| Node kinds: code, agent, workflow, adapter, human | `05`, `06`, `09` |
| Agent profile/tool/skill/routing selection | `05`, `08`, `09` |
| Fixed and runtime-built prompts | `02`, `05`, `09` |
| Global/local/edge state separation | `03`, `04`, `09` |
| Workflow Registry | `02`, `09` |
| Bounded backtracking and retries | `03`, `04`, `09` |
| XState projection | `07`, `09` |
| Persistent runs and trace events | `04`, `06`, `07`, `08`, `09` |
| Chat Web Projects UI and CLI/debug inspection | `06`, `07`, `09` |

## Second-Pass Coverage Rule

For implementation, give agents this whole directory, not a single PRD. `09-implementation-completeness-contract.md` is the mandatory cross-check: any implementation missing a MUST item there is incomplete, even if an earlier PRD describes the area at a higher level.

## Discovery Notes

The source specs define the core problem, solution, technical constraints, and implementation defaults. Business budget and external deadline are not specified in the source docs; these PRDs therefore use feature-completeness, safety, and validation gates instead of calendar or budget gates.
