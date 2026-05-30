# Spec: Runtime Prompt and Compaction Configuration

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/context-files.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/pibo-session-routing.md`

## Why

Pibo controls the product boundary around Pi Coding Agent. That boundary includes which base prompt starts a runtime, which runtime context files are injected, and how long conversations are summarized during compaction.

These behaviors affect safety, continuity, and debuggability. They need a durable spec because they are configured through Chat Web, persisted in `.pibo/`, and applied to every runtime assembled from a profile.

## Goal

Pibo SHALL select, expose, validate, and apply base-prompt and compaction-prompt configuration consistently across Chat Web, runtime creation, and Pi session compaction.

## Background / Current State

The current code provides library prompt files under `context/`, optional custom prompt files under `.pibo/`, and JSON state files that select `library` or `custom` mode. Chat Web exposes authenticated API routes and UI panels for reading, editing, and switching prompt modes.

Runtime creation loads the active Pibo base prompt, renders template markers for tool and guideline sections, injects product session context as an in-memory context file, and registers a Pibo compaction extension. The compaction extension parses tagged prompt sections and uses the active compaction prompt to summarize history, update existing summaries, and summarize split-turn prefixes.

## Scope

### In Scope

- Library and custom Pibo base prompt selection.
- Library and custom Pibo compaction prompt selection.
- Chat Web prompt-management API and UI behavior.
- Runtime prompt-template rendering for available tools and guidelines.
- Runtime context-file injection for Pibo Session metadata.
- Pi session compaction behavior owned by Pibo.

### Out of Scope

- Pi Coding Agent's internal transcript format — Pibo consumes it but does not own it.
- General managed context files — covered by `docs/specs/capabilities/context-files.md`.
- Profile catalog validation — covered by `docs/specs/capabilities/plugin-registry-and-capability-catalog.md` and `custom-agents.md`.
- Provider model selection and API-key storage — separate runtime/model capability.

## Requirements

### Requirement: Base prompt mode is persisted per workspace

Pibo MUST store the selected base prompt mode in workspace-local `.pibo/base-prompt.json` and default to `library` when the state file is absent, invalid, or contains an unknown mode.

#### Current

`src/core/base-prompt.ts` normalizes all non-`custom` values to `library`, reads from `.pibo/base-prompt.json`, and reads custom markdown from `.pibo/base-prompt.md`.

#### Target

Runtime creation and Chat Web prompt APIs observe the same effective base prompt for a given workspace.

#### Acceptance

- With no `.pibo/base-prompt.json`, `readPiboBasePrompt(cwd).effectiveMode` is `library`.
- With mode `custom` and an existing `.pibo/base-prompt.md`, the effective mode is `custom`.
- With mode `custom` and no custom file, the effective mode falls back to `library` without deleting state.

#### Scenario: Missing custom base prompt

- GIVEN `.pibo/base-prompt.json` selects `custom`
- AND `.pibo/base-prompt.md` is missing
- WHEN Chat Web loads `/api/chat/base-prompt`
- THEN the response reports `mode: custom`
- AND `effectiveMode: library`
- AND the library markdown remains available.

### Requirement: Custom base prompt content is preserved across mode switches

Pibo MUST switch between `library` and `custom` base prompt modes without losing custom prompt markdown.

#### Current

`savePiboCustomBasePrompt` writes `.pibo/base-prompt.md` and selects `custom`. `setPiboBasePromptMode("library")` keeps the custom file and returns it in the snapshot.

#### Target

Users can safely compare library and custom prompts and return to a previous custom prompt.

#### Acceptance

- Saving custom markdown makes `custom.exists` true and `effectiveMode` custom.
- Switching to library leaves `custom.markdown` unchanged.
- Switching back to custom reuses the saved custom markdown.

#### Scenario: Toggle back to custom

- GIVEN a user saved `custom base prompt`
- WHEN the user switches to library mode
- AND later switches to custom mode
- THEN runtime prompt selection uses the saved custom base prompt.

### Requirement: Runtime prompt templates render selected tools and guidelines

Pibo MUST render base-prompt template markers before a runtime starts. The rendered prompt MUST replace `{{availableTools}}` with active tool snippets and `{{guidelines}}` with tool-aware and profile-provided guidelines.

#### Current

`src/core/system-prompt-template.ts` registers a `before_agent_start` extension. It replaces markers only when present, defaults the tool list to `read`, `bash`, `edit`, and `write`, deduplicates guidelines, and always adds concise-response and file-path guidelines.

#### Target

Agents receive a concrete system prompt and never see unresolved Pibo template markers when the active prompt contains them.

#### Acceptance

- A base prompt containing `{{availableTools}}` emits a bullet list for selected tools that have snippets.
- If no selected tool has a snippet, the section renders `(none)`.
- Guidelines are not duplicated.
- A prompt without markers is returned unchanged.

#### Scenario: Profile uses bash without grep/find/ls tools

- GIVEN a runtime profile selects `bash` but not dedicated `grep`, `find`, or `ls` tools
- WHEN the system prompt template is rendered
- THEN the guidelines include a recommendation to use bash for file operations.

### Requirement: Product runtime context is injected as a context file

Pibo MUST inject product-level runtime identity into each runtime as a context file named `pibo://runtime/session-context.md`.

