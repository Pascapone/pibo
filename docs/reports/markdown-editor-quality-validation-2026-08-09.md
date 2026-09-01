---
type: "Evidence Report"
title: "Markdown Editor Quality Validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/markdown-editor-quality-validation-2026-08-09.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "85bf1c13dab1bd385f91e80fd3423621d935dc93"
  source_bytes: 8749
  source_sha256: "39f3aa5e62919df6c059f261f082905fd4e98f546172af8ac5bb7b6e4eb11cc5"
  source_body_sha256: "39f3aa5e62919df6c059f261f082905fd4e98f546172af8ac5bb7b6e4eb11cc5"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:markdown-editor-quality-validation-2026-08-09"
  published_at: "2026-09-01T07:57:34Z"
---
# Markdown Editor Quality Validation

**Date:** 2026-08-09
**Branch:** `feature/markdown-editor-quality`
**Validated base:** `upstream/dev` at `1d3bdb9f7002dea437b7a7ee61abb4e88ef6d0de` (work began at `6be71b6b5fc5b58a63632180356b5b7902250b2d`)
**Status:** Implementation and focused validation complete; not pushed, merged, released, or deployed to Production.

## Outcome

The Markdown editor now uses one shared implementation across Chat Context Files, the standalone Context Files app, and Workflow prompt assets. The editor provides a spacious rich-text Markdown surface, a source mode, a raw safety fallback, complete standard Markdown controls, responsive host layouts, and a full-viewport focused mode.

The focused acceptance scenarios passed in an authenticated, non-headless Chrome 148 browser against a local-auth gateway running the exact worktree build.

## Main changes

- Replaced the divergent Chat and standalone editor implementations with `src/apps/shared/MarkdownEditor.tsx` and shared styling in `src/apps/shared/markdown-editor.css`.
- Added rich/source switching, frontmatter, strikethrough, images, tables, task lists, nested lists, links, blockquotes, thematic breaks, inline code, fenced code blocks, and code-language selection.
- Added a Focus action that expands the editor to the viewport, locks background scrolling, focuses the editor, and exits with the button, backdrop, or `Escape`.
- Added a responsive Context Files panel. At viewports up to 1180 px it becomes an overlay and defaults closed, increasing the 1000 px viewport editor width from about 391 px to 668 px.
- Made narrow toolbars wrap without horizontal clipping while wide toolbars stay on one row.
- Added explicit internal rich-text and source scroll containers so the document scrolls while the utility and formatting toolbars remain visible.
- Styled inline code, images, tables, CodeMirror blocks, nested editor toolbars, dialogs, active states, focus outlines, and read-only/raw fallback surfaces for the Pibo dark design system.
- Preserved source mode, cursor context, and undo history across own autosaves by using stable document identity and ignoring only the exact in-flight save echo.
- Tracked the in-flight Markdown snapshot separately from newer typing so edits made during a slow save are serialized into a follow-up save instead of being overwritten.
- Prevented scheduled autosave failures from becoming unhandled promise rejections while preserving errors for explicit `flushSave()` calls.
- Made Workflow prompt-asset selection flush pending Markdown before switching assets.
- Fixed the standalone host so revision history can no longer compress the editor to zero height.

## Markdown coverage

The headful fixture contained and rendered:

- YAML frontmatter;
- H1, H2, and H3 headings;
- paragraphs;
- bold, italic, underline-through-HTML compatibility, strikethrough, and inline code;
- links and an image preview;
- blockquotes with nested formatting;
- ordered, unordered, nested, and task lists;
- a GFM table;
- a thematic break;
- a TypeScript fenced code block with language selection.

The accessibility snapshot exposed toolbar controls for all supported insert/format actions, including `Rich text` and `Source mode`.

## Headful browser evidence

Browser runtime:

- Google Chrome 148, non-headless on Xvfb;
- Agent Browser 0.27.0 in headed mode;
- authenticated local gateway at `127.0.0.1:4918` using the fixed local identity;
- no page errors or console errors in the final Context, standalone, Workflow prompt, rich-focus, or source-focus checks.

Key screenshots under `docs/reports/artifacts/markdown-editor-quality-2026-08-09/`:

