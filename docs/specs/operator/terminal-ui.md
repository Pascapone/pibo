---
type: "Specification"
title: "Shared Terminal View Model and CLI Session UI"
description: "Defines the implemented shared terminal view model and cli session ui contract and its current ownership, security, compatibility, and verification boundaries."
tags:
- operator
- tooling
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "OP-TERMINAL-001"
      status: "implemented"
      sources:
        - path: src/session-ui/terminalRows.ts
          symbol: CompactTerminalRowKind
        - path: src/session-ui/terminalRows.ts
          symbol: buildCompactTerminalRows
        - path: src/session-ui/terminalCards.ts
          symbol: buildTerminalCardDescriptor
      tests:
        - path: test/session-ui-terminal-rows.test.mjs
          name: "compact row generation covers core terminal row kinds deterministically"
        - path: test/cli-ui-ink-renderer.test.mjs
          name: "Ink renderer consumes the canonical shared parity fixture"
        - path: test/session-ui-terminal-rows.test.mjs
          name: "shared terminal view-model source stays renderer-neutral"
      public:
        - "CompactTerminalRow"
        - "CompactTerminalRowKind"
        - "buildCompactTerminalRows"
      failures:
        - "Rows are renderer-neutral projections and must not become product history, gateway, or runtime truth."
      confidence: high
    - id: "OP-TERMINAL-002"
      status: "implemented"
      sources:
        - path: src/session-ui/terminalRows.ts
          symbol: compactTerminalRowIdentity
        - path: src/session-ui/terminalRows.ts
          symbol: COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES
        - path: src/session-ui/statusViewModel.ts
          symbol: redactTerminalSecret
      tests:
        - path: test/session-ui-terminal-rows.test.mjs
          name: "compact terminal row identity survives transcript, event-log, and live tool projection handoffs"
        - path: test/session-ui-terminal-rows.test.mjs
          name: "tool display modes preserve default output and support hide, slim, and intent views"
        - path: test/cli-ui-ink-renderer.test.mjs
          name: "Ink long-output rows collapse to five lines and expand full details"
      public:
        - "compactTerminalRowIdentity"
        - "ToolDisplayMode"
        - "redactTerminalSecret"
      failures:
        - "Identity/order are preserved across projections while status, errors, results, and metadata are redacted and bounded."
      confidence: high
    - id: "OP-TERMINAL-003"
      status: "implemented"
      sources:
        - path: src/apps/cli-ui/InkSessionApp.ts
          symbol: InkSessionApp
        - path: src/apps/cli-ui/cliSessionsCommand.ts
          symbol: runCliSessionsUi
        - path: src/session-ui/commandCatalog.ts
          symbol: WEB_PARITY_SLASH_COMMANDS
      tests:
        - path: test/cli-ui-session-app.test.mjs
          name: "Ink session input reducer captures text, enter, navigation, escape, and slash suggestions"
        - path: test/cli-ui-session-app.test.mjs
          name: "Slash /model opens provider and model command menus"
        - path: test/cli-ui-session-app.test.mjs
          name: "Slash /fork-candidates opens a candidate picker and can fork by entry id"
        - path: test/cli-ui-session-app.test.mjs
          name: "default app viewport bounds large sessions and wraps narrow terminal lines"
        - path: test/cli-ui-session-app.test.mjs
          name: "Ink session input reducer edits at grapheme cursor boundaries"
        - path: test/cli-ui-input-cursor.test.mjs
          name: "cursor movement treats a joined emoji as one grapheme"
        - path: test/cli-ui-room-switch.test.mjs
          name: "cross-room selection clears the stale session before Project Room can receive input"
      public:
        - "InkSessionApp"
        - "runCliSessionsUi"
        - "buildSlashCommandCatalog"
      failures:
        - "Non-TTY use fails before render; source/action failures become bounded redacted rows and cleanup is idempotent."
      confidence: high
    - id: "OP-TERMINAL-004"
      status: "implemented"
      sources:
        - path: src/cli-session/sessionSource.ts
          symbol: CliSessionSource
        - path: src/cli-session/localSessionSource.ts
          symbol: LocalCliSessionSource
        - path: src/apps/cli-ui/cliSessionsCommand.ts
          symbol: createDefaultLocalCliSessionSource
        - path: src/cli-session/fakeSessionSource.ts
          symbol: FakeCliSessionSource
      tests:
        - path: test/cli-session-source.test.mjs
          name: "local CLI source resolves canonical room titles and hydrates existing room transcripts"
        - path: test/cli-session-source.test.mjs
          name: "local CLI source writes Web-visible navigation and message read models app-globally"
        - path: test/cli-session-source.test.mjs
          name: "local CLI close drains the owned router before unsubscribing and closing stores"
        - path: test/cli-ui-session-app.test.mjs
          name: "exit cleanup closes open session subscriptions and source idempotently"
        - path: test/stream-render-rereview2.test.mjs
          name: "local CLI automatically retries one failed final without producer replay"
        - path: test/stream-render-final-review.test.mjs
          name: "local CLI resumes a pending durable final after process restart without producer replay"
      public:
        - "CliSessionSource"
        - "LocalCliSessionSource"
        - "createDefaultLocalCliSessionSource"
      failures:
        - "Fake sources are explicit only; local source operations remain app-global and close owned subscriptions/router state idempotently."
      confidence: high