#### Current

`createPiboRuntime` creates an in-memory context file with shared app context, Pibo Session ID, optional room ID, and timezone, then merges it with Pi and profile context files.

#### Target

Agents can reference product identity for scheduling jobs, correlation, and session-aware behavior without confusing Pibo Session IDs with Pi Session IDs.

#### Acceptance

- The injected context includes `User ID`, `Owner scope`, `Pibo Session ID`, and `User timezone`.
- Runtime context does not derive user identity from owner scope; auth identity is not product context.
- If no timezone is passed, Pibo uses the default user timezone.
- Duplicate context-file paths are merged so the first occurrence wins.

#### Scenario: Routed room session starts

- GIVEN a Chat Web routed session has Pibo Session ID `ps_123`
- WHEN Pibo creates the runtime
- THEN the runtime context includes `Owner scope: user:abc`
- AND `Pibo Session ID: ps_123`.

### Requirement: Compaction prompt mode is persisted per workspace

Pibo MUST store the selected compaction prompt mode in workspace-local `.pibo/compaction-prompt.json` and default to `library` when the state file is absent, invalid, or contains an unknown mode.

#### Current

`src/core/compaction-prompt.ts` normalizes all non-`custom` values to `library`, reads from `.pibo/compaction-prompt.json`, and reads custom markdown from `.pibo/compaction-prompt.md`.

#### Target

The compaction extension and Chat Web prompt APIs use the same active compaction prompt for a workspace.

#### Acceptance

- With no state file, the active compaction prompt path is `context/pibo-compaction-prompt.md`.
- With mode `custom` and an existing custom file, the active compaction prompt path is `.pibo/compaction-prompt.md`.
- With mode `custom` and no custom file, Pibo falls back to the library compaction prompt.

#### Scenario: Gateway restarted after custom compaction prompt saved

- GIVEN a user saved a valid custom compaction prompt
- WHEN the web gateway restarts in the same workspace
- THEN subsequent compactions use the custom prompt until the mode changes.

### Requirement: Custom compaction prompt saves are structurally validated

Pibo MUST reject custom compaction prompt markdown unless it contains every required tagged section.

#### Current

`parsePiboCompactionPrompt` extracts `<system-prompt>`, `<summary-prompt>`, `<update-summary-prompt>`, and `<turn-prefix-summary-prompt>`. `savePiboCustomCompactionPrompt` parses before writing.

#### Target

A broken custom compaction prompt cannot replace a previously working prompt.

#### Acceptance

