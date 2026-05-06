# Design System: Pibo Trace Terminal
**Project ID:** local-reference-pibo-tracing-ui

This design system is derived from the existing Trace Terminal UI in `<HOME>/code/pydantic-tracing`. It defines the visual language that should guide Pibo's new React and Tailwind Chat Web App and other future Pibo web surfaces.

Primary reference files:

- `<HOME>/code/pydantic-tracing/design/tracing-design-concept.html`
- `<HOME>/code/pydantic-tracing/src/styles.css`
- `<HOME>/code/pydantic-tracing/src/components/tracing/TraceHeader.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/TraceSidebar.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/TraceTimeline.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/SpanNode.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/JsonRenderer.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/TraceLogStream.tsx`

## 1. Visual Theme & Atmosphere

The Pibo Trace Terminal design is dense, technical, inspectable, and operational. It should feel like a focused agent-control console rather than a marketing product or a decorative dashboard.

The atmosphere is an industrial terminal with a refined web-application finish:

- **Technical but approachable:** Interface elements use compact labels, monospaced data, clear state colors, and visible hierarchy without becoming visually noisy.
- **Nested and investigative:** The core experience is progressive inspection. Users should see the high-level execution path first, then expand deeper layers only when needed.
- **Dark-first, light-compatible:** The design works in light mode, but the strongest identity is the dark terminal mode: deep teal-black backgrounds, quiet slate borders, cyan active states, and structured code panels.
- **Flat with restrained signal glow:** The interface relies on borders, tonal surfaces, and tiny glows for active execution. It does not use decorative gradients, large shadows, or atmospheric background effects.
- **Information-dense but organized:** The layout prioritizes scanning, comparison, and repeated use. Controls are compact. Panels are aligned. Labels are short. Technical payloads are hidden behind expandable sections until needed.

This design should be used for Pibo surfaces that expose agent activity, sessions, subagents, tool calls, execution commands, JSON payloads, traces, logs, and runtime status.

## 2. Color Palette & Roles

### Core Palette

- **Terminal Cyan (`#11a4d4`)**  
  Primary identity color. Used for active navigation, selected sidebar items, active trace borders, focus rings, primary buttons, streaming indicators, live status accents, and agent-run nodes.

- **Deep Terminal Charcoal (`#101d22`)**  
  Dark application background. Used behind the full app shell in dark mode. It creates the low-glare terminal atmosphere.

- **Panel Teal Black (`#1a262b`)**  
  Primary dark surface. Used for header bars, sidebars, trace cards, and major containers in dark mode.

- **Near-Black Code Well (`#0e1116`)**  
  Code and raw-log background. Used for tool-call signatures, raw log streams, JSON/code detail sections, and terminal-like payload views.

- **Header Charcoal (`#151f24`)**  
  Secondary dark surface. Used for card headers, input backgrounds, stat cards, log headers, sticky bars, and inactive technical controls.

- **Soft Laboratory Background (`#f6f8f8`)**  
  Light application background. Used for full-page light mode.

- **Clean Surface White (`#ffffff`)**  
  Light surface color. Used for panels, cards, sidebars, and headers in light mode.

### Semantic Status Colors

- **Matrix Success Green (`#0bda57`)**  
  Success and completion color. Used for completed spans, final model responses, live running dots, successful log entries, positive status badges, and progress bars when completion or health is emphasized.

- **Warning Orange (`#ff6b00`)**  
  Warning and recoverable-error color. Used for error counters, warning logs, failed trace badges, session issues, and high-attention execution states.

- **Error Red (`#ef4444`)**  
  Hard error color. Used for detailed error banners, exception blocks, failed payload sections, and destructive error emphasis. Warning Orange remains the broader system-alert color; Error Red is for explicit failure content.

### Span-Type Accent Colors

- **Agent Cyan (`#11a4d4`)**  
  Agent runs, active turns, primary execution flow, selected nodes.

- **Tool Purple (`#a855f7`)**  
  Tool calls and function invocation headers. Use sparingly so tools stand out from agent and result states.

