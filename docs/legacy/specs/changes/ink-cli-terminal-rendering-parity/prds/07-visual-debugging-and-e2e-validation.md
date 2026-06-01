# PRD 07: Visual Debugging and End-to-End Validation

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

### Problem Statement

The previous implementation passed many tests while still looking unacceptable in real terminal output. Text assertions and source-level checks are not enough for a visual TUI. Ralph and human reviewers need artifact-backed visual evidence for Web and TUI parity.

### Proposed Solution

Establish a validation pipeline that captures real PTY output, clean/golden screen snapshots, and screenshot-like ANSI render artifacts. Pair these with shared fixture tests and Web Compact Terminal regression checks so visual and behavioral parity can be reviewed before marking stories complete.

### Success Criteria

- SC-01: Key TUI flows produce PTY artifacts: raw ANSI, clean text, final screen, events, metadata, assertions.
- SC-02: At least one visual artifact format exists for reviewing ANSI output as HTML/SVG/PNG, or a documented fallback is committed.
- SC-03: Golden/semantic screen tests cover slash palette, status card, pickers, mixed transcript, and streaming.
- SC-04: Final validation includes installed/global `pibo tui:sessions` PTY smoke tests and Web regression checks.

## 2. User Experience & Functionality

### User Personas

- **Reviewer:** Needs to see what the terminal actually rendered.
- **Ralph agent:** Needs objective pass/fail checks and artifact paths before completing stories.
- **Developer:** Needs reproducible commands to inspect TUI regressions locally.

### User Stories

- As a reviewer, I want PTY screen artifacts so I can judge whether the TUI matches the design intent.
- As an implementer, I want visual golden tests so design regressions fail automatically.
- As a Web user, I want Web and TUI fixture outputs compared so parity remains grounded in the same render logic.

## 3. PTY Artifact Requirements

Each user-facing TUI story MUST capture PTY artifacts when feasible:

```text
raw.ansi.log
clean.txt
screen.txt
events.jsonl
metadata.json
assertions.json
```

### Required PTY Scenarios

- Startup owner/room/session picker flow.
- Slash palette: type `/`, filter, accept/run command.
- `/status` while no session or room picker is active.
- `/status` while a picker is open.
- `/status` while running/streaming rows are visible, using fake/deterministic data if live streaming is impractical.
- Mixed transcript with user, assistant, reasoning, tool, status, error.
- `/thinking` picker and direct argument.
- `/model` or `/login` nested picker flow with deterministic provider data.
- Narrow terminal width.
- `NO_COLOR=1` terminal output.

### Real Path Requirement

At least final validation MUST include an installed/global command path:

```bash
pibo tui:sessions
```

Mocked/fake PTY tests are acceptable for deterministic visual states, but not sufficient as the only evidence for default user behavior.

## 4. Visual Artifact Requirements

### Target

Generate one of:

- ANSI-to-HTML artifact
- ANSI-to-SVG artifact
- ANSI-to-PNG screenshot
- terminal emulator screenshot if available

### Fallback

If no converter is available:

- document why conversion is unavailable
- keep raw ANSI and `screen.txt`
- include clean excerpts in `docs/reports/`
- make converter setup a tracked follow-up task

### Acceptance Criteria

- Visual artifact command is documented.
- Artifact path is written to a report.
- Reviewers can inspect status card, slash palette, and mixed transcript without rerunning commands.

## 5. Golden and Semantic Tests

### Golden Screen Tests

Add selected stable golden tests for:

- slash palette layout
- status card compact layout with bars
- room/session picker layout
- mixed transcript row order and markers
- narrow output
- no-color output

Golden tests should compare normalized `screen.txt` or renderToString output with stable dynamic values removed.

### Semantic Tests

Add semantic tests for:

- row kind/status order
- user vs assistant marker difference
- command result placement above prompt
- status progress bar presence/absence
- unavailable states compactness
- secret redaction
- streaming order preservation
- Web semantic hooks and shared descriptor consumption

## 6. Web Validation Requirements

- Web Compact Terminal must keep using shared row/card descriptors.
- Web source or renderer tests must verify stable semantic hooks.
- Where browser tooling is available, capture Web Compact Terminal screenshot/reference for the same fixture.
- `npm run chat-ui:typecheck` and `npm run chat-ui:build` are required.

## 7. Completion Evidence Requirements

Every Ralph story from these PRDs must record:

- files changed
- tests run
- PTY command(s)
- artifact directory paths
- whether path was fake/demo/mocked or real/default
- visual artifact path or fallback reason
- known remaining gaps

Final completion requires:

- `npm run typecheck`
- `npm test`
- `npm run chat-ui:typecheck`
- `npm run chat-ui:build`
- installed/global `pibo tui:sessions` PTY smoke
- report under `docs/reports/`

## 8. Risks & Non-Goals

### Risks

- ANSI visual artifacts may differ across terminal renderers. Treat them as review aids plus semantic assertions.
- Live model/provider flows may be unavailable. Use deterministic fixtures for visual states and document limitations.

### Non-Goals

- Full browser-use automation unless available and useful.
- Pixel-perfect Web/Ink screenshot diffing.
- Restarting the production gateway as part of validation.
