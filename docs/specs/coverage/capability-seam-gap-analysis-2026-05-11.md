# Coverage Analysis: Capability Seam Gap Analysis 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** [Source Specs Gap Analysis 2026-05-11](./source-specs-gap-analysis-2026-05-11.md), [Model Provider Auth and Session Model Selection](../capabilities/model-provider-auth-and-session-selection.md), [Custom Agents and Agent Designer](../capabilities/custom-agents.md), [Local Gateway Protocol and Lifecycle](../capabilities/local-gateway-protocol-and-lifecycle.md), [Pibo Session Store](../capabilities/pibo-session-store.md)

## Why

The current `docs/specs/` tree already contains durable capability specs for the main Pibo source areas. Creating another broad capability spec in this run would likely duplicate an existing contract.

This analysis records the remaining narrow seams found during source inspection so future scheduled runs can improve weakly specified behavior without creating overlapping specs.

## Goal

Identify small implementation seams that are source-backed, product-relevant, and either already covered by a broader spec or suitable for a future focused spec if their behavior grows.

## Scope

### In Scope

- Current code and tests in the workspace.
- Existing specs under `docs/specs/`.
- Narrow seams at capability boundaries where behavior is real but not the main subject of a durable spec.

### Out of Scope

- Legacy documents as authority over code.
- Source-code changes.
- New feature proposals.
- Re-specifying areas already covered by capability specs.

## Current Coverage State

The inspected spec tree covers the main source areas: Chat Web, custom agents, model/provider selection, runtime assembly, gateway lifecycle, sessions, data stores, cron/Ralph, reliability, yielded runs, MCP, curated tools, Pi packages, user skills, Docker runtime, workflows, validation, and deployment.

The inspected source and tests show several narrow seams that are implemented and tested, but currently live inside broader specs rather than standalone capability specs.

## Findings and Future Work

### Finding: Provider login and usage status are covered, but detailed OpenAI Codex flows are a seam

`src/auth/login-actions.ts` implements OpenAI Codex device-code login, optional browser PKCE login, API-key storage, login status, and logout. `src/auth/openai-codex-usage.ts` fetches OpenAI Codex usage only when the active model provider is `openai-codex` and an OAuth credential exists.

This behavior is covered at a product level by `model-provider-auth-and-session-selection.md` and by the provider requirement in `core-gateway-actions-and-session-controls.md`. A separate spec would be useful only if Pibo treats provider-login mechanisms as a stable public capability rather than gateway action internals.

#### Acceptance for a future focused spec

- Provider login start/complete/status/logout actions have a bounded public contract independent of Chat Web rendering.
- Device-code timeout, state expiry, provider mismatch, and account-id extraction are testable scenarios.
- Usage fetch behavior specifies when no usage is returned, when errors surface, and how percent windows and credits are normalized.

### Finding: Custom-agent profile materialization has focused tests but belongs under Custom Agents

`src/apps/chat/agent-profiles.ts` converts custom-agent records into dynamic profile definitions. The behavior includes alias registration, selected built-in tools, MCP servers, Pi packages, run control, model/thinking/fast settings, native tools, subagents, skills, and context files. Tests verify that unknown skills and context files are skipped with warnings rather than breaking profile creation.

This is properly managed by `custom-agents.md`; a separate spec would duplicate the Agent Designer and dynamic-profile contract.

#### Acceptance for a future spec update

- Add explicit requirement text to `custom-agents.md` for tolerant materialization of missing skills and context files.
- Keep validation failures for tools, packages, and subagents distinct from tolerated stale references if the code preserves that distinction.
- Link `test/agent-profiles.test.mjs` in the verification basis.

### Finding: Gateway backup and fallback commands are lifecycle details, not a separate capability

`src/gateway/backup.ts`, `src/gateway/fallback.ts`, and managed gateway CLI code expose operational backup and fallback behavior. The behavior is already within the scope of `local-gateway-protocol-and-lifecycle.md`, which covers local, production, dev, backup, and fallback gateway lifecycle commands.

A separate spec would be warranted only if backup/fallback assets become user-visible product artifacts with their own retention, restore, or audit lifecycle.

#### Acceptance for a future spec update

- The gateway lifecycle spec names the observable backup and fallback commands.
- Restore/fallback behavior has pass/fail checks that do not depend on host production state.
- Tests or CLI checks use isolated temp paths and never restart the host gateway.

### Finding: Session-store find performance is verified as behavior, not a new product capability

`test/performance-optimizations.test.mjs` verifies that SQLite session find applies indexed filters before semantic matching while preserving query results. This supports the existing Pibo Session Store contract.

A dedicated performance spec would duplicate `pibo-session-store.md` unless the project introduces release-gate budgets for session-store query latency.

#### Acceptance for a future spec update

- `pibo-session-store.md` links the indexed-filter test in its verification basis.
- If latency budgets are introduced, they belong in a performance diagnostics or validation spec, not in the functional store contract.

## Recommended Next Scheduled Runs

1. Extend `custom-agents.md` with tolerant profile materialization if no later run has already done so.
2. Extend `model-provider-auth-and-session-selection.md` with a small verification subsection for OpenAI Codex device login and usage normalization.
3. Extend `local-gateway-protocol-and-lifecycle.md` only if backup/fallback command behavior needs more explicit acceptance criteria.
4. Prefer updates to existing specs over new files for these seams; none currently justify a standalone capability spec.

## Success Criteria

- [x] SC-001: Existing specs were inspected before choosing a new artifact.
- [x] SC-002: No duplicate capability spec was created for behavior already covered by broader specs.
- [x] SC-003: Each finding names the owning existing spec or the condition that would justify a focused future spec.
- [x] SC-004: The analysis is based on current workspace code and tests, not legacy documents.

## Verification Basis

- `GLOSSARY.md`
- `docs/specs/README.md`
- `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- `docs/specs/capabilities/core-gateway-actions-and-session-controls.md`
- `docs/specs/capabilities/custom-agents.md`
- `docs/specs/capabilities/local-gateway-protocol-and-lifecycle.md`
- `docs/specs/capabilities/pibo-session-store.md`
- `src/auth/login-actions.ts`
- `src/auth/openai-codex-usage.ts`
- `src/apps/chat/agent-profiles.ts`
- `src/gateway/backup.ts`
- `src/gateway/fallback.ts`
- `test/login-actions.test.mjs`
- `test/agent-profiles.test.mjs`
- `test/performance-optimizations.test.mjs`
