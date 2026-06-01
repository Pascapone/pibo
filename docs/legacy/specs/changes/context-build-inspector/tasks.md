# Tasks: Context Build Inspector

## Phase 0: Preparation

- [x] T-001: Review `src/core/runtime.ts`, `src/core/system-prompt-template.ts`, `src/core/codex-compat.ts`, `src/tools/web-search.ts`, and Pi `buildSystemPrompt()` for exact contribution boundaries.
- [x] T-002: Identify which runtime assembly helpers should be exported or refactored so snapshot generation reuses production assembly logic.
- [x] T-003: Define final TypeScript types for `PiboContextBuildSnapshot`, `PiboContextBuildNode`, and diagnostics.

## Phase 1: Backend Snapshot

- [x] T-004: Implement read-only `inspectPiboContextBuild()` or equivalent near runtime assembly.
- [x] T-005: Add nodes for base prompt source, prompt template marker contributions, runtime session context, context files, skills, tools, generated tools, provider-backed tools, runtime extensions, and diagnostics.
- [x] T-006: Preserve actual assembly order, including context-file merge order and deterministic extension prompt order.
- [x] T-007: Add redaction for secret-like values in metadata, schema, payload, diagnostics, and hydrated text.
- [x] T-008: Ensure inspection uses non-persistent runtime state and disposes temporary resources.

## Phase 2: Web API

- [x] T-009: Add authenticated Chat Web API endpoint for Build Context snapshots.
- [x] T-010: Support selected-session inspection, including access checks and active model/profile resolution.
- [x] T-011: Make `/apps/chat/context` session-only: show an empty-state hint when no `piboSessionId` is supplied, and do not fall back to profile preview.
- [x] T-012: Return concise API errors for unavailable profiles, unauthorized sessions, and inspection failures.

## Phase 3: Chat Web UI

- [x] T-013: Add `Build Context` to the Context sidebar as its own category.
- [x] T-014: Add API client function and frontend types.
- [x] T-015: Implement `ContextBuildView` with header metadata, Refresh, Expand all, and Collapse all controls.
- [x] T-016: Implement recursive `ContextBuildNodeCard` with collapsed metadata headers and nested expandable children.
- [x] T-017: Render hydrated text in monospaced code wells and structured JSON with the existing JSON renderer pattern where practical.
- [x] T-018: Add copy controls for safe leaf content or rendered subtrees.
- [x] T-019: Match `DESIGN.md`: compact technical cards, cyan active states, slate borders, dark code wells, small functional badges, and nested containment.
- [x] T-020: Verify there is no duplicate final prompt/full prompt block.

## Phase 4: Tests

- [x] T-021: Add backend unit tests for snapshot node structure and read-only behavior.
- [ ] T-022: Add tests for context-file merge order and duplicate handling.
- [x] T-023: Add tests for Tool Prompt Surface separation: prompt text, guidelines, schema, generated origin, and provider payload.
- [x] T-024: Add tests for provider-backed `web_search` so it appears active without a local function definition.
- [ ] T-025: Add redaction tests for token/key/header-like values.
- [ ] T-026: Add API auth/access tests.
- [ ] T-027: Add UI tests or browser checks for sidebar category, collapsed default state, nested expansion, hydrated leaf rendering, and no final prompt duplicate.

## Phase 5: Validation and Deployment

- [ ] T-028: Run typecheck and relevant tests inside a Docker compute worker.
- [ ] T-029: Validate Chat Web UI in the worker browser using the worker web and CDP ports.
- [ ] T-030: Deploy to dev web gateway with `./scripts/deploy-web-dev.sh` after worker validation.
- [ ] T-031: Validate dev gateway manually with an authenticated Chat Web session.
- [ ] T-032: Deploy production only after user approval.

## Acceptance Checklist

- [x] AC-001: Build Context appears in the Context tab sidebar.
- [x] AC-002: Build Context is read-only and does not create visible sessions or transcript entries.
- [x] AC-003: Top-level sections start collapsed.
- [x] AC-004: Parent nodes reveal nested nodes; leaf nodes reveal hydrated content.
- [x] AC-005: Node headers show useful metadata while collapsed.
- [x] AC-006: Tool Prompt Surface distinguishes prompt text, tool schema, generated tools, and provider payloads.
- [x] AC-007: Context-file order matches runtime merge order.
- [x] AC-008: Fully expanded tree represents the startup context without a duplicate final prompt block.
- [x] AC-009: Secrets are redacted.
- [x] AC-010: UI follows `DESIGN.md`.
