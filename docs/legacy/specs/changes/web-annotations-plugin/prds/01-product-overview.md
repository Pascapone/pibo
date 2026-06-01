# PRD: Web Annotations Plugin — Product Overview

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/web-annotation-feedback-tools-agentation-open-design.md`

## 1. Executive Summary

- **Problem Statement**: Frontend feedback in Pibo often arrives as vague text or screenshots, forcing the agent to infer the intended DOM node, source component, and desired change. This slows implementation and increases the risk of changing the wrong UI element.
- **Proposed Solution**: Add a plugin-based Web Annotations workflow that lets a user mark a live browser element or visual target from Chat Web, persist a structured session-scoped annotation, attach it to a message, and expose it to selected agents through native tools.
- **Success Criteria**:
  - SC-01: From an active Chat Web session, a user can annotate a `localhost` page without changing the target app source.
  - SC-02: The annotation appears in the originating Pibo Session and is not visible to other owner scopes or unrelated sessions.
  - SC-03: A selected agent can list, inspect, acknowledge, resolve, and dismiss annotations through native tools.
  - SC-04: A user can attach at least one annotation to a message, and the model receives concise structured context containing note, URL, target kind, label, selector or fallback, position, and source hints when available.
  - SC-05: Overlay injection, payload capture, and prompt rendering avoid full DOM dumps, unbounded text, and inline screenshot data by default.

## 2. User Experience & Functionality

- **User Personas**:
  - Frontend product user who can see the exact UI issue but does not know code structure.
  - AI coding agent implementing UI changes from a Pibo Session.
  - Human operator or developer using Chat Web with local dev pages and Docker worker previews.
  - Plugin/profile maintainer deciding which agents should receive annotation tools.
  - Security-conscious maintainer reviewing what page content enters stores and prompts.

- **User Stories**:
  - As a user, I want to click `Annotate URL` in Chat Web so that I can mark the UI element I mean instead of describing it vaguely.
  - As a user, I want to attach an existing browser target to my current session so that I can annotate a page that is already open.
  - As an agent, I want structured annotation metadata so that I can find the DOM node, source hint, and user note without guessing.
  - As an agent, I want to update annotation status so that the user can see which marks are acknowledged, being applied, resolved, dismissed, or need review.
  - As a maintainer, I want Web Annotations to be a selectable plugin capability so that not every profile receives the tools.

- **Acceptance Criteria**:
  - Chat Web exposes URL annotation and existing-target attachment only when an active Pibo Session and Room context exists.
  - A browser overlay can create an element annotation with a note and at least one non-element fallback target kind (`pin`, `region`, or `visual`).
  - Persisted annotation records include owner scope, Pibo Session ID, Room ID when available, status, created timestamp, URL, target kind, note, viewport, and target metadata.
  - Chat Web shows open annotations for the active session and lets the user attach/detach them before sending.
  - Attached annotations are rendered into a bounded model-visible block and remain inspectable as persistent records after the message sends.
  - Profiles can include or omit the `web-annotation-agent-tools` package.
  - The feature can be validated in a Docker compute worker before dev gateway deployment.

- **Ralph Work Package Derivation**:
  - `US-001`: finalize the V1 scope matrix and PRD dependency order.
  - `US-002`: add or update capability documentation for Web Annotations.
  - `US-003`: document progressive debug-web CLI expectations if optional CLI commands are implemented.
  - `US-004`: add a rollout checklist for Docker worker, dev gateway, privacy, and browser validation.

- **Non-Goals**:
  - Chrome Extension distribution in V1.
  - Automatic source-code edits directly from overlay clicks.
  - Guaranteed source mapping for every web framework or production build.
  - Mandatory `data-pibo-id` or `data-testid` churn across all Pibo UI components.
  - Public sharing links or cross-user collaboration outside local/session scope.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Native tools: `web_annotations_list`, `web_annotations_get`, `web_annotations_watch`, `web_annotations_acknowledge`, `web_annotations_resolve`, and `web_annotations_dismiss`.
  - Optional later tool: `web_annotations_reply` for agent/user thread messages.
  - Tool calls must be owner-scope aware and session-scoped by default.
  - Watch behavior must integrate with Pibo run-control patterns if it blocks beyond a short bounded wait.

- **Evaluation Strategy**:
  - Agent workflow fixture: create two annotations in one session, attach one to a message, and verify an agent tool can list/get/resolve it.
  - Isolation fixture: create annotations under two sessions and two owner scopes, then verify cross-session and cross-owner reads fail or return empty results.
  - Prompt safety fixture: seed large text/html/screenshot references and verify model-visible attachment rendering is bounded and redacted.
  - Browser fixture: annotate a simple static HTML page and a React dev page in a Docker worker.

## 4. Technical Specifications

- **Architecture Overview**:
  - A plugin registers the Web Annotations capability, native tools, same-origin API endpoints, and Chat Web UI hooks.
  - Chat Web creates a session binding for a URL or selected CDP target. The server stores binding metadata and injects a runtime overlay into only that selected target.
  - The overlay captures target metadata and submits annotations through a binding-token or authenticated API. The server derives owner/session/room from the binding, not from untrusted overlay fields.
  - The store persists annotations and status/thread updates. Chat Web and agent tools read from the same store.
  - Message sending can attach annotation references or normalized copies and render a concise model-visible block.

- **Integration Points**:
  - Plugin registry and capability catalog for selectable tools.
  - Runtime assembly/profile selection for exposing native tools.
  - Chat Web session/room context, composer, event stream/read model, and message send path.
  - Browser Use/CDP helpers and existing `pibo debug web` target discovery patterns.
  - Pibo owner-scope/session access checks and auth service.

- **Security & Privacy**:
  - Injection requires explicit user action and a selected target or URL.
  - APIs enforce owner scope and session access server-side.
  - Payloads are schema validated, size-limited, and sanitized before storage and prompt rendering.
  - Full page HTML, large text bodies, secrets, and inline screenshot data are excluded from default model-visible context.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: store, plugin registration, basic list/get/status tools, CDP injection into a selected target, element/pin annotation, and CLI or API export for validation.
  - V1: Chat Web URL/target entry points, overlay note UI, source hints, session annotation panel, explicit message attachments, lifecycle tools, security bounds, and worker browser validation.
  - v1.1: region/visual screenshot polish, reply threads, yielded watch loop, stronger React/LocatorJS source enrichment, and optional progressive debug CLI helpers.
  - v2.0: extension or app-embedded SDK path, pod/stroke multi-selection, richer review states, and optional source instrumentation packages.

- **Technical Risks**:
  - CDP may be unavailable or target pages may close/reload; mitigate with recoverable binding states and re-inject.
  - Overlay event handlers may interfere with target app interaction; mitigate with explicit active/inactive mode and easy stop.
  - Source hints may be absent; mitigate by preserving DOM selector/path/text/bounding-box fallbacks.
  - Annotation payloads may include sensitive UI data; mitigate with bounded capture, sanitization, and concise prompt rendering.
  - Feature surface can sprawl across plugin, debug CLI, Chat Web, and tools; mitigate by shipping store and tools first, then CDP and UI, with strict V1 scope.
