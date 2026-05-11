# Spec: Chat Web Safe Content Rendering

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Curated CLI Tools](./curated-cli-tools.md)

## Why

Chat Web renders assistant messages, reasoning, tool arguments, tool results, debug payloads, and curated tool hints that can originate from model output, tools, transcripts, or locally installed metadata. These values must be readable without allowing arbitrary HTML, unsafe links, layout-breaking payloads, or unbounded object expansion to compromise the browser UI.

The trace and terminal specs define where content appears. This spec defines the shared rendering contract for markdown, JSON, inline function calls, and detail payloads.

## Goal

Chat Web MUST render untrusted markdown and structured values with explicit allowlists, bounded expansion, safe links, and readable fallbacks across trace views, compact terminal rows, context panels, and debug payloads.

## Background / Current State

The current implementation is centered on `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`, `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`, `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`, `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`, and `src/apps/chat-ui/src/session-views/compact-terminal/terminalValue.ts`.

`MarkdownRenderer` uses `react-markdown` with GitHub-flavored markdown, skips raw HTML, allows a fixed element list, applies a safe URL transform, opens links in a new tab, and syntax-highlights known code languages. `JsonRenderer` parses JSON-like strings or objects, renders expandable/collapsible structured values with bounded text shortening, and falls back to escaped preformatted text. Compact terminal details normalize text wrappers, parse embedded JSON where possible, and keep inline function-call JSON collapsible.

## Scope

### In Scope

- Markdown rendering for assistant messages, reasoning, trace content, and Pibo tool snippets.
- Safe URL handling for markdown links.
- Code-block language normalization and syntax highlighting fallback.
- JSON and JSON-like string rendering for trace, tool, debug, and terminal detail payloads.
- Inline function-call argument rendering in compact terminal rows.
- Text-wrapper normalization for common model and provider payload shapes.
- Bounded display behavior for long strings and tall JSON blocks.

### Out of Scope

- Server-side trace materialization and row ordering — covered by the trace and terminal spec.
- Styling tokens, color choices, and responsive layout details.
- Sanitizing data before persistence; this spec covers browser rendering behavior.
- Rich rendering for files, images, or attachments beyond current markdown and JSON behavior.

## Requirements

### Requirement: Markdown allows only approved presentation elements

The browser MUST render markdown through a fixed allowlist and MUST skip raw HTML from rendered content.

#### Current

`MarkdownRenderer` allows paragraphs, line breaks, emphasis, links, lists, blockquotes, code, headings, rules, tables, checkboxes, and deletions. It passes `skipHtml` to `ReactMarkdown`.

#### Target

Model or tool output can use common markdown formatting but cannot inject arbitrary elements or raw HTML into Chat Web.

#### Acceptance

- Raw HTML in markdown input is not rendered as DOM HTML.
- Unsupported markdown-derived elements are omitted rather than passed through.
- GFM tables, task-list checkboxes, strikethrough, lists, headings, and code remain renderable.
- Checkbox inputs render read-only and disabled.

#### Scenario: Raw HTML in assistant text

- GIVEN an assistant response contains raw `<script>` or inline HTML
- WHEN Chat Web renders the message as markdown
- THEN the raw HTML is skipped
- AND the supported surrounding markdown remains visible.

### Requirement: Markdown links are protocol-limited and isolated

The browser MUST allow only safe markdown link targets and MUST open accepted links without passing opener access.

#### Current

`safeUrlTransform` accepts relative paths, fragment links, and absolute `http:`, `https:`, or `mailto:` URLs. Link components render with `target="_blank"` and `rel="noreferrer"`.

#### Target

Rendered markdown links should be useful for documentation and external references without enabling script URLs or opener-based browser attacks.

#### Acceptance

- `http:`, `https:`, `mailto:`, relative, and fragment links can render.
- `javascript:`, data URLs, malformed URLs, and unsupported protocols render without a usable `href`.
- Links that open a new tab include `rel="noreferrer"`.

#### Scenario: Unsafe markdown link

- GIVEN markdown contains `[x](javascript:alert(1))`
- WHEN Chat Web renders the markdown
- THEN the link does not expose a usable JavaScript URL.

### Requirement: Code highlighting is best-effort and non-blocking

The browser MUST normalize common language aliases and highlight only when a supported Prism grammar exists.

#### Current

`languageFromClassName` maps `sh` and `shell` to `bash`, `js` to `javascript`, `ts` to `typescript`, `md` to `markdown`, and `yml` to `yaml`. Unknown languages render as plain code.

#### Target

Code blocks remain readable even when the declared language is absent, unsupported, or misspelled.

#### Acceptance

