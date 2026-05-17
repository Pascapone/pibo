# Design System: Pibo Compact Terminal
**Project ID:** local-reference-pibo-compact-terminal

This document defines the visual language for the **Compact Terminal** session view in Pibo's Chat Web App. It is a self-contained, single-panel transcript surface. It is not a dashboard, not a timeline of cards, and not an inspector. It is a terminal emulator rendered in a browser.

Primary reference files:

- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLine.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
- `src/apps/chat-ui/src/styles.css` (`.compact-terminal-*` rules)

## 1. Visual Theme & Atmosphere

The Compact Terminal is a **transcript-first, chrome-minimal, ultra-dense code surface**. It should feel like reading scrollback in a modern terminal emulator — dark, fast, and relentlessly textual. Every visual decision serves one goal: **fit the maximum amount of meaningful text on screen while maintaining instant scannability.**

### Core Philosophy

- **The transcript is the UI.** There are no cards, no rounded containers, no floating panels, and no decorative chrome inside the terminal surface. Events appear as lines of monospaced text, separated only by hairline borders and semantic color.
- **Density is the feature.** Rows are packed tightly. Padding is aggressive minimal. White space is a waste of screen real estate. If a row can be displayed in one line, it must not consume two.
- **Color is signal, not decoration.** The palette is intentionally limited to a few saturated accents on a near-black void. Color carries meaning: cyan for action and navigation, green for completion, red for failure, amber for reasoning, yellow for identifiers. Everything else is dim or default.
- **Everything is monospaced.** Badges, buttons, markdown prose, labels, timestamps, and code all share one font family. The terminal does not mix sans-serif product typography into the transcript.
- **Chronological and append-only.** The stream reads top-to-bottom like shell scrollback. The active item may carry a subtle live marker, but history stays quiet and flat.
- **Dark-only, high-contrast.** The terminal lives on a deep black canvas. Light mode does not exist for this surface. The contrast between the void background and the neon accents is intentional and non-negotiable.

### Visual Reference

The style is inspired by modern terminal UIs (e.g., Codex TUI, Windows Terminal with a dark theme) but pushed further: **more saturated, more compact, more bold.** Where Codex uses subtle ANSI defaults, this terminal uses deliberate, high-energy color choices. The effect should be "cyber-minimal" — all business, but visually electric.

### What This Is Not

- Not a nested card timeline. Do not wrap events in bordered containers.
- Not a web dashboard. Do not use sans-serif fonts, rounded pills, drop shadows, or gradient backgrounds.
- Not an inspector panel. Detail expansion happens inline below the parent row, not in a side drawer.
- Not a marketing page. Labels are terse operational verbs (`Ran`, `Called`, `Explored`, `Spawned`), not explanatory copy.

## 2. Color Palette & Roles

### The Void — Backgrounds

These colors create the deep, infinite-black canvas that makes the neon accents pop.

| Name | Hex | Role |
|------|-----|------|
| **Terminal Void** | `#0b0b0b` | Primary background of the entire scrollable transcript. The canvas behind every row, every code block, every JSON well. This is not "dark gray"; it is the absence of light. |
| **Header Black** | `#111111` | Status bar at the top of the terminal, detail expansion panels, and code block backgrounds. One step above Void for subtle separation. |
| **Hover Black** | `#161616` | Row hover state for assistant/system rows. Barely perceptible — just enough to track the cursor without disrupting the text density. |
| **Composer Charcoal** | `#2a2a2a` | Bottom input/composer background when present. Visibly lighter than the transcript so the input area is discoverable without becoming a card. |

### Text — The Base Layer

| Name | Hex | Role |
|------|-----|------|
| **Terminal Text** | `#d4d4d4` | Primary readable text. Body content, event verbs, labels, and default tokens. |
| **Dim Text** | `#737373` | Secondary metadata, timestamps, old output, tree gutters, hints, and inactive footer content. This is the dominant non-primary text color. |
| **Muted Text** | `#525252` | Very quiet context: old command prefixes, collapsed output metadata, breadcrumb separators, and inactive status fragments. |

### Neon Accents — Signal Colors

These are saturated, high-energy colors used sparingly and semantically. They must feel electric against the Void.

