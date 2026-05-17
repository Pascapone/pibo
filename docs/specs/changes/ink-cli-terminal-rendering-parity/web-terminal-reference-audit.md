# Web Compact Terminal Reference Audit

**Date:** 2026-05-17  
**Scope:** Derive Ink CLI/TUI rendering requirements from the Web Compact Terminal implementation instead of fixing isolated symptoms.

## Reference files

- `TERMINAL_DESIGN.md`
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx`
- `src/apps/chat-ui/src/styles.css` `.compact-terminal-*`
- Shared model: `src/session-ui/terminalRows.ts`, `src/session-ui/terminalCards.ts`, `src/session-ui/statusViewModel.ts`
- Ink renderer: `src/apps/cli-ui/InkTerminalView.ts`, `InkTerminalRow.ts`, `InkTerminalLine.ts`, `inkJson.ts`, `inkMarkdown.ts`

## Web Terminal laws discovered

### 1. Transcript rows, not cards, are the default grammar

Web renders most events as compact terminal rows with:

- a fixed prefix column: `grid-cols-[1.9rem_minmax(0,1fr)]`
- row bottom divider: `border-b border-[#141414]`
- row vertical padding: `py-2`
- row horizontal transcript padding via outer `px-4`
- content wrapping: `whitespace-pre-wrap break-words`
- no permanent right-side actions unless hovered/focused

Special interactive cards exist, but they are exceptions: status, thinking, login, model, details. The normal event grammar is still row-first.

**Ink gap:** Ink currently turns many row kinds into `TerminalCardDescriptor` output, using `✓ ▣ ...` headers. That is readable, but it differs from Web's row-first philosophy for tool/command/yielded/error rows. Ink should reserve boxed/card-like treatment for the same exceptions Web reserves, and render normal tool/command rows as terminal lines plus optional detail expansion.

### 2. Output preview is bounded by lines, not by character truncation

Web shared row creation uses `TOOL_OUTPUT_PREVIEW_LINES = 5`. Tool calls, tool results, async agents, yielded runs, shell commands, and execution command rows should show only the first five preview lines in the collapsed transcript. Full content belongs in details.

Important distinction:

- **Do not truncate a visible line by character budget.** Long lines wrap.
- **Do limit collapsed previews by line count.** The transcript should not dump unlimited output by default.
- **Do preserve full output in details.** Expansion must reveal the complete input/output/error, or a full-output disclosure/path for compacted validation output.

Web also has a special grouped exploration preview: collapsed exploring groups show up to `COLLAPSED_EXPLORING_PREVIEW_LINES = 6` child summary lines.

**Ink gap:** Recent no-truncation work removed character cutting, which is correct. It also removed the five-line preview bound from shared previews. That regresses Web semantics. The next change should restore preview-line limits while keeping no character truncation.

### 3. Expansion is inline and row-owned

Web rows that have `expandable` input/output/error can be toggled by double-click or keyboard. Details render directly below the row with:

- `mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2`
- section labels: 11px semibold dim text
- `Input`, `Output`, `Error` sections
- no side drawer, no modal, no separate inspector
- optional linked child-session button

**Ink gap:** Ink always renders `detailItems` inline for grouped rows and has no row-owned expand/collapse state. It cannot yet mimic Web's collapsed transcript plus on-demand detail expansion. A terminal-native interaction is needed, e.g. selected row + `d`/Enter toggles details, while preserving transcript density.

### 4. JSON has two distinct render modes

Web supports two JSON styles:

1. **Inline function-call JSON** via `TerminalInlineJson.tsx`
   - function call format: `name(<json>)`
   - function name is yellow semibold
   - root JSON is expanded by default
   - nested objects/arrays can collapse to `▸{...}` / `▸[...]`
   - expanded collections show `▾{` / `▾[` and inline key/value tokens
   - strings are orange, numbers/booleans/null are blue, punctuation is dim
   - long strings over 140 chars become clickable shortened strings with `...`

2. **Detail JSON wells** via `TerminalDetails.tsx` and `JsonRenderer`
   - JSON is parsed from raw values or JSON-looking text
   - optional text before JSON is shown as status metadata
   - object details render in a bordered `#0b0b0b` well
   - default expansion level is 1
   - controls are hidden inside terminal details (`showControls={false}`)
   - `JsonRenderer` shortens long text after 120 chars internally

**Ink gap:** Ink pretty-prints JSON as plain monochrome lines. It preserves values but lacks JSON token tones, collection disclosure, collapsed nested structures, and detail wells. Ink needs a terminal-native JSON renderer that maps Web semantics to text/ANSI: keys/default, strings/orange or green equivalent, literals/blue, punctuation/dim, and collapsed nested collection markers.

### 5. Markdown is fully rendered in Web, approximated in Ink

Web assistant and reasoning rows use `MarkdownRenderer` inside `.compact-terminal-markdown`:

- paragraph spacing: 0.55rem
- headings capped at 0.95rem
- list markers cyan; reasoning list markers amber
- blockquotes have cyan border/background
- inline code uses cyan text on dark background
- code blocks have bordered dark wells with syntax highlighting
- tables are scrollable
- Prism-like token colors map to terminal accent roles

**Ink gap:** Ink currently strips markdown into plain lines. This is acceptable as a terminal constraint, but the spec should require semantic approximations: headings become emphasized lines, bullets remain bullets, blockquotes keep `>`, inline code is distinguishable, code blocks preserve indentation, and fenced code should receive basic syntax/token coloring when feasible.

### 6. Status card is a Web exception, but still compact

Web `TerminalStatusCard` is a card exception with compact fields, badges, bars, and foldable tools:

- status fields in a tight grid
- processing/streaming/queued/disposed badges only when relevant
- context progress as a bar
- provider section with remaining quota, not used quota
- raw provider limits show `% left` and reset time
- warnings/errors are below a divider
- tools are folded behind `Enabled tools (n)`

**Ink gap:** Ink now has correct runtime data and remaining quota wording. It still renders status as a long full list. It should copy Web's compactness rules: group fields, show state badges only when relevant, fold tools by default, and avoid duplicating both summarized and raw provider-limit sections unless the Web model requires both.

### 7. Header chrome is external to transcript

Web header contains profile/model/error badges and breadcrumbs. It is compact external chrome. The transcript starts below it. It does not repeat long owner/session text on every row.

**Ink gap:** Ink currently prints a multi-line header plus command hint above every render frame. In a TUI this may be necessary, but it should stay external chrome and be much denser than transcript rows. Long owner/session/model metadata should be abbreviated only if a separate full value is available via `/status` or header detail; otherwise it should wrap but not dominate the screen.

### 8. Streaming has stable footer semantics

Web shows a streaming footer when the session is active. It is a terminal row with prefix `•` and `Working...` scramble. Running rows use cyan bullets. There are no large spinners inside the transcript.

**Ink gap:** Ink has running markers but no consistent bottom footer equivalent. If implemented, it should be a single compact row, not a spinner/card.

## Prioritized changes for Ink parity

### P0 — Restore Web preview law without reintroducing text truncation

- Restore shared five-line collapsed output previews for tool/result/async/yielded/execution rows.
- Keep visible lines untruncated; let Ink wrap.
- Add explicit `previewOmittedLineCount` or equivalent metadata so Ink/Web can show `+N more lines` or an expandable affordance.
- Preserve full input/output/error in details.

### P0 — Stop over-cardifying normal rows in Ink

- Render `tool.call`, `tool.group.exploring`, `yielded.run`, `execution.command`, `execution.compaction`, and `error` primarily as terminal lines.
- Reserve first-class card renderers for status, thinking, model, and login, matching Web exceptions.
- Keep row prefix semantics (`•`, `└`, continuation, `›`) instead of `✓ ▣` headers for normal transcript events.

### P1 — Add terminal-native row expansion to Ink

- Track selected row and expanded row IDs in `InkSessionApp`.
- Add key help for `↑↓` row focus and `enter`/`d` details where it does not conflict with input mode.
- Render details below the row, mirroring Web `Input`, `Output`, `Error` sections.
- Keep the collapsed transcript dense.

### P1 — Implement Ink JSON renderer parity

- Add structured JSON token rendering for inline function-call input.
- Add collapsed nested collection markers.
- Render detail JSON wells in terminal text with colored keys/strings/literals when color is enabled and ASCII-safe fallback when not.
- Keep long string wrapping in expanded details, but allow inline JSON preview strings to shorten with an explicit expandable marker if interaction exists.

### P1 — Tighten spacing rhythm

- One transcript row should map to one compact vertical block.
- Detail lines under a row should have 0-2 cells of vertical gap.
- Major sections can have one blank spacer only when Web has a semantic divider.
- Do not print repeated decorative card headers for every command/tool row.

### P2 — Markdown semantic approximation

- Preserve headings, bullets, quotes, fenced code, tables, and inline code with terminal-native markers.
- Add basic token coloring for fenced code where the language is known or bash-like.
- Keep reasoning amber.

### P2 — Status compaction

- Fold enabled tools by default.
- Show only meaningful state badges.
- Avoid repeated raw fields that are already represented in progress bars unless Web displays both.
- Keep remaining quota wording and remaining-based bars.

## Spec updates required

- `TERMINAL_DESIGN.md` should explicitly define preview-vs-expansion rules, JSON render modes, and card exceptions.
- `docs/specs/changes/ink-cli-terminal-rendering-parity/spec.md` should add requirements for Web-derived preview behavior, Ink row expansion, JSON parity, and spacing rhythm.
- `tasks.md` should add a new post-parity phase for derived Web behavior instead of marking all rendering work as complete.

## Validation strategy

- Add a shared fixture with a tool output of at least 12 lines and a JSON payload with nested arrays/objects and long strings.
- Web test: collapsed transcript shows five output lines; expanded details show full output.
- Ink test: collapsed transcript shows five output lines with no character truncation; expanded/details mode shows full output.
- PTY test: run a session with a long shell/tool output and verify no `... truncated`, exactly bounded collapsed preview, and available full detail path/expansion.
- JSON tests: assert function-call input renders with key/string/literal token tones in both Web semantic hooks and Ink snapshot text/ANSI.