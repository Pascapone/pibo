# PRD 11: JSON, Markdown, and Syntax Rendering Parity

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

Web Terminal has rich semantic rendering for inline JSON, detail JSON, markdown, code, and bash tokens. Ink currently renders much of this as plain or flattened text. This makes tool calls and details harder to scan and increases divergence from Web.

### Proposed Solution

Add terminal-native renderers for JSON, markdown, and code/shell syntax. The renderers must preserve Web semantic roles—keys, strings, literals, punctuation, headings, lists, quotes, code, bash commands—using Ink text tokens and ANSI/no-color fallbacks.

### Success Criteria

- SC-11-01: Inline function-call JSON shows function name, parens, keys, literals, punctuation, strings, and collapsed collection markers.
- SC-11-02: Detail JSON renders as a compact well-like block with default bounded depth and full-value access through details.
- SC-11-03: Markdown preserves structural semantics instead of flattening everything to anonymous prose.
- SC-11-04: Bash/code syntax uses Web-derived token roles where feasible.

## 2. JSON Requirements

### Inline JSON

- Function-call format: `name(<inline-json>)`.
- Function name: yellow/semibold equivalent.
- Root collection expanded by default when feasible.
- Nested collection markers: `▾{`, `▸{...}`, `▾[`, `▸[...]`.
- Keys/default, strings/orange equivalent, numbers/booleans/null blue equivalent, punctuation dim.
- Long inline strings may shorten only with explicit disclosure marker.

### Detail JSON

- Parse raw objects/arrays and JSON-looking text.
- If text has status/meta before JSON, show meta separately.
- Default expansion depth is bounded.
- Must not dump unbounded nested structures into collapsed transcript.
- Redact secrets before tokenizing.
- `NO_COLOR=1` output remains readable through quotes, braces, labels, and markers.

## 3. Markdown Requirements

- Headings become emphasized compact terminal lines.
- Paragraph spacing stays compact.
- Lists preserve bullets/numbering and nested indentation where feasible.
- Blockquotes keep a `>` or equivalent terminal marker.
- Inline code is distinguishable.
- Fenced code preserves indentation and language when known.
- Tables remain readable as text without breaking layout.
- Reasoning stays amber/marked separately.

## 4. Syntax Requirements

- Bash command tokenization follows `TERMINAL_DESIGN.md`: command green/semibold, flags magenta, env/variables yellow, quoted strings green, paths cyan, pipes/redirects red/semibold.
- JSON code fences use JSON token roles.
- Unknown languages fall back to safe monospaced text.

## 5. Validation

- Shared fixtures feed Web and Ink tests.
- Ink snapshots cover color and `NO_COLOR=1`.
- Web tests assert existing semantic hooks still reflect the same fixture.
- PTY artifact includes JSON function call, JSON detail, markdown answer, and bash/code rendering.

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

