# Tasks: Runtime Portability v4.1

## 1. Capability contracts

- [x] 1.1 Add required context-discovery capability and validation.
- [x] 1.2 Add required native-subagent capability and validation.
- [x] 1.3 Add required history-import capability and validation.
- [x] 1.4 Update built-in adapters, fake adapters, runtime registry tests, and public exports.
- [x] 1.5 Add profile compatibility/validation for nullable capability-aware overrides.

## 2. Agent Designer and persistence

- [x] 2.1 Render automatic-context behavior from the selected runtime capability.
- [x] 2.2 Hide native-subagent controls unless the runtime reports configurable support.
- [x] 2.3 Clear stale non-configurable overrides when the selected runtime changes.
- [x] 2.4 Preserve concrete `autoContextFiles` persistence with default `true`.
- [x] 2.5 Add nullable `native_subagents` storage and API normalization.
- [x] 2.6 Add store, API, web-channel, and UI autosave regression tests.

## 3. Portable history

- [x] 3.1 Define bounded portable-history entry/checkpoint/audit contracts.
- [x] 3.2 Extract ordered Pibo-owned session history.
- [x] 3.3 Add per-entry, count, and aggregate bounds with explicit markers.
- [x] 3.4 Redact credential-like data and bounded failure details.
- [x] 3.5 Normalize tool-call/result pairs and unmatched fallbacks.
- [x] 3.6 Persist pending/completed retry-safe handoff metadata.
- [x] 3.7 Reject malformed or mismatched handoff state.

## 4. Runtime rebinding

- [x] 4.1 Add explicit `startFresh` request semantics.
- [x] 4.2 Require advertised target import support for normal cross-runtime switches.
- [x] 4.3 Reject caller-supplied native target IDs and locators.
- [x] 4.4 Strip source runtime model/options/native-feature values before target creation.
- [x] 4.5 Create a fresh native target session and import before the first new prompt.
- [x] 4.6 Preserve same-runtime repair, frozen child bindings, and missing-session semantics.
- [x] 4.7 Add retry, rollback, leakage, redaction, and `startFresh` tests.

## 5. Adapter imports and compaction

- [x] 5.1 Import compatible Pi messages through `SessionManager.appendMessage`.
- [x] 5.2 Import native Codex items through `thread/inject_items`.
- [x] 5.3 Add native Codex manual compaction through `thread/compact/start`.
- [x] 5.4 Balance Pibo compaction semantic events and disclose ignored custom instructions.
- [x] 5.5 Deliver OMP history as a labeled append-only prompt rather than a fabricated transcript.
- [x] 5.6 Extend the Codex fixture and adapter tests for imports, compaction, and feature capture.

## 6. Context and resources

- [x] 6.1 Add adapter-owned native context inspection.
- [x] 6.2 Deduplicate only exact canonical known context paths.
- [x] 6.3 Implement Codex native context override precedence.
- [x] 6.4 Implement OMP nearest-only and every-ancestor discovery scope.
- [x] 6.5 Deliver selected OMP context through a private `--append-system-prompt` file.
- [x] 6.6 Remove stale generated OMP context/history files and unbound transcript state.
- [x] 6.7 Add bounded resource-delivery and cleanup tests.

## 7. Native subagents and skills

- [x] 7.1 Disable Codex `multi_agent`, `multi_agent_v2`, and `agents.enabled` when native subagents are disabled.
- [x] 7.2 Generate OMP disabled-agent and task-tool denial policy.
- [x] 7.3 Preserve Pibo portable-tool/subagent behavior independently.
- [x] 7.4 Give selected OMP custom skill directories native precedence.
- [x] 7.5 Reject same-name native Codex skill collisions without selected-path proof.
- [x] 7.6 Add deterministic collision and suppression tests.
- [x] 7.7 Capture adapter-owned real OMP behavioral evidence for additive prompts, skill precedence, and task-agent suppression.

## 8. Validation

- [x] 8.1 Install dependencies from the lockfile.
- [x] 8.2 Pass repository typecheck with supported heap limit.
- [x] 8.3 Pass production builds.
- [x] 8.4 Pass final focused runtime/resource/store/UI suites after all edits.
- [x] 8.5 Pass the full canonical test suite.
- [x] 8.6 Build and inspect the packed npm artifact.
- [x] 8.7 Record production dependency audit findings and disposition.
- [x] 8.8 Build a disposable integrated package with the Windows Better Auth migration branch.
- [x] 8.9 Install and validate the exact integrated candidate on Pibo2.
- [x] 8.10 Exercise authenticated public Chat Web/API flows for runtime controls, rebinding, context, compaction, and history continuity.
- [x] 8.11 Record deterministic versus authenticated-provider evidence in a validation report.
- [x] 8.12 Complete direct Windows/NTFS migration validation or record it as an explicit external release gate.

## 9. Documentation and delivery

- [x] 9.1 Add durable proposal, capability spec, design, and task records.
- [x] 9.2 Update affected canonical capability specs.
- [x] 9.3 Update the multi-agent runtime adapter task ledger.
- [x] 9.4 Add the final validation report.
- [x] 9.5 Audit the complete diff for focused scope and generated artifacts.
- [ ] 9.6 Commit, push, and open a focused pull request without merging or releasing.
