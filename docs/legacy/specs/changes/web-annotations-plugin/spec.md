# Spec: Web Annotations Plugin

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** User request in Pibo session `ps_66f8aadc-7437-45db-a387-7c87174fc0c8`  
**Related docs:** `GLOSSARY.md`, `docs/reports/web-annotation-feedback-tools-agentation-open-design.md`, `docs/specs/capabilities/web-render-debug-tool.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`, `docs/specs/capabilities/yielded-run-control.md`

## Why

Frontend collaboration needs precise references. A user can see the exact UI element that should change, but the agent often receives only text or a screenshot. The agent must then infer the selector, component, and file.

Pibo should turn user-selected UI targets into structured, session-scoped annotations. The user marks an element or region in a live browser. The agent receives target metadata, source hints when available, and the user's note.

## Goal

Pibo MUST provide a plugin-based Web Annotations workflow that lets Chat Web bind an external browser page to the current Pibo Session, collect runtime DOM annotations, and expose those annotations to selected agents through a tool package.

## Background / Current State

Pibo already has CDP-based web debugging commands under `pibo debug web`: targets, attach-chat, snapshot, diff, watch, and guided scenarios. These tools help the agent inspect browser state, but they do not let the user mark an element in the browser and send that mark back into the Pibo Session.

The Agentation and Open Design investigation found two relevant patterns:

- Agentation shows a small annotation overlay and exposes pending annotations to agents.
- Open Design binds preview comments to chat messages and carries structured target context into the prompt.

Pibo needs the same communication path, but as a plugin: installable/selectable capability, optional agent tool package, and session-aware Chat Web integration.

## Scope

### In Scope

- A plugin-provided Web Annotations capability.
- A Chat Web action to annotate a URL from the current Pibo Session.
- A Chat Web action to attach an existing CDP browser target to the current Pibo Session.
- Runtime-only overlay injection into the selected browser target through CDP.
- Element, text, region, and visual target annotation records.
- Session and Room binding for every annotation.
- Annotation list and attachment UI in Chat Web.
- Agent tool package for listing, reading, watching, acknowledging, resolving, and dismissing annotations.
- Source-hint capture when available through DOM attributes, LocatorJS-compatible metadata, React dev metadata, or future Pibo instrumentation.
- Optional screenshot artifact references for visual annotations.

### Out of Scope

- Chrome Extension distribution — deferred until the CDP workflow proves useful.
- Annotating arbitrary browsers that Pibo cannot reach through CDP — deferred to extension or pairing work.
- Mandatory source-code changes in target apps — basic annotation must work without app changes.
- Automatic source instrumentation for all projects — future enhancement.
- Editing target DOM or source code directly from the overlay — agent changes remain explicit agent actions.
- Long-term public share links for annotations — local/session scope only.

## Definitions

### Web Annotation

A persisted record that binds a user's note to a browser target, URL, DOM element or visual region, and Pibo Session.

### Annotation Overlay

A runtime-only script and UI injected into a CDP target. It collects clicks, selections, notes, and target metadata. It is not committed to target app source code.

### Source Hint

Optional metadata that helps an agent find source code. Examples: `file:line:column`, React component path, LocatorJS data attributes, `data-testid`, `data-pibo-id`, or framework dev metadata.

### Session Binding

The association between a CDP target and the Pibo Session/Room that requested annotation. Binding determines where annotation events are stored and shown.

## Requirements

### Requirement: Plugin capability is selectable

The system MUST expose Web Annotations as a plugin-owned capability with selectable agent tools.

#### Current

Pibo has plugin registration for tools, web apps, gateway actions, profiles, context files, and capability catalog entries. No Web Annotations capability exists.

#### Target

The plugin registers native tools and any UI/API surfaces needed for Web Annotations. Agent profiles can include or omit the annotation tools.

#### Acceptance

- The capability catalog lists the plugin's native tools with plugin metadata.
- A profile can run without Web Annotation tools.
- A profile that selects the tools can list and read annotations.

#### Scenario: Agent profile includes annotation tools

- GIVEN a profile includes the Web Annotations tool package
- WHEN a routed runtime starts with that profile
- THEN the runtime exposes the annotation tools to the agent.

### Requirement: Chat Web can start URL annotation for the current session

Chat Web MUST let the user start annotation for an external URL and bind the resulting browser target to the current Pibo Session and Room.

#### Current

Users can use browser debugging tools outside Chat Web, but Chat Web has no session-aware URL annotation flow.

#### Target

From an active Chat Web session, the user can enter a URL. Pibo opens or attaches a CDP target, injects the overlay, and records a binding to the current Pibo Session and Room.

#### Acceptance

- The user can start annotation only from an active session context.
- The binding records `piboSessionId`, `roomId`, target id, URL, and creation time.
- Annotation events from that target use the recorded binding.
- If CDP target creation or attachment fails, Chat Web shows a concise error.

