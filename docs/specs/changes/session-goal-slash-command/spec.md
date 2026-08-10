# Spec: Session Goal Slash Command

**Status:** Implementing
**Created:** 2026-08-10
**Requester / Source:** User request in Pibo session `ps_5bbaf776-0335-4067-9a67-ef79b4bab6f6`
**Related docs:** `docs/specs/changes/general-loop-module/spec.md`, `docs/specs/capabilities/chat-web-slash-command-surface.md`

## Why

Starting or controlling a Goal Loop currently requires the Loop UI, CLI, or native agent tools. A user working inside a Pibo Session needs a direct slash command that keeps the Goal bound to that session.

## Goal

Add `/goal` as a session command that creates or updates the session's Goal Loop and supports graceful pause and resume without allowing duplicate active Goal Loops for one Pibo Session.

## Scope

### In Scope

- `/goal <objective>` creates an active same-session Goal Loop when none exists.
- `/goal <objective>` updates and activates the existing unfinished Goal Loop for the session.
- `/goal pause` disables future Loop turns without aborting an in-flight turn.
- `/goal resume` re-enables a paused Goal Loop.
- Chat Web, Projects, VS Code, gateway client, and routed terminal command argument forwarding.
- Focused unit and integrated server validation.

### Out of Scope

- Changing Goal token budgets, reserves, stop policies, model overrides, or resource configuration through `/goal`.
- Reopening completed or budget-limited Goals through `/goal resume`.
- Aborting the current Goal turn when pausing.

## Requirements

- The Loop plugin MUST advertise one `goal` gateway action with slash command `/goal`.
- The command MUST target the selected Pibo Session.
- Creation MUST bind the Goal to the session's room and profile.
- Repeated objective updates MUST reuse the current unfinished Goal job rather than create a duplicate.
- Pause MUST leave an already-running Loop run active while preventing another turn from starting.
- Resume MUST continue the same paused Goal job and MUST be idempotent for an already-active Goal.
- Missing objectives and missing Goal Loops MUST produce actionable errors.

## Acceptance Criteria

- [ ] `/goal Ship the feature` creates one active Goal Loop for the selected session.
- [ ] A second `/goal Revised objective` updates the same Loop job ID and leaves one Goal owner for the session.
- [ ] `/goal pause` marks the Goal paused without setting cancellation state or cancelling an in-flight run.
- [ ] `/goal resume` returns that same Goal to active state.
- [ ] Slash command argument forwarding works in supported session surfaces.
- [ ] Focused tests, typecheck, build, and real Pibo2 validation pass.
