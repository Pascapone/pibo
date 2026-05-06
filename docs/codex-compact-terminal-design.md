# Design System: Pibo Codex Compact Terminal
**Project ID:** local-reference-pibo-codex-compact-terminal

This document defines the visual language for a compact Pibo trace view inspired by the Codex TUI shown in the four-terminal screenshot and by the local Codex source under `<HOME>/code/codex/codex-rs/tui`.

Primary references:

- User-provided screenshot with four PowerShell/Windows Terminal panes showing Codex TUI history, tool calls, background terminal waits, build/typecheck output, and composer footer.
- `<HOME>/code/codex/codex-rs/tui/styles.md`
- `<HOME>/code/codex/codex-rs/tui/src/history_cell.rs`
- `<HOME>/code/codex/codex-rs/tui/src/exec_cell/model.rs`
- `<HOME>/code/codex/codex-rs/tui/src/exec_cell/render.rs`
- `<HOME>/code/codex/codex-rs/tui/src/multi_agents.rs`
- `<HOME>/code/codex/codex-rs/tui/src/bottom_pane/footer.rs`
- Codex TUI snapshot tests under `<HOME>/code/codex/codex-rs/tui/src/**/snapshots`

## 1. Visual Theme & Atmosphere

The compact terminal view is dense, operational, text-first, and intentionally low-decoration. It should feel like a live engineering console, not a dashboard. The strongest identity is the combination of near-black space, monospaced rows, minimal ANSI color, and short event phrases such as `Ran`, `Waited`, `Explored`, `Called`, `Spawned`, and `Finished waiting`.

The style is:

- **Terminal-native:** The view should look like a terminal transcript even when implemented in React. Prefer text rows, gutters, tree prefixes, and inline emphasis over cards.
- **Extremely compact:** Most events fit into one to three rows. Tool output is clipped aggressively. Long details are available through expansion, transcript, or inspector affordances.
- **Chronological and append-only:** The main surface reads from top to bottom like scrollback. Completed history remains quiet, while the active item gets a subtle live marker.
- **Semantic, not colorful:** Color is sparse and meaningful. Success, failure, current action, links, and product identity get color. Most content stays default or dim.
- **Agent-work oriented:** Tool calls, background terminals, subagents, queued messages, and status footers are first-class information, not secondary debug payloads.

The UI should avoid marketing polish, decorative gradients, floating cards, heavy shadows, large icons, and roomy spacing. The density is the feature.

## 2. Color Palette & Roles

Codex itself relies on terminal theme defaults and ANSI color roles rather than fixed custom colors. For Pibo web implementation, use the semantic roles below. The hex values are recommended web approximations for the screenshot and should stay subordinate to the role names.

### Terminal Base

- **Terminal Void (`#0b0b0b`)**  
  Primary content background. Used behind history, command output, transcript rows, and empty scrollback.

- **Terminal Chrome (`#2b2b2b`)**  
  Browser or shell chrome reference only. Do not use this as the main app background unless rendering a terminal-tab frame.

- **Composer Charcoal (`#2a2a2a`)**  
  Bottom input/composer background. It is visibly lighter than the transcript so the input area is discoverable without becoming a panel card.

- **Hairline Divider (`#5a5a5a`)**  
  Horizontal separators between major transcript groups and above the composer. Use 1px lines with low contrast.

### Text

- **Default Terminal Text (`#d4d4d4`)**  
  Main readable text. Use for assistant prose, command labels, event verbs, and primary rows.

- **Dim Terminal Text (`#737373`)**  
  Secondary metadata, command echoes, inactive footer content, tree gutters, old output, and hints. This is the dominant non-primary text color.

- **Muted Terminal Text (`#525252`)**  
  Very quiet context such as old command prefixes, collapsed output metadata, and inactive status fragments.

- **Input Placeholder (`#8a8a8a`)**  
  Composer placeholder and inactive prompt text.

### ANSI Semantic Accents

- **Terminal Cyan (`#38bdf8`)**  
  Selection, links, active command names, user input tips, focused references, and important navigable ids. Codex uses ANSI cyan for user-facing hints and selectable items.

- **Success Green (`#22c55e`)**  
  Successful command bullets, completed positive status, and additions. Use sparingly. A green dot should be enough for most success states.

- **Failure Red (`#ef4444`)**  
  Failed command bullets, denied approvals, destructive failures, and explicit errors.