- Supported aliases use the canonical highlighter.
- Unknown languages render as escaped code text without throwing.
- Highlighting never executes content from the code block.

#### Scenario: Unknown code language

- GIVEN a markdown code block declares `language-madeup`
- WHEN the block is rendered
- THEN Chat Web shows the code as plain code and does not fail the message render.

### Requirement: Structured payloads render as bounded JSON when possible

The browser MUST parse objects and JSON-like strings into a structured JSON view and MUST fall back to escaped preformatted text for non-JSON values.

#### Current

`JsonRenderer` accepts objects directly. For strings, it trims the value and parses only candidates that start with `{` or `[`. Parsed object values render with default collapsed depth, expand/collapse controls when enabled, clipboard support, shortened long text, and a max-height scrolling container.

#### Target

Large tool payloads and debug data are inspectable without expanding every field by default or breaking the page layout.

#### Acceptance

- Object values render as an interactive JSON tree.
- JSON strings beginning with `{` or `[` render as JSON when parsing succeeds.
- Invalid JSON and scalar text render as escaped preformatted text.
- The JSON container respects the configured maximum height.
- Long strings in the JSON view are shortened in the default display.

#### Scenario: Tool returns invalid JSON-like text

- GIVEN a tool result is the string `{not valid json}`
- WHEN Chat Web renders the payload
- THEN the value appears as escaped preformatted text instead of throwing a render error.

### Requirement: Terminal function-call arguments are inline and collapsible

The compact terminal MUST render function-call arguments inline, with object and array children collapsible by path and long strings expandable on demand.

#### Current

`TerminalFunctionCall` renders `name(input)`. `TerminalInlineJson` keeps the root path expanded by default, lets users collapse or expand object and array paths, shortens strings longer than 140 characters, and uses buttons with path-specific labels.

#### Target

Tool calls remain scannable in the compact terminal while preserving access to nested arguments.

#### Acceptance

- Function names render before parenthesized argument content.
- Object and array argument values can be collapsed and expanded independently.
- Long strings show a shortened value until expanded.
- Primitive values render inline without creating expandable controls.
- Toggle clicks do not trigger parent row expansion accidentally.

#### Scenario: Long string argument

- GIVEN a tool call argument contains a string longer than 140 characters
- WHEN the compact terminal renders the function call
- THEN the string is shortened
- AND the user can expand it without opening the row details.

### Requirement: Terminal details normalize text wrappers and parse embedded JSON

The compact terminal MUST choose a readable representation for row detail inputs and outputs by normalizing common text wrappers and parsing embedded JSON when safe.

#### Current

`renderableTerminalValue` treats strings and common text wrapper objects such as `text`, `output_text`, `content`, and message content as text. `TerminalDetails` parses direct JSON detail text and JSON preceded by a status line, preserving the status as metadata when present.

#### Target

Users can inspect provider-shaped payloads and command outputs without seeing unnecessary wrapper noise, while still getting a structured view when the payload is JSON.

#### Acceptance

- Empty `undefined` and `null` details are omitted.
- Common model text wrappers render as text content.
- Direct JSON object or array text renders as structured JSON.
- A text prefix followed by JSON preserves the prefix as status metadata.
- Non-JSON text renders in a preformatted text block.

#### Scenario: Command output with status and JSON

- GIVEN a terminal detail output starts with `Exit code: 0` followed by a JSON object
- WHEN the row details are opened
- THEN Chat Web shows `Exit code: 0` as status metadata
- AND renders the JSON object in the structured JSON view.

## Edge Cases

- Empty markdown renders without creating unsafe fallback HTML.
- Malformed URLs, unsupported protocols, and malformed JSON values do not crash the row or message.
- Unsupported Prism languages degrade to plain escaped code.
- Browser rendering treats persisted transcript content, live deltas, tool output, and curated tool snippets with the same safety rules.
- Clipboard support in the JSON view is a convenience and must not be required for reading payloads.

## Constraints

- **Security / Privacy:** Markdown rendering must not enable raw HTML or script URLs. New renderers for model or tool content must reuse the same safety rules or document stronger ones.
- **Compatibility:** Existing markdown, JSON, and terminal row data shapes must remain readable.
- **Performance:** Large JSON objects should be collapsed and scroll-bounded by default to avoid blocking normal trace navigation.
- **Dependencies:** Markdown behavior depends on `react-markdown`, `remark-gfm`, and Prism grammars currently imported by the Chat Web UI.

## Success Criteria

