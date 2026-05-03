# Design System: Pibo Trace View
**Project ID:** local-reference-pibo-trace-view

This design system defines the visual language of the **Trace** session view in Pibo’s Chat Web App. It is a structured, card-based, nested execution inspector — visually richer and more hierarchical than the compact Terminal transcript.

Primary reference files:

- `src/apps/chat-ui/src/session-views/TraceSessionView.tsx`
- `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`
- `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`
- `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`
- `src/apps/chat-ui/src/tracing/traceTree.ts`
- `src/apps/chat-ui/src/tracing/adapt.ts`
- `src/apps/chat-ui/src/styles.css` (`.model-response-markdown` rules)

## 1. Visual Theme & Atmosphere

The Trace View is **technical, nested, and inspectable**. It should feel like a focused agent-control console: users see a high-level execution path first, then expand deeper layers only when needed.

- **Card-based hierarchy:** Every execution unit is rendered as a bordered card with a distinct header, content area, and nested child container. This is the primary visual difference from the flat Terminal transcript.
- **Dark-first:** The strongest identity is the dark terminal mode — deep teal-black backgrounds, quiet slate borders, cyan active states, and structured code panels.
- **Flat with restrained signal glow:** The interface relies on borders, tonal surfaces, and tiny glows for active execution. It does not use decorative gradients, large shadows, or atmospheric background effects.
- **Status-driven color:** Border color, header tint, and icon glow all communicate the span’s status (active, completed, error) at a glance.
- **Information-dense but organized:** Controls are compact. Panels are aligned. Labels are short uppercase badges. Technical payloads are hidden behind expandable sections until needed.

## 2. Color Palette & Roles

### Canvas & Surfaces

- **Deep Trace Charcoal (`#0c1214`)**  
  The viewport background behind the entire timeline.

- **Panel Teal Black (`#1a262b`)**  
  Primary card surface, sticky header background, and child-panel backdrop.

- **Header Charcoal (`#151f24`)**  
  Card headers for inactive/default spans, input backgrounds, and secondary controls.

- **Near-Black Code Well (`#0e1116`)**  
  Code and JSON detail backgrounds inside tool calls and raw panels.

- **Slate-900/50 (`bg-slate-900/50`)**  
  Nested children container background — slightly lighter than the card surface to create containment depth.

### Semantic Status Colors

- **Terminal Cyan (`#11a4d4`)**  
  Active / running / primary identity. Used for active borders, active header tints, primary badges, streaming indicators, focus rings, and icon glows.

- **Matrix Success Green (`#0bda57`)**  
  Completed / healthy spans. Used for OK card borders, OK header tints, completion badges, and model-response accents.

- **Warning Orange (`#ff6b00`)**  
  Error spans at the card level. Used for ERROR card borders and ERROR header tints. (Note: explicit failure content inside cards uses red-500.)

- **Error Red (`#ef4444` / `red-500`)**  
  Hard error content: error banners, exception blocks, failed payload sections.

### Span-Type Accent Colors

Each span type has a signature color used for its label, icon badge border, icon badge background, and icon itself:

| Span Type | Color | Tailwind equivalent |
|-----------|-------|---------------------|
| `agent.run` | `#11a4d4` | `text-[#11a4d4]` |
| `tool.call` | `#a855f7` | `text-purple-500` |
| `tool.result` | `#22c55e` | `text-green-500` |
| `model.request` | `#3b82f6` | `text-blue-500` |
| `model.response` | `#0bda57` | `text-[#0bda57]` |
| `model.reasoning` | `#f59e0b` | `text-amber-500` |
| `agent.delegation` | `#f97316` | `text-orange-500` |
| `agent.async` | `#f97316` | `text-orange-500` |
| `yielded.run` | `#11a4d4` | `text-[#11a4d4]` |
| `user.prompt` | `#06b6d4` | `text-cyan-500` |
| `user_input` | `#64748b` | `text-slate-500` |

### Borders & Dividers

- **Default Card Border (`border-slate-700`)**  
  Inactive spans and general panel separation.

- **Active Border (`border-[#11a4d4]/50`)**  
  Running/active spans.

- **OK Border (`border-[#0bda57]/30`)**  
  Successfully completed spans.

- **Error Border (`border-[#ff6b00]/50`)**  
  Spans with ERROR status.

- **Child Panel Top Border (`border-slate-700`)**  
  Separates the nested children area from the parent card content.

