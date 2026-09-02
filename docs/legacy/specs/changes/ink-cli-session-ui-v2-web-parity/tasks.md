---
type: "Historical Record"
title: "Tasks: Ink CLI Session UI V2 Web Parity"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/ink-cli-session-ui-v2-web-parity/tasks.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "16456aec62fe29ace76eff666530b0d67a75ce3e"
  source_bytes: 3992
  source_sha256: "a628e21cc833dd789f7917084551670c46027ae27156928abf09290ab76884c0"
  source_body_sha256: "a628e21cc833dd789f7917084551670c46027ae27156928abf09290ab76884c0"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Tasks: Ink CLI Session UI V2 Web Parity

**Status:** Draft seed for later PRD/Ralph splitting. Do not treat this as final implementation scope until PRDs are approved.

## 1. Current-State Verification

- [ ] 1.1 Document current shared surface: `src/session-ui/terminalRows.ts`, `src/session-ui/terminalValue.ts`.
- [ ] 1.2 Document DOM-only Web Compact Terminal components under `src/apps/chat-ui/src/session-views/compact-terminal/`.
- [ ] 1.3 Document current Ink renderer gaps under `src/apps/cli-ui/`.
- [ ] 1.4 Enumerate Web Slash Commands from gateway capabilities and Web-added commands.
- [ ] 1.5 Verify Web visibility of sessions created by current `pibo tui:sessions`.
- [ ] 1.6 Reproduce the owner-scope bug where CLI-created sessions use `user:unknown` and are hidden from the authenticated Web user.

## 2. Owner Scope and Recovery Profile

- [ ] 2.1 Add owner discovery for known Web/session owner scopes.
- [ ] 2.2 Define and create/use a stable Root recovery owner when no Web owner exists.
- [ ] 2.3 Add owner picker and `/owner` or `/profile` switch flow.
- [ ] 2.4 Ensure active owner scope is shown in header and `/status`.
- [ ] 2.5 Prevent new sessions/messages/actions from silently using `user:unknown`.
- [ ] 2.6 Add a repair/reassignment path or diagnostic for legacy `user:unknown` CLI sessions.
- [ ] 2.7 Test that selecting a Web owner makes CLI-created sessions visible in that user's Web UI navigation.

## 3. Shared View Models

- [ ] 3.1 Add shared descriptors for terminal cards/status/menu results in `src/session-ui`.
- [ ] 3.2 Move reusable status/progress/quota formatting into `src/session-ui`.
- [ ] 3.3 Add shared owner/room/session picker descriptors.
- [ ] 3.4 Add tests proving Web and Ink consume the same descriptors.

## 4. Room and Session Navigation

- [ ] 4.1 Expand CLI source owner and room contracts.
- [ ] 4.2 Implement selected-owner Personal Chat/default-room mapping.
- [ ] 4.3 Implement owner picker -> room picker -> session picker overlay in Ink.
- [ ] 4.4 Make `/session` owner/room-aware and room-first.
- [ ] 4.5 Make `/new` owner-scoped, room-scoped, and Web-visible.

## 5. Slash Command Catalog and Suggestions

- [ ] 5.1 Add shared command catalog descriptors from gateway capabilities.
- [ ] 5.2 Include CLI-only commands `/help`, `/new`, `/room`, `/agent`, `/owner` or `/profile`, `/exit`, and `/quit`.
- [ ] 5.3 Implement filtered slash suggestions in Ink.
- [ ] 5.4 Replace hard-coded V1 `/help` text with catalog-generated help.
- [ ] 5.5 Add unsupported-command reasons for browser-only/product-area commands.

## 6. Action Execution

- [ ] 6.1 Add CLI source action execution for routed session actions under the selected owner.
- [ ] 6.2 Support `/status`, `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast`, `/session-current`, `/sessions`, `/clone`.
- [ ] 6.3 Support `/thinking` direct argument and picker flow.
- [ ] 6.4 Support `/model` provider/model picker flow.
- [ ] 6.5 Support `/login` provider/auth-method terminal flow.
- [ ] 6.6 Define terminal equivalents or unsupported reasons for `/download`, `/upload`, and fork-related flows.

## 7. Ink Web-Parity Rendering

- [ ] 7.1 Implement Ink renderers for shared status, thinking, model, login, tool, yielded-run, and error descriptors.
- [ ] 7.2 Align markers, labels, ordering, colors, and collapsed/expanded behavior with Web Compact Terminal View.
- [ ] 7.3 Add narrow-terminal and no-color fallbacks.

## 8. Validation

- [ ] 8.1 Run unit tests for shared models and catalog filtering.
- [ ] 8.2 Run CLI source integration tests with fake router/actions.
- [ ] 8.3 Run owner-scope integration tests for selected Web owner, Root recovery owner, and legacy `user:unknown` session handling.
- [ ] 8.4 Run pseudo-TTY smoke tests for owner picker, room picker, slash suggestions, `/thinking`, and `/status`.
- [ ] 8.5 Run Web Chat regression tests.
- [ ] 8.6 Run `npm test`.
- [ ] 8.7 Install globally and test `pibo tui:sessions` over SSH.