#### Scenario: Start annotation for a local dev app

- GIVEN the user is in Chat Web session `ps_...`
- WHEN the user starts annotation for `http://localhost:3000`
- THEN Pibo opens or attaches a browser target for that URL
- AND injects the overlay
- AND binds the target to `ps_...` and the current Room.

### Requirement: Chat Web can attach an existing browser target

Chat Web MUST support binding an already-open CDP target to the current Pibo Session.

#### Current

`pibo debug web targets` can list browser targets, but Chat Web does not bind one to a session for annotation.

#### Target

The user can choose from reachable CDP targets and start annotation without reopening the page.

#### Acceptance

- The target list includes URL and title where available.
- The user must explicitly choose a target before injection.
- Pibo does not inject into targets that were not selected.
- Failed injection leaves no active binding.

#### Scenario: Attach existing target

- GIVEN a browser target is open at `http://localhost:5173`
- WHEN the user selects it from Chat Web and starts annotation
- THEN Pibo injects the overlay into that target
- AND stores a session binding for future annotation events.

### Requirement: Overlay captures runtime DOM annotations

The injected overlay MUST let the user create an annotation for a clicked element, selected text, visual region, or free pin.

#### Current

No user-facing overlay exists.

#### Target

The overlay supports basic selection and note entry in the live browser page.

#### Acceptance

Each annotation includes at minimum:

- annotation id
- status
- Pibo Session ID
- Pibo Room ID
- target URL
- target kind
- user note
- created timestamp
- viewport size
- target position when applicable
- target metadata available for that kind

#### Scenario: Element annotation

- GIVEN annotation mode is active on a bound target
- WHEN the user clicks a visible element and submits a note
- THEN Pibo stores an annotation with target kind `element`
- AND stores selector, DOM path, text, HTML hint, bounding box, and source hints when available.

#### Scenario: Region annotation

- GIVEN annotation mode is active
- WHEN the user marks a region and submits a note
- THEN Pibo stores an annotation with target kind `region`
- AND stores the region box and optional screenshot artifact reference.

### Requirement: Annotation records preserve source hints when available

The system MUST capture and preserve source hints without making them mandatory.

#### Current

Pibo can inspect DOM snapshots, but does not persist source-location metadata from annotated elements.

#### Target

Annotations include source hints from stable DOM attributes, LocatorJS-compatible data, React dev metadata, or future Pibo dev instrumentation when those signals exist.

#### Acceptance

- Basic annotation succeeds even with no source hint.
- If a clicked element or ancestor exposes a recognized source hint, the annotation stores it.
- Stored source hints are shown to the user and agent.
- Missing source hints are represented as absent, not as errors.

#### Scenario: LocatorJS-compatible source hint

- GIVEN the target page exposes LocatorJS-compatible source metadata on or above the clicked element
- WHEN the user submits an annotation
- THEN the annotation includes file path, line, column, and component data available from that metadata.

### Requirement: Annotation records are session-scoped and inspectable

The system MUST store annotations so Chat Web and agent tools can list them by Pibo Session.

#### Current

No annotation store exists.

#### Target

Annotations are persisted in a local store keyed by Pibo Session ID, Room ID, status, and creation time.

#### Acceptance

- Listing annotations for one Pibo Session does not return annotations from another session.
- The list is ordered by newest first by default.
- The store supports status updates.
- Deleting or disposing a target binding does not delete historical annotations.

#### Scenario: Separate sessions stay isolated

- GIVEN two Pibo Sessions have active annotation bindings
- WHEN the user creates one annotation in each target
- THEN listing annotations for the first session returns only the first annotation.

### Requirement: Chat Web surfaces annotations as message attachments

Chat Web MUST show session annotations and let the user attach selected annotations to the next user message.

#### Current

Chat Web messages do not carry web annotation attachments.

#### Target

Open annotations for the current session appear in Chat Web. The user can attach one or more annotations to a message. The outgoing message carries structured annotation context.

#### Acceptance

- Open annotations appear in the active session UI.
- The user can attach and detach annotations before sending.
- Sent messages include annotation attachment data or references.
- The model-visible text includes a concise structured block for attached annotations.
- The original annotation record remains inspectable after the message is sent.

#### Scenario: Send message with annotation

- GIVEN an open annotation says `make this wider`
- WHEN the user attaches it and sends `please fix this`
- THEN the agent receives both the user text and the structured annotation context.

### Requirement: Agent tools manage annotation lifecycle

The Web Annotations tool package MUST let agents read and update annotations without requiring Chat Web UI interaction.

#### Current

No annotation tools exist.

#### Target

Selected agents can list annotations, get details, watch for new annotations, acknowledge work, resolve completed work, dismiss irrelevant annotations, and add replies or summaries.

#### Acceptance

The tool package includes at least:

