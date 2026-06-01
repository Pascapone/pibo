# PRD: Ink CLI Session UI — Ink Renderer

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Web Chat presentation components cannot render in a native terminal because they depend on DOM, CSS, browser events, SVG icons, and browser-only libraries.
- **Proposed Solution**: Build a small Ink renderer that consumes shared compact terminal rows and renders terminal-safe status, transcript lines, JSON, markdown, and details.
- **Success Criteria**:
  - SC-01: Representative compact rows render via Ink without Web-only dependencies.
  - SC-02: `renderToString()` tests cover user, assistant, tool, yielded run, and error rows.
  - SC-03: Markdown and JSON output are bounded and terminal-safe.
  - SC-04: Large row lists render through a bounded window strategy.

## 2. User Experience & Functionality

- **User Personas**:
  - SSH operator reading session output in a terminal.
  - CLI implementer building terminal components.
  - QA engineer verifying terminal snapshots.

- **User Stories**:
  - As an SSH operator, I want user messages, assistant text, tools, and errors to be readable in my terminal so that I can follow the session.
  - As a CLI implementer, I want an Ink renderer over shared rows so that I do not need Web DOM components.
  - As a QA engineer, I want deterministic string-render tests so that CLI output regressions are easy to catch.

- **Acceptance Criteria**:
  - Ink row components use `Box`, `Text`, and terminal-safe helpers.
  - Renderer does not import Web DOM components or browser-only libraries.
  - Row status maps to terminal-safe symbols and colors.
  - JSON output uses bounded pretty printing.
  - Markdown output uses plain terminal text, lists, links, and code blocks.
  - Render tests assert meaningful output for representative rows.

- **Ralph Work Package Derivation**:
  - `US-001`: add Ink dependency and renderer module skeleton.
  - `US-002`: implement row/line/status rendering.
  - `US-003`: implement terminal-safe markdown and JSON helpers.
  - `US-004`: add render-to-string tests and dependency guard checks.

- **Non-Goals**:
  - Interactive session controller.
  - Browser-quality markdown rendering.
  - Interactive JSON tree.
  - DOM virtualization.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Ink runtime and testing utilities.
  - Shared compact terminal row fixtures.

- **Evaluation Strategy**:
  - `renderToString()` snapshots for rows.
  - Typecheck.
  - Static import checks or tests to prevent Web-only renderer imports.

## 4. Technical Specifications

- **Architecture Overview**:
  - `InkTerminalView` receives compact rows and viewport options.
  - `InkTerminalRow` renders one row using kind/status.
  - `InkTerminalLine` renders tokens.
  - `inkMarkdown.ts` and `inkJson.ts` normalize large or rich values.
  - `inkColors.ts` maps status/tone to Ink color props.

- **Integration Points**:
  - Shared terminal view model.
  - Future interactive app state.
  - Ink `renderToString()` for tests.

- **Security & Privacy**:
  - Never expand full hidden tool arguments or secrets by default.
  - Keep details bounded and explicit.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: static renderer over fixtures.
  - V1: renderer plugged into interactive app.
  - Later: details panel, scroll selection, richer syntax highlighting if needed.

- **Technical Risks**:
  - Ink version incompatibility with React version.
  - Terminal width/wrapping differences across environments.
  - Snapshot brittleness from ANSI styling.
