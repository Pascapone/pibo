# Spec: Web Annotations Plugin

**Status:** Draft
**Created:** 2026-05-16
**Controller / Source:** Web Annotations Plugin change set
**Related docs:** [Web Annotations proposal](../changes/web-annotations-plugin/proposal.md), [Web Annotations spec](../changes/web-annotations-plugin/spec.md), [Web Annotations design](../changes/web-annotations-plugin/design.md), [Web Render Debug Tool](./web-render-debug-tool.md), [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md)

## Why

Pibo users often describe frontend changes with vague text or screenshots. A Web Annotation turns a user-selected browser element, pin, region, or text selection into a durable, session-scoped record that agents can inspect and resolve.

## Goal

Pibo MUST provide a plugin-managed Web Annotations capability that can bind an explicitly selected CDP browser target to the current Pibo Session, collect bounded annotation payloads, show those annotations in Chat Web, and expose optional native tools to selected agent profiles.

## Scope

### In Scope

- Session-scoped annotation records bound to Pibo Session ID, optional Room ID, target URL, target kind, status, timestamps, user note, viewport, and target metadata. Legacy controller fields, when present, are compatibility metadata only.
- Durable binding records for URL annotation flows and existing CDP targets.
- CDP-first runtime overlay injection for selected targets. Target apps do not need source-code changes for basic annotation.
- Chat Web entry points for annotating a URL or attaching an existing target from an active session.
- Chat Web annotation list or chips with explicit attach/detach before sending the next message.
- Model-visible annotation context rendered as a concise bounded block when annotations are attached to a user message.
- Native tools selected through a profile package: `web_annotations_list`, `web_annotations_get`, `web_annotations_watch`, `web_annotations_acknowledge`, `web_annotations_resolve`, and `web_annotations_dismiss`.
- Best-effort source hints from stable DOM attributes, LocatorJS-compatible metadata, React development metadata, and DOM fallback metadata.

### Out of Scope

- Chrome Extension distribution in V1.
- Public annotation sharing or cloud synchronization.
- Automatic source edits or DOM edits directly from the overlay.
- Full DOM dumps, full page HTML capture, or inline screenshot data in model-visible context by default.
- Guaranteed source locations for every framework or production build.

## Requirements

### Requirement: Capability is plugin-managed and selectable

The system MUST register Web Annotations through the plugin registry and capability catalog rather than exposing it as an always-on core tool.

#### Acceptance

- The capability catalog identifies the Web Annotations plugin and its native tool package with plugin metadata.
- Profiles that do not select the package omit Web Annotation tools.
- Profiles that select the package expose the registered native tools during runtime assembly.

### Requirement: Annotations are session-scoped

The system MUST keep annotations scoped to Pibo Sessions in the app context context.

#### Acceptance

- Listing annotations for one session does not return another session's records.
- Tools and APIs derive session and room context from authenticated/runtime context, not model or overlay input.
- Binding removal or target cleanup does not delete historical annotations.

### Requirement: Browser target binding is explicit

The system MUST inject an overlay only into a target selected by the user through Chat Web or an authenticated API/CLI flow.

#### Acceptance

- URL annotation creates or attaches a CDP target and stores a binding before injection.
- Existing-target annotation requires a chosen target id.
- Failed target creation, attach, or injection returns a concise error and does not silently bind another target.
- Target close or reload becomes a recoverable binding state.

### Requirement: Overlay payloads are bounded

The system MUST treat page-derived data as untrusted and bounded.

#### Acceptance

- Note, selector, DOM path, text, HTML hint, class summary, accessibility, source hints, thread messages, and attachment counts have enforced limits.
- Prompt/UI/tool serializers truncate and redact secret-like text where appropriate.
- Screenshot artifacts are references, not base64 strings in prompt context.

### Requirement: Chat Web attachments are explicit

Chat Web MUST let users decide which session annotations are attached to a message.

#### Acceptance

- Current-session annotations appear in an empty/loading/error/populated UI state.
- Attach/detach state is separate from composer text and clears after send or explicit clear.
- Sent messages persist attachment references or normalized copies and render bounded model-visible context.
- Stale or unauthorized annotation ids are revalidated before send.

### Requirement: Agent tools manage lifecycle

Selected agents MUST be able to inspect and update annotation state without using Chat Web.

#### Acceptance

- `web_annotations_list` and `web_annotations_get` return authorized bounded outputs.
- `web_annotations_acknowledge`, `web_annotations_resolve`, and `web_annotations_dismiss` enforce valid status updates.
- `web_annotations_watch` uses a bounded wait/long-poll and reports timeout without error.

## Debug CLI Boundary

Optional `pibo debug web` annotation helpers may be added after the store/API exists. If added, they MUST follow progressive discovery: each help level lists only immediate annotation actions and points to deeper `list`, `show`, `start`, `resolve`, or `guide` commands as needed. CLI helpers MUST reuse the Web Annotation binding and annotation store; they MUST NOT create a separate persistence path or tool silo.

V1 implementation work may defer CLI helpers while still completing the Chat Web, API, overlay, and native tool flow.

## Security and Privacy

- Injection requires explicit user action.
- Server-side code derives session/room context from authenticated session or server-created binding token.
- Overlay-submitted controller, session, room, or status fields are ignored or rejected unless they match the trusted binding.
- Cross-origin iframe details are represented as unavailable when they cannot be inspected.
- Model-visible blocks remain concise and omit full DOM/page dumps.

## User Flow and Operations

The canonical V1 operator guide is `docs/project/web-annotations.md`. It covers the Chat Web URL and existing-target flows, status lifecycle, source-hint confidence, target reload/close recovery, privacy behavior, common errors, and V1 non-goals.

## Validation

Before production deployment, validation MUST include Docker worker typecheck, focused store/API/tool/UI tests, browser/CDP overlay checks, shared session visibility, payload-limit and redaction tests, dev gateway deployment, and explicit production approval.

Browser fixtures live in `test/fixtures/web-annotations/`. After building, run `node scripts/validate-web-annotations-browser.mjs` in the Docker worker to verify target open/attach, overlay injection, annotation creation, reload/re-inject, attachment context rendering, and API resolution. The rollout checklist is `docs/project/web-annotations-rollout-checklist.md`.
