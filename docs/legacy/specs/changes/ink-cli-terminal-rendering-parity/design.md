# Design: Ink CLI Terminal Rendering Parity

## Context

The V2 implementation correctly avoided importing Web DOM components into Ink. That separation should remain. The gap is that some rendering paths still bypass the Compact Terminal row/card pipeline and write plain text into top-level app messages.

The design goal is renderer separation with semantic parity: the same shared fixture should produce the same row kinds, card descriptors, labels, token tones, progress values, and redacted text before Web or Ink paints it.

## Goals

- Make the transcript the primary UI in the CLI, matching `TERMINAL_DESIGN.md`.
- Move command-result rendering into compact terminal rows/cards.
- Keep `src/session-ui` renderer-neutral.
- Keep Web and Ink renderer components separate and thin.
- Add tests that make drift visible early.
- Produce visual debugging artifacts for PTY runs.

## Non-Goals

- Pixel-perfect DOM/CSS reproduction in Ink.
- Cross-renderer React components.
- Replacing Web Compact Terminal styling.
- Making every browser-only action terminal-supported.

## Decisions

### Decision: Use shared fixtures as the parity anchor

- **Choice:** Add shared terminal fixtures for status, thinking, model, login, tool, yielded-run, compaction, command, error, user, assistant, and reasoning rows.
- **Rationale:** Tests should compare semantic models, not screenshots alone. Screenshots catch visual defects; shared fixtures catch drift in business/render logic.
- **Implication:** Web and Ink tests must import/build from the same fixture or equivalent helper.

### Decision: Command results become local terminal rows first

- **Choice:** For immediate CLI feedback, normalize command results into `CompactTerminalRow[]` and append them to the local row list. When the runtime later persists equivalent events, hydration can replace or deduplicate local rows.
- **Rationale:** Users need chronological feedback immediately. Persisting every CLI-only command result is a separate data-policy decision.
- **Risk:** Duplicate rows can appear if persisted events echo local rows. Use stable source ids or local ids to dedupe in a follow-up if needed.

### Decision: Keep transient `state.message` only for UI guidance

- **Choice:** `state.message` is allowed for non-transcript guidance: accepted suggestion hints, picker instructions, cancellation, empty states, and short confirmations that do not represent session history.
- **Rationale:** Guidance belongs near controls. Command outputs and runtime results belong in the transcript.
- **Rule:** If the content answers a slash command, reports runtime state, shows a command error, or represents a trace/result, it should be a row/card.

### Decision: Ink cards map descriptors to terminal primitives

- **Choice:** `InkTerminalCard` and related components render `TerminalCardDescriptor` using Ink `Box`/`Text`, semantic markers, compact spacing, token colors, and text progress bars.
- **Rationale:** This preserves quality without DOM reuse.
- **Expected primitives:** `InkTerminalLine`, `InkTerminalCard`, `InkProgressBar`, `InkBadge`, `InkDetailPanel`, `InkJsonBlock`, and card-specific row mappers where needed.

### Decision: Visual debugging starts with ANSI artifacts

- **Choice:** Extend PTY validation to archive raw ANSI, clean text, screen text, and optionally ANSI-to-HTML/SVG output.
- **Rationale:** Browser screenshots work for Web. Terminal UIs need terminal-state artifacts. ANSI-to-HTML/SVG gives reviewers a visual approximation without requiring a full GUI.
- **Fallback:** If no ANSI visual renderer is installed, the report must say so and keep raw/clean/screen artifacts.

## Test Design

### 1. Shared model tests

- Verify `buildCompactTerminalRows()` produces expected row order and row kinds for a representative trace fixture.
- Verify `buildTerminalCardDescriptors()` produces status/thinking/model/login/tool/error descriptors from that row fixture.
- Verify redaction happens before renderer-specific output.
- Verify status progress values handle unavailable, zero, warning, and high-usage states.

### 2. Static boundary tests

- `src/session-ui` must not import React, Ink, DOM, CSS, or browser APIs.
- `src/apps/cli-ui` must not import Web Compact Terminal components, Tailwind CSS, lucide-react, or browser APIs.
- Web Compact Terminal files must consume shared descriptors for rich cards and expose stable semantic hooks.

### 3. Ink renderer tests

- Render shared fixture rows with `renderToString()`.
- Assert prefix glyphs, card titles, labels, progress bars, unavailable text, error markers, and secret redaction.
- Assert `NO_COLOR=1` output remains readable through markers and labels.
- Assert narrow-width output keeps owner/session/error/status meaning visible.
- Assert command-result rows appear after prior transcript rows.

### 4. CLI controller tests

- Submit `/status` through `handleCliSessionSubmittedInput()` with a fake source.
- Assert state rows increase with command/status rows.
- Assert state message does not contain the status payload.
- Assert picker state closes when a slash command is submitted over a picker.
- Repeat with representative commands that return menu, unsupported, error, and session-link descriptors.

### 5. Web regression tests

- Use the same shared fixture to assert the Web Compact Terminal builds rows/cards from shared descriptors.
- Add lightweight source tests for semantic hooks (`data-shared-terminal-card`, `data-shared-status-field`, card kind hooks) until a DOM renderer test harness is available.
- Keep `chat-ui:typecheck` and `chat-ui:build` as required validation gates.

### 6. PTY visual tests

- Run real PTY flows for:
  - startup owner/room/session flow
  - slash suggestions
  - `/status` while a picker is open
  - status with full/partial/unavailable usage data in demo or fake mode
- Save `raw.ansi.log`, `clean.txt`, `screen.txt`, `events.jsonl`, `metadata.json`, and visual output if available.
- Link artifacts from a report under `docs/reports/`.

## Migration / Rollback

- Existing persisted sessions do not need migration.
- Command-result rows can remain local-only until a persistence decision is made.
- If the row-conversion path fails, the CLI may show a bounded error row and keep the session usable.
- Rollback can restore message-based rendering without data migration, but parity tests should fail to make the regression explicit.

## Risks / Trade-offs

- Local command rows may diverge from later persisted events unless dedupe is added.
- Overly strict snapshot tests can become brittle. Prefer semantic assertions plus a few stable screen snapshots.
- ANSI visual artifacts may differ by terminal renderer. Treat them as review aids, not sole pass/fail signals.

## Open Questions

- Which command results should become persisted event-log entries?
- Which terminal visual renderer should be bundled or documented?
- Should Web Compact Terminal get a dedicated test harness with jsdom/React Testing Library, or should shared-model tests remain the main contract?
