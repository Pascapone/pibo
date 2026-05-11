# Coverage Analysis: Source Specs Coverage Checkpoint 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `docs/specs/coverage/source-specs-verification-handoff-2026-05-11.md`, `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`, `docs/specs/capabilities/continuous-ralph-jobs.md`, `docs/specs/capabilities/model-provider-auth-and-session-selection.md`, `docs/specs/capabilities/chat-web-projects-area.md`

## Why

This scheduled run found broad capability coverage already present under `docs/specs/capabilities/`, including recent source-backed specs for Ralph, Projects, provider/model auth, Chat Web views, data stores, runtime assembly, CLI surfaces, and build/deployment behavior. Creating another capability spec from the same code would duplicate existing contracts.

This checkpoint records the current coverage decision and defines testable rules for future scheduled runs so they add new prose only when the current code exposes a real uncovered capability or a material behavior change.

## Goal

Future source-specs runs MUST prefer strengthening existing owning specs or adding verification evidence over creating duplicate capability documents for behavior that is already source-backed.

## Scope

### In Scope

- Current `src/`, `scripts/`, `packages/workflows/`, and `test/` source coverage posture.
- Existing `docs/specs/capabilities/` ownership boundaries.
- The next useful documentation action when no new uncovered capability is found.

### Out of Scope

- Source-code changes or test implementation.
- Rewriting legacy documents outside `docs/specs/`.
- Treating legacy docs as more authoritative than current code.

## Current Coverage State

The current spec inventory contains focused capability specs for the major product seams visible in source:

- Runtime/session core: routing, session store, runtime assembly, prompts, thinking controls, event contracts, signals, yielded runs, subagents, profile/plugin registry, and native web search.
- Chat Web: rooms/events, cache/live state, Projects, Ralph, cron, settings, context area, terminal/trace/session views, safe rendering, PWA/static shell, file downloads, and persistence diagnostics.
- Operator surfaces: progressive CLI dispatch, config, debug, data maintenance, tools, MCP, Pi packages, Docker compute workers, gateway lifecycle/request client/send tool, deployment scripts, standalone Docker runtime, and validation harness.
- Durable stores: local store ownership, data v2 ingestion, reliability event core, cron jobs, Ralph jobs, custom agents, context files, user skills, and model/user settings.
- Workflow package: durable change specs plus a current package capability spec.

The strongest remaining source-to-spec gap is not missing capability prose. It is verification depth: several specs now include source-inspected behavior and recommended test matrices, but the tests do not yet cover every matrix row.

## Requirements for Future Scheduled Runs

### Requirement: New capability specs require uncovered behavior

A scheduled run MUST create a new `docs/specs/capabilities/*.md` file only when current source exposes a product or technical capability that is not already owned by an existing capability spec.

#### Acceptance

- If a source path is already named in an owning spec's traceability or verification basis, the run does not create a second spec for that same behavior.
- If behavior spans several specs, the run chooses the smallest owning spec to update rather than adding a broad duplicate.
- If no uncovered capability is found, the run writes a coverage analysis instead of a duplicate capability spec.

#### Scenario: Ralph is inspected again

- GIVEN `src/ralph/*`, `src/apps/chat/ralph-api.ts`, and `src/apps/chat-ui/src/RalphArea.tsx` remain unchanged
- WHEN a future run searches for uncovered continuous-job behavior
- THEN it treats `docs/specs/capabilities/continuous-ralph-jobs.md` as the owning spec
- AND it adds no new Ralph capability spec.

### Requirement: Existing specs are extended only for material source-backed gaps

A scheduled run MAY extend an existing spec when the current code shows a behavior gap, verification matrix gap, or traceability gap that belongs to that spec and is clearer there than in a new document.

#### Acceptance

- The update names the source files inspected.
- The update adds testable behavior, verification coverage, traceability, or a specific open question.
- The update does not restate requirements already present in the same spec.

#### Scenario: Provider usage tests are added

- GIVEN tests are added for `src/auth/openai-codex-usage.ts`
- WHEN a future run updates specs
- THEN it updates `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- AND moves the relevant OpenAI Codex usage rows from source-inspected to directly tested.

### Requirement: Coverage analyses remain decision records, not parallel specs

Coverage files under `docs/specs/coverage/` MUST explain why no new capability spec was created or what targeted follow-up remains. They MUST NOT become normative replacements for capability specs.

#### Acceptance

- A coverage analysis links to owning capability specs for behavior contracts.
- It records findings, decisions, and next actions in concise, checkable form.
- It does not define new user-visible behavior that conflicts with an owning capability spec.

#### Scenario: No new source island is found

- GIVEN all inspected source paths have owning capability specs
- WHEN the scheduled run completes
- THEN it writes a coverage checkpoint
- AND the checkpoint points future agents back to the owning specs.

### Requirement: Verification gaps are the priority once coverage is broad

When the spec inventory already owns the inspected behavior, future runs SHOULD prefer verification-basis updates, test matrices, or coverage handoffs over additional prose.

#### Acceptance

- Directly tested behavior references actual test files under `test/` or executable scripts.
- Source-inspected-only behavior names concrete source files and the missing test type.
- Recommended tests are grouped by behavior, not by arbitrary source file count.

#### Scenario: Projects behavior is reviewed

- GIVEN `test/project-service-workflow-link.test.mjs` covers workflow session linking but not every Projects API path
- WHEN a future run reviews Projects coverage
- THEN it updates the Projects verification matrix or writes a focused coverage note
- AND it does not create another Projects product spec.

## Findings

### Finding: Major source seams now have owning specs

Current source inspection did not reveal a major unowned capability. The source paths sampled in this run are already owned by current capability specs:

- `src/ralph/store.ts`, `src/ralph/service.ts`, and `src/ralph/cli.ts` are owned by Continuous Ralph Jobs.
- `src/apps/chat/data/project-service.ts` and `src/apps/chat/data/room-service.ts` are owned by Chat Web Projects Area and Chat Web Rooms and Event Streams.
- `src/auth/login-actions.ts` and `src/auth/openai-codex-usage.ts` are owned by Model Provider Auth and Session Model Selection.
- `src/config/config.ts` is owned by Local Config CLI and Local Store Ownership.

### Finding: The remaining useful work is verification movement

Several specs now contain explicit recommended test matrices. Future scheduled runs should move rows from source-inspected to directly tested when new tests appear, or produce narrow coverage notes if a matrix is stale.

### Finding: Duplicate prose would reduce traceability

Adding another capability spec for Ralph, Projects, provider auth, local config, or Chat Web room/session behavior would make it harder to know which spec is authoritative. Existing owning specs should remain the traceability targets.

## Success Criteria

- [ ] SC-001: Future scheduled runs can use this checkpoint to decide whether to create, extend, or skip a capability spec.
- [ ] SC-002: Existing owning specs remain the normative behavior contracts for covered source paths.
- [ ] SC-003: New coverage files stay concise and do not duplicate capability requirements.
- [ ] SC-004: Verification improvements name concrete test files or source-inspected gaps.

## Verification Basis

This checkpoint is based on inspection of:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/` inventory
- `docs/specs/capabilities/continuous-ralph-jobs.md`
- `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- `docs/specs/capabilities/chat-web-projects-area.md`
- `docs/specs/capabilities/local-config-cli.md`
- `src/ralph/store.ts`
- `src/ralph/service.ts`
- `src/ralph/cli.ts`
- `src/apps/chat/data/project-service.ts`
- `src/apps/chat/data/room-service.ts`
- `src/auth/login-actions.ts`
- `src/auth/openai-codex-usage.ts`
- `src/config/config.ts`
- `test/` inventory