---
# Shared Terminal View Model and CLI Session UI

## Why

Terminal clients need a shared compact projection that preserves product identity without making the renderer the owner of product state.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Renderer-neutral compact terminal rows, identity/order/details/redaction, slash-command catalog terminal support, Ink room/session/composer/menu/cards, and CLI session-source presentation contract.

### Out of scope

- Product history, trace, session, room, agent, signal, or gateway command truth; session sources adapt owner APIs/stores.
- Chat Web and VS Code rendering/adapters; they consume shared semantics but own presentation.
- Direct Pi TUI/runtime behavior or routed gateway action semantics.
- Debug PTY execution and acceptance artifacts owned by SPC-OP-002.

## Current behavior

### Commands

- pibo tui is direct Pi TUI; pibo tui:routed is local routed TUI; pibo tui:sessions is the Ink room/session UI. tui:sessions requires TTY input/output except explicit test seams; --demo selects deterministic fake data and is not default.

### Apis

- CompactTerminalRow/Kind/Status, buildCompactTerminalRows, compactTerminalRowIdentity, command catalog and behavior matrix; CliSessionSource and LocalCliSessionSource adapt room/session/agent/status/send/action streams.

### State

- Seventeen compact row kinds, running|done|error|neutral status, default/hide/slim/intent tool display, five output preview lines, six exploration lines, max twenty image previews, default Ink tail window twenty rows.

### Lifecycle

- List/select room and session as one ownership boundary; clear a stale Session before changing Rooms; open and hydrate transcript/trace; edit input at grapheme boundaries; compose/send or execute slash action; reconcile stable row identity; retry durable output persistence after transient failure or process restart; close source/router/subscriptions idempotently.

### Failure

- Non-TTY startup fails before render; source/action errors append redacted transcript rows; empty picker and recovery states are actionable; large/narrow output is bounded and wrapped.

### Security

- Status, error, command results, metadata, and API-key instructions redact common secret shapes; fake fixtures are opt-in; normal source reads ordinary app stores through owner interfaces.

### Compatibility

- Rows are renderer-neutral and preserve conceptual identity across transcript/event/live handoffs. /model, /thinking, /login, and /fork-candidates are terminal-adapted current commands; renderer-specific interaction stays outside shared rows.

## Requirements and invariants

### Requirement: OP-TERMINAL-001

Normalize product trace semantics into renderer-neutral compact rows for messages, reasoning, tools, agents, yielded runs, execution, images, status, and errors.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/session-ui/terminalRows.ts` — `CompactTerminalRowKind`; `src/session-ui/terminalRows.ts` — `buildCompactTerminalRows`; `src/session-ui/terminalCards.ts` — `buildTerminalCardDescriptor`
- Tests: `test/session-ui-terminal-rows.test.mjs` — “compact row generation covers core terminal row kinds deterministically”; `test/cli-ui-ink-renderer.test.mjs` — “Ink renderer consumes the canonical shared parity fixture”; `test/session-ui-terminal-rows.test.mjs` — “shared terminal view-model source stays renderer-neutral”
- Failure/security boundary: Rows are renderer-neutral projections and must not become product history, gateway, or runtime truth.
- Confidence: **high**

### Requirement: OP-TERMINAL-002

Preserve semantic order and stable conceptual identity across transcript, event-log, and live projections while bounding previews/details and redacting secret-shaped values.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/session-ui/terminalRows.ts` — `compactTerminalRowIdentity`; `src/session-ui/terminalRows.ts` — `COMPACT_TERMINAL_OUTPUT_PREVIEW_LINES`; `src/session-ui/statusViewModel.ts` — `redactTerminalSecret`
- Tests: `test/session-ui-terminal-rows.test.mjs` — “compact terminal row identity survives transcript, event-log, and live tool projection handoffs”; `test/session-ui-terminal-rows.test.mjs` — “tool display modes preserve default output and support hide, slim, and intent views”; `test/cli-ui-ink-renderer.test.mjs` — “Ink long-output rows collapse to five lines and expand full details”
- Failure/security boundary: Identity/order are preserved across projections while status, errors, results, and metadata are redacted and bounded.
- Confidence: **high**

