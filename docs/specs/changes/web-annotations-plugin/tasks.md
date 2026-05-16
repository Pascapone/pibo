# Tasks: Web Annotations Plugin

## Phase 0: Discovery and Boundaries

- [ ] T-001: Review Pibo plugin registration in `src/plugins/registry.ts`, `src/plugins/types.ts`, and existing plugin files.
- [ ] T-002: Review CDP target and debug web code in `src/debug/web.ts` and `src/tools/browser-use-cdp.ts` for reusable connection helpers.
- [ ] T-003: Choose the first persistence location for bindings and annotations: existing Pibo store tables or plugin-owned SQLite tables.
- [ ] T-004: Confirm owner-scope and session access checks for Chat Web API calls.
- [ ] T-005: Inspect LocatorJS metadata shape and decide which attributes or globals count as source hints in V1.

## Phase 1: Data Model and Store

- [ ] T-006: Add TypeScript types for web annotation records, bindings, targets, source hints, statuses, and thread messages.
- [ ] T-007: Add persistent storage for annotation bindings keyed by owner scope, Pibo Session ID, Room ID, and CDP target id.
- [ ] T-008: Add persistent storage for annotations keyed by owner scope, Pibo Session ID, status, and created time.
- [ ] T-009: Add store operations: create binding, list bindings, remove binding, create annotation, list annotations, get annotation, patch status, add thread message.
- [ ] T-010: Add tests for session isolation, owner-scope isolation, status transitions, and binding removal without annotation deletion.

## Phase 2: Plugin and Agent Tools

- [ ] T-011: Add a `pibo.web-annotations` plugin module that registers the Web Annotation tools.
- [ ] T-012: Add `web_annotations_list` for listing annotations in the current or explicit session.
- [ ] T-013: Add `web_annotations_get` for retrieving one annotation with full target metadata.
- [ ] T-014: Add `web_annotations_acknowledge`, `web_annotations_resolve`, and `web_annotations_dismiss` status tools.
- [ ] T-015: Add `web_annotations_watch` as either bounded synchronous wait or yieldable tool integrated with Pibo run control.
- [ ] T-016: Add tool tests for authorized access, unauthorized access, empty lists, missing annotation ids, and valid lifecycle updates.
- [ ] T-017: Ensure the capability catalog shows the tools with plugin metadata.

## Phase 3: Annotation API

- [ ] T-018: Add authenticated API endpoint to create a binding for a URL or existing target.
- [ ] T-019: Add authenticated API endpoint to list bindings for a session.
- [ ] T-020: Add authenticated API endpoint to inject or re-inject an overlay for a binding.
- [ ] T-021: Add authenticated or binding-token API endpoint for overlay annotation submissions.
- [ ] T-022: Add API endpoints to list, read, patch, and thread annotations.
- [ ] T-023: Add payload validation and size limits for note, text, HTML hint, selector, source hints, and screenshot references.
- [ ] T-024: Add API tests for auth, invalid payloads, malformed binding tokens, target-not-found errors, and session scoping.

## Phase 4: CDP Target Binding and Overlay Injection

- [ ] T-025: Extract or add reusable CDP client helpers needed outside `src/debug/web.ts`.
- [ ] T-026: Implement opening a URL in a Pibo-managed browser target or attaching to an existing target.
- [ ] T-027: Implement overlay injection for the selected target only.
- [ ] T-028: Implement overlay stop and re-inject operations.
- [ ] T-029: Ensure target close or page reload is reported as a recoverable binding state.
- [ ] T-030: Add validation with a local HTML page and a local React dev page.

## Phase 5: Overlay Runtime

- [ ] T-031: Build the injected overlay script with explicit active/inactive annotation mode.
- [ ] T-032: Implement hover outline and click-to-annotate for visible elements.
- [ ] T-033: Implement note entry, submit, cancel, and stop controls.
- [ ] T-034: Capture target metadata: selector, DOM path, full DOM path, tag, classes, text, selected text, HTML hint, accessibility, bounding box, viewport, and URL.
- [ ] T-035: Capture source hints from known stable attributes, LocatorJS-compatible data, React dev metadata when available, and fallback DOM metadata.
- [ ] T-036: Implement region or free-pin annotation if element selection is not enough for V1 acceptance.
- [ ] T-037: Throttle hover/target discovery to avoid visible page slowdown.
- [ ] T-038: Add tests or browser checks for element click, missing selector fallback, Shadow DOM where practical, reload and re-inject.

## Phase 6: Chat Web UI

- [ ] T-039: Add Chat Web action to annotate a URL from the current session.
- [ ] T-040: Add Chat Web action to attach an existing CDP target to the current session.
- [ ] T-041: Add UI for current session annotations with status, URL, label, note, and creation time.
- [ ] T-042: Add attach/detach controls so selected annotations can be sent with the next message.
- [ ] T-043: Add outgoing message support for web annotation attachments or references.
- [ ] T-044: Render concise attached annotation context into model-visible message content.
- [ ] T-045: Update annotation status to `attached` or equivalent when a message sends with selected annotations.
- [ ] T-046: Add UI tests or browser checks for empty state, annotate URL flow, attach existing target flow, attachment chip behavior, and sent message payload.

## Phase 7: Source-Aware Pibo Development Follow-Up

- [ ] T-047: Decide whether to add LocatorJS setup to Pibo Web development in this change or a follow-up change.
- [ ] T-048: If included, add dev-only LocatorJS-compatible source metadata for Pibo React pages.
- [ ] T-049: Add a small convention for optional semantic IDs on important Pibo UI components without requiring IDs everywhere.
- [ ] T-050: Add lint or test guidance only if it proves useful; avoid broad mandatory ID churn in V1.

## Phase 8: Validation and Deployment

- [ ] T-051: Implement and test inside a Docker compute worker.
- [ ] T-052: Run `npm run typecheck`.
- [ ] T-053: Run relevant unit tests for store, API, tools, and Chat Web UI.
- [ ] T-054: Validate annotation flow in the worker browser using worker web and CDP ports.
- [ ] T-055: Validate with a local Pibo Chat Web page and a simple external local React page.
- [ ] T-056: Deploy to dev web gateway with `./scripts/deploy-web-dev.sh` after worker validation.
- [ ] T-057: Validate dev gateway manually with an authenticated Chat Web session.
- [ ] T-058: Deploy production only after user approval.

## Acceptance Checklist

- [ ] AC-001: Web Annotations appears as a plugin-owned capability with selectable tools.
- [ ] AC-002: Chat Web can start annotation for a URL from the active session.
- [ ] AC-003: Chat Web can bind an existing CDP target to the active session.
- [ ] AC-004: Overlay injection does not require target app source changes.
- [ ] AC-005: User can create an element annotation with a note.
- [ ] AC-006: Annotation persists with session id, room id, URL, target metadata, note, and status.
- [ ] AC-007: Source hints are captured when available and absent when unavailable.
- [ ] AC-008: Chat Web shows open annotations for the current session.
- [ ] AC-009: User can attach annotations to a message.
- [ ] AC-010: Agent tools can list, inspect, acknowledge, resolve, and dismiss annotations.
- [ ] AC-011: Unauthorized sessions cannot read or modify another owner's annotations.
- [ ] AC-012: Page reload or target close produces a recoverable state, not data loss.
