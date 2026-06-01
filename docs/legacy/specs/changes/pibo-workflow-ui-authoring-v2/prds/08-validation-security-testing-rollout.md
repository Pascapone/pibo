# PRD: Pibo Workflow UI Authoring V2 — Validation, Security, Testing, and Rollout

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`, `../../pibo-workflow-system-v1/prds/08-security-observability-testing-rollout.md`

## 1. Executive Summary

- **Problem Statement**: V2 exposes workflow authoring to normal users, which increases risk around invalid definitions, missing registry refs, unsafe execution paths, confusing diagnostics, and UI/runtime drift.
- **Proposed Solution**: Define validation gates, structured diagnostics, security boundaries, observability requirements, automated tests, manual validation flows, and rollout phases that keep V2 aligned with V1 runtime contracts.
- **Success Criteria**:
  - SC-01: Draft validation runs after load, graph, node, edge, schema, prompt, state, raw IR, publish, session creation, and start events.
  - SC-02: Publish and run/start are blocked while error diagnostics remain.
  - SC-03: No UI path creates inline TypeScript, arbitrary executable code, raw XState source, or Zod schema definitions.
  - SC-04: Missing refs and validation errors appear in the Workflow Library, Builder, and runtime failure state with actionable ids and locations.
  - SC-05: Typecheck, unit, integration, and UI tests cover registry lifecycle, builder editing, Project session creation, run inspection, human actions, and V2 explicit deferrals.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author fixing draft diagnostics.
  - Security reviewer verifying execution boundaries.
  - QA engineer validating V2 behavior before rollout.
  - Developer debugging UI/runtime mismatch.

- **User Stories**:
  - As a workflow author, I want diagnostics grouped by workflow element so that I can fix errors quickly.
  - As a security reviewer, I want proof that UI workflows can only compose registered capabilities so that V2 does not become a code execution surface.
  - As a QA engineer, I want automated tests for the main flows and explicit non-goals so that regressions are caught.
  - As a developer, I want consistent diagnostics from editor, publish, session creation, and runtime start so that bugs are not hidden until execution.

- **Acceptance Criteria**:
  - Diagnostics include code, message, optional path, nodeId, edgeId, severity, and hint where applicable.
  - Diagnostics group by workflow, node, edge, schema path, state path, registry ref, and severity.
  - Draft save allows warnings/errors, but publish and run/start reject error diagnostics.
  - Raw IR parse errors show warnings and do not persist invalid raw text.
  - Runtime executes only valid published workflows or valid session snapshots.
  - Lifecycle and failure signals are visible for draft save, validation, publish, archive, delete, configured-session creation, start blocked, start accepted, run status changes, and human action submission.
  - V2 explicit deferrals are tested or reviewed: templates, TypeScript export, workflow slash commands, workflow tools for agents, YAML/JSON product import/export, inline TypeScript, Zod schema authoring, and inline nested workflow expansion.

- **Non-Goals**:
  - New general compliance/audit product beyond workflow events and diagnostics.
  - New role model beyond authenticated archive/delete rules in V2.
  - Replacing V1 workflow validation with Zod, AJV, or a new validation stack.
  - Treating XState projection as the source of truth.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing workflow validation functions and JSON Schema subset validator.
  - Registry-ref validation for handlers, adapters, guards, profiles, prompt assets, human actions, and nested workflows.
  - Event/run inspection APIs for observability.
  - Lifecycle event or audit-equivalent records for validation, publish, archive, delete, configured-session creation, run start, run start rejection, and human action submission.
  - Test harnesses for workflow package, Chat Web UI, Project session APIs, and human actions.

- **Evaluation Strategy**:
  - Unit tests: Registry draft/publish lifecycle, catalog APIs, source/status action derivation, validation diagnostics, version bumps, archive/delete.
  - Integration tests: Project session workflow selection, delayed start, snapshot creation, workflow immutability, one-run enforcement, start validation.
  - UI tests: duplicate/edit/validate/publish, raw IR invalid warning, incompatible edge adapter requirement, missing ref diagnostics, sidebar/view routing, human action submission.
  - Negative boundary tests: no inline TypeScript, no raw XState editing, no Zod authoring, no templates, no slash commands, no agent workflow tools.
  - Release gate: `npm run typecheck`, relevant workflow package tests, relevant Chat Web API/UI tests, and the required manual V2 smoke flows pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Validation is event-driven from editor and lifecycle transitions and uses V1 validation logic where possible.
  - Structured diagnostics are shared by Builder, Workflow Library, Project session creation, run start, and runtime failure state.
  - Security boundaries are enforced through registered refs, picker constraints, publish validation, start validation, and runtime executor policy.
  - Observability remains event/run/snapshot based; XState is visual-only.
  - UI and API failures must surface the same diagnostic families for blocked publish, blocked session creation, blocked run start, missing refs, and invalid human actions.

- **Integration Points**:
  - `packages/workflows/src/validation` for schema, port, graph, registry, and state checks.
  - Workflow Registry/store for source/status, drafts, versions, missing refs, and lifecycle events.
  - Chat Web Workflows and Projects surfaces for diagnostics, links, and run views.
  - Existing auth, owner scope, Project session, Pibo Session, profile, tool, skill, context, and compute-worker policies.

- **Security & Privacy**:
  - V2 must not bypass normal session, tool, skill, context, auth, profile, Project, or compute-worker policies.
  - Code nodes, adapters, and guards must be registered trusted refs only.
  - Inputs, outputs, prompts, prompt assets, state, edge payloads, and human action payloads are sensitive workflow data.
  - Diagnostics should reveal enough to fix errors without leaking hidden payloads in normal UI.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP gate: registry/store lifecycle tests, Project selection/delayed-start tests, snapshot/start tests, duplicate-to-draft checks, and no-code-boundary review.
  - v1.1 gate: builder editing tests, raw IR tests, validation panel tests, registered-ref composition tests, and publish/version tests.
  - v1.2 gate: run inspection, sidebar/view routing, human actions, deleted-definition historical inspection, archive/delete tests, and human-action UI checks.
  - Release gate: typecheck, relevant workflow package tests, relevant Chat Web tests, and required manual V2 smoke flows pass before main deployment.

### Rollout Gate Matrix

Each rollout gate records the automated checks and manual evidence needed before the next phase opens.

| Gate | Scope | Required automated checks | Required manual validation |
| --- | --- | --- | --- |
| MVP | Workflow Library, registry/store lifecycle, Project workflow selection, configured/not-started sessions, snapshots, explicit Start, duplicate-to-draft, and registered-ref security boundary. | `npm run typecheck`; workflow package tests for registry, validation, and published-version contracts; Chat Web tests for catalog APIs, Project workflow-session creation, delayed start, snapshot creation, one-run enforcement, and source/status actions. | Run the Project select-configure-save-start-inspect smoke flow. Confirm Duplicate creates a UI draft without mutating code-owned workflows. Review visible V2 scope-boundary copy for no inline executable or raw XState authoring path. |
| v1.1 | Visual Builder editing, inspectors, raw Workflow IR, raw JSON schema editors, validation panel, registered node/edge composition, and publish/version lifecycle. | `npm run typecheck`; workflow package validation tests; Chat Web tests for builder draft patching, raw IR invalid warning, picker-backed refs, edge adapter requirements, validation blocking, publish, and immutable version history. | Run the Builder duplicate-edit-validate-publish smoke flow. Confirm validation errors block Publish while draft save remains available. Confirm published `workflowId@version` bodies remain immutable. |
| v1.2 | Archive/delete lifecycle, historical deleted-definition inspection, Project run inspection, nested workflow/sidebar routing, and human actions. | `npm run typecheck`; workflow package archive/delete and runtime diagnostic tests; Chat Web tests for archive filters, tombstones, deleted-definition snapshots, run inspection panels, sidebar routing, wait-token rendering, and human action submission. | Re-run Project run inspection against completed, failed or blocked, waiting, archived, and deleted-definition scenarios. Confirm historical runs show snapshot-only definition state after live deletion. |
| Release | Full V2 deployment candidate. | `npm run typecheck`; relevant workflow package tests; relevant Chat Web API/UI tests, including the V2 release coverage suite; `npm run chat-ui:build` when UI surfaces changed. | Re-run both canonical manual flows, attach browser screenshots for UI-changing stories, record diagnostics observed during blocked publish/start cases, and keep deployment blocked until every required smoke item passes. |

### Manual Validation Flow

The canonical manual validation set has two flows. Use the detailed product smoke checklists in `01-product-overview.md` for step-by-step expectations, and record evidence in the release notes or progress log.

1. **Project select-configure-save-start-inspect**
   - Open Chat Web as an authenticated user, navigate to Projects, and create a workflow-backed Project session.
   - Select a published workflow version, enter allowed configuration values, and save the session without starting it.
   - Verify the session shows configured/not-started state, selected workflow id/version, configuration summary, validation state, an explicit Start action, and no workflow run id.
   - Start the workflow and verify one run attaches to the Project session; duplicate Start returns the existing run.
   - Inspect status, current node, run history, node attempts, edge transfers, output, errors, diagnostics, nested workflow links, definition link or definition-deleted state, and pending human actions. Each section must show data or an explicit empty state.
2. **Builder duplicate-edit-validate-publish**
   - Open Workflows, duplicate an eligible code or UI-published workflow, and confirm the duplicate opens as a separate UI draft.
   - Edit the draft through supported visual, inspector, prompt, schema, state, or raw Workflow IR controls while keeping Pibo Workflow IR as the saved source of truth.
   - Run Validate and verify diagnostics refresh, group by the documented families, retain non-validation diagnostics, and block Publish while error-severity diagnostics remain.
   - Fix blocking diagnostics through picker-backed refs, valid schema subset values, compatible ports/adapters, required workflow input/output contracts, and graph completeness.
   - Publish with the intended semantic version bump and verify the published version has a stable definition hash, cannot be overwritten with different IR, and appears in version history and Project workflow pickers.

- **Technical Risks**:
  - Validation differs between editor and runtime; mitigate by reusing validation functions and testing at edit, publish, session creation, and start.
  - UI introduces hidden executable paths; mitigate by picker-only registered refs and negative tests.
  - Diagnostics leak sensitive payloads; mitigate with redaction and existing visibility rules.
  - Scope creep destabilizes V2; mitigate by explicit non-goals and deferral tests.