| Name | Hex | Role |
|------|-----|------|
| **Cyan Signal** | `#38bdf8` | The primary action color. Active/running states, navigable links, subagent names, breadcrumb hover, focused references, interactive hints, and the "Latest" jump-to-bottom button. This is the loudest color in the system. |
| **Success Green** | `#22c55e` | Completion and health. Done bullets, successful command names, bash strings, and positive status. Used sparingly — a green dot should be enough for most success states. |
| **Error Red** | `#ef4444` | Hard failures. Error bullets, failed calls, bash redirect/pipe operators, and explicit error detail text. |
| **Amber Reasoning** | `#f59e0b` | Model reasoning, thinking rows, and planning blocks. Visually distinct from both tool calls and assistant output. |
| **Warm Yellow** | `#facc15` | Function names in inline tool calls, bash environment variables, and token identifiers. |
| **Magenta** | `#d946ef` | Keywords, bash flags, and occasional product-specific emphasis. |
| **Blue** | `#60a5fa` | Numbers, booleans, constants, and JSON literals. |
| **Orange** | `#fb923c` | JSON string values, regex tokens, and important inline strings. |

### Surface Accents

| Name | Hex | Role |
|------|-----|------|
| **User Tint** | `#11a4d4` at 10–15% opacity | Background tint for user-message rows. Keeps user input visually distinct without breaking the dark terminal mood. |

### Borders & Dividers

| Name | Hex | Role |
|------|-----|------|
| **Hairline Divider** | `#141414` | Separates terminal rows. So dark the stream feels almost continuous. |
| **Panel Border** | `#2a2a2a` | Detail panels, JSON wells, pre/code blocks, and the bottom border of the top status bar. |
| **Button Border** | `#3a3a3a` | Default border for rectangular buttons, badges, and session-link pills. |
| **Cyan Active Border** | `#38bdf8` | Hover and focus border for interactive elements. |

## 3. Typography Rules

### Font Family

- **Everything is monospaced.** No exceptions. The stack is:
  `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- Do not use product sans-serif inside the transcript surface, even for badges or labels.

### Scale

| Context | Size | Line Height |
|---------|------|-------------|
| Transcript row text | 12px | 1.45 |
| Dense metadata / labels | 11px | 1.45 |
| Composer text | 13–14px | 1.35 |
| Footer / status line | 11–12px | 1.35 |

- **No hero or display type.** This surface has no large headings.
- Headings inside rendered markdown are capped at `0.95rem` and kept tight.

### Weight & Emphasis

- **Bold (`700`)** for error labels and critical status words.
- **Semibold (`600`)** for event verbs and current state words: `Ran`, `Exploring`, `Calling`, `Waiting`, `Working`, `Spawned`.
- **Normal (`400`)** for prose, command output, and body text.
- **Italic** only for continuation hints (`+3 more lines`) or secondary snippets.
- Prefer **dim color** over smaller type for secondary detail.

### Case & Spacing

- Letter spacing: `0` everywhere.
- Do **not** uppercase labels by default. Use sentence-like operational verbs, not badge copy.
- Preserve shell casing and tool names exactly.
- Use tabular numbers for durations, counts, and line numbers.

### Text Tone

- Operational, terse, lowercase or sentence-case.
- Examples: `Loading`, `3 running`, `2 errors`, `Read`, `List`, `Search`, `Called`, `Spawned`, `Ran`.
- Avoid marketing copy. The terminal speaks like a shell log.

## 4. Component Stylings

### Terminal Viewport Shell

The viewport is a near-black scroll container with no card framing. It fills available height and allows native scrolling.

- Background: **Terminal Void (`#0b0b0b`)**
- Color: **Terminal Text (`#d4d4d4`)**
- Layout: `min-w-0 flex-1 flex flex-col overflow-hidden`
- The surrounding application may embed this panel inside a larger layout, but the terminal itself defines no outer chrome.

### Status Bar (Top Header) — Optional Chrome

The status bar is **external to the transcript surface**. It sits above the scrollable row list and provides session-level metadata. It must remain compact and not compete with the transcript for attention.

- Background: **Header Black (`#111111`)**
- Bottom border: **Panel Border (`#2a2a2a`)**
- Padding: `px-4 py-2`
- Text: 11px monospaced
- Content: running/error counters, agent profile label, origin/derived session pills, breadcrumbs.
- Breadcrumbs use `ChevronRight` at 12px in **Muted Text (`#525252`)** with clickable text in **Dim Text (`#737373`)** that hovers to **Cyan Signal (`#38bdf8`)**.

### Badges

Badges are tiny, rectangular, and border-defined. They do not use background fills.

