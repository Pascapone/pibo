# PRD: Ink CLI Session UI — Session Source and Runtime Integration

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../design.md`, `../tasks.md`, `../../capabilities/local-routed-tui.md`

## 1. Executive Summary

- **Problem Statement**: The CLI needs session creation, selection, messaging, agent selection, and live updates without coupling the UI directly to Web Chat or duplicating Gateway logic.
- **Proposed Solution**: Introduce a small `CliSessionSource` boundary with a local/direct implementation first and room for a future Gateway-backed implementation.
- **Success Criteria**:
  - SC-01: CLI controller can list/create/open sessions through a fake source in tests.
  - SC-02: Local/direct source can send messages and receive live trace/session updates.
  - SC-03: Agent/profile listing and selection use existing profile/runtime mechanisms.
  - SC-04: Source cleanup closes subscriptions and runtime resources.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user selecting or creating sessions.
  - Runtime engineer integrating with Pibo session router/stores.
  - Future implementer adding Gateway-backed mode.

- **User Stories**:
  - As a CLI user, I want `/session` to show available sessions so that I can continue previous work.
  - As a CLI user, I want `/new` to create a session so that I can start fresh from the terminal.
  - As a CLI user, I want `/agent` to list existing profiles so that I can choose the agent for the session.
  - As a runtime engineer, I want a session-source interface so that UI code does not know whether data is local or Gateway-backed.

- **Acceptance Criteria**:
  - `CliSessionSource` defines list rooms, list sessions, create session, open session, send message, list agents, set agent where supported, status, and close behavior.
  - Fake source tests cover controller state transitions.
  - Local/direct source uses existing Pibo runtime/session abstractions where possible.
  - Live updates produce refreshed `PiboSessionTraceView` data for row generation.
  - Unsupported source capabilities return clear errors rather than crashing.

- **Ralph Work Package Derivation**:
  - `US-001`: define `CliSessionSource` types and fake source tests.
  - `US-002`: implement local/direct source skeleton and status reporting.
  - `US-003`: implement session create/open/send message flow.
  - `US-004`: implement live trace updates and cleanup.
  - `US-005`: implement agent/profile listing and selection.

- **Non-Goals**:
  - Gateway-backed source in V1 unless explicitly approved.
  - Web auth/session UI.
  - Full profile editing.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing runtime/session router APIs.
  - Existing profile registry.
  - Existing trace/event view building.

- **Evaluation Strategy**:
  - Unit tests with fake source.
  - Integration-like tests for local source where feasible.
  - Manual TTY test after UI integration.

## 4. Technical Specifications

- **Architecture Overview**:
  - UI dispatches commands to controller.
  - Controller calls `CliSessionSource`.
  - Source opens selected session and subscribes to updates.
  - Updates produce trace view state.
  - Shared row builder converts trace view to transcript rows.

- **Integration Points**:
  - `src/core/runtime.ts`
  - `src/core/session-router.ts`
  - `src/local/tui.ts` patterns where useful
  - `src/core/profiles.ts`
  - `src/shared/trace-engine.ts`
  - session/data stores as appropriate

- **Security & Privacy**:
  - Local CLI operates under local owner/session context unless later Gateway/auth design changes it.
  - Source status should redact secrets.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: fake source and controller tests.
  - V1: local/direct source for CLI.
  - v1.1: optional Gateway-backed source.

- **Technical Risks**:
  - Runtime duplication with existing Web/Gateway APIs.
  - Ambiguous room semantics in local mode.
  - Live update subscription leaks.