- Missing any required section fails the save.
- The failed save does not write `.pibo/compaction-prompt.md` as the active prompt.
- The error names the missing section.

#### Scenario: Missing summary section

- GIVEN a user submits `<system-prompt>only one section</system-prompt>`
- WHEN Chat Web calls `PUT /api/chat/compaction-prompt/custom`
- THEN the request fails with a 4xx error
- AND the error mentions the missing `<summary-prompt>` section.

### Requirement: Compaction summaries preserve continuity and file-operation context

Pibo MUST produce compaction summaries that preserve conversation goals, current work, and relevant file operations.

#### Current

The compaction extension listens for `session_before_compact`, builds prompts from Pi-prepared messages, calls the active model through `completeSimple`, and appends `<read-files>` and `<modified-files>` sections derived from preparation file operations.

#### Target

After compaction, the next agent turn has enough context to continue without rereading all prior messages.

#### Acceptance

- New summaries use the summary prompt.
- Updates with previous summaries include the previous summary and use the update prompt.
- Split-turn compaction summarizes prior history and the turn prefix separately.
- Read-only files and modified files are separated in appended file-operation sections.
- If no model or API key is available, Pibo does not provide a custom compaction result and lets the underlying runtime behavior continue.

#### Scenario: Split turn compaction

- GIVEN Pi emits `session_before_compact` with `isSplitTurn: true`
- AND there are messages to summarize and turn-prefix messages
- WHEN Pibo compaction runs
- THEN the resulting summary includes a history summary
- AND a `Turn Context (split turn)` section for the retained turn suffix.

### Requirement: Chat Web prompt APIs are authenticated and same-origin protected

Pibo MUST require an authenticated web session for all prompt-management API calls and MUST require same-origin JSON requests for prompt mutations.

#### Current

`src/apps/chat/web-app.ts` calls `requireSession` for GET and mutation routes, and calls `requireSameOriginJsonRequest` before PATCH and PUT routes.

#### Target

Prompt configuration is not readable or mutable by unauthenticated clients, and browser-based cross-site writes are rejected.

#### Acceptance

- `GET /api/chat/base-prompt` and `GET /api/chat/compaction-prompt` require a valid web session.
- PATCH and PUT routes reject requests that fail same-origin JSON checks.
- Invalid mode values return a 400-level error with a concrete message.
- Prompt markdown request bodies must provide markdown as a string.

#### Scenario: Cross-site prompt mutation

- GIVEN a request lacks the required same-origin JSON headers
- WHEN it calls `PATCH /api/chat/base-prompt`
- THEN Pibo rejects the request before changing `.pibo/base-prompt.json`.

### Requirement: Chat Web prompt UI distinguishes library and custom sources

Chat Web MUST show library prompts as read-only, custom prompts as editable, and the active effective source as visible state.

#### Current

`BasePromptView` and `CompactionPromptView` show source buttons, active badges, read-only library textareas, editable custom textareas, reload buttons, and save/toggle actions.

#### Target

Users can inspect the active prompt, edit custom content, save changes, and switch modes without guessing which source will affect future runtimes.

#### Acceptance

- Loading a prompt panel shows the active source path.
- Library source textareas are read-only.
- Custom source textareas become dirty when edited and can be saved.
- Save success activates custom mode and clears the error state.
- Save failure preserves the edited text and shows the error.

#### Scenario: Invalid custom compaction prompt in UI

- GIVEN a user edits the custom compaction prompt and removes a required tag
- WHEN the user saves
- THEN the UI shows the API error
- AND does not mark the save state as saved.

## Edge Cases

- Custom base prompt mode can be selected before a custom file exists; Pibo seeds it from the library prompt when mode is set through the mode API.
- Invalid JSON state files fall back to library mode instead of blocking runtime creation.
- A legacy `.pibo/SYSTEM.md` disables active Pibo base prompt path selection for compatibility.
- Provider-backed tools may be active without a local Pi tool definition; prompt rendering only lists tools with snippets.
- Duplicate context-file paths are de-duplicated during merge.
- Compaction errors from model completion surface as summarization failures for the compaction path.

