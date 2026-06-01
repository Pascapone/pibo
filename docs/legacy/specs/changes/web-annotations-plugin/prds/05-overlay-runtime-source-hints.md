# PRD: Web Annotations Plugin — Overlay Runtime and Source Hints

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `../../../../reports/web-annotation-feedback-tools-agentation-open-design.md`

## 1. Executive Summary

- **Problem Statement**: A browser annotation is only useful to an agent if it captures both the user's note and enough target identity to find the relevant UI code. CSS selectors alone are fragile, while full DOM dumps are unsafe and noisy.
- **Proposed Solution**: Build a small injected overlay that supports explicit annotation mode, element and fallback target capture, note entry, bounded metadata extraction, layered source hints, and sanitized submission to Pibo.
- **Success Criteria**:
  - SC-01: The overlay can create an element annotation with note, label, selector or fallback, DOM path, text snippet, HTML hint, bounding box, viewport, and URL.
  - SC-02: The overlay can create at least one non-element fallback annotation (`pin`, `region`, or `visual`).
  - SC-03: Source hints are captured when stable IDs, LocatorJS-compatible metadata, React/dev metadata, or JSX source hints are present, and omitted cleanly when absent.
  - SC-04: Hover/click handling does not visibly slow a normal local dev page.
  - SC-05: Submitted payloads are bounded and do not include full page HTML by default.

## 2. User Experience & Functionality

- **User Personas**:
  - User selecting a visible UI element and writing a note.
  - Agent using target metadata to locate code.
  - Frontend engineer debugging selector/source hint quality.
  - Security reviewer limiting captured page content.

- **User Stories**:
  - As a user, I want to toggle annotation mode so that normal page interaction is not blocked until I choose to mark something.
  - As a user, I want hover outlines and click-to-annotate so that I know exactly what target will be captured.
  - As a user, I want a fallback pin or region when no DOM element describes the visual issue.
  - As an agent, I want stable IDs and source hints when available so that I can locate the component faster than by DOM path alone.
  - As a maintainer, I want text and HTML excerpts capped so that annotations do not leak whole pages into prompts.

- **Acceptance Criteria**:
  - Overlay has active/inactive mode, hover outline, note input, submit, cancel, and stop controls.
  - Element capture collects best selector, DOM path, full DOM path where useful, tag name, class summary, text snippet, selected text when applicable, HTML opening-tag hint, accessibility hints, bounding box, viewport, URL, and page title.
  - Fallback capture supports at least pin coordinates or a drag region; region/visual targets can include screenshot artifact reference if the capture path exists.
  - Source hint capture checks explicit IDs/attributes first, then LocatorJS-compatible metadata, then React/Fiber or JSX dev metadata, then DOM fallback with confidence labels.
  - Overlay handles Shadow DOM best-effort and marks cross-origin iframe details as unavailable.
  - Hover/target discovery is throttled and disabled when annotation mode is inactive.
  - Payload size caps apply before submission for note, text snippets, HTML hints, class summaries, source raw data, and accessibility text.
  - Browser checks cover element click, missing selector fallback, fallback pin/region, reload/re-inject compatibility, and source-hint absence.

- **Ralph Work Package Derivation**:
  - `US-001`: build overlay shell and active/inactive controls.
  - `US-002`: implement element hover/click selection and note submission.
  - `US-003`: implement target metadata extraction and selector fallbacks.
  - `US-004`: implement layered source hint extraction.
  - `US-005`: implement pin/region fallback target.
  - `US-006`: add throttling, bounds, sanitization, and browser checks.

- **Non-Goals**:
  - Full screenshot drawing and pod/stroke multi-select in the first overlay pass.
  - Perfect source locations in production builds.
  - Capturing full DOM trees, CSSOM dumps, or network data.
  - Editing DOM styles or source code from the overlay.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Agent tools consume the overlay's stored metadata through the store; no separate browser-only tool contract is needed.
  - Metadata must be structured enough for agents to search code by source hint, stable ID, label/text, selector, and class/tag fallback.

- **Evaluation Strategy**:
  - Fixture page with stable attributes verifies high-confidence hints.
  - React dev fixture verifies medium-confidence component/source hints where available.
  - Plain HTML fixture verifies DOM fallback and missing-source behavior.
  - Oversized text fixture verifies truncation before storage and prompt rendering.

## 4. Technical Specifications

- **Architecture Overview**:
  - The overlay script is injected through CDP with binding configuration and endpoint/token details.
  - Runtime event listeners operate only when annotation mode is active.
  - Metadata extraction returns a normalized target object matching shared Web Annotation types.
  - Submission posts normalized payloads to the API; the server validates and stores them.

- **Integration Points**:
  - CDP injection bundle from PRD 04.
  - Web Annotation API and store from PRD 02.
  - Optional screenshot artifact service if region/visual capture stores images.
  - Future Pibo or LocatorJS instrumentation.

- **Security & Privacy**:
  - Treat page data as untrusted input.
  - Escape/sanitize all text before display in overlay, Chat Web, CLI, or prompts.
  - Do not send cookies, local storage, full HTML, or arbitrary globals.
  - Redact common secret-like values in text snippets and HTML hints before prompt rendering.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: element selection, note, selector/path/text/bounding box, submit.
  - V1: source hints, pin/region fallback, bounded payloads, throttle, reload-safe re-inject compatibility.
  - v1.1: screenshot draw overlay, pod/stroke selection, richer accessibility summary, framework-specific source plugins.

- **Technical Risks**:
  - React Fiber/source internals are unstable; mitigate by marking confidence and treating them as hints only.
  - Selector generation may choose brittle paths; mitigate by preserving multiple identity strategies.
  - Overlay CSS may clash with target pages; mitigate with prefixed class names, inline minimal styles, and high z-index isolation.
  - Large DOM/text pages may make hover expensive; mitigate with event-target-only extraction and throttled detail collection.