- Shape: rectangular, `0px` border-radius (or at most `2px`).
- Padding: `px-2 py-0.5`.
- Border: 1px solid.
- **Cyan badge:** border `#1f4960`, text `#38bdf8`.
- **Red badge:** border `#5f2222`, text `#ef4444`.
- **Neutral badge:** border `#3a3a3a`, text `#d4d4d4`.

### Terminal Rows

Rows are the atomic unit of the transcript. They are **not cards**. They are lines of text separated by hairline borders.

- Layout: block-level container with `border-b border-[#141414]`.
- Padding: `py-2` (implicit via container; rows should feel almost touching).
- Hover: assistant/system rows get `hover:bg-[#161616]`; user rows get `hover:bg-[#11a4d4]/15`.
- Internal grid: `grid-cols-[1.9rem_minmax(0,1fr)] gap-2` — a fixed prefix column and a flexible content column.
- Text wraps via `whitespace-pre-wrap break-words`.
- Default rendering for `tool.call`, `tool.group.exploring`, `yielded.run`, `execution.command`, `execution.compaction`, and `error` is row-first: prefix glyph, terse verb, inline tokens, bounded preview, optional details.
- Card-like surfaces are exceptions reserved for interactive or structured controls such as status, thinking, login, model selection, and explicit detail panels. Do not render normal tool and command rows as decorative cards by default.

#### Prefix Glyphs

| Prefix | Glyph | Color Rule |
|--------|-------|------------|
| `bullet` | `•` | **Cyan Signal** if running, **Success Green** if done, **Error Red** if error |
| `detail` | `└` | **Dim Text (`#737373`)** |
| `continuation` | ` ` (space) | **Dim Text (`#737373`)** |
| `prompt` | `›` | **Dim Text (`#737373`)** |
| `none` | ` ` (space) | **Dim Text (`#737373`)** |

The prefix column is fixed at `1.9rem`. Nesting is expressed through prefix glyphs, not large left margins.

#### Inline Tokens

Each token within a line carries a tone and optional weight:

| Tone | Hex | Usage |
|------|-----|-------|
| `default` | `#d4d4d4` | Plain text |
| `dim` | `#737373` | Metadata, previews, secondary info |
| `cyan` | `#38bdf8` | Active/running, links, subagent names |
| `green` | `#22c55e` | Success, done, bash commands, strings |
| `red` | `#ef4444` | Errors, failed calls, bash operators |
| `magenta` | `#d946ef` | Keywords, flags |
| `yellow` | `#facc15` | Function names, variables |
| `blue` | `#60a5fa` | Numbers, booleans |
| `amber` | `#f59e0b` | Reasoning/thinking labels |

### Row Action Buttons

Action buttons appear on the right side of a row, visible only on `group-hover` or `group-focus-within` (`opacity-0` → `opacity-100`). They must not consume permanent row space.

- Size: `min-h-7 min-w-7` with `px-2`.
- Border: `border-[#3a3a3a]`.
- Text: 11px in **Dim Text (`#737373`)**.
- Hover: border and text shift to **Cyan Signal (`#38bdf8`)**.
- Actions: `Open`, `Fork`, `Hide`, `Details`.

### Output Preview And Expansion

Collapsed transcript rows use **progressive disclosure**. The terminal must stay dense while keeping full data available on demand.

- Tool calls, tool results, async agents, yielded runs, shell commands, and execution command rows show at most the first **5 output preview lines** in the collapsed transcript.
- Grouped exploration rows show at most the first **6 child summary lines** while collapsed.
- The preview limit is a **line-count bound**, not character truncation. Visible preview lines wrap with `whitespace-pre-wrap break-words` and must not be shortened with `… truncated`.
- If additional preview lines exist, the row should expose an expansion affordance (`Details`, double-click/Enter in Web, or a terminal-native equivalent in Ink) and may show a terse `+N more lines` hint.
- Expanded details reveal the full `Input`, `Output`, and `Error` payloads, or a full-output disclosure/path when the runtime has compacted very large validation output.
- Do not expand full JSON payloads, full shell output, or full tool results by default in the transcript.

### Detail Expansion Panel

Triggered per-row via the `Details` / `Hide` action. Expands **below** the parent row without additional horizontal indentation.

- Container: `mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2`.
- Text: 12px **Terminal Text (`#d4d4d4`)**.
- Sections: `Input`, `Output`, `Error`.
- Section label: 11px `font-semibold` **Dim Text (`#737373`)**.
- Details are row-owned. Do not move them into a side inspector or detached dashboard.
- Details are not a substitute for collapsed previews; both states must exist for large output.

