# Spec: Chat Web Markdown Context Editor

**Status:** Implementing
**Created:** 2026-05-11
**Updated:** 2026-08-09
**Controller / Source:** Scheduled Pibo Source Specs Coverage plus the 2026-08-09 Markdown editor quality goal
**Related docs:** [Chat Web Context Area](./chat-web-context-area.md), [Context Files](./context-files.md), [Chat Web Safe Content Rendering](./chat-web-safe-content-rendering.md), [Markdown Editor Quality Validation](../../reports/markdown-editor-quality-validation-2026-08-09.md)

## Why

Chat Web lets users edit managed context files that are later injected into Pibo runtimes. The editor therefore needs a behavior contract for saving, read-only fallback, document switching, and rich-editor failure handling. Without this contract, a UI refactor could lose edits during navigation, save plugin-provided files, or leave users stuck when the rich Markdown editor cannot parse a document.

## Goal

Chat Web MUST provide a high-quality Markdown editor that preserves user edits, supports standard Markdown structures, remains usable in narrow host panels, autosaves the current managed-file content without creating revision-history entries, flushes pending saves before document switches, and degrades to raw Markdown when rich editing is unavailable or unsafe.

## Background / Current State

`ContextFilesView` renders the shared `MarkdownEditor` used by Chat Context Files, the standalone Context Files app, and Workflow prompt assets. The editor uses MDXEditor for rich Markdown editing, CodeMirror for code blocks and source mode, a shared Prism client singleton, and a raw-text fallback. Managed editable documents are autosaved through `saveContextFile` with the current document version as `expectedVersion`; these saves update only the current working content. Named revision snapshots are created separately through the explicit Revision History action. Plugin context files and other non-editable documents are rendered read-only and instruct the user to create a managed copy before editing.

The parent view calls `flushSave()` before selecting a different file or following a selected-file link from another area. Live context-file events can reload clean documents or show a conflict warning when external changes arrive while the local editor is idle with unsaved edits or saving.

## Scope

### In Scope

- Rich Markdown editing for context files in the Chat Web Context area.
- Autosave state transitions for editable managed context files.
- Imperative flush behavior before document changes.
- Raw Markdown fallback for read-only documents and rich-editor load errors.
- Code-block language support and Prism singleton initialization.
- Standard Markdown formatting and insertion controls, including headings, lists, task lists, blockquotes, links, images, tables, thematic breaks, inline code, fenced code blocks, strikethrough, and frontmatter.
- Rich/source switching and full-viewport focused editing.
- Responsive Context Files panel behavior and narrow-host toolbar wrapping.
- Conflict and save-error behavior visible in the Context Files view.

### Out of Scope

- Context-file storage schema, revisions, source linking, and plugin adoption — covered by Context Files.
- General Chat Web navigation and Context panel composition — covered by Chat Web Context Area.
- Rendering chat transcript Markdown or terminal output — covered by trace and safe-content specs.
- Databases, templates, comments, collaboration, slash-command block menus, or a non-Markdown persisted document model.

## Requirements

### Requirement: Editable managed files autosave only changed current Markdown

The editor MUST persist editable managed context-file content after local changes, MUST avoid writes when the current Markdown equals the last saved Markdown, and MUST keep autosave separate from manual revision creation.

#### Current

`MarkdownEditor` tracks `currentMarkdownRef` and `savedMarkdownRef`. User changes set save state to `idle` and schedule `persistIfNeeded()` after 900 ms. If the text has not changed, the save state returns to `saved` without calling `onPersist`.

#### Target

Users can edit a managed context file without pressing a manual save button, and autosave never creates revision-history entries. Users create named versions only through the separate manual action owned by the Context Files host.

#### Acceptance

- The first editor change caused by initial hydration marks the file as `saved` and does not persist.
- A user edit marks the save state `idle` and schedules autosave.
- Autosave changes state to `saving`, calls the parent persist function once for the changed Markdown, and returns to `saved` when the persisted text matches the current text.
- If no content changed since the last save, autosave reports `saved` without calling the persist API.
- Successful context-file autosaves update current working content without increasing the manual revision count.

#### Scenario: Autosave after editing