- **Result Green (`#22c55e`)**  
  Tool results and returned values when distinct from global success.

- **Reasoning Amber (`#f59e0b`)**  
  Thinking, reasoning, planning, and model-internal explanation blocks.

- **Delegation Orange (`#f97316`)**  
  Agent delegation and subagent handoff nodes. This must be visually distinct from ordinary tool calls.

- **Prompt Cyan (`#06b6d4`)**  
  User prompt nodes and inbound message content.

- **Neutral Slate (`#64748b`)**  
  Inactive labels, metadata, timestamps, secondary text, empty states, and unselected session rows.

### Border And Divider Colors

- **Light Divider Slate (`#e2e8f0`)**  
  Light-mode borders between panels, rows, cards, and sticky headers.

- **Dark Divider Slate (`#1e293b`)**  
  Dark-mode panel separators and low-contrast card borders.

- **Technical Border Slate (`#334155`)**  
  Input borders, code panel borders, inactive icon buttons, and nested container dividers.

## 3. Typography Rules

### Font Families

- Use **Public Sans** for the designed product identity when available.
- Use the system sans stack as an acceptable runtime fallback: `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Oxygen`, `Ubuntu`, `Cantarell`, `Helvetica Neue`, `sans-serif`.
- Use a monospaced stack for all technical content: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `Liberation Mono`, `Courier New`, `monospace`.

### Text Hierarchy

- **Application title:** Bold, uppercase, compact, approximately 20px. It should feel like a terminal product label, not a hero headline.
- **Panel headers:** Bold, uppercase, compact, approximately 12px to 14px. Use moderate positive letter spacing.
- **Trace card labels:** Bold, uppercase, approximately 12px. Pair the label with an icon and a status/time cluster.
- **Body text:** 13px to 14px, regular or medium weight, optimized for dense reading.
- **Metadata:** 10px to 12px, often monospaced, slate-colored, and tabular where numbers are involved.
- **Code and JSON:** 12px, monospaced, syntax-colored where useful.

### Letter Spacing

- Use normal letter spacing for body text and chat content.
- Use slight positive tracking only for uppercase technical labels.
- Do not use negative letter spacing.

### Tone Of Text

Text should be short, operational, and concrete. Favor labels such as `Active`, `Done`, `Errors`, `Output`, `Input`, `Reasoning`, `Agent Delegation`, and `Execution Flow`. Avoid explanatory marketing copy inside the application surface.

## 4. Component Stylings

### App Shell

The app shell is full-height and panel-based. It uses a fixed top header and a three-panel work area:

- left sidebar for sessions, traces, stats, and navigation
- flexible center area for chat and nested execution flow
- right inspector or raw-log panel for details

The dark shell should use Deep Terminal Charcoal (`#101d22`) behind Panel Teal Black (`#1a262b`) surfaces. The light shell should use Soft Laboratory Background (`#f6f8f8`) behind Clean Surface White (`#ffffff`) surfaces.

### Header

Headers are compact horizontal control bars:

- height around 64px for global app headers
- height around 40px to 56px for panel headers
- background uses Clean Surface White (`#ffffff`) or Panel Teal Black (`#1a262b`)
- bottom border uses slate dividers
- active identity elements use Terminal Cyan (`#11a4d4`)

The header should contain the product/surface title, search, tabs, connection status, and compact icon buttons. It should not become a marketing navigation bar.

### Buttons

Buttons are compact and squared-off with lightly softened corners.

- **Primary buttons:** Terminal Cyan background (`#11a4d4`), white text, tiny radius, subtle shadow only when needed.
- **Secondary buttons:** Transparent or surface-colored with slate text, gaining Terminal Cyan text or border on hover.
- **Icon buttons:** 32px square, centered icon, slate border, dark header background, Terminal Cyan hover state.
- **Trace controls:** Compact icon buttons with accessible labels and tooltips for familiar actions such as default expansion, collapse all, expand all, and expand to a selected nesting level. Text labels are optional when they would consume excessive header space.