### Requirement: OP-TERMINAL-003

Implement Ink room/session selection, composer, overlays, status/cards, keyboard flow, and terminal-adapted slash commands with bounded viewport behavior.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/apps/cli-ui/InkSessionApp.ts` — `InkSessionApp`; `src/apps/cli-ui/cliSessionsCommand.ts` — `runCliSessionsUi`; `src/session-ui/commandCatalog.ts` — `WEB_PARITY_SLASH_COMMANDS`
- Tests: `test/cli-ui-session-app.test.mjs` — “Ink session input reducer captures text, enter, navigation, escape, and slash suggestions”; `test/cli-ui-session-app.test.mjs` — “Slash /model opens provider and model command menus”; `test/cli-ui-session-app.test.mjs` — “Slash /fork-candidates opens a candidate picker and can fork by entry id”; `test/cli-ui-session-app.test.mjs` — “default app viewport bounds large sessions and wraps narrow terminal lines”
- Failure/security boundary: Non-TTY use fails before render; source/action failures become bounded redacted rows and cleanup is idempotent.
- Confidence: **high**

### Requirement: OP-TERMINAL-004

Hydrate and stream app-global rooms, sessions, agents, status, navigation, messages, and routed actions through supported session sources, with fake data only by explicit demo/test selection.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/cli-session/sessionSource.ts` — `CliSessionSource`; `src/cli-session/localSessionSource.ts` — `LocalCliSessionSource`; `src/apps/cli-ui/cliSessionsCommand.ts` — `createDefaultLocalCliSessionSource`; `src/cli-session/fakeSessionSource.ts` — `FakeCliSessionSource`
- Tests: `test/cli-session-source.test.mjs` — “local CLI source resolves canonical room titles and hydrates existing room transcripts”; `test/cli-session-source.test.mjs` — “local CLI source writes Web-visible navigation and message read models app-globally”; `test/cli-session-source.test.mjs` — “local CLI close drains the owned router before unsubscribing and closing stores”; `test/cli-ui-session-app.test.mjs` — “exit cleanup closes open session subscriptions and source idempotently”
- Failure/security boundary: Fake sources are explicit only; local source operations remain app-global and close owned subscriptions/router state idempotently.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.operator.terminal

**Public surfaces:**

- CompactTerminalRow
- CompactTerminalRowKind
- buildCompactTerminalRows
- compactTerminalRowIdentity
- ToolDisplayMode
- redactTerminalSecret
- InkSessionApp
- runCliSessionsUi
- buildSlashCommandCatalog
- CliSessionSource
- LocalCliSessionSource
- createDefaultLocalCliSessionSource

The terminal view model consumes gateway and product projections. Web and VS Code renderers remain separate consumers.

Related concepts:

- [/specs/gateway/routing-events-and-actions.md](/specs/gateway/routing-events-and-actions.md)
- [/specs/gateway/local-tui-and-simple-agent-api.md](/specs/gateway/local-tui-and-simple-agent-api.md)
- [/specs/data/product-store-history-and-read-models.md](/specs/data/product-store-history-and-read-models.md)
- [/specs/operator/debug-web-and-pty.md](/specs/operator/debug-web-and-pty.md)

## Failure and security behavior

- Non-TTY startup fails before render; source/action errors append redacted transcript rows; empty picker and recovery states are actionable; large/narrow output is bounded and wrapped.
- Status, error, command results, metadata, and API-key instructions redact common secret shapes; fake fixtures are opt-in; normal source reads ordinary app stores through owner interfaces.

## Known limits

- The synthesis test list omits test/cli-session-source.test.mjs, which directly verifies requirement 004 and must be added to target traceability.
- The synthesis claims Chat Web and VS Code consumers but does not list their adapter sources/tests; cross-renderer parity needs explicit non-owned traces.
- No real PTY or headful browser consumer validation was performed.

## Reconciled stale claims

- Reject /model, /thinking, /login, or fork workflows as wholly unsupported; current terminal adaptations exist.
- Reject an unresolved/default row-limit claim; the Ink tail window defaults to twenty rows and shared previews have explicit bounds.
- Reject shared terminal rows as owners of product history or Chat Web/VS Code renderers.
- Reject --demo/fake source as normal production behavior.

## Verification and traceability

All source and named-test references are bound to upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/cli-ui-session-app.test.mjs test/cli-ui-ink-renderer.test.mjs test/session-ui-terminal-rows.test.mjs test/cli-session-source.test.mjs
- npm run build
- pibo debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact
- pibo debug pty run --rows 24 --cols 80 --expect 'Pibo' -- pibo tui:sessions