- **Codex Magenta (`#d946ef`)**  
  Codex identity, slash commands, plan/collaboration mode markers, and occasional product-specific emphasis. This should not become a general decoration color.

- **Patch Green Background (`#006400`)**  
  Diff addition background in patch views. Use only for code diff blocks, never as a general success surface.

### Interaction Surfaces

- **Active Row Background (`#161616`)**  
  Optional hover or active-history row background. Use very lightly.

- **Input Focus Background (`#303030`)**  
  Composer focus state or selected command popup row.

- **Selection Reverse (`#0f766e`)**  
  Optional fallback for reversed/selected terminal rows when browser text reversal is impractical. Keep contrast high.

## 3. Typography Rules

### Font Families

- Use a monospaced font for the entire compact terminal surface:
  `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`.
- Do not mix in product sans-serif inside the transcript. If the surrounding Pibo shell uses sans-serif navigation, the compact terminal view itself should stay monospaced.

### Scale

- **Transcript row text:** 12px to 13px, line-height 1.35 to 1.45.
- **Dense metadata:** 11px to 12px.
- **Composer text:** 13px to 14px, line-height 1.35.
- **Footer/status line:** 11px to 12px.
- **No hero or display type:** This surface has no large headings.

### Weight And Emphasis

- Use `font-weight: 600` or `700` for event verbs and current state words: `Ran`, `Exploring`, `Calling`, `Waiting`, `Working`.
- Use normal weight for prose and command output.
- Use dim color instead of smaller type for secondary detail.
- Use italic only for user prompt previews or secondary snippets when the source content benefits from quote-like treatment.

### Letter Spacing And Case

- Letter spacing should be `0`.
- Do not uppercase labels by default. Codex uses sentence-like operational verbs, not badge labels.
- Preserve shell casing and tool names exactly.
- Use tabular numbers for durations, counts, and line numbers.

## 4. Component Stylings

### Compact Transcript Shell

The transcript shell is a near-black scroll container with no card framing. It should fill available height and allow native scrolling. History groups can be separated by a 1px horizontal rule when the preceding block is complete or when a large semantic section starts.

Recommended CSS:

- background: Terminal Void (`#0b0b0b`)
- color: Default Terminal Text (`#d4d4d4`)
- padding: 12px to 16px horizontally
- gap between major cells: 12px to 18px
- row gap inside a cell: 2px to 4px
- border radius: none

### History Cells

A history cell is the atomic display unit. It maps one Pibo trace item, grouped tool run, subagent event, or assistant/user message to compact terminal rows.

Required pattern:

```text
• Ran npm run typecheck
  └ > pibo@0.1.0 chat-ui:typecheck
    +4 lines (ctrl + t to view transcript)
```

Rules:

- Start most system/tool cells with a bullet marker.
- Use bullet color for status: green for success, red for failure, dim/default for neutral or pending.
- Event verb is bold.
- Object text follows inline when it fits.
- Details use tree prefixes: `  └ ` for the first detail row and `    ` for following rows.
- Do not wrap every event in a card or border.

### Tool Calls

Tool calls should read like compact executable records, not JSON panels.

States:

- Running: `• Calling tool.name({...})`
- Complete: `• Called tool.name({...})`
- Failed: red bullet plus short error detail

Detail rows:

```text
• Called search.find_docs({"query":"ratatui styling","limit":3})
  └ Found styling guidance in styles.md
```

Rules:

- Inline argument previews should be short and stable.
- Prefer one-line JSON-like previews for args.
- Output previews are limited to about 5 visible rows by default.
- Long output keeps head and tail with a middle omission line.
- A detail affordance may expose full input/output, but the default row stays compact.

### Background Terminal And Command Runs

Background process state is a first-class row.

Examples:

```text
• Ran npm run web-ui:build
  └ > pibo@0.1.0 chat-ui:build

• Waited for background terminal

• Waiting for background terminal (0s • esc to interrupt)
  └ cargo test -p codex-core -- --exact...
```

Rules:

- `Ran` and `Waited` should be visually distinct but not boxed.
- Waiting/running rows can use a subtle spinner bullet or pulsing dot.
- Command output is dimmed.
- The command itself can use cyan for the executable or package script name.
- Preserve terminal output spacing where it matters, but trim blank noise.

### Exploring Groups

Codex groups read/list/search operations into an `Exploring` or `Explored` cell. This is important for compactness and should be copied for Pibo trace rendering.

Example:

```text
• Explored
  └ Search import .*prismjs
    Read agent-profiles.ts
```

Rules:

- Group adjacent read/list/search-like tool calls when they are part of the same model turn and no assistant text appears between them.
- Use `Exploring` while any child call is running.
- Use `Explored` when all grouped calls are complete.
- Each child row starts with a short action verb: `Read`, `List`, `Search`, `Open`.
- Do not show full JSON args for these grouped rows unless expanded.

### Subagents And Delegation

Subagent work should use the same terminal-row grammar as tool calls, but with clearer human labels.

Examples:

```text
• Spawned Robie [explorer] (gpt-5 high)
  └ Explore the repo

• Waiting for 2 agents
  └ Robie [explorer]
    Ada [reviewer]

• Finished waiting
  └ Robie [explorer]: Completed - Done
    Ada [reviewer]: Running
```

Rules:

- Use cyan for navigable agent names or child session ids.
- Role labels such as `[explorer]` stay default or dim.
- Link/open-child affordances should be available on hover or via a compact icon, but not always consume row space.
- Waiting summaries should show counts first, then detail rows only when useful.

### Assistant Messages

Assistant prose is a plain transcript block, not a card. It may be preceded by a bullet when it is a status/event row, but final prose should read naturally.

Rules:

- Use Default Terminal Text.
- Markdown can be rendered, but keep code blocks compact.
- Insert a subtle separator before a new assistant turn when it follows tool-heavy output.
- Avoid large paragraph margins. Use normal terminal line rhythm.

### User Messages And Composer Echo

User input uses the prompt marker `›` and appears visually tied to the composer.

Example:

```text
› Ask Codex to do anything
```

Rules:

- Prompt marker is dim or default; active typed text is default.
- Placeholder text is dim.
- Submitted user text can be shown as a compact quoted or prompt-prefixed block.
- Attached images use rows like `[Image #1]`, with numbering preserved.

### Composer

The composer is a bottom pane, not a floating input card.

Recommended styling:

- background: Composer Charcoal (`#2a2a2a`)
- height: content-driven, usually 44px to 80px
- border-top: 1px Hairline Divider (`#5a5a5a`)
- prompt marker: `›`
- placeholder: `Use /skills to list available skills`
- footer row below or within composer uses dim text

The composer should support a passive context footer:

```text
gpt-5.4 high · ~/code/pibo
```

Rules:

- Footer must collapse before overlapping input.
- Keep the model/status context visible when there is room.
- While a task is running, hints should become operational: interrupt, queue, wait, or active agent state.

### Status Footer

The footer is a one-line adaptive status area. It can show model, reasoning effort, cwd, mode, active agent label, context usage, queue hints, or shortcut hints.

Rules:

- Prefer one line.
- Use ` · ` separators.
- Dim passive information.
- Use magenta for Plan mode or Codex/Pibo mode identity.
- Use cyan for selectable modes or active agent names.
- Hide lower-priority hints as width shrinks.

### Diff And Patch Blocks

Diff blocks can use saturated backgrounds because they represent code state, not general UI state.

Rules:

- Additions: Patch Green Background (`#006400`) with readable light text.
- Deletions: dark red background if needed, with Failure Red accents.
- Line numbers and unchanged code are dim.
- Do not apply diff backgrounds to ordinary tool output.

### Popups And Menus

Menus and slash popups should look terminal-native:

- dark rectangular overlay
- no rounded card shell beyond 2px to 4px if needed
- selected row uses cyan/reverse-video treatment
- descriptions are dim
- key hints are dim or cyan
- no heavy drop shadows unless needed over dense transcript content

## 5. Layout Principles

### Primary Layout

The compact view should be a single vertical terminal transcript with a pinned bottom composer. Sidebars and inspectors may remain part of the outer Pibo shell, but the center view should not become a nested card layout.

Recommended center layout:

```text
scrolling transcript
--------------------
composer input
status/footer
```

### Width And Wrapping

- Use full available width.
- Let terminal rows wrap with hanging indents.
- Wrapped detail rows align under the detail content, not under the bullet.
- Keep command continuation prefixes visually consistent: `  │ ` for command continuation and `  └ ` for output/detail.
- Long unbroken tokens should wrap without expanding the layout.

### Spacing Rhythm

- Major cell gap: 12px to 18px.
- Detail row gap: 0px to 2px.
- Section divider margin: 14px to 18px above and below.
- Composer padding: 8px to 12px.
- Avoid large `p-4` card interiors in this view.

