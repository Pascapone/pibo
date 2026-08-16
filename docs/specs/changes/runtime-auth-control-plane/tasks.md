# Tasks: Runtime-Neutral Provider Authentication Control Plane

**Status:** Ready for review
**Updated:** 2026-08-16

## 0. Evidence and setup

- [x] 0.1 Read project glossary and required GitHub, server-development, and spec-writing workflows.
- [x] 0.2 Verify PR #503 dependency head and create clean `feature/agent-runtime-auth-control-plane` worktree.
- [x] 0.3 Reconfirm direct Chat Web-to-Pi auth path, missing Codex operations, and false-auth defaults.
- [x] 0.4 Write capability, proposal, spec, design, and task artifacts.

## 1. Runtime auth contract

- [x] 1.1 Add Pibo-owned auth identifiers, status/flow/result types, and state aggregation.
- [x] 1.2 Add descriptor auth capabilities and validation.
- [x] 1.3 Add adapter operations and registration consistency checks.
- [x] 1.4 Add unsupported and mismatch contract tests.

## 2. Registry, router, and product routing

- [x] 2.1 Add configured-instance auth dispatch to runtime/plugin registries.
- [x] 2.2 Add credential-scope-aware router invalidation for terminal auth changes.
- [x] 2.3 Add channel-context auth catalog and mutation operations.
- [x] 2.4 Add explicit-target Web API and safe session-bound compatibility routing.

## 3. Pi adapter compatibility

- [x] 3.1 Move Pi SDK credential access behind the Pi adapter boundary.
- [x] 3.2 Map Pi providers/methods/status to the Pibo contract.
- [x] 3.3 Wrap native OAuth state with opaque Pibo flow IDs while retaining the bounded user-facing authorization URL.
- [x] 3.4 Implement adapter login/API-key/cancel/logout, shared-scope flow coordination, and cache invalidation.
- [x] 3.5 Preserve legacy helper/action tests and behavior, including browser PKCE.

## 4. Native Codex adapter auth

- [x] 4.1 Add stable account protocol types and strict response validation.
- [x] 4.2 Implement safe `account/read` status mapping without account identifiers.
- [x] 4.3 Implement `chatgptDeviceCode` start and completion notification tracking.
- [x] 4.4 Implement API-key login.
- [x] 4.5 Implement cancellation, timeout, process failure handling, and cleanup.
- [x] 4.6 Implement logout and reusable adapter disposal.
- [x] 4.7 Prove restart persistence and no Pi/global Codex mutation.
- [x] 4.8 Prove two configured instances remain isolated.

## 5. User surfaces

- [x] 5.1 Add runtime/provider auth catalog API client/types.
- [x] 5.2 Replace hard-coded provider settings with grouped per-runtime targets and states.
- [x] 5.3 Add pending flow polling/cancel/retry and target-specific success messages.
- [x] 5.4 Explain default runtime and credential scope.
- [x] 5.5 Update `/login` Terminal flow for active-runtime targeting and Pibo flow IDs.
- [x] 5.6 Make `/model` use runtime status instead of default-authenticated fallback.
- [x] 5.7 Make Agent Designer use runtime status and never infer missing auth as true.

## 6. Security and deterministic tests

- [x] 6.1 Add fake Codex App Server auth fixture and account matrix.
- [x] 6.2 Add Web/API aggregation, targeting, partial/pending/retry/logout tests.
- [x] 6.3 Add malformed response, process failure, timeout, and redaction tests.
- [x] 6.4 Audit logs/events/bindings/snapshots for credential and native-identifier leakage.

## 7. Documentation and audit

- [x] 7.1 Update multi-runtime spec/task matrix and final audit correction.
- [x] 7.2 Update architecture, operations, history/debug, and call-stack docs.
- [x] 7.3 Update runtime-adapter authoring skill and tests/evals.
- [x] 7.4 Add integrated auth validation report and evidence inventory.

## 8. Local validation and PR

- [x] 8.1 Run focused runtime/Codex/Web/UI tests.
- [x] 8.2 Run typecheck, build, and canonical full suite: 1,752/1,752 across 12 suites.
- [x] 8.3 Verify package contents and clean focused diff.
- [x] 8.4 Commit, push, and open focused stacked PR #518 against `dev` without merging.

## 9. Pibo2 candidate and user handoff

- [x] 9.1 Build and checksum exact candidate `cc0dcde6616dcec6a8dcf7cd0f78e70478a8ab1c`, SHA-256 `4cabc5f1687381fa1b5be8c094b5893d71686309d45c2195c34968af8fb117f5`.
- [x] 9.2 Install/activate it on disposable Pibo2 and verify active service/local health/public HTTP.
- [x] 9.3 Validate authenticated provider settings API and public headful Web UI through the real path.
- [x] 9.4 Verify Pi shared scope and native-Codex private disconnected status independently using safe metadata only.
- [x] 9.5 Leave native Codex unauthenticated and ready at `/apps/chat/settings/providers`; no active login flow or credential shortcut was used.