Buttons should use icons when the action is familiar and compact, especially for pause, play, download, search, user, notifications, expand, collapse, and refresh.

### Cards And Containers

Cards are thin, rectangular technical containers:

- use 2px radius for most cards and panels
- use 4px radius only for slightly softer secondary elements
- use 8px radius rarely, only for larger empty-state icon containers or special blocks
- use 1px borders as the primary separation mechanism
- use subtle shadows only for card lift; avoid heavy elevation

Trace cards should have:

- a compact clickable header
- a status-colored icon circle
- an uppercase label
- an optional muted name or summary
- a right-aligned timing cluster
- expandable content
- nested children in a lightly tinted child container

### Trace Nodes

Trace nodes are the signature component of this design.

Each node should feel like an inspectable execution record. It should be readable when collapsed and rich when expanded.

Required visual elements:

- left icon in a small circular badge
- status-specific border color
- uppercase node type label
- optional node title or tool name
- relative timestamp and duration in monospaced text
- expandable body
- nested child area with slight tonal contrast

Nested nodes should indent in small increments, around 12px per depth level. Deep nesting should expand horizontally when necessary while preserving a readable content width.

### Tool Call Cards

Tool calls should look like executable function calls, not generic JSON blocks.

Use a dark code well (`#0e1116`) with monospaced syntax:

- function keyword in violet
- tool/function name in warm yellow
- parameter keys in code blue
- string values in code green
- truncated inline argument previews for collapsed views

Expanded tool details should show:

- `Input` section with structured JSON
- `Output` section with structured JSON or plain text
- optional partial output while running
- clear error banner when failed

### Agent Delegation Cards

Agent delegation is a first-class visual concept and must not look like an ordinary tool call.

Use Delegation Orange (`#f97316`) with:

- branch or hub icon
- label such as `Agent Delegation`
- target subagent or profile name
- query or delegated task preview
- result status badge
- link or affordance to open the child session

Delegation cards may contain nested execution nodes from the child session when expanded. The same child session must also be selectable from the sidebar.

### Reasoning Blocks

Reasoning blocks use Reasoning Amber (`#f59e0b`) and a lightly tinted amber background.

They should be visually quieter than tool calls but clearly distinct from assistant output. Use monospaced text and optional comment-style lead text such as `// Model reasoning` when appropriate.

Reasoning should be collapsible or hideable because it can be long.

### Assistant And Final Output

Assistant output should use Result Green (`#0bda57` or `#22c55e`) when framed as a final result. Streaming output may show a small cyan cursor or pulse.

Plain conversational assistant text should remain readable and should not be forced into a code style unless the content is technical.

### User Message Blocks

User messages use Prompt Cyan (`#06b6d4`) or neutral slate depending on prominence.

User content can be displayed as quoted text inside a node body. It should remain clearly distinct from assistant output and from system/execution events.

### JSON Renderer

Structured payloads must be rendered with a proper JSON viewer pattern:

- parse JSON strings when possible
- support expand and collapse controls
- default to a shallow expanded view
- hide noisy data types and object-size chrome unless needed
- use monospaced 12px text
- use a dark transparent code surface in dark mode
- fall back to preformatted text for plain strings

JSON rendering is used for tool args, tool results, execution results, session tree data, errors, and raw event payloads.

### Raw Log / Inspector Panel

The raw log panel is darker and more terminal-like than the rest of the app:

- background Near-Black Code Well (`#0e1116`)
- header background Header Charcoal (`#151f24`)
- monospaced text
- 10px to 12px metadata labels
- left colored border per log level
- auto-scroll while live unless paused
- compact pause and download icon controls

The inspector should be useful but secondary. It should not compete visually with the central trace view.

### Inputs And Search

Inputs are compact technical fields:

- dark background Header Charcoal (`#151f24`) in dark mode
- light slate background in light mode
- slate border
- Terminal Cyan focus border and focus ring
- monospaced text for IDs, Pibo Session IDs, trace IDs, and command fields