- GIVEN an editable managed context file contains `A`
- WHEN the user changes the Markdown to `B`
- THEN the UI shows an unsaved or saving state before persistence
- AND the parent save API receives `B`
- AND the save pill returns to `saved` after the save completes.

### Requirement: Saves are serialized and catch edits made during saving

The editor MUST serialize save promises and MUST persist a newer edit that happens while an older save is in flight.

#### Current

`persistIfNeeded()` awaits any active `savePromiseRef`. After a save completes, it compares `currentMarkdownRef` with `savedMarkdownRef`; if they differ, it recursively persists again.

#### Target

Fast typing or slow network responses do not drop the latest Markdown.

#### Acceptance

- Two rapid edits while the first save is in progress never run overlapping persist calls.
- If the current Markdown changes during a save, the editor starts a follow-up save after the first save finishes.
- The final `saved` state is shown only when the latest current Markdown equals the latest saved Markdown.

#### Scenario: Edit during save

- GIVEN autosave for Markdown `B` is in progress
- WHEN the user changes the document to `C`
- THEN the editor waits for the `B` save to settle
- AND persists `C` before reporting `saved`.

### Requirement: Document switches flush pending edits first

The Context Files view MUST flush the active editor before changing the selected context file.

#### Current

`ContextFilesView.handleSelect()` and the selected-file-key effect call `editorRef.current?.flushSave()` before loading or selecting the next document. `flushSave()` clears the autosave timer and calls `persistIfNeeded()`.

#### Target

Selecting another context file or opening a context-file editor from another area does not silently discard local edits.

#### Acceptance

- Switching files clears the pending autosave timer and attempts to persist the current Markdown before loading the next file.
- If the flush fails, the selection does not proceed silently; the view reports the error.
- Opening a selected file from another area uses the same flush-before-switch behavior.

#### Scenario: Switch with unsaved edits

- GIVEN file `one` has unsaved local Markdown
- WHEN the user selects file `two`
- THEN Chat Web flushes the editor for `one` before loading `two`
- AND any flush error is visible to the user.

### Requirement: Read-only documents cannot be edited or saved

The editor MUST render non-editable context files as read-only raw Markdown and MUST NOT persist changes for them.

#### Current

`ContextFilesView` passes `readOnly={!document.editable}`. `MarkdownEditor` uses the plain fallback path for read-only mode, renders a read-only textarea, and `persistIfNeeded()` returns `saved` without calling `onPersist`.

#### Target

Plugin context files and other immutable documents are inspectable without becoming mutable through the rich editor.

#### Acceptance

- A non-editable document renders the read-only notice: create a managed copy to edit it.
- The raw textarea is read-only.
- Autosave scheduling is disabled for read-only mode.
- `flushSave()` on a read-only document does not call the persist API and reports `saved`.

#### Scenario: Plugin context file

- GIVEN the selected context file comes from a plugin and is not editable
- WHEN the editor renders
- THEN the user sees raw Markdown in a read-only textarea
- AND no save request is made for that document.

### Requirement: Rich-editor failures fall back to raw Markdown

The editor MUST recover from rich-editor load or parse errors by switching to a raw Markdown editor without losing the current text.

#### Current

`MDXEditor.onError` logs the error, copies `currentMarkdownRef.current` into `plainMarkdown`, and switches `editorMode` to `plain`. The plain fallback notice says the rich editor could not safely load the document.

#### Target

A malformed or unsupported Markdown construct does not block the user from viewing and editing the file.

#### Acceptance

- When the rich editor reports an error, the UI switches to raw Markdown mode.
- The raw textarea contains the latest Markdown tracked before the error.
- Editable documents can still autosave from the raw textarea.
- Read-only documents remain read-only in fallback mode.

#### Scenario: Rich editor cannot load document

- GIVEN an editable context file contains Markdown that causes the rich editor to error
- WHEN `onError` fires
- THEN Chat Web shows the raw Markdown fallback
- AND subsequent text changes still use the same autosave behavior.

### Requirement: Document identity resets editor state safely

The editor MUST reset saved/current Markdown, autosave timers, plain fallback content, and rich-editor mode when the selected document identity or externally loaded content changes.

