---
type: "Historical Record"
title: "Chat Context Editor Lexical Bug Session Handoff"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/session-handoff-chat-context-editor-lexical.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "763ceb4d8a08d41869b8e8bcd2c1056cbc851324"
  source_bytes: 5681
  source_sha256: "a09c6d78b270796c9b686adf480ba413895dc1fd4dfe335f74f7a21235cc0d0f"
  source_body_sha256: "a09c6d78b270796c9b686adf480ba413895dc1fd4dfe335f74f7a21235cc0d0f"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Context Editor Lexical Bug Session Handoff

Date: 2026-05-02

## Goal

Fix the real root cause behind the Chat Web App context-tab editor crash so the Chat UI can use the rich `MDXEditor`/Lexical editor again instead of the current plain-markdown fallback.

## Current User-Visible State

- The Chat Web App context tab is stable again.
- In Chat Web only, context files currently open in a plain markdown textarea instead of the rich editor.
- Read-only plugin files and editable managed files both load without crashing.
- Autosave for editable managed files still works through the plain textarea path.

## Exact Reproduction That Was Verified

Browser path:

1. Open `/apps/chat`
2. Switch to `context`
3. Select a managed editable context file such as:
   - `ctx:test`
   - `ctx:example-workspace-policy`

Before the workaround, this immediately crashed the app with:

```text
Minified Lexical error #64; visit https://lexical.dev/docs/error?code=64&v=rE
```

The same browser session also showed:

- Opening the first `plugin-only` file was safe once we avoided mounting the rich editor for read-only files.
- The managed editable file still crashed when the rich editor mounted.

## What Was Ruled Out

- This is not caused by a newly installed dependency in the latest UI tweaks.
- The chat integration commit `175837f Integrate context files into chat UI` introduced the Chat UI context editor files, but did not add new packages.
- The relevant editor dependencies were originally added earlier in `2d7898d Add managed context files editor`:
  - `@mdxeditor/editor`
  - `lexical`
  - `prismjs`
- A duplicate-React symptom existed separately earlier (`useCallback` on `null` / invalid hook style behavior). `src/apps/chat-ui/vite.config.ts` already has `dedupe: ["react", "react-dom"]` for that and it is not the remaining blocker here.
- The custom inline-code arrow-exit Lexical plugin was tested as a suspect and removed temporarily from the Chat UI path; the crash still happened. That plugin was not the main cause.
- The crash reproduced even for an empty managed file (`ctx:test`, `markdown: ""`), so this is not specific malformed markdown content.

## Strongest Current Technical Hypothesis

The remaining bug is in the rich-editor mount/update path for editable documents in Chat Web, not in the context-tab shell itself.

More specifically:

- The crash only happened when mounting `MDXEditor` for editable managed files.
- The crash disappeared when Chat Web stopped mounting the rich editor and used plain textarea rendering instead.
- This strongly suggests an `MDXEditor`/Lexical initialization or document-reset interaction in the Chat Web wrapper, not a general API/data issue.

Potential next technical suspects:

1. Some remaining plugin combination in the Chat Web `MarkdownEditor` plugin list.
2. A Lexical/MDXEditor interaction specific to editable mode in this wrapper.
3. A subtle mount/reset behavior in the Chat Web wrapper that still differs from the standalone context-files UI enough to trigger Lexical selection/state validation.

## Current Workaround Implemented

Chat Web now forces the plain fallback editor path.

Relevant code:

- `src/apps/chat-ui/src/context/ContextFilesView.tsx`
  - passes `preferPlain` into `MarkdownEditor`
- `src/apps/chat-ui/src/context/MarkdownEditor.tsx`
  - supports `preferPlain?: boolean`
  - uses plain textarea when `preferPlain` is true
  - keeps read-only handling and autosave behavior
  - rich-editor plugin set was reduced during debugging
  - imperative `setMarkdown(...)` was removed from the Chat UI wrapper

This workaround is intentionally limited to Chat Web.

## Files Most Relevant For The Real Fix

- `src/apps/chat-ui/src/context/MarkdownEditor.tsx`
- `src/apps/chat-ui/src/context/ContextFilesView.tsx`
- `src/apps/context-files-ui/src/components/MarkdownEditor.tsx`
- `src/apps/context-files-ui/src/main.tsx`
- `src/apps/chat-ui/vite.config.ts`

## Suggested Next Session Plan

1. Remove the `preferPlain` workaround only in a local test branch and reproduce the crash again in browser-use.
2. Compare Chat UI `MarkdownEditor` against the standalone context-files UI editor wrapper line by line and reduce differences.
3. Reintroduce the rich editor with the absolute minimum plugin set, then add plugins back one by one:
   - headings
   - lists
   - quote
   - thematic breaks
   - links
   - tables
   - code block / codemirror
   - markdown shortcuts
   - toolbar
4. If it still crashes with a minimal editable mount, switch Lexical/MDXEditor to a dev-friendly build or add temporary local instrumentation around `onError` and editor init to capture the exact failing state.
5. Only after the real root cause is known, remove `preferPlain` from Chat Web.

## Browser Verification Already Done

Verified against the running gateway with `browser-use`:

- `/apps/chat` -> `context` opens
- `plugin-only` file loads
- `ctx:test` loads
- `ctx:example-workspace-policy` loads
- no crash while Chat Web uses plain fallback

## Commands Used In This Session

```bash
npm run chat-ui:typecheck
npm run chat-ui:build
npm run context-files-ui:typecheck
```

Browser repro used the existing authenticated `browser-use` session `pibo-auth`.

## Important Note For The Next Session

Do not start from “Lexical is broken in general.” The evidence is narrower:

- read-only path can be made stable
- data/API payloads are fine
- managed editable files trigger the crash only when the rich editor mounts
- plain textarea path is stable

So the next session should focus on restoring the rich editor incrementally in Chat Web, not re-debugging the whole context-file feature from scratch.
