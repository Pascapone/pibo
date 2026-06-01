# Coverage Note: Source Specs Refresh Final Sweep 2026-05-17

**Status:** Coverage note, not a behavior spec
**Created:** 2026-05-17
**Controller / Source:** Ralph Source Specs Refresh Ledger
**Related docs:** `docs/reports/source-specs-refresh/source-specs-refresh-ledger.json`, `docs/specs/capabilities/spec-status-and-traceability.md`

## Purpose

This note records the final broad source-marked spec sweep after the high-risk Project/Workflow, telemetry, skills/runtime, gateway/CLI, store/data, and Web Annotations queue items were audited.

The sweep looked for source-backed current-behavior claims under `docs/specs/capabilities/` and `docs/specs/coverage/` that were stale against the current worktree. It avoids creating duplicate capability specs.

## Inventory Result

- Capability inventory scanned: 76 top-level capability specs.
- Previously refreshed in this ledger before the final sweep: high-risk specs listed in the ledger `completed` entries.
- Final-sweep updates made to existing owning specs:
  - `docs/specs/capabilities/continuous-ralph-jobs.md`
  - `docs/specs/capabilities/shared-terminal-view-model.md`
  - `docs/specs/capabilities/chat-web-persistence-diagnostics-api.md`
  - `docs/specs/capabilities/local-config-cli.md`
  - `docs/specs/capabilities/chat-web-static-shell-and-pwa-assets.md`
  - `docs/specs/capabilities/mcp-registry-python-runtimes.md`
- No new capability spec was created.
- One prior queue item remains intentionally blocked by the open bootstrap catalog controller-cache decision request recorded in the ledger.

## Source-Backed Findings

### Continuous Ralph Jobs

The owning Ralph capability spec was stale for current stop-policy behavior. Current source includes `src/ralph/stopping.ts`, persisted `stopPolicy` and condition state, built-in and plugin-registered stop conditions, `conditions`, `templates`, and `policy` CLI surfaces, Chat Web condition/template endpoints, and tests for stop conditions and templates. The spec now records those current behaviors without moving them into a separate duplicate spec.

### Shared Terminal View Model

The shared terminal view model spec still described extraction as target work, but the current source has already moved the row model to `src/session-ui/`, retained Chat Web compatibility re-exports, and wired the Ink CLI to the same row builder. The spec now records the implemented source-backed behavior and test evidence.

### Verification-Basis and Path Hygiene

The sweep also found small documentation hygiene gaps:

- `chat-web-persistence-diagnostics-api.md` referenced the old Chat data ingestion path; it now points at `src/data/ingest-service.ts`.
- `local-config-cli.md` and `chat-web-static-shell-and-pwa-assets.md` used `Source Basis` headings even though the current docs convention expects `Verification Basis`.
- `mcp-registry-python-runtimes.md` lacked an explicit `Verification Basis`; it now records current source evidence and the empty-registry source-inspected boundary.

## No-Change Classifications

The remaining source-marked coverage notes from 2026-05-10 and 2026-05-11 are historical coverage and verification artifacts. They were treated as guidance and inventory context, not as current behavior specs to rewrite wholesale.

The final sweep did not identify another current-code capability that lacks an owning spec. Future source-spec runs should update existing owning specs only when source behavior changes or when a concrete traceability/test-evidence gap becomes clearer in the owning spec than in a coverage note.

## Verification Basis

Commands and source evidence used for this sweep:

- `find docs/specs/capabilities -maxdepth 1 -type f -name '*.md'`
- `rg` scans for source-backed/current-code markers under `docs/specs/capabilities` and `docs/specs/coverage`
- `src/ralph/store.ts`, `src/ralph/service.ts`, `src/ralph/stopping.ts`, `src/ralph/templates.ts`, `src/ralph/cli.ts`, `src/apps/chat/ralph-api.ts`, `src/apps/chat-ui/src/RalphArea.tsx`
- `test/ralph-runtime-overrides.test.mjs`, `test/ralph-stop-conditions.test.mjs`, `test/ralph-templates.test.mjs`
- `src/session-ui/`, `src/apps/chat-ui/src/session-views/compact-terminal/`, `src/apps/cli-ui/`, `test/session-ui-terminal-rows.test.mjs`, `test/cli-ui-ink-renderer.test.mjs`, `test/cli-ui-session-app.test.mjs`, `test/cli-session-source.test.mjs`
- `src/config/config.ts`, `src/core/pibo-home.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/public/sw.js`, `src/mcp/registry.ts`, `src/mcp/python-runtime.ts`
