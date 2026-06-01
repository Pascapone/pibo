# PRD: Web Annotations Plugin — Store and Session Binding

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Web annotations need durable, session-scoped records before Chat Web, overlay injection, and agent tools can safely coordinate on the same data. Without a typed store and binding model, overlay payloads could be orphaned, mixed across sessions, or trusted incorrectly.
- **Proposed Solution**: Add typed Web Annotation and binding records with durable storage, owner-scope isolation, Pibo Session/Room binding, status transitions, and thread/update operations shared by APIs, Chat Web, and agent tools.
- **Success Criteria**:
  - SC-01: Bindings and annotations survive gateway restart and remain queryable by Pibo Session ID.
  - SC-02: Listing annotations for one session never returns another session's records.
  - SC-03: Cross-owner reads and writes are rejected or return no data.
  - SC-04: Status updates are persisted with timestamps and cannot create invalid lifecycle states.
  - SC-05: Removing a binding does not delete historical annotations.

## 2. User Experience & Functionality

- **User Personas**:
  - Backend engineer implementing the shared data layer.
  - Chat Web engineer listing session annotations.
  - Agent tool engineer implementing list/get/status tools.
  - Security reviewer verifying owner/session isolation.

- **User Stories**:
  - As a backend engineer, I want typed annotation records so that every UI/API/tool path uses one contract.
  - As a user, I want annotations tied to my current Pibo Session so that other sessions do not show unrelated marks.
  - As an agent, I want stable annotation IDs and statuses so that I can inspect and resolve work reliably.
  - As a maintainer, I want bindings separated from annotations so that target cleanup does not erase feedback history.

- **Acceptance Criteria**:
  - Add TypeScript types for annotation statuses, target kinds, bindings, targets, source hints, viewport, bounding box, and thread messages.
  - Add durable storage for bindings keyed by owner scope, Pibo Session ID, Room ID, CDP target id or URL, and binding id.
  - Add durable storage for annotations keyed by owner scope, Pibo Session ID, status, created timestamp, and annotation id.
  - Store operations support create/list/get/remove binding; create/list/get annotation; patch status; patch binding state; add thread message.
  - Store APIs derive or require owner scope and session id from trusted callers and never trust overlay-supplied ownership.
  - Tests cover session isolation, owner-scope isolation, valid/invalid status updates, binding removal without annotation deletion, and newest-first ordering.

- **Ralph Work Package Derivation**:
  - `US-001`: add shared Web Annotation domain types.
  - `US-002`: add durable binding schema/store operations.
  - `US-003`: add durable annotation schema/store operations.
  - `US-004`: add lifecycle/status and thread operations.
  - `US-005`: add isolation and lifecycle tests.

- **Non-Goals**:
  - Chat Web UI implementation.
  - CDP target opening or overlay injection.
  - Agent tool registration.
  - Public share links or remote sync.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Store methods must support tool-friendly queries: list by session/status/limit, get by id, update status with summary, and add a thread message.
  - Store outputs must be serializable without including binary screenshots or huge raw fields.

- **Evaluation Strategy**:
  - Unit tests seed multiple owner scopes and sessions and verify tool-like queries only return authorized records.
  - Serialization tests verify records with large optional fields retain references and truncation metadata rather than inline content.

## 4. Technical Specifications

- **Architecture Overview**:
  - Introduce a Web Annotation store/service boundary used by APIs, Chat Web loaders/actions, native tools, and debug CLI helpers if added.
  - Bindings represent active or historical relationships between a Pibo Session/Room and a browser target. Annotations reference bindings when available but remain readable after binding removal.
  - Annotations carry status lifecycle fields, target metadata, optional screenshot artifact reference, and optional thread messages.

- **Integration Points**:
  - Pibo data path / existing SQLite infrastructure or plugin-owned SQLite tables.
  - Pibo Session Store for validating Pibo Session ID, Room ID metadata, and owner scope.
  - Chat Web auth/session access checks.
  - Future API endpoint and tool handlers.

- **Security & Privacy**:
  - Store writes require trusted owner scope.
  - Store-level methods should make unauthorized reads hard by requiring owner scope in all list/get/update paths.
  - Text, HTML hints, source hints, and thread content need schema-level maximum lengths.
  - Screenshot fields store artifact references only.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: types, schema, create/list/get annotations, and basic status update.
  - V1: bindings, binding states, thread messages, indexes, limits, isolation tests, and migration idempotency.
  - v1.1: retention/prune policies if annotation volume grows.

- **Technical Risks**:
  - Choosing a storage location incompatible with gateway deployment; mitigate by following existing Pibo store patterns and keeping migrations additive/idempotent.
  - Missing indexes could make session lists slow; mitigate with owner/session/status/created indexes.
  - Overly permissive JSON blobs could hide unbounded content; mitigate with validation and explicit field caps before insert.
