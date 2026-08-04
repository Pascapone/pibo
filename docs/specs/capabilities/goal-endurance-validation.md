# Spec: Goal Endurance Validation

**Status:** Implementing  
**Created:** 2026-08-04  
**Requester / Source:** GitHub Issue #340  
**Related docs:** `docs/specs/changes/general-loop-module/spec.md`, `docs/specs/capabilities/yielded-run-control.md`

## Why

Goal operation can span many hours and gateway lifetimes. Short unit tests do not prove that one Goal and Pibo Session retain progress, accounting, browser resources, and cleanup across day-scale operation and expected failures.

## Goal

Provide a repeatable 24–48-hour Goal reliability gate that produces a compact machine-readable report and can run either on a scheduled wall clock or with accelerated deterministic time.

## Scope

### In Scope

- Repeated turns in one durable Goal and Pibo Session.
- Interrupted-run recovery after a deterministic store reopen or an actual disposable gateway-process restart.
- Tool timeout, pause/resume, trace growth, and compaction checkpoints.
- Browser lease renewal, process replacement, lease release, and final browser-process reaping; scheduled runs can use real Chromium/CDP.
- Unbounded and controlled budget-limited variants.
- Separate wall-time, active-time, token, and failure metrics.

### Out of Scope

- Provider quality or model-answer correctness.
- Production mutation or use of existing user sessions.
- Deployment, release, or automatic PR merge.

## Requirements

### Requirement: Day-scale scenarios are schedulable and reproducible

The validation MUST support a real wall-clock mode lasting 24–48 hours and an accelerated deterministic mode covering the same lifecycle transitions.

#### Acceptance

`node scripts/goal-endurance-check.mjs --duration-hours 24 --real-time --real-gateway --real-browser` runs the full scheduled integration form. Omitting `--real-time` executes the same duration without wall-clock waiting; omitting either integration flag uses the deterministic substitute for that subsystem.

### Requirement: Restart preserves Goal and session identity

The same Goal and Pibo Session MUST continue after an active run is interrupted. Full scheduled validation MUST restart a disposable real gateway process twice against the same persistent store; the fast CI form MAY model the boundary by closing and reopening the store directly.

#### Acceptance

The report contains one Goal id, one Pibo Session id, exactly one recovered interrupted run, no duplicate progress ids, and one progress fact for every successful run.

### Requirement: Operational failures and accounting remain distinct

The report MUST distinguish a tool timeout, an interrupted run, successful runs, configured/simulated wall time, measured elapsed wall-clock time, active time, tokens, and budget-limited termination.

### Requirement: Browser resources recover and clean up

The same browser lease MUST renew across turns, replace one unavailable browser process, release the lease, reap the final browser process, and finish with an empty pool. Full scheduled validation MUST use real Chromium and CDP; the fast CI form MAY use deterministic process and CDP adapters.

### Requirement: Reports are automation-friendly

Every run MUST write one bounded JSON report and exit nonzero when an invariant fails.

## Edge Cases

- A paused Goal must not reserve a run.
- A budget-limited Goal must remain disabled.
- Restart recovery may mark the interrupted resource state dirty before later reacquisition.
- Final browser cleanup is valid only when the active lease id is cleared.

## Constraints

- **Compatibility:** The harness uses public Loop store and browser-pool contracts.
- **Security / Privacy:** It operates only in temporary disposable stores and writes no session content.
- **Performance:** Accelerated 24–48-hour scenarios should complete in seconds.
- **Dependencies:** Full runtime interpretation depends on the focused fixes for Issues #335–#339.

## Success Criteria

- [x] SC-001: Accelerated 24-hour and 48-hour runs pass.
- [x] SC-002: The same Goal and Pibo Session survive restart recovery without duplicate or lost progress.
- [x] SC-003: Timeout, interruption, pause/resume, budget limit, lease replacement, and cleanup are represented separately.
- [x] SC-004: JSON output is suitable for CI or scheduled execution.
- [ ] SC-005: A scheduled real wall-clock run with real gateway and Chromium/CDP integration completes for at least 24 hours.

## Traceability

| Requirement | Scenario | Implementation | Status |
|---|---|---|---|
| REQ-001 | Accelerated and wall-clock day-scale run | `scripts/goal-endurance-check.mjs` | Implemented |
| REQ-002 | Gateway restart during active run | Persistent store recovery plus optional disposable gateway-process restart | Implemented |
| REQ-003 | Timeout, accounting, and budget variant | Endurance report variants | Implemented |
| REQ-004 | Lease renewal, replacement, release, and reap | Deterministic or real Chromium/CDP browser-pool lifecycle | Implemented |
| REQ-005 | Machine-readable evidence | JSON report and nonzero failure exit | Implemented |
