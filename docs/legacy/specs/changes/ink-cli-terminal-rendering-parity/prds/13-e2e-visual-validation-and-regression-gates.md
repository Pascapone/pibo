---
type: "Historical Record"
title: "PRD 13: E2E Visual Validation and Regression Gates"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/ink-cli-terminal-rendering-parity/prds/13-e2e-visual-validation-and-regression-gates.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "181fc7727b206210c23852f0b600bc216a3cf149"
  source_bytes: 3330
  source_sha256: "c035768430b668562099eac3e4490e3e53a8292a03af32f3063cdeec4204a6dc"
  source_body_sha256: "c035768430b668562099eac3e4490e3e53a8292a03af32f3063cdeec4204a6dc"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# PRD 13: E2E Visual Validation and Regression Gates

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `../tasks.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

The team needs a final gate that proves the TUI has converged toward Web Terminal behavior. Unit tests alone cannot prove layout, spacing, keyboard flows, room-name resolution, or real local runtime behavior.

### Proposed Solution

Add a final validation suite and report. It combines shared model tests, Web semantic-hook tests, Ink snapshots, PTY visual smoke tests, no-color/narrow checks, default-path room/session checks, and acceptance documentation.

### Success Criteria

- SC-13-01: Shared, Web, Ink, and PTY gates cover every matrix row from PRD 08.
- SC-13-02: Final report records commands, artifacts, observed results, limitations, and pass/fail state.
- SC-13-03: `npm run typecheck`, `npm test`, `npm run chat-ui:typecheck`, and `npm run chat-ui:build` pass when affected.
- SC-13-04: The final `pibo tui:sessions` default-path evidence includes `/status`, long output, JSON, slash commands, room/session names, and no startup warning noise.

## 2. Validation Flows

### Shared/model tests

- Row ordering and statuses.
- Preview counts and omitted metadata.
- Card/structured exception descriptors.
- Room/session label resolution.
- Slash-command matrix.
- Redaction.

### Web checks

- Compact Terminal consumes shared fixtures.
- Semantic hooks still exist for rows, status fields, progress, details, and structured cards.
- Collapsed/expanded behavior still matches Web expectations.

### Ink checks

- Snapshots for row-first grammar, spacing, no-color, narrow terminal, JSON, markdown, status, details, and pickers.
- Static import boundary checks.

### PTY checks

- `/status` runtime data and remaining quota.
- Long output collapsed preview and detail expansion.
- JSON function-call/detail rendering.
- Markdown/code rendering.
- Slash palette and command matrix spot checks.
- Room/session named navigation.
- No startup warning noise.
- NO_COLOR/narrow terminal variant.

## 3. Evidence Requirements

Each PTY run must save:

- raw ANSI
- clean text
- final screen
- metadata
- input/assertions
- event log where available
- visual HTML/SVG/PNG artifact or documented fallback

The report must classify each evidence path as real/default, fake fixture, demo renderer, or mocked.

## 4. Acceptance Report

Create or update `docs/reports/ink-cli-terminal-web-derived-parity-final-YYYY-MM-DD.md` with:

- matrix coverage summary
- commands run
- artifact paths
- screenshots/HTML links if available
- known limitations and follow-ups
- production/deployment state

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

## 5. Non-Goals

- Production deployment.
- Pixel-perfect screenshot diffing.
- Mouse support beyond existing Web behavior.
