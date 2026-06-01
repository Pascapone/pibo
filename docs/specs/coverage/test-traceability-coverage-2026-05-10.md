# Coverage Analysis: Test Traceability Across Source Specs

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/coverage/source-specs-coverage-2026-05-10.md`, `docs/specs/capabilities/spec-status-and-traceability.md`, `docs/specs/README.md`, `GLOSSARY.md`, `AGENTS.md`

## Why

The source-spec tree now covers the major Pibo source areas. The next coverage gap is not another product capability. It is the uneven connection between behavior requirements and the current test suite.

A future agent should be able to open a spec, see which acceptance checks are already protected by tests, and see which checks are still source-backed only. That traceability must stay separate from feature specs so it does not create duplicate behavior contracts.

## Scope

### In Scope

- Current specs under `docs/specs/`.
- Current tests under `test/*.test.mjs`.
- Current validation scripts in `package.json`.
- Gaps that future coverage work can close by updating existing specs or adding focused coverage reports.

### Out of Scope

- Changing source code or tests.
- Declaring behavior implemented only because a test file exists.
- Treating legacy docs as source of truth.
- Full requirement-by-requirement verification for every spec in one scheduled run.

## Current State

- `docs/specs/` contains 49 files.
- 42 spec files already include a `## Verification Basis` section.
- The source tree has 48 top-level Node test files under `test/`.
- `package.json` defines `npm test` as `npm run build && node --test test/*.test.mjs` and `npm run typecheck` as TypeScript checks for the root, Chat UI, and Context Files UI.
- Traceability tables use mixed requirement statuses such as `Implemented`, `Draft`, `Pending`, `Covered`, `Partial`, `Specified`, and `Unverified`.

## Observed Strong Traceability

| Behavior area | Current tests observed | Specs that can cite them |
|---|---|---|
| Pibo Session Store and routing | `session-store.test.mjs`, `session-router-store.test.mjs`, `pibo-data-session-store.test.mjs`, `session-model-source-of-truth.test.mjs` | `capabilities/pibo-session-store.md`, `capabilities/pibo-session-routing.md`, `capabilities/model-provider-auth-and-session-selection.md` |
| Gateway protocol, requests, restart safety, and web host | `gateway-request.test.mjs`, `gateway-backpressure-subscriptions.test.mjs`, `gateway-restart-safety.test.mjs`, `web-gateway.test.mjs`, `web-http.test.mjs`, `web-channel.test.mjs` | `capabilities/local-gateway-protocol-and-lifecycle.md`, `capabilities/web-auth-and-same-origin-host.md`, `capabilities/operator-cli-error-contract.md` |
| Chat Web data, trace, cache, and signals | `chat-data-v2-legacy-guard.test.mjs`, `chat-v2-native-services.test.mjs`, `chat-trace-materialization.test.mjs`, `chat-ui-integration.test.mjs`, `chat-signals-api.test.mjs`, `trace-patch-identity.test.mjs` | Chat Web capability specs, `capabilities/pibo-data-store-and-ingestion.md`, `capabilities/pibo-session-signals.md` |
| Runtime assembly, prompts, model defaults, and Codex compatibility | `base-prompt.test.mjs`, `compaction-prompt.test.mjs`, `codex-compat.test.mjs`, `model-defaults.test.mjs`, `model-catalog.test.mjs`, `channel-runtime.test.mjs` | `capabilities/runtime-prompt-and-compaction.md`, `capabilities/pibo-runtime-assembly-and-inspection.md`, `capabilities/codex-compatible-runtime-profile.md` |
| Extension systems | `plugin-registry.test.mjs`, `agent-store.test.mjs`, `agent-profiles.test.mjs`, `context-files-web.test.mjs`, `user-skills.test.mjs`, `pi-packages.test.mjs`, `mcp-cli.test.mjs`, `mcp-agent-context.test.mjs` | `capabilities/plugin-registry-and-capability-catalog.md`, `capabilities/custom-agents.md`, `capabilities/context-files.md`, `capabilities/user-skills.md`, `capabilities/pi-packages.md`, `capabilities/mcp-server-integration.md` |
| Operator capabilities | `config.test.mjs`, `debug-cli.test.mjs`, `data-cli.test.mjs`, `cron-schedule-store.test.mjs`, `tools-cli.test.mjs`, `local-routed-tui.test.mjs` | `capabilities/local-config-cli.md`, `capabilities/debug-cli.md`, `capabilities/pibo-data-store-and-ingestion.md`, `capabilities/scheduled-pibo-jobs.md`, `capabilities/curated-cli-tools.md`, `capabilities/local-routed-tui.md` |
| Runtime tools and delegation | `runs.test.mjs`, `runtime-tool.test.mjs`, `subagents.test.mjs`, `signal-registry.test.mjs` | `capabilities/yielded-run-control.md`, `capabilities/persistent-code-runtime-tool.md`, `capabilities/subagent-delegation.md`, `capabilities/pibo-session-signals.md` |

## Remaining Gaps

### Gap: Verification sections are present but not equally actionable

Many specs name source files but do not name the tests that protect each behavior. Others include test names in traceability rows. This makes coverage hard to audit automatically.

**Future acceptance check:** For a high-value spec, each traceability row either names one or more current tests or explicitly says `Source-inspected only`.

### Gap: Status terms do not encode verification strength

A row marked `Implemented` may mean the current source has the behavior, but it does not always say whether a test protects it. A row marked `Draft` may still describe existing implemented behavior. This weakens the value of the traceability table.

**Future acceptance check:** Specs use the status vocabulary from `capabilities/spec-status-and-traceability.md`, and verification strength is recorded separately from implementation state.

### Gap: UI behavior specs need clearer test granularity

Chat Web and Context Files UI behavior is partly tested through integration-style projection tests and browser-independent component logic. Specs should distinguish direct UI tests, server API tests, trace projection tests, and source-inspected UI contracts.

**Future acceptance check:** UI specs map requirements to the type of protection they have: API test, projection test, component/integration test, browser check, or source-inspected only.

### Gap: CLI discovery behavior spans many command families

General CLI discovery and command-specific specs are both covered, but tests are split across command-family files. Future traceability updates should avoid claiming that one broad CLI test protects all progressive-discovery rules.

**Future acceptance check:** CLI specs cite command-family tests for specific command branches and cite `operator-cli-discovery-and-dispatch.md` only for shared root-dispatch rules.

### Gap: Scheduled-job coverage is store-heavy

`cron-schedule-store.test.mjs` covers schedule parsing and persistence behavior. The visible routed-run and Chat Web cron API behavior in `capabilities/scheduled-pibo-jobs.md` should be marked separately if it is source-inspected or covered by other tests.

**Future acceptance check:** Scheduled-job traceability distinguishes schedule/store tests from routed execution, target access, and Chat Web API checks.

## Recommended Next Coverage Work

1. Update `docs/specs/capabilities/pibo-session-store.md` with a requirement-to-test traceability pass. It has strong direct tests and is a good template.
2. Update one Chat Web spec with verification-kind labels to establish a UI traceability pattern.
3. Update `docs/specs/capabilities/scheduled-pibo-jobs.md` to separate store-tested behavior from source-inspected routed execution behavior.
4. Add a small checker later only if the table format becomes stable enough to parse.

## Success Criteria for This Analysis

- [x] The artifact is under `docs/specs/coverage/`.
- [x] It does not duplicate an existing capability spec.
- [x] It treats the current code and tests as the source of truth.
- [x] It identifies actionable future traceability work.
- [x] It avoids source-code and test changes.

## Verification Basis

This analysis is based on:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/README.md`
- the full current file list under `docs/specs/`
- `docs/specs/coverage/source-specs-coverage-2026-05-10.md`
- `package.json`
- the current test inventory under `test/*.test.mjs`
- representative source-backed specs under `docs/specs/capabilities/`
