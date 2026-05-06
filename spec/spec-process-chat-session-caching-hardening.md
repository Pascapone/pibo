---
title: Chat Session Caching Hardening And Browser Validation
version: 0.1
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo
tags: [process, chat, caching, browser, validation, scalability]
---

# Introduction

This specification defines the required follow-up work for Chat Web session caching. The work is not limited to adding cache entries. It must harden the end-to-end behavior so session switches are instant when data is unchanged, live updates only refresh the affected trace content, and the implementation remains extensible at the Pibo product boundary.

This document is a work order and an acceptance contract. Implementation is not complete until the browser behavior has been validated on the real Chat Web App.

## 1. Purpose & Scope

The purpose of this specification is to define the required hardening, restructuring, testing, and browser validation work for Chat Web session caching under `/apps/chat` and `/api/chat/*`.

In scope:

- Session-switch caching behavior in the Chat Web App.
- Trace loading, live trace updates, and cache reuse.
- Query invalidation rules for chat mutations.
- Backend trace caching and trace freshness contracts.
- Browser-based validation of the implemented behavior.
- Architectural cleanup required to keep the solution extensible and scalable.

Out of scope:

- New Chat Web features unrelated to session caching.
- Broad frontend redesign work.
- Moving product-boundary responsibilities into Pi Coding Agent.

## 2. Definitions

- **Chat Web App**: The same-origin Pibo web application served under `/apps/chat`.
- **Trace Pane**: The main transcript and trace rendering area for the selected Pibo Session.
- **Session Tree**: The room and session navigation UI shown next to the Trace Pane.
- **Session Cache Reuse**: Reusing previously loaded session data so returning to an unchanged session renders immediately without a full reload.
- **Trace Version**: A server-issued freshness token for one Chat Web Trace View, such as a version string or ETag.
- **Cache Invalidation Matrix**: The explicit mapping of each chat mutation to the exact query keys and cached projections that must be refreshed or patched.
- **Browser Validation**: Manual or automated verification performed through the real browser UI. CLI checks and server tests do not count as browser validation.
- **Canonical Chat URL**: The browser URL that identifies the active Chat Web App area and selected room or session.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Returning to a previously opened Pibo Session with unchanged trace data MUST render from cache immediately in the browser before any background freshness check completes.
- **REQ-002**: A newly arrived assistant message, reasoning delta, tool update, or other live trace event MUST update only the affected Trace Pane cache and MUST NOT force a full Session Tree reload.
- **REQ-003**: The Session Tree and Trace Pane MUST have separate cache ownership so live trace updates do not cause avoidable room or session navigation rerenders.
- **REQ-004**: The implementation MUST use explicit TanStack Query keys for bootstrap data, session navigation data, and trace data. Ad hoc request dedupe without query ownership is insufficient.
- **REQ-005**: The implementation MUST define and document a Cache Invalidation Matrix covering at least send message, slash command execution, session rename, session archive or restore, session delete, room rename, room archive or restore, room delete, session clone, session fork, and new session creation.
- **REQ-006**: Live updates delivered through the Chat Web SSE Stream MUST patch or invalidate only the affected cached data. Full trace re-fetch on every frame is not acceptable.
- **REQ-007**: The backend trace endpoint MUST expose a stable freshness contract, such as Trace Version or ETag, so unchanged trace requests can return a not-modified response.
- **REQ-008**: Backend trace caching MUST use a deterministic cache key derived from the selected Pibo Session and trace-shaping inputs. It MUST NOT serve stale trace content after a version change.
- **REQ-009**: The implementation MUST preserve the Pibo product boundary. Pi Coding Agent remains the source of persisted transcript content; Pibo owns web caching, read models, browser UX, invalidation, and transport behavior.
- **REQ-010**: The hardening work MUST leave the codebase more extensible than before. Session caching logic, trace loading logic, live update logic, and browser selection logic MUST have clear ownership boundaries instead of accumulating in one opaque UI hotspot.
- **REQ-011**: The hardening work MUST leave the system scalable for long sessions. The solution MUST avoid unnecessary full-tree cloning, repeated O(trace size) work on each delta, and unbounded accidental cache growth.
- **REQ-012**: The browser URL MUST remain the primary source of truth for selected room and selected Pibo Session. Caching MUST accelerate rendering and refresh behavior, not replace canonical navigation state.
- **REQ-013**: The final sign-off for this work MUST include real browser validation on the Chat Web App. Unit tests, integration tests, and CLI verification are required but are not sufficient on their own.
- **REQ-014**: Browser validation MUST cover switching from Session A to Session B and back to Session A, both when the trace is unchanged and when new trace content arrived while Session A was unfocused.
- **REQ-015**: Browser validation MUST cover live streaming while the user is viewing a session and while the user is viewing a different session, so the team can confirm that only the correct UI regions update.
- **REQ-016**: Browser validation MUST include explicit observation of loading indicators, visible flicker, trace ordering, scroll behavior, and whether the previously selected session appears instantly from cache.
- **REQ-017**: The work MUST produce or update automated tests that lock down the intended cache behavior, including unchanged trace reuse, changed trace refresh, and invalidation after supported mutations.
- **REQ-018**: The work MUST produce a short implementation note or review summary that identifies residual risks, cache limits, and future extension points.
- **CON-001**: This work MUST NOT introduce speculative abstractions that are not needed by the current Chat Web caching problem.
- **CON-002**: This work MUST NOT rely on browser-local state as the authority for freshness. Browser cache reuse must remain subordinate to server-issued trace freshness.
- **CON-003**: This work MUST NOT require full page reloads to converge browser state after normal chat mutations.
- **CON-004**: This work MUST NOT turn the backend trace cache into an unbounded hidden memory sink. If the cache is process-local and in-memory, its retention and eviction behavior MUST be explicit.
- **GUD-001**: Prefer small, named modules over expanding one large app component.
- **GUD-002**: Prefer deterministic version and invalidation rules over time-based heuristics.
- **GUD-003**: Prefer browser-visible behavior that is easy to explain: instant reuse when unchanged, targeted update when changed, full refresh only when structurally necessary.
- **PAT-001**: Treat cache behavior as a contract with explicit query keys, freshness inputs, invalidation rules, and browser validation scenarios.

