---
type: "Historical Record"
title: "PRD: Ink CLI Session UI V2 — Shared Terminal View Model V2"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/ink-cli-session-ui-v2-web-parity/prds/03-shared-terminal-view-model-v2.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "641f06b79ec1dfafaad7c399cc5975c55cd9a968"
  source_bytes: 2762
  source_sha256: "e0a9e125d5497190e430174577efc7bcf18e4dfbdc59f99dad00a5fbcb61a853"
  source_body_sha256: "e0a9e125d5497190e430174577efc7bcf18e4dfbdc59f99dad00a5fbcb61a853"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# PRD: Ink CLI Session UI V2 — Shared Terminal View Model V2

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../design.md`, `../spec.md`

## 1. Executive Summary

- **Problem Statement**: Web and Ink currently share compact terminal rows, but rich terminal cards, status summaries, command menus, and interaction descriptors remain Web-only or CLI-specific.
- **Proposed Solution**: Extend `src/session-ui` into the renderer-neutral boundary for rows, cards, status descriptors, command descriptors, owner/room/session pickers, and command results.
- **Success Criteria**:
  - SC-01: Web Compact Terminal View and Ink consume shared descriptors for representative transcript/card/status states.
  - SC-02: Shared modules do not import DOM, Ink, React renderer, CSS, or browser APIs.
  - SC-03: Tests prove shared model parity for Web and CLI inputs.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user who expects terminal output to match Web semantics.
  - Web user who expects existing Web terminal behavior to remain intact.
  - Implementer who needs a stable reuse boundary.

- **User Stories**:
  - As a user, I want status/thinking/model/login/tool cards to have the same meaning in Web and CLI.
  - As an implementer, I want shared descriptors so the two renderers do not drift.
  - As a reviewer, I want tests that prove the shared descriptor output is renderer-neutral.

- **Acceptance Criteria**:
  - Add shared descriptors for terminal cards, status summaries, command menus, command results, and picker items.
  - Existing `buildCompactTerminalRows()` remains available and compatible.
  - Web renderer maps descriptors to DOM/Tailwind components.
  - Ink renderer maps descriptors to Ink components without importing Web components.
  - Shared tests cover representative assistant, reasoning, tool, yielded-run, error, status, model, login, and thinking cases.

## 3. Technical Notes

- Proposed modules:
  - `src/session-ui/terminalCards.ts`
  - `src/session-ui/statusViewModel.ts`
  - `src/session-ui/commandCatalog.ts`
  - `src/session-ui/commandResults.ts`
  - `src/session-ui/ownerViewModel.ts`
  - `src/session-ui/roomSessionViewModel.ts`
- Keep renderer-specific keyboard/mouse handling outside shared modules.
- Shared models may include action descriptors but not execute actions.

## 4. E2E / PTY Requirements

- Shared model stories are primarily unit-test driven.
- If a story changes user-facing CLI rendering, add a `pibo debug pty ...` snapshot/assertion covering the rendered descriptor through the real CLI path.

## 5. Risks & Non-Goals

- Do not reduce Web quality to fit terminal limitations.
- Do not import Ink into shared model code.
- Do not import Web DOM components into CLI code.
