# PRD: Web Annotations Plugin — Chat Web Attachments and Message Context

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Creating annotations is not enough; users need to see them in the active Chat Web session and deliberately send them with the next message. Without message attachment support, annotations become a side channel that the agent may miss.
- **Proposed Solution**: Add Chat Web entry points, a session annotation surface, composer attachment chips, outgoing message attachment references, and concise model-visible rendering for attached web annotations.
- **Success Criteria**:
  - SC-01: Open annotations for the active Pibo Session appear in Chat Web with status, URL, target label/kind, note, and creation time.
  - SC-02: The user can attach and detach annotations before sending a message.
  - SC-03: Sending a message with annotations persists attachment references or normalized attachment data.
  - SC-04: The model-visible message includes a bounded `<attached-web-annotations>` block.
  - SC-05: The original annotation remains inspectable and its status updates to `attached` or an equivalent lifecycle state after send.

## 2. User Experience & Functionality

- **User Personas**:
  - Chat Web user giving precise frontend feedback.
  - AI coding agent receiving a message with structured UI context.
  - Chat Web engineer integrating session data and composer state.
  - QA engineer validating message payloads and live updates.

- **User Stories**:
  - As a user, I want `Annotate URL` and `Attach Browser Target` actions near relevant Chat Web controls so that I can start from the session I am discussing.
  - As a user, I want a compact list or chip strip of annotations for the current session so that I can choose what to send.
  - As a user, I want to attach multiple annotations to one message so that related UI feedback travels together.
  - As an agent, I want attached annotations rendered as structured context so that I know which UI target each comment refers to.
  - As a user, I want sent/resolved annotations to remain visible or filterable so that I can review progress.

- **Acceptance Criteria**:
  - Add Chat Web action to annotate a URL from the active session and show concise CDP/API errors.
  - Add Chat Web action to list and attach an existing CDP target with title and URL.
  - Add current-session annotation panel, drawer, or composer-adjacent chip strip with empty, loading, error, and populated states.
  - Add attach/detach behavior that stores composer-local selection until message send or cancellation.
  - Extend outgoing message payloads or metadata to include annotation attachment references or normalized attachment copies.
  - Render a model-visible block with annotation id, target kind, URL, label, selector/fallback, source hint summary, position, short text, and user note.
  - Update annotation status to `attached` after successful send and preserve record history.
  - Add browser/UI checks for empty state, URL flow, existing-target flow, attach/detach chips, sent payload, and model-visible text.

- **Ralph Work Package Derivation**:
  - `US-001`: add Chat Web annotation entry points and API wiring.
  - `US-002`: add current-session annotation list/chip UI.
  - `US-003`: implement composer attach/detach state.
  - `US-004`: extend outgoing message payload and persistence.
  - `US-005`: render bounded model-visible annotation context.
  - `US-006`: add UI tests/browser checks for annotation attachment flow.

- **Non-Goals**:
  - Full visual review dashboard.
  - Automatic attachment of every open annotation.
  - Editing annotations directly in the message composer beyond attach/detach.
  - Chat Web source-code patch application UI.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Attached annotations should also be readable through `web_annotations_get` by id after the message sends.
  - Model-visible context should be enough for an agent to choose the next tool call without listing all annotations again.

- **Evaluation Strategy**:
  - Message payload test verifies attachment references survive send and replay.
  - Prompt rendering test verifies bounded XML-style block and redaction/truncation behavior.
  - Browser check creates an annotation, attaches it, sends a message, and verifies the trace/model-visible content contains the annotation summary.

## 4. Technical Specifications

- **Architecture Overview**:
  - Chat Web queries session annotations from the Web Annotation API/store.
  - Composer state tracks selected annotation IDs separately from typed message text.
  - Message send serializes attachment references or normalized copies into the appropriate Chat Web event/message metadata.
  - Runtime input assembly appends concise model-visible annotation context for selected attachments.
  - Chat Web listens for annotation/status events or refreshes relevant queries after create/send/status updates.

- **Integration Points**:
  - Chat Web room/session routing and selected session context.
  - Chat Web API routes and auth.
  - Message composer and send mutation.
  - Chat event log/read model or equivalent message metadata path.
  - Runtime message/input assembly.

- **Security & Privacy**:
  - Users can only attach annotations from the active session/owner scope.
  - Prompt rendering must cap counts and field lengths and omit screenshot binary data.
  - HTML hints must be escaped and truncated.
  - Resolved or dismissed annotations attached from stale composer state must be revalidated at send time.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: list annotations and attach one to a message with prompt block.
  - V1: URL/target entry points, multi-attach chips, status update on send, live refresh, UI/browser checks.
  - v1.1: annotation replies, review filters, needs-review workflow, screenshot thumbnail references, and richer event timeline rendering.

- **Technical Risks**:
  - Message schema changes may affect replay; mitigate by storing references and making renderer tolerant of missing annotations.
  - Composer state can go stale; mitigate by revalidating selected IDs at send time.
  - Prompt blocks can grow too large; mitigate with max attachment count, per-field caps, and details available via tools.
  - UI placement may clutter Chat Web; mitigate with compact chips and defer larger management UI.
