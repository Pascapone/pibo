# Spec: Extensible Ralph Stop Conditions

**Status:** Draft  
**Created:** 2026-05-14  
**Owner / Source:** User request in Pibo session `ps_fb63e19f-c717-40ed-9a53-201734e2d576`  
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/continuous-ralph-jobs.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/pi-packages.md`, `docs/specs/capabilities/channel-runtime-context.md`, `docs/specs/capabilities/product-event-bus.md`, `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md`

## Why

Ralph is meant to run continuous agent work until the loop has enough evidence to stop. Today that evidence is hardcoded. A user can set a maximum successful iteration count, stop manually, cancel the current run, or ask the agent to return `<promise>COMPLETE</promise>`. Project-specific completion logic requires source changes.

Pibo needs a durable extension point. Framework developers should be able to register stop-condition logic through the Pibo plugin system. Users and operators should be able to attach registered conditions to individual Ralph jobs, configure them, combine several conditions, and inspect why a job stopped.

## Goal

Pibo MUST let Ralph jobs stop through one or more plugin-registered stop conditions while preserving current Ralph stop behavior for existing jobs.

## Background / Current State

`PiboRalphService` currently builds the Ralph prompt, sends one service message into a routed session, waits for the correlated run to finish, checks the final answer for `<promise>COMPLETE</promise>`, and passes `stopAfterRun` into `PiboRalphStore.completeRun()`.

`PiboRalphStore` owns durable jobs and runs. It stores `maxIterations`, counts completed run attempts in `completedIterations`, records `consecutiveErrors`, and disables a job when max iterations or `stopAfterRun` applies. Manual stop and cancel are direct service/store actions.

`PiboPluginRegistry` already lets plugins register tools, subagents, skills, context files, profiles, gateway actions, channels, auth services, web apps, and product event listeners. It does not yet expose Ralph stop-condition registration.

Pi Coding Agent extensions can observe runtime events such as turns, messages, tool execution, and agent lifecycle events. Those events are useful for custom Ralph signals, but Pi extensions do not own the durable Ralph loop.

## Scope

### In Scope

- Stop-condition type registration through the Pibo plugin API.
- Built-in stop-condition types that preserve current max-iterations and promise-complete behavior.
- A durable per-job stop policy with multiple condition instances.
- Deterministic condition composition with `any` and `all` modes.
- Per-condition durable state and evaluation diagnostics.
- Condition evaluation before and after each run.
- Owner-scoped Chat Web APIs for reading the condition catalog and editing job policy.
- Chat Web Ralph UI for attaching, configuring, enabling, disabling, and removing job conditions.
- Ralph CLI discovery and JSON workflows for condition catalog and job policy management.
- A product-level run-fact model so runtime extensions, tools, or product code can report facts for stop conditions.
- Trusted-local support for user-authored condition modules or packages registered by an operator.
- Tests for registration, evaluation, persistence, migration compatibility, API, CLI, and UI behavior.

### Out of Scope

- Letting untrusted browser users upload or edit executable condition code.
- Letting Pi Coding Agent extensions directly stop a Ralph job without Pibo evaluation.
- Time-based scheduling for Ralph jobs; scheduled jobs remain the cron capability.
- Distributed scheduling across multiple gateway processes.
- A full visual rule-builder for arbitrary boolean expressions beyond `any` and `all` composition.
- Production deployment; deployment remains a separate operator-approved step after implementation and dev validation.

## Definitions

### Stop-condition type

A plugin-registered definition with a stable `type`, label, optional JSON schema, and evaluator function.

### Stop-condition instance

A job-owned configured use of a stop-condition type. It has a stable `id`, `type`, enabled flag, and options.

### Stop policy

A job-owned JSON object that contains composition mode and condition instances.

### Stop decision

The result of one condition evaluation. It can continue the loop, stop after the current run, or request cancellation of the current run.

### Run fact

A product-level fact associated with a Ralph job and run. Facts can be emitted by Pibo code, tools, or Pi extensions and consumed by stop conditions.

## Requirements

### Requirement: Plugins register Ralph stop-condition types

The Pibo plugin API MUST allow plugins to register Ralph stop-condition types with stable names and evaluator functions.

#### Current

Plugins cannot register Ralph stop conditions. Ralph stop behavior is hardcoded in the service and store.

#### Target

A plugin can call a Pibo plugin API method to register a condition type. The registry rejects duplicate types and exposes registered conditions through a catalog.

#### Acceptance

- A condition type has a stable `type` string, display name, description, supported evaluation phases, optional option schema, and evaluator.
- Duplicate condition type registration fails during plugin registration.
- The condition catalog identifies the registering plugin id and name when known.
- Built-in Ralph conditions are registered through the same registry path as plugin conditions.
- Missing or disabled plugins cannot be referenced silently; job policy evaluation records a diagnostic for unknown condition types.

#### Scenario: Plugin registers a condition

- GIVEN plugin `acme.ralph` registers condition type `acme.no-commit`
- WHEN the gateway creates the plugin registry
- THEN the condition catalog includes `acme.no-commit`
- AND the catalog entry identifies plugin `acme.ralph`.

### Requirement: Existing Ralph jobs keep equivalent default stop behavior

The system MUST preserve current Ralph stop semantics for jobs that do not yet have an explicit stop policy.

#### Current

A job may stop through manual stop, cancel, `maxIterations`, or final answer text containing `<promise>COMPLETE</promise>`.

#### Target

Existing jobs behave the same after migration. The built-in policy is implicit when no durable policy exists.

#### Acceptance

- A job with `maxIterations: 1` stops after one completed run attempt regardless of outcome.
- A final answer containing `<promise>COMPLETE</promise>` still stops the job and records reason `promise-complete`.
- Manual stop still disables the job and lets an active run finish.
- Cancel still disables the job and aborts the active session when possible.
- Failed and cancelled runs increment the completed run-attempt counter used by `maxIterations`.
- API and CLI responses expose the effective default policy or clearly state that the policy is inherited.

#### Scenario: Max iterations fallback

- GIVEN an existing job has `maxIterations: 1` and no stored stop policy
- WHEN one Ralph run completes with `ok`, `error`, or `cancelled` without a promise-complete token
- THEN the job is disabled
- AND the run outcome is equivalent to max-iteration fallback behavior.

### Requirement: Ralph jobs persist a configurable stop policy

The system MUST persist a stop policy for each Ralph job when the owner configures stop conditions.

#### Current

The job record stores `maxIterations` and runtime overrides, but it does not store a condition list or composition mode.

#### Target

A job can store a `stopPolicy` with composition mode and condition instances. Policy changes survive gateway restart.

#### Acceptance

- `stopPolicy.mode` accepts `any` or `all`.
- Each condition instance has `id`, `type`, optional `enabled`, and optional `options`.
- Condition instance ids are unique within a job.
- Unknown condition types can be stored only when explicitly allowed for forward compatibility; they evaluate as diagnostics and do not stop by default.
- Invalid option shapes are rejected when a registered condition supplies a schema.
- Clearing a policy returns the job to the default inherited policy.
- Persisted policy appears in Chat Web API, CLI JSON output, and run diagnostics.

#### Scenario: Persist custom policy

- GIVEN condition type `acme.no-commit` is registered
- WHEN a user edits job `ralph_1` to use `mode: "any"` with an enabled `acme.no-commit` condition
- THEN the job stores that policy
- AND the same policy is returned after gateway restart.

### Requirement: Multiple conditions compose deterministically

The evaluator MUST combine multiple condition decisions in a deterministic way.

#### Current

Ralph has no condition list. The service checks promise-complete and the store checks max iterations separately.

#### Target

The evaluator runs enabled condition instances for the active phase and combines their decisions through the job policy mode.

#### Acceptance

- `mode: "any"` stops when any enabled condition returns a stop or cancel decision.
- `mode: "all"` stops only when all enabled conditions return compatible stop decisions.
- Disabled conditions are skipped and recorded as skipped.
- Conditions are evaluated in stable policy order for reporting; asynchronous evaluation must not change the final order of diagnostics.
- Cancel decisions have higher severity than stop-after-run decisions.
- A condition error records a diagnostic and counts as continue unless the condition instance opts into fail-closed behavior.
- The final decision records contributing condition ids and reasons.

#### Scenario: Any mode stops on first satisfied condition

- GIVEN a job policy has `mode: "any"` with conditions `max-iterations` and `acme.no-commit`
- WHEN `max-iterations` returns continue and `acme.no-commit` returns stop-after-run
- THEN Ralph disables the job after the run
- AND the run reason names `acme.no-commit`.

#### Scenario: All mode requires every condition

- GIVEN a job policy has `mode: "all"` with two enabled conditions
- WHEN one condition returns stop-after-run and the other returns continue
- THEN Ralph does not stop the job
- AND evaluation diagnostics show the mixed decisions.

### Requirement: Conditions can keep durable per-job state

The system MUST let condition evaluators read and update durable state scoped to a condition instance on one job.

#### Current

Ralph job state has shared counters such as `completedIterations` and `consecutiveErrors`, but no per-condition state.

#### Target

Each condition instance can persist JSON state for counters, previous observations, and diagnostics.

#### Acceptance

- Condition state is keyed by condition instance id.
- State updates are persisted atomically with run completion decisions.
- Removing a condition removes or archives its state so stale counters do not affect later conditions.
- Re-adding a condition with a new id starts with empty state.
- State JSON is bounded and validated as JSON object data.

#### Scenario: Consecutive no-commit counter

- GIVEN condition `acme.no-commit` is configured with threshold `3`
- WHEN three successful runs finish without a `git.commit.created` run fact
- THEN the condition state records count `3`
- AND the third evaluation returns stop-after-run.

### Requirement: Conditions evaluate before and after runs

The system MUST support condition evaluation before reserving a new run and after a run settles.

#### Current

The store blocks reservation when max iterations are already reached. Promise-complete can only be checked after the final answer.

#### Target

Condition types declare supported phases. Ralph evaluates before-run conditions before starting a new run and after-run conditions when a run finishes.

#### Acceptance

- A before-run stop decision prevents session creation and records why no new run was started.
- An after-run stop decision disables the job after the run is completed.
- A condition can support one or both phases.
- The evaluator passes phase-specific context, such as current job state before a run or run outcome after a run.
- Existing max-iteration blocking is represented as a built-in condition without creating duplicate run records.

#### Scenario: Stop before session creation

- GIVEN a job has already reached its successful iteration limit
- WHEN the scheduler considers the job
- THEN the max-iterations condition returns a before-run stop decision
- AND Ralph does not create a new Pibo Session.

### Requirement: Run facts are durable and scoped

The system MUST store run facts so stop conditions can evaluate runtime-observed evidence without parsing transcripts.

#### Current

Ralph can inspect the final answer and some run state, but it does not have a normalized fact store.

#### Target

Pibo can append facts for a Ralph job/run. Conditions can query facts for the current run and recent job history.

#### Acceptance

- A fact has id, owner scope, job id, run id when known, type, payload, source, created timestamp, and optional Pibo Session id.
- Facts are scoped by owner and Ralph job.
- Facts survive gateway restart.
- Facts are append-only except for retention cleanup.
- Conditions can query facts by type, run id, and recent count/window.
- Fact payloads are JSON objects and must not contain secrets.
- Invalid or oversized facts are rejected.

#### Scenario: Runtime extension emits a commit fact

- GIVEN a Ralph session creates git commit `abc123`
- WHEN a runtime extension emits fact type `git.commit.created` for the current Ralph run
- THEN the fact is stored with that job id and run id
- AND a later after-run condition can observe it.

### Requirement: Pi extensions report facts but do not directly stop Ralph

Pi Coding Agent extensions MAY report Ralph run facts, but Pibo MUST remain the authority for stop decisions.

#### Current

Pi extensions can observe runtime events but have no formal Ralph bridge.

#### Target

A Pibo-provided bridge lets extensions or tools emit facts for Ralph sessions. Ralph evaluates those facts through registered conditions.

#### Acceptance

- The bridge is available only when runtime metadata identifies a Ralph job/run.
- A fact emitted outside a Ralph session is rejected or ignored with diagnostics.
- The bridge does not expose arbitrary job mutation APIs to Pi extensions.
- A Pi extension cannot disable, cancel, or edit a Ralph job directly through the fact bridge.
- Stop decisions are still recorded by the Pibo evaluator.

#### Scenario: Extension requests completion by fact

- GIVEN a Pi extension observes an external verifier pass
- WHEN it emits fact type `verifier.passed`
- THEN the fact is stored
- AND only a configured Pibo stop condition can decide to stop the Ralph job based on that fact.

### Requirement: Users can attach registered conditions to jobs

Chat Web and CLI MUST let authorized users attach, configure, enable, disable, reorder, and remove stop-condition instances on their own Ralph jobs.

#### Current

The Ralph UI exposes job fields, runtime overrides, max iterations, and start/stop/cancel controls.

#### Target

The Ralph management surfaces expose a condition catalog and an editor for the selected job's stop policy.

#### Acceptance

- Chat Web lists registered condition types with name, description, plugin, supported phases, and option schema summary.
- The job editor can add an instance from the catalog.
- The job editor can edit options, enabled state, order, and policy mode.
- The job editor can remove a condition instance.
- CLI can print the catalog and patch policy JSON against a temporary store for tests.
- API and CLI enforce owner scope.
- Invalid policy edits fail without partially mutating the job.

#### Scenario: Add condition in Ralph UI

- GIVEN the user owns job `ralph_1`
- AND condition type `acme.no-commit` is registered
- WHEN the user adds it to the job with threshold `3` and saves
- THEN the job policy includes an enabled `acme.no-commit` instance
- AND subsequent runs evaluate that condition.

### Requirement: User-authored condition code is trusted-local and operator-controlled

The system MUST support user-authored stop-condition logic without letting arbitrary browser users upload executable code.

#### Current

Pibo does not load external Ralph condition code.

#### Target

Operators can register trusted local or package-based condition modules. Those modules register condition types through the same Pibo plugin API as built-in plugins.

#### Acceptance

- User-authored condition modules are loaded only from explicitly registered trusted sources.
- Browser API users can select and configure registered condition types but cannot upload executable code.
- Loading errors appear in operator diagnostics and the condition catalog when possible.
- A failed custom condition module does not prevent built-in conditions from registering.
- The registration mechanism documents the trust boundary and expected module shape.

#### Scenario: Trusted local condition package

- GIVEN an operator registers local package `/opt/pibo/ralph-conditions/acme`
- WHEN the gateway starts
- THEN Pibo loads its stop-condition registrations
- AND Chat Web users can attach those registered condition types to jobs they own.

### Requirement: Stop outcomes are auditable

The system MUST record enough evaluation detail to explain why Ralph continued, stopped, or cancelled.

#### Current

Runs can record status, reason, error, and Pibo Session id. The job state records last status and counters.

#### Target

Each evaluation records condition decisions, selected final decision, reasons, diagnostics, and state updates.

#### Acceptance

- Run history shows the final stop decision when a condition stops a job.
- Diagnostics include condition id, type, phase, decision, reason, and error when present.
- Chat Web can display the latest evaluation summary without reading raw SQLite.
- CLI JSON output includes evaluation details for recent runs.
- The exact promise-complete token remains visible in the UI while the built-in condition is enabled.

#### Scenario: Explain stop reason

- GIVEN condition `acme.no-commit` stops a job after a run
- WHEN the user opens the job's run history
- THEN the run shows status `ok`, reason `acme.no-commit`, and details explaining the threshold that was reached.

## Edge Cases

- A policy references an unknown condition type because a plugin was removed.
- A condition evaluator throws, times out, or returns invalid state.
- A condition is removed while a run is active.
- A run is cancelled while after-run conditions are pending.
- A before-run condition stops a job before a run id exists.
- Two conditions return different stop severities.
- A condition emits very large state or diagnostics.
- A plugin changes its option schema after jobs already store old options.
- A gateway restart happens after facts are written but before run completion.
- Multiple Ralph jobs receive facts from sessions with similar metadata; facts must stay scoped.

## Constraints

- **Compatibility:** Existing Ralph jobs and API clients continue to work. `maxIterations` remains accepted during migration.
- **Security / Privacy:** Executable custom condition code is trusted-local/operator-controlled. Browser users configure registered types only.
- **Durability:** Policy, state, facts, and evaluation diagnostics must survive gateway restart.
- **Performance:** Condition evaluation must not block scheduler ticks indefinitely. Evaluators need timeouts or cancellation.
- **Determinism:** Composition must be stable and explainable even when evaluators run asynchronously.
- **Product Boundary:** Pibo owns stop decisions. Pi extensions provide observations, not direct job control.

## Success Criteria

- [ ] SC-001: Built-in stop conditions preserve current max-iterations and promise-complete behavior for legacy jobs.
- [ ] SC-002: A plugin can register a new stop-condition type and the catalog exposes it.
- [ ] SC-003: A Ralph job can persist multiple configured condition instances and compose them with `any` or `all`.
- [ ] SC-004: A stateful custom condition can stop after a configured threshold across multiple runs.
- [ ] SC-005: Run facts can be emitted for a Ralph run and consumed by a condition.
- [ ] SC-006: Chat Web lets an owner add, edit, enable, disable, reorder, and remove condition instances for their job.
- [ ] SC-007: CLI supports condition catalog and policy JSON workflows against an isolated store.
- [ ] SC-008: Evaluation diagnostics explain why Ralph continued or stopped.
- [ ] SC-009: Untrusted browser input cannot upload executable condition code.

## Assumptions and Open Questions

### Assumptions

- Existing `maxIterations` remains as a compatibility field during the first implementation and maps into the built-in max-iterations condition.
- Pibo plugins are the primary registration API for framework developers.
- User-authored executable condition code is a trusted-local/operator workflow, not a general web-user upload workflow.
- V1 composition supports `any` and `all`; nested boolean trees can come later if needed.

### Open Questions

- Should custom condition modules reuse the existing Pi Package store, or should Pibo add a separate trusted Pibo plugin/source store?
- Should facts have a retention limit per job, a global TTL, or both?
- Should condition option schemas use JSON Schema, TypeBox, or an existing Pibo schema format?
- Should before-run stops create an auditable synthetic run record, or only update job state and diagnostics?
- Should condition timeouts be global defaults, per type, or per instance?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001: Plugin registration | Plugin registers a condition | T-004, T-005, T-023 | Pending |
| REQ-002: Compatibility | Legacy max iterations | T-009, T-010, T-024 | Pending |
| REQ-003: Stop policy persistence | Persist custom policy | T-006, T-007, T-025 | Pending |
| REQ-004: Deterministic composition | Any and all composition | T-011, T-026 | Pending |
| REQ-005: Per-condition state | Consecutive no-commit counter | T-012, T-027 | Pending |
| REQ-006: Evaluation phases | Stop before session creation | T-013, T-028 | Pending |
| REQ-007: Run facts | Runtime extension emits a commit fact | T-014, T-015, T-029 | Pending |
| REQ-008: Pi bridge authority | Extension requests completion by fact | T-016, T-030 | Pending |
| REQ-009: User policy editing | Add condition in Ralph UI | T-017, T-018, T-031, T-032 | Pending |
| REQ-010: Trusted custom code | Trusted local condition package | T-019, T-033 | Pending |
| REQ-011: Auditability | Explain stop reason | T-020, T-034 | Pending |
