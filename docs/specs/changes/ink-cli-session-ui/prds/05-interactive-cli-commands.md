# PRD: Ink CLI Session UI — Interactive CLI Commands

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: A static renderer is not enough; users need a terminal app that accepts messages, runs a small Slash Command set, and opens session/agent pickers.
- **Proposed Solution**: Build the interactive Ink app and command integration around the shared renderer and `CliSessionSource` controller.
- **Success Criteria**:
  - SC-01: The new command starts an interactive Ink app in a TTY.
  - SC-02: Normal text input sends a message to the selected session.
  - SC-03: V1 Slash Commands work and unsupported commands are rejected clearly.
  - SC-04: Existing `pibo tui` and `pibo tui:routed` commands keep working.

## 2. User Experience & Functionality

- **User Personas**:
  - SSH operator driving Pibo from keyboard only.
  - Developer switching sessions and agents from a terminal.
  - CLI maintainer extending command behavior.

- **User Stories**:
  - As a CLI user, I want to type a message and press Enter so that Pibo receives it.
  - As a CLI user, I want `/session` and `/new` so that I can choose or create work from the shell.
  - As a CLI user, I want `/agent` so that I can switch existing profiles without opening Web Chat.
  - As a CLI user, I want `/help` and `/status` so that I understand the current mode and limitations.
  - As a CLI maintainer, I want root command discovery so users can find the new UI.

- **Acceptance Criteria**:
  - The CLI app renders status bar, transcript viewport, and input line.
  - `Enter` sends normal text input.
  - `/help` lists supported commands and Web-only exclusions.
  - `/session` opens a keyboard-selectable session picker.
  - `/new` creates a session flow.
  - `/agent` opens a keyboard-selectable agent/profile picker.
  - `/status` displays current session/source/agent/model state where known.
  - `/clear` clears local display state but does not delete session data.
  - `/exit` and `/quit` exit cleanly.
  - Unknown commands produce a clear error.
  - Root CLI discovery includes the new command.

- **Ralph Work Package Derivation**:
  - `US-001`: register command and help/discovery text.
  - `US-002`: implement app shell with status, transcript, and input.
  - `US-003`: implement command parser and local commands.
  - `US-004`: implement session picker and new-session flow.
  - `US-005`: implement agent picker.
  - `US-006`: wire normal message sending and live row refresh.

- **Non-Goals**:
  - Full Web settings UI.
  - Agent editing.
  - Project/workflow/Cron/Ralph commands.
  - Mouse/hover interactions.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Ink keyboard input/focus APIs.
  - `CliSessionSource`.
  - Shared Ink renderer.

- **Evaluation Strategy**:
  - Unit tests for command parser.
  - Controller tests with fake source.
  - Manual TTY smoke test for keyboard flows.
  - Typecheck.

### Manual TTY smoke test

Run these checks from an interactive shell, not through a non-TTY pipe:

1. Build first: `npm run build`.
2. Start deterministic demo mode: `node dist/bin/pibo.js tui:sessions --demo --max-rows 20`.
3. Confirm the screen shows a status bar, command hint, compact transcript rows, and input prompt.
4. Type `/help` and press Enter; confirm supported Slash Commands and Web-only exclusions are shown.
5. Type `/status` and press Enter; confirm source/session/agent/model state is shown without secrets.
6. Type `/session`, use ↑/↓, then Esc; confirm picker cancellation returns to transcript mode.
7. Type `/agent`, use ↑/↓, then Esc; confirm only existing profiles are listed and no edit UI appears.
8. Type `/new` and press Enter; confirm a new demo session opens.
9. Type normal text and press Enter; confirm input clears and the compact transcript refreshes with the sent message.
10. Type `/clear` and press Enter; confirm local display rows clear without deleting session data.
11. Type `/quit` or press Ctrl+C to exit and verify the terminal prompt is restored.

Use `node dist/bin/pibo.js tui:sessions --help` when a non-interactive environment is needed.

## 4. Technical Specifications

- **Architecture Overview**:
  - `src/cli.ts` registers the new command.
  - Command invokes CLI app bootstrapping code.
  - App renders controller state using Ink.
  - Input dispatches to parser; parser returns command action or message send.
  - Pickers are app modes with keyboard navigation.

- **Integration Points**:
  - `src/cli.ts`
  - `src/apps/cli-ui/*`
  - `src/cli-session/*`
  - shared terminal view model

- **Security & Privacy**:
  - `/status` must redact secrets.
  - Unknown commands must not accidentally execute shell or Web-only behavior.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: command shell and fake source.
  - V1: local/direct source with sessions and agents.
  - v1.1: optional model/thinking/fork/details commands.

- **Technical Risks**:
  - Command name conflict.
  - Keyboard behavior differences across terminals.
  - Users expecting Web-only features.