### JSON / Code Wells

- Background: **Terminal Void (`#0b0b0b`)**.
- Border: **Panel Border (`#2a2a2a`)**.
- Padding: `p-2` for inline JSON, `p-2` for detail JSON blocks.
- Font: monospaced 12px.

#### Inline JSON Behavior

Inline JSON is used for function-call arguments and compact row previews.

- Function-call format is `<name>(<inline-json>)`.
- Function names are **Warm Yellow (`#facc15`)** and `font-semibold`.
- The root collection is expanded by default when space permits.
- Nested collapsed state shows `▸{...}` or `▸[...]` as a clickable/toggleable marker.
- Expanded state shows `▾{` or `▾[` with keys, values, separators, and closing braces/brackets.
- Strings: **Orange (`#fb923c`)**.
- Numbers / booleans / null: **Blue (`#60a5fa`)**.
- Keys: **Terminal Text (`#d4d4d4`)** with surrounding quotes.
- Colons / commas / braces: **Dim Text (`#737373`)**.
- Long inline strings (>140 chars) may shorten with `...`, but only with an explicit expandable/toggleable affordance. This is an inline JSON disclosure rule, not general transcript truncation.

#### Detail JSON Behavior

Detail panels parse JSON-looking input/output values and render them as JSON wells.

- Raw object/array values render as pretty JSON.
- Text values that contain JSON after status text may render the leading text as metadata and the parsed JSON in the well.
- Default expansion depth is 1.
- JSON controls are hidden in terminal detail wells unless the surrounding UI explicitly provides expand/collapse controls.
- Long strings inside detail JSON may be shortened by the JSON renderer only when the renderer exposes a way to inspect or expand the full value.

### Function Call Inline

- Format: `<name>(<inline-json>)`.
- Function name: **Warm Yellow (`#facc15`)** `font-semibold`.
- Parens: **Terminal Text (`#d4d4d4`)**.
- Arguments: Inline JSON rules above.
- Function calls are transcript rows first. Do not promote every function call into a large card by default.

### Markdown Inside Terminal

Rendered assistant output and reasoning use `.compact-terminal-markdown`:

- Paragraphs: `margin-bottom: 0.55rem`.
- Headings: `0.95rem`, `#f3f4f6`, tight margins.
- Links: **Cyan Signal (`#38bdf8`)**.
- Lists: outside bullets, marker color **Cyan Signal (`#38bdf8`)**.
- Blockquotes: `border-left: 1px solid #38bdf8`, background `rgb(56 189 248 / 0.08)`.
- Inline code: border `#2a2a2a`, background `#161616`, text **Cyan Signal (`#38bdf8`)**.
- Code blocks: border `#2a2a2a`, background `#111111`.
- Reasoning variant (`.compact-terminal-reasoning`): text `#c7b27a`, list marker **Amber (`#f59e0b`)**.

### Bash Command Tokenization

When shell commands are displayed inline, they are lexed into colored tokens:

| Token type | Color | Weight |
|------------|-------|--------|
| Command (first word) | `#22c55e` | `semibold` |
| Flags (`-x`, `--flag`) | `#d946ef` | normal |
| Environment / variables (`$VAR`, `KEY=val`) | `#facc15` | normal |
| Quoted strings | `#22c55e` | normal |
| Paths (contain `/` or start with `.`) | `#38bdf8` | normal |
| Pipes / redirects / control (`&&`, `\|\|`, `;`, `2>&1`) | `#ef4444` | `semibold` |
| Everything else | `#d4d4d4` | normal |

### Empty State

- Centered flex column inside the scroll area.
- Text: 12px **Dim Text (`#737373`)**.
- Content: loading text or "No trace selected." plus optional agent-profile buttons.
- Profile buttons: `border-[#3a3a3a]`, text `#d4d4d4`, hover border/text `#38bdf8`.

### Jump-to-Bottom Button

- Position: absolute, bottom-right (`right-4 bottom-4`).
- Border: **Cyan Signal (`#38bdf8`)**.
- Background: **Header Black (`#111111`)**.
- Text: 11px monospaced **Cyan Signal (`#38bdf8`)**.
- Hover: background **Hover Black (`#161616`)**.

## 5. Layout Principles

### Structure

The terminal is a single vertical transcript. Sidebars, inspectors, and navigation belong to the outer application shell, not to the terminal surface itself.

