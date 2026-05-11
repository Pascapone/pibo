# Spec: Chat Web Markdown Context Editor

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Chat Web Context Area](./chat-web-context-area.md), [Context Files](./context-files.md), [Chat Web Safe Content Rendering](./chat-web-safe-content-rendering.md)

## Why

Chat Web lets users edit managed context files that are later injected into Pibo runtimes. The editor therefore needs a behavior contract for saving, read-only fallback, document switching, and rich-editor failure handling. Without this contract, a UI refactor could lose edits during navigation, save plugin-provided files, or leave users stuck when the rich Markdown editor cannot parse a document.

## Goal

Chat Web MUST provide a Markdown editor for context files that preserves user edits, autosaves managed files, flushes pending saves before document switches, and degrades to raw Markdown when rich editing is unavailable or unsafe.

## Background / Current State

`ContextFilesView` renders `MarkdownEditor` for existing context-file documents. The editor uses MDXEditor for rich Markdown editing, CodeMirror for code blocks, a shared Prism client singleton, and a raw-text fallback. Managed editable documents are autosaved through `saveContextFile` with the current document version as `expectedVersion`. Plugin context files and other non-editable documents are rendered read-only and instruct the user to create a managed copy before editing.

The parent view calls `flushSave()` before selecting a different file or following a selected-file link from another area. Live context-file events can reload clean documents or show a conflict warning when external changes arrive while the local editor is idle with unsaved edits or saving.

## Scope

### In Scope

- Rich Markdown editing for context files in the Chat Web Context area.
- Autosave state transitions for editable managed context files.
- Imperative flush behavior before document changes.
- Raw Markdown fallback for read-only documents and rich-editor load errors.
- Code-block language support and Prism singleton initialization.
- Conflict and save-error behavior visible in the Context Files view.

### Out of Scope

- Context-file storage schema, revisions, source linking, and plugin adoption — covered by Context Files.
- General Chat Web navigation and Context panel composition — covered by Chat Web Context Area.
- Rendering chat transcript Markdown or terminal output — covered by trace and safe-content specs.
- Adding new editor plugins beyond the current Markdown editing surface.

## Requirements

### Requirement: Editable managed files autosave only changed Markdown

The editor MUST persist editable managed context-file content after local changes and MUST avoid writes when the current Markdown equals the last saved Markdown.

#### Current

`MarkdownEditor` tracks `currentMarkdownRef` and `savedMarkdownRef`. User changes set save state to `idle` and schedule `persistIfNeeded()` after 900 ms. If the text has not changed, the save state returns to `saved` without calling `onPersist`.

#### Target

Users can edit a managed context file without pressing a manual save button, and redundant saves do not create extra revisions.

#### Acceptance

- The first editor change caused by initial hydration marks the file as `saved` and does not persist.
- A user edit marks the save state `idle` and schedules autosave.
- Autosave changes state to `saving`, calls the parent persist function once for the changed Markdown, and returns to `saved` when the persisted text matches the current text.
- If no content changed since the last save, autosave reports `saved` without calling the persist API.

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

The editor receives `documentKey` built from context-file key and version or update timestamp. When `documentKey` changes, or when `initialMarkdown` differs from the saved reference, it clears the timer, drops the current save promise, resets refs to `initialMarkdown`, sets `ignoreNextChangeRef`, updates `plainMarkdown`, returns to rich mode, and reports `saved`.

#### Target

Loading a new document never reuses stale autosave state from the previous file.

#### Acceptance

- A changed `documentKey` resets editor state to the new `initialMarkdown`.
- External content changes for the same document reset editor state when the loaded content differs from the saved reference.
- The next rich-editor hydration change after a reset is ignored as an initial change, not treated as a user edit.
- Switching to a new document returns to rich mode unless the new document is read-only or the rich editor errors again.

#### Scenario: Reload latest version

- GIVEN the current context file is reloaded with a new version
- WHEN the editor receives a new document key
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

## Edge Cases

- Autosave failures set save state to `error` and surface the parent error through the Context Files view.
- Save conflicts from the context-file API reload the latest server document and show a conflict warning instead of pretending the local save succeeded.
- External context-file events reload the selected document only when there are no local unsaved or in-flight edits.
- The editor clears its autosave timer on unmount.
- Plain fallback mode is also used for read-only documents, even if the rich editor could render them.

## Constraints

- **Compatibility:** The editor must preserve Markdown as Markdown; it must not invent a separate document model as the persisted source of truth.
- **Security / Privacy:** Read-only context files must not be mutated through editor callbacks. Rich-editor errors may be logged, but context-file content should not be exposed outside the browser session or save API.
- **Performance:** Autosave delay is short and bounded; repeated unchanged content must not create save traffic.
- **Dependencies:** Rich editing depends on `@mdxeditor/editor`, CodeMirror, and Prism availability in the browser bundle.

## Success Criteria

- [ ] SC-001: Editable managed files autosave changed Markdown and avoid redundant saves for unchanged content.
- [ ] SC-002: In-flight saves are serialized and a later edit is persisted before the editor reports `saved`.
- [ ] SC-003: File selection and cross-area selected-file changes call `flushSave()` before loading the next document.
- [ ] SC-004: Non-editable context files render read-only raw Markdown and never call the persist API.
- [ ] SC-005: Rich-editor errors switch to raw Markdown fallback while preserving current content and autosave behavior.
- [ ] SC-006: Document-key changes reset editor state, clear timers, and return editable documents to rich mode.
- [ ] SC-007: Prism client imports share one global Prism instance and expose it on `window.Prism` in browser contexts.

## Assumptions and Open Questions

### Assumptions

- Context-file Markdown remains the canonical stored representation.
- The 900 ms autosave delay is intentional current behavior, not a public timing guarantee beyond being bounded and automatic.
- Raw Markdown fallback is acceptable for all read-only documents and for rich-editor failures.

### Open Questions

- Should users have an explicit toggle between rich and raw Markdown modes even when the rich editor is healthy?
- Should autosave conflicts preserve a local draft for manual merge instead of reloading the server document immediately?
- Should the shared Prism client live in a common package to avoid duplicated source between Chat Web and the legacy context-files UI?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 | Autosave after editing | `src/apps/chat-ui/src/context/MarkdownEditor.tsx`, `src/apps/chat-ui/src/context/ContextFilesView.tsx` | Source-inspected |
| REQ-002 | Edit during save | `src/apps/chat-ui/src/context/MarkdownEditor.tsx` | Source-inspected |
| REQ-003 | Switch with unsaved edits | `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/chat-ui/src/context/MarkdownEditor.tsx` | Source-inspected |
| REQ-004 | Plugin context file | `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/chat-ui/src/context/MarkdownEditor.tsx` | Source-inspected |
| REQ-005 | Rich editor cannot load document | `src/apps/chat-ui/src/context/MarkdownEditor.tsx` | Source-inspected |
| REQ-006 | Reload latest version | `src/apps/chat-ui/src/context/MarkdownEditor.tsx` | Source-inspected |
| REQ-007 | Browser loads editor twice | `src/apps/chat-ui/src/context/prism-client.ts`, `src/apps/context-files-ui/src/prism-client.ts` | Source-inspected |

## Verification Basis

This spec is based on current workspace code in `src/apps/chat-ui/src/context/MarkdownEditor.tsx`, `src/apps/chat-ui/src/context/ContextFilesView.tsx`, `src/apps/chat-ui/src/context/prism-client.ts`, `src/apps/context-files-ui/src/prism-client.ts`, and the context-file API helpers imported from `src/apps/chat-ui/src/api.ts`. No source code was changed.
