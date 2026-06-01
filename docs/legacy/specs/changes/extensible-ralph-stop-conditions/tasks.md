# Tasks: Extensible Ralph Stop Conditions

## Phase 0: Preparation

- [ ] T-001: Review `src/ralph/service.ts`, `src/ralph/store.ts`, `src/ralph/types.ts`, `src/ralph/channel.ts`, `src/ralph/cli.ts`, `src/plugins/types.ts`, `src/plugins/registry.ts`, `src/gateway/server.ts`, and `src/core/session-router.ts`.
- [ ] T-002: Decide whether trusted user-authored condition sources reuse Pi Packages or require a separate Pibo/Ralph source store.
- [ ] T-003: Decide the schema format for condition options and UI rendering: TypeBox, JSON Schema, or a small Pibo-owned subset.

## Phase 1: Types and Registry

- [ ] T-004: Add Ralph stop-condition types in a new module such as `src/ralph/stopping/types.ts`.
- [ ] T-005: Extend `PiboPluginApi` and `PiboPluginRegistry` with `registerRalphStopCondition()` and condition catalog accessors.
- [ ] T-006: Add catalog info types for registered stop conditions, including plugin id/name, phases, description, default options, and schema summary.
- [ ] T-007: Add duplicate-registration tests to the plugin registry test suite.

## Phase 2: Policy and Store

- [ ] T-008: Add `PiboRalphStopPolicy`, `PiboRalphStopConditionInstance`, evaluation summary, diagnostic, and run-fact types to Ralph modules.
- [ ] T-009: Add nullable `stop_policy_json` persistence to `PiboRalphStore`.
- [ ] T-010: Preserve current `maxIterations` behavior as compatibility input and effective default policy data.
- [ ] T-011: Add validation for policy mode, unique condition ids, enabled flags, option JSON objects, and clearing policy.
- [ ] T-012: Add durable `conditionStates` and `lastStopEvaluation` fields under Ralph job state.
- [ ] T-013: Add tests for creating, reading, updating, clearing, and restarting with persisted stop policies.

## Phase 3: Built-in Conditions

- [ ] T-014: Implement `pibo.ralph.max-iterations` as a built-in condition with before-run and after-run behavior that matches current semantics.
- [ ] T-015: Implement `pibo.ralph.promise-complete` as a built-in after-run condition using the existing exact `<promise>COMPLETE</promise>` token.
- [ ] T-016: Register built-in conditions through the same plugin/registry path as custom conditions.
- [ ] T-017: Add compatibility tests proving legacy jobs still stop for max iterations and promise-complete.

## Phase 4: Evaluator

- [ ] T-018: Implement a stop-condition evaluator module, such as `src/ralph/stopping/evaluator.ts`.
- [ ] T-019: Support `before-run` and `after-run` phases.
- [ ] T-020: Support `any` and `all` composition with stable diagnostics order.
- [ ] T-021: Implement timeout, thrown-error, invalid-return, skipped-disabled, and unknown-condition diagnostics.
- [ ] T-022: Persist next condition state atomically with job/run completion where possible.
- [ ] T-023: Add unit tests for `any`, `all`, severity ordering, errors, timeouts, disabled conditions, unknown conditions, and state updates.

## Phase 5: Ralph Service Integration

- [ ] T-024: Refactor `PiboRalphService` so stop decisions come from the evaluator instead of direct promise-complete checks.
- [ ] T-025: Add before-run evaluation before creating a routed session.
- [ ] T-026: Add after-run evaluation after `emitMessageAndWait()` settles.
- [ ] T-027: Keep manual stop and cancel behavior unchanged as control-plane actions.
- [ ] T-028: Record stop reasons and evaluation diagnostics on run/job state.
- [ ] T-029: Add service tests with a fake channel context for before-run stop, after-run stop, cancellation, and current behavior compatibility.

## Phase 6: Run Facts

- [ ] T-030: Add durable Ralph run-fact storage with owner scope, job id, run id, Pibo Session id, type, source, payload, and created timestamp.
- [ ] T-031: Add fact append and query APIs for internal Ralph/service/evaluator use.
- [ ] T-032: Add payload size validation and secret-safe diagnostics.
- [ ] T-033: Add a constrained bridge so Ralph sessions can emit facts from runtime/product paths without direct job mutation.
- [ ] T-034: Add tests for fact scoping, persistence, query by run/type, invalid payloads, and gateway restart behavior.