## 4. Interfaces & Data Contracts

### 4.1 Required Query Ownership

The implementation must expose separate query ownership for at least these view-model classes:

| Query Class | Purpose | Minimum Key Shape |
| --- | --- | --- |
| Bootstrap Query | App shell, selected room context, capabilities, high-level counts | `["chat","bootstrap",...]` |
| Session Navigation Query | Room-scoped or filter-scoped session tree data | `["chat","sessions",...]` |
| Trace Query | Selected session trace content | `["chat","trace",piboSessionId,...]` |

The exact key suffixes may differ, but the separation of ownership is mandatory.

### 4.2 Trace Freshness Contract

The trace endpoint must support a freshness contract with the following properties:

- The client can present the previously known Trace Version.
- The server can answer that the trace is unchanged without returning the full trace payload.
- The client can keep the currently displayed trace when the server confirms no change.
- A changed Trace Version must correspond to a trace-relevant data change, not to incidental transport timing.

### 4.3 Cache Invalidation Matrix

The implementation work must document this contract in code or adjacent docs:

| Mutation / Event | Affected Query Classes | Expected Behavior |
| --- | --- | --- |
| Send message | Trace Query, optionally Session Navigation Query | Trace updates live; navigation updates only if title, status, unread, or ordering changes |
| Slash command execution | Trace Query, optionally Bootstrap or Session Navigation Query | Same targeted behavior as send message |
| Session rename | Session Navigation Query, Bootstrap Query if title is surfaced there | No unrelated trace eviction |
| Session archive or restore | Session Navigation Query, Bootstrap Query | Trace cache may remain but selection must stay valid |
| Session delete | Session Navigation Query, Bootstrap Query, selected Trace Query if open | Removed session must not remain selectable |
| Room rename | Bootstrap Query, Session Navigation Query | No unrelated trace loss |
| Room archive or restore | Bootstrap Query, Session Navigation Query | Active selection behavior must remain valid |
| Room delete | Bootstrap Query, Session Navigation Query | Browser must converge to a valid remaining route |
| Session clone or fork | Session Navigation Query, Bootstrap Query, new Trace Query | Existing source session trace must remain reusable |
| Live SSE delta | Trace Query only by default | No full bootstrap refresh per delta |

### 4.4 Browser Validation Deliverables

Browser validation must produce the following deliverables:

- A named test checklist with pass or fail results.
- The exact browser and environment used.
- A short note for each observed issue or remaining risk.
- Evidence that the real Chat Web App was exercised through `/apps/chat`, not only through isolated unit tests.

## 5. Acceptance Criteria

- **AC-001**: Given a user opens Session A, then Session B, then returns to Session A without any trace change, When Session A is shown again in the browser, Then the Trace Pane renders immediately from cache and does not wait for a full trace payload before showing content.
- **AC-002**: Given Session A receives no new events while unfocused, When the browser returns to Session A, Then the user does not see a full loading reset or avoidable flicker.
- **AC-003**: Given Session A receives new trace data while unfocused, When the browser returns to Session A, Then the previous trace appears immediately and converges to the new state without losing canonical trace order.
- **AC-004**: Given the user remains on Session A while live updates arrive, When assistant text, reasoning, tool, or delegation updates stream in, Then only the Trace Pane updates and the Session Tree does not fully rerender.
- **AC-005**: Given a mutation affects room or session metadata, When the mutation completes, Then only the documented cached queries are invalidated or patched.
- **AC-006**: Given the client sends a known Trace Version for an unchanged session, When the server evaluates freshness, Then it returns a not-modified response and the client keeps the existing Trace Pane content.
- **AC-007**: Given the client sends a known Trace Version for a changed session, When the server evaluates freshness, Then it returns fresh trace content and the browser converges without a full page reload.
- **AC-008**: Given the user navigates directly to a Canonical Chat URL, When the page loads, Then cache usage does not override the URL-selected room or session.
- **AC-009**: Given the implementation is reviewed for architecture, When caching responsibilities are inspected, Then query ownership, live update handling, and browser selection behavior are separable and understandable without reverse-engineering one large component.
- **AC-010**: Given final sign-off is requested, When evidence is reviewed, Then browser-based validation results are present and passing.

