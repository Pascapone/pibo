# PRD: Web Annotations Plugin — Plugin Capability and Agent Tools

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Agents need a structured way to discover and manage user-created web annotations, but these tools should not be exposed to every profile by default. Without plugin registration and capability catalog integration, Web Annotations would become an unselectable core feature or a disconnected debug helper.
- **Proposed Solution**: Implement Web Annotations as a plugin-owned capability that registers a selectable native tool package for listing, reading, watching, acknowledging, resolving, and dismissing annotations.
- **Success Criteria**:
  - SC-01: The capability catalog lists the Web Annotations plugin and tool package with plugin metadata.
  - SC-02: A profile without the package does not expose Web Annotation tools.
  - SC-03: A profile with the package exposes all V1 tools to routed runtime sessions.
  - SC-04: Tool access is owner-scope and session aware.
  - SC-05: Tool tests cover empty lists, authorized reads, unauthorized reads, missing IDs, and valid lifecycle updates.

## 2. User Experience & Functionality

- **User Personas**:
  - Agent profile author selecting capabilities.
  - AI coding agent receiving and resolving web feedback.
  - Runtime engineer maintaining native tool registration.
  - Security reviewer checking tool authorization.

- **User Stories**:
  - As a profile author, I want Web Annotation tools to be selectable so that only relevant agents receive them.
  - As an agent, I want to list open annotations for my current Pibo Session so that I can see feedback without relying on pasted text.
  - As an agent, I want to inspect full target metadata for one annotation so that I can find the affected component or DOM node.
  - As an agent, I want to acknowledge, resolve, or dismiss annotations so that work state is visible to the user.
  - As an agent, I want to wait briefly for new annotations so that I can support an interactive feedback loop.

- **Acceptance Criteria**:
  - Add a plugin module such as `pibo.web-annotations` or equivalent registered through existing plugin registry patterns.
  - Register a native tool package named `web-annotation-agent-tools` or equivalent.
  - Implement `web_annotations_list` with current-session default, explicit session id option where authorized, status filter, limit, and newest-first output.
  - Implement `web_annotations_get` returning full target metadata for one authorized annotation.
  - Implement `web_annotations_acknowledge`, `web_annotations_resolve`, and `web_annotations_dismiss` with optional summary/reason fields and persisted status updates.
  - Implement `web_annotations_watch` as a bounded wait or long-poll; if it becomes long-running, integrate with yielded-run control instead of a custom run lifecycle.
  - Add tool tests for authorization, empty result, limit handling, missing id, status transitions, and session default behavior.

- **Ralph Work Package Derivation**:
  - `US-001`: add plugin skeleton and capability catalog registration.
  - `US-002`: implement list/get tools.
  - `US-003`: implement lifecycle update tools.
  - `US-004`: implement bounded watch tool.
  - `US-005`: add capability/runtime assembly and authorization tests.

- **Non-Goals**:
  - Chat Web UI surfaces.
  - Overlay runtime implementation.
  - Automatic code modification from tool status changes.
  - External MCP server compatibility in V1.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Tool names: `web_annotations_list`, `web_annotations_get`, `web_annotations_watch`, `web_annotations_acknowledge`, `web_annotations_resolve`, `web_annotations_dismiss`.
  - Tool outputs must be compact by default and include IDs needed for next calls.
  - Detail output may include full target metadata but must still honor store-level size caps.
  - Tools require current Pibo Session context or explicit authorized session id.

- **Evaluation Strategy**:
  - Runtime assembly test verifies selected profile exposes tools and unselected profile does not.
  - Tool authorization test verifies owner-scope mismatch fails.
  - Agent drill-down test starts with `list`, calls `get`, then `resolve` and confirms store status.

## 4. Technical Specifications

- **Architecture Overview**:
  - Plugin registration contributes capability metadata and native tool definitions.
  - Tool handlers call the Web Annotation store/service rather than API routes.
  - Tool context resolution maps current runtime/session context to Pibo Session ID and owner scope.
  - Watch uses store polling or event notification if an event bus is already available; V1 should remain bounded.

- **Integration Points**:
  - Plugin registry and capability catalog.
  - Runtime/profile assembly and native tool selection.
  - Pibo Session and owner-scope context available to routed runtimes.
  - Run-control tools if watch becomes yieldable.

- **Security & Privacy**:
  - Tools must not accept owner scope from model-provided input.
  - Explicit session id access must verify the caller owns or can access that session.
  - List outputs should omit long HTML/text fields and provide a next-step `get` path.
  - Resolve/dismiss summaries are stored as thread/status metadata and length-limited.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: plugin registration, `list`, `get`, `resolve`.
  - V1: full status tools, bounded watch, capability catalog metadata, profile selection tests.
  - v1.1: reply/thread tool and yielded watch loop if interactive workflows need it.

- **Technical Risks**:
  - Tool context may lack current Pibo Session ID in some profile paths; mitigate by requiring explicit authorized session id with clear errors.
  - Watch may block model turns if implemented synchronously; mitigate with bounded timeout and run-control integration for long waits.
  - Capability names may drift from docs; mitigate with tests and README updates when final names differ.
