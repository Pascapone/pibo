# PRD: Ink CLI Session UI — Shared Terminal View Model

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../../capabilities/shared-terminal-view-model.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: The Web compact terminal already has useful trace-to-row logic, but it lives in a Web UI path and cannot be cleanly reused by the native CLI without risking duplicated mapping logic.
- **Proposed Solution**: Extract or re-export the compact terminal row model through a renderer-neutral boundary that both Web Chat and Ink CLI can consume.
- **Success Criteria**:
  - SC-01: Shared terminal row modules are free of React DOM, browser, CSS, Virtuoso, lucide, and Ink dependencies.
  - SC-02: Web compact terminal and Ink CLI can import the same row-generation contract.
  - SC-03: Tests cover representative row kinds, previews, and truncation behavior.
  - SC-04: Web Chat typecheck/build remains green.

## 2. User Experience & Functionality

- **User Personas**:
  - Web UI maintainer preserving current compact terminal behavior.
  - CLI implementer needing renderer-neutral rows.
  - Runtime engineer validating trace-to-row consistency.

- **User Stories**:
  - As a CLI implementer, I want compact terminal rows in a shared module so that I can render Pibo sessions in Ink without copying Web mapping code.
  - As a Web UI maintainer, I want Web terminal behavior preserved so that users do not see unintended browser UI changes.
  - As a runtime engineer, I want row-generation tests so that trace changes do not silently break either renderer.

- **Acceptance Criteria**:
  - Shared modules expose row, line, token, status, and detail types.
  - Shared row generation accepts `PiboSessionTraceView` or the existing canonical trace input.
  - Existing Web compact terminal imports are updated or compatibility re-exports are added.
  - Tests cover user message, assistant message, tool call, tool result, yielded run, error, long text, and missing optional fields.

- **Ralph Work Package Derivation**:
  - `US-001`: create renderer-neutral terminal view-model boundary.
  - `US-002`: migrate Web imports without changing behavior.
  - `US-003`: add row-generation and truncation tests.

- **Non-Goals**:
  - Implementing Ink renderer.
  - Changing Web component styling.
  - Changing trace-event semantics.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing TypeScript test runner.
  - Existing trace fixtures or new minimal fixtures.

- **Evaluation Strategy**:
  - Unit tests for deterministic row output.
  - Typecheck for root and Chat Web.
  - Optional snapshot comparison for existing row output where feasible.

## 4. Technical Specifications

- **Architecture Overview**:
  - Move or re-export `terminalRows.ts` and `terminalValue.ts` through a shared UI-neutral module such as `src/session-ui/`.
  - Web compact terminal imports the shared module.
  - Future Ink renderer imports the same module.

- **Integration Points**:
  - `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
  - `src/apps/chat-ui/src/session-views/compact-terminal/terminalValue.ts`
  - `src/shared/trace-types.ts`
  - `src/shared/trace-engine.ts`

- **Security & Privacy**:
  - Preview logic must remain bounded.
  - Shared details should not force unbounded rendering of tool args/results.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: shared module/re-export with tests.
  - V1: both Web and CLI consume shared row model.
  - Later: formalize row kinds as a versioned contract if external consumers appear.

- **Technical Risks**:
  - Import cycles between shared and Web modules.
  - Accidental renderer dependency in shared code.
  - Unintended Web behavior changes.