- `web_annotations_list`
- `web_annotations_get`
- `web_annotations_watch`
- `web_annotations_acknowledge`
- `web_annotations_resolve`
- `web_annotations_dismiss`

Tools require a session context or explicit session id. Tools cannot access annotations outside the caller's owner scope.

#### Scenario: Agent resolves an annotation

- GIVEN an agent has fixed the code for annotation `ann_123`
- WHEN the agent calls `web_annotations_resolve` with a summary
- THEN the annotation status becomes `resolved`
- AND the summary is recorded.

### Requirement: Annotation overlay can be removed or refreshed

The system MUST let the user stop annotation mode and refresh overlay injection for a bound target.

#### Current

No overlay exists.

#### Target

Users can stop annotation mode. If the page reloads or the overlay disappears, users can re-inject it for the same binding.

#### Acceptance

- Stopping annotation removes or disables the overlay UI where possible.
- Refreshing injection preserves the existing binding.
- A page reload does not delete annotations already stored.
- Failed cleanup does not break the target page.

#### Scenario: Page reload

- GIVEN a bound target reloads
- WHEN the user clicks re-inject
- THEN Pibo injects the overlay again
- AND new annotations continue to attach to the same Pibo Session.

## Edge Cases

- CDP is unavailable or no browser targets exist.
- The selected target closes after binding.
- The target page reloads after injection.
- The target page has cross-origin iframes that cannot be inspected from the top-level overlay.
- The clicked element has no stable selector or source hint.
- The clicked element is inside Shadow DOM.
- The page blocks or overwrites injected event listeners.
- The annotation API receives malformed or oversized payloads.
- Multiple browser targets are bound to the same Pibo Session.
- Multiple Pibo Sessions try to bind the same target.
- A user attaches an annotation that was resolved or dismissed after the composer loaded.

## Constraints

- **Compatibility:** Basic annotation must work for plain HTML/JS, React, and TypeScript React apps without source changes. Source hints are optional.
- **Security / Privacy:** Injection requires explicit user action. APIs must enforce owner scope. Payloads must be size-limited and sanitized. Secrets and large text bodies must not be copied into prompts by default.
- **Performance:** Overlay hover and target discovery must avoid blocking normal page interaction. Large DOM pages must be sampled or throttled.
- **Dependencies:** CDP/browser-use infrastructure is the first transport. LocatorJS integration is an optional enrichment path, not a hard requirement for basic annotation.
- **Plugin boundary:** The feature must register through Pibo's plugin/capability systems rather than becoming an unselectable core tool.

## Success Criteria

- [ ] SC-001: A user can annotate `http://localhost:*` from an active Chat Web session without changing the target app source.
- [ ] SC-002: The created annotation appears in the originating Chat Web session.
- [ ] SC-003: An agent with the tool package can list and inspect the annotation.
- [ ] SC-004: A sent message can include one or more annotation attachments.
- [ ] SC-005: Annotation context includes DOM target data and source hints when available.
- [ ] SC-006: An agent can resolve an annotation with a summary.
- [ ] SC-007: An unauthorized session cannot read another owner's annotations.

## Assumptions and Open Questions

### Assumptions

- Pibo can use existing Browser Use / CDP target discovery for the first version.
- Chat Web is the primary UX for starting annotation sessions.
- Source location is best-effort unless target apps opt into LocatorJS/Pibo instrumentation.
- The initial store can be local SQLite or the existing Pibo data store, as long as it is session-scoped and durable across gateway restarts.

### Open Questions

- Should annotations attach automatically to the next message, or require explicit selection every time?
- Should one CDP target be allowed to bind to multiple Pibo Sessions at once?
- Which LocatorJS metadata format should Pibo treat as stable input?
- Should screenshot capture be required for every annotation or only for region/visual annotations?
- Should resolved annotations remain visible by default in Chat Web?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Plugin capability is selectable | Agent profile includes annotation tools | T-001, T-006, T-019 | Pending |
| REQ-002 Chat Web can start URL annotation | Start annotation for local dev app | T-010, T-011, T-012 | Pending |
| REQ-003 Chat Web can attach an existing target | Attach existing target | T-013, T-014 | Pending |
| REQ-004 Overlay captures runtime DOM annotations | Element and region annotation | T-015, T-016, T-017 | Pending |
| REQ-005 Preserve source hints | LocatorJS-compatible source hint | T-018 | Pending |
| REQ-006 Records are session-scoped | Separate sessions stay isolated | T-003, T-004, T-005 | Pending |
| REQ-007 Chat Web surfaces attachments | Send message with annotation | T-020, T-021, T-022 | Pending |
| REQ-008 Agent tools manage lifecycle | Agent resolves annotation | T-006, T-007, T-008, T-009 | Pending |
| REQ-009 Overlay can be removed/refreshed | Page reload | T-023, T-024 | Pending |