- [ ] SC-001: A UI test verifies raw HTML and unsafe markdown URLs do not become executable or navigable unsafe links.
- [ ] SC-002: A UI test verifies supported markdown features, code blocks, and read-only task checkboxes still render.
- [ ] SC-003: A UI test verifies JSON objects, JSON strings, invalid JSON strings, and scalar text use the correct renderer fallback.
- [ ] SC-004: A compact-terminal test verifies inline function-call JSON can collapse nested values and expand long strings independently.
- [ ] SC-005: A terminal-detail test verifies text wrappers and status-prefixed JSON are normalized into readable detail panels.

## Verification Coverage

### Directly Tested

- No focused renderer-safety tests were found under `test/*.test.mjs` in the current workspace.

### Source-Inspected Only

- Markdown element allowlisting, raw-HTML skipping, safe URL transformation, link isolation, read-only task checkboxes, language aliasing, and best-effort Prism highlighting are source-inspected from `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`.
- Structured JSON parsing, invalid JSON fallback, expand/collapse controls, max-height scrolling, clipboard support, and long-string shortening are source-inspected from `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`.
- Inline function-call rendering, path-scoped object/array collapse, escaped path keys, long-string expansion, and click-propagation blocking are source-inspected from `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`.
- Detail payload normalization, text-wrapper extraction, status-prefixed JSON parsing, linked child-session buttons, and empty-detail omission are source-inspected from `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx` and `terminalValue.ts`.

### Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Markdown safety | Raw `<script>` and inline HTML are skipped; `javascript:` and `data:` links have no usable `href`; accepted links use `target="_blank"` and `rel="noreferrer"`. | REQ-001, REQ-002 | `test/chat-ui-rendering-safety.test.mjs` or component test |
| Markdown formatting compatibility | GFM table, task checkbox, strikethrough, heading, list, and code block still render; task checkbox is disabled/read-only. | REQ-001, REQ-003 | `test/chat-ui-rendering-safety.test.mjs` or component test |
| Code highlighting fallback | `sh`, `shell`, `js`, `ts`, `md`, and `yml` map to canonical languages; unknown language renders plain escaped code without throwing. | REQ-003 | `test/chat-ui-rendering-safety.test.mjs` or component test |
| JSON renderer fallback | Object input renders structured JSON; object/array strings parse; invalid JSON-like strings and scalar strings render escaped preformatted text; `maxHeight` is applied. | REQ-004 | `test/chat-ui-json-renderer.test.mjs` or component test |
| Inline function-call JSON | Root is expanded by default; nested paths collapse/expand independently; path keys with dots or backslashes remain distinct; long strings expand without toggling parent row state. | REQ-005 | `test/chat-ui-terminal-inline-json.test.mjs` or component test |
| Terminal details | `undefined` and `null` details are omitted; common text wrappers render text; direct JSON and status-prefixed JSON render structured JSON with status metadata; non-JSON text stays preformatted. | REQ-006 | `test/chat-ui-terminal-details.test.mjs` or component test |

### Verification Gaps

- Add browser-independent component tests before changing renderer dependencies or markdown allowlists.
- Add at least one regression test for unsafe URL removal because link behavior is security-sensitive and easy to weaken during markdown library upgrades.
- Add compact-terminal tests before reworking row expansion so inline JSON toggles cannot accidentally open or close the parent row.

## Assumptions and Open Questions

### Assumptions

- The current markdown and JSON renderer components are the shared rendering boundary for Chat Web model, tool, and context-panel content.
- The dormant nested trace view should follow the same safety contract as the active compact terminal view.

### Open Questions

- Should markdown links to same-origin Chat Web routes open in-app instead of always using a new tab?
- Should JSON rendering add explicit maximum node counts for extremely large objects beyond the current collapsed and max-height behavior?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Markdown allows only approved presentation elements | Raw HTML in assistant text | `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`; add renderer safety tests | Source-inspected |
| REQ-002 Markdown links are protocol-limited and isolated | Unsafe markdown link | `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`; add URL transform tests | Source-inspected |
| REQ-003 Code highlighting is best-effort and non-blocking | Unknown code language | `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`; add markdown code-block tests | Source-inspected |
| REQ-004 Structured payloads render as bounded JSON when possible | Tool returns invalid JSON-like text | `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`; add JSON renderer tests | Source-inspected |
| REQ-005 Terminal function-call arguments are inline and collapsible | Long string argument | `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`; add compact-terminal interaction tests | Source-inspected |
| REQ-006 Terminal details normalize text wrappers and parse embedded JSON | Command output with status and JSON | `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`, `terminalValue.ts`; add terminal-detail parsing tests | Source-inspected |

## Verification Basis

- `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`
- `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`
- `src/apps/chat-ui/src/context/PiboToolsView.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalValue.ts`