## Constraints

- **Compatibility:** Existing `.pibo/base-prompt.*` and `.pibo/compaction-prompt.*` locations remain workspace-local contracts.
- **Security / Privacy:** Prompt APIs require authenticated Chat Web sessions; mutation routes require same-origin JSON requests.
- **Performance:** Prompt snapshots read local files and should not call model providers. Model calls occur only during compaction.
- **Dependencies:** Pibo prompt compaction depends on Pi Coding Agent's `session_before_compact` event and prepared compaction payload.

## Success Criteria

- [ ] SC-001: Runtime creation uses the active base prompt path selected by workspace prompt state.
- [ ] SC-002: Prompt template markers are fully rendered before the agent starts.
- [ ] SC-003: Runtime context includes product session identity for routed sessions.
- [ ] SC-004: Custom base prompt content survives library/custom toggles.
- [ ] SC-005: Broken custom compaction prompts are rejected before they become active.
- [ ] SC-006: Compaction summaries use the active compaction prompt and preserve split-turn context.
- [ ] SC-007: Chat Web prompt API mutations are authenticated and same-origin protected.
- [ ] SC-008: Chat Web UI accurately shows active, read-only, editable, saving, and error states.

## Assumptions and Open Questions

### Assumptions

- Prompt selection is workspace-local, not account-scoped, in the current implementation.
- The library prompt files in `context/` are package-owned and read-only from Chat Web.
- Chat Web users who can access the prompt panels are trusted to edit prompts for that workspace.

### Open Questions

- Should prompt configuration remain workspace-scoped or become profile-scoped? It must not become account-scoped in the shared app model.
- Should base prompt saves receive structural validation beyond requiring markdown to be a string?
- Should prompt snapshots include revision metadata or conflict detection like managed context files?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Base prompt mode is persisted per workspace | Missing custom base prompt | `src/core/base-prompt.ts` | Implemented |
| REQ-002 Custom base prompt content is preserved | Toggle back to custom | `test/base-prompt.test.mjs` | Implemented |
| REQ-003 Runtime prompt templates render selected tools and guidelines | Profile uses bash without grep/find/ls tools | `src/core/system-prompt-template.ts` | Implemented |
| REQ-004 Product runtime context is injected | Routed room session starts | `src/core/runtime.ts` | Implemented |
| REQ-005 Compaction prompt mode is persisted per workspace | Gateway restarted after custom compaction prompt saved | `src/core/compaction-prompt.ts` | Implemented |
| REQ-006 Custom compaction prompt saves are structurally validated | Missing summary section | `test/compaction-prompt.test.mjs` | Implemented |
| REQ-007 Compaction summaries preserve continuity and file-operation context | Split turn compaction | `src/core/compaction-prompt.ts` | Implemented |
| REQ-008 Chat Web prompt APIs are authenticated and same-origin protected | Cross-site prompt mutation | `src/apps/chat/web-app.ts` | Implemented |
| REQ-009 Chat Web prompt UI distinguishes library and custom sources | Invalid custom compaction prompt in UI | `src/apps/chat-ui/src/context/*PromptView.tsx` | Implemented |

## Verification Basis

This spec is based on current workspace code in:

- `src/core/base-prompt.ts`
- `src/core/compaction-prompt.ts`
- `src/core/system-prompt-template.ts`
- `src/core/runtime.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat-ui/src/context/BasePromptView.tsx`
- `src/apps/chat-ui/src/context/CompactionPromptView.tsx`
- `context/pibo-system-prompt.md`
- `context/pibo-compaction-prompt.md`
- `test/base-prompt.test.mjs`
- `test/compaction-prompt.test.mjs`
