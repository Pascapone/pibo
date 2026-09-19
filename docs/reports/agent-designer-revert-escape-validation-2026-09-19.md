---
type: "Validation Report"
title: "Agent Designer revert escape validation"
description: "Records the revert-to-saved escape hatch that unblocks navigation and tab close when Agent Designer autosave cannot persist an invalid draft."
tags: ["agent-designer", "autosave", "chat-web", "validation"]
status: "stable"
authority: "evidentiary"
generated:
  by: "muse-code/muse-spark"
  at: "2026-09-19T18:42:00Z"
sources:
  - id: "fix-branch"
    resource: "scope:repository branch fix/agent-designer-blocker-revert based on beta/4.0-plugin-system at 1d157641"
    title: "Revert escape implementation and regression test"
  - id: "designer-source"
    resource: "scope:repository source src/apps/chat-ui/src/agents/AgentsView.tsx and src/apps/chat-ui/src/App.tsx at the validated checkout"
    title: "Autosave guards and revert control"
---

# Agent Designer revert escape validation

**Date:** 2026-09-19
**Status:** PASS for focused regression, neighboring designer suites, chat-ui typecheck delta, production UI build, and isolated gateway smoke.
**Branch:** `fix/agent-designer-blocker-revert`
**Base:** `beta/4.0-plugin-system` at `1d157641`

## Problem

`persistIfNeeded` in `AgentsView.tsx` throws for every invalid draft. One observed trigger is an agent that keeps Skills selected while its runtime (for example the Muse runtime) reports Skills as unsupported: the backend runtime validation rejects the save with 400 and autosave can never succeed. Every exit path awaits the same throwing function, so the user is stuck:

- route navigation via `flushAgentBeforeNavigation` in `App.tsx`,
- desktop tab switch and tab close via `applyGuardedDesktopTabTransition`,
- in-designer agent switching via `runAfterAutosave`.

The only way out was repairing the draft by hand until it validated again.

## Fix

- `AgentsView.tsx` gains `revertToSaved` plus a `reverting` state and a `Revert` button in the designer header, shown while changes are unsaved or failed (`saveState` idle or error) on editable drafts. Saved agents reload their last server state through `getCustomAgents` and `agentToDraft`; never-saved drafts fall back to `selectExistingAgentDraft`. A missing server agent keeps the draft and reports an error instead of discarding it.
- Both `App.tsx` guard errors now point at the escape hatch: "Fix the draft, or use Revert in the Agent Designer to discard the unsaved changes."
- No silent auto-discard was added: leaving still requires either a successful save or an explicit Revert click.

## Evidence

- New focused regression `test/chat-ui-agent-designer-revert.test.mjs`: 3/3 pass with the fix; verified red without it by stashing the source change (0 of 2 guard-message matches, revert control absent).
- Neighboring designer suites (`chat-ui-agent-designer-*`, `chat-ui-agents-initial-draft`, `chat-ui-desktop-tabs-model`, `plugin-system-agent-designer-ui`): 33/33 pass.
- `npm run chat-ui:typecheck`: no new errors. The single `composer-send.ts` `clientTxnId` error is pre-existing on the base commit and untouched by this change.
- Production builds from the worktree succeed: `tsc`, `web-ui:build`, `workflows:build`, `pibo4` artifacts, plugin SDK.
- Isolated gateway smoke from the worktree build on ports 4828/4829 with a fresh `PIBO_HOME`: `GET /apps/chat` returns 200 and the built bundle contains the Revert control; `GET /api/chat/agents` returns 200.

## Files changed

- `src/apps/chat-ui/src/agents/AgentsView.tsx` — revert state, `revertToSaved`, header button.
- `src/apps/chat-ui/src/App.tsx` — guard messages for navigation and desktop tab transitions.
- `test/chat-ui-agent-designer-revert.test.mjs` — focused regression coverage.

## Follow-ups

- A "discard and leave" dialog on blocked tab close would shorten the escape to one click; deliberately left out to avoid silent data loss.
- The pre-existing `composer-send.ts` typecheck error remains open on the beta branch.
