# Workflow Spec Inventory and Gap Report

**Date:** 2026-07-06
**Status:** Draft
**Source:** Review during workflow runtime foundation planning

## Summary

The workflow documentation has three layers:

1. **Legacy change specs** under `docs/legacy/specs/changes/` describe the original broad V1/V2 ambitions.
2. **Current capability/project docs** under `docs/specs/capabilities/` and `docs/project/` describe the framework package and Chat Web projection surfaces.
3. **New current change spec** under `docs/specs/changes/workflow-runtime-foundation-manual-trigger/` defines the next implementation direction: manual editor trigger plus extensible runtime foundation.

## Existing Specs and Docs

### Current docs

- `docs/project/workflows.md`
  - Before this update, it described V1 as if the full runtime was generally available from product flows.
  - Updated to distinguish framework package capability from Chat Web product execution integration.
- `docs/project/workflow-interface-adapters.md`
  - Describes deterministic adapters and explicit interface conversion.
  - Updated to clarify that judge/summarizer/router behavior must be explicit agent nodes, not hidden adapters.
- `docs/specs/capabilities/pibo-workflow-framework-package.md`
  - Describes source-backed `packages/workflows` framework capability.
  - Updated related links and out-of-scope note to point to the new runtime-foundation change.
- `docs/specs/capabilities/chat-web-workflow-session-view.md`
  - Describes read-only Project workflow session view.
- `docs/specs/capabilities/chat-web-workflow-xstate-session-view.md`
  - Describes XState-style UI projection.

### Legacy specs

- `docs/legacy/specs/changes/pibo-workflow-system-v1/`
  - Broad runtime framework, registry, adapter, persistence, XState, and execution design.
  - Still useful as reference, not the current implementation checklist.
- `docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/`
  - Broad UI authoring spec.
  - Many UI ambitions were intentionally scaled back after the UI became too crowded.

## Current Source Findings

- `packages/workflows` exists and includes IR types, validation, registry, runtime node dispatch helpers, edge transfer helpers, store contracts, inspection, tests, and XState projection helpers.
- Chat Web Workflows UI exists and supports catalog/drafts/publishing, graph authoring, inspectors, pickers, adapter metadata, human action metadata, layout persistence, and edge route metadata.
- Chat Web Project workflow session creation and start routes exist.
- Product workflow start currently creates/returns run metadata; the full graph executor is not wired through Chat Web to run nodes and edge transfers end-to-end.
- The Workflows editor has no manual trigger node and no editor test-run Play flow.

## Main Gaps

1. **Trigger model:** No first-class trigger node or trigger provider contract in current product UI.
2. **Editor run:** No Workflows editor action to run a draft.
3. **Runtime integration:** Product routes do not yet dispatch full graph execution from Chat Web using the workflow package runtime helpers.
4. **Default handoff:** Agent-to-agent handoff semantics were not clearly documented for product execution.
5. **Adapter/Judge distinction:** Docs needed a sharper distinction between deterministic adapters and explicit agentic transformations/judges.
6. **Spec freshness:** Some current docs linked to old `docs/specs/changes/...` paths after those specs moved to `docs/legacy/specs/changes/...`.

## New Spec Added

`docs/specs/changes/workflow-runtime-foundation-manual-trigger/`

This is now the current spec for the next workflow phase. It intentionally starts small:

- Manual trigger node.
- Play from editor.
- Text input first, JSON later/when schema exists.
- Draft test run without publishing.
- Direct compatible edge transfer.
- Trigger → agent and trigger → agent → agent as the first target flows.
- Stable interfaces for future adapters, guards, judge agents, webhooks, cron, human waits, and Project execution.

## Recommendation

Use the new change spec as the implementation source of truth for the next PRs. Keep legacy specs as reference only. Do not revive old UI-heavy requirements unless they are explicitly re-approved and scoped into a new phase.
