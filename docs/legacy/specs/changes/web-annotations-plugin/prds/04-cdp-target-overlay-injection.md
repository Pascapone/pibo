# PRD: Web Annotations Plugin — CDP Target Binding and Overlay Injection

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/web-annotation-feedback-tools-agentation-open-design.md`

## 1. Executive Summary

- **Problem Statement**: The user needs to annotate live web pages without changing the target app source. Pibo already has CDP-based browser debugging, but no session-bound flow for opening or attaching a target and injecting an annotation overlay.
- **Proposed Solution**: Add a CDP target binding service and injection path that opens or attaches to an explicitly selected browser target, records the binding for the current Pibo Session/Room, injects a runtime-only overlay, and supports stop/re-inject after reloads.
- **Success Criteria**:
  - SC-01: Chat Web can request annotation for a URL and receive a stored binding plus injected overlay.
  - SC-02: Chat Web can list reachable CDP targets and bind one selected target to the current session.
  - SC-03: Injection never occurs for targets the user did not select.
  - SC-04: Page reload or target close leaves annotations intact and reports a recoverable binding state.
  - SC-05: A simple local HTML page and a React dev page can receive, stop, and re-inject the overlay in a Docker worker.

## 2. User Experience & Functionality

- **User Personas**:
  - User annotating a local dev app from Chat Web.
  - Browser/CDP engineer reusing Pibo debug web infrastructure.
  - Chat Web engineer calling target/binding APIs.
  - Operator validating worker-local previews.

- **User Stories**:
  - As a user, I want to enter a URL in Chat Web so that Pibo opens or attaches a browser target and turns on annotation mode.
  - As a user, I want to choose an already-open browser target so that I do not lose page state.
  - As a user, I want to stop annotation mode so that the target page returns to normal interaction.
  - As a user, I want to re-inject after a page reload so that I can continue annotating the same session.
  - As an operator, I want target errors to be concise and recoverable so that failed attachment does not corrupt session state.

- **Acceptance Criteria**:
  - Add or reuse CDP helpers for target listing, URL opening, attaching, runtime evaluation, and target lifecycle inspection.
  - Create binding API/service operation for URL annotation with `piboSessionId`, `roomId`, URL, target id when known, title when available, owner scope, and created time.
  - Create binding API/service operation for attaching an existing target selected by id or WebSocket endpoint.
  - Implement overlay injection for the selected binding only and record injection state/timestamps.
  - Implement stop/remove overlay command where possible and preserve binding history.
  - Implement re-inject for an existing binding after reload or overlay disappearance.
  - Report target-not-found, CDP-unavailable, injection-failed, target-closed, and reload-needed states clearly.
  - Add local validation with static HTML and React dev pages.

- **Ralph Work Package Derivation**:
  - `US-001`: extract/reuse CDP target helpers for annotation flows.
  - `US-002`: implement URL open/bind service and API.
  - `US-003`: implement existing target attach/bind service and API.
  - `US-004`: implement overlay inject/stop/re-inject operations.
  - `US-005`: add optional progressive debug-web CLI helpers if approved by implementation scope.
  - `US-006`: add CDP lifecycle tests or browser validations.

- **Non-Goals**:
  - Browser extension support.
  - Injection into arbitrary non-CDP browsers.
  - Guaranteed inspection of cross-origin iframe internals.
  - Full overlay UI implementation beyond loading/removing the runtime bundle.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Agent native tools do not need direct CDP injection access in V1. Injection is initiated by Chat Web/API or optional debug CLI.
  - If CLI helpers are added, they must follow progressive discovery and write to the same binding/annotation store.

- **Evaluation Strategy**:
  - Browser automation check opens a local page, creates a binding, injects overlay, verifies a marker/global exists, stops overlay, then re-injects.
  - Target selection test ensures injection fails or is skipped if the target id does not match the stored binding.
  - Reload test verifies binding remains and re-injection succeeds after page reload.

## 4. Technical Specifications

- **Architecture Overview**:
  - Chat Web calls same-origin APIs to create a binding for a URL or existing CDP target.
  - A CDP service opens or attaches the target, then injects a bundled overlay script with binding token/config.
  - The overlay submits annotations through an API tied to the binding token.
  - Binding state records target id, URL, title, injection status, last injection time, and recoverable error state.

- **Integration Points**:
  - Existing `pibo debug web` target discovery and Browser Use/CDP infrastructure.
  - Web Annotation store/binding service.
  - Chat Web APIs and auth.
  - Optional CLI command registration under `pibo debug web`.

- **Security & Privacy**:
  - Injection only runs after authenticated user action.
  - Binding token is scoped to one binding/session and cannot change owner/session fields.
  - CDP target list should expose enough title/URL for selection but not unbounded page content.
  - Stop/re-inject endpoints enforce owner/session access.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: inject marker and receive a simple annotation payload on a selected target.
  - V1: URL open, existing target attach, stop, re-inject, recoverable states, validation pages.
  - v1.1: persistent target watches, richer target lifecycle events, and optional debug CLI export/list/watch helpers.

- **Technical Risks**:
  - CDP connection helper duplication; mitigate by extracting shared helpers rather than copying debug code.
  - Overlay injection can be lost on reload; mitigate with visible re-inject state and binding persistence.
  - Target selection can be confusing if multiple pages share a URL; mitigate by showing title, URL, and target id.
  - Cross-origin iframe restrictions can surprise users; represent unavailable iframe details explicitly instead of failing the whole annotation.
