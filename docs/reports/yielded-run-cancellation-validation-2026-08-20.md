# Yielded-Run Cancellation Validation — 2026-08-20

**Status:** PASS for focused implementation and canonical validation; integrated packaged validation pending.
**Branch:** `fix/yielded-run-cancellation`
**Base:** `upstream/dev` at `a399dcd7`

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

Pending assembly into the disposable portability/auth/dependency/upload candidate and exact installed-artifact cancellation proof on Pibo2. No provider turn is required for this deterministic process-lifecycle validation.

## Safety boundary

Cancellation cannot undo an external side effect that completed before the abort. A yieldable tool that ignores its abort signal can still fail the bounded settlement check; Pibo surfaces that failure instead of falsely claiming the underlying work stopped.

No package was published, no branch was merged, and no release was created.
