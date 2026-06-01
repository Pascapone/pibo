# PRD: Ink CLI Session UI — Product Overview

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Pibo users need to operate sessions from a native shell when connected over SSH, bootstrapping a server, recovering from a broken Web UI/Gateway, or doing quick local agent work.
- **Proposed Solution**: Build an Ink-based CLI Session UI that provides a reduced Web Chat-derived session workflow while preserving Web Chat as the full-featured primary control center.
- **Success Criteria**:
  - SC-01: A user can start the CLI from a TTY and create or select a Pibo session without opening Web Chat.
  - SC-02: The CLI can send a user message and display live assistant/tool/error output using shared compact terminal rows.
  - SC-03: The CLI implements `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`.
  - SC-04: V1 CLI excludes Projects, Workflows, Cron, Ralph, Agent Designer, full Settings, and full context-management surfaces.
  - SC-05: Web Chat UI remains behaviorally unchanged and continues to typecheck/build.

## 2. User Experience & Functionality

- **User Personas**:
  - SSH operator working on a remote server without browser access.
  - Pibo maintainer recovering from broken Web UI or Web Gateway behavior.
  - AI coding agent needing a minimal session interface.
  - Developer who wants quick terminal access to Pibo chat sessions.

- **User Stories**:
  - As an SSH operator, I want to start a native Pibo session UI in my shell so that I can use Pibo without a browser.
  - As a maintainer, I want the CLI to be a small subset of Web Chat so that recovery usage does not require the full Web control center.
  - As a developer, I want Web and CLI transcript rows to share the same data model so that both interfaces tell the same session story.
  - As a product maintainer, I want Web-only capabilities to stay out of CLI V1 so that CLI scope remains small and robust.

- **Acceptance Criteria**:
  - The V1 CLI command is documented as `pibo tui:sessions`.
  - The new CLI Session UI is documented as a reduced Web Chat subset.
  - Specs state that Web Chat remains the main interface.
  - Specs state that Ink is the terminal rendering approach.
  - Specs state that shared trace/session view models are reused while DOM components are not reused.
  - Specs list V1 in-scope and out-of-scope capabilities.

- **Ralph Work Package Derivation**:
  - `US-001`: finalize the V1 scope and command-name decision in docs.
  - `US-002`: add or update capability docs for CLI Session UI and shared terminal view model.
  - `US-003`: add a CLI/Web boundary checklist so implementation stories do not accidentally port Web-only features.

- **Non-Goals**:
  - Replacing Web Chat.
  - Implementing Projects, Workflows, Cron, Ralph, Agent Designer, full Settings, or full context-management UI in CLI V1.
  - Reusing Web DOM components in Ink.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Pibo CLI command registration.
  - Existing runtime/session routing or local session source.
  - Shared trace/session and terminal row model.
  - Ink renderer for terminal UI.

- **Evaluation Strategy**:
  - Documentation review for scope and Web/CLI boundary.
  - Typecheck after docs and later code stories.
  - Manual TTY smoke test once implementation exists.

## 4. Technical Specifications

- **Architecture Overview**:
  - Pibo session/runtime data produces `PiboSessionTraceView`.
  - Shared terminal view model converts trace data to compact terminal rows.
  - Web Chat renders rows through existing React DOM components.
  - CLI renders rows through new Ink components.

- **Integration Points**:
  - `src/cli.ts` for command registration.
  - Shared trace/session modules.
  - Existing Web compact terminal row generation.
  - Future `src/apps/cli-ui/` and `src/cli-session/` modules.

- **Security & Privacy**:
  - CLI output must remain bounded.
  - CLI must not expose Web-only admin/settings surfaces by accident.
  - CLI must not reveal secrets from config/auth/provider state.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: docs, shared model extraction, static renderer.
  - V1: `pibo tui:sessions`, interactive session selection, agent selection, message sending, live transcript.
  - v1.1/later: optional `/model`, `/thinking`, `/fork`, `/details`, Gateway-backed source.

- **Technical Risks**:
  - Scope creep into Web-only features.
  - Breaking Web Chat while extracting shared model.
  - Terminal performance on large sessions.