## Phase 7: Trusted Custom Condition Sources

- [ ] T-035: Implement the chosen trusted-local source mechanism for user-authored condition code.
- [ ] T-036: Document the module shape and trust boundary for custom condition modules.
- [ ] T-037: Ensure loading failures appear in diagnostics without blocking built-in condition registration.
- [ ] T-038: Add tests for a local custom condition package that registers one condition and stops after a stateful threshold.

## Phase 8: Chat Web API

- [ ] T-039: Add `GET /api/chat/ralph/conditions` or equivalent catalog endpoint.
- [ ] T-040: Extend Ralph job create/update/read payloads with `stopPolicy`.
- [ ] T-041: Validate condition policy mutations with existing owner-scope and same-origin JSON protections.
- [ ] T-042: Include latest evaluation summaries in job or run-history responses.
- [ ] T-043: Add Chat Web API tests for catalog read, policy create/update/clear, invalid policy rejection, unknown condition diagnostics, and cross-owner protection.

## Phase 9: Chat Web UI

- [ ] T-044: Add a **Stop Conditions** editor section to `src/apps/chat-ui/src/RalphArea.tsx`.
- [ ] T-045: Add API client functions and frontend types for the condition catalog, stop policy, and evaluation summary.
- [ ] T-046: Add policy mode selector for `any` and `all`.
- [ ] T-047: Add condition add/remove/enable/disable/reorder controls.
- [ ] T-048: Add a schema-backed simple options form plus raw JSON fallback.
- [ ] T-049: Preserve visibility of the `<promise>COMPLETE</promise>` token when the built-in promise-complete condition is enabled.
- [ ] T-050: Render latest evaluation summary and condition stop reason in run history.
- [ ] T-051: Add component tests or browser checks for catalog display, policy editing, validation errors, and evaluation summary rendering.

## Phase 10: CLI

- [ ] T-052: Extend `pibo ralph` discovery output with condition/policy commands while keeping progressive help concise.
- [ ] T-053: Add `pibo ralph conditions` with JSON output.
- [ ] T-054: Add policy show/set/clear commands that operate against `--store` and owner scope.
- [ ] T-055: If custom source management is in scope for V1, add source list/add/doctor commands.
- [ ] T-056: Add built-CLI tests using a temporary store for conditions, policy JSON, missing owner scope, and invalid policy files.

## Phase 11: Capability Spec Updates

- [ ] T-057: Update `docs/specs/capabilities/continuous-ralph-jobs.md` after implementation to describe the shipped stop-policy model.
- [ ] T-058: Update plugin-system or Pi-package docs if the implementation adds a reusable trusted source mechanism.
- [ ] T-059: Update CLI discovery specs if new Ralph subcommands are added.
- [ ] T-060: Add traceability from tests to the changed Ralph requirements.

## Phase 12: Validation and Deployment

- [ ] T-061: Run targeted unit tests for Ralph store, evaluator, service, API, and CLI.
- [ ] T-062: Run `npm run typecheck` in a Docker compute worker.
- [ ] T-063: Run relevant full test suites as environment permits.
- [ ] T-064: Validate Chat Web Ralph UI in the Docker worker browser using the worker web/CDP ports.
- [ ] T-065: Deploy to dev with `./scripts/deploy-web-dev.sh` after worker validation.
- [ ] T-066: Verify one real dev Ralph job using built-in and custom stop conditions.
- [ ] T-067: Do not deploy production until the user approves.

## Acceptance Checklist

- [ ] AC-001: Existing jobs without explicit policy preserve current Ralph behavior.
- [ ] AC-002: Plugins can register condition types and catalog exposes them.
- [ ] AC-003: Jobs persist configurable stop policies with multiple condition instances.
- [ ] AC-004: Evaluator supports before-run and after-run phases.
- [ ] AC-005: `any` and `all` composition are deterministic and tested.
- [ ] AC-006: Per-condition state persists and updates correctly.
- [ ] AC-007: Run facts can be emitted, persisted, queried, and consumed.
- [ ] AC-008: Trusted custom condition modules can register conditions without browser code upload.
- [ ] AC-009: Chat Web supports condition selection and policy editing.
- [ ] AC-010: CLI supports condition catalog and policy JSON workflows.
- [ ] AC-011: Evaluation diagnostics explain continue/stop/cancel decisions.