| Scenario | Evidence |
| --- | --- |
| Production baseline, cramped 1000×800 Context editor | `baseline-context-managed-1000x800.png` |
| Final responsive 1000×800 Context editor | `final-context-managed-1000x800-v2.png` |
| Final 1440×1000 Context editor | `final-context-managed-1440x1000.png` |
| Final scrolled rich editor with toolbar retained | `final-focused-editor-scrolled-toolbar-1440x1000.png` |
| Final scrolled source mode with toolbar retained | `final-focused-source-mode-scrolled-1440x1000.png` |
| Final standalone Context editor | `iteration-5-standalone-context-1000x800.png` |
| Workflow prompt editor inside the narrow inspector | `iteration-5-workflow-prompt-editor-visible-1000x800.png` |
| Workflow prompt editor in Focus mode | `iteration-5-workflow-prompt-focused-1000x800.png` |

Measured final layout:

| Scenario | Editor / scroll measurement |
| --- | --- |
| Chat Context at 1000×800 | 668×540 px; file panel hidden by default; toolbar wraps with no horizontal overflow |
| Chat Context at 1440×1000 | 808×740 px; file panel visible; one-row 808 px toolbar |
| Focus mode at 1440×1000 | 1392×952 px within 24 px viewport insets |
| Standalone Context at 1000×800 | 599×574 px; previous measured height was 0 px |
| Workflow prompt inspector | 393 px default width with wrapped controls and Focus action |
| Focused rich scroll | client height 864 px, scroll height 2098 px, toolbar remained at y=64 px |
| Focused source scroll | client height 864 px, scroll height 1173 px, toolbar remained at y=64 px |

## Save and switching validation

- Loading the fixture did not create a revision or change its hash.
- A first Source-mode edit autosaved after the 900 ms delay and was verified through `/api/context-files/:key`.
- After the stable-identity fix, Source mode remained selected and the textbox retained focus after autosave.
- `Ctrl+Z` remained available after autosave and triggered the corresponding follow-up persistence.
- External restoration reloaded the server document after local work was clean.
- Narrow Context file selection closed the overlay panel automatically.
- Context file switches and Workflow prompt-asset switches call `flushSave()` before changing the selected document.
- MDXEditor normalizes Markdown syntax when a rich/source document is edited: unordered markers may become `*`, thematic breaks may become `***`, and tables are aligned. The validated fixture retained equivalent Markdown structure and content.

## Automated validation

Passed:

```text
npm run chat-ui:typecheck
npm run context-files-ui:typecheck
npm run chat-ui:build
npm run context-files-ui:build
npm run build
node --test test/markdown-editor-quality.test.mjs
node --test test/workflow-v2-builder-editing-raw-ir.test.mjs
node --test test/context-files-web.test.mjs
```

The focused regression tests verify shared implementation use, standard Markdown plugin/control coverage, stable autosave identity, in-flight save echo handling, responsive panel behavior, Focus mode, internal scrolling, prompt-asset flush-before-switch, and raw fallback.

A broad `test/web-channel.test.mjs` run had five unrelated failures in workflow snapshot/human-action/lifecycle projections and an MCP-description assertion affected by the operator's configured `chrome-devtools` server. The Markdown prompt-asset revision scenario passed, and no failure referenced the Markdown editor changes.

## Requirement audit

| Requirement | Evidence | Result |
| --- | --- | --- |
| Standard Markdown elements are supported | Fixture, accessibility snapshot, source mode, focused test | Pass |
| Editor remains appropriately large in every current host | Context 1000/1440, standalone, Workflow inspector, Focus screenshots | Pass |
| Narrow tabs/panels have an escape to a high-quality workspace | Full-viewport Focus mode with keyboard/backdrop exit | Pass |
| Toolbars remain visible and controls remain discoverable | Wrapped narrow toolbar; fixed rich/source toolbar during scroll | Pass |
| Autosave does not lose first edits or edits made during a save | Browser first-edit save plus in-flight snapshot regression guard | Pass |
| Own autosaves do not remount or reset Source mode | Browser autosave retained Source mode and focus | Pass |
| File/asset switching flushes pending edits | Context and Workflow host code plus regression assertions | Pass |
| Read-only and parser-error paths remain usable | Raw read-only/fallback editor retained and styled | Pass |
| Browser console and page errors are clean | Final headful scenarios | Pass |
| Production remains unchanged without approval | No activation, merge, release, or Production deployment | Pass |

## Remaining boundary

This work intentionally does not add Notion-style databases, templates, collaboration, slash-command blocks, comments, or non-Markdown document models. Markdown remains the persisted source of truth. The comparison to Notion applies to the focused writing/editing quality, visual hierarchy, keyboard behavior, layout, and reliability of the existing Markdown-file scope.