#### Current

The editor receives a stable `documentKey` for the logical file or Workflow node. Own save responses are matched against `savingMarkdownRef` and do not remount the editor. A real document change or external content change clears pending state, resets tracked Markdown, returns to rich mode, and remounts only the MDXEditor instance when needed.

#### Target

Loading a new document never reuses stale autosave state from the previous file.

#### Acceptance

- A changed logical `documentKey` resets editor state to the new `initialMarkdown`.
- External content changes for the same document reset editor state when the loaded content differs from the saved reference.
- An own save echo matching the in-flight Markdown snapshot does not reset Source mode, cursor context, scroll state, or undo history.
- Initial Markdown normalization is distinguished from the first real user edit.
- Switching to a new document returns to rich mode unless the new document is read-only or the rich editor errors again.

#### Scenario: Reload latest version

- GIVEN the current context file is reloaded with externally changed content
- WHEN the editor receives the new `initialMarkdown` for the same logical key
- THEN the editor resets to the reloaded Markdown
- AND the save state is `saved`.

### Requirement: Code editing uses a shared Prism client

The Markdown editor MUST initialize a shared Prism instance for client-side code highlighting and MUST expose the same instance on `globalThis.Prism` and `window.Prism` when a browser window exists.

#### Current

Both Chat Web and the legacy context-files UI import a `prism-client` module. It reuses an existing global Prism instance when it has a `languages` field; otherwise it imports Prism, assigns it to `globalThis.Prism`, and assigns `window.Prism` in the browser. `MarkdownEditor` registers CodeMirror code-block support for text, Markdown, TypeScript, TSX, JavaScript, JSON, CSS, Bash, Shell, YAML, TOML, and Cron labels.

#### Target

Code-block editing remains stable across SSR-like test contexts, browser contexts, and repeated imports.

#### Acceptance

- Importing the Prism client multiple times returns the same global Prism-compatible object.
- In a browser, `window.Prism` is defined after the client module loads.
- Code block language choices include the current supported labels and default to plain text when no language is supplied.

#### Scenario: Browser loads editor twice

- GIVEN the Chat Web bundle imports the Prism client from more than one editor path
- WHEN both imports run in the browser
- THEN they share one Prism object on `window.Prism`
- AND code-block editing still offers the supported language list.

### Requirement: Standard Markdown structures are editable

The editor MUST parse, display, edit, and serialize headings, paragraphs, bold, italic, strikethrough, inline code, fenced code blocks, links, images, blockquotes, thematic breaks, ordered lists, unordered lists, nested lists, task lists, tables, and frontmatter.

#### Acceptance

- Every listed structure is represented in the rich editor and Source mode.
- The toolbar exposes the corresponding format or insertion control when one is required.
- Code blocks expose a language selector.
- Unsupported or unsafe input still has a raw Markdown fallback.

#### Scenario: Comprehensive Markdown file

- GIVEN a managed file contains the supported structures
- WHEN the file opens in the rich editor
- THEN every structure remains visible and editable
- AND Source mode exposes the complete Markdown document.

### Requirement: Narrow hosts provide a usable editing workspace

The editor MUST remain usable in Context Files, the standalone app, and Workflow prompt inspectors without clipping commands or reducing the writing area to an impractical size.

#### Acceptance

- Narrow toolbars wrap instead of horizontally hiding actions.
- The integrated Context file panel defaults closed at viewports up to 1180 px and can be reopened as an overlay.
- Every editor host exposes Focus mode.
- Focus mode fills the viewport with bounded insets, locks background scrolling, keeps the utility and formatting toolbars visible, and exits with `Escape`.
- Rich and Source content scroll internally without moving the toolbars.

#### Scenario: Workflow inspector is narrow

- GIVEN a prompt asset editor is rendered in the Workflow inspector
- WHEN the user selects Focus
- THEN the same editor expands to the viewport
- AND all Markdown controls and document content remain usable.

## Edge Cases

