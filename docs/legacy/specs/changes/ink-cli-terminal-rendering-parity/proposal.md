---
type: "Historical Record"
title: "Proposal: Ink CLI Terminal Rendering Parity"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/ink-cli-terminal-rendering-parity/proposal.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "6aa9e175ce68276ca5defc1f848af2e0cb3325ad"
  source_bytes: 3000
  source_sha256: "965b25053ba1d2401f9e0e97ccdb5a025cc56843166b14fa416dc950b14df0a3"
  source_body_sha256: "965b25053ba1d2401f9e0e97ccdb5a025cc56843166b14fa416dc950b14df0a3"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Proposal: Ink CLI Terminal Rendering Parity

## Why

`pibo tui:sessions` now has owner-aware routing, room navigation, Web-visible sessions, and shared `src/session-ui` descriptors. The remaining gap is the user-visible terminal experience. Some CLI command results, especially `/status`, still render as transient header messages instead of chronological terminal rows. The visual style also does not yet consistently follow `TERMINAL_DESIGN.md`.

The next change should keep Web and Ink renderers separate, but make the CLI/TUI follow the same terminal design, flow order, and shared rendering semantics as the Web Compact Terminal View.

## What Changes

- Treat `TERMINAL_DESIGN.md` as the canonical visual contract for both Web Compact Terminal and Ink CLI terminal rendering.
- Keep DOM and Ink components separate, but require both to consume the same renderer-neutral rows, cards, tokens, progress descriptors, and command-result descriptors.
- Render slash-command results in the chronological transcript flow, not as top-level transient messages.
- Add Ink terminal primitives for compact rows, status/thinking/model/login/tool/error cards, detail panels, badges, progress bars, and unavailable states.
- Add parity tests derived from existing Web Compact Terminal behavior and shared fixtures.
- Add visual debugging artifacts for PTY runs, including raw ANSI, clean text, screen state, and an ANSI-rendered HTML/SVG/PNG-style artifact when feasible.

## Capabilities

### New Capabilities

- `ink-terminal-design-conformance`: Ink terminal output follows `TERMINAL_DESIGN.md` within terminal constraints.
- `terminal-rendering-parity-tests`: Web and Ink renderers are tested from the same shared terminal fixtures.
- `terminal-visual-debug-artifacts`: PTY validation produces artifacts suitable for visual review, not only text assertions.

### Modified Capabilities

- `cli-web-parity-terminal`: narrows the reuse boundary to shared headless models plus renderer-specific high-quality renderers.
- `shared-terminal-view-model`: becomes the source of truth for ordering, row kinds, card descriptors, token tones, progress values, and command-result normalization.
- `ink-cli-session-ui`: command results move into the transcript stream and follow Compact Terminal row semantics.

## Impact

- **Code:** `src/session-ui`, `src/apps/cli-ui`, Web Compact Terminal tests, CLI Ink renderer tests, PTY smoke scripts.
- **APIs / CLI:** `pibo tui:sessions` keeps the same command surface. Rendering and command-result placement change.
- **Data:** No schema migration expected. Command-result rows may be persisted later if they correspond to real runtime events; purely local UI rows remain bounded and session-local.
- **Auth / Security:** Existing owner-scope rules remain. Rendering tests must verify secret redaction in both Web and Ink paths.
- **Docs:** This change supersedes the visual/rendering-parity portions of `ink-cli-session-ui-v2-web-parity` that were only partially achieved.