- **Detail Sub-Border (`border-slate-700/40`, `border-slate-700/30`)**  
  Internal divisions inside expanded tool details.

### Text Colors

- **Primary Text (`text-slate-200`)**  
  Headings, card titles, main content.

- **Secondary Text (`text-slate-300`)**  
  Body text inside cards, tool output previews.

- **Muted Text (`text-slate-400` / `text-slate-500`)**  
  Metadata, timestamps, duration labels, placeholders.

## 3. Typography Rules

### Font Families

- **UI and labels:** System sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, etc.).
- **Technical content:** Monospace stack (`ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, etc.) for timing, JSON, code, tool signatures, and breadcrumbs.

### Scale & Weight

- **Panel title / app header:** `text-sm font-bold uppercase tracking-wide`.
- **Span type label:** `text-xs font-bold uppercase tracking-wider`.
- **Card body:** `text-sm` (sans) or `text-sm` monospace for user prompts and reasoning.
- **Detail section headers:** `text-[10px] font-semibold uppercase tracking-wider` (e.g., "Input", "Output").
- **Metadata / timing:** `text-[10px]` to `text-xs`, monospace, tabular nums.
- **Badges:** `text-xs font-bold uppercase`.

### Case & Spacing

- Labels are **uppercase** with **positive letter spacing** (`tracking-wider`, `tracking-wide`).
- Body text and markdown use normal case.
- Tone is operational and concrete: `Agent Run`, `Tool Call`, `Model Response`, `Executing...`.

## 4. Component Stylings

### Timeline Shell

- Full-height flex column: `min-w-0 flex-1 flex flex-col`.
- Background: **Deep Trace Charcoal (`#0c1214`)**.
- Content area uses a readable max width: `clamp(36rem, 58vw, 64rem)` via CSS custom property `--trace-readable-width`.
- Padding around timeline content: `p-6`.

### Sticky Header Bar

- Height: `min-h-14` (~56px).
- Background: **Panel Teal Black (`#1a262b`/80)** with `border-b border-slate-800`.
- Sticky at `top-0 z-20`.
- Left side: `GitBranch` icon in Terminal Cyan, title `Execution Flow`, stats badges, origin/derived session buttons, breadcrumbs.
- Right side: expansion control icon buttons (Default, Collapse All, Expand All) + nesting-level input form.

### Badges

- Shape: `rounded-sm` (2px radius).
- Padding: `px-2 py-0.5`.
- Text: `text-xs font-bold uppercase`.
- **Cyan badge:** `bg-[#11a4d4]/20 text-[#11a4d4]`.
- **Green badge:** `bg-[#0bda57]/20 text-[#0bda57]`.
- **Orange badge:** `bg-[#ff6b00]/20 text-[#ff6b00]`.
- **Transparent badge:** `border border-slate-700 text-slate-300` (for agent profile names).

### Span Node Card

The signature component of the Trace view.

#### Card Container

- Background: `bg-white dark:bg-[#1a262b]` — in practice always dark mode.
- Border: 1px, color depends on status (see Color Palette).
- Radius: `rounded-sm` (2px).
- Shadow: `shadow-sm` on all cards; active cards add a glow: `shadow-[0_0_10px_rgba(17,164,212,0.1)]`.
- Margin bottom: `mb-4` between sibling cards.

#### Card Header

- Layout: full-width flex row with left toggle button, center label cluster, right actions and timing.
- Background tint: status-dependent (active `#11a4d4/5`, OK `#0bda57/5`, error `#ff6b00/5`, default `#151f24`).
- Bottom border on expanded cards: `border-b` in the span type color at 20% opacity.
- Toggle: clickable header area with `ChevronDown` / `ChevronRight` at 12px.

#### Icon Badge

- Size: `24px` circle (`h-6 w-6 rounded-full`).
- Background: span-type color at `20%` opacity.
- Border: `2px solid` in span-type color.
- Icon: 14px Lucide icon in span-type color.
- Active glow: `shadow-[0_0_10px_rgba(17,164,212,0.4)]`.
- Active dot: tiny `6px` cyan pulse badge at top-right of the icon.

#### Header Label Cluster

- Span type label: uppercase, bold, in type color.
- Optional name: `font-normal text-slate-500 dark:text-slate-400 normal-case`, truncated.
- Active pulse dot: `w-1.5 h-1.5 rounded-full bg-[#11a4d4] animate-pulse`.

#### Header Timing

- Fixed-width cluster: `w-36 shrink-0`, right-aligned.
- Duration: `text-[10px] text-slate-500`.
- Relative time: `text-xs text-slate-400` in monospace tabular format (`MM:SS.mmm`).

#### Header Actions

- Fork button: `h-8 w-8` icon button, `GitBranch` icon.
- Open child session button: `h-8 w-8` icon button, `ExternalLink` icon.
- Style: `rounded-sm border border-slate-700 bg-[#151f24]/80 text-slate-400`, hover border/text to Terminal Cyan.

### Span Content Areas

Content varies by span type:

#### User Prompt
- `p-4` monospace `text-sm text-slate-300 whitespace-pre-wrap`.
- Background tint: `bg-[#11a4d4]/10` on the entire card for user messages.

#### Model Response
- `p-4` sans-serif `text-sm text-slate-200 leading-relaxed`.
- Uses `.model-response-markdown` for rendered markdown (headings, lists, code blocks, tables, blockquotes).

#### Tool Call
- Signature block: `p-4 bg-[#0e1116] border-b border-slate-800` with syntax-colored `def name(args)` signature.
  - `def` keyword in purple-400.
  - Function name in yellow-300.
  - Argument keys in blue-400.
  - String values in green-300.
- Optional output preview bar: `px-4 py-2 bg-[#1a262b] flex items-center gap-2` with truncated mono output.
- Expandable details: toggle button with `Eye` / `EyeOff`, then Input/Output JSON sections.

#### Tool Result
- `p-4 bg-green-500/5 border-t border-green-500/20`.
- Label: `text-xs font-medium text-green-400`.
- Content: `JsonRenderer`.

#### Reasoning
- `p-4 font-mono text-sm text-slate-300 bg-amber-500/5 leading-relaxed whitespace-pre-wrap`.
- Lead comment: `// Model reasoning` in `text-amber-500 opacity-60`.

#### Agent Delegation
- `p-4 border-b border-orange-500/20 bg-orange-500/5`.
- Icon + label in orange-500, target agent name in `text-slate-200`.
- Optional result status badge: `rounded-sm bg-green-500/20 text-green-500`.
- Optional query preview: `text-xs text-slate-400 font-mono italic line-clamp-2`.

#### Yielded Run
- `p-4 border-b border-[#11a4d4]/20 bg-[#11a4d4]/5`.
- Bell icon + `Run notification` label in cyan.
- Summary grid of completed/failed/cancelled/running groups with color-coded headers.

#### Error Banner
- `mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-sm text-xs`.
- Title: `font-semibold text-red-500`.
- Message: `font-mono text-red-400`.

### Nested Children Container

- Triggered when a span has children and both content and children are expanded.
- `min-w-0 border-t border-slate-700 bg-slate-900/50 py-4`.
- Children are rendered as nested `SpanNode` components.
- Indentation: `12px` per depth level (`NESTING_INDENT_PX`).
- Width: `calc(100% - 12px)` for nested cards to prevent overflow.

### JSON Renderer

- Container: `min-w-0 max-w-full overflow-auto rounded-sm text-xs` with `max-height: 24rem`.
- Background: transparent (inherits parent).
- Theme: VS Code theme via `@uiw/react-json-view`.
- Controls: Expand All / Collapse All buttons (`text-[10px]`, `rounded-sm`, `bg-slate-800/50`).
- Fallback for non-JSON: `<pre>` with `font-mono text-xs text-slate-300`.

### Markdown Renderer

- Used inside model-response spans.
- Class: `.model-response-markdown`.
- Headings: `text-slate-200 font-bold`, h1 at `1.15rem`, h2 at `1.05rem`.
- Links: `#42c7ec` with underline, hover `#7dd3fc`.
- Lists: disc / decimal, marker color Terminal Cyan.
- Blockquotes: left border `#0bda57`, background `rgb(11 218 87 / 0.07)`.
- Code inline: border `rgb(226 232 240 / 0.18)`, background `#111a1f`, text Terminal Cyan.
- Code blocks: background `#0e1116`, left border `#0bda57`, font-size `0.78rem`.
- Tables: border `#334155`, header background `rgb(17 164 212 / 0.12)`.

### Timeline Controls (Icon Buttons)

- Size: `h-8 w-8`.
- Shape: `rounded-sm`.
- Border: `border-slate-700`.
- Background: `bg-[#151f24]/80`.
- Text/Icon: `text-slate-400`.
- Active state: `border-[#11a4d4] bg-[#11a4d4]/10 text-[#11a4d4]`.
- Hover: border and text shift to Terminal Cyan.

### Nesting-Level Input Form

- Height: `h-8`.
- Border: `border-slate-700`, focus-within: `border-[#11a4d4]`.
- Background: `bg-[#151f24]/80`.
- Input: `w-11 bg-transparent text-center font-mono text-xs text-slate-300`.
- Submit button: `w-8` with `ListTree` icon, left border `border-slate-700`.

### Empty State

- Centered flex column.
- Icon container: `h-12 w-12 rounded-sm border border-[#11a4d4]/35 bg-[#11a4d4]/10 text-[#11a4d4]` with `MessageSquarePlus` icon.
- Title: `text-2xl font-semibold text-slate-200`.
- Subtitle: `text-sm text-slate-500`.
- Optional agent chooser grid: `sm:grid-cols-2` cards with `border-slate-700 bg-[#151f24]`.

### Streaming Indicator

- Card: `bg-[#1a262b] border border-[#11a4d4]/30 rounded-sm p-4`.
- Icon: `RefreshCw` inside a pulsing `24px` cyan ring.
- Text: `text-sm text-[#11a4d4]`.

### Jump-to-Bottom Button

- Position: absolute `right-4 bottom-4 z-30`.
- Size: `h-9 w-9`.
- Shape: `rounded-sm`.
- Border: `border-[#11a4d4]`.
- Background: `bg-[#151f24]/95`.
- Icon: `ChevronDown` in Terminal Cyan.
- Shadow: `shadow-lg shadow-black/30`.
- Hover: `bg-[#11a4d4] text-white`.

## 5. Layout Principles

### Structure

```text
┌─────────────────────────────────────────┐
│ Sticky Header (Execution Flow + Controls)│
├─────────────────────────────────────────┤
│                                         │
│  Timeline Content Area                  │
│  ├── Span Card                          │
│  │   ├── Header                         │
│  │   ├── Content                        │
│  │   └── Children Container             │
│  │       └── Nested Span Cards...       │
│  └── ...                                │
│                                         │
├─────────────────────────────────────────┤
│ [▼] (jump-to-bottom)                    │
└─────────────────────────────────────────┘
```

- The timeline is a single scrollable panel.
- The outer Chat Web App may embed this inside a larger three-column layout, but the Trace view itself does not define sidebars.

### Nesting & Indentation

- Each depth level indents by `12px`.
- Nested cards shrink by `12px` in width to prevent horizontal overflow.
- The root card width is governed by `--trace-readable-width`.
- Deep nesting may cause horizontal scrolling of the entire timeline if the viewport is too narrow.

### Spacing

- Timeline padding: `p-6`.
- Gap between sibling cards: `mb-4`.
- Card internal padding: `px-4 py-2` (header), `p-4` (content).
- Children container padding: `py-4` (top/bottom only; left indent is handled by margin).

### Responsive Behavior

- Desktop is the primary target.
- The timeline content uses `max-width: var(--trace-readable-width)` which clamps between `36rem` and `64rem`.
- On narrow viewports, the timeline may scroll horizontally due to nested indentation.
- The sticky header wraps badges and controls via `flex-wrap`.

## 6. Motion And Interaction

- **Auto-scroll:** Locked to bottom while streaming (`bottomLockedRef`). Breaks when the user scrolls up; restored by the jump-to-bottom button.
- **Expansion/Collapse:** Instant state change — no height animations on cards.
- **Hover:** Card borders increase opacity (`hover:border-opacity-70`).
- **Active glow:** Subtle cyan shadow on active cards and icon badges.
- **Pulse:** Active status dots and the streaming indicator ring use `animate-pulse`.
- **Spin:** `RefreshCw` icon in the loading/streaming indicator uses `animate-spin`.
- **Button transitions:** Colors and borders transition smoothly on hover/focus.

## 7. Anti-Patterns

- Do **not** use heavy drop shadows or gradients — keep elevation flat and signal-driven.
- Do **not** round corners beyond `rounded-sm` (2px); the Trace view is squared-off and technical.
- Do **not** mix light-mode surfaces inside the Trace timeline; it is designed for dark mode.
- Do **not** flatten nested execution into a single list; preserve the card-and-indent hierarchy.
- Do **not** show all technical payloads by default; hide them behind expandable detail sections.
- Do **not** use different font families for different span types; keep UI sans-serif and technical content monospace consistently.
