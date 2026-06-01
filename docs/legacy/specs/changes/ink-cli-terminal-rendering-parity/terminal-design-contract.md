# Terminal Design Contract and Visual Evidence Gate

**Status:** Active for the Ink CLI Terminal Rendering Parity change  
**Canonical visual source:** `TERMINAL_DESIGN.md`

This contract turns `TERMINAL_DESIGN.md` into pass/fail rules for `pibo tui:sessions`. Web and Ink keep separate renderers, but both must preserve the same terminal semantics.

## Non-negotiable rendering rules

| Rule | Pass condition | Fails if |
|---|---|---|
| Transcript is primary | The scrollback/transcript rows occupy the main view and remain readable before chrome or guidance text. | Status dumps, suggestions, or headers dominate the screen. |
| Chronological command/runtime results | Slash command results, runtime state, command errors, trace results, and supported tool/status/model/login/thinking output render as transcript rows/cards in event order. | A command result is only written to a detached top-level `state.message` or dashboard area. |
| Overlays are temporary | Pickers, slash suggestions, confirmations, and menus are compact overlays tied to the current keyboard flow. Closing them returns to transcript flow without losing order. | A picker or suggestion list becomes permanent chrome or hides the transcript without a clear active-flow reason. |
| Chrome is compact | Header/status lines are terse, secondary, and bounded for narrow terminals. | Long UUIDs, verbose owner/session dumps, or persistent action lists consume row space. |
| Rows are dense | Rows use prefix glyphs, short labels, semantic tones, and bounded detail lines. | Rows become card timelines, unbounded prose, or large JSON blocks by default. |
| Shared semantics, renderer-specific paint | Web may use DOM/Tailwind/lucide. Ink may use Ink `Box`/`Text`, ASCII/Unicode markers, ANSI colors, and text progress bars. | Ink imports Web DOM components, Tailwind CSS, lucide-react, browser APIs, or Chat UI component files. |
| Secret redaction before rendering | Shared descriptors/view models redact credentials and secret-like values before Web or Ink paints them. | A renderer-specific output path receives raw secret-bearing values for supported terminal cards/rows. |
| Missing data is explicit | Missing context/provider/runtime values render as `unavailable` or a terse equivalent. | Missing values render as `0`, blank, raw `undefined`, or verbose debug prose. |
| Details are inline and bounded | Expanded or card detail appears directly below the parent row with bounded JSON/markdown/long output. | Details open detached panels, side inspectors, or unbounded dumps. |
| Color is signal | Running, success, error, reasoning, action, and identifiers use semantic tones; `NO_COLOR=1` remains readable through text labels/markers. | Color is the only carrier of state or decorative color obscures status meaning. |

## `state.message` policy

Allowed uses:

- Ephemeral guidance, such as accepted slash suggestion hints.
- Picker instructions and empty-picker guidance.
- Cancellations, back-navigation hints, and short non-history confirmations.
- Non-history empty states.

Forbidden uses:

- Slash command results (`/status`, `/thinking`, `/model`, `/login`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, `/kill-all`, unsupported command results, and command errors).
- Runtime status, queue/streaming state, provider/context usage, trace results, or tool/error output.
- Any output whose absence from the transcript would break chronological flow.

If content answers a command or reports runtime/history state, it belongs in rows/cards.

## Allowed renderer differences

- Ink may abbreviate owner/session identifiers in chrome if the row/card/detail path keeps meaning available.
- Ink may use text progress bars such as `████░░ 50.0%`; Web may use DOM progress bars.
- Ink may use terminal glyphs (`›`, `•`, `└`, `▣`, `✕`, `⚠`) instead of browser icons.
- Web may expose DOM test hooks; Ink must expose equivalent evidence through PTY clean/screen artifacts and renderer tests.

## Forbidden parity claims

A story must not be marked complete if the only evidence is one of these:

- `src/session-ui` imports are shared but the visible Ink output was not checked.
- A fake/demo renderer test passed while a real/default local path was feasible and untested.
- `/status` or another command result appears only above the transcript.
- The screen contains unbounded JSON, raw secrets, dominant UUIDs, or a dashboard-like status dump.
- Web and Ink share DOM components or renderer-specific presentation code.

## Visual evidence checklist

Use this checklist for every user-facing TUI story in PRDs 02-07.

| Field | Required content |
|---|---|
| Story id(s) | PRD file and `US-###`. |
| Design rules checked | Exact rules from this contract and `TERMINAL_DESIGN.md` sections. |
| PTY command | Exact `pibo debug pty ...` or smoke script command. If omitted, explain why PTY was not feasible. |
| Artifact directory | Path containing `raw.ansi.log`, `clean.txt`, `screen.txt`, `metadata.json`, and input/assertion data when supported. |
| Evidence tier | `real/default`, `mocked`, `fake`, or `demo`, with why that tier was chosen. |
| Observed screen result | Short statement of what the final screen proves and any visible limitation. |
| Remaining gaps | Any design mismatch, unsupported path, or follow-up story. |
| Web impact | Web test/build command if the shared model or Web hooks changed, or `none`. |
| Redaction check | Where secret-bearing fixtures were asserted safe. |
| Gate commands | Focused tests plus broader gates run for the story. |

Fake/demo/mocked evidence can support a story, but it cannot be the final default-path evidence when a local real/default path is available. Final parity completion also requires an installed/global `pibo tui:sessions` PTY smoke.

## Traceability

| Contract area | Later PRD/story or gate |
|---|---|
| Transcript-first layout and chronological command results | PRD 03 `US-002`-`US-005`; final PTY `/status` flow. |
| Shared renderer-neutral descriptors and redaction | PRD 02 `US-001`-`US-005`; PRD 05 `US-001`; static boundary tests. |
| Dense Ink row/card primitives, details, no-color, narrow width | PRD 04 `US-001`-`US-005`; Ink renderer snapshots. |
| Status/runtime cards and unavailable states | PRD 05 `US-001`-`US-005`; Web status hook checks. |
| Pickers, slash palette, overlays, keyboard flows | PRD 06 `US-001`-`US-005`; overlay PTY flows. |
| Reviewable PTY/visual artifacts and final gates | PRD 07 `US-001`-`US-006`; final installed CLI smoke. |

Reviewers should mark each row in the non-negotiable table pass/fail for the story under review. Ambiguous evidence means the story stays incomplete.