```text
┌─────────────────────────────────────────┐
│ [Optional: status bar — see §4]         │
├─────────────────────────────────────────┤
│                                         │
│  Scrollable row stream                  │
│  (monospaced, border-separated)         │
│                                         │
├─────────────────────────────────────────┤
│ [Optional: composer input]              │
│ [Latest] (floating, bottom-right)       │
└─────────────────────────────────────────┘
```

### Width And Wrapping

- Use full available width.
- Let terminal rows wrap with hanging indents.
- Wrapped detail rows align under the detail content, not under the bullet.
- Keep command continuation prefixes visually consistent: `  │ ` for command continuation and `  └ ` for output/detail.
- Long unbroken tokens should wrap without expanding the layout.

### Spacing Rhythm

- **Major cell gap:** 12px to 18px between semantic blocks (e.g., between a tool call group and the next assistant message).
- **Detail row gap:** 0px to 2px. Detail lines under a bullet should feel like continuous terminal output, not a spaced list.
- **Section divider margin:** 14px to 18px above and below when a major semantic section ends.
- **Transcript padding:** 12px to 16px horizontal, minimal vertical.
- **Row internal padding:** `py-2` absolute maximum. Prefer tighter where possible.
- **Avoid large `p-4` card interiors.** This is not a card system.

### Scrolling

- Vertical auto-scroll is locked to the bottom while streaming (`bottomLockedRef`).
- Scroll-to-bottom is triggered via `requestAnimationFrame` on session change and while rows are in `running` status.
- The user can break the lock by scrolling up; the "Latest" button reappears when `scrollHeight - scrollTop - clientHeight > 180`.
- New streaming content should stick to bottom only when the user is already near the bottom.

### Nesting & Indentation

- Nesting is expressed through prefix glyphs (`└`, ` `) rather than large left margins.
- The prefix column is fixed at `1.9rem`.
- Detail panels expand *below* the parent row without additional horizontal indentation.
- Deep nesting should not create excessive horizontal whitespace.

### Responsiveness

- The terminal panel uses `min-w-0 flex-1` so it can shrink inside a flex parent.
- Text wraps via `whitespace-pre-wrap break-words`.
- Overflow is hidden on the X axis; long lines wrap rather than scroll horizontally.
- On narrow screens, preserve the transcript first and hide secondary inspectors.

## 6. Motion And Interaction

- **Auto-scroll:** Smooth or instant scroll-to-bottom during active streaming. No decorative animations.
- **Hover reveals:** Action buttons fade in (`transition-opacity`) only when the row is hovered or focused.
- **Expand/collapse:** Detail panels and inline JSON toggle instantly; no height transitions.
- **Status pulse:** Running rows are indicated by a cyan bullet and a static "• Working" line at the bottom of the stream. No animated spinners inside the terminal surface itself.
- Motion should be minimal. The compact terminal should feel stable under rapid event updates. Avoid layout shift caused by badges, large icons, or dynamic card heights.

## 7. Accessibility And Contrast

- Do not rely on color alone. Status words and verbs must carry meaning.
- Keep minimum text contrast acceptable on Terminal Void.
- Provide accessible names for hover-only actions such as open child session, expand details, copy output, and fork.
- Preserve keyboard navigation through rows and details.
- Avoid tiny click targets for row actions; visual affordances can be compact, but hit areas should be at least 28px to 32px where practical.

## 8. Anti-Patterns

The following are **strictly forbidden** inside the terminal surface:

- **Do not** use sans-serif fonts inside the terminal surface.
- **Do not** add border-radius to badges, buttons, or panels; keep corners square or at most `2px`.
- **Do not** use drop shadows for elevation.
- **Do not** invent a light-mode variant; the terminal is dark-only.
- **Do not** display large card containers or rounded pills for trace nodes; the terminal flattens everything into lines.
- **Do not** show action buttons permanently; they must stay hidden until hover/focus to preserve scan density.
- **Do not** wrap every trace item in a bordered card.
- **Do not** use many accent colors beyond cyan, green, red, magenta, yellow, amber, blue, orange, and dim/default text.
- **Do not** add decorative gradients, glows, or rounded marketing panels.
- **Do not** expand full JSON payloads by default.
- **Do not** render tool calls as large `Input` / `Output` panels unless the user opens details.
- **Do not** use large icons as the primary semantic marker.
- **Do not** replace the transcript grammar with dashboard badges.
- **Do not** hide subagent relationships inside raw JSON.
- **Do not** let footer metadata overlap composer text.
