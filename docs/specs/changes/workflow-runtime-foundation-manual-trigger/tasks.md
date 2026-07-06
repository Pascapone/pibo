# Tasks: Workflow Runtime Foundation and Manual Trigger

**Status:** Draft
**Created:** 2026-07-06

## T0 — Spec and Inventory

- [x] T0.1 Inventory current Workflow docs, legacy specs, and current source boundaries.
- [x] T0.2 Identify current gap: package runtime helpers exist, Chat Web product graph execution is not wired end-to-end.
- [x] T0.3 Create current change spec for runtime foundation and manual trigger.
- [ ] T0.4 Review open questions with maintainers before implementation.

## T1 — IR and Validation Foundation

- [ ] T1.1 Decide durable trigger node shape: `kind: "trigger"` plus `trigger.kind`, or a short-term flat kind.
- [ ] T1.2 Extend workflow validation to accept manual trigger nodes.
- [ ] T1.3 Add run-blocking validation for trigger input, trigger outputs, and outgoing edge compatibility.
- [ ] T1.4 Ensure old workflows without trigger nodes still load as drafts.
- [ ] T1.5 Add tests for valid trigger node, invalid trigger input, missing outgoing edge, and incompatible first edge.

## T2 — Minimal Editor Manual Trigger UI

- [ ] T2.1 Add Manual Trigger to node palette/context menu.
- [ ] T2.2 Render trigger nodes with distinct start/play styling.
- [ ] T2.3 Add Play action on selected/hovered trigger and in inspector.
- [ ] T2.4 Add compact text/JSON input dialog.
- [ ] T2.5 Show running/result/error state through bottom status and compact run panel.
- [ ] T2.6 Validate that existing graph layout and edge route behavior remain intact.

## T3 — Runtime Start API

- [ ] T3.1 Define server API for draft editor test run.
- [ ] T3.2 Define shared run request envelope for editor, Project, webhook, and cron starts.
- [ ] T3.3 Add structured response with run id, status, diagnostics, and optional output.
- [ ] T3.4 Add cancellation/status endpoints or reuse existing run inspection channels.
- [ ] T3.5 Add API tests for accepted run, blocked run, duplicate/idempotent request, and invalid input.

## T4 — First Executor Slice

- [ ] T4.1 Select persistence path for runtime facts.
- [ ] T4.2 Execute trigger → agent for text input/output.
- [ ] T4.3 Execute trigger → agent → agent with direct compatible edge transfer.
- [ ] T4.4 Record node attempts and linked Pibo Session ids.
- [ ] T4.5 Record edge transfer facts.
- [ ] T4.6 Ensure full upstream chat history is not passed by default.
- [ ] T4.7 Add integration tests with mocked Pibo Session routing, then one bounded real-route smoke where feasible.

## T5 — Adapter Foundation

- [ ] T5.1 Wire direct edge compatibility checks into product executor.
- [ ] T5.2 Wire registered edge adapter execution.
- [ ] T5.3 Wire visible adapter node execution.
- [ ] T5.4 Record adapter input/output summaries and diagnostics.
- [ ] T5.5 Add tests for text-to-JSON adapter and invalid adapter output.

## T6 — Guard, Router, and Judge-Agent Foundation

- [ ] T6.1 Apply registered deterministic guards to outgoing edges.
- [ ] T6.2 Define default multi-edge routing policy.
- [ ] T6.3 Add explicit diagnostics for no eligible outgoing edge.
- [ ] T6.4 Document and test judge-agent pattern: agent emits decision JSON, guards route based on it.
- [ ] T6.5 Add abort/cancel route semantics as explicit terminal/control behavior.

## T7 — Project Session Executor Integration

- [ ] T7.1 Route existing Project workflow session start through the same executor contract.
- [ ] T7.2 Keep configured-session snapshot immutability.
- [ ] T7.3 Ensure one primary workflow run per Project session remains enforced.
- [ ] T7.4 Render real node attempts and edge transfers in Project Workflow view.
- [ ] T7.5 Preserve Project sidebar rule: only real Pibo Sessions appear as sessions.

## T8 — Future Trigger Providers

- [ ] T8.1 Add webhook trigger spec before implementation.
- [ ] T8.2 Add cron/scheduled trigger spec before implementation.
- [ ] T8.3 Add trigger auth, replay, idempotency, and rate-limit requirements.
- [ ] T8.4 Add observability and delivery diagnostics for external triggers.

## Verification Gate

Before implementation PR merge:

- [ ] `npm run typecheck`
- [ ] Relevant workflow package tests
- [ ] Relevant Chat Web API tests
- [ ] Chat UI typecheck/build for UI changes
- [ ] Manual Dev Gateway smoke: create manual trigger → agent → agent and confirm visible output/edge transfer