### Scrolling

- New streaming content should stick to bottom only when the user is already near the bottom.
- If the user scrolls up, do not force-scroll.
- Provide a small latest/jump affordance only when needed.
- Keep the composer fixed while transcript scrolls.

### Terminal Virtualization

The compact terminal uses `react-virtuoso` for long transcripts. Do not replace it with a custom virtualizer unless there is a measured defect that Virtuoso cannot handle.

Current tuning:

- Use stable row ids through `computeItemKey`.
- Start new or loaded sessions at the latest row with `initialTopMostItemIndex` aligned to the end.
- Use generous top and bottom overscan so rapid scrolling does not expose blank rows.
- Set `defaultItemHeight` to `84px`. This is intentionally higher than the smallest row. A low estimate makes Virtuoso correct total height while scrolling, which feels like broken virtualization.
- Let Virtuoso keep the rolling DOM window in both directions. Browser checks should verify mounted terminal rows stay bounded while scrolling from bottom to top and back down.

The scroll surface should remain visually stable. If the scrollbar jumps, first check row-height estimates, item keys, and accidental trace truncation before changing the rendering model.

### Responsive Behavior

- On narrow screens, preserve the transcript first and hide secondary inspectors.
- Composer footer should collapse before wrapping into noisy multi-line metadata.
- Tool detail drawers can become full-width below the selected row.
- Avoid horizontal overflow except for explicitly preformatted code blocks.

## 6. Motion And Interaction

Motion should be minimal.

- Running state: subtle pulsing dot or spinner bullet.
- Hover: slightly brighter text or Active Row Background.
- Selection: cyan or reverse-video row treatment.
- Expand/collapse: instant or very fast, no elaborate animation.
- Streaming text: append naturally in place.

The compact terminal should feel stable under rapid event updates. Avoid layout shift caused by badges, large icons, or dynamic card heights.

## 7. Applying This System To Pibo Trace Views

The compact terminal view should consume Pibo trace data and render it through a terminal-row model.

Recommended row kinds:

- `message.user`
- `message.assistant`
- `reasoning`
- `tool.call`
- `tool.group.exploring`
- `tool.result`
- `agent.delegation`
- `agent.wait`
- `yielded.run`
- `execution.command`
- `error`

Each row should define:

- primary line text
- status
- optional detail lines
- optional full detail payload
- linked Pibo Session ID
- source trace node ids
- whether it can be grouped
- whether it is expandable

This keeps visual rendering separate from Pibo runtime data and allows the same trace projection to support both the existing card timeline and the compact terminal view.

## 8. Accessibility And Contrast

- Do not rely on color alone. Status words and verbs must carry meaning.
- Keep minimum text contrast acceptable on Terminal Void.
- Provide accessible names for hover-only actions such as open child session, expand details, copy output, and fork.
- Preserve keyboard navigation through rows and details.
- Avoid tiny click targets for row actions; visual affordances can be compact, but hit areas should be at least 28px to 32px where practical.

## 9. Anti-Patterns

Do not:

- Wrap every trace item in a bordered card.
- Use many accent colors beyond cyan, green, red, magenta, and dim/default text.
- Add decorative gradients, glows, or rounded marketing panels.
- Expand full JSON payloads by default.
- Render tool calls as large `Input` / `Output` panels unless the user opens details.
- Use large icons as the primary semantic marker.
- Replace the transcript grammar with dashboard badges.
- Let footer metadata overlap composer text.
- Hide subagent relationships inside raw JSON.

## 10. Source Facts Versus Recommendations

Source facts from Codex:

- Codex TUI uses ratatui, not React.
- The style guide prefers default foreground, dim secondary text, cyan selection/hints, green success, red failure, and magenta Codex identity.
- `HistoryCell` is the display unit for transcript entries.
- Tool output defaults to a small visible preview, around 5 rows for ordinary tool calls.
- Read/list/search commands can be grouped into `Exploring` / `Explored` cells.
- Subagent events render as compact rows such as `Spawned`, `Waiting for`, and `Finished waiting`.

Recommendations for Pibo:

- Implement a web-native compact renderer rather than extracting Rust UI code.
- Preserve the current Pibo Trace Terminal design as the existing/default view.
- Treat this document as the design source for a second compact view.
- Use a small view interface that accepts normalized Pibo trace data, not raw Pi/Codex events.