## 6. Test Automation Strategy

- **Test Levels**: Unit, integration, browser-driven end-to-end, and manual browser smoke testing.
- **Mandatory Browser Rule**: Every acceptance-critical behavior in this specification must be exercised through the browser UI. Non-browser tests are necessary support, not a substitute.
- **Frontend Tests**: Add focused tests for cache reuse, targeted rerender behavior, and URL-driven session selection where the current code structure allows it.
- **Backend Tests**: Add or update tests for trace versioning, not-modified responses, cache invalidation correctness, and backend trace cache safety.
- **Browser Automation**: If browser automation exists or is introduced, it must cover Session A -> Session B -> Session A, unchanged versus changed trace behavior, and live streaming behavior.
- **Manual Browser Validation**: A human or agent must execute the same scenarios in a real browser and record pass or fail results before sign-off.
- **Performance Validation**: Include at least one browser session with long enough trace activity to detect avoidable full rerenders, visible stutter, or full-session reload behavior.
- **Regression Scope**: Re-run chat trace tests and browser scenarios after any refactor to caching ownership, trace freshness, or invalidation logic.

## 7. Rationale & Context

The current problem is not only latency. The larger risk is incorrect ownership. If trace rendering, live updates, session navigation, and browser selection are tightly coupled, the UI becomes fragile: harmless trace deltas can trigger avoidable reloads, returning to a previous session becomes visibly slow, and future features such as room-level unread state or alternative trace views become harder to add safely.

This work therefore needs both hardening and simplification. The target behavior should be easy to state and easy to verify:

- If nothing changed, the browser shows the cached session instantly.
- If something changed, only the affected data refreshes.
- If metadata changed, only the relevant navigation or bootstrap data refreshes.
- The browser remains the source of truth for what the user selected.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Chat Web App under `/apps/chat` - primary browser surface for validation.

### Infrastructure Dependencies

- **INF-001**: Same-origin Pibo web host - serves the Chat Web App and `/api/chat/*`.
- **INF-002**: Chat Web Read Model - source for web-oriented session indexing and event-derived freshness inputs.

### Data Dependencies

- **DAT-001**: Pi session transcript data - source of persisted transcript content.
- **DAT-002**: Pibo Session metadata - source of room membership, selection identity, and session metadata.
- **DAT-003**: Chat Web SSE Stream - source of live browser updates.

### Technology Platform Dependencies

- **PLT-001**: TanStack Query or equivalent query-cache ownership layer inside the Chat Web App.
- **PLT-002**: Browser devtools or equivalent inspection tooling for validating rerender and network behavior.

## 9. Examples & Edge Cases

```text
Scenario: unchanged return path
1. Open /apps/chat/rooms/<roomId>/sessions/<sessionA>
2. Wait for Session A trace to load
3. Switch to Session B
4. Switch back to Session A
Expected:
- Session A content appears immediately
- No full blank loading state replaces the cached trace
- Optional background freshness check does not disturb visible content
```

```text
Scenario: changed return path
1. Open Session A
2. Switch to Session B
3. Cause Session A to receive new assistant output
4. Switch back to Session A
Expected:
- Old Session A content appears immediately from cache
- Browser converges to the new trace state
- Trace order remains correct
- The full Session Tree does not visibly reset
```

```text
Scenario: live streaming isolation
1. Open Session A and start a long response
2. Watch the browser while live updates stream
Expected:
- Trace Pane updates incrementally
- Session Tree remains stable
- No full app loading cycle is triggered per delta
```

## 10. Validation Criteria

- The implementation satisfies all acceptance criteria in this document.
- The Cache Invalidation Matrix exists and matches the implemented mutation behavior.
- Trace freshness behavior is verified by automated tests.
- Real browser validation was executed and documented.
- The code review conclusion states whether the solution is safe to extend for future room, session, and trace features.

## 11. Related Specifications / Further Reading

- [spec/spec-design-web-chat-trace-ui.md](<HOME>/code/pibo/spec/spec-design-web-chat-trace-ui.md)
- [plans/harden-chat-trace-rendering.md](<HOME>/code/pibo/plans/harden-chat-trace-rendering.md)
- [plans/optimize-chat-trace-streaming-performance.md](<HOME>/code/pibo/plans/optimize-chat-trace-streaming-performance.md)
- [RULES.md](<HOME>/code/pibo/RULES.md)
- [GLOSSARY.md](<HOME>/code/pibo/GLOSSARY.md)