- Autosave failures set save state to `error` and surface the parent error through the Context Files view.
- Save conflicts from the context-file API reload the latest server document and show a conflict warning instead of pretending the local save succeeded.
- External context-file events reload the selected document only when there are no local unsaved or in-flight edits.
- The editor clears its autosave timer on unmount.
- Plain fallback mode is also used for read-only documents, even if the rich editor could render them.

## Constraints

- **Compatibility:** The editor must preserve Markdown as Markdown; it must not invent a separate document model as the persisted source of truth.
- **Security / Privacy:** Read-only context files must not be mutated through editor callbacks. Rich-editor errors may be logged, but context-file content should not be exposed outside the browser session or save API.
- **Performance:** Autosave delay is short and bounded; repeated unchanged content must not create save traffic or revision-history entries.
- **Dependencies:** Rich editing depends on `@mdxeditor/editor`, CodeMirror, and Prism availability in the browser bundle.

## Success Criteria

- [ ] SC-001: Editable managed files autosave changed Markdown, avoid redundant saves for unchanged content, and do not create revision-history entries.
- [x] SC-002: In-flight saves are serialized and a later edit is persisted before the editor reports `saved`.
- [x] SC-003: File and prompt-asset selection call `flushSave()` before loading the next document.
- [x] SC-004: Non-editable context files render read-only raw Markdown and never call the persist API.
- [x] SC-005: Rich-editor errors switch to raw Markdown fallback while preserving current content and autosave behavior.
- [x] SC-006: Logical document changes reset editor state while own save echoes preserve mode and cursor state.
- [x] SC-007: Prism client imports share one global Prism instance and expose it on `window.Prism` in browser contexts.
- [x] SC-008: Standard Markdown structures are editable in rich and source modes.
- [x] SC-009: Context, standalone, and Workflow hosts provide a practical default area plus Focus mode.
- [x] SC-010: Rich and Source content scroll internally while editor toolbars remain visible.

## Assumptions and Open Questions

### Assumptions

- Context-file Markdown remains the canonical stored representation.
- The 900 ms autosave delay is intentional current behavior, not a public timing guarantee beyond being bounded and automatic.
- Raw Markdown fallback is acceptable for all read-only documents and for rich-editor failures.

### Open Questions

- Should future versions expose Markdown serializer style preferences for bullet markers, thematic breaks, and table alignment?
- Should autosave conflicts preserve a local draft for manual merge instead of reloading the server document immediately?
- Should the shared Prism client live in a common package to avoid duplicated source between Chat Web and the legacy context-files UI?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 | Autosave after editing | `src/apps/shared/MarkdownEditor.tsx`, `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `test/context-files-web.test.mjs` | Implementing |
| REQ-002 | Edit during save | `src/apps/shared/MarkdownEditor.tsx`, `test/markdown-editor-quality.test.mjs` | Regression-covered |
| REQ-003 | Switch with unsaved edits | `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/chat-ui/src/workflows/WorkflowPromptAssetEditor.tsx` | Regression-covered |
| REQ-004 | Plugin context file | `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/shared/MarkdownEditor.tsx` | Browser-validated |
| REQ-005 | Rich editor cannot load document | `src/apps/shared/MarkdownEditor.tsx` | Regression-covered |
| REQ-006 | Reload latest version | `src/apps/shared/MarkdownEditor.tsx` | Browser-validated |
| REQ-007 | Browser loads editor twice | `src/apps/chat-ui/src/context/prism-client.ts`, `src/apps/context-files-ui/src/prism-client.ts` | Source-inspected |
| REQ-008 | Comprehensive Markdown file | `src/apps/shared/MarkdownEditor.tsx`, `src/apps/shared/markdown-editor.css` | Browser-validated |
| REQ-009 | Workflow inspector is narrow | `src/apps/shared/MarkdownEditor.tsx`, `src/apps/chat-ui/src/workflows/WorkflowPromptAssetEditor.tsx` | Browser-validated |

## Verification Basis

This spec is based on the shared editor in `src/apps/shared/MarkdownEditor.tsx`, shared styling in `src/apps/shared/markdown-editor.css`, the Chat and standalone Context hosts, the Workflow prompt-asset host, focused regression tests, and the headful browser evidence recorded in `docs/reports/markdown-editor-quality-validation-2026-08-09.md`.
