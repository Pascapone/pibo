# Markdown Editor Smart Typing Validation

**Date:** 2026-08-10

**PR:** #438

**Branch:** `feature/markdown-editor-smart-typing`

**Observed base:** `upstream/dev` at `b7dcc3a1fe618c8655f972c20c1e1ec014621c88`

**PR head before this iteration:** `5139d491043274c80f01b6bd0443f72ca34d300f`

## Safety and environments

- The topic worktree is isolated at `/root/code/pibo/.worktrees/markdown-editor-smart-typing`.
- At the start of this iteration the PR branch was exactly two commits ahead of current `upstream/dev` and zero commits behind it.
- Production Pibo2 was inspected read-only. It reported zero runtime sessions, zero active yielded runs, and restart safety `idle`.
- Production remained on candidate `release-1-11-3` at commit `32980a084968880f7c93bcf1a375df94e48d340f`.
- Production was not restarted, redeployed, or otherwise changed.
- Build and browser validation ran in the isolated Docker dev worker `pibo-dev-pr438-dev-web` with loopback-only Web access at `http://127.0.0.1:4802` and local authenticated identity `dev@pibo.local`.

## Problems covered by PR #438

The PR restores and validates the requested baseline behavior:

- visible unordered, ordered, and nested list markers;
- 20×20 px, full-opacity toolbar SVGs instead of the previous 17×17 px rendering;
- Notion-style line-start Markdown shortcuts supplied by the enabled `markdownShortcutPlugin()`;
- explicit empty-editor guidance for `# + Space` and `- + Space`;
- task-list label spacing;
- responsive placement of Rich/Source controls.

Current browser evidence confirmed:

- `#` followed by Space creates an H1;
- `-` followed by Space creates an unordered list;
- nested unordered lists render `disc` then `circle` markers;
- ordered lists render decimal markers;
- marker color is the editor cyan accent;
- toolbar icons render at 20×20 px with full opacity.

## Additional reproduced problems

### 1. Pending edits were lost when immediately creating another Context File

In the Chat Context Files editor, a user could type inside the 900 ms autosave window and immediately press **Create File**. `handleSubmit` switched documents without first flushing the current editor.

Reproduction on the original PR head:

1. Open managed file `PR438 Baseline A`.
2. Pre-fill the new-file name.
3. Type ` UNSAVED-CREATE-LOSS` into the current editor.
4. Click **Create File** in the same 584 ms browser batch.
5. Read the previous file through the authenticated Context Files API.

Observed: the new file opened, but `UNSAVED-CREATE-LOSS` was absent from the previous file.

Fix: both Context Files hosts now call `await editorRef.current?.flushSave()` before creating and selecting the new document:

- `src/apps/chat-ui/src/context/ContextFilesView.tsx`;
- `src/apps/context-files-ui/src/main.tsx`.

Post-fix verification repeated the same flow in 698 ms. The previous file persisted `FIX-PRESERVED-BEFORE-CREATE` before the new file opened.

### 2. The toolbar still overflowed at a reproducible intermediate width

A real headful Browser Use session at an 800×457 viewport produced a 768 px editor shell. The original 46 rem container breakpoint did not activate:

```text
clientWidth=768
scrollWidth=804
clientHeight=47
scrollHeight=47
flexWrap=nowrap
overflowX=auto
```

The visible result was a horizontal scrollbar below the toolbar.

Fix: increase the container-query breakpoint from 46 rem to 48 rem.

Post-fix headful measurement at the same viewport:

```text
clientWidth=768
scrollWidth=768
clientHeight=82
scrollHeight=82
flexWrap=wrap
overflowX=hidden
overflowY=auto
```

All toolbar controls remain available without horizontal overflow.

## Automated regression coverage

`test/markdown-editor-quality.test.mjs` now additionally verifies:

- both Context Files hosts flush pending Markdown edits before `createContextFile`;
- the toolbar wraps at the corrected 48 rem container breakpoint;
- smart-typing guidance, list markers, nested marker styles, task spacing, and 20 px SVG rendering remain present.

A clean worker exposed that the former report order was not reproducible: `test/context-files-web.test.mjs` imports built `dist/` modules. The repeatable order is therefore build before that test suite.

Passed in the Docker dev worker:

```text
npm run typecheck
npm run build
node --test test/markdown-editor-quality.test.mjs test/workflow-v2-builder-editing-raw-ir.test.mjs test/context-files-web.test.mjs
```

Result: 13 tests passed, 0 failed.

## Agent Browser validation

Agent Browser was used for fast DOM inspection and real keyboard-event editing at 1000×800.

Validated:

- `#` + Space → H1;
- `-` + Space → unordered list;
- Tab → nested list and Shift+Tab → outdent;
- `1.` + Space → ordered list;
- `>` + Space → blockquote;
- autosave reached `Saved`;
- the authenticated API persisted exactly:

```md
# Final Heading

* First bullet
  * Nested bullet

1. First ordered

> Quoted text
```

- switching to another file and reopening restored H1, nested unordered list, ordered list, and blockquote;
- computed list styles after reopening were `disc`, `circle`, and `decimal`;
- Source mode displayed the persisted Markdown structure;
- the pre-fix quick-create loss and post-fix preservation flow were both reproduced with measured sub-900-ms action batches;
- Agent Browser page errors and console output were empty during the checked flow.

## Headful Browser Use validation

A non-headless Google Chrome process was started on the local desktop and controlled with Browser Use through CDP. The Chrome command line had no headless flag.

Validated in the Chat Context editor at 800×457:

- the pre-fix horizontal toolbar overflow;
- the post-fix wrapped toolbar with equal `clientWidth` and `scrollWidth`;
- visible bullets and readable toolbar icons;
- no missing toolbar action after wrapping.

Validated in the standalone Context Files app:

- reopened the same managed document saved in Chat;
- typed `-` then Space with real key events to create `Headful standalone bullet`;
- observed a semantic `<ul>` with computed `list-style-type: disc`;
- observed save state `Saved` and matching authenticated API Markdown;
- opened another file and then reopened the edited file with a visible mouse click;
- confirmed the new bullet survived reopening.

Validated Focus mode in the headful browser:

```text
expanded=true
editor rect=768×425 at (16,16)
body overflow=hidden
active element=editable markdown
toolbar clientWidth=768
 toolbar scrollWidth=768
flexWrap=wrap
```

Pressing Escape returned `expanded=false` and restored body overflow. A direct CDP attachment to the headful Browser Use Chrome reported no page errors and no console output.

## Browser artifacts

Local screenshots are under `docs/reports/artifacts/markdown-editor-smart-typing-2026-08-10/`. The repository-wide `*.png` ignore rule intentionally keeps them out of the PR; the durable measurements and observed results are recorded above:

- `current-pr-shortcuts-and-toolbar-1000x800.png`;
- `headful-current-pr-800x457.png`;
- `headful-responsive-fixed-800x457.png`;
- `agent-final-rich-reopened-1000x800.png`;
- `agent-final-source-reopened-1000x800.png`;
- `headful-standalone-reopened-800x457.png`;
- `headful-focus-mode-800x457.png`.

## Result

The requested H1 and bullet smart typing works through real keyboard events. Bullet, nested-list, ordered-list, and task-list visual rules remain covered. Toolbar icons render at the intended 20 px size. Two additional reproducible defects were fixed: pending edits are no longer dropped by immediate Context File creation, and the toolbar no longer horizontally overflows at a 768 px editor width. Both Chat and standalone Context Files flows persisted and reopened Markdown successfully in authenticated browsers. Production remains unchanged pending explicit user approval.
