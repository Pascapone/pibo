# PRD Catalog: Pibo Workflow UI Authoring V2

**Status:** Draft  
**Created:** 2026-05-11  
**Source change:** `docs/specs/changes/pibo-workflow-ui-authoring-v2/`

This directory translates the Pibo Workflow UI Authoring V2 proposal, spec, design, task list, and discovery notes into implementation-grade Markdown PRDs.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../discovery-notes.md`
- `../../pibo-workflow-system-v1/spec.md`
- `../../pibo-workflow-system-v1/design.md`
- `../../pibo-workflow-system-v1/design-authoring-api.md`
- `../../pibo-workflow-system-v1/design-xstate-integration.md`
- `../../pibo-workflow-system-v1/prds/README.md`

## PRDs

| PRD | Scope | Primary implementers |
|---|---|---|
| `01-product-overview.md` | End-to-end V2 product, users, surfaces, success gates, non-goals | Product, engineering leads |
| `02-workflow-registry-catalog-and-draft-store.md` | Global workflow library, registry/store records, UI drafts, source/status, missing refs | Backend/full-stack engineers |
| `03-project-session-selection-and-snapshots.md` | Project session creation, workflow selection, delayed start, one run per session, configuration snapshots | Full-stack/runtime engineers |
| `04-workflow-builder-and-ir-editing.md` | Workflows tab builder, visual graph editing, raw Workflow IR editor, layout, schema/prompt editors | Frontend/full-stack engineers |
| `05-composition-node-and-capability-pickers.md` | Node kinds, edges, adapters, guards, state mappings, nested workflow references, profile pickers | Full-stack/workflow engineers |
| `06-versioning-archive-delete-lifecycle.md` | Draft/publish lifecycle, immutable versions, semantic version bumps, archive, delete, historical run inspectability | Backend/product engineers |
| `07-project-run-inspection-sidebar-and-human-actions.md` | Project run view, sidebar session tree, Workflow/XState view, Terminal view routing, human actions | Frontend/runtime engineers |
| `08-validation-security-testing-rollout.md` | Cross-cutting validation, diagnostics, security boundaries, observability, test gates, rollout | Engineering leads/QA/security |
| `09-implementation-completeness-contract.md` | Agent-ready MUST checklist and source/task traceability across all V2 PRDs | All implementation agents/reviewers |

## Global Decisions Inherited by All PRDs

- V2 UI targets normal Pibo users. Agents and operators use CLI or programmatic paths.
- Workflows are used only inside Projects in V2.
- Workflow selection happens per Project session, not per Project.
- Creating a Project session does not start the workflow. Start is explicit.
- Each Project session has at most one workflow run.
- The selected workflow for an existing Project session is immutable.
- Every configured session stores an immutable definition/configuration snapshot.
- The Workflows main-nav tab owns definition browsing and editing.
- Projects own execution, run history, human actions, and run inspection.
- UI drafts live in the Workflow Registry/store.
- Workflow records use `source: "code" | "ui"` and `status: "draft" | "published" | "archived"`.
- Code-registered workflows are read-only in UI except for duplication into UI drafts.
- UI-created workflows use Pibo Workflow IR directly. V2 adds no separate YAML/JSON authoring layer.
- XState remains a projection/visualization layer, not workflow truth.
- Raw Workflow IR is viewable and editable. Raw XState editing is not supported.
- Workflow Builder canvas interactions use `@xyflow/react`; saved layout uses existing `WorkflowDefinition.ui` metadata and remains outside runtime semantics.
- Prompt asset edits create revisioned prompt assets and do not mutate code/plugin prompt assets or already published workflow versions in place.
- Published workflow versions are immutable.
- Archive applies to the whole workflow. Delete is allowed even when historical runs exist.
- Historical runs must remain inspectable through snapshots after workflow deletion.
- Session prompt overrides are node-id-keyed and limited to explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values.
- Session model, thinking level, and fast mode overrides apply workflow-session-wide to Pibo Agent node sessions; V2 has no per-node model/thinking/fast overrides.
- Configured-session values are immutable after creation and before start; users create a new configured Project session to change workflow id/version, input, prompt overrides, model, thinking level, or fast mode.
- UI-authored workflows are global and visible to authenticated users.
- All authenticated users may archive or delete UI-authored workflows in V2; code workflows remain read-only except duplication.
- The UI composes existing registered capabilities only. It must not allow inline TypeScript or arbitrary executable code.
- Schemas use the existing custom JSON Schema subset validator. V2 does not introduce Zod.
- JSON Schema editing is raw JSON only in V2.
- Guards and adapters expose parameters only when registry metadata includes `paramsSchema`.
- Nested workflow nodes are edited as references. “Open workflow” navigates to the nested workflow's own builder/viewer.
- V2 has no templates, no TypeScript export, no workflow slash commands, and no workflow tools for agents.

## Traceability Matrix

| Source requirement / decision | PRD coverage |
|---|---|
| Normal-user UI and Projects-only workflow usage | `01`, `03`, `07`, `09` |
| Workflows main-nav tab and global library | `01`, `02`, `04`, `09` |
| Workflow record source/status and draft store | `02`, `06`, `09` |
| Incomplete drafts and raw IR corruption protection | `02`, `04`, `08`, `09` |
| Project session workflow selection | `03`, `07`, `09` |
| Delayed workflow start | `03`, `07`, `09` |
| One workflow run per Project session | `03`, `07`, `09` |
| Configuration/effective-definition snapshots | `03`, `06`, `07`, `09` |
| Real Pibo Sessions only in Project sidebar | `03`, `07`, `09` |
| Workflow/XState view versus Terminal view routing | `07`, `09` |
| Duplicate code/UI workflows into drafts | `02`, `04`, `06`, `09` |
| Visual graph editing and layout | `04`, `05`, `09` |
| Raw Workflow IR toggle and no raw XState editing | `04`, `08`, `09` |
| Nodes, edges, adapters, guards, state mappings | `04`, `05`, `08`, `09` |
| Prompt templates and prompt asset editing | `03`, `04`, `05`, `09` |
| Raw JSON schema editing and no Zod | `04`, `05`, `08`, `09` |
| Publish/version/archive/delete lifecycle | `06`, `09` |
| Historical run inspectability after deletion | `03`, `06`, `07`, `09` |
| Human action controls and run history | `07`, `08`, `09` |
| Validation diagnostics and missing refs | `02`, `04`, `05`, `08`, `09` |
| Security boundary: no inline TypeScript/arbitrary code | `05`, `08`, `09` |
| Testing and rollout gates | `08`, `09` |
| Resolved design decisions / implementation gates | `README`, `09` |

## Discovery Notes

The source specs already answer the PRD discovery questions:

- **Core problem:** V1 provides runtime/framework/inspection, but normal users cannot select, configure, create, edit, publish, version, or manage workflows from Chat Web.
- **Success metrics:** The PRDs use pass/fail product and validation gates from `../spec.md` and `../tasks.md` instead of business KPIs.
- **Constraints:** V2 must preserve V1 runtime behavior, use Pibo Workflow IR as truth, avoid inline TypeScript, avoid Zod, keep XState visual-only, and keep execution under Projects.
- **Budget/deadline:** Not specified in source docs. Rollout is therefore phase- and validation-gated rather than calendar-gated.

## Resolved Implementation Decisions

The source-spec open decisions that block V2 implementation are resolved in the PRDs:

- Workflow Registry/store schema and the V2 permission matrix are resolved in `02-workflow-registry-catalog-and-draft-store.md`.
- Project session override scope, prompt override eligibility, and pre-start immutability are resolved in `03-project-session-selection-and-snapshots.md`.
- Workflow Builder graph/canvas and prompt asset persistence decisions are resolved in `04-workflow-builder-and-ir-editing.md`.
- Configuration/effective-definition snapshot fields, deleted-workflow display/link behavior, and exact API route contracts are resolved in `09-implementation-completeness-contract.md` Sections 4.3, 4.4, and 4.8, with affected PRDs updated to point to those contracts.

## Second-Pass Coverage Rule

For implementation, give agents this whole directory, not a single PRD. `09-implementation-completeness-contract.md` is the mandatory cross-check: any implementation missing a MUST item there is incomplete, even if an earlier PRD describes the area at a higher level.
