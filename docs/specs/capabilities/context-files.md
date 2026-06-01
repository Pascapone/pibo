# Spec: Context Files

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`

## Why

Pibo profiles need durable, inspectable instruction resources that can be loaded into runtimes without hard-coding all context in source code. Users also need to copy plugin-shipped context files, edit them safely, scope them to all profiles or one agent profile, and recover prior versions.

Context Files keep that behavior in the Pibo product boundary. Plugin context files remain read-only sources. Managed context files are editable product records backed by files, metadata, revisions, live catalog registration, and a web UI.

## Goal

Pibo MUST expose authenticated Context File management that lists plugin and managed files, lets users create and edit managed files, preserves revision history, links managed copies to plugin sources, and registers managed files for profile/runtime selection.

## Background / Current State

The current implementation is centered on `src/plugins/context-files.ts` and `src/plugins/context-files-store.ts`. It registers a same-origin web app at `/apps/context-files` and APIs under `/api/context-files`. Managed metadata and revisions live in SQLite, while working markdown is written to managed filesystem paths.

The standalone Context Files web app in `src/apps/context-files-ui` uses the same API. It keeps a file list, opens one selected document, autosaves managed markdown with expected-version checks, renders plugin files as read-only, and listens to `/api/context-files/events` for product events. The plugin registry exposes context files through the capability catalog. Custom agent profiles can select context files by key; unknown references are skipped with warnings so broken custom-agent state can be surfaced and cleaned up.

## Scope

### In Scope

- Listing plugin and managed context files through the capability catalog.
- Creating new managed context files.
- Linking plugin context files into editable managed copies.
- Editing managed markdown with optimistic version checks.
- Browser autosave, save-state display, and safe selection changes in the Context Files web app.
- Updating managed file metadata, scope, and agent profile association.
- Removing managed records and, optionally, their backing files.
- Revision history, restore, source reset, source adoption, and source/working diffs.
- Link-state reporting for plugin-only, clean, dirty, stale, orphaned, and unlinked managed files.
- Legacy managed-store migration into the SQLite metadata store.
- Product events and SSE updates for context-file changes.
- Read-only plugin-file handling and rich-editor fallback behavior in the Context Files web app.

### Out of Scope

- Editing plugin context files in place — plugin files are read-only sources.
- Per-file multi-user ACLs beyond the authenticated web-session boundary.
- Rich file-browser UX for choosing arbitrary managed paths.
- Merging concurrent edits automatically.
- Treating legacy JSON metadata as the long-term source of truth after migration.

## Requirements

### Requirement: Context files are discoverable through one catalog

The system MUST expose all registered plugin context files and active managed context files through the capability catalog with stable keys.

#### Current

`PiboPluginRegistry` stores context files by key. `ContextFileService` upserts managed files into the registry during startup and after managed mutations.

#### Acceptance

- A plugin-registered context file appears in `GET /api/context-files` with `managed: false`, `editable: false`, `removable: false`, and `linkState: "plugin-only"`.
- A managed context file appears with `managed: true`, `editable: true`, `removable: true`, and its current scope.
- Managed files replace catalog display for the same key when registered.
- Removing a managed file removes it from runtime/catalog registration.

#### Scenario: Plugin context file is listed

- GIVEN a plugin registers a context file key and path
- WHEN an authenticated user lists context files
- THEN the response includes the plugin file as a read-only context file.

### Requirement: Managed context files are durable editable resources

The system MUST create managed context files with a metadata record, a markdown file on disk, and an initial working revision.

#### Current

`POST /api/context-files` writes markdown under the managed root or an agent workspace context-file directory, creates a `ctx:` key, writes a SQLite `context_files` row, and appends a `working` revision.

#### Acceptance

- Creating a file requires a non-empty label and string markdown.
- Global files are stored under the configured global managed directory.
- Agent-scoped files require `agentProfileName` and are stored under that agent workspace's context-files directory.
- Created managed files are immediately available to the plugin registry for profile selection.

#### Scenario: Create agent-scoped context file

- GIVEN an authenticated user supplies a label, markdown, scope `agent`, and an agent profile name
- WHEN the user creates the context file
- THEN Pibo stores the file, records a working revision, returns the managed document, and registers it in the capability catalog with that agent scope.

### Requirement: Saves protect against stale editor state

The system MUST reject a managed file save when the supplied expected version does not match the current content version.

#### Current

`PUT /api/context-files/:key` compares `expectedVersion` with the current file version and returns a `409` payload containing the latest document on conflict.

#### Acceptance

- Saves without markdown as a string are rejected.
- Saves against plugin-only files are rejected because only managed files can change.
- Saves with a stale `expectedVersion` return conflict data instead of overwriting newer content.
- Successful saves write the markdown file, append a working revision, update `activeRevisionId`, and emit a change event.

#### Scenario: Concurrent edit conflict

- GIVEN a managed context file is open in the UI
- AND the backing file changes before the user saves
- WHEN the user saves with the old version hash
- THEN the API returns conflict status with the latest document and does not overwrite the newer content.

### Requirement: Browser editing autosaves safely and never drops pending changes

The Context Files web app MUST save editable managed markdown automatically, MUST show the current save state, and MUST flush pending edits before switching documents.

#### Current

`MarkdownEditor` tracks current and saved markdown, schedules autosave after edits, exposes `flushSave()`, and reports `idle`, `saving`, `saved`, or `error` to the app. `handleSelect` calls `flushSave()` before changing the selected key. `handlePersist` saves through `PUT /api/context-files/:key` with the open document version as `expectedVersion`.

#### Acceptance

- Editing a managed file changes the save state to unsaved and schedules a save.
- A successful autosave returns the save state to saved and hydrates the latest document version.
- Selecting another context file waits for pending save work before changing selection.
- A failed autosave reports an error save state and does not mark unsaved content as saved.
- A stale save conflict reloads the latest server document, shows a conflict warning, and does not overwrite the newer server content.
- Read-only documents do not schedule saves and show saved state.

#### Scenario: Switch files with a pending autosave

- GIVEN an editable managed context file has unsaved markdown in the browser
- WHEN the user selects another file before the autosave delay expires
- THEN the app flushes the pending save first and only then opens the requested file.

### Requirement: Plugin sources can be linked into managed copies

The system MUST allow a plugin context file to be copied into an editable managed file while retaining a source reference and source snapshot.

#### Current

`POST /api/context-files/:key/link-from-plugin` requires a live plugin source, writes a managed copy, stores `sourceRef` as `plugin:<pluginId>:<key>`, records a source snapshot and working revision, and reports link state.

#### Acceptance

- Linking a missing or unreadable plugin source fails.
- The linked copy starts with `linkState: "linked-clean"` when working content matches the source hash.
- Editing the managed copy changes the link state to `linked-dirty` while preserving the source reference.
- Updating the plugin source changes linked managed files to `linked-stale` until the user adopts or resets to the new source.

#### Scenario: Plugin source changes after customization

- GIVEN a managed file was linked from a plugin source
- AND the user customized the working copy
- WHEN the plugin source file changes
- THEN Pibo reports the linked copy as stale and preserves the user's working markdown.

### Requirement: Source reset, adoption, diff, and revision restore are explicit

The system MUST expose separate actions for comparing source and working content, adopting a live source, resetting to source content, and restoring an earlier revision.

#### Current

The API supports `GET /diff`, `POST /reset-to-source`, `POST /adopt-source`, `POST /restore-revision`, and `GET /revisions` for managed files.

#### Acceptance

- Diffs can compare `source` and `working` sides and return add/remove/equal chunks.
- Resetting to source replaces working content with the current live source and records a working revision.
- Adopting source refreshes source tracking and working content from the live source.
- Restoring a revision writes that revision content as the new working content.
- Actions that require a linked source fail for unlinked managed files.

#### Scenario: Restore customized revision after reset

- GIVEN a linked managed file has a customized working revision
- AND the user resets it to the current plugin source
- WHEN the user restores the customized revision
- THEN Pibo writes the customized markdown as the active working content and records a new restoration revision.

### Requirement: Missing sources and external file changes are visible

The system MUST detect link-state and filesystem changes and surface them through document reads and product events.

#### Current

`ContextFileService` computes link state on reads and list calls. A polling watcher emits `context-file.external_updated` or `context-file.source_orphaned` events when snapshots change.

#### Acceptance

- A linked managed file whose plugin source disappears reports `linkState: "orphaned"`.
- A managed file whose backing markdown changes outside the API gets a new working revision when read or listed.
- SSE clients receive context-file product events and heartbeat comments.
- The UI refreshes lists and selected documents when relevant context-file events arrive.

#### Scenario: Plugin source is deleted

- GIVEN a linked managed context file has a stored working copy
- WHEN its plugin source file is removed
- THEN reading the managed file returns the working content and reports `linkState: "orphaned"`.

### Requirement: Legacy managed metadata migrates forward

The system MUST import legacy managed context-file metadata from JSON when the SQLite metadata store starts.

#### Current

`ContextFileMetadataStore` reads legacy `index.json`, creates metadata rows for valid entries, and recovers working content from disk into revisions when needed.

#### Acceptance

- Valid legacy entries with key, path, label, and scope become managed records.
- Agent-scoped legacy entries without an agent profile name are ignored.
- Migrated files retain their working markdown from disk.
- Missing or malformed legacy files do not prevent the SQLite store from opening.

#### Scenario: Legacy global file is migrated

- GIVEN a legacy JSON store references a global markdown file
- WHEN the context-file plugin starts
- THEN the file is readable through `/api/context-files/:key` as a managed unlinked file.

### Requirement: Context Files UI reacts to live changes without overwriting local edits

The Context Files web app MUST keep its list and selected document synchronized with context-file product events while protecting local in-progress edits.

#### Current

`main.tsx` opens an `EventSource` at `/api/context-files/events`, filters `pibo-product` events to `context-file.*`, refreshes the file list, reloads the selected document when a non-web source changes it, and raises a conflict message instead of reloading while the editor has local unsaved or saving state.

#### Acceptance

- Context-file product events refresh the sidebar list.
- Events for a different selected key do not replace the open document.
- Events from source `web` do not cause the same browser to reload its own save echo.
- External changes to the selected document reload it when the editor is saved.
- External changes to the selected document show a conflict warning instead of replacing content while the editor is unsaved or saving.
- SSE disconnects are surfaced as a visible error that can be cleared by successful later actions or reload.

#### Scenario: External edit while local draft exists

- GIVEN a managed context file is open and has local unsaved edits
- WHEN a non-web context-file event arrives for the same key
- THEN the app refreshes the file list, keeps the local editor content, and shows a conflict warning.

### Requirement: Rich markdown editing has a plain-text safety fallback

The Context Files web app MUST offer rich markdown editing for normal documents and MUST fall back to raw markdown editing when the rich editor cannot safely load a document.

#### Current

`MarkdownEditor` configures MDXEditor with headings, lists, links, tables, code blocks, frontmatter, diff/source toggle, markdown shortcuts, CodeMirror languages, and an inline-code arrow-exit plugin. Its `onError` handler switches to a plain `<textarea>` using the current markdown. Read-only documents always render the plain fallback with an explanatory notice.

#### Acceptance

- Editable documents open in rich mode by default.
- The rich editor supports common markdown structures used in agent context files, including headings, lists, links, tables, code blocks, and frontmatter.
- A rich-editor load/render error preserves the current markdown and switches to raw markdown editing.
- Plain fallback edits still update the current markdown, mark the document unsaved, and schedule autosave.
- Read-only plugin documents show raw markdown in read-only mode with copy that tells users to create a managed copy before editing.
- Inline code arrow navigation exits code formatting at the end of an inline code span without requiring source-mode editing.

#### Scenario: Rich editor rejects a document

- GIVEN an editable managed context file contains markdown that the rich editor cannot safely render
- WHEN the rich editor reports an error
- THEN the UI switches to the raw markdown textarea with the current content and keeps autosave behavior for future edits.

### Requirement: Runtime profile selection uses managed and plugin context files by key

Profiles MUST be able to select both plugin and managed context files by key, and broken custom-agent references MUST NOT prevent profile creation.

#### Current

`InitialSessionContextBuilder` accepts context-file profiles. Custom agent profile creation resolves selected keys through the plugin registry and skips unknown context files with warnings.

#### Acceptance

- A managed file registered by the context-file service can be selected by a custom agent profile.
- A plugin context file can be selected by a custom agent profile.
- Unknown custom-agent context file keys are skipped during profile creation instead of throwing.
- Broken custom-agent context-file references remain visible to cleanup flows.

#### Scenario: Custom agent has stale context-file key

- GIVEN a custom agent references a context file that no longer exists
- WHEN Pibo creates that custom agent's profile definition
- THEN profile creation continues and omits the unknown context file.

### Requirement: API mutations require authenticated JSON requests

The Context Files API MUST require an authenticated web session for reads and mutations, and mutation handlers MUST parse a JSON request body before creating, editing, deleting, linking, resetting, adopting, or restoring managed files.

#### Current

`createContextFilesWebApp` calls `context.requireSession({ request })` on list, read, event-stream, create, update, metadata update, delete, link-from-plugin, reset-to-source, restore-revision, revision, diff, and adopt-source routes. Mutation routes call `readJsonBody()` where they accept a request body. Source-reset and source-adoption routes require authentication and do not require a body. Unlike the Chat Web API helper in `src/apps/chat/web-app.ts`, the current Context Files plugin does not check the `Origin` header before mutations.

#### Acceptance

- Requests without a valid web session fail before listing, reading, or mutating context files.
- Create, save, metadata update, delete, link-from-plugin, and restore-revision mutations reject malformed JSON bodies before changing managed state.
- Source reset and source adoption can run with an authenticated request and no body because their current source of truth is the linked file state.
- The current source-backed contract does not claim same-origin `Origin` enforcement for Context Files mutations until the implementation adds it.

#### Scenario: Unauthenticated save is rejected

- GIVEN a managed context file exists
- WHEN a request without a valid web session sends `PUT /api/context-files/:key`
- THEN the API rejects the request before writing markdown, appending a revision, or emitting a product event.

## Edge Cases

- A managed markdown file may be deleted from disk; reads MUST fall back to the active revision when possible.
- Browser autosave may finish after additional edits; the editor MUST save the newer content in a follow-up pass before reporting saved.
- A plugin catalog path may be relative; Pibo MUST resolve it relative to the current process working directory.
- A managed label, scope, or agent profile change may require moving the backing file; Pibo MUST write the current content to the new path and remove the old file.
- Two files with the same label need unique managed paths and keys.
- Product-event delivery is best-effort; authenticated clients can always refresh through the REST API.

## Constraints

- **Product Boundary:** Pibo owns managed context-file metadata, revisions, source links, and registry updates. Plugin context files remain plugin-managed sources.
- **Security / Privacy:** Context File APIs MUST require an authenticated web session. Managed mutations record the web session app partition as revision actor metadata when available. Current Context Files mutation handlers require JSON bodies where a body is consumed, but they do not perform the Chat Web `Origin` header guard.
- **Compatibility:** Legacy managed JSON metadata MUST be migrated forward without treating it as the post-migration source of truth.
- **Reliability:** Revision history MUST preserve enough content to recover a managed file when its backing markdown file is missing.
- **UX Safety:** The browser editor MUST prefer visible warnings and raw-markdown fallback over silently dropping content.
- **Context Economy:** Runtime profiles load only selected context files and automatic context files, not every managed resource.

## Success Criteria

- [ ] SC-001: Authenticated users can list plugin and managed context files with accurate editability and link-state metadata.
- [ ] SC-002: Creating or linking a managed context file writes a file, metadata row, initial revisions, and registry entry.
- [ ] SC-003: Stale saves return a conflict document and do not overwrite newer content.
- [ ] SC-004: Linked managed files report clean, dirty, stale, and orphaned states according to source and working hashes.
- [ ] SC-005: Revision restore, source reset, source adoption, and diff endpoints behave as explicit user actions.
- [ ] SC-006: External file changes and source orphaning are observable through reads and context-file product events.
- [ ] SC-007: Legacy managed context-file metadata is readable after startup migration.
- [ ] SC-008: Custom agent profile creation skips unknown context-file keys while preserving valid selections.
- [ ] SC-009: Context Files UI autosave covers delayed save, selection flush, failed save, and version-conflict behavior.
- [ ] SC-010: Context Files UI event handling covers same-browser echoes, external changes while saved, external changes while unsaved, and SSE disconnect errors.
- [ ] SC-011: Context Files UI editor tests cover read-only plugin documents, rich-editor fallback, plain-text autosave, and inline-code exit navigation.
- [ ] SC-012: Context Files API tests cover unauthenticated rejection and malformed JSON rejection for managed mutation routes, and document whether same-origin `Origin` checks are added or intentionally absent.

## Assumptions and Open Questions

### Assumptions

- Web-session authentication is the current access boundary for Context Files.
- Context-file keys are stable identifiers for runtime/profile selection.
- A source-linked managed file should preserve user edits unless the user explicitly resets or adopts source content.

### Open Questions

- Should managed context files become app-spaced rather than shared within the local Pibo home?
- Should Context Files mutations adopt the shared Chat Web same-origin `Origin` guard, or remain authenticated-session plus JSON-body guarded because the app is mounted as a separate same-origin web app?
- Should source adoption and source reset remain separate actions, or should the UI merge them with clearer copy?
- Should large context files have size limits or warnings before runtime injection?
- Should managed context files emit durable reliability events in addition to in-process product events?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Context files are discoverable through one catalog | Plugin context file is listed | `src/plugins/registry.ts`, `src/plugins/context-files.ts` | Implemented |
| REQ-002 Managed context files are durable editable resources | Create agent-scoped context file | `src/plugins/context-files.ts`, `src/plugins/context-files-store.ts` | Implemented |
| REQ-003 Saves protect against stale editor state | Concurrent edit conflict | `src/plugins/context-files.ts`, `src/apps/context-files-ui/src/api.ts` | Implemented |
| REQ-004 Browser editing autosaves safely and never drops pending changes | Switch files with a pending autosave | `src/apps/context-files-ui/src/main.tsx`, `src/apps/context-files-ui/src/components/MarkdownEditor.tsx` | Implemented |
| REQ-005 Plugin sources can be linked into managed copies | Plugin source changes after customization | `src/plugins/context-files.ts`, `test/context-files-web.test.mjs` | Implemented |
| REQ-006 Source reset, adoption, diff, and revision restore are explicit | Restore customized revision after reset | `src/plugins/context-files.ts`, `src/plugins/context-files-store.ts` | Implemented |
| REQ-007 Missing sources and external file changes are visible | Plugin source is deleted | `src/plugins/context-files.ts`, `test/context-files-web.test.mjs` | Implemented |
| REQ-008 Legacy managed metadata migrates forward | Legacy global file is migrated | `src/plugins/context-files-store.ts`, `test/context-files-web.test.mjs` | Implemented |
| REQ-009 Context Files UI reacts to live changes without overwriting local edits | External edit while local draft exists | `src/apps/context-files-ui/src/main.tsx`, `src/plugins/context-files.ts` | Implemented |
| REQ-010 Rich markdown editing has a plain-text safety fallback | Rich editor rejects a document | `src/apps/context-files-ui/src/components/MarkdownEditor.tsx` | Implemented |
| REQ-011 Runtime profile selection uses managed and plugin context files by key | Custom agent has stale context-file key | `src/core/profiles.ts`, `src/apps/chat/agent-profiles.ts`, `test/agent-profiles.test.mjs` | Implemented |
| REQ-012 API mutations require authenticated JSON requests | Unauthenticated save is rejected | `src/plugins/context-files.ts`, `src/web/channel.ts`, `src/web/http.ts`, `test/context-files-web.test.mjs` | Partly tested |

## Verification Basis

Current behavior is covered or illustrated by `test/context-files-web.test.mjs`, `test/agent-profiles.test.mjs`, `test/plugin-registry.test.mjs`, context-file references in `test/web-channel.test.mjs`, and current UI code under `src/apps/context-files-ui/src/`. The API mutation boundary was rechecked against `src/plugins/context-files.ts`, especially `createContextFilesWebApp`, and against the shared web request helpers in `src/web/http.ts`.
