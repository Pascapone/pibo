# Yielded-Run Cancellation Validation — 2026-08-20

**Status:** PASS for focused, canonical, packed-install, and exact Pibo2 installed-artifact validation.
**Branch:** `fix/yielded-run-cancellation`
**Base:** `upstream/dev` at `a399dcd7`
**Pull request:** #528

## Finding

A real `pibo_run_cancel` call changed the durable run record to `cancelled` but did not stop the active yielded Bash execution. The transient systemd unit remained active for more than four minutes, and the gateway resource guard rejected the next yielded run because one execution was still admitted. Repeating `pibo_run_cancel` did not stop the unit; an operator-level unit stop was required.

## Root cause

Run cancellation was implemented only in `PiboRunRegistry`. The router updated lifecycle state and reminders but held no cancellation hook for the asynchronous tool execution. `pibo_run_start` passed the original tool-call signal into the background tool and discarded the ability to abort it later. Systemd resource isolation terminated units on execution failure or resource limits, but exposed no explicit cancellation operation.

## Remediation

- Create a run-local `AbortController` for every yielded tool execution.
- Combine the caller signal with the run-local cancellation signal.
- Register an active cancellation handler with the owning session router.
- Expose explicit cancellation from the prepared resource-isolation wrapper.
- Kill and stop the complete systemd control group for isolated Bash runs.
- Wait up to 15 seconds for execution settlement before reporting successful cancellation.
- Remove the cancellation handler and release gateway admission only after execution settles.
- Fail cancellation explicitly rather than claiming success when a tool ignores cancellation beyond the bounded interval.

## Focused validation

- TypeScript typecheck: passed.
- Production build: passed.
- Focused run-control and resource-isolation suite: **37/37 passed**.
- The run-start cancellation test proved the active yieldable tool receives an aborted signal.
- The router regression proved `pibo_run_cancel` returns `cancelled` and a replacement yielded run is admitted immediately afterward.
- The real systemd regression started a 30-second isolated Bash tree, cancelled it, and proved the transient unit was no longer active.
- `git diff --check`: passed.

## Canonical validation

The canonical manifest contained 309 unique test files and ran in 16 isolated serial groups. All **1,783/1,783** tests passed with zero failures, skips, or cancellations.

## Integrated validation

The fix was included only in disposable integration commit `e0fd14fb8c050c28cb7c9d7096317482d211edff` with the portability, auth, dependency, resource-reaper, and private-upload branches.

- Integrated typecheck and production build: passed.
- Integrated focused suite: **241/241 passed**.
- Integrated canonical suite: **1,817/1,817 passed across 312 files**.
- Packed archive SHA-256: `63f5af4f364755da9c6cc10e6fd62287308cf72ad10f180639c0d7959643b8aa`.
- Packed production audit: zero advisories.
- Packed cancellation smoke: cancelled status, isolated unit inactive, and immediate replacement run completed.

The checksum-verified archive was activated on Pibo2. A direct script imported the installed package, started a 30-second isolated Bash run through the generated `pibo_run_start` tool, waited for its systemd unit to become active, cancelled it through generated `pibo_run_cancel`, verified the unit was inactive, and immediately completed a replacement yielded run under a one-run admission limit. Zero active `pibo-yielded-*` services remained afterward. Machine-authenticated bootstrap, portable-history metadata, dependency audit, upload permissions, browser/CDP, and zero provider-failure checks remained healthy. No provider turn was used for this deterministic process-lifecycle proof.

## Safety boundary

Cancellation cannot undo an external side effect that completed before the abort. A yieldable tool that ignores its abort signal can still fail the bounded settlement check; Pibo surfaces that failure instead of falsely claiming the underlying work stopped.

No package was published, no branch was merged, and no release was created.
