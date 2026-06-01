# PRD Catalog: Ink CLI Session UI V2 Web Parity

**Status:** Draft  
**Created:** 2026-05-16  
**Source change:** `docs/specs/changes/ink-cli-session-ui-v2-web-parity/`

This catalog converts the V2 Web-parity change spec into implementation-grade PRDs and Ralph-ready JSON story batches.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../../ink-cli-session-ui/spec.md`

## Product Position

`pibo tui:sessions` V2 is a host-root recovery/admin terminal companion for the Web Session UI. It must resolve an effective owner scope, navigate rooms and sessions like Web Chat, support the Web Slash Command catalog where terminal-safe, and render through Ink from shared headless terminal view models.

The target is not direct DOM reuse. Web and Ink share renderer-neutral models; Web renders them with DOM/CSS and Ink renders them with terminal primitives.

## PRDs

| PRD | Scope | Ralph JSON |
|---|---|---|
| `01-product-scope-and-current-state.md` | Product framing, current-state audit, Web-parity guardrails | `prd_01_product_scope_and_current_state.json` |
| `02-owner-scope-recovery-profile.md` | Effective owner selection, Root recovery owner, owner switching, `user:unknown` repair | `prd_02_owner_scope_recovery_profile.json` |
| `03-shared-terminal-view-model-v2.md` | Shared rows, cards, status, command, owner/room/session descriptors | `prd_03_shared_terminal_view_model_v2.json` |
| `04-room-session-navigation.md` | Owner -> room -> session startup, `/session`, `/room`, `/new`, Web-visible sessions | `prd_04_room_session_navigation.json` |
| `05-slash-command-catalog-and-actions.md` | Shared Slash Command catalog, suggestions, routed action execution | `prd_05_slash_command_catalog_and_actions.json` |
| `06-interactive-keyboard-flows.md` | Keyboard-native `/thinking`, `/model`, `/login`, fork/upload/download flows | `prd_06_interactive_keyboard_flows.json` |
| `07-web-parity-rendering-and-pty-validation.md` | Ink Web-parity renderer, rich cards, PTY E2E validation, docs/deploy checks | `prd_07_web_parity_rendering_and_pty_validation.json` |

## Ralph Execution Order

1. `prd_01_product_scope_and_current_state.json`
2. `prd_02_owner_scope_recovery_profile.json`
3. `prd_03_shared_terminal_view_model_v2.json`
4. `prd_04_room_session_navigation.json`
5. `prd_05_slash_command_catalog_and_actions.json`
6. `prd_06_interactive_keyboard_flows.json`
7. `prd_07_web_parity_rendering_and_pty_validation.json`

## Mandatory Validation Rules

- Every CLI/TUI story must include a real PTY-backed validation criterion using `pibo debug pty ...` when the interactive path is in scope.
- Fake/demo/mocked tests may support a story, but they must not be the only evidence for user-facing CLI behavior unless the story explicitly defers real-path validation.
- When a story is marked `passes: true`, notes must record concrete evidence: commands run, PTY scenario, assertions, and raw/clean artifact paths produced by `pibo debug pty`.
- Web-impacting stories must include Web regression checks.
- All stories must include `Typecheck passes`.
- Logic stories must include focused tests.
- Final validation must include `npm test` and an installed/global `pibo tui:sessions` PTY smoke test.
