# Proposal: Web Annotations Plugin

## Why

Pibo agents and users currently coordinate frontend work through text, screenshots, CDP snapshots, and manual descriptions. This is imprecise. A user can say "make this wider," but the agent must infer which DOM node, component, file, and source location the user means.

A Web Annotations plugin will let a user open or attach a browser page from Chat Web, mark a live UI element or region, add a note, and send that structured reference to the current Pibo Session. The agent receives a durable annotation instead of a vague visual description.

## What Changes

Add a plugin-provided workflow for annotating web pages from the current Chat Web session:

1. The user starts annotation for a URL or existing browser target from Chat Web.
2. Pibo opens or attaches to the target through CDP and injects a runtime-only annotation overlay.
3. The user selects an element or region and writes a note.
4. The overlay sends the annotation to Pibo, bound to the originating Pibo Session and Room.
5. Chat Web shows the annotation as a session-scoped item that can be attached to a message.
6. Agent profiles can include a Web Annotations tool package to list, inspect, watch, acknowledge, and resolve annotations.

The first version uses CDP injection. It does not require source-code changes in the target app. For React/TypeScript projects, the plugin also captures source hints when the page exposes them through React dev metadata, LocatorJS-compatible attributes, or future Pibo dev instrumentation.

## Capabilities

### New Capabilities

- `web-annotations-plugin`: plugin-owned annotation workflow, store, API, Chat Web UI hooks, and agent tool package.
- `web-annotation-agent-tools`: native tools that let selected agents inspect and manage annotations.
- `web-annotation-session-binding`: binds browser targets and annotation events to a Pibo Session and Room.

### Modified Capabilities

- `chat-web-rooms-and-event-streams`: may surface session-scoped annotation events in Chat Web.
- `web-render-debug-tool`: gains an annotation-oriented CDP injection flow alongside snapshots, diffs, and watches.
- `plugin-registry-and-capability-catalog`: lists the plugin tools as selectable capabilities.
- `pibo-runtime-assembly-and-inspection`: selected profiles can receive the Web Annotations tool package.

## Impact

- **Code:** Add a plugin, annotation store, web/API endpoints, CDP injection command, Chat Web UI entry points, and native tools.
- **APIs / CLI:** Add authenticated annotation APIs and optional `pibo debug web annotate` commands. CLI must remain progressively discoverable.
- **Data:** Persist annotation records with session, room, URL, target metadata, note, status, and optional screenshot artifact references.
- **Auth / Security:** Annotation APIs require same-origin Chat Web auth or explicit local pairing. Injection only targets user-selected CDP targets.
- **Docs:** Add this change spec and update capability specs after implementation.

## Non-Goals

- Chrome Extension support in the first implementation.
- Full source mapping for every framework or third-party website.
- Automatic code modification from annotations without an explicit user message or agent action.
- Requiring every Pibo component to carry manually maintained IDs.