Search fields should include a leading search icon and be sized for short identifiers.

Chat composers are compact message inputs:

- default to one visible line
- grow with entered new lines until five visible lines
- use an internal scrollbar after five visible lines
- keep the send control one-line high and bottom-aligned
- use a compact send icon button when the action is familiar
- keep line-height and resize measurement aligned so cursor spacing does not shift when scrolling begins

### Tabs And Navigation

Tabs are low-profile text controls:

- active tab uses Terminal Cyan text, a faint cyan background, and a subtle cyan border
- inactive tabs use muted slate text
- hover state shifts to Terminal Cyan
- tabs should be compact and aligned in a horizontal row

### Badges And Status Indicators

Badges are tiny, uppercase, and functional.

- Active: Terminal Cyan or Matrix Success Green tint
- Done: neutral slate or Matrix Success Green tint
- Error: Warning Orange or Error Red tint
- Running: small pulsing dot, usually Matrix Success Green or Terminal Cyan
- Paused: Terminal Cyan pulsing text

Use translucent backgrounds around 10% to 20% opacity so badges remain integrated with the surface.

### Empty States

Empty states should be quiet and centered:

- simple circular icon container
- one short title
- one muted sentence
- no illustration-heavy treatment
- no marketing language

## 5. Layout Principles

### Primary Layout

The standard operational layout is:

```text
Global Header
Session Sidebar | Main Chat + Trace Timeline | Inspector / Raw Events
```

Use fixed-width side panels and a flexible center:

- left sidebar around 320px
- right inspector around 384px
- center panel fills remaining width
- center trace content uses a readable width around `clamp(44rem, 58vw, 64rem)`

The center trace area may become horizontally scrollable when deep nesting requires more width.

### Spacing

Spacing is compact and systematic:

- 4px for tight icon/text gaps
- 8px for small control groups
- 12px for stat-card gaps and compact stacks
- 16px for card padding and sidebar rows
- 24px for timeline panel padding
- 32px only for large composition padding in high-density views

Prefer dense but legible spacing over airy marketing spacing.

### Borders And Separation

Use borders more than shadows.

- panel borders separate major regions
- card borders define each execution unit
- left accent borders mark selected sidebar rows and log levels
- subtle tinted borders communicate span type and status

### Nesting Behavior

Nesting is central to the design language.

Nested trace nodes should:

- indent by small increments
- preserve visible parent-child containment
- avoid large blank gaps
- keep headers scannable at every depth
- allow users to collapse entire subtrees
- show subagent delegation inline while also allowing direct sidebar navigation

### Responsive Behavior

Desktop is the primary target for full agent inspection.

For narrower screens:

- sidebar and inspector may become collapsible panels
- center trace remains primary
- controls stay compact
- text must wrap or truncate intentionally
- no text should overlap controls or timestamps

## 6. Motion And Interaction

Motion should communicate liveness, not decoration.

Use:

- pulsing dots for running status
- subtle spinner for active execution
- small cyan streaming cursor for live assistant output
- smooth color transitions on hover and focus
- auto-scroll only when the user is already at the bottom or has not paused the stream

Avoid:

- large animated backgrounds
- decorative glow effects
- exaggerated transitions
- motion that changes layout unpredictably

## 7. Applying This System Beyond Tracing

This design should become the broader Pibo web-app language.

Use the same principles for:

- Chat Web App
- session browser
- subagent session tree
- profile builder
- tool catalog
- execution action panels
- run-control views
- settings and config screens
- auth and account surfaces

When applying the system outside tracing:

- keep the operational three-panel structure where useful
- reuse compact headers and sidebars
- use trace cards for any nested process or inspectable execution
- render structured data with the JSON renderer pattern
- use the same semantic status colors
- keep controls dense and direct

The design should make Pibo feel like a precise agent runtime console: readable, nested, fast to scan, and built for understanding what agents actually did.
